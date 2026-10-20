# personal_website

A living **PM-style dashboard** of what I've shipped, what I'm building, and where I'm going. The site is the demo: it shows my product thinking by being a working roadmap.

> Edit content in-browser at `/admin/`. Public visitors read + comment.

## Source vs. artifacts

The repo has two kinds of files. **Only edit the source.**

```
SOURCE (edit these — directly or via /admin/)
├── content/
│   ├── site.json           ← title, description, footer
│   ├── home.json           ← home page: greeting, suggested questions, profile, skills, featured projects
│   ├── profile.json        ← name, slogan, avatar, tags
│   ├── board.json          ← project cards (+ Problem / My work / Outcome fields)
│   ├── lens.json           ← short-form principles
│   └── contact.json        ← email + socials + "open to" line
├── styles/site.css         ← all styles (tokens in :root, dark mode included)
├── scripts/
│   ├── app.js              ← runtime: chat, detail panels, mobile menu
│   ├── build-html.js       ← build:   renders index.html + projects/index.html
│   ├── build-llms.js       ← build:   regen /llms.txt + /llms-full.txt
│   ├── build.js            ← build:   runs both
│   └── install-hooks.sh    ← installs the pre-commit hook (run once)
├── admin/
│   ├── index.html          ← Decap CMS bootstrap
│   └── config.yml          ← collection schemas
├── media/                  ← avatars + other static images
└── favicon.svg

ARTIFACTS (generated — do not hand-edit)
├── index.html              ← built by scripts/build-html.js
├── projects/index.html     ← built by scripts/build-html.js
├── llms.txt                ← built by scripts/build-llms.js
└── llms-full.txt           ← built by scripts/build-llms.js
```

Each generated file carries a `GENERATED — do not edit` banner inside.

### After editing content

```bash
node scripts/build.js
git add . && git commit -m "..."
```

`build.js` rebuilds all three artifacts. They get committed alongside the source so any clone of the repo can deploy without a build step.

### Don't want to remember? Install the hook (one-time)

```bash
bash scripts/install-hooks.sh
```

This adds a `pre-commit` hook that detects changes to `content/*.json`, runs `build.js`, and stages the regenerated artifacts automatically. Once installed, you only ever edit JSON; the artifacts stay in sync on commit.

## How agent-friendly is this?

The site exposes three machine-readable surfaces backed by the same JSON:

- **`/llms.txt`** — short summary per [llmstxt.org](https://llmstxt.org)
- **`/llms-full.txt`** — full content dump in plain text
- **`/content/*.json`** — typed structured data

Plus: cards have stable IDs (`SHIP-01`, `NOW-01`, …) so agents can cite them across conversations, and the home HTML is **pre-rendered** — agents that don't execute JavaScript still see all content.

## Local preview

```bash
npx serve .
# open http://localhost:3000
```

## Edit content

Two paths — pick whichever's faster for the moment.

### A. Browser (Decap CMS)

1. Go to `/admin/` on the deployed site.
2. Sign in with GitHub. (Only repo collaborators can save — single-editor by design. First-time setup: [docs/admin-login.md](docs/admin-login.md).)
3. Edit any collection. Saving commits to `main` directly; the site rebuilds.

> Local dev mode: visit `/admin/?local_backend=true` and run `npx decap-server` in another terminal — no auth, writes straight to the filesystem.

### B. Direct file edits

Edit any `content/*.json` file in your editor or the GitHub web UI. Same outcome.

## Live

Production: <https://gloria-qi.glqi63583.workers.dev>, a Cloudflare Worker (`gloria-qi`). Every push to `main` deploys; pull requests get preview builds.
The same Worker serves the chat API (`worker/`) and the GitHub sign-in for `/admin/` (setup: [docs/admin-login.md](docs/admin-login.md)).

## Add-ons (configured via `content/site.json` or `/admin/`)

### Cloudflare Web Analytics

1. Go to **dash.cloudflare.com → Web Analytics → Add a site**.
2. Copy the token from the embedded `data-cf-beacon='{"token": "..."}'` snippet.
3. Paste into `site.json → analytics.cfAnalyticsToken` (or in `/admin/` → Site meta).
4. Run `node scripts/build.js` and commit. The beacon script gets injected into `<head>` automatically.

Empty token = no script, no tracking.

### Giscus comments

1. **Enable Discussions** on the GitHub repo (Settings → Features → Discussions).
2. Visit <https://giscus.app>, configure for `Gloria-Qi0311/personal_website`, pick a category.
3. Copy the generated `data-repo-id` and `data-category-id` into `site.json → giscus.repoId` and `giscus.categoryId` (or via `/admin/`).
4. Run `node scripts/build.js` and commit. The comments section auto-activates.

While unconfigured, the comments section shows a placeholder.

## Tech stack

- Vanilla HTML / CSS / JS, single-file build script
- [Decap CMS](https://decapcms.org) for in-browser editing (vendored locally — `admin/decap-cms.js`)
- Cloudflare Workers (hosting, chat API, `/admin/` sign-in)
- [Giscus](https://giscus.app) for comments (config-driven via `site.json`)
- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) (config-driven via `site.json`)

## Design

- **Layout:** the home page is a chat with Gloria. Left: profile and navigation (Home, Projects, Skills, Gallery). Center: a welcome, then the conversation. Right: a detail panel for whatever was opened, closed on first visit. `#home`, `#skills` and `#<card-id>` link straight to a panel.
- **Chat:** questions go to `POST /api/chat` (`{messages: [{role, content}]}` → `{reply, source, traceId}`), answered by my local model or a cloud fallback (see `worker/index.js`). If neither is up, `scripts/app.js` answers from the site's own content. A reply that names a project opens it on the right. Chat rules: [docs/chat-rules.md](docs/chat-rules.md).
- **Type:** Instrument Serif (headings) · Inter (everything else).
- All tokens live in `styles/site.css` `:root`. Edit there to retheme globally.
