# Live Feed fetcher (update 264)

Pulls the current PGA TOUR and Korn Ferry Tour events from the PGA Tour API every 30 minutes and saves them in Firestore
(`liveData`), where the portal's Live Feed reads them. It's the PGA_Live generator (`pga.py`, `build_data.py`,
`checks.py`, `stats.json`, unchanged: drop newer copies of those four in when they change) wrapped by `main.py`.

## 1. Store the API token
Google Cloud console → **Secret Manager** → **Create secret**:
- Name `pga-api-token`, value: the PGA Tour API token.
  (If what you have is a client ID and secret instead, make two secrets, `pga-client-id` and `pga-client-secret`.)

## 2. Create the function
Cloud Run → **Write a function** (the same way as `insights`):
- Service name `live-feed`, region `us-west1`, runtime **Python 3.12**, **Allow unauthenticated invocations**.
- Source: replace `main.py` and `requirements.txt` with the ones here, then **add files** `pga.py`, `build_data.py`,
  `checks.py` and `stats.json` with these contents. Function entry point: `live_feed`.
- **Edit & deploy new revision → Container(s):** Request timeout **1800** seconds; Memory **1 GiB**.
- **Variables & secrets:**
  - `PGA_API_TOKEN` → Reference a secret → `pga-api-token` (or `PGA_CLIENT_ID` / `PGA_CLIENT_SECRET` from theirs)
  - `FEED_KEY` → any long random text (the schedule sends it; keep it private)
  - `ADMIN_UIDS` → your admin UID(s), comma separated (the same as in config.js), for the Refresh now button
  - `FIREBASE_PROJECT_ID` → your Firebase project id
- **Security → Service account** (the default compute one is fine): it needs **Cloud Datastore User** (Firestore) and
  **Secret Manager Secret Accessor** (the token). The `insights` setup already gave it the second.
- Deploy, and copy its URL.

## 3. Run it on a schedule
Cloud Scheduler → **Create job**:
- Name `live-feed`, region `us-west1`, frequency `*/30 * * * 0,1,4,5,6` (every 30 minutes Thursday to Monday), timezone `UTC`.
- Target **HTTP**, URL: the function's URL, method **POST**, header `X-Feed-Key: <the FEED_KEY above>`.
- Create, then **Force run** once. The first run downloads each tour's current event (a few minutes; it keeps its progress
  if it's cut short and carries on next time).

## 4. The portal
- Republish `firestore.rules` (it adds `liveData`, readable by everyone signed in).
- Optional, for the admin's **Refresh now** button on the Live Feed: in `config.js`, add
  `liveFeedUrl: "https://live-feed-XXXXXXXX.us-west1.run.app",`.

## If something's wrong
Firestore → `liveData/status` has the last run: `ok`, `error`, how long it took and the end of its log. Lines starting
"Validation failed; keeping the previous data" mean the API's numbers didn't add up, so the last good copy stayed up
(the same as on GitHub). Cloud Run → live-feed → Logs has the whole log.
Cost: a few seconds of Cloud Run every half hour on event days, and a few hundred Firestore reads/writes a run: pennies a month.
