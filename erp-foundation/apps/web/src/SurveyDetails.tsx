import { useEffect, useMemo, useState, type FormEvent } from "react";
import { consentLabel } from "./api";
import type { AcquisitionStage, ConsentStatus, ParcelDetail, ParcelSummary } from "./types";

const stageLabel: Record<AcquisitionStage, string> = {
  identified: "Identified",
  consent: "Consent",
  legal: "Legal review",
  nfa: "NFA",
  payment: "Payment",
  executed: "Executed",
  closed: "Closed",
  blocked: "Blocked"
};

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: ConsentStatus): string {
  return "status status-" + status;
}

function DetailGrid({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return <dl className="detail-grid">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{display(item.value)}</dd></div>)}</dl>;
}

export function SurveyDetails({
  rows,
  selectedParcel,
  detail,
  loading,
  isAdmin,
  onSelect,
  onRecordConsent,
  onGoDocuments
}: {
  rows: ParcelSummary[];
  selectedParcel: ParcelSummary | null;
  detail: ParcelDetail | null;
  loading: boolean;
  isAdmin: boolean;
  onSelect: (parcelId: string) => void;
  onRecordConsent: (receivedOn: string, remarks: string) => Promise<void>;
  onGoDocuments: () => void;
}) {
  const [village, setVillage] = useState(selectedParcel?.village_name ?? "");
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [savingConsent, setSavingConsent] = useState(false);
  const villages = useMemo(() => [...new Set(rows.map((row) => row.village_name))], [rows]);
  const villageRows = useMemo(
    () => rows.filter((row) => row.village_name === village).sort((left, right) => left.survey_number.localeCompare(right.survey_number, undefined, { numeric: true })),
    [rows, village]
  );

  useEffect(() => {
    if (selectedParcel) setVillage(selectedParcel.village_name);
    setShowConsentForm(false);
  }, [selectedParcel?.id]);

  if (!selectedParcel) return <section className="card empty-state"><strong>No survey selected.</strong></section>;

  const sourceFields = Object.entries(detail?.acquisition?.source_fields ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
  const submitConsent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingConsent(true);
    try {
      await onRecordConsent(receivedOn, remarks);
      setShowConsentForm(false);
      setRemarks("");
    } finally {
      setSavingConsent(false);
    }
  };

  return <div className="details-layout">
    <section className="card survey-selector">
      <div className="eyebrow">SELECT SURVEY</div>
      <h2>Village and survey number</h2>
      <p>Choose a village first, then select the survey number to see its full imported details.</p>
      <label>Village<select onChange={(event) => {
        const nextVillage = event.target.value;
        setVillage(nextVillage);
        const first = rows.find((row) => row.village_name === nextVillage);
        if (first) onSelect(first.id);
      }} value={village}>{villages.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Survey number<select onChange={(event) => onSelect(event.target.value)} value={selectedParcel.id}>{villageRows.map((row) => <option key={row.id} value={row.id}>{row.survey_number}{row.old_survey_number ? " — old " + row.old_survey_number : ""}</option>)}</select></label>
      <div className="parcel-facts">
        <div><span>Consent status</span><strong className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</strong></div>
        <div><span>Workflow stage</span><strong>{stageLabel[selectedParcel.acquisition_stage]}</strong></div>
        <div><span>Area</span><strong>{selectedParcel.acreage === null ? "—" : display(selectedParcel.acreage) + " ac"}</strong></div>
      </div>
      <button className="button button-secondary button-wide" onClick={onGoDocuments} type="button">View document status</button>
      {isAdmin && selectedParcel.consent_status !== "received" && <button className="button button-primary button-wide detail-action" onClick={() => setShowConsentForm((visible) => !visible)} type="button">+ Record received consent</button>}
      {!isAdmin && <p className="small-note">Read-only access: only the administrator can change consent or upload a document.</p>}
    </section>

    <div className="detail-content">
      {showConsentForm && <form className="card consent-entry-card" onSubmit={submitConsent}>
        <div className="card-heading"><div><div className="eyebrow">ADMIN ACTION</div><h3>Record received consent</h3><p>This is the only action that can turn a linked CAD shape green.</p></div></div>
        <div className="form-grid">
          <label>Received date<input onChange={(event) => setReceivedOn(event.target.value)} required type="date" value={receivedOn} /></label>
          <label className="field-full">Remarks<textarea onChange={(event) => setRemarks(event.target.value)} placeholder="Optional consent reference or note" rows={3} value={remarks} /></label>
        </div>
        <div className="form-footer"><span>Consent is independent from Google Drive document upload.</span><button className="button button-primary" disabled={savingConsent} type="submit">{savingConsent ? "Saving…" : "Save received consent"}</button></div>
      </form>}

      {loading && <section className="card empty-state"><strong>Loading survey details…</strong></section>}
      {!loading && !detail && <section className="card empty-state"><strong>Sign in to load the full survey details.</strong></section>}
      {detail && <>
        <section className="card detail-card">
          <div className="card-heading"><div><div className="eyebrow">LAND REGISTER</div><h2>{detail.village?.name_en ?? selectedParcel.village_name} / Survey {detail.survey_number}</h2><p>{detail.village?.district ?? "—"} · {detail.village?.taluka ?? "—"} · Source row {detail.source_row_number ?? "—"}</p></div><span className={statusClass(detail.consent?.status ?? "not_ready")}>{consentLabel[detail.consent?.status ?? "not_ready"]}</span></div>
          <DetailGrid items={[
            { label: "Old survey no.", value: detail.old_survey_number },
            { label: "H.Are.SqMt", value: detail.hectare_are_sqmt },
            { label: "Acre / Guntha", value: detail.acreage },
            { label: "Account number", value: detail.account_number },
            { label: "Tenure", value: detail.tenure },
            { label: "Land use", value: detail.land_use },
            { label: "Rights / encumbrances", value: detail.rights_and_encumbrances },
            { label: "Nondh number", value: detail.nondh_numbers },
            { label: "Latitude", value: detail.latitude },
            { label: "Longitude", value: detail.longitude }
          ]} />
        </section>

        <section className="detail-two-columns">
          <section className="card detail-card"><div className="eyebrow">OWNERS</div><h3>Farmer / owner details</h3>{detail.owners.length ? <div className="owner-list">{detail.owners.map((owner) => <div key={owner.id}><strong>{owner.display_name}</strong><span>{owner.is_primary ? "Primary owner" : "Owner " + (owner.sequence_no ?? "")}</span></div>)}</div> : <p className="muted">No owner name was supplied in the source sheet.</p>}</section>
          <section className="card detail-card"><div className="eyebrow">CONSENT</div><h3>Consent record</h3><DetailGrid items={[
            { label: "Status", value: detail.consent ? consentLabel[detail.consent.status] : "Not ready" },
            { label: "Received on", value: detail.consent?.received_on },
            { label: "Source", value: detail.consent?.source_value },
            { label: "Remarks", value: detail.consent?.remarks }
          ]} /></section>
        </section>

        <section className="card detail-card"><div className="eyebrow">PATEL INFRA WORKFLOW</div><h3>Acquisition and legal details</h3><DetailGrid items={[
          { label: "Project", value: detail.acquisition?.project_name },
          { label: "SPV", value: detail.acquisition?.spv_name },
          { label: "MW", value: detail.acquisition?.mw },
          { label: "Stage", value: detail.acquisition ? stageLabel[detail.acquisition.acquisition_stage] : "Identified" },
          { label: "Category", value: detail.acquisition?.category },
          { label: "ATL category", value: detail.acquisition?.atl_category },
          { label: "Acquisition purpose", value: detail.acquisition?.acquisition_purpose },
          { label: "Target date", value: detail.acquisition?.target_date },
          { label: "Execution date", value: detail.acquisition?.execution_date },
          { label: "Reason not acquired", value: detail.acquisition?.reason_not_acquired },
          { label: "Public notice", value: detail.legal?.public_notice_status },
          { label: "SRO search", value: detail.legal?.sro_search_status },
          { label: "Law firm verification", value: detail.legal?.law_firm_verification_status },
          { label: "NFA no.", value: detail.legal?.nfa_number },
          { label: "Legal remarks", value: detail.legal?.legal_remarks }
        ]} /></section>

        {sourceFields.length > 0 && <section className="card detail-card"><div className="eyebrow">SOURCE REPORT FIELDS</div><h3>Additional Patel Infra fields</h3><DetailGrid items={sourceFields.map(([field, value]) => ({ label: label(field), value }))} /></section>}

        <section className="card detail-card"><div className="eyebrow">DOCUMENT CHECKLIST</div><h3>Current document status</h3>{detail.documents.length ? <div className="document-status-list">{detail.documents.map((document) => <div key={document.document_type_code + document.created_at}><span>{label(document.document_type_code)}</span><strong>{label(document.status)}</strong></div>)}</div> : <p className="muted">No Drive document has been attached yet. This does not change the consent status.</p>}</section>

        {isAdmin && <section className="card detail-card sensitive-card"><div className="eyebrow">ADMIN-ONLY SENSITIVE DATA</div><h3>Restricted identity and bank fields</h3>{detail.private_owner_details.length ? detail.private_owner_details.map((privateDetail) => <DetailGrid key={privateDetail.owner_id} items={[
          { label: "Bank owner name", value: privateDetail.bank_owner_name },
          { label: "Vendor code", value: privateDetail.vendor_code },
          { label: "PAN", value: privateDetail.pan_number },
          { label: "Aadhaar", value: privateDetail.aadhaar_number },
          { label: "Bank account", value: privateDetail.bank_account_number },
          { label: "Bank name", value: privateDetail.bank_name },
          { label: "IFSC", value: privateDetail.ifsc_code }
        ]} />) : <p className="muted">No restricted fields were supplied for this survey.</p>}</section>}
      </>}
    </div>
  </div>;
}
