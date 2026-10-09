// Who each player can chat with: chatCircles/{playerKey} = { uids, names, roles, playerName }.
//   The player, their team (coaches, caddies, analysts given access to them) and Callaway staff (the admin and
//   every analyst). Firestore rules check every chat that involves a player against this list, so a player
//   can only reach their own team and Callaway staff. Only the admin writes it: the app refreshes it when the
//   admin signs in, and when the admin opens Chat.
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, adminUids } from "./firebase-init.js";
import { isTeamKey } from "./data.js";
import { getState } from "./auth.js";
import { adminAllClients } from "./store.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const ROLE_NAMES = { player: "Player", coach: "Coach", caddie: "Caddie", caddy: "Caddie", analyst: "Analyst", admin: "Callaway", other: "Team" };
export const roleName = (r) => ROLE_NAMES[r] || (r ? r[0].toUpperCase() + r.slice(1) : "");

let running = null;
export function syncChatCircles() {
  const state = getState();
  if (!state.isAdmin) return Promise.resolve();
  return (running ||= (async () => {
    const users = (await getDocs(collection(db, "users"))).docs.map((d) => ({ uid: d.id, ...d.data() }));
    let labels = new Map();
    try { labels = (await adminAllClients()).labels; } catch { /* names only */ }
    const nameOf = (u) => u.name || u.email || "Someone";
    const staff = [
      ...adminUids.map((uid) => ({ uid, name: uid === state.user.uid ? (state.profile?.name || "Callaway") : "Callaway", role: "admin" })),
      ...users.filter((u) => u.kind === "analyst").map((u) => ({ uid: u.uid, name: nameOf(u), role: "analyst" })),
    ];
    const keys = new Set(users.filter((u) => u.clientKey && !isTeamKey(u.clientKey) && u.kind !== "analyst").map((u) => u.clientKey));
    for (const key of keys) {
      const people = new Map();
      for (const u of users) {
        if (u.clientKey === key && !isTeamKey(u.clientKey)) people.set(u.uid, { name: nameOf(u), role: "player" });
        else if (u.kind !== "analyst" && u.access?.[key]) people.set(u.uid, { name: nameOf(u), role: u.access[key].role || "other" });
      }
      for (const s of staff) if (!people.has(s.uid)) people.set(s.uid, { name: s.name, role: s.role });
      const uids = [...people.keys()].sort();
      const next = { uids, names: Object.fromEntries([...people].map(([k, v]) => [k, v.name])), roles: Object.fromEntries([...people].map(([k, v]) => [k, v.role])), playerName: labels.get(key) || [...people.values()].find((p) => p.role === "player")?.name || key };
      try {
        const cur = await getDoc(doc(db, "chatCircles", key));
        const d = cur.exists() ? cur.data() : null;
        if (!d || JSON.stringify([d.uids, d.names, d.roles, d.playerName]) !== JSON.stringify([next.uids, next.names, next.roles, next.playerName])) await setDoc(doc(db, "chatCircles", key), { ...next, updatedAt: serverTimestamp() });
      } catch (err) { console.warn("chat circle", key, err); }
    }
  })().finally(() => { running = null; }));
}
