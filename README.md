# personal_website

A living **PM-style dashboard** of what I've shipped, what I'm building, and where I'm going. The site is the demo: it shows my product thinking by being a working roadmap.

> Edit content in-browser at `/admin/`. Public visitors read + comment.

## Structure

```
.
├── index.html              ← entry: hero + kanban board + lens + contact
├── styles/main.css         ← design tokens + dashboard styles
├── scripts/render.js       ← fetches /content/*.json and populates the DOM
├── content/
│   ├── site.json           ← title, description, footer
│   ├── profile.json        ← name, slogan, audience CTAs, tags
│   ├── board.json          ← project cards (status: shipped/now/next/later)
│   ├── lens.json           ← short-form principles
│   └── contact.json        ← email + socials + "open to" line
├── scripts/
│   ├── render.js           ← dashboard rendering
│   ├── terminal.js         ← embedded Agent Terminal
│   └── build-llms.js       ← regen /llms.txt + /llms-full.txt from JSON
├── llms.txt                ← agent-readable summary (regenerate after edits)
├── llms-full.txt           ← full content dump (same)
└── admin/
    ├── index.html          ← Decap CMS bootstrap
    └── config.yml          ← collection schemas (mirror /content)
```

After editing any file under `content/`, run `node scripts/build-llms.js` to regenerate the agent-readable text files.

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
