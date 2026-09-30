# Client Portal — GitHub Pages + Firebase edition

A private client portal with no server to run yourself: GitHub Pages hosts the files, and Firebase
(Auth + Firestore, both on the free Spark plan) handles logins and data. Same feature set as the
Flask version, rebuilt as a single-page app that talks to Firebase directly from the browser:

- People **sign up with a one-time access code** you give them.
- You **upload CSV or Parquet files** covering many people; each person sees only their own rows,
  as a sortable/searchable table and a chart.
- You keep a library of **PDFs and PowerPoints**, visible to everyone or to one client.
- Clients **ask questions**; you get an alert (badge, browser tab title, and an optional desktop
  notification); you reply in the portal.

**Read `DEPLOY_FIREBASE_GITHUB.md` for setup — start there, not here.** This file is background
and reference once it's running.

## Why this shape

- There's no backend, so **Firestore security rules are the entire access control layer**
  (`firestore.rules`). The browser talks to Firestore directly; the rules decide what each person
  can read or write. Read the comments at the top of that file before you trust it with real data.
- Cloud Storage now requires a billing account even for a few small files, so documents (PDFs,
  PowerPoints) are stored as base64 chunks in Firestore instead, keeping the whole app on Firebase's
  free tier. This caps individual file size (see `MAX_DOC_BYTES` in `js/data.js`, default 25 MB)
  and counts against Firestore's free storage quota — fine for a personal or small-business tool,
  not for a large document archive.
- There's no server to reset a client's password directly. "Send password reset email" (on the
  Clients & codes page) uses Firebase's own reset-email flow instead — no email setup required on
  your end, unlike the Flask version's SMTP configuration.
- "Remove access" deletes a client's profile, which cuts off their data immediately, but their
  Firebase Auth account technically still exists (deleting it outright needs the Admin SDK, which
  this app doesn't have). See `DEPLOY_FIREBASE_GITHUB.md` for the one-click manual cleanup step.

## What I could and couldn't test

- **App logic and UI**: exercised end-to-end in a real browser (sign-up, data isolation, charts,
  search/sort, questions and alerts, document sharing, admin preview) against a fake in-memory
  backend standing in for Firebase, since this sandbox has no internet access to reach real
  Firebase servers. `tests/browser-smoke.js` is that test, kept in the repo for reference.
- **Security rules**: written carefully and reasoned through line by line, but **not run against
  a real Firestore emulator** — same reason, no internet here. `tests/rules.test.mjs` is a test
  suite for them; run it yourself (instructions in that file) before putting real client data in.
  Treat the rules as reviewed-but-unverified until that suite is green on your machine.
- **Parquet upload from the browser**: the conversion logic is unit-tested (`tests/data.test.mjs`),
  but actually loading the parsing library from its CDN was never exercised, since that also needs
  internet access this sandbox didn't have.

## Local development

Firebase's JS SDK needs to be loaded over `http(s)://`, not `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`. To point at local emulators instead of live Firebase, run
`firebase emulators:start` (needs `firebase-tools` and a JVM) and open the app with `?emulators=1`
appended to the URL.

## Project layout

```
index.html              the entire app's HTML shell — every screen renders into #app
config.example.js       copy to config.js and fill in your Firebase project's details
firestore.rules         security rules — paste into the Firebase Console, see the deploy guide
css/style.css           all styles
js/
  data.js               pure functions: CSV parsing, type inference, chunking (unit-tested)
  parquet.js             loads the Parquet reader from a CDN only when someone uploads one
  firebase-init.js       reads config.js, initializes Firebase
  auth.js                tracks the signed-in user + their profile, exposes it reactively
  store.js               every Firestore read/write, matching firestore.rules field-for-field
  ui.js                  DOM-building helpers (no innerHTML, so no XSS from user data), layout
  router.js              hash-based router (so GitHub Pages needs no server-side rewrites)
  main.js                boots the router, drives the unread-question badge
  views/*.js             one file per screen
tests/
  data.test.mjs           unit tests, run with: node tests/data.test.mjs
  rules.test.mjs          security-rules tests — needs the Firestore emulator, see the file header
  browser-smoke.js        the end-to-end browser test mentioned above (needs Playwright + Node)
sample_data.csv          made-up strokes-gained data to try the portal with (ID column: playerID)
```

## Known limitations

- No "forgot password" self-service beyond Firebase's standard reset email.
- Deleting a client's access removes their Firestore profile but not their Firebase Auth login
  record; see the deploy guide for the extra manual step if you want it fully gone.
- Firestore's free tier has daily read/write quotas and a 1 GiB storage cap — plenty for a personal
  or small-business tool, but keep an eye on the Firebase Console's usage tab as you grow.
- Uploading a very large dataset (many thousands of distinct client IDs) means many Firestore
  writes at once; `js/store.js` batches them safely, but very large uploads will simply take longer.
