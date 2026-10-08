package com.bhachunda.erp

import com.google.gson.JsonObject
import java.time.LocalDate
import java.text.Normalizer
import kotlin.math.roundToInt

data class FormFields(val date:String=today(),val survey_number:String="",val khata:String="",val has:String="",val village_en:String="",val village_gu:String="",val taluka:String="Abdasa",val district:String="Kutch",val mobile:String="",val owners:List<String> = listOf("")) {
    fun validated():FormFields {
        fun text(s:String,max:Int,required:Boolean=true):String { val v=Normalizer.normalize(s.trim(),Normalizer.Form.NFC);require((!required||v.isNotEmpty())&&v.length<=max&&!v.any{it.code<32||it.code==127}){"Check the form details."};return v }
        val day=text(date,10);require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(day)&&LocalDate.parse(day).toString()==day){"Choose a valid form date."}
        val area=normalizeFormArea(text(has,20));formArea(area)
        val contact=text(mobile,20,false);require(contact.isBlank()||Regex("\\+?[0-9 ()-]{7,20}").matches(contact)){"Check the mobile number."}
        require(owners.size in 1..50){"Add between 1 and 50 owners."}
        return copy(date=day,survey_number=text(survey_number,80),khata=text(khata,80,false),has=area,village_en=text(village_en,100),village_gu=text(village_gu,100),taluka=text(taluka,100),district=text(district,100),mobile=contact,owners=owners.map{text(it,200)})
    }
}
data class FormDraft(val id:String,val parcel_id:String,val state:String="draft",val revision:Int=1,val template_version:String="bnpl-consent-v1",val fields:FormFields,val document_id:String?=null,val created_at:String="",val updated_at:String="")
data class FormArea(val sqm:Long,val acres:Int,val guntha:Int)
fun normalizeFormArea(has:String)=has.trim().map{when(it){in '૦'..'૯'->('0'.code+it.code-'૦'.code).toChar();'પ'->'5';'–','—'->'-';else->it}}.joinToString("")
fun formArea(has:String):FormArea {
    val match=Regex("^(\\d{1,5})[.\\-\\s](\\d{1,2})[.\\-\\s](\\d{1,2})$").matchEntire(normalizeFormArea(has)) ?: error("Enter H.Are.Sq.Mt., for example 1.60.57.")
    val parts=match.groupValues.drop(1).map{it.toLong()};val sqm=parts[0]*10000+parts[1]*100+parts[2];require(sqm>0){"Land area must be greater than zero."}
    val total=(sqm/101.17141056).roundToInt();return FormArea(sqm,total/40,total%40)
}
fun prefillForm(parcel:JsonObject):FormFields {
    val village=parcel.obj("village")
    return FormFields(survey_number=parcel.value("survey_number"),khata=parcel.value("account_number"),has=normalizeFormArea(parcel.value("hectare_are_sqmt")),village_en=village.value("name_en"),village_gu=village.value("name_gu"),taluka=village.value("taluka").ifBlank{"Abdasa"},district=village.value("district").ifBlank{"Kutch"},owners=parcel.items<Owner>("owners").map{it.display_name}.ifEmpty{listOf("")})
}
