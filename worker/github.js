/* ════════════════════════════════════════════════════════════════════════
   worker/github.js — "what am I working on lately", read from GitHub.

   Lists Gloria's repos by most recent push and pulls each one's README, so
   the chat can answer "what are you building now?" from real activity
   instead of the site's hand-written (and sometimes stale) Now section.

   With GITHUB_TOKEN (fine-grained, Contents: read-only) private repos are
   included too, but only their name, description and README. Code is never
   read, and private repos never get a link. Without the token, public only.

   The result is cached for an hour (in memory and in the Cache API).
   ════════════════════════════════════════════════════════════════════════ */

const OWNER = 'Gloria-Qi0311';
const REPOS = 8;              // most recently pushed repos to describe
const README_CHARS = 900;     // per README, enough for "what it is"
const TTL_S = 3600;
const CURRENT_DAYS = 30;      // pushed this recently = current work
const CACHE_KEY = 'https://gloria-qi.internal/github-activity-v4';

let memo = null;              // { text, recent, count, at }
let lastError = null;

const gh = (env, path, accept = 'application/vnd.github+json') => fetch(`https://api.github.com${path}`, {
  headers: {
    accept,
    'user-agent': 'gloria-qi-site',
    'x-github-api-version': '2022-11-28',
    ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
  },
});

// README as plain text, minus images, HTML and badge noise, trimmed.
const readmeText = async (env, repo) => {
  const res = await gh(env, `/repos/${repo.full_name}/readme`, 'application/vnd.github.raw');
  if (!res.ok) return '';
  return (await res.text())
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, README_CHARS);
};

const isCurrent = (repo, now) => now - Date.parse(repo.pushed_at) < CURRENT_DAYS * 86400000;

// Dates are for the model, so it can tell current work from old projects.
// Visitors never see them: worker/agent.js strips dates from every answer.
const describe = (repo, readme, now) => {
  const when = `${isCurrent(repo, now) ? 'CURRENT work' : 'older project, not current'}; last pushed ${(repo.pushed_at || '').slice(0, 10)}`;
  const head = repo.private
    ? `### ${repo.name} (private repo; ${when}; do not share a link)`
    : `### ${repo.name} (public; ${when}) ${repo.html_url}`;
  return [head, repo.description ? `Description: ${repo.description}` : '', readme ? `README excerpt:\n${readme}` : '']
    .filter(Boolean).join('\n');
};

const build = async (env) => {
  const list = env.GITHUB_TOKEN
    ? await gh(env, '/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=30')
    : await gh(env, `/users/${OWNER}/repos?sort=pushed&direction=desc&per_page=30`);
  if (!list.ok) throw new Error(`github repos ${list.status}`);
  const repos = (await list.json())
    .filter((r) => !r.fork && !r.archived)
    .sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)))
    .slice(0, REPOS);
  const readmes = await Promise.all(repos.map((r) => readmeText(env, r).catch(() => '')));
  const now = Date.now();
  const current = repos.filter((r) => isCurrent(r, now));
  return {
    count: repos.length,
    newest: (repos[0]?.pushed_at || '').slice(0, 10),
    text: repos.map((r, i) => describe(r, readmes[i], now)).join('\n\n'),
    // Short list for the page's offline answer; no links for private repos.
    recent: (current.length ? current : repos).slice(0, 3).map((r) => ({
      name: r.name, description: r.description || '', url: r.private ? null : r.html_url,
    })),
  };
};

// Returns {text, recent}; empty when GitHub can't be reached. Never throws.
export const githubActivity = async (env, ctx) => {
  if (memo && Date.now() - memo.at < TTL_S * 1000) return memo;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  try {
    const hit = cache && await cache.match(CACHE_KEY);
    if (hit) {
      memo = { ...(await hit.json()), at: Date.now() };
      return memo;
    }
    const fresh = await build(env);
    memo = { ...fresh, at: Date.now() };
    lastError = null;
    if (cache) {
      const put = cache.put(CACHE_KEY, new Response(JSON.stringify(fresh), { headers: { 'cache-control': `max-age=${TTL_S}` } }));
      ctx?.waitUntil ? ctx.waitUntil(put) : await put;
    }
    return memo;
  } catch (err) {
    lastError = String(err?.message || err);
    console.log(`github: ${lastError}`);
    return memo || { text: '', recent: [], count: 0 };
  }
};

// For /api/health: counts and dates only, never repo names.
export const githubStatus = async (env, ctx) => {
  const { count = 0, newest = null } = await githubActivity(env, ctx);
  return { token: Boolean(env.GITHUB_TOKEN), repos: count, newest, error: lastError };
};
