// The strokes-gained dashboard, shared by the admin's Data → Analyze page and every player's My Data
// page (and coaches viewing a player). Styled after the original player site.
//
//   Filters: span · year · tournament · round · lie · distance, and category pills
//   "Your selection": SG / round, attempts / round, SG / attempt and rank for exactly that slice
//   SG cards (Total, T2G, OTT, APP, ARG, PUTT), category visuals, trends, rankings
//
// Strokes gained per round = sum over the slice of (SG per attempt × attempts) ÷ rounds in the slice.
// Players only ever see other players' numbers in the Rankings table, which comes from the published
// per-round, per-category summary, so player rankings follow year/tournament/round/category filters
// (not lie or distance).
import { el, mount, loadScript } from "./ui.js";
import {
  CATEGORIES, applyFilters, filterOptions, sliceTotals, sgPerRound, sgBy, trend, statTable,
  missSplit, leavePoints, leaveHistogram, rank, gradeColor, sgColor, fmtSG,
} from "./sg.js";

const CHART_JS = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
const SPANS = [["0", "All rounds"], ["12", "Last 12 rounds"], ["24", "Last 24 rounds"]];
const SUMMARY = [["TOTAL", "SG: Total"], ["T2G", "SG: Tee to Green"], ["OTT", "SG: Off-the-Tee"], ["APP", "SG: Approach"], ["ARG", "SG: Around-the-Green"], ["PUTT", "SG: Putting"]];
const BREAKDOWNS = {
  OTT: [["distanceRange", "SG by Club"], ["lie", "SG by Lie"], ["dogleg", "SG by Dogleg"]],
  APP: [["distanceRange", "SG by Distance"], ["lie", "SG by Lie"], ["pin", "SG by Pin Location"]],
  ARG: [["distanceRange", "SG by Distance"], ["lie", "SG by Lie"]],
  PUTT: [["distanceRange", "SG by Distance"], ["puttBreak", "SG by Break"]],
};
const LEAVE_SCALE = { APP: 60, ARG: 20 };
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || "All categories";

/**
 * opts: {
 *   me:     { key, label, rounds } | null     the player on screen (full detail)
 *   field:  [{ key, label, rounds, summaryOnly? }]   every player, for rankings and "All players"
 *   idx:    column map from detectColumns()
 *   mode:   "admin" | "player"
 *   state:  optional shared object so filters survive re-renders (e.g. switching players)
 * }
 */
export function sgDashboard(container, opts) {
  const { idx, mode } = opts;
  const showRanks = opts.rankings !== false; // e.g. a player's own entered rounds: nobody to rank against
  const st = opts.state || {};
  // Year, tournament, round, lie and distance each hold a list (pick several); empty means all.
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  Object.assign(st, { span: st.span ?? 0, year: arr(st.year), event: arr(st.event), roundNo: arr(st.roundNo), cats: st.cats ?? [], lie: arr(st.lie),
    dist: arr(st.dist).map((d) => (String(d).includes("|") ? d : `${st.distCat || ""}|${d}`)), trendBy: st.trendBy ?? "event", rankQuery: st.rankQuery ?? "", openFilter: null });
  const narrowed = () => st.lie.length || st.dist.length; // lie / distance in use (the shared summary can't follow those)
  const charts = [];
  const destroyCharts = () => { while (charts.length) charts.pop().destroy(); };
  let me = opts.me;
  let field = opts.field || [];
  const fieldIsSummary = () => field.some((p) => p.summaryOnly);

  loadScript(CHART_JS).then(() => draw()).catch(() => {});
  const closePanels = () => {
    if (!st.openFilter) return;
    st.openFilter = null;
    container.querySelectorAll(".ms-panel").forEach((p) => { p.hidden = true; });
    container.querySelectorAll(".ms-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
  };
  const onDocDown = (e) => { if (!e.target.closest?.(".ms")) closePanels(); };
  const onKey = (e) => { if (e.key === "Escape") closePanels(); };
  document.addEventListener("pointerdown", onDocDown);
  document.addEventListener("keydown", onKey);

  function draw() {
    destroyCharts();
    const base = me ? me.rounds : field.flatMap((p) => p.rounds);
    // Keep only choices that still exist: distances of the picked categories, lies seen in them.
    if (st.cats.length) st.dist = st.dist.filter((d) => st.cats.includes(d.split("|")[0]));
    const opt = filterOptions(base, st.cats);
    st.lie = st.lie.filter((l) => opt.lie.includes(l));
    const f = { span: Number(st.span), year: st.year, event: st.event, roundNo: st.roundNo, cats: st.cats, lie: st.lie, dist: st.dist };
    // Rankings from the shared summary can't follow lie / distance.
    const rankF = fieldIsSummary() ? { ...f, lie: [], dist: [] } : f;
    const slicedField = field.map((p) => ({ ...p, rounds: applyFilters(p.rounds, rankF) }));
    const mine = me ? applyFilters(me.rounds, f) : null;

    // Rebuilding the dashboard would briefly shrink the page and jump it to the top. Hold its
    // height and put the scroll position back, so changing a filter or pill keeps your place.
    const y = window.scrollY;
    const panelScroll = container.querySelector(".ms-panel:not([hidden]) .ms-options")?.scrollTop || 0;
    container.style.minHeight = `${container.offsetHeight}px`;
    // Remember which control had focus, so it can be focused again without scrolling.
    const act = container.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = act ? (act.getAttribute("aria-label") || act.textContent).trim() : null;
    const focusTag = act?.tagName;
    mount(container, [
      opts.note ? el("p", { class: "muted small center sg-note" }, opts.note) : null,
      filterBar(opt),
      me ? selectionStrip(mine, slicedField) : null,
      cards(slicedField, f),
      catPills(),
      el("div", { class: "sg-panel" }, [
        ...(me ? detailBlocks(mine, slicedField) : []),
        showRanks ? rankingsBlock(slicedField) : null,
      ]),
    ]);
    if (focusKey) {
      const again = [...container.querySelectorAll(focusTag || "*")].find((n) => (n.getAttribute("aria-label") || n.textContent).trim() === focusKey);
      again?.focus({ preventScroll: true });
    }
    const openList = container.querySelector(".ms-panel:not([hidden]) .ms-options");
    if (openList) openList.scrollTop = panelScroll;
    window.scrollTo(0, y);
    requestAnimationFrame(() => { container.style.minHeight = ""; window.scrollTo(0, y); });
    centerRankings();
  }

  /* ------------------------------ filters ------------------------------ */
  // A filter button that opens a checklist: pick any number of options (none = all). It stays open
  // while you tick, and closes on Done, a tap outside, or Escape.
  function multi(label, key, options, allLabel, { plural, fmt = (v) => v } = {}) {
    const chosen = new Set(st[key]);
    const labelOf = (v) => options.find((o) => o.value === v)?.label ?? fmt(v);
    const summary = !chosen.size ? allLabel : chosen.size <= 2 ? [...chosen].map(labelOf).join(", ") : `${chosen.size} ${plural}`;
    const open = st.openFilter === key;
    const btn = el("button", { type: "button", class: "ms-btn" + (chosen.size ? " on" : ""), "aria-expanded": open ? "true" : "false", "aria-label": `${label}: ${summary}` }, [
      el("span", { class: "ms-sum" }, summary), el("span", { class: "ms-caret", "aria-hidden": "true" }, "\u25BE"),
    ]);
    const toggle = (v, on) => {
      st[key] = on ? [...st[key], v] : st[key].filter((x) => x !== v);
      if (key === "dist" && on) { // a distance belongs to a category: make sure that category is picked
        const c = v.split("|")[0];
        if (!st.cats.length) st.cats = [c]; else if (!st.cats.includes(c)) st.cats = [...st.cats, c];
      }
      st.openFilter = key;
      draw();
    };
    let lastGroup = null;
    const rows = [];
    for (const o of options) {
      if (o.group && o.group !== lastGroup) { rows.push(el("p", { class: "ms-group" }, o.group)); lastGroup = o.group; }
      const box = el("input", { type: "checkbox", checked: chosen.has(o.value), "aria-label": `${label}: ${o.label}` });
      box.addEventListener("change", () => toggle(o.value, box.checked));
      rows.push(el("label", { class: "ms-row" }, [box, el("span", {}, o.label)]));
    }
    const all = el("button", { type: "button", class: "link ms-all" }, `All (clear)`);
    all.addEventListener("click", () => { st[key] = []; st.openFilter = key; draw(); });
    const done = el("button", { type: "button", class: "btn ms-done" }, "Done");
    done.addEventListener("click", () => { st.openFilter = null; panel.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus({ preventScroll: true }); });
    const panel = el("div", { class: "ms-panel", hidden: !open, role: "group", "aria-label": label }, [
      el("div", { class: "ms-top" }, [el("strong", {}, label), all]),
      el("div", { class: "ms-options" }, rows.length ? rows : el("p", { class: "muted small" }, "Nothing to pick for this selection.")),
      done,
    ]);
    btn.addEventListener("click", () => {
      const nowOpen = panel.hidden;
      container.querySelectorAll(".ms-panel").forEach((p) => { p.hidden = true; });
      container.querySelectorAll(".ms-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
      panel.hidden = !nowOpen; btn.setAttribute("aria-expanded", nowOpen ? "true" : "false");
      st.openFilter = nowOpen ? key : null;
    });
    return el("div", { class: "ms" }, [el("span", { class: "ms-label" }, label), btn, panel]);
  }

  function filterBar(opt) {
    const span = el("select", { "aria-label": "Span" }, SPANS.map(([v, l]) => el("option", { value: v, selected: String(st.span) === v }, l)));
    span.addEventListener("change", () => { st.span = Number(span.value); draw(); });
    const active = ["year", "event", "roundNo", "lie", "dist"].some((k) => st[k].length) || Number(st.span) > 0;
    const reset = el("button", { class: "link", type: "button", hidden: !active }, "Clear filters");
    reset.addEventListener("click", () => { Object.assign(st, { span: 0, year: [], event: [], roundNo: [], lie: [], dist: [], openFilter: null }); draw(); });
    // Distances, grouped under their category; with categories picked, only theirs show.
    const base = me ? me.rounds : field.flatMap((p) => p.rounds);
    const distOpts = CATEGORIES.filter(([k]) => !st.cats.length || st.cats.includes(k))
      .flatMap(([k, label]) => filterOptions(base, k).dist.map((d) => ({ value: `${k}|${d}`, label: d, group: label })));
    const simple = (vals, fmt = (v) => v) => vals.map((v) => ({ value: v, label: fmt(v) }));
    return el("div", { class: "sg-filters" }, [
      el("label", {}, ["Span", span]),
      multi("Year", "year", simple(opt.year), "All years", { plural: "years" }),
      multi("Tournament", "event", simple(opt.event), "All tournaments", { plural: "tournaments" }),
      multi("Round", "roundNo", simple(opt.roundNo, (v) => `Round ${v}`), "All rounds", { plural: "rounds", fmt: (v) => `Round ${v}` }),
      multi("Lie", "lie", simple(opt.lie), "All lies", { plural: "lies" }),
      multi("Distance", "dist", distOpts, "All distances", { plural: "distances", fmt: (v) => v.split("|").slice(1).join("|") }),
      reset,
    ]);
  }
  // Category pills: pick one or several (e.g. Off-the-Tee + Approach + Around-the-Green = tee to green).
  // "All" clears the choice; picking all four is the same as All.
  function catPills() {
    const allOn = !st.cats.length;
    const all = el("a", { href: "#", "aria-current": allOn ? "page" : null }, "All");
    all.addEventListener("click", (e) => { e.preventDefault(); st.cats = []; draw(); });
    return el("nav", { class: "subnav sg-tabs", "aria-label": "Categories (pick one or more)" }, [all, ...CATEGORIES.map(([k, label]) => {
      const on = st.cats.includes(k);
      const a = el("a", { href: "#", "aria-current": on ? "page" : null, "aria-pressed": on ? "true" : "false" }, label);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        st.cats = on ? st.cats.filter((x) => x !== k) : [...st.cats, k];
        if (on) st.dist = st.dist.filter((d) => d.split("|")[0] !== k);
        if (st.cats.length === CATEGORIES.length) st.cats = [];
        st.cats.sort((x, y) => CATEGORIES.findIndex(([c]) => c === x) - CATEGORIES.findIndex(([c]) => c === y));
        draw();
      });
      return a;
    })]);
  }
  const T2G = ["OTT", "APP", "ARG"];
  const catsName = () => (!st.cats.length ? "All categories"
    : st.cats.length === 3 && T2G.every((k) => st.cats.includes(k)) ? "Tee to Green"
    : st.cats.map(catName).join(" + "));
  const list = (a, plural, fmt = (v) => v) => (!a.length ? "" : a.length <= 2 ? a.map(fmt).join(", ") : `${a.length} ${plural}`);
  const describe = () => [
    catsName(),
    list(st.year, "years"), list(st.event, "tournaments"),
    st.roundNo.length ? (st.roundNo.length <= 2 ? `Round ${st.roundNo.join(" & ")}` : `${st.roundNo.length} rounds`) : "",
    list(st.lie, "lies"), list(st.dist, "distances", (d) => d.split("|").slice(1).join("|")),
    Number(st.span) > 0 ? `last ${st.span} rounds` : "",
  ].filter(Boolean).join(" \u00b7 ");

  /* ------------------------------ your selection ------------------------------ */
  function selectionStrip(mine, slicedField) {
    const t = sliceTotals(mine);
    const r = rankOf(slicedField, me.key, (rs) => sliceTotals(rs).sgPerRound);
    const cell = (label, value, style) => el("div", {}, [el("dt", {}, label), el("dd", { style }, value)]);
    return el("section", { class: "panel sg-selection" }, [
      el("h3", {}, `${me.label}: ${describe()}`),
      el("dl", { class: "facts glance" }, [
        cell("SG / Round", fmtSG(t.sgPerRound), `color:${t.sgPerRound === null ? "inherit" : sgColor(t.sgPerRound)}`),
        cell("Attempts / Round", t.attemptsPerRound === null ? "\u2014" : nf1.format(t.attemptsPerRound)),
        cell("SG / Attempt", t.sgPerAttempt === null ? "\u2014" : `${t.sgPerAttempt >= 0 ? "+" : ""}${t.sgPerAttempt.toFixed(3)}`),
        cell("Rounds", String(t.rounds)),
        !showRanks ? null : cell(fieldIsSummary() && narrowed() ? `Rank \u00b7 ${catsName()}` : "Rank", r ? `${r.rank} of ${r.of}` : "\u2014"),
      ]),
      fieldIsSummary() && narrowed() ? el("p", { class: "muted small center" }, "Rank uses the category and rounds you've picked; rankings don't break down by lie or distance.") : null,
    ]);
  }

  // Rank of one player among the field for a metric computed on their (already sliced) rounds.
  function rankOf(slicedField, key, metric) {
    const entries = slicedField.filter((p) => p.rounds.length).map((p) => ({ key: p.key, value: metric(p.rounds) ?? -Infinity }));
    const ranked = rank(entries);
    const r = ranked.find((x) => x.key === key);
    return r ? { rank: r.rank, of: ranked.length } : null;
  }

  /* ------------------------------ SG cards ------------------------------ */
  function cards(slicedField, f) {
    // Cards cover every category for the rounds picked (year, tournament, round, span), so their
    // values and ranks always compare like with like.
    const roundsOnly = { ...f, cats: [], lie: "", dist: "" }; // every category, whatever pills are picked
    const mineAll = me ? applyFilters(me.rounds, roundsOnly) : null;
    const fieldAll = field.map((p) => ({ ...p, rounds: applyFilters(p.rounds, roundsOnly) }));
    const mySG = mineAll ? sgPerRound(mineAll) : null;
    // No player picked: each card shows the average of every player's own SG / round.
    const playing = fieldAll.filter((p) => p.rounds.length);
    const fieldAvg = (k) => (playing.length ? playing.reduce((a, p) => a + sgPerRound(p.rounds)[k], 0) / playing.length : null);
    return el("div", { class: "sg-cards" }, SUMMARY.map(([k, label]) => {
      const pick = k === "TOTAL" ? [] : k === "T2G" ? T2G : [k];
      const on = pick.length === st.cats.length && pick.every((x) => st.cats.includes(x));
      let value, color, sub;
      if (me) {
        const r = rankOf(fieldAll, me.key, (rs) => sgPerRound(rs)[k]);
        const pct = r && r.of > 1 ? 1 - (r.rank - 1) / (r.of - 1) : 1;
        value = mySG[k]; color = showRanks ? gradeColor(pct) : sgColor(value ?? 0); sub = showRanks && r ? `Rank ${r.rank} of ${r.of}` : "";
      } else {
        value = fieldAvg(k); color = value === null ? "inherit" : sgColor(value);
        sub = `Average of ${playing.length} ${playing.length === 1 ? "player" : "players"}`;
      }
      const card = el("div", { class: "sg-card" + (on ? " on" : ""), role: "button", tabindex: "0", title: `Show ${label.replace("SG: ", "")}` }, [
        el("h3", {}, label),
        el("p", { class: "sg-value", style: `color:${color}` }, fmtSG(value)),
        el("p", { class: "sg-rank" }, sub),
      ]);
      const go = () => { st.cats = [...pick]; draw(); };
      card.addEventListener("click", go);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      return card;
    }));
  }

  /* ------------------------------ category detail ------------------------------ */
  function detailBlocks(mine, slicedField) {
    const blocks = [];
    const cat = st.cats.length === 1 ? st.cats[0] : ""; // one category: its full detail
    if (!cat) {
      // All, or several categories: where the strokes are gained and lost among the ones picked.
      const shown = CATEGORIES.filter(([k]) => !st.cats.length || st.cats.includes(k));
      const bars = shown.map(([k, l]) => ({ label: l, value: sliceTotals(mine.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => s.cat === k) }))).sgPerRound ?? 0 }));
      const byCat = panelBox("SG / Round by Category", chartBox((c) => barChart(c, bars.map((b) => b.label), bars.map((b) => b.value), { title: "SG / round" })));
      const lies = sgBy(mine, idx, null, "lie");
      blocks.push(lies && lies.length > 1
        ? el("div", { class: "sg-grid" }, [byCat, panelBox("SG by Lie", chartBox((c) => barChart(c, lies.map((g) => g.label), lies.map((g) => g.perRound), {
            title: "SG / round", tooltip: (i) => `${nf1.format(lies[i].shots)} attempts` })))])
        : byCat);
    } else {
      const comparable = !(fieldIsSummary() && narrowed()); // the field summary has no lie / distance detail
      const stats = statTable(cat, mine, comparable ? slicedField.map((p) => p.rounds) : [], idx);
      const others = mode === "admin" ? "All players" : "Field";
      blocks.push(panelBox("Stat Averages", stats.length ? el("div", { class: "table-scroll" }, el("table", { class: "plain stats" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Stat"), el("th", { class: "num" }, me.label), el("th", { class: "num" }, others)])),
        el("tbody", {}, stats.map((s) => {
          const fmt = (v) => (v === null || v === undefined ? "\u2014" : ["pct", "onePutt", "driverPct"].includes(s.kind) ? `${nf1.format(v)}%`
            : s.kind === "sgPerRound" || s.kind === "sgPerAttempt" ? `${v >= 0 ? "+" : ""}${v.toFixed(s.dp ?? 2)}` : v.toFixed(s.dp ?? 1));
          const better = s.higher === null || s.field === null ? null : s.higher ? s.value >= s.field : s.value <= s.field;
          return el("tr", {}, [el("td", {}, s.label), el("td", { class: "num" + (better === null ? "" : better ? " good" : " bad") }, fmt(s.value)), el("td", { class: "num muted" }, fmt(s.field))]);
        })),
      ])) : el("p", { class: "empty" }, "No stats for this selection.")));

      const visuals = [];
      if (cat === "OTT") { const miss = missSplit(mine, idx); if (miss) visuals.push(panelBox("Miss Tendencies", missBar(miss))); }
      if (cat === "APP" || cat === "ARG") {
        const pts = leavePoints(mine, idx, cat);
        if (pts) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c) => scatterChart(c, pts, LEAVE_SCALE[cat]), "tall")));
        else { const hist = leaveHistogram(mine, idx, cat); if (hist) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c) => barChart(c, hist.map((h) => h.label), hist.map((h) => h.count), { single: "#30d158", title: "Shots" })))); }
      }
      for (const [fieldName, title] of BREAKDOWNS[cat]) {
        const groups = sgBy(mine, idx, cat, fieldName);
        if (!groups || (groups.length < 2 && fieldName !== "distanceRange")) continue;
        // "All players" markers only where the others' detail is available (admin).
        const compare = fieldIsSummary() ? null : groups.map((g) => {
          const vals = slicedField.map((p) => (sgBy(p.rounds, idx, cat, fieldName) || []).find((x) => x.label === g.label)?.perRound).filter((v) => v !== undefined);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
        visuals.push(panelBox(title, chartBox((c) => barChart(c, groups.map((g) => g.label), groups.map((g) => g.perRound), {
          title: "SG / round", compare, tooltip: (i) => `${nf1.format(groups[i].shots)} attempts`,
        }))));
      }
      if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
    }

    const t = trend(mine, cat || null, st.trendBy);
    const toggles = el("div", { class: "subnav small trend-toggles" }, [["round", "Round"], ["event", "Event"], ["month", "Month"], ["year", "Year"]].map(([v, l]) => {
      const a = el("a", { href: "#", "aria-current": v === st.trendBy ? "page" : null }, l);
      a.addEventListener("click", (e) => { e.preventDefault(); st.trendBy = v; draw(); });
      return a;
    }));
    const avg = t.length ? t.reduce((a, g) => a + g.value, 0) / t.length : 0;
    blocks.push(panelBox("Strokes Gained Trends", [toggles, chartBox((c) => barChart(c, t.map((g) => g.label), t.map((g) => g.value), {
      title: "SG / round", average: avg, tooltip: (i) => (st.trendBy === "round" ? t[i].event : `${t[i].rounds} ${t[i].rounds === 1 ? "round" : "rounds"}`),
    }), "wide")], "full"));
    return blocks;
  }

  /* ------------------------------ rankings ------------------------------ */
  let rankScroll = null;
  function rankingsBlock(slicedField) {
    const ranked = rank(slicedField.filter((p) => p.rounds.length).map((p) => {
      const t = sliceTotals(p.rounds);
      return { key: p.key, label: p.label, value: t.sgPerRound ?? -Infinity, rounds: t.rounds, att: t.attemptsPerRound };
    }));
    const third = Math.max(1, Math.ceil(ranked.length / 3));
    const search = el("input", { type: "search", placeholder: "Find a player\u2026", value: st.rankQuery, "aria-label": "Find a player in the rankings" });
    const body = el("tbody", {}, ranked.map((r) => el("tr", {
      class: `tier-${r.rank <= third ? "top" : r.rank > ranked.length - third ? "bottom" : "mid"}` + (r.key === me?.key ? " me" : ""),
      "data-name": r.label.toLowerCase(),
    }, [
      el("td", { class: "num" }, String(r.rank)),
      el("td", {}, r.label),
      el("td", { class: "num" }, fmtSG(r.value === -Infinity ? null : r.value)),
      el("td", { class: "num" }, r.att === null ? "\u2014" : nf1.format(r.att)),
      el("td", { class: "num" }, String(r.rounds)),
    ])));
    const applySearch = () => {
      const q = search.value.trim().toLowerCase();
      st.rankQuery = search.value;
      body.querySelectorAll("tr").forEach((tr) => { tr.hidden = !!q && !tr.dataset.name.includes(q); });
      if (!q) centerRankings();
    };
    search.addEventListener("input", applySearch);
    rankScroll = el("div", { class: "table-scroll rank-scroll" }, el("table", { class: "plain rankings" }, [
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, "SG / Round"), el("th", { class: "num" }, "Attempts / Round"), el("th", { class: "num" }, "Rounds")])),
      body,
    ]));
    requestAnimationFrame(applySearch);
    return panelBox(`Rankings \u00b7 ${describe()}`, [
      el("div", { class: "rank-tools" }, search),
      ranked.length ? rankScroll : el("p", { class: "empty" }, "No rounds match these filters."),
      fieldIsSummary() && narrowed() ? el("p", { class: "muted small" }, "Rankings follow year, tournament, round and category, not lie or distance.") : null,
    ], "full");
  }

  // Start the rankings scrolled so the selected player sits in the middle (e.g. ranks 45-55 for 50th).
  function centerRankings() {
    requestAnimationFrame(() => {
      const row = rankScroll?.querySelector("tr.me");
      if (!row || row.hidden) return;
      rankScroll.scrollTop = row.offsetTop - rankScroll.clientHeight / 2 + row.offsetHeight / 2;
    });
  }

  /* ------------------------------ building blocks ------------------------------ */
  function panelBox(title, content, size = "") {
    return el("section", { class: `panel sg-box ${size}` }, [el("h3", {}, title), ...[].concat(content)]);
  }
  function chartBox(make, size = "") {
    const wrap = el("div", { class: `sg-chart ${size}` });
    const canvas = el("canvas", {});
    wrap.appendChild(canvas);
    requestAnimationFrame(() => { if (typeof Chart !== "undefined" && canvas.isConnected) charts.push(make(canvas)); });
    return wrap;
  }
  function baseOptions() {
    const muted = "#8e8e93", grid = "rgba(255,255,255,0.06)";
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "rgba(28,28,30,0.96)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, padding: 10, cornerRadius: 10, titleFont: { family: "Inter, system-ui, sans-serif", weight: "600" }, bodyFont: { family: "Inter, system-ui, sans-serif" } } },
      scales: {
        x: { ticks: { color: muted }, grid: { color: grid } },
        y: { ticks: { color: muted }, grid: { color: (c) => (c.tick?.value === 0 ? "rgba(255,255,255,0.35)" : grid), lineWidth: (c) => (c.tick?.value === 0 ? 1.5 : 1) } },
      },
    };
  }
  function barChart(canvas, labels, values, { title, compare, average, single, tooltip } = {}) {
    const datasets = [{ type: "bar", label: title || "", data: values, borderRadius: 6, maxBarThickness: 44, backgroundColor: single || values.map((v) => (v >= 0 ? "#30d158" : "#ff453a")) }];
    if (compare) datasets.push({ type: "line", label: "All players", data: compare, showLine: false, pointStyle: "line", pointRadius: 14, pointBorderWidth: 3, borderColor: "#c8a97e" });
    if (average !== undefined) datasets.push({ type: "line", label: "Average", data: labels.map(() => average), borderColor: "#c8a97e", borderDash: [6, 6], borderWidth: 2, pointRadius: 0 });
    const o = baseOptions();
    o.plugins.legend = { display: !!(compare || average !== undefined), labels: { color: "#a1a1a6", boxWidth: 12, usePointStyle: true, font: { family: "Inter, system-ui, sans-serif", size: 12 } } };
    if (tooltip) o.plugins.tooltip.callbacks = { afterLabel: (c) => (c.datasetIndex === 0 ? tooltip(c.dataIndex) : "") };
    if (title) o.scales.y.title = { display: true, text: title, color: "#8e8e93" };
    return new Chart(canvas, { data: { labels, datasets }, options: o });
  }
  function scatterChart(canvas, pts, lim) {
    const m = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const mx = m(pts.map((p) => p.x)), my = m(pts.map((p) => p.y));
    const sx = Math.sqrt(m(pts.map((p) => (p.x - mx) ** 2))), sy = Math.sqrt(m(pts.map((p) => (p.y - my) ** 2)));
    const ellipse = {
      id: "ellipse",
      afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y } } = chart;
        ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = "#c8a97e"; ctx.lineWidth = 2; ctx.beginPath();
        ctx.ellipse(x.getPixelForValue(mx), y.getPixelForValue(my), Math.abs(x.getPixelForValue(mx + sx) - x.getPixelForValue(mx)), Math.abs(y.getPixelForValue(my + sy) - y.getPixelForValue(my)), 0, 0, 2 * Math.PI);
        ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x.getPixelForValue(0), y.getPixelForValue(0), 5, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
      },
    };
    const o = baseOptions();
    o.scales.x = { ...o.scales.x, min: -lim, max: lim, title: { display: true, text: "\u2190 Left   \u00b7   Right \u2192", color: "#8e8e93" }, grid: { color: (c) => (c.tick?.value === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.06)") } };
    o.scales.y = { ...o.scales.y, min: -lim, max: lim, title: { display: true, text: "\u2190 Short   \u00b7   Long \u2192", color: "#8e8e93" } };
    return new Chart(canvas, { type: "scatter", data: { datasets: [{ data: pts, pointRadius: 3, backgroundColor: "rgba(200,169,126,0.55)", borderColor: "rgba(200,169,126,0.95)" }] }, options: o, plugins: [ellipse] });
  }
  function missBar(parts) {
    const color = (l) => (l === "Fairway" ? "#30d158" : /^l/i.test(l) ? "#0a84ff" : /^r/i.test(l) ? "#bf5af2" : "#48484a");
    return el("div", { class: "miss" }, [
      el("div", { class: "miss-bar" }, parts.map((p) => el("div", { style: `width:${p.pct}%;background:${color(p.label)}`, title: `${p.label}: ${p.count} shots` }, p.pct >= 8 ? `${Math.round(p.pct)}%` : ""))),
      el("div", { class: "miss-legend" }, parts.map((p) => el("span", {}, [el("i", { style: `background:${color(p.label)}` }), `${p.label} ${nf1.format(p.pct)}%`]))),
    ]);
  }

  draw();
  return {
    destroy() { destroyCharts(); document.removeEventListener("pointerdown", onDocDown); document.removeEventListener("keydown", onKey); },
    update(next) { if ("me" in next) me = next.me; if ("field" in next) field = next.field; draw(); },
  };
}
