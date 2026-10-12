# Blaze setup: lie / distance detail, the budget pause and the course lookup

Update 128 saves the field's per-round lie / distance detail to Cloud Storage
(`fieldDetail/{dataset}/{year}.bin.gz`), so phones, players' own portals and their
AI Insights reports can rank by lie and distance without loading every player's rows.
A small budget function switches those downloads off if the month's budget is reached.

Do these once, in this order. Steps 1–2c are needed for the detail; step 3 is the safety net.

## 1. Firestore rules (changed in this update)

Firebase console → **Databases & Storage → Firestore → Rules**. Paste the whole of
`firestore.rules`, put your admin UID back into `adminUids()`, and click **Publish**.
(New: `config/billing`, the budget pause switch.)

## 2. Storage rules (new)

Firebase console → **Databases & Storage → Storage → Rules**. Paste the whole of
`storage.rules`, put the **same** admin UID into its `adminUids()`, and click **Publish**.
The console asks to let Storage rules read Firestore (they check the budget pause): click **Grant**.

## 2b. Let the site download from the bucket (CORS)

Browsers only download files from Cloud Storage into a web page when the bucket allows it. Without this,
phones show "Couldn't load the lie and distance detail". Once per bucket:

1. Google Cloud console (project touranalytics-dd46e) → the **Activate Cloud Shell** icon (`>_`) at the top right.
2. Paste and press Enter (click **Authorize** if asked):

   ```
   echo '[{"origin":["*"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gcloud storage buckets update gs://touranalytics-dd46e.firebasestorage.app --cors-file=cors.json
   ```

3. Optional check: `gcloud storage buckets describe gs://touranalytics-dd46e.firebasestorage.app --format="default(cors_config)"`
   shows the GET rule.

`"*"` only lets pages ask; `storage.rules` still decides who gets anything (signed-in users, not while paused).

## 2c. Build the detail

Upload the zip to GitHub as usual and **open Analyze once on a computer**. That builds
the detail (a few seconds after the players load) and saves it to Storage. You'll see the files
under Storage → Files → `fieldDetail/`. Phones and players pick it up on their next visit.

## 3. The budget pause function

This needs the budget connected to a Pub/Sub topic named `budget-alerts`
(Billing → Budgets & alerts → your budget → **Connect a Pub/Sub topic to this budget**).

1. Google Cloud console (same project) → **Cloud Run** → **Write a function**.
2. Service name `budget-pause`, region **us-west1**, runtime **Node.js 22**.
3. Under **Trigger**, add a **Pub/Sub trigger** with the topic `budget-alerts`.
   If the console offers to grant roles the trigger needs, click **Grant**.
4. **Create**. In the source editor that opens, replace `index.js` and `package.json` with the files
   in `functions/budget-pause/`. Set **Function entry point** to `budgetPause`. **Save and redeploy**.
5. Permission to write the switch: Cloud Run → `budget-pause` → **Security** shows its service account.
   IAM & Admin → **IAM** → **Grant access** → that account → role **Cloud Datastore User** → Save.
   (Skip if that account already has Editor.)

What it does: when the month's spend reaches the budget, it sets `config/billing.paused = true`.
The portal then stops downloading from Storage (the rules refuse it too) and falls back to the
round totals, as it worked before Blaze. Nothing is deleted and billing stays on.
To switch downloads back on: Analyze on a phone shows **Resume** in its status line (admin only),
or set `paused` to `false` in Firestore → `config/billing`. After a Resume it won't pause again
until next month's budget period.

## 4. Portal tools: the course scorecard lookup

A Cloud Run function, `portal-tools`, finds a course's scorecard on BlueGolf / GolfTraxx for Track Round
(it replaces the Cloudflare Worker). Only signed-in portal users can use it. Free at the portal's usage.

1. **Its service account:** IAM & Admin → **Service Accounts** → **Create service account**, name `portal-tools`,
   no roles needed → Done. (Cloud Run needs an account to run as; this project has no default one.)
2. **Create the function:** Cloud Run → **Write a function**:
   - Service name `portal-tools`, region **us-west1**, runtime **Node.js 22**.
   - **Authentication: Allow public access.** (Browsers call it directly; the function itself turns away
     anyone who isn't signed in to the portal.) No trigger.
   - Expand **Containers, Volumes, Networking, Security**:
     - **Variables & Secrets** → add `ALLOWED_ORIGINS` = `https://callaway-datalab.github.io`
     - **Security** → Service account → `portal-tools`
   - **Create**.
3. **The code:** in the editor, replace `index.js` and `package.json` with the files in `functions/portal-tools/`,
   set **Function entry point** to `tools`, **Save and redeploy**.
4. **Point the portal at it:** copy the address at the top of the service page
   (`https://portal-tools-….us-west1.run.app`). In the GitHub repo, edit `config.js` and add, inside
   `window.PORTAL_CONFIG = { … }`:

   ```
   courseCardUrl: "https://portal-tools-….us-west1.run.app/course-card",
   ```

5. **Try it:** Track Round → Start a new round → type a course name.

The old Cloudflare worker (`functions/course-card/`) isn't used any more; you can delete that folder from the repo.

## On each device

Each phone or browser keeps one copy of the detail per year (IndexedDB), downloaded once per upload.
It's deleted on **Log out**; on each visit, copies of a deleted or rebuilt data file are removed.

## Every update from now on

As before: bump `style.css?v=` and `main.js?v=` in index.html, `CACHE` in sw.js and
`REPORT_BUILD` in js/reportGen.js. Redeploy `storage.rules` only when it changes.
