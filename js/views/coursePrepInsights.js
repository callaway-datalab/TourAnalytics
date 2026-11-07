/*
 * (update 488; redesigned in update 491) Course Prep › Course Insights, from the shot-level data (courseInsights in
 * courseShots.js): the scores to beat, a game plan in plain words (holes to attack and to play safe, where the fairway, the
 * green and going for it matter most, the tee miss to avoid), every hole as a tile (tap for its numbers), the shots this
 * course asks for against an average course, and where the Top 10 finishers gain. Field, or the player picked.
 */
import { el, mount, infoTip, icon } from "../ui.js";
import { BRAND, TAG, readCard, readFor, playerAim, playerProfileFrom } from "../calRead.js"; // (update 589)
import { heatData, listHeatCourses, withMerges, pinsOn, pinLabel } from "../courseHeat.js";
import { pickWho, playerData } from "./coursePrepExtras.js";
import { playerTrails, trailSG, bucketOf, ATT_B, skillsOf } from "../courseShots.js";

const SC = { e: ["Eagle+", "#1f4fd1"], b: ["Birdie", "#8fd3ff"], p: ["Par", "#f2f2f2"], g: ["Bogey+", "#ff9f43"] };
const toPar = (v) => (v == null ? "—" : v > 0 ? `+${v}` : v === 0 ? "E" : `−${Math.abs(v)}`);
const sgn = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0.0049 ? "+" : v < -0.0049 ? "−" : ""}${Math.abs(v).toFixed(d)}`);
const mean2 = (o) => (o && o[0] ? o[1] / o[0] : null);
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const st = { hole: null }; // (the hole open, kept while the app is open)

export async function drawInsights(ctx, course) {
  const meta = course.heat;
  const back = el("button", { type: "button", class: "link" }, `← ${course.name}`);
  back.addEventListener("click", () => ctx.go({ name: "prepMenu", course }));
  const body = el("div", { class: "ci2" }, el("p", { class: "muted ta-loading" }, "Loading the course insights…"));
  let who = null, ready = false;
  const W = await pickWho(ctx, (p) => { who = p; if (ready) draw(); }); // (update 536: a pick during set-up waits for it)
  who = W.who;
  const sub = el("p", { class: "muted small" });
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel ci2-head" }, [
    el("p", { class: "pr-eyebrow" }, `${course.name}${course.mapEvents ? ` · ${course.mapEvents}` : ""}`),
    el("div", { class: "sh-title" }, [el("h1", {}, "Course Insights"), infoTip("From every shot hit here (the same data as Strategy Maps). Top 10: those who finished in the top 10 (ties included) of each year’s event, worked out from their scores. Strokes gained are against this course’s own field.")]),
    W.node, sub]), body]);
  let data;
  try { data = await heatData(meta); } catch (err) { console.error(err); mount(body, el("p", { class: "empty" }, "Couldn’t load the course. Try again.")); return; }
  const I = data?.insights;
  if (!I) { mount(body, el("section", { class: "panel" }, el("p", { class: "empty" }, "No insights for this course yet: upload its shot data again (Upload Data › Strategy Maps, or course_upload.py) to work them out."))); return; }
  const all = await listHeatCourses().catch(() => []);
  const holeNums = Object.keys(I.holes).map(Number).sort((a, b) => a - b);
  const yardsOf = (h) => data.holes?.[h]?.yards || meta.yards?.[h - 1] || null;
  if (!holeNums.includes(st.hole)) st.hole = null;

  async function draw() {
    let mine = null;
    if (who) { const tr = await playerTrails(meta, who.key).catch(() => null); mine = tr?.trails?.length ? tr.trails : null; }
    const name = who && mine ? who.label : "Field", first = who && mine ? who.label.split(" ")[0] : "the field";
    mount(sub, who && !mine ? `No shots for ${who.label} at this course: showing the field.` : `${who && mine ? who.label : "The field"} against the Top 10 finishers${I.events.length ? ` · ${I.events.map((e) => e.y).join(", ")}` : ""}`);
    const S = subject(I, mine, who && mine ? who.key : null);
    const H = holeFacts(I, holeNums, yardsOf, S);
    const openHole = (h) => { st.hole = h; drawHoles(); holesSec.scrollIntoView({ behavior: "smooth", block: "start" }); };
    const holesSec = el("section", { class: "panel ci2-sec" });
    const drawHoles = () => mount(holesSec, holesBlock(H, S, name, (h) => { st.hole = st.hole === h ? null : h; drawHoles(); }, (h) => ctx.go({ name: "prepHeat", course: { ...course, startHole: h } })));
    drawHoles();
    // (update 594) a player picked: Cal's Read aims for their driving and their best approach range
    let prof = null;
    if (who) { const me = who; try { prof = await playerProfileFrom((await playerData(me.key)).rounds, me.label); } catch { prof = null; } if (who !== me) return; }
    const toMap = (h, pin = null) => ctx.go({ name: "prepHeat", course: { ...course, startHole: h, ...(pin ? { startPin: pin, calCircles: true } : {}) } }); // (update 592: a pin's read: that pin, Cal's circles on)
    mount(body, [scores(I), plan(H, openHole), strategy(I, holeNums, toMap, meta, data, prof), holesSec, faced(S, all, name), ...vsTop(H, S, name, first, openHole)].filter(Boolean));
  }
  ready = true;
  await draw();
}

/** The subject's numbers (the field, or the player's own trails here) and the Top 10's (without them). */
export function subject(I, mine, key) {
  const sc = () => ({ n: 0, sum: 0, e: 0, b: 0, p: 0, g: 0 });
  if (!mine) return { holes: Object.fromEntries(Object.entries(I.holes).map(([h, X]) => [h, X.field])), top: Object.fromEntries(Object.entries(I.holes).map(([h, X]) => [h, X.top])), sg: I.sg.field, rounds: I.sg.fieldRounds, topSg: I.sg.top, topRounds: I.sg.topRounds, attempts: I.attempts, field: true };
  const holes = {}, top = {}, sgS = {}, sgMeTop = {}, rs = new Set(), rsTop = new Set(), att = {}, topSet = new Set(I.top || []);
  for (const h of Object.keys(I.holes)) { holes[h] = sc(); top[h] = { ...I.holes[h].top }; }
  const k5 = (s) => (s <= -2 ? "e" : s === -1 ? "b" : s === 0 ? "p" : "g");
  for (const t of mine) {
    const X = I.holes[t.h]; if (!X) continue;
    const qs = [...t.shots].sort((a, b) => a[0] - b[0]), wasTop = topSet.has(`${key}|${t.y}`);
    for (const q of qs) { const b = bucketOf(q, X.par, false); if (b) att[b] = (att[b] || 0) + 1; }
    const one = {}; trailSG({ ...t, shots: qs }, X.par, I.sg.E, one);
    for (const [b, v] of Object.entries(one)) { sgS[b] = (sgS[b] || 0) + v; if (wasTop) sgMeTop[b] = (sgMeTop[b] || 0) + v; }
    rs.add(`${t.y}|${t.r}`); if (wasTop) rsTop.add(`${t.y}|${t.r}`);
    if (t.s == null) continue;
    const o = holes[t.h]; o.n++; o.sum += t.s; o[k5(t.s)]++;
    if (wasTop) { const T = top[t.h]; T.n--; T.sum -= t.s; T[k5(t.s)]--; }
  }
  const topSg = {}; for (const b of new Set([...Object.keys(I.sg.top), ...Object.keys(sgMeTop)])) topSg[b] = (I.sg.top[b] || 0) - (sgMeTop[b] || 0);
  return { holes, top, sg: sgS, rounds: rs.size, topSg, topRounds: I.sg.topRounds - rsTop.size, attempts: att, field: false };
}

/** Each hole's facts: scoring (field, subject, Top 10), how hard, what matters, the tee miss, fairway width. */
export function holeFacts(I, holeNums, yardsOf, S) {
  const val = (X, k) => { const o = X[k]; if (!o) return null; if (k === "go") { const g = o.go, l = o.lay; if (!g || !l || g[0] < 5 || l[0] < 5) return null; if (X.par === 4 && g[0] < 0.1 * (X.field.n || 1)) return null; return mean2(l) - mean2(g); } const h = o.hit, m = o.miss; if (!h || !m || h[0] < 5 || m[0] < 5) return null; return mean2(m) - mean2(h); };
  const out = holeNums.map((h) => {
    const X = I.holes[h], f = X.field, n = f.n || 1;
    const L = X.drive?.L, R = X.drive?.R, ok = (o) => o && o[0] >= 5;
    const miss = ok(L) && ok(R) ? { worse: mean2(L) > mean2(R) ? "left" : "right", by: Math.abs(mean2(L) - mean2(R)) } : null;
    const ws = Object.entries(X.widths || {}).map(([c, w]) => [Number(c), w]).sort((a, b) => a[0] - b[0]);
    return { h, par: X.par, yds: yardsOf(h), field: f, me: S.holes[h], top: S.top[h], toPar: f.n ? f.sum / f.n : null,
      birdie: (100 * (f.e + f.b)) / n, bogey: (100 * f.g) / n, fwy: X.par >= 4 ? val(X, "fwy") : null, gir: val(X, "gir"), go: X.par >= 4 ? val(X, "go") : null, miss, widths: ws };
  });
  [...out].sort((a, b) => (b.toPar ?? -9) - (a.toPar ?? -9)).forEach((x, i) => { x.hcp = i + 1; });
  return out;
}

const sec = (title, kids, note = null, cls = "") => el("section", { class: `panel ci2-sec ${cls}` }, [el("h2", { class: "ci2-h" }, title), ...kids, note ? el("p", { class: "muted small ci2-note" }, note) : null]);

/* ---------------- the scores to beat ---------------- */
function scores(I) {
  const ev = I.events, av = (k) => { const v = ev.map((e) => e[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const cards = [["Make the cut", av("cut"), "cut"], ["Top 25", av("top25"), "t25"], ["Top 10", av("top10"), "t10"], ["Win", av("win"), "win"]].filter(([, v]) => v != null);
  if (!cards.length) return null;
  return sec("SCORES TO BEAT", [el("div", { class: "ci2-scores" }, cards.map(([l, v, c]) => el("div", { class: `ci2-score ${c}` }, [el("span", {}, l), el("strong", {}, toPar(v))])))],
    `For the week, to par: the average of ${ev.length} ${ev.length === 1 ? "event" : "events"} here (${ev.map((e) => e.y).join(", ")}).`);
}

/* ---------------- the game plan, in plain words ---------------- */
function plan(H, openHole) {
  // (update 497) each part of the plan: three big cards, the hole number large, the number that matters under it
  const top = (list, key, n = 3, min = -Infinity) => list.filter((x) => x[key] != null && x[key] > min).sort((a, b) => b[key] - a[key]).slice(0, n);
  const agg = H.map((x) => ({ ...x, ix: x.birdie - x.bogey }));
  const blocks = [
    ["Attack", "pos", "most birdies against bogeys", top(agg, "ix", 3, 0), (x) => [`${Math.round(x.birdie)}%`, "birdies", `${Math.round(x.bogey)}% bogeys`]],
    ["Play safe", "neg", "most bogeys against birdies", agg.filter((x) => x.ix < 0).sort((a, b) => a.ix - b.ix).slice(0, 3), (x) => [`${Math.round(x.bogey)}%`, "bogeys", `${Math.round(x.birdie)}% birdies`]],
    ["Fairways matter", "", "strokes lost missing the fairway", top(H, "fwy", 3, 0.05), (x) => [x.fwy.toFixed(2), "strokes", "missing the fairway"]],
    ["Greens matter", "", "strokes lost missing the green in regulation", top(H, "gir", 3, 0.05), (x) => [x.gir.toFixed(2), "strokes", "missing the green"]],
    ["Go for it", "pos", "strokes saved going for it, against laying up", top(H, "go", 3, 0.05), (x) => [x.go.toFixed(2), "strokes", "saved going for it"]],
    ["Tee miss to avoid", "neg", "the costlier side to miss off the tee", H.filter((x) => x.miss && x.miss.by >= 0.1).sort((a, b) => b.miss.by - a.miss.by).slice(0, 3), (x) => [x.miss.worse === "left" ? "Left" : "Right", "miss", `+${x.miss.by.toFixed(2)} vs the other side`]],
  ].filter(([, , , list]) => list.length);
  return sec("GAME PLAN", blocks.map(([t, tone, sub, list, val]) => el("div", { class: `ci2-blk ${tone}` }, [
    el("div", { class: "ci2-blk-h" }, [el("h3", {}, t), el("span", { class: "muted small" }, sub)]),
    el("div", { class: "ci2-cards" }, list.map((x) => {
      const [big, unit, note] = val(x);
      const b = el("button", { type: "button", class: "ci2-big" }, [el("span", { class: "ci2-big-l" }, `Hole \u00b7 Par ${x.par}`), el("strong", { class: "ci2-big-n" }, String(x.h)),
        el("span", { class: "ci2-big-v" }, [el("b", {}, big), ` ${unit}`]), el("span", { class: "ci2-big-s" }, note)]);
      b.addEventListener("click", () => openHole(x.h));
      return b;
    }))])), "Tap a hole for its numbers.");
}

/* ---------------- (update 588) strategy: what every player's shots say to aim for and avoid, hole by hole (589: Cal's Read) ---------------- */
function strategy(I, holeNums, toMap, meta, data, prof = null) {
  // (update 590) each pin's own read (the miss sides only make sense to one pin); no surprises list (they're in each read)
  const D = withMerges(meta, data);
  const rows = holeNums.map((h) => {
    const S = I.holes[h]?.strategy || {};
    const pins = pinsOn(meta, D, h).map((id) => ({ id, label: pinLabel(meta, h, id), read: (() => { const rd = readFor(S, D.holes?.[h]?.pins?.[id]?.merged || [id]); return rd && prof ? playerAim(rd, prof) : rd; })() }))
      .filter((p) => p.read && !p.read.all).sort((a, b) => b.read.r.n - a.read.r.n);
    return { h, par: I.holes[h]?.par, pins, all: S["*"] };
  }).filter((x) => x.pins.length || x.all?.items?.length);
  if (!rows.length) return null;
  const kids = [el("div", { class: "cal-read-h ci2-sg-head" }, [el("span", { class: "cal-read-ava", "aria-hidden": "true" }, icon("robot")),
    el("div", { class: "cal-read-t" }, [el("strong", {}, BRAND), el("span", {}, "Where to aim and where to miss, hole by hole and pin by pin, from every shot played here")]), el("span", { class: "cal-read-tag" }, TAG)])];
  kids.push(el("div", { class: "ci2-sg-holes" }, rows.map((x) => {
    const openBtn = (pin) => { const b = el("button", { type: "button", class: "btn ghost small cal-read-open" }, pin ? "Open the map: this pin, Cal\u2019s spots circled" : "Open the map"); b.addEventListener("click", () => toMap(x.h, pin)); return b; };
    const cards = x.pins.length ? x.pins.map((p) => readCard(p.read, `${p.label} pin`, { compact: true, foot: openBtn(p.id) }))
      : [(() => { const rd = readFor(I.holes[x.h]?.strategy, []); return rd ? readCard(prof ? playerAim(rd, prof) : rd, "every pin", { compact: true, foot: openBtn(null) }) : null; })()].filter(Boolean);
    const pinTxt = x.pins.length ? `${x.pins.length} ${x.pins.length === 1 ? "pin" : "pins"}: ${x.pins.map((p) => p.label).join(", ")}` : "every pin together (too few samples to any one pin)";
    return el("details", { class: "ci2-sg-hole" }, [
      el("summary", {}, [el("strong", {}, `Hole ${x.h}`), el("span", { class: "muted small" }, ` Par ${x.par ?? "\u2014"} \u00b7 ${pinTxt}`)]),
      el("div", { class: "ci2-sg-pins" }, cards)]);
  })));
  return sec("CAL\u2019S STRATEGY", kids, `Each pin's own read (a pin with too few samples isn't shown; a hole with none: every pin together). A tip needs at least 8 samples (past shots from that spot); under 15 it says so. Scores are the hole's average after each result. Ask Cal too: \u201chow should I play hole 2 here, back left pin?\u201d`, "ci2-calread");
}

/* ---------------- every hole as a tile; one open with its numbers ---------------- */
const tone = (v) => { if (v == null) return "rgba(255,255,255,0.05)"; const t = Math.max(-1, Math.min(1, v / 0.35)); return t < 0 ? `rgba(61,156,255,${0.12 + 0.5 * -t})` : `rgba(255,${Math.round(159 - 90 * t)},${Math.round(67 - 9 * t)},${0.12 + 0.55 * t})`; };
function holesBlock(H, S, name, pick, toMap) {
  const tiles = el("div", { class: "ci2-tiles" }, H.map((x) => {
    const v = x.me?.n ? x.me.sum / x.me.n : null;
    const b = el("button", { type: "button", class: `ci2-tile${st.hole === x.h ? " on" : ""}`, style: `background:${tone(v)}`, "aria-pressed": String(st.hole === x.h) }, [
      el("span", { class: "ci2-tile-n" }, String(x.h)), el("span", { class: "ci2-tile-p" }, `Par ${x.par}`), el("strong", {}, v == null ? "—" : sgn(v)), el("span", { class: "ci2-tile-h" }, `${ord(x.hcp)} hardest`)]);
    b.addEventListener("click", () => pick(x.h));
    return b;
  }));
  const x = H.find((y) => y.h === st.hole);
  return [el("h2", { class: "ci2-h" }, "HOLE BY HOLE"), el("p", { class: "muted small" }, `${S.field ? "The field’s" : `${name}’s`} scoring to par on each hole (blue under, orange over). Tap one.`), tiles, x ? holeDetail(x, S, name, toMap) : null];
}
const mixRow = (label, o, par) => {
  if (!o?.n) return null;
  const v = o.sum / o.n, ks = ["e", "b", "p", "g"].filter((k) => o[k] > 0);
  return el("div", { class: "ci2-mix" }, [el("span", { class: "ci2-mix-k" }, [label, el("small", {}, `${o.n} rds`)]),
    el("span", { class: "sh-hb" }, ks.map((k) => { const p = (100 * o[k]) / o.n; return el("i", { style: `width:${p}%;background:${SC[k][1]}`, class: k === "p" ? "par" : null, title: `${SC[k][0]} ${o[k]}` }, p >= 14 ? `${Math.round(p)}%` : ""); })),
    el("strong", { class: `ci2-mix-v ${v > 0.005 ? "neg" : v < -0.005 ? "pos" : ""}` }, `${(par + v).toFixed(2)}`)]);
};
function holeDetail(x, S, name, toMap) {
  const facts = [];
  if (x.fwy != null) facts.push(["Fairway", x.fwy >= 0 ? `missing it costs ${x.fwy.toFixed(2)} a hole` : `missing it costs nothing extra here`]);
  if (x.gir != null) facts.push(["Green in regulation", `missing it costs ${x.gir.toFixed(2)}`]);
  if (x.go != null) facts.push(["Going for it", x.go >= 0 ? `saves ${x.go.toFixed(2)} on laying up` : `costs ${Math.abs(x.go).toFixed(2)} on laying up`]);
  if (x.miss) facts.push(["Off the tee", `the ${x.miss.worse} miss costs ${x.miss.by.toFixed(2)} more than the other`]);
  if (x.widths.length) facts.push(["Fairway width", `about ${Math.min(...x.widths.map((w) => w[1]))}–${Math.max(...x.widths.map((w) => w[1]))} yds where drives land (${x.widths[0][0]}–${x.widths.at(-1)[0]} yds out)`]);
  const map = el("button", { type: "button", class: "btn ghost small" }, "Open in Strategy Maps →");
  map.addEventListener("click", () => toMap(x.h));
  return el("div", { class: "ci2-detail" }, [
    el("div", { class: "ci2-detail-h" }, [el("h3", {}, `Hole ${x.h} · Par ${x.par}${x.yds ? ` · ${x.yds} yds` : ""}`), el("span", { class: "muted small" }, `${ord(x.hcp)} hardest`)]),
    el("div", { class: "ci2-mixes" }, [S.field ? mixRow("Field", x.field, x.par) : mixRow(name.split(" ")[0], x.me, x.par), !S.field ? mixRow("Field", x.field, x.par) : null, mixRow("Top 10", x.top, x.par),
      el("div", { class: "sh-hl-key" }, Object.values(SC).map(([l, c]) => el("span", {}, [el("i", { style: `background:${c}` }), l])))]),
    facts.length ? el("ul", { class: "ci2-facts" }, facts.map(([k, v]) => el("li", {}, [el("strong", {}, k), ` ${v}`]))) : null,
    el("div", { class: "ci2-detail-f" }, map)]);
}

/* ---------------- the shots this course asks for, against an average course ---------------- */
function faced(S, all, name) {
  const tour = {}; for (const c of all) for (const [b, n] of Object.entries(c.attempts || {})) tour[b] = (tour[b] || 0) + n;
  const tt = Object.values(tour).reduce((a, b) => a + b, 0), st2 = Object.values(S.attempts).reduce((a, b) => a + b, 0);
  if (!st2 || !tt || all.length < 2) return null;
  const rows = ATT_B.map((b) => ({ b, here: (100 * (S.attempts[b] || 0)) / st2, avg: (100 * (tour[b] || 0)) / tt })).map((r) => ({ ...r, d: r.here - r.avg })).filter((r) => Math.abs(r.d) >= 0.5);
  if (!rows.length) return sec("SHOTS YOU’LL FACE", [el("p", { class: "muted" }, "About the same mix of shots as an average course.")]);
  const max = Math.max(...rows.map((r) => Math.abs(r.d)));
  const list = (title, rs, cls) => el("div", { class: `ci2-faced ${cls}` }, [el("h3", {}, title), ...rs.map((r) => el("div", { class: "ci2-fr" }, [el("span", { class: "ci2-fr-k" }, r.b), el("span", { class: "ci2-fr-bar" }, el("i", { style: `width:${(Math.abs(r.d) / max) * 100}%` })), el("strong", {}, `${r.d > 0 ? "+" : "−"}${Math.abs(r.d).toFixed(1)}%`)]))]);
  const more = rows.filter((r) => r.d > 0).sort((a, b) => b.d - a.d).slice(0, 6), less = rows.filter((r) => r.d < 0).sort((a, b) => a.d - b.d).slice(0, 6);
  return sec("SHOTS YOU’LL FACE", [el("div", { class: "ci2-two" }, [more.length ? list("More often here", more, "more") : null, less.length ? list("Less often here", less, "less") : null])],
    `${S.field ? "The field’s" : `${name}’s`} shots here by distance (not tee shots on par 4s and 5s), against the average of the ${all.length} courses with shot data: points of the share of shots. Practice the ones that come up more.`);
}

/* ---------------- against the Top 10: where they gain, where the subject holds up ---------------- */
function vsTop(H, S, name, first, openHole) {
  const holes = H.map((x) => { const a = x.me?.n ? x.me.sum / x.me.n : null, t = x.top?.n ? x.top.sum / x.top.n : null; return { ...x, v: a != null && t != null ? t - a : null }; }).filter((x) => x.v != null);
  const dists = skillsOf(S.sg, S.topSg).map((b) => { const me = S.rounds ? (S.sg[b] || 0) / S.rounds : null, tp = S.topRounds ? (S.topSg[b] || 0) / S.topRounds : null; return { b, v: me != null && tp != null ? me - tp : null }; }).filter((x) => x.v != null && (S.sg[x.b] != null || S.topSg[x.b] != null));
  if (!holes.length && !dists.length) return [];
  const max = Math.max(...holes.map((x) => Math.abs(x.v)), ...dists.map((x) => Math.abs(x.v)), 0.01);
  const row = (k, v, onTap = null, max = 1) => { const r = el(onTap ? "button" : "div", { class: "ci2-vr", ...(onTap ? { type: "button" } : {}) }, [el("span", { class: "ci2-vr-k" }, k), el("span", { class: "ci2-vr-bar" }, el("i", { class: v < 0 ? "neg" : "pos", style: `width:${(Math.abs(v) / max) * 100}%` })), el("strong", { class: v < 0 ? "neg" : "pos" }, sgn(v))]); if (onTap) r.addEventListener("click", onTap); return r; };
  const scale = (list) => Math.max(...list.map((x) => Math.abs(x.v)), 0.01); // (update 493: each card its own scale)
  const lose = (list, k, tap) => list.filter((x) => x.v < -0.005).sort((a, b) => a.v - b.v).slice(0, 5).map((x) => row(k(x), x.v, tap ? () => tap(x) : null, scale(list)));
  const gain = (list, k, tap) => list.filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => row(k(x), x.v, tap ? () => tap(x) : null, scale(list)));
  const col = (title, rows) => (rows.length ? el("div", { class: "ci2-vcol" }, [title ? el("h3", {}, title) : null, ...rows]) : null);
  const who = S.field ? "the field" : first;
  // (update 510) one card: every hole, then every skill, from the most strokes lost to the most gained
  const all = (list, k, tap) => [...list].sort((a, b) => a.v - b.v).map((x) => row(k(x), x.v, tap ? () => tap(x) : null, scale(list)));
  const part = (title, rows) => (rows.length ? el("div", { class: "ci2-vcol" }, [el("h3", { class: "ci2-sub" }, title), ...rows]) : null);
  return [sec("AGAINST THE TOP 10", [el("div", { class: "ci2-pair2" }, [part("Holes", all(holes, (x) => `Hole ${x.h}`, (x) => openHole(x.h))), part("Skills", all(dists, (x) => x.b))])],
    "Negative values (Red) indicate losing strokes vs average Top 10 finishers; Positive values (Green) indicate gaining strokes vs average Top 10 finishers")];
}
