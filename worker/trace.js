/* ════════════════════════════════════════════════════════════════════════
   worker/trace.js — a trace id for every chat answer, and a log of it.

   Each answer gets an id like GQ-20261019-E3967B0C, shown under the answer
   on the page. The question, answer and which model answered are stored in
   D1 (binding DB) so a reported id can be looked up later. No IP or other
   visitor details are stored. Without the DB binding, ids still work and
   logging is skipped.

   Look one up in the Cloudflare dashboard (D1 → gloria-chat-logs → Console):
     SELECT * FROM chat_logs WHERE trace_id = 'GQ-20261019-E3967B0C';
   ════════════════════════════════════════════════════════════════════════ */

export const newTraceId = (now = new Date()) => {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  const rand = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `GQ-${day}-${rand}`;
};

let ready = false;
const ensureTable = async (db) => {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS chat_logs (
    trace_id   TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    question   TEXT NOT NULL,
    answer     TEXT,
    source     TEXT NOT NULL,
    history    TEXT,
    version    TEXT
  )`).run();
  ready = true;
};

// row: { traceId, question, answer, source, history, version }
export const logAnswer = async (env, row) => {
  if (!env.DB) return;
  try {
    await ensureTable(env.DB);
    await env.DB.prepare('INSERT INTO chat_logs (trace_id, created_at, question, answer, source, history, version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(row.traceId, new Date().toISOString(), row.question, row.answer ?? null, row.source, JSON.stringify(row.history ?? []), row.version ?? null)
      .run();
  } catch (err) {
    console.log(`trace: log failed: ${err?.message || err}`);
  }
};
