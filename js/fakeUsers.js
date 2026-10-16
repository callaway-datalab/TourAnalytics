// Fake users (update 170): test accounts the admin makes from User Access. Each is a real sign-in (an email that
// goes nowhere and a random password), signed up with the access code just made for it, so it has exactly the
// access a real person with that code would have: a player, a coach of some players, an analyst... The admin
// can then "Act as" it in a new tab, which signs that tab in as the fake user (only that tab: your own tab stays
// signed in as you). Its login is kept in fakeUsers/{uid}, which only the admin can read.
//
// The account is made through a second, throwaway Firebase app so your own sign-in is never touched.
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, deleteUser,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  initializeFirestore, memoryLocalCache, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

const randomPart = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => "abcdefghijkmnopqrstuvwxyz23456789"[b % 33]).join(""); };
const slug = (s) => String(s || "user").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 24) || "user";

/** A throwaway Firebase app, signed in as nobody (in memory only), for one job. */
async function withSecondApp(fn) {
  const app = initializeApp(window.PORTAL_CONFIG.firebase, `fake-${Date.now()}-${randomPart(4)}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const sdb = initializeFirestore(app, { localCache: memoryLocalCache() });
  try { return await fn(auth, sdb); } finally { try { await signOut(auth); } catch { /* */ } try { await deleteApp(app); } catch { /* */ } }
}

/**
 * Make a fake user from an access code you've just created: signs up with it (as a real person would), then keeps
 * its login for "Act as". Returns { uid, email }.
 */
export async function createFakeUser({ code, name }) {
  name = String(name || "Test user").trim().slice(0, 80) || "Test user";
  const email = `${slug(name)}.${randomPart(6)}@fake-user.example.com`;
  const password = randomPart(24);
  const uid = await withSecondApp(async (auth, sdb) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const id = cred.user.uid;
    // the same claim as the sign-up page (store.js signUpWithCode), as the new account
    await runTransaction(sdb, async (tx) => {
      const ref = doc(sdb, "invites", code);
      const inv = await tx.get(ref);
      if (!inv.exists() || inv.data().usedBy || inv.data().revoked) throw new Error("That access code can't be used.");
      const d = inv.data();
      tx.update(ref, { usedBy: id, usedAt: serverTimestamp() });
      const profile = { email, name, clientKey: d.clientKey, clientLabel: d.clientLabel, inviteCode: code, createdAt: serverTimestamp() };
      if (d.access) profile.access = d.access;
      if (d.kind) profile.kind = d.kind;
      if (d.allPlayers !== undefined) profile.allPlayers = d.allPlayers;
      tx.set(doc(sdb, "users", id), profile);
    });
    return id;
  });
  await setDoc(doc(db, "fakeUsers", uid), { email, password, name, code, createdAt: serverTimestamp() });
  return { uid, email };
}

/** The fake users (admin): uid → { name, email }. */
export function watchFakeUsers(cb) {
  return onSnapshot(collection(db, "fakeUsers"), (s) => cb(new Map(s.docs.map((d) => [d.id, { name: d.data().name, email: d.data().email }]))), () => cb(new Map()));
}

/** Delete a fake user completely: its profile, its sign-in, and its saved login. */
export async function deleteFakeUser(uid) {
  const s = await getDoc(doc(db, "fakeUsers", uid));
  await deleteDoc(doc(db, "users", uid)).catch(() => {});
  if (s.exists()) {
    const { email, password } = s.data();
    await withSecondApp(async (auth) => {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await deleteUser(cred.user);
    }).catch(() => {}); // (the sign-in may already be gone)
  }
  await deleteDoc(doc(db, "fakeUsers", uid));
}

/** Open a new tab signed in as this fake user (only that tab). */
export function actAs(uid) {
  const url = `${location.pathname}?actas=${encodeURIComponent(uid)}#/`;
  window.open(url, "_blank");
}
