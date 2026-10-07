import { getOAuthAccessToken, requireRole } from "../_shared/google-drive-oauth.ts";
import { mayViewDocument, UUID } from "../_shared/owner-details.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";

Deno.serve(async (request) => {
  const headers = corsHeaders(request, "GET");
  if (!headers) return json({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, headers);
  try {
    const { admin, userId } = await requireRole(request, ["admin", "editor", "commenter", "data_entry", "legal", "finance", "viewer"]);
    const documentId = new URL(request.url).searchParams.get("document_id") ?? "";
    if (!UUID.test(documentId)) return json({ error: "Select an attached document." }, 400, headers);
    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (profileError || !profile) return json({ error: "Your project role could not be verified." }, 403, headers);
    const { data: document, error } = await admin.from("parcel_documents").select("google_file_id,original_filename,mime_type,byte_size,status,document_types!inner(is_sensitive)").eq("id", documentId).maybeSingle();
    if (error) throw new Error("Document lookup failed.");
    const documentType = Array.isArray(document?.document_types) ? document.document_types[0] : document?.document_types;
    if (!document?.google_file_id || !documentType || !mayViewDocument(profile.role, documentType.is_sensitive !== false)) return json({ error: "This document is unavailable for your account." }, 404, headers);
    if (!["uploaded", "verified"].includes(document.status)) return json({ error: "This document is not available to view." }, 404, headers);
    if (!/^[A-Za-z0-9_-]+$/.test(document.google_file_id) || Number(document.byte_size || 0) > 15 * 1024 * 1024) return json({ error: "This document cannot be previewed." }, 400, headers);
    const token = await getOAuthAccessToken(admin);
    const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.google_file_id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, signal: request.signal });
    if (!upstream.ok) return json({ error: upstream.status === 404 ? "The file could not be found in Google Drive." : "Google Drive could not open this file. Please check the connection." }, 502, headers);
    if (Number(upstream.headers.get("content-length") || 0) > 15 * 1024 * 1024) return json({ error: "This file is over the preview limit." }, 413, headers);
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
    const mime = allowed.has(document.mime_type || "") ? document.mime_type : "application/octet-stream";
    const filename = (document.original_filename || "project-document").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
    return new Response(upstream.body, { status: 200, headers: { ...headers, "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="project-document"; filename*=UTF-8''${encodeURIComponent(filename)}` } });
  } catch (error) {
    const failure = authFailure(error);
    return json({ error: failure.message }, failure.status, headers);
  }
});
