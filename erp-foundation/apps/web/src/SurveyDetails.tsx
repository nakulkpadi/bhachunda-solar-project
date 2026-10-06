import { consentLabel } from "./api";
import type { AcquisitionStage, ConsentStatus, ParcelDetail, ParcelSummary } from "./types";
import { SurveyPicker } from "./ui";
import { OwnerDetailsSection, SurveyDocumentPanel, type ConsentWorkspaceActions } from "./ConsentDocuments";

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
  onGoConsent,
  onGoDocuments,
  workspace
}: {
  rows: ParcelSummary[];
  selectedParcel: ParcelSummary | null;
  detail: ParcelDetail | null;
  loading: boolean;
  isAdmin: boolean;
  onSelect: (parcelId: string) => void;
  onGoConsent: () => void;
  onGoDocuments: () => void;
  workspace: ConsentWorkspaceActions;
}) {
  if (!selectedParcel) return <section className="card empty-state"><strong>No survey selected.</strong></section>;

  const sourceFields = Object.entries(detail?.acquisition?.source_fields ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
  return <div className="details-layout">
    <section className="card survey-selector with-documents">
      <div className="eyebrow">Land register</div>
      <h2>Choose a survey</h2>
      <p>Select a village to see its survey numbers.</p>
      <SurveyPicker rows={rows} selectedParcel={selectedParcel} onSelect={onSelect} disabled={workspace.busy} />
      <div className="parcel-facts">
        <div><span>Consent status</span><strong className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</strong></div>
        <div><span>Workflow stage</span><strong>{stageLabel[selectedParcel.acquisition_stage]}</strong></div>
        <div><span>Area</span><strong>{selectedParcel.acreage === null ? "—" : display(selectedParcel.acreage) + " ac"}</strong></div>
      </div>
      {isAdmin && <button className="button button-primary button-wide" onClick={onGoConsent} type="button">{selectedParcel.consent_status === "received" ? "Update consent" : "Create consent entry"}</button>}
      <button className="button button-secondary button-wide detail-action" onClick={onGoDocuments} type="button">View documents</button>
      {!isAdmin && <p className="small-note">View access. An administrator can edit this record.</p>}
      {!loading && detail && <SurveyDocumentPanel actions={workspace} detail={detail} isAdmin={isAdmin} />}
    </section>

    <div className="detail-content">
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

        <OwnerDetailsSection actions={workspace} detail={detail} isAdmin={isAdmin} />
          <section className="card detail-card"><div className="eyebrow">CONSENT</div><h3>Consent record</h3><DetailGrid items={[
            { label: "Status", value: detail.consent ? consentLabel[detail.consent.status] : "Not ready" },
            { label: "Received on", value: detail.consent?.received_on },
            { label: "Source", value: detail.consent?.source_value },
            { label: "Remarks", value: detail.consent?.remarks }
          ]} /></section>

        <details className="card detail-disclosure"><summary><span>Acquisition and legal details<small>Patel Infra workflow</small></span></summary><div className="disclosure-body"><DetailGrid items={[
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
        ]} /></div></details>

        {sourceFields.length > 0 && <details className="card detail-disclosure"><summary><span>Additional report fields<small>{sourceFields.length} imported Patel Infra fields</small></span></summary><div className="disclosure-body"><DetailGrid items={sourceFields.map(([field, value]) => ({ label: label(field), value }))} /></div></details>}

        <section className="card detail-card"><div className="eyebrow">DOCUMENT CHECKLIST</div><h3>Current document status</h3>{detail.documents.length ? <div className="document-status-list">{detail.documents.map((document) => <div key={document.document_type_code + document.created_at}><span>{label(document.document_type_code)}</span><strong>{label(document.status)}</strong></div>)}</div> : <p className="muted">No Drive document has been attached yet. This does not change the consent status.</p>}</section>

      </>}
    </div>
  </div>;
}
