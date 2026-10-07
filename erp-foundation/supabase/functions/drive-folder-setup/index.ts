import { getOAuthAccessToken, requireRole } from "../_shared/google-drive-oauth.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";
import { ensureExistingTemplate, ensureSurveyStructure, STRUCTURE_VERSION } from "../_shared/drive-folder-structure.ts";
import { childFolders, resolveVillageFolder, surveyFolderKey } from "../_shared/drive-existing-files.ts";
import { UUID } from "../_shared/owner-details.ts";
import { projectFolderPrivacy } from "../_shared/drive-privacy.ts";

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
    if (request.method === "GET") {
      const token = await getOAuthAccessToken(admin);
      const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers: { Authorization: `Bearer ${token}` } });
      const account = about.ok ? await about.json() : {};
      const { data: villages, error: villageError } = await admin.from("villages").select("drive_root_folder_id");
      if (villageError) throw new Error("Could not check the project folder access.");
      const roots = [...new Set<string>((villages || []).map((village) => village.drive_root_folder_id || Deno.env.get("DRIVE_ROOT_FOLDER_ID")).filter(Boolean))];
      const blocked: Array<{ id: string; name: string }> = [];
      const publicFolders: string[] = [];
      for (const root of roots) {
        const file = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(root)}?fields=id,name,capabilities(canAddChildren)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
        const info = file.ok ? await file.json() : {};
        if (!file.ok || info.capabilities?.canAddChildren !== true) blocked.push({ id: root, name: info.name || "Project folder" });
        if (await projectFolderPrivacy(token,root) === "public") publicFolders.push(info.name || "Project folder");
      }
      return json({ total: parcels.length, completed: ids.size, remaining: pending.length, account_email: account.user?.emailAddress || null, blocked_folders: blocked, public_folders: publicFolders }, 200, headers);
    }
    const raw = await request.text();
    if (raw.length > 512) return json({ error: "The request is too large." }, 413, headers);
    let body: { parcel_id?: string; action?: string };
    try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "Invalid setup request." }, 400, headers); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid setup request." }, 400, headers);
    if (body.action === "repair_existing") {
      const token = await getOAuthAccessToken(admin);
      const { data: villages, error: villageError } = await admin.from("villages").select("id,name_en,drive_root_folder_id");
      const { data: bound, error: boundError } = await admin.from("drive_folders").select("google_folder_id");
      const { data: checked, error: checkedError } = await admin.from("drive_existing_folder_templates").select("google_folder_id");
      const { data: records, error: recordError } = await admin.from("parcels").select("id,village_id,survey_number").limit(1000);
      if (villageError || boundError || checkedError || recordError) throw new Error("Could not check existing Drive folders.");
      const registered = new Set((bound || []).map(row => row.google_folder_id));
      const ready = new Set((checked || []).map(row => row.google_folder_id));
      const old: Array<{ id:string; name:string; parentId:string; village:string; parcelId?:string }> = [];
      for (const village of villages || []) {
        const root = village.drive_root_folder_id || Deno.env.get("DRIVE_ROOT_FOLDER_ID");
        const villageId = await resolveVillageFolder(token,root,village.name_en,async () => { throw new Error("Village folder is missing. Run survey setup first."); });
        for (const folder of await childFolders(token,villageId)) {
          if (registered.has(folder.id) || !/^\d/.test(surveyFolderKey(folder.name))) continue;
          const matches = (records || []).filter(p => p.village_id===village.id && surveyFolderKey(p.survey_number)===surveyFolderKey(folder.name));
          if (matches.length>1) throw new Error("An existing folder matches multiple records. Please review it first.");
          old.push({id:folder.id,name:folder.name,parentId:villageId,village:village.name_en,parcelId:matches[0]?.id});
        }
      }
      const missing = old.filter(folder => !ready.has(folder.id));
      let processed=0;
      for (const folder of missing.slice(0,8)) { await ensureExistingTemplate(admin,token,folder); ready.add(folder.id);processed++; }
      const completed=old.filter(folder => ready.has(folder.id)).length;
      return json({total:old.length,completed,remaining:old.length-completed,processed,legacy:true},200,headers);
    }
    if (body.action) return json({error:"Unknown folder action."},400,headers);
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
