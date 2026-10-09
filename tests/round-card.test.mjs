/**
 * Round Card page: date grouping must use the LOCAL date, and the scorecard
 * grid must place each hole's cell in the hole-number column, not the position
 * it happened to be played in.
 *
 *   node tests/round-card.test.mjs   -> exits 0 on success, 1 on failure
 *
 * Like tests/carry-order.test.mjs, this extracts the REAL functions out of
 * dashboard/index.html and executes them, so it cannot drift from the shipped
 * page. If a function is renamed, this file fails loudly.
 *
 * Two bugs this locks down, both of which made a finished round appear missing
 * or wrong on the dashboard:
 *
 *  1. populateRoundDateDropdown keyed its date Map by the LOCAL date but stored
 *     round.date (a UTC timestamp) as the value, then derived each option's
 *     data-date from that timestamp. An evening round is a different calendar
 *     day in UTC, so the option said e.g. "2026-10-09" while populateRoundSelect
 *     filtered on getRoundLocalDate() = "2026-10-08" -- no match, no rounds.
 *
 *  2. holeDetails is built in PLAY ORDER (computeRoundStats walks holeSequence),
 *     but the player rows and the Out/In summary indexed it as detail[h-1] /
 *     detail.slice(0,9). A round not played 1..18 therefore put hole k's score
 *     in column position(k). A round whose play order ends on hole 6 showed
 *     hole 6 in the last column.
 *
 * Note that holeDetails must STAY play-ordered: computeStreaksFromHoles needs
 * consecutive-played order. The fix indexes a per-player copy by hole for the
 * grid instead of reordering the canonical array.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0, checks = 0;
function ok(cond, label, detail = '') {
  checks++;
  if (cond) { console.log(`  PASS  ${label}`); return; }
  failures++;
  console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
}
function eq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), label,
     `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const read = f => readFileSync(join(ROOT, f), 'utf8');

// ── extract a top-level function's source by brace matching (same as carry-order) ──
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`could not find function ${name}()`);
  let i = src.indexOf('{', start), depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

const DASH = read('dashboard/index.html');
const PARS = [4, 4, 3, 4, 4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 3, 4, 4];

// ── load the real functions ────────────────────────────────────────────────
/** populateRoundDateDropdown reads module globals; inject them, return captured state. */
function makeDateDropdown(allRounds) {
  const code = [
    extractFn(DASH, 'getRoundLocalDate'),
    extractFn(DASH, 'populateRoundDateDropdown'),
  ].join('\n');
  const dateSelect = { innerHTML: '' };
  const document = {
    getElementById(id) {
      if (id === 'roundPlayerSelect') return { value: '__all__' };
      if (id === 'roundDateSelect') return dateSelect;
      return {};
    },
  };
  const build = new Function('document', 'allRounds', 'ALL_PLAYERS_VALUE', `
    ${code}
    let roundDatesByDate = [];
    return function () { populateRoundDateDropdown(); return { roundDatesByDate, html: document.getElementById('roundDateSelect').innerHTML }; };
  `);
  return build(document, allRounds, '__all__');
}

/** renderScorecard needs a DOM sink and a few constants. */
function makeScorecard(round) {
  const code = [
    extractFn(DASH, 'getRoundLocalDate'),
    extractFn(DASH, 'buildHoleSequence'),
    extractFn(DASH, 'getCarryInForHole'),
    extractFn(DASH, 'getScoringCode'),
    extractFn(DASH, 'renderScorecard'),
  ].join('\n');
  const container = { innerHTML: '', textContent: '' };
  const document = {
    getElementById(id) { return id === 'round-card-content' ? container : { style: {} }; },
    querySelector() { return { style: {} }; },
  };
  const build = new Function(
    'document', 'filteredRounds', 'coursePars', 'DEFAULT_PARS', 'PLAYER_COLORS', '_selectedPlayer',
    `${code}\nreturn renderScorecard;`
  );
  const render = build(document, [round], {}, PARS, ['#ffffff'], null);
  return { render, container };
}

// ═══ 1. the date dropdown groups by LOCAL date, even for evening rounds ═════
console.log('\n[1] evening rounds group under their LOCAL date');
{
  // The two 2026-10-08 Bridge rounds from production: local Oct 8, UTC Oct 9.
  const allRounds = [
    { localDate: '2026-10-07', date: '2026-10-07T22:00:00.000Z', players: [{ name: 'A' }] },
    { localDate: '2026-10-08', date: '2026-10-09T01:30:00.000Z', players: [{ name: 'B' }] },
    { localDate: '2026-10-08', date: '2026-10-09T02:10:00.000Z', players: [{ name: 'C' }] },
  ];
  const { roundDatesByDate, html } = makeDateDropdown(allRounds)();

  eq(roundDatesByDate, ['2026-10-07', '2026-10-08'], 'dates are the LOCAL days, deduped and sorted');
  ok(html.includes('data-date="2026-10-08"'), 'an option carries data-date 2026-10-08 (local)');
  ok(!html.includes('data-date="2026-10-09"'), 'no option carries the UTC day 2026-10-09');

  // Parity: every option's data-date must match what populateRoundSelect filters on.
  const getLocal = new Function(`${extractFn(DASH, 'getRoundLocalDate')}\nreturn getRoundLocalDate;`)();
  const matched = allRounds.filter(r => getLocal(r) === '2026-10-08');
  eq(matched.length, 2, 'both Oct 8 rounds match the dropdown key (the reported "missing round")');
}

// ═══ 2. the scorecard places hole k in column k, whatever the play order ════
console.log('\n[2] scorecard columns are hole numbers, not play position');
{
  // Start on hole 7, so the play order ENDS on hole 6 -- the reported symptom.
  const order = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6];
  // Each hole scores its own number in points, so a cell's value identifies the
  // hole, and any positional mix-up is visible in the column order.
  const holeDetails = order.map(h => ({ hole: h, points: h, fo: 0, gr: 0, cl: 0, p: 0 }));
  const round = {
    courseName: 'Test', pars: PARS, localDate: '2026-10-08', groupStartTime: '',
    players: [{ name: 'Alice' }],
    holeSequence: order,
    finishedHoles: order,
    scores: { Alice: Array.from({ length: 18 }, () => ({ firstOn: false, closest: false, putt: false })) },
    _playerData: { Alice: { holeDetails, foPts: 0, grPts: 0, clPts: 0, pPts: 0 } },
  };
  const { render, container } = makeScorecard(round);
  render(0);

  const html = container.innerHTML;
  const ni = html.indexOf('>Alice</td>');
  ok(ni !== -1, 'player row was rendered');
  const rowStart = html.lastIndexOf('<tr', ni);
  const rowEnd = html.indexOf('</tr>', ni);
  const row = html.slice(rowStart, rowEnd);
  // The points sub-div is the only "font-size:10px;\">" element carrying a value.
  const cols = [...row.matchAll(/font-size:10px;">([^<]*)<\/div>/g)].map(m => m[1]);

  eq(cols.length, 18, '18 hole cells rendered');
  eq(cols, Array.from({ length: 18 }, (_, i) => String(i + 1)),
     'cells read H1..H18 in column order (hole 6 is NOT in the last column)');
  eq(cols[5], '6', 'hole 6 sits in the hole-6 column');
  eq(cols[17], '18', 'the last column holds hole 18');
}

// ═══ 3. the old positional indexing really was different (regression guard) ═
console.log('\n[3] the removed positional indexing was genuinely wrong');
{
  // Play order ends on hole 6, so detail[5] is hole 12 and detail[17] is hole 6.
  const order = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6];
  const holeDetails = order.map(h => ({ hole: h, points: h }));
  const oldCol = detail => detail[5].points;   // detail[h-1] as the old code read it
  const newCol = detail => detail.find(h => h.hole === 6).points;
  eq(oldCol(holeDetails), 12, 'old indexing put hole 12 in the H6 column');
  eq(newCol(holeDetails), 6, 'hole-indexed lookup puts hole 6 there');
  ok(oldCol(holeDetails) !== newCol(holeDetails), 'the two really do disagree');
}

console.log(`\n================  ${checks - failures} passed, ${failures} failed  ================`);
process.exit(failures ? 1 : 0);
