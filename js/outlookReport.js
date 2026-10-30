/*
 * (update 402) The Outlook report: a short (5 pages or fewer) printable report on the players picked in Compare.
 *   1  Summary: each player's last 12 months, their seasons, and how they compare
 *   2–3 Player profiles (two a page): seasons by part of the game with tour ranks, ball speed, driving distance and
 *      fairways; a strength, a watch, a speed / age check, and their best and costliest distances
 *   4  Strong-field check and the 3-season projection
 *   5  Ranking odds among the players picked, the take, and how the forecast works
 * Built from the field summary (every player, rounds by part of the game, plus their stats), the field detail when
 * it's on hand (distances, for ranks by distance), and the forecast model (js/forecast.js). Plain HTML that opens in
 * a new tab, laid out in landscape pages to print or save as a PDF.
 */
import { statDef, fmtStat } from "./sg.js";

const CATS = ["OTT", "APP", "ARG", "PUTT"];
const CATN = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting", TOTAL: "Total" };
const CATS_SHORT = { OTT: "Off the Tee", APP: "Approach", ARG: "Around Green", PUTT: "Putting" };
const sq = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const minRoundsOf = (most) => Math.max(1, Math.floor((Math.max(0, Number(most) || 0) * 0.33) / 5) * 5); // (the site's rankings rule)
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const f2 = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v * 100) === 0 ? "0.00" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);
const abs2 = (v) => Math.abs(v).toFixed(2);
const pct = (v) => (v == null ? "—" : v < 0.005 ? "<1%" : v > 0.995 ? ">99%" : `${Math.round(v * 100)}%`);
const tone = (v) => (v == null || Math.round(v * 100) === 0 ? "" : v > 0 ? "pos" : "neg");
const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${t[(v - 20) % 10] || t[v] || t[0]}`; };
const lastName = (n) => String(n || "").trim().split(/\s+/).at(-1);
const yy = (y) => `’${String(y).slice(-2)}`;
const dayMs = 864e5;
const toT = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : NaN; };
const dateTxt = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
// a seeded random number and a normal draw, so the same data always gives the same odds
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = (r) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// the stats shown with Off-the-Tee: ball speed (driver), driving distance, fairways
const TEE_STATS = ["ballSpeed", "drive", "fwy"];
const teeOk = (k, o) => (k === "ballSpeed" ? !o.cat || o.cat === "OTT" : !o.cat || o.cat === "OTT");

/** Per player: their seasons and their last 12 months on one tour, with ranks against the players ranked there. */
function buildTables(field, target, keys) {
  const onT = (rd) => sq(rd.tour) === sq(target);
  let maxT = -Infinity;
  for (const p of field) for (const rd of p.rounds || []) if (onT(rd) && rd.shots?.length && !rd.eventLevel) { const t = toT(rd.date); if (t > maxT) maxT = t; }
  // (update 413) the recent window: the last 12 months, or from August on the last 6 (by then a season and the last 12
  // months are nearly the same rounds)
  const winMonths = Number.isFinite(maxT) && new Date(maxT).getUTCMonth() >= 7 ? 6 : 12;
  const from12 = Number.isFinite(maxT) ? Date.UTC(new Date(maxT).getUTCFullYear(), new Date(maxT).getUTCMonth() - winMonths, new Date(maxT).getUTCDate()) : NaN;
  const blank = () => ({ n: 0, sum: { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }, st: {} });
  const add = (s, rd) => {
    s.n++;
    for (const x of rd.shots) if (s.sum[x.cat] != null) s.sum[x.cat] += x.sg || 0;
    for (const o of rd.obs || []) if (TEE_STATS.includes(o.k) && teeOk(o.k, o) && Number.isFinite(o.v)) { const a = (s.st[o.k] ||= [0, 0]); a[0] += o.v * o.w; a[1] += o.w; }
  };
  const per = new Map(); // key → { seasons: Map(year → s), last: s, events: Map(eventId → { n, tot, y }) }
  for (const p of field) {
    const me = { seasons: new Map(), last: blank(), events: new Map() };
    for (const rd of p.rounds || []) {
      if (!onT(rd) || !rd.shots?.length || rd.eventLevel) continue;
      const y = String(rd.year || String(rd.date || "").slice(0, 4));
      if (!/^\d{4}$/.test(y)) continue;
      add(me.seasons.get(y) || me.seasons.set(y, blank()).get(y), rd);
      if (toT(rd.date) > from12) add(me.last, rd);
      const ev = `${y}|${rd.event}`, e = me.events.get(ev) || me.events.set(ev, { y, n: 0, tot: 0 }).get(ev);
      e.n++; for (const x of rd.shots) if (CATS.includes(x.cat)) e.tot += x.sg || 0;
    }
    if (me.seasons.size) per.set(p.key, me);
  }
  const years = [...new Set([...per.values()].flatMap((m) => [...m.seasons.keys()]))].sort();
  // ranks: among the players with enough rounds (the site's rule); a player picked is ranked even with fewer
  const rankSet = (getS) => {
    const all = [...per].map(([k, m]) => [k, getS(m)]).filter(([, s]) => s?.n);
    const minR = minRoundsOf(Math.max(0, ...all.map(([, s]) => s.n)));
    const q = all.filter(([k, s]) => s.n >= minR);
    const valsOf = (s) => {
      const v = { TOTAL: CATS.reduce((t, c) => t + s.sum[c], 0) / s.n };
      for (const c of CATS) v[c] = s.sum[c] / s.n;
      for (const k of TEE_STATS) if (s.st[k]?.[1] > 0) v[k] = s.st[k][0] / s.st[k][1];
      return v;
    };
    const qv = q.map(([k, s]) => [k, valsOf(s)]);
    const out = new Map();
    for (const key of keys) {
      const s = getS(per.get(key) || { seasons: new Map(), last: blank() });
      if (!s?.n) continue;
      const v = valsOf(s), rk = {}, of = {};
      for (const m of ["TOTAL", ...CATS, ...TEE_STATS]) {
        if (v[m] == null) continue;
        const higher = m === "fwy" || m === "drive" || m === "ballSpeed" || !TEE_STATS.includes(m) ? true : statDef(m).higher !== false;
        const others = qv.filter(([k, x]) => k !== key && x[m] != null);
        rk[m] = 1 + others.filter(([, x]) => (higher ? x[m] > v[m] : x[m] < v[m])).length;
        of[m] = others.length + 1;
      }
      out.set(key, { n: s.n, v, rk, of, ranked: s.n >= minR });
    }
    return { out, pool: q.length, minR };
  };
  const seasons = new Map(years.map((y) => [y, rankSet((m) => m.seasons.get(y))]));
  const last = rankSet((m) => m.last);
  return { per, years, seasons, last, maxT, from12, winMonths };
}

/** Each event's field strength: the average season SG of the players in it (two latest seasons). */
function fieldCheck(T, keys) {
  const ys = T.years.slice(-2);
  const seasonAvg = new Map(); // key|y → SG a round that season
  for (const [k, m] of T.per) for (const y of ys) { const s = m.seasons.get(y); if (s?.n >= 10) seasonAvg.set(`${k}|${y}`, CATS.reduce((t, c) => t + s.sum[c], 0) / s.n); }
  const evPlayers = new Map();
  for (const [k, m] of T.per) for (const [ev, e] of m.events) if (ys.includes(e.y)) (evPlayers.get(ev) || evPlayers.set(ev, []).get(ev)).push(k);
  const strength = new Map();
  for (const [ev, ks] of evPlayers) { const y = ev.split("|")[0], vs = ks.map((k) => seasonAvg.get(`${k}|${y}`)).filter((v) => v != null); if (vs.length >= 20) strength.set(ev, vs.reduce((t, v) => t + v, 0) / vs.length); }
  if (strength.size < 6) return null;
  const sorted = [...strength.values()].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const split = (k) => {
    const r = { strong: { n: 0, tot: 0, ev: 0 }, weak: { n: 0, tot: 0, ev: 0 } };
    for (const [ev, e] of T.per.get(k)?.events || []) { const s = strength.get(ev); if (s == null) continue; const b = s >= med ? r.strong : r.weak; b.n += e.n; b.tot += e.tot; b.ev++; }
    return r;
  };
  const MIN = 30;
  const drops = [];
  for (const k of T.per.keys()) { const r = split(k); if (r.strong.n >= MIN && r.weak.n >= MIN) drops.push(r.weak.tot / r.weak.n - r.strong.tot / r.strong.n); }
  drops.sort((a, b) => a - b);
  const q = (p) => drops[Math.min(drops.length - 1, Math.max(0, Math.round(p * (drops.length - 1))))];
  const rows = keys.map((k) => {
    const r = split(k);
    if (!r.strong.n || !r.weak.n) return { key: k, r, drop: null };
    const drop = r.weak.tot / r.weak.n - r.strong.tot / r.strong.n;
    const pctile = drops.length ? drops.filter((d) => d < drop).length / drops.length : null;
    return { key: k, r, drop, pctile, small: r.strong.n < MIN || r.weak.n < MIN };
  });
  return { years: ys, typical: drops.length >= 10 ? { n: drops.length, med: q(0.5), lo: q(0.1), hi: q(0.9) } : null, rows, events: strength.size };
}

/** Best and costliest distances over the last 12 months (ranked against the field when the detail is on hand). */
function distanceEdges(key, own, detail, target, from12) {
  const onT = (rd) => sq(rd.tour) === sq(target) && toT(rd.date) > from12 && rd.shots?.length && !rd.eventLevel;
  const tally = (rounds) => {
    const by = new Map(); let n = 0;
    for (const rd of rounds || []) { if (!onT(rd)) continue; n++; for (const x of rd.shots) { if (!x.dist || !CATS.includes(x.cat)) continue; const id = `${x.cat}|${x.dist}`, a = by.get(id) || by.set(id, { sg: 0, w: 0 }).get(id); a.sg += x.sg || 0; a.w += x.w || 1; } }
    return { n, by };
  };
  const mine = tally(own);
  if (!mine.n || !mine.by.size) return null;
  // the field's per-round values at each distance (when the detail is here): for ranks
  let ranks = null;
  if (detail?.length) {
    const all = detail.map((p) => [p.key, tally(p.rounds)]).filter(([, t]) => t.n);
    const minR = minRoundsOf(Math.max(0, ...all.map(([, t]) => t.n)));
    const q = all.filter(([k, t]) => t.n >= minR && k !== key);
    ranks = (id, v) => { const others = q.map(([, t]) => t.by.get(id)).filter((a) => a && a.w >= 8).map((a) => a); return others.length >= 20 ? { rk: 1 + q.filter(([, t]) => { const a = t.by.get(id); return a && a.w >= 8 && a.sg / t.n > v; }).length, of: others.length + 1 } : null; };
  }
  const list = [...mine.by].filter(([, a]) => a.w >= 8).map(([id, a]) => { const [cat, dist] = id.split("|"); const v = a.sg / mine.n; return { cat, dist, v, att: a.w, ...(ranks ? { r: ranks(id, v) } : {}) }; });
  if (list.length < 2) return null;
  list.sort((a, b) => b.v - a.v);
  return { best: list.slice(0, 2).filter((x) => x.v > 0), worst: list.slice(-2).reverse().filter((x) => x.v < 0), n: mine.n };
}

/** The odds among the players picked: who's best each season, the likeliest orders next season, who passes whom. */
function groupOdds(fcs) {
  const S = 20000, r = rng(4242), H = fcs[0].years.length;
  const best = fcs.map(() => new Array(H).fill(0));
  const orders = new Map();
  const ahead = new Map(); // "i|j|h" → times i finished ahead of j
  for (let s = 0; s < S; s++) {
    for (let h = 0; h < H; h++) {
      const draws = fcs.map((f) => f.years[h].total + gauss(r) * f.years[h].sd);
      let bi = 0; for (let i = 1; i < draws.length; i++) if (draws[i] > draws[bi]) bi = i;
      best[bi][h]++;
      for (let i = 0; i < draws.length; i++) for (let j = 0; j < draws.length; j++) if (i !== j && draws[i] > draws[j]) { const id = `${i}|${j}|${h}`; ahead.set(id, (ahead.get(id) || 0) + 1); }
      if (h === 0) { const o = draws.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i).join(">"); orders.set(o, (orders.get(o) || 0) + 1); }
    }
  }
  return {
    best: best.map((row) => row.map((c) => c / S)),
    orders: [...orders].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([o, c]) => ({ order: o.split(">").map(Number), p: c / S })),
    ahead: (i, j, h) => (ahead.get(`${i}|${j}|${h}`) || 0) / S,
  };
}

/** A small line of a player's seasons (SVG), zero marked. */
function spark(pts, years, lo, hi) {
  // (update 406) every card on the same seasons (so they line up), each one labelled underneath
  const W = 220, Hh = 66, pad = 8, B = 14, n = years.length;
  if (!pts.length || n < 2) return "";
  const x = (yr) => pad + (years.indexOf(yr) * (W - 2 * pad)) / (n - 1), y = (v) => pad + ((hi - v) * (Hh - B - 2 * pad)) / (hi - lo || 1);
  const line = pts.map(([yr, v]) => `${x(yr).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" aria-hidden="true"><line x1="${pad}" x2="${W - pad}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="zero"/>${pts.length > 1 ? `<polyline points="${line}" class="ln"/>` : ""}${pts.map(([yr, v]) => `<circle cx="${x(yr).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="${v >= 0 ? "p" : "n"}"/>`).join("")}${years.map((yr) => `<text x="${x(yr).toFixed(1)}" y="${Hh - 2}" class="ax" text-anchor="middle">${esc(yy(yr))}</text>`).join("")}</svg>`;
}

/** The projection chart: each player's last season, then the next three, with their likely ranges. */
function projChart(fcs, lastYear, colors, names = []) {
  const W = 470, Hh = 210, L = 44, R = 14, Tp = 12, B = 26;
  const cols = [String(lastYear), ...fcs[0].years.map((y) => y.year)];
  const vals = fcs.flatMap((f) => [f.now?.total, ...f.years.flatMap((y) => [y.lo, y.hi])]).filter((v) => v != null);
  const hi = Math.max(0.3, ...vals) + 0.1, lo = Math.min(-0.3, ...vals) - 0.1;
  const x = (i) => L + (i * (W - L - R)) / (cols.length - 1), y = (v) => Tp + ((hi - v) * (Hh - Tp - B)) / (hi - lo);
  const ticks = []; for (let t = Math.ceil(lo * 2) / 2; t <= hi; t += 0.5) ticks.push(t);
  let g = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${Math.abs(t) < 1e-9 ? "zero" : "grid"}"/><text x="${L - 6}" y="${y(t) + 3.5}" class="ax" text-anchor="end">${f2(t)}</text>`).join("");
  g += cols.map((c, i) => `<text x="${x(i)}" y="${Hh - 8}" class="ax" text-anchor="middle">${esc(c)}</text>`).join("");
  fcs.forEach((f, k) => {
    const c = colors[k % colors.length];
    const band = f.years.map((yv, i) => `${x(i + 1)},${y(yv.hi)}`).join(" ") + " " + [...f.years].reverse().map((yv, i) => `${x(f.years.length - i)},${y(yv.lo)}`).join(" ");
    g += `<polygon points="${band}" fill="${c}" opacity="0.10"/>`;
    const pts = [f.now ? [x(0), y(f.now.total)] : null, ...f.years.map((yv, i) => [x(i + 1), y(yv.total)])].filter(Boolean);
    g += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2.4"/>` + pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.4" fill="${c}"/>`).join("");
  });
  // (update 406) a key: who each line is
  const key = `<div class="legend">${fcs.map((f, k) => `<span><i style="background:${colors[k % colors.length]}"></i>${esc(names[k] || f.name)}</span>`).join("")}<span class="muted">shaded: likely range</span></div>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="max-width:${W}px" aria-label="Projection chart">${g}</svg>${key}`;
}

/**
 * The report's HTML. opts: { field, detail (optional), fcs (forecastPlayer results, names set), info (the model's
 * summary from js/forecastClient.js: target, lastYear, params, err, ageOk, fieldN, ageAt),
 * ownRounds: (key) → that player's rounds with distances (optional) }
 */
export function buildOutlookReport({ field, detail = null, fcs: fcsIn, info, ownRounds = null }) {
  const model = info, target = model.target;
  const fcs = (fcsIn || []).filter(Boolean).slice(0, 4), moreThan4 = (fcsIn || []).filter(Boolean).length > 4;
  if (!fcs.length) throw new Error("Not enough rounds to forecast these players.");
  const keys = fcs.map((f) => f.key);
  const T = buildTables(field, target, keys);
  const FC = fieldCheck(T, keys);
  const colors = ["#2f6fdb", "#e0782f", "#2a9d6f", "#9b4fc9"];
  const cur = String(new Date().getFullYear());
  const yLabel = (y) => String(y); // (update 413: the current season as just its year)
  const WIN = `Last ${T.winMonths} months`, win = WIN.toLowerCase();
  const nm = (f) => esc(f.name), ln = (f) => esc(lastName(f.name));
  const ageOf = (f) => (f.age != null ? Math.floor(f.age + (Number(cur) - Number(model.lastYear))) : null); // (age now)
  const lastOf = (k) => T.last.out.get(k);
  const showYears = T.years.slice(-4).filter((y) => keys.some((k) => T.seasons.get(y)?.out.get(k)));
  const rankTxt = (o, m) => (o?.rk?.[m] ? `#${o.rk[m]}` : "");
  const cell = (o, m) => (o?.v?.[m] == null ? "—" : `<span class="${tone(o.v[m])}">${f2(o.v[m])}</span> <small>(${rankTxt(o, m)})</small>`);
  const statCell = (o, k) => (o?.v?.[k] == null ? "—" : `${esc(fmtStat(statDef(k), o.v[k]))} <small>(${rankTxt(o, k)})</small>`);
  const hasStat = (k) => keys.some((key) => [...T.seasons.values(), T.last].some((r) => r.out.get(key)?.v?.[k] != null));
  const teeCols = TEE_STATS.filter(hasStat);
  const thru = Number.isFinite(T.maxT) ? dateTxt(T.maxT) : "";
  const fromTxt = Number.isFinite(T.from12) ? dateTxt(T.from12) : "";
  const lastPool = T.last.pool;

  /* ---------- the insights for each player ---------- */
  const insight = new Map();
  for (const f of fcs) {
    const L = lastOf(f.key), out = { lines: {} };
    const seas = showYears.map((y) => [y, T.seasons.get(y).out.get(f.key)]).filter(([, o]) => o && o.n >= 10);
    if (L) {
      const byRank = CATS.filter((c) => L.rk[c]).sort((a, b) => L.rk[a] - L.rk[b]);
      const bestC = byRank[0], worstC = byRank.at(-1);
      out.best = bestC; out.worst = worstC;
      const posN = seas.filter(([, o]) => o.v[bestC] > 0).length;
      out.lines.strength = `${L.v[bestC] > 0.005 ? "" : "No part of the game gains strokes yet; the least costly: "}${CATN[bestC]} is ${f2(L.v[bestC])} a round (#${L.rk[bestC]} of ${L.of[bestC]}) over the ${win}${seas.length > 1 ? (posN === seas.length ? `, and positive in every season shown` : `; positive in ${posN} of ${seas.length} seasons shown`) : ""}.`;
      const negN = seas.filter(([, o]) => o.v[worstC] < 0).length;
      let watch = `${CATN[worstC]} is ${f2(L.v[worstC])} (#${L.rk[worstC]})${seas.length > 1 ? `, below average in ${negN} of ${seas.length} seasons` : ""}.`;
      // a part of the game that's faded the most since the first season shown
      if (seas.length >= 2) {
        const first = seas[0][1], lastS = seas.at(-1)[1];
        const fall = CATS.map((c) => [c, lastS.v[c] - first.v[c]]).sort((a, b) => a[1] - b[1])[0];
        if (fall && fall[1] <= -0.25 && fall[0] !== worstC) watch += ` ${CATN[fall[0]]} has faded from ${f2(first.v[fall[0]])} to ${f2(lastS.v[fall[0]])} since ${seas[0][0]}.`;
      }
      out.lines.watch = watch;
      out.mix = { bs: L.v.OTT + L.v.APP, sh: L.v.ARG + L.v.PUTT };
    }
    // speed and age: ball speed (else driving distance) over the seasons, and what age typically does in this data
    const spK = ["ballSpeed", "drive"].find((k) => seas.some(([, o]) => o.v[k] != null) || L?.v?.[k] != null);
    let sp = "";
    if (spK) {
      const def = statDef(spK), withK = seas.filter(([, o]) => o.v[spK] != null);
      const now = L?.v?.[spK] ?? withK.at(-1)?.[1].v[spK];
      sp = `${def.label}: ${fmtStat(def, now)}${L?.rk?.[spK] ? ` (#${L.rk[spK]} of ${L.of[spK]})` : ""}`;
      if (withK.length >= 2) { const d = withK.at(-1)[1].v[spK] - withK[0][1].v[spK], u = spK === "ballSpeed" ? 0.5 : 1.5; sp += Math.abs(d) < u ? `, steady since ${withK[0][0]}.` : `, ${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)}${def.unit} since ${withK[0][0]} (${fmtStat(def, withK[0][1].v[spK])} → ${fmtStat(def, withK.at(-1)[1].v[spK])}).`; } else sp += ".";
    }
    let ageLine = "";
    if (f.age != null && model.ageOk) {
      const per = model.ageAt?.[f.key] ?? 0;
      ageLine = ` At ${Math.floor(f.age)}, players in this data typically ${Math.abs(per) < 0.02 ? "hold steady" : per > 0 ? `gain about ${abs2(per)} a round a season` : `lose about ${abs2(per)} a round a season`}.`;
    } else if (f.age == null) ageLine = " No birth date in the data, so age isn’t taken into account.";
    out.lines.speed = (sp + ageLine).trim();
    // distances
    const own = ownRounds ? ownRounds(f.key) : null;
    const det = detail?.find?.((p) => p.key === f.key)?.rounds;
    const edges = distanceEdges(f.key, det || own, detail, target, T.from12);
    if (edges) {
      const dTxt = (x) => `${/tee/i.test(x.dist) ? "" : `${CATS_SHORT[x.cat]} `}${x.dist} (${f2(x.v)}${x.r ? `, #${x.r.rk}` : ""})`;
      out.lines.dist = [edges.best.length ? `Best: ${edges.best.map(dTxt).join(", ")}.` : "", edges.worst.length ? `Costliest: ${edges.worst.map(dTxt).join(", ")}.` : ""].filter(Boolean).join(" ");
    }
    // the one-liner on the summary card
    if (L && out.best) {
      const trend = seas.length >= 2 ? seas.at(-1)[1].v.TOTAL - seas.at(-2)[1].v.TOTAL : null;
      out.oneLine = `${L.v[out.best] > 0.005 ? `${CATN[out.best]} leads the way (${f2(L.v[out.best])})` : `Nothing gains strokes yet; ${CATN[out.best].toLowerCase()} is closest (${f2(L.v[out.best])})`}; ${CATN[out.worst].toLowerCase()} ${L.v[out.worst] < 0 ? `costs ${abs2(L.v[out.worst])} a round` : `is the weakest part (${f2(L.v[out.worst])})`}.${trend != null && Math.abs(trend) >= 0.2 ? ` ${trend > 0 ? "Up" : "Down"} ${abs2(trend)} a round on the season before.` : ""}`;
    }
    out.seasonsTxt = seas.length ? `${yy(seas[0][0])}–${yy(seas.at(-1)[0])}: ${seas.map(([, o]) => f2(o.v.TOTAL)).join(" · ")}` : "";
    out.sparkVals = seas.map(([, o]) => o.v.TOTAL);
    out.sparkPts = seas.map(([yr, o]) => [yr, o.v.TOTAL]);
    insight.set(f.key, out);
  }

  /* ---------- the comparisons ---------- */
  const cmp = [];
  const withL = fcs.filter((f) => lastOf(f.key));
  if (withL.length >= 2) {
    const byTot = [...withL].sort((a, b) => lastOf(b.key).v.TOTAL - lastOf(a.key).v.TOTAL);
    const a = byTot[0], b = byTot[1], z = byTot.at(-1);
    cmp.push(`${nm(a)} leads over the ${win} at ${f2(lastOf(a.key).v.TOTAL)} a round (#${lastOf(a.key).rk.TOTAL}), ${abs2(lastOf(a.key).v.TOTAL - lastOf(b.key).v.TOTAL)} ahead of ${nm(b)}${byTot.length > 2 ? ` and ${abs2(lastOf(a.key).v.TOTAL - lastOf(z.key).v.TOTAL)} ahead of ${nm(z)}` : ""}.`);
    // the biggest gap in one part of the game
    let gap = null;
    for (const c of CATS) { const s = [...withL].sort((x, y) => lastOf(y.key).v[c] - lastOf(x.key).v[c]), d = lastOf(s[0].key).v[c] - lastOf(s.at(-1).key).v[c]; if (!gap || d > gap.d) gap = { c, d, hi: s[0], lo: s.at(-1) }; }
    if (gap) cmp.push(`The biggest gap is ${CATN[gap.c]}: ${nm(gap.hi)} ${f2(lastOf(gap.hi.key).v[gap.c])} against ${nm(gap.lo)} ${f2(lastOf(gap.lo.key).v[gap.c])}, ${abs2(gap.d)} a round.`);
    const bs = [...withL].sort((x, y) => insight.get(y.key).mix.bs - insight.get(x.key).mix.bs)[0], sh = [...withL].sort((x, y) => insight.get(y.key).mix.sh - insight.get(x.key).mix.sh)[0];
    cmp.push(bs === sh ? `${nm(bs)} is best both from tee to green (${f2(insight.get(bs.key).mix.bs)}) and in the short game (${f2(insight.get(sh.key).mix.sh)}).` : `Best ball-striker: ${nm(bs)} (${f2(insight.get(bs.key).mix.bs)} off the tee and approach). Best short game: ${nm(sh)} (${f2(insight.get(sh.key).mix.sh)} around the green and putting).`);
    const spd = withL.filter((f) => lastOf(f.key).v.ballSpeed != null).sort((x, y) => lastOf(y.key).v.ballSpeed - lastOf(x.key).v.ballSpeed);
    if (spd.length >= 2) { const d = lastOf(spd[0].key).v.ballSpeed - lastOf(spd.at(-1).key).v.ballSpeed; cmp.push(`${nm(spd[0])} has the most ball speed with the driver (${esc(fmtStat(statDef("ballSpeed"), lastOf(spd[0].key).v.ballSpeed))}), ${d.toFixed(1)} mph more than ${nm(spd.at(-1))}.`); }
    // the steadiest from season to season
    const sdOf = (f) => { const v = insight.get(f.key).sparkVals; if (v.length < 3) return null; const m = v.reduce((t, x) => t + x, 0) / v.length; return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / v.length); };
    const st = withL.map((f) => [f, sdOf(f)]).filter(([, s]) => s != null).sort((x, y) => x[1] - y[1]);
    if (st.length >= 2) cmp.push(`Steadiest from season to season: ${nm(st[0][0])} (typically within ${abs2(st[0][1])} of their average); the most up and down: ${nm(st.at(-1)[0])} (${abs2(st.at(-1)[1])}).`);
  }

  /* ---------- the forecast ---------- */
  const sum3 = (f) => f.years.reduce((t, y) => t + y.total, 0) / f.years.length;
  const order = [...fcs].sort((a, b) => sum3(b) - sum3(a));
  const odds = fcs.length >= 2 ? groupOdds(order) : null;
  const yrs = order[0].years.map((y) => y.year);
  const projLines = order.map((f) => {
    const y1 = f.years[0], y3 = f.years.at(-1), d = y3.total - y1.total;
    return `${ln(f)}: ${f2(y1.total)} in ${y1.year} (about ${ordinal(y1.rank)}), ${Math.abs(d) < 0.05 ? "level after that" : `${d > 0 ? "rising" : "sliding"} to ${f2(y3.total)} by ${y3.year}`}${Math.abs(y3.ageAdd) >= 0.05 ? ` (age ${y3.ageAdd > 0 ? "adds" : "takes"} about ${abs2(y3.ageAdd)} by then)` : ""}.`;
  });
  const nextBest = [...fcs].sort((a, b) => b.years[0].total - a.years[0].total)[0];
  const headline = (() => {
    if (fcs.length === 1) return `${nm(fcs[0])}: ${f2(fcs[0].years[0].total)} a round projected for ${yrs[0]}`;
    if (nextBest === order[0]) return `${ln(order[0])} projects best next season and over all three`;
    return `${ln(nextBest)} leads ${yrs[0]}; ${ln(order[0])} leads over three seasons`;
  })();
  const oddsLines = [];
  if (odds) {
    const bestNow = odds.best.map((row) => row[0]);
    const lead = Math.max(...bestNow);
    oddsLines.push(`A ${pct(1 / fcs.length)} share would mean no edge at all; the favourite for ${yrs[0]} is at ${pct(lead)}.`);
    // passes: a pair where the one behind next season catches up
    for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) {
      if (i === j) continue;
      const p = yrs.map((_, h) => odds.ahead(j, i, h));
      if (p[0] < 0.5 && p.at(-1) - p[0] >= 0.08) oddsLines.push(`${ln(order[j])} passes ${ln(order[i])}: ${p.map(pct).join(" → ")} over ${yrs[0]}–${yrs.at(-1)}.`);
    }
  }
  const pr = model.params;
  const acc = model.err.map((e, i) => (e ? { h: i + 1, mae: e.mae, n: e.n } : null)).filter(Boolean);

  /* ---------- the pages ---------- */
  const pages = [];
  // 1 · summary
  const sparkLo = Math.min(-0.3, ...fcs.flatMap((f) => insight.get(f.key).sparkVals)), sparkHi = Math.max(0.3, ...fcs.flatMap((f) => insight.get(f.key).sparkVals));
  const cards = fcs.map((f, i) => {
    const L = lastOf(f.key), ins = insight.get(f.key);
    return `<div class="card" style="--c:${colors[i % colors.length]}"><div class="who">${nm(f)}${ageOf(f) != null ? ` <small>· Age ${ageOf(f)}</small>` : ""}</div>
      ${L ? `<div class="big ${tone(L.v.TOTAL)}">${f2(L.v.TOTAL)}</div><div class="muted"><b>${WIN}</b> · SG total a round · #${L.rk.TOTAL} of ${L.of.TOTAL} · ${L.n} rounds</div>` : `<div class="muted">No rounds in the ${win}</div>`}
      ${spark(ins.sparkPts, showYears, sparkLo, sparkHi)}
      ${L ? `<div class="mix"><span>Ball-striking <b class="${tone(ins.mix.bs)}">${f2(ins.mix.bs)}</b></span><span>Short game <b class="${tone(ins.mix.sh)}">${f2(ins.mix.sh)}</b></span></div>` : ""}
      <div class="muted small">${esc(ins.seasonsTxt)}</div><p>${esc(ins.oneLine || "")}</p></div>`;
  }).join("");
  const seasonRows = fcs.map((f) => `<tr><td><b>${nm(f)}</b></td>${showYears.map((y) => `<td>${cell(T.seasons.get(y).out.get(f.key), "TOTAL")}</td>`).join("")}<td>${cell(lastOf(f.key), "TOTAL")}</td></tr>`).join("")
    + `<tr class="muted"><td>Ranked players</td>${showYears.map((y) => `<td>${T.seasons.get(y).pool}</td>`).join("")}<td>${lastPool}</td></tr>`;
  pages.push(`<section class="page"><div class="kicker">Player evaluation · skill and projection</div>
    <h1>${fcs.map(ln).join(" · ")}</h1>
    <p class="sub">Current skill on strokes gained and a 3-season projection, ${esc(yrs[0])}–${esc(yrs.at(-1))} · ${esc(target)} · data through ${esc(thru)}</p>
    <div class="cards n${fcs.length}">${cards}</div>
    <div class="two"><div><h3>Total strokes gained a round (tour rank)</h3><table><tr><th></th>${showYears.map((y) => `<th>${esc(yLabel(y))}</th>`).join("")}<th>${WIN}</th></tr>${seasonRows}</table></div>
    <div><h3>Side by side</h3><ul>${cmp.map((t) => `<li>${t}</li>`).join("") || "<li>Pick two or more players to compare them.</li>"}</ul></div></div>
    <p class="foot">${WIN} = ${esc(fromTxt)} to ${esc(thru)}. Ball-striking = Off-the-Tee + Approach; short game = Around-the-Green + Putting. Ranks against players with enough rounds on ${esc(target)} that season (the site’s rankings rule).</p></section>`);
  // 2–3 · profiles, two a page
  const profile = (f, i) => {
    const ins = insight.get(f.key);
    const rows = [...showYears.map((y) => [yLabel(y), T.seasons.get(y).out.get(f.key)]), [WIN, lastOf(f.key)]].filter(([, o]) => o);
    const tbl = `<table class="prof"><tr><th>Season</th><th>Rds</th><th>Total</th>${CATS.map((c) => `<th>${CATS_SHORT[c]}</th>`).join("")}${teeCols.map((k) => `<th>${esc(statDef(k).label)}</th>`).join("")}</tr>
      ${rows.map(([lab, o]) => `<tr${lab === WIN ? ' class="hl"' : ""}><td>${esc(lab)}</td><td>${o.n}</td><td>${cell(o, "TOTAL")}</td>${CATS.map((c) => `<td>${cell(o, c)}</td>`).join("")}${teeCols.map((k) => `<td>${statCell(o, k)}</td>`).join("")}</tr>`).join("")}</table>`;
    const box = (cls, title, txt) => (txt ? `<div class="box ${cls}"><div class="bt">${title}</div><p>${esc(txt)}</p></div>` : "");
    return `<div class="profile" style="--c:${colors[i % colors.length]}"><h2>${nm(f)}${ageOf(f) != null ? ` <small>· Age ${ageOf(f)}</small>` : ""}</h2>${tbl}
      <div class="boxes">${box("s", "Strength", ins.lines.strength)}${box("w", "Watch", ins.lines.watch)}${box("a", spK(ins) ? "Speed and age" : "Age", ins.lines.speed)}${box("d", `By distance (${win})`, ins.lines.dist)}</div></div>`;
  };
  const spK = (ins) => /Ball Speed|Driving Distance/.test(ins.lines.speed || "");
  for (let i = 0; i < fcs.length; i += 2) {
    pages.push(`<section class="page"><div class="kicker">Player profiles</div>${fcs.slice(i, i + 2).map((f, j) => profile(f, i + j)).join("")}
      <p class="foot">Strokes gained a round with tour rank in brackets. ${teeCols.includes("ballSpeed") ? "Ball speed is on tee shots with the driver. " : ""}${teeCols.length ? "Driving stats as the data file gives them. " : ""}Distances need 8+ attempts; ranks by distance against the players with enough rounds${detail ? "" : " (rebuild the rankings on Upload Data for ranks by distance)"}.</p></section>`);
  }
  // 4 · field strength and the projection
  const fcRows = FC ? FC.rows.map((r) => {
    const f = fcs.find((x) => x.key === r.key), s = r.r.strong, w = r.r.weak;
    const label = r.drop == null ? "—" : r.pctile == null ? "" : r.pctile < 0.4 ? "Holds up better" : r.pctile > 0.6 ? "Drops more" : "About typical";
    return `<tr><td><b>${nm(f)}</b></td><td>${s.n ? `<span class="${tone(s.tot / s.n)}">${f2(s.tot / s.n)}</span><br><small>${s.ev} events · ${s.n} rds</small>` : "—"}</td><td>${w.n ? `<span class="${tone(w.tot / w.n)}">${f2(w.tot / w.n)}</span><br><small>${w.ev} events · ${w.n} rds</small>` : "—"}</td><td>${r.drop == null ? "—" : f2(r.drop)}</td><td>${label}${r.pctile != null ? `<br><small>${ordinal(Math.round(r.pctile * 100))} percentile${r.small ? ", small sample" : ""}</small>` : ""}</td></tr>`;
  }).join("") + (FC.typical ? `<tr class="muted"><td>Typical player</td><td colspan="2">${FC.typical.n} players with 30+ rounds in each half</td><td>${f2(FC.typical.med)}</td><td><small>Middle 80%: ${f2(FC.typical.lo)} to ${f2(FC.typical.hi)}</small></td></tr>` : "") : "";
  const fcNotes = FC ? FC.rows.filter((r) => r.drop != null).map((r) => {
    const f = fcs.find((x) => x.key === r.key), share = r.r.weak.ev / Math.max(1, r.r.weak.ev + r.r.strong.ev);
    return `${ln(f)}: ${share >= 0.65 ? `${Math.round(share * 100)}% of their events are in weaker fields; ` : share <= 0.35 ? `plays mostly stronger fields (${Math.round((1 - share) * 100)}% of events); ` : ""}${r.pctile == null ? "" : r.pctile < 0.4 ? "gives back less than most in strong fields." : r.pctile > 0.6 ? `drops more in strong fields than ${Math.round(r.pctile * 100)}% of players.` : "about the usual drop in strong fields."}${r.small ? " (Few rounds in one half.)" : ""}`;
  }) : [];
  const projRows = order.map((f) => `<tr><td><b>${nm(f)}</b>${ageOf(f) != null ? `<br><small>Age ${ageOf(f) + 1}–${ageOf(f) + f.years.length}</small>` : ""}</td>${f.years.map((y) => `<td><b class="${tone(y.total)}">${f2(y.total)}</b> <small>(~#${y.rank})</small><br><small>${f2(y.lo)} to ${f2(y.hi)}</small></td>`).join("")}<td><b class="${tone(sum3(f))}">${f2(sum3(f))}</b></td></tr>`).join("");
  pages.push(`<section class="page"><div class="kicker">Strong-field check · 3-season projection</div>
    <h2 class="h">${FC ? "How they hold up against stronger fields, and where they’re headed" : "Where they’re headed"}</h2>
    <div class="two">${FC ? `<div><h3>Stronger vs. weaker fields (${esc(FC.years.join("–"))})</h3><table><tr><th></th><th>Stronger fields</th><th>Weaker fields</th><th>Drop</th><th>vs. typical player</th></tr>${fcRows}</table>
      <ul>${fcNotes.map((t) => `<li>${t}</li>`).join("")}</ul>
      <p class="foot">Events split at the middle field strength (the average season SG of the players in each event). Drop = weaker-field SG minus stronger-field SG. Strokes gained is against the field each week, so beating a weak field is easier.</p></div>` : ""}
    <div><h3>Projected SG total a round (likely range)</h3><table><tr><th></th>${yrs.map((y) => `<th>${esc(y)}</th>`).join("")}<th>3-season avg</th></tr>${projRows}</table>
      ${projChart(order, model.lastYear, order.map((f) => colors[fcs.indexOf(f) % colors.length]), order.map((f) => f.name))}
      <ul>${projLines.map((t) => `<li>${t}</li>`).join("")}</ul></div></div>
    <p class="foot">Strokes gained a round against an average ${esc(target)} field (each round credited for the strength of its field). Range: 8 times in 10 the season should land inside it. ~# = the rank it would mean against ${model.fieldN || "the"} players forecast the same way.${model.ageOk ? " Includes the typical change for each player’s age." : " No birth dates, so age isn’t in it."}</p></section>`);
  // 5 · odds, the take, how it works
  const oddsTbl = odds ? `<table><tr><th>Chance of ranking best of the ${fcs.length}</th>${yrs.map((y) => `<th>${esc(y)}</th>`).join("")}</tr>${order.map((f, i) => `<tr><td><b>${nm(f)}</b></td>${odds.best[i].map((p) => `<td>${pct(p)}</td>`).join("")}</tr>`).join("")}</table>
    <h3>Likeliest orders in ${esc(yrs[0])}</h3><table>${odds.orders.map((o) => `<tr><td>${o.order.map((i) => ln(order[i])).join(" › ")}</td><td>${pct(o.p)}</td></tr>`).join("")}</table>` : "";
  // (update 411) where each finishes over the three seasons (and who's best next season, when that's someone else)
  const roleOf = (f, i) => `${ordinal(i + 1)} over three seasons${f === nextBest ? ` \u00b7 best in ${yrs[0]}` : ""}`;
  const takes = order.map((f, i) => {
    const ins = insight.get(f.key), FCr = FC?.rows.find((r) => r.key === f.key);
    const risk = [f.flags?.fewRounds ? "few rounds last season" : "", FCr?.pctile > 0.6 ? "numbers lean on weaker fields" : "", ins.worst && lastOf(f.key)?.v?.[ins.worst] < -0.2 ? `${CATN[ins.worst].toLowerCase()} (${f2(lastOf(f.key).v[ins.worst])})` : "", f.age != null && model.ageOk && f.years.at(-1).ageAdd <= -0.1 ? "age" : ""].filter(Boolean);
    return `<div class="take" style="--c:${colors[fcs.indexOf(f) % colors.length]}"><div class="tk">${esc(roleOf(f, i))}</div><div class="who">${nm(f)}</div>
      <p>${f2(f.years[0].total)} in ${esc(yrs[0])}, ${f2(sum3(f))} a season over ${esc(yrs[0])}–${esc(yrs.at(-1))}.${odds ? ` Best of the ${fcs.length} in ${esc(yrs[0])}: ${pct(odds.best[i][0])}.` : ""}</p>
      ${ins.best ? `<p><b>Strengths:</b> ${(() => { const L0 = lastOf(f.key), good = CATS.filter((c) => L0.v[c] > 0.005).sort((a, b) => L0.v[b] - L0.v[a]); return good.length ? good.map((c) => `${CATN[c]} (${f2(L0.v[c])})`).join(", ") : `none gaining strokes yet; closest is ${CATN[ins.best]} (${f2(L0.v[ins.best])})`; })()}.</p>` : ""}${risk.length ? `<p><b>Risks:</b> ${esc(risk.join("; "))}.</p>` : ""}</div>`;
  }).join("");
  // (update 410) how the projection works
  const pc = pr.cats || {};
  const method = `<ul class="meth">
    <li><b>Field strength.</b> Every round is credited for the strength of its field (the average level of the players in it), so a weak-field week counts for less and every tour sits on one scale. On ${esc(target)}, a field moves a round by ${f2(pr.field?.spread?.[0] ?? 0)} to ${f2(pr.field?.spread?.[1] ?? 0)} (middle 80% of events).</li>
    <li><b>Event by event.</b> A Kalman filter per part of the game: after each event a player\u2019s level moves toward what they showed, by how much that event deserves. Recent events count most. Learned from the data: a round\u2019s noise (${CATS.map((c) => `${CATS_SHORT[c]} \u00b1${(pc[c]?.noise ?? 0).toFixed(2)}`).join(", ")}) and how long half an edge lasts (${CATS.map((c) => `${CATS_SHORT[c]} ${(pc[c]?.halfLife ?? 0).toFixed(1)} yrs`).join(", ")}).</li>
    <li><b>Age:</b> ${model.ageOk ? `${[24, 28, 32, 36, 40].map((a) => `${f2(pr.age.at[a])} at ${a}`).join(", ")} a season (learned from ${pr.age.players} players\u2019 birth dates).` : "no birth dates in the data, so not used."}</li>
    <li>Every setting is learned from this data (maximum likelihood), not chosen. Ranges scaled so 8 in 10 past seasons landed inside. Odds from 20,000 simulated seasons.</li></ul>`;
  const before = [
    fcs.some((f) => f.age == null) ? `Add birth dates for ${fcs.filter((f) => f.age == null).map(ln).join(", ")} (age is left out without them).` : "",
    fcs.some((f) => f.flags?.fewRounds) ? `Few rounds last season for ${fcs.filter((f) => f.flags?.fewRounds).map(ln).join(", ")}: revisit after more rounds.` : "",
    "Strokes gained only: injuries, swing or equipment changes and schedules aren’t in the data.",
  ].filter(Boolean);
  pages.push(`<section class="page"><div class="kicker">Ranking odds · the take</div><h2 class="h">${esc(headline)}</h2>
    <div class="two"><div>${oddsTbl}<ul>${oddsLines.map((t) => `<li>${t}</li>`).join("")}</ul></div>
    <div><h3>How the projection works</h3>${method}</div></div>
    <div class="takes n${order.length}">${takes}</div>
    <p class="foot"><b>Before deciding:</b> ${esc(before.join(" "))}</p></section>`);

  const css = `@page{size:letter landscape;margin:0.35in}*{box-sizing:border-box}body{font:12.5px/1.42 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#1b1f24;margin:0;background:#fff}
  .page{page-break-after:always;break-after:page;padding:6px 4px;min-height:7.6in;position:relative}.page:last-child{page-break-after:auto;break-after:auto}
  @media screen{body{background:#eef1f5}.page{background:#fff;width:11in;min-height:8.5in;margin:16px auto;padding:0.35in;box-shadow:0 2px 10px rgba(0,0,0,.12)}}
  .kicker{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6b7480;font-weight:600}
  h1{font-size:26px;margin:2px 0 2px}h2{font-size:17px;margin:4px 0 6px}h2.h{font-size:19px;margin:2px 0 10px}h2 small,.who small{font-weight:400;color:#6b7480;font-size:12px}h3{font-size:12.5px;margin:6px 0 5px}
  .sub{color:#4a535e;margin:0 0 10px}.muted{color:#6b7480}.small,small{font-size:10px;color:#6b7480}
  .pos{color:#1e8a4c}.neg{color:#c8372d}
  table{border-collapse:collapse;width:100%;margin:2px 0 8px}th,td{border-bottom:1px solid #e3e6ea;padding:4px 6px;text-align:right;vertical-align:top}th{font-size:10px;color:#4a535e;font-weight:600;text-transform:uppercase;letter-spacing:.03em}th:first-child,td:first-child{text-align:left}tr.hl td{background:#f4f7fb;font-weight:600}tr.muted td{color:#6b7480}
  .cards{display:grid;gap:10px;margin:6px 0 10px}.cards.n1{grid-template-columns:1fr}.cards.n2{grid-template-columns:1fr 1fr}.cards.n3{grid-template-columns:1fr 1fr 1fr}.cards.n4{grid-template-columns:1fr 1fr 1fr 1fr}
  .card{border:1px solid #e3e6ea;border-top:4px solid var(--c);border-radius:8px;padding:8px 10px}.card .who{font-weight:700;font-size:13.5px}.card .big{font-size:26px;font-weight:700;line-height:1.1;margin-top:4px}.card p{margin:4px 0 0}
  .mix{display:flex;gap:12px;font-size:11px;margin:2px 0}.spark{display:block;margin:4px 0;max-width:100%}.spark .zero{stroke:#b9c0c8;stroke-dasharray:3 3}.spark text.ax{font-size:9.5px;fill:#6b7480}.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;margin:2px 0 4px}.legend span{display:inline-flex;align-items:center;gap:5px}.legend i{width:14px;height:4px;border-radius:2px;display:inline-block}.spark .ln{fill:none;stroke:var(--c);stroke-width:2}.spark .p{fill:#1e8a4c}.spark .n{fill:#c8372d}
  .two{display:grid;grid-template-columns:1.05fr 1fr;gap:18px}ul{margin:4px 0;padding-left:16px}li{margin:3px 0}
  .profile{border-left:4px solid var(--c);padding:2px 0 4px 10px;margin:6px 0 12px}table.prof td,table.prof th{padding:4px 5px;font-size:11.5px}
  .boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.box{border:1px solid #e3e6ea;border-radius:6px;padding:6px 8px}.box p{margin:2px 0 0;font-size:12px}.bt{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}.box.s .bt{color:#1e8a4c}.box.w .bt{color:#c8372d}.box.a .bt{color:#2f6fdb}.box.d .bt{color:#7a5af5}
  .takes{display:grid;gap:10px;margin-top:8px}.takes.n1{grid-template-columns:1fr}.takes.n2{grid-template-columns:1fr 1fr}.takes.n3{grid-template-columns:1fr 1fr 1fr}.takes.n4{grid-template-columns:1fr 1fr 1fr 1fr}
  .take{border:1px solid #e3e6ea;border-top:4px solid var(--c);border-radius:8px;padding:7px 10px}.take .tk{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#6b7480;font-weight:700}.take .who{font-size:15px;font-weight:700}.take p{margin:3px 0;font-size:12px}
  svg text.ax{font-size:10px;fill:#6b7480}svg line.grid{stroke:#eceff2}svg line.zero{stroke:#9aa3ad;stroke-dasharray:3 3}
  .meth li{font-size:11.5px}.foot{font-size:9.5px;color:#6b7480;margin:6px 0 0}
  .bar{position:sticky;top:0;background:#1b1f24;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:12px;z-index:2}.bar button{font:inherit;padding:5px 12px;border-radius:6px;border:0;background:#fff;color:#1b1f24;font-weight:600;cursor:pointer}@media print{.bar{display:none}}`;
  const title = `${fcs.map((f) => lastName(f.name)).join(", ")} · Outlook ${yrs[0]}–${yrs.at(-1)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>
<div class="bar"><span>${esc(title)} · ${pages.length} pages</span><button onclick="print()">Print or save as PDF</button>${moreThan4 ? `<span>(the first 4 players picked)</span>` : ""}</div>
${pages.join("\n")}</body></html>`;
}
