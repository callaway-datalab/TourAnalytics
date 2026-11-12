// (sgDashboard split) The summary: the category cards, the summary box, the stretch / form boards and the tour blocks.
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { CATEGORIES, SUMMARY, applyFilters, el, fmtSG, infoTip, rank, sgColor, sgPerRound } from "./sgShared.js";
import { formWord } from "./sg.js"; // (update 670)
import { formUnits } from "./sgHero.js"; // (update 673: the same stretches as the Form pill)

// Rank of one player among the field for a metric computed on their (already sliced) rounds.
export function rankOf(S, slicedField, key, metric) {
  const entries = S.rankedField(slicedField).map((p) => ({ key: p.key, value: metric(p.rounds) ?? -Infinity }));
  const ranked = rank(entries);
  const r = ranked.find((x) => x.key === key);
  return r ? { rank: r.rank, of: ranked.length } : null;
}
/* ------------------------------ SG cards ------------------------------ */
export function cards(S, slicedField, f) {
  // Cards cover every category for the rounds picked (year, tournament, round, span), so their
  // values and ranks always compare like with like.
  const roundsOnly = { ...f, cats: [], lie: "", dist: "" }; // every category, whatever pills are picked
  const mineAll = S.me ? applyFilters(S.me.rounds, roundsOnly) : null;
  const fieldAll = S.field.map((p) => ({ ...p, rounds: applyFilters(p.rounds, roundsOnly) }));
  const mySG = mineAll ? sgPerRound(mineAll) : null;
  // No player picked: each card shows the average of every player's own SG / round.
  const playing = S.rankedField(fieldAll); // (Min. rounds, like the rankings)
  const fieldAvg = (k) => (playing.length ? playing.reduce((a, p) => a + sgPerRound(p.rounds)[k], 0) / playing.length : null);
  return el("div", { class: "sg-cards" }, SUMMARY.map(([k, label]) => {
    const pick = k === "TOTAL" ? [] : k === "T2G" ? S.T2G : [k];
    const on = pick.length === S.st.cats.length && pick.every((x) => S.st.cats.includes(x));
    let value, color, sub;
    if (S.me) {
      const r = S.rankOf(fieldAll, S.me.key, (rs) => sgPerRound(rs)[k]);
      const pct = r && r.of > 1 ? 1 - (r.rank - 1) / (r.of - 1) : 1;
      value = mySG[k]; color = sgColor(value ?? 0); sub = S.showRanks && r && r.of > 1 ? `Rank ${r.rank} of ${r.of}` : ""; // green gained, red lost
    } else {
      value = fieldAvg(k); color = value === null ? "inherit" : sgColor(value);
      sub = `Average of ${playing.length} ${playing.length === 1 ? "player" : "players"}`;
    }
    const card = el("div", { class: "sg-card" + (on ? " on" : ""), role: "button", tabindex: "0", title: `Show ${label.replace("SG: ", "")}` }, [
      el("h3", {}, label),
      el("p", { class: "sg-value", style: `color:${color}` }, fmtSG(value)),
      el("p", { class: "sg-rank" }, sub),
    ]);
    const go = () => { S.st.cats = [...pick]; S.draw(); };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return card;
  }));
}
export function relSeg(S) {
  if (S.opts.practice) return null;
  const b = (on, l, v) => { const x = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, l); x.addEventListener("click", () => { S.st.rel = v; try { localStorage.setItem("ta:rel", v ? "1" : "0"); } catch {} S.draw(); }); return x; };
  return el("div", { class: "seg small rel-pick", role: "group", "aria-label": "Values" }, [b(!!S.st.rel, "Relative to Avg", true), b(!S.st.rel, "Raw value", false)]); // (update 228)
}
export function rankAmong(S, slicedField, key, cat = null) {
  const vals = S.rankedField(slicedField).map((p) => ({ key: p.key, v: S.metric(p.rounds, cat) })).filter((x) => x.v != null).sort(S.byBest);
  const i = vals.findIndex((x) => x.key === key);
  return { rank: i >= 0 ? i + 1 : null, of: vals.length, leader: vals[0] || null, vals };
}
export function summaryBox(S, mine, slicedField) {
  const lines = [];
  const cats = CATEGORIES.filter(([k]) => !S.st.cats.length || S.st.cats.includes(k));
  const what = S.describe();
  if (S.me && mine && mine.length) {
    const name = S.me.label || "This player";
    const total = S.perRoundOf(mine), r = S.rankAmong(slicedField, S.me.key);
    lines.push(`${name} ${S.sgWord(total)} over ${mine.length} ${mine.length === 1 ? "round" : "rounds"} (${what})${r.rank && r.of > 1 ? `, ${S.ordinal(r.rank)} of ${r.of} players` : ""}.`);
    if (cats.length > 1) {
      const byCat = cats.map(([k, l]) => ({ l, v: S.perRoundOf(mine, k), rk: S.rankAmong(slicedField, S.me.key, k) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
      if (byCat.length > 1) {
        const best = byCat[0], worst = byCat[byCat.length - 1];
        lines.push(`Strongest: ${best.l} (${fmtSG(best.v)}${best.rk.rank && best.rk.of > 1 ? `, ${S.ordinal(best.rk.rank)}` : ""}). Weakest: ${worst.l} (${fmtSG(worst.v)}${worst.rk.rank && worst.rk.of > 1 ? `, ${S.ordinal(worst.rk.rank)}` : ""}).`);
      }
    } else if (cats.length === 1) {
      // one category: its best and worst distances
      const k = cats[0][0], m = new Map();
      for (const rd of mine) for (const x of rd.shots) if (x.cat === k && x.dist) m.set(x.dist, (m.get(x.dist) || 0) + x.sg);
      const ds = [...m].map(([d, t]) => ({ d, v: t / mine.length })).sort((a, b) => b.v - a.v);
      if (ds.length > 1) lines.push(`Best from ${ds[0].d} (${fmtSG(ds[0].v)} a round); lowest from ${ds[ds.length - 1].d} (${fmtSG(ds[ds.length - 1].v)}).`);
    }
    // form: the last 20 rounds against the 20 before them
    // (update 673) worked out exactly as the hero card's Form pill (the DP World Tour: by event, 5 against 5 and 20 against
    // 20; others: 20 rounds against 20 and 50 against 50), so the two always say the same
    const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const fu = formUnits(S, ordered), ev = S.eventMode, U = ev ? "events" : "rounds";
    const n = Math.min(ev ? 3 : 12, Math.floor(fu.length / 2)); // (update 694: Form, 12 against 12 (3 events against 3))
    if (n >= (ev ? 1 : 2)) {
      const val = (us) => S.perRoundOf(us.flat());
      const last = val(fu.slice(-n)), prev = val(fu.slice(-2 * n, -n)), ch = last - prev;
      // (update 670) the form word: this change and the overall direction (the last 50 against the 50 before)
      const nL = Math.min(ev ? 12 : 48, Math.floor(fu.length / 2)), L = nL > n ? val(fu.slice(-nL)) - val(fu.slice(-2 * nL, -nL)) : null;
      const w = formWord(ch, L)?.[0] || "Steady";
      lines.push(Math.abs(ch) < 0.05 ? `Form: ${w}. ${fmtSG(last)} a round over the last ${n} ${U}, about the same as the ${n} before.`
        : `Form: ${w}. ${fmtSG(last)} a round over the last ${n} ${U}, against ${fmtSG(prev)} in the ${n} before (${ch > 0 ? "better" : "worse"} by ${Math.abs(ch).toFixed(2)})${L != null ? `; ${L >= 0 ? "up" : "down"} ${Math.abs(L).toFixed(2)} over the last ${nL} against the ${nL} before` : ""}.`);
      const sl = S.steadinessLine(ordered, Math.min(20, Math.floor(ordered.length / 2))); if (sl) lines.push(sl); // (steadiness: round to round, 20 against 20)
    }
  } else {
    // no player picked: the group
    const r = S.rankAmong(slicedField, null);
    if (!r.of) return null;
    const avg = r.vals.reduce((t, x) => t + x.v, 0) / r.of;
    const lead = slicedField.find((p) => p.key === r.leader?.key);
    const last = r.vals[r.vals.length - 1], lastP = slicedField.find((p) => p.key === last?.key);
    lines.push(`${r.of} players (${what}). Leader: ${lead?.label || "\u2014"} (${fmtSG(r.leader.v)} a round)${r.of > 1 && lastP ? `; last: ${lastP.label} (${fmtSG(last.v)})` : ""}. Group average: ${fmtSG(avg)}.`);
    if (cats.length > 1) {
      const nameOf = (key) => slicedField.find((p) => p.key === key)?.label || "\u2014";
      const spread = cats.map(([k, l]) => { const v = S.rankAmong(slicedField, null, k).vals; return v.length > 1 ? { l, hi: v[0], lo: v[v.length - 1] } : null; }).filter(Boolean).sort((a, b) => (b.hi.v - b.lo.v) - (a.hi.v - a.lo.v));
      if (spread.length) lines.push(`Biggest gap between players: ${spread[0].l}, from ${nameOf(spread[0].hi.key)} (${fmtSG(spread[0].hi.v)}) to ${nameOf(spread[0].lo.key)} (${fmtSG(spread[0].lo.v)}) a round. Pick a player for their own summary.`);
    }
  }
  if (!lines.length) return null;
  return el("section", { class: "panel sg-summary" }, [el("h3", {}, "Summary"), ...lines.map((t) => el("p", {}, t))]);
}
export function longestStretches(S, slicedField, cat) {
  if (S.stretchesMemo.src !== slicedField) { S.stretchesMemo.src = slicedField; S.stretchesMemo.map = new Map(); }
  if (S.stretchesMemo.map.has(cat || "")) return S.stretchesMemo.map.get(cat || "");
  const ranked = S.rankedField(slicedField);
  const avgOf = new Map(ranked.map((p) => [p.key, S.perRoundOf(p.rounds, cat || null)]));
  const vals = [...avgOf.values()].filter((v) => v != null && Number.isFinite(v)).sort((a, b) => b - a);
  const rows = [];
  for (const p of ranked) {
    const mineAvg = avgOf.get(p.key);
    if (mineAvg == null) continue;
    const bar = vals[0] === mineAvg && vals.length > 1 ? vals[1] : vals[0]; // (the best of everyone else)
    const seq = S.stretchSeq(p.rounds, cat);
    if (!seq.length) continue;
    const pre = [0]; for (const x of seq) pre.push(pre.at(-1) + x.t);
    let found = null;
    for (let n = seq.length; n >= 1 && !found; n--) {
      for (let i = n; i < pre.length; i++) if ((pre[i] - pre[i - n]) / n > bar + 1e-12) { found = { n, from: seq[i - n].rd.date, to: seq[i - 1].rd.date, whole: n === seq.length, rds: seq.slice(i - n, i).map((x) => x.rd) }; break; }
    }
    rows.push({ p, ...(found || { n: 0 }), of: seq.length, bar });
  }
  rows.sort((a, b) => b.n - a.n || (avgOf.get(b.p.key) ?? -1e9) - (avgOf.get(a.p.key) ?? -1e9));
  S.stretchesMemo.map.set(cat || "", rows);
  return rows;
}
export function stretchBoard(S, slicedField) {
  const cat = S.st.cats.length === 1 ? S.st.cats[0] : "";
  const what = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
  const rows = S.longestStretches(slicedField, cat);
  const all = S.st.stretchAll; const shown = all ? rows : rows.slice(0, 25);
  const name = (p) => (S.pickable(p.key) ? (() => { const b = el("button", { type: "button", class: "hb-link ti-name", title: `Open ${p.label}` }, S.starred(p.key, p.label)); b.addEventListener("click", () => S.opts.onPick(p.key)); return b; })() : el("span", { class: "ti-name" }, S.starred(p.key, p.label)));
  let place = 0, prevN = null;
  const body = shown.map((r, i) => { if (r.n !== prevN) { place = i + 1; prevN = r.n; } return el("tr", {}, [
    el("td", { class: "num" }, r.n ? String(place) : "\u2014"), el("td", {}, name(r.p)),
    el("td", { class: "num strong" }, r.n ? (r.whole ? `${r.n} (all)` : String(r.n)) : "\u2014"),
    el("td", { class: "num muted" }, r.n ? (r.from === r.to ? S.shortDay(r.from) : `${S.shortDay(r.from)} \u2013 ${S.shortDay(r.to)}`) : "No round at a #1 level"),
    el("td", { class: "num muted" }, String(r.of)),
  ]); });
  const more = rows.length > 25 ? (() => { const b = el("button", { type: "button", class: "link small" }, all ? "Show the top 25" : `Show all ${rows.length}`); b.addEventListener("click", () => { S.st.stretchAll = !all; S.draw(); }); return b; })() : null;
  return S.panelBox(`Elite Stretches \u00b7 ${what}`, [
    infoTip(`Each player\u2019s longest run of rounds in a row that, as their average, would rank #1 in this selection: the longer, the longer they played at a #1 level. \u201call\u201d: their whole selection already ranks #1.`),
    el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-stretch-board" }, [
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num", title: "The longest run of rounds in a row at a #1 level" }, "Rounds"), el("th", { class: "num" }, "When"), el("th", { class: "num", title: "Rounds in this selection" }, "Of")])),
      el("tbody", {}, body),
    ])),
    more,
  ], "full");
}
// (update 333; 334: named Elite Round Share) on the Leaderboards: like Best Stretches, but the rounds don't have to be in a row. The most of a
// player's rounds that, taken together (their best ones), average at a #1 level for this selection, and that as a share
// of all their rounds; ranked by the share
export function formBoard(S, slicedField) {
  const cat = S.st.cats.length === 1 ? S.st.cats[0] : "";
  const what = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
  const ranked = S.rankedField(slicedField);
  const avgOf = new Map(ranked.map((p) => [p.key, S.perRoundOf(p.rounds, cat || null)]));
  const vals = [...avgOf.values()].filter((v) => v != null && Number.isFinite(v)).sort((a, b) => b - a);
  const rows = [];
  for (const p of ranked) {
    const mineAvg = avgOf.get(p.key);
    if (mineAvg == null) continue;
    const bar = vals[0] === mineAvg && vals.length > 1 ? vals[1] : vals[0]; // (the best of everyone else)
    const ts = S.stretchSeq(p.rounds, cat).map((x) => x.t).sort((a, b) => b - a);
    if (!ts.length) continue;
    // the best k rounds' average only falls as k grows: the largest k still above the bar
    let k = 0, sum = 0;
    for (let i = 0; i < ts.length; i++) { sum += ts[i]; if (sum / (i + 1) > bar + 1e-12) k = i + 1; else break; }
    rows.push({ p, k, of: ts.length, pct: k / ts.length });
  }
  rows.sort((a, b) => b.pct - a.pct || b.k - a.k);
  const all = S.st.formAll; const shown = all ? rows : rows.slice(0, 25);
  const name = (p) => (S.pickable(p.key) ? (() => { const b = el("button", { type: "button", class: "hb-link ti-name", title: `Open ${p.label}` }, S.starred(p.key, p.label)); b.addEventListener("click", () => S.opts.onPick(p.key)); return b; })() : el("span", { class: "ti-name" }, S.starred(p.key, p.label)));
  let place = 0, prev = null;
  const body = shown.map((r, i) => { const pc = Math.round(r.pct * 1000) / 10; if (pc !== prev) { place = i + 1; prev = pc; } return el("tr", {}, [
    el("td", { class: "num" }, r.k ? String(place) : "\u2014"), el("td", {}, name(r.p)),
    el("td", { class: "num strong" }, r.k ? `${pc.toFixed(1)}%` : "\u2014"),
    el("td", { class: "num" }, r.k ? String(r.k) : "0"),
    el("td", { class: "num muted" }, String(r.of)),
  ]); });
  const more = rows.length > 25 ? (() => { const b = el("button", { type: "button", class: "link small" }, all ? "Show the top 25" : `Show all ${rows.length}`); b.addEventListener("click", () => { S.st.formAll = !all; S.draw(); }); return b; })() : null;
  return S.panelBox(`Elite Round Share \u00b7 ${what}`, [
    infoTip(`How much of each player\u2019s golf was at a #1 level: the most of their rounds (their best ones, in any order) whose average would still rank #1 in this selection, as a share of all their rounds. 100%: their whole selection already ranks #1.`),
    el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-stretch-board" }, [
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num", title: "Share of their rounds at a #1 level" }, "Share"), el("th", { class: "num", title: "Their best rounds that together average at a #1 level" }, "Rounds"), el("th", { class: "num", title: "Rounds in this selection" }, "Of")])),
      el("tbody", {}, body),
    ])),
    more,
  ], "full");
}
export function tourBlocks(S, slicedField) {
  const P = S.rankedField(slicedField).filter((p) => p.rounds.length);
  if (P.length < 3) return [];
  const sg = S.isSG();
  const nameBtn = (p) => (S.pickable(p.key) ? (() => { const b = el("button", { type: "button", class: "hb-link ti-name", title: `Open ${p.label}` }, S.starred(p.key, p.label)); b.addEventListener("click", () => S.opts.onPick(p.key)); return b; })() : el("span", { class: "ti-name" }, S.starred(p.key, p.label)));
  const sgCell = (v) => el("strong", { class: `ti-v ${S.signCls(v)}` }, fmtSG(v));
  const good = (ch) => (S.def.higher == null ? null : S.higherBetter() ? ch > 0 : ch < 0); // a change for the better?
  const blocks = [];
  const cats = CATEGORIES.filter(([k]) => S.catsAvail.some(([c]) => c === k));

  // 1. category leaders (strokes gained): everyone ranked, best first; the list scrolls
  if (sg && cats.length > 1) {
    blocks.push(S.panelBox("Category Leaders", el("div", { class: "ti-leaders" }, cats.map(([k, l]) => {
      const top = P.map((p) => ({ p, v: S.perRoundOf(p.rounds, k) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
      return el("div", { class: "ti-col" }, [el("p", { class: "ti-col-title" }, l), el("ol", { class: "ti-list ti-scroll", tabindex: "0", "aria-label": `${l} leaders` }, top.map((x) => el("li", {}, [nameBtn(x.p), sgCell(x.v)])))]);
    })), "full"));
  }

  // 2. hot and cold: the last 12 rounds against the 12 before them
  const series = (p) => [...p.rounds].filter((rd) => !sg || !rd.eventLevel).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  {
    const form = P.map((p) => {
      const rs = series(p).filter((rd) => S.metric([rd]) != null);
      if (rs.length < 40) return null; // (update 663: the last 20 against the 20 before)
      const last = S.metric(rs.slice(-20)), before = S.metric(rs.slice(-40, -20));
      return last == null || before == null ? null : { p, last, before, ch: last - before };
    }).filter(Boolean);
    if (form.length >= 4) {
      const up = (x) => (S.def.higher === false ? -x.ch : x.ch); // how much better (or just higher, when neither is better)
      const hot = form.filter((x) => up(x) > 0).sort((a, b) => up(b) - up(a)).slice(0, 5), cold = form.filter((x) => up(x) < 0).sort((a, b) => up(a) - up(b)).slice(0, 5);
      const cls = (ch) => { const g = good(ch); return g == null ? "" : g ? "pos" : "neg"; };
      const list = (xs) => (xs.length ? el("ol", { class: "ti-list" }, xs.map((x) => el("li", {}, [el("span", { class: "ti-who" }, [nameBtn(x.p), el("span", { class: "ti-sub muted" }, `${S.fmtV(x.last)} last 20, ${S.fmtV(x.before)} previous 20`)]), el("strong", { class: `ti-v ${cls(x.ch)}` }, `${x.ch >= 0 ? "\u25B2" : "\u25BC"} ${S.fmtDelta(x.ch)}`)]))) : el("p", { class: "muted small" }, "No one."));
      blocks.push(S.panelBox("Hot & Cold", [el("div", { class: "ti-two" }, [el("div", {}, [el("p", { class: "ti-col-title" }, S.def.higher == null ? "Going up" : "Heating up"), list(hot)]), el("div", {}, [el("p", { class: "ti-col-title" }, S.def.higher == null ? "Going down" : "Cooling off"), list(cold)])])]));
    }
  }

  // 3. the steadiest and the streakiest: how much a player's rounds swing (standard deviation)
  {
    const steady = P.map((p) => { const t = S.roundVals(series(p)); return t.length >= 8 ? { p, s: S.sdOf(t), avg: S.metric(series(p)) } : null; }).filter(Boolean);
    if (steady.length >= 4) {
      const most = [...steady].sort((a, b) => a.s - b.s).slice(0, 5), least = [...steady].sort((a, b) => b.s - a.s).slice(0, 5);
      // (update 163) the steadiest in green, the streakiest in red
      const list = (xs, tone) => el("ol", { class: "ti-list" }, xs.map((x) => el("li", {}, [el("span", { class: "ti-who" }, [nameBtn(x.p), el("span", { class: "ti-sub muted" }, sg ? `${fmtSG(x.avg)} a round` : `${S.fmtV(x.avg)} average`)]), el("strong", { class: `ti-v ${tone}` }, `\u00b1${S.fmtDelta(x.s)}`)])));
      blocks.push(S.panelBox("Steadiest & Streakiest", [el("div", { class: "ti-two" }, [el("div", {}, [el("p", { class: "ti-col-title" }, "Steadiest"), list(most, "pos")]), el("div", {}, [el("p", { class: "ti-col-title" }, "Streakiest"), list(least, "neg")])])]));
    }
  }

  // 4. tournaments: when, how many played, and the best in the field (among those who played every round)
  {
    const all = S.eventsOf(P);
    const wins = new Map(), tops = new Map();
    for (const e of all) { // (oldest first, so a second win shows "(2)")
      if (e.best) { const n = (wins.get(e.best.p)?.n || 0) + 1; wins.set(e.best.p, { p: e.best.p, n }); e.winNo = n; }
      for (const x of e.top10) tops.set(x.p, { p: x.p, n: (tops.get(x.p)?.n || 0) + 1 });
    }
    const list = [...all].reverse();
    if (list.length >= 2) {
      blocks.push(S.panelBox("Tournaments", [el("div", { class: "table-scroll ti-events-scroll", tabindex: "0" }, el("table", { class: "plain rankings ti-events" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), el("th", { class: "num" }, "Players"), el("th", {}, "Best in the field")])),
        el("tbody", {}, list.map((e) => el("tr", {}, [el("td", { class: "ht-date" }, S.dateTxt(e.end)), el("td", {}, e.event), el("td", { class: "num" }, String(e.players)),
          el("td", {}, e.best ? [nameBtn(e.best.p), e.winNo > 1 ? el("span", { class: "ti-winno" }, ` (${e.winNo})`) : null] : "\u2014")]))),
      ]))], "full"));
      // Wins (led the field in this stat), Top 10s (the same way), and the FedEx Cup and OWGR (coming)
      const col = (title, rows, empty) => el("div", { class: "ti-col" }, [el("p", { class: "ti-col-title" }, title),
        rows.length ? el("ol", { class: "ti-list ti-scroll", tabindex: "0", "aria-label": title }, rows.map((x) => el("li", {}, [nameBtn(x.p), el("strong", { class: "ti-v" }, String(x.n))])))
          : el("p", { class: "muted small" }, empty)]);
      const byN = (m) => [...m.values()].filter((x) => x.n >= 1).sort((a, b) => b.n - a.n || String(a.p.label).localeCompare(String(b.p.label)));
      blocks.push(S.panelBox("Wins & Rankings", [el("div", { class: "ti-leaders" }, [
        col("Wins", byN(wins), "No wins in this selection."), col("Top 10s", byN(tops), "No top 10s in this selection."),
        col("FedEx Cup", [], "Coming soon."), col("OWGR", [], "Coming soon."),
      ])], "full"));
    }
  }

  return blocks.length ? [el("div", { class: "sg-grid ti-grid" }, blocks)] : [];
}
