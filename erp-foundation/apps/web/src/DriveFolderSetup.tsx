import { useEffect, useRef, useState } from "react";
import { driveFolderSetup, type DriveSetupProgress } from "./api";

export function DriveFolderSetup({ visible, connected, selectedParcelId, selectedLabel }: { visible: boolean; connected: boolean; selectedParcelId?: string; selectedLabel?: string }) {
  const [progress, setProgress] = useState<DriveSetupProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stop = useRef(false);
  const runningRef = useRef(false);
  useEffect(() => {
    let active = true;
    if (connected) void driveFolderSetup(undefined, true).then((result) => { if (active) setProgress(result); }).catch(() => {});
    return () => { active = false; };
  }, [connected]);
  useEffect(() => () => { stop.current = true; }, []);
  const prepare = async (all: boolean) => {
    if (runningRef.current) return;
    runningRef.current = true; stop.current = false; setRunning(true); setError(""); setMessage("");
    try {
      let result: DriveSetupProgress;
      do {
        result = await driveFolderSetup(all ? undefined : selectedParcelId);
        setProgress(result);
      } while (all && result.remaining > 0 && !stop.current);
      setMessage(stop.current ? "Paused. Completed surveys are saved; resume whenever you are ready." : all ? "All survey and owner folders are ready." : `${selectedLabel || "This survey"}: folders checked and missing folders created.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Folder setup stopped. Resume to continue.");
      try { setProgress(await driveFolderSetup(undefined, true)); } catch { /* Keep the last confirmed progress. */ }
    } finally { runningRef.current = false; setRunning(false); }
  };
  if (!visible && !running) return null;
  return <section className="drive-folder-setup card" aria-label="Google Drive folder setup">
    <div className="folder-setup-heading"><div><div className="eyebrow">Google Drive organization</div><h3>Survey folders</h3><p>KYC With Bank Details · Legal Documents · Other</p></div>
      <div className="folder-setup-actions">{running ? <button className="button button-secondary" onClick={() => { stop.current = true; setMessage("Pausing after the current batch finishes…"); }} type="button">Pause setup</button> : <><button className="button button-secondary" disabled={!connected || !selectedParcelId} onClick={() => void prepare(false)} type="button">Check this survey</button><button className="button button-primary" disabled={!connected || progress?.remaining === 0} onClick={() => void prepare(true)} type="button">{progress?.remaining === 0 ? "All folders ready" : "Create missing folders"}</button></>}</div>
    </div>
    {progress && <div className="folder-setup-progress"><progress aria-label="Surveys with folders ready" max={progress.total || 1} value={progress.completed} /><span>{progress.completed} / {progress.total} surveys ready{running ? " · Creating missing folders…" : ""}</span></div>}
    <details><summary>Folder structure</summary><p>Each village contains its survey numbers. Each survey has one KYC folder per owner, named from the imported land register. Legal Documents contains Lease Deed, Consent, Current 7-12, Nondh No. 6 - Mutation Entry, Old 7-12 and Old Nondh No. 6 - Mutation Entry. Other holds additional documents.</p></details>
    <p className="small-note">Existing folders are reused. New uploads go to their matching subfolder. Keep this page open during setup; progress is saved in Supabase.</p>
    {message && <p className="small-note" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error} Completed surveys are saved. Resume setup to continue.</p>}
  </section>;
}
