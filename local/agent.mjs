#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   agent.mjs — answers the website chat from Gloria's Mac.

   The site's Worker reaches this through a Cloudflare Tunnel. For each
   question it:
     1. Scans what Gloria is working on right now: her own git commits in
        the last few days in the folders listed in the config, plus an
        optional note in her own words (~/now.md by default).
     2. Adds that to the system prompt the Worker sent (persona, her
        memory, site content) and asks the model in LM Studio.
     3. Returns the answer.

   The scan only reads git history and the note, never other files, and
   only the model's answer leaves the Mac. Scans are reused for a few
   minutes so a burst of visitors doesn't rescan every time.

   Endpoints (both need Authorization: Bearer <token>):
     GET  /health  → {ok, model}
     POST /chat    {system, messages, max_tokens} → {reply}

   Usage:
     node local/agent.mjs          # run the server
     node local/agent.mjs --scan   # print what a scan sees, then exit

   Config: ~/.gloria-agent.json (created with defaults on first run).
   See docs/local-model.md.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const CONFIG = path.join(HOME, '.gloria-agent.json');
const SCAN_TTL = 5 * 60 * 1000;   // reuse a scan for 5 minutes
const LLM_MS = 45000;             // the Worker gives up at 50s

const log = (...m) => console.log(new Date().toISOString(), ...m);
const expand = (p) => p.replace(/^~(?=$|\/)/, HOME);

const loadConfig = () => {
  if (!fs.existsSync(CONFIG)) {
    const defaults = {
      port: 8788,
      token: randomBytes(24).toString('hex'),   // same value as the Worker's LOCAL_AGENT_TOKEN
      llmUrl: 'http://localhost:1235/v1',
      model: '',                                 // empty = first chat model LM Studio lists
      dirs: ['~/Projects'],                      // folders holding your git repos
      exclude: [],                               // repo folder names to keep out of answers
      authors: [],                               // commit emails; empty = your git user.email
      days: 7,                                   // how far back counts as "now"
      note: '~/now.md',                          // optional note in your own words
    };
    fs.writeFileSync(CONFIG, `${JSON.stringify(defaults, null, 2)}\n`, { mode: 0o600 });
    log(`Created ${CONFIG}. Set "dirs" to the folders with your projects, then run again.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
};

const git = (cwd, ...a) => {
  try { return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};

// Repos at the folder itself and up to two levels below it.
const findRepos = (root, depth = 2) => {
  if (!fs.existsSync(root)) return [];
  if (fs.existsSync(path.join(root, '.git'))) return [root];
  if (depth === 0) return [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .flatMap((e) => findRepos(path.join(root, e.name), depth - 1));
};

// First real paragraph of the README, so the model knows what a repo is.
const blurb = (repo) => {
  const file = ['README.md', 'readme.md', 'README'].map((f) => path.join(repo, f)).find((f) => fs.existsSync(f));
  if (!file) return '';
  const para = fs.readFileSync(file, 'utf8').split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|!\[|<|\[!|```|>)/.test(p));
  return (para || '').replace(/\s+/g, ' ').slice(0, 300);
};

let cached = { at: 0, text: '' };
const scan = (cfg) => {
  if (Date.now() - cached.at < SCAN_TTL) return cached.text;
  const authors = cfg.authors?.length ? cfg.authors : [git(HOME, 'config', '--global', 'user.email')].filter(Boolean);
  const repos = [...new Set((cfg.dirs || []).map(expand).flatMap((d) => findRepos(d)))]
    .filter((r) => !(cfg.exclude || []).includes(path.basename(r)))
    .map((repo) => {
      const commits = git(repo, 'log', '--all', `--since=${cfg.days || 7} days ago`, '--date=short', '--pretty=format:%ad %s', '-n', '15',
        ...authors.map((a) => `--author=${a}`)).split('\n').filter(Boolean);
      return commits.length ? { name: path.basename(repo), about: blurb(repo), commits } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.commits[0].localeCompare(a.commits[0]));

  const notePath = cfg.note && expand(cfg.note);
  const note = notePath && fs.existsSync(notePath) ? fs.readFileSync(notePath, 'utf8').trim().slice(0, 3000) : '';

  const parts = [
    note && `My own note about what I'm doing (trust this most):\n${note}`,
    repos.length && `Projects I committed to in the last ${cfg.days || 7} days, most recent first:\n${repos.map((r) =>
      `## ${r.name}${r.about ? `\nAbout: ${r.about}` : ''}\n${r.commits.map((c) => `- ${c}`).join('\n')}`).join('\n\n')}`,
  ].filter(Boolean);
  cached = { at: Date.now(), text: parts.join('\n\n') || 'No commits in the last few days and no note.' };
  return cached.text;
};

const liveSection = (activity) => [
  '',
  `--- RIGHT NOW (scanned live from my laptop, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC) ---`,
  "For questions about what I'm doing, building, or working on now, answer from this section: it is newer than the site content, whose NOW labels may be out of date.",
  'Describe the work in plain words at a high level. Do not quote commit messages, list file names or paths, or share anything that looks private or internal.',
  '',
  activity,
].join('\n');

let modelId = '';
const pickModel = async (cfg) => {
  if (cfg.model) return cfg.model;
  if (modelId) return modelId;
  const base = cfg.llmUrl.replace(/\/+$/, '');
  const listed = await (await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000) })).json();
  modelId = (listed?.data || []).map((m) => m.id).find((id) => !/embed/i.test(id)) || '';
  if (!modelId) throw new Error('LM Studio lists no chat model');
  return modelId;
};

const clean = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();

const answer = async (cfg, { system, messages, max_tokens: maxTokens }) => {
  const model = await pickModel(cfg);
  const res = await fetch(`${cfg.llmUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(LLM_MS),
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: Math.min(Number(maxTokens) || 600, 1200),
      messages: [{ role: 'system', content: String(system || '') + liveSection(scan(cfg)) }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`LM Studio ${res.status}`);
  return clean((await res.json())?.choices?.[0]?.message?.content);
};

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 1_000_000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const validMessages = (list) => Array.isArray(list) && list.length > 0 &&
  list.every((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string');

const main = () => {
  const cfg = loadConfig();
  if (process.argv.includes('--scan')) return console.log(scan(cfg));

  http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${cfg.token}`) return send(res, 401, { error: 'Unauthorized' });
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, model: await pickModel(cfg) });
      if (req.method === 'POST' && req.url === '/chat') {
        const body = JSON.parse(await readBody(req));
        if (!validMessages(body.messages)) return send(res, 400, { error: 'Bad messages' });
        const reply = await answer(cfg, body);
        log(`answered (${reply.length} chars)`);
        return send(res, 200, { reply });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      log(`error: ${err.message}`);
      return send(res, 502, { error: err.message });
    }
  }).listen(cfg.port || 8788, '127.0.0.1', () => log(`Listening on http://127.0.0.1:${cfg.port || 8788}`));
};

main();
