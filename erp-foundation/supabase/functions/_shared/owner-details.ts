export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const OWNER_DOCUMENT_TYPES = new Set(["pan", "aadhaar", "bank_details"]);

export function ownerMatchesParcel(owner: { parcel_id: string } | null, parcelId: string): boolean {
  return owner?.parcel_id === parcelId;
}

export function normaliseOwnerDetails(input: unknown): Record<string, string | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Owner details are required.");
  const values = input as Record<string, unknown>;
  const result: Record<string, string | null> = {};
  const fields = ["pan_owner_name", "pan_number", "aadhaar_owner_name", "aadhaar_number", "bank_owner_name", "bank_account_number", "bank_branch", "ifsc_code", "bank_name", "bank_account_type"];
  for (const field of fields) {
    if (values[field] !== null && values[field] !== undefined && typeof values[field] !== "string") throw new Error("Owner fields must contain text.");
    const value = (values[field] as string | null | undefined)?.trim() || null;
    if (value && (value.length > 200 || /[\u0000-\u001f]/.test(value))) throw new Error("An owner field is too long or contains unsupported characters.");
    result[field] = value;
  }
  result.pan_number = result.pan_number?.toUpperCase() ?? null;
  result.ifsc_code = result.ifsc_code?.toUpperCase() ?? null;
  result.aadhaar_number = result.aadhaar_number?.replace(/[ -]/g, "") ?? null;
  if (result.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(result.pan_number)) throw new Error("Enter a PAN number in the format ABCDE1234F.");
  if (result.aadhaar_number && !/^[2-9][0-9]{11}$/.test(result.aadhaar_number)) throw new Error("Enter a 12-digit Aadhaar number.");
  if (result.bank_account_number && !/^[0-9]{6,34}$/.test(result.bank_account_number)) throw new Error("Enter a bank account number with 6 to 34 digits.");
  if (result.ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(result.ifsc_code)) throw new Error("Enter an 11-character IFSC code.");
  if (result.bank_account_type && !["SB", "CA", "OD", "CC"].includes(result.bank_account_type)) throw new Error("Choose SB, CA, OD or CC for the account type.");
  return result;
}

export function mayViewDocument(role: string, sensitive: boolean): boolean {
  return ["admin", "editor"].includes(role) || (!sensitive && ["viewer", "commenter", "data_entry", "legal", "finance"].includes(role));
}
