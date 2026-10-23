// (update 264) The Live Feed's PGA Tour API data, which the live-feed function keeps in Firestore (liveData): the same
// files the PGA_Live generator writes (current.json, players.json, stats_meta.json, R/2026-528.json …), each in pieces.
//   liveData/{path, / as __}               { path, hash, chunkCount, updatedAt }
//   liveData/{...}/chunks/{hash}_{i}       { data }
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

const idOf = (rel) => String(rel).replace(/^data\//, "").replace(/\//g, "__");
const files = new Map(); // `${path}|${hash}` → Promise<the file>

/** Watch one file's entry (its hash changes when the file does): cb({ path, hash, updatedAt } | null). Returns stop(). */
export function watchLiveFile(rel, cb) {
  return onSnapshot(doc(db, "liveData", idOf(rel)), (s) => cb(s.exists() ? s.data() : null), () => cb(null));
}

/** One file, read whole (kept for the visit per version). null when there's no such file. */
export async function liveFile(rel, entry = null) {
  let m = entry;
  if (!m) { const s = await getDoc(doc(db, "liveData", idOf(rel))); if (!s.exists()) return null; m = s.data(); }
  const key = `${idOf(rel)}|${m.hash}`;
  if (!files.has(key)) {
    files.set(key, (async () => {
      const parts = await Promise.all(Array.from({ length: m.chunkCount || 0 }, (_, i) => getDoc(doc(db, "liveData", idOf(rel), "chunks", `${m.hash}_${i}`))));
      if (parts.some((p) => !p.exists())) throw new Error("The live data is being updated; try again in a moment.");
      return JSON.parse(parts.map((p) => p.data().data || "").join(""));
    })().catch((err) => { files.delete(key); throw err; }));
  }
  return files.get(key);
}
