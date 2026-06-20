# Plan: Card Redesign + Zero Streak Fix

## Problem
1. Zero Streak > 18 is confusing - streaks cross round boundaries
2. Card layout mixes two different rankings in one sorted list
3. "Season" label is misleading - data is all-time historical

## Solution

### Zero Streak Fix
Remove longestZero/currentZero from cross-round opts in computeStreaksFromHoles calls. These reset at round boundary, capping at 18.

### Card Redesign: Two Mini-Tables Per Card

Each card:
- Left column: **All-Time** (static historical records), sorted desc by value
- Right column: **Current** (slider-defined window), sorted desc by value
- Each has its own Name column showing who holds that rank
- Labels: "All-Time" | "Current" (or "Now" / date depending on slider mode)

### Files to Change
- dashboard/index.html
  - Remove Zero Streak cross-round opts (~line 547-575)
  - Rewrite renderGrid() (~line 818-848)
  - Rewrite renderOtherGrid() (~line 850-886)
  - Rewrite renderWinLossGrid() (~line 888-927)
