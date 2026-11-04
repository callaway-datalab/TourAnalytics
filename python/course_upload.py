"""
course_upload.py - send a course's shot-level data to the Strategy Maps straight from Python (update 481; update 496: it
only uploads).

    from course_upload import upload_course
    upload_course(cluster_data, course=4)            # courseNum 4 (or a name: course="Torrey Pines South")

This only gets the shots onto the site: each map's raw shots (one map for each courseNum), packed and gzipped the same way
tour_upload.py sends the stats. Nothing is worked out here. The website builds the maps from those shots (the zones, each
hole's history, each player's past shots, Course Insights): open Upload Data > Strategy Maps and press Rebuild maps after
an upload. When an update changes how the maps are worked out, the same button rebuilds every course from the shots
already there, so this file shouldn't need to change again.

Each upload REPLACES that map's shots, so send every year you want on its map (last year's rounds plus this week's).
Other courses, and the course's hole images, aren't touched.

Setup: the same as tour_upload.py (pip install firebase-admin pandas pyarrow, and the service account key in your home
folder as touranalytics-key.json, or TOUR_ANALYTICS_KEY / key_path=). Keep this file next to tour_upload.py.
"""
from __future__ import annotations

import datetime as _dt
import math
import re
import time

from tour_upload import _connect, chunk_rows_z

# the columns kept, in order (as js/courseRaw.js RAW_COLS), and the names each is found under (as js/courseShots.js COLS)
RAW_COLS = ["year", "courseNum", "course", "player", "playerID", "round", "hole", "par", "pin_id", "lie", "strokes", "shot_for",
            "hole_out", "x", "y", "scoring_avg", "pin_x", "pin_y", "distance", "tournament"]
_NAMES = [["year", "season"], ["coursenum", "coursenumber", "courseid"], ["course", "coursename"], ["player", "playername", "name"],
          ["playerid", "player_id", "pid"], ["round", "rnd", "roundno"], ["hole"], ["par", "holepar"], ["pinid", "pin", "pinlocation"],
          ["lie", "fromlocation"], ["strokes", "stroke", "shotnum", "shotnumber"], ["shotfor"], ["holeout"], ["x"], ["y"],
          ["scoringavg", "strokestoholeout"], ["pinx"], ["piny"], ["distance", "dist"], ["tournament", "tournamentname", "event", "eventname"]]
_REQUIRED = {"course": 2, "hole": 6, "x": 13, "y": 14, "strokes": 10, "hole_out": 12}


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s if s is not None else "").lower())


def _missing(v):
    return v is None or (isinstance(v, float) and v != v) or (isinstance(v, str) and not v.strip()) or str(v) in ("<NA>", "NaT", "nan")


def _clean(v):
    """A value as the site keeps it: None for blanks, whole numbers without .0, text trimmed."""
    if _missing(v):
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) or type(v).__module__ == "numpy":
        try:
            f = float(v)
        except (TypeError, ValueError):
            return str(v).strip()
        if not math.isfinite(f):
            return None
        return int(f) if f.is_integer() and abs(f) < 2 ** 53 else f
    return str(v).strip()


def _cn(v):
    """A courseNum as text, as the site writes it (4.0 -> "4")."""
    c = _clean(v)
    if c is None:
        return None
    try:
        f = float(c)
        return str(int(f)) if f.is_integer() else str(f)
    except (TypeError, ValueError):
        return str(c)


def heat_id(name):
    """As js/courseHeat.js heatId."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(name or "course").lower()))[:120] or "course"


_STOP = {"golf", "club", "course", "links", "gl", "gc", "cc", "country", "the", "and", "resort", "g", "c"}


def same_course(a, b):
    """As js/sg.js sameCourse."""
    def key(n):
        t = re.sub(r"[^a-z0-9 ]+", " ", str(n or "").lower().replace("&", " "))
        return " ".join(w for w in t.split() if w and w not in _STOP)
    x, y = key(a), key(b)
    return bool(x and y) and (x == y or (min(len(x), len(y)) >= 5 and (x in y or y in x)))


def _map_id(cn, name, existing):
    """The map a course goes into (as js/courseShots.js mapIdFor)."""
    if cn:
        old = (next((x for x in existing if x["id"] == f"c{heat_id(cn)}"), None)
               or next((x for x in existing if str(x.get("courseNum") or "") == cn), None)
               or next((x for x in existing if not x.get("courseNum") and same_course(x.get("name"), name)), None))
    else:
        old = next((x for x in existing if not x.get("courseNum") and same_course(x.get("name"), name)), None)
    return old, (old["id"] if old else (f"c{heat_id(cn)}" if cn else heat_id(name)))


def _load(data):
    import pandas as pd
    if isinstance(data, pd.DataFrame):
        return data
    p = str(data)
    return pd.read_parquet(p) if p.lower().endswith(".parquet") else pd.read_csv(p)


def upload_course(data, course=None, key_path=None):
    """Upload one course's shots (or every course in `data` when course is None) to the Strategy Maps.

    data      a pandas DataFrame, or a path to a .parquet / .csv: one row per shot (year, courseNum, course, player,
              playerID, round, hole, par, pin_id, lie, strokes, shot_for, hole_out, x, y, scoring_avg, pin_x, pin_y,
              distance; tournament optional)
    course    which course: its courseNum (4) or name ("Torrey Pines South": every courseNum under that name). None: all.
    Replaces each map's shots. Then press Rebuild maps on Upload Data > Strategy Maps.
    Returns [{course, courseNum, id, shots}].
    """
    t0 = time.time()
    df = _load(data)
    h = [_norm(c) for c in df.columns]
    pos = [next((h.index(_norm(n)) for n in names if _norm(n) in h), None) for names in _NAMES]
    missing = [k for k, i in _REQUIRED.items() if pos[i] is None]
    if missing:
        raise ValueError(f"The shot data is missing {', '.join(missing)}. Columns: {', '.join(map(str, df.columns))}")
    ccol, ncol = df.columns[pos[2]], (df.columns[pos[1]] if pos[1] is not None else None)
    if course is not None:
        is_num = not isinstance(course, str) or re.fullmatch(r"\s*\d+(\.0+)?\s*", course)
        if is_num and ncol is not None:
            df = df[df[ncol].map(_cn) == _cn(course)]
        else:
            names = [n for n in df[ccol].dropna().astype(str).unique() if same_course(n, course) or n.strip().lower() == str(course).strip().lower()]
            df = df[df[ccol].astype(str).isin(names)]
        if not len(df):
            raise ValueError(f"No shots for course {course!r} in that data.")
    # one map for each courseNum (a course name when there's none)
    cns = df[ncol].map(_cn).tolist() if ncol is not None else [None] * len(df)
    cnames = df[ccol].tolist()
    groups = {}
    for i, (k, nm0) in enumerate(zip(cns, cnames)):
        nm = "" if _missing(nm0) else str(nm0).strip()
        if not nm:
            continue
        g = groups.setdefault(f"#{k}" if k else f"@{nm.lower()}", {"cn": k, "names": {}, "idx": []})
        g["names"][nm] = g["names"].get(nm, 0) + 1
        g["idx"].append(i)
    from firebase_admin import firestore
    db = firestore.client(app=_connect(key_path))
    existing = [{**s.to_dict(), "id": s.id} for s in db.collection("courseHeat").stream()]
    out = []
    for g in groups.values():
        name = max(g["names"].items(), key=lambda kv: kv[1])[0]
        label = f"{name} #{g['cn']}" if g["cn"] else name
        part = df.iloc[g["idx"]]
        cols = [part.iloc[:, p].tolist() if p is not None else [None] * len(part) for p in pos]
        rows = [[_clean(c[r]) for c in cols] for r in range(len(part))]
        old, mid = _map_id(g["cn"], name, existing)
        print(f"Packing {label}: {len(rows):,} shots...", flush=True)
        chunks = chunk_rows_z(rows)
        base = db.collection("courseHeat").document(mid)
        for i, z in enumerate(chunks):
            base.collection("chunks").document(f"raw_{i}").set({"z": z})
        for i in range(len(chunks), (old or {}).get("rawChunks", 0) or 0):
            base.collection("chunks").document(f"raw_{i}").delete()
        size = sum(len(z) for z in chunks)
        meta = {"name": name, "rawChunks": len(chunks), "rawRows": len(rows), "rawBytes": size, "rawCols": RAW_COLS,
                "rawAt": _dt.datetime.now(_dt.timezone.utc), "needsBuild": True}
        if g["cn"]:
            meta["courseNum"] = g["cn"]
        base.set(meta, merge=True)
        out.append({"course": name, "courseNum": g["cn"], "id": mid, "shots": len(rows)})
        print(f"Saved: {label}, {len(rows):,} shots ({size / 1e6:.1f} MB packed)."
              f"{'' if old and old.get('holes') else ' No hole images yet: upload the CourseImages zip on Upload Data.'}  ({time.time() - t0:.0f}s)", flush=True)
    print("Now open Upload Data > Strategy Maps on the site and press Rebuild maps to build the maps from these shots.", flush=True)
    return out


def list_maps(key_path=None):
    """(update 487) Every Strategy Maps course saved on the site: its id, name, courseNum, hole images, its shots, and
    whether its maps are built or need rebuilding."""
    from firebase_admin import firestore
    db = firestore.client(app=_connect(key_path))
    rows = []
    for snap in db.collection("courseHeat").stream():
        d = snap.to_dict()
        state = "needs rebuild" if d.get("rawChunks") and (d.get("needsBuild") or d.get("builtVersion") is None) else ("built" if d.get("dataChunks") else "no maps")
        rows.append((snap.id, d.get("name"), d.get("courseNum"), len(d.get("holes") or {}), d.get("rawRows") or 0, state, ", ".join(d.get("years") or [])))
    for r in sorted(rows, key=lambda r: (str(r[1]), str(r[0]))):
        print(f"{r[0]:<14} {str(r[1])[:45]:<45} courseNum {str(r[2]):<6} images {r[3]:>2}  shots {r[4]:>9,}  {r[5]:<13} years {r[6] or '-'}")
    return rows


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("python course_upload.py shots.parquet [courseNum or name]")
        raise SystemExit(1)
    upload_course(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
