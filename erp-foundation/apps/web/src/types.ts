export type AppRole = "admin" | "data_entry" | "legal" | "finance" | "viewer";
export type ConsentStatus = "received" | "pending" | "not_ready" | "blocked" | "rejected";
export type AcquisitionStage = "identified" | "consent" | "legal" | "nfa" | "payment" | "executed" | "closed" | "blocked";

export interface CurrentProfile {
  full_name: string | null;
  role: AppRole;
  is_active: boolean;
}

export interface ParcelSummary {
  id: string;
  village_id?: string;
  village_code: string;
  village_name: string;
  survey_number: string;
  old_survey_number: string | null;
  acreage: number | null;
  account_number: string | null;
  bunch_number: string | null;
  consent_status: ConsentStatus;
  acquisition_stage: AcquisitionStage;
  document_count: number;
  verified_document_count: number;
}

export interface MapStatus {
  feature_key: string;
  status: ConsentStatus;
  linked_parcel_count: number;
}

export interface MapFeatureDefinition {
  feature_key: string;
  svg_element_id: string | null;
}

export interface MapFeatureLink {
  feature_key: string;
  svg_element_id: string | null;
  parcel_id: string;
  survey_number: string;
  village_code: string;
  village_name: string;
  match_method: string;
  match_confidence: string;
}

export interface VillageMetric {
  village: string;
  total: number;
  received: number;
  acreage: number;
}

export interface DashboardMetrics {
  totalParcels: number;
  receivedCount: number;
  pendingCount: number;
  documentGapCount: number;
  villages: VillageMetric[];
}

export interface ParcelWorkflowInput {
  parcelId: string;
  oldSurveyNumber: string;
  acreage: string;
  bunchNumber: string;
  consentStatus: ConsentStatus;
  consentDate: string;
  acquisitionStage: AcquisitionStage;
  category: string;
  targetDate: string;
  legalRemarks: string;
}

export interface ParcelDetail {
  id: string;
  survey_number: string;
  old_survey_number: string | null;
  hectare_are_sqmt: string | null;
  acreage: number | null;
  account_number: string | null;
  tenure: string | null;
  land_use: string | null;
  rights_and_encumbrances: string | null;
  nondh_numbers: string | null;
  bunch_number: string | null;
  latitude: number | null;
  longitude: number | null;
  source_workbook: string | null;
  source_row_number: number | null;
  village: {
    code: string;
    name_en: string;
    name_gu: string | null;
    district: string | null;
    taluka: string | null;
  } | null;
  consent: {
    status: ConsentStatus;
    received_on: string | null;
    source_value: string | null;
    remarks: string | null;
  } | null;
  acquisition: {
    project_name: string | null;
    spv_name: string | null;
    mw: number | null;
    category: string | null;
    atl_category: string | null;
    acquisition_purpose: string | null;
    project_duration_months: number | null;
    block_name: string | null;
    target_date: string | null;
    execution_date: string | null;
    acquisition_stage: AcquisitionStage;
    reason_not_acquired: string | null;
    total_acres_in_rtc: number | null;
    total_acres_to_acquire: number | null;
    total_acres_acquired: number | null;
    total_sq_meters_acquired: number | null;
    source_fields: Record<string, unknown> | null;
  } | null;
  legal: {
    public_notice_status: string | null;
    sro_search_status: string | null;
    documents_required: number | null;
    documents_submitted: number | null;
    law_firm_verification_status: string | null;
    pending_documents: string | null;
    preliminary_tsr_status: string | null;
    conditional_clearance_status: string | null;
    nfa_number: string | null;
    nfa_submitted_on: string | null;
    nfa_approved_on: string | null;
    legal_remarks: string | null;
  } | null;
  owners: Array<{
    id: string;
    display_name: string;
    source_owner_text: string | null;
    sequence_no: number | null;
    is_primary: boolean;
  }>;
  documents: Array<{
    document_type_code: string;
    status: string;
    created_at: string;
  }>;
  private_owner_details: Array<{
    owner_id: string;
    pan_number: string | null;
    aadhaar_number: string | null;
    bank_account_number: string | null;
    bank_name: string | null;
    ifsc_code: string | null;
    vendor_code: string | null;
    bank_owner_name: string | null;
    updated_at: string;
  }>;
}
