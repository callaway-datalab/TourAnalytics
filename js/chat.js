// Chat, for everyone (the Chat page; update 100):
//   • Company chat: Callaway staff only (the admin and analysts; messages in staffChat/{id}, as before)
//   • Direct messages: two people (chatRooms/dm_<uidA>_<uidB>)
//   • Groups: a name and the people in it (chatRooms/{id}); anyone in a group can add people or leave
// Who can reach whom: a player, their own team and Callaway staff. Each player's "circle" (chatCircles/{playerKey},
// kept up to date by the admin's app) lists those people; a conversation that involves a player belongs to one
// circle (scope "circle") and the Firestore rules only let people from that circle into it. Staff-only
// conversations work as before, with the staff directory (staffDirectory/{uid}: name).
import {
  collection, addDoc, deleteDoc, doc, getDoc, setDoc, updateDoc, onSnapshot, orderBy, query, where, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { el, mount, formatWhen, confirmAction } from "./ui.js";
import { getState } from "./auth.js";
import { watchUsers } from "./store.js";
import { syncChatCircles, roleName } from "./chatCircles.js";

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

export const renderStaffChat = (container, opts) => renderChat(container, opts);

export function renderChat(container, { flash }) {
  const state = getState();
  const uid = state.user.uid;
  const myName = state.profile?.name || state.user.displayName || state.user.email || "Me";
  const staff = state.isAdmin || state.profile?.kind === "analyst";
  let rooms = [], directory = new Map(), companyLast = null, current = staff ? "company" : null, stopMsgs = () => {}, roomsKey = "", companyKey = "";
  // the circles I can chat in: { key: { uids, names, roles, playerName } }
  let circles = new Map(), autoOpened = false;
  const circleUnsubs = [];
  const nameFromCircles = (id) => { for (const c of circles.values()) if (c.names?.[id]) return c.names[id]; return null; };
  const roleFromCircles = (id) => { for (const c of circles.values()) if (c.roles?.[id]) return c.roles[id]; return null; };
  const redrawAll = () => { drawList(); drawHead(); };
  if (staff) {
    if (state.isAdmin) syncChatCircles().catch(() => {}); // (who each player can reach: refreshed when the admin opens Chat)
    circleUnsubs.push(onSnapshot(collection(db, "chatCircles"), (s) => { circles = new Map(s.docs.map((d) => [d.id, d.data()])); redrawAll(); }, () => {}));
  } else {
    // a player: their own circle; a team member: the circle of each player they work with
    const keys = state.isTeam ? Object.keys(state.teamAccess || {}) : state.profile?.clientKey ? [state.profile.clientKey] : [];
    for (const k of keys) circleUnsubs.push(onSnapshot(doc(db, "chatCircles", k), (d) => { if (d.exists()) circles.set(k, d.data()); else circles.delete(k); redrawAll(); }, () => {}));
  }

  // ---- the staff directory: add myself; the admin adds every analyst ----
  if (staff) setDoc(doc(db, "staffDirectory", uid), { name: myName, role: state.isAdmin ? "admin" : "analyst", updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
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
  const unDir = !staff ? () => {} : onSnapshot(collection(db, "staffDirectory"), (s) => {
    directory = new Map(s.docs.map((d) => [d.id, d.data().name || "Analyst"]));
    const k = JSON.stringify([...directory]);
    const first = !dirLoaded; dirLoaded = true;
    if (first) syncAnalysts();
    if (k !== dirKey) { dirKey = k; drawList(); drawHead(); } // redraw only when someone was added or renamed
  }, () => {});
  // (players and teams can only list conversations that belong to a circle; the rules check that)
  const roomsQ = staff ? query(collection(db, "chatRooms"), where("members", "array-contains", uid))
    : query(collection(db, "chatRooms"), where("members", "array-contains", uid), where("scope", "==", "circle"));
  const unRooms = onSnapshot(roomsQ,
    (s) => { const next = s.docs.map((d) => ({ id: d.id, ...d.data() })); const k = JSON.stringify(next); if (k === roomsKey) return; roomsKey = k; rooms = next; drawList(); drawHead();
      // (no company chat: open the latest conversation the first time they load; phones still start on the list)
      if (!staff && !current && !autoOpened && rooms.length) { autoOpened = true; open(allRooms()[0].id); shell.classList.remove("show-thread"); } }, () => {});
  const unCompany = !staff ? () => {} : onSnapshot(query(collection(db, "staffChat"), orderBy("createdAt", "desc"), limit(1)),
    (s) => { const m = s.docs[0]?.data(); const k = m ? `${ms(m.createdAt)}|${m.body}` : ""; if (k === companyKey) return; companyKey = k; companyLast = m ? { at: ms(m.createdAt), text: m.body, by: m.uid } : null; drawList(); }, () => {});

  const nameOf = (id) => (id === uid ? "You" : directory.get(id) || nameFromCircles(id) || "Someone");
  const roleOf = (id) => { const r = roleFromCircles(id) || (directory.has(id) ? "analyst" : ""); return r ? roleName(r) : ""; };
  const circleName = (key) => { const c = circles.get(key); if (!c) return ""; return c.roles?.[uid] === "player" ? "Your team" : `${c.playerName || "Player"}\u2019s team`; };
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
  const picker = el("div", { class: "chat-picker", hidden: true });
  const shell = el("section", { class: "panel chat chat-shell" }, [
    el("aside", { class: "chat-side" }, [el("div", { class: "chat-side-top" }, [el("h3", {}, "Chats"), el("div", { class: "chat-new" }, [newDm, newGroup])]), picker, list]),
    el("div", { class: "chat-main" }, [head, msgs, form]),
  ]);
  mount(container, shell);

  function drawList() {
    const all = allRooms();
    if (!all.length) {
      mount(list, el("li", { class: "empty chat-empty" }, circles.size ? "No chats yet. Start one with New message or New group." : "Chat opens once Callaway has set up your team. Check back soon."));
      return;
    }
    mount(list, all.map((r) => {
      const b = el("button", { type: "button", class: "chat-room" + (r.id === current ? " on" : ""), "aria-current": r.id === current ? "true" : null }, [
        el("span", { class: "chat-room-icon", "aria-hidden": "true" }, r.type === "company" ? "#" : r.type === "group" ? "\u25CE" : "\u25CF"),
        el("span", { class: "chat-room-text" }, [el("strong", {}, roomName(r)), el("span", { class: "muted" }, r.lastText ? r.lastText.slice(0, 60) : r.type === "group" ? `${r.members.length} people` : r.type === "dm" ? roleOf(r.members.find((m) => m !== uid)) : ""),
          staff && r.scope === "circle" && circles.size > 1 ? el("span", { class: "chat-room-circle" }, circleName(r.circle)) : null]),
        unread(r) && r.id !== current ? el("span", { class: "chat-dot", "aria-label": "Unread" }) : null,
      ]);
      b.addEventListener("click", () => open(r.id));
      return el("li", {}, b);
    }));
  }

  function drawHead() {
    const r = allRooms().find((x) => x.id === current) || (staff ? COMPANY : null);
    if (!r) { mount(head, null); return; }
    const back = el("button", { type: "button", class: "link chat-back", "aria-label": "Back to chats" }, "\u2039 Chats");
    back.addEventListener("click", () => shell.classList.remove("show-thread"));
    const other = r.type === "dm" ? r.members.find((m) => m !== uid) : null;
    const sub = r.type === "company" ? "Everyone: you and all Callaway analysts" : r.type === "dm" ? [roleOf(other), r.scope === "circle" && staff ? circleName(r.circle) : ""].filter(Boolean).join(" \u00b7 ") || "Direct message" : r.members.map(nameOf).join(", ");
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
    if (!roomId) { stopMsgs(); stopMsgs = () => {}; drawList(); drawHead(); mount(msgs, el("li", { class: "empty" }, "Pick a chat, or start one.")); form.hidden = true; shell.classList.remove("show-thread"); return; }
    form.hidden = false;
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
      if (current && current !== "company") await updateDoc(doc(db, "chatRooms", current), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
      box.value = ""; box.focus();
    } catch { flash("Couldn't send that message. (Republish the Firestore rules if you haven't since this update.)", "error"); }
    finally { sendBtn.disabled = false; }
  }

  // ---- picking people: a new direct message, a new group, or adding to a group ----
  // People come in sections: Callaway staff (staff only), then each player's team (for a player: "Your team",
  // which includes Callaway staff). A group, or a message, belongs to one section.
  function sections(room = null) {
    const out = [];
    if (room) {
      const pool = room.scope === "circle" ? (circles.get(room.circle)?.uids || []) : [...directory.keys()];
      const people = pool.filter((id) => id !== uid && !room.members.includes(id));
      if (people.length) out.push({ key: room.scope === "circle" ? room.circle : null, title: "", people });
      return out;
    }
    if (staff) out.push({ key: null, title: "Callaway staff", people: [...directory.keys()].filter((id) => id !== uid) });
    const cs = [...circles.entries()].sort((a, b) => circleName(a[0]).localeCompare(circleName(b[0])));
    for (const [key, c] of cs) {
      // (staff see each player's team without the other staff, who are in the first section)
      const people = (c.uids || []).filter((id) => id !== uid && !(staff && ["admin", "analyst"].includes(c.roles?.[id])));
      if (people.length) out.push({ key, title: circleName(key), people });
    }
    return out.filter((x) => x.people.length);
  }
  const personLabel = (id) => { const r = roleOf(id); return r ? [nameOf(id), el("span", { class: "muted small" }, ` \u00b7 ${r}`)] : nameOf(id); };
  function openPicker(mode, room = null) {
    const secs = sections(room);
    picker.hidden = false;
    if (!secs.length) {
      mount(picker, [el("p", { class: "muted small" }, mode === "add" ? "Everyone who can join is already in this group."
        : staff ? "No one else is here yet. Analysts appear once they've opened Chat; players and their teams once they have accounts." : "No one to message yet. Callaway sets up who's on your team."), closeBtn()]);
      return;
    }
    // with many players' teams (staff), a search box narrows the list
    const find = staff && !room && secs.length > 3 ? el("input", { type: "search", placeholder: "Find a person or player\u2026", "aria-label": "Find a person", class: "chat-find" }) : null;
    const body = el("div", { class: "chat-people" });
    const filterSecs = () => {
      const q = (find?.value || "").trim().toLowerCase();
      return !q ? secs : secs.map((x) => (x.title.toLowerCase().includes(q) ? x : { ...x, people: x.people.filter((id) => nameOf(id).toLowerCase().includes(q)) })).filter((x) => x.people.length);
    };
    if (mode === "dm") {
      const draw = () => mount(body, filterSecs().map((x) => el("div", { class: "chat-sec" }, [x.title ? el("p", { class: "chat-sec-title" }, x.title) : null, ...x.people.map((id) => {
        const b = el("button", { type: "button", class: "chat-person" }, personLabel(id));
        b.addEventListener("click", () => startDm(id, x.key));
        return b;
      })])));
      find?.addEventListener("input", draw);
      draw();
      mount(picker, [el("p", { class: "chat-picker-title" }, "Message\u2026"), find, body, closeBtn()]);
      find?.focus();
      return;
    }
    const nameIn = mode === "group" ? el("input", { placeholder: "Group name", maxLength: 60, "aria-label": "Group name" }) : null;
    let chosenSec; // (a group's people all come from one section)
    const picked = new Set();
    const draw = () => mount(body, filterSecs().map((x) => el("div", { class: "chat-sec" }, [x.title ? el("p", { class: "chat-sec-title" }, x.title) : null, ...x.people.map((id) => {
      const cb = el("input", { type: "checkbox", value: id, checked: chosenSec === x.key && picked.has(id), "aria-label": nameOf(id) });
      cb.addEventListener("change", () => {
        if (chosenSec !== x.key) { picked.clear(); chosenSec = x.key; }
        if (cb.checked) picked.add(id); else picked.delete(id);
        if (!picked.size) chosenSec = undefined;
        draw();
      });
      return el("label", { class: "ms-row" }, [cb, el("span", {}, personLabel(id))]);
    })])));
    find?.addEventListener("input", draw);
    draw();
    const go = el("button", { type: "button", class: "btn" }, mode === "group" ? "Create group" : "Add");
    go.addEventListener("click", async () => {
      const ids = [...picked];
      if (!ids.length) { flash("Tick at least one person.", "error"); return; }
      const circle = room ? (room.scope === "circle" ? room.circle : null) : chosenSec ?? null;
      try {
        if (mode === "group") {
          const name = nameIn.value.trim();
          if (!name) { flash("Give the group a name.", "error"); nameIn.focus(); return; }
          const members = [uid, ...ids];
          const ref = await addDoc(collection(db, "chatRooms"), { type: "group", name, members, createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "",
            ...(circle ? { scope: "circle", circle } : {}) });
          open(ref.id);
        } else {
          await updateDoc(doc(db, "chatRooms", room.id), { members: [...room.members, ...ids] });
          picker.hidden = true;
        }
      } catch { flash("Couldn't save that. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    });
    mount(picker, [el("p", { class: "chat-picker-title" }, mode === "group" ? (staff ? "New group (people from one section)" : "New group") : `Add people to \u201c${room.name}\u201d`), nameIn, find, body, el("div", { class: "chat-picker-actions" }, [go, closeBtn()])]);
    (nameIn || find)?.focus();
  }
  const closeBtn = () => { const b = el("button", { type: "button", class: "link" }, "Cancel"); b.addEventListener("click", () => { picker.hidden = true; }); return b; };
  async function startDm(other, circle) {
    const id = `dm_${[uid, other].sort().join("_")}`;
    try {
      const snap = await getDoc(doc(db, "chatRooms", id));
      if (!snap.exists()) await setDoc(doc(db, "chatRooms", id), { type: "dm", members: [uid, other].sort(), createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "",
        ...(circle ? { scope: "circle", circle } : {}) });
      open(id);
    } catch { flash(`Couldn't start a message with ${nameOf(other)}. (Republish the Firestore rules from the latest update if you haven't.)`, "error"); }
  }
  newDm.addEventListener("click", () => openPicker("dm"));
  newGroup.addEventListener("click", () => openPicker("group"));

  open(staff ? "company" : null);
  shell.classList.remove("show-thread"); // phones start on the list
  return () => { stopMsgs(); unRooms(); unDir(); unCompany(); unUsers(); circleUnsubs.forEach((u) => u()); };
}
