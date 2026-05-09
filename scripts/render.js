/* ═══════════════════════════════════════════════════════════════════════
   RENDER — fetch content/site.json and populate the DOM, then fire a
   `site:ready` event so avatar.js and boot.js can initialize with data.

   Why this shape: scripts/avatar.js and scripts/boot.js attach listeners
   on parse but defer their work until `site:ready`. Content lives in a
   single JSON file so future edits don't touch markup.
   ═══════════════════════════════════════════════════════════════════════ */

(async function () {
  let data;
  try {
    const res = await fetch('content/site.json');
    data = await res.json();
  } catch (err) {
    console.error('[render] failed to load content/site.json', err);
    return;
  }

  document.documentElement.lang = data.meta?.lang || 'en';
  if (data.meta?.title) document.title = data.meta.title;

  renderIdentity(data.identity);
  renderSection('about', data.about, renderAbout);
  renderSection('cases', data.cases, renderCases);
  renderSection('lens', data.lens, renderLens);
  renderSection('contact', data.contact, renderContact);
  renderFooter(data.footer);
  renderAvatarChrome(data.avatar);

  window.SITE_DATA = data;
  document.dispatchEvent(new CustomEvent('site:ready', { detail: data }));
})();

function renderIdentity(identity) {
  const nameEl = document.getElementById('identity-name');
  if (nameEl) {
    nameEl.textContent = identity.name;
    if (identity.nameAccent) {
      const em = document.createElement('em');
      em.textContent = identity.nameAccent;
      nameEl.appendChild(em);
    }
  }
  setText('identity-role', identity.role);
  setText('identity-location', identity.location);
  setText('identity-status', identity.status);
}

function renderSection(key, payload, bodyRenderer) {
  if (!payload?.head) return;
  const head = document.querySelector(`[data-section="${key}"] .sec-head`);
  if (head) {
    head.innerHTML = '';
    head.appendChild(span('sec-cmd', payload.head.cmd));
    head.appendChild(span('sec-title', payload.head.title));
    if (payload.head.meta) head.appendChild(span('sec-meta', payload.head.meta));
  }
  bodyRenderer(payload);
}

function renderAbout(about) {
  const root = document.getElementById('about-body');
  if (!root) return;
  root.innerHTML = '';
  about.paragraphs.forEach(html => {
    const p = document.createElement('p');
    p.innerHTML = html;
    root.appendChild(p);
  });
}

function renderCases(cases) {
  const root = document.getElementById('cases-list');
  if (!root) return;
  root.innerHTML = '';
  cases.items.forEach(c => {
    const row = document.createElement('div');
    row.className = 'case';
    row.dataset.caseId = c.id;

    row.appendChild(div('case-id', c.id));

    const mid = document.createElement('div');
    mid.appendChild(div('case-title', c.title));
    mid.appendChild(div('case-desc', c.description));
    const tags = div('case-tags', '');
    c.tags.forEach(t => tags.appendChild(span('tag', t)));
    mid.appendChild(tags);
    row.appendChild(mid);

    const meta = document.createElement('div');
    meta.className = 'case-meta';
    meta.appendChild(document.createTextNode(c.year));
    if (c.impact) meta.appendChild(span('impact', c.impact));
    row.appendChild(meta);

    root.appendChild(row);
  });
}

function renderLens(lens) {
  const root = document.getElementById('lens-list');
  if (!root) return;
  root.innerHTML = '';
  lens.items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'lens-card';
    card.appendChild(div('lens-num', item.num));
    const text = document.createElement('div');
    text.className = 'lens-text';
    text.appendChild(document.createTextNode(item.main + ' '));
    const aside = document.createElement('em');
    aside.textContent = item.aside;
    text.appendChild(aside);
    card.appendChild(text);
    root.appendChild(card);
  });
}

function renderContact(contact) {
  const grid = document.getElementById('contact-grid');
  if (!grid) return;
  grid.innerHTML = '';
  contact.items.forEach(item => {
    grid.appendChild(div('contact-key', item.label));
    const valWrap = document.createElement('div');
    valWrap.className = 'contact-val';
    const a = document.createElement('a');
    a.href = item.href || '#';
    a.textContent = item.value;
    if (item.id) a.id = item.id;
    valWrap.appendChild(a);
    grid.appendChild(valWrap);
  });

  const input = document.getElementById('message-input');
  if (input && contact.messageInputPlaceholder) {
    input.placeholder = contact.messageInputPlaceholder;
  }
}

function renderFooter(text) {
  setText('site-footer', text);
}

function renderAvatarChrome(avatar) {
  const label = document.getElementById('avatar-label-text');
  if (label) label.textContent = avatar.label;

  const hint = document.getElementById('try-hint-keys');
  if (hint && Array.isArray(avatar.tryHint)) {
    hint.innerHTML = '';
    avatar.tryHint.forEach((k, i) => {
      if (i > 0) hint.appendChild(document.createTextNode(' '));
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      hint.appendChild(kbd);
    });
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function div(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== '') d.textContent = text;
  return d;
}
