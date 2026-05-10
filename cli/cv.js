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

// Strip the small set of inline tags the website allows (em / strong / br)
// so contact.intro etc. render cleanly in plain text.
const stripTags = (s) => String(s ?? '')
  .replace(/<\/?(em|strong)>/gi, '')
  .replace(/<br\s*\/?>/gi, ' ')
  .trim();

// Wrap a long string to a max width, indented by `pad` on continuation lines.
const wrap = (s, width, pad = '') => {
  if (!s) return '';
  const words = s.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l, i) => (i === 0 ? '' : pad) + l).join('\n');
};

// Status → glyph used as a left-margin marker on every card line.
const STATUS_GLYPH = {
  shipped: green('✓'),
  now:     yellow('→'),
  next:    blue('◇'),
  later:   dim('○'),
};

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
const W = Math.min(cols, 72);  // soft max for body text wrap

const rule = (label) => {
  const tag = ` ${label.toUpperCase()} `;
  const remain = Math.max(2, W - tag.length - 4);
  return dim('═══') + bold(tag) + dim('═'.repeat(remain));
};

const renderHero = (profile) => {
  const lines = [];
  const fullName = `${profile.name ?? ''}${profile.nameAccent ? ' ' + profile.nameAccent : ''}`;
  lines.push(bold(yellow(fullName.trim().toUpperCase())));
  if (profile.slogan) lines.push(italic(profile.slogan));
  if (profile.manifesto) {
    lines.push('');
    lines.push(dim(wrap(profile.manifesto, W)));
  }
  lines.push('');
  const sub = [profile.role, profile.location].filter(Boolean).join('  ·  ');
  if (sub) lines.push(dim(sub));
  if (profile.status) lines.push(green('● ') + profile.status);
  if (profile.tags?.length) lines.push(dim('tags  ') + profile.tags.map(yellow).join(dim(' · ')));
  return lines.join('\n');
};

// Single line opening the "what I'm open to" stance, sourced from
// contact.intro so it stays in sync with the website's contact card.
// Strips a leading "(Currently )open to:" so the CLI doesn't double up
// the label with our own "open to ·" prefix.
const renderOpenTo = (contact) => {
  let intro = stripTags(contact.intro);
  if (!intro) return null;
  intro = intro.replace(/^\s*(?:currently\s+)?open\s+to\s*[:·]\s*/i, '');
  const prefix = 'open to · ';
  const pad = ' '.repeat(prefix.length);
  return dim(prefix) + wrap(intro, W - prefix.length, pad);
};

const renderCards = (cards, status, { full }) => {
  const list = cards.filter(c => c.status === status);
  if (list.length === 0) return null;

  const lines = [rule(status)];
  const idWidth = Math.max(...list.map(c => c.displayId.length));
  // Visual cell budget per row prefix: glyph(1) + space(1) + idWidth + 2 spaces
  // = idWidth + 4. Continuation lines indent to this column so they line up
  // exactly under the title.
  const indent = ' '.repeat(idWidth + 4);

  list.forEach(card => {
    const glyph = STATUS_GLYPH[status] ?? ' ';
    const id    = bold(yellow(card.displayId.padEnd(idWidth)));
    const title = bold(card.title ?? '');
    const date  = card.updated ? '  ' + dim(card.updated) : '';
    lines.push(`${glyph} ${id}  ${title}${date}`);

    // Summary (one line wrapped) — show on full mode only for shipped/now,
    // always for next/later (those don't have impact metrics so the
    // summary IS the value)
    const showSummary = full || status === 'next' || status === 'later';
    if (showSummary && card.summary) {
      lines.push(indent + dim(wrap(card.summary, W - indent.length, indent)));
    }

    // Impact pill on its own line (visual emphasis)
    if (card.impact) {
      lines.push(indent + green('· ') + green(card.impact));
    }

    // Inline links — compact "[label →]" form
    const links = (card.links ?? []).filter(l => l.href && l.href !== '#');
    if (links.length) {
      const compact = links.map(l => blue(`[${l.label} →]`)).join(' ');
      lines.push(indent + compact);
    }

    // Tags — full mode only (default keeps the listing dense)
    if (full && card.tags?.length) {
      lines.push(indent + dim(card.tags.join(' · ')));
    }
  });
  return lines.join('\n');
};

const renderLens = (lens, { full }) => {
  const items = lens.items ?? [];
  if (!items.length) return null;
  const lines = [rule('how i think')];
  items.forEach(it => {
    const num = bold(yellow((it.num ?? '').padEnd(5)));
    lines.push(`${num} ${it.main ?? ''}`);
    // Asides are one of the better parts of the lens — show them by default
    if (it.aside) lines.push('      ' + dim(italic(it.aside)));
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
      ? '  ' + dim(it.href) : '';
    lines.push(`  ${key}  ${link}${url}`);
  });
  return lines.join('\n');
};

// Audience navigation — mirrors the four hero CTAs on the website so the
// CLI ends with the same "pick your path" framing.
const renderAudienceNav = (profile) => {
  const ctas = profile.ctas ?? [];
  if (!ctas.length) return null;
  const lines = [rule('pick your path')];
  const widthAud = Math.max(...ctas.map(c => (c.audience ?? '').length));
  ctas.forEach(c => {
    const aud   = bold((c.audience ?? '').padEnd(widthAud));
    const label = c.label ?? '';
    lines.push(`  ${aud}  ${label}`);
    if (c.note) lines.push(' '.repeat(widthAud + 4) + dim(c.note));
  });
  return lines.join('\n');
};

const renderFooter = (site) => {
  const lines = [
    '',
    dim('→ live    ') + cyan(SITE),
    dim('→ source  ') + cyan('github.com/AntaresYuan/personal_website'),
    dim('→ json    ') + cyan('npx antares-cv --json'),
    dim('→ agents  ') + cyan(SITE + '/llms.txt'),
  ];
  if (site.footer?.lastUpdated) {
    lines.push('');
    lines.push(dim('updated ' + site.footer.lastUpdated));
  }
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
    renderOpenTo(contact),
    renderCards(cards, 'shipped', flags),
    renderCards(cards, 'now',     flags),
    renderCards(cards, 'next',    flags),
    renderCards(cards, 'later',   flags),
    renderLens(lens, flags),
    renderContact(contact),
    renderAudienceNav(profile),
    renderFooter(site),
  ].filter(Boolean);

  process.stdout.write('\n' + sections.join('\n\n') + '\n\n');
})();
