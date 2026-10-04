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
  CATEGORIES, applyFilters, filterOptions, sliceTotals, sgPerRound, sgBy, trend, statTable, statTableFull, shortDate,
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
    dist: arr(st.dist).map((d) => (String(d).includes("|") ? d : `${st.distCat || ""}|${d}`)), club: arr(st.club), trendBy: st.trendBy ?? "event", rankQuery: st.rankQuery ?? "", openFilter: null, chartTypes: st.chartTypes ?? {} });
  const narrowed = () => st.lie.length || st.dist.length || st.club.length; // lie / distance / club in use (the shared summary can't follow those)
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
    if (!st.yearStarted && opt.year.length) { st.yearStarted = true; if (!st.year.length) st.year = [[...opt.year].sort().pop()]; } // the latest year to start
    st.lie = st.lie.filter((l) => opt.lie.includes(l));
    st.club = st.club.filter((c) => opt.club.includes(c));
    const f = { span: Number(st.span), year: st.year, event: st.event, roundNo: st.roundNo, cats: st.cats, lie: st.lie, dist: st.dist, club: st.club };
    // Rankings from the shared summary can't follow lie / distance / club.
    const rankF = fieldIsSummary() ? { ...f, lie: [], dist: [], club: [] } : f;
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
    if ((st.view || "advanced") === "basic") {
      // Basic: traditional stats. No category pills; no lie / distance / club filters.
      const bf = { ...f, cats: [], lie: [], dist: [], club: [] };
      const bField = field.map((p) => ({ ...p, rounds: applyFilters(p.rounds, bf) }));
      const bMine = me ? applyFilters(me.rounds, bf) : null;
      const vp = placeView();
      mount(container, [
        vp,
        opts.note ? el("p", { class: "muted small center sg-note" }, opts.note) : null,
        yearsRow(opt),
        basicStatBar(bField, bMine),
        filterBar(opt, { basic: true }),
        opts.slot || null, // the page's player search, under the filters
        el("div", { class: "sg-panel" }, basicBlocks(bField, bMine)),
      ]);
      window.scrollTo(0, y);
      container.style.minHeight = "";
      return;
    }
    const vp = placeView();
    mount(container, [
      vp,
      opts.note ? el("p", { class: "muted small center sg-note" }, opts.note) : null,
      yearsRow(opt),
      catPills(),
      filterBar(opt),
      opts.slot || null, // the page's player search, under the filters
      el("div", { class: "sg-panel" }, (() => {
        // The rankings are always the first thing (Stat Averages and the charts follow).
        const blocks = me ? detailBlocks(mine, slicedField) : [];
        return [showRanks ? rankingsBlock(slicedField) : null, ...blocks];
      })()),
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
  // A filter button that opens a checklist: pick any number of options (none = all). Each tick applies
  // straight away; it stays open while you tick and closes when you tap outside, tap the button, or press Escape.
  function multi(label, key, options, allLabel, { plural, fmt = (v) => v, empty = "Nothing to pick for this selection." } = {}) {
    const chosen = new Set(st[key]);
    const labelOf = (v) => options.find((o) => o.value === v)?.label ?? fmt(v);
    const summary = !chosen.size || (options.length > 1 && chosen.size === options.length) ? allLabel // nothing or everything ticked = all
      : chosen.size <= 2 ? [...chosen].map(labelOf).join(", ") : `${chosen.size} ${plural}`;
    const open = st.openFilter === key;
    const btn = el("button", { type: "button", class: "ms-btn" + (chosen.size ? " on" : ""), "aria-expanded": open ? "true" : "false", "aria-label": `${label}: ${summary}` }, [
      el("span", { class: "ms-sum" }, summary), el("span", { class: "ms-caret", "aria-hidden": "true" }, "\u25BE"),
    ]);
    const toggle = (v, on) => {
      st[key] = on ? [...st[key], v] : st[key].filter((x) => x !== v);
      if (key === "dist" && on) { // a distance belongs to a category: make sure that category is picked
        const c = v.split("|")[0];
        if (!st.cats.length || st.cats.length === CATEGORIES.length) st.cats = [c]; else if (!st.cats.includes(c)) st.cats = [...st.cats, c];
      }
      if (key === "club") followClubs();
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
    all.addEventListener("click", () => { st[key] = []; if (key === "club") followClubs(); st.openFilter = key; draw(); });
    const panel = el("div", { class: "ms-panel", hidden: !open, role: "group", "aria-label": label }, [
      el("div", { class: "ms-top" }, [el("strong", {}, label), all]),
      el("div", { class: "ms-options" }, rows.length ? rows : el("p", { class: "muted small" }, empty)),
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

  // Clubs nested under their bag group (Driver, Fairway Wood, Hybrid, Iron, Wedge, Putter), each with the
  // brand / model you used it as, e.g. "7i · Titleist T100".
  const CLUB_GROUPS = ["Driver", "Fairway Wood", "Hybrid", "Iron", "Wedge", "Putter", "Other"];
  function clubOptions(opt) {
    return opt.club.map((c) => ({ value: c, label: c, group: opt.clubCats[c] || "Other" }))
      .sort((a, b) => CLUB_GROUPS.indexOf(a.group) - CLUB_GROUPS.indexOf(b.group));
  }
  // Picking clubs shows only the categories those clubs were used in (a driver: Off-the-Tee; a putter:
  // Putting; a 7-iron: Approach, plus Off-the-Tee if it was hit off a par-4 tee). Clearing them shows all.
  function followClubs() {
    if (!st.club.length) { st.cats = []; return; }
    const base = me ? me.rounds : field.flatMap((p) => p.rounds);
    const picked = new Set(st.club);
    const cats = new Set();
    for (const rd of base) for (const sh of rd.shots) if (picked.has(sh.club)) cats.add(sh.cat);
    st.cats = CATEGORIES.map(([k]) => k).filter((k) => cats.has(k));
    st.dist = st.dist.filter((d) => st.cats.includes(d.split("|")[0]));
  }

  function filterBar(opt, { basic = false } = {}) {
    const span = el("select", { "aria-label": "Span" }, SPANS.map(([v, l]) => el("option", { value: v, selected: String(st.span) === v }, l)));
    span.addEventListener("change", () => { st.span = Number(span.value); draw(); });
    const active = ["year", "event", "roundNo", "lie", "dist", "club"].some((k) => st[k].length) || Number(st.span) > 0;
    const reset = el("button", { class: "link", type: "button", hidden: !active }, "Clear filters");
    reset.addEventListener("click", () => { Object.assign(st, { span: 0, year: [], event: [], roundNo: [], lie: [], dist: [], club: [], openFilter: null }); draw(); });
    // Distances, grouped under their category; with categories picked, only theirs show.
    const base = me ? me.rounds : field.flatMap((p) => p.rounds);
    const distOpts = CATEGORIES.filter(([k]) => !st.cats.length || st.cats.includes(k))
      .flatMap(([k, label]) => filterOptions(base, k).dist.map((d) => ({ value: `${k}|${d}`, label: d, group: label })));
    const simple = (vals, fmt = (v) => v) => vals.map((v) => ({ value: v, label: fmt(v) }));
    // On phones the filters fold behind a "Filters" button (with how many are in use).
    const inUse = ["event", "roundNo", "lie", "dist", "club"].filter((k) => st[k].length).length + (Number(st.span) > 0 ? 1 : 0);
    const fold = el("button", { type: "button", class: "filters-toggle", "aria-expanded": st.filtersOpen ? "true" : "false" },
      [`Filters${inUse ? ` \u00b7 ${inUse} on` : ""}`, el("span", { "aria-hidden": "true" }, st.filtersOpen ? "\u25B4" : "\u25BE")]);
    fold.addEventListener("click", () => { st.filtersOpen = !st.filtersOpen; draw(); });
    return el("div", { class: "sg-filters" + (st.filtersOpen ? " open" : "") }, [
      fold,
      el("label", {}, ["Span", span]),
      multi("Tournament", "event", simple(opt.event), "All tournaments", { plural: "tournaments" }),
      multi("Round", "roundNo", simple(opt.roundNo, (v) => `Round ${v}`), "All rounds", { plural: "rounds", fmt: (v) => `Round ${v}` }),
      ...(basic ? [] : [
        multi("Lie", "lie", simple(opt.lie), "All lies", { plural: "lies" }),
        multi("Distance", "dist", distOpts, "All distances", { plural: "distances", fmt: (v) => v.split("|").slice(1).join("|") }),
        // Club: from Data Entry shots (WITB clubs) or a club column in an uploaded file.
        multi("Club", "club", clubOptions(opt), opt.club.length ? "All clubs" : "No club data", { plural: "clubs",
          empty: "No clubs in this data yet. Clubs come from shots entered with a Club (Data Entry) or a \u201cclub\u201d column in an uploaded file." }),
      ]),
      reset,
    ]);
  }
  // Category pills: pick one or several (e.g. Off-the-Tee + Approach + Around-the-Green = tee to green).
  // "All" clears the choice; picking all four is the same as All.
  /* ---------------- Basic / Advanced ---------------- */
  // (drawn under the Tour Events / Entered Rounds pills when the page gives a place for them)
  // Basic / Advanced sit beside the year pills now (the page's top spot is left empty)
  const placeView = () => { if (opts.viewHost && !container.closest("[hidden]")) mount(opts.viewHost, null); return null; };
  const yearsRow = (opt) => el("div", { class: "pill-row years-row" }, [yearPills(opt), viewPills()]);
  function viewPills() {
    const v = st.view || "advanced";
    return el("nav", { class: "subnav sg-view", "aria-label": "Basic or advanced stats" }, [["basic", "Basic"], ["advanced", "Advanced"]].map(([k, l]) => {
      const a = el("a", { href: "#", "aria-current": v === k ? "page" : null }, l);
      a.addEventListener("click", (e) => { e.preventDefault(); st.view = k; draw(); });
      return a;
    }));
  }
  // Traditional stats, from each round's counts (Data Entry rounds have them; a Tour Events file would need
  // those columns). higher: true = more is better.
  const BASIC = [
    { key: "scoring", label: "Scoring Avg", higher: false, dp: 1, unit: "", get: (c) => (c.holes ? (c.score / c.holes) * 18 : null) },
    { key: "gir", label: "GIR %", higher: true, dp: 1, unit: "%", get: (c) => (c.holes ? (c.gir / c.holes) * 100 : null) },
    { key: "hitGreen", label: "Hit Green %", higher: true, dp: 1, unit: "%", get: (c) => (c.apps ? (c.appGreen / c.apps) * 100 : null) },
    { key: "fwy", label: "Driving Accuracy", higher: true, dp: 1, unit: "%", get: (c) => (c.fwyN ? (c.fwy / c.fwyN) * 100 : null) },
    { key: "drive", label: "Driving Distance", higher: true, dp: 0, unit: " yds", get: (c) => (c.drives ? c.driveYds / c.drives : null) },
    { key: "putts", label: "Putts / Round", higher: false, dp: 1, unit: "", get: (c) => (c.puttHoles ? (c.putts / c.puttHoles) * 18 : null) },
    { key: "threePutt", label: "3-Putt Avoidance", higher: true, dp: 1, unit: "%", get: (c) => (c.puttHoles ? (1 - c.threePutts / c.puttHoles) * 100 : null) },
    { key: "ud", label: "Up & Down %", higher: true, dp: 1, unit: "%", get: (c) => (c.udN ? (c.ud / c.udN) * 100 : null) },
    { key: "birdie", label: "Birdie Pct", higher: true, dp: 1, unit: "%", get: (c) => (c.holes ? (c.birdies / c.holes) * 100 : null) },
    { key: "bogey", label: "Bogey Avoidance", higher: true, dp: 1, unit: "%", get: (c) => (c.holes ? (c.parOrBetter / c.holes) * 100 : null) },
    { key: "prox", label: "Proximity", higher: false, dp: 1, unit: " ft", get: (c) => (c.proxN ? c.proxFt / c.proxN : null) },
    { key: "owgr", label: "OWGR", soon: true },
  ];
  const sumCounts = (rounds) => {
    const t = {};
    for (const rd of rounds) for (const [k, v] of Object.entries(rd.basic || {})) t[k] = (t[k] || 0) + v;
    return t;
  };
  const basicNow = () => BASIC.find((b) => b.key === st.basicStat) || BASIC[0];
  const fmtBasic = (b, v) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v.toFixed(b.dp)}${b.unit}`);
  function basicStatBar(bField, bMine) {
    const all = [...(bMine || []), ...bField.flatMap((p) => p.rounds)];
    const has = (b) => !b.soon && all.some((rd) => rd.basic && b.get(rd.basic) != null);
    if (!has(basicNow())) { const first = BASIC.find(has); if (first) st.basicStat = first.key; }
    const sel = el("select", { "aria-label": "Stat Type" }, BASIC.map((b) =>
      el("option", { value: b.key, selected: basicNow().key === b.key, disabled: !has(b) }, b.soon ? `${b.label} (coming soon)` : has(b) ? b.label : `${b.label} (not in this data)`)));
    sel.addEventListener("change", () => { st.basicStat = sel.value; draw(); });
    return el("div", { class: "stat-type" }, el("label", {}, ["Stat Type", sel]));
  }
  function basicBlocks(bField, bMine) {
    const b = basicNow();
    const all = [...(bMine || []), ...bField.flatMap((p) => p.rounds)];
    if (!all.some((rd) => rd.basic && b.get && b.get(rd.basic) != null)) {
      return [el("section", { class: "panel" }, el("p", { class: "empty center" },
        "These stats come from rounds entered in Data Entry (every shot is recorded there). This data doesn\u2019t have them yet: switch to Entered Rounds, or use Advanced."))];
    }
    // rankings for the chosen stat
    const ranked = bField.map((p) => ({ p, v: b.get(sumCounts(p.rounds)), n: p.rounds.filter((rd) => rd.basic?.holes).length }))
      .filter((x) => x.v != null && Number.isFinite(x.v)).sort((x, y) => (b.higher ? y.v - x.v : x.v - y.v));
    const rankRows = ranked.map((x, i) => el("tr", { class: x.p.key === me?.key ? "me" : "" }, [
      el("td", { class: "num" }, String(i + 1)), el("td", {}, x.p.label), el("td", { class: "num" }, el("strong", {}, fmtBasic(b, x.v))), el("td", { class: "num" }, String(x.n)),
    ]));
    const blocks = [];
    if (showRanks) blocks.push(panelBox(`Rankings \u00b7 ${b.label}`, ranked.length ? el("div", { class: "table-scroll ranks-scroll" }, el("table", { class: "plain rankings" }, [
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, b.label), el("th", { class: "num" }, "Rounds")])),
      el("tbody", {}, rankRows),
    ])) : el("p", { class: "empty" }, "No rounds in this selection.")));
    // the player's trend by date, with the chosen players (Top 1 / 10 / … / All) for the same dates
    if (me && bMine?.length) {
      const groups = groupBy(bMine, st.trendBy);
      const vals = groups.map((g) => b.get(sumCounts(g.rounds)));
      // each round / event / month / year: the best result(s) there among the players who played it (this player included)
      const others = bField.filter((p) => p.key !== me.key && p.rounds.length);
      const cmp = others.length ? groups.map((g, i) => topMean([vals[i], ...others.map((p) => {
        const rs = groupBy(p.rounds, st.trendBy).find((x) => x.label === g.label)?.rounds;
        return rs ? b.get(sumCounts(rs)) : null;
      })], b.higher)) : null;
      const toggles = el("div", { class: "subnav small trend-toggles" }, [["round", "Round"], ["event", "Event"], ["month", "Month"], ["year", "Year"]].map(([v, l]) => {
        const a = el("a", { href: "#", "aria-current": v === st.trendBy ? "page" : null }, l);
        a.addEventListener("click", (e) => { e.preventDefault(); st.trendBy = v; draw(); });
        return a;
      }));
      st.chartTypes = st.chartTypes || {};
      if (!st.chartTypes["basic-trend"]) st.chartTypes["basic-trend"] = "line";
      blocks.push(panelBox(`${b.label} Trend`, [toggles, chartBox((c, as) => barChart(c, groups.map((g) => g.label), vals, {
        title: b.label, as, single: "#c8a97e", compare: cmp && cmp.some((v) => v != null) ? cmp : null, compareLabel: compareName({ round: "round", event: "event", month: "month", year: "year" }[st.trendBy] || "event"), shortLabels: groups.map((g) => g.short),
        tooltip: (i) => `${groups[i].rounds.length} ${groups[i].rounds.length === 1 ? "round" : "rounds"}`,
      }), "wide", "basic-trend", { rankPick: others.length > 0 })], "full"));
    }
    return blocks;
  }
  // rounds grouped by round / event / month / year (in date order), for the Basic trend
  function groupBy(rounds, by) {
    const m = new Map();
    for (const rd of [...rounds].sort((a, b2) => String(a.date).localeCompare(String(b2.date)))) {
      const d = new Date(rd.date), ok = !isNaN(d);
      const key = by === "year" ? (ok ? String(d.getFullYear()) : "?") : by === "month" ? (ok ? `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}` : "?")
        : by === "round" ? `${rd.key}` : (rd.event || rd.date);
      const g = m.get(key) || { label: by === "round" ? (ok ? `${shortDate(d)}` : rd.date) : key, short: ok ? shortDate(d) : null, rounds: [] };
      g.rounds.push(rd); m.set(key, g);
    }
    return [...m.values()];
  }

  // Stat Type: which kind of stats the page shows. Strokes Gained for now; the others (marked "coming
  // soon") depend on the category picked.
  const STAT_TYPES_BY_CAT = {
    all: ["OWGR", "Birdie Pct", "Bogey Avoidance", "Scoring Avg", "GIR %"],
    OTT: ["Driving Distance", "Driving Accuracy"],
    APP: ["Hit Green %", "Up & Down %", "Proximity"],
    ARG: ["Hit Green %", "Up & Down %", "Proximity"],
    PUTT: ["Make %", "3-Putt Avoidance", "Good Lag %"],
  };
  const statTypesNow = () => [["sg", "Strokes Gained"], ...(STAT_TYPES_BY_CAT[st.cats.length === 1 ? st.cats[0] : "all"] || []).map((l) => [l, l])];
  const READY_TYPES = ["sg"];
  function statTypeBar() {
    if (!statTypesNow().some(([v]) => v === (st.statType || "sg"))) st.statType = "sg";
    const sel = el("select", { "aria-label": "Stat Type" }, statTypesNow().map(([v, l]) =>
      el("option", { value: v, selected: (st.statType || "sg") === v, disabled: !READY_TYPES.includes(v) }, READY_TYPES.includes(v) ? l : `${l} (coming soon)`)));
    sel.addEventListener("change", () => { st.statType = sel.value; draw(); });
    return el("div", { class: "stat-type" }, el("label", {}, ["Stat Type", sel]));
  }

  // Year pills (under the categories): All, or any number of years.
  // Pills:
  //   tap a pill that isn't picked → pick just it (plus any kept 🔒 pills)
  //   tap a picked pill → un-pick it;  tap a kept pill → unlock it (it stays picked)
  //   double-tap → keep it (🔒), so the next taps add to it
  let lastTap = null; // { key, value, at, was: "kept" | "on" | "off" } (pills are redrawn on every tap, so remember by value)
  function tapPill(key, value, order) {
    const keepKey = `${key}Kept`;
    st[keepKey] = (st[keepKey] || []).filter((v) => st[key].includes(v));
    const now = Date.now();
    const dbl = lastTap && lastTap.key === key && lastTap.value === value && now - lastTap.at < 400;
    if (dbl) {
      // the first tap did its single-tap part; the second makes it kept (and picked)
      st[keepKey] = [...new Set([...st[keepKey], value])];
      if (!st[key].includes(value)) st[key] = [...st[key], value];
      lastTap = null;
    } else {
      const was = st[keepKey].includes(value) ? "kept" : st[key].includes(value) ? "on" : "off";
      if (was === "kept") st[keepKey] = st[keepKey].filter((v) => v !== value);       // unlock, stay picked
      else if (was === "on") st[key] = st[key].filter((v) => v !== value);           // un-pick
      else st[key] = [...st[keepKey], value];                                        // just this one (+ kept)
      lastTap = { key, value, at: now, was };
    }
    st[key].sort(order);
    draw();
  }
  const keptOf = (key) => (st[`${key}Kept`] || []).filter((v) => st[key].includes(v));

  function yearPills(opt) {
    if (!opt.year.length) return null;
    const years = [...opt.year].sort().reverse(); // newest first; "All years" at the end
    const all = el("a", { href: "#", "aria-current": !st.year.length ? "page" : null }, "All years");
    all.addEventListener("click", (e) => { e.preventDefault(); st.year = []; st.yearKept = []; draw(); });
    const kept = keptOf("year");
    return el("nav", { class: "subnav sg-years", "aria-label": "Years: tap to pick one, double-tap to keep it and add more" }, [...years.map((y) => {
      const on = st.year.includes(y), isKept = kept.includes(y);
      const a = el("a", { href: "#", class: isKept ? "kept" : "", "aria-current": on ? "page" : null, "aria-pressed": on ? "true" : "false",
        title: isKept ? "Kept: double-tap to let it go" : "Tap to pick; double-tap to keep it and add more" }, y);
      a.addEventListener("click", (e) => { e.preventDefault(); tapPill("year", y, (p, q) => p.localeCompare(q)); });
      return a;
    }), all]);
  }

  function catPills() {
    const allOn = !st.cats.length;
    const all = el("a", { href: "#", "aria-current": allOn ? "page" : null }, "All");
    all.addEventListener("click", (e) => { e.preventDefault(); st.cats = []; st.catsKept = []; draw(); });
    const kept = keptOf("cats");
    return el("nav", { class: "subnav sg-tabs", "aria-label": "Categories: tap to pick one, double-tap to keep it and add more" }, [all, ...CATEGORIES.map(([k, label]) => {
      const on = st.cats.includes(k), isKept = kept.includes(k);
      const a = el("a", { href: "#", class: isKept ? "kept" : "", "aria-current": on ? "page" : null, "aria-pressed": on ? "true" : "false",
        title: isKept ? "Kept: double-tap to let it go" : "Tap to pick; double-tap to keep it and add more" }, label);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        tapPill("cats", k, (x, y) => CATEGORIES.findIndex(([c]) => c === x) - CATEGORIES.findIndex(([c]) => c === y));
      });
      return a;
    })]);
  }
  const T2G = ["OTT", "APP", "ARG"];
  const catsName = () => (!st.cats.length || st.cats.length === CATEGORIES.length ? "All categories"
    : st.cats.length === 3 && T2G.every((k) => st.cats.includes(k)) ? "Tee to Green"
    : st.cats.map(catName).join(" + "));
  const list = (a, plural, fmt = (v) => v) => (!a.length ? "" : a.length <= 2 ? a.map(fmt).join(", ") : `${a.length} ${plural}`);
  const describe = () => [
    catsName(),
    list(st.year, "years"), list(st.event, "tournaments"),
    st.roundNo.length ? (st.roundNo.length <= 2 ? `Round ${st.roundNo.join(" & ")}` : `${st.roundNo.length} rounds`) : "",
    list(st.lie, "lies"), list(st.dist, "distances", (d) => d.split("|").slice(1).join("|")), list(st.club, "clubs"),
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
        value = mySG[k]; color = sgColor(value ?? 0); sub = showRanks && r && r.of > 1 ? `Rank ${r.rank} of ${r.of}` : ""; // green gained, red lost
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
      // the chosen players (Top 1 / 10 / 25 / 50 / All) for the same categories / lies
      const cmpField = topPlayers(slicedField);
      const avgOf = (vals) => { const v = vals.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const catCompare = cmpField.length ? shown.map(([k]) => avgOf(cmpField.map((p) => sliceTotals(p.rounds.map((rd) => ({ ...rd, shots: rd.shots.filter((x) => x.cat === k) }))).sgPerRound))) : null;
      const byCat = panelBox("SG by Category", chartBox((c, as) => barChart(c, bars.map((b) => b.label), bars.map((b) => b.value), {
        title: "SG / round", as, compare: catCompare, compareLabel: compareName() }), "", "by-category", { rankPick: cmpField.length > 0 }));
      const lies = sgBy(mine, idx, null, "lie");
      const lieCompare = lies && !fieldIsSummary() ? lies.map((g) => avgOf(cmpField.map((p) => (sgBy(p.rounds, idx, null, "lie") || []).find((x) => x.label === g.label)?.perRound))) : null;
      blocks.push(lies && lies.length > 1
        ? el("div", { class: "sg-grid" }, [byCat, panelBox("SG by Lie", chartBox((c, as) => barChart(c, lies.map((g) => g.label), lies.map((g) => g.perRound), { as,
            title: "SG / round", compare: lieCompare, compareLabel: compareName(), tooltip: (i) => `${nf1.format(lies[i].shots)} attempts` }), "", "all-lie", { rankPick: !!lieCompare }))])
        : byCat);
    } else {
      const comparable = !(fieldIsSummary() && narrowed()); // the field summary has no lie / distance detail
      // Stat · Rank · Player Avg · Player Best · Player Worst · All Players (the heading is
      // the selection itself, e.g. "Approach · 2026 · Rough").
      const stats = statTableFull(cat, { key: me.key, rounds: mine }, comparable ? slicedField : [], idx);
      const others = mode === "admin" ? "All Players" : "Field";
      blocks.push(panelBox(describe(), stats.length ? el("div", { class: "table-scroll" }, el("table", { class: "plain stats stat-full" }, [
        // (short headings on phones, e.g. "Avg" for "Player Avg")
        el("thead", {}, el("tr", {}, [["Stat", "Stat"], ["Rank", "Rank"], ["Player Avg", "Avg"], ["Player Best", "Best"], ["Player Worst", "Worst"], [others, "All"]].map(([long, short], i) =>
          el("th", { class: i ? "num" : "" }, long === short ? long : [el("span", { class: "long" }, long), el("span", { class: "short" }, short)])))),
        el("tbody", {}, stats.map((s) => {
          const fmt = (v) => (v === null || v === undefined ? "\u2014" : ["pct", "onePutt", "driverPct"].includes(s.kind) ? `${nf1.format(v)}%`
            : s.kind === "sgPerRound" || s.kind === "sgPerAttempt" ? `${v >= 0 ? "+" : ""}${v.toFixed(s.dp ?? 2)}` : v.toFixed(s.dp ?? 1));
          const sgRow = s.kind === "sgPerRound" || s.kind === "sgPerAttempt";
          const tone = (v) => { const b = sgRow ? v >= 0 : s.higher === null || s.field === null ? null : s.higher ? v >= s.field : v <= s.field; return v == null || b === null ? "" : b ? " good" : " bad"; };
          return el("tr", {}, [
            el("td", {}, s.label),
            el("td", { class: "num" }, s.rank ? `${s.rank} of ${s.of}` : "\u2014"),
            el("td", { class: "num" + tone(s.value) }, fmt(s.value)),
            el("td", { class: "num" }, fmt(s.best)),
            el("td", { class: "num" }, fmt(s.worst)),
            el("td", { class: "num muted" }, fmt(s.field)),
          ]);
        })),
      ])) : el("p", { class: "empty" }, "No stats for this selection.")));

      const visuals = [];
      if (cat === "OTT") { const miss = missSplit(mine, idx); if (miss) visuals.push(panelBox("Miss Tendencies", missBar(miss))); }
      if (cat === "APP" || cat === "ARG") {
        const pts = leavePoints(mine, idx, cat);
        if (pts) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c) => scatterChart(c, pts, LEAVE_SCALE[cat]), "tall")));
        else { const hist = leaveHistogram(mine, idx, cat); if (hist) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c, as) => barChart(c, hist.map((h) => h.label), hist.map((h) => h.count), { single: "#30d158", title: "Shots", as }), "", `${cat}-leave`))); }
      }
      for (const [fieldName, title] of BREAKDOWNS[cat]) {
        const groups = sgBy(mine, idx, cat, fieldName);
        if (!groups || (groups.length < 2 && fieldName !== "distanceRange")) continue;
        // "All players" markers only where the others' detail is available (admin).
        const compareField = topPlayers(slicedField);
        const compare = fieldIsSummary() ? null : groups.map((g) => {
          const vals = compareField.map((p) => (sgBy(p.rounds, idx, cat, fieldName) || []).find((x) => x.label === g.label)?.perRound).filter((v) => v !== undefined);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
        visuals.push(panelBox(title, chartBox((c, as) => barChart(c, groups.map((g) => g.label), groups.map((g) => g.perRound), { as,
          title: "SG / round", compare, compareLabel: compareName(), tooltip: (i) => `${nf1.format(groups[i].shots)} attempts`,
        }), "", `${cat}-${fieldName}`, { rankPick: !fieldIsSummary() })));
      }
      if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
    }

    const t = trend(mine, cat || null, st.trendBy);
    const toggles = el("div", { class: "subnav small trend-toggles" }, [["round", "Round"], ["event", "Event"], ["month", "Month"], ["year", "Year"]].map(([v, l]) => {
      const a = el("a", { href: "#", "aria-current": v === st.trendBy ? "page" : null }, l);
      a.addEventListener("click", (e) => { e.preventDefault(); st.trendBy = v; draw(); });
      return a;
    }));
    // Each round / event / month / year: the best result there (Top 1), the average of the best few (Top 10 …)
    // or of everyone (All), among the players who played it, this player included (so if they had the best
    // round, their bar meets the dot).
    const others = slicedField.filter((p) => p.key !== me.key && p.rounds.length);
    const otherTrends = others.map((p) => trend(p.rounds, cat || null, st.trendBy));
    const tCompare = others.length ? t.map((g) => topMean([g.value, ...otherTrends.map((ot) => ot.find((x) => x.label === g.label)?.value)])) : null;
    const unit = { round: "round", event: "event", month: "month", year: "year" }[st.trendBy] || "event";
    blocks.push(panelBox("SG Trends", [toggles, chartBox((c, as) => barChart(c, t.map((g) => g.label), t.map((g) => g.value), {
      title: "SG / round", as, compare: tCompare && tCompare.some((v) => v != null) ? tCompare : null, compareLabel: compareName(unit),
      shortLabels: t.map((g) => g.short),
      tooltip: (i) => (st.trendBy === "round" ? t[i].event : `${t[i].rounds} ${t[i].rounds === 1 ? "round" : "rounds"}`),
    }), "wide", "trend", { rankPick: others.length > 0 })], "full"));
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
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, "SG / Round"), el("th", { class: "num" }, [el("span", { class: "long" }, "Attempts / Round"), el("span", { class: "short" }, "Att / Rd")]), el("th", { class: "num" }, "Rounds")])),
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
  // Rank filter for the dashed comparison: everyone, or just the top 1 / 10 / 25 / 50 players by SG / round.
  const RANK_TOPS = [["1", "Top 1"], ["10", "Top 10"], ["25", "Top 25"], ["50", "Top 50"], ["all", "All"]];
  function topPlayers(list) {
    const n = st.rankTop && st.rankTop !== "all" ? Number(st.rankTop) : null;
    if (!n) return list;
    return list.filter((p) => p.rounds.length).map((p) => ({ p, v: sliceTotals(p.rounds).sgPerRound ?? -Infinity }))
      .sort((a, b) => b.v - a.v).slice(0, n).map((x) => x.p);
  }
  // what the gold dots are: on the trends, the best result(s) each round / event / month / year among the
  // players who played it; on the other charts, the best players over the selected time frame
  const compareName = (each = null) => {
    const n = st.rankTop && st.rankTop !== "all" ? st.rankTop : null;
    if (each) return n === "1" ? `Best player each ${each}` : n ? `Top ${n} each ${each} (avg)` : `All players each ${each} (avg)`;
    return n === "1" ? "Best player overall" : n ? `Top ${n} overall (avg)` : "All players (avg)";
  };
  // the best n of a set of results (lower is better for some Basic stats), averaged
  const topMean = (vals, higher = true) => {
    const v = vals.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => (higher ? q - p : p - q));
    if (!v.length) return null;
    const n = st.rankTop && st.rankTop !== "all" ? Number(st.rankTop) : v.length;
    const top = v.slice(0, n);
    return top.reduce((t, x) => t + x, 0) / top.length;
  };
  function rankPicker() {
    const sel = el("select", { class: "rank-pick", "aria-label": "Compare with",
      title: "Which players the gold dots show. On SG Trends: the best result (or the average of the best results) each round, event, month or year, among the players who played it. On the other charts: the best players over the selected time frame." },
      RANK_TOPS.map(([v, l]) => el("option", { value: v, selected: (st.rankTop || "all") === v }, l)));
    sel.addEventListener("change", () => { st.rankTop = sel.value; draw(); });
    return sel;
  }

  // A chart that draws itself once it's on the page. With a key, a small Bar | Line toggle sits in the
  // panel's corner; the choice is remembered per chart, and switching redraws just that chart.
  const BAR_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="8" width="3" height="6" rx="1"/><rect x="6.5" y="4" width="3" height="10" rx="1"/><rect x="11" y="6" width="3" height="8" rx="1"/></svg>';
  const LINE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,12 6,7 9.5,9.5 14,3.5"/></svg>';
  function chartBox(make, size = "", key = null, { rankPick = false } = {}) {
    const wrap = el("div", { class: `sg-chart ${size}` });
    let canvas = el("canvas", {});
    wrap.appendChild(canvas);
    let chart = null;
    const build = () => {
      if (typeof Chart === "undefined" || !wrap.isConnected) return;
      if (chart) { const i = charts.indexOf(chart); if (i >= 0) charts.splice(i, 1); chart.destroy(); }
      const fresh = el("canvas", {});
      canvas.replaceWith(fresh); canvas = fresh;
      chart = make(canvas, (key && st.chartTypes[key]) || "bar");
      charts.push(chart);
    };
    requestAnimationFrame(build);
    if (!key) return wrap;
    const toggle = el("div", { class: "chart-toggle", role: "group", "aria-label": "Chart style" });
    for (const [t, label, svg] of [["bar", "Bar chart", BAR_ICON], ["line", "Line chart", LINE_ICON]]) {
      const b = el("button", { type: "button", "aria-label": label, title: label, "aria-pressed": ((st.chartTypes[key] || "bar") === t) ? "true" : "false" });
      b.innerHTML = svg;
      b.addEventListener("click", () => {
        st.chartTypes[key] = t;
        toggle.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
        build();
      });
      toggle.appendChild(b);
    }
    return el("div", { class: "chart-holder" }, [el("div", { class: "chart-tools" }, [rankPick ? rankPicker() : null, toggle]), wrap]);
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
  function barChart(canvas, labels, values, { title, compare, compareLabel = "All players", average, single, tooltip, shortLabels = null, as = "bar" } = {}) {
    const signColors = values.map((v) => (v >= 0 ? "#30d158" : "#ff453a"));
    const datasets = [as === "line"
      // Line: a champagne line through green / red points, shaded green above zero and red below.
      ? { type: "line", label: title || "", data: values, order: 2, borderColor: single || "#c8a97e", borderWidth: 2.5, tension: 0.35,
          pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: single || signColors, pointBorderColor: single || signColors,
          fill: single ? { target: "origin", above: "rgba(200,169,126,0.12)" } : { target: "origin", above: "rgba(48,209,88,0.10)", below: "rgba(255,69,58,0.10)" } }
      : { type: "bar", label: title || "", data: values, borderRadius: 6, maxBarThickness: 44, backgroundColor: single || signColors, order: 2 }];
    // Reference marks: "All players" as blue dashes at each bar, "Average" as a yellow dashed line.
    // the other players: gold dots in front of the bars
    // (gold dots, no line)
    if (compare) datasets.push({ type: "line", label: compareLabel, data: compare, showLine: false, borderColor: "#d4b483", backgroundColor: "#d4b483",
      pointStyle: "circle", pointRadius: 4, pointHoverRadius: 5.5, pointBackgroundColor: "#d4b483", pointBorderColor: "#0a0a0b", pointBorderWidth: 1, order: 0 });
    if (average !== undefined) datasets.push({ type: "line", label: "Average", data: labels.map(() => average), borderColor: "#ffd60a", borderDash: [6, 6], borderWidth: 2, pointRadius: 0, order: 0 }); // yellow dashes, in front
    const o = baseOptions();
    // Legend: only the reference marks (no "SG / round" entry); the other players shown as a gold dot.
    o.plugins.legend = { display: !!(compare || average !== undefined), labels: {
      color: "#a1a1a6", boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle", font: { family: "Inter, system-ui, sans-serif", size: 12 },
      filter: (item) => item.datasetIndex !== 0,
    } };
    if (tooltip) o.plugins.tooltip.callbacks = { afterLabel: (c) => (c.datasetIndex === 0 ? tooltip(c.dataIndex) : "") };
    // Long labels (tournament names) are shortened under the bars, and on small screens an event shows just
    // its date; tapping a bar shows the full name.
    const narrow = (canvas.parentElement?.clientWidth || 800) < 640;
    const shortOf = (i) => {
      const l = String(labels[i] ?? "");
      if (narrow && shortLabels?.[i]) return shortLabels[i];
      const max = narrow ? 10 : 18;
      return l.length > max ? `${l.slice(0, max - 1).trimEnd()}\u2026` : l;
    };
    o.scales.x = { ...(o.scales.x || {}), ticks: { ...((o.scales.x || {}).ticks || {}), callback: (v, i) => shortOf(i), autoSkip: true, maxRotation: narrow ? 50 : 30, font: { size: narrow ? 10 : 12 } } };
    o.plugins.tooltip.callbacks = { ...(o.plugins.tooltip.callbacks || {}), title: (items) => String(labels[items[0].dataIndex] ?? "") };
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
    destroy() { destroyCharts(); if (opts.viewHost) mount(opts.viewHost, null); if (opts.slot && opts.slotHome) opts.slotHome.appendChild(opts.slot); document.removeEventListener("pointerdown", onDocDown); document.removeEventListener("keydown", onKey); },
    update(next) { if ("me" in next) me = next.me; if ("field" in next) field = next.field; draw(); },
  };
}
