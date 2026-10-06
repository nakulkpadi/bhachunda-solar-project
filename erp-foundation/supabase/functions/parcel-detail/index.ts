import { createAdminClient, requireRole, type AppRole } from "../_shared/google-drive-oauth.ts";
import { mayViewDocument } from "../_shared/owner-details.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_ROLES: AppRole[] = ["admin", "data_entry", "legal", "finance", "viewer"];

function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get("origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.replace(/\/$/, "");
  if (!allowedOrigin || (origin && origin.replace(/\/$/, "") !== allowedOrigin)) return null;
  return {
    "Access-Control-Allow-Origin": origin ?? allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin"
  };
}

function response(body: Record<string, unknown>, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (!headers) return response({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "GET") return response({ error: "Method not allowed." }, 405, headers);

  try {
    const parcelId = new URL(request.url).searchParams.get("parcel_id") ?? "";
    if (!UUID.test(parcelId)) return response({ error: "A valid survey record is required." }, 400, headers);

    const { admin, userId } = await requireRole(request, ACTIVE_ROLES);
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    const role = profile?.role as AppRole | undefined;
    if (profileError || !role) return response({ error: "Your project role could not be verified." }, 403, headers);

    const { data: parcel, error: parcelError } = await admin
      .from("parcels")
      .select(`
        id, survey_number, old_survey_number, hectare_are_sqmt, acreage,
        account_number, tenure, land_use, rights_and_encumbrances, nondh_numbers,
        bunch_number, latitude, longitude, source_workbook, source_row_number,
        villages!inner(code, name_en, name_gu, district, taluka),
        consent_records(status, received_on, source_value, remarks),
        acquisition_cases(
          project_name, spv_name, mw, category, atl_category, acquisition_purpose,
          project_duration_months, block_name, target_date, execution_date,
          acquisition_stage, reason_not_acquired, total_acres_in_rtc,
          total_acres_to_acquire, total_acres_acquired, total_sq_meters_acquired,
          source_fields
        ),
        legal_reviews(
          public_notice_status, sro_search_status, documents_required,
          documents_submitted, law_firm_verification_status, pending_documents,
          preliminary_tsr_status, conditional_clearance_status, nfa_number,
          nfa_submitted_on, nfa_approved_on, legal_remarks
        ),
        parcel_owners(id, display_name, source_owner_text, sequence_no, is_primary),
        parcel_documents(id, owner_id, document_type_code, status, created_at, original_filename, mime_type, google_file_id, document_types!inner(is_sensitive))
      `)
      .eq("id", parcelId)
      .maybeSingle();
    if (parcelError) throw new Error("Could not load the survey record.");
    if (!parcel) return response({ error: "Survey record was not found." }, 404, headers);

    const owners = Array.isArray(parcel.parcel_owners) ? parcel.parcel_owners : [];
    let privateOwnerDetails: unknown[] = [];
    if (role === "admin" && owners.length) {
      const ownerIds = owners.map((owner) => owner.id);
      const { data, error } = await admin
        .from("owner_private_details")
        .select("owner_id, pan_owner_name, pan_number, aadhaar_owner_name, aadhaar_number, bank_account_number, bank_name, bank_branch, bank_account_type, ifsc_code, vendor_code, bank_owner_name, updated_at")
        .in("owner_id", ownerIds);
      if (error) throw new Error("Could not load restricted owner details.");
      privateOwnerDetails = data ?? [];
    }

    const documents = (Array.isArray(parcel.parcel_documents) ? parcel.parcel_documents : []).map((document) => {
      const documentType = first(document.document_types);
      const allowed = mayViewDocument(role, documentType?.is_sensitive !== false);
      return {
        id: allowed ? document.id : null,
        owner_id: allowed ? document.owner_id : null,
        document_type_code: document.document_type_code,
        status: document.status,
        created_at: document.created_at,
        original_filename: allowed ? document.original_filename : null,
        mime_type: allowed ? document.mime_type : null,
        can_view: allowed && Boolean(document.google_file_id) && ["uploaded", "verified"].includes(document.status)
      };
    });
    return response({
      role,
      parcel: {
        id: parcel.id,
        survey_number: parcel.survey_number,
        old_survey_number: parcel.old_survey_number,
        hectare_are_sqmt: parcel.hectare_are_sqmt,
        acreage: parcel.acreage,
        account_number: parcel.account_number,
        tenure: parcel.tenure,
        land_use: parcel.land_use,
        rights_and_encumbrances: parcel.rights_and_encumbrances,
        nondh_numbers: parcel.nondh_numbers,
        bunch_number: parcel.bunch_number,
        latitude: parcel.latitude,
        longitude: parcel.longitude,
        source_workbook: parcel.source_workbook,
        source_row_number: parcel.source_row_number,
        village: first(parcel.villages),
        consent: first(parcel.consent_records),
        acquisition: first(parcel.acquisition_cases),
        legal: first(parcel.legal_reviews),
        owners: owners.map((owner) => ({
          id: owner.id,
          display_name: owner.display_name,
          source_owner_text: owner.source_owner_text,
          sequence_no: owner.sequence_no,
          is_primary: owner.is_primary
        })),
        documents,
        private_owner_details: privateOwnerDetails
      }
    }, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the survey record.";
    const safeMessage = /authentication|role/i.test(message) ? message : "Could not load the survey record.";
    return response({ error: safeMessage }, 500, headers);
  }
});
