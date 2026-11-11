import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const config = JSON.parse(fs.readFileSync(new URL('../deploy/trail-projects.json', import.meta.url)));
const expected = config.projects;
const rows = [];
for (const project of expected) {
  const response = await fetch(`http://127.0.0.1:${project.port}/whoami`, { signal: AbortSignal.timeout(3000) });
  const who = await response.json();
  assert.equal(who.project, project.name);
  assert.equal(who.port, project.port);
  rows.push({ project: project.name, port: project.port });
}
let world = [];
for (let attempt = 0; attempt < 20; attempt++) {
  world = await (await fetch('http://127.0.0.1:5330/world', { signal: AbortSignal.timeout(4000) })).json();
  if (expected.every(p => world.some(b => b.project === p.name && b.port === p.port))) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
for (const project of expected) assert.ok(world.some(b => b.project === project.name && b.port === project.port), `Missing aggregate board: ${project.name}`);
const credentials = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local/share/agent-track/trail-credentials.json'), 'utf8').replace(/^\uFEFF/, ''));
const response = await fetch('http://127.0.0.1:5332/', { headers: { authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` } });
assert.equal(response.status, 200);
const html = await response.text();
assert.ok(html.includes('AgentTrail · All projects'));
assert.ok(html.includes('All registered projects'));
const result = { date: '2026-11-11', expectedBoards: expected.length, observedBoards: world.length, configuredBoards: rows, aggregate: world.map(b => ({ project: b.project, port: b.port, observedRuns: b.runs?.length || 0 })), overviewHeading: true, sourceCodeModified: false, historyCoverage: 'AgentTrail native recent local logs; not all saved chats' };
fs.writeFileSync(new URL('../docs/multirepo-verification.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
