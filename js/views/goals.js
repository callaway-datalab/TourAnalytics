// Goals, in three levels you can fold: SG Total → each category → each skill (category + distance).
// Each level has a slider (worst … best 10-round average; a gold tick marks now) and two linked boxes:
// Goal (the value) and SG Change (the gain wanted: goal − now). The deadline is a date or a number of rounds.
// Saved goals show as a list of progress rings. Players set their own; coaches and the admin can too.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { loadSource } from "../reportGen.js";
import { goalLevels, watchGoals, saveGoals } from "../goals.js";
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

/** A progress ring (Activity-style). */
function ring(pct, { size = 44, stroke = 5, done = false } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  const svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${done ? "#30d158" : "#d4b483"}" stroke-width="${stroke}" stroke-linecap="round"
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
  let levels = [], goals = null, editing = false, draft = {}, dl = { type: "date", date: "", rounds: 10 }, source = "", nRounds = 0, unsub = () => {}, alive = true;
  const folded = new Set();
  const whose = own || label === "My" ? "My" : `${label}'s`;
  mount(container, el("p", { class: "gx-muted gx-center" }, "Loading\u2026"));
  (async () => {
    try {
      let data = await loadSource("tour", playerKey, label); source = "Tour Events";
      if (!data || !data.me.rounds.length) { data = await loadSource("entered", playerKey, label); source = "Entered Rounds"; }
      if (!alive) return;
      levels = data && data.me.rounds.length ? goalLevels(data.me) : [];
      nRounds = data?.me.rounds.length || 0;
      if (!levels.length) { mount(container, el("p", { class: "empty center" }, "Not enough rounds yet to set goals on (at least 3).")); return; }
      unsub = watchGoals(playerKey, (g) => { goals = g; if (!editing) draw(); });
    } catch (err) { console.error(err); mount(container, el("p", { class: "empty center" }, "Couldn't load the stats for goals.")); }
  })();
  const saved = () => goals?.skills || {};
  const draw = () => { if (!alive) return; if (editing || !Object.keys(saved()).length) editor(); else dashboard(); };
  const win = () => levels[0]?.win || 10;
  // the deadline as saved: a date ("2026-12-31", or { type: "date", date }) or { type: "rounds", rounds, startRounds }
  const deadlineOf = (g) => { const d = g?.deadline; if (!d) return null; return typeof d === "string" ? { type: "date", date: d } : d; };
  const deadlineTxt = (d) => {
    if (!d) return null;
    if (d.type === "rounds") { const left = d.rounds - Math.max(0, nRounds - (d.startRounds ?? nRounds)); return { main: `${d.rounds} rounds`, sub: left > 1 ? `${left} rounds left` : left === 1 ? "1 round left" : "reached", past: left <= 0 }; }
    const days = Math.ceil((new Date(`${d.date}T23:59:59`) - new Date()) / 86400000);
    return { main: fmtDay(d.date), sub: days > 1 ? `${days} days left` : days === 1 ? "1 day left" : days === 0 ? "today" : "passed", past: days < 0 };
  };

  /* ---------------- progress ---------------- */
  function dashboard() {
    const lv = { total: 0, cat: 1, skill: 2 };
    const list = Object.entries(saved()).map(([key, g]) => ({ key, g, s: levels.find((x) => x.key === key) })).filter((x) => x.s)
      .sort((a, b) => lv[a.s.level] - lv[b.s.level] || levels.indexOf(a.s) - levels.indexOf(b.s));
    const status = ({ g, s }) => {
      const reached = s.now >= g.value, span = g.value - g.start;
      return { reached, pct: reached ? 1 : span > 0 ? Math.max(0, (s.now - g.start) / span) : 0, toGo: g.value - s.now };
    };
    const done = list.filter((x) => status(x).reached).length;
    const d = deadlineTxt(deadlineOf(goals));
    const edit = el("button", { type: "button", class: "gx-link" }, "Edit");
    edit.addEventListener("click", () => {
      editing = true; draft = Object.fromEntries(Object.entries(saved()).map(([k, g]) => [k, { ...g }]));
      const sd = deadlineOf(goals); dl = { type: sd?.type || "date", date: sd?.date || "", rounds: sd?.rounds || 10 }; draw();
    });
    mount(container, el("div", { class: "gx" }, [
      el("header", { class: "gx-head" }, [
        el("div", {}, [el("p", { class: "gx-eyebrow" }, "Goals"), el("h1", { class: "gx-title" }, whose === "My" ? "My goals" : label), el("p", { class: "gx-sub" }, `${source} \u00b7 now is the last ${win()} rounds`)]),
        edit,
      ]),
      el("section", { class: "gx-summary" }, [
        ring(list.length ? done / list.length : 0, { size: 64, stroke: 7, done: done === list.length && list.length > 0 }),
        el("div", { class: "gx-sum-txt" }, [el("strong", {}, `${done} of ${list.length}`), el("span", {}, `goal${list.length === 1 ? "" : "s"} reached`)]),
        d ? el("div", { class: `gx-dl${d.past ? " past" : ""}` }, [el("span", {}, "Deadline"), el("strong", {}, d.main), el("span", {}, d.sub)]) : null,
      ]),
      el("ul", { class: "gx-list" }, list.map((x) => {
        const st = status(x), { g, s } = x;
        return el("li", { class: `gx-goal${st.reached ? " done" : ""}` }, [
          ring(st.pct, { done: st.reached }),
          el("div", { class: "gx-goal-main" }, [
            el("span", { class: `gx-goal-name lvl-${s.level}` }, s.label),
            el("span", { class: "gx-goal-line" }, [`Now ${fmt(s.now)}`, el("span", { class: "gx-arrow" }, "\u2192"), `Goal ${fmt(g.value)}`]),
          ]),
          el("span", { class: `gx-goal-togo${st.reached ? " ok" : ""}` }, st.reached ? "Reached" : `${fmt(st.toGo)} to go`),
        ]);
      })),
      el("p", { class: "gx-foot" }, "Strokes gained a round. Rings fill from where each goal started to the goal."),
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
      b.addEventListener("click", () => { dl.type = v; editor(); });
      return b;
    }));
    const dlInput = dl.type === "date"
      ? el("input", { type: "date", class: "gx-field gx-date", value: dl.date, "aria-label": "Deadline date" })
      : el("span", { class: "gx-rounds" }, [el("input", { type: "number", min: 1, max: 200, class: "gx-field gx-num", value: dl.rounds, "aria-label": "Deadline in rounds" }), "rounds"]);
    (dlInput.tagName === "INPUT" ? dlInput : dlInput.querySelector("input")).addEventListener("change", (e) => { if (dl.type === "date") dl.date = e.target.value; else dl.rounds = Math.max(1, Math.round(Number(e.target.value) || 10)); });
    const save = el("button", { type: "button", class: "gx-btn" }, "Save Goals");
    const cancel = Object.keys(saved()).length ? el("button", { type: "button", class: "gx-link" }, "Cancel") : null;
    cancel?.addEventListener("click", () => { editing = false; draft = {}; draw(); });
    save.addEventListener("click", async () => {
      const out = {};
      for (const [k, g] of Object.entries(draft)) {
        const s = levels.find((x) => x.key === k); if (!s) continue;
        out[k] = { value: r2(g.value), start: r2(s.now), label: s.label, setAt: new Date().toISOString().slice(0, 10) };
        if (saved()[k]?.start != null) { out[k].start = saved()[k].start; out[k].setAt = saved()[k].setAt || out[k].setAt; }
      }
      if (!Object.keys(out).length) { flash("Turn on at least one goal.", "error"); return; }
      const prev = deadlineOf(goals);
      const deadline = dl.type === "rounds" ? { type: "rounds", rounds: dl.rounds, startRounds: prev?.type === "rounds" && prev.rounds === dl.rounds ? prev.startRounds : nRounds }
        : dl.date ? { type: "date", date: dl.date } : null;
      save.disabled = true;
      try { await saveGoals(playerKey, out, deadline, state.user.uid); editing = false; goals = { skills: out, deadline }; draw(); flash("Goals saved.", "ok"); }
      catch (err) { console.error(err); flash("Couldn't save the goals. Try again.", "error"); save.disabled = false; }
    });
    const totalOpen = !folded.has("TOTAL");
    const blocks = [];
    if (total) blocks.push(el("section", { class: "gx-group gx-total" }, dialCard(total, cats.length ? totalOpen : null, "Categories")));
    if (total && totalOpen && cats.length) {
      blocks.push(el("div", { class: "gx-dialgrid" }, cats.map((c) => dialCard(c, skillsOf(c.cat).length ? !folded.has(c.key) : null, "Skills"))));
      for (const c of cats) {
        const sk = skillsOf(c.cat);
        if (!sk.length || folded.has(c.key)) continue;
        blocks.push(el("p", { class: "gx-section" }, `${c.label} \u00b7 by distance`), el("section", { class: "gx-group" }, sk.map((x) => row(x, null))));
      }
    }
    mount(container, el("div", { class: "gx" }, [
      el("header", { class: "gx-head" }, [
        el("div", {}, [el("p", { class: "gx-eyebrow" }, "Goals"), el("h1", { class: "gx-title" }, whose === "My" ? "Set my goals" : label),
          el("p", { class: "gx-sub" }, `Each dial and slider runs from the worst to the best ${win()}-round average; the gold tick is now. Drag to set a goal, or type it.`)]),
      ]),
      el("section", { class: "gx-group" }, [el("div", { class: "gx-row gx-dlrow" }, [el("span", { class: "gx-row-label" }, "Deadline"), seg, dlInput])]),
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
    const fold = open === null ? null : el("button", { type: "button", class: `gx-more${open ? " open" : ""}`, "aria-expanded": open ? "true" : "false" }, [open ? `Hide ${kidsName.toLowerCase()}` : `${kidsName}`, el("span", { "aria-hidden": "true" }, " \u203A")]);
    fold?.addEventListener("click", () => { if (folded.has(s.key)) folded.delete(s.key); else folded.add(s.key); editor(); });
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
        el("div", { class: "gx-track" }, [slider, el("span", { class: "gx-tick", style: `left:calc(${frac * 100}% + ${((0.5 - frac) * 22).toFixed(1)}px)`, title: "Now" })]),
        el("label", { class: "gx-box" }, [el("span", {}, "Goal"), goalIn]),
        el("label", { class: "gx-box" }, [el("span", {}, "SG Change"), deltaIn]),
      ]),
    ]);
    return wrap;
  }

  return { destroy() { alive = false; unsub(); } };
}
