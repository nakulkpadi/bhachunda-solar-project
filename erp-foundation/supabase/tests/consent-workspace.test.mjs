import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../functions");
const parcelId = "10000000-0000-4000-8000-000000000001";
const otherParcelId = "10000000-0000-4000-8000-000000000002";
const ownerId = "20000000-0000-4000-8000-000000000001";
const documentId = "30000000-0000-4000-8000-000000000001";
const origin = "https://nakulkpadi.github.io";

async function harness(slug, overrides = {}) {
  const state = { role: "admin", active: true, ownerParcel: parcelId, sensitive: true, documentStatus: "uploaded", writes: [], google: [], failDocumentInsert: false, ...overrides };
  const run = (table, operation, values) => {
    if (operation !== "select") state.writes.push({ table, operation, values });
    if (table === "profiles") return { data: { role: state.role, is_active: state.active }, error: null };
    if (table === "parcel_owners") return { data: state.ownerParcel ? { parcel_id: state.ownerParcel } : null, error: null };
    if (table === "parcels") return { data: { id: parcelId, survey_number: "451", villages: { code: "BVP", name_en: "Bhavanipar", drive_root_folder_id: "existing-root" } }, error: null };
    if (table === "drive_folders") return { data: state.noExistingFolder ? null : { google_folder_id: "existing-survey-folder" }, error: null };
    if (table === "parcel_documents") return operation === "insert" ? { data: state.failDocumentInsert ? null : { id: documentId }, error: state.failDocumentInsert ? new Error("insert failed") : null } : slug === "drive-files" ? { data: state.alreadyLinked ? { id: documentId } : null, error: null } : { data: { google_file_id: "existing-file-id", original_filename: "consent.pdf", mime_type: "application/pdf", byte_size: 15, status: state.documentStatus, document_types: { is_sensitive: state.sensitive } }, error: null };
    return { data: null, error: null };
  };
  const admin = {
    auth: { getUser: async (token) => ({ data: { user: token === "valid-session" ? { id: "test-admin-user" } : null }, error: null }) },
    from(table) {
      let operation = "select", values;
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, limit() { return query; },
        insert(input) { operation = "insert"; values = input; return query; },
        upsert(input) { operation = "upsert"; values = input; return query; },
        maybeSingle: async () => run(table, operation, values),
        single: async () => run(table, operation, values),
        then(onFulfilled, onRejected) { return Promise.resolve(run(table, operation, values)).then(onFulfilled, onRejected); }
      };
      return query;
    }
  };
  let handler;
  const context = vm.createContext({ Error, Request, Response, Headers, URL, URLSearchParams, FormData, File, Blob, TextEncoder, TextDecoder, Uint8Array, crypto, btoa, atob,
    Deno: { env: { get: (key) => ({ ALLOWED_ORIGIN: origin, GOOGLE_DRIVE_AUTH_MODE: "oauth" })[key] }, serve: (fn) => { handler = fn; } },
    fetch: async (url, options = {}) => {
      const call = { url: String(url), ...options };
      if (options.body instanceof Blob) call.bodyText = await options.body.text();
      state.google.push(call);
      if (slug === "drive-upload" && state.noExistingFolder && new URL(url).searchParams.get("q")) {
        const root = new URL(url).searchParams.get("q").includes("'existing-root' in parents");
        return new Response(JSON.stringify({ files: [{ id: root ? "existing-village-folder" : "existing-survey-folder", name: root ? "Bhavanipur" : "451", mimeType: "application/vnd.google-apps.folder" }] }));
      }
      if (String(url).includes("fields=id,name,mimeType")) {
        const id = new URL(url).pathname.split("/").pop();
        const folderMime = "application/vnd.google-apps.folder";
        const metadata = {
          "existing-root": { id, name: "Project folder", mimeType: folderMime, parents: [] },
          "existing-survey-folder": { id, name: "Survey 451", mimeType: folderMime, parents: ["existing-root"] },
          "existing-file-id": { id, name: "consent.pdf", mimeType: "application/pdf", size: state.oversizedFile ? "20000000" : "15", parents: ["existing-survey-folder"] },
          "outside-file": { id, name: "Outside.pdf", mimeType: "application/pdf", size: "15", parents: ["outside-folder"] },
          "outside-folder": { id, name: "Outside", mimeType: folderMime, parents: [] }
        };
        const item = metadata[id] || { id, parents: [] };
        if (state.omitDriveParents) delete item.parents;
        return new Response(JSON.stringify(item));
      }
      if (String(url).includes("/drive/v3/files?") && options.method !== "POST") return new Response(JSON.stringify({ files: [{ id: "existing-file-id", name: "consent.pdf", mimeType: "application/pdf", size: "15" }, { id: "existing-survey-folder", name: "Survey 451", mimeType: "application/vnd.google-apps.folder" }] }));
      if (String(url).includes("/upload/")) return new Response(JSON.stringify({ id: "new-drive-file-id" }));
      if (options.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("%PDF-test-preview", { headers: { "Content-Type": "application/pdf" } });
    }
  });
  const oauth = new vm.SyntheticModule(["createAdminClient", "getOAuthAccessToken", "requireRole"], function () {
    this.setExport("createAdminClient", () => admin);
    this.setExport("getOAuthAccessToken", async () => "test-drive-token");
    this.setExport("requireRole", async (request, roles) => {
      if (request.headers.get("authorization") !== "Bearer valid-session") throw new Error("Authentication is required.");
      if (!state.active || !roles.includes(state.role)) throw new Error("Your role cannot perform this action.");
      return { admin, userId: "test-admin-user" };
    });
  }, { context });
  const modules = new Map();
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    const source = stripTypeScriptTypes(await readFile(path, "utf8"), { mode: "strip" });
    const module = new vm.SourceTextModule(source, { context, identifier: path });
    modules.set(path, module);
    await module.link((specifier, parent) => specifier.endsWith("google-drive-oauth.ts") ? oauth : load(resolve(dirname(parent.identifier), specifier)));
    return module;
  }
  const entry = await load(resolve(root, slug, "index.ts"));
  await entry.evaluate();
  return { state, handler, helpers: modules.get(resolve(root, "_shared/owner-details.ts"))?.namespace };
}

function ownerRequest(details, extra = {}) {
  return new Request("https://project.supabase.co/functions/v1/owner-details", { method: "POST", headers: { Origin: origin, Authorization: "Bearer valid-session", "Content-Type": "application/json" }, body: JSON.stringify({ parcel_id: parcelId, owner_id: ownerId, details, ...extra }) });
}

function uploadRequest(code = "pan", owner = ownerId, contents = "%PDF-test", auth = "valid-session") {
  const form = new FormData(); form.set("parcel_id", parcelId); form.set("document_type_code", code); if (owner) form.set("owner_id", owner);
  form.set("file", new File([contents], "test.pdf", { type: "application/pdf" }));
  return new Request("https://project.supabase.co/functions/v1/drive-upload", { method: "POST", headers: { Origin: origin, Authorization: `Bearer ${auth}` }, body: form });
}

test("owner save keeps all names, bank branch/type and leading zeroes, whitelists fields", async () => {
  const { state, handler } = await harness("owner-details");
  const response = await handler(ownerRequest({ pan_owner_name: " PAN Name ", pan_number: "abcde1234f", aadhaar_owner_name: "Aadhaar Name", aadhaar_number: "2345 6789 0123", bank_owner_name: "Bank Name", bank_account_number: "00123456789", bank_branch: "Bitta", bank_name: "Test Bank", ifsc_code: "abcd0123456", bank_account_type: "SB", owner_id: "attempted-overwrite", updated_by: "attempted-overwrite" }));
  assert.equal(response.status, 200);
  const saved = state.writes.find((write) => write.table === "owner_private_details").values;
  assert.equal(saved.pan_owner_name, "PAN Name"); assert.equal(saved.pan_number, "ABCDE1234F"); assert.equal(saved.aadhaar_owner_name, "Aadhaar Name");
  assert.equal(saved.aadhaar_number, "234567890123"); assert.equal(saved.bank_account_number, "00123456789"); assert.equal(saved.bank_branch, "Bitta"); assert.equal(saved.bank_account_type, "SB");
  assert.equal(saved.ifsc_code, "ABCD0123456"); assert.equal(saved.owner_id, ownerId); assert.equal(saved.updated_by, "test-admin-user");
  assert.equal(state.google.length, 0); assert.equal(state.writes.some((write) => write.table === "consent_records"), false);
});

test("all four bank account types are accepted and optional fields may be cleared", async () => {
  const { helpers } = await harness("owner-details");
  for (const value of ["SB", "CA", "OD", "CC"]) assert.equal(helpers.normaliseOwnerDetails({ bank_account_type: value }).bank_account_type, value);
  assert.equal(helpers.normaliseOwnerDetails({ pan_number: " " }).pan_number, null);
});

test("invalid PAN, Aadhaar, IFSC, account type and numeric fields are rejected", async () => {
  const { helpers } = await harness("owner-details");
  for (const value of [{ pan_number: "wrong" }, { aadhaar_number: "123" }, { ifsc_code: "WRONG" }, { bank_account_type: "OTHER" }, { bank_account_number: 123456 }, { bank_account_number: "abc123" }]) assert.throws(() => helpers.normaliseOwnerDetails(value));
});

test("owner details cannot be saved for an owner belonging to another survey", async () => {
  const { handler, state } = await harness("owner-details", { ownerParcel: otherParcelId });
  assert.equal((await handler(ownerRequest({ bank_branch: "Test" }))).status, 400); assert.equal(state.writes.length, 0);
});

test("read-only and inactive accounts cannot save owner details", async () => {
  for (const override of [{ role: "viewer" }, { role: "data_entry" }, { active: false }]) {
    const { handler, state } = await harness("owner-details", override); assert.equal((await handler(ownerRequest({}))).status, 403); assert.equal(state.writes.length, 0);
  }
});

test("private owner save requires authentication and exact allowed origin", async () => {
  const { handler, state } = await harness("owner-details");
  assert.equal((await handler(new Request("https://project.supabase.co", { method: "POST", headers: { Origin: origin }, body: "{}" }))).status, 401);
  assert.equal((await handler(new Request("https://project.supabase.co", { method: "POST", headers: { Origin: "https://untrusted.example", Authorization: "Bearer valid-session" }, body: "{}" }))).status, 403);
  assert.equal(state.writes.length, 0);
});

test("owner PAN upload links exact owner, survey, Drive file and existing survey folder", async () => {
  const { handler, state } = await harness("drive-upload"); assert.equal((await handler(uploadRequest())).status, 201);
  const metadata = state.writes.find((write) => write.table === "parcel_documents").values;
  assert.equal(metadata.parcel_id, parcelId); assert.equal(metadata.owner_id, ownerId); assert.equal(metadata.google_file_id, "new-drive-file-id"); assert.equal(metadata.document_type_code, "pan");
  const multipart = state.google.find((call) => call.url.includes("/upload/")).bodyText;
  assert.ok(multipart.includes('"parents":["existing-survey-folder"]')); assert.ok(multipart.includes(`owner-${ownerId}`));
  assert.equal(state.writes.some((write) => write.table === "consent_records"), false);
});

test("identity uploads require a matching owner before any Drive call", async () => {
  for (const code of ["pan", "aadhaar", "bank_details"]) {
    const missing = await harness("drive-upload"); assert.equal((await missing.handler(uploadRequest(code, null))).status, 400); assert.equal(missing.state.google.length, 0);
    const wrong = await harness("drive-upload", { ownerParcel: otherParcelId }); assert.equal((await wrong.handler(uploadRequest(code))).status, 400); assert.equal(wrong.state.google.length, 0);
  }
});

test("survey consent letter upload does not require an owner or change consent", async () => {
  const { handler, state } = await harness("drive-upload"); assert.equal((await handler(uploadRequest("consent_letter", null))).status, 201);
  assert.equal(state.writes.find((write) => write.table === "parcel_documents").values.owner_id, null); assert.equal(state.writes.some((write) => write.table === "consent_records"), false);
});

test("wrong file signatures and non-admin uploads do not reach Google Drive", async () => {
  const bad = await harness("drive-upload"); assert.equal((await bad.handler(uploadRequest("pan", ownerId, "not-a-pdf"))).status, 400); assert.equal(bad.state.google.length, 0);
  const viewer = await harness("drive-upload", { role: "viewer" }); assert.equal((await viewer.handler(uploadRequest())).status, 403); assert.equal(viewer.state.google.length, 0);
});

test("failed Supabase document insert deletes only the newly uploaded Drive file", async () => {
  const { handler, state } = await harness("drive-upload", { failDocumentInsert: true }); assert.equal((await handler(uploadRequest())).status, 500);
  const deletes = state.google.filter((call) => call.method === "DELETE"); assert.equal(deletes.length, 1); assert.ok(deletes[0].url.includes("/new-drive-file-id?"));
});

test("admin document view uses the database file ID, private response and authenticated Google request", async () => {
  const { handler, state } = await harness("drive-document");
  const response = await handler(new Request(`https://project.supabase.co?document_id=${documentId}&file_id=arbitrary-file`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(await response.text(), "%PDF-test-preview"); assert.equal(state.google.length, 1); assert.equal(state.google[0].url, "https://www.googleapis.com/drive/v3/files/existing-file-id?alt=media");
  assert.equal(state.google[0].headers.Authorization, "Bearer test-drive-token");
});

test("sensitive file view denies viewer, legal and finance accounts without calling Drive", async () => {
  for (const role of ["viewer", "legal", "finance", "data_entry"]) {
    const { handler, state } = await harness("drive-document", { role }); const response = await handler(new Request(`https://project.supabase.co?document_id=${documentId}`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } }));
    assert.equal(response.status, 404); assert.equal(state.google.length, 0);
  }
});

test("read-only accounts can view non-sensitive land records", async () => {
  const { handler } = await harness("drive-document", { role: "viewer", sensitive: false }); assert.equal((await handler(new Request(`https://project.supabase.co?document_id=${documentId}`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } }))).status, 200);
});

test("missing session, inactive account and invalid document ID cannot fetch a file", async () => {
  for (const scenario of [{ auth: "invalid", status: 401 }, { active: false, auth: "valid-session", status: 403 }, { id: "arbitrary-google-file", auth: "valid-session", status: 400 }]) {
    const { handler, state } = await harness("drive-document", scenario);
    assert.equal((await handler(new Request(`https://project.supabase.co?document_id=${scenario.id || documentId}`, { headers: { Origin: origin, Authorization: `Bearer ${scenario.auth}` } }))).status, scenario.status); assert.equal(state.google.length, 0);
  }
});

function linkRequest(extra = {}) {
  return new Request("https://project.supabase.co/functions/v1/drive-files", { method: "POST", headers: { Origin: origin, Authorization: "Bearer valid-session", "Content-Type": "application/json" }, body: JSON.stringify({ parcel_id: parcelId, owner_id: ownerId, document_type_code: "pan", file_id: "existing-file-id", ...extra }) });
}

test("existing files are browsed only inside the configured project folder", async () => {
  const { handler, state } = await harness("drive-files");
  const response = await handler(new Request(`https://project.supabase.co?parcel_id=${parcelId}`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } }));
  assert.equal(response.status, 200); const payload = await response.json(); assert.equal(payload.folder_id, "existing-root"); assert.equal(payload.files[0].can_attach, true);
  const query = new URL(state.google.find((call) => call.url.includes("/files?")).url).searchParams.get("q"); assert.equal(query, "'existing-root' in parents and trashed = false"); assert.equal(state.writes.length, 0);
});

test("existing file links retain exact owner/survey metadata and do not move files or receive consent", async () => {
  const { handler, state } = await harness("drive-files"); assert.equal((await handler(linkRequest())).status, 201);
  const metadata = state.writes.find((write) => write.table === "parcel_documents").values;
  assert.equal(metadata.parcel_id, parcelId); assert.equal(metadata.owner_id, ownerId); assert.equal(metadata.google_file_id, "existing-file-id");
  assert.equal(state.google.every((call) => !call.method || call.method === "GET"), true); assert.equal(state.writes.some((write) => write.table === "consent_records"), false);
});

test("files and folders outside the project cannot be listed or linked", async () => {
  const link = await harness("drive-files"); assert.equal((await link.handler(linkRequest({ file_id: "outside-file" }))).status, 403); assert.equal(link.state.writes.length, 0);
  const browse = await harness("drive-files"); assert.equal((await browse.handler(new Request(`https://project.supabase.co?parcel_id=${parcelId}&folder_id=outside-folder`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } }))).status, 403); assert.equal(browse.state.google.some((call) => new URL(call.url).searchParams.get("q")?.includes("'outside-folder' in parents")), false);
});

test("existing KYC links require owner membership and admin access", async () => {
  const wrong = await harness("drive-files", { ownerParcel: otherParcelId }); assert.equal((await wrong.handler(linkRequest())).status, 400); assert.equal(wrong.state.google.length, 0);
  const missing = await harness("drive-files"); assert.equal((await missing.handler(linkRequest({ owner_id: null }))).status, 400); assert.equal(missing.state.google.length, 0);
  const viewer = await harness("drive-files", { role: "viewer" }); assert.equal((await viewer.handler(linkRequest())).status, 403); assert.equal(viewer.state.google.length, 0);
});

test("repeat file links reuse the attachment and oversized files are rejected", async () => {
  const duplicate = await harness("drive-files", { alreadyLinked: true }); assert.equal((await duplicate.handler(linkRequest())).status, 200); assert.equal(duplicate.state.writes.length, 0);
  const large = await harness("drive-files", { oversizedFile: true }); assert.equal((await large.handler(linkRequest())).status, 400); assert.equal(large.state.writes.length, 0);
});

test("shared folder paths are verified by child listings when Drive omits parent metadata", async () => {
  const browse = await harness("drive-files", { omitDriveParents: true });
  const query = new URLSearchParams({ parcel_id: parcelId, folder_id: "existing-survey-folder", folder_path: JSON.stringify(["existing-survey-folder"]) });
  assert.equal((await browse.handler(new Request(`https://project.supabase.co?${query}`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } }))).status, 200);
  const link = await harness("drive-files", { omitDriveParents: true });
  assert.equal((await link.handler(linkRequest({ folder_path: ["existing-survey-folder"] }))).status, 201);
  const outside = await harness("drive-files", { omitDriveParents: true });
  assert.equal((await outside.handler(linkRequest({ file_id: "outside-file", folder_path: ["existing-survey-folder"] }))).status, 403); assert.equal(outside.state.writes.length, 0);
});

test("new uploads reuse the existing village and survey folder before creating folders", async () => {
  const { handler, state } = await harness("drive-upload", { noExistingFolder: true }); assert.equal((await handler(uploadRequest())).status, 201);
  const folder = state.writes.find((write) => write.table === "drive_folders").values; assert.equal(folder.google_folder_id, "existing-survey-folder"); assert.equal(folder.parcel_id, parcelId);
  const multipart = state.google.find((call) => call.url.includes("/upload/")).bodyText; assert.ok(multipart.includes('"parents":["existing-survey-folder"]'));
  assert.equal(state.google.some((call) => call.method === "POST" && !call.url.includes("/upload/")), false);
});
