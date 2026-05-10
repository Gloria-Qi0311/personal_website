#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   antares-cv — print Antares Yuan's resume to your terminal.

   Fetches live content from antaresyuan.site/content/*.json so the CLI
   is always in sync with the website. Zero dependencies — uses Node's
   built-in fetch (Node 18+) and inline ANSI escape codes.

   Usage:
     npx antares-cv                show short form (one screen)
     npx antares-cv --full         include card summaries + lens asides
     npx antares-cv --json         structured JSON output (for piping)
     npx antares-cv --no-color     plain text, no ANSI

   Source: https://github.com/AntaresYuan/personal_website
   ════════════════════════════════════════════════════════════════════════ */

const SITE = process.env.ANTARES_CV_SITE || 'https://antaresyuan.site';

/* ── Args ───────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const flags = {
  full:    args.includes('--full'),
  json:    args.includes('--json'),
  noColor: args.includes('--no-color') || !process.stdout.isTTY || process.env.NO_COLOR,
  help:    args.includes('--help') || args.includes('-h'),
};

if (flags.help) {
  process.stdout.write(`
antares-cv — Antares Yuan's resume in your terminal

Usage:
  npx antares-cv [options]

Options:
  --full       Include card summaries and lens asides
  --json       Structured JSON output (for piping)
  --no-color   Plain text, no ANSI colors
  --help, -h   Show this help

Source: https://github.com/AntaresYuan/personal_website
Live:   https://antaresyuan.site
`);
  process.exit(0);
}

/* ── ANSI helpers ───────────────────────────────────────────────────── */
const ESC = '\x1b[';
const c = (code, text) => flags.noColor ? text : `${ESC}${code}m${text}${ESC}0m`;

const bold    = (s) => c('1',     s);
const dim     = (s) => c('2',     s);
const italic  = (s) => c('3',     s);
const yellow  = (s) => c('33',    s);
const blue    = (s) => c('34',    s);
const green   = (s) => c('32',    s);
const red     = (s) => c('31',    s);
const cyan    = (s) => c('36',    s);
const magenta = (s) => c('35',    s);

/* ── Fetch ──────────────────────────────────────────────────────────── */
const fetchJson = async (path) => {
  const res = await fetch(`${SITE}${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

/* ── Card sort + display ID (mirrors website) ──────────────────────── */
const ID_PREFIX = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
const pad2 = (n) => String(n).padStart(2, '0');

const allCards = (board) => {
  const cards = (board.cards ?? []).slice().sort((a, b) => {
    const ao = a.order ?? 99, bo = b.order ?? 99;
    if (ao !== bo) return ao - bo;
    return (b.updated ?? '').localeCompare(a.updated ?? '');
  });
  const out = [];
  ['shipped', 'now', 'next', 'later'].forEach((col) => {
    cards.filter(c => c.status === col).forEach((card, i) => {
      out.push({ ...card, displayId: `${ID_PREFIX[col]}-${pad2(i + 1)}` });
    });
  });
  return out;
};

/* ── Render ─────────────────────────────────────────────────────────── */
const cols = process.stdout.columns || 80;
const rule = (label) => {
  const tag = ` ${label.toUpperCase()} `;
  const remain = Math.max(2, Math.min(cols, 60) - tag.length - 4);
  return dim('─── ') + bold(tag) + dim('─'.repeat(remain));
};

const renderHero = (profile) => {
  const lines = [];
  const fullName = `${profile.name ?? ''}${profile.nameAccent ? ' ' + profile.nameAccent : ''}`;
  lines.push(bold(yellow(fullName.trim().toUpperCase())));
  if (profile.slogan) lines.push(italic(profile.slogan));
  lines.push('');
  const sub = [profile.role, profile.location].filter(Boolean).join('  ·  ');
  if (sub) lines.push(dim(sub));
  if (profile.status) lines.push(dim('● ') + green(profile.status));
  if (profile.tags?.length) lines.push(dim('tags  ') + profile.tags.join(' · '));
  return lines.join('\n');
};

const renderCards = (cards, status, { full }) => {
  const list = cards.filter(c => c.status === status);
  if (list.length === 0) return null;
  const lines = [rule(status)];
  const idWidth = Math.max(...list.map(c => c.displayId.length));
  list.forEach(card => {
    const id = bold(yellow(card.displayId.padEnd(idWidth)));
    const title = card.title ?? '';
    const impact = card.impact ? '  ' + green(card.impact) : '';
    const date = card.updated ? '  ' + dim(card.updated) : '';
    lines.push(`${id}  ${title}${impact}${date}`);
    if (full && card.summary) {
      lines.push(' '.repeat(idWidth + 2) + dim(card.summary));
    }
    if (full && card.tags?.length) {
      lines.push(' '.repeat(idWidth + 2) + dim('  ' + card.tags.join(', ')));
    }
  });
  return lines.join('\n');
};

const renderLens = (lens, { full }) => {
  const items = lens.items ?? [];
  if (!items.length) return null;
  const lines = [rule('lens')];
  items.forEach(it => {
    const num = bold(yellow((it.num ?? '').padEnd(5)));
    lines.push(`${num} ${it.main ?? ''}`);
    if (full && it.aside) lines.push('      ' + dim(italic(it.aside)));
  });
  return lines.join('\n');
};

const renderContact = (contact) => {
  const items = contact.items ?? [];
  if (!items.length) return null;
  const lines = [rule('contact')];
  const keyWidth = Math.max(...items.map(i => (i.key ?? '').length));
  items.forEach(it => {
    const key = dim((it.key ?? '').padEnd(keyWidth));
    const link = blue(it.label ?? '');
    const url  = it.href && it.href !== '#' && it.label !== it.href
      ? '  ' + dim(`(${it.href})`) : '';
    lines.push(`  ${key}  ${link}${url}`);
  });
  return lines.join('\n');
};

const renderFooter = (site) => {
  const lines = ['', dim(`→ live   ${SITE}`), dim(`→ source github.com/AntaresYuan/personal_website`)];
  if (site.footer?.lastUpdated) lines.push(dim(`  last updated ${site.footer.lastUpdated}`));
  return lines.join('\n');
};

/* ── Main ───────────────────────────────────────────────────────────── */
(async () => {
  let site, profile, board, lens, contact;
  try {
    [site, profile, board, lens, contact] = await Promise.all([
      fetchJson('/content/site.json'),
      fetchJson('/content/profile.json'),
      fetchJson('/content/board.json'),
      fetchJson('/content/lens.json'),
      fetchJson('/content/contact.json'),
    ]);
  } catch (e) {
    process.stderr.write(red(`failed to fetch resume: ${e.message}\n`));
    process.stderr.write(dim(`(set ANTARES_CV_SITE to override host)\n`));
    process.exit(1);
  }

  if (flags.json) {
    const cards = allCards(board);
    const out = {
      profile,
      board: {
        shipped: cards.filter(c => c.status === 'shipped'),
        now:     cards.filter(c => c.status === 'now'),
        next:    cards.filter(c => c.status === 'next'),
        later:   cards.filter(c => c.status === 'later'),
      },
      lens: lens.items ?? [],
      contact: contact.items ?? [],
      meta: { site: SITE, lastUpdated: site.footer?.lastUpdated ?? null },
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  const cards = allCards(board);
  const sections = [
    renderHero(profile),
    renderCards(cards, 'shipped', flags),
    renderCards(cards, 'now',     flags),
    renderCards(cards, 'next',    flags),
    renderCards(cards, 'later',   flags),
    renderLens(lens, flags),
    renderContact(contact),
    renderFooter(site),
  ].filter(Boolean);

  process.stdout.write('\n' + sections.join('\n\n') + '\n\n');
})();
