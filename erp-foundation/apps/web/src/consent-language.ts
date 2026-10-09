export type NameParts = { en: string; gu: string };
const gujarati = /[\u0a85-\u0ae5]/u;
const latin = /[A-Za-z]/;
const places: Record<string, NameParts> = {
  abdasa: { en: "Abdasa", gu: "અબડાસા" }, "અબડાસા": { en: "Abdasa", gu: "અબડાસા" },
  kutch: { en: "Kutch", gu: "કચ્છ" }, "કચ્છ": { en: "Kutch", gu: "કચ્છ" }
};
export function nameParts(value: string): NameParts {
  const parts = value.split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
  return { en: parts.filter(s => latin.test(s) && !gujarati.test(s)).join(" / "), gu: parts.filter(s => gujarati.test(s)).join(" / ") };
}
export function joinNames(en: string, gu: string): string { return [en.trim(), gu.trim()].filter(Boolean).join(" / "); }
export function placeParts(value: string): NameParts { return places[value.trim().toLowerCase()] || nameParts(value); }
export function printLanguageIssues(fields: { owners: string[]; taluka: string; district: string }): string[] {
  const issues: string[] = [];
  fields.owners.forEach((s, i) => { const p = nameParts(s); if (!p.en || !p.gu) issues.push(`Owner ${i + 1}: enter the verified English and Gujarati names.`); });
  for (const key of ["taluka", "district"] as const) { const p=placeParts(fields[key]); if (!p.en || !p.gu) issues.push(`Enter ${key} in English and Gujarati.`); }
  return issues;
}
