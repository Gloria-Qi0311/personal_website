/* ════════════════════════════════════════════════════════════════════════
   worker/agent.js — Gloria's own rules for the chat, from content/agent.json.

   That file is edited in /admin ("Chat assistant") and bundled into the
   Worker at deploy, so a saved change is live after the next build:
     must / mustNot / tone   short rules added to the system prompt
     avoid                   topics to decline, with the reply to give
     faq                     fixed answers, sent as written without the model

   The safety rules (grounding, private repos) stay in worker/index.js, and
   scrubDates() strips dates from every answer, whatever the model does.
   ════════════════════════════════════════════════════════════════════════ */

import settings from '../content/agent.json';

const list = (v) => (Array.isArray(v) ? v.map((s) => String(s || '').trim()).filter(Boolean) : []);

// The rules section of the system prompt; '' when the file is empty.
export const rulesText = (s = settings) => {
  const avoid = (Array.isArray(s.avoid) ? s.avoid : [])
    .filter((a) => a?.topic)
    .map((a) => `${a.topic}: politely decline${a.reply ? `, e.g. "${a.reply}"` : ''}`);
  return [
    ['Always', list(s.must)],
    ['Never', list(s.mustNot)],
    ['Tone', list(s.tone)],
    ['Topics to decline', avoid],
  ]
    .filter(([, lines]) => lines.length)
    .map(([title, lines]) => `${title}:\n${lines.map((l) => `- ${l}`).join('\n')}`)
    .join('\n');
};

const CJK = /[㐀-鿿]/;

// A fixed answer when the question contains one of an entry's keywords.
export const faqAnswer = (question, s = settings) => {
  const q = String(question || '').toLowerCase();
  for (const f of Array.isArray(s.faq) ? s.faq : []) {
    const hit = list(f?.keywords).some((k) => q.includes(k.toLowerCase()));
    if (!hit) continue;
    const answer = (CJK.test(q) && f.answerZh) || f.answer || f.answerZh;
    if (answer) return String(answer).trim();
  }
  return null;
};

// ── Dates ─────────────────────────────────────────────────────────────
// Visitors should hear what Gloria works on, never when. Full dates only
// ("2026-10-19", "2026年10月19日", "October 19, 2026", "Oct 2026");
// a bare year such as "class of 2027" is left alone.
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const YEAR = '(?:19|20)\\d{2}';
const DATE = [
  `${YEAR}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\\d|3[01])`,
  `${YEAR}年\\s*\\d{1,2}月(?:\\s*\\d{1,2}[日号])?`,
  `\\d{1,2}月\\s*\\d{1,2}[日号]`,
  `${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+${YEAR}`,
  `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+${YEAR}`,
  `${MONTH},?\\s+${YEAR}`,
].map((d) => `(?<!\\d)(?:${d})(?!\\d)`).join('|');
const LEAD = '(?:(?:was\\s+|is\\s+)?(?:last\\s+)?(?:updated|worked\\s+on|pushed|modified|committed|active)(?:\\s+on)?|(?:最后|最近)?(?:更新|修改|提交|推送)(?:时间|日期)?(?:于|在|是)?|on|in|since|as\\s+of|于|在)';

const PAREN = new RegExp(`\\s*[(（][^()（）]*(?:${DATE})[^()（）]*[)）]`, 'gi');
const PHRASE = new RegExp(`[,，]?\\s*${LEAD}\\s*[:：]?\\s*(?:${DATE})`, 'gi');
const BARE = new RegExp(`(?:${DATE})`, 'gi');

export const scrubDates = (text) => String(text || '')
  .replace(PAREN, '')
  .replace(PHRASE, '')
  .replace(BARE, '')
  .replace(/[ \t]+([,.;:!?，。；：！？])/g, '$1')
  .replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
  .replace(/^[ \t]*[,.;:，。；：][ \t]*/gm, '')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/[ \t]+$/gm, '')
  .trim();
