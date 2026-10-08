package com.bhachunda.erp

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import java.io.File
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class UploadTarget(val parcel: String, val code: String, val owner: String?)
data class UiState(
    val initialLoading: Boolean = true, val profile: Profile? = null, val email: String = "", val signedIn: Boolean = false,
    val parcels: List<Parcel> = emptyList(), val statuses: List<MapStatus> = emptyList(), val definitions: List<MapDefinition> = emptyList(), val links: List<MapLink> = emptyList(),
    val tab: String = "home", val screen: String? = null, val selectedId: String? = null, val detail: JsonObject? = null, val detailLoading: Boolean = false,
    val busy: Boolean = false, val error: String? = null, val message: String? = null, val connected: Boolean = false, val syncedAt: String = "", val driveConnected: Boolean? = null,
    val comments: List<Comment> = emptyList(), val accounts: List<Account> = emptyList(), val listing: DriveListing? = null, val folderPath: List<String> = emptyList(),
    val documentCode: String = "consent_letter", val ownerId: String? = null, val ownerName: String = "", val preview: Pair<File,String>? = null, val previewTitle: String = "", val progress: JsonObject? = null,
    val generatedForms:List<FormDraft> = emptyList(),val formFields:FormFields?=null,val formDraft:FormDraft?=null,val formId:String=""
)
class ErpViewModel(application: Application): AndroidViewModel(application) {
    val api = ErpApi(SecureSessionStore(application))
    private val mutable = MutableStateFlow(UiState(signedIn=api.session!=null,email=api.session?.email.orEmpty()))
    val ui: StateFlow<UiState> = mutable.asStateFlow()
    private val refreshLock=Mutex()
    private var polling: Job?=null
    private var detailJob: Job?=null
    private var epoch=0
    private var refreshTick=0
    private val sharedDir=File(application.cacheDir,"shared")
    var uploadTarget: UploadTarget?=null
    init { sharedDir.deleteRecursively(); sharedDir.mkdirs(); viewModelScope.launch { refresh() } }
    private fun change(block: (UiState)->UiState) { mutable.update(block) }
    fun notice(message: String?=null,error: String?=null) { change { it.copy(message=message,error=error) } }
    fun foreground(active: Boolean) {
        polling?.cancel(); polling=null
        if(active) polling=viewModelScope.launch { while(isActive) { refresh(); delay(5000) } }
    }
    private fun clearAccess(profile: Profile?=null) {
        epoch++; detailJob?.cancel(); uploadTarget=null; sharedDir.deleteRecursively(); sharedDir.mkdirs()
        change { UiState(initialLoading=false,profile=profile,email=api.session?.email.orEmpty(),signedIn=api.session!=null,connected=it.connected,error=it.error,message=it.message) }
    }
    suspend fun refresh() {
        if(!refreshLock.tryLock()) return
        val startedEpoch=epoch
        try {
            if(api.session==null) { change { it.copy(initialLoading=false,signedIn=false) }; return }
            val profile=api.profile()
            if(startedEpoch!=epoch || api.session==null) return
            if(!profile.approved) { clearAccess(profile); return }
            val prior=mutable.value.profile
            if(prior!=null && (prior.role!=profile.role || prior.approved!=profile.approved)) clearAccess(profile)
            val generation=epoch
            val previousSelection=mutable.value.parcels.find{it.id==mutable.value.selectedId}
            val (parcels,statuses)=coroutineScope { val rows=async{api.parcels()}; val map=async{api.mapStatuses()}; rows.await() to map.await() }
            if(generation!=epoch || api.session==null) return
            change { it.copy(initialLoading=false,profile=profile,signedIn=true,email=api.session?.email.orEmpty(),parcels=parcels,statuses=statuses,connected=true,syncedAt=LocalTime.now(ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ofPattern("HH:mm:ss"))) }
            if(mutable.value.definitions.isEmpty()) { val definitions=api.mapDefinitions(); val links=api.mapLinks(); if(generation==epoch) change{it.copy(definitions=definitions,links=links)} }
            if(profile.canEdit && mutable.value.driveConnected==null) { val connected=runCatching { api.driveConnected() }.getOrDefault(false); if(generation==epoch) change{it.copy(driveConnected=connected)} }
            refreshTick++
            val state=mutable.value
            if(!state.busy&&profile.canEdit&&state.screen in setOf("generatedForms","generatedForm")&&refreshTick%3==0) { val forms=api.generatedForms();if(generation==epoch)change{it.copy(generatedForms=forms)} }
            if(!state.busy && state.screen in setOf("detail","documents") && state.selectedId!=null && detailJob?.isActive!=true && (previousSelection!=parcels.find{it.id==state.selectedId} || refreshTick%3==0)) loadDetail(state.selectedId,false)
        } catch(e: CancellationException) { throw e }
        catch(e: AuthExpired) { if(startedEpoch==epoch) { api.signOut(); clearAccess(); notice(error=e.message) } }
        catch(e: Exception) { change { it.copy(initialLoading=false,connected=false,error=if(it.initialLoading) e.message ?: "Could not connect to the ERP." else it.error) } }
        finally { refreshLock.unlock() }
    }
    fun refreshNow() { viewModelScope.launch { refresh(); mutable.value.selectedId?.let { loadDetail(it) } } }
    fun auth(mode: String, name: String, email: String, password: String) = action {
        when(mode) {
            "create" -> { api.createAccount(name,email,password); notice(message="Account request sent. Verify your email, then wait for administrator approval.") }
            "reset" -> { api.resetPassword(email); notice(message="If the address is registered, a reset link will be sent. Check your inbox and spam folder.") }
            else -> { api.signIn(email,password); change{it.copy(signedIn=true,email=email.trim(),profile=null,initialLoading=true)}; refresh(); foreground(true) }
        }
    }
    fun signOut() {
        polling?.cancel(); clearAccess(); change { UiState(initialLoading=false) }
        viewModelScope.launch { api.signOut(); clearAccess(); change { UiState(initialLoading=false) } }
    }
    private fun action(block: suspend ()->Unit) {
        if(mutable.value.busy) return
        viewModelScope.launch {
            change{it.copy(busy=true,error=null,message=null)}
            try { block() } catch(e: CancellationException) { throw e } catch(e: AuthExpired) { clearAccess(); notice(error=e.message) } catch(e: Exception) { notice(error=e.message ?: "Could not finish this action. Please try again.") }
            finally { change{it.copy(busy=false)} }
        }
    }
    fun tab(tab: String) { if(!mutable.value.busy) change{it.copy(tab=tab,screen=null,preview=null)} }
    fun screen(screen: String?) { change{it.copy(screen=screen,error=null,message=null)} }
    fun back() {
        if(mutable.value.busy) return
        when(mutable.value.screen) { "generatedForm" -> screen("generatedForms"); "consent","documents","owner","preview" -> screen("detail"); "driveBrowser" -> screen("documents"); "detail" -> screen(null); else -> screen(null) }
    }
    fun choose(id: String, screen: String = "detail") { if(mutable.value.busy) return; change{it.copy(selectedId=id,detail=null,comments=emptyList(),screen=screen,detailLoading=true,error=null,message=null)}; loadDetail(id) }
    private fun loadDetail(id: String,showLoading: Boolean=true) {
        detailJob?.cancel(); val generation=epoch
        detailJob=viewModelScope.launch {
            if(showLoading) change{it.copy(detailLoading=true)}
            try {
                val detail=api.detail(id); val comments=api.comments(id)
                if(generation==epoch && mutable.value.selectedId==id) change{it.copy(detail=detail,comments=comments)}
            } catch(e: CancellationException) { throw e } catch(e: AuthExpired) { clearAccess(); notice(error=e.message) } catch(e: Exception) { if(generation==epoch) notice(error=e.message) }
            finally { if(generation==epoch && mutable.value.selectedId==id) change{it.copy(detailLoading=false)} }
        }
    }
    private fun editor() { check(mutable.value.profile?.canEdit==true && mutable.value.connected) { "An approved Editor or Administrator account and an internet connection are required." } }
    fun generatedForms() = action { editor();val generation=epoch;val forms=api.generatedForms();if(generation==epoch)change{it.copy(generatedForms=forms,screen="generatedForms")} }
    fun generateForSurvey(id:String) = action {
        editor();val generation=epoch;val detail=api.detail(id)
        if(generation==epoch)change{it.copy(selectedId=id,formFields=prefillForm(detail),formDraft=null,formId=java.util.UUID.randomUUID().toString(),screen="generatedForm")}
    }
    fun editGeneratedForm(draft:FormDraft) { if(mutable.value.busy||mutable.value.profile?.canEdit!=true)return;change{it.copy(selectedId=draft.parcel_id,formDraft=draft,formFields=draft.fields,formId=draft.id,screen="generatedForm")} }
    fun formFields(fields:FormFields) { if(!mutable.value.busy)change{it.copy(formFields=fields)} }
    fun saveGeneratedForm() = action {
        editor();val state=mutable.value;val generation=epoch;check(state.formDraft?.state!="archived"){"Restore this draft before editing."}
        val draft=api.saveGeneratedForm(state.selectedId ?: error("Choose a survey."),state.formFields ?: error("Enter form details."),state.formId,state.formDraft)
        if(generation!=epoch)return@action
        val forms=api.generatedForms();if(generation==epoch){change{it.copy(formFields=draft.fields,formDraft=draft,generatedForms=forms)};notice(message="Draft saved. Owner consent has not been recorded.")}
    }
    fun archiveGeneratedForm(draft:FormDraft) = action { editor();val generation=epoch;val updated=api.archiveGeneratedForm(draft);val forms=api.generatedForms();if(generation==epoch){change{it.copy(generatedForms=forms,formDraft=if(it.formDraft?.id==draft.id)updated else it.formDraft)};notice(message="Draft list updated. Received consent is unchanged.")} }
    fun generatedFormPdf(draft:FormDraft,upload:Boolean=false,onFile:(File,String)->Unit={_,_->}) = action {
        editor();check(!upload||draft.state=="draft"){"Restore the draft before uploading."};val generation=epoch
        val current=api.generatedForms().find{it.id==draft.id} ?: error("This draft is unavailable.")
        check(current.revision==draft.revision){"This draft changed. Open the latest form before generating a PDF."}
        val file=withContext(Dispatchers.IO){generateFormPdf(getApplication(),draft,File(sharedDir,"${java.util.UUID.randomUUID()}-Consent-draft-${safeFilename(draft.fields.village_en)}-${safeFilename(draft.fields.survey_number)}.pdf"))}
        if(generation!=epoch){file.delete();return@action}
        if(upload) {
            api.upload(draft.parcel_id,generatedFormDocumentCode,null,file.name,"application/pdf",withContext(Dispatchers.IO){file.readBytes()},draft)
            val forms=api.generatedForms();if(generation==epoch){change{it.copy(generatedForms=forms,formDraft=if(it.formDraft?.id==draft.id)forms.find{f->f.id==draft.id} else it.formDraft)};notice(message="Unsigned PDF saved to Drive. Consent status is unchanged.")}
        } else onFile(file,"application/pdf")
    }
    fun generatedFormsCsv(rows:List<FormDraft>,onFile:(File,String)->Unit) = action {
        editor();val generation=epoch;val file=withContext(Dispatchers.IO){File(sharedDir,"${java.util.UUID.randomUUID()}-Generated-consent-forms.csv").apply{writeText("\uFEFF"+(listOf(listOf("Draft ID","Village","Survey","Form date","Owners","Mobile","Form state","Revision"))+rows.map{listOf(it.id,it.fields.village_en,it.fields.survey_number,it.fields.date,it.fields.owners.joinToString("; "),it.fields.mobile,it.state,it.revision.toString())}).joinToString("\r\n"){it.joinToString(","){csvCell(it)}})}}
        if(generation==epoch)onFile(file,"text/csv") else file.delete()
    }
    private fun admin() { check(mutable.value.profile?.isAdmin==true && mutable.value.connected) { "Administrator access is required." } }
    fun consent(draft: ConsentDraft) = action { editor(); val state=mutable.value; val id=state.selectedId ?: error("Select a survey."); val current=api.detail(id).obj("consent"); check(current==state.detail?.obj("consent")) { "This consent changed while you were editing. Refresh the record before saving." }; api.consent(id,draft); refresh(); loadDetail(id); screen("detail"); notice(message="Consent saved. The map and web ERP will show the same status.") }
    fun owner(id: String,name: String) { change{it.copy(ownerId=id,ownerName=name,screen="owner")} }
    fun saveOwner(fields: Map<String,String>) = action { editor(); val state=mutable.value; val id=state.selectedId ?: error("Choose a survey."); api.saveOwner(id,state.ownerId ?: error("Choose an owner."),fields); loadDetail(id); screen("detail"); notice(message="Owner details saved.") }
    fun workflow(stage: String,category: String,target: String) = action { editor(); val id=mutable.value.selectedId ?: error("Choose a survey."); api.saveWorkflow(id,stage,category,target); refresh(); loadDetail(id); notice(message="Workflow saved.") }
    fun land(old: String,area: String,bunch: String) = action { editor(); val id=mutable.value.selectedId ?: error("Choose a survey."); api.saveLand(id,old,area,bunch); refresh(); loadDetail(id); notice(message="Survey details saved.") }
    fun legal(remarks: String) = action { editor(); val id=mutable.value.selectedId ?: error("Choose a survey."); api.saveLegal(id,remarks); loadDetail(id); notice(message="Legal notes saved.") }
    fun comment(body: String,onSaved: ()->Unit={}) = action { check(mutable.value.profile?.canComment==true); val id=mutable.value.selectedId ?: error("Choose a survey."); api.addComment(id,body); onSaved(); notice(message="Note added."); val comments=api.comments(id); change{it.copy(comments=comments)} }
    fun deleteComment(id: String) = action { api.deleteComment(id); mutable.value.selectedId?.let { parcel -> val comments=api.comments(parcel); change{it.copy(comments=comments)} } }
    fun prepareUpload(code: String,owner: String?): Boolean { return runCatching { editor(); val id=mutable.value.selectedId ?: error("Choose a survey."); uploadTarget=UploadTarget(id,code,owner); true }.getOrElse { notice(error=it.message); false } }
    fun upload(uri: Uri) = action {
        editor(); val target=uploadTarget ?: error("Select a document category again."); uploadTarget=null
        val resolver=getApplication<Application>().contentResolver
        val (name,mime,bytes)=withContext(Dispatchers.IO) {
            var filename="document"
            resolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE),null,null,null)?.use { cursor -> if(cursor.moveToFirst()) { val index=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if(index>=0) filename=cursor.getString(index); val size=cursor.getColumnIndex(OpenableColumns.SIZE); if(size>=0 && !cursor.isNull(size)) require(cursor.getLong(size)<=15*1024*1024) { "Choose a file up to 15 MB." } } }
            val bytes=resolver.openInputStream(uri)?.use { input -> val out=java.io.ByteArrayOutputStream(); val buffer=ByteArray(8192); while(true) { val n=input.read(buffer); if(n<0) break; require(out.size()+n<=15*1024*1024) { "Choose a file up to 15 MB." }; out.write(buffer,0,n) }; out.toByteArray() } ?: error("The file cannot be read.")
            Triple(filename,resolver.getType(uri) ?: "application/octet-stream",bytes)
        }
        api.upload(target.parcel,target.code,target.owner,name,mime,bytes); refresh(); if(mutable.value.selectedId==target.parcel) loadDetail(target.parcel); notice(message="Uploaded to the matching Google Drive folder. Consent status is unchanged.")
    }
    fun openDocument(document: Document) = action {
        check(document.can_view && document.id!=null) { "You do not have access to this file." }; val generation=epoch
        val preview=api.document(document.id!!,sharedDir,document.original_filename ?: "document")
        if(generation!=epoch) { preview.first.delete(); return@action }
        change{it.copy(preview=preview,previewTitle=document.original_filename ?: "Document",screen="preview")}
    }
    fun accounts() = action { admin(); val accounts=api.accounts(); change{it.copy(accounts=accounts,screen="team")} }
    fun manage(fields: Map<String,String>) = action { admin(); api.manage(fields); val accounts=api.accounts(); change{it.copy(accounts=accounts)}; notice(message=if(fields["action"]=="invite") "Invitation requested. Access stays pending until approval." else "User access updated.") }
    fun driveUrl(onUrl: (String)->Unit) = action { admin(); onUrl(api.driveConnectUrl()); change{it.copy(driveConnected=null)} }
    fun driveStatus() = action { editor(); val connected=api.driveConnected(); change{it.copy(driveConnected=connected)} }
    fun folders() = action { admin(); val progress=api.folderProgress(); change{it.copy(progress=progress,screen="folders")} }
    fun setupFolders(repair: Boolean) = action { admin(); val progress=api.folderSetup(repair); change{it.copy(progress=progress)}; notice(message="Folder batch completed. Resume if any remain.") }
    fun browse(code: String,owner: String?) = action { editor(); val id=mutable.value.selectedId ?: error("Choose a survey."); val listing=api.driveFiles(id,emptyList()); change{it.copy(documentCode=code,ownerId=owner,folderPath=emptyList(),listing=listing,screen="driveBrowser")} }
    fun folder(path: List<String>,page: String?=null) = action { val id=mutable.value.selectedId ?: error("Choose a survey."); val listing=api.driveFiles(id,path,page); change{it.copy(folderPath=path,listing=if(page!=null) listing.copy(files=it.listing?.files.orEmpty()+listing.files) else listing)} }
    fun linkFile(file: String) = action { editor(); val state=mutable.value; val id=state.selectedId ?: error("Choose a survey."); api.linkFile(id,state.documentCode,file,state.ownerId,state.folderPath); refresh(); loadDetail(id); screen("documents"); notice(message="Drive file linked. The original file stays in its folder.") }
    fun patel(village: String,consent: String,stage: String,onFile: (File,String)->Unit) = action { admin(); val generation=epoch; val file=api.patel(village,consent,stage,sharedDir); if(generation==epoch) onFile(file.first,file.second) else file.first.delete() }
    fun csv(rows: List<Parcel>,onFile: (File,String)->Unit) = action {
        check(mutable.value.profile?.approved==true)
        val file=File(sharedDir,"bhachunda-survey-report.csv")
        withContext(Dispatchers.IO) { file.writeText("\uFEFF"+listOf("Village,Survey number,Old survey,Area acres,Khata,Consent,Stage,Documents,Verified documents").plus(rows.map { row -> listOf(row.village_name,row.survey_number,row.old_survey_number.orEmpty(),row.acreage?.toString().orEmpty(),row.account_number.orEmpty(),consentLabels[row.consent_status].orEmpty(),stageLabels[row.acquisition_stage].orEmpty(),row.document_count.toString(),row.verified_document_count.toString()).joinToString(",",transform=::csvCell) }).joinToString("\r\n"),Charsets.UTF_8) }; onFile(file,"text/csv")
    }
}

