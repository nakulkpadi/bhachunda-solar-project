import { useEffect, useState, type FormEvent } from "react";
import { consentLabel } from "./api";
import type { ConsentStatus, ParcelDetail, ParcelSummary } from "./types";
import { SurveyPicker } from "./ui";

const consentOptions: ConsentStatus[] = ["received", "pending", "not_ready", "blocked", "rejected"];

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

function statusClass(status: ConsentStatus): string {
  return "status status-" + status;
}

function referenceFromSource(source: string | null | undefined): string {
  const manualPrefix = "Manual ERP consent entry";
  if (!source || source === manualPrefix) return "";
  return source.startsWith(manualPrefix + " · ")
    ? source.slice((manualPrefix + " · ").length)
    : source;
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
  const [status, setStatus] = useState<ConsentStatus>("received");
  const [receivedOn, setReceivedOn] = useState(today());
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!selectedParcel) return;
    setStatus("received");
    setReceivedOn(detail?.consent?.received_on ?? today());
    setReference(referenceFromSource(detail?.consent?.source_value));
    setRemarks(detail?.consent?.remarks ?? "");
    setSaveError("");
  }, [selectedParcel?.id, detail?.consent?.received_on, detail?.consent?.remarks, detail?.consent?.source_value]);

  if (!selectedParcel) return <section className="card empty-state"><strong>No survey selected.</strong></section>;

  const ownerNames = detail?.owners.map((owner) => owner.display_name).filter(Boolean).join(", ") || "—";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave({ status, receivedOn, reference, remarks });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save consent. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="details-layout">
    <section className="card survey-selector">
      <div className="eyebrow">01 / Select record</div>
      <h2>Choose a survey</h2>
      <p>Land and owner details are filled from the register.</p>
      <SurveyPicker rows={rows} selectedParcel={selectedParcel} onSelect={onSelect} disabled={saving} />
      <div className="parcel-facts">
        <div><span>Current consent</span><strong className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</strong></div>
        <div><span>Area</span><strong>{selectedParcel.acreage === null ? "—" : display(selectedParcel.acreage) + " ac"}</strong></div>
        <div><span>Account / Khata</span><strong>{selectedParcel.account_number ?? "—"}</strong></div>
      </div>
      <button className="text-button" onClick={onGoDetails} type="button">View full survey record</button>
      {!isAdmin && <p className="small-note">View access. An administrator can save this entry.</p>}
    </section>

    <div className="detail-content">
      {loading && <section className="card empty-state"><strong>Loading default survey details…</strong></section>}
      {!loading && <form className="card consent-entry-card consent-workspace" onSubmit={submit}>
        <div className="card-heading"><div><div className="eyebrow">02 / Consent</div><h2>{selectedParcel.consent_status === "received" ? "Update consent" : "Record consent"}</h2><p>{selectedParcel.village_name} · Survey {selectedParcel.survey_number}</p></div><span className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</span></div>
        <section className="prefilled-consent-data"><div className="section-label">From the land register</div><DetailGrid items={[
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
          </div>
          <details className="form-disclosure"><summary>Reference and remarks <span>Optional</span></summary><div className="form-grid">
            <label className="field-full">Consent letter / reference<input onChange={(event) => setReference(event.target.value)} placeholder="Letter number or reference" value={reference} /></label>
            <label className="field-full">Remarks<textarea onChange={(event) => setRemarks(event.target.value)} placeholder="Field note or follow-up" rows={3} value={remarks} /></label>
          </div></details>
        </fieldset>
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="form-footer"><span>{isAdmin ? "Received consent turns its linked map boundary green." : "Only the administrator can save changes."}</span><button className="button button-primary" disabled={!isAdmin || saving} type="submit">{saving ? "Saving…" : "Save consent"}</button></div>
      </form>}
    </div>
  </div>;
}
