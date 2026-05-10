# personal_website

A living **PM-style dashboard** of what I've shipped, what I'm building, and where I'm going. The site is the demo: it shows my product thinking by being a working roadmap.

> Edit content in-browser at `/admin/`. Public visitors read + comment.

## Source vs. artifacts

The repo has two kinds of files. **Only edit the source.**

```
SOURCE (edit these — directly or via /admin/)
├── content/
│   ├── site.json           ← title, description, footer
│   ├── profile.json        ← name, slogan, audience CTAs, tags
│   ├── board.json          ← project cards (status: shipped/now/next/later)
│   ├── lens.json           ← short-form principles
│   └── contact.json        ← email + socials + "open to" line
├── styles/main.css         ← design tokens + dashboard styles
├── scripts/
│   ├── render.js           ← runtime: hydrates the page for interactive use
│   ├── terminal.js         ← runtime: embedded Agent Terminal
│   ├── build-html.js       ← build:   pre-renders content into index.html
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

> Note: this is a "stay simple now, switch to deploy-time builds later" choice (issue #X). When the site moves to Cloudflare Pages / Vercel, the build will run on the host instead and the artifacts won't need to live in git.

## Resume in your terminal

```bash
npx antares-cv
```

Single-file Node CLI in `cli/` that fetches `content/*.json` from the live site and prints a colored resume. Same data as the website, terminal-shaped. See [`cli/README.md`](cli/README.md) for options (`--full`, `--json`, `--no-color`).

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
2. Sign in with GitHub. (Only repo collaborators can authenticate — single-editor by design.)
3. Edit any collection. Saving commits to `main` directly; the site rebuilds.

> Local dev mode: visit `/admin/?local_backend=true` and run `npx decap-server` in another terminal — no auth, writes straight to the filesystem.

### B. Direct file edits

Edit any `content/*.json` file in your editor or the GitHub web UI. Same outcome.

## Roadmap

See [Issue #39](https://github.com/AntaresYuan/personal_website/issues/39) for the live phase plan.

## Tech stack

- Vanilla HTML / CSS / JS (no build step)
- [Decap CMS](https://decapcms.org) for in-browser editing
- [Giscus](https://giscus.app) for comments (planned, see #49)
- Hosting: TBD — Cloudflare Pages / Vercel / GitHub Pages (see #53)

## Design

- **Palette:** warm yellow (`#F5C518`) primary, cobalt blue (`#2347D9`) accent, cream (`#FAF7F0`) background.
- **Type:** Inter (body) · Fraunces (display) · JetBrains Mono (accent).
- All tokens live in `styles/main.css` `:root`. Edit there to retheme globally.
