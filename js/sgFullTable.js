// (sgDashboard split) The full stats table (and, inside it, Hypothetical rankings / improvements).
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { CATEGORIES, LEVELS, PLAN_ADDED, applyFilters, distLead, drillFor, el, fmtSG, fmtStat, getState, infoTip, isMine, mount, planEditor, practiceOpen, sgn2, statBlocksCmp, statDef } from "./sgShared.js";

// each row's value for a set of rounds: Map key → value
export function rowVals(S, rounds, cat) {
  const memo = S.rowMemo.get(rounds)?.get(cat);
  if (memo) return memo;
  const m = new Map(), n = rounds.length;
  if (n && !cat) {
    // (update 229) no category: SG: Total and each category a round, and the scoring averages
    const by = { TOTAL: 0 }; for (const [k] of CATEGORIES) by[k] = 0;
    const any = new Set();
    for (const rd of rounds) for (const x of rd.shots) { by.TOTAL += x.sg; if (by[x.cat] != null) { by[x.cat] += x.sg; any.add(x.cat); } }
    m.set("c:TOTAL", by.TOTAL / n);
    for (const k of any) m.set(`c:${k}`, by[k] / n);
    const sec = statBlocksCmp([rounds]).find((b) => b.cat === "ROUND");
    for (const x of sec?.rows || []) if (!x.dist && x.values[0] != null && S.SCORING_KEYS.includes(x.key)) { m.set(`s:${x.key}|`, x.values[0]); if (x.w?.[0]) m.set(`w:s:${x.key}|`, x.w[0]); }
  } else if (n) {
    let tot = 0, att = 0; const byD = new Map();
    for (const rd of rounds) for (const x of rd.shots) if (x.cat === cat) { tot += x.sg; att += x.w || 1; if (x.dist) { const o = byD.get(x.dist) || byD.set(x.dist, { sg: 0, w: 0 }).get(x.dist); o.sg += x.sg; o.w += x.w || 1; } }
    if (att) { m.set("sg", tot / n); m.set("sga", tot / att); m.set("att", att / n); }
    for (const [d, o] of byD) if (o.w >= 1) m.set(`d:${d}`, o.sg / n);
    const sec = statBlocksCmp([rounds]).find((b) => b.cat === cat);
    for (const x of sec?.rows || []) if (x.values[0] != null) { m.set(`s:${x.key}|${x.dist || ""}`, x.values[0]); if (x.w?.[0]) m.set(`w:s:${x.key}|${x.dist || ""}`, x.w[0]); } // (update 387: and its attempts)
  }
  if (!S.rowMemo.has(rounds)) S.rowMemo.set(rounds, new Map());
  S.rowMemo.get(rounds).set(cat, m);
  return m;
}
export function fullStatTable(S, mine, cat, slicedField = [], mode = "table") {
  // (update 370) "table": the stats table on its own, never switched by the level cards; "elite": the Elite Round
  // Share block and the Path, without the table
  const n = mine.length;
  if (!n) return el("p", { class: "empty" }, "No stats for this selection.");
  const sgTone = (v) => (v == null ? "" : Math.round(v * 100) === 0 ? "zero" : v > 0 ? "pos" : "neg");
  const meV = S.rowVals(mine, cat);
  // the rows: strokes gained, by distance (3+ attempts), then the stats (all distances, then each)
  const lead = (d) => { const mm = /[\d.]+/.exec(String(d)); return /^[<]/.test(d) ? -1 : /^>/.test(d) ? 1e6 : mm ? Number(mm[0]) : 1e5; };
  const dW = new Map(); if (cat) for (const rd of mine) for (const x of rd.shots) if (x.cat === cat && x.dist) dW.set(x.dist, (dW.get(x.dist) || 0) + (x.w || 1));
  const dists = [...dW].filter(([, w]) => w >= 3).map(([d]) => d).sort((a, b) => lead(a) - lead(b) || String(a).localeCompare(String(b)));
  const sec = cat ? statBlocksCmp([mine]).find((b) => b.cat === cat) : null;
  // (update 265) the rows always add up: a player with no shots from a distance (or in a category) gained 0 there, and
  // "Other distances" holds the rest (bands with under 3 attempts, and shots with no distance), so the distance rows
  // sum to SG a round, for the player, the one they're compared with, and the difference between them
  const OTHER = "d:__other";
  const gv = (m, k) => {
    if (!m) return undefined;
    if (k === OTHER) { if (!m.has("sg")) return undefined; return m.get("sg") - dists.reduce((t, d) => t + (m.get(`d:${d}`) || 0), 0); }
    const v = m.get(k);
    if (v == null && (k.startsWith("d:") ? m.has("sg") : k.startsWith("c:") ? m.has("c:TOTAL") : false)) return 0;
    return v;
  };
  // (update 365) the Diff column (kept less cut): a background that's brighter the bigger the difference, white text.
  // Full colour at about 2 strokes (SG: Total), 1 (a part of the game), 0.5 (a distance), 0.05 a shot; 6 points for a
  // percentage; 6% for other stats
  const diffBg = (row, d, a, b, X) => {
    if (d == null || row.higher == null) return "color:#fff";
    const better = row.higher === false ? -d : d;
    const sc = row.fmt === sg3 ? 0.05 : row.fmt === sgF ? (row.key === "c:TOTAL" && !X ? 2 : X || row.sub ? 0.5 : 1) : row.def?.pct ? 6 : Math.max(Math.abs(((a ?? 0) + (b ?? 0)) / 2) * 0.06, 1e-6);
    const t = Math.min(1, Math.abs(better) / sc);
    if (t < 0.04) return "color:#fff";
    return `color:#fff;background:rgba(${better > 0 ? "48,209,88" : "255,69,58"},${((better > 0 ? 0.06 : 0.05) + (better > 0 ? 0.34 : 0.3) * t).toFixed(3)})`;
  };
  const sgF = (v) => fmtSG(v), sg3 = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`);
  const R = [];
  if (!cat) {
    R.push({ grp: "Strokes gained a round" });
    R.push({ key: "c:TOTAL", label: "SG: Total", fmt: sgF, higher: true, tone: true });
    // (update 332) tap a part of the game to open its distances under it (and again to fold them)
    const distsFor = (k) => { const w = new Map(); for (const rd of mine) for (const x of rd.shots) if (x.cat === k && x.dist) w.set(x.dist, (w.get(x.dist) || 0) + (x.w || 1)); return [...w].filter(([, n]) => n >= 3).map(([d]) => d).sort((a, b) => lead(a) - lead(b) || String(a).localeCompare(String(b))); };
    for (const [k, l] of CATEGORIES) if (meV.has(`c:${k}`)) {
      const open = (S.st.expCats || []).includes(k);
      R.push({ key: `c:${k}`, label: l, fmt: sgF, higher: true, tone: true, sub: true, expand: k, open });
      if (open) for (const d of distsFor(k)) R.push({ key: `d:${d}`, c: k, label: d, fmt: sgF, higher: true, tone: true, sub: true, deep: true });
    }
    const sk = S.SCORING_KEYS.filter((k) => meV.has(`s:${k}|`));
    if (sk.length) { R.push({ grp: "Scoring" }); for (const k of sk) { const def0 = statDef(k); R.push({ key: `s:${k}|`, label: def0.label, fmt: (v) => fmtStat(def0, v), def: def0, higher: def0.higher == null ? null : def0.higher !== false, sub: k !== "scoring" }); } }
  } else {
  R.push({ grp: "Strokes gained" });
  R.push({ key: "sg", label: "SG a round", fmt: sgF, higher: true, tone: true });
  if (meV.has("sga")) { R.push({ key: "sga", label: "SG an attempt", fmt: sg3, higher: true, tone: true, sub: true }); R.push({ key: "att", label: "Attempts a round", fmt: (v) => (v == null ? "—" : v.toFixed(1)), higher: null, sub: true }); }
  if (dists.length > 1) {
    R.push({ grp: "Strokes gained a round, by distance" });
    for (const d of dists) R.push({ key: `d:${d}`, label: d, fmt: sgF, higher: true, tone: true, sub: true });
    R.push({ key: OTHER, label: "Other distances", fmt: sgF, higher: true, tone: true, sub: true, other: true, tip: "Bands with fewer than 3 attempts, and shots with no distance, so the rows above add up to SG a round" });
  }
  if (sec) { R.push({ grp: `${sec.label} stats` }); for (const x of sec.rows) R.push({ key: `s:${x.key}|${x.dist || ""}`, label: x.dist || x.label, fmt: (v) => fmtStat(x.def, v), def: x.def, higher: x.def.higher == null ? null : x.def.higher !== false, sub: !!x.dist }); }
  }
  // the field: rank among the players ranked; "All Players": the players compared (Top N)
  const ranked = S.rankedField(slicedField).filter((p) => p.key !== S.me?.key);
  const fieldMaps = ranked.map((p) => S.rowVals(p.rounds, cat));
  const avg = (maps, k) => { const v = maps.map((m) => gv(m, k)).filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const rankOfRow = (k, v, higher) => { if (v == null || higher == null) return null; const vs = fieldMaps.map((m) => gv(m, k)).filter((x) => x != null && Number.isFinite(x)); if (!vs.length) return null; const better = vs.filter((x) => (higher ? x > v + 1e-12 : x < v - 1e-12)).length; return { rank: better + 1, of: vs.length + 1 }; };
  // trend: the last 12 rounds against the 12 before (fewer: half and half, at least 3 each)
  const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const tn = Math.min(12, Math.floor(ordered.length / 2));
  const lastV = tn >= 3 ? S.rowVals(ordered.slice(-tn), cat) : null, prevV = tn >= 3 ? S.rowVals(ordered.slice(-2 * tn, -tn), cat) : null;
  // best round: the best single-round value (each round on its own)
  const perRd = ordered.map((rd) => ({ rd, m: S.rowVals([rd], cat) }));
  const bestOf = (row) => {
    if (row.higher == null) return null;
    let best = null;
    for (const { rd, m } of perRd) { const v = m.get(row.key); if (v == null || !Number.isFinite(v)) continue; if (row.key.startsWith("s:") && !(rd.obs || []).some((o) => o.v != null)) continue; if (!best || (row.higher ? v > best.v : v < best.v)) best = { v, rd }; }
    return best;
  };
  // (update 240) against a rank (picked above the table): the player ranked #N overall (SG: Total a round in this
  // selection, not counting the player on screen), every row from that one player: #1 is the same golfer all the way down
  // (update 381) the table's own Personal Peak: their best N rounds against the rest (st.tablePeak), apart from the level cards
  // (update 442) no Personal Peak or Show Attempts buttons on this table any more
  S.st.tablePeak = 0; S.st.showAtt = false;
  const tPeak = 0;
  const peakOn = tPeak > 0 || (mode === "elite" && S.st.vsRank === "peak"); // (update 260) or against the player's own peak (update 370: not the table)
  const vsN = null, refP = null; // (update 330: no #N player comparisons)
  // (update 266) Personal Peak: the player's N best rounds (the Peak Length, default 10) in this selection, ranked by the
  // strokes gained the filters are about (SG: Total, or the one category picked: their best Off-the-Tee rounds), and
  // every row is those same rounds' value, so the rows still add up and read as "how I play on my best days"
  const peakN = tPeak || Math.max(1, Math.round(Number(S.st.peakN) || 10));
  const peak = peakOn ? (tPeak || S.st.peakMode === "stretch" ? S.peakOf(ordered, cat, peakN) : S.eliteOf(ordered, cat, peakN)) : null; // (update 383: the table's Personal Peak is rounds in a row) // (update 335: elite rounds; the same rounds as the charts' dots)
  const refMap = peak ? peak.map : refP ? S.rowVals(refP.rounds, cat) : null;
  const dTxt = (rd) => String(rd?.date || "").slice(0, 10);
  // no rank picked: each stat coloured against the player's own career average (every round of theirs)
  const careerMap = S.me?.rounds?.length ? S.rowVals(S.me.rounds, cat) : null;
  const relNow = !!refMap && (!peak || peak.map.size > 0);
  const stretchOn = !!(peak && !peak.short); // (update 330) a stretch picked: Stretch | Selection | Difference | Stretch Rank
  // (update 343) the elite rounds against the rest (their other rounds in the selection), not the average, which
  // already has the elite rounds in it
  const eliteSet = stretchOn ? new Set(peak.rounds) : null;
  const rest = stretchOn ? mine.filter((rd) => !eliteSet.has(rd)) : null;
  const restV = stretchOn ? S.rowVals(rest, cat) : null;
  // (update 332) an opened part of the game's distance rows: the same columns, worked out for that part of the game
  const mapsMemo = new Map();
  const M = (c) => {
    if (!mapsMemo.has(c)) mapsMemo.set(c, { me: S.rowVals(mine, c), field: ranked.map((p) => S.rowVals(p.rounds, c)), last: tn >= 3 ? S.rowVals(ordered.slice(-tn), c) : null, prev: tn >= 3 ? S.rowVals(ordered.slice(-2 * tn, -tn), c) : null,
      peak: stretchOn ? S.rowVals(peak.rounds, c) : null, rest: stretchOn ? S.rowVals(rest, c) : null, career: S.me?.rounds?.length ? S.rowVals(S.me.rounds, c) : null });
    return mapsMemo.get(c);
  };
  const rankIn = (maps, k, v, higher) => { if (v == null || higher == null) return null; const vs = maps.map((m) => gv(m, k)).filter((x) => x != null && Number.isFinite(x)); if (!vs.length) return null; const better = vs.filter((x) => (higher ? x > v + 1e-12 : x < v - 1e-12)).length; return { rank: better + 1, of: vs.length + 1 }; };
  const toggleCat = (k) => { const a = new Set(S.st.expCats || []); a.has(k) ? a.delete(k) : a.add(k); S.st.expCats = [...a]; S.draw(); };
  // (update 387) Show Attempts: a percentage with how many of how many, "50% (6/12)"
  const attOn = mode === "table" && !!S.st.showAtt;
  const att = (map, row) => { if (!attOn || !row.def?.pct || !map) return ""; const w = map.get(`w:${row.key}`), v = map.get(row.key); return w && v != null ? ` (${Math.round((v * w) / 100)}/${Math.round(w)})` : ""; };
  const tr = [];
  // (update 368) strokes gained rows below SG: Total are coloured against their own group (the four parts of the game
  // against each other; an opened part's distances against each other), so the biggest in the group is the brightest
  const relCells = [];
  const relGroup = (row) => (row.fmt !== sgF || row.key === "c:TOTAL" || row.key === "sg" ? null : row.c ? `d|${row.c}` : row.key.startsWith("c:") ? "cats" : row.key.startsWith("d:") || row.key === OTHER ? "dists" : null);
  for (const row of R) {
    if (row.grp) { tr.push(el("tr", { class: "cmp-grp" }, el("td", { colspan: stretchOn ? 5 : 4 }, row.grp))); continue; }
    const X = row.c ? M(row.c) : null; // (update 332: a distance row under an opened part of the game)
    const v = gv(X ? X.me : meV, row.key) ?? null, fAvg = X ? (stretchOn ? gv(X.peak, row.key) : gv(X.career, row.key)) ?? null : refMap ? gv(refMap, row.key) ?? null : gv(careerMap, row.key) ?? null;
    const label = row.expand ? [el("span", { class: "sg-exp", "aria-hidden": "true" }, row.open ? "\u25BE " : "\u25B8 "), row.label] : row.label;
    if (row.other && Math.abs(v || 0) < 0.005 && (!relNow || Math.abs(fAvg || 0) < 0.005)) continue; // (nothing outside the bands shown)
    const good = (d) => (d == null || row.higher == null || Math.abs(d) < 1e-9 ? "" : (row.higher ? d > 0 : d < 0) ? "pos" : "neg");
    const shown = relNow && v != null && fAvg != null ? (row.fmt === sgF || row.fmt === sg3 ? row.fmt(v - fAvg) : `${v - fAvg >= 0 ? "+" : "−"}${fmtStat({ ...(row.def || {}), pct: false, unit: row.def?.pct ? " pct" : row.def?.unit }, Math.abs(v - fAvg))}`) : row.fmt(v);
    const vCls = relNow && v != null && fAvg != null ? (row.higher == null ? "" : good(v - fAvg)) : row.tone ? sgTone(v) : good(v != null && fAvg != null ? v - fAvg : null);
    // (update 319) Personal Peak: the Peak Rank, where the peak's value would rank if it were their average
    const pkRow = peak && !peak.short ? gv(X ? X.peak : peak.map, row.key) : null;
    const rk = S.showRanks ? (X ? rankIn(X.field, row.key, stretchOn ? pkRow : v, row.higher) : rankOfRow(row.key, peak && !peak.short ? pkRow : v, row.higher)) : null;
    const a = gv(X ? X.last : lastV, row.key), b = gv(X ? X.prev : prevV, row.key), ch = a != null && b != null ? a - b : null;
    const chTxt = ch == null ? "—" : Math.abs(ch) < (row.tone ? 0.005 : 1e-9) ? "◆ steady" : `${ch > 0 ? "▲" : "▼"} ${row.fmt === sg3 ? Math.abs(ch).toFixed(3) : row.fmt === sgF ? Math.abs(ch).toFixed(2) : row.def ? fmtStat({ ...row.def, pct: false, unit: row.def.pct ? " pct" : row.def.unit }, Math.abs(ch)) : Math.abs(ch).toFixed(1)}`;
    void bestOf; // (update 229: no Best round or All Players columns)
    const pk = peak && !peak.short ? gv(X ? X.peak : peak.map, row.key) : null; // (update 266) the best rounds' own value
    if (stretchOn) {
      const v = gv(X ? X.rest : restV, row.key) ?? null; // (update 343: the non-elite rounds)
      const d = pk != null && v != null ? pk - v : null;
      const dTxt2 = d == null ? "\u2014" : row.fmt === sgF || row.fmt === sg3 ? row.fmt(d) : `${d >= 0 ? "+" : "\u2212"}${fmtStat({ ...(row.def || {}), pct: false, unit: row.def?.pct ? " pct" : row.def?.unit }, Math.abs(d))}`;
      const srow = el("tr", { class: `${row.sub ? "cmp-sub" : ""}${row.deep ? " cmp-deep" : ""}${row.expand ? " sg-tap" : ""}`, ...(row.expand ? { role: "button", tabindex: "0", "aria-expanded": String(!!row.open), title: `${row.label}: ${row.open ? "hide" : "show"} its distances` } : {}) });
      if (row.expand) { srow.addEventListener("click", () => toggleCat(row.expand)); srow.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCat(row.expand); } }); }
      tr.push((mount(srow, [
        el("td", { title: row.tip || null }, label),
        ...(() => { const restTd = el("td", { class: "num" }, `${row.fmt(v)}${att(X ? X.rest : restV, row)}`), pkTd = el("td", { class: "num strong" }, pk == null ? "\u2014" : `${row.fmt(pk)}${att(X ? X.peak : peak.map, row)}`);
          return tPeak ? [pkTd, restTd] : [restTd, pkTd]; })(), // (update 335: Avg | Elite | Diff | Elite Rank; update 384: Personal Peak is Peak | Rest)
        (() => { const g = relGroup(row); const td = el("td", { class: "num bs-diff", style: g ? "color:#fff" : diffBg(row, d, pk, v, X) }, dTxt2); if (g && d != null) relCells.push({ td, g, d }); return td; })(),
        el("td", { class: "num" }, rk ? `${rk.rank} of ${rk.of}` : "\u2014"),
      ]), srow));
      continue;
    }
    // (update 331) tap a stat: its round by round bars (the last 10 against the 10 before), as on the Watchlist
    const trow = el("tr", { class: `${row.sub ? "cmp-sub" : ""}${row.deep ? " cmp-deep" : ""} sg-tap`, role: "button", tabindex: "0", ...(row.expand ? { "aria-expanded": String(!!row.open) } : {}), title: row.expand ? `${row.label}: ${row.open ? "hide" : "show"} its distances` : `${row.label}: round by round` });
    const openForm = async () => {
      const [{ formInfo }, { openBadge }] = await Promise.all([import("./watchlistData.js"), import("./badgePopup.js")]);
      const val = (rs) => (rs.length ? gv(S.rowVals(rs, row.c ?? cat), row.key) ?? null : null);
      openBadge({ text: row.label, info: () => formInfo(ordered, val, { label: row.label, fmtFn: (x) => row.fmt(x), chFn: (d) => (row.fmt === sgF ? Math.abs(d).toFixed(2) : row.fmt === sg3 ? Math.abs(d).toFixed(3) : row.def ? fmtStat({ ...row.def, pct: false, unit: row.def.pct ? " pct" : row.def.unit }, Math.abs(d)) : Math.abs(d).toFixed(1)), higher: row.higher, signed: !!row.tone }) }, S.me?.label || "");
    };
    const act = row.expand ? () => toggleCat(row.expand) : openForm; // (update 332: a part of the game opens its distances)
    trow.addEventListener("click", act);
    trow.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    tr.push((mount(trow, [
      el("td", { title: row.tip || null }, label),
      el("td", { class: `num strong ${vCls}`, title: pk != null ? `Your best ${peakN} rounds in a row: ${row.fmt(pk)}` : null }, relNow ? shown : `${shown}${att(X ? X.me : meV, row)}`),
      // (update 320) Trend before Rank; with a comparison picked, the value compared against in its place
      relNow ? (() => { const rv = gv(refMap, row.key); return el("td", { class: "num cmp-refv" }, rv == null ? "\u2014" : row.fmt(rv)); })()
        : el("td", { class: `num ${ch == null ? "" : good(ch)}` }, chTxt),
      el("td", { class: "num" }, rk ? `${rk.rank} of ${rk.of}` : "—"),
    ]), trow));
  }
  { const max = new Map(); for (const c of relCells) max.set(c.g, Math.max(max.get(c.g) || 0, Math.abs(c.d)));
    for (const c of relCells) { const m = max.get(c.g) || 0; const t = m > 0 ? Math.abs(c.d) / m : 0; if (Math.abs(c.d) < 0.005) continue;
      const up = c.d > 0; c.td.style.background = `rgba(${up ? "48,209,88" : "255,69,58"},${(0.04 + 0.4 * t * t).toFixed(3)})`; } }
  const TN = tPeak ? { kept: `best ${peakN}-round stretch`, cut: "other rounds", Kept: "Peak", Cut: "Rest" } : S.NM();
  // (update 381) Personal Peak, picked above the table: their best N rounds (any order) against the rest
  const peakCtl = false ? (() => {
    // (update 387) to start: the length of their longest Best on Tour stretch (else 10)
    const all = S.longestStretches(S.lastSliced || [], cat), myRow = all.find((x) => x.p.key === S.me.key), best1 = myRow?.n > 0 ? myRow : null;
    const defN = best1 ? best1.n : 10;
    const inp = el("input", { type: "number", class: "peak-len", min: "1", max: "500", step: "1", value: String(tPeak || Number(S.st.tablePeakLast) || defN), inputmode: "numeric", "aria-label": "How many rounds in a row" });
    const apply = () => { const v = Math.round(Number(inp.value)); if (!Number.isFinite(v) || v < 1) { inp.value = String(tPeak || defN); return; } S.st.tablePeak = Math.min(500, v); S.st.tablePeakLast = S.st.tablePeak; S.draw(); };
    inp.addEventListener("change", () => { if (tPeak) apply(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); inp.blur(); } });
    const tog = el("button", { type: "button", class: `pp-tog${tPeak ? " on" : ""}`, "aria-pressed": String(!!tPeak) }, tPeak ? "\u2713 Personal Peak" : "Personal Peak");
    tog.addEventListener("click", () => { if (tPeak) { S.st.tablePeak = 0; S.draw(); } else { S.st.tablePeak = Math.min(500, Math.round(Number(S.st.tablePeakLast) || defN)); S.draw(); } });
    const attTog = el("button", { type: "button", class: `pp-tog${S.st.showAtt ? " on" : ""}`, "aria-pressed": String(!!S.st.showAtt), title: "Percentages with how many of how many, e.g. 50% (6/12)" }, S.st.showAtt ? "\u2713 Show Attempts" : "Show Attempts");
    attTog.addEventListener("click", () => { S.st.showAtt = !S.st.showAtt; S.draw(); });
    const tip = infoTip(`Personal Peak compares their best run of rounds in a row (the stretch with the highest strokes gained) with the rest of their rounds in the selection. It starts at the length of their longest ${LEVELS[1]} stretch: the longest run whose average on its own beats every other player\u2019s season average${best1 ? ` (${best1.n} rounds for ${S.me.label})` : ""}, or 10 rounds if they don\u2019t have one. Change the number for a shorter or longer stretch.`);
    // the stretch it picked, with its dates (tap for every round)
    const line = tPeak && peak && !peak.short && peak.rounds.length ? (() => {
      const rs = peak.rounds, from = rs[0].date, to = rs.at(-1).date, n = rs.length;
      const avgT = rs.reduce((t, rd) => t + rd.shots.reduce((u, x) => u + (!cat || x.cat === cat ? x.sg : 0), 0), 0) / n;
      const bar = myRow?.bar ?? all[0]?.bar ?? null, enough = bar != null && avgT > bar + 1e-12;
      const when = from === to ? S.shortDay(from) : `${S.shortDay(from)} \u2013 ${S.shortDay(to)}`;
      const place = best1 && n === best1.n ? 1 + all.filter((r) => r.n > best1.n).length : null, withN = all.filter((r) => r.n > 0).length;
      const link = el("button", { type: "button", class: "link bs-stretch-link", title: "Every round, with this stretch picked out" }, when);
      link.addEventListener("click", () => S.stretchPopup({ p: { key: S.me.key, rounds: mine }, n, from, to, bar: bar ?? 0 }, cat, when, place, withN));
      return el("p", { class: "muted small sg-peak-line" }, [`Their best ${n}-round stretch: `, link, `, ${sgn2(avgT)} a round${enough ? `, enough on its own for ${LEVELS[1]}` : ""}.`]);
    })() : null;
    return el("div", { class: "sg-peak-wrap" }, [
      el("div", { class: "sg-peak-ctl" }, [attTog, tog, tPeak ? el("span", { class: "muted small sg-peak-l" }, ["(best ", inp, " round stretch)"]) : null, tip]), // (update 382; 387: the number only once it's on)
      line]);
  })() : null;
  if (mode === "elite") return [
    el("div", { class: "sg-full-top" }, [S.stretchesBlock(mine, cat)]), // (update 330: Best Stretches)
    pathOf(),
    // (update 445) Hypothetical rankings: built here, shown at the bottom of the hero card, under the category cards
    // (update 455) without rankings (their own entered rounds): Hypothetical improvements, the same what-ifs with no ranks
    (() => { if (S.showRanks || (S.me && S.isSG())) { try { S.heroHypo = hypoOf(); } catch (err) { console.error(err); S.heroHypo = null; } } return null; })(), // (update 393)
  ];
  return [
    peakCtl,
    el("div", { class: "cmp-tw" }, el("table", { class: `cmp-table sg-full-t${stretchOn && !S.showRanks ? " no-rank" : ""}` }, [
      el("thead", {}, el("tr", {}, stretchOn ? [el("th", {}, ""), // (update 330)
        ...(() => { const restTh = el("th", { class: "num", title: `The player\u2019s ${TN.cut} in the selected time frame` }, TN.Cut),
          pkTh = el("th", { class: "num", title: `The average of their best ${peakN} ${peakN === 1 ? "round" : "rounds"} (the ${TN.kept})` }, TN.Kept);
          return tPeak ? [pkTh, restTh] : [restTh, pkTh]; })(),
        el("th", { class: "num", title: `${TN.Kept} less ${TN.Cut.toLowerCase()}: green where the ${TN.kept} were better` }, "Diff"),
        el("th", { class: "num", title: "Where the kept rounds\u2019 value would rank if it were the player\u2019s average for the selected time frame" }, tPeak ? "Peak Rank" : `${S.NM().Kept} Rank`)]
        : [el("th", {}, ""), el("th", { class: "num", title: S.me?.label || "" }, String(S.me?.label || "").trim().split(/\s+/)[0] || "Player"), // (update 633) just their first name
        el("th", { class: "num", title: `Last ${tn || 12} rounds against the ${tn || 12} before` }, "Trend"),
        el("th", { class: "num" }, "Rank")])),
      el("tbody", {}, tr),
    ])),
    // (update 240) what the colours mean
    // (update 363) with kept / cut rounds picked, what the columns mean sits behind a small ⓘ
    (() => { const txt = (stretchOn ? `${TN.Cut}: ${S.me?.label || "the player"}\u2019s ${TN.cut} in the selected time frame. ${TN.Kept}: the average of their best ${peakN} ${peakN === 1 ? "round" : "rounds"} . Diff: ${TN.kept} less ${TN.cut}, green where the ${TN.kept} were better.${S.showRanks ? ` ${TN.Kept} Rank: where the ${TN.kept}\u2019 value would rank if it were their average for the selected time frame.` : ""}`
      : `Strokes gained: green above zero (the tour baseline), red below. Other stats: green when better than ${S.me?.label || "the player"}\u2019s career average (every round of theirs), red when worse; no colour when neither is better (attempts, pars). Rank: where they sit among the players in this selection. Trend: the last ${tn || 10} rounds against the ${tn || 10} before. Tap an Elite Round Share above to see how they played at their best.`); return el("details", { class: "bs-help sg-full-note-i" }, [el("summary", { "aria-label": "What the columns mean" }, "\u24d8"), el("p", { class: "muted small" }, txt)]); })(), // (update 366: always behind the ⓘ)
  ];
  // (update 393) Hypothetical rankings: the last N rounds' strokes gained in each part of the game, each one nudged up or
  // down with − / +, and where that would rank over the time frame picked (against everyone else's averages there)
  function hypoOf() {
    const season = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    if (season.length < 3) return null;
    // (update 445) starting from their season average (the season below), each part nudged up or down, ranked on the season
    const N = season.length;
    let last = season, recent = null;
    // (update 442) ranked on the season: where these numbers would put them if they were their season average, against
    // everyone's averages for the season (the year of their latest round, or the year picked), whatever time frame is picked
    const seasonYear = (Array.isArray(S.lastRankF.year) && S.lastRankF.year.length === 1) ? String(S.lastRankF.year[0]) : String(season.at(-1)?.year || String(season.at(-1)?.date || "").slice(0, 4));
    const seasonF = { ...S.lastRankF, months: 0, from: null, to: null, year: [seasonYear], event: [], course: [], roundNo: [] };
    const seasonAll = S.field.map((p) => ({ ...p, rounds: S.nz(applyFilters(p.rounds, seasonF)) })).filter((p) => p.rounds.length);
    const seasonMin = S.minRoundsFor(seasonAll);
    const noRk = !S.showRanks; // (update 455: Hypothetical improvements, no ranks)
    let field0 = noRk ? [] : seasonAll.filter((p) => p.key !== S.me?.key && p.rounds.length >= seasonMin);
    if (!field0.length && !noRk) field0 = S.rankedField(slicedField).filter((p) => p.key !== S.me?.key); // (no season field: the time frame's)
    { const mySeason = S.nz(applyFilters(S.me.rounds, seasonF)).sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))); if (mySeason.length) last = mySeason; }
    recent = S.rowVals(last, cat);
    const others = field0.map((p) => S.rowVals(p.rounds, cat));
    if (!others.length && !noRk) return null;
    const parts = cat ? dists.map((d) => ({ key: `d:${d}`, label: d })) : CATEGORIES.map(([k, l]) => ({ key: `c:${k}`, label: l }));
    const totKey = cat ? "sg" : "c:TOTAL", totLabel = cat ? `${CATEGORIES.find(([k]) => k === cat)?.[1] || cat} (a round)` : "SG: Total";
    const adj = S.st.hypoAdj && S.st.hypoAdj.cat === (cat || "") ? S.st.hypoAdj.d : {};
    // (update 394) a part of the game opens to its distances: each can be nudged too, and they add up into it
    const kidMemo = new Map();
    const kidsOf = (p) => {
      if (cat) return [];
      const c = p.key.slice(2);
      if (!kidMemo.has(c)) {
        const rv = S.rowVals(last, c);
        const ds = [...rv.keys()].filter((k) => k.startsWith("d:")).sort((a, b) => distLead(a.slice(2)) - distLead(b.slice(2)) || a.localeCompare(b));
        kidMemo.set(c, { rv, ds, field: null });
      }
      const m = kidMemo.get(c);
      return m.ds.map((dk) => ({ key: `${p.key}>${dk}`, label: dk.slice(2), dk, c, rv: m.rv }));
    };
    const kidField = (c) => { const m = kidMemo.get(c); if (!m.field) m.field = field0.map((p) => S.rowVals(p.rounds, c)); return m.field; };
    const kidAdj = (pk) => Object.entries(adj).reduce((t, [k, v]) => t + (k.startsWith(`${pk}>`) ? v : 0), 0);
    const valOf = (k) => (recent.get(k) ?? 0) + (adj[k] || 0) + kidAdj(k);
    const base = parts.filter((p) => recent.has(p.key));
    const other = (recent.get(totKey) ?? 0) - base.reduce((t, p) => t + (recent.get(p.key) ?? 0), 0); // (shots outside the parts listed)
    const total = base.reduce((t, p) => t + valOf(p.key), 0) + other;
    const rankIn = (maps, k, v) => { const vs = maps.map((m) => m.get(k)).filter((x) => x != null && Number.isFinite(x)); return { rank: 1 + vs.filter((x) => x > v + 1e-12).length, of: vs.length + 1 }; };
    const step = cat ? 0.02 : 0.05, kidStep = 0.02;
    const bump = (k, d) => { const cur = S.st.hypoAdj && S.st.hypoAdj.cat === (cat || "") ? { ...S.st.hypoAdj.d } : {}; cur[k] = Math.round(((cur[k] || 0) + d) * 1000) / 1000; if (Math.abs(cur[k]) < 1e-9) delete cur[k]; S.st.hypoAdj = { cat: cat || "", d: cur }; S.draw(); };
    // (update 419) or type the value itself: the change becomes whatever gets it there
    const setAdj = (k, d) => { const cur = S.st.hypoAdj && S.st.hypoAdj.cat === (cat || "") ? { ...S.st.hypoAdj.d } : {}; cur[k] = Math.round(d * 1000) / 1000; if (Math.abs(cur[k]) < 1e-9) delete cur[k]; S.st.hypoAdj = { cat: cat || "", d: cur }; S.draw(); };
    const open = !!S.st.hypoOpen;
    const tgl = el("button", { type: "button", class: "bs-path-toggle", "aria-expanded": String(open) }, [el("span", { class: "cmp-caret" }, open ? "\u25BE " : "\u25B8 "), noRk ? "Hypothetical improvements" : "Hypothetical rankings"]);
    tgl.addEventListener("click", () => { S.st.hypoOpen = !open; S.draw(); });
    if (!open) return el("div", { class: "bs-path closed bs-hypo" }, [el("div", { class: "bs-path-head" }, [el("p", { class: "bs-sub" }, tgl)])]);
    const nIn = el("input", { type: "number", class: "peak-len", min: "3", max: "500", step: "1", value: String(N), inputmode: "numeric", "aria-label": "How many recent rounds" });
    const setN = () => { const v = Math.round(Number(nIn.value)); if (Number.isFinite(v) && v >= 3) { S.st.hypoN = v; S.draw(); } else nIn.value = String(N); };
    nIn.addEventListener("change", setN); nIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nIn.blur(); } });
    const rkTxt = (r) => `${S.ordinal(r.rank)} of ${r.of}`;
    const openCats = new Set(S.st.hypoCats || []);
    const f3h = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`; // (a distance: update 447, two decimals like the rest)
    const fmtD = (d) => `${d > 0 ? "+" : "\u2212"}${Math.abs(d).toFixed(2)}`;
    // one row: k its key; v0 the last N rounds' value; v the what-if; d the change; r / r0 the ranks
    // (update 450) Add to practice, under the rank of any row made better (filled in below, used on a tap)
    const planOn = practiceOpen(S.me?.key);
    let planCell = null; const planSlots = [];
    const row = ({ k, label, v0, v, d, r, r0, isTot = false, kid = false, stepBy = step, expand = null, plan = null }) => {
      const btn = (txt, dv, lab) => { const b = el("button", { type: "button", class: "hy-step", "aria-label": `${lab} ${label}` }, txt); b.addEventListener("click", (e) => { e.stopPropagation(); bump(k, dv); }); return b; };
      const typeable = () => {
        const sv = el("strong", { class: `hy-type ${v >= 0 ? "pos" : "neg"}${d ? " hy-moved" : ""}`, role: "button", tabindex: "0", title: "Click to type a value", "aria-label": `Type a value for ${label}` }, kid ? f3h(v) : fmtSG(v));
        const edit = (e) => {
          e.stopPropagation(); e.preventDefault();
          const inp = el("input", { type: "text", inputmode: "decimal", class: "hy-in", value: v.toFixed(2), "aria-label": `Value for ${label}` });
          let done = false;
          const commit = (keep) => {
            if (done) return; done = true;
            const t = Number(String(inp.value).trim().replace(/[\u2212\u2013]/g, "-").replace(/^\+/, ""));
            if (keep && String(inp.value).trim() !== "" && Number.isFinite(t)) setAdj(k, t - (v - (adj[k] || 0))); else S.draw();
          };
          inp.addEventListener("click", (ev) => ev.stopPropagation());
          inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); commit(true); } else if (ev.key === "Escape") { ev.preventDefault(); commit(false); } });
          inp.addEventListener("blur", () => commit(true));
          sv.replaceWith(inp); inp.focus(); inp.select();
        };
        sv.addEventListener("click", edit);
        sv.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") edit(e); });
        return sv;
      };
      const moved = r.rank !== r0.rank;
      const lab = expand ? [el("span", { class: "sg-exp", "aria-hidden": "true" }, expand.open ? "\u25BE " : "\u25B8 "), label] : label;
      const tr = el("tr", { class: `${isTot ? "bs-path-total" : ""}${kid ? " cmp-sub cmp-deep" : ""}${expand ? " sg-tap" : ""}`, ...(expand ? { role: "button", tabindex: "0", "aria-expanded": String(expand.open) } : {}) }, [
        el("td", {}, lab),
        el("td", { class: "num" }, kid ? f3h(v0) : fmtSG(v0)),
        el("td", { class: "num hy-val" }, [isTot ? el("strong", { class: v >= 0 ? "pos" : "neg" }, fmtSG(v)) : el("span", { class: "hy-ctl" }, [btn("\u2212", -stepBy, "Worse"), typeable(), btn("+", stepBy, "Better")]),
          Math.abs(d) > 1e-9 ? el("span", { class: `hy-d ${d > 0 ? "pos" : "neg"}`, title: isTot ? "All the changes added up" : expand ? "Its changes added up (with its distances)" : "Changed by" }, fmtD(d)) : null]),
        el("td", { class: "num" }, [noRk ? null : rkTxt(r), !noRk && moved ? el("span", { class: `hy-mv ${r.rank < r0.rank ? "pos" : "neg"}` }, ` ${r.rank < r0.rank ? "\u25B2" : "\u25BC"}${Math.abs(r0.rank - r.rank)}`) : null,
          plan && planOn && !isTot && d > 0.009 ? (() => { const c = el("div", { class: "hy-plan-cell" }); planSlots.push([c, plan]); return c; })() : null]),
      ]);
      if (expand) { tr.addEventListener("click", expand.flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expand.flip(); } }); }
      return tr;
    };
    const body = [row({ k: totKey, label: totLabel, v0: recent.get(totKey) ?? 0, v: total, d: total - (recent.get(totKey) ?? 0), r: rankIn(others, totKey, total), r0: rankIn(others, totKey, recent.get(totKey) ?? 0), isTot: true })];
    for (const p of base) {
      const kids = kidsOf(p), isOpen = openCats.has(p.key), v0 = recent.get(p.key) ?? 0, v = valOf(p.key);
      const flip = () => { const a = new Set(S.st.hypoCats || []); a.has(p.key) ? a.delete(p.key) : a.add(p.key); S.st.hypoCats = [...a]; S.draw(); };
      const planU = cat ? { c: cat, d: p.label, t: v, label: `${CATEGORIES.find(([q]) => q === cat)?.[1] || cat} \u00b7 ${p.label}` } : { c: p.key.slice(2), d: null, t: v, label: p.label };
      body.push(row({ k: p.key, label: p.label, v0, v, d: v - v0, r: rankIn(others, p.key, v), r0: rankIn(others, p.key, v0), expand: kids.length ? { open: isOpen, flip } : null, plan: planU }));
      if (!isOpen) continue;
      const f = kidField(kids[0]?.c);
      for (const x of kids) {
        const kv0 = x.rv.get(x.dk) ?? 0, kd = adj[x.key] || 0, kv = kv0 + kd;
        body.push(row({ k: x.key, label: x.label, v0: kv0, v: kv, d: kd, r: rankIn(f, x.dk, kv), r0: rankIn(f, x.dk, kv0), kid: true, stepBy: kidStep, plan: { c: x.c, d: x.label, t: kv, label: `${p.label} \u00b7 ${x.label}` } }));
      }
    }
    const anyAdj = Object.keys(adj).length > 0;
    // (update 393) every change added up, in one line (update 394: distances too)
    const nameOfKey = (k) => { if (!k.includes(">")) return parts.find((p) => p.key === k)?.label || k; const [pk, dk] = k.split(">"); return `${parts.find((p) => p.key === pk)?.label || pk} \u00b7 ${dk.slice(2)}`; };
    const adjList = Object.entries(adj).filter(([, v]) => Math.abs(v) > 1e-9).map(([k, v]) => `${nameOfKey(k)} ${fmtD(v)}`);
    const adjSum = Object.values(adj).reduce((t, v) => t + v, 0);
    const sumLine = anyAdj ? el("p", { class: "hy-sum" }, [`Changes: `, el("strong", { class: adjSum >= 0 ? "pos" : "neg" }, `${fmtD(adjSum)} a round`), ` in all`, el("span", { class: "muted" }, ` (${adjList.join(", ")})`)]) : null;
    // (update 447) Create practice plan: the plainest way to the what-if numbers. Their own rounds closest to the
    // what-if breakdown (every part of the game, and any distance changed) show what the plain stats were when they
    // played like that; each part made better gets the one stat that moved most in those rounds (the fewest stats to
    // work on), with a drill and a goal in real rounds.
    // (update 450) one row at a time: u = { c, d, t, label } (a part of the game, or one of its distances); the rounds
    // only have to match that one number, not the whole bag
    const hypoPlan = (u) => {
      const rs = last;
      if (rs.length < 8) return { err: `It needs at least 8 rounds in the season to find rounds like this (${rs.length} so far).` };
      // (update 449) up: a part made better in the what-if; the rounds picked must be at least that good there
      const dims = [{ c: u.c, d: u.d, t: u.t, up: true }];
      // (update 448) the rounds that, together, average out to the what-if: picked one at a time, each the round that
      // brings the group's average closest to it (with a nudge toward rounds that are close on their own). The group
      // has to land within 0.10 a round of every part of the game (0.05 for a distance); their own rounds first, and if
      // theirs can't get there, every other player's rounds this season (the tour). Neither: no plan.
      const vecOf = (rd) => dims.map(({ c, d }) => { let s0 = 0; for (const x of rd.shots || []) if (x.cat === c && (!d || x.dist === d)) s0 += x.sg || 0; return s0; });
      const V0 = rs.map(vecOf);
      const sdv = dims.map((_, j) => { const xs = V0.map((v) => v[j]); const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.max(0.15, Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1))); });
      const tolOf = (j) => (dims[j].d ? 0.05 : 0.10);
      // (update 449) a part made better: the group has to be at or above the what-if (never below it), up to the
      // tolerance above; aimed at the middle of that. Every other part: within the tolerance either way.
      const aimOf = (j) => (dims[j].up ? dims[j].t + tolOf(j) / 2 : dims[j].t);
      const spanOf = (j) => (dims[j].up ? tolOf(j) / 2 : tolOf(j));
      const fits = (x, j) => (dims[j].up ? x >= dims[j].t - 1e-9 && x <= dims[j].t + tolOf(j) + 1e-9 : Math.abs(x - dims[j].t) <= tolOf(j) + 1e-9);
      const pick = (pool, K) => {
        const V = pool.map(vecOf), used = new Uint8Array(pool.length), sum = dims.map(() => 0), sel = [];
        const own = V.map((v) => v.reduce((t, x, j) => t + ((x - dims[j].t) / sdv[j]) ** 2, 0) / dims.length);
        const errOf = (sm, n) => { let e = 0; for (let j = 0; j < dims.length; j++) { const g = (sm[j] / n - aimOf(j)) / spanOf(j); e += (dims[j].up && g < 0 ? 4 : 1) * g * g; } return e; };
        const kk = Math.min(K, pool.length);
        for (let n = 1; n <= kk; n++) {
          let bi = -1, be = Infinity;
          for (let i = 0; i < pool.length; i++) {
            if (used[i]) continue;
            const e = errOf(sum.map((x, j) => x + V[i][j]), n) + 0.01 * own[i];
            if (e < be) { be = e; bi = i; }
          }
          used[bi] = 1; sel.push(bi); V[bi].forEach((x, j) => { sum[j] += x; });
        }
        // (update 449) then swap rounds in and out while that brings the group closer (a first pick can box it in)
        let cur = errOf(sum, kk);
        for (let pass = 0; pass < 15 && cur > 1e-6; pass++) {
          let moved = false;
          for (let a = 0; a < sel.length; a++) {
            const out0 = sel[a]; let bi = -1, be = cur - 1e-9;
            const base0 = sum.map((x, j) => x - V[out0][j]);
            for (let i = 0; i < pool.length; i++) {
              if (used[i]) continue;
              const e = errOf(base0.map((x, j) => x + V[i][j]), kk);
              if (e < be) { be = e; bi = i; }
            }
            if (bi >= 0) { used[out0] = 0; used[bi] = 1; sel[a] = bi; for (let j = 0; j < dims.length; j++) sum[j] = base0[j] + V[bi][j]; cur = errOf(sum, kk); moved = true; }
          }
          if (!moved) break;
        }
        const avg = sum.map((x) => x / kk);
        return { rounds: sel.map((i) => pool[i]), ok: avg.every(fits), avg };
      };
      let src = "you", got = pick(rs, Math.max(5, Math.min(15, Math.round(rs.length / 4))));
      if (!got.ok && noRk) return { err: `None of ${isMine(S.me?.key) ? "your" : "their"} own rounds this season, taken together, match this what-if closely enough (at least as good as it, and no more than ${u.d ? "0.05" : "0.10"} a round better). Try a smaller change.` };
      if (!got.ok) {
        const tour = field0.flatMap((p) => p.rounds || []).filter((rd) => (rd.shots || []).length);
        const tg = tour.length >= 50 ? pick(tour, 25) : null;
        if (!tg || !tg.ok) return { err: "No rounds this season, theirs or anyone else\u2019s on tour, match this what-if: at least as good as it in every part made better (and no more than 0.10 a round better), and within 0.10 a round everywhere else. Try smaller changes." };
        src = "tour"; got = tg;
      }
      const near = got.rounds, K = near.length;
      // the stats to use for each part of the game; the second list only when the data has none of the first
      const CAND = (c, d) => (c === "OTT" ? [/iron|wood/i.test(d || "") ? ["fwy"] : ["drive", "fwy"]] : c === "APP" ? [["prox", "hitGreen"], ["gir"]] : c === "ARG" ? [["prox"]] /* (update 476: the short game, proximity only) */ : c === "PUTT" ? [["make"], ["goodLag"]] : []);
      // (update 453) a shot-by-shot file puts every stat on a distance, a summary file on the part of the game: so the
      // part of the game is every distance of it, whichever the file has
      const scopes = (c, d) => [...(d ? [["exact", (o) => o.cat === c && o.dist === d]] : []), ["cat", (o) => o.cat === c], ["whole", (o) => !o.cat]];
      const avgOf = (rounds, k, f) => { let s0 = 0, w = 0; for (const rd of rounds) for (const o of rd.obs || []) if (o.k === k && f(o)) { s0 += o.v * o.w; w += o.w; } return w ? { v: s0 / w, w } : null; };
      const items = [], notes = [];
      for (const u1 of [u]) { const u = u1;
        let best = null, seen = false; const looked = [];
        for (const tier of CAND(u.c, u.d)) { if (seen) break; for (const k of tier) {
          const def = statDef(k);
          for (const [scope, f] of scopes(u.c, u.d)) {
            const a = avgOf(near, k, f), b = avgOf(rs, k, f);
            if (!a || !b) continue;
            if (a.w < (def.pct ? 8 : 4) || b.w < (def.pct ? 20 : 8)) continue; // (too few attempts there: the wider scope)
            // how far it moved, against how much it swings round to round
            const per = rs.map((rd) => avgOf([rd], k, f)).filter(Boolean).map((x) => x.v);
            const m = per.reduce((t, v) => t + v, 0) / (per.length || 1);
            const sd = Math.max(1e-6, Math.sqrt(per.reduce((t, v) => t + (v - m) ** 2, 0) / Math.max(1, per.length - 1)));
            const z = ((a.v - b.v) / sd) * (def.higher === false ? -1 : 1);
            seen = true; looked.push({ def, vn: a.v, vs: b.v });
            // (update 449) only a stat that's really better than now, still better once rounded for the goal
            const dpK = def.pct ? 1 : def.dp ?? 1, rN = Math.round(a.v * 10 ** dpK), rS = Math.round(b.v * 10 ** dpK);
            const better = def.higher === false ? rN < rS : rN > rS;
            if (better && z > 0 && (!best || z > best.z)) best = { k, def, vn: a.v, vs: b.v, z, scope };
            break;
          }
        } }
        if (!best) {
          // (update 453) say why: no stat in the data, or the stats weren't better (with the numbers)
          const names = CAND(u.c, u.d).flat().map((k) => statDef(k).label);
          notes.push(!looked.length ? `${u.label}: the data has no ${names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0] || "stats"} for these rounds, so there\u2019s nothing to set a goal from.`
            : `${u.label}: in the ${K} rounds like this, ${looked.map((x) => `${x.def.label} was ${fmtStat(x.def, x.vn)} (season ${fmtStat(x.def, x.vs)})`).join(", ")}: not better, so no drill for it.`);
          continue;
        }
        const { k, def, vn, vs, scope } = best;
        const dp = def.pct ? 1 : def.dp ?? 1, tgt = Math.round(vn * 10 ** dp) / 10 ** dp;
        const goal = { stat: "obs", statKey: k, cat: scope === "whole" ? null : u.c, dist: scope === "exact" ? u.d : null, label: def.label, unit: def.pct ? "%" : def.unit || "", higher: def.higher !== false, dp, target: tgt, measure: "round", when: "nextN", n: 12 };
        const dr = drillFor(u.c, u.d, { k, def, ve: vn, exact: scope !== "whole" });
        if (dr) { dr.from = src === "tour" ? "tour rounds like this" : "own rounds like this"; dr.recFrom = src; }
        goal.recFrom = src;
        items.push({ drill: dr, goal, why: `${u.label}: ${def.label} ${fmtStat(def, vs)} now \u2192 ${fmtStat(def, vn)} in ${src === "tour" ? "tour rounds" : "their rounds"} like this` });
      }
      // one goal per stat: two drills on the same stat (an iron and a wood off the tee, say) share it
      const seenG = new Set();
      for (const x of items) { const gk = `${x.goal.statKey}|${x.goal.cat || ""}|${x.goal.dist || ""}`; if (seenG.has(gk)) x.goal = null; else seenG.add(gk); }
      return { items: items.filter((x) => x.drill), notes, K, n: rs.length, src };
    };
    const planMsg = S.st.hypoPlanMsg && S.st.hypoPlanMsg.key === S.me?.key && Date.now() - S.st.hypoPlanMsg.at < 120000 ? S.st.hypoPlanMsg : null;
    planCell = (u) => {
      const b = el("button", { type: "button", class: "hy-plan", "aria-label": `Add ${u.label} to practice` }, "\uFF0B Practice");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        let P; try { P = hypoPlan(u); } catch (err) { console.error(err); P = { err: "Couldn’t work that out just now." }; }
        if (P.err || !P.items.length) { S.st.hypoPlanMsg = { key: S.me?.key, row: u.label, at: Date.now(), text: `${P.err || (P.notes.join(" ").replace(/^[^:]*:\s*/, "")) || "nothing to practise for this change."}` }; S.draw(); return; }
        const whoseP = isMine(S.me?.key) || !S.me?.label ? "your" : `${S.me.label}’s`;
        const intro = el("div", { class: "hy-plan-why" }, [
          el("p", { class: `hy-src ${P.src}` }, P.src === "tour" ? `From the tour: ${whoseP === "your" ? "your" : "their"} own rounds don\u2019t match this what-if closely enough, so these come from the ${P.K} rounds by other players this season that average out to it.` : `From ${whoseP === "your" ? "your" : "their"} own rounds: ${P.K} of ${P.n} this season average out to this what-if.`),
          el("p", { class: "small" }, "The stat to work on:"),
          el("ul", { class: "small" }, P.items.map((x) => el("li", {}, x.why))),
          P.notes.length ? el("p", { class: "muted small" }, P.notes.join(" ")) : null]);
        planEditor(P.items.map(({ drill, goal }) => ({ drill, goal })), whoseP, async (list) => {
          b.disabled = true;
          try {
            const { addToPlan } = await import("./practice/plan.js");
            const n = await addToPlan(getState(), { items: list.map((x) => ({ ...x })), playerKey: S.me?.key, playerLabel: S.me?.label });
            for (const x of list) PLAN_ADDED.add(`${S.me?.key}|${x.drill.kind}|${x.drill.dist || ""}|${x.drill.lie || ""}`);
            const g = list.filter((x) => x.goal).length;
            S.st.hypoPlanMsg = { key: S.me?.key, row: u.label, at: Date.now(), text: `Added ${n} ${n === 1 ? "drill" : "drills"} to ${whoseP} practice plan${g ? ` and ${g} ${g === 1 ? "goal" : "goals"} to Goals` : ""} (from ${P.src === "tour" ? "tour rounds" : `${whoseP === "your" ? "your" : "their"} own rounds`}).`, link: true };
            S.draw();
          } catch (err) { console.error(err); b.disabled = false; S.st.hypoPlanMsg = { key: S.me?.key, row: u.label, at: Date.now(), text: "Couldn’t add that just now. Try again." }; S.draw(); }
        }, intro);
      });
      return b;
    };
    // (update 451) what happened shows right under the button that was tapped
    const msgEl = (m) => el("p", { class: "hy-plan-msg" }, [m.text, m.link ? " " : null,
      m.link ? el("a", { href: isMine(S.me?.key) ? "#/practice?tool=PLAN" : `#/practice?tool=PLAN&player=${encodeURIComponent(S.me?.key || "")}`, class: "link" }, "Open Practice \u2192") : null]);
    for (const [c, u] of planSlots) mount(c, [planCell(u), planMsg && planMsg.row === u.label ? msgEl(planMsg) : null]);
    const planLine = planMsg && !planSlots.some(([, u]) => u.label === planMsg.row) ? el("p", { class: "muted small hy-plan-msg" }, [planMsg.text, planMsg.link ? " " : null,
      planMsg.link ? el("a", { href: isMine(S.me?.key) ? "#/practice?tool=PLAN" : `#/practice?tool=PLAN&player=${encodeURIComponent(S.me?.key || "")}`, class: "link" }, "Open Practice →") : null]) : null;
    const reset = anyAdj ? (() => { const b = el("button", { type: "button", class: "link small" }, "Reset"); b.addEventListener("click", () => { S.st.hypoAdj = null; S.draw(); }); return b; })() : null;
    return el("div", { class: "bs-path bs-hypo" }, [
      el("div", { class: "bs-path-head" }, [el("p", { class: "bs-sub" }, tgl), reset]),
      el("div", { class: "bs-path-gap" }, [
        infoTip(noRk ? `Start from ${isMine(S.me?.key) ? "your" : "their"} season average (${N} rounds): strokes gained a round in each ${cat ? "distance" : "part of the game"}${cat ? "" : " (tap one to open its distances)"}. Tap \u2212 or + to make one worse or better (${step.toFixed(2)} a round each tap${cat ? "" : `, ${kidStep.toFixed(2)} for a distance`}), or tap the number to type one; a distance\u2019s change adds into its part of the game, and everything adds into the total. \uFF0B Practice, under any row made better, builds a drill and a goal from ${isMine(S.me?.key) ? "your" : "their"} own rounds that average out to it.` : `Start from their season average (${N} rounds): strokes gained a round in each ${cat ? "distance" : "part of the game"}${cat ? "" : " (tap one to open its distances)"}. Tap \u2212 or + to make one worse or better (${step.toFixed(2)} a round each tap${cat ? "" : `, ${kidStep.toFixed(2)} for a distance`}); a distance\u2019s change adds into its part of the game, and everything adds into the total. The rank is where that number would sit among every other player\u2019s average over the selected time frame (the same players as the rankings), and the arrow how far it moved from where the last ${N} rounds rank now.`)]),
      sumLine,
      planLine ? el("div", { class: "hy-plan-row" }, [planLine]) : null,
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-full-t bs-path-t hy-t" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", { class: "num" }, "Avg"), el("th", { class: "num" }, "What if"), el("th", { class: "num" }, noRk ? "" : "Season rank")])),
        el("tbody", {}, body),
      ])),
    ]);
  }
  // (update 341) Path back to Elite
  // (update 355) with rankings, the path has its own level to aim at (the next one up to start); without, the best
  // rounds picked above
  function pathOf() { return (() => {
      const season = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      if (!S.showRanks) return stretchOn ? S.pathBack(peak.rounds, season, cat, null) : null;
      const rows = S.ladderRows(mine, cat);
      const P = rows?.prof;
      if (!P) return null;
      // (update 355) current form: where their last N rounds' average would rank; the default is the next level above that
      const nR = Math.max(3, Math.min(season.length, Math.round(Number(S.st.recentN) || 12)));
      const recentT = S.stretchSeq(season.slice(-nR), cat).map((x) => x.t);
      const recentAvg = recentT.length ? recentT.reduce((a, v) => a + v, 0) / recentT.length : P.avg;
      const formRank = P.rankOf(recentAvg);
      const reach = rows.filter((r) => r.share?.k);
      const rk = { rankOf: P.rankOf, of: P.N, formRank }; // (update 455: the what-if's season rank)
      // (update 455) the best stretch picked (tapped in the line above): the last N rounds against it
      if (S.st.pathStretch === (cat || "")) {
        const bs = S.longestStretches(S.lastSliced || [], cat).find((r) => r.p.key === S.me.key);
        if (bs?.rds?.length) { const sigR = (rd) => `${String(rd.date || "")}|${rd.event || ""}|${rd.roundNo || ""}`; const ids = new Set(bs.rds.map(sigR)); const kept = season.filter((rd) => ids.has(sigR(rd))); return S.pathBack(kept.length ? kept : bs.rds, season, cat, null, { best: true, rk }); }
      }
      // (update 442) no card picked: their last N rounds against the rest of their rounds; a card picked: against that
      // level's rounds
      // (update 444) only while that card shows as picked (same level and same number of rounds); otherwise the rest
      const pick = S.st.vsRank === "peak" && S.st.ladderT ? reach.find((r) => r.target === S.st.ladderT && r.share.k === Math.max(1, Math.round(Number(S.st.peakN) || 0))) : null;
      if (!pick) { const rest = season.slice(0, -nR); return rest.length ? S.pathBack(rest, season, cat, null, { rest: true, rk }) : null; }
      const byLevel = [...reach].sort((a, b) => b.target - a.target); // #50 first
      const nextUp = byLevel.find((r) => r.target < formRank) || byLevel.at(-1);
      const kept = S.eliteOf(mine, cat, pick.share.k)?.rounds || [];
      if (!kept.length) return null;
      // the bar: the season average of the player ranked at that level (beat it to rank there)
      const barOf = (T) => P.field[T - 1] ?? null;
      const above = byLevel.filter((r) => r.target < pick.target).at(0) || null; // the next level up from the one picked
      return S.pathBack(kept, season, cat, { T: pick.target, reach, nextUp: nextUp.target, rank: P.seasonRank, formRank, bar: barOf(pick.target), above: above?.target ?? null }, { rk });
    })(); }
}
