import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
const state = path.join(os.homedir(), '.local/share/agent-track');
const read = name => JSON.parse(fs.readFileSync(path.join(state, name), 'utf8').replace(/^\uFEFF/, ''));
const sso = read('trail-sso.json');
const admin = read('trail-credentials.json');
const authorization = `Basic ${Buffer.from(`${admin.username}:${admin.password}`).toString('base64')}`;
function request(host, headers, route = '/panel', method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:5332${route}`, { method, headers: { host, ...headers } }, res => {
      res.resume();
      resolve({ status: res.statusCode, basicChallenge: Boolean(res.headers['www-authenticate']) });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Gateway timeout')));
    req.end();
  });
}
const results = {};
for (const [name, host, headers, status] of [
  ['publicUnauth', 'trail.pydemia.ai', {}, 503],
  ['publicBasic', 'trail.pydemia.ai', { authorization }, 503],
  ['forgedIdentity', 'trail.pydemia.ai', { 'x-agent-track-trust': 'wrong', 'x-forwarded-email': sso.allowedEmails[0] }, 403],
  ['wrongAccount', 'trail.pydemia.ai', { 'x-agent-track-trust': sso.trustKey, 'x-forwarded-email': 'outsider@example.com' }, 403],
  ['trustedHop', 'trail.pydemia.ai', { 'x-agent-track-trust': sso.trustKey, 'x-forwarded-email': sso.allowedEmails[0] }, 200],
  ['localAdmin', '127.0.0.1:5332', { authorization }, 200],
]) {
  results[name] = await request(host, headers);
  assert.equal(results[name].status, status, name);
  assert.equal(results[name].basicChallenge, false, name);
}
const trusted = { 'x-agent-track-trust': sso.trustKey, 'x-forwarded-email': sso.allowedEmails[0], 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
results.idpReturnNavigation = await request('trail.pydemia.ai', trusted, '/');
assert.equal(results.idpReturnNavigation.status, 200);
results.crossSiteMutation = await request('trail.pydemia.ai', trusted, '/hook', 'POST');
assert.equal(results.crossSiteMutation.status, 403);
results.crossSiteApi = await request('trail.pydemia.ai', trusted, '/panel');
assert.equal(results.crossSiteApi.status, 403);
results.foreignOrigin = await request('trail.pydemia.ai', { ...trusted, origin: 'https://example.com' }, '/');
assert.equal(results.foreignOrigin.status, 403);
const remote = await fetch('https://trail.pydemia.ai/', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
results.publicHttps = { status: remote.status, basicChallenge: Boolean(remote.headers.get('www-authenticate')) };
assert.equal(remote.status, 302);
assert.equal(results.publicHttps.basicChallenge, false);
fs.writeFileSync(new URL('../docs/entra-verification.json', import.meta.url), JSON.stringify({ date: '2026-11-11', scope: 'Gateway boundary checks and public Entra redirect', results }, null, 2));
console.log(JSON.stringify(results));
