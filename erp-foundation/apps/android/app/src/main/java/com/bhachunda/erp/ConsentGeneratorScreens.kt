package com.bhachunda.erp

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.io.File

@Composable fun GeneratedFormsScreen(state:UiState,vm:ErpViewModel,onSave:(File,String)->Unit,onShare:(File,String)->Unit,onPrint:(File)->Unit) {
    var search by remember{mutableStateOf("")};var village by remember{mutableStateOf(state.parcels.firstOrNull()?.village_code.orEmpty())}
    val parcels=state.parcels.filter{it.village_code==village}.sortedWith(compareBy<Parcel>{it.survey_number.length}.thenBy{it.survey_number})
    var survey by remember(village){mutableStateOf(parcels.firstOrNull()?.id.orEmpty())}
    val rows=state.generatedForms.filter{listOf(it.fields.village_en,it.fields.survey_number,it.fields.owners.joinToString(" "),it.fields.mobile).joinToString(" ").contains(search,true)}
    ScrollPage {
        Text("Consent generator",style=MaterialTheme.typography.headlineMedium)
        Section { Text("Unsigned generated forms",color=Amber,style=MaterialTheme.typography.titleMedium);Hint("Prepare forms for the owner to sign. Saving, printing or uploading a generated form does not record consent received.") }
        Section("New form") {
            Picker("Village",village,state.parcels.distinctBy{it.village_code}.map{it.village_code to it.village_name},{village=it},!state.busy)
            Picker("Survey number",survey,parcels.map{it.id to it.survey_number},{survey=it},!state.busy)
            Primary("Prepare form",{vm.generateForSurvey(survey)},survey.isNotBlank()&&state.connected&&!state.busy)
        }
        Section("Saved forms") { Field("Search village, survey or owner",search,{search=it});Fact("Generated forms",rows.size.toString());Secondary("Export draft list",{vm.generatedFormsCsv(rows,onSave)},rows.isNotEmpty()&&!state.busy) }
        if(rows.isEmpty()) Hint("No generated forms match this search.")
        rows.forEach { draft -> Section {
            Text("${draft.fields.village_en} · ${draft.fields.survey_number}",style=MaterialTheme.typography.titleMedium)
            Text(if(draft.state=="draft")"Unsigned draft" else "Archived",color=Amber,style=MaterialTheme.typography.labelLarge)
            Fact("Form date",draft.fields.date);Fact("First owner",draft.fields.owners.firstOrNull().orEmpty());Fact("Revision",draft.revision.toString())
            Primary("Open form",{vm.editGeneratedForm(draft)},!state.busy)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) { TextButton(onClick={vm.generatedFormPdf(draft,onFile=onSave)},enabled=state.connected&&!state.busy){Text("Save PDF")};TextButton(onClick={vm.generatedFormPdf(draft,onFile=onShare)},enabled=state.connected&&!state.busy){Text("Share")};TextButton(onClick={vm.generatedFormPdf(draft,onFile={file,_->onPrint(file)})},enabled=state.connected&&!state.busy){Text("Print")} }
            TextButton(onClick={vm.archiveGeneratedForm(draft)},enabled=state.connected&&!state.busy){Text(if(draft.state=="draft")"Archive" else "Restore")}
        } }
    }
}
@Composable fun GeneratedFormScreen(state:UiState,vm:ErpViewModel,onSave:(File,String)->Unit,onShare:(File,String)->Unit,onPrint:(File)->Unit) {
    val fields=state.formFields ?: return Loading("Loading form…")
    val saved=state.formDraft;val enabled=!state.busy&&state.connected;val dirty=saved==null||fields!=saved.fields
    val area=runCatching{formArea(fields.has)}.getOrNull()
    fun change(f:FormFields)=vm.formFields(f)
    ScrollPage {
        Text(if(saved==null)"Generate a consent form" else "Edit generated form",style=MaterialTheme.typography.headlineMedium)
        Section { Text("Unsigned draft",color=Amber,style=MaterialTheme.typography.titleMedium);Hint("Owner signature and verification are pending. This form does not change consent status or map colours.");Fact("Village",fields.village_en);Fact("Survey",fields.survey_number) }
        Section("Land details") {
            DateField("Form date",fields.date,{change(fields.copy(date=it))},enabled)
            Field("Khata number",fields.khata,{change(fields.copy(khata=it))},enabled)
            Field("H.Are.Sq.Mt.",fields.has,{change(fields.copy(has=it))},enabled)
            Hint("Example: 1.60.57. Check the area against the 7/12 record.")
            Fact("Calculated area",area?.let{"${it.acres} acres · ${it.guntha} guntha"} ?: "Enter a valid H.Are.Sq.Mt. area")
            Field("Village — Gujarati",fields.village_gu,{change(fields.copy(village_gu=it))},enabled)
            Field("Taluka",fields.taluka,{change(fields.copy(taluka=it))},enabled)
            Field("District",fields.district,{change(fields.copy(district=it))},enabled)
            Field("Contact mobile",fields.mobile,{change(fields.copy(mobile=it))},enabled,keyboard=androidx.compose.ui.text.input.KeyboardType.Phone)
        }
        Section("7/12 owner names / જમીન માલિકો") {
            fields.owners.forEachIndexed { i,name ->
                Field("Owner ${i+1}",name,{value->change(fields.copy(owners=fields.owners.mapIndexed{j,s->if(i==j)value else s}))},enabled)
                if(fields.owners.size>1)TextButton(onClick={change(fields.copy(owners=fields.owners.filterIndexed{j,_->j!=i}))},enabled=enabled){Text("Remove owner ${i+1}")}
            }
            Secondary("Add owner",{change(fields.copy(owners=fields.owners+""))},enabled&&fields.owners.size<50)
        }
        Primary(if(state.busy)"Working…" else "Save draft",{vm.saveGeneratedForm()},enabled&&area!=null&&saved?.state!="archived")
        if(dirty)Hint("Save these changes before generating a PDF.")
        if(saved!=null) Section("Print and save") {
            Hint("English and Gujarati consent letter, owner signatures and letter-cum-undertaking. Longer owner lists continue on additional pages.")
            Secondary("Save PDF to phone",{vm.generatedFormPdf(saved,onFile=onSave)},enabled&&!dirty)
            Secondary("Share PDF",{vm.generatedFormPdf(saved,onFile=onShare)},enabled&&!dirty)
            Secondary("Print form",{vm.generatedFormPdf(saved,onFile={file,_->onPrint(file)})},enabled&&!dirty)
            Primary("Save unsigned PDF to Drive",{vm.generatedFormPdf(saved,upload=true)},enabled&&!dirty&&saved.state=="draft"&&state.driveConnected==true)
            if(saved.document_id!=null)Hint("An unsigned draft PDF is linked in Documents. Received consent is unchanged.")
        }
    }
}
