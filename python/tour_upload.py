"""
tour_upload.py - send data to the Tour Analytics portal straight from Python (update 146; fast path update 165).

    from tour_upload import upload_dataframe
    upload_dataframe(df, "strokes_gained_2026")

How it works (update 165): the heavy part happens on your computer, where there's no time or memory limit.
pandas splits the rows per player and saves them straight to the portal's database, in exactly the form the
Upload Data page saves them. Then the data-import function (Cloud Run) rebuilds the rankings and the lie /
distance detail from those saved rows. That's a much smaller job than reading the whole file, so a file with
millions of rows goes through in minutes. Before update 165 the cloud function read the whole file in one go,
which a very big file can't finish inside its 9 minutes and 2 GiB.

Using the same name as a file that's already uploaded replaces it, just like uploading it by hand. Uploading
by hand still works as before.

Setup (once): pip install firebase-admin pandas pyarrow
and the service account key from Firebase (see DEPLOY_PYTHON.md), saved in your home folder as
touranalytics-key.json (or anywhere, with its path in the TOUR_ANALYTICS_KEY environment variable, or passed
as key_path=). Keep that key out of your code and out of any git repo.
"""
import datetime as _dt
import gzip
import io
import json
import math
import os
import re
import time
import urllib.parse

import firebase_admin
from firebase_admin import credentials, firestore, storage

BUCKET = "touranalytics-dd46e.firebasestorage.app"
DEFAULT_KEY = os.path.join(os.path.expanduser("~"), "touranalytics-key.json")
MAX_CHUNK_CHARS = 300000  # as js/data.js: JSON characters per stored piece (Firestore documents hold ~1 MiB)
STALE_SECONDS = 12 * 60   # a cloud step with no heartbeat for this long has been stopped

_app = None


def _connect(key_path=None):
    global _app
    if _app is None:
        key = key_path or os.environ.get("TOUR_ANALYTICS_KEY") or DEFAULT_KEY
        if not os.path.exists(key):
            raise FileNotFoundError(
                f"No service account key at {key}. Download it from the Firebase console "
                "(Project settings > Service accounts > Generate new private key) and save it there, "
                "or pass key_path=... / set the TOUR_ANALYTICS_KEY environment variable to where it is."
            )
        _app = firebase_admin.initialize_app(credentials.Certificate(key), {"storageBucket": BUCKET}, name="tour-upload")
    return _app


def _safe(name):
    return re.sub(r"[^A-Za-z0-9 ._()-]+", "_", name).strip() or "data"


def _say(msg, t0=None):
    print(f"  {msg}" + (f"  ({time.time() - t0:.0f}s)" if t0 else ""), flush=True)


# --------------------------------------------------------------------------------------------------------------
# The upload
# --------------------------------------------------------------------------------------------------------------

def upload_dataframe(df, name, description="", id_column="playerID", wait=True, timeout=1800, key_path=None, mode="direct", fmt=None):
    """Upload a pandas DataFrame as the data file `name` (the same name replaces that file).

    df           the data, with the same columns as a file you'd upload by hand
    name         the file's name in the portal (what Upload Data shows)
    description  optional short description
    id_column    the column that says who each row belongs to (default playerID)
    wait         wait until the rankings are updated too and print the result (default True; the rows are
                 live as soon as they're saved either way)
    key_path     where the service account key is (default: ~/touranalytics-key.json, or TOUR_ANALYTICS_KEY)
    mode         "direct" (default): split and save the rows from here, then the cloud rebuilds the rankings.
                 "cloud": the old way, the whole file sent to the cloud function (small files only).
    Returns the import's result (rows, people, ...); raises RuntimeError if something failed.
    """
    if id_column not in df.columns:
        raise ValueError(f'The DataFrame has no "{id_column}" column. Columns: {", ".join(map(str, df.columns))}')
    if not str(name).strip():
        raise ValueError("Give the file a name.")
    if mode == "cloud":
        return _upload_to_cloud(df, name, description, id_column, wait, timeout, key_path, fmt)
    return _upload_direct(df, str(name).strip(), description or "", id_column, wait, timeout, key_path)


def upload_file(path, name=None, description="", id_column="playerID", wait=True, timeout=1800, key_path=None, mode="direct"):
    """Upload a .csv, .csv.gz or .parquet file you already have (name defaults to the file name)."""
    import pandas as pd

    base = os.path.basename(path)
    lower = base.lower()
    if not (lower.endswith(".csv") or lower.endswith(".csv.gz") or lower.endswith(".parquet")):
        raise ValueError("Files must be .csv, .csv.gz or .parquet")
    name = name or re.sub(r"\.(csv\.gz|csv|parquet)$", "", base, flags=re.I)
    print(f'Reading {base}...', flush=True)
    t0 = time.time()
    if lower.endswith(".parquet"):
        df = pd.read_parquet(path)
    else:
        # (every column as text first, exactly as the portal reads a CSV; types are worked out the same way it does)
        df = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[], compression="infer")
    _say(f"{len(df):,} rows, {len(df.columns)} columns", t0)
    return upload_dataframe(df, name, description, id_column, wait, timeout, key_path, mode)


# --------------------------------------------------------------------------------------------------------------
# Direct: the rows split and saved from here (update 165)
# --------------------------------------------------------------------------------------------------------------

_NUM_RE = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")
_DATE_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$")
_NAME_COLUMNS = {"player", "playername", "name", "golfer", "fullname", "playerfullname"}


def _num(v):
    """A number as the portal stores it (5.0 -> 5)."""
    if isinstance(v, bool):
        return v
    f = float(v)
    if math.isnan(f) or math.isinf(f):
        return None
    return int(f) if f.is_integer() and abs(f) < 2 ** 53 else f


def _js_str(v):
    """A value as text, as JavaScript's String() writes it (5.0 -> "5", True -> "true")."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() and abs(v) < 2 ** 53 else repr(v)
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()
    return str(v)


def _blank(v):
    """Empty, as the portal reads it: missing, NaN, or only spaces."""
    if v is None:
        return True
    if isinstance(v, float):
        return v != v
    if isinstance(v, str):
        return not v.strip()
    try:
        import pandas as pd
        return v is pd.NA or v is pd.NaT or (hasattr(v, "dtype") and bool(pd.isna(v)))
    except (TypeError, ValueError):
        return False


def _converter(series):
    """(type, values) for a whole column, worked out exactly as js/data.js inferColumn does for the Upload Data page."""
    import numpy as np
    import pandas as pd
    from pandas.api import types as pt

    s = series
    if pt.is_bool_dtype(s.dtype) and not s.isna().any():
        return "text", ["true" if v else "false" for v in s.tolist()]
    if pt.is_numeric_dtype(s.dtype) and not pt.is_bool_dtype(s.dtype):
        arr = s.to_numpy(dtype=float, na_value=np.nan).tolist()
        if all(x != x for x in arr):
            return "text", [None] * len(arr)
        return "number", [None if (x != x or x in (math.inf, -math.inf)) else (int(x) if x.is_integer() and abs(x) < 2 ** 53 else x) for x in arr]
    if pt.is_datetime64_any_dtype(s.dtype):
        present = s.dropna()
        if not len(present):
            return "text", [None] * len(s)
        with_time = bool(((present.dt.hour != 0) | (present.dt.minute != 0)).any())
        out = s.dt.strftime("%Y-%m-%d %H:%M" if with_time else "%Y-%m-%d")
        return "date", [None if _blank(v) else v for v in out.tolist()]
    # text, or values of mixed kinds
    vals = s.tolist()
    present = [v for v in vals if not _blank(v)]
    if not present:
        return "text", [None] * len(vals)
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
        return "number", [None if _blank(v) else _num(v) for v in vals]
    if all(isinstance(v, (_dt.date, pd.Timestamp)) or (isinstance(v, str) and _DATE_RE.match(v.strip())) for v in present):
        def parts(v):
            if isinstance(v, (_dt.datetime, pd.Timestamp)):
                return v.year, v.month, v.day, v.hour, v.minute
            if isinstance(v, _dt.date):
                return v.year, v.month, v.day, None, None
            m = _DATE_RE.match(v.strip())
            return int(m[1]), int(m[2]), int(m[3]), (int(m[4]) if m[4] is not None else None), (int(m[5]) if m[5] is not None else None)
        memo = {}

        def day(v):
            if _blank(v):
                return None
            k = v if isinstance(v, str) else repr(v)
            if k not in memo:
                memo[k] = parts(v)
            return memo[k]
        ps = [day(v) for v in vals]
        with_time = any(p is not None and p[3] is not None and (p[3] != 0 or (p[4] or 0) != 0) for p in ps)
        fmt = (lambda p: f"{p[0]}-{p[1]:02d}-{p[2]:02d} {(p[3] or 0):02d}:{(p[4] or 0):02d}") if with_time else (lambda p: f"{p[0]}-{p[1]:02d}-{p[2]:02d}")
        return "date", [None if p is None else fmt(p) for p in ps]
    uniq = set(v.strip() for v in present if isinstance(v, str)) if all(isinstance(v, str) for v in present) else None
    if uniq is not None and all(_NUM_RE.match(v) and not re.match(r"^[+-]?0\d", v) for v in uniq):
        cache = {}
        def n(v):
            if _blank(v):
                return None
            t = v.strip()
            if t not in cache:
                cache[t] = _num(float(t))
            return cache[t]
        return "number", [n(v) for v in vals]
    return "text", [None if _blank(v) else (v if isinstance(v, str) else _js_str(v)) for v in vals]


def _id_string(v):
    """A row's player ID as the portal reads it (numbers as written; text trimmed and lower-cased)."""
    if _blank(v):
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)) or type(v).__module__ == "numpy":
        x = _num(v)
        return "" if x is None else _js_str(x)
    return str(v).strip().lower()


def client_key(label):
    """The portal's key for a player ID (as js/data.js clientKey): "10231" -> "c_10231"."""
    n = str(label or "").strip().lower()
    if not n:
        return ""
    return "c_" + urllib.parse.quote(n, safe="-_.!~*'()").replace(".", "%2E")


_DUMPS = json.JSONEncoder(separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode


def _vkey(v):
    return ("n",) if v is None else (type(v).__name__, v)


def pack_rows(rows):
    """(update 193) One stored piece, packed as js/data.js packRows: each column once, and a column whose
    values repeat as its distinct values plus each row's place in that list."""
    w = max((len(r) for r in rows), default=0)
    cols = []
    for c in range(w):
        vals = [r[c] if c < len(r) else None for r in rows]
        raw = _DUMPS(vals)
        pos, uniq, idx = {}, [], []
        for v in vals:
            k = _vkey(v)
            i = pos.get(k)
            if i is None:
                i = pos[k] = len(uniq)
                uniq.append(v)
            idx.append(i)
        d = '{"d":' + _DUMPS(uniq) + ',"i":' + _DUMPS(idx) + "}"
        cols.append(d if len(d) < len(raw) else raw)
    return '{"v":2,"n":%d,"w":%d,"c":[%s]}' % (len(rows), w, ",".join(cols))


def chunk_rows(rows, max_chars=MAX_CHUNK_CHARS):
    """Rows (lists) into stored pieces, as js/data.js chunkRows."""
    chunks = []

    def emit(run):
        if not run:
            return
        s = pack_rows(run)
        if len(s) <= max_chars or len(run) == 1:
            chunks.append(s)
            return
        h = (len(run) + 1) // 2
        emit(run[:h])
        emit(run[h:])

    run, size, budget = [], 0, max_chars * 3
    for r in rows:
        n = len(_DUMPS(r))
        if n + 2 > 800000:
            raise ValueError("One row in this file is too large to store.")
        if run and size + n + 1 > budget:
            emit(run)
            run, size = [], 0
        run.append(r)
        size += n + 1
    emit(run)
    if not chunks:
        chunks.append(pack_rows([]))
    return chunks


def build_dataset(df, id_column="playerID", progress=None):
    """The DataFrame split per player, as the Upload Data page splits a file (js/data.js buildDataset)."""
    columns = [str(c) for c in df.columns]
    id_i = columns.index(id_column) if id_column in columns else next((i for i, c in enumerate(columns) if c.strip().lower() == id_column.strip().lower()), -1)
    if id_i < 0:
        raise ValueError(f'There\'s no column named "{id_column}". Columns: {", ".join(columns[:25])}')
    if not len(df):
        raise ValueError("That data has no rows.")
    data_idx = [i for i in range(len(columns)) if i != id_i]
    cols, values = [], []
    for i in data_idx:  # (a whole column at a time)
        t, vals = _converter(df.iloc[:, i])
        cols.append({"name": columns[i], "type": t})
        values.append(vals)
    squash = lambda c: re.sub(r"[^a-z0-9]", "", str(c).lower())  # noqa: E731
    name_pos = next((k for k, i in enumerate(data_idx) if squash(columns[i]) in _NAME_COLUMNS), None)
    if progress:
        progress("Columns read")
    rows_all = [list(r) for r in zip(*values)]  # each row as the portal stores it
    names = values[name_pos] if name_pos is not None else None
    ids = df.iloc[:, id_i].tolist()
    del values
    groups, order, blank = {}, [], 0
    for pos, raw in enumerate(ids):  # (players in the order they first appear, rows in file order)
        k = _id_string(raw)
        if not k:
            blank += 1
            continue
        g = groups.get(k)
        if g is None:
            groups[k] = g = []
            order.append(k)
        g.append(pos)
    if not groups:
        raise ValueError(f'Every value in "{columns[id_i]}" is blank, so no row can be matched to a person.')
    players = []
    for k in order:
        pos = groups[k]
        name = next((str(names[p]).strip() for p in pos if names is not None and not _blank(names[p])), None) if names is not None else None
        players.append({"key": client_key(k), "label": k, "name": name, "rows": len(pos), "chunks": chunk_rows([rows_all[p] for p in pos])})
    return {"idColumn": columns[id_i], "columns": cols, "players": players, "rowCount": len(df), "blankIdRows": blank}


def _writer(db):
    """Firestore's BulkWriter (many writes in parallel) when this version has it, else plain batches."""
    if hasattr(db, "bulk_writer"):
        bw = db.bulk_writer()
        return bw.set, bw.delete, bw.close
    state = {"batch": db.batch(), "n": 0, "bytes": 0}

    def flush():
        if state["n"]:
            state["batch"].commit()
        state.update(batch=db.batch(), n=0, bytes=0)

    def add(kind, ref, data=None):
        size = len(json.dumps(data, default=str)) if data is not None else 100
        if state["n"] and (state["n"] >= 400 or state["bytes"] + size > 8_000_000):
            flush()
        (state["batch"].set(ref, data) if kind == "set" else state["batch"].delete(ref))
        state["n"] += 1
        state["bytes"] += size
    return (lambda ref, data: add("set", ref, data)), (lambda ref: add("delete", ref)), flush


def _upload_direct(df, name, description, id_column, wait, timeout, key_path):
    app = _connect(key_path)
    db = firestore.client(app=app)
    t0 = time.time()
    status_id = f"py_{int(time.time() * 1000)}"
    status = db.collection("imports").document(status_id)

    def step(text, **more):
        status.set({"step": text, "updatedAt": firestore.SERVER_TIMESTAMP, **more}, merge=True)
        _say(text, t0)

    print(f'Uploading "{name}" ({len(df):,} rows)...', flush=True)
    _tidy_stuck(db, app)
    status.set({"file": f"{name} (from Python)", "name": name, "status": "running", "source": "python",
                "startedAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP})
    try:
        step("Splitting the rows per player on this computer")
        ds = build_dataset(df, id_column, progress=lambda m: _say(m, t0))
        people = len(ds["players"])
        stored = sum(len(c) for p in ds["players"] for c in p["chunks"])
        step(f"Saving {people:,} players' rows ({stored / 1e6:.0f} MB)", rows=ds["rowCount"], people=people)

        existing = list(db.collection("datasets").where("name", "==", name).limit(1).stream())
        dataset_id = existing[0].id if existing else db.collection("datasets").document().id
        old = existing[0].to_dict() if existing else {}
        old_keys = old.get("clientKeys") or []

        set_doc, delete_doc, close = _writer(db)
        done_docs, total_docs, last = 0, sum(len(p["chunks"]) for p in ds["players"]), time.time()
        # the pieces first, then each player's record, then the file's own record: nobody sees a half-saved file
        for p in ds["players"]:
            base = db.collection("clientData").document(p["key"]).collection("datasets").document(dataset_id)
            for i, data in enumerate(p["chunks"]):
                set_doc(base.collection("chunks").document(str(i)), {"data": data})
                done_docs += 1
            if time.time() - last > 20:
                last = time.time()
                step(f"Saving {people:,} players' rows: {round(100 * done_docs / max(1, total_docs))}%")
        close()
        set_doc, delete_doc, close = _writer(db)
        for p in ds["players"]:
            set_doc(db.collection("clientData").document(p["key"]).collection("datasets").document(dataset_id), {
                "name": name, "description": description, "idColumn": ds["idColumn"], "columns": ds["columns"],
                "clientLabel": p["label"], "playerName": p["name"], "rowCount": p["rows"], "chunkCount": len(p["chunks"]),
                "uploadedAt": firestore.SERVER_TIMESTAMP})
        close()
        new_keys = [p["key"] for p in ds["players"]]
        db.collection("datasets").document(dataset_id).set({
            "storedBytes": stored, "name": name, "description": description, "idColumn": ds["idColumn"], "columns": ds["columns"],
            "rowCount": ds["rowCount"], "blankIdRows": ds["blankIdRows"], "clientKeys": new_keys,
            "playerNames": {p["key"]: p["name"] for p in ds["players"] if p["name"]},
            "uploadedAt": firestore.SERVER_TIMESTAMP, "source": "python"})
        # a replaced file: the old pieces past each player's new count, and players no longer in it
        if old_keys:
            step("Clearing the old copy's leftovers")
            counts = {p["key"]: len(p["chunks"]) for p in ds["players"]}
            set_doc, delete_doc, close = _writer(db)
            for i in range(0, len(old_keys), 300):
                refs = [db.collection("clientData").document(k).collection("datasets").document(dataset_id) for k in old_keys[i:i + 300]]
                for snap in db.get_all(refs):
                    if not snap.exists:
                        continue
                    key = snap.reference.parent.parent.id
                    had = (snap.to_dict() or {}).get("chunkCount") or 0
                    keep = counts.get(key, 0)
                    for j in range(keep, had):
                        delete_doc(snap.reference.collection("chunks").document(str(j)))
                    if key not in counts:
                        delete_doc(snap.reference)
            close()
        live = {"datasetId": dataset_id, "rows": ds["rowCount"], "people": people, "blankIdRows": ds["blankIdRows"]}
        extra = f" ({ds['blankIdRows']:,} rows had no ID and won't show)" if ds["blankIdRows"] else ""
        print(f'Rows live: "{name}", {ds["rowCount"]:,} rows for {people:,} players{extra}. ({time.time() - t0:.0f}s)', flush=True)

        # the rankings and lie / distance detail: rebuilt in the cloud from the rows just saved
        step("Updating rankings", **live)
        blob = storage.bucket(app=app).blob(f"incoming/_rebuild/{dataset_id}.json")
        blob.metadata = {"kind": "rebuild", "datasetId": dataset_id, "statusId": status_id, "name": name}
        blob.upload_from_string(json.dumps({"datasetId": dataset_id}), content_type="application/json")
    except Exception as err:
        status.set({"status": "error", "step": None, "message": str(err), "finishedAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
        raise
    if not wait:
        return {"status": "rows live", **live}
    try:
        return {**live, **wait_for(status_id, timeout=timeout, key_path=key_path, marker_generation=blob.generation)}
    except RuntimeError as err:
        print(f"The rows are live, but: {err}", flush=True)
        return {"status": "rows live, rankings not rebuilt", "message": str(err), **live}


def _tidy_stuck(db, app):
    """Uploads left "running" by an earlier version (stopped for time or memory) are marked as stopped, and their
    leftover files cleared out of incoming/."""
    try:
        now = time.time()
        for snap in db.collection("imports").where("status", "==", "running").stream():
            d = snap.to_dict() or {}
            when = d.get("updatedAt") or d.get("startedAt")
            ts = when.timestamp() if hasattr(when, "timestamp") else 0
            if now - ts > 30 * 60:
                snap.reference.set({"status": "error", "step": None, "finishedAt": firestore.SERVER_TIMESTAMP,
                                    "message": "Stopped: the cloud ran out of time or memory reading a file this big. Send it again with tour_upload.py (update 165 or later)."}, merge=True)
        for b in storage.bucket(app=app).list_blobs(prefix="incoming/"):
            made = b.time_created.timestamp() if b.time_created else now
            if now - made > 60 * 60:
                b.delete()
    except Exception as err:  # (tidying is a nicety)
        print(f"  (couldn't tidy earlier uploads: {err})", flush=True)


# --------------------------------------------------------------------------------------------------------------
# The cloud way (before update 165): the whole file to the data-import function. Small files only.
# --------------------------------------------------------------------------------------------------------------

def _upload_to_cloud(df, name, description, id_column, wait, timeout, key_path, fmt):
    try:
        if fmt == "csv":
            raise ImportError
        import pyarrow  # noqa: F401  (pandas' Parquet writer)
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        data, ext, ctype = buf.getvalue(), ".parquet", "application/octet-stream"
    except ImportError:
        data, ext, ctype = gzip.compress(df.to_csv(index=False).encode("utf-8")), ".csv.gz", "application/gzip"
    app = _connect(key_path)
    blob = storage.bucket(app=app).blob(f"incoming/{_safe(name)}{ext}")
    blob.metadata = {"name": str(name).strip(), "description": description or "", "idColumn": id_column}
    print(f'Uploading "{name}" ({len(df):,} rows as {ext.lstrip(".")}, {len(data) / 1e6:.1f} MB)...')
    blob.upload_from_string(data, content_type=ctype, timeout=600)
    print("Uploaded. The portal is updating it now.")
    if not wait:
        return {"status": "uploaded", "generation": blob.generation}
    return wait_for(blob.generation, timeout=timeout, key_path=key_path)


def wait_for(status_id, timeout=1800, key_path=None, marker_generation=None):
    """Wait for an upload (or its rankings) to finish, printing each step. Raises RuntimeError if it failed or was
    stopped (no heartbeat for 12 minutes: the cloud ran out of time or memory)."""
    app = _connect(key_path)
    db = firestore.client(app=app)
    ref = db.collection("imports").document(str(status_id))
    marker = db.collection("imports").document(str(marker_generation)) if marker_generation else None
    start, last = time.time(), None
    while time.time() - start < timeout:
        snap = ref.get()
        d = snap.to_dict() if snap.exists else None
        if d:
            if d.get("status") == "done":
                extra = f" ({d['blankIdRows']:,} rows had no ID and won't show)" if d.get("blankIdRows") else ""
                print(f'Live: "{d.get("name")}", {d.get("rows", 0):,} rows for {d.get("people", 0):,} players{extra}. Rankings updated.', flush=True)
                return d
            if d.get("status") == "error":
                raise RuntimeError(f'The portal couldn\'t finish "{d.get("name")}": {d.get("message")}')
            if d.get("step") and d.get("step") != last:
                last = d["step"]
                print(f"  {last}...", flush=True)
            when = d.get("updatedAt")
            if hasattr(when, "timestamp") and time.time() - when.timestamp() > STALE_SECONDS:
                raise RuntimeError("the cloud step stopped (no progress for 12 minutes: it ran out of time or memory). "
                                   "Give the data-import function 4 GiB of memory, or open Analyze on a computer to rebuild the rankings.")
        if marker is not None:
            m = marker.get()
            md = m.to_dict() if m.exists else None
            if md and md.get("status") == "error":
                raise RuntimeError("the data-import function in the cloud is an older version that doesn't know this step. "
                                   "Paste functions/data-import/index.js from update 165 into it (see DEPLOY_PYTHON.md), "
                                   "or open Analyze on a computer to rebuild the rankings.")
        time.sleep(3)
    print("Still working. It'll finish on its own: check Upload Data in the portal.", flush=True)
    return {"status": "waiting", "statusId": status_id}


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python tour_upload.py <file.csv|file.parquet> [name]")
        sys.exit(1)
    upload_file(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
