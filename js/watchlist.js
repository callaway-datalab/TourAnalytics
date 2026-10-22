// Your Watchlist (update 164): the players you follow, the extra metrics you've picked and the period, kept at
// watchlists/{uid} (only you can read or write it) and on this device, so the page opens straight away. The
// players also go to the top of every player search (playerPicker.js) and get a star on the leaderboards.
// (update 168) Each person has their own. When the admin previews someone's portal, the page shows THEIR
// Watchlist (a coach's, an analyst's), never the admin's; changes made during a preview aren't saved.
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { getState, subscribe } from "./auth.js";
import { getPreviewTeam } from "./preview.js";
import { getPreviewClient } from "./router.js";

const DEF = { players: [], metrics: ["res:wins", "res:top10"], metricsFor: {}, period: "season", source: "tour", rel: false }; // (rel: update 226) // (metricsFor: update 180, a player's own) // (source: update 169)
const lsKey = (uid) => `ta:watchlist:${uid}`;
// (update 167: "Last 12 months" became "Last 6 months")
const fixPeriod = (o) => (o.period === "l12" ? { ...o, period: "l6" } : o);
function fromDevice(uid) { try { return fixPeriod({ ...DEF, ...(JSON.parse(localStorage.getItem(lsKey(uid)) || "null") || {}) }); } catch { return { ...DEF }; } }

/**
 * Whose Watchlist is on screen: your own, or (the admin previewing someone) theirs.
 *   { id, uid, own }  id tells one list from another; uid is whose saved copy to read (null: none saved yet)
 */
function owner() {
  const s = getState();
  const me = s.user?.uid || null;
  if (!me) return null;
  if (s.isAdmin) {
    const t = getPreviewTeam();
    if (t) return { id: `preview:${t.uid || t.email || t.name || "someone"}`, uid: t.uid || null, own: false };
    let pc = null; try { pc = getPreviewClient(); } catch { /* router not ready */ }
    if (pc) return { id: `preview:${pc.key}`, uid: null, own: false }; // a player's portal: no favourites
  }
  return { id: me, uid: me, own: true };
}

const lists = new Map(); // owner id → their list (as it stands)
const loaded = new Set(); // owner ids whose saved copy has been read
const loading = new Map();

/** The Watchlist on screen (from this device until the saved copy arrives). */
export function watchPrefs() {
  const o = owner();
  if (!o) return { ...DEF };
  if (!lists.has(o.id)) { lists.set(o.id, o.own ? fromDevice(o.uid) : { ...DEF }); loadWatch(); }
  return lists.get(o.id);
}
/** The players on that Watchlist (for the player searches and the leaderboard stars). */
export const favoriteKeys = () => watchPrefs().players || [];
/** Is this someone else's Watchlist (the admin's preview)? Then changes aren't saved. */
export const watchIsPreview = () => { const o = owner(); return !!o && !o.own; };

export function loadWatch() {
  const o = owner();
  if (!o) return Promise.resolve({ ...DEF });
  if (!lists.has(o.id)) lists.set(o.id, o.own ? fromDevice(o.uid) : { ...DEF });
  if (!o.uid || loaded.has(o.id)) return Promise.resolve(lists.get(o.id));
  if (loading.has(o.id)) return loading.get(o.id);
  const p = getDoc(doc(db, "watchlists", o.uid)).then((s) => {
    loaded.add(o.id);
    if (s.exists()) {
      const d = s.data(), cur = lists.get(o.id) || { ...DEF };
      const next = fixPeriod({ ...DEF, ...cur, players: Array.isArray(d.players) ? d.players : cur.players, metrics: Array.isArray(d.metrics) ? d.metrics : cur.metrics, metricsFor: d.metricsFor && typeof d.metricsFor === "object" ? d.metricsFor : cur.metricsFor || {}, period: d.period || cur.period, source: d.source || cur.source || "tour" });
      lists.set(o.id, next);
      if (o.own) { try { localStorage.setItem(lsKey(o.uid), JSON.stringify(next)); } catch { /* */ } }
    }
    return lists.get(o.id);
  }).catch(() => lists.get(o.id)).finally(() => loading.delete(o.id));
  loading.set(o.id, p);
  return p;
}
/** Change it: yours is saved on this device at once, and to your account. A preview's stays on screen only. */
export async function saveWatch(patch) {
  const o = owner();
  if (!o) return;
  const cur = { ...watchPrefs(), ...patch };
  lists.set(o.id, cur);
  if (!o.own) return;
  try { localStorage.setItem(lsKey(o.uid), JSON.stringify(cur)); } catch { /* */ }
  try { await setDoc(doc(db, "watchlists", o.uid), { players: cur.players, metrics: cur.metrics, metricsFor: cur.metricsFor || {}, period: cur.period, source: cur.source || "tour", updatedAt: serverTimestamp() }); }
  catch (err) { console.warn("Watchlist kept on this device only (republish the Firestore rules to save it to your account).", err?.code || err); }
}
export const toggleFavorite = (key) => { const p = watchPrefs().players || []; return saveWatch({ players: p.includes(key) ? p.filter((k) => k !== key) : [...p, key] }); };
// signing out or in as someone else: start fresh
let lastUid = null;
subscribe((s) => { const u = s.user?.uid || null; if (u !== lastUid) { lastUid = u; lists.clear(); loaded.clear(); loading.clear(); } });
