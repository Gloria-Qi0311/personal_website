/* ════════════════════════════════════════════════════════════════════════
   home.js — small runtime for the pre-rendered pages:
   - candlelight (dark) mode and sepia-plate toggles, remembered per browser
   - the Projects carousel pager ("1–2 of 5", prev/next)
   - the "Ask Gloria" pill, which announces itself for the chat widget
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  const root = document.documentElement;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // ── Candlelight mode ────────────────────────────────────────────────
  const themeBtn = document.getElementById('theme-toggle');
  const isDark = () => root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const syncTheme = () => themeBtn?.setAttribute('aria-pressed', String(isDark()));
  themeBtn?.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    store.set('cabinet-theme', root.dataset.theme);
    syncTheme();
  });
  syncTheme();

  // ── Sepia plates ────────────────────────────────────────────────────
  const sepiaBtn = document.getElementById('sepia-toggle');
  const syncSepia = () => sepiaBtn?.setAttribute('aria-pressed', String(root.dataset.sepia !== 'off'));
  sepiaBtn?.addEventListener('click', () => {
    if (root.dataset.sepia === 'off') delete root.dataset.sepia; else root.dataset.sepia = 'off';
    store.set('cabinet-sepia', root.dataset.sepia === 'off' ? 'off' : 'on');
    syncSepia();
  });
  syncSepia();

  // ── Carousel pager ──────────────────────────────────────────────────
  const track = document.getElementById('carousel');
  const prev = document.getElementById('pager-prev');
  const next = document.getElementById('pager-next');
  const count = document.getElementById('pager-count');
  if (track) {
    const cards = [...track.children];
    const step = () => (cards[1] ? cards[1].offsetLeft - cards[0].offsetLeft : track.clientWidth);
    const update = () => {
      const s = step();
      const first = Math.round(track.scrollLeft / s);
      const visible = Math.max(1, Math.floor((track.clientWidth + 24) / s));
      const last = Math.min(cards.length, first + visible);
      count.textContent = `${first + 1}${last > first + 1 ? `–${last}` : ''} of ${cards.length}`;
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    };
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
    track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    addEventListener('resize', update);
    update();
  }

  // ── Ask pill ────────────────────────────────────────────────────────
  // The site agent's chat widget listens for this event and opens itself.
  document.getElementById('chat-pill')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('gloria:ask'));
  });
})();
