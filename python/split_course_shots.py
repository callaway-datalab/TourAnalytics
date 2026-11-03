"""
Split one big shot-level Parquet (every shot, every player, every course) into one file per course, ready to upload
one at a time on TourAnalytics > Upload Data > Strategy Maps > Scoring.

Each output file keeps only the columns the site reads, is sorted the way the site reads it (course, year, round,
player, hole, stroke), and is checked first (missing columns, holes with no hole_out row, strokes that don't start at 1).

Usage (in a notebook or a script):

    from split_course_shots import split_by_course, check_shots

    check_shots(cluster_data)                        # optional: look for problems before splitting
    files = split_by_course(cluster_data, "course_files")
    # -> course_files/4_Torrey_Pines_Golf_Course_South_Course.parquet, course_files/939_Torrey_Pines_..., ...

`cluster_data` can be a pandas DataFrame or a path to a .parquet / .csv file.
"""
from __future__ import annotations

import os
import re

import pandas as pd

# the columns the site reads, in this order
COLUMNS = ["year", "courseNum", "course", "tournament", "player", "playerID", "round", "hole", "par", "pin_id", "lie",
           "strokes", "shot_for", "hole_out", "x", "y", "scoring_avg", "pin_x", "pin_y", "distance"]  # (tournament: optional, update 486)
REQUIRED = ["course", "hole", "x", "y", "strokes", "hole_out", "scoring_avg", "lie"]


def _load(data) -> pd.DataFrame:
    if isinstance(data, pd.DataFrame):
        return data
    path = str(data)
    if path.lower().endswith(".parquet"):
        return pd.read_parquet(path)
    return pd.read_csv(path)


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", str(text)).strip("_")[:80] or "course"


def check_shots(data) -> pd.DataFrame:
    """Prints any problems the site would trip over, and returns the rows of holes that have them (empty if none)."""
    df = _load(data)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        print(f"Missing columns the site needs: {missing}")
        return df.head(0)
    extra = [c for c in COLUMNS if c not in df.columns]
    if extra:
        print(f"Optional columns not in the file (the site copes without them): {extra}")
    keys = [c for c in ["course", "year", "round", "playerID" if "playerID" in df.columns else "player", "hole"] if c in df.columns]
    g = df.groupby(keys, dropna=False)
    outs = g["hole_out"].sum()
    first = g["strokes"].min()
    bad = outs.index[(outs != 1) | (first != 1)]
    if len(bad):
        print(f"{len(bad):,} player-holes have no hole_out row, more than one, or strokes that don't start at 1 "
              f"(their score won't count, but their shots still feed the map).")
    if "playerID" in df.columns and df["playerID"].isna().any():
        print(f"{int(df['playerID'].isna().sum()):,} rows have no playerID: their shots feed the map but no one's past shots.")
    print(f"{len(df):,} shots, {df['course'].nunique()} courses"
          + (f", {df['playerID'].nunique():,} players" if "playerID" in df.columns else "") + ".")
    return df.set_index(keys).loc[bad].reset_index() if len(bad) else df.head(0)


_STOP = {"golf", "club", "course", "links", "gl", "gc", "cc", "country", "the", "and", "resort", "g", "c"}


def _course_key(name):
    t = re.sub(r"[^a-z0-9 ]+", " ", str(name or "").lower().replace("&", " "))
    return " ".join(w for w in t.split() if w and w not in _STOP)


def same_course(a, b):
    """Do two course names mean the same course? (as the site's sameCourse)"""
    x, y = _course_key(a), _course_key(b)
    return bool(x and y) and (x == y or (min(len(x), len(y)) >= 5 and (x in y or y in x)))


def _num_text(v):
    if v is None or (isinstance(v, float) and v != v) or pd.isna(v):
        return None
    try:
        f = float(v)
        return str(int(f)) if f.is_integer() else str(f)
    except (TypeError, ValueError):
        return str(v).strip() or None


def course_groups(df) -> pd.Series:
    """Each row's map, as the site makes them (update 486): one per courseNum (a course that hosted two events has a map for
    each, on its own images), whatever its spellings; without a courseNum, one per course name. Returns a label per row:
    "{courseNum}_{name}"."""
    nums = df["courseNum"].map(_num_text) if "courseNum" in df.columns else pd.Series([None] * len(df), index=df.index)
    names = df["course"].astype(str).str.strip()
    pairs = list(dict.fromkeys(zip(nums, names)))
    up = list(range(len(pairs)))

    def find(i):
        while up[i] != i:
            up[i] = up[up[i]]
            i = up[i]
        return i
    for i, (ni, ai) in enumerate(pairs):
        for j in range(i):
            nj, aj = pairs[j]
            if (ni == nj) if ni else (not nj and same_course(ai, aj)):  # (update 486: a file per courseNum)
                up[find(i)] = find(j)
    counts = pd.Series(list(zip(nums, names))).value_counts()
    label = {}
    for root in set(find(i) for i in range(len(pairs))):
        members = [pairs[i] for i in range(len(pairs)) if find(i) == root]
        name = max(members, key=lambda p: counts.get(p, 0))[1]
        ns = sorted({n for n, _ in members if n}, key=lambda n: (0, float(n)) if re.fullmatch(r"\d+(\.\d+)?", n) else (1, n))
        for p in members:
            label[p] = f"{'-'.join(ns)}_{_slug(name)}" if ns else _slug(name)
    return pd.Series([label[p] for p in zip(nums, names)], index=df.index)


def split_by_course(data, out_dir: str = "course_files") -> list[str]:
    """
    Writes one Parquet per map to out_dir and returns their paths: one per courseNum, as the site makes its maps (update
    486), named "{courseNum}_{name}" (4_Torrey_Pines_Golf_Course_South_Course.parquet, 939_Torrey_Pines_...).
    """
    df = _load(data)
    cols = [c for c in COLUMNS if c in df.columns]
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    sort = [c for c in ["year", "round", "playerID", "player", "hole", "strokes"] if c in df.columns]
    for stem, part in df.groupby(course_groups(df), sort=False):
        part = part[cols].sort_values(sort)
        path = os.path.join(out_dir, f"{stem}.parquet")
        # whole numbers stay whole numbers (the site matches playerID and courseNum as text: 46046, not 46046.0)
        for c in ["year", "courseNum", "playerID", "round", "hole", "par", "strokes", "shot_for", "hole_out"]:
            if c in part.columns and pd.api.types.is_float_dtype(part[c]) and (part[c].dropna() % 1 == 0).all():
                part[c] = part[c].astype("Int64")
        part.to_parquet(path, index=False)
        mb = os.path.getsize(path) / 1e6
        print(f"{stem}: {len(part):,} shots, {part['playerID'].nunique() if 'playerID' in part.columns else '?'} players, {mb:.1f} MB")
        paths.append(path)
    return paths


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("python split_course_shots.py all_courses.parquet [out_dir]")
        raise SystemExit(1)
    check_shots(sys.argv[1])
    split_by_course(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "course_files")
