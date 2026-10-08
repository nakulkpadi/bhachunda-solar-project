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
const secondOwnerId = "20000000-0000-4000-8000-000000000002";
const documentId = "30000000-0000-4000-8000-000000000001";
const draftId = "40000000-0000-4000-8000-000000000001";
const origin = "https://nakulkpadi.github.io";

async function harness(slug, overrides = {}) {
  const state = { role: "admin", active: true, approval: "approved", ownerParcel: parcelId, sensitive: true, documentStatus: "uploaded", writes: [], google: [], failDocumentInsert: false, ...overrides };
  const folderMime = "application/vnd.google-apps.folder";
  const structure = { root_id: "existing-root", village_id: "existing-village-folder", survey_id: "existing-survey-folder", kyc_id: "kyc-folder", legal_id: "legal-folder", other_id: "other-folder", legal: { lease_deed: "lease-folder", consent_letter: "consent-folder", current_712: "current-folder", nondh_6: "mutation-folder", old_712: "old-current-folder", old_nondh_6: "old-mutation-folder" }, owners: { [ownerId]: "owner-one-folder", [secondOwnerId]: "owner-two-folder" } };
  const model = (id, name, parent) => ({ id, name, mimeType: folderMime, parents: parent ? [parent] : [] });
  const driveFolders = [model("existing-root", "Project folder"), model("existing-village-folder", "Bhavanipur", "existing-root"), model("existing-survey-folder", state.legacySurveyName || "451", "existing-village-folder")];
  if (!state.emptyChildren) driveFolders.push(model("kyc-folder", "KYC With Bank Details", "existing-survey-folder"), model("legal-folder", "Legal Documents", "existing-survey-folder"), model("other-folder", "Other", "existing-survey-folder"), ...Object.entries({ "Lease Deed": "lease-folder", "Consent": "consent-folder", "Current 7-12": "current-folder", "Nondh No. 6 - Mutation Entry": "mutation-folder", "Old 7-12": "old-current-folder", "Old Nondh No. 6 - Mutation Entry": "old-mutation-folder" }).map(([name, id]) => model(id, name, "legal-folder")), model("owner-one-folder", "Owner 1 (Owner One)", "kyc-folder"), model("owner-two-folder", "Owner 2 (Owner Two)", "kyc-folder"));
  if (state.duplicateLegalFolder) driveFolders.push(model("duplicate-legal", "Legal Documents", "existing-survey-folder"));
  if (state.deletedOwnerFolder) driveFolders.find((folder) => folder.id === "owner-one-folder").trashed = true;
  let bound = state.noExistingFolder ? null : { parcel_id: parcelId, google_folder_id: "existing-survey-folder", structure, structure_version: 1 };
  state.driveFolders = driveFolders;
  const run = (table, operation, values, single = false, filters = {}) => {
    if (operation !== "select") state.writes.push({ table, operation, values });
    if (table === "profiles") return { data: { role: state.role, is_active: state.active, approval_status: state.approval }, error: null };
    if (table === "consent_form_drafts") return { data: state.failDraftLink && operation === "update" ? null : filters.id === draftId && (!filters.parcel_id || filters.parcel_id === parcelId) ? {id:draftId,revision:state.draftRevision || 1,state:state.draftState || "draft"} : null, error: null };
    if (table === "villages") return { data: [{ drive_root_folder_id: "existing-root" }], error: null };
    if (table === "parcel_owners") return { data: single ? state.ownerParcel ? { parcel_id: state.ownerParcel } : null : [{ id: ownerId, display_name: "Owner One", sequence_no: 1 }, { id: secondOwnerId, display_name: "Owner Two", sequence_no: 2 }], error: null };
    if (table === "parcels") { const parcel = { id: parcelId, survey_number: "451", villages: { code: "BVP", name_en: "Bhavanipar", drive_root_folder_id: "existing-root" }, ...(slug === "parcel-detail" ? { source_workbook: "private-import.xlsx", source_row_number: 42, consent_records: { status: "received", received_on: "2026-10-07", remarks: "Survey note", source_value: "private-import-source" }, acquisition_cases: { category: "Lease", source_fields: { raw_bank_data: "private-import-value" } }, parcel_owners: [{ id: ownerId, display_name: "Owner One", source_owner_text: "private-import-owner", sequence_no: 1, is_primary: true }], parcel_documents: [] } : {}) }; return { data: single ? parcel : [parcel], error: null }; }
    if (table === "drive_folders") { if (operation === "upsert") bound = values; return { data: single ? bound : bound ? [bound] : [], error: null }; }
    if (table === "parcel_documents") return operation === "insert" ? { data: state.failDocumentInsert ? null : { id: documentId }, error: state.failDocumentInsert ? new Error("insert failed") : null } : slug === "drive-files" ? { data: state.alreadyLinked ? { id: documentId } : null, error: null } : { data: { google_file_id: "existing-file-id", original_filename: "consent.pdf", mime_type: "application/pdf", byte_size: 15, status: state.documentStatus, document_types: { is_sensitive: state.sensitive } }, error: null };
    return { data: null, error: null };
  };
  const admin = {
    rpc: async (name) => ({ data: name === "acquire_drive_folder_lease" ? !state.leaseBusy : null, error: null }),
    auth: { getUser: async (token) => ({ data: { user: token === "valid-session" ? { id: "test-admin-user" } : null }, error: null }) },
    from(table) {
      let operation = "select", values, filters = {};
      const query = {
        select() { return query; }, eq(k,v) { filters[k]=v; return query; }, in() { return query; }, is() { return query; }, limit() { return query; }, order() { return query; },
        update(input) { operation="update";values=input;return query; }, delete() { operation="delete";return query; },
        insert(input) { operation = "insert"; values = input; return query; },
        upsert(input) { operation = "upsert"; values = input; return query; },
        maybeSingle: async () => run(table, operation, values, true, filters),
        single: async () => run(table, operation, values, true, filters),
        then(onFulfilled, onRejected) { return Promise.resolve(run(table, operation, values, false, filters)).then(onFulfilled, onRejected); }
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
      if (String(url).includes("fields=id,permissions")) return new Response(JSON.stringify({ permissions: state.publicDrive ? [{type:"anyone",role:"reader"}] : state.unknownPrivacy ? undefined : [{type:"user",role:"owner"}] }));
      if (String(url).includes("/drive/v3/about?")) return new Response(JSON.stringify({ user: { emailAddress: "drive-owner@example.com" } }));
      if (String(url).includes("fields=id,name,capabilities")) return new Response(JSON.stringify({ id: "existing-root", name: "Project folder", capabilities: { canAddChildren: !state.readOnlyDrive } }));
      if (["drive-upload", "drive-folder-setup"].includes(slug) && new URL(url).searchParams.get("q")) {
        const parent = new URL(url).searchParams.get("q").match(/^'([^']+)' in parents/)?.[1];
        return new Response(JSON.stringify({ files: driveFolders.filter((folder) => folder.parents.includes(parent) && !folder.trashed) }));
      }
      if (["drive-upload", "drive-folder-setup"].includes(slug) && options.method === "POST" && !String(url).includes("/upload/")) {
        const metadata = JSON.parse(options.body); const id = `created-folder-${driveFolders.length}`;
        driveFolders.push({ id, ...metadata }); return new Response(JSON.stringify({ id }));
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
        const item = (["drive-upload", "drive-folder-setup"].includes(slug) ? driveFolders.find((folder) => folder.id === id) : null) || metadata[id] || { id, parents: [] };
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
      if (!state.active || state.approval !== "approved" || !roles.includes(state.role)) throw new Error("Your role cannot perform this action.");
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
  return { state, handler, admin, helpers: modules.get(resolve(root, "_shared/owner-details.ts"))?.namespace, folders: modules.get(resolve(root, "_shared/drive-folder-structure.ts"))?.namespace, existing: modules.get(resolve(root, "_shared/drive-existing-files.ts"))?.namespace };
}

function ownerRequest(details, extra = {}) {
  return new Request("https://project.supabase.co/functions/v1/owner-details", { method: "POST", headers: { Origin: origin, Authorization: "Bearer valid-session", "Content-Type": "application/json" }, body: JSON.stringify({ parcel_id: parcelId, owner_id: ownerId, details, ...extra }) });
}

function uploadRequest(code = "pan", owner = ownerId, contents = "%PDF-test", auth = "valid-session", draft = null) {
  const form = new FormData(); form.set("parcel_id", parcelId); form.set("document_type_code", code); if (owner) form.set("owner_id", owner);
  form.set("file", new File([contents], "test.pdf", { type: "application/pdf" }));
  if(draft){form.set("draft_id",draft.id);form.set("draft_revision",String(draft.revision));}
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

test("owner PAN upload links exact owner, survey, Drive file and owner's KYC folder", async () => {
  const { handler, state } = await harness("drive-upload"); assert.equal((await handler(uploadRequest())).status, 201);
  const metadata = state.writes.find((write) => write.table === "parcel_documents").values;
  assert.equal(metadata.parcel_id, parcelId); assert.equal(metadata.owner_id, ownerId); assert.equal(metadata.google_file_id, "new-drive-file-id"); assert.equal(metadata.document_type_code, "pan");
  const multipart = state.google.find((call) => call.url.includes("/upload/")).bodyText;
  assert.ok(multipart.includes('"parents":["owner-one-folder"]')); assert.ok(multipart.includes(`owner-${ownerId}`));
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
  const multipart = state.google.find((call) => call.url.includes("/upload/")).bodyText; assert.ok(multipart.includes('"parents":["owner-one-folder"]'));
  assert.equal(state.google.some((call) => call.method === "POST" && !call.url.includes("/upload/")), false);
});

function setupRequest(body = {}, auth = "valid-session", method = "POST") {
  return new Request("https://project.supabase.co/functions/v1/drive-folder-setup", { method, headers: { Origin: origin, Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}

test("folder setup creates the complete legal and named owner hierarchy and saves the IDs", async () => {
  const { handler, state } = await harness("drive-folder-setup", { noExistingFolder: true, emptyChildren: true });
  const result = await handler(setupRequest()); assert.equal(result.status, 200);
  const payload = await result.json(); assert.equal(payload.completed, 1); assert.equal(payload.remaining, 0);
  const saved = state.writes.find((write) => write.table === "drive_folders").values;
  assert.equal(saved.google_folder_id, "existing-survey-folder"); assert.equal(saved.structure_version, 1);
  const created = state.google.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body)); assert.equal(created.length, 11);
  for (const name of ["KYC With Bank Details", "Legal Documents", "Other"]) assert.ok(created.some((file) => file.name === name && file.parents[0] === "existing-survey-folder"));
  for (const name of ["Lease Deed", "Consent", "Current 7-12", "Nondh No. 6 - Mutation Entry", "Old 7-12", "Old Nondh No. 6 - Mutation Entry"]) assert.ok(created.some((file) => file.name === name && file.parents[0] === saved.structure.legal_id));
  for (const name of ["Owner 1 (Owner One)", "Owner 2 (Owner Two)"]) assert.ok(created.some((file) => file.name === name && file.parents[0] === saved.structure.kyc_id));
  assert.equal(state.writes.some((write) => ["consent_records", "parcel_documents"].includes(write.table)), false);
});

test("checking an existing layout reuses all folders without duplicate creates or file moves", async () => {
  const { handler, state } = await harness("drive-folder-setup");
  assert.equal((await handler(setupRequest({ parcel_id: parcelId }))).status, 200);
  assert.equal(state.google.some((call) => ["POST", "PATCH", "DELETE"].includes(call.method)), false);
});

test("folder setup can resume after a completed batch without creating folders again", async () => {
  const { handler, state } = await harness("drive-folder-setup", { noExistingFolder: true, emptyChildren: true });
  assert.equal((await handler(setupRequest())).status, 200); const calls = state.google.length;
  const second = await handler(setupRequest()); assert.equal(second.status, 200); assert.equal((await second.json()).processed, 0); assert.equal(state.google.length, calls);
});

test("all legal and other uploads use the correct category folder", async () => {
  const routes = { consent_letter: "consent-folder", lease_deed: "lease-folder", current_712: "current-folder", nondh_6: "mutation-folder", old_712: "old-current-folder", old_nondh_6: "old-mutation-folder", mutation_death_certificate: "other-folder", other: "other-folder" };
  for (const [code, folder] of Object.entries(routes)) {
    const { handler, state } = await harness("drive-upload"); assert.equal((await handler(uploadRequest(code, null))).status, 201);
    assert.ok(state.google.find((call) => call.url.includes("/upload/")).bodyText.includes(`"parents":["${folder}"]`));
  }
});

test("PAN, Aadhaar and bank files route independently into the selected owner's folder", async () => {
  for (const code of ["pan", "aadhaar", "bank_details"]) {
    const { handler, state } = await harness("drive-upload"); assert.equal((await handler(uploadRequest(code, secondOwnerId))).status, 201);
    assert.ok(state.google.find((call) => call.url.includes("/upload/")).bodyText.includes('"parents":["owner-two-folder"]'));
    assert.equal(state.writes.find((write) => write.table === "parcel_documents").values.owner_id, secondOwnerId);
  }
});

test("a deleted owner folder is repaired before an upload uses it", async () => {
  const { handler, state } = await harness("drive-upload", { deletedOwnerFolder: true }); assert.equal((await handler(uploadRequest())).status, 201);
  const saved = state.writes.find((write) => write.table === "drive_folders").values;
  assert.notEqual(saved.structure.owners[ownerId], "owner-one-folder");
  assert.ok(state.google.find((call) => call.url.includes("/upload/")).bodyText.includes(`"parents":["${saved.structure.owners[ownerId]}"]`));
});

test("duplicate category folders stop setup before the layout is marked completed", async () => {
  const { handler, state } = await harness("drive-folder-setup", { noExistingFolder: true, duplicateLegalFolder: true }); assert.equal((await handler(setupRequest())).status, 409);
  assert.equal(state.writes.some((write) => write.table === "drive_folders"), false);
});

test("folder creation requires an active admin and rejects unknown surveys", async () => {
  for (const config of [{ role: "viewer" }, { active: false }, { role: "data_entry" }]) {
    const { handler, state } = await harness("drive-folder-setup", config); assert.equal((await handler(setupRequest())).status, 403); assert.equal(state.google.length, 0);
  }
  const { handler, state } = await harness("drive-folder-setup"); assert.equal((await handler(setupRequest({}, "invalid"))).status, 401);
  assert.equal((await handler(setupRequest({ parcel_id: otherParcelId }))).status, 400); assert.equal(state.google.length, 0);
});

test("progress reads check account and access without creating folders, competing setup holds a lease", async () => {
  const progress = await harness("drive-folder-setup"); const result = await progress.handler(setupRequest({}, "valid-session", "GET")); assert.equal(result.status, 200); assert.equal((await result.json()).account_email, "drive-owner@example.com"); assert.equal(progress.state.google.some((call) => call.method === "POST"), false);
  const busy = await harness("drive-folder-setup", { noExistingFolder: true, leaseBusy: true }); assert.equal((await busy.handler(setupRequest())).status, 409); assert.equal(busy.state.google.length, 0);
});

test("read-only Google folder access is reported without attempted folder creation", async () => {
  const { handler, state } = await harness("drive-folder-setup", { readOnlyDrive: true }); const result = await handler(setupRequest({}, "valid-session", "GET")); assert.equal(result.status, 200);
  assert.equal((await result.json()).blocked_folders[0].name, "Project folder"); assert.equal(state.google.some((call) => call.method === "POST"), false);
});

test("sensitive uploads fail closed for public or unverifiable Drive sharing", async () => {
  for (const config of [{ publicDrive: true }, { unknownPrivacy: true }]) {
    for (const code of ["pan", "aadhaar", "bank_details", "consent_letter", "lease_deed", "mutation_death_certificate", "other"]) {
      const { handler, state } = await harness("drive-upload", config);
      const response = await handler(uploadRequest(code, ["pan", "aadhaar", "bank_details"].includes(code) ? ownerId : null));
      assert.equal(response.status, 409);
      assert.equal(state.google.some(call => ["POST", "PATCH", "DELETE"].includes(call.method)), false);
      assert.equal(state.writes.length, 0);
    }
  }
});

test("approved editors can save and upload, but cannot administer Drive folders", async () => {
  const owner = await harness("owner-details", { role: "editor" });
  assert.equal((await owner.handler(ownerRequest({ bank_branch: "Bitta" }))).status, 200);
  const upload = await harness("drive-upload", { role: "editor" });
  assert.equal((await upload.handler(uploadRequest())).status, 201);
  const setup = await harness("drive-folder-setup", { role: "editor" });
  assert.equal((await setup.handler(setupRequest())).status, 403);
  assert.equal(setup.state.google.length, 0);
});

test("pending and suspended roles cannot read files or mutate owner and Drive data", async () => {
  for (const approval of ["pending", "suspended", "rejected"]) {
    for (const slug of ["owner-details", "drive-upload", "drive-folder-setup", "drive-document"]) {
      const { handler, state } = await harness(slug, { approval });
      const request = slug === "owner-details" ? ownerRequest({}) : slug === "drive-upload" ? uploadRequest() : slug === "drive-folder-setup" ? setupRequest() : new Request(`https://project.supabase.co?document_id=${documentId}`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } });
      assert.equal((await handler(request)).status, 403);
      assert.equal(state.google.length, 0); assert.equal(state.writes.length, 0);
    }
  }
});

test("Gujarati survey aliases reuse old folders and separator aliases remain distinct", async () => {
  const { handler, state, existing } = await harness("drive-upload", { noExistingFolder: true, legacySurveyName: "૪૫૧" });
  assert.equal((await handler(uploadRequest())).status, 201);
  assert.equal(state.writes.find(write => write.table === "drive_folders").values.google_folder_id, "existing-survey-folder");
  assert.equal(state.google.some(call => call.method === "POST" && !call.url.includes("/upload/")), false);
  assert.equal(existing.surveyFolderKey("140 ૧ p૨"), "140-1-p2");
  assert.equal(existing.surveyFolderKey("143 ૨"), "143-2");
  assert.notEqual(existing.surveyFolderKey("140-1-p2"), existing.surveyFolderKey("140-2"));
});

test("older unregistered folders receive legal categories without invented owners or record changes", async () => {
  const { folders, admin, state } = await harness("drive-folder-setup", { emptyChildren: true });
  const folder = { id: "existing-survey-folder", name: "456", parentId: "existing-village-folder", village: "Bhavanipar" };
  await folders.ensureExistingTemplate(admin, "test-drive-token", folder);
  const saved = state.writes.find(write => write.table === "drive_existing_folder_templates").values;
  assert.equal(saved.parcel_id, null); assert.deepEqual(Object.keys(saved.structure.owners), []);
  assert.equal(Object.keys(saved.structure.legal).length, 6);
  assert.equal(state.google.filter(call => call.method === "POST").length, 9);
  assert.equal(state.writes.some(write => ["parcels", "parcel_owners", "consent_records", "parcel_documents", "drive_folders"].includes(write.table)), false);
  const created = state.google.filter(call => call.method === "POST").length;
  await folders.ensureExistingTemplate(admin, "test-drive-token", folder);
  assert.equal(state.google.filter(call => call.method === "POST").length, created);
});

test("matched older folders add actual owners without moving old consent files", async () => {
  const { folders, admin, state } = await harness("drive-folder-setup", { emptyChildren: true });
  await folders.ensureExistingTemplate(admin, "test-drive-token", { id: "existing-survey-folder", name: "૪૫૧", parentId: "existing-village-folder", village: "Bhavanipar", parcelId });
  const saved = state.writes.find(write => write.table === "drive_existing_folder_templates").values;
  assert.equal(saved.parcel_id, parcelId); assert.equal(Object.keys(saved.structure.owners).length, 2);
  assert.equal(state.google.some(call => ["PATCH", "DELETE"].includes(call.method)), false);
  assert.equal(state.writes.some(write => ["consent_records", "parcel_documents", "drive_folders"].includes(write.table)), false);
});

test("raw import metadata is restricted to the administrator in survey details", async () => {
  for (const role of ["admin", "editor", "viewer", "commenter"]) {
    const { handler } = await harness("parcel-detail", { role });
    const result = await handler(new Request(`https://project.supabase.co?parcel_id=${parcelId}`, { headers: { Origin: origin, Authorization: "Bearer valid-session" } }));
    assert.equal(result.status, 200);
    const { parcel } = await result.json();
    assert.equal(parcel.survey_number, "451"); assert.equal(parcel.owners[0].display_name, "Owner One");
    assert.equal(parcel.consent.status, "received"); assert.equal(parcel.acquisition.category, "Lease");
    if (role === "admin") {
      assert.equal(parcel.consent.source_value, "private-import-source");
    } else {
      assert.equal(parcel.source_workbook, null); assert.equal(parcel.source_row_number, null);
      assert.equal(parcel.consent.source_value, null); assert.equal(parcel.acquisition.source_fields, null); assert.equal(parcel.owners[0].source_owner_text, null);
      assert.equal(JSON.stringify(parcel).includes("private-import"), false);
    }
  }
});
test("unsigned PDF uploads only create a draft child folder and never receive consent or repair the hierarchy",async()=>{
  const h=await harness("drive-upload");const r=await h.handler(uploadRequest("consent_form_draft",null,"%PDF-test","valid-session",{id:draftId,revision:1}));assert.equal(r.status,201);
  const folders=h.state.google.filter(c=>c.method==="POST"&&!c.url.includes("/upload/"));assert.equal(folders.length,1);assert.equal(JSON.parse(folders[0].body).name,"Generated Consent Forms - Unsigned");assert.deepEqual(JSON.parse(folders[0].body).parents,["other-folder"]);
  assert.equal(h.state.writes.find(w=>w.table==="consent_form_drafts").values.document_id,documentId);assert.equal(h.state.writes.find(w=>w.table==="parcel_documents").values.document_type_code,"consent_form_draft");
  assert.equal(h.state.writes.some(w=>["consent_records","parcels","drive_folders","drive_existing_folder_templates"].includes(w.table)),false);
});
test("draft upload rejects missing, archived, stale and mismatched forms before any Drive call",async()=>{
  for(const config of [{draftState:"archived"},{draftRevision:2}]){const h=await harness("drive-upload",config);assert.equal((await h.handler(uploadRequest("consent_form_draft",null,"%PDF-test","valid-session",{id:draftId,revision:1}))).status,409);assert.equal(h.state.google.length,0)}
  const h=await harness("drive-upload");assert.equal((await h.handler(uploadRequest("consent_form_draft",null))).status,400);assert.equal((await h.handler(uploadRequest("consent_letter",null,"%PDF-test","valid-session",{id:draftId,revision:1}))).status,400);assert.equal(h.state.google.length,0);
});
test("draft uploads stop at missing mappings without rebuilding survey folders and respect public-sharing block",async()=>{
  for(const config of [{noExistingFolder:true},{publicDrive:true}]){const h=await harness("drive-upload",config);assert.ok((await h.handler(uploadRequest("consent_form_draft",null,"%PDF-test","valid-session",{id:draftId,revision:1}))).status>=400);assert.equal(h.state.google.some(c=>c.method==="POST"),false);assert.equal(h.state.writes.length,0)}
});
test("a draft changed during upload deletes the new PDF attachment and never touches final consent",async()=>{
  const h=await harness("drive-upload",{failDraftLink:true});assert.equal((await h.handler(uploadRequest("consent_form_draft",null,"%PDF-test","valid-session",{id:draftId,revision:1}))).status,409);
  assert.ok(h.state.google.some(c=>c.method==="DELETE"&&c.url.includes("new-drive-file-id")));assert.ok(h.state.writes.some(w=>w.table==="parcel_documents"&&w.operation==="delete"));assert.equal(h.state.writes.some(w=>w.table==="consent_records"),false);
});
