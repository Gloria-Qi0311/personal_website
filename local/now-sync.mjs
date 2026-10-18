#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   now-sync.mjs — tells the website what Gloria is working on right now.

   Runs on the Mac (by hand or every 30 minutes via launchd):
     1. Reads recent git activity in the folders listed in the config,
        plus an optional hand-written note (~/now.md by default).
     2. Asks the local model in LM Studio to turn that into a short,
        public "what I'm doing now" summary.
     3. Posts it to the site (POST /api/now), where both the local and the
        cloud model read it for every chat.

   Nothing else leaves the Mac: only the summary is uploaded. When the
   activity hasn't changed since the last upload, it does nothing.

   Usage:
     node local/now-sync.mjs            # sync
     node local/now-sync.mjs --dry-run  # print the summary, upload nothing
     node local/now-sync.mjs --force    # sync even if nothing changed

   Config: ~/.gloria-now.json (created with defaults on first run).
   See docs/local-model.md.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const CONFIG = path.join(HOME, '.gloria-now.json');
const STATE = path.join(HOME, '.gloria-now.state');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FORCE = args.has('--force');

const DEFAULTS = {
  siteUrl: 'https://gloria-qi.glqi63583.workers.dev',
  token: '',                          // same value as the Worker's NOW_TOKEN
  llmUrl: 'http://localhost:1235/v1',
  model: '',                          // empty = first chat model LM Studio lists
  dirs: ['~/Projects'],               // folders holding your git repos
  exclude: [],                        // repo folder names to leave out
  authors: [],                        // commit author emails; empty = your git user.email
  days: 7,                            // how far back counts as "now"
  note: '~/now.md',                   // optional note in your own words; wins over git
};

const log = (...m) => console.log(new Date().toISOString(), ...m);
const expand = (p) => p.replace(/^~(?=$|\/)/, HOME);

const loadConfig = () => {
  if (!fs.existsSync(CONFIG)) {
    fs.writeFileSync(CONFIG, `${JSON.stringify(DEFAULTS, null, 2)}\n`);
    log(`Created ${CONFIG}. Fill in "token" and "dirs", then run again.`);
    process.exit(1);
  }
  return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) };
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

const activity = (cfg) => {
  const authors = cfg.authors.length ? cfg.authors : [git(HOME, 'config', '--global', 'user.email')].filter(Boolean);
  const repos = [...new Set(cfg.dirs.map(expand).flatMap((d) => findRepos(d)))]
    .filter((r) => !cfg.exclude.includes(path.basename(r)));
  return repos.map((repo) => {
    const lines = git(repo, 'log', '--all', `--since=${cfg.days} days ago`, '--date=short', '--pretty=format:%ad %s', '-n', '15',
      ...authors.map((a) => `--author=${a}`)).split('\n').filter(Boolean);
    return lines.length ? { name: path.basename(repo), about: blurb(repo), commits: lines } : null;
  }).filter(Boolean).sort((a, b) => b.commits[0].localeCompare(a.commits[0]));
};

const clean = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();

const summarize = async (cfg, note, repos) => {
  const base = cfg.llmUrl.replace(/\/+$/, '');
  let model = cfg.model;
  if (!model) {
    const listed = await (await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000) })).json();
    model = (listed?.data || []).map((m) => m.id).find((id) => !/embed/i.test(id));
    if (!model) throw new Error('LM Studio lists no chat model');
  }
  const facts = [
    note && `MY OWN NOTE (most important, trust it over everything else):\n${note}`,
    repos.length && `RECENT GIT ACTIVITY (last ${cfg.days} days, newest first):\n${repos.map((r) =>
      `## ${r.name}${r.about ? `\nAbout: ${r.about}` : ''}\n${r.commits.map((c) => `- ${c}`).join('\n')}`).join('\n\n')}`,
  ].filter(Boolean).join('\n\n');

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: [
          'You write the "what I\'m working on now" note for Gloria Qi\'s public personal website.',
          'From the facts given, write 3 to 6 Markdown bullets in English, first person, most active work first.',
          'Each bullet: the project name, what it is in plain words, and what I did on it recently.',
          'This is public: no file paths, secrets, keys, emails, private people\'s names, or internal details a stranger should not see.',
          'Use only the facts given. Output only the bullets.',
        ].join('\n') },
        { role: 'user', content: facts },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LM Studio ${res.status}`);
  return clean((await res.json())?.choices?.[0]?.message?.content);
};

const main = async () => {
  const cfg = loadConfig();
  const notePath = cfg.note && expand(cfg.note);
  const note = notePath && fs.existsSync(notePath) ? fs.readFileSync(notePath, 'utf8').trim() : '';
  const repos = activity(cfg);
  if (!note && !repos.length) return log('No recent activity and no note; nothing to sync.');

  const hash = createHash('sha256').update(JSON.stringify({ note, repos })).digest('hex');
  const last = fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8').trim() : '';
  if (hash === last && !FORCE && !DRY) return log('Activity unchanged since last sync; skipping.');

  log(`Summarizing ${repos.length} active repo(s)${note ? ' and your note' : ''}…`);
  const summary = await summarize(cfg, note, repos);
  if (!summary) throw new Error('The model returned an empty summary');
  if (DRY) return console.log(`\n${summary}\n\n(dry run: nothing uploaded)`);

  if (!cfg.token) throw new Error(`Set "token" in ${CONFIG}`);
  const res = await fetch(`${cfg.siteUrl.replace(/\/+$/, '')}/api/now`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ summary }),
  });
  if (!res.ok) throw new Error(`Site answered ${res.status}: ${await res.text()}`);
  fs.writeFileSync(STATE, hash);
  log(`Uploaded:\n${summary}`);
};

main().catch((err) => { log(`now-sync failed: ${err.message}`); process.exit(1); });
