import type { ConsentFormFields } from "../../../shared/consent-draft";
import type { ParcelSummary } from "./types";
export interface LegacyConsentForm { id: string; survey_number: string; village_en: string; date: string; first_owner: string; status: "sent" | "received" | "missing"; fields: ConsentFormFields | null }
const aliases: Record<string,string> = { bhavanipur:"bhavanipar", bhavnipar:"bhavanipar", bhavanipar:"bhavanipar", bitta:"bitta", vandhtimbo:"vandhtimbo" };
const villageKey=(s:string)=>{const key=s.toLowerCase().replace(/[^a-z]/g,"");return aliases[key] || key};
export function matchLegacySurvey(record: LegacyConsentForm, rows: ParcelSummary[]): ParcelSummary | null {
  const matches=rows.filter(p=>villageKey(p.village_name)===villageKey(record.village_en) && p.survey_number.trim()===record.survey_number.trim());
  return matches.length===1 ? matches[0] : null;
}
export async function legacyDraftId(id: string): Promise<string> {
  // RFC 4122 UUID v5 in the URL namespace: the same old record always gets the same draft ID.
  const ns=Uint8Array.from("6ba7b8119dad11d180b400c04fd430c8".match(/../g)!.map(s=>parseInt(s,16)));
  const name=new TextEncoder().encode("https://bhachunda-solar-default-rtdb.asia-southeast1.firebasedatabase.app/consent-forms/"+id);
  const bytes=new Uint8Array(ns.length+name.length);bytes.set(ns);bytes.set(name,ns.length);
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-1",bytes)).slice(0,16);hash[6]=(hash[6]&15)|80;hash[8]=(hash[8]&63)|128;
  const h=Array.from(hash,b=>b.toString(16).padStart(2,"0")).join("");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
