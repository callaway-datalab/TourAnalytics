// (update 470) Focus: the Stats page as one short story for the player picked. Where they stand; the three places
// they lose the most strokes lately (against the tour average, which strokes gained already is), what fixing each is
// worth (a round, and on the season rank), a drill for each; whether the practice they've added is working (strokes
// gained there since they added it); and what to keep doing. Full stats is one tap away (the switch above it).
// Takes S first, like the other Stats page sections (see sgDashboard.js).
import { el, mount, infoTip, CATEGORIES, distLead, drillFor, drillLine, practiceOpen, isMine, getState, planEditor, PLAN_ADDED, goalStatsFor, statDef, LEVELS } from "./sgShared.js";

const CAT = Object.fromEntries(CATEGORIES);
const f2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));

/** Strokes gained a round, and attempts a round, for every part of the game and distance in these rounds. */
function buckets(rounds, on = null) {
  const m = new Map(), n = rounds.length || 1;
  for (const rd of rounds) for (const x of rd.shots || []) {
    if (!x.cat || (on && !on.has(x.cat))) continue;
    const k = `${x.cat}|${x.dist || ""}`, b = m.get(k) || m.set(k, { cat: x.cat, dist: x.dist || null, sg: 0, w: 0 }).get(k);
    b.sg += x.sg || 0; b.w += x.w || 1;
  }
  return [...m.values()].map((b) => ({ ...b, perRd: b.sg / n, att: b.w / n, perShot: b.w ? b.sg / b.w : 0 }));
}
const nameOf = (b) => `${CAT[b.cat] || b.cat}${b.dist ? ` · ${b.dist}` : ""}`;

/** (update 471) the drill's goal stat: the player's own season level of the plain stat that fits it (fairway %, proximity,
 *  up-and-down %, make %…), that distance's, else the part of the game's, when there are enough attempts behind it */
/* (update 489) a distance by its numbers and unit, so "30-50 yds", "30 - 50 Yds" and "30 to 50 yards" are the same */
export const distSig = (d) => { if (d == null || d === "") return ""; const t = String(d).toLowerCase(); const n = (t.match(/\d+(\.\d+)?/g) || []).map(Number).join("-"); return `${/<|under|inside|less/.test(t) ? "<" : />|over|\+|plus/.test(t) ? ">" : ""}${n}${/ft|feet|'/.test(t) ? "f" : "y"}`; };
/* (update 491) a distance as a range in its unit ("30-50 yds" → 30 to 50 yards; "<30 yds" → 0 to 30; ">25 ft" → 25 up) */
export const distRange = (d) => { if (d == null || d === "") return null; const t = String(d).toLowerCase(), n = (t.match(/\d+(\.\d+)?/g) || []).map(Number); if (!n.length) return null; const u = /ft|feet|'/.test(t) ? "f" : "y";
  if (/<|under|inside|less/.test(t)) return { u, lo: 0, hi: n[0] }; if (/>|over|\+|plus/.test(t)) return { u, lo: n[0], hi: Infinity }; return { u, lo: n[0], hi: n[1] ?? n[0] }; };
const overlaps = (a, b) => { const x = distRange(a), y = distRange(b); return !!(x && y && x.u === y.u && x.lo < y.hi && y.lo < x.hi); };
/** does a stat entry count for this part of the game and distance: mode "exact" (both), "dist" (that distance, filed
 *  under any part of the game: proximity from 30-50 yds kept under Approach, say) or "cat" (that part, any distance) */
export const obsFits = (o, cat, dist, mode) => (mode === "exact" ? o.cat === cat && (dist ? distSig(o.dist) === distSig(dist) : !o.dist)
  : mode === "dist" ? !!dist && distSig(o.dist) === distSig(dist)
  : mode === "near" ? !!dist && (o.cat === cat || !o.cat || cat === "ARG") && overlaps(o.dist, dist) // (update 491: other distance bands that overlap it)
  : o.cat === cat || !o.cat);
function goalStat(rounds, cat, dist, { pctMin = 20, min = 8 } = {}) {
  for (const re of goalStatsFor(cat, dist)) for (const mode of ["exact", "dist", "near", "cat"]) {
    if ((mode === "dist" || mode === "near") && !dist) continue;
    let t = 0, w = 0, k = null;
    for (const rd of rounds) for (const o of rd.obs || []) {
      if (!re.test(o.k)) continue;
      if (obsFits(o, cat, dist, mode)) { t += o.v * o.w; w += o.w; k = o.k; }
    }
    if (k) { const def = statDef(k); if (w >= (def.pct ? pctMin : min)) return { k, def, ve: t / w, exact: mode === "exact", mode, w }; }
  }
  return null;
}

export function focusView(S, mine, slicedField, f = {}) {
  const me = S.me, st = S.st;
  // (update 471) the parts of the game picked (none, or all four, is everything: SG: Total)
  const CATS = ["OTT", "APP", "ARG", "PUTT"];
  st.focusCats = (st.focusCats || []).filter((c) => CATS.includes(c));
  const on = st.focusCats.length && st.focusCats.length < 4 ? new Set(st.focusCats) : null;
  // (update 476) one at a time; a double tap locks a pill in, so several can be picked (a tap on a locked one unlocks it)
  st.focusLock = (st.focusLock || []).filter((c) => CATS.includes(c));
  const lock = new Set(st.focusLock);
  const tapPill = (c) => {
    const now = Date.now(), last = st.focusTap;
    st.focusTap = { c, t: now };
    if (last && last.c === c && now - last.t < 400) { lock.add(c); st.focusLock = [...lock]; st.focusPick = null; st.focusTap = null; } // (double tap: locked in)
    else if (lock.has(c)) { lock.delete(c); st.focusLock = [...lock]; }
    else st.focusPick = st.focusPick === c ? null : c;
    const sel = new Set([...lock, ...(st.focusPick ? [st.focusPick] : [])]);
    st.focusCats = sel.size === 4 ? [] : [...sel];
    S.draw();
  };
  const pills = el("div", { class: "fx-pills", role: "group", "aria-label": "Parts of the game" }, [
    ...CATS.map((c) => { const p = !!on?.has(c), l = lock.has(c); const b = el("button", { type: "button", class: `fx-pill${p ? " on" : ""}${l ? " locked" : ""}`, "aria-pressed": String(p), title: `${CAT[c]}${l ? " (locked: tap to unlock)" : " (double-tap to lock it in and pick more)"}` }, [l ? "\uD83D\uDD12 " : "", c]); b.addEventListener("click", () => tapPill(c)); return b; })
  ]); // (update 492: no info button)
  const sgIn = (x) => !on || on.has(x.cat);
  const picked = on ? [...on].sort((a, b) => CATS.indexOf(a) - CATS.indexOf(b)).map((c) => CAT[c]).join(" + ") : "Total"; // (update 475: named in every header)
  const all = [...mine].sort(byDate);
  const when = [Array.isArray(f.year) && f.year.length ? f.year.join(", ") : Number(f.months) ? `last ${f.months} months` : "all seasons", Array.isArray(f.tour) && f.tour[0] ? f.tour[0] : null, `${all.length} rounds`].filter(Boolean).join(" \u00b7 ");
  // (update 492) the pills on their own, like the other filters; the time frame at the foot of Where you stand
  const head = el("div", { class: "fx-pills-row" }, pills);
  const whenLine = el("p", { class: "muted small fx-when" }, when);
  if (all.length < 6) return [head, el("section", { class: "panel fx" }, [el("p", { class: "empty" }, "Focus needs at least 6 rounds in this selection. Widen the time frame in Full stats."), whenLine])];
  const N = Math.max(6, Math.min(all.length, Math.round(Number(st.recentN) || 12)));
  const recent = all.slice(-N);
  const tot = (rs) => rs.reduce((t, rd) => t + (rd.shots || []).reduce((u, x) => u + (x.cat && sgIn(x) ? x.sg || 0 : !x.cat && !on ? x.sg || 0 : 0), 0), 0) / (rs.length || 1);
  const seasonV = tot(all), recentV = tot(recent);
  // the season rank: where a value would sit among everyone else's averages over the same selection
  const others = S.rankedField(slicedField).filter((p) => p.key !== me.key).map((p) => tot(p.rounds)).filter(Number.isFinite);
  const rankOf = (v) => 1 + others.filter((x) => x > v + 1e-12).length, of = others.length + 1;
  const ranked = others.length > 0;
  const whose = isMine(me.key) ? "your" : `${me.label}’s`, you = isMine(me.key) ? "you" : (me.label || "they").split(" ")[0];

  // 1. where they stand
  const trend = recentV - seasonV;
  const stand = el("section", { class: "panel fx fx-stand" }, [
    el("p", { class: "fx-eyebrow" }, `Where you stand \u00b7 ${picked}`), // (update 474: what the pills picked)
    el("div", { class: "fx-stats" }, [
      el("div", { class: "fx-stat" }, [el("span", { class: "fx-k" }, "Season"), el("strong", { class: seasonV >= 0 ? "pos" : "neg" }, f2(seasonV)), el("span", { class: "fx-s" }, ranked ? `${ord(rankOf(seasonV))} of ${of}` : "a round")]),
      el("div", { class: "fx-stat" }, [el("span", { class: "fx-k" }, `Last ${N}`), el("strong", { class: recentV >= 0 ? "pos" : "neg" }, f2(recentV)), el("span", { class: "fx-s" }, ranked ? `a ${ord(rankOf(recentV))} level` : "a round")]),
      el("div", { class: "fx-stat" }, [el("span", { class: "fx-k" }, "Trend"), el("strong", { class: trend >= 0 ? "pos" : "neg" }, `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(2)}`), el("span", { class: "fx-s" }, Math.abs(trend) < 0.1 ? "steady" : trend > 0 ? "getting better" : "slipping")]),
    ]),
    whenLine,
  ]);

  // 2 and 3. where they lose strokes lately, what it's worth, and the practice for it
  const bs = buckets(recent, on).filter((b) => b.att >= 0.5); // (shots they face at least every other round)
  const losses = bs.filter((b) => b.perRd < -0.02).sort((a, b) => a.perRd - b.perRd).slice(0, 3);
  const gains = bs.filter((b) => b.perRd > 0.02).sort((a, b) => b.perRd - a.perRd).slice(0, 2);
  const canAdd = practiceOpen(me.key);
  // (update 472) where a drill's goal comes from (update 473: their best stretch first, below): their "Best on Tour" rounds for that part of the game (the best of
  // their rounds that together rank #1, as in Elite Round Share), if there are 5 or more; else "Contender", then
  // "Tour Championship", then "Signature event"; none of those with 5 rounds: their best 10 rounds. The first of those
  // with enough attempts at the stat (20 for a percentage, 8 otherwise) sets the goal.
  const ladders = new Map();
  const setsFor = (cat) => {
    if (ladders.has(cat)) return ladders.get(cat);
    const sets = [];
    // (update 476: the best stretch is per distance now: goalFor, below)
    let rows = null; try { rows = S.ladderRows(all, cat); } catch { rows = null; }
    for (const T of [1, 10, 25, 50]) { const r = rows?.find((x) => x.target === T); const k = r?.share?.k || 0; if (k >= 5) { const e = S.eliteOf(all, cat, k); if (e.rounds?.length) sets.push({ from: `\u201c${LEVELS[T].replace(/ level$/, "")}\u201d rounds`, rounds: e.rounds }); } }
    const b10 = S.eliteOf(all, cat, Math.min(10, all.length)); if (b10.rounds?.length) sets.push({ from: "best 10 rounds", rounds: b10.rounds });
    ladders.set(cat, sets);
    return sets;
  };
  // (update 476) their best stretch at that distance: the longest run of rounds in a row (5 or more) in which their
  // strokes gained a round there beat the bar: the best season average there of any other player ("Best on Tour" for that
  // shot), when the field's rounds have distances; else the tour average
  const stretchMemo = new Map();
  const distStretch = (cat, dist) => {
    const key = `${cat}|${dist || ""}`; if (stretchMemo.has(key)) return stretchMemo.get(key);
    const at = (rd) => (rd.shots || []).reduce((t, x) => t + (x.cat === cat && (!dist || x.dist === dist) ? x.sg || 0 : 0), 0);
    const vals = (slicedField || []).filter((p) => p.key !== me.key).map((p) => { let sum = 0, has = false; for (const rd of p.rounds || []) for (const x of rd.shots || []) if (x.cat === cat && (!dist || x.dist === dist) && (dist ? true : x.dist == null || true)) { sum += x.sg || 0; if (!dist || x.dist) has = true; } return has && (p.rounds || []).length >= 10 ? sum / p.rounds.length : null; }).filter((v) => v != null && Number.isFinite(v));
    const best = vals.length >= 10, bar = best ? Math.max(...vals) : 0;
    const seq = all.map(at), pre = [0]; for (const v of seq) pre.push(pre.at(-1) + v);
    let found = null;
    for (let n = seq.length; n >= 5 && !found; n--) for (let i = n; i < pre.length; i++) if ((pre[i] - pre[i - n]) / n > bar + 1e-12) { found = { rds: all.slice(i - n, i), n, bar, best, avg: (pre[i] - pre[i - n]) / n }; break; }
    stretchMemo.set(key, found);
    return found;
  };
  const goalFor = (cat, dist) => {
    const ds = distStretch(cat, dist);
    if (ds) { const gs = goalStat(ds.rds, cat, dist); if (gs) return { gs, from: `${ds.n} best-stretch rounds`, stretch: { cat, dist, ...ds, gs } }; }
    for (const set of setsFor(cat)) { const gs = goalStat(set.rounds, cat, dist); if (gs) return { gs, from: set.from, stretch: set.stretch || null }; }
    // (update 477) too few attempts in any of those (a shot faced less than once a round): their whole time frame, with 3
    // attempts enough; and if even that's short, say how many there are (not that there's no stat)
    const season = goalStat(all, cat, dist, { pctMin: 5, min: 3 });
    if (season) return { gs: season, from: "season rounds" };
    // (update 489) none of their own: the field's at that distance (the best 10% of players there, as the bar to reach)
    const fieldGoal = (() => {
      for (const re of goalStatsFor(cat, dist)) for (const mode of ["exact", "dist", "near", "cat"]) {
        if ((mode === "dist" || mode === "near") && !dist) continue;
        const per = [];
        for (const p of slicedField || []) { if (p.key === me.key) continue; let t = 0, w = 0, k = null; for (const rd of p.rounds || []) for (const o of rd.obs || []) if (re.test(o.k) && obsFits(o, cat, dist, mode)) { t += o.v * o.w; w += o.w; k = o.k; } if (k && w >= 5) per.push({ k, v: t / w, w }); }
        if (per.length < 10) continue;
        const def = statDef(per[0].k), lower = def.higher === false || (def.higher == null && /prox/i.test(per[0].k));
        per.sort((a, b) => (lower ? a.v - b.v : b.v - a.v));
        const top = per.slice(0, Math.max(1, Math.round(per.length * 0.1)));
        const W = top.reduce((a, x) => a + x.w, 0);
        return { k: per[0].k, def, ve: top.reduce((a, x) => a + x.v * x.w, 0) / W, exact: mode === "exact", mode, w: W, field: true };
      }
      return null;
    })();
    if (fieldGoal) return { gs: fieldGoal, from: "the field\u2019s best 10% at this" };
    let n = 0; for (const re of goalStatsFor(cat, dist)) for (const rd of all) for (const o of rd.obs || []) if (re.test(o.k) && (obsFits(o, cat, dist, "dist") || o.cat === cat || !o.cat)) n += o.w || 0;
    if (n > 0) return { gs: null, from: "best 10 rounds", note: `only ${Math.round(n)} ${Math.round(n) === 1 ? "attempt" : "attempts"} at this in the data, too few to set a number from` };
    // (update 478) none at all: say what the data does have for this part of the game (so a stat under a name it doesn't
    // know shows up here)
    const have = new Set(); for (const rd of all) for (const o of rd.obs || []) if (o.cat === cat || (dist && distSig(o.dist) === distSig(dist))) have.add(statDef(o.k).label);
    const want = { OTT: "fairway", APP: "proximity or greens", ARG: "proximity", PUTT: "make" }[cat] || "matching";
    // (update 489) strokes gained there is all the data has: the goal in strokes gained a shot, from now to the tour average
    let sg = 0, w = 0; for (const rd of all) for (const x of rd.shots || []) if (x.cat === cat && (!dist || distSig(x.dist) === distSig(dist))) { sg += x.sg || 0; w += x.w || 1; }
    const per = w ? sg / w : null;
    const sgGoal = per != null && per < 0 ? `; the goal is in strokes gained instead: from ${per.toFixed(2).replace("-", "\u2212")} a shot now to 0 (the tour average)` : "";
    // (update 491) where that stat is in their data (part of the game and distance), so a mismatch shows
    const where = new Map(); for (const re of goalStatsFor(cat, dist)) for (const rd of all) for (const o of rd.obs || []) if (re.test(o.k)) { const k2 = `${o.cat ? CAT[o.cat] || o.cat : "no category"} \u00b7 ${o.dist || "no distance"}`; where.set(k2, (where.get(k2) || 0) + (o.w || 1)); }
    const whereTxt = where.size ? `; ${{ OTT: "Fairway", APP: "Proximity", ARG: "Proximity", PUTT: "Make" }[cat] || "It"} is in the data for ${[...where].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k2, n2]) => `${k2} (${Math.round(n2)})`).join(", ")}` : "";
    return { gs: null, from: "best 10 rounds", note: whereTxt ? `no ${want} stat for ${CAT[cat]}${dist ? ` from ${dist}` : ""}${whereTxt}` + sgGoal : (have.size ? `the data has no ${want} stat for ${CAT[cat]}${dist ? ` from ${dist}` : ""}; it has ${[...have].slice(0, 5).join(", ")}` : `the data has no ${want} stat for ${CAT[cat]}${dist ? ` from ${dist}` : ""}, only strokes gained`) + sgGoal };
  };
  const sig = (d) => `${me.key}|${d.kind}|${d.dist || ""}|${d.lie || ""}`;
  const itemFor = (b) => {
    // (update 472) the drill's goal: the stat that fits it, in their own level rounds for that part of the game
    const { gs, from, stretch, note } = goalFor(b.cat, b.dist);
    const drill = drillFor(b.cat, b.dist, gs);
    if (!drill) return null;
    drill.from = from;
    if (note) drill.noStat = note; // (update 477)
    if (gs?.field) drill.fieldGoal = true; // (update 489)
    // the goal in real rounds: strokes gained there back to the tour average (0), over the next N rounds
    const goal = { stat: "skill", cat: b.cat, dist: b.dist, target: 0, measure: "round", when: "nextN", n: N };
    return { drill, goal, stretch };
  };
  const send = async (list, btns) => {
    btns.forEach((x) => { x.disabled = true; });
    try {
      const { addToPlan } = await import("./practice/plan.js");
      await addToPlan(getState(), { items: list.map((x) => ({ ...x })), playerKey: me.key, playerLabel: me.label });
      list.forEach((x) => PLAN_ADDED.add(sig(x.drill)));
      S.draw();
    } catch (err) { console.error(err); btns.forEach((x) => { x.disabled = false; }); }
  };
  const addBtn = (items, label) => {
    const left = items.filter((x) => x && !PLAN_ADDED.has(sig(x.drill)));
    if (!canAdd || !items.some(Boolean)) return null;
    const b = el("button", { type: "button", class: "fx-btn", disabled: !left.length }, left.length ? label : "✓ In the practice plan");
    b.addEventListener("click", () => { if (left.length) planEditor(left, whose, (edited) => send(edited, [b])); });
    return b;
  };
  // (update 474) "N best-stretch rounds" in a drill's goal: a link to the stretch (its rounds in a bar chart of every
  // round, its tournaments with their strokes gained, and the stretch's own average)
  const lineWithStretch = (item) => {
    const text = drillLine(item.drill), key = item.drill.from;
    if (!item.stretch || !key || !text.includes(key)) return el("span", {}, text);
    const at = text.indexOf(key), a = el("button", { type: "button", class: "fx-link" }, key);
    a.addEventListener("click", () => stretchPop(item.stretch));
    return el("span", {}, [text.slice(0, at), a, " ", stretchInfo(item.stretch), text.slice(at + key.length)]);
  };
  const stretchInfo = (st0) => infoTip(`Best stretch: the longest run of rounds in a row (5 or more) in which ${you === "you" ? "your" : "their"} strokes gained a round ${st0.dist ? `from ${st0.dist}` : `in ${CAT[st0.cat]}`} beat ${st0.best ? `the best season average there of any other player (${f2(st0.bar)} a round: \u201cBest on Tour\u201d for that shot)` : "the tour average (the other players\u2019 rounds here don\u2019t have distances to set a higher bar)"}. The drill\u2019s goal is ${you === "you" ? "your" : "their"} stat from those rounds. With no stretch of 5 rounds, the goal comes from ${you === "you" ? "your" : "their"} \u201cBest on Tour\u201d rounds, then \u201cContender\u201d and so on, then the best 10 rounds.`, "What a best stretch is");
  const stretchPop = (st0) => {
    const cat = st0.cat, dist = st0.dist || null, rds = st0.rds;
    const sgOf = (rd) => (rd.shots || []).reduce((t, x) => t + ((!cat || x.cat === cat) && (!dist || x.dist === dist) ? x.sg || 0 : 0), 0);
    const inS = new Set(rds), n = all.length, vals = all.map(sgOf), mx = Math.max(0.5, ...vals.map(Math.abs));
    const W = 340, H = 140, y0 = H / 2, bw = W / n, sc = (H / 2 - 6) / mx;
    const NS = "http://www.w3.org/2000/svg", mk = (t, a) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "fx-st-svg", role: "img", "aria-label": `Every round, the best stretch of ${rds.length} highlighted` });
    const i0 = all.indexOf(rds[0]);
    if (i0 >= 0) svg.appendChild(mk("rect", { x: i0 * bw, y: 0, width: rds.length * bw, height: H, fill: "rgba(212,180,131,0.12)" }));
    svg.appendChild(mk("line", { x1: 0, x2: W, y1: y0, y2: y0, stroke: "rgba(255,255,255,0.25)", "stroke-width": 1 }));
    all.forEach((rd, i) => { const v = vals[i], on = inS.has(rd), h = Math.max(1, Math.abs(v) * sc);
      svg.appendChild(mk("rect", { x: i * bw + bw * 0.15, width: Math.max(1, bw * 0.7), y: v >= 0 ? y0 - h : y0, height: h, fill: on ? (v >= 0 ? "#30d158" : "#ff453a") : (v >= 0 ? "rgba(48,209,88,0.25)" : "rgba(255,69,58,0.25)") })); });
    // the tournaments in the stretch: their rounds and strokes gained a round
    const evs = new Map();
    for (const rd of rds) { const k = `${rd.event || "Round"}|${String(rd.date || "").slice(0, 4)}`; (evs.get(k) || evs.set(k, { event: rd.event || "Round", year: String(rd.date || "").slice(0, 4), rs: [] }).get(k)).rs.push(rd); }
    const avg = rds.reduce((t, rd) => t + sgOf(rd), 0) / rds.length;
    // (update 477) attempts there (strokes-gained shots) and the drill's stat in those rounds
    const gs = st0.gs || null, gsd = gs ? gs.def : null, gsShort = gsd ? (gsd.label.replace(/ %$/, "").replace(/^Made Putt$/, "Made").replace(/^Hit Fairway$|^Fairway$/, "Fwy").replace(/^Proximity$/, "Prox").slice(0, 10)) : "";
    const shotsOf = (rs) => rs.reduce((t, rd) => t + (rd.shots || []).reduce((u, x) => u + ((!cat || x.cat === cat) && (!dist || x.dist === dist) ? x.w || 1 : 0), 0), 0);
    const statOf = (rs) => {
      if (!gs) return null;
      let t = 0, w = 0;
      for (const rd of rs) for (const o of rd.obs || []) { if (o.k !== gs.k) continue; if (obsFits(o, cat, dist, gs.mode || (gs.exact ? "exact" : "cat"))) { t += o.v * o.w; w += o.w; } }
      if (!w) return "\u2014";
      return gsd.pct ? [el("span", {}, `${Math.round(t / w)}%`), el("span", { class: "fx-sub" }, `${Math.round(t / 100)}/${Math.round(w)}`)] : [el("span", {}, `${(t / w).toFixed(1)}${gsd.unit || ""}`), el("span", { class: "fx-sub" }, `${Math.round(w)} shots`)];
    };
    const rowOf = (label, rs, strong = false) => { const v = rs.reduce((t, rd) => t + sgOf(rd), 0) / rs.length;
      return el("tr", { class: strong ? "strong fx-st-tot" : "" }, [el("td", {}, label), el("td", { class: "num" }, String(rs.length)), el("td", { class: "num" }, String(Math.round(shotsOf(rs)))), gsd ? el("td", { class: "num" }, statOf(rs)) : null, el("td", { class: `num ${v >= 0 ? "pos" : "neg"}` }, f2(v))]); };
    const day = (d) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return isNaN(x) ? String(d || "") : x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
    const what = cat ? `SG: ${CAT[cat]}${dist ? ` \u00b7 ${dist}` : ""}` : "SG: Total";
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const ov = el("div", { class: "gx-pop-overlay fx-st-ov", role: "dialog", "aria-modal": "true", "aria-label": "Best stretch" }, el("div", { class: "gx-pop fx-st-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, [`Best stretch \u00b7 ${what} `, stretchInfo(st0)]), el("h2", {}, `${rds.length} rounds in a row \u00b7 ${day(rds[0].date)} \u2013 ${day(rds.at(-1).date)}`)]), close]),
      svg,
      el("p", { class: "fx-st-avg" }, ["Over the stretch: ", el("strong", { class: avg >= 0 ? "pos" : "neg" }, `${f2(avg)} a round`), el("span", { class: "muted" }, ` (${f2(vals.reduce((t, v) => t + v, 0) / (n || 1))} over all ${n} rounds)`)]),
      el("div", { class: "table-scroll" }, el("table", { class: "plain fx-st-t" }, [
        // (update 477) short headings (the long name is above), and each tournament's shots and the drill's stat:
        // successes of attempts for a percentage (fairways hit, putts made…), the average for a number (proximity)
        el("thead", {}, el("tr", {}, [el("th", {}, "Tournament"), el("th", { class: "num" }, "Rds"), el("th", { class: "num" }, "Shots"), gsd ? el("th", { class: "num", title: gs.exact ? gsd.label : `${gsd.label}, every distance (the data has it only for the part of the game)` }, gs.exact ? gsShort : `${gsShort} (all)`) : null, el("th", { class: "num" }, "SG / rd")])),
        el("tbody", {}, [...[...evs.values()].map((e) => rowOf(`${e.event} ${e.year}`, e.rs)), rowOf("The stretch", rds, true)]),
      ])),
    ]));
    const shut = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut); ov.addEventListener("click", (e) => { if (e.target === ov) shut(); });
    document.addEventListener("keydown", onKey); document.body.appendChild(ov); close.focus();
  };
  const allFix = losses.reduce((t, b) => t + -b.perRd, 0);
  const loseCards = losses.map((b, i) => {
    const fix = -b.perRd, item = itemFor(b);
    return el("div", { class: "fx-card" }, [
      el("div", { class: "fx-card-h" }, [el("span", { class: "fx-n" }, String(i + 1)), el("strong", {}, nameOf(b)), el("span", { class: "neg fx-v" }, `${f2(b.perRd)} a round`)]),
      el("p", { class: "fx-why" }, `${b.att.toFixed(1)} shots a round, losing ${Math.abs(b.perShot).toFixed(3)} a shot against the tour average.`),
      el("p", { class: "fx-worth" }, ["Getting it to the tour average is worth ", el("strong", { class: "pos" }, `${f2(fix)} a round`), ranked ? (rankOf(recentV + fix) < rankOf(recentV) ? ` — a ${ord(rankOf(recentV))} → ${ord(rankOf(recentV + fix))} level.` : " (not enough on its own to move the rank).") : "."]),
      item ? el("div", { class: "fx-drill" }, [el("span", { class: "fx-k" }, "Practice"), lineWithStretch(item), addBtn([item], "＋ Add to practice")]) : null,
    ]);
  });
  const loseBox = el("section", { class: "panel fx" }, [
    el("p", { class: "fx-eyebrow" }, `Where ${you} lose${you === "you" ? "" : "s"} strokes \u00b7 ${picked} \u00b7 last ${N} rounds`),
    losses.length ? el("div", { class: "fx-cards" }, loseCards) : el("p", { class: "muted" }, `No part of the game is costing much over the last ${N} rounds. Keep doing what ${you === "you" ? "you’re" : "they’re"} doing.`),
    losses.length > 1 ? el("div", { class: "fx-total" }, [
      el("span", {}, ["All of them together: ", el("strong", { class: "pos" }, `${f2(allFix)} a round`), ranked ? ` — a ${ord(rankOf(recentV))} → ${ord(rankOf(recentV + allFix))} level` : ""]),
      addBtn(losses.map(itemFor), `＋ Add all ${losses.length} to practice`)]) : null,
  ]);

  // 4. is the practice working? Each drill in their plan: strokes gained there a round since it was added, against before
  const working = el("section", { class: "panel fx" }, [el("p", { class: "fx-eyebrow" }, "Is the practice working?"), el("p", { class: "muted small" }, "Checking the practice plan…")]);
  if (canAdd || isMine(me.key)) {
    import("./practice/plan.js").then((m) => m.planFor(getState(), me.key)).then((items) => {
      const rows = (items || []).filter((p) => p.cat && p.addedAt && (!on || on.has(p.cat))).map((p) => { // (update 474: the pills too)
        const day = String(p.addedAt).slice(0, 10), after = all.filter((rd) => String(rd.date || "").slice(0, 10) > day), before = all.filter((rd) => String(rd.date || "").slice(0, 10) <= day).slice(-N);
        const at = (rs) => { if (!rs.length) return null; let s = 0; for (const rd of rs) for (const x of rd.shots || []) if (x.cat === p.cat && (!p.dist || x.dist === p.dist)) s += x.sg || 0; return s / rs.length; };
        const a = at(after), b = at(before);
        const when = new Date(p.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const what = `${p.title || CAT[p.cat]}${p.dist && !(p.title || "").includes(p.dist) ? ` (${p.dist})` : ""}`;
        if (!after.length) return el("li", {}, [el("strong", {}, what), el("span", { class: "muted" }, ` · added ${when} · no rounds since`)]);
        const d = a - (b ?? 0);
        return el("li", {}, [el("strong", {}, what), ` · ${f2(a)} a round over ${after.length} ${after.length === 1 ? "round" : "rounds"} since ${when}`,
          b != null ? el("span", { class: Math.abs(d) < 0.01 ? "muted" : d > 0 ? "pos" : "neg" }, ` (${Math.abs(d) < 0.01 ? "no change" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(2)} against the ${before.length} rounds before`})`) : null]);
      });
      mount(working, [el("p", { class: "fx-eyebrow" }, "Is the practice working?"), rows.length ? el("ul", { class: "fx-list" }, rows) : el("p", { class: "muted small" }, `Nothing in ${whose} practice plan yet. Add a drill above and this tracks whether it shows up in real rounds.`)]);
    }).catch(() => mount(working, [el("p", { class: "fx-eyebrow" }, "Is the practice working?"), el("p", { class: "muted small" }, "Couldn’t read the practice plan just now.")]));
  } else mount(working, null);

  // 5. what to keep
  // (update 475) always there, named for the pills picked; a line when nothing there is gaining
  const keep = el("section", { class: "panel fx" }, [el("p", { class: "fx-eyebrow" }, `Keep doing \u00b7 ${picked}`),
    gains.length ? el("ul", { class: "fx-list" }, gains.map((b) => el("li", {}, [el("strong", {}, nameOf(b)), " \u00b7 ", el("span", { class: "pos" }, `${f2(b.perRd)} a round`), el("span", { class: "muted" }, ` (${b.att.toFixed(1)} shots a round)`)])))
      : el("p", { class: "muted small" }, `Nothing in ${on ? picked.toLowerCase() : "the game"} is gaining strokes against the tour over the last ${N} rounds.`)]);

  return [head, stand, loseBox, working.childNodes.length ? working : null, keep].filter(Boolean);
}

/** The Focus / Full stats switch. */
export function focusSwitch(S) {
  const st = S.st, on = st.view2 === "focus"; // (update 505: Full stats first, and what Stats opens on)
  const seg = el("div", { class: "seg seg-sm fx-switch", role: "group", "aria-label": "Stats view" }, [["full", "Full stats"], ["focus", "Focus"]].map(([v, l]) => {
    const cur = (on ? "focus" : "full") === v;
    const b = el("button", { type: "button", class: `seg-btn${cur ? " on" : ""}`, "aria-pressed": String(cur) }, l);
    b.addEventListener("click", () => { if (!cur) { st.view2 = v; S.draw(); } });
    return b;
  }));
  return el("div", { class: "fx-switch-row" }, seg);
}
