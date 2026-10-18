/* ════════════════════════════════════════════════════════════════════════
   worker/index.js — the site's Worker. Only /api/* reaches it (see
   run_worker_first in wrangler.jsonc); every other path is a static asset.

   POST /api/chat  {messages:[{role, content}]}  →  {reply, source}
   GET  /api/now   → {summary, updatedAt} | 404
   POST /api/now   {summary}  (Authorization: Bearer NOW_TOKEN)

   "Now" is a short, public summary of what Gloria is working on right
   now. local/now-sync.mjs builds it on the Mac (recent git activity,
   summarized by the local model) and posts it here; it lives in KV, so
   both models still know it when the Mac is off.

   Who answers:
     1. "local": the Qwen model in LM Studio on Gloria's Mac, reached
        through a Cloudflare Tunnel (LOCAL_LLM_URL). Tried first.
     2. "cloud": Workers AI (the AI binding), when the Mac is off, asleep,
        or the tunnel is down.
   If both fail the endpoint returns 503 and scripts/app.js answers from
   the site's own content, so the chat never goes dead.

   Both models get the same system prompt: a persona, the latest "now"
   summary, and /llms-full.txt, so answers stay grounded and current.

   Config (wrangler.jsonc vars + `wrangler secret put`):
     LOCAL_LLM_URL     secret  https://llm.example.com (tunnel hostname, no /v1)
     LOCAL_LLM_MODEL   var     model id as LM Studio lists it; empty = the
                               first chat model the server reports
     LOCAL_LLM_KEY     secret  optional, sent as Authorization: Bearer
     CF_ACCESS_ID      secret  optional, Cloudflare Access service token id
     CF_ACCESS_SECRET  secret  optional, Cloudflare Access service token secret
     FALLBACK_MODEL    var     Workers AI model id
     NOW_TOKEN         secret  shared with local/now-sync.mjs
   See docs/local-model.md for the setup on the Mac.
   ════════════════════════════════════════════════════════════════════════ */

const MAX_TURNS = 12;          // history sent to the model
const MAX_CHARS = 2000;        // per message
const PROBE_MS = 2500;         // is the Mac reachable at all?
const LOCAL_MS = 45000;        // a full local answer
const MAX_TOKENS = 600;
const MAX_NOW = 3000;          // chars of "now" summary kept

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
const readNow = async (env) => {
  if (!env.NOW) return null;
  try { return await env.NOW.get('now', 'json'); } catch { return null; }
};

const systemPrompt = async (env, request) => {
  if (siteText === null) {
    const res = await env.ASSETS.fetch(new URL('/llms-full.txt', request.url));
    siteText = res.ok ? await res.text() : '';
  }
  const now = await readNow(env);
  return [
    'You are Gloria Qi, answering visitors in the chat on your personal website.',
    'Speak in the first person as Gloria, warm and concise: a few short paragraphs at most, Markdown allowed.',
    'Answer in the language the visitor writes in.',
    'Use only the facts below. If something is not there, say you have not written about it yet and suggest emailing you. Never invent projects, numbers, employers, or links.',
    'When you talk about a project, use its exact title so the site can open it.',
    ...(now?.summary ? [
      `For questions about what you are doing, building, or working on now, answer from WHAT I'M DOING NOW: it was updated ${now.updatedAt.slice(0, 10)} and is newer than the site content, whose "NOW" labels may be out of date.`,
      '',
      `--- WHAT I'M DOING NOW (updated ${now.updatedAt}) ---`,
      now.summary,
    ] : []),
    '',
    '--- SITE CONTENT ---',
    siteText,
  ].join('\n');
};

const readMessages = (body) => {
  const list = Array.isArray(body?.messages) ? body.messages : [];
  return list
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
};

const localHeaders = (env) => {
  const h = { 'content-type': 'application/json' };
  if (env.LOCAL_LLM_KEY) h.authorization = `Bearer ${env.LOCAL_LLM_KEY}`;
  if (env.CF_ACCESS_ID && env.CF_ACCESS_SECRET) {
    h['CF-Access-Client-Id'] = env.CF_ACCESS_ID;
    h['CF-Access-Client-Secret'] = env.CF_ACCESS_SECRET;
  }
  return h;
};

const askLocal = async (env, messages) => {
  if (!env.LOCAL_LLM_URL) return null;
  const base = env.LOCAL_LLM_URL.replace(/\/+$/, '');
  const headers = localHeaders(env);

  // A cheap probe first, so a sleeping Mac costs 2.5s, not the full timeout.
  const probe = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(PROBE_MS) });
  if (!probe.ok) throw new Error(`local probe ${probe.status}`);
  const listed = ((await probe.json())?.data || []).map((m) => m.id).filter((id) => !/embed/i.test(id));
  const model = env.LOCAL_LLM_MODEL || listed[0];
  if (!model) throw new Error('local server lists no chat model');

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(LOCAL_MS),
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
      max_tokens: MAX_TOKENS,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`local ${res.status}`);
  const data = await res.json();
  return clean(data?.choices?.[0]?.message?.content);
};

const askCloud = async (env, messages) => {
  if (!env.AI) return null;
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

  const messages = [{ role: 'system', content: await systemPrompt(env, request) }, ...history];

  for (const [source, ask] of [['local', askLocal], ['cloud', askCloud]]) {
    try {
      const reply = await ask(env, messages);
      if (reply) return json({ reply, source });
    } catch (err) {
      console.log(`chat: ${source} failed: ${err?.message || err}`);
    }
  }
  return json({ error: 'No model available' }, 503);
};

const now = async (request, env) => {
  if (!env.NOW) return json({ error: 'Not configured' }, 501);
  if (request.method === 'GET') {
    const value = await readNow(env);
    return value ? json(value) : json({ error: 'Nothing yet' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);
  if (!env.NOW_TOKEN || request.headers.get('authorization') !== `Bearer ${env.NOW_TOKEN}`) {
    return json({ error: 'Unauthorized' }, 401);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const summary = typeof body?.summary === 'string' ? body.summary.trim().slice(0, MAX_NOW) : '';
  if (!summary) return json({ error: 'No summary' }, 400);
  const value = { summary, updatedAt: new Date().toISOString() };
  await env.NOW.put('now', JSON.stringify(value));
  return json(value);
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      return chat(request, env);
    }
    if (pathname === '/api/now') return now(request, env);
    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
