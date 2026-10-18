/* ════════════════════════════════════════════════════════════════════════
   worker/index.js — the site's Worker. Only /api/* reaches it (see
   run_worker_first in wrangler.jsonc); every other path is a static asset.

   POST /api/chat  {messages:[{role, content}]}  →  {reply, source}

   Who answers:
     1. "local": local/agent.mjs on Gloria's Mac, reached through a
        Cloudflare Tunnel (LOCAL_AGENT_URL). At question time it scans her
        recent work and answers with the Qwen model in LM Studio. Tried
        first.
     2. "cloud": Workers AI (the AI binding), when the Mac is off, asleep,
        or the tunnel is down. It can't see her recent work, and says so.
   If both fail the endpoint returns 503 and scripts/app.js answers from
   the site's own content, so the chat never goes dead.

   Both get the same base system prompt: a persona, Gloria's own memory
   (the "memory" key in the MEMORY KV namespace, which she edits in the
   Cloudflare dashboard), and /llms-full.txt.

   Config (wrangler.jsonc vars + `wrangler secret put`):
     LOCAL_AGENT_URL    secret  https://llm.example.com (tunnel hostname)
     LOCAL_AGENT_TOKEN  secret  shared with local/agent.mjs
     CF_ACCESS_ID       secret  optional, Cloudflare Access service token id
     CF_ACCESS_SECRET   secret  optional, Cloudflare Access service token secret
     FALLBACK_MODEL     var     Workers AI model id
   See docs/local-model.md for the setup on the Mac.
   ════════════════════════════════════════════════════════════════════════ */

const MAX_TURNS = 12;          // history sent to the model
const MAX_CHARS = 2000;        // per message
const PROBE_MS = 2500;         // is the Mac reachable at all?
const LOCAL_MS = 50000;        // a full local answer, scan included
const MAX_TOKENS = 600;
const MAX_MEMORY = 8000;       // chars of Gloria's memory kept in the prompt

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// Qwen3-family models may think out loud first; visitors only see the answer.
const clean = (text) => String(text || '')
  .replace(/<think>[\s\S]*?<\/think>/gi, '')
  .replace(/^[\s\S]*?<\/think>/i, '')
  .trim();

let siteText = null;
const readMemory = async (env) => {
  if (!env.MEMORY) return '';
  try { return ((await env.MEMORY.get('memory')) || '').trim().slice(0, MAX_MEMORY); } catch { return ''; }
};

const systemPrompt = async (env, request) => {
  if (siteText === null) {
    const res = await env.ASSETS.fetch(new URL('/llms-full.txt', request.url));
    siteText = res.ok ? await res.text() : '';
  }
  const memory = await readMemory(env);
  return [
    'You are Gloria Qi, answering visitors in the chat on your personal website.',
    'Speak in the first person as Gloria, warm and concise: a few short paragraphs at most, Markdown allowed.',
    'Answer in the language the visitor writes in.',
    'Use only the facts below. If something is not there, say you have not written about it yet and suggest emailing you. Never invent projects, numbers, employers, or links.',
    'When you talk about a project, use its exact title so the site can open it.',
    ...(memory ? [
      'ABOUT ME was written by Gloria herself: follow it for who you are, your personality, preferences, and how you talk, and respect anything it says not to share.',
      '',
      '--- ABOUT ME ---',
      memory,
    ] : []),
    '',
    '--- SITE CONTENT ---',
    siteText,
  ].join('\n');
};

// Only the cloud model gets this: it has no view of what Gloria is doing today.
const OFFLINE_NOTE = [
  '',
  '--- RIGHT NOW ---',
  "My laptop is offline, so you can't see what I'm working on today, and the site's NOW labels may be out of date.",
  'If asked what I am doing or building now, say my live status shows up when my laptop is online, then mention the projects the site lists as NOW as things I have been working on recently.',
].join('\n');

const readMessages = (body) => {
  const list = Array.isArray(body?.messages) ? body.messages : [];
  return list
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
};

const localHeaders = (env) => {
  const h = { 'content-type': 'application/json' };
  if (env.LOCAL_AGENT_TOKEN) h.authorization = `Bearer ${env.LOCAL_AGENT_TOKEN}`;
  if (env.CF_ACCESS_ID && env.CF_ACCESS_SECRET) {
    h['CF-Access-Client-Id'] = env.CF_ACCESS_ID;
    h['CF-Access-Client-Secret'] = env.CF_ACCESS_SECRET;
  }
  return h;
};

const askLocal = async (env, system, history) => {
  if (!env.LOCAL_AGENT_URL) return null;
  const base = env.LOCAL_AGENT_URL.replace(/\/+$/, '');
  const headers = localHeaders(env);

  // A cheap probe first, so a sleeping Mac costs 2.5s, not the full timeout.
  const probe = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(PROBE_MS) });
  if (!probe.ok) throw new Error(`local probe ${probe.status}`);

  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(LOCAL_MS),
    body: JSON.stringify({ system, messages: history, max_tokens: MAX_TOKENS }),
  });
  if (!res.ok) throw new Error(`local ${res.status}`);
  return clean((await res.json())?.reply);
};

const askCloud = async (env, system, history) => {
  if (!env.AI) return null;
  const messages = [{ role: 'system', content: system + OFFLINE_NOTE }, ...history];
  const out = await env.AI.run(env.FALLBACK_MODEL, { messages, max_tokens: MAX_TOKENS, temperature: 0.6 });
  return clean(out?.response ?? out?.choices?.[0]?.message?.content);
};

const chat = async (request, env) => {
  if (env.CHAT_LIMIT) {
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const { success } = await env.CHAT_LIMIT.limit({ key: ip });
    if (!success) return json({ error: 'Too many messages. Try again in a minute.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const history = readMessages(body);
  if (!history.length || history.at(-1).role !== 'user') return json({ error: 'No question' }, 400);

  const system = await systemPrompt(env, request);

  for (const [source, ask] of [['local', askLocal], ['cloud', askCloud]]) {
    try {
      const reply = await ask(env, system, history);
      if (reply) return json({ reply, source });
    } catch (err) {
      console.log(`chat: ${source} failed: ${err?.message || err}`);
    }
  }
  return json({ error: 'No model available' }, 503);
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      return chat(request, env);
    }
    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
