/* ════════════════════════════════════════════════════════════════════════
   app.js — runtime for the chat-style home page.

   - Panels: #home, #skills and #<card-id> open the matching pre-rendered
     panel on the right; closing it clears the hash. The welcome screen
     has no panel.
   - Chat: messages go to POST /api/chat as {messages:[{role, content}]}
     and come back as {reply, source, traceId}; source "local" means the model on
     Gloria's laptop answered (worker/index.js). When the server can't answer (not deployed
     yet, not configured, offline), a small local responder answers from
     the site's own content so the page still works.
   - Whenever a reply names a project, that project opens on the right.
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  const app = document.body;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const data = JSON.parse($('#chat-data')?.textContent || '{}');
  const projects = data.projects || [];
  const avatarSrc = $('.hello-avatar')?.getAttribute('src') || '';

  const thread = $('#thread');
  const scroller = $('#chat-scroll');
  const input = $('#ask-input');
  const form = $('#composer');
  const sendBtn = $('.send', form);
  const scrim = $('#scrim');

  const STORE = 'gloria-chat';
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch { /* private mode */ }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-20))); } catch { /* ignore */ } };

  // ── Panels ──────────────────────────────────────────────────────────
  const panels = new Map($$('.panel').map((p) => [p.dataset.panel, p]));

  const showPanel = (key) => {
    const panel = panels.get(key);
    panels.forEach((p) => p.classList.toggle('is-open', p === panel));
    app.classList.toggle('has-panel', Boolean(panel));
    $$('[data-open]').forEach((a) => a.classList.toggle('is-on', a.dataset.open === key && a.closest('.left') !== null));
    if (panel) {
      $('.panel-body', panel).scrollTop = 0;
      const link = $(`.left [data-open="${CSS.escape(key)}"]`);
      for (let d = link?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
      link?.scrollIntoView({ block: 'nearest' });
    }
    closeMenu();
  };

  const route = () => showPanel(decodeURIComponent(location.hash.slice(1)));
  const open = (key) => {
    if (location.hash === `#${key}`) route();
    else location.hash = key;
  };
  const close = () => {
    window.history.replaceState(null, '', location.pathname + location.search);
    showPanel('');
  };

  addEventListener('hashchange', route);
  $$('[data-close]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); close(); }));
  scrim?.addEventListener('click', () => { if (app.classList.contains('menu-open')) closeMenu(); else close(); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (app.classList.contains('menu-open')) closeMenu();
    else if (app.classList.contains('has-panel')) close();
  });

  // ── Mobile menu ─────────────────────────────────────────────────────
  const menuBtn = $('#menu-btn');
  function closeMenu() {
    app.classList.remove('menu-open');
    menuBtn?.setAttribute('aria-expanded', 'false');
  }
  menuBtn?.addEventListener('click', () => {
    const on = app.classList.toggle('menu-open');
    menuBtn.setAttribute('aria-expanded', String(on));
  });

  // ── Rendering messages ──────────────────────────────────────────────
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const formatReply = (text) => text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');

  const scrollDown = () => { scroller.scrollTop = scroller.scrollHeight; };

  const addUser = (text) => {
    const li = document.createElement('li');
    li.className = 'msg-user';
    li.textContent = text;
    thread.appendChild(li);
  };

  const addBot = (html) => {
    const li = document.createElement('li');
    li.className = 'msg-bot';
    li.innerHTML = `<img src="${esc(avatarSrc)}" alt="" width="32" height="32"><div class="text">${html}</div>`;
    thread.appendChild(li);
    return li;
  };

  const openCard = (p) => `<button type="button" class="open-card" data-open-card="${esc(p.id)}"><span><b>${esc(p.title)}</b><small>${esc(p.category)}</small></span><span class="go">Opened →</span></button>`;

  // Trace id under each answer, so a bad answer can be reported exactly.
  const traceLine = (id) => (id
    ? `<p class="trace"><span>${esc(id)}</span><button type="button" class="trace-copy" data-copy="${esc(id)}" aria-label="Copy trace id">Copy</button></p>`
    : '');

  thread.addEventListener('click', (e) => {
    const card = e.target.closest('[data-open-card]');
    if (card) open(card.dataset.openCard);
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      }).catch(() => {});
    }
  });

  // The project a text names first (on a tie, the longer title wins, so
  // "Agent Memory Benchmark" beats a shorter title inside it).
  const byTitle = projects.slice().sort((a, b) => b.title.length - a.title.length);
  const mentioned = (text) => {
    const t = text.toLowerCase();
    let best = null, at = Infinity;
    for (const p of byTitle) {
      const i = t.indexOf(p.title.toLowerCase());
      if (i >= 0 && i < at) { best = p; at = i; }
    }
    return best;
  };

  // ── Local responder (used when /api/chat can't answer) ───────────────
  const find = (id) => projects.find((p) => p.id === id);
  const contactLine = () => (data.contact || []).map((c) => `[${c.label}](${c.href})`).join(' · ');
  const local = (q, recent = []) => {
    const t = q.toLowerCase();
    const project = mentioned(q) || byTitle.find((p) => p.id.split('-').slice(1).some((w) => w.length > 3 && t.includes(w)));
    if (project) return { text: `**${project.title}**: ${project.summary}\n\nThe details are open on the right.`, open: project.id };
    if (/best|favou?rite|proud|flagship|最好|代表/.test(t)) {
      const p = find(data.featured?.[0]);
      if (p) return { text: `I'd start with **${p.title}**. ${p.summary}\n\nIt's open on the right.`, open: p.id };
    }
    if (/now|current|working on|building|最近|正在|在做/.test(t)) {
      if (recent.length) {
        const lines = recent.map((r) => `- **${r.url ? `[${r.name}](${r.url})` : r.name}**${r.description ? `: ${r.description}` : ''} (last worked on ${r.pushed})`).join('\n');
        return { text: `Lately I've been working on:\n\n${lines}` };
      }
      const p = projects.find((x) => x.status === 'now' && (data.featured || []).includes(x.id));
      return { text: data.now || 'A few things at once. Have a look at the projects on the left.', open: p?.id };
    }
    if (/skill|stack|tech|tool|language|技能|会什么/.test(t)) {
      const lines = (data.skills || []).map((g) => `- **${g.title}**: ${g.items.join(', ')}`).join('\n');
      return { text: `Here's what I work with:\n\n${lines}\n\nThe right panel shows which project used each one.`, open: 'skills' };
    }
    if (/intern|hire|hiring|job|work with|available|实习|工作/.test(t)) {
      return { text: `Yes, I'm open to AI product and product-engineering internships, and to collaborations. The easiest way to reach me:\n\n${contactLine()}`, open: 'home' };
    }
    if (/contact|email|reach|linkedin|github|联系|邮箱/.test(t)) {
      return { text: `You can reach me here:\n\n${contactLine()}`, open: 'home' };
    }
    if (/resume|résumé|cv|简历/.test(t)) {
      const r = data.resume || [];
      return { text: r.length ? `Here's my résumé: ${r.map((x) => `[${x.label}](${x.href})`).join(' · ')}` : `My résumé download is coming soon. Until then, email me and I'll send it: ${contactLine()}`, open: 'home' };
    }
    if (/who are you|about you|yourself|introduce|你是谁|介绍/.test(t)) {
      return { text: `I'm Gloria, ${(data.roles || []).join(', ').toLowerCase()}. I like problems where the model is the easy part and the hard part is trust.`, open: 'home' };
    }
    return { text: `I can't answer that one here yet. Ask me about a project, my skills, or how to reach me, or write to me directly: ${contactLine()}` };
  };

  // ── Sending ─────────────────────────────────────────────────────────
  let busy = false;
  const ask = async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    busy = true;
    sendBtn.disabled = true;
    app.classList.add('is-chatting');
    addUser(q);
    history.push({ role: 'user', content: q });
    const pending = addBot('<span class="typing" aria-label="Typing"><span></span><span></span><span></span></span>');
    scrollDown();

    let reply = null;
    let source = null;
    let traceId = null;
    let recent = [];
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      const body = await res.json().catch(() => ({}));
      ({ traceId = null, recent = [] } = body);
      if (res.ok) ({ reply = null, source = null } = body);
    } catch { /* no server: fall through to the local responder */ }

    let target = null;
    if (reply) {
      target = mentioned(reply);
    } else {
      const answer = local(q, recent);
      reply = answer.text;
      target = answer.open ? (find(answer.open) || { id: answer.open }) : null;
    }
    history.push({ role: 'assistant', content: reply, ...(traceId ? { traceId } : {}) });
    save();

    const project = target && find(target.id);
    const via = source === 'local' ? '<p class="via">Answered by a small model running on my own laptop.</p>' : '';
    $('.text', pending).innerHTML = formatReply(reply) + (project ? openCard(project) : '') + via + traceLine(traceId);
    if (target) open(target.id);
    scrollDown();
    busy = false;
    sendBtn.disabled = false;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = '';
    autosize();
    ask(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; };
  input.addEventListener('input', autosize);

  document.addEventListener('click', (e) => {
    const asker = e.target.closest('[data-ask]');
    if (asker) { closeMenu(); ask(asker.dataset.ask); }
  });

  const reset = () => {
    history = [];
    save();
    thread.innerHTML = '';
    app.classList.remove('is-chatting');
    close();
    input.focus();
  };
  $('#new-chat')?.addEventListener('click', reset);
  $('[data-reset]')?.addEventListener('click', (e) => { e.preventDefault(); reset(); });

  // ── Start ───────────────────────────────────────────────────────────
  if (history.length) {
    app.classList.add('is-chatting');
    history.forEach((m) => (m.role === 'user' ? addUser(m.content) : addBot(formatReply(m.content) + traceLine(m.traceId))));
    scrollDown();
  }
  route();
})();
