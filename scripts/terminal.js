/* ════════════════════════════════════════════════════════════════════════
   terminal.js — embedded interactive CLI.
   Reads the same content/*.json files the board renders from. Exposes
   commands that map onto the board's data, so the page has two surfaces
   (mouse-friendly kanban + keyboard/agent-friendly CLI) backed by one
   source of truth.

   Boots independently of render.js (its own fetches), so a slow card
   render doesn't block the terminal and vice versa.
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  const root = document.getElementById('terminal-root');
  if (!root) return;

  const body  = document.getElementById('terminal-body');
  const input = document.getElementById('terminal-input');
  const clearBtn = document.getElementById('terminal-clear');
  if (!body || !input) return;

  const escape = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const json = async (p) => {
    const r = await fetch(p, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };

  /* ── State ──────────────────────────────────────────────────────── */
  const state = { profile: null, board: null, lens: null, contact: null };
  const history = [];     // command strings, oldest first
  let historyIdx = -1;    // -1 = composing new

  /* ── Rendering ─────────────────────────────────────────────────── */
  // Insert lines BEFORE the prompt line so the input always stays at bottom.
  const promptLine = body.querySelector('.term-prompt-line');

  const print = (html, cls = 'term-out') => {
    const div = document.createElement('div');
    div.className = `terminal-line ${cls}`;
    div.innerHTML = html;
    body.insertBefore(div, promptLine);
    body.scrollTop = body.scrollHeight;
  };

  const printCmd = (cmd) =>
    print(`<span class="term-prompt">$</span><span class="term-cmd">${escape(cmd)}</span>`, '');

  /* ── Command catalog ───────────────────────────────────────────── */
  const cmds = {};

  cmds.help = () => {
    const rows = [
      ['help',                       'show this list'],
      ['whoami',                     'identity, slogan, location'],
      ['projects [--status=X]',      'list cards; status: shipped|now|next|later|all'],
      ['cat <ID>',                   'full details for a card (e.g. cat SHIP-01)'],
      ['now',                        'shortcut for projects --status=now'],
      ['lens',                       'principles / how I think'],
      ['contact',                    'email + socials + open-to'],
      ['cv',                         'one-shot resume — everything above'],
      ['clear',                      'clear screen'],
    ];
    const w = Math.max(...rows.map(r => r[0].length));
    print(rows.map(r =>
      `<span class="term-key">${escape(r[0].padEnd(w + 2))}</span>` +
      `<span class="term-dim">${escape(r[1])}</span>`
    ).join('<br>'));
  };

  cmds.whoami = () => {
    const p = state.profile;
    if (!p) return print('profile not loaded', 'term-err');
    print(
      [
        `<span class="term-key">${escape(p.name)} ${escape(p.nameAccent ?? '')}</span>`,
        `<span class="term-dim">${escape(p.role ?? '')} · ${escape(p.location ?? '')}</span>`,
        '',
        `${escape(p.slogan ?? '')}`,
        '',
        `<span class="term-dim">tags:</span> ${(p.tags ?? []).map(escape).join(', ')}`,
        `<span class="term-dim">status:</span> <span class="term-ok">●</span> ${escape(p.status ?? '')}`,
      ].join('<br>')
    );
  };

  // Status → ID prefix; mirrors render.js so cat IDs match the board badges.
  const idPrefix = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
  const pad2 = (n) => String(n).padStart(2, '0');

  // Build [{...card, displayId}] in the same order render.js uses.
  const allCards = () => {
    const cards = (state.board?.cards ?? []).slice().sort((a, b) => {
      const ao = a.order ?? 99, bo = b.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (b.updated ?? '').localeCompare(a.updated ?? '');
    });
    const cols = ['shipped', 'now', 'next', 'later'];
    const out = [];
    cols.forEach((col) => {
      const inCol = cards.filter((c) => c.status === col);
      inCol.forEach((c, idx) => out.push({ ...c, displayId: `${idPrefix[col]}-${pad2(idx + 1)}` }));
    });
    return out;
  };

  cmds.projects = (args) => {
    if (!state.board) return print('board not loaded', 'term-err');
    const flag = args.find(a => a.startsWith('--status='));
    const status = flag ? flag.split('=')[1] : 'all';

    let list = allCards();
    if (status !== 'all') {
      const filtered = list.filter(c => c.status === status);
      if (filtered.length === 0) {
        return print(`<span class="term-dim">no cards with status '${escape(status)}'.</span>`);
      }
      list = filtered;
    }

    const widthId = Math.max(...list.map(c => c.displayId.length));
    const lines = list.map((c) => {
      const idCell = `<span class="term-key">${escape(c.displayId.padEnd(widthId + 2))}</span>`;
      const titleCell = `<span class="term-out">${escape(c.title)}</span>`;
      const impactCell = c.impact ? `  <span class="term-ok">${escape(c.impact)}</span>` : '';
      const date = c.updated ? `  <span class="term-dim">${escape(c.updated)}</span>` : '';
      return idCell + titleCell + impactCell + date;
    });
    print(lines.join('<br>'));
    print(`<span class="term-dim">${list.length} card${list.length === 1 ? '' : 's'} · cat &lt;ID&gt; for detail</span>`);
  };

  cmds.now = () => cmds.projects(['--status=now']);

  cmds.cat = (args) => {
    const id = (args[0] ?? '').toUpperCase();
    if (!id) return print('usage: cat &lt;ID&gt; — e.g. cat SHIP-01', 'term-err');
    const list = allCards();
    const c = list.find(x => x.displayId === id);
    if (!c) return print(`no card '${escape(id)}' — try \`projects\``, 'term-err');

    const tags = (c.tags ?? []).map(escape).join(', ') || '<span class="term-dim">none</span>';
    const links = (c.links ?? [])
      .filter(l => l.href && l.href !== '#')
      .map(l => `<a href="${escape(l.href)}" target="_blank" rel="noopener" style="color:var(--term-cmd);">${escape(l.label)}</a>`)
      .join('  ') || '<span class="term-dim">none</span>';

    const out = [
      `<span class="term-key">${escape(c.displayId)}</span>  <span class="term-warn">${escape(c.status)}</span>  <span class="term-dim">${escape(c.updated ?? '')}</span>`,
      '',
      `<span class="term-out" style="font-weight:600">${escape(c.title)}</span>`,
      escape(c.summary ?? ''),
      '',
      `<span class="term-dim">tags:</span>   ${tags}`,
      `<span class="term-dim">impact:</span> ${c.impact ? `<span class="term-ok">${escape(c.impact)}</span>` : '<span class="term-dim">—</span>'}`,
      `<span class="term-dim">links:</span>  ${links}`,
    ];

    if (c.details) {
      out.push('');
      out.push('<span class="term-dim">─── details ───</span>');
      out.push(escape(c.details).replace(/\n/g, '<br>'));
    }
    print(out.join('<br>'));
  };

  cmds.lens = () => {
    const items = state.lens?.items ?? [];
    if (items.length === 0) return print('no lens entries yet', 'term-dim');
    const lines = items.map(it => {
      const aside = it.aside ? `<br>  <span class="term-dim">${escape(it.aside)}</span>` : '';
      return `<span class="term-key">${escape(it.num ?? '')}</span> ${escape(it.main ?? '')}${aside}`;
    });
    print(lines.join('<br><br>'));
  };

  cmds.contact = () => {
    const c = state.contact;
    if (!c) return print('contact not loaded', 'term-err');
    const items = (c.items ?? []).map(it =>
      `<span class="term-key">${escape((it.key ?? '').padEnd(10))}</span><a href="${escape(it.href ?? '#')}" style="color:var(--term-cmd);">${escape(it.label ?? '')}</a>`
    ).join('<br>');
    const intro = (c.intro ?? '').replace(/<\/?em>/g, '').replace(/<\/?strong>/g, '');
    print(`<span class="term-dim">${escape(intro)}</span><br><br>${items}`);
  };

  cmds.cv = () => {
    cmds.whoami();
    print('<br><span class="term-dim">─── shipped ───</span>');
    cmds.projects(['--status=shipped']);
    print('<br><span class="term-dim">─── now ───</span>');
    cmds.projects(['--status=now']);
    print('<br><span class="term-dim">─── next ───</span>');
    cmds.projects(['--status=next']);
    print('<br><span class="term-dim">─── lens ───</span>');
    cmds.lens();
    print('<br><span class="term-dim">─── contact ───</span>');
    cmds.contact();
  };

  cmds.clear = () => {
    body.querySelectorAll('.terminal-line').forEach(n => {
      if (n !== promptLine) n.remove();
    });
  };

  /* ── Input handling ────────────────────────────────────────────── */
  const exec = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    printCmd(trimmed);
    history.push(trimmed);
    historyIdx = -1;

    const [name, ...args] = trimmed.split(/\s+/);
    const fn = cmds[name.toLowerCase()];
    if (!fn) {
      print(`<span class="term-err">command not found:</span> ${escape(name)} <span class="term-dim">— try \`help\`</span>`);
      return;
    }
    try { fn(args); }
    catch (e) { print(`<span class="term-err">error:</span> ${escape(e.message)}`); }
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      exec(input.value);
      input.value = '';
      ev.preventDefault();
      return;
    }
    if (ev.key === 'ArrowUp') {
      if (history.length === 0) return;
      historyIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      input.value = history[historyIdx];
      ev.preventDefault();
      return;
    }
    if (ev.key === 'ArrowDown') {
      if (historyIdx === -1) return;
      historyIdx = historyIdx + 1;
      if (historyIdx >= history.length) {
        historyIdx = -1;
        input.value = '';
      } else {
        input.value = history[historyIdx];
      }
      ev.preventDefault();
      return;
    }
    if (ev.key === 'l' && (ev.ctrlKey || ev.metaKey)) {
      cmds.clear();
      ev.preventDefault();
    }
  });

  // Click anywhere in the body focuses input — terminal-feels-like-terminal
  body.addEventListener('click', () => input.focus());
  clearBtn?.addEventListener('click', () => { cmds.clear(); input.focus(); });

  /* ── Boot ──────────────────────────────────────────────────────── */
  (async () => {
    try {
      const [profile, board, lens, contact] = await Promise.all([
        json('content/profile.json'),
        json('content/board.json'),
        json('content/lens.json'),
        json('content/contact.json'),
      ]);
      Object.assign(state, { profile, board, lens, contact });

      // Welcome line — short, agent-friendly
      print(
        [
          `<span class="term-dim">${escape(state.profile.name ?? '')} ${escape(state.profile.nameAccent ?? '')} · agent surface · ${new Date().toISOString().slice(0, 10)}</span>`,
          `<span class="term-dim">type</span> <span class="term-key">help</span><span class="term-dim"> for commands · </span><span class="term-key">cv</span><span class="term-dim"> for the full picture</span>`,
        ].join('<br>')
      );
    } catch (e) {
      print(`<span class="term-err">failed to load content: ${escape(e.message)}</span>`);
    }
  })();
})();
