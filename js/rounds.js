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

export async function createRound({ playerKey, playerLabel, ownerUid, ownerName, date, course, location, holes }) {
  const ref = doc(roundsOf(playerKey));
  await setDoc(ref, {
    ownerUid, ownerName: ownerName || "", playerKey, playerLabel, date, course, location: location || "",
    holes, shots: {}, status: "in-progress", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Save one hole's strokes (only that hole is written, so two devices don't overwrite each other's holes). */
export function saveHole(playerKey, roundId, holeNo, strokes) {
  return updateDoc(doc(db, "entries", playerKey, "rounds", roundId), { [`shots.h${holeNo}`]: strokes, updatedAt: serverTimestamp() });
}

export function updateRound(playerKey, roundId, fields) {
  return updateDoc(doc(db, "entries", playerKey, "rounds", roundId), { ...fields, updatedAt: serverTimestamp() });
}

export function deleteRound(playerKey, roundId) {
  return deleteDoc(doc(db, "entries", playerKey, "rounds", roundId));
}

export function watchRound(playerKey, roundId, cb) {
  return onSnapshot(doc(db, "entries", playerKey, "rounds", roundId), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), () => cb(null));
}

const listOf = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));

/** One player's entered rounds (the player, their team, or the admin), newest first. */
export function watchPlayerRounds(playerKey, cb) {
  return onSnapshot(query(roundsOf(playerKey), orderBy("date", "desc")), (s) => cb(listOf(s)), () => cb([]));
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
