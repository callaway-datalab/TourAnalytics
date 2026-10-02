// What's in the bag (WITB): up to 14 clubs per person, stored at bags/{uid}.
//   { clubs: [{ cat, type, brand, model, note }], since, history: [{ clubs, from, to }], updatedAt }
// history ("Old bags") keeps each earlier make-up of the bag with the dates it was in use.
import { doc, setDoc, updateDoc, onSnapshot, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

export const MAX_CLUBS = 14;
const deg = (list) => list.map((n) => `${n}\u00b0`);
export const CLUB_TYPES = {
  Driver: deg([7, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12]),
  "Fairway Wood": ["2w", "3w", "4w", "5w", "7w", "9w", "11w"],
  Hybrid: ["2H", "3H", "4H", "5H", "6H", "7H"],
  Iron: ["1i", "2i", "3i", "4i", "5i", "6i", "7i", "8i", "9i", "PW"],
  Wedge: deg([44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64]),
  Putter: ["Putter"],
};
export const CLUB_CATS = Object.keys(CLUB_TYPES);

/** How a club is named on a shot and in the Club filter, e.g. "Driver 9°", "3w", "7i", "56° wedge", "Putter". */
export function clubLabel(c) {
  if (!c?.type) return "";
  if (c.cat === "Driver") return `Driver ${c.type}`;
  if (c.cat === "Wedge") return `${c.type} wedge`;
  return c.type;
}

/** Sort order for clubs: driver, woods, hybrids, irons, wedges, putter (then by number). */
export function clubRank(label) {
  const s = String(label);
  const n = parseFloat(s.replace(/[^\d.]/g, "")) || 0;
  if (/^driver/i.test(s)) return 0 + n / 100;
  if (/^\d+w$/i.test(s)) return 1 + n / 100;
  if (/^\d+H$/.test(s)) return 2 + n / 100;
  if (/^\d+i$/i.test(s)) return 3 + n / 100;
  if (/^PW$/i.test(s)) return 3.99;
  if (/wedge/i.test(s)) return 4 + n / 1000;
  if (/putter/i.test(s)) return 5;
  return 6;
}

/** Brand and model together, e.g. "Titleist T100" (older entries kept them in one "model" field). */
export const clubMake = (c) => [c?.brand, c?.model].filter((x) => x && String(x).trim()).join(" ");

/** The whole bag document: { clubs, since, history }. */
export function watchBagDoc(uid, cb) {
  return onSnapshot(doc(db, "bags", uid), (s) => cb(s.exists() ? s.data() : { clubs: [], history: [] }), () => cb({ clubs: [], history: [] }));
}
export function watchBag(uid, cb) { return watchBagDoc(uid, (d) => cb(d.clubs || [])); }
export async function getBag(uid) {
  try { const s = await getDoc(doc(db, "bags", uid)); return s.exists() ? (s.data().clubs || []) : []; } catch { return []; }
}
/** Save the current bag. Pass oldBag ({ clubs, from }) to file the make-up it replaced under Old bags. */
export function saveBag(uid, clubs, { history, since, oldBag } = {}) {
  const next = { clubs: clubs.slice(0, MAX_CLUBS), updatedAt: serverTimestamp() };
  if (oldBag) {
    next.history = [{ clubs: oldBag.clubs, from: oldBag.from || null, to: new Date().toISOString().slice(0, 10) }, ...(history || [])].slice(0, 100);
    next.since = new Date().toISOString().slice(0, 10);
  } else {
    if (history) next.history = history;
    next.since = since || new Date().toISOString().slice(0, 10);
  }
  return setDoc(doc(db, "bags", uid), next);
}
/** Remove one old bag from the history. */
export function saveBagHistory(uid, history) {
  return updateDoc(doc(db, "bags", uid), { history });
}
/** The make-up of a bag, ignoring notes: used to tell whether the clubs themselves changed. */
export const bagMakeup = (clubs) => JSON.stringify((clubs || []).filter((c) => c.cat && c.type)
  .map((c) => [c.cat, c.type, (c.brand || "").trim().toLowerCase(), (c.model || "").trim().toLowerCase()]).sort());
