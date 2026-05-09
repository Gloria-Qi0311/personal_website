/* ════════════════════════════════════════════════════════════════════════
   render.js — fetches /content/*.json and populates the dashboard.
   Single source of truth: content files. CMS edits commit those files;
   a redeploy (or live reload in dev) reflects the changes.
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  const $ = (sel) => document.querySelector(sel);

  const escape = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  // Allow the small set of inline tags we use in copy (em, strong, br).
  const safeRich = (s) => {
    return escape(s).replace(/&lt;(\/?(em|strong|br)\s*\/?)&gt;/gi, '<$1>');
  };

  const json = async (path) => {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  };

  /* ── Renderers ──────────────────────────────────────────────────── */

  const renderMeta = (site) => {
    document.title = site.meta?.title ?? document.title;
    if (site.meta?.lang) document.documentElement.lang = site.meta.lang;
    if (site.meta?.description) {
      const m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', site.meta.description);
    }
    $('#brand-name').textContent = site.meta?.title?.split('—')[0]?.trim() ?? '';
    $('#last-updated').textContent = site.footer?.lastUpdated
      ? `updated ${site.footer.lastUpdated}`
      : '';
    $('#footer-copyright').innerHTML = [
      escape(site.footer?.copyright ?? ''),
      site.footer?.tagline ? `<em>${escape(site.footer.tagline)}</em>` : '',
    ].filter(Boolean).join(' · ');
  };

  const renderHero = (profile) => {
    // Avatar — calm by default; talking on hover/focus/tap.
    if (profile.avatar) {
      const calm    = $('#avatar-calm');
      const talking = $('#avatar-talking');
      if (calm)    { calm.src = profile.avatar.calm    ?? ''; calm.alt = profile.avatar.alt ?? ''; }
      if (talking) { talking.src = profile.avatar.talking ?? ''; }
      const wrap = $('#hero-avatar');
      if (wrap) {
        // Tap toggle for touch devices (hover doesn't fire there).
        wrap.addEventListener('click', () => {
          wrap.classList.toggle('is-talking');
          // Auto-revert after a beat so it doesn't stick if forgotten
          clearTimeout(wrap._revertTimer);
          if (wrap.classList.contains('is-talking')) {
            wrap._revertTimer = setTimeout(() => wrap.classList.remove('is-talking'), 1800);
          }
        });
      }
    }

    const accent = profile.nameAccent
      ? ` <em>${escape(profile.nameAccent)}</em>`
      : '';
    $('#hero-name').innerHTML = escape(profile.name) + accent;
    $('#hero-slogan').textContent = profile.slogan ?? '';

    const meta = $('#hero-meta');
    meta.innerHTML = '';
    if (profile.role) {
      meta.insertAdjacentHTML('beforeend', `<span>${escape(profile.role)}</span>`);
    }
    if (profile.location) {
      meta.insertAdjacentHTML('beforeend', `<span class="sep">·</span><span>${escape(profile.location)}</span>`);
    }
    if (profile.status) {
      meta.insertAdjacentHTML('beforeend',
        `<span class="sep">·</span><span class="now-pill"><span class="pulse"></span>${escape(profile.status)}</span>`);
    }
    (profile.tags ?? []).forEach((t) => {
      meta.insertAdjacentHTML('beforeend', `<span class="pill">${escape(t)}</span>`);
    });

    const ctas = $('#hero-ctas');
    ctas.innerHTML = '';
    (profile.ctas ?? []).forEach((c) => {
      const a = document.createElement('a');
      a.className = 'cta';
      a.href = c.anchor || '#';
      a.innerHTML = `
        <div>
          <div class="cta-label">${escape(c.audience ?? '')}</div>
          <div class="cta-text">${escape(c.label ?? '')}</div>
        </div>
        <span class="cta-arrow">→</span>`;
      ctas.appendChild(a);
    });
  };

  // Status → ID prefix used for the Linear-style "SHIP-01" badge on each card.
  const idPrefix = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
  const pad2 = (n) => String(n).padStart(2, '0');

  const renderBoard = (board) => {
    const cards = (board.cards ?? []).slice().sort((a, b) => {
      const ao = a.order ?? 99, bo = b.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (b.updated ?? '').localeCompare(a.updated ?? '');
    });

    const cols = ['shipped', 'now', 'next', 'later'];
    let total = 0;
    let shippedCount = 0;

    cols.forEach((col) => {
      const root = document.querySelector(`[data-cards="${col}"]`);
      const countEl = document.querySelector(`[data-count="${col}"]`);
      const filtered = cards.filter((c) => c.status === col);
      countEl.textContent = filtered.length;
      total += filtered.length;
      if (col === 'shipped') shippedCount = filtered.length;
      root.innerHTML = '';

      if (filtered.length === 0) {
        root.insertAdjacentHTML('beforeend',
          `<div class="col-empty">no cards yet</div>`);
        return;
      }

      filtered.forEach((c, idx) => {
        const tags = (c.tags ?? []).map((t, i) =>
          `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`
        ).join('');

        const links = (c.links ?? []).filter(l => l.href && l.href !== '#').map((l) =>
          `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`
        ).join('');

        const displayId = `${idPrefix[col]}-${pad2(idx + 1)}`;
        const tagSlugs = (c.tags ?? []).map((t) => t.toLowerCase()).join('|');

        const html = `
          <div class="card" data-id="${escape(c.id)}" data-tags="${escape(tagSlugs)}">
            <div class="card-meta-top">
              <span class="card-id">${displayId}</span>
              <span class="card-handle" aria-hidden="true">⋮⋮</span>
            </div>
            <div class="card-title">${escape(c.title)}</div>
            ${c.summary ? `<div class="card-summary">${safeRich(c.summary)}</div>` : ''}
            ${tags ? `<div class="card-tags">${tags}</div>` : ''}
            <div class="card-footer">
              <span class="card-footer-left">
                <span>${escape(c.updated ?? '')}</span>
                <span class="card-comments">0</span>
              </span>
              ${c.impact ? `<span class="card-impact">${escape(c.impact)}</span>` : ''}
            </div>
            ${links ? `<div class="card-links">${links}</div>` : ''}
          </div>`;
        root.insertAdjacentHTML('beforeend', html);
      });
    });

    // Toolbar counts
    const totalEl = document.getElementById('board-total-count');
    const shippedEl = document.getElementById('board-shipped-count');
    if (totalEl) totalEl.textContent = total;
    if (shippedEl) shippedEl.textContent = `${shippedCount} shipped`;

    // Filter chips: derive top tags across all cards
    renderFilterChips(cards);
  };

  const renderFilterChips = (cards) => {
    const root = document.getElementById('board-filters');
    if (!root) return;

    // Count tag frequency, keep top 6.
    const counts = new Map();
    cards.forEach((c) => (c.tags ?? []).forEach((t) => {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }));
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);

    // Append tag chips after the existing "All" chip
    root.querySelectorAll('[data-filter]:not([data-filter="all"])').forEach(n => n.remove());

    // Initialize aria-pressed on the always-present "All" chip
    const allChip = root.querySelector('[data-filter="all"]');
    if (allChip) allChip.setAttribute('aria-pressed', 'true');

    top.forEach((tag) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-chip';
      b.dataset.filter = tag.toLowerCase();
      b.setAttribute('aria-pressed', 'false');
      b.textContent = tag;
      root.appendChild(b);
    });

    // Click handler: filter cards by tag (idempotent — re-attaching is fine)
    root.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.filter-chip');
      if (!chip) return;
      root.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.remove('is-active');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('is-active');
      chip.setAttribute('aria-pressed', 'true');
      const f = chip.dataset.filter;
      document.querySelectorAll('.card').forEach((card) => {
        if (f === 'all') {
          card.classList.remove('is-filtered');
        } else {
          const tags = (card.dataset.tags || '').split('|');
          card.classList.toggle('is-filtered', !tags.includes(f));
        }
      });
    });
  };

  const renderLens = (lens) => {
    if (lens.head) {
      $('#lens-cmd').textContent  = lens.head.cmd  ?? '';
      $('#lens-title').textContent = lens.head.title ?? '';
      $('#lens-meta').textContent  = lens.head.meta  ?? '';
    }
    const list = $('#lens-list');
    list.innerHTML = '';
    (lens.items ?? []).forEach((it) => {
      const aside = it.aside ? `<em>${escape(it.aside)}</em>` : '';
      list.insertAdjacentHTML('beforeend', `
        <div class="lens-card">
          <div class="lens-num">${escape(it.num ?? '')}</div>
          <div class="lens-text">${escape(it.main ?? '')}${aside}</div>
        </div>`);
    });
  };

  const renderContact = (contact) => {
    if (contact.head) {
      $('#contact-cmd').textContent  = contact.head.cmd  ?? '';
      $('#contact-title').textContent = contact.head.title ?? '';
    }
    $('#contact-intro').innerHTML = safeRich(contact.intro ?? '');

    const list = $('#contact-list');
    list.innerHTML = '';
    (contact.items ?? []).forEach((it) => {
      const a = document.createElement('a');
      a.href = it.href ?? '#';
      if (it.href?.startsWith('http')) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      a.innerHTML = `<span class="key">${escape(it.key ?? '')}</span><span>${escape(it.label ?? '')}</span>`;
      list.appendChild(a);
    });
  };

  /* ── Boot ───────────────────────────────────────────────────────── */
  (async () => {
    try {
      const [site, profile, board, lens, contact] = await Promise.all([
        json('content/site.json'),
        json('content/profile.json'),
        json('content/board.json'),
        json('content/lens.json'),
        json('content/contact.json'),
      ]);
      renderMeta(site);
      renderHero(profile);
      renderBoard(board);
      renderLens(lens);
      renderContact(contact);
    } catch (e) {
      console.error('[render]', e);
      const main = document.querySelector('main');
      if (main) {
        main.insertAdjacentHTML('afterbegin',
          `<div style="padding:16px;background:#FFE56B;border-radius:6px;font-family:monospace;font-size:13px;">
            content load failed — check that /content/*.json files exist and are valid JSON. error: ${escape(e.message)}
           </div>`);
      }
    }
  })();
})();
