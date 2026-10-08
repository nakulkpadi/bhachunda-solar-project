package com.bhachunda.erp

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity: ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ErpTheme {
                val vm: ErpViewModel=viewModel();val state by vm.ui.collectAsStateWithLifecycle();val lifecycle=LocalLifecycleOwner.current.lifecycle
                val snackbar=remember{SnackbarHostState()};val scope=rememberCoroutineScope();var export by remember{mutableStateOf<Pair<File,String>?>(null)}
                val saveLauncher=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
                    val selected=export;export=null
                    if(uri!=null&&selected!=null) scope.launch { try { withContext(Dispatchers.IO) { contentResolver.openOutputStream(uri)?.use { output -> selected.first.inputStream().use{it.copyTo(output)} } ?: error("Cannot write to this location.") };vm.notice(message="File saved to your phone.") } catch(e: Exception) {vm.notice(error=e.message)} }
                }
                val save: (File,String)->Unit={file,mime -> export=file to mime;saveLauncher.launch(file.name.replace(Regex("^[0-9a-f-]{36}-"),"")) }
                val share: (File,String)->Unit={file,mime ->
                    runCatching {
                        val uri=FileProvider.getUriForFile(this,"${packageName}.files",file)
                        val intent=Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).apply{clipData=ClipData.newUri(contentResolver,"Project document",uri)}
                        startActivity(Intent.createChooser(intent,"Share or open document"))
                    }.onFailure{vm.notice(error="No compatible app could open the file.")}
                }
                val openUrl: (String)->Unit={url -> runCatching {startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))}.onFailure{vm.notice(error="No browser is available for Google’s secure sign-in.")} }
                val printForm:(File)->Unit={file -> runCatching{(getSystemService(PRINT_SERVICE) as android.print.PrintManager).print("Unsigned consent form",ConsentPrintAdapter(file),android.print.PrintAttributes.Builder().setMediaSize(android.print.PrintAttributes.MediaSize.ISO_A4).build())}.onFailure{vm.notice(error="Printing is unavailable. Save or share the PDF instead.")} }
                DisposableEffect(lifecycle) {
                    val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_RESUME)vm.foreground(true) else if(event==Lifecycle.Event.ON_PAUSE)vm.foreground(false)}
                    lifecycle.addObserver(observer);if(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))vm.foreground(true)
                    onDispose{lifecycle.removeObserver(observer);vm.foreground(false)}
                }
                LaunchedEffect(state.profile?.approved,state.screen) {if(state.profile?.approved==true && state.screen in setOf("detail","consent","owner","documents","driveBrowser","preview","reports","team","generatedForms","generatedForm"))window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)}
                LaunchedEffect(state.error,state.message) { val message=state.error ?: state.message;if(message!=null) {snackbar.showSnackbar(message,withDismissAction=true,duration=SnackbarDuration.Long);vm.notice()} }
                BackHandler(enabled=state.screen!=null||state.busy) {vm.back()}
                AppScaffold(state,vm,snackbar,save,share,openUrl,printForm)
            }
        }
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun AppScaffold(state: UiState,vm: ErpViewModel,snackbar: SnackbarHostState,onSave: (File,String)->Unit,onShare: (File,String)->Unit,onUrl: (String)->Unit,onPrint:(File)->Unit) {
    val approved=state.signedIn&&state.profile?.approved==true
    Scaffold(containerColor=Cream,snackbarHost={SnackbarHost(snackbar)},topBar={
        if(approved) TopAppBar(title={Column {Text(if(state.screen=="preview")state.previewTitle else "Bhachunda ERP",maxLines=1,style=MaterialTheme.typography.titleMedium);Text(if(state.connected)"Synced ${state.syncedAt} · Auto sync 5s" else "Sync paused · Refresh or reconnect",style=MaterialTheme.typography.labelSmall,color=if(state.connected)Forest else Amber)}},navigationIcon={if(state.screen!=null)IconButton(onClick={vm.back()},enabled=!state.busy){Icon(Icons.Outlined.ArrowBack,contentDescription="Back")}},actions={IconButton(onClick={vm.refreshNow()},enabled=!state.busy){Icon(Icons.Outlined.Refresh,contentDescription="Refresh ERP")}},colors=TopAppBarDefaults.topAppBarColors(containerColor=Cream))
    },bottomBar={
        if(approved&&state.screen==null) NavigationBar(containerColor=Color.White,tonalElevation=0.dp) {
            listOf(Triple("home","Overview",Icons.Outlined.SpaceDashboard),Triple("surveys","Surveys",Icons.Outlined.ViewList),Triple("map","Map",Icons.Outlined.Map),Triple("more","More",Icons.Outlined.MoreHoriz)).forEach { (key,label,icon) -> NavigationBarItem(selected=state.tab==key,onClick={vm.tab(key)},icon={Icon(icon,contentDescription=label)},label={Text(label)},colors=NavigationBarItemDefaults.colors(indicatorColor=Color(0xFFE0EDE2),selectedIconColor=Forest,selectedTextColor=Forest)) }
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            when {
                state.initialLoading -> Loading("Connecting to your project…")
                !state.signedIn -> AuthScreen(state.busy,vm::auth)
                !approved -> ApprovalScreen(state,vm::refreshNow,vm::signOut)
                else -> Box(Modifier.weight(1f)) {
                    when(state.screen) {
                        "newConsent" -> NewConsentScreen(state,vm)
                        "detail" -> DetailScreen(state,vm)
                        "consent" -> ConsentScreen(state,vm)
                        "documents" -> DocumentsScreen(state,vm)
                        "owner" -> OwnerScreen(state,vm)
                        "driveBrowser" -> DriveBrowserScreen(state,vm)
                        "preview" -> DocumentPreviewScreen(state,onShare,onSave)
                        "reports" -> ReportsScreen(state,vm,onSave)
                        "generatedForms" -> if(state.profile?.canEdit==true)GeneratedFormsScreen(state,vm,onSave,onShare,onPrint)
                        "generatedForm" -> if(state.profile?.canEdit==true)GeneratedFormScreen(state,vm,onSave,onShare,onPrint)
                        "team" -> if(state.profile?.isAdmin==true)TeamScreen(state,vm)
                        else -> when(state.tab) {"surveys"->SurveysScreen(state,vm);"map"->MapScreen(state){vm.choose(it)};"more"->MoreScreen(state,vm,onUrl);else->OverviewScreen(state,vm)}
                    }
                }
            }
        }
    }
}

