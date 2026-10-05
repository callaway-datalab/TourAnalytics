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
import { getState } from "./auth.js";
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
    st.tour = (st.tour || []).filter((t) => (opt.tour || []).includes(t));
    const f = { span: Number(st.span), year: st.year, tour: st.tour, event: st.event, roundNo: st.roundNo, cats: st.cats, lie: st.lie, dist: st.dist, club: st.club };
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
      const vp = placeView(); parkLead();
      mount(container, [
        vp,
        opts.note ? el("p", { class: "muted small center sg-note" }, opts.note) : null,
        opts.slot || null, // the page's player search, then the Filters panel
        filtersPanel(opt, { basic: true, statBar: basicStatBar(bField, bMine) }),
        el("div", { class: "sg-panel" }, basicBlocks(bField, bMine)),
      ]);
      window.scrollTo(0, y);
      container.style.minHeight = "";
      return;
    }
    const vp = placeView(); parkLead();
    mount(container, [
      vp,
      opts.note ? el("p", { class: "muted small center sg-note" }, opts.note) : null,
      opts.slot || null, // the page's player search, then the Filters panel
      filtersPanel(opt),
      el("div", { class: "sg-panel" }, (() => {
        // The rankings are always the first thing (Stat Averages and the charts follow).
        const blocks = me ? detailBlocks(mine, slicedField) : [];
        return [heroBox(mine, slicedField, f), summaryBox(mine, slicedField), showRanks && me ? rankingsBlock(slicedField) : null, ...blocks];
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

  function filterBar(opt, { basic = false, bare = false } = {}) {
    const span = el("select", { "aria-label": "Span" }, SPANS.map(([v, l]) => el("option", { value: v, selected: String(st.span) === v }, l)));
    span.addEventListener("change", () => { st.span = Number(span.value); draw(); });
    const latest = [...opt.year].sort().pop();
    const active = ["event", "roundNo", "lie", "dist", "club", "cats"].some((k) => st[k].length) || Number(st.span) > 0 || (st.view || "advanced") !== "advanced"
      || JSON.stringify(st.year) !== JSON.stringify(latest ? [latest] : []);
    const reset = el("button", { class: "link", type: "button", hidden: !active }, "Reset Filters");
    reset.addEventListener("click", () => {
      Object.assign(st, { span: 0, year: latest ? [latest] : [], tour: [], event: [], roundNo: [], lie: [], dist: [], club: [], cats: [], view: "advanced", openFilter: null });
      draw();
    });
    // Distances, grouped under their category; with categories picked, only theirs show.
    const base = me ? me.rounds : field.flatMap((p) => p.rounds);
    const distOpts = CATEGORIES.filter(([k]) => !st.cats.length || st.cats.includes(k))
      .flatMap(([k, label]) => filterOptions(base, k).dist.map((d) => ({ value: `${k}|${d}`, label: d, group: label })));
    const simple = (vals, fmt = (v) => v) => vals.map((v) => ({ value: v, label: fmt(v) }));
    // On phones the filters fold behind a "Filters" button (with how many are in use).
    const inUse = ["event", "roundNo", "lie", "dist", "club"].filter((k) => st[k].length).length + (Number(st.span) > 0 ? 1 : 0);
    const fold = el("button", { type: "button", class: "filters-toggle", "aria-expanded": st.filtersOpen ? "true" : "false" },
      [`More Filters${inUse ? ` \u00b7 ${inUse} on` : ""}`, el("span", { "aria-hidden": "true" }, st.filtersOpen ? "\u25B4" : "\u25BE")]);
    fold.addEventListener("click", () => { st.filtersOpen = !st.filtersOpen; draw(); });
    return el("div", { class: "sg-filters" + (st.filtersOpen || bare ? " open" : "") + (bare ? " bare" : "") }, [
      bare ? null : fold,
      el("label", {}, ["Span", span]),
      (opt.tour || []).length > 1 ? multi("Tour", "tour", simple(opt.tour), "All tours", { plural: "tours" }) : null,
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
  const CAT_NAME = Object.fromEntries(CATEGORIES);
  /* ---------------- the Filters panel (everything but the player search) ---------------- */
  function filtersPanel(opt, { basic = false, statBar = null } = {}) {
    if (st.panelOpen === undefined) { try { st.panelOpen = localStorage.getItem("ta:filtersOpen") === "1"; } catch { st.panelOpen = false; } } // remembered on this device
    const open = !!st.panelOpen;
    const src = opts.lead?.querySelector?.("[aria-current=page]")?.textContent || "";
    const yrs = st.year.length ? [...st.year].sort().reverse().join(" + ") : "All years";
    const cats = st.cats.length ? st.cats.map((k) => CAT_NAME[k] || k).join(" + ") : "All categories";
    const more = ["tour", "event", "roundNo", "lie", "dist", "club"].filter((k) => (st[k] || []).length).length + (Number(st.span) > 0 ? 1 : 0);
    const btn = el("button", { type: "button", class: "filters-panel-btn", "aria-expanded": open ? "true" : "false" }, [
      el("span", { class: "fp-title" }, "Filters"),
      el("span", { class: "fp-sum" }, [src, yrs, basic ? "Basic" : "Advanced", cats, more ? `${more} more` : ""].filter(Boolean).join(" \u00b7 ")),
      el("span", { class: "fp-caret", "aria-hidden": "true" }, open ? "\u25B4" : "\u25BE"),
    ]);
    btn.addEventListener("click", () => { st.panelOpen = !st.panelOpen; try { localStorage.setItem("ta:filtersOpen", st.panelOpen ? "1" : "0"); } catch { /* fine */ } draw(); });
    return el("section", { class: `filters-panel${open ? " open" : ""}` }, [btn, open ? el("div", { class: "fp-body" }, [
      yearsRow(opt, { cats: true }), statBar, filterBar(opt, { basic, bare: true }),
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
    return [t && !isNaN(t) ? `Last updated ${t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : null, "Powered by ShotLink"].filter(Boolean).join(" \u00b7 ");
  };
  function heroBox(mine, slicedField, f) {
    const foot = el("p", { class: "hero-foot" }, updatedTxt());
    if (me && mine && mine.length) {
      // the player: their number, rank, form, a rolling-average chart, and four category tiles to explore
      const total = perRoundOf(mine), r = rankAmong(slicedField, me.key);
      const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const per = ordered.map((rd) => rd.shots.reduce((t, x) => t + x.sg, 0));
      const roll = per.map((_, i) => { const w = per.slice(Math.max(0, i - 4), i + 1); return w.reduce((t, v) => t + v, 0) / w.length; });
      const n = Math.min(10, Math.floor(per.length / 2));
      const ch = n >= 2 ? per.slice(-n).reduce((t, v) => t + v, 0) / n - per.slice(-2 * n, -n).reduce((t, v) => t + v, 0) / n : null;
      const form = ch == null ? null : Math.abs(ch) < 0.05 ? ["Steady", ""] : ch > 0 ? [`Up ${ch.toFixed(2)}`, "up"] : [`Down ${Math.abs(ch).toFixed(2)}`, "down"];
      const allCats = applyFilters(me.rounds, { ...f, cats: [] });
      const tiles = CATEGORIES.map(([k, l]) => {
        const v = perRoundOf(allCats, k), rk = rankAmong(slicedField.map((p) => ({ ...p })), me.key, k);
        const on = st.cats.length === 1 && st.cats[0] === k;
        const b = el("button", { type: "button", class: `hero-tile${on ? " on" : ""}`, "aria-pressed": on ? "true" : "false", title: on ? "Back to all categories" : `Explore ${l}` }, [
          el("span", { class: "ht-name" }, l), el("strong", { class: v == null ? "" : v >= 0 ? "pos" : "neg" }, fmtSG(v)), el("span", { class: "ht-rank" }, rk.rank ? `${ordinal(rk.rank)} of ${rk.of}` : ""),
        ]);
        b.addEventListener("click", () => { st.cats = on ? [] : [k]; draw(); });
        return b;
      });
      return el("section", { class: "panel hero" }, [
        el("div", { class: "hero-top" }, [
          el("div", { class: "hero-id" }, [
            el("span", { class: "hero-kicker" }, `${describe()}`),
            el("h2", { class: "hero-name" }, me.label),
            el("div", { class: "hero-big" }, [el("strong", { class: total >= 0 ? "pos" : "neg" }, fmtSG(total)), el("span", {}, "strokes gained a round")]),
            el("div", { class: "hero-chips" }, [
              r.rank ? el("span", { class: `hero-chip${r.rank === 1 ? " gold" : ""}` }, `${ordinal(r.rank)} of ${r.of}`) : null,
              el("span", { class: "hero-chip" }, `${mine.length} rounds`),
              form ? el("span", { class: `hero-chip ${form[1]}` }, `Form: ${form[0]}`) : null,
            ]),
          ]),
          el("div", { class: "hero-chart" }, [el("span", { class: "hero-chart-label" }, "SG trend \u00b7 rolling 5-round average"), chartBox((c) => heroChart(c, ordered.map((rd) => { const d = new Date(rd.date); return isNaN(d) ? rd.date : shortDate(d); }), roll))]),
        ]),
        el("div", { class: "hero-tiles" }, tiles),
        foot,
      ]);
    }
    // no player: the leaderboard
    const minR = Math.max(1, Number(st.minRounds) || 1);
    const ranked = slicedField.filter((p) => p.rounds.length >= minR).map((p) => ({ p, v: perRoundOf(p.rounds), n: p.rounds.length })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    const minIn = el("input", { type: "number", min: 1, max: 99, value: minR, class: "hb-min-in", "aria-label": "Minimum rounds played" });
    // (redrawn just after the change finishes, so the box isn't removed mid-event)
    minIn.addEventListener("change", () => { st.minRounds = Math.max(1, Math.round(Number(minIn.value) || 1)); setTimeout(draw, 0); });
    const minBox = el("label", { class: "hb-min" }, ["Min. rounds played", minIn]);
    const shown = ranked.map((x, i) => ({ ...x, i })); // everyone; the list scrolls
    const max = Math.max(...shown.filter(Boolean).map((x) => Math.abs(x.v)), 0.01);
    const posMax = Math.max(...shown.filter((x) => x && x.v >= 0).map((x) => x.v), 0.01), negMax = Math.max(...shown.filter((x) => x && x.v < 0).map((x) => -x.v), 0.01);
    return el("section", { class: "panel hero" }, [
      el("div", { class: "hb-head" }, [el("div", {}, [el("span", { class: "hero-kicker" }, describe()), el("h2", { class: "hero-name" }, "Leaderboard")]), minBox]),
      ranked.length ? null : el("p", { class: "muted small" }, `No one has played ${minR} rounds in this selection.`),
      el("div", { class: "hero-board", tabindex: "0", "aria-label": `Leaderboard: ${ranked.length} players (scroll for more)` }, shown.map((x) => (!x ? null : el("div", { class: "hb-row" }, [
        el("span", { class: "hb-rank" }, String(x.i + 1)),
        opts.onPick ? (() => { const b = el("button", { type: "button", class: "hb-name hb-link", title: `Open ${x.p.label}` }, x.p.label); b.addEventListener("click", () => opts.onPick(x.p.key)); return b; })() : el("span", { class: "hb-name" }, x.p.label),
        el("span", { class: "hb-bar" }, el("span", { class: x.v >= 0 ? "pos" : "neg", style: htmlBarStyle(x.v, Math.abs(x.v) / max, Math.abs(x.v) / (x.v >= 0 ? posMax : negMax)) })),
        el("strong", { class: x.v >= 0 ? "pos" : "neg" }, fmtSG(x.v)),
      ])))),
      el("p", { class: "muted small" }, opts.onPick ? "Tap a name for that player's view." : "Pick a player above for their own view."),
      foot,
    ]);
  }
  function heroChart(canvas, labels, vals) {
    const ctx = canvas.getContext("2d"), h = canvas.parentNode?.clientHeight || 180;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(212,180,131,0.45)"); grad.addColorStop(1, "rgba(212,180,131,0)");
    return new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ data: vals, borderColor: "#d4b483", backgroundColor: grad, fill: "origin", borderWidth: 2.4, pointRadius: 0, pointHoverRadius: 4, tension: 0.35 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmtSG(c.parsed.y)} (5-round average)` } } },
        scales: {
          // a minimal x-axis: a few dates, small and grey, no grid
          x: { display: true, grid: { display: false }, border: { display: false }, ticks: { color: "#6e6e73", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, padding: 2 } },
          y: { grid: { color: (c) => (c.tick.value === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.06)") }, ticks: { color: "#8e8e93", maxTicksLimit: 4, callback: (v) => fmtSG(v) }, border: { display: false } } } },
    });
  }

  /* ---------------- Basic / Advanced ---------------- */
  // (drawn under the Tour Events / Entered Rounds pills when the page gives a place for them)
  // Basic / Advanced sit beside the year pills now (the page's top spot is left empty)
  const placeView = () => { if (opts.viewHost && !container.closest("[hidden]")) mount(opts.viewHost, null); return null; };
  // One row of pills: the page's Tour Events / Entered Rounds (lent to us; a hidden dashboard leaves them),
  // the years, Basic / Advanced and, on Advanced, the categories (a Category dropdown on phones).
  const yearsRow = (opt, { cats = false } = {}) => {
    const lead = opts.lead && !container.closest("[hidden]") ? opts.lead : null;
    const catDrop = cats ? el("div", { class: "cat-drop" }, multi("Category", "cats", CATEGORIES.map(([v, l]) => ({ value: v, label: l })), "All categories", { plural: "categories" })) : null;
    return el("div", { class: "pill-row years-row stats-pills" }, [lead, yearPills(opt), viewPills(), cats ? catPills() : null, catDrop]);
  };
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
    { key: "scoring", cat: null, label: "Scoring Avg", higher: false, dp: 1, unit: "", get: (c) => (c.holes ? (c.score / c.holes) * 18 : null) },
    { key: "gir", cat: "APP", label: "GIR %", higher: true, dp: 1, unit: "%", get: (c) => (c.holes ? (c.gir / c.holes) * 100 : null) },
    { key: "hitGreen", cat: "APP", label: "Hit Green %", higher: true, dp: 1, unit: "%", get: (c) => (c.apps ? (c.appGreen / c.apps) * 100 : null) },
    { key: "fwy", cat: "OTT", label: "Driving Accuracy", higher: true, dp: 1, unit: "%", get: (c) => (c.fwyN ? (c.fwy / c.fwyN) * 100 : null) },
    { key: "drive", cat: "OTT", label: "Driving Distance", higher: true, dp: 0, unit: " yds", get: (c) => (c.drives ? c.driveYds / c.drives : null) },
    { key: "putts", cat: "PUTT", label: "Putts / Round", higher: false, dp: 1, unit: "", get: (c) => (c.puttHoles ? (c.putts / c.puttHoles) * 18 : null) },
    { key: "threePutt", cat: "PUTT", label: "3-Putt Avoidance", higher: true, dp: 1, unit: "%", get: (c) => (c.puttHoles ? (1 - c.threePutts / c.puttHoles) * 100 : null) },
    { key: "ud", cat: "ARG", label: "Up & Down %", higher: true, dp: 1, unit: "%", get: (c) => (c.udN ? (c.ud / c.udN) * 100 : null) },
    { key: "birdie", cat: null, label: "Birdie Pct", higher: true, dp: 1, unit: "%", get: (c) => (c.holes ? (c.birdies / c.holes) * 100 : null) },
    { key: "bogey", cat: null, label: "Bogey Avoidance", higher: true, dp: 1, unit: "%", get: (c) => (c.holes ? (c.parOrBetter / c.holes) * 100 : null) },
    { key: "prox", cat: "APP", label: "Proximity", higher: false, dp: 1, unit: " ft", get: (c) => (c.proxN ? c.proxFt / c.proxN : null) },
    { key: "owgr", cat: null, label: "OWGR", soon: true },
  ];
  const sumCounts = (rounds) => {
    const t = {};
    for (const rd of rounds) for (const [k, v] of Object.entries(rd.basic || {})) t[k] = (t[k] || 0) + v;
    return t;
  };
  // a Basic stat over some rounds: entered rounds add up their counts; a stats file's rounds carry the stat itself
  const bval = (b, rounds) => {
    if (!b.get || !rounds?.length) return null;
    if (rounds.some((rd) => rd.basic && rd.basic.holes)) return b.get(sumCounts(rounds.filter((rd) => rd.basic)));
    const vs = rounds.map((rd) => rd.stats?.[b.key]).filter((v) => v != null && Number.isFinite(v));
    return vs.length ? vs.reduce((t, v) => t + v, 0) / vs.length : null;
  };
  const hasStat = (b, rd) => (rd.basic && b.get && b.get(rd.basic) != null) || (rd.stats && rd.stats[b.key] != null);
  const basicNow = () => BASIC.find((b) => b.key === st.basicStat) || BASIC[0];
  const fmtBasic = (b, v) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v.toFixed(b.dp)}${b.unit}`);
  function basicStatBar(bField, bMine) {
    const all = [...(bMine || []), ...bField.flatMap((p) => p.rounds)];
    const has = (b) => !b.soon && all.some((rd) => hasStat(b, rd));
    if (!has(basicNow())) { const first = BASIC.find(has); if (first) st.basicStat = first.key; }
    // the category pills narrow the list (whole-round stats like Scoring Avg show with All)
    const allowed = BASIC.filter((b) => (!st.cats.length ? true : b.cat && st.cats.includes(b.cat)));
    if (!allowed.some((b) => b.key === basicNow().key)) { const first = allowed.find(has); if (first) st.basicStat = first.key; }
    const sel = el("select", { "aria-label": "Stat Type" }, allowed.map((b) =>
      el("option", { value: b.key, selected: basicNow().key === b.key, disabled: !has(b) }, b.soon ? `${b.label} (coming soon)` : has(b) ? b.label : `${b.label} (not in this data)`)));
    sel.addEventListener("change", () => { st.basicStat = sel.value; draw(); });
    return el("div", { class: "stat-type" }, el("label", {}, ["Stat Type", sel]));
  }
  function basicBlocks(bField, bMine) {
    const b = basicNow();
    const all = [...(bMine || []), ...bField.flatMap((p) => p.rounds)];
    if (!all.some((rd) => hasStat(b, rd))) {
      return [el("section", { class: "panel" }, el("p", { class: "empty center" },
        "These stats come from rounds entered in Data Entry (every shot is recorded there). This data doesn\u2019t have them yet: switch to Entered Rounds, or use Advanced."))];
    }
    // rankings for the chosen stat
    const ranked = bField.map((p) => ({ p, v: bval(b, p.rounds), n: p.rounds.filter((rd) => hasStat(b, rd)).length }))
      .filter((x) => x.v != null && Number.isFinite(x.v)).sort((x, y) => (b.higher ? y.v - x.v : x.v - y.v));
    const rankRows = ranked.map((x, i) => el("tr", { class: x.p.key === me?.key ? "me" : "" }, [
      el("td", { class: "num" }, String(i + 1)), el("td", {}, x.p.label), el("td", { class: "num" }, el("strong", {}, fmtBasic(b, x.v))), el("td", { class: "num" }, String(x.n)),
    ]));
    const blocks = [];
    {
      const lines = [];
      const meRow = ranked.findIndex((x) => x.p.key === me?.key);
      if (me && meRow >= 0) {
        const x = ranked[meRow];
        lines.push(`${me.label} ${b.label}: ${fmtBasic(b, x.v)} over ${x.n} ${x.n === 1 ? "round" : "rounds"}, ${ordinal(meRow + 1)} of ${ranked.length} players (${b.higher ? "higher" : "lower"} is better).`);
        const ordered = [...(bMine || [])].sort((p, q) => String(p.date).localeCompare(String(q.date)));
        const n = Math.min(10, Math.floor(ordered.length / 2));
        if (n >= 2) {
          const last = bval(b, ordered.slice(-n)), prev = bval(b, ordered.slice(-2 * n, -n));
          if (last != null && prev != null) { const better = b.higher ? last > prev : last < prev; lines.push(Math.abs(last - prev) < 0.05 * Math.max(1, Math.abs(prev)) / 10 ? `Steady over the last ${n} rounds (${fmtBasic(b, last)}).` : `Last ${n} rounds: ${fmtBasic(b, last)}, against ${fmtBasic(b, prev)} in the ${n} before: ${better ? "better" : "worse"}.`); }
        }
      } else if (ranked.length) {
        lines.push(`${ranked.length} players. Best ${b.label}: ${ranked[0].p.label} (${fmtBasic(b, ranked[0].v)}). Pick a player for their own summary.`);
      }
      if (lines.length) blocks.push(el("section", { class: "panel sg-summary" }, [el("h3", {}, "Summary"), ...lines.map((t) => el("p", {}, t))]));
    }
    if (showRanks) blocks.push(panelBox(`Rankings \u00b7 ${b.label}`, ranked.length ? el("div", { class: "table-scroll ranks-scroll" }, el("table", { class: "plain rankings" }, [
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, b.label), el("th", { class: "num" }, "Rounds")])),
      el("tbody", {}, rankRows),
    ])) : el("p", { class: "empty" }, "No rounds in this selection.")));
    // the player's trend by date, with the chosen players (Top 1 / 10 / … / All) for the same dates
    if (me && bMine?.length) {
      const groups = groupBy(bMine, st.trendBy);
      const vals = groups.map((g) => bval(b, g.rounds));
      // each round / event / month / year: the best result(s) there among the players who played it (this player included)
      const others = bField.filter((p) => p.key !== me.key && p.rounds.length);
      const cmp = others.length ? groups.map((g, i) => topMean([vals[i], ...others.map((p) => {
        const rs = groupBy(p.rounds, st.trendBy).find((x) => x.label === g.label)?.rounds;
        return rs ? bval(b, rs) : null;
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

  /* ------------------------------ the summary (top of the stats) ------------------------------ */
  // A few plain sentences about exactly what's on screen (the same rounds, filters and players as the
  // rankings and charts), so it changes with every filter. Calculated from the numbers.
  const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
  const perRoundOf = (rounds, cat = null) => {
    if (!rounds.length) return null;
    let t = 0; for (const rd of rounds) for (const x of rd.shots) if (!cat || x.cat === cat) t += x.sg;
    return t / rounds.length;
  };
  const sgWord = (v) => `${v >= 0 ? "gains" : "loses"} ${Math.abs(v).toFixed(2)} strokes a round`;
  function rankAmong(slicedField, key, cat = null) {
    const vals = slicedField.filter((p) => p.rounds.length).map((p) => ({ key: p.key, v: perRoundOf(p.rounds, cat) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
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
      lines.push(`${name} ${sgWord(total)} over ${mine.length} ${mine.length === 1 ? "round" : "rounds"} (${what})${r.rank ? `, ${ordinal(r.rank)} of ${r.of} players` : ""}.`);
      if (cats.length > 1) {
        const byCat = cats.map(([k, l]) => ({ l, v: perRoundOf(mine, k), rk: rankAmong(slicedField, me.key, k) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
        if (byCat.length > 1) {
          const best = byCat[0], worst = byCat[byCat.length - 1];
          lines.push(`Strongest: ${best.l} (${fmtSG(best.v)}${best.rk.rank ? `, ${ordinal(best.rk.rank)}` : ""}). Weakest: ${worst.l} (${fmtSG(worst.v)}${worst.rk.rank ? `, ${ordinal(worst.rk.rank)}` : ""}).`);
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
        el("thead", {}, el("tr", {}, [["Stat", "Stat"], ["Rank", "Rank"], ["Player Avg", "Avg"], ["Player Peak", "Peak"], [others, "Tour"]].map(([long, short], i) =>
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
    return panelBox(`Rankings \u00b7 ${describe()}`, [
      searchable ? glass : null,
      searchable ? searchBox : null,
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
  const lastSig = new Map(); // each chart's last data (so unchanged charts don't re-animate)
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
      // only a chart whose data changed grows in again; the rest appear as they were
      try {
        const d = chart.data || {}, id = key || `${d.datasets?.[0]?.label || ""}|${size}|${(d.labels || []).length}`;
        const sig = JSON.stringify([d.labels, (d.datasets || []).map((x) => [x.type, x.data])]) + ((key && st.chartTypes[key]) || "");
        if (lastSig.get(id) === sig && typeof chart.stop === "function") { chart.stop(); chart.update("none"); }
        lastSig.set(id, sig);
      } catch { /* fine */ }
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
        x: { ticks: { color: muted }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: muted }, border: { display: false }, grid: { color: (c) => (c.tick?.value === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.05)"), lineWidth: (c) => (c.tick?.value === 0 ? 1.5 : 1) } },
      },
      animation: { duration: 650, easing: "easeOutQuart" },
      animations: { y: { from: (c) => (c.chart?.scales?.y ? c.chart.scales.y.getPixelForValue(0) : undefined) } },
    };
  }
  // A bar's colour, on one scale for the whole chart: a clear green (or red) at the zero line, darkening
  // out to the chart's biggest bar. So a +0.5 bar ends in the colour at the middle of a +1.0 bar.
  const GRAD = { up: ["#43c870", "#0b5a2a"], down: ["#ff5a4e", "#8a1712"], gold: ["#d9b97f", "#7f6031"] }; // [at zero, at the biggest bar]
  function barFill(c, single, hover = false) {
    const { chart, dataIndex } = c, area = chart.chartArea, y = chart.scales?.y;
    const v = c.dataset.data[dataIndex];
    const [near, far] = single ? GRAD.gold : v >= 0 ? GRAD.up : GRAD.down;
    if (!area || !y || v == null) return near;
    // each side on its own scale: green darkens to the biggest gain, red to the biggest loss
    const side = c.dataset.data.map((x) => Number(x) || 0).filter((x) => (v >= 0 ? x >= 0 : x < 0));
    const max = Math.max(...side.map(Math.abs), 1e-9);
    const z = y.getPixelForValue(0), end = y.getPixelForValue(v >= 0 ? max : -max);
    if (!Number.isFinite(z) || !Number.isFinite(end) || Math.abs(z - end) < 1) return near;
    const g = chart.ctx.createLinearGradient(0, z, 0, end); // the same span for every bar on this side
    g.addColorStop(0, near); g.addColorStop(1, far);
    return g;
  }
  /** The same scale for HTML bars (the leaderboard): the gradient spans the full track, the bar shows its part. */
  // width: on the shared scale; colour: on its own side's scale (darkest at the biggest gain / loss)
  const htmlBarStyle = (v, frac, colorFrac = frac) => {
    const [near, far] = v >= 0 ? GRAD.up : GRAD.down;
    const w = Math.max(0.04, frac), cf = Math.max(0.04, colorFrac);
    return `width:${w * 100}%;background:linear-gradient(90deg, ${near}, ${far});background-size:${100 / cf}% 100%;background-repeat:no-repeat`;
  };
  function barChart(canvas, labels, values, { title, compare, compareLabel = "All players", average, single, tooltip, shortLabels = null, as = "bar" } = {}) {
    const signColors = values.map((v) => (v >= 0 ? "#30d158" : "#ff453a"));
    const datasets = [as === "line"
      // Line: a champagne line through green / red points, shaded green above zero and red below.
      ? { type: "line", label: title || "", data: values, order: 2, borderColor: single || "#c8a97e", borderWidth: 2.5, tension: 0.35,
          pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: single || signColors, pointBorderColor: single || signColors,
          fill: single ? { target: "origin", above: "rgba(200,169,126,0.12)" } : { target: "origin", above: "rgba(48,209,88,0.10)", below: "rgba(255,69,58,0.10)" } }
      // Bars: light at the zero line, deepening (darker green up, darker red down) the further they reach;
      // square where they meet zero, rounded at the tip; a glint on hover; growing from zero when drawn.
      : { type: "bar", label: title || "", data: values, order: 2, maxBarThickness: 46, categoryPercentage: 0.72, barPercentage: 0.9,
          borderRadius: 8, borderSkipped: "start",
          backgroundColor: (c) => barFill(c, single), hoverBackgroundColor: (c) => barFill(c, single, true),
          borderWidth: 0 }];
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
      const max = narrow ? 12 : 18;
      return l.length > max ? `${l.slice(0, max - 1).trimEnd()}\u2026` : l;
    };
    o.scales.x = { ...(o.scales.x || {}), ticks: { ...((o.scales.x || {}).ticks || {}), callback: (v, i) => shortOf(i), autoSkip: true, maxRotation: narrow ? 50 : 30, font: { size: narrow ? 9 : 11 } } };
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
    destroy() { destroyCharts(); if (opts.viewHost) mount(opts.viewHost, null); if (opts.lead && opts.leadHome) { if (opts.lead.parentNode !== opts.leadHome) opts.leadHome.appendChild(opts.lead); opts.leadHome.hidden = false; } if (opts.slot && opts.slotHome) opts.slotHome.appendChild(opts.slot); document.removeEventListener("pointerdown", onDocDown); document.removeEventListener("keydown", onKey); },
    update(next) { if ("me" in next) me = next.me; if ("field" in next) field = next.field; draw(); },
  };
}
