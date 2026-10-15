// The Watchlist / Home page's numbers (update 164): for one player, against the field on their tour, for a period —
//   · strokes gained a round (Total, OTT, APP, ARG, PUTT) with ranks and the trend (last 10 rounds vs the 10 before)
//   · their 3 best and 3 worst distances (strokes gained a shot, ranked when the field's lie / distance detail is here)
//   · any other metrics picked, with ranks and trends
//   · badges and alerts: big moves, hot streaks and slumps, form landmarks, best rounds, wins and milestones
import { CATEGORIES, applyFilters, statRounds, statAgg, statDef, statsIn, fmtStat, fmtSG, defaultMinRounds } from "./sg.js";

export const SG_KEYS = [["TOTAL", "SG: Total", "Total"], ["OTT", "Off-the-Tee", "OTT"], ["APP", "Approach", "APP"], ["ARG", "Around-the-Green", "ARG"], ["PUTT", "Putting", "PUTT"]];
const CAT_SHORT = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
const sum = (a) => a.reduce((t, x) => t + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
const sgOf = (rd, cat = null) => rd.shots.reduce((t, s) => t + (!cat || cat === "TOTAL" || s.cat === cat || (cat === "T2G" && s.cat !== "PUTT") ? s.sg : 0), 0);
export const perRound = (rs, cat = null) => (rs.length ? sum(rs.map((rd) => sgOf(rd, cat))) / rs.length : null);

/** The period's filter: this season (the latest year in the data), the last 6 months, or everything. */
export function periodFilter(period, rounds) {
  if (period === "l6" || period === "l12") return { months: 6 }; // (update 167: Last 6 months; an old "l12" pick lands here)
  if (period === "all") return {};
  const years = [...new Set(rounds.map((r) => r.year).filter(Boolean))].sort();
  return years.length ? { year: [years.at(-1)] } : {};
}
export const PERIODS = [["season", "Season"], ["l6", "Last 6 months"], ["all", "All"]];

/** The tour a player plays most (their numbers are ranked against that tour). */
const mainTour = (rounds) => { const m = new Map(); for (const r of rounds) m.set(r.tour || "", (m.get(r.tour || "") || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; };

/** Rank of key among values (Map key → number); higher is better unless told otherwise. */
function rankOf(values, key, higher = true) {
  const list = [...values].filter(([, v]) => v != null && Number.isFinite(v)).sort((a, b) => (higher ? b[1] - a[1] : a[1] - b[1]));
  const i = list.findIndex(([k]) => k === key);
  if (i < 0) return { rank: null, of: list.length };
  const v = list[i][1];
  const tie = list.findIndex(([, x]) => Math.abs(x - v) < 1e-9); // (ties share the better rank)
  return { rank: tie + 1, of: list.length, avg: mean(list.map(([, x]) => x)) };
}

/** Last n rounds against the n before (n up to 10, at least 3). */
function trendOf(ordered, value) {
  const n = Math.min(10, Math.floor(ordered.length / 2));
  if (n < 3) return null;
  const last = value(ordered.slice(-n)), prev = value(ordered.slice(-2 * n, -n));
  return last == null || prev == null ? null : { n, last, prev, ch: last - prev };
}

/** Each tournament: the players who played its most rounds, best strokes gained a round first. */
function eventsOf(players) {
  const ev = new Map();
  for (const p of players) for (const rd of p.rounds) {
    if (!rd.event) continue;
    const k = `${rd.event}|${rd.year}`;
    const e = ev.get(k) || ev.set(k, { event: rd.event, year: rd.year, end: rd.date, by: new Map() }).get(k);
    if (String(rd.date) > String(e.end)) e.end = rd.date;
    (e.by.get(p.key) || e.by.set(p.key, []).get(p.key)).push(rd);
  }
  return [...ev.values()].map((e) => {
    const most = Math.max(...[...e.by.values()].map((rs) => rs.length));
    const ranked = [...e.by].filter(([, rs]) => rs.length >= most).map(([key, rs]) => ({ key, v: perRound(rs) })).sort((a, b) => b.v - a.v);
    return { ...e, ranked };
  }).sort((a, b) => String(a.end).localeCompare(String(b.end)));
}

/** The metrics that can be added (beyond the five strokes gained), from what the data has. */
export function metricCatalog(field, own = []) {
  const all = [...field.flatMap((p) => p.rounds), ...own.flatMap((p) => p.rounds)];
  const stats = statsIn([all]).filter((k) => k !== "sg");
  const dists = new Map();
  for (const p of own) for (const rd of p.rounds) for (const s of rd.shots) if (s.dist) dists.set(`${s.cat}|${s.dist}`, { cat: s.cat, dist: s.dist });
  const catOrder = (c) => CATEGORIES.findIndex(([k]) => k === c);
  return [
    { group: "Strokes gained", items: [["sg:T2G", "SG: Tee to Green"], ["sg:sd", "Steadiness (round-to-round swing)"], ["sg:best", "Best round"]] },
    { group: "Results", items: [["res:wins", "Wins"], ["res:top10", "Top 10s"], ["res:rounds", "Rounds played"]] },
    stats.length ? { group: "Stats", items: stats.map((k) => [`stat:${k}`, statDef(k).label]) } : null,
    dists.size ? { group: "Distances (strokes gained a shot)", items: [...dists.values()].sort((a, b) => catOrder(a.cat) - catOrder(b.cat) || String(a.dist).localeCompare(String(b.dist), undefined, { numeric: true })).map((d) => [`dist:${d.cat}|${d.dist}`, `${CAT_SHORT[d.cat] || d.cat} · ${d.dist}`]) } : null,
  ].filter(Boolean);
}
export const metricLabel = (id) => {
  if (id.startsWith("stat:")) return statDef(id.slice(5)).label;
  if (id.startsWith("dist:")) { const [c, ...d] = id.slice(5).split("|"); return `${CAT_SHORT[c] || c} · ${d.join("|")}`; }
  return { "sg:T2G": "SG: Tee to Green", "sg:sd": "Steadiness", "sg:best": "Best round", "res:wins": "Wins", "res:top10": "Top 10s", "res:rounds": "Rounds played" }[id] || id;
};

/**
 * One player's card. field: everyone's rounds (the shared summary, or full detail); detail: the field with lie /
 * distance detail (for distance ranks), or null; own: this player's full rounds (lie / distance), or null.
 */
export function playerCard(key, { field, detail = null, own = null, label = "", period = "season", metrics = [] }) {
  const me0 = field.find((p) => p.key === key);
  const srcAll = own?.length ? own : me0?.rounds || [];
  const mineAll = srcAll.filter((rd) => rd.shots.length);
  if (!mineAll.length) return { key, label, empty: true };
  const tour = mainTour(mineAll);
  const f = { ...periodFilter(period, mineAll), tour: tour ? [tour] : [] };
  const sgOnly = (rs) => statRounds(rs, "sg");
  const mine = applyFilters(sgOnly(mineAll), f).sort(byDate);
  // the field on the same tour and period (this player with their full rounds)
  const fieldF = field.map((p) => ({ key: p.key, rounds: p.key === key ? mine : applyFilters(sgOnly(p.rounds), f) })).filter((p) => p.rounds.length);
  if (!fieldF.some((p) => p.key === key) && mine.length) fieldF.push({ key, rounds: mine });
  const most = Math.max(0, ...fieldF.map((p) => p.rounds.length));
  const minR = most >= 15 ? defaultMinRounds(most) : Math.max(1, Math.floor(most * 0.33));
  const ranked = fieldF.filter((p) => p.rounds.length >= minR || p.key === key);
  const card = { key, label, tour, rounds: mine.length, minR, of: ranked.length, period, sg: [], dists: { best: [], worst: [] }, metrics: [], badges: [], alerts: [], spark: [] };
  if (!mine.length) return { ...card, empty: true };

  // ---- the five strokes gained ----
  for (const [k, l, short] of SG_KEYS) {
    const vals = new Map(ranked.map((p) => [p.key, perRound(p.rounds, k)]));
    const r = rankOf(vals, key);
    card.sg.push({ k, label: l, short, v: vals.get(key), rank: r.rank, of: r.of, avg: r.avg, trend: trendOf(mine, (rs) => perRound(rs, k)) });
  }
  const total = card.sg[0];
  card.spark = mine.map((_, i) => perRound(mine.slice(Math.max(0, i - 9), i + 1)));

  // ---- distances: strokes gained a shot by category and distance (enough attempts to mean something) ----
  const MIN_ATT = 8;
  const bucketsOf = (rounds) => { const m = new Map(); for (const rd of rounds) for (const s of rd.shots) if (s.dist) { const b = `${s.cat}|${s.dist}`; const o = m.get(b) || m.set(b, { sg: 0, w: 0 }).get(b); o.sg += s.sg; o.w += s.w; } return m; };
  const minePeriod = own?.length ? applyFilters(sgOnly(own), f) : mine;
  const myB = bucketsOf(minePeriod);
  const fieldB = detail?.length ? detail.map((p) => ({ key: p.key, b: p.key === key ? myB : bucketsOf(applyFilters(sgOnly(p.rounds), f)) })) : null;
  const dl = [...myB].filter(([, o]) => o.w >= MIN_ATT).map(([b, o]) => {
    const [cat, ...d] = b.split("|"), v = o.sg / o.w;
    let r = { rank: null, of: 0, avg: null };
    if (fieldB) r = rankOf(new Map(fieldB.map((p) => { const x = p.b.get(b); return [p.key, x && x.w >= MIN_ATT ? x.sg / x.w : null]; })), key);
    return { id: b, cat, dist: d.join("|"), label: `${CAT_SHORT[cat] || cat} · ${d.join("|")}`, v, n: Math.round(o.w), rank: r.rank, of: r.of, avg: r.avg };
  });
  // best and worst: by rank when the field's detail is here, else against the baseline
  const score = (x) => (x.rank && x.of > 1 ? 1 - (x.rank - 1) / (x.of - 1) : null);
  const sorted = [...dl].sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0) || b.v - a.v);
  card.dists.best = sorted.slice(0, 3);
  card.dists.worst = sorted.slice(Math.max(3, sorted.length - 3)).reverse(); // (never the same as the best)

  // ---- results: wins and top 10s (best strokes gained a round at a tournament, among those who played every round) ----
  const events = eventsOf(ranked.map((p) => ({ key: p.key, rounds: p.rounds })));
  const finishes = events.map((e) => ({ e, i: e.ranked.findIndex((x) => x.key === key) })).filter((x) => x.i >= 0);
  const wins = finishes.filter((x) => x.i === 0), top10 = finishes.filter((x) => x.i < 10);

  // ---- the metrics picked ----
  for (const id of metrics) {
    let v = null, r = { rank: null, of: 0 }, trend = null, fmt = (x) => (x == null ? "—" : fmtSG(x)), higher = true;
    if (id === "sg:T2G") { const vals = new Map(ranked.map((p) => [p.key, perRound(p.rounds, "T2G")])); v = vals.get(key); r = rankOf(vals, key); trend = trendOf(mine, (rs) => perRound(rs, "T2G")); }
    else if (id === "sg:sd") {
      const swing = (rs) => sd(rs.map((rd) => sgOf(rd)));
      const vals = new Map(ranked.filter((p) => p.rounds.length >= 8 || p.key === key).map((p) => [p.key, swing(p.rounds)]));
      v = vals.get(key); r = rankOf(vals, key, false); higher = false; fmt = (x) => (x == null ? "—" : `±${x.toFixed(2)}`);
      trend = trendOf(mine, swing);
    } else if (id === "sg:best") { const vals = new Map(ranked.map((p) => [p.key, Math.max(...p.rounds.map((rd) => sgOf(rd)))])); v = vals.get(key); r = rankOf(vals, key); }
    else if (id === "res:wins" || id === "res:top10") {
      const counts = new Map(ranked.map((p) => [p.key, 0]));
      for (const e of events) e.ranked.slice(0, id === "res:wins" ? 1 : 10).forEach((x) => counts.set(x.key, (counts.get(x.key) || 0) + 1));
      v = counts.get(key) || 0; r = v ? rankOf(new Map([...counts].filter(([, n]) => n > 0)), key) : { rank: null, of: 0 }; fmt = (x) => String(x ?? 0); // (no rank for none)
    } else if (id === "res:rounds") { v = mine.length; r = rankOf(new Map(fieldF.map((p) => [p.key, p.rounds.length])), key); fmt = (x) => String(x ?? 0); }
    else if (id.startsWith("stat:")) {
      const k = id.slice(5), def = statDef(k); higher = def.higher !== false;
      const val = (rs) => statAgg(statRounds(rs, k), false).value;
      const statAll = (rs) => applyFilters(statRounds(rs, k), f);
      const myS = statAll(srcAll).sort(byDate);
      const vals = new Map(field.map((p) => [p.key, p.key === key ? val(myS) : (() => { const rs = statAll(p.rounds); return rs.length >= Math.max(1, minR) ? val(rs) : null; })()]));
      v = vals.get(key); r = rankOf(vals, key, higher); fmt = (x) => fmtStat(def, x);
      trend = trendOf(myS, val);
      if (def.higher == null) higher = null;
    } else if (id.startsWith("dist:")) {
      const b = id.slice(5), x = dl.find((d) => d.id === b) || (() => { const o = myB.get(b); return o ? { v: o.sg / o.w, rank: null, of: 0 } : null; })();
      v = x?.v ?? null; r = { rank: x?.rank ?? null, of: x?.of ?? 0 }; fmt = (y) => (y == null ? "—" : `${y >= 0 ? "+" : "−"}${Math.abs(y).toFixed(3)}`);
      trend = trendOf(minePeriod.sort(byDate), (rs) => { const o = bucketsOf(rs).get(b); return o && o.w >= 3 ? o.sg / o.w : null; });
    }
    card.metrics.push({ id, label: metricLabel(id), v, text: fmt(v), rank: r.rank, of: r.of, trend, higher, fmtCh: (ch) => (id.startsWith("stat:") ? fmtStat({ ...statDef(id.slice(5)), pct: false, unit: statDef(id.slice(5)).pct ? " pts" : statDef(id.slice(5)).unit }, Math.abs(ch)) : id.startsWith("dist:") ? Math.abs(ch).toFixed(3) : Math.abs(ch).toFixed(2)) });
  }

  // ---- badges and alerts ----
  const badges = card.badges, alerts = card.alerts;
  const add = (b) => { badges.push(b); if (b.alert) alerts.push({ ...b, key, label }); };
  const lastRound = mine.at(-1), last5 = mine.slice(-5), rs = mine.map((rd) => sgOf(rd));
  // streaks: straight rounds gaining (or losing) on the field, up to the latest
  let run = 0; const sign = Math.sign(rs.at(-1) || 0);
  for (let i = rs.length - 1; i >= 0 && Math.sign(rs[i]) === sign && sign !== 0; i--) run++;
  const avg5 = last5.length === 5 ? perRound(last5) : null;
  if ((sign > 0 && run >= 5) || (avg5 != null && avg5 >= 1.5)) add({ kind: "hot", icon: "🔥", tone: "up", text: run >= 5 && sign > 0 ? `Hot streak · ${run} straight rounds gaining` : `Hot streak · ${fmtSG(avg5)} a round, last 5`, alert: true, sev: 3 });
  if ((sign < 0 && run >= 5) || (avg5 != null && avg5 <= -1.5)) add({ kind: "cold", icon: "🧊", tone: "down", text: run >= 5 && sign < 0 ? `Slump · ${run} straight rounds losing` : `Slump · ${fmtSG(avg5)} a round, last 5`, alert: true, sev: 3 });
  // big moves: the last 10 against the 10 before
  if (total.trend && Math.abs(total.trend.ch) >= 0.75) add({ kind: total.trend.ch > 0 ? "up" : "down", icon: total.trend.ch > 0 ? "⬆" : "⬇", tone: total.trend.ch > 0 ? "up" : "down", text: `Big move · ${total.trend.ch > 0 ? "up" : "down"} ${Math.abs(total.trend.ch).toFixed(2)} a round, last ${total.trend.n} vs previous ${total.trend.n}`, alert: true, sev: 2 });
  for (const s of card.sg.slice(1)) if (s.trend && Math.abs(s.trend.ch) >= 0.5) add({ kind: s.trend.ch > 0 ? "up" : "down", icon: s.trend.ch > 0 ? "↗" : "↘", tone: s.trend.ch > 0 ? "up" : "down", text: `${s.label} ${s.trend.ch > 0 ? "up" : "down"} ${Math.abs(s.trend.ch).toFixed(2)}`, alert: true, sev: 1 });
  // form landmarks: the rolling 10-round average at its best (or worst) of the period
  const rolls = mine.length >= 20 ? mine.map((_, i) => (i >= 9 ? perRound(mine.slice(i - 9, i + 1)) : null)).filter((x) => x != null) : [];
  if (rolls.length >= 5) {
    const now = rolls.at(-1);
    const avgRoll = mean(rolls);
    if (now >= Math.max(...rolls) - 1e-9 && now - avgRoll >= 0.3) add({ kind: "best", icon: "⛰", tone: "up", text: `Best form of the ${period === "season" ? "season" : "period"} · ${fmtSG(now)} over the last 10`, alert: true, sev: 2 });
    else if (now <= Math.min(...rolls) + 1e-9 && avgRoll - now >= 0.3) add({ kind: "low", icon: "⚠", tone: "down", text: `Lowest form of the ${period === "season" ? "season" : "period"} · ${fmtSG(now)} over the last 10`, alert: true, sev: 2 });
  }
  // best rounds: a career-best (everything in the data) or season-best round in their last 3
  const careerRs = sgOnly(mineAll).filter((rd) => !tour || rd.tour === tour || !rd.tour);
  const careerBest = Math.max(...careerRs.map((rd) => sgOf(rd)));
  const recent = mine.slice(-3);
  const top = recent.reduce((b, rd) => (sgOf(rd) > sgOf(b) ? rd : b), recent[0]);
  if (top && careerRs.length >= 20 && sgOf(top) >= careerBest - 1e-9) add({ kind: "career", icon: "⭐", tone: "gold", text: `Career-best round · ${fmtSG(sgOf(top))} at ${top.event || "a tournament"}`, alert: true, sev: 4 });
  else if (top && mine.length >= 10 && sgOf(top) >= Math.max(...rs) - 1e-9) add({ kind: "season", icon: "✨", tone: "gold", text: `${period === "season" ? "Season" : "Period"}-best round · ${fmtSG(sgOf(top))} at ${top.event || "a tournament"}`, alert: true, sev: 2 });
  // wins and milestones
  const lastEvent = events.at(-1);
  if (wins.length && lastEvent && wins.at(-1).e === lastEvent) add({ kind: "win", icon: "🏆", tone: "gold", text: `Led the field at ${lastEvent.event}`, alert: true, sev: 5 });
  if (wins.length >= 2) add({ kind: "wins", icon: "🏆", tone: "gold", text: `${wins.length} wins ${period === "season" ? "this season" : "in this period"}` });
  if (top10.length >= 5) add({ kind: "top10", icon: "🎯", tone: "gold", text: `${top10.length} top 10s` });
  const crossed = (n, step) => { const prev = n - 5; for (let m = step; m <= n; m += step) if (m > prev) return m; return null; }; // (a round count passed in the last 5)
  const sm = crossed(mine.length, 25);
  if (sm) add({ kind: "milestone", icon: "📍", tone: "", text: `${sm} rounds ${period === "season" ? "this season" : "in this period"}`, alert: true, sev: 1 });
  const cm = crossed(careerRs.length, 100);
  if (cm) add({ kind: "milestone", icon: "🎖", tone: "gold", text: `${cm} career rounds in the data`, alert: true, sev: 2 });
  // ranks: the top 10, number 1 in a category, and big climbs (against where they stood 10 rounds ago)
  if (total.rank === 1) add({ kind: "rank", icon: "🥇", tone: "gold", text: "No. 1 in SG: Total" });
  else if (total.rank && total.rank <= 10) add({ kind: "rank", icon: "🔟", tone: "gold", text: `Top 10 in SG: Total (${ordinal(total.rank)})` });
  const firsts = card.sg.slice(1).filter((s) => s.rank === 1).map((s) => s.label);
  if (firsts.length) add({ kind: "rank", icon: "🥇", tone: "gold", text: `No. 1 in ${firsts.length > 2 ? `${firsts.slice(0, -1).join(", ")} and ${firsts.at(-1)}` : firsts.join(" and ")}` });
  if (mine.length >= 20 && lastRound) {
    const cut = mine.at(-11)?.date;
    if (cut) {
      const before = new Map(ranked.map((p) => [p.key, perRound(p.rounds.filter((rd) => String(rd.date) <= String(cut)))]).filter(([, v]) => v != null));
      const was = rankOf(before, key).rank;
      if (was && total.rank && Math.abs(was - total.rank) >= 10) add({ kind: total.rank < was ? "up" : "down", icon: total.rank < was ? "⬆" : "⬇", tone: total.rank < was ? "up" : "down", text: `${total.rank < was ? "Up" : "Down"} ${Math.abs(was - total.rank)} spots to ${ordinal(total.rank)} in SG: Total`, alert: true, sev: 3 });
    }
  }
  card.latest = lastRound ? { date: lastRound.date, event: lastRound.event, sg: sgOf(lastRound) } : null;
  return card;
}
export const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
