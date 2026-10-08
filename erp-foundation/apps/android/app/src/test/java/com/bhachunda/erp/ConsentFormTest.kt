package com.bhachunda.erp

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Test
import org.junit.Assert.*
import com.google.gson.Gson
import com.google.gson.JsonParser

class ConsentFormTest {
    private val fields=FormFields(date="2026-10-08",survey_number="12/1",khata="0009",has="1.60.57",village_en="Bitta",village_gu="બીટા",owners=listOf("નમૂના માલિક"))
    private fun session()=object:SessionStore { var s:Session?=Session("access-test","refresh-test",9999999999,"fixture-user","fixture@example.invalid");override fun read()=s;override fun write(session:Session){s=session};override fun clear(){s=null} }
    @Test fun roundedGunthaCarriesToNextAcreAndAreaMustBeValid() { assertEquals(FormArea(4046,1,0),formArea("0.40.46"));assertEquals(39,formArea("1.60.57").guntha);for(s in listOf("0.00.00","1.100.00","-1.00.00","1.2")){try{formArea(s);fail("Invalid area accepted")}catch(_:IllegalArgumentException){}catch(_:IllegalStateException){}} }
    @Test fun draftCannotIncludeConsentStatusOrReceiptDates() {
        val json=Gson().toJson(fields.validated());assertFalse(json.contains("received_on"));assertFalse(json.contains("consent_status"));assertTrue(json.contains("0009"));assertTrue(json.contains("નમૂના માલિક"))
        for(bad in listOf(fields.copy(owners=listOf("")),fields.copy(date="2026-02-30"),fields.copy(mobile="not-a-number"))){try{bad.validated();fail("Invalid form accepted")}catch(_:Exception){}}
    }
    @Test fun createAndEditOnlyCallTheGeneratedFormApi()=runBlocking {
        MockWebServer().use { server->server.start();val api=ErpApi(session(),server.url("/").toString(),"public-test");val draft=FormDraft("draft-test","parcel-test",fields=fields)
            server.enqueue(MockResponse().setHeader("Content-Type","application/json").setBody(Gson().toJson(mapOf("draft" to draft))))
            api.saveGeneratedForm("parcel-test",fields,draft.id,null);val request=server.takeRequest();assertEquals("/functions/v1/consent-drafts",request.path);assertEquals("POST",request.method);assertEquals("Bearer access-test",request.getHeader("Authorization"));val body=JsonParser.parseString(request.body.readUtf8()).asJsonObject;assertEquals("parcel-test",body.value("parcel_id"));assertFalse(body.has("status"));assertFalse(body.has("received_on"))
            server.enqueue(MockResponse().setHeader("Content-Type","application/json").setBody(Gson().toJson(mapOf("draft" to draft.copy(revision=2)))))
            api.saveGeneratedForm("parcel-test",fields,draft.id,draft);val update=server.takeRequest();assertEquals("PATCH",update.method);assertEquals("/functions/v1/consent-drafts",update.path);assertTrue(update.body.readUtf8().contains("\"revision\":1"));assertEquals(2,server.requestCount)
        }
    }
    @Test fun unsignedUploadMustIncludeTheSavedDraftRevisionAndNeverUsesReceiptCategory()=runBlocking {
        MockWebServer().use { server->server.start();val api=ErpApi(session(),server.url("/").toString(),"public-test");val draft=FormDraft("draft-test","parcel-test",fields=fields)
            try{api.upload("parcel-test",generatedFormDocumentCode,null,"draft.pdf","application/pdf","%PDF-test".toByteArray());fail("Unsaved form accepted")}catch(_:IllegalArgumentException){}
            assertEquals(0,server.requestCount)
            server.enqueue(MockResponse().setHeader("Content-Type","application/json").setBody("""{"document_id":"draft-document"}"""))
            api.upload("parcel-test",generatedFormDocumentCode,null,"draft.pdf","application/pdf","%PDF-test".toByteArray(),draft)
            val request=server.takeRequest();assertEquals("/functions/v1/drive-upload",request.path);val body=request.body.readUtf8();assertTrue(body.contains("consent_form_draft"));assertTrue(body.contains("draft_revision"));assertFalse(body.contains("received_on"));assertFalse(body.contains("consent_letter"))
        }
    }
}
