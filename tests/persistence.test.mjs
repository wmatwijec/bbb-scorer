/**
 * Regression tests for the interrupted-round recovery (local persistence).
 *
 *   node tests/persistence.test.mjs   -> exits 0 on success, 1 on failure
 *
 * Bugs this suite locks down:
 *   1. resetRound() cleared only localStorage['bbb'], never the IndexedDB slot,
 *      so a finished or abandoned round was offered for resume on the next launch.
 *   2. completeRound() re-saved the local slot and never cleared it, so a round
 *      that was already finished kept prompting "resume?".
 *   3. showRoundSelection() treated any finishedHoles.length < 18 as resumable,
 *      including empty shells and rounds whose sequence was never persisted.
 *   4. loadCloudRounds() queried the UTC date; after ~7 PM CDT that is tomorrow,
 *      so today's rounds were not found and evening recovery broke.
 *   5. The startup flow re-prompted on every launch until a fresh round was
 *      started, so it took more than one "continue (or not)" to move on.
 *   6. Edit removed the hole from holeSequence, shifting carries and totals;
 *      toggleScore also wrote a stale local snapshot before the full save.
 *   7. resumeRound() did not restore matchId, and Next ignored play order.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); };

/** Extract a top-level `function NAME(...) { ... }` by brace matching. */
function extractFn(name) {
  const i = SRC.indexOf(`function ${name}(`);
  if (i === -1) return null;
  // Walk the parameter list to its closing ')' first: a default parameter
  // like `{ retries = 1 }` otherwise looks like the function body.
  const p = SRC.indexOf('(', i);
  let pd = 0, j = p;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '(') pd++;
    else if (SRC[j] === ')') { pd--; if (pd === 0) { j++; break; } }
  }
  const b = SRC.indexOf('{', j);
  let depth = 0, k = b;
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return SRC.slice(i, k);
}

const isResumable = new Function(`${extractFn('isResumable')}; return isResumable;`)();

const full = () => Array.from({ length: 18 }, () => ({}));
const markers = () => Array.from({ length: 18 }, (_, i) => (i === 0 ? { closest: true } : {}));

console.log('\n[1] isResumable: only genuine mid-rounds are offered');
{
  ok(isResumable({ finishedHoles: [1, 2, 3] }), 'partial round (3/18) is resumable');
  ok(!isResumable({ finishedHoles: Array.from({ length: 18 }, (_, i) => i + 1) }), 'finished round (18/18) is NOT resumable');
  ok(!isResumable({ finishedHoles: [], scores: { Bill: full() } }), 'empty shell (0 finished, no markers) is NOT resumable');
  ok(isResumable({ finishedHoles: [], scores: { Bill: markers() } }), 'has markers but no sequence is resumable');
  ok(!isResumable({}), 'empty object is NOT resumable');
}

console.log('\n[2] centralToday() uses the play (Central) date, not UTC');
{
  // 2026-10-20T02:00Z is 9 PM CDT on 2026-10-19: UTC says the 20th.
  const T = Date.UTC(2026, 9, 20, 2, 0, 0);
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(arg) { super(arg === undefined ? T : arg); }
    getTimezoneOffset() { return 0; }
  }
  const centralToday = new Function('Date', `${extractFn('centralToday')}; return centralToday;`)(FakeDate);
  ok(centralToday() === '2026-10-19', `evening maps to the play date (got ${centralToday()})`);
  ok(RealDate.prototype.toISOString.call(new RealDate(T)).slice(0, 10) === '2026-10-20', 'UTC would have said 2026-10-20');
}

console.log('\n[4] loadCloudRounds() queries the Central date');
{
  const fn = extractFn('loadCloudRounds');
  ok(!!fn, 'loadCloudRounds() found');
  ok(/centralToday\(\)/.test(fn), 'loadCloudRounds() uses centralToday()');
  ok(!/toISOString\(\)\.slice\(0, 10\)/.test(fn), 'loadCloudRounds() no longer uses the UTC date');
}

console.log('\n[3] resetRound() and completeRound() clear the local IndexedDB slot');
{
  const reset = extractFn('resetRound');
  const complete = extractFn('completeRound');
  ok(/clearRoundLocal\(\)/.test(reset), 'resetRound() clears the local round');
  ok(/clearRoundLocal\(\)/.test(complete), 'completeRound() clears the local round');
}

console.log('\n[5] startup offers the freshest local round once, then settles');
{
  const startup = SRC.slice(SRC.indexOf('Check for saved local round first'));
  ok(/isResumable\(saved\)/.test(startup), 'startup checks the local round with isResumable()');
  ok(/Resume round in progress\?/.test(startup), 'startup prompts once to resume in-progress local round');
  ok(/saved && !isResumable\(saved\)/.test(startup), 'startup drops a stale (finished/empty) local round');
}

console.log('\n[6] cloud save: await, retry, and keep the phone copy until confirmed');
{
  ok(SRC.includes('async function completeRound'), 'completeRound() is async');
  const complete = extractFn('completeRound');
  ok(/await saveRoundEverywhere/.test(complete), 'completeRound() awaits the cloud save');
  ok(/result\.ok/.test(complete), 'completeRound() reads the save result');
  ok(/if \(result\.ok\)[\s\S]*clearRoundLocal/.test(complete), 'completeRound() clears the phone copy only after the server confirms');
  ok(!/saveRoundEverywhere\(\);[\s\S]{0,80}clearRoundLocal/.test(complete), 'completeRound() no longer deletes before the save');

  const upload = extractFn('uploadRound');
  ok(!!upload, 'uploadRound() exists');
  ok(/BACKEND\}\/save-round/.test(upload), 'uploadRound() posts to the backend');
  ok(/AbortController/.test(upload), 'uploadRound() has a timeout');
  ok(/attempt < retries/.test(upload), 'uploadRound() retries');

  const save = extractFn('saveRoundEverywhere');
  ok(/await uploadRound/.test(save), 'saveRoundEverywhere() awaits the upload result');
  ok(/pendingUpload = true/.test(save), 'saveRoundEverywhere() marks the phone copy pending');
  ok(/pendingUpload = false/.test(save), 'saveRoundEverywhere() clears pending only after success');
  ok(/function syncPendingRound/.test(SRC), 'syncPendingRound() exists for retries on launch/online');

  const local = extractFn('saveRoundLocal');
  ok(/idbDone/.test(local), 'saveRoundLocal() waits on the real transaction event');
  ok(!/tx\.complete/.test(SRC), 'no transaction.complete usages remain');

  const startup = SRC.slice(SRC.indexOf('Check for saved local round first'));
  ok(/pendingUpload/.test(startup), 'startup retries a pending upload');
  ok(!/if \(saved && !isResumable\(saved\)\) \{ await clearRoundLocal/.test(startup), 'startup does not blindly delete a pending round');
}

console.log('\n[7] editing preserves play order and never writes a stale local snapshot');
{
  const editStart = SRC.indexOf("const edit = document.getElementById('editHole')");
  const editBlock = SRC.slice(editStart, SRC.indexOf("document.addEventListener('DOMContentLoaded'", editStart));
  ok(/finishedHoles\.delete\(currentHole\)/.test(editBlock), 'Edit removes the hole from finishedHoles');
  ok(!/holeSequence\.splice/.test(editBlock), 'Edit does not remove the hole from holeSequence');
  ok(/updateHole\(\)/.test(editBlock), 'Edit repaints through updateHole()');

  const toggle = extractFn('toggleScore');
  ok(!/\bsave\(\);/.test(toggle), 'toggleScore() does not write a stale local snapshot');
  ok(/updateHole\(\)/.test(toggle), 'toggleScore() saves the full snapshot via updateHole()');

  const resume = extractFn('resumeRound');
  ok(/currentMatchId\s*=\s*round\.matchId/.test(resume), 'resumeRound() restores matchId');

  const navStart = SRC.indexOf("const next = document.getElementById('nextHole')");
  const navBlock = SRC.slice(navStart, SRC.indexOf("const edit = document.getElementById('editHole')", navStart));
  ok(/holeSequence/.test(navBlock), 'Next follows play order when a next played hole exists');
  ok(/currentHole < HOLES \? currentHole \+ 1 : 1/.test(navBlock), 'Next still advances to the next unplayed hole at the end of the sequence');
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
process.exit(fail ? 1 : 0);
