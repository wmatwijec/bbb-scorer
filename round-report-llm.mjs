#!/usr/bin/env node
// BBB Round Report — local LLM highlights generator + sender.
//
// Runs on Walt's machine (where the local LLM lives). Render can't reach
// localhost, so the pipeline is:
//   1. GET  {BACKEND}/round-report/preview?date=YYYY-MM-DD
//   2. For each round, build a recap prompt and call the local llama-server.
//   3. POST {BACKEND}/round-report with { date, highlights } — the backend
//      emails (to REPORT_RECIPIENT) and marks reportedAt.
//
// Safe to run many times: the backend dedupes via reportedAt.
//
// Usage:
//   BACKEND=https://... node round-report-llm.mjs                  # today
//   BACKEND=https://... node round-report-llm.mjs 2026-10-12       # specific day
//   BACKEND=https://... node round-report-llm.mjs 2026-10-12 --force  # re-send even if reported

const BACKEND = process.env.BACKEND || 'https://pwa-players-backend.onrender.com';
const LLM_URL = process.env.LLM_URL || 'http://127.0.0.1:8899/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'Ternary-Bonsai-2-27B-PTQ1_0-mtp';
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 3500);

function centralToday() {
  // Match backend getLocalDate: Central (UTC-5 during CDT).
  const d = new Date();
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const centralMs = utcMs + (-5 * 60) * 60000;
  const c = new Date(centralMs);
  return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
}

function scorecardsToText(grid) {
  return grid.map(r => {
    const holes = r.cells.map((c, i) => `${i + 1}:${c.text || '-'}`).join(' ');
    return `  ${r.name} [total ${r.total}] ${holes}`;
  }).join('\n');
}

// Strip leaked chain-of-thought and keep only the recap prose. Reasoning models
// (bonsai) sometimes emit working, arithmetic, and "YES!" checks in content.
function cleanRecap(raw) {
  let t = String(raw || '').trim();
  const m = t.match(/<recap>([\s\S]*?)<\/recap>/i);
  if (m) t = m[1].trim();
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean).filter(l =>
    !/^(let me|i(‘|\x27)?ll|ok\b|okay|first\b|next\b|checklist|step\b|hmm\b)/i.test(l) &&
    !/^\s*[-*]\s/.test(l) && !/^\s*\d+[.):]\s/.test(l) &&
    !/=/.test(l) && !/\bcarr(y|ied|ies) (value|adds?)\b/i.test(l) &&
    !/\b(YES|NO|WAIT|total:|let me check|that works)\b/i.test(l)
  );
  let out = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!out) {
    out = t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(s => !/=/.test(s)).slice(-3).join(' ').trim();
  }
  return out.slice(0, 700);
}

async function callLlm(prompt) {
  const system = 'You write terse recaps of a friends\' golf points game (MOST POINTS WINS). ' +
    'Output ONLY the final 3-sentence recap wrapped in <recap></recap>. ' +
    'Never show working, arithmetic, checking, or deliberation. ' +
    'Never mention beer, alcohol, liquor, "clean streak", or "no-carry". ' +
    'No jokes, no meta, no questions.';
  const resp = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.4,
    }),
  });
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  const choice = j.choices && j.choices[0];
  if (!choice) throw new Error('LLM returned no choices');
  const msg = choice.message || {};
  // Prefer the recap block in content; fall back to the reasoning tail only if
  // content is empty. Both paths pass through cleanRecap().
  let content = cleanRecap(msg.content || '');
  if (!content && msg.reasoning_content) content = cleanRecap(msg.reasoning_content);
  return content;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const date = args.find(a => !a.startsWith('--')) || centralToday();
  console.log(`Fetching preview for ${date} from ${BACKEND}...`);

  const previewResp = await fetch(`${BACKEND}/round-report/preview?date=${encodeURIComponent(date)}`);
  if (!previewResp.ok) {
    const body = await previewResp.text();
    if (previewResp.status === 404) { console.log(`No rounds for ${date} — nothing to report.`); process.exit(0); }
    throw new Error(`preview HTTP ${previewResp.status}: ${body}`);
  }
  const { rounds } = await previewResp.json();

  const needs = force ? rounds : rounds.filter(r => !r.reportedAt);
  if (!needs.length) { console.log(`All ${rounds.length} round(s) already reported — skipping.`); process.exit(0); }
  if (force) console.log(`--force: re-sending ${needs.length} round(s).`);
  console.log(`${needs.length} round(s) need highlights.`);

  const highlights = {};
  for (let i = 0; i < needs.length; i++) {
    const r = needs[i];
    console.log(`  generating highlight for ${r.matchId} (${r.course})...`);
    const prompt = `Short recap of a BBB round (friends' golf points game, NOT regular golf -- most points wins). Never mention beer, alcohol, or liquor. Never mention 'clean streak' or 'no-carry' records.

3 short factual sentences: winner + totals, momentum (who led / who pushed), one highlight. No jokes, no meta talk.

ROUND DATA:
Course: ${r.course}
Date: ${r.date}
Play sequence: ${r.holeSequence.join('-')}
Totals: ${Object.entries(r.totals).map(([n, p]) => `${n} ${p}`).join(', ')}
Result: ${r.winnersText}
Scorecard (H1-H18 in scorecard order; repeated letters = carry):
${scorecardsToText(r.grid)}
Records: ${r.records.length ? r.records.map(x => `${x.player} ${x.kind} ${x.category} (was ${x.was}) -> ${x.now}`).join('; ') : 'none'}

Write the recap now inside <recap></recap>. Exactly 3 short sentences. No working shown.`;

    highlights[r.matchId] = await callLlm(prompt);
    console.log(`    -> ${highlights[r.matchId].slice(0, 120)}...`);
  }

  const sendResp = await fetch(`${BACKEND}/round-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(force ? { date, highlights, force: true } : { date, highlights }),
  });
  const body = await sendResp.json();
  console.log(`Sent: ${JSON.stringify(body)}`);
  if (!body.success) process.exit(1);
}

main().catch(err => { console.error('Failed:', err.message); process.exit(1); });