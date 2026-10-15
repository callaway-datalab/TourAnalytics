// Your saved scorecards (update 135): every scorecard you fill in on Enter New Round is kept for you, by course,
// so picking that course again fills the card (pars, handicaps and each set of tees you've entered).
// Only you can read or change yours:  courseCards/{your uid}/cards/{course}
import { collection, doc, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export const cardIdOf = (name, location = "") => [slug(name), slug(location)].filter(Boolean).join("--") || "course";

/** Your saved cards, newest first: [{ id, name, location, holes, par[], hcp[], tees: { name: yards[] }, lastTees }] */
export async function myCourseCards(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "courseCards", uid, "cards"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
  } catch { return []; }
}

/** Save (or update) one course's card. */
export async function saveCourseCard(uid, card) {
  if (!uid || !card?.name) return;
  const id = cardIdOf(card.name, card.location);
  const clean = (a) => (Array.isArray(a) ? a.map((v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v))) : []);
  const tees = {};
  for (const [name, yards] of Object.entries(card.tees || {})) if (name && yards?.some((v) => v)) tees[String(name).slice(0, 30)] = clean(yards);
  await setDoc(doc(db, "courseCards", uid, "cards", id), {
    name: String(card.name).slice(0, 80), location: String(card.location || "").slice(0, 80), holes: card.holes === 9 ? 9 : 18,
    par: clean(card.par), hcp: clean(card.hcp), tees, lastTees: String(card.lastTees || "").slice(0, 30), updatedAt: serverTimestamp(),
  });
  return id;
}
