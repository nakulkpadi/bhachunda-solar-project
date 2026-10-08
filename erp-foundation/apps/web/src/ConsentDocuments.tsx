import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listExistingDriveFiles, openDriveDocument, type ExistingDriveFile } from "./api";
import type { OwnerDetailsInput, ParcelDetail, ParcelDocument } from "./types";

export interface ConsentWorkspaceActions {
  busy: boolean;
  driveConnected: boolean;
  connectingDrive: boolean;
  onConnectDrive: () => void;
  onUpload: (parcelId: string, documentType: string, file: File, ownerId?: string) => Promise<void>;
  onSaveOwner: (parcelId: string, ownerId: string, details: OwnerDetailsInput) => Promise<void>;
  onLinkExisting: (parcelId: string, documentType: string, fileId: string, ownerId?: string, folderPath?: string[]) => Promise<void>;
}

function ExistingDrivePicker({ label, recordLabel, parcelId, ownerId, code, actions, onClose }: { label: string; recordLabel: string; parcelId: string; ownerId?: string; code: string; actions: ConsentWorkspaceActions; onClose: () => void }) {
  const [path, setPath] = useState<Array<{ id?: string; name: string }>>([{ name: "Project folder" }]);
  const [files, setFiles] = useState<ExistingDriveFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ExistingDriveFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  const folderId = path[path.length - 1].id;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setFiles([]); setSelectedFile(null); setPageToken(null); setSearch("");
    void listExistingDriveFiles(parcelId, folderId, undefined, controller.signal, path.flatMap((item) => item.id ? [item.id] : [])).then((listing) => {
      if (controller.signal.aborted) return;
      setFiles(listing.files); setPageToken(listing.next_page_token);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load the Drive folder."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [parcelId, folderId, reload]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !linking && !actions.busy) onClose();
      if (event.key === "Tab") {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose, linking, actions.busy]);
  const loadMore = async () => {
    if (!pageToken) return;
    setLoading(true); setError("");
    try { const next = await listExistingDriveFiles(parcelId, folderId, pageToken, undefined, path.flatMap((item) => item.id ? [item.id] : [])); setFiles((current) => [...current, ...next.files]); setPageToken(next.next_page_token); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load more files."); }
    finally { setLoading(false); }
  };
  const link = async () => {
    if (!selectedFile) return;
    setLinking(true); setError("");
    try { await actions.onLinkExisting(parcelId, code, selectedFile.id, ownerId, path.flatMap((item) => item.id ? [item.id] : [])); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not link this file."); }
    finally { setLinking(false); }
  };
  return createPortal(<div className="document-viewer-backdrop"><section aria-labelledby={titleId} aria-modal="true" className="document-viewer drive-file-picker" ref={dialog} role="dialog">
    <header><div><span className="eyebrow">Existing project files</span><h2 id={titleId}>Link {label}</h2><p className="small-note">{recordLabel}</p></div><button className="button button-secondary" disabled={linking || actions.busy} onClick={onClose} type="button">Close</button></header>
    <nav aria-label="Drive folder path" className="drive-folder-path">{path.map((folder, index) => <button className="text-button" disabled={loading || linking || actions.busy || index === path.length - 1} key={folder.id || "root"} onClick={() => setPath(path.slice(0, index + 1))} type="button">{folder.name}</button>)}</nav>
    <label>Find a file in this folder<input disabled={linking || actions.busy} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded filenames or survey number" value={search} /></label>
    {error && <p className="form-error" role="alert">{error} <button className="text-button" disabled={loading || linking} onClick={() => setReload((value) => value + 1)} type="button">Retry</button></p>}
    <div className="drive-file-list">{files.filter((file) => file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((file) => <button className={`drive-file-choice${selectedFile?.id === file.id ? " selected" : ""}`} disabled={loading || linking || actions.busy || (!file.is_folder && !file.can_attach)} key={file.id} onClick={() => file.is_folder ? setPath([...path, { id: file.id, name: file.name }]) : setSelectedFile(file)} type="button"><span className="drive-file-kind">{file.is_folder ? "Folder" : "File"}</span><strong>{file.name}</strong><small>{file.is_folder ? "Open folder →" : file.can_attach ? `${(file.size / 1024 / 1024).toFixed(2)} MB${selectedFile?.id === file.id ? " · Selected" : ""}` : "Unsupported file or over 15 MB"}</small></button>)}{loading && <p role="status">Loading project files…</p>}{!loading && !files.length && !error && <p>No files in this folder.</p>}</div>
    {pageToken && <button className="button button-secondary" disabled={loading || linking || actions.busy} onClick={() => void loadMore()} type="button">Load more files</button>}
    <footer><span>{selectedFile ? `Selected: ${selectedFile.name}` : "Choose the correct file for this survey and owner. Linking leaves the original file in Drive."}</span><button className="button button-primary" disabled={!selectedFile || loading || linking || actions.busy} onClick={() => void link()} type="button">{linking ? "Linking…" : "Link selected file"}</button></footer>
  </section></div>, document.body);
}

function DocumentViewer({ document, onClose }: { document: ParcelDocument; onClose: () => void }) {
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    if (document.id) void openDriveDocument(document.id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setPreview({ url, type: blob.type });
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not open this file.");
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [document.id]);
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],iframe');
        if (!items?.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.document.addEventListener("keydown", onKey);
    return () => { window.document.removeEventListener("keydown", onKey); window.document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [onClose]);
  return createPortal(<div className="document-viewer-backdrop"><section aria-labelledby={titleId} aria-modal="true" className="document-viewer" ref={dialog} role="dialog">
    <header><div><span className="eyebrow">Private Google Drive file</span><h2 id={titleId}>{document.original_filename || "Attached document"}</h2></div><button className="button button-secondary" onClick={onClose} type="button">Close</button></header>
    {error ? <p className="form-error" role="alert">{error}</p> : !preview ? <p role="status">Opening the attached file…</p> : <>
      <div className="document-preview">{preview.type === "application/pdf" ? <iframe src={preview.url} title="Attached PDF document" /> : ["image/jpeg", "image/png"].includes(preview.type) ? <img alt="Attached project document" src={preview.url} /> : <p>This file is ready to download. Open it in Excel or Word.</p>}</div>
      <footer><span>Access is checked using your project account.</span><a className="button button-primary" download={document.original_filename || "project-document"} href={preview.url}>Download file</a></footer>
    </>}
  </section></div>, window.document.body);
}

export function DocumentAttachment({ label, recordLabel, code, parcelId, ownerId, documents, isAdmin, actions }: {
  label: string; recordLabel: string; code: string; parcelId: string; ownerId?: string; documents: ParcelDocument[]; isAdmin: boolean; actions: ConsentWorkspaceActions;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [viewing, setViewing] = useState<ParcelDocument | null>(null);
  const [linking, setLinking] = useState(false);
  const closeViewer = useCallback(() => setViewing(null), []);
  const closePicker = useCallback(() => setLinking(false), []);
  const attachments = documents.filter((item) => item.document_type_code === code && (item.owner_id ?? undefined) === ownerId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const available = attachments.filter((item) => item.id && item.can_view);
  const selected = available.find((item) => item.id === selectedId) ?? available[0];
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size === 0 || file.size > 15 * 1024 * 1024) { setError("Choose a file between 1 byte and 15 MB."); return; }
    setUploading(true);
    try { await actions.onUpload(parcelId, code, file, ownerId); setSelectedId(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Upload failed. Please try again."); }
    finally { setUploading(false); if (input.current) input.current.value = ""; }
  };
  return <div className="document-attachment">
    <div className="attachment-title"><strong>{label}</strong><small>{attachments.length ? `${attachments.length} attached` : "No file attached"}</small></div>
    <div className="attachment-actions">
      {isAdmin && <><input accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" aria-label={`Upload ${label}`} hidden onChange={(event) => void upload(event.target.files?.[0])} ref={input} type="file" /><button aria-label={`Upload ${label}`} className="button button-secondary button-small" disabled={actions.busy || uploading || !actions.driveConnected} onClick={() => input.current?.click()} type="button">{uploading ? "Uploading…" : "Upload"}</button></>}
      <button aria-label={`View ${label}`} className="button button-secondary button-small" disabled={!selected || uploading} onClick={() => selected && setViewing(selected)} type="button">View{available.length > 1 ? ` (${available.length})` : ""}</button>
      {isAdmin && <button aria-label={`Link existing ${label}`} className="button button-secondary button-small" disabled={actions.busy || uploading || !actions.driveConnected} onClick={() => setLinking(true)} type="button">Link existing</button>}
    </div>
    {available.length > 1 && <label className="attachment-history">Attached file<select aria-label={`${label} attached files`} onChange={(event) => setSelectedId(event.target.value)} value={selected?.id ?? ""}>{available.map((item) => <option key={item.id} value={item.id!}>{new Date(item.created_at).toLocaleDateString("en-IN")} · {item.original_filename || "Document"}</option>)}</select></label>}
    {selected?.original_filename && <small className="attachment-filename" title={selected.original_filename}>{selected.original_filename}</small>}
    {attachments.length > 0 && !available.length && <small className="attachment-restricted">{isAdmin ? "This attachment has no available Drive file." : "Restricted document. Administrator access required."}</small>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {viewing && <DocumentViewer document={viewing} onClose={closeViewer} />}
    {linking && <ExistingDrivePicker actions={actions} code={code} label={label} onClose={closePicker} ownerId={ownerId} parcelId={parcelId} recordLabel={recordLabel} />}
  </div>;
}

export function SurveyDocumentPanel({ detail, isAdmin, actions }: { detail: ParcelDetail; isAdmin: boolean; actions: ConsentWorkspaceActions }) {
  const [kycOwner, setKycOwner] = useState("");
  useEffect(() => setKycOwner(""), [detail.id]);
  const recordLabel = `${detail.village?.name_en || "Village"} · Survey ${detail.survey_number}`;
  const attachment = (label: string, code: string, ownerId?: string) => <DocumentAttachment actions={actions} code={code} documents={detail.documents} isAdmin={isAdmin} key={`${code}-${ownerId || "survey"}`} label={label} ownerId={ownerId} parcelId={detail.id} recordLabel={recordLabel + (ownerId ? ` · ${detail.owners.find((owner) => owner.id === ownerId)?.display_name || "Owner"}` : "")} />;
  return <section className="survey-document-panel" aria-label="Survey documents">
    <div className="section-label">Upload / View documents</div>
    {isAdmin && <div className="drive-inline-status"><span className={actions.driveConnected ? "connection-dot connected" : "connection-dot"} /><span>{actions.driveConnected ? "Google Drive connected" : "Connect Drive to upload"}</span>{!actions.driveConnected && <button className="text-button" disabled={actions.connectingDrive || actions.busy} onClick={actions.onConnectDrive} type="button">{actions.connectingDrive ? "Opening…" : "Connect"}</button>}</div>}
    {attachment("Current 7/12", "current_712")}
    {attachment("Nondh No. 6 / Mutation Entry", "nondh_6")}
    <details className="kyc-documents"><summary>KYC <small>Owner identity & bank files</small></summary><div className="kyc-document-body">
      {isAdmin ? <><label>Choose owner<select disabled={actions.busy} onChange={(event) => setKycOwner(event.target.value)} value={kycOwner}><option value="">Select an owner</option>{detail.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.display_name}</option>)}</select></label>{kycOwner && <>{attachment("PAN card", "pan", kycOwner)}{attachment("Aadhaar card", "aadhaar", kycOwner)}{attachment("Passbook / Cancelled Cheque", "bank_details", kycOwner)}</>}<small className="small-note">Choose an owner to attach their KYC files.</small></> : <p className="small-note">KYC files require administrator access.</p>}
      {isAdmin && detail.documents.some((item) => ["pan", "aadhaar", "bank_details"].includes(item.document_type_code) && !item.owner_id) && <details><summary>Earlier survey-level KYC files</summary>{["pan", "aadhaar", "bank_details"].map((code) => <DocumentAttachment actions={actions} code={code} documents={detail.documents} isAdmin={false} key={code} label={code === "pan" ? "PAN card" : code === "aadhaar" ? "Aadhaar card" : "Bank document"} parcelId={detail.id} recordLabel={recordLabel} />)}</details>}
    </div></details>
    {attachment("Consent Letter", "consent_letter")}
    {detail.documents.some(d=>d.document_type_code==="consent_form_draft") && <DocumentAttachment label="Generated consent forms (unsigned drafts)" code="consent_form_draft" parcelId={detail.id} documents={detail.documents} recordLabel={recordLabel} isAdmin={false} actions={actions}/>}
    {attachment("Lease Deed", "lease_deed")}
    {attachment("Old 7/12", "old_712")}
    {attachment("Old Nondh No. 6 / Mutation Entry", "old_nondh_6")}
    <details className="kyc-documents"><summary>Other documents</summary><div className="kyc-document-body">{attachment("Mutation Entry / Death Certificate", "mutation_death_certificate")}{attachment("Other", "other")}</div></details>
    <p className="small-note">Uploads go into this survey’s matching legal or owner folder in Drive. Uploading a file does not mark consent as received.</p>
  </section>;
}

const emptyDetails: OwnerDetailsInput = { pan_owner_name: "", pan_number: "", aadhaar_owner_name: "", aadhaar_number: "", bank_owner_name: "", bank_account_number: "", bank_branch: "", ifsc_code: "", bank_name: "", bank_account_type: "" };

function OwnerEditor({ owner, detail, expanded, onExpand, actions }: { owner: ParcelDetail["owners"][number]; detail: ParcelDetail; expanded: boolean; onExpand: () => void; actions: ConsentWorkspaceActions }) {
  const existing = detail.private_owner_details.find((item) => item.owner_id === owner.id);
  const initial = (): OwnerDetailsInput => Object.fromEntries(Object.keys(emptyDetails).map((field) => [field, existing?.[field as keyof OwnerDetailsInput] ?? ""])) as unknown as OwnerDetailsInput;
  const [draft, setDraft] = useState<OwnerDetailsInput>(initial);
  const [saved, setSaved] = useState<OwnerDetailsInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const panelId = useId();
  useEffect(() => { const next = initial(); setDraft(next); setSaved(next); setError(""); }, [owner.id, existing?.updated_at]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const change = (field: keyof OwnerDetailsInput, value: string) => { setDraft((current) => ({ ...current, [field]: value })); setMessage(""); setError(""); };
  const save = async () => {
    setError(""); setMessage(""); setSaving(true);
    try { await actions.onSaveOwner(detail.id, owner.id, draft); setSaved(draft); setMessage("Owner details saved."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this owner."); }
    finally { setSaving(false); }
  };
  const field = (key: keyof OwnerDetailsInput, label: string, options: { maxLength?: number; inputMode?: "numeric"; upper?: boolean } = {}) => <label>{label}<input autoComplete="off" inputMode={options.inputMode} maxLength={options.maxLength ?? 200} onChange={(event) => change(key, options.upper ? event.target.value.toUpperCase() : event.target.value)} value={draft[key]} /></label>;
  return <article className={`owner-editor${expanded ? " expanded" : ""}`}>
    <div className="owner-heading"><div><strong>{owner.display_name}</strong><span>{owner.is_primary ? "Primary owner" : `Owner ${owner.sequence_no ?? ""}`}{dirty ? " · Unsaved details" : existing ? " · Details saved" : ""}</span></div><button aria-controls={panelId} aria-expanded={expanded} className="button button-secondary button-small" disabled={actions.busy} onClick={onExpand} type="button">{expanded ? "Close details" : existing ? "Edit details" : "Add details"}</button></div>
    {expanded && <section className="owner-editor-body" id={panelId} aria-label={`Details for ${owner.display_name}`}>
      <fieldset disabled={actions.busy || saving}><label className="registered-owner-name">Name as per 7/12<input readOnly value={owner.display_name} /><small>From the imported land register</small></label>
        <div className="section-label form-section-label">Identity</div><div className="form-grid">
          {field("pan_owner_name", "Name as per PAN card")}{field("pan_number", "PAN card number", { maxLength: 10, upper: true })}
          {field("aadhaar_owner_name", "Name as per Aadhaar card")}{field("aadhaar_number", "Aadhaar card number", { maxLength: 14, inputMode: "numeric" })}
        </div>
        <div className="section-label form-section-label">Bank account</div><div className="form-grid">
          {field("bank_owner_name", "Name as per Bank Account")}{field("bank_account_number", "Account Number", { maxLength: 34, inputMode: "numeric" })}
          {field("bank_branch", "Branch")}{field("ifsc_code", "IFSC Code", { maxLength: 11, upper: true })}
          {field("bank_name", "Bank Name")}<label>Account Type<select onChange={(event) => change("bank_account_type", event.target.value)} value={draft.bank_account_type}><option value="">Choose account type</option><option value="SB">SB — Savings</option><option value="CA">CA — Current</option><option value="OD">OD — Overdraft</option><option value="CC">CC — Cash Credit</option></select></label>
        </div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="owner-save-success" role="status">{message}</p>}
      <div className="owner-save-row"><span>These details are saved only for this owner.</span><button className="button button-primary" disabled={!dirty || saving || actions.busy} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save owner details"}</button></div>
      <div className="section-label form-section-label">Owner documents</div><div className="owner-document-grid">{[["PAN card", "pan"], ["Aadhaar card", "aadhaar"], ["Passbook / Cancelled Cheque", "bank_details"]].map(([label, code]) => <DocumentAttachment actions={actions} code={code} documents={detail.documents} isAdmin key={code} label={label} ownerId={owner.id} parcelId={detail.id} recordLabel={`${detail.village?.name_en || "Village"} · Survey ${detail.survey_number} · ${owner.display_name}`} />)}</div>
    </section>}
  </article>;
}

export function OwnerDetailsSection({ detail, isAdmin, actions }: { detail: ParcelDetail; isAdmin: boolean; actions: ConsentWorkspaceActions }) {
  const [expandedOwner, setExpandedOwner] = useState<string | null>(null);
  useEffect(() => setExpandedOwner(null), [detail.id]);
  return <section className="card detail-card owner-details-section"><div className="card-heading"><div><div className="eyebrow">Owners</div><h3>Farmer / owner details</h3><p>{isAdmin ? "Open an owner to add identity, bank details and supporting files." : "Names from the land register. Identity and bank details require administrator access."}</p></div><span className="lock-badge">{detail.owners.length} owners</span></div>
    {detail.owners.length ? <div className="owner-editors">{detail.owners.map((owner) => isAdmin ? <OwnerEditor actions={actions} detail={detail} expanded={expandedOwner === owner.id} key={owner.id} onExpand={() => setExpandedOwner(expandedOwner === owner.id ? null : owner.id)} owner={owner} /> : <div className="owner-heading" key={owner.id}><div><strong>{owner.display_name}</strong><span>{owner.is_primary ? "Primary owner" : `Owner ${owner.sequence_no ?? ""}`}</span></div></div>)}</div> : <p className="muted">No owner name was supplied in the source sheet.</p>}
  </section>;
}
