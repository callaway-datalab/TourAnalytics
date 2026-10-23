"""Build-time checks on one event bundle (the dict pga.build_event_bundle returns), plus the "thru N" annotation.

Every check is an identity the data must satisfy if the parsing is right:
  sg_total / sg_t2g       total = OTT + APP + ARG + PUTT, tee-to-green = OTT + APP + ARG (finished rounds only)
  counts_bounds           0 <= made <= attempts (ratios: both >= 0)
  pct_matches_counts      made / attempts reproduces the shown percentage
  ratio_matches_counts    numerator / denominator reproduces the shown ratio
  complement_sums         paired stats (Left/Right Tendency): same attempts, made adds up to attempts
  event_counts            a percentage's event value = sum of made / sum of attempts over the rounds
  event_sums              a "sum" stat's event value = sum of the round values
  holes_range             holes played in a round (eagles+birdies+pars+bogeys+doubles+others) is 0..18

validate() returns the failures that should stop a publish ("blocking"): a check with at least 3 failures AND more than 3% failing.
Everything else is returned as counts so the log shows what was verified.
"""
import re
from collections import defaultdict

SG_PARTS = ("off_the_tee", "approach", "around_the_green", "putting")
HOLE_IDS = ("106", "107", "523", "184", "520", "521")   # eagles+, birdies, pars, bogeys, doubles, others
_KN = re.compile(r"\((\d+)/(\d+)\)\s*$")
MIN_FAILS, MAX_FAIL_FRAC = 3, 0.03


class Tally:
    def __init__(self):
        self.checked, self.failed, self.samples = defaultdict(int), defaultdict(int), defaultdict(list)

    def test(self, name, ok, detail=""):
        self.checked[name] += 1
        if not ok:
            self.failed[name] += 1
            if len(self.samples[name]) < 3:
                self.samples[name].append(detail)


def kn(e):
    """(made, attempts) of an extra-stat entry: the k/n fields, or the "(K/N)" at the end of the shown text."""
    if not e:
        return None
    if e.get("k") is not None and e.get("n") is not None:
        return e["k"], e["n"]
    m = _KN.search(str(e.get("d", "")))
    return (int(m.group(1)), int(m.group(2))) if m else None


def _ratio_tol(v, p):
    s = str(p if p is not None else "")
    dec = len(s.split(".")[1]) if "." in s else 3
    return max(0.51 * 10 ** -dec, 0.0006, abs(v or 0) * 0.0006)


def holes_of(row):
    """Holes played in this round, or None unless all six scoring counts are present."""
    x = row.get("x") or {}
    vs = [(x.get(i) or {}).get("v") for i in HOLE_IDS]
    return None if any(v is None for v in vs) else int(round(sum(vs)))


def annotate_thru(bundle):
    """Mark players whose round is still in progress: row["thru"] = holes played (rounds and Event view)."""
    latest, last_rows = bundle.get("latest_round"), {}
    for r, res in (bundle.get("rounds") or {}).items():
        for row in res["rows"]:
            row.pop("thru", None)
            h = holes_of(row)
            if h is not None and 0 < h < 18:
                row["thru"] = h
            if str(r) == str(latest):
                last_rows[row["player_id"]] = row
    for row in ((bundle.get("event") or {}).get("rows") or []):
        row.pop("thru", None)
        row.pop("thru_round", None)
        src = last_rows.get(row["player_id"])
        if src and "thru" in src:
            row["thru"], row["thru_round"] = src["thru"], latest


def _candidate_complements(bundle, extras, limit=5):
    """Pairs of count stats in the same group that behave like Left/Right Tendency but are not configured: same attempts, made adds up."""
    configured = {tuple(sorted((e["id"], e["complement"]))) for e in extras if e.get("complement")}
    pool = [e for e in extras if e.get("counts") and e.get("pct")]
    res = (bundle.get("rounds") or {})
    if not res:
        return []
    rows = res[sorted(res)[0]]["rows"]
    found = []
    for i, a in enumerate(pool):
        for b in pool[i + 1:]:
            if a.get("group") != b.get("group") or tuple(sorted((a["id"], b["id"]))) in configured:
                continue
            tested = ok = 0
            for row in rows:
                x = row.get("x") or {}
                ka, kb = kn(x.get(a["id"])), kn(x.get(b["id"]))
                if ka and kb and ka[1] > 0:
                    tested += 1
                    ok += ka[1] == kb[1] and ka[0] + kb[0] == ka[1]
            if tested >= 8 and ok / tested >= 0.9:
                found.append(f'{a["id"]} + {b["id"]} ({a.get("label")} / {b.get("label")}) look like a complement pair: '
                             f'{ok}/{tested} players have the same attempts and made adds up. Add "complement" to stats.json to fill their missing rows.')
    return found[:limit]


def validate(bundle, extras):
    cfg = {e["id"]: e for e in (extras or [])}
    t, info = Tally(), []
    rounds = bundle.get("rounds") or {}
    event = bundle.get("event")

    def sg(rows, key, tol, label):
        for row in rows:
            v = {k: (row.get(k) or {}).get(key) for k in ("total", "tee_to_green") + SG_PARTS}
            if v["total"] is not None and all(v[k] is not None for k in SG_PARTS):
                s = sum(v[k] for k in SG_PARTS)
                t.test("sg_total", abs(v["total"] - s) <= tol, f'{label} {row["name"]}: total {v["total"]} vs parts {s:.3f}')
            if v["tee_to_green"] is not None and all(v[k] is not None for k in SG_PARTS[:3]):
                s = sum(v[k] for k in SG_PARTS[:3])
                t.test("sg_t2g", abs(v["tee_to_green"] - s) <= tol, f'{label} {row["name"]}: T2G {v["tee_to_green"]} vs parts {s:.3f}')

    # While a round is in progress the live feed scores total/T2G against the field on the holes played so far and
    # OTT/APP/ARG on another baseline, so the parts don't add up until the round is final. Check finished rounds only.
    live = {r for r, res in rounds.items() if any("thru" in row for row in res["rows"])}
    for r, res in rounds.items():
        if r in live:
            info.append(f"R{r} is in progress: strokes gained parts not checked yet")
        else:
            sg(res["rows"], "round", 0.02, f"R{r}")
    if event and not live:
        sg(event["rows"], "event", 0.03, "Event")

    pairs = sorted({tuple(sorted((e["id"], e["complement"]))) for e in cfg.values() if e.get("complement")})
    for r, res in rounds.items():
        for row in res["rows"]:
            x = row.get("x") or {}
            for sid, e in x.items():
                c, pair, v = cfg.get(sid, {}), kn(e), e.get("v")
                if pair is None or "k" not in e:
                    continue
                k, n = pair
                ok = (k >= 0 and n >= 0) if c.get("ratio") else 0 <= k <= n   # a ratio (putts per GIR, birdies per bogey) can exceed 1
                t.test("counts_bounds", ok, f'R{r} {row["name"]} {sid}: {k}/{n}')
                if c.get("ratio") and v is not None and n > 0:
                    t.test("ratio_matches_counts", abs(k / n - v) <= _ratio_tol(v, e.get("p")), f'R{r} {row["name"]} {sid}: {k}/{n} vs {v}')
                elif c.get("pct") and v is not None and n > 0:
                    t.test("pct_matches_counts", abs(100.0 * k / n - v) <= 0.06, f'R{r} {row["name"]} {sid}: {k}/{n} vs {v}')
            for a, b in pairs:
                ka, kb = kn(x.get(a)), kn(x.get(b))
                if ka and kb:
                    t.test("complement_sums", ka[1] == kb[1] and ka[0] + kb[0] == ka[1], f'R{r} {row["name"]} {a}/{b}: {ka} {kb}')
            h = holes_of(row)
            if h is not None:
                t.test("holes_range", 0 <= h <= 18, f'R{r} {row["name"]}: {h} holes')

    if event:
        by_pid = {r: {row["player_id"]: row for row in res["rows"]} for r, res in rounds.items()}
        for row in event["rows"]:
            pid, played = row["player_id"], [r for r in sorted(by_pid) if row["player_id"] in by_pid[r]]
            for sid, e in (row.get("x") or {}).items():
                c = cfg.get(sid, {})
                ents = [(by_pid[r][pid].get("x") or {}).get(sid) for r in played]
                if any(en is None for en in ents) or not ents:
                    continue
                if c.get("counts") and c.get("pct"):
                    ev, parts = kn(e), [kn(en) for en in ents]
                    if ev and all(parts):
                        K, N = sum(p[0] for p in parts), sum(p[1] for p in parts)
                        t.test("event_counts", (K, N) == tuple(ev), f'{row["name"]} {sid}: event {ev} vs rounds {(K, N)}')
                elif c.get("agg") == "sum" and not c.get("counts") and e.get("v") is not None and all(en.get("v") is not None for en in ents):
                    s = sum(en["v"] for en in ents)
                    t.test("event_sums", abs(e["v"] - s) <= 0.01, f'{row["name"]} {sid}: event {e["v"]} vs rounds {s}')
            for a, b in pairs:
                ka, kb = kn((row.get("x") or {}).get(a)), kn((row.get("x") or {}).get(b))
                if ka and kb and ka[1] > 0:
                    t.test("complement_sums", ka[1] == kb[1] and ka[0] + kb[0] == ka[1], f'Event {row["name"]} {a}/{b}: {ka} {kb}')

    blocking = []
    for name, failed in sorted(t.failed.items()):
        n = t.checked[name]
        if failed >= MIN_FAILS and failed / n > MAX_FAIL_FRAC:
            blocking.append(f'{name}: {failed} of {n} failed, e.g. {t.samples[name][0]}')
    info.extend(_candidate_complements(bundle, extras or []))
    return {"summary": {k: [t.checked[k], t.failed.get(k, 0)] for k in sorted(t.checked)}, "blocking": blocking, "info": info}
