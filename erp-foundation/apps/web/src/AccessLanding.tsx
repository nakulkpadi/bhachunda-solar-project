import { useState, type FormEvent } from "react";
import { createAccount, isSupabaseConfigured, resetPassword, setAccountPassword, signIn, signOut } from "./api";
import type { CurrentProfile } from "./types";

export function AccessLanding({ profile, email: accountEmail, loading, passwordSetup, onPasswordDone, onRefresh }: { profile: CurrentProfile | null; email?: string; loading: boolean; passwordSetup: boolean; onPasswordDone: () => void; onRefresh: () => void }) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = Boolean(accountEmail && profile && !passwordSetup);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (passwordSetup) {
        if (password !== confirm) throw new Error("The passwords do not match.");
        await setAccountPassword(password); setPassword(""); setConfirm(""); onPasswordDone();
      } else if (mode === "register") {
        await createAccount(name.trim(), email.trim().toLowerCase(), password);
        setPassword(""); setMessage("Check your email to confirm your account. Your request will then wait for administrator approval.");
      } else if (mode === "reset") {
        await resetPassword(email.trim().toLowerCase());
        setMessage("If an account exists for this email, a password reset link will be sent.");
      } else { await signIn(email.trim().toLowerCase(), password); setPassword(""); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  };
  const changeMode = (next: typeof mode) => { setMode(next); setError(""); setMessage(""); setPassword(""); };
  const status = profile?.approval_status;
  return <main className="access-page">
    <section className="access-story" aria-label="Bhachunda Solar Project">
      <div className="access-brand"><svg aria-hidden="true" viewBox="0 0 36 36"><path d="M3 5h14v12H3zM20 5h13v12H20zM3 20h14v12H3z" fill="currentColor"/><path d="m20 20 13-2v14H20z" fill="#cfa867"/></svg><div><strong>Bhachunda</strong><span>Solar project</span></div></div>
      <div className="access-story-copy"><span className="eyebrow">Land acquisition · Kutch, Gujarat</span><h1>A clear view of<br/>every survey.</h1><p>One project workspace for land records, consent, documents and the next step.</p>
        <div className="access-villages"><span>Bhavanipar</span><span>Bitta</span><span>Vandh Timbo</span></div>
      </div>
      <svg className="access-land-art" viewBox="0 0 680 250" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1"><path d="M-30 200 120 70 220 110 360 25 495 65 715 15M-30 240 142 101 240 141 377 58 510 101 715 48M20 270 165 140 261 178 402 94 536 135 725 91M120 70 142 101 165 140 192 197M220 110 240 141 261 178 281 224M360 25 377 58 402 94 430 151M495 65 510 101 536 135 560 193M120 70 92 10M220 110 191 49M360 25 348 -20M495 65 478 5M142 101 133 186M240 141 223 227M377 58 362 141M510 101 490 195"/><path fill="#c7ad7f" fillOpacity=".2" d="m240 141 137-83 25 36-141 84Z"/><path fill="#8eab94" fillOpacity=".3" d="m120 70 100 40 20 31-98-40Z"/><path d="M-10 232Q225 207 680 235" strokeWidth="3"/></g><circle cx="562" cy="29" r="22" fill="#cfad75" fillOpacity=".6"/></svg>
      <div className="access-story-footer"><span>Project workspace</span><span>Access by approval</span></div>
    </section>
    <section className="access-form-side">
      <div className="access-form-card">
        {loading ? <div role="status" className="access-wait"><span className="eyebrow">Your workspace</span><h2>Checking your account…</h2><p>Please wait while we verify your access.</p></div> : pending ? <>
          <span className="eyebrow">Account request</span><div className="access-status-mark" aria-hidden="true">{status === "pending" ? "◷" : "—"}</div>
          <h2>{status === "rejected" ? "Access request declined" : status === "suspended" ? "Access is paused" : "Waiting for approval"}</h2>
          <p className="access-description">{status === "pending" ? "Your account is ready. The project administrator needs to approve your access before you can enter the ERP." : "Contact the project administrator to review your access."}</p>
          <p className="access-account">{accountEmail}</p><button className="button button-primary access-submit" onClick={onRefresh} type="button">Check approval</button><button className="access-text-button" onClick={() => void signOut()} type="button">Sign out</button>
        </> : <>
          <span className="eyebrow">Welcome to the project</span><h2>{passwordSetup ? "Set your password" : mode === "register" ? "Request project access" : mode === "reset" ? "Reset your password" : "Welcome back"}</h2>
          <p className="access-description">{passwordSetup ? "Choose a password for your project account. Your administrator controls ERP access." : mode === "register" ? "Create an account. The administrator will review and approve your request." : mode === "reset" ? "We’ll send a reset link to your account email." : "Sign in to open your project workspace."}</p>
          {!passwordSetup && mode !== "reset" && <div className="access-tabs" aria-label="Account options"><button type="button" aria-pressed={mode === "login"} onClick={() => changeMode("login")}>Sign in</button><button type="button" aria-pressed={mode === "register"} onClick={() => changeMode("register")}>Create account</button></div>}
          <form className="stack-form" onSubmit={submit}>
            {mode === "register" && !passwordSetup && <label>Full name<input autoComplete="name" required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label>}
            {!passwordSetup && <label>Email address<input autoComplete="email" required type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></label>}
            {(passwordSetup || mode !== "reset") && <label>Password<input autoComplete={passwordSetup || mode === "register" ? "new-password" : "current-password"} required type="password" minLength={passwordSetup || mode === "register" ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)}/>{(passwordSetup || mode === "register") && <span className="muted">Use at least 12 characters.</span>}</label>}
            {passwordSetup && <label>Confirm password<input autoComplete="new-password" required type="password" minLength={12} value={confirm} onChange={e => setConfirm(e.target.value)}/></label>}
            {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="access-message" role="status">{message}</p>}
            <button className="button button-primary access-submit" disabled={busy || !isSupabaseConfigured} type="submit">{busy ? "Please wait…" : passwordSetup ? "Save password" : mode === "register" ? "Create account & request access" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
          </form>
          {!passwordSetup && <button className="access-text-button" type="button" onClick={() => changeMode(mode === "reset" ? "login" : "reset")}>{mode === "reset" ? "Back to sign in" : "Forgot password?"}</button>}
        </>}
        <div className="access-help"><span>Need access help?</span><a href="mailto:nakul.kapdi@gmail.com">Contact the administrator</a></div>
      </div>
      <p className="access-footer">Bhachunda Solar Project · Project accounts only</p>
    </section>
  </main>;
}
