// Your Watchlist (update 164): the players you follow, the extra metrics you've picked and the period, kept at
// watchlists/{uid} (only you can read or write it) and on this device, so the page opens straight away. The
// players also go to the top of every player search (playerPicker.js).
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { getState, subscribe } from "./auth.js";

const DEF = { players: [], metrics: ["sg:T2G", "res:wins", "res:top10"], period: "season" };
const lsKey = (uid) => `ta:watchlist:${uid}`;
let cur = null, curUid = null;
const uidNow = () => getState().user?.uid || null;
function fromDevice(uid) { try { return { ...DEF, ...(JSON.parse(localStorage.getItem(lsKey(uid)) || "null") || {}) }; } catch { return { ...DEF }; } }

/** Your watchlist as it stands (from this device until the saved copy arrives). */
export function watchPrefs() {
  const uid = uidNow();
  if (!uid) return { ...DEF };
  if (curUid !== uid) { curUid = uid; cur = fromDevice(uid); loadWatch(); }
  return cur;
}
/** The players on your watchlist (for the player searches). */
export const favoriteKeys = () => watchPrefs().players || [];

let loading = null;
export function loadWatch() {
  const uid = uidNow();
  if (!uid) return Promise.resolve({ ...DEF });
  return (loading ||= getDoc(doc(db, "watchlists", uid)).then((s) => {
    if (s.exists() && uid === curUid) {
      const d = s.data();
      cur = { ...DEF, ...cur, players: Array.isArray(d.players) ? d.players : cur.players, metrics: Array.isArray(d.metrics) ? d.metrics : cur.metrics, period: d.period || cur.period };
      try { localStorage.setItem(lsKey(uid), JSON.stringify(cur)); } catch { /* */ }
    }
    return cur;
  }).catch(() => cur).finally(() => { loading = null; }));
}
/** Change it (saved on this device at once, and to your account). */
export async function saveWatch(patch) {
  const uid = uidNow();
  if (!uid) return;
  watchPrefs();
  cur = { ...cur, ...patch };
  try { localStorage.setItem(lsKey(uid), JSON.stringify(cur)); } catch { /* */ }
  try { await setDoc(doc(db, "watchlists", uid), { players: cur.players, metrics: cur.metrics, period: cur.period, updatedAt: serverTimestamp() }); }
  catch (err) { console.warn("Watchlist kept on this device only (republish the Firestore rules from update 164 to save it to your account).", err?.code || err); }
}
export const toggleFavorite = (key) => { const p = watchPrefs().players || []; return saveWatch({ players: p.includes(key) ? p.filter((k) => k !== key) : [...p, key] }); };
subscribe((s) => { if (s.user?.uid !== curUid) { curUid = null; cur = null; } });
