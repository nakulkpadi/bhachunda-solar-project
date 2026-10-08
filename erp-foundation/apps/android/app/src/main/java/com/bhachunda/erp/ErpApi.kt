package com.bhachunda.erp

import com.google.gson.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit

class ApiFailure(val code: Int, message: String): Exception(message)
class AuthExpired: Exception("Your session has ended. Please sign in again.")
class ErpApi(private val store: SessionStore, private val baseUrl: String = BuildConfig.SUPABASE_URL, private val publicKey: String = BuildConfig.PUBLIC_KEY, private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()) {
    private val gson = Gson()
    private val sessionLock = Mutex()
    @Volatile var session: Session? = store.read(); private set
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private fun encode(v: String) = URLEncoder.encode(v, "UTF-8")
    private fun request(path: String, token: String?, method: String = "GET", body: RequestBody? = null, prefer: String? = null): Request {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path).header("apikey", publicKey)
        if(token != null) builder.header("Authorization", "Bearer $token")
        if(prefer != null) builder.header("Prefer", prefer)
        return builder.method(method, body).build()
    }
    private fun error(response: Response): ApiFailure {
        val body = runCatching { JsonParser.parseString(response.body?.string().orEmpty()).asJsonObject }.getOrDefault(JsonObject())
        val message = sequenceOf("error_description", "msg", "message", "error").map { body.value(it) }.firstOrNull { it.isNotBlank() && it.length < 1000 } ?: "Request failed (${response.code}). Please try again."
        return ApiFailure(response.code, message.take(600))
    }
    private fun parseSession(data: JsonObject): Session {
        val user = data.obj("user")
        require(data.value("access_token").isNotBlank() && data.value("refresh_token").isNotBlank() && user.value("id").isNotBlank()) { "The sign-in response was incomplete." }
        return Session(data.value("access_token"),data.value("refresh_token"),data.value("expires_at").toLongOrNull() ?: (System.currentTimeMillis()/1000 + (data.value("expires_in").toLongOrNull() ?: 3600)),user.value("id"),user.value("email"))
    }
    private suspend fun token(force: Boolean = false): String = sessionLock.withLock {
        val current = session ?: throw AuthExpired()
        if(!force && current.expires_at > System.currentTimeMillis()/1000 + 60) return@withLock current.access_token
        withContext(Dispatchers.IO) {
            val body = gson.toJson(mapOf("refresh_token" to current.refresh_token)).toRequestBody(jsonType)
            client.newCall(request("/auth/v1/token?grant_type=refresh_token", null, "POST", body)).execute().use { response ->
                if(!response.isSuccessful) {
                    if(response.code in setOf(400,401,403)) { session=null; store.clear(); throw AuthExpired() }
                    throw error(response)
                }
                val next = parseSession(JsonParser.parseString(response.body!!.string()).asJsonObject)
                store.write(next); session=next; next.access_token
            }
        }
    }
    private suspend fun response(path: String, method: String = "GET", data: Any? = null, authenticated: Boolean = true, prefer: String? = null): Response {
        val bearer = if(authenticated) token() else null
        val body = if(method in setOf("POST","PATCH","PUT")) gson.toJson(data ?: emptyMap<String,String>()).toRequestBody(jsonType) else null
        return withContext(Dispatchers.IO) {
            var result = client.newCall(request(path,bearer,method,body,prefer)).execute()
            if(authenticated && result.code==401) { result.close(); val next=token(true); result=client.newCall(request(path,next,method,body,prefer)).execute() }
            if(!result.isSuccessful) { result.use { throw error(it) } }
            result
        }
    }
    suspend fun json(path: String, method: String = "GET", data: Any? = null, authenticated: Boolean = true, prefer: String? = null): JsonElement = withContext(Dispatchers.IO) {
        response(path,method,data,authenticated,prefer).use { r -> val body=r.body?.string().orEmpty(); if(body.isBlank()) JsonNull.INSTANCE else JsonParser.parseString(body) }
    }
    suspend fun signIn(email: String, password: String) {
        val payload = json("/auth/v1/token?grant_type=password", "POST", mapOf("email" to email.trim(), "password" to password), false).asJsonObject
        val next=parseSession(payload); sessionLock.withLock { store.write(next); session=next }
    }
    suspend fun createAccount(name: String, email: String, password: String) {
        require(password.length>=12) { "Use at least 12 characters for your password." }
        json("/auth/v1/signup?redirect_to="+encode(BuildConfig.WEB_URL),"POST",mapOf("email" to email.trim(),"password" to password,"data" to mapOf("full_name" to name.trim())),false)
    }
    suspend fun resetPassword(email: String) { json("/auth/v1/recover?redirect_to="+encode(BuildConfig.WEB_URL),"POST",mapOf("email" to email.trim()),false) }
    suspend fun signOut() {
        val old=session?.access_token
        sessionLock.withLock { session=null; store.clear() }
        if(old!=null) withContext(Dispatchers.IO) { runCatching { client.newCall(request("/auth/v1/logout?scope=local",old,"POST","{}".toRequestBody(jsonType))).execute().close() } }
    }
    suspend fun profile(): Profile {
        // Revalidate identity before using the live database approval record.
        val user=json("/auth/v1/user").asJsonObject
        if(user.value("id")!=session?.user_id) throw AuthExpired()
        val data=json("/rest/v1/profiles?select=full_name,role,is_active,approval_status,email&id=eq."+encode(user.value("id"))).asJsonArray
        return data.firstOrNull()?.let { gson.fromJson(it,Profile::class.java) } ?: Profile()
    }
    suspend fun parcels(): List<Parcel> = json("/rest/v1/parcel_overview?select=*&order=village_name.asc,survey_number.asc&limit=1000").asJsonArray.map { gson.fromJson(it,Parcel::class.java) }
    suspend fun mapStatuses(): List<MapStatus> = json("/rest/v1/map_status_summary?select=feature_key,status,linked_parcel_count").asJsonArray.map { gson.fromJson(it,MapStatus::class.java) }
    suspend fun mapDefinitions(): List<MapDefinition> = json("/rest/v1/map_features?select=feature_key,svg_element_id&limit=2000").asJsonArray.map { gson.fromJson(it,MapDefinition::class.java) }
    suspend fun mapLinks(): List<MapLink> = json("/rest/v1/map_feature_parcel_links?select=feature_key,svg_element_id,parcel_id,survey_number,village_code,village_name&limit=3000").asJsonArray.map { gson.fromJson(it,MapLink::class.java) }
    suspend fun detail(id: String): JsonObject = json("/functions/v1/parcel-detail?parcel_id="+encode(id)).asJsonObject.obj("parcel").also { require(it.value("id")==id) { "The survey could not be loaded." } }
    suspend fun consent(id: String, draft: ConsentDraft) {
        val result=json("/rest/v1/consent_records?on_conflict=parcel_id&select=parcel_id,status,received_on,remarks", "POST", draft.payload(id,session?.user_id ?: throw AuthExpired()),prefer="resolution=merge-duplicates,return=representation").asJsonArray
        check(result.size()==1 && result[0].asJsonObject.value("parcel_id")==id) { "Consent was not saved. Please refresh and try again." }
    }
    suspend fun saveOwner(parcel: String, owner: String, fields: Map<String,String>) { val r=json("/functions/v1/owner-details","POST",mapOf("parcel_id" to parcel,"owner_id" to owner,"details" to fields)).asJsonObject; check(r.value("saved")=="true") { "Owner details were not saved." } }
    suspend fun saveWorkflow(parcel: String, stage: String, category: String, target: String) {
        require(stage in stageLabels); if(target.isNotBlank()) java.time.LocalDate.parse(target)
        val r=json("/rest/v1/acquisition_cases?on_conflict=parcel_id&select=parcel_id", "POST",mapOf("parcel_id" to parcel,"acquisition_stage" to stage,"category" to category.ifBlank{null},"target_date" to target.ifBlank{null}),prefer="resolution=merge-duplicates,return=representation").asJsonArray
        check(r.size()==1) { "Workflow changes were not saved." }
    }
    suspend fun saveLand(parcel: String, oldNumber: String, area: String, bunch: String) {
        val acreage=area.takeIf{it.isNotBlank()}?.toDoubleOrNull(); require(area.isBlank() || (acreage!=null && acreage.isFinite() && acreage>=0)) { "Enter a valid area in acres." }
        val r=json("/rest/v1/parcels?id=eq."+encode(parcel)+"&select=id","PATCH",mapOf("old_survey_number" to oldNumber.ifBlank{null},"acreage" to acreage,"bunch_number" to bunch.ifBlank{null}),prefer="return=representation").asJsonArray
        check(r.size()==1) { "Survey changes were not saved." }
    }
    suspend fun saveLegal(parcel: String, remarks: String) { val r=json("/rest/v1/legal_reviews?on_conflict=parcel_id&select=parcel_id","POST",mapOf("parcel_id" to parcel,"legal_remarks" to remarks.ifBlank{null}),prefer="resolution=merge-duplicates,return=representation").asJsonArray; check(r.size()==1) { "Legal notes were not saved." } }
    suspend fun comments(parcel: String): List<Comment> = json("/rest/v1/survey_comments?select=id,user_id,body,author_name,created_at&parcel_id=eq."+encode(parcel)+"&order=created_at.desc&limit=100").asJsonArray.map { gson.fromJson(it,Comment::class.java) }
    suspend fun addComment(parcel: String, body: String) { require(body.isNotBlank() && body.length<=4000) { "Use 1 to 4,000 characters." }; json("/rest/v1/survey_comments","POST",mapOf("parcel_id" to parcel,"user_id" to (session?.user_id ?: throw AuthExpired()),"body" to body.trim())) }
    suspend fun deleteComment(id: String) { json("/rest/v1/survey_comments?id=eq."+encode(id),"DELETE") }
    suspend fun accounts(): List<Account> = json("/functions/v1/manage-users").asJsonObject.items("users")
    suspend fun manage(input: Map<String,String>) { json("/functions/v1/manage-users","POST",input) }
    suspend fun driveConnected(): Boolean = json("/functions/v1/drive-connection-status").asJsonObject.value("connected")=="true"
    suspend fun driveConnectUrl(): String = json("/functions/v1/drive-oauth-start","POST",emptyMap<String,String>()).asJsonObject.value("authorize_url").also { require(it.startsWith("https://accounts.google.com/")) { "Google sign-in URL is invalid." } }
    suspend fun folderProgress(): JsonObject = json("/functions/v1/drive-folder-setup").asJsonObject
    suspend fun folderSetup(repair: Boolean): JsonObject = json("/functions/v1/drive-folder-setup","POST",if(repair) mapOf("action" to "repair_existing") else emptyMap<String,String>()).asJsonObject
    suspend fun driveFiles(parcel: String, folders: List<String>, page: String? = null): DriveListing {
        var query="parcel_id="+encode(parcel)
        if(folders.isNotEmpty()) query+="&folder_id="+encode(folders.last())+"&folder_path="+encode(gson.toJson(folders))
        if(page!=null) query+="&page_token="+encode(page)
        return gson.fromJson(json("/functions/v1/drive-files?$query"),DriveListing::class.java)
    }
    suspend fun linkFile(parcel: String, code: String, file: String, owner: String?, path: List<String>) { json("/functions/v1/drive-files","POST",mapOf("parcel_id" to parcel,"document_type_code" to code,"file_id" to file,"owner_id" to owner,"folder_path" to path)) }
    suspend fun upload(parcel: String, code: String, owner: String?, name: String, mime: String, bytes: ByteArray) {
        require(bytes.isNotEmpty() && bytes.size<=15*1024*1024) { "Choose a file up to 15 MB." }; require(code in documentLabels)
        val form=MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("parcel_id",parcel).addFormDataPart("document_type_code",code).addFormDataPart("file",safeFilename(name),bytes.toRequestBody(mime.toMediaType()))
        if(owner!=null) form.addFormDataPart("owner_id",owner)
        val bearer=token()
        withContext(Dispatchers.IO) { client.newCall(request("/functions/v1/drive-upload",bearer,"POST",form.build())).execute().use { r -> if(!r.isSuccessful) throw error(r); val data=JsonParser.parseString(r.body!!.string()).asJsonObject; require(data.value("document_id").isNotBlank()) { "Upload could not be confirmed." } } }
    }
    private suspend fun download(path: String, targetDir: File, suggested: String): Pair<File,String> = withContext(Dispatchers.IO) {
        response(path).use { r ->
            val mime=r.header("Content-Type")?.substringBefore(';') ?: "application/octet-stream"
            val name=r.header("Content-Disposition")?.let { Regex("filename=\"?([^\";]+)").find(it)?.groupValues?.get(1) } ?: suggested
            targetDir.mkdirs(); val file=File(targetDir,UUID.randomUUID().toString()+"-"+safeFilename(name))
            try { r.body!!.byteStream().use { input -> file.outputStream().use { out -> val buffer=ByteArray(8192); var total=0L; while(true) { val n=input.read(buffer); if(n<0) break; total+=n; require(total<=30*1024*1024) { "This download is too large." }; out.write(buffer,0,n) } } }; require(file.length()>0) { "The downloaded file is empty." }; file to mime } catch(e: Exception) { file.delete(); throw e }
        }
    }
    suspend fun document(id: String, dir: File, name: String): Pair<File,String> = download("/functions/v1/drive-document?document_id="+encode(id),dir,name)
    suspend fun patel(village: String, consent: String, stage: String, dir: File): Pair<File,String> = download("/functions/v1/patel-report?village="+encode(village)+"&consent="+encode(consent)+"&stage="+encode(stage),dir,"patel-infra-report.xlsx")
}
