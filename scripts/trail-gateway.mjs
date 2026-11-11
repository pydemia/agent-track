import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { overviewHtml } from './trail-overview.mjs';

const stateDir = path.join(os.homedir(), '.local', 'share', 'agent-track');
const credentialPath = path.join(stateDir, 'trail-credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialPath, 'utf8').replace(/^\uFEFF/, ''));
const sso = JSON.parse(fs.readFileSync(path.join(stateDir, 'trail-sso.json'), 'utf8').replace(/^\uFEFF/, ''));
const digest = value => crypto.createHash('sha256').update(value).digest();
const expected = digest(`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`);
const origin = 'https://trail.pydemia.ai';
const server = http.createServer((req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  if (!['trail.pydemia.ai', '127.0.0.1:5332'].includes(req.headers.host)) {
    res.writeHead(403); return res.end('Host denied.');
  }
  const isLocalAdmin = req.headers.host === '127.0.0.1:5332';
  if (isLocalAdmin) {
    if (!crypto.timingSafeEqual(expected, digest(req.headers.authorization || ''))) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="AgentTrail local admin", charset="UTF-8"' });
      return res.end('Local administrator authentication required.');
    }
  } else {
    const trusted = crypto.timingSafeEqual(digest(sso.trustKey), digest(req.headers['x-agent-track-trust'] || ''));
    const email = String(req.headers['x-forwarded-email'] || '').toLowerCase();
    if (!trusted || !sso.allowedEmails.includes(email)) {
      res.writeHead(req.headers['x-agent-track-trust'] ? 403 : 503);
      return res.end('Microsoft Entra ID sign-in setup is pending. Public username/password sign-in is disabled.');
    }
  }
  if (req.headers.origin && req.headers.origin !== origin) {
    res.writeHead(403); return res.end('Origin denied.');
  }
  // The IdP callback redirect retains cross-site metadata until the document loads.
  // Permit only an authenticated top-level GET of the home page, never mutations.
  const isHomeNavigation = req.method === 'GET'
    && new URL(req.url, origin).pathname === '/'
    && req.headers['sec-fetch-mode'] === 'navigate'
    && req.headers['sec-fetch-dest'] === 'document';
  if (req.headers['sec-fetch-site'] === 'cross-site' && !isHomeNavigation) {
    res.writeHead(403); return res.end('Cross-site request denied.');
  }
  const headers = { ...req.headers, host: '127.0.0.1:5330' };
  delete headers.authorization;
  delete headers['cf-access-jwt-assertion'];
  delete headers['x-agent-track-trust'];
  delete headers['x-forwarded-email'];
  delete headers['x-forwarded-user'];
  delete headers['x-forwarded-access-token'];
  if (headers.origin) headers.origin = 'http://127.0.0.1:5330';
  const upstream = http.request({ hostname: '127.0.0.1', port: 5330, path: req.url, method: req.method, headers }, response => {
    if (req.method === 'GET' && new URL(req.url, origin).pathname === '/' && response.headers['content-type']?.includes('text/html')) {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          const html = overviewHtml(Buffer.concat(chunks).toString('utf8'));
          const outgoing = { ...response.headers, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(html) };
          delete outgoing['transfer-encoding'];
          res.writeHead(response.statusCode, outgoing).end(html);
        } catch {
          if (!res.headersSent) res.writeHead(502);
          res.end('AgentTrail overview adapter requires an update.');
        }
      });
      response.on('error', () => res.destroy());
      return;
    }
    res.writeHead(response.statusCode, { ...response.headers, 'cache-control': 'no-store' });
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Local AgentTrail is unavailable.');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});

let ssh;
let stopping = false;
function connect() {
  if (stopping) return;
  ssh = spawn('ssh.exe', ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=10', '-R', '127.0.0.1:14332:127.0.0.1:5332', 'pydemia-server'], { windowsHide: true, stdio: 'ignore' });
  ssh.on('error', () => {});
  ssh.on('close', () => { if (!stopping) setTimeout(connect, 5000); });
}
server.listen(5332, '127.0.0.1', () => {
  fs.writeFileSync(path.join(stateDir, 'gateway.pid'), String(process.pid));
  connect();
  console.log('AgentTrail Entra gateway listening on loopback:5332; Basic is local-admin only');
});
function stop() { stopping = true; ssh?.kill(); server.close(); setTimeout(() => process.exit(0), 500).unref(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
