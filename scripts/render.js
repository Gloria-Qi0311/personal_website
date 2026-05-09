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

  // Card index keyed by display ID (e.g. SHIP-01) — populated during render,
  // consumed by the panel/hash router. Map preserves insertion order, which
  // is the visual board order (Shipped → Now → Next → Later, by render order
  // within each column), so prev/next nav can iterate the keys directly.
  const cardIndex = new Map();
  const orderedIds = () => Array.from(cardIndex.keys());

  // Tiny markdown renderer for card details. Handles: ## h2, ### h3,
  // - / * lists, paragraphs, inline `code`, **bold**, *italic*. No HTML
  // pass-through — input is escaped first.
  const mini = (md) => {
    if (!md) return '';
    const lines = escape(md).split(/\r?\n/);
    let html = '';
    let listOpen = false;
    const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { closeList(); continue; }
      const m = /^(#{2,3})\s+(.*)$/.exec(line);
      if (m) {
        closeList();
        html += `<h${m[1].length}>${m[2]}</h${m[1].length}>`;
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        if (!listOpen) { html += '<ul>'; listOpen = true; }
        html += `<li>${line.replace(/^[-*]\s+/, '')}</li>`;
        continue;
      }
      closeList();
      html += `<p>${line}</p>`;
    }
    closeList();
    return html
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  };

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

        // Stash for the detail modal — keyed by display ID
        cardIndex.set(displayId, { ...c, displayId });

        const html = `
          <button type="button" class="card" data-id="${escape(c.id)}" data-card-id="${displayId}" data-tags="${escape(tagSlugs)}" aria-label="Open details for ${escape(c.title)}">
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
          </button>`;
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

  /* ── Card detail panel ─────────────────────────────────────────── */
  const statusLabel = { shipped: 'Shipped', now: 'Now', next: 'Next', later: 'Later' };
  let currentCardId = null;

  const openCardModal = (displayId) => {
    const c = cardIndex.get(displayId);
    if (!c) return;
    currentCardId = displayId;

    const modal    = $('#card-modal');
    const backdrop = $('#modal-backdrop');
    if (!modal || !backdrop) return;

    $('#modal-id').textContent     = displayId;
    const statusEl = $('#modal-status');
    statusEl.className = 'modal-status s-' + c.status;
    statusEl.textContent = statusLabel[c.status] ?? c.status;
    $('#modal-title').textContent  = c.title ?? '';
    $('#modal-summary').textContent = c.summary ?? '';

    $('#modal-tags').innerHTML = (c.tags ?? []).map((t, i) =>
      `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`
    ).join('');

    $('#modal-details').innerHTML = mini(c.details);

    $('#modal-updated').textContent = c.updated ? `updated ${c.updated}` : '';
    $('#modal-impact').textContent  = c.impact ?? '';

    $('#modal-links').innerHTML = (c.links ?? [])
      .filter(l => l.href && l.href !== '#')
      .map((l) => `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} ↗</a>`)
      .join('');

    // Position indicator + prev/next disabled state
    const ids = orderedIds();
    const idx = ids.indexOf(displayId);
    $('#panel-position').textContent = `${idx + 1} / ${ids.length}`;
    $('#panel-prev').disabled = idx <= 0;
    $('#panel-next').disabled = idx >= ids.length - 1;

    // Reset scroll to top when navigating between cards
    const body = $('.panel-body'); if (body) body.scrollTop = 0;

    if (!document.body.classList.contains('modal-open')) {
      backdrop.hidden = false;
      // Force reflow so the slide-in transition fires from translateX(100%)
      void modal.offsetWidth;
      backdrop.classList.add('is-open');
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      // Move focus to close on first open; navigation keeps focus naturally
      $('#modal-close')?.focus();
    }

    // Sync URL hash for deep-linking; don't re-trigger open
    if (location.hash !== `#card/${displayId}`) {
      history.replaceState(null, '', `#card/${displayId}`);
    }
  };

  const closeCardModal = () => {
    const modal    = $('#card-modal');
    const backdrop = $('#modal-backdrop');
    if (!modal || !backdrop) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    currentCardId = null;
    setTimeout(() => { if (!backdrop.classList.contains('is-open')) backdrop.hidden = true; }, 250);

    if (location.hash.startsWith('#card/')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  };

  const navCard = (delta) => {
    if (!currentCardId) return;
    const ids = orderedIds();
    const idx = ids.indexOf(currentCardId);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    openCardModal(ids[nextIdx]);
  };

  const wireModal = () => {
    // Card click → open
    document.addEventListener('click', (ev) => {
      const card = ev.target.closest('.card[data-card-id]');
      if (!card) return;
      ev.preventDefault();
      openCardModal(card.dataset.cardId);
    });

    // Header buttons
    $('#modal-close')?.addEventListener('click', closeCardModal);
    $('#panel-prev') ?.addEventListener('click', () => navCard(-1));
    $('#panel-next') ?.addEventListener('click', () => navCard(+1));
    $('#modal-backdrop')?.addEventListener('click', closeCardModal);

    // Keyboard: ESC close, ↑ prev, ↓ next
    document.addEventListener('keydown', (ev) => {
      if (!document.body.classList.contains('modal-open')) return;
      if (ev.key === 'Escape')   { ev.preventDefault(); closeCardModal(); }
      if (ev.key === 'ArrowUp')  { ev.preventDefault(); navCard(-1); }
      if (ev.key === 'ArrowDown'){ ev.preventDefault(); navCard(+1); }
    });

    // Hash router: open on initial load + on navigation
    const handleHash = () => {
      const m = /^#card\/(.+)$/.exec(location.hash);
      if (m) openCardModal(m[1]);
      else if (document.body.classList.contains('modal-open')) closeCardModal();
    };
    window.addEventListener('hashchange', handleHash);
    setTimeout(handleHash, 0);

    // Cross-surface: terminal can request a card open via custom event
    document.addEventListener('agent:open-card', (ev) => {
      const id = ev.detail?.id;
      if (id) openCardModal(id);
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
      wireModal();
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
