import { buildGoogleAuthorizeUrl, requireRole, sha256Text } from "../_shared/google-drive-oauth.ts";

function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get("origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.replace(/\/$/, "");
  if (!allowedOrigin || (origin && origin.replace(/\/$/, "") !== allowedOrigin)) return null;
  return {
    "Access-Control-Allow-Origin": origin ?? allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: Record<string, unknown>, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (!headers) return json({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, headers);
  try {
    const { admin, userId } = await requireRole(request, ["admin"]);
    const state = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    await admin.from("integration_oauth_states").delete().lt("expires_at", new Date().toISOString());
    const { error } = await admin.from("integration_oauth_states").insert({
      state_hash: await sha256Text(state),
      provider: "google_drive",
      requested_by: userId,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw new Error("Could not create the secure Google connection request.");
    return json({ authorize_url: buildGoogleAuthorizeUrl(state) }, 200, headers);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not start Google Drive connection." }, 400, headers);
  }
});
