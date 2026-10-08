package com.bhachunda.erp

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType

val Forest=Color(0xFF245C43)
val Cream=Color(0xFFF5F5EF)
val Ink=Color(0xFF20392D)
val Muted=Color(0xFF657268)
val Amber=Color(0xFF9C651D)
val Line=Color(0xFFE1E5DB)
@Composable fun ErpTheme(content: @Composable ()->Unit) {
    MaterialTheme(colorScheme=lightColorScheme(primary=Forest,onPrimary=Color.White,primaryContainer=Color(0xFFE0EDE2),onPrimaryContainer=Ink,secondary=Amber,onSecondary=Color.White,secondaryContainer=Color(0xFFF5E8CA),onSecondaryContainer=Color(0xFF53401D),tertiary=Forest,onTertiary=Color.White,tertiaryContainer=Color(0xFFE0EDE2),onTertiaryContainer=Ink,background=Cream,onBackground=Ink,surface=Color.White,onSurface=Ink,surfaceVariant=Color(0xFFEBEEE5),onSurfaceVariant=Muted,surfaceTint=Forest,outlineVariant=Line,outline=Color(0xFF96A197),error=Color(0xFFAB3D3D)),typography=Typography(titleLarge=androidx.compose.ui.text.TextStyle(fontSize=24.sp,fontWeight=FontWeight.SemiBold),titleMedium=androidx.compose.ui.text.TextStyle(fontSize=18.sp,fontWeight=FontWeight.SemiBold),bodyLarge=androidx.compose.ui.text.TextStyle(fontSize=16.sp,lineHeight=24.sp),bodyMedium=androidx.compose.ui.text.TextStyle(fontSize=14.sp,lineHeight=21.sp)),content=content)
}
@Composable fun Section(title: String?=null,modifier: Modifier=Modifier,content: @Composable ColumnScope.()->Unit) {
    Surface(modifier.fillMaxWidth(),shape=RoundedCornerShape(18.dp),color=Color.White,border=BorderStroke(1.dp,Line)) {
        Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) { if(title!=null) Text(title,style=MaterialTheme.typography.titleMedium); content() }
    }
}
@Composable fun ScrollPage(content: @Composable ColumnScope.()->Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(18.dp),verticalArrangement=Arrangement.spacedBy(16.dp),content=content)
}
@Composable fun Hint(text: String) { Text(text,color=Muted,style=MaterialTheme.typography.bodyMedium) }
@Composable fun StatusPill(status: String) {
    val (bg,fg)=when(status) { "received" -> Color(0xFFE0EEE3) to Forest; "pending" -> Color(0xFFFFECCD) to Amber; "blocked","rejected" -> Color(0xFFFBE5E3) to Color(0xFFAB3D3D); else -> Color(0xFFEBEEE5) to Muted }
    Surface(shape=RoundedCornerShape(20.dp),color=bg) { Text(consentLabels[status] ?: status,Modifier.padding(horizontal=10.dp,vertical=5.dp),color=fg,fontSize=12.sp,fontWeight=FontWeight.Medium) }
}
@Composable fun Fact(label: String,value: String,modifier: Modifier=Modifier) {
    Column(modifier,verticalArrangement=Arrangement.spacedBy(4.dp)) { Text(label,color=Muted,fontSize=12.sp); Text(display(value),fontWeight=FontWeight.Medium,fontSize=15.sp) }
}
@Composable fun Facts(values: List<Pair<String,String>>) { values.chunked(2).forEach { row -> Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)) { row.forEach { (label,value) -> Fact(label,value,Modifier.weight(1f)) }; if(row.size==1) Spacer(Modifier.weight(1f)) } } }
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun Picker(label: String,value: String,options: List<Pair<String,String>>,onChange: (String)->Unit,enabled: Boolean=true,modifier: Modifier=Modifier) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded=expanded,onExpandedChange={ if(enabled) expanded=!expanded },modifier=modifier.fillMaxWidth()) {
        OutlinedTextField(value=options.firstOrNull{it.first==value}?.second ?: value,onValueChange={},readOnly=true,label={Text(label)},trailingIcon={ExposedDropdownMenuDefaults.TrailingIcon(expanded)},modifier=Modifier.menuAnchor().fillMaxWidth(),enabled=enabled,singleLine=true,shape=RoundedCornerShape(12.dp))
        ExposedDropdownMenu(expanded=expanded,onDismissRequest={expanded=false},modifier=Modifier.heightIn(max=320.dp)) { options.forEach { (key,name) -> DropdownMenuItem(text={Text(name)},onClick={expanded=false;onChange(key)}) } }
    }
}
@Composable fun Field(label: String,value: String,onChange: (String)->Unit,enabled: Boolean=true,multiline: Boolean=false,keyboard: KeyboardType=KeyboardType.Text,modifier: Modifier=Modifier) {
    OutlinedTextField(value=value,onValueChange=onChange,label={Text(label)},modifier=modifier.fillMaxWidth(),enabled=enabled,singleLine=!multiline,minLines=if(multiline)3 else 1,shape=RoundedCornerShape(12.dp),keyboardOptions=KeyboardOptions(keyboardType=keyboard))
}
@Composable fun Primary(label: String,onClick: ()->Unit,enabled: Boolean=true,modifier: Modifier=Modifier) { Button(onClick=onClick,enabled=enabled,modifier=modifier.fillMaxWidth().heightIn(min=50.dp),shape=RoundedCornerShape(12.dp)) { Text(label,fontWeight=FontWeight.SemiBold) } }
@Composable fun Secondary(label: String,onClick: ()->Unit,enabled: Boolean=true,modifier: Modifier=Modifier) { OutlinedButton(onClick=onClick,enabled=enabled,modifier=modifier.fillMaxWidth().heightIn(min=48.dp),shape=RoundedCornerShape(12.dp)) { Text(label) } }
@Composable fun Loading(text: String="Loading records…") { Column(Modifier.fillMaxSize().padding(32.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center) { CircularProgressIndicator(); Spacer(Modifier.height(18.dp)); Hint(text) } }
@Composable fun ParcelCard(parcel: Parcel,onClick: ()->Unit) {
    Surface(onClick=onClick,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(16.dp),color=Color.White,border=BorderStroke(1.dp,Line)) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Survey ${parcel.survey_number}",style=MaterialTheme.typography.titleMedium); Text(parcel.village_name,color=Muted,fontSize=13.sp) }; StatusPill(parcel.consent_status) }
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) { Text(acres(parcel.acreage),fontSize=13.sp,modifier=Modifier.weight(1f)); Text(stageLabels[parcel.acquisition_stage] ?: parcel.acquisition_stage,fontSize=12.sp,color=Muted); Icon(Icons.Outlined.ChevronRight,contentDescription="Open survey",modifier=Modifier.size(20.dp),tint=Forest) }
        }
    }
}
@Composable fun Empty(text: String) { Section { Icon(Icons.Outlined.FolderOpen,contentDescription=null,tint=Muted); Text(text); Hint("Try a different village or survey search.") } }
@Composable fun Disclosure(title: String,content: @Composable ColumnScope.()->Unit) {
    var expanded by remember { mutableStateOf(false) }
    Section { TextButton(onClick={expanded=!expanded},modifier=Modifier.fillMaxWidth()) { Text(title,Modifier.weight(1f),color=Ink); Icon(if(expanded)Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,contentDescription=if(expanded)"Collapse" else "Expand") }; if(expanded) content() }
}
