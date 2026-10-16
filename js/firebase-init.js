import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getAuth, connectAuthEmulator, initializeAuth, browserSessionPersistence, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  initializeFirestore, connectFirestoreEmulator, memoryLocalCache, doc, getDoc,
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

const ownApp = initializeApp(cfg.firebase);
const ownAuth = getAuth(ownApp);

// In-memory cache only. The on-disk cache also kept a queue of unsent writes that survived page
// reloads, so one big upload that got stuck could quietly block every later save from that
// browser. With a memory cache, reloading the page always starts clean.
const ownDb = initializeFirestore(ownApp, { localCache: memoryLocalCache() });

// Optional local emulator support for development/testing:
// add ?emulators=1 to the URL while running `firebase emulators:start`.
if (new URLSearchParams(location.search).get("emulators") === "1") {
  connectAuthEmulator(ownAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(ownDb, "127.0.0.1", 8080);
  console.info("[portal] connected to local Firebase emulators");
}

/*
 * Act as a fake user (update 170). The admin's "Act as" opens a tab with ?actas=<uid>. That tab signs in as the
 * fake user through a second Firebase app whose sign-in lives only in this tab (session storage), so the
 * admin's own sign-in, in this tab's storage and every other tab, is never touched. The whole portal in this
 * tab then runs as that user: their pages, their access, their saves. Closing the tab (or Stop) ends it.
 */
let app = ownApp, auth = ownAuth, db = ownDb, actingAs = null, actAsError = null;
const qs = new URLSearchParams(location.search);
const wanted = qs.get("actas") || (() => { try { return sessionStorage.getItem("ta:actAs"); } catch { return null; } })();
if (wanted) {
  try {
    sessionStorage.setItem("ta:actAs", wanted);
    const app2 = initializeApp(cfg.firebase, "actas");
    const auth2 = initializeAuth(app2, { persistence: browserSessionPersistence });
    const db2 = initializeFirestore(app2, { localCache: memoryLocalCache() });
    await auth2.authStateReady();
    let info = null;
    try { info = JSON.parse(sessionStorage.getItem("ta:actAsInfo") || "null"); } catch { /* */ }
    if (!auth2.currentUser || auth2.currentUser.uid !== wanted || !info) {
      // its login: readable only by the admin, so this needs your own sign-in in this browser
      await ownAuth.authStateReady();
      if (!ownAuth.currentUser) throw new Error("Sign in as the admin first, then use Act as again.");
      const s = await getDoc(doc(ownDb, "fakeUsers", wanted));
      if (!s.exists()) throw new Error("That fake user doesn't exist any more.");
      const f = s.data();
      await signInWithEmailAndPassword(auth2, f.email, f.password);
      info = { uid: wanted, name: f.name || "Fake user", email: f.email };
      sessionStorage.setItem("ta:actAsInfo", JSON.stringify(info));
    }
    app = app2; auth = auth2; db = db2; actingAs = info;
    if (qs.has("actas")) { qs.delete("actas"); history.replaceState(null, "", `${location.pathname}${qs.toString() ? `?${qs}` : ""}${location.hash}`); }
  } catch (err) {
    actAsError = err?.message || String(err);
    try { sessionStorage.removeItem("ta:actAs"); sessionStorage.removeItem("ta:actAsInfo"); } catch { /* */ }
    console.error("Act as:", err);
  }
}

/** Stop acting as a fake user: this tab goes back to your own sign-in. */
export async function stopActingAs() {
  try { sessionStorage.removeItem("ta:actAs"); sessionStorage.removeItem("ta:actAsInfo"); } catch { /* */ }
  try { if (auth !== ownAuth) await signOut(auth); } catch { /* */ }
  history.replaceState(null, "", `${location.pathname}#/`);
  location.reload();
}

export { app, auth, db, actingAs, actAsError };
