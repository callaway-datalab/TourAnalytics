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
import { drillFor, drillLine, practiceOpen, goalStatsFor, isMine } from "./practice/plan.js"; // (update 342)
// (update 353) the four levels, named for what they mean on Tour
const LEVELS = { 1: "Best on Tour", 10: "Contender", 25: "Tour Championship level", 50: "Signature event level" };
const PLAN_ADDED = new Set(); // drills in the player's practice plan (update 387: read from the plan itself)
const PLAN_SEEN = { key: null, at: 0, busy: false };
/* (update 345) Per shot or how often? A difference in strokes gained a round for a part of the game and distance splits
 * exactly in two (update 348: weighed by their usual per-shot level, U, over the whole time frame, so a strength or a weakness
 * is the same whichever rounds are compared):
 *    A attempts x (A per shot - U) - B attempts x (B per shot - U)   [playing it better]
 *  + (A attempts - B attempts) x U                                     [facing it more or less often]
 * So elite rounds can look better at something just because they had fewer of their weak shots (or more of their strong
 * ones): that's strategy (or the shot before), not practice. */
// keyed part of the game | distance (update 348: not split by lie, so the per-shot numbers shown are the ones split)
function bucketsOf(rs, pred = () => true) {
  const m = new Map();
  for (const rd of rs) for (const x of rd.shots) if (x.cat && pred(x)) { const k = `${x.cat}|${x.dist || ""}|`; const o = m.get(k) || m.set(k, { sg: 0, n: 0 }).get(k); o.sg += x.sg; o.n += x.w || 1; }
  return m;
}
/** The split for a group (every lie of "APP|100-140 yds", or every distance of "APP"), added up from its finest pieces. */
function groupSplit(bA, nA, bB, nB, match, bU = null) {
  const keys = [...new Set([...bA.keys(), ...bB.keys()])].filter(match);
  const t = sumSplit(keys.map((k) => splitOf(bA.get(k), nA, bB.get(k), nB, bU?.get(k))));
  const agg = (b) => keys.reduce((o, k) => { const x = b.get(k); if (x) { o.sg += x.sg; o.n += x.n; } return o; }, { sg: 0, n: 0 });
  const A = agg(bA), B = agg(bB);
  const U = bU ? agg(bU) : { sg: A.sg + B.sg, n: A.n + B.n };
  return { ...t, ae: A.n / nA, ab: B.n / nB, pe: A.n ? A.sg / A.n : 0, pb: B.n ? B.sg / B.n : 0, pu: U.n ? U.sg / U.n : 0 };
}
/** (update 356) one labelled line: a small label on the left, the value beside it */
const kv = (k, v, cls = "") => el("div", { class: `bs-kv ${cls}`.trim() }, [el("span", { class: "bs-k" }, k), el("span", { class: "bs-v" }, v)]);
const sgn2 = (v) => (Math.abs(v) < 0.005 ? "+0.00" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`);
function splitOf(a, nA, b, nB, u = null) {
  const ae = a ? a.n / nA : 0, ab = b ? b.n / nB : 0;
  const pe = a && a.n ? a.sg / a.n : 0, pb = b && b.n ? b.sg / b.n : 0;
  // their usual level on this shot (every round in the time frame), else the two sets together
  const pu = u && u.n ? u.sg / u.n : (a?.n || 0) + (b?.n || 0) ? ((a?.sg || 0) + (b?.sg || 0)) / ((a?.n || 0) + (b?.n || 0)) : 0;
  const mix = (ae - ab) * pu;
  // (update 346) "how often" in two: a shot they usually gain on (a strength) faced more or less often, or one they usually lose on
  return { ae, ab, pe, pb, pu, skill: ae * (pe - pu) - ab * (pb - pu), mix, strong: pu > 0 ? mix : 0, weak: pu < 0 ? mix : 0, total: ae * pe - ab * pb };
}
const sumSplit = (list) => list.reduce((t, x) => ({ skill: t.skill + x.skill, mix: t.mix + x.mix, strong: t.strong + x.strong, weak: t.weak + x.weak, total: t.total + x.total }), { skill: 0, mix: 0, strong: 0, weak: 0, total: 0 });
/** "+0.10 from more of their strong shots, +0.40 from fewer of their weak ones" (each part only when it counts). */
function mixWords(x, sgn) {
  const parts = [];
  if (Math.abs(x.strong) >= 0.01) parts.push(`${sgn(x.strong)} from ${x.strong >= 0 ? "more" : "fewer"} of their strong shots`);
  if (Math.abs(x.weak) >= 0.01) parts.push(`${sgn(x.weak)} from ${x.weak >= 0 ? "fewer" : "more"} of their weak ones`);
  return parts.join(", ");
}
/** Which side of "how often" leads: "fewer weak shots" or "more strong shots". */
const mixLead = (x) => (Math.abs(x.weak) >= Math.abs(x.strong) ? (x.weak >= 0 ? "fewer of their weak shots" : "more of their weak shots") : (x.strong >= 0 ? "more of their strong shots" : "fewer of their strong shots"));
/** Why facing a shot more or less often happens, by part of the game: a strategy question, or the shot before. */
const MIX_CAUSE = {
  OTT: "That\u2019s club choice off the tee (and the courses\u2019 par 3s and 5s): strategy more than practice.",
  APP: "That\u2019s where the tee shots leave them (club and line off the tee, or the courses): strategy more than practice.",
  ARG: "That comes from the approach play (how often greens are missed, and where), not the short game itself.",
  PUTT: "That comes from the shots before (how close approaches and chips finish), not the putting itself.",
};
import { favoriteKeys } from "./watchlist.js";
import { el, mount, loadScript, infoTip } from "./ui.js";
import {
  CATEGORIES, applyFilters, roundFilter, filterOptions, sliceTotals, sgPerRound, sgBy, trend, statTable, statTableFull, shortDate,
  missSplit, leavePoints, leaveHistogram, rank, gradeColor, sgColor, fmtSG, defaultMinRounds,
  statRounds, statAgg, statDef, fmtStat, statsIn, groupObs, gearInfo, gearLabel, gearList, distLead,
  localDay,
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
/** (update 283) The Personal Peak's note: when it was (first to last date), then each of its rounds. */
function peakNote(peak, me, cat, peakN, tn, onRange = null) {
  const day = (rd) => { const d = new Date(`${String(rd.date || "").slice(0, 10)}T12:00:00`); return isNaN(d) ? String(rd.date || "") : d; };
  const md = (d) => (d instanceof Date ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : d);
  const mdy = (d) => (d instanceof Date ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : d);
  const rs = [...peak.rounds].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const a = day(rs[0]), b = day(rs.at(-1));
  const span = a instanceof Date && b instanceof Date && a.getTime() === b.getTime() ? mdy(a) : a instanceof Date && b instanceof Date && a.getFullYear() === b.getFullYear() ? `${md(a)} \u2013 ${mdy(b)}` : `${mdy(a)} \u2013 ${mdy(b)}`;
  const by = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
  // (update 319) by tournament: "4 rounds at THE PLAYERS Championship, 4 rounds at the Valspar Championship and the
  // first 2 rounds of The Masters" (all of their rounds there, or the first / last few)
  const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const evKey = (rd) => `${rd.event || "?"}|${yrOf(rd)}`;
  const groups = [];
  for (const rd of rs) { const k = evKey(rd); const g = groups.at(-1); if (g && g.k === k) g.rs.push(rd); else groups.push({ k, name: rd.event || "an event", rs: [rd] }); }
  const allAt = (k) => (me?.rounds || []).filter((rd) => evKey(rd) === k && !rd.eventLevel);
  const nums = (x) => x.map((rd) => Number(rd.roundNo)).filter((n) => Number.isFinite(n));
  const words = ["", "", "2", "3", "4", "5", "6"];
  const part = (g) => {
    const n = g.rs.length, all = allAt(g.k), mine = nums(g.rs), theirs = [...new Set(nums(all))];
    const rds = (k) => (k === 1 ? "round" : `${words[k] || k} rounds`);
    if (n >= 4 || n >= Math.max(theirs.length, 1) || !mine.length || !theirs.length) return `${n} ${n === 1 ? "round" : "rounds"} at ${g.name}`;
    if (Math.min(...mine) === Math.min(...theirs)) return `the first ${rds(n)} of ${g.name}`;
    if (Math.max(...mine) === Math.max(...theirs)) return n === 1 ? `the final round of ${g.name}` : `the last ${rds(n)} of ${g.name}`;
    return `${n} ${n === 1 ? "round" : "rounds"} at ${g.name}`;
  };
  const parts = groups.map(part);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "";
  // (update 322) the first sentence: bold, and a tap filters the page to those dates
  const head = `Best ${peakN} ${peakN === 1 ? "round" : "rounds in a row"} by ${by}: ${span}`; // (update 330)
  const link = el("a", { href: "#", class: "peak-range", title: "Show just these dates" }, head);
  link.addEventListener("click", (e) => { e.preventDefault(); onRange?.({ from: String(rs[0].date || "").slice(0, 10), to: String(rs.at(-1).date || "").slice(0, 10), label: span }); });
  return [link, el("span", {}, ` \u00b7 ${list.charAt(0).toUpperCase()}${list.slice(1)}.`)];
}

// (update 371) before drills go into a practice plan: what's being added, with the shots a set, the goal a set, how many
// sets to meet it in, and the goal in real rounds, each changeable. onOk gets the edited list.
function planEditor(list, whose, onOk) {
  const dlg = el("dialog", { class: "dp-dialog" });
  document.body.appendChild(dlg);
  const num = (v, attrs = {}) => el("input", { type: "number", inputmode: "decimal", class: "dp-num", value: v == null ? "" : String(v), ...attrs });
  const rows = list.map((x) => {
    const d = x.drill, prox = d.kind === "prox";
    const reps = num(d.reps, { min: "1", max: "50", step: "1", "aria-label": "Shots a set" });
    const goal = num(d.goal, { min: prox ? "0.5" : "1", step: prox ? "0.5" : "1", placeholder: "Beat your best", "aria-label": prox ? "Average inside (ft)" : "Successes a set" });
    const sets = num(d.setsAim || 3, { min: "1", max: "20", step: "1", "aria-label": "Sets to meet the goal" });
    const rg = x.goal && x.goal.target != null ? num(x.goal.target, { step: "any", "aria-label": "Goal in rounds" }) : null;
    const node = el("div", { class: "dp-ed" }, [
      el("p", { class: "dp-ed-t" }, [el("strong", {}, d.title), el("span", { class: "muted small" }, ` \u00b7 ${d.what}`)]),
      el("div", { class: "dp-ed-grid" }, [
        el("label", {}, [el("span", { class: "muted small" }, "Shots a set"), reps]),
        el("label", {}, [el("span", { class: "muted small" }, prox ? "Average inside (ft)" : "Successes needed"), goal]),
        el("label", {}, [el("span", { class: "muted small" }, "Sets to meet it"), sets]),
        rg ? el("label", {}, [el("span", { class: "muted small" }, `In rounds: ${x.goal.label || "goal"}${x.goal.unit === "%" ? (/%/.test(x.goal.label || "") ? "" : " (%)") : x.goal.unit ? ` (${x.goal.unit.trim()})` : ""}`), rg]) : null,
      ]),
    ]);
    const value = () => {
      const r = Math.max(1, Math.min(50, Math.round(Number(reps.value)) || d.reps));
      const gRaw = goal.value.trim() === "" ? null : Number(goal.value);
      const gv = gRaw == null || !Number.isFinite(gRaw) ? null : prox ? Math.max(0.5, gRaw) : Math.max(1, Math.min(r, Math.round(gRaw)));
      const changed = gv !== d.goal || r !== d.reps;
      const nd = { ...d, reps: r, goal: gv, setsAim: Math.max(1, Math.min(20, Math.round(Number(sets.value)) || 3)), ...(changed ? { goalFrom: gv == null ? null : "set" } : {}) };
      const tg = rg ? Number(rg.value) : null;
      return { ...x, drill: nd, goal: x.goal ? { ...x.goal, ...(rg && Number.isFinite(tg) ? { target: tg } : {}) } : x.goal };
    };
    return { node, value };
  });
  const close = () => { try { dlg.close(); } catch { /* */ } dlg.remove(); };
  const ok = el("button", { type: "button", class: "btn" }, `Add to ${whose} plan`);
  ok.addEventListener("click", () => { const out = rows.map((r) => r.value()); close(); onOk(out); });
  const cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
  cancel.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  mount(dlg, [
    el("h3", {}, list.length === 1 ? `Add to ${whose} practice plan` : `Add ${list.length} drills to ${whose} practice plan`),
    el("p", { class: "muted small" }, "Change anything before it\u2019s added: the shots in a set, the goal for a set (leave it empty to beat your best), how many sets should meet it, and the goal in real rounds."),
    el("div", { class: "dp-ed-list" }, rows.map((r) => r.node)),
    el("div", { class: "thread-actions" }, [ok, cancel]),
  ]);
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
}

export function sgDashboard(container, opts) {
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
  let unit = "round";
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
    const blocks = careerBlocks(rs, { key: meAll.key, source: opts.entered ? "entered" : "tour", ui: careerUi, redraw: () => draw(), only, cols });
    return blocks.length ? el("div", { class: "cmp career" }, blocks) : null;
  }
  function draw() {
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
    if (unit === "event" && st.trendBy === "round") st.trendBy = "event";
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
      filtersPanel(opt),
      rangeChip(), // (update 322)
      el("div", { class: "sg-panel" }, (() => {
        // nothing to show (no player picked, or no rounds yet): the same Filters panel, and why it's empty
        if (opts.emptyNote) return [el("section", { class: "panel sg-empty-note" }, el("p", { class: "empty center" }, opts.emptyNote))];
        if (!isSG()) return statBlocks(mine, slicedField, f);
        if (!me && st.statWanted === "stretch") return [stretchBoard(slicedField)]; // (update 332: the Leaderboards' Best Stretches)
        if (!me && st.statWanted === "form1") return [formBoard(slicedField)]; // (update 333: #1 Form)
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

  /* ------------------------------ filters ------------------------------ */
  // A filter button that opens a checklist: pick any number of options (none = all). Each tick applies
  // straight away; it stays open while you tick and closes when you tap outside, tap the button, or press Escape.
  function multi(label, key, options, allLabel, { plural, fmt = (v) => v, empty = "Nothing to pick for this selection." } = {}) {
    const chosen = new Set(st[key]);
    // nothing picked = everything: shown with every box ticked, unless you just pressed None (all unticked)
    st.noneShown ||= {};
    // (update 387) nothing ticked to start (which still means everything); All ticks every box, until one is changed
    const allTicked = !chosen.size && !!st.allShown?.[key];
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
      if (st[key].length && st[key].length === options.length) { st[key] = []; st.allShown = { ...(st.allShown || {}), [key]: true }; } // (everything ticked: back to "all", shown ticked)
      else st.allShown = { ...(st.allShown || {}), [key]: false };
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
    all.addEventListener("click", () => { st[key] = []; st.allShown = { ...(st.allShown || {}), [key]: true }; st.noneShown[key] = false; if (key === "club" || key === "gear") followClubs(); st.openFilter = key; draw(); });
    const none = el("button", { type: "button", class: "link ms-all" }, "None");
    none.addEventListener("click", () => { st[key] = []; st.noneShown[key] = false; st.allShown = { ...(st.allShown || {}), [key]: false }; if (key === "club" || key === "gear") followClubs(); st.openFilter = key; draw(); });
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
      .flatMap(([k, label]) => optsOnce(`dist|${me ? `me:${me.key}` : "field"}|${statKey}|${k}`, () => filterOptions(base, k)).dist.map((d) => ({ value: `${k}|${d}`, label: d, group: label })));
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
      const fieldAllCats = catsAvail.length > 1 ? sliceOnce("allcats", { ...lastRankF, cats: [] }) : []; // (update 328: kept while the filters don't change)
      // A lie / distance / club filter belongs to the category picked: the other categories' tiles keep their
      // own numbers (only the year / tour / tournament / round / span filters apply), dimmed and not clickable.
      const apart = (k) => !!(narrowed() && st.cats.length && !st.cats.includes(k));
      const noShot = { lie: [], dist: [], club: [] };
      const anyApart = catsAvail.some(([k]) => apart(k));
      const allCatsBare = anyApart ? nz(applyFilters(me.rounds, { ...f, ...noShot, cats: [] })) : null;
      const fieldBare = anyApart ? sliceOnce("bare", { ...lastRankF, ...noShot, cats: [] }) : [];
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
            tourButtons(), // (update 376: the tour, right under the big number, above the pills)
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
            // (update 393) press and hold on the chart: a thin line where you touch, the point on the curve, and that
            // week's numbers; slide to move it, let go to put it away (a quick tap still opens every tournament)
            let holdT = null, scrubbing = false, skipClick = false, sx = 0, sy = 0;
            const evAt = new Map(); for (const rd of ordered) { const d = String(rd.date || ""); const k = `${rd.event}|${yearOf(rd)}`; const cur = evAt.get(k); if (!cur || d > cur.end) evAt.set(k, { end: d, event: rd.event, k }); }
            const evByEnd = new Map([...evAt.values()].map((x) => [x.end, x]));
            const weekSG = (k) => { const rs = ordered.filter((rd) => `${rd.event}|${yearOf(rd)}` === k); return rs.length ? { v: metric(rs), n: rs.length } : null; };
            const scrub = el("div", { class: "hc-scrub", hidden: true }, [el("i", { class: "hc-line" }), el("i", { class: "hc-dot" }), el("div", { class: "hc-tip" })]);
            const place = (clientX) => {
              const cv = box.querySelector("canvas"), ch = cv && typeof Chart !== "undefined" && Chart.getChart ? Chart.getChart(cv) : null;
              if (!ch) return;
              const pts = ch.getDatasetMeta(0)?.data || [];
              if (!pts.length) return;
              const cr = cv.getBoundingClientRect(), br = box.getBoundingClientRect(), x = clientX - cr.left;
              let i = 0; for (let j = 1; j < pts.length; j++) if (Math.abs(pts[j].x - x) < Math.abs(pts[i].x - x)) i = j;
              const pt = pts[i], h = hist[i]; if (!h) return;
              const ox = cr.left - br.left, oy = cr.top - br.top;
              scrub.hidden = false;
              const [line, dot, tip] = scrub.children;
              line.style.cssText = `left:${ox + pt.x}px;top:${oy + (ch.chartArea?.top ?? 0)}px;height:${(ch.chartArea?.bottom ?? cr.height) - (ch.chartArea?.top ?? 0)}px`;
              dot.style.cssText = `left:${ox + pt.x}px;top:${oy + pt.y}px`;
              const ev = evByEnd.get(String(h.date)), wk = ev ? weekSG(ev.k) : null;
              const d = new Date(`${String(h.date).slice(0, 10)}T12:00:00`);
              mount(tip, [el("strong", {}, isNaN(d) ? String(h.date) : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })),
                ev?.event ? el("span", { class: "hc-tip-ev" }, ev.event) : null,
                mode() === "rank" && h.rank ? el("span", {}, [`Rank `, el("b", {}, `${ordinal(h.rank)} of ${h.of}`)]) : null,
                h.avg != null ? el("span", {}, [`Rolling average `, el("b", { class: isSG() ? (h.avg >= 0 ? "pos" : "neg") : "" }, fmtV(h.avg))]) : null,
                wk && wk.v != null ? el("span", {}, [`That week `, el("b", { class: isSG() ? (wk.v >= 0 ? "pos" : "neg") : "" }, fmtV(wk.v)), ` (${wk.n} ${wk.n === 1 ? "round" : "rounds"})`]) : null]);
              // (update 395) beside the line, never over the dot: to its right in the left half of the chart, to its left in
              // the right half, level with the dot (kept inside the chart)
              const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 80, dx = ox + pt.x, dy = oy + pt.y, gap = 14;
              let left = dx < br.width / 2 ? dx + gap : dx - gap - tw;
              left = Math.max(4, Math.min(br.width - tw - 4, left));
              const top = Math.max(4, Math.min(br.height - th - 4, dy - th / 2));
              // (squeezed on a narrow chart so it can't sit beside it: above or below the dot instead)
              const overlapX = dx >= left - 6 && dx <= left + tw + 6;
              tip.style.left = `${left}px`;
              tip.style.top = `${overlapX ? (dy > br.height / 2 ? Math.max(4, dy - th - gap) : Math.min(br.height - th - 4, dy + gap)) : top}px`;
            };
            const endScrub = () => { clearTimeout(holdT); holdT = null; if (scrubbing) { scrubbing = false; skipClick = true; scrub.hidden = true; box.classList.remove("scrubbing"); } };
            box.addEventListener("pointerdown", (e) => {
              if (e.target.closest(".hero-chart-ctrls")) return;
              sx = e.clientX; sy = e.clientY;
              clearTimeout(holdT);
              holdT = setTimeout(() => { scrubbing = true; box.classList.add("scrubbing"); try { box.setPointerCapture(e.pointerId); } catch { /* */ } place(sx); }, 280);
            });
            box.addEventListener("pointermove", (e) => {
              if (scrubbing) { place(e.clientX); return; }
              if (holdT && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) { clearTimeout(holdT); holdT = null; } // (scrolling, not holding)
            });
            for (const ev of ["pointerup", "pointercancel", "pointerleave"]) box.addEventListener(ev, endScrub);
            box.addEventListener("touchmove", (e) => { if (scrubbing) e.preventDefault(); }, { passive: false });
            box.addEventListener("contextmenu", (e) => { if (scrubbing || holdT) e.preventDefault(); });
            box.appendChild(scrub);
            box.addEventListener("click", (e) => { if (skipClick) { skipClick = false; e.stopPropagation(); return; } openT(); });
            box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openT(); } });
            return box;
          })(),
        ]),
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
      infoTip(`${what === "Wins" ? "Best in the field" : "Top 10 in the field"} in ${isSG() ? "strokes gained a round" : def.label}, among the players who played every round there.`)], what);
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
      infoTip(`Rank: where that ${unit} placed among everyone in the field who played it.`),
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
    // (update 332) Leaderboards (no player): also Best Stretches, the players ranked by how long they played at a #1 level
    const withStretch = !me && !opts.entered && !opts.practice && statList.includes("sg");
    if (statList.length < 2 && !withStretch) return null;
    const stretchOn = withStretch && st.statWanted === "stretch", formOn = withStretch && st.statWanted === "form1";
    const sel = el("select", { class: "stat-select", "aria-label": "Stat type" }, [...statList.flatMap((k) => [el("option", { value: k, selected: !stretchOn && !formOn && k === statKey }, statDef(k).label),
      k === "sg" && withStretch ? el("option", { value: "stretch", selected: stretchOn }, "Elite Stretches (rounds in a row at a #1 level)") : null,
      k === "sg" && withStretch ? el("option", { value: "form1", selected: formOn }, "Elite Round Share (share of rounds at a #1 level)") : null]).filter(Boolean)]);
    sel.addEventListener("change", () => { st.statWanted = sel.value; st.openFilter = null; sel.blur(); draw(); });
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
      const d = localDay(rd.date), ok = !isNaN(d);
      const key = by === "year" ? (ok ? String(d.getFullYear()) : "?") : by === "month" ? (ok ? `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}` : "?")
        : by === "round" ? `${rd.key}` : `${rd.event || rd.date}|${ok ? d.getFullYear() : rd.year || ""}`; // (update 404: each year's playing its own bar)
      const g = m.get(key) || { id: key, label: by === "round" ? (ok ? `${shortDate(d)}` : rd.date) : by === "event" ? (rd.event ? `${rd.event} ${ok ? d.getFullYear() : rd.year || ""}`.trim() : rd.date) : key, short: ok ? shortDate(d) : null, rounds: [] };
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
  function tapPill(key, value, order, ev = null) {
    const keepKey = `${key}Kept`;
    st[keepKey] = (st[keepKey] || []).filter((v) => st[key].includes(v));
    // (update 394) when the tap happened, not when it's handled: the first tap's redraw can take a while (un-picking the
    // only year redraws every year's data), and the second tap waits behind it, so it looked too late to be a double-tap
    const now = ev && Number.isFinite(ev.timeStamp) ? performance.timeOrigin + ev.timeStamp : Date.now();
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
      a.addEventListener("click", (e) => { e.preventDefault(); tapPill("year", y, (p, q) => p.localeCompare(q), e); });
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
        tapPill("cats", k, (x, y) => CATEGORIES.findIndex(([c]) => c === x) - CATEGORIES.findIndex(([c]) => c === y), e);
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
      fieldIsSummary() && narrowed() ? infoTip("Rank uses the category and rounds you've picked; rankings don't break down by lie or distance.") : null,
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
  // (update 332) Best Stretches on the Leaderboards: each player's longest run of rounds in a row whose average would
  // rank #1 in this selection (by the strokes gained the filters are about), longest first
  /** (update 350) Every player's longest run of rounds in a row whose average beats the best of everyone else (a #1 level),
   * longest first. Kept per field and category (the Leaderboards table and the line under the Elite Round Share boxes). */
  const stretchesMemo = { src: null, map: new Map() };
  function longestStretches(slicedField, cat) {
    if (stretchesMemo.src !== slicedField) { stretchesMemo.src = slicedField; stretchesMemo.map = new Map(); }
    if (stretchesMemo.map.has(cat || "")) return stretchesMemo.map.get(cat || "");
    const ranked = rankedField(slicedField);
    const avgOf = new Map(ranked.map((p) => [p.key, perRoundOf(p.rounds, cat || null)]));
    const vals = [...avgOf.values()].filter((v) => v != null && Number.isFinite(v)).sort((a, b) => b - a);
    const rows = [];
    for (const p of ranked) {
      const mineAvg = avgOf.get(p.key);
      if (mineAvg == null) continue;
      const bar = vals[0] === mineAvg && vals.length > 1 ? vals[1] : vals[0]; // (the best of everyone else)
      const seq = stretchSeq(p.rounds, cat);
      if (!seq.length) continue;
      const pre = [0]; for (const x of seq) pre.push(pre.at(-1) + x.t);
      let found = null;
      for (let n = seq.length; n >= 1 && !found; n--) {
        for (let i = n; i < pre.length; i++) if ((pre[i] - pre[i - n]) / n > bar + 1e-12) { found = { n, from: seq[i - n].rd.date, to: seq[i - 1].rd.date, whole: n === seq.length }; break; }
      }
      rows.push({ p, ...(found || { n: 0 }), of: seq.length, bar });
    }
    rows.sort((a, b) => b.n - a.n || (avgOf.get(b.p.key) ?? -1e9) - (avgOf.get(a.p.key) ?? -1e9));
    stretchesMemo.map.set(cat || "", rows);
    return rows;
  }
  function stretchBoard(slicedField) {
    const cat = st.cats.length === 1 ? st.cats[0] : "";
    const what = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
    const rows = longestStretches(slicedField, cat);
    const all = st.stretchAll; const shown = all ? rows : rows.slice(0, 25);
    const name = (p) => (pickable(p.key) ? (() => { const b = el("button", { type: "button", class: "hb-link ti-name", title: `Open ${p.label}` }, starred(p.key, p.label)); b.addEventListener("click", () => opts.onPick(p.key)); return b; })() : el("span", { class: "ti-name" }, starred(p.key, p.label)));
    let place = 0, prevN = null;
    const body = shown.map((r, i) => { if (r.n !== prevN) { place = i + 1; prevN = r.n; } return el("tr", {}, [
      el("td", { class: "num" }, r.n ? String(place) : "\u2014"), el("td", {}, name(r.p)),
      el("td", { class: "num strong" }, r.n ? (r.whole ? `${r.n} (all)` : String(r.n)) : "\u2014"),
      el("td", { class: "num muted" }, r.n ? (r.from === r.to ? shortDay(r.from) : `${shortDay(r.from)} \u2013 ${shortDay(r.to)}`) : "No round at a #1 level"),
      el("td", { class: "num muted" }, String(r.of)),
    ]); });
    const more = rows.length > 25 ? (() => { const b = el("button", { type: "button", class: "link small" }, all ? "Show the top 25" : `Show all ${rows.length}`); b.addEventListener("click", () => { st.stretchAll = !all; draw(); }); return b; })() : null;
    return panelBox(`Elite Stretches \u00b7 ${what}`, [
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
  function formBoard(slicedField) {
    const cat = st.cats.length === 1 ? st.cats[0] : "";
    const what = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
    const ranked = rankedField(slicedField);
    const avgOf = new Map(ranked.map((p) => [p.key, perRoundOf(p.rounds, cat || null)]));
    const vals = [...avgOf.values()].filter((v) => v != null && Number.isFinite(v)).sort((a, b) => b - a);
    const rows = [];
    for (const p of ranked) {
      const mineAvg = avgOf.get(p.key);
      if (mineAvg == null) continue;
      const bar = vals[0] === mineAvg && vals.length > 1 ? vals[1] : vals[0]; // (the best of everyone else)
      const ts = stretchSeq(p.rounds, cat).map((x) => x.t).sort((a, b) => b - a);
      if (!ts.length) continue;
      // the best k rounds' average only falls as k grows: the largest k still above the bar
      let k = 0, sum = 0;
      for (let i = 0; i < ts.length; i++) { sum += ts[i]; if (sum / (i + 1) > bar + 1e-12) k = i + 1; else break; }
      rows.push({ p, k, of: ts.length, pct: k / ts.length });
    }
    rows.sort((a, b) => b.pct - a.pct || b.k - a.k);
    const all = st.formAll; const shown = all ? rows : rows.slice(0, 25);
    const name = (p) => (pickable(p.key) ? (() => { const b = el("button", { type: "button", class: "hb-link ti-name", title: `Open ${p.label}` }, starred(p.key, p.label)); b.addEventListener("click", () => opts.onPick(p.key)); return b; })() : el("span", { class: "ti-name" }, starred(p.key, p.label)));
    let place = 0, prev = null;
    const body = shown.map((r, i) => { const pc = Math.round(r.pct * 1000) / 10; if (pc !== prev) { place = i + 1; prev = pc; } return el("tr", {}, [
      el("td", { class: "num" }, r.k ? String(place) : "\u2014"), el("td", {}, name(r.p)),
      el("td", { class: "num strong" }, r.k ? `${pc.toFixed(1)}%` : "\u2014"),
      el("td", { class: "num" }, r.k ? String(r.k) : "0"),
      el("td", { class: "num muted" }, String(r.of)),
    ]); });
    const more = rows.length > 25 ? (() => { const b = el("button", { type: "button", class: "link small" }, all ? "Show the top 25" : `Show all ${rows.length}`); b.addEventListener("click", () => { st.formAll = !all; draw(); }); return b; })() : null;
    return panelBox(`Elite Round Share \u00b7 ${what}`, [
      infoTip(`How much of each player\u2019s golf was at a #1 level: the most of their rounds (their best ones, in any order) whose average would still rank #1 in this selection, as a share of all their rounds. 100%: their whole selection already ranks #1.`),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-stretch-board" }, [
        el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num", title: "Share of their rounds at a #1 level" }, "Share"), el("th", { class: "num", title: "Their best rounds that together average at a #1 level" }, "Rounds"), el("th", { class: "num", title: "Rounds in this selection" }, "Of")])),
        el("tbody", {}, body),
      ])),
      more,
    ], "full");
  }
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
      for (const x of sec?.rows || []) if (!x.dist && x.values[0] != null && SCORING_KEYS.includes(x.key)) { m.set(`s:${x.key}|`, x.values[0]); if (x.w?.[0]) m.set(`w:s:${x.key}|`, x.w[0]); }
    } else if (n) {
      let tot = 0, att = 0; const byD = new Map();
      for (const rd of rounds) for (const x of rd.shots) if (x.cat === cat) { tot += x.sg; att += x.w || 1; if (x.dist) { const o = byD.get(x.dist) || byD.set(x.dist, { sg: 0, w: 0 }).get(x.dist); o.sg += x.sg; o.w += x.w || 1; } }
      if (att) { m.set("sg", tot / n); m.set("sga", tot / att); m.set("att", att / n); }
      for (const [d, o] of byD) if (o.w >= 1) m.set(`d:${d}`, o.sg / n);
      const sec = statBlocksCmp([rounds]).find((b) => b.cat === cat);
      for (const x of sec?.rows || []) if (x.values[0] != null) { m.set(`s:${x.key}|${x.dist || ""}`, x.values[0]); if (x.w?.[0]) m.set(`w:s:${x.key}|${x.dist || ""}`, x.w[0]); } // (update 387: and its attempts)
    }
    if (!rowMemo.has(rounds)) rowMemo.set(rounds, new Map());
    rowMemo.get(rounds).set(cat, m);
    return m;
  }
  function fullStatTable(mine, cat, slicedField = [], mode = "table") {
    // (update 370) "table": the stats table on its own, never switched by the level cards; "elite": the Elite Round
    // Share block and the Path, without the table
    const n = mine.length;
    if (!n) return el("p", { class: "empty" }, "No stats for this selection.");
    const sgTone = (v) => (v == null ? "" : Math.round(v * 100) === 0 ? "zero" : v > 0 ? "pos" : "neg");
    const meV = rowVals(mine, cat);
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
        const open = (st.expCats || []).includes(k);
        R.push({ key: `c:${k}`, label: l, fmt: sgF, higher: true, tone: true, sub: true, expand: k, open });
        if (open) for (const d of distsFor(k)) R.push({ key: `d:${d}`, c: k, label: d, fmt: sgF, higher: true, tone: true, sub: true, deep: true });
      }
      const sk = SCORING_KEYS.filter((k) => meV.has(`s:${k}|`));
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
    const ranked = rankedField(slicedField).filter((p) => p.key !== me?.key);
    const fieldMaps = ranked.map((p) => rowVals(p.rounds, cat));
    const avg = (maps, k) => { const v = maps.map((m) => gv(m, k)).filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const rankOfRow = (k, v, higher) => { if (v == null || higher == null) return null; const vs = fieldMaps.map((m) => gv(m, k)).filter((x) => x != null && Number.isFinite(x)); if (!vs.length) return null; const better = vs.filter((x) => (higher ? x > v + 1e-12 : x < v - 1e-12)).length; return { rank: better + 1, of: vs.length + 1 }; };
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
    // (update 381) the table's own Personal Peak: their best N rounds against the rest (st.tablePeak), apart from the level cards
    const tPeak = mode === "table" ? Math.max(0, Math.round(Number(st.tablePeak) || 0)) : 0;
    const peakOn = tPeak > 0 || (mode === "elite" && st.vsRank === "peak"); // (update 260) or against the player's own peak (update 370: not the table)
    const vsN = null, refP = null; // (update 330: no #N player comparisons)
    // (update 266) Personal Peak: the player's N best rounds (the Peak Length, default 10) in this selection, ranked by the
    // strokes gained the filters are about (SG: Total, or the one category picked: their best Off-the-Tee rounds), and
    // every row is those same rounds' value, so the rows still add up and read as "how I play on my best days"
    const peakN = tPeak || Math.max(1, Math.round(Number(st.peakN) || 10));
    const peak = peakOn ? (tPeak || st.peakMode === "stretch" ? peakOf(ordered, cat, peakN) : eliteOf(ordered, cat, peakN)) : null; // (update 383: the table's Personal Peak is rounds in a row) // (update 335: elite rounds; the same rounds as the charts' dots)
    const refMap = peak ? peak.map : refP ? rowVals(refP.rounds, cat) : null;
    const dTxt = (rd) => String(rd?.date || "").slice(0, 10);
    // no rank picked: each stat coloured against the player's own career average (every round of theirs)
    const careerMap = me?.rounds?.length ? rowVals(me.rounds, cat) : null;
    const relNow = !!refMap && (!peak || peak.map.size > 0);
    const stretchOn = !!(peak && !peak.short); // (update 330) a stretch picked: Stretch | Selection | Difference | Stretch Rank
    // (update 343) the elite rounds against the rest (their other rounds in the selection), not the average, which
    // already has the elite rounds in it
    const eliteSet = stretchOn ? new Set(peak.rounds) : null;
    const rest = stretchOn ? mine.filter((rd) => !eliteSet.has(rd)) : null;
    const restV = stretchOn ? rowVals(rest, cat) : null;
    // (update 332) an opened part of the game's distance rows: the same columns, worked out for that part of the game
    const mapsMemo = new Map();
    const M = (c) => {
      if (!mapsMemo.has(c)) mapsMemo.set(c, { me: rowVals(mine, c), field: ranked.map((p) => rowVals(p.rounds, c)), last: tn >= 3 ? rowVals(ordered.slice(-tn), c) : null, prev: tn >= 3 ? rowVals(ordered.slice(-2 * tn, -tn), c) : null,
        peak: stretchOn ? rowVals(peak.rounds, c) : null, rest: stretchOn ? rowVals(rest, c) : null, career: me?.rounds?.length ? rowVals(me.rounds, c) : null });
      return mapsMemo.get(c);
    };
    const rankIn = (maps, k, v, higher) => { if (v == null || higher == null) return null; const vs = maps.map((m) => gv(m, k)).filter((x) => x != null && Number.isFinite(x)); if (!vs.length) return null; const better = vs.filter((x) => (higher ? x > v + 1e-12 : x < v - 1e-12)).length; return { rank: better + 1, of: vs.length + 1 }; };
    const toggleCat = (k) => { const a = new Set(st.expCats || []); a.has(k) ? a.delete(k) : a.add(k); st.expCats = [...a]; draw(); };
    // (update 387) Show Attempts: a percentage with how many of how many, "50% (6/12)"
    const attOn = mode === "table" && !!st.showAtt;
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
      const rk = showRanks ? (X ? rankIn(X.field, row.key, stretchOn ? pkRow : v, row.higher) : rankOfRow(row.key, peak && !peak.short ? pkRow : v, row.higher)) : null;
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
        const val = (rs) => (rs.length ? gv(rowVals(rs, row.c ?? cat), row.key) ?? null : null);
        openBadge({ text: row.label, info: () => formInfo(ordered, val, { label: row.label, fmtFn: (x) => row.fmt(x), chFn: (d) => (row.fmt === sgF ? Math.abs(d).toFixed(2) : row.fmt === sg3 ? Math.abs(d).toFixed(3) : row.def ? fmtStat({ ...row.def, pct: false, unit: row.def.pct ? " pct" : row.def.unit }, Math.abs(d)) : Math.abs(d).toFixed(1)), higher: row.higher, signed: !!row.tone }) }, me?.label || "");
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
    const TN = tPeak ? { kept: `best ${peakN}-round stretch`, cut: "other rounds", Kept: "Peak", Cut: "Rest" } : NM();
    // (update 381) Personal Peak, picked above the table: their best N rounds (any order) against the rest
    const peakCtl = mode === "table" && me ? (() => {
      // (update 387) to start: the length of their longest Best on Tour stretch (else 10)
      const all = longestStretches(lastSliced || [], cat), myRow = all.find((x) => x.p.key === me.key), best1 = myRow?.n > 0 ? myRow : null;
      const defN = best1 ? best1.n : 10;
      const inp = el("input", { type: "number", class: "peak-len", min: "1", max: "500", step: "1", value: String(tPeak || Number(st.tablePeakLast) || defN), inputmode: "numeric", "aria-label": "How many rounds in a row" });
      const apply = () => { const v = Math.round(Number(inp.value)); if (!Number.isFinite(v) || v < 1) { inp.value = String(tPeak || defN); return; } st.tablePeak = Math.min(500, v); st.tablePeakLast = st.tablePeak; draw(); };
      inp.addEventListener("change", () => { if (tPeak) apply(); });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); inp.blur(); } });
      const tog = el("button", { type: "button", class: `pp-tog${tPeak ? " on" : ""}`, "aria-pressed": String(!!tPeak) }, tPeak ? "\u2713 Personal Peak" : "Personal Peak");
      tog.addEventListener("click", () => { if (tPeak) { st.tablePeak = 0; draw(); } else { st.tablePeak = Math.min(500, Math.round(Number(st.tablePeakLast) || defN)); draw(); } });
      const attTog = el("button", { type: "button", class: `pp-tog${st.showAtt ? " on" : ""}`, "aria-pressed": String(!!st.showAtt), title: "Percentages with how many of how many, e.g. 50% (6/12)" }, st.showAtt ? "\u2713 Show Attempts" : "Show Attempts");
      attTog.addEventListener("click", () => { st.showAtt = !st.showAtt; draw(); });
      const tip = infoTip(`Personal Peak compares their best run of rounds in a row (the stretch with the highest strokes gained) with the rest of their rounds in the selection. It starts at the length of their longest ${LEVELS[1]} stretch: the longest run whose average on its own beats every other player\u2019s season average${best1 ? ` (${best1.n} rounds for ${me.label})` : ""}, or 10 rounds if they don\u2019t have one. Change the number for a shorter or longer stretch.`);
      // the stretch it picked, with its dates (tap for every round)
      const line = tPeak && peak && !peak.short && peak.rounds.length ? (() => {
        const rs = peak.rounds, from = rs[0].date, to = rs.at(-1).date, n = rs.length;
        const avgT = rs.reduce((t, rd) => t + rd.shots.reduce((u, x) => u + (!cat || x.cat === cat ? x.sg : 0), 0), 0) / n;
        const bar = myRow?.bar ?? all[0]?.bar ?? null, enough = bar != null && avgT > bar + 1e-12;
        const when = from === to ? shortDay(from) : `${shortDay(from)} \u2013 ${shortDay(to)}`;
        const place = best1 && n === best1.n ? 1 + all.filter((r) => r.n > best1.n).length : null, withN = all.filter((r) => r.n > 0).length;
        const link = el("button", { type: "button", class: "link bs-stretch-link", title: "Every round, with this stretch picked out" }, when);
        link.addEventListener("click", () => stretchPopup({ p: { key: me.key, rounds: mine }, n, from, to, bar: bar ?? 0 }, cat, when, place, withN));
        return el("p", { class: "muted small sg-peak-line" }, [`Their best ${n}-round stretch: `, link, `, ${sgn2(avgT)} a round${enough ? `, enough on its own for ${LEVELS[1]}` : ""}.`]);
      })() : null;
      return el("div", { class: "sg-peak-wrap" }, [
        el("div", { class: "sg-peak-ctl" }, [attTog, tog, tPeak ? el("span", { class: "muted small sg-peak-l" }, ["(best ", inp, " round stretch)"]) : null, tip]), // (update 382; 387: the number only once it's on)
        line]);
    })() : null;
    if (mode === "elite") return [
      el("div", { class: "sg-full-top" }, [stretchesBlock(mine, cat)]), // (update 330: Best Stretches)
      pathOf(),
      showRanks ? hypoOf() : null, // (update 393)
    ];
    return [
      peakCtl,
      el("div", { class: "cmp-tw" }, el("table", { class: `cmp-table sg-full-t${stretchOn && !showRanks ? " no-rank" : ""}` }, [
        el("thead", {}, el("tr", {}, stretchOn ? [el("th", {}, ""), // (update 330)
          ...(() => { const restTh = el("th", { class: "num", title: `The player\u2019s ${TN.cut} in the selected time frame` }, TN.Cut),
            pkTh = el("th", { class: "num", title: `The average of their best ${peakN} ${peakN === 1 ? "round" : "rounds"} (the ${TN.kept})` }, TN.Kept);
            return tPeak ? [pkTh, restTh] : [restTh, pkTh]; })(),
          el("th", { class: "num", title: `${TN.Kept} less ${TN.Cut.toLowerCase()}: green where the ${TN.kept} were better` }, "Diff"),
          el("th", { class: "num", title: "Where the kept rounds\u2019 value would rank if it were the player\u2019s average for the selected time frame" }, tPeak ? "Peak Rank" : `${NM().Kept} Rank`)]
          : [el("th", {}, ""), el("th", { class: "num" }, me?.label || "Player"),
          el("th", { class: "num", title: `Last ${tn || 10} rounds against the ${tn || 10} before` }, "Trend"),
          el("th", { class: "num" }, "Rank")])),
        el("tbody", {}, tr),
      ])),
      // (update 240) what the colours mean
      // (update 363) with kept / cut rounds picked, what the columns mean sits behind a small ⓘ
      (() => { const txt = (stretchOn ? `${TN.Cut}: ${me?.label || "the player"}\u2019s ${TN.cut} in the selected time frame. ${TN.Kept}: the average of their best ${peakN} ${peakN === 1 ? "round" : "rounds"} . Diff: ${TN.kept} less ${TN.cut}, green where the ${TN.kept} were better.${showRanks ? ` ${TN.Kept} Rank: where the ${TN.kept}\u2019 value would rank if it were their average for the selected time frame.` : ""}`
        : `Strokes gained: green above zero (the tour baseline), red below. Other stats: green when better than ${me?.label || "the player"}\u2019s career average (every round of theirs), red when worse; no colour when neither is better (attempts, pars). Rank: where they sit among the players in this selection. Trend: the last ${tn || 10} rounds against the ${tn || 10} before. Tap an Elite Round Share above to see how they played at their best.`); return el("details", { class: "bs-help sg-full-note-i" }, [el("summary", { "aria-label": "What the columns mean" }, "\u24d8"), el("p", { class: "muted small" }, txt)]); })(), // (update 366: always behind the ⓘ)
    ];
    // (update 393) Hypothetical rankings: the last N rounds' strokes gained in each part of the game, each one nudged up or
    // down with − / +, and where that would rank over the time frame picked (against everyone else's averages there)
    function hypoOf() {
      const season = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      if (season.length < 3) return null;
      const N = Math.max(3, Math.min(season.length, Math.round(Number(st.hypoN) || 10)));
      const last = season.slice(-N);
      const recent = rowVals(last, cat);
      const field0 = rankedField(slicedField).filter((p) => p.key !== me?.key);
      const others = field0.map((p) => rowVals(p.rounds, cat));
      if (!others.length) return null;
      const parts = cat ? dists.map((d) => ({ key: `d:${d}`, label: d })) : CATEGORIES.map(([k, l]) => ({ key: `c:${k}`, label: l }));
      const totKey = cat ? "sg" : "c:TOTAL", totLabel = cat ? `${CATEGORIES.find(([k]) => k === cat)?.[1] || cat} (a round)` : "SG: Total";
      const adj = st.hypoAdj && st.hypoAdj.cat === (cat || "") ? st.hypoAdj.d : {};
      // (update 394) a part of the game opens to its distances: each can be nudged too, and they add up into it
      const kidMemo = new Map();
      const kidsOf = (p) => {
        if (cat) return [];
        const c = p.key.slice(2);
        if (!kidMemo.has(c)) {
          const rv = rowVals(last, c);
          const ds = [...rv.keys()].filter((k) => k.startsWith("d:")).sort((a, b) => distLead(a.slice(2)) - distLead(b.slice(2)) || a.localeCompare(b));
          kidMemo.set(c, { rv, ds, field: null });
        }
        const m = kidMemo.get(c);
        return m.ds.map((dk) => ({ key: `${p.key}>${dk}`, label: dk.slice(2), dk, c, rv: m.rv }));
      };
      const kidField = (c) => { const m = kidMemo.get(c); if (!m.field) m.field = field0.map((p) => rowVals(p.rounds, c)); return m.field; };
      const kidAdj = (pk) => Object.entries(adj).reduce((t, [k, v]) => t + (k.startsWith(`${pk}>`) ? v : 0), 0);
      const valOf = (k) => (recent.get(k) ?? 0) + (adj[k] || 0) + kidAdj(k);
      const base = parts.filter((p) => recent.has(p.key));
      const other = (recent.get(totKey) ?? 0) - base.reduce((t, p) => t + (recent.get(p.key) ?? 0), 0); // (shots outside the parts listed)
      const total = base.reduce((t, p) => t + valOf(p.key), 0) + other;
      const rankIn = (maps, k, v) => { const vs = maps.map((m) => m.get(k)).filter((x) => x != null && Number.isFinite(x)); return { rank: 1 + vs.filter((x) => x > v + 1e-12).length, of: vs.length + 1 }; };
      const step = cat ? 0.02 : 0.05, kidStep = 0.02;
      const bump = (k, d) => { const cur = st.hypoAdj && st.hypoAdj.cat === (cat || "") ? { ...st.hypoAdj.d } : {}; cur[k] = Math.round(((cur[k] || 0) + d) * 1000) / 1000; if (Math.abs(cur[k]) < 1e-9) delete cur[k]; st.hypoAdj = { cat: cat || "", d: cur }; draw(); };
      const open = !!st.hypoOpen;
      const tgl = el("button", { type: "button", class: "bs-path-toggle", "aria-expanded": String(open) }, [el("span", { class: "cmp-caret" }, open ? "\u25BE " : "\u25B8 "), "Hypothetical rankings"]);
      tgl.addEventListener("click", () => { st.hypoOpen = !open; draw(); });
      if (!open) return el("div", { class: "bs-path closed bs-hypo" }, [el("div", { class: "bs-path-head" }, [el("p", { class: "bs-sub" }, tgl)])]);
      const nIn = el("input", { type: "number", class: "peak-len", min: "3", max: "500", step: "1", value: String(N), inputmode: "numeric", "aria-label": "How many recent rounds" });
      const setN = () => { const v = Math.round(Number(nIn.value)); if (Number.isFinite(v) && v >= 3) { st.hypoN = v; draw(); } else nIn.value = String(N); };
      nIn.addEventListener("change", setN); nIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nIn.blur(); } });
      const rkTxt = (r) => `${ordinal(r.rank)} of ${r.of}`;
      const openCats = new Set(st.hypoCats || []);
      const f3h = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}`; // (a distance: a smaller number)
      const fmtD = (d) => `${d > 0 ? "+" : "\u2212"}${Math.abs(d).toFixed(2)}`;
      // one row: k its key; v0 the last N rounds' value; v the what-if; d the change; r / r0 the ranks
      const row = ({ k, label, v0, v, d, r, r0, isTot = false, kid = false, stepBy = step, expand = null }) => {
        const btn = (txt, dv, lab) => { const b = el("button", { type: "button", class: "hy-step", "aria-label": `${lab} ${label}` }, txt); b.addEventListener("click", (e) => { e.stopPropagation(); bump(k, dv); }); return b; };
        const moved = r.rank !== r0.rank;
        const lab = expand ? [el("span", { class: "sg-exp", "aria-hidden": "true" }, expand.open ? "\u25BE " : "\u25B8 "), label] : label;
        const tr = el("tr", { class: `${isTot ? "bs-path-total" : ""}${kid ? " cmp-sub cmp-deep" : ""}${expand ? " sg-tap" : ""}`, ...(expand ? { role: "button", tabindex: "0", "aria-expanded": String(expand.open) } : {}) }, [
          el("td", {}, lab),
          el("td", { class: "num" }, kid ? f3h(v0) : fmtSG(v0)),
          el("td", { class: "num hy-val" }, [isTot ? el("strong", { class: v >= 0 ? "pos" : "neg" }, fmtSG(v)) : el("span", { class: "hy-ctl" }, [btn("\u2212", -stepBy, "Worse"), el("strong", { class: `${v >= 0 ? "pos" : "neg"}${d ? " hy-moved" : ""}` }, kid ? f3h(v) : fmtSG(v)), btn("+", stepBy, "Better")]),
            Math.abs(d) > 1e-9 ? el("span", { class: `hy-d ${d > 0 ? "pos" : "neg"}`, title: isTot ? "All the changes added up" : expand ? "Its changes added up (with its distances)" : "Changed by" }, fmtD(d)) : null]),
          el("td", { class: "num" }, [rkTxt(r), moved ? el("span", { class: `hy-mv ${r.rank < r0.rank ? "pos" : "neg"}` }, ` ${r.rank < r0.rank ? "\u25B2" : "\u25BC"}${Math.abs(r0.rank - r.rank)}`) : null]),
        ]);
        if (expand) { tr.addEventListener("click", expand.flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expand.flip(); } }); }
        return tr;
      };
      const body = [row({ k: totKey, label: totLabel, v0: recent.get(totKey) ?? 0, v: total, d: total - (recent.get(totKey) ?? 0), r: rankIn(others, totKey, total), r0: rankIn(others, totKey, recent.get(totKey) ?? 0), isTot: true })];
      for (const p of base) {
        const kids = kidsOf(p), isOpen = openCats.has(p.key), v0 = recent.get(p.key) ?? 0, v = valOf(p.key);
        const flip = () => { const a = new Set(st.hypoCats || []); a.has(p.key) ? a.delete(p.key) : a.add(p.key); st.hypoCats = [...a]; draw(); };
        body.push(row({ k: p.key, label: p.label, v0, v, d: v - v0, r: rankIn(others, p.key, v), r0: rankIn(others, p.key, v0), expand: kids.length ? { open: isOpen, flip } : null }));
        if (!isOpen) continue;
        const f = kidField(kids[0]?.c);
        for (const x of kids) {
          const kv0 = x.rv.get(x.dk) ?? 0, kd = adj[x.key] || 0, kv = kv0 + kd;
          body.push(row({ k: x.key, label: x.label, v0: kv0, v: kv, d: kd, r: rankIn(f, x.dk, kv), r0: rankIn(f, x.dk, kv0), kid: true, stepBy: kidStep }));
        }
      }
      const anyAdj = Object.keys(adj).length > 0;
      // (update 393) every change added up, in one line (update 394: distances too)
      const nameOfKey = (k) => { if (!k.includes(">")) return parts.find((p) => p.key === k)?.label || k; const [pk, dk] = k.split(">"); return `${parts.find((p) => p.key === pk)?.label || pk} \u00b7 ${dk.slice(2)}`; };
      const adjList = Object.entries(adj).filter(([, v]) => Math.abs(v) > 1e-9).map(([k, v]) => `${nameOfKey(k)} ${fmtD(v)}`);
      const adjSum = Object.values(adj).reduce((t, v) => t + v, 0);
      const sumLine = anyAdj ? el("p", { class: "hy-sum" }, [`Changes: `, el("strong", { class: adjSum >= 0 ? "pos" : "neg" }, `${fmtD(adjSum)} a round`), ` in all`, el("span", { class: "muted" }, ` (${adjList.join(", ")})`)]) : null;
      const reset = anyAdj ? (() => { const b = el("button", { type: "button", class: "link small" }, "Reset"); b.addEventListener("click", () => { st.hypoAdj = null; draw(); }); return b; })() : null;
      return el("div", { class: "bs-path bs-hypo" }, [
        el("div", { class: "bs-path-head" }, [el("p", { class: "bs-sub" }, tgl), reset]),
        el("div", { class: "bs-path-gap" }, [el("div", {}, [`Last `, nIn, ` rounds, ranked against everyone\u2019s averages over the time frame picked`]),
          infoTip(`Start from their last ${N} rounds: strokes gained a round in each ${cat ? "distance" : "part of the game"}${cat ? "" : " (tap one to open its distances)"}. Tap \u2212 or + to make one worse or better (${step.toFixed(2)} a round each tap${cat ? "" : `, ${kidStep.toFixed(2)} for a distance`}); a distance\u2019s change adds into its part of the game, and everything adds into the total. The rank is where that number would sit among every other player\u2019s average over the selected time frame (the same players as the rankings), and the arrow how far it moved from where the last ${N} rounds rank now.`)]),
        sumLine,
        el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-full-t bs-path-t hy-t" }, [
          el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", { class: "num" }, `Last ${N}`), el("th", { class: "num" }, "What if"), el("th", { class: "num" }, "Rank")])),
          el("tbody", {}, body),
        ])),
      ]);
    }
    // (update 341) Path back to Elite
    // (update 355) with rankings, the path has its own level to aim at (the next one up to start); without, the best
    // rounds picked above
    function pathOf() { return (() => {
        const season = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
        if (!showRanks) return stretchOn ? pathBack(peak.rounds, season, cat, null) : null;
        const rows = ladderRows(mine, cat);
        const P = rows?.prof;
        if (!P) return null;
        // (update 355) current form: where their last N rounds' average would rank; the default is the next level above that
        const nR = Math.max(3, Math.min(season.length, Math.round(Number(st.recentN) || 10)));
        const recentT = stretchSeq(season.slice(-nR), cat).map((x) => x.t);
        const recentAvg = recentT.length ? recentT.reduce((a, v) => a + v, 0) / recentT.length : P.avg;
        const formRank = P.rankOf(recentAvg);
        const reach = rows.filter((r) => r.share?.k);
        if (!reach.length) return null;
        const byLevel = [...reach].sort((a, b) => b.target - a.target); // #50 first
        const nextUp = byLevel.find((r) => r.target < formRank) || byLevel.at(-1);
        const pick = reach.find((r) => r.target === st.pathT) || nextUp;
        const kept = eliteOf(mine, cat, pick.share.k)?.rounds || [];
        if (!kept.length) return null;
        // the bar: the season average of the player ranked at that level (beat it to rank there)
        const barOf = (T) => P.field[T - 1] ?? null;
        const above = byLevel.filter((r) => r.target < pick.target).at(0) || null; // the next level up from the one picked
        return pathBack(kept, season, cat, { T: pick.target, reach, nextUp: nextUp.target, rank: P.seasonRank, formRank, bar: barOf(pick.target), above: above?.target ?? null });
      })(); }
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
      const lieCompare = lies && cmpDetailOK() ? lies.map((g) => avgOf(cmpField.map((p) => (sgBy(p.rounds, idx, null, "lie") || []).find((x) => x.label === g.label)?.perRound))) : null;
      blocks.push(lies && lies.length > 1
        ? el("div", { class: "sg-grid" }, [byCat, panelBox("SG by Lie", chartBox((c, as) => barChart(c, lies.map((g) => g.label), lies.map((g) => g.perRound), { as,
            title: "SG / round", compare: lieCompare, compareLabel: compareName(), tooltip: (i) => `${nf1.format(lies[i].shots)} attempts` }), "", "all-lie", { rankPick: !!lieCompare }))])
        : byCat);
      // (update 218) SG by Club: only with one category picked (below)
      // (update 229) the stats table with no category: SG: Total and each category, and the scoring averages
      blocks.unshift(panelBox(describe(), fullStatTable(mine, "", slicedField)), el("section", { class: "panel sg-box" }, fullStatTable(mine, "", slicedField, "elite")));
    } else {
      // (update 227) one full table, as on Compare (one column: this player): strokes gained a round in this part of the
      // game and at each distance, then every stat recorded for it (all distances, then each distance)
      blocks.push(panelBox(describe(), fullStatTable(mine, cat, slicedField)), el("section", { class: "panel sg-box" }, fullStatTable(mine, cat, slicedField, "elite")));

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
        const compare = !cmpDetailOK() ? null : groups.map((g) => {
          const vals = compareField.map((p) => (sgBy(p.rounds, idx, cat, fieldName) || []).find((x) => x.label === g.label)?.perRound).filter((v) => v !== undefined);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
        visuals.push(panelBox(title, chartBox((c, as) => barChart(c, groups.map((g) => g.label), groups.map((g) => g.perRound), { as,
          title: "SG / round", compare, compareLabel: compareName(), tooltip: (i) => `${nf1.format(groups[i].shots)} attempts`,
        }), "", `${cat}-${fieldName}`, { rankPick: !fieldIsSummary() })));
      }
      // (update 299) no SG by Club chart: products are on SG Trends (Show Product)
      if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));
    }

    const prodOn = !!st.showProduct; // (update 299) Show Product: each bar coloured by the product used
    // (update 302) Show Product: its own toggle, to the right of the Round / Event / Month / Year pills
    const toggles = el("div", { class: "trend-row" }, [
      el("div", { class: "subnav small trend-toggles" }, [["round", "Round"], ["event", "Event"], ["month", "Month"], ["year", "Year"]].map(([v, l]) => {
        const a = el("a", { href: "#", "aria-current": v === st.trendBy ? "page" : null }, l);
        a.addEventListener("click", (e) => { e.preventDefault(); st.trendBy = v; draw(); });
        return a;
      })),
      // (update 306) the same pill as Round / Event / Month / Year (white when on), so it lines up and keeps its size
      (() => { const b = el("a", { href: "#", role: "button", "aria-pressed": String(prodOn), "aria-current": prodOn ? "page" : null }, "Show Product");
        b.addEventListener("click", (e) => { e.preventDefault(); st.showProduct = !prodOn; draw(); });
        return el("div", { class: "subnav small trend-prod" }, b); })(),
    ]);
    if (prodOn) { blocks.push(productTrend(mine, cat, toggles)); return blocks; }
    const t = trend(mine, cat || null, st.trendBy);
    // Each round / event / month / year: the best result there (Top 1), the average of the best few (Top 10 …)
    // or of everyone (All), among the players who played it, this player included (so if they had the best
    // round, their bar meets the dot).
    const others = rankedField(slicedField).filter((p) => p.key !== me.key);
    const otherTrends = others.map((p) => trend(p.rounds, cat || null, st.trendBy));
    // (update 308) Personal Peak: its average (the same rounds as the table) as the dot on every bar
    const pkT = st.vsRank === "peak" && !soloTour ? curPeak() : null;
    const pkV = pkT && !pkT.short ? pkT.rounds.reduce((tt, rd) => tt + rd.shots.reduce((a, x) => a + (!cat || x.cat === cat ? x.sg : 0), 0), 0) / pkT.rounds.length : null;
    const tCompare = pkV != null ? t.map(() => pkV) : others.length ? t.map((g) => topMean([g.value, ...otherTrends.map((ot) => ot.find((x) => (x.id ?? x.label) === (g.id ?? g.label))?.value)])) : null;
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
      // (update 326) a percentage: how many of how many (made / hit, and the attempts)
      if (def.pct) {
        const a = statAgg(mine, narrowedNow());
        if (a.w > 0 && a.value != null) lines.push(`${Math.round((a.value * a.w) / 100).toLocaleString()} of ${Math.round(a.w).toLocaleString()} (successes of attempts).`);
      }
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
    const detailOK = cmpDetailOK(); // others' lie / distance detail (the admin); the shared summary has categories only
    // the gold dots: the same players as on the strokes-gained charts (none when there's nobody else to compare with)
    const cmpField = rankedField(slicedField).some((p) => p.key !== me.key) ? topPlayers(slicedField) : [];
    const tip = (groups) => (i) => (def.pct && groups[i].value != null // (update 326: a percentage: successes of attempts)
      ? `${Math.round((groups[i].value * groups[i].w) / 100).toLocaleString()} of ${Math.round(groups[i].w).toLocaleString()} attempts`
      : `${Math.round(groups[i].w).toLocaleString()} ${Math.round(groups[i].w) === 1 ? "attempt" : "attempts"}`);
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
      infoTip("The small number is how many attempts each value comes from.")], "full");
  }
  function statTrend(mine, slicedField) {
    const groups = groupBy(mine, st.trendBy);
    const vals = groups.map((g) => metric(g.rounds));
    // each round / event / month / year: the best result(s) there among the players who played it (this player included)
    const others = rankedField(slicedField).filter((p) => p.key !== me.key);
    const otherGroups = others.map((p) => groupBy(p.rounds, st.trendBy));
    const cmp = others.length ? groups.map((g, i) => topMean([vals[i], ...otherGroups.map((og) => { const x = og.find((y) => y.id === g.id); return x ? metric(x.rounds) : null; })], def.higher !== false)) : null;
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
      fieldIsSummary() && narrowed() ? infoTip("Rankings follow year, tournament, round and category, not lie or distance.") : null,
      !sg && def.higher === false ? infoTip("Lower is better, so the lowest is ranked first.") : !sg && def.higher == null ? infoTip("Ranked highest first (the file doesn\u2019t say whether higher is better).") : null,
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
  /* (update 299) SG Trends with Show Product: one kind of product (pills; one always picked), each bar coloured by the
     model used most in it, a legend on top, the products in the tap-up. Off-the-Tee's Driver / Non-Driver / Irons
     are its Tee Shot (Driver) / (Wood) / (Iron) shots. */
  const PROD_KINDS = { Driver: ["Driver"], "Non-Driver": ["Non-Driver", "Fairway Wood", "Hybrid"], Irons: ["Iron"], Wedges: ["Wedge"], Putters: ["Putter"], Balls: ["Ball"] };
  const PROD_FOR = { "": ["Driver", "Non-Driver", "Irons", "Wedges", "Putters", "Balls"], PUTT: ["Putters", "Balls"], OTT: ["Driver", "Non-Driver", "Irons", "Balls"],
    APP: ["Non-Driver", "Irons", "Wedges", "Balls"], ARG: ["Wedges", "Irons", "Balls"] };
  const PROD_COLORS = ["#d4b483", "#2f9bff", "#30d158", "#ff9f0a", "#bf5af2", "#ff453a", "#64d2ff", "#ffd60a", "#ac8e68", "#5e5ce6", "#ff6482", "#a2845e"];
  function productTrend(mine, cat, toggles) {
    const ottBand = { Driver: /driver/i, "Non-Driver": /wood|hybrid|non.?driver|3w|5w/i, Irons: /iron/i };
    const prodOf = (s, kind) => (kind === "Balls" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear || null);
    const fits = (s, kind) => {
      if (cat && s.cat !== cat) return false;
      if (kind === "Balls") return !!s.ball;
      if (cat === "OTT" && ottBand[kind]) return ottBand[kind].test(String(s.dist || "")) && !!s.gear;
      return !!s.gear && PROD_KINDS[kind].includes(gearInfo(s.gear).kind);
    };
    const kinds = PROD_FOR[cat || ""] || PROD_FOR[""];
    const has = kinds.filter((k) => mine.some((rd) => rd.shots.some((s) => fits(s, k))));
    if (!has.includes(st.productKind)) st.productKind = has[0] || kinds[0];
    const kind = st.productKind;
    const pills = el("div", { class: "subnav small trend-kinds", role: "radiogroup", "aria-label": "Product type" }, kinds.map((k) => {
      const on = k === kind, any = has.includes(k);
      const a = el("a", { href: "#", role: "radio", "aria-checked": String(on), "aria-current": on ? "page" : null, class: any ? null : "nav-off", title: any ? null : "No shots with this kind of product in this selection" }, k);
      a.addEventListener("click", (e) => { e.preventDefault(); if (any && !on) { st.productKind = k; draw(); } });
      return a;
    }));
    // the rounds, with only this kind's shots (rounds without any left out)
    const rs = mine.map((rd) => ({ ...rd, shots: rd.shots.filter((s) => fits(s, kind)) })).filter((rd) => rd.shots.length);
    if (!rs.length) return panelBox("SG Trends", [toggles, pills, el("p", { class: "muted small" }, "No product information on these shots: products come from Enter New Round (with WITB) or a club column in an uploaded file.")], "full");
    // grouped as SG Trends groups (round, event, month or year)
    const keyOf = (rd, i) => { const d = localDay(rd.date), ok = !isNaN(d);
      return st.trendBy === "round" ? `r${i}` : st.trendBy === "year" ? (ok ? String(d.getFullYear()) : "Unknown") : st.trendBy === "month" ? (ok ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "Unknown") : `${rd.event || rd.date || rd.key}|${ok ? d.getFullYear() : rd.year || ""}`; }; // (update 404: per year)
    const groups = new Map();
    rs.forEach((rd, i) => {
      const k = keyOf(rd, i), d = localDay(rd.date);
      const g = groups.get(k) || groups.set(k, { label: st.trendBy === "round" ? `${isNaN(d) ? rd.date : shortDate(d)}${rd.roundNo ? ` R${rd.roundNo}` : ""}` : st.trendBy === "month" && k !== "Unknown" ? new Date(`${k}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : st.trendBy === "event" ? (rd.event ? `${rd.event} ${isNaN(d) ? rd.year || "" : d.getFullYear()}`.trim() : rd.date || k) : k,
        short: st.trendBy === "event" && !isNaN(d) ? shortDate(d) : null, sg: 0, rounds: 0, event: rd.event, prods: new Map() }).get(k);
      g.rounds++; for (const s of rd.shots) { g.sg += s.sg; const p = prodOf(s, kind); if (p) g.prods.set(p, (g.prods.get(p) || 0) + (s.w || 1)); }
    });
    const list = [...groups.values()].map((g) => ({ ...g, value: g.sg / g.rounds, top: [...g.prods].sort((a, b) => b[1] - a[1])[0]?.[0] || null }));
    const used = new Map(); for (const g of list) for (const [p, n] of g.prods) used.set(p, (used.get(p) || 0) + n);
    // (update 302) each product's average: strokes gained a round with it (these shots), over the rounds it was used in
    const avgOf = new Map();
    for (const rd of rs) { const per = new Map(); for (const s of rd.shots) { const p = prodOf(s, kind); if (p) per.set(p, (per.get(p) || 0) + s.sg); } for (const [p, v] of per) { const a = avgOf.get(p) || { sg: 0, n: 0 }; a.sg += v; a.n++; avgOf.set(p, a); } }
    const order = [...used].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    const colorOf = (p) => PROD_COLORS[order.indexOf(p) % PROD_COLORS.length] || "#8e8e93";
    const nameOf = (p) => { const gi = gearInfo(p); return `${gi.brand} ${gi.model}`.trim() || p; };
    const legend = el("div", { class: "prod-legend" }, order.map((p) => { const a = avgOf.get(p);
      const v = a && a.n ? a.sg / a.n : null;
      return el("span", { class: "prod-key", title: a ? `${a.n} round${a.n === 1 ? "" : "s"} with it` : null }, [el("i", { style: `background:${colorOf(p)}` }), nameOf(p), v != null ? el("b", { class: v >= 0 ? "pos" : "neg" }, ` ${fmtSG(v)} avg`) : null]); }));
    return panelBox("SG Trends", [toggles, pills, legend, chartBox((c, as) => barChart(c, list.map((g) => g.label), list.map((g) => g.value), {
      title: `SG / round (${kind === "Balls" ? "every shot" : `${kind.toLowerCase()} shots`})`, as: "bar", colors: list.map((g) => colorOf(g.top)),
      shortLabels: list.map((g) => g.short),
      tooltip: (i) => { const g = list[i], all = [...g.prods].sort((a, b) => b[1] - a[1]);
        return [st.trendBy === "round" ? g.event : `${g.rounds} ${g.rounds === 1 ? "round" : "rounds"}`, ...all.map(([p, n]) => `${nameOf(p)}${all.length > 1 ? ` (${Math.round(n)} shot${Math.round(n) === 1 ? "" : "s"})` : ""}`)].filter(Boolean); },
    }), "wide", "trend-prod")], "full");
  }
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
  // (update 308) who the gold dots on the charts are, matching the comparison picked above the stats table:
  //   Personal Peak: the player's own best run of rounds (the same rounds as the table's "Vs best N rds");
  //   #1 / #10 / #25 / #50: that one player (the same golfer the table's "VS #N" uses), not an average of a group;
  //   All: every ranked player's average
  function topPlayers(list) {
    if (soloTour) return []; // (update 307: Practice or a typed-in tour: no comparisons)
    // (update 330) the dots are the selected stretch (Best Stretches above the stats table); nothing selected: no dots
    if (st.vsRank === "peak" && isSG()) { const pk = curPeak(); return pk && !pk.short ? [{ key: "__peak", label: "Elite rounds", rounds: pk.rounds }] : []; }
    void list;
    return [];
  }
  const vsNum = () => { const v = st.vsRank && st.vsRank !== "peak" ? st.vsRank : st.rankTop && st.rankTop !== "all" ? st.rankTop : null; return v ? Number(v) : null; };
  /** (update 315) The player ranked #n in this selection by the strokes gained on screen (SG: Total, or the one category
   *  picked: the #1 putter on Putting), the player on screen included: when they're #1, #1 is them. Table and dots alike. */
  function refPlayer(slicedField, n, cat = peakCtx?.cat || "") {
    const byTot = rankedField(slicedField).map((p) => ({ p, t: rowVals(p.rounds, cat).get(cat ? "sg" : "c:TOTAL") }))
      .filter((x) => x.t != null && Number.isFinite(x.t)).sort((a, b) => b.t - a.t);
    return byTot.length ? byTot[Math.min(n, byTot.length) - 1].p : null;
  }
  /** The player's best run of N rounds in a row (Peak Length), by the strokes gained the filters are about. */
  function peakOf(rounds, cat, peakN) {
    const ordered = [...rounds].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const scored = ordered.map((rd) => { let t = 0, any = false; for (const x of rd.shots) if (!cat || x.cat === cat) { t += x.sg; any = true; } return { rd, t, any }; }).filter((x) => x.any);
    if (scored.length < peakN) return { map: new Map(), rounds: [], short: true, have: scored.length };
    // (update 299) the best stretch of N rounds in a row (oldest first), by the filters' total
    const seq = [...scored].sort((x, y) => String(x.rd.date || "").localeCompare(String(y.rd.date || "")));
    let sum = 0, bestSum = -Infinity, bestAt = 0;
    seq.forEach((x, i) => { sum += x.t; if (i >= peakN) sum -= seq[i - peakN].t; if (i >= peakN - 1 && sum > bestSum) { bestSum = sum; bestAt = i - peakN + 1; } });
    const best = seq.slice(bestAt, bestAt + peakN).map((x) => x.rd);
    return { map: rowVals(best, cat), rounds: best, short: false };
  }
  /** (update 335) Elite rounds: the player's best n rounds by the strokes gained the filters are about, in any order
   *  (oldest first, as everywhere). */
  function eliteOf(rounds, cat, n) {
    const scored = stretchSeq(rounds, cat);
    if (scored.length < n) return { map: new Map(), rounds: [], short: true, have: scored.length };
    const best = [...scored].sort((a, b) => b.t - a.t).slice(0, n).map((x) => x.rd).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    return { map: rowVals(best, cat), rounds: best, short: false, elite: true };
  }
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
  // (update 322) the peak's dates as a filter: the page shows just those rounds (from the top); a chip clears it
  function setRange(r) {
    if (!r?.from || !r?.to) return;
    st.dateRange = r;
    const ys = [...new Set([r.from.slice(0, 4), r.to.slice(0, 4)])];
    st.year = ys; st.yearKept = ys; st.span = 0;
    draw();
    setTimeout(() => { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); } }, 80); // (after the redraw puts your place back)
  }
  function rangeChip() {
    if (!st.dateRange) return null;
    const b = el("button", { type: "button", class: "range-chip", title: "Show every date again" }, [`Dates: ${st.dateRange.label}`, el("span", { "aria-hidden": "true" }, " \u00d7")]);
    b.addEventListener("click", () => { st.dateRange = null; draw(); });
    return el("div", { class: "range-chip-row" }, b);
  }
  // (update 322) Needed for #1: the longest run of rounds in a row whose average would still rank #1 (else #10, #25,
  // #50), by the strokes gained on screen, against everyone else's average for this selection
  function peakNeeded() {
    const { mine = [], cat = "" } = peakCtx || {};
    const key = cat ? "sg" : "c:TOTAL";
    const others = rankedField(lastSliced || []).filter((p) => p.key !== me?.key).map((p) => rowVals(p.rounds, cat).get(key)).filter((v) => v != null && Number.isFinite(v));
    const seq = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
      .map((rd) => { let t = 0, any = false; for (const x of rd.shots) if (!cat || x.cat === cat) { t += x.sg; any = true; } return any ? t : null; }).filter((t) => t != null);
    if (!seq.length || !others.length) { st.peakMsg = "Not enough rounds or players in this selection."; draw(); return; }
    const pre = [0]; for (const t of seq) pre.push(pre.at(-1) + t);
    const bestAvg = (n) => { let best = -Infinity; for (let i = n; i < pre.length; i++) best = Math.max(best, pre[i] - pre[i - n]); return best / n; };
    const rankOf = (v) => 1 + others.filter((x) => x > v + 1e-12).length;
    const who = me?.label || "The player";
    for (const target of [1, 10, 25, 50]) {
      for (let n = seq.length; n >= 1; n--) {
        if (rankOf(bestAvg(n)) <= target) {
          st.peakN = n; st.peakMsgN = n;
          st.peakMsg = `#${target} from best ${n} ${n === 1 ? "round" : "rounds"}`; // (update 323)
          draw(); return;
        }
      }
    }
    st.peakN = 1; st.peakMsgN = 1;
    st.peakMsg = `${who}\u2019s best single round would rank ${ordinal(rankOf(bestAvg(1)))}.`;
    draw();
  }
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
  function topPills(label = null) {
    // (update 228) Top 1 / 10 / 25 / 50 / All: who the gold dots and the "All Players" column are
    return el("div", { class: "top-pills" }, [label ? el("span", { class: "ms-label" }, label) : null, el("div", { class: "seg small" }, RANK_TOPS.map(([v, l]) => {
      const on = (st.rankTop || "all") === v;
      const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, l);
      b.addEventListener("click", () => { st.rankTop = v; st.rankTopManual = true; st.rankTopFor = me?.key; draw(); });
      return b;
    }))]);
  }
  // (update 330) Best Stretches, above the stats table (it replaces the #1 / #10 / #25 / #50 player comparisons):
  //   the ladder: for #1, #10, #25 and #50, the longest run of rounds in a row whose average would rank there (by the
  //   strokes gained the filters are about, against everyone else's average for this selection); or any length you pick.
  //   Selecting one shows when it was, what was working (and the equipment), and every stat: the stretch next to the season.
  function stretchSeq(mine, cat) {
    return [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
      .map((rd) => { let t = 0, any = false; for (const x of rd.shots) if (!cat || x.cat === cat) { t += x.sg; any = true; } return any ? { rd, t } : null; }).filter(Boolean);
  }
  function ladderRows(mine, cat) {
    const key = cat ? "sg" : "c:TOTAL";
    const others = rankedField(lastSliced || []).filter((p) => p.key !== me?.key).map((p) => rowVals(p.rounds, cat).get(key)).filter((v) => v != null && Number.isFinite(v));
    const seq = stretchSeq(mine, cat);
    if (!seq.length || !others.length) return null;
    const pre = [0]; for (const x of seq) pre.push(pre.at(-1) + x.t);
    const best = (n) => { let b = -Infinity, at = 0; for (let i = n; i < pre.length; i++) { const v = pre[i] - pre[i - n]; if (v > b) { b = v; at = i - n; } } return { avg: b / n, at }; };
    const rankOf = (v) => 1 + others.filter((x) => x > v + 1e-12).length;
    const seasonRank = rankOf(pre.at(-1) / seq.length);
    const memo = new Map(); const bestM = (n) => (memo.has(n) ? memo.get(n) : (memo.set(n, best(n)), memo.get(n)));
    // (update 334) Elite Round Share for each mark: the most of their best rounds (any order) that together still reach it
    const desc = seq.map((x) => x.t).sort((a, b) => b - a);
    const shareFor = (target) => { let k = 0, sum = 0; for (let i = 0; i < desc.length; i++) { sum += desc[i]; if (rankOf(sum / (i + 1)) <= target) k = i + 1; else break; } return { k, of: desc.length, pct: desc.length ? k / desc.length : 0 }; };
    const out = [1, 10, 25, 50].map((target) => ({ ...rung(target), share: shareFor(target) }));
    // (update 348) for the profile: every round (best first), how to rank an average, the field size, the overall rank
    out.prof = { desc, rankOf, N: others.length + 1, seasonRank, field: [...others].sort((a, b) => b - a), avg: pre.at(-1) / seq.length };
    return out;
    function rung(target) {
      if (seasonRank <= target) return { target, already: true, rank: seasonRank };
      for (let n = seq.length; n >= 1; n--) {
        const b = bestM(n);
        if (rankOf(b.avg) <= target) return { target, n, from: seq[b.at].rd.date, to: seq[b.at + n - 1].rd.date };
      }
      return { target, none: true, bestRound: rankOf(bestM(1).avg) };
    }
  }
  const shortDay = (d) => { const x = new Date(`${String(d || "").slice(0, 10)}T12:00:00`); return isNaN(x) ? String(d || "") : x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  function selectStretch(n, target = null) {
    if (st.vsRank === "peak" && st.peakN === n && (st.ladderT ?? null) === target) { st.vsRank = null; st.ladderT = null; }
    else { st.vsRank = "peak"; st.peakN = n; st.ladderT = target; }
    draw();
  }
  /** What was working in the stretch: where it gained most over the season, and the equipment in the bag. */
  function whatWorked(stretch, season0, cat) {
    const out = [];
    // (update 344) against the non-elite rounds (every round in the time frame except these), not the average with them in
    const inStretch = new Set(stretch), season = season0.filter((rd) => !inStretch.has(rd));
    const restName = NM().cut;
    const per = (rs, f) => { if (!rs.length) return 0; let t = 0; for (const rd of rs) for (const x of rd.shots) if (f(x)) t += x.sg; return t / rs.length; };
    const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
    const f2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
    // the parts of the game (or, one category picked: its distances) that gained the most against the other rounds, each
    // split (update 345) into playing better per shot and facing different shots (more of the strong, fewer of the weak)
    const bS = bucketsOf(stretch), bN = bucketsOf(season), bU = bucketsOf(season0);
    const nN = Math.max(1, season.length);
    const sp = (pre) => groupSplit(bS, stretch.length, bN, nN, (k) => k.startsWith(pre), bU);
    const dists = (c) => [...new Set([...bS.keys(), ...bN.keys()].filter((k) => k.startsWith(`${c}|`)).map((k) => k.split("|")[1]).filter(Boolean))];
    const parts = cat ? dists(cat).map((d) => ({ name: d, pre: `${cat}|${d}|` })) : CATEGORIES.map(([c]) => ({ name: catName(c), k: c, pre: `${c}|` }));
    const gains = parts.map((p) => { const t = sp(p.pre); return { ...p, ...t, a: t.ae * t.pe, b: t.ab * t.pb }; })
      .filter((p) => p.total > 0.005).sort((x, y) => y.total - x.total).slice(0, 2);
    // (update 356) each part of the game as a heading line, then one short labelled line per point
    for (const g of gains) {
      // (update 358) the plain-English takeaway first, then the numbers behind it
      const mostlyMix = g.mix > 0 && g.mix >= 0.7 * g.total, mostlySkill = g.skill >= 0.7 * g.total;
      const take = `${g.name} was ${sgn2(g.total)} a round better in the ${NM().kept}: ${mostlySkill ? "nearly all of it from hitting the same shots better." : mostlyMix ? `mostly from facing different shots (${mixLead(g)}), not from hitting them better. ${MIX_CAUSE[g.k || cat] || ""}` : `partly from hitting the shots better, partly from facing different ones (${mixLead(g)}).`}`;
      const rowsOut = [kv("Takeaway", take, "bs-take"), kv("Hitting it better", `${sgn2(g.skill)} a round`)];
      if (Math.abs(g.mix) >= 0.02) rowsOut.push(kv("Facing different shots", `${sgn2(g.mix)} a round (${mixWords(g, sgn2)})`));
      if (!cat && g.k) { // the distance they played best (per shot) in these rounds
        const ds = dists(g.k).map((d) => ({ d, s: sp(`${g.k}|${d}|`) })).filter((x) => x.s.skill > 0.005).sort((a, b) => b.s.skill - a.s.skill);
        if (ds[0]) { const x = ds[0].s; rowsOut.push(kv("Biggest change", `${ds[0].d}: ${sgn2(x.total)} a round better in the ${NM().kept} (${sgn2(x.skill)} from hitting it better: ${sgn2(x.pe)} a shot against ${sgn2(x.pb)}${Math.abs(x.mix) >= 0.01 ? `; ${sgn2(x.mix)} from facing ${x.ae < x.ab ? "fewer" : "more"} of them` : ""})`)); }
      }
      out.push([el("div", { class: "bs-item-head" }, [el("strong", {}, g.name), el("span", { class: "muted" }, ` ${sgn2(g.a)} a round in the ${NM().kept} \u00b7 ${sgn2(g.b)} in the ${restName}`)]), ...rowsOut]);
    }
    if (!gains.length) out.push("No part of the game stands out: it was a little better everywhere.");
    // (update 337) the equipment: in each kind, what was used most in these rounds; and, if another of that kind was used
    // less but played better (strokes gained a shot, 5 shots or more), that one in brackets
    const byKind = new Map(); for (const g of gearList(stretch)) (byKind.get(g.kind) || byKind.set(g.kind, []).get(g.kind)).push(g);
    const nm = (g) => `${g.brand} ${g.model}`.trim();
    const f3 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}`;
    const kit = [...byKind.values()].map((list) => {
      const most = [...list].sort((a, b) => b.shots - a.shots)[0];
      const per = (g) => (g.shots ? g.sg / g.shots : null);
      const better = list.filter((g) => g !== most && g.shots >= 5 && per(g) != null && per(most) != null && per(g) > per(most) + 1e-9).sort((a, b) => per(b) - per(a))[0];
      return { shots: most.shots, text: [el("span", { class: "bs-kit-kind" }, String(most.kind || "").replace(/^\w/, (c) => c.toUpperCase())), ` ${nm(most)}`,
        better ? el("div", { class: "bs-kit-better muted small" }, `Played better with the ${nm(better)}: ${f3(per(better))} a shot against ${f3(per(most))}`) : null] };
    }).sort((a, b) => b.shots - a.shots).slice(0, 6).map((x) => x.text);
    if (kit.length) out.push([el("div", { class: "bs-item-head" }, el("strong", {}, "In the bag")), el("ul", { class: "bs-kit" }, kit.map((t) => el("li", {}, t)))]);
    return out;
  }
  // (update 335) Elite Round Share, above the stats table: for #1, #10, #25 and #50, the most of the player's best rounds
  // (in any order) that together average at that rank, as a share of all their rounds. Tap one (or pick a number of
  // rounds) to see those rounds: what was working, the equipment, and every stat next to their average.
  /** (update 353) What the two sets of rounds are called: the best rounds picked (kept) and the rest (cut). For the
   * Best on Tour box they're the elite rounds; for the other levels, the rounds kept and the rounds cut to get there. */
  function NM() {
    // (update 354) always the kept rounds and the cut rounds, whichever level is picked
    const T = st.ladderT;
    const lvl = !showRanks ? "their best" : T && LEVELS[T] ? LEVELS[T] : LEVELS[1];
    return { kept: "kept rounds", cut: "cut rounds", Kept: "Kept", Cut: "Cut", lvl, T: showRanks ? T || 1 : null };
  }
  function stretchesBlock(mine, cat) {
    const what = cat ? `${CATEGORIES.find(([k]) => k === cat)?.[1] || cat} ` : "";
    const rows = ladderRows(mine, cat);
    st.peakMode = "elite";
    const sel = st.vsRank === "peak" ? Math.max(1, Math.round(Number(st.peakN) || 10)) : null;
    const help = el("details", { class: "bs-help" }, [el("summary", { "aria-label": "What is this?" }, "\u24d8"),
      el("p", { class: "muted small" }, "How much of the player\u2019s golf was at each level (their best rounds, in any order, that together would rank there), and the other way round: how many of their worst rounds they\u2019d have to cut to get there."),
      el("p", { class: "muted small" }, "The four levels are named for what they mean on Tour. Best on Tour (#1): the season average of the best player in this selection. Contender (#10): a top-10 player, in contention most weeks. Tour Championship level (#25): around the top 30 who make the Tour Championship. Signature event level (#50): the top 50 who earn spots in the signature events. Each level is the average a player would need over the selected rounds to rank there in this field, so on other tours\u2019 data the names are a guide, not a fact."),
      el("p", { class: "muted small" }, "Elite Round Share asks how much of a player\u2019s golf was at each level. Take their best rounds, in any order, and keep adding the next best while the average of the ones taken would still rank at that level. The share is how many rounds that is, out of all their rounds. Seen the other way, the rest are the rounds they\u2019d have to cut: Next steps lists, from where they sit now, how many of their worst rounds each level above would take to cut (or how much better every round would have to be). Tap a box or a step to see the rounds: the ones to cut, what set the kept rounds apart, what hurt in the cut ones, and the path to get there."),
      el("p", { class: "muted small" }, "The line under the boxes says how much #1-level golf is in them, and their best stretch: the longest run of rounds in a row whose average on its own would rank #1, and where that ranks among every player\u2019s longest (the Elite Stretches table on the Leaderboards). Tap its dates to see just those rounds."),
      el("p", { class: "muted small" }, "The path compares the kept rounds with the cut rounds: the gap between them in strokes, the five parts of the game and distances that make up most of it, a target in plain stats where the file has one, when the kept rounds tend to come, and practice to match. What helped during the kept rounds and what hurt during the cut rounds sit above the table. It\u2019s worked out from the numbers on the page, not by AI."),
      el("p", { class: "muted small" }, "Per shot or how often: every difference in strokes gained is split in two. Per shot is playing the same shots better. How often is facing different shots at the same level per shot (by distance and lie), split again into more of their strong shots (ones they gain strokes on) and fewer of their weak ones (ones they lose strokes on). When a difference is mostly how often, it\u2019s a strategy question (or the shot before it), so it gets a strategy note instead of a drill; Where the shots came from lists the biggest of these.")]);
    // (update 342) no rankings (only the player's own practice or entered rounds): no #1 / #10 ladder to measure against,
    // so it's simply their best N rounds (10 to start)
    if (!showRanks) {
      const inp = el("input", { type: "number", class: "peak-len", min: "1", max: "500", step: "1", value: String(sel || 10), inputmode: "numeric", "aria-label": "How many of their best rounds" });
      const apply = () => { const n = Math.round(Number(inp.value)); if (!Number.isFinite(n) || n < 1) { inp.value = String(sel || 10); return; } const v = Math.min(500, n); if (sel === v) return; st.vsRank = "peak"; st.peakN = v; st.ladderT = null; draw(); };
      inp.addEventListener("change", apply);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      const show = el("button", { type: "button", class: "btn ghost small bs-go" }, "Show");
      show.addEventListener("click", () => { if (!sel) { st.vsRank = "peak"; st.peakN = Math.max(1, Math.round(Number(inp.value)) || 10); st.ladderT = null; draw(); } else apply(); });
      const clear = sel ? (() => { const c = el("button", { type: "button", class: "link small" }, "Clear"); c.addEventListener("click", () => { st.vsRank = null; st.ladderT = null; draw(); }); return c; })() : null;
      const pick = el("div", { class: "bs-pick peak-len-wrap" }, [el("span", { class: "muted small" }, "Their best"), inp, el("span", { class: "muted small" }, "rounds"), sel ? null : show, clear]);
      return el("div", { class: "bs" }, [
        el("div", { class: "bs-title" }, [el("span", { class: "ms-label" }, `${what ? `${what.trim()} ` : ""}Best Rounds`), el("details", { class: "bs-help" }, [el("summary", { "aria-label": "What is this?" }, "\u24d8"),
          el("p", { class: "muted small" }, "These rounds aren\u2019t ranked against other players, so there\u2019s no #1 or #10 level to measure against. Pick how many of their best rounds to look at: what was working, what was in the bag, every stat from them next to their average, and the path back to playing like that.")])]),
        pick, elitePart(),
      ]);
    }
    const ladder = rows ? el("div", { class: "bs-ladder", role: "list" }, rows.map((r) => {
      const k = r.share?.k || 0;
      const on = !!(sel && k && sel === k && st.ladderT === r.target);
      // (update 353) the level's name, the share of rounds at it, and (the other way round) how many of the worst rounds to cut
      const of = r.share?.of || 0;
      // (update 361) the next steps live in the cards: cut the worst N rounds, or gain this much a round across every round
      const P = rows.prof, bar = P?.field?.[r.target - 1], gain = bar != null && P ? Math.max(0.01, bar - P.avg + 0.005) : null;
      const body = [el("span", { class: "bs-pct" }, `${Math.round((r.share?.pct || 0) * 100)}%`),
        ...(r.already ? [el("span", { class: "bs-when muted" }, `all ${of} rounds`), el("span", { class: "bs-when bs-there" }, `Already there (${ordinal(r.rank)})`)]
          : [el("span", { class: "bs-when muted" }, k ? `best ${k} of ${of}` : `best round ranks ${ordinal(r.bestRound ?? r.share?.bestRound ?? 0)}`),
            k ? el("span", { class: "bs-when" }, `Cut the worst ${of - k}, or`) : null,
            gain != null ? el("span", { class: "bs-when" }, `Gain ${sgn2(gain)} a round`) : null])];
      const b = el(k ? "button" : "div", { type: k ? "button" : null, class: `bs-row${on ? " on" : ""}${k ? "" : " flat"}`, role: "listitem", "aria-pressed": k ? String(on) : null }, [el("span", { class: "bs-rank" }, [el("span", { class: "bs-lvl" }, LEVELS[r.target]), el("span", { class: "bs-lvl-n" }, ` #${r.target}`)]), ...body]);
      if (k) b.addEventListener("click", () => selectStretch(k, r.target));
      return b;
    })) : el("p", { class: "muted small" }, "Not enough rounds or players in the selected time frame.");
    function elitePart() {
    let detail = null;
    if (sel) {
      const pk = curPeak();
      if (!pk || pk.short) detail = el("p", { class: "muted small" }, `Only ${pk?.have ?? 0} ${what}rounds in the selected time frame: fewer than ${sel}. Pick fewer or widen the filters.`);
      else {
        const season = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
        const share = Math.round((sel / Math.max(1, season.length)) * 100);
        const sgR = (rd) => { let t = 0; for (const x of rd.shots) if (!cat || x.cat === cat) t += x.sg; return t; };
        // (update 357) one line for a set of rounds, the kept ones or the cut ones: how many, which tournaments (tap for the
        // list: by tournament, or round by round), and the dates. Kept: best first; cut: worst first.
        function roundsLine(label, rounds, key, worstFirst) {
          const byDate = [...rounds].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
          const evs = new Set(rounds.map((rd) => `${rd.event}|${String(rd.date || "").slice(0, 4)}`)).size;
          const first = byDate[0]?.date, last = byDate.at(-1)?.date;
          const open = !!st[`${key}EvOpen`];
          const byEv = new Map();
          for (const rd of rounds) { const k2 = `${rd.event}|${String(rd.date || "").slice(0, 4)}`; const g = byEv.get(k2) || byEv.set(k2, { event: rd.event || "Tournament", first: rd.date, rs: [] }).get(k2); g.rs.push(rd); }
          const allAt = (g) => season.filter((rd) => rd.event === g.event && String(rd.date || "").slice(0, 4) === String(g.first || "").slice(0, 4)).length;
          const dir = worstFirst ? 1 : -1;
          const link = el("button", { type: "button", class: "link bs-evs-btn", "aria-expanded": String(open) }, `${evs} ${evs === 1 ? "tournament" : "tournaments"} ${open ? "\u25B4" : "\u25BE"}`);
          link.addEventListener("click", () => { st[`${key}EvOpen`] = !open; draw(); });
          const byEvent = () => el("ul", { class: "bs-evs" }, [...byEv.values()].map((g) => ({ ...g, avg: g.rs.reduce((t, rd) => t + sgR(rd), 0) / g.rs.length })).sort((a, b) => dir * (a.avg - b.avg)).map((g) => {
            const nums = g.rs.map((rd) => rd.roundNo).filter((x) => x != null && x !== "").sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)).map((x) => `R${x}`);
            return el("li", {}, [el("span", { class: "bs-ev-name" }, g.event), el("span", { class: "muted" }, ` \u00b7 ${shortDay(g.first)} \u00b7 ${g.rs.length} of ${allAt(g)} ${allAt(g) === 1 ? "round" : "rounds"}${nums.length ? ` (${nums.join(", ")})` : ""} \u00b7 `), el("span", { class: g.avg >= 0 ? "pos" : "neg" }, `${sgn2(g.avg)} a round`)]);
          }));
          // (update 363) always round by round; tap a round for its strokes gained by part of the game, and each part
          // of the game for its distances
          const rKey = (rd) => `${String(rd.date || "").slice(0, 10)}|${rd.event || ""}|${rd.roundNo ?? ""}`;
          const roundDetail = (rd) => {
            const by = new Map();
            for (const x of rd.shots) { if (!x.cat) continue; const c = by.get(x.cat) || by.set(x.cat, { sg: 0, n: 0, d: new Map() }).get(x.cat); c.sg += x.sg; c.n += x.w || 1; if (x.dist) { const dd = c.d.get(x.dist) || c.d.set(x.dist, { sg: 0, n: 0 }).get(x.dist); dd.sg += x.sg; dd.n += x.w || 1; } }
            const open = new Set(st.rdCats || []);
            return el("div", { class: "bs-rd" }, CATEGORIES.filter(([c]) => by.has(c)).flatMap(([c, l]) => {
              const v = by.get(c), ds = [...v.d].sort((a, b) => distLead(a[0]) - distLead(b[0]) || a[0].localeCompare(b[0]));
              const row = el("button", { type: "button", class: "bs-rd-row", "aria-expanded": String(open.has(c)), disabled: !ds.length }, [
                el("span", { class: "bs-rd-l" }, [ds.length ? el("span", { class: "cmp-caret" }, open.has(c) ? "\u25BE " : "\u25B8 ") : null, l]),
                el("span", { class: `bs-rd-v ${v.sg >= 0 ? "pos" : "neg"}` }, sgn2(v.sg))]);
              row.addEventListener("click", (e) => { e.stopPropagation(); const n = new Set(st.rdCats || []); n.has(c) ? n.delete(c) : n.add(c); st.rdCats = [...n]; draw(); });
              // (shots with no distance in the file: one more line, so the distances add up to the part of the game)
              const restSg = v.sg - ds.reduce((t, [, x]) => t + x.sg, 0), restN = v.n - ds.reduce((t, [, x]) => t + x.n, 0);
              const sub = (lbl, sg, n) => el("div", { class: "bs-rd-row sub" }, [el("span", { class: "bs-rd-l" }, `${lbl} \u00b7 ${Math.round(n)} ${Math.round(n) === 1 ? "shot" : "shots"}`), el("span", { class: `bs-rd-v ${sg >= 0 ? "pos" : "neg"}` }, sgn2(sg))]);
              return [row, ...(open.has(c) ? [...ds.map(([d, x]) => sub(d, x.sg, x.n)), ...(Math.abs(restSg) >= 0.005 && restN > 0 ? [sub("Other shots", restSg, restN)] : [])] : [])];
            }));
          };
          const byRound = () => el("ul", { class: "bs-evs" }, rounds.map((rd) => ({ rd, v: sgR(rd) })).sort((a, b) => dir * (a.v - b.v)).map(({ rd, v }) => {
            const on = st.rdOpen === rKey(rd);
            const li = el("li", { class: `bs-rd-li${on ? " on" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(on) }, [
              el("div", { class: "bs-rd-head" }, [el("span", { class: v >= 0 ? "pos" : "neg" }, sgn2(v)), el("span", { class: "muted" }, " \u00b7 "), el("span", { class: "bs-ev-name" }, rd.event || "Tournament"),
                el("span", { class: "muted" }, `${rd.roundNo != null && rd.roundNo !== "" ? ` \u00b7 R${rd.roundNo}` : ""} \u00b7 ${shortDay(rd.date)}`)]),
              on ? roundDetail(rd) : null]);
            const tog = () => { st.rdOpen = on ? null : rKey(rd); draw(); };
            li.addEventListener("click", tog); li.addEventListener("keydown", (e) => { if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tog(); } });
            return li;
          }));
          const pct = Math.round((rounds.length / Math.max(1, season.length)) * 100);
          return [el("p", { class: "bs-head" }, [el("strong", {}, `${label}: the ${worstFirst ? "worst" : "best"} ${rounds.length} of ${season.length} (${pct}%) by ${cat ? `SG: ${what.trim()}` : "SG: Total"}`),
            ...(rounds.length ? [` \u00b7 from `, link, `${first ? `, ${shortDay(first)} \u2013 ${shortDay(last)}` : ""}.`] : ["."])]),
            open && rounds.length ? el("div", { class: "bs-evs-wrap" }, [byRound()]) : null];
        }
        const N0 = NM();
        const keptSet = new Set(pk.rounds);
        const cutRounds = season.filter((rd) => !keptSet.has(rd));
        detail = el("div", { class: "bs-detail" }, [
          ...(N0.T && N0.T !== 1 ? [el("p", { class: "bs-head" }, el("strong", {}, `${N0.lvl} (#${N0.T}): their best ${sel} of ${season.length} rounds would rank #${N0.T}.`))] : []),
          ...roundsLine("Kept rounds", pk.rounds, "kept", false),
          ...roundsLine("Cut rounds", cutRounds, "cut", true),
          // (update 362) What helped / What hurt / Where the shots came from: taken out (the path below covers it)
        ]);
      }
    }
    return detail;
    }
    const detail = showRanks ? elitePart() : null;
    return el("div", { class: "bs" }, [
      el("div", { class: "bs-title" }, [el("span", { class: "ms-label" }, `${what ? `${what.trim()} ` : ""}Elite Round Share`), help]),

      rows?.prof ? el("p", { class: "bs-now" }, [`Currently `, el("strong", {}, ordinal(rows.prof.seasonRank)), ` of ${rows.prof.N} (${sgn2(rows.prof.avg)} a round)`]) : null,
      ladder, profileLine(mine, cat, rows), detail,
    ]);
  }
  /* (update 345) Where the shots came from: the parts of the game and distances where elite rounds simply had more of the
   * player's strong shots or fewer of their weak ones (at the same per-shot level), and what that was worth. */
  function shotMix(elite, season, cat) {
    const eSet = new Set(elite), rest = season.filter((rd) => !eSet.has(rd));
    if (!rest.length) return { items: [], total: null };
    const inCat = (x) => !cat || x.cat === cat;
    const bE = bucketsOf(elite, inCat), bN = bucketsOf(rest, inCat), bU = bucketsOf(season, inCat);
    const total = groupSplit(bE, elite.length, bN, rest.length, () => true, bU);
    const f2 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
    const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
    // (update 358) the biggest pieces both ways (helped and hurt), so the list adds up to the summary; putting and short-game
    // counts are a result of the shot before, not a choice
    const items = [...new Set([...bE.keys(), ...bN.keys()])].filter((k) => k.split("|")[1])
      .map((k) => ({ k, s: splitOf(bE.get(k), elite.length, bN.get(k), rest.length, bU.get(k)) }))
      .filter((x) => Math.abs(x.s.mix) >= 0.08 && (bN.get(x.k)?.n || 0) >= 5).sort((a, b) => Math.abs(b.s.mix) - Math.abs(a.s.mix)).slice(0, 4)
      .map(({ k, s: x }) => { const [c, d] = k.split("|"); const fewer = x.ae < x.ab, helped = x.mix > 0;
        const choice = c === "OTT" || c === "APP";
        const kindTxt = x.pu < 0 ? "a shot they usually lose strokes on" : "a shot they usually gain strokes on";
        return [el("div", { class: "bs-item-head" }, [el("strong", {}, `${catName(c)} \u00b7 ${d}`), el("span", { class: helped ? "pos" : "neg" }, ` ${helped ? "helped" : "hurt"} ${sgn2(x.mix)} a round`)]),
          kv("Takeaway", `The ${NM().kept} had ${fewer ? "fewer" : "more"} of these (${x.ae.toFixed(1)} a round, against ${x.ab.toFixed(1)}), and it\u2019s ${kindTxt} (${sgn2(x.pu)} a shot). ${choice ? MIX_CAUSE[c] : "That comes from the shot before, not a choice."}`)];
      });
    return { items, total };
  }
  /* (update 343) What hurts in the other rounds (moved up under What was working): a part of the game costing a stroke
   * or more in a round, and bad positions traced back to the shot that put them there. Text only. */
  function whatHurts(elite, season, cat) {
    const N = NM();
    const eSet = new Set(elite), others = season.filter((rd) => !eSet.has(rd));
    const f2 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
    const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
    // what hurts: a part of the game costing a stroke or more in a round, and bad positions (approach / short game from rough, sand,
    // recovery) that happen more often in the rest than in the best rounds
    const avoid = [];
    const per = (rs, pred) => (rs.length ? rs.reduce((t, rd) => { let n = 0; for (const x of rd.shots) if (pred(x)) n += x.w || 1; return t + n; }, 0) / rs.length : 0);
    // (the data is grouped by part of the game, lie and distance, not single shots, so "bad" is judged a round at a time:
    // how often a part of the game cost them a stroke or more in a round, in the rest against the best rounds)
    const roundSg = (rd, c) => { let t = 0; for (const x of rd.shots) if (x.cat === c) t += x.sg; return t; };
    const badShare = (rs, c) => (rs.length ? rs.filter((rd) => roundSg(rd, c) <= -1).length / rs.length : 0);
    const where = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
    for (const [c] of CATEGORIES) {
      if (cat && c !== cat) continue;
      const o = badShare(others, c), e = badShare(elite, c);
      if (others.length >= 3 && o - e >= 0.15) avoid.push({ v: (o - e) * 1.5, t: `${where[c] || catName(c)} cost them a stroke or more in ${Math.round(o * 100)}% of ${N.cut}, against ${Math.round(e * 100)}% of ${N.kept}.` });
    }
    // bad lies: more approaches from the rough (or short-game shots from off the green) usually isn't a rough problem, it's
    // the shot before. So: if they played as well as usual from there, point at the shot that put them there (driving for
    // approaches, approach for the short game); only if they also played worse from there is the lie itself something to work on.
    const pa = (rs, pL) => { let sg = 0, n = 0; for (const rd of rs) for (const x of rd.shots) if (pL(x)) { sg += x.sg; n += x.w || 1; } return { v: n ? sg / n : null, n }; };
    const rootOf = { APP: { c: "OTT", what: "getting there off the tee", stat: /^fwy/i }, ARG: { c: "APP", what: "missing greens", stat: /^gir/i } };
    for (const c of ["APP", "ARG"]) {
      if (cat && c !== cat) continue;
      const lies = new Set(); for (const rd of others) for (const x of rd.shots) if (x.cat === c && x.lie && !/fairway|green|tee/i.test(x.lie)) lies.add(x.lie);
      for (const lie of lies) {
        const pL = (x) => x.cat === c && x.lie === lie;
        const o = per(others, pL), e = per(elite, pL);
        if (o - e < 0.5) continue;
        // strokes gained already allows for how hard the lie is, so the test is against the tour baseline (zero): losing
        // 0.08 or more an attempt from there is a problem with the shots themselves. (Elite rounds were picked for being
        // good, so their numbers from the rough are flattered and aren't a fair yardstick.)
        const po = pa(others, pL);
        const worse = po.v != null && po.v <= -0.08;
        const root = rootOf[c], lieName = String(lie).toLowerCase();
        // the stat behind the root cause (fairways for driving, greens hit for approach), when the file has it
        const sm = (rs) => { let t = 0, w = 0; for (const rd of rs) for (const ob of rd.obs || []) if (!ob.cat && root.stat.test(ob.k)) { t += ob.v * ob.w; w += ob.w; } return w ? t / w : null; };
        const so = sm(others), se = sm(elite);
        const statBit = so != null && se != null && se > so ? ` ${c === "APP" ? "Fairways hit" : "Greens hit"}: ${so.toFixed(0)}% in ${N.cut}, ${se.toFixed(0)}% in ${N.kept}.` : "";
        const head = `${c === "APP" ? "Approaches" : "Short-game shots"} from the ${lieName}: ${o.toFixed(1)} attempts a round in ${N.cut}, ${e.toFixed(1)} in ${N.kept}.`;
        const t = worse
          ? `${head} They also lost ground from there (${f2(po.v)} an attempt against the tour baseline), so it\u2019s both: ${root.what} and the shots from the ${lieName}.${statBit}`
          : `${head} From there they held their own (${f2(po.v)} an attempt against the tour baseline), so the problem is ${root.what}, not the ${lieName} shots.${statBit}`;
        avoid.push({ v: (o - e) * 0.3 + (worse ? -po.v * o : 0), t });
      }
    }
    avoid.sort((a, b) => b.v - a.v);
    return avoid.slice(0, 3).map((a) => a.t);
  }
  /* (update 353) Next steps: from where they sit now, each level above, nearest first: how many of their worst rounds they\u2019d
   * have to cut to get there (or how much better every round would have to be). Tap one to see the rounds to cut and what
   * set them apart. */
  function nextSteps(rows) {
    const P = rows?.prof;
    if (!P) return null;
    const R = P.seasonRank;
    if (R <= 1) return el("p", { class: "bs-next muted small" }, `Already ${LEVELS[1]}: 1st of ${P.N}.`);
    const ahead = rows.filter((r) => r.target < R && r.share?.k).sort((a, b) => b.target - a.target);
    if (!ahead.length) return null;
    const need = (T) => { const bar = P.field[T - 1]; return bar == null ? null : Math.max(0.01, bar - P.avg + 0.005); };
    return el("div", { class: "bs-next" }, [
      el("p", { class: "bs-sub" }, "Next steps"),
      el("p", { class: "muted small bs-next-now" }, `Now ${ordinal(R)} of ${P.N} (${sgn2(P.avg)} a round).`),
      el("ol", { class: "bs-next-list" }, ahead.map((r) => {
        const cut = r.share.of - r.share.k, on = st.vsRank === "peak" && st.ladderT === r.target && Number(st.peakN) === r.share.k, g = need(r.target);
        const b = el("button", { type: "button", class: `bs-next-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, [
          el("strong", {}, `${LEVELS[r.target]} (#${r.target})`), `: cut the worst ${cut} ${cut === 1 ? "round" : "rounds"}`,
          g != null ? el("span", { class: "muted" }, `, or ${sgn2(g)} a round across every round`) : null]);
        b.addEventListener("click", () => selectStretch(r.share.k, r.target));
        return el("li", {}, b);
      })),
    ]);
  }
  /* (update 350) The best stretch in a pop-up: every round in order as a bar, the stretch\u2019s rounds in gold, the #1 level
   * as a dashed line. Tap a bar for that round. "Show just these rounds" filters the page to the stretch\u2019s dates. */
  function stretchPopup(row, cat, when, place, withN) {
    const seq = stretchSeq(row.p.rounds, cat);
    const day = (rd) => String(rd.date || "").slice(0, 10);
    const i0 = seq.findIndex((x) => day(x.rd) === String(row.from).slice(0, 10));
    const inSt = (i) => i >= i0 && i < i0 + row.n;
    const avg = seq.slice(i0, i0 + row.n).reduce((t, x) => t + x.t, 0) / row.n;
    const W = 340, H = 170, pad = 6, n = seq.length;
    const mx = Math.max(0.5, ...seq.map((x) => Math.abs(x.t)), Math.abs(row.bar || 0));
    const y0 = H / 2, sc = (H / 2 - pad) / mx, bw = W / n;
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "bs-st-svg", role: "img", "aria-label": `Every round, the best stretch of ${row.n} highlighted` });
    // the stretch's span behind its bars, the zero line and the #1 level
    if (i0 >= 0) svg.appendChild(mk("rect", { x: i0 * bw, y: 0, width: row.n * bw, height: H, fill: "rgba(212,180,131,0.10)" }));
    svg.appendChild(mk("line", { x1: 0, x2: W, y1: y0, y2: y0, stroke: "rgba(255,255,255,0.25)", "stroke-width": 1 }));
    const yb = y0 - (row.bar || 0) * sc;
    svg.appendChild(mk("line", { x1: 0, x2: W, y1: yb, y2: yb, stroke: "#d4b483", "stroke-width": 1, "stroke-dasharray": "4 3", opacity: 0.8 }));
    const lbl = mk("text", { x: W - 2, y: yb - 3, "text-anchor": "end", fill: "#d4b483", "font-size": 9 }); lbl.textContent = LEVELS[1]; svg.appendChild(lbl);
    // (update 352) every round in a table below, oldest first; the stretch's rows highlighted; a bar's row is picked out
    // (update 380) a round opens to its strokes gained by part of the game, and each part of the game to its distances
    const rdBreak = (rd) => {
      const by = new Map();
      for (const x of rd.shots || []) { if (!x.cat) continue; const c = by.get(x.cat) || by.set(x.cat, { sg: 0, n: 0, d: new Map() }).get(x.cat); c.sg += x.sg; c.n += x.w || 1; if (x.dist) { const dd = c.d.get(x.dist) || c.d.set(x.dist, { sg: 0, n: 0 }).get(x.dist); dd.sg += x.sg; dd.n += x.w || 1; } }
      return el("div", { class: "bs-rd" }, CATEGORIES.filter(([c]) => by.has(c)).flatMap(([c, l]) => {
        const v = by.get(c), ds = [...v.d].sort((a, b) => distLead(a[0]) - distLead(b[0]) || a[0].localeCompare(b[0]));
        const restSg = v.sg - ds.reduce((t, [, x]) => t + x.sg, 0), restN = v.n - ds.reduce((t, [, x]) => t + x.n, 0);
        const sub = (lbl, sg, n) => el("div", { class: "bs-rd-row sub", style: "display:none" }, [el("span", { class: "bs-rd-l" }, `${lbl} \u00b7 ${Math.round(n)} ${Math.round(n) === 1 ? "shot" : "shots"}`), el("span", { class: `bs-rd-v ${sg >= 0 ? "pos" : "neg"}` }, sgn2(sg))]);
        const subs = [...ds.map(([d, x]) => sub(d, x.sg, x.n)), ...(Math.abs(restSg) >= 0.005 && restN > 0 ? [sub("Other shots", restSg, restN)] : [])];
        const caret = ds.length ? el("span", { class: "cmp-caret" }, "\u25B8 ") : null;
        const row = el("button", { type: "button", class: "bs-rd-row", "aria-expanded": "false", disabled: !ds.length }, [el("span", { class: "bs-rd-l" }, [caret, l]), el("span", { class: `bs-rd-v ${v.sg >= 0 ? "pos" : "neg"}` }, sgn2(v.sg))]);
        row.addEventListener("click", (e) => { e.stopPropagation(); const open = row.getAttribute("aria-expanded") !== "true"; row.setAttribute("aria-expanded", String(open)); if (caret) caret.textContent = open ? "\u25BE " : "\u25B8 "; subs.forEach((x) => { x.style.display = open ? "" : "none"; }); });
        return [row, ...subs];
      }));
    };
    const trs = seq.map((x, i) => el("tr", { class: inSt(i) ? "in" : "" }, [
      el("td", {}, [el("span", { class: "cmp-caret" }, "\u25B8 "), `${shortDay(x.rd.date)} ${String(x.rd.date || "").slice(2, 4) ? `\u2019${String(x.rd.date).slice(2, 4)}` : ""}`]),
      el("td", {}, `${x.rd.event || "Round"}${x.rd.roundNo ? ` \u00b7 R${x.rd.roundNo}` : ""}`),
      el("td", { class: `num ${x.t >= 0 ? "pos" : "neg"}` }, sgn2(x.t))]));
    const bodyRows = [];
    seq.forEach((x, i) => {
      if (!inSt(i)) return;
      const tr = trs[i], det = el("tr", { class: "bs-st-det", hidden: true }, el("td", { colspan: 3 }, rdBreak(x.rd)));
      tr.classList.add("bs-st-tap"); tr.setAttribute("role", "button"); tr.setAttribute("tabindex", "0"); tr.setAttribute("aria-expanded", "false");
      const flip = () => { const open = tr.getAttribute("aria-expanded") !== "true"; tr.setAttribute("aria-expanded", String(open)); tr.querySelector(".cmp-caret").textContent = open ? "\u25BE " : "\u25B8 "; det.hidden = !open; };
      tr.addEventListener("click", flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
      bodyRows.push(tr, det);
    });
    // (update 380) the stretch in numbers: each part of the game over the stretch against their whole selection
    const stRds = seq.filter((_, i) => inSt(i)).map((x) => x.rd), allRds = seq.filter((_, i) => !inSt(i)).map((x) => x.rd); // (update 385: the rest, outside the stretch)
    const catAvg = (rs, c) => (rs.length ? rs.reduce((t, rd) => t + (rd.shots || []).reduce((u, x) => u + (!c || x.cat === c ? x.sg : 0), 0), 0) / rs.length : null);
    const stVals = seq.filter((_, i) => inSt(i)).map((x) => x.t);
    const bestI = stVals.indexOf(Math.max(...stVals)), worstI = stVals.indexOf(Math.min(...stVals));
    const evN = new Set(stRds.map((rd) => `${rd.event}|${String(rd.date || "").slice(0, 4)}`)).size;
    const sumRow = (l, a, b, strong = false) => el("tr", { class: strong ? "strong" : "" }, [el("td", {}, l), el("td", { class: `num ${a >= 0 ? "pos" : "neg"}` }, sgn2(a)), el("td", { class: "num" }, sgn2(b)), el("td", { class: `num ${a - b >= 0 ? "pos" : "neg"}` }, sgn2(a - b))]);
    const summary = el("div", { class: "bs-st-sum" }, [
      el("div", { class: "bs-st-facts" }, [
        el("span", {}, [el("strong", {}, String(row.n)), ` ${row.n === 1 ? "round" : "rounds"} \u00b7 ${evN} ${evN === 1 ? "event" : "events"}`]),
        el("span", {}, [el("strong", {}, `${stVals.filter((v) => v > 0).length} of ${row.n}`), " gaining"]),
        stVals.length ? el("span", {}, ["Best ", el("strong", { class: "pos" }, sgn2(stVals[bestI])), " \u00b7 worst ", el("strong", { class: stVals[worstI] >= 0 ? "pos" : "neg" }, sgn2(stVals[worstI]))]) : null]),
      el("div", { class: "bs-st-tw" }, el("table", { class: "bs-st-table bs-st-cats" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "A round"), el("th", { class: "num" }, "Stretch"), el("th", { class: "num", title: "Their other rounds in the selection (outside the stretch)" }, "Rest"), el("th", { class: "num", title: "Stretch less rest" }, "Diff")])),
        el("tbody", {}, [sumRow("SG: Total", catAvg(stRds, null), catAvg(allRds, null), true), ...CATEGORIES.map(([c, l]) => sumRow(l, catAvg(stRds, c), catAvg(allRds, c)))])])),
    ]);
    const table = el("div", { class: "bs-st-tw" }, el("table", { class: "bs-st-table" }, [el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Event"), el("th", { class: "num" }, "SG")])), el("tbody", {}, bodyRows)])); // (update 377: just the stretch's rounds; 380: each opens)
    const bars = seq.map((x, i) => {
      const h = Math.max(1, Math.abs(x.t) * sc), on = inSt(i);
      const r = mk("rect", { x: i * bw + bw * 0.12, width: Math.max(0.8, bw * 0.76), y: x.t >= 0 ? y0 - h : y0, height: h, rx: Math.min(2, bw * 0.2),
        fill: x.t >= 0 ? (on ? "#30d158" : "rgba(48,209,88,0.28)") : (on ? "#ff453a" : "rgba(255,69,58,0.28)"), class: `bs-st-bar${on ? " in" : ""}` });
      // a wider invisible target so thin bars are easy to tap
      const hit = mk("rect", { x: i * bw, width: bw, y: 0, height: H, fill: "transparent", style: "cursor:pointer" });
      hit.addEventListener("click", () => {
        bars.forEach((b, j) => b.setAttribute("stroke", j === i ? "#fff" : "none"));
        trs.forEach((t, j) => t.classList.toggle("picked", j === i));
        if (inSt(i)) trs[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      svg.appendChild(r); svg.appendChild(hit);
      return r;
    });
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const show = el("button", { type: "button", class: "btn ghost small" }, "Show just these rounds");
    const what = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
    const overlay = el("div", { class: "gx-pop-overlay bs-st-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Best stretch" }, el("div", { class: "gx-pop bs-st-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Best stretch"), el("h2", {}, `${row.n} ${row.n === 1 ? "round" : "rounds in a row"} \u00b7 ${when}`),
        el("p", { class: "gx-sub" }, `${what}: ${sgn2(avg)} a round over the stretch; the ${LEVELS[1]} level is ${sgn2(row.bar || 0)} (the best season average of any other player).${place ? ` The ${place === 1 ? "longest" : `${ordinal(place)}-longest`} elite stretch of ${withN}.` : ""}`)]), close]),
      svg,
      summary,
      el("p", { class: "muted small bs-st-count" }, `All ${n} rounds in the chart, oldest first, the stretch bright. Below, the ${row.n} ${row.n === 1 ? "round" : "rounds"} in the stretch: tap one for its strokes gained by part of the game and distance.`),
      table,
      el("div", { class: "bs-st-foot" }, [show]),
    ]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    document.addEventListener("keydown", onKey);
    show.addEventListener("click", () => { shut(); setRange({ from: String(row.from).slice(0, 10), to: String(row.to).slice(0, 10), label: when }); });
    document.body.appendChild(overlay);
    close.focus();
  }
  /* (update 350) Under the boxes: how much #1-level golf is in them, and their best stretch: the longest run of rounds in a
   * row that on its own would rank #1, and where that run ranks among every player's longest (as on the Leaderboards). */
  function profileLine(mine, cat, rows) {
    if (!rows || !me) return null;
    const all = longestStretches(lastSliced || [], cat);
    const mineRow = all.find((r) => r.p.key === me.key);
    const s = rows.find((r) => r.target === 1)?.share?.pct ?? 0;
    const amount = s >= 0.3 ? "Plenty of" : s >= 0.1 ? "Some" : s > 0 ? "A little" : "No";
    const lead = `${amount} \u201c${LEVELS[1]}\u201d caliber golf in them (${Math.round(s * 100)}% of their rounds).`;
    if (!mineRow || !mineRow.n) {
      const r1 = rows.find((r) => r.target === 1);
      return el("p", { class: "bs-profile" }, [el("strong", {}, `${lead} `), el("span", { class: "muted" }, `No run of rounds reaches a #1 level yet${r1?.bestRound ? `; their best single round ranks ${ordinal(r1.bestRound)}` : ""}.`)]);
    }
    if (mineRow.whole) return el("p", { class: "bs-profile" }, [el("strong", {}, `${lead} `), el("span", { class: "muted" }, `All ${mineRow.n} of their rounds together already rank #1.`)]);
    // its place among everyone's longest (players with the same length share a place)
    const place = 1 + all.filter((r) => r.n > mineRow.n).length, withN = all.filter((r) => r.n > 0).length;
    const when = mineRow.from === mineRow.to ? shortDay(mineRow.from) : `${shortDay(mineRow.from)} \u2013 ${shortDay(mineRow.to)}`;
    const link = el("button", { type: "button", class: "link bs-stretch-link", title: "Every round, with this stretch picked out" }, when);
    link.addEventListener("click", () => stretchPopup(mineRow, cat, when, place, withN));
    return el("p", { class: "bs-profile" }, [el("strong", {}, `${lead} `), el("span", { class: "muted" }, [
      `Their best stretch: ${mineRow.n} ${mineRow.n === 1 ? "round" : "rounds in a row"}, `, link, `, enough on ${mineRow.n === 1 ? "its" : "their"} own for ${LEVELS[1]}. That\u2019s the ${place === 1 ? "longest" : `${ordinal(place)}-longest`} elite stretch of ${withN} capable ${withN === 1 ? "player" : "players"}.`])]);
  }
  /* (update 338) Path back to Elite: the player's last N rounds (10 to start; changeable) against their elite rounds. The gap
   * in strokes, where it comes from (biggest first) with a target in plain stats for each, what hurts in their other rounds
   * (parts of the game costing a stroke or more, bad lies), when the elite rounds tend to happen, and what to practise. Worked out here, by rule. */
  function pathBack(elite, season, cat, lv = null) {
    // (update 355) the level aimed at (picked here): its rounds (their best rounds that together reach it) against their
    // last N rounds (10 to start; changeable)
    const lvName = lv ? `\u201c${LEVELS[lv.T]}\u201d rounds` : "best rounds"; // (update 360: the level by name: their "Contender" rounds)
    const LvCap = lv ? `\u201c${LEVELS[lv.T]}\u201d rounds` : "Best rounds";
    const NN = { kept: lvName, cut: "recent rounds" };
    const N = Math.max(3, Math.min(season.length, Math.round(Number(st.recentN) || 10)));
    const recent = season.slice(-N);
    const eSet = new Set(elite), others = season.filter((rd) => !eSet.has(rd));
    const inCat = (x) => !cat || x.cat === cat;
    const tot = (rs) => (rs.length ? rs.reduce((t, rd) => { let s0 = 0; for (const x of rd.shots) if (inCat(x)) s0 += x.sg; return t + s0; }, 0) / rs.length : null);
    const f2 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
    const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
    // (update 355) the gap is to the bar (what it takes to rank at that level), not to the average of the level's rounds
    const eAvg = tot(elite), rAvg = tot(recent), bar = lv?.bar ?? null;
    const gap = bar != null ? bar - rAvg : eAvg - rAvg;
    const there = bar != null && rAvg >= bar - 1e-9; // (matching it is enough to rank there)
    // where the strokes go: per part of the game and distance, a round
    const bE = bucketsOf(elite, inCat), bR = bucketsOf(recent, inCat), bU = bucketsOf(season, inCat);
    const keys = new Set([...bE.keys(), ...bR.keys()].map((k) => k.split("|").slice(0, 2).join("|")));
    // (update 345) each piece split into playing it better (per shot) and facing it more or less often (lies included)
    const gaps = [...keys].map((k) => { const sp = groupSplit(bE, elite.length, bR, recent.length, (x) => x.startsWith(`${k}|`), bU); const [c, d] = k.split("|"); return { k, c, d, e: sp.ae * sp.pe, r: sp.ab * sp.pb, g: sp.total, sp }; })
      .filter((x) => x.g > 0.04 && x.sp.ab >= 0.5).sort((a, b) => b.g - a.g).slice(0, 5); // (update 343: top 5; update 367: not shots they rarely face lately, under one every two rounds)
    // a target in plain stats for a part of the game / distance: the stat that moved most between elite and recent rounds
    const statAvg = (rs, pred) => { const m = new Map(); for (const rd of rs) for (const o of rd.obs || []) if (pred(o)) { const a = m.get(o.k) || m.set(o.k, { s: 0, w: 0 }).get(o.k); a.s += o.v * o.w; a.w += o.w; } return m; };
    const WHOLE = { OTT: /^(fwy|drive|fairway)/i, APP: /^(gir|prox)/i, ARG: /^(scramble|updown|sand)/i, PUTT: /^(putts|onePutt|threePutt|make)/i };
    // (update 341) enough attempts to trust a stat: 20 for a percentage (a make rate from 3 putts means nothing), 8 otherwise
    const enough = (def, w) => w >= (def.pct ? 20 : 8);
    const target = (c, d) => {
      // the stat for that part of the game and distance; if the file has none, the whole-round stat for that part of the game.
      // The one that moved most (better in the best rounds), only where both sets of rounds have enough attempts.
      const exact = (o) => o.cat === c && (d ? o.dist === d : !o.dist);
      const whole = (o) => !o.cat && WHOLE[c]?.test(o.k);
      const has = (f) => elite.some((rd) => { for (const o of rd.obs || []) if (f(o)) return true; return false; });
      const pred = has(exact) ? exact : whole, isExact = pred === exact;
      const mE = statAvg(elite, pred), mR = statAvg(recent, pred);
      let best = null, thin = null, anyOk = false;
      for (const [k, a] of mE) {
        const b = mR.get(k); const def = statDef(k); if (!b || def.higher == null) continue;
        if (!enough(def, a.w) || !enough(def, b.w)) { thin ||= def; continue; }
        anyOk = true;
        const ve = a.s / a.w, vr = b.s / b.w; const better = def.higher !== false ? ve > vr : ve < vr; if (!better) continue;
        const rel = Math.abs(ve - vr) / (Math.abs(vr) || 1); if (!best || rel > best.rel) best = { k, def, ve, vr, rel, exact: isExact };
      }
      return best || (thin && !anyOk ? { thin } : null);
    };
    const tText = (t) => (!t ? null : t.thin ? `Not enough attempts in the ${NN.kept} and the last ${N} rounds to compare (${t.thin.label}).` : `${t.def.label}: ${fmtStat(t.def, t.vr)} now \u2192 ${fmtStat(t.def, t.ve)} in their ${NN.kept}`);
    // (update 342) the drills come from practice/plan.js (the same recipes Practice › Plan plays), each with a goal on the
    // same stat in real rounds: the plain stat when there's a target, else strokes gained for that part of the game
    const N_GOAL = N;
    const statGoal = (c, d, t) => (t && !t.thin
      ? { stat: "obs", statKey: t.k, cat: t.exact ? c : null, dist: t.exact ? d || null : null, label: t.def.label, unit: t.def.pct ? "%" : t.def.unit || "", higher: t.def.higher !== false, dp: t.def.dp ?? 1,
        target: Math.round(t.ve * (t.def.pct ? 10 : 10 ** Math.min(2, t.def.dp ?? 1))) / (t.def.pct ? 10 : 10 ** Math.min(2, t.def.dp ?? 1)), measure: "round", when: "nextN", n: N_GOAL }
      : null);
    // (update 349) the drill's goal: the elite rounds' own value of the stat that fits it (that distance's, else the
    // whole round's), whether or not it moved, as long as there are enough attempts behind it
    const eliteStat = (c, d) => {
      for (const re of goalStatsFor(c, d)) for (const exactOnly of [true, false]) {
        let t0 = 0, w = 0, k = null;
        for (const rd of elite) for (const o of rd.obs || []) if (re.test(o.k) && (exactOnly ? o.cat === c && (d ? o.dist === d : !o.dist) : !o.cat)) { t0 += o.v * o.w; w += o.w; k = o.k; }
        if (k && enough(statDef(k), w)) return { k, def: statDef(k), ve: t0 / w, exact: exactOnly };
      }
      return null;
    };
    // (update 371) the plain stat to aim at for a part of the game and distance: the first (that distance's, then the whole
    // round's) where their level's rounds were better than the last N, with enough attempts in both to compare
    const targetStat = (c, d) => {
      const res = [...goalStatsFor(c, d), ...(WHOLE[c] ? [WHOLE[c]] : [])];
      for (const re of res) for (const exactOnly of [true, false]) {
        const scope = (o) => re.test(o.k) && (exactOnly ? o.cat === c && (d ? o.dist === d : !o.dist) : !o.cat);
        const mE = statAvg(elite, scope), mR = statAvg(recent, scope);
        for (const [k, a] of mE) {
          const def = statDef(k), b = mR.get(k);
          if (!b || def.higher == null || !enough(def, a.w) || b.w < (def.pct ? 8 : 5)) continue;
          const ve = a.s / a.w, vr = b.s / b.w;
          if (def.higher !== false ? ve > vr + 1e-9 : ve < vr - 1e-9) return { k, def, ve, vr, w: b.w, exact: exactOnly };
        }
      }
      return null;
    };
    const itemOf = (g) => { // (update 370: any row of the Path table, opened)
      const t = target(g.c, g.d || null), d = g.d || null;
      const goal = statGoal(g.c, d, t) || { stat: "skill", cat: g.c, dist: d, target: Math.round(g.e * 100) / 100, measure: "round", when: "nextN", n: N_GOAL };
      // how much is playing it better, and how much is facing it more or less often (strategy, or the shot before)
      const sp = g.sp, share = g.g > 0 ? sp.skill / g.g : 0;
      const kind = share >= 0.6 ? "skill" : share <= 0.3 ? "mix" : "both";
      const fewer = sp.ae < sp.ab;
      const LN = `Last ${N} rounds`; // (update 361: the number of recent rounds, not "lately")
      // their usual level here, over every round in the time frame
      let uSg = 0, uN = 0; for (const [k, v] of bU) if (k.startsWith(`${g.k}|`)) { uSg += v.sg; uN += v.n; }
      const uRound = season.length ? uSg / season.length : 0, uAtt = season.length ? uN / season.length : 0;
      // (update 361) one fact per line
      const roundLines = [`${LN}: ${f2(g.r)}`, `${LvCap}: ${f2(g.e)}`, `Average: ${f2(uRound)}`,
        `Difference: ${sgn2(g.g)}${Math.abs(sp.mix) >= 0.01 ? ` (${sgn2(sp.skill)} from hitting it better, ${sgn2(sp.mix)} from ${fewer ? "fewer" : "more"} attempts)` : " (all from hitting it better)"}`];
      const shotLines = [`${LN}: ${sgn2(sp.pb)}`, `${LvCap}: ${sgn2(sp.pe)}`, `Average: ${sgn2(sp.pu)}`];
      const oftenLines = [`${LN}: ${sp.ab.toFixed(1)} attempts a round`, `${LvCap}: ${sp.ae.toFixed(1)} attempts`, `Average: ${uAtt.toFixed(1)} attempts`];
      // (update 358) what it means, in plain words
      const amt = (v) => Math.abs(v).toFixed(2), verb = (v) => (Math.abs(v) < 0.005 ? "break even" : v > 0 ? `gain ${amt(v)}` : `lose ${amt(v)}`);
      let take;
      if (kind === "mix") take = `They\u2019re not hitting these worse in the last ${N} rounds; they\u2019re facing ${fewer ? "fewer" : "more"} of them (${sp.ab.toFixed(1)} a round, against ${sp.ae.toFixed(1)} in their ${NN.kept}). ${MIX_CAUSE[g.c] || ""}`;
      else {
        take = `Over the last ${N} rounds they ${Math.abs(sp.pb) < 0.005 ? "break even here" : `${verb(sp.pb)} strokes a shot here`}; in their ${NN.kept} they ${verb(sp.pe)}. Getting back to that is worth about ${amt(g.g)} a round${Math.abs(sp.mix) >= 0.01 ? ` (${amt(sp.skill)} from playing these shots better, ${sp.mix > 0 ? "plus" : "less"} ${amt(sp.mix)} because their ${NN.kept} had ${sp.ae < sp.ab ? "fewer" : "more"} of them)` : ""}.`; // (update 386: the same number as the table's Diff)
        const weak = sp.pu <= -0.015; // (a weak spot: they usually lose at least 0.015 a shot here)
        if (sp.pb < sp.pu - 0.01) take += weak ? ` It\u2019s usually a weak spot (${sgn2(sp.pu)} a shot), and it\u2019s been worse lately.` : ` It\u2019s a recent slump: on average they ${verb(sp.pu)} a shot here.`;
        else if (weak) take += ` It\u2019s a long-standing weak spot (${sgn2(sp.pu)} a shot on average), not just a recent one.`;
        if (kind === "both") take += ` Part of it is facing ${fewer ? "fewer" : "more"} of these, which is more strategy than practice.`;
      }
      const strategy = kind === "skill" ? null : `${kind === "mix" ? "Mostly how often, not how well:" : "Partly how often:"} ${mixLead(sp)} in ${NN.kept}${sp.pu < 0 && fewer ? ` (they usually lose ${Math.abs(sp.pu).toFixed(2)} a shot here)` : sp.pu > 0 && !fewer ? ` (they usually gain ${sp.pu.toFixed(2)} a shot here)` : ""}. ${MIX_CAUSE[g.c] || ""}`;
      // (update 361) the target: the stat their level rounds had (the same one the drill and the goal use), against the
      // last N rounds, and what the difference means in makes
      // (update 371) the target is always a plain stat (fairways, distance, proximity, greens, up and downs, makes…),
      // never strokes gained: the one their level's rounds were better at than the last N rounds, the stat for that
      // distance first, else the whole round's. None better (or too few attempts to compare): no target.
      const tgt = targetStat(g.c, d);
      const es = tgt && goalStatsFor(g.c, d).some((re) => re.test(tgt.k)) ? tgt : eliteStat(g.c, d);
      const targetLines = (() => {
        if (!tgt) return null;
        const { def } = tgt, diff = Math.abs(tgt.ve - tgt.vr), up = def.higher !== false;
        const amtTxt = def.pct ? `${diff.toFixed(1)} ${Math.round(diff * 10) === 10 ? "point" : "points"}` : fmtStat({ ...def, pct: false }, diff);
        const head = `${up ? "Raise" : "Bring down"} ${def.label} by ${amtTxt}`;
        const lines = [head, `From ${fmtStat(def, tgt.vr)} over the last ${N} rounds to ${fmtStat(def, tgt.ve)} (their ${NN.kept})`];
        if (def.pct) { const extra = (diff / 100) * (tgt.w / recent.length); if (extra > 0.001) lines.push(extra >= 1 ? `That\u2019s about ${Math.round(extra)} more a round` : `That\u2019s 1 more every ${Math.max(1, Math.round(1 / extra))} ${Math.round(1 / extra) === 1 ? "round" : "rounds"}`); }
        return lines;
      })();
      const thinLately = false; // (update 369: shots they rarely face are already left out of the list)
      const goal2 = tgt ? statGoal(g.c, d, tgt) : es ? statGoal(g.c, d, { ...es, exact: es.exact }) : goal;
      return { head: `${catName(g.c)}${g.d ? ` \u00b7 ${g.d}` : ""}`, better: `${sgn2(g.g)} a round better in their ${NN.kept}`, roundLines, shotLines, oftenLines, strategy, take, targetLines: kind === "mix" ? null : targetLines,
        drills: kind === "mix" || thinLately ? [] : [{ drill: (() => { const dr = drillFor(g.c, d, es); if (dr) dr.from = NN.kept; return dr; })(), goal: goal2 }].filter((x) => x.drill) };
    };
    const prios = gaps.map(itemOf);
    // when elite rounds happen: after a week off, early or late in the event
    const evKey = (rd) => `${rd.event}|${String(rd.date || "").slice(0, 4)}`;
    const starts = new Map(); for (const rd of season) { const k = evKey(rd); const d0 = String(rd.date || "").slice(0, 10); if (!starts.has(k) || d0 < starts.get(k).first) starts.set(k, { first: d0, last: d0 }); if (d0 > starts.get(k).last) starts.get(k).last = d0; }
    const evs = [...starts.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first));
    const rested = new Set(); evs.forEach(([k, v], i) => { if (i === 0) return; const gapDays = (Date.parse(v.first) - Date.parse(evs[i - 1][1].last)) / 86400000; if (gapDays >= 10) rested.add(k); });
    const share = (rs, f) => (rs.length ? rs.filter(f).length / rs.length : 0);
    const when = [];
    const rE = share(elite, (rd) => rested.has(evKey(rd))), rA = share(season, (rd) => rested.has(evKey(rd)));
    if (Math.abs(rE - rA) >= 0.15 && evs.length > 4) when.push(`${Math.round(rE * 100)}% of ${NN.kept} came after a week or more off, against ${Math.round(rA * 100)}% of all rounds${rE > rA ? ": rest seems to help" : ": they play their best when playing in a run of events"}.`);
    const early = (rd) => Number(rd.roundNo) === 1 || Number(rd.roundNo) === 2;
    const eE = share(elite, early), eA = share(season, early);
    if (Math.abs(eE - eA) >= 0.15) when.push(`${Math.round(eE * 100)}% of ${NN.kept} were Round 1 or 2, against ${Math.round(eA * 100)}% of all rounds${eE > eA ? ": they start well and fade, so weekend rounds are where to look" : ": they finish strong; the opening rounds are what to sharpen"}.`);
    // (update 342) where Practice is open: add a drill (or all of them) to the practice plan, with a goal for each
    const shown = there ? [] : prios.flatMap((p) => p.drills);
    const sig = (x) => `${me?.key}|${x.drill.kind}|${x.drill.dist || ""}|${x.drill.lie || ""}`;
    const canAdd = practiceOpen(me?.key); // (update 371: the admin, or a coach of this player with Allow coaching)
    const mineNow = isMine(me?.key);
    const whose = mineNow || !me?.label ? "your" : `${me.label}\u2019s`;
    const status = el("p", { class: "muted small bs-plan-status" });
    if (st.planMsg && st.planMsg.key === me?.key && Date.now() - st.planMsg.at < 120000) { const { n, g } = st.planMsg;
      mount(status, [`Added ${n} ${n === 1 ? "drill" : "drills"} to ${whose} practice plan${g ? ` and ${g} ${g === 1 ? "goal" : "goals"} to ${me?.label ? `${me.label}\u2019s` : "the"} Goals` : ""}. `,
        el("a", { href: mineNow ? "#/practice?tool=PLAN" : `#/practice?tool=PLAN&player=${encodeURIComponent(me?.key || "")}`, class: "link" }, "Open Practice \u2192")]); }
    // (update 387) which drills are really in the plan (one taken out in Practice can be added again): read now and then
    if (canAdd && me?.key && !PLAN_SEEN.busy && (PLAN_SEEN.key !== me.key || Date.now() - PLAN_SEEN.at > 15000)) {
      PLAN_SEEN.busy = true;
      import("./practice/plan.js").then((m) => m.planFor(getState(), me.key)).then((items) => {
        const before = [...PLAN_ADDED].filter((x) => x.startsWith(`${me.key}|`)).sort().join(",");
        for (const x of [...PLAN_ADDED]) if (x.startsWith(`${me.key}|`)) PLAN_ADDED.delete(x);
        for (const p of items) PLAN_ADDED.add(`${me.key}|${p.kind}|${p.dist || ""}|${p.lie || ""}`);
        const after = [...PLAN_ADDED].filter((x) => x.startsWith(`${me.key}|`)).sort().join(",");
        PLAN_SEEN.key = me.key; PLAN_SEEN.at = Date.now(); PLAN_SEEN.busy = false;
        if (before !== after) draw();
      }).catch(() => { PLAN_SEEN.busy = false; PLAN_SEEN.key = me.key; PLAN_SEEN.at = Date.now(); });
    }
    const add = (list, btns) => planEditor(list, whose, (edited) => send(edited, btns));
    const send = async (list, btns) => {
      btns.forEach((b) => { b.disabled = true; });
      try {
        const { addToPlan } = await import("./practice/plan.js");
        const n = await addToPlan(getState(), { items: list.map((x) => ({ ...x })), playerKey: me?.key, playerLabel: me?.label });
        list.forEach((x) => PLAN_ADDED.add(sig(x)));
        const g = list.filter((x) => x.goal).length;
        st.planMsg = { key: me?.key, n, g, at: Date.now() }; // (update 387: redrawn, with Remove under each one added)
        draw();
      } catch (err) { console.error(err); btns.forEach((b) => { b.disabled = false; }); mount(status, "Couldn\u2019t add that just now. Try again."); }
    };
    const rowBtns = [];
    function drillRow(x) {
      const line = kv("Practice", drillLine(x.drill), "bs-drill");
      if (!canAdd) return line;
      const on = PLAN_ADDED.has(sig(x));
      const b = el("button", { type: "button", class: `bs-plan-add${on ? " done" : ""}`, disabled: on }, on ? "\u2713 In practice plan" : "\uFF0B Add to practice plan");
      b.addEventListener("click", () => add([x], [b]));
      rowBtns.push({ b, x });
      // (update 387) and out again
      const rm = on ? el("button", { type: "button", class: "link small bs-plan-rm" }, "Remove from practice plan") : null;
      rm?.addEventListener("click", async () => {
        rm.disabled = true;
        try {
          const { removeFromPlan } = await import("./practice/plan.js");
          await removeFromPlan(getState(), { drill: x.drill, playerKey: me?.key });
          PLAN_ADDED.delete(sig(x)); PLAN_SEEN.at = 0; draw();
        } catch (err) { console.error(err); rm.disabled = false; mount(status, "Couldn\u2019t take that out just now. Try again."); }
      });
      return el("div", { class: "bs-drill-row" }, [line, el("div", { class: "bs-plan-btns" }, [b, rm])]);
    }
    const addAll = canAdd && shown.length > 1 ? (() => { const b = el("button", { type: "button", class: "btn ghost small bs-plan-all" }, "\uFF0B Add all to practice plan");
      b.addEventListener("click", () => { const left = shown.filter((x) => !PLAN_ADDED.has(sig(x))); if (!left.length) return; add(left, [b, ...rowBtns.filter((r) => left.some((x) => sig(x) === sig(r.x))).map((r) => r.b)]); }); return b; })() : null;
    const nIn = el("input", { type: "number", class: "peak-len", min: "3", max: "200", step: "1", value: String(N), inputmode: "numeric", "aria-label": "How many recent rounds to compare" });
    const setN = () => { const v = Math.round(Number(nIn.value)); if (Number.isFinite(v) && v >= 3) { st.recentN = v; draw(); } else nIn.value = String(N); };
    nIn.addEventListener("change", setN); nIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nIn.blur(); } });
    // which level to aim at: the next one up to start (from where they sit now), or any level they reach in some rounds
    const lvPick = lv ? (() => {
      const sel = el("select", { class: "bs-lv-pick", "aria-label": "Which level next" }, [...lv.reach].sort((a, b) => b.target - a.target).map((r) =>
        el("option", { value: String(r.target), selected: r.target === lv.T }, `${LEVELS[r.target]} (#${r.target})${r.target === lv.nextUp ? " \u00b7 next step" : ""}`)));
      sel.addEventListener("change", () => { st.pathT = Number(sel.value); draw(); });
      return el("label", { class: "bs-lv-row" }, [el("span", { class: "muted small" }, `Now ${ordinal(lv.rank)} on the season${lv.formRank ? `, a #${lv.formRank} level over the last ${N}` : ""}. Aim for:`), sel]);
    })() : null;
    // (update 370) the path as a table: the last N rounds against the level's rounds, a round, for SG: Total, each part
    // of the game (tap to open its distances) and each distance (tap to see the takeaway, target and practice)
    function pathTable() {
      const lvHead = lv ? `\u201c${LEVELS[lv.T]}\u201d` : "Best rounds";
      const lvShort = lv ? ({ 1: "Best on Tour", 10: "Contender", 25: "Tour Champ.", 50: "Signature" }[lv.T] || LEVELS[lv.T]) : "Best";
      const rowOf = (match) => { const sp = groupSplit(bE, elite.length, bR, recent.length, match, bU); return { sp, r: sp.ab * sp.pb, e: sp.ae * sp.pe, g: sp.total }; };
      const topIdx = new Map(gaps.map((x, i) => [x.k, i + 1]));
      const cats = CATEGORIES.map(([c]) => c).filter((c) => [...keys].some((k) => k.startsWith(`${c}|`)));
      const catRows = cats.map((c) => ({ c, ...rowOf((x) => x.startsWith(`${c}|`)) }));
      const openCats = new Set(st.pathCats || []);
      const bgOf = (d, max) => { if (d == null || Math.abs(d) < 0.005 || !(max > 0)) return "color:#fff"; const t = Math.min(1, Math.abs(d) / max); return `color:#fff;background:rgba(${d > 0 ? "48,209,88" : "255,69,58"},${(0.05 + 0.4 * t * t).toFixed(3)})`; };
      const maxOf = (rs) => Math.max(0, ...rs.map((x) => Math.abs(x.g)));
      const cells = (x, max, bold = false) => [el("td", { class: "num" }, f2(x.r)), el("td", { class: `num${bold ? " strong" : ""}` }, f2(x.e)), el("td", { class: "num bs-diff", style: bgOf(-x.g, max) }, f2(-x.g))]; // (update 371: last N less the level: red where they're behind)
      const tapRow = (cls, open, onTap, label, rest) => {
        const tr = el("tr", { class: `sg-tap ${cls}`, role: "button", tabindex: "0", "aria-expanded": String(open) }, [el("td", {}, label), ...rest]);
        tr.addEventListener("click", onTap); tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onTap(); } });
        return tr;
      };
      const badge = (k) => (topIdx.has(k) ? el("span", { class: "bs-top-b", title: `Number ${topIdx.get(k)} of the biggest gaps` }, `#${topIdx.get(k)}`) : null);
      const detail = (g) => {
        const sp = g.sp;
        if (g.g <= 0.005) return [el("p", { class: "muted small" }, `Their last ${N} rounds are as good as their ${NN.kept} here, or better.`)];
        if (sp.ab < 0.5) return [el("p", { class: "muted small" }, `They\u2019ve faced this less than once every two rounds over the last ${N} (${sp.ab.toFixed(1)} a round), so it isn\u2019t worth practising for now.`)];
        const p = itemOf(g);
        return [kv("Takeaway", p.take, "bs-take"), ...(p.targetLines ? [kv("Target", p.targetLines.map((x, k) => el("div", { class: k ? "bs-tl" : "bs-th" }, x)), "bs-target")] : []), ...p.drills.map(drillRow)];
      };
      const body = [el("tr", { class: "bs-path-total" }, [el("td", {}, cat ? `${catName(cat)}` : "SG: Total"), ...cells({ r: rAvg ?? 0, e: eAvg ?? 0, g: (eAvg ?? 0) - (rAvg ?? 0) }, Math.max(0.5, Math.abs((eAvg ?? 0) - (rAvg ?? 0))), true)])];
      const cMax = maxOf(catRows);
      for (const cr of catRows) {
        const open = openCats.has(cr.c);
        const nTop = [...topIdx.keys()].filter((k) => k.startsWith(`${cr.c}|`)).length;
        body.push(tapRow("cmp-sub", open, () => { const a = new Set(st.pathCats || []); a.has(cr.c) ? a.delete(cr.c) : a.add(cr.c); st.pathCats = [...a]; draw(); },
          [el("span", { class: "sg-exp", "aria-hidden": "true" }, open ? "\u25BE " : "\u25B8 "), catName(cr.c), nTop && !open ? el("span", { class: "bs-top-b", title: `${nTop} of the ${gaps.length} biggest gaps` }, String(nTop)) : null], cells(cr, cMax)));
        if (!open) continue;
        const ds = [...keys].filter((k) => k.startsWith(`${cr.c}|`)).map((k) => { const d = k.split("|")[1]; return { k, c: cr.c, d, ...rowOf((x) => x.startsWith(`${k}|`)) }; })
          .sort((a, b) => (a.d ? distLead(a.d) : 1e9) - (b.d ? distLead(b.d) : 1e9) || String(a.d).localeCompare(String(b.d)));
        const dMax = maxOf(ds);
        for (const g of ds) {
          const on = st.pathRow === g.k;
          body.push(tapRow("cmp-sub cmp-deep", on, () => { st.pathRow = on ? null : g.k; draw(); }, [g.d || "Other shots", badge(g.k)], cells(g, dMax)));
          if (on) body.push(el("tr", { class: "bs-path-det" }, el("td", { colspan: 4 }, detail(g))));
        }
      }
      return el("div", { class: "bs-path-tw" }, [
        infoTip(`${lv ? `${lvHead} rounds: their best ${elite.length}, which together reach ${LEVELS[lv.T]}. ` : ""}Each row is strokes gained a round: the last ${N} rounds, the level\u2019s rounds, and the difference: the last ${N} less the level\u2019s rounds (red: behind the level there, so there\u2019s something to gain; green: already ahead). #1 to #${gaps.length || 5} mark the biggest gaps. Tap a part of the game for its distances, and a distance for the takeaway, target and practice.`),
        el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table sg-full-t bs-path-t" }, [
          el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", { class: "num" }, `Last ${N}`), el("th", { class: "num", title: `${lvHead} rounds` }, lvShort), el("th", { class: "num" }, "Diff")])),
          el("tbody", {}, body)])),
      ]);
    }
    // (update 363) folded to start: tap the heading to open it
    const pathOpen = !!st.pathOpen;
    const tgl = el("button", { type: "button", class: "bs-path-toggle", "aria-expanded": String(pathOpen) }, [el("span", { class: "cmp-caret" }, pathOpen ? "\u25BE " : "\u25B8 "), lv ? `Path to ${LEVELS[lv.T]}` : "Path back to their best"]);
    tgl.addEventListener("click", () => { st.pathOpen = !pathOpen; draw(); });
    return el("div", { class: `bs-path${pathOpen ? "" : " closed"}` }, [
      el("div", { class: "bs-path-head" }, [el("p", { class: "bs-sub" }, tgl), pathOpen ? addAll : null]),
      ...(pathOpen ? [      lvPick,
      el("div", { class: "bs-path-gap" }, [
        // (update 374) the level's rounds (the same numbers as the table below), with what it takes to rank there alongside
        el("div", {}, bar != null ? [`\u201c${LEVELS[lv.T]}\u201d rounds: `, el("strong", {}, f2(eAvg)), ` a round `, el("span", { class: "muted" }, `(their best ${elite.length}; ranking #${lv.T} takes ${f2(bar)})`)] : [`Their best ${elite.length}: `, el("strong", {}, f2(eAvg)), ` a round`]),
        el("div", {}, [`Last `, nIn, ` rounds: `, el("strong", {}, f2(rAvg)), ` a round${lv?.formRank ? ` (a #${lv.formRank} level)` : ""}`]),
        el("div", {}, there ? [el("strong", { class: "pos" }, `Already there: `), `their last ${N} rounds play at ${/level$/.test(LEVELS[lv.T]) ? LEVELS[lv.T] : `a ${LEVELS[lv.T]} level`}.`] : eAvg - rAvg > 0.005 ? [`Gap: `, el("strong", {}, `${(eAvg - rAvg).toFixed(2)} strokes`), ` a round`] : [`No gap: they\u2019re playing at that level right now.`])]),
      // already at this level lately: no gap to close here, so point to the next level up
      ...(there ? [lv.above ? (() => { const go = el("button", { type: "button", class: "btn ghost small bs-lv-next" }, `Aim for ${LEVELS[lv.above]} (#${lv.above}) \u2192`); go.addEventListener("click", () => { st.pathT = lv.above; draw(); }); return go; })()
        : el("p", { class: "muted small" }, `That\u2019s the top level.`)] : []),
      !there ? pathTable() : null,
      when.length ? el("p", { class: "bs-sub bs-sub2" }, `When the ${NN.kept} happen`) : null,
      when.length ? el("ul", { class: "bs-list" }, when.map((t) => el("li", {}, t))) : null,
      canAdd ? status : null] : []),
    ]);
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
      // (update 308) Hide Comps: this card's dots and legend off (remembered per chart while the page is open)
      hideCompsNow = !!(key && !st.showComps?.[key]); cmpSeen = false; // (update 311: hidden until Show Comps)
      chart = make(canvas, (key && st.chartTypes[key]) || "bar");
      hideCompsNow = false;
      charts.push(chart);
      if (key && cmpSeen) compsToggle(wrap, key);
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
  // (update 308) the Hide Comps / Show Comps button in the top right of each chart card that has comparison dots
  let hideCompsNow = false, cmpSeen = false;
  function compsToggle(wrap, key) {
    const card = wrap.closest(".sg-box");
    if (!card) return;
    const keys = new Set((card.dataset.ckeys || "").split("|").filter(Boolean)); keys.add(key);
    card.dataset.ckeys = [...keys].join("|");
    const hidden = () => ![...keys].some((k) => st.showComps?.[k]);
    let b = card.querySelector(":scope > .comp-toggle");
    if (!b) {
      b = el("button", { type: "button", class: "comp-toggle" });
      b.addEventListener("click", () => {
        const ks = (card.dataset.ckeys || "").split("|").filter(Boolean), show = !ks.some((k) => st.showComps?.[k]);
        st.showComps = { ...(st.showComps || {}) }; ks.forEach((k) => { st.showComps[k] = show; });
        draw();
      });
      card.classList.add("has-comp-toggle");
      card.appendChild(b);
    }
    b.textContent = hidden() ? "Show Comps" : "Hide Comps";
    b.setAttribute("aria-pressed", String(hidden()));
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
  function barChart(canvas, labels, values0, { title: title0, compare: compareIn, compareLabel = "All players", average: averageIn, single, tooltip, shortLabels = null, as = "bar", colors = null } = {}) {
    if ((Array.isArray(compareIn) && compareIn.some((x) => x != null)) || averageIn !== undefined) cmpSeen = true;
    const compare0 = hideCompsNow ? null : compareIn, average = hideCompsNow ? undefined : averageIn; // (update 308: Hide Comps)
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
          backgroundColor: colors ? colors : (c) => barFill(c, single), hoverBackgroundColor: colors ? colors : (c) => barFill(c, single), // (update 299: a colour per bar, by product)
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
    // (update 381) only when each bar has room for it (about 6.5px a letter at this size); else the short label
    // (a date), tilted and thinned out so no two labels overlap
    const fsz = narrow ? 9 : 11, perBar = Math.max(1, (canvas.parentElement?.clientWidth || 800) - 50) / Math.max(1, labels.length);
    const few = perBar >= (narrow ? 58 : 70);
    const wrapAt = Math.max(6, Math.floor(perBar / (fsz * 0.62)));
    const wrapL = (l) => { const out = []; let cur = ""; for (const w of String(l).split(/\s+/)) { if (cur && (cur + " " + w).length > wrapAt) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; } if (cur) out.push(cur); return out.length > 1 ? out : out[0] || ""; };
    const shortOf = (i) => {
      const l = String(labels[i] ?? "");
      if (!few && shortLabels?.[i]) return shortLabels[i];
      return few ? wrapL(l) : l.length > 16 ? `${l.slice(0, 15)}\u2026` : l;
    };
    o.scales.x = { ...(o.scales.x || {}), ticks: { ...((o.scales.x || {}).ticks || {}), callback: (v, i) => shortOf(i), autoSkip: !few, autoSkipPadding: 8, maxRotation: few ? 0 : 50, minRotation: 0, font: { size: fsz } } };
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
