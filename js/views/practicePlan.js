/*
 * Practice › Plan (update 342): the drills added from Stats, ready to go. Tap Start and it's set up: one tap per
 * attempt (type the feet for approach shots), a clock running, and sets repeated until the challenge is met. Each
 * session keeps how long it took and how many sets it needed; the plan card shows the last one and the best set.
 */
import { el, mount, confirmAction } from "../ui.js";
import { listPlan, deletePlanItem, goalText, goalSource, setScore, setMet, bestOf, activeSecs, mmss, nounOf } from "../practice/plan.js";

let plan = null, planOwnerKey = null; // loaded once a visit (per owner)
let tick = null;                      // the running clock
const stopClock = () => { if (tick) { clearInterval(tick); tick = null; } };
const fmtDay = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const unitOf = (d) => (d.kind === "prox" ? " ft" : ` of ${d.reps}`);
const scoreText = (d, v) => (v == null ? "—" : `${v}${unitOf(d)}`);

export async function render(ctx) {
  stopClock();
  const v = ctx.view;
  if (v.name === "drill") return drawDrill(ctx, v.session);
  if (v.name === "drillDone") return drawDone(ctx, v.session);
  if (!plan || planOwnerKey !== ctx.owner) {
    mount(ctx.body, el("p", { class: "muted pr-loading ta-loading" }, "Loading your plan…"));
    plan = await listPlan(ctx.owner); planOwnerKey = ctx.owner;
    if (ctx.view.name !== "home") return;
  }
  drawHome(ctx);
}

const drillSessions = (ctx, d) => ctx.sessions.filter((s) => s.mode === "drill" && s.drillId === d.id);

function start(ctx, d) {
  const live = drillSessions(ctx, d).find((s) => s.status === "active");
  if (live) { ctx.go({ name: "drill", session: live }); return; }
  const s = { id: ctx.newId(), mode: "drill", drillId: d.id, drill: { ...d }, best: bestOf(d, ctx.sessions), status: "active", startedAt: new Date().toISOString(), sets: [{ marks: [] }], playerKey: ctx.playerKey || null, playerLabel: ctx.label || "" };
  ctx.add(s); ctx.save(s, true);
  ctx.go({ name: "drill", session: s });
}

/* ---------------- the plan ---------------- */
function drawHome(ctx) {
  const ro = ctx.readOnly;
  const card = (d) => {
    const ss = drillSessions(ctx, d), done = ss.filter((s) => s.status === "done").sort((a, b) => String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt)));
    const live = ss.find((s) => s.status === "active"), last = done[0], best = bestOf(d, ctx.sessions);
    const src = goalSource(d);
    const lastTxt = last ? (last.markSet ? `Last: set the mark, ${scoreText(d, last.sets?.[0]?.score)} \u00b7 ${fmtDay(last.endedAt || last.startedAt)}` : last.metIn ? `Last: met on set ${last.metIn} · ${mmss(last.secs || 0)} · ${fmtDay(last.endedAt || last.startedAt)}` : `Last: not met in ${last.sets?.filter((x) => x.score != null).length || 0} ${last.sets?.length === 1 ? "set" : "sets"} · ${mmss(last.secs || 0)} · ${fmtDay(last.endedAt || last.startedAt)}`) : "Not tried yet";
    const go = el("button", { type: "button", class: "btn dp-start" }, live ? `▶  Resume (set ${live.sets.length})` : "▶  Start");
    go.addEventListener("click", () => start(ctx, d));
    const del = el("button", { type: "button", class: "entry-del dp-del", "aria-label": "Take this drill out of the plan", title: "Take out of the plan" }, "✕");
    del.addEventListener("click", async () => {
      if (!confirmAction("Take this drill out of your plan? Its sessions stay in your history.")) return;
      try { await deletePlanItem(ctx.owner, d.id); plan = plan.filter((x) => x.id !== d.id); drawHome(ctx); } catch (err) { console.error(err); ctx.flash?.("Couldn’t take it out just now.", "error"); }
    });
    return el("article", { class: "dp-card" }, [
      el("div", { class: "dp-card-top" }, [el("h3", { class: "dp-title" }, d.title), ro ? null : del]),
      el("p", { class: "dp-goal" }, [el("strong", {}, goalText(d, best)), src ? el("span", { class: "muted" }, ` · ${src}`) : null]),
      el("p", { class: "muted small dp-what" }, `${d.what}. ${d.reps} ${nounOf(d)}, ${d.kind === "prox" ? "typing how far each one finishes" : "one tap each"}; repeat sets until you meet it.`),
      d.goalText ? el("p", { class: "small dp-round-goal" }, `In rounds: ${d.goalText}`) : null,
      el("p", { class: "muted small dp-last" }, [lastTxt, best != null ? ` · best set ${scoreText(d, best)}` : "", done.length > 1 ? ` · ${done.length} sessions` : ""]),
      ro ? null : go,
    ]);
  };
  const hist = ctx.sessions.filter((s) => s.mode === "drill" && s.status === "done").sort((a, b) => String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt))).slice(0, 12);
  mount(ctx.body, el("div", { class: "dp" }, [
    el("div", { class: "dp-head" }, [el("h2", {}, ro ? `${ctx.viewing}’s practice plan` : "Your practice plan"),
      el("p", { class: "muted small" }, "Drills added from Stats (Path back to Elite). Each one is a challenge: repeat sets until you meet it. Your time and the sets it took are kept.")]),
    plan.length ? el("div", { class: "dp-list" }, plan.map(card))
      : el("p", { class: "empty dp-empty" }, "Nothing in the plan yet. In Stats, tap an Elite Round Share box, then “Add to practice plan” under Path back to Elite."),
    hist.length ? el("h3", { class: "dp-hist-h" }, "Recent drill sessions") : null,
    hist.length ? el("ul", { class: "dp-hist" }, hist.map((s) => {
      const d = s.drill || {};
      const row = el("li", { class: "dp-hist-row" }, [el("span", {}, [el("strong", {}, d.title || "Drill"), el("span", { class: "muted" }, ` · ${fmtDay(s.endedAt || s.startedAt)}`)]),
        el("span", { class: s.metIn ? "pos" : "muted" }, s.markSet ? `Mark set \u00b7 ${mmss(s.secs || 0)}` : s.metIn ? `Met on set ${s.metIn} · ${mmss(s.secs || 0)}` : `Not met · ${mmss(s.secs || 0)}`)]);
      return ctx.rowWithDelete(row, s, "drill session");
    })) : null,
  ]));
}

/* ---------------- playing a drill ---------------- */
function drawDrill(ctx, s) {
  const d = s.drill, set = s.sets.at(-1), n = set.marks.length;
  const best = s.best ?? null;
  const score = setScore(d, set.marks);
  const back = el("button", { type: "button", class: "link dp-back" }, "‹ Plan");
  back.addEventListener("click", () => { stopClock(); ctx.home(); });
  const clock = el("span", { class: "dp-clock", "aria-label": "Time" }, mmss(activeSecs(s, Date.now())));
  tick = setInterval(() => { if (!clock.isConnected) { stopClock(); return; } clock.textContent = mmss(activeSecs(s, Date.now())); }, 1000);
  const record = (v) => {
    set.marks.push({ v, at: new Date().toISOString() });
    if (set.marks.length >= d.reps) return finishSet(ctx, s);
    ctx.save(s); drawDrill(ctx, s);
  };
  const undo = el("button", { type: "button", class: "link dp-undo", disabled: !n }, "Undo last");
  undo.addEventListener("click", () => { set.marks.pop(); ctx.save(s); drawDrill(ctx, s); });
  const stop = el("button", { type: "button", class: "link dp-stop" }, "Stop for today");
  stop.addEventListener("click", () => { if (n && !confirmAction("Stop now? This set won’t count.")) return; if (n) set.marks = []; endSession(ctx, s, null); });
  // the input: two big buttons, or the feet for an approach shot
  let input;
  if (d.kind === "prox") {
    const box = el("input", { type: "number", inputmode: "decimal", min: "0", step: "0.5", class: "dp-ft", placeholder: "ft", "aria-label": "Feet from the hole" });
    const next = el("button", { type: "button", class: "btn dp-next" }, "Next");
    const go = () => { const ft = Number(box.value); if (!(ft >= 0) || box.value === "") { box.focus(); return; } record(Math.round(ft * 10) / 10); };
    next.addEventListener("click", go);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    input = el("div", { class: "dp-prox" }, [el("label", { class: "dp-prox-q" }, "How far from the hole?"), el("div", { class: "dp-prox-row" }, [box, el("span", { class: "dp-ft-u" }, "ft"), next])]);
    setTimeout(() => box.focus(), 0);
  } else {
    const [yes, no] = d.tap || ["Yes", "No"];
    const by = el("button", { type: "button", class: "dp-tap yes" }, yes), bn = el("button", { type: "button", class: "dp-tap no" }, no);
    by.addEventListener("click", () => record(1)); bn.addEventListener("click", () => record(0));
    input = el("div", { class: "dp-taps" }, [by, bn]);
  }
  const goal = d.goal ?? best;
  const left = d.reps - n;
  const need = d.kind === "prox" || goal == null ? null : d.goal != null ? goal - (score || 0) : goal + 1 - (score || 0);
  const needTxt = need == null ? null : need <= 0 ? "Goal reached: finish the set" : need > left ? "Out of reach this set: finish it and go again" : `${need} more from the last ${left}`;
  mount(ctx.body, el("div", { class: "dp dp-play" }, [
    el("div", { class: "dp-play-top" }, [back, clock]),
    el("h2", { class: "dp-title" }, d.title),
    el("p", { class: "dp-goal" }, [el("strong", {}, goalText(d, best)), goalSource(d) ? el("span", { class: "muted" }, ` · ${goalSource(d)}`) : null]),
    el("div", { class: "dp-stat" }, [
      el("div", {}, [el("span", { class: "muted small" }, "Set"), el("strong", {}, String(s.sets.length))]),
      el("div", {}, [el("span", { class: "muted small" }, "Ball"), el("strong", {}, `${Math.min(n + 1, d.reps)} of ${d.reps}`)]),
      el("div", {}, [el("span", { class: "muted small" }, d.kind === "prox" ? "Average" : "So far"), el("strong", {}, score == null ? "—" : d.kind === "prox" ? `${score} ft` : String(score))]),
    ]),
    needTxt ? el("p", { class: "muted small dp-need" }, needTxt) : null,
    input,
    el("div", { class: "dp-dots", "aria-label": "This set" }, Array.from({ length: d.reps }, (_, i) => {
      const m = set.marks[i];
      return el("span", { class: `pp-dot${m == null ? "" : d.kind === "prox" ? " ft" : m.v ? " yes" : " no"}` }, m == null ? "" : d.kind === "prox" ? String(m.v) : m.v ? "✓" : "✕");
    })),
    el("div", { class: "dp-play-foot" }, [undo, stop]),
    s.sets.length > 1 ? el("p", { class: "muted small dp-prev" }, `Earlier sets: ${s.sets.slice(0, -1).map((x) => scoreText(d, x.score)).join(", ")}`) : null,
  ]));
}

function finishSet(ctx, s) {
  const d = s.drill, set = s.sets.at(-1);
  set.score = setScore(d, set.marks);
  set.met = setMet(d, set.score, s.best ?? null);
  if (set.met) return endSession(ctx, s, s.sets.length);
  ctx.save(s, true);
  stopClock();
  const again = el("button", { type: "button", class: "btn dp-again" }, "▶  Next set");
  again.addEventListener("click", () => { s.sets.push({ marks: [] }); ctx.save(s); drawDrill(ctx, s); });
  const stop = el("button", { type: "button", class: "link" }, "Stop for today");
  stop.addEventListener("click", () => endSession(ctx, s, null));
  const goal = d.goal ?? s.best;
  mount(ctx.body, el("div", { class: "dp dp-play dp-setend" }, [
    el("h2", { class: "dp-title" }, d.title),
    el("p", { class: "dp-big" }, `Set ${s.sets.length}: ${scoreText(d, set.score)}`),
    el("p", { class: "muted" }, `Not yet. ${d.kind === "prox" ? `The goal is an average inside ${goal} ft.` : d.goal != null ? `The goal is ${goal}${unitOf(d)}.` : `Your best is ${goal}${unitOf(d)}: beat it.`} ${mmss(activeSecs(s))} so far.`),
    el("div", { class: "dp-setend-btns" }, [again, stop]),
  ]));
}

function endSession(ctx, s, metIn) {
  stopClock();
  s.sets = s.sets.filter((x) => x.marks.length === s.drill.reps);
  s.status = "done"; s.metIn = metIn; s.markSet = !!metIn && s.drill.goal == null && s.best == null; s.endedAt = new Date().toISOString(); s.secs = activeSecs(s);
  s.balls = s.sets.length * s.drill.reps;
  if (!s.sets.length) { ctx.remove(s.id).then(() => ctx.home()); return; } // (nothing played: no session)
  ctx.save(s, true);
  ctx.go({ name: "drillDone", session: s });
}

function drawDone(ctx, s) {
  const d = s.drill;
  const first = d.goal == null && s.best == null;
  const back = el("button", { type: "button", class: "btn dp-again" }, "Back to the plan");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, el("div", { class: "dp dp-play dp-done" }, [
    el("h2", { class: "dp-title" }, d.title),
    el("p", { class: `pp-big${s.metIn ? " pos" : ""}` }, s.metIn ? (first ? "Mark set" : `Challenge met on set ${s.metIn}`) : "Not met today"),
    el("div", { class: "dp-stat" }, [
      el("div", {}, [el("span", { class: "muted small" }, "Time"), el("strong", {}, mmss(s.secs || 0))]),
      el("div", {}, [el("span", { class: "muted small" }, "Sets"), el("strong", {}, String(s.sets.length))]),
      el("div", {}, [el("span", { class: "muted small" }, "Balls"), el("strong", {}, String(s.balls || 0))]),
    ]),
    el("p", { class: "muted small" }, `Sets: ${s.sets.map((x) => scoreText(d, x.score)).join(", ")}.${first ? ` Next time, beat ${scoreText(d, s.sets[0].score)}.` : ""}`),
    d.goalText ? el("p", { class: "small dp-round-goal" }, `Now take it to the course: ${d.goalText} (in Goals).`) : null,
    back,
  ]));
}
