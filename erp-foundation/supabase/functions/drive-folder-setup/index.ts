import { getOAuthAccessToken, requireRole } from "../_shared/google-drive-oauth.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";
import { ensureSurveyStructure, STRUCTURE_VERSION } from "../_shared/drive-folder-structure.ts";
import { UUID } from "../_shared/owner-details.ts";

Deno.serve(async (request) => {
  const headers = corsHeaders(request, "GET, POST");
  if (!headers) return json({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405, headers);
  try {
    const { admin, userId } = await requireRole(request, ["admin"]);
    const { data: parcels, error: parcelError } = await admin.from("parcels").select("id").order("id").limit(1000);
    const { data: completed, error: completedError } = await admin.from("drive_folders").select("parcel_id").eq("structure_version", STRUCTURE_VERSION).limit(1000);
    if (parcelError || completedError || !parcels) throw new Error("Could not load folder setup progress.");
    const ids = new Set((completed || []).map((row) => row.parcel_id));
    const pending = parcels.filter((parcel) => !ids.has(parcel.id));
    if (request.method === "GET") return json({ total: parcels.length, completed: ids.size, remaining: pending.length }, 200, headers);
    const raw = await request.text();
    if (raw.length > 512) return json({ error: "The request is too large." }, 413, headers);
    let body: { parcel_id?: string };
    try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "Invalid setup request." }, 400, headers); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid setup request." }, 400, headers);
    if (body.parcel_id && (!UUID.test(body.parcel_id) || !parcels.some((p) => p.id === body.parcel_id))) return json({ error: "Select a valid survey." }, 400, headers);
    const batch = body.parcel_id ? [{ id: body.parcel_id }] : pending.slice(0, 8);
    if (!batch.length) return json({ total: parcels.length, completed: ids.size, remaining: 0, processed: 0 }, 200, headers);
    const token = await getOAuthAccessToken(admin);
    // A bounded batch can finish within the Edge Function request limits.
    // Sequential surveys also prevent concurrent village-folder creation.
    let processed = 0;
    for (const parcel of batch) {
      try {
        await ensureSurveyStructure(admin, token, parcel.id, userId, Boolean(body.parcel_id));
        ids.add(parcel.id); processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Folder setup failed.";
        return json({ total: parcels.length, completed: ids.size, remaining: parcels.length - ids.size, processed, error: message }, 409, headers);
      }
    }
    return json({ total: parcels.length, completed: ids.size, remaining: parcels.length - ids.size, processed }, 200, headers);
  } catch (error) { const failure = authFailure(error); return json({ error: failure.message }, failure.status, headers); }
});
