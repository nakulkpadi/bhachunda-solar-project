package com.bhachunda.erp

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.io.File

@Composable fun MoreScreen(state: UiState,vm: ErpViewModel,onUrl: (String)->Unit) {
    ScrollPage {
        Text("Project tools",style=MaterialTheme.typography.headlineMedium)
        Section { Fact("Signed in",state.email);Fact("Access",state.profile?.role?.replaceFirstChar{it.uppercase()}.orEmpty());Hint("Data refreshes every 5 seconds while the app is open. Changes are saved to the same ERP used on the web.") }
        Section("Reports") { Hint("Filter by village, consent and acquisition stage.");Primary("Generate report",{vm.screen("reports")},!state.busy) }
        if(state.profile?.canEdit==true) Section("Consent generator") { Hint("Prepare unsigned English and Gujarati forms using survey details. Generated forms do not record consent received.");Primary("Consent generator",{vm.generatedForms()},state.connected&&!state.busy) }
        if(state.profile?.isAdmin==true) Section("Team access") { Hint("Invite users, approve requests and manage Editor, Viewer and Commenter rights.");Primary("Users & access",{vm.accounts()},state.connected&&!state.busy) }
        if(state.profile?.canEdit==true) Section("Google Drive") {
            Hint(if(state.driveConnected==true)"Connected to the project’s Drive account." else "The project Drive connection is unavailable.")
            Secondary("Check connection",{vm.driveStatus()},state.connected&&!state.busy)
            if(state.profile.isAdmin && state.driveConnected!=true) Primary("Connect Google Drive",{vm.driveUrl(onUrl)},state.connected&&!state.busy)
        }
        Secondary("Refresh project data",{vm.refreshNow()},!state.busy)
        Secondary("Sign out",{vm.signOut()},!state.busy)
        Hint("Bhachunda ERP · Android ${BuildConfig.VERSION_NAME}")
    }
}
@Composable fun ReportsScreen(state: UiState,vm: ErpViewModel,onFile: (File,String)->Unit) {
    var village by remember{mutableStateOf("all")};var consent by remember{mutableStateOf("all")};var stage by remember{mutableStateOf("all")}
    val rows=state.parcels.filter{(village=="all"||it.village_code==village)&&(consent=="all"||it.consent_status==consent)&&(stage=="all"||it.acquisition_stage==stage)}
    ScrollPage {
        Text("Generate report",style=MaterialTheme.typography.headlineMedium)
        Section("Report filters") {
            Picker("Village",village,listOf("all" to "All villages")+state.parcels.distinctBy{it.village_code}.map{it.village_code to it.village_name},{village=it})
            Picker("Consent status",consent,listOf("all" to "All statuses")+consentLabels.toList(),{consent=it})
            Picker("Acquisition stage",stage,listOf("all" to "All stages")+stageLabels.toList(),{stage=it})
            Fact("Selected surveys",rows.size.toString());Fact("Consent received",rows.count{it.consent_status=="received"}.toString())
        }
        Section("Survey register") { Hint("CSV with survey, area, consent, stage and document counts.");Primary("Export CSV",{vm.csv(rows,onFile)},rows.isNotEmpty()&&!state.busy) }
        Section("Patel Infra report") {
            Hint(if(state.profile?.isAdmin==true)"The original ERP Excel layout, including land, owner, legal and acquisition details." else "This report contains confidential owner details and requires administrator access.")
            Primary(if(state.busy)"Generating…" else "Generate Patel Infra Excel",{vm.patel(village,consent,stage,onFile)},state.profile?.isAdmin==true&&state.connected&&!state.busy&&rows.isNotEmpty())
        }
    }
}
@Composable fun TeamScreen(state: UiState,vm: ErpViewModel) {
    var email by remember{mutableStateOf("")};var name by remember{mutableStateOf("")};var role by remember{mutableStateOf("viewer")};var confirm by remember{mutableStateOf<Map<String,String>?>(null)}
    val roles=listOf("editor" to "Editor","viewer" to "Viewer","commenter" to "Commenter")
    ScrollPage {
        Text("Users & access",style=MaterialTheme.typography.headlineMedium)
        Disclosure("Invite a team member") {
            Field("Email address",email,{email=it},!state.busy,keyboard=androidx.compose.ui.text.input.KeyboardType.Email);Field("Full name",name,{name=it},!state.busy)
            Picker("Rights",role,roles,{role=it},!state.busy)
            Hint("The email invitation creates pending access. Approval is still required.")
            Primary("Send invitation",{vm.manage(mapOf("action" to "invite","email" to email.trim(),"full_name" to name.trim(),"role" to role))},email.contains('@')&&!state.busy&&state.connected)
        }
        state.accounts.sortedBy{if(it.approval_status=="pending")0 else 1}.forEach { account ->
            val protected=account.email.equals("nakul.kapdi@gmail.com",true)
            var selectedRole by remember(account.id,account.role){mutableStateOf(if(account.role in roles.map{it.first})account.role else "viewer")}
            Section {
                Text(account.full_name?.ifBlank{null} ?: account.email,style=MaterialTheme.typography.titleMedium);Hint(account.email);Fact("Account status",account.approval_status.replaceFirstChar{it.uppercase()})
                if(protected) Hint("Primary administrator · protected account") else {
                    Picker("Rights",selectedRole,roles,{selectedRole=it},!state.busy)
                    val active=account.is_active&&account.approval_status=="approved"
                    Primary(if(active)"Save rights" else "Approve access",{confirm=mapOf("action" to if(active)"role" else "approve","user_id" to account.id,"role" to selectedRole)},state.connected&&!state.busy)
                    TextButton(onClick={confirm=mapOf("action" to if(active)"suspend" else "reject","user_id" to account.id,"role" to selectedRole)},enabled=state.connected&&!state.busy) {Text(if(active)"Suspend access" else "Decline request",color=MaterialTheme.colorScheme.error)}
                }
            }
        }
    }
    confirm?.let { input -> AlertDialog(onDismissRequest={confirm=null},title={Text("Confirm access change")},text={Text("${input["action"]?.replaceFirstChar{it.uppercase()}} this account with ${input["role"]} rights?")},confirmButton={TextButton(onClick={confirm=null;vm.manage(input)},enabled=!state.busy){Text("Confirm")}},dismissButton={TextButton(onClick={confirm=null}){Text("Cancel")}}) }
}

