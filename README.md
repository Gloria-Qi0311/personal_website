# gloriaqi.site

My personal site is a conversation. Instead of scrolling a portfolio, you talk to an AI version of me: ask what I'm building, what I'm good at, or where to start, and it answers in my voice and opens the project it mentions right beside the chat. It runs on a small model on my own laptop, reads my GitHub to know what I'm working on this week, and every answer can be traced.

**Live:** <https://gloriaqi.site>

## Why a conversation

I'm working toward AI product management, and in my own projects I kept running into the same lesson: the model is the easy part, the hard part is trust. A portfolio page could only describe that. So I built my site as a small AI product instead, and had to make the calls I'd make on any real one: what the agent may say, what stays hand-written, and how a wrong answer gets caught and fixed.

## A few details I care about

- **It shows its evidence.** When the agent talks about a project, the project opens on the right, so every claim sits next to the work behind it. Every project panel also has an "Ask about this" button that goes the other way.
- **It's honest about itself.** Answers from my laptop say so, the chat box says the AI can make mistakes, and each answer carries a trace ID visitors can copy. A wrong answer becomes a test case, so the same mistake doesn't ship twice.
- **It never goes stale or silent.** "What are you working on?" comes from my latest GitHub activity, not a line I forgot to update; my project write-ups stay hand-written. If my laptop is off, a cloud model answers; if that's down too, the site answers from its own content.

---

## How it works

```
visitor ──► /api/chat (Cloudflare Worker)
              prompt = my rules (content/agent.json) + site content + recent GitHub activity
              ├─► fixed answer from content/agent.json, if one matches
              ├─► 1. Qwen3.5-9B on my MacBook, through a Cloudflare Tunnel
              ├─► 2. Workers AI, when the laptop is off
              └─► 3. the page answers from its own content
            reply ──► dates removed ──► trace ID ──► logged to D1 (no visitor IPs)
```

- Content lives in `content/*.json` and is edited at `/admin/`. Pages are pre-rendered, with [`/llms.txt`](https://gloriaqi.site/llms.txt) for agents.
- `worker/`: chat API (`index.js`), my rules (`agent.js`), GitHub activity (`github.js`), trace IDs (`trace.js`), `/admin/` sign-in (`cms-auth.js`).
- `evals/bad-cases.json`: every reported bad answer. Check a change with `node scripts/eval-bad-cases.js <site-url>`.
- `node scripts/build.js` rebuilds pages after editing content. Every push to `main` deploys.

Docs: [local model](docs/local-model.md) · [chat rules](docs/chat-rules.md) · [bad cases](docs/bad-cases.md) · [/admin sign-in](docs/admin-login.md)
