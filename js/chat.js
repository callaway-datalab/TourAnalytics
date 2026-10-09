// Chat (update 101): the same page for everyone, from the admin to analysts, players, coaches and caddies.
//   • Direct messages and named groups (chatRooms/{id}, messages in chatRooms/{id}/messages); anyone in a group
//     can add people or leave
//   • Company chat: Callaway staff only (staffChat/{id})
//   • Friends: ask someone by their email; once they accept you can message each other
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

export function watchStaffChat(cb) {
  return onSnapshot(query(collection(db, "staffChat"), orderBy("createdAt", "asc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb(null));
}

const COMPANY = { id: "company", type: "company", name: "Company chat" };
const msgsOf = (roomId) => (roomId === "company" ? collection(db, "staffChat") : collection(db, "chatRooms", roomId, "messages"));
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
  let rooms = [], current = staff ? "company" : null, stopMsgs = () => {}, roomsKey = "", companyKey = "", companyLast = null, autoOpened = false;
  // people: uid -> { name, role, title }; who I may message: staff -> everyone, else reach + friends
  const people = new Map();
  let reach = [], friends = [], incoming = [], outgoing = [];
  const unsubs = [];
  const redraw = () => { drawList(); drawHead(); if (!friendsBox.hidden) drawFriends(); };

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
  unsubs.push(onSnapshot(doc(db, "chatFriends", uid), (d) => { friends = d.exists() ? d.data().uids || [] : []; friends.forEach(watchName); redraw(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "friendRequests"), where("to", "==", uid)), (s) => { incoming = s.docs.map((d) => ({ id: d.id, ...d.data() })); incoming.forEach((r) => watchName(r.from)); redraw(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "friendRequests"), where("from", "==", uid)), (s) => { outgoing = s.docs.map((d) => ({ id: d.id, ...d.data() })); outgoing.forEach((r) => watchName(r.to)); redraw(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "chatRooms"), where("members", "array-contains", uid)), (s) => {
    const next = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const k = JSON.stringify(next); if (k === roomsKey) return;
    roomsKey = k; rooms = next;
    rooms.forEach((r) => r.members.forEach(watchName));
    redraw();
    // (no company chat: open the latest conversation the first time they load; phones still start on the list)
    if (!staff && !current && !autoOpened && rooms.length) { autoOpened = true; open(allRooms()[0].id); shell.classList.remove("show-thread"); }
  }, () => {}));
  if (staff) unsubs.push(onSnapshot(query(collection(db, "staffChat"), orderBy("createdAt", "desc"), limit(1)), (s) => {
    const m = s.docs[0]?.data(); const k = m ? `${ms(m.createdAt)}|${m.body}` : ""; if (k === companyKey) return;
    companyKey = k; companyLast = m ? { at: ms(m.createdAt), text: m.body, by: m.uid } : null; drawList();
  }, () => {}));

  const nameOf = (id) => (id === uid ? "You" : people.get(id)?.name || "Someone");
  const roleOf = (id) => { const p = people.get(id); return p ? p.title || roleName(p.role) : ""; };
  const isStaffId = (id) => ["admin", "analyst"].includes(people.get(id)?.role);
  // who I can message, in sections
  function contacts() {
    const others = staff ? [...people.keys()].filter((id) => id !== uid) : [...new Set([...reach, ...friends])].filter((id) => id !== uid);
    const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
    const callaway = others.filter(isStaffId).sort(byName);
    const friendIds = friends.filter((id) => id !== uid && !isStaffId(id)).sort(byName);
    const rest = others.filter((id) => !isStaffId(id) && !friendIds.includes(id)).sort(byName);
    return [{ title: "Callaway", ids: callaway }, { title: staff ? "Everyone" : "Your team", ids: rest }, { title: "Friends", ids: friendIds }].filter((x) => x.ids.length);
  }
  const roomName = (r) => (r.type === "company" ? "Company chat" : r.type === "dm" ? nameOf(r.members.find((m) => m !== uid) || uid) : r.name || "Group");
  const allRooms = () => [...(staff ? [{ ...COMPANY, lastAt: companyLast?.at || 0, lastText: companyLast?.text || "", lastBy: companyLast?.by }] : []),
    ...rooms.map((r) => ({ ...r, lastAt: ms(r.lastAt) || ms(r.createdAt) }))].sort((a, b) => (a.type === "company" ? -1 : b.type === "company" ? 1 : b.lastAt - a.lastAt));
  const unread = (r) => r.lastAt > lastRead(uid, r.id) && r.lastBy && r.lastBy !== uid;

  // ---- layout: conversations | thread (on phones one at a time) ----
  const list = el("ul", { class: "chat-rooms" });
  const head = el("div", { class: "chat-thread-head" });
  const msgs = el("ol", { class: "chat-list", "aria-live": "polite" });
  const box = el("textarea", { rows: 2, maxLength: 2000, placeholder: "Message\u2026", "aria-label": "Message", enterkeyhint: "send" });
  const sendBtn = el("button", { class: "btn", type: "submit" }, "Send");
  const form = el("form", { class: "chat-form", onSubmit: (e) => { e.preventDefault(); send(); } }, [box, sendBtn]);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  const newDm = el("button", { type: "button", class: "btn ghost" }, "New message");
  const newGroup = el("button", { type: "button", class: "btn ghost" }, "New group");
  const friendsBtn = el("button", { type: "button", class: "btn ghost chat-friends-btn" }, ["Friends", el("span", { class: "badge", hidden: true })]);
  const picker = el("div", { class: "chat-picker", hidden: true });
  const friendsBox = el("div", { class: "chat-picker chat-friends", hidden: true });
  const shell = el("section", { class: "panel chat chat-shell" }, [
    el("aside", { class: "chat-side" }, [el("div", { class: "chat-side-top" }, [el("h3", {}, "Chats"), el("div", { class: "chat-new" }, [newDm, newGroup, friendsBtn])]), picker, friendsBox, list]),
    el("div", { class: "chat-main" }, [head, msgs, form]),
  ]);
  mount(container, shell);

  function drawList() {
    const n = friendsBtn.querySelector(".badge"); n.hidden = !incoming.length; n.textContent = String(incoming.length);
    const all = allRooms();
    if (!all.length) { mount(list, el("li", { class: "empty chat-empty" }, "No chats yet. Start one with New message or New group.")); return; }
    mount(list, all.map((r) => {
      const other = r.type === "dm" ? r.members.find((m) => m !== uid) : null;
      const b = el("button", { type: "button", class: "chat-room" + (r.id === current ? " on" : ""), "aria-current": r.id === current ? "true" : null }, [
        el("span", { class: "chat-room-icon", "aria-hidden": "true" }, r.type === "company" ? "#" : r.type === "group" ? "\u25CE" : "\u25CF"),
        el("span", { class: "chat-room-text" }, [el("strong", {}, roomName(r)), el("span", { class: "muted" }, r.lastText ? r.lastText.slice(0, 60) : r.type === "group" ? `${r.members.length} people` : other ? roleOf(other) : "")]),
        unread(r) && r.id !== current ? el("span", { class: "chat-dot", "aria-label": "Unread" }) : null,
      ]);
      b.addEventListener("click", () => open(r.id));
      return el("li", {}, b);
    }));
  }

  function drawHead() {
    const r = allRooms().find((x) => x.id === current);
    if (!r) { mount(head, null); return; }
    const back = el("button", { type: "button", class: "link chat-back", "aria-label": "Back to chats" }, "\u2039 Chats");
    back.addEventListener("click", () => shell.classList.remove("show-thread"));
    const other = r.type === "dm" ? r.members.find((m) => m !== uid) : null;
    const sub = r.type === "company" ? "Everyone at Callaway: you and all analysts" : r.type === "dm" ? (roleOf(other) || "Direct message") : r.members.map(nameOf).join(", ");
    const actions = [];
    if (r.type === "group") {
      const add = el("button", { type: "button", class: "link" }, "Add people");
      add.addEventListener("click", () => openPicker("add", r));
      const leave = el("button", { type: "button", class: "link danger" }, "Leave");
      leave.addEventListener("click", async () => {
        if (!confirmAction(`Leave \u201c${r.name}\u201d?`)) return;
        try { await updateDoc(doc(db, "chatRooms", r.id), { members: r.members.filter((m) => m !== uid) }); open(staff ? "company" : null); }
        catch { flash("Couldn't leave that group.", "error"); }
      });
      actions.push(add, leave);
    }
    mount(head, [back, el("div", { class: "chat-title" }, [el("strong", {}, roomName(r)), el("span", { class: "muted small" }, sub)]), el("div", { class: "chat-actions" }, actions)]);
  }

  function open(roomId) {
    current = roomId;
    stopMsgs(); stopMsgs = () => {};
    picker.hidden = true; friendsBox.hidden = true;
    drawList(); drawHead();
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
          el("div", { class: "chat-meta" }, [el("strong", {}, mine ? "You" : m.name || nameOf(m.uid)), el("span", { class: "muted" }, m.createdAt ? formatWhen(m.createdAt) : "sending\u2026"), del]),
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
    sendBtn.disabled = true;
    try {
      await addDoc(msgsOf(current), { uid, name: myName, body, createdAt: serverTimestamp() });
      if (current !== "company") await updateDoc(doc(db, "chatRooms", current), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
      box.value = ""; box.focus();
    } catch { flash("Couldn't send that message. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    finally { sendBtn.disabled = false; }
  }

  // ---- picking people: a new direct message, a new group, or adding to a group ----
  const personLabel = (id) => { const r = roleOf(id); return r ? [nameOf(id), el("span", { class: "muted small" }, ` \u00b7 ${r}`)] : nameOf(id); };
  const closeBtn = (what) => { const b = el("button", { type: "button", class: "link" }, "Close"); b.addEventListener("click", () => { what.hidden = true; }); return b; };
  function openPicker(mode, room = null) {
    friendsBox.hidden = true;
    const secs = contacts().map((x) => ({ ...x, ids: room ? x.ids.filter((id) => !room.members.includes(id)) : x.ids })).filter((x) => x.ids.length);
    picker.hidden = false;
    if (!secs.length) {
      mount(picker, [el("p", { class: "muted small" }, mode === "add" ? "Everyone you can message is already in this group."
        : "No one to message yet. Add a friend with Friends, or check back once Callaway has set up your team."), closeBtn(picker)]);
      return;
    }
    const total = secs.reduce((n, x) => n + x.ids.length, 0);
    const find = total > 12 ? el("input", { type: "search", placeholder: "Find someone\u2026", "aria-label": "Find someone", class: "chat-find" }) : null;
    const body = el("div", { class: "chat-people" });
    const shown = () => { const q = (find?.value || "").trim().toLowerCase(); return secs.map((x) => ({ ...x, ids: q ? x.ids.filter((id) => nameOf(id).toLowerCase().includes(q)) : x.ids })).filter((x) => x.ids.length); };
    const picked = new Set();
    const drawPeople = () => mount(body, shown().map((x) => el("div", { class: "chat-sec" }, [el("p", { class: "chat-sec-title" }, x.title), ...x.ids.map((id) => {
      if (mode === "dm") { const b = el("button", { type: "button", class: "chat-person" }, personLabel(id)); b.addEventListener("click", () => startDm(id)); return b; }
      const cb = el("input", { type: "checkbox", value: id, checked: picked.has(id), "aria-label": nameOf(id) });
      cb.addEventListener("change", () => { if (cb.checked) picked.add(id); else picked.delete(id); });
      return el("label", { class: "ms-row" }, [cb, el("span", {}, personLabel(id))]);
    })])));
    find?.addEventListener("input", drawPeople);
    drawPeople();
    if (mode === "dm") { mount(picker, [el("p", { class: "chat-picker-title" }, "Message\u2026"), find, body, closeBtn(picker)]); find?.focus(); return; }
    const nameIn = mode === "group" ? el("input", { placeholder: "Group name", maxLength: 60, "aria-label": "Group name" }) : null;
    const go = el("button", { type: "button", class: "btn" }, mode === "group" ? "Create group" : "Add");
    go.addEventListener("click", async () => {
      const ids = [...picked];
      if (!ids.length) { flash("Tick at least one person.", "error"); return; }
      try {
        if (mode === "group") {
          const name = nameIn.value.trim();
          if (!name) { flash("Give the group a name.", "error"); nameIn.focus(); return; }
          const ref = await addDoc(collection(db, "chatRooms"), { type: "group", name, members: [uid, ...ids], createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
          open(ref.id);
        } else {
          await updateDoc(doc(db, "chatRooms", room.id), { members: [...room.members, ...ids] });
          picker.hidden = true;
        }
      } catch { flash("Couldn't save that. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    });
    mount(picker, [el("p", { class: "chat-picker-title" }, mode === "group" ? "New group" : `Add people to \u201c${room.name}\u201d`), nameIn, find, body, el("div", { class: "chat-picker-actions" }, [go, closeBtn(picker)])]);
    (nameIn || find)?.focus();
  }
  async function startDm(other) {
    const id = `dm_${[uid, other].sort().join("_")}`;
    try {
      const snap = await getDoc(doc(db, "chatRooms", id));
      if (!snap.exists()) await setDoc(doc(db, "chatRooms", id), { type: "dm", members: [uid, other].sort(), createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
      open(id);
    } catch { flash(`Couldn't start a message with ${nameOf(other)}. (Republish the Firestore rules from the latest update if you haven't.)`, "error"); }
  }

  // ---- friends: ask by email, accept or decline, remove ----
  const emailIn = el("input", { type: "email", inputmode: "email", autocomplete: "off", placeholder: "Their email", "aria-label": "Friend's email" });
  const askBtn = el("button", { type: "button", class: "btn" }, "Ask");
  async function ask() {
    const email = emailIn.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { flash("Enter their email address.", "error"); emailIn.focus(); return; }
    askBtn.disabled = true;
    try {
      const d = await getDoc(doc(db, "friendEmails", email));
      const to = d.exists() ? d.data().uid : null;
      if (!to) { flash("No one with that email uses the portal yet (or they haven't opened Chat).", "error"); return; }
      if (to === uid) { flash("That's you.", "error"); return; }
      if (friends.includes(to)) { flash(`${nameOf(to)} is already a friend.`, "error"); return; }
      const back = incoming.find((r) => r.from === to);
      if (back) { await accept(back); return; } // (they've already asked you)
      await setDoc(doc(db, "friendRequests", `${uid}_${to}`), { from: uid, to, createdAt: serverTimestamp() });
      emailIn.value = "";
      flash("Friend request sent. You can message each other once they accept.");
    } catch { flash("Couldn't send that request. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    finally { askBtn.disabled = false; }
  }
  askBtn.addEventListener("click", ask);
  emailIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } });
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
  async function removeFriend(id) {
    if (!confirmAction(`Remove ${nameOf(id)} as a friend? Chats you already have stay.`)) return;
    try {
      const theirs = await getDoc(doc(db, "chatFriends", id));
      const b = writeBatch(db);
      b.set(doc(db, "chatFriends", uid), { uids: friends.filter((x) => x !== id), lastAdded: "" });
      if (theirs.exists()) b.set(doc(db, "chatFriends", id), { uids: (theirs.data().uids || []).filter((x) => x !== uid), lastAdded: theirs.data().lastAdded || "" });
      await b.commit();
    } catch { flash("Couldn't remove that friend.", "error"); }
  }
  function drawFriends() {
    const row = (id, btns) => el("div", { class: "chat-friend" }, [el("span", {}, personLabel(id)), el("span", { class: "chat-friend-btns" }, btns)]);
    const btn = (label, fn, cls = "link") => { const b = el("button", { type: "button", class: cls }, label); b.addEventListener("click", fn); return b; };
    mount(friendsBox, [
      el("p", { class: "chat-picker-title" }, "Friends"),
      incoming.length ? el("div", { class: "chat-sec" }, [el("p", { class: "chat-sec-title" }, "Asked you"), ...incoming.map((r) => row(r.from, [
        btn("Accept", () => accept(r), "link chat-accept"), btn("Decline", async () => { try { await deleteDoc(doc(db, "friendRequests", r.id)); } catch { flash("Couldn't decline that.", "error"); } }),
      ]))]) : null,
      el("div", { class: "chat-sec" }, [el("p", { class: "chat-sec-title" }, "Your friends"), ...(friends.length ? friends.map((id) => row(id, [
        btn("Message", () => startDm(id)), btn("Remove", () => removeFriend(id), "link danger"),
      ])) : [el("p", { class: "muted small" }, "None yet.")])]),
      outgoing.length ? el("div", { class: "chat-sec" }, [el("p", { class: "chat-sec-title" }, "Waiting for them"), ...outgoing.map((r) => row(r.to, [
        btn("Cancel", async () => { try { await deleteDoc(doc(db, "friendRequests", r.id)); } catch { flash("Couldn't cancel that.", "error"); } }),
      ]))]) : null,
      el("div", { class: "chat-sec" }, [el("p", { class: "chat-sec-title" }, "Add a friend"), el("div", { class: "cc-link" }, [emailIn, askBtn]),
        el("p", { class: "muted small" }, "They get a request in Chat. Once they accept, you can message each other.")]),
      closeBtn(friendsBox),
    ]);
  }
  newDm.addEventListener("click", () => openPicker("dm"));
  newGroup.addEventListener("click", () => openPicker("group"));
  friendsBtn.addEventListener("click", () => { picker.hidden = true; friendsBox.hidden = !friendsBox.hidden; if (!friendsBox.hidden) drawFriends(); });

  open(current);
  shell.classList.remove("show-thread"); // phones start on the list
  return () => { stopMsgs(); unsubs.forEach((u) => u()); nameWatch.forEach((u) => u()); };
}
