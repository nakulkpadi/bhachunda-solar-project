// Read-only authentication probes against the deployed draft API.
// No real user sessions, form payloads, data reads or Drive writes are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const env = Object.fromEntries(
  fs.readFileSync('erp-foundation/apps/web/.env.production', 'utf8')
    .split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line))
    .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')]; })
);
assert.equal(env.VITE_SUPABASE_URL, 'https://aqgnkgyhuatpwdlqueat.supabase.co');
assert.ok(env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'), 'A public client key is required.');
const endpoint = env.VITE_SUPABASE_URL + '/functions/v1/consent-drafts';
const probes = [
  { name: 'Unsigned requests cannot list drafts', method: 'GET', expected: 401 },
  { name: 'Unsigned requests cannot create drafts', method: 'POST', expected: 401 },
  { name: 'Forged sessions are rejected', method: 'GET', token: 'invalid-fixture-token', expected: 401 },
  { name: 'Foreign web origins are rejected', method: 'GET', origin: 'https://foreign.fixture.invalid', expected: 403 }
];
(async () => {
  await Promise.all(probes.map(async probe => {
    const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Origin: probe.origin || 'https://nakulkpadi.github.io' };
    if (probe.token) headers.Authorization = 'Bearer ' + probe.token;
    const response = await fetch(endpoint, { method: probe.method, headers, signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, probe.expected, probe.name);
    const body = await response.json();
    assert.equal(typeof body.error, 'string', probe.name);
    assert.equal(body.drafts, undefined, probe.name);
    console.log('PASS: ' + probe.name);
  }));
})().catch(error => {
  console.error('Draft API verification failed: ' + error.message);
  process.exitCode = 1;
});
