export const SENSITIVE_DRIVE_TYPES = new Set(["pan", "aadhaar", "bank_details", "consent_letter", "lease_deed", "mutation_death_certificate", "other"]);

export async function projectFolderPrivacy(token: string, rootId: string): Promise<"restricted" | "public" | "unknown"> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootId)}?fields=id,permissions(type,role)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return "unknown";
  const file = await response.json() as { permissions?: Array<{ type?: string }> };
  if (!Array.isArray(file.permissions)) return "unknown";
  return file.permissions.some(permission => permission.type === "anyone") ? "public" : "restricted";
}
