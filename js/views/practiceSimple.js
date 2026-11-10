// (update 690) Practice, made simple: goals with a target and a number of sets, ticked off on the honour system, and a
// quick log of each session (how long, which goals, how many sets). No shot-by-shot detail. Coaches see what their
// players have done; a coach with Allow coaching (User Access) can add goals to a player's list.
//
//   practice/{owner}/plan/{id}  a goal: { title, cat, target | goal…, setsTarget, setsDone, addedAt, sentBy, playerKey }
//                               (goals added from Stats are the same documents, with their drill's fields)
//   practice/{owner}/log/{id}   a session: { at, minutes, mode: "session" | "goal" | "timer", place, items: [{ id, title, cat, sets, minutes }] }
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { listPlan, savePlanItem, deletePlanItem, newPlanId, planOwner, goalText } from "../practice/plan.js";

const fsP = () => Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("../firebase-init.js")]).then(([f, i]) => ({ ...f, db: i.db }));
async function listLog(owner) {
  if (!owner) return [];
  try { const { getDocs, collection, db } = await fsP(); const s = await getDocs(collection(db, "practice", owner, "log")); return s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
  catch (err) { console.error(err); return []; }
}
async function saveLog(owner, entry) { const { setDoc, doc, db } = await fsP(); const { id, ...rest } = entry; return setDoc(doc(db, "practice", owner, "log", id), JSON.parse(JSON.stringify(rest))); }
async function deleteLog(owner, id) { const { deleteDoc, doc, db } = await fsP(); return deleteDoc(doc(db, "practice", owner, "log", id)); }

const AREAS = [["OTT", "Driving"], ["APP", "Approach"], ["ARG", "Short game"], ["PUTT", "Putting"], ["OTHER", "Other"]];
const areaOf = (cat) => AREAS.find(([k]) => k === cat)?.[1] || "Other";
const setsTarget = (g) => Math.max(1, Number(g.setsTarget) || 3);
const setsDone = (g) => Math.max(0, Number(g.setsDone) || 0);
const statusOf = (g) => { const d = setsDone(g), t = setsTarget(g); return d >= t ? ["done", `Done · ${t}/${t} sets`] : d > 0 ? ["prog", `In progress · ${d}/${t} sets`] : ["todo", `Yet to start · 0/${t}`]; };
const targetOf = (g) => g.target || (g.kind ? (() => { try { return goalText(g); } catch { return ""; } })() : "") || "";
const fmtMin = (m) => { m = Math.round(Number(m) || 0); if (!m) return "—"; const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`; };
const dayMs = 864e5, since = (days) => Date.now() - days * dayMs;
const whenTxt = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ""; const d = Math.floor((Date.now() - t) / dayMs); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? new Date(t).toLocaleDateString(undefined, { weekday: "short" }) : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const ago = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return "Never"; const d = Math.floor((Date.now() - t) / dayMs); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`; };
// each session's minutes, shared out across its goals (by the minutes given for each, or by sets)
function minutesByItem(entry) {
  const items = entry.items || [];
  if (items.some((x) => Number(x.minutes) > 0)) return items.map((x) => [x, Number(x.minutes) || 0]);
  const sets = items.reduce((t, x) => t + (Number(x.sets) || 0), 0), m = Number(entry.minutes) || 0;
  if (!items.length || !sets) return [[{ title: "General", cat: "OTHER" }, m]];
  return items.map((x) => [x, (m * (Number(x.sets) || 0)) / sets]);
}
const weekSummary = (log, plan) => { const wk = log.filter((e) => Date.parse(e.at) >= since(7));
  return { sessions: wk.length, minutes: wk.reduce((t, e) => t + (Number(e.minutes) || 0), 0), done: plan.filter((g) => setsDone(g) >= setsTarget(g)).length, goals: plan.length, last: log[0]?.at || null }; };

export async function render(main, { flash = () => {}, previewClient = null } = {}) {
  const state = getState(), team = effectiveTeam(state);
  const canCoach = () => !!state.isAdmin || !!window.__taCoach;
  const wrap = el("div", { class: "ps" });
  mount(main, wrap);
  // whose practice: a player looked at (a coach's or the admin's pick), or your own
  const self = { owner: planOwner(state), key: state.profile?.clientKey || null, label: state.profile?.name || "Me", mine: true };
  let subject = previewClient?.key && !previewClient.self ? { owner: previewClient.key, key: previewClient.key, label: previewClient.label || "Player", mine: false } : self;
  const coachPlayers = !previewClient && (state.isTeam || state.isAdmin) ? (state.isAdmin && !team.preview ? null : [...teamLabels(team.teamAccess || {})].map(([k, l]) => [k, plainName(l)])) : [];
  let plan = [], log = [], alive = true;
  window.addEventListener("hashchange", () => { alive = false; }, { once: true });

  async function load() { [plan, log] = await Promise.all([listPlan(subject.owner), listLog(subject.owner)]); }
  const editable = () => subject.mine; // (logging and ticking off: the player themselves, honour system)
  const goalAdder = () => subject.mine || canCoach();

  /* ---------------- coach view ---------------- */
  async function coachBox() {
    if (coachPlayers === null) { // the admin: pick any player
      const { adminAllClients } = await import("../store.js");
      const all = [...(await adminAllClients().catch(() => ({ labels: new Map() }))).labels].map(([k, l]) => [k, plainName(l)]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      const q = el("input", { type: "search", class: "ps-q", placeholder: "Find a player to see their practice…", "aria-label": "Find a player" }), list = el("div", { class: "ps-picks" });
      const draw = () => { const t = q.value.trim().toLowerCase(); mount(list, t ? all.filter(([, l]) => String(l).toLowerCase().includes(t)).slice(0, 12).map(([k, l]) => { const b = el("button", { type: "button", class: "chip" }, l); b.addEventListener("click", () => open({ owner: k, key: k, label: l, mine: false })); return b; }) : null); };
      q.addEventListener("input", draw);
      return el("section", { class: "ps-card" }, [el("p", { class: "ps-t" }, "PLAYERS’ PRACTICE"), q, list]);
    }
    if (!coachPlayers.length) return null;
    const tb = el("tbody", {}, coachPlayers.map(([k, l]) => el("tr", { "data-k": k }, [el("td", {}, l), el("td", { colspan: 4, class: "muted small" }, "Loading…")])));
    const box = el("section", { class: "ps-card" }, [el("p", { class: "ps-t" }, "YOUR PLAYERS · LAST 7 DAYS"),
      el("div", { class: "ps-tw" }, el("table", { class: "ps-coach" }, [el("thead", {}, el("tr", {}, ["Player", "Last practised", "Sessions", "Time", "Goals"].map((h, i) => el("th", { class: i > 1 ? "n" : "" }, h)))), tb]))]);
    (async () => { for (const [k, l] of coachPlayers) { if (!alive) return;
      const [p, g] = await Promise.all([listPlan(k).catch(() => []), listLog(k).catch(() => [])]), s = weekSummary(g, p);
      const age = s.last ? (Date.now() - Date.parse(s.last)) / dayMs : 99, dot = age <= 3 ? "#30d158" : age <= 7 ? "#f5c400" : "#d0342c";
      const tr = tb.querySelector(`tr[data-k="${CSS.escape(k)}"]`); if (!tr) continue;
      tr.classList.add("ps-tap"); tr.tabIndex = 0; tr.addEventListener("click", () => open({ owner: k, key: k, label: l, mine: false }));
      mount(tr, [el("td", {}, [el("i", { class: "ps-dot", style: `background:${dot}` }), l]), el("td", {}, ago(s.last)), el("td", { class: "n" }, String(s.sessions)), el("td", { class: "n" }, fmtMin(s.minutes)), el("td", { class: "n" }, s.goals ? `${s.done}/${s.goals} done` : "—")]); } })();
    return box;
  }

  /* ---------------- a goal ---------------- */
  function goalCard(g) {
    const [cls, txt] = statusOf(g), t = targetOf(g), pct = Math.min(100, (100 * setsDone(g)) / setsTarget(g));
    const card = el("div", { class: "ps-goal" }, [
      el("div", { class: "ps-row" }, [el("strong", {}, g.title || "Practice"), el("span", { class: `ps-pill ${cls}` }, txt)]),
      el("p", { class: "ps-goaltxt" }, [areaOf(g.cat), t ? ` · ${t}` : "", g.sentBy?.name ? ` · from ${g.sentBy.name}` : ""]),
      el("div", { class: "ps-bar" }, el("i", { style: `width:${pct}%;${cls === "done" ? "background:#30d158" : ""}` })),
    ]);
    const btns = el("div", { class: "ps-btns" });
    if (editable() && cls !== "done") { const b = el("button", { type: "button", class: "btn" }, "✓ Log a set"); b.addEventListener("click", () => quickSet(g)); btns.appendChild(b); }
    if (editable() && cls === "done") { const b = el("button", { type: "button", class: "btn ghost" }, "Do again"); b.addEventListener("click", async () => { g.setsDone = 0; await savePlanItem(subject.owner, g); draw(); }); btns.appendChild(b); }
    if (editable() || canCoach()) { const b = el("button", { type: "button", class: "btn ghost" }, "Edit"); b.addEventListener("click", () => goalSheet(g)); btns.appendChild(b); }
    if (btns.children.length) card.appendChild(btns);
    return card;
  }
  async function quickSet(g) { // one set, ticked off (a session of its own, no time)
    g.setsDone = setsDone(g) + 1; await savePlanItem(subject.owner, g);
    await saveLog(subject.owner, { id: newPlanId(), at: new Date().toISOString(), minutes: 0, mode: "set", items: [{ id: g.id, title: g.title, cat: g.cat || "OTHER", sets: 1 }] });
    flash(setsDone(g) >= setsTarget(g) ? `${g.title}: done!` : `${g.title}: ${setsDone(g)} of ${setsTarget(g)} sets.`, "ok");
    await load(); draw();
  }

  /* ---------------- add / edit a goal ---------------- */
  function goalSheet(g0 = null) {
    const g = g0 ? { ...g0 } : { id: newPlanId(), title: "", cat: "PUTT", target: "", setsTarget: 3, setsDone: 0 };
    const title = el("input", { type: "text", class: "ps-in", placeholder: "e.g. Putts inside 5 ft", value: g.title || "" });
    const target = el("input", { type: "text", class: "ps-in", placeholder: "e.g. Hole 10 of 10", value: targetOf(g) });
    let cat = g.cat || "OTHER", n = setsTarget(g);
    const cats = el("div", { class: "ps-chips" }), num = el("b", {}, String(n));
    const drawCats = () => mount(cats, AREAS.map(([k, l]) => { const b = el("button", { type: "button", class: `chip${cat === k ? " on" : ""}` }, l); b.addEventListener("click", () => { cat = k; drawCats(); }); return b; }));
    drawCats();
    const step = (d) => { n = Math.max(1, Math.min(50, n + d)); num.textContent = String(n); };
    const minus = el("button", { type: "button", class: "ps-sb" }, "−"), plus = el("button", { type: "button", class: "ps-sb" }, "+");
    minus.addEventListener("click", () => step(-1)); plus.addEventListener("click", () => step(1));
    const save = el("button", { type: "button", class: "btn" }, g0 ? "Save" : "Add goal"), cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    const del = g0 ? el("button", { type: "button", class: "link danger" }, "Remove this goal") : null;
    const sheet = modal(g0 ? "Edit goal" : "Add a goal", [
      el("label", { class: "ps-lab" }, ["What", title]), el("p", { class: "ps-lab" }, "Area"), cats,
      el("label", { class: "ps-lab" }, ["Target (optional)", target]),
      el("p", { class: "ps-lab" }, "Sets"), el("div", { class: "ps-stp" }, [minus, num, plus]),
      el("div", { class: "ps-btns" }, [save, cancel]), del]);
    cancel.addEventListener("click", sheet.close);
    del?.addEventListener("click", async () => { if (!confirm(`Remove “${g.title}”?`)) return; await deletePlanItem(subject.owner, g.id); sheet.close(); await load(); draw(); });
    save.addEventListener("click", async () => {
      if (!title.value.trim()) { title.focus(); return; }
      Object.assign(g, { title: title.value.trim(), cat, target: target.value.trim(), setsTarget: n, setsDone: Math.min(setsDone(g), 999), updatedAt: new Date().toISOString(), addedAt: g.addedAt || new Date().toISOString(), playerKey: g.playerKey ?? subject.key ?? "" });
      if (!subject.mine && !g0) g.sentBy = { uid: state.user?.uid || null, name: state.profile?.name || (state.isAdmin ? "Callaway" : "Coach") };
      save.disabled = true;
      try { await savePlanItem(subject.owner, g); sheet.close(); flash(g0 ? "Goal saved." : subject.mine ? "Goal added." : `Goal added to ${subject.label}’s practice.`, "ok"); await load(); draw(); }
      catch (err) { console.error(err); save.disabled = false; flash(err?.code === "permission-denied" ? "Not allowed: ask the admin to tick COACHING for you on User Access." : "Couldn’t save that goal.", "error"); }
    });
    setTimeout(() => title.focus(), 50);
  }

  /* ---------------- log a session ---------------- */
  function logSheet() {
    const open = plan.filter((g) => setsDone(g) < setsTarget(g));
    const sets = new Map(open.map((g) => [g.id, 0])), mins = new Map();
    let mode = "session", total = 45, place = null, t0 = null, tick = null, elapsed = 0;
    const body = el("div", {});
    const drawBody = () => {
      clearInterval(tick); tick = null;
      const rows = open.map((g) => {
        const num = el("b", {}, String(sets.get(g.id)));
        const m = el("button", { type: "button", class: "ps-sb" }, "−"), p = el("button", { type: "button", class: "ps-sb" }, "+");
        m.addEventListener("click", () => { sets.set(g.id, Math.max(0, sets.get(g.id) - 1)); num.textContent = String(sets.get(g.id)); });
        p.addEventListener("click", () => { sets.set(g.id, sets.get(g.id) + 1); num.textContent = String(sets.get(g.id)); });
        const mi = mode === "goal" ? el("input", { type: "number", min: 0, inputmode: "numeric", class: "ps-min", placeholder: "min", value: mins.get(g.id) ?? "" }) : null;
        mi?.addEventListener("input", () => mins.set(g.id, Number(mi.value) || 0));
        return el("div", { class: "ps-lrow" }, [el("span", {}, [g.title, el("small", {}, ` ${setsDone(g)}/${setsTarget(g)}`)]), el("span", { class: "ps-stp" }, [m, num, p, mi])]);
      });
      const modes = el("div", { class: "ps-seg" }, [["session", "Whole session"], ["goal", "Per goal"], ["timer", "Timer"]].map(([k, l]) => { const b = el("button", { type: "button", class: mode === k ? "on" : "" }, l); b.addEventListener("click", () => { mode = k; drawBody(); }); return b; }));
      let timeBox = null;
      if (mode === "session") {
        const custom = el("input", { type: "number", min: 1, inputmode: "numeric", class: "ps-min", placeholder: "min", value: [15, 30, 45, 60, 90].includes(total) ? "" : total });
        custom.addEventListener("input", () => { total = Number(custom.value) || 0; drawChips(); });
        const chips = el("div", { class: "ps-chips" });
        const drawChips = () => mount(chips, [...[15, 30, 45, 60, 90].map((v) => { const b = el("button", { type: "button", class: `chip${total === v ? " on" : ""}` }, fmtMin(v)); b.addEventListener("click", () => { total = v; custom.value = ""; drawChips(); }); return b; }), custom]);
        drawChips(); timeBox = chips;
      } else if (mode === "timer") {
        const clock = el("b", { class: "ps-clock" }, fmtClock()), go = el("button", { type: "button", class: "btn" }, t0 ? "Stop" : elapsed ? "Resume" : "Start");
        go.addEventListener("click", () => { if (t0) { elapsed += Date.now() - t0; t0 = null; } else t0 = Date.now(); drawBody(); });
        if (t0) tick = setInterval(() => { clock.textContent = fmtClock(); }, 1000);
        timeBox = el("div", { class: "ps-row" }, [clock, go]);
      } else timeBox = el("p", { class: "muted small" }, "Put the minutes beside each goal.");
      const places = el("div", { class: "ps-chips" }, ["Range", "Short game area", "Putting green", "On course", "At home"].map((v) => { const b = el("button", { type: "button", class: `chip${place === v ? " on" : ""}` }, v); b.addEventListener("click", () => { place = place === v ? null : v; drawBody(); }); return b; }));
      mount(body, [open.length ? el("div", { class: "ps-lrows" }, rows) : el("p", { class: "muted small" }, "No goals in progress: this session counts as general practice."),
        el("p", { class: "ps-lab" }, "How long?"), modes, timeBox, el("p", { class: "ps-lab" }, "Where? (optional)"), places]);
    };
    const fmtClock = () => { const s = Math.floor((elapsed + (t0 ? Date.now() - t0 : 0)) / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
    drawBody();
    const save = el("button", { type: "button", class: "btn" }, "Save session"), cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    const sheet = modal("Log practice", [body, el("div", { class: "ps-btns" }, [save, cancel])], () => clearInterval(tick));
    cancel.addEventListener("click", sheet.close);
    save.addEventListener("click", async () => {
      const items = open.filter((g) => sets.get(g.id) > 0 || (mode === "goal" && mins.get(g.id) > 0)).map((g) => ({ id: g.id, title: g.title, cat: g.cat || "OTHER", sets: sets.get(g.id) || 0, ...(mode === "goal" ? { minutes: mins.get(g.id) || 0 } : {}) }));
      const minutes = mode === "goal" ? items.reduce((t, x) => t + (x.minutes || 0), 0) : mode === "timer" ? Math.round((elapsed + (t0 ? Date.now() - t0 : 0)) / 60000) : total;
      if (!items.length && !minutes) { flash("Add some sets or a time first.", "error"); return; }
      save.disabled = true;
      try {
        await saveLog(subject.owner, { id: newPlanId(), at: new Date().toISOString(), minutes, mode, place, items });
        for (const x of items) { const g = plan.find((q) => q.id === x.id); if (g && x.sets) { g.setsDone = setsDone(g) + x.sets; await savePlanItem(subject.owner, g); } }
        sheet.close(); flash(`Session saved: ${fmtMin(minutes)}${items.length ? `, ${items.reduce((t, x) => t + x.sets, 0)} sets` : ""}.`, "ok"); await load(); draw();
      } catch (err) { console.error(err); save.disabled = false; flash("Couldn’t save the session.", "error"); }
    });
  }

  function modal(title, kids, onClose = null) {
    const back = el("div", { class: "ps-modal-back" }), box = el("section", { class: "ps-modal", role: "dialog", "aria-modal": "true", "aria-label": title }, [el("h2", {}, title), ...kids.filter(Boolean)]);
    const w = el("div", { class: "ps-modal-wrap" }, [back, box]);
    const close = () => { w.remove(); onClose?.(); };
    back.addEventListener("click", close);
    document.body.appendChild(w);
    return { close };
  }

  /* ---------------- the page ---------------- */
  async function open(sub) { subject = sub; mount(wrap, el("p", { class: "muted" }, "Loading practice…")); await load(); draw(); window.scrollTo(0, 0); }
  let coachEl = null;
  function draw() {
    const s = weekSummary(log, plan);
    // where the time went, last 30 days
    const byArea = new Map();
    for (const e of log.filter((x) => Date.parse(x.at) >= since(30))) for (const [x, m] of minutesByItem(e)) byArea.set(areaOf(x.cat), (byArea.get(areaOf(x.cat)) || 0) + m);
    const byGoal = new Map();
    for (const e of log.filter((x) => Date.parse(x.at) >= since(30))) for (const x of e.items || []) byGoal.set(x.title, (byGoal.get(x.title) || 0) + (Number(x.sets) || 0));
    const maxA = Math.max(1, ...byArea.values()), order = [...byArea].sort((a, b) => b[1] - a[1]);
    const goals = [...plan].sort((a, b) => (setsDone(a) >= setsTarget(a)) - (setsDone(b) >= setsTarget(b)) || String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
    const back = !subject.mine && subject !== self && (coachPlayers?.length || coachPlayers === null) ? (() => { const b = el("button", { type: "button", class: "link" }, "‹ My practice"); b.addEventListener("click", () => open(self)); return b; })() : null;
    const logBtn = editable() ? (() => { const b = el("button", { type: "button", class: "btn ps-log" }, "＋ Log practice"); b.addEventListener("click", logSheet); return b; })() : null;
    const addBtn = goalAdder() ? (() => { const b = el("button", { type: "button", class: "ps-add" }, subject.mine ? "＋ Add a goal" : `＋ Add a goal for ${subject.label}`); b.addEventListener("click", () => goalSheet()); return b; })() : null;
    mount(wrap, [
      back,
      subject.mine ? coachEl : null, // (coaches and the admin: their players first)
      el("header", { class: "ps-head" }, [el("h1", {}, subject.mine ? "My Practice" : `${subject.label}’s Practice`),
        el("p", { class: "muted" }, subject.mine ? "Set a goal, tick off sets as you do them, log how long you practised. Honour system." : "What they’ve logged. Honour system.")]),
      el("div", { class: "ps-tiles" }, [
        el("div", { class: "ps-tile" }, [el("b", {}, String(s.sessions)), el("span", {}, `session${s.sessions === 1 ? "" : "s"} this week`)]),
        el("div", { class: "ps-tile" }, [el("b", {}, fmtMin(s.minutes)), el("span", {}, "practised this week")]),
        el("div", { class: "ps-tile" }, [el("b", {}, `${s.done} of ${s.goals}`), el("span", {}, "goals done")]),
      ]),
      logBtn,
      el("p", { class: "ps-t" }, subject.mine ? "YOUR GOALS" : "GOALS"),
      ...(goals.length ? goals.map(goalCard) : [el("p", { class: "muted small" }, subject.mine ? "No goals yet. Add one here, or from Stats (Focus: Add to practice)." : "No goals yet.")]),
      addBtn,
      order.length ? el("p", { class: "ps-t" }, "WHERE THE TIME WENT · LAST 30 DAYS") : null,
      ...order.map(([a, m]) => el("div", { class: "ps-hb" }, [el("span", {}, a), el("i", { style: `width:${Math.max(4, (m / maxA) * 100)}%` }), el("em", {}, fmtMin(m))])),
      byGoal.size ? el("p", { class: "ps-t" }, "MOST WORKED ON · LAST 30 DAYS") : null,
      byGoal.size ? el("p", { class: "muted small" }, [...byGoal].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${t} (${n} set${n === 1 ? "" : "s"})`).join(" · ")) : null,
      el("p", { class: "ps-t" }, "RECENT SESSIONS"),
      log.length ? el("div", { class: "ps-tw" }, el("table", { class: "ps-log-t" }, el("tbody", {}, log.slice(0, 15).map((e) => el("tr", {}, [el("td", {}, whenTxt(e.at)), el("td", {}, fmtMin(e.minutes)),
        el("td", {}, [(e.items || []).map((x) => `${x.title} ×${x.sets}`).join(", ") || "General practice", e.place ? el("small", { class: "muted" }, ` · ${e.place}`) : null]),
        el("td", { class: "n" }, editable() ? (() => { const x = el("button", { type: "button", class: "link small", "aria-label": "Delete this session" }, "✕"); x.addEventListener("click", async () => { if (!confirm("Delete this session?")) return;
          for (const it of e.items || []) { const g = plan.find((q) => q.id === it.id); if (g && it.sets) { g.setsDone = Math.max(0, setsDone(g) - it.sets); await savePlanItem(subject.owner, g); } }
          await deleteLog(subject.owner, e.id); await load(); draw(); }); return x; })() : null)]))))) : el("p", { class: "muted small" }, "Nothing logged yet."),
    ]);
  }
  await load();
  coachEl = await coachBox().catch((err) => { console.error(err); return null; });
  draw();
}
