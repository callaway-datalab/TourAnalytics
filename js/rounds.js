// Rounds entered in Data Entry, stored per player at entries/{playerKey}/rounds/{roundId}:
//   { ownerUid, ownerName, playerKey, playerLabel, date, course, location,
//     holes: [{ n, par, yards, hcp }], shots: { h1: [{ startLie, startDist, endLie, endDist }], ... },
//     status: "in-progress" | "complete", createdAt, updatedAt }
// Whoever enters a round owns it. The player, their team and the admin can read it.
import {
  collection, collectionGroup, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

const roundsOf = (playerKey) => collection(db, "entries", playerKey, "rounds");

/* ---------------- Offline: a copy of every round on this device ----------------
   Every change to a round is also written to a copy on the phone (localStorage), marked "not yet sent"
   until the server confirms it. With no signal the change is queued and the screen carries on; if the page
   is closed before it's sent, the next time the app opens online the copy is sent up (flushPending). When
   the app opens with no signal, rounds are read from these copies. */
const LKEY = (playerKey, id) => `ta:round:${playerKey}/${id}`;
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === "object" && typeof x.toMillis === "function" ? null : x)));
function localGet(playerKey, id) { try { return JSON.parse(localStorage.getItem(LKEY(playerKey, id)) || "null"); } catch { return null; } }
function localPut(playerKey, id, rec) { try { localStorage.setItem(LKEY(playerKey, id), JSON.stringify(rec)); } catch { /* full: the server copy still counts */ } }
function localChange(playerKey, id, apply) {
  const rec = localGet(playerKey, id) || { doc: { id, playerKey }, v: 0 };
  apply(rec.doc);
  rec.v = (rec.v || 0) + 1; rec.dirty = true; rec.at = Date.now();
  localPut(playerKey, id, rec);
  return rec.v;
}
const markSent = (playerKey, id, v) => { const rec = localGet(playerKey, id); if (rec && rec.v === v) { rec.dirty = false; localPut(playerKey, id, rec); } };
/** Keep the device copy in step with what the server sent (without losing changes not yet sent). */
function localSync(r) {
  if (!r?.playerKey || !r?.id) return;
  const rec = localGet(r.playerKey, r.id);
  if (rec?.dirty) return;
  localPut(r.playerKey, r.id, { doc: plain(r), v: rec?.v || 0, dirty: false, at: Date.now() });
}
/** Rounds kept on this device for a player (when there's no signal). */
export function localRounds(playerKey) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`ta:round:${playerKey}/`)) { const rec = JSON.parse(localStorage.getItem(k)); if (rec?.doc && !rec.deleted) out.push(rec.doc); }
    }
  } catch { /* none */ }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
/** Is anything on this device not yet sent? */
export function pendingCount() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith("ta:round:") && JSON.parse(localStorage.getItem(k))?.dirty) n++; } } catch { /* none */ }
  return n;
}
/** Send up any round changes left on this device (the app opening online, or the signal coming back). */
export async function flushPending() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  let sent = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("ta:round:")) continue;
    let rec; try { rec = JSON.parse(localStorage.getItem(k)); } catch { continue; }
    if (!rec?.dirty || !rec.doc?.playerKey || !rec.doc?.id) continue;
    const { id, ...fields } = rec.doc;
    try {
      if (rec.deleted) await deleteDoc(doc(db, "entries", fields.playerKey, "rounds", id));
      else await setDoc(doc(db, "entries", fields.playerKey, "rounds", id), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
      if (rec.deleted) localStorage.removeItem(k); else markSent(fields.playerKey, id, rec.v);
      sent++;
    } catch { /* still offline / not allowed: try again later */ }
  }
  return sent;
}
if (typeof window !== "undefined") window.addEventListener("online", () => { flushPending(); });

export async function createRound({ playerKey, playerLabel, ownerUid, ownerName, date, course, location, tees, type, tournament, tour = "", holes, mode = "full" }) {
  const ref = doc(roundsOf(playerKey));
  const data = { ownerUid, ownerName: ownerName || "", playerKey, playerLabel, date, course, location: location || "", tees: tees || "", type: type || "", tournament: tournament || "", tour: tour || "",
    holes, shots: {}, quick: {}, mode, status: "in-progress" };
  const v = localChange(playerKey, ref.id, (d) => Object.assign(d, data));
  const write = setDoc(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).then(() => markSent(playerKey, ref.id, v));
  if (typeof navigator === "undefined" || navigator.onLine !== false) await write; // online: wait for it; offline: it's queued
  else write.catch(() => {});
  return ref.id;
}

/** Save one hole's strokes (only that hole is written, so two devices don't overwrite each other's holes). */
export function saveHole(playerKey, roundId, holeNo, strokes) {
  const v = localChange(playerKey, roundId, (d) => { d.shots = { ...(d.shots || {}), [`h${holeNo}`]: plain(strokes) }; });
  return updateDoc(doc(db, "entries", playerKey, "rounds", roundId), { [`shots.h${holeNo}`]: strokes, updatedAt: serverTimestamp() }).then(() => markSent(playerKey, roundId, v));
}

/** Quick mode: one hole's score, putts, fairway and green in regulation. */
export function saveQuickHole(playerKey, roundId, holeNo, q) {
  const v = localChange(playerKey, roundId, (d) => { d.quick = { ...(d.quick || {}), [`h${holeNo}`]: plain(q) }; });
  return updateDoc(doc(db, "entries", playerKey, "rounds", roundId), { [`quick.h${holeNo}`]: q, updatedAt: serverTimestamp() }).then(() => markSent(playerKey, roundId, v));
}

export function updateRound(playerKey, roundId, fields) {
  const v = localChange(playerKey, roundId, (d) => Object.assign(d, plain(fields)));
  return updateDoc(doc(db, "entries", playerKey, "rounds", roundId), { ...fields, updatedAt: serverTimestamp() }).then(() => markSent(playerKey, roundId, v));
}

export function deleteRound(playerKey, roundId) {
  const rec = localGet(playerKey, roundId);
  if (rec) { rec.deleted = true; rec.dirty = true; localPut(playerKey, roundId, rec); }
  return deleteDoc(doc(db, "entries", playerKey, "rounds", roundId)).then(() => { try { localStorage.removeItem(LKEY(playerKey, roundId)); } catch { /* fine */ } });
}

export function watchRound(playerKey, roundId, cb) {
  // the device copy if the server hasn't answered in a moment (no signal) or can't
  let heard = false;
  const fallback = () => { const rec = localGet(playerKey, roundId); if (rec?.doc && !rec.deleted) cb({ ...rec.doc, id: roundId, offline: true }); else cb(null); };
  const t = setTimeout(() => { if (!heard && (typeof navigator !== "undefined" && navigator.onLine === false)) fallback(); }, 1500);
  const un = onSnapshot(doc(db, "entries", playerKey, "rounds", roundId), (s) => {
    heard = true; clearTimeout(t);
    if (!s.exists()) { const rec = localGet(playerKey, roundId); if (rec?.dirty && !rec.deleted) { cb({ ...rec.doc, id: roundId }); return; } cb(null); return; }
    const r = { id: s.id, ...s.data() };
    const rec = localGet(playerKey, roundId);
    if (rec?.dirty) { cb({ ...r, ...rec.doc, id: s.id }); flushPending(); return; } // changes made on this device win until they're sent
    localSync(r); cb(r);
  }, () => { heard = true; clearTimeout(t); fallback(); });
  return () => { clearTimeout(t); un(); };
}

const listOf = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));

/** One player's entered rounds (the player, their team, or the admin), newest first. */
export function watchPlayerRounds(playerKey, cb) {
  let heard = false;
  const t = setTimeout(() => { if (!heard && typeof navigator !== "undefined" && navigator.onLine === false) cb(localRounds(playerKey)); }, 1500);
  const un = onSnapshot(query(roundsOf(playerKey), orderBy("date", "desc")), (s) => {
    heard = true; clearTimeout(t);
    const list = listOf(s); list.forEach(localSync);
    // rounds started on this device that the server hasn't got yet
    const ids = new Set(list.map((r) => r.id));
    cb([...list, ...localRounds(playerKey).filter((r) => !ids.has(r.id) && localGet(playerKey, r.id)?.dirty)].sort((a, b) => String(b.date).localeCompare(String(a.date))));
  }, () => { heard = true; clearTimeout(t); cb(localRounds(playerKey)); });
  return () => { clearTimeout(t); un(); };
}

/** Several players' rounds at once (a coach's players). */
export function watchRoundsFor(playerKeys, cb) {
  const per = new Map();
  const emit = () => cb([...per.values()].flat().sort((a, b) => String(b.date).localeCompare(String(a.date))));
  const uns = playerKeys.map((k) => watchPlayerRounds(k, (list) => { per.set(k, list); emit(); }));
  if (!playerKeys.length) cb([]);
  return () => uns.forEach((u) => u());
}

/** Admin: every entered round. */
export function watchAllRounds(cb) {
  return onSnapshot(collectionGroup(db, "rounds"), (s) => cb(listOf(s).sort((a, b) => String(b.date).localeCompare(String(a.date)))), () => cb([]));
}
export async function getAllRounds() {
  return listOf(await getDocs(collectionGroup(db, "rounds")));
}

/** Every round you own: your own rounds, plus any you entered for a player under the earlier
 *  version of Data Entry (when coaches and the admin picked a player). Newest first. */
export function watchMyRounds(state, myKey, cb) {
  const uid = state.user?.uid;
  const parts = { mine: [], others: [] };
  const emit = () => {
    const seen = new Set();
    cb([...parts.mine, ...parts.others].filter((r) => !seen.has(r.id) && seen.add(r.id))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)));
  };
  const uns = [watchPlayerRounds(myKey, (l) => { parts.mine = l; emit(); })];
  const owned = (l) => { parts.others = l.filter((r) => r.ownerUid === uid && r.playerKey !== myKey); emit(); };
  if (state.isAdmin) uns.push(watchAllRounds(owned));
  else if (state.isTeam) uns.push(watchRoundsFor(Object.keys(state.teamAccess || {}), owned));
  return () => uns.forEach((u) => u());
}
