#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-html.js — render content/*.json into static HTML pages.

   Pages:
     index.html           the home page ("cabinet of curiosities")
     projects/index.html  every project, with its full write-up

   Both pages are fully pre-rendered: no runtime JS is needed to read them,
   so agents and crawlers that don't execute scripts see everything.

   Home structure (top to bottom): masthead label + nav, intro (portrait,
   name, résumé links, roles), token-consumption stats, a message, the
   projects list with an update note, footer, decorative farewell image.

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
<meta name="theme-color" content="#ECE2CB">
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
${cfToken ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${escape(cfToken)}"}'></script>\n` : ''}</head>`;
};

const sprig = `<svg class="sprig" width="120" height="40" viewBox="0 0 120 40" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M5 20 Q60 4 115 20"/>${
  [20, 35, 50, 65, 80, 95].map((x, i) => `<path d="M${x} ${17 - (i % 3)} q6 -12 14 -8 q-4 9 -14 8z"/><path d="M${x + 4} 20 q6 12 14 8 q-4 -9 -14 -8z"/>`).join('')
}</svg>`;

const navHtml = (base, current) => `<nav class="masthead-nav" aria-label="Site">
      <ul>${(home.nav ?? []).map((n) => {
        if (!n.href) return `<li><span class="is-forthcoming" title="Forthcoming">${escape(n.label)}</span></li>`;
        const here = n.href === current ? ' aria-current="page"' : '';
        return `<li><a href="${escape(rel(base, n.href))}"${here}>${escape(n.label)}</a></li>`;
      }).join('')}</ul>
    </nav>`;

const footerHtml = (base) => {
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

const page = ({ base, current, title, description, url, main }) => `<!DOCTYPE html>
<!--
  GENERATED — do not edit by hand.
  Source of truth: content/*.json. Regenerate: \`node scripts/build.js\`
-->
<html lang="${escape(site.meta?.lang ?? 'en')}">
${head({ base, title, description, url })}
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="cabinet">
  <header class="masthead">
    <p class="masthead-label">${escape(home.label)}</p>
    ${navHtml(base, current)}
  </header>
${main}
  ${footerHtml(base)}
</div>
${home.farewell ? `<img class="farewell" src="${base}${escape(home.farewell)}" alt="" width="140" height="140" loading="lazy">` : ''}
</body>
</html>
`;

/* ── Home ─────────────────────────────────────────────────────────────── */
const specimenCard = (c) => {
  const media = (c.media ?? []).find((m) => m.src);
  const plate = media
    ? `<div class="specimen-plate${/logo|avatar/.test(media.src) ? ' is-drawing' : ''}"><img src="${escape(media.src)}" alt="${escape(media.alt)}" loading="lazy"></div>`
    : '';
  const fields = (c.fields ?? []).length
    ? `<dl class="specimen-fields">${c.fields.map((f) => `<div><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('')}</dl>`
    : '';
  return `<li class="specimen">
          <a href="projects/#${escape(c.id)}">
            ${plate}
            <div class="specimen-label">
              <span class="pin" aria-hidden="true"></span>
              <p class="specimen-no">No. ${c.no} · ${escape(category(c))}</p>
              <h3>${escape(c.title)}</h3>
              ${c.specimen ? `<p class="specimen-latin">${escape(c.specimen)}</p>` : ''}
            </div>
            <p class="specimen-tags">${escape(tagLine(c))}</p>
            <p class="specimen-summary">${escape(c.summary)}</p>
            ${fields}
          </a>
        </li>`;
};

const homeMain = () => {
  const name = `${profile.name} ${profile.nameAccent ?? ''}`.trim();
  const all = catalogue();
  const featured = all.slice(0, (home.projects?.featured ?? []).length);
  const resume = (home.resume ?? []).map((r) => r.href
    ? `<a href="${escape(r.href)}"${extAttrs(r.href)}>${escape(r.label)}</a>`
    : `<span class="is-forthcoming" title="Forthcoming">${escape(r.label)}</span>`).join('');
  const usageTitle = home.usage?.href
    ? `<a href="${escape(home.usage.href)}">${escape(home.usage.title)}</a>`
    : escape(home.usage?.title);
  const update = home.projects?.update
    ? `<p class="update"><span class="update-label">${escape(home.projects.updateLabel)}</span> ${escape(home.projects.update)}</p>`
    : '';

  return `  <main id="main-content">
    <header class="intro">
      <figure class="portrait">
        <div class="portrait-oval"><img src="${escape(profile.avatar?.calm)}" alt="${escape(profile.avatar?.alt)}" width="300" height="380" fetchpriority="high"></div>
        <figcaption>${escape(home.portraitCaption)}</figcaption>
      </figure>
      <div class="intro-text">
        <h1>${escape(name)}</h1>
        ${home.nameZh ? `<p class="name-zh" lang="zh">${escape(home.nameZh)}</p>` : ''}
        <p class="intro-subtitle">${escape(home.subtitle)}</p>
        ${resume ? `<p class="resume-links">${resume}</p>` : ''}
        <ul class="roles">${(home.roles ?? []).map((r) => `<li>${escape(r)}</li>`).join('')}</ul>
      </div>
    </header>

    <div class="divider" aria-hidden="true">${sprig}</div>

    <section class="usage" aria-labelledby="usage-title">
      <h2 id="usage-title">${usageTitle}</h2>
      <dl class="usage-stats">${(home.usage?.stats ?? []).map((s) => `<div><dt>${escape(s.label)}</dt><dd>${escape(s.value)}</dd></div>`).join('')}</dl>
    </section>

    <section class="message" aria-labelledby="message-title">
      <h2 id="message-title">${escape(home.message?.title)}</h2>
      <p>${escape(home.message?.body)}</p>
    </section>

    <section class="projects" id="projects" aria-labelledby="projects-title">
      <h2 id="projects-title">${escape(home.projects?.title)}</h2>
      ${update}
      <ol class="specimens">
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
