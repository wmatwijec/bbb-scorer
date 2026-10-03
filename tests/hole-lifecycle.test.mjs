/**
 * Regression tests for the BBB scorer hole lifecycle.
 *
 *   node tests/hole-lifecycle.test.mjs      -> exits 0 on success, 1 on failure
 *
 * CAVEAT: index.html is a monolith with all logic inlined, so these tests MODEL
 * the state machine rather than importing it. If you change updateNavButtons(),
 * attachNavListeners(), finishCurrentHole() or the Edit handler in index.html,
 * update the model below to match, or these tests will pass while the app is broken.
 *
 * Bugs this suite locks down:
 *   1. attachNavListeners() used onclick=null + addEventListener and was called
 *      from both startRoundWithHole() and resumeRound(). Setting .onclick=null does
 *      NOT remove addEventListener handlers, so after a resume one tap on Next ran
 *      the handler twice and skipped a hole (holes went 1,3,5,7...18,2,4,6...).
 *   2. canNext included `&& (currentHole < HOLES)`, which permanently disabled Next
 *      on hole 18 and killed the wrap, so rounds could not be closed out.
 *   3. Edit removed a hole from finishedHoles but left it in holeSequence, so carry
 *      and running totals were computed against the wrong play order.
 *   4. The Next handler had no finishedHoles guard; only the disabled attribute
 *      prevented skipping.
 *   5. The round-complete banner was keyed to "viewing hole 18" rather than
 *      finishedHoles.size === HOLES, so it vanished when reviewing an earlier hole.
 */
const HOLES = 18;
let pass = 0, fail = 0;

function ok(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); }
  else { fail++; console.log(`  FAIL  ${msg}`); }
}

function eq(actual, expected, msg) {
  ok(actual === expected, msg + `  [got ${actual}]`);
}

function newState(startHole = 1) {
  return { currentHole: startHole, finishedHoles: new Set(), holeSequence: [], navListeners: 1 };
}

// --- index.html updateNavButtons (fixed) ---
const settled = st => st.finishedHoles.has(st.currentHole);
const canPrev = st => {
  const t = st.holeSequence[st.holeSequence.length - 1];
  return settled(st) && (st.currentHole > 1 || (t !== undefined && t !== st.currentHole));
};
const canNext = st => settled(st);

// --- index.html attachNavListeners (fixed: onclick, so always exactly 1 copy) ---
function tapNext(st) {
  if (!canNext(st)) return false;
  for (let i = 0; i < st.navListeners; i++) {
    st.currentHole = st.currentHole < HOLES ? st.currentHole + 1 : 1;
  }
  return true;
}
function tapPrev(st) {
  if (!canPrev(st)) return false;
  // Step back by POSITION IN THE ORDER PLAYED, not by hole number. In a
  // back-nine-first round hole 1 is played 10th and must step back to 18.
  const seq = st.holeSequence.length > 0
    ? st.holeSequence
    : Array.from(st.finishedHoles).sort((a, b) => a - b);
  const seqIdx = seq.indexOf(st.currentHole);
  if (seqIdx <= 0) {
    const last = seq[seq.length - 1];
    if (last === undefined || last === st.currentHole || !st.finishedHoles.has(last)) return false;
    st.currentHole = last;
  } else st.currentHole = seq[seqIdx - 1];
  return true;
}
function finishHole(st) {
  st.finishedHoles.add(st.currentHole);
  if (!st.holeSequence.includes(st.currentHole)) st.holeSequence.push(st.currentHole);
}
function editHole(st) {
  if (!st.finishedHoles.has(st.currentHole)) return false;
  st.finishedHoles.delete(st.currentHole);
  const i = st.holeSequence.indexOf(st.currentHole);
  if (i > -1) st.holeSequence.splice(i, 1);
  return true;
}
const barVisible = st => st.finishedHoles.size === HOLES;

console.log('\n[1] full round, one hole at a time');
{
  const st = newState();
  const visited = [];
  for (let i = 0; i < 18; i++) {
    visited.push(st.currentHole);
    finishHole(st);
    tapNext(st);
  }
  ok(JSON.stringify(visited) === JSON.stringify([...Array(18)].map((_, i) => i + 1)),
     `holes visited in strict order 1..18 (got ${visited.join(',')})`);
  ok(st.finishedHoles.size === 18, `finishedHoles = 18 (got ${st.finishedHoles.size})`);
  ok(barVisible(st), 'round-complete bar is visible');
  ok(canNext(st), 'Next enabled on hole 18 -> wrap works (regression: was disabled)');
}

console.log('\n[2] wrap-around after hole 18, then keep scoring');
{
  const st = newState();
  for (let i = 0; i < 18; i++) { finishHole(st); tapNext(st); }
  ok(st.currentHole === 1, `Next on hole 18 wraps to hole 1 (got ${st.currentHole})`);
  ok(barVisible(st), 'bar still visible after wrapping');
  const before = st.holeSequence.length;
  finishHole(st); tapNext(st);
  ok(st.holeSequence.length === before, 're-finishing hole 1 does NOT duplicate it in sequence');
  ok(st.currentHole === 2, `still navigable to hole 2 (got ${st.currentHole})`);
}

console.log('\n[3] duplicate-listener regression (the odd/odd even/even skip)');
{
  const st = newState();
  // simulate resumeRound() having attached a 2nd copy in the OLD code
  const dup = { ...newState(), navListeners: 2 };
  finishHole(st); tapNext(st);
  ok(st.currentHole === 2, `fresh start: one tap -> hole 2 (got ${st.currentHole})`);
  finishHole(dup); tapNext(dup);
  ok(dup.currentHole === 3, `if listeners WERE duplicated one tap skips to 3 (got ${dup.currentHole}) <- the old mechanism`);
  const fixed = newState();
  finishHole(fixed); tapNext(fixed);
  ok(fixed.currentHole === 2, 'fixed code uses onclick => exactly one advance per tap');
}

console.log('\n[4] cannot leave an unfinished hole in either direction');
{
  const st = newState();
  ok(!canNext(st) && !canPrev(st), 'hole 1 fresh: both buttons locked');
  ok(tapNext(st) === false && tapPrev(st) === false, 'taps are rejected');
  finishHole(st);
  ok(canNext(st) && canPrev(st) === false, 'after Finish: Next opens, Prev still closed at hole 1');
}

console.log('\n[5] edit a prior hole, then move forward');
{
  const st = newState();
  for (let i = 0; i < 5; i++) { finishHole(st); tapNext(st); }
  ok(st.currentHole === 6 && st.finishedHoles.size === 5, 'played 1-5, now on 6');
  st.currentHole = 3;                       // walk back with Prev to review
  ok(editHole(st), 'Edit accepted on finished hole 3');
  ok(st.finishedHoles.size === 4, `hole 3 removed from finished (got ${st.finishedHoles.size})`);
  ok(!st.holeSequence.includes(3), `hole 3 dropped from sequence (got [${st.holeSequence}])`);
  ok(!canNext(st) && !canPrev(st), 'both nav buttons locked until re-finished');
  ok(tapNext(st) === false, 'cannot skip forward while hole 3 is open');
  finishHole(st);
  ok(st.holeSequence[st.holeSequence.length - 1] === 3, `re-finish appends hole 3 at the END (got [${st.holeSequence}])`);
  ok(canNext(st), 'nav unlocked after re-finish');
  tapNext(st);
  ok(st.currentHole === 4, `forward resumes from 3 -> 4 (got ${st.currentHole})`);
}

console.log('\n[6] bar tracks state, not the hole being viewed');
{
  const st = newState();
  for (let i = 0; i < 18; i++) { finishHole(st); tapNext(st); }
  st.currentHole = 12;                 // user taps Prev back to review
  ok(barVisible(st), 'bar STILL visible while viewing hole 12 (old code hid it)');
  st.currentHole = 18;
  ok(barVisible(st), 'bar visible back at hole 18');
  ok(st.finishedHoles.size === 18, 'BBB COMP gate satisfied -> can close out');
}

// ===[ 7 ] back-nine-first round: nav must follow the ORDER PLAYED =========
// index.html's Prev handler used `currentHole === 1` to detect "first hole
// played". That is only true when the round starts on hole 1. In a
// back-nine-first round hole 1 is the 10th hole played, so Prev from hole 1
// jumped to hole 9 (the 18th hole played) instead of hole 18 (the 9th).
console.log('\n[7] start on hole 10: navigation follows play order');
{
  const st = newState(10);
  ok(tapNext(st) === false && tapPrev(st) === false, 'hole 10 fresh: both buttons locked');

  // Play the whole round forward from hole 10: finish, then step.
  for (let i = 0; i < HOLES - 1; i++) { finishHole(st); tapNext(st); }
  finishHole(st);
  eq(st.holeSequence.join(','), '10,11,12,13,14,15,16,17,18,1,2,3,4,5,6,7,8,9',
     'order played is the back nine then the front nine');
  eq(st.finishedHoles.size, HOLES, 'all 18 holes finished');

  // Land on hole 1 (played 10th) and step back: must reach hole 18.
  st.currentHole = 1;
  ok(tapPrev(st), 'Prev accepted on hole 1');
  eq(st.currentHole, 18, 'Prev from hole 1 goes to hole 18 (previous hole PLAYED), not hole 9');

  // Forward from hole 18 (played 9th) goes to hole 1 (played 10th).
  st.currentHole = 18;
  ok(tapNext(st), 'Next accepted on hole 18');
  eq(st.currentHole, 1, 'Next from hole 18 goes to hole 1');

  // First hole played wraps back to the most recently played hole.
  st.currentHole = 10;
  ok(tapPrev(st), 'Prev accepted on hole 10');
  eq(st.currentHole, 9, 'Prev on the first hole played wraps back to the last played (hole 9)');
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
process.exit(fail ? 1 : 0);