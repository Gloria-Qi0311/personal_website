/* ═══════════════════════════════════════════════════════════════════════
   BOOT SEQUENCE
   ═══════════════════════════════════════════════════════════════════════ */
const bootLines = [
  { t: 'init session …',           cls: '' },
  { t: 'loading profile.json',     cls: '' },
  { t: 'eval suite passed',        cls: 'ok' },
  { t: 'avatar mounted ',          cls: 'ok' },
  { t: 'launch →',                 cls: 'arrow' },
];
const bootEl = document.getElementById('boot');
bootLines.forEach((line, i) => {
  const d = document.createElement('div');
  d.className = 'boot-line';
  d.style.animationDelay = (i * 0.18 + 0.1) + 's';
  const sym = line.cls === 'ok'    ? '<span class="ok">[ ok ]</span> '
            : line.cls === 'arrow' ? '<span class="arrow">→</span> '
            :                        '<span style="color:var(--text-faint)">[ .. ]</span> ';
  d.innerHTML = sym + line.t;
  bootEl.appendChild(d);
});
