import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  consentLabel,
  getSession,
  isSupabaseConfigured,
  loadGoogleDriveConnectionStatus,
  loadMapStatuses,
  loadParcels,
  saveParcelWorkflow,
  signIn,
  signOut,
  startGoogleDriveConnection,
  supabase,
  uploadDriveDocument
} from "./api";
import { demoParcels } from "./demo";
import type {
  AcquisitionStage,
  ConsentStatus,
  DashboardMetrics,
  MapStatus,
  ParcelSummary,
  ParcelWorkflowInput
} from "./types";

type ViewId = "dashboard" | "registry" | "entry" | "documents" | "reports" | "map";
type Notice = { kind: "success" | "error" | "info"; text: string } | null;

const viewTitles: Record<ViewId, string> = {
  dashboard: "Project overview",
  registry: "Land registry",
  entry: "Workflow entry",
  documents: "Documents",
  reports: "Reports",
  map: "Survey map"
};

const navItems: Array<{ id: ViewId; icon: string; label: string }> = [
  { id: "dashboard", icon: "▦", label: "Overview" },
  { id: "registry", icon: "☷", label: "Land registry" },
  { id: "entry", icon: "✎", label: "Workflow entry" },
  { id: "documents", icon: "▱", label: "Documents" },
  { id: "reports", icon: "▤", label: "Reports" },
  { id: "map", icon: "⌖", label: "Survey map" }
];

const consentOptions: ConsentStatus[] = ["received", "pending", "not_ready", "blocked", "rejected"];
const stageOptions: AcquisitionStage[] = ["identified", "consent", "legal", "nfa", "payment", "executed", "closed", "blocked"];

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

function asNumber(value: number | null): number {
  return value ?? 0;
}

function formatAcres(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)} ac`;
}

function statusClass(status: ConsentStatus): string {
  return `status status-${status}`;
}

function createWorkflow(parcel: ParcelSummary): ParcelWorkflowInput {
  return {
    parcelId: parcel.id,
    oldSurveyNumber: parcel.old_survey_number ?? "",
    acreage: parcel.acreage?.toString() ?? "",
    bunchNumber: parcel.bunch_number ?? "",
    consentStatus: parcel.consent_status,
    consentDate: parcel.consent_status === "received" ? new Date().toISOString().slice(0, 10) : "",
    acquisitionStage: parcel.acquisition_stage,
    category: "",
    targetDate: "",
    legalRemarks: ""
  };
}

function buildMetrics(rows: ParcelSummary[]): DashboardMetrics {
  const villages = [...new Set(rows.map((row) => row.village_name))].map((village) => {
    const villageRows = rows.filter((row) => row.village_name === village);
    return {
      village,
      total: villageRows.length,
      received: villageRows.filter((row) => row.consent_status === "received").length,
      acreage: villageRows.reduce((sum, row) => sum + asNumber(row.acreage), 0)
    };
  });

  return {
    totalParcels: rows.length,
    receivedCount: rows.filter((row) => row.consent_status === "received").length,
    pendingCount: rows.filter((row) => row.consent_status !== "received").length,
    documentGapCount: rows.filter((row) => row.document_count === 0).length,
    villages
  };
}

function csvValue(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(rows: ParcelSummary[], fileName: string): void {
  const columns = ["Village", "Survey no.", "Old survey no.", "Acres", "Consent", "Stage", "Documents", "Verified documents"];
  const data = rows.map((row) => [
    row.village_name,
    row.survey_number,
    row.old_survey_number,
    row.acreage,
    consentLabel[row.consent_status],
    stageLabel[row.acquisition_stage],
    row.document_count,
    row.verified_document_count
  ]);
  const csv = `\uFEFF${[columns, ...data].map((line) => line.map(csvValue).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!isSupabaseConfigured);
  const [parcels, setParcels] = useState<ParcelSummary[]>(demoParcels);
  const [mapStatuses, setMapStatuses] = useState<MapStatus[]>([]);
  const [isLiveData, setIsLiveData] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [search, setSearch] = useState("");
  const [villageFilter, setVillageFilter] = useState("all");
  const [consentFilter, setConsentFilter] = useState<"all" | ConsentStatus>("all");
  const [stageFilter, setStageFilter] = useState<"all" | AcquisitionStage>("all");
  const [selectedParcelId, setSelectedParcelId] = useState(demoParcels[0].id);
  const [workflow, setWorkflow] = useState<ParcelWorkflowInput>(() => createWorkflow(demoParcels[0]));
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [documentType, setDocumentType] = useState("consent_letter");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [mapSelection, setMapSelection] = useState<string | null>(null);
  const mapRef = useRef<HTMLObjectElement | null>(null);

  const refreshLiveData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const [liveParcels, liveStatuses, connected] = await Promise.all([
        loadParcels(),
        loadMapStatuses(),
        loadGoogleDriveConnectionStatus().catch(() => false)
      ]);
      setParcels(liveParcels);
      setMapStatuses(liveStatuses);
      setDriveConnected(connected);
      setIsLiveData(true);
      setNotice({ kind: "success", text: "Live records refreshed." });
    } catch (error) {
      setIsLiveData(false);
      setParcels(demoParcels);
      setNotice({
        kind: "error",
        text: error instanceof Error ? `Live database is not ready: ${error.message}` : "Live database is not ready yet."
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void getSession()
      .then((currentSession) => {
        if (!active) return;
        setSession(currentSession);
        setSessionChecked(true);
        if (currentSession) void refreshLiveData();
      })
      .catch(() => {
        if (active) setSessionChecked(true);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) void refreshLiveData();
      if (!nextSession) {
        setIsLiveData(false);
        setParcels(demoParcels);
        setMapStatuses([]);
        setDriveConnected(false);
        setConnectingDrive(false);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [refreshLiveData]);

  useEffect(() => {
    const onGoogleDriveResult = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      const data = event.data as { type?: unknown };
      if (data.type === "bhachunda-google-drive-connected") {
        setDriveConnected(true);
        setConnectingDrive(false);
        setNotice({ kind: "success", text: "Google Drive connected. This ERP is ready to create protected survey folders." });
      }
      if (data.type === "bhachunda-google-drive-failed") {
        setDriveConnected(false);
        setConnectingDrive(false);
        setNotice({ kind: "error", text: "Google Drive was not connected. Check the selected Google account and try again." });
      }
    };
    window.addEventListener("message", onGoogleDriveResult);
    return () => window.removeEventListener("message", onGoogleDriveResult);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("drive");
    if (result !== "connected" && result !== "failed") return;
    url.searchParams.delete("drive");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    const type = result === "connected" ? "bhachunda-google-drive-connected" : "bhachunda-google-drive-failed";
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type }, window.location.origin);
      window.setTimeout(() => window.close(), 100);
      return;
    }
    setConnectingDrive(false);
    if (result === "connected") {
      setDriveConnected(true);
      setNotice({ kind: "success", text: "Google Drive connected. This ERP is ready to create protected survey folders." });
    } else {
      setDriveConnected(false);
      setNotice({ kind: "error", text: "Google Drive was not connected. Check the selected Google account and try again." });
    }
  }, []);

  const metrics = useMemo(() => buildMetrics(parcels), [parcels]);
  const villages = useMemo(() => [...new Set(parcels.map((row) => row.village_name))], [parcels]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return parcels.filter((row) => {
      const searchable = [row.village_name, row.survey_number, row.old_survey_number ?? "", row.account_number ?? "", row.bunch_number ?? ""]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (villageFilter === "all" || row.village_name === villageFilter) &&
        (consentFilter === "all" || row.consent_status === consentFilter) &&
        (stageFilter === "all" || row.acquisition_stage === stageFilter) &&
        (!query || searchable.includes(query))
      );
    });
  }, [parcels, search, villageFilter, consentFilter, stageFilter]);

  const selectedParcel = useMemo(
    () => parcels.find((row) => row.id === selectedParcelId) ?? visibleRows[0] ?? parcels[0] ?? null,
    [parcels, selectedParcelId, visibleRows]
  );

  useEffect(() => {
    if (selectedParcel && selectedParcel.id !== selectedParcelId) setSelectedParcelId(selectedParcel.id);
  }, [selectedParcel, selectedParcelId]);

  useEffect(() => {
    if (selectedParcel) setWorkflow(createWorkflow(selectedParcel));
  }, [selectedParcel?.id]);

  const chooseParcel = (parcel: ParcelSummary, nextView: ViewId = "entry") => {
    setSelectedParcelId(parcel.id);
    setActiveView(nextView);
  };

  const signInToDatabase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      setNotice({ kind: "info", text: "Add the project URL and publishable key to apps/web/.env.local first." });
      return;
    }
    setSigningIn(true);
    try {
      await signIn(email.trim(), password);
      setShowSignIn(false);
      setPassword("");
      setNotice({ kind: "success", text: "Signed in. Loading your permitted records…" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not sign in." });
    } finally {
      setSigningIn(false);
    }
  };

  const saveWorkflow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || !isLiveData) {
      setNotice({ kind: "info", text: "Sign in and complete the staging import before writing workflow records." });
      return;
    }
    setSavingWorkflow(true);
    try {
      await saveParcelWorkflow(workflow);
      await refreshLiveData();
      setNotice({ kind: "success", text: `Workflow saved for survey ${selectedParcel?.survey_number ?? ""}.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Workflow save failed." });
    } finally {
      setSavingWorkflow(false);
    }
  };

  const uploadDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedParcel || !uploadFile) {
      setNotice({ kind: "info", text: "Choose a parcel and a document file first." });
      return;
    }
    if (!session || !isLiveData) {
      setNotice({ kind: "info", text: "Sign in and complete the staging import before uploading to Drive." });
      return;
    }
    if (uploadFile.size > 15 * 1024 * 1024) {
      setNotice({ kind: "error", text: "This file is over the 15 MB browser limit." });
      return;
    }
    setUploading(true);
    try {
      await uploadDriveDocument(selectedParcel.id, documentType, uploadFile);
      setUploadFile(null);
      setNotice({ kind: "success", text: "Document saved to the parcel’s protected Google Drive folder." });
      await refreshLiveData();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Drive upload failed." });
    } finally {
      setUploading(false);
    }
  };

  const connectPersonalDrive = async () => {
    if (!session || !isLiveData) {
      setNotice({ kind: "info", text: "Sign in with an administrator account after the staging import is complete." });
      return;
    }
    const popup = window.open("", "bhachunda-google-drive-oauth", "popup=yes,width=560,height=720");
    setConnectingDrive(true);
    try {
      const authorizeUrl = await startGoogleDriveConnection();
      if (popup && !popup.closed) {
        popup.location.assign(authorizeUrl);
        setNotice({ kind: "info", text: "Complete Google sign-in in the opened window. This ERP page will stay open." });
      } else {
        window.location.assign(authorizeUrl);
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not start Google Drive connection." });
      setConnectingDrive(false);
    }
  };

  const applyMapStatuses = useCallback(() => {
    const svgDocument = mapRef.current?.contentDocument;
    if (!svgDocument) return;
    const statusByFeature = new Map(mapStatuses.map((item) => [item.feature_key, item.status]));
    svgDocument.querySelectorAll<SVGElement>("[data-feature-key]").forEach((element) => {
      const key = element.dataset.featureKey ?? "";
      // In live mode a map must be driven only by imported, mapped records. In preview
      // mode the reviewed CAD candidate styling is retained for stakeholder review.
      const nextStatus = isLiveData ? statusByFeature.get(key) ?? "not_ready" : (element.dataset.displayConsent as ConsentStatus) ?? "not_ready";
      consentOptions.forEach((status) => element.classList.remove(`consent-${status}`));
      element.classList.remove("consent-unclassified");
      element.classList.add(`consent-${nextStatus}`);
      element.dataset.displayConsent = nextStatus;
      element.addEventListener("click", () => setMapSelection(key));
    });
  }, [isLiveData, mapStatuses]);

  useEffect(() => {
    applyMapStatuses();
  }, [applyMapStatuses]);

  const reportRows = useMemo(() => {
    if (activeView !== "reports") return visibleRows;
    return visibleRows;
  }, [activeView, visibleRows]);

  const consentPercent = metrics.totalParcels ? Math.round((metrics.receivedCount / metrics.totalParcels) * 100) : 0;
  const liveLabel = isLiveData ? "Live database" : "Preview only";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-mark" aria-hidden="true"><span>☀</span></div>
        <div className="brand-name">Bhachunda <strong>Solar ERP</strong></div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              className={`nav-item ${activeView === item.id ? "is-active" : ""}`}
              key={item.id}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className={`mode-dot ${isLiveData ? "is-live" : ""}`} />
          <span>{liveLabel}</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">BHACHUNDA SUB STATION</div>
            <h1>{viewTitles[activeView]}</h1>
          </div>
          <div className="topbar-actions">
            {loading && <span className="muted">Refreshing…</span>}
            {session ? (
              <>
                <span className="account-chip" title={session.user.email ?? "Signed-in user"}>{session.user.email ?? "Signed in"}</span>
                <button className="button button-secondary" onClick={() => void signOut()} type="button">Sign out</button>
              </>
            ) : (
              <button className="button button-primary" disabled={!sessionChecked} onClick={() => setShowSignIn(true)} type="button">
                {sessionChecked ? "Sign in" : "Checking session…"}
              </button>
            )}
          </div>
        </header>

        {notice && (
          <div className={`notice notice-${notice.kind}`} role="status">
            <span>{notice.kind === "success" ? "✓" : notice.kind === "error" ? "!" : "i"}</span>
            <p>{notice.text}</p>
            <button aria-label="Dismiss notice" onClick={() => setNotice(null)} type="button">×</button>
          </div>
        )}

        {!isLiveData && (
          <section className="preview-banner">
            <div><strong>Safe preview mode.</strong> The dashboard uses de-identified sample records and aggregate Excel counts until the Supabase migration and import are completed.</div>
            <button className="text-button" onClick={() => setActiveView("reports")} type="button">Review reports →</button>
          </section>
        )}

        <section className="page-body">
          {activeView === "dashboard" && (
            <Dashboard
              metrics={metrics}
              parcels={parcels}
              consentPercent={consentPercent}
              onChooseParcel={chooseParcel}
              onShowRegistry={() => setActiveView("registry")}
            />
          )}
          {activeView === "registry" && (
            <Registry
              rows={visibleRows}
              villages={villages}
              search={search}
              villageFilter={villageFilter}
              consentFilter={consentFilter}
              stageFilter={stageFilter}
              onSearch={setSearch}
              onVillage={setVillageFilter}
              onConsent={setConsentFilter}
              onStage={setStageFilter}
              onChooseParcel={chooseParcel}
              onClear={() => { setSearch(""); setVillageFilter("all"); setConsentFilter("all"); setStageFilter("all"); }}
            />
          )}
          {activeView === "entry" && (
            <WorkflowEntry
              rows={parcels}
              selectedParcel={selectedParcel}
              workflow={workflow}
              isWritable={Boolean(session && isLiveData)}
              saving={savingWorkflow}
              onSelect={setSelectedParcelId}
              onChange={setWorkflow}
              onSubmit={saveWorkflow}
              onGoDocuments={() => setActiveView("documents")}
            />
          )}
          {activeView === "documents" && (
            <Documents
              rows={parcels}
              selectedParcel={selectedParcel}
              documentType={documentType}
              uploadFile={uploadFile}
              isWritable={Boolean(session && isLiveData)}
              uploading={uploading}
              onSelect={setSelectedParcelId}
              onDocumentType={setDocumentType}
              onFile={setUploadFile}
              onSubmit={uploadDocument}
              canConnectDrive={Boolean(session && isLiveData)}
              connectingDrive={connectingDrive}
              driveConnected={driveConnected}
              onConnectDrive={connectPersonalDrive}
            />
          )}
          {activeView === "reports" && (
            <Reports
              rows={reportRows}
              metrics={metrics}
              search={search}
              villages={villages}
              villageFilter={villageFilter}
              consentFilter={consentFilter}
              stageFilter={stageFilter}
              onSearch={setSearch}
              onVillage={setVillageFilter}
              onConsent={setConsentFilter}
              onStage={setStageFilter}
              onDownload={() => downloadCsv(reportRows, "bhachunda-solar-filtered-report.csv")}
            />
          )}
          {activeView === "map" && (
            <SurveyMap
              mapRef={mapRef}
              isLiveData={isLiveData}
              mapSelection={mapSelection}
              onLoad={applyMapStatuses}
              onGoRegistry={() => setActiveView("registry")}
            />
          )}
        </section>
      </main>

      {showSignIn && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowSignIn(false)}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="sign-in-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="dialog-close" aria-label="Close" onClick={() => setShowSignIn(false)} type="button">×</button>
            <div className="eyebrow">SUPABASE AUTH</div>
            <h2 id="sign-in-title">Sign in to live records</h2>
            <p>Use an invited staff account. Project roles control which records and actions are available after sign-in.</p>
            <form className="stack-form" onSubmit={signInToDatabase}>
              <label>Email<input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
              <label>Password<input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
              <button className="button button-primary button-wide" disabled={signingIn} type="submit">{signingIn ? "Signing in…" : "Sign in securely"}</button>
            </form>
            <p className="fine-print">This browser app never contains the service-role key or Google Drive credential.</p>
          </section>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  metrics,
  parcels,
  consentPercent,
  onChooseParcel,
  onShowRegistry
}: {
  metrics: DashboardMetrics;
  parcels: ParcelSummary[];
  consentPercent: number;
  onChooseParcel: (parcel: ParcelSummary, view?: ViewId) => void;
  onShowRegistry: () => void;
}) {
  const latestRows = parcels.slice(0, 5);
  const totalAcres = metrics.villages.reduce((sum, village) => sum + village.acreage, 0);
  return (
    <div className="dashboard-grid">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">LAND ACQUISITION CONTROL ROOM</div>
          <h2>Every survey number, consent and document in one working register.</h2>
          <p>Track the full Bhavanipar, Bitta and Vandh Timbo workflow without manually joining separate Excel sheets, Drive links and Firebase entries.</p>
        </div>
        <button className="button button-primary" onClick={onShowRegistry} type="button">Open land registry</button>
      </section>

      <section className="metric-grid">
        <MetricCard label="Total surveys" value={metrics.totalParcels.toLocaleString("en-IN")} detail={`${formatAcres(totalAcres)} tracked`} accent="blue" />
        <MetricCard label="Consent received" value={metrics.receivedCount.toLocaleString("en-IN")} detail={`${consentPercent}% of records`} accent="green" />
        <MetricCard label="Consent still open" value={metrics.pendingCount.toLocaleString("en-IN")} detail="Pending, not ready, blocked or rejected" accent="amber" />
        <MetricCard label="No document yet" value={metrics.documentGapCount.toLocaleString("en-IN")} detail="Will be resolved by Drive uploads" accent="slate" />
      </section>

      <section className="card consent-panel">
        <div className="card-heading"><div><div className="eyebrow">CONSENT POSITION</div><h3>Consent progress by village</h3></div><strong>{consentPercent}%</strong></div>
        <div className="progress-track"><span style={{ width: `${consentPercent}%` }} /></div>
        <div className="village-metrics">
          {metrics.villages.map((village) => {
            const percentage = village.total ? Math.round((village.received / village.total) * 100) : 0;
            return <div className="village-row" key={village.village}>
              <div><strong>{village.village}</strong><span>{village.received} of {village.total} consents</span></div>
              <div className="village-bar"><span style={{ width: `${percentage}%` }} /></div>
              <strong>{percentage}%</strong>
            </div>;
          })}
        </div>
        <p className="small-note"><span className="legend-swatch swatch-green" /> Green means only <strong>consent received</strong>. Drive-document upload status is tracked separately.</p>
      </section>

      <section className="card action-panel">
        <div className="card-heading"><div><div className="eyebrow">WORK QUEUE</div><h3>Next operational actions</h3></div></div>
        <ol className="action-list">
          <li><span>01</span><div><strong>Import and reconcile workbook</strong><p>Run the staging import, confirm the counts and approve exceptions.</p></div></li>
          <li><span>02</span><div><strong>Invite operational users</strong><p>Assign Data Entry, Legal, Finance and Viewer roles before live work begins.</p></div></li>
          <li><span>03</span><div><strong>Connect protected Drive root</strong><p>Uploads will create a dedicated village / survey folder automatically.</p></div></li>
        </ol>
      </section>

      <section className="card registry-preview">
        <div className="card-heading"><div><div className="eyebrow">LAND REGISTER</div><h3>Survey workflow snapshot</h3></div><button className="text-button" onClick={onShowRegistry} type="button">View all →</button></div>
        <ParcelTable rows={latestRows} onChoose={onChooseParcel} compact />
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  return <article className={`metric-card accent-${accent}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function FilterBar({
  search,
  villages,
  villageFilter,
  consentFilter,
  stageFilter,
  onSearch,
  onVillage,
  onConsent,
  onStage,
  onClear
}: {
  search: string;
  villages: string[];
  villageFilter: string;
  consentFilter: "all" | ConsentStatus;
  stageFilter: "all" | AcquisitionStage;
  onSearch: (value: string) => void;
  onVillage: (value: string) => void;
  onConsent: (value: "all" | ConsentStatus) => void;
  onStage: (value: "all" | AcquisitionStage) => void;
  onClear?: () => void;
}) {
  return <div className="filter-bar">
    <label className="search-field"><span>⌕</span><input aria-label="Search register" onChange={(event) => onSearch(event.target.value)} placeholder="Survey number, Khata, old survey…" value={search} /></label>
    <select aria-label="Filter village" onChange={(event) => onVillage(event.target.value)} value={villageFilter}><option value="all">All villages</option>{villages.map((village) => <option key={village} value={village}>{village}</option>)}</select>
    <select aria-label="Filter consent status" onChange={(event) => onConsent(event.target.value as "all" | ConsentStatus)} value={consentFilter}><option value="all">All consent states</option>{consentOptions.map((status) => <option key={status} value={status}>{consentLabel[status]}</option>)}</select>
    <select aria-label="Filter workflow stage" onChange={(event) => onStage(event.target.value as "all" | AcquisitionStage)} value={stageFilter}><option value="all">All stages</option>{stageOptions.map((stage) => <option key={stage} value={stage}>{stageLabel[stage]}</option>)}</select>
    {onClear && <button className="button button-quiet" onClick={onClear} type="button">Clear</button>}
  </div>;
}

function Registry({
  rows,
  villages,
  search,
  villageFilter,
  consentFilter,
  stageFilter,
  onSearch,
  onVillage,
  onConsent,
  onStage,
  onChooseParcel,
  onClear
}: {
  rows: ParcelSummary[];
  villages: string[];
  search: string;
  villageFilter: string;
  consentFilter: "all" | ConsentStatus;
  stageFilter: "all" | AcquisitionStage;
  onSearch: (value: string) => void;
  onVillage: (value: string) => void;
  onConsent: (value: "all" | ConsentStatus) => void;
  onStage: (value: "all" | AcquisitionStage) => void;
  onChooseParcel: (parcel: ParcelSummary, view?: ViewId) => void;
  onClear: () => void;
}) {
  return <section className="card registry-card">
    <div className="card-heading"><div><div className="eyebrow">MASTER DATA</div><h2>Land registry</h2><p>Filter, inspect and open the workflow for any imported survey number.</p></div><div className="result-count">{rows.length} records</div></div>
    <FilterBar {...{ search, villages, villageFilter, consentFilter, stageFilter, onSearch, onVillage, onConsent, onStage, onClear }} />
    <ParcelTable rows={rows} onChoose={onChooseParcel} />
  </section>;
}

function ParcelTable({ rows, onChoose, compact = false }: { rows: ParcelSummary[]; onChoose: (parcel: ParcelSummary, view?: ViewId) => void; compact?: boolean }) {
  if (!rows.length) return <div className="empty-state"><strong>No surveys match these filters.</strong><span>Clear one or more filters to see the register again.</span></div>;
  return <div className="table-scroll"><table className={compact ? "parcel-table compact" : "parcel-table"}><thead><tr><th>Village</th><th>Survey</th><th>Area</th><th>Consent</th><th>Stage</th><th>Documents</th><th aria-label="Open" /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.village_name}</strong><small>{row.account_number ? `Khata ${row.account_number}` : "No Khata"}</small></td><td><strong>{row.survey_number}</strong><small>{row.old_survey_number ? `Old: ${row.old_survey_number}` : "Old no. —"}</small></td><td>{formatAcres(row.acreage)}</td><td><span className={statusClass(row.consent_status)}>{consentLabel[row.consent_status]}</span></td><td><span className="stage-pill">{stageLabel[row.acquisition_stage]}</span></td><td><span>{row.verified_document_count}/{row.document_count} verified</span></td><td><button className="row-action" onClick={() => onChoose(row)} type="button">Open <span>→</span></button></td></tr>)}</tbody></table></div>;
}

function WorkflowEntry({
  rows,
  selectedParcel,
  workflow,
  isWritable,
  saving,
  onSelect,
  onChange,
  onSubmit,
  onGoDocuments
}: {
  rows: ParcelSummary[];
  selectedParcel: ParcelSummary | null;
  workflow: ParcelWorkflowInput;
  isWritable: boolean;
  saving: boolean;
  onSelect: (parcelId: string) => void;
  onChange: (next: ParcelWorkflowInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onGoDocuments: () => void;
}) {
  if (!selectedParcel) return <section className="card empty-state"><strong>No parcel selected.</strong></section>;
  const update = <K extends keyof ParcelWorkflowInput>(key: K, value: ParcelWorkflowInput[K]) => onChange({ ...workflow, [key]: value });
  return <div className="entry-layout">
    <section className="card selection-card">
      <div className="eyebrow">ACTIVE SURVEY</div><h2>{selectedParcel.village_name} / {selectedParcel.survey_number}</h2><p>Select a survey to capture its next operational status. The records remain tied to the original import.</p>
      <label>Survey number<select onChange={(event) => onSelect(event.target.value)} value={selectedParcel.id}>{rows.map((row) => <option key={row.id} value={row.id}>{row.village_name} — {row.survey_number}</option>)}</select></label>
      <div className="parcel-facts"><div><span>Khata / account</span><strong>{selectedParcel.account_number ?? "—"}</strong></div><div><span>Document count</span><strong>{selectedParcel.verified_document_count}/{selectedParcel.document_count} verified</strong></div><div><span>Current consent</span><strong className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</strong></div></div>
      <button className="button button-secondary button-wide" onClick={onGoDocuments} type="button">Upload a document for this survey</button>
    </section>
    <form className="card workflow-form" onSubmit={onSubmit}>
      <div className="card-heading"><div><div className="eyebrow">PATEL INFRA WORKFLOW</div><h2>Update land-acquisition record</h2><p>{isWritable ? "Changes are saved with your role and timestamp." : "Preview values are editable locally but cannot be saved until live access is ready."}</p></div>{!isWritable && <span className="lock-badge">Preview locked</span>}</div>
      <fieldset disabled={!isWritable || saving}>
        <div className="form-grid">
          <label>Old survey number<input onChange={(event) => update("oldSurveyNumber", event.target.value)} value={workflow.oldSurveyNumber} /></label>
          <label>Acres<input inputMode="decimal" min="0" onChange={(event) => update("acreage", event.target.value)} type="number" value={workflow.acreage} /></label>
          <label>Bunch number<input onChange={(event) => update("bunchNumber", event.target.value)} value={workflow.bunchNumber} /></label>
          <label>Patel Infra category<input onChange={(event) => update("category", event.target.value)} placeholder="For example: Lease / Purchase" value={workflow.category} /></label>
          <label>Consent state<select onChange={(event) => update("consentStatus", event.target.value as ConsentStatus)} value={workflow.consentStatus}>{consentOptions.map((status) => <option key={status} value={status}>{consentLabel[status]}</option>)}</select></label>
          <label>Consent received date<input disabled={workflow.consentStatus !== "received"} onChange={(event) => update("consentDate", event.target.value)} type="date" value={workflow.consentDate} /></label>
          <label>Acquisition stage<select onChange={(event) => update("acquisitionStage", event.target.value as AcquisitionStage)} value={workflow.acquisitionStage}>{stageOptions.map((stage) => <option key={stage} value={stage}>{stageLabel[stage]}</option>)}</select></label>
          <label>Target date<input onChange={(event) => update("targetDate", event.target.value)} type="date" value={workflow.targetDate} /></label>
          <label className="field-full">Legal / operational remarks<textarea onChange={(event) => update("legalRemarks", event.target.value)} placeholder="Add review findings, missing papers or exception details…" rows={5} value={workflow.legalRemarks} /></label>
        </div>
      </fieldset>
      <div className="form-footer"><span>Required operational fields can be expanded after the Patel Infra import is reconciled.</span><button className="button button-primary" disabled={!isWritable || saving} type="submit">{saving ? "Saving…" : "Save workflow update"}</button></div>
    </form>
  </div>;
}

function Documents({
  rows,
  selectedParcel,
  documentType,
  uploadFile,
  isWritable,
  uploading,
  onSelect,
  onDocumentType,
  onFile,
  onSubmit,
  canConnectDrive,
  connectingDrive,
  driveConnected,
  onConnectDrive
}: {
  rows: ParcelSummary[];
  selectedParcel: ParcelSummary | null;
  documentType: string;
  uploadFile: File | null;
  isWritable: boolean;
  uploading: boolean;
  onSelect: (parcelId: string) => void;
  onDocumentType: (value: string) => void;
  onFile: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  canConnectDrive: boolean;
  connectingDrive: boolean;
  driveConnected: boolean;
  onConnectDrive: () => void;
}) {
  return <div className="documents-layout">
    <section className="card document-info"><div className="eyebrow">GOOGLE DRIVE INTEGRATION</div><h2>Protected survey documents</h2><p>Each upload is routed by the server to the correct village and survey-number folder. Staff never paste a Google Drive URL manually.</p><div className="security-list"><div><span>1</span><p>Server verifies the signed-in role and the selected survey.</p></div><div><span>2</span><p>Server creates or reuses the parcel folder below the configured Drive root.</p></div><div><span>3</span><p>Only the Drive file ID and metadata are recorded in Supabase.</p></div></div>{driveConnected && <p className="small-note"><strong>✓ Google Drive is connected.</strong> Reconnect only to switch the Drive account.</p>}<button className="button button-secondary button-wide" disabled={!canConnectDrive || connectingDrive} onClick={onConnectDrive} type="button">{connectingDrive ? "Opening Google…" : driveConnected ? "Reconnect personal Google Drive" : "Connect personal Google Drive"}</button><p className="small-note">Administrator only. Files are not made public or shared as “anyone with the link”.</p></section>
    <form className="card upload-card" onSubmit={onSubmit}>
      <div className="card-heading"><div><div className="eyebrow">UPLOAD DOCUMENT</div><h2>Attach a document to a survey</h2><p>{selectedParcel ? `${selectedParcel.village_name} / Survey ${selectedParcel.survey_number}` : "Choose a survey"}</p></div>{!isWritable && <span className="lock-badge">Preview locked</span>}</div>
      <fieldset disabled={!isWritable || uploading}>
        <label>Survey number<select onChange={(event) => onSelect(event.target.value)} value={selectedParcel?.id ?? ""}>{rows.map((row) => <option key={row.id} value={row.id}>{row.village_name} — {row.survey_number}</option>)}</select></label>
        <label>Document type<select onChange={(event) => onDocumentType(event.target.value)} value={documentType}><option value="current_712">Current 7/12</option><option value="nondh_6">Nondh No. 6 / mutation entry</option><option value="aadhaar">Aadhaar</option><option value="pan">PAN</option><option value="bank_details">Bank details</option><option value="consent_letter">Consent letter</option><option value="old_712">Old 7/12</option><option value="old_nondh_6">Old Nondh No. 6</option></select></label>
        <label className="file-field"><span>File</span><input accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onChange={(event) => onFile(event.target.files?.[0] ?? null)} type="file" /><small>{uploadFile ? `${uploadFile.name} · ${(uploadFile.size / 1024 / 1024).toFixed(2)} MB` : "PDF, JPG, PNG, DOCX or XLSX — up to 15 MB"}</small></label>
      </fieldset>
      <div className="form-footer"><span>Upload is accepted only after both browser and server validation.</span><button className="button button-primary" disabled={!isWritable || uploading || !uploadFile} type="submit">{uploading ? "Uploading securely…" : "Upload to survey folder"}</button></div>
    </form>
  </div>;
}

function Reports({
  rows,
  metrics,
  search,
  villages,
  villageFilter,
  consentFilter,
  stageFilter,
  onSearch,
  onVillage,
  onConsent,
  onStage,
  onDownload
}: {
  rows: ParcelSummary[];
  metrics: DashboardMetrics;
  search: string;
  villages: string[];
  villageFilter: string;
  consentFilter: "all" | ConsentStatus;
  stageFilter: "all" | AcquisitionStage;
  onSearch: (value: string) => void;
  onVillage: (value: string) => void;
  onConsent: (value: "all" | ConsentStatus) => void;
  onStage: (value: "all" | AcquisitionStage) => void;
  onDownload: () => void;
}) {
  const received = rows.filter((row) => row.consent_status === "received").length;
  const stages = stageOptions.map((stage) => ({ stage, count: rows.filter((row) => row.acquisition_stage === stage).length })).filter((item) => item.count > 0);
  return <div className="reports-layout">
    <section className="card report-header"><div><div className="eyebrow">FILTERED REPORTING</div><h2>Build an operational report from the current filter</h2><p>Use the same filters as the register, then export a clean Excel-compatible CSV. Future scheduled PDF and MIS reports can use the same reporting views.</p></div><button className="button button-primary" onClick={onDownload} type="button">Download CSV</button></section>
    <FilterBar {...{ search, villages, villageFilter, consentFilter, stageFilter, onSearch, onVillage, onConsent, onStage }} />
    <section className="report-metrics"><MetricCard label="Filtered records" value={String(rows.length)} detail={`${metrics.totalParcels} total records`} accent="blue" /><MetricCard label="Consent received" value={String(received)} detail="Within current filter" accent="green" /><MetricCard label="No documents" value={String(rows.filter((row) => row.document_count === 0).length)} detail="Document exception report" accent="amber" /></section>
    <section className="card report-breakdown"><div className="card-heading"><div><div className="eyebrow">WORKFLOW BREAKDOWN</div><h3>Acquisition stages in this report</h3></div></div><div className="stage-breakdown">{stages.length ? stages.map(({ stage, count }) => <div key={stage}><span>{stageLabel[stage]}</span><strong>{count}</strong><i style={{ width: `${rows.length ? Math.round((count / rows.length) * 100) : 0}%` }} /></div>) : <div className="empty-state"><strong>No stage records match.</strong></div>}</div></section>
    <section className="card report-table"><div className="card-heading"><div><div className="eyebrow">REPORT PREVIEW</div><h3>{rows.length} filtered surveys</h3></div><span className="muted">CSV export contains the same rows</span></div><ParcelTable rows={rows.slice(0, 100)} onChoose={() => undefined} /></section>
  </div>;
}

function SurveyMap({
  mapRef,
  isLiveData,
  mapSelection,
  onLoad,
  onGoRegistry
}: {
  mapRef: React.RefObject<HTMLObjectElement | null>;
  isLiveData: boolean;
  mapSelection: string | null;
  onLoad: () => void;
  onGoRegistry: () => void;
}) {
  return <div className="map-layout"><section className="card map-intro"><div><div className="eyebrow">CAD-DERIVED MAP</div><h2>Survey consent map</h2><p>{isLiveData ? "Map color is driven from the imported consent record for each reviewed CAD feature." : "This is a reviewed CAD preview. It currently shows only Bhavanipar consent candidates from the source workbook; remaining village bindings need review."}</p></div><button className="button button-secondary" onClick={onGoRegistry} type="button">Open matching register</button></section><section className="map-legend"><span><i className="swatch-green" /> Consent received</span><span><i className="swatch-amber" /> Pending</span><span><i className="swatch-grey" /> Not ready / unconfirmed</span><span><i className="swatch-red" /> Blocked / rejected</span></section><section className="card map-card"><object aria-label="Interactive combined village survey map" className="survey-map" data="./maps/combined-villages-interactive.svg" onLoad={onLoad} ref={mapRef} type="image/svg+xml"><p>Your browser could not render the survey SVG. Open the map asset directly.</p></object></section><section className="card map-footer"><div><strong>Map feature {mapSelection ?? "not selected"}</strong><p>Select a visible parcel boundary to inspect its CAD feature key. The final import creates explicit parcel-to-shape links; unmatched or ambiguous CAD features stay grey.</p></div><span className="map-proof">866 labelled CAD shapes · review required for cross-village bindings</span></section></div>;
}

export default App;
