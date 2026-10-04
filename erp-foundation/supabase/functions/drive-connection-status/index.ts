import { GOOGLE_REFRESH_TOKEN_KEY, requireRole } from "../_shared/google-drive-oauth.ts";

function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get("origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.replace(/\/$/, "");
  if (!allowedOrigin || (origin && origin.replace(/\/$/, "") !== allowedOrigin)) return null;
  return {
    "Access-Control-Allow-Origin": origin ?? allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, headers);
  try {
    const { admin } = await requireRole(request, ["admin"]);
    const { data, error } = await admin
      .from("integration_secrets")
      .select("key")
      .eq("key", GOOGLE_REFRESH_TOKEN_KEY)
      .maybeSingle();
    if (error) throw new Error("Could not check the Google Drive connection.");
    return json({ connected: Boolean(data) }, 200, headers);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not check the Google Drive connection." }, 400, headers);
  }
});
