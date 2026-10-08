// Goals, in three levels you can fold: SG Total → each category → each skill (category + distance).
// Each level has a slider (worst … best 10-round average; a gold tick marks now) and two linked boxes:
// Goal (the value) and SG Change (the gain wanted: goal − now). The deadline is a date or a number of rounds.
// Saved goals show as a list of progress rings. Players set their own; coaches and the admin can too.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { loadSource } from "../reportGen.js";
import { goalLevels, watchGoals, saveGoalSets, setsOf, saveChallenges, CH_STATS, CH_WHEN, challengeText, challengeStatus } from "../goals.js";
import { teamPlayerSelect } from "../teamPlayerSelect.js";

const fmt = (v) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`);
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const r2 = (v) => Math.round(v * 100) / 100;
const parseNum = (t) => { const v = Number(String(t).replace(/[\u2212]/g, "-").replace(/[^\d.+-]/g, "")); return Number.isFinite(v) ? v : null; };

export async function render(main, { previewClient, flash }) {
  const state = getState();
  const playerKey = previewClient ? previewClient.key : state.profile?.clientKey;
  if (!playerKey) return;
  const label = previewClient?.label || state.profile?.name || "My";
  const box = el("div");
  mount(main, [teamPlayerSelect(previewClient, "/goals"), box]);
  const panel = goalsPanel(box, { playerKey, label, flash, own: !previewClient });
  return () => panel.destroy();
}

const OV_RANGES = [["week", "Last week"], ["month", "Last month"], ["year", "Last year"], ["all", "All-time"]];

/** A progress ring (Activity-style). */
const SET_COLORS = ["#d4b483", "#64d2ff", "#bf5af2", "#ff9f0a", "#ff375f"];
function ring(pct, { size = 44, stroke = 5, done = false, color = "#d4b483" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  const svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${done ? "#30d158" : color}" stroke-width="${stroke}" stroke-linecap="round" opacity="${p > 0.005 ? 1 : 0}"
      stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  const s = el("span", { class: "gx-ring" }); s.innerHTML = svg; return s;
}

/**
 * A rotary dial (a 270° arc, like a watch bezel): worst average at the start of the arc, best at the end,
 * a gold tick at now, and a knob you drag round (or move with the arrow keys). The gold arc fills to the knob.
 */
function dial({ lo, hi, value, now, size = 168, onChange, label }) {
  const NS = "http://www.w3.org/2000/svg", cx = size / 2, cy = size / 2, sw = size >= 150 ? 10 : 8, r = size / 2 - sw - 6;
  const A0 = 135, SPAN = 270;
  const pt = (deg, rr = r) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy + rr * Math.sin((deg * Math.PI) / 180)];
  const arc = (d0, d1) => { const [x0, y0] = pt(d0), [x1, y1] = pt(d1); return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const tOf = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  const mk = (tag, a) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  const svg = mk("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "gx-dial-svg" });
  svg.appendChild(mk("path", { d: arc(A0, A0 + SPAN), fill: "none", stroke: "rgba(255,255,255,0.12)", "stroke-width": sw, "stroke-linecap": "round" }));
  const fill = mk("path", { fill: "none", stroke: "#d4b483", "stroke-width": sw, "stroke-linecap": "round" });
  svg.appendChild(fill);
  // now: a small gold tick just outside the arc
  const tn = A0 + SPAN * tOf(now), [ax, ay] = pt(tn, r + sw / 2 + 2), [bx, by] = pt(tn, r + sw / 2 + 7);
  svg.appendChild(mk("line", { x1: ax, y1: ay, x2: bx, y2: by, stroke: "#d4b483", "stroke-width": 2, "stroke-linecap": "round" }));
  const knob = mk("circle", { r: sw * 0.95, fill: "#ffffff", class: "gx-knob" });
  svg.appendChild(knob);
  let v = value;
  const draw = () => {
    const t = tOf(v), deg = A0 + SPAN * t;
    fill.setAttribute("d", t > 0.002 ? arc(A0, deg) : "");
    const [kx, ky] = pt(deg); knob.setAttribute("cx", kx); knob.setAttribute("cy", ky);
    wrap.setAttribute("aria-valuenow", v.toFixed(2)); wrap.setAttribute("aria-valuetext", `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`);
  };
  const wrap = el("div", { class: "gx-dial", role: "slider", tabindex: "0", "aria-label": label, "aria-valuemin": lo.toFixed(2), "aria-valuemax": hi.toFixed(2) });
  wrap.appendChild(svg);
  const set = (nv, user = true) => { v = Math.round(Math.max(lo, Math.min(hi, nv)) * 100) / 100; draw(); if (user) onChange(v); };
  const fromPointer = (e) => {
    const b = svg.getBoundingClientRect(), x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2;
    let rel = ((Math.atan2(y, x) * 180) / Math.PI - A0 + 720) % 360;
    if (rel > SPAN) rel = rel > SPAN + (360 - SPAN) / 2 ? 0 : SPAN; // the gap at the bottom: snap to the nearer end
    set(lo + (hi - lo) * (rel / SPAN));
  };
  wrap.addEventListener("pointerdown", (e) => { e.preventDefault(); wrap.setPointerCapture?.(e.pointerId); wrap.classList.add("held"); fromPointer(e); });
  wrap.addEventListener("pointermove", (e) => { if (wrap.classList.contains("held")) fromPointer(e); });
  const up = () => wrap.classList.remove("held");
  wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up);
  wrap.addEventListener("keydown", (e) => {
    const step = { ArrowUp: 0.01, ArrowRight: 0.01, ArrowDown: -0.01, ArrowLeft: -0.01, PageUp: 0.1, PageDown: -0.1 }[e.key];
    if (step != null) { e.preventDefault(); set(v + step); }
  });
  draw();
  return { node: wrap, set: (nv) => set(nv, false) };
}

export function goalsPanel(container, { playerKey, label, flash = () => {}, own = false }) {
  const state = getState();
  let sgRounds = [], basicRounds = [], chEditing = null, meData = null;
  // "now" and the goal follow the deadline: a 5-round deadline means 5-round averages (10 for a date)
  const lvCache = new Map();
  const levelsFor = (w) => { if (!meData) return []; if (!lvCache.has(w)) lvCache.set(w, goalLevels(meData, { x: w })); return lvCache.get(w); };
  const winOf = (dlx) => (dlx && dlx.type === "rounds" ? Math.max(1, Number(dlx.rounds) || 10) : 10);
  let levels = [], goals = null, editing = null, draft = {}, dl = { type: "date", date: "", rounds: 10 }, setName = "", source = "", nRounds = 0, unsub = () => {}, alive = true;
  let ovRange = "all";            // the overview cards' time frame
  const folded = new Set();      // "TOTAL" folded hides the categories
  const shownSkills = new Set(); // categories whose skills are shown (hidden to start)
  const whose = own || label === "My" ? "My" : `${label}'s`;
  mount(container, el("p", { class: "gx-muted gx-center" }, "Loading\u2026"));
  (async () => {
    try {
      const [tour, entered] = await Promise.all([loadSource("tour", playerKey, label).catch(() => null), loadSource("entered", playerKey, label).catch(() => null)]);
      if (!alive) return;
      let data = tour; source = "Tour Events";
      if (!data || !data.me.rounds.length) { data = entered; source = "Entered Rounds"; }
      meData = data?.me || null;
      levels = meData && meData.rounds.length ? levelsFor(10) : [];
      nRounds = data?.me.rounds.length || 0;
      // challenges: strokes gained from any rounds; fairways, putts … from entered rounds
      sgRounds = [...(tour?.me.rounds || []), ...(entered?.me.rounds || [])];
      basicRounds = (entered?.me.rounds || []).filter((r) => r.basic && r.basic.holes);
      unsub = watchGoals(playerKey, (g) => { goals = g; if (!editing) draw(); });
    } catch (err) { console.error(err); mount(container, el("p", { class: "empty center" }, "Couldn't load the stats for goals.")); }
  })();
  // several goal sets ("challenges"), each with its own name, deadline and goals
  const sets = () => setsOf(goals);
  const current = () => sets().find((x) => x.id === editing) || null;
  const saved = () => current()?.skills || {};
  const challenges = () => goals?.challenges || [];
  const draw = () => { if (!alive) return; if (chEditing) challengeEditor(); else if (editing) editor(); else dashboard(); };
  const win = () => levels[0]?.win || 10;
  // the deadline as saved: a date ("2026-12-31", or { type: "date", date }) or { type: "rounds", rounds, startRounds }
  const deadlineOf = (g) => { const d = g?.deadline; if (!d) return null; return typeof d === "string" ? { type: "date", date: d } : d; };
  const startEdit = (set) => {
    editing = set ? set.id : "new";
    draft = set ? Object.fromEntries(Object.entries(set.skills || {}).map(([k, g]) => [k, { ...g }])) : {};
    const sd = deadlineOf(set); dl = { type: sd?.type || "date", date: sd?.date || "", rounds: sd?.rounds || 10 };
    levels = levelsFor(winOf(dl));
    setName = set?.name || `Goal set ${sets().length + 1}`;
    draw();
  };
  const deadlineTxt = (d) => {
    if (!d) return null;
    if (d.type === "rounds") { const left = d.rounds - Math.max(0, nRounds - (d.startRounds ?? nRounds)); return { main: `${d.rounds} rounds`, sub: left > 1 ? `${left} rounds left` : left === 1 ? "1 round left" : "reached", past: left <= 0 }; }
    const days = Math.ceil((new Date(`${d.date}T23:59:59`) - new Date()) / 86400000);
    return { main: fmtDay(d.date), sub: days > 1 ? `${days} days left` : days === 1 ? "1 day left" : days === 0 ? "today" : "passed", past: days < 0 };
  };

  /* ---------------- progress ---------------- */
  function dashboard() {
    const lv = { total: 0, cat: 1, skill: 2 };
    const status = ({ g, s }) => {
      const reached = s.now >= g.value, span = g.value - g.start;
      return { reached, pct: reached ? 1 : span > 0 ? Math.max(0, (s.now - g.start) / span) : 0, toGo: g.value - s.now };
    };
    const addCh = el("button", { type: "button", class: "gx-btn gx-btn-sm" }, "\uFF0B Goal");
    addCh.addEventListener("click", () => { chEditing = { id: null, stat: "fwy", target: 70, measure: "round", when: "next", n: 3, date: "" }; draw(); });
    let colorAt = 0;
    // A goal set: just its goals (each with its deadline), Edit and Delete. "Now" is the average over the
    // set's own window (a 5-round deadline: the last 5 rounds).
    const card = (set) => {
      const color = SET_COLORS[colorAt++ % SET_COLORS.length];
      const lvs = levelsFor(winOf(deadlineOf(set)));
      const list = Object.entries(set.skills || {}).map(([key, g]) => ({ key, g, s: lvs.find((x) => x.key === key) })).filter((x) => x.s)
        .sort((a, b) => lv[a.s.level] - lv[b.s.level] || lvs.indexOf(a.s) - lvs.indexOf(b.s));
      const d = deadlineTxt(deadlineOf(set));
      const edit = el("button", { type: "button", class: "gx-link" }, "Edit");
      edit.addEventListener("click", () => startEdit(set));
      const del = el("button", { type: "button", class: "gx-link gx-danger" }, "Delete");
      del.addEventListener("click", async () => {
        if (!confirm("Delete these goals?")) return;
        try { const next = sets().filter((x) => x.id !== set.id); await saveGoalSets(playerKey, next, state.user.uid); goals = { ...(goals || {}), sets: next }; draw(); flash("Goals deleted.", "ok"); }
        catch (err) { console.error(err); flash("Couldn't delete them. Try again.", "error"); }
      });
      return el("section", { class: "gx-set", style: `--accent:${color}` }, [
        el("ul", { class: "gx-list" }, list.map((x) => {
          const st = status(x), { g, s } = x;
          const li = el("li", { class: `gx-goal gx-tap${st.reached ? " done" : ""}`, tabindex: "0", role: "button", "aria-label": `${s.label}: rounds since it was set` }, [
            ring(st.pct, { done: st.reached, color }),
            el("div", { class: "gx-goal-main" }, [
              el("span", { class: `gx-goal-name lvl-${s.level}` }, s.label),
              el("span", { class: "gx-goal-line" }, [`Now: ${fmt(s.now)}`, el("span", { class: "gx-arrow" }, "\u2192"), `Goal: ${fmt(g.value)}`]),
              d ? el("span", { class: `gx-goal-line gx-goal-dl${d.past ? " past" : ""}` }, `Deadline: ${d.main} (${d.sub})`) : null,
            ]),
            el("span", { class: `gx-goal-togo${st.reached ? " ok" : ""}` }, st.reached ? "Reached" : `${fmt(st.toGo)} to go`),
          ]);
          const open = () => roundsPopup(`${s.label}`, `${s.win}-round average now ${fmt(s.now)} \u00b7 goal ${fmt(g.value)}`, s.rounds.filter((r) => String(r.date).slice(0, 10) >= (g.setAt || "")), true, g.value);
          li.addEventListener("click", open); li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
          return li;
        })),
        el("div", { class: "gx-set-actions" }, [edit, del]),
      ]);
    };
    // the overview: goals reached, challenges done, challenges going
    const allGoals = sets().flatMap((x) => { const lvs = levelsFor(winOf(deadlineOf(x))); return Object.entries(x.skills || {}).map(([key, g]) => ({ g, s: lvs.find((l) => l.key === key) })).filter((y) => y.s); });
    const goalsDone = allGoals.filter((x) => status(x).reached).length;
    const chs = challenges().map((ch) => ({ ch, st: challengeStatus(ch, sgRounds, basicRounds) }));
    // The overview cards follow a time frame: goals going now always count; finished goals count when they
    // finished inside it. Tap a card for its goals, newest first.
    const since = (() => { const days = { week: 7, month: 30, year: 365 }[ovRange]; if (!days) return ""; const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); })();
    const inRange = ({ st }) => !since || st.ended == null || st.ended >= since;
    const shown = chs.filter(inRange);
    const live = shown.filter((x) => x.st.status === "progress" || x.st.status === "waiting");
    const achieved = shown.filter((x) => x.st.status === "done"), missed = shown.filter((x) => x.st.status === "missed");
    const n = shown.length;
    const stat = (kind, r, big, small, items) => {
      const b = el("button", { type: "button", class: "gx-ov-stat gx-tap", "aria-label": `${small}: ${items.length} ${items.length === 1 ? "goal" : "goals"}. Show them.` }, [r, el("div", {}, [el("strong", {}, big), el("span", {}, small)])]);
      b.addEventListener("click", () => historyPopup(kind, small, items));
      return b;
    };
    const rangeSeg = el("div", { class: "gx-seg gx-ov-range", role: "radiogroup", "aria-label": "Time frame" }, OV_RANGES.map(([v, l]) => {
      const b = el("button", { type: "button", role: "radio", class: ovRange === v ? "on" : "", "aria-checked": ovRange === v ? "true" : "false" }, l);
      b.addEventListener("click", () => { ovRange = v; draw(); });
      return b;
    }));
    const overview = el("section", { class: "gx-ov-wrap" }, [
      rangeSeg,
      el("div", { class: "gx-overview" }, [
        stat("live", ring(n ? live.length / n : 0, { size: 52, stroke: 6, color: "#64d2ff" }), String(live.length), "In Progress", live),
        stat("done", ring(n ? achieved.length / n : 0, { size: 52, stroke: 6, color: "#30d158" }), `${achieved.length}/${n}`, "Achieved", achieved),
        stat("missed", ring(n ? missed.length / n : 0, { size: 52, stroke: 6, color: "#ff453a" }), String(missed.length), "Missed", missed),
      ]),
    ]);
    // challenges
    const chCard = ({ ch, st }) => {
      const { val, words, open } = chInfo({ ch, st });
      const del = el("button", { type: "button", class: "gx-link gx-danger gx-ch-del", "aria-label": "Delete this goal" }, "\u2715");
      // (one listener: a capture-phase stopPropagation on the button itself stopped this one from running)
      del.addEventListener("click", (e) => { e.stopPropagation(); if (confirm("Delete this goal?")) deleteChallenge(ch); });
      const edit = el("button", { type: "button", class: "gx-link gx-ch-edit" }, "Edit");
      edit.addEventListener("click", (e) => { e.stopPropagation(); chEditing = { ...ch, n: ch.n || 3, date: ch.date || "" }; draw(); });
      const card = el("article", { class: `gx-ch gx-tap ${st.status}${st.status === "progress" && !st.met ? " behind" : ""}`, tabindex: "0", role: "button", "aria-label": `${challengeText(ch)}: rounds so far` }, [
        el("div", { class: "gx-ch-top" }, [el("span", { class: "gx-ch-badge" }, st.status === "done" ? "\u2713" : st.status === "missed" ? "\u2715" : st.status === "waiting" ? "\u2022\u2022\u2022" : "\u25B6"), el("span", { class: "gx-ch-status" }, words), edit, del]),
        el("p", { class: "gx-ch-text" }, challengeText(ch)),
        el("div", { class: "gx-ch-now" }, [el("strong", {}, val), el("span", {}, st.rounds ? `${st.rounds} round${st.rounds === 1 ? "" : "s"} so far` : st.needs === "entered" ? "from your entered rounds" : "no rounds yet")]),
      ]);
      card.addEventListener("click", open); card.addEventListener("keydown", (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } });
      return card;
    };
    const activeChs = chs.filter((x) => x.st.status === "progress" || x.st.status === "waiting")
      .sort((a, b) => String(b.ch.start).localeCompare(String(a.ch.start)));
    mount(container, el("div", { class: "gx" }, [
      el("header", { class: "gx-head gx-hero" }, [
        el("div", {}, [el("p", { class: "gx-eyebrow" }, "Goals"), el("h1", { class: "gx-title" }, whose === "My" ? "My goals" : label), el("p", { class: "gx-sub" }, `${source} \u00b7 tap a goal for its rounds`)]),
        el("div", { class: "gx-head-actions" }, [addCh]),
      ]),
      overview,
      el("div", { class: "gx-section-head" }, [el("h2", {}, "Active Goals"), el("span", {}, "Targets for a round, a week or a date")]),
      activeChs.length ? el("div", { class: "gx-chs" }, activeChs.map(chCard))
        : el("p", { class: "gx-empty" }, chs.length ? "No active goals. Finished ones are under Achieved and Missed above." : "No goals yet. Try \u201cHit 70% fairways in my next round\u201d."),
      el("p", { class: "gx-foot" }, "Strokes gained a round. Rings fill from where each goal started to the goal."),
    ]));
  }

  /* ---------------- a quick goal's words, value and rounds ---------------- */
  function chInfo({ ch, st }) {
    const S = CH_STATS.find((x) => x.key === ch.stat) || CH_STATS[0];
    const val = st.value == null ? "\u2014" : S.kind === "sg" ? fmt(st.value) : S.unit === "%" ? `${st.value.toFixed(1)}%` : st.value.toFixed(1);
    const words = { waiting: "Waiting for a round", progress: st.met ? "On track" : "Behind", done: "Achieved", missed: "Missed" }[st.status];
    const open = () => roundsPopup(challengeText(ch), `Since ${ch.start} \u00b7 ${words}${st.value == null ? "" : ` \u00b7 ${st.status === "done" || st.status === "missed" ? "result" : "so far"} ${val}`}`, st.each, S.kind === "sg", Number(ch.target), S);
    return { S, val, words, open };
  }
  async function deleteChallenge(ch) {
    const next = challenges().filter((x) => x.id !== ch.id);
    try { await saveChallenges(playerKey, next, state.user.uid); goals = { ...(goals || {}), challenges: next }; draw(); return true; }
    catch (err) { console.error(err); flash("Couldn't delete it.", "error"); return false; }
  }

  /* ---------------- an overview card's goals, newest first ---------------- */
  function historyPopup(kind, title, items) {
    const rangeName = (OV_RANGES.find(([v]) => v === ovRange) || OV_RANGES[3])[1];
    const when = (x) => (kind === "live" ? x.ch.start : x.st.ended || x.ch.start) || "";
    const list = [...items].sort((a, b) => String(when(b)).localeCompare(String(when(a))) || String(b.ch.start).localeCompare(String(a.ch.start)));
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const ul = el("ul", { class: "gx-pop-list gx-hist" });
    const row = (x) => {
      const { val, words, open } = chInfo(x);
      const { ch, st } = x;
      const dates = kind === "live" ? `Set ${fmtDay(ch.start)} \u00b7 ${words}` : `Set ${fmtDay(ch.start)} \u00b7 ${kind === "done" ? "achieved" : "missed"} ${fmtDay(st.ended || ch.start)}`;
      const del = el("button", { type: "button", class: "gx-link gx-danger gx-hist-del", "aria-label": "Delete this goal" }, "\u2715");
      const li = el("li", { class: `gx-hist-row gx-tap ${st.status}${st.status === "progress" && !st.met ? " behind" : ""}`, tabindex: "0", role: "button", "aria-label": `${challengeText(ch)}: rounds` }, [
        el("span", { class: "gx-ch-badge" }, st.status === "done" ? "\u2713" : st.status === "missed" ? "\u2715" : st.status === "waiting" ? "\u2022\u2022\u2022" : "\u25B6"),
        el("div", { class: "gx-pop-when" }, [el("strong", {}, challengeText(ch)), el("span", {}, dates)]),
        el("strong", { class: `gx-pop-v${st.met ? " ok" : ""}` }, val),
        del,
      ]);
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => { if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } });
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Delete this goal?")) return;
        if (await deleteChallenge(ch)) { li.remove(); count.textContent = String(ul.children.length); if (!ul.children.length) ul.replaceWith(empty()); }
      });
      return li;
    };
    const empty = () => el("p", { class: "gx-empty" }, kind === "live" ? "No goals in progress." : `No ${title.toLowerCase()} goals ${ovRange === "all" ? "yet" : `in the ${rangeName.toLowerCase()}`}.`);
    list.forEach((x) => ul.appendChild(row(x)));
    const count = el("strong", {}, String(list.length));
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": title }, el("div", { class: "gx-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Goal history"), el("h2", {}, title),
        el("p", { class: "gx-sub" }, `${kind === "live" ? "Going now" : rangeName} \u00b7 newest first \u00b7 tap a goal for its rounds`)]), close]),
      el("div", { class: "gx-pop-sum gx-pop-sum1" }, [el("div", {}, [el("span", {}, "Goals"), count])]),
      list.length ? ul : empty(),
    ]));
    showOverlay(overlay, close);
  }
  // pop-ups can stack (a goal's rounds over the history): Escape and the page lock follow the top one
  function showOverlay(overlay, close) {
    const isTop = () => [...document.querySelectorAll(".gx-pop-overlay")].pop() === overlay;
    const shut = () => {
      overlay.remove(); document.removeEventListener("keydown", onKey);
      if (!document.querySelector(".gx-pop-overlay")) document.body.classList.remove("gx-noscroll");
    };
    const onKey = (e) => { if (e.key === "Escape" && isTop()) { e.stopImmediatePropagation(); shut(); } };
    close.addEventListener("click", shut);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    document.addEventListener("keydown", onKey);
    document.body.classList.add("gx-noscroll");
    document.body.appendChild(overlay);
    close.focus();
  }

  /* ---------------- the round-by-round pop-up ---------------- */
  function roundsPopup(title, sub, rounds, isSG, target, stat = null) {
    const fv = (v) => (v == null || !Number.isFinite(v) ? "\u2014" : isSG ? fmt(v) : stat?.unit === "%" ? `${v.toFixed(1)}%` : v.toFixed(1));
    const vals = rounds.map((r) => r.v).filter((v) => v != null && Number.isFinite(v));
    const mx = Math.max(0.01, ...vals.map(Math.abs), Math.abs(target || 0));
    const good = (v) => (stat && stat.higher === false ? v <= target : v >= target);
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const list = rounds.length ? el("ul", { class: "gx-pop-list" }, rounds.map((r) => {
      const d = new Date(String(r.date).slice(0, 10) + "T12:00:00");
      return el("li", {}, [
        el("div", { class: "gx-pop-when" }, [el("strong", {}, isNaN(d) ? r.date : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })), el("span", {}, `${r.event || "Round"}${r.roundNo ? ` \u00b7 R${r.roundNo}` : ""}`)]),
        isSG ? (() => { const w = Math.max(3, (Math.abs(r.v || 0) / mx) * 100); // dark at zero, brightest at the longest bar
          return el("span", { class: "gx-pop-bar" }, el("span", { class: r.v >= 0 ? "pos" : "neg", style: `width:${w}%;background-size:${(10000 / w).toFixed(1)}% 100%;background-repeat:no-repeat` })); })() : el("span", { class: "gx-pop-bar" }),
        el("strong", { class: `gx-pop-v${r.v == null ? "" : good(r.v) ? " ok" : ""}` }, fv(r.v)),
      ]);
    })) : el("p", { class: "gx-empty" }, "No rounds since this was set.");
    const avg = vals.length ? vals.reduce((t, v) => t + v, 0) / vals.length : null;
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": title }, el("div", { class: "gx-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Round by round"), el("h2", {}, title), el("p", { class: "gx-sub" }, sub)]), close]),
      el("div", { class: "gx-pop-sum" }, [
        el("div", {}, [el("span", {}, "Rounds"), el("strong", {}, String(rounds.length))]),
        el("div", {}, [el("span", {}, "Average"), el("strong", {}, fv(avg))]),
        el("div", {}, [el("span", {}, "Target"), el("strong", {}, fv(target))]),
      ]),
      list,
    ]));
    showOverlay(overlay, close);
  }

  /* ---------------- a challenge: "Hit [70]% [fairways] in [my next round]" ---------------- */
  function challengeEditor() {
    const ch = chEditing;
    const S = () => CH_STATS.find((x) => x.key === ch.stat) || CH_STATS[0];
    const statSel = el("select", { class: "gx-field gx-sel", "aria-label": "Stat" }, [
      el("optgroup", { label: "Strokes gained" }, CH_STATS.filter((x) => x.kind === "sg").map((x) => el("option", { value: x.key, selected: ch.stat === x.key }, x.label))),
      el("optgroup", { label: basicRounds.length ? "Round stats" : "Round stats (from entered rounds)" }, CH_STATS.filter((x) => x.kind === "basic").map((x) => el("option", { value: x.key, selected: ch.stat === x.key }, x.label))),
    ]);
    const target = el("input", { type: "text", inputmode: "decimal", class: "gx-field gx-num", value: String(ch.target), "aria-label": "Target" });
    const measure = el("div", { class: "gx-seg", role: "radiogroup", "aria-label": "Per round or in total" }, [["round", "a round"], ["total", "in total"]].map(([v, l]) => {
      const b = el("button", { type: "button", role: "radio", class: ch.measure === v ? "on" : "", "aria-checked": ch.measure === v ? "true" : "false" }, l);
      b.addEventListener("click", () => { ch.measure = v; challengeEditor(); }); return b;
    }));
    const whenSel = el("select", { class: "gx-field gx-sel", "aria-label": "When" }, CH_WHEN.map(([v, l]) => el("option", { value: v, selected: ch.when === v }, l)));
    const nIn = el("input", { type: "number", min: 2, max: 30, class: "gx-field gx-num", value: ch.n || 3, "aria-label": "Number of rounds" });
    const dIn = el("input", { type: "date", class: "gx-field gx-date", value: ch.date || "", "aria-label": "By date" });
    const sentence = el("p", { class: "gx-ch-preview" });
    const sync = () => { sentence.textContent = challengeText({ ...ch, target: Number(ch.target) || 0 }); };
    statSel.addEventListener("change", () => {
      ch.stat = statSel.value; const st = S();
      ch.target = st.kind === "sg" ? 0.5 : st.unit === "%" ? 60 : st.key === "putts" ? 30 : st.key === "score" ? 72 : 3; // a sensible starting target
      challengeEditor();
    });
    target.addEventListener("input", () => { const v = Number(String(target.value).replace("\u2212", "-").replace("+", "")); if (Number.isFinite(v)) ch.target = v; sync(); });
    whenSel.addEventListener("change", () => { ch.when = whenSel.value; challengeEditor(); });
    nIn.addEventListener("input", () => { ch.n = Math.max(2, Math.round(Number(nIn.value) || 3)); sync(); });
    dIn.addEventListener("change", () => { ch.date = dIn.value; sync(); });
    sync();
    const save = el("button", { type: "button", class: "gx-btn" }, ch.id ? "Save Goal" : "Add Goal");
    const cancel = el("button", { type: "button", class: "gx-link" }, "Cancel");
    cancel.addEventListener("click", () => { chEditing = null; draw(); });
    save.addEventListener("click", async () => {
      if (ch.when === "date" && !ch.date) { flash("Pick the date.", "error"); return; }
      const st = S();
      const item = { id: ch.id || `c${Date.now().toString(36)}`, stat: ch.stat, target: Number(ch.target) || 0, measure: st.kind === "sg" ? ch.measure : "round", when: ch.when,
        n: ch.when === "nextN" ? ch.n : null, date: ch.when === "date" ? ch.date : null, start: ch.start || new Date().toISOString().slice(0, 10) };
      const next = ch.id ? challenges().map((x) => (x.id === ch.id ? item : x)) : [...challenges(), item];
      save.disabled = true;
      try { await saveChallenges(playerKey, next, state.user.uid); goals = { ...(goals || {}), challenges: next }; chEditing = null; draw(); flash(ch.id ? "Goal saved." : "Goal added.", "ok"); }
      catch (err) { console.error(err); flash("Couldn't save the goal. Try again.", "error"); save.disabled = false; }
    });
    const st = S();
    mount(container, el("div", { class: "gx" }, [
      el("header", { class: "gx-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Goals"), el("h1", { class: "gx-title" }, ch.id ? "Edit goal" : "New goal"), el("p", { class: "gx-sub" }, ch.id ? `Counting rounds from ${ch.start}.` : "A quick target. Only rounds played from today count.")])]),
      el("section", { class: "gx-group" }, [
        el("div", { class: "gx-row gx-dlrow" }, [el("span", { class: "gx-row-label" }, "Stat"), statSel]),
        el("div", { class: "gx-row gx-dlrow" }, [el("span", { class: "gx-row-label" }, st.kind === "sg" ? "Gain" : st.higher ? "At least" : "At most"),
          target, st.unit === "%" ? el("span", { class: "gx-unit" }, "%") : null, st.kind === "sg" ? measure : null]),
        el("div", { class: "gx-row gx-dlrow" }, [el("span", { class: "gx-row-label" }, "When"), whenSel, ch.when === "nextN" ? el("span", { class: "gx-rounds" }, [nIn, "rounds"]) : null, ch.when === "date" ? dIn : null]),
      ]),
      el("div", { class: "gx-ch-sentence" }, [el("span", { class: "gx-eyebrow" }, "Your goal"), sentence,
        st.kind === "basic" && !basicRounds.length ? el("p", { class: "gx-sub" }, "This stat comes from rounds entered in Data Entry (full shots or quick mode).") : null]),
      el("div", { class: "gx-bar" }, [cancel, save]),
    ]));
  }

  /* ---------------- setting goals ---------------- */
  function editor() {
    const total = levels.find((l) => l.level === "total");
    const cats = levels.filter((l) => l.level === "cat");
    const skillsOf = (cat) => levels.filter((l) => l.level === "skill" && l.cat === cat);
    // deadline: a date, or a number of rounds
    const seg = el("div", { class: "gx-seg", role: "radiogroup", "aria-label": "Deadline" }, [["date", "By date"], ["rounds", "In rounds"]].map(([v, l]) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": dl.type === v ? "true" : "false", class: dl.type === v ? "on" : "" }, l);
      b.addEventListener("click", () => { dl.type = v; levels = levelsFor(winOf(dl)); editor(); });
      return b;
    }));
    const dlInput = dl.type === "date"
      ? el("input", { type: "date", class: "gx-field gx-date", value: dl.date, "aria-label": "Deadline date" })
      : el("span", { class: "gx-rounds" }, [el("input", { type: "number", min: 1, max: 200, class: "gx-field gx-num", value: dl.rounds, "aria-label": "Deadline in rounds" }), "rounds"]);
    (dlInput.tagName === "INPUT" ? dlInput : dlInput.querySelector("input")).addEventListener("change", (e) => {
      if (dl.type === "date") { dl.date = e.target.value; return; }
      dl.rounds = Math.max(1, Math.round(Number(e.target.value) || 10));
      levels = levelsFor(winOf(dl)); setTimeout(editor, 0); // the dials re-measure over the new number of rounds
    });
    const save = el("button", { type: "button", class: "gx-btn" }, "Save Goals");
    const cancel = sets().length ? el("button", { type: "button", class: "gx-link" }, "Cancel") : null;
    cancel?.addEventListener("click", () => { editing = null; draft = {}; draw(); });
    const nameIn = el("input", { type: "text", class: "gx-field gx-name-in", value: setName, maxLength: 60, placeholder: "e.g. Winter putting challenge", "aria-label": "Name of this goal set" });
    nameIn.addEventListener("input", () => { setName = nameIn.value; });
    save.addEventListener("click", async () => {
      const out = {};
      for (const [k, g] of Object.entries(draft)) {
        const s = levels.find((x) => x.key === k); if (!s) continue;
        out[k] = { value: r2(g.value), start: r2(s.now), label: s.label, setAt: new Date().toISOString().slice(0, 10) };
        if (saved()[k]?.start != null) { out[k].start = saved()[k].start; out[k].setAt = saved()[k].setAt || out[k].setAt; }
      }
      if (!Object.keys(out).length) { flash("Turn on at least one goal.", "error"); return; }
      const prev = deadlineOf(current());
      const deadline = dl.type === "rounds" ? { type: "rounds", rounds: dl.rounds, startRounds: prev?.type === "rounds" && prev.rounds === dl.rounds ? prev.startRounds : nRounds }
        : dl.date ? { type: "date", date: dl.date } : null;
      const id = current()?.id || `g${Date.now().toString(36)}`;
      const set = { id, name: (setName || "").trim() || "Goals", skills: out, deadline, createdAt: current()?.createdAt || new Date().toISOString().slice(0, 10) };
      const next = current() ? sets().map((x) => (x.id === id ? set : x)) : [...sets(), set];
      save.disabled = true;
      try { await saveGoalSets(playerKey, next, state.user.uid); editing = null; goals = { sets: next }; draw(); flash("Goals saved.", "ok"); }
      catch (err) { console.error(err); flash("Couldn't save the goals. Try again.", "error"); save.disabled = false; }
    });
    const totalOpen = !folded.has("TOTAL");
    const blocks = [];
    if (total) blocks.push(el("section", { class: "gx-group gx-total" }, dialCard(total, cats.length ? totalOpen : null, "Categories")));
    if (total && totalOpen && cats.length) {
      blocks.push(el("div", { class: "gx-dialgrid" }, cats.map((c) => dialCard(c, skillsOf(c.cat).length ? shownSkills.has(c.key) : null, "Skills"))));
      for (const c of cats) {
        const sk = skillsOf(c.cat);
        if (!sk.length || !shownSkills.has(c.key)) continue;
        blocks.push(el("p", { class: "gx-section" }, `${c.label} \u00b7 by distance`), el("section", { class: "gx-group" }, sk.map((x) => row(x, null))));
      }
    }
    mount(container, el("div", { class: "gx" }, [
      el("header", { class: "gx-head" }, [
        el("div", {}, [el("p", { class: "gx-eyebrow" }, "Goals"), el("h1", { class: "gx-title" }, whose === "My" ? "Set my goals" : label),
          el("p", { class: "gx-sub" }, `Each dial and slider runs from the worst to the best ${win()}-round average; the gold tick is now. Drag to set a goal, or type it.`)]),
      ]),
      el("section", { class: "gx-group" }, [

        el("div", { class: "gx-row gx-dlrow" }, [el("span", { class: "gx-row-label" }, "Deadline"), seg, dlInput]),
      ]),
      ...blocks,
      el("div", { class: "gx-bar" }, [cancel, save]),
    ]));
  }

  function dialCard(s, open, kidsName) {
    const on = !!draft[s.key];
    const lo = Math.min(s.worst, s.now, draft[s.key]?.value ?? Infinity), hi = Math.max(s.best, s.now, draft[s.key]?.value ?? -Infinity);
    const start = draft[s.key]?.value ?? r2(Math.min(hi, s.now + 0.05)); // default: now + 0.05 (or the end)
    const big = el("strong", { class: "gx-dial-val" }, fmt(start)), chg = el("span", { class: "gx-dial-chg" }, `${fmt(start - s.now)} change`);
    const goalIn = el("input", { type: "text", inputmode: "decimal", class: "gx-field gx-num", value: fmt(start), "aria-label": `${s.label}: goal value` });
    const deltaIn = el("input", { type: "text", inputmode: "decimal", class: "gx-field gx-num", value: fmt(start - s.now), "aria-label": `${s.label}: SG change` });
    const sw = el("button", { type: "button", role: "switch", class: `gx-switch${on ? " on" : ""}`, "aria-checked": on ? "true" : "false", "aria-label": `Goal for ${s.label}` });
    let d = null;
    const setGoal = (v, from) => {
      v = r2(v);
      draft[s.key] = { value: v };
      if (!sw.classList.contains("on")) { sw.classList.add("on"); sw.setAttribute("aria-checked", "true"); card.classList.add("active"); }
      if (from !== "dial") d.set(v);
      if (from !== "goal") goalIn.value = fmt(v);
      if (from !== "delta") deltaIn.value = fmt(v - s.now);
      big.textContent = fmt(v); chg.textContent = `${fmt(v - s.now)} change`;
    };
    d = dial({ lo, hi, value: start, now: s.now, size: s.level === "total" ? 196 : 132, label: `${s.label}: goal`, onChange: (v) => setGoal(v, "dial") });
    goalIn.addEventListener("change", () => { const v = parseNum(goalIn.value); if (v != null) setGoal(v, null); else goalIn.value = fmt(draft[s.key]?.value ?? start); });
    deltaIn.addEventListener("change", () => { const v = parseNum(deltaIn.value); if (v != null) setGoal(s.now + v, null); else deltaIn.value = fmt((draft[s.key]?.value ?? start) - s.now); });
    sw.addEventListener("click", () => { if (draft[s.key]) delete draft[s.key]; else draft[s.key] = { value: r2(start) }; editor(); });
    const fold = open === null ? null : el("button", { type: "button", class: `gx-more${open ? " open" : ""}`, "aria-expanded": open ? "true" : "false" }, [open ? `Hide ${kidsName}` : `Show ${kidsName}`, el("span", { "aria-hidden": "true" }, " \u203A")]);
    fold?.addEventListener("click", () => {
      if (s.level === "total") { if (folded.has(s.key)) folded.delete(s.key); else folded.add(s.key); }
      else if (shownSkills.has(s.key)) shownSkills.delete(s.key); else shownSkills.add(s.key);
      editor();
    });
    const card = el("div", { class: `gx-dialcard lvl-${s.level}${on ? " active" : ""}` }, [
      el("div", { class: "gx-dc-head" }, [el("span", { class: "gx-name" }, s.label), sw]),
      el("div", { class: "gx-dial-wrap" }, [d.node, el("div", { class: "gx-dial-center" }, [big, chg, el("span", { class: "gx-dial-now" }, `Now ${fmt(s.now)}`)])]),
      el("div", { class: "gx-dc-ends" }, [el("span", {}, `Worst ${fmt(s.worst)}`), el("span", {}, `Best ${fmt(s.best)}`)]),
      el("div", { class: "gx-dc-boxes" }, [el("label", { class: "gx-box" }, [el("span", {}, "Goal"), goalIn]), el("label", { class: "gx-box" }, [el("span", {}, "SG Change"), deltaIn])]),
      fold,
    ]);
    return card;
  }

  function row(s, open) {
    const on = !!draft[s.key];
    const lo = Math.min(s.worst, s.now, draft[s.key]?.value ?? Infinity), hi = Math.max(s.best, s.now, draft[s.key]?.value ?? -Infinity);
    const start = draft[s.key]?.value ?? r2(Math.min(hi, s.now + 0.05)); // default: now + 0.05 (or the end)
    const slider = el("input", { type: "range", class: "gx-range", min: lo, max: hi, step: 0.01, value: start, "aria-label": `${s.label}: goal` });
    const goalIn = el("input", { type: "text", inputmode: "decimal", class: "gx-field gx-num", value: fmt(start), "aria-label": `${s.label}: goal value` });
    const deltaIn = el("input", { type: "text", inputmode: "decimal", class: "gx-field gx-num", value: fmt(start - s.now), "aria-label": `${s.label}: SG change` });
    const sw = el("button", { type: "button", role: "switch", class: `gx-switch${on ? " on" : ""}`, "aria-checked": on ? "true" : "false", "aria-label": `Goal for ${s.label}` });
    const setGoal = (v, from) => {
      v = r2(v);
      draft[s.key] = { value: v };
      if (!sw.classList.contains("on")) { sw.classList.add("on"); sw.setAttribute("aria-checked", "true"); wrap.classList.add("active"); }
      if (from !== "slider") { slider.value = String(Math.min(hi, Math.max(lo, v))); slider.style.setProperty("--p", `${((Number(slider.value) - lo) / (hi - lo || 1)) * 100}%`); }
      if (from !== "goal") goalIn.value = fmt(v);
      if (from !== "delta") deltaIn.value = fmt(v - s.now);
    };
    // the track fills up to the knob
    const paint = () => slider.style.setProperty("--p", `${((Number(slider.value) - lo) / (hi - lo || 1)) * 100}%`);
    paint();
    slider.addEventListener("input", () => { setGoal(Number(slider.value), "slider"); paint(); });
    goalIn.addEventListener("change", () => { const v = parseNum(goalIn.value); if (v != null) setGoal(v, null); else goalIn.value = fmt(draft[s.key]?.value ?? start); });
    deltaIn.addEventListener("change", () => { const v = parseNum(deltaIn.value); if (v != null) setGoal(s.now + v, null); else deltaIn.value = fmt((draft[s.key]?.value ?? start) - s.now); });
    sw.addEventListener("click", () => { if (draft[s.key]) delete draft[s.key]; else draft[s.key] = { value: r2(Number(slider.value)) }; editor(); });
    const frac = (s.now - lo) / (hi - lo || 1);
    const fold = open === null ? el("span", { class: "gx-fold-sp" }) : el("button", { type: "button", class: `gx-fold${open ? " open" : ""}`, "aria-expanded": open ? "true" : "false", "aria-label": `${open ? "Fold" : "Open"} ${s.label}` }, "\u203A");
    if (open !== null) fold.addEventListener("click", () => { if (folded.has(s.key)) folded.delete(s.key); else folded.add(s.key); editor(); });
    const wrap = el("div", { class: `gx-row gx-goalrow lvl-${s.level}${on ? " active" : ""}` }, [
      el("div", { class: "gx-r1" }, [fold, el("span", { class: "gx-name" }, s.label), el("span", { class: "gx-now" }, `Now ${fmt(s.now)}`), sw]),
      el("div", { class: "gx-r2" }, [
        el("div", { class: "gx-track" }, [slider, el("span", { class: "gx-tick", style: `left:calc(${frac * 100}% + ${((0.5 - frac) * 22).toFixed(1)}px)`, title: "Now" }),
          el("div", { class: "gx-minmax" }, [el("span", {}, fmt(lo)), el("span", {}, fmt(hi))])]),
        el("label", { class: "gx-box" }, [el("span", {}, "Goal"), goalIn]),
        el("label", { class: "gx-box" }, [el("span", {}, "SG Change"), deltaIn]),
      ]),
    ]);
    return wrap;
  }

  return { destroy() { alive = false; unsub(); } };
}
