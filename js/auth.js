import {
  onAuthStateChanged, signOut as fbSignOut,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { auth, db, adminUids } from "./firebase-init.js";
import { isTeamKey } from "./data.js";

// state.status: 'loading' | 'signed-out' | 'ready'
// state.profile: the user's users/{uid} document data, once loaded (admins may have none)
// state.isTeam: a team member (coach, caddy, ...) rather than a player
// state.teamAccess: for team members, { [playerKey]: { role, label } }
const state = { status: "loading", user: null, profile: null, isAdmin: false, isTeam: false, teamAccess: {} };
const listeners = new Set();
let profileUnsub = null;

function notify() {
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

onAuthStateChanged(auth, (user) => {
  if (profileUnsub) { profileUnsub(); profileUnsub = null; }
  state.user = user;
  state.profile = null;
  state.isTeam = false;
  state.teamAccess = {};
  state.isAdmin = !!user && adminUids.includes(user.uid);

  if (!user) {
    state.status = "signed-out";
    notify();
    return;
  }
  // Stay "loading" until the profile has arrived, so pages never render for a signed-in
  // player before we know which player they are.
  state.status = "loading";
  notify();

  // Admins don't strictly need a profile doc; clients do, to know their clientKey.
  const setProfile = (profile) => {
    state.profile = profile;
    // After an email change, bring the profile's copy up to date.
    if (profile && user.email && profile.email && profile.email !== user.email.toLowerCase()) {
      import("./store.js").then((m) => m.syncProfileEmail(user.uid, user.email.toLowerCase()));
    }
    state.isTeam = !state.isAdmin && !!profile && isTeamKey(profile.clientKey);
    state.teamAccess = (state.isTeam && profile.access) || {};
    state.status = "ready";
    // Count a sign-in once per browser session (opening the portal signed in).
    try {
      const key = `signin:${user.uid}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        import("./store.js").then((m) => m.recordSignIn(user.uid, !!profile)).catch(() => {});
      }
    } catch { /* private mode etc.: skip */ }
    notify();
  };
  // The profile, kept on this device too, so the app still opens with no signal (Data Entry offline).
  const PKEY = `ta:profile:${user.uid}`;
  const cached = () => { try { return JSON.parse(localStorage.getItem(PKEY) || "null"); } catch { return null; } };
  let heard = false;
  const offlineTimer = setTimeout(() => { if (!heard && navigator.onLine === false && cached()) setProfile(cached()); }, 1200);
  profileUnsub = onSnapshot(
    doc(db, "users", user.uid),
    (snap) => {
      heard = true; clearTimeout(offlineTimer);
      const p = snap.exists() ? snap.data() : null;
      try { localStorage.setItem(PKEY, JSON.stringify(p, (k, x) => (x && typeof x === "object" && typeof x.toMillis === "function" ? null : x))); } catch { /* fine */ }
      setProfile(p);
    },
    () => { heard = true; clearTimeout(offlineTimer); setProfile(navigator.onLine === false ? cached() : null); },
  );
  // anything entered offline last time goes up now
  import("./rounds.js").then((m) => m.flushPending()).catch(() => {});
});

export function signOut() {
  // the copy of the stats data kept on this device (see fieldCache.js) goes with the account
  try { indexedDB.deleteDatabase("ta-cache"); } catch { /* nothing kept */ }
  return fbSignOut(auth);
}

/** Resolves once we know whether someone is signed in (past the initial "loading" tick). */
export function whenReady() {
  return new Promise((resolve) => {
    if (state.status !== "loading") { resolve(state); return; }
    const unsub = subscribe((s) => {
      if (s.status !== "loading") { unsub(); resolve(s); }
    });
  });
}
