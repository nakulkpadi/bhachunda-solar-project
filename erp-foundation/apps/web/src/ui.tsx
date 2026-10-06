import { useMemo, type ReactNode } from "react";
import type { ParcelSummary } from "./types";

export type IconName = "overview" | "register" | "map" | "reports" | "entry" | "search" | "arrow" | "back" | "filter" | "chevron";

const iconPaths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  register: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16" /></>,
  reports: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6M8 17v-3M12 17v-6M16 17v-2" /></>,
  entry: <><path d="m14 5 5 5M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4ZM13 20h7" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  back: <path d="M19 12H5m5-5-5 5 5 5" />,
  filter: <><path d="M3 6h18M6 12h12M9 18h6" /></>,
  chevron: <path d="m8 10 4 4 4-4" />
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg aria-hidden="true" className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

export function SurveyPicker({ rows, selectedParcel, onSelect, disabled = false }: {
  rows: ParcelSummary[];
  selectedParcel: ParcelSummary;
  onSelect: (parcelId: string) => void;
  disabled?: boolean;
}) {
  const villages = useMemo(() => [...new Set(rows.map((row) => row.village_name))], [rows]);
  const villageRows = useMemo(() => rows
    .filter((row) => row.village_name === selectedParcel.village_name)
    .sort((left, right) => left.survey_number.localeCompare(right.survey_number, undefined, { numeric: true })), [rows, selectedParcel.village_name]);

  return <div className="survey-picker">
    <label>Village<select disabled={disabled} value={selectedParcel.village_name} onChange={(event) => {
      const first = rows.filter((row) => row.village_name === event.target.value)
        .sort((left, right) => left.survey_number.localeCompare(right.survey_number, undefined, { numeric: true }))[0];
      if (first) onSelect(first.id);
    }}>{villages.map((village) => <option key={village} value={village}>{village}</option>)}</select></label>
    <label>Survey number<select disabled={disabled} value={selectedParcel.id} onChange={(event) => onSelect(event.target.value)}>
      {villageRows.map((row) => <option key={row.id} value={row.id}>{row.survey_number}{row.old_survey_number ? ` · old ${row.old_survey_number}` : ""}</option>)}
    </select></label>
    <p className="field-hint">{villageRows.length} surveys in {selectedParcel.village_name}</p>
  </div>;
}
