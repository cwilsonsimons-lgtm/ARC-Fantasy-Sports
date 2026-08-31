#!/usr/bin/env python3
"""Give the rookie class real projections and a real place on the draft board.

The player table carries this note:

    proj/ADP are modelled from 2025 PPR production regressed toward positional
    means; ADP is value-over-replacement for a 10-team QB/2RB/3WR/TE/FLEX league.

A rookie has no prior NFL production, so that model has no input for one and
falls back to the positional mean. The result was 216 rookies sharing three
projections between them — 45.9 for every WR and RB, 34.4 for every TE, 57.4 for
every QB — and an ADP tail sorted by player id. Every screen that ranks by
projection or ADP therefore sorted the entire rookie class into one indistinct
block below the veterans, whatever the player was worth.

The signal that replaces prior production for a rookie is draft capital. This
reads where each rookie was actually taken in the NFL draft, and what rookies
taken in that range have actually scored, and projects from that.

Sources, both nflverse (https://github.com/nflverse/nflverse-data):
  players.csv                  gsis_id, draft_round, draft_pick, rookie_season
  player_stats_season_YYYY.csv season PPR totals, 2019-2024

Both join to the app's table on gsis_id, which is what the first column already
holds. Nothing here is invented: a rookie's projection is the fitted average of
what real rookies drafted at that slot really scored.

Usage:
  python3 tools/rookie-projections.py [--apply] [--file prototype/app.html]

Without --apply it reports what would change and writes nothing.
"""
import argparse
import csv
import math
import os
import re
import sys
import urllib.request

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
CACHE = os.environ.get("NFLVERSE_CACHE", "/tmp/nflverse-cache")
SEASONS = range(2019, 2025)
POSITIONS = ("QB", "RB", "WR", "TE")

# A pick number standing in for "went undrafted". Kept out of the fit and given
# the observed undrafted average instead, because undrafted is a category rather
# than a point on the curve.
UDFA = 10_000


def fetch(name, url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        sys.stderr.write("fetching %s\n" % name)
        urllib.request.urlretrieve(url, path)
    return path


def load_master():
    """gsis_id -> {draft_pick, rookie_season, position} for every NFL player."""
    path = fetch("players.csv", "%s/players/players.csv" % NFLVERSE)
    out = {}
    with open(path, newline="", encoding="utf8") as fh:
        for row in csv.DictReader(fh):
            gid = row.get("gsis_id")
            if not gid:
                continue
            try:
                pick = int(row["draft_pick"]) if row.get("draft_pick") else UDFA
            except ValueError:
                pick = UDFA
            out[gid] = {
                "pick": pick,
                "rookie_season": row.get("rookie_season") or "",
                "pos": (row.get("position") or "").upper(),
                "name": row.get("display_name") or "",
            }
    return out


def rookie_seasons(master):
    """Every real rookie season 2019-2024 as (position, draft pick, PPR points).

    A row counts only when the season equals the player's rookie season, so the
    sample is first-year production and nothing else.
    """
    out = []
    for year in SEASONS:
        name = "player_stats_season_%d.csv" % year
        path = fetch(name, "%s/player_stats/%s" % (NFLVERSE, name))
        with open(path, newline="", encoding="utf8") as fh:
            for row in csv.DictReader(fh):
                if row.get("season_type") not in ("REG", "", None):
                    continue
                rec = master.get(row.get("player_id", ""))
                if not rec or rec["rookie_season"] != row.get("season"):
                    continue
                pos = (row.get("position") or rec["pos"]).upper()
                if pos not in POSITIONS:
                    continue
                try:
                    pts = float(row.get("fantasy_points_ppr") or 0)
                except ValueError:
                    continue
                out.append((pos, rec["pick"], pts))
    return out


def fit_curve(points):
    """Fit pts(pick) = floor + (peak - floor) * exp(-(pick - 1) / scale).

    Least squares by grid search over the real observations — 536 of them, so a
    search is cheaper than pulling in a solver, and the shape is fixed to a
    decay so a thin bucket at the top cannot produce a curve that rises with
    draft pick.
    """
    drafted = [(p, v) for p, v in points if p != UDFA]
    if not drafted:
        return None
    best = None
    for peak in range(80, 341, 10):
        for scale in range(10, 201, 5):
            # With peak and scale fixed the optimal floor is the mean residual.
            resid = [v - peak * math.exp(-(p - 1) / scale) for p, v in drafted]
            floor = max(0.0, sum(resid) / len(resid))
            err = sum((v - (floor + peak * math.exp(-(p - 1) / scale))) ** 2
                      for p, v in drafted)
            if best is None or err < best[0]:
                best = (err, peak, scale, floor)
    _, peak, scale, floor = best
    return {"peak": peak, "scale": scale, "floor": floor}


def build_model(observations):
    model = {}
    for pos in POSITIONS:
        rows = [(pick, pts) for p, pick, pts in observations if p == pos]
        udfa = [pts for pick, pts in rows if pick == UDFA]
        curve = fit_curve(rows)
        if not curve:
            continue
        curve["udfa"] = round(sum(udfa) / len(udfa), 1) if udfa else curve["floor"]
        drafted = sorted(pts for pick, pts in rows if pick != UDFA)
        curve["cap"] = drafted[int(len(drafted) * 0.9)] if len(drafted) > 9 else max(drafted)
        curve["n"] = len([r for r in rows if r[0] != UDFA])
        curve["n_udfa"] = len(udfa)
        model[pos] = curve
    return model


def project(model, pos, pick):
    m = model.get(pos)
    if not m:
        return None
    if pick == UDFA:
        return round(m["udfa"], 1)
    fitted = m["floor"] + m["peak"] * math.exp(-(pick - 1) / m["scale"])
    # The very top of the draft is thin — one rookie RB has gone in the top ten
    # in six years — so the fit is extrapolating there, and an exponential
    # extrapolates hard. Cap it at the 90th percentile of what rookies at this
    # position have actually scored, which is a real number rather than the
    # tail of a curve.
    return round(min(fitted, m["cap"]), 1)


# --- the app's table -------------------------------------------------------

FIELDS = "id short full pos tm num exp hs sproj adp".split()


def read_pool(text):
    m = re.search(r"NFL_SRC ?= ?`(.*?)`", text, re.S)
    if not m:
        raise SystemExit("could not find NFL_SRC")
    rows = []
    for line in m.group(1).split("\n"):
        if not line.strip():
            continue
        f = line.split("|")
        rows.append(dict(zip(FIELDS, f)))
    return m, rows


def renumber_adp(rows):
    """Insert the rookies into the existing board without reshuffling veterans.

    Veterans keep the order the table already gives them, so this is not a
    rerank of the pool — that would churn every ADP in the app for no reason.

    A rookie is placed against veterans *at its own position*: it goes directly
    ahead of the first veteran at that position it outprojects. Ranking by a
    refitted value-over-replacement instead put rookies a few slots wrong —
    Makai Lemon ahead of Justin Jefferson on a lower projection — because the
    stored board is not quite the VOR this script would compute, and a rookie
    judged on one rule cannot be slotted into an order built on another. Within
    a position the comparison needs no rule at all: more projected points is
    simply better. Across positions the rookie inherits whatever the veteran
    board already says, which is the ordering the app shipped with.
    """
    vets = sorted((r for r in rows if r["exp"] != "0"), key=lambda r: int(r["adp"]))
    rookies = [r for r in rows if r["exp"] == "0"]

    at_pos = {}
    for i, v in enumerate(vets):
        at_pos.setdefault(v["pos"], []).append((i, float(v["sproj"])))

    slots = {}
    for rook in rookies:
        proj = float(rook["sproj"])
        landing = len(vets)
        for i, vproj in at_pos.get(rook["pos"], ()):
            if vproj < proj:
                landing = i
                break
        slots.setdefault(landing, []).append(rook)

    merged = []
    for i, vet in enumerate(vets):
        merged.extend(sorted(slots.pop(i, []), key=lambda r: -float(r["sproj"])))
        merged.append(vet)
    for k in sorted(slots):
        merged.extend(sorted(slots[k], key=lambda r: -float(r["sproj"])))

    for i, r in enumerate(merged, 1):
        r["adp"] = str(i)
    return merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="prototype/app.html")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    text = open(args.file, encoding="utf8").read()
    match, rows = read_pool(text)

    master = load_master()
    model = build_model(rookie_seasons(master))

    print("rookie-season production by draft slot, fitted from real seasons")
    for pos in POSITIONS:
        m = model[pos]
        print("  %-3s n=%-4d peak=%-5.0f scale=%-4d floor=%-5.1f udfa=%-5.1f  "
              "cap=%-6.1f pick1=%-6.1f pick32=%-6.1f pick100=%.1f"
              % (pos, m["n"], m["peak"], m["scale"], m["floor"], m["udfa"],
                 m["cap"], project(model, pos, 1), project(model, pos, 32),
                 project(model, pos, 100)))

    rookies = [r for r in rows if r["exp"] == "0"]
    drafted = unknown = 0
    for r in rookies:
        rec = master.get(r["id"])
        pick = rec["pick"] if rec else UDFA
        if rec and pick != UDFA:
            drafted += 1
        else:
            unknown += 1
        r["_pick"] = pick
        new = project(model, r["pos"], pick)
        r["_old"] = r["sproj"]
        if new is not None:
            r["sproj"] = "%.1f" % new

    print("\n%d rookies: %d matched to a real draft pick, %d undrafted or not found"
          % (len(rookies), drafted, unknown))

    merged = renumber_adp(rows)
    top = sorted((r for r in rookies if r["_pick"] != UDFA), key=lambda r: r["_pick"])[:12]
    print("\ntop of the class, with where they now sit on the board:")
    for r in top:
        print("  R%d P%-3d %-24s %-3s %-4s proj %s -> %-6s  ADP %s"
              % ((r["_pick"] - 1) // 32 + 1, r["_pick"], r["full"], r["pos"],
                 r["tm"], r["_old"], r["sproj"], r["adp"]))

    best = min(rookies, key=lambda r: int(r["adp"]))
    print("\nbest rookie now at ADP %s (was %s of 895); rookies inside the top 100: %d"
          % (best["adp"], best["_old"] and "a flat tail",
             sum(1 for r in rookies if int(r["adp"]) <= 100)))

    if not args.apply:
        print("\nnothing written (pass --apply)")
        return

    lines = ["|".join(r[k] for k in FIELDS) for r in merged]
    body = "\n".join(lines)
    out = text[:match.start(1)] + body + text[match.end(1):]
    open(args.file, "w", encoding="utf8").write(out)
    print("\nwrote %s" % args.file)


if __name__ == "__main__":
    main()
