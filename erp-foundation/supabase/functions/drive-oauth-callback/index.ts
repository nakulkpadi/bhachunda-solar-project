import {
  GOOGLE_REFRESH_TOKEN_KEY,
  createAdminClient,
  encryptSecret,
  exchangeGoogleAuthorizationCode,
  sha256Text,
} from "../_shared/google-drive-oauth.ts";

function page(title: string, message: string, success = false): Response {
  const colour = success ? "#16643b" : "#9b3034";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f6fa;font:16px system-ui,sans-serif;color:#1d2d45}.card{max-width:480px;padding:32px;border:1px solid #dce5ef;border-radius:16px;background:white;box-shadow:0 18px 48px #142c4a17}h1{color:${colour};margin:0 0 10px;font-size:24px}p{line-height:1.55;color:#617188}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new Response(html, { status: success ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return page("Method not allowed", "Return to the ERP and start the connection again.");
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !state || !code) return page("Google Drive was not connected", "No Drive credential was saved. Return to the ERP and try again when ready.");
  try {
    const admin = createAdminClient();
    const stateHash = await sha256Text(state);
    const { data: savedState, error: stateError } = await admin
      .from("integration_oauth_states")
      .select("requested_by,expires_at")
      .eq("state_hash", stateHash)
      .eq("provider", "google_drive")
      .maybeSingle();
    if (stateError || !savedState || new Date(savedState.expires_at).getTime() < Date.now()) {
      return page("Connection link expired", "Return to the ERP and start a new Google Drive connection.");
    }
    await admin.from("integration_oauth_states").delete().eq("state_hash", stateHash);
    const refreshToken = await exchangeGoogleAuthorizationCode(code);
    const { error: secretError } = await admin.from("integration_secrets").upsert({
      key: GOOGLE_REFRESH_TOKEN_KEY,
      ciphertext: await encryptSecret(refreshToken),
      updated_by: savedState.requested_by,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (secretError) throw new Error("Could not save the Google Drive connection.");
    await admin.from("activity_log").insert({
      actor_id: savedState.requested_by,
      action: "google_drive_connected",
      entity_type: "integration",
      summary: "Personal Google Drive OAuth connection updated",
    });
    return page("Google Drive connected", "The project can now create survey folders and upload new documents to the Drive account you approved. You may close this tab and return to the ERP.", true);
  } catch {
    return page("Google Drive was not connected", "No usable Drive credential was saved. Return to the ERP, check the Google OAuth setup, and try again.");
  }
});
