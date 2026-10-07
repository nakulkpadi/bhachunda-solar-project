export function csvValue(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  // Quoting alone does not prevent spreadsheet applications executing formulas.
  if (typeof value === "string" && (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
