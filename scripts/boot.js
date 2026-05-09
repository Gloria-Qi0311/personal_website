/* ═══════════════════════════════════════════════════════════════════════
   BOOT SEQUENCE — populated from content/site.json via the
   `site:ready` event dispatched by render.js.
   ═══════════════════════════════════════════════════════════════════════ */

document.addEventListener('site:ready', (e) => {
  const bootLines = e.detail?.boot;
  const bootEl = document.getElementById('boot');
  if (!bootLines || !bootEl) return;

  bootLines.forEach((line, i) => {
    const d = document.createElement('div');
    d.className = 'boot-line';
    d.style.animationDelay = (i * 0.18 + 0.1) + 's';
    const sym = line.kind === 'ok'    ? '<span class="ok">[ ok ]</span> '
              : line.kind === 'arrow' ? '<span class="arrow">→</span> '
              :                         '<span style="color:var(--text-faint)">[ .. ]</span> ';
    d.innerHTML = sym + line.text;
    bootEl.appendChild(d);
  });
});
