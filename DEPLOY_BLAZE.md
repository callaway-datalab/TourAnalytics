# Blaze setup: lie / distance detail and the budget pause (update 128)

Update 128 saves the field's per-round lie / distance detail to Cloud Storage
(`fieldDetail/{dataset}/{year}.bin.gz`), so phones, players' own portals and their
AI Insights reports can rank by lie and distance without loading every player's rows.
A small budget function switches those downloads off if the month's budget is reached.

Do these once, in this order. Steps 1–2 are needed for the detail; step 3 is the safety net.

## 1. Firestore rules (changed in this update)

Firebase console → **Databases & Storage → Firestore → Rules**. Paste the whole of
`firestore.rules`, put your admin UID back into `adminUids()`, and click **Publish**.
(New: `config/billing`, the budget pause switch.)

## 2. Storage rules (new)

Firebase console → **Databases & Storage → Storage → Rules**. Paste the whole of
`storage.rules`, put the **same** admin UID into its `adminUids()`, and click **Publish**.
The console asks to let Storage rules read Firestore (they check the budget pause): click **Grant**.

Then upload the zip to GitHub as usual and **open Analyze once on a computer**. That builds
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

## Every update from now on

As before: bump `style.css?v=` and `main.js?v=` in index.html, `CACHE` in sw.js and
`REPORT_BUILD` in js/reportGen.js. Redeploy `storage.rules` only when it changes.
