"""Fetches PGA Tour data and writes static JSON into public/data/ (run by GitHub Actions).

Only the CURRENT event of each tour is kept: PGA Tour (R) and Korn Ferry Tour (H). "Current" = the newest event that has
started and has strokes gained data; during the Tuesday/Wednesday before a new event the previous one stays on screen.
Output: data/current.json (what the page loads) + data/<tour>/<year>-<t_num>.json (one event per tour). Older files are deleted.
Env: PGA_API_TOKEN (required) | TOURS="R,H" (default both) | FORCE_REFRESH=1 (refetch even a finished event)
     CHECKS=enforce|warn|off (default enforce: an event whose data fails the identity checks keeps its previous file)
     PGA_RECORD_DIR / PGA_REPLAY_DIR / PGA_TODAY / PGA_OUT_DIR: record real responses, replay them offline (see pga.py)
"""
import json
import os
import re
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import checks
import pga

OUT = Path(os.getenv("PGA_OUT_DIR") or Path(__file__).resolve().parent.parent / "public" / "data")
TOUR_LABELS = {"R": "PGA Tour", "H": "Korn Ferry Tour"}
TOURS = [t.strip().upper() for t in os.getenv("TOURS", "R,H").split(",") if t.strip()]


def load_stats():
    """Extra stats to collect (generator/stats.json): [{"id": "101", "label": optional, "agg": "avg"|"sum"}]."""
    try:
        cfg = json.loads((Path(__file__).resolve().parent / "stats.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [{**e, "id": str(e["id"]).strip()} for e in cfg if isinstance(e, dict) and e.get("id") and e.get("enabled", True)]


STATS = load_stats()


def stats_for(tour):
    """A stat in stats.json can carry "tours": ["H"] to be collected for those tours only (default: every tour)."""
    return [e for e in STATS if tour in [str(t).upper() for t in e.get("tours", TOURS)]]


def stats_sig(tour):
    return pga.stats_signature(stats_for(tour))


CHECKS_MODE = os.getenv("CHECKS", "enforce").lower()
BLOCKED = []                                              # events whose new data failed the checks this run
FORCE = os.getenv("FORCE_REFRESH", "") not in ("", "0")   # refetch everything, even finished events
PROBE = {"ok": True, "fails": 0}                          # shared across tours: stop probing the live feed for old events if it never has them


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")          # write then rename, so a crash never leaves a half-written file
    tmp.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def is_recent(ev, today) -> bool:
    end = date.fromisoformat(ev["end"]) if ev.get("end") else None
    return end is None or end >= today - timedelta(days=3)   # live, or finished in the last 3 days


def needs_refresh(existing, ev, today, sig) -> bool:
    if existing is None or FORCE or existing.get("partial") or existing.get("stats_sig", "") != sig:
        return True
    end = date.fromisoformat(ev["end"]) if ev.get("end") else None
    if is_recent(ev, today):
        return True
    if existing.get("error") and end and end >= today - timedelta(days=30):   # retry empty ones for a month
        return True
    return False


def rounds_with_data(bundle):
    """Rounds with at least one strokes gained value (older files can hold empty placeholder rounds)."""
    return sum(any((row.get("total") or {}).get("round") is not None for row in res.get("rows", []))
               for res in (bundle.get("rounds") or {}).values())


def event_path(tour, ev):
    return OUT / tour / f"{ev['year']}-{ev['t_num']}.json"


def sync_event(tour, ev, today):
    """Fetch (or reuse) one event's bundle. Returns the bundle that is on disk afterwards, or None."""
    f = event_path(tour, ev)
    existing = read(f)
    if not needs_refresh(existing, ev, today, stats_sig(tour)):
        return existing
    print(f"Fetching {tour} {ev['year']} {ev['t_num']} {ev['name']} ...", flush=True)
    # (update 300) a tournament in progress: the rounds before its latest one are over, so their API responses are
    # reused from the last run (kept in _cache/) and only the latest round (and any new one) is downloaded again
    cache_f = OUT / "_cache" / f"{tour}-{ev['year']}-{ev['t_num']}.json"
    latest = (existing or {}).get("latest_round") or 0
    live_now = is_recent(ev, today)
    pga.FINAL_ROUNDS = set(range(1, int(latest))) if latest and live_now else set()
    pga.RAW_CACHE = (read(cache_f) or {}) if live_now else {}
    pga.RAW_STATS.update(hits=0, new=0)
    pga.RECORDING[0] = live_now
    try:
        recent = is_recent(ev, today)
        bundle = pga.build_event_bundle(ev["t_num"], ev["year"], t_code=tour, prefer="live" if recent else "synd",
                                        extras=stats_for(tour), probe_live=PROBE["ok"] and not recent)
    except Exception as e:
        print(f"  skipped: {type(e).__name__}: {e}")
        bundle = {"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "t_num": ev["t_num"],
                  "year": ev["year"], "source": None, "latest_round": None, "rounds": {}, "event": None,
                  "stats": [], "stats_sig": stats_sig(tour), "partial": True, "error": f"{type(e).__name__}: {e}"}
    pga.RECORDING[0] = False
    if live_now:
        if pga.FINAL_ROUNDS:
            print(f"  finished rounds {sorted(pga.FINAL_ROUNDS)}: {pga.RAW_STATS['hits']} responses reused")
        # keep the responses of every round before the latest one now in (those rounds are over)
        done = set(range(1, int(bundle.get("latest_round") or 0)))
        keep = {k: v for k, v in pga.RAW_CACHE.items() if pga._round_of(dict(x.split("=", 1) for x in k.split("?", 1)[1].split("&") if "=" in x)) in done}
        if keep and keep != (read(cache_f) or {}):
            write(cache_f, keep)
        for old_f in (OUT / "_cache").glob(f"{tour}-*.json"):          # other tournaments' copies aren't needed
            if old_f != cache_f:
                old_f.unlink()
    pga.FINAL_ROUNDS, pga.RAW_CACHE = set(), {}
    if bundle.get("rounds") and CHECKS_MODE != "off":
        checks.annotate_thru(bundle)
        res = checks.validate(bundle, stats_for(tour))
        bundle["checks"] = res["summary"]
        for line in res["info"]:
            print(f"  note: {line}")
        print("  checks: " + ", ".join(f"{k} {v[0] - v[1]}/{v[0]}" for k, v in res["summary"].items()))
        if res["blocking"]:
            for line in res["blocking"]:
                print(f"::warning::{tour} {ev['name']} failed validation: {line}")
            BLOCKED.append(f"{tour} {ev['name']}: " + "; ".join(res["blocking"]))
            if CHECKS_MODE == "enforce" and existing and existing.get("rounds"):
                print("  Validation failed; keeping the previous data for this event.")
                return existing
            bundle["warnings"] = res["blocking"]        # nothing better to show: publish, and the page says so
    if bundle["error"] and existing and not existing.get("error"):
        print("  API returned nothing this time; keeping the previous data.")
        return existing
    if existing and rounds_with_data(bundle) < rounds_with_data(existing):
        print("  Got fewer rounds than before; keeping the previous data.")
        return existing
    if bundle.get("error") and bundle["partial"]:
        print("  Temporary API problem (rate limit / timeout), nothing saved. It will be retried next run.")
        return existing
    if existing and {k: v for k, v in existing.items() if k != "fetched_at"} == {k: v for k, v in bundle.items() if k != "fetched_at"}:
        print("  unchanged.")
        return existing
    write(f, bundle)
    if bundle.get("live_probe") == "none":
        PROBE["fails"] += 1
        if PROBE["fails"] >= 3 and PROBE["ok"]:
            PROBE["ok"] = False
            print("  Live-only stats (Pars, Bogeys...) aren't available for past events; no longer trying for the rest of this run.")
    elif bundle.get("live_probe") == "ok":
        PROBE["fails"] = 0
    print(f"  source: {bundle.get('source')}  latest round: {bundle['latest_round']}  error: {bundle['error']}")
    if bundle.get("partial"):
        print("  NOTE: some rounds were missing because of temporary API errors; this event will be retried next run.")
    return bundle


def started_events(tour, today):
    """Events that have started, newest first. Falls back to last season in early January."""
    for year in (today.year, today.year - 1):
        items = pga.list_tournaments(year, tour)["items"]
        if items:
            return items
    return []


def pick_current(tour, today):
    """(event, bundle) for the tour's current event = the newest event that has started, whether or not it has data.
    Only in the first 3 days after its start (round 1 may not be posted yet) does the previous event stay on screen
    when the newest one has no strokes gained rows. After that the newest event is shown with the API's reason."""
    events = started_events(tour, today)
    if not events:
        raise RuntimeError("the schedule has no started events (field names unexpected? run: python generator/pga.py events)")
    for ev in events[:3]:
        print(f"  {tour} schedule: {ev['t_num']} {ev['name']}  {ev.get('start')} to {ev.get('end')}")
    newest = events[0]
    bundle = sync_event(tour, newest, today)
    if bundle and bundle.get("rounds"):
        return newest, bundle
    start = date.fromisoformat(newest["start"]) if newest.get("start") else None
    if len(events) > 1 and start and (today - start).days <= 3:
        prev = events[1]
        pb = sync_event(tour, prev, today)
        if pb and pb.get("rounds"):
            print(f"  {newest['name']} has no data yet (started {(today - start).days} day(s) ago); showing {prev['name']} until it does.")
            return prev, pb
    if bundle is None:
        bundle = read(event_path(tour, newest))
    print(f"  {newest['name']} has no strokes gained data: {(bundle or {}).get('error')}")
    return newest, bundle


def reason_for(ev, bundle, today):
    """Why an event has no strokes gained to show: not_yet (round 1 not published), no_shotlink (should have been, so probably none), fetch_failed."""
    if bundle and bundle.get("rounds"):
        return None
    if bundle is None or bundle.get("partial"):
        return "fetch_failed"
    start = date.fromisoformat(ev["start"]) if ev.get("start") else None
    return "not_yet" if start and (today - start).days <= 1 else "no_shotlink"


def describe(tour, ev, today):
    start = date.fromisoformat(ev["start"]) if ev.get("start") else None
    end = date.fromisoformat(ev["end"]) if ev.get("end") else None
    live = bool(start and start <= today and (end is None or today <= end))
    return {"tour": tour, "label": TOUR_LABELS.get(tour, tour), "year": ev["year"], "t_num": ev["t_num"], "name": ev["name"],
            "start": ev.get("start"), "end": ev.get("end"), "status": "live" if live else "final",
            "path": f"data/{tour}/{ev['year']}-{ev['t_num']}.json"}


def prune(tour, keep: Path):
    d = OUT / tour
    for p in d.glob("*.json"):
        if p != keep:
            print(f"Removing old event file {p.name}")
            p.unlink()


def prune_legacy():
    """Files from the old all-events layout (data/2026/*.json, schedule-YYYY.json, index.json)."""
    for p in OUT.iterdir():
        if p.is_dir() and re.fullmatch(r"\d{4}", p.name):
            shutil.rmtree(p)
        elif p.is_file() and (p.name == "index.json" or re.fullmatch(r"schedule-\d{4}\.json", p.name)):
            p.unlink()


# (update 824) official results (results/{tour}-{year}.json), who's entered in the coming events (fields.json) and player bios
# (bios.json), for the portal. Kept between runs: a finished event's results are fetched once; a run fetches at most a set
# number of new things (the first runs fill in the past seasons over a few runs), and anything that fails is tried next run.
BUDGET = {"left": int(os.getenv("EXTRAS_BUDGET", "120"))}


def _spend():
    if BUDGET["left"] <= 0:
        return False
    BUDGET["left"] -= 1
    return True


def api_extras(today, sched_rows):
    """sched_rows: {tour: [schedule rows, this year and next]}"""
    seen_pids = {}
    # (update 825) everyone's full name by player id (players.json, written at the start of this run): the leaderboard's own
    # name field may be short or "Last, First", so the portal matches on these
    full = {str(p.get("player_id")): p.get("name") for p in (read(OUT / "players.json") or []) if p.get("player_id")}
    named = lambda rows: [{**r, "name": full.get(str(r.get("pid")), r.get("name"))} for r in rows]
    for tour in TOURS:
        for year in (today.year - 1, today.year):
            path = OUT / "results" / f"{tour}-{year}.json"
            have = read(path) or {"tour": tour, "year": year, "events": {}}
            evs = have.setdefault("events", {})
            rows = [r for r in sched_rows.get(tour, []) if r.get("year") == year]
            if not rows and year < today.year:
                try:
                    rows = pga.schedule_rows(year, tour)
                except Exception as e:
                    print(f"  {tour} {year} schedule: {type(e).__name__}: {e}", file=sys.stderr)
            changed = False
            for e in evs.values():
                fixed = named(e.get("rows", []))
                if fixed != e.get("rows"):
                    e["rows"] = fixed
                    changed = True
            for ev in rows:
                tid, st = ev.get("t_id"), ev.get("start")
                if not tid or not st or st > str(today):
                    continue
                old = evs.get(tid)
                if old and old.get("final"):
                    continue
                if not _spend():
                    break
                try:
                    lb = named(pga.get_leaderboard(tid))
                except Exception as e:
                    print(f"  results {tid}: {type(e).__name__}: {e}", file=sys.stderr)
                    continue
                if not lb:
                    continue
                end = ev.get("end") or st
                evs[tid] = {"name": ev["name"], "t_num": ev.get("t_num"), "start": st, "end": end, "course": ev.get("course"),
                            "final": end < str(today - timedelta(days=2)), "rows": lb}
                changed = True
            for e in evs.values():
                for r in e.get("rows", []):
                    if r.get("pid"):
                        seen_pids[r["pid"]] = r.get("name")
            if changed:
                write(path, have)
        # who's entered: the events starting within three weeks (or under way)
    fields = read(OUT / "fields.json") or {"tours": {}}
    ft, fchanged = fields.setdefault("tours", {}), False
    soon, began = str(today + timedelta(days=21)), str(today - timedelta(days=4))
    for tour in TOURS:
        cur = ft.setdefault(tour, {})
        for ev in sched_rows.get(tour, []):
            st, tid = ev.get("start"), ev.get("t_id") or f"{tour}{ev.get('year')}{ev.get('t_num')}"
            if not st or st > soon or (ev.get("end") or st) < began or not ev.get("t_num"):
                continue
            if not _spend():
                break
            try:
                players = named(pga.get_field(ev["year"], ev["t_num"], tour))
            except Exception as e:
                print(f"  field {tid}: {type(e).__name__}: {e}", file=sys.stderr)
                continue
            if players and (cur.get(tid) or {}).get("players") != players:
                cur[tid] = {"name": ev["name"], "year": ev["year"], "t_num": ev["t_num"], "start": st, "end": ev.get("end"), "course": ev.get("course"), "players": players}
                fchanged = True
            for p in players:
                if p.get("pid"):
                    seen_pids[p["pid"]] = p.get("name")
        for k in [k for k, v in cur.items() if (v.get("end") or v.get("start") or "") < began]:   # finished events drop off
            del cur[k]
            fchanged = True
    if fchanged:
        fields["generated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        write(OUT / "fields.json", fields)
    # bios: everyone in the fields and results, fetched once and refreshed every 30 days
    bios = read(OUT / "bios.json") or {"players": {}}
    bp, bchanged, stale = bios.setdefault("players", {}), False, str(today - timedelta(days=30))
    # (the players in the coming fields first, then everyone else)
    order = sorted(seen_pids, key=lambda pid: 0 if any(any(p.get("pid") == pid for p in v.get("players", [])) for t in ft.values() for v in t.values()) else 1)
    for pid in order:
        if (bp.get(pid) or {}).get("at", "") >= stale:
            continue
        if not _spend():
            break
        try:
            b = pga.get_bio(pid)
        except Exception as e:
            print(f"  bio {pid}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        bp[pid] = {**(b or {}), "name": full.get(pid) or (b or {}).get("name") or seen_pids[pid], "at": str(today)}
        bchanged = True
    if bchanged:
        write(OUT / "bios.json", bios)
    print(f"  extras: {int(os.getenv('EXTRAS_BUDGET', '120')) - BUDGET['left']} API calls")


def main():
    today = pga.today()
    write(OUT / "players.json", pga.load_players())
    write(OUT / "stats_meta.json", [{"id": e["id"], "label": e.get("label"), "group": e.get("group"), "lower": bool(e.get("lower")),
                                     "default": e.get("default", True) is not False, "tip": e.get("tip", ""),
                                     "pct": bool(e.get("pct")), "counts": bool(e.get("counts")), "ratio": bool(e.get("ratio")),
                                     "rank": e.get("rank", True) is not False} for e in STATS])
    old = {t["tour"]: t for t in (read(OUT / "current.json") or {}).get("tours", [])}
    entries, failed = [], []
    for tour in TOURS:
        try:
            ev, bundle = pick_current(tour, today)
        except Exception as e:      # one tour failing (API hiccup, unexpected schedule) must not wipe the other
            print(f"{tour}: could not determine the current event: {type(e).__name__}: {e}", file=sys.stderr)
            failed.append(tour)
            if tour in old:
                entries.append(old[tour])   # keep showing what we had
            continue
        entry = describe(tour, ev, today)
        entry["has_data"] = bool(bundle and bundle.get("rounds"))
        entry["reason"] = reason_for(ev, bundle, today)
        entry["warnings"] = bool(bundle and bundle.get("warnings"))
        entries.append(entry)
        if event_path(tour, ev).exists():          # never delete the old event's file until the new one has something on disk
            prune(tour, event_path(tour, ev))
        print(f"{tour}: current event is {ev['name']} ({entry['status']}, data: {entry['has_data']})")
    if len(failed) == len(TOURS):
        raise RuntimeError("could not determine the current event for any tour")
    prune_legacy()
    # (update 823) the schedule (this year and next, each tour), for the portal's next event; written only when it changes
    try:
        sched = {}
        for tour in TOURS:
            rows = []
            for y in (today.year, today.year + 1):
                try:
                    rows += pga.schedule_rows(y, tour)
                except Exception as e:      # next year's schedule may not be out yet
                    print(f"  {tour} {y} schedule: {type(e).__name__}: {e}", file=sys.stderr)
            sched[tour] = sorted(rows, key=lambda r: r.get("start") or "9999")
        if any(sched.values()) and (read(OUT / "schedule.json") or {}).get("tours") != sched:
            write(OUT / "schedule.json", {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tours": sched})
    except Exception as e:
        print(f"schedule not written: {type(e).__name__}: {e}", file=sys.stderr)
        sched = {}
    try:
        api_extras(today, sched)
    except Exception as e:                         # results, fields and bios must never stop the live feed
        print(f"results / fields / bios not written: {type(e).__name__}: {e}", file=sys.stderr)
    prev = read(OUT / "current.json") or {}
    if prev.get("tours") != entries:                # rewriting an identical file would make every run commit and deploy
        write(OUT / "current.json", {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tours": entries})
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary and BLOCKED:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("### Validation failures (previous data kept)\n" + "\n".join(f"- {b}" for b in BLOCKED) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # make the GitHub Action fail loudly with a readable reason
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
