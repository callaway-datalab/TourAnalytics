import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getAuth, connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentSingleTabManager,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const cfg = window.PORTAL_CONFIG;
if (!cfg || !cfg.firebase || cfg.firebase.apiKey === "REPLACE_ME") {
  document.body.innerHTML =
    '<div style="max-width:34rem;margin:15vh auto;padding:0 1.5rem;font:16px system-ui">' +
    "<h1>Setup needed</h1><p>Copy <code>config.example.js</code> to <code>config.js</code> and fill in " +
    "your Firebase project's details. See DEPLOY_FIREBASE_GITHUB.md.</p></div>";
  throw new Error("PORTAL_CONFIG missing or unfilled");
}

export const portalName = cfg.portalName || "Client Portal";
export const adminUids = cfg.adminUids || [];

export const app = initializeApp(cfg.firebase);
export const auth = getAuth(app);

// Offline persistence: a huge quality-of-life win on a data-heavy portal, and it means
// the client library batches/coalesces reads instead of re-fetching on every navigation.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
});

// Optional local emulator support for development/testing:
// add ?emulators=1 to the URL while running `firebase emulators:start`.
if (new URLSearchParams(location.search).get("emulators") === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  console.info("[portal] connected to local Firebase emulators");
}
