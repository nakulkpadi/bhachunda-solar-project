package com.bhachunda.erp

import kotlinx.coroutines.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.*
import org.junit.Assert.*
import java.nio.file.Files
import java.time.LocalDate
import java.time.ZoneId

private class MemorySession(var value: Session?): SessionStore { override fun read()=value;override fun write(session: Session){value=session};override fun clear(){value=null} }
class ErpApiTest {
    private lateinit var server: MockWebServer
    private lateinit var store: MemorySession
    private lateinit var api: ErpApi
    @Before fun setup() {server=MockWebServer();server.start();store=MemorySession(Session("access-test","refresh-test",System.currentTimeMillis()/1000+3600,"user-test","test@example.invalid"));api=ErpApi(store,server.url("/").toString(),"public-test")}
    @After fun cleanup(){server.shutdown()}
    private fun reply(json: String,code: Int=200) {server.enqueue(MockResponse().setResponseCode(code).setHeader("Content-Type","application/json").setBody(json))}
    @Test fun profileUsesValidatedUserAndLiveApproval()=runBlocking {
        reply("""{"id":"user-test","user_metadata":{"role":"admin"}}""")
        reply("""[{"role":"viewer","is_active":false,"approval_status":"pending"}]""")
        val profile=api.profile();assertFalse(profile.approved);assertFalse(profile.isAdmin)
        assertEquals("/auth/v1/user",server.takeRequest().path);val request=server.takeRequest();assertTrue(request.path!!.contains("profiles?select=full_name,role,is_active,approval_status,email"));assertEquals("Bearer access-test",request.getHeader("Authorization"))
    }
    @Test fun expiredTokenRotatesAndPersists()=runBlocking {
        store.value=store.value!!.copy(expires_at=0);api=ErpApi(store,server.url("/").toString(),"public-test")
        reply("""{"access_token":"rotated-access","refresh_token":"rotated-refresh","expires_in":3600,"user":{"id":"user-test","email":"test@example.invalid"}}""");reply("[]")
        api.parcels();val refresh=server.takeRequest();assertEquals("/auth/v1/token?grant_type=refresh_token",refresh.path);assertTrue(refresh.body.readUtf8().contains("refresh-test"));assertEquals("Bearer rotated-access",server.takeRequest().getHeader("Authorization"));assertEquals("rotated-refresh",store.value!!.refresh_token)
    }
    @Test fun rejectedRefreshClearsSession()=runBlocking {
        store.value=store.value!!.copy(expires_at=0);api=ErpApi(store,server.url("/").toString(),"public-test");reply("""{"message":"invalid refresh"}""",400)
        try{api.parcels();fail("Expected expired authentication")}catch(_:AuthExpired){}
        assertNull(api.session);assertNull(store.value);assertEquals(1,server.requestCount)
    }
    @Test fun consentUsesSafeReturnColumnsAndNoImportMetadata()=runBlocking {
        reply("""[{"parcel_id":"parcel-test","status":"received"}]""")
        api.consent("parcel-test",ConsentDraft(reference="Letter 12",remarks="Field visit"))
        val request=server.takeRequest();assertEquals("POST",request.method);assertTrue(request.path!!.contains("select=parcel_id,status,received_on,remarks"));assertEquals("resolution=merge-duplicates,return=representation",request.getHeader("Prefer"));val body=request.body.readUtf8();assertFalse(body.contains("source_value"));assertTrue(body.contains("Reference: Letter 12"));assertTrue(body.contains("user-test"))
    }
    @Test fun missingConsentWriteConfirmationFails()=runBlocking {
        reply("[]");try{api.consent("parcel-test",ConsentDraft());fail("Must verify persisted row")}catch(_:IllegalStateException){}
    }
    @Test fun nonReceivedConsentExplicitlyClearsDateAndEmptyRemarks()=runBlocking {
        reply("""[{"parcel_id":"parcel-test","status":"pending"}]""")
        api.consent("parcel-test",ConsentDraft(status="pending"))
        val body=com.google.gson.JsonParser.parseString(server.takeRequest().body.readUtf8()).asJsonObject
        assertTrue(body.has("received_on"));assertTrue(body["received_on"].isJsonNull)
        assertTrue(body.has("remarks"));assertTrue(body["remarks"].isJsonNull)
    }
    @Test fun uploadSizeRejectedWithoutNetwork()=runBlocking {
        try{api.upload("parcel-test","consent_letter",null,"consent.pdf","application/pdf",ByteArray(15*1024*1024+1));fail("Must reject oversize")}catch(_:IllegalArgumentException){}
        assertEquals(0,server.requestCount)
    }
    @Test fun commentLimitMatchesTheServerBeforeSending()=runBlocking {
        try{api.addComment("parcel-test","x".repeat(2001));fail("The database allows at most 2,000 characters")}catch(_:IllegalArgumentException){}
        assertEquals(0,server.requestCount)
    }
    @Test fun oauthRejectsLookalikeGoogleHost()=runBlocking {
        reply("""{"authorize_url":"https://accounts.google.com.evil.invalid/"}""")
        try{api.driveConnectUrl();fail("Must reject other hosts")}catch(_:IllegalArgumentException){}
    }
    @Test fun patelReportUsesOriginalBackendAndFilters()=runBlocking {
        server.enqueue(MockResponse().setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").setHeader("Content-Disposition","attachment; filename=patel.xlsx").setBody("PK-test-workbook"))
        val directory=Files.createTempDirectory("erp-test").toFile()
        try{val(file,mime)=api.patel("bitta","received","legal",directory);assertEquals("PK-test-workbook",file.readText());assertTrue(mime.contains("spreadsheetml"));val request=server.takeRequest();assertEquals("/functions/v1/patel-report?village=bitta&consent=received&stage=legal",request.path);assertEquals("Bearer access-test",request.getHeader("Authorization"))}finally{directory.deleteRecursively()}
    }
    @Test fun signoutClearsPhoneSessionAndRevokesLocalSession()=runBlocking {
        reply("",204);api.signOut();assertNull(api.session);assertNull(store.value);assertEquals("/auth/v1/logout?scope=local",server.takeRequest().path)
    }
}
class EntryRulesTest {
    @Test fun pendingAccountsCannotEditOrComment() {assertFalse(Profile(role="editor",is_active=true,approval_status="pending").canEdit);assertFalse(Profile(role="commenter",is_active=true,approval_status="pending").canComment)}
    @Test fun suspendedAdminHasNoAdminAccess() {assertFalse(Profile(role="admin",is_active=false,approval_status="suspended").isAdmin)}
    @Test fun viewerReadsWithoutWriteRights() {val p=Profile(role="viewer",is_active=true,approval_status="approved");assertTrue(p.approved);assertFalse(p.canEdit);assertFalse(p.canComment)}
    @Test fun commenterHasNotesOnly() {val p=Profile(role="commenter",is_active=true,approval_status="approved");assertTrue(p.canComment);assertFalse(p.canEdit);assertFalse(p.isAdmin)}
    @Test fun approvedEditorCanEditWithoutAdminRights() {val p=Profile(role="editor",is_active=true,approval_status="approved");assertTrue(p.canEdit);assertTrue(p.canComment);assertFalse(p.isAdmin)}
    @Test fun receivedConsentHasIndianDateAndReference() {val p=ConsentDraft(reference="A\nB",remarks="Visit done").payload("parcel","user");assertEquals(today(),p["received_on"]);assertEquals("Reference: A B\nVisit done",p["remarks"]);assertFalse(p.containsKey("source_value"))}
    @Test fun nonReceivedStatusClearsReceivedDate() {assertNull(ConsentDraft("pending").payload("parcel","user")["received_on"])}
    @Test(expected=IllegalArgumentException::class) fun rejectsFutureConsentDate() {ConsentDraft(date=LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(1).toString()).payload("parcel","user")}
    @Test(expected=IllegalArgumentException::class) fun rejectsUnsupportedStatus() {ConsentDraft(status="yes").payload("parcel","user")}
    @Test fun csvPreventsFormulaExecutionAndEscapesQuotes() {assertEquals("\"'=HYPERLINK(\"\"x\"\")\"",csvCell("=HYPERLINK(\"x\")"));assertEquals("\"'+1\"",csvCell("+1"));assertEquals("\"normal\"",csvCell("normal"))}
    @Test fun filenameRemovesTraversal() {assertEquals("consent.pdf",safeFilename("../../consent.pdf"));assertEquals("photo_.png",safeFilename("photo?.png"));assertFalse(safeFilename("../.").contains(".."))}
}
