# Blaze setup: lie / distance detail and the budget pause

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

## 4. The AI service (optional: Ask AI and the report summaries)

Without it, Ask AI reads requests itself and the reports use their own written summary. With it, Claude
reads free-form Ask AI requests and writes the summaries. It never spends more than its cap (default **$1.00**,
counted from the tokens Anthropic reports for each answer). Once the next answer could pass the cap, it stops
calling the AI and the portal quietly goes back to the built-in versions.

**A. An Anthropic API key**
1. console.anthropic.com → sign up / sign in → **Billing**: add a card and buy the smallest amount of
   credit it offers. Leave **auto-reload off**: then Anthropic can't charge more than the credit you bought,
   whatever happens.
2. **Settings → Limits**: if it offers a monthly spend limit, set it (a second safety net).
3. **API Keys → Create Key** ("tour-analytics"). Copy it (it's shown once).

**B. Keep the key secret** (Google Cloud console, same project)
1. Search **Secret Manager** → enable it if asked → **Create secret**: name `anthropic-api-key`,
   secret value = the key → **Create**.

**C. The function**
1. **Cloud Run** → **Write a function**. Service name `insights`, region **us-west1**, runtime **Node.js 22**.
2. **Authentication: Allow unauthenticated invocations** (the function checks each person is signed in to
   the portal itself).
3. Open **Container(s), Volumes, Networking, Security** → **Variables & secrets**:
   - **Add variable**: `FIREBASE_PROJECT_ID` = your project id (as in config.js).
   - (optional) `AI_CAP_USD` = `1` (the most it will ever spend; change it later the same way).
   - (optional) `AI_CAP_PERIOD` = `month` to make the cap a monthly one. Left out: the cap is for good.
   - (optional) `INSIGHTS_MODEL` = `claude-haiku-5-5` for about 20x cheaper (Sonnet writes better summaries).
   - **Reference a secret**: name `ANTHROPIC_API_KEY`, secret `anthropic-api-key`, version **latest**,
     exposed as an **environment variable**. If it asks to grant access to the secret, click **Grant**.
4. **Create**. In the source editor, replace `index.js` and `package.json` with the two files in
   `functions/insights/`. Set **Function entry point** to `insights`. **Save and redeploy**.
5. Permission to keep the running total: Cloud Run → `insights` → **Security** shows its service account.
   IAM & Admin → **IAM** → **Grant access** → that account → role **Cloud Datastore User** → Save
   (skip if it already has Editor).
6. Copy the service's **URL** (top of its Cloud Run page) and add it to `config.js`:
   `insightsUrl: "https://insights-….run.app",` (inside `window.PORTAL_CONFIG`). Upload config.js.

**Checking the spend:** Firestore → `config` → `aiSpend` shows the total so far (`usd`), the number of
answers (`calls`) and the cap. To switch it back on after it's reached the cap: raise `AI_CAP_USD`
(Edit & deploy new revision) or delete the `aiSpend` document to start the count again.

## On each device

Each phone or browser keeps one copy of the detail per year (IndexedDB), downloaded once per upload.
It's deleted on **Log out**; on each visit, copies of a deleted or rebuilt data file are removed.

## Every update from now on

As before: bump `style.css?v=` and `main.js?v=` in index.html, `CACHE` in sw.js and
`REPORT_BUILD` in js/reportGen.js. Redeploy `storage.rules` only when it changes.
