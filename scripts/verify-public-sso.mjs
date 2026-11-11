import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = 'https://trail.pydemia.ai';
const login = await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
const target = new URL(login.headers.get('location'));
assert.equal(login.status, 302);
assert.equal(target.hostname, 'login.microsoftonline.com');
assert.equal(target.searchParams.get('client_id'), '8e026114-f50c-454c-9d70-76490df3dfd0');
assert.equal(target.searchParams.get('redirect_uri'), `${base}/oauth2/callback`);
assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
assert.ok(target.searchParams.get('nonce'));
assert.ok(target.searchParams.get('state'));
const results = { root: { status: 302, provider: target.hostname, pkce: 'S256', callbackMatches: true } };
for (const [name, route, headers, expected] of [
  ['panel', '/panel', {}, 401],
  ['stream', '/events', {}, 401],
  ['forgedIdentity', '/panel', { 'x-forwarded-email': 'pydemia@pydemia.ai', 'x-agent-track-trust': 'forged' }, 401],
  ['forgedCookie', '/model', { cookie: '__Host-agent-trail=forged' }, 401],
  ['basicNotAccepted', '/panel', { authorization: 'Basic dGVzdDp0ZXN0' }, 401],
  // OAuth2 Proxy 7.15.2 rejects malformed state with its generic 500 error page.
  ['forgedCallback', '/oauth2/callback?code=invalid&state=invalid', {}, 500],
]) {
  const response = await fetch(base + route, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  await response.text();
  assert.equal(response.status, expected, name);
  assert.equal(response.headers.get('www-authenticate'), null, name);
  results[name] = { status: response.status, basicChallenge: false };
}
const evidence = { date: '2026-11-11', tunnelVersion: 9, route: 'http://127.0.0.1:14340', results, browserLoginEvidence: 'entra-browser-verification.json', track: 'registered and configuration checked; product not deployed' };
fs.writeFileSync(new URL('../docs/entra-activation.json', import.meta.url), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(results));
