import {
  onAuthStateChanged, signOut as fbSignOut,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { auth, db, adminUids } from "./firebase-init.js";

// state.status: 'loading' | 'signed-out' | 'ready'
// state.profile: the user's users/{uid} document data, once loaded (admins may have none)
const state = { status: "loading", user: null, profile: null, isAdmin: false };
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
  state.isAdmin = !!user && adminUids.includes(user.uid);

  if (!user) {
    state.status = "signed-out";
    notify();
    return;
  }
  state.status = "ready";
  notify();

  // Admins don't strictly need a profile doc; clients do, to know their clientKey.
  profileUnsub = onSnapshot(
    doc(db, "users", user.uid),
    (snap) => { state.profile = snap.exists() ? snap.data() : null; notify(); },
    () => { state.profile = null; notify(); },
  );
});

export function signOut() {
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
