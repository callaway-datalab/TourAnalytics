// (update 712) Product edits: a player's product at a tournament put right by hand (Stats › SG Trends by Product › Edit).
// Loaded once when a page opens (router), handed to sg.js, which applies them wherever a player's rounds are read.
//   productEdits/{playerKey}  { edits: [{ id, event, year, pk, kinds, from, to, label, at, by }] }
import { getState } from "./auth.js";
import { setProductEdits, productEditsOf } from "./sg.js";

const fsP = () => Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("./firebase-init.js")]).then(([f, i]) => ({ ...f, db: i.db }));
let ready = null, all = new Map();
/** The edits, loaded (once; a page waits for this before reading any data, at most a few seconds). */
export function editsReady() {
  if (!getState().user) return Promise.resolve();
  return (ready ||= (async () => {
    try { const { getDocs, collection, db } = await fsP(); const s = await getDocs(collection(db, "productEdits")); all = new Map(s.docs.map((d) => [d.id, d.data().edits || []])); setProductEdits(all); }
    catch (err) { console.warn("Product edits couldn't be loaded", err); ready = null; }
  })());
}
export { productEditsOf };
/** Save one edit for a player (the same tournament, season, product type and product before: replaced). */
export async function saveProductEdit(playerKey, e) {
  const { doc, getDoc, setDoc, db } = await fsP(), ref = doc(db, "productEdits", playerKey);
  const cur = await getDoc(ref).then((x) => (x.exists() ? x.data().edits || [] : [])).catch(() => productEditsOf(playerKey));
  const st = getState(), same = (x) => x.event === e.event && String(x.year) === String(e.year) && x.pk === e.pk && (x.from ?? null) === (e.from ?? null);
  const next = [...cur.filter((x) => !same(x)), { ...e, id: e.id || `pe${Date.now().toString(36)}`, at: new Date().toISOString(), by: { uid: st.user?.uid || null, name: st.profile?.name || (st.isAdmin ? "Callaway" : "") } }];
  await setDoc(ref, { edits: JSON.parse(JSON.stringify(next)) });
  all.set(playerKey, next); setProductEdits(all);
}
/** Take an edit out (back to the data). */
export async function removeProductEdit(playerKey, id) {
  const { doc, getDoc, setDoc, db } = await fsP(), ref = doc(db, "productEdits", playerKey);
  const cur = await getDoc(ref).then((x) => (x.exists() ? x.data().edits || [] : [])).catch(() => productEditsOf(playerKey));
  const next = cur.filter((x) => x.id !== id);
  await setDoc(ref, { edits: next });
  all.set(playerKey, next); setProductEdits(all);
}
