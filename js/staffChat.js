// Staff chat for the admin and Callaway analysts (under Questions → Analyst chat):
//   • Company chat: everyone on staff (messages in staffChat/{id}, as before)
//   • Direct messages: two people (chatRooms/dm_<uidA>_<uidB>)
//   • Groups: a name and the people in it (chatRooms/{id}); anyone in a group can add people or leave
// A small staff directory (staffDirectory/{uid}: name) lists who can be messaged. Each person adds
// themselves when they open the chat; when the admin opens it, every analyst is added.
import {
  collection, addDoc, deleteDoc, doc, getDoc, setDoc, updateDoc, onSnapshot, orderBy, query, where, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { el, mount, formatWhen, confirmAction } from "./ui.js";
import { getState } from "./auth.js";
import { watchUsers } from "./store.js";

export function watchStaffChat(cb) {
  return onSnapshot(query(collection(db, "staffChat"), orderBy("createdAt", "asc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb(null));
}

const COMPANY = { id: "company", type: "company", name: "Company chat" };
const msgsOf = (roomId) => (roomId === "company" ? collection(db, "staffChat") : collection(db, "chatRooms", roomId, "messages"));
const readKey = (uid, roomId) => `chatRead:${uid}:${roomId}`;
const lastRead = (uid, roomId) => { try { return Number(localStorage.getItem(readKey(uid, roomId))) || 0; } catch { return 0; } };
const markRead = (uid, roomId) => { try { localStorage.setItem(readKey(uid, roomId), String(Date.now())); } catch { /* fine */ } };
const ms = (t) => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : 0);

export function renderStaffChat(container, { flash }) {
  const state = getState();
  const uid = state.user.uid;
  const myName = state.profile?.name || state.user.displayName || state.user.email || "Me";
  let rooms = [], directory = new Map(), companyLast = null, current = "company", stopMsgs = () => {}, roomsKey = "", companyKey = "";

  // ---- the directory: add myself; the admin adds every analyst ----
  setDoc(doc(db, "staffDirectory", uid), { name: myName, role: state.isAdmin ? "admin" : "analyst", updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  // (only entries that are new or renamed are written, once the directory has loaded)
  let dirLoaded = false, analysts = [];
  const syncAnalysts = () => {
    if (!state.isAdmin || !dirLoaded) return;
    for (const u of analysts) {
      const name = u.name || u.email;
      if (directory.get(u.uid) !== name) setDoc(doc(db, "staffDirectory", u.uid), { name, role: "analyst" }, { merge: true }).catch(() => {});
    }
  };
  const unUsers = state.isAdmin ? watchUsers((users) => { analysts = users.filter((x) => x.kind === "analyst"); syncAnalysts(); }) : () => {};
  let dirKey = "";
  const unDir = onSnapshot(collection(db, "staffDirectory"), (s) => {
    directory = new Map(s.docs.map((d) => [d.id, d.data().name || "Analyst"]));
    const k = JSON.stringify([...directory]);
    const first = !dirLoaded; dirLoaded = true;
    if (first) syncAnalysts();
    if (k !== dirKey) { dirKey = k; drawList(); drawHead(); } // redraw only when someone was added or renamed
  }, () => {});
  const unRooms = onSnapshot(query(collection(db, "chatRooms"), where("members", "array-contains", uid)),
    (s) => { const next = s.docs.map((d) => ({ id: d.id, ...d.data() })); const k = JSON.stringify(next); if (k === roomsKey) return; roomsKey = k; rooms = next; drawList(); drawHead(); }, () => {});
  const unCompany = onSnapshot(query(collection(db, "staffChat"), orderBy("createdAt", "desc"), limit(1)),
    (s) => { const m = s.docs[0]?.data(); const k = m ? `${ms(m.createdAt)}|${m.body}` : ""; if (k === companyKey) return; companyKey = k; companyLast = m ? { at: ms(m.createdAt), text: m.body, by: m.uid } : null; drawList(); }, () => {});

  const nameOf = (id) => (id === uid ? "You" : directory.get(id) || "Analyst");
  const roomName = (r) => (r.type === "company" ? "Company chat" : r.type === "dm" ? nameOf(r.members.find((m) => m !== uid) || uid) : r.name || "Group");
  const allRooms = () => [{ ...COMPANY, lastAt: companyLast?.at || 0, lastText: companyLast?.text || "", lastBy: companyLast?.by },
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
  const picker = el("div", { class: "chat-picker", hidden: true });
  const shell = el("section", { class: "panel chat chat-shell" }, [
    el("aside", { class: "chat-side" }, [el("div", { class: "chat-side-top" }, [el("h3", {}, "Chats"), el("div", { class: "chat-new" }, [newDm, newGroup])]), picker, list]),
    el("div", { class: "chat-main" }, [head, msgs, form]),
  ]);
  mount(container, shell);

  function drawList() {
    mount(list, allRooms().map((r) => {
      const b = el("button", { type: "button", class: "chat-room" + (r.id === current ? " on" : ""), "aria-current": r.id === current ? "true" : null }, [
        el("span", { class: "chat-room-icon", "aria-hidden": "true" }, r.type === "company" ? "#" : r.type === "group" ? "\u25CE" : "\u25CF"),
        el("span", { class: "chat-room-text" }, [el("strong", {}, roomName(r)), el("span", { class: "muted" }, r.lastText ? r.lastText.slice(0, 60) : r.type === "group" ? `${r.members.length} people` : "")]),
        unread(r) && r.id !== current ? el("span", { class: "chat-dot", "aria-label": "Unread" }) : null,
      ]);
      b.addEventListener("click", () => open(r.id));
      return el("li", {}, b);
    }));
  }

  function drawHead() {
    const r = allRooms().find((x) => x.id === current) || COMPANY;
    const back = el("button", { type: "button", class: "link chat-back", "aria-label": "Back to chats" }, "\u2039 Chats");
    back.addEventListener("click", () => shell.classList.remove("show-thread"));
    const sub = r.type === "company" ? "Everyone: you and all Callaway analysts" : r.type === "dm" ? "Direct message" : r.members.map(nameOf).join(", ");
    const actions = [];
    if (r.type === "group") {
      const add = el("button", { type: "button", class: "link" }, "Add people");
      add.addEventListener("click", () => openPicker("add", r));
      const leave = el("button", { type: "button", class: "link danger" }, "Leave");
      leave.addEventListener("click", async () => {
        if (!confirmAction(`Leave \u201c${r.name}\u201d?`)) return;
        try { await updateDoc(doc(db, "chatRooms", r.id), { members: r.members.filter((m) => m !== uid) }); open("company"); }
        catch { flash("Couldn't leave that group.", "error"); }
      });
      actions.push(add, leave);
    }
    mount(head, [back, el("div", { class: "chat-title" }, [el("strong", {}, roomName(r)), el("span", { class: "muted small" }, sub)]), el("div", { class: "chat-actions" }, actions)]);
  }

  function open(roomId) {
    current = roomId;
    shell.classList.add("show-thread");
    picker.hidden = true;
    stopMsgs();
    drawList(); drawHead();
    mount(msgs, el("li", { class: "empty" }, "Loading\u2026"));
    let first = true;
    let msgsKey = null;
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
    }, () => mount(msgs, el("li", { class: "empty" }, "This chat isn't available. Republish the Firestore rules from the latest update.")));
  }

  async function send() {
    const body = box.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    try {
      await addDoc(msgsOf(current), { uid, name: myName, body, createdAt: serverTimestamp() });
      if (current !== "company") await updateDoc(doc(db, "chatRooms", current), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
      box.value = ""; box.focus();
    } catch { flash("Couldn't send that message. (Republish the Firestore rules if you haven't since this update.)", "error"); }
    finally { sendBtn.disabled = false; }
  }

  // ---- picking people: a new direct message, a new group, or adding to a group ----
  function openPicker(mode, room = null) {
    const people = [...directory.entries()].filter(([id]) => id !== uid && !(room && room.members.includes(id))).sort((a, b) => a[1].localeCompare(b[1]));
    picker.hidden = false;
    if (!people.length) { mount(picker, [el("p", { class: "muted small" }, mode === "add" ? "Everyone on staff is already in this group." : "No one else has opened the chat yet. Analysts appear here once they've signed in and opened Questions \u2192 Analyst chat."), closeBtn()]); return; }
    if (mode === "dm") {
      mount(picker, [el("p", { class: "chat-picker-title" }, "Message\u2026"), ...people.map(([id, name]) => {
        const b = el("button", { type: "button", class: "chat-person" }, name);
        b.addEventListener("click", () => startDm(id, name));
        return b;
      }), closeBtn()]);
      return;
    }
    const nameIn = mode === "group" ? el("input", { placeholder: "Group name", maxLength: 60, "aria-label": "Group name" }) : null;
    const boxes = people.map(([id, name]) => el("label", { class: "ms-row" }, [el("input", { type: "checkbox", value: id, "aria-label": name }), el("span", {}, name)]));
    const go = el("button", { type: "button", class: "btn" }, mode === "group" ? "Create group" : "Add");
    go.addEventListener("click", async () => {
      const ids = boxes.map((b) => b.querySelector("input")).filter((c) => c.checked).map((c) => c.value);
      if (!ids.length) { flash("Tick at least one person.", "error"); return; }
      try {
        if (mode === "group") {
          const name = nameIn.value.trim();
          if (!name) { flash("Give the group a name.", "error"); nameIn.focus(); return; }
          const members = [uid, ...ids];
          const ref = await addDoc(collection(db, "chatRooms"), { type: "group", name, members, createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
          open(ref.id);
        } else {
          await updateDoc(doc(db, "chatRooms", room.id), { members: [...room.members, ...ids] });
          picker.hidden = true;
        }
      } catch { flash("Couldn't save that. (Republish the Firestore rules if you haven't since this update.)", "error"); }
    });
    mount(picker, [el("p", { class: "chat-picker-title" }, mode === "group" ? "New group" : `Add people to \u201c${room.name}\u201d`), nameIn, el("div", { class: "chat-people" }, boxes), el("div", { class: "chat-picker-actions" }, [go, closeBtn()])]);
    nameIn?.focus();
  }
  const closeBtn = () => { const b = el("button", { type: "button", class: "link" }, "Cancel"); b.addEventListener("click", () => { picker.hidden = true; }); return b; };
  async function startDm(other, name) {
    const id = `dm_${[uid, other].sort().join("_")}`;
    try {
      const snap = await getDoc(doc(db, "chatRooms", id));
      if (!snap.exists()) await setDoc(doc(db, "chatRooms", id), { type: "dm", members: [uid, other].sort(), createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
      open(id);
    } catch { flash(`Couldn't start a message with ${name}. (Republish the Firestore rules if you haven't since this update.)`, "error"); }
  }
  newDm.addEventListener("click", () => openPicker("dm"));
  newGroup.addEventListener("click", () => openPicker("group"));

  open("company");
  shell.classList.remove("show-thread"); // phones start on the list
  return () => { stopMsgs(); unRooms(); unDir(); unCompany(); unUsers(); };
}
