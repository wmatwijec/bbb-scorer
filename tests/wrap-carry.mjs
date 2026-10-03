/**
 * KNOWN DEFECT -- documents why wrap-around ("carry keeps running past 18")
 * cannot work in the current data model. Run for a readable report:
 *
 *   node tests/wrap-carry.mjs      -> exits 1 while the defect is present
 *
 * This is NOT a passing test. It is here so the root cause is not rediscovered
 * from scratch, and so the eventual fix can be verified against it.
 *
 * Summary
 * --------
 * Carry-in is resolved by hole NUMBER:
 *     getCarryInForHole(holeNumber) -> holeSequence.indexOf(holeNumber)
 * and holeSequence stores each hole number at most once:
 *     if (!holeSequence.includes(currentHole)) holeSequence.push(currentHole)
 *
 * So holeSequence.indexOf(1) is permanently 0. On the second lap the code sums
 * the holes "before index 0" -- nothing -- and returns a zero carry.
 *
 * Deeper cause: players[].scores is indexed BY HOLE NUMBER (Array(18) of
 * {firstOn, closest, putt}). There is one score slot per hole, so a second lap
 * has nowhere to store its scores; it would overwrite the first lap's.
 * The model is hole-centric while BBB scoring is play-order-centric. The two are
 * only equivalent while play order equals 1..18, which is why every other course
 * and every single-lap round behaves correctly.
 *
 * A real fix re-keys state by play STEP rather than hole number:
 *     scores[i] = { hole: <number>, firstOn, closest, putt }
 * with carry accumulated over steps < i. That also makes "start on hole 10" and
 * out-of-order play correct. It changes the persisted round format, so
 * BBB-Stats.html, Summarizer.html and dashboard/index.html -- which each carry
 * their own copy of getCarryInForHole -- must be migrated in the same change.
 */

// par3 flags for a course with par3s at 3,7,12,16 (typical)
const pars = [4,4,3,4,4,4,3,5,4,4,3,4,4,5,4,3,4,4];

let finishedHoles = new Set();
let holeSequence = [];
let wins = {};           // holeNumber -> bool (did anyone win FO on that hole)

function accumulateCarryForHole(h, carry) {
  const idx = h - 1, isPar3 = pars[idx] === 3;
  const someoneWon = wins[h];
  if (isPar3) { if (someoneWon) carry.greenie = 0; else carry.greenie++; }
  else { if (someoneWon) carry.firstOn = 0; else carry.firstOn++; }
  if (someoneWon) carry.closest = 0; else carry.closest++;
}

function getCarryInForHole(holeNumber) {
  const carry = { firstOn: 0, closest: 0, greenie: 0 };
  if (holeSequence.length === 0) {
    for (let h = 1; h < holeNumber; h++) if (finishedHoles.has(h)) accumulateCarryForHole(h, carry);
    return carry;
  }
  const currentIdx = holeSequence.indexOf(holeNumber);
  if (currentIdx === -1) {
    for (const h of holeSequence) if (finishedHoles.has(h)) accumulateCarryForHole(h, carry);
    return carry;
  }
  for (let i = 0; i < currentIdx; i++) {
    const h = holeSequence[i];
    if (finishedHoles.has(h)) accumulateCarryForHole(h, carry);
  }
  return carry;
}

function finish(h) {
  finishedHoles.add(h);
  if (!holeSequence.includes(h)) holeSequence.push(h);
}

// nobody wins FO all round -> carry should build to 17 FO / 4 GR / 17 CL
for (let h = 1; h <= 18; h++) { wins[h] = false; finish(h); }

console.log('holeSequence:', holeSequence.join(','));
console.log('\ncarry-in on FIRST pass:');
for (const h of [1, 2, 9, 18]) {
  const c = getCarryInForHole(h);
  console.log(`  hole ${String(h).padStart(2)}: FO=${c.firstOn} GR=${c.greenie} CL=${c.closest}`);
}

console.log('\nNow WRAP: all 18 finished, player is on hole 1 again.');
console.log('  holeSequence.indexOf(1) =', holeSequence.indexOf(1), '<-- always 0, even on the 2nd lap');
const c1 = getCarryInForHole(1);
console.log(`  carry-in for hole 1 on 2nd lap: FO=${c1.firstOn} GR=${c1.greenie} CL=${c1.closest}`);
console.log('  EXPECTED if carry carries over: FO=17 GR=4 CL=17 (nobody won all 18)');

const carryWorks = c1.firstOn === 17 && c1.greenie === 4 && c1.closest === 17;
console.log(`  -> ${carryWorks ? 'OK' : 'BROKEN: wrap carry is lost'}`);
console.log(carryWorks
  ? '\nWrap-around carry now works; update the header comment in this file.'
  : '\nDefect still present. See the header comment for the root cause.');
process.exit(carryWorks ? 0 : 1);