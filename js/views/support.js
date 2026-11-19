// (update 829) Chat & support, for everyone outside Callaway (players, coaches, caddies): no messaging each other any more.
// Three ways in: Report an issue, Ask a question, Request a feature. Everything goes to Callaway's analysts and the admin,
// into the person's own Callaway Analyst conversation (chatRooms/ca_{uid}; each message tagged with its topic), where the
// admin and the analysts already answer it in their Chat. Someone whose analyst access the admin turned off writes to the
// admin alone (their Report an issue conversation, issue_{uid}). Below: the whole conversation, newest at the bottom.
import { collection, addDoc, doc, getDoc, setDoc, updateDoc, onSnapshot, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, adminUids } from "../firebase-init.js";
import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";
import { attachPicker, attachmentLinks } from "../attachments.js"; // (update 896) files with a message
import { uploadChatFiles, getChatFileUrl } from "../store.js";

const TOPICS = [
  { k: "issue", icon: "⚠", title: "Report an issue", sub: "Something wrong or not working", ph: "What went wrong? What were you doing when it happened?", tag: "Issue" },
  { k: "question", icon: "?", title: "Ask a question", sub: "About a player, the data or the site", ph: "What would you like to know?", tag: "Question" },
  { k: "feature", icon: "✦", title: "Request a feature", sub: "Something you'd like the site to do", ph: "What would you like added or changed, and what would it help you do?", tag: "Feature request" },
];
const markRead = (uid, roomId) => { try { localStorage.setItem(`chatRead:${uid}:${roomId}`, String(Date.now())); } catch { /* */ } window.dispatchEvent(new Event("ta-chat-read")); };

export async function render(main, { flash = () => {} } = {}) {
  const st = getState(), uid = st.user.uid, myName = st.profile?.name || st.user.displayName || st.user.email || "";
  // (update 892) open to everyone; each kind in its own conversation (sup_issue_{uid}, sup_question_{uid}, sup_feature_{uid}),
  // so Callaway's side keeps them in separate buckets; the person sees them all as one conversation. Older ones too
  // (ca_{uid}: everything before; issue_{uid}: the admin-only reports)
  const caOk = true, caId = `ca_${uid}`, issueId = `issue_${uid}`, roomOf = (k) => `sup_${k}_${uid}`, roomId = roomOf("question");
  let lastRoom = null; // (a reply goes to the conversation of the latest message)
  let staffIds = [...adminUids], prevPage = null;
  try { prevPage = sessionStorage.getItem("ta.prevPage"); } catch { /* */ }
  const unsubs = [];
  unsubs.push(onSnapshot(doc(db, "chatStaff", "all"), (d) => { staffIds = [...new Set([...adminUids, ...(d.exists() ? d.data().uids || [] : [])])]; }, () => {}));

  // the room, made the first time (Callaway's analysts and the admin in it; the admin alone without analyst access)
  async function ensureRoom(roomId, topic) {
    const team = [...new Set([...adminUids, ...staffIds])].filter((x) => x !== uid);
    if (!team.length) throw new Error("no staff");
    const ref = doc(db, "chatRooms", roomId), snap = await getDoc(ref);
    const base = roomId === caId ? { callaway: true, name: "Callaway Analyst" } : roomId === issueId ? { issue: true, name: "Report an issue" } : { callaway: true, name: "Callaway Analyst", topic };
    if (!snap.exists()) await setDoc(ref, { type: "group", ...base, members: [uid, ...team], createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
    else if (!team.every((x) => snap.data().members.includes(x))) await updateDoc(ref, { members: [...new Set([...snap.data().members, ...team])] }).catch(() => {});
  }
  async function send(topic, text, files = []) {
    const t = TOPICS.find((x) => x.k === topic);
    const roomId = topic ? roomOf(topic) : lastRoom || roomOf("question");
    await ensureRoom(roomId, topic || roomTopic(roomId));
    const attachments = files.length ? await uploadChatFiles(roomId, files, uid) : [];
    const text1 = text || attachments.map((a) => `\u{1F4CE} ${a.name}`).join(", ");
    const body = `${t ? `[${t.tag}] ` : ""}${text1}${topic === "issue" && prevPage ? `\n\n(Page: ${prevPage})` : ""}`.slice(0, 2000);
    await addDoc(collection(db, "chatRooms", roomId, "messages"), { uid, name: myName, body, ...(topic ? { topic } : {}), ...(attachments.length ? { attachments, ...(text ? {} : { fileOnly: true }) } : {}), createdAt: serverTimestamp() });
    await updateDoc(doc(db, "chatRooms", roomId), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
  }

  // ---- the three ways in, and the box to write in ----
  let topic = null;
  const box = el("textarea", { rows: 5, maxLength: 1900, class: "sp-text", "aria-label": "Your message" });
  const msg = el("p", { class: "muted small sp-msg", role: "status" });
  const sendB = el("button", { type: "button", class: "btn" }, "Send");
  const cancelB = el("button", { type: "button", class: "btn ghost" }, "Cancel");
  const composeT = el("h3", {});
  const pick = attachPicker(), pickR = attachPicker();
  const compose = el("section", { class: "panel sp-compose", hidden: true }, [composeT, box, pick.node, msg, el("div", { class: "sp-btns" }, [cancelB, sendB])]);
  const cards = el("div", { class: "sp-cards" }, TOPICS.map((t) => { const b = el("button", { type: "button", class: `sp-card sp-${t.k}` }, [el("span", { class: "sp-ico", "aria-hidden": "true" }, t.icon), el("strong", {}, t.title), el("span", { class: "muted small" }, t.sub)]);
    b.addEventListener("click", () => { topic = t.k; composeT.textContent = t.title; box.placeholder = t.ph; compose.hidden = false; cards.querySelectorAll(".sp-card").forEach((x) => x.classList.toggle("on", x === b)); msg.textContent = ""; box.focus(); }); return b; }));
  cancelB.addEventListener("click", () => { compose.hidden = true; topic = null; box.value = ""; cards.querySelectorAll(".sp-card").forEach((x) => x.classList.remove("on")); });
  sendB.addEventListener("click", async () => {
    const text = box.value.trim(), files = pick.files(); if (!text && !files.length) { msg.textContent = "Write a line or two first (or attach a file)."; box.focus(); return; }
    sendB.disabled = true; sendB.textContent = files.length ? "Uploading…" : "Sending…";
    try { await send(topic, text, files); box.value = ""; pick.clear(); compose.hidden = true; cards.querySelectorAll(".sp-card").forEach((x) => x.classList.remove("on")); flash("Sent. Callaway will reply here.", "info"); }
    catch (e) { console.warn(e); msg.textContent = e?.message && /file|MB|too (big|large|many)/i.test(e.message) ? e.message : "Couldn't send that just now. Try again in a moment."; }
    finally { sendB.disabled = false; sendB.textContent = "Send"; }
  });

  // ---- the conversation: this room's messages (and an older Report an issue conversation, if there is one) ----
  const list = el("ol", { class: "sp-list" }, el("li", { class: "muted" }, "Loading…"));
  const reply = el("textarea", { rows: 2, maxLength: 1900, placeholder: "Reply…", class: "sp-reply", "aria-label": "Reply" });
  const replyB = el("button", { type: "button", class: "btn" }, "Send");
  replyB.addEventListener("click", async () => { const t = reply.value.trim(), files = pickR.files(); if (!t && !files.length) return; replyB.disabled = true; replyB.textContent = files.length ? "Uploading…" : "Send";
    try { await send(null, t, files); reply.value = ""; pickR.clear(); } catch (e) { flash(e?.message && /file|MB|too (big|large|many)/i.test(e.message) ? e.message : "Couldn't send that just now.", "error"); } finally { replyB.disabled = false; replyB.textContent = "Send"; } });
  const byRoom = new Map(), ms = (t) => (t?.toMillis ? t.toMillis() : 0);
  function roomTopic(id) { const m = /^sup_(issue|question|feature)_/.exec(id); return m ? m[1] : null; }
  const replyTo = el("span", { class: "muted small sp-replyto" });
  const paint = () => {
    const all = [...byRoom].flatMap(([id, xs]) => xs.map((m) => ({ ...m, room: id, topic: m.topic || roomTopic(id) || undefined }))).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    const lastM = all.at(-1); lastRoom = lastM ? (lastM.room === caId || lastM.room === issueId ? roomOf(lastM.topic || "question") : lastM.room) : null;
    { const t = TOPICS.find((x) => x.k === roomTopic(lastRoom || "")); replyTo.textContent = t ? `Replying to your latest: ${t.tag}` : ""; }
    if (!all.length) { mount(list, el("li", { class: "sp-empty muted" }, "Nothing here yet. Pick one of the three above to get in touch: Callaway's analysts and the admin will reply here.")); return; }
    mount(list, all.map((m) => { const mine = m.uid === uid, t = TOPICS.find((x) => x.k === m.topic) || (/^\[(Issue|Question|Feature request)\]/.exec(m.body || "") ? TOPICS.find((x) => m.body.startsWith(`[${x.tag}]`)) : null);
      const body = String(m.body || "").replace(/^\[(Issue|Question|Feature request)\]\s*/, "");
      return el("li", { class: `sp-m${mine ? " mine" : ""}` }, [el("div", { class: "sp-who" }, [el("strong", {}, mine ? "You" : "Callaway Analyst"), t ? el("span", { class: `sp-tag sp-${t.k}` }, t.tag) : null, el("span", { class: "muted small" }, formatWhen(m.createdAt))]), el("p", {}, m.fileOnly ? "" : body), m.attachments?.length ? attachmentLinks(m.room, m.attachments, flash, (att) => getChatFileUrl(m.room, att)) : null]); }));
    list.lastElementChild?.scrollIntoView({ block: "nearest" });
    for (const id of byRoom.keys()) markRead(uid, id);
  };
  for (const id of [roomOf("issue"), roomOf("question"), roomOf("feature"), caId, issueId]) unsubs.push(onSnapshot(query(collection(db, "chatRooms", id, "messages"), orderBy("createdAt", "asc")), (s) => { byRoom.set(id, s.docs.map((d) => ({ id: d.id, ...d.data() }))); paint(); }, () => { byRoom.set(id, []); paint(); }));
  setDoc(doc(db, "chatRooms", roomId, "reads", uid), { at: serverTimestamp() }).catch(() => {});

  mount(main, el("div", { class: "sp" }, [
    el("header", { class: "page-head" }, [el("h1", {}, "Chat & support"), el("p", { class: "muted" }, caOk ? "Everything you send here goes to Callaway's analysts and the admin, and they reply here." : "Everything you send here goes to the admin, who replies here.")]),
    cards, compose,
    el("section", { class: "panel sp-conv" }, [el("h3", {}, caOk ? "Your conversation with Callaway" : "Your conversation with the admin"), list, replyTo, el("div", { class: "sp-replyrow" }, [reply, replyB]), pickR.node]),
  ]));
  return () => unsubs.forEach((f) => { try { f(); } catch { /* */ } });
}
