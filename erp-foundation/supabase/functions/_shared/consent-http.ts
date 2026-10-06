export function corsHeaders(request: Request, methods: string): Record<string, string> | null {
  const origin = request.headers.get("origin");
  const allowed = Deno.env.get("ALLOWED_ORIGIN")?.replace(/\/$/, "");
  if (!allowed || (origin && origin.replace(/\/$/, "") !== allowed)) return null;
  return {
    "Access-Control-Allow-Origin": origin ?? allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": `${methods}, OPTIONS`,
    "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
    "Cache-Control": "private, no-store",
    "Vary": "Origin"
  };
}

export function json(body: Record<string, unknown>, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export function authFailure(error: unknown): { message: string; status: number } {
  const message = error instanceof Error ? error.message : "Request failed.";
  if (/Authentication/i.test(message)) return { message: "Please sign in with an active project account.", status: 401 };
  if (/Your role/i.test(message)) return { message: "Your role cannot perform this action.", status: 403 };
  return { message: "The request could not be completed. Please try again.", status: 500 };
}
