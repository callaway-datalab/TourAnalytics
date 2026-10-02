// Analyst chat: one shared conversation for the admin and every Callaway analyst, shown under Questions.
// Messages: staffChat/{id} = { uid, name, body, createdAt }. You can delete your own messages.
import { collection, addDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { el, mount, formatWhen, confirmAction } from "./ui.js";
import { getState } from "./auth.js";

export function watchStaffChat(cb) {
  return onSnapshot(query(collection(db, "staffChat"), orderBy("createdAt", "asc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb(null));
}
const send = (uid, name, body) => addDoc(collection(db, "staffChat"), { uid, name, body, createdAt: serverTimestamp() });

export function renderStaffChat(container, { flash }) {
  const state = getState();
  const uid = state.user.uid;
  const myName = state.profile?.name || state.user.displayName || state.user.email || "Me";
  const list = el("ol", { class: "chat-list", "aria-live": "polite" });
  const box = el("textarea", { rows: 2, maxLength: 2000, placeholder: "Message the analysts\u2026", "aria-label": "Message", enterkeyhint: "send" });
  const sendBtn = el("button", { class: "btn", type: "submit" }, "Send");
  const form = el("form", {
    class: "chat-form",
    onSubmit: async (e) => {
      e.preventDefault();
      const body = box.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try { await send(uid, myName, body); box.value = ""; box.focus(); }
      catch { flash("Couldn't send that message. (Republish the Firestore rules if you haven't since this update.)", "error"); }
      finally { sendBtn.disabled = false; }
    },
  }, [box, sendBtn]);
  // Enter sends; Shift+Enter makes a new line.
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  mount(container, el("section", { class: "panel chat" }, [
    el("h3", {}, "Analyst chat"),
    el("p", { class: "muted small" }, "Only you and Callaway analysts can see this."),
    list,
    form,
  ]));

  let first = true;
  const unsub = watchStaffChat((msgs) => {
    if (msgs === null) { mount(list, el("li", { class: "empty" }, "The chat isn't available. Republish the Firestore rules from this update.")); return; }
    // Stay at the bottom only if you were already there (don't yank you away while reading back).
    const atBottom = first || list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    mount(list, msgs.length ? msgs.map((m) => {
      const mine = m.uid === uid;
      const del = mine || state.isAdmin ? el("button", { type: "button", class: "chat-del", "aria-label": "Delete message", title: "Delete" }, "\u2715") : null;
      del?.addEventListener("click", async () => {
        if (!confirmAction("Delete this message?")) return;
        try { await deleteDoc(doc(db, "staffChat", m.id)); } catch { flash("Couldn't delete that message.", "error"); }
      });
      return el("li", { class: "chat-msg" + (mine ? " mine" : "") }, [
        el("div", { class: "chat-meta" }, [el("strong", {}, mine ? "You" : m.name || "Analyst"), el("span", { class: "muted" }, m.createdAt ? formatWhen(m.createdAt) : "sending\u2026"), del]),
        el("p", { class: "chat-body" }, m.body),
      ]);
    }) : el("li", { class: "empty" }, "No messages yet. Say hello."));
    if (atBottom) list.scrollTop = list.scrollHeight;
    first = false;
  });
  return unsub;
}
