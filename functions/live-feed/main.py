"""(update 264) The Live Feed's fetcher: the PGA Tour API -> Firestore, for the portal's Live Feed page.

It runs the PGA_Live generator as it is (pga.py, build_data.py, checks.py, stats.json: drop newer copies of those four
in as they change). The generator works on a folder of JSON files (current.json, players.json, stats_meta.json and one
file per tour's current event, e.g. R/2026-528.json). Here that folder lives in Firestore:

  liveData/{path with / as __}           { path, hash, size, chunkCount, updatedAt }   e.g. liveData/R__2026-528.json
  liveData/{...}/chunks/{hash}_{i}       { data }   the file's text in pieces (a Firestore field holds under 1 MB)
  liveData/status                        { running, startedAt, finishedAt, ok, log }    the last run

Each run: the files are copied from Firestore into /tmp, the generator runs (fetching only what changed, as it does on
GitHub), and every file it writes is saved straight back (so a long first run keeps its progress), then files it
deleted are removed. A file's new pieces are written before it points at them, so the portal never reads half a file.

Who can start a run: Cloud Scheduler (the X-Feed-Key header, or ?key=, matching FEED_KEY), or a signed-in portal admin
(Firebase ID token; their uid in ADMIN_UIDS). See README.md for setting it up.
Env: PGA_API_TOKEN (a secret), or PGA_CLIENT_ID + PGA_CLIENT_SECRET | FEED_KEY | ADMIN_UIDS (comma separated) |
     FIREBASE_PROJECT_ID | TOURS (default "R,H") | CHECKS (default enforce)
"""
import contextlib
import hashlib
import importlib
import io
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import functions_framework

COL = "liveData"
OUT = Path(os.getenv("LIVE_TMP", "/tmp/live-feed-data"))
CHUNK = 600_000                       # characters a piece (well under Firestore's 1 MB a field, accents included)
STALE_LOCK_SECONDS = 20 * 60          # a run that never finished (timed out) stops blocking the next one after this

_db = None


def db():
    """Firestore (the project's own; set FIREBASE_PROJECT_ID when it isn't the function's project)."""
    global _db
    if _db is None:
        import firebase_admin
        from firebase_admin import firestore
        if not firebase_admin._apps:
            pid = os.getenv("FIREBASE_PROJECT_ID")
            firebase_admin.initialize_app(options={"projectId": pid} if pid else None)
        _db = firestore.client()
    return _db


def doc_id(rel: str) -> str:
    return rel.replace("/", "__")


def server_time():
    from firebase_admin import firestore
    return firestore.SERVER_TIMESTAMP


# ---------------------------------------------------------------- Firestore <-> the folder
def restore() -> dict:
    """Copy every saved file into OUT. Returns {path: hash} of what's saved."""
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    have = {}
    for d in db().collection(COL).stream():
        m = d.to_dict() or {}
        rel, h, n = m.get("path"), m.get("hash"), int(m.get("chunkCount") or 0)
        if not rel or not h:
            continue
        parts = []
        for i in range(n):
            c = d.reference.collection("chunks").document(f"{h}_{i}").get()
            if not c.exists:
                parts = None
                break
            parts.append((c.to_dict() or {}).get("data", ""))
        if parts is None:
            continue                  # (a file whose pieces are missing: fetched again)
        p = OUT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(parts), encoding="utf-8")
        have[rel] = h
    return have


def upload(path: Path, have: dict):
    """Save one file from OUT (only when it changed): new pieces first, then the file's entry, then old pieces away."""
    rel = path.relative_to(OUT).as_posix()
    text = path.read_text(encoding="utf-8")
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    if have.get(rel) == h:
        return
    ref = db().collection(COL).document(doc_id(rel))
    parts = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK)] or [""]
    for i, part in enumerate(parts):
        ref.collection("chunks").document(f"{h}_{i}").set({"data": part})
    ref.set({"path": rel, "hash": h, "size": len(text), "chunkCount": len(parts), "updatedAt": server_time()})
    for c in ref.collection("chunks").stream():
        if not c.id.startswith(f"{h}_"):
            c.reference.delete()
    have[rel] = h


def remove(rel: str):
    ref = db().collection(COL).document(doc_id(rel))
    for c in ref.collection("chunks").stream():
        c.reference.delete()
    ref.delete()


# ---------------------------------------------------------------- one run
def lock() -> bool:
    """Only one run at a time (the schedule and a Refresh now can overlap)."""
    from google.cloud import firestore as gfs
    ref = db().collection(COL).document("status")

    @gfs.transactional
    def take(tx):
        snap = ref.get(transaction=tx)
        s = snap.to_dict() if snap.exists else {}
        started = s.get("startedAt")
        if s.get("running") and started and (datetime.now(timezone.utc) - started).total_seconds() < STALE_LOCK_SECONDS:
            return False
        tx.set(ref, {"running": True, "startedAt": datetime.now(timezone.utc)}, merge=True)
        return True
    return take(db().transaction())


class Tee(io.TextIOBase):
    """The generator's printed log, kept (the last part goes in liveData/status) and still printed to Cloud Logging."""
    def __init__(self, out):
        self.out, self.buf = out, io.StringIO()

    def write(self, s):
        self.out.write(s)
        self.buf.write(s)
        return len(s)


def run_once() -> dict:
    t0 = time.time()
    if not lock():
        return {"ok": True, "skipped": "A run is already going."}
    ok, err = False, None
    log = Tee(sys.stdout)
    try:
        have = restore()
        os.environ["PGA_OUT_DIR"] = str(OUT)
        here = str(Path(__file__).resolve().parent)
        if here not in sys.path:
            sys.path.insert(0, here)
        import pga, checks, build_data  # noqa: E401
        for m in (pga, checks, build_data):        # a fresh start every run (the API cache, the run's notes, OUT)
            importlib.reload(m)
        orig = build_data.write

        def write_and_save(path, obj):             # every file the generator writes is saved at once
            orig(path, obj)
            try:
                upload(Path(path), have)
            except Exception as e:                 # (saved again at the end)
                print(f"  (couldn't save {path} yet: {e})", file=sys.stderr)
        build_data.write = write_and_save
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            build_data.main()
        # whatever is in the folder now is the feed: save the rest, drop what the generator deleted
        now = set()
        for p in OUT.rglob("*.json"):
            upload(p, have)
            now.add(p.relative_to(OUT).as_posix())
        for rel in [r for r in list(have) if r not in now]:
            remove(rel)
            have.pop(rel, None)
        ok = True
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        log.write(f"ERROR: {err}\n")             # (in the saved log too, and printed)
    finally:
        text = log.buf.getvalue()
        db().collection(COL).document("status").set({
            "running": False, "finishedAt": datetime.now(timezone.utc), "ok": ok, "error": err,
            "seconds": round(time.time() - t0, 1), "log": text[-8000:],
        }, merge=True)
    return {"ok": ok, "error": err, "seconds": round(time.time() - t0, 1)}


# ---------------------------------------------------------------- who may start it
def allowed(request) -> bool:
    key = os.getenv("FEED_KEY")
    given = request.headers.get("X-Feed-Key") or request.args.get("key")
    if key and given and given == key:
        return True
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            db()
            from firebase_admin import auth as fb_auth
            uid = fb_auth.verify_id_token(auth[7:])["uid"]
            return uid in {u.strip() for u in os.getenv("ADMIN_UIDS", "").split(",") if u.strip()}
        except Exception:
            return False
    return False


@functions_framework.http
def live_feed(request):
    cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Feed-Key",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
    if request.method == "OPTIONS":
        return ("", 204, cors)
    if not allowed(request):
        return (json.dumps({"ok": False, "error": "Not allowed"}), 401, {**cors, "Content-Type": "application/json"})
    out = run_once()
    return (json.dumps(out), 200 if out.get("ok") else 500, {**cors, "Content-Type": "application/json"})
