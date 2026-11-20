// (update 889) Scouting: whole careers, to judge a player's trajectory (is he getting better, and is it lasting?).
// Two ranks, side by side: the strokes-gained rank (every player on the tour picked, strokes gained per round, from the
// stats file: each season's year-end rank among players with the season's minimum rounds, and a rolling rank over each
// player's last 24 rounds against everyone else's last 24 as of that date, among players with 24+ rounds who have played
// in the year before) and the OWGR, when the stats file carries it (each season's last value, and the latest).
// A board of every player (sortable: year-end ranks each season and the change from the season before, seasons improving
// in a row, the rolling rank now and a year ago), and one player's career: a chart of the rolling rank (and the OWGR) over
// time with each season's year-end rank, the seasons in a table (strokes gained and rank in each part of the game).
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { card, samp, sg2, ord } from "./insightPages.js";
import { lastName } from "../current.js";
import * as DEF from "../defs.js";
import { defaultMinRounds } from "../sg.js";
// (update 904) who's ranked: the same rule as Player Stats (at least 33% of the most rounds anyone played, down to a 5)
const minRule = (most) => (most >= 15 ? defaultMinRounds(most) : Math.max(1, Math.floor(most * 0.33)));
const TS = (T) => (/korn/i.test(T) ? "KFT" : /dp|euro/i.test(T) ? "DPWT" : /pga/i.test(T) ? "PGA" : T);
const MINTXT = "a third as many rounds as the busiest player or more (as on Player Stats)";
import { outlookTab, takeGoto } from "./outlookView.js"; // (update 927) Future Outlook, moved here from Comparisons
import { scoutModel } from "../scoutModel.js"; // (update 890) comps, grades, tier odds, risers

const ROLL = 24, DAY = 864e5, YEAR = 365 * DAY;
const tot = (r) => (r.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const inCat = (r, c) => (r.shots || []).filter((s) => s.cat === c).reduce((t, s) => t + (s.sg || 0), 0);
const avg = (xs, f) => (xs.length ? xs.reduce((t, x) => t + f(x), 0) / xs.length : null);
const dOf = (r) => Date.parse(`${String(r.date || "").slice(0, 10)}T12:00:00`) || 0;
const owgrOf = (r) => { const o = (r.obs || []).find((x) => x.k === "owgr"); return o && Number.isFinite(o.v) && o.v > 0 ? o.v : null; };
const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const NS = "http://www.w3.org/2000/svg", sv = (t, a = {}, kids = []) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) n.setAttribute(k, v); for (const c of [].concat(kids)) if (c != null) n.append(c); return n; };

export async function scoutTab(box, key0, name0) {
  mount(box, el("div", { class: "ip ip-embed sc" }, el("p", { class: "muted ip-wait" }, "Building every player's career…")));
  const wrap = box.firstChild, st = window.__authState || {};
  const { field } = await PI.loadField(st).catch(() => ({ field: [] }));
  if (!field.length) { mount(wrap, el("p", { class: "muted" }, "No stats file to scout from yet.")); return; }
  const tours = [...new Set(field.flatMap((p) => p.rounds.map((r) => r.tour)).filter(Boolean))].sort((a, b) => field.reduce((t, p) => t + p.rounds.filter((r) => r.tour === b).length, 0) - field.reduce((t, p) => t + p.rounds.filter((r) => r.tour === a).length, 0));
  const fp0 = field.find((p) => p.key === key0);
  let tour = (fp0 && [...new Set(fp0.rounds.map((r) => r.tour))].sort((a, b) => fp0.rounds.filter((r) => r.tour === b).length - fp0.rounds.filter((r) => r.tour === a).length)[0]) || tours[0] || null;
  // (update 910) every tour together: each player shown on his main tour (most rounds in his latest season), and every
  // forecast is his predicted finish on the PGA Tour, wherever he plays now
  const hasSg0 = (r) => (r.shots || []).some((x) => x.sg != null);
  const mainTour = new Map(field.map((p) => { const rs = p.rounds.filter((r) => r.tour && hasSg0(r)); if (!rs.length) return [p.key, null]; const ly = rs.map(PI.yrOf).sort().at(-1), c = new Map(); for (const r of rs) if (PI.yrOf(r) === ly) c.set(r.tour, (c.get(r.tour) || 0) + 1); return [p.key, [...c].sort((a, b) => b[1] - a[1])[0][0]]; }));
  const FT = tours.find((t) => /^pga( tour)?$/i.test(String(t).trim())) || tours.find((t) => /pga/i.test(t)) || tours[0];
  if (key0 && mainTour.get(key0)) tour = mainTour.get(key0);
  let sel = key0, sortK = "rank", sortDir = 1, q = "", minSeasons = 1, part = "board";
  if (takeGoto()) part = "outlook"; // (update 927: sent here for Future Outlook)
  const memo = new Map(), mMemo = new Map(), modelOf = (T) => mMemo.get(T) || mMemo.set(T, scoutModel(build(T))).get(T);
  // (update 905) the projections: the site's one forecaster (forecast.js, as Comparisons' Future Outlook), for every player
  // on the tour (the next three seasons' ranks), and with the chances for the player opened
  const FCS = new Map(), FULL = new Map(); let cfP = null;
  const fieldForFc = () => (cfP ||= import("../fieldSummary.js").then((m) => m.currentField()).then((cf) => (cf?.field?.length ? cf.field : field)).catch(() => field));
  function ensureFc() { const T = FT; if (FCS.has(T)) return FCS.get(T); const o = { busy: true, map: new Map() }; FCS.set(T, o);
    Promise.all([fieldForFc(), import("../forecastClient.js")]).then(([fld, FC]) => FC.runForecast(fld, { tour: T, lite: true, players: allRows().map((r) => ({ key: r.k, label: r.nm })) }))
      .then((res) => { for (const f of res.fcs || []) if (f) o.map.set(f.key, f); o.info = res.info; }).catch((e) => { console.warn(e); o.err = true; }).finally(() => { o.busy = false; if (wrap.isConnected) draw(); });
    return o; }
  // every player once, on his main tour (his row from that tour's build)
  let allMemo = null; function allRows() { if (allMemo) return allMemo; const out = []; for (const T of tours) for (const r of build(T).rows) if ((mainTour.get(r.k) || T) === T) out.push({ ...r, T }); return (allMemo = out); }
  function ensureFull(T0, k, nm) { const T = FT; void T0; const id = `${T}|${k}`; if (FULL.has(id)) return FULL.get(id); const o = { busy: true }; FULL.set(id, o);
    Promise.all([fieldForFc(), import("../forecastClient.js")]).then(([fld, FC]) => FC.runForecast(fld, { tour: T, players: [{ key: k, label: nm }] }))
      .then((res) => { o.fc = res.fcs?.[0] || null; }).catch(() => { o.err = true; }).finally(() => { o.busy = false; if (wrap.isConnected && sel === k) draw(); });
    return o; }

  // everything for one tour: each player's rounds (dated, with running sums), each season's ranks, the rolling ranks
  function build(T) {
    if (memo.has(T)) return memo.get(T);
    const onT = (r) => !T || r.tour === T;
    const P = field.map((p) => { const hasSg = (r) => (r.shots || []).some((x) => x.sg != null && (x.w ?? 1) > 0); /* (update 894: a round with no strokes gained in the file isn't a 0.00 round) */
      let rs = p.rounds.filter((r) => onT(r) && !r.eventLevel && hasSg(r)); if (!rs.length) rs = p.rounds.filter((r) => onT(r) && hasSg(r)); /* (a tour kept event by event: those) */
      rs = rs.slice().sort((a, b) => dOf(a) - dOf(b)); const ds = rs.map(dOf), cum = [0]; for (const r of rs) cum.push(cum.at(-1) + tot(r));
      // (update 901) each season's rounds by date with running sums: the season-to-date rank at any date
      const sy = new Map(); for (const r of rs) { const y = PI.yrOf(r), o = sy.get(y) || sy.set(y, { ds: [], cum: [0] }).get(y); o.ds.push(dOf(r)); o.cum.push(o.cum.at(-1) + tot(r)); }
      return { k: p.key, nm: p.name, birth: p.birth, rs, ds, cum, sy }; }).filter((p) => p.rs.length);
    const years = [...new Set(P.flatMap((p) => p.rs.map(PI.yrOf)))].sort();
    // year-end ranks: each season, total and each part of the game, among players with the season's minimum rounds
    const season = {}; for (const y of years) { const F0 = P.map((p) => ({ p, rs: p.rs.filter((r) => PI.yrOf(r) === y) })), minY = minRule(Math.max(0, ...F0.map((x) => x.rs.length))), F = F0.filter((x) => x.rs.length >= minY);
      const out = new Map(); for (const x of F) out.set(x.p.k, { n: x.rs.length, sg: avg(x.rs, tot), cat: Object.fromEntries(PI.CATS.map((c) => [c, avg(x.rs, (r) => inCat(r, c))])), ow: [...x.rs].reverse().map(owgrOf).find((v) => v != null) ?? null });
      const rankBy = (f, set) => { const l = [...out].sort((a, b) => f(b[1]) - f(a[1])); l.forEach(([k], i) => set(out.get(k), i + 1)); };
      rankBy((o) => o.sg, (o, r) => { o.rank = r; }); for (const c of PI.CATS) rankBy((o) => o.cat[c], (o, r) => { (o.cr ||= {})[c] = r; });
      season[y] = { of: out.size, by: out }; }
    const lastY = years.at(-1), lastDate = Math.max(...P.map((p) => p.ds.at(-1)));
    // rolling: a player's last 24 rounds as of a date (null when fewer, or none in the year before)
    const ub = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; } return lo; };
    const rollAt = (p, t) => { const i = ub(p.ds, t); if (i < ROLL || t - p.ds[i - 1] > YEAR) return null; return (p.cum[i] - p.cum[i - ROLL]) / ROLL; };
    const rankAt = (p, t) => { const me = rollAt(p, t); if (me == null) return null; let r = 1, n = 0; for (const o of P) { const v = rollAt(o, t); if (v == null) continue; n++; if (o !== p && v > me) r++; } return { r, n, v: me }; };
    const rows = P.map((p) => { const ranks = years.map((y) => season[y].by.get(p.k) || null), now = rankAt(p, lastDate), ago = rankAt(p, lastDate - YEAR);
      // seasons improving (or slipping) in a row, up to the latest season they're ranked in
      const rk = ranks.map((o) => o?.rank ?? null), have = rk.map((v, i) => [v, i]).filter(([v]) => v != null); let streak = 0;
      for (let i = have.length - 1; i > 0; i--) { const d = have[i - 1][0] - have[i][0]; if (d === 0) break; const dir = Math.sign(d); if (streak === 0 || Math.sign(streak) === dir) streak += dir; else break; }
      const ows = p.rs.map(owgrOf).filter((v) => v != null);
      return { p, k: p.k, nm: p.nm, age: p.birth ? Math.floor((Date.now() - Date.parse(p.birth)) / (365.25 * DAY)) : null, ranks, rk, streak, nSeasons: have.length, now, ago,
        trend: now && ago ? ago.r - now.r : null, ow: ows.length ? ows.at(-1) : null, last: rk.findLast((v) => v != null) ?? null }; });
    // (update 901) the season-to-date rank: strokes gained per round in that season up to the date, against everyone else's
    // season so far, among players with the season's minimum rounds by then (what the year-end rank is, at the season's end)
    // (the minimum at that date the same way: a third of the most rounds anyone had played in that season by then)
    const stdRankAt = (p, y, t) => { const at = P.map((o) => { const s0 = o.sy.get(y); const i = s0 ? ub(s0.ds, t) : 0; return [o, i, i ? s0.cum[i] / i : null]; }), mn = minRule(Math.max(0, ...at.map((x) => x[1])));
      const meA = at.find((x) => x[0] === p); if (!meA || meA[1] < mn) return null; let r = 1, n = 0; for (const [o, i, v] of at) { if (i < mn) continue; n++; if (o !== p && v > meA[2]) r++; } return { r, n, v: meA[2] }; };
    const out = { P, years, season, lastY, lastDate, rows, rankAt, stdRankAt, hasOw: rows.some((r) => r.ow != null) }; memo.set(T, out); return out;
  }

  // (update 900) phones: cards instead of wide tables, a sort menu instead of column headers
  const mq = window.matchMedia("(max-width: 640px)"), PH = () => mq.matches; let shown = 25; // (update 938: 25 at a time on a phone)
  try { mq.addEventListener("change", () => { if (wrap.isConnected) draw(); }); } catch { /* */ }
  const lastYAll = String(Math.max(...field.flatMap((p) => p.rounds.map((r) => Number(PI.yrOf(r)) || 0))));
  const thinMap = new Map(field.map((p) => [p.key, p.rounds.filter((r) => hasSg0(r) && Number(PI.yrOf(r)) >= Number(lastYAll) - 1).length])), thinN = (k) => thinMap.get(k) || 0;
  // (update 911) how the tours compare, from the players who crossed: everyone ranked on a tour one season and on the PGA
  // Tour the next (or on both in the same season). Their place on each, as a share of the way down that season's
  // leaderboard, fitted as a straight line on a log scale (log PGA share = a + b × log share on his tour), so "1st on the
  // Korn Ferry" maps to the PGA place such players actually reached
  const bridgeMemo = new Map();
  // (update 912) a player's rounds in a season, every tour (for whose tour he really played that season)
  const rdsIn = new Map(); for (const p of field) for (const r0 of p.rounds) if (hasSg0(r0) && !r0.eventLevel) { const id = `${p.key}|${PI.yrOf(r0)}`; rdsIn.set(id, (rdsIn.get(id) || 0) + 1); }
  const roundsIn = (k, y) => rdsIn.get(`${k}|${y}`) || 0;
  function bridge(T) { if (bridgeMemo.has(T)) return bridgeMemo.get(T); let out = null;
    if (T && T !== FT) { const BT = build(T), BP = build(FT), pairs = [];
      for (const y of BT.years) for (const [k, o] of BT.season[y].by) { const nm = BT.P.find((p) => p.k === k)?.nm || k;
        const same = BP.season[y]?.by.get(k), nx = BP.season[String(Number(y) + 1)]?.by.get(k);
        // (update 912) a player counts as this tour's only when most of his rounds that season were here; one on both tours in
        // the same season counts only with 30+ rounds on each (Rory McIlroy's few DP World events don't make him a DP World player)
        const nAll = roundsIn(k, y), mostHere = o.n * 2 > nAll;
        if (same && !(o.n >= 30 && same.n >= 30)) { /* too few on one of them */ } else if (same) pairs.push({ k, nm, y, kind: "same", qT: o.rank / BT.season[y].of, qP: same.rank / BP.season[y].of, rT: o.rank, rP: same.rank, yP: y, w: Math.min(o.n, same.n) });
        if (nx && mostHere) pairs.push({ k, nm, y, kind: "next", qT: o.rank / BT.season[y].of, qP: nx.rank / BP.season[String(Number(y) + 1)].of, rT: o.rank, rP: nx.rank, yP: String(Number(y) + 1), w: Math.min(o.n, nx.n) }); }
      const nP = Math.round(BP.season[BP.years.filter((y) => y !== BP.lastY).at(-1) || BP.lastY]?.of || 0), nT = Math.round(BT.season[BT.years.filter((y) => y !== BT.lastY).at(-1) || BT.lastY]?.of || 0);
      let a = 0, b = 1, fit = "none";
      if (pairs.length >= 8) { let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (const q of pairs) { const x = Math.log(q.qT), y0 = Math.log(q.qP), w = q.w; sw += w; sx += w * x; sy += w * y0; sxx += w * x * x; sxy += w * x * y0; }
        const mx = sx / sw, my = sy / sw, vx = sxx / sw - mx * mx; b = vx > 1e-9 ? Math.max(0.2, Math.min(1.5, (sxy / sw - mx * my) / vx)) : 1; a = my - b * mx; fit = "line"; }
      else if (pairs.length >= 3) { a = pairs.reduce((t, q) => t + Math.log(q.qP / q.qT), 0) / pairs.length; fit = "shift"; }
      const eq = (rank, nOf = nT) => (fit === "none" || !nP ? null : Math.max(1, Math.round(nP * Math.min(1, Math.exp(a + b * Math.log(Math.max(1e-4, rank / Math.max(1, nOf))))))));
      out = { T, pairs, a, b, fit, nP, nT, eq }; }
    bridgeMemo.set(T, out); return out; }
  const pgaEq = (T, rank, nOf) => { const br = bridge(T); return br ? br.eq(rank, nOf) : null; };
  // (update 916) clutch: from every saved scorecard (PGA Tour and Korn Ferry), by name to this page's players
  let CL = null; function ensureClutch() { if (CL) return CL; CL = { busy: true, byName: new Map(), list: [] };
    Promise.all([import("../clutch.js"), PI.clutchEvents(["R", "H"], [Number(lastYAll) - 2, Number(lastYAll) - 1, Number(lastYAll)])]).then(([M0, evs]) => { const P0 = M0.clutchFrom(evs); CL.events = evs.length; CL.diag = evs.diag; CL.list = [...P0.values()]; for (const o of CL.list) CL.byName.set(PI.nameKey(o.name), o); CL.fmt = M0.clutchFmt; })
      .catch((e) => { console.warn("clutch", e); CL.err = true; }).finally(() => { CL.busy = false; if (wrap.isConnected) draw(); });
    return CL; }
  const clutchOf = (nm) => ensureClutch().byName.get(PI.nameKey(nm)) || null;
  // (update 928) trajectory, from his own rounds so anyone can check it on the Stats page: strokes gained per round over the
  // last 12 months against the 12 months before (on his main tour, against the fields he played), in total and in each
  // part of the game. "Rising" / "Slipping" only when the change is bigger than luck: round-to-round, a tour player's score
  // against the field swings by about 2.5-3 strokes (worked out from this file), so two averages of ~60 rounds differ by
  // chance by about ±0.5; the change has to clear about twice that to be called (about 95% sure), once to be "probably".
  const END = Math.max(...field.flatMap((p) => p.rounds.map(dOf)).filter((t) => t > 0));
  const winTxt = (a, b) => `${new Date(a + DAY).toLocaleDateString(undefined, { month: "short", year: "numeric" })} – ${new Date(b).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
  const W1 = winTxt(END - YEAR, END), W0 = winTxt(END - 2 * YEAR, END - YEAR), MINW = 15;
  const sdMemo = new Map(); const sdOf = (T) => { if (sdMemo.has(T)) return sdMemo.get(T); let e = 0, n = 0; for (const p of build(T).P) { if (p.rs.length < 20) continue; const m = (p.cum.at(-1)) / p.rs.length; for (const x of p.rs) { e += (tot(x) - m) ** 2; n++; } } const v = n ? Math.sqrt(e / n) : 2.8; sdMemo.set(T, v); return v; };
  const tjMemo = new Map();
  const trajOf = (k) => { if (tjMemo.has(k)) return tjMemo.get(k);
    const row = allRows().find((x) => x.k === k), p = row?.p; let out = null;
    if (p) { const in1 = p.rs.filter((x) => { const t = dOf(x); return t > END - YEAR && t <= END; }), in0 = p.rs.filter((x) => { const t = dOf(x); return t > END - 2 * YEAR && t <= END - YEAR; });
      const n1 = in1.length, n0 = in0.length;
      if (n1 >= MINW) { const v1 = avg(in1, tot), v0 = n0 ? avg(in0, tot) : null, c1 = Object.fromEntries(PI.CATS.map((c) => [c, avg(in1, (x) => inCat(x, c))])), c0 = n0 ? Object.fromEntries(PI.CATS.map((c) => [c, avg(in0, (x) => inCat(x, c))])) : null;
        const sdR = sdOf(row.T), se = n0 ? sdR * Math.sqrt(1 / n1 + 1 / n0) : null, d = n0 ? v1 - v0 : null, z = se ? d / se : 0;
        const k0 = n0 < MINW ? "new" : z >= 1.96 ? "up" : z >= 1 ? "up?" : z <= -1.96 ? "down" : z <= -1 ? "down?" : "steady";
        out = { k: k0, now: v1, ago: v0, change: d, n1, n0, c1, c0, se, z, sdR, T: row.T }; } }
    tjMemo.set(k, out); return out; };
  // the chance luck alone moves an average this much (one-sided), in words
  const tail = (z) => { const x = Math.abs(z), t = 1 / (1 + 0.2316419 * x); return 0.3989423 * Math.exp(-x * x / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); }; // (the normal curve beyond z)
  const luckTxt = (z) => { const pp = tail(z); return pp < 0.001 ? "less than 1 time in 1,000" : pp < 0.45 ? `about 1 time in ${Math.max(2, Math.round(1 / pp)).toLocaleString()}` : "easily"; };
  const TRJ = { up: ["▲ Rising", "up"], "up?": ["▲ Probably rising", "up"], down: ["▼ Slipping", "down"], "down?": ["▼ Probably slipping", "down"], steady: ["● Steady", "steady"], new: ["New", "none"] };
  const trajTip = (t) => (t && t.k !== "new" ? `Strokes gained per round: ${sg2(t.ago)} over ${W0} (${t.n0} rounds) → ${sg2(t.now)} over ${W1} (${t.n1} rounds) = ${sg2(t.change)}. Luck alone would move it this much ${luckTxt(t.z)}.` : t ? `Only ${t.n0} rounds in ${W0}: too few to compare. ${sg2(t.now)} per round over ${W1} (${t.n1} rounds).` : `Fewer than ${MINW} rounds in ${W1}.`);
  function pickKey(k) { sel = k; if (mainTour.get(k)) tour = mainTour.get(k); draw();
    // (update 928) down to his report, below the table (again once the forecast lands, if that moved it)
    const go = () => { const d = wrap.querySelector(".sc-detail"); if (!d) return; const bar = Math.max(0, document.querySelector(".rail")?.getBoundingClientRect().bottom || 0); window.scrollTo({ top: Math.max(0, d.getBoundingClientRect().top + window.scrollY - bar - 10) }); };
    setTimeout(go, 60); setTimeout(() => { const d = wrap.querySelector(".sc-detail"); if (d && Math.abs(d.getBoundingClientRect().top) > 120) go(); }, 900); }
  function draw() {
    const y0 = window.scrollY; queueMicrotask(() => { if (Math.abs(window.scrollY - y0) > 2) window.scrollTo(0, y0); }); // (update 917: a tab, or a forecast arriving, never jumps the page)
    const B = build(tour), { years, lastY } = B, M = modelOf(tour), T1 = M.tiers[0], T2 = M.tiers[1];
    const pc = (v) => (v == null ? "—" : v < 0.005 ? "<1%" : v > 0.995 ? ">99%" : `${Math.round(v * 100)}%`);
    const gCls = (g) => (g >= 90 ? "g-hi" : g >= 70 ? "g-good" : g >= 35 ? "g-avg" : g >= 15 ? "g-low" : "g-poor"); // (update 899: 0-100)
    const gEl = (g, t = null) => el("b", { class: `sc-g ${gCls(g)}`, title: t }, String(g));
    const detail = el("div", { class: "sc-detail" }), boardBox = el("div", {});
    mount(wrap, [el("header", { class: "ip-head ip-head-slim" }, el("div", {}, [el("p", { class: "ip-kick", style: "--ipc:#bf5af2" }, ["Scouting · all tours"]), el("h2", { class: "ip-h" }, "Scouting"),
      el("p", { class: "muted" }, "How good is a player, is he getting better, and where is he likely to finish next season? Pick a player below for a plain-English report.")])),
      // (update 903) how to read it, in three lines
      el(PH() ? "details" : "div", { class: "sc-how" }, [el(PH() ? "summary" : "strong", {}, "How to read this page"), el("ul", {}, [
        el("li", {}, [el("b", {}, "Rank now"), " = where he stands on his own tour this season (PGA, DP World or Korn Ferry) by strokes gained per round (1st is the best)."]),
        el("li", {}, [el("b", {}, "Trajectory"), ` = his strokes gained per round over the last 12 months (${W1}) against the 12 months before (${W0}). Rising or Slipping only when the change is bigger than luck explains. Open a player for where the change came from and whether it's the kind that lasts.`]),
        el("li", {}, [el("b", {}, "Next season"), " = his predicted finish on the PGA Tour, wherever he plays now (every tour's results are put on one scale by how strong its fields are)."])])]),
      partPills(), boardBox, detail]); // (update 928: the table first; a player's report opens below it)
    function partPills() { return el("div", { class: "ip-pills sc-parts" }, [["board", "Every player"], ["pred", "Predictions (3 seasons)"], ["outlook", "Outlook & report"], ["risers", "Biggest improvers"], ["clutch", "Clutch"], ["how", "The math"]].map(([v, l]) => { const b = el("button", { type: "button", class: `ip-pill${v === part ? " on" : ""}`, "aria-pressed": String(v === part) }, l); b.addEventListener("click", () => { part = v; draw(); }); return b; })); }

    // (update 903) the board, simply: path of year-end ranks, rank now, direction, next season's best guess, top-10 chance
    function drawBoard() {
      // (update 910) every tour together: each player on his main tour; the forecasts all on the PGA Tour
      const qt = q.trim().toLowerCase(), list = allRows().filter((r) => r.nSeasons >= 1 && (!qt || r.nm.toLowerCase().includes(qt))); // (update 928: the search)
      const S = (r) => modelOf(r.T).scout(r.k), rankNow = (r) => S(r)?.cur.rank ?? r.last ?? null, rnTxt = (r) => { const n = rankNow(r); if (!n) return "—"; const e = r.T !== FT ? pgaEq(r.T, n, S(r)?.cur.of) : null; return `${ord(n)} ${TS(r.T)}${e ? ` (≈${ord(e)} PGA)` : ""}`; };
      const dirOf = (r) => { const t = trajOf(r.k); if (!t) return { k: "none", t: "\u2014", ch: null }; const [txt, k] = TRJ[t.k]; return { k, t: txt, ch: t.k === "new" ? null : t.change, tr: t }; }; // (update 928: his own last 12 months against the 12 before)
      if (!["rank", "dir", "next", "t1", "age", "nm"].includes(sortK)) { sortK = "next"; sortDir = 1; }
      const val = (r) => (sortK === "rank" ? rankNow(r) ?? 1e9 : sortK === "dir" ? -(dirOf(r).ch ?? -1e9) : sortK === "next" ? ensureFc(tour).map.get(r.k)?.years?.[0]?.rank ?? 1e9 : sortK === "t1" ? ensureFc(tour).map.get(r.k)?.years?.[2]?.rank ?? 1e9 : sortK === "age" ? r.age ?? 1e9 : r.nm);
      list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir; });
      const path = (r) => { const Bt = build(r.T); return Bt.years.map((y, i) => (r.ranks[i] ? `${r.ranks[i].rank}${y === Bt.lastY ? "*" : ""}` : null)).filter(Boolean).join(" → ") || "—"; };
      const pick = (r) => pickKey(r.k);
      const SORTS = [["rank", "Rank now"], ["dir", "Rising fastest"], ["next", "Next season on the PGA (best guess)"], ["t1", "In 3 seasons"], ["age", "Youngest"], ["nm", "Name"]];
      const note = samp(`Rank now and Path: on his own tour (PGA, DPWT or KFT), year-end rank each season (* this season so far). Trajectory: his strokes gained per round over the last 12 months (${W1}) against the 12 months before (${W0}), on his tour; the small line is the two numbers. Rising / Slipping only when the change is bigger than luck explains about 95% of the time ("Probably" past about 84%). Next season / In 3 seasons: his predicted finish on the PGA Tour, wherever he plays now (the same forecaster as the Outlook tab). Tap a player for the full report.`);
      if (PH()) {
        const sortSel = el("select", { class: "ip-sel sc-sortsel", "aria-label": "Sort by" }, SORTS.map(([k, l]) => el("option", { value: k, ...(k === sortK ? { selected: true } : {}) }, `Sort: ${l}`)));
        sortSel.addEventListener("change", () => { sortK = sortSel.value; sortDir = 1; shown = 25; drawBoard(); });
        // (update 938) a phone: a compact row a player (name, age, trajectory; then rank now, next season, in 3 seasons)
        const cardOf = (r) => { const d = dirOf(r), f = ensureFc(tour).map.get(r.k);
          const arrow = d.k === "up" ? "\u25B2" : d.k === "down" ? "\u25BC" : d.k === "steady" ? "\u25CF" : "";
          const b = el("button", { type: "button", class: `sc-pc sc-pc2${r.k === sel ? " on" : ""}` }, [
            el("div", { class: "sc-pc2-a" }, [el("strong", {}, r.nm), r.age != null ? el("span", { class: "muted small" }, ` ${r.age}`) : null,
              el("span", { class: `sc-dir dir-${d.k}`, title: trajTip(d.tr) }, d.ch != null ? `${arrow} ${sg2(d.ch)}` : d.t)]),
            el("div", { class: "sc-pc2-b" }, [el("span", {}, ["Now ", el("b", {}, rnTxt(r))]), f?.years?.[0] ? el("span", {}, ["Next ", el("b", {}, `\u2248${ord(f.years[0].rank)}`)]) : null, f?.years?.[2] ? el("span", {}, ["In 3 ", el("b", {}, `\u2248${ord(f.years[2].rank)}`)]) : null])]);
          b.addEventListener("click", () => pick(r)); return b; };
        const more = list.length > shown ? el("button", { type: "button", class: "btn ghost sc-more" }, `Show more (${list.length - shown} left)`) : null;
        more?.addEventListener("click", () => { shown += 25; drawBoard(); });
        mount(boardBox, card("Every player · all tours", "#bf5af2", [sortSel, el("div", { class: "sc-pcs" }, list.slice(0, shown).map(cardOf)), more, note]));
        return; }
      const th = (k, label, cls0 = "num", title = null) => { if (!k) return el("th", { class: cls0, title }, label); const b = el("th", { class: `${cls0} sc-sort${sortK === k ? " on" : ""}`, title, tabindex: "0" }, [label, sortK === k ? (sortDir > 0 ? " ▲" : " ▼") : ""]);
        const go = () => { if (sortK === k) sortDir = -sortDir; else { sortK = k; sortDir = 1; } drawBoard(); }; b.addEventListener("click", go); b.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); return b; };
      const rows = list.slice(0, 300).map((r) => { const sc = S(r), d = dirOf(r), rn = rankNow(r);
        const tr = el("tr", { class: `sc-row${r.k === sel ? " on" : ""}`, tabindex: "0" }, [el("td", { class: "sc-nm" }, r.nm), el("td", { class: "num" }, r.age ?? "—"), el("td", { class: "sc-path" }, path(r)),
          el("td", { class: "num strong" }, (() => { const n = rankNow(r); if (!n) return "\u2014"; const e = r.T !== FT ? pgaEq(r.T, n, S(r)?.cur.of) : null; return [`${ord(n)} ${TS(r.T)}`, e ? el("small", { class: "sc-sub" }, `\u2248${ord(e)} PGA`) : null]; })()), el("td", { class: `sc-dir dir-${d.k}`, title: trajTip(d.tr) }, d.ch != null ? [`${d.t} ${sg2(d.ch)}`, el("small", { class: "sc-sub" }, `${sg2(d.tr.ago)} \u2192 ${sg2(d.tr.now)}`)] : d.t),
          el("td", { class: "num" }, (() => { const f = ensureFc(tour).map.get(r.k); return f?.years?.[0] ? `≈${ord(f.years[0].rank)}` : ensureFc(tour).busy ? "…" : "—"; })()), el("td", { class: "num" }, (() => { const f = ensureFc(tour).map.get(r.k); return f?.years?.[2] ? `≈${ord(f.years[2].rank)}` : ensureFc(tour).busy ? "…" : "—"; })())]);
        tr.addEventListener("click", () => pick(r)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(r); }); return tr; });
      mount(boardBox, card("Every player · all tours", "#bf5af2", [
        el("div", { class: "ip-tw sc-tw" }, el("table", { class: "ip-t sc-t" }, [el("thead", {}, el("tr", {}, [th("nm", "Player", ""), th("age", "Age"), th(null, "Path (year-end ranks)", "", "Each season's year-end rank, oldest first (* this season so far)"),
          th("rank", "Rank now (his tour)"), th("dir", "Trajectory", "", `Strokes gained per round, last 12 months (${W1}) against the 12 before (${W0})`), th("next", "Next season (PGA)", "num", "Predicted finish on the PGA Tour next season"), th("t1", "In 3 seasons (PGA)", "num", "Predicted finish on the PGA Tour three seasons from now")])),
          el("tbody", {}, rows)])),
        list.length > 300 ? el("p", { class: "muted small" }, `Showing 300 of ${list.length}: sort to see others.`) : null, note]));
    }
    function drawDetail() {
      const r = B.rows.find((x) => x.k === sel);
      if (!sel) { mount(detail, null); return; } // (update 928: nothing opened: the table only)
      if (!r) { mount(detail, card("A player's career", "#bf5af2", el("p", { class: "muted" }, `No ${tour || ""} rounds on record for ${name0 || "this player"}. Pick a player in the table.`))); return; }
      const p = r.p, last = lastName(r.nm);
      // the chart's points: the rolling rank at the end of each of their events (and the OWGR there)
      const ends = []; { const byEv = new Map(); for (const x of p.rs) byEv.set(`${x.event}|${PI.yrOf(x)}`, Math.max(byEv.get(`${x.event}|${PI.yrOf(x)}`) || 0, dOf(x))); for (const t of [...byEv.values()].sort((a, b) => a - b)) ends.push(t); }
      const pts = ends.map((t) => ({ t, y: String(new Date(t).getFullYear()), rr: B.rankAt(p, t), sr: B.stdRankAt(p, String(new Date(t).getFullYear()), t), ow: (() => { const i = p.ds.findLastIndex((d) => d <= t); for (let j = i; j >= 0; j--) { const v = owgrOf(p.rs[j]); if (v != null) return v; } return null; })() })).filter((x) => x.rr || x.sr || x.ow != null);
      const yrPts = years.map((y, i) => r.ranks[i] ? { y, partial: y === lastY, o: r.ranks[i], t: Math.max(...p.rs.filter((x) => PI.yrOf(x) === y).map(dOf)) } : null).filter(Boolean);
      const chart = careerChart(pts, yrPts, B.hasOw, wrap.clientWidth || 640);
      // the story
      const seq = yrPts.map((x) => `${ord(x.o.rank)}${x.y === lastY ? ` (${x.y} so far)` : ` (${x.y})`}`).join(" → ");
      const best = pts.filter((x) => x.rr).sort((a, b) => a.rr.r - b.rr.r)[0];
      const bullets = [
        yrPts.length ? `Year-end rank: ${seq}` : `Not ranked in a season yet (needs enough rounds in one: ${MINTXT})`,
        r.streak >= 2 ? `Improved ${r.streak} seasons in a row` : r.streak <= -2 ? `Slipped ${-r.streak} seasons in a row` : r.streak === 1 ? "Improved on the season before" : r.streak === -1 ? "Slipped from the season before" : null,
        r.now ? `Last ${ROLL} rounds: ${ord(r.now.r)} of ${r.now.n} (${sg2(r.now.v)} per round)${r.ago ? `; a year ago ${ord(r.ago.r)} (${r.trend > 0 ? `up ${r.trend}` : r.trend < 0 ? `down ${-r.trend}` : "the same"})` : ""}` : `Fewer than ${ROLL} rounds in the past year: no rolling rank now`,
        best ? `Best rolling rank: ${ord(best.rr.r)} (${fmtD(best.t)})` : null,
        r.ow != null ? `OWGR: ${Math.round(r.ow)} (latest in the file)${(() => { const ys = yrPts.filter((x) => x.o.ow != null); return ys.length >= 2 ? `; year-end ${ys.map((x) => `${Math.round(x.o.ow)} (${x.y})`).join(" → ")}` : ""; })()}` : null,
        r.age != null ? `Age ${r.age}` : null].filter(Boolean);
      // the seasons, with each part of the game (where the change came from)
      const segs = yrPts.map((x, i) => { const prev = yrPts[i - 1]?.o; return el("tr", {}, [el("td", {}, x.y === lastY ? `${x.y}*` : x.y), el("td", { class: "num" }, x.o.n), el("td", { class: "num strong" }, sg2(x.o.sg)),
        el("td", { class: "num strong" }, [`${ord(x.o.rank)}`, prev ? el("small", { class: prev.rank > x.o.rank ? "pos" : prev.rank < x.o.rank ? "neg" : "" }, ` ${prev.rank > x.o.rank ? "▲" : prev.rank < x.o.rank ? "▼" : ""}${prev.rank !== x.o.rank ? Math.abs(prev.rank - x.o.rank) : ""}`) : null]),
        ...PI.CATS.map((c) => el("td", { class: "num", title: `${PI.CATN[c]}: ${sg2(x.o.cat[c])} per round, ${ord(x.o.cr[c])}` }, [sg2(x.o.cat[c]), el("small", { class: "muted" }, ` ${ord(x.o.cr[c])}`)])),
        B.hasOw ? el("td", { class: "num" }, x.o.ow != null ? String(Math.round(x.o.ow)) : "—") : null]); });
      const det = el("details", { class: "sc-more-det" }, [el("summary", {}, "Show the details: ratings, odds and similar players"), reportCard(r)]);
      const backB = PH() ? (() => { const bb = el("button", { type: "button", class: "btn ghost small sc-back" }, "\u2191 Back to the list"); bb.addEventListener("click", () => { const bar = Math.max(0, document.querySelector(".rail")?.getBoundingClientRect().bottom || 0); window.scrollTo({ top: Math.max(0, boardBox.getBoundingClientRect().top + window.scrollY - bar - 60) }); }); return bb; })() : null; // (update 938)
      mount(detail, [backB, verdictCard(r), det, card(`${r.nm} · career`, "#bf5af2", [el("p", { class: "sc-chart-help" }, "Higher on the chart is better. Blue line: his rank as each season went on. Gold dot: where he finished that season (or stands now). Grey dots: his last 24 rounds (recent form)."),el("ul", { class: "ip-bul" }, bullets.map((b) => el("li", {}, b))), chart,
        segs.length && PH() ? el("div", { class: "sc-pcs" }, yrPts.map((x, i) => { const prev = yrPts[i - 1]?.o, d = prev ? prev.rank - x.o.rank : null; // (update 900) phones: a card a season
          return el("div", { class: "sc-sea" }, [el("div", { class: "sc-pc-top" }, [el("strong", {}, `${x.y}${x.y === lastY ? " so far" : ""}`), el("span", {}, [el("b", {}, ord(x.o.rank)), d ? el("small", { class: d > 0 ? "pos" : "neg" }, ` ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`) : null, el("span", { class: "muted small" }, ` · ${sg2(x.o.sg)} · ${x.o.n} rds`)])]),
            el("div", { class: "sc-sea-cats" }, PI.CATS.map((c) => el("span", {}, [el("small", { class: "muted" }, { OTT: "Tee", APP: "Approach", ARG: "Short game", PUTT: "Putting" }[c]), el("b", {}, sg2(x.o.cat[c])), el("small", { class: "muted" }, ord(x.o.cr[c]))])))]); }))
        : segs.length ? el("div", { class: "ip-tw" }, el("table", { class: "ip-t sc-seasons" }, [el("thead", {}, el("tr", {}, ["Season", "Rounds", "SG per round", "Rank", ...PI.CATS.map((c) => PI.CATN[c]), B.hasOw ? "OWGR" : null].filter(Boolean).map((h, i) => el("th", { class: i ? "num" : null }, h)))), el("tbody", {}, segs)])) : null,
        samp(`Strokes gained per round on the ${tour || "tour"}, with the rank among that season's players with ${MINTXT} in each part of the game: which parts moved ${last}'s rank. The chart (higher is better): each season's rank so far after each event, ending on its year-end rank; faint behind it, the rank over the last ${ROLL} rounds (form, across seasons)${B.hasOw ? "; the OWGR dashed" : ""}.`)])]);
    }
    // (update 903) the plain-English report: how good, which way, where next season, and the green and red flags (with why)
    function verdictCard(r) {
      const sc = M.scout(r.k), last = lastName(r.nm);
      if (!sc) { const F0 = ensureFc(tour), f0 = F0.map.get(r.k), n0 = r.p?.rs?.length || 0; // (update 909) not ranked here: say so, and show the forecast with its caveat
        return card(`${r.nm}`, "#ffcc00", [el("p", { class: "sc-verdict" }, `${lastName(r.nm)} isn't ranked on the ${tour || "tour"} yet: ${n0} round${n0 === 1 ? "" : "s"} here on record, and a player needs ${MINTXT} in a season to be ranked.`),
          f0?.years?.length ? el("p", {}, [el("b", {}, "Forecast, with little data on this tour: "), f0.years.map((y) => `${y.year} ≈${ord(y.rank)} (${sg2(y.total)} per round)`).join(" · "), el("small", { class: "muted", style: "display:block;margin-top:4px" }, `With only ${f0.flags?.toursRounds ?? n0} rounds here in the last two seasons, this leans on his results on other tours (adjusted for how strong those fields are) and on the tour average. Treat it as a rough guess.`)]) : F0.busy ? el("p", { class: "muted" }, "Working out the forecast…") : null]); }
      const cur = sc.cur, G = sc.grades, of = cur.of, rk = cur.rank, so = cur.partial ? " this season so far" : ` in ${cur.y}`;
      const eqP = tour !== FT ? pgaEq(tour, rk, of) : null; // (update 911) his tour's rank, in PGA terms (from the players who crossed)
      const level0 = rk <= 10 ? "an elite, top-10 player" : rk <= 25 ? "a top-25 player" : rk <= 50 ? "a top-50 player" : rk <= of / 2 ? "an above-average tour player" : "a below-average tour player";
      const level = eqP ? `${level0} on the ${TS(tour)} (about ${ord(eqP)}-on-the-PGA level, by where players who moved up actually landed)` : level0;
      // (update 928) the trajectory: his own last 12 months against the 12 before
      const tj = trajOf(r.k), dir = !tj ? "steady" : tj.k.startsWith("up") ? "up" : tj.k.startsWith("down") ? "down" : "steady", may = tj && tj.k.endsWith("?") ? "probably " : "";
      const dirTxt = !tj ? `not playing enough lately to judge his trajectory (fewer than ${MINW} rounds in the last 12 months)` : tj.k === "new" ? `new here: ${sg2(tj.now)} strokes gained per round over the last 12 months, with too few rounds before that to compare`
        : dir === "up" ? `${may}on the rise: ${sg2(tj.now)} strokes gained per round over the last 12 months, up from ${sg2(tj.ago)} the 12 months before` : dir === "down" ? `${may}slipping: ${sg2(tj.now)} strokes gained per round over the last 12 months, down from ${sg2(tj.ago)} the 12 months before` : `holding steady: ${sg2(tj.now)} strokes gained per round over the last 12 months against ${sg2(tj.ago)} the 12 months before`;
      void ROLL; const dirTxtOld = dir === "up" ? `on the rise (his last ${ROLL} rounds rank ${ord(r.now.r)}, up from ${ord(r.ago.r)} a year ago)` : dir === "down" ? `slipping (his last ${ROLL} rounds rank ${ord(r.now.r)}, down from ${ord(r.ago.r)} a year ago)` : r.now && r.now.r > rk * 1.4 && r.now.r - rk >= 5 ? `level with a year ago, but cooling lately: his last ${ROLL} rounds rank ${ord(r.now.r)}, against ${ord(rk)} for the season` : r.now && r.now.r < rk * 0.7 && rk - r.now.r >= 5 ? `level with a year ago, but playing better lately: his last ${ROLL} rounds rank ${ord(r.now.r)}, against ${ord(rk)} for the season` : r.now ? `holding steady (his last ${ROLL} rounds rank ${ord(r.now.r)})` : "not playing enough lately to judge his form";
      const F = ensureFc(tour), fc = F.map.get(r.k), FU = ensureFull(tour, r.k, r.nm), y1 = fc?.years?.[0], t10 = FU.fc?.years?.[0]?.top10 ?? null, oneIn = (p) => (p >= 0.5 ? `better than even` : p > 0.01 ? `about 1 in ${Math.max(2, Math.round(1 / p))}` : "very unlikely");
      // the flags
      const crk = B.season[cur.y]?.by.get(r.k)?.cr || {}, q = (x) => (x ? x / of : 1), flags = [];
      if (r.streak >= 2) flags.push(["g", `Improved ${r.streak} seasons in a row`, `Year-end rank: ${B.years.map((y, i) => r.ranks[i] ? ord(r.ranks[i].rank) : null).filter(Boolean).join(" → ")}.`]);
      if (r.streak <= -2) flags.push(["r", `Got worse ${-r.streak} seasons in a row`, `Year-end rank: ${B.years.map((y, i) => r.ranks[i] ? ord(r.ranks[i].rank) : null).filter(Boolean).join(" → ")}.`]);
      if (r.now && r.now.r < rk * 0.7 && rk - r.now.r >= 5) flags.push(["g", "Playing better lately than his season rank", `Last ${ROLL} rounds: ${ord(r.now.r)}, against ${ord(rk)}${so}.`]);
      if (r.now && r.now.r > rk * 1.4 && r.now.r - rk >= 5) flags.push(["r", "Cooling off lately", `Last ${ROLL} rounds: ${ord(r.now.r)}, against ${ord(rk)}${so}.`]);
      if (r.age != null && r.age <= 26 && rk <= 60) flags.push(["g", `Young (${r.age}) and already top 60`, "Players usually keep improving into their late 20s."]);
      if (r.age != null && r.age >= 37) flags.push(["r", `Age ${r.age}`, "Most players' scoring declines in their late 30s."]);
      if (q(crk.APP) <= 0.2 || q(crk.OTT) <= 0.2) flags.push(["g", `Strong ball-striker (${q(crk.APP) <= q(crk.OTT) ? `approach ${ord(crk.APP)}` : `off the tee ${ord(crk.OTT)}`} on tour)`, "Driving and approach play hold up best from one season to the next."]);
      if (q(crk.PUTT) <= 0.25 && q(crk.APP) > 0.5 && q(crk.OTT) > 0.5) flags.push(["r", `Relies on putting (putting ${ord(crk.PUTT)}, approach ${ord(crk.APP)})`, "Putting swings the most from one season to the next, so this level is the hardest to keep."]);
      if (q(crk.APP) >= 0.8) flags.push(["r", `Weak approach play (${ord(crk.APP)} on tour)`, "Approach is the biggest part of scoring on tour."]);
      { const NM = { OTT: "driving", APP: "approach play", ARG: "the short game", PUTT: "putting" }, parts = PI.CATS.filter((c) => crk[c]).sort((a, b) => crk[a] - crk[b]);
        if (parts.length) { const b0 = parts[0], w0 = parts.at(-1);
          if (q(crk[b0]) <= 0.35 && !flags.some((f) => f[1].includes(ord(crk[b0])))) flags.push(["g", `Best at ${NM[b0]} (${ord(crk[b0])} on tour)`, `Strokes gained ${sg2(cur[b0])} per round${so}.`]);
          if (q(crk[w0]) >= 0.6 && !flags.some((f) => f[1].includes(ord(crk[w0])))) flags.push(["r", `Weakest at ${NM[w0]} (${ord(crk[w0])} on tour)`, `Strokes gained ${sg2(cur[w0])} per round${so}: the first place to look for improvement.`]); } }
      // (update 916) under pressure, from the scorecards
      { const o = clutchOf(r.nm), f = ensureClutch().fmt;
        if (o && f) { if (o.label) flags.push([o.label.k === "fader" ? "r" : "g", `${o.label.t}`, `${o.label.why}.`]);
          else if (o.contN >= 2) flags.push(["a", `In contention ${o.contN} time${o.contN === 1 ? "" : "s"}, ${o.contWins} win${o.contWins === 1 ? "" : "s"}`, `Final rounds then: ${f(o.contGain)} against the field, ${f(o.clutchRaw)} against his usual round (see the Clutch tab).`]); } }
      const comp8 = sc.comps.slice(0, 8), up8 = comp8.filter((c) => c.x.next.rank < c.x.rank).length;
      if (comp8.length >= 6 && up8 >= 6) flags.push(["g", `Similar players usually improved (${up8} of ${comp8.length})`, `Players at his level with a game like his mostly moved up the next season.`]);
      if (comp8.length >= 6 && up8 <= 2) flags.push(["r", `Similar players usually got worse (${comp8.length - up8} of ${comp8.length})`, `Players at his level with a game like his mostly dropped the next season.`]);
      if (cur.n < 30) flags.push(["a", `Only ${cur.n} rounds${so}`, "Small samples swing a lot: treat everything here with caution."]);
      const tile = (label, big0, sub, cls0 = "") => el("div", { class: `sc-tile ${cls0}` }, [el("span", { class: "sc-tl" }, label), el("b", {}, big0), sub ? el("small", {}, sub) : null]);
      const arrow = tj ? TRJ[tj.k][0] : "\u2014"; void dirTxtOld;
      return card(`${r.nm} · scouting report`, "#ffcc00", [
        el("p", { class: "sc-verdict" }, `${last} is ${level} on the ${tour || "tour"} (${ord(rk)} of ${of}${so}) and is ${dirTxt}.`),
        el("div", { class: "sc-tiles" }, [
          tile("Rank now", ord(rk), `of ${of}${so}${eqP ? ` on the ${TS(tour)} · ≈${ord(eqP)} on the PGA` : ""}`),
          tile("Trajectory", tj && tj.k !== "new" ? `${arrow} ${sg2(tj.change)}` : arrow, tj && tj.k !== "new" ? `${sg2(tj.ago)} \u2192 ${sg2(tj.now)} per round (12 months before \u2192 last 12 months)` : "", `dir-${dir}`),
          y1 ? tile(`${y1.year} on the PGA Tour (best guess)`, `≈${ord(y1.rank)}`, tour !== FT ? `likely ${ord(y1.rankHi)}–${ord(y1.rankLo)} · ${y1.cardLevel != null ? `${Math.round(y1.cardLevel * 100)}% chance of a PGA card-level season` : "if he plays there"}` : `likely ${ord(y1.rankHi)}–${ord(y1.rankLo)}`) : tile("Next season (best guess)", "…", F.busy ? "working it out" : "not enough data"),
          t10 != null ? tile("Chance of a PGA top-10 season", `${Math.round(t10 * 100)}%`, oneIn(t10)) : tile("Chance of a PGA top-10 season", "…", FU.busy ? "working it out" : "—")]),
        whyBox(r, tj, fc, rk),
        fc?.years?.length === 3 ? el("p", { class: "sc-next3" }, [el("b", {}, "Next three seasons on the PGA Tour: "), fc.years.map((y) => `${y.year} ≈${ord(y.rank)} (${sg2(y.total)} per round)`).join(" · "),
          el("small", {}, `Why: his rounds over recent seasons (newer ones count most), each adjusted for how strong the field was, pulled toward the tour average by how much data there is${fc.age != null ? ", plus the usual change at his age" : ""}. A great season is usually followed by a slightly less great one: that's built in, learned from this file.${fc.flags?.puttLed ? " This season was led by putting, which tends not to last." : ""}`)]) : null,
        flags.length ? el("div", { class: "sc-flags" }, [el("p", { class: "ip-kick" }, "What stands out"), el("ul", {}, flags.map(([k, t, why]) => el("li", { class: `sc-flag f-${k}` }, [el("span", { class: "sc-fi", "aria-hidden": "true" }, k === "g" ? "✓" : k === "r" ? "!" : "?"), el("span", {}, [el("b", {}, t), el("small", {}, why)])])))]) : null,
        comp8.length ? el("p", { class: "sc-likes" }, [el("b", {}, `Players at his level with a game like his: `), `past seasons ranked about where his is (${ord(sc.levelBand.lo)}–${ord(sc.levelBand.hi)} of a ${cur.of}-player season) with the same strengths and weaknesses${r.age != null ? " and a similar age" : ""}. Closest: `, comp8.slice(0, 3).map((c) => `${c.x.nm} (${c.x.y}: ${ord(c.x.rank)} of ${c.x.of}, then ${ord(c.x.next.rank)}${c.x.next.partial ? " so far" : ""})`).join(", "), `. Of the ${comp8.length} most similar, ${up8} improved the next season.`]) : null,
        el("p", { class: "muted small" }, `"Likely" range: the middle half of the outcomes the forecaster expects. Ranks are by strokes gained per round among the ${tour || "tour"}'s players with ${MINTXT}.`)]);
    }
    // (update 929) how much of a season's difference from a player's usual shows up again the next season, learned from every
    // tour in the file: each season (30+ rounds) with up to 3 seasons before it (40+ rounds) and a season after (30+ rounds);
    // the next season's difference from the same usual against this season's, split into ball-striking and short game
    let RET = null;
    function retention() { if (RET) return RET; const xs = [];
      for (const T of tours) { const B0 = build(T), ys = B0.years;
        for (const pl of B0.P) for (let i = 1; i < ys.length - 1; i++) { const cur = B0.season[ys[i]].by.get(pl.k), nx = B0.season[ys[i + 1]].by.get(pl.k); if (!cur || !nx || cur.n < 30 || nx.n < 30) continue;
          const prev = ys.slice(Math.max(0, i - 3), i).map((y) => B0.season[y].by.get(pl.k)).filter(Boolean), pn = prev.reduce((t, o) => t + o.n, 0); if (pn < 40) continue;
          const bse = prev.reduce((t, o) => t + o.sg * o.n, 0) / pn, bc = (c) => prev.reduce((t, o) => t + o.cat[c] * o.n, 0) / pn;
          xs.push({ x: cur.sg - bse, bs: cur.cat.OTT + cur.cat.APP - bc("OTT") - bc("APP"), sh: cur.cat.ARG + cur.cat.PUTT - bc("ARG") - bc("PUTT"), y: nx.sg - bse }); } }
      const S = (f) => xs.reduce((t, o) => t + f(o), 0), sxx = S((o) => o.x * o.x), keep = sxx ? Math.max(0, Math.min(1, S((o) => o.x * o.y) / sxx)) : 0;
      const a11 = S((o) => o.bs * o.bs), a12 = S((o) => o.bs * o.sh), a22 = S((o) => o.sh * o.sh), y1 = S((o) => o.bs * o.y), y2 = S((o) => o.sh * o.y), det = a11 * a22 - a12 * a12;
      let kb = null, ks = null; if (Math.abs(det) > 1e-9) { kb = (y1 * a22 - y2 * a12) / det; ks = (a11 * y2 - a12 * y1) / det; }
      const split = xs.length >= 60 && kb != null && kb >= 0 && ks >= 0 && kb <= 1.1 && ks <= 1.1;
      return (RET = { n: xs.length, keep, kb: split ? Math.min(1, kb) : null, ks: split ? Math.min(1, ks) : null, split }); }
    // (update 928) the numbers behind the trajectory, so anyone can check them: the two 12-month stretches side by side (the
    // same numbers the Stats page gives for those dates), whether the change is bigger than luck, which parts of the game it
    // came from, and how much of a change like it usually lasts (learned from this file by the forecaster)
    function whyBox(r, tj, fc, rkNow) {
      if (!tj) return null;
      const last = lastName(r.nm), NM = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
      if (tj.k === "new") return el("div", { class: "sc-why" }, [el("p", { class: "ip-kick" }, "The numbers"), el("p", {}, `${sg2(tj.now)} strokes gained per round over ${W1} (${tj.n1} rounds on the ${TS(tj.T)}). Only ${tj.n0} rounds in ${W0}, so there's no earlier stretch to compare with yet.`)]);
      const cell = (v, d = false) => el("td", { class: `num ${d ? `strong ${v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""}` : ""}` }, sg2(v));
      const rows = [el("tr", {}, [el("td", {}, "Rounds"), el("td", { class: "num" }, String(tj.n0)), el("td", { class: "num" }, String(tj.n1)), el("td", {}, "")]),
        el("tr", { class: "sc-why-tot" }, [el("td", {}, "Strokes gained per round"), cell(tj.ago), cell(tj.now), cell(tj.change, true)]),
        ...PI.CATS.map((c) => el("tr", {}, [el("td", {}, NM[c]), cell(tj.c0[c]), cell(tj.c1[c]), cell(tj.c1[c] - tj.c0[c], true)]))];
      const tbl = el("div", { class: "ip-tw" }, el("table", { class: "ip-t sc-why-t" }, [el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", { class: "num" }, ["12 months before", el("small", {}, W0)]), el("th", { class: "num" }, ["Last 12 months", el("small", {}, W1)]), el("th", { class: "num" }, "Change")])), el("tbody", {}, rows)]));
      // is it real?
      const real = Math.abs(tj.z) >= 1.96 ? "Yes, almost certainly." : Math.abs(tj.z) >= 1 ? "Probably." : "Not clearly: a change this size is within normal luck.";
      const b1 = [el("b", {}, "Is the change real? "), `${real} A change of ${sg2(tj.change)} per round over ${tj.n0} and ${tj.n1} rounds: luck alone would do that ${luckTxt(tj.z)}. (A tour player's score against the field swings about ±${tj.sdR.toFixed(1)} strokes from one round to the next, so an average of about ${Math.round((tj.n0 + tj.n1) / 2)} rounds can wobble about ±${tj.se.toFixed(2)} by chance.)`];
      // where from
      const dC = PI.CATS.map((c) => [c, tj.c1[c] - tj.c0[c]]).sort((a, b) => (tj.change >= 0 ? b[1] - a[1] : a[1] - b[1]));
      const bs = dC.filter(([c]) => c === "OTT" || c === "APP").reduce((t, [, v]) => t + v, 0), sh = dC.filter(([c]) => c === "ARG" || c === "PUTT").reduce((t, [, v]) => t + v, 0);
      const b2 = [el("b", {}, "Where it came from: "), dC.map(([c, v]) => `${NM[c].toLowerCase()} ${sg2(v)}`).join(", "), `. Ball-striking (tee and approach) ${sg2(bs)}, short game (around the green and putting) ${sg2(sh)}.`];
      // (update 929) will it last? Against his usual over several seasons, not just the year before: what a season this far
      // from a player's usual has actually turned into the next season, across this file
      const RT = retention(), b3 = [el("b", {}, "Will it last? ")], sub = [];
      const p0 = allRows().find((x) => x.k === r.k)?.p, from = END - 4 * YEAR, to = END - YEAR;
      const pre = p0 ? p0.rs.filter((x) => { const t = dOf(x); return t > from && t <= to; }) : [];
      const B0 = build(tj.T), seas = B0.years.map((y) => [y, B0.season[y].by.get(r.k)]).filter(([, o]) => o);
      if (pre.length >= 40) {
        const base = avg(pre, tot), bC = (c) => avg(pre, (x) => inCat(x, c)), gap = tj.now - base;
        const gbs = tj.c1.OTT + tj.c1.APP - bC("OTT") - bC("APP"), gsh = tj.c1.ARG + tj.c1.PUTT - bC("ARG") - bC("PUTT");
        b3.push(`His usual: ${sg2(base)} strokes gained per round over the 3 years before (${winTxt(from, to)}, ${pre.length} rounds). The last 12 months (${sg2(tj.now)}) are ${sg2(gap)} ${gap >= 0 ? "above" : "below"} his usual.`);
        if (seas.length) sub.push(`Season by season: ${seas.map(([y, o]) => `${y}${y === B0.lastY ? " so far" : ""} ${sg2(o.sg)}`).join(" · ")}.`);
        const full = seas.filter(([y]) => y !== B0.lastY), best = full.length ? full.reduce((m, x) => (x[1].sg > m[1].sg ? x : m)) : null;
        if (best && tj.now > best[1].sg + 0.15) sub.push(`A career high: better than any full season on record (his best was ${sg2(best[1].sg)} in ${best[0]}). Career-best stretches usually come back toward a player's usual.`);
        else if (best && full.length >= 2 && tj.now < Math.min(...full.map((x) => x[1].sg)) - 0.15) sub.push(`A career low: worse than any full season on record. Career-worst stretches usually bounce back toward a player's usual.`);
        if (RT && RT.n >= 30) {
          const kept = RT.split ? RT.kb * gbs + RT.ks * gsh : RT.keep * gap, guess = base + kept, pc = (v) => `${Math.round(Math.max(0, v) * 100)}%`;
          sub.push(`What happened to others: across ${RT.n.toLocaleString()} player-seasons in this file, when a season was above or below the player's usual (his previous up to 3 seasons), the next season kept on average ${RT.split ? `${pc(RT.kb)} of a ball-striking (tee and approach) difference and ${pc(RT.ks)} of a short-game (around the green and putting) difference` : `${pc(RT.keep)} of the difference`}; the rest went back toward his usual.`);
          sub.push(`Applied to ${last} (ball-striking ${sg2(gbs)}, short game ${sg2(gsh)} against his usual): about ${sg2(kept)} of the ${sg2(gap)} is likely to stay, so a fair guess for next season is about ${sg2(guess)} per round, ${Math.abs(kept) < Math.abs(gap) ? "between his usual and his last 12 months" : "about where he is now"}.`);
        } else sub.push("Too few seasons in the file yet to say how much of a change like this usually lasts.");
        if (fc?.years?.[0]) sub.push(`The full forecast (the Outlook tab) also weighs how strong his fields were and his age: ${sg2(fc.years[0].total)} per round in ${fc.years[0].year} (≈${ord(fc.years[0].rank)} on the PGA)${rkNow ? `; ${ord(rkNow)} on the ${TS(tj.T)} this season` : ""}.`);
      } else b3.push(`Not enough earlier rounds to compare with his usual (${pre.length} in ${winTxt(from, to)}; at least 40 needed). Treat a jump on this little history with caution.`);
      if (sub.length) b3.push(el("ul", { class: "sc-why-sub" }, sub.map((t) => el("li", {}, t))));
      return el("div", { class: "sc-why" }, [el("p", { class: "ip-kick" }, `Why "${TRJ[tj.k][0].replace(/^\S+\s/, "")}": the numbers (check them on Player Stats with these dates)`), tbl,
        el("ul", { class: "ip-bul sc-why-l" }, [el("li", {}, b1), el("li", {}, b2), el("li", {}, b3)]),
        el("p", { class: "muted small" }, `Strokes gained per round against the field in each event, on the ${TS(tj.T)}, every round in each stretch.`)]);
    }
    // (update 890) the scouting report: grades, the projection and tier odds, comps, and the paths successful players took
    function reportCard(r) {
      const sc = M.scout(r.k); if (!sc) return card(`${r.nm} · scouting report`, "#ffcc00", el("p", { class: "muted" }, `Not ranked in a season yet (needs enough rounds in one: ${MINTXT}): no report.`));
      const G = sc.grades, cur = sc.cur, gBox = (label, g, sub) => el("div", { class: "sc-gbox" }, [el("span", { class: "sc-gl" }, label), gEl(g), sub ? el("small", { class: "muted" }, sub) : null]);
      const FY = ensureFull(tour, r.k, r.nm).fc?.years?.[0], odds = FY ? [[10, FY.top10], [50, FY.top50], [100, FY.top100]].filter(([t, p]) => p != null && t < (FY.of || 999)).map(([t, p]) => el("div", { class: "sc-odd" }, [el("span", { class: "sc-ol" }, `Top ${t}`), el("div", { class: "sc-ob" }, el("i", { style: `width:${Math.max(1, Math.round(p * 100))}%` })), el("b", {}, pc(p))])) : []; // (update 905: the forecaster's)
      const nx = (x) => (x.next ? `${ord(x.next.rank)}${x.next.partial ? " so far" : ""} (${sg2(x.next.sg)})` : "—");
      const so = cur.partial ? " so far" : "", crk = B.season[cur.y]?.by.get(r.k)?.cr || {};
      return card(`${r.nm} · scouting report`, "#ffcc00", [
        el("p", { class: "sc-rankline" }, [el("b", {}, `${ord(cur.rank)} of ${cur.of}`), ` on the ${tour || "tour"} in ${cur.y}${so} (${sg2(cur.sg)} strokes gained per round, ${cur.n} rounds)`, r.now ? ` · ${ord(r.now.r)} of ${r.now.n} over the last ${ROLL} rounds (${sg2(r.now.v)})` : ""]),
        el("div", { class: "sc-grades sc-g3" }, [gBox("Now", G.now, `${ord(cur.rank)}${so}`), ...(FY ? [gBox(`${FY.year}`, M.rateSg(FY.total), `${sg2(FY.total)} · ≈${ord(FY.rank)}`), gBox("A good season", M.rateSg(FY.hi), `${sg2(FY.hi)} · ≈${ord(FY.rankHi)}`)] : [])]),
        el("div", { class: "sc-grades sc-g4" }, PI.CATS.map((c) => gBox(PH() ? { OTT: "Tee", APP: "Approach", ARG: "Short game", PUTT: "Putting" }[c] : PI.CATN[c], G.tools[c], `${sg2(cur[c])}${crk[c] ? ` · ${ord(crk[c])}` : ""}`))),
        el("p", { class: "muted small" }, `Ratings (0-100) come straight from rank, against the ${G.refY} season's ${G.refN} ranked players: the share of them the number beats (50 the middle player, 90 the top 10%, 99 the best). ≈ the rank that number would have had in ${G.refY}. The season boxes: the forecaster's best guess for next season, and a good season (the top of its likely range).`),
        odds.some(Boolean) ? el("div", { class: "sc-odds" }, [el("p", { class: "ip-kick" }, "Odds of next season's year-end rank"), ...odds]) : null,
        sc.comps.length ? el("div", {}, [el("p", { class: "ip-kick" }, `Comps · the past seasons most like ${r.nm.split(" ").at(-1)}'s ${cur.y}${cur.partial ? " (so far)" : ""}`), el("p", { class: "muted small" }, `Past seasons ranked about where his is (${ord(sc.levelBand.lo)}–${ord(sc.levelBand.hi)}, the same share of the way down that season's leaderboard), the closest in shape: strong and weak in the same parts of the game, then age, seasons on tour and the change from the season before. Then what each did the season after.`),
          PH() ? el("div", { class: "sc-pcs" }, sc.comps.slice(0, 8).map((c) => el("div", { class: "sc-comp" }, [el("div", { class: "sc-pc-top" }, [el("strong", {}, c.x.nm), el("span", { class: "muted small" }, `${c.x.y}${c.x.age != null ? ` · age ${Math.floor(c.x.age)}` : ""} · similarity `), el("b", {}, String(c.sim))]),
            el("div", { class: "sc-pc-yrs" }, [el("span", {}, ["That season ", el("b", {}, ord(c.x.rank)), el("small", { class: "muted" }, ` ${sg2(c.x.sg)}`)]), el("span", {}, " → "), el("span", { class: c.x.next.rank < c.x.rank ? "pos" : c.x.next.rank > c.x.rank ? "neg" : "" }, ["Next ", el("b", {}, nx(c.x))])])]))) :
          el("div", { class: "ip-tw" }, el("table", { class: "ip-t sc-comps" }, [el("thead", {}, el("tr", {}, ["Player", "Season", "Similarity", "That season", "Next season"].map((h, i) => el("th", { class: i > 1 ? "num" : null }, h)))),
            el("tbody", {}, sc.comps.slice(0, 8).map((c) => el("tr", {}, [el("td", { class: "sc-nm" }, c.x.nm), el("td", {}, `${c.x.y}${c.x.age != null ? ` (age ${Math.floor(c.x.age)})` : ""}`), el("td", { class: "num strong" }, String(c.sim)),
              el("td", { class: "num" }, `${ord(c.x.rank)} (${sg2(c.x.sg)})`), el("td", { class: `num strong ${c.x.next.rank < c.x.rank ? "pos" : c.x.next.rank > c.x.rank ? "neg" : ""}` }, nx(c.x))])))]))]) : null,
        sc.pre.length ? el("div", {}, [el("p", { class: "ip-kick" }, "Before the breakout · the most similar seasons that came a year before a top-10 season"),
          el("ul", { class: "ip-bul" }, sc.pre.map((c) => el("li", {}, `${c.x.nm} in ${c.x.y} (similarity ${c.sim}): ${ord(c.x.rank)} that season, then ${nx(c.x)}`)))]) : null,
        samp(`Comps from ${M.pool.length} past player-seasons with a season after them; the odds blend the comps' next seasons (${Math.round(sc.wC * 100)}% here, ${sc.effN.toFixed(0)} effective comps) with the projection. See "How it works".`)]); }
    // (update 927) the biggest improvers: the most-risen levels (the forecaster's estimate now against a year ago), every tour
    function drawRisers() {
      const F0 = ensureFc();
      const list = allRows().map((r) => ({ r, t: trajOf(r.k), T: r.T })).filter((x) => x.t && x.t.k !== "new" && x.t.change > 0).sort((a, b) => b.t.change - a.t.change).slice(0, 30);
      const real = (t) => (t.k === "up" ? el("b", { class: "pos" }, "Clear") : t.k === "up?" ? "Likely" : el("span", { class: "muted" }, "Could be luck"));
      const nextOf = (k) => { const f = F0.map.get(k); return f?.years?.[0] ? `≈${ord(f.years[0].rank)}` : "—"; };
      const rk = (t) => `${t.n0} → ${t.n1}`; // (update 928: rounds in each stretch)
      const how = samp(`Strokes gained per round on his tour over the last 12 months (${W1}) against the 12 months before (${W0}), players with ${MINW}+ rounds in each, biggest rise first. Real?: "Clear" when luck alone would cause a rise this big less than about 1 time in 40, "Likely" less than about 1 time in 6. Open a player for which parts of the game it came from and how much of it usually lasts.`);
      if (PH()) { mount(boardBox, card("Biggest improvers · all tours", "#30d158", [el("div", { class: "sc-pcs" }, list.map((x) => {
          const b = el("button", { type: "button", class: `sc-pc${x.r.k === sel ? " on" : ""}` }, [el("div", { class: "sc-pc-top" }, [el("strong", {}, x.r.nm), el("b", { class: "pos" }, `${sg2(x.t.change)} per round`)]),
            el("div", { class: "sc-pc-yrs" }, [el("span", {}, [`${sg2(x.t.ago)} → `, el("b", {}, sg2(x.t.now))]), el("span", {}, ["Rounds ", el("b", {}, rk(x.t))])]),
            el("div", { class: "sc-pc-chips" }, [real(x.t), el("span", {}, ["Next season ", el("b", {}, nextOf(x.r.k))])])]);
          b.addEventListener("click", () => pickKey(x.r.k)); return b; })), how])); return; }
      mount(boardBox, card("Biggest improvers · all tours", "#30d158", [el("div", { class: "ip-tw sc-tw" }, el("table", { class: "ip-t sc-t" }, [el("thead", {}, el("tr", {}, ["Player", "Age", "12 months before", "Last 12 months", "Change", "Rounds", "Real?", "Next season (PGA)"].map((h, i) => el("th", { class: i ? "num" : null }, h)))),
        el("tbody", {}, list.map((x) => { const tr = el("tr", { class: `sc-row${x.r.k === sel ? " on" : ""}`, tabindex: "0", title: trajTip(x.t) }, [el("td", { class: "sc-nm" }, x.r.nm), el("td", { class: "num" }, x.r.age ?? "—"), el("td", { class: "num" }, sg2(x.t.ago)), el("td", { class: "num strong" }, sg2(x.t.now)),
          el("td", { class: "num pos strong" }, sg2(x.t.change)), el("td", { class: "num" }, rk(x.t)), el("td", { class: "num" }, real(x.t)), el("td", { class: "num" }, nextOf(x.r.k))]);
          const pick = () => pickKey(x.r.k); tr.addEventListener("click", pick); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); }); return tr; }))])), how]));
    }
    function drawHow() {
      const f = M.fit;
      const others = tours.filter((T) => T !== FT), FC0 = ensureFc();
      const bridgeCard = card("How the tours compare (from players who crossed)", "#64d2ff", [el("p", {}, `For each tour: every player who played mostly on it one season and was ranked on the PGA Tour the next, and anyone with 30+ rounds on both in the same season. Where they landed on the PGA gives the PGA equivalent of a place on that tour. "The forecaster says" is the PGA place the forecaster predicts next season for players at that place now, a check that the two agree.`),
        ...others.map((T) => { const br = bridge(T); if (!br) return null; const nM = br.pairs.length;
          if (br.fit === "none") return el("p", { class: "muted" }, `${TS(T)}: only ${nM} player-season${nM === 1 ? "" : "s"} crossed to the PGA in the file so far: too few to say yet.`);
          const cur = build(T), cy = cur.lastY, nowList = [...(cur.season[cy]?.by || new Map())].map(([k, o]) => ({ k, rank: o.rank }));
          const fcAt = (r0) => { const xs = nowList.filter((x) => Math.abs(x.rank - r0) <= Math.max(2, Math.round(r0 * 0.25))).map((x) => FC0.map.get(x.k)?.years?.[0]?.rank).filter(Boolean).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };
          const rows = [1, 5, 10, 25, 50, 100].filter((x) => x <= (br.nT || 999)).map((x) => el("tr", {}, [el("td", {}, `${ord(x)} on the ${TS(T)}`), el("td", { class: "num strong" }, `≈${ord(br.eq(x))}`), el("td", { class: "num" }, (() => { const v = fcAt(x); return v ? `≈${ord(v)}` : FC0.busy ? "…" : "—"; })())]));
          const ex = [...br.pairs].sort((a, b) => a.rT - b.rT).slice(0, 8);
          return el("div", { class: "sc-bridge" }, [el("p", { class: "ip-kick" }, `${TS(T)} → PGA · ${nM} crossings${br.fit === "shift" ? " (few: a single shift, not a full fit)" : ""}`),
            el("div", { class: "ip-tw" }, el("table", { class: "ip-t" }, [el("thead", {}, el("tr", {}, ["Place on his tour", "PGA equivalent (where movers landed)", "The forecaster says (next season)"].map((h0, i) => el("th", { class: i ? "num" : null }, h0)))), el("tbody", {}, rows)])),
            el("p", { class: "muted small" }, ["Examples: ", ex.map((q) => `${q.nm} ${ord(q.rT)} ${TS(T)} ${q.y} → ${ord(q.rP)} PGA ${q.yP}${q.kind === "same" ? " (same season)" : ""}`).join(" · ")])]); }),
        samp("Limits: the players who cross are mostly the best of the other tours (cards go to the top of the Korn Ferry and DP World), so the top of each tour is measured best; and a player who struggles on the PGA plays fewer events and may not get a ranked season, which can flatter the mapping a little.")]);
      void bridgeCard;
      mount(boardBox, [card("How it works", "#8e8e93", [el("ol", { class: "ip-bul" }, [
        el("li", {}, [el("b", {}, "Comps (from baseball's PECOTA and FiveThirtyEight's NBA CARMELO). "), `Every player-season in the file is a profile: strokes gained per round and in each part of the game, the change from the season before, age (when the file has birth dates), seasons on the tour and rounds played. Each is put on the same scale (standard deviations across every player-season) and weighted (strokes gained per round counts most). A player's latest season is matched with the nearest past player-seasons that have a season after them. Similarity: 100 identical, 0 as different as a typical pair of players.`]),
        el("li", {}, [el("b", {}, "Predictions (next season, three seasons out, the odds). "), "The site's one forecaster, the same as the Outlook tab, built the way baseball's projection systems (Marcel, Steamer) and Data Golf are: each player's rounds over recent seasons, newer ones weighted more (how much more is learned from this file); every round adjusted for how strong its field was (which also puts the tours on one scale); pulled toward the tour average by how many rounds there are; an age curve learned from how players' seasons changed with age; ranges set so that 8 in 10 past seasons it hadn't seen landed inside; and checked by forecasting each past season from only the seasons before it. The odds of a top-10 / 50 / 100 season come from playing the next season out thousands of times for the whole field."]),
        el("li", {}, [el("b", {}, "Ratings, 0-100. "), "The percentile: the share of the latest full season's ranked players the number beats, so 50 is the middle player, 90 the top 10% and 99 the best. Now: this season. Next season and Ceiling: the projection and a good outcome (its 80th percentile). One for each part of the game the same way. (Baseball scouts use a 20-80 scale; a percentile says the same thing in plain numbers.)"]),
        el("li", {}, [el("b", {}, "Trajectory and the biggest improvers. "), `His strokes gained per round over the last 12 months (${W1}) against the 12 months before (${W0}), on his own tour, every round in each stretch: the same numbers Player Stats gives for those dates. Rising or Slipping only when the change is bigger than luck: a tour player's score against the field swings a couple of strokes from one round to the next, so two averages of about 60 rounds can differ by around half a stroke by chance alone; the change has to clear about twice that wobble (about 95% sure) to be called, once (about 84%) for "Probably". A player's report then shows which parts of the game the change came from, and whether it's likely to last: his last 12 months against his usual over the 3 years before, whether it's a career high or low, and how much of a season's difference from a player's usual actually showed up again the next season across every player-season in this file (ball-striking and short game separately).`]),
        el("li", {}, [el("b", {}, "Before the breakout. "), "The past seasons most like a player's latest that came the year before a top-10 season (from outside the top 10): the paths successful players took."]),
        el("li", {}, [el("b", {}, "Limits. "), `The file covers ${B.years[0]}-${B.years.at(-1)}: comps and odds learn from those seasons only (${M.pool.length} player-seasons with a season after them), so they get sharper as seasons are added. The current season counts as it stands so far.`])])]), bridgeCard]);
    }
    // (update 927) Future Outlook and its report, for up to four players
    function drawOutlook() { outlookTab(boardBox, { players: allRows().map((r) => ({ k: r.k, nm: r.nm })), fieldP: fieldForFc, tour: FT, sel, redraw: () => { if (wrap.isConnected) draw(); }, ownRounds: (k) => field.find((p) => p.key === k)?.rounds || null }); }
    // (update 916) the clutch board: final rounds in contention against a player's usual round, 54-hole leads, wins from behind
    let clSort = "clutch";
    function drawClutch() {
      const C0 = ensureClutch(), f = C0.fmt || ((v) => String(v));
      if (C0.busy) { mount(boardBox, card("Clutch", "#ff9f0a", el("p", { class: "muted ta-loading" }, "Reading every tournament's scorecards…"))); return; }
      if (C0.err || !C0.list.length) { const D = C0.diag || { results: 0, withCards: 0, missing: 0, notes: [] }; // (update 917) say exactly what's there and what to do
        mount(boardBox, card("Clutch", "#ff9f0a", [el("p", {}, "This needs every tournament's hole-by-hole scorecards, which the live-feed function saves (added in update 915). So far:"),
          el("ul", { class: "ip-bul" }, [el("li", {}, `Tournaments with official results saved: ${D.results}`), el("li", {}, `With scorecards saved: ${D.withCards}`), el("li", {}, `Couldn't be read: ${D.notes.length}`)]),
          D.results === 0 ? el("p", {}, "No official results are saved at all, so the live-feed function isn't saving anything for the portal yet. Check it's deployed and that its Cloud Scheduler job is enabled.")
          : D.notes.length ? el("div", {}, [el("p", {}, "The scorecard API answered, but in a layout the reader doesn't recognise yet. Copy the text below and send it to me, and I'll fix the reader:"), el("pre", { class: "sc-note" }, JSON.stringify(D.notes[0].note, null, 1).slice(0, 3000))])
          : el("div", {}, [el("p", {}, "No scorecards have been saved yet. Two things to check:"), el("ol", { class: "ip-bul" }, [
              el("li", {}, ["Redeploy the live-feed function with update 915's ", el("b", {}, "pga.py"), " and ", el("b", {}, "build_data.py"), " (the files in backend/functions/live-feed). Until it's redeployed it keeps saving leaderboards only."]),
              el("li", {}, "Then wait for it to run. Its Cloud Scheduler job runs every 30 minutes, Thursday to Monday; each run saves about 30 tournaments' scorecards, so two seasons fill in within about two hours of runs. To fill them now, open Cloud Scheduler and press Force run on the live-feed job a few times (a minute apart).")]),
              el("p", { class: "muted small" }, "If this still says 0 after that, open the function's logs: a line starting \"cards\" shows what went wrong.")])]));
        return; }
      const list = C0.list.filter((o) => o.contN >= 1 || o.leads >= 1);
      const val = (o) => (clSort === "clutch" ? -(o.clutch ?? -9) : clSort === "cont" ? -o.contN : clSort === "lead" ? -(o.leads ? o.leadWins / o.leads + o.leads / 100 : -1) : clSort === "behind" ? -o.winsBehind : clSort === "blown" ? -o.blown.length : clSort === "wins" ? -o.wins : o.name);
      list.sort((a, b) => { const x = val(a), y = val(b); return typeof x === "string" ? x.localeCompare(y) : x - y; });
      const key0 = (o) => allRows().find((r) => PI.nameKey(r.nm) === PI.nameKey(o.name))?.k, pick = (o) => { const k = key0(o); if (k) pickKey(k); };
      const lab = (o) => (o.label ? el("span", { class: `sc-cl sc-cl-${o.label.k}`, title: o.label.why }, o.label.t) : el("span", { class: "muted" }, "—"));
      const SORTS = [["clutch", "Clutch (rises to it first)"], ["cont", "Most times in contention"], ["wins", "Most wins"], ["lead", "Best with the 54-hole lead"], ["behind", "Most wins from behind"], ["blown", "Most leads let slip"], ["nm", "Name"]];
      const sortSel = el("select", { class: "ip-sel sc-sortsel", "aria-label": "Sort by" }, SORTS.map(([k, l]) => el("option", { value: k, ...(k === clSort ? { selected: true } : {}) }, `Sort: ${l}`))); sortSel.addEventListener("change", () => { clSort = sortSel.value; drawClutch(); });
      const note = samp(`From ${C0.events} tournaments' scorecards (PGA Tour and Korn Ferry, the last three seasons). In contention: within 3 shots of the lead going into the final round. Clutch: his final rounds in contention against his usual round (both as strokes better than that day's field), pulled toward 0 when there are only a few (three average rounds added), so one hot Sunday doesn't make a closer. Back nine: holes 10-18 of those final rounds against the field. 54-hole leads include shared ones. Let slip: 2+ clear at some point in a final round he didn't win. Small numbers: golf gives each player only a handful of these a year, so read the labels as tendencies, not verdicts.`);
      if (PH()) { mount(boardBox, card("Clutch · who delivers when it counts", "#ff9f0a", [sortSel, el("div", { class: "sc-pcs" }, list.slice(0, shown).map((o) => { const b = el("button", { type: "button", class: "sc-pc" }, [
          el("div", { class: "sc-pc-top" }, [el("strong", {}, o.name), lab(o)]),
          el("div", { class: "sc-pc-yrs" }, [el("span", {}, ["Clutch ", el("b", { class: (o.clutch ?? 0) >= 0 ? "pos" : "neg" }, f(o.clutch))]), el("span", {}, ["In contention ", el("b", {}, `${o.contN}×`)]), el("span", {}, ["Wins ", el("b", {}, String(o.wins))])]),
          el("div", { class: "sc-pc-chips" }, [el("span", {}, `54-hole leads ${o.leadWins}/${o.leads}`), el("span", {}, `From behind ${o.winsBehind}`), o.blown.length ? el("span", { class: "neg" }, `Let slip ${o.blown.length}`) : null])]); b.addEventListener("click", () => pick(o)); return b; })), note])); return; }
      const rows = list.slice(0, 300).map((o) => { const tr = el("tr", { class: "sc-row", tabindex: "0" }, [el("td", { class: "sc-nm" }, o.name), el("td", {}, lab(o)),
        el("td", { class: `num strong ${(o.clutch ?? 0) >= 0.005 ? "pos" : (o.clutch ?? 0) <= -0.005 ? "neg" : ""}`, title: o.clutchRaw != null ? `Unadjusted: ${f(o.clutchRaw)} (usual round ${f(o.usual)}, final rounds in contention ${f(o.contGain)})` : "" }, f(o.clutch)),
        el("td", { class: "num" }, String(o.contN)), el("td", { class: "num" }, o.contGain != null ? f(o.contGain) : "—"), el("td", { class: "num" }, o.b9Gain != null ? f(o.b9Gain) : "—"),
        el("td", { class: "num" }, String(o.wins)), el("td", { class: "num" }, o.leads ? `${o.leadWins} of ${o.leads}` : "—"), el("td", { class: "num" }, o.winsBehind ? `${o.winsBehind} (up to ${o.maxBackWon} back)` : "—"),
        el("td", { class: `num ${o.blown.length ? "neg" : ""}`, title: o.blown.map((b) => `${b.ev} ${b.year}: ${b.margin} clear after No. ${b.hole}, finished ${b.pos}`).join("\n") }, o.blown.length ? String(o.blown.length) : "—")]);
        tr.addEventListener("click", () => pick(o)); return tr; });
      mount(boardBox, card("Clutch · who delivers when it counts", "#ff9f0a", [sortSel, el("div", { class: "ip-tw sc-tw" }, el("table", { class: "ip-t sc-t" }, [el("thead", {}, el("tr", {}, ["Player", "Type", "Clutch", "In contention", "Final round vs field", "Back nine vs field", "Wins", "54-hole leads won", "Wins from behind", "Leads let slip"].map((h0, i) => el("th", { class: i > 1 ? "num" : null }, h0)))), el("tbody", {}, rows)])), note]));
    }
    // (update 905) the predicted leaderboards: every player's predicted finish at the end of each of the next three seasons
    let predH = 0;
    function drawPred() {
      const F = ensureFc(tour);
      if (F.busy) { mount(boardBox, card("Predicted leaderboards", "#64d2ff", el("p", { class: "muted ta-loading" }, "Working out every player's next three seasons… (up to a minute on a big file; the page stays usable)"))); return; }
      if (F.err || !F.map.size) { mount(boardBox, card("Predicted leaderboards", "#64d2ff", el("p", { class: "muted" }, "Couldn't work out the predictions just now."))); return; }
      const fcs = [...F.map.values()].filter((f) => f.years?.length === 3), yrs = fcs[0].years.map((y) => y.year);
      const pos = [0, 1, 2].map((h) => new Map([...fcs].sort((a, b) => b.years[h].total - a.years[h].total).map((f, i) => [f.key, i + 1])));
      const list = [...fcs].sort((a, b) => pos[predH].get(a.key) - pos[predH].get(b.key)), qq = q.trim().toLowerCase(), shownL = list; void qq;
      const pills = el("div", { class: "ip-pills" }, yrs.map((y, h) => { const b = el("button", { type: "button", class: `ip-pill${h === predH ? " on" : ""}` }, `End of ${y}`); b.addEventListener("click", () => { predH = h; drawPred(); }); return b; }));
      // (update 910) every tour: his tour now, his rank there, and the chance of a PGA Tour card-level season (top 125)
      const tOf = (f) => mainTour.get(f.key) || null, rowOf = (f) => null, nowR = (f) => { const T = tOf(f); return T ? modelOf(T).scout(f.key)?.cur.rank ?? null : null; }, nowTxt = (f) => (nowR(f) ? `${ord(nowR(f))} ${TS(tOf(f))}` : tOf(f) ? TS(tOf(f)) : "—");
      const card0 = (f) => f.years[predH]?.cardLevel, thin = (f) => thinN(f.key) < 30;
      const cellY = (f, h) => [el("b", {}, ord(f.years[h].rank)), el("small", { class: "muted" }, ` ${sg2(f.years[h].total)}`)]; // (update 906: the forecaster's own place, as everywhere)
      const pick = (f) => pickKey(f.key);
      const note = samp(`Every player on every tour, ordered by his predicted season on the PGA Tour's scale, and where that puts him on the PGA Tour's leaderboard (1st = the best predicted season), wherever he plays now. PGA card-level: the chance his season is as good as the PGA Tour's 125th-best (the level that keeps a card), a guide to whether a Korn Ferry or DP World player is ready to make it. Built by the same forecaster as the Outlook tab: recent seasons weighted most, every round adjusted for how strong its field was, pulled toward the tour average by how much data there is, and an age curve, all learned from this file and checked on seasons it hadn't seen. Each season further out is less certain. * Fewer than 30 rounds on record in the last two seasons: leans heavily on the tour average, so treat with caution.`);
      if (PH()) { mount(boardBox, card("Predicted leaderboards", "#64d2ff", [pills, el("div", { class: "sc-pcs" }, shownL.slice(0, shown).map((f) => { const b = el("button", { type: "button", class: `sc-pc${f.key === sel ? " on" : ""}` }, [
          el("div", { class: "sc-pc-top" }, [el("strong", {}, `${pos[predH].get(f.key)}. ${f.name}${thin(f) ? " *" : ""}`), f.age != null ? el("span", { class: "muted small" }, ` ${Math.floor(f.age)}`) : null, el("span", { class: "muted small" }, `now ${nowTxt(f)}`)]), card0(f) != null ? el("div", { class: "sc-pc-chips" }, [el("span", {}, ["PGA card-level ", el("b", {}, pc(card0(f)))])]) : null,
          el("div", { class: "sc-pc-yrs" }, yrs.map((y, h) => el("span", {}, [`${y} `, ...cellY(f, h)])))]); b.addEventListener("click", () => pick(f)); return b; })),
          shownL.length > shown ? (() => { const m0 = el("button", { type: "button", class: "btn ghost sc-more" }, `Show more (${shownL.length - shown} left)`); m0.addEventListener("click", () => { shown += 40; drawPred(); }); return m0; })() : null, note])); return; }
      mount(boardBox, card("Predicted PGA Tour leaderboards · every tour", "#64d2ff", [pills,
        el("div", { class: "ip-tw sc-tw" }, el("table", { class: "ip-t sc-t" }, [el("thead", {}, el("tr", {}, ["#", "Player", "Age", "Now (his tour)", `PGA card-level (${yrs[predH]})`, ...yrs.map((y, h) => `PGA end of ${y}${h === predH ? " ▲" : ""}`)].map((h0, i) => el("th", { class: i === 1 ? "" : "num" }, h0)))),
          el("tbody", {}, shownL.slice(0, 300).map((f) => { const tr = el("tr", { class: `sc-row${f.key === sel ? " on" : ""}`, tabindex: "0" }, [el("td", { class: "num strong" }, String(pos[predH].get(f.key))), el("td", { class: "sc-nm" }, [f.name, thin(f) ? el("span", { class: "sc-thin", title: `Only ${thinN(f.key)} rounds on record in the last two seasons: this projection leans heavily on the tour average` }, " *") : null]), el("td", { class: "num" }, f.age != null ? String(Math.floor(f.age)) : "—"),
            el("td", { class: "num" }, nowTxt(f)), el("td", { class: "num" }, card0(f) != null ? pc(card0(f)) : "—"), ...[0, 1, 2].map((h) => el("td", { class: `num${h === predH ? " sc-predon" : ""}` }, cellY(f, h)))]); tr.addEventListener("click", () => pick(f)); void rowOf; return tr; }))])), note]));
    }
    drawDetail(); if (part === "risers") drawRisers(); else if (part === "how") drawHow(); else if (part === "pred") drawPred(); else if (part === "clutch") drawClutch(); else if (part === "outlook") drawOutlook(); else drawBoard();
  }
  draw();
}

/** the career chart: rank over time (1 at the top), the rolling rank as a line, each season's year-end rank a dot, the OWGR a second line */
function careerChart(pts, yrPts, hasOw, boxW = 640) {
  // (update 901) the main line: the season-to-date rank (each season its own line, ending on its year-end rank, so the labels
  // and the line agree); behind it, faint, the rolling 24-round rank (form across seasons); the OWGR when the file has it
  const std = pts.filter((x) => x.sr), roll = pts.filter((x) => x.rr), ow = hasOw ? pts.filter((x) => x.ow != null) : [];
  if (std.length + roll.length + yrPts.length < 2) return el("p", { class: "muted small" }, "Not enough rounds yet for a chart.");
  const W = Math.max(320, Math.min(1100, Math.round(boxW) - 40)), H = W < 500 ? 240 : 300, L = 36, R = 34, T = 18, Bm = 26; // (drawn at the width it shows: text the same size everywhere)
  const ts = [...std.map((x) => x.t), ...roll.map((x) => x.t), ...yrPts.map((x) => x.t), ...ow.map((x) => x.t)], t0 = Math.min(...ts) - 10 * 864e5, t1 = Math.max(...ts) + 10 * 864e5;
  const worst = Math.max(10, ...std.map((x) => x.sr.r), ...roll.map((x) => x.rr.r), ...yrPts.map((x) => x.o.rank), ...ow.map((x) => x.ow));
  const TICKS = [1, 5, 10, 25, 50, 100, 150, 200, 300, 400, 500, 700, 1000], mx = TICKS.find((v) => v >= worst) || worst, ticks = TICKS.filter((v) => v <= mx); // (the scale ends on a labelled line below the lowest rank)
  // a square-root scale: the top of the ranks gets more room (1st to 10th matters more than 150th to 160th)
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (r) => T + (Math.sqrt(Math.max(1, r)) - 1) / (Math.sqrt(mx) - 1) * (H - T - Bm);
  const g = [];
  for (const v of ticks) g.push(sv("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: "sc-grid" }), sv("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", class: "sc-ax" }, String(v)));
  const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
  for (let y = y0; y <= y1; y++) { const t = Date.parse(`${y}-01-01T12:00:00`); if (t < t0 || t > t1) continue; g.push(sv("line", { x1: X(t), x2: X(t), y1: T, y2: H - Bm, class: "sc-grid" })); }
  for (let y = y0; y <= y1; y++) { const a = Math.max(t0, Date.parse(`${y}-01-01T12:00:00`)), b = Math.min(t1, Date.parse(`${y + 1}-01-01T12:00:00`)); if (b - a > 20 * 864e5) g.push(sv("text", { x: (X(a) + X(b)) / 2, y: H - 8, "text-anchor": "middle", class: "sc-ax" }, String(y))); }
  const path = (xs, f) => xs.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)} ${Y(f(x)).toFixed(1)}`).join(" ");
  if (ow.length > 1) g.push(sv("path", { d: path(ow, (x) => x.ow), class: "sc-ow" }));
  if (roll.length > 1) g.push(sv("path", { d: path(roll, (x) => x.rr.r), class: "sc-roll2" }, sv("title", {}, `Rolling rank over the last ${ROLL} rounds`)));
  // each season: its season-to-date line, ending on the year-end rank
  for (const yp of yrPts) { const xs = std.filter((x) => x.y === yp.y && x.t < yp.t).map((x) => ({ t: x.t, r: x.sr.r, x })); xs.push({ t: yp.t, r: yp.o.rank });
    if (xs.length > 1) g.push(sv("path", { d: path(xs, (x) => x.r), class: "sc-std" }));
    for (const q of xs.slice(0, -1)) g.push(sv("circle", { cx: X(q.t), cy: Y(q.r), r: 2.6, class: "sc-stdd" }, sv("title", {}, `${fmtD(q.t)}: ${ord(q.r)} of ${q.x.sr.n} in ${yp.y} so far (${sg2(q.x.sr.v)} per round)${q.x.rr ? `; last ${ROLL} rounds ${ord(q.x.rr.r)}` : ""}`))); }
  for (const x of yrPts) g.push(sv("circle", { cx: X(x.t), cy: Y(x.o.rank), r: 5.5, class: "sc-yrd" }, sv("title", {}, `${x.y}${x.partial ? " so far" : " year-end"}: ${ord(x.o.rank)} (${sg2(x.o.sg)} per round, ${x.o.n} rounds)`)),
    sv("text", { x: X(x.t), y: Y(x.o.rank) - 10, "text-anchor": "middle", class: "sc-yrl" }, ord(x.o.rank)));
  return el("div", { class: "sc-chart" }, [sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "sc-svg", role: "img", "aria-label": "Rank over time", style: `max-width:${W}px` }, g),
    el("div", { class: "td-legend sc-lg" }, [el("span", { class: "sc-lg-std" }, "Season-to-date rank"), el("span", { class: "sc-lg-yr" }, "Year-end rank"), el("span", { class: "sc-lg-roll2" }, `Form: last ${ROLL} rounds`), ow.length ? el("span", { class: "sc-lg-ow" }, "OWGR") : null])]);
}
