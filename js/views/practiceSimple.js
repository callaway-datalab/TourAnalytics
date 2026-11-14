// (update 690) Practice, made simple. (update 691) Built around practice sessions:
//   Create Practice Session: tick the distance ranges to work on; for each, a number of shots and sets, or a time.
//   The page: In progress, Not yet started, Completed. Open one: tick the ranges for now, Start Practice (a timer starts),
//   then "Set N complete" (the set you're on) or "All sets complete". Honour system, no shot-by-shot detail.
// Coaches see their players' practice; a coach with COACHING (Allow coaching, on User Access) can create sessions for them.
//
//   practice/{owner}/plan/{id}  { type: "session", title, createdAt, createdBy, items: [{ key, cat, label, mode: "sets" | "time",
//                                 shots, sets, minutes, setsDone, secs, done }], run: { at, keys } | null, secs }
//                               (the plan collection: a coach with Allow coaching may write there; Stats' "Add to practice"
//                               drills live there too and are offered when creating a session)
//   practice/{owner}/log/{id}   each bit of practice done: { at, minutes, items: [{ key, title, cat, sets }] } (time and the coach view)
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { listPlan, savePlanItem, deletePlanItem, newPlanId, planOwner, goalText, goalSource, removeFromPlan } from "../practice/plan.js";
import { playerPicker } from "../playerPicker.js";

const fsP = () => Promise.all([import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js"), import("../firebase-init.js")]).then(([f, i]) => ({ ...f, db: i.db }));
async function listLog(owner) {
  if (!owner) return [];
  try { const { getDocs, collection, db } = await fsP(); const s = await getDocs(collection(db, "practice", owner, "log")); return s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
  catch (err) { console.error(err); return []; }
}
async function deleteLog(owner, id) { const { deleteDoc, doc, db } = await fsP(); return deleteDoc(doc(db, "practice", owner, "log", id)); }
async function saveLog(owner, entry) { const { setDoc, doc, db } = await fsP(); const { id, ...rest } = entry; return setDoc(doc(db, "practice", owner, "log", id), JSON.parse(JSON.stringify(rest))); }

// the distance ranges used across the site (Additional Stats): each part of the game
const RANGES = [
  ["OTT", "Off the tee", ["Driver", "Non-Driver"]],
  ["APP", "Approach", ["50-75 yds", "75-100 yds", "100-120 yds", "120-140 yds", "140-160 yds", "160-180 yds", "180-200 yds", "200-220 yds", ">220 yds"]], // (update 693: 20-yard buckets, as in the data)
  ["ARG", "Short game", ["<30 yds", "30-50 yds", "Bunker"]],
  ["PUTT", "Putting", ["<5 ft", "5-10 ft", "10-15 ft", "15-20 ft", "20-25 ft", ">25 ft"]],
];
const AREA = { OTT: "Off the tee", APP: "Approach", ARG: "Short game", PUTT: "Putting", OTHER: "Other" };
const fmtMin = (m) => { m = Math.round(Number(m) || 0); if (!m) return "0m"; const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`; };
const fmtClock = (secs) => { const s = Math.max(0, Math.floor(secs)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const dayMs = 864e5, since = (days) => Date.now() - days * dayMs;
const ago = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return "Never"; const d = Math.floor((Date.now() - t) / dayMs); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`; };
const dateTxt = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ""; };

const itemDone = (it) => !!it.done || (it.mode !== "time" && (it.setsDone || 0) >= (it.sets || 1)) || (it.mode === "time" && (it.secs || 0) >= (it.minutes || 0) * 60 && (it.minutes || 0) > 0);
const itemStarted = (it) => (it.setsDone || 0) > 0 || (it.secs || 0) > 0 || !!it.done;
const stateOf = (s) => (s.items?.length && s.items.every(itemDone) ? "done" : s.run || s.items?.some(itemStarted) ? "prog" : "todo");
const itemPlan = (it) => `${it.mode === "time" ? fmtMin(it.minutes) : `${it.shots} shots × ${it.sets} set${it.sets === 1 ? "" : "s"}`}${it.club && !it.byClub ? ` · ${it.club}` : ""}`; // (update 693: with its club)
const itemProgress = (it) => (it.mode === "time" ? `${fmtMin((it.secs || 0) / 60)} of ${fmtMin(it.minutes)}` : `${Math.min(it.setsDone || 0, it.sets)}/${it.sets} sets`);
const sessTitle = (s) => s.title || [...new Set((s.items || []).map((x) => AREA[x.cat] || "Practice"))].join(" + ") || "Practice";
const runSecs = (s) => (s.run?.at ? (Date.now() - Date.parse(s.run.at)) / 1000 : 0);
// (update 699) each range's target for a set ("Hit 7 of 10 fairways", "Average inside 8 ft"): from Stats, the drill's own
// goal (and where it came from: the average proximity to beat …); made here, picked when the session is made
const TARGET_KIND = (cat, label, club) => {
  const c = String(club || ""), l = String(label || "");
  if (cat === "OTT" || /^driver$/i.test(c)) return "fairway";
  if (cat === "PUTT" || /putter/i.test(c)) return /(>|\+)\s*25|>25/.test(l) ? "lag" : "make";
  if (cat === "ARG" || /wedge/i.test(c)) return "prox";
  return "green";
};
const TARGET_DEF = (kind, label) => { if (kind === "fairway") return 7; if (kind === "green") return 6; if (kind === "lag") return 7;
  if (kind === "prox") return /bunker/i.test(label) ? 10 : /30-50/.test(label) ? 12 : 8;
  const ft = Number((String(label).match(/\d+/g) || [])[0] || 5); return /</.test(label) ? 9 : ft < 10 ? 5 : ft < 15 ? 3 : ft < 20 ? 2 : 1; };
const targetText = (t) => (t ? goalText({ kind: t.kind, goal: t.goal, reps: t.reps, unit: t.unit, higher: t.higher, cat: t.cat }) : "");
const itemTarget = (it, drills = []) => { if (it.target) return it.target; const d = String(it.key || "").startsWith("d:") ? drills.find((x) => `d:${x.id}` === it.key) : null;
  return d && d.goal != null ? { kind: d.kind, goal: d.goal, reps: d.reps, unit: d.unit, higher: !!d.higher, cat: d.cat, src: goalSource(d) || "" } : null; };

export async function render(main, { flash = () => {}, previewClient = null } = {}) {
  const state = getState(), team = effectiveTeam(state);
  const canCoach = () => !!state.isAdmin || !!window.__taCoach;
  const wrap = el("div", { class: "ps" });
  mount(main, wrap);
  const self = { owner: planOwner(state), key: state.profile?.clientKey || null, label: state.profile?.name || "Me", mine: true };
  let subject = previewClient?.key && !previewClient.self ? { owner: previewClient.key, key: previewClient.key, label: previewClient.label || "Player", mine: false } : self;
  const coachPlayers = !previewClient && (state.isTeam || state.isAdmin) ? (state.isAdmin && !team.preview ? null : [...teamLabels(team.teamAccess || {})].map(([k, l]) => [k, plainName(l)])) : [];
  let sessions = [], drills = [], log = [], alive = true, openId = null, tick = null, tab = /[?&]tab=lm\b/.test(location.hash) ? "lm" : "sessions"; // (update 700: Launch Monitor)
  window.addEventListener("hashchange", () => { alive = false; clearInterval(tick); }, { once: true });
  async function load() {
    const [p, l] = await Promise.all([listPlan(subject.owner), listLog(subject.owner)]);
    sessions = p.filter((x) => x.type === "session"); drills = p.filter((x) => x.type !== "session"); log = l;
    // (update 692) a drill added from Stats is a practice of its own (Not yet started): made once, the drill marked with it
    if (subject.mine || canCoach()) {
      for (const d of drills.filter((x) => !x.sessionId)) {
        const sid = newPlanId(), by = d.sentBy?.name ? { uid: d.sentBy.uid || null, name: d.sentBy.name } : { self: true, name: "you" };
        const sess = { id: sid, type: "session", title: d.title || "Practice", createdAt: d.addedAt || new Date().toISOString(), playerKey: d.playerKey || subject.key || "", fromStats: true, createdBy: by,
          items: [{ key: `d:${d.id}`, cat: d.cat || "OTHER", label: d.title || "Drill", mode: "sets", shots: Number(d.reps) || 10, sets: Number(d.setsAim) || 3, setsDone: 0, secs: 0, done: false,
            ...(d.goal != null ? { target: { kind: d.kind, goal: d.goal, reps: Number(d.reps) || 10, unit: d.unit || null, higher: !!d.higher, cat: d.cat, src: goalSource(d) || "" } } : {}) }], run: null };
        try { await savePlanItem(subject.owner, sess); await savePlanItem(subject.owner, { ...d, sessionId: sid }); sessions.push(sess); d.sessionId = sid; } catch (err) { console.error(err); }
      }
    }
  }
  const save = (s) => savePlanItem(subject.owner, s);
  const creator = () => subject.mine || canCoach();

  /* ---------------- coach view ---------------- */
  const summary = (lg, ss) => { const wk = lg.filter((e) => Date.parse(e.at) >= since(7));
    return { days: new Set(wk.map((e) => String(e.at).slice(0, 10))).size, minutes: wk.reduce((t, e) => t + (Number(e.minutes) || 0), 0), done: ss.filter((s) => stateOf(s) === "done").length, total: ss.length, last: lg[0]?.at || null }; };
  async function coachBox() {
    if (coachPlayers === null) { // the admin: find any player (no box round it)
      const { adminAllClients } = await import("../store.js");
      const all = [...(await adminAllClients().catch(() => ({ labels: new Map() }))).labels].map(([k, l]) => [k, plainName(l)]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      // (update 699) the site's own player search (a drop-down as you type, as on every other page)
      const pp = playerPicker(new Map(all), (p) => { if (p) open({ owner: p.key, key: p.key, label: p.label, mine: false }); else if (!subject.mine) open(self); }, new Map(), null, { autoPick: false });
      if (!subject.mine && subject.key) pp.preset?.(subject.key);
      return el("section", { class: "ps-find" }, [el("p", { class: "ps-t" }, "PLAYERS’ PRACTICE"), el("div", { class: "analyze-picker" }, pp.node)]);
    }
    if (!coachPlayers.length) return null;
    const tb = el("tbody", {}, coachPlayers.map(([k, l]) => el("tr", { "data-k": k }, [el("td", {}, l), el("td", { colspan: 4, class: "muted small" }, "Loading…")])));
    const box = el("section", { class: "ps-card" }, [el("p", { class: "ps-t" }, "YOUR PLAYERS · LAST 7 DAYS"),
      el("div", { class: "ps-tw" }, el("table", { class: "ps-coach" }, [el("thead", {}, el("tr", {}, ["Player", "Last practiced", "Days", "Time", "Sessions done"].map((h, i) => el("th", { class: i > 1 ? "n" : "" }, h)))), tb]))]);
    (async () => { for (const [k, l] of coachPlayers) { if (!alive) return;
      const [p, g] = await Promise.all([listPlan(k).catch(() => []), listLog(k).catch(() => [])]), s = summary(g, p.filter((x) => x.type === "session"));
      const age = s.last ? (Date.now() - Date.parse(s.last)) / dayMs : 99, dot = age <= 3 ? "#30d158" : age <= 7 ? "#f5c400" : "#d0342c";
      const tr = tb.querySelector(`tr[data-k="${CSS.escape(k)}"]`); if (!tr) continue;
      tr.classList.add("ps-tap"); tr.tabIndex = 0; tr.addEventListener("click", () => open({ owner: k, key: k, label: l, mine: false }));
      mount(tr, [el("td", {}, [el("i", { class: "ps-dot", style: `background:${dot}` }), l]), el("td", {}, ago(s.last)), el("td", { class: "n" }, String(s.days)), el("td", { class: "n" }, fmtMin(s.minutes)), el("td", { class: "n" }, s.total ? `${s.done}/${s.total}` : "—")]); } })();
    return box;
  }

  /* ---------------- create a session ---------------- */
  // (update 693) by distance range (each with an optional club from your bag) or by club (from WITB); each pick starts
  // at 10 shots x 3 sets and can be changed on its row (no defaults row on top)
  const CLUB_AREA = { Driver: "OTT", "Fairway Wood": "APP", Hybrid: "APP", Iron: "APP", Wedge: "ARG", Putter: "PUTT" };
  let bagP = null;
  const myBag = () => (bagP ||= (subject.mine && state.user?.uid ? import("../bag.js").then((b) => b.getBag(state.user.uid).then((cs) => cs.map((c) => ({ id: c.id || `${c.cat}|${c.type}`, label: b.clubLabel(c), cat: c.cat, make: b.clubMake(c) })).filter((c) => c.label).sort((x, y) => b.clubRank(x.label) - b.clubRank(y.label)))).catch(() => []) : Promise.resolve([])));
  function createSheet() {
    const picked = new Map(); // key → { key, cat, label, mode, shots, sets, minutes, club? }
    let by = "range", bag = [];
    const list = el("div", { class: "ps-create" });
    const num = (v, on, w = 56) => { const i = el("input", { type: "number", min: 1, inputmode: "numeric", class: "ps-num", style: `width:${w}px`, value: v }); i.addEventListener("input", () => on(Math.max(1, Number(i.value) || 1))); return i; };
    const clubPick = (it) => {
      if (!bag.length) return null;
      const sel = el("select", { class: "ps-club", "aria-label": "Club" }, [el("option", { value: "" }, "Club (optional)"), ...bag.map((c) => el("option", { value: c.label, selected: it.club === c.label }, c.make ? `${c.label} · ${c.make}` : c.label))]);
      sel.addEventListener("change", () => { it.club = sel.value || undefined; });
      return sel;
    };
    const rowFor = (key, cat, label, extra = {}) => {
      const box = el("input", { type: "checkbox", checked: picked.has(key) });
      box.addEventListener("change", () => { if (box.checked) { const kind = TARGET_KIND(cat, label, extra.club); picked.set(key, { key, cat, label, mode: "sets", shots: 10, sets: 3, minutes: 15, ...extra, target: { kind, goal: TARGET_DEF(kind, label), reps: 10, cat, unit: kind === "prox" ? "ft" : null } }); } else picked.delete(key); drawList(); });
      const it = picked.get(key);
      const ctl = it ? el("span", { class: "ps-ctl" }, [
        el("span", { class: "ps-seg sm" }, [["sets", "Shots × sets"], ["time", "Time"]].map(([m, l]) => { const b = el("button", { type: "button", class: it.mode === m ? "on" : "" }, l); b.addEventListener("click", () => { it.mode = m; drawList(); }); return b; })),
        it.mode === "time" ? el("span", { class: "ps-ctl-in" }, [num(it.minutes, (v) => { it.minutes = v; }), " min"]) : el("span", { class: "ps-ctl-in" }, [num(it.shots, (v) => { it.shots = v; if (it.target) { it.target.reps = v; if (it.target.kind !== "prox") it.target.goal = Math.min(it.target.goal, v); } }), " shots × ", num(it.sets, (v) => { it.sets = v; }, 48), " sets"]),
        targetCtl(it),
        by === "range" ? clubPick(it) : null,
      ]) : null;
      return el("div", { class: `ps-crow${it ? " on" : ""}` }, [el("label", {}, [box, el("span", {}, label)]), ctl]);
    };
    // (update 699) the target for a set: "Hit [7] of 10 fairways", "Average inside [8] ft" (empty: no target)
    const targetCtl = (it) => {
      const t = it.target; if (!t) return null;
      const reps = it.mode === "time" ? 10 : it.shots;
      const inp = el("input", { type: "number", min: t.kind === "prox" ? 0.5 : 0, step: t.kind === "prox" ? 0.5 : 1, inputmode: "decimal", class: "ps-num", style: "width:52px", value: t.goal ?? "", "aria-label": "Target" });
      inp.addEventListener("input", () => { const v = Number(inp.value); t.goal = inp.value.trim() === "" || !Number.isFinite(v) ? null : t.kind === "prox" ? v : Math.max(0, Math.min(reps, Math.round(v))); });
      const words = { fairway: ["Target: hit", `of ${reps} fairways`], green: ["Target: hit", `of ${reps} greens`], make: ["Target: hole", `of ${reps}`], lag: ["Target: leave", `of ${reps} inside 3 ft`], prox: ["Target: average inside", "ft"] }[t.kind] || ["Target:", ""];
      t.reps = reps;
      return el("span", { class: "ps-ctl-in ps-target" }, [`${words[0]} `, inp, ` ${words[1]}`]);
    };
    const toggle = el("div", { class: "ps-seg" }, [["range", "Distance range"], ["club", "Club"]].map(([k, l]) => { const b = el("button", { type: "button", class: by === k ? "on" : "" }, l); b.addEventListener("click", () => { if (by === k) return; by = k; picked.clear(); [...toggle.children].forEach((x) => x.classList.toggle("on", x === b)); drawList(); }); return b; }));
    const drawList = () => mount(list, by === "range"
      ? RANGES.flatMap(([cat, name, bands]) => [el("p", { class: "ps-t" }, name.toUpperCase()), ...bands.map((b) => rowFor(`${cat}|${b}`, cat, `${name} · ${b}`))])
      : bag.length ? [el("p", { class: "ps-t" }, "YOUR CLUBS (WITB)"), ...bag.map((c) => rowFor(`club|${c.label}`, CLUB_AREA[c.cat] || "OTHER", c.make ? `${c.label} · ${c.make}` : c.label, { club: c.label, byClub: true }))]
      : [el("p", { class: "muted small" }, subject.mine ? "No clubs in your WITB yet. Add them under WITB (the bag icon at the top), or pick distance ranges instead." : "Clubs come from the player’s own WITB: pick distance ranges for them instead.")]);
    drawList();
    myBag().then((b) => { bag = b; drawList(); });
    const name = el("input", { type: "text", class: "ps-in", placeholder: "Name (optional), e.g. Tuesday short game" });
    const ok = el("button", { type: "button", class: "btn" }, "Create session"), cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    const sheet = modal(subject.mine ? "Create Practice Session" : `Create a session for ${subject.label}`, [name, toggle, list, el("div", { class: "ps-btns ps-sticky" }, [ok, cancel])]);
    cancel.addEventListener("click", sheet.close);
    ok.addEventListener("click", async () => {
      if (!picked.size) { flash(by === "club" ? "Tick at least one club." : "Tick at least one distance range.", "error"); return; }
      const s = { id: newPlanId(), type: "session", title: name.value.trim(), createdAt: new Date().toISOString(), playerKey: subject.key || "",
        createdBy: subject.mine ? { self: true, name: "you" } : { uid: state.user?.uid || null, name: state.profile?.name || (state.isAdmin ? "Callaway" : "Coach") },
        items: [...picked.values()].map((x) => { const y = { ...x, setsDone: 0, secs: 0, done: false }; if (!y.target || y.target.goal == null) delete y.target; return y; }), run: null };
      ok.disabled = true;
      try { await save(s); sheet.close(); flash("Session created.", "ok"); await load(); openId = s.id; draw(); }
      catch (err) { console.error(err); ok.disabled = false; flash(err?.code === "permission-denied" ? "Not allowed: ask the admin to tick COACHING for you on User Access." : "Couldn’t create the session.", "error"); }
    });
  }

  /* ---------------- a session, open ---------------- */
  function sessionView(s) {
    const mine = subject.mine, running = !!s.run;
    const chosen = new Set(running ? s.run.keys : s.items.filter((x) => !itemDone(x)).map((x) => x.key));
    const back = el("button", { type: "button", class: "link" }, "‹ All sessions"); back.addEventListener("click", () => { openId = null; clearInterval(tick); draw(); });
    const sel = () => s.items.filter((x) => chosen.has(x.key) && !itemDone(x));
    const curSet = () => { const xs = sel().filter((x) => x.mode !== "time"); return xs.length ? Math.min(...xs.map((x) => (x.setsDone || 0) + 1)) : null; };
    // time since Start goes to each range being worked on, shared out
    const bank = () => { const secs = runSecs(s), xs = s.items.filter((x) => s.run.keys.includes(x.key)); if (secs > 0 && xs.length) for (const x of xs) x.secs = (x.secs || 0) + secs / xs.length; s.secs = (s.secs || 0) + secs; s.run.at = new Date().toISOString(); return secs; };
    const logIt = (secs, setsBy) => saveLog(subject.owner, { id: newPlanId(), at: new Date().toISOString(), minutes: Math.round(secs / 60), session: s.id,
      items: s.items.filter((x) => s.run?.keys?.includes(x.key) || setsBy?.has(x.key)).map((x) => ({ key: x.key, title: x.label, cat: x.cat, sets: setsBy?.get(x.key) || 0, ...(x.club ? { club: x.club, byClub: !!x.byClub } : {}) })) });
    const rows = s.items.map((x) => {
      const d = itemDone(x), box = el("input", { type: "checkbox", checked: chosen.has(x.key) && !d, disabled: d || running || !mine });
      box.addEventListener("change", () => { if (box.checked) chosen.add(x.key); else chosen.delete(x.key); });
      const tg = itemTarget(x, drills);
      return el("tr", { class: d ? "ps-done" : running && s.run.keys.includes(x.key) ? "ps-now" : "" }, [el("td", {}, mine ? box : null), el("td", {}, x.label), el("td", {}, itemPlan(x)),
        el("td", { class: "ps-tgt" }, tg ? [el("strong", {}, `${targetText(tg)} a set`), tg.src ? el("span", { class: "muted small ps-tgt-src" }, ` (${tg.src})`) : null] : el("span", { class: "muted small" }, "—")),
        el("td", { class: "n" }, d ? "✓ Done" : itemProgress(x))]);
    });
    const clock = el("b", { class: "ps-clock" }, fmtClock((s.secs || 0) + runSecs(s)));
    clearInterval(tick); if (running) tick = setInterval(() => { if (!clock.isConnected) { clearInterval(tick); return; } clock.textContent = fmtClock((s.secs || 0) + runSecs(s)); }, 1000);
    const acts = el("div", { class: "ps-btns" });
    if (mine && !running && stateOf(s) !== "done") {
      const start = el("button", { type: "button", class: "btn ps-big" }, "▶ Start Practice");
      start.addEventListener("click", async () => { const xs = sel(); if (!xs.length) { flash("Tick what you’re working on first.", "error"); return; }
        s.run = { at: new Date().toISOString(), keys: xs.map((x) => x.key) }; await save(s); draw(); });
      acts.appendChild(start);
    }
    if (mine && running) {
      const n = curSet(), xs = s.items.filter((x) => s.run.keys.includes(x.key));
      if (n != null) { const b = el("button", { type: "button", class: "btn ps-big" }, `✓ Set ${n} complete`); b.addEventListener("click", async () => {
        const secs = bank(), by = new Map();
        for (const x of xs) if (x.mode !== "time" && !itemDone(x) && (x.setsDone || 0) + 1 === n) { x.setsDone = (x.setsDone || 0) + 1; by.set(x.key, 1); }
        if (xs.every(itemDone)) s.run = null;
        await logIt(secs, by); await save(s); await load(); flash(s.run ? `Set ${n} done.` : "All done!", "ok"); draw(); }); acts.appendChild(b); }
      const all = el("button", { type: "button", class: `btn ${n != null ? "ghost" : "ps-big"}` }, "✓ All sets complete");
      all.addEventListener("click", async () => { const secs = bank(), by = new Map();
        for (const x of xs) { if (x.mode !== "time") by.set(x.key, Math.max(0, x.sets - (x.setsDone || 0))), x.setsDone = x.sets; x.done = true; }
        s.run = null; await logIt(secs, by); await save(s); await load(); flash("Nice work: those are done.", "ok"); draw(); });
      const pause = el("button", { type: "button", class: "btn ghost" }, "⏸ Pause");
      pause.addEventListener("click", async () => { const secs = bank(); s.run = null; await logIt(secs, new Map()); await save(s); await load(); draw(); });
      acts.append(all, pause);
    }
    if (stateOf(s) === "done" && creator()) { const ag = el("button", { type: "button", class: "btn ps-big" }, "↻ Practice Again"); ag.addEventListener("click", () => practiceAgain(s, ag)); acts.appendChild(ag); }
    const del = (mine || canCoach()) ? el("button", { type: "button", class: "link danger" }, "Delete this session") : null;
    del?.addEventListener("click", async () => { if (!confirm("Delete this practice session? Its time and sets come out of your totals too.")) return;
      // (update 693) its logged practice goes too (Where the time went, the week's totals, the coach view)
      for (const e of log.filter((x) => x.session === s.id)) { try { await deleteLog(subject.owner, e.id); } catch (err) { console.error(err); } }
      // (update 699) a session from Stats takes its drill (and the goal it made) out of the plan, so Stats offers "Add to Practice" again
      for (const dr of drills.filter((x) => x.sessionId === s.id)) { try { await removeFromPlan(state, { drill: dr, playerKey: dr.playerKey || null }); } catch (err) { console.error(err); try { await deletePlanItem(subject.owner, dr.id); } catch { /* */ } } }
      window.__taPlanChanged = Date.now();
      await deletePlanItem(subject.owner, s.id); openId = null; await load(); draw(); });
    return [back,
      el("header", { class: "ps-head" }, [el("h1", {}, sessTitle(s)), el("p", { class: "muted" }, [`Created ${dateTxt(s.createdAt)} `, byPill(s)])]),
      el("div", { class: "ps-runbox" }, [el("span", { class: "muted small" }, running ? "Practicing" : "Time so far"), clock]),
      el("div", { class: "ps-tw" }, el("table", { class: "ps-sess-t" }, [el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", {}, "Range"), el("th", {}, "Plan"), el("th", {}, "Target"), el("th", { class: "n" }, "Progress")])), el("tbody", {}, rows)])),
      mine && !running && stateOf(s) !== "done" ? el("p", { class: "muted small" }, "Tick what you’re working on now, then start.") : null,
      acts, del];
  }

  /* ---------------- the list ---------------- */
  // (update 692) who put it on the list: you (or the player), or a coach by name; and whether it came from Stats
  function byPill(s) {
    const c = s.createdBy, you = !c || !!c.self;
    const who = you ? (subject.mine ? "Added by you" : `Added by ${subject.label}`) : `Added by ${c.name || "a coach"}`;
    return el("span", { class: `ps-pill ps-by${you ? "" : " coach"}` }, `${who}${s.fromStats ? " \u00b7 from Stats" : ""}`);
  }
  function card(s) {
    const st = stateOf(s), n = s.items.length, d = s.items.filter(itemDone).length;
    const b = el("button", { type: "button", class: `ps-scard ${st}` }, [
      el("span", { class: "ps-row" }, [el("strong", {}, sessTitle(s)), el("span", { class: "ps-pills" }, [byPill(s), el("span", { class: `ps-pill ${st}` }, st === "done" ? "Completed" : st === "prog" ? (s.run ? "Practicing now" : `In progress · ${d}/${n}`) : "Not started")])]),
      el("span", { class: "ps-goaltxt" }, `${n} range${n === 1 ? "" : "s"} · ${fmtMin((s.secs || 0) / 60 + runSecs(s) / 60)} so far · created ${dateTxt(s.createdAt)}`),
      (() => { const ts = s.items.map((x) => itemTarget(x, drills)).filter(Boolean); return ts.length ? el("span", { class: "ps-goaltxt ps-card-tgt" }, `Target: ${n === 1 ? targetText(ts[0]) : `${ts.length} target${ts.length === 1 ? "" : "s"} set`} a set${n === 1 && ts[0].src ? ` (${ts[0].src})` : ""}`) : null; })(),
      el("span", { class: "ps-bar" }, el("i", { style: `width:${n ? (100 * d) / n : 0}%;${st === "done" ? "background:#30d158" : ""}` })),
    ]);
    b.addEventListener("click", () => { openId = s.id; draw(); window.scrollTo(0, 0); });
    // (update 699) a finished session: Practice Again (a fresh copy, Not yet started)
    if (st !== "done" || !creator()) return b;
    const again = el("button", { type: "button", class: "btn ghost ps-again" }, "↻ Practice Again");
    again.addEventListener("click", () => practiceAgain(s, again));
    return el("div", { class: "ps-scard-row" }, [b, again]);
  }
  async function practiceAgain(s, btn) {
    if (btn) btn.disabled = true;
    const c = { ...s, id: newPlanId(), createdAt: new Date().toISOString(), run: null, secs: 0, againOf: s.id,
      createdBy: subject.mine ? { self: true, name: "you" } : { uid: state.user?.uid || null, name: state.profile?.name || (state.isAdmin ? "Callaway" : "Coach") },
      items: s.items.map((x) => ({ ...x, target: itemTarget(x, drills) || undefined, setsDone: 0, secs: 0, done: false })) };
    if (!c.items.some((x) => x.target)) c.items.forEach((x) => delete x.target);
    try { await save(c); flash("A fresh copy is in Not yet started.", "ok"); await load(); openId = c.id; draw(); window.scrollTo(0, 0); }
    catch (err) { console.error(err); if (btn) btn.disabled = false; flash("Couldn’t copy the session.", "error"); }
  }
  function modal(title, kids) {
    const back = el("div", { class: "ps-modal-back" }), box = el("section", { class: "ps-modal", role: "dialog", "aria-modal": "true", "aria-label": title }, [el("h2", {}, title), ...kids.filter(Boolean)]);
    const w = el("div", { class: "ps-modal-wrap" }, [back, box]);
    const close = () => w.remove();
    back.addEventListener("click", close);
    document.body.appendChild(w);
    return { close };
  }
  async function open(sub) { subject = sub; openId = null; mount(wrap, el("p", { class: "muted" }, "Loading practice…")); await load(); draw(); window.scrollTo(0, 0); }
  let coachEl = null;
  function draw() {
    const s0 = openId && sessions.find((s) => s.id === openId);
    if (s0 && tab === "sessions") { mount(wrap, sessionView(s0)); return; }
    clearInterval(tick);
    // (update 700) two tabs: the practice sessions, and Launch Monitor (TrackMan / GCQuad)
    const tabs = el("div", { class: "ps-seg ps-tabs", role: "tablist" }, [["sessions", "Practice Sessions"], ["lm", "Launch Monitor"]].map(([k, l]) => { const b = el("button", { type: "button", role: "tab", "aria-selected": String(tab === k), class: tab === k ? "on" : "" }, l); b.addEventListener("click", () => { if (tab === k) return; tab = k; draw(); }); return b; }));
    if (tab === "lm") {
      const back = !subject.mine && (coachPlayers?.length || coachPlayers === null) ? (() => { const b = el("button", { type: "button", class: "link" }, "‹ My practice"); b.addEventListener("click", () => open(self)); return b; })() : null;
      const lmBox = el("div", { class: "lm" });
      mount(wrap, [subject.mine ? coachEl : null, back, el("header", { class: "ps-head" }, [el("h1", {}, subject.mine ? "My Practice" : `${subject.label}’s Practice`), el("p", { class: "muted" }, "Launch monitor sessions: TrackMan and GCQuad.")]), tabs, lmBox]);
      import("./practiceLM.js").then((m) => m.renderLM(lmBox, { owner: subject.owner, canWrite: creator(), flash, who: subject.mine ? "" : subject.label })).catch((err) => { console.error(err); mount(lmBox, el("p", { class: "muted" }, "Couldn’t open Launch Monitor.")); });
      return;
    }
    const wk = summary(log, sessions);
    // (update 692) each area, and in it each distance: sets done and time (a stretch's time shared across what was worked on)
    const byArea = new Map();
    for (const e of log.filter((x) => Date.parse(x.at) >= since(30))) { const its = e.items || [], m = Number(e.minutes) || 0; if (!its.length) continue;
      for (const x of its) { const a = AREA[x.cat] || "Other", A = byArea.get(a) || byArea.set(a, { m: 0, items: new Map() }).get(a), nm = x.byClub ? x.club : `${String(x.title || "").split(" \u00b7 ").pop() || "Practice"}${x.club ? ` (${x.club})` : ""}`; // (update 693: club practice by its club)
        const I = A.items.get(nm) || A.items.set(nm, { m: 0, sets: 0 }).get(nm); A.m += m / its.length; I.m += m / its.length; I.sets += Number(x.sets) || 0; } }
    const maxA = Math.max(1, ...[...byArea.values()].map((v) => v.m)), order = [...byArea].sort((a, b) => b[1].m - a[1].m);
    const group = (st) => sessions.filter((s) => stateOf(s) === st).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const sec = (title, list, empty) => [el("p", { class: "ps-t" }, `${title} · ${list.length}`), ...(list.length ? list.map(card) : [el("p", { class: "muted small" }, empty)])];
    const back = !subject.mine && (coachPlayers?.length || coachPlayers === null) ? (() => { const b = el("button", { type: "button", class: "link" }, "‹ My practice"); b.addEventListener("click", () => open(self)); return b; })() : null;
    const create = creator() ? (() => { const b = el("button", { type: "button", class: "btn ps-big" }, subject.mine ? "＋ Create Practice Session" : `＋ Create a session for ${subject.label}`); b.addEventListener("click", createSheet); return b; })() : null;
    mount(wrap, [
      subject.mine ? coachEl : null, back,
      el("header", { class: "ps-head" }, [el("h1", {}, subject.mine ? "My Practice" : `${subject.label}’s Practice`), el("p", { class: "muted" }, "Honor system: check off what you’ve done.")]),
      tabs,
      el("div", { class: "ps-tiles" }, [
        el("div", { class: "ps-tile" }, [el("b", {}, String(wk.days)), el("span", {}, `day${wk.days === 1 ? "" : "s"} practiced this week`)]),
        el("div", { class: "ps-tile" }, [el("b", {}, fmtMin(wk.minutes)), el("span", {}, "practiced this week")]),
        el("div", { class: "ps-tile" }, [el("b", {}, `${wk.done} of ${wk.total}`), el("span", {}, "sessions completed")]),
      ]),
      create,
      ...sec("IN PROGRESS", group("prog"), "Nothing on the go."),
      ...sec("NOT YET STARTED", group("todo"), "Nothing waiting."),
      ...sec("COMPLETED", group("done"), "None finished yet."),
      order.length ? el("p", { class: "ps-t" }, "WHERE THE TIME WENT · LAST 30 DAYS") : null,
      ...order.map(([a, v]) => el("details", { class: "ps-hd" }, [el("summary", { class: "ps-hb" }, [el("span", {}, [el("span", { class: "ps-caret", "aria-hidden": "true" }, "\u25B8 "), a]), el("i", { style: `width:${Math.max(4, (v.m / maxA) * 100)}%` }), el("em", {}, fmtMin(v.m))]),
        el("table", { class: "ps-hd-t" }, el("tbody", {}, [...v.items].sort((p, q) => q[1].m - p[1].m || q[1].sets - p[1].sets).map(([nm, I]) => el("tr", {}, [el("td", {}, nm), el("td", { class: "n" }, `${I.sets} set${I.sets === 1 ? "" : "s"}`), el("td", { class: "n" }, fmtMin(I.m))]))))])),
    ]);
  }
  await load();
  coachEl = await coachBox().catch((err) => { console.error(err); return null; });
  draw();
}
