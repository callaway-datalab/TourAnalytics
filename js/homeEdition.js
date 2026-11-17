// (update 814) Home's edition for the day, saved once it's complete: on this device (localStorage) and in Firestore
// (homeEditions/{uid}), so a later visit that day (on any device) shows it straight away while the live one is worked out
// quietly behind it, and the page doesn't change in front of you as data arrives.
//   { day, role, html, nav, at }   html: the feed as drawn (under ~900 KB, Firestore's limit is 1 MB)
const LK = "ta.homeEdition";
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export async function loadEdition(uid, role) {
  try { const x = JSON.parse(localStorage.getItem(LK) || "null"); if (x && x.day === today() && x.role === role && x.uid === uid) return x; } catch { /* */ }
  if (!uid) return null;
  try { const [{ doc, getDoc }, { db }] = await Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("./firebase-init.js")]);
    const s = await getDoc(doc(db, "homeEditions", uid)); const x = s.exists() ? s.data() : null; return x && x.day === today() && x.role === role ? { ...x, uid } : null; } catch { return null; }
}
export async function saveEdition(uid, role, html, nav, remote = true) { // (remote false: this device only (a phone, with less data))
  const x = { day: today(), role, uid: uid || "", html, nav, at: Date.now() };
  try { localStorage.setItem(LK, JSON.stringify(x)); } catch { /* (too big for this device: Firestore only) */ }
  if (!uid || !remote || html.length > 900000) return;
  try { const [{ doc, setDoc }, { db }] = await Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("./firebase-init.js")]);
    await setDoc(doc(db, "homeEditions", uid), { day: x.day, role, html, nav, at: x.at }); } catch (e) { console.warn("edition", e?.code || e); }
}
