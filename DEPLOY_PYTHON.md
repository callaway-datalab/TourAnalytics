# Uploading data from Python (update 146)

Your Python code sends a DataFrame to the portal, and the portal updates itself. You don't need to open anything.
Uploading by hand on **Upload Data** still works exactly as before.

How it works (update 165): `python/tour_upload.py` does the heavy part on your computer, where there's no time
or memory limit. pandas splits the rows per player and saves them straight to the portal's database, exactly as
the Upload Data page would. Then it drops a small marker file in Cloud Storage (`incoming/_rebuild/`), and the
**data-import** function rebuilds the rankings and the lie / distance detail from the saved rows. Players see the
new data the next time they open or refresh the portal. A file with the same name as one already uploaded
replaces it.

(Before update 165 the whole file went to the cloud function, which had to read it in one go inside its
9 minutes and 2 GiB. A very big file couldn't finish, and the run was stopped without a word, so Upload Data said
"Reading the file" for ever. A file of a couple of million rows now takes a few minutes: about 20 seconds to
split, then the time your connection takes to send the rows, then a minute or two for the rankings.)

## Updating to update 165 (once)

1. Cloud Run → `data-import` → **Source** → **Edit source**: replace `index.js` with the new
   `functions/data-import/index.js` and click **Save and redeploy**.
2. Cloud Run → `data-import` → **Edit & deploy new revision** → set **Memory** to **4 GiB** (and keep the request
   timeout at 540 seconds). Deploy.
3. Replace your copy of `tour_upload.py` with the new `python/tour_upload.py`.

Your stuck upload from before: the next upload marks it as stopped and clears its leftover file out of
`incoming/`. (Upload Data already shows it as **Stopped**.) Then send the file again with the new script.

Do steps 1–4 once.

## 1. Firestore rules (changed in this update)

Firebase console → **Databases & Storage → Firestore → Rules**. Paste the whole of `firestore.rules`, put your
admin UID back into `adminUids()`, and click **Publish**. (New: `imports`, so Upload Data can show your Python
uploads.)

## 2. The data-import function

1. Google Cloud console (project `touranalytics-dd46e`) → **Cloud Run** → **Write a function**.
2. Service name `data-import`, runtime **Node.js 22**. For the region, use the same region as your Storage bucket.
   You can see it in Firebase → Storage → Files, next to the bucket name, or in Cloud Storage → Buckets → Location.
3. Under **Trigger**, click **Add trigger** → **Cloud Storage trigger**:
   - Event type: `google.cloud.storage.object.v1.finalized`
   - Bucket: `touranalytics-dd46e.firebasestorage.app`
   - If the console offers to grant the roles the trigger needs, click **Grant**.
4. Open **Containers / Settings** and set **Memory** to **2 GiB** and **Request timeout** to **540** seconds.
   (For data over a few million rows, use **4 GiB**.) Under **Revision scaling**, set **Maximum number of instances** to **1** (uploads are then processed one at a time).
5. Click **Create**. In the source editor that opens, replace `index.js` and `package.json` with the two files in
   `functions/data-import/`. Set **Function entry point** to `dataImport`, then click **Save and redeploy**.
   (Only `index.js` and `package.json` go in. `src.js` and `build.sh` stay in the repo.)
6. Permissions: Cloud Run → `data-import` → **Security** shows its service account. Go to IAM & Admin →
   **IAM** → **Grant access** → enter that account and add two roles: **Cloud Datastore User** and
   **Storage Object Admin**. Click Save. (Skip this if that account already has **Editor**.)

## 3. Your service account key (for Python)

Firebase console → ⚙ **Project settings** → **Service accounts** → **Generate new private key**.
It downloads a .json file. Rename it `touranalytics-key.json` and move it to your **home folder**
(`C:\Users\<you>\` on Windows, `/Users/<you>/` on a Mac). That's where `tour_upload.py` looks by default.
If you'd rather keep it somewhere else, pass `key_path="..."` or set the environment variable
`TOUR_ANALYTICS_KEY` to its path.

**Keep this key private, and keep it out of your code.** Don't paste its contents into a script or put the file
in your codebase or any git repo: it can read and change everything in the project. If it ever leaks,
delete the key on that same page and generate a new one.

## 4. Python

```
pip install firebase-admin pandas pyarrow
```

Add `python/tour_upload.py` to your codebase as its own module (a file next to your other modules).

## Using it

```python
from tour_upload import upload_dataframe

# df: the same columns as a file you'd upload by hand (player, playerID, year, date, tournament, round,
#     category, distance, lie, stat, stat value, attempts, tour ...)
upload_dataframe(df, "strokes_gained_2026", description="Weekly ShotLink pull")
```

Nothing is saved to disk. It prints each step as it goes, e.g.

```
Uploading "strokes_gained_2026" (1,800,000 rows)...
  Splitting the rows per player on this computer
  Saving 1,512 players' rows (229 MB)
  Saving 1,512 players' rows: 64%
Rows live: "strokes_gained_2026", 1,800,000 rows for 1,512 players.
  Updating rankings...
Live: "strokes_gained_2026", 1,800,000 rows for 1,512 players. Rankings updated.
```

The rows are live (players see them) as soon as "Rows live" prints; the rankings follow a minute or two later.
`mode="cloud"` sends the whole file to the cloud function the old way (small files only).

It prints its progress and finishes with something like
`Live: "strokes_gained_2026", 412,880 rows for 186 players.` If something's wrong with the data (no
`playerID` column, say), it raises an error that explains the problem, and nothing in the portal changes.

Options: `id_column="playerID"` (the column that says who each row belongs to), and `wait=False` (send the file and
return straight away without waiting). To send a file you already have:
`upload_file("path/to/file.parquet")` (it takes .csv, .csv.gz or .parquet), or from a terminal run
`python tour_upload.py file.csv "name in the portal"`.

You'll also see each Python upload on **Upload Data → From Python** (Live, Working… or Failed with the reason).
Files sent from Python are tagged **Python** in the list of uploaded files.

## Limits and cost

- The cloud function only rebuilds the rankings now (a couple of million rows takes about a minute of its 9).
  If it ever stops for time or memory, Upload Data shows it as **Stopped**; the rows are still live, and opening
  Analyze on a computer rebuilds the rankings. A file over 40 MB sent the old way (`mode="cloud"`, or an older
  `tour_upload.py`) is turned away with a message saying to use the new script.
- The cost should stay within the free monthly allowances: a few invocations a week, each a minute or two.
  The function also starts briefly whenever anything else is saved to the bucket (the detail files). It
  ignores those and returns straight away.
- If the budget pause is on, the rows and rankings are still updated. The lie / distance detail is
  rebuilt the next time you open Analyze on a computer after resuming.

## When the portal code changes

`functions/data-import/index.js` is built from `src.js` plus the portal's `js/data.js`, `js/sg.js` and
`js/fieldDetail.js`, so the function processes files exactly as the Upload Data page does. When an
update changes any of those files, the update notes will say so. Paste the new `index.js` into the function again
(Cloud Run → data-import → **Source** → **Edit source** → **Save and redeploy**).
