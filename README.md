# Bingo Bango Bongo

App to score this golf game — while you are on the golf course.

Vanilla JS PWA, no build step. Serve over HTTP (`npx serve .`); `file://`
breaks the Service Worker.

## Tests

```bash
npm test                  # the suite that must pass (80 assertions)
npm run test:known-issues # multi-lap scenario; not a bug, exits 1 by design
npm run stamp             # after committing app code: rewrites BUILD_ID
```

`npm test` runs three suites:

| Suite | Covers |
|---|---|
| `hole-lifecycle.test.mjs` | state machine: hole skipping, nav, Prev/Next wrap, 10-start |
| `carry-order.test.mjs` | carry-in computed in order played, extracted from the shipped code |
| `build-stamp.test.mjs` | footer build stamp: match / mismatch / offline |

### `test:known-issues` exits 1 by design — this is not a bug

`tests/wrap-carry.mjs` models a second lap: finishing 18 holes and then
continuing to play hole 1 again. **That never happens in play.** Rounds are
always a fresh 18 holes with a new `matchId`; nobody plays past 18. So the
script's non-zero exit is expected behaviour, not a failing build, and there is
no outstanding fix to wait for.

```
node tests/wrap-carry.mjs   -> exit 1 (scenario does not occur; always will)
```

It is kept as a written record of *why* the data model cannot support a second
lap, so nobody re-investigates it as a bug:

- `holeSequence` stores each hole number at most once, so
  `holeSequence.indexOf(1)` is permanently `0`. A second lap would sum the holes
  "before index 0" — none — and return a zero carry.
- `players[].scores` is indexed by hole number (`Array(18)`), so a second lap has
  nowhere to store its scores without overwriting the first.

If multi-lap play ever becomes a real requirement, state has to be re-keyed by
play step rather than hole number — which changes the persisted round format and
so must migrate `BBB-Stats.html`, `Summarizer.html` and
`dashboard/index.html` together. The header comment in
`tests/wrap-carry.mjs` holds that analysis.
