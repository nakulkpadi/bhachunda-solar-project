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
