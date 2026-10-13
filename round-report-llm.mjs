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

async function callLlm(prompt) {
  const resp = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS, temperature: 0.8 }),
  });
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  const choice = j.choices && j.choices[0];
  if (!choice) throw new Error('LLM returned no choices');
  const msg = choice.message || {};
  // The model (bonsai, reasoning-effort medium) spends most of its budget on
  // chain-of-thought in reasoning_content and puts the final recap in content.
  // Only if content never arrives do we fall back to a trimmed reasoning tail.
  let content = (msg.content || '').trim();
  if (!content && msg.reasoning_content) {
    const reas = String(msg.reasoning_content).trim();
    // Take the last few sentences, dropping "Let me"/checklist preamble.
    content = reas.split('\n').filter(l => /[.!?]\s*$/.test(l)).slice(-4).join(' ') || reas.slice(-300);
  }
  // Drop any leaked CoT preamble: leading "Let me ..." / checklist lines.
  const lines = content.split('\n').filter(l => {
    const t = l.trim();
    return t && !/^(let me|i(‘|\x27)?ll|ok|okay|first|next|checklist:)/i.test(t) && !/^\s*[-*]\s*(\w+:)/.test(t) && !/^\s*\d+[.:]\s*\w+/.test(t);
  });
  content = lines.join('\n');
  return content.slice(0, 700);
}

async function main() {
  const date = process.argv[2] || centralToday();
  console.log(`Fetching preview for ${date} from ${BACKEND}...`);

  const previewResp = await fetch(`${BACKEND}/round-report/preview?date=${encodeURIComponent(date)}`);
  if (!previewResp.ok) {
    const body = await previewResp.text();
    if (previewResp.status === 404) { console.log(`No rounds for ${date} — nothing to report.`); process.exit(0); }
    throw new Error(`preview HTTP ${previewResp.status}: ${body}`);
  }
  const { rounds } = await previewResp.json();

  const needs = rounds.filter(r => !r.reportedAt);
  if (!needs.length) { console.log(`All ${rounds.length} round(s) already reported — skipping.`); process.exit(0); }
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
Records: ${r.records.length ? r.records.map(x => `${x.player} ${x.kind} ${x.category} (was ${x.was}) -> ${x.now}`).join('; ') : 'none'}`;

    highlights[r.matchId] = await callLlm(prompt);
    console.log(`    -> ${highlights[r.matchId].slice(0, 120)}...`);
  }

  const sendResp = await fetch(`${BACKEND}/round-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, highlights }),
  });
  const body = await sendResp.json();
  console.log(`Sent: ${JSON.stringify(body)}`);
  if (!body.success) process.exit(1);
}

main().catch(err => { console.error('Failed:', err.message); process.exit(1); });