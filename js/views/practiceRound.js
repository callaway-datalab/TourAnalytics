/*
 * Practice › Sim Round and Course Prep (update 138), and the play-it-out games (Up & Down 9).
 *
 *   Sim Round:   18 (or 9) made-up holes, played shot by shot from wherever the last one finished.
 *   Course Prep: the same, on a real course's pars and yards — from a scorecard you've saved in Track Round, one of
 *                your rounds there, or one you type in — with the choice of all of it, a nine, the par 3s or 5s, or
 *                the holes you play worst there.
 *   At the end:  score, strokes gained by category (Off the Tee, Approach, Around the Green, Putting), fairways,
 *                greens, putts, scrambling, the scorecard, and your best and worst shots.
 */
import { el, mount, confirmAction } from "../ui.js";
import { CATS, scoreShot } from "../practice/model.js";
import { randomHoles, courseHoles, nextShot, playShot, undoShot, pickUp, roundSummary, scoreName, holeExpected } from "../practice/round.js";
import { gameById, gameProgress, personalBest, fmtGameScore } from "../practice/games.js";
import { trendSvg } from "../practice/draw.js";
import { SG, sgCls, tile, shotTitle, resultText, shotCard } from "./practiceShot.js";

const sg1 = (v) => (Math.abs(v) < 0.05 ? "0.0" : SG(v, 1));
const toParText = (d) => (d === 0 ? "E" : d > 0 ? `+${d}` : `−${Math.abs(d)}`);
const CAT_ORDER = ["OTT", "APP", "ARG", "PUTT"];
const TEES = [["champ", "Championship", 1], ["member", "Member", 0.9], ["forward", "Forward", 0.8]];
const WIDTHS = [["mixed", "Mixed"], ["tight", "Tight"], ["standard", "Standard"], ["wide", "Wide"]];

export async function render(ctx, mode) {
  const v = ctx.view;
  if (v.name === "round") return drawRound(ctx, v.session);
  if (v.name === "roundEnd") return drawEnd(ctx, v.session);
  if (v.name === "prepCourse") return drawPrepSetup(ctx, v.course);
  if (v.name === "prepNew") return drawCourseEditor(ctx, v.course);
  return mode === "prep" ? drawPrepHome(ctx) : drawSimHome(ctx);
}

/* ============================================== Sim Round: home ============================================== */
function drawSimHome(ctx) {
  const opts = { holes: 18, tees: "champ", width: "mixed", stimp: 11 };
  const seg = (list, key, label) => {
    const box = el("div", { class: "seg seg-sm pr-opt", role: "group", "aria-label": label });
    const drawSeg = () => mount(box, list.map(([v, l]) => { const b = el("button", { type: "button", class: `seg-btn${opts[key] === v ? " on" : ""}` }, l); b.addEventListener("click", () => { opts[key] = v; drawSeg(); }); return b; }));
    drawSeg();
    return el("div", { class: "pr-optrow" }, [el("span", { class: "rd-label" }, label), box]);
  };
  const stimp = stimpInput(opts);
  const go = el("button", { type: "button", class: "btn pr-go" }, "Tee off ▶");
  go.addEventListener("click", () => {
    const scale = TEES.find((t) => t[0] === opts.tees)[2];
    const holes = randomHoles({ holes: opts.holes, scale, width: opts.width });
    startRound(ctx, { mode: "sim", course: { name: `Sim round · ${opts.holes} holes` }, opts: { ...opts }, holes });
  });
  mount(ctx.body, [
    el("section", { class: "panel pr-hero" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "Sim Round"),
      el("p", { class: "muted pr-lede" }, "Play made-up holes on the range, shot by shot: every shot starts where the last one finished, until it's in the hole. Strokes gained for every shot, a score at the end.")])]),
    ...resumeRows(ctx, "sim"),
    el("section", { class: "panel pr-plan" }, [
      el("h2", {}, "New round"),
      el("div", { class: "pr-opts" }, [
        seg([[18, "18 holes"], [9, "9 holes"]], "holes", "Holes"),
        seg(TEES.map(([v, l, k]) => [v, `${l} · ${Math.round(7250 * k / 50) * 50 / 1000}k`]), "tees", "Tees"),
        seg(WIDTHS, "width", "Fairways"),
        stimp,
      ]),
      go,
    ]),
    historyPanel(ctx, "sim"),
  ]);
}

function stimpInput(opts) {
  const inp = el("input", { type: "number", inputmode: "decimal", min: 7, max: 15, step: 0.5, value: opts.stimp, "aria-label": "Green speed (stimp)" });
  inp.addEventListener("input", () => { opts.stimp = Number(inp.value) || 11; });
  return el("label", { class: "pr-optrow pr-stimp" }, [el("span", { class: "rd-label" }, "Green speed (stimp)"), inp]);
}

function startRound(ctx, { mode, course, opts, holes, gameId = null }) {
  const s = { id: ctx.newId(), cat: "ROUND", mode, gameId, course, opts, holes, cur: 0, status: "active", startedAt: new Date().toISOString(), playerKey: ctx.playerKey, playerLabel: ctx.label };
  ctx.add(s); ctx.save(s, true);
  ctx.go({ name: "round", session: s });
}

function resumeRows(ctx, mode) {
  return ctx.sessions.filter((s) => s.cat === "ROUND" && s.mode === mode && s.status === "active").map((s) => {
    const sm = roundSummary(s.holes);
    const b = el("button", { type: "button", class: "btn ghost" }, "Resume");
    b.addEventListener("click", () => ctx.go({ name: "round", session: s }));
    const x = el("button", { type: "button", class: "link danger" }, "Discard");
    x.addEventListener("click", async () => { if (!confirmAction("Discard this unfinished round?")) return; await ctx.remove(s.id); ctx.home(); });
    return el("section", { class: "panel pr-resume" }, [el("div", {}, [el("strong", {}, s.course?.name || "Round in progress"), el("span", { class: "muted" }, ` · ${sm.holes ? `${toParText(sm.toPar)} thru ${sm.holes}` : "not started"} · ${new Date(s.startedAt).toLocaleDateString()}`)]), el("div", { class: "pr-row" }, [b, x])]);
  });
}

/** Past rounds: averages, SG by category, a trend, and the list. */
function historyPanel(ctx, mode) {
  const done = ctx.sessions.filter((s) => s.cat === "ROUND" && s.mode === mode && s.status === "done");
  if (!done.length) return el("section", { class: "panel pr-empty" }, [el("h2", {}, "How it works"), el("ol", {}, (mode === "prep" ? [
    "Pick a course you've saved a scorecard for in Track Round, one you've played, or type one in.",
    "Play all of it, a nine, the par 3s or 5s, or the holes you score worst on there.",
    "Each hole gets its real par and yardage; the fairways, greens and trouble are made up for practice.",
    "Enter each shot by tapping, typing or saying it. See your score and strokes gained by category at the end.",
  ] : [
    "Pick 18 or 9 holes, the tees and how tight the fairways are.",
    "Each hole is made up: a fairway with trouble, then a green with bunkers, water and a pin. Hit your shot and tap where it finished, type it or say it.",
    "The next shot starts where that one finished, down to the putts, until it's in.",
    "See your score, strokes gained by category, fairways, greens, putts and the scorecard at the end.",
  ]).map((t) => el("li", {}, t)))]);
  const sums = done.map((s) => s.summary || roundSummary(s.holes));
  const full = done.filter((s) => s.holes.length === 18);
  const avg = (k) => sums.reduce((t, x) => t + (k(x) || 0), 0) / sums.length;
  const per18 = (x) => (x.holes ? (x.sgTotal / x.holes) * 18 : 0);
  const trend = [...done].reverse().map((s) => { const x = s.summary || roundSummary(s.holes); return { label: new Date(s.startedAt).toLocaleDateString(), v: x.holes ? x.sgTotal / x.holes : 0 }; });
  const list = el("div", { class: "pr-sessions" }, done.map((s) => {
    const x = s.summary || roundSummary(s.holes);
    const row = el("button", { type: "button", class: "pr-sess" }, [
      el("span", { class: "pr-sess-d" }, [new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), el("span", { class: "pr-sess-tag" }, s.course?.name || "")]),
      el("span", { class: "muted" }, `${x.score} (${toParText(x.toPar)})`),
      el("strong", { class: sgCls(x.sgTotal) }, SG(x.sgTotal, 1)),
      el("span", { class: "pr-sess-per muted" }, `${x.holes} holes`),
    ]);
    row.addEventListener("click", () => ctx.go({ name: "roundEnd", session: s }));
    return row;
  }));
  return el("div", {}, [
    el("section", { class: "panel" }, [el("h2", {}, "Your rounds"), el("div", { class: "pr-tiles" }, [
      tile("Rounds", String(done.length)),
      full.length ? tile("Scoring avg", (full.reduce((t, s) => t + (s.summary || roundSummary(s.holes)).score, 0) / full.length).toFixed(1), "", "18-hole rounds") : null,
      tile("SG / 18 holes", SG(avg(per18), 1), sgCls(avg(per18)), "vs Tour average"),
      ...CAT_ORDER.map((c) => { const v = sums.reduce((t, x) => t + (x.holes ? (x.sg[c] / x.holes) * 18 : 0), 0) / sums.length; return tile(CATS[c].label, SG(v, 1), sgCls(v), "per 18"); }),
    ].filter(Boolean)), trend.length > 1 ? el("div", { class: "pr-chart" }, [el("p", { class: "pr-cap" }, "Strokes gained per hole, round by round"), trendSvg(trend)]) : null]),
    el("section", { class: "panel" }, [el("h2", {}, "Rounds"), list]),
  ]);
}

/* ============================================== Course Prep: home ============================================== */
async function myCourses(ctx) {
  const out = new Map();
  try {
    const { myCourseCards } = await import("../courseCards.js");
    for (const c of await myCourseCards(ctx.uid)) {
      const yards = c.tees?.[c.lastTees] || Object.values(c.tees || {})[0] || [];
      out.set(c.name.toLowerCase(), { name: c.name, location: c.location || "", par: (c.par || []).slice(0, c.holes || 18).map((p) => p || 4), yards: yards.slice(0, c.holes || 18), tees: c.lastTees || "", from: "Saved scorecard", rounds: [] });
    }
  } catch { /* */ }
  try {
    const { watchPlayerRounds } = await import("../rounds.js");
    const { myEntryKey } = await import("./dataEntry.js");
    const key = myEntryKey(ctx.state);
    const rounds = key ? await new Promise((res) => { let un = null, got = false; un = watchPlayerRounds(key, (list) => { if (got) return; got = true; res(list || []); setTimeout(() => un?.(), 0); }); setTimeout(() => { if (!got) { got = true; res([]); } }, 6000); }) : [];
    for (const r of rounds) {
      if (!r.course || !r.holes?.length) continue;
      const k = r.course.toLowerCase();
      if (!out.has(k)) out.set(k, { name: r.course, location: "", par: r.holes.map((h) => h.par || 4), yards: r.holes.map((h) => h.yards || null), tees: r.tees || "", from: "Your round", rounds: [] });
      const c = out.get(k);
      c.rounds.push(r);
      if (!c.yards.some(Boolean) && r.holes.some((h) => h.yards)) c.yards = r.holes.map((h) => h.yards || null);
    }
  } catch { /* */ }
  return [...out.values()].sort((a, b) => b.rounds.length - a.rounds.length || a.name.localeCompare(b.name));
}

async function drawPrepHome(ctx) {
  mount(ctx.body, [el("section", { class: "panel pr-hero" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "Course Prep"), el("p", { class: "muted pr-lede" }, "Loading your courses…")])])]);
  const courses = await myCourses(ctx);
  if (ctx.view.name !== "home") return;
  const add = el("button", { type: "button", class: "btn ghost" }, "＋  Type in a course");
  add.addEventListener("click", () => ctx.go({ name: "prepNew", course: null }));
  const cards = courses.length ? el("div", { class: "pr-course-grid" }, courses.map((c) => {
    const par = c.par.reduce((a, b) => a + (b || 0), 0), yds = c.yards.reduce((a, b) => a + (Number(b) || 0), 0);
    const b = el("button", { type: "button", class: "pr-course" }, [
      el("strong", {}, c.name),
      el("span", { class: "muted small" }, [c.location, `${c.par.length} holes · par ${par}${yds ? ` · ${yds.toLocaleString()} yds` : ""}`].filter(Boolean).join(" · ")),
      el("span", { class: "pr-sess-tag" }, c.rounds.length ? `${c.rounds.length} round${c.rounds.length === 1 ? "" : "s"} played` : c.from),
    ]);
    b.addEventListener("click", () => ctx.go({ name: "prepCourse", course: c }));
    return b;
  })) : el("p", { class: "muted" }, "No courses yet. Courses you save a scorecard for in Track Round show up here, or type one in.");
  mount(ctx.body, [
    el("section", { class: "panel pr-hero" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "Course Prep"),
      el("p", { class: "muted pr-lede" }, "Get ready for a course on the range: its real pars and yardages, hole by hole, played out shot by shot. Practise the whole course, a nine, or just the holes that give you trouble.")])]),
    ...resumeRows(ctx, "prep"),
    el("section", { class: "panel" }, [el("div", { class: "pr-sub" }, [el("h2", {}, "Pick a course"), add]), cards]),
    historyPanel(ctx, "prep"),
  ]);
}

/** Type in a course: name, then par and yards for each hole (saved as a scorecard, so Track Round can use it too). */
function drawCourseEditor(ctx) {
  const holes = Array.from({ length: 18 }, () => ({ par: 4, yards: "" }));
  const name = el("input", { type: "text", placeholder: "Course name", maxLength: 80, autocomplete: "off" });
  const grid = el("div", { class: "pr-card-grid" });
  const drawGrid = () => mount(grid, holes.map((h, i) => {
    const par = el("button", { type: "button", class: "pr-par", "aria-label": `Hole ${i + 1} par ${h.par}, tap to change` }, String(h.par));
    par.addEventListener("click", () => { h.par = h.par === 4 ? 5 : h.par === 5 ? 3 : 4; par.textContent = String(h.par); });
    const yd = el("input", { type: "text", inputmode: "numeric", maxLength: 3, value: h.yards, placeholder: "yds", "aria-label": `Hole ${i + 1} yards` });
    yd.addEventListener("input", () => { h.yards = yd.value.replace(/\D/g, ""); });
    return el("div", { class: "pr-card-hole" }, [el("span", { class: "pr-card-n" }, String(i + 1)), par, yd]);
  }));
  drawGrid();
  const save = el("button", { type: "button", class: "btn pr-go" }, "Save and pick holes ▶");
  save.addEventListener("click", async () => {
    if (!name.value.trim()) { ctx.flash?.("Give the course a name.", "error"); name.focus(); return; }
    const c = { name: name.value.trim(), location: "", par: holes.map((h) => h.par), yards: holes.map((h) => Number(h.yards) || null), tees: "", from: "Typed in", rounds: [] };
    try { const { saveCourseCard } = await import("../courseCards.js"); await saveCourseCard(ctx.uid, { name: c.name, holes: 18, par: c.par, hcp: [], tees: c.yards.some(Boolean) ? { Practice: c.yards } : {}, lastTees: c.yards.some(Boolean) ? "Practice" : "" }); } catch { /* still usable */ }
    ctx.go({ name: "prepCourse", course: c });
  });
  const back = el("button", { type: "button", class: "link" }, "← Back");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, "Course Prep"), el("h1", {}, "Type in a course"),
    el("label", { class: "pr-optrow" }, [el("span", { class: "rd-label" }, "Course"), name]),
    el("p", { class: "muted small" }, "Tap a par to change it (4 → 5 → 3). Yards are the ones you'll play; leave a hole blank and a length is picked for its par."),
    grid, save,
  ])]);
}

/** Your average score to par on each hole of a course, from your entered rounds there. */
function holeAverages(course) {
  const by = new Map();
  for (const r of course.rounds || []) for (const h of r.holes || []) {
    const strokes = r.shots?.[`h${h.n}`] || [];
    let sc = null;
    if (strokes.length && strokes.some((s) => s.endLie === "Holed")) sc = strokes.length + strokes.filter((s) => s.endLie === "Penalty").length;
    else if (Number(r.quick?.[`h${h.n}`]?.score) > 0) sc = Number(r.quick[`h${h.n}`].score);
    if (sc == null || !h.par) continue;
    const o = by.get(h.n) || { n: h.n, sum: 0, k: 0 };
    o.sum += sc - h.par; o.k++; by.set(h.n, o);
  }
  return [...by.values()].map((o) => ({ n: o.n, avg: o.sum / o.k, k: o.k }));
}

function drawPrepSetup(ctx, course) {
  const n = course.par.length;
  const avgs = holeAverages(course);
  const worst = [...avgs].sort((a, b) => b.avg - a.avg).slice(0, 6).map((a) => a.n).sort((a, b) => a - b);
  const choices = [["all", `All ${n}`, null], ...(n === 18 ? [["front", "Front 9", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["back", "Back 9", [10, 11, 12, 13, 14, 15, 16, 17, 18]]] : []),
    ["p3", "Par 3s", course.par.map((p, i) => (p === 3 ? i + 1 : null)).filter(Boolean)], ["p5", "Par 5s", course.par.map((p, i) => (p === 5 ? i + 1 : null)).filter(Boolean)],
    ...(worst.length >= 3 ? [["worst", `Your toughest ${worst.length}`, worst]] : [])].filter((c) => c[2] === null || c[2].length);
  const opts = { which: "all", width: "standard", stimp: 11 };
  const whichBox = el("div", { class: "pr-chips-row", role: "group", "aria-label": "Holes" });
  const table = el("div", { class: "table-scroll" });
  const onlyOf = () => choices.find((c) => c[0] === opts.which)?.[2] || null;
  const drawWhich = () => {
    mount(whichBox, choices.map(([v, l]) => { const b = el("button", { type: "button", class: `pr-chip${opts.which === v ? " on" : ""}` }, l); b.addEventListener("click", () => { opts.which = v; drawWhich(); }); return b; }));
    const only = onlyOf();
    mount(table, el("table", { class: "plain pr-card-table" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Hole"), el("th", { class: "num" }, "Par"), el("th", { class: "num" }, "Yds"), avgs.length ? el("th", { class: "num" }, "Your avg") : null])),
      el("tbody", {}, course.par.map((p, i) => {
        const a = avgs.find((x) => x.n === i + 1);
        return el("tr", { class: only && !only.includes(i + 1) ? "off" : "" }, [el("td", {}, String(i + 1)), el("td", { class: "num" }, String(p)), el("td", { class: "num" }, course.yards[i] ? String(course.yards[i]) : "—"),
          avgs.length ? el("td", { class: `num ${a ? (a.avg > 0.4 ? "neg" : a.avg < 0 ? "pos" : "") : ""}` }, a ? `${a.avg >= 0 ? "+" : "−"}${Math.abs(a.avg).toFixed(1)}` : "—") : null]);
      })),
    ]));
  };
  drawWhich();
  const widthBox = el("div", { class: "seg seg-sm pr-opt", role: "group", "aria-label": "Fairways" });
  const drawWidth = () => mount(widthBox, WIDTHS.slice(1).map(([v, l]) => { const b = el("button", { type: "button", class: `seg-btn${opts.width === v ? " on" : ""}` }, l); b.addEventListener("click", () => { opts.width = v; drawWidth(); }); return b; }));
  drawWidth();
  const go = el("button", { type: "button", class: "btn pr-go" }, "Tee off ▶");
  go.addEventListener("click", () => {
    const holes = courseHoles({ par: course.par, yards: course.yards, width: opts.width, only: onlyOf() });
    const label = choices.find((c) => c[0] === opts.which)?.[1];
    startRound(ctx, { mode: "prep", course: { name: course.name, part: opts.which === "all" ? "" : label }, opts: { ...opts }, holes });
  });
  const back = el("button", { type: "button", class: "link" }, "← Courses");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, `Course Prep${course.tees ? ` · ${course.tees} tees` : ""}`), el("h1", {}, course.name),
    el("div", { class: "pr-plan-grid" }, [
      el("div", {}, [el("h2", {}, "Holes"), whichBox, table]),
      el("div", {}, [el("div", { class: "pr-optrow" }, [el("span", { class: "rd-label" }, "Fairways"), widthBox]), stimpInput(opts),
        el("p", { class: "muted small" }, avgs.length ? `“Your avg” is your score to par on each hole from ${course.rounds.length} round${course.rounds.length === 1 ? "" : "s"} you've tracked here.` : "Track a round here and your average on each hole shows up, with the option to practise your toughest holes."),
        el("p", { class: "muted small" }, "Pars and yards are the course's; the fairway trouble, bunkers and pins are made up for practice.")]),
    ]),
    go,
  ])]);
}

/* ============================================== playing a round ============================================== */
function drawRound(ctx, s) {
  const game = s.mode === "game" ? gameById(s.gameId) : null;
  // just finished a hole: show how it went, then on
  if (ctx.view.k === "after") { const h = s.holes.find((x) => x.n === ctx.view.hole); if (h?.done) return drawHoleDone(ctx, s, h, game); }
  const idx = s.holes.findIndex((h) => !h.done);
  if (idx < 0) return finishRound(ctx, s);
  const hole = s.holes[idx];
  s.cur = idx;
  if (!s.pending || s.pending.holeN !== hole.n) { s.pending = { ...nextShot(hole, s.teeClub || "Driver"), holeN: hole.n }; ctx.save(s); }
  const shot = s.pending;
  const sm = roundSummary(s.holes);
  const commit = () => {
    if (!shot.result) return;
    const res = shot.result;
    const { holeN, ...clean } = shot; void holeN;
    delete clean.result; delete clean.sg;
    playShot(hole, clean, res);
    s.pending = null;
    ctx.save(s);
    if (hole.done) ctx.go({ name: "round", session: s, k: "after", hole: hole.n });
    else ctx.go({ name: "round", session: s, k: `${hole.n}-${hole.shots.length}`, hole: hole.n });
  };
  const undo = hole.shots.length ? el("button", { type: "button", class: "btn ghost" }, "↶ Undo last shot") : null;
  undo?.addEventListener("click", () => { undoShot(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `${hole.n}-${hole.shots.length}-u`, hole: hole.n }); });
  const pick = el("button", { type: "button", class: "link pr-pickup" }, "Pick up");
  pick.addEventListener("click", () => { if (!confirmAction(`Pick up on this hole? It counts as ${Math.max(hole.strokes + 1, hole.par + 3)}.`)) return; pickUp(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: "after", hole: hole.n }); });
  const end = el("button", { type: "button", class: "link danger" }, game ? "End game" : "End round");
  end.addEventListener("click", () => finishRound(ctx, s, true));
  // the club off the tee (drives only): changes the carry the aim map plans for
  const clubBox = shot.kind === "tee" && shot.startLie === "Tee box" ? (() => {
    const box = el("div", { class: "seg seg-sm pr-teeclub", role: "group", "aria-label": "Club off the tee" });
    mount(box, ["Driver", "3 wood", "Iron"].map((c) => {
      const b = el("button", { type: "button", class: `seg-btn${shot.club === c ? " on" : ""}` }, c);
      b.addEventListener("click", () => { s.teeClub = c; s.pending = { ...shot, club: c, carry: { Driver: 290, "3 wood": 260, Iron: 225 }[c] }; delete s.pending.result; delete s.pending.sg; ctx.save(s); ctx.go({ name: "round", session: s, k: `${hole.n}-club-${c}`, hole: hole.n }); });
      return b;
    }));
    return el("div", { class: "pr-optrow pr-teeclub-row" }, [el("span", { class: "rd-label" }, "Off the tee"), box]);
  })() : null;
  const card = shotCard({
    shot, stimp: s.opts?.stimp || 11, aim: ctx.aimFor(shot), heat: ctx.heat,
    eyebrow: `Hole ${hole.n} · Par ${hole.par} · Shot ${shot.n}`,
    onResult: (r) => { shot.result = r || undefined; shot.sg = null; if (r) { shot.sg = scoreShot({ ...shot, result: r }); } ctx.save(s); },
    next: { label: "Next shot ›", onClick: commit },
    more: [undo, el("span", { class: "pr-more-links" }, [pick, end])],
  });
  const thru = sm.holes;
  const bar = el("div", { class: "pr-bar pr-round-bar" }, [
    el("div", { class: "pr-bar-l" }, [el("strong", {}, game ? game.title : s.course?.name || "Round"), el("span", { class: "muted" }, s.course?.part || "")]),
    el("div", { class: "pr-prog" }, el("i", { style: `--w:${(thru / s.holes.length) * 100}%` })),
    el("div", { class: "pr-bar-r" }, [el("span", { class: "muted small" }, thru ? `thru ${thru}` : "Hole 1"), el("strong", {}, thru ? (game ? `${sm.score}` : toParText(sm.toPar)) : "E"), el("span", { class: `small ${sgCls(sm.sgTotal)}` }, thru ? `${SG(sm.sgTotal, 1)} SG` : "")]),
  ]);
  const live = game ? (() => { const g = gameProgress(game, s), pb = personalBest(game, ctx.sessions); return el("div", { class: `pr-game-live ${g.status}` }, [el("span", {}, [el("strong", {}, `Target ${fmtGameScore(game, game.target)} or less`), pb != null ? ` · Best ${pb}` : ""]), el("span", {}, g.need)]); })() : null;
  const holeShots = hole.shots.length ? el("ol", { class: "pr-hole-shots" }, hole.shots.map((x) => el("li", {}, [el("span", {}, shotTitle(x)), el("span", { class: "muted" }, resultText(x)), el("span", { class: sgCls(x.sg) }, SG(x.sg))]))) : null;
  mount(ctx.body, [bar, live, clubBox, card, holeShots ? el("section", { class: "panel pr-list" }, [el("h2", {}, `Hole ${hole.n} so far`), holeShots]) : null, scorecardStrip(s)]);
}


function drawHoleDone(ctx, s, hole, game) {
  const sg = hole.shots.reduce((t, x) => t + (x.sg || 0), 0);
  const name = hole.pickedUp ? "Picked up" : scoreName(hole.strokes, hole.par);
  const isLast = s.holes.every((h) => h.done);
  const next = el("button", { type: "button", class: "btn pr-go" }, isLast ? (game ? "See your score ✓" : "Finish round ✓") : "Next hole ›");
  next.addEventListener("click", () => { if (isLast) finishRound(ctx, s); else { s.cur = s.holes.findIndex((h) => !h.done); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `start-${s.cur}`, hole: s.holes[s.cur].n }); } });
  const undo = el("button", { type: "button", class: "link" }, "↶ Undo last shot");
  undo.addEventListener("click", () => { if (hole.pickedUp) { hole.done = false; hole.pickedUp = false; hole.strokes = hole.shots.reduce((t, x) => t + 1 + (x.result?.penalty ? 1 : 0), 0); } else undoShot(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `undo-${hole.n}-${hole.shots.length}`, hole: hole.n }); });
  const sm = roundSummary(s.holes);
  const cls = hole.strokes < hole.par ? "under" : hole.strokes === hole.par ? "par" : "over";
  mount(ctx.body, [
    el("section", { class: `panel pr-hole-done ${cls}` }, [
      el("p", { class: "pr-eyebrow" }, `Hole ${hole.n} · Par ${hole.par}${hole.short ? "" : ` · ${hole.length} yds`}`),
      el("div", { class: "pr-big" }, [el("strong", {}, String(hole.strokes)), el("span", {}, name)]),
      el("p", {}, [el("span", { class: sgCls(sg) }, `${SG(sg)} strokes gained`), el("span", { class: "muted" }, ` · Tour average ${holeExpected(hole).toFixed(2)}`)]),
      el("ol", { class: "pr-hole-shots" }, hole.shots.map((x) => el("li", {}, [el("span", {}, `${CATS[x.rcat]?.short || ""} · ${shotTitle(x)}`), el("span", { class: "muted" }, resultText(x)), el("span", { class: sgCls(x.sg) }, SG(x.sg))]))),
      el("p", { class: "muted" }, game ? `${sm.score} strokes after ${sm.holes} of ${s.holes.length}` : `${toParText(sm.toPar)} through ${sm.holes} · ${SG(sm.sgTotal, 1)} SG`),
      next, el("p", { class: "center" }, undo),
    ]),
    scorecardStrip(s),
  ]);
}

/** A little scorecard: each hole's par and score, coloured. */
function scorecardStrip(s) {
  return el("div", { class: "pr-strip", "aria-label": "Scorecard" }, s.holes.map((h) => el("span", { class: `pr-strip-h ${h.done ? (h.strokes < h.par ? "under" : h.strokes === h.par ? "par" : "over") : ""}` }, [el("i", {}, String(h.n)), el("b", {}, h.done ? String(h.strokes) : "·"), el("em", {}, `P${h.par}`)])));
}

async function finishRound(ctx, s, early = false) {
  const played = s.holes.filter((h) => h.done).length;
  if (early) {
    if (!played) { if (!confirmAction("No holes finished. Discard this round?")) return; await ctx.remove(s.id); ctx.home(); return; }
    if (!confirmAction(`End here, after ${played} of ${s.holes.length} holes?`)) return;
  }
  const game = s.mode === "game" ? gameById(s.gameId) : null;
  s.pending = null;
  s.status = "done";
  s.finishedAt = new Date().toISOString();
  const sm = roundSummary(s.holes);
  s.summary = sm;
  if (game) {
    const before = personalBest(game, ctx.sessions.filter((x) => x.id !== s.id));
    const complete = played === s.holes.length;
    s.game = { score: sm.score, target: game.target, complete, passed: complete && sm.score <= game.target, best: complete && (before == null || sm.score < before) };
  }
  await ctx.save(s, true);
  ctx.go({ name: "roundEnd", session: s });
}

/* ============================================== the end of a round ============================================== */
function drawEnd(ctx, s) {
  const game = s.mode === "game" ? gameById(s.gameId) : null;
  const sm = s.summary && s.summary.sg ? s.summary : roundSummary(s.holes);
  const back = el("button", { type: "button", class: "link" }, "← Back");
  back.addEventListener("click", () => ctx.home());
  const del = el("button", { type: "button", class: "link danger" }, game ? "Delete game" : "Delete round");
  del.addEventListener("click", async () => { if (!confirmAction("Delete this? It can't be undone.")) return; await ctx.remove(s.id); ctx.home(); });
  const again = el("button", { type: "button", class: "btn" }, game ? "↻  Play again" : "＋  New round");
  again.addEventListener("click", async () => { if (game) { const m = await import("./practiceGames.js"); m.startGame(ctx, game); } else ctx.home(); });
  const played = s.holes.filter((h) => h.done);
  const date = new Date(s.startedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const hero = el("section", { class: `panel pr-sum-hero ${game ? `pr-game-hero ${s.game?.passed ? "passed" : "failed"}` : ""}` }, [
    el("div", {}, [
      el("p", { class: "pr-eyebrow" }, `${game ? game.title : s.course?.name || "Round"}${s.course?.part ? ` · ${s.course.part}` : ""} · ${date}`),
      el("div", { class: "pr-big" }, [el("strong", {}, String(sm.score)), el("span", {}, game ? `strokes (par ${sm.par})` : `${toParText(sm.toPar)} · ${sm.holes} hole${sm.holes === 1 ? "" : "s"}`)]),
      game ? el("p", { class: "pr-verdict" }, [s.game?.passed ? "✓ Target beaten" : s.game?.complete === false ? "Unfinished" : "Target missed", ` (target ${game.target} or less)`, s.game?.best ? el("span", { class: "pr-pb" }, "New personal best") : ""]) : null,
      el("p", { class: "muted" }, [el("span", { class: sgCls(sm.sgTotal) }, `${SG(sm.sgTotal)} strokes gained`), ` vs Tour average (a Tour player would average ${sm.expected.toFixed(1)})`]),
    ]),
    again,
  ]);
  // strokes gained by category, as bars
  const max = Math.max(0.5, ...CAT_ORDER.map((c) => Math.abs(sm.sg[c])));
  const bars = el("div", { class: "pr-sgbars" }, CAT_ORDER.filter((c) => played.some((h) => h.shots.some((x) => x.rcat === c))).map((c) => {
    const v = sm.sg[c];
    return el("div", { class: "pr-sgbar" }, [el("span", {}, CATS[c].label), el("div", { class: "pr-sgbar-track" }, el("i", { class: v >= 0 ? "pos" : "neg", style: `--w:${(Math.abs(v) / max) * 50}%` })), el("strong", { class: sgCls(v) }, SG(v))]);
  }));
  const tiles = el("div", { class: "pr-tiles" }, [
    sm.fairways ? tile("Fairways", `${sm.fairways.hit}/${sm.fairways.of}`) : null,
    sm.gir ? tile("Greens", `${sm.gir.hit}/${sm.gir.of}`) : null,
    tile("Putts", String(sm.putts)),
    sm.scrambling ? tile("Scrambling", `${sm.scrambling.made}/${sm.scrambling.of}`) : null,
    sm.upDowns ? tile("Up & downs", `${sm.upDowns.made}/${sm.upDowns.of}`) : null,
    tile("Penalties", String(sm.penalties)),
  ].filter(Boolean));
  // the best and worst shots
  const all = played.flatMap((h) => h.shots.map((x) => ({ ...x, holeN: h.n }))).filter((x) => x.sg != null);
  const best = [...all].filter((x) => x.sg > 0).sort((a, b) => b.sg - a.sg).slice(0, 3), worst = [...all].filter((x) => x.sg < 0).sort((a, b) => a.sg - b.sg).slice(0, 3);
  const shotLi = (x) => el("li", {}, [el("span", {}, `Hole ${x.holeN} · ${shotTitle(x)}`), el("span", { class: "muted" }, resultText(x)), el("span", { class: sgCls(x.sg) }, SG(x.sg))]);
  const card = el("div", { class: "table-scroll" }, el("table", { class: "plain pr-scorecard" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Hole"), el("th", { class: "num" }, "Par"), game ? null : el("th", { class: "num" }, "Yds"), el("th", { class: "num" }, "Score"), ...CAT_ORDER.map((c) => el("th", { class: "num" }, CATS[c].short)), el("th", { class: "num" }, "SG")])),
    el("tbody", {}, played.map((h) => {
      const by = (c) => h.shots.filter((x) => x.rcat === c).reduce((t, x) => t + (x.sg || 0), 0);
      const tot = h.shots.reduce((t, x) => t + (x.sg || 0), 0);
      const cls = h.strokes < h.par ? "under" : h.strokes === h.par ? "par" : "over";
      return el("tr", {}, [el("td", {}, String(h.n)), el("td", { class: "num" }, String(h.par)), game ? null : el("td", { class: "num" }, String(h.length)), el("td", { class: "num" }, el("span", { class: `pr-sc ${cls}` }, String(h.strokes))),
        ...CAT_ORDER.map((c) => { const has = h.shots.some((x) => x.rcat === c), v = by(c); return el("td", { class: `num ${has ? sgCls(v) : ""}` }, has ? sg1(v) : ""); }),
        el("td", { class: `num ${sgCls(tot)}` }, sg1(tot))]);
    })),
  ]));
  mount(ctx.body, [
    el("p", { class: "crumb pr-crumb" }, [back, del]),
    hero,
    el("section", { class: "panel" }, [el("h2", {}, "Strokes gained by category"), bars, tiles]),
    el("section", { class: "panel" }, [el("h2", {}, "Scorecard"), card]),
    all.length ? el("section", { class: "panel pr-bestworst" }, [
      el("div", {}, [el("h2", {}, "Best shots"), best.length ? el("ol", { class: "pr-hole-shots" }, best.map(shotLi)) : el("p", { class: "muted" }, "None gained on Tour average.")]),
      el("div", {}, [el("h2", {}, "Costliest shots"), worst.length ? el("ol", { class: "pr-hole-shots" }, worst.map(shotLi)) : el("p", { class: "muted" }, "None lost a stroke to Tour average.")]),
    ]) : null,
  ]);
}
