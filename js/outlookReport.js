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
function projChart(fcs, lastYear, colors, names = [], Hh = 175) {
  const W = 470, L = 44, R = 14, Tp = 8, B = 22;
  // (update 419) as many past seasons as seasons projected, ending with the current one
  const nP = fcs[0].years.length, past = Array.from({ length: nP }, (_, i) => String(Number(lastYear) - nP + 1 + i));
  const cols = [...past, ...fcs[0].years.map((y) => y.year)];
  const pastV = (f, y) => (y === String(lastYear) && f.now ? f.now.total : (f.hist || []).find((h) => String(h.year) === y)?.total ?? null);
  const vals = fcs.flatMap((f) => [...past.map((y) => pastV(f, y)), ...f.years.flatMap((y) => [y.lo, y.hi])]).filter((v) => v != null);
  const hi = Math.max(0.3, ...vals) + 0.1, lo = Math.min(-0.3, ...vals) - 0.1;
  const x = (i) => L + (i * (W - L - R)) / (cols.length - 1), y = (v) => Tp + ((hi - v) * (Hh - Tp - B)) / (hi - lo);
  const ticks = []; for (let t = Math.ceil(lo * 2) / 2; t <= hi; t += 0.5) ticks.push(t);
  let g = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${Math.abs(t) < 1e-9 ? "zero" : "grid"}"/><text x="${L - 6}" y="${y(t) + 3.5}" class="ax" text-anchor="end">${f2(t)}</text>`).join("");
  g += cols.map((c, i) => `<text x="${x(i)}" y="${Hh - 8}" class="ax" text-anchor="middle">${esc(c)}</text>`).join("");
  g += `<line x1="${(x(nP - 1) + x(nP)) / 2}" x2="${(x(nP - 1) + x(nP)) / 2}" y1="${Tp}" y2="${Hh - B}" stroke="#c9ced5" stroke-dasharray="2 3"/><text x="${(x(nP - 1) + x(nP)) / 2 + 4}" y="${Tp + 9}" class="ax">projected →</text>`;
  fcs.forEach((f, k) => {
    const c = colors[k % colors.length];
    const band = f.years.map((yv, i) => `${x(nP + i)},${y(yv.hi)}`).join(" ") + " " + [...f.years].reverse().map((yv, i) => `${x(nP + f.years.length - 1 - i)},${y(yv.lo)}`).join(" ");
    g += `<polygon points="${band}" fill="${c}" opacity="0.10"/>`;
    const hp = past.map((yy, i) => { const v = pastV(f, yy); return v == null ? null : [x(i), y(v)]; }).filter(Boolean);
    const fp = f.years.map((yv, i) => [x(nP + i), y(yv.total)]);
    const join = pastV(f, String(lastYear)) != null ? [[x(nP - 1), y(pastV(f, String(lastYear)))], ...fp] : fp;
    // actual seasons solid with filled dots; the projection dashed with open dots
    if (hp.length > 1) g += `<polyline points="${hp.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2.4"/>`;
    g += `<polyline points="${join.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2.4" stroke-dasharray="6 4"/>`;
    g += hp.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.4" fill="${c}"/>`).join("") + fp.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.4" fill="#fff" stroke="${c}" stroke-width="2"/>`).join("");
  });
  // (update 406) a key: who each line is
  const key = `<div class="legend">${fcs.map((f, k) => `<span><i style="background:${colors[k % colors.length]}"></i>${esc(names[k] || f.name)}</span>`).join("")}<span class="muted">solid: actual · dashed: projected · shaded: likely range</span></div>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="max-width:${W}px" aria-label="Projection chart">${g}</svg>${key}`;
}

/**
 * The report's HTML. opts: { field, detail (optional), fcs (forecastPlayer results, names set), info (the model's
 * summary from js/forecastClient.js: target, lastYear, params, err, ageOk, fieldN, ageAt),
 * ownRounds: (key) → that player's rounds with distances (optional) }
 */
/** (update 416) A player's strokes gained month by month (bars) with a 3-month running average (line). */
function monthChart(rounds, target, color) {
  const by = new Map();
  for (const rd of rounds || []) {
    if (sq(rd.tour) !== sq(target) || !rd.shots?.length || rd.eventLevel) continue;
    const m = /^(\d{4})-(\d{2})/.exec(String(rd.date || "")); if (!m) continue;
    const k = `${m[1]}-${m[2]}`, x = by.get(k) || by.set(k, { s: 0, n: 0 }).get(k);
    x.s += rd.shots.reduce((t, sh) => t + (CATS.includes(sh.cat) ? sh.sg || 0 : 0), 0); x.n++;
  }
  const ms = [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([k, x]) => ({ k, v: x.s / x.n, n: x.n }));
  if (ms.length < 2) return "";
  const W = 1000, Hh = 92, L = 40, R = 8, Tp = 5, B = 20;
  const run = ms.map((_, i) => { let s0 = 0, n0 = 0; for (let j = Math.max(0, i - 2); j <= i; j++) { s0 += ms[j].v * ms[j].n; n0 += ms[j].n; } return s0 / n0; });
  const hi = Math.max(0.5, ...ms.map((x) => x.v)) + 0.2, lo = Math.min(-0.5, ...ms.map((x) => x.v)) - 0.2;
  const bw = (W - L - R) / ms.length, x = (i) => L + bw * (i + 0.5), y = (v) => Tp + ((hi - v) * (Hh - Tp - B)) / (hi - lo);
  const ticks = []; for (let t = Math.ceil(lo); t <= hi; t += 1) ticks.push(t);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const every = Math.max(1, Math.ceil(ms.length / 24));
  let g = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "zero" : "grid"}"/><text x="${L - 5}" y="${y(t) + 3.5}" class="ax" text-anchor="end">${f2(t)}</text>`).join("");
  g += ms.map((m, i) => `<rect x="${(x(i) - bw * 0.38).toFixed(1)}" y="${Math.min(y(m.v), y(0)).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${Math.abs(y(m.v) - y(0)).toFixed(1)}" fill="${m.v >= 0 ? "#2a9d6f" : "#d0574c"}" opacity="0.75"/>`).join("");
  g += `<polyline points="${run.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2.6"/>`;
  g += ms.map((m, i) => (i % every === 0 ? `<text x="${x(i).toFixed(1)}" y="${Hh - 10}" class="ax" text-anchor="middle">${MON[+m.k.slice(5) - 1]} \u2019${m.k.slice(2, 4)}</text>` : "")).join("");
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" aria-label="Month by month">${g}</svg>`;
}

export function buildOutlookReport({ field, detail = null, fcs: fcsIn, info, ownRounds = null, logo = null }) {
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
      const sc = model.params?.age?.scale;
      ageLine = ` At ${Math.floor(f.age)}, the projection ${Math.abs(per) < 0.02 ? "holds them steady for age" : per > 0 ? `adds about ${abs2(per)} a round a season for age` : `takes off about ${abs2(per)} a round a season for age`}${sc != null && sc < 1 ? ` (the age effect at ${Math.round(sc * 100)}% strength, what best predicted past seasons)` : ""}.`;
    } else if (f.age == null) ageLine = " No birth date in the data, so age isn’t taken into account.";
    else if (model.params?.age?.tried) ageLine = ` At ${Math.floor(f.age)}. Age is left out of the projection: it predicted past seasons better without it.`;
    out.lines.speed = sp.trim(); out.lines.age = ageLine.trim(); // (update 419: two boxes)
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
  const pr = model.params;
  const acc = model.err.map((e, i) => (e ? { h: i + 1, mae: e.mae, n: e.n } : null)).filter(Boolean);

  /* ---------- (update 414) the pages: the answer first, then where they stand, each player, and the odds ---------- */
  const pages = [];
  const colorOf = (f) => colors[fcs.indexOf(f) % colors.length];
  const ageTxt = (f) => (ageOf(f) != null ? ` <small>· Age ${ageOf(f)}</small>` : "");
  const cap = (t) => String(t || "").replace(/^./, (ch) => ch.toUpperCase());
  const L1 = (f) => lastOf(f.key);
  // the risks for each player (always at least one: their weakest area when nothing else stands out)
  // (update 418) weaknesses: parts of the game losing strokes to the field over the recent window (the worst one when none is)
  const weakOf = (f) => { const L0 = L1(f); if (!L0) return []; const bad = CATS.filter((c) => L0.v[c] < -0.1).sort((a, b) => L0.v[a] - L0.v[b]).slice(0, 2); const w0 = insight.get(f.key).worst; return bad.length ? bad.map((c) => `${CATN[c]}: ${f2(L0.v[c])} a round`) : w0 ? [`None losing much; weakest is ${CATN[w0]} (${f2(L0.v[w0])})`] : []; };
  // risks: other things that could pull them down, each with what it compares and over what time
  const risksOf = (f) => {
    const L0 = L1(f), FCr = FC?.rows.find((r) => r.key === f.key), out = [], fl = f.flags || {};
    if (FCr?.pctile > 0.6 && FCr.drop != null) out.push(`Stronger fields: ${abs2(FCr.drop)} a round worse than weaker ones, ${FC.years.join("–")}`);
    if (fl.vsUsual != null && fl.vsUsual < -fl.swing) out.push(`${fl.lastYear} vs. own ${fl.usualFrom === fl.usualTo ? fl.usualFrom : `${fl.usualFrom}–${fl.usualTo}`} average: ${f2(fl.lastTot)} vs. ${f2(fl.usualTot)} (${f2(fl.vsUsual)})`);
    if (fl.puttLed && fl.lastPutt != null) out.push(`Putting carried ${fl.lastYear}: ${f2(fl.lastPutt)} of ${f2(fl.lastTot)} a round`);
    if ((L0 && L0.n < 30) || fl.fewRounds) out.push(`Limited data: ${L0?.n ?? fl.lastN ?? 0} rounds, ${win}`);
    const y3 = f.years.at(-1);
    if (f.age != null && model.ageOk && y3.ageAdd <= -0.1) out.push(`Age: about ${f2(y3.ageAdd)} a round by ${y3.year}`);
    if (f.years[0].hi - f.years[0].lo > 1.7) out.push(`Wide ${f.years[0].year} range: ${f2(f.years[0].lo)} to ${f2(f.years[0].hi)}`);
    return out;
  };
  const strengthsOf = (f) => { const L0 = L1(f); if (!L0) return []; const good = CATS.filter((c) => L0.v[c] > 0.005).sort((a, b) => L0.v[b] - L0.v[a]); const b0 = insight.get(f.key).best; return good.length ? good.map((c) => `${CATN[c]}: ${f2(L0.v[c])} a round`) : [`None gaining strokes on the field; closest is ${CATN[b0]} (${f2(L0.v[b0])})`]; };
  const lst = (a) => `<ul class="sr">${a.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  const strHead = `<div class="lab s">Strengths <span class="labq">vs. the field, ${esc(win)}</span></div>`, wkHead = `<div class="lab w">Weaknesses <span class="labq">vs. the field, ${esc(win)}</span></div>`;
  const srBlock = (f) => { const st = strengthsOf(f), wk = weakOf(f), rk = risksOf(f); return `${st.length ? strHead + lst(st) : ""}${wk.length ? wkHead + lst(wk) : ""}${rk.length ? `<div class="lab w">Other risks</div>${lst(rk)}` : ""}`; };

  // the key takeaways (each a label and a sentence)
  const TK = [];
  const nowOrder = [...withL].sort((a, b) => L1(b).v.TOTAL - L1(a).v.TOTAL);
  if (nowOrder.length) { const a = nowOrder[0], b = nowOrder[1]; TK.push(["Best right now", `${nm(a)}: ${f2(L1(a).v.TOTAL)} a round over the ${win} (#${L1(a).rk.TOTAL} on tour)${b ? `, ${abs2(L1(a).v.TOTAL - L1(b).v.TOTAL)} ahead of ${ln(b)}` : ""}.`]); }
  // (update 415) this season so far, as the Stats page has it
  const curY = String(model.lastYear), curS = T.seasons.get(curY);
  const curOrder = fcs.map((f) => [f, curS?.out.get(f.key)]).filter(([, o]) => o?.n).sort((a, b) => b[1].v.TOTAL - a[1].v.TOTAL);
  if (curOrder.length) { const [a, oa] = curOrder[0], b = curOrder[1]; TK.push([`Best in ${curY}`, `${nm(a)}: ${f2(oa.v.TOTAL)} a round this season (#${oa.rk.TOTAL} on tour, ${oa.n} rounds)${b ? `, ${abs2(oa.v.TOTAL - b[1].v.TOTAL)} ahead of ${ln(b[0])}` : ""}.`]); }
  if (fcs.length > 1) TK.push([`Best in ${yrs[0]}`, `${nm(nextBest)}: projected ${f2(nextBest.years[0].total)} (about ${ordinal(nextBest.years[0].rank)} on tour)${odds ? `, best of the ${fcs.length} in ${pct(odds.best[order.indexOf(nextBest)][0])} of simulated seasons` : ""}.`]);
  TK.push([fcs.length > 1 ? "Best over the next three seasons" : "Next three seasons", `${nm(order[0])}: projected ${f2(sum3(order[0]))} a season on average, ${yrs[0]}–${yrs.at(-1)}.`]);
  const tr = fcs.map((f) => [f, f.years.at(-1).total - f.years[0].total]).sort((a, b) => b[1] - a[1]);
  if (tr[0] && tr[0][1] >= 0.05) TK.push(["Rising", `${nm(tr[0][0])}: ${f2(tr[0][0].years[0].total)} in ${yrs[0]} to ${f2(tr[0][0].years.at(-1).total)} by ${yrs.at(-1)}.`]);
  const fall = tr.at(-1);
  if (fall && fall[1] <= -0.05 && fall[0] !== tr[0][0]) { const ad = fall[0].years.at(-1).ageAdd; TK.push(["Fading", `${nm(fall[0])}: ${f2(fall[0].years[0].total)} in ${yrs[0]} to ${f2(fall[0].years.at(-1).total)} by ${yrs.at(-1)}${ad <= -0.1 ? `, mostly age (about ${abs2(ad)} a round)` : ""}.`]); }
  if (withL.length >= 2) { let gap = null; for (const c of CATS) { const s0 = [...withL].sort((x, y) => L1(y).v[c] - L1(x).v[c]), d = L1(s0[0]).v[c] - L1(s0.at(-1)).v[c]; if (!gap || d > gap.d) gap = { c, d, hi: s0[0], lo: s0.at(-1) }; }
    TK.push(["Biggest difference", `${CATN[gap.c]}: ${ln(gap.hi)} ${f2(L1(gap.hi).v[gap.c])} against ${ln(gap.lo)} ${f2(L1(gap.lo).v[gap.c])} a round over the ${win}.`]); }
  if (FC && FC.rows.filter((r) => r.drop != null).length >= 2) { const rs = FC.rows.filter((r) => r.drop != null).sort((a, b) => a.drop - b.drop), hold = fcs.find((x) => x.key === rs[0].key), drop = fcs.find((x) => x.key === rs.at(-1).key);
    TK.push(["Against strong fields", `${ln(hold)} holds up best; ${ln(drop)} gives back the most (${abs2(rs.at(-1).drop)} a round worse than in weaker fields).`]); }

  // the verdict: one card each, in order over the next three seasons
  const roleOf = (f, i) => `${ordinal(i + 1)} over the next three seasons${f === nextBest && fcs.length > 1 ? ` · Best in ${yrs[0]}` : ""}`;
  const verdict = order.map((f, i) => {
    const y1 = f.years[0];
    return `<div class="take" style="--c:${colorOf(f)}"><div class="tk">${esc(roleOf(f, i))}</div><div class="who">${nm(f)}${ageTxt(f)}</div>
      <div class="nums">${(() => { const o = curS?.out.get(f.key); return o?.n ? `<span><b class="${tone(o.v.TOTAL)}">${f2(o.v.TOTAL)}</b> in ${esc(curY)} (#${o.rk.TOTAL}, ${o.n} rds)</span>` : ""; })()}<span><b class="${tone(y1.total)}">${f2(y1.total)}</b> projected in ${esc(yrs[0])} (~${ordinal(y1.rank)})</span><span><b class="${tone(sum3(f))}">${f2(sum3(f))}</b> projected average, ${esc(yrs[0])}–${esc(yrs.at(-1))}</span>${odds ? `<span><b>${pct(odds.best[i][0])}</b> best of the ${fcs.length} in ${esc(yrs[0])} · <b>${pct(odds.best[i].at(-1))}</b> in ${esc(yrs.at(-1))}</span>` : ""}</div>
      ${srBlock(f)}</div>`;
  }).join("");
  const projRows = order.map((f) => `<tr><td><i class="dot" style="background:${colorOf(f)}"></i><b>${ln(f)}</b></td>${f.years.map((y) => `<td><b class="${tone(y.total)}">${f2(y.total)}</b> <small>~${ordinal(y.rank)}</small><br><small>${f2(y.lo)} to ${f2(y.hi)}</small></td>`).join("")}<td><b class="${tone(sum3(f))}">${f2(sum3(f))}</b></td></tr>`).join("");

  // (update 417) the chart grows to the height of the takeaways beside it (about 76 characters a line, 16.75px a line)
  const tkPx = 40 + TK.reduce((t, [l, x]) => t + 4 + 15.4 * Math.ceil((l.length + 2 + String(x).replace(/<[^>]+>/g, "").length) / 79), 0);
  const chartH = Math.round(Math.max(175, Math.min(330, tkPx - 95)));
  // 1 · overview
  pages.push(`<section class="page"><div class="kicker">Player evaluation · Skill and 3-season projection · ${esc(target)} · Data through ${esc(thru)}</div>
    <h1>${fcs.map(ln).join(" · ")}</h1>
    <div class="banner">${esc(headline)}</div>
    <div class="cols c55"><div class="tkbox"><h3>Key takeaways</h3><ol class="tks">${TK.map(([l, t]) => `<li><b>${esc(l)}.</b> ${t}</li>`).join("")}</ol></div>
      <div><h3>Where they’re headed <small>strokes gained a round against an average ${esc(target)} field</small></h3>
        ${projChart(order, model.lastYear, order.map(colorOf), order.map((f) => f.name), chartH)}</div></div>
    <h3 class="vh">The verdict</h3><div class="takes n${order.length}">${verdict}</div></section>`);

  // 2 · side by side: by season, against strong and weak fields, the projection and the odds
  const seasonRows = fcs.map((f) => `<tr><td><i class="dot" style="background:${colorOf(f)}"></i><b>${ln(f)}</b></td>${showYears.map((y) => `<td>${cell(T.seasons.get(y).out.get(f.key), "TOTAL")}</td>`).join("")}<td class="hlc">${cell(L1(f), "TOTAL")}</td></tr>`).join("");
  const fcRows = FC ? FC.rows.map((r) => {
    const f = fcs.find((x) => x.key === r.key), s0 = r.r.strong, w = r.r.weak;
    const label = r.drop == null ? "—" : r.pctile == null ? "" : r.pctile < 0.4 ? "Holds up better" : r.pctile > 0.6 ? "Drops more" : "About typical";
    return `<tr><td><i class="dot" style="background:${colorOf(f)}"></i><b>${ln(f)}</b></td><td>${w.n ? `<span class="${tone(w.tot / w.n)}">${f2(w.tot / w.n)}</span> <small>${w.n} rds</small>` : "—"}</td><td>${s0.n ? `<span class="${tone(s0.tot / s0.n)}">${f2(s0.tot / s0.n)}</span> <small>${s0.n} rds</small>` : "—"}</td><td>${r.drop == null ? "—" : f2(r.drop)}</td><td><b>${label}</b>${r.pctile != null ? ` <small>${ordinal(Math.round(r.pctile * 100))} pct.</small>` : ""}</td></tr>`;
  }).join("") : "";
  const oddsLines = [];
  if (odds) for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) {
    if (i === j) continue;
    const pp = yrs.map((_, h) => odds.ahead(j, i, h));
    if (pp[0] < 0.5 && pp.at(-1) - pp[0] >= 0.08) oddsLines.push(`<b>${ln(order[j])} passes ${ln(order[i])}:</b> ${pp.map(pct).join(" → ")} chance to finish ahead, ${yrs[0]} to ${yrs.at(-1)}.`);
  }
  const topTable = (h) => `<div><h3 class="ctr">Rank probability in ${esc(yrs[h])}</h3><table class="topn"><tr><th></th><th>Top 10</th><th>Top 50</th><th>Top 100</th></tr>${order.map((f) => { const y = f.years[h]; return `<tr><td><i class="dot" style="background:${colorOf(f)}"></i><b>${ln(f)}</b></td><td>${pct(y.top10)}</td><td>${pct(y.top50)}</td><td>${pct(y.top100)}</td></tr>`; }).join("")}</table></div>`;
  pages.push(`<section class="page side${fcs.length >= 4 ? " many" : ""}"><div class="kicker">Side by side</div>
    <div class="cols c50"><div><h3>Strokes gained a round, by season <small>tour rank in brackets · ${esc(WIN)}: ${esc(fromTxt)} to ${esc(thru)}</small></h3>
        <table class="seas"><tr><th></th>${showYears.map((y) => `<th>${esc(yLabel(y))}</th>`).join("")}<th class="hlc">${esc(WIN)}</th></tr>${seasonRows}</table></div>
      <div>${FC ? `<h3>Weaker vs. stronger fields <small>${esc(FC.years.join("–"))} · it’s easier to gain strokes in a weak field${FC.typical ? `; a typical player drops ${abs2(FC.typical.med)} in the stronger half` : ""}</small></h3>
        <table><tr><th></th><th>Weaker fields</th><th>Stronger fields</th><th>Drop</th><th>Vs. other players</th></tr>${fcRows}</table>` : ""}</div></div>
    <div class="cols c55"><div><h3>Projected strokes gained a round <small>against an average ${esc(target)} field · likely range · rank it would mean</small></h3>
        <table class="proj"><tr><th></th>${yrs.map((y) => `<th>${esc(y)}</th>`).join("")}<th>Projected avg</th></tr>${projRows}</table></div>
      <div><h3>Best and worst projected ranks <small>top and bottom of the likely range · out of ~${order[0].years[0].of} ranked a season</small></h3><table class="bw"><tr><th></th>${yrs.map((y) => `<th>${esc(y)}</th>`).join("")}</tr>${order.map((f) => `<tr><td><i class="dot" style="background:${colorOf(f)}"></i><b>${ln(f)}</b></td>${f.years.map((y) => `<td><b>${ordinal(y.rankHi)}</b> to <b>${ordinal(y.rankLo)}</b></td>`).join("")}</tr>`).join("")}</table>
        ${oddsLines.length ? `<ul class="pts">${oddsLines.slice(0, 3).map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}</div></div>
    <div class="cols c3">${yrs.map((_, h) => topTable(h)).join("")}</div></section>`);

  // 3+ · a page for each player: their card and projection, then their numbers
  const sparkLo = Math.min(-0.3, ...fcs.flatMap((f) => insight.get(f.key).sparkVals)), sparkHi = Math.max(0.3, ...fcs.flatMap((f) => insight.get(f.key).sparkVals));
  const spK = (ins) => /Ball Speed|Driving Distance/.test(ins.lines.speed || "");
  for (const f of order) {
    const L = L1(f), ins = insight.get(f.key), i = order.indexOf(f);
    const card = `<div class="card big1 band" style="--c:${colorOf(f)}"><div>
      ${L ? `<div class="bigrow"><div class="big ${tone(L.v.TOTAL)}">${f2(L.v.TOTAL)}</div><div class="bl"><b>${WIN}</b><br>SG total a round · #${L.rk.TOTAL} of ${L.of.TOTAL}<br>${L.n} rounds</div></div>` : `<div class="muted">No rounds in the ${win}</div>`}
      ${L ? `<div class="mix"><span>Ball-striking <b class="${tone(ins.mix.bs)}">${f2(ins.mix.bs)}</b></span><span>Short game <b class="${tone(ins.mix.sh)}">${f2(ins.mix.sh)}</b></span></div>` : ""}
      </div><div>${strHead}${lst(strengthsOf(f))}</div><div>${wkHead}${lst(weakOf(f))}</div><div>${risksOf(f).length ? `<div class="lab w">Other risks</div>${lst(risksOf(f))}` : ""}</div></div>`;
    const proj = `<div><h3>Projection <small>against an average ${esc(target)} field</small></h3><table class="proj"><tr><th></th>${yrs.map((y) => `<th>${esc(y)}</th>`).join("")}</tr>
      <tr><td>Strokes gained a round</td>${f.years.map((y) => `<td><b class="${tone(y.total)}">${f2(y.total)}</b><br><small>${f2(y.lo)} to ${f2(y.hi)}</small></td>`).join("")}</tr>
      <tr><td>Rank it would mean <small>of ~${f.years[0].of}</small></td>${f.years.map((y) => `<td>~${ordinal(y.rank)}</td>`).join("")}</tr>
      ${odds ? `<tr><td>Best of the compared players</td>${odds.best[i].map((p0) => `<td>${pct(p0)}</td>`).join("")}</tr>` : ""}
      <tr><td>Best and worst rank</td>${f.years.map((y) => `<td>${ordinal(y.rankHi)} to ${ordinal(y.rankLo)}</td>`).join("")}</tr>
      <tr><td>Top 10 / 50 / 100 season</td>${f.years.map((y) => `<td>${pct(y.top10)} / ${pct(y.top50)} / ${pct(y.top100)}</td>`).join("")}</tr></table></div>`;
    const rows = [...showYears.map((y) => [yLabel(y), T.seasons.get(y).out.get(f.key)]), [WIN, L]].filter(([, o]) => o);
    const tbl = `<table class="prof"><tr><th>Season</th><th>Rds</th><th>Total</th>${CATS.map((c) => `<th>${CATS_SHORT[c]}</th>`).join("")}${teeCols.map((k) => `<th>${esc(statDef(k).label)}${k === "ballSpeed" ? " (Driver)" : ""}</th>`).join("")}</tr>
      ${rows.map(([lab, o]) => `<tr${lab === WIN ? ' class="hl"' : ""}><td>${esc(lab)}</td><td>${o.n}</td><td>${cell(o, "TOTAL")}</td>${CATS.map((c) => `<td>${cell(o, c)}</td>`).join("")}${teeCols.map((k) => `<td>${statCell(o, k)}</td>`).join("")}</tr>`).join("")}</table>`;
    const box = (cls, title, txt) => (txt ? `<div class="box ${cls}"><div class="bt">${title}</div><p>${esc(txt)}</p></div>` : "");
    pages.push(`<section class="page player" style="--c:${colorOf(f)}"><div class="kicker">Player profile · ${esc(roleOf(f, i))}</div>
      <h1>${nm(f)}${ageOf(f) != null ? ` <span class="agebig">Age ${ageOf(f)}</span>` : ""}</h1>
      <div class="pbody">${card}
      <div class="cols c64">${proj}<div class="boxes b2">${box("s", "Strength", ins.lines.strength)}${box("w", "Watch", ins.lines.watch)}${box("p", "Speed", ins.lines.speed)}${box("a", "Age", ins.lines.age)}${box(`d${ins.lines.speed && ins.lines.age ? " wide" : ""}`, `By distance (${win})`, ins.lines.dist)}</div></div>
      <div><h3>By season <small>strokes gained a round, tour rank in brackets</small></h3>${tbl}</div>
      ${(() => { const mc = monthChart(field.find((p) => p.key === f.key)?.rounds, target, colorOf(f)); return mc ? `<div><h3>Month by month <small>strokes gained a round on ${esc(target)} · <span style="color:#2a9d6f">■</span> above average · <span style="color:#d0574c">■</span> below · <i class="runkey" style="background:${colorOf(f)}"></i> 3-month running average</small></h3>${mc}</div>` : ""; })()}</div></section>`);
  }

  // (update 416) Callaway Tour Analytics on every page
  const brand = `<div class="brandbar">${logo ? `<img src="${logo}" alt="">` : ""}<span>Callaway Tour Analytics</span></div>`;
  for (let k = 0; k < pages.length; k++) pages[k] = pages[k].replace(/^(<section class="[^"]*"[^>]*>)<div class="kicker">([\s\S]*?)<\/div>/, (m0, a, kick) => `${a}<div class="brandbar">${logo ? `<img src="${logo}" alt="">` : ""}<span>Callaway Tour Analytics</span><em>${kick}</em></div>`);
  const css = `@page{size:letter landscape;margin:0.35in}*{box-sizing:border-box}body{font:12.5px/1.4 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#1b1f24;margin:0;background:#fff}
  .page{page-break-after:always;break-after:page;padding:4px 2px;position:relative}.page:last-child{page-break-after:auto;break-after:auto}
  @media screen{body{background:#eef1f5}.page{background:#fff;width:11in;min-height:8.5in;margin:16px auto;padding:0.35in;box-shadow:0 2px 10px rgba(0,0,0,.12)}}
  .kicker{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#6b7480;font-weight:600}
  h1{font-size:28px;margin:2px 0 6px;letter-spacing:-.01em}h2{font-size:16px;margin:4px 0 4px}h2.h{font-size:20px;margin:2px 0 8px}h2 small,.who small{font-weight:400;color:#6b7480;font-size:12px}
  h3{font-size:12.5px;margin:8px 0 4px}h3 small{font-weight:400;color:#6b7480;font-size:10.5px;margin-left:4px}h3.vh{margin-top:10px}
  .muted{color:#6b7480}small{font-size:10px;color:#6b7480}.pos{color:#1e8a4c}.neg{color:#c8372d}
  .banner{background:#1b1f24;color:#fff;border-radius:8px;padding:8px 14px;font-size:17px;font-weight:700;margin:2px 0 6px}
  .cols{display:grid;gap:18px}.c55{grid-template-columns:1.1fr 1fr}.c50{grid-template-columns:1fr 1fr}
  .tkbox{background:#f4f7fb;border-radius:8px;padding:6px 12px 8px}.tks{margin:4px 0 0;padding-left:18px}.tks li{margin:3px 0;font-size:12.5px;line-height:1.34}.tks b{color:#1b1f24}
  table{border-collapse:collapse;width:100%;margin:2px 0 6px}th,td{border-bottom:1px solid #e3e6ea;padding:4px 6px;text-align:right;vertical-align:top}th{font-size:10px;color:#4a535e;font-weight:600;text-transform:uppercase;letter-spacing:.03em}th:first-child,td:first-child{text-align:left}tr.hl td,td.hlc,th.hlc{background:#f4f7fb;font-weight:600}tr.muted td{color:#6b7480}
  table.proj td{padding:5px 6px}table.topn td,table.topn th{padding:3px 4px;font-size:11px}table.topn th.yc{text-align:center;border-bottom:0}table.topn tr.sub th{font-size:9px}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}
  .cards{display:grid;gap:10px;margin:4px 0 8px}.cards.n1{grid-template-columns:1fr}.cards.n2{grid-template-columns:1fr 1fr}.cards.n3{grid-template-columns:1fr 1fr 1fr}.cards.n4{grid-template-columns:1fr 1fr 1fr 1fr}
  .card{border:1px solid #e3e6ea;border-top:4px solid var(--c);border-radius:8px;padding:8px 10px}.card .who{font-weight:700;font-size:14px}.bigrow{display:flex;align-items:center;gap:10px;margin-top:2px}.card .big{font-size:30px;font-weight:800;line-height:1}.bl{font-size:10.5px;color:#4a535e;line-height:1.3}.card p{margin:4px 0 0;font-size:12px}
  .mix{display:flex;gap:12px;font-size:11.5px;margin:2px 0}.spark{display:block;margin:4px 0;max-width:100%}.spark .zero{stroke:#b9c0c8;stroke-dasharray:3 3}.spark text.ax{font-size:9.5px;fill:#6b7480}.spark .ln{fill:none;stroke:var(--c);stroke-width:2}.spark .p{fill:#1e8a4c}.spark .n{fill:#c8372d}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;margin:2px 0 4px}.legend span{display:inline-flex;align-items:center;gap:5px}.legend i{width:14px;height:4px;border-radius:2px;display:inline-block}
  ul.pts{margin:4px 0;padding-left:16px}ul.pts li{margin:4px 0;font-size:12.5px}
  .profile{border-left:4px solid var(--c);padding:1px 0 1px 10px;margin:2px 0 10px}.ph{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.ph .pl{color:#4a535e;font-size:12px}table.prof td,table.prof th{padding:2px 5px;font-size:11px}
  .boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.box{border:1px solid #e3e6ea;border-radius:6px;padding:5px 8px}.box p{margin:1px 0 0;font-size:11px;line-height:1.3}.bt{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}.box.s .bt{color:#1e8a4c}.box.w .bt{color:#c8372d}.box.a .bt{color:#2f6fdb}.box.d .bt{color:#7a5af5}
  .takes{display:grid;gap:10px}.takes.n1{grid-template-columns:1fr}.takes.n2{grid-template-columns:1fr 1fr}.takes.n3{grid-template-columns:1fr 1fr 1fr}.takes.n4{grid-template-columns:1fr 1fr 1fr 1fr}
  .take{border:1px solid #e3e6ea;border-top:4px solid var(--c);border-radius:8px;padding:7px 10px}.take .tk{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#6b7480;font-weight:700}.take .who{font-size:15px;font-weight:700}
  .take .nums{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;margin:3px 0 4px;color:#4a535e}.take .nums b{font-size:13px}.take p{margin:3px 0;font-size:12px}.lab{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;margin-right:4px}.lab.s{color:#1e8a4c}.lab.w{color:#c8372d}
  .block{margin:2px 0 10px}.meth{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 16px;font-size:12px}.meth div{background:#f4f7fb;border-radius:6px;padding:7px 9px}.keep{margin-top:8px;font-size:12px;border-left:3px solid #c8372d;padding:4px 10px}
  svg text.ax{font-size:10px;fill:#6b7480}svg line.grid{stroke:#eceff2}svg line.zero{stroke:#9aa3ad;stroke-dasharray:3 3}
  .brandbar{display:flex;align-items:center;gap:10px;background:#111418;color:#fff;border-radius:6px;padding:5px 12px;margin:0 0 8px}.brandbar img{height:22px;width:auto}.brandbar span{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.brandbar em{margin-left:auto;font-style:normal;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#b9c0c8}
  .agebig{font-size:20px;font-weight:500;color:#4a535e;text-transform:none;letter-spacing:0;margin-left:8px}
  .side h3{font-size:13.5px;margin:10px 0 5px}.side td,.side th{padding:6px 8px;font-size:13px}.side th{font-size:11px}.side small{font-size:10.5px}.side table.seas td,.side table.seas th{font-size:12.5px;padding:7px 5px}.side table.seas small{font-size:10px}.side table.topn td,.side table.topn th{font-size:13.5px;padding:7px 8px}.side ul.pts li{font-size:12.5px}.side.many h3{margin:8px 0 4px;font-size:12.5px}.side.many td,.side.many th{padding:4px 6px;font-size:12px}.side.many table.seas td,.side.many table.seas th{padding:4px 4px;font-size:11.5px}.side.many table.topn td,.side.many table.topn th{padding:4px 6px;font-size:12px}.side.many ul.pts li{font-size:11.5px;margin:2px 0}.side .cols{gap:22px;margin-bottom:4px}
  table.seas td,table.seas th{white-space:nowrap;padding:4px 4px;font-size:11.5px}table.seas small{font-size:9px}
  h1,h2,h3{text-transform:uppercase;letter-spacing:.04em}h1 small,h2 small,h3 small{text-transform:none;letter-spacing:0}h3{font-size:12px}
  .c3{grid-template-columns:1fr 1fr 1fr}.c40{grid-template-columns:0.85fr 1.15fr;align-items:start}
  .lab{display:block;font-size:9.5px;font-weight:700;margin:6px 0 1px}ul.sr{margin:0 0 1px;padding-left:15px}ul.sr li{font-size:11.5px;margin:0;line-height:1.3}.take .lab{margin:3px 0 0}.take .nums{margin:2px 0 2px}.sr2{gap:14px;margin-top:4px}
  .card.big1 .big{font-size:40px}.card.big1 .bl{font-size:12px}.card.big1 p{font-size:13px}.card.big1 .spark{width:100%;height:auto}.card.big1 .mix{font-size:13px}
  .player table.prof td,.player table.prof th{padding:1px 6px;font-size:11.5px}.player table.proj td{padding:3px 6px}.player ul.sr li{font-size:11.5px}.player .boxes .box{padding:4px 8px}.player .boxes .box p{font-size:11px;line-height:1.25}.player h1{font-size:26px;margin:0 0 6px}.player h3{margin:6px 0 3px}.player .card{border-top-width:5px}
  .player{display:flex;flex-direction:column}.pbody{flex:1;display:flex;flex-direction:column;justify-content:space-between;gap:6px}@media print{.player{height:7.7in}}@media screen{.player{height:8.5in}}
  .card.band{display:grid;grid-template-columns:1.1fr 1fr 1fr 1.2fr;gap:18px;align-items:start;padding:10px 14px}.card.band .lab{margin-top:2px}.boxes.b2{grid-template-columns:1fr 1fr;align-content:start;margin-top:6px}.c64{grid-template-columns:1.35fr 1fr}.player table.proj td{white-space:nowrap}.player table.proj td:first-child{white-space:normal}.side td:last-child{white-space:nowrap}.box.p .bt{color:#d0861c}.boxes.b2 .box.wide{grid-column:1/-1}.runkey{display:inline-block;width:18px;height:3px;border-radius:2px;vertical-align:3px;margin-right:2px}.card .sr2{margin-top:8px}.card.big1 ul.sr li{font-size:12px}
  .tks li{font-size:12px;line-height:1.28;margin:2px 0}.take ul.sr li{font-size:11px;line-height:1.25}.take .lab{margin:2px 0 0}.take{padding:6px 9px}h3.vh{margin-top:6px}
  .labq{text-transform:none;letter-spacing:0;font-weight:400;color:#6b7480;margin-left:3px}
  .side .cols{gap:40px}.side .cols.c3{gap:56px}.side td:first-child{white-space:nowrap}.side td small{white-space:nowrap}.side table{margin-bottom:10px}.side td,.side th{padding:6px 5px}.side h3.ctr{text-align:center}.side table.topn td:not(:first-child),.side table.topn th:not(:first-child){text-align:center}
  .bar{position:sticky;top:0;background:#1b1f24;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:12px;z-index:2}.bar button{font:inherit;padding:5px 12px;border-radius:6px;border:0;background:#fff;color:#1b1f24;font-weight:600;cursor:pointer}@media print{.bar{display:none}}`;
  const title = `${fcs.map((f) => lastName(f.name)).join(", ")} · Outlook ${yrs[0]}–${yrs.at(-1)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>
<div class="bar"><span>${esc(title)} · ${pages.length} pages</span><button id="printBtn" onclick="print()">Print or save as PDF</button>${moreThan4 ? `<span>(the first 4 players picked)</span>` : ""}</div>
${pages.join("\n")}</body></html>`;
}
