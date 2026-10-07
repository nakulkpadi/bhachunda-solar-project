import { requireRole } from "../_shared/google-drive-oauth.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";
import { UUID } from "../_shared/owner-details.ts";

const ROLES = new Set(["editor", "viewer", "commenter"]);
const STATUSES: Record<string, string> = { approve: "approved", reject: "rejected", suspend: "suspended" };
const ADMIN_EMAIL = "nakul.kapdi@gmail.com";

Deno.serve(async (request) => {
  const headers = corsHeaders(request, "GET, POST");
  if (!headers) return json({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405, headers);
  try {
    const { admin, userId } = await requireRole(request, ["admin"]);
    if (request.method === "GET") {
      const { data, error } = await admin.from("profiles").select("id,email,full_name,role,is_active,approval_status,created_at,approved_at,invited_by").order("created_at", { ascending: false }).limit(1000);
      if (error) throw new Error("Could not load project accounts.");
      return json({ users: data || [] }, 200, headers);
    }
    const raw = await request.text();
    if (raw.length > 1024) return json({ error: "The request is too large." }, 413, headers);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid account request." }, 400, headers); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid account request." }, 400, headers);
    const role = typeof body.role === "string" ? body.role : "viewer";
    if (!ROLES.has(role)) return json({ error: "Choose Editor, Viewer or Commenter." }, 400, headers);
    if (body.action === "invite") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 100) : "";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400, headers);
      const { data: existing, error: lookupError } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (lookupError) throw new Error("Could not check this project account.");
      if (existing) return json({ error: "This account already exists. Review its access in the accounts list." }, 409, headers);
      // The provider applies its email rate limits. Persist attempts too, so
      // repeated failures cannot bypass the project invitation limit.
      const { count, error: countError } = await admin.from("user_invitations").select("id", { count: "exact", head: true }).eq("invited_by", userId).gte("created_at", new Date(Date.now() - 3600000).toISOString());
      if (countError) throw new Error("Could not check invitation limits.");
      if ((count || 0) >= 20) return json({ error: "Twenty invitation attempts were made this hour. Please try again later." }, 429, headers);
      const { data: attempt, error: attemptError } = await admin.from("user_invitations").insert({ email, role, invited_by: userId, status: "pending" }).select("id").single();
      if (attemptError || !attempt) throw new Error("Could not record this invitation.");
      const redirectTo = "https://nakulkpadi.github.io/bhachunda-solar-project/index.html";
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: fullName } });
      if (error || !data.user) {
        await admin.from("user_invitations").update({ status: "failed" }).eq("id", attempt.id);
        const limited = /rate|limit/i.test(error?.code || "");
        return json({ error: limited ? "Supabase's email limit was reached. Try later or configure custom SMTP." : "The invitation email could not be sent. Check Supabase email/SMTP settings and try again." }, limited ? 429 : 502, headers);
      }
      const { error: profileError } = await admin.from("profiles").update({ role, is_active: false, approval_status: "pending", invited_by: userId }).eq("id", data.user.id);
      if (profileError) throw new Error("Invitation sent, but account access could not be saved. Review the pending account.");
      await admin.from("user_invitations").update({ status: "sent", user_id: data.user.id }).eq("id", attempt.id);
      await admin.from("activity_log").insert({ actor_id: userId, action: "user_invited", entity_type: "profile", entity_id: data.user.id, summary: `Invitation sent with ${role} access; approval pending.` });
      return json({ invited: true, approval_required: true }, 201, headers);
    }
    if (!UUID.test(body.user_id || "") || !["approve", "reject", "suspend", "role"].includes(body.action)) return json({ error: "Select a valid account action." }, 400, headers);
    const { data: target, error: targetError } = await admin.from("profiles").select("id,email,role,approval_status").eq("id", body.user_id).maybeSingle();
    if (targetError) throw new Error("Could not check the selected account.");
    if (!target) return json({ error: "Account was not found." }, 404, headers);
    if (target.id === userId || target.role === "admin" || target.email?.toLowerCase() === ADMIN_EMAIL) return json({ error: "The administrator account is protected." }, 403, headers);
    const changes: Record<string, unknown> = { role };
    if (body.action !== "role") Object.assign(changes, { approval_status: STATUSES[body.action], is_active: body.action === "approve", approved_by: userId, approved_at: body.action === "approve" ? new Date().toISOString() : null });
    const { error } = await admin.from("profiles").update(changes).eq("id", target.id);
    if (error) throw new Error("Could not update this account.");
    await admin.from("activity_log").insert({ actor_id: userId, action: `user_${body.action}`, entity_type: "profile", entity_id: target.id, summary: `Account action: ${body.action}; role: ${role}.` });
    return json({ saved: true }, 200, headers);
  } catch (error) { const failure = authFailure(error); return json({ error: failure.message }, failure.status, headers); }
});
