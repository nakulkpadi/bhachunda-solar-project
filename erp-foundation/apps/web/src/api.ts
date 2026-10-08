import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ConsentStatus,
  CurrentProfile,
  MapFeatureDefinition,
  MapFeatureLink,
  MapStatus,
  ParcelDetail,
  ParcelSummary,
  ParcelWorkflowInput
} from "./types";
import type { OwnerDetailsInput } from "./types";
import type { ConsentFormDraft, ConsentFormFields } from "../../../shared/consent-draft";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
export const authCallbackType = new URLSearchParams(window.location.hash.slice(1)).get("type") || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes("your-project"));
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

function requiredClient(): SupabaseClient {
  if (!supabase) throw new Error("Supabase is not configured. Add the browser-safe values to .env.local.");
  return supabase;
}

export async function loadConsentFormDrafts(): Promise<ConsentFormDraft[]> {
  const drafts: ConsentFormDraft[]=[]; let offset: number | null=0;
  while(offset!==null) {
    const response=await fetch(`${supabaseUrl}/functions/v1/consent-drafts?offset=${offset}`,{headers:await sessionHeaders(),cache:"no-store"});
    const body=await response.json(); if(!response.ok) throw new Error(body.error || "Could not load generated forms.");
    drafts.push(...body.drafts); offset=body.next_offset;
  }
  return drafts;
}
export async function saveConsentFormDraft(input: { id:string; parcel_id?:string; revision?:number; fields?:ConsentFormFields; state?:"draft"|"archived" }): Promise<ConsentFormDraft> {
  const response=await fetch(`${supabaseUrl}/functions/v1/consent-drafts`,{method:input.revision ? "PATCH":"POST",headers:{...await sessionHeaders(),"Content-Type":"application/json"},body:JSON.stringify(input)});
  const body=await response.json(); if(!response.ok) throw new Error(body.error || "Could not save this draft."); return body.draft;
}
export async function uploadConsentFormDraftPdf(draft:ConsentFormDraft,file:File): Promise<void> {
  const form=new FormData(); form.append("parcel_id",draft.parcel_id);form.append("draft_id",draft.id);form.append("draft_revision",String(draft.revision));form.append("document_type_code","consent_form_draft");form.append("file",file);
  const response=await fetch(`${supabaseUrl}/functions/v1/drive-upload`,{method:"POST",headers:await sessionHeaders(),body:form});
  const body=await response.json(); if(!response.ok) throw new Error(body.error || "Could not save draft PDF to Drive.");
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await requiredClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await requiredClient().auth.signOut();
  if (error) throw error;
}

export async function createAccount(fullName: string, email: string, password: string): Promise<void> {
  const { error } = await requiredClient().auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: new URL("./index.html", window.location.href).href } });
  if (error) throw error;
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await requiredClient().auth.resetPasswordForEmail(email, { redirectTo: new URL("./index.html", window.location.href).href });
  if (error) throw error;
}

export async function setAccountPassword(password: string): Promise<void> {
  const { error } = await requiredClient().auth.updateUser({ password });
  if (error) throw error;
}

export interface ProjectAccount extends CurrentProfile {
  id: string; email: string; created_at: string; approved_at: string | null; invited_by: string | null;
}

export async function loadProjectAccounts(): Promise<ProjectAccount[]> {
  const response = await fetch(`${supabaseUrl}/functions/v1/manage-users`, { headers: await sessionHeaders(), cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load accounts.");
  return body.users || [];
}

export async function manageProjectAccount(input: { action: "invite" | "approve" | "reject" | "suspend" | "role"; user_id?: string; role: string; email?: string; full_name?: string }): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/manage-users`, { method: "POST", headers: { ...await sessionHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Account action failed.");
}

export interface SurveyComment { id: string; user_id: string; body: string; author_name: string; created_at: string }
export async function loadSurveyComments(parcelId: string): Promise<SurveyComment[]> {
  const { data, error } = await requiredClient().from("survey_comments").select("id,user_id,body,author_name,created_at").eq("parcel_id", parcelId).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}
export async function addSurveyComment(parcelId: string, body: string): Promise<void> {
  const client = requiredClient();
  const { data, error: authError } = await client.auth.getUser();
  if (authError || !data.user) throw new Error("Please sign in.");
  const { error } = await client.from("survey_comments").insert({ parcel_id: parcelId, user_id: data.user.id, body });
  if (error) throw error;
}
export async function deleteSurveyComment(id: string): Promise<void> {
  const { error } = await requiredClient().from("survey_comments").delete().eq("id", id);
  if (error) throw error;
}

export async function loadMyProfile(): Promise<CurrentProfile | null> {
  const client = requiredClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return null;
  const { data, error } = await client
    .from("profiles")
    .select("full_name,role,is_active,approval_status,email")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error) throw error;
  return data as CurrentProfile | null;
}

export async function loadParcels(): Promise<ParcelSummary[]> {
  const { data, error } = await requiredClient()
    .from("parcel_overview")
    .select("*")
    .order("village_name", { ascending: true })
    .order("survey_number", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as ParcelSummary[];
}

export async function loadMapStatuses(): Promise<MapStatus[]> {
  const { data, error } = await requiredClient()
    .from("map_status_summary")
    .select("feature_key,status,linked_parcel_count");
  if (error) throw error;
  return (data ?? []) as MapStatus[];
}

export async function loadMapFeatureDefinitions(): Promise<MapFeatureDefinition[]> {
  const { data, error } = await requiredClient()
    .from("map_features")
    .select("feature_key,svg_element_id")
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as MapFeatureDefinition[];
}

export async function loadMapFeatureLinks(): Promise<MapFeatureLink[]> {
  const { data, error } = await requiredClient()
    .from("map_feature_parcel_links")
    .select("feature_key,svg_element_id,parcel_id,survey_number,village_code,village_name,match_method,match_confidence")
    .limit(3000);
  if (error) throw error;
  return (data ?? []) as MapFeatureLink[];
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const client = requiredClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Please sign in first.");
  return { Authorization: `Bearer ${data.session.access_token}`, apikey: supabaseKey! };
}

export async function loadParcelDetail(parcelId: string): Promise<ParcelDetail> {
  const response = await fetch(`${supabaseUrl}/functions/v1/parcel-detail?parcel_id=${encodeURIComponent(parcelId)}`, {
    headers: await sessionHeaders()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.parcel) throw new Error(payload.error || "Could not load survey details.");
  return payload.parcel as ParcelDetail;
}

export async function recordConsent(input: {
  parcelId: string;
  status: ConsentStatus;
  receivedOn?: string;
  remarks?: string;
}): Promise<void> {
  const client = requiredClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Please sign in first.");
  const { error } = await client
    .from("consent_records")
    .upsert({
      parcel_id: input.parcelId,
      status: input.status,
      received_on: input.status === "received" ? (input.receivedOn || new Date().toISOString().slice(0, 10)) : null,
      remarks: input.remarks || null,
      updated_by: userData.user.id
    }, { onConflict: "parcel_id" });
  if (error) throw error;
}

export async function downloadPatelReport(filters: { village: string; consent: string; stage: string }): Promise<{ blob: Blob; filename: string }> {
  const query = new URLSearchParams({ village: filters.village, consent: filters.consent, stage: filters.stage });
  const response = await fetch(`${supabaseUrl}/functions/v1/patel-report?${query.toString()}`, {
    headers: await sessionHeaders()
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Could not generate the Patel Infra report.");
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename=([^;]+)/i.exec(disposition)?.[1]?.replaceAll('"', "") || "bhachunda-patel-infra-report.xlsx";
  return { blob: await response.blob(), filename };
}

export async function saveParcelWorkflow(input: ParcelWorkflowInput): Promise<void> {
  const client = requiredClient();
  const acreage = input.acreage === "" ? null : Number(input.acreage);
  if (acreage !== null && (!Number.isFinite(acreage) || acreage < 0)) {
    throw new Error("Acres must be a positive number.");
  }

  const { error: parcelError } = await client
    .from("parcels")
    .update({
      old_survey_number: input.oldSurveyNumber || null,
      acreage,
      bunch_number: input.bunchNumber || null
    })
    .eq("id", input.parcelId);
  if (parcelError) throw parcelError;

  const receivedOn = input.consentStatus === "received" ? input.consentDate || new Date().toISOString().slice(0, 10) : null;
  const { error: consentError } = await client
    .from("consent_records")
    .upsert({ parcel_id: input.parcelId, status: input.consentStatus, received_on: receivedOn }, { onConflict: "parcel_id" });
  if (consentError) throw consentError;

  const { error: caseError } = await client
    .from("acquisition_cases")
    .upsert({
      parcel_id: input.parcelId,
      acquisition_stage: input.acquisitionStage,
      category: input.category || null,
      target_date: input.targetDate || null
    }, { onConflict: "parcel_id" });
  if (caseError) throw caseError;

  const { error: legalError } = await client
    .from("legal_reviews")
    .upsert({ parcel_id: input.parcelId, legal_remarks: input.legalRemarks || null }, { onConflict: "parcel_id" });
  if (legalError) throw legalError;
}

export async function uploadDriveDocument(parcelId: string, documentTypeCode: string, file: File, ownerId?: string): Promise<{ fileId: string; documentId: string }> {
  const client = requiredClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("Please sign in before uploading a document.");
  const form = new FormData();
  form.append("parcel_id", parcelId);
  form.append("document_type_code", documentTypeCode);
  form.append("file", file);
  if (ownerId) form.append("owner_id", ownerId);
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionData.session.access_token}`, apikey: supabaseKey! },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Drive upload failed.");
  return { fileId: payload.file_id, documentId: payload.document_id };
}

export async function saveOwnerDetails(parcelId: string, ownerId: string, details: OwnerDetailsInput): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/owner-details`, {
    method: "POST",
    headers: { ...await sessionHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ parcel_id: parcelId, owner_id: ownerId, details })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.saved) throw new Error(payload.error || "Could not save owner details.");
}

export async function openDriveDocument(documentId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-document?document_id=${encodeURIComponent(documentId)}`, {
    headers: await sessionHeaders(), signal, cache: "no-store"
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Could not open the attached Drive file.");
  }
  return response.blob();
}

export interface ExistingDriveFile { id: string; name: string; is_folder: boolean; can_attach: boolean; size: number }
export interface DriveFolderListing { folder_id: string; folder_name: string; next_page_token: string | null; files: ExistingDriveFile[] }

export async function listExistingDriveFiles(parcelId: string, folderId?: string, pageToken?: string, signal?: AbortSignal, folderPath: string[] = []): Promise<DriveFolderListing> {
  const query = new URLSearchParams({ parcel_id: parcelId });
  if (folderId) query.set("folder_id", folderId);
  if (pageToken) query.set("page_token", pageToken);
  if (folderPath.length) query.set("folder_path", JSON.stringify(folderPath));
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-files?${query}`, { headers: await sessionHeaders(), signal, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not open the project Drive folder.");
  return payload as DriveFolderListing;
}

export async function linkExistingDriveFile(parcelId: string, code: string, fileId: string, ownerId?: string, folderPath: string[] = []): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-files`, { method: "POST", headers: { ...await sessionHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ parcel_id: parcelId, document_type_code: code, file_id: fileId, owner_id: ownerId || null, folder_path: folderPath }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.linked) throw new Error(payload.error || "Could not link this Drive file.");
}

export interface DriveSetupProgress { total: number; completed: number; remaining: number; processed?: number; account_email?: string | null; public_folders?: string[]; blocked_folders?: Array<{ id: string; name: string }> }

export async function driveFolderSetup(parcelId?: string, readOnly = false, repairExisting = false): Promise<DriveSetupProgress> {
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-folder-setup`, {
    method: readOnly ? "GET" : "POST",
    headers: { ...await sessionHeaders(), "Content-Type": "application/json" },
    ...(readOnly ? {} : { body: JSON.stringify(repairExisting ? { action: "repair_existing" } : { parcel_id: parcelId }) }),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not prepare the survey folders.");
  return payload as DriveSetupProgress;
}

export async function loadGoogleDriveConnectionStatus(): Promise<boolean> {
  const client = requiredClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return false;
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-connection-status`, {
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: supabaseKey!
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not check the Google Drive connection.");
  return payload.connected === true;
}

export async function startGoogleDriveConnection(): Promise<string> {
  const client = requiredClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("Please sign in as an administrator before connecting Google Drive.");
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-oauth-start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: supabaseKey!,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.authorize_url !== "string") throw new Error(payload.error || "Could not start Google Drive connection.");
  return payload.authorize_url;
}

export const consentLabel: Record<ConsentStatus, string> = {
  received: "Received",
  pending: "Pending",
  not_ready: "Not ready",
  blocked: "Blocked",
  rejected: "Rejected"
};
