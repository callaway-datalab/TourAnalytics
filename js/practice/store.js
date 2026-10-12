// Practice sessions in Firestore (update 136): practice/{uid}/sessions/{id}. Yours only (the admin can read them).
import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "../firebase-init.js";

export const newSessionId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Your sessions, newest first. */
export async function listSessions(uid) {
  if (!uid) return [];
  const snap = await getDocs(collection(db, "practice", uid, "sessions"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
}

/** Save a whole session (shots, results, summary). Firestore can't store `undefined`, so it's cleaned out first. */
export async function saveSession(uid, s) {
  const clean = JSON.parse(JSON.stringify(s));
  delete clean.id;
  await setDoc(doc(db, "practice", uid, "sessions", s.id), { ...clean, updatedAt: serverTimestamp() });
}

export const deleteSession = (uid, id) => deleteDoc(doc(db, "practice", uid, "sessions", id));
