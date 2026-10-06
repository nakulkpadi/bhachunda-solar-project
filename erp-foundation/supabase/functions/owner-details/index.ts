import { requireRole } from "../_shared/google-drive-oauth.ts";
import { normaliseOwnerDetails, ownerMatchesParcel, UUID } from "../_shared/owner-details.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";

Deno.serve(async (request) => {
  const headers = corsHeaders(request, "POST");
  if (!headers) return json({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, headers);
  try {
    const { admin, userId } = await requireRole(request, ["admin"]);
    if (Number(request.headers.get("content-length") || 0) > 8192) return json({ error: "Owner details are too large." }, 413, headers);
    const raw = await request.text();
    if (raw.length > 8192) return json({ error: "Owner details are too large." }, 413, headers);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid owner details." }, 400, headers); }
    if (!body || typeof body !== "object" || typeof body.parcel_id !== "string" || typeof body.owner_id !== "string" || !UUID.test(body.parcel_id) || !UUID.test(body.owner_id)) return json({ error: "Select a valid survey and owner." }, 400, headers);
    const { data: owner, error: ownerError } = await admin.from("parcel_owners").select("parcel_id").eq("id", body.owner_id).maybeSingle();
    if (ownerError) throw new Error("Owner lookup failed.");
    if (!ownerMatchesParcel(owner, body.parcel_id)) return json({ error: "This owner does not belong to the selected survey." }, 400, headers);
    let details: Record<string, string | null>;
    try { details = normaliseOwnerDetails(body.details); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid owner details." }, 400, headers); }
    const { error } = await admin.from("owner_private_details").upsert({ ...details, owner_id: body.owner_id, updated_by: userId }, { onConflict: "owner_id" });
    if (error) throw new Error("Owner details save failed.");
    return json({ saved: true, owner_id: body.owner_id, parcel_id: body.parcel_id }, 200, headers);
  } catch (error) {
    const failure = authFailure(error);
    return json({ error: failure.message }, failure.status, headers);
  }
});
