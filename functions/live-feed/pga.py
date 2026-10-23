"""PGA Tour API wrapper: auth, round strokes gained, player/tournament lookup."""
import os, time, difflib, threading, json, hashlib, re
from pathlib import Path
import httpx

try:
    import config  # local credentials (config.py)
except ImportError:
    config = None

BASE = os.getenv("PGA_API_BASE", "https://tourapi.pgatourhq.com:8243")
TOKEN_URL = os.getenv("PGA_TOKEN_URL", "https://tourapi.pgatourhq.com:9443/oauth2/token")

# Stat IDs verified against Bank of Utah R1 (Brennan: OTT 1.799, APP 2.600) and T2G = OTT+APP+ARG
SG_STATS = {
    "total": "02675",
    "off_the_tee": "02567",
    "approach": "02568",
    "around_the_green": "02569",
    "putting": "02564",
    "tee_to_green": "02674",
}

_token = {"value": os.getenv("PGA_API_TOKEN") or getattr(config, "PGA_API_TOKEN", None), "exp": 0.0}


def _get_token() -> str:
    """Use PGA_API_TOKEN if set; otherwise refresh via client credentials (tokens last ~1h)."""
    cid, secret = os.getenv("PGA_CLIENT_ID"), os.getenv("PGA_CLIENT_SECRET")
    if cid and secret and time.time() > _token["exp"]:
        r = httpx.post(TOKEN_URL, data={"grant_type": "client_credentials"},
                       auth=(cid, secret), timeout=15)
        r.raise_for_status()
        j = r.json()
        _token.update(value=j["access_token"], exp=time.time() + j.get("expires_in", 3600) - 60)
    if not _token["value"]:
        _token["value"] = os.getenv("PGA_API_TOKEN") or getattr(config, "PGA_API_TOKEN", None)
    if not _token["value"]:
        raise RuntimeError("Set PGA_API_TOKEN or PGA_CLIENT_ID + PGA_CLIENT_SECRET")
    return _token["value"]


_SEM = threading.Semaphore(4)     # at most 4 requests in flight
_pace_lock, _last_start = threading.Lock(), [0.0]


def _pace(gap=0.15):
    """Space request starts at least `gap` seconds apart so we don't trip the API's rate limit."""
    with _pace_lock:
        wait = _last_start[0] + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_start[0] = time.time()


def _fixture_file(folder, path, params):
    key = path + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
    stem = re.sub(r"[^A-Za-z0-9]+", "_", path.strip("/"))[:40]
    return Path(folder) / f"{stem}_{hashlib.sha1(key.encode()).hexdigest()[:16]}.json"


def _get(path: str, **params):
    """PGA_RECORD_DIR=dir saves every API response as a file; PGA_REPLAY_DIR=dir serves them back with no network or token.
    Record during a live round (one folder per snapshot), then replay each folder through build_data.py to test the pipeline."""
    replay = os.getenv("PGA_REPLAY_DIR")
    if replay:
        f = _fixture_file(replay, path, params)
        if not f.exists():
            raise LookupError(f"no recorded response for {path} {params}")
        return json.loads(f.read_text(encoding="utf-8"))
    with _SEM:
        out = _get_unlimited(path, **params)
    record = os.getenv("PGA_RECORD_DIR")
    if record:
        f = _fixture_file(record, path, params)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return out


def _get_unlimited(path: str, **params):
    last, timeouts = None, 0
    for attempt in range(6):
        try:
            _pace()
            r = httpx.get(f"{BASE}{path}", params=params, timeout=httpx.Timeout(20.0, read=120.0),
                          headers={"accept": "*/*", "User-Agent": getattr(config, "USER_AGENT", "sg-bot"),
                                   "Authorization": f"Bearer {_get_token()}"})
            if r.status_code == 429:           # rate limited: wait (Retry-After if given) and try again
                try:
                    wait = float(r.headers.get("Retry-After", ""))
                except ValueError:
                    wait = min(5 * 2 ** attempt, 60)
                last = httpx.HTTPStatusError("429 Too Many Requests", request=r.request, response=r)
                time.sleep(min(wait, 90))
                continue
            r.raise_for_status()
            return r.json()
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last, timeouts = e, timeouts + 1
            if timeouts >= 2:
                break
    raise last


_cache: dict = {}


def _cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def _num(s):
    try:
        return float(str(s).replace(",", ""))
    except ValueError:
        return None


# ---------- strokes gained (endpoint seen in your sample) ----------
def _live(t_code, year, t_num, rnd):
    return _cached(("live", t_code, year, t_num, rnd), 60, lambda: _get(
        "/LivePlayerStats/1.0.0/", format="json", T_CODE=t_code, YEAR=year, T_NUM=t_num, R_NUM=rnd))


def get_round_strokes_gained(player_id: str, t_num: str, rnd: int = None,
                             year: int = None, t_code: str = "R") -> dict:
    year = year or time.localtime().tm_year
    if not rnd:  # latest round with data for this player
        for r in (4, 3, 2, 1):
            try:
                res = get_round_strokes_gained(player_id, t_num, r, year, t_code)
            except Exception:
                continue
            if "note" not in res:
                return res
        return {"error": "No round data found for this player in this tournament."}
    data = _live(t_code, year, t_num, rnd)
    trn = data["trn"][0]
    by_stat = {s["id"]: {p["id"]: p for p in s["p"]} for s in trn["plrStats"]}
    out = {"tournament_id": trn["T_ID"], "round": trn["rnd"], "player_id": player_id}
    for name, sid in SG_STATS.items():
        p = by_stat.get(sid, {}).get(str(player_id))
        out[name] = None if not p else {
            "round": _num(p["rV1"]), "event_to_date": _num(p["eV1"]),
            "round_rank": _num(p["rR"]), "event_rank": _num(p["eR"])}
    if all(out[k] is None for k in SG_STATS):
        out["note"] = "No SG data for this player in this round (not in field, cut, or not started)."
    return out


_EXTRA_NAMES = {}   # player names that arrive inside stat responses (covers players missing from the master list)


def _pid(x):
    """Player ids come zero-padded in some endpoints ('06567'); normalise to '6567'."""
    s = str(x).strip()
    return str(int(s)) if s.isdigit() else s


def _tnum_candidates(t_num: str):
    return [t_num] + ([str(int(t_num))] if t_num.isdigit() and str(int(t_num)) != t_num else [])


def _live_round(t_num, year, r, t_code):
    """(trn, by_stat, error) from LivePlayerStats: all stats for a round in ONE call (current / recent events)."""
    err = None
    for tn in _tnum_candidates(t_num):
        try:
            trn = _live(t_code, year, tn, r)["trn"][0]
            by_stat = {st["id"]: {_pid(p["id"]): p for p in (st.get("p") or [])}
                       for st in (trn.get("plrStats") or []) if "id" in st}
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            continue
        # rounds that haven't started come back with a row per player but no values: not a round with data
        if any(_num(p.get("rV1")) is not None for p in (by_stat.get(SG_STATS["total"]) or {}).values()):
            return trn, by_stat, None
        err = "the API returned no strokes gained rows"
    return None, None, err


def _synd_stat(t_num, year, r, stat_id, t_code):
    """One stat for one round from SyndPlayerRoundStats -> {player_id: {"rV1": value, "rR": rank}}."""
    data = _get("/SyndPlayerRoundStats/1.0.0/", format="json", T_CODE=t_code, STAT_ID=stat_id,
                YEAR=year, T_NUM=t_num, R_ID=r)
    out = {}
    for tour in data.get("tours", []):
        for yr in tour.get("years", []):
            for st in yr.get("stats", []):
                for rd in st.get("rounds", []):
                    rn = rd.get("round_number")
                    if rn is not None and int(rn) != r:
                        continue
                    for d in rd.get("details", []):
                        sv = (d.get("statValues") or [{}])[0]
                        if _num(sv.get("statValue1")) is None:
                            continue
                        pid = _pid(d.get("plrNum"))
                        out[pid] = {"rV1": sv["statValue1"], "rR": d.get("curRank")}
                        nm = (d.get("plrName") or [{}])[0]
                        full = f'{nm.get("first", "")} {nm.get("last", "")}'.strip()
                        if full:
                            _EXTRA_NAMES[pid] = {"name": full, "country": None}
    return out


def _synd_round(t_num, year, r, t_code):
    """(trn, by_stat, error) from SyndPlayerRoundStats: one call per stat (works for past events)."""
    from concurrent.futures import ThreadPoolExecutor
    err = None
    for tn in _tnum_candidates(t_num):
        def one(sid):
            try:
                return sid, _synd_stat(tn, year, r, sid, t_code), None
            except Exception as e:
                return sid, {}, f"{type(e).__name__}: {e}"
        by_stat, errs = {}, []
        with ThreadPoolExecutor(max_workers=5) as ex:
            for sid, rows, e in ex.map(one, SG_STATS.values()):
                if e:
                    errs.append(e)
                if rows:
                    by_stat[sid] = rows
        if by_stat.get(SG_STATS["total"]):
            return {"T_ID": f"{t_code}{year}{tn}", "rnd": r}, by_stat, None
        err = errs[0] if errs else "the API returned no strokes gained rows"
    return None, None, err


def _round_data(t_num, year, r, t_code="R", source="live"):
    return (_synd_round if source == "synd" else _live_round)(t_num, year, r, t_code)


def _fetch_rounds(t_num, year, rounds, t_code="R", source="live"):
    """Fetch several rounds at once (the API is slow, so don't wait on them one by one)."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=len(rounds)) as ex:
        futs = {r: ex.submit(_round_data, t_num, year, r, t_code, source) for r in rounds}
        return {r: f.result() for r, f in futs.items()}


def _person(names, pid):
    info = names.get(pid) or _EXTRA_NAMES.get(pid) or {}
    return {"player_id": pid, "name": info.get("name", f"Player {pid}"), "country": info.get("country")}


def _round_result(trn, by_stat, names):
    rows = []
    for pid in by_stat[SG_STATS["total"]]:
        row = _person(names, pid)
        for key, sid in SG_STATS.items():
            p = by_stat.get(sid, {}).get(pid)
            row[key] = {"round": _num(p["rV1"]), "round_rank": _num(p["rR"])} if p else None
        rows.append(row)
    return {"tournament_id": trn["T_ID"], "round": trn["rnd"], "mode": "round", "rows": rows}


def _event_result(res, names):
    """TOTAL strokes gained across every round played (sum of the per-round values, not an average)."""
    totals, counts, last = {}, {}, None
    for r in sorted(res):
        trn, by_stat, _ = res[r]
        if not trn:
            continue
        last = r
        for pid in by_stat[SG_STATS["total"]]:
            counts[pid] = counts.get(pid, 0) + 1
            for key, sid in SG_STATS.items():
                p = by_stat.get(sid, {}).get(pid)
                v = _num(p["rV1"]) if p else None
                if v is not None:
                    totals.setdefault(pid, {})
                    totals[pid][key] = totals[pid].get(key, 0.0) + v
    if not totals:
        return None
    ranked = {k: sorted((t[k] for t in totals.values() if k in t), reverse=True) for k in SG_STATS}
    rows = []
    for pid, t in totals.items():
        row = {**_person(names, pid), "rounds": counts.get(pid, 0)}
        for key in SG_STATS:
            v = t.get(key)
            row[key] = None if v is None else {
                "event": round(v, 3), "event_rank": 1 + sum(1 for x in ranked[key] if x > v + 1e-9)}
        rows.append(row)
    return {"round": last, "mode": "event", "rows": rows}


import re


def _parse_val(raw):
    """Turn a displayed stat value into a number for sorting.
    '92.86%' -> 92.86 | "26' 5\"" -> 317.0 (inches) | '1,234' -> 1234.0 | '' -> None"""
    if raw is None:
        return None
    t = str(raw).strip()
    if t == "E":                       # even par
        return 0.0
    if not t or t in ("-", "--", "N/A"):
        return None
    m = re.fullmatch(r"(-?\d+)'\s*(\d+(?:\.\d+)?)\"?", t)
    if m:
        return int(m.group(1)) * 12 + float(m.group(2))
    m = re.fullmatch(r'(-?\d+(?:\.\d+)?)"', t)                       # inches only, e.g. 10"
    if m:
        return float(m.group(1))
    try:
        return float(t.replace(",", "").rstrip("%").strip())
    except ValueError:
        return None


def _fmt_like(sample, v):
    """Format v the way `sample` was displayed (percent, feet-inches, plain number)."""
    if v is None:
        return "-"
    s = str(sample or "")
    if s.endswith("%"):
        return f"{v:.2f}%"
    if re.fullmatch(r"[+-]\d+(\.\d+)?|E", s.strip()):        # to-par style numbers
        if abs(v) < 1e-9:
            return "E"
        return f"{v:+.0f}" if v == int(v) else f"{v:+.2f}"
    if "'" in s or s.endswith('"'):
        ft, inch = divmod(int(round(v)), 12)
        return (f"{ft}' {inch}\"" if ft else f'{inch}"')
    dec = len(s.split(".")[1]) if re.fullmatch(r"-?[\d,]+\.\d+", s.strip()) else 0
    if dec:
        return f"{v:.{dec}f}"          # keep the same number of decimals as the API shows
    return str(int(v)) if v == int(v) else f"{v:.2f}"


def _attempts(made, pct):
    """Attempts = made / percent. None when it can't be worked out (e.g. 0%) or doesn't add up."""
    if made is None or pct is None or pct <= 0:
        return None
    att = round(made * 100.0 / pct)
    if att < 1 or att < made or abs(100.0 * made / att - pct) > 0.06:
        return None
    return att


def _entry_text(e):
    """'89.29% (50/56)' when made and attempts are known, '26\' 5" (12)' when only attempts are."""
    p = str(e.get("p", e.get("d", "")))
    if "k" in e and "n" in e:
        return f"{p} ({e['k']}/{e['n']})"
    if "n" in e:
        return f"{p} ({e['n']})"
    return p


def _counts_entry(raw, rank, made, att):
    """One extra-stat value that can also carry made (k) and attempts (n)."""
    e = {"d": str(raw), "v": _parse_val(raw), "r": rank, "p": str(raw)}
    if made is not None:
        e["k"] = int(made)
    if att is not None:
        e["n"] = int(att)
    e["d"] = _entry_text(e)
    return e


def _ensure_pct(e):
    """Some endpoints return 89.29 and others 89.29%; stats flagged pct always show the % sign."""
    p = str(e.get("p", e.get("d", "")))
    v = _parse_val(p)
    if not p or v is None:
        return
    if e.get("n") and "k" in e:
        v = 100.0 * e["k"] / e["n"]
        e["v"] = round(v, 3)
    p = f"{v:.2f}%"
    if "p" in e:
        e["p"] = p
        e["d"] = _entry_text(e)
    else:
        e["d"] = p


_ATT = re.compile(r"attempt|possible|opportunit|chances|holes|shots|putts|drives|approach", re.I)
_ATT_ONLY = re.compile(r"attempt|shots|# ?of|number of|opportunit|chances|drives|strokes", re.I)
_MADE = re.compile(r"made|hit|save|success|conver|par or better|up.?and.?down|fairways|greens|birdie|number of times", re.I)


def _pick_counts(sv, titles, pct, cols=None):
    """Find (made, attempts) among the extra values: the pair whose ratio equals the percentage.
    The value titles break ties. Returns None unless there is real evidence, so nothing gets invented."""
    vals = {i: _num(sv.get(f"statValue{i}")) for i in range(2, 6)}
    ttl = {i: str(titles.get(f"statTitle{i}") or "") for i in range(2, 6)}
    ok = {i: vals[i] is not None and not re.search(r"round|rtp", ttl[i], re.I) for i in vals}   # rounds and RTP scores are never made/attempts
    ia = next((i for i in vals if re.fullmatch(r"\s*attempts?\s*", ttl[i], re.I)), None)
    inn = next((i for i in vals if re.search(r"non.?attempt", ttl[i], re.I)), None)
    if ia and inn and vals[ia] is not None and vals[inn] is not None and pct is not None:
        tot = vals[ia] + vals[inn]
        if tot and abs(100.0 * vals[ia] / tot - pct) < 0.06:
            return vals[ia], tot
    cands = []
    if pct is not None:
        for i in vals:
            for j in vals:
                if i == j or not ok[i] or not ok[j]:
                    continue
                a, b = vals[i], vals[j]
                if not b or b < a or abs(100.0 * a / b - pct) >= 0.06:
                    continue
                if pct == 0 and not _ATT.search(ttl[j]):
                    continue                       # 0 of anything is 0%: only trust a value titled like attempts
                cands.append((i, j))
    if cands:
        i, j = max(cands, key=lambda c: (bool(_MADE.search(ttl[c[0]])), bool(_ATT.search(ttl[c[1]])), -c[1]))
        if cols is not None and pct:
            cols.append((i, j))                    # a non-zero row proves which two columns are made and attempts
        return vals[i], vals[j]
    if ok[2] and vals[2] is not None and _MADE.search(ttl[2]) and pct:
        att = _attempts(vals[2], pct)               # only a made-count is given: derive the attempts
        if att:
            return vals[2], att
    return None


_RATIO_TITLES = [(re.compile(r"birdie|eagle", re.I), re.compile(r"bogey", re.I))]   # Birdie to Bogey Ratio: birdies (or better) / bogeys (or worse)
_NOT_A_COUNT = re.compile(r"round|rank|low|conversion|avg|ratio", re.I)


def _ratio_tol(val, raw):
    """How far numerator / denominator may be from the shown value: half a unit of the last displayed decimal."""
    s = str(raw if raw is not None else "")
    dec = len(s.split(".")[1]) if "." in s else 3
    return max(0.51 * 10 ** -dec, 0.0006, abs(val or 0) * 0.0006)


def _pick_ratio(sv, titles, val, raw=None):
    """For ratio stats (putts per GIR, birdie to bogey): the pair of values whose quotient is the shown value -> (numerator, denominator).
    Where the titles name the two counts (birdies / bogeys) they are used directly, so a ratio of 0 or an undefined one
    (no bogeys) still gets its counts."""
    vals = {i: _num(sv.get(f"statValue{i}")) for i in range(2, 6)}
    ttl = {i: str(titles.get(f"statTitle{i}") or "") for i in range(2, 6)}
    tol = _ratio_tol(val, raw)
    for num_re, den_re in _RATIO_TITLES:
        ni = next((i for i in vals if vals[i] is not None and num_re.search(ttl[i]) and not _NOT_A_COUNT.search(ttl[i])), None)
        di = next((i for i in vals if i != ni and vals[i] is not None and den_re.search(ttl[i]) and not _NOT_A_COUNT.search(ttl[i])), None)
        if ni is not None and di is not None and vals[ni] >= 0 and vals[di] >= 0:
            if vals[di] and val is not None and abs(vals[ni] / vals[di] - val) > tol:
                continue                                   # the titles don't fit the shown value: don't trust them
            return vals[ni], vals[di]
    if not val:
        return None
    cands = []
    for i in vals:
        for j in vals:
            if i == j or vals[i] is None or not vals[j] or _NOT_A_COUNT.search(ttl[i] + " " + ttl[j]):
                continue
            if abs(vals[i] / vals[j] - val) <= tol:
                cands.append((i, j))
    if not cands:
        return None
    i, j = max(cands, key=lambda c: (bool(re.search(r"greens|holes|bunkers|bogeys|attempt|shots", ttl[c[1]], re.I)), -c[1]))
    return vals[i], vals[j]


def _pick_attempts(sv, titles):
    """For averages (e.g. proximity): the number of shots behind the value, if a value is titled like attempts."""
    for i in range(2, 6):
        t = str(titles.get(f"statTitle{i}") or "")
        n = _num(sv.get(f"statValue{i}"))
        if n is not None and n >= 0 and n == int(n) and _ATT_ONLY.search(t) and not re.search(r"distance|round|feet|inch", t, re.I):
            return int(n)
    return None


def _tn_from(trn, t_code, year):
    """The tournament-number form that actually worked ('006' or '6'), read back from T_ID."""
    tid, pre = str((trn or {}).get("T_ID") or ""), f"{t_code}{year}"
    return tid[len(pre):] if tid.startswith(pre) and len(tid) > len(pre) else None


def stats_signature(extras) -> str:
    """Changes whenever the stat list (or how a stat is collected) changes, so events get refetched."""
    return ",".join(e["id"] + ("+c" if e.get("counts") else "") + ("+r" if e.get("ratio") else "") + ("+L" if e.get("source") == "live" else "")
                    + ("+p" if e.get("pct") else "") + ("+z" if e.get("missing_means_zero") else "")
                    + (f"+x{e['complement']}" if e.get("complement") else "")
                    for e in (extras or []))


_COUNT_COLS = {}      # (stat id, value titles) -> (made column, attempts column), learned from rows whose percentage is above 0


def _zero_counts(sv, cols):
    """0% row: made is 0 and the attempts sit in the column that held the attempts for every other player."""
    i, j = cols
    a, b = _num(sv.get(f"statValue{i}")), _num(sv.get(f"statValue{j}"))
    if a == 0 and b is not None and b >= 1 and float(b).is_integer():
        return 0.0, b
    return None


def _synd_extra(t_num, year, r, stat_id, t_code="R", counts=False, att_only=False, ratio=False):
    """One extra stat for one round -> (meta, {player_id: {"d": shown text, "v": number, "r": rank}})."""
    data = _get("/SyndPlayerRoundStats/1.0.0/", format="json", T_CODE=t_code, STAT_ID=stat_id,
                YEAR=year, T_NUM=t_num, R_ID=r)
    meta, rows, votes, zero_rows, titles = {}, {}, [], [], {}
    for tour in data.get("tours", []):
        for yr in tour.get("years", []):
            for st in yr.get("stats", []):
                meta = {"name": st.get("statName"), "tip": (st.get("explanation") or "")[:300]}
                titles = (st.get("statTitles") or [{}])[0] or {}
                for rd in st.get("rounds", []):
                    rn = rd.get("round_number")
                    if rn is not None and int(rn) != r:
                        continue
                    for d in rd.get("details", []):
                        sv = (d.get("statValues") or [{}])[0]
                        raw = sv.get("statValue1")
                        if raw in (None, ""):
                            if ratio and _pick_ratio(sv, titles, None):
                                raw = "N/A"                    # no bogeys: no ratio, but the birdies still count toward the event
                            else:
                                continue
                        if counts:
                            pick = _pick_counts(sv, titles, _parse_val(raw), votes)
                            made, att = pick if pick else (None, None)
                            rows[_pid(d.get("plrNum"))] = _counts_entry(raw, _num(d.get("curRank")), made, att)
                            if pick is None and _parse_val(raw) == 0:
                                zero_rows.append((_pid(d.get("plrNum")), sv, raw, _num(d.get("curRank"))))
                            continue
                        if ratio:
                            pr = _pick_ratio(sv, titles, _parse_val(raw), raw)
                            rows[_pid(d.get("plrNum"))] = _counts_entry(raw, _num(d.get("curRank")), pr[0] if pr else None, pr[1] if pr else None)
                            continue
                        if att_only:
                            rows[_pid(d.get("plrNum"))] = _counts_entry(raw, _num(d.get("curRank")), None, _pick_attempts(sv, titles))
                            continue
                        rows[_pid(d.get("plrNum"))] = {"d": str(raw), "v": _parse_val(raw), "r": _num(d.get("curRank"))}
    if counts:
        key = (stat_id, tuple(str(titles.get(f"statTitle{i}") or "") for i in range(1, 6)))
        if votes:
            top, n = max(((c, votes.count(c)) for c in set(votes)), key=lambda x: x[1])
            if n >= 3 and n / len(votes) >= 0.9:
                _COUNT_COLS[key] = top
        if zero_rows and key in _COUNT_COLS:
            for pid, sv, raw, rank in zero_rows:
                pick = _zero_counts(sv, _COUNT_COLS[key])
                if pick:
                    rows[pid] = _counts_entry(raw, rank, *pick)
    return meta, rows


LIVE_COUNTS_OK = {"102", "103", "111", "130"}     # live rV2 verified to be the made count for these


def _extras_from_live(by_stat, ids, counts_ids=(), prefix="r"):
    """Pull extra stats out of a LivePlayerStats round (one call already contains most stats).
    For counts stats rV2 is the made count; attempts are derived from it and the percent."""
    v1, v2, rk = f"{prefix}V1", f"{prefix}V2", f"{prefix}R"      # prefix "e" = event-to-date columns
    out = {}
    for sid in ids:
        rows = {}
        for pid, p in (by_stat.get(sid) or {}).items():
            raw = p.get(v1)
            if raw in (None, ""):
                continue
            if sid in counts_ids and sid in LIVE_COUNTS_OK:
                made = _num(p.get(v2))
                rows[pid] = _counts_entry(raw, _num(p.get(rk)), made, _attempts(made, _parse_val(raw)))
                continue
            rows[pid] = _counts_entry(raw, _num(p.get(rk)), None, None) if sid in counts_ids else {"d": str(raw), "v": _parse_val(raw), "r": _num(p.get(rk))}
        if rows:
            out[sid] = rows
    return out


def _same_value(a, b):
    """Same stat value from two endpoints (they can round a percent differently, e.g. 35.7 vs 35.71)."""
    if a is None or b is None:
        return a == b
    return abs(a - b) < 0.06


# Ratio stats whose two counts exist as other stats. A player left out of the ratio stat (no bogeys, so the ratio is undefined) still has
# those counts, so the missing round can be completed from them. Used only after the round's own data proves the identity.
_RATIO_PARTS = {"02415": {"num": ("106", "107"), "den": "02414"}}      # birdies and better = eagles + birdies; bogeys and worse = Bogey Avoidance's count


def _fill_ratio_parts(by_round, players):
    for r, st_r in by_round.items():
        for sid, parts in _RATIO_PARTS.items():
            rows = st_r.get(sid)
            num_src = [st_r.get(x) or {} for x in parts["num"]]
            den_src = st_r.get(parts["den"]) or {}
            if rows is None or not den_src or not all(num_src):
                continue

            def numer(pid):
                vs = [s.get(pid, {}).get("v") for s in num_src]
                return None if any(v is None for v in vs) else int(round(sum(vs)))

            def denom(pid):
                k = den_src.get(pid, {}).get("k")
                return None if k is None else int(k)
            tested = ok_n = ok_d = 0
            for pid, e in rows.items():
                if "k" not in e or "n" not in e or numer(pid) is None or denom(pid) is None:
                    continue
                tested += 1
                ok_n += numer(pid) == e["k"]
                ok_d += denom(pid) == e["n"]
            if tested < 5 or ok_n / tested < 0.9 or ok_d / tested < 0.9:
                continue                                           # identity not proven in this round: leave it alone
            for pid in players.get(r, ()):
                e = rows.get(pid)
                if e is not None and "k" in e and "n" in e:
                    continue
                k, n = numer(pid), denom(pid)
                if k is None or n is None:
                    continue
                if e is None:
                    rows[pid] = _counts_entry("N/A" if n == 0 else f"{k / n:.3f}", None, k, n)
                else:
                    v = e.get("v")
                    if v is not None and n and abs(k / n - v) > _ratio_tol(v, e.get("p")):
                        continue
                    e["k"], e["n"] = int(k), int(n)
                    e["d"] = _entry_text(e)


# Complement pairs come from stats.json ("complement": "<other id>"). Left and Right Tendency are shares of the same missed fairways:
# both use the same attempts and left + right = attempts. The API leaves a player out of a stat when his count is 0, so a missing row
# means 0 made out of the other stat's attempts. Applied to a round only when its own data proves the identity.
def complement_pairs(extras):
    return sorted({tuple(sorted((e["id"], e["complement"]))) for e in (extras or []) if e.get("complement")})


def _has_counts(e):
    return e is not None and "k" in e and "n" in e


def _fill_complements(by_round, players, pairs):
    for r, st_r in by_round.items():
        for a, b in pairs:
            A, B = st_r.get(a), st_r.get(b)
            if A is None or B is None:
                continue
            tested = ok = 0
            for pid, ea in A.items():
                eb = B.get(pid)
                if _has_counts(ea) and _has_counts(eb):
                    tested += 1
                    ok += ea["n"] == eb["n"] and ea["k"] + eb["k"] == ea["n"]
            if tested < 5 or ok / tested < 0.9:
                continue                                           # identity not proven in this round: leave it alone
            for pid in players.get(r, ()):
                ea, eb = A.get(pid), B.get(pid)
                ca, cb = _has_counts(ea), _has_counts(eb)
                if ca and cb:
                    continue
                if ca != cb:                                       # one side known: the other is the rest of the same attempts
                    src = ea if ca else eb
                    n, k = src["n"], src["n"] - src["k"]
                    rows, tgt = (B, eb) if ca else (A, ea)
                    if tgt is None:
                        rows[pid] = _counts_entry(f"{100.0 * k / n:.1f}" if n else "0.0", None, k, n)
                    else:
                        v = tgt.get("v")
                        if v is not None and n and abs(100.0 * k / n - v) > 0.06:
                            continue
                        tgt["k"], tgt["n"] = int(k), int(n)
                        tgt["d"] = _entry_text(tgt)
                elif ea is None and eb is None:                    # no left and no right: no missed fairways, so nothing to count
                    for rows in (A, B):
                        rows[pid] = {"d": "–", "v": None, "r": None, "p": "–", "k": 0, "n": 0}


def _fetch_extras(t_num, year, jobs, t_code="R", counts_ids=(), tn=None, att_ids=(), ratio_ids=()):
    """jobs = [(round, stat_id)] to fetch from SyndPlayerRoundStats
    -> (meta per stat id, {round: {stat id: rows}}, hit_a_temporary_error)"""
    from concurrent.futures import ThreadPoolExecutor

    def one(job):
        r, sid = job
        err = None
        for tn_try in ([tn] if tn else _tnum_candidates(t_num)):
            try:
                meta, rows = _synd_extra(tn_try, year, r, sid, t_code, counts=sid in counts_ids, att_only=sid in att_ids, ratio=sid in ratio_ids)
                if rows:
                    return job, meta, rows, None
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
        return job, {}, {}, err

    metas, by_round, transient = {}, {}, False
    with ThreadPoolExecutor(max_workers=8) as ex:
        for (r, sid), meta, rows, err in ex.map(one, jobs):
            if rows:
                by_round.setdefault(r, {})[sid] = rows
                if not metas.get(sid, {}).get("name"):
                    metas[sid] = meta
            elif err and _is_transient(err):
                transient = True
    return metas, by_round, transient


def _collect_extras(t_num, year, got, src_of, extras, t_code, probe_live):
    """Gather every extra stat for every round we have, from the cheapest source:
    1) rounds fetched from LivePlayerStats already contain them (no extra calls),
    2) stats only Live has (source "live") are probed from Live for rounds that came from elsewhere (best effort),
    3) the rest come from SyndPlayerRoundStats."""
    by_round, metas, transient, probe, event_live = {}, {}, False, None, {}
    counts_ids = {e["id"] for e in extras if e.get("counts") and e.get("pct")}        # made / attempts
    ratio_ids = {e["id"] for e in extras if e.get("counts") and e.get("ratio")}       # numerator / denominator
    att_ids = {e["id"] for e in extras if e.get("counts") and not e.get("pct") and not e.get("ratio")}   # attempts only
    plain_ids = counts_ids | att_ids | ratio_ids
    ids = [e["id"] for e in extras]
    live_only = [e["id"] for e in extras if e.get("source") == "live"]
    for r, src in src_of.items():
        if src == "live":
            ex = _extras_from_live(got[r][1], ids, plain_ids)
            if ex:
                by_round.setdefault(r, {}).update(ex)
    live_rs = sorted(r for r, src in src_of.items() if src == "live")
    if live_rs:   # the live feed also carries event-to-date totals: use them when per-round data is incomplete
        event_live = _extras_from_live(got[live_rs[-1]][1], ids, plain_ids, prefix="e")
    if live_only and probe_live:
        todo = [r for r, src in src_of.items() if src != "live"]
        if todo:
            res = _fetch_rounds(t_num, year, todo, t_code, "live")
            ok = False
            for r in todo:
                trn, bs, _ = res[r]
                if trn:
                    ex = _extras_from_live(bs, live_only, plain_ids)
                    if ex:
                        by_round.setdefault(r, {}).update(ex)
                        ok = True
                        if not event_live:
                            event_live = _extras_from_live(bs, ids, plain_ids, prefix="e")
            probe = "ok" if ok else "none"
    jobs = [(r, e["id"]) for r in got for e in extras
            if e.get("source") != "live" and e["id"] not in by_round.get(r, {})]
    if jobs:
        tn_known = next((x for x in (_tn_from(got[r][0], t_code, year) for r in sorted(got)) if x), None)
        m, br, transient = _fetch_extras(t_num, year, jobs, t_code, counts_ids, tn_known, att_ids, ratio_ids)
        metas.update(m)
        for r, d in br.items():
            by_round.setdefault(r, {}).update(d)
    # Live can't show attempts when a percentage is 0%; the other endpoint often can, so borrow them from there
    gaps = [(r, sid) for r, st_r in by_round.items() if src_of.get(r) == "live"
            for sid in plain_ids if any("n" not in e for e in (st_r.get(sid) or {}).values())]
    if gaps:
        _, br, _ = _fetch_extras(t_num, year, gaps, t_code, counts_ids, next((x for x in (_tn_from(got[r][0], t_code, year) for r in sorted(got)) if x), None), att_ids, ratio_ids)
        for r, d in br.items():
            for sid, rows in d.items():
                for pid, e in by_round[r][sid].items():
                    o = rows.get(pid)
                    if "n" not in e and o and "n" in o and _same_value(o.get("v"), e.get("v")):
                        if "k" in o:
                            e["k"] = o["k"]
                        e["n"] = o["n"]
                        e["d"] = _entry_text(e)
    # Scrambling at 0% hides its attempts: they equal the greens missed (GIR attempts - GIR made)
    for r, stats_r in by_round.items():
        scr, gir = stats_r.get("130") or {}, stats_r.get("103") or {}
        for pid, e in scr.items():
            g = gir.get(pid)
            if e.get("k") == 0 and "n" not in e and g and g.get("n") and g.get("k") is not None and g["n"] - g["k"] >= 1:
                e["n"] = g["n"] - g["k"]
                e["d"] = _entry_text(e)
    _players = {r: set(got[r][1].get(SG_STATS["total"]) or {}) for r in got}
    _fill_complements(by_round, _players, complement_pairs(extras))
    _fill_ratio_parts(by_round, _players)
    pct_ids = {e["id"] for e in extras if e.get("pct")}
    for d in list(by_round.values()) + [event_live]:
        for sid in pct_ids:
            for e in (d.get(sid) or {}).values():
                _ensure_pct(e)
    for sid in {sid for d in by_round.values() for sid in d}:
        metas.setdefault(sid, {"name": None, "tip": ""})
    return by_round, metas, transient, probe, event_live


# Stats flagged "missing_means_zero" in stats.json are the ones where the API leaves out a player's row when the count is 0
# (so a missing round means 0 made, attempts unknown). Everywhere else a missing row means no attempts at all
# (e.g. no bunker shots), which adds nothing to the event total.


def _event_counts(by_round, sid, pid, played, ev):
    """Event total for a made/attempts percentage stat, or None when it can't be proven, or "average" for stats that carry no counts.
    A round where the player is missing from the stat (0 made, e.g. Left/Right Tendency) or shows 0% without attempts has an
    unknown number of attempts. The made total is still exact, so the attempts come from the event-to-date percentage in the
    live feed (ev) and are kept only if made / attempts reproduces that percentage."""
    if not any("n" in e for r in by_round for e in (by_round[r].get(sid) or {}).values()):
        return "average"
    K = N = 0
    unknown = False
    for r in played:
        e = (by_round.get(r, {}).get(sid) or {}).get(pid)
        if e is not None and "k" in e and "n" in e:
            K, N = K + e["k"], N + e["n"]
        elif e is None or (e.get("v") == 0 and "n" not in e):
            unknown = True                                   # 0 made, attempts not given
        else:
            return None                                      # a non-zero value without counts: don't guess
    if not unknown:
        return {"v": round(100.0 * K / N, 3), "d": f"{100.0 * K / N:.2f}% ({K}/{N})"} if N else None
    v_ev = (ev or {}).get("v")
    if v_ev is None:
        return None
    if K == 0:
        return {"v": 0.0, "d": "0.00%"} if v_ev == 0 else None
    if v_ev <= 0:
        return None
    n = round(K * 100.0 / v_ev)
    if n < max(N, K) or abs(100.0 * K / n - v_ev) > 0.06:
        return None
    return {"v": round(100.0 * K / n, 3), "d": f"{100.0 * K / n:.2f}% ({K}/{n})"}


def _attach_extras(rounds, event, by_round, extras, metas, event_live=None):
    """Add per-player extra stats (row["x"]) to every round, plus an aggregate for the Event view."""
    cfg = {e["id"]: e for e in extras}
    stats = [{"id": e["id"], "label": e.get("label") or metas[e["id"]].get("name") or e["id"],
              "agg": e.get("agg", "avg"), "group": e.get("group", ""),
              "lower": bool(e.get("lower")), "default": e.get("default", True) is not False,
              "pct": bool(e.get("pct")), "counts": bool(e.get("counts")), "ratio": bool(e.get("ratio")),
              "rank": e.get("rank", True) is not False,
              "tip": metas[e["id"]].get("tip") or e.get("tip", "")}
             for e in extras if e["id"] in metas]
    for r_str, res in rounds.items():
        xs = by_round.get(int(r_str), {})
        for row in res["rows"]:
            x = {sid: xs[sid][row["player_id"]] for sid in xs if row["player_id"] in xs[sid]}
            if x:
                row["x"] = x
    if event:
        # an event total is only meaningful if the stat exists for every round we have
        complete = {m["id"]: all(m["id"] in by_round.get(int(r), {}) for r in rounds) for m in stats}
        in_round = {int(r): {x["player_id"] for x in res["rows"]} for r, res in rounds.items()}
        for row in event["rows"]:
            played = [r for r in sorted(in_round) if row["player_id"] in in_round[r]]
            x, partial = {}, set()
            for sid in (m["id"] for m in stats):
                if not complete[sid]:
                    o = (event_live or {}).get(sid, {}).get(row["player_id"])   # live feed's event-to-date value
                    if o and o.get("v") is not None:
                        x[sid] = {"v": o["v"], "d": o["d"]}
                        continue
                    c = cfg[sid]
                    if c.get("ratio") or c.get("missing_means_zero") or (c.get("counts") and c.get("pct") and not c.get("agg") == "sum"):
                        continue                                # percentages and ratios need every round to be right
                    partial.add(sid)                            # averages and sums: use the rounds that have data and flag the value
                if cfg[sid].get("missing_means_zero") and cfg[sid].get("counts") and cfg[sid].get("pct"):
                    res = _event_counts(by_round, sid, row["player_id"], played, (event_live or {}).get(sid, {}).get(row["player_id"]))
                    if res != "average":
                        if res:
                            x[sid] = res
                        continue                              # unknown: show nothing rather than a wrong number
                vals = [(by_round[r][sid][row["player_id"]]) for r in sorted(by_round)
                        if sid in by_round[r] and row["player_id"] in by_round[r][sid]]
                if cfg[sid].get("ratio") and len(vals) < len(played):
                    o = (event_live or {}).get(sid, {}).get(row["player_id"])      # a played round has no entry: its counts are unknown
                    if o and o.get("v") is not None:                              # so show the Tour's own event ratio, without counts
                        x[sid] = {"v": o["v"], "d": o["d"]}
                    continue
                nums = [v["v"] for v in vals if v["v"] is not None]
                if not nums:
                    continue
                if cfg[sid].get("counts") and cfg[sid].get("pct") and vals and all("k" in v and "n" in v for v in vals):
                    K, N = sum(v["k"] for v in vals), sum(v["n"] for v in vals)
                    pct = 100.0 * K / N
                    x[sid] = {"v": round(pct, 3), "d": f"{pct:.2f}% ({K}/{N})"}
                    continue
                if cfg[sid].get("ratio") and vals and all("k" in v and "n" in v for v in vals):
                    K, N = sum(v["k"] for v in vals), sum(v["n"] for v in vals)
                    dec = next((len(str(v.get("p", "")).split(".")[1]) for v in vals if "." in str(v.get("p", ""))), 0)
                    if N:
                        x[sid] = {"v": round(K / N, 3), "d": f"{K / N:.{dec}f} ({K}/{N})"}
                    continue                                   # N == 0: no bogeys all event, no ratio to show
                if cfg[sid].get("counts") and not cfg[sid].get("pct") and not cfg[sid].get("ratio") and all("n" in v and v["v"] is not None for v in vals):
                    N = sum(v["n"] for v in vals)                          # attempts-only stats: weight each round by its shots
                    if N:
                        agg = sum(v["v"] * v["n"] for v in vals) / N
                        x[sid] = {"v": round(agg, 3), "d": f"{_fmt_like(vals[0].get('p', vals[0]['d']), agg)} ({N})"}
                        continue
                agg = sum(nums) if cfg[sid].get("agg") == "sum" else sum(nums) / len(nums)
                x[sid] = {"v": round(agg, 3), "d": _fmt_like(vals[0].get("p", vals[0]["d"]), agg)}
            for sid in partial:
                if sid in x:
                    x[sid]["part"] = [r for r in sorted(by_round) if sid in by_round[r] and row["player_id"] in by_round[r][sid]]
            if x:
                row["x"] = x
    return stats


_TRANSIENT = ("429", "Timeout", "ConnectError", "Server error", "RemoteProtocol", "ReadError", "ConnectTimeout")


def _is_transient(err) -> bool:
    return any(t in str(err) for t in _TRANSIENT)


def build_event_bundle(t_num: str, year: int, t_code: str = "R", prefer: str = "live", extras=None,
                       probe_live: bool = False) -> dict:
    """Everything the website needs for one tournament, in one JSON-able dict.
    Each round comes from the preferred source (prefer="live" for current events, "synd" for past ones);
    any round that source can't supply is filled in from the other one.
    "partial" = some round was missing because of a temporary API problem (rate limit / timeout)."""
    from datetime import datetime, timezone
    names = {p["player_id"]: p for p in load_players()}
    order = ["live", "synd"] if prefer == "live" else ["synd", "live"]
    got, errs, used, missing, src_of = {}, [], [], [1, 2, 3, 4], {}
    errs_by_round = {r: [] for r in (1, 2, 3, 4)}
    for src in order:
        if not missing:
            break
        res = _fetch_rounds(t_num, year, missing, t_code, src)
        for r in list(missing):
            if res[r][0]:
                got[r], src_of[r] = res[r], src
                if src not in used:
                    used.append(src)
            elif res[r][2]:
                errs.append(f"{src}: {res[r][2]}")
                errs_by_round[r].append(res[r][2])
        missing = [r for r in missing if r not in got]
    rounds = {str(r): _round_result(got[r][0], got[r][1], names) for r in sorted(got)}
    event = _event_result(got, names) if got else None
    partial = any(_is_transient(e) for r in missing for e in errs_by_round[r])
    extras = extras or []
    stats, probe = [], None
    if extras and got:
        by_round, metas, extras_transient, probe, event_live = _collect_extras(t_num, year, got, src_of, extras, t_code, probe_live)
        stats = _attach_extras(rounds, event, by_round, extras, metas, event_live)
        partial = partial or extras_transient
        if prefer == "live" and any(e.get("source") == "live" for e in extras):
            # a round that fell back to the other endpoint because Live had a temporary problem: retry it next run
            partial = partial or any(src_of[r] != "live" and any(_is_transient(x) for x in errs_by_round[r]) for r in got)
    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "t_num": t_num, "year": year, "source": "+".join(used) or None,
        "latest_round": max(got) if got else None,
        "rounds": rounds,
        "event": event,
        "stats": stats, "stats_sig": stats_signature(extras), "live_probe": probe,
        "partial": partial,
        "error": None if got else ("; ".join(dict.fromkeys(errs))[:300] or "the API returned no strokes gained rows"),
    }


# ---------- lookups ----------
import json, unicodedata
from datetime import date, datetime


def today() -> date:
    """date.today(), or PGA_TODAY=YYYY-MM-DD so a recorded snapshot can be replayed on its original day."""
    v = os.getenv("PGA_TODAY")
    return date.fromisoformat(v) if v else date.today()


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower().replace(".", "").replace("-", " ").strip()


def load_players() -> list:
    """SyndPlayersMaster returns a list of {p_id, first_name, last_name, shortname, country}.
    PGA Tour (R) and Korn Ferry (H) lists are merged; R wins if a player is in both. A failure on H never blocks R."""
    out, seen = [], set()
    for code in ("R", "H"):
        try:
            data = _cached(("players", code), 86400, lambda c=code: _get("/SyndPlayersMaster/1.0.0/", format="json", T_CODE=c))
        except Exception:
            if code == "R":
                raise
            continue
        for p in data:
            pid = str(p["p_id"])
            if pid in seen or "do not use" in (p.get("last_name") or "").lower():
                continue
            seen.add(pid)
            out.append({"player_id": pid, "name": f'{p["first_name"]} {p["last_name"]}'.strip(),
                        "country": p.get("country")})
    return out


def find_player(name: str) -> dict:
    players = load_players()
    q = _norm(name).split()
    if not q:
        return {"error": "Empty name"}
    # every query word must prefix-match some word of the name ("scottie", "scheffler", "j j spaun")
    hits = [p for p in players if all(any(w.startswith(t) for w in _norm(p["name"]).split()) for t in q)]
    if not hits:
        close = difflib.get_close_matches(_norm(name), [_norm(p["name"]) for p in players], n=3, cutoff=0.7)
        hits = [p for p in players if _norm(p["name"]) in close]
    if not hits:
        return {"error": f"No player matched '{name}'"}
    exact = [p for p in hits if _norm(p["name"]) == _norm(name)]
    hits = exact or hits
    res = {"matches": hits[:6]}
    if len(hits) > 1:
        res["note"] = "Multiple players match; ask the user which one (country is included)."
    return res


# Field names in SyndSchedule aren't known yet, so these are tried in order. Run `python pga.py schedule`
# to print the real field names and trim the lists.
_NUM_KEYS = ["permNum", "T_NUM", "t_num", "tournament_num", "tourn_num", "trn_num", "number", "id"]
_NAME_KEYS = ["Tournament_Name", "name", "tournament_name", "trn_name", "t_name", "tournament", "title"]
_START_KEYS = ["start_date", "startDate", "date_start", "start", "begin_date"]
_END_KEYS = ["end_date", "endDate", "date_end", "end", "finish_date"]


def _tnum(t: dict):
    """T_NUM is the last 3 digits of T_ID (R2026006 -> '006'); fall back to other number fields."""
    tid = str(t.get("T_ID") or "")
    if len(tid) >= 3 and tid[-3:].isdigit():
        return tid[-3:]
    v = _first(t, _NUM_KEYS)
    return None if v is None else str(v).zfill(3)


def _first(d: dict, keys):
    for k in keys:
        if d.get(k) not in (None, ""):
            return d[k]
    return None


def _to_date(v):
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y%m%d", "%b %d, %Y"):
        try:
            return datetime.strptime(str(v)[:19] if "T" in str(v) else str(v), fmt).date()
        except ValueError:
            pass
    return None


def get_schedule(year: int = None, t_code: str = "R") -> list:
    year = year or today().year
    data = _cached(("sched", year, t_code), 3600, lambda: _get(
        "/SyndSchedule/1.0.0/", format="json", T_CODE=t_code, YEAR=year))
    if isinstance(data, dict):  # unwrap {"schedule":[...]} style responses
        data = next((v for v in data.values() if isinstance(v, list)), [data])
    return data


def find_tournament(name: str = "current", year: int = None, t_code: str = "R") -> dict:
    year = year or today().year
    sched = get_schedule(year, t_code)
    rows = [{"t_num": _tnum(t), "name": _first(t, _NAME_KEYS) or "",
             "start": _to_date(_first(t, _START_KEYS)), "end": _to_date(_first(t, _END_KEYS))}
            for t in sched if _tnum(t) is not None]
    if not rows:
        return {"error": "Couldn't read tournament numbers from schedule; run `python pga.py schedule`",
                "sample_keys": list(sched[0].keys()) if sched else []}
    ser = lambda r: {"t_num": r["t_num"], "name": r["name"], "year": year,
                     "start": str(r["start"]) if r["start"] else None}
    if name.lower() in ("current", "this week", "now", ""):
        now = today()
        live = [r for r in rows if r["start"] and r["end"] and r["start"] <= now <= r["end"]]
        if live:
            return ser(live[0])
        past = sorted([r for r in rows if r["start"] and r["start"] <= now], key=lambda r: r["start"])
        if past:
            return {**ser(past[-1]), "note": "No event in progress; this is the most recent one."}
        return {"error": "Couldn't determine the current tournament"}
    q = _norm(name).split()
    hits = [r for r in rows if all(t in _norm(r["name"]) for t in q)]
    if not hits:
        close = difflib.get_close_matches(_norm(name), [_norm(r["name"]) for r in rows], n=3, cutoff=0.5)
        hits = [r for r in rows if _norm(r["name"]) in close]
    if not hits:
        return {"error": f"No tournament matched '{name}' in {year}"}
    return {"matches": [ser(r) for r in hits[:5]]}


def list_tournaments(year: int = None, t_code: str = "R") -> dict:
    """Schedule rows (started events only, newest first), plus which one is current."""
    year = year or today().year
    rows = []
    for t in get_schedule(year, t_code):
        num = _tnum(t)
        if num is None:
            continue
        st, en = _to_date(_first(t, _START_KEYS)), _to_date(_first(t, _END_KEYS))
        rows.append({"t_num": num, "name": _first(t, _NAME_KEYS) or f"Event {num}", "year": year,
                     "start": str(st) if st else None, "end": str(en) if en else None})
    cutoff = str(today())
    rows = [r for r in rows if not r["start"] or r["start"] <= cutoff]   # hide future events (no data yet)
    rows.sort(key=lambda r: r["start"] or r["end"] or "9999", reverse=True)   # newest first (no dates = treated as newest, so it is visible)
    cur = find_tournament("current", year, t_code)
    return {"current": cur.get("t_num"), "items": rows}


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["events"]:     # python generator/pga.py events  -> what the schedule says for each tour
        for code in ("R", "H"):
            print(f"--- {code} ---")
            for r in list_tournaments(today().year, code)["items"][:5]:
                print(r["t_num"], r["name"], r["start"], r["end"])
        raise SystemExit
    if sys.argv[1:] == ["schedule"]:
        s = get_schedule()
        print(f"{len(s)} events; keys of first:", list(s[0].keys()))
        print(json.dumps({k: v for k, v in s[0].items() if k != "courses"}, indent=1, default=str)[:1500])
