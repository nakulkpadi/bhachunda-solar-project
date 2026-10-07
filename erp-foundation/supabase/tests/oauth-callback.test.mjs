import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

async function callback(overrides = {}) {
  const state = { role: "admin", active: true, approval: "approved", consumed: false, expired: false, exchanged: 0, writes: [], ...overrides };
  const admin = { from(table) {
    let operation = "select", values;
    const query = {
      select() { return query; }, eq() { return query; }, gt() { return query; }, delete() { operation = "delete"; return query; },
      upsert(value) { operation = "upsert"; values = value; return query; }, insert(value) { operation = "insert"; values = value; return query; },
      async maybeSingle() {
        if (table === "integration_oauth_states") {
          assert.equal(operation, "delete", "state must be atomically consumed");
          if (state.consumed || state.expired) return { data: null, error: null };
          state.consumed = true;
          return { data: { requested_by: "admin-user", expires_at: new Date(Date.now() + 60000).toISOString() }, error: null };
        }
        return { data: { role: state.role, is_active: state.active, approval_status: state.approval }, error: null };
      },
      then(resolve, reject) { state.writes.push({ table, operation, values }); return Promise.resolve({ error: null }).then(resolve, reject); }
    }; return query;
  } };
  let handler;
  const context = vm.createContext({ Request, Response, URL, Error, Date, Deno: { env: { get: key => ({ ALLOWED_ORIGIN: "https://nakulkpadi.github.io", ERP_APP_PATH: "/bhachunda-solar-project/" })[key] }, serve: fn => { handler = fn; } } });
  const exports = { GOOGLE_REFRESH_TOKEN_KEY: "google_drive_refresh_token", createAdminClient: () => admin, encryptSecret: async () => "encrypted-test-value", exchangeGoogleAuthorizationCode: async () => { state.exchanged++; return "test-value"; }, sha256Text: async () => "test-state-hash" };
  const oauth = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key,value] of Object.entries(exports)) this.setExport(key,value); }, { context });
  const source = stripTypeScriptTypes(await readFile(new URL("../functions/drive-oauth-callback/index.ts", import.meta.url), "utf8"), { mode: "strip" });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => oauth); await module.evaluate();
  return { state, handler };
}
const request = () => new Request("https://project.supabase.co/functions/v1/drive-oauth-callback?state=test-state&code=test-code");

test("Drive callback atomically consumes state once and uses the fixed ERP destination", async () => {
  const { handler, state } = await callback();
  const result = await handler(request());
  assert.equal(result.status, 303); assert.equal(result.headers.get("location"), "https://nakulkpadi.github.io/bhachunda-solar-project/?drive=connected");
  assert.equal(state.exchanged, 1); assert.equal(state.writes.filter(x => x.table === "integration_secrets").length, 1);
  assert.equal((await handler(request())).headers.get("location"), "https://nakulkpadi.github.io/bhachunda-solar-project/?drive=failed");
  assert.equal(state.exchanged, 1);
});

test("expired Drive state cannot exchange codes or write credentials", async () => {
  const { handler, state } = await callback({ expired: true }); await handler(request());
  assert.equal(state.exchanged, 0); assert.equal(state.writes.length, 0);
});

test("Drive callback rechecks the requesting administrator's live approval and role", async () => {
  for (const config of [{ approval: "pending" }, { approval: "suspended" }, { active: false }, { role: "editor" }, { role: "viewer" }]) {
    const { handler, state } = await callback(config); await handler(request());
    assert.equal(state.exchanged, 0); assert.equal(state.writes.length, 0);
  }
});

test("malformed Drive callbacks do not look up or write credentials", async () => {
  const { handler, state } = await callback();
  for (const suffix of ["", "?error=denied", "?state=x&code=" + "x".repeat(2049)]) await handler(new Request("https://project.supabase.co/functions/v1/drive-oauth-callback" + suffix));
  assert.equal(state.consumed, false); assert.equal(state.exchanged, 0); assert.equal(state.writes.length, 0);
});
