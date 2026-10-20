# gloriaqi.site

My personal site, built as a product: instead of a page to scroll, visitors talk to an AI version of me. Ask what I'm building, what I'm good at, or which project to look at first, and the agent answers in my voice and opens the project it mentions in a side panel.

It runs on a small model on my own laptop (Qwen3.5-9B), with a cloud model as backup, reads my recent GitHub activity so "what are you working on?" is never stale, and every answer carries a trace ID I can look up when it gets something wrong.

**Live:** <https://gloriaqi.site>

---

## The problem

A portfolio answers the questions its author guessed in advance. A recruiter wants "what did you actually build", a collaborator wants "what are you working on right now", and an agent reading on someone's behalf wants structured facts. A static page serves none of them well, and it goes stale the week after it ships.

## Product decisions

| Decision | Why | Trade-off I accepted |
|---|---|---|
| **Chat first, panels second** | Visitors ask their own question; the answer opens the right project card, so the conversation and the evidence stay side by side. | Harder to skim than a grid; the left nav keeps every project one click away. |
| **A local small model, cloud as backup** | Running Qwen on my own laptop keeps the core of the product in my hands and costs nothing per message. | A 9B model follows fewer rules than a frontier model, so rules stay short and the risky ones are enforced in code. |
| **"Now" comes from GitHub, not from me** | Hand-written "currently building" lines were the first thing to go stale. The agent reads my most recently pushed repos instead. | Private repos are described from their name, description and README only: no code, no links. |
| **Hand-curated project panels** | The cards are my portfolio, so I write them myself; automation never overwrites them. | Updating a card is a deliberate act, through `/admin/`. |
| **Every answer is traceable** | "It said something weird" isn't actionable. A trace ID under each answer points to the exact question, answer and model in a log. | A small database (Cloudflare D1) to run; visitor IPs are never stored. |
| **Bad answers become regression tests** | Each reported failure becomes a case that every later change is checked against. | The checks are simple string and pattern rules, not a judge model, which keeps them cheap and predictable. |

## How the chat works

```
visitor ──► /api/chat (Cloudflare Worker)
              │  system prompt = my rules (content/agent.json)
              │                + site content (/llms-full.txt)
              │                + recent GitHub activity (cached 1h)
              ├─► fixed answer from content/agent.json, if one matches (no model)
              ├─► 1. Qwen3.5-9B on my MacBook, through a Cloudflare Tunnel
              ├─► 2. Workers AI, when the laptop is off
              └─► 3. answers from the site's own content, if no model is up
            reply ──► dates stripped ──► trace ID ──► logged to D1
```

- **Persona:** first person, warm and concise, answers in the visitor's language.
- **Agent behavior:** naming a project opens its card on the right; questions about current work are answered only from repos pushed in the last month.
- **Guardrails in code, not just in the prompt:** grounding in site content, private repos never linked or quoted, dates removed from every answer, 10 messages per visitor per minute.
- **My rules, editable without code:** always/never rules, tone, topics to decline and fixed answers live in `content/agent.json` (editable in `/admin/`). See [docs/chat-rules.md](docs/chat-rules.md).

## Measuring quality

- **Trace IDs** (`GQ-YYYYMMDD-XXXXXXXX`) under every answer, with a Copy button. Each one maps to a row in the `chat_logs` table: question, answer, which model answered, deployed version.
- **Bad-case set:** [`evals/bad-cases.json`](evals/bad-cases.json) holds every reported failure with the trace ID it came from, what went wrong and what is expected. Run it before shipping a change:

  ```bash
  node scripts/eval-bad-cases.js https://<preview-or-live-url>
  ```

  How to file a new case: [docs/bad-cases.md](docs/bad-cases.md).

## Site layout

- **Left:** profile and navigation (Home, Projects, Skills, Gallery) plus suggested questions.
- **Center:** the conversation.
- **Right:** a detail panel for whatever was opened. `#home`, `#skills` and `#<card-id>` link straight to a panel.

Pages are pre-rendered from JSON, so people and agents that don't run JavaScript still see all the content. Machine-readable versions live at [`/llms.txt`](https://gloriaqi.site/llms.txt), [`/llms-full.txt`](https://gloriaqi.site/llms-full.txt) and `/content/*.json`.

## Stack

- Vanilla HTML, CSS and JavaScript; build scripts render pages from `content/*.json`.
- One Cloudflare Worker: static assets, the chat API, and the GitHub sign-in for `/admin/`.
- Qwen3.5-9B (MLX) in LM Studio on my MacBook, Workers AI as fallback.
- Cloudflare D1 for answer logs; the Cache API for GitHub activity.
- [Decap CMS](https://decapcms.org) at `/admin/` for editing content in the browser.

## Repository layout

```
content/          source of truth: site, profile, projects (board.json), skills, contact,
                  and the chat's rules (agent.json)
worker/           the Worker
  index.js          routes, system prompt, local → cloud fallback
  agent.js          my chat rules, fixed answers, date stripping
  github.js         recent GitHub activity
  trace.js          trace IDs and the D1 log
  cms-auth.js       GitHub sign-in for /admin/
scripts/          app.js (browser runtime) and build scripts
evals/            bad-case set
docs/             setup and how-tos
admin/            Decap CMS
styles/, media/   styles and images
index.html, projects/index.html, llms*.txt, sitemap.xml   generated — don't hand-edit
```

## Working on it

```bash
node scripts/build.js        # rebuild pages after editing content/*.json
npx wrangler dev             # run the site and the chat API locally
```

`bash scripts/install-hooks.sh` adds a pre-commit hook that rebuilds automatically when content changes. Every push to `main` deploys to <https://gloriaqi.site>; pull requests get their own preview URL.

Docs:

- [docs/local-model.md](docs/local-model.md): connecting the model on my laptop
- [docs/chat-rules.md](docs/chat-rules.md): the chat's rules and fixed answers
- [docs/bad-cases.md](docs/bad-cases.md): trace IDs and the bad-case set
- [docs/admin-login.md](docs/admin-login.md): setting up `/admin/` sign-in

## What's next

- A stable tunnel on my own domain, so the local model doesn't depend on a temporary URL.
- More agent actions beyond opening a project.
- Richer evidence in the project panels: screenshots, diagrams, demo clips.
