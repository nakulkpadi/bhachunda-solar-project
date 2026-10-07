import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  authCallbackType,
  consentLabel,
  downloadPatelReport,
  isSupabaseConfigured,
  linkExistingDriveFile,
  loadGoogleDriveConnectionStatus,
  loadMapFeatureDefinitions,
  loadMapFeatureLinks,
  loadMapStatuses,
  loadMyProfile,
  loadParcelDetail,
  loadParcels,
  recordConsent,
  saveOwnerDetails,
  saveParcelWorkflow,
  signOut,
  startGoogleDriveConnection,
  supabase,
  uploadDriveDocument
} from "./api";
import { AccessLanding } from "./AccessLanding";
import { UserManagement } from "./UserManagement";
import { SurveyComments } from "./SurveyComments";
import { csvValue } from "./csv-export";
import { attachMapNavigation, zoomMapView } from "./map-interactions";
import { demoParcels } from "./demo";
import { ConsentEntry } from "./ConsentEntry";
import { DriveFolderSetup } from "./DriveFolderSetup";
import { SurveyDocumentPanel, type ConsentWorkspaceActions } from "./ConsentDocuments";
import { FullSurveyMap, type LiveMapSelection } from "./FullSurveyMap";
import { SurveyDetails } from "./SurveyDetails";
import { formatSurveyCount, Icon, SurveyPicker, type IconName } from "./ui";
import type {
  AcquisitionStage,
  ConsentStatus,
  CurrentProfile,
  DashboardMetrics,
  MapFeatureDefinition,
  MapFeatureLink,
  MapStatus,
  ParcelDetail,
  OwnerDetailsInput,
  ParcelSummary,
  ParcelWorkflowInput
} from "./types";

type ViewId = "dashboard" | "registry" | "details" | "consent" | "entry" | "documents" | "reports" | "map" | "users";
type Notice = { kind: "success" | "error" | "info"; text: string } | null;

const viewTitles: Record<ViewId, string> = {
  dashboard: "Overview",
  registry: "Land register",
  details: "Survey details",
  consent: "Consent entry",
  entry: "Workflow entry",
  documents: "Documents",
  reports: "Reports",
  map: "Survey map",
  users: "Users & access"
};

const navItems: Array<{ id: ViewId; icon: IconName; label: string }> = [
  { id: "dashboard", icon: "overview", label: "Overview" },
  { id: "registry", icon: "register", label: "Land register" },
  { id: "map", icon: "map", label: "Survey map" },
  { id: "consent", icon: "entry", label: "Entries" },
  { id: "reports", icon: "reports", label: "Reports" }
];

const entryViews: Array<{ id: ViewId; label: string }> = [
  { id: "consent", label: "Consent" },
  { id: "entry", label: "Workflow" },
  { id: "documents", label: "Documents" }
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

function mapColors(status: ConsentStatus): { fill: string; stroke: string } {
  if (status === "received") return { fill: "#6e9d7a", stroke: "#365743" };
  if (status === "pending") return { fill: "#d6ad63", stroke: "#8d6328" };
  if (status === "blocked" || status === "rejected") return { fill: "#c38784", stroke: "#803d3a" };
  return { fill: "#d7ddd7", stroke: "#8b948c" };
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
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!isSupabaseConfigured);
  const [parcels, setParcels] = useState<ParcelSummary[]>([]);
  const [mapStatuses, setMapStatuses] = useState<MapStatus[]>([]);
  const [mapDefinitions, setMapDefinitions] = useState<MapFeatureDefinition[]>([]);
  const [mapLinks, setMapLinks] = useState<MapFeatureLink[]>([]);
  const [isLiveData, setIsLiveData] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState("");
  const [villageFilter, setVillageFilter] = useState("all");
  const [consentFilter, setConsentFilter] = useState<"all" | ConsentStatus>("all");
  const [stageFilter, setStageFilter] = useState<"all" | AcquisitionStage>("all");
  const [selectedParcelId, setSelectedParcelId] = useState(demoParcels[0].id);
  const [workflow, setWorkflow] = useState<ParcelWorkflowInput>(() => createWorkflow(demoParcels[0]));
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [surveyDetail, setSurveyDetail] = useState<ParcelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [parcelChanges, setParcelChanges] = useState(0);
  const parcelChangeCount = useRef(0);
  const activeParcelId = useRef<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [mapSelection, setMapSelection] = useState<LiveMapSelection>(null);
  const mapRef = useRef<HTMLObjectElement | null>(null);

  const refreshSequence = useRef(0);
  const authIdentity = useRef<string | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [passwordSetup, setPasswordSetup] = useState(["invite", "recovery"].includes(authCallbackType));
  const isApproved = Boolean(profile?.is_active && profile.approval_status === "approved");
  const isAdmin = profile?.role === "admin" && isApproved;
  const canEdit = Boolean(isApproved && ["admin", "editor"].includes(profile?.role || ""));

  useEffect(() => { window.scrollTo({ top: 0 }); }, [activeView]);

  const refreshLiveData = useCallback(async () => {
    if (!supabase) return;
    const attempt = ++refreshSequence.current;
    setLoading(true);
    try {
      const nextProfile = await loadMyProfile();
      if (attempt !== refreshSequence.current) return;
      setProfile(nextProfile);
      setProfileChecked(true);
      if (!nextProfile?.is_active || nextProfile.approval_status !== "approved") {
        setParcels([]); setMapStatuses([]); setMapDefinitions([]); setMapLinks([]); setSurveyDetail(null); setIsLiveData(false);
        return;
      }
      const [liveParcels, liveStatuses, definitions, links, connected] = await Promise.all([
        loadParcels(),
        loadMapStatuses(),
        loadMapFeatureDefinitions(),
        loadMapFeatureLinks(),
        loadGoogleDriveConnectionStatus().catch(() => false)
      ]);
      if (attempt !== refreshSequence.current) return;
      setParcels(liveParcels);
      setMapStatuses(liveStatuses);
      setMapDefinitions(definitions);
      setMapLinks(links);
      setProfile(nextProfile);
      setDriveConnected(connected);
      setIsLiveData(true);
    } catch (error) {
      if (attempt !== refreshSequence.current) return;
      setIsLiveData(false);
      setParcels([]);
      setMapDefinitions([]);
      setMapLinks([]);
      setProfileChecked(true);
      setNotice({
        kind: "error",
        text: error instanceof Error ? `Live database is not ready: ${error.message}` : "Live database is not ready yet."
      });
    } finally {
      if (attempt === refreshSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (authIdentity.current !== (nextSession?.user.id || null)) {
        authIdentity.current = nextSession?.user.id || null; refreshSequence.current += 1;
        setProfile(null); setProfileChecked(false); setParcels([]); setMapStatuses([]); setMapDefinitions([]); setMapLinks([]); setSurveyDetail(null); setIsLiveData(false); setLoading(false);
      }
      setSession(nextSession); setSessionChecked(true);
      if (event === "PASSWORD_RECOVERY") setPasswordSetup(true);
      if (!nextSession) { setPasswordSetup(false); setDriveConnected(false); setConnectingDrive(false); }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void refreshLiveData();
  }, [session?.user.id, refreshLiveData]);

  useEffect(() => {
    if (!session) return;
    const check = async () => {
      try {
        const next = await loadMyProfile();
        if (next?.role !== profile?.role || next?.approval_status !== profile?.approval_status || next?.is_active !== profile?.is_active) await refreshLiveData();
      } catch { setProfile(null); setIsLiveData(false); setParcels([]); setSurveyDetail(null); }
    };
    const timer = window.setInterval(() => { if (!document.hidden) void check(); }, 30000);
    const visible = () => { if (!document.hidden) void check(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [session?.user.id, profile?.role, profile?.approval_status, profile?.is_active, refreshLiveData]);

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
  activeParcelId.current = selectedParcel?.id ?? null;
  const activeDetail = surveyDetail?.id === selectedParcel?.id ? surveyDetail : null;
  const selectParcel = (parcelId: string) => { if (parcelChangeCount.current === 0) setSelectedParcelId(parcelId); };

  useEffect(() => {
    if (selectedParcel && selectedParcel.id !== selectedParcelId) setSelectedParcelId(selectedParcel.id);
  }, [selectedParcel, selectedParcelId]);

  useEffect(() => {
    if (selectedParcel) setWorkflow(createWorkflow(selectedParcel));
  }, [selectedParcel?.id]);

  useEffect(() => {
    if (!session || !isLiveData || !selectedParcel) {
      setSurveyDetail(null);
      return;
    }
    let cancelled = false;
    setSurveyDetail(null);
    setDetailLoading(true);
    void loadParcelDetail(selectedParcel.id)
      .then((detail) => {
        if (!cancelled) setSurveyDetail(detail);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load full survey details." });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [isLiveData, selectedParcel?.id, session]);

  useEffect(() => {
    if (!surveyDetail || surveyDetail.id !== selectedParcel?.id) return;
    setWorkflow((current) => ({
      ...current,
      consentDate: surveyDetail.consent?.received_on ?? current.consentDate,
      category: surveyDetail.acquisition?.category ?? "",
      targetDate: surveyDetail.acquisition?.target_date ?? "",
      legalRemarks: surveyDetail.legal?.legal_remarks ?? ""
    }));
  }, [surveyDetail, selectedParcel?.id]);

  const chooseParcel = (parcel: ParcelSummary, nextView: ViewId = "details") => {
    if (parcelChangeCount.current > 0) return;
    setSelectedParcelId(parcel.id);
    setActiveView(nextView);
  };

  const saveWorkflow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !isLiveData) {
      setNotice({ kind: "info", text: "Your account cannot update workflow records." });
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

  const changeSurveyRecord = async (parcelId: string, operation: () => Promise<void>): Promise<void> => {
    if (!canEdit || !isLiveData || activeParcelId.current !== parcelId) throw new Error("Select a survey with an approved Editor or Administrator account first.");
    parcelChangeCount.current += 1;
    setParcelChanges(parcelChangeCount.current);
    try {
      await operation();
      const refreshed = await loadParcelDetail(parcelId);
      if (activeParcelId.current === parcelId) setSurveyDetail(refreshed);
    } finally {
      parcelChangeCount.current -= 1;
      setParcelChanges(parcelChangeCount.current);
    }
  };

  const saveSelectedOwner = async (parcelId: string, ownerId: string, details: OwnerDetailsInput): Promise<void> => {
    await changeSurveyRecord(parcelId, () => saveOwnerDetails(parcelId, ownerId, details));
  };

  const uploadSurveyFile = async (parcelId: string, code: string, file: File, ownerId?: string): Promise<void> => {
    if (!driveConnected) throw new Error("Connect Google Drive before uploading a file.");
    await changeSurveyRecord(parcelId, async () => {
      await uploadDriveDocument(parcelId, code, file, ownerId);
      await refreshLiveData();
    });
    setNotice({ kind: "success", text: "Document uploaded to this survey’s private Drive folder and linked to its record." });
  };

  const connectPersonalDrive = async () => {
    if (!isAdmin || !isLiveData) {
      setNotice({ kind: "info", text: "Only the administrator can connect personal Google Drive." });
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

  const saveConsentEntry = async (input: { status: ConsentStatus; receivedOn: string; reference: string; remarks: string }): Promise<void> => {
    if (!selectedParcel || !canEdit || !isLiveData) throw new Error("An approved Editor or Administrator account is required to record consent.");
    const remarks = [input.reference.trim() ? `Reference: ${input.reference.trim()}` : "", input.remarks.trim()].filter(Boolean).join("\n");
    const parcelId = selectedParcel.id;
    await changeSurveyRecord(parcelId, async () => {
      await recordConsent({
        parcelId,
        status: input.status,
        receivedOn: input.status === "received" ? input.receivedOn : undefined,
        remarks
      });
      await refreshLiveData();
    });
    setNotice({
      kind: "success",
      text: input.status === "received"
        ? "Consent received was recorded. The linked map shape is now green."
        : `Consent status was saved as ${consentLabel[input.status]}.`
    });
  };

  const consentWorkspace: ConsentWorkspaceActions = {
    busy: parcelChanges > 0,
    driveConnected,
    connectingDrive,
    onConnectDrive: connectPersonalDrive,
    onUpload: uploadSurveyFile,
    onSaveOwner: saveSelectedOwner,
    onLinkExisting: async (parcelId, code, fileId, ownerId, folderPath) => {
      await changeSurveyRecord(parcelId, async () => {
        await linkExistingDriveFile(parcelId, code, fileId, ownerId, folderPath);
        await refreshLiveData();
      });
      setNotice({ kind: "success", text: "Existing Drive file linked to the selected record. Consent status stays as recorded." });
    }
  };

  const generatePatelReport = async () => {
    if (!isAdmin) {
      setNotice({ kind: "info", text: "The Patel Infra report contains restricted owner fields and is available only to the administrator." });
      return;
    }
    setGeneratingReport(true);
    try {
      const report = await downloadPatelReport({ village: villageFilter, consent: consentFilter, stage: stageFilter });
      const url = URL.createObjectURL(report.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = report.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ kind: "success", text: "Patel Infra Excel report generated from live data." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not generate the report." });
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleMapFeatureClick = useCallback((featureKey: string) => {
    const links = mapLinks.filter((link) => link.feature_key === featureKey);
    setMapSelection({ featureKey, links });
    if (links.length === 1) {
      const linkedParcel = parcels.find((parcel) => parcel.id === links[0].parcel_id);
      if (linkedParcel) chooseParcel(linkedParcel, "details");
    }
  }, [mapLinks, parcels]);

  const applyMapStyles = useCallback(() => {
    const svgDocument = mapRef.current?.contentDocument;
    if (!svgDocument) return;
    const root = svgDocument.documentElement;
    attachMapNavigation(root as unknown as SVGSVGElement);
    if (!root.dataset.cadViewBox && root.getAttribute("viewBox")) root.dataset.cadViewBox = root.getAttribute("viewBox") ?? "";
    // The CAD labels sit above their boundaries. Let a click pass through the
    // text to the linked survey boundary below it.
    svgDocument.querySelectorAll("text").forEach((label) => { label.style.pointerEvents = "none"; });
    // Keep the CAD boundary lines readable at every zoom level. Clearing the
    // base fills also removes live consent colours when a session ends.
    const cadBoundaries = Array.from(svgDocument.querySelectorAll<SVGPathElement>("path"))
      .filter((element) => /[Zz]\s*$/.test(element.getAttribute("d") ?? ""));
    cadBoundaries.forEach((element) => {
      element.style.fill = "none";
      element.style.stroke = "#8b9789";
      element.style.strokeWidth = "0.6px";
      element.style.vectorEffect = "non-scaling-stroke";
      element.style.cursor = "default";
      element.removeAttribute("tabindex");
      element.removeAttribute("role");
      element.removeAttribute("aria-label");
      element.onclick = null;
      element.onkeydown = null;
    });
    const statusByFeature = new Map(mapStatuses.map((item) => [item.feature_key, item.status]));
    mapDefinitions.forEach((feature) => {
      if (!feature.svg_element_id) return;
      const element = svgDocument.getElementById(feature.svg_element_id) as SVGElement | null;
      if (!element) return;
      const status = statusByFeature.get(feature.feature_key) ?? "not_ready";
      const colors = mapColors(status);
      element.style.fill = colors.fill;
      element.style.fillOpacity = status === "not_ready" ? "0.52" : "0.84";
      element.style.stroke = colors.stroke;
      element.style.strokeWidth = "1.15px";
      element.style.cursor = "pointer";
      element.style.pointerEvents = "all";
      element.setAttribute("tabindex", "0");
      element.setAttribute("role", "button");
      const surveyLabels = mapLinks.filter((link) => link.feature_key === feature.feature_key)
        .map((link) => `${link.village_name} survey ${link.survey_number}`);
      element.setAttribute("aria-label", `${surveyLabels.join(" or ") || "Unmatched survey boundary"}. ${statusByFeature.has(feature.feature_key) ? consentLabel[status] : "Consent unconfirmed"}.`);
      element.onclick = () => handleMapFeatureClick(feature.feature_key);
      element.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleMapFeatureClick(feature.feature_key);
        }
      };
    });

    // The original DWG viewBox also contains construction marks and empty CAD
    // canvas. Fit registered boundaries when signed in, and all closed CAD
    // boundaries in the public preview. The untouched drawing remains in SVG.
    const fitSource = mapDefinitions.length ? "registered" : "drawing";
    if (root.dataset.fitSource !== fitSource) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const fitElements = mapDefinitions.length
        ? mapDefinitions.map((feature) => feature.svg_element_id ? svgDocument.getElementById(feature.svg_element_id) as SVGGraphicsElement | null : null)
        : cadBoundaries;
      fitElements.forEach((element) => {
        if (!element) return;
        try {
          const box = element.getBBox();
          if (box.width <= 0 || box.height <= 0) return;
          minX = Math.min(minX, box.x);
          minY = Math.min(minY, box.y);
          maxX = Math.max(maxX, box.x + box.width);
          maxY = Math.max(maxY, box.y + box.height);
        } catch {
          // A malformed CAD primitive must not stop the rest of the map.
        }
      });
      if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
        const paddingX = Math.max(24, (maxX - minX) * 0.07);
        const paddingY = Math.max(24, (maxY - minY) * 0.07);
        const fitViewBox = [minX - paddingX, minY - paddingY, maxX - minX + paddingX * 2, maxY - minY + paddingY * 2].join(" ");
        root.dataset.fitViewBox = fitViewBox;
        root.dataset.fitSource = fitSource;
        root.setAttribute("viewBox", fitViewBox);
      }
    }
  }, [handleMapFeatureClick, mapDefinitions, mapStatuses, mapLinks]);

  useEffect(() => {
    applyMapStyles();
  }, [applyMapStyles]);

  const zoomMap = useCallback((factor: number) => {
    const root = mapRef.current?.contentDocument?.documentElement;
    if (root) zoomMapView(root as unknown as SVGSVGElement, factor);
  }, []);

  const resetMap = useCallback(() => {
    const root = mapRef.current?.contentDocument?.documentElement;
    const initial = root?.dataset.fitViewBox ?? root?.dataset.cadViewBox;
    if (root && initial) root.setAttribute("viewBox", initial);
  }, []);

  const reportRows = useMemo(() => {
    return parcels.filter((row) =>
      (villageFilter === "all" || row.village_name === villageFilter) &&
      (consentFilter === "all" || row.consent_status === consentFilter) &&
      (stageFilter === "all" || row.acquisition_stage === stageFilter)
    );
  }, [parcels, villageFilter, consentFilter, stageFilter]);

  if (!session || !isApproved || passwordSetup) {
    return <AccessLanding profile={profile} email={session?.user.email} loading={!sessionChecked || Boolean(session && !profileChecked)} passwordSetup={passwordSetup && Boolean(session)} onPasswordDone={() => { setPasswordSetup(false); void refreshLiveData(); }} onRefresh={() => void refreshLiveData()} />;
  }

  const consentPercent = metrics.totalParcels ? Math.round((metrics.receivedCount / metrics.totalParcels) * 100) : 0;
  const liveLabel = isLiveData ? "Project records" : "Loading records";
  const inEntryWorkspace = entryViews.some((item) => item.id === activeView);
  const activeNav = activeView === "details" ? "registry" : inEntryWorkspace ? "consent" : activeView;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <svg className="brand-mark" aria-hidden="true" viewBox="0 0 36 36"><path d="M3 5h14v12H3zM20 5h13v12H20zM3 20h14v12H3z" fill="currentColor" /><path d="m20 20 13-2v14H20z" fill="#aa7942" /></svg>
          <div className="brand-name"><strong>Bhachunda</strong><span>Solar project</span></div>
        </div>
        <div className="sidebar-project"><span className="eyebrow">Land acquisition</span><span>Kutch, Gujarat · 3 villages</span></div>
        <nav className="nav-list" aria-label="Project sections">
          {[...navItems, ...(isAdmin ? [{ id: "users" as ViewId, icon: "users" as IconName, label: "Users & access" }] : [])].map((item) => (
            <button
              aria-current={activeNav === item.id ? "page" : undefined}
              className={`nav-item ${activeNav === item.id ? "is-active" : ""}`}
              key={item.id}
              title={item.label}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note"><span className="eyebrow">Project villages</span><span>Bhavanipar</span><span>Bitta</span><span>Vandh Timbo</span></div>
        <div className="sidebar-footer">
          <span className="mode-dot" />
          <span>{liveLabel}</span>
        </div>
      </aside>

      <main className="main-content" id="workspace" tabIndex={-1}>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Bhachunda solar <span>/</span> {inEntryWorkspace ? "Entries" : activeView === "details" ? "Land register" : "Project workspace"}</div>
            <h1>{viewTitles[activeView]}</h1>
          </div>
          <div className="topbar-actions">
            {loading && <span className="muted">Refreshing…</span>}
            <span className="account-chip" title={session.user.email ?? "Signed-in user"}>{profile?.role === "admin" ? "Administrator" : profile?.role === "editor" ? "Editor" : profile?.role === "commenter" ? "Commenter" : "Viewer"}<small>{profile?.full_name || session.user.email || "Signed in"}</small></span>
            <button className="button button-secondary" onClick={() => void signOut()} type="button">Sign out</button>
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
            <span className="preview-label">Project records</span><span>Project records are loading or temporarily unavailable.</span>
          </section>
        )}

        <section className="page-body">
          {isAdmin && isLiveData && <DriveFolderSetup connected={driveConnected} onConnectDrive={() => void connectPersonalDrive()} selectedParcelId={selectedParcel?.id} selectedLabel={selectedParcel ? `${selectedParcel.village_name} · Survey ${selectedParcel.survey_number}` : undefined} visible={activeView === "documents"} />}
          {activeView === "details" && <button className="back-link" onClick={() => setActiveView("registry")} type="button"><Icon name="back" /> Back to land register</button>}
          {inEntryWorkspace && <nav className="workspace-tabs" aria-label="Entry type">{entryViews.map((item) => <button aria-current={activeView === item.id ? "page" : undefined} className={activeView === item.id ? "is-active" : ""} key={item.id} onClick={() => setActiveView(item.id)} type="button">{item.label}</button>)}</nav>}
          {activeView === "users" && isAdmin && <UserManagement />}
          {activeView === "dashboard" && (
            <Dashboard
              metrics={metrics}
              parcels={parcels}
              consentPercent={consentPercent}
              onChooseParcel={chooseParcel}
              onShowRegistry={() => setActiveView("registry")}
              onShowVillage={(village) => { setSearch(""); setConsentFilter("all"); setStageFilter("all"); setVillageFilter(village); setActiveView("registry"); }}
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
          {activeView === "details" && (
            <SurveyDetails
              rows={parcels}
              selectedParcel={selectedParcel}
              detail={activeDetail}
              loading={detailLoading}
              isAdmin={canEdit}
              onSelect={selectParcel}
              onGoConsent={() => setActiveView("consent")}
              onGoDocuments={() => setActiveView("documents")}
              workspace={consentWorkspace}
            />
          )}
          {activeView === "consent" && (
            <ConsentEntry
              rows={parcels}
              selectedParcel={selectedParcel}
              detail={activeDetail}
              loading={detailLoading}
              isAdmin={canEdit}
              onSelect={selectParcel}
              onSave={saveConsentEntry}
              onGoDetails={() => setActiveView("details")}
              workspace={consentWorkspace}
            />
          )}
          {activeView === "entry" && (
            <WorkflowEntry
              rows={parcels}
              selectedParcel={selectedParcel}
              workflow={workflow}
              isWritable={Boolean(canEdit && isLiveData && !detailLoading)}
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
              detail={activeDetail}
              loading={detailLoading}
              isAdmin={canEdit}
              onSelect={selectParcel}
              workspace={consentWorkspace}
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
              onChooseParcel={chooseParcel}
              canGeneratePatel={isAdmin}
              generating={generatingReport}
              onGeneratePatel={generatePatelReport}
            />
          )}
          {activeView === "map" && (
            <FullSurveyMap
              mapRef={mapRef}
              isLiveData={isLiveData}
              featureCount={mapDefinitions.length}
              selection={mapSelection}
              onLoad={applyMapStyles}
              onZoomIn={() => zoomMap(0.72)}
              onZoomOut={() => zoomMap(1.38)}
              onReset={resetMap}
              onOpenParcel={(parcelId) => {
                const parcel = parcels.find((item) => item.id === parcelId);
                if (parcel) chooseParcel(parcel, "details");
              }}
              onGoRegistry={() => setActiveView("registry")}
            />
          )}
          {["details", "consent", "documents"].includes(activeView) && activeDetail && <SurveyComments key={activeDetail.id} parcelId={activeDetail.id} userId={session.user.id} role={profile?.role || "viewer"} />}
        </section>
      </main>


    </div>
  );
}

function Dashboard({
  metrics,
  parcels,
  consentPercent,
  onChooseParcel,
  onShowRegistry,
  onShowVillage
}: {
  metrics: DashboardMetrics;
  parcels: ParcelSummary[];
  consentPercent: number;
  onChooseParcel: (parcel: ParcelSummary, view?: ViewId) => void;
  onShowRegistry: () => void;
  onShowVillage: (village: string) => void;
}) {
  const latestRows = parcels.slice(0, 5);
  const totalAcres = metrics.villages.reduce((sum, village) => sum + village.acreage, 0);
  return (
    <div className="dashboard-grid">
      <section className="page-intro">
        <div>
          <div className="eyebrow">Project position</div>
          <h2>Land acquisition</h2>
          <p>Bhavanipar, Bitta and Vandh Timbo</p>
        </div>
        <button className="button button-primary" onClick={onShowRegistry} type="button">Open land register <Icon name="arrow" /></button>
      </section>

      <section className="metric-grid">
        <MetricCard label="Total surveys" value={metrics.totalParcels.toLocaleString("en-IN")} detail={`${formatAcres(totalAcres)} tracked`} accent="blue" />
        <MetricCard label="Consent received" value={metrics.receivedCount.toLocaleString("en-IN")} detail={`${consentPercent}% of records`} accent="green" />
        <MetricCard label="Consent outstanding" value={metrics.pendingCount.toLocaleString("en-IN")} detail="Awaiting received consent" accent="amber" />
        <MetricCard label="Without documents" value={metrics.documentGapCount.toLocaleString("en-IN")} detail="Surveys with no file attached" accent="slate" />
      </section>

      <section className="card consent-panel">
        <div className="card-heading"><div><div className="eyebrow">Village summary</div><h3>Consent position</h3></div><span className="subtle-label">{consentPercent}% received</span></div>
        <div className="table-scroll"><table className="village-table"><thead><tr><th>Village</th><th>Surveys</th><th>Received</th><th>Progress</th></tr></thead><tbody>
          {metrics.villages.map((village) => {
            const percentage = village.total ? Math.round((village.received / village.total) * 100) : 0;
            return <tr key={village.village}>
              <td><button className="village-link" onClick={() => onShowVillage(village.village)} type="button">{village.village}<Icon name="arrow" /></button><small>{formatAcres(village.acreage)}</small></td>
              <td>{village.total}</td><td>{village.received}</td>
              <td><div className="village-progress"><div className="village-bar"><span style={{ width: `${percentage}%` }} /></div><span>{percentage}%</span></div></td>
            </tr>;
          })}
        </tbody></table></div>
        <p className="small-note"><span className="legend-swatch swatch-green" /> Green indicates consent received.</p>
      </section>

      <section className="card action-panel">
        <div className="card-heading"><div><div className="eyebrow">Follow-up</div><h3>Needs attention</h3></div></div>
        <div className="attention-row"><span>Consent outstanding</span><strong>{metrics.pendingCount}</strong></div>
        <div className="attention-row"><span>Without documents</span><strong>{metrics.documentGapCount}</strong></div>
        <p className="small-note">Open a survey in the land register to review its details, record consent or attach a document.</p>
      </section>

      <section className="card registry-preview">
        <div className="card-heading"><div><div className="eyebrow">Land register</div><h3>Survey records</h3></div><button className="text-button" onClick={onShowRegistry} type="button">View all {metrics.totalParcels} <Icon name="arrow" /></button></div>
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
  onClear,
  showSearch = true
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
  showSearch?: boolean;
}) {
  const [showMore, setShowMore] = useState(stageFilter !== "all");
  const extraFilterId = useId();
  const hasFilters = Boolean((showSearch && search) || villageFilter !== "all" || consentFilter !== "all" || stageFilter !== "all");
  const clear = () => {
    if (onClear) onClear();
    else { onSearch(""); onVillage("all"); onConsent("all"); onStage("all"); }
  };
  return <div className="filter-bar">
    <div className="filter-main">
      {showSearch && <label className="search-field">Find a survey<div className="search-input"><Icon name="search" /><input aria-label="Search register" onChange={(event) => onSearch(event.target.value)} placeholder="Survey number, old number or Khata" value={search} /></div></label>}
      <label>Village<select aria-label="Filter village" onChange={(event) => onVillage(event.target.value)} value={villageFilter}><option value="all">All villages</option>{villages.map((village) => <option key={village} value={village}>{village}</option>)}</select></label>
      <label>Consent<select aria-label="Filter consent status" onChange={(event) => onConsent(event.target.value as "all" | ConsentStatus)} value={consentFilter}><option value="all">All statuses</option>{consentOptions.map((status) => <option key={status} value={status}>{consentLabel[status]}</option>)}</select></label>
      <button className={`button button-secondary filter-toggle ${stageFilter !== "all" ? "has-filter" : ""}`} aria-controls={extraFilterId} aria-expanded={showMore} onClick={() => setShowMore(!showMore)} type="button"><Icon name="filter" /> More filters{stageFilter !== "all" && <span className="filter-count">1</span>}</button>
      {hasFilters && <button className="text-button clear-filters" onClick={clear} type="button">Clear</button>}
    </div>
    {showMore && <div className="filter-extra" id={extraFilterId}><label>Workflow stage<select aria-label="Filter workflow stage" onChange={(event) => onStage(event.target.value as "all" | AcquisitionStage)} value={stageFilter}><option value="all">All stages</option>{stageOptions.map((stage) => <option key={stage} value={stage}>{stageLabel[stage]}</option>)}</select></label></div>}
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
    <div className="card-heading"><div><div className="eyebrow">Project records</div><h2>Land register</h2><p>Find a survey and open its full record.</p></div><div className="result-count">{formatSurveyCount(rows.length)}</div></div>
    <FilterBar {...{ search, villages, villageFilter, consentFilter, stageFilter, onSearch, onVillage, onConsent, onStage, onClear }} />
    <ParcelTable rows={rows} onChoose={onChooseParcel} />
  </section>;
}

function ParcelTable({ rows, onChoose, compact = false }: { rows: ParcelSummary[]; onChoose: (parcel: ParcelSummary, view?: ViewId) => void; compact?: boolean }) {
  if (!rows.length) return <div className="empty-state"><strong>No surveys match these filters.</strong><span>Clear one or more filters to see the register again.</span></div>;
  return <div className="table-scroll" tabIndex={0} aria-label="Survey records"><table className={compact ? "parcel-table compact" : "parcel-table"}><thead><tr><th scope="col">Village</th><th scope="col">Survey no.</th><th scope="col">Area</th><th scope="col">Consent</th><th scope="col">Stage</th><th scope="col">Documents</th><th scope="col"><span className="sr-only">Open record</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.village_name}</strong><small>{row.account_number ? `Khata ${row.account_number}` : "Khata —"}</small></td><td><strong className="survey-number">{row.survey_number}</strong><small>{row.old_survey_number ? `Old ${row.old_survey_number}` : "Old no. —"}</small></td><td className="numeric">{formatAcres(row.acreage)}</td><td><span className={statusClass(row.consent_status)}>{consentLabel[row.consent_status]}</span></td><td><span className="stage-pill">{stageLabel[row.acquisition_stage]}</span></td><td><span className="document-tally">{row.verified_document_count}/{row.document_count}<small>verified</small></span></td><td><button className="row-action" aria-label={`Open ${row.village_name} survey ${row.survey_number}`} onClick={() => onChoose(row)} type="button">Open <Icon name="arrow" /></button></td></tr>)}</tbody></table></div>;
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
      <div className="eyebrow">01 / Select record</div><h2>Choose a survey</h2><p>Update the acquisition status for this record.</p>
      <SurveyPicker rows={rows} selectedParcel={selectedParcel} onSelect={onSelect} disabled={saving} />
      <div className="parcel-facts"><div><span>Khata / account</span><strong>{selectedParcel.account_number ?? "—"}</strong></div><div><span>Document count</span><strong>{selectedParcel.verified_document_count}/{selectedParcel.document_count} verified</strong></div><div><span>Current consent</span><strong className={statusClass(selectedParcel.consent_status)}>{consentLabel[selectedParcel.consent_status]}</strong></div></div>
      <button className="text-button" onClick={onGoDocuments} type="button">View survey documents</button>
    </section>
    <form className="card workflow-form" onSubmit={onSubmit}>
      <div className="card-heading"><div><div className="eyebrow">02 / Workflow</div><h2>Acquisition update</h2><p>{selectedParcel.village_name} · Survey {selectedParcel.survey_number}</p></div>{!isWritable && <span className="lock-badge">View access</span>}</div>
      <fieldset disabled={!isWritable || saving}>
        <div className="section-label">Land record</div>
        <div className="form-grid">
          <label>Old survey number<input onChange={(event) => update("oldSurveyNumber", event.target.value)} value={workflow.oldSurveyNumber} /></label>
          <label>Acres<input inputMode="decimal" min="0" onChange={(event) => update("acreage", event.target.value)} type="number" value={workflow.acreage} /></label>
          <label>Bunch number<input onChange={(event) => update("bunchNumber", event.target.value)} value={workflow.bunchNumber} /></label>
          <label>Patel Infra category<input onChange={(event) => update("category", event.target.value)} placeholder="For example: Lease / Purchase" value={workflow.category} /></label>
        </div>
        <div className="section-label form-section-label">Consent and acquisition</div>
        <div className="form-grid">
          <label>Consent state<select onChange={(event) => update("consentStatus", event.target.value as ConsentStatus)} value={workflow.consentStatus}>{consentOptions.map((status) => <option key={status} value={status}>{consentLabel[status]}</option>)}</select></label>
          <label>Consent received date<input disabled={workflow.consentStatus !== "received"} onChange={(event) => update("consentDate", event.target.value)} type="date" value={workflow.consentDate} /></label>
          <label>Acquisition stage<select onChange={(event) => update("acquisitionStage", event.target.value as AcquisitionStage)} value={workflow.acquisitionStage}>{stageOptions.map((stage) => <option key={stage} value={stage}>{stageLabel[stage]}</option>)}</select></label>
        </div>
        <details className="form-disclosure"><summary>Target date and legal notes <span>Optional</span></summary><div className="form-grid">
          <label>Target date<input onChange={(event) => update("targetDate", event.target.value)} type="date" value={workflow.targetDate} /></label>
          <label className="field-full">Legal / operational remarks<textarea onChange={(event) => update("legalRemarks", event.target.value)} placeholder="Review findings or pending documents" rows={4} value={workflow.legalRemarks} /></label>
        </div></details>
      </fieldset>
      <div className="form-footer"><span>{isWritable ? "Changes are recorded against this survey." : "An approved Editor or Administrator can save changes."}</span><button className="button button-primary" disabled={!isWritable || saving} type="submit">{saving ? "Saving…" : "Save workflow"}</button></div>
    </form>
  </div>;
}

function Documents({ rows, selectedParcel, detail, loading, isAdmin, onSelect, workspace }: {
  rows: ParcelSummary[];
  selectedParcel: ParcelSummary | null;
  detail: ParcelDetail | null;
  loading: boolean;
  isAdmin: boolean;
  onSelect: (parcelId: string) => void;
  workspace: ConsentWorkspaceActions;
}) {
  if (!selectedParcel) return <section className="card empty-state"><strong>No survey selected.</strong></section>;
  return <div className="documents-layout">
    <section className="card selection-card"><div className="eyebrow">Select record</div><h2>Choose a survey</h2><p>Files go to its private survey folder.</p><SurveyPicker rows={rows} selectedParcel={selectedParcel} onSelect={onSelect} disabled={workspace.busy} />
      <div className="parcel-facts"><div><span>Documents</span><strong>{selectedParcel.document_count} attached</strong></div><div><span>Verified</span><strong>{selectedParcel.verified_document_count}</strong></div></div>
      <p className="small-note">Choose the owner under KYC when uploading PAN, Aadhaar or bank files.</p>
    </section>
    <section className="card detail-card"><div className="card-heading"><div><div className="eyebrow">Documents</div><h2>Survey documents</h2><p>{selectedParcel.village_name} · Survey {selectedParcel.survey_number}</p></div>{!isAdmin && <span className="lock-badge">View access</span>}</div>
      {loading ? <p role="status">Loading attached documents…</p> : detail ? <SurveyDocumentPanel detail={detail} isAdmin={isAdmin} actions={workspace} /> : <p>Sign in to view attached files.</p>}
    </section>
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
  onDownload,
  onChooseParcel,
  canGeneratePatel,
  generating,
  onGeneratePatel
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
  onChooseParcel: (parcel: ParcelSummary, view?: ViewId) => void;
  canGeneratePatel: boolean;
  generating: boolean;
  onGeneratePatel: () => void;
}) {
  const received = rows.filter((row) => row.consent_status === "received").length;
  const stages = stageOptions.map((stage) => ({ stage, count: rows.filter((row) => row.acquisition_stage === stage).length })).filter((item) => item.count > 0);
  return <div className="reports-layout">
    <section className="page-intro"><div><div className="eyebrow">Project reporting</div><h2>Patel Infra report</h2><p>Select the records to include, then generate your Excel workbook.</p></div></section>
    <section className="card report-builder">
      <FilterBar showSearch={false} {...{ search, villages, villageFilter, consentFilter, stageFilter, onSearch, onVillage, onConsent, onStage }} />
      <div className="report-export"><div><strong>{formatSurveyCount(rows.length)} selected</strong><p>{canGeneratePatel ? "Patel Infra layout · land, consent, legal and owner details" : "Administrator sign-in required for the confidential Excel report."}</p></div><div className="report-actions"><button className="text-button" onClick={onDownload} type="button">Download CSV</button><button className="button button-primary" disabled={!canGeneratePatel || generating || !rows.length} onClick={onGeneratePatel} type="button">{generating ? "Generating…" : "Generate Excel report"}<Icon name="arrow" /></button></div></div>
    </section>
    <section className="report-metrics"><MetricCard label="Filtered records" value={String(rows.length)} detail={`${metrics.totalParcels} total records`} accent="blue" /><MetricCard label="Consent received" value={String(received)} detail="Within current filter" accent="green" /><MetricCard label="No documents" value={String(rows.filter((row) => row.document_count === 0).length)} detail="Document exception report" accent="amber" /></section>
    <details className="card detail-disclosure report-breakdown"><summary><span>Acquisition stage breakdown<small>{stages.length} {stages.length === 1 ? "stage" : "stages"} in this selection</small></span></summary><div className="stage-breakdown">{stages.length ? stages.map(({ stage, count }) => <div key={stage}><span>{stageLabel[stage]}</span><strong>{count}</strong></div>) : <div className="empty-state"><strong>No stage records match.</strong></div>}</div></details>
    <section className="card report-table"><div className="card-heading"><div><div className="eyebrow">Included records</div><h3>Report preview</h3></div><span className="muted">{rows.length > 100 ? `Showing 100 of ${rows.length} surveys` : formatSurveyCount(rows.length)}</span></div><ParcelTable rows={rows.slice(0, 100)} onChoose={onChooseParcel} />{rows.length > 100 && <p className="table-note">The downloaded report includes all {rows.length} selected surveys.</p>}</section>
  </div>;
}

export default App;
