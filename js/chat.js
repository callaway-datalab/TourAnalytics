// Chat (update 101): the same page for everyone, from the admin to analysts, players, coaches and caddies.
//   • Direct messages and named groups (chatRooms/{id}, messages in chatRooms/{id}/messages); anyone in a group
//     can add people or leave
//   • (Company chat was taken out in update 141: message analysts directly, or make a group)
//   • Friends: ask someone by their email; once they accept you can message each other. Callaway's analysts are
//     on everyone's list from the start, and can't be removed (update 141)
// What differs is only who you can message: the admin and analysts anyone; everyone else Callaway staff, their
// own team and their friends. The Firestore rules check this too (chatReach, chatFriends; see chatCircles.js).
// (update 170) Callaway's analysts are anonymous from the outside: players, coaches and caddies message their friends
// and team, or "Callaway Analyst", and every analyst's message shows to them as Callaway Analyst. Inside, the admin
// and every analyst see each Callaway Analyst conversation, and mark it Working on it or Unable (the admin can
// also Assign it), so everyone knows who's answering. That status (chatTriage/{roomId}) only staff can read.
// (update 175) Delete a chat: it goes from your list, with its messages so far (chatHidden/{uid}: room → when).
// Everyone else in it keeps theirs; a new message brings it back with just what's new. The admin can also
// delete a chat for everyone.
import {
  collection, addDoc, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, orderBy, query, where, limit, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { el, mount, formatWhen, confirmAction } from "./ui.js";
import { getState } from "./auth.js";
import { isTeamKey } from "./data.js";
import { syncChatCircles, roleName } from "./chatCircles.js";
import { adminUids } from "./firebase-init.js";

export function watchStaffChat(cb) {
  return onSnapshot(query(collection(db, "staffChat"), orderBy("createdAt", "asc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb(null));
}

const msgsOf = (roomId) => collection(db, "chatRooms", roomId, "messages");
const readsOf = (roomId) => collection(db, "chatRooms", roomId, "reads"); // (update 176) read receipts
const readKey = (uid, roomId) => `chatRead:${uid}:${roomId}`;
const lastRead = (uid, roomId) => { try { return Number(localStorage.getItem(readKey(uid, roomId))) || 0; } catch { return 0; } };
const markRead = (uid, roomId) => { try { localStorage.setItem(readKey(uid, roomId), String(Date.now())); } catch { /* fine */ } window.dispatchEvent(new Event("ta-chat-read")); };
const ms = (t) => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : 0);
const isStaffState = (state) => state.isAdmin || state.profile?.kind === "analyst";

/** Unread chats (and friend requests waiting for you), for the header badge. */
export function watchChatUnread(uid, cb) {
  let rooms = [], requests = 0;
  const count = () => cb(rooms.filter((r) => ms(r.lastAt) > lastRead(uid, r.id) && r.lastBy && r.lastBy !== uid).length + requests);
  const a = onSnapshot(query(collection(db, "chatRooms"), where("members", "array-contains", uid)), (s) => { rooms = s.docs.map((d) => ({ id: d.id, ...d.data() })); count(); }, () => {});
  const b = onSnapshot(query(collection(db, "friendRequests"), where("to", "==", uid)), (s) => { requests = s.size; count(); }, () => {});
  window.addEventListener("ta-chat-read", count);
  return () => { a(); b(); window.removeEventListener("ta-chat-read", count); };
}

export const renderStaffChat = (container, opts) => renderChat(container, opts);

export function renderChat(container, { flash }) {
  const state = getState();
  const uid = state.user.uid;
  const myName = state.profile?.name || state.user.displayName || state.user.email || "Me";
  const staff = isStaffState(state);
  let rooms = [], current = null, stopMsgs = () => {}, roomsKey = "", autoOpened = false, caOpen = true;
  // people: uid -> { name, role, title }; who I may message: staff -> everyone, else reach + friends
  const people = new Map();
  let reach = [], friends = [], incoming = [], outgoing = [];
  // Callaway's analysts (and the admin): everyone's contacts from the start (update 144)
  let staffIds = [...adminUids];
  const unsubs = [];
  const redraw = () => { drawList(); drawHead(); if (current === NEW) drawCompose(); };
  const NEW = "__new"; // the New message page (update 153)

  // ---- me: my name in the chat directory, my email (so friends can find me) ----
  if (state.isAdmin) syncChatCircles().catch(() => {});
  else {
    const role = staff ? "analyst" : isTeamKey(state.profile?.clientKey) ? "team" : "player";
    getDoc(doc(db, "chatNames", uid)).then((d) => (!d.exists() ? setDoc(doc(db, "chatNames", uid), { name: myName, role, updatedAt: serverTimestamp() })
      : d.data().name !== myName ? updateDoc(doc(db, "chatNames", uid), { name: myName, updatedAt: serverTimestamp() }) : null)).catch(() => {});
    const email = String(state.user.email || "").toLowerCase();
    if (email) setDoc(doc(db, "friendEmails", email), { uid }).catch(() => {});
  }

  // ---- who's who ----
  const nameWatch = new Map();
  const watchName = (id) => {
    if (staff || people.has(id) || nameWatch.has(id)) return;
    if (!staff && (staffIds.includes(id) || adminUids.includes(id))) return; // (update 170: analysts stay anonymous)
    nameWatch.set(id, onSnapshot(doc(db, "chatNames", id), (d) => { if (d.exists()) { people.set(id, d.data()); redraw(); } }, () => {}));
  };
  if (staff) {
    // (update 177: someone whose account is gone drops out)
    let named = new Set();
    unsubs.push(onSnapshot(collection(db, "chatNames"), (s) => { const now = new Set(s.docs.map((d) => d.id)); for (const id of named) if (!now.has(id)) people.delete(id); named = now; s.docs.forEach((d) => people.set(d.id, d.data())); redraw(); }, () => {}));
    // (update 164) the admin: everyone from the user list too, so an analyst shows even before the chat directory has them
    if (state.isAdmin) import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ getDocs }) => getDocs(collection(db, "users"))).then((snap) => {
      let added = false;
      snap.docs.forEach((d) => { const u = d.data(); if (people.has(d.id) || d.id === uid) return; added = true;
        people.set(d.id, { name: u.name || u.email || "Someone", role: u.kind === "analyst" ? "analyst" : isTeamKey(u.clientKey) ? "team" : "player", title: u.kind === "analyst" ? "Analyst" : "" });
        if (u.kind === "analyst" && !staffIds.includes(d.id)) staffIds = [...staffIds, d.id]; });
      if (added) redraw();
    }).catch(() => {});
  } else {
    unsubs.push(onSnapshot(doc(db, "chatReach", uid), (d) => { reach = d.exists() ? d.data().uids || [] : []; reach.forEach(watchName); redraw(); }, () => {}));
  }
  unsubs.push(onSnapshot(doc(db, "chatStaff", "all"), (d) => { staffIds = [...new Set([...adminUids, ...(d.exists() ? d.data().uids || [] : [])])]; staffIds.forEach(watchName); redraw(); }, () => {}));
  adminUids.forEach((id) => watchName(id));
  unsubs.push(onSnapshot(doc(db, "chatFriends", uid), (d) => { friends = d.exists() ? d.data().uids || [] : []; friends.forEach(watchName); redraw(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "friendRequests"), where("to", "==", uid)), (s) => { incoming = s.docs.map((d) => ({ id: d.id, ...d.data() })); incoming.forEach((r) => watchName(r.from)); redraw(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "friendRequests"), where("from", "==", uid)), (s) => { outgoing = s.docs.map((d) => ({ id: d.id, ...d.data() })); outgoing.forEach((r) => watchName(r.to)); redraw(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "chatRooms"), where("members", "array-contains", uid)), (s) => {
    const next = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const k = JSON.stringify(next); if (k === roomsKey) return;
    roomsKey = k; rooms = next;
    rooms.forEach((r) => r.members.forEach(watchName));
    redraw();
    // open the latest conversation the first time they load; phones still start on the list
    if (!current && !autoOpened && rooms.length) { autoOpened = true; open(allRooms()[0].id); shell.classList.remove("show-thread"); }
  }, () => {}));

  const isStaffId = (id) => staffIds.includes(id) || adminUids.includes(id) || ["admin", "analyst"].includes(people.get(id)?.role);
  // (update 170) to everyone outside Callaway, every analyst (and the admin) is just "Callaway Analyst"
  const nameOf = (id) => (id === uid ? "You" : !staff && isStaffId(id) ? "Callaway Analyst" : people.get(id)?.name || (staff && adminUids.includes(id) ? "Admin" : staffIds.includes(id) ? "Callaway Analyst" : "Someone"));
  const roleOf = (id) => { if (!staff && isStaffId(id)) return "Callaway"; const p = people.get(id); return p ? p.title || roleName(p.role) : staffIds.includes(id) ? "Callaway" : ""; };
  // every Callaway analyst (and the admin) the chat knows of
  const allStaff = () => [...new Set([...adminUids, ...staffIds, ...[...people.keys()].filter((id) => ["admin", "analyst"].includes(people.get(id)?.role))])];
  // who I can message, in sections
  function contacts() {
    // (update 177) only people with an account (in the chat directory)
    const others = staff ? [...new Set([...people.keys(), ...staffIds])].filter((id) => id !== uid && (people.has(id) || adminUids.includes(id))) : [...new Set([...reach, ...friends])].filter((id) => id !== uid && !isStaffId(id) && people.has(id));
    const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
    const callaway = others.filter(isStaffId).sort(byName);
    const friendIds = friends.filter((id) => id !== uid && !isStaffId(id)).sort(byName);
    const rest = others.filter((id) => !isStaffId(id) && !friendIds.includes(id)).sort(byName);
    return [{ title: "Callaway analysts", ids: callaway }, { title: staff ? "Everyone" : "Your team", ids: rest }, { title: "Friends", ids: friendIds }].filter((x) => x.ids.length);
  }
  // "Callaway Analyst" (update 152; 153: always to the admin too): everyone's own conversation with Callaway's analysts (and the admin), always there
  const caId = `ca_${uid}`;
  const STAFF_ROOM = "ca_staff"; // (update 164) the analysts' own chat
  // (update 177) whose Callaway Analyst chat it is: the uid in its id (staff can start one for a player)
  const ownerOf = (r) => (r.callaway && !r.staffRoom && String(r.id || "").startsWith("ca_") ? String(r.id).slice(3) : r.createdBy);
  const roomName = (r) => (r.staffRoom ? "Callaway Analyst" : r.callaway ? (ownerOf(r) === uid ? "Callaway Analyst" : `${nameOf(ownerOf(r))} \u00b7 Callaway Analyst`) : r.type === "dm" ? nameOf(r.members.find((m) => m !== uid) || uid) : r.name || "Group");
  // in your Callaway Analyst chat, Callaway's replies show as "Callaway Analyst (Sam)"
  const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  // (update 170) outside Callaway every analyst is "Callaway Analyst"; inside, staff see which of them wrote it
  const authorOf = (r, m) => (!staff ? (isStaffId(m.uid) ? "Callaway Analyst" : m.name || nameOf(m.uid))
    : isStaffId(m.uid) ? nameOf(m.uid) : m.name || nameOf(m.uid));
  const roomNow = () => rooms.find((x) => x.id === current);
  let hidden = {}; // (update 175) roomId → when you deleted it (ms)
  // (server time; while a fresh one is still on its way, the time it was deleted here)
  unsubs.push(onSnapshot(doc(db, "chatHidden", uid), (d) => { const raw = (d.exists() && d.data().rooms) || {}; hidden = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, ms(v) || Number(v) || hidden[k] || 0])); redraw(); }, () => {}));
  const goneFor = (r) => hidden[r.id] && r.lastAt <= hidden[r.id] && r.id !== caId && r.id !== STAFF_ROOM; // (those two stay listed: just cleared)
  const allRooms = () => rooms.map((r) => ({ ...r, lastAt: ms(r.lastAt) || ms(r.createdAt) })).filter((r) => !goneFor(r)).sort((a, b) => b.lastAt - a.lastAt);
  const unread = (r) => r.lastAt > lastRead(uid, r.id) && r.lastBy && r.lastBy !== uid;

  // ---- layout: conversations | thread (on phones one at a time) ----
  const list = el("ul", { class: "chat-rooms" });
  const head = el("div", { class: "chat-thread-head" });
  const msgs = el("ol", { class: "chat-list", "aria-live": "polite" });
  const box = el("textarea", { rows: 2, maxLength: 2000, placeholder: "Message\u2026", "aria-label": "Message", enterkeyhint: "send" });
  const sendBtn = el("button", { class: "btn", type: "submit" }, "Send");
  const form = el("form", { class: "chat-form", onSubmit: (e) => { e.preventDefault(); send(); } }, [box, sendBtn]);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  const newDm = el("button", { type: "button", class: "btn ghost chat-new-btn" }, "\u270E  New message");
  const picker = el("div", { class: "chat-picker", hidden: true }); // (adding people to an open chat)
  const compose = el("div", { class: "chat-compose", hidden: true });
  const shell = el("section", { class: "panel chat chat-shell" }, [
    el("aside", { class: "chat-side" }, [el("div", { class: "chat-side-top" }, [el("h3", {}, "Chats"), el("div", { class: "chat-new" }, [newDm])]), list]),
    el("div", { class: "chat-main" }, [head, picker, compose, msgs, form]),
  ]);
  mount(container, shell);

  function drawList() {
    const all = allRooms();
    const icon = (r) => (r.callaway ? "\u2605" : r.type === "group" ? "\u25CE" : "\u25CF");
    const item = (r) => {
      const other = r.type === "dm" ? r.members.find((m) => m !== uid) : null;
      const b = el("button", { type: "button", class: "chat-room" + (r.callaway ? " chat-ca" : "") + (r.id === current ? " on" : ""), "aria-current": r.id === current ? "true" : null }, [
        el("span", { class: "chat-room-icon", "aria-hidden": "true" }, icon(r)),
        el("span", { class: "chat-room-text" }, [el("strong", {}, roomName(r)), el("span", { class: "muted" }, r.lastText ? r.lastText.slice(0, 60) : r.callaway ? "Message Callaway's analysts" : r.type === "group" ? `${r.members.length} people` : other ? roleOf(other) : ""),
          staff && r.callaway && !r.staffRoom && r.lastText ? (() => { const st = statusOf(r); return el("span", { class: `chat-tri-chip st-${st.state}` }, statusText(st)); })() : null]),
        unread(r) && r.id !== current ? el("span", { class: "chat-dot", "aria-label": "Unread" }) : null,
      ]);
      b.addEventListener("click", () => (r.id === caId ? startCallaway() : open(r.id)));
      return el("li", {}, b);
    };
    // Callaway Analyst: always first, starred (yours; Callaway's staff see each person's)
    const mine = staff ? null : all.find((r) => r.id === caId) || { id: caId, callaway: true, createdBy: uid, members: [], type: "group", lastText: "" };
    const rest = all.filter((r) => r.id !== caId && r.id !== STAFF_ROOM && !(staff && r.callaway));
    // (update 163) Callaway's staff: a permanent, starred Callaway Analyst at the top too, holding every person's
    // Callaway Analyst conversation (newest first); tap it to open or fold the list
    // (update 164) the star opens the Callaway Analyst team chat (every analyst and the admin); the arrow folds the
    // players' and teams' Callaway Analyst conversations under it
    const caRooms = staff ? all.filter((r) => r.callaway) : [];
    const team = staff ? all.find((r) => r.id === STAFF_ROOM) : null;
    const caHead = staff ? (() => {
      const any = [...caRooms, ...(team ? [team] : [])].some((r) => unread(r) && r.id !== current);
      const b = el("button", { type: "button", class: "chat-room chat-ca chat-ca-head" + (current === STAFF_ROOM ? " on" : "") }, [
        el("span", { class: "chat-room-icon", "aria-hidden": "true" }, "\u2605"),
        el("span", { class: "chat-room-text" }, [el("strong", {}, "Callaway Analyst"), el("span", { class: "muted" }, team?.lastText ? team.lastText.slice(0, 60) : "Your analysts' chat")]),
        any ? el("span", { class: "chat-dot", "aria-label": "Unread" }) : null,
      ]);
      b.addEventListener("click", () => startStaffRoom());
      const fold = el("button", { type: "button", class: "chat-ca-caret", "aria-expanded": caOpen ? "true" : "false", "aria-label": caOpen ? "Hide the players' conversations" : "Show the players' conversations", title: `${caRooms.length} conversation${caRooms.length === 1 ? "" : "s"} with players and teams` }, [caRooms.length ? String(caRooms.length) : "", caOpen ? " \u25B4" : " \u25BE"]);
      fold.addEventListener("click", (e) => { e.stopPropagation(); caOpen = !caOpen; drawList(); });
      const sub = caOpen ? (caRooms.length ? caRooms.map((r) => { const li = item(r); li.classList.add("chat-ca-sub"); return li; }) : [el("li", { class: "chat-ca-sub chat-empty muted small" }, "No player has messaged Callaway Analyst yet.")]) : [];
      return [el("li", { class: "chat-ca-row" }, [b, fold]), ...sub];
    })() : [];
    const asks = incoming.map((r) => {
      const ok = el("button", { type: "button", class: "link chat-accept" }, "Accept"), no = el("button", { type: "button", class: "link" }, "Decline");
      ok.addEventListener("click", () => accept(r));
      no.addEventListener("click", async () => { try { await deleteDoc(doc(db, "friendRequests", r.id)); } catch { flash("Couldn't decline that.", "error"); } });
      return el("li", { class: "chat-ask" }, [el("span", {}, [el("strong", {}, nameOf(r.from)), " wants to chat with you"]), el("span", { class: "chat-friend-btns" }, [ok, no])]);
    });
    mount(list, [...asks, mine ? item(mine) : null, ...caHead, ...(rest.length ? rest.map(item) : [el("li", { class: "empty chat-empty" }, "No other chats yet. Start one with New message.")])]);
  }

  function drawHead() {
    if (current === NEW) {
      const back = el("button", { type: "button", class: "link chat-back", "aria-label": "Back to chats" }, "\u2039 Chats");
      back.addEventListener("click", () => { open(null); });
      mount(head, [back, el("div", { class: "chat-title" }, [el("strong", {}, "New message")])]);
      return;
    }
    const r = allRooms().find((x) => x.id === current);
    if (!r) { mount(head, null); return; }
    const back = el("button", { type: "button", class: "link chat-back", "aria-label": "Back to chats" }, "\u2039 Chats");
    back.addEventListener("click", () => shell.classList.remove("show-thread"));
    const other = r.type === "dm" ? r.members.find((m) => m !== uid) : null;
    const sub = r.staffRoom ? `${r.members.length} people \u00b7 ${r.members.map(nameOf).join(", ")}` : r.callaway ? (ownerOf(r) === uid ? "Callaway's analysts" : `${nameOf(ownerOf(r))} \u00b7 to Callaway's analysts`) : r.type === "dm" ? (roleOf(other) || "Direct message") : [...new Set(r.members.map(nameOf))].join(", ");
    const actions = [];
    if (!r.callaway && !r.staffRoom) {
      const plus = el("button", { type: "button", class: "btn ghost chat-plus", title: "Add people", "aria-label": "Add people" }, "\uFF0B");
      plus.addEventListener("click", () => openPicker("add", r));
      actions.push(plus);
    }
    if (r.type === "group" && !r.callaway && !r.staffRoom) {
      const leave = el("button", { type: "button", class: "link danger" }, "Leave");
      leave.addEventListener("click", async () => {
        if (!confirmAction(`Leave \u201c${r.name}\u201d?`)) return;
        try { await updateDoc(doc(db, "chatRooms", r.id), { members: r.members.filter((m) => m !== uid) }); open(null); }
        catch { flash("Couldn't leave that group.", "error"); }
      });
      actions.push(leave);
    }
    // (update 175) Delete: from your list (everyone else keeps it); the admin can also delete it for everyone
    const del = el("button", { type: "button", class: "link danger chat-delete" }, "Delete");
    del.addEventListener("click", () => deleteForMe(r));
    actions.push(del);
    if (state.isAdmin) {
      const all = el("button", { type: "button", class: "link danger chat-delete-all" }, "Delete for everyone");
      all.addEventListener("click", () => deleteForAll(r));
      actions.push(all);
    }
    mount(head, [back, el("div", { class: "chat-title" }, [el("strong", {}, roomName(r)), el("span", { class: "muted small" }, sub)]), el("div", { class: "chat-actions" }, actions),
      staff && r.callaway && !r.staffRoom ? triageBar(r) : null]);
  }

  async function deleteForMe(r) {
    const always = r.id === caId || r.id === STAFF_ROOM;
    if (!confirmAction(always ? `Clear \u201c${roomName(r)}\u201d? Its messages so far go from your view (it stays in your list, so you can always reach Callaway). Everyone else keeps theirs.`
      : `Delete \u201c${roomName(r)}\u201d? It goes from your list, with its messages so far. Everyone else in it keeps theirs, and if someone writes again it comes back with just the new messages.`)) return;
    try {
      hidden = { ...hidden, [r.id]: Math.max(Date.now(), r.lastAt || 0) };
      await setDoc(doc(db, "chatHidden", uid), { rooms: { [r.id]: serverTimestamp() } }, { merge: true });
      if (always) open(r.id); else open(null);
      flash(always ? "Cleared." : "Chat deleted.", "ok");
    } catch { flash("Couldn't delete that chat. (Republish the Firestore rules from update 175 if you haven't.)", "error"); }
  }
  async function deleteForAll(r) {
    if (!confirmAction(`Delete \u201c${roomName(r)}\u201d for everyone in it? Every message goes, for good.`)) return;
    try {
      const snap = await getDocs(msgsOf(r.id));
      for (let i = 0; i < snap.docs.length; i += 400) { const b = writeBatch(db); snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); }
      if (rooms.some((x) => x.id === r.id)) await deleteDoc(doc(db, "chatRooms", r.id));
      if (r.callaway) await deleteDoc(doc(db, "chatTriage", r.id)).catch(() => {});
      open(null);
      flash("Chat deleted for everyone.", "ok");
    } catch { flash("Couldn't delete that chat for everyone.", "error"); }
  }

  // ---- (update 170) who's answering a Callaway Analyst conversation: staff only ----
  const triage = new Map(); // roomId → { state: "working" | "assigned" | "answered" | "open", by, assignedBy, unable: [], at }
  if (staff) unsubs.push(onSnapshot(collection(db, "chatTriage"), (snap) => { triage.clear(); snap.docs.forEach((d) => triage.set(d.id, d.data())); redraw(); }, () => {}));
  /** Where a conversation stands: answered goes back to open when the player writes again. */
  function statusOf(r) {
    const t = triage.get(r.id) || {};
    const unable = (t.unable || []).filter((x) => x !== t.by);
    const newer = r.lastBy && !isStaffId(r.lastBy) && ms(r.lastAt) > ms(t.at);
    const state = !t.state || (t.state === "answered" && newer) ? "open" : t.state;
    return { ...t, state, unable, waiting: newer };
  }
  const statusText = (st) => (st.state === "working" ? `${st.by === uid ? "You're" : `${nameOf(st.by)} is`} working on it`
    : st.state === "assigned" ? `Assigned to ${st.by === uid ? "you" : nameOf(st.by)}${st.assignedBy && st.assignedBy !== st.by ? ` by ${st.assignedBy === uid ? "you" : nameOf(st.assignedBy)}` : ""}`
    : st.state === "answered" ? `Answered by ${st.by === uid ? "you" : nameOf(st.by)}`
    : st.waiting || !st.state ? "Open \u00b7 nobody's on it yet" : "Open");
  async function setTriage(roomId, data) {
    try { await setDoc(doc(db, "chatTriage", roomId), { ...data, at: serverTimestamp() }); }
    catch { flash("Couldn't update that. (Republish the Firestore rules from update 170 if you haven't.)", "error"); }
  }
  function triageBar(r) {
    const st = statusOf(r);
    const btn = (label, cls, fn, on = false) => { const b = el("button", { type: "button", class: `chat-tri-btn ${cls}${on ? " on" : ""}`, "aria-pressed": String(on) }, label); b.addEventListener("click", fn); return b; };
    const mineWorking = (st.state === "working" || st.state === "assigned") && st.by === uid;
    const working = btn("\u{1F6E0} Working on it", "work", () => setTriage(r.id, { state: "working", by: uid, unable: st.unable.filter((x) => x !== uid), assignedBy: null }), st.state === "working" && st.by === uid);
    const iUnable = st.unable.includes(uid);
    const unable = btn("Unable", "unable", () => setTriage(r.id, iUnable ? { state: st.state, by: st.by || null, assignedBy: st.assignedBy || null, unable: st.unable.filter((x) => x !== uid) }
      : { ...(mineWorking ? { state: "open", by: null, assignedBy: null } : { state: st.state, by: st.by || null, assignedBy: st.assignedBy || null }), unable: [...st.unable, uid] }), iUnable);
    // the admin: hand it to one analyst
    const assign = state.isAdmin ? (() => {
      const sel = el("select", { class: "chat-tri-assign", "aria-label": "Assign to" }, [el("option", { value: "" }, "Assign\u2026"),
        ...allStaff().map((id) => el("option", { value: id, selected: st.state === "assigned" && st.by === id }, id === uid ? "Me" : nameOf(id)))]);
      sel.addEventListener("change", () => { if (sel.value) setTriage(r.id, { state: "assigned", by: sel.value, assignedBy: uid, unable: st.unable.filter((x) => x !== sel.value) }); });
      return sel;
    })() : null;
    return el("div", { class: `chat-triage st-${st.state}` }, [
      el("span", { class: "chat-tri-status" }, [el("i", { "aria-hidden": "true" }), statusText(st), st.unable.length ? el("span", { class: "muted" }, ` \u00b7 Unable: ${st.unable.map((x) => (x === uid ? "you" : nameOf(x))).join(", ")}`) : null]),
      el("span", { class: "chat-tri-acts" }, [working, unable, assign]),
      el("span", { class: "muted small chat-tri-note" }, "Only Callaway's analysts see this. The player sees every reply as Callaway Analyst."),
    ]);
  }

  function open(roomId) {
    current = roomId;
    stopMsgs(); stopMsgs = () => {};
    picker.hidden = true; compose.hidden = roomId !== NEW; msgs.hidden = roomId === NEW;
    drawList(); drawHead();
    if (roomId === NEW) { mount(msgs, null); form.hidden = false; shell.classList.add("show-thread"); drawCompose(); return; }
    if (!roomId) { mount(msgs, el("li", { class: "empty" }, "Pick a chat, or start one.")); form.hidden = true; shell.classList.remove("show-thread"); return; }
    form.hidden = false;
    shell.classList.add("show-thread");
    mount(msgs, el("li", { class: "empty" }, "Loading\u2026"));
    // (update 176) read receipts: chatRooms/{id}/reads/{uid} = when each person last looked. Your own message can be
    // unsent until someone else in the chat has seen it; your latest one says Sent or Seen.
    let first = true, items = [], reads = {}, gotMsgs = false;
    const seenBy = (m) => { const t = ms(m.createdAt); return !t ? [] : (roomNow()?.members || []).filter((u) => u !== m.uid && (reads[u] || 0) >= t); };
    const render = () => {
      if (!gotMsgs || current !== roomId) return;
      const atBottom = first || msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
      const lastMine = [...items].reverse().find((m) => m.uid === uid);
      const room = roomNow();
      mount(msgs, items.length ? items.map((m) => {
        const mine = m.uid === uid, seen = seenBy(m), canUnsend = mine && !!m.createdAt && !seen.length;
        const act = canUnsend ? el("button", { type: "button", class: "chat-unsend", title: "Nobody else has seen it yet: take it back" }, "Unsend")
          : state.isAdmin ? el("button", { type: "button", class: "chat-del", "aria-label": "Delete message", title: "Delete (admin)" }, "\u2715") : null;
        act?.addEventListener("click", () => (canUnsend ? unsend(roomId, m) : adminDelete(roomId, m)));
        const status = m === lastMine && m.createdAt ? el("span", { class: `chat-seen${seen.length ? " on" : ""}` },
          seen.length ? (room?.type === "dm" || (room?.members?.length || 0) <= 2 ? "Seen" : `Seen by ${seen.length}`) : "Sent") : null;
        return el("li", { class: "chat-msg" + (mine ? " mine" : "") }, [
          el("div", { class: "chat-meta" }, [el("strong", {}, mine ? "You" : authorOf(room, m)), el("span", { class: "muted" }, m.createdAt ? formatWhen(m.createdAt) : "sending\u2026"), act]),
          el("p", { class: "chat-body" }, m.body),
          status,
        ]);
      }) : el("li", { class: "empty" }, "No messages yet. Say hello."));
      if (atBottom) msgs.scrollTop = msgs.scrollHeight;
      first = false;
    };
    let msgsKey = null;
    const stopA = onSnapshot(query(msgsOf(roomId), orderBy("createdAt", "asc")), (s) => {
      const next = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !m.createdAt || ms(m.createdAt) > (hidden[roomId] || 0)); // (update 175: not what you deleted)
      const k = JSON.stringify(next.map((m) => [m.id, ms(m.createdAt)]));
      if (k === msgsKey) return;
      msgsKey = k; items = next; gotMsgs = true;
      render();
      markRead(uid, roomId); drawList();
      sawLatest(roomId, items);
    }, () => mount(msgs, el("li", { class: "empty" }, "This chat isn't available. (Republish the Firestore rules from the latest update if you haven't.)")));
    const stopB = onSnapshot(readsOf(roomId), (s) => { reads = Object.fromEntries(s.docs.map((d) => [d.id, ms(d.data().at)])); render(); }, () => {});
    const onVis = () => { if (document.visibilityState === "visible" && current === roomId) sawLatest(roomId, items); };
    document.addEventListener("visibilitychange", onVis);
    stopMsgs = () => { stopA(); stopB(); document.removeEventListener("visibilitychange", onVis); };
  }
  // (update 176) tell the others you've seen it (only when the page is in view, and only for something new from them)
  const wroteRead = new Map();
  function sawLatest(roomId, items) {
    if (document.visibilityState !== "visible") return;
    const newest = Math.max(0, ...items.filter((m) => m.uid !== uid).map((m) => ms(m.createdAt)));
    if (!newest || newest <= (wroteRead.get(roomId) || 0)) return;
    wroteRead.set(roomId, newest);
    setDoc(doc(readsOf(roomId), uid), { at: serverTimestamp() }).catch(() => {});
  }
  async function unsend(roomId, m) {
    try {
      // (checked again just now: if someone saw it meanwhile, it stays)
      const snap = await getDocs(readsOf(roomId));
      const t = ms(m.createdAt), members = roomNow()?.members || [];
      if (snap.docs.some((d) => d.id !== uid && members.includes(d.id) && ms(d.data().at) >= t)) { flash("They've just seen it, so it can't be unsent.", "error"); return; }
      await deleteDoc(doc(msgsOf(roomId), m.id));
      await fixPreview(roomId, m);
    } catch { flash("Couldn't unsend that message.", "error"); }
  }
  async function adminDelete(roomId, m) {
    if (!confirmAction("Delete this message for everyone?")) return;
    try { await deleteDoc(doc(msgsOf(roomId), m.id)); await fixPreview(roomId, m); } catch { flash("Couldn't delete that message.", "error"); }
  }
  // the chat list's preview: back to the message before, if this was the latest
  async function fixPreview(roomId, m) {
    const r = rooms.find((x) => x.id === roomId);
    if (!r || r.lastBy !== m.uid || r.lastText !== String(m.body || "").slice(0, 120)) return; // (only when it's the one showing)
    const rest = (await getDocs(query(msgsOf(roomId), orderBy("createdAt", "asc")))).docs.map((d) => d.data()).filter((x) => x.createdAt);
    const prev = rest.at(-1);
    await updateDoc(doc(db, "chatRooms", roomId), prev ? { lastAt: prev.createdAt, lastText: String(prev.body || "").slice(0, 120), lastBy: prev.uid } : { lastAt: r.createdAt || m.createdAt, lastText: "", lastBy: "" }).catch(() => {});
  }

  async function send() {
    const body = box.value.trim();
    if (!body || !current) return;
    if (current === NEW) {
      if (!to.length) { flash("Add who it's to.", "error"); return; }
      sendBtn.disabled = true;
      try { const id = await roomFor(to); open(id); } catch (err) { flash(err?.notMember ? "You're not in that person's Callaway Analyst chat yet: the admin's next visit to Chat adds every analyst to it." : "Couldn't start that chat. (Republish the Firestore rules from the latest update if you haven't.)", "error"); sendBtn.disabled = false; return; }
      to = [];
    }
    sendBtn.disabled = true;
    try {
      const room = roomNow();
      // (update 170) staff writing where outsiders can read it: signed as Callaway Analyst (staff still see who)
      const outsiders = staff && room && !room.staffRoom && room.members.some((m) => !isStaffId(m));
      await addDoc(msgsOf(current), { uid, name: outsiders ? "Callaway Analyst" : myName, body, createdAt: serverTimestamp() });
      if (staff && room?.callaway && !room.staffRoom) setTriage(current, { state: "answered", by: uid, assignedBy: null, unable: [] });
      await updateDoc(doc(db, "chatRooms", current), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
      box.value = ""; box.focus();
    } catch { flash("Couldn't send that message. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    finally { sendBtn.disabled = false; }
  }

  // ---- New message (update 153, like Teams): To: people picked from a search, a + to add more ----
  const personLabel = (id) => { const r = roleOf(id); return r ? [nameOf(id), el("span", { class: "muted small" }, ` \u00b7 ${r}`)] : nameOf(id); };
  let to = [];
  // everyone I can message (Callaway's staff, my team, friends; the admin and analysts: everyone)
  const reachable = () => [...new Set(staff ? [...people.keys(), ...allStaff()] : [...reach, ...friends].filter((id) => !isStaffId(id)))].filter((id) => id !== uid);
  /** A search box with matches under it; picking one calls onPick(id). An email not in the list can be asked to chat. */
  function searchBox(onPick, exclude = []) {
    const input = el("input", { type: "search", class: "chat-find", placeholder: "Search for people\u2026", "aria-label": "Search for people", autocomplete: "off" });
    const res = el("ul", { class: "chat-results" });
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const ids = reachable().filter((id) => !exclude.includes(id) && !to.includes(id) && (!q || nameOf(id).toLowerCase().includes(q) || roleOf(id).toLowerCase().includes(q) || (isStaffId(id) && "callaway analyst".includes(q))))
        .sort((a, b) => (isStaffId(b) - isStaffId(a)) || nameOf(a).localeCompare(nameOf(b))).slice(0, q ? 30 : Math.max(8, allStaff().length));
      const items = ids.map((id) => { const b = el("button", { type: "button", class: "chat-person" }, personLabel(id)); b.addEventListener("click", () => { input.value = ""; onPick(id); }); return el("li", {}, b); });
      // (update 170) outside Callaway: one "Callaway Analyst" (the analysts' shared inbox), never a named analyst
      if (!staff && !exclude.length && (!q || "callaway analyst".includes(q) || q.includes("analyst") || q.includes("callaway"))) {
        const b = el("button", { type: "button", class: "chat-person chat-person-ca" }, ["\u2605 Callaway Analyst", el("span", { class: "muted small" }, " \u00b7 any of Callaway's analysts")]);
        b.addEventListener("click", () => { input.value = ""; startCallaway(); });
        items.unshift(el("li", {}, b));
      }
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) {
        const b = el("button", { type: "button", class: "chat-person" }, [`Ask ${q} to chat`, el("span", { class: "muted small" }, " \u00b7 they accept, then you can message")]);
        b.addEventListener("click", () => askEmail(q));
        items.push(el("li", {}, b));
      }
      mount(res, items.length ? items : el("li", { class: "muted small chat-noone" }, q ? "No one by that name. Type their email to ask them to chat." : "No one yet."));
    };
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); res.querySelector("button")?.click(); } });
    draw();
    return { node: el("div", { class: "chat-search" }, [input, res]), focus: () => input.focus() };
  }
  let searching = true;
  function drawCompose() {
    if (current !== NEW) return;
    const chips = to.map((id) => { const x = el("button", { type: "button", class: "chat-chip-x", "aria-label": `Remove ${nameOf(id)}` }, "\u00d7"); x.addEventListener("click", () => { to = to.filter((t) => t !== id); searching = !to.length || searching; drawCompose(); }); return el("span", { class: "chat-chip" }, [nameOf(id), x]); });
    const plus = to.length && !searching ? el("button", { type: "button", class: "btn ghost chat-plus", title: "Add more people", "aria-label": "Add more people" }, "\uFF0B") : null;
    plus?.addEventListener("click", () => { searching = true; drawCompose(); });
    const sb = searching ? searchBox((id) => { to.push(id); searching = false; drawCompose(); box.focus(); }) : null;
    mount(compose, [el("div", { class: "chat-to" }, [el("span", { class: "muted" }, "To:"), ...chips, plus]), sb?.node,
      to.length ? el("p", { class: "muted small" }, to.length === 1 ? "A direct message. Tap + to add more people (a group chat)." : `A group chat with ${to.length} people.`) : null]);
    sb?.focus();
  }
  /** The chat for these people: your direct message with one person, or a new group. */
  async function roomFor(ids) {
    // (update 177) Callaway's staff writing to one player or team member: their Callaway Analyst chat, not a new one
    if (staff && ids.length === 1 && !isStaffId(ids[0])) return playerCa(ids[0]);
    if (ids.length === 1) {
      const id = `dm_${[uid, ids[0]].sort().join("_")}`;
      const snap = await getDoc(doc(db, "chatRooms", id));
      if (!snap.exists()) await setDoc(doc(db, "chatRooms", id), { type: "dm", members: [uid, ids[0]].sort(), createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
      return id;
    }
    const name = ids.map((x) => first(nameOf(x))).join(", ").slice(0, 60);
    const ref = await addDoc(collection(db, "chatRooms"), { type: "group", name, members: [uid, ...ids], createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
    return ref.id;
  }
  // + in an open chat: a group gets them added; a direct message becomes a new group with them
  function openPicker(mode, room) {
    picker.hidden = false;
    const close = el("button", { type: "button", class: "link" }, "Close");
    close.addEventListener("click", () => { picker.hidden = true; });
    const sb = searchBox(async (id) => {
      try {
        if (room.type === "group") { await updateDoc(doc(db, "chatRooms", room.id), { members: [...room.members, id] }); picker.hidden = true; }
        else { const other = room.members.find((m) => m !== uid); const nid = await roomFor([other, id]); open(nid); }
      } catch { flash("Couldn't add them. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    }, room.members);
    mount(picker, [el("p", { class: "chat-picker-title" }, room.type === "group" ? "Add people" : "Add people (starts a group chat)"), sb.node, close]);
    sb.focus();
  }
  async function playerCa(other) {
    const id = `ca_${other}`, ref = doc(db, "chatRooms", id);
    let snap;
    try { snap = await getDoc(ref); } catch { throw Object.assign(new Error("not a member"), { notMember: true }); }
    const team = allStaff();
    if (!snap.exists()) await setDoc(ref, { type: "group", callaway: true, name: "Callaway Analyst", members: [...new Set([other, ...team])], createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
    else if (!team.every((x) => snap.data().members.includes(x))) await updateDoc(ref, { members: [...new Set([...snap.data().members, ...team])] }).catch(() => {});
    return id;
  }
  async function startCallaway() {
    // Callaway's analysts and the admin (always the admin, analysts or not)
    const team = [...new Set([...adminUids, ...staffIds])].filter((x) => x !== uid);
    try {
      const ref = doc(db, "chatRooms", caId), snap = await getDoc(ref);
      if (!snap.exists()) await setDoc(ref, { type: "group", callaway: true, name: "Callaway Analyst", members: [uid, ...team], createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
      else if (!team.every((x) => snap.data().members.includes(x))) await updateDoc(ref, { members: [...new Set([...snap.data().members, ...team])] }); // (analysts added since)
      open(caId);
    } catch { flash("Couldn't open Callaway Analyst. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
  }
  // the Callaway Analyst team chat: every analyst and the admin, kept up to date as analysts are added
  async function startStaffRoom() {
    const team = allStaff();
    if (team.filter((x) => x !== uid).length < 1) {
      current = null; drawList();
      mount(head, el("div", { class: "chat-title" }, [el("strong", {}, "Callaway Analyst"), el("span", { class: "muted small" }, "Your analysts' chat")]));
      mount(msgs, el("li", { class: "empty" }, "No analysts on the portal yet. Give someone Callaway Access as an Analyst on User Access and they'll be here."));
      msgs.hidden = false; compose.hidden = true; form.hidden = true; shell.classList.add("show-thread");
      return;
    }
    try {
      const ref = doc(db, "chatRooms", STAFF_ROOM), snap = await getDoc(ref);
      if (!snap.exists()) await setDoc(ref, { type: "group", staffRoom: true, name: "Callaway Analyst", members: team, createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
      else if (!snap.data().members.includes(uid)) { flash("You'll be added to the Callaway Analyst chat the next time the admin opens Chat."); return; }
      else if (!team.every((x) => snap.data().members.includes(x))) await updateDoc(ref, { members: [...new Set([...snap.data().members, ...team])] }).catch(() => {});
      open(STAFF_ROOM);
    } catch { flash("Couldn't open the Callaway Analyst chat. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
  }
  async function startDm(other) {
    const id = `dm_${[uid, other].sort().join("_")}`;
    try {
      const snap = await getDoc(doc(db, "chatRooms", id));
      if (!snap.exists()) await setDoc(doc(db, "chatRooms", id), { type: "dm", members: [uid, other].sort(), createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
      open(id);
    } catch { flash(`Couldn't start a message with ${nameOf(other)}. (Republish the Firestore rules from the latest update if you haven't.)`, "error"); }
  }

  // ---- asking someone to chat by their email (they accept, then you can message each other) ----
  async function askEmail(email) {
    try {
      const d = await getDoc(doc(db, "friendEmails", email));
      const other = d.exists() ? d.data().uid : null;
      if (!other) { flash("No one with that email uses the portal yet (or they haven't opened Chat).", "error"); return; }
      if (other === uid) { flash("That's you.", "error"); return; }
      if (friends.includes(other)) { to.push(other); searching = false; drawCompose(); return; }
      const back = incoming.find((r) => r.from === other);
      if (back) { await accept(back); return; }
      await setDoc(doc(db, "friendRequests", `${uid}_${other}`), { from: uid, to: other, createdAt: serverTimestamp() });
      flash("Asked. You can message each other once they accept.");
    } catch { flash("Couldn't send that request. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
  }
  async function accept(r) {
    try {
      const theirs = await getDoc(doc(db, "chatFriends", r.from));
      const b = writeBatch(db);
      b.set(doc(db, "chatFriends", uid), { uids: [...new Set([...friends, r.from])], lastAdded: r.from });
      b.set(doc(db, "chatFriends", r.from), { uids: [...new Set([...(theirs.exists() ? theirs.data().uids || [] : []), uid])], lastAdded: uid });
      b.delete(doc(db, "friendRequests", r.id));
      await b.commit();
      flash(`You and ${nameOf(r.from)} are friends now.`);
    } catch { flash("Couldn't accept that request. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
  }
  newDm.addEventListener("click", () => { to = []; searching = true; open(NEW); });

  open(current);
  shell.classList.remove("show-thread"); // phones start on the list
  return () => { stopMsgs(); unsubs.forEach((u) => u()); nameWatch.forEach((u) => u()); };
}
