// Practice in Firestore.
//   practice/{owner}/sessions/{id}   your sessions, games, rounds and My Clubs shots
//   practice/{owner}/games/{id}      games you've made, or your versions of the built-in ones (update 139)
//   assignedGames/{playerKey}/games/{id}  games a coach (or the admin) has sent a player (update 139)
// The owner is a player's key (so their coach and the admin can see their practice in Analyze), or the signed-in
// person's own id for everyone else (the admin, coaches, analysts practising themselves).
import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "../firebase-init.js";

export const newSessionId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Where the signed-in person's practice lives. */
export function practiceOwner(state) {
  const key = state.profile?.clientKey;
  return !state.isAdmin && !state.isTeam && key ? key : state.user.uid;
}

const clean = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.id; return c; };

/** Sessions, newest first. (A player's sessions saved under their own id before update 139 move over the first time.) */
export async function listSessions(owner, { oldUid = null } = {}) {
  if (!owner) return [];
  const snap = await getDocs(collection(db, "practice", owner, "sessions"));
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (oldUid && oldUid !== owner) {
    try {
      const old = await getDocs(collection(db, "practice", oldUid, "sessions"));
      for (const d of old.docs) {
        const s = { id: d.id, ...d.data() };
        if (!list.some((x) => x.id === s.id)) { await setDoc(doc(db, "practice", owner, "sessions", s.id), { ...clean(s), updatedAt: serverTimestamp() }); list.push(s); }
        await deleteDoc(d.ref).catch(() => {});
      }
    } catch { /* nothing there, or not allowed: fine */ }
  }
  return list.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
}

/** Save a whole session (shots, results, summary). Firestore can't store `undefined`, so it's cleaned out first. */
export async function saveSession(owner, s) {
  await setDoc(doc(db, "practice", owner, "sessions", s.id), { ...clean(s), updatedAt: serverTimestamp() });
}
export const deleteSession = (owner, id) => deleteDoc(doc(db, "practice", owner, "sessions", id));

/* ---------------- games you've made (or edited) ---------------- */
export async function listMyGames(owner) {
  try { const snap = await getDocs(collection(db, "practice", owner, "games")); return snap.docs.map((d) => ({ ...d.data(), id: d.id })); } catch { return []; }
}
export const saveMyGame = (owner, g) => setDoc(doc(db, "practice", owner, "games", g.id), { ...clean(g), updatedAt: serverTimestamp() });
export const deleteMyGame = (owner, id) => deleteDoc(doc(db, "practice", owner, "games", id));

/* ---------------- games sent to a player ---------------- */
export async function listAssigned(playerKey) {
  if (!playerKey) return [];
  try { const snap = await getDocs(collection(db, "assignedGames", playerKey, "games")); return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || ""))); } catch { return []; }
}
export const sendGame = (playerKey, a) => setDoc(doc(db, "assignedGames", playerKey, "games", a.id), clean(a));
export const dismissAssigned = (playerKey, id) => deleteDoc(doc(db, "assignedGames", playerKey, "games", id));
