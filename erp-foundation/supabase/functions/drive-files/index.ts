import { getOAuthAccessToken, requireRole } from "../_shared/google-drive-oauth.ts";
import { ownerMatchesParcel, OWNER_DOCUMENT_TYPES, UUID } from "../_shared/owner-details.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";
import { canAttach, DRIVE_ID, FOLDER_MIME, getDriveFile, insideProjectFolder, verifiedFolderPath, type DriveFile } from "../_shared/drive-existing-files.ts";
import { DOCUMENT_CODES } from "../_shared/drive-folder-structure.ts";

const DOCUMENT_TYPES = DOCUMENT_CODES;

Deno.serve(async (request) => {
  const headers = corsHeaders(request, "GET, POST");
  if (!headers) return json({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405, headers);
  try {
    const { admin, userId } = await requireRole(request, ["admin"]);
    const query = new URL(request.url).searchParams;
    let body: Record<string, unknown> = {};
    if (request.method === "POST") {
      const raw = await request.text();
      if (raw.length > 4096) return json({ error: "The request is too large." }, 413, headers);
      try { body = JSON.parse(raw); } catch { return json({ error: "Invalid file link." }, 400, headers); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid file link." }, 400, headers);
    }
    const parcelId = request.method === "GET" ? query.get("parcel_id") : body.parcel_id;
    if (typeof parcelId !== "string" || !UUID.test(parcelId)) return json({ error: "Select a valid survey." }, 400, headers);
    const { data: parcel, error: parcelError } = await admin.from("parcels").select("villages!inner(drive_root_folder_id)").eq("id", parcelId).maybeSingle();
    if (parcelError || !parcel) return json({ error: "Survey not found." }, 404, headers);
    const village = Array.isArray(parcel.villages) ? parcel.villages[0] : parcel.villages;
    const rootId = village?.drive_root_folder_id || Deno.env.get("DRIVE_ROOT_FOLDER_ID");
    if (!rootId || !DRIVE_ID.test(rootId)) throw new Error("Project Drive folder is not configured.");
    let ownerId: string | null = null;
    if (request.method === "POST") {
      const code = body.document_type_code;
      ownerId = typeof body.owner_id === "string" && body.owner_id ? body.owner_id : null;
      if (typeof code !== "string" || !DOCUMENT_TYPES.has(code) || (ownerId && !UUID.test(ownerId))) return json({ error: "Select a valid document type and owner." }, 400, headers);
      if (OWNER_DOCUMENT_TYPES.has(code) && !ownerId) return json({ error: "Select the owner for this KYC file." }, 400, headers);
      if (ownerId) {
        const { data: owner, error } = await admin.from("parcel_owners").select("parcel_id").eq("id", ownerId).maybeSingle();
        if (error || !ownerMatchesParcel(owner, parcelId)) return json({ error: "This owner does not belong to this survey." }, 400, headers);
      }
    }
    const targetId = request.method === "GET" ? (query.get("folder_id") || rootId) : body.file_id;
    if (typeof targetId !== "string" || !DRIVE_ID.test(targetId)) return json({ error: "Select a file in the project Drive folder." }, 400, headers);
    const token = await getOAuthAccessToken(admin);
    const file = await getDriveFile(token, targetId);
    let folderPath: unknown = body.folder_path || [];
    if (request.method === "GET") {
      const encodedPath = query.get("folder_path") || "[]";
      if (encodedPath.length > 4096) return json({ error: "Invalid folder path." }, 400, headers);
      try { folderPath = JSON.parse(encodedPath); } catch { return json({ error: "Invalid folder path." }, 400, headers); }
    }
    if (!Array.isArray(folderPath) || folderPath.length > 12 || folderPath.some((id) => typeof id !== "string" || !DRIVE_ID.test(id))) return json({ error: "Invalid folder path." }, 400, headers);
    const inProject = !file.trashed && (await insideProjectFolder(token, rootId, file) || await verifiedFolderPath(token, rootId, folderPath, file.id));
    if (!inProject) return json({ error: "Only files in the project Drive folder can be linked." }, 403, headers);
    if (request.method === "GET") {
      if (file.mimeType !== FOLDER_MIME) return json({ error: "Select a folder." }, 400, headers);
      const pageToken = query.get("page_token") || "";
      if (pageToken.length > 2048) return json({ error: "Invalid page." }, 400, headers);
      const parameters = new URLSearchParams({ q: `'${targetId}' in parents and trashed = false`, fields: "nextPageToken,files(id,name,mimeType,size,trashed)", pageSize: "100", orderBy: "folder,name_natural", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      if (pageToken) parameters.set("pageToken", pageToken);
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?${parameters}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Could not list the project folder.");
      const data = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
      return json({ folder_id: file.id, folder_name: file.name, next_page_token: data.nextPageToken || null, files: (data.files || []).map((item) => ({ id: item.id, name: item.name, is_folder: item.mimeType === FOLDER_MIME, can_attach: canAttach(item), size: Number(item.size || 0) })) }, 200, headers);
    }
    if (!canAttach(file)) return json({ error: "Choose a PDF, JPG, PNG, DOCX or XLSX file up to 15 MB." }, 400, headers);
    let existingQuery = admin.from("parcel_documents").select("id").eq("parcel_id", parcelId).eq("google_file_id", file.id).eq("document_type_code", body.document_type_code);
    existingQuery = ownerId ? existingQuery.eq("owner_id", ownerId) : existingQuery.is("owner_id", null);
    const { data: existing, error: existingError } = await existingQuery.limit(1).maybeSingle();
    if (existingError) throw new Error("Document lookup failed.");
    if (existing) return json({ document_id: existing.id, linked: true }, 200, headers);
    const { data: document, error } = await admin.from("parcel_documents").insert({ parcel_id: parcelId, owner_id: ownerId, document_type_code: body.document_type_code, google_file_id: file.id, original_filename: file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200), mime_type: file.mimeType, byte_size: Number(file.size), status: "uploaded", uploaded_by: userId }).select("id").single();
    if (error || !document) throw new Error("The file link could not be saved.");
    await admin.from("activity_log").insert({ parcel_id: parcelId, actor_id: userId, action: "existing_drive_document_linked", entity_type: "parcel_document", entity_id: document.id, summary: `${body.document_type_code} linked from project Drive folder` });
    return json({ document_id: document.id, linked: true }, 201, headers);
  } catch (error) {
    const failure = authFailure(error);
    return json({ error: failure.message }, failure.status, headers);
  }
});
