import { useEffect, useMemo, useState, type FormEvent } from "react";
import { consentLabel } from "./api";
import type { ConsentStatus, ParcelDetail, ParcelSummary } from "./types";

const consentOptions: ConsentStatus[] = ["received", "pending", "not_ready", "blocked", "rejected"];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

function statusClass(status: ConsentStatus): string {
  return "status status-" + status;
}

function DetailGrid({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return <dl className="detail-grid">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{display(item.value)}</dd></div>)}</dl>;
}

export function ConsentEntry({
  rows,
  selectedParcel,
  detail,
  loading,
  isAdmin,
  onSelect,
  onSave,
  onGoDetails
}: {
  rows: ParcelSummary[];
  selectedParcel: ParcelSummary | null;
  detail: ParcelDetail | null;
  loading: boolean;
  isAdmin: boolean;
  onSelect: (parcelId: string) => void;
  onSave: (input: { status: ConsentStatus; receivedOn: string; reference: string; remarks: string }) => Promise<void>;
  onGoDetails: () => void;
}) {
  const [village, setVillage] = useState(selectedParcel?.village_name ?? "");
  const [status, setStatus] = useState<ConsentStatus>("received");
  const [receivedOn, setReceivedOn] = useState(today());
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const villages = useMemo(() => [...new Set(rows.map((row) => row.village_name))], [rows]);
  const villageRows = useMemo(
    () => rows.filter((row) => row.village_name === village).sort((left, right) => left.survey_number.localeCompare(right.survey_number, undefined, { numeric: true })),
    [rows, village]
  );

  useEffect(() => {
    if (!selectedParcel) return;
    setVillage(selectedParcel.village_name);
    setStatus("received");
    setReceivedOn(detail?.consent?.received_on ?? today());
    setReference(detail?.consent?.source_value === "Manual ERP consent entry" ? "" : detail?.consent?.source_value ?? "");
    setRemarks(detail?.consent?.remarks ?? "");
  }, [selectedParcel?.id, detail?.consent?.received_on, detail?.consent?.remarks, detail?.consent?.source_value]);

  if (!selectedParcel) return <section className="card empty-state"><strong>No survey selected.</strong></section>;

  const ownerNames = detail?.owners.map((owner) => owner.display_name).filter(Boolean).join(", ") || "—";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    try {
      await onSave({ status, receivedOn, reference, remarks });
    } finally {
      setSaving(false);
    }
  };

  return <div className="details-layout">
    <section className="card survey-selector">
      <div className="eyebrow">SELECT SURVEY</div>
      <h2>Create consent entry</h2>
      <p>Select the village and survey first. The land and owner information is filled from the imported register.</p>
      <label>Village<select onChange={(event) => {
        const nextVillage = event.target.value;
        setVillage(nextVillage);
        const first = rows.find((row) => row.village_name === nextVillage);
        if (first) onSelect(first.id);
      }} value={village}>{villages.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Survey number<select onChange={(event) => onSelect(event.target.value)} value={selectedParcel.id}>{villageRows.map((row) => <option key={row.id} value={row.id}>{row.survey_number}{row.old_survey_number ? " — old " + row.old_survey_number : ""}</option>)}</select></label>
      <div className="parcel-facts">
        <div><span>Current consent</span><strong className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</strong></div>
        <div><span>Area</span><strong>{selectedParcel.acreage === null ? "—" : display(selectedParcel.acreage) + " ac"}</strong></div>
        <div><span>Account / Khata</span><strong>{selectedParcel.account_number ?? "—"}</strong></div>
      </div>
      <button className="button button-secondary button-wide" onClick={onGoDetails} type="button">Open full survey details</button>
      {!isAdmin && <p className="small-note">Read-only access: only the administrator can create or update a consent entry.</p>}
    </section>

    <div className="detail-content">
      {loading && <section className="card empty-state"><strong>Loading default survey details…</strong></section>}
      {!loading && <form className="card consent-entry-card consent-workspace" onSubmit={submit}>
        <div className="card-heading"><div><div className="eyebrow">CONSENT ENTRY</div><h2>{selectedParcel.consent_status === "received" ? "Update consent record" : "Record received consent"}</h2><p>Village, survey, area and owner data below are pre-filled from the selected record. Only this entry changes the linked map color.</p></div><span className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</span></div>
        <section className="prefilled-consent-data"><div className="eyebrow">PRE-FILLED SURVEY DATA</div><DetailGrid items={[
          { label: "Village", value: selectedParcel.village_name },
          { label: "Survey no.", value: selectedParcel.survey_number },
          { label: "Owner / farmer", value: ownerNames },
          { label: "Account / Khata", value: detail?.account_number ?? selectedParcel.account_number },
          { label: "Area", value: selectedParcel.acreage === null ? null : display(selectedParcel.acreage) + " ac" },
          { label: "Old survey no.", value: detail?.old_survey_number ?? selectedParcel.old_survey_number }
        ]} /></section>
        <fieldset disabled={!isAdmin || saving}>
          <div className="form-grid">
            <label>Consent status<select onChange={(event) => setStatus(event.target.value as ConsentStatus)} value={status}>{consentOptions.map((item) => <option key={item} value={item}>{consentLabel[item]}</option>)}</select></label>
            <label>Received date<input disabled={status !== "received"} onChange={(event) => setReceivedOn(event.target.value)} required={status === "received"} type="date" value={receivedOn} /></label>
            <label className="field-full">Consent letter / reference<input onChange={(event) => setReference(event.target.value)} placeholder="Optional letter number or reference" value={reference} /></label>
            <label className="field-full">Remarks<textarea onChange={(event) => setRemarks(event.target.value)} placeholder="Optional field note, pending item or follow-up" rows={4} value={remarks} /></label>
          </div>
        </fieldset>
        <div className="form-footer"><span>{isAdmin ? "Saving Received is the only action that turns the exact linked CAD boundary green." : "You can review the default values, but they cannot be changed with this account."}</span><button className="button button-primary" disabled={!isAdmin || saving} type="submit">{saving ? "Saving…" : "Save consent entry"}</button></div>
      </form>}
    </div>
  </div>;
}
