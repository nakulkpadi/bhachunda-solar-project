package com.bhachunda.erp

import com.google.gson.*
import com.google.gson.annotations.SerializedName
import java.time.LocalDate
import java.time.ZoneId

data class Session(val access_token: String, val refresh_token: String, val expires_at: Long, val user_id: String, val email: String)
data class Profile(val full_name: String? = null, val role: String = "viewer", val is_active: Boolean = false, val approval_status: String = "pending", val email: String? = null) {
    val approved get() = is_active && approval_status == "approved"
    val canEdit get() = approved && role in setOf("admin", "editor")
    val isAdmin get() = approved && role == "admin"
    val canComment get() = approved && role in setOf("admin", "editor", "commenter")
}
data class Parcel(val id: String, val village_code: String, val village_name: String, val survey_number: String, val old_survey_number: String? = null, val acreage: Double? = null, val account_number: String? = null, val bunch_number: String? = null, val consent_status: String = "not_ready", val acquisition_stage: String = "identified", val document_count: Int = 0, val verified_document_count: Int = 0)
data class MapStatus(val feature_key: String, val status: String, val linked_parcel_count: Int)
data class MapDefinition(val feature_key: String, val svg_element_id: String?)
data class MapLink(val feature_key: String, val svg_element_id: String?, val parcel_id: String, val survey_number: String, val village_code: String, val village_name: String)
data class Document(val id: String?, val owner_id: String?, val document_type_code: String, val status: String, val created_at: String?, val original_filename: String?, val mime_type: String?, val can_view: Boolean)
data class Owner(val id: String, val display_name: String, val sequence_no: Int?, val is_primary: Boolean)
data class Comment(val id: String, val user_id: String, val body: String, val author_name: String?, val created_at: String)
data class Account(val id: String, val email: String, val full_name: String?, val role: String, val is_active: Boolean, val approval_status: String, val created_at: String?)
data class DriveItem(val id: String, val name: String, val is_folder: Boolean, val can_attach: Boolean, val size: Long)
data class DriveListing(val folder_id: String, val folder_name: String, val next_page_token: String?, val files: List<DriveItem>)
data class ConsentDraft(val status: String = "received", val date: String = today(), val reference: String = "", val remarks: String = "") {
    fun payload(parcelId: String, userId: String): Map<String, Any?> {
        require(status in consentLabels) { "Choose a valid consent status." }
        require(reference.length <= 500 && remarks.length <= 10000) { "Reference or remarks are too long." }
        if (status == "received") { require(date.isNotBlank()) { "Choose the received date." }; require(!LocalDate.parse(date).isAfter(LocalDate.now(ZoneId.of("Asia/Kolkata")))) { "Received date cannot be in the future." } }
        return mapOf("parcel_id" to parcelId, "status" to status, "received_on" to if(status == "received") date else null, "remarks" to (if(reference.isBlank()) remarks else "Reference: ${reference.replace('\n',' ')}\n$remarks").trim().ifBlank { null }, "updated_by" to userId)
    }
}
val consentLabels = linkedMapOf("received" to "Received", "pending" to "Pending", "not_ready" to "Not ready", "blocked" to "Blocked", "rejected" to "Rejected")
val stageLabels = linkedMapOf("identified" to "Identified", "consent" to "Consent", "legal" to "Legal review", "nfa" to "NFA", "payment" to "Payment", "executed" to "Executed", "closed" to "Closed", "blocked" to "Blocked")
val documentLabels = linkedMapOf("consent_letter" to "Consent letter", "current_712" to "Current 7/12", "nondh_6" to "Nondh No. 6 / Mutation", "lease_deed" to "Lease deed", "old_712" to "Old 7/12", "old_nondh_6" to "Old Nondh No. 6", "pan" to "PAN card", "aadhaar" to "Aadhaar card", "bank_details" to "Passbook / cancelled cheque", "mutation_death_certificate" to "Mutation / death certificate", "other" to "Other")
val kycCodes = setOf("pan", "aadhaar", "bank_details")
fun today(): String = LocalDate.now(ZoneId.of("Asia/Kolkata")).toString()
fun JsonObject.value(key: String): String = get(key)?.takeUnless { it.isJsonNull }?.let { if(it.isJsonPrimitive) it.asString else it.toString() } ?: ""
fun JsonObject.obj(key: String): JsonObject = get(key)?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()
fun JsonObject.array(key: String): JsonArray = get(key)?.takeIf { it.isJsonArray }?.asJsonArray ?: JsonArray()
inline fun <reified T> JsonObject.items(key: String): List<T> = array(key).map { Gson().fromJson(it, T::class.java) }
fun display(v: String) = v.ifBlank { "—" }
fun acres(v: Double?) = v?.let { String.format(java.util.Locale.forLanguageTag("en-IN"), "%.2f ac", it) } ?: "—"
fun safeFilename(name: String): String = name.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[^\\p{L}\\p{N} ._()-]"), "_").trim().trim('.').take(140).ifBlank { "document" }
fun csvCell(value: String): String { val text = if(value.trimStart().firstOrNull() in setOf('=','+','-','@','\t','\r')) "'$value" else value; return "\"${text.replace("\"","\"\"")}\"" }
