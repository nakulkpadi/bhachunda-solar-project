export type AppRole = "admin" | "data_entry" | "legal" | "finance" | "viewer";
export type ConsentStatus = "received" | "pending" | "not_ready" | "blocked" | "rejected";
export type AcquisitionStage = "identified" | "consent" | "legal" | "nfa" | "payment" | "executed" | "closed" | "blocked";

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
