"""
course_upload.py - send a course's shot-level data to the Strategy Maps straight from Python (update 481).

    from course_upload import upload_course
    upload_course(cluster_data, course=4)            # courseNum 4 (or a name: course="Torrey Pines South")

It does on your computer exactly what Upload Data > Strategy Maps > Scoring does in the browser (js/courseShots.js):
it groups the shots into zones, works out each hole and pin's history (scoring average, birdies, pars ...), and
gathers every player's own shots (their past-shot trails). Then it saves them to the portal's database the same way, so
the site shows them the next time someone opens that course. The course's hole images stay as they are.

Each upload REPLACES that course's maps, history and trails, so send every year you want on the map for that course
(e.g. 2023-2026 with this week's rounds added), not only this week's rounds. Other courses aren't touched.

Setup: the same as tour_upload.py (pip install firebase-admin pandas pyarrow, and the service account key in your
home folder as touranalytics-key.json, or TOUR_ANALYTICS_KEY / key_path=). Keep this file next to tour_upload.py.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import os
import re
import time

from tour_upload import _connect, _writer, client_key

CH = 900000  # characters a stored piece, as js/courseHeat.js CH
LIES = ["tee", "fairway", "rough", "bunker", "green", "water", "other"]

# the column names the site accepts for each field (as js/courseShots.js COLS)
_COLS = {"year": ["year", "season"], "courseNum": ["coursenum", "coursenumber", "courseid"], "course": ["course", "coursename"],
         "player": ["player", "playername", "name"], "playerID": ["playerid", "player_id", "pid"], "round": ["round", "rnd", "roundno"],
         "hole": ["hole"], "par": ["par", "holepar"], "pin": ["pinid", "pin", "pinlocation"], "lie": ["lie", "fromlocation"],
         "strokes": ["strokes", "stroke", "shotnum", "shotnumber"], "shotFor": ["shotfor"], "holeOut": ["holeout"], "x": ["x"], "y": ["y"],
         "v": ["scoringavg", "strokestoholeout"], "pinX": ["pinx"], "pinY": ["piny"], "dist": ["distance", "dist"]}


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s if s is not None else "").lower())


def _columns(header):
    h = [_norm(c) for c in header]
    ix = {}
    for k, names in _COLS.items():
        for n in names:
            if _norm(n) in h:
                ix[k] = h.index(_norm(n))
                break
    return ix


# ------------------------------------------- values, as JavaScript sees them -------------------------------------------

def _num(v):
    """As the site's num(): a number, or None for missing / blank / not a number."""
    if v is None or isinstance(v, bool):
        return None if v is None else float(v)
    if isinstance(v, str):
        if not v.strip():
            return None
        try:
            x = float(v)
        except ValueError:
            return None
    else:
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
    return x if math.isfinite(x) else None


def _jsn(x):
    """A number as JavaScript writes it: 5.0 -> 5."""
    if isinstance(x, float) and x.is_integer() and abs(x) < 2 ** 53:
        return int(x)
    return x


def _jstr(v):
    """String(v) as JavaScript writes it."""
    if v is None:
        return ""
    x = _num(v) if not isinstance(v, str) else None
    if x is not None:
        return str(_jsn(x))
    return str(v)


def _idtext(v):
    """String(num(v) ?? v): a number written plainly (46046.0 -> "46046"), else the text."""
    x = _num(v)
    return str(_jsn(x)) if x is not None else _jstr(v)


def _round(x):
    """Math.round (halves go up, unlike Python's round)."""
    return math.floor(x + 0.5)


def _r1(x):
    return _jsn(_round(x * 10) / 10)


def _missing(v):
    return v is None or (isinstance(v, float) and v != v) or (isinstance(v, str) and v == "") or str(v) in ("<NA>", "NaT")


def _lie_of(s):
    """As js/courseHeat.js lieOf."""
    t = str(s if s is not None and not _missing(s) else "").lower()
    if re.search("green", t) and not re.search("fringe", t):
        return "green"
    if "tee" in t:
        return "tee"
    if re.search("bunker|sand", t):
        return "bunker"
    if re.search("fringe|fairway|fwy", t):
        return "fairway"
    if re.search("rough|other|native|primary|intermediate", t):
        return "rough"
    if re.search("water|drop", t):
        return "water"
    return t


def _lie_ix(s):
    L = _lie_of(s)
    return LIES.index(L) if L in LIES else 6


def heat_id(name):
    """As js/courseHeat.js heatId."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(name or "course").lower()))[:120] or "course"


_STOP = {"golf", "club", "course", "links", "gl", "gc", "cc", "country", "the", "and", "resort", "g", "c"}


def _course_key(name):
    t = re.sub(r"[^a-z0-9 ]+", " ", str(name or "").lower().replace("&", " "))
    return " ".join(w for w in t.split() if w and w not in _STOP)


def same_course(a, b):
    """As js/sg.js sameCourse."""
    x, y = _course_key(a), _course_key(b)
    if not x or not y:
        return False
    return x == y or (min(len(x), len(y)) >= 5 and (x in y or y in x))


# ------------------------------------------------ the boiling down ------------------------------------------------

def aggregate(columns, rows):
    """The shots boiled down per course, exactly as js/courseShots.js shotAggregator (add, then finish).
    Returns [{ name, courseNum, years, data, players: {key: {name, trails}} }]."""
    ix = _columns(columns)
    need = [k for k in ["course", "hole", "x", "y", "strokes", "holeOut"] if k not in ix]
    if need:
        names = {"holeOut": "hole_out"}
        raise ValueError(f"The shot data is missing {', '.join(names.get(k, k) for k in need)}. Columns: {', '.join(map(str, columns))}")
    g = lambda r, k: r[ix[k]] if k in ix else None  # noqa: E731
    courses = {}
    for r in rows:
        cname = g(r, "course")
        name = "" if _missing(cname) else str(cname).strip()
        hole, x, y = _num(g(r, "hole")), _num(g(r, "x")), _num(g(r, "y"))
        if not name or not hole or x is None or y is None:
            continue
        hole = _jsn(hole)
        cnv = g(r, "courseNum")
        cn = None if "courseNum" not in ix or _missing(cnv) else _idtext(cnv)
        C = courses.get(name)
        if C is None:
            C = courses[name] = {"name": name, "courseNum": cn, "holes": {}, "players": {}, "years": set()}
        if cn and not C["courseNum"]:
            C["courseNum"] = cn
        yv = g(r, "year")
        year = "" if "year" not in ix or _missing(yv) else _idtext(yv)
        if year:
            C["years"].add(year)
        H = C["holes"].get(hole)
        if H is None:
            H = C["holes"][hole] = {"par": None, "pins": {}, "tee": []}
        par = _num(g(r, "par"))
        par = _jsn(par) if par else None
        if par:
            H["par"] = par
        pv = g(r, "pin")
        pid = ("1" if _missing(pv) else _jstr(pv).strip() or "1") if "pin" in ix else "1"
        P = H["pins"].get(pid)
        if P is None:
            P = H["pins"][pid] = {"px": 0.0, "py": 0.0, "pn": 0, "shots": [], "hist": {}}
        px, py = _num(g(r, "pinX")), _num(g(r, "pinY"))
        if px is not None and py is not None:
            P["px"] += px
            P["py"] += py
            P["pn"] += 1
        L = _lie_ix(g(r, "lie"))
        dist, v, st = _num(g(r, "dist")), _num(g(r, "v")), _num(g(r, "strokes"))
        out = _num(g(r, "holeOut")) == 1
        sf = _num(g(r, "shotFor"))
        if v is not None:
            P["shots"].append((x, y, L, dist if dist is not None else -1, v, st if st is not None else 0))  # (update 482: and the stroke)
        if L == 0 and dist is not None:
            H["tee"].append(dist)
        hp = par or H["par"]
        score = (sf if sf is not None else (st - hp if st is not None and hp else None)) if out else None
        if score is not None:
            k = max(-2, min(2, _round(score)))
            P["hist"][k] = P["hist"].get(k, 0) + 1
        idv, plv = g(r, "playerID"), g(r, "player")
        key = (client_key(_idtext(idv)) if "playerID" in ix and not _missing(idv)
               else client_key(_jstr(plv) if not _missing(plv) else "null") if "player" in ix else None)
        if key:
            T = C["players"].get(key)
            if T is None:
                T = C["players"][key] = {"name": "" if _missing(plv) else _jstr(plv), "trails": {}}
            rv = g(r, "round")
            tk = (year, _jstr(rv) if not _missing(rv) else "", hole)
            tr = T["trails"].get(tk)
            if tr is None:
                tr = T["trails"][tk] = {"y": year, "r": "" if "round" not in ix or _missing(rv) else _idtext(rv), "h": hole, "p": pid,
                                        "par": par or None, "s": None, "shots": []}
            tr["shots"].append([_jsn(st) if st is not None else None, _r1(x), _r1(y), L, _r1(dist) if dist is not None else None,
                                _jsn(v) if v is not None else None])
            if score is not None:
                tr["s"] = _round(score)
    out = []
    for C in courses.values():
        holes = {}
        for h, H in C["holes"].items():
            pins, hole_hist = {}, {}
            for pid, P in H["pins"].items():
                pin_x = P["px"] / P["pn"] if P["pn"] else None
                pin_y = P["py"] / P["pn"] if P["pn"] else None
                # pixels a yard on this image, for the zone sizes
                ratios = []
                for (sx, sy, L, d, _v, _s) in P["shots"]:
                    if len(ratios) >= 3000:
                        break
                    if pin_x is None or d <= 15 or L == 4:
                        continue
                    ratios.append(math.hypot(sx - pin_x, sy - pin_y) / d)
                ratios.sort()
                ppy = ratios[len(ratios) // 2] if ratios else 3
                def zone_rows(want, P=P, pin_x=pin_x, pin_y=pin_y, ppy=ppy):
                    cells = {}
                    for (sx, sy, L, d, v, sk) in P["shots"]:
                        if want and sk != want:
                            continue
                        yd = ((math.hypot(sx - pin_x, sy - pin_y) / ppy if pin_x is not None else 50) if d < 0 else d / 3 if L == 4 else d)
                        band = 2 if yd < 15 else 3 if yd < 40 else 5 if yd < 90 else 8 if yd < 170 else 12
                        size = band * ppy
                        k = (L, band, math.floor(sx / size), math.floor(sy / size))
                        c = cells.get(k)
                        if c is None:
                            c = cells[k] = {"L": L, "sx": 0.0, "sy": 0.0, "sv": 0.0, "sd": 0.0, "nd": 0, "n": 0}
                        c["sx"] += sx
                        c["sy"] += sy
                        c["sv"] += v
                        c["n"] += 1
                        if d >= 0:
                            c["sd"] += d
                            c["nd"] += 1
                    zrows = []
                    for c in cells.values():
                        dist = c["sd"] / c["nd"] if c["nd"] else None
                        zrows.append({"x": _r1(c["sx"] / c["n"]), "y": _r1(c["sy"] / c["n"]), "lie": LIES[c["L"]].capitalize(),
                                      "d": f"{_round(dist)} {'ft' if c['L'] == 4 else 'yds'}" if dist is not None else "",
                                      "dist": _r1(dist) if dist is not None else None,
                                      "v": _jsn(_round(c["sv"] / c["n"] * 1000) / 1000), "n": c["n"]})
                    return zrows
                zrows = zone_rows(0)
                # (update 482) where each shot finished: the next shot's starting spots (shot 1 on a par 3; 1-2 on a par 4; 1-3 on a par 5)
                by_shot = {}
                for k in range(1, max(1, min(3, (H["par"] or 4) - 2)) + 1):
                    r = zone_rows(k + 1)
                    if r:
                        by_shot[str(k)] = r
                hist = {str(k): n for k, n in sorted(P["hist"].items())}
                pins[pid] = {"x": _jsn(pin_x) if pin_x is not None else None, "y": _jsn(pin_y) if pin_y is not None else None, "rows": zrows, "hist": hist, "byShot": by_shot}
                for k, n in P["hist"].items():
                    hole_hist[k] = hole_hist.get(k, 0) + n
            tee = sum(H["tee"]) / len(H["tee"]) if H["tee"] else None
            holes[str(h)] = {"par": H["par"], "yards": _round(tee) if tee else None, "pins": pins,
                             "hist": {str(k): n for k, n in sorted(hole_hist.items())}}
        players = {}
        for key, T in C["players"].items():
            trails = []
            for t in T["trails"].values():
                t = dict(t)
                t["shots"] = sorted(t["shots"], key=lambda s: s[0] if s[0] is not None else 0)
                trails.append(t)
            players[key] = {"name": T["name"], "trails": trails}
        out.append({"name": C["name"], "courseNum": C["courseNum"], "years": sorted(C["years"]),
                    "data": {"holes": holes, "toGo": True, "hasN": True, "shots": True, "lies": LIES}, "players": players})
    return out


# ------------------------------------------------ saving ------------------------------------------------

_DUMPS = json.JSONEncoder(separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode


def _pieces(s):
    return [s[i:i + CH] for i in range(0, len(s), CH)]


def _save_course(db, c, existing, say):
    old = None
    if c["courseNum"] is not None:
        old = next((x for x in existing if str(x.get("courseNum") or "") == str(c["courseNum"])), None)
    old = old or next((x for x in existing if same_course(x.get("name"), c["name"])), None)
    cid = old["id"] if old else (f"c{heat_id(str(c['courseNum']))}" if c["courseNum"] is not None else heat_id(c["name"]))
    base = db.collection("courseHeat").document(cid)
    chunks = base.collection("chunks")
    put, drop, flush = _writer(db)

    def write(prefix, text, old_count):
        parts = _pieces(text)
        for i, p in enumerate(parts):
            put(chunks.document(f"{prefix}_{i}"), {"data": p})
        for i in range(len(parts), old_count or 0):
            drop(chunks.document(f"{prefix}_{i}"))
        return len(parts)

    js = _DUMPS(c["data"])
    data_chunks = write("data", js, (old or {}).get("dataChunks", 0))
    players, n = {}, len(c["players"])
    old_players = (old or {}).get("players") or {}
    for k, (key, p) in enumerate(c["players"].items(), 1):
        safe = re.sub(r"[^A-Za-z0-9_%-]", "_", key)
        players[key] = {"c": write(f"p_{safe}", _DUMPS(p), (old_players.get(key) or {}).get("c", 0)), "n": len(p["trails"]), "f": safe}
        if k % 50 == 0 or k == n:
            say(f"{c['name']}: players {k} of {n}")
    flush()
    holes = c["data"]["holes"]
    hn = max([int(float(h)) for h in holes] or [0])
    opar, oyds = (old or {}).get("par") or [], (old or {}).get("yards") or []
    par = [(holes.get(str(i + 1)) or {}).get("par") or (opar[i] if i < len(opar) else None) for i in range(hn)]
    yards = [(holes.get(str(i + 1)) or {}).get("yards") or (oyds[i] if i < len(oyds) else None) for i in range(hn)]
    zones = sum(len(p["rows"]) for h in holes.values() for p in h["pins"].values())
    meta = {"name": c["name"], "par": par, "yards": yards, "dataChunks": data_chunks, "dataBytes": len(js),
            "dataAt": _dt.datetime.now(_dt.timezone.utc), "zones": zones, "players": players, "years": c["years"], "shotLevel": True}
    if c["courseNum"] is not None:
        meta["courseNum"] = str(c["courseNum"])
    base.set(meta, merge=True)
    return cid, zones, len(js)


def _load(data):
    import pandas as pd
    if isinstance(data, pd.DataFrame):
        return data
    p = str(data)
    return pd.read_parquet(p) if p.lower().endswith(".parquet") else pd.read_csv(p)


def upload_course(data, course=None, key_path=None):
    """Upload one course's shots (or every course in `data` when course is None) to the Strategy Maps.

    data      a pandas DataFrame, or a path to a .parquet / .csv: one row per shot, the same columns as the file
              you'd upload by hand (year, courseNum, course, player, playerID, round, hole, par, pin_id, lie, strokes,
              shot_for, hole_out, x, y, scoring_avg, pin_x, pin_y, distance)
    course    which course to send from it: its courseNum (4) or name ("Torrey Pines South"). None sends every
              course in the data.
    Replaces that course's maps, history and past shots, so include every year you want on its map.
    Returns [{course, id, shots, players, zones}].
    """
    t0 = time.time()
    df = _load(data)
    ix = _columns(df.columns)
    if course is not None:
        num = _num(course) if not isinstance(course, str) or re.fullmatch(r"\s*\d+(\.0+)?\s*", course) else None
        if num is not None and "courseNum" in ix:
            col = df.columns[ix["courseNum"]]
            mask = df[col].map(lambda v: _num(v) == num)
        else:
            if "course" not in ix:
                raise ValueError("The data has no course column.")
            col = df.columns[ix["course"]]
            names = [n for n in df[col].dropna().astype(str).unique() if same_course(n, course) or str(n).strip().lower() == str(course).strip().lower()]
            mask = df[col].astype(str).isin(names)
        df = df[mask]
        if not len(df):
            raise ValueError(f"No shots for course {course!r} in that data.")
    print(f"Working out the zones, history and past shots for {len(df):,} shots...", flush=True)
    cols = [str(c) for c in df.columns]
    rows = df.astype(object).where(df.notna(), None).itertuples(index=False, name=None)
    courses = aggregate(cols, rows)
    if not courses:
        raise ValueError("No usable shots (each needs a course, hole, x and y).")
    from firebase_admin import firestore
    db = firestore.client(app=_connect(key_path))
    existing = [{**s.to_dict(), "id": s.id} for s in db.collection("courseHeat").stream()]
    results = []
    for c in courses:
        say = lambda m: print(f"  {m}", flush=True)  # noqa: E731
        say(f"Saving {c['name']} ({len(c['players'])} players)")
        cid, zones, size = _save_course(db, c, existing, say)
        shots = sum(len(t["shots"]) for p in c["players"].values() for t in p["trails"])
        results.append({"course": c["name"], "id": cid, "shots": shots, "players": len(c["players"]), "zones": zones})
        has_img = any(x["id"] == cid and x.get("holes") for x in existing)
        print(f"Live: {c['name']} ({', '.join(c['years']) or 'no year'}): {len(c['players'])} players, {zones:,} zones, "
              f"{size / 1e6:.1f} MB of map data.{'' if has_img else ' No hole images yet: upload the CourseImages zip on Upload Data.'}"
              f"  ({time.time() - t0:.0f}s)", flush=True)
    return results


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("python course_upload.py shots.parquet [courseNum or name]")
        raise SystemExit(1)
    upload_course(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
