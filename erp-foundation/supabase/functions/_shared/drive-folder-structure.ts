import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { childFolders, DRIVE_ID, FOLDER_MIME, getDriveFile, resolveSurveyFolder, resolveVillageFolder, villageFolderKey } from "./drive-existing-files.ts";

export const STRUCTURE_VERSION = 1;
export const LEGAL_FOLDERS: Record<string, string> = {
  lease_deed: "Lease Deed",
  consent_letter: "Consent",
  current_712: "Current 7-12",
  nondh_6: "Nondh No. 6 - Mutation Entry",
  old_712: "Old 7-12",
  old_nondh_6: "Old Nondh No. 6 - Mutation Entry"
};
export const DOCUMENT_CODES = new Set([...Object.keys(LEGAL_FOLDERS), "pan", "aadhaar", "bank_details", "mutation_death_certificate", "other", "consent_form_draft"]);
export interface FolderStructure {
  root_id: string; village_id: string; survey_id: string;
  kyc_id: string; legal_id: string; other_id: string;
  legal: Record<string, string>; owners: Record<string, string>;
}
type Owner = { id: string; display_name: string; sequence_no: number | null };

export function cleanFolderName(value: string): string {
  return value.normalize("NFC").replace(/[\u0000-\u001f\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 220) || "Unnamed";
}

export function ownerFolderName(owner: Owner, position: number): string {
  return `Owner ${owner.sequence_no ?? position + 1} (${cleanFolderName(owner.display_name)})`;
}

export function documentFolder(structure: FolderStructure, code: string, ownerId?: string | null): string {
  if (!DOCUMENT_CODES.has(code)) throw new Error("Unknown document type.");
  if (["pan", "aadhaar", "bank_details"].includes(code)) {
    if (!ownerId || !structure.owners[ownerId]) throw new Error("Select an owner belonging to this survey.");
    return structure.owners[ownerId];
  }
  return structure.legal[code] || structure.other_id;
}

async function createFolder(token: string, name: string, parentId: string): Promise<string> {
  if (!DRIVE_ID.test(parentId)) throw new Error("The parent folder is invalid.");
  const response = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: cleanFolderName(name), mimeType: FOLDER_MIME, parents: [parentId] })
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const reason = String(failure.error?.errors?.[0]?.reason || failure.error?.status || "unknown").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    throw new Error(response.status === 429 ? "Google Drive is busy. Resume folder setup shortly." : `Google Drive folder creation failed (${response.status}: ${reason}).`);
  }
  const file = await response.json() as { id?: string };
  if (!file.id || !DRIVE_ID.test(file.id)) throw new Error("Google Drive did not return a folder ID.");
  return file.id;
}

export async function withFolderLease<T>(admin: SupabaseClient, scope: string, operation: () => Promise<T>): Promise<T> {
  const lease = crypto.randomUUID();
  const { data, error } = await admin.rpc("acquire_drive_folder_lease", { scope_key: scope, lease_token: lease });
  if (error) throw new Error("Could not reserve the folder setup.");
  if (!data) throw new Error("Folder setup is already running. Please try again shortly.");
  try { return await operation(); }
  finally { await admin.rpc("release_drive_folder_lease", { scope_key: scope, lease_token: lease }); }
}

async function ensureChildren(token: string, parentId: string, names: Record<string, string>): Promise<Record<string, string>> {
  const existing = await childFolders(token, parentId);
  const result: Record<string, string> = {};
  const key = (name: string) => cleanFolderName(name).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  // Keep small, bounded batches; dependent parent folders are created first.
  const entries = Object.entries(names);
  for (let start = 0; start < entries.length; start += 4) {
    const outcomes = await Promise.allSettled(entries.slice(start, start + 4).map(async ([code, name]) => {
      const aliases = [key(name)];
      if (code === "kyc") aliases.push(key("KYC With Bank Detailes"));
      if (code === "lease_deed") aliases.push(key("Lease Dead"));
      const matches = existing.filter((folder) => aliases.includes(key(folder.name)));
      if (matches.length > 1) throw new Error(`Multiple ${name} folders exist. Please resolve the duplicate folders first.`);
      result[code] = matches[0]?.id || await createFolder(token, name, parentId);
    }));
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  return result;
}

export async function ensureExistingTemplate(admin: SupabaseClient, token: string, folder: { id: string; name: string; parentId: string; village: string; parcelId?: string }): Promise<void> {
  await withFolderLease(admin, `existing:${folder.id}`, async () => {
    const main = await ensureChildren(token, folder.id, { kyc: "KYC With Bank Details", legal: "Legal Documents", other: "Other" });
    const legal = await ensureChildren(token, main.legal, LEGAL_FOLDERS);
    let ownerFolders: Record<string,string> = {};
    if (folder.parcelId) {
      const { data: owners, error } = await admin.from("parcel_owners").select("id,display_name,sequence_no").eq("parcel_id",folder.parcelId).order("sequence_no",{ascending:true,nullsFirst:false}).order("id");
      if (error) throw new Error("Could not load owners for the existing folder.");
      ownerFolders = await ensureChildren(token, main.kyc, Object.fromEntries((owners || []).map((owner: Owner,index: number) => [owner.id,ownerFolderName(owner,index)])));
    }
    const { error } = await admin.from("drive_existing_folder_templates").upsert({ google_folder_id: folder.id, parent_folder_id: folder.parentId, village_name: folder.village, survey_name: folder.name, parcel_id: folder.parcelId || null, structure: { kyc_id:main.kyc,legal_id:main.legal,other_id:main.other,legal,owners:ownerFolders },checked_at:new Date().toISOString() });
    if (error) throw new Error("Could not save the existing folder structure.");
  });
}

function completeStructure(value: unknown, rootId: string, owners: Owner[]): value is FolderStructure {
  if (!value || typeof value !== "object") return false;
  const s = value as FolderStructure;
  return s.root_id === rootId && [s.village_id, s.survey_id, s.kyc_id, s.legal_id, s.other_id, ...Object.keys(LEGAL_FOLDERS).map((code) => s.legal?.[code]), ...owners.map((owner) => s.owners?.[owner.id])].every((id) => typeof id === "string" && DRIVE_ID.test(id));
}

export async function ensureSurveyStructure(admin: SupabaseClient, token: string, parcelId: string, userId: string, verify = false): Promise<FolderStructure> {
  return withFolderLease(admin, `parcel:${parcelId}`, async () => {
    const { data: parcel, error: parcelError } = await admin.from("parcels").select("id,survey_number,villages!inner(name_en,drive_root_folder_id)").eq("id", parcelId).maybeSingle();
    if (parcelError || !parcel) throw new Error("Survey record was not found.");
    const village = Array.isArray(parcel.villages) ? parcel.villages[0] : parcel.villages;
    const rootId = village?.drive_root_folder_id || Deno.env.get("DRIVE_ROOT_FOLDER_ID");
    if (!rootId || !DRIVE_ID.test(rootId)) throw new Error("Project Drive folder is not configured.");
    const { data: owners, error: ownerError } = await admin.from("parcel_owners").select("id,display_name,sequence_no").eq("parcel_id", parcelId).order("sequence_no", { ascending: true, nullsFirst: false }).order("id");
    if (ownerError) throw new Error("Could not load the survey owners.");
    const { data: bound, error: boundError } = await admin.from("drive_folders").select("google_folder_id,structure,structure_version").eq("parcel_id", parcelId).maybeSingle();
    if (boundError) throw new Error("Could not look up the survey folders.");
    if (!verify && bound?.structure_version === STRUCTURE_VERSION && completeStructure(bound.structure, rootId, owners || [])) return bound.structure;
    const villageId = await withFolderLease(admin, `village:${rootId}:${villageFolderKey(village.name_en)}`, () => resolveVillageFolder(token, rootId, village.name_en, (name, parentId) => createFolder(token, name, parentId)));
    // Re-discover exact names instead of trusting a stale cached Drive ID.
    const surveyId = await resolveSurveyFolder(token, rootId, village.name_en, parcel.survey_number, (name, parentId) => createFolder(token, name, parentId), villageId);
    const main = await ensureChildren(token, surveyId, { kyc: "KYC With Bank Details", legal: "Legal Documents", other: "Other" });
    const legal = await ensureChildren(token, main.legal, LEGAL_FOLDERS);
    const ownerNames = Object.fromEntries((owners || []).map((owner: Owner, index: number) => [owner.id, ownerFolderName(owner, index)]));
    const ownerFolders = await ensureChildren(token, main.kyc, ownerNames);
    const structure: FolderStructure = { root_id: rootId, village_id: villageId, survey_id: surveyId, kyc_id: main.kyc, legal_id: main.legal, other_id: main.other, legal, owners: ownerFolders };
    const { error } = await admin.from("drive_folders").upsert({ parcel_id: parcelId, google_folder_id: surveyId, folder_name: `${village.name_en} / ${parcel.survey_number}`, created_by: userId, structure, structure_version: STRUCTURE_VERSION, structure_completed_at: new Date().toISOString() }, { onConflict: "parcel_id" });
    if (error) throw new Error("Could not save the survey folder links. Resume setup to reuse the folders already created.");
    return structure;
  });
}

export async function uploadFolder(admin: SupabaseClient, token: string, parcelId: string, userId: string, code: string, ownerId?: string | null): Promise<string> {
  if (code === "consent_form_draft") {
    // This explicit draft upload must not resume or repair the survey folder hierarchy.
    return withFolderLease(admin, `draft:${parcelId}`, async () => {
      const { data, error } = await admin.from("drive_folders").select("structure").eq("parcel_id", parcelId).maybeSingle();
      const parent = data?.structure?.other_id;
      if (error || !parent || !DRIVE_ID.test(parent)) throw new Error("This survey needs an existing Other folder linked before saving a draft PDF to Drive.");
      const file = await getDriveFile(token, parent);
      if (file.trashed || file.mimeType !== FOLDER_MIME) throw new Error("The linked Other folder is unavailable. Ask the administrator to link the existing folder.");
      return (await ensureChildren(token, parent, { drafts: "Generated Consent Forms - Unsigned" })).drafts;
    });
  }
  let structure = await ensureSurveyStructure(admin, token, parcelId, userId);
  let folderId = documentFolder(structure, code, ownerId);
  let available = false;
  try { const file = await getDriveFile(token, folderId); available = !file.trashed && file.mimeType === FOLDER_MIME; } catch { /* A deleted folder is repaired below. */ }
  if (!available) { structure = await ensureSurveyStructure(admin, token, parcelId, userId, true); folderId = documentFolder(structure, code, ownerId); }
  return folderId;
}
