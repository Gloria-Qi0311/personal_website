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

  const renderBoard = (board) => {
    const cards = (board.cards ?? []).slice().sort((a, b) => {
      const ao = a.order ?? 99, bo = b.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (b.updated ?? '').localeCompare(a.updated ?? '');
    });

    const cols = ['shipped', 'now', 'next', 'later'];
    cols.forEach((col) => {
      const root = document.querySelector(`[data-cards="${col}"]`);
      const countEl = document.querySelector(`[data-count="${col}"]`);
      const filtered = cards.filter((c) => c.status === col);
      countEl.textContent = filtered.length;
      root.innerHTML = '';

      if (filtered.length === 0) {
        root.insertAdjacentHTML('beforeend',
          `<div class="col-empty">no cards yet</div>`);
        return;
      }

      filtered.forEach((c) => {
        const tags = (c.tags ?? []).map((t, i) =>
          `<span class="tag${i % 2 ? ' tag-blue' : ''}">${escape(t)}</span>`
        ).join('');

        const links = (c.links ?? []).filter(l => l.href && l.href !== '#').map((l) =>
          `<a href="${escape(l.href)}" target="_blank" rel="noopener">${escape(l.label)} →</a>`
        ).join('');

        const html = `
          <div class="card" data-id="${escape(c.id)}">
            <div class="card-title">${escape(c.title)}</div>
            ${c.summary ? `<div class="card-summary">${safeRich(c.summary)}</div>` : ''}
            ${tags ? `<div class="card-tags">${tags}</div>` : ''}
            <div class="card-footer">
              <span>${escape(c.updated ?? '')}</span>
              ${c.impact ? `<span class="card-impact">${escape(c.impact)}</span>` : ''}
            </div>
            ${links ? `<div class="card-links">${links}</div>` : ''}
          </div>`;
        root.insertAdjacentHTML('beforeend', html);
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
