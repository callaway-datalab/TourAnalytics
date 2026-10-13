// Chat (update 101): the same page for everyone, from the admin to analysts, players, coaches and caddies.
//   • Direct messages and named groups (chatRooms/{id}, messages in chatRooms/{id}/messages); anyone in a group
//     can add people or leave
//   • (Company chat was taken out in update 141: message analysts directly, or make a group)
//   • Friends: ask someone by their email; once they accept you can message each other. Callaway's analysts are
//     on everyone's list from the start, and can't be removed (update 141)
// What differs is only who you can message: the admin and analysts anyone; everyone else Callaway staff, their
// own team and their friends. The Firestore rules check this too (chatReach, chatFriends; see chatCircles.js).
import {
  collection, addDoc, deleteDoc, doc, getDoc, setDoc, updateDoc, onSnapshot, orderBy, query, where, limit, serverTimestamp, writeBatch,
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
  let rooms = [], current = null, stopMsgs = () => {}, roomsKey = "", autoOpened = false;
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
    nameWatch.set(id, onSnapshot(doc(db, "chatNames", id), (d) => { if (d.exists()) { people.set(id, d.data()); redraw(); } }, () => {}));
  };
  if (staff) {
    unsubs.push(onSnapshot(collection(db, "chatNames"), (s) => { people.clear(); s.docs.forEach((d) => people.set(d.id, d.data())); redraw(); }, () => {}));
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

  const nameOf = (id) => (id === uid ? "You" : people.get(id)?.name || (staffIds.includes(id) ? "Callaway Analyst" : "Someone"));
  const roleOf = (id) => { const p = people.get(id); return p ? p.title || roleName(p.role) : staffIds.includes(id) ? "Callaway" : ""; };
  const isStaffId = (id) => staffIds.includes(id) || ["admin", "analyst"].includes(people.get(id)?.role);
  // who I can message, in sections
  function contacts() {
    const others = staff ? [...new Set([...people.keys(), ...staffIds])].filter((id) => id !== uid) : [...new Set([...staffIds, ...reach, ...friends])].filter((id) => id !== uid);
    const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
    const callaway = others.filter(isStaffId).sort(byName);
    const friendIds = friends.filter((id) => id !== uid && !isStaffId(id)).sort(byName);
    const rest = others.filter((id) => !isStaffId(id) && !friendIds.includes(id)).sort(byName);
    return [{ title: "Callaway analysts", ids: callaway }, { title: staff ? "Everyone" : "Your team", ids: rest }, { title: "Friends", ids: friendIds }].filter((x) => x.ids.length);
  }
  // "Callaway Analyst" (update 152; 153: always to the admin too): everyone's own conversation with Callaway's analysts (and the admin), always there
  const caId = `ca_${uid}`;
  const roomName = (r) => (r.callaway ? (r.createdBy === uid ? "Callaway Analyst" : `${nameOf(r.createdBy)} \u00b7 Callaway Analyst`) : r.type === "dm" ? nameOf(r.members.find((m) => m !== uid) || uid) : r.name || "Group");
  // in your Callaway Analyst chat, Callaway's replies show as "Callaway Analyst (Sam)"
  const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const authorOf = (r, m) => (r?.callaway && r.createdBy === uid && m.uid !== uid ? `Callaway Analyst${first(m.name || nameOf(m.uid)) ? ` (${first(m.name || nameOf(m.uid))})` : ""}` : m.name || nameOf(m.uid));
  const roomNow = () => rooms.find((x) => x.id === current);
  const allRooms = () => rooms.map((r) => ({ ...r, lastAt: ms(r.lastAt) || ms(r.createdAt) })).sort((a, b) => b.lastAt - a.lastAt);
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
        el("span", { class: "chat-room-text" }, [el("strong", {}, roomName(r)), el("span", { class: "muted" }, r.lastText ? r.lastText.slice(0, 60) : r.callaway ? "Message Callaway's analysts" : r.type === "group" ? `${r.members.length} people` : other ? roleOf(other) : "")]),
        unread(r) && r.id !== current ? el("span", { class: "chat-dot", "aria-label": "Unread" }) : null,
      ]);
      b.addEventListener("click", () => (r.id === caId ? startCallaway() : open(r.id)));
      return el("li", {}, b);
    };
    // Callaway Analyst: always first, starred (yours; Callaway's staff see each person's)
    const mine = staff ? null : all.find((r) => r.id === caId) || { id: caId, callaway: true, createdBy: uid, members: [], type: "group", lastText: "" };
    const rest = all.filter((r) => r.id !== caId);
    const asks = incoming.map((r) => {
      const ok = el("button", { type: "button", class: "link chat-accept" }, "Accept"), no = el("button", { type: "button", class: "link" }, "Decline");
      ok.addEventListener("click", () => accept(r));
      no.addEventListener("click", async () => { try { await deleteDoc(doc(db, "friendRequests", r.id)); } catch { flash("Couldn't decline that.", "error"); } });
      return el("li", { class: "chat-ask" }, [el("span", {}, [el("strong", {}, nameOf(r.from)), " wants to chat with you"]), el("span", { class: "chat-friend-btns" }, [ok, no])]);
    });
    mount(list, [...asks, mine ? item(mine) : null, ...(rest.length ? rest.map(item) : [el("li", { class: "empty chat-empty" }, "No other chats yet. Start one with New message.")])]);
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
    const sub = r.callaway ? (r.createdBy === uid ? "Callaway's analysts" : `${nameOf(r.createdBy)} \u00b7 to Callaway's analysts`) : r.type === "dm" ? (roleOf(other) || "Direct message") : r.members.map(nameOf).join(", ");
    const actions = [];
    if (!r.callaway) {
      const plus = el("button", { type: "button", class: "btn ghost chat-plus", title: "Add people", "aria-label": "Add people" }, "\uFF0B");
      plus.addEventListener("click", () => openPicker("add", r));
      actions.push(plus);
    }
    if (r.type === "group" && !r.callaway) {
      const leave = el("button", { type: "button", class: "link danger" }, "Leave");
      leave.addEventListener("click", async () => {
        if (!confirmAction(`Leave \u201c${r.name}\u201d?`)) return;
        try { await updateDoc(doc(db, "chatRooms", r.id), { members: r.members.filter((m) => m !== uid) }); open(null); }
        catch { flash("Couldn't leave that group.", "error"); }
      });
      actions.push(leave);
    }
    mount(head, [back, el("div", { class: "chat-title" }, [el("strong", {}, roomName(r)), el("span", { class: "muted small" }, sub)]), el("div", { class: "chat-actions" }, actions)]);
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
    let first = true, msgsKey = null;
    stopMsgs = onSnapshot(query(msgsOf(roomId), orderBy("createdAt", "asc")), (s) => {
      const items = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      const k = JSON.stringify(items.map((m) => [m.id, ms(m.createdAt)]));
      if (k === msgsKey) return;
      msgsKey = k;
      const atBottom = first || msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
      mount(msgs, items.length ? items.map((m) => {
        const mine = m.uid === uid;
        const del = mine || state.isAdmin ? el("button", { type: "button", class: "chat-del", "aria-label": "Delete message", title: "Delete" }, "\u2715") : null;
        del?.addEventListener("click", async () => {
          if (!confirmAction("Delete this message?")) return;
          try { await deleteDoc(doc(msgsOf(roomId), m.id)); } catch { flash("Couldn't delete that message.", "error"); }
        });
        return el("li", { class: "chat-msg" + (mine ? " mine" : "") }, [
          el("div", { class: "chat-meta" }, [el("strong", {}, mine ? "You" : authorOf(roomNow(), m)), el("span", { class: "muted" }, m.createdAt ? formatWhen(m.createdAt) : "sending\u2026"), del]),
          el("p", { class: "chat-body" }, m.body),
        ]);
      }) : el("li", { class: "empty" }, "No messages yet. Say hello."));
      if (atBottom) msgs.scrollTop = msgs.scrollHeight;
      first = false;
      markRead(uid, roomId); drawList();
    }, () => mount(msgs, el("li", { class: "empty" }, "This chat isn't available. (Republish the Firestore rules from the latest update if you haven't.)")));
  }

  async function send() {
    const body = box.value.trim();
    if (!body || !current) return;
    if (current === NEW) {
      if (!to.length) { flash("Add who it's to.", "error"); return; }
      sendBtn.disabled = true;
      try { const id = await roomFor(to); open(id); } catch { flash("Couldn't start that chat. (Republish the Firestore rules from the latest update if you haven't.)", "error"); sendBtn.disabled = false; return; }
      to = [];
    }
    sendBtn.disabled = true;
    try {
      await addDoc(msgsOf(current), { uid, name: myName, body, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "chatRooms", current), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
      box.value = ""; box.focus();
    } catch { flash("Couldn't send that message. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    finally { sendBtn.disabled = false; }
  }

  // ---- New message (update 153, like Teams): To: people picked from a search, a + to add more ----
  const personLabel = (id) => { const r = roleOf(id); return r ? [nameOf(id), el("span", { class: "muted small" }, ` \u00b7 ${r}`)] : nameOf(id); };
  let to = [];
  // everyone I can message (Callaway's staff, my team, friends; the admin and analysts: everyone)
  const reachable = () => [...new Set(staff ? [...people.keys(), ...staffIds] : [...staffIds, ...reach, ...friends])].filter((id) => id !== uid);
  /** A search box with matches under it; picking one calls onPick(id). An email not in the list can be asked to chat. */
  function searchBox(onPick, exclude = []) {
    const input = el("input", { type: "search", class: "chat-find", placeholder: "Search for people\u2026", "aria-label": "Search for people", autocomplete: "off" });
    const res = el("ul", { class: "chat-results" });
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const ids = reachable().filter((id) => !exclude.includes(id) && !to.includes(id) && (!q || nameOf(id).toLowerCase().includes(q) || roleOf(id).toLowerCase().includes(q)))
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b))).slice(0, q ? 20 : 8);
      const items = ids.map((id) => { const b = el("button", { type: "button", class: "chat-person" }, personLabel(id)); b.addEventListener("click", () => { input.value = ""; onPick(id); }); return el("li", {}, b); });
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
