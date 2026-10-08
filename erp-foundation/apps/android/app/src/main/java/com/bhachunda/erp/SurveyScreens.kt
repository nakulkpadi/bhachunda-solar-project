package com.bhachunda.erp

import android.app.DatePickerDialog
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.JsonObject
import java.time.LocalDate

@Composable fun OverviewScreen(state: UiState,vm: ErpViewModel) {
    val received=state.parcels.count{it.consent_status=="received"}
    ScrollPage {
        Text("Project overview",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold)
        Hint("Bhavanipar · Bitta · Vandh Timbo")
        Section {
            Row(Modifier.fillMaxWidth()) { Column(Modifier.weight(1f)) { Hint("Consent received");Text(received.toString(),fontSize=40.sp,fontWeight=FontWeight.SemiBold,color=Forest) };Column(Modifier.weight(1f)) { Hint("Total surveys");Text(state.parcels.size.toString(),fontSize=40.sp,fontWeight=FontWeight.SemiBold) } }
            LinearProgressIndicator(progress={if(state.parcels.isEmpty())0f else received.toFloat()/state.parcels.size},modifier=Modifier.fillMaxWidth().height(7.dp),color=Forest,trackColor=Line)
            Hint("${state.parcels.size-received} surveys awaiting received consent")
        }
        if(state.profile?.canEdit==true) Primary("Record consent",{vm.screen("newConsent")},state.connected && !state.busy)
        Section("Village progress") {
            state.parcels.groupBy{it.village_name}.forEach { (village,rows) ->
                val n=rows.count{it.consent_status=="received"}
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) { Text(village,fontWeight=FontWeight.Medium);Text("$n / ${rows.size}",color=Forest,fontWeight=FontWeight.Medium) }
                LinearProgressIndicator(progress={n.toFloat()/rows.size.coerceAtLeast(1)},modifier=Modifier.fillMaxWidth(),trackColor=Line)
            }
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) { Text("Needs follow-up",style=MaterialTheme.typography.titleMedium);TextButton(onClick={vm.tab("surveys")}){Text("View all")} }
        state.parcels.filter{it.consent_status!="received"}.take(5).forEach { row -> ParcelCard(row){vm.choose(row.id)} }
        if(state.parcels.isEmpty()) Empty("No survey records are available to this account.")
    }
}
@Composable fun SurveysScreen(state: UiState,vm: ErpViewModel) {
    var village by remember { mutableStateOf("all") };var consent by remember { mutableStateOf("all") };var search by remember { mutableStateOf("") }
    val rows=state.parcels.filter{(village=="all" || it.village_code==village) && (consent=="all" || it.consent_status==consent) && "${it.survey_number} ${it.old_survey_number.orEmpty()} ${it.account_number.orEmpty()}".contains(search,true)}
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item { Text("Survey register",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold) }
        item { Field("Search survey, old number or Khata",search,{search=it}) }
        item { Picker("Village",village,listOf("all" to "All villages")+state.parcels.distinctBy{it.village_code}.map{it.village_code to it.village_name},{village=it}) }
        item { Picker("Consent",consent,listOf("all" to "All statuses")+consentLabels.toList(),{consent=it}) }
        item { Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) { Hint("${rows.size} surveys");if(state.profile?.canEdit==true) TextButton(onClick={vm.screen("newConsent")},enabled=state.connected&&!state.busy) {Icon(Icons.Outlined.Add,contentDescription=null);Text("Record consent")} } }
        items(rows,key={it.id}) { row -> ParcelCard(row){vm.choose(row.id)} }
        if(rows.isEmpty()) item { Empty("No surveys match your filters.") }
    }
}
@Composable fun NewConsentScreen(state: UiState,vm: ErpViewModel) {
    var village by remember { mutableStateOf("") };var survey by remember { mutableStateOf("") };var query by remember { mutableStateOf("") }
    val rows=state.parcels.filter{it.village_code==village && it.survey_number.contains(query,true)}
    ScrollPage {
        Text("Record consent",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold)
        Hint("Choose a village and survey. Owner and land details will fill automatically.")
        Section {
            Picker("Village",village,listOf("" to "Choose village")+state.parcels.distinctBy{it.village_code}.map{it.village_code to it.village_name},{village=it;survey="";query=""})
            if(village.isNotEmpty()) { Field("Find survey number",query,{query=it});Picker("Survey number",survey,listOf("" to "Choose survey")+rows.map{it.id to it.survey_number},{survey=it}) }
            state.parcels.find{it.id==survey}?.let { row -> Facts(listOf("Village" to row.village_name,"Survey" to row.survey_number,"Area" to acres(row.acreage),"Khata" to row.account_number.orEmpty()));StatusPill(row.consent_status) }
            Primary("Continue to consent",{vm.choose(survey,"consent")},survey.isNotEmpty()&&!state.busy&&state.connected)
        }
    }
}
@Composable fun DetailScreen(state: UiState,vm: ErpViewModel) {
    val detail=state.detail
    if(detail==null) { if(state.detailLoading) Loading("Loading survey details…") else Empty("Survey details could not be loaded. Use refresh to try again.");return }
    val row=state.parcels.find{it.id==state.selectedId}
    var tab by remember(detail.value("id")) { mutableStateOf("Land") }
    ScrollPage {
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Survey ${detail.value("survey_number")}",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold);Hint(detail.obj("village").value("name_en")) };StatusPill(row?.consent_status ?: detail.obj("consent").value("status")) }
        if(state.profile?.canEdit==true) Primary(if(row?.consent_status=="received")"Update consent" else "Record consent",{vm.screen("consent")},state.connected&&!state.busy)
        Secondary("Documents · ${detail.array("documents").size()}",{vm.screen("documents")},!state.busy)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) { listOf("Land","Owners","Legal","Notes").forEach { name -> FilterChip(selected=tab==name,onClick={tab=name},label={Text(name)}) } }
        when(tab) {
            "Land" -> {
                Section("Land register") { Facts(listOf("Old survey" to detail.value("old_survey_number"),"Khata / account" to detail.value("account_number"),"Area" to acres(row?.acreage),"Hectare–are–sq m" to detail.value("hectare_are_sqmt"),"Tenure" to detail.value("tenure"),"Land use" to detail.value("land_use"),"Nondh numbers" to detail.value("nondh_numbers"),"Bunch number" to detail.value("bunch_number")));Fact("Rights & encumbrances",detail.value("rights_and_encumbrances")) }
                Section("Project & acquisition") {
                    val a=detail.obj("acquisition")
                    Facts(listOf("Project" to a.value("project_name"),"SPV" to a.value("spv_name"),"Capacity (MW)" to a.value("mw"),"Purpose" to a.value("acquisition_purpose"),"Stage" to (stageLabels[a.value("acquisition_stage")] ?: a.value("acquisition_stage")),"Category" to a.value("category"),"ATL category" to a.value("atl_category"),"Block" to a.value("block_name"),"Target date" to a.value("target_date"),"Execution date" to a.value("execution_date"),"RTC acres" to a.value("total_acres_in_rtc"),"Acres to acquire" to a.value("total_acres_to_acquire"),"Acres acquired" to a.value("total_acres_acquired"),"Square metres acquired" to a.value("total_sq_meters_acquired"),"Duration (months)" to a.value("project_duration_months")))
                    if(a.value("reason_not_acquired").isNotBlank()) Fact("Reason not acquired",a.value("reason_not_acquired"))
                }
                if(state.profile?.canEdit==true) {
                    Disclosure("Edit acquisition workflow") { WorkflowEditor(detail,state.busy||!state.connected,vm) }
                    Disclosure("Edit survey fields") { LandEditor(detail,state.busy||!state.connected,vm) }
                }
                if(state.profile?.isAdmin==true) Disclosure("Import source details") {
                    Facts(listOf("Workbook" to detail.value("source_workbook"),"Source row" to detail.value("source_row_number")))
                    detail.obj("acquisition").obj("source_fields").entrySet().forEach { (key,value) -> Fact(key,if(value.isJsonNull)"" else value.toString().trim('"')) }
                }
            }
            "Owners" -> {
                val owners=detail.items<Owner>("owners")
                if(owners.isEmpty()) Empty("No owner names were supplied in the register.")
                owners.forEach { owner -> Section {
                    Text(owner.display_name,style=MaterialTheme.typography.titleMedium);Hint(if(owner.is_primary)"Primary owner" else "Owner ${owner.sequence_no ?: ""}")
                    if(state.profile?.canEdit==true) {
                        val privateDetails=detail.array("private_owner_details").map{it.asJsonObject}.find{it.value("owner_id")==owner.id}
                        if(privateDetails!=null) Facts(listOf("Name as per PAN" to privateDetails.value("pan_owner_name"),"PAN number" to privateDetails.value("pan_number"),"Name as per Aadhaar" to privateDetails.value("aadhaar_owner_name"),"Aadhaar number" to privateDetails.value("aadhaar_number"),"Bank account name" to privateDetails.value("bank_owner_name"),"Account number" to privateDetails.value("bank_account_number"),"Bank" to privateDetails.value("bank_name"),"Branch" to privateDetails.value("bank_branch"),"IFSC" to privateDetails.value("ifsc_code"),"Account type" to privateDetails.value("bank_account_type")))
                        Secondary(if(privateDetails==null)"Add identity & bank details" else "Edit identity & bank details",{vm.owner(owner.id,owner.display_name)},state.connected&&!state.busy)
                    }
                } }
            }
            "Legal" -> {
                val legal=detail.obj("legal")
                Section("Legal review") { Facts(listOf("Public notice" to legal.value("public_notice_status"),"SRO search" to legal.value("sro_search_status"),"Documents required" to legal.value("documents_required"),"Documents submitted" to legal.value("documents_submitted"),"Law firm verification" to legal.value("law_firm_verification_status"),"Preliminary TSR" to legal.value("preliminary_tsr_status"),"Conditional clearance" to legal.value("conditional_clearance_status"),"NFA number" to legal.value("nfa_number"),"NFA submitted" to legal.value("nfa_submitted_on"),"NFA approved" to legal.value("nfa_approved_on")));Fact("Pending documents",legal.value("pending_documents"));Fact("Legal remarks",legal.value("legal_remarks")) }
                if(state.profile?.canEdit==true) Disclosure("Edit legal remarks") { var remarks by remember(detail.value("id")) {mutableStateOf(legal.value("legal_remarks"))};Field("Legal remarks",remarks,{remarks=it},!state.busy,multiline=true);Primary("Save legal remarks",{vm.legal(remarks)},state.connected&&!state.busy) }
            }
            "Notes" -> {
                if(state.profile?.canComment==true) Section("Add a note") { var text by remember {mutableStateOf("")};Field("Survey note",text,{text=it},!state.busy,multiline=true);Primary("Add note",{vm.comment(text);text=""},text.isNotBlank()&&text.length<=4000&&state.connected&&!state.busy) }
                state.comments.forEach { comment -> Section { Text(comment.body);Hint("${comment.author_name ?: "Project member"} · ${comment.created_at.take(10)}");if(comment.user_id==vm.api.session?.user_id || state.profile?.isAdmin==true) TextButton(onClick={vm.deleteComment(comment.id)},enabled=!state.busy&&state.connected) {Text("Delete note")} } }
                if(state.comments.isEmpty()) Hint("No notes have been added to this survey.")
            }
        }
    }
}
@Composable private fun WorkflowEditor(detail: JsonObject,disabled: Boolean,vm: ErpViewModel) {
    val a=detail.obj("acquisition"); var stage by remember {mutableStateOf(a.value("acquisition_stage").ifBlank{"identified"})};var category by remember{mutableStateOf(a.value("category"))};var target by remember{mutableStateOf(a.value("target_date"))}
    Picker("Acquisition stage",stage,stageLabels.toList(),{stage=it},!disabled);Field("Category",category,{category=it},!disabled);DateField("Target date",target,{target=it},!disabled);Primary("Save workflow",{vm.workflow(stage,category,target)},!disabled)
}
@Composable private fun LandEditor(detail: JsonObject,disabled: Boolean,vm: ErpViewModel) {
    var old by remember{mutableStateOf(detail.value("old_survey_number"))};var area by remember{mutableStateOf(detail.value("acreage"))};var bunch by remember{mutableStateOf(detail.value("bunch_number"))}
    Field("Old survey number",old,{old=it},!disabled);Field("Area in acres",area,{area=it},!disabled,keyboard=KeyboardType.Decimal);Field("Bunch number",bunch,{bunch=it},!disabled);Primary("Save survey fields",{vm.land(old,area,bunch)},!disabled)
}
@Composable fun DateField(label: String,value: String,onChange: (String)->Unit,enabled: Boolean=true) {
    val context=LocalContext.current;val date=runCatching{LocalDate.parse(value)}.getOrDefault(LocalDate.parse(today()))
    OutlinedTextField(value=value,onValueChange={},readOnly=true,label={Text(label)},enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(12.dp),trailingIcon={IconButton(onClick={DatePickerDialog(context,{_,y,m,d->onChange(LocalDate.of(y,m+1,d).toString())},date.year,date.monthValue-1,date.dayOfMonth).show()},enabled=enabled){Icon(Icons.Outlined.CalendarMonth,contentDescription="Choose date")}})
}
@Composable fun ConsentScreen(state: UiState,vm: ErpViewModel) {
    val detail=state.detail
    if(detail==null) { if(state.detailLoading) Loading("Loading default survey details…") else Empty("Survey details could not be loaded. Refresh before entering consent.");return }
    val consent=detail.obj("consent");val raw=consent.value("remarks");val reference=Regex("^Reference: ([^\\n]*)\\n?").find(raw)
    var status by remember(detail.value("id")){mutableStateOf("received")};var date by remember(detail.value("id")){mutableStateOf(consent.value("received_on").ifBlank{today()})};var ref by remember(detail.value("id")){mutableStateOf(reference?.groupValues?.get(1).orEmpty())};var remarks by remember(detail.value("id")){mutableStateOf(if(reference!=null)raw.removePrefix(reference.value) else raw)}
    val enabled=!state.busy&&state.connected&&state.profile?.canEdit==true
    ScrollPage {
        Text(if(consent.value("status")=="received")"Update consent" else "Record consent",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold)
        Section("Filled from the land register") { Facts(listOf("Village" to detail.obj("village").value("name_en"),"Survey number" to detail.value("survey_number"),"Khata" to detail.value("account_number"),"Area (acres)" to detail.value("acreage"),"Old survey" to detail.value("old_survey_number")));Fact("Owner / farmer",detail.items<Owner>("owners").joinToString(", "){it.display_name});StatusPill(consent.value("status")) }
        Section("Consent entry") { Picker("Consent status",status,consentLabels.toList(),{status=it},enabled);DateField("Received date",date,{date=it},enabled&&status=="received") }
        Disclosure("Reference and remarks · optional") { Field("Letter / reference number",ref,{ref=it.take(500)},enabled);Field("Remarks",remarks,{remarks=it.take(10000)},enabled,multiline=true) }
        Hint("Only received consent turns the linked map boundary green. Uploading a document leaves consent unchanged.")
        Primary(if(state.busy)"Saving…" else "Save consent",{vm.consent(ConsentDraft(status,date,ref,remarks))},enabled)
        Secondary("Attach or view documents",{vm.screen("documents")},!state.busy)
    }
}
@Composable fun OwnerScreen(state: UiState,vm: ErpViewModel) {
    val detail=state.detail ?: return
    val saved=detail.array("private_owner_details").map{it.asJsonObject}.find{it.value("owner_id")==state.ownerId} ?: JsonObject()
    val labels=linkedMapOf("pan_owner_name" to "Name as per PAN card","pan_number" to "PAN number","aadhaar_owner_name" to "Name as per Aadhaar","aadhaar_number" to "Aadhaar number","bank_owner_name" to "Name as per bank account","bank_account_number" to "Bank account number","bank_branch" to "Branch","ifsc_code" to "IFSC code","bank_name" to "Bank name")
    val fields=remember(state.ownerId) { mutableStateMapOf<String,String>().apply { labels.keys.forEach{put(it,saved.value(it))};put("bank_account_type",saved.value("bank_account_type")) } }
    ScrollPage {
        Text(state.ownerName,style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.SemiBold);Hint("Identity and bank details · Survey ${detail.value("survey_number")}")
        Section("Identity") { labels.toList().take(4).forEach { (key,label) -> Field(label,fields[key].orEmpty(),{fields[key]=if(key=="pan_number")it.uppercase().take(10) else if(key=="aadhaar_number")it.take(14) else it},!state.busy,keyboard=if(key=="aadhaar_number")KeyboardType.Number else KeyboardType.Text) } }
        Section("Bank account") { labels.toList().drop(4).forEach { (key,label) -> Field(label,fields[key].orEmpty(),{fields[key]=if(key=="ifsc_code")it.uppercase().take(11) else it},!state.busy,keyboard=if(key=="bank_account_number")KeyboardType.Number else KeyboardType.Text) };Picker("Account type",fields["bank_account_type"].orEmpty(),listOf("" to "Choose type","SB" to "Savings (SB)","CA" to "Current (CA)","OD" to "Overdraft (OD)","CC" to "Cash credit (CC)"),{fields["bank_account_type"]=it},!state.busy) }
        Primary(if(state.busy)"Saving…" else "Save owner details",{vm.saveOwner(fields.toMap())},state.connected&&!state.busy&&state.profile?.canEdit==true)
        Hint("Details are stored for this owner. Attach their PAN, Aadhaar and bank files in Documents.")
    }
}
