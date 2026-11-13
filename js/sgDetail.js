// (sgDashboard split) The category detail: stat blocks, trends, rankings, SG Trends by Product, SG by Club.
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { LEAVE_SCALE, catName, el, fmtSG, gearInfo, gearList, getState, groupObs, infoTip, leaveHistogram, leavePoints, localDay, missSplit, nf1, shortDate, sliceTotals, statAgg, trend } from "./sgShared.js";

/* ------------------------------ category detail ------------------------------ */
export function detailBlocks(S, mine, slicedField) {
  const blocks = [];
  const cat = S.st.cats.length === 1 ? S.st.cats[0] : ""; // one category: its full detail
  if (!cat) {
    // (update 444) no SG by Category or SG by Lie charts: the SG Trends chart is the one chart kept
    // (update 218) SG by Club: only with one category picked (below)
    // (update 229) the stats table with no category: SG: Total and each category, and the scoring averages
    blocks.unshift(S.panelBox(S.describe(), S.fullStatTable(mine, "", slicedField)), el("section", { class: "panel sg-box" }, S.fullStatTable(mine, "", slicedField, "elite")));
  } else {
    // (update 227) one full table, as on Compare (one column: this player): strokes gained a round in this part of the
    // game and at each distance, then every stat recorded for it (all distances, then each distance)
    blocks.push(S.panelBox(S.describe(), S.fullStatTable(mine, cat, slicedField)), el("section", { class: "panel sg-box" }, S.fullStatTable(mine, cat, slicedField, "elite")));

    const visuals = [];
    if (cat === "OTT") { const miss = missSplit(mine, S.idx); if (miss) visuals.push(S.panelBox("Miss Tendencies", S.missBar(miss))); }
    if (cat === "APP" || cat === "ARG") {
      const pts = leavePoints(mine, S.idx, cat);
      if (pts) visuals.push(S.panelBox("Leave Distribution (ft)", S.chartBox((c) => S.scatterChart(c, pts, LEAVE_SCALE[cat]), "tall")));
      else { const hist = leaveHistogram(mine, S.idx, cat); if (hist) visuals.push(S.panelBox("Leave Distribution (ft)", S.chartBox((c, as) => S.barChart(c, hist.map((h) => h.label), hist.map((h) => h.count), { single: "blue", title: "Shots", as }), "", `${cat}-leave`))); }
    }
    // (update 444) no SG by distance / lie / … bar charts
    // (update 299) no SG by Club chart: products are on SG Trends (Show Product)
    if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
  }

  // (update 445) always by product (no Show Product button); the plain chart only when no shot has a product on it
  const prodOn = mine.some((rd) => rd.shots.some((x) => x.gear || x.ball));
  // (update 302) Show Product: its own toggle, to the right of the Round / Event / Month / Year pills
  const toggles = el("div", { class: "trend-row" }, [
    el("div", { class: "subnav small trend-toggles" }, [["round", "Round"], ["event", "Event"], ["month", "Month"], ["year", "Year"]].filter(([v]) => !(S.eventView && v === "round")).map(([v, l]) => { /* (update 523) */
      const a = el("a", { href: "#", "aria-current": v === S.st.trendBy ? "page" : null }, l);
      a.addEventListener("click", (e) => { e.preventDefault(); S.st.trendBy = v; S.draw(); });
      return a;
    })),
  ]);
  if (prodOn) { blocks.push(S.productTrend(mine, cat, toggles)); return blocks; }
  const t = trend(mine, cat || null, S.st.trendBy);
  // Each round / event / month / year: the best result there (Top 1), the average of the best few (Top 10 …)
  // or of everyone (All), among the players who played it, this player included (so if they had the best
  // round, their bar meets the dot).
  const others = S.rankedField(slicedField).filter((p) => p.key !== S.me.key);
  const otherTrends = others.map((p) => trend(p.rounds, cat || null, S.st.trendBy));
  // (update 308) Personal Peak: its average (the same rounds as the table) as the dot on every bar
  const pkT = S.st.vsRank === "peak" && !S.soloTour ? S.curPeak() : null;
  const pkV = pkT && !pkT.short ? pkT.rounds.reduce((tt, rd) => tt + rd.shots.reduce((a, x) => a + (!cat || x.cat === cat ? x.sg : 0), 0), 0) / pkT.rounds.length : null;
  const tCompare = pkV != null ? t.map(() => pkV) : others.length ? t.map((g) => S.topMean([g.value, ...otherTrends.map((ot) => ot.find((x) => (x.id ?? x.label) === (g.id ?? g.label))?.value)])) : null;
  const unit = { round: "round", event: "event", month: "month", year: "year" }[S.st.trendBy] || "event";
  blocks.push(S.panelBox("SG Trends", [toggles, S.chartBox((c, as) => S.barChart(c, t.map((g) => g.label), t.map((g) => g.value), {
    title: "SG / round", as, compare: tCompare && tCompare.some((v) => v != null) ? tCompare : null, compareLabel: S.compareName(unit),
    shortLabels: t.map((g) => g.short),
    tooltip: (i) => (S.st.trendBy === "round" ? t[i].event : `${t[i].rounds} ${t[i].rounds === 1 ? "round" : "rounds"}`),
  }), "wide", "trend", { rankPick: others.length > 0 })], "full"));
  return blocks;
}
/* ------------------------------ any other stat (Hit Green %, Putts / Round, Driving Distance ...) ------------------------------ */
// The same page as strokes gained: the hero card (or leaderboard), a summary, the rankings, then whatever this
// stat can be split by (category, distance, lie) and its trend. What shows follows what the data has.
export function statBlocks(S, mine, slicedField, f) {
  const blocks = [S.heroBox(mine, slicedField, f), S.statSummary(mine, slicedField)];
  if (!S.me) return [...blocks, ...S.tourBlocks(slicedField)]; // (the field's form, steadiness, tournaments and wins in this stat)
  if (!mine || !mine.length) { blocks.push(el("section", { class: "panel" }, el("p", { class: "empty center" }, `No ${S.def.label} for ${S.me.label} in this selection.`))); return blocks; }
  blocks.push(...S.statDetail(mine, slicedField));
  blocks.push(S.statTrend(mine, slicedField));
  return blocks;
}
export function statSummary(S, mine, slicedField) {
  const lines = [], what = S.describe();
  const r = S.rankAmong(slicedField, S.me && mine?.length ? S.me.key : null);
  const avg = r.vals.length ? r.vals.reduce((t, x) => t + x.v, 0) / r.vals.length : null;
  const better = (a, b) => (S.def.higher == null ? null : S.def.higher ? a > b : a < b);
  if (S.me && mine && mine.length) {
    const v = S.metric(mine);
    lines.push(`${S.me.label}: ${S.def.label} ${S.fmtV(v)} over ${S.rw(mine.length)}${what ? ` (${what})` : ""}${r.rank && r.of > 1 ? `, ${S.ordinal(r.rank)} of ${r.of} players` : ""}.`);
    // (update 326) a percentage: how many of how many (made / hit, and the attempts)
    if (S.def.pct) {
      const a = statAgg(mine, S.narrowedNow());
      if (a.w > 0 && a.value != null) lines.push(`${Math.round((a.value * a.w) / 100).toLocaleString()} of ${Math.round(a.w).toLocaleString()} (successes of attempts).`);
    }
    if (avg != null && r.of > 1 && v != null) {
      const b = better(v, avg);
      lines.push(`Tour Players\u2019 average: ${S.fmtV(avg)}${b === null || Math.abs(v - avg) < 1e-9 ? "." : `, so ${b ? "better" : "worse"} than average.`}`);
    }
    const cat = S.st.cats.length === 1 ? S.st.cats[0] : S.catsAvail.length === 1 ? S.catsAvail[0][0] : "";
    if (!cat && S.catsAvail.length > 1) {
      const parts = S.catsAvail.filter(([k]) => !S.st.cats.length || S.st.cats.includes(k)).map(([k, l]) => ({ l, v: S.metric(mine, k) })).filter((x) => x.v != null);
      if (parts.length > 1) lines.push(`By category: ${parts.map((x) => `${x.l} ${S.fmtV(x.v)}`).join(", ")}.`);
    } else if (cat && S.def.higher != null) {
      // its best and lowest distance (with at least 3 attempts, so one lucky shot doesn't lead)
      const ds = groupObs(mine, cat, "distanceRange").filter((g) => g.w >= 3 && g.value != null).sort((a, b) => (S.def.higher ? b.value - a.value : a.value - b.value));
      if (ds.length > 1) lines.push(`Best from ${ds[0].label} (${S.fmtV(ds[0].value)}, ${Math.round(ds[0].w)} attempts); lowest from ${ds[ds.length - 1].label} (${S.fmtV(ds[ds.length - 1].value)}, ${Math.round(ds[ds.length - 1].w)} attempts).`);
    }
    const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const n = Math.min(20, Math.floor(ordered.length / 2)); // (update 663: 20 against 20)
    if (n >= 2) {
      const last = S.metric(ordered.slice(-n)), prev = S.metric(ordered.slice(-2 * n, -n));
      if (last != null && prev != null) {
        const steady = Math.abs(last - prev) < S.steadyBand(prev), b = better(last, prev);
        lines.push(steady ? `Steady: ${S.fmtV(last)} over the last ${S.rw(n)}, about the same as the ${n} before.`
          : `Last ${S.rw(n)}: ${S.fmtV(last)}, against ${S.fmtV(prev)} in the ${n} before${b === null ? "" : `: ${b ? "better" : "worse"}`}.`);
      }
      const sl = S.steadinessLine(ordered, n); if (sl) lines.push(sl);
    }
  } else if (r.of) {
    const nameOf = (key) => slicedField.find((p) => p.key === key)?.label || "\u2014";
    const last = r.vals[r.vals.length - 1];
    lines.push(`${r.of} players${what ? ` (${what})` : ""}. ${S.def.higher === false ? "Lowest" : "Highest"}: ${nameOf(r.leader.key)} (${S.fmtV(r.leader.v)})${r.of > 1 ? `; ${S.def.higher === false ? "highest" : "lowest"}: ${nameOf(last.key)} (${S.fmtV(last.v)})` : ""}. Average: ${S.fmtV(avg)}. Pick a player for their own summary.`);
  }
  if (!lines.length) return null;
  return el("section", { class: "panel sg-summary" }, [el("h3", {}, "Summary"), ...lines.map((t) => el("p", {}, t))]);
}
export function statDetail(S, mine, slicedField) {
  const blocks = [], visuals = [];
  const cat = S.st.cats.length === 1 ? S.st.cats[0] : S.catsAvail.length === 1 ? S.catsAvail[0][0] : "";
  const detailOK = S.cmpDetailOK(); // others' lie / distance detail (the admin); the shared summary has categories only
  // the gold dots: the same players as on the strokes-gained charts (none when there's nobody else to compare with)
  const cmpField = S.rankedField(slicedField).some((p) => p.key !== S.me.key) ? S.topPlayers(slicedField) : [];
  const tip = (groups) => (i) => (S.def.pct && groups[i].value != null // (update 326: a percentage: successes of attempts)
    ? `${Math.round((groups[i].value * groups[i].w) / 100).toLocaleString()} of ${Math.round(groups[i].w).toLocaleString()} attempts`
    : `${Math.round(groups[i].w).toLocaleString()} ${Math.round(groups[i].w) === 1 ? "attempt" : "attempts"}`);
  if (!cat && S.catsAvail.length > 1) {
    const shown = S.catsAvail.filter(([k]) => !S.st.cats.length || S.st.cats.includes(k));
    const bars = shown.map(([k, l]) => ({ label: l, value: S.metric(mine, k) }));
    const compare = cmpField.length ? shown.map(([k]) => S.avgOf(cmpField.map((p) => S.metric(p.rounds, k)))) : null;
    visuals.push(S.panelBox(`${S.def.label} by Category`, S.chartBox((c, as) => S.barChart(c, bars.map((b) => b.label), bars.map((b) => b.value), {
      title: S.def.label, as, single: "blue", compare, compareLabel: S.compareName() }), "", `${S.statKey}-cat`, { rankPick: cmpField.length > 0 })));
    const lies = groupObs(mine, null, "lie");
    if (lies.length > 1) {
      const lc = detailOK && cmpField.length ? lies.map((g) => S.avgOf(cmpField.map((p) => groupObs(p.rounds, null, "lie").find((x) => x.label === g.label)?.value))) : null;
      visuals.push(S.panelBox(`${S.def.label} by Lie`, S.chartBox((c, as) => S.barChart(c, lies.map((g) => g.label), lies.map((g) => g.value), {
        title: S.def.label, as, single: "blue", compare: lc, compareLabel: S.compareName(), tooltip: tip(lies) }), "", `${S.statKey}-lie`, { rankPick: !!lc })));
    }
  }
  if (cat) {
    const catLabel = catName(cat);
    const dims = [["distanceRange", "Distance"], ["lie", "Lie"]].map(([fieldName, name]) => ({ fieldName, name, groups: groupObs(mine, cat, fieldName) }));
    for (const d of dims) {
      if (d.groups.length < 2) continue;
      const cmp = detailOK && cmpField.length ? d.groups.map((g) => S.avgOf(cmpField.map((p) => groupObs(p.rounds, cat, d.fieldName).find((x) => x.label === g.label)?.value))) : null;
      visuals.push(S.panelBox(`${S.def.label} by ${d.name} \u00b7 ${catLabel}`, S.chartBox((c, as) => S.barChart(c, d.groups.map((g) => g.label), d.groups.map((g) => g.value), {
        title: S.def.label, as, single: "blue", compare: cmp, compareLabel: S.compareName(), tooltip: tip(d.groups) }), "", `${S.statKey}-${cat}-${d.fieldName}`, { rankPick: !!cmp })));
    }
    if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
    // distance by lie: every bucket the data has, with how many attempts each value comes from
    const [dist, lie] = dims;
    if (dist.groups.length > 1 && lie.groups.length > 1) blocks.push(S.statMatrix(mine, cat, dist.groups.map((g) => g.label), lie.groups.map((g) => g.label), catLabel));
    return blocks;
  }
  if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
  return blocks;
}
export function statMatrix(S, mine, cat, dists, lies, catLabel) {
  const cell = new Map(), add = (k, o) => { const c = cell.get(k) || { s: 0, w: 0 }; c.s += o.v * o.w; c.w += o.w; cell.set(k, c); };
  for (const rd of mine) for (const o of rd.shots) {
    if (o.cat !== cat || o.dist == null) continue;
    add(`${o.dist}|${o.lie}`, o); add(`${o.dist}|*`, o); if (o.lie != null) add(`*|${o.lie}`, o); add("*|*", o);
  }
  const td = (k, strong = false) => {
    const c = cell.get(k);
    if (!c || !c.w) return el("td", { class: "num muted" }, "\u2014");
    return el("td", { class: "num" }, [el(strong ? "strong" : "span", {}, S.fmtV(c.s / c.w)), el("span", { class: "mx-n" }, ` ${Math.round(c.w)}`)]);
  };
  const table = el("table", { class: "plain stats stat-matrix" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Distance"), ...lies.map((l) => el("th", { class: "num" }, l)), el("th", { class: "num" }, "All lies")])),
    el("tbody", {}, [...dists.map((d) => el("tr", {}, [el("td", {}, d), ...lies.map((l) => td(`${d}|${l}`)), td(`${d}|*`, true)])),
      el("tr", { class: "mx-total" }, [el("td", {}, "All distances"), ...lies.map((l) => td(`*|${l}`, true)), td("*|*", true)])]),
  ]);
  return S.panelBox(`${S.def.label} by Distance and Lie \u00b7 ${catLabel}`, [el("div", { class: "table-scroll" }, table),
    infoTip("The small number is how many attempts each value comes from.")], "full");
}
export function statTrend(S, mine, slicedField) {
  const groups = S.groupBy(mine, S.st.trendBy);
  const vals = groups.map((g) => S.metric(g.rounds));
  // each round / event / month / year: the best result(s) there among the players who played it (this player included)
  const others = S.rankedField(slicedField).filter((p) => p.key !== S.me.key);
  const otherGroups = others.map((p) => S.groupBy(p.rounds, S.st.trendBy));
  const cmp = others.length ? groups.map((g, i) => S.topMean([vals[i], ...otherGroups.map((og) => { const x = og.find((y) => y.id === g.id); return x ? S.metric(x.rounds) : null; })], S.def.higher !== false)) : null;
  const toggles = el("div", { class: "subnav small trend-toggles" }, [["round", "Round"], ["event", "Event"], ["month", "Month"], ["year", "Year"]].filter(([v]) => (S.unit !== "event" && !S.eventView) || v !== "round").map(([v, l]) => {
    const a = el("a", { href: "#", "aria-current": v === S.st.trendBy ? "page" : null }, l);
    a.addEventListener("click", (e) => { e.preventDefault(); S.st.trendBy = v; S.draw(); });
    return a;
  }));
  const key = "stat-trend";
  const each = { round: "round", event: "event", month: "month", year: "year" }[S.st.trendBy] || "event";
  return S.panelBox(`${S.def.label} Trend`, [toggles, S.chartBox((c, as) => S.barChart(c, groups.map((g) => g.label), vals, {
    title: S.def.label, as, single: "blue", compare: cmp && cmp.some((v) => v != null) ? cmp : null, compareLabel: S.compareName(each), shortLabels: groups.map((g) => g.short),
    tooltip: (i) => S.rw(groups[i].rounds.length),
  }), "wide", key, { rankPick: others.length > 0 })], "full");
}
export function minFor(S, most) {
  S.curMost = most;
  if (S.st.minRounds == null) return S.minDefault(most);
  const set = Math.max(1, Number(S.st.minRounds) || 1), at = Number(S.st.minRoundsAt) || 0;
  const v = at > 0 && most > 0 && at !== most ? Math.round((set * most) / at) : set;
  return Math.max(1, Math.min(v, Math.max(1, most)));
}
export function minRoundsBox(S, players, onMin = null) {
  const v = S.minRoundsFor(players);
  const inp = el("input", { type: "number", min: 1, max: 999, value: v, class: "hb-min-in", "aria-label": "Minimum rounds played" });
  const most = S.curMost;
  inp.addEventListener("change", () => { S.st.minRounds = Math.max(1, Math.round(Number(inp.value) || 1)); S.st.minRoundsAt = most; setTimeout(onMin || S.draw, 0); });
  const what = S.sgEligible ? "round" : S.unit;
  return el("label", { class: "hb-min", title: S.sgEligible && !S.isSG() ? "Only players with at least this many strokes-gained rounds in the selection (the same players for every stat)" : `Only players with at least this many ${what}s in the selection` }, [`Min. ${what}s`, inp]);
}
export function rankingsBlock(S, slicedField, onMin = null) {
  const sg = S.isSG();
  // strokes gained: SG / Round and attempts a round; another stat: its value and, when it has categories, the attempts
  const showAtt = sg || S.catsAvail.length > 0;
  const ranked = S.rankedField(slicedField).map((p) => {
    if (sg) { const t = sliceTotals(p.rounds); return { key: p.key, label: p.label, value: t.sgPerRound ?? -Infinity, rounds: t.rounds, att: t.attemptsPerRound }; }
    const a = statAgg(p.rounds, S.narrowedNow());
    return { key: p.key, label: p.label, value: a.value, rounds: p.rounds.length, att: a.w };
  }).filter((r) => sg || r.value != null).map((r) => ({ ...r, v: r.value })).sort(S.byBest).map((r, i) => ({ ...r, rank: i + 1 }));
  const third = Math.max(1, Math.ceil(ranked.length / 3));
  // (update 226) relative: each player's value less the average of everyone else ranked
  const okVals = ranked.filter((r) => r.value != null && Number.isFinite(r.value));
  const sumV = okVals.reduce((t, r) => t + r.value, 0), nV = okVals.length;
  const relOf = (r) => (S.relOn() && nV > 1 && r.value != null && Number.isFinite(r.value) ? r.value - (sumV - r.value) / (nV - 1) : null);
  const search = el("input", { type: "search", placeholder: "Find a player\u2026", value: S.st.rankQuery, "aria-label": "Find a player in the rankings" });
  const body = el("tbody", {}, ranked.map((r) => el("tr", {
    class: `tier-${r.rank <= third ? "top" : r.rank > ranked.length - third ? "bottom" : "mid"}` + (r.key === S.me?.key ? " me" : ""),
    "data-name": r.label.toLowerCase(),
  }, [
    el("td", { class: "num" }, String(r.rank)),
    el("td", {}, S.starred(r.key, r.label)),
    S.relOn() ? el("td", { class: `num ${S.relCls(relOf(r))}` }, S.fmtRel(relOf(r))) : el("td", { class: "num" }, S.fmtV(r.value === -Infinity ? null : r.value)),
    showAtt ? el("td", { class: "num" }, r.att === null ? "\u2014" : sg ? nf1.format(r.att) : Math.round(r.att).toLocaleString()) : null,
    el("td", { class: "num" }, String(r.rounds)),
  ])));
  const applySearch = () => {
    const q = search.value.trim().toLowerCase();
    S.st.rankQuery = search.value;
    body.querySelectorAll("tr").forEach((tr) => { tr.hidden = !!q && !tr.dataset.name.includes(q); });
    if (!q) S.centerRankings();
  };
  search.addEventListener("input", applySearch);
  S.rankScroll = el("div", { class: "table-scroll rank-scroll" }, el("table", { class: "plain rankings" }, [
    el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, S.relOn() ? (sg ? "SG vs Field" : `${S.def.label} vs Field`) : sg ? "SG / Round" : S.def.label),
      !showAtt ? null : sg ? el("th", { class: "num" }, [el("span", { class: "long" }, "Attempts / Round"), el("span", { class: "short" }, "Att / Rd")]) : el("th", { class: "num" }, [el("span", { class: "long" }, "Attempts"), el("span", { class: "short" }, "Att")]),
      el("th", { class: "num" }, S.Unit())])),
    body,
  ]));
  requestAnimationFrame(applySearch);
  // a magnifying-glass button (top right) opens the search; ✕ or Esc closes it and shows everyone again
  const open = !!S.st.rankOpen || !!S.st.rankQuery;
  const glass = el("button", { type: "button", class: "rank-glass", "aria-label": "Search the rankings for a player", title: "Search for a player", "aria-expanded": open ? "true" : "false" });
  glass.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  const closeBtn = el("button", { type: "button", class: "rank-close", "aria-label": "Close the search" }, "\u2715");
  const searchBox = el("div", { class: "rank-tools", hidden: !open }, [search, closeBtn]);
  const shut = () => { S.st.rankOpen = false; search.value = ""; applySearch(); searchBox.hidden = true; glass.setAttribute("aria-expanded", "false"); glass.focus(); };
  glass.addEventListener("click", () => {
    if (!searchBox.hidden) { shut(); return; }
    S.st.rankOpen = true; searchBox.hidden = false; glass.setAttribute("aria-expanded", "true"); search.focus();
  });
  closeBtn.addEventListener("click", shut);
  search.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } });
  // (players and coaches only: not for the admin or analysts)
  const searchable = !getState().isAdmin && S.opts.teamRole !== "analyst";
  const minBox = S.minRoundsBox(slicedField.filter((p) => p.rounds.length), onMin);
  minBox.classList.add("rank-min"); if (searchable) minBox.classList.add("with-glass");
  return S.panelBox(`Rankings \u00b7 ${sg ? "" : `${S.def.label} \u00b7 `}${S.describe()}`.replace(/ \u00b7 $/, ""), [
    minBox,
    searchable ? glass : null,
    searchable ? searchBox : null,
    ranked.length ? S.rankScroll : el("p", { class: "empty" }, "No rounds match these filters."),
    S.fieldIsSummary() && S.narrowed() ? infoTip("Rankings follow year, tournament, round and category, not lie or distance.") : null,
    !sg && S.def.higher === false ? infoTip("Lower is better, so the lowest is ranked first.") : !sg && S.def.higher == null ? infoTip("Ranked highest first (the file doesn\u2019t say whether higher is better).") : null,
  ], "full");
}
// Start the rankings scrolled so the selected player sits in the middle (e.g. ranks 45-55 for 50th).
export function centerRankings(S) {
  requestAnimationFrame(() => {
    const row = S.rankScroll?.querySelector("tr.me");
    if (!row || row.hidden) return;
    S.rankScroll.scrollTop = row.offsetTop - S.rankScroll.clientHeight / 2 + row.offsetHeight / 2;
  });
}
// (update 712) who may change a player's products: the admin, and their team (coaches, analysts)
const canEditProducts = (S) => { const st = getState(); return !!S.me?.key && (!!st.isAdmin || !!st.isTeam); };
// (update 713) Edit: the chart's bars can be tapped; a tapped tournament opens a small panel under the chart with every
// product in the key (and a box for a new name). EDIT is kept across redraws.
const EDIT = { on: false, ev: null };
async function saveProductChange(S, { kind, g, from, to, edits, status }) {
  const kinds = S.PROD_KINDS?.[kind] || [];
  const prior = edits.find((e) => e.event === g.event && String(e.year) === String(g.year) && e.to === from); // (changing a change: keep what the data had)
  status.textContent = "Saving\u2026";
  try {
    const pe = await import("./productEdits.js");
    await pe.saveProductEdit(S.me.key, { ...(prior ? { id: prior.id } : {}), event: g.event, year: g.year, pk: kind, kinds, from: prior ? prior.from ?? null : from, to, label: g.label });
    status.textContent = "Saved. Reloading so every page uses it\u2026"; location.reload();
  } catch (err) { console.error(err); status.textContent = "Couldn\u2019t save that. Only the admin and the player\u2019s team can change products (and the productEdits rule must be published)."; }
}
export function productEditPanel(S, { kind, g, order, nameOf, colorOf, edits }) {
  const here = [...g.prods].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  let from = here[0] ?? null, to = null;
  const status = el("p", { class: "muted small", role: "status" });
  const save = el("button", { type: "button", class: "btn", disabled: true }, "Save"), cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
  const fromRow = el("div", { class: "pe-chips" }), toRow = el("div", { class: "pe-chips" });
  const newIn = el("input", { type: "text", class: "pe-new", placeholder: "Or type a new name (brand and model)", "aria-label": "New product name" });
  const chip = (p, on, click) => { const b = el("button", { type: "button", class: `chip pe-chip${on ? " on" : ""}`, "aria-pressed": String(on) }, [el("i", { class: "pe-dot", style: `background:${colorOf(p)}` }), nameOf(p)]); b.addEventListener("click", click); return b; };
  const draw = () => {
    fromRow.replaceChildren(...here.map((p) => chip(p, p === from, () => { from = p; if (to === from) to = null; draw(); })));
    toRow.replaceChildren(...order.filter((p) => p !== from).map((p) => chip(p, p === to, () => { to = to === p ? null : p; newIn.value = ""; draw(); })));
    save.disabled = !to && !newIn.value.trim();
  };
  newIn.addEventListener("input", () => { if (newIn.value.trim()) to = null; draw(); });
  cancel.addEventListener("click", () => { EDIT.ev = null; S.draw(); });
  save.addEventListener("click", () => {
    const name = newIn.value.trim(), kinds = S.PROD_KINDS?.[kind] || [], fk = from ? gearInfo(from).kind : kinds[0] || "Other";
    const val = to || (name ? (kind === "Balls" ? `Ball|${name}` : `${fk}|${name}`) : null); if (!val) return;
    save.disabled = true; saveProductChange(S, { kind, g, from, to: val, edits, status });
  });
  const mine = edits.filter((e) => e.event === g.event && String(e.year) === String(g.year));
  const undo = mine.length ? el("button", { type: "button", class: "link danger small" }, "Undo the change here (back to the data)") : null;
  undo?.addEventListener("click", async () => { undo.disabled = true; status.textContent = "Saving\u2026"; try { const pe = await import("./productEdits.js"); for (const e of mine) await pe.removeProductEdit(S.me.key, e.id); status.textContent = "Done. Reloading\u2026"; location.reload(); } catch (err) { console.error(err); status.textContent = "Couldn\u2019t save that."; undo.disabled = false; } });
  draw();
  const parts = [el("div", { class: "pe-head" }, [el("strong", {}, g.label), mine.length ? el("span", { class: "muted small" }, " \u00b7 changed by hand") : null]),
    el("p", { class: "pe-lab" }, here.length > 1 ? "Replace" : "Now"),
    here.length > 1 ? null : el("p", { class: "pe-now" }, here.length ? nameOf(here[0]) : "No product recorded"),
    here.length > 1 ? fromRow : null,
    el("p", { class: "pe-lab" }, "Change it to"), toRow, newIn,
    el("div", { class: "pe-btns" }, [save, cancel, undo]), status];
  return el("div", { class: "pe-panel" }, parts.filter(Boolean));
}
// (update 710) an event's name short enough for under a bar: sponsors' "presented by …" off, the long words shortened, then cut
const shortEvent = (name) => {
  let t = String(name || "").replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/i, "").replace(/^the\s+/i, "")
    .replace(/\bChampionships?\b/gi, "Champ.").replace(/\bInvitational\b/gi, "Inv.").replace(/\bTournament\b/gi, "Tourn.").replace(/\bInternational\b/gi, "Intl.")
    .replace(/\bClassic\b/gi, "Classic").replace(/\bOpen\b/g, "Open").replace(/\s+/g, " ").trim();
  return t.length > 18 ? `${t.slice(0, 17).trimEnd()}\u2026` : t;
};
export function productTrend(S, mine, cat, toggles) {
  // (update 709) always event by event (no Round / Event / Month / Year pills here)
  const TB = "event"; void toggles;
  const ottBand = { Driver: /driver/i, "Non-Driver": /wood|hybrid|non.?driver|3w|5w/i, Irons: /iron/i };
  const prodOf = (s, kind) => (kind === "Balls" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear || null);
  const fits = (s, kind) => {
    if (cat && s.cat !== cat) return false;
    if (kind === "Balls") return !!s.ball;
    if (cat === "OTT" && ottBand[kind]) return ottBand[kind].test(String(s.dist || "")) && !!s.gear;
    return !!s.gear && S.PROD_KINDS[kind].includes(gearInfo(s.gear).kind);
  };
  const kinds = S.PROD_FOR[cat || ""] || S.PROD_FOR[""];
  const has = kinds.filter((k) => mine.some((rd) => rd.shots.some((s) => fits(s, k))));
  if (!has.includes(S.st.productKind)) S.st.productKind = has[0] || kinds[0];
  const kind = S.st.productKind;
  const pills = el("div", { class: "subnav small trend-kinds", role: "radiogroup", "aria-label": "Product type" }, kinds.map((k) => {
    const on = k === kind, any = has.includes(k);
    const a = el("a", { href: "#", role: "radio", "aria-checked": String(on), "aria-current": on ? "page" : null, class: any ? null : "nav-off", title: any ? null : "No shots with this kind of product in this selection" }, k);
    a.addEventListener("click", (e) => { e.preventDefault(); if (any && !on) { S.st.productKind = k; S.draw(); } });
    return a;
  }));
  // the rounds, with only this kind's shots (rounds without any left out)
  const rs = mine.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => fits(s, kind)) })).filter((rd) => rd.shots.length);
  if (!rs.length) return S.panelBox("SG Trends by Product", [pills, el("p", { class: "muted small" }, "No product information on these shots: products come from Enter New Round (with WITB) or a club column in an uploaded file.")], "full");
  // grouped as SG Trends groups (round, event, month or year)
  const keyOf = (rd, i) => { const d = localDay(rd.date), ok = !isNaN(d);
    return TB === "round" ? `r${i}` : TB === "year" ? (ok ? String(d.getFullYear()) : "Unknown") : TB === "month" ? (ok ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "Unknown") : `${rd.event || rd.date || rd.key}|${ok ? d.getFullYear() : rd.year || ""}`; }; // (update 404: per year)
  const groups = new Map();
  rs.forEach((rd, i) => {
    const k = keyOf(rd, i), d = localDay(rd.date);
    const g = groups.get(k) || groups.set(k, { label: TB === "round" ? `${isNaN(d) ? rd.date : shortDate(d)}${rd.roundNo ? ` R${rd.roundNo}` : ""}` : TB === "month" && k !== "Unknown" ? new Date(`${k}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : TB === "event" ? (rd.event ? `${rd.event} ${isNaN(d) ? rd.year || "" : d.getFullYear()}`.trim() : rd.date || k) : k,
      short: TB === "event" ? shortEvent(rd.event || (isNaN(d) ? rd.date : shortDate(d))) : null /* (update 710: the event's name under its bar, shortened) */, sg: 0, rounds: 0, event: rd.event, year: String(rd.year || String(rd.date || "").slice(0, 4)), prods: new Map(), last: null }).get(k);
    if (!isNaN(d) && (!g.last || d > g.last)) g.last = d; if (!isNaN(d) && (!g.first || d < g.first)) g.first = d; // (update 711: the event's dates, for the tooltip)
    g.rounds++; for (const s of rd.shots) { g.sg += s.sg; const p = prodOf(s, kind); if (p) g.prods.set(p, (g.prods.get(p) || 0) + (s.w || 1)); }
  });
  const list = [...groups.values()].map((g) => ({ ...g, value: g.sg / g.rounds, top: [...g.prods].sort((a, b) => b[1] - a[1])[0]?.[0] || null }));
  const used = new Map(); for (const g of list) for (const [p, n] of g.prods) used.set(p, (used.get(p) || 0) + n);
  // (update 302) each product's average: strokes gained a round with it (these shots), over the rounds it was used in
  const avgOf = new Map();
  for (const rd of rs) { const per = new Map(); for (const s of rd.shots) { const p = prodOf(s, kind); if (p) per.set(p, (per.get(p) || 0) + s.sg); } for (const [p, v] of per) { const a = avgOf.get(p) || { sg: 0, n: 0 }; a.sg += v; a.n++; avgOf.set(p, a); } }
  const order = [...used].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const colorOf = (p) => S.PROD_COLORS[order.indexOf(p) % S.PROD_COLORS.length] || "#8e8e93";
  const nameOf = (p) => { const gi = gearInfo(p); return `${gi.brand} ${gi.model}`.trim() || p; };
  // (update 514) the key above the chart: each product's colour and name; its numbers in the table under the chart
  // (update 712) products changed by hand (Edit) at some tournaments: marked * in the key and the tooltip
  const edits = S.me?.key ? (S.productEditsOf?.(S.me.key) || []).filter((e) => e.pk === kind) : [];
  const editedTo = new Set(edits.map((e) => e.to)), editOf = (g) => edits.filter((e) => e.event === g.event && String(e.year) === String(g.year));
  const legend = el("div", { class: "prod-legend" }, [...order.map((p) => el("span", { class: "prod-key" }, [el("i", { style: `background:${colorOf(p)}` }), `${nameOf(p)}${editedTo.has(p) ? " *" : ""}`])),
    edits.length ? el("span", { class: "muted small prod-edited-note" }, "* changed by hand at some tournaments") : null,
    canEditProducts(S) ? (() => { const b = el("button", { type: "button", class: `prod-cmp prod-edit${EDIT.on ? " on" : ""}` }, EDIT.on ? "Done" : "\u270E Edit"); b.addEventListener("click", () => { EDIT.on = !EDIT.on; EDIT.ev = null; S.draw(); }); return b; })() : null]);
  const editOn = EDIT.on && canEditProducts(S);
  const evKey = (g) => `${g.event}|${g.year}`, openG = editOn && EDIT.ev ? list.find((g) => evKey(g) === EDIT.ev) : null;
  const editBox = editOn ? (openG ? productEditPanel(S, { kind, g: openG, order, nameOf, colorOf, edits }) : el("p", { class: "pe-hint" }, "Editing: tap a tournament\u2019s bar to change its product.")) : null;
  const table = prodTable(mine, kind, order, colorOf, nameOf);
  // (update 455) Open in Compare: these products, over the dates in the chart (and the part of the game picked)
  const toCmp = S.me && order.length ? (() => {
    const b = el("button", { type: "button", class: "prod-cmp" }, "Open in Compare \u2192"); // (update 467: small, the legend's size)
    b.addEventListener("click", () => {
      const ds = rs.map((rd) => String(rd.date || "").slice(0, 10)).filter(Boolean).sort();
      const pp = { player: S.me.key, items: order.slice(0, 8).map((p) => ({ value: p, name: p.startsWith("Ball|") ? p.slice(5) : nameOf(p) })), from: ds[0] || null, to: ds.at(-1) || null, cats: cat ? [cat] : [] };
      try { sessionStorage.setItem("ta.cmpProducts", JSON.stringify(pp)); } catch { /* */ }
      location.hash = `#/comparisons?prods=1&player=${encodeURIComponent(S.me.key)}`;
    });
    return el("div", { class: "prod-cmp-row" }, [b, order.length > 8 ? el("span", { class: "muted small" }, " (the 8 most used)") : null]);
  })() : null;
  return S.panelBox("SG Trends by Product", [pills, legend, S.chartBox((c, as) => S.barChart(c, list.map((g) => g.label), list.map((g) => g.value), {
    title: `SG / round (${kind === "Balls" ? "every shot" : `${kind.toLowerCase()} shots`})`, as: "bar", colors: list.map((g) => colorOf(g.top)),
    shortLabels: list.map((g) => g.short), allTicks: TB === "event", // (update 711: every event named)
    onBarClick: editOn ? (i) => { EDIT.ev = evKey(list[i]); S.draw(); } : null,
    tooltip: (i) => { const g = list[i], all = [...g.prods].sort((a, b) => b[1] - a[1]);
      const dt = (x) => x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const when = g.first && g.last ? (g.first.toDateString() === g.last.toDateString() ? dt(g.first) : `${dt(g.first).replace(/, \d{4}$/, g.first.getFullYear() === g.last.getFullYear() ? "" : `, ${g.first.getFullYear()}`)} \u2013 ${dt(g.last)}`) : null;
      const ed = editOf(g);
      return [when, TB === "round" ? g.event : `${g.rounds} ${g.rounds === 1 ? "round" : "rounds"}`, ...all.map(([p, n]) => `${nameOf(p)}${editedTo.has(p) && ed.some((e) => e.to === p) ? " *" : ""}${all.length > 1 ? ` (${Math.round(n)} shot${Math.round(n) === 1 ? "" : "s"})` : ""}`),
        ...ed.map((e) => `* changed by hand${e.from ? ` (was ${nameOf(e.from)})` : " (none was recorded)"}`)].filter(Boolean); },
  }), "wide", "trend-prod"), editBox, table, toCmp], "full");
}
/*
 * (update 514) Each product's numbers, under the chart: its rounds (the rounds it was used in) and, by kind:
 *   Driver / Non-Driver: SG off the tee, distance, accuracy (fairways hit)   Irons: SG approach, hit green %, proximity
 *   Wedges: SG around the green, proximity, up & down %   Putters: SG putting, putts a round, 3-putts a round
 *   Balls: SG off the tee, approach, around the green and putting
 * Strokes gained: a round with it (its shots). The rest: the shot file's own columns on its shots (fairway, drive
 * distance, on green, proximity, up & down), and for putters, its putts (3-putts: holes with 3 or more of them).
 */
function prodTable(mine, kind, order, colorOf, nameOf) {
  if (!order.length) return null;
  const ball = kind === "Balls";
  const own = (x, p) => (ball ? (x.ball ? `Ball|${x.ball}` : null) : x.gear || null) === p;
  const fmtN = (v, dp, unit = "") => (v == null || !Number.isFinite(v) ? "\u2014" : `${v.toFixed(dp)}${unit}`);
  const cols = {
    Driver: [["SG OTT", "sg:OTT"], ["Distance", "o:drive"], ["Accuracy", "o:fwy"]],
    "Non-Driver": [["SG OTT", "sg:OTT"], ["Distance", "o:drive"], ["Accuracy", "o:fwy"]],
    Irons: [["SG APP", "sg:APP"], ["Hit Green %", "o:hitGreen"], ["Prox", "o:prox"]],
    Wedges: [["SG ARG", "sg:ARG"], ["Prox", "o:prox"], ["Up & Down %", "o:ud"]],
    Putters: [["SG PUTT", "sg:PUTT"], ["Putts / Rd", "putts"], ["3-Putts / Rd", "three"]],
    Balls: [["SG OTT", "sg:OTT"], ["SG APP", "sg:APP"], ["SG ARG", "sg:ARG"], ["SG PUTT", "sg:PUTT"], ["SG Total", "sg:"]], /* (update 515: and the total) */
  }[kind] || [["SG", "sg:"]];
  const rowOf = (p) => {
    const rds = mine.filter((rd) => rd.shots.some((s) => own(s, p)));
    const n = rds.length; if (!n) return null;
    const sgCat = (c) => rds.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + (own(s, p) && (!c || s.cat === c) ? s.sg : 0), 0), 0) / n;
    const obs = (k) => { let v = 0, w = 0; for (const rd of rds) for (const o of rd.obs || []) if (o.k === k && own(o, p)) { const ww = o.w || 1; v += o.v * ww; w += ww; } return w ? v / w : null; };
    const putts = () => rds.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + (own(s, p) && s.cat === "PUTT" ? s.w || 1 : 0), 0), 0) / n;
    const three = () => {
      let any = false, holes = 0;
      for (const rd of rds) { const by = new Map(); for (const s of rd.shots) if (own(s, p) && s.cat === "PUTT" && s.hole != null && (s.w || 1) === 1) { any = true; by.set(s.hole, (by.get(s.hole) || 0) + 1); } for (const c of by.values()) if (c >= 3) holes++; }
      return any ? holes / n : null;
    };
    const val = (key) => {
      if (key.startsWith("sg:")) { const v = sgCat(key.slice(3) || null); return el("td", { class: `num ${v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""}` }, fmtSG(v)); }
      if (key === "putts") return el("td", { class: "num" }, fmtN(putts(), 1));
      if (key === "three") return el("td", { class: "num" }, fmtN(three(), 2));
      const k = key.slice(2), v = obs(k);
      return el("td", { class: "num" }, k === "drive" ? fmtN(v, 1, " yds") : k === "prox" ? fmtN(v, 1, " ft") : fmtN(v, 1, "%"));
    };
    const main = cols.find(([, k]) => k === "sg:") || cols[0]; // (update 516: rows best first by the table's strokes gained)
    const tr = el("tr", { class: n <= 2 ? "few" : null, title: n <= 2 ? `Only ${n} round${n === 1 ? "" : "s"}` : null }, [el("td", { class: "prod-name", title: nameOf(p) }, el("i", { style: `background:${colorOf(p)}`, role: "img", "aria-label": nameOf(p) })) /* (update 515: just its colour; the key above names it) */, el("td", { class: "num" }, String(n)), ...cols.map(([, k]) => val(k))]);
    tr.__sg = main[1].startsWith("sg:") ? sgCat(main[1].slice(3) || null) : 0;
    return tr;
  };
  const rows = order.map(rowOf).filter(Boolean).sort((a, b) => b.__sg - a.__sg);
  if (!rows.length) return null;
  return el("div", { class: "table-scroll prod-table-wrap" }, el("table", { class: "plain prod-table" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Product"), el("th", { class: "num" }, "Rounds"), ...cols.map(([h]) => el("th", { class: "num" }, h))])),
    el("tbody", {}, rows)]));
}
export function sgByClubBox(S, mine, cat) {
  if (!S.isSG() || !mine?.length) return null;
  const rs = cat ? mine.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => s.cat === cat) })) : mine;
  if (!cat) return null; // (update 218: only for one category, and only when more than one product was used in it)
  const list = gearList(rs).filter((g) => g.kind !== "Ball").map((g) => ({ ...g, perRound: g.sg / mine.length }))
    .sort((a, b) => b.perRound - a.perRound).slice(0, 14);
  if (list.length < 2) return null;
  const few = list.filter((g) => g.rounds < S.FEW);
  return S.panelBox("SG by Club", [
    S.chartBox((c, as) => S.barChart(c, list.map((g) => `${g.label}${g.rounds < S.FEW ? " *" : ""}`), list.map((g) => g.perRound), { as, title: "SG / round",
      tooltip: (i) => `${nf1.format(list[i].shots)} shots in ${list[i].rounds} round${list[i].rounds === 1 ? "" : "s"}${list[i].rounds < S.FEW ? " (only a few rounds: read with care)" : ""}` }), "", `club-${cat || "all"}`),
    few.length ? el("p", { class: "muted small sg-few" }, `* Fewer than ${S.FEW} rounds with this club: ${few.map((g) => `${g.label} (${g.rounds})`).join(", ")}. Read these with care.`) : null,
  ]);
}
export function panelBox(S, title, content, size = "") {
  return el("section", { class: `panel sg-box ${size}` }, [el("h3", {}, title), ...[].concat(content)]);
}
