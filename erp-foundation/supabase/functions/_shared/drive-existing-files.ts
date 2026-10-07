export const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;
export const FILE_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export interface DriveFile { id: string; name: string; mimeType: string; size?: string; parents?: string[]; trashed?: boolean }

export function canAttach(file: DriveFile): boolean {
  const size = Number(file.size || 0);
  return !file.trashed && FILE_MIMES.has(file.mimeType) && Number.isFinite(size) && size > 0 && size <= 15 * 1024 * 1024;
}

export async function getDriveFile(token: string, fileId: string): Promise<DriveFile> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,trashed&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Drive file is unavailable.");
  return response.json();
}

export async function insideProjectFolder(token: string, rootId: string, file: DriveFile): Promise<boolean> {
  if (file.trashed) return false;
  if (file.id === rootId) return true;
  const pending = [...(file.parents || [])];
  const visited = new Set<string>();
  for (let depth = 0; pending.length && depth < 12; depth += 1) {
    const parentId = pending.shift()!;
    if (parentId === rootId) return true;
    if (visited.has(parentId) || !DRIVE_ID.test(parentId)) continue;
    visited.add(parentId);
    const parent = await getDriveFile(token, parentId);
    if (!parent.trashed) pending.push(...(parent.parents || []));
  }
  return false;
}

// Google may omit parents for shared folders. Verify the complete breadcrumb
// using authenticated child listings instead of trusting a client-supplied path.
export async function verifiedFolderPath(token: string, rootId: string, path: string[], targetId: string): Promise<boolean> {
  if (path.length > 12 || path.some((id) => !DRIVE_ID.test(id))) return false;
  if (!path.length && targetId === rootId) return true;
  const steps = path[path.length - 1] === targetId ? path : [...path, targetId];
  let parentId = rootId;
  for (let index = 0; index < steps.length; index += 1) {
    let pageToken: string | undefined;
    let found: DriveFile | undefined;
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ q: `'${parentId}' in parents and trashed = false`, fields: "nextPageToken,files(id,mimeType)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Folder membership could not be checked.");
      const listing = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
      found = listing.files?.find((item) => item.id === steps[index]);
      if (found || !listing.nextPageToken) break;
      pageToken = listing.nextPageToken;
    }
    if (!found || (index < steps.length - 1 && found.mimeType !== FOLDER_MIME)) return false;
    parentId = found.id;
  }
  return true;
}

export async function childFolders(token: string, parentId: string): Promise<DriveFile[]> {
  const folders: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ q: `'${parentId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`, fields: "nextPageToken,files(id,name,mimeType)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Could not find the survey folder in Drive.");
    const listing = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
    folders.push(...(listing.files || []));
    if (!listing.nextPageToken) return folders;
    pageToken = listing.nextPageToken;
  }
  throw new Error("The Drive folder contains too many folders to check safely.");
}

export function villageFolderKey(name: string): string {
  const key = name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return ["bhavanipar", "bhavnipar", "bhavanipur", "bhavnipur"].includes(key) ? "bhavanipar" : key;
}

export async function resolveVillageFolder(token: string, rootId: string, villageName: string, createFolder: (name: string, parentId: string) => Promise<string>): Promise<string> {
  if (!DRIVE_ID.test(rootId)) throw new Error("The project Drive folder ID is invalid.");
  const villages = (await childFolders(token, rootId)).filter((folder) => villageFolderKey(folder.name) === villageFolderKey(villageName));
  if (villages.length > 1) throw new Error("More than one village folder matched. Please check the project Drive folder.");
  return villages[0]?.id || await createFolder(villageName, rootId);
}

export function surveyFolderKey(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase()
    .replace(/[૦-૯]/g, digit => String("૦૧૨૩૪૫૬૭૮૯".indexOf(digit)))
    .replace(/(\d)\s*p\s*(\d)/g, "$1-p$2")
    .replace(/[\s/_-]+/g, "-");
}

export async function resolveSurveyFolder(token: string, rootId: string, villageName: string, surveyNumber: string, createFolder: (name: string, parentId: string) => Promise<string>, knownVillageId?: string): Promise<string> {
  const villageId = knownVillageId || await resolveVillageFolder(token, rootId, villageName, createFolder);
  const surveys = (await childFolders(token, villageId)).filter(folder => surveyFolderKey(folder.name) === surveyFolderKey(surveyNumber));
  const exact = surveys.filter(folder => folder.name.normalize("NFKC").trim() === surveyNumber.normalize("NFKC").trim());
  if (surveys.length > 1 && exact.length !== 1) throw new Error("More than one folder matched this survey. Please check its Drive folders.");
  return exact[0]?.id || surveys[0]?.id || await createFolder(surveyNumber, villageId);
}
