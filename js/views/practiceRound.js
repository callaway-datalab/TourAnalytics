/*
 * Practice › Course Prep (update 139), and the play-it-out games (Up & Down 9, Approach Nine).
 *
 *   Simulate a random course: 18 or 9 made-up holes — or holes drawn at random from courses you know.
 *   A real course:           its pars and yards, from a scorecard you've saved in Track Round, one of your rounds
 *                            there, or one you type in; all of it, a nine, the par 3s or 5s, or your toughest holes.
 *   Playing:                 distance only. After each shot, how far is left: yards off the green, feet on it, or
 *                            holed. The lie is ignored (off the green is scored as if from the fairway).
 *   At the end:              score, strokes gained by category against the Tour baselines, greens, putts,
 *                            scrambling, the scorecard, and your best and costliest shots.
 */
import { el, mount, confirmAction } from "../ui.js";
import { CATS } from "../practice/model.js";
import { randomHoles, courseHoles, nextShot, playShot, undoShot, pickUp, roundSummary, scoreName, holeExpected, shotSG, resultFromWords } from "../practice/round.js";
import { gameProgress, personalBest, targetText, passedIt, gameOf } from "../practice/games.js";
import { wordsToNumbers, golfFix } from "../voiceShots.js";
import { expectedStrokes } from "../roundCalc.js";
import { trendSvg } from "../practice/draw.js";
import { SG, sgCls, tile, SpeechRec, sayKids } from "./practiceShot.js";

const sumOf = (s) => roundSummary(s.holes, { noPutts: !!s.opts?.noPutts });
const toParText = (d) => (d === 0 ? "E" : d > 0 ? `+${d}` : `−${Math.abs(d)}`);
const sg1 = (v) => (Math.abs(v) < 0.05 ? "0.0" : SG(v, 1));
const CAT_ORDER = ["OTT", "APP", "ARG", "PUTT"];
const TEES = [["champ", "Championship", 1], ["member", "Member", 0.9], ["forward", "Forward", 0.8]];
const fmtD = (d, unit) => `${Math.round(d * 10) / 10} ${unit}`;

export async function render(ctx) {
  const v = ctx.view;
  if (v.name === "round") return drawRound(ctx, v.session);
  if (v.name === "roundEnd") return drawEnd(ctx, v.session);
  if (v.name === "prepCourse") return drawPrepSetup(ctx, v.course);
  if (v.name === "prepNew") return drawCourseEditor(ctx);
  return drawHome(ctx);
}

/** "Skip putting": each hole ends when you hit the green, with how close (for the range). */
function noPuttsRow(opts, id) {
  const cb = el("input", { type: "checkbox", id, checked: !!opts.noPutts });
  cb.addEventListener("change", () => { opts.noPutts = cb.checked; });
  return el("label", { class: "pr-check", for: id }, [cb, el("span", {}, [el("strong", {}, "Skip putting"), el("span", { class: "muted small" }, " \u00b7 each hole ends when you hit the green, with how close you are. Good on the range.")])]);
}

function startRound(ctx, { mode, course, opts = {}, holes, gameId = null, gameDef = null }) {
  const s = { id: ctx.newId(), cat: "ROUND", mode, gameId, gameDef, course, opts, holes, cur: 0, status: "active", startedAt: new Date().toISOString(), playerKey: ctx.playerKey, playerLabel: ctx.label, distOnly: true };
  ctx.add(s); ctx.save(s, true);
  ctx.go({ name: "round", session: s });
}
export { startRound };

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

let coursesCache = null;
async function drawHome(ctx) {
  mount(ctx.body, [hero(), el("p", { class: "muted pr-loading" }, "Loading your courses…")]);
  const courses = coursesCache || (coursesCache = await myCourses(ctx));
  if (ctx.view.name !== "home") return;
  const pool = courses.flatMap((c) => c.par.map((p, i) => (Number(c.yards[i]) > 0 ? { par: p, yards: Number(c.yards[i]), course: c.name, n: i + 1 } : null)).filter(Boolean));

  // simulate a random course
  const opts = { holes: 18, tees: "champ", real: false, noPutts: false };
  const seg = (list, key, label) => {
    const box = el("div", { class: "seg seg-sm pr-opt", role: "group", "aria-label": label });
    const drawSeg = () => mount(box, list.map(([v, l]) => { const b = el("button", { type: "button", class: `seg-btn${opts[key] === v ? " on" : ""}` }, l); b.addEventListener("click", () => { opts[key] = v; drawSeg(); }); return b; }));
    drawSeg();
    return el("div", { class: "pr-optrow" }, [el("span", { class: "rd-label" }, label), box]);
  };
  const nC = courses.filter((c) => c.yards.some(Boolean)).length;
  const realRow = pool.length >= 6 ? (() => {
    const cb = el("input", { type: "checkbox", id: "pr-real" });
    cb.addEventListener("change", () => { opts.real = cb.checked; });
    return el("label", { class: "pr-check", for: "pr-real" }, [cb, el("span", {}, [el("strong", {}, "Use real holes from my courses"), el("span", { class: "muted small" }, ` · ${pool.length} holes from ${nC} course${nC === 1 ? "" : "s"}, drawn at random`)])]);
  })() : null;
  const go = el("button", { type: "button", class: "btn pr-go" }, "Tee off ▶");
  go.addEventListener("click", () => {
    const scale = TEES.find((t) => t[0] === opts.tees)[2];
    const holes = randomHoles({ holes: opts.holes, scale: opts.real ? 1 : scale, pool: opts.real ? pool : null });
    startRound(ctx, { mode: "sim", course: { name: opts.real ? "Random course · your holes" : "Random course", part: `${opts.holes} holes${opts.noPutts ? " \u00b7 no putts" : ""}` }, opts: { ...opts }, holes });
  });
  const random = el("section", { class: "panel pr-plan pr-random" }, [
    el("div", { class: "pr-sub" }, [el("div", {}, [el("h2", {}, "Simulate a random course"), el("p", { class: "muted small" }, "No course in mind? Play made-up holes, or holes drawn from the courses you know.")])]),
    el("div", { class: "pr-opts" }, [seg([[18, "18 holes"], [9, "9 holes"]], "holes", "Holes"), seg(TEES.map(([v, l, k]) => [v, `${l} · ${(Math.round(7250 * k / 50) * 50 / 1000).toFixed(1)}k`]), "tees", "Tees"), realRow, noPuttsRow(opts, "pr-noputts")]),
    go,
  ]);

  const add = el("button", { type: "button", class: "btn ghost" }, "＋  Type in a course");
  add.addEventListener("click", () => ctx.go({ name: "prepNew" }));
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
    hero(), random, ...resumeRows(ctx),
    el("section", { class: "panel" }, [el("div", { class: "pr-sub" }, [el("h2", {}, "Or prepare for a real course"), add]), cards]),
    historyPanel(ctx),
  ]);
}
const hero = () => el("section", { class: "panel pr-hero" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "Course Prep"),
  el("p", { class: "muted pr-lede" }, "Play a course on the range, shot by shot: after each one, just how far is left. Every shot is scored against the Tour baselines, with a score and strokes gained by category at the end.")])]);

function resumeRows(ctx) {
  return ctx.sessions.filter((s) => s.cat === "ROUND" && s.mode !== "game" && s.status === "active").map((s) => {
    const sm = sumOf(s);
    const b = el("button", { type: "button", class: "btn ghost" }, "Resume");
    b.addEventListener("click", () => ctx.go({ name: "round", session: s }));
    const x = el("button", { type: "button", class: "link danger" }, "Discard");
    x.addEventListener("click", async () => { if (!confirmAction("Discard this unfinished round?")) return; if (await ctx.remove(s.id)) ctx.home(); });
    return el("section", { class: "panel pr-resume" }, [el("div", {}, [el("strong", {}, s.course?.name || "Round in progress"), el("span", { class: "muted" }, ` · ${sm.holes ? `${toParText(sm.toPar)} thru ${sm.holes}` : "not started"} · ${new Date(s.startedAt).toLocaleDateString()}`)]), el("div", { class: "pr-row" }, [b, x])]);
  });
}

/** Past rounds: averages, SG by category, a trend, and the list. */
function historyPanel(ctx) {
  const done = ctx.sessions.filter((s) => s.cat === "ROUND" && s.mode !== "game" && s.status === "done");
  if (!done.length) return el("section", { class: "panel pr-empty" }, [el("h2", {}, "How it works"), el("ol", {}, [
    "Simulate a random course, or pick one you've saved a scorecard for in Track Round, one you've played, or type one in.",
    "Each hole has its par and yardage. Hit your shot, then enter how far is left: yards off the green, feet on it, or holed. Say it if you like (“150”, “12 feet”, “made it”).",
    "The next shot starts from there, down to the putts, until it's in.",
    "At the end: your score, strokes gained by category against the Tour baselines, greens, putts and the scorecard.",
  ].map((t) => el("li", {}, t)))]);
  const sums = done.map((s) => s.summary?.sg ? s.summary : sumOf(s));
  const full = done.filter((s) => s.holes.length === 18 && s.holes.every((h) => h.done) && !s.opts?.noPutts);
  const per18 = (x) => (x.holes ? (x.sgTotal / x.holes) * 18 : 0);
  const avg = (f) => sums.reduce((t, x) => t + f(x), 0) / sums.length;
  const trend = [...done].reverse().map((s) => { const x = s.summary?.sg ? s.summary : sumOf(s); return { label: new Date(s.startedAt).toLocaleDateString(), v: x.holes ? x.sgTotal / x.holes : 0 }; });
  const list = el("div", { class: "pr-sessions" }, done.map((s) => {
    const x = s.summary?.sg ? s.summary : sumOf(s);
    const row = el("button", { type: "button", class: "pr-sess" }, [
      el("span", { class: "pr-sess-d" }, [new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), el("span", { class: "pr-sess-tag" }, s.course?.name || "")]),
      el("span", { class: "muted" }, `${x.score} (${toParText(x.toPar)})`),
      el("strong", { class: sgCls(x.sgTotal) }, SG(x.sgTotal, 1)),
      el("span", { class: "pr-sess-per muted" }, `${x.holes} holes`),
    ]);
    row.addEventListener("click", () => ctx.go({ name: "roundEnd", session: s }));
    return ctx.rowWithDelete(row, s, "round");
  }));
  return el("div", {}, [
    el("section", { class: "panel" }, [el("h2", {}, "Your rounds"), el("div", { class: "pr-tiles" }, [
      tile("Rounds", String(done.length)),
      full.length && !full.every((s) => s.opts?.noPutts) ? tile("Scoring avg", (full.reduce((t, s) => t + (s.summary?.score ?? sumOf(s).score), 0) / full.length).toFixed(1), "", "18-hole rounds") : null,
      tile("SG / 18 holes", SG(avg(per18), 1), sgCls(avg(per18)), "vs Tour baselines"),
      ...CAT_ORDER.map((c) => { const v = avg((x) => (x.holes ? (x.sg[c] / x.holes) * 18 : 0)); return tile(CATS[c].label, SG(v, 1), sgCls(v), "per 18"); }),
    ].filter(Boolean)), trend.length > 1 ? el("div", { class: "pr-chart" }, [el("p", { class: "pr-cap" }, "Strokes gained per hole, round by round"), trendSvg(trend)]) : null]),
    el("section", { class: "panel" }, [el("h2", {}, "Rounds"), list]),
  ]);
}

/** Type in a course: name, then par and yards for each hole (saved as a scorecard, so Track Round can use it too). */
function drawCourseEditor(ctx) {
  const holes = Array.from({ length: 18 }, () => ({ par: 4, yards: "" }));
  const name = el("input", { type: "text", placeholder: "Course name", maxLength: 80, autocomplete: "off" });
  const grid = el("div", { class: "pr-card-grid" }, holes.map((h, i) => {
    const par = el("button", { type: "button", class: "pr-par", "aria-label": `Hole ${i + 1} par, tap to change` }, String(h.par));
    par.addEventListener("click", () => { h.par = h.par === 4 ? 5 : h.par === 5 ? 3 : 4; par.textContent = String(h.par); });
    const yd = el("input", { type: "text", inputmode: "numeric", maxLength: 3, placeholder: "yds", "aria-label": `Hole ${i + 1} yards` });
    yd.addEventListener("input", () => { h.yards = yd.value.replace(/\D/g, ""); });
    return el("div", { class: "pr-card-hole" }, [el("span", { class: "pr-card-n" }, String(i + 1)), par, yd]);
  }));
  const save = el("button", { type: "button", class: "btn pr-go" }, "Save and pick holes ▶");
  save.addEventListener("click", async () => {
    if (!name.value.trim()) { ctx.flash?.("Give the course a name.", "error"); name.focus(); return; }
    const c = { name: name.value.trim(), location: "", par: holes.map((h) => h.par), yards: holes.map((h) => Number(h.yards) || null), tees: "", from: "Typed in", rounds: [] };
    try { const { saveCourseCard } = await import("../courseCards.js"); await saveCourseCard(ctx.uid, { name: c.name, holes: 18, par: c.par, hcp: [], tees: c.yards.some(Boolean) ? { Practice: c.yards } : {}, lastTees: c.yards.some(Boolean) ? "Practice" : "" }); } catch { /* still usable */ }
    coursesCache = null;
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
  let which = "all";
  const popts = { noPutts: false };
  const whichBox = el("div", { class: "pr-chips-row", role: "group", "aria-label": "Holes" });
  const table = el("div", { class: "table-scroll" });
  const onlyOf = () => choices.find((c) => c[0] === which)?.[2] || null;
  const drawWhich = () => {
    mount(whichBox, choices.map(([v, l]) => { const b = el("button", { type: "button", class: `pr-chip${which === v ? " on" : ""}` }, l); b.addEventListener("click", () => { which = v; drawWhich(); }); return b; }));
    const only = onlyOf();
    mount(table, el("table", { class: "plain pr-card-table" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Hole"), el("th", { class: "num" }, "Par"), el("th", { class: "num" }, "Yds"), el("th", { class: "num" }, "Tour baseline"), avgs.length ? el("th", { class: "num" }, "Your avg") : null])),
      el("tbody", {}, course.par.map((p, i) => {
        const a = avgs.find((x) => x.n === i + 1), y = Number(course.yards[i]);
        return el("tr", { class: only && !only.includes(i + 1) ? "off" : "" }, [el("td", {}, String(i + 1)), el("td", { class: "num" }, String(p)), el("td", { class: "num" }, y ? String(y) : "—"),
          el("td", { class: "num" }, y ? expectedStrokes("Tee box", y).toFixed(2) : "—"),
          avgs.length ? el("td", { class: `num ${a ? (a.avg > 0.4 ? "neg" : a.avg < 0 ? "pos" : "") : ""}` }, a ? `${a.avg >= 0 ? "+" : "−"}${Math.abs(a.avg).toFixed(1)}` : "—") : null]);
      })),
    ]));
  };
  drawWhich();
  const go = el("button", { type: "button", class: "btn pr-go" }, "Tee off ▶");
  go.addEventListener("click", () => {
    const holes = courseHoles({ par: course.par, yards: course.yards, only: onlyOf() });
    const label = choices.find((c) => c[0] === which)?.[1];
    startRound(ctx, { mode: "prep", course: { name: course.name, part: [which === "all" ? "" : label, popts.noPutts ? "no putts" : ""].filter(Boolean).join(" \u00b7 ") }, opts: { ...popts }, holes });
  });
  const back = el("button", { type: "button", class: "link" }, "← Course Prep");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, `Course Prep${course.tees ? ` · ${course.tees} tees` : ""}`), el("h1", {}, course.name),
    el("h2", {}, "Which holes"), whichBox, table, noPuttsRow(popts, "pr-noputts-c"),
    el("p", { class: "muted small" }, avgs.length ? `“Your avg” is your score to par on each hole from ${course.rounds.length} round${course.rounds.length === 1 ? "" : "s"} you've tracked here. “Tour baseline” is the Tour's scoring average from that yardage.` : "“Tour baseline” is the Tour's scoring average from that yardage. Track a round here and your own average on each hole shows up, with the option to practise your toughest holes."),
    go,
  ])]);
}

/* ============================================== playing a round ============================================== */
/** The hole as a line from the tee to the pin, with each shot's ball on it. */
function holeStrip(hole, shot) {
  const NS = "http://www.w3.org/2000/svg";
  const s = (t, a = {}, kids = []) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v)); for (const c of kids) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); return n; };
  const L = Math.max(hole.length, 20), W = 320, x = (left) => 14 + (1 - Math.min(L, left) / L) * (W - 40);
  const yds = (sh) => (sh.unit === "ft" ? sh.startDist / 3 : sh.startDist);
  const svg = s("svg", { viewBox: `0 0 ${W} 54`, class: "pr-svg pr-strip-svg", role: "img", "aria-label": `${Math.round(yds(shot))} yards to go` });
  svg.appendChild(s("rect", { x: 6, y: 18, width: W - 18, height: 18, rx: 9, fill: "#1f3a24" }));
  svg.appendChild(s("ellipse", { cx: W - 26, cy: 27, rx: 20, ry: 14, fill: "#3f7a46" }));
  svg.appendChild(s("line", { x1: W - 26, x2: W - 26, y1: 27, y2: 8, stroke: "#f5f5f7", "stroke-width": 1 }));
  svg.appendChild(s("path", { d: `M${W - 26} 8 l9 3 l-9 3 z`, fill: "#ff453a" }));
  if (!hole.start) svg.appendChild(s("rect", { x: 10, y: 22, width: 6, height: 10, rx: 2, fill: "#d4b483" }));
  const pts = [...hole.shots.map(yds), yds(shot)];
  pts.forEach((d, i) => {
    const cx = d < 30 ? W - 26 - Math.min(18, d * 0.6) : x(d);
    if (i) svg.appendChild(s("line", { x1: pts[i - 1] < 30 ? W - 26 - Math.min(18, pts[i - 1] * 0.6) : x(pts[i - 1]), x2: cx, y1: 27, y2: 27, stroke: "rgba(212,180,131,0.5)", "stroke-width": 1.2, "stroke-dasharray": "3 2" }));
    svg.appendChild(s("circle", { cx, cy: 27, r: i === pts.length - 1 ? 4.2 : 2.6, fill: i === pts.length - 1 ? "#fff" : "rgba(255,255,255,0.55)", stroke: "#111", "stroke-width": 0.8 }));
  });
  svg.appendChild(s("text", { x: 14, y: 50, class: "pr-yd" }, hole.start ? "" : "Tee"));
  svg.appendChild(s("text", { x: W - 26, y: 50, class: "pr-yd", "text-anchor": "middle" }, "Pin"));
  return svg;
}

/** Entering what a shot left: yards off the green / feet on it / holed, a penalty, or say it. */
function resultPanel(shot, onChange, next, { noPutts = false } = {}) {
  let unit = shot.unit === "ft" || shot.startDist <= 25 ? "ft" : "yds", holed = false, penalty = false;
  if (shot.result) { unit = shot.result.unit; holed = shot.result.lie === "Holed"; penalty = !!shot.result.penalty; }
  const num = el("input", { type: "text", inputmode: "decimal", class: "pr-bignum", placeholder: "0", autocomplete: "off", "aria-label": "Distance left", value: shot.result && !holed ? String(shot.result.dist) : "" });
  const unitBox = el("div", { class: "seg seg-sm pr-unitseg", role: "group", "aria-label": "Where it finished" });
  const pen = el("button", { type: "button", class: "pr-chip pr-pen", "aria-pressed": "false" }, "+1 penalty");
  // skipping putts: the hole ends on the green, so the button is "Hit green" (then how far from the pin; 0 = holed)
  const holeBtn = el("button", { type: "button", class: "btn ghost pr-holed" }, noPutts ? "\u26F3 Hit green" : "\u2713 Holed");
  const line = el("p", { class: "pr-result", "aria-live": "polite" });
  const nextBtn = el("button", { type: "button", class: "btn pr-next", disabled: true }, "Next shot ›");
  nextBtn.addEventListener("click", () => next());
  const result = () => {
    if (holed) return { lie: "Holed", dist: 0, unit: "ft" };
    if (noPutts && unit === "ft" && String(num.value).trim() === "0") return { lie: "Holed", dist: 0, unit: "ft" };
    const d = Number(String(num.value).replace(",", "."));
    if (!(d > 0)) return null;
    return { lie: unit === "ft" ? "Green" : "Off", dist: d, unit, ...(penalty ? { penalty: true } : {}) };
  };
  const update = () => {
    mount(unitBox, [["yds", "Off the green \u00b7 yds"], ["ft", noPutts ? "Hit the green \u00b7 ft from pin" : "On the green \u00b7 ft"]].map(([u, l]) => { const b = el("button", { type: "button", class: `seg-btn${!holed && unit === u ? " on" : ""}` }, l); b.addEventListener("click", () => { unit = u; holed = false; update(); num.focus(); }); return b; }));
    holeBtn.classList.toggle("on", noPutts ? unit === "ft" : holed); pen.classList.toggle("on", penalty); pen.setAttribute("aria-pressed", String(penalty));
    const r = result();
    onChange(r);
    nextBtn.disabled = !r;
    nextBtn.textContent = r?.lie === "Holed" || (noPutts && r?.unit === "ft") ? "Finish hole \u2713" : "Next shot \u203A";
    if (!r) { mount(line, el("span", { class: "muted" }, noPutts ? "How far is left? Yards if you missed the green \u2014 or Hit green and how far from the pin." : "How far is left? Yards off the green, feet on it \u2014 or holed.")); return; }
    const sg = shotSG(shot, r);
    mount(line, [el("span", {}, r.lie === "Holed" ? "In the hole!" : noPutts && r.unit === "ft" ? `On the green, ${fmtD(r.dist, "ft")} from the pin` : `${fmtD(r.dist, r.unit)} left${r.unit === "ft" ? " on the green" : ""}${r.penalty ? " \u00b7 penalty stroke" : ""}`), el("strong", { class: `pr-sgchip ${sgCls(sg)}` }, `${SG(sg)} SG`)]);
  };
  num.addEventListener("input", () => { holed = false; update(); });
  num.addEventListener("keydown", (e) => { if (e.key === "Enter" && !nextBtn.disabled) next(); });
  pen.addEventListener("click", () => { penalty = !penalty; holed = false; update(); });
  holeBtn.addEventListener("click", () => {
    if (noPutts) { unit = "ft"; holed = false; penalty = false; update(); num.focus(); return; }
    holed = !holed; if (holed) { num.value = ""; penalty = false; } update();
  });
  // tap-ins: one tap for the usual leaves on the green
  const quickFt = noPutts ? [5, 10, 15, 20, 30, 40] : [1, 2, 3, 4, 6, 10];
  const quick = noPutts || shot.unit === "ft" || shot.startDist <= 60 ? el("div", { class: "pr-quick" }, quickFt.map((f) => { const b = el("button", { type: "button", class: "pr-chip" }, `${f} ft`); b.addEventListener("click", () => { unit = "ft"; holed = false; num.value = String(f); update(); }); return b; })) : null;
  const say = SpeechRec ? (() => {
    const b = el("button", { type: "button", class: "btn ghost pr-say voice-mic" }, sayKids("Say it"));
    b.addEventListener("click", () => {
      const rec = new SpeechRec();
      rec.lang = navigator.language || "en-US"; rec.maxAlternatives = 3;
      mount(b, sayKids("Listening…")); b.dataset.listening = "1"; b.classList.add("on"); b.disabled = true;
      rec.onresult = (e) => {
        const alts = [...e.results[0]].map((a) => a.transcript);
        const got = alts.map((t) => resultFromWords(t, wordsToNumbers, golfFix)).find(Boolean);
        if (!got) { delete b.dataset.listening; b.classList.remove("on"); mount(b, sayKids(`Didn’t catch “${alts[0]}”`)); return; }
        holed = got.lie === "Holed"; penalty = !!got.penalty;
        if (!holed) { unit = got.unit === "ft" ? "ft" : "yds"; num.value = String(got.dist); }
        update();
      };
      rec.onend = () => { b.disabled = false; if (b.dataset.listening) mount(b, sayKids("Say it")); delete b.dataset.listening; b.classList.remove("on"); };
      rec.onerror = () => { b.disabled = false; b.classList.remove("on"); delete b.dataset.listening; mount(b, sayKids("Say it")); };
      try { rec.start(); } catch { b.disabled = false; }
    });
    return b;
  })() : null;
  update();
  return el("div", { class: "pr-dist-entry" }, [
    line,
    el("div", { class: "pr-dist-row" }, [el("label", { class: "pr-dist-big" }, [el("span", { class: "rd-label" }, "Distance left"), el("div", { class: "pr-dist-in" }, [num, el("span", { class: "pr-unit" }, unit)])]), holeBtn]),
    unitBox, quick,
    el("div", { class: "pr-actions" }, [say, pen, nextBtn]),
    el("p", { class: "muted small pr-tip" }, noPutts ? "Say it like \u201c150\u201d or \u201cgreen, 18 feet\u201d. 0 ft is holed. Off the green is scored as if from the fairway." : "Say it like \u201c150\u201d, \u201c12 feet\u201d, \u201cmade it\u201d or \u201cwater, 160\u201d. Off the green is scored as if from the fairway."),
  ]);
}

function drawRound(ctx, s) {
  const game = gameOf(s);
  // just finished a hole: show how it went, then on
  if (ctx.view.k === "after") { const h = s.holes.find((x) => x.n === ctx.view.hole); if (h?.done) return drawHoleDone(ctx, s, h, game); }
  const idx = s.holes.findIndex((h) => !h.done);
  if (idx < 0) return finishRound(ctx, s);
  const hole = s.holes[idx];
  s.cur = idx;
  if (!s.pending || s.pending.holeN !== hole.n || s.pending.kind !== "dist") { s.pending = { ...nextShot(hole), holeN: hole.n }; ctx.save(s); }
  const shot = s.pending;
  const sm = sumOf(s);
  const commit = () => {
    if (!shot.result) return;
    const res = shot.result;
    const { holeN, ...clean } = shot; void holeN;
    delete clean.result; delete clean.sg;
    playShot(hole, clean, res, { noPutts: !!s.opts?.noPutts });
    s.pending = null;
    ctx.save(s);
    if (hole.done) ctx.go({ name: "round", session: s, k: "after", hole: hole.n });
    else ctx.go({ name: "round", session: s, k: `${hole.n}-${hole.shots.length}`, hole: hole.n });
  };
  const undo = hole.shots.length ? el("button", { type: "button", class: "link" }, "↶ Undo last shot") : null;
  undo?.addEventListener("click", () => { undoShot(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `${hole.n}-${hole.shots.length}-u`, hole: hole.n }); });
  const pick = el("button", { type: "button", class: "link pr-pickup" }, "Pick up");
  pick.addEventListener("click", () => { if (!confirmAction(`Pick up on this hole? It counts as ${Math.max(hole.strokes + 1, hole.par + 3)}.`)) return; pickUp(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: "after", hole: hole.n }); });
  const end = el("button", { type: "button", class: "link danger" }, game ? "End game" : "End round");
  end.addEventListener("click", () => finishRound(ctx, s, true));
  const what = shot.unit === "ft" ? `Putt · ${fmtD(shot.startDist, "ft")}` : shot.startLie === "Tee box" ? `Tee shot · ${shot.startDist} yds` : `${fmtD(shot.startDist, "yds")} to go`;
  const card = el("section", { class: "panel pr-shot pr-dshot" }, [
    el("div", { class: "pr-shot-t" }, [
      el("p", { class: "pr-eyebrow" }, `${hole.short ? `Spot ${hole.n}` : `Hole ${hole.n}`} · Par ${hole.par}${hole.short ? "" : ` · ${hole.length} yds`} · Shot ${shot.n}`),
      el("h2", {}, what),
      el("p", { class: "pr-shot-sub" }, `${CATS[shot.rcat].label} · Tour baseline from here ${(shot.unit === "ft" ? expectedStrokes("Green", shot.startDist) : expectedStrokes(shot.startLie === "Tee box" ? "Tee box" : "Fairway", shot.startDist)).toFixed(2)} strokes`),
      hole.from ? el("p", { class: "muted small" }, `From ${hole.from}`) : null,
    ]),
    holeStrip(hole, shot),
    resultPanel(shot, (r) => { shot.result = r || undefined; ctx.save(s); }, commit, { noPutts: !!s.opts?.noPutts }),
    el("div", { class: "pr-more" }, [undo, el("span", { class: "pr-more-links" }, [pick, end])]),
  ]);
  const thru = sm.holes;
  const bar = el("div", { class: "pr-bar pr-round-bar" }, [
    el("div", { class: "pr-bar-l" }, [el("strong", {}, game ? game.title : s.course?.name || "Round"), el("span", { class: "muted" }, s.course?.part || "")]),
    el("div", { class: "pr-prog" }, el("i", { style: `--w:${(thru / s.holes.length) * 100}%` })),
    el("div", { class: "pr-bar-r" }, [el("span", { class: "muted small" }, thru ? `thru ${thru}` : `${s.holes.length} holes`), el("strong", {}, thru ? (game ? `${sm.score}` : toParText(sm.toPar)) : "E"), el("span", { class: `small ${sgCls(sm.sgTotal)}` }, thru ? `${SG(sm.sgTotal, 1)} SG` : "")]),
  ]);
  const live = game ? (() => { const g = gameProgress(game, s), pb = personalBest(game, ctx.sessions); return el("div", { class: `pr-game-live ${g.status}` }, [el("span", {}, [el("strong", {}, targetText(game)), pb != null ? ` · Best ${pb}` : ""]), el("span", {}, g.need)]); })() : null;
  const holeShots = hole.shots.length ? el("section", { class: "panel pr-list" }, [el("h2", {}, `${hole.short ? "Spot" : "Hole"} ${hole.n} so far`), el("ol", { class: "pr-hole-shots" }, hole.shots.map(shotLi))]) : null;
  mount(ctx.body, [bar, live, card, holeShots, scorecardStrip(s)]);
  setTimeout(() => card.querySelector(".pr-bignum")?.focus({ preventScroll: true }), 50);
}

const shotText = (x) => (x.kind === "dist" || !x.kind ? (x.unit === "ft" ? `Putt from ${fmtD(x.startDist, "ft")}` : x.startLie === "Tee box" ? `Tee shot, ${x.startDist} yds` : `From ${fmtD(x.startDist, "yds")}`) : `${x.startDist} ${x.kind === "putt" ? "ft" : "yds"}`);
const leftText = (r) => (!r ? "" : r.lie === "Holed" ? "Holed" : `${fmtD(r.dist, r.unit)} left${r.penalty ? " + penalty" : ""}`);
const shotLi = (x) => el("li", {}, [el("span", {}, `${CATS[x.rcat]?.short || ""} · ${shotText(x)}`), el("span", { class: "muted" }, leftText(x.result)), el("span", { class: sgCls(x.sg) }, SG(x.sg))]);

function drawHoleDone(ctx, s, hole, game) {
  const sg = hole.shots.reduce((t, x) => t + (x.sg || 0), 0);
  const np = !!s.opts?.noPutts && !hole.short, reg = hole.par - 2;
  const name = hole.pickedUp ? "Picked up" : np ? (hole.prox != null || hole.strokes <= reg ? (hole.strokes <= reg ? (hole.strokes < reg ? `${reg - hole.strokes} under regulation` : "In regulation") : `${hole.strokes - reg} over regulation`) : scoreName(hole.strokes, hole.par)) : scoreName(hole.strokes, hole.par);
  const isLast = s.holes.every((h) => h.done);
  const next = el("button", { type: "button", class: "btn pr-go" }, isLast ? (game ? "See your score ✓" : "Finish round ✓") : `Next ${hole.short ? "spot" : "hole"} ›`);
  next.addEventListener("click", () => { if (isLast) finishRound(ctx, s); else { s.cur = s.holes.findIndex((h) => !h.done); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `start-${s.cur}`, hole: s.holes[s.cur].n }); } });
  const undo = el("button", { type: "button", class: "link" }, "↶ Undo last shot");
  undo.addEventListener("click", () => { if (hole.pickedUp) { hole.done = false; hole.pickedUp = false; hole.strokes = hole.shots.reduce((t, x) => t + 1 + (x.result?.penalty ? 1 : 0), 0); } else undoShot(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `undo-${hole.n}-${hole.shots.length}`, hole: hole.n }); });
  const sm = sumOf(s);
  const cmp = np ? reg : hole.par;
  const cls = hole.strokes < cmp ? "under" : hole.strokes === cmp ? "par" : "over";
  mount(ctx.body, [
    el("section", { class: `panel pr-hole-done ${cls}` }, [
      el("p", { class: "pr-eyebrow" }, `${hole.short ? "Spot" : "Hole"} ${hole.n} · Par ${hole.par}${hole.short ? ` · ${hole.length} yds` : ` · ${hole.length} yds`}`),
      np && hole.prox != null
        ? el("div", { class: "pr-big" }, [el("strong", {}, `On in ${hole.strokes}`), el("span", {}, `${fmtD(hole.prox, "ft")} from the pin \u00b7 ${name}`)])
        : el("div", { class: "pr-big" }, [el("strong", {}, String(hole.strokes)), el("span", {}, name)]),
      el("p", {}, [el("span", { class: sgCls(sg) }, `${SG(sg)} strokes gained`), np ? null : el("span", { class: "muted" }, ` \u00b7 Tour baseline ${holeExpected(hole).toFixed(2)}`)]),
      el("ol", { class: "pr-hole-shots" }, hole.shots.map(shotLi)),
      el("p", { class: "muted" }, game ? `${sm.score} strokes after ${sm.holes} of ${s.holes.length}` : np ? `${toParText(sm.toPar)} against regulation through ${sm.holes} \u00b7 ${SG(sm.sgTotal, 1)} SG` : `${toParText(sm.toPar)} through ${sm.holes} \u00b7 ${SG(sm.sgTotal, 1)} SG`),
      next, el("p", { class: "center" }, undo),
    ]),
    scorecardStrip(s),
  ]);
}

/** A little scorecard: each hole's par and score, coloured. */
function scorecardStrip(s) {
  const np = !!s.opts?.noPutts;
  return el("div", { class: "pr-strip", "aria-label": "Scorecard" }, s.holes.map((h) => {
    const cmp = np && !h.short ? h.par - 2 : h.par;
    return el("span", { class: `pr-strip-h ${h.done ? (h.strokes < cmp ? "under" : h.strokes === cmp ? "par" : "over") : ""}` }, [el("i", {}, String(h.n)), el("b", {}, h.done ? String(h.strokes) : "\u00b7"), el("em", {}, np ? (h.prox != null ? `${Math.round(h.prox)}\u2032` : `P${h.par}`) : `P${h.par}`)]);
  }));
}

async function finishRound(ctx, s, early = false) {
  const played = s.holes.filter((h) => h.done).length;
  if (early) {
    if (!played) { if (!confirmAction("No holes finished. Discard this?")) return; await ctx.remove(s.id); ctx.home(); return; }
    if (!confirmAction(`End here, after ${played} of ${s.holes.length}?`)) return;
  }
  const game = gameOf(s);
  s.pending = null;
  s.status = "done";
  s.finishedAt = new Date().toISOString();
  const sm = sumOf(s);
  s.summary = sm;
  if (game) {
    const before = personalBest(game, ctx.sessions.filter((x) => x.id !== s.id));
    const complete = played === s.holes.length;
    s.game = { score: sm.score, target: game.target, complete, passed: complete && passedIt(game, sm.score), best: complete && (before == null || sm.score < before) };
  }
  await ctx.save(s, true);
  ctx.go({ name: "roundEnd", session: s });
}

/* ============================================== the end of a round ============================================== */
function drawEnd(ctx, s) {
  const game = gameOf(s);
  const sm = s.summary?.sg ? s.summary : sumOf(s);
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
      el("div", { class: "pr-big" }, [el("strong", {}, String(sm.score)), el("span", {}, game ? `strokes (par ${sm.par})` : sm.noPutts ? `strokes to the green \u00b7 ${toParText(sm.toPar)} against regulation \u00b7 ${sm.holes} hole${sm.holes === 1 ? "" : "s"}` : `${toParText(sm.toPar)} \u00b7 ${sm.holes} hole${sm.holes === 1 ? "" : "s"}`)]),
      game ? el("p", { class: "pr-verdict" }, [s.game?.passed ? "✓ Target beaten" : s.game?.complete === false ? "Unfinished" : "Target missed", ` (${targetText(game).toLowerCase()})`, s.game?.best ? el("span", { class: "pr-pb" }, "New personal best") : ""]) : null,
      el("p", { class: "muted" }, [el("span", { class: sgCls(sm.sgTotal) }, `${SG(sm.sgTotal)} strokes gained`), sm.noPutts ? " against the Tour baselines (putting left out)" : ` against the Tour baselines (${sm.expected.toFixed(1)} from these yardages)`]),
    ]),
    again,
  ]);
  const max = Math.max(0.5, ...CAT_ORDER.map((c) => Math.abs(sm.sg[c])));
  const bars = el("div", { class: "pr-sgbars" }, CAT_ORDER.filter((c) => played.some((h) => h.shots.some((x) => x.rcat === c))).map((c) => {
    const v = sm.sg[c];
    return el("div", { class: "pr-sgbar" }, [el("span", {}, CATS[c].label), el("div", { class: "pr-sgbar-track" }, el("i", { class: v >= 0 ? "pos" : "neg", style: `--w:${(Math.abs(v) / max) * 50}%` })), el("strong", { class: sgCls(v) }, SG(v))]);
  }));
  const tiles = el("div", { class: "pr-tiles" }, [
    sm.gir ? tile(sm.noPutts ? "Greens in regulation" : "Greens", `${sm.gir.hit}/${sm.gir.of}`) : null,
    sm.noPutts && sm.prox != null ? tile("Avg proximity", fmtD(sm.prox, "ft"), "", "on the greens hit") : null,
    sm.noPutts ? null : tile("Putts", String(sm.putts)),
    sm.scrambling ? tile("Scrambling", `${sm.scrambling.made}/${sm.scrambling.of}`) : null,
    sm.upDowns ? tile("Up & downs", `${sm.upDowns.made}/${sm.upDowns.of}`) : null,
    tile("Penalties", String(sm.penalties)),
  ].filter(Boolean));
  const all = played.flatMap((h) => h.shots.map((x) => ({ ...x, holeN: h.n }))).filter((x) => x.sg != null);
  const best = [...all].filter((x) => x.sg > 0).sort((a, b) => b.sg - a.sg).slice(0, 3), worst = [...all].filter((x) => x.sg < 0).sort((a, b) => a.sg - b.sg).slice(0, 3);
  const li = (x) => el("li", {}, [el("span", {}, `${game ? "Spot" : "Hole"} ${x.holeN} · ${shotText(x)}`), el("span", { class: "muted" }, leftText(x.result)), el("span", { class: sgCls(x.sg) }, SG(x.sg))]);
  const card = el("div", { class: "table-scroll" }, el("table", { class: "plain pr-scorecard" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, game ? "Spot" : "Hole"), el("th", { class: "num" }, "Par"), el("th", { class: "num" }, "Yds"), el("th", { class: "num" }, sm.noPutts ? "On in" : "Score"), sm.noPutts ? el("th", { class: "num" }, "Prox") : null, ...CAT_ORDER.filter((c) => !sm.noPutts || c !== "PUTT").map((c) => el("th", { class: "num" }, CATS[c].short)), el("th", { class: "num" }, "SG")])),
    el("tbody", {}, played.map((h) => {
      const by = (c) => h.shots.filter((x) => x.rcat === c).reduce((t, x) => t + (x.sg || 0), 0);
      const tot = h.shots.reduce((t, x) => t + (x.sg || 0), 0);
      const cmp = sm.noPutts && !h.short ? h.par - 2 : h.par;
      const cls = h.strokes < cmp ? "under" : h.strokes === cmp ? "par" : "over";
      return el("tr", {}, [el("td", {}, String(h.n)), el("td", { class: "num" }, String(h.par)), el("td", { class: "num" }, String(h.length)), el("td", { class: "num" }, el("span", { class: `pr-sc ${cls}` }, String(h.strokes))),
        sm.noPutts ? el("td", { class: "num" }, h.prox != null ? fmtD(h.prox, "ft") : h.shots.at(-1)?.result?.lie === "Holed" ? "Holed" : "\u2014") : null,
        ...CAT_ORDER.filter((c) => !sm.noPutts || c !== "PUTT").map((c) => { const has = h.shots.some((x) => x.rcat === c), v = by(c); return el("td", { class: `num ${has ? sgCls(v) : ""}` }, has ? sg1(v) : ""); }),
        el("td", { class: `num ${sgCls(tot)}` }, sg1(tot))]);
    })),
  ]));
  mount(ctx.body, [
    el("p", { class: "crumb pr-crumb" }, [back, del]),
    hero,
    el("section", { class: "panel" }, [el("h2", {}, "Strokes gained by category"), bars, tiles]),
    el("section", { class: "panel" }, [el("h2", {}, "Scorecard"), card]),
    all.length ? el("section", { class: "panel pr-bestworst" }, [
      el("div", {}, [el("h2", {}, "Best shots"), best.length ? el("ol", { class: "pr-hole-shots" }, best.map(li)) : el("p", { class: "muted" }, "None gained on the Tour baselines.")]),
      el("div", {}, [el("h2", {}, "Costliest shots"), worst.length ? el("ol", { class: "pr-hole-shots" }, worst.map(li)) : el("p", { class: "muted" }, "None lost a stroke to the Tour baselines.")]),
    ]) : null,
  ]);
}
