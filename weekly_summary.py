#!/usr/bin/env python3
"""BBB Weekly Summary CLI — generate conversational weekly roundups."""

import argparse
import json
import sys
import calendar
from datetime import datetime, timedelta
from itertools import zip_longest
from pathlib import Path
from urllib.request import urlopen

BACKEND = "https://pwa-players-backend.onrender.com"

DEFAULT_PARS = [4, 5, 3, 4, 3, 4, 4, 4, 3, 5, 4, 3, 4, 3, 4, 4, 5, 4]

COURSE_PARS = {
    "Bridge": [4, 5, 3, 4, 3, 4, 4, 4, 3, 5, 4, 3, 4, 3, 4, 4, 5, 4],
    "Tims_Ford": [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 5, 3, 4, 4, 3],
    "Towhee": [4, 3, 5, 3, 4, 3, 5, 4, 4, 3, 4, 4, 3, 4, 3, 5, 5, 4],
    "Horton": [4, 3, 5, 4, 4, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 3, 4, 5],
    "Old_Fort": [4, 5, 3, 4, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4],
}

EXCLUDED_PLAYERS = {"Doug", "Ryan"}


# ── Scoring engine (ported from dashboard/index.html) ──────────────────

def build_hole_sequence(round_data):
    """Build the order holes were played."""
    finished = round_data.get("finishedHoles", [])
    if len(finished) == 18:
        return list(range(1, 19))
    has_full = round_data.get("scores") and all(
        isinstance(v, list) and len(v) == 18
        for v in round_data["scores"].values()
    )
    if has_full:
        return list(range(1, 19))
    return sorted(finished)


def get_carry_in_for_hole(hole_scores, pars, hole_number, hole_sequence):
    """Compute carry-in state for a given hole."""
    carry = {"firstOn": 0, "closest": 0, "putt": 0, "greenie": 0}
    idx = hole_sequence.index(hole_number) if hole_number in hole_sequence else -1
    if idx == -1:
        return carry
    for i in range(idx):
        h = hole_sequence[i]
        hidx = h - 1
        if hidx not in hole_scores or not hole_scores[hidx]:
            continue
        par = pars[hidx] if hidx < len(pars) else 4
        is_par3 = par == 3
        scores = hole_scores[hidx]
        if is_par3:
            if any(s.get("firstOn") for s in scores.values()):
                carry["greenie"] = 0
            else:
                carry["greenie"] += 1
        else:
            if any(s.get("firstOn") for s in scores.values()):
                carry["firstOn"] = 0
            else:
                carry["firstOn"] += 1
        if any(s.get("closest") for s in scores.values()):
            carry["closest"] = 0
        else:
            carry["closest"] += 1
        if any(s.get("putt") for s in scores.values()):
            carry["putt"] = 0
        else:
            carry["putt"] += 1
    return carry


def compute_round_stats(round_data):
    """Compute full per-player stats for a round, including carry-in."""
    course = round_data.get("courseName", "Unknown")
    pars = round_data.get("pars")
    if not pars or len(pars) != 18:
        pars = COURSE_PARS.get(course, DEFAULT_PARS)
    
    # Build hole_scores map: {hole_idx: {player_name: score_obj}}
    hole_scores = {}
    for idx in range(18):
        hole_scores[idx] = {}
    for name, player_holes in (round_data.get("scores") or {}).items():
        if not isinstance(player_holes, list) or len(player_holes) != 18:
            continue
        for idx, s in enumerate(player_holes):
            hole_scores[idx][name] = s or {}
    
    hole_sequence = build_hole_sequence(round_data)
    players = [
        p["name"] for p in (round_data.get("players") or [])
        if p.get("name") and p["name"].lower() != "guest"
    ]
    
    result = {"player_data": {}, "hole_sequence": hole_sequence, "pars": pars}
    
    for name in players:
        total_pts = 0
        fo_pts = 0
        gr_pts = 0
        cl_pts = 0
        p_pts = 0
        hole_details = []
        holes_scored = 0
        three_ptr_holes = 0
        max_hole_pts = 0
        
        for seq_idx in range(len(hole_sequence)):
            hole_number = hole_sequence[seq_idx]
            idx = hole_number - 1
            carry = get_carry_in_for_hole(hole_scores, pars, hole_number, hole_sequence)
            s = hole_scores.get(idx, {}).get(name, {})
            par = pars[idx] if idx < len(pars) else 4
            is_par3 = par == 3
            
            hole_pts = 0
            hole_fo = 0
            hole_gr = 0
            hole_cl = 0
            hole_p = 0
            
            if s.get("firstOn"):
                hole_fo = 1
                hole_gr = 1 if is_par3 else 0
            if s.get("closest"):
                hole_cl = 1
            if s.get("putt"):
                hole_p = 1
            
            if s.get("firstOn"):
                ci_add = carry["greenie"] if is_par3 else carry["firstOn"]
                hole_fo += ci_add
                hole_gr += ci_add if is_par3 else 0
            if s.get("closest"):
                hole_cl += carry["closest"]
            if s.get("putt"):
                hole_p += carry["putt"]
            
            hole_pts = hole_fo + hole_gr + hole_cl + hole_p
            
            if hole_pts > 0:
                holes_scored += 1
            if hole_pts >= 3:
                three_ptr_holes += 1
            max_hole_pts = max(max_hole_pts, hole_pts)
            
            hole_details.append({
                "hole": hole_number,
                "par": par,
                "pts": hole_pts,
                "fo": hole_fo,
                "gr": hole_gr,
                "cl": hole_cl,
                "p": hole_p,
                "ci_fo": (hole_fo - (1 if s.get("firstOn") else 0)),
                "ci_gr": (hole_gr - (1 if is_par3 and s.get("firstOn") else 0)),
                "ci_cl": (hole_cl - (1 if s.get("closest") else 0)),
                "ci_p": (hole_p - (1 if s.get("putt") else 0)),
            })
            
            total_pts += hole_pts
            fo_pts += hole_fo
            gr_pts += hole_gr
            cl_pts += hole_cl
            p_pts += hole_p
        
        # Carry-in totals
        ci_total = 0
        for hd in hole_details:
            ci_total += hd["ci_fo"] + hd["ci_gr"] + hd["ci_cl"] + hd["ci_p"]
        
        # Streaks
        longest_scoring = 0
        current_scoring = 0
        longest_zero = 0
        current_zero = 0
        longest_fo = 0
        current_fo = 0
        longest_closest = 0
        current_closest = 0
        longest_putt = 0
        current_putt = 0
        longest_clean = 0
        current_clean = 0
        max_greenies = 0
        current_greenies = 0
        
        for hd in hole_details:
            if hd["pts"] > 0:
                current_scoring += 1
                current_zero = 0
            else:
                current_zero += 1
                current_scoring = 0
            
            if hd["pts"] == 0:
                longest_zero = max(longest_zero, current_zero)
            else:
                longest_scoring = max(longest_scoring, current_scoring)
            
            if hd["fo"] + hd["gr"] > 0:
                current_fo += 1
                current_clean = 0
            else:
                current_fo = 0
            
            if hd["cl"] > 0:
                current_closest += 1
            else:
                current_closest = 0
            
            if hd["p"] > 0:
                current_putt += 1
            else:
                current_putt = 0
            
            if hd["pts"] > 0:
                current_clean += 1
            else:
                current_clean = 0
            
            if is_par3 and hd["gr"] > 0:
                current_greenies += 1
            elif not is_par3 and hd["fo"] > 0:
                current_greenies = 0
            else:
                current_greenies = 0
            
            longest_fo = max(longest_fo, current_fo)
            longest_closest = max(longest_closest, current_closest)
            longest_putt = max(longest_putt, current_putt)
            longest_clean = max(longest_clean, current_clean)
            max_greenies = max(max_greenies, current_greenies)
        
        result["player_data"][name] = {
            "total": total_pts,
            "fo": fo_pts,
            "gr": gr_pts,
            "cl": cl_pts,
            "p": p_pts,
            "holes_scored": holes_scored,
            "three_ptr_holes": three_ptr_holes,
            "three_ptr_pct": round(three_ptr_holes / max(len(hole_details), 1) * 100, 1),
            "max_hole": max_hole_pts,
            "hole_details": hole_details,
            "carry_in_total": ci_total,
            "streaks": {
                "longest_scoring": longest_scoring,
                "longest_zero": longest_zero,
                "longest_fo": longest_fo,
                "longest_closest": longest_closest,
                "longest_putt": longest_putt,
                "longest_clean": longest_clean,
                "max_greenies": max_greenies,
                "three_ptr_holes": three_ptr_holes,
            },
        }
    
    return result


def get_point_total(cached_totals, player_name):
    """Get point total, handling old (number) and new (dict) formats."""
    val = cached_totals.get(player_name) if cached_totals else None
    if val is None:
        return 0
    if isinstance(val, (int, float)):
        return val
    return val.get("total", 0)


def get_category_totals(cached_totals, player_name):
    """Get category breakdown if available (new format only)."""
    val = cached_totals.get(player_name) if cached_totals else None
    if val is None:
        return None
    if isinstance(val, dict):
        return val
    return None


# ── Joke pool ──────────────────────────────────────────────────────────

GOLF_JOKES = [
    "Why did the golfer bring two pairs of pants? In case he got a hole in one.",
    "What do you call a fake golfer? A put-ter.",
    "Why can't the golfer play hide and seek? Because good players are easy to caddie.",
    "Why did the golfer wear two pairs of socks? He wanted to be sure of a tie.",
    "What's a golfer's favorite candy? M&M's — because every hole has two.",
    "Why do golfers never get lost? They always have a good bunkering sense.",
    "What do you call a golfer who tells the truth? A honest Abe — wait, that's not golf. A golf-ty liar.",
    "Why did the golfer get fired from the bank? He kept taking too many divots.",
    "What's the difference between a golf ball and a rich person? I can see my golf ball.",
    "Why don't golfers like to fast food? They can't wait to get to the 19th hole.",
    "What do you call a golfer who plays in the rain? Wet.",
    "Why did the golfer quit his job? He was tired of being so darned putzed.",
    "What's a golfer's least favorite letter? U, because they're always trying to avoid the water hazard.",
    "Why did the golfer bring an extra sock? In case he got a hole in one.",
    "How do golfers make ice? They go outside and wait for the rain to freeze.",
    "What's the golfer's favorite exercise? A hole in one.",
    "Why do golfers love high school so much? Because of all the hole-in-one projects.",
    "What did the golfer say when he got a hole in one? 'Well, I guess that's one way to finish the hole.'",
    "Why did the golfer get arrested? For driving on the green.",
    "What do you call a golfer who never misses? A liar.",
    "Why did the golfer bring string to the course? So he could tie up the competition.",
    "What's the golfer's favorite kind of music? Par-ty tunes!",
    "Why don't golfers ever get lost? They always follow the fairway of the light.",
    "What did the caddy say to the golfer who lost his ball? I'm sure he's not in the water — he's in the water... wait.",
    "Why did the golfer bring a ladder to the course? He heard the stakes were high.",
    "What do you call a golfer who can't hit the ball? A par-mer.",
    "Why did the golfer bring a pencil to the course? In case he needed to draw a lie.",
    "How do you organize a space golf tournament? You planet.",
    "Why did the golfer get kicked out of the restaurant? He kept asking for a side of bunker fries.",
    "What do you get when you cross a golfer with an elephant? A really big swing.",
    "Why did the golfer become a teacher? He wanted to make a fairway of a difference.",
    "What's a golfer's favorite dessert? Par-feet.",
    "Why don't golfers ever play poker? They always fold on the river.",
    "What do you call a golfer who flies his own plane? A single-handed player.",
    "Why did the golfer bring a broom to the course? To sweep the greens.",
    "What's the difference between a good golfer and a great golfer? About 30 putts.",
    "Why did the golfer get a job at the bakery? He was great at rolling bunkers.",
    "What do you call a golfer who plays on a boat? A caddy-wack.",
    "Why do golfers love to garden? They have a green thumb.",
    "What did the golfer say after losing his ball? 'I guess that's a penalty stroke and a heartache.'",
    "Why did the golfer bring a flashlight to the course? He wanted to see his way to the 19th hole.",
    "What's a golfer's favorite type of dog? A lab-rador — for retrieving those drives.",
    "Why did the golfer win the race? He knew how to take a fairway.",
    "What do you call a golfer who never loses? A saint — because nobody's perfect.",
    "Why did the golfer get a ticket? He parked in the rough.",
    "What's a golfer's favorite dance? The putt-ter strut.",
    "Why did the golfer bring a book to the course? He wanted to read between the bunkers.",
    "What do you call a golfer who's also a musician? A tee-jay.",
    "Why don't golfers like to swim? They're afraid of the water hazard.",
    "What's the golfer's favorite holiday? Golf-oween.",
    "Why did the golfer bring a net to the course? To catch those errant drives.",
    "What do you call a golfer who plays with a spoon? A par-mer.",
    "Why did the golfer become a detective? He was good at finding lost balls.",
    "What's a golfer's favorite movie genre? Par-odies.",
    "Why did the golfer get promoted? He always hit the right notes — I mean, the right fairways.",
    "What do you call a golfer who tells bad jokes? A pun-ter.",
    "Why did the golfer bring a camera to the course? To capture those birdie moments.",
    "What's a golfer's favorite subject in school? Par-ithmetic.",
    "Why did the golfer get a library card? He loved checking out the bunkers.",
    "What do you call a golfer who's also a chef? A grill-master — for those post-round steaks.",
    "Why did the golfer bring a towel to the course? In case he needed to wipe away the tears of defeat.",
    "What's a golfer's favorite animal? A par-rots — because they can talk about their scores.",
    "Why did the golfer become a writer? He was good at putting together a good story.",
    "What do you call a golfer who never swears? A saint — because golf doesn't require it.",
    "Why did the golfer bring a map to the course? He wanted to navigate the fairways.",
    "What's a golfer's favorite season? Golf- Autumn.",
    "Why did the golfer get a job at the zoo? He was great with the animals — especially the parrots.",
    "What do you call a golfer who plays at night? A night-tee player.",
    "Why did the golfer become a firefighter? He knew how to put out the fires on the green.",
    "What's a golfer's favorite type of pizza? Par-mesan and herb.",
    "Why did the golfer bring a chair to the course? He wanted a seat at the 19th hole.",
    "What do you call a golfer who's also a pilot? A wingman on the fairway.",
    "Why did the golfer get a driver's license? He needed to get to the course faster.",
    "What's a golfer's favorite part of the day? The first tee — where it all begins.",
    "Why did the golfer bring a pen to the course? To keep score — and sign autographs.",
    "What do you call a golfer who's also a doctor? A tee-therapist.",
    "Why did the golfer become a philosopher? He spent a lot of time thinking about the meaning of par.",
    "What's a golfer's favorite type of bread? Rolls — because they roll with the punches.",
    "Why did the golfer bring a backpack to the course? He wanted to carry his own clubs — and snacks.",
    "What do you call a golfer who's also a lawyer? A fairway attorney.",
    "Why did the golfer get a Nobel prize? He was a par- Excellence in golf.",
    "What's a golfer's favorite type of music? Rock — because it goes bump in the bunker.",
    "Why did the golfer bring a clock to the course? To watch the time — and the score.",
    "What do you call a golfer who's also an artist? A paint-er of fairways.",
    "Why did the golfer become a scientist? He liked to experiment with his swing.",
    "What's a golfer's favorite type of math? Par-calculus.",
    "Why did the golfer bring a telescope to the course? To see the green from a mile away.",
    "What do you call a golfer who's also a teacher? A tee-cher.",
    "Why did the golfer get a standing ovation? He hit a hole-in-one — the crowd went wild.",
    "What's a golfer's favorite type of weather? Par-fectly cloudy with a chance of birdies.",
    "Why did the golfer bring a compass to the course? To find his way to the 19th hole.",
    "What do you call a golfer who's also a baker? A bun-ker specialist.",
    "Why did the golfer become a chef? He knew how to put together a good round.",
    "What's a golfer's favorite type of soup? Par-soup.",
    "Why did the golfer bring a ruler to the course? To measure his putts.",
    "What do you call a golfer who's also a musician? A tee-keyboard player.",
    "Why did the golfer get a job at the gym? He wanted to work on his swing — and his abs.",
    "What's a golfer's favorite type of sport? Golf — obviously.",
    "Why did the golfer bring a shovel to the course? In case he needed to dig out of a bunker.",
    "What do you call a golfer who's also a pilot? A fairway flyer.",
    "Why did the golfer become an engineer? He liked building better swings.",
    "What's a golfer's favorite type of tree? An oak — because it stands tall on the fairway.",
    "Why did the golfer bring a mirror to the course? To check his form — and his confidence.",
    "What do you call a golfer who's also a nurse? A tee-urse who puts patients on the green.",
    "Why did the golfer get a medal? For his outstanding performance — on the green.",
    "What's a golfer's favorite type of flower? A rose — because it smells as sweet as a birdie.",
]


# ── Prose templates ────────────────────────────────────────────────────

OPENING_LINES = [
    "Well what a week it was at the links!",
    "Another week, another batch of golfing heroics!",
    "If you thought golf was just walking and hitting a ball, this week proved you wrong!",
    "The courses were hot this week, and the players brought the fire!",
    "Another week on the greens and the BBB action was absolutely electric!",
    "What a week it has been for the BBB crew — the courses were on fire!",
]

ROUND_COMMENT_OPENERS = {
    "big_carry_in": (
        "{winner}'s round was powered by carry-in — they banked {ci_pts} carry-in points, "
        "including a massive {biggest_carry} on hole {biggest_hole}. "
        "Their {base_pts} base points were solid, but those bonus points were the difference "
        "between a good round and a legendary one."
    ),
    "dominant_win": (
        "{winner} put on a clinic with {pts} points, outscoring {runner_up} by {margin} points. "
        "They won {fo_count} first-ons, {cl_count} closests, and {pu_count} putts — "
        "a complete round from tee to green."
    ),
    "close_finish": (
        "A thriller at {course}! {winner} edged {runner_up} by just {margin} point{pl} with "
        "{pts} to {runner_pts}. Both players had {holes_scored} holes scored — "
        "this one came down to the final putt."
    ),
    "clean_card": (
        "A beautiful round from {winner} — they scored on {holes_scored} of 18 holes "
        "with only {three_ptr} three-strike holes. Three-strike holes are rare (only {three_ptr_pct}% "
        "of all holes), and {winner} had {three_ptr} of them!"
    ),
    "putt_heavy": (
        "{winner}'s putting was on another level — {pu_pts} of their {pts} points came from "
        "putts, including {pu_ci} points from putt carry-in. They had {pu_count} putts all "
        "round, setting up pressure on the competition... get it?"
    ),
    "fo_heavy": (
        "The driving game was real for {winner} — {fo_pts} points from first-on, including "
        "{fo_ci} carry-in points. They got on the green first {fo_count} times out of {total_holes} "
        "holes played, setting up the short game all round."
    ),
    "all_around": (
        "A solid all-around round from {winner} at {course} — {pts} points with {holes_scored} "
        "holes scored. They picked up points all over: {fo_count} first-ons, {cl_count} closests, "
        "and {pu_count} putts. A well-rounded performance."
    ),
}


def select_round_comment(round_stats):
    """Select the best prose template for a round based on what actually happened."""
    player_items = list(round_stats["player_data"].items())
    if not player_items or len(player_items) < 2:
        return None
    
    winner_name, winner = max(player_items, key=lambda x: x[1]["total"])
    sorted_players = sorted(player_items, key=lambda x: x[1]["total"], reverse=True)
    runner_up_name, runner_up = sorted_players[1]
    course = round_stats.get("course_name", "")
    
    # Determine comment type based on actual stats
    if winner["carry_in_total"] > winner["total"] * 0.25:
        ci_details = []
        for hd in winner["hole_details"]:
            if hd["ci_fo"] + hd["ci_gr"] + hd["ci_cl"] + hd["ci_p"] > 0:
                ci_details.append((hd["hole"], hd["ci_fo"] + hd["ci_gr"] + hd["ci_cl"] + hd["ci_p"]))
        ci_details.sort(key=lambda x: x[1], reverse=True)
        biggest_hole, biggest_carry = ci_details[0]
        base_pts = winner["fo"] + winner["gr"] + winner["cl"] + winner["p"] - winner["carry_in_total"]
        return ROUND_COMMENT_OPENERS["big_carry_in"].format(
            winner=winner_name,
            ci_pts=winner["carry_in_total"],
            biggest_carry=biggest_carry,
            biggest_hole=biggest_hole,
            base_pts=max(base_pts, 0),
        )
    
    margin = winner["total"] - runner_up["total"]
    if margin >= 10:
        return ROUND_COMMENT_OPENERS["dominant_win"].format(
            winner=winner_name,
            pts=winner["total"],
            runner_up=runner_up_name,
            margin=margin,
            fo_count=winner["fo"],
            cl_count=winner["cl"],
            pu_count=winner["p"],
        )
    
    if margin <= 1 and winner["total"] > 0:
        return ROUND_COMMENT_OPENERS["close_finish"].format(
            winner=winner_name,
            runner_up=runner_up_name,
            margin=margin,
            pl="s" if margin > 1 else "",
            pts=winner["total"],
            runner_pts=runner_up["total"],
            holes_scored=winner["holes_scored"],
            course=course,
        )
    
    if winner["total"] == 0:
        return f"'Twas a blank round at {course} — nobody managed to score a single point. Sometimes the golf course just says no."
    
    if winner["holes_scored"] >= 15:
        return ROUND_COMMENT_OPENERS["clean_card"].format(
            winner=winner_name,
            holes_scored=winner["holes_scored"],
            three_ptr=winner["three_ptr_holes"],
            three_ptr_pct=winner["three_ptr_pct"],
        )
    
    if winner["p"] > winner["total"] * 0.4 and winner["p"] >= 6:
        pu_ci = sum(hd["ci_p"] for hd in winner["hole_details"] if hd["p"] > 0)
        return ROUND_COMMENT_OPENERS["putt_heavy"].format(
            winner=winner_name,
            pu_pts=winner["p"],
            pts=winner["total"],
            pu_ci=pu_ci,
            pu_count=winner["p"],
        )
    
    if winner["fo"] + winner["gr"] > winner["total"] * 0.4 and winner["fo"] + winner["gr"] >= 6:
        fo_ci = sum(hd["ci_fo"] + hd["ci_gr"] for hd in winner["hole_details"] if hd["fo"] + hd["gr"] > 0)
        return ROUND_COMMENT_OPENERS["fo_heavy"].format(
            winner=winner_name,
            fo_pts=winner["fo"] + winner["gr"],
            fo_ci=fo_ci,
            fo_count=winner["fo"] + winner["gr"],
            total_holes=len(winner["hole_details"]),
            course=course,
        )
    
    return ROUND_COMMENT_OPENERS["all_around"].format(
        winner=winner_name,
        course=course,
        pts=winner["total"],
        holes_scored=winner["holes_scored"],
        fo_count=winner["fo"],
        cl_count=winner["cl"],
        pu_count=winner["p"],
    )


# ── All-time records ───────────────────────────────────────────────────

ALL_TIME_BEST = [
    ("Craig", 29, "Bridge", "3/26"),
    ("Tony", 26, "Unknown", "Unknown"),
    ("Eric", 26, "Unknown", "Unknown"),
    ("Bob", 26, "Unknown", "Unknown"),
    ("Marty", 25, "Unknown", "Unknown"),
    ("Jeff", 25, "Unknown", "Unknown"),
    ("Bill", 24, "Unknown", "Unknown"),
    ("Walt", 24, "Unknown", "Unknown"),
    ("Nels", 20, "Unknown", "Unknown"),
]


# ── Week calculation ───────────────────────────────────────────────────

def iso_week_start(date):
    """Get the Monday of the ISO week containing the given date."""
    weekday = date.isoweekday()
    return date - timedelta(days=weekday - 1)


def iso_week_end(date):
    """Get the Sunday of the ISO week containing the given date."""
    return iso_week_start(date) + timedelta(days=6)


def get_week_range(week=None, year=None, date=None):
    """Get (monday, sunday) for the given week."""
    if date:
        d = datetime.strptime(date, "%Y-%m-%d").date()
    elif week is not None and year is not None:
        # Find the Monday of ISO week
        jan4 = datetime(year, 1, 4).date()
        start_of_week1 = jan4 - timedelta(days=jan4.isoweekday() - 1)
        monday = start_of_week1 + timedelta(weeks=week - 1)
        d = monday
    else:
        d = datetime.now().date()
    
    monday = iso_week_start(d)
    sunday = iso_week_end(d)
    return monday, sunday


# ── Main ───────────────────────────────────────────────────────────────

def fetch_rounds():
    """Fetch all rounds from the backend."""
    resp = urlopen(f"{BACKEND}/rounds")
    data = json.loads(resp.read())
    rounds = data.get("rounds", data) if isinstance(data, dict) else data
    return rounds


def filter_rounds_by_week(rounds, monday, sunday):
    """Filter rounds to a date range and deduplicate."""
    valid = []
    for r in rounds:
        d = datetime.fromisoformat(r["date"].replace("Z", "+00:00")).date()
        if monday <= d <= sunday:
            valid.append(r)
    
    # Deduplicate by date+course+players (same logic as dashboard)
    excluded = {"Doug", "Ryan"}
    best = {}
    for r in valid:
        date_key = r["date"][:10]
        course = r.get("courseName", "Unknown")
        player_keys = sorted(
            p["name"] for p in r.get("players", [])
            if p.get("name") and p["name"].lower() != "guest" and p["name"] not in excluded
        )
        dedup_key = f"{date_key}|{course}|{','.join(player_keys)}"
        existing = best.get(dedup_key)
        cur_holes = len(r.get("finishedHoles", []))
        exist_holes = len(existing.get("finishedHoles", [])) if existing else 0
        if not existing or cur_holes > exist_holes or (cur_holes == exist_holes and r["date"] > existing["date"]):
            best[dedup_key] = r
    
    return sorted(best.values(), key=lambda r: r["date"])


def get_week_in_review(rounds):
    """Generate the full weekly review output."""
    # Compute stats for each round
    round_summaries = []
    all_player_stats = {}  # player -> list of round stats this week
    
    for rd in rounds:
        course = rd.get("courseName", "Unknown")
        stats = compute_round_stats(rd)
        stats["course_name"] = course
        stats["date"] = rd.get("date", "")
        stats["players_list"] = [p["name"] for p in rd.get("players", []) if p.get("name") and p["name"].lower() != "guest"]
        
        # Add per-category totals from _cachedTotals if available
        for name in stats["player_data"]:
            cat = get_category_totals(rd.get("_cachedTotals"), name)
            if cat:
                stats["player_data"][name]["_cached_cat"] = cat
        
        # Deduplicate player stats
        for name in stats["player_data"]:
            if name not in all_player_stats:
                all_player_stats[name] = []
            all_player_stats[name].append(stats["player_data"][name])
        
        round_summaries.append(stats)
    
    # Get joke for this week
    today = datetime.now().date()
    week_num = today.isocalendar()[1]
    joke = GOLF_JOKES[week_num % len(GOLF_JOKES)]
    
    # Get opening line
    opening = OPENING_LINES[week_num % len(OPENING_LINES)]
    
    return {
        "rounds": round_summaries,
        "all_player_stats": all_player_stats,
        "joke": joke,
        "opening": opening,
    }


def format_output(week_info, monday, sunday, player_filter=None):
    """Format the weekly review as a string."""
    lines = []
    week_num = monday.isocalendar()[1]
    week_year = monday.isocalendar()[0]
    
    lines.append("=" * 60)
    lines.append(f"  BBB WEEK IN REVIEW — {week_year}-W{week_num:02d}")
    lines.append(f"  {monday.strftime('%b %-d')} – {sunday.strftime('%b %-d')}, {sunday.year}")
    lines.append("=" * 60)
    lines.append("")
    
    rounds = week_info["rounds"]
    if not rounds:
        lines.append("No completed rounds this week. Time to hit the course!")
        lines.append("")
        return "\n".join(lines)
    
    # The Word on the Course
    lines.append("THE WORD ON THE COURSE")
    lines.append("-" * 40)
    lines.append(f"{week_info['opening']}")
    
    total_rounds = len(rounds)
    courses = list(set(r["course_name"] for r in rounds))
    all_players_this_week = set()
    for r in rounds:
        for name in r["player_data"]:
            all_players_this_week.add(name)
    
    lines.append(f"{total_rounds} completed round{'s' if total_rounds > 1 else ''} across {len(courses)} course{'s' if len(courses) > 1 else ''}: {', '.join(sorted(courses))}.")
    
    # Find the best round of the week
    best_round_idx = max(range(len(rounds)), key=lambda i: max((p["total"] for p in rounds[i]["player_data"].values()), default=0))
    best_round = rounds[best_round_idx]
    best_player_name = max(best_round["player_data"], key=lambda n: best_round["player_data"][n]["total"])
    best_player = best_round["player_data"][best_player_name]
    lines.append(f"{best_player_name} led the way with {best_player['total']} points at {best_round['course_name']}.")
    lines.append("")
    
    # Round-by-Round Recap
    lines.append("ROUND-BY-ROUND RECAP")
    lines.append("-" * 40)
    
    for rd in rounds:
        date_str = datetime.fromisoformat(rd["date"].replace("Z", "+00:00")).strftime("%A, %b %-d")
        course = rd["course_name"]
        
        # Scoreboard
        player_scores = sorted(
            rd["player_data"].items(),
            key=lambda x: x[1]["total"],
            reverse=True,
        )
        score_str = " | ".join(f"{name} {data['total']}" for name, data in player_scores)
        lines.append(f"\n• {date_str} — {course}")
        lines.append(f"  {score_str}")
        
        # Prose comment
        comment = select_round_comment(rd)
        if comment:
            lines.append(f'  "{comment}"')
    
    lines.append("")
    
    # Records Watch
    lines.append("RECORDS WATCH")
    lines.append("-" * 40)
    lines.append("\nAll-Time Best Single Rounds:")
    for name, pts, course, date in ALL_TIME_BEST[:5]:
        lines.append(f"  {name:<10} {pts} pts")
    
    lines.append("\nThis Week's Contenders:")
    week_best = {}
    for rd in rounds:
        for name, stats in rd["player_data"].items():
            if name not in week_best or stats["total"] > week_best[name]["total"]:
                week_best[name] = stats
    
    for name in sorted(week_best.keys(), key=lambda n: week_best[n]["total"], reverse=True):
        stats = week_best[name]
        if stats["total"] >= 20:
            lines.append(f"  {name} {stats['total']} pts — close to the big leagues!")
    
    if not any(s["total"] >= 20 for s in week_best.values()):
        lines.append("  No one this week cracked 20. Next week, folks!")
    
    lines.append("")
    
    # Individual Record Chase
    lines.append("INDIVIDUAL RECORD CHASE")
    lines.append("-" * 40)
    
    for name in sorted(week_best.keys(), key=lambda n: week_best[n]["total"], reverse=True):
        stats = week_best[name]
        if stats["total"] == 0:
            continue
        record = next((r for r in ALL_TIME_BEST if r[0] == name), None)
        if record:
            best_val = record[1]
            diff = best_val - stats["total"]
            if diff <= 5:
                lines.append(f"  {name}: Best ever {best_val}. Had a {stats['total']} this week. {diff} away!")
            else:
                lines.append(f"  {name}: Best ever {best_val}. This week: {stats['total']}. Room to grow.")
        else:
            lines.append(f"  {name}: First time on the radar with {stats['total']}.")
    
    lines.append("")
    
    # Streak Tracker
    lines.append("STREAK TRACKER")
    lines.append("-" * 40)
    
    # Build per-player weekly streaks
    weekly_streaks = {}
    all_player_stats = week_info["all_player_stats"]
    for name, round_stats_list in all_player_stats.items():
        best_streaks = {
            "longest_scoring": 0,
            "longest_zero": 0,
            "longest_fo": 0,
            "longest_closest": 0,
            "longest_putt": 0,
            "longest_clean": 0,
            "max_greenies": 0,
        }
        for rs in round_stats_list:
            for key in best_streaks:
                best_streaks[key] = max(best_streaks[key], rs["streaks"].get(key, 0))
        weekly_streaks[name] = best_streaks
    
    # Find the best streaks across all players this week
    streaks_by_type = {}
    for name, streaks in weekly_streaks.items():
        for stype, val in streaks.items():
            if val > 0:
                key = f"longest_{stype}" if not stype.startswith("longest_") else stype
                display = stype.replace("_", " ").title()
                if key not in streaks_by_type or val > streaks_by_type[key]["value"]:
                    streaks_by_type[key] = {"name": name, "value": val, "display": display}
    
    if streaks_by_type:
        for key in sorted(streaks_by_type.keys(), key=lambda k: streaks_by_type[k]["value"], reverse=True)[:5]:
            s = streaks_by_type[key]
            lines.append(f"  {s['display']:<25} {s['name']:<10} {s['value']} holes")
    else:
        lines.append("  No notable streaks this week.")
    
    lines.append("")
    
    # Golf Joke
    lines.append("BILL'S GOLF JOKES")
    lines.append("-" * 40)
    lines.append(f"\n{week_info['joke']}\n")
    
    lines.append("-" * 40)
    lines.append(f"Week {week_num} | Generated from bbb-scorer data")
    lines.append("")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="BBB Weekly Summary CLI")
    parser.add_argument("--week", type=int, help="ISO week number (e.g., 25)")
    parser.add_argument("--year", type=int, help="Year (e.g., 2026)")
    parser.add_argument("--date", type=str, help="Specific date YYYY-MM-DD")
    parser.add_argument("--output", type=str, help="Output file path")
    parser.add_argument("--player", type=str, help="Filter to specific player")
    args = parser.parse_args()
    
    monday, sunday = get_week_range(week=args.week, year=args.year, date=args.date)
    
    print(f"Fetching rounds from {BACKEND}...")
    rounds = fetch_rounds()
    print(f"  Found {len(rounds)} rounds total")
    
    week_rounds = filter_rounds_by_week(rounds, monday, sunday)
    print(f"  {len(week_rounds)} rounds this week ({monday} – {sunday})")
    
    if not week_rounds:
        print("\nNo completed rounds this week.")
        return
    
    week_info = get_week_in_review(week_rounds)
    output = format_output(week_info, monday, sunday, player_filter=args.player)
    
    if args.output:
        Path(args.output).write_text(output)
        print(f"\nWritten to {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
