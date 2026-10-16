/*
 * Comparisons (update 188): pick a player, then any slices of their rounds (seasons, time windows,
 * tournaments, courses, round numbers, months, tours, or a date range of your own) and see them side by side:
 *   \u00b7 a card for each, and what stands out in plain words
 *   \u00b7 strokes gained by category in a table (best / worst shaded) and a grouped bar chart
 *   \u00b7 every round as a dot (the spread, the middle half, the median), and how each one unfolded
 *   \u00b7 strokes gained by distance, and the other stats (fairways, greens, proximity \u2026)
 * And, for the player as a whole: are they getting better or worse (last 5, 10, 20, 40, 80 rounds against
 * the same number before), and in which conditions they play their best (round, course, month, \u2026).
 * Hover a selection (its card or its key) to pick it out in every chart.
 */
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { playerPicker } from "../playerPicker.js";
import { CATEGORIES, fmtStat, fmtSG } from "../sg.js";
import {
  COLORS, MAX_SEL, SG_ROWS, options, roundsFor, windowFilter, summarize, confidence, distanceProfile, statRows, statSets,
  trajectory, trajectoryWords, DIMENSIONS, products, conditions, insights, fmtSigned, sgOf,
} from "../compareData.js";

const LS_PLAYER = "ta:cmp:player";
const NS = "http://www.w3.org/2000/svg";
const mk = (t, a = {}, text = null) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) n.setAttribute(k, String(v)); if (text != null) n.textContent = text; return n; };
const HALO = { stroke: "#121214", "stroke-width": 3.5, "stroke-linejoin": "round", "paint-order": "stroke" };
const INK = "rgba(235,235,245,0.62)", GRID = "rgba(255,255,255,0.07)";
const tone = (v) => (v == null ? "" : Math.round(v * 100) === 0 ? "zero" : v > 0 ? "pos" : "neg");
const dateTxt = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); const t = m ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(d); return isNaN(t) ? String(d || "") : t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }); };
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

const MODES = [
  ["years", "Seasons", "Each season side by side."],
  ["windows", "Time windows", "Recent form against what came before, or the whole career."],
  ["tournaments", "Tournaments", "Any events, this year or any year."],
  ["courses", "Courses", "Where they play their best."],
  ["rounds", "Rounds", "Openers against weekends."],
  ["months", "Months", "The time of year."],
  ["tours", "Tours", "One tour against another."],
  ["custom", "Date range", "Any stretch of dates you choose."],
  // (update 190) a club model or ball, grouped by type
  ["product", "Product", "How they play with one club model or ball against another (only the shots hit with it count)."],
];
const FIND = { tournaments: "a tournament", courses: "a course", product: "a club or ball", months: "a month", years: "a season", tours: "a tour" };

export async function render(main) {
  const state = getState();
  const team = effectiveTeam(state);
  // who can be compared: the admin everyone, a coach their players, a player themselves
  let players = [];
  if (state.isAdmin && !team.preview) { try { players = [...(await (await import("../store.js")).adminAllClients()).labels].map(([k, l]) => [k, plainName(l)]); } catch { players = []; } }
  else if (team.isTeam) players = [...teamLabels(team.teamAccess)];
  const self = !state.isAdmin && !team.isTeam && state.profile?.clientKey ? [state.profile.clientKey, state.profile.name || "Me"] : null;
  players.sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  let player = null;
  const wanted = q.get("player") || ls.get(LS_PLAYER);
  if (self) player = { key: self[0], label: self[1] };
  else if (wanted && players.some(([k]) => k === wanted)) player = { key: wanted, label: players.find(([k]) => k === wanted)[1] };
  else if (players.length === 1) player = { key: players[0][0], label: players[0][1] };

  let source = "tour", mode = "years", data = null, opts = null, sels = [], loadingFor = null, chipFilter = "", distCat = "APP", distPer = "round", dim = "round";
  // (update 189) picks wait here until "Add to comparison": several together become one group (their rounds pooled)
  let staged = new Map(); // value → { label, f }
  // (update 190) untouched: the default comparison, so the whole-career tables (better or worse, best conditions) show
  let touched = false;
  const others = new Map(); // `${player}|${source}` → their rounds
  // (update 192) the players in the comparison: the one you're looking at, plus any you add; every selection is shown for each of them
  let extra = []; // [{ key, label }]
  const inPlay = () => (player ? [player, ...extra] : []);
  const multi = () => extra.length > 0;
  const roundsOfKey = (k) => (k === player?.key ? data.rounds : others.get(`${k}|${source}`) || []);
  const roundsOf = (it) => (it.pk ? roundsOfKey(it.pk) : data.rounds);
  const allRounds = () => (multi() ? inPlay().flatMap((p) => roundsOfKey(p.key)) : data.rounds);
  const room = (nSels, nPlayers) => nSels * nPlayers <= MAX_SEL;
  async function loadOthers(list) {
    const { loadSource } = await import("../reportGen.js");
    await Promise.all(list.map(async (p) => {
      const ck = `${p.key}|${source}`;
      if (others.has(ck)) return;
      try { const res = await loadSource(source, p.key, p.label, { detail: false }); others.set(ck, res?.me?.rounds || []); } catch { others.set(ck, []); }
    }));
  }
  const root = el("div", { class: "cmp" });
  mount(main, root);

  /* ------------------------------ selections ------------------------------ */
  const nextColor = () => COLORS.find((c) => !sels.some((s) => s.color === c)) || COLORS[sels.length % COLORS.length];
  const has = (id) => sels.some((s) => s.id === id);
  function toggleSel(id, name, f) {
    if (has(id)) sels = sels.filter((s) => s.id !== id);
    else { if (!room(sels.length + 1, inPlay().length)) { flashNote(capNote()); return; } sels = [...sels, { id, name, f, color: nextColor() }]; }
    touched = true;
    draw();
  }
  let noteTimer = null;
  const note = el("p", { class: "cmp-note", role: "status" });
  const capNote = () => (multi() ? `Up to ${MAX_SEL} on the charts: with ${inPlay().length} players that\u2019s ${Math.floor(MAX_SEL / inPlay().length)} picks each. Take one off first.` : `Up to ${MAX_SEL} at a time: take one off first.`);
  const flashNote = (t) => { note.textContent = t; clearTimeout(noteTimer); noteTimer = setTimeout(() => { note.textContent = ""; }, 3500); };
  // the default: the two latest seasons (or recent form, with only one)
  function defaults() {
    sels = []; touched = multi();
    if (opts.years.length >= 2) { mode = "years"; opts.years.slice(0, 2).forEach((y) => sels.push({ id: `years:${y.value}`, name: y.label, f: { years: [y.value] }, mode: "years", values: [y.value], color: nextColor() })); } // (this year, then last year)
    else if (opts.total >= 10) { // (one season: the latest rounds against the same number before)
      const n = [20, 10, 5].find((x) => opts.total >= 2 * x);
      mode = "windows"; sels.push({ id: `windows:prev:${n}`, name: `The ${n} before that`, f: { prev: n }, color: nextColor() }, { id: `windows:last:${n}`, name: `Last ${n} rounds`, f: { last: n }, color: nextColor() });
    } else if (opts.years.length) { mode = "years"; sels.push({ id: `years:${opts.years[0].value}`, name: opts.years[0].label, f: { years: [opts.years[0].value] }, color: nextColor() }); }
  }

  /* ------------------------------ loading a player ------------------------------ */
  async function load() {
    if (!player) { data = null; draw(); return; }
    const k = `${player.key}|${source}`;
    loadingFor = k; data = null; draw();
    let res = null;
    try { const { loadSource } = await import("../reportGen.js"); res = await loadSource(source, player.key, player.label, { detail: false }); } catch (err) { console.warn(err); }
    if (loadingFor !== k) return;
    data = { rounds: res?.me?.rounds || [] };
    others.set(k, data.rounds);
    extra = extra.filter((p) => p.key !== player.key);
    if (extra.length) { await loadOthers(extra); if (loadingFor !== k) return; }
    opts = options(allRounds());
    defaults();
    draw();
  }

  /* ------------------------------ the page ------------------------------ */
  function draw() {
    // (update 189) just the player search at the top; everything else once a player is picked
    const head = pickerNode();
    if (!player) { mount(root, [head]); return; }
    if (!data) { mount(root, [head, el("section", { class: "panel cmp-empty" }, [el("div", { class: "cmp-spin", "aria-hidden": "true" }), el("p", { class: "muted" }, `Loading ${player.label}\u2019s rounds\u2026`)])]); return; }
    if (!opts.total) { mount(root, [head, el("section", { class: "panel cmp-empty" }, [el("h2", {}, "No rounds to compare"), el("p", { class: "muted" }, source === "tour" ? `${player.label} has no Tour Events rounds with strokes gained yet.` : `${player.label} hasn\u2019t entered any rounds yet.`)])]); return; }

    const y = window.scrollY;
    // (update 192) with more than one player: each selection for each of them ("Pat · 2026", "Lee · 2026", …)
    const base = multi() ? sels.flatMap((s) => inPlay().map((p) => ({ ...s, id: `${s.id}@${p.key}`, base: s.id, pk: p.key, name: `${p.label} \u00b7 ${s.name}`, full: `${p.label} \u00b7 ${s.full || s.name}` }))).slice(0, MAX_SEL).map((x, i) => ({ ...x, color: COLORS[i % COLORS.length] })) : sels;
    const items = base.map((s, i) => { const rs = roundsFor(roundsOf(s), s.f); return { ...s, i, rs, s: summarize(rs) }; });
    mount(root, [
      head,
      playersRow(),
      builder(),
      items.length ? selectedBar(items) : null,
      items.length ? cards(items) : el("section", { class: "panel cmp-empty small" }, el("p", { class: "muted" }, "Pick two or more above to compare them.")),
      items.length >= 2 ? standout(items) : null,
      items.length ? sgSection(items) : null,
      items.length ? roundsSection(items) : null,
      items.length ? distanceSection(items) : null,
      items.length ? statsSection(items) : null,
      // (update 190) the player's whole career: shown until you make your own comparison (then it would only muddle it)
      !multi() && (!touched || !sels.length) ? trajectorySection() : null,
      !multi() && (!touched || !sels.length) ? conditionsSection() : null,
      el("p", { class: "muted small center cmp-foot" }, "Strokes gained values represent per round averages. Each selection counts the strokes-gained rounds that fall in it; a round can be in more than one."),
    ]);
    window.scrollTo(0, y);
  }

  function pickerNode() {
    if (self || players.length <= 1) return null; // (only one player: nothing to search)
    const pp = playerPicker(new Map(players), (p) => { if (!p || p.key === player?.key) return; extra = extra.filter((x) => x.key !== p.key); player = { key: p.key, label: p.label }; ls.set(LS_PLAYER, p.key); staged = new Map(); load(); });
    if (player) pp.preset(player.key);
    const inp = pp.node.querySelector("input");
    inp?.addEventListener("focus", () => { if (inp.value) { inp.value = ""; inp.dispatchEvent(new Event("input")); } });
    inp?.addEventListener("blur", () => setTimeout(() => { if (!inp.value && player) pp.preset(player.key); }, 300));
    if (inp) inp.placeholder = "Type a player\u2019s name\u2026";
    return el("div", { class: "cmp-who cmp-top" }, pp.node);
  }
  // (update 192) Players: who's being compared, above everything you pick (the one you're looking at is always in)
  function playersRow() {
    if (self || players.length <= 1) return null;
    const rest = new Map(players.filter(([k]) => !inPlay().some((p) => p.key === k)));
    const chips = inPlay().map((p, i) => {
      const x = i ? el("button", { type: "button", class: "cmp-key-x cmp-pl-x", "aria-label": `Take ${p.label} out` }, "\u2715") : null;
      x?.addEventListener("click", () => { extra = extra.filter((e) => e.key !== p.key); opts = options(allRounds()); touched = true; draw(); });
      return el("span", { class: `cmp-pl${i ? "" : " main"}` }, [el("span", {}, p.label), x]);
    });
    let adder = null;
    if (rest.size && extra.length < MAX_SEL - 1) {
      const pp = playerPicker(rest, async (p) => {
        if (!p) return;
        if (!room(Math.max(1, sels.length), inPlay().length + 1)) { flashNote(`Up to ${MAX_SEL} on the charts: take a pick off first, then add ${p.label}.`); const i0 = pp.node.querySelector("input"); if (i0) i0.value = ""; return; }
        flashNote(`Loading ${p.label}\u2026`);
        await loadOthers([p]);
        extra = [...extra, { key: p.key, label: p.label }];
        opts = options(allRounds()); touched = true; note.textContent = "";
        draw();
      });
      const inp = pp.node.querySelector("input");
      if (inp) inp.placeholder = "\uff0b Add a player\u2026";
      adder = el("div", { class: "cmp-pl-add" }, pp.node);
    }
    return el("section", { class: "panel cmp-players" }, [
      el("div", { class: "cmp-build-top" }, [el("h2", {}, "Players"), el("span", { class: "muted small" }, multi() ? "Every pick below is shown for each of them." : "Add another player to compare them side by side.")]),
      el("div", { class: "cmp-pl-row" }, [...chips, adder]),
    ]);
  }
  function sourceSeg() {
    return el("div", { class: "cmp-seg", role: "group", "aria-label": "Data" }, [["tour", "Tour Events"], ["entered", "Entered Rounds"]].map(([v, l]) => {
      const b = el("button", { type: "button", class: `cmp-seg-b${source === v ? " on" : ""}`, "aria-pressed": String(source === v) }, l);
      b.addEventListener("click", () => { if (source === v) return; source = v; load(); });
      return b;
    }));
  }

  /* ------------------------------ choosing what to compare ------------------------------ */
  function builder() {
    const modes = MODES.filter(([m]) => m !== "tours" || opts.tours.length > 1).filter(([m]) => m !== "courses" || opts.courses.length).filter(([m]) => m !== "rounds" || opts.rounds.length > 1);
    if (!modes.some(([m]) => m === mode)) mode = "years";
    const tabs = el("div", { class: "cmp-modes", role: "tablist", "aria-label": "Compare by" }, modes.map(([m, l]) => {
      const b = el("button", { type: "button", role: "tab", class: `cmp-mode${mode === m ? " on" : ""}`, "aria-selected": String(mode === m) }, l);
      b.addEventListener("click", () => { if (mode === m) return; mode = m; chipFilter = ""; staged = new Map(); draw(); });
      return b;
    }));
    const hint = el("p", { class: "cmp-hint" }, modes.find(([m]) => m === mode)[2]);
    let body;
    if (mode === "custom") body = customForm();
    else {
      const prods = mode === "product" ? products(allRounds()) : [];
      const list = mode === "product" ? prods.flatMap((g) => g.items)
        : { years: opts.years, windows: opts.windows, tournaments: opts.tournaments, courses: opts.courses, rounds: opts.rounds, months: opts.months, tours: opts.tours }[mode] || [];
      const filterOf = (o) => (mode === "years" ? { years: [o.value] } : mode === "windows" ? windowFilter(o.value) : mode === "tournaments" ? { events: [o.value] } : mode === "courses" ? { courses: [o.value] } : mode === "rounds" ? { roundNos: [o.value] } : mode === "months" ? { months: [o.value] } : mode === "product" ? { clubs: [o.value] } : { tours: [o.value] });
      const long = list.length > 14;
      const search = long ? el("input", { type: "search", class: "cmp-chip-search", placeholder: `Find ${FIND[mode] || "one"}\u2026`, value: chipFilter }) : null;
      const chipsBox = el("div", { class: "cmp-chips-wrap" });
      const addRow = el("div", { class: "cmp-addrow" });
      const chip = (o) => {
        const on = staged.has(o.value);
        // (a small dot for each selection already in the comparison that includes it)
        const inSel = multi() ? [] : sels.filter((x) => x.mode === mode && x.values?.includes(o.value));
        const b = el("button", { type: "button", class: `cmp-chip${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, o.label, o.n == null ? null : el("span", { class: "cmp-chip-n" }, `${o.n} rd${o.n === 1 ? "" : "s"}`),
          inSel.length ? el("span", { class: "cmp-chip-dots", title: `In: ${inSel.map((x) => x.name).join(", ")}` }, inSel.map((x) => el("i", { style: `background:${x.color}` }))) : null]);
        b.addEventListener("click", () => { if (on) staged.delete(o.value); else staged.set(o.value, { label: o.long || o.label, f: filterOf(o) }); drawChips(); drawAdd(); });
        return b;
      };
      const drawChips = () => {
        const t = chipFilter.trim().toLowerCase();
        const shown = list.filter((o) => !t || o.label.toLowerCase().includes(t)).slice(0, long && !t ? 30 : 200);
        if (mode === "windows") {
          // (update 189) in three groups: recent form, the rounds just before, seasons and career
          // (update 190) the first two also take a number of your own
          const groups = [["Recent form", (o) => o.value.startsWith("last:") && !o.own, "last"], ["The rounds just before", (o) => o.value.startsWith("prev:") && !o.own, "prev"], ["Seasons and career", (o) => o.value.startsWith("year:") || o.value === "all", null]];
          const ownStaged = [...staged].filter(([v]) => !list.some((o) => o.value === v) && /^(last|prev):/.test(v)).map(([v, x]) => ({ value: v, label: x.label, n: Number(v.split(":")[1]) }));
          mount(chipsBox, groups.map(([g, test, kind]) => { const xs = [...shown.filter(test), ...ownStaged.filter((o) => kind && o.value.startsWith(kind + ":"))]; return el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, g), el("div", { class: "cmp-chips" }, [...xs.map(chip), kind ? ownWindow(kind) : null])]); }));
        } else if (mode === "product") {
          mount(chipsBox, prods.length ? prods.map((g) => { const xs = g.items.filter((o) => shown.includes(o)); return xs.length ? el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, g.group === "Other" ? "Other clubs" : g.group === "Ball" ? "Golf balls" : `${g.group}s`), el("div", { class: "cmp-chips" }, xs.map(chip))]) : null; })
            : el("div", { class: "cmp-empty-note" }, [el("strong", {}, "No club data in this file yet."), el("p", { class: "muted small" }, "Once the data has each shot\u2019s equipment (clubType, clubBrand, clubModel, ballBrand and ballModel columns), every club model shows here, grouped by type (drivers, fairway woods, hybrids, irons, wedges, putters), with the golf balls after them. Pick one model against another to see how they play with each.")]));
        } else mount(chipsBox, el("div", { class: "cmp-chips" }, shown.map(chip)));
      };
      const drawAdd = () => {
        const n = staged.size;
        const add = el("button", { type: "button", class: "btn cmp-add", disabled: !n }, n > 1 ? `\uff0b Add these ${n} as one` : "\uff0b Add to comparison");
        add.addEventListener("click", addStaged);
        const clear = n ? el("button", { type: "button", class: "link" }, "Clear picks") : null;
        clear?.addEventListener("click", () => { staged = new Map(); drawChips(); drawAdd(); });
        mount(addRow, [add, el("span", { class: "muted small" }, n ? (n > 1 ? `${n} picked: their rounds are pooled into one selection.` : "1 picked.") : "Tap one or more, then add them."), clear]);
      };
      // (update 190) your own window: "Last [n] rounds" / "The [n] before that"
      function ownWindow(kind) {
        const inp = el("input", { type: "number", min: 1, max: 999, class: "cmp-own-n", "aria-label": kind === "last" ? "How many latest rounds" : "How many rounds before those", placeholder: "#" });
        const go = el("button", { type: "button", class: "cmp-own-go", "aria-label": "Pick it" }, "\u2713");
        const pick = () => {
          const n = Math.round(Number(inp.value));
          if (!n || n < 1) { inp.focus(); return; }
          if (kind === "last" ? n > opts.total : 2 * n > opts.total) { flashNote(kind === "last" ? `They have ${opts.total} rounds here.` : `Only ${opts.total} rounds here: ${Math.floor(opts.total / 2)} at most, so there are that many before them.`); return; }
          const v = `${kind}:${n}`, label = kind === "last" ? `Last ${n} rounds` : `The ${n} before that`;
          staged.set(v, { label, f: windowFilter(v) }); drawChips(); drawAdd();
        };
        go.addEventListener("click", pick);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pick(); } });
        return el("span", { class: "cmp-chip cmp-own" }, [kind === "last" ? "Last" : "The", inp, kind === "last" ? "rounds" : "before that", go]);
      }
      search?.addEventListener("input", () => { chipFilter = search.value; drawChips(); });
      drawChips(); drawAdd();
      body = el("div", {}, [search, chipsBox, long && !chipFilter && mode !== "product" ? el("p", { class: "muted small" }, `Showing the latest 30 of ${list.length}: type to find others.`) : null, addRow]);
    }
    return el("section", { class: "panel cmp-build" }, [el("div", { class: "cmp-build-top" }, [el("h2", {}, "Compare by"), sourceSeg()]), tabs, hint, body, note]);
  }
  // (update 189) the picks, as one selection (several: their rounds pooled, so it's their average)
  async function addStaged() {
    if (!staged.size) return;
    const vals = [...staged.keys()], picks = [...staged.values()];
    const id = `${mode}:${[...vals].sort().join("|")}`;
    if (has(id)) { flashNote("That\u2019s already in the comparison."); return; }
    if (!room(sels.length + 1, inPlay().length)) { flashNote(capNote()); return; }
    const labels = picks.map((x) => x.label);
    const name = labels.length === 1 ? labels[0] : labels.length === 2 ? `${labels[0]} + ${labels[1]}` : `${labels[0]}, ${labels[1]} + ${labels.length - 2} more`;
    const f = picks.length === 1 ? picks[0].f : mode === "product" ? { clubs: vals } : { any: picks.map((x) => x.f) };
    sels = [...sels, { id, name, f, mode, values: vals, full: labels.join(", "), color: nextColor() }];
    staged = new Map(); touched = true;
    draw();
  }
  function customForm() {
    const from = el("input", { type: "date", class: "cmp-date", "aria-label": "From" }), to = el("input", { type: "date", class: "cmp-date", "aria-label": "To" });
    const name = el("input", { type: "text", class: "cmp-name", placeholder: "Name (optional)", maxLength: 40 });
    const rnd = new Set();
    const rounds = opts.rounds.length > 1 ? el("div", { class: "cmp-chips cmp-mini" }, [el("span", { class: "muted small" }, "Only:"), ...opts.rounds.map((o) => {
      const b = el("button", { type: "button", class: "cmp-chip", "aria-pressed": "false" }, o.label);
      b.addEventListener("click", () => { rnd.has(o.value) ? rnd.delete(o.value) : rnd.add(o.value); b.classList.toggle("on", rnd.has(o.value)); b.setAttribute("aria-pressed", String(rnd.has(o.value))); });
      return b;
    })]) : null;
    const add = el("button", { type: "button", class: "btn cmp-add" }, "\uff0b Add to comparison");
    add.addEventListener("click", () => {
      if (!from.value && !to.value) { flashNote("Pick a start or end date (or both)."); return; }
      const f = { from: from.value || null, to: to.value || null, roundNos: rnd.size ? [...rnd] : null };
      const n = roundsFor(allRounds(), f).length;
      if (!n) { flashNote("No rounds in those dates."); return; }
      const auto = `${from.value ? dateTxt(from.value) : "Start"} \u2013 ${to.value ? dateTxt(to.value) : "now"}${rnd.size ? ` (R${[...rnd].join(", R")})` : ""}`;
      toggleSel(`custom:${Date.now()}`, name.value.trim() || auto, f);
    });
    return el("div", { class: "cmp-custom" }, [el("label", { class: "cmp-field" }, [el("span", {}, "From"), from]), el("label", { class: "cmp-field" }, [el("span", {}, "To"), to]), name, rounds, add]);
  }
  // the chosen ones, as removable keys (hover to pick one out everywhere)
  function selectedBar(items) {
    const clear = el("button", { type: "button", class: "link cmp-clear" }, "Clear all");
    clear.addEventListener("click", () => { sels = []; touched = true; draw(); });
    return el("div", { class: "cmp-selbar" }, [...items.map((it) => {
      const x = el("button", { type: "button", class: "cmp-key-x", "aria-label": it.base ? `Remove ${sels.find((s) => s.id === it.base)?.name} (for every player)` : `Remove ${it.name}` }, "\u2715");
      x.addEventListener("click", () => { sels = sels.filter((s) => s.id !== (it.base || it.id)); touched = true; draw(); });
      return hoverable(el("span", { class: "cmp-key", style: `--c:${it.color}`, title: it.full || it.name }, [el("i", { "aria-hidden": "true" }), el("span", {}, it.name), el("span", { class: "cmp-key-n" }, `${it.s.n}`), x]), it.i);
    }), clear]);
  }
  const hoverable = (node, i) => { node.addEventListener("mouseenter", () => { root.dataset.hl = String(i); }); node.addEventListener("mouseleave", () => { delete root.dataset.hl; }); return node; };

  /* ------------------------------ results ------------------------------ */
  function cards(items) {
    return el("section", { class: "cmp-cards" }, items.map((it) => hoverable(el("article", { class: "panel cmp-card", style: `--c:${it.color}`, "data-s": it.i }, [
      el("div", { class: "cmp-card-top" }, [el("span", { class: "cmp-card-name" }, it.name)]),
      it.s.n ? el("p", { class: "cmp-card-meta" }, `${it.s.n} round${it.s.n === 1 ? "" : "s"} \u00b7 ${it.s.events} event${it.s.events === 1 ? "" : "s"} \u00b7 ${dateTxt(it.s.from)} \u2013 ${dateTxt(it.s.to)}`) : el("p", { class: "cmp-card-meta" }, "No rounds"),
      el("div", { class: "cmp-card-big" }, [el("strong", { class: tone(it.s.sg.TOTAL) }, it.s.n ? fmtSG(it.s.sg.TOTAL) : "\u2014"), el("span", {}, "SG: Total a round")]),
      el("div", { class: "cmp-card-cats" }, CATEGORIES.map(([k]) => el("div", {}, [el("span", {}, k), el("strong", { class: tone(it.s.sg[k]) }, it.s.n ? fmtSG(it.s.sg[k]) : "\u2014")]))),
      it.s.n >= 2 ? el("p", { class: "cmp-card-foot" }, `Best ${fmtSG(it.s.best)} \u00b7 worst ${fmtSG(it.s.worst)} \u00b7 ${Math.round(it.s.gaining * 100)}% of rounds gaining`) : null,
    ]), it.i)));
  }
  function standout(items) {
    const list = insights(items.map((it) => ({ name: it.name, s: it.s })));
    if (!list.length) return null;
    return el("section", { class: "panel cmp-standout" }, [el("h2", {}, "What stands out"), el("ul", {}, list.map((x) => el("li", { class: x.tone }, x.text)))]);
  }

  // strokes gained: the table (each row shaded best to worst) and the grouped bars
  function sgSection(items) {
    const live = items.filter((it) => it.s.n);
    const shade = (vals, v) => { const xs = vals.filter((x) => x != null); if (xs.length < 2 || v == null) return ""; const hi = Math.max(...xs), lo = Math.min(...xs); return hi - lo < 1e-9 ? "" : v === hi ? "hi" : v === lo ? "lo" : ""; };
    const table = el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, ""), ...items.map((it) => hoverable(el("th", { class: "num", "data-s": it.i }, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.name]), it.i)), items.length > 1 ? el("th", { class: "num" }, "Spread") : null])),
      el("tbody", {}, SG_ROWS.map(([k, l]) => {
        const vals = items.map((it) => (it.s.n ? it.s.sg[k] : null));
        const xs = vals.filter((v) => v != null);
        return el("tr", { class: k === "TOTAL" ? "strong" : "" }, [el("td", {}, l), ...items.map((it, j) => el("td", { class: `num ${tone(vals[j])} ${shade(vals, vals[j])}`, "data-s": it.i }, vals[j] == null ? "\u2014" : fmtSG(vals[j]))),
          items.length > 1 ? el("td", { class: "num muted" }, xs.length > 1 ? (Math.max(...xs) - Math.min(...xs)).toFixed(2) : "\u2014") : null]);
      })),
    ]));
    let conf = null;
    if (live.length >= 2) {
      const s = [...live].sort((a, b) => b.s.sg.TOTAL - a.s.sg.TOTAL), c = confidence(s[0].s.rounds, s.at(-1).s.rounds);
      conf = el("p", { class: "muted small" }, [`Best against worst in SG: Total: ${fmtSigned(s[0].s.sg.TOTAL - s.at(-1).s.sg.TOTAL)} a round, `, el("strong", { class: `cmp-conf c-${c.word.replace(/ /g, "-")}` }, c.word), ` (allowing for how much rounds vary${c.word === "too few rounds" ? "" : `; z = ${Math.abs(c.z).toFixed(1)}`}).`]);
    }
    const chart = groupedBars([["TOTAL", "Total"], ...CATEGORIES.map(([k]) => [k, k])].map(([k, l]) => ({ label: l, values: items.map((it) => (it.s.n ? it.s.sg[k] : null)) })), items);
    return el("section", { class: "panel cmp-sec" }, [secHead("Strokes gained, side by side", "A round, for each selection. The best in each row is shaded green, the worst red."), table, conf, legend(items), chart]);
  }
  // every round as a dot, and how each selection unfolded (a 5-round rolling average)
  function roundsSection(items) {
    const live = items.filter((it) => it.s.n);
    return el("section", { class: "panel cmp-sec" }, [
      secHead("Every round", "Each dot is a round (SG: Total). The bar is the middle half of the rounds, the white tick the median, the diamond the average."),
      legend(live), strip(live),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table compact" }, [
        el("thead", {}, el("tr", {}, ["", "Rounds", "Average", "Median", "Best", "Worst", "Swing (±)", "Gaining"].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
        el("tbody", {}, live.map((it) => el("tr", { "data-s": it.i }, [el("td", {}, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.name]), el("td", { class: "num" }, String(it.s.n)),
          el("td", { class: `num ${tone(it.s.sg.TOTAL)}` }, fmtSG(it.s.sg.TOTAL)), el("td", { class: `num ${tone(it.s.median)}` }, fmtSG(it.s.median)), el("td", { class: "num pos" }, fmtSG(it.s.best)), el("td", { class: "num neg" }, fmtSG(it.s.worst)),
          el("td", { class: "num" }, it.s.sd == null ? "\u2014" : it.s.sd.toFixed(2)), el("td", { class: "num" }, `${Math.round((it.s.gaining || 0) * 100)}%`)]))),
      ])),
    ]);
  }
  function distanceSection(items) {
    const prof = distanceProfile(items.map((it) => it.rs), distPer);
    const cats = CATEGORIES.filter(([k]) => prof[k]);
    if (!cats.length) return null;
    if (!prof[distCat]) distCat = cats[0][0];
    const tabs = el("div", { class: "cmp-seg small" }, cats.map(([k, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${distCat === k ? " on" : ""}` }, l); b.addEventListener("click", () => { distCat = k; draw(); }); return b; }));
    const per = el("div", { class: "cmp-seg small" }, [["round", "A round"], ["shot", "A shot"]].map(([v, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${distPer === v ? " on" : ""}` }, l); b.addEventListener("click", () => { distPer = v; draw(); }); return b; }));
    const rows = prof[distCat];
    return el("section", { class: "panel cmp-sec" }, [
      secHead("By distance", `Strokes gained ${distPer === "round" ? "a round" : "a shot"} at each distance. Where one selection pulls away from another is where the difference was made.`),
      el("div", { class: "cmp-ctrls" }, [tabs, per]),
      legend(items), distChart(rows, items, distPer),
    ]);
  }
  function statsSection(items) {
    const rows = statRows([...new Set([...allRounds(), ...items.flatMap((it) => roundsOf(it))])], items.map((it) => statSets(roundsOf(it), [it.f])[0]));
    if (!rows.length) return null;
    const shade = (r, v) => { const xs = r.values.filter((x) => x != null); if (xs.length < 2 || v == null || r.def.higher == null) return ""; const best = r.def.higher === false ? Math.min(...xs) : Math.max(...xs), worst = r.def.higher === false ? Math.max(...xs) : Math.min(...xs); return Math.abs(best - worst) < 1e-9 ? "" : v === best ? "hi" : v === worst ? "lo" : ""; };
    return el("section", { class: "panel cmp-sec" }, [secHead("Other stats", "The best in each row is shaded green and the worst red (lower is better for some, like Proximity)."),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), ...items.map((it) => el("th", { class: "num", "data-s": it.i }, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.name]))])),
        el("tbody", {}, rows.map((r) => el("tr", {}, [el("td", { title: r.def.help || "" }, r.label), ...items.map((it, j) => el("td", { class: `num ${shade(r, r.values[j])}`, "data-s": it.i }, fmtStat(r.def, r.values[j])))]))),
      ]))]);
  }

  // getting better or worse: the last n against the n before, for several n
  function trajectorySection() {
    const tr = trajectory(data.rounds);
    const cell = (v) => el("td", { class: `num ${tone(v)} cmp-delta` }, v == null ? "\u2014" : `${v > 0.004 ? "▲" : v < -0.004 ? "▼" : "◆"} ${Math.abs(v).toFixed(2)}`);
    return el("section", { class: "panel cmp-sec cmp-traj" }, [
      secHead("Getting better or worse?", "Their latest rounds against the same number just before, at several time scales. Tap a row to compare the two."),
      el("p", { class: "cmp-traj-words" }, trajectoryWords(tr)),
      tr.length ? el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table cmp-traj-t" }, [
        el("thead", {}, el("tr", {}, ["Time scale", "Before", "Latest", ...SG_ROWS.slice(0, 5).map(([k, l]) => (k === "TOTAL" ? "Change" : k))].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
        el("tbody", {}, tr.map((x) => {
          const row = el("tr", { class: "cmp-tap", tabindex: "0", title: `Compare the last ${x.n} with the ${x.n} before` }, [
            el("td", {}, `Last ${x.n} vs ${x.n} before`), el("td", { class: `num ${tone(x.prev)}` }, fmtSG(x.prev)), el("td", { class: `num ${tone(x.last)}` }, fmtSG(x.last)),
            ...SG_ROWS.slice(0, 5).map(([k]) => cell(x.ch[k]))]);
          const go = () => { touched = true; sels = [{ id: `windows:prev:${x.n}`, name: `The ${x.n} before that`, f: { prev: x.n }, color: COLORS[0] }, { id: `windows:last:${x.n}`, name: `Last ${x.n} rounds`, f: { last: x.n }, color: COLORS[1] }]; mode = "windows"; draw(); root.querySelector(".cmp-cards")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
          row.addEventListener("click", go); row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
          return row;
        })),
      ])) : null,
    ]);
  }
  // the best conditions: every round grouped by one thing, against their overall average
  function conditionsSection() {
    const dims = DIMENSIONS.filter(([d]) => d !== "tour" || opts.tours.length > 1).filter(([d]) => d !== "course" || opts.courses.length > 1).filter(([d]) => d !== "round" || opts.rounds.length > 1);
    if (!dims.some(([d]) => d === dim)) dim = dims[0]?.[0] || "month";
    const list = conditions(data.rounds, dim, 3);
    const tabs = el("div", { class: "cmp-seg small cmp-dims" }, dims.map(([d, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${dim === d ? " on" : ""}` }, l); b.addEventListener("click", () => { dim = d; draw(); }); return b; }));
    const max = Math.max(0.05, ...list.map((x) => Math.abs(x.vsAll)));
    const filterOf = (x) => ({ round: { roundNos: [x.label.replace("Round ", "")] }, course: { courses: [x.label] }, month: { months: [String(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(x.label))] }, year: { years: [x.label] }, tour: { tours: [x.label] } }[dim]);
    const rows = list.map((x, j) => {
      const f = filterOf(x), id = f ? `cond:${dim}:${x.label}` : null, on = id && has(id);
      const w = Math.abs(x.vsAll) / max * 50;
      const row = el(f ? "button" : "div", { type: f ? "button" : null, class: `cmp-cond${on ? " on" : ""}${f ? " cmp-tap" : ""}`, title: f ? (on ? "Take it out of the comparison" : "Add it to the comparison") : null }, [
        el("span", { class: "cmp-cond-rank" }, String(j + 1)),
        el("span", { class: "cmp-cond-l" }, [x.label, el("span", { class: "muted" }, ` \u00b7 ${x.n} rds`)]),
        el("span", { class: "cmp-cond-bar" }, [el("span", { class: "mid" }), el("span", { class: `b ${x.vsAll >= 0 ? "pos" : "neg"}`, style: x.vsAll >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` })]),
        el("strong", { class: `cmp-cond-v ${tone(x.v)}` }, fmtSG(x.v)),
        el("span", { class: `cmp-cond-d ${tone(x.vsAll)}` }, fmtSigned(x.vsAll)),
      ]);
      if (f) row.addEventListener("click", () => toggleSel(id, x.label, f));
      return row;
    });
    return el("section", { class: "panel cmp-sec" }, [
      secHead("Where they play their best", "Every round grouped by one condition, best first: SG: Total a round, and how far above or below their overall average. Tap one to add it to the comparison."),
      tabs,
      rows.length === 1 ? el("p", { class: "muted" }, "Every round falls in the same group here, so there\u2019s nothing to compare yet.") : rows.length ? el("div", { class: "cmp-conds" }, [el("div", { class: "cmp-cond cmp-cond-h" }, [el("span", {}, "#"), el("span", {}, ""), el("span", { class: "cmp-cond-bar-h" }, [el("span", {}, "worse"), el("span", {}, "their average"), el("span", {}, "better")]), el("span", {}, "SG"), el("span", {}, "vs avg")]), ...rows])
        : el("p", { class: "muted" }, "Not enough rounds in any group yet (3 or more)."),
    ]);
  }
  // (update 189) a colour key above every chart
  const legend = (items) => el("div", { class: "cmp-legend", "aria-hidden": "true" }, items.map((it) => hoverable(el("span", { class: "cmp-legend-i", title: it.full || it.name }, [el("i", { style: `background:${it.color}` }), it.name]), it.i)));
  const secHead = (t, sub) => el("div", { class: "cmp-sec-head" }, [el("h2", {}, t), sub ? el("p", { class: "muted small" }, sub) : null]);

  /* ------------------------------ charts (SVG) ------------------------------ */
  // (a phone gets a narrower drawing, so the labels stay readable when it's scaled to fit)
  const cw = () => (window.innerWidth < 640 ? 400 : 720);
  function axis(svg, lo, hi, Y, L, R, W, fmt = (v) => fmtSG(v)) {
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, yy = Y(v); svg.append(mk("line", { x1: L, x2: W - R, y1: yy, y2: yy, stroke: GRID }), mk("text", { x: L - 6, y: yy + 3.5, "text-anchor": "end", "font-size": 10.5, fill: INK }, fmt(v))); }
    if (lo < 0 && hi > 0) svg.append(mk("line", { x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: "rgba(255,255,255,0.35)" }));
  }
  const span = (vals, pad = 0.12, zero = true) => { let lo = Math.min(...vals), hi = Math.max(...vals); if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); } const p = (hi - lo) * pad || 0.5; return [lo - (zero && lo === 0 ? 0 : p), hi + (zero && hi === 0 ? 0 : p)]; };
  // (update 190) every x-axis: a tick under each label, the labels angled a little, and room left for them
  const ANG = 32, CH = 6.6; // degrees; an estimate of a character's width at 10.5px
  const xRoom = (labels) => { const m = Math.max(1, ...labels.map((t) => String(t).length)) * CH; return { below: Math.ceil(m * Math.sin(ANG * Math.PI / 180) + 18), left: Math.ceil(m * Math.cos(ANG * Math.PI / 180)) + 6 }; };
  function xAxis(svg, xs, labels, y0, bold = false) {
    xs.forEach((x, i) => {
      svg.append(mk("line", { x1: x, x2: x, y1: y0, y2: y0 + 5, stroke: "rgba(255,255,255,0.35)" }));
      svg.append(mk("text", { x: x + 3, y: y0 + 15, "text-anchor": "end", "font-size": 10.5, "font-weight": bold ? 600 : 400, fill: INK, transform: `rotate(-${ANG} ${x + 3} ${y0 + 15})` }, labels[i]));
    });
  }
  function groupedBars(groups, items) {
    const vals = groups.flatMap((g) => g.values).filter((v) => v != null);
    if (!vals.length) return null;
    const room = xRoom(groups.map((g) => g.label));
    const W = cw(), T = 12, B = room.below, H = 230 + B, R = 12;
    const L = 48;
    const [lo, hi] = span(vals);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "cmp-svg", role: "img", "aria-label": "Strokes gained by category for each selection" });
    axis(svg, lo, hi, Y, L, R, W);
    const gw = (W - L - R) / groups.length, n = items.length, bw = Math.min(28, (gw * 0.78) / n);
    groups.forEach((g, gi) => {
      const x0 = L + gi * gw + (gw - bw * n) / 2;
      g.values.forEach((v, j) => {
        if (v == null) return;
        const it = items[j], y0 = Y(0), y1 = Y(v);
        const r = mk("rect", { x: x0 + j * bw + 1, y: Math.min(y0, y1), width: Math.max(2, bw - 2), height: Math.max(1, Math.abs(y1 - y0)), rx: 3, fill: it.color, "data-s": it.i });
        r.append(mk("title", {}, `${it.name} \u00b7 ${g.label}: ${fmtSG(v)}`));
        svg.append(r);
      });
    });
    xAxis(svg, groups.map((_, gi) => L + gi * gw + gw / 2), groups.map((g) => g.label), H - B, true);
    return el("div", { class: "cmp-chart" }, svg);
  }
  function strip(live) {
    if (!live.length) return null;
    const all = live.flatMap((it) => it.s.rounds);
    const [lo, hi] = span(all, 0.06, false);
    const ticks = Array.from({ length: 7 }, (_, k) => lo + ((hi - lo) * k) / 6);
    const room = xRoom(ticks.map((v) => fmtSG(v)));
    const W = cw(), rowH = 46, L = Math.max(16, room.left), R = 16, T = 8, B = room.below, H = T + B + rowH * live.length;
    const X = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "cmp-svg", role: "img", "aria-label": "Every round, by selection" });
    for (const v of ticks) svg.append(mk("line", { x1: X(v), x2: X(v), y1: T, y2: H - B, stroke: GRID }));
    xAxis(svg, ticks.map(X), ticks.map((v) => fmtSG(v)), H - B);
    if (lo < 0 && hi > 0) svg.append(mk("line", { x1: X(0), x2: X(0), y1: T, y2: H - B, stroke: "rgba(255,255,255,0.35)" }));
    live.forEach((it, r) => {
      const cy = T + rowH * r + rowH / 2, g = mk("g", { "data-s": it.i });
      g.append(mk("rect", { x: X(it.s.q1), y: cy - 9, width: Math.max(2, X(it.s.q3) - X(it.s.q1)), height: 18, rx: 6, fill: it.color, "fill-opacity": 0.18, stroke: it.color, "stroke-opacity": 0.5 }));
      // the dots, spread a little up and down so they don't sit on each other
      it.s.rounds.forEach((v, k) => { const jitter = ((k * 37) % 11) / 10 - 0.5; const c = mk("circle", { cx: X(v), cy: cy + jitter * 22, r: 3.2, fill: it.color, "fill-opacity": 0.85 }); c.append(mk("title", {}, `${it.name}: ${fmtSG(v)}`)); g.append(c); });
      g.append(mk("line", { x1: X(it.s.median), x2: X(it.s.median), y1: cy - 12, y2: cy + 12, stroke: "#fff", "stroke-width": 2.2 }));
      const m = X(it.s.sg.TOTAL);
      g.append(mk("path", { d: `M${m} ${cy - 7} L${m + 7} ${cy} L${m} ${cy + 7} L${m - 7} ${cy} Z`, fill: "#fff", stroke: it.color, "stroke-width": 2 }));
      svg.append(g);
    });
    return el("div", { class: "cmp-chart" }, svg);
  }
  function distChart(rows, items, per) {
    const vals = rows.flatMap((r) => r.values).filter((v) => v != null);
    if (!vals.length) return el("p", { class: "muted" }, "No distances recorded here.");
    const fmt = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(per === "shot" ? 3 : 2)}`;
    const room = xRoom(rows.map((r) => r.dist));
    const W = cw(), T = 12, B = room.below, H = 230 + B, R = 18;
    const L = Math.max(54, room.left - 6); // (the first label leans left from its point)
    const [lo, hi] = span(vals);
    const pad = 16, n = rows.length, X = (i) => L + pad + (n > 1 ? (i / (n - 1)) * (W - L - R - 2 * pad) : (W - L - R - 2 * pad) / 2), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "cmp-svg", role: "img", "aria-label": "Strokes gained by distance" });
    axis(svg, lo, hi, Y, L, R, W, fmt);
    xAxis(svg, rows.map((_, i) => X(i)), rows.map((r) => r.dist), H - B);
    items.forEach((it, j) => {
      const pts = rows.map((r, i) => (r.values[j] == null ? null : { x: X(i), y: Y(r.values[j]), v: r.values[j], r })).filter(Boolean);
      if (!pts.length) return;
      const g = mk("g", { "data-s": it.i });
      g.append(mk("path", { d: pts.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" "), fill: "none", stroke: it.color, "stroke-width": 2.2, "stroke-linejoin": "round" }));
      for (const p of pts) { const c = mk("circle", { cx: p.x, cy: p.y, r: 3.6, fill: it.color, stroke: "#121214", "stroke-width": 1.5 }); c.append(mk("title", {}, `${it.name} \u00b7 ${p.r.dist}: ${fmt(p.v)} (${p.r.w[j]} shots)`)); g.append(c); }
      svg.append(g);
    });
    return el("div", { class: "cmp-chart" }, svg);
  }

  draw();
  if (player) load();
  return () => {};
}
