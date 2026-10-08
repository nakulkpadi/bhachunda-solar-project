package com.bhachunda.erp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

@Composable fun DocumentsScreen(state: UiState,vm: ErpViewModel) {
    val detail=state.detail ?: return
    var code by remember(detail.value("id")) { mutableStateOf("consent_letter") };var owner by remember(detail.value("id")) { mutableStateOf("") }
    val owners=detail.items<Owner>("owners")
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if(uri!=null) vm.upload(uri) }
    val isKyc=code in kycCodes
    val docs=detail.items<Document>("documents").filter{it.document_type_code==code && (!isKyc || (owner.isNotBlank()&&it.owner_id==owner))}
    val canEdit=state.profile?.canEdit==true
    ScrollPage {
        Text("Documents",style=MaterialTheme.typography.headlineMedium)
        Hint("${detail.obj("village").value("name_en")} · Survey ${detail.value("survey_number")}")
        Section {
            Picker("Document category",code,documentLabels.filterKeys{canEdit || it !in kycCodes}.toList(),{code=it})
            if(isKyc) Picker("Owner",owner,listOf("" to "Choose owner")+owners.map{it.id to it.display_name},{owner=it},!state.busy)
            if(canEdit) {
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) { Icon(if(state.driveConnected==true)Icons.Outlined.CloudDone else Icons.Outlined.CloudOff,contentDescription=null,tint=if(state.driveConnected==true)Forest else Muted);Hint(if(state.driveConnected==true)"Google Drive connected" else "Google Drive connection unavailable") }
                Primary(if(state.busy)"Working…" else "Upload ${documentLabels[code]}",{if(vm.prepareUpload(code,if(isKyc)owner else null)) picker.launch(arrayOf("application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))},!state.busy&&state.connected&&state.driveConnected==true&&(!isKyc || owner.isNotBlank()))
                Secondary("Link an existing Drive file",{vm.browse(code,if(isKyc)owner else null)},!state.busy&&state.connected&&state.driveConnected==true&&(!isKyc || owner.isNotBlank()))
                Hint("PDF, JPG, PNG, DOCX or XLSX · up to 15 MB. Files go to this survey’s matching document folder.")
            }
        }
        Text("Attached files",style=MaterialTheme.typography.titleMedium)
        if(isKyc&&owner.isBlank()) Hint("Select an owner to see their documents.") else if(docs.isEmpty()) Section { Hint("No ${documentLabels[code]?.lowercase()} is attached.") }
        docs.forEach { doc -> Section {
            Icon(Icons.Outlined.Description,contentDescription=null,tint=Forest)
            Text(doc.original_filename ?: documentLabels[code].orEmpty(),style=MaterialTheme.typography.titleMedium)
            Hint("${doc.status.replace('_',' ')}${doc.created_at?.take(10)?.let{" · $it"}.orEmpty()}")
            Secondary(if(doc.can_view)"Open document" else "Restricted document",{vm.openDocument(doc)},doc.can_view&&doc.id!=null&&state.connected&&!state.busy)
        } }
        Hint("Adding or linking a file does not mark consent as received.")
    }
}
@Composable fun DriveBrowserScreen(state: UiState,vm: ErpViewModel) {
    var selected by remember {mutableStateOf<DriveItem?>(null)}
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item { Text("Existing Drive files",style=MaterialTheme.typography.headlineSmall);Hint("Link ${documentLabels[state.documentCode]}") }
        item { Row { TextButton(onClick={vm.folder(emptyList())},enabled=!state.busy){Text("Project root")}; if(state.folderPath.isNotEmpty()) TextButton(onClick={vm.folder(state.folderPath.dropLast(1))},enabled=!state.busy){Text("Up one folder")} };Text(state.listing?.folder_name.orEmpty(),style=MaterialTheme.typography.titleMedium) }
        items(state.listing?.files.orEmpty(),key={it.id}) { file -> Section {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) { Icon(if(file.is_folder)Icons.Outlined.Folder else Icons.Outlined.Description,contentDescription=null,tint=Forest);Text(file.name,modifier=Modifier.weight(1f)) }
            if(file.is_folder) Secondary("Open folder",{vm.folder(state.folderPath+file.id)},!state.busy) else Secondary(if(file.can_attach)"Link this file" else "Unsupported or over 15 MB",{selected=file},file.can_attach&&!state.busy)
        } }
        state.listing?.next_page_token?.let { page -> item { Secondary("Load more files",{vm.folder(state.folderPath,page)},!state.busy) } }
        if(state.listing?.files?.isEmpty()==true) item {Hint("This folder is empty.")}
    }
    selected?.let { file -> AlertDialog(onDismissRequest={selected=null},title={Text("Link this file?")},text={Text("${file.name}\n\nCategory: ${documentLabels[state.documentCode]}\nSurvey: ${state.detail?.value("survey_number")}\n\nThe original file stays in Google Drive.")},confirmButton={TextButton(onClick={selected=null;vm.linkFile(file.id)},enabled=!state.busy){Text("Link file")}},dismissButton={TextButton(onClick={selected=null}){Text("Cancel")}}) }
}
@Composable fun DocumentPreviewScreen(state: UiState,onShare: (File,String)->Unit,onSave: (File,String)->Unit) {
    val preview=state.preview ?: return;val file=preview.first;val mime=preview.second
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)) { TextButton(onClick={onSave(file,mime)}){Text("Save to phone")};TextButton(onClick={onShare(file,mime)}){Text("Share / open with")} }
        when {
            mime=="application/pdf" || file.extension.equals("pdf",true) -> PdfPreview(file)
            mime.startsWith("image/") -> ImagePreview(file)
            else -> Section(modifier=Modifier.padding(18.dp)) { Text(state.previewTitle);Hint("Use Share / open with to view this file in a compatible app.") }
        }
    }
}
@Composable private fun ImagePreview(file: File) {
    val bitmap by produceState<Bitmap?>(null,file) { value=withContext(Dispatchers.IO) { val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeFile(file.path,bounds); val options=BitmapFactory.Options().apply{inSampleSize=maxOf(1,maxOf(bounds.outWidth,bounds.outHeight)/1600)};BitmapFactory.decodeFile(file.path,options) } }
    if(bitmap==null) Loading("Opening image…") else Image(bitmap!!.asImageBitmap(),contentDescription="Attached document",modifier=Modifier.fillMaxSize().padding(12.dp),contentScale=ContentScale.Fit)
}
@Composable private fun PdfPreview(file: File) {
    val renderer=remember(file) { runCatching{PdfRenderer(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY))}.getOrNull() }
    DisposableEffect(renderer) {onDispose{if(renderer!=null)synchronized(renderer){renderer.close()}}}
    if(renderer==null) { Section(modifier=Modifier.padding(18.dp)) {Hint("This PDF could not be rendered. Save or open it with another app.")};return }
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        items(renderer.pageCount) { index ->
            val bitmap by produceState<Bitmap?>(null,renderer,index) { value=withContext(Dispatchers.IO) { synchronized(renderer) { runCatching {renderer.openPage(index).use { page -> val width=1200;val height=(width.toFloat()/page.width*page.height).toInt().coerceIn(1,4000);Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888).also{it.eraseColor(android.graphics.Color.WHITE);page.render(it,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)} }}.getOrNull() } } }
            Column { Hint("Page ${index+1} of ${renderer.pageCount}");if(bitmap==null) LinearProgressIndicator(Modifier.fillMaxWidth()) else Image(bitmap!!.asImageBitmap(),contentDescription="PDF page ${index+1}",modifier=Modifier.fillMaxWidth(),contentScale=ContentScale.FillWidth) }
        }
    }
}
