// Generated forms are unsigned drafts. This module never writes received consent.
export const DRAFT_TEMPLATE_VERSION = "bnpl-consent-v1";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface ConsentFormFields {
  date: string; survey_number: string; khata: string; has: string;
  village_en: string; village_gu: string; taluka: string; district: string;
  mobile: string; owners: string[];
}
export interface ConsentFormDraft {
  id: string; parcel_id: string; state: "draft" | "archived"; revision: number;
  template_version: string; fields: ConsentFormFields; document_id: string | null;
  created_at: string; updated_at: string;
}
export function normalizeHas(value: string): string {
  // Imported Gujarati land records sometimes use પ for the digit ૫.
  return value.trim().replace(/[૦-૯પ]/g,c=>c==="પ"?"5":String(c.charCodeAt(0)-0x0ae6)).replace(/[–—]/g,"-");
}
export function areaFromHas(value: string): { sqm: number; acres: number; guntha: number } {
  const match = /^(\d{1,5})[.\-\s](\d{1,2})[.\-\s](\d{1,2})$/.exec(normalizeHas(value));
  if (!match) throw new Error("Enter area as H.Are.Sq.Mt., for example 1.60.57.");
  const [h,a,s] = match.slice(1).map(Number);
  const sqm = h * 10000 + a * 100 + s;
  if (sqm <= 0) throw new Error("Land area must be greater than zero.");
  const totalGuntha = Math.round(sqm / 101.17141056);
  return { sqm, acres: Math.floor(totalGuntha / 40), guntha: totalGuntha % 40 };
}
export function validateDraftFields(value: unknown): ConsentFormFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Form details are required.");
  const input = value as Record<string, unknown>;
  const keys = ["date","survey_number","khata","has","village_en","village_gu","taluka","district","mobile","owners"];
  if (Object.keys(input).some(k => !keys.includes(k))) throw new Error("Unknown form field. Generated forms cannot set consent status.");
  const text = (key: string, max: number, required = true) => {
    if (typeof input[key] !== "string") throw new Error(`Invalid ${key}.`);
    const v = (input[key] as string).trim().normalize("NFC");
    if ((required && !v) || v.length > max || /[\u0000-\u001f\u007f]/u.test(v)) throw new Error(`Check ${key}.`);
    return v;
  };
  const date = text("date",10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error("Choose a valid form date.");
  const has = normalizeHas(text("has",20)); areaFromHas(has);
  const mobile = text("mobile",20,false);
  if (mobile && !/^\+?[0-9 ()-]{7,20}$/.test(mobile)) throw new Error("Check the mobile number.");
  if (!Array.isArray(input.owners) || input.owners.length < 1 || input.owners.length > 50) throw new Error("Add between 1 and 50 owners.");
  const owners = input.owners.map(v => {
    if (typeof v !== "string" || !v.trim() || v.trim().length > 200 || /[\u0000-\u001f\u007f]/u.test(v)) throw new Error("Check each owner name.");
    return v.trim().normalize("NFC");
  });
  return { date, has, mobile, owners, survey_number:text("survey_number",80), khata:text("khata",80,false), village_en:text("village_en",100), village_gu:text("village_gu",100), taluka:text("taluka",100), district:text("district",100) };
}
export function assertDraftRequest(value: unknown, update: boolean): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request.");
  const v=value as Record<string,unknown>;
  const allowed=update ? ["id","revision","fields","state"] : ["id","parcel_id","fields"];
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error("Generated forms cannot set consent status or receipt dates.");
  if (!UUID.test(String(v.id || "")) || (!update && !UUID.test(String(v.parcel_id || "")))) throw new Error("Invalid form or survey ID.");
  if (update && (!Number.isInteger(v.revision) || Number(v.revision)<1)) throw new Error("Refresh the saved form before editing.");
  if (v.state !== undefined && v.state !== "draft" && v.state !== "archived") throw new Error("A generated form can only be draft or archived.");
  if (v.fields === undefined && (!update || v.state === undefined)) throw new Error("Form details are required.");
  return v;
}
