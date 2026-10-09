// Who each person can chat with (update 101), kept up to date by the admin's app (when the admin signs in and
// when they open Chat):
//   chatNames/{uid}     = { name, role, title }  so people show by name ("Cody Coach · Coach")
//   friendEmails/{email} = { uid }              so a friend can be found by their exact email
//   chatReach/{uid}     = { uids }              a player's or team member's team and Callaway staff
// Friends are added by people themselves (chat.js) and checked by the Firestore rules.
import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, adminUids } from "./firebase-init.js";
import { isTeamKey } from "./data.js";
import { getState } from "./auth.js";

const ROLE_NAMES = { player: "Player", coach: "Coach", caddie: "Caddie", caddy: "Caddie", analyst: "Analyst", admin: "Callaway", team: "Team", other: "Team" };
export const roleName = (r) => ROLE_NAMES[r] || (r ? r[0].toUpperCase() + r.slice(1) : "");

let running = null;
export function syncChatCircles() {
  const state = getState();
  if (!state.isAdmin) return Promise.resolve();
  return (running ||= (async () => {
    const users = (await getDocs(collection(db, "users"))).docs.map((d) => ({ uid: d.id, ...d.data() }));
    const nameOf = (u) => u.name || u.email || "Someone";
    const staffIds = [...adminUids, ...users.filter((u) => u.kind === "analyst").map((u) => u.uid)];
    const isStaff = (uid) => staffIds.includes(uid);
    // names and roles
    const names = new Map();
    for (const uid of adminUids) names.set(uid, { name: uid === state.user.uid ? (state.profile?.name || state.user.displayName || "Callaway") : (users.find((u) => u.uid === uid)?.name || "Callaway"), role: "admin", title: "Callaway" });
    for (const u of users) {
      if (names.has(u.uid)) continue;
      if (u.kind === "analyst") names.set(u.uid, { name: nameOf(u), role: "analyst", title: "Analyst" });
      else if (isTeamKey(u.clientKey)) { const r = Object.values(u.access || {})[0]?.role || "team"; names.set(u.uid, { name: nameOf(u), role: "team", title: roleName(r) }); }
      else if (u.clientKey) names.set(u.uid, { name: nameOf(u), role: "player", title: "Player" });
    }
    // each player's team: the player and everyone with access to them (analysts are staff)
    const teamOf = new Map();
    for (const u of users) {
      if (u.clientKey && !isTeamKey(u.clientKey) && u.kind !== "analyst") (teamOf.get(u.clientKey) || teamOf.set(u.clientKey, new Set()).get(u.clientKey)).add(u.uid);
      if (u.kind !== "analyst") for (const k of Object.keys(u.access || {})) (teamOf.get(k) || teamOf.set(k, new Set()).get(k)).add(u.uid);
    }
    const reach = new Map();
    for (const u of users) {
      if (isStaff(u.uid)) continue;
      const keys = isTeamKey(u.clientKey) ? Object.keys(u.access || {}) : u.clientKey ? [u.clientKey] : [];
      const set = new Set([u.uid, ...staffIds]);
      for (const k of keys) for (const x of teamOf.get(k) || []) set.add(x);
      reach.set(u.uid, [...set].sort());
    }
    const emails = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u.uid]));
    // write only what changed
    const cur = async (c) => new Map((await getDocs(collection(db, c))).docs.map((d) => [d.id, d.data()]));
    const [curNames, curReach, curEmails] = await Promise.all([cur("chatNames"), cur("chatReach"), cur("friendEmails")]);
    const ops = [];
    for (const [uid, v] of names) { const c = curNames.get(uid); if (!c || c.name !== v.name || c.role !== v.role || c.title !== v.title) ops.push((b) => b.set(doc(db, "chatNames", uid), { ...v, updatedAt: serverTimestamp() })); }
    for (const [uid, uids] of reach) { const c = curReach.get(uid); if (!c || JSON.stringify(c.uids) !== JSON.stringify(uids)) ops.push((b) => b.set(doc(db, "chatReach", uid), { uids })); }
    for (const uid of curReach.keys()) if (!reach.has(uid)) ops.push((b) => b.delete(doc(db, "chatReach", uid))); // (access removed)
    for (const [email, uid] of emails) if (curEmails.get(email)?.uid !== uid) ops.push((b) => b.set(doc(db, "friendEmails", email), { uid }));
    for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach((f) => f(b)); await b.commit(); }
  })().catch((err) => console.warn("chat sync", err)).finally(() => { running = null; }));
}
