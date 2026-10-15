#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-html.js — render content/*.json into static HTML pages.

   Pages:
     index.html           the home page ("cabinet of curiosities")
     projects/index.html  every project, with its full write-up

   Both pages are fully pre-rendered: no runtime JS is needed to read them,
   so agents and crawlers that don't execute scripts see everything.

   Home layout: top bar (label; language, dark mode, sepia toggles), a
   floating icon rail on the left, a three-column hero (name + résumé +
   roles | token-consumption stats | a message), then Projects with a pager,
   an update banner and a horizontal carousel of specimen cards, and a
   bottom-center "Ask Gloria" pill. Runtime behavior: scripts/home.js.

   Run:
     node scripts/build-html.js
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const site    = read('content/site.json');
const profile = read('content/profile.json');
const board   = read('content/board.json');
const contact = read('content/contact.json');
const home    = read('content/home.json');

/* ── Helpers ──────────────────────────────────────────────────────────── */
const escape = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const isExternal = (href) => /^https?:\/\//i.test(href ?? '');
const extAttrs = (href) => (isExternal(href) ? ' target="_blank" rel="noopener"' : '');

const absoluteUrl = (relPath) => {
  if (!relPath) return '';
  if (isExternal(relPath)) return relPath;
  const base = (site.meta?.url ?? '').replace(/\/+$/, '');
  return base ? `${base}/${relPath.replace(/^\/+/, '')}` : relPath;
};

// Site-root links ("/projects/") become relative to the page so the build
// works from any host path and from a plain static server.
const rel = (base, href) => {
  if (!href || isExternal(href) || href.startsWith('#') || href.startsWith('mailto:')) return href;
  if (href === '/') return base || './';
  return base + href.replace(/^\/+/, '');
};

const pad3 = (n) => String(n).padStart(3, '0');

// Cards in board order (order, then most recently updated).
const sortedCards = () => (board.cards ?? []).slice().sort((a, b) => {
  const ao = a.order ?? 99, bo = b.order ?? 99;
  if (ao !== bo) return ao - bo;
  return (b.updated ?? '').localeCompare(a.updated ?? '');
});

// Featured cards first (in home.json order), then everything else.
const catalogue = () => {
  const byId = new Map((board.cards ?? []).map((c) => [c.id, c]));
  const featured = (home.projects?.featured ?? []).map((id) => byId.get(id)).filter(Boolean);
  const rest = sortedCards().filter((c) => !featured.includes(c));
  return [...featured, ...rest].map((c, i) => ({ ...c, no: pad3(i + 1) }));
};

const category = (c) => {
  const first = (c.tags ?? [])[0] ?? '';
  return first.charAt(0) + first.slice(1).toLowerCase();
};
const tagLine = (c) => (c.tags ?? []).slice(1).join(' · ');

// Minimal markdown for card details: ## headings, - lists, paragraphs,
// `code`, **bold**.
const inlineMd = (s) => escape(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const markdown = (md) => {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const block of String(md ?? '').split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      if (/^##\s+/.test(line)) { flush(); out.push(`<h3>${inlineMd(line.replace(/^##\s+/, ''))}</h3>`); }
      else if (/^-\s+/.test(line)) { (list ??= []).push(`<li>${inlineMd(line.replace(/^-\s+/, ''))}</li>`); }
      else if (line.trim()) { flush(); out.push(`<p>${inlineMd(line)}</p>`); }
    }
    flush();
  }
  return out.join('\n');
};

/* ── Shared page chrome ───────────────────────────────────────────────── */
const FONTS = 'https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=IM+Fell+DW+Pica:ital@0;1&display=swap';

const personLd = () => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: `${profile.name} ${profile.nameAccent ?? ''}`.trim(),
  url: site.meta?.url,
  jobTitle: profile.role,
  description: profile.slogan,
  image: absoluteUrl(profile.avatar?.calm),
  knowsAbout: profile.tags ?? [],
  sameAs: (contact.items ?? []).map((i) => i.href).filter(isExternal),
}, null, 2);

const head = ({ base, title, description, url }) => {
  const cfToken = site.analytics?.cfAnalyticsToken?.trim();
  const ogImage = absoluteUrl(site.meta?.ogImage);
  return `<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta name="author" content="${escape(site.meta?.author)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${escape(url)}">
<meta name="theme-color" content="#ECE2CB" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1C1711" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${base}${escape(site.meta?.ogImage)}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="LLM-readable summary">
<link rel="alternate" type="text/plain" href="/llms-full.txt" title="LLM-readable full content">

<meta property="og:type" content="website">
<meta property="og:url" content="${escape(url)}">
<meta property="og:site_name" content="${escape(site.meta?.siteName)}">
<meta property="og:locale" content="${escape(site.meta?.locale)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${escape(ogImage)}">
<meta property="og:image:width" content="${escape(site.meta?.ogImageWidth)}">
<meta property="og:image:height" content="${escape(site.meta?.ogImageHeight)}">
<meta property="og:image:alt" content="${escape(profile.avatar?.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${escape(ogImage)}">

<script type="application/ld+json">${personLd()}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
<link rel="stylesheet" href="${base}styles/cabinet.css">
<script>try{var t=localStorage.getItem('cabinet-theme');if(t)document.documentElement.dataset.theme=t;if(localStorage.getItem('cabinet-sepia')==='off')document.documentElement.dataset.sepia='off';}catch(e){}</script>
${cfToken ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${escape(cfToken)}"}'></script>\n` : ''}</head>`;
};

const sprig = `<svg class="sprig" width="120" height="40" viewBox="0 0 120 40" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M5 20 Q60 4 115 20"/>${
  [20, 35, 50, 65, 80, 95].map((x, i) => `<path d="M${x} ${17 - (i % 3)} q6 -12 14 -8 q-4 9 -14 8z"/><path d="M${x + 4} 20 q6 12 14 8 q-4 -9 -14 -8z"/>`).join('')
}</svg>`;

// Line icons (24px grid, stroke = currentColor).
const ICONS = {
  home:   '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  plus:   '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  image:  '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  doc:    '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  moon:   '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  drop:   '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  left:   '<path d="M15 5l-7 7 7 7"/>',
  right:  '<path d="M9 5l7 7-7 7"/>',
  down:   '<path d="M12 5v13M6 12l6 6 6-6"/>',
};
const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

// Top bar: cabinet label on the left, language / dark mode / theme on the right.
const topbarHtml = (base) => `<header class="topbar">
    <a class="topbar-label" href="${base || './'}">${escape(home.label)}</a>
    <div class="topbar-controls">
      <div class="lang-toggle" role="group" aria-label="Language">
        <span class="is-active" aria-current="true">EN</span>
        <span class="is-forthcoming" title="Chinese version forthcoming" lang="zh">中</span>
      </div>
      <button type="button" class="round-btn" id="theme-toggle" aria-label="Toggle candlelight (dark) mode" title="Candlelight">${icon('moon', 18)}</button>
      <button type="button" class="round-btn" id="sepia-toggle" aria-label="Toggle sepia plates" aria-pressed="true" title="Sepia plates">${icon('drop', 18)}</button>
    </div>
  </header>`;

// Floating vertical icon rail on the left edge.
const railHtml = (base, current) => `<nav class="rail" aria-label="Site">
    <ul>${(home.nav ?? []).map((n) => {
      if (!n.href) return `<li><span class="rail-item is-forthcoming" title="${escape(n.label)} — forthcoming" aria-label="${escape(n.label)} (forthcoming)">${icon(n.icon)}</span></li>`;
      const here = n.href === current ? ' aria-current="page"' : '';
      return `<li><a class="rail-item" href="${escape(rel(base, n.href))}" title="${escape(n.label)}" aria-label="${escape(n.label)}"${here}>${icon(n.icon)}</a></li>`;
    }).join('')}</ul>
  </nav>`;

const footerHtml = () => {
  const links = [
    ...(contact.items ?? []).map((i) => `<a href="${escape(i.href)}"${extAttrs(i.href)}>${escape(i.key === 'email' ? i.label : i.key.charAt(0).toUpperCase() + i.key.slice(1))}</a>`),
    `<a href="/admin/">Edit</a>`,
    `<a href="/llms.txt">llms.txt</a>`,
    `<a href="https://github.com/Gloria-Qi0311/personal_website"${extAttrs('https://')}>Source</a>`,
  ];
  return `<footer class="site-footer">
    <p>${escape(site.footer?.copyright)}</p>
    <p class="footer-links">${links.join('<span aria-hidden="true"> · </span>')}</p>
  </footer>`;
};

// Bottom-center chat pill. Placeholder until the site agent lands; it fires
// a `gloria:ask` event so the chat widget can open itself from here.
const chatPillHtml = (base) => `<button type="button" class="chat-pill" id="chat-pill" title="Coming soon">
    <img src="${base}${escape(profile.avatar?.calm)}" alt="" width="32" height="32">
    <span>${escape(home.chatPrompt)}</span>
  </button>`;

const page = ({ base, current, title, description, url, main }) => `<!DOCTYPE html>
<!--
  GENERATED — do not edit by hand.
  Source of truth: content/*.json. Regenerate: \`node scripts/build.js\`
-->
<html lang="${escape(site.meta?.lang ?? 'en')}">
${head({ base, title, description, url })}
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
${railHtml(base, current)}
<div class="shell">
  ${topbarHtml(base)}
${main}
  ${footerHtml()}
</div>
${chatPillHtml(base)}
<script src="${base}scripts/home.js" defer></script>
</body>
</html>
`;

/* ── Home ─────────────────────────────────────────────────────────────── */

// The card "plate": the project's labeled fields drawn as a flow of
// specimen tags joined by arrows, like a naturalist's diagram.
const flowPlate = (c) => {
  const fields = c.fields ?? [];
  if (!fields.length) return '';
  return `<div class="flow" aria-hidden="true">${fields.map((f, i) =>
    `${i ? '<span class="flow-arrow">→</span>' : ''}<div class="flow-step"><span class="flow-label">${escape(f.label)}</span><p>${escape(f.value)}</p></div>`
  ).join('')}</div>`;
};

const specimenCard = (c) => {
  const fieldsText = (c.fields ?? []).map((f) => `<div><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('');
  return `<li class="specimen">
          <a href="projects/#${escape(c.id)}">
            <div class="specimen-plate">
              <span class="pin" aria-hidden="true"></span>
              <p class="plate-no">No. ${c.no}${c.specimen ? ` · <i>${escape(c.specimen)}</i>` : ''}</p>
              ${flowPlate(c)}
            </div>
            <div class="specimen-body">
              <p class="specimen-tags">${escape(category(c))} · ${escape(tagLine(c))}</p>
              <h3>${escape(c.title)}</h3>
              <p class="specimen-summary">${escape(c.summary)}</p>
              ${fieldsText ? `<dl class="sr-only">${fieldsText}</dl>` : ''}
            </div>
          </a>
        </li>`;
};

const usageChart = () => {
  const series = (home.usage?.series ?? []).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (!series.length) {
    return `<div class="usage-chart is-empty"><span>specimens of usage to be collected</span></div>`;
  }
  const max = Math.max(...series) || 1;
  const avg = series.reduce((a, b) => a + b, 0) / series.length;
  return `<div class="usage-chart">
          <span class="usage-avg" style="bottom:${(avg / max) * 100}%">avg</span>
          ${series.map((v) => `<i style="height:${Math.max(2, (v / max) * 100)}%"></i>`).join('')}
        </div>`;
};

const homeMain = () => {
  const all = catalogue();
  const featured = all.slice(0, (home.projects?.featured ?? []).length);
  const lines = home.nameLines?.length ? home.nameLines : [`${profile.name} ${profile.nameAccent ?? ''}`.trim()];
  const resume = (home.resume ?? []).map((r) => r.href
    ? `<a class="chip chip-strong" href="${escape(r.href)}"${extAttrs(r.href)}>${escape(r.label)} ${icon('down', 14)}</a>`
    : `<span class="chip chip-strong is-forthcoming" title="Forthcoming">${escape(r.label)} ${icon('down', 14)}</span>`).join('');
  const usageTitle = home.usage?.href
    ? `<a href="${escape(home.usage.href)}">${escape(home.usage.title)} ›</a>`
    : `${escape(home.usage?.title)} ›`;
  const p = home.projects ?? {};
  const update = p.update
    ? `<p class="update"><strong>${escape(p.updateLabel)}</strong>${p.updateDate ? ` <span class="update-date">${escape(p.updateDate)}</span>` : ''} ${escape(p.update)}</p>`
    : '';

  return `  <main id="main-content">
    <section class="hero" aria-label="Introduction">
      <div class="hero-col hero-id">
        <h1>${lines.map((l, i) => `<span class="${i ? 'name-strong' : 'name-light'}">${escape(l)}</span>`).join(' ')}</h1>
        <div class="hero-row">
          ${home.nameZh ? `<span class="name-zh" lang="zh">${escape(home.nameZh)}</span>` : ''}
          ${resume}
        </div>
        <ul class="roles">${(home.roles ?? []).map((r) => `<li class="chip">${escape(r)}</li>`).join('')}</ul>
      </div>

      <section class="hero-col hero-usage" aria-labelledby="usage-title">
        <h2 class="col-title" id="usage-title">${usageTitle}</h2>
        <dl class="usage-stats">${(home.usage?.stats ?? []).map((s) => `<div><dt>${escape(s.label)}</dt><dd>${escape(s.value)}</dd>${s.note ? `<dd class="usage-note">${escape(s.note)}</dd>` : ''}</div>`).join('')}</dl>
        ${usageChart()}
      </section>

      <section class="hero-col hero-message" aria-labelledby="message-title">
        <h2 class="col-title" id="message-title">${escape(home.message?.title)}</h2>
        <p>${escape(home.message?.body)}</p>
      </section>
    </section>

    <section class="projects" id="projects" aria-labelledby="projects-title">
      <div class="projects-head">
        <h2 id="projects-title">${escape(p.title)}</h2>
        <div class="pager">
          <span class="pager-count" id="pager-count" aria-live="polite">1–2 of ${featured.length}</span>
          <button type="button" class="round-btn" id="pager-prev" aria-label="Previous projects" disabled>${icon('left', 18)}</button>
          <button type="button" class="round-btn" id="pager-next" aria-label="Next projects">${icon('right', 18)}</button>
        </div>
      </div>
      ${update}
      <ol class="carousel" id="carousel">
        ${featured.map(specimenCard).join('\n        ')}
      </ol>
      <p class="see-all"><a href="projects/">All ${all.length} specimens in the cabinet →</a></p>
    </section>
  </main>`;
};

/* ── Projects page ────────────────────────────────────────────────────── */
const projectEntry = (c) => {
  const media = (c.media ?? []).filter((m) => m.src);
  const links = (c.links ?? []).map((l) => `<a href="${escape(l.href)}"${extAttrs(l.href)}>${escape(l.label)} ↗</a>`).join(' · ');
  return `<article class="entry" id="${escape(c.id)}">
        <header>
          <p class="specimen-no">No. ${c.no} · ${escape(category(c))} · ${escape(c.updated)}</p>
          <h2>${escape(c.title)}</h2>
          ${c.specimen ? `<p class="specimen-latin">${escape(c.specimen)}</p>` : ''}
          <p class="specimen-tags">${escape(tagLine(c))}</p>
          <p class="entry-summary">${escape(c.summary)}</p>
          ${links ? `<p class="entry-links">${links}</p>` : ''}
        </header>
        ${media.length ? `<div class="entry-plates">${media.map((m) => `<figure class="specimen-plate${/logo|avatar/.test(m.src) ? ' is-drawing' : ''}"><img src="../${escape(m.src)}" alt="${escape(m.alt)}" loading="lazy"><figcaption>${escape(m.caption)}</figcaption></figure>`).join('')}</div>` : ''}
        <div class="entry-body">${markdown(c.details)}</div>
      </article>`;
};

const projectsMain = () => {
  const all = catalogue();
  return `  <main id="main-content">
    <header class="page-title">
      <h1>The Specimens</h1>
      <p class="intro-subtitle">${all.length} works, catalogued in full</p>
    </header>
    <div class="divider" aria-hidden="true">${sprig}</div>
    <ol class="ledger">${all.map((c) => `<li><a href="#${escape(c.id)}"><span>No. ${c.no}</span><strong>${escape(c.title)}</strong><em>${escape(category(c))}</em></a></li>`).join('')}</ol>
    ${all.map(projectEntry).join('\n    ')}
  </main>`;
};

/* ── Emit ─────────────────────────────────────────────────────────────── */
const siteUrl = (site.meta?.url ?? '').replace(/\/+$/, '');
const write = (rp, html) => {
  const out = path.join(root, rp);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`✓ wrote ${rp.padEnd(20)} (${fs.statSync(out).size} bytes)`);
};

write('index.html', page({
  base: '',
  current: '/',
  title: site.meta?.title,
  description: site.meta?.description,
  url: siteUrl,
  main: homeMain(),
}));

write('projects/index.html', page({
  base: '../',
  current: '/projects/',
  title: `Specimens — ${site.meta?.siteName}`,
  description: `Every project by ${site.meta?.author}, with problem, role, decisions and outcome.`,
  url: `${siteUrl}/projects/`,
  main: projectsMain(),
}));
