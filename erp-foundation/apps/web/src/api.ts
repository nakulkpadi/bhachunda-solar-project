import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { ConsentStatus, MapStatus, ParcelSummary, ParcelWorkflowInput } from "./types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();

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

export async function uploadDriveDocument(parcelId: string, documentTypeCode: string, file: File): Promise<{ fileId: string; webViewLink: string | null }> {
  const client = requiredClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("Please sign in before uploading a document.");
  const form = new FormData();
  form.append("parcel_id", parcelId);
  form.append("document_type_code", documentTypeCode);
  form.append("file", file);
  const response = await fetch(`${supabaseUrl}/functions/v1/drive-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionData.session.access_token}`, apikey: supabaseKey! },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Drive upload failed.");
  return { fileId: payload.file_id, webViewLink: payload.web_view_link ?? null };
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
