#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-html.js — render content/*.json into static HTML pages.

   Pages:
     index.html           the home page: a chat with Gloria
     projects/index.html  every project, with its full write-up, as one page

   Home layout (three columns on desktop):
     left    profile, nav (Home, Projects, Skills, Gallery), suggested questions
     center  the chat: a welcome, then the conversation and the composer
     right   a detail panel for whatever was opened on the left (or by the
             chat). Closed on first visit; #home, #skills and #<card-id>
             open it.

   Every panel is pre-rendered, so agents and crawlers that don't execute
   scripts still read all content. Runtime behavior: scripts/app.js.

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
  return { featured, rest, all: [...featured, ...rest] };
};

const category = (c) => {
  const first = (c.tags ?? [])[0] ?? '';
  return first.charAt(0) + first.slice(1).toLowerCase();
};

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
      if (/^##\s+/.test(line)) { flush(); out.push(`<h4>${inlineMd(line.replace(/^##\s+/, ''))}</h4>`); }
      else if (/^-\s+/.test(line)) { (list ??= []).push(`<li>${inlineMd(line.replace(/^-\s+/, ''))}</li>`); }
      else if (line.trim()) { flush(); out.push(`<p>${inlineMd(line)}</p>`); }
    }
    flush();
  }
  return out.join('\n');
};

// Projects that carry a given tag (case-insensitive), for the Skills panel.
const projectsWithTag = (tag) => (board.cards ?? [])
  .filter((c) => (c.tags ?? []).slice(1).some((t) => t.toLowerCase() === tag.toLowerCase()));

/* ── Shared page chrome ───────────────────────────────────────────────── */
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap';

const personLd = () => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: `${profile.name} ${profile.nameAccent ?? ''}`.trim(),
  alternateName: home.profileName || undefined,
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
<meta name="theme-color" content="#F7F5F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1B1A17" media="(prefers-color-scheme: dark)">
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
<link rel="stylesheet" href="${base}styles/site.css">
${cfToken ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${escape(cfToken)}"}'></script>\n` : ''}</head>`;
};

// Line icons (24px grid, stroke = currentColor).
const ICONS = {
  home:   '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  spark:  '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  image:  '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  chev:   '<path d="M9 6l6 6-6 6"/>',
  send:   '<path d="M5 12h13M13 6l6 6-6 6"/>',
  x:      '<path d="M6 6l12 12M18 6L6 18"/>',
  ext:    '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  dl:     '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  menu:   '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chat:   '<path d="M4 5h16v11H9l-5 4z"/>',
  left:   '<path d="M15 5l-7 7 7 7"/>',
};
const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

const fullName = `${profile.name} ${profile.nameAccent ?? ''}`.trim();
const avatar = (base, cls, size) =>
  `<img class="${cls}" src="${base}${escape(profile.avatar?.calm)}" alt="" width="${size}" height="${size}">`;

const doc = ({ base, title, description, url, bodyClass, body }) => `<!DOCTYPE html>
<!--
  GENERATED — do not edit by hand.
  Source of truth: content/*.json. Regenerate: \`node scripts/build.js\`
-->
<html lang="${escape(site.meta?.lang ?? 'en')}">
${head({ base, title, description, url })}
<body class="${bodyClass}">
${body}
</body>
</html>
`;

/* ── Home: left sidebar ───────────────────────────────────────────────── */
const sidebarHtml = () => {
  const { featured, rest } = catalogue();
  const projectLink = (c) => `<li><a href="#${escape(c.id)}" data-open="${escape(c.id)}">${escape(c.title)}</a></li>`;
  const gallery = home.gallery ?? {};
  return `<aside class="left" id="sidebar" aria-label="Site">
  <a class="brand" href="./" data-reset>
    <span class="mark" aria-hidden="true">${escape(fullName.charAt(0))}</span>
    <span><b>${escape(fullName)}</b><small>${escape(profile.role)}</small></span>
  </a>
  <button type="button" class="newchat" id="new-chat">${icon('plus', 16)} New conversation</button>
  <div class="left-scroll">
  <nav class="nav">
    <a class="nav-item" href="#home" data-open="home">${icon('home')}<span>Home</span></a>
    <details class="nav-group" id="nav-projects" open>
      <summary class="nav-item">${icon('folder')}<span>Projects</span><span class="count">${featured.length + rest.length}</span>${icon('chev', 14)}</summary>
      <ul class="sub">${featured.map(projectLink).join('')}</ul>
      ${rest.length ? `<details class="more" id="nav-more"><summary>More<span class="count">${rest.length}</span></summary><ul class="sub">${rest.map(projectLink).join('')}</ul></details>` : ''}
    </details>
    <a class="nav-item" href="#skills" data-open="skills">${icon('spark')}<span>Skills</span></a>
    ${gallery.href
      ? `<a class="nav-item" href="${escape(gallery.href)}">${icon('image')}<span>${escape(gallery.label)}</span></a>`
      : `<span class="nav-item is-soon" aria-disabled="true">${icon('image')}<span>${escape(gallery.label ?? 'Gallery')}</span><span class="soon">soon</span></span>`}
  </nav>
  <div class="try">
    <p class="label">Try asking</p>
    ${(home.suggestions ?? []).map((q) => `<button type="button" class="try-q" data-ask="${escape(q)}">${escape(q)}</button>`).join('\n    ')}
  </div>
  </div>
  <a class="me" href="#home" data-open="home">
    ${avatar('', 'me-avatar', 38)}
    <span><b>${escape(home.profileName || fullName)}</b><small>${escape(home.profileLine)}</small></span>
    <span class="online" title="Ask me anything" aria-hidden="true"></span>
  </a>
</aside>`;
};

/* ── Home: center chat ────────────────────────────────────────────────── */
const chatHtml = () => `<main class="center" id="main-content">
  <header class="mobile-bar">
    <button type="button" class="icon-btn" id="menu-btn" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">${icon('menu', 20)}</button>
    <span>${escape(fullName)}</span>
    <a class="icon-btn" href="#home" data-open="home" aria-label="About Gloria">${avatar('', 'mini-avatar', 28)}</a>
  </header>
  <div class="scroll" id="chat-scroll">
    <section class="hello" id="hello" aria-labelledby="hello-title">
      ${avatar('', 'hello-avatar', 64)}
      <h1 id="hello-title">${(home.greeting ?? []).map((l) => `<span>${escape(l)}</span>`).join('')}</h1>
      <p>${escape(home.intro)}</p>
      <div class="chips">${(home.suggestions ?? []).map((q) => `<button type="button" class="chip" data-ask="${escape(q)}">${escape(q)}</button>`).join('')}</div>
    </section>
    <ol class="thread" id="thread" aria-live="polite" aria-label="Conversation"></ol>
  </div>
  <form class="composer" id="composer" autocomplete="off">
    <div class="box">
      <label class="sr-only" for="ask-input">${escape(home.inputPlaceholder)}</label>
      <textarea id="ask-input" rows="1" maxlength="1000" placeholder="${escape(home.inputPlaceholder)}"></textarea>
      <button type="submit" class="send" aria-label="Send">${icon('send', 18)}</button>
    </div>
    <p class="fine">${escape(home.disclaimer)}</p>
  </form>
</main>`;

/* ── Home: right panels ───────────────────────────────────────────────── */
const panelHead = (crumb) => `<div class="panel-head">
      <span class="crumb">${crumb}</span>
      <a class="icon-btn close" href="#" data-close aria-label="Close panel">${icon('x', 16)}</a>
    </div>`;

const homePanel = () => {
  const { featured } = catalogue();
  const resume = (home.resume ?? []).map((r, i) => r.href
    ? `<a class="btn${i ? ' ghost' : ''}" href="${escape(r.href)}"${extAttrs(r.href)}>${icon('dl', 15)} ${escape(r.label)}</a>`
    : `<span class="btn${i ? ' ghost' : ''} is-soon" title="Coming soon">${icon('dl', 15)} ${escape(r.label)}</span>`).join('');
  const photo = home.photo
    ? `<img class="portrait" src="${escape(home.photo)}" alt="${escape(fullName)}" loading="lazy">`
    : `<div class="portrait is-drawing">${avatar('', '', 160)}</div>`;
  return `<section class="panel" id="panel-home" data-panel="home" aria-label="About ${escape(fullName)}">
    ${panelHead('Home')}
    <div class="panel-body">
      ${photo}
      <h2>${escape(fullName)}${home.profileName && home.profileName !== fullName ? ` <small>${escape(home.profileName)}</small>` : ''}${home.nameZh ? ` <small lang="zh">${escape(home.nameZh)}</small>` : ''}</h2>
      <p class="lead">${(home.roles ?? []).map(escape).join(' · ')}</p>
      <p class="muted">${escape(profile.location)}</p>
      <div class="actions">${resume}</div>
      ${home.now ? `<h5>Now</h5><p>${escape(home.now)}</p>` : ''}
      <h5>About</h5><p>${escape(profile.manifesto)}</p>
      <h5>Featured</h5>
      <ul class="rows">${featured.map((c) => `<li><a href="#${escape(c.id)}" data-open="${escape(c.id)}"><b>${escape(c.title)}</b><span>${escape(category(c))}</span></a></li>`).join('')}</ul>
      <h5>Contact</h5>
      <ul class="rows">${(contact.items ?? []).map((i) => `<li><a href="${escape(i.href)}"${extAttrs(i.href)}><b>${escape(i.key.charAt(0).toUpperCase() + i.key.slice(1))}</b><span>${escape(i.label)}</span></a></li>`).join('')}</ul>
    </div>
  </section>`;
};

const projectPanel = (c) => {
  const media = (c.media ?? []).filter((m) => m.src && !/avatar/.test(m.src));
  const links = (c.links ?? []).filter((l) => l.href);
  return `<section class="panel" id="panel-${escape(c.id)}" data-panel="${escape(c.id)}" aria-label="${escape(c.title)}">
    ${panelHead(`Projects / ${escape(c.title)}`)}
    <div class="panel-body">
      ${media.map((m) => `<figure class="shot${/logo/.test(m.src) ? ' is-logo' : ''}"><img src="${escape(m.src)}" alt="${escape(m.alt)}" loading="lazy">${m.caption ? `<figcaption>${escape(m.caption)}</figcaption>` : ''}</figure>`).join('')}
      <p class="kicker">${escape(category(c))}${c.updated ? ` · ${escape(c.updated)}` : ''}</p>
      <h2>${escape(c.title)}</h2>
      <p class="lead">${escape(c.summary)}</p>
      ${(c.fields ?? []).length ? `<dl class="facts">${c.fields.map((f) => `<div><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('')}</dl>` : ''}
      <p class="tags">${(c.tags ?? []).slice(1).map((t) => `<span>${escape(t)}</span>`).join('')}</p>
      <div class="actions">
        ${links.map((l, i) => `<a class="btn${i ? ' ghost' : ''}" href="${escape(l.href)}"${extAttrs(l.href)}>${icon('ext', 15)} ${escape(l.label)}</a>`).join('')}
        <button type="button" class="btn ghost" data-ask="Tell me about ${escape(c.title)}">${icon('chat', 15)} Ask about this</button>
      </div>
      ${c.details ? `<div class="details">${markdown(c.details)}</div>` : ''}
    </div>
  </section>`;
};

const skillsPanel = () => {
  const groups = (home.skills?.groups ?? []).map((g) => ({
    title: g.title,
    items: (g.items ?? []).map((name) => ({ name, used: projectsWithTag(name) })),
  }));
  return `<section class="panel" id="panel-skills" data-panel="skills" aria-label="Skills">
    ${panelHead('Skills')}
    <div class="panel-body">
      <h2>Skills</h2>
      ${home.skills?.note ? `<p class="muted">${escape(home.skills.note)}</p>` : ''}
      ${groups.map((g) => `<h5>${escape(g.title)}</h5>
      <ul class="skills">${g.items.map((s) => `<li><span class="skill">${escape(s.name)}</span>${s.used.length ? `<span class="used">${s.used.map((c) => `<a href="#${escape(c.id)}" data-open="${escape(c.id)}">${escape(c.title)}</a>`).join(', ')}</span>` : ''}</li>`).join('')}</ul>`).join('\n      ')}
    </div>
  </section>`;
};

const panelsHtml = () => `<aside class="right" id="panel-host" aria-label="Details">
  ${homePanel()}
  ${skillsPanel()}
  ${catalogue().all.map(projectPanel).join('\n  ')}
</aside>
<div class="scrim" id="scrim" hidden></div>`;

// What the chat knows without the server: titles, ids and summaries for
// matching questions to panels, plus the facts the offline replies use.
const chatData = () => {
  const { all } = catalogue();
  return {
    projects: all.map((c) => ({ id: c.id, title: c.title, summary: c.summary, category: category(c), status: c.status, tags: (c.tags ?? []).slice(1) })),
    featured: home.projects?.featured ?? [],
    now: home.now ?? '',
    skills: (home.skills?.groups ?? []).map((g) => ({ title: g.title, items: g.items ?? [] })),
    contact: (contact.items ?? []).map((i) => ({ key: i.key, label: i.label, href: i.href })),
    resume: (home.resume ?? []).filter((r) => r.href),
    roles: home.roles ?? [],
  };
};

/* ── Projects page (one long page, for reading and linking) ───────────── */
const projectsPage = () => {
  const { all } = catalogue();
  const entry = (c) => {
    const media = (c.media ?? []).filter((m) => m.src && !/avatar/.test(m.src));
    const links = (c.links ?? []).filter((l) => l.href).map((l) => `<a href="${escape(l.href)}"${extAttrs(l.href)}>${escape(l.label)} ↗</a>`).join(' · ');
    return `<article class="entry" id="${escape(c.id)}">
      <p class="kicker">${escape(category(c))}${c.updated ? ` · ${escape(c.updated)}` : ''}</p>
      <h2>${escape(c.title)}</h2>
      <p class="lead">${escape(c.summary)}</p>
      ${links ? `<p class="links">${links}</p>` : ''}
      ${media.map((m) => `<figure class="shot${/logo/.test(m.src) ? ' is-logo' : ''}"><img src="../${escape(m.src)}" alt="${escape(m.alt)}" loading="lazy">${m.caption ? `<figcaption>${escape(m.caption)}</figcaption>` : ''}</figure>`).join('')}
      ${(c.fields ?? []).length ? `<dl class="facts">${c.fields.map((f) => `<div><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('')}</dl>` : ''}
      <div class="details">${markdown(c.details)}</div>
    </article>`;
  };
  return `<a class="skip-link" href="#main-content">Skip to content</a>
<header class="archive-bar"><a href="../">${icon('left', 16)} Back to the chat</a><span>${escape(fullName)}</span></header>
<main class="archive" id="main-content">
  <h1>Projects</h1>
  <p class="muted">${all.length} projects, each with the problem, my role and what came of it.</p>
  <ol class="index">${all.map((c) => `<li><a href="#${escape(c.id)}"><b>${escape(c.title)}</b><span>${escape(category(c))}</span></a></li>`).join('')}</ol>
  ${all.map(entry).join('\n  ')}
  <footer class="archive-foot">${escape(site.footer?.copyright)} · <a href="/llms.txt">llms.txt</a> · <a href="/admin/">Edit</a></footer>
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

write('index.html', doc({
  base: '',
  title: site.meta?.title,
  description: site.meta?.description,
  url: siteUrl,
  bodyClass: 'app',
  body: `<a class="skip-link" href="#ask-input">Skip to the chat</a>
${sidebarHtml()}
${chatHtml()}
${panelsHtml()}
<noscript><style>.right{display:block;position:static}.panel{display:block}.panel .close,.composer,.scrim{display:none}</style></noscript>
<script type="application/json" id="chat-data">${JSON.stringify(chatData()).replace(/</g, '\\u003c')}</script>
<script src="scripts/app.js" defer></script>`,
}));

write('projects/index.html', doc({
  base: '../',
  title: `Projects — ${site.meta?.siteName}`,
  description: `Every project by ${site.meta?.author}, with problem, role, decisions and outcome.`,
  url: `${siteUrl}/projects/`,
  bodyClass: 'page',
  body: projectsPage(),
}));
