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

        # Compute front/back nine splits
        front_nine = [hd for hd in hole_details if hd["hole"] <= 9]
        back_nine = [hd for hd in hole_details if hd["hole"] > 9]
        f9_pts = sum(hd["pts"] for hd in front_nine)
        b9_pts = sum(hd["pts"] for hd in back_nine)

        # Detect sweeps (all 3 available carries won on same hole)
        sweeps = []
        for hd in hole_details:
            carries_won = sum([
                1 if hd["fo"] >= 1 else 0,
                1 if hd["gr"] >= 1 else 0,
                1 if hd["cl"] >= 1 else 0,
                1 if hd["p"] >= 1 else 0,
            ])
            if carries_won >= 3:
                sweeps.append(f"Hole {hd['hole']} (Par {hd['par']}): {name} swept {carries_won} carries")

        # Detect greenies (par-3 with carry-ins beyond just firstOn)
        greenies = []
        for hd in hole_details:
            if hd["par"] == 3:
                if hd["ci_gr"] > 0 or hd["ci_fo"] > 0:
                    ci_total_hole = hd["ci_fo"] + hd["ci_gr"] + hd["ci_cl"] + hd["ci_p"]
                    greenies.append(f"Hole {hd['hole']}: {name} got a greenie (+{ci_total_hole} from carry-ins)")
                elif hd["gr"] >= 1:
                    greenies.append(f"Hole {hd['hole']}: {name} won the greenie")

        # Detect carry-in chains (multi-hole carry-in streaks)
        ci_streaks = []
        streak_start = None
        streak_count = 0
        for hd in hole_details:
            total_ci = hd["ci_fo"] + hd["ci_gr"] + hd["ci_cl"] + hd["ci_p"]
            if total_ci > 0:
                if streak_start is None:
                    streak_start = hd["hole"]
                streak_count += 1
            else:
                if streak_count >= 2:
                    ci_streaks.append(f"Holes {streak_start}-{hd['hole']-1}: {name} had a {streak_count}-hole carry-in streak")
                streak_start = None
                streak_count = 0
        if streak_count >= 2:
            ci_streaks.append(f"Holes {streak_start}-{hole_details[-1]['hole']}: {name} had a {streak_count}-hole carry-in streak")

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
            "f9_pts": f9_pts,
            "b9_pts": b9_pts,
            "sweeps": sweeps,
            "greenies": greenies,
            "ci_streaks": ci_streaks,
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
    """Build prompt with rich detail for structured multi-paragraph analysis."""
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

    # Build player detail lines with F9/B9 split
    player_lines = []
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
        tag = ", ".join(parts) if parts else "well-rounded"
        f9b9 = f" (F9: {data['f9_pts']}, B9: {data['b9_pts']})"
        player_lines.append(f"  {name}: {data['total']} points, {tag}{f9b9}")

    # Build per-hole highlights
    # Build bullet-friendly hole highlights — descriptive text, not abbreviations
    hole_highlights = []
    for name, data in sorted_players:
        for hd in data["hole_details"]:
            parts = []
            if hd["fo"] >= 2:
                if hd["par"] == 3:
                    parts.append(f"Hole {hd['hole']}: {name} won the par-3 carry-in")
                else:
                    parts.append(f"Hole {hd['hole']}: {name} got first-on/approach")
            if hd["gr"] >= 2:
                parts.append(f"Hole {hd['hole']}: {name} won the greenie")
            if hd["cl"] >= 2:
                parts.append(f"Hole {hd['hole']}: {name} had closest ball")
            if hd["p"] >= 2:
                parts.append(f"Hole {hd['hole']}: {name} had the longest putt")
            if hd["pts"] >= 3:
                parts.append(f"Hole {hd['hole']}: {name} swept (3-pointer)")
            if parts:
                hole_highlights.extend(parts)

    # Collect special moments
    all_sweeps = []
    all_greenies = []
    all_ci_streaks = []
    for name, data in sorted_players:
        all_sweeps.extend(data.get("sweeps", []))
        all_greenies.extend(data.get("greenies", []))
        all_ci_streaks.extend(data.get("ci_streaks", []))

    # Build score-free bullet data for the LLM
    bullet_data = []

    if all_greenies:
        bullet_data.append("--- GREENIES ---")
        bullet_data.extend(all_greenies)

    if all_sweeps:
        bullet_data.append("\n--- SWEEPS ---")
        bullet_data.extend(all_sweeps)

    if all_ci_streaks:
        bullet_data.append("\n--- CARRY-IN STREAKS ---")
        bullet_data.extend(all_ci_streaks)

    if hole_highlights:
        bullet_data.append("\n--- HOLE HIGHLIGHTS ---")
        bullet_data.extend(hole_highlights[:20])

    bullet_data.append("\n--- PLAYERS ---")
    for i, (name, data) in enumerate(sorted_players, 1):
        bullet_data.append(f"  #{i} {name}")

    # Margin — qualitative only, no point numbers
    if margin <= 1:
        margin_str = "Very close finish"
    elif margin >= 8:
        margin_str = "Comfortable win"
    else:
        margin_str = "Moderate margin"
    bullet_data.append("\n--- MARGIN ---")
    bullet_data.append(f"  {margin_str}")

    # Momentum — qualitative only
    bullet_data.append("\n--- MOMENTUM ---")
    for name, data in sorted_players:
        f9, b9 = data["f9_pts"], data["b9_pts"]
        if f9 > b9 * 1.5:
            bullet_data.append(f"  {name}: strong start, faded later")
        elif b9 > f9 * 1.5:
            bullet_data.append(f"  {name}: slow start, strong finish")
        else:
            bullet_data.append(f"  {name}: balanced round")

    prompt = "\n".join(bullet_data)

    # Bullet-format output request
    prompt += (
        "\n\nOUTPUT FORMAT:\n"
        "Write your response as bullet points with exactly these three section headers:\n\n"
        "OVERVIEW\n"
        "- bullet point (1 sentence, start with player name)\n"
        "- bullet point\n"
        "- bullet point\n\n"
        "FRONT NINE\n"
        "- bullet point (what happened holes 1-9, greenies, first-ons)\n"
        "- bullet point\n"
        "- bullet point\n\n"
        "BACK NINE\n"
        "- bullet point (what happened holes 10-18, momentum shifts)\n"
        "- bullet point\n"
        "- bullet point\n\n"
        "RULES:\n"
        "- ONLY bullet points. No prose paragraphs. No narrative.\n"
        "- NEVER include any scores, points, totals, or point values.\n"
        "- ONLY describe events in the data above. Do NOT invent holes or actions.\n"
        "- Each bullet: 1 short sentence. Start with player name.\n"
        "- Use these exact phrases from the data:\n"
        "  'won the par-3 carry-in' = first-on on a par-3\n"
        "  'won the greenie' = won greenie carry on a par-3\n"
        "  'closest ball' = closest ball to hole after green\n"
        "  'longest putt' = made the longest putt\n"
        "  'got first-on/approach' = closest on par-4/5\n"
        "  'swept (3-pointer)' = won 3 carries on one hole\n"
        "- No preamble, no sign-off. ONLY the three section headers and bullets."
    )
    return prompt


def generate_round_prose(round_data, round_stats):
    """Generate LLM prose for a round, with fallback."""
    system_msg = (
        "You write a Bingo Bango Bongo golf round analysis as bullet points. "
        "Format: OVERVIEW, FRONT NINE, BACK NINE sections with - bullet points. "
        "NEVER include any scores, points, totals, or point values. "
        "ONLY describe events in the data. Do NOT invent holes or actions. "
        "Each bullet: 1 sentence starting with player name. "
        "No prose paragraphs. No preamble. No sign-off."
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

    # Download latest backup from Render
    print(f"Downloading latest rounds backup from {BACKEND}...")
    try:
        backup_resp = urlopen(f"{BACKEND}/backup", timeout=15)
        backup_data = json.loads(backup_resp.read())
        backups = backup_data.get("backups", [])
        if backups:
            latest = backups[0]
            backup_url = f"{BACKEND}/backup/{latest}"
            backup_data_raw = urlopen(backup_url, timeout=30).read()
            backup_dir = Path("/home/wm/projects/bbb-scorer/rounds-backups")
            backup_dir.mkdir(exist_ok=True)
            backup_file = backup_dir / latest
            backup_file.write_bytes(backup_data_raw)
            print(f"  Backup saved: {backup_file} ({len(backup_data_raw)} bytes)")
        else:
            print("  No backups found on server.")
    except Exception as e:
        print(f"  Backup download failed: {e}")

    print("Done.")


if __name__ == "__main__":
    main()
