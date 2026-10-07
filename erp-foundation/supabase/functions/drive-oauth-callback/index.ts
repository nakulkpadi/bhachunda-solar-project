import {
  GOOGLE_REFRESH_TOKEN_KEY,
  createAdminClient,
  encryptSecret,
  exchangeGoogleAuthorizationCode,
  sha256Text,
} from "../_shared/google-drive-oauth.ts";

function returnToErp(result: "connected" | "failed"): Response {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.replace(/\/$/, "");
  if (!allowedOrigin) return new Response("Google Drive callback is not configured.", { status: 500 });
  const appPath = (Deno.env.get("ERP_APP_PATH") || "/bhachunda-solar-project/").trim();
  const destination = new URL(appPath.startsWith("/") ? appPath : `/${appPath}`, allowedOrigin);
  destination.searchParams.set("drive", result);
  return Response.redirect(destination.toString(), 303);
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return returnToErp("failed");
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !state || !code || state.length > 200 || code.length > 2048) return returnToErp("failed");
  try {
    const admin = createAdminClient();
    const stateHash = await sha256Text(state);
    const { data: savedState, error: stateError } = await admin
      .from("integration_oauth_states")
      .delete()
      .eq("state_hash", stateHash)
      .eq("provider", "google_drive")
      .gt("expires_at", new Date().toISOString())
      .select("requested_by,expires_at")
      .maybeSingle();
    if (stateError || !savedState || new Date(savedState.expires_at).getTime() < Date.now()) {
      return returnToErp("failed");
    }
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role,is_active,approval_status").eq("id", savedState.requested_by).maybeSingle();
    if (profileError || !profile || profile.role !== "admin" || !profile.is_active || profile.approval_status !== "approved") return returnToErp("failed");
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
    return returnToErp("connected");
  } catch {
    return returnToErp("failed");
  }
});
