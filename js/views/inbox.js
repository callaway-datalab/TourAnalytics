// (update 893) The support inbox: Chat for the admin and Callaway's analysts (everyone else has Chat & support).
// Three buckets, as people send them from Chat & support: Issues, Questions, Feature requests (each person's own
// conversation of that kind, chatRooms/sup_{kind}_{uid}; older conversations from before the split sit with Questions,
// older issue reports with Issues). Each conversation is someone's job: unassigned until an analyst claims it (or answers
// it: that claims it too) or the admin assigns it; done when marked done, back open when the person writes again.
// Who's on what is chatTriage/{roomId} { state: "working" | "assigned" | "done", by: uid, assignedBy, at }, staff only.
// A fourth bucket, Team: the whole team's chat (ca_staff) and a direct message with any analyst or the admin.
// Replies to players and coaches are signed "Callaway Analyst" (they never see which analyst); inside, everyone sees who.
import { collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, orderBy, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, adminUids } from "../firebase-init.js";
import { el, mount, formatWhen } from "../ui.js";
import { getState } from "../auth.js";

const BUCKETS = [["issue", "Issues", "⚠"], ["question", "Questions", "?"], ["feature", "Feature requests", "✦"], ["team", "Team", "★"]];
const TAG = { issue: "Issue", question: "Question", feature: "Feature request" };
const STAFF_ROOM = "ca_staff";
const ms = (t) => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : 0);
const readKey = (uid, id) => `chatRead:${uid}:${id}`;
const lastRead = (uid, id) => { try { return Number(localStorage.getItem(readKey(uid, id))) || 0; } catch { return 0; } };
const markRead = (uid, id) => { try { localStorage.setItem(readKey(uid, id), String(Date.now())); } catch { /* */ } window.dispatchEvent(new Event("ta-chat-read")); };
let memBucket = "question", memFilter = "open"; // (kept while the app is open)

export function render(main, { flash = () => {} } = {}) {
  const state = getState(), uid = state.user.uid, isAdmin = !!state.isAdmin, myName = state.profile?.name || state.user.displayName || state.user.email || "Me";
  let rooms = [], staffIds = [...adminUids], current = null, stopMsgs = () => {}, msgsNow = [];
  const people = new Map(), triage = new Map(), unsubs = [];
  let bucket = memBucket, filter = memFilter;

  if (isAdmin) import("../chatCircles.js").then((m) => m.syncChatCircles()).catch(() => {}); // (the admin: everyone's names, every analyst in each conversation)
  // ---- who's who ----
  unsubs.push(onSnapshot(collection(db, "chatNames"), (s) => { s.docs.forEach((d) => people.set(d.id, d.data())); draw(); }, () => {}));
  if (isAdmin) getDocs(collection(db, "users")).then((snap) => { snap.docs.forEach((d) => { const u = d.data(); if (!people.has(d.id)) people.set(d.id, { name: u.name || u.email || "Someone", role: u.kind === "analyst" ? "analyst" : "" });
    if (u.kind === "analyst" && !staffIds.includes(d.id)) staffIds = [...staffIds, d.id]; }); draw(); }).catch(() => {});
  unsubs.push(onSnapshot(doc(db, "chatStaff", "all"), (d) => { staffIds = [...new Set([...adminUids, ...(d.exists() ? d.data().uids || [] : [])])]; draw(); }, () => {}));
  unsubs.push(onSnapshot(collection(db, "chatTriage"), (s) => { triage.clear(); s.docs.forEach((d) => triage.set(d.id, d.data())); draw(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "chatRooms"), where("members", "array-contains", uid)), (s) => { rooms = s.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); if (current) drawHead(); }, () => {}));
  const isStaffId = (id) => staffIds.includes(id) || adminUids.includes(id) || ["admin", "analyst"].includes(people.get(id)?.role);
  const nameOf = (id) => (id === uid ? "You" : people.get(id)?.name || (adminUids.includes(id) ? "Admin" : "Someone"));
  const first = (id) => (id === uid ? "you" : String(nameOf(id)).split(/\s+/)[0]);
  const allStaff = () => [...new Set([...adminUids, ...staffIds, ...[...people.keys()].filter((id) => ["admin", "analyst"].includes(people.get(id)?.role))])];

  // ---- the conversations: which bucket, whose job, what state ----
  const ownerOf = (r) => (/^sup_(issue|question|feature)_/.test(r.id) ? r.id.replace(/^sup_(issue|question|feature)_/, "") : /^ca_/.test(r.id) && r.id !== STAFF_ROOM ? r.id.slice(3) : /^issue_/.test(r.id) ? r.id.slice(6) : r.createdBy);
  const isSupport = (r) => r.id !== STAFF_ROOM && !r.staffRoom && (r.callaway || r.issue);
  const bucketOf = (r) => (!isSupport(r) ? "team" : r.issue ? "issue" : TAG[r.topic] ? r.topic : "question");
  const isTeamRoom = (r) => r.id === STAFF_ROOM || r.staffRoom || (!isSupport(r) && r.members.every(isStaffId));
  const unread = (r) => ms(r.lastAt) > lastRead(uid, r.id) && r.lastBy && r.lastBy !== uid;
  const statusOf = (r) => { const t = triage.get(r.id) || {}, theirsLast = r.lastBy && !isStaffId(r.lastBy);
    const reopened = t.state === "done" && theirsLast && ms(r.lastAt) > ms(t.at);
    if (t.state === "done" && !reopened) return { k: "done", by: t.by, t };
    const by = ["working", "assigned", "answered"].includes(t.state) || reopened ? t.by || null : null;
    return { k: by ? "taken" : "open", by, t, waiting: theirsLast, reopened, assignedBy: t.state === "assigned" ? t.assignedBy : null }; };
  const statusText = (s) => (s.k === "done" ? `Done${s.by ? ` · ${first(s.by)}` : ""}` : s.k === "taken" ? (s.by === uid ? "You're on it" : `${nameOf(s.by)} is on it`) : "Unassigned");
  async function setTriage(id, data) { try { await setDoc(doc(db, "chatTriage", id), { ...data, at: serverTimestamp() }); } catch { flash("Couldn't save that. (Republish the Firestore rules from the latest update.)", "error"); } }

  // ---- the page ----
  const tabs = el("nav", { class: "ib-tabs", "aria-label": "Buckets" });
  const filters = el("div", { class: "ib-filters", role: "group", "aria-label": "Show" });
  const list = el("ul", { class: "ib-list" });
  const head = el("div", { class: "ib-head" }), msgs = el("ol", { class: "ib-msgs" });
  const box = el("textarea", { rows: 3, maxLength: 1900, class: "ib-box", placeholder: "Write a reply…", "aria-label": "Reply" });
  const sendB = el("button", { type: "button", class: "btn" }, "Send");
  const form = el("div", { class: "ib-form", hidden: true }, [box, sendB]);
  const back = el("button", { type: "button", class: "link ib-back" }, "← All conversations");
  const thread = el("section", { class: "ib-thread" }, [back, head, msgs, form]);
  const shell = el("div", { class: "ib-shell" }, [el("aside", { class: "ib-side" }, [filters, list]), thread]);
  mount(main, el("div", { class: "ib" }, [el("header", { class: "ib-top" }, [el("h1", {}, "Support inbox"), el("p", { class: "muted" }, "Everything players, coaches and caddies send from Chat & support, in its bucket. Claim one to take it, or (the admin) assign it; everyone sees who's on what. Team is your own chat with the analysts.")]), tabs, shell]));
  back.addEventListener("click", () => shell.classList.remove("show-thread"));
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); });
  sendB.addEventListener("click", () => send());

  function draw() {
    const sup = rooms.filter(isSupport);
    mount(tabs, BUCKETS.map(([k, label, ico]) => { const xs = k === "team" ? rooms.filter(isTeamRoom) : sup.filter((r) => bucketOf(r) === k);
      const open = k === "team" ? xs.filter(unread).length : xs.filter((r) => statusOf(r).k !== "done").length, mine = k === "team" ? 0 : xs.filter((r) => statusOf(r).by === uid && statusOf(r).k === "taken").length, un = xs.filter(unread).length;
      const b = el("button", { type: "button", class: `ib-tab ib-${k}${k === bucket ? " on" : ""}`, "aria-pressed": String(k === bucket) }, [el("span", { class: "ib-ico", "aria-hidden": "true" }, ico), el("span", {}, label),
        open ? el("b", { class: "ib-count", title: k === "team" ? "Unread" : `${open} open${mine ? `, ${mine} yours` : ""}` }, String(open)) : null, un && k !== "team" ? el("i", { class: "ib-dot", "aria-label": "Unread" }) : null]);
      b.addEventListener("click", () => { bucket = memBucket = k; current = null; draw(); mount(head, []); mount(msgs, []); form.hidden = true; }); return b; }));
    if (bucket === "team") { filters.hidden = true; drawTeam(); return; }
    filters.hidden = false;
    const F = [["open", "Open"], ["unassigned", "Unassigned"], ["mine", "Mine"], ["done", "Done"], ["all", "All"]];
    mount(filters, F.map(([k, l]) => { const b = el("button", { type: "button", class: `ip-pill${k === filter ? " on" : ""}`, "aria-pressed": String(k === filter) }, l); b.addEventListener("click", () => { filter = memFilter = k; draw(); }); return b; }));
    const xs = sup.filter((r) => bucketOf(r) === bucket).filter((r) => { const s = statusOf(r); return filter === "all" || (filter === "open" ? s.k !== "done" : filter === "unassigned" ? s.k === "open" : filter === "mine" ? s.by === uid && s.k === "taken" : s.k === "done"); })
      .sort((a, b) => (statusOf(b).waiting - statusOf(a).waiting) || ms(b.lastAt) - ms(a.lastAt));
    if (!xs.length) { mount(list, el("li", { class: "ib-empty muted" }, filter === "open" ? `Nothing open in ${BUCKETS.find((b) => b[0] === bucket)[1]}.` : "Nothing here.")); return; }
    mount(list, xs.map((r) => { const s = statusOf(r), who = ownerOf(r);
      const b = el("button", { type: "button", class: `ib-item${r.id === current ? " on" : ""}` }, [
        el("span", { class: "ib-line" }, [el("strong", {}, nameOf(who)), el("span", { class: "muted small" }, formatWhen(r.lastAt))]),
        el("span", { class: "ib-last muted" }, (r.lastText || "").replace(/^\[(Issue|Question|Feature request)\]\s*/, "").slice(0, 90) || "—"),
        el("span", { class: "ib-line" }, [el("span", { class: `ib-st st-${s.k}${s.by === uid ? " mine" : ""}` }, statusText(s)), s.waiting && s.k !== "done" ? el("span", { class: "ib-wait" }, s.reopened ? "Wrote again" : "Waiting for a reply") : null, unread(r) ? el("i", { class: "ib-dot", "aria-label": "Unread" }) : null])]);
      b.addEventListener("click", () => open(r.id)); return el("li", {}, b); }));
  }
  function drawTeam() {
    const team = allStaff().filter((id) => id !== uid).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const dmId = (o) => `dm_${[uid, o].sort().join("_")}`, room = (id) => rooms.find((r) => r.id === id);
    const item = (id, label, sub, onClick) => { const r = room(id), b = el("button", { type: "button", class: `ib-item${id === current ? " on" : ""}` }, [el("span", { class: "ib-line" }, [el("strong", {}, label), r?.lastAt ? el("span", { class: "muted small" }, formatWhen(r.lastAt)) : null]), el("span", { class: "ib-last muted" }, r?.lastText ? r.lastText.slice(0, 90) : sub), r && unread(r) ? el("i", { class: "ib-dot", "aria-label": "Unread" }) : null]);
      b.addEventListener("click", onClick); return el("li", {}, b); };
    const others = rooms.filter((r) => isTeamRoom(r) && r.id !== STAFF_ROOM && !team.some((o) => dmId(o) === r.id)).sort((a, b) => ms(b.lastAt) - ms(a.lastAt));
    mount(list, [el("li", { class: "ib-sec" }, "Everyone"), item(STAFF_ROOM, "Callaway team", "The admin and every analyst", () => startTeamRoom()),
      el("li", { class: "ib-sec" }, "Direct messages"), ...(team.length ? team.map((o) => item(dmId(o), nameOf(o), adminUids.includes(o) ? "Admin" : "Analyst", () => startDm(o))) : [el("li", { class: "ib-empty muted" }, "No analysts yet: give someone Callaway Access as an Analyst on User Access.")]),
      ...(others.length ? [el("li", { class: "ib-sec" }, "Other team chats"), ...others.map((r) => item(r.id, r.name || r.members.filter((m) => m !== uid).map(nameOf).join(", "), "", () => open(r.id)))] : [])]);
  }
  async function startTeamRoom() {
    const team = allStaff();
    try { const ref = doc(db, "chatRooms", STAFF_ROOM), snap = await getDoc(ref);
      if (!snap.exists()) await setDoc(ref, { type: "group", staffRoom: true, name: "Callaway Analyst", members: team, createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" });
      else if (!snap.data().members.includes(uid)) { flash("You'll be added to the team chat the next time the admin opens Chat."); return; }
      else if (isAdmin && !team.every((x) => snap.data().members.includes(x))) await updateDoc(ref, { members: [...new Set([...snap.data().members, ...team])] }).catch(() => {});
      open(STAFF_ROOM); } catch { flash("Couldn't open the team chat.", "error"); } }
  async function startDm(o) {
    const id = `dm_${[uid, o].sort().join("_")}`;
    try { const snap = await getDoc(doc(db, "chatRooms", id)); if (!snap.exists()) await setDoc(doc(db, "chatRooms", id), { type: "dm", members: [uid, o].sort(), createdBy: uid, createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastBy: "" }); open(id); }
    catch { flash(`Couldn't start a message with ${nameOf(o)}.`, "error"); } }

  // ---- one conversation ----
  function open(id) {
    current = id; stopMsgs(); shell.classList.add("show-thread"); form.hidden = false; msgsNow = [];
    mount(msgs, el("li", { class: "muted" }, "Loading…")); drawHead(); draw();
    stopMsgs = onSnapshot(query(collection(db, "chatRooms", id, "messages"), orderBy("createdAt", "asc")), (s) => { msgsNow = s.docs.map((d) => ({ id: d.id, ...d.data() })); drawMsgs(); markRead(uid, id); setDoc(doc(db, "chatRooms", id, "reads", uid), { at: serverTimestamp() }).catch(() => {}); }, () => mount(msgs, el("li", { class: "muted" }, "Couldn't open this conversation.")));
  }
  function drawHead() {
    const r = rooms.find((x) => x.id === current); if (!r && current !== STAFF_ROOM && !String(current).startsWith("dm_")) return;
    if (!r || !isSupport(r)) { mount(head, el("div", { class: "ib-title" }, [el("strong", {}, current === STAFF_ROOM ? "Callaway team" : r?.name || (r?.members || []).filter((m) => m !== uid).map(nameOf).join(", ") || "Direct message"), el("span", { class: "muted small" }, current === STAFF_ROOM ? "The admin and every analyst" : "Only Callaway can see this")])); return; }
    const s = statusOf(r), who = ownerOf(r), k = bucketOf(r), p = people.get(who);
    const btn = (label, cls, fn) => { const b = el("button", { type: "button", class: `ip-pill ${cls}` }, label); b.addEventListener("click", fn); return b; };
    const acts = [];
    if (s.k !== "taken" || s.by !== uid) acts.push(btn(s.k === "taken" ? "Take it over" : "Claim", "ib-claim", () => setTriage(r.id, { state: "working", by: uid, assignedBy: null })));
    if (s.k === "taken" && s.by === uid) acts.push(btn("Let it go", "", () => setTriage(r.id, { state: "open", by: null, assignedBy: null })));
    if (isAdmin) { const sel = el("select", { class: "ip-sel ib-assign", "aria-label": "Assign to" }, [el("option", { value: "" }, "Assign to…"), ...allStaff().sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((id) => el("option", { value: id, ...(s.by === id ? { selected: true } : {}) }, id === uid ? "Me" : nameOf(id)))]);
      sel.addEventListener("change", () => { if (sel.value) setTriage(r.id, { state: sel.value === uid ? "working" : "assigned", by: sel.value, assignedBy: uid }); }); acts.push(sel); }
    acts.push(s.k === "done" ? btn("Reopen", "", () => setTriage(r.id, { state: s.by ? "working" : "open", by: s.by || null, assignedBy: null })) : btn("Mark done", "ib-done", () => setTriage(r.id, { state: "done", by: s.by || uid, assignedBy: null })));
    mount(head, [el("div", { class: "ib-title" }, [el("strong", {}, nameOf(who)), el("span", { class: `ib-tag ib-${k}` }, TAG[k] || "Question"), p?.title || p?.role ? el("span", { class: "muted small" }, p.title || p.role) : null]),
      el("div", { class: "ib-who" }, [el("span", { class: `ib-st st-${s.k}${s.by === uid ? " mine" : ""}` }, statusText(s)), s.assignedBy && s.by ? el("span", { class: "muted small" }, `assigned by ${first(s.assignedBy)}`) : null, s.reopened ? el("span", { class: "ib-wait" }, "Wrote again after it was done") : null]),
      el("div", { class: "ib-acts" }, acts)]);
  }
  function drawMsgs() {
    const r = rooms.find((x) => x.id === current);
    if (!msgsNow.length) { mount(msgs, el("li", { class: "muted ib-empty" }, "No messages yet.")); return; }
    mount(msgs, msgsNow.map((m) => { const mine = m.uid === uid, staffM = isStaffId(m.uid), t = TAG[m.topic];
      return el("li", { class: `ib-m${mine ? " mine" : staffM ? " staff" : ""}` }, [el("div", { class: "ib-mh" }, [el("strong", {}, mine ? "You" : staffM ? nameOf(m.uid) : m.name || nameOf(m.uid)), staffM && r && isSupport(r) && !mine ? el("span", { class: "muted small" }, "(as Callaway Analyst)") : null, t ? el("span", { class: `ib-tag ib-${m.topic}` }, t) : null, el("span", { class: "muted small" }, formatWhen(m.createdAt))]),
        el("p", {}, String(m.body || "").replace(/^\[(Issue|Question|Feature request)\]\s*/, ""))]); }));
    msgs.lastElementChild?.scrollIntoView({ block: "nearest" });
  }
  async function send() {
    const body = box.value.trim(), r = rooms.find((x) => x.id === current); if (!body || !current) return;
    sendB.disabled = true;
    try { const outsiders = r && isSupport(r);
      await addDoc(collection(db, "chatRooms", current, "messages"), { uid, name: outsiders ? (r.issue ? "Admin" : "Callaway Analyst") : myName, body: body.slice(0, 2000), createdAt: serverTimestamp() });
      await updateDoc(doc(db, "chatRooms", current), { lastAt: serverTimestamp(), lastText: body.slice(0, 120), lastBy: uid }).catch(() => {});
      // answering one nobody has (or one marked done that they wrote to again) makes it yours
      if (outsiders) { const s = statusOf(r); if (s.k === "open" || s.reopened) await setTriage(r.id, { state: "working", by: uid, assignedBy: null }); }
      box.value = ""; box.focus(); }
    catch { flash("Couldn't send that. (Republish the Firestore rules from the latest update if you haven't.)", "error"); }
    finally { sendB.disabled = false; }
  }
  draw();
  return () => { stopMsgs(); unsubs.forEach((f) => { try { f(); } catch { /* */ } }); };
}
