package com.bhachunda.erp

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable fun AuthScreen(busy: Boolean,onSubmit: (String,String,String,String)->Unit) {
    var mode by remember { mutableStateOf("login") }; var name by remember { mutableStateOf("") }; var email by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var visible by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(horizontal=24.dp,vertical=30.dp),verticalArrangement=Arrangement.spacedBy(24.dp)) {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) { Surface(shape=RoundedCornerShape(14.dp),color=Forest) { Icon(Icons.Outlined.SolarPower,contentDescription=null,modifier=Modifier.padding(13.dp).size(28.dp),tint=Color(0xFFF4C56A)) }; Column { Text("BHACHUNDA",fontWeight=FontWeight.Bold,letterSpacing=2.sp,fontSize=16.sp); Hint("SOLAR PROJECT ERP") } }
        Column(verticalArrangement=Arrangement.spacedBy(12.dp)) { Text(if(mode=="create")"Join the project." else if(mode=="reset")"Reset your password." else "Your land records,\nwithin reach.",fontSize=32.sp,lineHeight=38.sp,fontWeight=FontWeight.SemiBold,color=Ink); Hint(if(mode=="create") "Verify your email and request administrator approval to access the ERP." else if(mode=="reset") "We’ll send a secure link to your registered email." else "Surveys, consent and project documents for Bhavanipar, Bitta and Vandh Timbo.") }
        Section {
            Text(if(mode=="create")"Create account" else if(mode=="reset")"Password reset" else "Sign in",style=MaterialTheme.typography.titleMedium)
            if(mode=="create") Field("Full name",name,{name=it},!busy)
            OutlinedTextField(value=email,onValueChange={email=it},label={Text("Email address")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email),enabled=!busy,modifier=Modifier.fillMaxWidth().testTag("auth-email"),shape=RoundedCornerShape(12.dp))
            if(mode!="reset") OutlinedTextField(value=password,onValueChange={password=it},label={Text("Password")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),visualTransformation=if(visible)VisualTransformation.None else PasswordVisualTransformation(),enabled=!busy,modifier=Modifier.fillMaxWidth().testTag("auth-password"),shape=RoundedCornerShape(12.dp),trailingIcon={IconButton(onClick={visible=!visible}) { Icon(if(visible)Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,contentDescription=if(visible)"Hide password" else "Show password") }})
            if(mode=="create") Hint("Use at least 12 characters. Your account stays pending until approved.")
            Primary(if(busy)"Please wait…" else if(mode=="create")"Request access" else if(mode=="reset")"Send reset link" else "Sign in",{onSubmit(mode,name,email,password)},!busy && email.contains('@') && (mode=="reset" || password.isNotBlank()) && (mode!="create" || (password.length>=12 && name.isNotBlank())),Modifier.testTag("auth-submit"))
            if(mode=="login") TextButton(onClick={mode="reset";password=""},enabled=!busy,modifier=Modifier.align(Alignment.End)) { Text("Forgot password?") }
        }
        if(mode=="login") Secondary("Create an account",{mode="create";password=""},!busy) else TextButton(onClick={mode="login";password=""},enabled=!busy,modifier=Modifier.align(Alignment.CenterHorizontally)) { Text("Back to sign in") }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically) { Icon(Icons.Outlined.Lock,contentDescription=null,tint=Muted,modifier=Modifier.size(17.dp)); Hint("Project access is managed by your administrator.") }
    }
}
@Composable fun ApprovalScreen(state: UiState,onRefresh: ()->Unit,onLogout: ()->Unit) {
    ScrollPage {
        Spacer(Modifier.height(36.dp)); Icon(Icons.Outlined.HourglassEmpty,contentDescription=null,tint=Forest,modifier=Modifier.size(48.dp))
        Text(when(state.profile?.approval_status) { "rejected" -> "Access request declined"; "suspended" -> "Access is suspended"; else -> "Awaiting approval" },style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold)
        Text("You’re signed in as ${state.email}. The administrator must approve your account before project data is available.")
        Hint("You can keep this app installed. It will check your access when you return.")
        Primary("Check approval",onRefresh,!state.busy); Secondary("Sign out",onLogout,!state.busy)
    }
}
