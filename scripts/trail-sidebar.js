(() => {
  const sidebar = document.getElementById('tree');
  const workspace = document.querySelector('.workspace');
  const status = document.querySelector('.topbar .status');
  if (!sidebar || !workspace || !status) return;
  const key = 'agent-track:trail-sidebar:v1';
  const narrow = matchMedia('(max-width:720px)');
  const maximum = () => Math.max(180, Math.min(420, narrow.matches ? innerWidth - 48 : Math.floor(innerWidth * 0.42)));
  const clamp = value => Math.max(180, Math.min(maximum(), Number.isFinite(value) ? value : 256));
  let width = 256;
  let collapsed = narrow.matches;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved === 'object') {
      width = clamp(saved.width);
      if (!narrow.matches && typeof saved.collapsed === 'boolean') collapsed = saved.collapsed;
    }
  } catch { /* Browser storage is optional; controls must still work. */ }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'at-sidebar-toggle';
  toggle.id = 'at-sidebar-toggle';
  toggle.setAttribute('aria-controls', 'tree');
  toggle.textContent = '프로젝트';
  status.prepend(toggle);
  const grip = document.createElement('div');
  grip.id = 'at-sidebar-resize';
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', '프로젝트 탐색 너비');
  grip.setAttribute('aria-controls', 'tree');
  grip.title = '드래그 또는 좌우 화살표로 너비 조절 · 두 번 클릭하면 기본 너비';
  workspace.append(grip);
  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.id = 'at-sidebar-backdrop';
  backdrop.tabIndex = -1;
  backdrop.setAttribute('aria-label', '프로젝트 탐색 닫기');
  workspace.insertBefore(backdrop, sidebar);

  const save = () => {
    try { localStorage.setItem(key, JSON.stringify({ width, collapsed })); } catch { /* Keep in-memory state. */ }
  };
  function apply() {
    width = clamp(width);
    document.documentElement.style.setProperty('--at-sidebar-width', `${width}px`);
    document.body.classList.toggle('at-sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '프로젝트 탐색 펼치기' : '프로젝트 탐색 접기');
    toggle.title = collapsed ? '프로젝트 탐색 펼치기' : '프로젝트 탐색 접기';
    grip.setAttribute('aria-valuemin', '180');
    grip.setAttribute('aria-valuemax', String(maximum()));
    grip.setAttribute('aria-valuenow', String(width));
  }
  function close() {
    collapsed = true;
    apply();
    save();
    toggle.focus();
  }
  toggle.addEventListener('click', () => { collapsed = !collapsed; apply(); save(); });
  backdrop.addEventListener('click', close);
  grip.addEventListener('dblclick', () => { width = 256; apply(); save(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !collapsed && (narrow.matches || sidebar.contains(document.activeElement))) {
      event.preventDefault();
      close();
    }
  });
  grip.addEventListener('keydown', event => {
    const values = { ArrowLeft: width - 16, ArrowRight: width + 16, Home: 180, End: maximum() };
    if (!(event.key in values)) return;
    event.preventDefault();
    width = clamp(values[event.key]);
    apply();
    save();
  });
  let pointerId = null;
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0 || narrow.matches) return;
    event.preventDefault();
    pointerId = event.pointerId;
    grip.setPointerCapture(pointerId);
    grip.focus();
    document.body.classList.add('at-sidebar-dragging');
  });
  grip.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    width = clamp(event.clientX - workspace.getBoundingClientRect().left);
    apply();
  });
  const endDrag = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    document.body.classList.remove('at-sidebar-dragging');
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    save();
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('lostpointercapture', endDrag);
  narrow.addEventListener('change', event => { if (event.matches) collapsed = true; apply(); });
  addEventListener('resize', apply);
  apply();
})();
