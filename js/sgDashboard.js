// The strokes-gained dashboard, shared by the admin's Data → Analyze page and every player's My Data
// page (and coaches viewing a player). Styled after the original player site.
//
//   Stat Type (update 95): every stat found in the data (Strokes Gained, Hit Green %, Putts / Round ...). The
//   tables and charts follow what that stat has: split by category, distance and lie where it can be.
//   Filters: span · year · tournament · round · lie · distance, and category pills
//   "Your selection": SG / round, attempts / round, SG / attempt and rank for exactly that slice
//   SG cards (Total, T2G, OTT, APP, ARG, PUTT), category visuals, trends, rankings
//
// Strokes gained per round = sum over the slice of (SG per attempt × attempts) ÷ rounds in the slice.
// Players only ever see other players' numbers in the Rankings table, which comes from the published
// per-round, per-category summary, so player rankings follow year/tournament/round/category filters
// (not lie or distance).
import { careerBlocks } from "./careerBlocks.js";
import { statBlocks as statBlocksCmp } from "./compareData.js"; // (update 227: the full stats table)
import { getState } from "./auth.js";
import { favoriteKeys } from "./watchlist.js";
import { el, mount, loadScript } from "./ui.js";
import {
  CATEGORIES, applyFilters, roundFilter, filterOptions, sliceTotals, sgPerRound, sgBy, trend, statTable, statTableFull, shortDate,
  missSplit, leavePoints, leaveHistogram, rank, gradeColor, sgColor, fmtSG, defaultMinRounds,
  statRounds, statAgg, statDef, fmtStat, statsIn, groupObs, gearInfo, gearLabel, gearList,
} from "./sg.js";

const CHART_JS = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
// Span (update 159): months back from today ("Last Month" on 10/15 looks back to 9/15)
const SPANS = [["0", "All"], ["1", "Last Month"], ["3", "Last 3 Months"], ["6", "Last 6 Months"], ["12", "Last 12 Months"], ["18", "Last 18 Months"]];
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
  const showRanks = opts.rankings !== false && !opts.entered; // (update 183: entered rounds are never ranked, no wins or top 10s)
  const st = opts.state || {};
  // Year, tournament, round, lie and distance each hold a list (pick several); empty means all.
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  if (!SPANS.some(([v]) => v === String(st.span ?? 0))) st.span = 0; // (an old "last N rounds" pick)
  Object.assign(st, { span: st.span ?? 0, year: arr(st.year), event: arr(st.event), course: arr(st.course), roundNo: arr(st.roundNo), cats: st.cats ?? [], lie: arr(st.lie),
    dist: arr(st.dist).map((d) => (String(d).includes("|") ? d : `${st.distCat || ""}|${d}`)), club: arr(st.club), gear: arr(st.gear), ptype: arr(st.ptype), trendBy: st.trendBy ?? "event", rankQuery: st.rankQuery ?? "", openFilter: null, chartTypes: st.chartTypes ?? {} });
  st.rel = false; // (update 231: no Relative to Avg / Raw value on the stats page; the stats table compares with a rank instead) // (update 229: Relative to Avg unless Raw was picked) // (update 226: Raw / Relative to Tour Avg, remembered)
  const narrowed = () => st.lie.length || st.dist.length || st.club.length || st.gear.length; // lie / distance / club in use (the shared summary can't follow those)
  const charts = [];
  const destroyCharts = () => { while (charts.length) charts.pop().destroy(); };
  // Every stat's rounds (meAll / fieldAll); me / field hold the rounds of the stat on screen (Stat Type).
  let meAll = opts.me, fieldAll = opts.field || [];
  let me = meAll, field = fieldAll;
  let statKey = "sg", def = statDef("sg"), statList = ["sg"], catsAvail = CATEGORIES;
  // Some stats come one row per tournament (no round number, e.g. Birdies / Round over its rounds): then
  // what's counted is events, not rounds, and the page says so.
  let unit = "round";
  let sgEligible = null, sgMinR = 1; // the players ranked for every stat (see draw)
  const rw = (n) => `${Number(n).toLocaleString()} ${unit}${n === 1 ? "" : "s"}`;
  const Unit = () => (unit === "event" ? "Events" : "Rounds");
  const isSG = () => statKey === "sg";
  // (another stat: a round counts only where it has a value in the selection, e.g. an approach for Hit Green %)
  const nz = (rs) => (isSG() ? rs : rs.filter((rd) => rd.shots.length));
  let facet = { picked: [], events: [], sessions: [] }; // the Filters panel's lists (see draw)
  let lastSliced = []; // the field as sliced on screen (for the hero card's pop-ups)
  let lastRankF = {}; // the filters the field was sliced with (the rankings can't follow lie / distance from the shared summary)
  const fieldIsSummary = () => field.some((p) => p.summaryOnly);
  // a name that opens that player's view (a player's own leaderboard: only them; a coach: their players)
  const pickable = (key) => !!opts.onPick && (!opts.canPick || opts.canPick(key));
  // (update 167) a gold star beside the players on your Watchlist, in every leaderboard
  const favs = () => { try { return new Set(favoriteKeys()); } catch { return new Set(); } };
  let favSet = favs();
  const starred = (key, text) => (favSet.has(key) ? [el("span", { class: "fav-star", title: "On your Watchlist", "aria-label": "On your Watchlist" }, "\u2605"), text] : text);

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

  // (update 194) at the bottom: getting better or worse, and where they play their best (their whole career on this tour)
  const careerUi = {};
  function careerBox(only = "conditions") {
    if (!meAll || opts.practice || opts.emptyNote || !isSG()) return null;
    const tours = !opts.entered && st.tour?.length ? new Set(st.tour) : null;
    let rs = statRounds(meAll.rounds, "sg").filter((rd) => !tours || tours.has(rd.tour || ""));
    if (st.gear?.length) rs = applyFilters(rs, { gear: st.gear }); // (update 219: a product picked: only its shots, in the rounds it was used)
    const blocks = careerBlocks(rs, { key: meAll.key, source: opts.entered ? "entered" : "tour", ui: careerUi, redraw: () => draw(), only });
    return blocks.length ? el("div", { class: "cmp career" }, blocks) : null;
  }
  function draw() {
    favSet = favs();
    destroyCharts();
    chartSeq = 0;
    // Player Stats with nobody picked yet (update 158): the page is just the player search
    if (opts.blankWithoutMe && !meAll) {
      if (opts.lead && opts.leadHome) { opts.leadHome.appendChild(opts.lead); opts.leadHome.hidden = true; }
      mount(container, opts.slot || null);
      return;
    }
    // Stat Type: every stat in the data on screen (the player's, or everyone's), Strokes Gained first.
    statList = statsIn(meAll ? [meAll.rounds] : fieldAll.map((p) => p.rounds));
    if (!statList.length) statList = ["sg"];
    statKey = statList.includes(st.statWanted) ? st.statWanted : statList.includes("sg") ? "sg" : statList[0];
    def = statDef(statKey);
    me = meAll ? { ...meAll, rounds: statRounds(meAll.rounds, statKey) } : null;
    field = fieldAll.map((p) => ({ ...p, rounds: statRounds(p.rounds, statKey) }));
    const base = me ? me.rounds : field.flatMap((p) => p.rounds);
    unit = base.length && base.every((rd) => rd.eventLevel) ? "event" : "round";
    if (unit === "event" && st.trendBy === "round") st.trendBy = "event";
    // the categories this stat has (strokes gained: all four; Make %: Putting only; Scoring Avg: none)
    const catSeen = new Set(); for (const rd of base) for (const x of rd.shots) if (x.cat) catSeen.add(x.cat);
    catsAvail = CATEGORIES.filter(([k]) => catSeen.has(k));
    if (opts.entered && !base.length && statKey === "sg") catsAvail = CATEGORIES; // (entered rounds / practice with nothing yet: the filters still show)
    st.cats = st.cats.filter((k) => catSeen.has(k));
    // Keep only choices that still exist: distances of the picked categories, lies seen in them.
    if (st.cats.length) st.dist = st.dist.filter((d) => st.cats.includes(d.split("|")[0]));
    const fullOpt = filterOptions(base, st.cats);
    if (!st.yearStarted && fullOpt.year.length) { st.yearStarted = true; if (!st.year.length) st.year = [[...fullOpt.year].sort().pop()]; } // the latest year to start
    // One tour at a time (each tour's numbers come from its own source and scale, so they're never mixed).
    // A player starts on the tour they have the most rounds on; with no player, the PGA TOUR (or the biggest).
    const tourCount = new Map(); for (const rd of base) tourCount.set(rd.tour || "", (tourCount.get(rd.tour || "") || 0) + 1);
    const tourList = [...tourCount.keys()];
    tourCounts = [...tourCount].sort((a, b) => b[1] - a[1]); // for the tour buttons
    if (tourList.length > 1 || (tourList.length === 1 && tourList[0] !== "")) {
      const who = me?.key ?? "__field";
      if (st.tourFor !== who || !tourList.includes(st.tour?.[0])) {
        st.tourFor = who;
        const byRounds = [...tourCount].sort((a, b) => b[1] - a[1]).map(([t]) => t);
        const pga = !me && tourList.find((t) => /^pga(\s*tour)?$/i.test(String(t).trim()));
        st.tour = [pga || byRounds[0]];
      } else st.tour = [st.tour[0]];
    } else st.tour = [];
    // Linked filters (update 166): each dropdown lists only what the other picks leave (the tour's courses,
    // a tournament's course, the last month's tournaments). A pick that's no longer there goes.
    const roundPicks = () => ({ months: Number(st.span), year: st.year, tour: st.tour, event: opts.practice ? [] : st.event, course: st.course, roundNo: st.roundNo, ptype: st.ptype });
    const leaving = (k) => base.filter(roundFilter({ ...roundPicks(), [k]: [] }));
    if (opts.practice) st.event = [];
    else st.event = st.event.filter((e) => eventOptions(leaving("event")).some((o) => o.value === e));
    const uniqOf = (rs, k) => [...new Set(rs.map((rd) => rd[k]).filter((v) => v != null && v !== ""))];
    const courseList = uniqOf(leaving("course"), "course").sort((x, y) => String(x).localeCompare(String(y)));
    st.course = st.course.filter((c) => courseList.includes(c));
    const roundList = uniqOf(leaving("roundNo"), "roundNo").sort((x, y) => (parseFloat(x) || 0) - (parseFloat(y) || 0) || String(x).localeCompare(String(y)));
    st.roundNo = st.roundNo.filter((r) => roundList.includes(r));
    if (opts.practice) { const ps = new Set(sessionOptions(leaving("ptype")).map((o) => o.value)); st.ptype = st.ptype.filter((v) => ps.has(v)); }
    // lie, distance and club: what the rounds picked have
    const picked = base.filter(roundFilter(roundPicks()));
    const opt = { ...filterOptions(picked, st.cats), year: fullOpt.year, tour: fullOpt.tour, course: courseList, roundNo: roundList };
    facet = { picked, events: opts.practice ? [] : eventOptions(leaving("event")), sessions: opts.practice ? sessionOptions(leaving("ptype")) : [] };
    st.lie = st.lie.filter((l) => opt.lie.includes(l));
    st.club = st.club.filter((c) => opt.club.includes(c));
    st.gear = st.gear.filter((c) => opt.gear.includes(c));
    const f = { months: Number(st.span), year: st.year, tour: st.tour, event: st.event, course: st.course, roundNo: st.roundNo, cats: st.cats, lie: st.lie, dist: st.dist, club: st.club, gear: st.gear, ptype: st.ptype };
    // Rankings from the shared summary can't follow lie / distance / club.
    const rankF = fieldIsSummary() ? { ...f, lie: [], dist: [], club: [], gear: [] } : f; // (update 219: nor product)
    lastRankF = rankF;
    const slicedField = field.map((p) => ({ ...p, rounds: nz(applyFilters(p.rounds, rankF)) }));
    lastSliced = slicedField;
    // Who's ranked, for every stat: players with at least Min. rounds of strokes-gained data in the selection
    // (year, tour, tournament, round, span). Other stats' rows don't line up with rounds (some are one row per
    // tournament), so they use this same list. With no strokes-gained data at all, each stat counts its own.
    sgEligible = null;
    const roundF = { ...rankF, cats: [], lie: [], dist: [], club: [] };
    const sgCounts = fieldAll.map((p) => [p.key, applyFilters(statRounds(p.rounds, "sg"), roundF).length]).filter(([, n]) => n > 0);
    if (sgCounts.length) {
      sgMinR = minFor(Math.max(...sgCounts.map(([, n]) => n)));
      sgEligible = new Set(sgCounts.filter(([, n]) => n >= sgMinR).map(([k]) => k));
    }
    const mine = me ? nz(applyFilters(me.rounds, f)) : null;
    // Gold dots (Top 1 / 10 / 25 / 50 / All): until picked by hand, the next group up from the player's rank
    // (Min. rounds applies): 100th → Top 50, 18th → Top 10, 2nd-10th → Top 1; the leader compares with the Top 10.
    if (me && !(st.rankTopManual && st.rankTopFor === me.key)) {
      const r = rankAmong(slicedField, me.key).rank;
      st.rankTop = !r ? "all" : r === 1 ? "10" : String([50, 25, 10, 1].find((t) => t < r));
      st.rankTopFor = me.key; st.rankTopManual = false;
    }

    // Rebuilding the dashboard would briefly shrink the page and jump it to the top. Hold its
    // height and put the scroll position back, so changing a filter or pill keeps your place.
    const y = window.scrollY;
    const panelScroll = container.querySelector(".ms-panel:not([hidden]) .ms-options")?.scrollTop || 0;
    container.style.minHeight = `${container.offsetHeight}px`;
    // Remember which control had focus, so it can be focused again without scrolling.
    const act = container.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = act ? (act.getAttribute("aria-label") || act.textContent).trim() : null;
    const focusTag = act?.tagName;
    const vp = placeView(); parkLead();
    mount(container, [
      vp,
      opts.note && isSG() ? el("p", { class: "muted small center sg-note" }, opts.note) : null,
      opts.slot || null, // the page's player search, then the Filters panel
      filtersPanel(opt),
      el("div", { class: "sg-panel" }, (() => {
        // nothing to show (no player picked, or no rounds yet): the same Filters panel, and why it's empty
        if (opts.emptyNote) return [el("section", { class: "panel sg-empty-note" }, el("p", { class: "empty center" }, opts.emptyNote))];
        if (!isSG()) return statBlocks(mine, slicedField, f);
        // The rankings are always the first thing (Stat Averages and the charts follow).
        const blocks = me ? detailBlocks(mine, slicedField) : [];
        // (update 205) "Getting better or worse?" right under the hero card
        return [heroBox(mine, slicedField, f), careerBox("trajectory"), me ? summaryBox(mine, slicedField) : null, ...blocks, ...(!me ? tourBlocks(slicedField) : [])];
      })()),
      // (update 219) "Where they play their best" is on the Compare page now
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
    // nothing picked = everything: shown with every box ticked, unless you just pressed None (all unticked)
    st.noneShown ||= {};
    const allTicked = !chosen.size && !st.noneShown[key];
    const labelOf = (v) => options.find((o) => o.value === v)?.label ?? fmt(v);
    const summary = !chosen.size || (options.length > 1 && chosen.size === options.length) ? allLabel // nothing or everything ticked = all
      : chosen.size <= 2 ? [...chosen].map(labelOf).join(", ") : `${chosen.size} ${plural}`;
    const open = st.openFilter === key;
    const btn = el("button", { type: "button", class: "ms-btn" + (chosen.size ? " on" : ""), "aria-expanded": open ? "true" : "false", "aria-label": `${label}: ${summary}` }, [
      el("span", { class: "ms-sum" }, summary), el("span", { class: "ms-caret", "aria-hidden": "true" }, "\u25BE"),
    ]);
    const toggle = (v, on) => {
      if (allTicked && !on) st[key] = options.map((o) => o.value).filter((x) => x !== v); // (from "all": everything but this one)
      else st[key] = on ? [...st[key], v] : st[key].filter((x) => x !== v);
      st.noneShown[key] = false;
      if (st[key].length && st[key].length === options.length) st[key] = []; // (everything ticked: back to "all")
      if (key === "dist" && on) { // a distance belongs to a category: make sure that category is picked
        const c = v.split("|")[0];
        if (!st.cats.length || st.cats.length === CATEGORIES.length) st.cats = [c]; else if (!st.cats.includes(c)) st.cats = [...st.cats, c];
      }
      if (key === "club" || key === "gear") followClubs();
      st.openFilter = key;
      draw();
    };
    let lastGroup = null;
    const rows = [];
    for (const o of options) {
      if (o.group && o.group !== lastGroup) { rows.push(el("p", { class: "ms-group" }, o.group)); lastGroup = o.group; }
      const box = el("input", { type: "checkbox", checked: allTicked || chosen.has(o.value), "aria-label": `${label}: ${o.label}` });
      box.addEventListener("change", () => toggle(o.value, box.checked));
      rows.push(el("label", { class: "ms-row" }, [box, el("span", {}, o.label)]));
    }
    // All: tick every option. None: untick them all (then tick just the ones you want; nothing ticked shows everything).
    const all = el("button", { type: "button", class: "link ms-all" }, "All");
    all.addEventListener("click", () => { st[key] = []; st.noneShown[key] = false; if (key === "club" || key === "gear") followClubs(); st.openFilter = key; draw(); });
    const none = el("button", { type: "button", class: "link ms-all" }, "None");
    none.addEventListener("click", () => { st[key] = []; st.noneShown[key] = true; if (key === "club" || key === "gear") followClubs(); st.openFilter = key; draw(); });
    // (update 227) a search box over a long list (Products, Tournaments, …): narrows the list as you type
    st.msQ ||= {};
    const optBox = el("div", { class: "ms-options" }, rows.length ? rows : el("p", { class: "muted small" }, empty));
    const filterRows = (q) => {
      const t = q.trim().toLowerCase(); let grpEl = null, grpAny = false;
      for (const n of optBox.children) {
        if (n.classList.contains("ms-group")) { if (grpEl) grpEl.hidden = !grpAny; grpEl = n; grpAny = false; continue; }
        const hit = !t || n.textContent.toLowerCase().includes(t) || (grpEl && grpEl.textContent.toLowerCase().includes(t));
        n.hidden = !hit; if (hit) grpAny = true;
      }
      if (grpEl) grpEl.hidden = !grpAny;
    };
    const search = options.length > 10 || key === "gear" ? el("input", { type: "search", class: "ms-search", placeholder: `Search ${plural || label.toLowerCase()}\u2026`, value: st.msQ[key] || "", "aria-label": `Search ${label}` }) : null;
    search?.addEventListener("input", () => { st.msQ[key] = search.value; filterRows(search.value); });
    if (search && st.msQ[key]) filterRows(st.msQ[key]);
    const panel = el("div", { class: "ms-panel", hidden: !open, role: "group", "aria-label": label }, [
      el("div", { class: "ms-top" }, [el("strong", {}, label), el("span", { class: "ms-allnone" }, [all, none])]),
      search,
      optBox,
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
  const GEAR_ORDER = ["Driver", "Non-Driver", "Fairway Wood", "Hybrid", "Iron", "Wedge", "Putter", "Other", "Golf Ball"];
  function clubOptions(opt) {
    return opt.club.map((c) => ({ value: c, label: c, group: opt.clubCats[c] || "Other" }))
      .sort((a, b) => CLUB_GROUPS.indexOf(a.group) - CLUB_GROUPS.indexOf(b.group));
  }
  // Picking clubs shows only the categories those clubs were used in (a driver: Off-the-Tee; a putter:
  // Putting; a 7-iron: Approach, plus Off-the-Tee if it was hit off a par-4 tee). Clearing them shows all.
  function followClubs() {
    if (!st.club.length && !st.gear.length) { st.cats = []; return; }
    const base = me ? me.rounds : field.flatMap((p) => p.rounds);
    const picked = new Set(st.club), pickedG = new Set(st.gear); // (update 210: products too)
    const cats = new Set();
    for (const rd of base) for (const sh of rd.shots) if ((!picked.size || picked.has(sh.club)) && (!pickedG.size || pickedG.has(sh.gear) || (sh.ball && pickedG.has(`Ball|${sh.ball}`)))) cats.add(sh.cat);
    st.cats = CATEGORIES.map(([k]) => k).filter((k) => cats.has(k));
    st.dist = st.dist.filter((d) => st.cats.includes(d.split("|")[0]));
  }

  // The Tournament filter's list: the tournaments on the tour and in the years picked, newest first.
  // (entered rounds: each tournament entered, and "Practice Rounds" for the rest)
  function eventOptions(rounds) {
    const tours = st.tour.length ? new Set(st.tour.map(String)) : null, years = st.year.length ? new Set(st.year.map(String)) : null;
    const last = new Map();
    for (const rd of rounds) {
      if (tours && rd.tour !== undefined && !tours.has(rd.tour || "")) continue;
      if (years && !years.has(String(rd.year))) continue;
      const e = rd.tfilter ?? rd.event;
      if (e == null || e === "") continue;
      const t = Date.parse(rd.date) || 0;
      if (!last.has(e) || t > last.get(e)) last.set(e, t);
    }
    return [...last].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([e]) => ({ value: e, label: e }));
  }
  // Practice's Session filter: Custom practice, Course Prep, Sim rounds and each game.
  const PTYPE = { custom: "Custom practice", prep: "Course Prep", sim: "Sim rounds" };
  function sessionOptions(rounds) {
    const seen = new Set(rounds.map((rd) => rd.ptype).filter(Boolean));
    const kinds = ["custom", "prep", "sim"].map((k) => ({ value: k, label: PTYPE[k], group: "Sessions" }));
    const games = [...seen].filter((k) => k.startsWith("game:")).sort().map((k) => ({ value: k, label: k.slice(5), group: "Games" }));
    return [...kinds, ...games];
  }

  function filterBar(opt, { bare = false } = {}) {
    const span = el("select", { "aria-label": "Span" }, SPANS.map(([v, l]) => el("option", { value: v, selected: String(st.span) === v }, l)));
    // (a span reaches back across years, so it shows every year: the year pills would cut it short)
    span.addEventListener("change", () => { st.span = Number(span.value); if (st.span > 0) { st.year = []; st.yearKept = []; } draw(); });
    const latest = [...opt.year].sort().pop();
    const active = ["event", "course", "roundNo", "lie", "dist", "club", "gear", "cats", "ptype"].some((k) => st[k].length) || Number(st.span) > 0
      || JSON.stringify(st.year) !== JSON.stringify(latest ? [latest] : []);
    const reset = el("button", { class: "link", type: "button", hidden: !active }, "Reset Filters");
    reset.addEventListener("click", () => {
      Object.assign(st, { span: 0, year: latest ? [latest] : [], tour: [], event: [], course: [], roundNo: [], lie: [], dist: [], club: [], cats: [], ptype: [], openFilter: null });
      draw();
    });
    // Distances, grouped under their category; with categories picked, only theirs show.
    const base = facet.picked;
    const distOpts = catsAvail.filter(([k]) => !st.cats.length || st.cats.includes(k))
      .flatMap(([k, label]) => filterOptions(base, k).dist.map((d) => ({ value: `${k}|${d}`, label: d, group: label })));
    const simple = (vals, fmt = (v) => v) => vals.map((v) => ({ value: v, label: fmt(v) }));
    // On phones the filters fold behind a "Filters" button (with how many are in use).
    const inUse = ["event", "course", "roundNo", "lie", "dist", "club", "gear", "ptype"].filter((k) => st[k].length).length + (Number(st.span) > 0 ? 1 : 0);
    const fold = el("button", { type: "button", class: "filters-toggle", "aria-expanded": st.filtersOpen ? "true" : "false" },
      [`More Filters${inUse ? ` \u00b7 ${inUse} on` : ""}`, el("span", { "aria-hidden": "true" }, st.filtersOpen ? "\u25B4" : "\u25BE")]);
    fold.addEventListener("click", () => { st.filtersOpen = !st.filtersOpen; draw(); });
    return el("div", { class: "sg-filters" + (st.filtersOpen || bare ? " open" : "") + (bare ? " bare" : "") }, [
      bare ? null : fold,
      // (laid out like the other filters, so its heading matches theirs)
      el("div", { class: "span-pick" }, [el("span", { class: "ms-label" }, "Span"), span]),
      // Practice has no tournaments: its Session filter instead (custom practice, Course Prep, sim rounds, games)
      opts.practice ? multi("Session", "ptype", facet.sessions, "All sessions", { plural: "sessions", fmt: (v) => PTYPE[v] || String(v).replace(/^game:/, "") })
        : multi("Tournament", "event", facet.events, "All tournaments", { plural: "tournaments" }),
      // Course (update 160): when the data has a course column
      opt.course.length ? multi("Course", "course", simple(opt.course), "All courses", { plural: "courses" }) : null,
      opts.entered ? null : multi("Round", "roundNo", simple(opt.roundNo, (v) => `Round ${v}`), "All rounds", { plural: "rounds", fmt: (v) => `Round ${v}` }),
      // Lie and distance when this stat has them (always for entered rounds and practice); Club for strokes gained.
      opt.lie.length || (opts.entered && isSG()) ? multi("Lie", "lie", simple(opt.lie), "All lies", { plural: "lies", empty: "No lies in this selection yet." }) : null,
      distOpts.length || (opts.entered && isSG()) ? multi("Distance", "dist", distOpts, "All distances", { plural: "distances", fmt: (v) => v.split("|").slice(1).join("|"), empty: "No distances in this selection yet." }) : null,
      // Club: from Data Entry shots (WITB clubs) or a club column in an uploaded file.
      isSG() ? multi("Club", "club", clubOptions(opt), opt.club.length ? "All clubs" : "No club data", { plural: "clubs",
        empty: "No clubs in this data yet. Clubs come from shots entered with a Club (Data Entry) or a \u201cclub\u201d column in an uploaded file." }) : null,
      // (update 210) Product: a club model (brand and model) or a ball, under its kind of club
      isSG() && opt.gear.length ? multi("Product", "gear", opt.gear.map((v) => { const g = gearInfo(v); return { value: v, label: `${g.brand} ${g.model}`.trim(), group: g.kind === "Ball" ? "Golf Ball" : g.kind }; })
        .sort((a, b) => GEAR_ORDER.indexOf(a.group) - GEAR_ORDER.indexOf(b.group) || a.label.localeCompare(b.label)), "All products", { plural: "products", fmt: (v) => gearLabel(v) }) : null,
      reset,
    ]);
  }
  // Category pills: pick one or several (e.g. Off-the-Tee + Approach + Around-the-Green = tee to green).
  // "All" clears the choice; picking all four is the same as All.
  const CAT_NAME = Object.fromEntries(CATEGORIES);
  /* ---------------- the Filters panel (everything but the player search) ---------------- */
  function filtersPanel(opt) {
    if (st.panelOpen === undefined) st.panelOpen = false; // folded each time the page opens (update 166)
    const open = !!st.panelOpen;
    const src = opts.lead?.querySelector?.("[aria-current=page]")?.textContent || "";
    const yrs = st.year.length ? [...st.year].sort().reverse().join(" + ") : "All years";
    const cats = catsAvail.length < 2 ? "" : st.cats.length ? st.cats.map((k) => CAT_NAME[k] || k).join(" + ") : "All categories";
    const more = ["event", "course", "roundNo", "lie", "dist", "club", "gear", "ptype"].filter((k) => (st[k] || []).length).length + (Number(st.span) > 0 ? 1 : 0);
    const btn = el("button", { type: "button", class: "filters-panel-btn", "aria-expanded": open ? "true" : "false" }, [
      el("span", { class: "fp-title" }, "Filters"),
      el("span", { class: "fp-sum" }, [src, yrs, tourCounts.length ? tourName(st.tour[0] ?? "") : "", def.label, cats, more ? `${more} more` : ""].filter(Boolean).join(" \u00b7 ")),
      el("span", { class: "fp-caret", "aria-hidden": "true" }, open ? "\u25B4" : "\u25BE"),
    ]);
    btn.addEventListener("click", () => { st.panelOpen = !st.panelOpen; draw(); });
    // Stat Type sits beside the Filters button, so it's there whether the panel is open or folded
    return el("section", { class: `filters-panel${open ? " open" : ""}` }, [el("div", { class: "fp-head" }, [btn]), open ? el("div", { class: "fp-body" }, [
      yearsRow(opt, { cats: true }), filterBar(opt, { bare: true }),
    ]) : null]);
  }
  // When the panel is folded the page's data pills still need a home on the page (they're lent to us).
  // (only the dashboard on screen moves them: a hidden one, e.g. the other data source, leaves them alone)
  const parkLead = () => {
    if (!opts.lead || !opts.leadHome || container.closest("[hidden]")) return;
    if (!st.panelOpen && opts.lead.parentNode !== opts.leadHome) opts.leadHome.appendChild(opts.lead);
    opts.leadHome.hidden = true;
  };

  /* ---------------- the hero: the lead card ---------------- */
  const updatedTxt = () => {
    const t = opts.updatedAt ? new Date(opts.updatedAt) : null;
    // (ShotLink only for PGA TOUR and Korn Ferry data)
    const shotlink = !opts.entered && /^(pga|korn)/i.test(String(st.tour?.[0] ?? ""));
    return [t && !isNaN(t) ? `Last updated ${t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : null, shotlink ? "Powered by ShotLink" : null].filter(Boolean).join(" \u00b7 ");
  };
  function heroBox(mine, slicedField, f) {
    const foot = el("p", { class: "hero-foot" }, updatedTxt());
    const sg = isSG();
    if (me && mine && mine.length) {
      // the player: their number, rank, form, a rolling-average chart, and a tile for each category to explore
      const total = metric(mine), r = rankAmong(slicedField, me.key);
      const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const per = ordered.map((rd) => metric([rd]));
      // (update 168) the rank after each round: where they stood in the field on that date, this selection
      const hist = showRanks ? rankHistory(ordered, slicedField, r) : rollingOnly(ordered); // (update 183: no ranks: the rolling average alone)
      const n = Math.min(10, Math.floor(per.length / 2));
      let form = null;
      if (n >= 2) {
        const last = metric(ordered.slice(-n)), prev = metric(ordered.slice(-2 * n, -n));
        if (last != null && prev != null) {
          const ch = last - prev, steady = Math.abs(ch) < steadyBand(prev);
          const amt = sg ? Math.abs(ch).toFixed(2) : fmtStat({ ...def, unit: def.pct ? "" : def.unit }, Math.abs(ch)).replace("%", def.pct ? " pct" : "");
          form = steady ? ["Steady", ""] : sg ? (ch > 0 ? [`Better by ${amt}`, "up"] : [`Worse by ${amt}`, "down"]) // (update 182: Better / Worse, not Up / Down)
            : def.higher == null ? [`${ch > 0 ? "Higher" : "Lower"} by ${amt}`, ""] : (def.higher ? ch > 0 : ch < 0) ? [`Better by ${amt}`, "up"] : [`Worse by ${amt}`, "down"];
        }
      }
      // a tile per category this stat has (with its rank among the same players, every category counted)
      const allCats = nz(applyFilters(me.rounds, { ...f, cats: [] }));
      const fieldAllCats = catsAvail.length > 1 ? field.map((p) => ({ ...p, rounds: nz(applyFilters(p.rounds, { ...lastRankF, cats: [] })) })) : [];
      // A lie / distance / club filter belongs to the category picked: the other categories' tiles keep their
      // own numbers (only the year / tour / tournament / round / span filters apply), dimmed and not clickable.
      const apart = (k) => !!(narrowed() && st.cats.length && !st.cats.includes(k));
      const noShot = { lie: [], dist: [], club: [] };
      const anyApart = catsAvail.some(([k]) => apart(k));
      const allCatsBare = anyApart ? nz(applyFilters(me.rounds, { ...f, ...noShot, cats: [] })) : null;
      const fieldBare = anyApart ? field.map((p) => ({ ...p, rounds: nz(applyFilters(p.rounds, { ...lastRankF, ...noShot, cats: [] })) })) : [];
      const avgIn = (list, k) => { const v = rankedField(list).map((p) => metric(p.rounds, k)).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const tiles = catsAvail.length < 2 ? [] : catsAvail.map(([k, l]) => {
        const off = apart(k), mineK = off ? allCatsBare : allCats, fieldK = off ? fieldBare : fieldAllCats;
        const v = metric(mineK, k), rk = rankAmong(fieldK, me.key, k);
        const on = st.cats.length === 1 && st.cats[0] === k;
        const b = el("button", { type: "button", class: `hero-tile${on ? " on" : ""}${off ? " apart" : ""}`, "aria-pressed": on ? "true" : "false", disabled: off ? true : null,
          title: off ? "Lie / distance / club filters don\u2019t apply here: this is the whole category. Reset the filters to explore it." : on ? "Back to all categories" : `Explore ${l}` }, [
          el("span", { class: "ht-name" }, l), (() => { const ref = relOn() ? othersAvg(fieldK, me.key, k) : null; return el("strong", { class: v == null ? "" : showCls(v, ref, sg ? null : avgIn(fieldK, k)) }, showV(v, ref)); })(), el("span", { class: "ht-rank" }, showRanks && rk.rank && rk.of > 1 ? `${ordinal(rk.rank)} of ${rk.of}` : ""),
        ]);
        if (!off) b.addEventListener("click", () => { st.cats = on ? [] : [k]; draw(); });
        return b;
      });
      const heroRef = relOn() ? othersAvg(slicedField, me.key) : null; // (update 226)
      const fieldVals = sg ? null : rankAmong(slicedField, null).vals;
      const fieldAvg = fieldVals && fieldVals.length ? fieldVals.reduce((t, x) => t + x.v, 0) / fieldVals.length : null;
      const trendName = sg ? "SG" : def.label;
      return el("section", { class: "panel hero" }, [
        el("div", { class: "hero-top" }, [
          el("div", { class: "hero-id" }, [
            el("span", { class: "hero-kicker" }, `${describe()}`),
            el("h2", { class: "hero-name" }, me.label),
            el("div", { class: "hero-big" }, [el("strong", { class: showCls(total, heroRef, fieldAvg) }, showV(total, heroRef)), el("span", {}, relOn() && heroRef != null ? `${sg ? "strokes gained a round" : def.label} vs the field (${fmtV(heroRef)})` : sg ? "strokes gained a round" : def.label)]),
            sg ? null : el("p", { class: "hero-help" }, def.help),
            // (update 159: each pill opens a table: the rankings, every round, the form, the wins and top 10s)
            el("div", { class: "hero-chips" }, [
              // (coloured by rank, as in the report: top 10, 11-50, 51-100, 101-150, past 150)
              showRanks && r.rank && r.of > 1 ? chipBtn(`hero-chip rank-chip ${r.rank <= 10 ? "rk-10" : r.rank <= 50 ? "rk-50" : r.rank <= 100 ? "rk-100" : r.rank <= 150 ? "rk-150" : "rk-out"}`,
                `${ordinal(r.rank)} of ${r.of}`, "Show the rankings", () => rankPopup()) : null,
              chipBtn("hero-chip", rw(mine.length), `Show every ${unit}`, () => tournamentsPopup(ordered, slicedField, "Rounds")),
              // (update 175) Events: each tournament, their average there and where it placed
              unit === "event" ? null : (() => { const n = new Set(ordered.map((rd) => `${rd.event}|${yearOf(rd)}`)).size;
                return chipBtn("hero-chip", `${n} Event${n === 1 ? "" : "s"}`, "Show every tournament", () => eventsPopup(ordered, slicedField, r, "event")); })(),
              form ? chipBtn(`hero-chip ${form[1]}`, `Form: ${form[0]}`, "Show the form", () => formPopup(ordered)) : null,
            ]),
            (() => {
              if (!showRanks || !rankedField(slicedField).some((p) => p.key !== me.key)) return null;
              const res = myFinishes(slicedField), wins = res.filter((x) => x.rank === 1), tops = res.filter((x) => x.rank <= 10);
              return el("div", { class: "hero-chips hero-chips2" }, [
                chipBtn("hero-chip", `${wins.length} ${wins.length === 1 ? "Win" : "Wins"}`, "Show the wins", () => finishesPopup(wins, "Wins", res)),
                chipBtn("hero-chip", `${tops.length} Top 10${tops.length === 1 ? "" : "s"}`, "Show the top 10s", () => finishesPopup(tops, "Top 10s", res)),
              ]);
            })(),
            insightsButton(slicedField),
          ]),
          (() => {
            // tap the chart: every round, its number and its rank in the field
            if (hist.length < 2) return null;
            // (update 177: one point a tournament; Min. rounds is no longer here, it's in the Rankings)
            const labels = hist.map((x) => { const d = new Date(x.date); return isNaN(d) ? x.date : shortDate(d); });
            // (update 174) Rank | Stat: the rolling rank, or the rolling average (everything up to that date, this selection)
            const mode = () => (!showRanks || st.heroChartMode === "stat" ? "stat" : "rank");
            const title = () => (mode() === "stat" ? "Weekly Rolling Average" : "Weekly Rank History");
            const makeChart = () => chartBox((c) => (mode() === "stat" ? heroChart(c, labels, hist.map((x) => x.avg)) : rankChart(c, labels, hist)));
            const titleEl = el("span", { class: "hero-chart-title" }, title());
            const seg = el("div", { class: "hero-chart-mode", role: "group", "aria-label": "Chart shows" }, [["rank", "Rank"], ["stat", "Stat"]].map(([v, l]) => {
              const b = el("button", { type: "button", class: `hcm-btn${mode() === v ? " on" : ""}`, "aria-pressed": String(mode() === v), title: v === "rank" ? "Plot the rolling rank" : "Plot the rolling average" }, l);
              b.addEventListener("click", () => {
                if (mode() === v) return;
                st.heroChartMode = v;
                for (const x of seg.children) { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }
                titleEl.textContent = title();
                const fresh = makeChart(); chartEl.replaceWith(fresh); chartEl = fresh;
              });
              return b;
            }));
            for (const ev of ["click", "keydown", "pointerdown"]) seg.addEventListener(ev, (e) => e.stopPropagation());
            let chartEl = makeChart();
            const box = el("div", { class: "hero-chart hero-chart-tap", role: "button", tabindex: "0", title: `Show every ${unit === "event" ? "event" : "tournament"}`, "aria-label": `${trendName} history chart. Show every tournament in a table.` }, [
              el("span", { class: "hero-chart-label" }, [titleEl, showRanks ? el("span", { class: "hero-chart-ctrls" }, [seg]) : null]),
              chartEl]);
            const openT = () => eventsPopup(ordered, slicedField, r);
            box.addEventListener("click", openT);
            box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openT(); } });
            return box;
          })(),
        ]),
        tourButtons(), // (one row across the card, under Generate AI Insights)
        tiles.length ? el("div", { class: `hero-tiles n${tiles.length}` }, tiles) : null,
        foot,
      ]);
    }
    // no player: the leaderboard
    const minR = minRoundsFor(slicedField.filter((p) => p.rounds.length));
    const ranked = rankedField(slicedField).map((p) => ({ p, v: metric(p.rounds), n: p.rounds.length })).filter((x) => x.v != null).sort(byBest);
    const minBox = minRoundsBox(slicedField.filter((p) => p.rounds.length));
    const shown = ranked.map((x, i) => ({ ...x, i })); // everyone; the list scrolls
    const max = Math.max(...shown.map((x) => Math.abs(x.v)), 0.01);
    const posMax = Math.max(...shown.filter((x) => x.v >= 0).map((x) => x.v), 0.01), negMax = Math.max(...shown.filter((x) => x.v < 0).map((x) => -x.v), 0.01);
    // another stat: one blue bar, its length from the lowest value to the highest (so the differences show)
    const lo = Math.min(...shown.map((x) => x.v)), hi = Math.max(...shown.map((x) => x.v));
    const blueBar = (v) => { const fr = hi - lo > 1e-9 ? 0.12 + (0.88 * (v - lo)) / (hi - lo) : 1; return `width:${fr * 100}%;background:linear-gradient(90deg, #0a2f66, #4db2ff);background-size:${100 / fr}% 100%;background-repeat:no-repeat`; };
    return el("section", { class: "panel hero" }, [
      el("div", { class: "hb-head" }, [el("div", {}, [el("span", { class: "hero-kicker" }, describe()), el("h2", { class: "hero-name" }, "Leaderboard"),
        el("p", { class: "hero-help" }, [el("strong", {}, def.label), `: ${def.help}`])]), minBox]),
      tourButtons(),
      ranked.length ? null : el("p", { class: "muted small" }, `No one has ${sgEligible ? `${minR} strokes-gained ${minR === 1 ? "round" : "rounds"}` : rw(minR)} in this selection.`),
      el("div", { class: `hero-board${sg ? "" : " stat-board"}`, tabindex: "0", "aria-label": `Leaderboard: ${ranked.length} players (scroll for more)` }, shown.map((x) => el("div", { class: "hb-row" }, [
        el("span", { class: "hb-rank" }, showRanks ? String(x.i + 1) : ""),
        pickable(x.p.key) ? (() => { const b = el("button", { type: "button", class: "hb-name hb-link", title: `Open ${x.p.label}` }, starred(x.p.key, x.p.label)); b.addEventListener("click", () => opts.onPick(x.p.key)); return b; })() : el("span", { class: "hb-name", title: x.p.label }, starred(x.p.key, x.p.label)),
        // a value that shows as +0.00 is yellow (neither gained nor lost, to two places)
        el("span", { class: "hb-bar" }, el("span", { class: sg ? signCls(x.v) : "", style: !sg ? blueBar(x.v) : isZero(x.v) ? "width:4%;background:#ffd60a" : htmlBarStyle(x.v, Math.abs(x.v) / max, Math.abs(x.v) / (x.v >= 0 ? posMax : negMax)) })),
        el("strong", { class: sg ? signCls(x.v) : "" }, fmtV(x.v)),
      ]))),
      (() => { const t = [opts.onPick ? opts.pickNote || "Tap a name for that player's view." : "",
        !sg && def.higher === false ? " Lower is better, so the lowest is first." : !sg && def.higher == null ? " Highest first." : ""].join("").trim();
        return t ? el("p", { class: "muted small" }, t) : null; })(),
      // the average of everyone on the leaderboard
      shown.length ? (() => { const avg = shown.reduce((t, x) => t + x.v, 0) / shown.length;
        return el("p", { class: "hb-avg" }, ["Tour Avg = ", el("strong", { class: sg ? signCls(avg) : "" }, fmtV(avg))]); })() : null,
      foot,
    ]);
  }
  /* ---------------- the hero card's pills and pop-ups (update 159) ---------------- */
  const chipBtn = (cls, text, title, onClick) => {
    const b = el("button", { type: "button", class: `${cls} chip-btn`, title, "aria-haspopup": "dialog" }, text);
    b.addEventListener("click", onClick);
    return b;
  };
  // a pop-up over the page: eyebrow, title, a line under it, then the content. Returns its close function.
  function popup(eyebrow, title, sub, content, label = title) {
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": label }, el("div", { class: "gx-pop hero-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, eyebrow), el("h2", {}, title), sub ? el("p", { class: "gx-sub" }, sub) : null]), close]),
      ...[].concat(content)]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll");
    document.body.appendChild(overlay);
    close.focus();
    return shut;
  }
  const yearOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const dateTxt = (d) => { const b = new Date(d); return isNaN(b) ? d || "" : b.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" }); };
  const better = (a, b) => (higherBetter() ? a > b : a < b);
  // a change or a spread in the stat's own units (a percentage's in points)
  const fmtDelta = (v) => (isSG() ? Math.abs(v).toFixed(2) : fmtStat({ ...def, unit: def.pct ? "" : def.unit, pct: false, dp: def.pct ? 1 : def.dp }, Math.abs(v)) + (def.pct ? " pct" : ""));
  const sdOf = (a) => { if (a.length < 2) return null; const m = a.reduce((t, x) => t + x, 0) / a.length; return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)); };
  const roundVals = (rs) => rs.map((rd) => metric([rd])).filter((v) => v != null && Number.isFinite(v));
  // Steadiness: how much the rounds swing (standard deviation), the last n against the n before
  function steadinessLine(ordered, n) {
    const a = sdOf(roundVals(ordered.slice(-n))), b = sdOf(roundVals(ordered.slice(-2 * n, -n)));
    if (a == null || b == null) return null;
    const ch = a - b, same = Math.abs(ch) < (isSG() ? 0.05 : Math.max(1e-9, b * 0.05));
    const head = same ? "Steadiness is about the same" : ch < 0 ? "Steadiness is improving" : "Steadiness is declining";
    return `${head}: \u00b1${fmtDelta(a)} a ${unit} (standard deviation) over the last ${rw(n)}, against \u00b1${fmtDelta(b)} in the ${n} before${same ? "" : ` (${ch < 0 ? "steadier" : "streakier"} by ${fmtDelta(ch)})`}.`;
  }
  const roundsTable = (rs, { rank = null } = {}) => el("table", { class: "plain rankings hero-tourn" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), unit === "event" ? null : el("th", { class: "num" }, "Rd"), el("th", { class: "num" }, isSG() ? "SG" : def.label), rank ? el("th", { class: "num" }, "Rank") : null])),
    el("tbody", {}, rs.map((rd) => { const v = metric([rd]); return el("tr", {}, [el("td", { class: "ht-date" }, dateTxt(rd.date)), el("td", { class: "ht-name" }, rd.event || "\u2014"),
      unit === "event" ? null : el("td", { class: "num" }, rd.roundNo || "\u2014"), el("td", { class: `num ${isSG() ? signCls(v) : ""}` }, fmtV(v)), rank ? rank(rd) : null]); })),
  ]);
  // Form: the last n rounds and their average, then the n before and theirs
  // (update 181) Form, like the Watchlist's Big move: each round as a bar (the last n coloured) with the two
  // averages, then where the change came from, category by category
  async function formPopup(ordered) {
    const { renderBlocks } = await import("./badgePopup.js");
    const n = Math.min(10, Math.floor(ordered.length / 2));
    const last = ordered.slice(-n), prev = ordered.slice(-2 * n, -n), sg = isSG();
    const goodTone = (v, ref) => (sg ? null : def.higher == null || v == null || ref == null ? "gold" : better(v, ref) ? "pos" : "neg");
    const prevAvg = metric(prev), lastAvg = metric(last);
    const items = [...prev, ...last].map((rd, i) => { const v = metric([rd]); return { label: dateTxt(rd.date), sub: [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" \u00b7 "), v, on: i >= prev.length, tone: sg ? null : goodTone(v, prevAvg) }; });
    const cell = (v) => (sg ? { sg: v } : { text: fmtV(v) });
    const change = (a, b) => { if (a == null || b == null) return sg ? { sg: null } : { text: "\u2014" };
      if (sg) return { sg: a - b, arrow: true };
      const d = a - b, same = Math.abs(d) < 1e-9;
      return { text: `${same ? "" : d > 0 ? "\u25B2 " : "\u25BC "}${fmtDelta(d)}`, tone: same || def.higher == null ? "" : better(a, b) ? "pos" : "neg" }; };
    const rows = [[null, sg ? "SG: Total" : catsAvail.length > 1 ? "All" : def.label], ...(catsAvail.length > 1 ? catsAvail : [])].map(([k, l]) => {
      const a = metric(last, k), b = metric(prev, k);
      return { strong: !k, cells: [l, cell(b), cell(a), change(a, b)] };
    });
    const blocks = [
      { kind: "bars", fmtFn: fmtV, zero: sg, items, ref: [{ v: prevAvg, label: `Previous ${n}`, from: 0, to: prev.length }, { v: lastAvg, label: `Last ${n}`, from: prev.length, to: prev.length + last.length }] },
      { kind: "table", title: catsAvail.length > 1 ? `By category (a ${unit})` : "The averages", cols: [["Category"], [`Previous ${n}`, "num"], [`Last ${n}`, "num"], ["Change", "num"]], rows },
    ];
    return popup("Form", me.label, `${sg ? "Strokes gained" : def.label} in each ${unit}: the last ${n} (highlighted) against the ${n} before, and where the change came from.`,
      el("div", { class: "wl-pop-body" }, renderBlocks(blocks)), "Form");
  }
  // Each tournament in the selection: who played the most rounds there, best first (the "winner" leads)
  function eventsOf(players) {
    const ev = new Map();
    for (const p of players) for (const rd of p.rounds) {
      if (!rd.event) continue;
      const k = `${rd.event}|${yearOf(rd)}`;
      const e = ev.get(k) || ev.set(k, { event: rd.event, end: rd.date, by: new Map() }).get(k);
      if (String(rd.date) > String(e.end)) e.end = rd.date;
      (e.by.get(p) || e.by.set(p, []).get(p)).push(rd);
    }
    return [...ev.values()].map((e) => {
      const most = Math.max(...[...e.by.values()].map((rs) => rs.length));
      const ranked = [...e.by].filter(([, rs]) => rs.length >= most).map(([p, rs]) => ({ p, v: metric(rs), rs })).filter((x) => x.v != null).sort(byBest);
      return { ...e, players: e.by.size, ranked, best: ranked[0] || null, top10: ranked.slice(0, 10) };
    }).sort((a, b) => String(a.end).localeCompare(String(b.end)));
  }
  // the player's finish at each tournament (among those who played every round), newest first
  function myFinishes(slicedField) {
    return eventsOf(rankedField(slicedField)).map((e) => { const i = e.ranked.findIndex((x) => x.p.key === me.key); return i < 0 ? null : { e, rank: i + 1, of: e.ranked.length, v: e.ranked[i].v }; })
      .filter(Boolean).reverse();
  }
  async function finishesPopup(list, what, all = []) {
    // (update 181) every tournament they finished as a bar, the wins (or top 10s) highlighted, then the list
    const { renderBlocks } = await import("./badgePopup.js");
    const hit = (x) => (what === "Wins" ? x.rank === 1 : x.rank <= 10);
    const chart = all.length ? renderBlocks([{ kind: "bars", fmtFn: fmtV, zero: isSG(), items: [...all].reverse().map((x) => ({ label: dateTxt(x.e.end), sub: `${x.e.event} \u00b7 ${ordinal(x.rank)} of ${x.of}`, v: x.v, on: hit(x), tone: isSG() ? null : "gold" })) }]) : [];
    const table = list.length ? el("div", { class: "table-scroll hero-tourn-scroll" }, el("table", { class: "plain rankings hero-tourn" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), el("th", { class: "num" }, isSG() ? "SG / Round" : def.label), el("th", { class: "num" }, "Finish")])),
      el("tbody", {}, list.map((x) => el("tr", {}, [el("td", { class: "ht-date" }, dateTxt(x.e.end)), el("td", { class: "ht-name" }, x.e.event),
        el("td", { class: `num ${isSG() ? signCls(x.v) : ""}` }, fmtV(x.v)), el("td", { class: `num ht-win ${x.rank === 1 ? "ht-won" : ""}` }, [String(x.rank), el("span", { class: "ht-of" }, ` of ${x.of}`)])]))),
    ])) : el("p", { class: "empty center" }, `No ${what.toLowerCase()} in this selection.`);
    popup(what, me.label, `${list.length} ${list.length === 1 ? "tournament" : "tournaments"} \u00b7 ${isSG() ? "strokes gained a round" : def.label}, newest first`, [...chart, table,
      el("p", { class: "muted small" }, `${what === "Wins" ? "Best in the field" : "Top 10 in the field"} in ${isSG() ? "strokes gained a round" : def.label}, among the players who played every round there.`)], what);
  }
  // the Rankings table, in a pop-up (Min. rounds there redraws the page and opens it again)
  let rankShut = null; // (only one rankings pop-up at a time)
  function rankPopup() {
    rankShut?.();
    let shut = null, redone = false;
    // (the box can report its change twice, e.g. again as the old pop-up closes: redraw once)
    const block = rankingsBlock(lastSliced, () => { if (redone) return; redone = true; shut?.(); draw(); rankPopup(); });
    block.classList.add("rank-pop");
    const close = popup("Rankings", isSG() ? "Strokes Gained" : def.label, describe(), block, "Rankings");
    shut = rankShut = () => { close(); if (rankShut === shut) rankShut = null; };
    centerRankings();
  }
  // The hero chart's table (update 158) and the rounds pill's (update 159): every round, newest at the top, the
  // player's number in it and where it ranked among everyone in the field who played that round.
  function tournamentsPopup(ordered, slicedField = [], eyebrow = null) {
    const sameRound = (x, rd) => x.event === rd.event && yearOf(x) === yearOf(rd) && (rd.roundNo ? x.roundNo === rd.roundNo : x.date === rd.date);
    const rankCell = (rd) => {
      const mineV = metric([rd]);
      const vals = [];
      if (mineV != null) for (const p of slicedField || []) {
        if (p.key === me.key) continue;
        const x = (p.rounds || []).find((y) => sameRound(y, rd));
        const v = x ? metric([x]) : null;
        if (v != null) vals.push(v);
      }
      if (!vals.length) return el("td", { class: "num ht-win" }, "\u2014");
      const r = 1 + vals.filter((v) => better(v, mineV) && Math.abs(v - mineV) > 1e-9).length;
      return el("td", { class: `num ht-win ${r === 1 ? "ht-won" : ""}` }, [String(r), el("span", { class: "ht-of" }, ` of ${vals.length + 1}`)]);
    };
    const events = new Set(ordered.map((rd) => `${rd.event}|${yearOf(rd)}`)).size;
    popup(eyebrow || `${isSG() ? "SG" : def.label} trend`, me.label, `${rw(ordered.length)} \u00b7 ${events} ${events === 1 ? "tournament" : "tournaments"} \u00b7 newest first`, [
      el("div", { class: "table-scroll hero-tourn-scroll" }, roundsTable([...ordered].reverse(), { rank: rankCell })),
      el("p", { class: "muted small" }, `Rank: where that ${unit} placed among everyone in the field who played it.`),
    ], unit === "event" ? "Tournaments" : "Rounds");
  }
  // (update 174) The hero chart's table: one row per tournament, newest first: their average there and where it
  // placed, and their rolling average and rank (everything up to the end of that tournament, this selection)
  // (update 175) two views of it: "rolling" (the chart's table: Rolling Avg and Rank) and "event" (the Events pill:
  // Event Avg and Rank)
  function eventsPopup(ordered, slicedField, now, view = "rolling") {
    const rolling = view === "rolling";
    const hist = rolling ? (showRanks ? rankHistory(ordered, slicedField, now, { all: true }) : rollingOnly(ordered)) : [];
    const at = new Map(hist.map((x) => [String(x.date || ""), x]));
    const fin = new Map();
    if (!rolling && showRanks) for (const e of eventsOf(rankedField(slicedField))) {
      const mineE = [...e.by].find(([p]) => p.key === me.key);
      if (!mineE) continue;
      const i = e.ranked.findIndex((x) => x.p.key === me.key);
      fin.set(`${e.event}|${yearOf(mineE[1][0])}`, i < 0 ? null : { rank: i + 1, of: e.ranked.length });
    }
    const groups = new Map();
    for (const rd of ordered) { const k = `${rd.event}|${yearOf(rd)}`; (groups.get(k) || groups.set(k, { event: rd.event, rs: [] }).get(k)).rs.push(rd); }
    const rows = [...groups].map(([k, g]) => { const end = g.rs.reduce((m, rd) => (String(rd.date) > String(m) ? rd.date : m), g.rs[0].date); return { k, ...g, end, v: metric(g.rs), fin: fin.get(k), roll: at.get(String(end || "")) }; })
      .sort((a, b) => String(b.end).localeCompare(String(a.end)));
    const rankTd = (x, won = false) => (x ? el("td", { class: `num ht-win ${won && x.rank === 1 ? "ht-won" : ""}` }, [String(x.rank), el("span", { class: "ht-of" }, ` of ${x.of}`)]) : el("td", { class: "num ht-win" }, "\u2014"));
    const valTd = (v) => el("td", { class: `num ${isSG() ? signCls(v) : ""}` }, fmtV(v));
    const table = el("table", { class: "plain rankings hero-tourn hero-events" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), unit === "event" ? null : el("th", { class: "num" }, "Rds"),
        ...(rolling ? [el("th", { class: "num" }, "Rolling Avg"), showRanks ? el("th", { class: "num" }, "Rolling Rank") : null] : [el("th", { class: "num" }, "Event Avg"), showRanks ? el("th", { class: "num" }, "Event Rank") : null])])),
      el("tbody", {}, rows.map((x) => el("tr", {}, [el("td", { class: "ht-date" }, dateTxt(x.end)), el("td", { class: "ht-name" }, x.event || "\u2014"),
        unit === "event" ? null : el("td", { class: "num" }, String(x.rs.length)),
        ...(rolling ? [valTd(x.roll?.avg ?? null), showRanks ? rankTd(x.roll) : null] : [valTd(x.v), showRanks ? rankTd(x.fin, true) : null])]))),
    ]);
    popup(rolling ? `${isSG() ? "SG" : def.label} history` : "Events", me.label, `${rows.length} ${rows.length === 1 ? "tournament" : "tournaments"} \u00b7 ${rw(ordered.length)} \u00b7 newest first`, [
      el("div", { class: "table-scroll hero-tourn-scroll" }, table),
      el("p", { class: "muted small" }, !showRanks ? (rolling ? "Rolling Avg: everything up to the end of that tournament in this selection." : `Event Avg: ${isSG() ? "strokes gained a round" : def.label} at that tournament.`) : rolling
        ? "Rolling Avg and Rolling Rank: everything up to the end of that tournament in this selection, ranked as on the chart (the same Min. rounds)."
        : `Event Avg: ${isSG() ? "strokes gained a round" : def.label} at that tournament. Event Rank: where that placed among the players who played every round there (\u2014 when they didn\u2019t).`),
    ], "Tournaments");
    table.closest(".gx-pop")?.classList.add("hero-events-pop"); // (wider: seven columns)
  }
  // ✨ Generate AI Insights: the Reports page's report builder, in a pop-up, for the player on screen
  function insightsButton(slicedField = []) {
    if (!me || !me.key) return null;
    const btn = el("button", { type: "button", class: "hero-insights" }, "\u2728 Generate AI Report");
    btn.addEventListener("click", async () => {
      const { reportBuilder } = await import("./reportGen.js");
      const state = getState();
      const flashMsg = (msg) => { const n = el("p", { class: "hero-pop-msg", role: "status" }, msg); body.prepend(n); setTimeout(() => n.remove(), 4000); };
      const builder = reportBuilder({ playerKey: me.key, playerLabel: me.label, canSave: false, flash: flashMsg, // (update 164: no Save to Reports here)
        source: opts.entered ? "entered" : "tour", minRounds: minRoundsFor(slicedField.filter((p) => p.rounds.length)), tour: tourCounts.length ? (st.tour[0] ?? null) : null,
        fullField: fieldIsSummary() ? null : fieldAll }); // (the admin: everyone's rows, for ranks by distance)
      const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
      const body = el("div", { class: "hero-pop-body" }, builder.node || builder);
      const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Generate AI Report" }, el("div", { class: "gx-pop hero-pop" }, [
        el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Performance report"), el("h2", {}, me.label)]), close]), body]));
      const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
      const onKey = (e) => { if (e.key === "Escape") shut(); };
      close.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
      document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll");
      document.body.appendChild(overlay);
      overlay.querySelector(".report-gen-open")?.click(); // straight to the options
    });
    return btn;
  }
  // (update 168) Rank history: after each of the player's rounds, their rank among the same players with what each
  // had played by that date (Min. rounds scaled to the most played by then). The last point is the rank shown.
  // (update 183) no ranks (entered rounds): their rolling average at the end of each tournament
  function rollingOnly(ordered) {
    const dk = (d) => String(d || ""), ends = new Map();
    for (const rd of ordered) { const k = `${rd.event}|${yearOf(rd)}`; if (dk(rd.date) > (ends.get(k) || "")) ends.set(k, dk(rd.date)); }
    return [...new Set(ends.values())].sort().map((d) => ({ date: d, avg: metric(ordered.filter((rd) => dk(rd.date) <= d)) })).filter((x) => x.avg != null);
  }
  function rankHistory(ordered, slicedField, now, { all = false } = {}) {
    const dk = (d) => String(d || "");
    const ranked = rankedField(slicedField);
    if (!ranked.some((p) => p.key !== me.key)) return [];
    const sorted = ranked.map((p) => ({ key: p.key, rs: [...p.rounds].sort((a, b) => dk(a.date).localeCompare(dk(b.date))) }));
    const mostNow = Math.max(1, ...sorted.map((p) => p.rs.length));
    const minNow = Math.max(1, minRoundsFor(slicedField.filter((p) => p.rounds.length)));
    // the dates to plot: the end of each tournament (update 177: weekly, not each round; at most 60, spread
    // evenly, always the latest)
    const ends = new Map();
    for (const rd of ordered) { const k = `${rd.event}|${yearOf(rd)}`; if (dk(rd.date) > (ends.get(k) || "")) ends.set(k, dk(rd.date)); }
    let dates = [...new Set(ends.values())].sort();
    if (!all && dates.length > 60) { const step = (dates.length - 1) / 59; dates = Array.from({ length: 60 }, (_, i) => dates[Math.round(i * step)]); }
    const upTo = (rs, d) => { let lo = 0, hi = rs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dk(rs[m].date) <= d) lo = m + 1; else hi = m; } return lo; };
    // strokes gained: running totals, so each date is quick
    const sgFast = isSG();
    const cum = sgFast ? sorted.map((p) => { let t = 0; return p.rs.map((rd) => { for (const x of rd.shots) t += x.sg; return t; }); }) : null;
    const out = [];
    for (const d of dates) {
      const counts = sorted.map((p) => upTo(p.rs, d));
      const most = Math.max(1, ...counts);
      const need = Math.max(1, Math.round((minNow * most) / mostNow));
      const vals = [];
      sorted.forEach((p, i) => {
        const n = counts[i];
        if (!n || (n < need && p.key !== me.key)) return;
        const v = sgFast ? cum[i][n - 1] / n : metric(p.rs.slice(0, n));
        if (v != null) vals.push({ key: p.key, v });
      });
      vals.sort(byBest);
      const i = vals.findIndex((x) => x.key === me.key);
      if (i >= 0) out.push({ date: d, rank: i + 1, of: vals.length, avg: vals[i].v }); // (avg: their rolling average, update 174)
    }
    if (out.length && now?.rank) Object.assign(out[out.length - 1], { rank: now.rank, of: now.of }); // (the same as the pill)
    return out;
  }
  // the rank line: 1st at the top, a gold line, the latest point marked
  function rankChart(canvas, labels, hist) {
    const ctx = canvas.getContext("2d"), h = canvas.parentNode?.clientHeight || 180;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(212,180,131,0.35)"); grad.addColorStop(1, "rgba(212,180,131,0)");
    const ranks = hist.map((x) => x.rank), worst = Math.max(...ranks);
    return new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ data: ranks, borderColor: "#d4b483", backgroundColor: grad, fill: "end", borderWidth: 2.4, stepped: false, tension: 0.25,
        pointRadius: ranks.map((_, i) => (i === ranks.length - 1 ? 3.5 : 0)), pointBackgroundColor: "#f3dfbd", pointHoverRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${ordinal(c.parsed.y)} of ${hist[c.dataIndex].of}` } } },
        scales: {
          x: { display: true, grid: { display: false }, border: { display: false }, ticks: { color: "#6e6e73", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, padding: 2 } },
          y: { reverse: true, min: 1, suggestedMax: Math.max(5, worst + 1), grid: { color: "rgba(255,255,255,0.06)" }, border: { display: false },
            ticks: { color: "#8e8e93", maxTicksLimit: 5, precision: 0, callback: (v) => (Number.isInteger(v) ? ordinal(v) : "") } } } },
    });
  }
  function heroChart(canvas, labels, vals) {
    const ctx = canvas.getContext("2d"), h = canvas.parentNode?.clientHeight || 180;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(212,180,131,0.45)"); grad.addColorStop(1, "rgba(212,180,131,0)");
    return new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ data: vals, borderColor: "#d4b483", backgroundColor: grad, fill: isSG() ? "origin" : "start", borderWidth: 2.4, tension: 0.25,
        pointRadius: vals.map((_, i) => (i === vals.length - 1 ? 3.5 : 0)), pointBackgroundColor: "#f3dfbd", pointHoverRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmtV(c.parsed.y)} (rolling average)` } } },
        scales: {
          // a minimal x-axis: a few dates, small and grey, no grid
          x: { display: true, grid: { display: false }, border: { display: false }, ticks: { color: "#6e6e73", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, padding: 2 } },
          y: { grid: { color: (c) => (c.tick.value === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.06)") }, ticks: { color: "#8e8e93", maxTicksLimit: 4, callback: (v) => (isSG() ? fmtSG(v) : fmtStat({ ...def, dp: Math.min(def.dp ?? 1, 1) }, v)) }, border: { display: false } } } },
    });
  }

  /* ---------------- the pill row in the Filters panel ---------------- */
  // (drawn under the Tour Events / Entered Rounds pills when the page gives a place for them)
  // (the page's old Basic / Advanced spot is left empty)
  const placeView = () => { if (opts.viewHost && !container.closest("[hidden]")) mount(opts.viewHost, null); return null; };
  // One row of pills: the page's Tour Events / Entered Rounds (lent to us; a hidden dashboard leaves them),
  // the years, the Tour and the categories this stat has (a Category dropdown on phones).
  const yearsRow = (opt, { cats = false } = {}) => {
    const lead = opts.lead && !container.closest("[hidden]") ? opts.lead : null;
    cats = cats && catsAvail.length > 1;
    const catDrop = cats ? el("div", { class: "cat-drop" }, multi("Category", "cats", catsAvail.map(([v, l]) => ({ value: v, label: l })), "All categories", { plural: "categories" })) : null;
    // two rows: data source, years and tour on top; the categories and Stat Type under them
    const top = el("div", { class: "pill-row years-row stats-pills" }, [lead, yearPills(opt), tourPills()]);
    const stat = statSelect();
    const bottom = cats || stat ? el("div", { class: "pill-row stats-pills stats-row2" }, [stat, cats ? catPills() : null, catDrop]) : null; // (update 229: Relative / Raw moved to the stats table)
    return el("div", { class: "stats-rows" }, [top, bottom]);
  };
  const tourName = (t) => t || "No tour";
  // Tour: one at a time (never mixed). Pills here and the tour buttons on the hero card.
  function tourPills() {
    if (!tourCounts.length) return null;
    return el("nav", { class: "subnav sg-tours", role: "radiogroup", "aria-label": "Tour" }, tourCounts.map(([t]) => {
      const on = st.tour[0] === t;
      const a = el("a", { href: "#", role: "radio", "aria-checked": on ? "true" : "false", "aria-current": on ? "page" : null }, tourName(t));
      a.addEventListener("click", (e) => { e.preventDefault(); if (!on) { st.tour = [t]; draw(); } });
      return a;
    }));
  }
  // Stat Type: every stat found in the data on screen. The tables and charts below follow what that stat has.
  function statSelect() {
    if (statList.length < 2) return null;
    const sel = el("select", { class: "stat-select", "aria-label": "Stat type" }, statList.map((k) => el("option", { value: k, selected: k === statKey }, statDef(k).label)));
    sel.addEventListener("change", () => { st.statWanted = sel.value; st.openFilter = null; draw(); });
    return el("label", { class: "stat-pick" }, [sel]); // (no "Stat Type" heading, update 166)
  }
  function tourButtons() {
    if (!tourCounts.length || (tourCounts.length === 1 && tourCounts[0][0] === "")) return null;
    return el("div", { class: "tour-chips", role: "radiogroup", "aria-label": "Tour" }, tourCounts.map(([t, n]) => {
      const on = st.tour[0] === t;
      const b = el("button", { type: "button", role: "radio", "aria-checked": on ? "true" : "false", class: `tour-chip${on ? " on" : ""}` },
        tourName(t));
      b.addEventListener("click", () => { if (!on) { st.tour = [t]; draw(); } });
      return b;
    }));
  }
  // rounds grouped by round / event / month / year (in date order), for a stat's trend
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
    return el("nav", { class: "subnav sg-tabs", "aria-label": "Categories: tap to pick one, double-tap to keep it and add more" }, [all, ...catsAvail.map(([k, label]) => {
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
  const catsName = () => (catsAvail.length === 1 ? catsAvail[0][1] : catsAvail.length < 2 && !st.cats.length ? "" : !st.cats.length || st.cats.length === catsAvail.length ? "All categories"
    : st.cats.length === 3 && T2G.every((k) => st.cats.includes(k)) ? "Tee to Green"
    : st.cats.map(catName).join(" + "));
  const list = (a, plural, fmt = (v) => v) => (!a.length ? "" : a.length <= 2 ? a.map(fmt).join(", ") : `${a.length} ${plural}`);
  const describe = () => [
    catsName(),
    list(st.year, "years"), list(st.event, "tournaments"), list(st.course, "courses"),
    st.roundNo.length ? (st.roundNo.length <= 2 ? `Round ${st.roundNo.join(" & ")}` : `${st.roundNo.length} rounds`) : "",
    list(st.lie, "lies"), list(st.dist, "distances", (d) => d.split("|").slice(1).join("|")), list(st.club, "clubs"), list(st.gear, "products", (v) => gearLabel(v)),
    Number(st.span) > 0 ? (Number(st.span) === 1 ? "last month" : `last ${st.span} months`) : "",
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
    const entries = rankedField(slicedField).map((p) => ({ key: p.key, value: metric(p.rounds) ?? -Infinity }));
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
    const playing = rankedField(fieldAll); // (Min. rounds, like the rankings)
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

  /* ------------------------------ the summary (top of the stats) ------------------------------ */
  // A few plain sentences about exactly what's on screen (the same rounds, filters and players as the
  // rankings and charts), so it changes with every filter. Calculated from the numbers.
  const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
  const isZero = (v) => v != null && Math.round(v * 100) === 0; // shows as +0.00
  const signCls = (v) => (isZero(v) ? "zero" : v >= 0 ? "pos" : "neg");
  const perRoundOf = (rounds, cat = null) => {
    if (!rounds.length) return null;
    let t = 0; for (const rd of rounds) for (const x of rd.shots) if (!cat || x.cat === cat) t += x.sg;
    return t / rounds.length;
  };
  // The number a player is ranked on: strokes gained a round, or the stat's attempt-weighted average.
  const narrowedNow = () => !!(st.cats.length || st.lie.length || st.dist.length);
  const metric = (rounds, cat = null) => {
    if (isSG()) return perRoundOf(rounds, cat);
    if (!rounds || !rounds.length) return null;
    const rs = cat ? rounds.map((rd) => ({ ...rd, shots: rd.shots.filter((o) => o.cat === cat) })) : rounds;
    return statAgg(rs, !!cat || narrowedNow()).value;
  };
  // "Steady" form: within 0.05 strokes gained, half a point for a percentage, or 0.5% of the value otherwise
  // (0.35 strokes on a 70 scoring average, 1.5 yds on a 290-yard drive)
  const steadyBand = (prev) => (isSG() ? 0.05 : def.pct ? 0.5 : Math.max(0.01, Math.abs(prev) * 0.005));
  const higherBetter = () => def.higher !== false; // (neither better nor worse: ranked highest first)
  const byBest = (a, b) => (higherBetter() ? b.v - a.v : a.v - b.v);
  const fmtV = (v) => fmtStat(def, v);
  /* (update 226) "Relative to Tour Avg": each value less the average of everyone else in the same filtered data
     (gaining 0.05 when the rest average 0.06 is −0.01 against the field). */
  const relOn = () => !!st.rel && !opts.practice;
  const othersAvg = (list, key, cat = null) => { const vs = rankedField(list).filter((p) => p.key !== key).map((p) => metric(p.rounds, cat)).filter((x) => x != null && Number.isFinite(x)); return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null; };
  const fmtRel = (d) => (d == null ? "\u2014" : isSG() ? `${d >= 0 ? "+" : "\u2212"}${Math.abs(d).toFixed(2)}` : `${d >= 0 ? "+" : "\u2212"}${fmtStat({ ...def, pct: false, unit: def.pct ? " pct" : def.unit }, Math.abs(d))}`);
  const relCls = (d) => (d == null || Math.abs(d) < 1e-9 ? "" : isSG() || def.higher == null ? (def.higher == null && !isSG() ? "" : d > 0 ? "pos" : "neg") : (def.higher ? d > 0 : d < 0) ? "pos" : "neg");
  // a value shown raw, or (relative on) against the rest of the field
  const showV = (v, ref) => (relOn() && v != null && ref != null ? fmtRel(v - ref) : fmtV(v));
  const showCls = (v, ref, rawRef = ref) => (relOn() && v != null && ref != null ? relCls(v - ref) : toneCls(v, rawRef));
  function relSeg() {
    if (opts.practice) return null;
    const b = (on, l, v) => { const x = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, l); x.addEventListener("click", () => { st.rel = v; try { localStorage.setItem("ta:rel", v ? "1" : "0"); } catch {} draw(); }); return x; };
    return el("div", { class: "seg small rel-pick", role: "group", "aria-label": "Values" }, [b(!!st.rel, "Relative to Avg", true), b(!st.rel, "Raw value", false)]); // (update 228)
  }
  // green / red for strokes gained; another stat is coloured against the field average when better / worse is known
  const toneCls = (v, ref) => (isSG() ? signCls(v) : v == null || ref == null || def.higher == null || Math.abs(v - ref) < 1e-9 ? "" : (def.higher ? v > ref : v < ref) ? "pos" : "neg");
  const sgWord = (v) => `${v >= 0 ? "gains" : "loses"} ${Math.abs(v).toFixed(2)} strokes a round`;
  // Who is ranked: players with at least Min. rounds in the selection (the player on screen always counts),
  // so the hero card, its tiles, the summary and the Rankings table all give the same rank.
  const rankedField = (slicedField) => {
    if (sgEligible) return slicedField.filter((p) => p.rounds.length && (sgEligible.has(p.key) || p.key === me?.key));
    const minR = minRoundsFor(slicedField.filter((p) => p.rounds.length));
    return slicedField.filter((p) => p.rounds.length && (p.rounds.length >= minR || p.key === me?.key));
  };
  function rankAmong(slicedField, key, cat = null) {
    const vals = rankedField(slicedField).map((p) => ({ key: p.key, v: metric(p.rounds, cat) })).filter((x) => x.v != null).sort(byBest);
    const i = vals.findIndex((x) => x.key === key);
    return { rank: i >= 0 ? i + 1 : null, of: vals.length, leader: vals[0] || null, vals };
  }
  function summaryBox(mine, slicedField) {
    const lines = [];
    const cats = CATEGORIES.filter(([k]) => !st.cats.length || st.cats.includes(k));
    const what = describe();
    if (me && mine && mine.length) {
      const name = me.label || "This player";
      const total = perRoundOf(mine), r = rankAmong(slicedField, me.key);
      lines.push(`${name} ${sgWord(total)} over ${mine.length} ${mine.length === 1 ? "round" : "rounds"} (${what})${r.rank && r.of > 1 ? `, ${ordinal(r.rank)} of ${r.of} players` : ""}.`);
      if (cats.length > 1) {
        const byCat = cats.map(([k, l]) => ({ l, v: perRoundOf(mine, k), rk: rankAmong(slicedField, me.key, k) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
        if (byCat.length > 1) {
          const best = byCat[0], worst = byCat[byCat.length - 1];
          lines.push(`Strongest: ${best.l} (${fmtSG(best.v)}${best.rk.rank && best.rk.of > 1 ? `, ${ordinal(best.rk.rank)}` : ""}). Weakest: ${worst.l} (${fmtSG(worst.v)}${worst.rk.rank && worst.rk.of > 1 ? `, ${ordinal(worst.rk.rank)}` : ""}).`);
        }
      } else if (cats.length === 1) {
        // one category: its best and worst distances
        const k = cats[0][0], m = new Map();
        for (const rd of mine) for (const x of rd.shots) if (x.cat === k && x.dist) m.set(x.dist, (m.get(x.dist) || 0) + x.sg);
        const ds = [...m].map(([d, t]) => ({ d, v: t / mine.length })).sort((a, b) => b.v - a.v);
        if (ds.length > 1) lines.push(`Best from ${ds[0].d} (${fmtSG(ds[0].v)} a round); lowest from ${ds[ds.length - 1].d} (${fmtSG(ds[ds.length - 1].v)}).`);
      }
      // form: the last 10 rounds against the 10 before them
      const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const n = Math.min(10, Math.floor(ordered.length / 2));
      if (n >= 2) {
        const last = perRoundOf(ordered.slice(-n)), prev = perRoundOf(ordered.slice(-2 * n, -n)), ch = last - prev;
        lines.push(Math.abs(ch) < 0.05 ? `Form is steady: ${fmtSG(last)} a round over the last ${n} rounds, about the same as the ${n} before.`
          : `Form is ${ch > 0 ? "improving" : "cooling down"}: ${fmtSG(last)} a round over the last ${n} rounds, against ${fmtSG(prev)} in the ${n} before (${ch > 0 ? "better" : "worse"} by ${Math.abs(ch).toFixed(2)}).`);
        const sl = steadinessLine(ordered, n); if (sl) lines.push(sl);
      }
    } else {
      // no player picked: the group
      const r = rankAmong(slicedField, null);
      if (!r.of) return null;
      const avg = r.vals.reduce((t, x) => t + x.v, 0) / r.of;
      const lead = slicedField.find((p) => p.key === r.leader?.key);
      const last = r.vals[r.vals.length - 1], lastP = slicedField.find((p) => p.key === last?.key);
      lines.push(`${r.of} players (${what}). Leader: ${lead?.label || "\u2014"} (${fmtSG(r.leader.v)} a round)${r.of > 1 && lastP ? `; last: ${lastP.label} (${fmtSG(last.v)})` : ""}. Group average: ${fmtSG(avg)}.`);
      if (cats.length > 1) {
        const nameOf = (key) => slicedField.find((p) => p.key === key)?.label || "\u2014";
        const spread = cats.map(([k, l]) => { const v = rankAmong(slicedField, null, k).vals; return v.length > 1 ? { l, hi: v[0], lo: v[v.length - 1] } : null; }).filter(Boolean).sort((a, b) => (b.hi.v - b.lo.v) - (a.hi.v - a.lo.v));
        if (spread.length) lines.push(`Biggest gap between players: ${spread[0].l}, from ${nameOf(spread[0].hi.key)} (${fmtSG(spread[0].hi.v)}) to ${nameOf(spread[0].lo.key)} (${fmtSG(spread[0].lo.v)}) a round. Pick a player for their own summary.`);
      }
    }
    if (!lines.length) return null;
    return el("section", { class: "panel sg-summary" }, [el("h3", {}, "Summary"), ...lines.map((t) => el("p", {}, t))]);
  }

  /* ------------------------------ the whole tour (no player picked; update 142) ------------------------------ */
  // Category leaders (strokes gained), hot and cold form, the steadiest players, each tournament's best in the
  // field, and wins. Any stat (update 159): its own form, round-to-round swing, and who led the field in it.
  function tourBlocks(slicedField) {
    const P = rankedField(slicedField).filter((p) => p.rounds.length);
    if (P.length < 3) return [];
    const sg = isSG();
    const nameBtn = (p) => (pickable(p.key) ? (() => { const b = el("button", { type: "button", class: "hb-link ti-name", title: `Open ${p.label}` }, starred(p.key, p.label)); b.addEventListener("click", () => opts.onPick(p.key)); return b; })() : el("span", { class: "ti-name" }, starred(p.key, p.label)));
    const sgCell = (v) => el("strong", { class: `ti-v ${signCls(v)}` }, fmtSG(v));
    const good = (ch) => (def.higher == null ? null : higherBetter() ? ch > 0 : ch < 0); // a change for the better?
    const blocks = [];
    const cats = CATEGORIES.filter(([k]) => catsAvail.some(([c]) => c === k));

    // 1. category leaders (strokes gained): everyone ranked, best first; the list scrolls
    if (sg && cats.length > 1) {
      blocks.push(panelBox("Category Leaders", el("div", { class: "ti-leaders" }, cats.map(([k, l]) => {
        const top = P.map((p) => ({ p, v: perRoundOf(p.rounds, k) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
        return el("div", { class: "ti-col" }, [el("p", { class: "ti-col-title" }, l), el("ol", { class: "ti-list ti-scroll", tabindex: "0", "aria-label": `${l} leaders` }, top.map((x) => el("li", {}, [nameBtn(x.p), sgCell(x.v)])))]);
      })), "full"));
    }

    // 2. hot and cold: the last 10 rounds against the 10 before them
    const series = (p) => [...p.rounds].filter((rd) => !sg || !rd.eventLevel).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    {
      const form = P.map((p) => {
        const rs = series(p).filter((rd) => metric([rd]) != null);
        if (rs.length < 20) return null;
        const last = metric(rs.slice(-10)), before = metric(rs.slice(-20, -10));
        return last == null || before == null ? null : { p, last, before, ch: last - before };
      }).filter(Boolean);
      if (form.length >= 4) {
        const up = (x) => (def.higher === false ? -x.ch : x.ch); // how much better (or just higher, when neither is better)
        const hot = form.filter((x) => up(x) > 0).sort((a, b) => up(b) - up(a)).slice(0, 5), cold = form.filter((x) => up(x) < 0).sort((a, b) => up(a) - up(b)).slice(0, 5);
        const cls = (ch) => { const g = good(ch); return g == null ? "" : g ? "pos" : "neg"; };
        const list = (xs) => (xs.length ? el("ol", { class: "ti-list" }, xs.map((x) => el("li", {}, [el("span", { class: "ti-who" }, [nameBtn(x.p), el("span", { class: "ti-sub muted" }, `${fmtV(x.last)} last 10, ${fmtV(x.before)} previous 10`)]), el("strong", { class: `ti-v ${cls(x.ch)}` }, `${x.ch >= 0 ? "\u25B2" : "\u25BC"} ${fmtDelta(x.ch)}`)]))) : el("p", { class: "muted small" }, "No one."));
        blocks.push(panelBox("Hot & Cold", [el("div", { class: "ti-two" }, [el("div", {}, [el("p", { class: "ti-col-title" }, def.higher == null ? "Going up" : "Heating up"), list(hot)]), el("div", {}, [el("p", { class: "ti-col-title" }, def.higher == null ? "Going down" : "Cooling off"), list(cold)])])]));
      }
    }

    // 3. the steadiest and the streakiest: how much a player's rounds swing (standard deviation)
    {
      const steady = P.map((p) => { const t = roundVals(series(p)); return t.length >= 8 ? { p, s: sdOf(t), avg: metric(series(p)) } : null; }).filter(Boolean);
      if (steady.length >= 4) {
        const most = [...steady].sort((a, b) => a.s - b.s).slice(0, 5), least = [...steady].sort((a, b) => b.s - a.s).slice(0, 5);
        // (update 163) the steadiest in green, the streakiest in red
        const list = (xs, tone) => el("ol", { class: "ti-list" }, xs.map((x) => el("li", {}, [el("span", { class: "ti-who" }, [nameBtn(x.p), el("span", { class: "ti-sub muted" }, sg ? `${fmtSG(x.avg)} a round` : `${fmtV(x.avg)} average`)]), el("strong", { class: `ti-v ${tone}` }, `\u00b1${fmtDelta(x.s)}`)])));
        blocks.push(panelBox("Steadiest & Streakiest", [el("div", { class: "ti-two" }, [el("div", {}, [el("p", { class: "ti-col-title" }, "Steadiest"), list(most, "pos")]), el("div", {}, [el("p", { class: "ti-col-title" }, "Streakiest"), list(least, "neg")])])]));
      }
    }

    // 4. tournaments: when, how many played, and the best in the field (among those who played every round)
    {
      const all = eventsOf(P);
      const wins = new Map(), tops = new Map();
      for (const e of all) { // (oldest first, so a second win shows "(2)")
        if (e.best) { const n = (wins.get(e.best.p)?.n || 0) + 1; wins.set(e.best.p, { p: e.best.p, n }); e.winNo = n; }
        for (const x of e.top10) tops.set(x.p, { p: x.p, n: (tops.get(x.p)?.n || 0) + 1 });
      }
      const list = [...all].reverse();
      if (list.length >= 2) {
        blocks.push(panelBox("Tournaments", [el("div", { class: "table-scroll ti-events-scroll", tabindex: "0" }, el("table", { class: "plain rankings ti-events" }, [
          el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), el("th", { class: "num" }, "Players"), el("th", {}, "Best in the field")])),
          el("tbody", {}, list.map((e) => el("tr", {}, [el("td", { class: "ht-date" }, dateTxt(e.end)), el("td", {}, e.event), el("td", { class: "num" }, String(e.players)),
            el("td", {}, e.best ? [nameBtn(e.best.p), e.winNo > 1 ? el("span", { class: "ti-winno" }, ` (${e.winNo})`) : null] : "\u2014")]))),
        ]))], "full"));
        // Wins (led the field in this stat), Top 10s (the same way), and the FedEx Cup and OWGR (coming)
        const col = (title, rows, empty) => el("div", { class: "ti-col" }, [el("p", { class: "ti-col-title" }, title),
          rows.length ? el("ol", { class: "ti-list ti-scroll", tabindex: "0", "aria-label": title }, rows.map((x) => el("li", {}, [nameBtn(x.p), el("strong", { class: "ti-v" }, String(x.n))])))
            : el("p", { class: "muted small" }, empty)]);
        const byN = (m) => [...m.values()].filter((x) => x.n >= 1).sort((a, b) => b.n - a.n || String(a.p.label).localeCompare(String(b.p.label)));
        blocks.push(panelBox("Wins & Rankings", [el("div", { class: "ti-leaders" }, [
          col("Wins", byN(wins), "No wins in this selection."), col("Top 10s", byN(tops), "No top 10s in this selection."),
          col("FedEx Cup", [], "Coming soon."), col("OWGR", [], "Coming soon."),
        ])], "full"));
      }
    }

    return blocks.length ? [el("div", { class: "sg-grid ti-grid" }, blocks)] : [];
  }

  /* (update 227/228) the stats table for one category, like Compare's Side by side, for this player: the value, their
     rank in the field, their trend (last 10 rounds against the 10 before), their best round, and the players compared
     (Top 1 / 10 / 25 / 50 / All: the pills on top, which also set the gold dots on the charts) */
  const rowMemo = new WeakMap();
  const SCORING_KEYS = ["scoring", "par3", "par4", "par5"];
  // each row's value for a set of rounds: Map key → value
  function rowVals(rounds, cat) {
    const memo = rowMemo.get(rounds)?.get(cat);
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
      for (const x of sec?.rows || []) if (!x.dist && x.values[0] != null && SCORING_KEYS.includes(x.key)) m.set(`s:${x.key}|`, x.values[0]);
    } else if (n) {
      let tot = 0, att = 0; const byD = new Map();
      for (const rd of rounds) for (const x of rd.shots) if (x.cat === cat) { tot += x.sg; att += x.w || 1; if (x.dist) { const o = byD.get(x.dist) || byD.set(x.dist, { sg: 0, w: 0 }).get(x.dist); o.sg += x.sg; o.w += x.w || 1; } }
      if (att) { m.set("sg", tot / n); m.set("sga", tot / att); m.set("att", att / n); }
      for (const [d, o] of byD) if (o.w >= 1) m.set(`d:${d}`, o.sg / n);
      const sec = statBlocksCmp([rounds]).find((b) => b.cat === cat);
      for (const x of sec?.rows || []) if (x.values[0] != null) m.set(`s:${x.key}|${x.dist || ""}`, x.values[0]);
    }
    if (!rowMemo.has(rounds)) rowMemo.set(rounds, new Map());
    rowMemo.get(rounds).set(cat, m);
    return m;
  }
  function fullStatTable(mine, cat, slicedField = []) {
    const n = mine.length;
    if (!n) return el("p", { class: "empty" }, "No stats for this selection.");
    const sgTone = (v) => (v == null ? "" : Math.round(v * 100) === 0 ? "zero" : v > 0 ? "pos" : "neg");
    const meV = rowVals(mine, cat);
    // the rows: strokes gained, by distance (3+ attempts), then the stats (all distances, then each)
    const lead = (d) => { const mm = /[\d.]+/.exec(String(d)); return /^[<]/.test(d) ? -1 : /^>/.test(d) ? 1e6 : mm ? Number(mm[0]) : 1e5; };
    const dW = new Map(); if (cat) for (const rd of mine) for (const x of rd.shots) if (x.cat === cat && x.dist) dW.set(x.dist, (dW.get(x.dist) || 0) + (x.w || 1));
    const dists = [...dW].filter(([, w]) => w >= 3).map(([d]) => d).sort((a, b) => lead(a) - lead(b) || String(a).localeCompare(String(b)));
    const sec = cat ? statBlocksCmp([mine]).find((b) => b.cat === cat) : null;
    const sgF = (v) => fmtSG(v), sg3 = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`);
    const R = [];
    if (!cat) {
      R.push({ grp: "Strokes gained a round" });
      R.push({ key: "c:TOTAL", label: "SG: Total", fmt: sgF, higher: true, tone: true });
      for (const [k, l] of CATEGORIES) if (meV.has(`c:${k}`)) R.push({ key: `c:${k}`, label: l, fmt: sgF, higher: true, tone: true, sub: true });
      const sk = SCORING_KEYS.filter((k) => meV.has(`s:${k}|`));
      if (sk.length) { R.push({ grp: "Scoring" }); for (const k of sk) { const def0 = statDef(k); R.push({ key: `s:${k}|`, label: def0.label, fmt: (v) => fmtStat(def0, v), def: def0, higher: def0.higher == null ? null : def0.higher !== false, sub: k !== "scoring" }); } }
    } else {
    R.push({ grp: "Strokes gained" });
    R.push({ key: "sg", label: "SG a round", fmt: sgF, higher: true, tone: true });
    if (meV.has("sga")) { R.push({ key: "sga", label: "SG an attempt", fmt: sg3, higher: true, tone: true, sub: true }); R.push({ key: "att", label: "Attempts a round", fmt: (v) => (v == null ? "—" : v.toFixed(1)), higher: null, sub: true }); }
    if (dists.length > 1) { R.push({ grp: "Strokes gained a round, by distance" }); for (const d of dists) R.push({ key: `d:${d}`, label: d, fmt: sgF, higher: true, tone: true, sub: true }); }
    if (sec) { R.push({ grp: `${sec.label} stats` }); for (const x of sec.rows) R.push({ key: `s:${x.key}|${x.dist || ""}`, label: x.dist || x.label, fmt: (v) => fmtStat(x.def, v), def: x.def, higher: x.def.higher == null ? null : x.def.higher !== false, sub: !!x.dist }); }
    }
    // the field: rank among the players ranked; "All Players": the players compared (Top N)
    const ranked = rankedField(slicedField).filter((p) => p.key !== me?.key);
    const fieldMaps = ranked.map((p) => rowVals(p.rounds, cat));
    const avg = (maps, k) => { const v = maps.map((m) => m.get(k)).filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const rankOfRow = (k, v, higher) => { if (v == null || higher == null) return null; const vs = fieldMaps.map((m) => m.get(k)).filter((x) => x != null && Number.isFinite(x)); if (!vs.length) return null; const better = vs.filter((x) => (higher ? x > v + 1e-12 : x < v - 1e-12)).length; return { rank: better + 1, of: vs.length + 1 }; };
    // trend: the last 10 rounds against the 10 before (fewer: half and half, at least 3 each)
    const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const tn = Math.min(10, Math.floor(ordered.length / 2));
    const lastV = tn >= 3 ? rowVals(ordered.slice(-tn), cat) : null, prevV = tn >= 3 ? rowVals(ordered.slice(-2 * tn, -tn), cat) : null;
    // best round: the best single-round value (each round on its own)
    const perRd = ordered.map((rd) => ({ rd, m: rowVals([rd], cat) }));
    const bestOf = (row) => {
      if (row.higher == null) return null;
      let best = null;
      for (const { rd, m } of perRd) { const v = m.get(row.key); if (v == null || !Number.isFinite(v)) continue; if (row.key.startsWith("s:") && !(rd.obs || []).some((o) => o.v != null)) continue; if (!best || (row.higher ? v > best.v : v < best.v)) best = { v, rd }; }
      return best;
    };
    // (update 240) against a rank (picked above the table): the player ranked #N overall (SG: Total a round in this
    // selection, not counting the player on screen), every row from that one player: #1 is the same golfer all the way down
    const peakOn = st.vsRank === "peak"; // (update 260) or against the player's own peak
    const vsN = st.vsRank && !peakOn ? Number(st.vsRank) : null;
    const refP = vsN ? (() => { const byTot = ranked.map((p) => ({ p, t: rowVals(p.rounds, "").get("c:TOTAL") })).filter((x) => x.t != null && Number.isFinite(x.t)).sort((a, b) => b.t - a.t); return byTot.length ? byTot[Math.min(vsN, byTot.length) - 1].p : null; })() : null;
    // (update 260) Personal Peak: for each row, the player's best run of N rounds in a row (the Peak Length, default 10)
    // in this selection: the best average of any N consecutive rounds, each row on its own (lower is better where it is)
    const peakN = Math.max(2, Math.round(Number(st.peakN) || 10));
    const peak = peakOn ? (() => {
      const out = new Map(), at = new Map();
      if (ordered.length < peakN) return { map: out, at, short: true };
      for (let i = 0; i + peakN <= ordered.length; i++) {
        const win = ordered.slice(i, i + peakN), m = rowVals(win, cat);
        for (const row of R) {
          if (!row.key || row.higher == null) continue;
          const v = m.get(row.key);
          if (v == null || !Number.isFinite(v)) continue;
          const cur = out.get(row.key);
          if (cur == null || (row.higher ? v > cur : v < cur)) { out.set(row.key, v); at.set(row.key, [win[0], win.at(-1)]); }
        }
      }
      return { map: out, at, short: false };
    })() : null;
    const refMap = peak ? peak.map : refP ? rowVals(refP.rounds, cat) : null;
    const dTxt = (rd) => String(rd?.date || "").slice(0, 10);
    // no rank picked: each stat coloured against the player's own career average (every round of theirs)
    const careerMap = me?.rounds?.length ? rowVals(me.rounds, cat) : null;
    const relNow = !!refMap && (!peak || peak.map.size > 0);
    const tr = [];
    for (const row of R) {
      if (row.grp) { tr.push(el("tr", { class: "cmp-grp" }, el("td", { colspan: 4 }, row.grp))); continue; }
      const v = meV.get(row.key) ?? null, fAvg = refMap ? refMap.get(row.key) ?? null : careerMap?.get(row.key) ?? null;
      const good = (d) => (d == null || row.higher == null || Math.abs(d) < 1e-9 ? "" : (row.higher ? d > 0 : d < 0) ? "pos" : "neg");
      const shown = relNow && v != null && fAvg != null ? (row.fmt === sgF || row.fmt === sg3 ? row.fmt(v - fAvg) : `${v - fAvg >= 0 ? "+" : "−"}${fmtStat({ ...(row.def || {}), pct: false, unit: row.def?.pct ? " pct" : row.def?.unit }, Math.abs(v - fAvg))}`) : row.fmt(v);
      const vCls = relNow && v != null && fAvg != null ? (row.higher == null ? "" : good(v - fAvg)) : row.tone ? sgTone(v) : good(v != null && fAvg != null ? v - fAvg : null);
      const rk = showRanks ? rankOfRow(row.key, v, row.higher) : null;
      const a = lastV?.get(row.key), b = prevV?.get(row.key), ch = a != null && b != null ? a - b : null;
      const chTxt = ch == null ? "—" : Math.abs(ch) < (row.tone ? 0.005 : 1e-9) ? "◆ steady" : `${ch > 0 ? "▲" : "▼"} ${row.fmt === sg3 ? Math.abs(ch).toFixed(3) : row.fmt === sgF ? Math.abs(ch).toFixed(2) : row.def ? fmtStat({ ...row.def, pct: false, unit: row.def.pct ? " pct" : row.def.unit }, Math.abs(ch)) : Math.abs(ch).toFixed(1)}`;
      void bestOf; // (update 229: no Best round or All Players columns)
      const pk = peak?.at.get(row.key); // (update 260) when the peak was, and what it was
      tr.push(el("tr", { class: row.sub ? "cmp-sub" : "" }, [
        el("td", {}, row.label),
        el("td", { class: `num strong ${vCls}`, title: pk ? `Peak ${row.fmt(peak.map.get(row.key))}: ${dTxt(pk[0])} to ${dTxt(pk[1])} (${peakN} rounds)` : null }, shown),
        el("td", { class: "num" }, rk ? `${rk.rank} of ${rk.of}` : "—"),
        el("td", { class: `num ${ch == null ? "" : good(ch)}` }, chTxt),
      ]));
    }
    return [
      el("div", { class: "sg-full-top" }, [vsPills()]), // (update 231)
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-full-t" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", { class: "num", title: relNow ? (peak ? `Each value less ${me?.label || "the player"}\u2019s own peak: their best ${peakN} rounds in a row` : `Each value less ${refP.label || refP.key}\u2019s (ranked #${vsN} overall)`) : "" }, relNow ? (peak ? `Vs peak (${peakN} rds)` : `Vs #${vsN} ${refP.label || ""}`.trim()) : me?.label || "Player"), el("th", { class: "num" }, "Rank"), el("th", { class: "num", title: `Last ${tn || 10} rounds against the ${tn || 10} before` }, "Trend")])),
        el("tbody", {}, tr),
      ])),
      // (update 240) what the colours mean
      el("p", { class: "muted small sg-full-note" }, peak && peak.short ? `${me?.label || "The player"} has ${ordered.length} rounds in this selection: fewer than the Peak Length (${peakN}), so there\u2019s no peak to compare with. Shorten the Peak Length or widen the selection.`
        : peak ? `Each value is the difference from ${me?.label || "the player"}\u2019s own peak in this selection: for each row on its own, the best average over ${peakN} rounds in a row (hover a value for when). Zero means they\u2019re playing at their peak; the further from zero, the further off it they are (red). Rank: where the player sits in each row. Trend: the last ${tn || 10} rounds against the ${tn || 10} before. Change the Peak Length above to look at shorter or longer runs.`
        : relNow
        ? `Each value is the difference from ${refP.label || "that player"}, ranked #${vsN} overall (SG: Total a round in this selection); every row is the same golfer. Green: better than them; red: worse. Rank: where the player sits in each row. Trend: the last ${tn || 10} rounds against the ${tn || 10} before. Tap the rank comparison again to see the player\u2019s own values.`
        : `Strokes gained: green above zero (the tour baseline), red below. Other stats: green when better than ${me?.label || "the player"}\u2019s career average (every round of theirs), red when worse; no colour when neither is better (attempts, pars). Rank: where they sit among the players in this selection. Trend: the last ${tn || 10} rounds against the ${tn || 10} before. Pick a rank comparison above to see each stat against the player ranked there overall.`),
    ];
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
      const byCat = panelBox("SG by Category", [chartBox((c, as) => barChart(c, bars.map((b) => b.label), bars.map((b) => b.value), {
        title: "SG / round", as, compare: catCompare, compareLabel: compareName() }), "", "by-category", { rankPick: cmpField.length > 0 })]);
      const lies = sgBy(mine, idx, null, "lie");
      const lieCompare = lies && !fieldIsSummary() ? lies.map((g) => avgOf(cmpField.map((p) => (sgBy(p.rounds, idx, null, "lie") || []).find((x) => x.label === g.label)?.perRound))) : null;
      blocks.push(lies && lies.length > 1
        ? el("div", { class: "sg-grid" }, [byCat, panelBox("SG by Lie", chartBox((c, as) => barChart(c, lies.map((g) => g.label), lies.map((g) => g.perRound), { as,
            title: "SG / round", compare: lieCompare, compareLabel: compareName(), tooltip: (i) => `${nf1.format(lies[i].shots)} attempts` }), "", "all-lie", { rankPick: !!lieCompare }))])
        : byCat);
      // (update 218) SG by Club: only with one category picked (below)
      // (update 229) the stats table with no category: SG: Total and each category, and the scoring averages
      blocks.unshift(panelBox(describe(), fullStatTable(mine, "", slicedField)));
    } else {
      // (update 227) one full table, as on Compare (one column: this player): strokes gained a round in this part of the
      // game and at each distance, then every stat recorded for it (all distances, then each distance)
      blocks.push(panelBox(describe(), fullStatTable(mine, cat, slicedField)));

      const visuals = [];
      if (cat === "OTT") { const miss = missSplit(mine, idx); if (miss) visuals.push(panelBox("Miss Tendencies", missBar(miss))); }
      if (cat === "APP" || cat === "ARG") {
        const pts = leavePoints(mine, idx, cat);
        if (pts) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c) => scatterChart(c, pts, LEAVE_SCALE[cat]), "tall")));
        else { const hist = leaveHistogram(mine, idx, cat); if (hist) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c, as) => barChart(c, hist.map((h) => h.label), hist.map((h) => h.count), { single: "blue", title: "Shots", as }), "", `${cat}-leave`))); }
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
      const byClubC = sgByClubBox(mine, cat); if (byClubC) visuals.push(byClubC);
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
    const others = rankedField(slicedField).filter((p) => p.key !== me.key);
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

  /* ------------------------------ any other stat (Hit Green %, Putts / Round, Driving Distance ...) ------------------------------ */
  // The same page as strokes gained: the hero card (or leaderboard), a summary, the rankings, then whatever this
  // stat can be split by (category, distance, lie) and its trend. What shows follows what the data has.
  function statBlocks(mine, slicedField, f) {
    const blocks = [heroBox(mine, slicedField, f), statSummary(mine, slicedField)];
    if (!me) return [...blocks, ...tourBlocks(slicedField)]; // (the field's form, steadiness, tournaments and wins in this stat)
    if (!mine || !mine.length) { blocks.push(el("section", { class: "panel" }, el("p", { class: "empty center" }, `No ${def.label} for ${me.label} in this selection.`))); return blocks; }
    blocks.push(...statDetail(mine, slicedField));
    blocks.push(statTrend(mine, slicedField));
    return blocks;
  }
  const avgOf = (vals) => { const v = vals.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  function statSummary(mine, slicedField) {
    const lines = [], what = describe();
    const r = rankAmong(slicedField, me && mine?.length ? me.key : null);
    const avg = r.vals.length ? r.vals.reduce((t, x) => t + x.v, 0) / r.vals.length : null;
    const better = (a, b) => (def.higher == null ? null : def.higher ? a > b : a < b);
    if (me && mine && mine.length) {
      const v = metric(mine);
      lines.push(`${me.label}: ${def.label} ${fmtV(v)} over ${rw(mine.length)}${what ? ` (${what})` : ""}${r.rank && r.of > 1 ? `, ${ordinal(r.rank)} of ${r.of} players` : ""}.`);
      if (avg != null && r.of > 1 && v != null) {
        const b = better(v, avg);
        lines.push(`Tour Players\u2019 average: ${fmtV(avg)}${b === null || Math.abs(v - avg) < 1e-9 ? "." : `, so ${b ? "better" : "worse"} than average.`}`);
      }
      const cat = st.cats.length === 1 ? st.cats[0] : catsAvail.length === 1 ? catsAvail[0][0] : "";
      if (!cat && catsAvail.length > 1) {
        const parts = catsAvail.filter(([k]) => !st.cats.length || st.cats.includes(k)).map(([k, l]) => ({ l, v: metric(mine, k) })).filter((x) => x.v != null);
        if (parts.length > 1) lines.push(`By category: ${parts.map((x) => `${x.l} ${fmtV(x.v)}`).join(", ")}.`);
      } else if (cat && def.higher != null) {
        // its best and lowest distance (with at least 3 attempts, so one lucky shot doesn't lead)
        const ds = groupObs(mine, cat, "distanceRange").filter((g) => g.w >= 3 && g.value != null).sort((a, b) => (def.higher ? b.value - a.value : a.value - b.value));
        if (ds.length > 1) lines.push(`Best from ${ds[0].label} (${fmtV(ds[0].value)}, ${Math.round(ds[0].w)} attempts); lowest from ${ds[ds.length - 1].label} (${fmtV(ds[ds.length - 1].value)}, ${Math.round(ds[ds.length - 1].w)} attempts).`);
      }
      const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const n = Math.min(10, Math.floor(ordered.length / 2));
      if (n >= 2) {
        const last = metric(ordered.slice(-n)), prev = metric(ordered.slice(-2 * n, -n));
        if (last != null && prev != null) {
          const steady = Math.abs(last - prev) < steadyBand(prev), b = better(last, prev);
          lines.push(steady ? `Steady: ${fmtV(last)} over the last ${rw(n)}, about the same as the ${n} before.`
            : `Last ${rw(n)}: ${fmtV(last)}, against ${fmtV(prev)} in the ${n} before${b === null ? "" : `: ${b ? "better" : "worse"}`}.`);
        }
        const sl = steadinessLine(ordered, n); if (sl) lines.push(sl);
      }
    } else if (r.of) {
      const nameOf = (key) => slicedField.find((p) => p.key === key)?.label || "\u2014";
      const last = r.vals[r.vals.length - 1];
      lines.push(`${r.of} players${what ? ` (${what})` : ""}. ${def.higher === false ? "Lowest" : "Highest"}: ${nameOf(r.leader.key)} (${fmtV(r.leader.v)})${r.of > 1 ? `; ${def.higher === false ? "highest" : "lowest"}: ${nameOf(last.key)} (${fmtV(last.v)})` : ""}. Average: ${fmtV(avg)}. Pick a player for their own summary.`);
    }
    if (!lines.length) return null;
    return el("section", { class: "panel sg-summary" }, [el("h3", {}, "Summary"), ...lines.map((t) => el("p", {}, t))]);
  }
  function statDetail(mine, slicedField) {
    const blocks = [], visuals = [];
    const cat = st.cats.length === 1 ? st.cats[0] : catsAvail.length === 1 ? catsAvail[0][0] : "";
    const detailOK = !fieldIsSummary(); // others' lie / distance detail (the admin); the shared summary has categories only
    // the gold dots: the same players as on the strokes-gained charts (none when there's nobody else to compare with)
    const cmpField = rankedField(slicedField).some((p) => p.key !== me.key) ? topPlayers(slicedField) : [];
    const tip = (groups) => (i) => `${Math.round(groups[i].w).toLocaleString()} ${Math.round(groups[i].w) === 1 ? "attempt" : "attempts"}`;
    if (!cat && catsAvail.length > 1) {
      const shown = catsAvail.filter(([k]) => !st.cats.length || st.cats.includes(k));
      const bars = shown.map(([k, l]) => ({ label: l, value: metric(mine, k) }));
      const compare = cmpField.length ? shown.map(([k]) => avgOf(cmpField.map((p) => metric(p.rounds, k)))) : null;
      visuals.push(panelBox(`${def.label} by Category`, chartBox((c, as) => barChart(c, bars.map((b) => b.label), bars.map((b) => b.value), {
        title: def.label, as, single: "blue", compare, compareLabel: compareName() }), "", `${statKey}-cat`, { rankPick: cmpField.length > 0 })));
      const lies = groupObs(mine, null, "lie");
      if (lies.length > 1) {
        const lc = detailOK && cmpField.length ? lies.map((g) => avgOf(cmpField.map((p) => groupObs(p.rounds, null, "lie").find((x) => x.label === g.label)?.value))) : null;
        visuals.push(panelBox(`${def.label} by Lie`, chartBox((c, as) => barChart(c, lies.map((g) => g.label), lies.map((g) => g.value), {
          title: def.label, as, single: "blue", compare: lc, compareLabel: compareName(), tooltip: tip(lies) }), "", `${statKey}-lie`, { rankPick: !!lc })));
      }
    }
    if (cat) {
      const catLabel = catName(cat);
      const dims = [["distanceRange", "Distance"], ["lie", "Lie"]].map(([fieldName, name]) => ({ fieldName, name, groups: groupObs(mine, cat, fieldName) }));
      for (const d of dims) {
        if (d.groups.length < 2) continue;
        const cmp = detailOK && cmpField.length ? d.groups.map((g) => avgOf(cmpField.map((p) => groupObs(p.rounds, cat, d.fieldName).find((x) => x.label === g.label)?.value))) : null;
        visuals.push(panelBox(`${def.label} by ${d.name} \u00b7 ${catLabel}`, chartBox((c, as) => barChart(c, d.groups.map((g) => g.label), d.groups.map((g) => g.value), {
          title: def.label, as, single: "blue", compare: cmp, compareLabel: compareName(), tooltip: tip(d.groups) }), "", `${statKey}-${cat}-${d.fieldName}`, { rankPick: !!cmp })));
      }
      if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
      // distance by lie: every bucket the data has, with how many attempts each value comes from
      const [dist, lie] = dims;
      if (dist.groups.length > 1 && lie.groups.length > 1) blocks.push(statMatrix(mine, cat, dist.groups.map((g) => g.label), lie.groups.map((g) => g.label), catLabel));
      return blocks;
    }
    if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
    return blocks;
  }
  function statMatrix(mine, cat, dists, lies, catLabel) {
    const cell = new Map(), add = (k, o) => { const c = cell.get(k) || { s: 0, w: 0 }; c.s += o.v * o.w; c.w += o.w; cell.set(k, c); };
    for (const rd of mine) for (const o of rd.shots) {
      if (o.cat !== cat || o.dist == null) continue;
      add(`${o.dist}|${o.lie}`, o); add(`${o.dist}|*`, o); if (o.lie != null) add(`*|${o.lie}`, o); add("*|*", o);
    }
    const td = (k, strong = false) => {
      const c = cell.get(k);
      if (!c || !c.w) return el("td", { class: "num muted" }, "\u2014");
      return el("td", { class: "num" }, [el(strong ? "strong" : "span", {}, fmtV(c.s / c.w)), el("span", { class: "mx-n" }, ` ${Math.round(c.w)}`)]);
    };
    const table = el("table", { class: "plain stats stat-matrix" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Distance"), ...lies.map((l) => el("th", { class: "num" }, l)), el("th", { class: "num" }, "All lies")])),
      el("tbody", {}, [...dists.map((d) => el("tr", {}, [el("td", {}, d), ...lies.map((l) => td(`${d}|${l}`)), td(`${d}|*`, true)])),
        el("tr", { class: "mx-total" }, [el("td", {}, "All distances"), ...lies.map((l) => td(`*|${l}`, true)), td("*|*", true)])]),
    ]);
    return panelBox(`${def.label} by Distance and Lie \u00b7 ${catLabel}`, [el("div", { class: "table-scroll" }, table),
      el("p", { class: "muted small" }, "The small number is how many attempts each value comes from.")], "full");
  }
  function statTrend(mine, slicedField) {
    const groups = groupBy(mine, st.trendBy);
    const vals = groups.map((g) => metric(g.rounds));
    // each round / event / month / year: the best result(s) there among the players who played it (this player included)
    const others = rankedField(slicedField).filter((p) => p.key !== me.key);
    const otherGroups = others.map((p) => groupBy(p.rounds, st.trendBy));
    const cmp = others.length ? groups.map((g, i) => topMean([vals[i], ...otherGroups.map((og) => { const x = og.find((y) => y.label === g.label); return x ? metric(x.rounds) : null; })], def.higher !== false)) : null;
    const toggles = el("div", { class: "subnav small trend-toggles" }, [["round", "Round"], ["event", "Event"], ["month", "Month"], ["year", "Year"]].filter(([v]) => unit !== "event" || v !== "round").map(([v, l]) => {
      const a = el("a", { href: "#", "aria-current": v === st.trendBy ? "page" : null }, l);
      a.addEventListener("click", (e) => { e.preventDefault(); st.trendBy = v; draw(); });
      return a;
    }));
    const key = "stat-trend";
    const each = { round: "round", event: "event", month: "month", year: "year" }[st.trendBy] || "event";
    return panelBox(`${def.label} Trend`, [toggles, chartBox((c, as) => barChart(c, groups.map((g) => g.label), vals, {
      title: def.label, as, single: "blue", compare: cmp && cmp.some((v) => v != null) ? cmp : null, compareLabel: compareName(each), shortLabels: groups.map((g) => g.short),
      tooltip: (i) => rw(groups[i].rounds.length),
    }), "wide", key, { rankPick: others.length > 0 })], "full");
  }

  /* ------------------------------ rankings ------------------------------ */
  let rankScroll = null;
  // Min. rounds: until you set it, 25% of the most rounds anyone listed has played (rounded)
  // Min. rounds follows the selection (update 158): a filter that lowers the most rounds anyone has (Round 4
  // only, one tournament, ...) lowers it too. Until you set it: the default share of the most rounds. Once
  // you set it: the same share of the most rounds as when you set it (40 of 80 is 10 of 20).
  let curMost = 0;
  const minDefault = (most) => (most >= 15 ? defaultMinRounds(most) : Math.max(1, Math.floor(most * 0.33)));
  function minFor(most) {
    curMost = most;
    if (st.minRounds == null) return minDefault(most);
    const set = Math.max(1, Number(st.minRounds) || 1), at = Number(st.minRoundsAt) || 0;
    const v = at > 0 && most > 0 && at !== most ? Math.round((set * most) / at) : set;
    return Math.max(1, Math.min(v, Math.max(1, most)));
  }
  const minRoundsFor = (players) => {
    if (sgEligible) return sgMinR; // (strokes-gained rounds decide, for every stat)
    return minFor(Math.max(0, ...players.map((p) => p.rounds.length)));
  };
  function minRoundsBox(players, onMin = null) {
    const v = minRoundsFor(players);
    const inp = el("input", { type: "number", min: 1, max: 999, value: v, class: "hb-min-in", "aria-label": "Minimum rounds played" });
    const most = curMost;
    inp.addEventListener("change", () => { st.minRounds = Math.max(1, Math.round(Number(inp.value) || 1)); st.minRoundsAt = most; setTimeout(onMin || draw, 0); });
    const what = sgEligible ? "round" : unit;
    return el("label", { class: "hb-min", title: sgEligible && !isSG() ? "Only players with at least this many strokes-gained rounds in the selection (the same players for every stat)" : `Only players with at least this many ${what}s in the selection` }, [`Min. ${what}s`, inp]);
  }
  function rankingsBlock(slicedField, onMin = null) {
    const sg = isSG();
    // strokes gained: SG / Round and attempts a round; another stat: its value and, when it has categories, the attempts
    const showAtt = sg || catsAvail.length > 0;
    const ranked = rankedField(slicedField).map((p) => {
      if (sg) { const t = sliceTotals(p.rounds); return { key: p.key, label: p.label, value: t.sgPerRound ?? -Infinity, rounds: t.rounds, att: t.attemptsPerRound }; }
      const a = statAgg(p.rounds, narrowedNow());
      return { key: p.key, label: p.label, value: a.value, rounds: p.rounds.length, att: a.w };
    }).filter((r) => sg || r.value != null).map((r) => ({ ...r, v: r.value })).sort(byBest).map((r, i) => ({ ...r, rank: i + 1 }));
    const third = Math.max(1, Math.ceil(ranked.length / 3));
    // (update 226) relative: each player's value less the average of everyone else ranked
    const okVals = ranked.filter((r) => r.value != null && Number.isFinite(r.value));
    const sumV = okVals.reduce((t, r) => t + r.value, 0), nV = okVals.length;
    const relOf = (r) => (relOn() && nV > 1 && r.value != null && Number.isFinite(r.value) ? r.value - (sumV - r.value) / (nV - 1) : null);
    const search = el("input", { type: "search", placeholder: "Find a player\u2026", value: st.rankQuery, "aria-label": "Find a player in the rankings" });
    const body = el("tbody", {}, ranked.map((r) => el("tr", {
      class: `tier-${r.rank <= third ? "top" : r.rank > ranked.length - third ? "bottom" : "mid"}` + (r.key === me?.key ? " me" : ""),
      "data-name": r.label.toLowerCase(),
    }, [
      el("td", { class: "num" }, String(r.rank)),
      el("td", {}, starred(r.key, r.label)),
      relOn() ? el("td", { class: `num ${relCls(relOf(r))}` }, fmtRel(relOf(r))) : el("td", { class: "num" }, fmtV(r.value === -Infinity ? null : r.value)),
      showAtt ? el("td", { class: "num" }, r.att === null ? "\u2014" : sg ? nf1.format(r.att) : Math.round(r.att).toLocaleString()) : null,
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
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, relOn() ? (sg ? "SG vs Field" : `${def.label} vs Field`) : sg ? "SG / Round" : def.label),
        !showAtt ? null : sg ? el("th", { class: "num" }, [el("span", { class: "long" }, "Attempts / Round"), el("span", { class: "short" }, "Att / Rd")]) : el("th", { class: "num" }, [el("span", { class: "long" }, "Attempts"), el("span", { class: "short" }, "Att")]),
        el("th", { class: "num" }, Unit())])),
      body,
    ]));
    requestAnimationFrame(applySearch);
    // a magnifying-glass button (top right) opens the search; ✕ or Esc closes it and shows everyone again
    const open = !!st.rankOpen || !!st.rankQuery;
    const glass = el("button", { type: "button", class: "rank-glass", "aria-label": "Search the rankings for a player", title: "Search for a player", "aria-expanded": open ? "true" : "false" });
    glass.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    const closeBtn = el("button", { type: "button", class: "rank-close", "aria-label": "Close the search" }, "\u2715");
    const searchBox = el("div", { class: "rank-tools", hidden: !open }, [search, closeBtn]);
    const shut = () => { st.rankOpen = false; search.value = ""; applySearch(); searchBox.hidden = true; glass.setAttribute("aria-expanded", "false"); glass.focus(); };
    glass.addEventListener("click", () => {
      if (!searchBox.hidden) { shut(); return; }
      st.rankOpen = true; searchBox.hidden = false; glass.setAttribute("aria-expanded", "true"); search.focus();
    });
    closeBtn.addEventListener("click", shut);
    search.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } });
    // (players and coaches only: not for the admin or analysts)
    const searchable = !getState().isAdmin && opts.teamRole !== "analyst";
    const minBox = minRoundsBox(slicedField.filter((p) => p.rounds.length), onMin);
    minBox.classList.add("rank-min"); if (searchable) minBox.classList.add("with-glass");
    return panelBox(`Rankings \u00b7 ${sg ? "" : `${def.label} \u00b7 `}${describe()}`.replace(/ \u00b7 $/, ""), [
      minBox,
      searchable ? glass : null,
      searchable ? searchBox : null,
      ranked.length ? rankScroll : el("p", { class: "empty" }, "No rounds match these filters."),
      fieldIsSummary() && narrowed() ? el("p", { class: "muted small" }, "Rankings follow year, tournament, round and category, not lie or distance.") : null,
      !sg && def.higher === false ? el("p", { class: "muted small" }, "Lower is better, so the lowest is ranked first.") : !sg && def.higher == null ? el("p", { class: "muted small" }, "Ranked highest first (the file doesn\u2019t say whether higher is better).") : null,
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
  // (update 210) SG by Club: strokes gained a round with each club model (brand + model), best first.
  // A model with only a few rounds is marked, so 3 rounds isn't read like 60.
  const FEW = 10;
  function sgByClubBox(mine, cat) {
    if (!isSG() || !mine?.length) return null;
    const rs = cat ? mine.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => s.cat === cat) })) : mine;
    if (!cat) return null; // (update 218: only for one category, and only when more than one product was used in it)
    const list = gearList(rs).filter((g) => g.kind !== "Ball").map((g) => ({ ...g, perRound: g.sg / mine.length }))
      .sort((a, b) => b.perRound - a.perRound).slice(0, 14);
    if (list.length < 2) return null;
    const few = list.filter((g) => g.rounds < FEW);
    return panelBox("SG by Club", [
      chartBox((c, as) => barChart(c, list.map((g) => `${g.label}${g.rounds < FEW ? " *" : ""}`), list.map((g) => g.perRound), { as, title: "SG / round",
        tooltip: (i) => `${nf1.format(list[i].shots)} shots in ${list[i].rounds} round${list[i].rounds === 1 ? "" : "s"}${list[i].rounds < FEW ? " (only a few rounds: read with care)" : ""}` }), "", `club-${cat || "all"}`),
      few.length ? el("p", { class: "muted small sg-few" }, `* Fewer than ${FEW} rounds with this club: ${few.map((g) => `${g.label} (${g.rounds})`).join(", ")}. Read these with care.`) : null,
    ]);
  }
  function panelBox(title, content, size = "") {
    return el("section", { class: `panel sg-box ${size}` }, [el("h3", {}, title), ...[].concat(content)]);
  }
  // Rank filter for the dashed comparison: everyone, or just the top 1 / 10 / 25 / 50 players by SG / round.
  const RANK_TOPS = [["1", "Top 1"], ["10", "Top 10"], ["25", "Top 25"], ["50", "Top 50"], ["all", "All"]];
  function topPlayers(list) {
    list = rankedField(list); // the gold dots (Tour avg) use the same players as the rankings (Min. rounds)
    const n = st.rankTop && st.rankTop !== "all" ? Number(st.rankTop) : null;
    if (!n) return list;
    return list.filter((p) => p.rounds.length).map((p) => ({ p, v: metric(p.rounds) })).filter((x) => x.v != null)
      .sort(byBest).slice(0, n).map((x) => x.p);
  }
  // what the gold dots are: on the trends, the best result(s) each round / event / month / year among the
  // players who played it; on the other charts, the best players over the selected time frame
  const compareName = (each = null) => {
    const n = st.rankTop && st.rankTop !== "all" ? st.rankTop : null;
    if (each) return n === "1" ? `Best player each ${each}` : n ? `Top ${n} each ${each} (avg)` : `All players each ${each} (avg)`;
    return n === "1" ? "Best player overall" : n ? `Top ${n} overall (avg)` : "All players (avg)";
  };
  // the best n of a set of results (lower is better for some stats), averaged
  const topMean = (vals, higher = true) => {
    const v = vals.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => (higher ? q - p : p - q));
    if (!v.length) return null;
    const n = st.rankTop && st.rankTop !== "all" ? Number(st.rankTop) : v.length;
    const top = v.slice(0, n);
    return top.reduce((t, x) => t + x, 0) / top.length;
  };
  const topName = () => (RANK_TOPS.find(([v]) => v === (st.rankTop || "all"))?.[1] || "All").replace(/^All$/, "All Players");
  function topPills(label = null) {
    // (update 228) Top 1 / 10 / 25 / 50 / All: who the gold dots and the "All Players" column are
    return el("div", { class: "top-pills" }, [label ? el("span", { class: "ms-label" }, label) : null, el("div", { class: "seg small" }, RANK_TOPS.map(([v, l]) => {
      const on = (st.rankTop || "all") === v;
      const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, l);
      b.addEventListener("click", () => { st.rankTop = v; st.rankTopManual = true; st.rankTopFor = me?.key; draw(); });
      return b;
    }))]);
  }
  // (update 231) Rank comparisons above the stats table: none (the player's own values) or #1 / #10 / #25 / #50.
  // Tap the one picked again to go back to none. The pick also sets who the gold dots on the charts are.
  // (update 260) and Personal Peak: each stat against the player's own best run of rounds (Peak Length, default 10)
  function vsPills() {
    const pills = el("div", { class: "seg small vs-pills" }, [["1", "#1"], ["10", "#10"], ["25", "#25"], ["50", "#50"], ["peak", "Personal Peak"]].map(([v, l]) => {
      const on = st.vsRank === v, isPeak = v === "peak";
      const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}${isPeak ? " vs-peak" : ""}`, "aria-pressed": String(on), title: isPeak ? "Show each stat against the player\u2019s own best run of rounds (the Peak Length)" : `Show each stat against the player ranked #${v}` }, l);
      b.addEventListener("click", () => {
        if (on) { st.vsRank = null; if (!isPeak) { st.rankTopManual = false; st.rankTopFor = null; } }
        else if (isPeak) st.vsRank = "peak"; // (the gold dots on the charts stay as they were)
        else { st.vsRank = v; st.rankTop = v; st.rankTopManual = true; st.rankTopFor = me?.key; }
        draw();
      });
      return b;
    }));
    let len = null;
    if (st.vsRank === "peak") {
      const inp = el("input", { type: "number", class: "peak-len", min: "2", max: "100", step: "1", value: String(st.peakN || 10), inputmode: "numeric", "aria-label": "Peak Length: rounds in a row" });
      const apply = () => { const n = Math.round(Number(inp.value)); if (!Number.isFinite(n) || n < 2) { inp.value = String(st.peakN || 10); return; } const v = Math.min(100, n); if (v === (st.peakN || 10)) return; st.peakN = v; draw(); setTimeout(() => document.querySelector(".peak-len")?.focus(), 0); };
      inp.addEventListener("change", apply);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });
      len = el("label", { class: "peak-len-wrap", title: "How many rounds in a row are averaged to find the peak" }, [el("span", { class: "ms-label" }, "Peak Length"), inp, el("span", { class: "muted small" }, "rounds")]);
    }
    return el("div", { class: "top-pills" }, [el("span", { class: "ms-label" }, "Rank comparisons"), pills, len]);
  }
  function rankPicker() {
    const sel = el("select", { class: "rank-pick", "aria-label": "Compare with",
      title: "Which players the gold dots show. On SG Trends: the best result (or the average of the best results) each round, event, month or year, among the players who played it. On the other charts: the best players over the selected time frame." },
      RANK_TOPS.map(([v, l]) => el("option", { value: v, selected: (st.rankTop || "all") === v }, l)));
    sel.addEventListener("change", () => { st.rankTop = sel.value; st.rankTopManual = true; st.rankTopFor = me?.key; draw(); });
    return sel;
  }

  // A chart that draws itself once it's on the page. With a key, a small Bar | Line toggle sits in the
  // panel's corner; the choice is remembered per chart, and switching redraws just that chart.
  const BAR_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="8" width="3" height="6" rx="1"/><rect x="6.5" y="4" width="3" height="10" rx="1"/><rect x="11" y="6" width="3" height="8" rx="1"/></svg>';
  const LINE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,12 6,7 9.5,9.5 14,3.5"/></svg>';
  const lastSig = new Map(); // each chart's last data (so unchanged charts don't re-animate)
  let chartSeq = 0;
  let tourCounts = []; // [[tour, rounds]], most rounds first
  function chartBox(make, size = "", key = null, { rankPick = false } = {}) {
    const seq = chartSeq++; // its place on the page (charts can share a title)
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
      // Only a chart whose bars changed grows in again; the rest appear as they were. When just the gold
      // dots changed (Top 1 / 10 / 25 / 50 / All), the bars stay put and the dots glide to their new places.
      try {
        const d = chart.data || {}, sets = d.datasets || [];
        const id = `${seq}|${key || ""}|${sets[0]?.label || ""}|${size}|${(d.labels || []).length}`;
        const dots = sets.find((x) => x.$dots) || null;
        const bars = JSON.stringify([d.labels, sets.filter((x) => !x.$dots).map((x) => [x.type, x.data])]) + ((key && st.chartTypes[key]) || "");
        const prev = lastSig.get(id);
        if (prev && prev.bars === bars && typeof chart.stop === "function") {
          chart.stop();
          const dotsMoved = !!dots && JSON.stringify(prev.dots) !== JSON.stringify(dots.data);
          if (dotsMoved) {
            const next = dots.data;
            dots.data = prev.dots && prev.dots.length === next.length ? prev.dots.slice() : next.map(() => null);
            chart.update("none");                           // as it was a moment ago
            chart.$dotsOnly = true; dots.data = next;
            chart.config.options.animation = { ...(chart.config.options.animation || {}), duration: 450, easing: "easeOutCubic" };
            chart.update(); // the bars hold still; only the dots move
          } else chart.update("none");
        }
        lastSig.set(id, { bars, dots: dots ? dots.data.slice() : null });
      } catch { /* fine */ }
    };
    requestAnimationFrame(build);
    // (update 142: no bar / line switch; each chart keeps its own style)
    void rankPick; // (update 228: no dropdown on the charts; the Top pills sit on the stats table / category chart)
    return key ? el("div", { class: "chart-holder" }, [wrap]) : wrap;
  }
  function baseOptions() {
    const muted = "#8e8e93", grid = "rgba(255,255,255,0.06)";
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "rgba(28,28,30,0.96)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, padding: 10, cornerRadius: 10, titleFont: { family: "Inter, system-ui, sans-serif", weight: "600" }, bodyFont: { family: "Inter, system-ui, sans-serif" } } },
      scales: {
        x: { ticks: { color: muted }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: muted }, border: { display: false }, grid: { color: (c) => (c.tick?.value === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.05)"), lineWidth: (c) => (c.tick?.value === 0 ? 1.5 : 1) } },
      },
      animation: { duration: 650, easing: "easeOutQuart" },
      animations: { y: { from: (c) => (c.chart?.$dotsOnly || !c.chart?.scales?.y ? undefined : c.chart.scales.y.getPixelForValue(0)) } },
    };
  }
  // A bar's colour, on one scale for the whole chart: dark at the zero line, brightening the further the
  // bar reaches. Each side has its own scale: green brightens to the chart's biggest gain, red to its biggest
  // loss, so the longest bar on each side ends in the brightest colour and a half-length bar ends halfway.
  // One-colour (blue) charts whose bars all sit far from zero (driving distance, scoring average): the stretch
  // between the shortest and longest bar gets most of the dark-to-bright range, so differences still show.
  const GRAD = { up: ["#0c4a24", "#3ef07e"], down: ["#5c0f0b", "#ff5c4f"], blue: ["#0a2f66", "#4db2ff"] }; // [at zero, at the biggest bar]
  const LINE_COLOR = { blue: "#2f9bff", up: "#30d158" };
  const rampOf = (single, v) => (single === "up" ? GRAD.up : single ? GRAD.blue : v >= 0 ? GRAD.up : GRAD.down);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const p = hex(a), q = hex(b); return `rgb(${p.map((x, i) => Math.round(x + (q[i] - x) * t)).join(",")})`; };
  // the colour stops for one side: [fraction of the span, colour]
  function rampStops(near, far, minAbs, maxAbs) {
    const r = maxAbs > 0 ? minAbs / maxAbs : 0;
    if (r <= 0.35 || r >= 0.999) return [[0, near], [1, far]];
    return [[0, near], [r, mix(near, far, 0.22)], [1, far]]; // bars bunched far from zero: spread their tips
  }
  function barFill(c, single) {
    const { chart, dataIndex } = c, area = chart.chartArea, y = chart.scales?.y;
    const v = c.dataset.data[dataIndex];
    const [near, far] = rampOf(single, v);
    if (!area || !y || v == null) return far;
    const side = c.dataset.data.map(Number).filter((x) => Number.isFinite(x) && (v >= 0 ? x >= 0 : x < 0)).map(Math.abs);
    const maxAbs = Math.max(...side, 1e-9), minAbs = Math.min(...side);
    const z = y.getPixelForValue(0), end = y.getPixelForValue(v >= 0 ? maxAbs : -maxAbs);
    if (!Number.isFinite(z) || !Number.isFinite(end) || Math.abs(z - end) < 1) return far;
    const g = chart.ctx.createLinearGradient(0, z, 0, end); // the same span for every bar on this side
    // strokes gained: straight from zero; one-colour stats (often far from zero): spread between their min and max
    for (const [t, col] of single ? rampStops(near, far, minAbs, maxAbs) : [[0, near], [1, far]]) g.addColorStop(t, col);
    return g;
  }
  /** The same scale for HTML bars (the leaderboard): the gradient spans the full track, the bar shows its part. */
  // width: on the shared scale; colour: on its own side's scale (brightest at the biggest gain / loss)
  const htmlBarStyle = (v, frac, colorFrac = frac) => {
    const [near, far] = rampOf(null, v);
    const w = Math.max(0.04, frac), cf = Math.max(0.04, colorFrac);
    return `width:${w * 100}%;background:linear-gradient(90deg, ${near}, ${far});background-size:${100 / cf}% 100%;background-repeat:no-repeat`;
  };
  function barChart(canvas, labels, values0, { title: title0, compare: compare0, compareLabel = "All players", average, single, tooltip, shortLabels = null, as = "bar" } = {}) {
    // (update 228) Relative to Avg: each bar less the compared players' value at it (the dots become the zero line)
    const relNow = relOn() && Array.isArray(compare0) && compare0.some((x) => x != null);
    const values = relNow ? values0.map((v, i) => (v != null && compare0[i] != null ? v - compare0[i] : null)) : values0;
    const compare = relNow ? null : compare0;
    const title = relNow ? `${title0 || ""} vs ${compareLabel.replace(/ \(avg\)$/, "")}`.trim() : title0;
    const signColors = values.map((v) => (v >= 0 ? "#30d158" : "#ff453a"));
    const lineCol = single ? LINE_COLOR[single] || LINE_COLOR.blue : null;
    const lineFill = single === "up" ? "rgba(48,209,88,0.12)" : "rgba(47,155,255,0.13)";
    const datasets = [as === "line"
      // Line: a champagne line through green / red points, shaded green above zero and red below
      // (one-colour charts, like stats other than strokes gained: a blue line, shaded blue).
      ? { type: "line", label: title || "", data: values, order: 2, borderColor: lineCol || "#c8a97e", borderWidth: 2.5, tension: 0.35,
          pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: lineCol || signColors, pointBorderColor: lineCol || signColors,
          fill: single ? { target: "origin", above: lineFill } : { target: "origin", above: "rgba(48,209,88,0.10)", below: "rgba(255,69,58,0.10)" } }
      // Bars: dark at the zero line, brightening (brighter green up, brighter red down) the further they reach;
      // square where they meet zero, rounded at the tip; a glint on hover; growing from zero when drawn.
      : { type: "bar", label: title || "", data: values, order: 2, maxBarThickness: 46, categoryPercentage: 0.72, barPercentage: 0.9,
          borderRadius: 8, borderSkipped: "start",
          backgroundColor: (c) => barFill(c, single), hoverBackgroundColor: (c) => barFill(c, single),
          borderWidth: 0 }];
    // Reference marks: "All players" as blue dashes at each bar, "Average" as a yellow dashed line.
    // the other players: gold dots in front of the bars
    // (gold dots, no line)
    // the other players: champagne dots in front of the bars (no line)
    if (compare) datasets.push({ type: "line", label: compareLabel, data: compare, $dots: true, showLine: false, borderColor: "#d4b483", backgroundColor: "#d4b483",
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
    // (update 227) the full name under each bar, wrapped onto as many lines as it needs (never cut short)
    const few = labels.length <= (narrow ? 8 : 14);
    const wrapAt = narrow ? 10 : 14;
    const wrapL = (l) => { const out = []; let cur = ""; for (const w of String(l).split(/\s+/)) { if (cur && (cur + " " + w).length > wrapAt) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; } if (cur) out.push(cur); return out.length > 1 ? out : out[0] || ""; };
    const shortOf = (i) => {
      const l = String(labels[i] ?? "");
      if (narrow && !few && shortLabels?.[i]) return shortLabels[i];
      return few ? wrapL(l) : l;
    };
    o.scales.x = { ...(o.scales.x || {}), ticks: { ...((o.scales.x || {}).ticks || {}), callback: (v, i) => shortOf(i), autoSkip: !few, maxRotation: few ? 0 : narrow ? 60 : 45, minRotation: 0, font: { size: narrow ? 9 : 11 } } };
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
    destroy() { destroyCharts(); if (opts.viewHost) mount(opts.viewHost, null); if (opts.lead && opts.leadHome) { if (opts.lead.parentNode !== opts.leadHome) opts.leadHome.appendChild(opts.lead); } /* (the page shows them again if nothing else draws) */ if (opts.slot && opts.slotHome) opts.slotHome.appendChild(opts.slot); document.removeEventListener("pointerdown", onDocDown); document.removeEventListener("keydown", onKey); },
    update(next) { if ("me" in next) meAll = next.me; if ("field" in next) fieldAll = next.field || []; draw(); },
  };
}
