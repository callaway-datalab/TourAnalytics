"""
tour_upload.py - send data to the Tour Analytics portal straight from Python (update 146).

    from tour_upload import upload_dataframe
    upload_dataframe(df, "strokes_gained_2026")

The file goes to Cloud Storage (incoming/), the data-import function picks it up and does what the portal's
Upload Data page does (splits it per player, updates the rankings and the lie / distance detail), and the
portal shows it the next time anyone opens or refreshes it. Using the same name as a file that's already
uploaded replaces it, just like uploading it by hand. Uploading by hand still works as before.

Setup (once): pip install firebase-admin pandas pyarrow
and the service account key from Firebase (see DEPLOY_PYTHON.md), saved in your home folder as
touranalytics-key.json (or anywhere, with its path in the TOUR_ANALYTICS_KEY environment variable, or passed
as key_path=). Keep that key out of your code and out of any git repo.
"""
import gzip
import io
import os
import re
import time

import firebase_admin
from firebase_admin import credentials, firestore, storage

BUCKET = "touranalytics-dd46e.firebasestorage.app"
DEFAULT_KEY = os.path.join(os.path.expanduser("~"), "touranalytics-key.json")

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


def upload_dataframe(df, name, description="", id_column="playerID", wait=True, timeout=900, key_path=None, fmt=None):
    """Upload a pandas DataFrame as the data file `name` (the same name replaces that file).

    df           the data, with the same columns as a file you'd upload by hand
    name         the file's name in the portal (what Upload Data shows)
    description  optional short description
    id_column    the column that says who each row belongs to (default playerID)
    wait         wait until the portal is updated and print the result (default True)
    key_path     where the service account key is (default: ~/touranalytics-key.json, or TOUR_ANALYTICS_KEY)
    Nothing is saved to disk: the DataFrame is packed as Parquet in memory (much smaller and quicker for big
    data; needs pyarrow), or as gzipped CSV if pyarrow isn't installed.
    fmt          "parquet" or "csv" to choose the format yourself (default: Parquet when pyarrow is installed)
    Returns the import's result (rows, people, ...) when waiting; raises RuntimeError if the import failed.
    """
    if id_column not in df.columns:
        raise ValueError(f'The DataFrame has no "{id_column}" column. Columns: {", ".join(map(str, df.columns))}')
    if not str(name).strip():
        raise ValueError("Give the file a name.")
    try:
        if fmt == "csv":
            raise ImportError
        import pyarrow  # noqa: F401  (pandas' Parquet writer)
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        data, ext, ctype = buf.getvalue(), ".parquet", "application/octet-stream"
    except ImportError:
        data, ext, ctype = gzip.compress(df.to_csv(index=False).encode("utf-8")), ".csv.gz", "application/gzip"
    return _send(data, f"{_safe(name)}{ext}", ctype, name, description, id_column, wait, timeout, key_path,
                 note=f"{len(df):,} rows as {ext.lstrip('.')}")


def upload_file(path, name=None, description="", id_column="playerID", wait=True, timeout=900, key_path=None):
    """Upload a .csv, .csv.gz or .parquet file you already have (name defaults to the file name)."""
    base = os.path.basename(path)
    lower = base.lower()
    ext = ".csv.gz" if lower.endswith(".csv.gz") else os.path.splitext(lower)[1]
    if ext not in (".csv", ".csv.gz", ".parquet"):
        raise ValueError("Files must be .csv, .csv.gz or .parquet")
    name = name or re.sub(r"\.(csv\.gz|csv|parquet)$", "", base, flags=re.I)
    with open(path, "rb") as f:
        data = f.read()
    if ext == ".csv":  # (smaller to send)
        data, ext = gzip.compress(data), ".csv.gz"
    ctype = "application/octet-stream" if ext == ".parquet" else "application/gzip"
    return _send(data, f"{_safe(name)}{ext}", ctype, name, description, id_column, wait, timeout, key_path, note=base)


def _send(data, object_name, content_type, name, description, id_column, wait, timeout, key_path, note=""):
    app = _connect(key_path)
    blob = storage.bucket(app=app).blob(f"incoming/{object_name}")
    blob.metadata = {"name": str(name).strip(), "description": description or "", "idColumn": id_column}
    print(f'Uploading "{name}" ({note}, {len(data) / 1e6:.1f} MB)...')
    blob.upload_from_string(data, content_type=content_type, timeout=600)
    gen = blob.generation
    print("Uploaded. The portal is updating it now.")
    if not wait:
        return {"status": "uploaded", "generation": gen}
    return wait_for(gen, timeout=timeout, key_path=key_path)


def wait_for(generation, timeout=900, key_path=None):
    """Wait for an upload to go live (or fail), printing each step."""
    app = _connect(key_path)
    ref = firestore.client(app=app).collection("imports").document(str(generation))
    start, last = time.time(), None
    while time.time() - start < timeout:
        snap = ref.get()
        d = snap.to_dict() if snap.exists else None
        if d:
            if d.get("status") == "done":
                extra = f" ({d['blankIdRows']:,} rows had no ID and won't show)" if d.get("blankIdRows") else ""
                print(f'Live: "{d.get("name")}", {d.get("rows", 0):,} rows for {d.get("people", 0):,} players{extra}.')
                return d
            if d.get("status") == "error":
                raise RuntimeError(f'The portal couldn\'t use "{d.get("name")}": {d.get("message")}')
            if d.get("step") and d.get("step") != last:
                last = d["step"]
                print(f"  {last}...")
        time.sleep(3)
    print("Still working. It'll finish on its own: check Upload Data in the portal.")
    return {"status": "waiting", "generation": generation}


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python tour_upload.py <file.csv|file.parquet> [name]")
        sys.exit(1)
    upload_file(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
