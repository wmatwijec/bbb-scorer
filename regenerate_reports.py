#!/usr/bin/env python3
"""Regenerate round report prose and push to Render backend.

Run via cron: 0 19 * * 4  /usr/bin/python3 /home/wm/projects/bbb-scorer/regenerate_reports.py

Generates LLM prose for all complete rounds in the past week (last Mon-Sun)
and uploads to the Render backend via POST /regenerate-reports.
"""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import urlopen, Request

BACKEND = "https://pwa-players-backend.onrender.com"
LLM_SERVER = "http://localhost:8081/v1/chat/completions"
DEFAULT_PARS = [4, 5, 3, 4, 3, 4, 4, 4, 3, 5, 4, 3, 4, 3, 4, 4, 5, 4]
COURSE_PARS = {
    "Bridge": [4, 5, 3, 4, 3, 4, 4, 4, 3, 5, 4, 3, 4, 3, 4, 4, 5, 4],
    "Tims_Ford": [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 5, 3, 4, 4, 3],
    "Towhee": [4, 3, 5, 3, 4, 3, 5, 4, 4, 3, 4, 4, 3, 4, 3, 5, 5, 4],
    "Horton": [4, 3, 5, 4, 4, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 3, 4, 5],
    "Old_Fort": [4, 5, 3, 4, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4],
}
EXCLUDED_PLAYERS = {"Doug", "Ryan", "guest"}


# ── Scoring engine (port from weekly_summary.py) ──────────────────────

def build_hole_sequence(round_data):
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
    course = round_data.get("courseName", "Unknown")
    pars = round_data.get("pars")
    if not pars or len(pars) != 18:
        pars = COURSE_PARS.get(course, DEFAULT_PARS)

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
        if p.get("name") and p["name"].lower() not in EXCLUDED_PLAYERS
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

            hole_details.append({
                "hole": hole_number,
                "par": par,
                "pts": hole_pts,
                "fo": hole_fo,
                "gr": hole_gr,
                "cl": hole_cl,
                "p": hole_p,
            })

            total_pts += hole_pts
            fo_pts += hole_fo
            gr_pts += hole_gr
            cl_pts += hole_cl
            p_pts += hole_p

        # Compute carry-in values for hole_details
        for seq_idx in range(len(hole_sequence)):
            hole_number = hole_sequence[seq_idx]
            idx = hole_number - 1
            carry = get_carry_in_for_hole(hole_scores, pars, hole_number, hole_sequence)
            s = hole_scores.get(idx, {}).get(name, {})
            par = pars[idx] if idx < len(pars) else 4
            is_par3 = par == 3
            hd = hole_details[seq_idx]
            hd["ci_fo"] = (hd["fo"] - (1 if s.get("firstOn") else 0))
            hd["ci_gr"] = (hd["gr"] - (1 if is_par3 and s.get("firstOn") else 0))
            hd["ci_cl"] = (hd["cl"] - (1 if s.get("closest") else 0))
            hd["ci_p"] = (hd["p"] - (1 if s.get("putt") else 0))

        ci_total = sum(
            hd["ci_fo"] + hd["ci_gr"] + hd["ci_cl"] + hd["ci_p"]
            for hd in hole_details
        )

        result["player_data"][name] = {
            "total": total_pts,
            "fo": fo_pts,
            "gr": gr_pts,
            "cl": cl_pts,
            "p": p_pts,
            "holes_scored": holes_scored,
            "three_ptr_holes": three_ptr_holes,
            "hole_details": hole_details,
            "carry_in_total": ci_total,
        }

    return result


# ── LLM prose generation ──────────────────────────────────────────────

def call_llm(prompt, system_msg=None):
    messages = []
    if system_msg:
        messages.append({"role": "system", "content": system_msg})
    messages.append({"role": "user", "content": prompt})
    try:
        req = Request(
            LLM_SERVER,
            data=json.dumps({
                "model": "qwen35b",
                "messages": messages,
                "temperature": 0.2,
                "top_p": 0.9,
                "max_tokens": 800
            }).encode(),
            headers={"Content-Type": "application/json"}
        )
        resp = json.loads(urlopen(req, timeout=45).read())
        return resp["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"  LLM call failed: {e}")
        return None


def build_round_prompt(round_stats):
    """Build prompt with per-hole detail for rich narrative, no raw scores."""
    course = round_stats.get("course_name", "Unknown")
    sorted_players = sorted(
        round_stats["player_data"].items(),
        key=lambda x: x[1]["total"],
        reverse=True
    )

    winner = sorted_players[0]
    winner_name = winner[0]
    winner_data = winner[1]

    runner_up = sorted_players[1] if len(sorted_players) > 1 else sorted_players[-1]
    runner_up_name = runner_up[0]
    margin = winner_data["total"] - runner_up[1]["total"]

    # Build player strength tags
    strength_tags = []
    for name, data in sorted_players:
        parts = []
        if data["fo"] >= 6:
            parts.append("dominant driving")
        if data["cl"] >= 6:
            parts.append("strong on the greens")
        if data["p"] >= 6:
            parts.append("excellent putting")
        if data["holes_scored"] >= 15:
            parts.append("near-clean round")
        if parts:
            strength_tags.append(f"{name}: {', '.join(parts)}")

    # Build per-hole highlights — big scoring holes and carry-in moments
    hole_highlights = []
    for name, data in sorted_players:
        for hd in data["hole_details"]:
            reasons = []
            if hd["fo"] >= 2:
                reasons.append(f"+{hd['fo']} FO (carry-in)")
            if hd["gr"] >= 2:
                reasons.append(f"+{hd['gr']} GR (carry-in)")
            if hd["cl"] >= 2:
                reasons.append(f"+{hd['cl']} CL (carry-in)")
            if hd["p"] >= 2:
                reasons.append(f"+{hd['p']} PU (carry-in)")
            if hd["pts"] >= 3:
                reasons.append(f"3-pointer")
            if reasons:
                hole_highlights.append(f"  Hole {hd['hole']} (Par {hd['par']}): {name} {', '.join(reasons)}")

    prompt = (
        "You are a sports broadcaster for a weekly golf league called Bingo Bango Bongo. "
        "Write a single paragraph (5-7 sentences) analyzing ONE completed round. "
        "Be conversational, engaging, never mean. Use player names naturally. "
        "Write ONLY the paragraph — no labels, no quotes, no preamble.\n\n"
        "CRITICAL RULES:\n"
        "1. NEVER include any player scores or point totals in your paragraph.\n"
        "2. You MAY reference specific hole numbers (e.g., 'on the 7th hole') since these are "
        "just course positions, not scores.\n"
        "3. Use qualitative descriptions: 'won comfortably', 'narrowly', 'by a point',\n"
        "   'dominated', 'strong putting', 'clutch performance', 'swept the hole'.\n"
        "4. Reference the hole highlights below to tell a specific story — which holes had "
        "carry-ins, who swept a hole, who built momentum early vs late.\n"
        "5. Write 5-7 sentences with actual detail, not just generic praise.\n\n"
        f"ROUND: {course}\n\n"
        f"WON BY: {winner_name} over {runner_up_name}\n"
    )

    if margin >= 8:
        prompt += "The winner dominated the field — a statement round.\n\n"
    elif margin <= 1:
        prompt += "A nail-biter — decided by a razor-thin margin.\n\n"
    else:
        prompt += f"The winner held off a solid challenge, winning by {margin} points.\n\n"

    if strength_tags:
        prompt += "PLAYER STRENGTHS:\n" + "\n".join(strength_tags) + "\n\n"

    if hole_highlights:
        prompt += "KEY MOMENTS (holes where carry-ins or multi-carry sweeps happened):\n" + "\n".join(hole_highlights[:20]) + "\n\n"

    prompt += (
        "ANALYSIS: Describe the story of this round in detail. "
        "Who built momentum early (front nine)? Was there a late rally (back nine)? "
        "Which holes had carry-ins that shifted the momentum? "
        "Any player who swept multiple carries on a single hole? "
        "Make it feel like a real golf match told by a knowledgeable broadcaster. "
        "5-7 sentences with specific hole references from the key moments above."
    )
    return prompt


def generate_round_prose(round_data, round_stats):
    """Generate LLM prose for a round, with fallback."""
    system_msg = (
        "You are writing a golf round analysis. "
        "NEVER include any player scores or point totals. "
        "Use only qualitative descriptions."
    )
    prose = call_llm(build_round_prompt(round_stats), system_msg)
    return prose or "Analysis unavailable"

    # Fallback: template-based prose
    sorted_players = sorted(
        round_stats["player_data"].items(),
        key=lambda x: x[1]["total"],
        reverse=True
    )
    winner_name, winner = sorted_players[0]
    if len(sorted_players) > 1:
        runner_up_name, runner_up = sorted_players[1]
        margin = winner["total"] - runner_up["total"]
    else:
        runner_up_name = "nobody"
        margin = winner["total"]

    course = round_stats.get("course_name", "Unknown")

    if margin >= 8:
        return (
            f"{winner_name} put on a clinic with {winner['total']} points, "
            f"outscoring {runner_up_name} by {margin} points. "
            f"A dominant round at {course}."
        )
    if margin <= 1 and winner["total"] > 0:
        return (
            f"A thriller at {course}! {winner_name} edged {runner_up_name} by just "
            f"{margin} point{'s' if margin > 1 else ''} with {winner['total']} to "
            f"{runner_up['total']}."
        )
    return (
        f"{winner_name} took it with {winner['total']} points at {course}. "
        f"{winner['holes_scored']} holes scored. A solid round."
    )


# ── Week calculation ──────────────────────────────────────────────────

def iso_week_start(date):
    weekday = date.isoweekday()
    return date - timedelta(days=weekday - 1)


def iso_week_end(date):
    return iso_week_start(date) + timedelta(days=6)


def get_week_range(week=None, year=None, date=None):
    if date:
        d = datetime.strptime(date, "%Y-%m-%d").date()
    elif week is not None and year is not None:
        jan4 = datetime(year, 1, 4).date()
        start_of_week1 = jan4 - timedelta(days=jan4.isoweekday() - 1)
        monday = start_of_week1 + timedelta(weeks=week - 1)
        d = monday
    else:
        # Default: last week (Mon-Sun)
        today = datetime.now().date()
        d = today - timedelta(days=7)
    monday = iso_week_start(d)
    sunday = iso_week_end(d)
    return monday, sunday


def get_iso_week_key(date_str):
    date = datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
    year = date.year
    jan4 = datetime(year, 1, 4).date()
    start_of_week1 = jan4 - timedelta(days=jan4.isoweekday() - 1)
    diff = (date - start_of_week1).days
    week = diff // 7 + 1
    return f"{year}-W{week:02d}"


# ── Main ──────────────────────────────────────────────────────────────

def fetch_rounds():
    resp = urlopen(f"{BACKEND}/rounds")
    data = json.loads(resp.read())
    return data.get("rounds", data) if isinstance(data, dict) else data


def filter_and_dedup(rounds, monday, sunday):
    cutoff = "2026-01-07"
    valid = []
    for r in rounds:
        d = datetime.fromisoformat(r["date"].replace("Z", "+00:00")).date()
        if d < datetime.strptime(cutoff, "%Y-%m-%d").date():
            continue
        has_full = r.get("scores") and all(
            isinstance(v, list) and len(v) == 18
            for v in r["scores"].values()
        )
        finished_ok = (r.get("finishedHoles") or []) and len(r["finishedHoles"]) == 18
        if not finished_ok and not has_full:
            continue
        if monday <= d <= sunday:
            valid.append(r)

    # Dedup
    best = {}
    for r in valid:
        date_key = r["date"][:10]
        course = r.get("courseName", "Unknown")
        player_keys = sorted(
            p["name"] for p in r.get("players", [])
            if p.get("name") and p["name"].lower() not in EXCLUDED_PLAYERS
        )
        dedup_key = f"{date_key}|{course}|{','.join(player_keys)}"
        existing = best.get(dedup_key)
        cur_holes = len(r.get("finishedHoles", []))
        exist_holes = len(existing.get("finishedHoles", [])) if existing else 0
        if not existing or cur_holes > exist_holes or (
            cur_holes == exist_holes and r["date"] > existing["date"]
        ):
            best[dedup_key] = r

    return sorted(best.values(), key=lambda r: r["date"])


def main():
    # Determine target week: last Mon-Sun (or specified week)
    import sys
    target_week = None
    target_year = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg in ('--week', '-w') and i < len(sys.argv):
            try:
                target_week = int(sys.argv[i+1])
            except ValueError:
                pass
        if arg in ('--year', '-y') and i < len(sys.argv):
            try:
                target_year = int(sys.argv[i+1])
            except ValueError:
                pass

    today = datetime.now().date()
    if target_week is not None and target_year is not None:
        monday, sunday = get_week_range(week=target_week, year=target_year)
    else:
        monday, sunday = iso_week_start(today - timedelta(days=7)), iso_week_end(today - timedelta(days=7))
    week_key = get_iso_week_key(f"{monday.isoformat()}")

    print(f"=== BBB Round Report Regenerator ===")
    print(f"Target week: {week_key} ({monday} - {sunday})")

    # Fetch rounds
    print(f"Fetching rounds from {BACKEND}...")
    rounds = fetch_rounds()
    print(f"  Total rounds: {len(rounds)}")

    # Filter to target week
    week_rounds = filter_and_dedup(rounds, monday, sunday)
    print(f"  Rounds this week: {len(week_rounds)}")

    if not week_rounds:
        print("  No rounds to process. Exiting.")
        return

    # Compute stats and generate prose
    print(f"Generating prose via LLM...")
    report_rounds = []
    for rd in week_rounds:
        course = rd.get("courseName", "Unknown")
        stats = compute_round_stats(rd)
        stats["course_name"] = course
        stats["date"] = rd.get("date", "")

        player_names = [
            p["name"] for p in rd.get("players", [])
            if p.get("name") and p["name"].lower() not in EXCLUDED_PLAYERS
        ]

        # Only process complete 18-hole rounds (all players have 18 score entries)
        scores_data = rd.get("scores", {})
        is_complete = all(
            name in scores_data and len(scores_data.get(name, [])) >= 18
            for name in player_names[:2]
        )

        if is_complete:
            prose = generate_round_prose(rd, stats)
            print(f"  {rd['date'][:10]} {course}: {prose[:60]}...")
        else:
            prose = "Round in progress — not yet complete."
            print(f"  {rd['date'][:10]} {course}: (incomplete, skipped)")

        report_rounds.append({
            "roundDate": rd["date"][:10],
            "players": ",".join(sorted(player_names)),
            "course": course,
            "prose": prose,
        })

    # Build report
    report = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "rounds": report_rounds,
    }

    # Push to Render backend
    print(f"Pushing report to {BACKEND}/regenerate-reports...")
    try:
        auth_key = None
        auth_env = Path("/home/wm/projects/bbb-scorer/.reports_auth_key").read_text().strip()
        if auth_env:
            auth_key = auth_env
        elif "REPORTS_AUTH_KEY" in __import__("os").environ:
            auth_key = __import__("os").environ["REPORTS_AUTH_KEY"]

        payload = json.dumps(report).encode()
        headers = {"Content-Type": "application/json"}
        if auth_key:
            headers["Authorization"] = f"Bearer {auth_key}"

        req = Request(
            f"{BACKEND}/regenerate-reports?week={week_key}",
            data=payload,
            headers=headers,
            method="POST"
        )
        resp = urlopen(req, timeout=30)
        result = json.loads(resp.read())
        print(f"  Success: {result}")
    except Exception as e:
        print(f"  Upload failed: {e}")
        print(f"  Report data saved to /tmp/bbb_reports_{week_key}.json for manual upload")
        Path(f"/tmp/bbb_reports_{week_key}.json").write_text(json.dumps(report, indent=2))

    print("Done.")


if __name__ == "__main__":
    main()
