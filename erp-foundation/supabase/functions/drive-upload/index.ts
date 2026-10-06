import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { createAdminClient, getOAuthAccessToken } from "../_shared/google-drive-oauth.ts";
import { ownerMatchesParcel, OWNER_DOCUMENT_TYPES } from "../_shared/owner-details.ts";
import { resolveSurveyFolder } from "../_shared/drive-existing-files.ts";

type AppRole = "admin" | "data_entry" | "legal" | "finance" | "viewer";
type GoogleServiceAccount = { client_email: string; private_key: string };

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCEPTED_DOCUMENT_TYPES = new Set([
  "current_712", "nondh_6", "aadhaar", "pan", "bank_details", "consent_letter", "old_712", "old_nondh_6", "mutation_death_certificate"
]);
const FILE_TYPES: Record<string, { mime: string; signature: "pdf" | "jpeg" | "png" | "zip" }> = {
  pdf: { mime: "application/pdf", signature: "pdf" },
  jpg: { mime: "image/jpeg", signature: "jpeg" },
  jpeg: { mime: "image/jpeg", signature: "jpeg" },
  png: { mime: "image/png", signature: "png" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signature: "zip" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signature: "zip" }
};

let cachedGoogleToken: { accessToken: string; expiresAt: number } | null = null;

function response(body: Record<string, unknown>, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get("origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.replace(/\/$/, "");
  if (!allowedOrigin) return null;
  if (origin && origin.replace(/\/$/, "") !== allowedOrigin) return null;
  return {
    "Access-Control-Allow-Origin": origin ?? allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function createGoogleJwt(serviceAccount: GoogleServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3300
  }));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(unsignedToken)));
  return `${unsignedToken}.${base64Url(signature)}`;
}

async function getServiceAccountAccessToken(): Promise<string> {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.accessToken;
  const rawAccount = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!rawAccount) throw new Error("Google Drive service account is not configured.");
  let account: GoogleServiceAccount;
  try {
    account = JSON.parse(rawAccount) as GoogleServiceAccount;
  } catch {
    throw new Error("Google Drive service account configuration is invalid.");
  }
  if (!account.client_email || !account.private_key) throw new Error("Google Drive service account is incomplete.");
  const assertion = await createGoogleJwt(account);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  if (!tokenResponse.ok) throw new Error("Google Drive authentication failed.");
  const token = await tokenResponse.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Google Drive did not return an access token.");
  cachedGoogleToken = { accessToken: token.access_token, expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3000) * 1000 };
  return token.access_token;
}

async function getGoogleAccessToken(admin: SupabaseClient): Promise<string> {
  const mode = (Deno.env.get("GOOGLE_DRIVE_AUTH_MODE") || "oauth").toLowerCase();
  if (mode === "oauth") return getOAuthAccessToken(admin);
  if (mode === "service_account") return getServiceAccountAccessToken();
  throw new Error("Google Drive authentication mode is invalid.");
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").slice(0, 120) || "document";
}

function extensionOf(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLocaleLowerCase() ?? "";
  return extension;
}

function hasSignature(bytes: Uint8Array, signature: "pdf" | "jpeg" | "png" | "zip"): boolean {
  if (signature === "pdf") return bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (signature === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (signature === "png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function validateFile(file: File): Promise<{ extension: string; mime: string; contents: ArrayBuffer }> {
  if (file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error("File must be between 1 byte and 15 MB.");
  const extension = extensionOf(file.name);
  const expected = FILE_TYPES[extension];
  if (!expected) throw new Error("Only PDF, JPG, PNG, DOCX and XLSX files are accepted.");
  if (file.type && file.type !== expected.mime) throw new Error("The file’s declared type does not match its extension.");
  const contents = await file.arrayBuffer();
  if (!hasSignature(new Uint8Array(contents.slice(0, 12)), expected.signature)) throw new Error("The file signature does not match its extension.");
  return { extension, mime: expected.mime, contents };
}

async function sha256(contents: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", contents));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function googleCreateFolder(accessToken: string, folderName: string, parentId: string): Promise<string> {
  const apiResponse = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
  });
  if (!apiResponse.ok) throw new Error("Google Drive folder creation failed.");
  const folder = await apiResponse.json() as { id?: string };
  if (!folder.id) throw new Error("Google Drive did not return a folder ID.");
  return folder.id;
}

async function googleUploadFile(accessToken: string, fileName: string, file: File, mime: string, parentId: string): Promise<{ id: string }> {
  const boundary = `bhachunda-${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name: fileName, mimeType: mime, parents: [parentId] }),
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`
  ]);
  const apiResponse = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  if (!apiResponse.ok) throw new Error("Google Drive file upload failed.");
  const uploaded = await apiResponse.json() as { id?: string };
  if (!uploaded.id) throw new Error("Google Drive did not return a file ID.");
  return { id: uploaded.id };
}

async function googleDeleteFile(accessToken: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (!headers) return response({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405, headers);

  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return response({ error: "Authentication is required." }, 401, headers);
    const admin = createAdminClient();
    const accessToken = authorization.slice("Bearer ".length);
    const { data: userResult, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !userResult.user) return response({ error: "Authentication is invalid or expired." }, 401, headers);

    const formData = await request.formData();
    const parcelId = String(formData.get("parcel_id") ?? "");
    const documentTypeCode = String(formData.get("document_type_code") ?? "");
    const ownerIdRaw = formData.get("owner_id");
    const ownerId = ownerIdRaw ? String(ownerIdRaw) : null;
    const file = formData.get("file");
    if (!UUID.test(parcelId) || (ownerId && !UUID.test(ownerId))) return response({ error: "Invalid parcel or owner ID." }, 400, headers);
    if (!ACCEPTED_DOCUMENT_TYPES.has(documentTypeCode)) return response({ error: "Unknown document type." }, 400, headers);
    if (!(file instanceof File)) return response({ error: "One document file is required." }, 400, headers);

    const { data: profile, error: profileError } = await admin.from("profiles").select("role,is_active").eq("id", userResult.user.id).maybeSingle();
    const role = profile?.role as AppRole | undefined;
    if (profileError || !profile?.is_active || role !== "admin") return response({ error: "Only the administrator can upload documents." }, 403, headers);

    const { data: parcel, error: parcelError } = await admin
      .from("parcels")
      .select("id,survey_number,villages!inner(code,name_en,drive_root_folder_id)")
      .eq("id", parcelId)
      .maybeSingle();
    if (parcelError || !parcel) return response({ error: "Survey record was not found." }, 404, headers);
    if (OWNER_DOCUMENT_TYPES.has(documentTypeCode) && !ownerId) return response({ error: "Select the owner for this identity or bank document." }, 400, headers);
    if (ownerId) {
      const { data: owner, error: ownerError } = await admin.from("parcel_owners").select("parcel_id").eq("id", ownerId).maybeSingle();
      if (ownerError) throw new Error("Could not verify the selected owner.");
      if (!ownerMatchesParcel(owner, parcelId)) return response({ error: "This owner does not belong to the selected survey." }, 400, headers);
    }
    const village = Array.isArray(parcel.villages) ? parcel.villages[0] : parcel.villages;
    const rootFolderId = village?.drive_root_folder_id ?? Deno.env.get("DRIVE_ROOT_FOLDER_ID");
    if (!rootFolderId) throw new Error("No Google Drive root folder is configured for this village.");

    let validated: { extension: string; mime: string; contents: ArrayBuffer };
    try {
      validated = await validateFile(file);
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "File validation failed." }, 400, headers);
    }
    const hash = await sha256(validated.contents);
    const googleAccessToken = await getGoogleAccessToken(admin);
    let folderId: string;
    const { data: existingFolder, error: folderLookupError } = await admin.from("drive_folders").select("google_folder_id").eq("parcel_id", parcelId).maybeSingle();
    if (folderLookupError) throw new Error("Could not look up the parcel folder.");
    if (existingFolder?.google_folder_id) {
      folderId = existingFolder.google_folder_id;
    } else {
      folderId = await resolveSurveyFolder(googleAccessToken, rootFolderId, village.name_en, parcel.survey_number, (name, parentId) => googleCreateFolder(googleAccessToken, safeSegment(name), parentId));
      const { error: folderInsertError } = await admin.from("drive_folders").insert({ parcel_id: parcelId, google_folder_id: folderId, folder_name: safeSegment(`${village.name_en} / ${parcel.survey_number}`), created_by: userResult.user.id });
      if (folderInsertError) {
        const { data: racedFolder } = await admin.from("drive_folders").select("google_folder_id").eq("parcel_id", parcelId).maybeSingle();
        if (!racedFolder?.google_folder_id) throw new Error("Could not register the parcel folder.");
        folderId = racedFolder.google_folder_id;
      }
    }

    const ownerSegment = ownerId ? `_owner-${ownerId}` : "";
    const storedName = safeSegment(`${village.code}_${parcel.survey_number}${ownerSegment}_${documentTypeCode}_${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID().slice(0, 8)}.${validated.extension}`);
    const uploaded = await googleUploadFile(googleAccessToken, storedName, file, validated.mime, folderId);
    const { data: document, error: documentError } = await admin
      .from("parcel_documents")
      .insert({
        parcel_id: parcelId,
        owner_id: ownerId,
        document_type_code: documentTypeCode,
        status: "uploaded",
        google_file_id: uploaded.id,
        original_filename: safeSegment(file.name),
        mime_type: validated.mime,
        byte_size: file.size,
        checksum_sha256: hash,
        uploaded_by: userResult.user.id
      })
      .select("id")
      .single();
    if (documentError || !document) {
      await googleDeleteFile(googleAccessToken, uploaded.id);
      throw new Error("Could not record the uploaded document.");
    }
    await admin.from("activity_log").insert({
      parcel_id: parcelId,
      actor_id: userResult.user.id,
      action: "drive_document_uploaded",
      entity_type: "parcel_document",
      entity_id: document.id,
      summary: `${documentTypeCode} uploaded`
    });
    return response({ document_id: document.id, file_id: uploaded.id, filename: storedName }, 201, headers);
  } catch (error) {
    // Do not log request payloads, access tokens, filenames or landowner data.
    const message = error instanceof Error ? error.message : "Document upload failed.";
    return response({ error: message }, 500, headers);
  }
});
