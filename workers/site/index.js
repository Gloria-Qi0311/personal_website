/* ════════════════════════════════════════════════════════════════════════
   Site worker — serves the static site (ASSETS binding) and one API route,
   POST /api/chat, used by the chat on the home page (scripts/app.js).

   The model runs on Gloria's own Mac (Qwen in LM Studio / Bionic) and is
   reached through a Cloudflare Tunnel. It answers in first person, grounded
   on /llms-full.txt, which scripts/build-llms.js regenerates from
   content/*.json.

   Settings (Cloudflare → Workers → gloria-qi → Settings → Variables and
   Secrets, type "Secret" so they survive deploys):
     LOCAL_LLM_URL    tunnel address, e.g. https://xxxx.trycloudflare.com
     LOCAL_LLM_MODEL  optional, defaults to qwen/qwen3.5-9b
     LOCAL_LLM_KEY    optional, sent as a Bearer token if the server wants one

   If the model can't be reached (Mac asleep, tunnel down, too slow), the
   route returns 503 and the page falls back to its built-in answers.
   ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_MODEL = 'qwen/qwen3.5-9b';
const MAX_TURNS = 12;        // messages kept from the visitor's history
const MAX_CHARS = 1000;      // per visitor message
const TIMEOUT_MS = 45_000;   // a 9B model on a laptop can be slow

const SYSTEM_PROMPT = `You are Gloria Qi, chatting with visitors on your personal website. Visitors are often recruiters, collaborators or curious people.

How to answer:
- Speak as Gloria, in first person ("I built...", "I'm looking for...").
- Use only the facts in <site_content>. If something isn't there, say you haven't written about it on the site and invite them to email you (the address is in the content). Never invent projects, jobs, dates or numbers.
- Reply in the visitor's language. Keep it short and warm: two to five sentences, or a short list when listing projects.
- When you talk about a project, write its title exactly as it appears in the content, so the page can open it next to the chat.
- Politely steer unrelated requests back to your work.

<site_content>
`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Keep only well-formed {role, content:string} turns, cap their length and
// count, and make sure the conversation starts and ends with a user turn.
function sanitize(messages) {
  if (!Array.isArray(messages)) return null;
  const clean = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS).trim() }))
    .filter((m) => m.content)
    .slice(-MAX_TURNS);
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') return null;
  return clean;
}

// Qwen thinking models may put their reasoning inline in <think> tags.
const stripThinking = (text) => text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();

async function chat(request, env) {
  if (!env.LOCAL_LLM_URL) return json({ error: 'not configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const messages = sanitize(body?.messages);
  if (!messages) return json({ error: 'bad request' }, 400);

  const corpusRes = await env.ASSETS.fetch(new URL('/llms-full.txt', request.url));
  const corpus = corpusRes.ok ? await corpusRes.text() : '';

  const headers = { 'content-type': 'application/json' };
  if (env.LOCAL_LLM_KEY) headers.authorization = `Bearer ${env.LOCAL_LLM_KEY}`;

  let res;
  try {
    res = await fetch(`${env.LOCAL_LLM_URL.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: env.LOCAL_LLM_MODEL || DEFAULT_MODEL,
        messages: [{ role: 'system', content: `${SYSTEM_PROMPT}${corpus}\n</site_content>` }, ...messages],
        temperature: 0.4,
        max_tokens: 1024,
        stream: false,
      }),
    });
  } catch (err) {
    console.error('local model unreachable', err?.name, err?.message);
    return json({ error: 'model offline' }, 503);
  }
  if (!res.ok) {
    console.error('local model error', res.status, (await res.text()).slice(0, 300));
    return json({ error: 'model offline' }, 503);
  }

  const data = await res.json().catch(() => null);
  const reply = stripThinking(data?.choices?.[0]?.message?.content || '');
  if (!reply) return json({ error: 'empty reply' }, 503);
  return json({ reply });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return chat(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
