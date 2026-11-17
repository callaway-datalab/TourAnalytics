// (update 829) Chat & support, for everyone outside Callaway (players, coaches, caddies): no messaging each other any more.
// Three ways in: Report an issue, Ask a question, Request a feature. Everything goes to Callaway's analysts and the admin,
// into the person's own Callaway Analyst conversation (chatRooms/ca_{uid}; each message tagged with its topic), where the
// admin and the analysts already answer it in their Chat. Someone whose analyst access the admin turned off writes to the
// admin alone (their Report an issue conversation, issue_{uid}). Below: the whole conversation, newest at the bottom.
import { collection, addDoc, doc, getDoc, setDoc, updateDoc, onSnapshot, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, adminUids } from "../firebase-init.js";
import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { myAnalystAccess } from "../store.js";

const TOPICS = [
  { k: "issue", icon: "⚠", title: "Report an issue", sub: "Something wrong or not working", ph: "What went wrong? What were you doing when it happened?", tag: "Issue" },
  { k: "question", icon: "?", title: "Ask a question", sub: "About a player, the data or the site", ph: "What would you like to know?", tag: "Question" },
  { k: "feature", icon: "✦", title: "Request a feature", sub: "Something you'd like the site to do", ph: "What would you like added or changed, and what would it help you do?", tag: "Feature request" },
];
const markRead = (uid, roomId) => { try { localStorage.setItem(`chatRead:${uid}:${roomId}`, String(Date.now())); } catch { /* */ } window.dispatchEvent(new Event("ta-chat-read")); };

export async function render(main, { flash = () => {} } = {}) {
  const st = getState(), uid = st.user.uid, myName = st.profile?.name || st.user.displayName || st.user.email || "";
  const caOk = await myAnalystAccess(st.profile?.inviteCode).catch(() => true);
  const caId = `ca_${uid}`, issueId = `issue_${uid}`, roomId = caOk ? caId : issueId;
  let staffIds = [...adminUids], prevPage = null;
  try { prevPage = sessionStorage.getItem("ta.prevPage"); } catch { /* */ }
  const unsubs = [];
  unsubs.push(onSnapshot(doc(db, "chatStaff", "all"), (d) => { staffIds = [...new Set([...adminUids, ...(d.exists() ? d.data().uids || [] : [])])]; }, () => {}));

  // the room, made the first time (Callaway's analysts and the admin in it; the admin alone without analyst access)
  async function ensureRoom() {
    const team = (caOk ? [...new Set([...adminUids, ...staffIds])] : adminUids).filter((x) => x !== uid);
    if (!team.length) throw new Error("no staff");
    const ref = doc(db, "chatRooms", roomId), snap = await getDoc(ref);
    const base = caOk ? { callaway: true, name: "Callaway Analyst" } : { issue: true, name: "Report an issue" };
    if (!snap.exists()) await setDoc(ref, { type: "group", ...base, members: [uid, ...team], createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
    else if (!team.every((x) => snap.data().members.includes(x))) await updateDoc(ref, { members: [...new Set([...snap.data().members, ...team])] }).catch(() => {});
  }
  async function send(topic, text) {
    const t = TOPICS.find((x) => x.k === topic), body = `${t ? `[${t.tag}] ` : ""}${text}${topic === "issue" && prevPage ? `\n\n(Page: ${prevPage})` : ""}`.slice(0, 2000);
    await ensureRoom();
    await addDoc(collection(db, "chatRooms", roomId, "messages"), { uid, name: myName, body, ...(topic ? { topic } : {}), createdAt: serverTimestamp() });
    await updateDoc(doc(db, "chatRooms", roomId), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
  }

  // ---- the three ways in, and the box to write in ----
  let topic = null;
  const box = el("textarea", { rows: 5, maxLength: 1900, class: "sp-text", "aria-label": "Your message" });
  const msg = el("p", { class: "muted small sp-msg", role: "status" });
  const sendB = el("button", { type: "button", class: "btn" }, "Send");
  const cancelB = el("button", { type: "button", class: "btn ghost" }, "Cancel");
  const composeT = el("h3", {});
  const compose = el("section", { class: "panel sp-compose", hidden: true }, [composeT, box, msg, el("div", { class: "sp-btns" }, [cancelB, sendB])]);
  const cards = el("div", { class: "sp-cards" }, TOPICS.map((t) => { const b = el("button", { type: "button", class: `sp-card sp-${t.k}` }, [el("span", { class: "sp-ico", "aria-hidden": "true" }, t.icon), el("strong", {}, t.title), el("span", { class: "muted small" }, t.sub)]);
    b.addEventListener("click", () => { topic = t.k; composeT.textContent = t.title; box.placeholder = t.ph; compose.hidden = false; cards.querySelectorAll(".sp-card").forEach((x) => x.classList.toggle("on", x === b)); msg.textContent = ""; box.focus(); }); return b; }));
  cancelB.addEventListener("click", () => { compose.hidden = true; topic = null; box.value = ""; cards.querySelectorAll(".sp-card").forEach((x) => x.classList.remove("on")); });
  sendB.addEventListener("click", async () => {
    const text = box.value.trim(); if (!text) { msg.textContent = "Write a line or two first."; box.focus(); return; }
    sendB.disabled = true; sendB.textContent = "Sending…";
    try { await send(topic, text); box.value = ""; compose.hidden = true; cards.querySelectorAll(".sp-card").forEach((x) => x.classList.remove("on")); flash("Sent. Callaway will reply here.", "info"); }
    catch (e) { console.warn(e); msg.textContent = "Couldn't send that just now. Try again in a moment."; }
    finally { sendB.disabled = false; sendB.textContent = "Send"; }
  });

  // ---- the conversation: this room's messages (and an older Report an issue conversation, if there is one) ----
  const list = el("ol", { class: "sp-list" }, el("li", { class: "muted" }, "Loading…"));
  const reply = el("textarea", { rows: 2, maxLength: 1900, placeholder: "Reply…", class: "sp-reply", "aria-label": "Reply" });
  const replyB = el("button", { type: "button", class: "btn" }, "Send");
  replyB.addEventListener("click", async () => { const t = reply.value.trim(); if (!t) return; replyB.disabled = true; try { await send(null, t); reply.value = ""; } catch { flash("Couldn't send that just now.", "error"); } finally { replyB.disabled = false; } });
  const byRoom = new Map(), ms = (t) => (t?.toMillis ? t.toMillis() : 0);
  const paint = () => {
    const all = [...byRoom.values()].flat().sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    if (!all.length) { mount(list, el("li", { class: "sp-empty muted" }, "Nothing here yet. Pick one of the three above to get in touch: Callaway's analysts and the admin will reply here.")); return; }
    mount(list, all.map((m) => { const mine = m.uid === uid, t = TOPICS.find((x) => x.k === m.topic) || (/^\[(Issue|Question|Feature request)\]/.exec(m.body || "") ? TOPICS.find((x) => m.body.startsWith(`[${x.tag}]`)) : null);
      const body = String(m.body || "").replace(/^\[(Issue|Question|Feature request)\]\s*/, "");
      return el("li", { class: `sp-m${mine ? " mine" : ""}` }, [el("div", { class: "sp-who" }, [el("strong", {}, mine ? "You" : "Callaway Analyst"), t ? el("span", { class: `sp-tag sp-${t.k}` }, t.tag) : null, el("span", { class: "muted small" }, formatWhen(m.createdAt))]), el("p", {}, body)]); }));
    list.lastElementChild?.scrollIntoView({ block: "nearest" });
    markRead(uid, roomId);
  };
  for (const id of [...new Set([roomId, issueId])]) unsubs.push(onSnapshot(query(collection(db, "chatRooms", id, "messages"), orderBy("createdAt", "asc")), (s) => { byRoom.set(id, s.docs.map((d) => ({ id: d.id, ...d.data() }))); paint(); }, () => { byRoom.set(id, []); paint(); }));
  setDoc(doc(db, "chatRooms", roomId, "reads", uid), { at: serverTimestamp() }).catch(() => {});

  mount(main, el("div", { class: "sp" }, [
    el("header", { class: "page-head" }, [el("h1", {}, "Chat & support"), el("p", { class: "muted" }, caOk ? "Everything you send here goes to Callaway's analysts and the admin, and they reply here." : "Everything you send here goes to the admin, who replies here.")]),
    cards, compose,
    el("section", { class: "panel sp-conv" }, [el("h3", {}, caOk ? "Your conversation with Callaway" : "Your conversation with the admin"), list, el("div", { class: "sp-replyrow" }, [reply, replyB])]),
  ]));
  return () => unsubs.forEach((f) => { try { f(); } catch { /* */ } });
}
