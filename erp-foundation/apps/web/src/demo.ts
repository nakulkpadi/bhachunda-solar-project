import type { DashboardMetrics, ParcelSummary } from "./types";

export const demoParcels: ParcelSummary[] = [
  { id: "demo-bh-450", village_code: "bhavanipar", village_name: "Bhavanipar", survey_number: "450", old_survey_number: "191/2", acreage: 3.26, account_number: "599", bunch_number: "", consent_status: "received", acquisition_stage: "consent", document_count: 1, verified_document_count: 0 },
  { id: "demo-bh-451", village_code: "bhavanipar", village_name: "Bhavanipar", survey_number: "451", old_survey_number: "191/2/Part 1", acreage: 3.26, account_number: "253", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 },
  { id: "demo-bh-452", village_code: "bhavanipar", village_name: "Bhavanipar", survey_number: "452", old_survey_number: "191/2/Part 2", acreage: 3.26, account_number: "800", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 },
  { id: "demo-bh-455", village_code: "bhavanipar", village_name: "Bhavanipar", survey_number: "455", old_survey_number: "189", acreage: 8.28, account_number: "550", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 },
  { id: "demo-bh-457", village_code: "bhavanipar", village_name: "Bhavanipar", survey_number: "457", old_survey_number: null, acreage: 2.91, account_number: null, bunch_number: "", consent_status: "received", acquisition_stage: "legal", document_count: 2, verified_document_count: 1 },
  { id: "demo-bh-468", village_code: "bhavanipar", village_name: "Bhavanipar", survey_number: "468", old_survey_number: null, acreage: 3.54, account_number: null, bunch_number: "", consent_status: "received", acquisition_stage: "payment", document_count: 3, verified_document_count: 2 },
  { id: "demo-bi-128-2", village_code: "bitta", village_name: "Bitta", survey_number: "128/2", old_survey_number: null, acreage: 3.27, account_number: "664", bunch_number: "", consent_status: "received", acquisition_stage: "consent", document_count: 1, verified_document_count: 0 },
  { id: "demo-bi-129-2", village_code: "bitta", village_name: "Bitta", survey_number: "129/2", old_survey_number: null, acreage: 2.12, account_number: "712", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 },
  { id: "demo-bi-130", village_code: "bitta", village_name: "Bitta", survey_number: "130", old_survey_number: null, acreage: 6.02, account_number: "2", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 },
  { id: "demo-vt-3", village_code: "vandh-timbo", village_name: "Vandh Timbo", survey_number: "3", old_survey_number: "12", acreage: 4.09, account_number: "270", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 },
  { id: "demo-vt-4", village_code: "vandh-timbo", village_name: "Vandh Timbo", survey_number: "4", old_survey_number: "11/Part 2", acreage: 3.22, account_number: "223", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 },
  { id: "demo-vt-5", village_code: "vandh-timbo", village_name: "Vandh Timbo", survey_number: "5", old_survey_number: "11/Part 1", acreage: 3.19, account_number: "217", bunch_number: "", consent_status: "not_ready", acquisition_stage: "identified", document_count: 0, verified_document_count: 0 }
];

export const demoMetrics: DashboardMetrics = {
  totalParcels: 479,
  receivedCount: 106,
  pendingCount: 373,
  documentGapCount: 373,
  villages: [
    { village: "Bhavanipar", total: 288, received: 96, acreage: 1063.05 },
    { village: "Bitta", total: 31, received: 10, acreage: 337.95 },
    { village: "Vandh Timbo", total: 160, received: 0, acreage: 588.42 }
  ]
};
