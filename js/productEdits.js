// (update 712) Product edits: a player's product at a tournament put right by hand (Stats › SG Trends by Product › Edit).
// Loaded once when a page opens (router), handed to sg.js, which applies them wherever a player's rounds are read.
//   productEdits/{playerKey}  { edits: [{ id, event, year, pk, kinds, from, to, label, at, by }] }
import { getState } from "./auth.js";
import { setProductEdits, productEditsOf } from "./sg.js";

const fsP = () => Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("./firebase-init.js")]).then(([f, i]) => ({ ...f, db: i.db }));
let ready = null, all = new Map(), notes = new Map(); // (update 842) notes: playerKey → { productKey: text }
/** The edits, loaded (once; a page waits for this before reading any data, at most a few seconds). */
export function editsReady() {
  if (!getState().user) return Promise.resolve();
  return (ready ||= (async () => {
    try { const { getDocs, collection, db } = await fsP(); const s = await getDocs(collection(db, "productEdits")); all = new Map(s.docs.map((d) => [d.id, d.data().edits || []])); notes = new Map(s.docs.map((d) => [d.id, d.data().notes || {}])); setProductEdits(all); }
    catch (err) { console.warn("Product edits couldn't be loaded", err); ready = null; }
  })());
}
export { productEditsOf };
// (update 838) a product edit by anyone but the admin (a player or their team) sends the admin a message in Chat (the
// editor's Report an issue conversation, which only the admin is in), so the change can be hard-coded into the data
async function alertAdmin(text) {
  const st = getState(); if (st.isAdmin || !st.user) return;
  try {
    const [f, { db, adminUids }] = await Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("./firebase-init.js")]);
    const uid = st.user.uid, admins = [...(adminUids || [])].filter((x) => x !== uid); if (!admins.length) return;
    const id = `issue_${uid}`, ref = f.doc(db, "chatRooms", id), snap = await f.getDoc(ref);
    if (!snap.exists()) await f.setDoc(ref, { type: "group", issue: true, name: "Report an issue", members: [uid, ...admins], createdBy: uid, createdAt: f.serverTimestamp(), lastAt: f.serverTimestamp(), lastText: "", lastBy: "" });
    const body = `[Product edit] ${text}`.slice(0, 2000);
    await f.addDoc(f.collection(db, "chatRooms", id, "messages"), { uid, name: st.profile?.name || st.user.email || "", body, topic: "product", createdAt: f.serverTimestamp() });
    await f.updateDoc(ref, { lastAt: f.serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
  } catch (err) { console.warn("Product edit alert couldn't be sent", err); }
}
const who = () => { const st = getState(); return st.profile?.name || st.user?.email || "Someone"; };
/** Save one edit for a player (the same tournament, season, product type and product before: replaced). */
export async function saveProductEdit(playerKey, e, playerName = "") {
  const { doc, getDoc, setDoc, db } = await fsP(), ref = doc(db, "productEdits", playerKey);
  const cur = await getDoc(ref).then((x) => (x.exists() ? x.data().edits || [] : [])).catch(() => productEditsOf(playerKey));
  const st = getState(), same = (x) => x.event === e.event && String(x.year) === String(e.year) && x.pk === e.pk && (x.from ?? null) === (e.from ?? null);
  const next = [...cur.filter((x) => !same(x)), { ...e, id: e.id || `pe${Date.now().toString(36)}`, at: new Date().toISOString(), by: { uid: st.user?.uid || null, name: st.profile?.name || (st.isAdmin ? "Callaway" : "") } }];
  await setDoc(ref, { edits: JSON.parse(JSON.stringify(next)) }, { merge: true }); // (update 842: merge, so the notes stay)
  all.set(playerKey, next); setProductEdits(all);
  await alertAdmin(`${who()} changed ${playerName || playerKey}'s ${e.pk} at ${e.event} ${e.year}: "${e.from ?? "(what the data had)"}" → "${e.to}". Please hard-code this in the data.`);
}
/** Take an edit out (back to the data). */
export async function removeProductEdit(playerKey, id, playerName = "") {
  const { doc, getDoc, setDoc, db } = await fsP(), ref = doc(db, "productEdits", playerKey);
  const cur = await getDoc(ref).then((x) => (x.exists() ? x.data().edits || [] : [])).catch(() => productEditsOf(playerKey));
  const next = cur.filter((x) => x.id !== id), gone = cur.find((x) => x.id === id);
  await setDoc(ref, { edits: next }, { merge: true });
  all.set(playerKey, next); setProductEdits(all);
  if (gone) await alertAdmin(`${who()} undid a change to ${playerName || playerKey}'s ${gone.pk} at ${gone.event} ${gone.year} (back to "${gone.from ?? "what the data had"}" from "${gone.to}"). If that change was hard-coded, please take it back out.`);
}

// (update 842) What's in the Bag's edits: spelling fixes (a product renamed at every event) and notes on a club or ball.
// renames: [{ from: "Driver|Callaway Paradym …", to: "Driver|Callaway Paradym …", kind }]; noteChanges: { productKey: text }
export const notesOf = (playerKey) => notes.get(playerKey) || {};
const nameOfVal = (v) => String(v || "").split("|").slice(1).join("|");
export async function saveWitbEdits(playerKey, { renames = [], noteChanges = {} } = {}, playerName = "") {
  if (!renames.length && !Object.keys(noteChanges).length) return;
  const { doc, getDoc, setDoc, db } = await fsP(), ref = doc(db, "productEdits", playerKey);
  const snap = await getDoc(ref).catch(() => null), cur = snap?.exists() ? snap.data() : {};
  const st = getState(), by = { uid: st.user?.uid || null, name: st.profile?.name || (st.isAdmin ? "Callaway" : "") }, at = new Date().toISOString();
  let edits = cur.edits || productEditsOf(playerKey);
  for (const r of renames) { edits = [...edits.filter((x) => !(x.type === "rename" && x.from === r.from)), { id: `pe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type: "rename", from: r.from, to: r.to, pk: r.kind || null, at, by }]; }
  const nt = { ...(cur.notes || notesOf(playerKey)) }; for (const [k, v] of Object.entries(noteChanges)) { if (String(v || "").trim()) nt[k] = String(v).trim().slice(0, 500); else delete nt[k]; }
  await setDoc(ref, { edits: JSON.parse(JSON.stringify(edits)), notes: nt });
  all.set(playerKey, edits); notes.set(playerKey, nt); setProductEdits(all);
  const lines = [...renames.map((r) => `${r.kind || nameOfVal(r.from).split(" ")[0]}: "${nameOfVal(r.from)}" → "${nameOfVal(r.to)}" (every event)`),
    ...Object.entries(noteChanges).map(([k, v]) => `Note on ${nameOfVal(k) || k}: ${String(v || "").trim() ? `"${String(v).trim()}"` : "(removed)"}`)];
  await alertAdmin(`${who()} edited ${playerName || playerKey}'s equipment names on What's in the Bag:\n${lines.join("\n")}${renames.length ? "\nPlease hard-code the spelling fixes in the data." : ""}`);
}
