/**
 * Carry-in must be computed in the ORDER PLAYED, not by hole number.
 *
 *   node tests/carry-order.test.mjs   -> exits 0 on success, 1 on failure
 *
 * The app offers "Start on Hole 1" or "Start on Hole 10 (Back Nine First)".
 * A 10-start round is played and stored as holeSequence [10..18,1..9], so
 * hole 1 is the 10th hole played. Carry-in ("keep the streak alive") is defined
 * over the sequence of holes played, so computing it over 1..holeNumber-1
 * credits the wrong holes and changes the totals for both halves of the round.
 *
 * Unlike tests/hole-lifecycle.test.mjs, this suite does NOT model the logic.
 * It extracts the real getCarryInForHole / buildHoleSequence source out of the
 * shipped HTML and executes it, so the test cannot silently drift from the app.
 * If a function is renamed or its signature changes, this file fails loudly.
 *
 * History: the three reporting consumers each rebuilt their own sequence and
 * hardcoded [1..18] whenever a round had 18 finished holes, so a 10-start round
 * was scored one way live and a different way in the dashboard and stats pages.
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

// ── extract a top-level function's source by brace matching ────────────────
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`could not find function ${name}()`);
  let i = src.indexOf('{', start), depth = 0;
  let quote = null;
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
const read = f => readFileSync(join(ROOT, f), 'utf8');

// ── load the real implementations ─────────────────────────────────────────
// The three report pages take everything as arguments, so they load directly.
function loadReportImpl(file) {
  const src = read(file);
  const code = [extractFn(src, 'getCarryInForHole'), extractFn(src, 'buildHoleSequence')].join('\n');
  return new Function(`${code}\nreturn { getCarryInForHole, buildHoleSequence };`)();
}
const summarizer = loadReportImpl('Summarizer.html');
const dashboard  = loadReportImpl('dashboard/index.html');
const bbbStats   = loadReportImpl('BBB-Stats.html');

// index.html reads module-level globals, so inject them into its scope instead.
function loadAppImpl(state) {
  const src = read('index.html');
  const code = [
    extractFn(src, 'accumulateCarryForHole'),
    extractFn(src, 'getCarryInForHole'),
  ].join('\n');
  const names = ['players', 'courses', 'currentCourse', 'finishedHoles', 'holeSequence'];
  const vals  = [state.players, state.courses, state.currentCourse, state.finishedHoles, state.holeSequence];
  const fn = new Function(...names, `${code}\nreturn getCarryInForHole;`);
  return fn(...vals);
}

// ── fixtures ──────────────────────────────────────────────────────────────
// Holes 2, 4, 11 and 13 are par 3 -- two in each nine -- so the greenie carry
// actually MOVES between the two play orders, and the test can tell them apart.
// Note carry-in only increments on a hole that did NOT reset the streak, and a
// par 3 credits the greenie counter rather than first-on, so firstOn and greenie
// are NOT simply "count of holes played before".
const PARS = [4, 3, 4, 3, 4, 4, 4, 4, 4, 4, 4, 3, 4, 3, 4, 4, 4, 4];
const PLAYERS = ['Alice', 'Bob'];

/** Build a round. `order` is the order played; nobody wins anything. */
function makeRound(order) {
  const scores = {};
  for (const name of PLAYERS) {
    scores[name] = Array.from({ length: 18 }, () => ({ firstOn: false, closest: false, putt: false }));
  }
  const round = {
    pars: PARS,
    scores,
    players: PLAYERS.map(n => ({ name: n })),
    holeSequence: order.slice(),
    finishedHoles: order.slice(),
  };
  return round;
}
const ASC = Array.from({ length: 18 }, (_, i) => i + 1);
const TEN_FIRST = [...Array.from({ length: 9 }, (_, i) => i + 10), ...Array.from({ length: 9 }, (_, i) => i + 1)];

/** Transpose to the { holeIdx: { name: score } } shape the report pages take. */
function transpose(round) {
  const holeScores = {};
  for (let idx = 0; idx < 18; idx++) holeScores[idx] = {};
  for (const [name, arr] of Object.entries(round.scores)) arr.forEach((s, idx) => { holeScores[idx][name] = s || {}; });
  return holeScores;
}
/** Carriers for every hole, using one report implementation. */
function carriersVia(impl, round) {
  const holeScores = transpose(round);
  const seq = impl.buildHoleSequence(round);
  const out = {};
  for (let idx = 0; idx < 18; idx++) {
    const c = impl.getCarryInForHole(holeScores, round.pars, idx + 1, seq);
    out[idx + 1] = `${c.firstOn}/${c.greenie}/${c.closest}/${c.putt}`;
  }
  return out;
}
const IMPLS = [
  ['Summarizer.html', summarizer],
  ['dashboard/index.html', dashboard],
  ['BBB-Stats.html', bbbStats],
];

// ═══ 1. ascending start: everyone agrees, carry counts holes played before ═
console.log('\n[1] start on hole 1 -> order played [1..18]');
{
  const round = makeRound(ASC);
  const base = carriersVia(summarizer, round);
  eq(base[1], '0/0/0/0', 'hole 1 (played 1st) has zero carry-in');
  eq(base[2], '1/0/1/1', 'hole 2 (played 2nd): 1 hole before it, par 4 -> FO+1');
  eq(base[10], '7/2/9/9', 'hole 10 (played 10th) carries 7 FO / 2 GR');
  eq(base[18], '13/4/17/17', 'hole 18 (played 18th): 17 before, 4 par 3 -> FO 13 / GR 4');
  for (const [name, impl] of IMPLS) eq(carriersVia(impl, round), base, `${name} agrees`);
}

// ═══ 2. back-nine-first: carry follows play order, NOT hole number ════════
console.log('\n[2] start on hole 10 -> order played [10..18,1..9]');
{
  const round = makeRound(TEN_FIRST);
  const base = carriersVia(summarizer, round);
  // The decisive assertions. Hole 10 is played FIRST, so it must carry nothing.
  // Under the old 1..holeNumber-1 logic it saw holes 1-9 (already finished by
  // round end) and reported a carry of 7 that does not exist.
  eq(base[10], '0/0/0/0', 'hole 10 (played 1st) has zero carry-in');
  eq(base[18], '6/2/8/8', 'hole 18 (played 9th) carries 6 FO / 2 GR');
  eq(base[1],  '7/2/9/9', 'hole 1 (played 10th) carries 7 FO / 2 GR -- from holes 10-18');
  eq(base[9],  '13/4/17/17', 'hole 9 (played 18th): 17 before, 4 par 3 -> FO 13 / GR 4');
  for (const [name, impl] of IMPLS) eq(carriersVia(impl, round), base, `${name} agrees`);
}

// ═══ 3. the live app computes the same thing as the reports ═══════════════
console.log('\n[3] index.html agrees with the reporting pages');
{
  for (const [label, order] of [['1-start', ASC], ['10-start', TEN_FIRST]]) {
    const round = makeRound(order);
    const players = PLAYERS.map(n => ({ name: n, scores: round.scores[n] }));
    const state = {
      players,
      courses: { test: { pars: PARS } },
      currentCourse: 'test',
      finishedHoles: new Set(round.finishedHoles),
      holeSequence: round.holeSequence,
    };
    const getCarry = loadAppImpl(state);
    const viaApp = {};
    const viaReport = carriersVia(summarizer, round);
    for (let idx = 0; idx < 18; idx++) {
      const c = getCarry(idx + 1);
      viaApp[idx + 1] = `${c.firstOn}/${c.greenie}/${c.closest}/${c.putt}`;
    }
    eq(viaApp, viaReport, `app carry matches reports for a ${label} round`);
  }
}

// ═══ 4. the old fabricated sequence really was different (regression guard) ═
console.log('\n[4] the removed [1..18] shortcut was genuinely wrong');
{
  const round = makeRound(TEN_FIRST);
  const holeScores = transpose(round);
  const fabricated = ASC; // what the reports used to build for an 18-hole round
  const oldCarry = bbbStats.getCarryInForHole(holeScores, PARS, 10, fabricated);
  const newCarry = bbbStats.getCarryInForHole(holeScores, PARS, 10, TEN_FIRST);
  eq(oldCarry.firstOn, 7, 'old logic reported carry 7 into hole 10');
  eq(newCarry.firstOn, 0, 'play-order logic reports carry 0 into hole 10');
  ok(oldCarry.firstOn !== newCarry.firstOn, 'the two orders really do disagree');
}

// ═══ 5. legacy rounds with no holeSequence fall back to ascending ════════
console.log('\n[5] legacy rounds (no persisted holeSequence)');
{
  const legacy = makeRound(ASC);
  delete legacy.holeSequence;
  const expected = carriersVia(summarizer, makeRound(ASC));
  for (const [name, impl] of IMPLS) {
    eq(carriersVia(impl, legacy), expected, `${name} falls back to ascending order`);
  }
  // and a partial legacy round
  const partial = makeRound(ASC.slice(0, 6));
  delete partial.holeSequence;
  for (const [name, impl] of IMPLS) {
    const seq = impl.buildHoleSequence(partial);
    eq(seq, ASC.slice(0, 6), `${name} builds [1..6] from finishedHoles`);
  }
}

// ═══ 6. a partial 10-start round is not gated out by a length-18 check ════
console.log('\n[6] partial 10-start round');
{
  const partial = TEN_FIRST.slice(0, 4);           // holes 10,11,12,13 played
  const round = makeRound(partial);
  for (const [name, impl] of IMPLS) {
    eq(impl.buildHoleSequence(round), partial, `${name} uses the real partial sequence`);
  }
  const viaReport = carriersVia(summarizer, round);
  eq(viaReport[10], '0/0/0/0', 'hole 10 (played 1st) zero carry');
  eq(viaReport[13], '2/1/3/3', 'hole 13 (played 4th) carries 2 FO / 1 GR');
  // Holes 1-9 are NOT finished, so they must contribute nothing to hole 10.
  ok(!viaReport[10].startsWith('7'), 'unplayed front nine does not leak into hole 10 carry');
}

console.log(`\n================  ${checks - failures} passed, ${failures} failed  ================`);
process.exit(failures ? 1 : 0);