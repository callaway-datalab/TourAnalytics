/*
 * (update 488) Course Prep › Course Insights: the course report's first pages, from the shot-level data (see
 * courseInsights in courseShots.js): the course overview (cut line and Top 25 / Top 10 / winning scores, each hole's shot
 * values and fairway widths), the aggressiveness index, the attempt distribution against every course, the field (or the
 * player picked) against the Top 10 finishers by hole and by distance, then each hole: its scoring, which tee miss costs
 * more, and up & down by where the approach missed the green.
 */
import { el, mount, infoTip } from "../ui.js";
import { heatData, listHeatCourses } from "../courseHeat.js";
import { pickWho } from "./coursePrepExtras.js";
import { playerTrails, trailSG, bucketOf, ATT_B, SG_B } from "../courseShots.js";

const GREEN = "#1E9600", YELLOW = "#FCB714", RED = "#C40000", HI = "#4DB94B";
const mix = (a, b, f) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(",")})`; };
/** red below zero, yellow at it, green above (as the report's bars), scaled to the biggest either way */
const signCol = (v, big) => (v >= 0 ? mix(YELLOW, GREEN, Math.min(1, v / (big || 1))) : mix(YELLOW, RED, Math.min(1, -v / (big || 1))));
const toPar = (v) => (v == null ? "—" : v > 0 ? `+${v}` : v === 0 ? "E" : `−${Math.abs(v)}`);
const sgn = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0.0049 ? "+" : v < -0.0049 ? "−" : ""}${Math.abs(v).toFixed(d)}`);
const pct = (a, n) => (n ? Math.round((100 * a) / n) : null);
const mean2 = (o) => (o && o[0] ? o[1] / o[0] : null); // [n, sum] → average

export async function drawInsights(ctx, course) {
  const meta = course.heat;
  const back = el("button", { type: "button", class: "link" }, `← ${course.name}`);
  back.addEventListener("click", () => ctx.go({ name: "prepMenu", course }));
  const body = el("div", {}, el("p", { class: "muted ta-loading" }, "Loading the course insights…"));
  let who = null;
  const W = await pickWho(ctx, (p) => { who = p; draw(); });
  who = W.who;
  const sub = el("p", { class: "muted small" });
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel ci-head" }, [
    el("p", { class: "pr-eyebrow" }, `${course.name}${course.mapEvents ? ` · ${course.mapEvents}` : ""}`),
    el("div", { class: "sh-title" }, [el("h1", {}, "Course Insights"), infoTip("From every shot hit here (the same data as Strategy Maps). Top 10: those who finished in the top 10 (ties included) of each year’s event, worked out from their scores; the cut line, Top 25, Top 10 and winning scores are each year’s, averaged. Strokes gained are against this course’s own field.")]),
    W.node, sub]), body]);
  let data;
  try { data = await heatData(meta); } catch (err) { console.error(err); mount(body, el("p", { class: "empty" }, "Couldn’t load the course. Try again.")); return; }
  const I = data?.insights;
  if (!I) { mount(body, el("p", { class: "empty" }, "No insights for this course yet: upload its shot data again (Upload Data › Strategy Maps, or course_upload.py) to work them out.")); return; }
  const all = await listHeatCourses().catch(() => []);
  const holeNums = Object.keys(I.holes).map(Number).sort((a, b) => a - b);
  const yardsOf = (h) => data.holes?.[h]?.yards || meta.yards?.[h - 1] || null;

  async function draw() {
    // the subject: the field, or the player picked (their own trails here), against the Top 10 (without them)
    let mine = null;
    if (who) { const tr = await playerTrails(meta, who.key).catch(() => null); mine = tr?.trails?.length ? tr.trails : null; }
    const name = who && mine ? who.label : "Field";
    const first = who && mine ? who.label.split(" ")[0] : "the field";
    mount(sub, who && !mine ? `No shots for ${who.label} at this course: showing the field.` : `${name} vs the Top 10 finishers${I.events.length ? ` · ${I.events.map((e) => e.y).join(", ")}` : ""}`);
    const subj = subject(I, mine, who && mine ? who.key : null);
    mount(body, [overview(I, holeNums, yardsOf), aggression(I, holeNums), attempts(I, all, subj, name), vsTop(I, holeNums, yardsOf, subj, name, first), holesBlock(I, holeNums, yardsOf, subj, name)]);
  }
  await draw();
}

/** The subject's numbers: per hole (scoring), strokes gained a round by distance, attempts; and the Top 10's without them. */
function subject(I, mine, key) {
  const sc = () => ({ n: 0, sum: 0, e: 0, b: 0, p: 0, g: 0 });
  if (!mine) return { holes: Object.fromEntries(Object.entries(I.holes).map(([h, X]) => [h, X.field])), top: Object.fromEntries(Object.entries(I.holes).map(([h, X]) => [h, X.top])), sg: I.sg.field, rounds: I.sg.fieldRounds, topSg: I.sg.top, topRounds: I.sg.topRounds, attempts: I.attempts, field: true };
  const holes = {}, top = {}, sgS = {}, sgMeTop = {}, rs = new Set(), rsTop = new Set(), att = {}, topSet = new Set(I.top || []);
  for (const h of Object.keys(I.holes)) { holes[h] = sc(); top[h] = { ...I.holes[h].top }; }
  for (const t of mine) {
    const X = I.holes[t.h]; if (!X) continue;
    const qs = [...t.shots].sort((a, b) => a[0] - b[0]), wasTop = topSet.has(`${key}|${t.y}`);
    for (const q of qs) { const b = bucketOf(q, X.par, false); if (b) att[b] = (att[b] || 0) + 1; }
    const one = {}; trailSG({ ...t, shots: qs }, X.par, I.sg.E, one);
    for (const [b, v] of Object.entries(one)) { sgS[b] = (sgS[b] || 0) + v; if (wasTop) sgMeTop[b] = (sgMeTop[b] || 0) + v; }
    rs.add(`${t.y}|${t.r}`); if (wasTop) rsTop.add(`${t.y}|${t.r}`);
    if (t.s == null) continue;
    const o = holes[t.h]; o.n++; o.sum += t.s; o[t.s <= -2 ? "e" : t.s === -1 ? "b" : t.s === 0 ? "p" : "g"]++;
    if (wasTop) { const T = top[t.h]; T.n--; T.sum -= t.s; T[t.s <= -2 ? "e" : t.s === -1 ? "b" : t.s === 0 ? "p" : "g"]--; } // (the Top 10 without them)
  }
  const topSg = {}; for (const b of new Set([...Object.keys(I.sg.top), ...Object.keys(sgMeTop)])) topSg[b] = (I.sg.top[b] || 0) - (sgMeTop[b] || 0);
  return { holes, top, sg: sgS, rounds: rs.size, topSg, topRounds: I.sg.topRounds - rsTop.size, attempts: att, field: false };
}

const avgOf = (o, par) => (o?.n ? par + o.sum / o.n : null);
const section = (title, kids, note = null) => el("section", { class: "panel ci-sec" }, [el("h2", { class: "ci-h" }, title), ...kids, note ? el("p", { class: "muted small ci-note" }, note) : null]);

/* ---------------- Course overview: the scores to beat, then each hole's shot values and fairway widths ---------------- */
function overview(I, holeNums, yardsOf) {
  const ev = I.events, av = (k) => { const v = ev.map((e) => e[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const tiles = [["Avg Cutline", av("cut"), RED], ["Top 25 Score", av("top25"), "#ff8c00"], ["Top 10 Score", av("top10"), "#ffb300"], ["Winning Score", av("win"), GREEN]]
    .map(([l, v, c]) => el("div", { class: "ci-tile" }, [el("span", { class: "ci-tile-l" }, l), el("strong", { style: `color:${c}` }, toPar(v))]));
  const val = (X, k) => { const o = X[k]; if (!o) return null; if (k === "go") { const g = o.go, l = o.lay; if (!g || !l || g[0] < 5 || l[0] < 5) return null; if (X.par === 4 && g[0] < 0.1 * (X.field.n || 1)) return null; return mean2(l) - mean2(g); } const h = o.hit, m = o.miss; if (!h || !m || h[0] < 5 || m[0] < 5) return null; return mean2(m) - mean2(h); };
  const rows = holeNums.map((h) => { const X = I.holes[h]; return { h, par: X.par, yds: yardsOf(h), fwy: X.par >= 4 ? val(X, "fwy") : null, gir: val(X, "gir"), go: X.par >= 4 ? val(X, "go") : null, w: X.widths || {} }; });
  const q75 = (k) => { const v = rows.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length >= 4 ? v[Math.floor(0.75 * (v.length - 1))] : Infinity; };
  const cut = { fwy: q75("fwy"), gir: q75("gir"), go: q75("go") };
  const cell = (r, k) => el("td", { class: "num", style: r[k] != null && r[k] >= cut[k] && r[k] > 0 ? `background:${HI};color:#fff` : null }, r[k] == null ? "" : r[k].toFixed(2));
  const table = el("div", { class: "table-scroll" }, el("table", { class: "plain ch-t ci-t" }, [
    el("thead", {}, [el("tr", {}, [el("th", { colspan: 3 }, ""), el("th", { colspan: 3, class: "ci-grp" }, "Shot Value"), el("th", { colspan: 4, class: "ci-grp" }, "Fwy Widths")]),
      el("tr", {}, ["Hole", "Par", "Yds", "Hit Fwy", "Hit GIR", "Going For It", "250 yds", "275 yds", "300 yds", "325 yds"].map((t, i) => el("th", { class: i ? "num" : null }, t)))]),
    el("tbody", {}, rows.map((r) => el("tr", {}, [el("td", {}, String(r.h)), el("td", { class: "num" }, String(r.par)), el("td", { class: "num" }, r.yds ? String(r.yds) : "—"), cell(r, "fwy"), cell(r, "gir"), cell(r, "go"),
      ...["250", "275", "300", "325"].map((c) => el("td", { class: "num" }, r.w[c] != null ? String(r.w[c]) : ""))]))),
  ]));
  return section("COURSE OVERVIEW", [el("div", { class: "ci-tiles" }, tiles), el("p", { class: "muted small" }, `To par, the average of ${ev.length} ${ev.length === 1 ? "event" : "events"} (${ev.map((e) => e.y).join(", ")}).${ev.some((e) => e.cut != null) ? "" : " No cut in these events."}`), table],
    "Hit Fwy: how much higher the scoring average is for those who missed the fairway than for those who hit it. Hit GIR: the same for the green in regulation. Going For It (par 5s and drivable par 4s): those who laid up (30–100 yds left) against those who went for it (inside 30 yds). Higher = more important; green = the most important holes. Fwy widths: yards across the fairway where tee shots finished, that far out.");
}

/* ---------------- Aggressiveness index: birdie+ %, bogey+ % and the difference, by hole ---------------- */
function aggression(I, holeNums) {
  const rows = holeNums.map((h) => { const f = I.holes[h].field, n = f.n || 1; const bp = (100 * (f.e + f.b)) / n, bo = (100 * f.g) / n; return { h, bp, bo, ix: (bp - bo) / 100 }; });
  const col = (title, get, colour, fmt, max) => el("div", { class: "ci-bars" }, [el("h3", {}, title), ...rows.map((r) => {
    const v = get(r), w = Math.min(100, (Math.abs(v) / (max || 1)) * 100);
    return el("div", { class: "ci-bar-row" }, [el("span", { class: "ci-bar-k" }, String(r.h)), el("span", { class: `ci-bar-track${v < 0 ? " neg" : ""}` }, el("i", { style: `width:${w}%;background:${colour(v)}` })), el("span", { class: "ci-bar-v" }, fmt(v))]);
  })]);
  const maxB = Math.max(...rows.map((r) => r.bp)), minB = Math.min(...rows.map((r) => r.bp)), maxO = Math.max(...rows.map((r) => r.bo)), minO = Math.min(...rows.map((r) => r.bo)), maxI = Math.max(...rows.map((r) => Math.abs(r.ix)));
  return section("AGGRESSIVENESS INDEX", [el("div", { class: "ci-three" }, [
    col("Birdie+ %", (r) => r.bp, (v) => mix(YELLOW, GREEN, (v - minB) / ((maxB - minB) || 1)), (v) => `${Math.round(v)}%`, 100),
    col("Bogey+ %", (r) => r.bo, (v) => mix(YELLOW, RED, (v - minO) / ((maxO - minO) || 1)), (v) => `${Math.round(v)}%`, 100),
    col("Aggressiveness Index", (r) => r.ix, (v) => signCol(v, maxI), (v) => sgn(v), maxI),
  ])], "Aggressiveness Index = Birdie+ % minus Bogey+ %. Higher: more birdies than bogeys here, a hole to attack.");
}

/* ---------------- Attempt distribution: shots by distance here, against every course's ---------------- */
function attempts(I, all, subj, name) {
  const tour = {}; for (const c of all) for (const [b, n] of Object.entries(c.attempts || {})) tour[b] = (tour[b] || 0) + n;
  const tt = Object.values(tour).reduce((a, b) => a + b, 0), st = Object.values(subj.attempts).reduce((a, b) => a + b, 0);
  if (!st) return null;
  const vals = ATT_B.map((b) => ({ b, v: (100 * (subj.attempts[b] || 0)) / st, t: tt ? (100 * (tour[b] || 0)) / tt : null, putt: /ft$/.test(b) }));
  const max = Math.max(...vals.map((x) => Math.max(x.v, x.t || 0))) * 1.12 || 1;
  const chart = el("div", { class: "ci-cols" }, vals.map((x) => el("div", { class: "ci-col", title: `${x.b}: ${x.v.toFixed(1)}%${x.t != null ? ` (every course ${x.t.toFixed(1)}%)` : ""}` }, [
    el("div", { class: "ci-col-area" }, [el("span", { class: "ci-col-v" }, `${Math.round(x.v)}%`), el("i", { class: "ci-col-bar", style: `height:${(x.v / max) * 100}%;background:${x.putt ? "#1f7a1f" : "#f59e0b"}` }), x.t != null ? el("b", { class: "ci-col-avg", style: `bottom:${(x.t / max) * 100}%` }) : null]),
    el("span", { class: "ci-col-k" }, x.b)])));
  const item = (sw, t) => el("span", { class: "ci-lg-i" }, [sw, t]);
  const legend = el("p", { class: "ci-legend" }, [item(el("i", { class: "ci-sw avg" }), "Every course"), item(el("i", { class: "ci-sw", style: "background:#1f7a1f" }), "Putts"), item(el("i", { class: "ci-sw", style: "background:#f59e0b" }), "Approach / around the green")]);
  return section(`HISTORICAL ATTEMPT DISTRIBUTION – ${name.toUpperCase()}`, [legend, el("div", { class: "ci-cols-scroll" }, chart)], `Share of ${subj.field ? "the field’s" : `${name}’s`} shots here by distance (not tee shots on par 4s and 5s). Below the gray line: fewer shots from there than on an average course (of the ${all.length} with shot data); above it: more.`);
}

/* ---------------- Against the Top 10: scoring by hole, strokes gained by distance ---------------- */
function vsTop(I, holeNums, yardsOf, subj, name, first) {
  const hs = holeNums.map((h) => { const par = I.holes[h].par, a = avgOf(subj.holes[h], par), t = avgOf(subj.top[h], par); return { h, par, yds: yardsOf(h), v: a != null && t != null ? t - a : null, a }; });
  const maxH = Math.max(...hs.map((x) => Math.abs(x.v || 0))) || 1;
  const holeChart = el("div", { class: "ci-bars ci-diverge" }, [el("h3", {}, "Scoring Avg vs Top 10"), el("div", { class: "ci-bar-row ci-bar-hd" }, [el("span", { class: "ci-bar-k" }, "Hole"), el("span", { class: "ci-bar-k2" }, "Par"), el("span", { class: "ci-bar-k2" }, "Yds"), el("span", {}, ""), el("span", { class: "ci-bar-v" }, "")]),
    ...hs.map((x) => el("div", { class: "ci-bar-row" }, [el("span", { class: "ci-bar-k" }, String(x.h)), el("span", { class: "ci-bar-k2" }, String(x.par)), el("span", { class: "ci-bar-k2" }, x.yds ? String(x.yds) : "—"), divBar(x.v, maxH), el("span", { class: "ci-bar-v" }, x.v == null ? "—" : sgn(x.v))]))]);
  const sg = SG_B.map((b) => { const me = subj.rounds ? (subj.sg[b] || 0) / subj.rounds : null, tp = subj.topRounds ? (subj.topSg[b] || 0) / subj.topRounds : null; return { b, v: me != null && tp != null ? me - tp : null }; }).filter((x) => x.v != null && (subj.sg[x.b] != null || subj.topSg[x.b] != null)).sort((a, b) => b.v - a.v);
  const maxS = Math.max(...sg.map((x) => Math.abs(x.v))) || 1;
  const sgChart = el("div", { class: "ci-bars ci-diverge" }, [el("h3", {}, "SG / Round vs Top 10"), ...sg.map((x) => el("div", { class: "ci-bar-row" }, [el("span", { class: "ci-bar-k ci-wide" }, x.b), divBar(x.v, maxS), el("span", { class: "ci-bar-v" }, sgn(x.v))]))]);
  const worstH = hs.filter((x) => x.v != null && x.v < 0).sort((a, b) => a.v - b.v).slice(0, 5).map((x) => x.h), worstD = [...sg].filter((x) => x.v < 0).sort((a, b) => a.v - b.v).slice(0, 5).map((x) => x.b);
  const line = worstH.length || worstD.length ? `Top 10 finishers here separate themselves from ${first} mainly on ${worstH.length ? `holes ${worstH.join(", ")}` : ""}${worstH.length && worstD.length ? " and " : ""}${worstD.length ? `from ${worstD.join(", ")}` : ""}.` : `${name} scores as well as the Top 10 here.`;
  return section(`COURSE INSIGHTS – ${name.toUpperCase()} VS TOP 10`, [el("p", { class: "ci-lead" }, line), el("div", { class: "ci-two" }, [holeChart, sgChart])],
    `Scoring Avg vs Top 10: the Top 10’s scoring average less ${subj.field ? "the field’s" : `${name}’s`} (red: they score better). SG / Round: strokes gained a round from each distance, ${subj.field ? "the field" : name} less the Top 10 (against this course’s own field).`);
}
const divBar = (v, max) => { const w = v == null ? 0 : Math.min(50, (Math.abs(v) / max) * 50); return el("span", { class: "ci-dv" }, [el("i", { class: "ci-dv-mid" }), v == null ? null : el("i", { class: "ci-dv-bar", style: `${v >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${signCol(v, max)}` })]); };

/* ---------------- Each hole: its scoring, the worse tee miss, up & down by where the approach missed ---------------- */
function holesBlock(I, holeNums, yardsOf, subj, name) {
  const diff = holeNums.map((h) => { const X = I.holes[h]; return { h, d: X.field.n ? X.field.sum / X.field.n : -9 }; }).sort((a, b) => b.d - a.d);
  const hcp = new Map(diff.map((x, i) => [x.h, i + 1]));
  const cards = holeNums.map((h) => holeCard(h, I.holes[h], yardsOf(h), hcp.get(h), subj, name));
  return section("HOLE BY HOLE", [el("div", { class: "ci-holes" }, cards)], `Handicap: 1 is the hardest hole here (the field’s scoring to par). Tee miss and up & down: the field (everyone’s shots here). Up & down: holed in two from where the approach missed the green, within 30 yards.`);
}
const udCol = (p) => (p == null ? "#333" : p >= 75 ? "#4CAF50" : p >= 50 ? "#FFB343" : "#ff453a");
function holeCard(h, X, yds, hcp, subj, name) {
  const a = subj.holes[h], t = subj.top[h], par = X.par;
  const row = (lbl, o) => el("tr", {}, [el("th", {}, lbl), el("td", { class: "num" }, o?.n ? (par + o.sum / o.n).toFixed(2) : "—"), el("td", { class: "num" }, o?.n ? `${pct(o.e + o.b, o.n)}%` : "—"), el("td", { class: "num" }, o?.n ? `${pct(o.p, o.n)}%` : "—"), el("td", { class: "num" }, o?.n ? `${pct(o.g, o.n)}%` : "—")]);
  const sc = el("table", { class: "plain ci-hs" }, [el("thead", {}, el("tr", {}, ["", "Score", "Birdie+", "Par", "Bogey+"].map((x, i) => el("th", { class: i ? "num" : null }, x)))), el("tbody", {}, [row(subj.field ? "Field" : name.split(" ")[0], a), row("Top 10", t)])]);
  // the tee: left against right misses (drive_direction)
  let tee = null;
  if (par >= 4) {
    const L = X.drive?.L, R = X.drive?.R, C = X.drive?.C, ok = (o) => o && o[0] >= 5;
    if (ok(L) || ok(R)) {
      const avg = (o) => (ok(o) ? par + mean2(o) : null), aL = avg(L), aR = avg(R), aC = avg(C);
      const worse = aL != null && aR != null ? (aL > aR ? ["Left", aL - aR] : ["Right", aR - aL]) : null;
      tee = el("div", { class: "ci-tee" }, [el("h4", {}, "Off the tee"),
        el("div", { class: "ci-tee-row" }, [["Left miss", aL, L], ["Fairway", aC, C], ["Right miss", aR, R]].map(([l, v, o]) => el("div", { class: `ci-tee-c${worse && l.startsWith(worse[0]) ? " worse" : ""}` }, [el("span", { class: "muted small" }, l), el("strong", {}, v != null ? v.toFixed(2) : "—"), el("span", { class: "muted small" }, o?.[0] ? `${o[0]} shots` : "")]))),
        worse ? el("p", { class: "small" }, [el("strong", { style: `color:${RED}` }, `Worse miss: ${worse[0]}`), ` · ${worse[1].toFixed(2)} strokes higher than the ${worse[0] === "Left" ? "right" : "left"} miss`]) : null]);
    }
  }
  // up & down by where the approach missed (app_side_loc), and the lie it left
  let ud = null;
  const U = X.ud || {};
  if (Object.keys(U).length) {
    const cell = (side) => {
      const o = U[side] || {}, lies = ["Fairway", "Rough", "Bunker"].filter((l) => o[l]?.[0] >= 3);
      const tot = Object.values(o).reduce((s, a) => [s[0] + a[0], s[1] + a[1]], [0, 0]);
      return el("div", { class: "ci-ud-c" }, [el("span", { class: "ci-ud-k" }, side.replace("-", " ")),
        ...lies.map((l) => { const p = pct(o[l][1], o[l][0]); return el("span", { class: "ci-ud-l" }, [`${l} `, el("strong", { style: `color:${udCol(p)}` }, `${p}%`), el("span", { class: "muted" }, ` (${o[l][0]})`)]); }),
        !lies.length ? el("span", { class: "muted small" }, tot[0] ? `${tot[0]} ${tot[0] === 1 ? "miss" : "misses"}` : "—") : null]);
    };
    ud = el("div", { class: "ci-ud" }, [el("h4", {}, "Up & down by miss"), el("div", { class: "ci-ud-grid" }, [cell("Long-Left"), cell("Long"), cell("Long-Right"), cell("Left"), el("div", { class: "ci-ud-c ci-ud-green" }, "Green"), cell("Right"), cell("Short-Left"), cell("Short"), cell("Short-Right")])]);
  }
  return el("div", { class: "ci-hole" }, [el("div", { class: "ci-hole-h" }, [el("h3", {}, `Hole ${h} · Par ${par}`), el("span", { class: "muted small" }, `${yds ? `${yds} yds · ` : ""}Handicap `), el("strong", { class: "ci-hcp" }, String(hcp))]), sc, tee, ud]);
}
