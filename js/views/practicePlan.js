/*
 * Practice › Plan (update 342): the drills added from Stats, ready to go. Tap Start and it's set up: one tap per
 * attempt (type the feet for approach shots), a clock running, and sets repeated until the challenge is met. Each
 * session keeps how long it took and how many sets it needed; the plan card shows the last one and the best set.
 */
import { el, mount, confirmAction } from "../ui.js";
import { listPlan, deletePlanItem, savePlanItem, practiceOpen, isMine, goalText, goalSource, setScore, setMet, bestOf, activeSecs, mmss, nounOf } from "../practice/plan.js";
import { parseDrillSpeech } from "../practice/voiceParse.js";

/* (update 359) Voice: the phone's own speech recognition (free, the same as Enter New Round). Turn it on once and it keeps
 * listening through every shot and set until it's turned off (remembered on this device). Where the browser has none,
 * a box to type in (or use the keyboard's own 🎤). */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LS_VOICE = "ta.drillVoice";
const voice = { on: (() => { try { return localStorage.getItem(LS_VOICE) === "1"; } catch { return false; } })(), rec: null, handler: null, heard: "", did: "" };
function listen() {
  if (!SR || voice.rec || !voice.on || !voice.handler) return;
  const rec = new SR();
  rec.lang = navigator.language || "en-US"; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 1;
  rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) voice.handler?.(e.results[i][0].transcript); };
  rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { voice.on = false; voice.did = "Microphone access is blocked: allow it for this site in the browser\u2019s settings."; voice.handler?.(null); } };
  rec.onend = () => { voice.rec = null; if (voice.on && voice.handler) setTimeout(listen, 300); }; // (phones stop after a pause: start again)
  try { rec.start(); voice.rec = rec; } catch { /* already going */ }
}
function quiet() { const r = voice.rec; voice.rec = null; try { r?.abort?.(); } catch { /* */ } }
function setVoice(on) { voice.on = on; voice.heard = ""; voice.did = ""; try { localStorage.setItem(LS_VOICE, on ? "1" : "0"); } catch { /* */ } if (on) listen(); else quiet(); }
/** The Voice switch and what it heard (or, with no speech recognition, a box to type in). */
function voiceBar(redraw, onText, hint) {
  if (!SR) {
    const box = el("input", { type: "text", class: "dp-voice-type", placeholder: hint, "aria-label": "Type what happened", enterkeyhint: "done" });
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && box.value.trim()) { e.preventDefault(); onText(box.value); } });
    return el("div", { class: "dp-voice" }, [box, voice.heard ? el("p", { class: "muted small dp-voice-status" }, [`\u201c${voice.heard}\u201d`, voice.did ? ` \u2192 ${voice.did}` : ""]) : null]);
  }
  const b = el("button", { type: "button", class: `dp-voice-btn${voice.on ? " on" : ""}`, "aria-pressed": String(voice.on) }, voice.on ? "\u{1F399}\uFE0F Voice on" : "\u{1F399}\uFE0F Voice");
  b.addEventListener("click", () => { setVoice(!voice.on); redraw(); });
  const status = voice.on ? el("p", { class: "muted small dp-voice-status" }, voice.heard ? [`Heard \u201c${voice.heard}\u201d`, voice.did ? ` \u2192 ${voice.did}` : ""] : `Listening\u2026 ${hint}`)
    : voice.did ? el("p", { class: "muted small dp-voice-status" }, voice.did) : null;
  return el("div", { class: "dp-voice" }, [b, status]);
}

let plan = null, planOwnerKey = null; // loaded once a visit (per owner)
let tick = null;                      // the running clock
const stopClock = () => { if (tick) { clearInterval(tick); tick = null; } };
const fmtDay = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
// (update 447) a number drill can be feet from the hole (lower is better) or yards of carry (d.unit "yds", d.higher)
const unitOf = (d) => (d.kind === "prox" ? ` ${d.unit || "ft"}` : ` of ${d.reps}`);
// (update 349) a session is as many sets as you like (Redo after each); the aim is 3 sets that meet the goal
const SETS_AIM = 3;
const aimOf = (d) => Math.max(1, Math.round(Number(d?.setsAim) || SETS_AIM)); // (update 371: set per drill when it's added)
const metOf = (s) => s.metCount ?? (s.sets || []).filter((x) => x.met).length;
const triedOf = (s) => s.tried ?? (s.sets || []).length;
const tally = (s) => `${metOf(s)} of ${triedOf(s)} ${triedOf(s) === 1 ? "set" : "sets"} met`;
const scoreText = (d, v) => (v == null ? "—" : `${v}${unitOf(d)}`);

export async function render(ctx) {
  stopClock();
  if (ctx.view.name !== "drill") { voice.handler = null; quiet(); } // (voice is for the drill screens only)
  const v = ctx.view;
  if (v.name === "drill") return drawDrill(ctx, v.session);
  if (v.name === "drillDone") return drawDone(ctx, v.session);
  if (!plan || planOwnerKey !== ctx.owner) {
    mount(ctx.body, el("p", { class: "muted pr-loading ta-loading" }, "Loading your plan…"));
    plan = await listPlan(ctx.owner); planOwnerKey = ctx.owner;
    // (update 371) your plan is only drills from your own stats: ones added earlier from another player's stats move to
    // that player's plan (once)
    if (!ctx.readOnly && practiceOpen()) {
      const away = plan.filter((d) => d.playerKey && !isMine(d.playerKey) && d.playerKey !== ctx.playerKey);
      for (const d of away) {
        try { await savePlanItem(d.playerKey, { ...d, sentBy: d.sentBy || { uid: ctx.uid || null, name: "Callaway" } }); await deletePlanItem(ctx.owner, d.id); plan = plan.filter((x) => x.id !== d.id); }
        catch (err) { console.error(err); break; }
      }
    }
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
  const canEdit = !ro || practiceOpen(ctx.playerKey); // (update 371: whoever can send this player drills can take one out)
  const card = (d) => {
    const ss = drillSessions(ctx, d), done = ss.filter((s) => s.status === "done").sort((a, b) => String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt)));
    const live = ss.find((s) => s.status === "active"), last = done[0], best = bestOf(d, ctx.sessions);
    const src = goalSource(d);
    const lastTxt = last ? `Last: ${tally(last)} \u00b7 ${mmss(last.secs || 0)} \u00b7 ${fmtDay(last.endedAt || last.startedAt)}` : "Not tried yet";
    const go = el("button", { type: "button", class: "btn dp-start" }, live ? `▶  Resume (set ${live.sets.length})` : "▶  Start");
    go.addEventListener("click", () => start(ctx, d));
    const del = el("button", { type: "button", class: "entry-del dp-del", "aria-label": "Take this drill out of the plan", title: "Take out of the plan" }, "✕");
    del.addEventListener("click", async () => {
      if (!confirmAction(ro ? `Take this drill out of ${ctx.viewing}\u2019s plan? Their sessions stay in their history.` : "Take this drill out of your plan? Its sessions stay in your history.")) return;
      try { await deletePlanItem(ctx.owner, d.id); plan = plan.filter((x) => x.id !== d.id); drawHome(ctx); } catch (err) { console.error(err); ctx.flash?.("Couldn’t take it out just now.", "error"); }
    });
    return el("article", { class: "dp-card" }, [
      el("div", { class: "dp-card-top" }, [el("h3", { class: "dp-title" }, d.title), canEdit ? del : null]),
      d.sentBy?.name ? el("p", { class: "muted small dp-from" }, `From ${d.sentBy.name}`) : null,
      el("p", { class: "dp-goal" }, [el("strong", {}, goalText(d, best)), src ? el("span", { class: "muted" }, ` · ${src}`) : null]),
      el("p", { class: "muted small dp-what" }, `${d.what}. ${d.reps} ${nounOf(d)} a set, ${d.kind === "prox" ? (d.higher ? "typing how far each one goes" : "typing how far each one finishes") : "one tap each"}; aim for ${aimOf(d)} ${aimOf(d) === 1 ? "set" : "sets"} that meet the goal.`),
      d.goalText ? el("p", { class: "small dp-round-goal" }, `Added goal: ${d.goalText}`) : null,
      el("p", { class: "muted small dp-last" }, [lastTxt, best != null ? ` · best set ${scoreText(d, best)}` : "", done.length > 1 ? ` · ${done.length} sessions` : ""]),
      ro ? null : go,
    ]);
  };
  const hist = ctx.sessions.filter((s) => s.mode === "drill" && s.status === "done").sort((a, b) => String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt))).slice(0, 12);
  mount(ctx.body, el("div", { class: "dp" }, [
    el("div", { class: "dp-head" }, [el("h2", {}, ro ? `${ctx.viewing}’s practice plan` : "Your practice plan"),
      el("p", { class: "muted small" }, `Drills added from Stats (Path to…). Each set is a challenge: meet the goal in the number of sets each drill asks for, and redo sets as often as you like. The sets you try, the sets you meet and your time are kept.`)]),
    plan.length ? el("div", { class: "dp-list" }, plan.map(card))
      : el("p", { class: "empty dp-empty" }, ro ? `Nothing in ${ctx.viewing}\u2019s plan yet.` : "Nothing in the plan yet. In Stats, open Path to… and tap a distance, then “Add to practice plan”."),
    hist.length ? el("h3", { class: "dp-hist-h" }, "Recent drill sessions") : null,
    hist.length ? el("ul", { class: "dp-hist" }, hist.map((s) => {
      const d = s.drill || {};
      const row = el("li", { class: "dp-hist-row" }, [el("span", {}, [el("strong", {}, d.title || "Drill"), el("span", { class: "muted" }, ` · ${fmtDay(s.endedAt || s.startedAt)}`)]),
        el("span", { class: metOf(s) >= aimOf(s.drill) ? "pos" : "muted" }, `${tally(s)} \u00b7 ${mmss(s.secs || 0)}`)]);
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
  // (update 359) what was said: a whole set ("made 8 of 10"), one shot after another ("made the first", "missed"), or undo
  const shotName = (nounOf(d).replace(/s$/, "") || "shot").replace(/^\w/, (c) => c.toUpperCase());
  const valName = (v) => (d.kind === "prox" ? `${v} ${d.unit || "ft"}` : (d.tap || ["Yes", "No"])[v ? 0 : 1]);
  const apply = (text) => {
    if (text == null) { drawDrill(ctx, s); return; }
    const r = parseDrillSpeech(text, { kind: d.kind, reps: d.reps });
    voice.heard = String(text).trim(); voice.did = "";
    const now = new Date().toISOString();
    if (r.cmd === "undo") { if (set.marks.length) { set.marks.pop(); voice.did = "took back the last one"; } }
    else if (r.cmd === "finish") { endSession(ctx, s); return; }
    else if (r.summary) {
      if (d.kind === "prox") {
        const have = set.marks.reduce((t, m) => t + Number(m.v || 0), 0), left = d.reps - set.marks.length;
        const each = left ? Math.max(0, Math.round(((r.summary.avg * d.reps - have) / left) * 10) / 10) : 0;
        for (let k = 0; k < left; k++) set.marks.push({ v: each, at: now });
        voice.did = `set averaged ${r.summary.avg} ft`;
      } else {
        set.marks = Array.from({ length: d.reps }, (_, k) => ({ v: k < r.summary.made ? 1 : 0, at: now, said: true }));
        voice.did = `${r.summary.made} of ${d.reps}`;
      }
    } else if (r.events.length) {
      const done = [];
      for (const ev of r.events) {
        const i = ev.i != null && ev.i < set.marks.length ? ev.i : set.marks.length; // (an earlier one: a correction)
        if (i >= d.reps) continue;
        if (i < set.marks.length) set.marks[i] = { v: ev.v, at: now }; else set.marks.push({ v: ev.v, at: now });
        done.push(`${shotName} ${i + 1}: ${valName(ev.v)}`);
      }
      voice.did = done.join(", ");
    } else voice.did = "nothing to fill in";
    if (set.marks.length >= d.reps) { set.marks = set.marks.slice(0, d.reps); return finishSet(ctx, s); }
    ctx.save(s); drawDrill(ctx, s);
  };
  voice.handler = apply; listen();
  const hint = d.kind === "prox" && d.higher ? "Say \u201c275 yards\u201d or \u201caveraged 280\u201d." : d.kind === "prox" ? "Say \u201c12 feet\u201d, \u201cthe third one was 30 feet\u201d, \u201choled it\u201d or \u201caveraged 18 feet\u201d." : `Say \u201c${(d.tap || ["made"])[0].toLowerCase()} the first\u201d, \u201c${(d.tap || ["", "missed"])[1].toLowerCase()}\u201d, or \u201c8 of 10\u201d for the whole set.`;
  const undo = el("button", { type: "button", class: "link dp-undo", disabled: !n }, "Undo last");
  undo.addEventListener("click", () => { set.marks.pop(); ctx.save(s); drawDrill(ctx, s); });
  const stop = el("button", { type: "button", class: "link dp-stop" }, "Finish");
  stop.addEventListener("click", () => { if (n && !confirmAction("Finish now? This set won’t count.")) return; if (n) set.marks = []; endSession(ctx, s); });
  // the input: two big buttons, or the feet for an approach shot
  let input;
  if (d.kind === "prox") {
    const U = d.unit || "ft";
    const box = el("input", { type: "number", inputmode: "decimal", min: "0", step: d.higher ? "1" : "0.5", class: "dp-ft", placeholder: U, "aria-label": d.higher ? "Distance in yards" : "Feet from the hole" });
    const next = el("button", { type: "button", class: "btn dp-next" }, "Next");
    const go = () => { const ft = Number(box.value); if (!(ft >= 0) || box.value === "") { box.focus(); return; } record(Math.round(ft * 10) / 10); };
    next.addEventListener("click", go);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    input = el("div", { class: "dp-prox" }, [el("label", { class: "dp-prox-q" }, d.higher ? "How far did it go?" : "How far from the hole?"), el("div", { class: "dp-prox-row" }, [box, el("span", { class: "dp-ft-u" }, U), next])]);
    if (!voice.on) setTimeout(() => box.focus(), 0); // (talking: no keyboard popping up)
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
      el("div", {}, [el("span", { class: "muted small" }, d.kind === "prox" ? "Average" : "So far"), el("strong", {}, score == null ? "—" : d.kind === "prox" ? `${score} ${d.unit || "ft"}` : String(score))]),
    ]),
    needTxt ? el("p", { class: "muted small dp-need" }, needTxt) : null,
    input,
    el("div", { class: "dp-dots", "aria-label": "This set" }, Array.from({ length: d.reps }, (_, i) => {
      const m = set.marks[i];
      return el("span", { class: `dp-dot${m == null ? "" : d.kind === "prox" ? " ft" : m.v ? " yes" : " no"}` }, m == null ? "" : d.kind === "prox" ? String(m.v) : m.v ? "✓" : "✕");
    })),
    voiceBar(() => drawDrill(ctx, s), apply, hint),
    el("div", { class: "dp-play-foot" }, [undo, stop]),
    s.sets.length > 1 ? el("p", { class: "muted small dp-prev" }, `Earlier sets: ${s.sets.slice(0, -1).map((x) => `${scoreText(d, x.score)}${x.met ? " \u2713" : ""}`).join(", ")} \u00b7 ${metOf({ sets: s.sets.slice(0, -1) })} of ${s.sets.length - 1} met`) : null,
  ]));
}

function finishSet(ctx, s) {
  const d = s.drill, set = s.sets.at(-1);
  set.score = setScore(d, set.marks);
  // beat your best, with nothing to beat yet: this first set sets the mark, and later sets have to beat it
  const marking = d.goal == null && s.best == null;
  set.met = marking ? false : setMet(d, set.score, s.best ?? null); // (the mark itself isn't a met set)
  if (marking) { set.mark = true; s.best = set.score; }
  ctx.save(s, true);
  stopClock();
  const met = metOf(s), tried = s.sets.length, reached = met >= aimOf(d);
  const redo = el("button", { type: "button", class: `btn ${reached ? "ghost " : ""}dp-again` }, "\u21BB  Redo");
  redo.addEventListener("click", () => { s.sets.push({ marks: [] }); ctx.save(s); drawDrill(ctx, s); });
  const fin = el("button", { type: "button", class: reached ? "btn dp-again" : "link" }, "Finish");
  fin.addEventListener("click", () => endSession(ctx, s));
  // (update 359) voice on the set's end: "redo" / "next set", "finish", or just carry on with the next set\u2019s shots
  voice.handler = (t) => {
    if (t == null) return;
    const r = parseDrillSpeech(t, { kind: d.kind, reps: d.reps });
    if (r.cmd === "finish") { voice.heard = ""; endSession(ctx, s); return; }
    if (r.cmd === "redo" || r.events.length || r.summary) {
      s.sets.push({ marks: [] }); ctx.save(s); voice.heard = String(t).trim();
      drawDrill(ctx, s);
      if (!r.cmd) voice.handler?.(t); // (the shots said go into the new set)
    }
  };
  listen();
  const goal = d.goal ?? s.best;
  const verdict = set.mark ? `Mark set: ${scoreText(d, set.score)}. From here on, beat it.` : set.met ? "Goal met \u2713" : `Not this time. ${d.kind === "prox" ? (d.higher ? `The goal is an average of ${goal} ${d.unit || "yds"} or more.` : `The goal is an average inside ${goal} ft.`) : d.goal != null ? `The goal is ${goal}${unitOf(d)}.` : `Your best is ${goal}${unitOf(d)}: beat it.`}`;
  mount(ctx.body, el("div", { class: "dp dp-play dp-setend" }, [
    el("h2", { class: "dp-title" }, d.title),
    el("p", { class: `dp-big${set.met ? " pos" : ""}` }, `Set ${tried}: ${scoreText(d, set.score)}`),
    el("p", {}, verdict),
    el("p", { class: "muted" }, `${met} of ${tried} ${tried === 1 ? "set" : "sets"} met so far (aim: ${aimOf(d)}) \u00b7 ${mmss(activeSecs(s))}.${reached ? ` That\u2019s ${aimOf(d)}: finish, or keep going.` : ""}`),
    el("div", { class: "dp-setend-btns" }, reached ? [fin, redo] : [redo, fin]),
    SR && voice.on ? el("p", { class: "muted small dp-voice-status" }, "\u{1F399}\uFE0F Say \u201credo\u201d (or just start the next set\u2019s shots), or \u201cfinish\u201d.") : null,
  ]));
}

function endSession(ctx, s) {
  stopClock();
  voice.handler = null; quiet();
  s.sets = s.sets.filter((x) => x.marks.length === s.drill.reps);
  s.status = "done"; s.endedAt = new Date().toISOString(); s.secs = activeSecs(s);
  s.tried = s.sets.length; s.metCount = s.sets.filter((x) => x.met).length;
  s.metIn = (s.sets.findIndex((x) => x.met) + 1) || null; s.markSet = s.sets.some((x) => x.mark);
  s.balls = s.sets.length * s.drill.reps;
  if (!s.sets.length) { ctx.remove(s.id).then(() => ctx.home()); return; } // (nothing played: no session)
  ctx.save(s, true);
  ctx.go({ name: "drillDone", session: s });
}

function drawDone(ctx, s) {
  const d = s.drill;
  const met = metOf(s), tried = triedOf(s);
  const back = el("button", { type: "button", class: "btn dp-again" }, "Back to the plan");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, el("div", { class: "dp dp-play dp-done" }, [
    el("h2", { class: "dp-title" }, d.title),
    el("p", { class: `dp-big${met >= aimOf(d) ? " pos" : ""}` }, `${met} of ${tried} ${tried === 1 ? "set" : "sets"} met${met >= aimOf(d) ? " \u2713" : ""}`),
    el("div", { class: "dp-stat" }, [
      el("div", {}, [el("span", { class: "muted small" }, "Time"), el("strong", {}, mmss(s.secs || 0))]),
      el("div", {}, [el("span", { class: "muted small" }, "Met"), el("strong", {}, `${met} / ${tried}`)]),
      el("div", {}, [el("span", { class: "muted small" }, "Balls"), el("strong", {}, String(s.balls || 0))]),
    ]),
    el("p", { class: "muted small" }, `Sets: ${s.sets.map((x) => `${scoreText(d, x.score)}${x.mark ? " (mark)" : x.met ? " \u2713" : ""}`).join(", ")}.${met < aimOf(d) ? ` Aim for ${aimOf(d)} met ${aimOf(d) === 1 ? "set" : "sets"} next time.` : ""}`),
    d.goalText ? el("p", { class: "small dp-round-goal" }, `Now take it to the course: ${d.goalText} (in Goals).`) : null,
    back,
  ]));
}
