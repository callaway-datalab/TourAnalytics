// (sgDashboard split) The filters: the bar of dropdowns, the tour / stat / year / category pills and the selection strip.
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { CATEGORIES, SPANS, el, filterOptions, fmtSG, gearInfo, gearLabel, infoTip, localDay, nf1, sgColor, shortDate, sliceTotals, statDef } from "./sgShared.js";

/* ------------------------------ filters ------------------------------ */
// A filter button that opens a checklist: pick any number of options (none = all). Each tick applies
// straight away; it stays open while you tick and closes when you tap outside, tap the button, or press Escape.
export function multi(S, label, key, options, allLabel, { plural, fmt = (v) => v, empty = "Nothing to pick for this selection." } = {}) {
  const chosen = new Set(S.st[key]);
  // nothing picked = everything: shown with every box ticked, unless you just pressed None (all unticked)
  S.st.noneShown ||= {};
  // (update 387) nothing ticked to start (which still means everything); All ticks every box, until one is changed
  const allTicked = !chosen.size && !!S.st.allShown?.[key];
  const labelOf = (v) => options.find((o) => o.value === v)?.label ?? fmt(v);
  const summary = !chosen.size || (options.length > 1 && chosen.size === options.length) ? allLabel // nothing or everything ticked = all
    : chosen.size <= 2 ? [...chosen].map(labelOf).join(", ") : `${chosen.size} ${plural}`;
  const open = S.st.openFilter === key;
  const btn = el("button", { type: "button", class: "ms-btn" + (chosen.size ? " on" : ""), "aria-expanded": open ? "true" : "false", "aria-label": `${label}: ${summary}` }, [
    el("span", { class: "ms-sum" }, summary), el("span", { class: "ms-caret", "aria-hidden": "true" }, "\u25BE"),
  ]);
  const toggle = (v, on) => {
    if (allTicked && !on) S.st[key] = options.map((o) => o.value).filter((x) => x !== v); // (from "all": everything but this one)
    else S.st[key] = on ? [...S.st[key], v] : S.st[key].filter((x) => x !== v);
    S.st.noneShown[key] = false;
    if (S.st[key].length && S.st[key].length === options.length) { S.st[key] = []; S.st.allShown = { ...(S.st.allShown || {}), [key]: true }; } // (everything ticked: back to "all", shown ticked)
    else S.st.allShown = { ...(S.st.allShown || {}), [key]: false };
    if (key === "dist" && on) { // a distance belongs to a category: make sure that category is picked
      const c = v.split("|")[0];
      if (!S.st.cats.length || S.st.cats.length === CATEGORIES.length) S.st.cats = [c]; else if (!S.st.cats.includes(c)) S.st.cats = [...S.st.cats, c];
    }
    if (key === "club" || key === "gear") S.followClubs();
    S.st.openFilter = key;
    S.draw();
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
  all.addEventListener("click", () => { S.st[key] = []; S.st.allShown = { ...(S.st.allShown || {}), [key]: true }; S.st.noneShown[key] = false; if (key === "club" || key === "gear") S.followClubs(); S.st.openFilter = key; S.draw(); });
  const none = el("button", { type: "button", class: "link ms-all" }, "None");
  none.addEventListener("click", () => { S.st[key] = []; S.st.noneShown[key] = false; S.st.allShown = { ...(S.st.allShown || {}), [key]: false }; if (key === "club" || key === "gear") S.followClubs(); S.st.openFilter = key; S.draw(); });
  // (update 227) a search box over a long list (Products, Tournaments, …): narrows the list as you type
  S.st.msQ ||= {};
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
  const search = options.length > 10 || key === "gear" ? el("input", { type: "search", class: "ms-search", placeholder: `Search ${plural || label.toLowerCase()}\u2026`, value: S.st.msQ[key] || "", "aria-label": `Search ${label}` }) : null;
  search?.addEventListener("input", () => { S.st.msQ[key] = search.value; filterRows(search.value); });
  if (search && S.st.msQ[key]) filterRows(S.st.msQ[key]);
  const panel = el("div", { class: "ms-panel", hidden: !open, role: "group", "aria-label": label }, [
    el("div", { class: "ms-top" }, [el("strong", {}, label), el("span", { class: "ms-allnone" }, [all, none])]),
    search,
    optBox,
  ]);
  btn.addEventListener("click", () => {
    const nowOpen = panel.hidden;
    S.container.querySelectorAll(".ms-panel").forEach((p) => { p.hidden = true; });
    S.container.querySelectorAll(".ms-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
    panel.hidden = !nowOpen; btn.setAttribute("aria-expanded", nowOpen ? "true" : "false");
    S.st.openFilter = nowOpen ? key : null;
  });
  return el("div", { class: "ms" }, [el("span", { class: "ms-label" }, label), btn, panel]);
}
export function clubOptions(S, opt) {
  return opt.club.map((c) => ({ value: c, label: c, group: opt.clubCats[c] || "Other" }))
    .sort((a, b) => S.CLUB_GROUPS.indexOf(a.group) - S.CLUB_GROUPS.indexOf(b.group));
}
// Picking clubs shows only the categories those clubs were used in (a driver: Off-the-Tee; a putter:
// Putting; a 7-iron: Approach, plus Off-the-Tee if it was hit off a par-4 tee). Clearing them shows all.
export function followClubs(S) {
  if (!S.st.club.length && !S.st.gear.length) { S.st.cats = []; return; }
  const base = S.me ? S.me.rounds : S.field.flatMap((p) => p.rounds);
  const picked = new Set(S.st.club), pickedG = new Set(S.st.gear); // (update 210: products too)
  const cats = new Set();
  for (const rd of base) for (const sh of rd.shots) if ((!picked.size || picked.has(sh.club)) && (!pickedG.size || pickedG.has(sh.gear) || (sh.ball && pickedG.has(`Ball|${sh.ball}`)))) cats.add(sh.cat);
  S.st.cats = CATEGORIES.map(([k]) => k).filter((k) => cats.has(k));
  S.st.dist = S.st.dist.filter((d) => S.st.cats.includes(d.split("|")[0]));
}
// The Tournament filter's list: the tournaments on the tour and in the years picked, newest first.
// (entered rounds: each tournament entered, and "Practice Rounds" for the rest)
export function eventOptions(S, rounds) {
  const tours = S.st.tour.length ? new Set(S.st.tour.map(String)) : null, years = S.st.year.length ? new Set(S.st.year.map(String)) : null;
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
export function sessionOptions(S, rounds) {
  const seen = new Set(rounds.map((rd) => rd.ptype).filter(Boolean));
  const kinds = ["custom", "prep", "sim"].map((k) => ({ value: k, label: S.PTYPE[k], group: "Sessions" }));
  const games = [...seen].filter((k) => k.startsWith("game:")).sort().map((k) => ({ value: k, label: k.slice(5), group: "Games" }));
  return [...kinds, ...games];
}
export function filterBar(S, opt, { bare = false } = {}) {
  const span = el("select", { "aria-label": "Span" }, SPANS.map(([v, l]) => el("option", { value: v, selected: String(S.st.span) === v }, l)));
  // (a span reaches back across years, so it shows every year: the year pills would cut it short)
  span.addEventListener("change", () => { S.st.span = Number(span.value); if (S.st.span > 0) { S.st.year = []; S.st.yearKept = []; } S.draw(); });
  const latest = [...opt.year].sort().pop();
  const active = ["event", "course", "roundNo", "lie", "dist", "club", "gear", "cats", "ptype"].some((k) => S.st[k].length) || Number(S.st.span) > 0
    || JSON.stringify(S.st.year) !== JSON.stringify(latest ? [latest] : []);
  const reset = el("button", { class: "link", type: "button", hidden: !active }, "Reset Filters");
  reset.addEventListener("click", () => {
    Object.assign(S.st, { span: 0, year: latest ? [latest] : [], tour: [], event: [], course: [], roundNo: [], lie: [], dist: [], club: [], cats: [], ptype: [], openFilter: null });
    S.draw();
  });
  // Distances, grouped under their category; with categories picked, only theirs show.
  const base = S.facet.picked;
  const distOpts = S.catsAvail.filter(([k]) => !S.st.cats.length || S.st.cats.includes(k))
    .flatMap(([k, label]) => S.optsOnce(`dist|${S.me ? `me:${S.me.key}` : "field"}|${S.statKey}|${k}`, () => filterOptions(base, k)).dist.map((d) => ({ value: `${k}|${d}`, label: d, group: label })));
  const simple = (vals, fmt = (v) => v) => vals.map((v) => ({ value: v, label: fmt(v) }));
  // On phones the filters fold behind a "Filters" button (with how many are in use).
  const inUse = ["event", "course", "roundNo", "lie", "dist", "club", "gear", "ptype"].filter((k) => S.st[k].length).length + (Number(S.st.span) > 0 ? 1 : 0);
  const fold = el("button", { type: "button", class: "filters-toggle", "aria-expanded": S.st.filtersOpen ? "true" : "false" },
    [`More Filters${inUse ? ` \u00b7 ${inUse} on` : ""}`, el("span", { "aria-hidden": "true" }, S.st.filtersOpen ? "\u25B4" : "\u25BE")]);
  fold.addEventListener("click", () => { S.st.filtersOpen = !S.st.filtersOpen; S.draw(); });
  return el("div", { class: "sg-filters" + (S.st.filtersOpen || bare ? " open" : "") + (bare ? " bare" : "") }, [
    bare ? null : fold,
    // (laid out like the other filters, so its heading matches theirs)
    el("div", { class: "span-pick" }, [el("span", { class: "ms-label" }, "Span"), span]),
    // Practice has no tournaments: its Session filter instead (custom practice, Course Prep, sim rounds, games)
    S.opts.practice ? S.multi("Session", "ptype", S.facet.sessions, "All sessions", { plural: "sessions", fmt: (v) => S.PTYPE[v] || String(v).replace(/^game:/, "") })
      : S.multi("Tournament", "event", S.facet.events, "All tournaments", { plural: "tournaments" }),
    // Course (update 160): when the data has a course column
    opt.course.length ? S.multi("Course", "course", simple(opt.course), "All courses", { plural: "courses" }) : null,
    S.opts.entered ? null : S.multi("Round", "roundNo", simple(opt.roundNo, (v) => `Round ${v}`), "All rounds", { plural: "rounds", fmt: (v) => `Round ${v}` }),
    // Lie and distance when this stat has them (always for entered rounds and practice); Club for strokes gained.
    opt.lie.length || (S.opts.entered && S.isSG()) ? S.multi("Lie", "lie", simple(opt.lie), "All lies", { plural: "lies", empty: "No lies in this selection yet." }) : null,
    distOpts.length || (S.opts.entered && S.isSG()) ? S.multi("Distance", "dist", distOpts, "All distances", { plural: "distances", fmt: (v) => v.split("|").slice(1).join("|"), empty: "No distances in this selection yet." }) : null,
    // Club: from Data Entry shots (WITB clubs) or a club column in an uploaded file.
    S.isSG() ? S.multi("Club", "club", S.clubOptions(opt), opt.club.length ? "All clubs" : "No club data", { plural: "clubs",
      empty: "No clubs in this data yet. Clubs come from shots entered with a Club (Data Entry) or a \u201cclub\u201d column in an uploaded file." }) : null,
    // (update 210) Product: a club model (brand and model) or a ball, under its kind of club
    S.isSG() && opt.gear.length ? S.multi("Product", "gear", opt.gear.map((v) => { const g = gearInfo(v); return { value: v, label: `${g.brand} ${g.model}`.trim(), group: g.kind === "Ball" ? "Golf Ball" : g.kind }; })
      .sort((a, b) => S.GEAR_ORDER.indexOf(a.group) - S.GEAR_ORDER.indexOf(b.group) || a.label.localeCompare(b.label)), "All products", { plural: "products", fmt: (v) => gearLabel(v) }) : null,
    reset,
  ]);
}
/* ---------------- the Filters panel (everything but the player search) ---------------- */
export function filtersPanel(S, opt) {
  if (S.st.panelOpen === undefined) S.st.panelOpen = false; // folded each time the page opens (update 166)
  const open = !!S.st.panelOpen;
  const src = S.opts.lead?.querySelector?.("[aria-current=page]")?.textContent || "";
  const yrs = S.st.year.length ? [...S.st.year].sort().reverse().join(" + ") : "All years";
  const cats = S.catsAvail.length < 2 ? "" : S.st.cats.length ? S.st.cats.map((k) => S.CAT_NAME[k] || k).join(" + ") : "All categories";
  const more = ["event", "course", "roundNo", "lie", "dist", "club", "gear", "ptype"].filter((k) => (S.st[k] || []).length).length + (Number(S.st.span) > 0 ? 1 : 0);
  const btn = el("button", { type: "button", class: "filters-panel-btn", "aria-expanded": open ? "true" : "false" }, [
    el("span", { class: "fp-title" }, "Filters"),
    el("span", { class: "fp-sum" }, [src, yrs, S.tourCounts.length ? S.tourName(S.st.tour[0] ?? "") : "", S.def.label, cats, more ? `${more} more` : ""].filter(Boolean).join(" \u00b7 ")),
    el("span", { class: "fp-caret", "aria-hidden": "true" }, open ? "\u25B4" : "\u25BE"),
  ]);
  btn.addEventListener("click", () => { S.st.panelOpen = !S.st.panelOpen; S.draw(); });
  // Stat Type sits beside the Filters button, so it's there whether the panel is open or folded
  return el("section", { class: `filters-panel${open ? " open" : ""}` }, [el("div", { class: "fp-head" }, [btn]), open ? el("div", { class: "fp-body" }, [
    S.yearsRow(opt, { cats: true }), S.filterBar(opt, { bare: true }),
  ]) : null]);
}
// Tour: one at a time (never mixed). Pills here and the tour buttons on the hero card.
export function tourPills(S) {
  if (!S.tourCounts.length) return null;
  return el("nav", { class: "subnav sg-tours", role: "radiogroup", "aria-label": "Tour" }, S.tourCounts.map(([t]) => {
    const on = S.st.tour[0] === t;
    const a = el("a", { href: "#", role: "radio", "aria-checked": on ? "true" : "false", "aria-current": on ? "page" : null }, S.tourName(t));
    a.addEventListener("click", (e) => { e.preventDefault(); if (!on) { S.st.tour = [t]; S.draw(); } });
    return a;
  }));
}
// Stat Type: every stat found in the data on screen. The tables and charts below follow what that stat has.
export function statSelect(S) {
  // (update 332) Leaderboards (no player): also Best Stretches, the players ranked by how long they played at a #1 level
  const withStretch = !S.me && !S.opts.entered && !S.opts.practice && S.statList.includes("sg");
  if (S.statList.length < 2 && !withStretch) return null;
  const stretchOn = withStretch && S.st.statWanted === "stretch", formOn = withStretch && S.st.statWanted === "form1";
  const sel = el("select", { class: "stat-select", "aria-label": "Stat type" }, [...S.statList.flatMap((k) => [el("option", { value: k, selected: !stretchOn && !formOn && k === S.statKey }, statDef(k).label),
    k === "sg" && withStretch ? el("option", { value: "stretch", selected: stretchOn }, "Elite Stretches (rounds in a row at a #1 level)") : null,
    k === "sg" && withStretch ? el("option", { value: "form1", selected: formOn }, "Elite Round Share (share of rounds at a #1 level)") : null]).filter(Boolean)]);
  sel.addEventListener("change", () => { S.st.statWanted = sel.value; S.st.openFilter = null; sel.blur(); S.draw(); });
  return el("label", { class: "stat-pick" }, [sel]); // (no "Stat Type" heading, update 166)
}
export function tourButtons(S) {
  if (!S.tourCounts.length || (S.tourCounts.length === 1 && S.tourCounts[0][0] === "")) return null;
  return el("div", { class: "tour-chips", role: "radiogroup", "aria-label": "Tour" }, S.tourCounts.map(([t, n]) => {
    const on = S.st.tour[0] === t;
    const b = el("button", { type: "button", role: "radio", "aria-checked": on ? "true" : "false", class: `tour-chip${on ? " on" : ""}` },
      S.tourName(t));
    b.addEventListener("click", () => { if (!on) { S.st.tour = [t]; S.draw(); } });
    return b;
  }));
}
// rounds grouped by round / event / month / year (in date order), for a stat's trend
export function groupBy(S, rounds, by) {
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
export function tapPill(S, key, value, order, ev = null) {
  const keepKey = `${key}Kept`;
  S.st[keepKey] = (S.st[keepKey] || []).filter((v) => S.st[key].includes(v));
  // (update 394) when the tap happened, not when it's handled: the first tap's redraw can take a while (un-picking the
  // only year redraws every year's data), and the second tap waits behind it, so it looked too late to be a double-tap
  const now = ev && Number.isFinite(ev.timeStamp) ? performance.timeOrigin + ev.timeStamp : Date.now();
  const dbl = S.lastTap && S.lastTap.key === key && S.lastTap.value === value && now - S.lastTap.at < 400;
  if (dbl) {
    // the first tap did its single-tap part; the second makes it kept (and picked)
    S.st[keepKey] = [...new Set([...S.st[keepKey], value])];
    if (!S.st[key].includes(value)) S.st[key] = [...S.st[key], value];
    S.lastTap = null;
  } else {
    const was = S.st[keepKey].includes(value) ? "kept" : S.st[key].includes(value) ? "on" : "off";
    if (was === "kept") S.st[keepKey] = S.st[keepKey].filter((v) => v !== value);       // unlock, stay picked
    else if (was === "on") S.st[key] = S.st[key].filter((v) => v !== value);           // un-pick
    else S.st[key] = [...S.st[keepKey], value];                                        // just this one (+ kept)
    S.lastTap = { key, value, at: now, was };
  }
  S.st[key].sort(order);
  S.draw();
}
export function yearPills(S, opt) {
  if (!opt.year.length) return null;
  const years = [...opt.year].sort().reverse(); // newest first; "All years" at the end
  const all = el("a", { href: "#", "aria-current": !S.st.year.length ? "page" : null }, "All years");
  all.addEventListener("click", (e) => { e.preventDefault(); S.st.year = []; S.st.yearKept = []; S.draw(); });
  const kept = S.keptOf("year");
  return el("nav", { class: "subnav sg-years", "aria-label": "Years: tap to pick one, double-tap to keep it and add more" }, [...years.map((y) => {
    const on = S.st.year.includes(y), isKept = kept.includes(y);
    const a = el("a", { href: "#", class: isKept ? "kept" : "", "aria-current": on ? "page" : null, "aria-pressed": on ? "true" : "false",
      title: isKept ? "Kept: double-tap to let it go" : "Tap to pick; double-tap to keep it and add more" }, y);
    a.addEventListener("click", (e) => { e.preventDefault(); S.tapPill("year", y, (p, q) => p.localeCompare(q), e); });
    return a;
  }), all]);
}
export function catPills(S) {
  const allOn = !S.st.cats.length;
  const all = el("a", { href: "#", "aria-current": allOn ? "page" : null }, "All");
  all.addEventListener("click", (e) => { e.preventDefault(); S.st.cats = []; S.st.catsKept = []; S.draw(); });
  const kept = S.keptOf("cats");
  return el("nav", { class: "subnav sg-tabs", "aria-label": "Categories: tap to pick one, double-tap to keep it and add more" }, [all, ...S.catsAvail.map(([k, label]) => {
    const on = S.st.cats.includes(k), isKept = kept.includes(k);
    const a = el("a", { href: "#", class: isKept ? "kept" : "", "aria-current": on ? "page" : null, "aria-pressed": on ? "true" : "false",
      title: isKept ? "Kept: double-tap to let it go" : "Tap to pick; double-tap to keep it and add more" }, label);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      S.tapPill("cats", k, (x, y) => CATEGORIES.findIndex(([c]) => c === x) - CATEGORIES.findIndex(([c]) => c === y), e);
    });
    return a;
  })]);
}
/* ------------------------------ your selection ------------------------------ */
export function selectionStrip(S, mine, slicedField) {
  const t = sliceTotals(mine);
  const r = S.rankOf(slicedField, S.me.key, (rs) => sliceTotals(rs).sgPerRound);
  const cell = (label, value, style) => el("div", {}, [el("dt", {}, label), el("dd", { style }, value)]);
  return el("section", { class: "panel sg-selection" }, [
    el("h3", {}, `${S.me.label}: ${S.describe()}`),
    el("dl", { class: "facts glance" }, [
      cell("SG / Round", fmtSG(t.sgPerRound), `color:${t.sgPerRound === null ? "inherit" : sgColor(t.sgPerRound)}`),
      cell("Attempts / Round", t.attemptsPerRound === null ? "\u2014" : nf1.format(t.attemptsPerRound)),
      cell("SG / Attempt", t.sgPerAttempt === null ? "\u2014" : `${t.sgPerAttempt >= 0 ? "+" : ""}${t.sgPerAttempt.toFixed(3)}`),
      cell("Rounds", String(t.rounds)),
      !S.showRanks ? null : cell(S.fieldIsSummary() && S.narrowed() ? `Rank \u00b7 ${S.catsName()}` : "Rank", r ? `${r.rank} of ${r.of}` : "\u2014"),
    ]),
    S.fieldIsSummary() && S.narrowed() ? infoTip("Rank uses the category and rounds you've picked; rankings don't break down by lie or distance.") : null,
  ]);
}
