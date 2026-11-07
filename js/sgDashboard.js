/*
 * The Stats page (sgDashboard). Split by section (see sgShared.js and the sg*.js modules next to it); this file keeps the
 * page's state, draw() and the small helpers every section shares.
 */
import { careerBlocks, statBlocksCmp, getState, drillFor, drillLine, practiceOpen, goalStatsFor, isMine, favoriteKeys, el, mount, loadScript, infoTip, CATEGORIES, applyFilters, roundFilter, filterOptions, sliceTotals, sgPerRound, sgBy, trend, statTable, statTableFull, shortDate, missSplit, leavePoints, leaveHistogram, rank, gradeColor, sgColor, fmtSG, defaultMinRounds, statRounds, statAgg, statDef, fmtStat, statsIn, groupObs, gearInfo, gearLabel, gearList, distLead, localDay, LEVELS, PLAN_ADDED, PLAN_SEEN, bucketsOf, groupSplit, kv, sgn2, splitOf, sumSplit, mixWords, mixLead, MIX_CAUSE, CHART_JS, SPANS, SUMMARY, BREAKDOWNS, LEAVE_SCALE, nf1, catName, peakNote, planEditor } from "./sgShared.js";
import * as sgFilters from "./sgFilters.js";
import * as sgHero from "./sgHero.js";
import * as sgSummary from "./sgSummary.js";
import * as sgFullTable from "./sgFullTable.js";
import * as sgDetail from "./sgDetail.js";
import * as sgStretch from "./sgStretch.js";
import * as sgPath from "./sgPath.js";
import * as sgCharts from "./sgCharts.js";
import * as sgFocus from "./sgFocus.js"; // (update 470) the Focus view
/** (update 523) the DP World Tour (its file: one value an event, repeated on each round) */
export const isDpwt = (t) => /^(dpwt|dp world tour)$/i.test(String(t || "").trim());

export function sgDashboard(container, opts) {
  // (sgDashboard split) S: what the section modules read and write of this page's state and helpers, live
  const S = {
    get avgOf() { return avgOf; },
    get barChart() { return barChart; },
    get barFill() { return barFill; },
    get baseOptions() { return baseOptions; },
    get better() { return better; },
    get byBest() { return byBest; },
    get CAT_NAME() { return CAT_NAME; },
    get catsAvail() { return catsAvail; },
    get catsName() { return catsName; },
    get centerRankings() { return centerRankings; },
    get chartBox() { return chartBox; },
    get charts() { return charts; },
    get chartSeq() { return chartSeq; }, set chartSeq(v) { chartSeq = v; },
    get chipBtn() { return chipBtn; },
    get CLUB_GROUPS() { return CLUB_GROUPS; },
    get clubOptions() { return clubOptions; },
    get cmpDetailOK() { return cmpDetailOK; },
    get cmpSeen() { return cmpSeen; }, set cmpSeen(v) { cmpSeen = v; },
    get compareName() { return compareName; },
    get compsToggle() { return compsToggle; },
    get container() { return container; },
    get curMost() { return curMost; }, set curMost(v) { curMost = v; },
    get curPeak() { return curPeak; },
    get dateTxt() { return dateTxt; },
    get def() { return def; },
    get describe() { return describe; },
    get distsIn() { return distsIn; },
    get draw() { return draw; },
    get eliteOf() { return eliteOf; },
    get eventsOf() { return eventsOf; },
    get eventsPopup() { return eventsPopup; },
    get facet() { return facet; },
    get FEW() { return FEW; },
    get field() { return field; },
    get fieldAll() { return fieldAll; },
    get fieldIsSummary() { return fieldIsSummary; },
    get filterBar() { return filterBar; },
    get finishesPopup() { return finishesPopup; },
    get fmtDelta() { return fmtDelta; },
    get fmtRel() { return fmtRel; },
    get fmtV() { return fmtV; },
    get followClubs() { return followClubs; },
    get formPopup() { return formPopup; },
    get fullStatTable() { return fullStatTable; },
    get GEAR_ORDER() { return GEAR_ORDER; },
    get groupBy() { return groupBy; },
    get heroBox() { return heroBox; },
    get heroChart() { return heroChart; },
    get heroHypo() { return heroHypo; }, set heroHypo(v) { heroHypo = v; },
    get hideCompsNow() { return hideCompsNow; }, set hideCompsNow(v) { hideCompsNow = v; },
    get higherBetter() { return higherBetter; },
    get htmlBarStyle() { return htmlBarStyle; },
    get idx() { return idx; },
    get insightsButton() { return insightsButton; },
    get isSG() { return isSG; },
    get isZero() { return isZero; },
    get keptOf() { return keptOf; },
    get ladderRows() { return ladderRows; },
    get lastRankF() { return lastRankF; },
    get lastSig() { return lastSig; },
    get lastSliced() { return lastSliced; },
    get lastTap() { return lastTap; }, set lastTap(v) { lastTap = v; },
    get LINE_COLOR() { return LINE_COLOR; },
    get longestStretches() { return longestStretches; },
    get me() { return me; },
    get metric() { return metric; },
    get minDefault() { return minDefault; },
    get minRoundsBox() { return minRoundsBox; },
    get minRoundsFor() { return minRoundsFor; },
    get missBar() { return missBar; },
    get mix() { return mix; },
    get multi() { return multi; },
    get myFinishes() { return myFinishes; },
    get narrowed() { return narrowed; },
    get narrowedNow() { return narrowedNow; },
    get NM() { return NM; },
    get nz() { return nz; },
    get openRow() { return openRow; },
    get opts() { return opts; },
    get optsOnce() { return optsOnce; },
    get ordinal() { return ordinal; },
    get othersAvg() { return othersAvg; },
    get panelBox() { return panelBox; },
    get pathBack() { return pathBack; },
    get peakCtx() { return peakCtx; },
    get peakOf() { return peakOf; },
    get perRd() { return perRd; },
    get perRoundOf() { return perRoundOf; },
    get pickable() { return pickable; },
    get popup() { return popup; },
    get PROD_COLORS() { return PROD_COLORS; },
    get PROD_FOR() { return PROD_FOR; },
    get PROD_KINDS() { return PROD_KINDS; },
    get productTrend() { return productTrend; },
    get profileLine() { return profileLine; },
    get profileLine0() { return profileLine0; },
    get PTYPE() { return PTYPE; },
    get rampOf() { return rampOf; },
    get rampStops() { return rampStops; },
    get RANK_TOPS() { return RANK_TOPS; },
    get rankAmong() { return rankAmong; },
    get rankChart() { return rankChart; },
    get rankedField() { return rankedField; },
    get rankHistory() { return rankHistory; },
    get rankingsBlock() { return rankingsBlock; },
    get rankOf() { return rankOf; },
    get rankPopup() { return rankPopup; },
    get rankScroll() { return rankScroll; }, set rankScroll(v) { rankScroll = v; },
    get rankShut() { return rankShut; }, set rankShut(v) { rankShut = v; },
    get relCls() { return relCls; },
    get relOn() { return relOn; },
    get rollingOnly() { return rollingOnly; },
    get roundsTable() { return roundsTable; },
    get roundVals() { return roundVals; },
    get rowMemo() { return rowMemo; },
    get rowVals() { return rowVals; },
    get rw() { return rw; },
    get scatterChart() { return scatterChart; },
    get SCORING_KEYS() { return SCORING_KEYS; },
    get sdOf() { return sdOf; },
    get selectStretch() { return selectStretch; },
    get setRange() { return setRange; },
    get sgBreakdown() { return sgBreakdown; },
    get sgEligible() { return sgEligible; },
    get sgWord() { return sgWord; },
    get shortDay() { return shortDay; },
    get showCls() { return showCls; },
    get showRanks() { return showRanks; },
    get showV() { return showV; },
    get signCls() { return signCls; },
    get sliceOnce() { return sliceOnce; },
    get soloTour() { return soloTour; },
    get st() { return st; },
    get starred() { return starred; },
    get statDetail() { return statDetail; },
    get statKey() { return statKey; },
    get statList() { return statList; },
    get statMatrix() { return statMatrix; },
    get statSummary() { return statSummary; },
    get statTrend() { return statTrend; },
    get steadinessLine() { return steadinessLine; },
    get steadyBand() { return steadyBand; },
    get stretchesBlock() { return stretchesBlock; },
    get stretchesMemo() { return stretchesMemo; },
    get stretchPopup() { return stretchPopup; },
    get stretchSeq() { return stretchSeq; },
    get T2G() { return T2G; },
    get tapPill() { return tapPill; },
    get topMean() { return topMean; },
    get topPlayers() { return topPlayers; },
    get tourBlocks() { return tourBlocks; },
    get tourButtons() { return tourButtons; },
    get tourCounts() { return tourCounts; },
    get tourName() { return tourName; },
    get tournamentsPopup() { return tournamentsPopup; },
    get unit() { return unit; },
    get eventView() { return eventView; }, // (update 523: DP World Tour data: one value an event, shown event by event)
    get Unit() { return Unit; },
    get updatedTxt() { return updatedTxt; },
    get yearOf() { return yearOf; },
    get yearsRow() { return yearsRow; },
  };
  const { idx, mode } = opts;
  const ranksAllowed = opts.rankings !== false && !opts.entered; // (update 183: entered rounds are never ranked, no wins or top 10s)
  let showRanks = ranksAllowed;
  // (update 307) a tour that's only the player's own entered rounds (Practice, or a tour they typed in): just them,
  // no comparison dots and no rankings
  let soloTour = false;
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
  let unit = "round", eventView = false, lastTourSeen, lastYearsSeen; // (update 568: lastYearsSeen) // (update 538: the tour last shown)
  let sgEligible = null, sgMinR = 1; // the players ranked for every stat (see draw)
  const rw = (n) => `${Number(n).toLocaleString()} ${unit}${n === 1 ? "" : "s"}`;
  const Unit = () => (unit === "event" ? "Events" : "Rounds");
  const isSG = () => statKey === "sg";
  // (another stat: a round counts only where it has a value in the selection, e.g. an approach for Hit Green %)
  const nz = (rs) => (isSG() ? rs : rs.filter((rd) => rd.shots.length));
  let facet = { picked: [], events: [], sessions: [] }; // the Filters panel's lists (see draw)
  let sliceMemo = { src: null, key: null, val: null }; // (update 328)
  // (update 328) the filter choices (years, tours, lies, distances …): over a whole field that's every shot, so they're
  // kept per selection while the data is the same
  let optMemo = { src: null, m: new Map() };
  const optsOnce = (key, make) => {
    const src = me ? meAll : fieldAll;
    if (optMemo.src !== src) optMemo = { src, m: new Map() };
    if (!optMemo.m.has(key)) { if (optMemo.m.size > 40) optMemo.m.clear(); optMemo.m.set(key, make()); }
    return optMemo.m.get(key);
  };
  const sliceMemos = new Map(); // (update 328) other slices of the field (the hero's tiles), kept while the filters don't change
  function sliceOnce(name, fl) {
    const key = `${statKey}|${soloTour ? me?.key : ""}|${JSON.stringify(fl)}`, m = sliceMemos.get(name);
    if (m && m.src === fieldAll && m.key === key) return m.val;
    const val = field.map((p) => ({ ...p, rounds: nz(applyFilters(p.rounds, fl)) }));
    sliceMemos.set(name, { src: fieldAll, key, val });
    return val;
  }
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
  function careerBox(only = "conditions", f = null) {
    if (!meAll || opts.practice || opts.emptyNote || !isSG()) return null;
    const tours = !opts.entered && st.tour?.length ? new Set(st.tour) : null;
    let rs = statRounds(meAll.rounds, "sg").filter((rd) => !tours || tours.has(rd.tour || ""));
    let cols = null;
    if (only === "trajectory" && f) {
      // (update 283) the filters apply (all but the dates: this is about how the latest rounds compare with the ones
      // before them); one category picked: its total, then each of its distances
      rs = applyFilters(rs, { ...f, year: [], months: 0 });
      if (st.cats.length === 1) {
        const c = st.cats[0], name = CATEGORIES.find(([k]) => k === c)?.[1] || c;
        const bands = (st.dist.length ? st.dist.filter((d) => d.startsWith(`${c}|`)).map((d) => d.slice(c.length + 1)) : filterOptions(rs, [c]).dist);
        cols = [["TOTAL", "Total", `SG: ${name}`], ...bands.map((d) => [`d:${d}`, d, `${name}: ${d}`])];
      } else if (st.cats.length > 1) {
        cols = [["TOTAL", "Total", "SG: Total (these categories)"], ...CATEGORIES.filter(([k]) => st.cats.includes(k)).map(([k, l]) => [k, k, l])];
      }
    } else if (st.gear?.length) rs = applyFilters(rs, { gear: st.gear }); // (update 219: a product picked: only its shots, in the rounds it was used)
    const blocks = careerBlocks(rs, { key: meAll.key, source: opts.entered ? "entered" : "tour", ui: careerUi, redraw: () => draw(), only, cols, byEvent: eventView }); // (update 581: the DP World Tour: by event)
    return blocks.length ? el("div", { class: "cmp career" }, blocks) : null;
  }
  let heroHypo = null; // (update 445: Hypothetical rankings, shown in the hero card)
  function draw() {
    heroHypo = null;
    if (st.vsRank && st.vsRank !== "peak") st.vsRank = null; // (update 330: the #N player comparisons are gone)
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
    // (update 523) the DP World Tour's file has one value an event (repeated on each of its rounds): no round-by-round views
    eventView = unit === "round" && (isDpwt(st.tour?.[0]) || (base.length > 0 && base.every((rd) => isDpwt(rd.tour))));
    if ((unit === "event" || eventView) && st.trendBy === "round") st.trendBy = "event";
    // the categories this stat has (strokes gained: all four; Make %: Putting only; Scoring Avg: none)
    const catSeen = new Set(); for (const rd of base) for (const x of rd.shots) if (x.cat) catSeen.add(x.cat);
    catsAvail = CATEGORIES.filter(([k]) => catSeen.has(k));
    if (opts.entered && !base.length && statKey === "sg") catsAvail = CATEGORIES; // (entered rounds / practice with nothing yet: the filters still show)
    st.cats = st.cats.filter((k) => catSeen.has(k));
    // Keep only choices that still exist: distances of the picked categories, lies seen in them.
    if (st.cats.length) st.dist = st.dist.filter((d) => st.cats.includes(d.split("|")[0]));
    const baseSig = `${me ? `me:${me.key}` : "field"}|${statKey}`; // (update 328: the choices are worked out once per selection)
    const fullOpt = optsOnce(`full|${baseSig}|${st.cats.join(",")}`, () => filterOptions(base, st.cats));
    if (!st.yearStarted && fullOpt.year.length) { st.yearStarted = true; if (!st.year.length) st.year = [[...fullOpt.year].sort().pop()]; } // the latest year to start
    // One tour at a time (each tour's numbers come from its own source and scale, so they're never mixed).
    // A player starts on the tour they have the most rounds on; with no player, the PGA TOUR (or the biggest).
    const tourCount = new Map(); for (const rd of base) tourCount.set(rd.tour || "", (tourCount.get(rd.tour || "") || 0) + 1);
    const tourList = [...tourCount.keys()];
    // (update 527) the tour buttons: most rounds first, counted in the years picked (what the page shows), then over every year
    const yrSet = st.year?.length ? new Set(st.year.map(String)) : null, inYrs = new Map();
    if (yrSet) for (const rd of base) if (yrSet.has(String(rd.year ?? String(rd.date || "").slice(0, 4)))) inYrs.set(rd.tour || "", (inYrs.get(rd.tour || "") || 0) + 1);
    tourCounts = [...tourCount].sort((a, b) => (inYrs.get(b[0]) || 0) - (inYrs.get(a[0]) || 0) || b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); // for the tour buttons
    if (tourList.length > 1 || (tourList.length === 1 && tourList[0] !== "")) {
      const who = me?.key ?? "__field";
      if (st.tourFor !== who || !tourList.includes(st.tour?.[0])) {
        st.tourFor = who;
        const byRounds = [...tourCount].sort((a, b) => b[1] - a[1]).map(([t]) => t);
        const pga = !me && tourList.find((t) => /^pga(\s*tour)?$/i.test(String(t).trim()));
        st.tour = [pga || byRounds[0]];
      } else st.tour = [st.tour[0]];
    } else st.tour = [];
    // (update 538) the tour on screen: remembered (the lie / distance detail loads only that tour's files), and the page
    // that drew this told when it changes, to load the new tour's
    if (st.tour[0] != null && st.tour[0] !== lastTourSeen) {
      const t = st.tour[0]; lastTourSeen = t;
      import("./fieldStore.js").then((m) => m.setActiveTour(t)).catch(() => {});
      if (opts.onTour) setTimeout(() => opts.onTour(t), 0); // (the page compares it with the tour it loaded)
    }
    // (update 568) the seasons picked: the page told too (its lie / distance detail covers only the seasons on screen); it
    // compares its key first, so nothing reloads unless they changed
    { const yk = JSON.stringify([...(st.year || [])].map(String).sort()); if (yk !== lastYearsSeen) { const first = lastYearsSeen === undefined; lastYearsSeen = yk; if (!first && opts.onTour) setTimeout(() => opts.onTour(st.tour[0] ?? null), 0); } }
    soloTour = !!(me && st.tour.length && (/^practice$/i.test(String(st.tour[0]).trim())
      || ![...me.rounds, ...field.flatMap((p) => p.rounds)].some((rd) => !rd.entered && (rd.tour || "") === st.tour[0])));
    showRanks = ranksAllowed && !soloTour;
    if (soloTour) field = field.filter((p) => p.key === me.key);
    // Linked filters (update 166): each dropdown lists only what the other picks leave (the tour's courses,
    // a tournament's course, the last month's tournaments). A pick that's no longer there goes.
    const roundPicks = () => ({ months: Number(st.span), from: st.dateRange?.from, to: st.dateRange?.to, year: st.year, tour: st.tour, event: opts.practice ? [] : st.event, course: st.course, roundNo: st.roundNo, ptype: st.ptype });
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
    const opt = { ...optsOnce(`picked|${baseSig}|${st.cats.join(",")}|${JSON.stringify(roundPicks())}`, () => filterOptions(picked, st.cats)), year: fullOpt.year, tour: fullOpt.tour, course: courseList, roundNo: roundList };
    facet = { picked, events: opts.practice ? [] : eventOptions(leaving("event")), sessions: opts.practice ? sessionOptions(leaving("ptype")) : [] };
    st.lie = st.lie.filter((l) => opt.lie.includes(l));
    st.club = st.club.filter((c) => opt.club.includes(c));
    st.gear = st.gear.filter((c) => opt.gear.includes(c));
    const f = { months: Number(st.span), from: st.dateRange?.from, to: st.dateRange?.to, year: st.year, tour: st.tour, event: st.event, course: st.course, roundNo: st.roundNo, cats: st.cats, lie: st.lie, dist: st.dist, club: st.club, gear: st.gear, ptype: st.ptype };
    // Rankings from the shared summary can't follow lie / distance / club.
    const rankF = fieldIsSummary() ? { ...f, lie: [], dist: [], club: [], gear: [] } : f; // (update 219: nor product)
    lastRankF = rankF;
    // (update 328) the field sliced by the filters: kept while the filters stay the same, so a tap that doesn't change
    // them (a rank comparison, Personal Peak, a chart toggle) reuses it and everything worked out from it
    const sliceKey = `${statKey}|${soloTour ? me?.key : ""}|${JSON.stringify(rankF)}`;
    const slicedField = sliceMemo.src === fieldAll && sliceMemo.key === sliceKey ? sliceMemo.val
      : (sliceMemo = { src: fieldAll, key: sliceKey, val: field.map((p) => ({ ...p, rounds: nz(applyFilters(p.rounds, rankF)) })) }).val;
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
    // (update 471) Focus: every shot of the rounds in the time frame (its own pills pick the parts of the game), against
    // the field over the same rounds
    const focusOn = !!(me && isSG() && !opts.emptyNote && st.view2 === "focus"); // (update 505: Full stats unless Focus is picked)
    const noShotF = { ...f, cats: [], lie: [], dist: [], club: [], gear: [] };
    const focusMine = focusOn ? nz(applyFilters(me.rounds, noShotF)) : null;
    const focusField = focusOn ? field.map((p) => ({ ...p, rounds: nz(applyFilters(p.rounds, { ...rankF, cats: [], lie: [], dist: [], club: [], gear: [] })) })) : null;
    peakCtx = { mine: mine || [], cat: st.cats.length === 1 ? st.cats[0] : "" }; // (update 308: Personal Peak dots)
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
      // (update 471) a player's strokes gained: Focus / Full stats first; Focus has its own part-of-the-game pills
      // in place of the filters
      focusOn ? sgFocus.focusSwitch(S) : me && isSG() && !opts.emptyNote ? sgFocus.focusSwitch(S) : null,
      focusOn ? null : filtersPanel(opt),
      focusOn ? null : rangeChip(), // (update 322)
      el("div", { class: "sg-panel" }, (() => {
        // nothing to show (no player picked, or no rounds yet): the same Filters panel, and why it's empty
        if (opts.emptyNote) return [el("section", { class: "panel sg-empty-note" }, el("p", { class: "empty center" }, opts.emptyNote))];
        if (!isSG()) return statBlocks(mine, slicedField, f);
        if (!me && st.statWanted === "stretch") return [stretchBoard(slicedField)]; // (update 332: the Leaderboards' Best Stretches)
        if (!me && st.statWanted === "form1") return [formBoard(slicedField)]; // (update 333: #1 Form)
        // (update 470) a player's strokes gained: Focus (the short story) or Full stats (everything), switched at the top
        if (focusOn) return sgFocus.focusView(S, focusMine, focusField, f, nz(applyFilters(me.rounds, { tour: f.tour }))); // (update 611: every year, for the radar)
        // The rankings are always the first thing (Stat Averages and the charts follow).
        const blocks = me ? detailBlocks(mine, slicedField) : [];
        // (update 205) "Getting better or worse?" right under the hero card
        // (update 370) the stats table right under the hero card, above "Getting better or worse?"
        // (update 379) the Summary right under the hero card, above the stats table
        return [heroBox(mine, slicedField, f), me ? summaryBox(mine, slicedField) : null, blocks[0] || null, careerBox("trajectory", f), ...blocks.slice(1), ...(!me ? tourBlocks(slicedField) : [])];
      })()),
      // (update 219) "Where they play their best" is on the Compare page now
    ]);
    // (update 326) a drop-down isn't focused again after its pick redraws the page: on a phone that opened its list a
    // second time (so a stat took two picks)
    if (focusKey && focusTag !== "SELECT") {
      const again = [...container.querySelectorAll(focusTag || "*")].find((n) => (n.getAttribute("aria-label") || n.textContent).trim() === focusKey);
      again?.focus({ preventScroll: true });
    }
    const openList = container.querySelector(".ms-panel:not([hidden]) .ms-options");
    if (openList) openList.scrollTop = panelScroll;
    window.scrollTo(0, y);
    requestAnimationFrame(() => { container.style.minHeight = ""; window.scrollTo(0, y); });
    centerRankings();
  }
  function multi(...a) { return sgFilters.multi(S, ...a); }

  // Clubs nested under their bag group (Driver, Fairway Wood, Hybrid, Iron, Wedge, Putter), each with the
  // brand / model you used it as, e.g. "7i · Titleist T100".
  const CLUB_GROUPS = ["Driver", "Fairway Wood", "Hybrid", "Iron", "Wedge", "Putter", "Other"];
  const GEAR_ORDER = ["Driver", "Non-Driver", "Fairway Wood", "Hybrid", "Iron", "Wedge", "Putter", "Other", "Golf Ball"];
  function clubOptions(...a) { return sgFilters.clubOptions(S, ...a); }
  function followClubs(...a) { return sgFilters.followClubs(S, ...a); }
  function eventOptions(...a) { return sgFilters.eventOptions(S, ...a); }
  // Practice's Session filter: Custom practice, Course Prep, Sim rounds and each game.
  const PTYPE = { custom: "Custom practice", prep: "Course Prep", sim: "Sim rounds" };
  function sessionOptions(...a) { return sgFilters.sessionOptions(S, ...a); }
  function filterBar(...a) { return sgFilters.filterBar(S, ...a); }
  // Category pills: pick one or several (e.g. Off-the-Tee + Approach + Around-the-Green = tee to green).
  // "All" clears the choice; picking all four is the same as All.
  const CAT_NAME = Object.fromEntries(CATEGORIES);
  function filtersPanel(...a) { return sgFilters.filtersPanel(S, ...a); }
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
  function heroBox(...a) { return sgHero.heroBox(S, ...a); }
  /* ---------------- the hero card's pills and pop-ups (update 159) ---------------- */
  const chipBtn = (cls, text, title, onClick) => {
    const b = el("button", { type: "button", class: `${cls} chip-btn`, title, "aria-haspopup": "dialog" }, text);
    b.addEventListener("click", onClick);
    return b;
  };
  function popup(...a) { return sgHero.popup(S, ...a); }
  const yearOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const dateTxt = (d) => { const b = new Date(d); return isNaN(b) ? d || "" : b.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" }); };
  const better = (a, b) => (higherBetter() ? a > b : a < b);
  // a change or a spread in the stat's own units (a percentage's in points)
  const fmtDelta = (v) => (isSG() ? Math.abs(v).toFixed(2) : fmtStat({ ...def, unit: def.pct ? "" : def.unit, pct: false, dp: def.pct ? 1 : def.dp }, Math.abs(v)) + (def.pct ? " pct" : ""));
  const sdOf = (a) => { if (a.length < 2) return null; const m = a.reduce((t, x) => t + x, 0) / a.length; return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)); };
  const roundVals = (rs) => rs.map((rd) => metric([rd])).filter((v) => v != null && Number.isFinite(v));
  function steadinessLine(...a) { return sgHero.steadinessLine(S, ...a); }
  // (update 445) a set of rounds by part of the game, a round each, each part opening to its distances (strokes gained)
  const distsIn = (rs, c) => { const m = new Map(); for (const rd of rs) for (const x of rd.shots || []) if (x.cat === c && x.dist) m.set(x.dist, 1); return [...m.keys()].sort((a, b) => distLead(a) - distLead(b) || a.localeCompare(b)); };
  const perRd = (rs, c = null, d = null) => (rs.length ? rs.reduce((t, rd) => t + (rd.shots || []).reduce((u, x) => u + ((!c || x.cat === c) && (!d || x.dist === d) ? x.sg || 0 : 0), 0), 0) / rs.length : null);
  const sgBreakdown = (rs) => el("div", { class: "bs-rd" }, CATEGORIES.filter(([c]) => rs.some((rd) => (rd.shots || []).some((x) => x.cat === c))).flatMap(([c, l]) => {
    const v = perRd(rs, c), ds = distsIn(rs, c);
    const subs = ds.map((d) => { const dv = perRd(rs, c, d); return el("div", { class: "bs-rd-row sub", style: "display:none" }, [el("span", { class: "bs-rd-l" }, d), el("span", { class: `bs-rd-v ${dv >= 0 ? "pos" : "neg"}` }, sgn2(dv))]); });
    const caret = ds.length ? el("span", { class: "cmp-caret" }, "\u25B8 ") : null;
    const row = el("button", { type: "button", class: "bs-rd-row", "aria-expanded": "false", disabled: !ds.length }, [el("span", { class: "bs-rd-l" }, [caret, l]), el("span", { class: `bs-rd-v ${v >= 0 ? "pos" : "neg"}` }, sgn2(v))]);
    row.addEventListener("click", (e) => { e.stopPropagation(); const open = row.getAttribute("aria-expanded") !== "true"; row.setAttribute("aria-expanded", String(open)); if (caret) caret.textContent = open ? "\u25BE " : "\u25B8 "; subs.forEach((x) => { x.style.display = open ? "" : "none"; }); });
    return [row, ...subs];
  }));
  // a table row that opens to a detail row under it
  const openRow = (tr, ncol, detailOf) => {
    const det = el("tr", { class: "bs-st-det", hidden: true }, el("td", { colspan: ncol }, ""));
    const caret = el("span", { class: "cmp-caret" }, "\u25B8 "); tr.firstChild?.prepend(caret);
    tr.classList.add("bs-st-tap"); tr.setAttribute("role", "button"); tr.setAttribute("tabindex", "0"); tr.setAttribute("aria-expanded", "false");
    let built = false;
    const flip = () => { const open = tr.getAttribute("aria-expanded") !== "true"; tr.setAttribute("aria-expanded", String(open)); caret.textContent = open ? "\u25BE " : "\u25B8 "; if (open && !built) { built = true; det.firstChild.replaceChildren(detailOf()); } det.hidden = !open; };
    tr.addEventListener("click", flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    return [tr, det];
  };
  const roundsTable = (rs, { rank = null } = {}) => el("table", { class: "plain rankings hero-tourn" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), unit === "event" ? null : el("th", { class: "num" }, "Rd"), el("th", { class: "num" }, isSG() ? "SG" : def.label), rank ? el("th", { class: "num" }, "Rank") : null])),
    el("tbody", {}, rs.flatMap((rd) => { const v = metric([rd]); const tr = el("tr", {}, [el("td", { class: "ht-date" }, dateTxt(rd.date)), el("td", { class: "ht-name" }, rd.event || "\u2014"),
      unit === "event" ? null : el("td", { class: "num" }, rd.roundNo || "\u2014"), el("td", { class: `num ${isSG() ? signCls(v) : ""}` }, fmtV(v)), rank ? rank(rd) : null]);
      // (update 445) a round opens to its parts of the game, each to its distances
      return isSG() && (rd.shots || []).some((x) => x.cat) ? openRow(tr, rank ? 5 : 4, () => sgBreakdown([rd])) : [tr]; })),
  ]);
  function formPopup(...a) { return sgHero.formPopup(S, ...a); }
  function eventsOf(...a) { return sgHero.eventsOf(S, ...a); }
  function myFinishes(...a) { return sgHero.myFinishes(S, ...a); }
  function finishesPopup(...a) { return sgHero.finishesPopup(S, ...a); }
  // the Rankings table, in a pop-up (Min. rounds there redraws the page and opens it again)
  let rankShut = null; // (only one rankings pop-up at a time)
  function rankPopup(...a) { return sgHero.rankPopup(S, ...a); }
  function tournamentsPopup(...a) { return sgHero.tournamentsPopup(S, ...a); }
  function eventsPopup(...a) { return sgHero.eventsPopup(S, ...a); }
  function insightsButton(...a) { return sgHero.insightsButton(S, ...a); }
  function rollingOnly(...a) { return sgHero.rollingOnly(S, ...a); }
  function rankHistory(...a) { return sgHero.rankHistory(S, ...a); }
  function rankChart(...a) { return sgHero.rankChart(S, ...a); }
  function heroChart(...a) { return sgHero.heroChart(S, ...a); }

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
    const top = el("div", { class: "pill-row years-row stats-pills" }, [lead, yearPills(opt)]); // (update 522: no Tour filter here; the tour buttons on the player card still switch it)
    const stat = statSelect();
    const bottom = cats || stat ? el("div", { class: "pill-row stats-pills stats-row2" }, [stat, cats ? catPills() : null, catDrop]) : null; // (update 229: Relative / Raw moved to the stats table)
    return el("div", { class: "stats-rows" }, [top, bottom]);
  };
  const tourName = (t) => t || "No tour";
  function tourPills(...a) { return sgFilters.tourPills(S, ...a); }
  function statSelect(...a) { return sgFilters.statSelect(S, ...a); }
  function tourButtons(...a) { return sgFilters.tourButtons(S, ...a); }
  function groupBy(...a) { return sgFilters.groupBy(S, ...a); }

  // Year pills (under the categories): All, or any number of years.
  // Pills:
  //   tap a pill that isn't picked → pick just it (plus any kept 🔒 pills)
  //   tap a picked pill → un-pick it;  tap a kept pill → unlock it (it stays picked)
  //   double-tap → keep it (🔒), so the next taps add to it
  let lastTap = null; // { key, value, at, was: "kept" | "on" | "off" } (pills are redrawn on every tap, so remember by value)
  function tapPill(...a) { return sgFilters.tapPill(S, ...a); }
  const keptOf = (key) => (st[`${key}Kept`] || []).filter((v) => st[key].includes(v));
  function yearPills(...a) { return sgFilters.yearPills(S, ...a); }
  function catPills(...a) { return sgFilters.catPills(S, ...a); }
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
  function selectionStrip(...a) { return sgFilters.selectionStrip(S, ...a); }
  function rankOf(...a) { return sgSummary.rankOf(S, ...a); }
  function cards(...a) { return sgSummary.cards(S, ...a); }

  /* ------------------------------ the summary (top of the stats) ------------------------------ */
  // A few plain sentences about exactly what's on screen (the same rounds, filters and players as the
  // rankings and charts), so it changes with every filter. Calculated from the numbers.
  const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
  const isZero = (v) => v != null && Math.round(v * 100) === 0; // shows as +0.00
  const signCls = (v) => (isZero(v) ? "zero" : v >= 0 ? "pos" : "neg");
  const proMemo = new WeakMap(); // (update 328) rounds list → category → strokes gained a round
  const perRoundOf = (rounds, cat = null) => {
    if (!rounds.length) return null;
    let m = proMemo.get(rounds); if (!m) { m = new Map(); proMemo.set(rounds, m); }
    const k = cat || "";
    if (m.has(k)) return m.get(k);
    let t = 0; for (const rd of rounds) for (const x of rd.shots) if (!cat || x.cat === cat) t += x.sg;
    const v = t / rounds.length; m.set(k, v);
    return v;
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
  function relSeg(...a) { return sgSummary.relSeg(S, ...a); }
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
  function rankAmong(...a) { return sgSummary.rankAmong(S, ...a); }
  function summaryBox(...a) { return sgSummary.summaryBox(S, ...a); }

  /* ------------------------------ the whole tour (no player picked; update 142) ------------------------------ */
  // Category leaders (strokes gained), hot and cold form, the steadiest players, each tournament's best in the
  // field, and wins. Any stat (update 159): its own form, round-to-round swing, and who led the field in it.
  // (update 332) Best Stretches on the Leaderboards: each player's longest run of rounds in a row whose average would
  // rank #1 in this selection (by the strokes gained the filters are about), longest first
  /** (update 350) Every player's longest run of rounds in a row whose average beats the best of everyone else (a #1 level),
   * longest first. Kept per field and category (the Leaderboards table and the line under the Elite Round Share boxes). */
  const stretchesMemo = { src: null, map: new Map() };
  function longestStretches(...a) { return sgSummary.longestStretches(S, ...a); }
  function stretchBoard(...a) { return sgSummary.stretchBoard(S, ...a); }
  function formBoard(...a) { return sgSummary.formBoard(S, ...a); }
  function tourBlocks(...a) { return sgSummary.tourBlocks(S, ...a); }

  /* (update 227/228) the stats table for one category, like Compare's Side by side, for this player: the value, their
     rank in the field, their trend (last 10 rounds against the 10 before), their best round, and the players compared
     (Top 1 / 10 / 25 / 50 / All: the pills on top, which also set the gold dots on the charts) */
  const rowMemo = new WeakMap();
  const SCORING_KEYS = ["scoring", "par3", "par4", "par5"];
  function rowVals(...a) { return sgFullTable.rowVals(S, ...a); }
  function fullStatTable(...a) { return sgFullTable.fullStatTable(S, ...a); }
  function detailBlocks(...a) { return sgDetail.detailBlocks(S, ...a); }
  function statBlocks(...a) { return sgDetail.statBlocks(S, ...a); }
  const avgOf = (vals) => { const v = vals.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  function statSummary(...a) { return sgDetail.statSummary(S, ...a); }
  function statDetail(...a) { return sgDetail.statDetail(S, ...a); }
  function statMatrix(...a) { return sgDetail.statMatrix(S, ...a); }
  function statTrend(...a) { return sgDetail.statTrend(S, ...a); }

  /* ------------------------------ rankings ------------------------------ */
  let rankScroll = null;
  // Min. rounds: until you set it, 25% of the most rounds anyone listed has played (rounded)
  // Min. rounds follows the selection (update 158): a filter that lowers the most rounds anyone has (Round 4
  // only, one tournament, ...) lowers it too. Until you set it: the default share of the most rounds. Once
  // you set it: the same share of the most rounds as when you set it (40 of 80 is 10 of 20).
  let curMost = 0;
  const minDefault = (most) => (most >= 15 ? defaultMinRounds(most) : Math.max(1, Math.floor(most * 0.33)));
  function minFor(...a) { return sgDetail.minFor(S, ...a); }
  const minRoundsFor = (players) => {
    if (sgEligible) return sgMinR; // (strokes-gained rounds decide, for every stat)
    return minFor(Math.max(0, ...players.map((p) => p.rounds.length)));
  };
  function minRoundsBox(...a) { return sgDetail.minRoundsBox(S, ...a); }
  function rankingsBlock(...a) { return sgDetail.rankingsBlock(S, ...a); }
  function centerRankings(...a) { return sgDetail.centerRankings(S, ...a); }

  /* ------------------------------ building blocks ------------------------------ */
  // (update 210) SG by Club: strokes gained a round with each club model (brand + model), best first.
  // A model with only a few rounds is marked, so 3 rounds isn't read like 60.
  const FEW = 10;
  /* (update 299) SG Trends with Show Product: one kind of product (pills; one always picked), each bar coloured by the
     model used most in it, a legend on top, the products in the tap-up. Off-the-Tee's Driver / Non-Driver / Irons
     are its Tee Shot (Driver) / (Wood) / (Iron) shots. */
  const PROD_KINDS = { Driver: ["Driver"], "Non-Driver": ["Non-Driver", "Fairway Wood", "Hybrid"], Irons: ["Iron"], Wedges: ["Wedge"], Putters: ["Putter"], Balls: ["Ball"] };
  const PROD_FOR = { "": ["Driver", "Non-Driver", "Irons", "Wedges", "Putters", "Balls"], PUTT: ["Putters", "Balls"], OTT: ["Driver", "Non-Driver", "Irons", "Balls"],
    APP: ["Non-Driver", "Irons", "Wedges", "Balls"], ARG: ["Wedges", "Irons", "Balls"] };
  const PROD_COLORS = ["#d4b483", "#2f9bff", "#30d158", "#ff9f0a", "#bf5af2", "#ff453a", "#64d2ff", "#ffd60a", "#ac8e68", "#5e5ce6", "#ff6482", "#a2845e"];
  function productTrend(...a) { return sgDetail.productTrend(S, ...a); }
  function sgByClubBox(...a) { return sgDetail.sgByClubBox(S, ...a); }
  function panelBox(...a) { return sgDetail.panelBox(S, ...a); }
  // Rank filter for the dashed comparison: everyone, or just the top 1 / 10 / 25 / 50 players by SG / round.
  const RANK_TOPS = [["1", "Top 1"], ["10", "Top 10"], ["25", "Top 25"], ["50", "Top 50"], ["all", "All"]];
  function topPlayers(...a) { return sgStretch.topPlayers(S, ...a); }
  const vsNum = () => { const v = st.vsRank && st.vsRank !== "peak" ? st.vsRank : st.rankTop && st.rankTop !== "all" ? st.rankTop : null; return v ? Number(v) : null; };
  function refPlayer(...a) { return sgStretch.refPlayer(S, ...a); }
  function peakOf(...a) { return sgStretch.peakOf(S, ...a); }
  function eliteOf(...a) { return sgStretch.eliteOf(S, ...a); }
  let peakCtx = null, peakMemo = null;
  const curPeak = () => {
    if (!peakCtx?.mine?.length) return null;
    const n = Math.max(1, Math.round(Number(st.peakN) || 10));
    const mode = st.peakMode === "stretch" ? "stretch" : "elite"; // (update 335: elite rounds, any order)
    if (peakMemo && peakMemo.mine === peakCtx.mine && peakMemo.cat === peakCtx.cat && peakMemo.n === n && peakMemo.mode === mode) return peakMemo.pk;
    const pk = mode === "elite" ? eliteOf(peakCtx.mine, peakCtx.cat, n) : peakOf(peakCtx.mine, peakCtx.cat, n);
    peakMemo = { mine: peakCtx.mine, cat: peakCtx.cat, n, pk, mode };
    return pk;
  };
  function setRange(...a) { return sgStretch.setRange(S, ...a); }
  function rangeChip(...a) { return sgStretch.rangeChip(S, ...a); }
  function peakNeeded(...a) { return sgStretch.peakNeeded(S, ...a); }
  const cmpDetailOK = () => !fieldIsSummary() || (st.vsRank === "peak" && !soloTour); // (lie / distance dots need full rows: the peak is the player's own)
  // what the gold dots are: on the trends, the best result(s) each round / event / month / year among the
  // players who played it; on the other charts, the best players over the selected time frame
  const compareName = (each = null) => {
    if (st.vsRank === "peak") { const n = Math.max(1, Math.round(Number(st.peakN) || 10)); return `Elite: best ${n} ${n === 1 ? "round" : "rounds"} (avg)`; }
    const n = st.rankTop && st.rankTop !== "all" ? st.rankTop : null;
    if (each) { const v0 = vsNum(); return v0 ? `#${v0} player each ${each}` : `All players each ${each} (avg)`; } // (update 309)
    const v = vsNum(); // (update 308) one player: the one ranked #N
    return v ? `#${v} player (avg)` : "All players (avg)";
  };
  // the best n of a set of results (lower is better for some stats), averaged
  const topMean = (vals, higher = true) => {
    const v = vals.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => (higher ? q - p : p - q));
    if (!v.length) return null;
    // (update 330) no other players' dots on the trends any more (only the selected stretch's, worked out on its own)
    return null;
  };
  const topName = () => (RANK_TOPS.find(([v]) => v === (st.rankTop || "all"))?.[1] || "All").replace(/^All$/, "All Players");
  function topPills(...a) { return sgStretch.topPills(S, ...a); }
  function stretchSeq(...a) { return sgStretch.stretchSeq(S, ...a); }
  function ladderRows(...a) { return sgStretch.ladderRows(S, ...a); }
  const shortDay = (d) => { const x = new Date(`${String(d || "").slice(0, 10)}T12:00:00`); return isNaN(x) ? String(d || "") : x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  function selectStretch(...a) { return sgStretch.selectStretch(S, ...a); }
  function whatWorked(...a) { return sgStretch.whatWorked(S, ...a); }
  function NM(...a) { return sgStretch.NM(S, ...a); }
  function stretchesBlock(...a) { return sgStretch.stretchesBlock(S, ...a); }
  function shotMix(...a) { return sgStretch.shotMix(S, ...a); }
  function whatHurts(...a) { return sgStretch.whatHurts(S, ...a); }
  function nextSteps(...a) { return sgStretch.nextSteps(S, ...a); }
  function stretchPopup(...a) { return sgStretch.stretchPopup(S, ...a); }
  function profileLine(...a) { return sgStretch.profileLine(S, ...a); }
  function profileLine0(...a) { return sgStretch.profileLine0(S, ...a); }
  function pathBack(...a) { return sgPath.pathBack(S, ...a); }
  function rankPicker(...a) { return sgCharts.rankPicker(S, ...a); }

  // A chart that draws itself once it's on the page. With a key, a small Bar | Line toggle sits in the
  // panel's corner; the choice is remembered per chart, and switching redraws just that chart.
  const BAR_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="8" width="3" height="6" rx="1"/><rect x="6.5" y="4" width="3" height="10" rx="1"/><rect x="11" y="6" width="3" height="8" rx="1"/></svg>';
  const LINE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,12 6,7 9.5,9.5 14,3.5"/></svg>';
  const lastSig = new Map(); // each chart's last data (so unchanged charts don't re-animate)
  let chartSeq = 0;
  let tourCounts = []; // [[tour, rounds]], most rounds first
  function chartBox(...a) { return sgCharts.chartBox(S, ...a); }
  // (update 308) the Hide Comps / Show Comps button in the top right of each chart card that has comparison dots
  let hideCompsNow = false, cmpSeen = false;
  function compsToggle(...a) { return sgCharts.compsToggle(S, ...a); }
  function baseOptions(...a) { return sgCharts.baseOptions(S, ...a); }
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
  function rampStops(...a) { return sgCharts.rampStops(S, ...a); }
  function barFill(...a) { return sgCharts.barFill(S, ...a); }
  /** The same scale for HTML bars (the leaderboard): the gradient spans the full track, the bar shows its part. */
  // width: on the shared scale; colour: on its own side's scale (brightest at the biggest gain / loss)
  const htmlBarStyle = (v, frac, colorFrac = frac) => {
    const [near, far] = rampOf(null, v);
    const w = Math.max(0.04, frac), cf = Math.max(0.04, colorFrac);
    return `width:${w * 100}%;background:linear-gradient(90deg, ${near}, ${far});background-size:${100 / cf}% 100%;background-repeat:no-repeat`;
  };
  function barChart(...a) { return sgCharts.barChart(S, ...a); }
  function scatterChart(...a) { return sgCharts.scatterChart(S, ...a); }
  function missBar(...a) { return sgCharts.missBar(S, ...a); }

  draw();
  return {
    destroy() { destroyCharts(); if (opts.viewHost) mount(opts.viewHost, null); if (opts.lead && opts.leadHome) { if (opts.lead.parentNode !== opts.leadHome) opts.leadHome.appendChild(opts.lead); } /* (the page shows them again if nothing else draws) */ if (opts.slot && opts.slotHome) opts.slotHome.appendChild(opts.slot); document.removeEventListener("pointerdown", onDocDown); document.removeEventListener("keydown", onKey); },
    update(next) { if ("me" in next) meAll = next.me; if ("field" in next) fieldAll = next.field || []; draw(); },
  };
}
