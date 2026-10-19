#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   eval-bad-cases.js — re-ask every reported bad case and check the answer.

     node scripts/eval-bad-cases.js https://<preview-or-live-site>

   Reads evals/bad-cases.json. For each case it sends the question to
   /api/chat and applies the case's checks (case-insensitive):
     mustInclude     at least one of these must appear
     mustNotInclude  none of these may appear
   Prints PASS/FAIL with the trace id, and exits 1 if any case fails.
   Run it before merging any change to the chat. Note: answers come from
   whichever model is up (local Qwen first, then Workers AI).
   ════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('Usage: node scripts/eval-bad-cases.js https://<site>');
  process.exit(2);
}
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals', 'bad-cases.json'), 'utf8'));

const check = (answer, { mustInclude = [], mustNotInclude = [] } = {}) => {
  const a = answer.toLowerCase();
  const problems = [];
  if (mustInclude.length && !mustInclude.some((w) => a.includes(w.toLowerCase()))) problems.push(`missing one of: ${mustInclude.join(', ')}`);
  for (const w of mustNotInclude) if (a.includes(w.toLowerCase())) problems.push(`contains "${w}"`);
  return problems;
};

(async () => {
  let failed = 0;
  for (const c of cases) {
    let res, body;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: c.question }] }),
      });
      body = await res.json();
    } catch (err) {
      failed++;
      console.log(`FAIL ${c.id}  request failed: ${err.message}`);
      continue;
    }
    if (!res.ok || !body.reply) {
      failed++;
      console.log(`FAIL ${c.id}  no model answered (${res.status}) ${body.traceId || ''}`);
      continue;
    }
    const problems = check(body.reply, c.checks);
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'PASS'} ${c.id}  [${body.source}] ${body.traceId}  ${problems.join('; ')}`);
    if (problems.length) console.log(`     Q: ${c.question}\n     A: ${body.reply.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
