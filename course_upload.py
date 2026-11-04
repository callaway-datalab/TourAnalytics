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
         "v": ["scoringavg", "strokestoholeout"], "pinX": ["pinx"], "pinY": ["piny"], "dist": ["distance", "dist"],
         "event": ["tournament", "tournamentname", "event", "eventname"],
         "appSide": ["appsideloc", "appside", "approachside", "missside"], "drive": ["drivedirection", "drivedir", "teedirection"]}  # (update 488)


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


# ------------------------------------------------ one map a course ------------------------------------------------
# (update 485, as js/courseShots.js sameCourses) Sources (a courseNum and spelling each) that are the same course (a shared
# courseNum, or the same name: a course that hosted two events has two courseNums) make one map. Each is checked against the
# biggest first: tees or pins somewhere else on the image (a different coordinate system: the median over its holes more
# than a fifth of the hole's length away) and it's left out, keeping the data with the most shots. A pin id two events use
# for different spots is kept apart: the second is "{pin}_e{courseNum}".

OFFSET_MAX = 0.2


def _centre(sx, sy, n):
    return (sx / n, sy / n) if n else None


def _pin_centre(H):
    x = y = 0.0
    n = 0
    for P in H["pins"].values():
        x += P["px"]
        y += P["py"]
        n += P["pn"]
    return _centre(x, y, n)


def _d(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def offset_of(A, B):
    """How far apart two sources' tees and pins are, as a share of the hole's length (median over their holes), or None."""
    r = []
    for h, HA in A["holes"].items():
        HB = B["holes"].get(h)
        if HB is None:
            continue
        tA, tB = _centre(HA["tx"], HA["ty"], HA["tn"]), _centre(HB["tx"], HB["ty"], HB["tn"])
        pA, pB = _pin_centre(HA), _pin_centre(HB)
        if not tA or not pA:
            continue
        ln = _d(tA, pA)
        if ln < 1:
            continue
        if tB or pB:
            r.append(max(_d(tA, tB) if tB else 0, _d(pA, pB) if pB else 0) / ln)
    if not r:
        return None
    r.sort()
    return r[len(r) // 2]


def _same_courses(lst):
    up = list(range(len(lst)))

    def find(i):
        while up[i] != i:
            up[i] = up[up[i]]
            i = up[i]
        return i
    for i in range(len(lst)):
        for j in range(i):
            a, b = lst[i], lst[j]
            # (update 486) a map per courseNum (a course that hosted two events has one for each, on its own images); one
            # courseNum spelled two ways is one map; without courseNums, the same name is one map
            if (a["courseNum"] == b["courseNum"]) if a["courseNum"] else (not b["courseNum"] and same_course(a["name"], b["name"])):
                up[find(i)] = find(j)
    groups = {}
    for i, c in enumerate(lst):
        groups.setdefault(find(i), []).append(c)
    out = []
    for g in groups.values():
        big = sorted(g, key=lambda c: -c["n"])[0]
        keep = [c for c in g if c is big or not ((offset_of(big, c) or 0) > OFFSET_MAX)]
        dropped = [{"courseNum": c["courseNum"], "name": c["name"], "shots": c["n"], "offset": _round(offset_of(big, c) * 100)} for c in g if not any(c is k for k in keep)]

        def num_key(c):
            v = str(c["courseNum"] or "")
            return (0, float(v), "") if re.fullmatch(r"\d+(\.\d+)?", v) else (1, 0.0, v)
        keep.sort(key=lambda c: (num_key(c), -c["n"]))
        M = {"name": big["name"], "names": {}, "courseNum": keep[0]["courseNum"], "holes": {}, "players": {}, "years": set(), "events": {}, "n": 0}
        for c in keep:
            _merge_source(M, c)
        M["courseNums"] = list(dict.fromkeys(c["courseNum"] for c in keep if c["courseNum"]))
        M["dropped"] = dropped
        # (update 486) every courseNum's shots and how far its tees and pins are from the biggest one's, to report
        M["sources"] = []
        for c in g:
            o = 0 if c is big else offset_of(big, c)
            M["sources"].append({"courseNum": c["courseNum"], "name": c["name"], "shots": c["n"], "offset": None if o is None else _round(o * 100),
                                 "kept": any(c is k for k in keep), "biggest": c is big})
        out.append(M)
    return out


def _merge_source(M, C):
    ren = {}
    for nm, k in C["names"].items():
        M["names"][nm] = M["names"].get(nm, 0) + k
    M["years"] |= C["years"]
    for e, ys in C["events"].items():
        M["events"].setdefault(e, set()).update(ys)
    M["n"] += C["n"]
    for h, HC in C["holes"].items():
        HM = M["holes"].get(h)
        if HM is None:
            HM = M["holes"][h] = {"par": None, "pins": {}, "tee": [], "tx": 0.0, "ty": 0.0, "tn": 0}
        HM["par"] = HM["par"] or HC["par"]
        HM["tee"].extend(HC["tee"])
        tM, pM = _centre(HM["tx"], HM["ty"], HM["tn"]), _pin_centre(HM)
        ln = _d(tM, pM) if tM and pM else None
        HM["tx"] += HC["tx"]
        HM["ty"] += HC["ty"]
        HM["tn"] += HC["tn"]
        for pid, PC in HC["pins"].items():
            pid_new = pid
            PM = HM["pins"].get(pid)
            if PM and PM["pn"] and PC["pn"] and ln and _d(_centre(PM["px"], PM["py"], PM["pn"]), _centre(PC["px"], PC["py"], PC["pn"])) > 0.03 * ln:
                pid_new = f"{pid}_e{C['courseNum'] or 'x'}"
            ren[(h, pid)] = pid_new
            T = HM["pins"].get(pid_new)
            if T is None:
                HM["pins"][pid_new] = {"px": PC["px"], "py": PC["py"], "pn": PC["pn"], "shots": PC["shots"], "hist": dict(PC["hist"])}
                continue
            T["px"] += PC["px"]
            T["py"] += PC["py"]
            T["pn"] += PC["pn"]
            T["shots"].extend(PC["shots"])
            for k, n in PC["hist"].items():
                T["hist"][k] = T["hist"].get(k, 0) + n
    for key, TC in C["players"].items():
        TM = M["players"].get(key)
        if TM is None:
            TM = M["players"][key] = {"name": TC["name"], "trails": {}}
        TM["name"] = TM["name"] or TC["name"]
        for tk, tr in TC["trails"].items():
            tr["p"] = ren.get((tr["h"], tr["p"]), tr["p"])
            TM["trails"][tk] = tr


# ------------------------------------------------ Course Insights (update 488) ------------------------------------------------
# As js/courseShots.js courseInsights (keep the two the same): events (winning, Top 10, Top 25 scores and cut line), each
# hole's scoring for the field and the Top 10, fairway / green in regulation / going-for-it values, fairway widths, tee
# misses left and right (drive_direction), up & down by approach miss side and lie (app_side_loc), attempts by distance and
# strokes gained by distance against this course's own field.

ATT_B = ["3-5 ft", "5-10 ft", "10-15 ft", "15-20 ft", "20-25 ft", ">25 ft", "<30 yds", "30-50 yds", "50-100 yds", "100-120 yds",
         "120-140 yds", "140-160 yds", "160-180 yds", "180-200 yds", "200-220 yds", ">220 yds"]


def side_of(v):
    if _missing(v):
        return None
    t = re.sub(r"[^a-z]+", " ", str(v).lower()).strip()
    if not t:
        return None
    ab = re.fullmatch(r"(s|l)(l|r)", t.replace(" ", ""))
    lo = ab.group(1) == "l" if ab else bool(re.search("long|over|back", t))
    sh = ab.group(1) == "s" if ab else bool(re.search("short|front", t))
    le = ab.group(2) == "l" if ab else "left" in t
    ri = ab.group(2) == "r" if ab else "right" in t
    a = "Long" if lo else "Short" if sh else ""
    b = "Left" if le else "Right" if ri else ""
    return f"{a}-{b}" if a and b else (a or b or None)


def drive_of(v):
    if _missing(v):
        return None
    t = str(v).lower()
    return "L" if "left" in t else "R" if "right" in t else "C" if re.search("fair|cent|middle|straight|hit", t) else None


def _r4(x):
    return _jsn(_round(x * 1e4) / 1e4)


def _yd_b(d):
    for lim, b in [(30, "<30 yds"), (50, "30-50 yds"), (100, "50-100 yds"), (120, "100-120 yds"), (140, "120-140 yds"), (160, "140-160 yds"),
                   (180, "160-180 yds"), (200, "180-200 yds"), (220, "200-220 yds")]:
        if d < lim:
            return b
    return ">220 yds"


def _ft_b(d):
    for lim, b in [(5, "<5 ft"), (10, "5-10 ft"), (15, "10-15 ft"), (20, "15-20 ft"), (25, "20-25 ft")]:
        if d < lim:
            return b
    return ">25 ft"


def bucket_of(q, par, sg):
    L, d = q[3], q[4]
    if q[0] == 1 and par >= 4:
        return "Tee shot" if sg else None
    if d is None:
        return None
    if L == 4:
        if not sg and d < 3:
            return None
        b = _ft_b(d)
        return b if sg else ("3-5 ft" if b == "<5 ft" else b)
    return _yd_b(d)


def e_key(L, d):
    if d is None:
        return None
    if L == 4:
        b = math.floor(d) if d < 10 else 10 + math.floor((d - 10) / 5) if d < 30 else min(30, 14 + math.floor((d - 30) / 10))
    else:
        b = math.floor(d / 5) if d < 30 else 6 + math.floor((d - 30) / 10) if d < 100 else min(40, 13 + math.floor((d - 100) / 20))
    return f"{L}|{b}"


def trail_sg(shots, s, par, E, into):
    for i, q in enumerate(shots):
        k0 = e_key(q[3], q[4])
        if k0 is None or k0 not in E:
            continue
        if i + 1 < len(shots):
            k1 = e_key(shots[i + 1][3], shots[i + 1][4])
            if k1 is None or k1 not in E:
                continue
            nx = E[k1]
        elif s is not None:
            nx = 0
        else:
            continue
        b = bucket_of(q, par, True)
        if not b:
            continue
        into[b] = into.get(b, 0) + (E[k0] - nx - 1)


def _add2(o, k, v):
    a = o.setdefault(k, [0, 0])
    a[0] += 1
    a[1] += v


def _sc5():
    return {"n": 0, "sum": 0, "e": 0, "b": 0, "p": 0, "g": 0}


def _add_sc(o, s):
    o["n"] += 1
    o["sum"] += s
    o["e" if s <= -2 else "b" if s == -1 else "p" if s == 0 else "g"] += 1


def course_insights(C):
    allt = []
    for key, T in C["players"].items():
        for t in T["trails"].values():
            allt.append((key, t, sorted(t["shots"], key=lambda q: q[0] if q[0] is not None else 0)))

    def par_of(h):
        H = C["holes"].get(h)
        return (H and H["par"]) or 4
    by_y = {}
    for key, t, _ in allt:
        if t["s"] is None:
            continue
        P = by_y.setdefault(t["y"], {}).setdefault(key, {"n": 0, "tot": 0, "rs": set(), "r12": 0})
        P["n"] += 1
        P["tot"] += t["s"]
        P["rs"].add(str(t["r"]))
        rn = _num(t["r"])
        if rn is not None and rn <= 2:
            P["r12"] += t["s"]
    events, top = [], set()
    top_list = []
    for y, Y in by_y.items():
        ps = list(Y.items())
        max_n = max(P["n"] for _, P in ps)
        max_r = max(len(P["rs"]) for _, P in ps)
        full = [(k, P) for k, P in ps if P["n"] == max_n]
        tots = sorted(P["tot"] for _, P in full)
        t10 = tots[min(9, len(tots) - 1)]
        for k, P in full:
            if P["tot"] <= t10 and f"{k}|{y}" not in top:
                top.add(f"{k}|{y}")
                top_list.append(f"{k}|{y}")
        cut = None
        if max_r >= 3:
            made = [P for _, P in ps if len(P["rs"]) >= 3]
            missed = [P for _, P in ps if len(P["rs"]) == 2]
            if made and missed:
                cut = max(P["r12"] for P in made)
        events.append({"y": y, "players": len(ps), "full": len(full), "rounds": max_r, "win": tots[0] if tots else None,
                       "top10": tots[9] if len(tots) >= 10 else None, "top25": tots[24] if len(tots) >= 25 else None, "cut": cut})
    Es = {}
    for _, _, qs in allt:
        for q in qs:
            if q[5] is None:
                continue
            k = e_key(q[3], q[4])
            if k is None:
                continue
            a = Es.setdefault(k, [0, 0])
            a[0] += q[5]
            a[1] += 1
    E = {k: _r4(a[0] / a[1]) for k, a in Es.items()}
    ppy = {}
    for h, H in C["holes"].items():
        rs = []
        for _, t, qs in allt:
            if t["h"] != h or len(rs) >= 3000:
                continue
            P = H["pins"].get(t["p"])
            if not P or not P["pn"]:
                continue
            px, py = P["px"] / P["pn"], P["py"] / P["pn"]
            for q in qs:
                if q[3] != 4 and q[4] is not None and q[4] > 15 and len(rs) < 3000:
                    rs.append(math.hypot(q[1] - px, q[2] - py) / q[4])
        rs.sort()
        ppy[h] = rs[len(rs) // 2] if rs else None
    holes, attempts, sg_f, sg_t, r_f, r_t = {}, {}, {}, {}, set(), set()
    for h in C["holes"]:
        holes[h] = {"par": par_of(h), "field": _sc5(), "top": _sc5(), "fwy": {}, "gir": {}, "go": {}, "drive": {}, "ud": {}, "land": []}
    for key, t, qs in allt:
        X = holes.get(t["h"])
        if X is None:
            continue
        par = X["par"]
        is_top = f"{key}|{t['y']}" in top
        rk = f"{key}|{t['y']}|{t['r']}"
        for q in qs:
            b = bucket_of(q, par, False)
            if b:
                attempts[b] = attempts.get(b, 0) + 1
        r_f.add(rk)
        if is_top:
            r_t.add(rk)
        one = {}
        trail_sg(qs, t["s"], par, E, one)
        for b, v in one.items():
            sg_f[b] = sg_f.get(b, 0) + v
            if is_top:
                sg_t[b] = sg_t.get(b, 0) + v

        def at(k, qs=qs):
            return next((q for q in qs if q[0] == k), None)
        for k, side in (t.get("as") or {}).items():
            kn = _num(k)
            nq = at(kn + 1) if kn is not None else None
            if not nq or nq[4] is None or nq[4] > 30 or nq[3] not in (1, 2, 3):
                continue
            lie = LIES[nq[3]].capitalize()
            a = X["ud"].setdefault(side, {}).setdefault(lie, [0, 0])
            a[0] += 1
            if nq[5] is not None and nq[5] <= 2:
                a[1] += 1
        if t["s"] is None:
            continue
        s = t["s"]
        _add_sc(X["field"], s)
        if is_top:
            _add_sc(X["top"], s)
        q2 = at(2)
        if par >= 4 and q2:
            _add2(X["fwy"], "hit" if q2[3] == 1 else "miss", s)
        _add2(X["gir"], "hit" if any(q[0] is not None and q[0] <= par - 1 and q[3] == 4 for q in qs) or s <= -2 else "miss", s)
        qg = at(3) if par >= 5 else q2 if par == 4 else None
        if qg:
            d = 0 if qg[3] == 4 else qg[4]
            if d is not None and d <= 30:
                _add2(X["go"], "go", s)
            elif d is not None and d <= 100:
                _add2(X["go"], "lay", s)
        if par >= 4 and t.get("dd"):
            _add2(X["drive"], t["dd"], s)
        q1 = at(1)
        if par >= 4 and q1 and q2 and q2[3] == 1:
            X["land"].append((q1[1], q1[2], q2[1], q2[2]))
    out = {}
    for h, X in holes.items():
        widths, k = {}, ppy.get(h)
        if k:
            for c in (250, 275, 300, 325):
                pts = [l for l in X["land"] if abs(math.hypot(l[2] - l[0], l[3] - l[1]) / k - c) <= 12.5]
                if len(pts) < 8:
                    continue
                n = len(pts)
                tx, ty = sum(l[0] for l in pts) / n, sum(l[1] for l in pts) / n
                cx, cy = sum(l[2] for l in pts) / n, sum(l[3] for l in pts) / n
                dl = math.hypot(cx - tx, cy - ty) or 1
                ux, uy = (cx - tx) / dl, (cy - ty) / dl
                off = sorted(((l[2] - tx) * uy - (l[3] - ty) * ux) / k for l in pts)
                widths[str(c)] = _round(off[math.floor(0.95 * (n - 1))] - off[math.floor(0.05 * (n - 1))])

        def fx(o):
            return {**o, "sum": _r4(o["sum"])}

        def f2(o):
            return {kk: [a[0], _r4(a[1])] for kk, a in o.items()}
        out[str(h)] = {"par": X["par"], "field": fx(X["field"]), "top": fx(X["top"]), "fwy": f2(X["fwy"]), "gir": f2(X["gir"]),
                       "go": f2(X["go"]), "drive": f2(X["drive"]), "ud": X["ud"], "widths": widths}
    return {"events": events, "holes": out, "attempts": attempts,
            "sg": {"field": {b: _r4(v) for b, v in sg_f.items()}, "top": {b: _r4(v) for b, v in sg_t.items()},
                   "fieldRounds": len(r_f), "topRounds": len(r_t), "E": E}, "top": top_list}


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
        # (update 485) read as sources, one per courseNum and spelling; put together per course at the end (_same_courses)
        ck = f"{cn or ''}|{name}"
        C = courses.get(ck)
        if C is None:
            C = courses[ck] = {"name": name, "names": {name: 0}, "courseNum": cn, "holes": {}, "players": {}, "years": set(), "events": {}, "n": 0}
        C["names"][name] += 1
        C["n"] += 1
        if cn and not C["courseNum"]:
            C["courseNum"] = cn
        yv = g(r, "year")
        year = "" if "year" not in ix or _missing(yv) else _idtext(yv)
        if year:
            C["years"].add(year)
        evv = g(r, "event")
        ev = "" if "event" not in ix or _missing(evv) else str(evv).strip()  # (update 486: the tournament, when the data has it)
        if ev:
            e = C["events"].setdefault(ev, set())
            if year:
                e.add(year)
        H = C["holes"].get(hole)
        if H is None:
            H = C["holes"][hole] = {"par": None, "pins": {}, "tee": [], "tx": 0.0, "ty": 0.0, "tn": 0}
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
        if st == 1:  # (update 485: where the tee shots start, to check two events line up)
            H["tx"] += x
            H["ty"] += y
            H["tn"] += 1
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
            tk = (year, _jstr(rv) if not _missing(rv) else "", hole, cn or "")  # (update 485: and the event's courseNum)
            tr = T["trails"].get(tk)
            if tr is None:
                tr = T["trails"][tk] = {"y": year, "r": "" if "round" not in ix or _missing(rv) else _idtext(rv), "h": hole, "p": pid,
                                        "par": par or None, "s": None, "shots": []}
            tr["shots"].append([_jsn(st) if st is not None else None, _r1(x), _r1(y), L, _r1(dist) if dist is not None else None,
                                _jsn(v) if v is not None else None])
            if score is not None:
                tr["s"] = _round(score)
            # (update 488) where an approach finished around the green, and which way the tee shot went
            sd = side_of(g(r, "appSide")) if "appSide" in ix else None
            if sd:
                tr.setdefault("as", {})[str(_jsn(st)) if st is not None else "null"] = sd
            dd = drive_of(g(r, "drive")) if "drive" in ix and st == 1 else None
            if dd:
                tr["dd"] = dd
    out = []
    for C in _same_courses(list(courses.values())):
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
        out.append({"name": max(C["names"].items(), key=lambda t: t[1])[0] if C["names"] else C["name"], "courseNum": C["courseNum"], "courseNums": C["courseNums"], "dropped": C["dropped"], "sources": C["sources"],
                    "events": [{"name": e, "years": sorted(ys)} for e, ys in C["events"].items()], "years": sorted(C["years"]),
                    "data": {"holes": holes, "toGo": True, "hasN": True, "shots": True, "lies": LIES, "insights": course_insights(C)}, "players": players})
    return out


# ------------------------------------------------ saving ------------------------------------------------

_DUMPS = json.JSONEncoder(separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode


def _pieces(s):
    return [s[i:i + CH] for i in range(0, len(s), CH)]


def _save_course(db, c, existing, say):
    nums = [str(n) for n in (c.get("courseNums") or [c["courseNum"]]) if n is not None]
    # (update 486) the map already there: the one with this courseNum (each event's map is its own, with its own images);
    # a course without courseNums, the one of the same name that has none either
    bn = str(c["courseNum"]) if c["courseNum"] is not None else ""
    # (update 487) first the map made for that courseNum (its id, c{courseNum}, which no upload ever relabels)
    old = ((next((x for x in existing if x["id"] == f"c{heat_id(bn)}"), None) or next((x for x in existing if str(x.get("courseNum") or "") == bn), None) if bn else None)
           or next((x for x in existing if not x.get("courseNum") and same_course(x.get("name"), c["name"])), None))
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
    meta["courseNums"] = nums
    meta["events"] = c.get("events") or []
    meta["attempts"] = (c["data"].get("insights") or {}).get("attempts") or {}  # (update 488: the distribution against every course)
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
        pins = " ".join(f"{h}:{len(H['pins'])}" for h, H in sorted(c["data"]["holes"].items(), key=lambda t: float(t[0])))
        print(f"  Pins on each hole (hole:pins): {pins}", flush=True)
        if len(c.get("sources") or []) > 1:
            for s0 in c["sources"]:
                print(f"  courseNum {s0['courseNum']}: {s0['shots']:,} shots" + (" (the most)" if s0["biggest"] else
                      f", tees/pins {s0['offset'] if s0['offset'] is not None else '?'}% of the hole's length from the rest") + ("" if s0["kept"] else ": LEFT OUT"), flush=True)
        if c.get("dropped"):
            print(f"  (LEFT OUT: tees / pins over {round(OFFSET_MAX * 100)}% of the hole's length from the courseNum with the most shots,"
                  " so a different coordinate system; only the data with the most shots is kept)", flush=True)
        results.append({"course": c["name"], "id": cid, "shots": shots, "players": len(c["players"]), "zones": zones})
        has_img = any(x["id"] == cid and x.get("holes") for x in existing)
        evs = " \u00b7 ".join(f"{e['name']} ({', '.join(e['years'])})" for e in c.get("events") or [])
        num = f" #{c['courseNum']}" if c["courseNum"] else ""
        print(f"Live: {c['name']}{num} ({evs or ', '.join(c['years']) or 'no year'}): {len(c['players'])} players, {zones:,} zones, "
              f"{size / 1e6:.1f} MB of map data.{'' if has_img else ' No hole images yet: upload the CourseImages zip on Upload Data.'}"
              f"  ({time.time() - t0:.0f}s)", flush=True)
    return results


def list_maps(key_path=None):
    """(update 487) Every Strategy Maps course saved on the site: its id, name, courseNums, how many hole images, whether
    it has scoring, its years and tournaments. To check what's there (e.g. which map has which images)."""
    from firebase_admin import firestore
    db = firestore.client(app=_connect(key_path))
    rows = []
    for snap in db.collection("courseHeat").stream():
        d = snap.to_dict()
        holes = d.get("holes") or {}
        rows.append((snap.id, d.get("name"), d.get("courseNum"), d.get("courseNums"), len(holes), bool(d.get("dataChunks")),
                     ", ".join(d.get("years") or []), " / ".join(e.get("name", "") for e in d.get("events") or [])))
    for r in sorted(rows, key=lambda r: (str(r[1]), str(r[0]))):
        print(f"{r[0]:<14} {str(r[1])[:45]:<45} courseNum {str(r[2]):<6} (all: {r[3]})  images {r[4]:>2}  scoring {'yes' if r[5] else 'no ':<3}  years {r[6] or '-'}  {r[7]}")
    return rows


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("python course_upload.py shots.parquet [courseNum or name]")
        raise SystemExit(1)
    upload_course(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
