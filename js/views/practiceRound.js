/*
 * Practice › Course Prep (update 139), and the play-it-out games (Up & Down 9, Approach Nine).
 *
 *   Simulate a random course: 18 or 9 made-up holes — or holes drawn at random from courses you know.
 *   A real course:           its pars and yards, from a scorecard you've saved in Enter New Round, one of your rounds
 *                            there, or one you type in; all of it, a nine, the par 3s or 5s, or your toughest holes.
 *   Playing:                 distance only. After each shot, how far is left: yards off the green, feet on it, or
 *                            holed. The lie is ignored (off the green is scored as if from the fairway).
 *   At the end:              score, strokes gained by category against the Tour baselines, greens, putts,
 *                            scrambling, the scorecard, and your best and costliest shots.
 */
import { el, mount, confirmAction } from "../ui.js";
import { CATS, holeLayout, shotFor, puttFrom, teeResult, greenResult, holeSpot } from "../practice/model.js";
import { randomHoles, courseHoles, nextShot, playShot, undoShot, pickUp, roundSummary, scoreName, holeExpected, shotSG, resultFromWords, playFiltered, filtText, YD_BUCKETS, FT_BUCKETS, FILTER_LIES } from "../practice/round.js";
import { gameProgress, personalBest, targetText, passedIt, gameOf } from "../practice/games.js";
import { wordsToNumbers, golfFix } from "../voiceShots.js";
import { expectedStrokes } from "../roundCalc.js";
import { trendSvg, holeSvg, greenSvg, puttSvg } from "../practice/draw.js";
import { SG, sgCls, tile, SpeechRec, sayKids, clubSelect, parseOff, fmtOff, offInput } from "./practiceShot.js";

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
  // (update 160) a real course: Course Maps, Course History or Simulate Round
  if (["prepMenu", "prepMaps", "prepHistory"].includes(v.name)) {
    const m = await import("./coursePrepExtras.js");
    return v.name === "prepMenu" ? m.drawPrepMenu(ctx, v.course) : v.name === "prepMaps" ? m.drawMaps(ctx, v.course) : m.drawHistory(ctx, v.course);
  }
  return drawHome(ctx);
}

/*
 * (update 157) What to play: everything to start, with dropdowns to leave out categories, distances, lies, pars and
 * (on a real course) holes. Shots you leave out are played for you at the Tour average (see practice/round.js).
 */
const CAT_NAMES = { OTT: "Tee shots", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
const ALL_DISTS = [...YD_BUCKETS, ...FT_BUCKETS].map((b) => b[0]);
const newFilt = (n = 0) => ({ cats: [...CAT_ORDER], dists: [...ALL_DISTS], lies: [...FILTER_LIES], pars: [3, 4, 5], holes: Array.from({ length: n }, (_, i) => i + 1) });
/** The filters a round keeps (null: everything). */
const playFilt = (f) => (f.cats.length === 4 && f.dists.length === ALL_DISTS.length && f.lies.length === FILTER_LIES.length ? null : { cats: [...f.cats], dists: [...f.dists], lies: [...f.lies] });
function dropdown(title, groups, f, key, onChange, extra = null) {
  const all = groups.flatMap(([, opts]) => opts.map((o) => o[0]));
  const sum = el("strong", {});
  const box = el("div", { class: "pr-dd-list" });
  const setAll = (on) => { f[key] = on ? [...all] : []; draw(); onChange(); };
  const linkBtn = (t, fn) => { const b = el("button", { type: "button", class: "link" }, t); b.addEventListener("click", fn); return b; };
  const draw = () => {
    const on = all.filter((v) => f[key].includes(v)), labels = groups.flatMap(([, o]) => o).filter((o) => f[key].includes(o[0])).map((o) => o[1]);
    sum.textContent = on.length === all.length ? "All" : !on.length ? "None" : on.length <= 2 ? labels.join(", ") : `${on.length} of ${all.length}`;
    sum.classList.toggle("some", on.length < all.length);
    mount(box, groups.map(([g, opts]) => el("div", { class: "pr-dd-group" }, [g ? el("p", { class: "pr-dd-g" }, g) : null, ...opts.map(([v, l]) => {
      const cb = el("input", { type: "checkbox", checked: f[key].includes(v) });
      cb.addEventListener("change", () => { f[key] = cb.checked ? [...f[key], v] : f[key].filter((x) => x !== v); draw(); onChange(); });
      return el("label", { class: "pr-dd-opt" }, [cb, el("span", {}, l)]);
    })])));
  };
  draw();
  const d = el("details", { class: "pr-dd" }, [el("summary", {}, [el("span", { class: "rd-label" }, title), sum]), el("div", { class: "pr-dd-menu" }, [
    el("div", { class: "pr-dd-top" }, [linkBtn("All", () => setAll(true)), linkBtn("None", () => setAll(false)), ...(extra ? extra(draw, onChange) : [])]), box])]);
  d.__redraw = draw;
  return d;
}
/** The dropdowns; onChange after any change. n: a real course's holes (0 on a random course). */
function filtersPanel(f, { n = 0, presets = [], onChange = () => {} } = {}) {
  const note = el("p", { class: "muted small pr-filt-note", "aria-live": "polite" });
  const check = () => {
    const bad = !f.cats.length ? "Pick at least one category." : !f.pars.length ? "Pick at least one par." : n && !f.holes.length ? "Pick at least one hole." : f.cats.some((c) => c !== "OTT") && !f.dists.length ? "Pick at least one distance." : !f.lies.length ? "Pick at least one lie." : "";
    const t = filtText(playFilt(f));
    note.textContent = bad || (t ? `Playing: ${t}. Everything else is played for you at the Tour average.` : "");
    note.classList.toggle("bad", !!bad);
    return !bad;
  };
  const changed = () => { check(); onChange(); };
  const dds = [
    dropdown("Categories", [[null, CAT_ORDER.map((c) => [c, CAT_NAMES[c]])]], f, "cats", changed),
    dropdown("Distances", [["Shots", YD_BUCKETS.map((b) => [b[0], b[1]])], ["Putts", FT_BUCKETS.map((b) => [b[0], b[1]])]], f, "dists", changed),
    dropdown("Lies", [[null, FILTER_LIES.map((l) => [l, l])]], f, "lies", changed),
    dropdown("Pars", [[null, [3, 4, 5].map((p) => [p, `Par ${p}s`])]], f, "pars", changed),
    n ? dropdown("Holes", [[null, Array.from({ length: n }, (_, i) => [i + 1, `Hole ${i + 1}`])]], f, "holes", changed, (draw, ch) => presets.map(([l, list]) => { const b = el("button", { type: "button", class: "link" }, l); b.addEventListener("click", () => { f.holes = [...list]; draw(); ch(); }); return b; })) : null,
  ];
  check();
  const wrap = el("div", { class: "pr-filters" }, [el("div", { class: "pr-dd-row" }, dds), note]);
  wrap.__ok = check;
  return wrap;
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
  const filt = newFilt();
  const filters = filtersPanel(filt);
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
    if (!filters.__ok()) return;
    const scale = TEES.find((t) => t[0] === opts.tees)[2];
    const holes = randomHoles({ holes: opts.holes, scale: opts.real ? 1 : scale, pool: opts.real ? pool : null, pars: filt.pars });
    const pf = playFilt(filt), parTxt = filt.pars.length < 3 ? `par ${filt.pars.join(" & ")}s` : "";
    startRound(ctx, { mode: "sim", course: { name: opts.real ? "Random course · your holes" : "Random course", part: [`${opts.holes} holes`, parTxt, filtText(pf)].filter(Boolean).join(" \u00b7 ") }, opts: { ...opts, filt: pf }, holes });
  });
  const random = el("section", { class: "panel pr-plan pr-random" }, [
    el("div", { class: "pr-sub" }, [el("div", {}, [el("h2", {}, "Simulate a random course"), el("p", { class: "muted small" }, "No course in mind? Play made-up holes, or holes drawn from the courses you know.")])]),
    el("div", { class: "pr-opts" }, [seg([[18, "18 holes"], [9, "9 holes"]], "holes", "Holes"), seg(TEES.map(([v, l, k]) => [v, `${l} · ${(Math.round(7250 * k / 50) * 50 / 1000).toFixed(1)}k`]), "tees", "Tees"), realRow]),
    el("h3", { class: "pr-filt-h" }, "What to play"), filters,
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
    b.addEventListener("click", () => ctx.go({ name: "prepMenu", course: c }));
    return b;
  })) : el("p", { class: "muted" }, "No courses yet. Courses you save a scorecard for in Enter New Round show up here, or type one in.");
  // (update 160) a real course, then a random one (update 162: a course's reports are inside it, under Course Maps)
  mount(ctx.body, [
    hero(), ...resumeRows(ctx),
    el("section", { class: "panel" }, [el("div", { class: "pr-sub" }, [el("div", {}, [el("h2", {}, "Prepare for a real course"), el("p", { class: "muted small" }, "Pick a course for its maps, your history there, or to simulate a round.")]), add]), cards]),
    random,
    historyPanel(ctx),
  ]);
}
const hero = () => el("section", { class: "panel pr-hero" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, "Play"), el("h1", {}, "Course Prep"),
  el("p", { class: "muted pr-lede" }, "A course's reports and maps, your history there, and a way to play it on the range shot by shot: after each one, how far you hit it and how far offline, scored against the Tour baselines.")])]);

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
    "Simulate a random course, or pick one you've saved a scorecard for in Enter New Round, one you've played, or type one in.",
    "Pick what to play: every shot, or just some categories, distances, lies and pars (only the par 3s, only approaches, only around the green…). The rest are played for you at the Tour average.",
    "Each hole has its par and yardage. Hit your shot, then enter how far you hit it and how far offline (a red dot shows where that is). What's left is worked out, and the next shot starts from there.",
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

/** Type in a course: name, then par and yards for each hole (saved as a scorecard, so Enter New Round can use it too). */
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
    ctx.go({ name: "prepMenu", course: c });
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
  const presets = [["All", Array.from({ length: n }, (_, i) => i + 1)], ...(n === 18 ? [["Front 9", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["Back 9", [10, 11, 12, 13, 14, 15, 16, 17, 18]]] : []),
    ...(worst.length >= 3 ? [[`Your toughest ${worst.length}`, worst]] : [])];
  const filt = newFilt(n);
  const table = el("div", { class: "table-scroll" });
  const onlyOf = () => course.par.map((p, i) => i + 1).filter((h) => filt.holes.includes(h) && filt.pars.includes(course.par[h - 1] || 4));
  const drawTable = () => {
    const only = onlyOf();
    mount(table, el("table", { class: "plain pr-card-table" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Hole"), el("th", { class: "num" }, "Par"), el("th", { class: "num" }, "Yds"), el("th", { class: "num" }, "Tour baseline"), avgs.length ? el("th", { class: "num" }, "Your avg") : null])),
      el("tbody", {}, course.par.map((p, i) => {
        const a = avgs.find((x) => x.n === i + 1), y = Number(course.yards[i]);
        return el("tr", { class: !only.includes(i + 1) ? "off" : "" }, [el("td", {}, String(i + 1)), el("td", { class: "num" }, String(p)), el("td", { class: "num" }, y ? String(y) : "\u2014"),
          el("td", { class: "num" }, y ? expectedStrokes("Tee box", y).toFixed(2) : "\u2014"),
          avgs.length ? el("td", { class: `num ${a ? (a.avg > 0.4 ? "neg" : a.avg < 0 ? "pos" : "") : ""}` }, a ? `${a.avg >= 0 ? "+" : "\u2212"}${Math.abs(a.avg).toFixed(1)}` : "\u2014") : null]);
      })),
    ]));
  };
  const filters = filtersPanel(filt, { n, presets, onChange: drawTable });
  drawTable();
  const go = el("button", { type: "button", class: "btn pr-go" }, "Tee off \u25B6");
  go.addEventListener("click", () => {
    if (!filters.__ok()) return;
    const only = onlyOf();
    if (!only.length) { ctx.flash?.("None of those holes are the pars you picked.", "error"); return; }
    const holes = courseHoles({ par: course.par, yards: course.yards, only });
    const pf = playFilt(filt);
    const part = [only.length < n ? `${only.length} hole${only.length === 1 ? "" : "s"}` : "", filtText(pf)].filter(Boolean).join(" \u00b7 ");
    startRound(ctx, { mode: "prep", course: { name: course.name, part }, opts: { filt: pf }, holes });
  });
  const back = el("button", { type: "button", class: "link" }, `← ${course.name}`);
  back.addEventListener("click", () => ctx.go({ name: "prepMenu", course }));
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, `Simulate Round${course.tees ? ` · ${course.tees} tees` : ""}`), el("h1", {}, course.name),
    el("h2", {}, "What to play"), filters, table,
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
/*
 * Entering a shot in Course Prep (update 154), the way Enter New Round does it, but with how far you hit it and how far
 * offline rather than where it started and finished: where it finished, and what's left, are worked out and carried
 * to the next shot. On a random course the made-up hole decides the lie (fairway, rough, bunker, water, out of
 * bounds, the green); on a real course you pick where it finished.
 */
function entryPanel(shot, { vis = null, target: tgt = null, noPutts = false } = {}, onChange, next) {
  const putt = shot.unit === "ft";
  const r0 = shot.result;
  const num = (val, label) => el("input", { type: "text", inputmode: "decimal", class: "pr-bignum", value: val ?? "", "aria-label": label, placeholder: "0", autocomplete: "off" });
  // (update 160) offline is one signed number: minus is left
  const hitIn = num(r0?.hit ?? "", putt ? "Rolled (ft)" : "Hit distance (yds)"), { input: offIn, pm: offPm } = offInput(fmtOff(r0?.off), putt ? "Offline (ft), minus is left" : "Offline (yds), minus is left", { class: "pr-bignum", placeholder: "0" });
  let holed = r0?.lie === "Holed";
  // a real course: where it finished (the made-up hole works it out on a random course)
  let endLie = r0?.endLie || "Fairway";
  const LIE_CHIPS = ["Fairway", "Rough", "Bunker", "Fringe", "Green", "Water", "OB"];
  const lieBox = !vis && !putt ? el("div", { class: "pr-lies" }) : null;
  const drawLies = () => lieBox && mount(lieBox, LIE_CHIPS.map((l) => { const b = el("button", { type: "button", class: `pr-chip${endLie === l ? " on" : ""}` }, l === "OB" ? "Out of bounds" : l); b.addEventListener("click", () => { endLie = l; drawLies(); update(); }); return b; }));
  const holedBtn = el("button", { type: "button", class: "btn ghost pr-holed" }, putt ? "✓ Made" : "✓ Holed");
  holedBtn.addEventListener("click", () => { holed = !holed; update(); });
  const line = el("p", { class: "pr-result", "aria-live": "polite" });
  const nextBtn = el("button", { type: "button", class: "btn pr-next", disabled: true }, "Next shot ›");
  nextBtn.addEventListener("click", () => next());
  let pt = null; // (update 157) where it finished on the picture: the red dot
  const compute = () => {
    const target = typeof tgt === "function" ? tgt() : tgt;
    pt = null;
    if (holed) return { lie: "Holed", dist: 0, unit: "ft" };
    const h = Number(String(hitIn.value).replace(",", ".")), o = parseOff(offIn.value);
    if (!(h > 0)) return null;
    if (!Number.isFinite(o)) return "side";
    const off = o, keep = { hit: h, off };
    if (putt) pt = { x: off, y: h - shot.startDist };
    if (putt) { const d = Math.round(Math.hypot(off, h - shot.startDist) * 10) / 10; return d <= 0.2 ? { lie: "Holed", dist: 0, unit: "ft", ...keep } : { lie: "Green", dist: d, unit: "ft", ...keep }; }
    if (vis?.kind === "tee") {
      const line0 = target && target.y > 0 ? (target.x * h) / target.y : 0;
      pt = { x: line0 + off, y: h };
      const t = teeResult(vis, Math.round(h), Math.round(line0 + off));
      return { lie: t.penalty === "ob" ? "OB" : t.penalty ? "Penalty" : t.lie, dist: t.dist, unit: "yds", ...(t.penalty ? { penalty: t.penalty } : {}), zone: t.zone, ...(t.adj ? { adj: t.adj } : {}), ...keep };
    }
    if (vis?.kind === "green") {
      const tx = target?.x ?? vis.pin.x, ty = target?.y ?? vis.pin.y, fx = vis.from.x, fy = vis.from.y, dd = Math.hypot(tx - fx, ty - fy) || 1, ux = (tx - fx) / dd, uy = (ty - fy) / dd;
      pt = { x: fx + ux * h + uy * off, y: fy + uy * h - ux * off };
      const g = greenResult(vis, pt.x, pt.y);
      if (g.unit === "ft" && g.dist <= 0.3) return { lie: "Holed", dist: 0, unit: "ft", ...keep };
      return { lie: g.lie, dist: g.dist, unit: g.unit, ...(g.penalty ? { penalty: g.penalty } : {}), ...(g.zone ? { zone: g.zone } : {}), ...(g.adj ? { adj: g.adj } : {}), ...keep };
    }
    // a real course: straight down the line to the hole
    const left = Math.max(1, Math.round(Math.hypot(shot.startDist - h, off)));
    if (endLie === "OB") return { lie: "OB", dist: shot.startDist, unit: "yds", penalty: "ob", endLie, ...keep };
    if (endLie === "Water") return { lie: "Penalty", dist: left, unit: "yds", penalty: "water", endLie, ...keep };
    if (endLie === "Green" || endLie === "Fringe") return { lie: endLie, dist: Math.round(Math.hypot(shot.startDist - h, off) * 3 * 10) / 10, unit: "ft", endLie, ...keep };
    return { lie: endLie, dist: left, unit: "yds", endLie, ...keep };
  };
  const update = () => {
    holedBtn.classList.toggle("on", holed);
    const r = compute();
    const ok = r && r !== "side";
    lastPreview.set(shot, ok ? pt : null);
    wrap.closest(".pr-shot")?.querySelector(".pr-visual svg")?.__preview?.(ok ? pt : null);
    onChange(ok ? r : null);
    nextBtn.disabled = !ok;
    nextBtn.textContent = ok && (r.lie === "Holed" || (noPutts && r.unit === "ft")) ? "Finish hole ✓" : "Next shot ›";
    line.hidden = !r;
    if (r === "side") { mount(line, el("span", { class: "muted" }, "Offline: a number, minus for left (e.g. \u22128).")); return; }
    if (!ok) { mount(line, null); return; }
    const sg = shotSG(shot, r);
    const where = r.lie === "Holed" ? "In the hole!" : r.penalty === "ob" ? `${r.zone || "Out of bounds"} · replay, a stroke added` : r.penalty ? `${r.zone || "Water"} · penalty stroke, ${fmtD(r.dist, "yds")} left` : r.unit === "ft" ? `${r.lie === "Fringe" ? "Fringe" : "On the green"}, ${fmtD(r.dist, "ft")} from the pin` : `${r.zone || r.lie}, ${fmtD(r.dist, "yds")} left`;
    mount(line, [el("span", {}, where), el("strong", { class: `pr-sgchip ${sgCls(sg)}` }, `${SG(sg)} SG`)]);
  };
  [hitIn, offIn].forEach((x) => { x.addEventListener("input", update); x.addEventListener("keydown", (e) => { if (e.key === "Enter" && !nextBtn.disabled) next(); }); });
  const wrap = el("div", { class: "pr-dist-entry pr-hit-entry" }, [
    line,
    el("div", { class: "pr-hit-row" }, [
      el("label", { class: "pr-dist-big" }, [el("span", { class: "rd-label" }, putt ? "Rolled" : "Hit Distance"), el("div", { class: "pr-dist-in" }, [hitIn, el("span", { class: "pr-unit" }, putt ? "ft" : "yds")])]),
      el("label", { class: "pr-dist-big" }, [el("span", { class: "rd-label" }, vis ? "Offline from aim line" : "Offline"), el("div", { class: "pr-off-row" }, [el("div", { class: "pr-dist-in" }, [offIn, el("span", { class: "pr-unit" }, putt ? "ft" : "yds")]), offPm])]),
    ]),
    lieBox ? el("div", {}, [el("span", { class: "rd-label" }, "Finished in"), lieBox]) : null,
    el("div", { class: "pr-actions" }, [holedBtn, nextBtn]),
    el("p", { class: "muted small pr-tip" }, putt ? "Rolled: how far the ball went (past the hole is more than the putt's length). Offline: minus is left." : vis ? "Offline: off your target line, minus is left, plus is right (\u00b1 flips it). Where it finished, and what's left, come from the hole." : "Offline: minus is left, plus is right. What's left is worked out from how far you hit it and how far offline."),
  ]);
  wrap.__update = update; // (the target moved: what it finished as, and the dot, follow)
  // (update 169) a tap on the picture: the shot finished there (how far, and how far off the target line)
  wrap.__place = (h, off) => {
    holed = false;
    hitIn.value = String(putt ? Math.round(h * 10) / 10 : Math.round(h));
    offIn.value = fmtOff(putt ? Math.round(off * 10) / 10 : Math.round(off));
    update();
  };
  drawLies(); update();
  return wrap;
}
const lastPreview = new WeakMap(); // shot → the red dot's spot (kept when the picture's redrawn)

function resultPanel(shot, onChange, next, { noPutts = false } = {}) {
  // (update 151) one box, "Distance left", and a Hit Green button: on → feet from the pin (0 = holed), off → yards
  let green = shot.unit === "ft", penalty = false;
  if (shot.result) { green = shot.result.unit === "ft"; penalty = !!shot.result.penalty; }
  const holedAlready = shot.result?.lie === "Holed";
  const num = el("input", { type: "text", inputmode: "decimal", class: "pr-bignum", placeholder: "0", autocomplete: "off", "aria-label": "Distance left", value: shot.result ? (holedAlready ? "0" : String(shot.result.dist)) : "" });
  const pen = el("button", { type: "button", class: "pr-chip pr-pen", "aria-pressed": "false" }, "+1 penalty");
  const greenBtn = el("button", { type: "button", class: "btn ghost pr-hitgreen", "aria-pressed": "false" }, "\u26F3 Hit Green");
  const unitLbl = el("span", { class: "pr-unit" });
  const line = el("p", { class: "pr-result", "aria-live": "polite" });
  const nextBtn = el("button", { type: "button", class: "btn pr-next", disabled: true }, "Next shot \u203A");
  nextBtn.addEventListener("click", () => next());
  const result = () => {
    const raw = String(num.value).trim().replace(",", ".");
    if (green && raw !== "" && Number(raw) === 0) return { lie: "Holed", dist: 0, unit: "ft" };
    const d = Number(raw);
    if (!(d > 0)) return null;
    return { lie: green ? "Green" : "Off", dist: d, unit: green ? "ft" : "yds", ...(penalty && !green ? { penalty: true } : {}) };
  };
  const update = () => {
    greenBtn.classList.toggle("on", green); greenBtn.setAttribute("aria-pressed", String(green));
    unitLbl.textContent = green ? "ft" : "yds";
    pen.hidden = green; pen.classList.toggle("on", penalty); pen.setAttribute("aria-pressed", String(penalty));
    const r = result();
    onChange(r);
    nextBtn.disabled = !r;
    nextBtn.textContent = r?.lie === "Holed" || (noPutts && r?.unit === "ft") ? "Finish hole \u2713" : "Next shot \u203A";
    if (!r) { mount(line, el("span", { class: "muted" }, green ? "On the green: how many feet from the pin? (0 = holed)" : "How many yards are left? Tap Hit Green if you're on.")); return; }
    const sg = shotSG(shot, r);
    mount(line, [el("span", {}, r.lie === "Holed" ? "In the hole!" : r.unit === "ft" ? `On the green, ${fmtD(r.dist, "ft")} from the pin` : `${fmtD(r.dist, r.unit)} left${r.penalty ? " \u00b7 penalty stroke" : ""}`), el("strong", { class: `pr-sgchip ${sgCls(sg)}` }, `${SG(sg)} SG`)]);
  };
  num.addEventListener("input", update);
  num.addEventListener("keydown", (e) => { if (e.key === "Enter" && !nextBtn.disabled) next(); });
  pen.addEventListener("click", () => { penalty = !penalty; update(); });
  greenBtn.addEventListener("click", () => { green = !green; if (green) penalty = false; update(); num.focus(); });
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
        penalty = !!got.penalty;
        if (got.lie === "Holed") { green = true; num.value = "0"; } else { green = got.unit === "ft"; num.value = String(got.dist); }
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
    el("div", { class: "pr-dist-row" }, [el("label", { class: "pr-dist-big" }, [el("span", { class: "rd-label" }, "Distance left"), el("div", { class: "pr-dist-in" }, [num, unitLbl])]), greenBtn]),
    el("div", { class: "pr-actions" }, [say, pen, nextBtn]),
    el("p", { class: "muted small pr-tip" }, "Say it like \u201c150\u201d, \u201c12 feet\u201d, \u201cmade it\u201d or \u201cwater, 160\u201d. With Hit Green on, 0 is holed. Off the green is scored as if from the fairway."),
  ]);
}

/*
 * A random course's picture for the shot (update 153): the hole off the tee, the green on approaches and chips, the
 * putt on the green, drawn once per shot and kept with it. Tap to move your target; picking a club sets the
 * target's distance to that club's carry. The strokes gained map (off to start) colours each landing spot by what
 * it would gain against the Tour baseline from here.
 */
function visFor(hole, shot) {
  if (shot.unit === "ft") return puttFrom(Math.max(1, shot.startDist));
  if (shot.startLie === "Tee box" && hole.par >= 4) return holeLayout({ length: hole.length, par: hole.par });
  const d = Math.max(5, Math.round(shot.startDist));
  return shotFor(d <= 50 ? "ARG" : "APP", d, { lie: "Fairway", pin: "mixed" });
}
function simVisual(ctx, s, hole, shot) {
  // (a hole's layout off the tee stays the same, e.g. replaying after out of bounds)
  if (!shot.vis) {
    const teeShot = shot.startLie === "Tee box" && hole.par >= 4 && shot.unit !== "ft";
    shot.vis = teeShot && hole.teeVis ? hole.teeVis : JSON.parse(JSON.stringify(visFor(hole, shot)));
    if (teeShot) hole.teeVis = shot.vis;
    ctx.save(s);
  }
  const v = shot.vis;
  const box = el("div", { class: "pr-visual pr-sim" });
  const label = el("p", { class: "muted small pr-target" });
  let sgOn = false; // the strokes gained map: off to start, every shot
  const sgStart = shot.unit === "ft" ? null : v.kind === "tee" ? expectedStrokes("Tee box", v.hole) : expectedStrokes(["Tee box", "Fairway", "Rough", "Bunker", "Fringe"].includes(shot.startLie) ? shot.startLie : "Fairway", Math.max(1, shot.startDist));
  // the target: down the middle at your club's carry off the tee; at the pin otherwise
  const defTarget = () => (v.kind === "tee" ? { x: 0, y: Math.min(ctx.carryFor?.(shot.clubUsed || "Driver") || 275, v.hole - 40) } : v.kind === "green" ? { x: v.pin.x, y: v.pin.y } : null);
  shot.target ||= defTarget();
  const tdist = () => (v.kind === "tee" ? Math.round(Math.hypot(shot.target.x, shot.target.y)) : Math.round(Math.hypot(shot.target.x - v.from.x, shot.target.y - v.from.y)));
  const draw = () => {
    // (update 169) tap the picture: your shot finished there (as in Custom practice). Hold the target's circle and
    // drag to move the target.
    const entry = () => box.closest(".pr-shot")?.querySelector(".pr-hit-entry");
    const place = (h, off) => entry()?.__place?.(h, off);
    if (v.kind === "putt") {
      mount(box, puttSvg(v, { showHeat: sgOn, preview: lastPreview.get(shot), onTap: (x, y) => place(y + shot.startDist, x) }));
      label.textContent = "Tap the picture where the putt finished.";
      return;
    }
    const moved = () => entry()?.__update?.();
    const aimAt = v.kind === "tee" ? (total, offline) => { shot.target = { x: offline, y: total }; ctx.save(s); draw(); moved(); } : (x, y) => { shot.target = { x, y }; ctx.save(s); draw(); moved(); };
    const tapTee = (total, offline) => { const t = shot.target, line0 = t && t.y > 0 ? (t.x * total) / t.y : 0; place(total, offline - line0); };
    const tapGreen = (x, y) => {
      const t = shot.target || v.pin, fx = v.from.x, fy = v.from.y, dd = Math.hypot(t.x - fx, t.y - fy) || 1, ux = (t.x - fx) / dd, uy = (t.y - fy) / dd;
      const dx = x - fx, dy = y - fy;
      place(dx * ux + dy * uy, dx * uy - dy * ux);
    };
    mount(box, v.kind === "tee"
      ? holeSvg(v, { aim: shot.target, showHeat: sgOn, carry: shot.target.y, onTap: tapTee, sgStart, onAim: (x, y) => aimAt(y, x), preview: lastPreview.get(shot), pinLine: true })
      : greenSvg(v, { aim: shot.target, showHeat: sgOn, onTap: tapGreen, sgStart, aimLine: true, onAim: (x, y) => aimAt(x, y), preview: lastPreview.get(shot), pinLine: true }));
    const side = v.kind === "tee" ? shot.target.x : 0;
    label.textContent = `Target: ${tdist()} yds${v.kind === "tee" && Math.abs(side) >= 1 ? `, ${Math.round(Math.abs(side))} ${side < 0 ? "left" : "right"} of the middle` : ""}. Gold: to your target; grey: on to the pin. Tap the picture where your shot finished; hold the target's circle and drag to move it.`;
  };
  // a club: its carry becomes the target's distance (same direction)
  const club = shot.unit !== "ft" && ctx.clubs ? clubSelect(ctx.clubs, shot.clubUsed || null, (c) => {
    shot.clubUsed = c || undefined;
    const carry = c ? ctx.carryFor?.(c) : null;
    if (carry && shot.target) {
      if (v.kind === "tee") { const d = Math.hypot(shot.target.x, shot.target.y) || 1; shot.target = { x: (shot.target.x / d) * carry, y: (shot.target.y / d) * carry }; }
      else { const dx = shot.target.x - v.from.x, dy = shot.target.y - v.from.y, d = Math.hypot(dx, dy) || 1; shot.target = { x: v.from.x + (dx / d) * carry, y: v.from.y + (dy / d) * carry }; }
    }
    ctx.save(s); draw(); box.closest(".pr-shot")?.querySelector(".pr-hit-entry")?.__update?.();
  }) : null;
  const sgBtn = el("button", { type: "button", class: `pr-toggle${sgOn ? " on" : ""}`, "aria-pressed": String(!!sgOn) }, "Strokes gained map");
  sgBtn.addEventListener("click", () => { sgOn = !sgOn; sgBtn.classList.toggle("on", sgOn); sgBtn.setAttribute("aria-pressed", String(sgOn)); draw(); });
  draw();
  return el("div", { class: "pr-sim-wrap" }, [box, el("div", { class: "pr-vis-tools" }, [sgBtn, label]), club]);
}

/*
 * The hole's stroke trail (update 156): every shot so far drawn on the hole from above, tee to where it finished.
 * A random course uses its made-up hole; otherwise (a par 3, a real hole) a plain straight hole of that length.
 */
function resetHole(hole) { hole.shots = []; hole.done = false; hole.pickedUp = false; hole.strokes = 0; delete hole.prox; delete hole.rest; }
function trailLayout(hole) {
  if (hole.teeVis) return hole.teeVis;
  return { kind: "tee", hole: hole.length, width: hole.par === 3 ? 26 : 30, sides: { left: { kind: "rough", at: 30 }, right: { kind: "rough", at: 30 } }, bunker: null, startLie: "Tee box", startDist: hole.length, carry: Math.min(hole.length, 280) };
}
function trailOf(hole, layout, pick = -1) {
  const H = holeSpot(layout), out = [];
  let cur = { x: 0, y: 0 };
  hole.shots.forEach((x, i) => {
    const r = x.result || {};
    let end;
    if (r.lie === "Holed") end = { ...H };
    else if (r.penalty === "ob") end = { ...cur };
    else if (i === 0 && r.hit != null && x.startLie === "Tee box" && layout === hole.teeVis) {
      const t = x.target, line0 = t && t.y > 0 ? (t.x * r.hit) / t.y : 0;
      end = { x: line0 + (r.off || 0), y: r.hit };
    } else {
      const dx = H.x - cur.x, dy = H.y - cur.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const yd = (v) => (x.unit === "ft" ? v / 3 : v);
      // with what's left (the result), else how far it was hit
      const left = r.dist != null ? (r.unit === "ft" ? r.dist / 3 : r.dist) : null, hit = r.hit != null ? yd(r.hit) : left != null ? Math.max(0, d - left) : 0, off = r.off != null ? yd(r.off) : 0;
      end = { x: cur.x + ux * hit + uy * off, y: cur.y + uy * hit - ux * off };
    }
    out.push({ ...end, label: String(i + 1), on: i === pick });
    cur = end;
  });
  return out;
}
function trailPanel(hole, pick = -1, onClose = null) {
  const layout = trailLayout(hole);
  const close = onClose ? el("button", { type: "button", class: "link" }, "Close") : null;
  close?.addEventListener("click", onClose);
  return el("section", { class: "panel pr-trail" }, [
    el("div", { class: "pr-sub" }, [el("h2", {}, `${hole.short ? "Spot" : "Hole"} ${hole.n}, shot by shot`), close]),
    el("div", { class: "pr-visual pr-sim" }, holeSvg(layout, { full: true, showHeat: false, trail: trailOf(hole, layout, pick), carry: layout.carry || 260 })),
    pick >= 0 ? el("p", { class: "muted small" }, `Shot ${pick + 1}: ${shotText(hole.shots[pick])} · ${leftText(hole.shots[pick].result)}`) : null,
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
  if (!s.pending || s.pending.holeN !== hole.n || s.pending.kind !== "dist") {
    // (update 157) only some shots: the others are played for you; the hole may finish without one you picked
    const ns = s.opts?.filt ? playFiltered(hole, s.opts.filt, { drive: ctx.carryFor?.("Driver") || 250 }) : nextShot(hole);
    if (!ns) {
      if (!hole.shots.some((x) => !x.auto)) { s.holes = s.holes.filter((h) => h !== hole); if (!s.holes.length) { ctx.flash?.("Nothing on these holes matches what you picked.", "error"); ctx.remove(s.id).then(() => ctx.home()); return; } }
      s.pending = null; ctx.save(s);
      return hole.shots.some((x) => !x.auto) ? ctx.go({ name: "round", session: s, k: "after", hole: hole.n }) : drawRound(ctx, s);
    }
    s.pending = { ...ns, holeN: hole.n }; ctx.save(s);
  }
  const shot = s.pending;
  const sm = sumOf(s);
  const commit = () => {
    if (!shot.result) return;
    const res = shot.result;
    const { holeN, ...clean } = shot; void holeN;
    delete clean.result; delete clean.sg; delete clean.vis; // (the picture stays with the shot being played; the target stays for the trail)
    playShot(hole, clean, res, { noPutts: !!s.opts?.noPutts });
    if (s.opts?.filt && !hole.done) playFiltered(hole, s.opts.filt, { drive: ctx.carryFor?.("Driver") || 250 });
    s.pending = null;
    ctx.save(s);
    if (hole.done) ctx.go({ name: "round", session: s, k: "after", hole: hole.n });
    else ctx.go({ name: "round", session: s, k: `${hole.n}-${hole.shots.length}`, hole: hole.n });
  };
  const undo = hole.shots.some((x) => !x.auto) ? el("button", { type: "button", class: "link" }, "↶ Undo last shot") : null;
  undo?.addEventListener("click", () => { undoShot(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `${hole.n}-${hole.shots.length}-u`, hole: hole.n }); });
  const reset = hole.shots.length ? el("button", { type: "button", class: "link" }, "Reset hole") : null;
  reset?.addEventListener("click", () => { if (!confirmAction(`Start hole ${hole.n} again? Its ${hole.shots.length} shot${hole.shots.length === 1 ? "" : "s"} are cleared.`)) return; resetHole(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `reset-${hole.n}-${Date.now()}`, hole: hole.n }); });
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
    // a random course: its made-up hole from above; a real one: the strip down the hole
    s.mode === "sim" ? simVisual(ctx, s, hole, shot) : holeStrip(hole, shot),
    s.mode !== "sim" && shot.unit !== "ft" && ctx.clubs ? clubSelect(ctx.clubs, shot.clubUsed || null, (v) => { shot.clubUsed = v || undefined; ctx.save(s); }) : null,
    entryPanel(shot, { vis: s.mode === "sim" ? shot.vis : null, target: () => shot.target, noPutts: !!s.opts?.noPutts }, (r) => { shot.result = r || undefined; ctx.save(s); }, commit),
    el("div", { class: "pr-more" }, [undo, el("span", { class: "pr-more-links" }, [reset, pick, end])]),
  ]);
  const thru = sm.holes;
  const bar = el("div", { class: "pr-bar pr-round-bar" }, [
    el("div", { class: "pr-bar-l" }, [el("strong", {}, game ? game.title : s.course?.name || "Round"), el("span", { class: "muted" }, s.course?.part || "")]),
    el("div", { class: "pr-prog" }, el("i", { style: `--w:${(thru / s.holes.length) * 100}%` })),
    el("div", { class: "pr-bar-r" }, [el("span", { class: "muted small" }, thru ? `thru ${thru}` : `${s.holes.length} holes`), el("strong", {}, thru ? (game ? `${sm.score}` : toParText(sm.toPar)) : "E"), el("span", { class: `small ${sgCls(sm.sgTotal)}` }, thru ? `${SG(sm.sgTotal, 1)} SG` : "")]),
  ]);
  const live = game ? (() => { const g = gameProgress(game, s), pb = personalBest(game, ctx.sessions); return el("div", { class: `pr-game-live ${g.status}` }, [el("span", {}, [el("strong", {}, targetText(game)), pb != null ? ` · Best ${pb}` : ""]), el("span", {}, g.need)]); })() : null;
  // the shots so far: tap one to see the hole's trail with it picked out (update 156)
  const trailBox = el("div");
  const showTrail = (i) => { mount(trailBox, trailPanel(hole, i, () => mount(trailBox, null))); trailBox.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
  const holeShots = hole.shots.length ? el("section", { class: "panel pr-list" }, [
    el("div", { class: "pr-sub" }, [el("h2", {}, `${hole.short ? "Spot" : "Hole"} ${hole.n} so far`), (() => { const b = el("button", { type: "button", class: "link" }, "See the hole"); b.addEventListener("click", () => showTrail(-1)); return b; })()]),
    el("ol", { class: "pr-hole-shots pr-tap-shots" }, hole.shots.map((x, i) => { const li = shotLi(x); li.tabIndex = 0; li.title = "See it on the hole"; li.addEventListener("click", () => showTrail(i)); li.addEventListener("keydown", (e) => { if (e.key === "Enter") showTrail(i); }); return li; })),
    trailBox,
  ]) : null;
  mount(ctx.body, [bar, live, holeShots, card, scorecardStrip(s)]);
  setTimeout(() => card.querySelector(".pr-bignum")?.focus({ preventScroll: true }), 50);
}

const shotText = (x) => (x.kind === "dist" || !x.kind ? (x.unit === "ft" ? `Putt from ${fmtD(x.startDist, "ft")}` : x.startLie === "Tee box" ? `Tee shot, ${x.startDist} yds` : `From ${fmtD(x.startDist, "yds")}`) : `${x.startDist} ${x.kind === "putt" ? "ft" : "yds"}`);
const leftText = (r) => (!r ? "" : `${r.hit != null ? `Hit ${r.hit}${r.off ? ` \u00b7 ${r.off > 0 ? "+" : "\u2212"}${Math.abs(r.off)} offline` : ""} \u2192 ` : ""}${r.lie === "Holed" ? "Holed" : r.penalty === "ob" ? "OB" : `${["Fairway", "Rough", "Bunker", "Fringe"].includes(r.lie) ? `${r.lie}, ` : r.unit === "ft" ? "Green, " : ""}${fmtD(r.dist, r.unit)} left${r.penalty ? " + penalty" : ""}`}`);
const shotLi = (x) => el("li", { class: x.auto ? "pr-auto" : null }, [el("span", {}, `${CATS[x.rcat]?.short || ""} · ${shotText(x)}`), el("span", { class: "muted" }, leftText(x.result)), x.auto ? el("span", { class: "muted small" }, "Tour avg") : el("span", { class: sgCls(x.sg) }, SG(x.sg))]);

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
      hole.rest ? el("p", { class: "muted small" }, `The rest of the hole, ${hole.rest} stroke${hole.rest === 1 ? "" : "s"}, at the Tour average from there.`) : null,
      hole.shots.length ? trailPanel(hole) : null,
      el("p", { class: "muted" }, game ? `${sm.score} strokes after ${sm.holes} of ${s.holes.length}` : np ? `${toParText(sm.toPar)} against regulation through ${sm.holes} \u00b7 ${SG(sm.sgTotal, 1)} SG` : `${toParText(sm.toPar)} through ${sm.holes} \u00b7 ${SG(sm.sgTotal, 1)} SG`),
      next, el("p", { class: "center" }, [undo, " \u00b7 ", (() => { const b = el("button", { type: "button", class: "link" }, "Reset hole"); b.addEventListener("click", () => { if (!confirmAction(`Start hole ${hole.n} again?`)) return; resetHole(hole); s.pending = null; ctx.save(s); ctx.go({ name: "round", session: s, k: `reset-${hole.n}-${Date.now()}`, hole: hole.n }); }); return b; })()]),
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
