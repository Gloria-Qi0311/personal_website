/* ════════════════════════════════════════════════════════════════════════
   worker/index.js — the site's Worker. Only /api/* reaches it (see
   run_worker_first in wrangler.jsonc); every other path is a static asset.

   POST /api/chat  {messages:[{role, content}]}  →  {reply, source, traceId}

   Every answer gets a trace id and is logged to D1 (worker/trace.js), so a
   bad answer can be reported by id and turned into a case in
   evals/bad-cases.json. Questions about current work are answered from
   recent GitHub activity (worker/github.js), not only the site's Now section.

   Who answers:
     1. "local": the Qwen model in LM Studio on Gloria's Mac, reached
        through a Cloudflare Tunnel (LOCAL_LLM_URL). Tried first.
     2. "cloud": Workers AI (the AI binding), when the Mac is off, asleep,
        or the tunnel is down.
   If both fail the endpoint returns 503 and scripts/app.js answers from
   the site's own content, so the chat never goes dead.

   Both models get the same system prompt: a persona plus /llms-full.txt,
   so answers stay grounded in the site's content.

   Config (wrangler.jsonc vars + `wrangler secret put`):
     LOCAL_LLM_URL     secret  https://llm.example.com (tunnel hostname, no /v1)
     LOCAL_LLM_MODEL   var     model id as LM Studio lists it
     LOCAL_LLM_KEY     secret  optional, sent as Authorization: Bearer
     CF_ACCESS_ID      secret  optional, Cloudflare Access service token id
     CF_ACCESS_SECRET  secret  optional, Cloudflare Access service token secret
     FALLBACK_MODEL    var     Workers AI model id
   See docs/local-model.md for the setup on the Mac.
   ════════════════════════════════════════════════════════════════════════ */

import { githubActivity, githubStatus } from './github.js';
import { logAnswer, newTraceId } from './trace.js';

const MAX_TURNS = 12;          // history sent to the model
const MAX_CHARS = 2000;        // per message
const PROBE_MS = 2500;         // is the Mac reachable at all?
const LOCAL_MS = 45000;        // a full local answer
const MAX_TOKENS = 600;

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
const systemPrompt = async (env, request, ctx) => {
  if (siteText === null) {
    const res = await env.ASSETS.fetch(new URL('/llms-full.txt', request.url));
    siteText = res.ok ? await res.text() : '';
  }
  const { text: activity } = await githubActivity(env, ctx);
  // The site's hand-written Now list goes stale; with live GitHub activity,
  // label it as old so the model doesn't present it as current work.
  const site = activity
    ? siteText.replace(/^# Now$/m, '# Earlier projects (this list is out of date; for current work use RECENT GITHUB ACTIVITY)')
    : siteText;
  return [
    'You are Gloria Qi, answering visitors in the chat on your personal website.',
    'Speak in the first person as Gloria, warm and concise: a few short paragraphs at most, Markdown allowed.',
    'Answer in the language the visitor writes in.',
    'Use only the facts in the site content below. If something is not there, say you have not written about it yet and suggest emailing you. Never invent projects, numbers, employers, or links.',
    'When you talk about a project, use its exact title so the site can open it.',
    ...(activity ? [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      'For questions about what you are building, doing or working on now or lately, answer from RECENT GITHUB ACTIVITY below (most recent first), not from the Now section of the site content, which can be out of date.',
      'Private repos: describe them only from their description and README, never share a link to them, and never quote code.',
    ] : []),
    '',
    '--- SITE CONTENT ---',
    site,
    ...(activity ? ['', '--- RECENT GITHUB ACTIVITY ---', activity] : []),
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

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(LOCAL_MS),
    body: JSON.stringify({
      model: env.LOCAL_LLM_MODEL,
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

const chat = async (request, env, ctx) => {
  if (env.CHAT_LIMIT) {
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const { success } = await env.CHAT_LIMIT.limit({ key: ip });
    if (!success) return json({ error: 'Too many messages. Try again in a minute.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const history = readMessages(body);
  if (!history.length || history.at(-1).role !== 'user') return json({ error: 'No question' }, 400);

  const messages = [{ role: 'system', content: await systemPrompt(env, request, ctx) }, ...history];
  const traceId = newTraceId();
  const log = (answer, source) => ctx.waitUntil(logAnswer(env, {
    traceId, question: history.at(-1).content, answer, source, history: history.slice(0, -1),
    version: env.CF_VERSION_METADATA?.id,
  }));

  for (const [source, ask] of [['local', askLocal], ['cloud', askCloud]]) {
    try {
      const reply = await ask(env, messages);
      if (reply) {
        log(reply, source);
        return json({ reply, source, traceId });
      }
    } catch (err) {
      console.log(`chat: ${source} failed: ${err?.message || err}`);
    }
  }
  // The page answers from its own content now; the id still lets that be traced.
  log(null, 'page');
  const { recent } = await githubActivity(env, ctx);
  return json({ error: 'No model available', traceId, recent }, 503);
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health') {
      return json({ version: env.CF_VERSION_METADATA?.id || null, db: Boolean(env.DB), github: await githubStatus(env, ctx) });
    }
    if (pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      return chat(request, env, ctx);
    }
    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
