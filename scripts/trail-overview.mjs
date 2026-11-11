// Presentation-only adaptation of the installed AgentTrail page; upstream stays unchanged.
import fs from 'node:fs';
export function overviewHtml(html) {
  const edits = [
    ['if(!expandedRoots.size&&M)expandedRoots.add(M.port)', '// Overview starts with all project roots collapsed.'],
    ["$('proj').textContent=M.session.project;renderBadge()", "$('proj').textContent='AgentTrail · '+boardsAll().length+' projects';renderBadge()"],
    ["if(M.derived)document.querySelector('.file-name').textContent='workspace / inferred from git'", "document.querySelector('.file-name').textContent='All registered projects · Codex / Claude Code local logs'"],
    ['document.title=`agenttrail · ${M.session.project}`', "document.title='AgentTrail · All projects'"],
  ];
  for (const [before, after] of edits) {
    if (!html.includes(before)) throw new Error('Installed AgentTrail page changed; overview adaptation needs review');
    html = html.replace(before, after);
  }
  const css = fs.readFileSync(new URL('./trail-sidebar.css', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('./trail-sidebar.js', import.meta.url), 'utf8');
  return html.replace('</head>', `<style id="at-sidebar-layout">${css}</style></head>`)
    .replace('</body>', `<script>${script}</script></body>`);
}
