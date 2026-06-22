# Scoring Engine Audit — All Files

BBB Golf scoring (Bingo Bango Bongo) is implemented in **7 active files**. Below is a comparison of how each handles the 4 point types.

## Scoring Rules Reference

| Category | Base Points | When Awarded | Carry-In |
|----------|-------------|-------------|----------|
| **FO** (First On) | 1 | First ball on green (par-4/5 only) | If no one wins, carry increments; awarded to next winner |
| **GR** (Greenie) | 1 | First ball on green (par-3 only) | If no one wins, carry increments; awarded to next winner |
| **CL** (Closest) | 1 | Closest ball to hole after green reached | If no one wins, carry increments; awarded to next winner |
| **P** (Putt) | 1 | Longest putt made | If no one wins, carry increments; awarded to next winner |

**Carry-In Rules:**
- If no one wins a category on a hole → carry increments by 1
- If someone wins a category → that category's carry resets to 0
- On par-3: FO carry is tracked as `greenie` (not `firstOn`)
- On par-4/5: FO carry is tracked as `firstOn` (not `greenie`)
- Closest and Putt carries are independent of par
- **Par-3 firstOn awards BOTH FO and GR**, each with the carry-in value

**Total points available per round: 54** (3 categories × 18 holes, plus carry-ins)

---

## File Comparison

| File | FO (par-4/5) | GR (par-3) | CL | P | Carry Accumulation | Sequence-Aware |
|------|-------------|-----------|----|---|-------------------|----------------|
| **index.html** | 1 + carry.firstOn | 1 + carry.greenie | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | Yes — uses `holeSequence` |
| **app-v23.js** | 1 + carry.firstOn | 1 + carry.greenie | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | No — uses hole number 1-18 |
| **weekly_summary.py** | 1 + carry.firstOn | 1 + carry.greenie | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | Yes — uses `hole_sequence` |
| **regenerate_reports.py** | 1 + carry.firstOn | 1 + carry.greenie | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | Yes — uses `hole_sequence` |
| **dashboard/index.html** | 1 + carry.firstOn | 1 + carry.greenie | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | Yes — uses `holeSequence` |
| **Summarizer.html** | 1 + carry.firstOn | 1 + carry.greenie | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | Yes — uses `holeSequence` |
| **server.js** (update-carries) | 1 + carry.firstOn | 1 + carry.greenie | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | No — assumes holes 1-18 |
| **server.js** (cleanup) | 1 + 2×carry (par-3 only, FO+GR combined) | 1 + 2×carry (par-3 only, FO+GR combined) | 1 + carry.closest | 1 + carry.putt | Per-category, accumulates when no winner, resets when winner found | No — assumes holes 1-18 |
| **BBB-Stats.html** | 1 + carry.greenie (always stored in `fo`, never `gr`) | 1 + carry.greenie (stored in `fo`!) | 1 + carry.closest | 1 + carry.putt | Total carry only, not per-category | No — uses hole number 1-18 |

---

## Key Findings

### Consistent (6 of 7 files)
- **index.html** (live app), **app-v23.js** (legacy), **weekly_summary.py**, **regenerate_reports.py**, **dashboard/index.html**, **Summarizer.html** — all implement the same scoring logic correctly.

### Bugs / Deviations

**1. BBB-Stats.html — Category misattribution**
- On par-3 holes, firstOn is correctly computed with `carry.greenie`, but the points are always attributed to `fo` instead of `gr`.
- The category totals (`fo`, `gr`) are wrong — par-3 firstOn always adds to `fo`, never to `gr`.
- Also uses hole-number ordering (not sequence-aware).

**2. server.js `computeRoundTotal` (cleanup endpoint) — Total correct, category tracking absent**
- The total points per round are correct (par-3 firstOn gives `1 + 2×carry` which equals `2 + 2×carry` = correct total).
- But it does NOT separate FO vs GR into individual player category buckets. This only matters for the cleanup threshold check (total < 40), not for category reporting.

**3. server.js `/update-round-carries` — Total correct, sequential-only**
- Point calculation is correct and matches the reference implementation.
- Does not support sequence-aware ordering (holes played out of order).

---

## File Purposes

| File | Purpose | Active? |
|------|---------|---------|
| **index.html** | Live scoring PWA — players use this during rounds | Yes |
| **app-v23.js** | Legacy inline engine (merged into index.html) | No — deprecated |
| **weekly_summary.py** | Weekly summary CLI (cron, generates prose from completed rounds) | Yes |
| **regenerate_reports.py** | Report regenerator CLI (cron, generates LLM prose for weekly reports) | Yes |
| **dashboard/index.html** | Stats dashboard (leaderboards, player stats, round cards) | Yes |
| **Summarizer.html** | Round summarizer (per-round charts and totals) | Yes |
| **server.js** | Render backend (stores rounds, computes totals for cleanup + carry updates) | Yes |
| **BBB-Stats.html** | Simple stats PWA (per-player season stats) | Yes — **has bugs** |
| **index_cleaned_nogood.html** | Old deprecated inline engine | No — archived |
| **Deleted_Inline** | Archived inline engine | No — archived |
| **Modify.html** | Round carry-marker editor (read-only scoring, edits raw scores) | Yes — does not compute scores |
