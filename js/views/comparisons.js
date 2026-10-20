/*
 * Comparisons (update 188): pick a player, then any slices of their rounds (seasons, time windows,
 * tournaments, courses, round numbers, months, tours, or a date range of your own) and see them side by side:
 *   \u00b7 a card for each, and what stands out in plain words
 *   \u00b7 strokes gained by category in a table (best / worst shaded) and a grouped bar chart
 *   \u00b7 every round as a dot (the spread, the middle half, the median), and how each one unfolded
 *   \u00b7 strokes gained by distance, and the other stats (fairways, greens, proximity \u2026)
 * (update 194) "Getting better or worse?" and "Where they play their best" moved to the Stats page (careerBlocks.js);
 * a row there opens this page on that comparison (?pick=win:10 / cond:course:Riviera). Include: which shots count.
 * Hover a selection (its card or its key) to pick it out in every chart.
 */
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { playerPicker } from "../playerPicker.js";
import { CATEGORIES, fmtStat, fmtSG, gearInfo, gearLabel, statDef } from "../sg.js";
import {
  COLORS, MAX_SEL, SG_ROWS, options, roundsFor, windowFilter, summarize, confidence, distanceProfile, statSets,
  products, insights, fmtSigned, includeShots, shotScope, statBlocks, productUsage, sgRounds, sureWords,
} from "../compareData.js";
import { renderBlocks } from "../badgePopup.js";
import { readAsk, productGroups, matchEvents } from "../compareAsk.js";

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
  ["windows", "Time windows", "Seasons, recent rounds and events, round numbers, or months."],
  // (update 216) seasons, tournaments, courses, rounds, months and tours together: each choice narrows the others
  ["filters", "Tournaments & courses", "Open a filter, pick from it, and the other filters only offer what still fits."],
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
  const wanted = q.get("player"); // (update 214: the start screen asks who; only a link from the Stats page picks one)
  if (self) player = { key: self[0], label: self[1] };
  else if (wanted && players.some(([k]) => k === wanted)) player = { key: wanted, label: players.find(([k]) => k === wanted)[1] };
  else if (players.length === 1) player = { key: players[0][0], label: players[0][1] };

  let pickParam = q.get("pick");
  let source = "tour", mode = "years", data = null, opts = null, sels = [], loadingFor = null, chipFilter = "", distCat = "APP", distPer = "round", dim = "round";
  // (update 189) picks wait here until "Add to comparison": several together become one group (their rounds pooled)
  let staged = new Map(); // value → { label, f }
  let winTab = "rounds", winYear = ""; // (update 235) Time windows: which filter is open; the months' season
  let combine = false;
  let h2h = false; // (update 208) players against each other: only the rounds they played together (same tournament, same round) // (update 206) several picks: compared against each other unless this is ticked
  // (update 190) untouched: the default comparison, so the whole-career tables (better or worse, best conditions) show
  let touched = false;
  // (update 194) which shots count: none picked = every category and distance
  let incCats = new Set(), incDists = new Set(); // "APP" / "APP|100-150 yds"
  const others = new Map(); // `${player}|${source}` → their rounds ("*|tour": everyone's, pooled)
  // (update 192) the players in the comparison; every selection is shown for each of them.
  // (update 195) only Callaway's staff (the admin, analysts and employees) compare players: they can add players,
  // take any out, and with none left compare everyone in the file together ("Everyone"). A player, coach or
  // caddie sees one player at a time (the one picked at the top).
  const staff = !team.preview && (state.isAdmin || (state.isTeam && ["analyst", "employee"].includes(state.profile?.kind)));
  const EVERY = "*";
  const lite = staff ? await import("../fieldCache.js").then((m) => m.isLiteDevice()).catch(() => false) : false; // (a phone can't hold everyone's rounds)
  let chosen = player ? [player] : []; // (staff) [] = everyone
  let everyN = 0, dsInfo = null, busy = "";
  // (update 216) finishing positions at each tournament: by SG: Total among the players who played every round there
  // (the most anyone played); anyone with fewer rounds missed the cut. evKey → Map(player → "1" / "T3" / "MC")
  let finishes = new Map();
  let placeDim = null, placeOpen = new Set(), tlBy = "rounds", yoyBy = "event"; // (update 216)
  const yr = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const evk = (rd) => `${rd.event}|${yr(rd)}`;
  function setFinishes(field) {
    if (!field?.length || finishes.size) return;
    const evs = new Map();
    for (const p of field) for (const rd of p.rounds || []) {
      if (!rd.event) continue;
      const e = evs.get(evk(rd)) || evs.set(evk(rd), new Map()).get(evk(rd));
      const o = e.get(p.key) || e.set(p.key, { n: 0, sg: 0 }).get(p.key);
      o.n++; o.sg += (rd.shots || []).reduce((t, x) => t + (x.sg || 0), 0);
    }
    for (const [k, e] of evs) {
      const most = Math.max(...[...e.values()].map((o) => o.n));
      const made = [...e].filter(([, o]) => o.n === most).sort((a, b) => b[1].sg - a[1].sg);
      const out = new Map();
      made.forEach(([pk, o], i) => { const first = made.findIndex(([, x]) => Math.round(x.sg * 100) === Math.round(o.sg * 100)); const tie = made.filter(([, x]) => Math.round(x.sg * 100) === Math.round(o.sg * 100)).length > 1; out.set(pk, `${tie ? "T" : ""}${first + 1}`); });
      for (const [pk, o] of e) if (o.n < most) out.set(pk, "MC");
      finishes.set(k, out);
    }
  }
  const finishOf = (pk, rd) => finishes.get(evk(rd))?.get(pk) || "\u2014";
  const everyOk = () => staff && source === "tour" && !!dsInfo && !lite;
  const everyLabel = () => `Everyone${everyN ? ` (${everyN.toLocaleString()} players)` : ""}`;
  const inPlay = () => (!player ? [] : !staff ? [player] : chosen.length ? chosen.map((p) => (p.key === EVERY ? { key: EVERY, label: "Everyone" } : p)) : everyOk() ? [{ key: EVERY, label: "Everyone" }] : [player]);
  const multi = () => inPlay().length > 1;
  const rawOfKey = (k) => (k === player?.key ? data.rounds : others.get(`${k}|${source}`) || []);
  // (update 222) the Tour filter: only the rounds on the tours picked (none picked = every tour), everywhere on the page
  let tourSel = new Set();
  const tourCache = new Map();
  // (update 244) Leave out: tournaments (a year's playing of one), date ranges and round numbers, taken out of every
  // player's rounds everywhere on the page (every selection, leaderboard, table and report)
  // (update 248) evRounds: one round of one tournament ("event|year|3" → "2026 BMW Championship R3")
  const excl = { events: new Map(), ranges: [], rounds: new Set(), evRounds: new Map() }; // events: "event|year" → label
  const exclOn = () => excl.events.size || excl.ranges.length || excl.rounds.size || excl.evRounds.size;
  const exclKey = () => `${[...excl.events.keys()].sort().join(";")}#${excl.ranges.map((r) => `${r.from}~${r.to}`).join(";")}#${[...excl.rounds].sort().join(",")}#${[...excl.evRounds.keys()].sort().join(";")}`;
  const dk10 = (d) => String(d || "").slice(0, 10);
  const leftOut = (rd) => excl.events.has(`${rd.event}|${yr(rd)}`) || excl.evRounds.has(`${rd.event}|${yr(rd)}|${rd.roundNo || ""}`) || excl.rounds.has(String(rd.roundNo || "")) || excl.ranges.some((r) => (!r.from || dk10(rd.date) >= r.from) && (!r.to || dk10(rd.date) <= r.to));
  const roundsOfKey = (k) => {
    const raw = rawOfKey(k);
    if (!tourSel.size && !exclOn()) return raw;
    const key = `${[...tourSel].sort().join("|")}@${exclKey()}`, c = tourCache.get(k);
    if (c && c.src === raw && c.key === key) return c.out;
    const out = raw.filter((rd) => (!tourSel.size || tourSel.has(rd.tour || "")) && !leftOut(rd));
    tourCache.set(k, { src: raw, key, out });
    return out;
  };
  function tourBar() {
    const ps = inPlay().length ? inPlay() : player ? [player] : [];
    const counts = new Map();
    let oneMulti = false; // (update 223: shown with Everyone, or when a player has rounds on more than one tour)
    for (const p of ps) { const mine = new Set(); for (const rd of sgRounds(rawOfKey(p.key))) if (rd.tour) { counts.set(rd.tour, (counts.get(rd.tour) || 0) + 1); mine.add(rd.tour); } if (mine.size > 1) oneMulti = true; }
    const withEvery = ps.some((p) => p.key === EVERY) || productsOnly;
    if ((!withEvery && !oneMulti) || (counts.size < 2 && !tourSel.size)) { if (tourSel.size) { tourSel = new Set(); allMemo = null; setTimeout(() => { if (data) opts = options(allRounds()); draw(); }, 0); } return null; }
    const pill = (on, label, n, click) => { const b = el("button", { type: "button", class: `cmp-chip small${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, label, n != null ? el("span", { class: "cmp-chip-n" }, `${n.toLocaleString()} rds`) : null]); b.addEventListener("click", click); return b; };
    const redo = () => { allMemo = null; if (data) opts = options(allRounds()); draw(); };
    return el("div", { class: "panel cmp-tourbar" }, [el("span", { class: "cmp-chip-gt" }, "Tour"),
      el("div", { class: "cmp-chips" }, [pill(!tourSel.size, "All tours", null, () => { tourSel = new Set(); redo(); }),
        ...[...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => pill(tourSel.has(t), t, n, () => { tourSel.has(t) ? tourSel.delete(t) : tourSel.add(t); redo(); }))])]);
  }
  let exclOpen = false, exclQ = "", exclBy = "events";
  function leaveOutBar() {
    if (!player || !data) return null;
    const redo = () => { allMemo = null; if (data) opts = options(allRounds()); draw(); };
    const chips = [
      ...[...excl.events].map(([k, l]) => [l, () => excl.events.delete(k)]),
      ...[...excl.evRounds].map(([k, l]) => [l, () => excl.evRounds.delete(k)]),
      ...excl.ranges.map((r, i) => [`${r.from ? dateTxt(r.from) : "Start"} \u2013 ${r.to ? dateTxt(r.to) : "now"}`, () => excl.ranges.splice(i, 1)]),
      ...[...excl.rounds].sort().map((n) => [`Round ${n}s`, () => excl.rounds.delete(n)]),
    ].map(([l, off]) => { const b = el("button", { type: "button", class: "cmp-chip small cmp-excl-chip", title: "Put it back" }, [l, el("span", { class: "cmp-excl-x", "aria-hidden": "true" }, " \u2715")]); b.addEventListener("click", () => { off(); redo(); }); return b; });
    const toggle = el("button", { type: "button", class: "link small" }, exclOpen ? "Done" : chips.length ? "\uff0b Leave out more" : "\uff0b Leave out a tournament, dates or rounds");
    toggle.addEventListener("click", () => { exclOpen = !exclOpen; draw(); });
    let editor = null;
    if (exclOpen) {
      // tournaments: every one these players played (each year on its own), searchable
      const evs = new Map();
      for (const p of inPlay()) for (const rd of sgRounds(rawOfKey(p.key))) { if (!rd.event) continue; const k = `${rd.event}|${yr(rd)}`; const e = evs.get(k) || evs.set(k, { k, label: `${yr(rd)} ${rd.event}`, n: 0, d: dk10(rd.date) }).get(k); e.n++; if (dk10(rd.date) > e.d) e.d = dk10(rd.date); }
      const words = exclQ.toLowerCase().split(/\s+/).filter(Boolean);
      const list = [...evs.values()].filter((e) => !excl.events.has(e.k) && words.every((w) => e.label.toLowerCase().includes(w))).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 14);
      const q = el("input", { type: "search", class: "cmp-chip-search cmp-excl-q", placeholder: "Find a tournament (e.g. 2025 Players)\u2026", value: exclQ, autocomplete: "off" });
      q.addEventListener("input", () => { const pos = q.selectionStart; exclQ = q.value; draw(); const again = root.querySelector(".cmp-excl-q"); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} } });
      const evChips = exclBy === "rounds"
        ? list.map((e) => {
          // (update 248) one round of one tournament: R3 at the BMW, R4 at the Travelers
          const [ev, y] = e.k.split("|");
          const rns = [...new Set(inPlay().flatMap((p) => sgRounds(rawOfKey(p.key)).filter((rd) => rd.event === ev && yr(rd) === y).map((rd) => String(rd.roundNo || ""))))].filter(Boolean).sort();
          return el("span", { class: "cmp-excl-ev" }, [el("span", { class: "cmp-excl-evl" }, e.label), ...rns.map((n) => {
            const k = `${ev}|${y}|${n}`, on = excl.evRounds.has(k);
            const b = el("button", { type: "button", class: `cmp-chip small${on ? " on" : ""}`, "aria-pressed": String(on), title: `Leave out round ${n} of the ${e.label}` }, `R${n}`);
            b.addEventListener("click", () => { on ? excl.evRounds.delete(k) : excl.evRounds.set(k, `${e.label} R${n}`); redo(); });
            return b;
          })]);
        })
        : list.map((e) => { const b = el("button", { type: "button", class: "cmp-chip small" }, [e.label, el("span", { class: "cmp-chip-n" }, `${e.n} rds`)]); b.addEventListener("click", () => { excl.events.set(e.k, e.label); redo(); }); return b; });
      const bySeg = el("div", { class: "cmp-seg small" }, [["events", "Whole tournaments"], ["rounds", "Single rounds"]].map(([v, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${exclBy === v ? " on" : ""}` }, l); b.addEventListener("click", () => { exclBy = v; draw(); }); return b; }));
      const from = el("input", { type: "date", class: "cmp-date", "aria-label": "From" }), to = el("input", { type: "date", class: "cmp-date", "aria-label": "To" });
      const addR = el("button", { type: "button", class: "btn ghost small" }, "Leave out these dates");
      addR.addEventListener("click", () => { if (!from.value && !to.value) { flashNote("Pick a start or end date (or both)."); return; } excl.ranges.push({ from: from.value || null, to: to.value || null }); redo(); });
      const rnds = [...new Set(inPlay().flatMap((p) => sgRounds(rawOfKey(p.key)).map((rd) => String(rd.roundNo || "")).filter(Boolean)))].sort((a, b) => a - b);
      const rChips = rnds.map((n) => { const on = excl.rounds.has(n); const b = el("button", { type: "button", class: `cmp-chip small${on ? " on" : ""}` }, `Round ${n}s`); b.addEventListener("click", () => { on ? excl.rounds.delete(n) : excl.rounds.add(n); redo(); }); return b; });
      editor = el("div", { class: "cmp-excl-edit" }, [
        el("div", { class: "cmp-chip-group" }, [el("div", { class: "cmp-excl-th" }, [el("p", { class: "cmp-chip-gt" }, "Tournaments"), bySeg]), q, el("div", { class: `cmp-chips${exclBy === "rounds" ? " cmp-excl-evs" : ""}` }, evChips.length ? evChips : [el("span", { class: "muted small" }, "Nothing matches.")])]),
        el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, "Dates"), el("div", { class: "cmp-custom" }, [el("label", { class: "cmp-field" }, [el("span", {}, "From"), from]), el("label", { class: "cmp-field" }, [el("span", {}, "To"), to]), addR])]),
        rnds.length > 1 ? el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, "Round numbers (every tournament)"), el("div", { class: "cmp-chips" }, rChips)]) : null,
      ]);
    }
    return el("div", { class: `panel cmp-tourbar cmp-exclbar${chips.length ? " set" : ""}` }, [
      el("div", { class: "cmp-excl-top" }, [el("span", { class: "cmp-chip-gt" }, "Leave out"), chips.length ? el("div", { class: "cmp-chips" }, chips) : el("span", { class: "muted small" }, "Nothing left out."), toggle]),
      editor,
    ]);
  }
  const roundsOf = (it) => roundsOfKey(it.pk || inPlay()[0]?.key);
  let allMemo = null; // (the same arrays give the same pooled array, so the work done on it is kept)
  const allRounds = () => { const parts = inPlay().map((p) => roundsOfKey(p.key)); if (parts.length === 1) return parts[0]; if (allMemo && allMemo.parts.length === parts.length && allMemo.parts.every((x, i) => x === parts[i])) return allMemo.out; const out = parts.flat(); allMemo = { parts, out }; return out; };
  const room = (nSels, nPlayers) => nSels * nPlayers <= MAX_SEL;
  async function loadOthers(list) {
    const { loadSource } = await import("../reportGen.js");
    await Promise.all(list.map(async (p) => {
      if (p.key === player?.key) return;
      if (p.key === EVERY) return loadEveryone();
      // (update 209) a group of players (their rounds pooled), or everyone else in the data
      if (p.members) {
        if (others.has(`${p.key}|${source}`)) return;
        const tag = (k, rs) => rs.map((rd) => ({ ...rd, key: `${k}|${rd.key}`, pk: rd.pk || k }));
        if (p.rest) { await loadEveryone(); const out = new Set(p.members.map((m) => m.key)); others.set(`${p.key}|${source}`, roundsOfKey(EVERY).filter((rd) => !out.has(rd.pk))); }
        else { await loadOthers(p.members); others.set(`${p.key}|${source}`, p.members.flatMap((m) => tag(m.key, roundsOfKey(m.key)))); }
        return;
      }
      const ck = `${p.key}|${source}`;
      if (others.has(ck)) return;
      try { const res = await loadSource(source, p.key, p.label, { detail: false }); others.set(ck, res?.me?.rounds || []); } catch { others.set(ck, []); }
    }));
  }
  // (update 195) everyone in the file: every player's rounds, pooled (each round keeps whose it is)
  async function loadEveryone() {
    const ck = `${EVERY}|tour`;
    if (others.has(ck) || !dsInfo) return;
    const say = (d, n) => { busy = `Loading everyone\u2019s rounds\u2026 ${d.toLocaleString()} of ${n.toLocaleString()} players`; const b = root.querySelector(".cmp-busy p"); if (b) b.textContent = busy; };
    let rowsBy = [];
    try {
      if (state.isAdmin) {
        const { loadDatasetPlayers } = await import("../fieldCache.js");
        const { players: m } = await loadDatasetPlayers(dsInfo.id, { onProgress: say });
        rowsBy = [...m].map(([k, p]) => [k, p?.rows || []]);
      } else {
        const { getDatasetMeta, getDatasetRows } = await import("../store.js");
        const keys = players.map(([k]) => k), queue = [...keys];
        let done = 0;
        const next = async () => { while (queue.length) { const k = queue.shift(); let rows = []; try { const m = await getDatasetMeta(k, dsInfo.id); rows = await getDatasetRows(k, dsInfo.id, m.chunkCount); } catch { /* not in this file */ } rowsBy.push([k, rows]); say(++done, keys.length); } };
        await Promise.all(Array.from({ length: 12 }, next));
      }
    } catch (err) { console.warn(err); }
    const { prepare } = await import("../sg.js");
    const pooled = [];
    let n = 0;
    for (const [k, rows] of rowsBy) {
      const rs = k === player?.key ? data.rounds : rows.length ? prepare(rows, dsInfo.idx) : [];
      if (!rs.length) continue;
      n++;
      for (const rd of rs) { if (k !== player?.key) for (const sh of rd.shots) delete sh.r; pooled.push({ ...rd, key: `${k}|${rd.key}`, pk: k }); }
    }
    everyN = n; busy = "";
    others.set(ck, pooled);
  }
  const groupOf = (ms) => ({ key: `grp:${ms.map((m) => m.key).sort().join("+")}`, label: ms.length === 2 ? `${ms[0].label} + ${ms[1].label}` : `${ms[0].label}, ${ms[1].label} + ${ms.length - 2} more`, members: ms });
  const restOf = (ms) => ({ key: `rest:${ms.map((m) => m.key).sort().join("+")}`, label: "Everyone else", members: ms, rest: true });
  // the players changed: load anyone not loaded yet, then redraw
  async function setChosen(list) {
    chosen = list; touched = true;
    const need = inPlay().filter((p) => p.key !== player?.key && !others.has(`${p.key}|${source}`));
    if (need.length) { busy = need.some((p) => p.key === EVERY) ? "Loading everyone\u2019s rounds\u2026" : `Loading ${need.map((p) => p.label).join(", ")}\u2026`; draw(); await loadOthers(need); busy = ""; }
    opts = options(allRounds());
    draw();
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
  const gnote = el("p", { class: "cmp-note", role: "status" }); // (the guide's own, so a message shows where you are)
  const flashNote = (t) => { note.textContent = t; gnote.textContent = t; clearTimeout(noteTimer); noteTimer = setTimeout(() => { note.textContent = ""; gnote.textContent = ""; }, 3500); };
  // the default: the two latest seasons (or recent form, with only one)
  function defaults() {
    sels = []; touched = multi();
    mode = "windows"; // (update 206) nothing picked to start with: the questions (or your own picks) decide
  }

  // (update 194) opened from the Stats page on one comparison: "win:10" (the last 10 against the 10 before) or "cond:course:Riviera"
  function applyPick(p) {
    const m = /^win:(\d+)$/.exec(p);
    if (m) { const n = Number(m[1]); mode = "windows"; sels = [{ id: `windows:prev:${n}`, name: `The ${n} rounds before that`, f: { prev: n }, mode: "windows", values: [`prev:${n}`], color: COLORS[0] }, { id: `windows:last:${n}`, name: `Last ${n} rounds`, f: { last: n }, mode: "windows", values: [`last:${n}`], color: COLORS[1] }]; touched = true; return; }
    const c = /^cond:(\w+):(.*)$/.exec(p);
    if (!c) return;
    const [, d, v] = c;
    const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const evs = d === "event" ? opts.tournaments.filter((t) => t.value.split("|")[0] === v).map((t) => t.value) : null;
    const pick = { round: ["rounds", `Round ${v}`, { roundNos: [v] }], course: ["courses", v, { courses: [v] }], month: ["months", MN[Number(v)] || v, { months: [v] }], year: ["years", v, { years: [v] }], tour: ["tours", v, { tours: [v] }], event: ["tournaments", `${v} (every year)`, { events: evs }] }[d];
    if (!pick || (evs && !evs.length)) return;
    const [md, name, f] = pick;
    mode = md; touched = true;
    sels = [{ id: `cond:${d}:${v}`, name, f, color: COLORS[0] }, { id: "windows:all", name: "Career (everything)", f: {}, color: COLORS[1] }];
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
    if (source === "tour" && res?.datasetId) dsInfo = { id: res.datasetId, idx: res.idx };
    if (source === "tour") setFinishes(res?.field); // (update 216)
    const need = inPlay().filter((p) => p.key !== player.key);
    if (need.length) {
      if (need.some((p) => p.key === EVERY || p.rest)) { opts = options(data.rounds); busy = "Loading everyone\u2019s rounds\u2026"; draw(); } // (update 214: say so while it loads)
      await loadOthers(need); busy = ""; if (loadingFor !== k) return;
    }
    opts = options(allRounds());
    defaults();
    if (pickParam) { applyPick(pickParam); pickParam = null; }
    draw();
  }

  /* ------------------------------ the page ------------------------------ */
  function draw() {
    // (update 189) just the player search at the top; everything else once a player is picked
    const head = null; // (update 214: no player search at the top; the start screen asks who)
    if (!player) { mount(root, [head, busy ? el("section", { class: "panel cmp-empty cmp-busy" }, [el("div", { class: "cmp-spin", "aria-hidden": "true" }), el("p", { class: "muted" }, busy)]) : startBox()]); return; }
    if (!data) { mount(root, [head, el("section", { class: "panel cmp-empty" }, [el("div", { class: "cmp-spin", "aria-hidden": "true" }), el("p", { class: "muted" }, `Loading ${player.label}\u2019s rounds\u2026`)])]); return; }
    if (!opts.total) { mount(root, [head, el("section", { class: "panel cmp-empty" }, [el("h2", {}, "No rounds to compare"), el("p", { class: "muted" }, source === "tour" ? `${player.label} has no Tour Events rounds with strokes gained yet.` : `${player.label} hasn\u2019t entered any rounds yet.`)])]); return; }

    if (busy) { mount(root, [head, playersRow(), el("section", { class: "panel cmp-empty cmp-busy" }, [el("div", { class: "cmp-spin", "aria-hidden": "true" }), el("p", { class: "muted" }, busy)])]); return; }
    const y = window.scrollY;
    // (update 192) with more than one player: each selection for each of them ("Pat · 2026", "Lee · 2026", …)
    const solo = inPlay()[0];
    const base = !multi() && staff && solo && solo.key !== player.key ? sels.map((s) => ({ ...s, pk: solo.key, name: `${solo.label} \u00b7 ${s.name}`, full: `${solo.label} \u00b7 ${s.full || s.name}` }))
      : multi() ? sels.flatMap((s) => inPlay().map((p) => ({ ...s, id: `${s.id}@${p.key}`, base: s.id, pk: p.key, name: `${p.label} \u00b7 ${s.name}`, full: `${p.label} \u00b7 ${s.full || s.name}` }))).slice(0, MAX_SEL).map((x, i) => ({ ...x, color: COLORS[i % COLORS.length] })) : sels;
    // (update 208) head to head: each player's rounds cut to the ones every player in the comparison played (same tournament, same round)
    const rkey = (rd) => `${rd.event}|${rd.year || String(rd.date || "").slice(0, 4)}|${rd.roundNo}`;
    const h2hOn = h2h && multi() && !inPlay().some((p) => p.key === EVERY);
    let shared = null;
    if (h2hOn) for (const p of inPlay()) { const ks = new Set(roundsOfKey(p.key).filter((rd) => rd.event && rd.roundNo).map(rkey)); shared = shared ? new Set([...shared].filter((k) => ks.has(k))) : ks; }
    const raw = base.map((s) => roundsFor(shared ? roundsOf(s).filter((rd) => shared.has(rkey(rd))) : roundsOf(s), s.f));
    if (shared) base.forEach((x) => { x.name = `${x.name} (head to head)`; x.full = `${x.full || x.name}`; });
    scope = shotScope(raw); // (the Include choices: only what these selections have, so a driver shows Off the Tee alone)
    const inc = incNow();
    const items = base.map((s, i) => { const rs = includeShots(raw[i], inc); return { ...s, i, rs, s: summarize(rs) }; });
    // (update 206) while the questions are open, they're all there is: no filters or numbers until they're answered or skipped
    if (g.open) { mount(root, [head, tourBar(), g.what && g.what !== "place" ? leaveOutBar() : null, guideBox()]); window.scrollTo(0, y); return; }
    if (placeDim && !sels.length) { mount(root, [head, tourBar(), leaveOutBar(), guideBox(), placeSection(), editBox()]); window.scrollTo(0, y); root.querySelector(".cmp-edit")?.addEventListener("toggle", (e) => { editOpen = e.target.open; }); return; }
    placeDim = null;
    mount(root, [
      head, tourBar(), // (update 222)
      leaveOutBar(), // (update 244)
      items.length ? askPanel(items) : null,
      guideBox(),
      editBox(),
      items.length ? reportBar(items) : null,
      items.length ? selectedBar(items) : null,
      items.length >= 2 ? boardSection(items) : null, // (update 220)
      insideSection(items), // (update 246)
      items.length ? cards(items) : el("section", { class: "panel cmp-empty small" }, el("p", { class: "muted" }, "Pick two or more above to compare them.")),
      items.length >= 2 ? standout(items) : null,
      items.length >= 2 ? yoySection(items) : null, // (update 216)
      usageSection(items),
      items.length ? sgSection(items) : null,
      items.length ? roundsSection(items) : null,
      items.length ? distanceSection(items) : null,
      items.length ? timelineSection(items) : null, // (update 215)
      items.length ? statsSection(items) : null,
      el("p", { class: "muted small center cmp-foot" }, "Strokes gained values represent per round averages. Each selection counts the strokes-gained rounds that fall in it; a round can be in more than one."),
    ]);
    window.scrollTo(0, y);
    root.querySelector(".cmp-edit")?.addEventListener("toggle", (e) => { editOpen = e.target.open; });
  }

  // (update 209) staff: compare products across every player, with no player picked
  let productsOnly = false;
  function productsStart() {
    if (!staff || players.length < 3) return el("section", { class: "panel cmp-empty" }, [el("p", { class: "muted" }, "Type a player\u2019s name above to start.")]); // (update 212)
    const b = el("button", { type: "button", class: "cmp-guide-o" }, [el("strong", {}, "Compare everyone"), el("span", {}, lite ? "Needs a computer: it\u2019s every player\u2019s rounds, more than a phone can hold." : "Every player in the data together: products (who uses what, and how it performs), seasons, courses\u2026")]);
    if (lite) b.disabled = true; else b.addEventListener("click", startProducts);
    return el("section", { class: "panel cmp-guide" }, [el("p", { class: "cmp-guide-k" }, "Or, without picking a player"), el("div", { class: "cmp-guide-opts" }, b)]);
  }
  async function startProducts() {
    busy = "Finding the data\u2026"; draw();
    const { loadSource } = await import("../reportGen.js");
    for (const [k, l] of players.slice(0, 20)) { // (any player in the latest tour file gives its id)
      let res = null; try { res = await loadSource("tour", k, l, { detail: false }); } catch { /* next */ }
      if (res?.datasetId) { source = "tour"; player = { key: k, label: l }; data = { rounds: res.me?.rounds || [] }; others.set(`${k}|tour`, data.rounds); dsInfo = { id: res.datasetId, idx: res.idx }; setFinishes(res.field); break; }
    }
    if (!player) { busy = ""; draw(); flashNote("Couldn\u2019t find Tour Events data to compare."); return; }
    productsOnly = true; chosen = []; g = { open: true, who: "everyone" }; opts = options(data.rounds);
    busy = "Loading everyone\u2019s rounds\u2026"; draw();
    await loadEveryone();
    opts = options(allRounds()); defaults(); busy = ""; loadingFor = `${player.key}|tour`;
    draw();
  }
  // (update 211/212) no player: back to the very start (for staff, "Compare everyone"). Start over does this too.
  function clearAll(keepPicks = false) { askRes = null; askErr = ""; excl.evRounds.clear(); excl.events.clear(); excl.ranges.length = 0; excl.rounds.clear(); exclOpen = false; placeDim = null; player = null; data = null; chosen = []; productsOnly = false; sels = []; staged = new Map(); touched = false; g = { open: true }; loadingFor = null; h2h = false; pb.brands.clear(); pb.models.clear(); pb.groups = []; pb.q = ""; pb.pair = null; pb.seasons.clear(); if (!keepPicks) startPicks = []; ls.set(LS_PLAYER, ""); draw(); window.scrollTo(0, 0); }
  /* (update 214) the start screen: who to look at. Everyone, one player, several, or a player (or several) and everyone.
     Next goes on to the question that fits: one player or everyone → what to compare; several → how to compare them. */
  let startPicks = []; // [{ key, label }] (EVERY = everyone in the data)
  const everyStartOk = () => staff && players.length >= 3;
  function startBox() {
    if (self) return null;
    const one = !staff; // (a coach or caddie: one player at a time)
    const picksP = startPicks.filter((p) => p.key !== EVERY), withEvery = startPicks.some((p) => p.key === EVERY);
    const chips = startPicks.map((p) => {
      const x = el("button", { type: "button", class: "cmp-key-x cmp-pl-x", "aria-label": `Take ${p.key === EVERY ? "everyone" : p.label} out` }, "\u2715");
      x.addEventListener("click", () => { startPicks = startPicks.filter((e) => e.key !== p.key); draw(); });
      return el("span", { class: `cmp-pl${p.key === EVERY ? " every" : ""}` }, [el("span", {}, p.key === EVERY ? "Everyone" : p.label), x]);
    });
    let everyB = null;
    if (everyStartOk() && !withEvery) {
      everyB = el("button", { type: "button", class: "btn ghost small cmp-pl-every", disabled: lite ? true : null, title: lite ? "Needs a computer: it\u2019s every player\u2019s rounds" : null }, "\uff0b Everyone");
      everyB.addEventListener("click", () => { startPicks = [...startPicks, { key: EVERY, label: "Everyone" }]; draw(); });
    }
    let adder = null;
    const rest = new Map(players.filter(([k]) => !startPicks.some((p) => p.key === k)));
    if (rest.size && (!one || !picksP.length) && picksP.length < MAX_SEL) {
      const pp = playerPicker(rest, (p) => { if (!p) return; startPicks = one ? [{ key: p.key, label: p.label }] : [...startPicks, { key: p.key, label: p.label }]; draw(); });
      const inp = pp.node.querySelector("input");
      if (inp) inp.placeholder = picksP.length ? "\uff0b Add another player\u2026" : "\uff0b Add a player\u2026";
      adder = el("div", { class: "cmp-pl-add" }, pp.node);
    }
    const nm = (ps) => (ps.length === 1 ? ps[0].label : ps.length === 2 ? `${ps[0].label} and ${ps[1].label}` : `${ps.slice(0, -1).map((p) => p.label).join(", ")} and ${ps.at(-1).label}`);
    const hint = !startPicks.length ? (one ? "Pick a player." : `Pick Everyone, one player, several players, or players and Everyone.${lite ? " (Everyone needs a computer.)" : ""}`)
      : !picksP.length ? "Everyone in the data together: products (who uses what, and how it performs), seasons, courses\u2026"
      : picksP.length === 1 && !withEvery ? `Just ${picksP[0].label}\u2019s rounds.`
      : withEvery ? `${nm(picksP)} against everyone in the data.` : `${nm(picksP)} side by side. Next: on their own, in groups, or one against the rest.`;
    const next = el("button", { type: "button", class: "btn cmp-add", disabled: startPicks.length ? null : true }, "Next \u2192");
    next.addEventListener("click", startNext);
    // (update 244) two routes: build it by hand, or ask for it in plain English
    const routes = el("div", { class: "cmp-routes", role: "tablist", "aria-label": "How" }, [["manual", "Manually create comparisons", "Pick the players, then what to compare, step by step."], ["ask", "\u2728 Ask AI", "Say what you want compared, in your own words."]].map(([v, l, sub]) => {
      const b = el("button", { type: "button", role: "tab", class: `cmp-route${route === v ? " on" : ""}`, "aria-selected": String(route === v) }, [el("strong", {}, l), el("span", {}, sub)]);
      b.addEventListener("click", () => { if (route === v) return; route = v; draw(); if (v === "ask") root.querySelector(".cmp-ask-in")?.focus(); });
      return b;
    }));
    if (route === "ask") return el("div", { class: "cmp-start-wrap" }, [routes, askBox()]);
    return el("div", { class: "cmp-start-wrap" }, [routes, el("section", { class: "panel cmp-guide cmp-start" }, [
      el("p", { class: "cmp-guide-k" }, "Set up a comparison"),
      el("h2", {}, one ? "Which player?" : "Which players?"),
      el("div", { class: "cmp-guide-free" }, [
        el("section", { class: "panel cmp-players" }, [
          el("div", { class: "cmp-build-top" }, [el("h2", {}, "Players"), el("span", { class: "muted small" }, hint)]),
          el("div", { class: "cmp-pl-row" }, [...chips, everyB, adder]),
        ]),
        el("div", { class: "cmp-guide-row" }, [next]),
      ]),
      gnote,
    ])]);
  }
  /* ------------------------------ (update 244) Ask AI ------------------------------ */
  let route = "manual", askText = "", askBusy = "", askErr = "", askRes = null;
  const ASK_EX = ["Compare all Callaway drivers played by Xander Schauffele from 2024-2026 and tell me which was best. Exclude the 2025 Masters.",
    "Compare all TRTL putters from 2025-2026 against all Jailbird putters from 2024-2026, excluding the 2025 Players Championship.",
    "Callaway drivers vs TaylorMade drivers for everyone in 2026.",
    "Scottie Scheffler: 2026 vs 2025."];
  function askBox() {
    const ta = el("textarea", { class: "cmp-ask-in", rows: 4, placeholder: "e.g. Compare all Callaway drivers played by Xander Schauffele from 2024-2026 and tell me which was best. Exclude the 2025 Masters.", "aria-label": "What to compare" });
    ta.value = askText;
    ta.addEventListener("input", () => { askText = ta.value; });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go.click(); } });
    const go = el("button", { type: "button", class: "btn cmp-add", disabled: askBusy ? true : null }, askBusy ? "Working\u2026" : "Compare \u2192");
    go.addEventListener("click", () => { askText = ta.value; if (!askText.trim()) { ta.focus(); return; } runAsk(askText.trim()); });
    const ex = ASK_EX.map((t) => { const b = el("button", { type: "button", class: "cmp-chip small cmp-ask-ex" }, t); b.addEventListener("click", () => { askText = t; draw(); root.querySelector(".cmp-ask-in")?.focus(); }); return b; });
    return el("section", { class: "panel cmp-guide cmp-start cmp-ask" }, [
      el("p", { class: "cmp-guide-k" }, "Ask AI"),
      el("h2", {}, "What do you want to compare?"),
      el("p", { class: "muted small" }, "Name the player (or say everyone), the clubs, balls or seasons, and anything to leave out. The comparison opens with the answer on top, and you can change anything after."),
      ta,
      el("div", { class: "cmp-guide-row" }, [go, askBusy ? el("span", { class: "muted small" }, askBusy) : null]),
      askErr ? el("p", { class: "cmp-ask-err" }, askErr) : null,
      el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, "Try"), el("div", { class: "cmp-chips cmp-ask-exs" }, ex)]),
    ]);
  }
  // the AI service (when it's set up) reads the request into the same parts; otherwise it's read here
  async function aiRead(text) {
    const url = window.PORTAL_CONFIG?.insightsUrl;
    if (!url) return null;
    try {
      const token = await getState().user?.getIdToken?.();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ ask: { text, today: new Date().toISOString().slice(0, 10) } }) });
      if (!res.ok) return null;
      const out = await res.json();
      return typeof out?.rewrite === "string" && out.rewrite.trim() ? out.rewrite.trim() : null;
    } catch { return null; }
  }
  async function runAsk(text) {
    askErr = ""; askBusy = "Reading the request\u2026"; draw();
    const maxYear = new Date().getFullYear();
    const rewrite = await aiRead(text); // (a plainer version of the request, when the AI service is there)
    const ask = readAsk(rewrite || text, { players, maxYear });
    if (rewrite && !ask.players.length) { const a0 = readAsk(text, { players, maxYear }); ask.players = a0.players; } // (names as typed)
    let ps = ask.players.slice(0, 4);
    if (!ps.length && !ask.everyone && !staff && players.length) ps = [{ key: players[0][0], label: players[0][1] }];
    if (!ps.length && !ask.everyone) { askBusy = ""; askErr = "Which player? Name one (or say \u201ceveryone\u201d)."; draw(); return; }
    if (!ps.length && !everyStartOk()) { askBusy = ""; askErr = lite ? "Everyone needs a computer: it\u2019s every player\u2019s rounds. Name a player instead." : "Name a player."; draw(); return; }
    askBusy = "Loading the rounds\u2026"; draw();
    // the players, then their rounds
    excl.events.clear(); excl.ranges.length = 0; excl.rounds.clear(); excl.evRounds.clear();
    if (ps.length) {
      player = { key: ps[0].key, label: ps[0].label }; productsOnly = false; staged = new Map();
      chosen = ask.everyone ? [...ps, { key: EVERY, label: "Everyone" }] : [...ps];
      g = { open: false, who: ps.length > 1 || ask.everyone ? "several" : "one", playersDone: true, phow: "each" };
      await load();
    } else { await startProducts(); }
    if (!data) { askBusy = ""; askErr = "Couldn\u2019t load the rounds. Try again."; draw(); return; }
    // what to leave out
    const evs = new Map();
    for (const p of inPlay()) for (const rd of sgRounds(rawOfKey(p.key))) if (rd.event) { const k = `${rd.event}|${yr(rd)}`; if (!evs.has(k)) evs.set(k, { k, event: rd.event, year: yr(rd) }); }
    const evHit = matchEvents(ask.excl, [...evs.values()]);
    for (const [k, l] of evHit) excl.events.set(k, l);
    for (const n of ask.exclRounds) excl.rounds.add(n);
    allMemo = null; opts = options(allRounds());
    incCats = new Set(ask.cats); incDists = new Set(); // (update 247: "his approach game": only approach shots count)
    const missed = ask.excl.filter((ph) => ![...matchEvents([ph], [...evs.values()]).keys()].length);
    // what to compare: clubs and balls, else seasons or recent form
    const catalog = products(allRounds()).map((k) => ({ ...k, items: k.items.map((o) => ({ ...o, ...gearInfo(o.value) })) }));
    let groups = productGroups(ask, catalog, { maxYear });
    let kind = "product";
    // (update 245) a group with no rounds (a putter not used in the seasons asked for) is left out and said so;
    // if none has any, the seasons are dropped and it's tried again
    const nOf = (f) => roundsFor(allRounds(), f).length;
    let empties = [];
    if (groups.length) {
      empties = groups.filter((x) => !nOf(x.f)).map((x) => x.name);
      if (empties.length === groups.length && groups.some((x) => x.f.years)) {
        const again = productGroups({ ...ask, years: [], sides: ask.sides.map((t) => t.replace(/\b(?:since|from|after|in|for|during|starting(?: in| from)?|beginning(?: in)?)?\s*(?:the\s+)?(?:(?:start|beginning)\s+of\s+)?(?:the\s+)?20\d\d(?:\s*(?:-|to|through|thru|until|till)\s*20\d\d)?(?:\s+seasons?)?/g, " ")), text: ask.text.replace(/\b20\d\d\b/g, " ") }, catalog, { maxYear });
        if (again.some((x) => nOf(x.f))) { askErr = `None of these were used in ${ask.years.join(", ")}, so this is every season.`; groups = again; empties = groups.filter((x) => !nOf(x.f)).map((x) => x.name); }
      }
      groups = groups.filter((x) => nOf(x.f));
    }
    if (!groups.length) {
      kind = "time";
      if (ask.last) { const n = ask.last.n, ev = ask.last.unit === "events"; groups = [{ name: `The ${n} ${ev ? "events" : "rounds"} before that`, f: ev ? { prevEv: n } : { prev: n }, id: `windows:${ev ? "prevev" : "prev"}:${n}` }, { name: `Last ${n} ${ev ? "events" : "rounds"}`, f: ev ? { lastEv: n } : { last: n }, id: `windows:${ev ? "lastev" : "last"}:${n}` }]; }
      else {
        const ys = (ask.years.length ? ask.years : opts.years.slice(0, 2).map((y) => y.value)).filter((y) => opts.years.some((q) => q.value === y));
        groups = (ask.years.length > 1 || !ask.years.length ? ys : opts.years.slice(0, 2).map((y) => y.value)).map((y) => ({ name: y, f: { years: [y] }, id: `years:${y}`, mode: "years", values: [y] }));
      }
    }
    if (ask.kinds.length && kind === "time") askErr = `Couldn\u2019t find those ${ask.kinds.join(" / ").toLowerCase()}s in ${inPlay().map((p) => p.label).join(", ")}\u2019s rounds, so here are their seasons instead.`;
    const cap = Math.max(2, Math.floor(MAX_SEL / Math.max(1, inPlay().length)));
    sels = groups.slice(0, cap).map((x, i) => ({ id: x.id || `ask:${i}:${x.name}`, name: x.name, f: x.f, mode: x.mode || (kind === "product" ? "product" : "windows"), values: x.values || x.f.clubs || x.f.balls || null, color: COLORS[i % COLORS.length] }));
    mode = kind === "product" ? "product" : "windows"; g.what = kind === "product" ? "gear" : "time"; g.open = false; touched = true; placeDim = null; backToPlace = null;
    askRes = { text, rewrite, ask, kind, dropped: Math.max(0, groups.length - cap), missed, empties };
    askBusy = "";
    draw();
    root.querySelector(".cmp-askres")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // the answer, on top of the comparison
  function askPanel(items) {
    if (!askRes) return null;
    const live = items.filter((it) => it.s.n);
    const md = (t) => t.split(/\*\*/).map((p0, i) => (i % 2 ? el("strong", {}, p0) : p0));
    const read = [];
    const who = inPlay().map((p) => p.label);
    read.push(`**Who:** ${who.join(", ")}`);
    const catNames = Object.fromEntries(CATEGORIES);
    const only = [...incCats].map((c) => catNames[c]).filter(Boolean);
    if (only.length) read.push(`**Only:** ${only.join(" + ")} (strokes gained from those shots)`);
    read.push(`**Compared:** ${sels.map((x) => x.name).join("  \u00b7  ")}${askRes.dropped ? ` (and ${askRes.dropped} more that didn\u2019t fit)` : ""}`);
    if (exclOn()) read.push(`**Left out:** ${[...excl.events.values(), ...[...excl.rounds].map((n) => `Round ${n}s`)].join(", ")}`);
    if (askRes.empties?.length) read.push(`**No rounds with:** ${askRes.empties.join(", ")}`);
    if (askRes.missed.length) read.push(`**Couldn\u2019t find to leave out:** ${askRes.missed.join(", ")}`);
    const what = only.length ? `${only.join(" + ")}: ` : "";
    let answer = "Nothing to compare: none of these had rounds.";
    if (live.length === 1) answer = `${what}**${live[0].name}**: **${fmtSG(live[0].s.sg.TOTAL)}** strokes gained a round over ${live[0].s.n} rounds. There\u2019s only one, so nothing to compare it with.`;
    // (update 247) two stretches of time (the last 12 rounds and the 12 before): told as a trend, latest first
    const dk0 = (v) => String(v || "").slice(0, 10);
    const trend = live.length === 2 && live.every((it) => it.s.from && it.s.to) && (dk0(live[0].s.to) <= dk0(live[1].s.from) || dk0(live[1].s.to) <= dk0(live[0].s.from));
    if (trend) {
      const [late, early] = [...live].sort((a, b) => dk0(b.s.to).localeCompare(dk0(a.s.to))), d = late.s.sg.TOTAL - early.s.sg.TOTAL;
      const f = fitStory(late, early);
      answer = `${what}**${late.name}**: **${fmtSG(late.s.sg.TOTAL)}** strokes gained a round over ${late.s.n} rounds, ${Math.abs(d) < 0.05 ? "**about the same as**" : `**${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(2)}** from`} ${early.name.toLowerCase()} (${fmtSG(early.s.sg.TOTAL)}). ${f.sum}`;
      if (late.s.n < FEW || early.s.n < FEW) answer += " Few rounds, so treat it as a hint.";
    } else if (live.length >= 2) {
      const o = [...live].sort((a, b) => b.s.sg.TOTAL - a.s.sg.TOTAL), a = o[0], b = o[1];
      const f = fitStory(a, b);
      answer = `${what}**${a.name}** was best: **${fmtSG(a.s.sg.TOTAL)}** strokes gained a round over ${a.s.n} rounds, **${(a.s.sg.TOTAL - b.s.sg.TOTAL).toFixed(2)}** ahead of ${b.name} (${fmtSG(b.s.sg.TOTAL)}, ${b.s.n} rounds).${o.length > 2 ? ` Then: ${o.slice(2).map((x) => `${x.name} ${fmtSG(x.s.sg.TOTAL)}`).join(", ")}.` : ""} ${f.sum}`;
      if (a.s.n < FEW || b.s.n < FEW) answer += " Few rounds, so treat it as a hint.";
    }
    const x = el("button", { type: "button", class: "gx-pop-x cmp-askres-x", "aria-label": "Close" }, "\u2715");
    x.addEventListener("click", () => { askRes = null; draw(); });
    const again = el("button", { type: "button", class: "link small" }, "Ask something else");
    again.addEventListener("click", () => { askRes = null; route = "ask"; clearAll(); });
    return el("section", { class: "panel cmp-askres" }, [
      el("div", { class: "cmp-askres-top" }, [el("p", { class: "cmp-guide-k" }, "\u2728 You asked"), x]),
      el("p", { class: "cmp-askres-q" }, `\u201c${askRes.text}\u201d`),
      el("p", { class: "cmp-askres-a" }, md(answer)),
      askErr ? el("p", { class: "cmp-ask-err" }, askErr) : null,
      el("ul", { class: "cmp-askres-read" }, read.map((t) => el("li", {}, md(t)))),
      el("div", { class: "cmp-guide-row" }, [again, el("span", { class: "muted small" }, "Change anything with the filters below.")]),
    ]);
  }
  async function startNext() {
    const ps = startPicks.filter((p) => p.key !== EVERY), withEvery = startPicks.some((p) => p.key === EVERY);
    if (!ps.length) { if (withEvery) await startProducts(); return; }
    player = { key: ps[0].key, label: ps[0].label }; productsOnly = false; staged = new Map();
    chosen = withEvery ? [...ps, { key: EVERY, label: "Everyone" }] : [...ps];
    // one player (or players and everyone, each on their own): what to compare next; several: how to compare them
    g = ps.length === 1 && !withEvery ? { open: true, who: "one" } : withEvery ? { open: true, who: "several", playersDone: true, phow: "each" } : { open: true, who: "several", playersDone: true };
    await load();
  }
  function pickerNode() {
    if (self || players.length <= 1) return null; // (only one player: nothing to search)
    const pp = playerPicker(new Map(players), (p) => { if (!p) { clearAll(); return; } if (p.key === player?.key && !productsOnly) return; productsOnly = false; const old = player?.key; player = { key: p.key, label: p.label }; chosen = [player, ...chosen.filter((x) => x.key !== old && x.key !== p.key)]; ls.set(LS_PLAYER, p.key); staged = new Map(); g = { open: true }; load(); });
    if (player && !productsOnly) pp.preset(player.key);
    const inp = pp.node.querySelector("input");
    inp?.addEventListener("focus", () => { if (inp.value) { inp.value = ""; inp.dispatchEvent(new Event("input")); } });
    inp?.addEventListener("blur", () => setTimeout(() => { if (!inp.value && player && !productsOnly) pp.preset(player.key); }, 300));
    if (inp) inp.placeholder = "Type a player\u2019s name\u2026";
    // (update 212) the picker's own "Clear" button (as on the other pages) clears the player: back to the start
    return el("div", { class: "cmp-who cmp-top" }, [pp.node]);
  }
  // (update 192) Players: who's being compared, above everything you pick (the one you're looking at is always in)
  let scope = [];
  const incNow = () => {
    const cats = scope.filter((c) => incCats.has(c.cat)).map((c) => c.cat);
    const dists = new Set();
    for (const c of scope) { const ds = c.dists.filter((d) => incDists.has(`${c.cat}|${d}`)); if (ds.length && (!cats.length || cats.includes(c.cat))) { dists.add(`${c.cat}|*`); ds.forEach((d) => dists.add(`${c.cat}|${d}`)); } }
    return cats.length || dists.size ? { cats: cats.length ? new Set(cats) : null, dists: dists.size ? dists : null } : null;
  };
  // (update 194) Include: which categories of shot, and which distances within them, count everywhere below
  function includeRow() {
    if (!scope.length) return null;
    const chip = (on, label, click, title) => { const b = el("button", { type: "button", class: `cmp-chip small${on ? " on" : ""}`, "aria-pressed": String(on), title }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, label]); b.addEventListener("click", click); return b; };
    const pickedCats = scope.filter((c) => incCats.has(c.cat));
    const cats = scope.length > 1 ? el("div", { class: "cmp-chips" }, scope.map((c) => chip(incCats.has(c.cat), c.label, () => { incCats.has(c.cat) ? incCats.delete(c.cat) : incCats.add(c.cat); touched = true; draw(); }))) : el("p", { class: "muted small" }, `${scope[0].label} only (the only shots in these selections).`);
    const distCats = (pickedCats.length ? pickedCats : scope).filter((c) => c.dists.length > 1);
    const dists = distCats.map((c) => el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, `${c.label} distances`), el("div", { class: "cmp-chips" }, c.dists.map((d) => chip(incDists.has(`${c.cat}|${d}`), d, () => { const k = `${c.cat}|${d}`; incDists.has(k) ? incDists.delete(k) : incDists.add(k); touched = true; draw(); })))]));
    const any = incNow();
    const reset = any ? el("button", { type: "button", class: "link" }, "Count every shot") : null;
    reset?.addEventListener("click", () => { incCats = new Set(); incDists = new Set(); draw(); });
    return el("div", { class: "cmp-include" }, [
      el("div", { class: "cmp-build-top" }, [el("h3", {}, "Include"), el("span", { class: "muted small" }, any ? "Only the shots picked count, in every table and chart below." : "Every shot counts. Pick categories or distances to narrow it."), reset]),
      cats, ...dists,
    ]);
  }
  function playersRow() {
    if (!staff || players.length <= 1) return null;
    const list = chosen;
    const rest = new Map(players.filter(([k]) => !list.some((p) => p.key === k)));
    const chips = list.map((p) => {
      const x = el("button", { type: "button", class: "cmp-key-x cmp-pl-x", "aria-label": `Take ${p.key === EVERY ? "everyone" : p.label} out` }, "\u2715");
      x.addEventListener("click", () => setChosen(list.filter((e) => e.key !== p.key)));
      return el("span", { class: `cmp-pl${p.key === player?.key ? " main" : ""}${p.key === EVERY ? " every" : ""}` }, [el("span", {}, p.key === EVERY ? everyLabel() : p.label), x]);
    });
    if (!list.length) chips.push(el("span", { class: "cmp-pl every main" }, everyOk() ? everyLabel() : player.label));
    let adder = null;
    if (rest.size && list.length < MAX_SEL) {
      const pp = playerPicker(rest, (p) => {
        if (!p) return;
        if (!room(Math.max(1, sels.length), Math.max(1, list.length) + 1)) { flashNote(`Up to ${MAX_SEL} on the charts: take a pick off first, then add ${p.label}.`); const i0 = pp.node.querySelector("input"); if (i0) i0.value = ""; return; }
        setChosen([...list, { key: p.key, label: p.label }]);
      });
      const inp = pp.node.querySelector("input");
      if (inp) inp.placeholder = "\uff0b Add a player\u2026";
      adder = el("div", { class: "cmp-pl-add" }, pp.node);
    }
    let addEvery = null;
    if (everyOk() && list.length && !list.some((p) => p.key === EVERY)) {
      addEvery = el("button", { type: "button", class: "btn ghost small cmp-pl-every" }, "\uff0b Everyone");
      addEvery.addEventListener("click", () => { if (!room(Math.max(1, sels.length), list.length + 1)) { flashNote(`Up to ${MAX_SEL} on the charts: take a pick off first.`); return; } setChosen([...list, { key: EVERY, label: "Everyone" }]); });
    }
    const hint = !list.length ? (everyOk() ? "Everyone in the file together: each pick below pools every player\u2019s rounds (how everyone with driver A did against everyone with driver B, say). Add a player to narrow it." : lite ? "Everyone together needs a computer: it\u2019s every player\u2019s rounds, more than a phone can hold." : "Everyone together works with Tour Events.")
      : multi() ? "Every pick below is shown for each of them. Take them all out to compare everyone together." : "Add players to compare them side by side, or take them all out to compare everyone together.";
    return el("section", { class: "panel cmp-players" }, [
      el("div", { class: "cmp-build-top" }, [el("h2", {}, "Players"), el("span", { class: "muted small" }, hint)]),
      el("div", { class: "cmp-pl-row" }, [...chips, addEvery, adder]),
    ]);
  }
  /* ------------------------------ (update 203) the guide: a few plain questions set the filters ------------------------------ */
  // Who → what → the detail, then the comparison is set up; everything stays editable under "Edit the filters yourself".
  let g = { open: !pickParam, step: null }, editOpen = false;
  let backToPlace = null; // (update 240) the "Where they play best" table these picks came from (Clear all goes back to it)
  // (update 240) everything cleared: back to where these picks were made (the courses table, or the filters open on
  // the same tab: time windows, products …), not to the start
  const backToStart = () => {
    sels = []; joinPick = new Set(); touched = true; askRes = null;
    if (backToPlace) { placeDim = backToPlace; g.open = false; }
    else editOpen = true;
    draw();
    root.querySelector(backToPlace ? ".career-sec" : ".cmp-edit")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const SEASONS = [["this", "This season", { season: "this" }], ["last", "Last season", { season: "last" }], ["l20", "Their last 20 rounds", { last: 20 }], ["all", "Their whole career", {}]];
  const groupNameOf = (k) => groupName(k);
  const groupName = (k) => ({ Driver: "Drivers", "Non-Driver": "Non-driver tee shots", "Fairway Wood": "Fairway woods", Hybrid: "Hybrids", Iron: "Irons", Wedge: "Wedges", Putter: "Putters", Ball: "Golf balls", Other: "Other clubs" }[k] || k);
  function guideStep() {
    if (!g.who) { if (staff && players.length > 1) return "who"; g.who = "one"; }
    if (g.who === "several" && !g.playersDone) return "players";
    // (update 209) several players: each on their own, in two groups, or one against the rest
    if (g.who === "several" && !g.phow) return "phow";
    if (g.phow === "groups" && !g.pgroups) return "pgroups";
    if (g.phow === "one" && !g.pone) return "pone";
    if (!g.what) return "what";
    if (g.what === "time" && !g.when) return "when";
    if (g.what === "gear" && !g.pgDone) return "pbuild"; // (update 210: groups built by kind, brand, model and season)
    if (g.what === "place" && !g.place) g.place = "tournaments"; // (update 217: no question; the page has a switch for each)
    if (g.what === "versus" && g.h2h === undefined) return "h2h";
    if (g.what === "versus" && !g.stretch) return "stretch";
    return "done";
  }
  const restart = () => { if (!self) { clearAll(); return; } g = { open: true }; draw(); root.querySelector(".cmp-guide")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const answer = async (k, v) => {
    g[k] = v;
    if (k === "who") { if (v === "one") await setChosen([player]); else if (v === "everyone") await setChosen([]); else if (chosen.length < 2) await setChosen(chosen.length ? chosen : [player]); }
    // (update 209) the players' groups, set as soon as they're answered
    const ps = () => chosen.filter((p) => p.key !== EVERY && !p.members);
    if (k === "pgroups") { const [A, B] = [0, 1].map((x) => ps().filter((p) => (v[p.key] ?? 0) === x)); await setChosen([A.length > 1 ? groupOf(A) : A[0], B.length > 1 ? groupOf(B) : B[0]].filter(Boolean)); }
    if (k === "pone") { const one = ps().find((p) => p.key === v); const rest = ps().filter((p) => p.key !== v); await setChosen([one, rest.length > 1 ? groupOf(rest) : rest[0]].filter(Boolean)); }
    if (k === "pvsrest") await setChosen([player, restOf([player])]);
    if (guideStep() === "done") applyGuide(); else draw();
  };
  const back = () => {
    const order = ["stretch", "h2h", "place", "pgDone", "one", "groups", "how", "models", "gear", "when", "what", "pone", "pgroups", "phow", "pvsrest", "playersDone", "who"];
    // (update 214) players and everyone: "each" was set for them, so going back from "what" is back to the start
    if (g.what === undefined && g.phow === "each" && chosen.some((p) => p.key === EVERY)) { delete g.phow; delete g.playersDone; delete g.who; }
    else if (g.what === "place") { delete g.place; delete g.what; }
    else for (const k of order) if (g[k] !== undefined) { delete g[k]; if (k !== "playersDone") break; }
    if (!self && (!g.who || (g.who === "several" && !g.playersDone))) { clearAll(true); return; } // back to the start, the picks kept
    draw();
  };
  function applyGuide() {
    const mk = (id, name, f, md, values = null) => ({ id, name, f, mode: md, values, color: COLORS[0] });
    let out = [];
    if (g.what === "time") {
      const n = opts.total >= 40 ? 10 : 5;
      if (g.when === "seasons") { mode = "years"; out = opts.years.slice(0, 2).map((y) => mk(`years:${y.value}`, y.label, { years: [y.value] }, "years", [y.value])); }
      if (g.when === "formev") { const e = opts.events >= 10 ? 5 : 3; mode = "windows"; out = [mk(`windows:prevev:${e}`, `The ${e} events before that`, { prevEv: e }, "windows", [`prevev:${e}`]), mk(`windows:lastev:${e}`, `Last ${e} events`, { lastEv: e }, "windows", [`lastev:${e}`])]; }
      if (g.when === "form") { mode = "windows"; out = [mk(`windows:prev:${n}`, `The ${n} rounds before that`, { prev: n }, "windows", [`prev:${n}`]), mk(`windows:last:${n}`, `Last ${n} rounds`, { last: n }, "windows", [`last:${n}`])]; }
      if (g.when === "career") { mode = "windows"; const y = opts.years[0]; out = [mk(`years:${y.value}`, `This season (${y.value})`, { years: [y.value] }, "years", [y.value]), mk("windows:all", "Career (everything)", {}, "windows", ["all"])]; }
      if (g.when === "own") { mode = "custom"; editOpen = true; }
    }
    if (g.what === "gear") { mode = "product"; out = pb.groups.map((x) => mk(x.id, x.name, x.f, "product", x.f.clubs)); pb.groups = []; }
    if (false) {
      const grp = products(allRounds()).find((x) => x.group === g.gear), items = grp?.items || [];
      const nm = (vs) => { const ls = vs.map((v) => items.find((x) => x.value === v)?.label || v); return ls.length === 1 ? items.find((x) => x.value === vs[0])?.long || ls[0] : ls.length === 2 ? `${ls[0]} + ${ls[1]}` : `${ls[0]}, ${ls[1]} + ${ls.length - 2} more`; };
      const one = (vs, name) => mk(`product:${[...vs].sort().join("|")}`, name || nm(vs), { clubs: vs }, "product", vs);
      if (g.models.length === 1 || g.how === "one") { // one against all the rest of its kind
        const v = g.models.length === 1 ? g.models[0] : g.one, rest = items.map((x) => x.value).filter((x) => x !== v);
        out = [one([v]), rest.length ? one(rest, `All other ${groupName(g.gear).toLowerCase()}`) : null].filter(Boolean);
      } else if (g.how === "groups") out = [0, 1].map((x) => g.models.filter((v) => (g.groups[v] ?? 0) === x)).filter((vs) => vs.length).map((vs) => one(vs));
      else out = g.models.map((v) => one([v]));
    }
    placeDim = null; backToPlace = null;
    if (g.what === "place") { placeDim = g.place; } // (update 216: every course / tournament / month / round, ranked; no selections)
    if (false) {
      if (g.place === "rounds") { mode = "rounds"; out = opts.rounds.map((o) => mk(`rounds:${o.value}`, o.label, { roundNos: [o.value] }, "rounds", [o.value])); }
      if (g.place === "courses") { mode = "courses"; out = [...opts.courses].sort((a, b) => b.n - a.n).slice(0, 4).map((o) => mk(`courses:${o.value}`, o.label, { courses: [o.value] }, "courses", [o.value])); }
      if (g.place === "tournaments") { mode = "tournaments"; out = opts.tournaments.slice(0, 4).map((o) => mk(`tournaments:${o.value}`, o.label, { events: [o.value] }, "tournaments", [o.value])); }
      if (g.place === "months") { mode = "months"; out = [...opts.months].sort((a, b) => b.n - a.n).slice(0, 4).sort((a, b) => Number(a.value) - Number(b.value)).map((o) => mk(`months:${o.value}`, o.label, { months: [o.value] }, "months", [o.value])); }
    }
    h2h = g.what === "versus" && !!g.h2h;
    if (g.what === "versus") { const [v, l, f] = SEASONS.find(([x]) => x === g.stretch); mode = "windows"; out = [mk(`scope:${v}`, l, f, "windows")]; }
    const cap = Math.max(1, Math.floor(MAX_SEL / Math.max(1, inPlay().length)));
    sels = out.slice(0, cap).map((x, i) => ({ ...x, color: COLORS[i % COLORS.length] }));
    incCats = new Set(); incDists = new Set(); staged = new Map(); chipFilter = "";
    touched = true; g.open = false;
    draw();
    root.querySelector(placeDim ? ".career-sec" : ".cmp-cards, .cmp-edit")?.scrollIntoView({ behavior: "smooth", block: "start" }); // (update 218: the ranked list, not the bottom)
  }
  /* ------------------------------ (update 210) building product groups ------------------------------ */
  // Kind of club, then brands, then (optionally) models, and a season: each pick becomes a group, e.g. "All Callaway
  // drivers" against "All TaylorMade drivers", "Callaway drivers · 2026" against "· 2025", or two models against one.
  const pb = { kind: null, brands: new Set(), models: new Set(), seasons: new Set(), groups: [], q: "", pair: null }; // (update 244: several seasons)
  function productBuilder(inGuide) {
    // (update 217) the season first: every other pill (and its round count) is only what was used that season
    const kindsAny = products(allRounds());
    const yearsWith = opts.years.length > 1 ? opts.years : [];
    for (const y of [...pb.seasons]) if (!yearsWith.some((q) => q.value === y)) pb.seasons.delete(y);
    const kinds = !pb.seasons.size ? kindsAny : products(roundsFor(allRounds(), { years: [...pb.seasons] }));
    if (!kindsAny.length) return el("div", { class: "cmp-empty-note" }, [el("strong", {}, "No club data in this file yet."), el("p", { class: "muted small" }, "Once the data has each shot\u2019s clubType, clubBrand, clubModel, ballBrand and ballModel, every product shows here.")]);
    // (update 212) the search box: every pill below narrows to what matches as you type (kind, brand or model)
    const words = (pb.q || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (k, o) => { const t = `${groupName(k.group)} ${k.group} ${o.brand} ${o.label}`.toLowerCase(); return words.every((w) => t.includes(w)); };
    const kindsAll = kinds.map((k) => ({ ...k, items: k.items.map((o) => ({ ...o, ...gearInfo(o.value) })) }));
    const kindsShown = words.length ? kindsAll.filter((k) => k.items.some((o) => hit(k, o))) : kindsAll;
    if (!pb.kind || !kindsAll.some((k) => k.group === pb.kind) || (kindsShown.length && !kindsShown.some((k) => k.group === pb.kind))) { pb.kind = (kindsShown[0] || kindsAll[0]).group; pb.brands.clear(); pb.models.clear(); }
    const kindNow = kindsAll.find((k) => k.group === pb.kind) || { group: pb.kind, items: [] };
    const items = kindNow.items;
    for (const m of [...pb.models]) if (!items.some((o) => o.value === m)) pb.models.delete(m); // (not used that season)
    // (update 222) a kind opens on Callaway (Odyssey for putters), or the first brand there is; untick it to see every brand's models
    if (pb.brandFor !== pb.kind && !words.length) {
      pb.brandFor = pb.kind;
      const bs = [...new Set(items.map((o) => o.brand))].sort();
      const pref = ["Callaway", "Odyssey"].find((b) => bs.includes(b)) || bs[0];
      if (!pb.brands.size && !pb.models.size && pref) pb.brands.add(pref);
    }
    for (const b of [...pb.brands]) if (!items.some((o) => o.brand === b)) pb.brands.delete(b);
    const matches = words.length ? items.filter((o) => hit(kindNow, o)) : items;
    const brands = [...new Set([...matches.map((o) => o.brand), ...pb.brands])].filter((b) => items.some((o) => o.brand === b)).sort();
    const pill = (on, label, n, click, unit = "rds") => { const b = el("button", { type: "button", class: `cmp-chip${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, label, n != null ? el("span", { class: "cmp-chip-n" }, `${n} ${n === 1 && unit === "models" ? "model" : unit}`) : null]); b.addEventListener("click", click); return b; };
    const row = (t, kids) => el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, t), el("div", { class: "cmp-chips" }, kids)]);
    const kindName = groupName(pb.kind);
    const search = el("input", { type: "search", class: "cmp-pb-q", placeholder: "Search products (e.g. Elyte, TaylorMade, putter)\u2026", autocomplete: "off", enterkeyhint: "search", value: pb.q || "" });
    search.addEventListener("input", () => {
      const pos = search.selectionStart; pb.q = search.value; draw();
      const again = root.querySelector(".cmp-pb-q"); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
    });
    const searchRow = el("div", { class: "cmp-pb-search" }, [search, words.length && !kindsShown.length ? el("p", { class: "muted small" }, `Nothing matches \u201c${pb.q.trim()}\u201d.`) : null]);
    const kindRow = row("Kind of club", kindsShown.map((k) => pill(pb.kind === k.group, groupName(k.group), k.items.length, () => { pb.kind = k.group; pb.brands.clear(); pb.models.clear(); draw(); }, "models")));
    const brandRow = row("Brand", brands.map((b) => pill(pb.brands.has(b), b, items.filter((o) => o.brand === b).length, () => { pb.brands.has(b) ? pb.brands.delete(b) : pb.brands.add(b); if (pb.brands.size) for (const m of [...pb.models]) if (!pb.brands.has(items.find((o) => o.value === m)?.brand)) pb.models.delete(m); draw(); }, "models")));
    const shown = items.filter((o) => pb.brands.has(o.brand));
    // (update 218) every model of that kind shows straight away; picking a brand narrows them to its models
    const baseModels = pb.brands.size ? items.filter((o) => pb.brands.has(o.brand) || pb.models.has(o.value)) : items;
    const modelPills = (words.length ? [...new Map([...baseModels.filter((o) => matches.includes(o) || pb.models.has(o.value)), ...(pb.brands.size ? matches.filter((o) => pb.brands.has(o.brand)) : matches)].map((o) => [o.value, o])).values()] : baseModels);
    const oneBrand = pb.brands.size === 1 ? [...pb.brands][0] : null;
    const mLabel = (o) => (oneBrand && o.brand === oneBrand ? o.model || o.label.replace(new RegExp(`^${oneBrand}\\s+`), "") : o.label); // (update 222)
    const modelRow = modelPills.length ? row(!pb.brands.size ? "Model (or pick a brand above for all its models)" : "Model (none picked = every model of those brands)", modelPills.map((o) => pill(pb.models.has(o.value), mLabel(o), o.n, () => { if (pb.models.has(o.value)) pb.models.delete(o.value); else pb.models.add(o.value); draw(); /* (update 221: models of any brand, no brand needed) */ }))) : null;
    // (update 244) more than two to pick from: Select all (and Clear)
    const allBtn = (rowEl, vals, set) => {
      if (!rowEl || vals.length <= 2) return;
      const all = vals.every((v) => set.has(v));
      const b = el("button", { type: "button", class: "cmp-chip cmp-selall" }, all ? "Clear" : "Select all");
      b.addEventListener("click", () => { if (all) for (const v of vals) set.delete(v); else for (const v of vals) set.add(v); draw(); });
      rowEl.querySelector(".cmp-chips")?.prepend(b);
    };
    allBtn(brandRow, brands, pb.brands);
    allBtn(modelRow, modelPills.map((o) => o.value), pb.models);
    // (update 217) each season's rounds with what's picked so far (the kind, its brands, its models); none: not offered
    const pickedNow = new Set(pb.models.size ? [...pb.models] : pb.brands.size ? (kindsAny.find((k) => k.group === pb.kind)?.items || []).filter((o) => pb.brands.has(gearInfo(o.value).brand)).map((o) => o.value) : (kindsAny.find((k) => k.group === pb.kind)?.items || []).map((o) => o.value));
    const isBall = pb.kind === "Ball";
    const useIt = (rd) => rd.shots.some((x) => pickedNow.has(isBall ? (x.ball ? `Ball|${x.ball}` : "") : x.gear));
    const yrCount = new Map(yearsWith.map((y) => [y.value, roundsFor(allRounds(), { years: [y.value] }).filter(useIt).length]));
    // (update 244) one season or several (2024 and 2025 together, say); none = any season
    const seasonRow = yearsWith.length ? row("Season (pick one or more)", [pill(!pb.seasons.size, "Any season", null, () => { pb.seasons.clear(); draw(); }),
      ...yearsWith.filter((y) => yrCount.get(y.value) || pb.seasons.has(y.value)).map((y) => pill(pb.seasons.has(y.value), y.label, yrCount.get(y.value), () => { pb.seasons.has(y.value) ? pb.seasons.delete(y.value) : pb.seasons.add(y.value); draw(); }))]) : null;
    // the group the picks make
    const pickVals = pb.models.size ? [...pb.models] : shown.map((o) => o.value);
    const yrs = pb.seasons.size ? [...pb.seasons].sort() : null;
    // 2024, 2025 and 2026: "2024\u20132026"; 2024 and 2026: "2024 + 2026"
    const yrsTxt = (ys) => { const n = ys.map(Number); return n.length > 1 && n.every((v, i) => !i || v === n[i - 1] + 1) ? `${ys[0]}\u2013${ys.at(-1)}` : ys.join(" + "); };
    const nameOf = (vals, all) => {
      const ls = vals.map((v) => items.find((o) => o.value === v)?.label || v);
      const bs = [...new Set(vals.map((v) => items.find((o) => o.value === v)?.brand))];
      const base = all ? `All ${bs.length === 1 ? `${bs[0]} ` : bs.length === 2 ? `${bs[0]} + ${bs[1]} ` : ""}${kindName.toLowerCase()}` : ls.length === 1 ? ls[0] : ls.length === 2 ? `${ls[0]} + ${ls[1]}` : `${ls[0]}, ${ls[1]} + ${ls.length - 2} more`;
      return `${base}${yrs ? ` \u00b7 ${yrsTxt(yrs)}` : ""}`;
    };
    // (update 217) combined with another product (a driver with one ball, say): only the shots hit with both
    const pair = pb.pair, isBallNow = pb.kind === "Ball";
    const groupOfVals = (vals, name) => {
      let clubs = vals, balls = null;
      if (pair) { if (isBallNow) { clubs = pair.clubs; balls = [...new Set([...pair.balls, ...vals])]; } else { clubs = [...new Set([...pair.clubs, ...vals])]; balls = pair.balls.length ? pair.balls : null; } }
      const f = { clubs, ...(balls ? { balls } : {}), ...(yrs ? { years: yrs } : {}) };
      return { id: `product:${[...clubs].sort().join("|")}${balls ? `+${[...balls].sort().join("|")}` : ""}${yrs ? `@${yrs.join(",")}` : ""}`, name: pair ? `${pair.name} + ${name}` : name, f, n: roundsFor(allRounds(), f).length };
    };
    const cur = pickVals.length ? groupOfVals(pickVals, nameOf(pickVals, !pb.models.size)) : null;
    const taken = new Set((inGuide ? pb.groups : sels.filter((s) => s.f?.clubs)).flatMap((x) => x.f.clubs || []));
    const restVals = items.map((o) => o.value).filter((v) => !taken.has(v) && !(cur && cur.f.clubs.includes(v)));
    const addGroup = (grp, redraw = true) => {
      if (!grp) return;
      if (inGuide) { if (pb.groups.some((x) => x.id === grp.id)) return; pb.groups.push({ ...grp, color: COLORS[pb.groups.length % COLORS.length] }); }
      else { if (has(grp.id)) { flashNote("That\u2019s already in the comparison."); return; } if (!room(sels.length + 1, inPlay().length)) { flashNote(capNote()); return; } sels = [...sels, { id: grp.id, name: grp.name, f: grp.f, mode: "product", values: grp.f.clubs, color: nextColor() }]; touched = true; }
      if (redraw) { pb.brands.clear(); pb.models.clear(); draw(); }
    };
    // (update 211) several picked: add each on its own, or combine them into one group (never assumed)
    const parts = pb.models.size > 1 ? [...pb.models].map((v) => [v]) : !pb.models.size && pb.brands.size > 1 ? [...pb.brands].map((b) => shown.filter((o) => o.brand === b).map((o) => o.value)) : null;
    let addB, sepB = null;
    if (parts) {
      sepB = el("button", { type: "button", class: "btn cmp-add" }, `\uff0b Add these ${parts.length} separately`);
      sepB.addEventListener("click", () => { for (const vs of parts) addGroup(groupOfVals(vs, nameOf(vs, !pb.models.size)), false); pb.brands.clear(); pb.models.clear(); draw(); });
      addB = el("button", { type: "button", class: "btn ghost" }, `\uff0b Combine them into one group (${cur.n} rds)`);
    } else addB = el("button", { type: "button", class: "btn cmp-add", disabled: cur ? null : true }, cur ? `\uff0b Add \u201c${cur.name}\u201d (${cur.n} rds)` : "Pick a brand (and models) to make a group");
    addB.addEventListener("click", () => addGroup(cur));
    const restB = restVals.length && (taken.size || cur) ? el("button", { type: "button", class: "btn ghost" }, `\uff0b All the other ${kindName.toLowerCase()}${yrs ? ` \u00b7 ${yrsTxt(yrs)}` : ""}`) : null;
    restB?.addEventListener("click", () => { if (cur) addGroup(cur); const g2 = groupOfVals(restVals.filter((v) => !(cur?.f.clubs || []).includes(v)), `All other ${kindName.toLowerCase()}${yrs ? ` \u00b7 ${yrsTxt(yrs)}` : ""}`); if (g2.f.clubs.length) addGroup(g2); });
    // (update 217) "Combine with another product": keep this pick, then pick a ball (or another club) to go with it
    const pairB = cur && !pair ? el("button", { type: "button", class: "btn ghost" }, "\ud83d\udd17 Combine with another product\u2026") : null;
    pairB?.addEventListener("click", () => {
      const vals = pb.models.size ? [...pb.models] : shown.map((o) => o.value);
      pb.pair = { clubs: isBallNow ? [] : vals, balls: isBallNow ? vals : [], name: nameOf(vals, !pb.models.size).replace(/ \u00b7 [\d\u2013+ ]+$/, ""), kind: pb.kind };
      pb.kind = isBallNow ? (kindsAll.find((k) => k.group !== "Ball")?.group || pb.kind) : kindsAll.some((k) => k.group === "Ball") ? "Ball" : pb.kind;
      pb.brands.clear(); pb.models.clear(); draw();
    });
    const pairBox = pair ? el("div", { class: "cmp-pair" }, [el("span", {}, [el("span", { class: "muted small" }, "Combined with "), el("strong", {}, pair.name)]), el("span", { class: "muted small" }, pair.balls.length || isBallNow ? "Only shots hit with both count. Pick another to add the same club with a different ball." : "Shots with either count."),
      (() => { const x = el("button", { type: "button", class: "link" }, "Stop combining"); x.addEventListener("click", () => { pb.pair = null; draw(); }); return x; })()]) : null;
    const hint = cur && cur.n < 10 ? el("p", { class: "cmp-few" }, `Only ${cur.n} round${cur.n === 1 ? "" : "s"} with this: the numbers will be shaky.`) : null;
    let groupsBox = null, go = null;
    if (inGuide) {
      groupsBox = pb.groups.length ? el("div", { class: "cmp-pb-groups" }, [el("p", { class: "cmp-chip-gt" }, "Your groups"), ...pb.groups.map((x, i) => {
        const xb = el("button", { type: "button", class: "cmp-key-x", "aria-label": `Remove ${x.name}` }, "\u2715");
        xb.addEventListener("click", () => { pb.groups.splice(i, 1); draw(); });
        return el("span", { class: "cmp-key", style: `--c:${x.color}` }, [el("i", { "aria-hidden": "true" }), el("span", {}, x.name), el("span", { class: `cmp-key-n${x.n < 10 ? " few" : ""}` }, `${x.n}`), xb]);
      })]) : null;
      go = el("button", { type: "button", class: "btn cmp-add", disabled: pb.groups.length < 2 ? true : null }, pb.groups.length < 2 ? "Add at least two groups to compare" : `Compare these ${pb.groups.length} \u2192`);
      go.addEventListener("click", () => { g.pgDone = true; applyGuide(); });
    }
    return el("div", { class: "cmp-pb" }, [
      inGuide ? el("p", { class: "muted small" }, "Make each group: pick a season (if you want one), a kind of club, then one or more brands (and models, if you want just some). Add it, then make the next. \u201cCombine with another product\u201d pairs it with a ball (or another club). E.g. all Callaway drivers vs all TaylorMade drivers, or two Callaway models vs one Titleist.") : null,
      seasonRow, pairBox, searchRow, kindRow, brandRow, modelRow, el("div", { class: "cmp-guide-row" }, [sepB, addB, restB, pairB]), hint, groupsBox, go,
    ]);
  }
  function guideSummary() {
    const who = g.who === "everyone" ? "Everyone in the data" : g.who === "several" ? inPlay().map((p) => p.label).join(", ") : player.label;
    const what = g.what === "time" ? { seasons: "this season vs last season", form: "recent form against the rounds before", formev: "the latest events against the ones before", career: "this season vs their whole career", own: "dates of your own" }[g.when]
      : g.what === "gear" ? "products" : g.what === "place" ? "where and when they play best" : g.what === "versus" ? `against each other${g.h2h ? ", head to head" : ""}, ${SEASONS.find(([x]) => x === g.stretch)?.[1].toLowerCase()}` : "";
    return `${who} · ${what || sels.map((x) => x.name).join(" vs ") || "your picks"}`; // (update 248: from Ask AI there's no question answered: the picks)
  }
  function guideBox() {
    if (!g.open) {
      if (!g.what) return null;
      const again = el("button", { type: "button", class: "btn ghost small" }, "Start over");
      again.addEventListener("click", restart);
      return el("section", { class: "panel cmp-guide done" }, [el("div", { class: "cmp-guide-sum" }, [el("span", { class: "muted small" }, "Comparing"), el("strong", {}, guideSummary())]), again]);
    }
    const step = guideStep();
    if (step === "done") return null;
    const opt = (v, label, sub, k = step) => { const b = el("button", { type: "button", class: "cmp-guide-o" }, [el("strong", {}, label), sub ? el("span", {}, sub) : null]); b.addEventListener("click", () => answer(k, v)); return b; };
    let q = "", body = [];
    const prods = step === "gear" || step === "models" ? products(allRounds()) : [];
    if (step === "who") {
      q = "Who do you want to look at?";
      body = [opt("one", `Just ${player.label}`, "One player’s rounds"), opt("several", "A few players, side by side", "Pick the players next")]; // (update 210: everyone together is the start card, before a player is picked)
    } else if (step === "players") {
      q = "Which players?";
      const nextB = el("button", { type: "button", class: "btn cmp-add", disabled: chosen.filter((p) => p.key !== EVERY).length < 2 ? true : null }, "Next \u2192");
      nextB.addEventListener("click", () => answer("playersDone", true));
      // (update 209) or just this player against everyone else in the data
      const vsRest = everyOk() ? el("button", { type: "button", class: "btn ghost" }, `Compare ${player.label} with everyone else \u2192`) : null;
      vsRest?.addEventListener("click", async () => { g.playersDone = true; g.phow = "each"; await answer("pvsrest", true); });
      body = [el("p", { class: "muted small" }, "Add at least two players below, then tap Next."), playersRow(), el("div", { class: "cmp-guide-row" }, [nextB, vsRest])];
    } else if (step === "phow" || step === "how") {
      // (update 209) several picked: on their own, in two groups (each group's rounds pooled), or one against the rest
      const isP = step === "phow", n = isP ? chosen.filter((p) => p.key !== EVERY && !p.members).length : g.models.length;
      const cap = Math.max(1, Math.floor(MAX_SEL / Math.max(1, isP ? 1 : inPlay().length)));
      q = "How do you want to compare them?";
      body = [
        n <= cap ? opt("each", "Add them separately", isP ? "Every player on their own, side by side" : "Every model on its own, side by side") : null,
        opt("groups", "Combine them into two groups", isP ? "Put some players together and compare the groups (their rounds pooled)" : "Put some models together and compare the groups"),
        opt("one", "One against the rest combined", isP ? "One player against the others put together" : `One model against all the other ${groupName(g.gear).toLowerCase()}`),
      ];
    } else if (step === "pgroups" || step === "groups") {
      const isP = step === "pgroups";
      const list = isP ? chosen.filter((p) => p.key !== EVERY && !p.members).map((p) => ({ value: p.key, label: p.label })) : (products(allRounds()).find((x) => x.group === g.gear)?.items || []).filter((x) => g.models.includes(x.value));
      g.draft ||= Object.fromEntries(list.map((x, i) => [x.value, i < Math.ceil(list.length / 2) ? 0 : 1]));
      q = "Which group is each one in?";
      const cnt = [0, 1].map((x) => list.filter((o) => g.draft[o.value] === x).length);
      const go = el("button", { type: "button", class: "btn cmp-add", disabled: cnt.includes(0) ? true : null }, "Compare the groups \u2192");
      go.addEventListener("click", () => { const d = g.draft; delete g.draft; answer(isP ? "pgroups" : "groups", d); });
      body = [el("div", { class: "cmp-groups" }, list.map((o) => {
        const seg = el("div", { class: "cmp-seg small" }, ["Group A", "Group B"].map((l, x) => { const b = el("button", { type: "button", class: `cmp-seg-b${g.draft[o.value] === x ? " on" : ""}` }, l); b.addEventListener("click", () => { g.draft[o.value] = x; draw(); }); return b; }));
        return el("div", { class: "cmp-group-row" }, [el("span", {}, o.label), seg]);
      })), go];
    } else if (step === "pone" || step === "one") {
      const isP = step === "pone";
      const list = isP ? chosen.filter((p) => p.key !== EVERY && !p.members).map((p) => ({ value: p.key, label: p.label })) : (products(allRounds()).find((x) => x.group === g.gear)?.items || []).filter((x) => g.models.includes(x.value));
      q = isP ? "Which player against the others?" : `Which one against all the other ${groupName(g.gear).toLowerCase()}?`;
      body = list.map((o) => opt(o.value, o.label, null));
    } else if (step === "what") {
      q = "What do you want to compare?";
      body = [
        opt("time", "How they’re playing over time", "This season against last, or recent form"),
        products(allRounds()).length ? opt("gear", "One club or ball against another", "Drivers, irons, putters, golf balls…") : null,
        opt("place", "Where and when they play best", "Courses, tournaments, rounds or months"),
        inPlay().length > 1 ? opt("versus", "The players against each other", "Over the same stretch of rounds") : null,
      ];
    } else if (step === "when") {
      q = "Which time periods?";
      const n = opts.total >= 40 ? 10 : 5;
      body = [
        opts.years.length >= 2 ? opt("seasons", "This season vs last season", `${opts.years[0].value} against ${opts.years[1].value}`) : null,
        opts.total >= 2 * n ? opt("form", `Their last ${n} rounds vs the ${n} before`, "Are they playing better or worse lately?") : null,
        opts.events >= 6 ? opt("formev", `Their last ${opts.events >= 10 ? 5 : 3} events vs the ${opts.events >= 10 ? 5 : 3} before`, "The same, tournament by tournament") : null, // (update 217)
        opts.years.length ? opt("career", "This season vs their whole career", "How this year compares with their usual") : null,
        opt("own", "I’ll choose the dates myself", "Opens the date picker"),
      ];
    } else if (step === "pbuild") {
      q = "Which products?";
      body = [productBuilder(true)];
    } else if (step === "gear") {
      q = "Which kind of equipment?";
      body = prods.map((x) => opt(x.group, groupName(x.group), `${x.items.length} model${x.items.length === 1 ? "" : "s"}`));
    } else if (step === "models") {
      const grp = prods.find((x) => x.group === g.gear);
      const cap = Math.max(2, Math.floor(MAX_SEL / Math.max(1, inPlay().length)));
      q = `Which ${groupName(g.gear).toLowerCase()}?`;
      const pickd = new Set(g.pick || []);
      // (update 209) one picked: it against all the others; more: how to compare them comes next
      const go = el("button", { type: "button", class: "btn cmp-add", disabled: pickd.size < 1 ? true : null }, pickd.size === 1 ? `Compare it with all the other ${groupName(g.gear).toLowerCase()} \u2192` : pickd.size > 1 ? "Next \u2192" : "Pick one or more");
      go.addEventListener("click", () => answer("models", [...pickd]));
      body = [el("div", { class: "cmp-chips" }, (grp?.items || []).map((o) => {
        const on = pickd.has(o.value);
        const c = el("button", { type: "button", class: `cmp-chip${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "✓") : null, o.label, el("span", { class: "cmp-chip-n" }, `${o.n} rds`)]);
        c.addEventListener("click", () => { if (on) pickd.delete(o.value); else pickd.add(o.value); g.pick = [...pickd]; draw(); });
        return c;
      })), go];
    } else if (step === "place") {
      q = "Compare them by…";
      body = [
        opts.courses.length > 1 ? opt("courses", "Course", "Every course they\u2019ve played, best first") : null,
        opts.tournaments.length > 1 ? opt("tournaments", "Tournament", "Every tournament, all years together, best first") : null,
        opts.rounds.length > 1 ? opt("rounds", "Round", "Round 1 against round 2, 3 and 4") : null,
        opts.months.length > 1 ? opt("months", "Time of year", "Every month, best first") : null,
      ];
    } else if (step === "h2h") {
      q = "Which of their rounds?";
      body = [opt(true, "Only when they went head to head", "Just the rounds they all played: same tournament, same round"), opt(false, "All of their rounds", "Each player\u2019s own rounds, whether or not the others played them")];
    } else if (step === "stretch") {
      q = g.h2h ? "Over which stretch of those rounds?" : "Over which rounds?";
      body = SEASONS.map(([v, l]) => opt(v, l, null));
    }
    const skip = el("button", { type: "button", class: "link" }, "Skip: I’ll set the filters myself");
    skip.addEventListener("click", () => { g.open = false; editOpen = true; draw(); });
    const backB = (g.who && step !== "who" && !(self && step === "what")) ? el("button", { type: "button", class: "link" }, "← Back") : null;
    backB?.addEventListener("click", back);
    return el("section", { class: "panel cmp-guide" }, [
      el("p", { class: "cmp-guide-k" }, "Set up a comparison"),
      el("h2", {}, q),
      el("div", { class: ["models", "players", "groups", "pgroups", "pbuild"].includes(step) ? "cmp-guide-free" : "cmp-guide-opts" }, body.filter(Boolean)),
      el("div", { class: "cmp-guide-foot" }, [backB, skip]),
      gnote,
    ]);
  }
  // everything you can set by hand, folded away under one line (open when you skip the questions)
  function editBox() {
    return el("details", { class: "panel cmp-edit", open: editOpen ? true : null }, [
      el("summary", {}, [el("span", { class: "cmp-edit-t" }, "Edit the filters yourself"), el("span", { class: "muted small" }, g.what === "time" || g.what === "versus" ? "Players, seasons, rounds, months, dates, which shots count\u2026" : g.what === "gear" ? "Players, clubs and balls, seasons, which shots count\u2026" : g.what === "place" ? "Players, tournaments, courses, which shots count\u2026" : "Players, seasons, tournaments, products, which shots count\u2026")]),
      playersRow(), builder(),
    ]);
  }
  function sourceSeg() {
    return null; // (update 223: no Tour Events / Entered Rounds switch; entered rounds are part of each player's rounds)
    // eslint-disable-next-line no-unreachable
    return el("div", { class: "cmp-seg", role: "group", "aria-label": "Data" }, [["tour", "Tour Events"], ["entered", "Entered Rounds"]].map(([v, l]) => {
      const b = el("button", { type: "button", class: `cmp-seg-b${source === v ? " on" : ""}`, "aria-pressed": String(source === v) }, l);
      b.addEventListener("click", () => { if (source === v) return; source = v; load(); });
      return b;
    }));
  }

  /* ------------------------------ choosing what to compare ------------------------------ */
  function builder() {
    // (update 244) the filters follow the question picked: over time, only time (Seasons, Rounds, Months, Date
    // range); a club or ball, only products; where and when, only tournaments and courses. No question: everything.
    const br = g.what === "time" || g.what === "versus" ? "time" : g.what === "gear" ? "gear" : g.what === "place" ? "place" : null;
    let modes = MODES.filter(([m]) => !["years", "tournaments", "courses", "rounds", "months", "tours"].includes(m)); // (update 216: all in "Tournaments & courses") (update 233: seasons are in Time windows)
    if (br === "gear") modes = modes.filter(([m]) => m === "product");
    if (br === "place") modes = modes.filter(([m]) => m === "filters");
    if (!modes.some(([m]) => m === mode)) mode = br === "gear" ? "product" : br === "place" ? "filters" : "windows";
    const TT = [["season", "Seasons", "Each season, the last one, or the whole career."], ["rounds", "Rounds", "Recent form against the rounds or events before, or Round 1s against Round 4s."], ["months", "Months", "The time of year: every year, or one season\u2019s months."], ["dates", "Date range", "Your own dates (and round numbers)."], ["places", "Tournaments / Courses", "Open a filter, pick from it, and the other filters only offer what still fits."]];
    const tabOn = (t) => (t === "dates" ? mode === "custom" : t === "places" ? mode === "filters" : mode === "windows" && winTab === t);
    const tabs = br === "time"
      ? el("div", { class: "cmp-modes", role: "tablist", "aria-label": "Compare by" }, TT.map(([t, l]) => {
        const b = el("button", { type: "button", role: "tab", class: `cmp-mode${tabOn(t) ? " on" : ""}`, "aria-selected": String(tabOn(t)) }, l);
        b.addEventListener("click", () => { if (tabOn(t)) return; if (t === "dates") mode = "custom"; else if (t === "places") mode = "filters"; else { mode = "windows"; winTab = t; } chipFilter = ""; staged = new Map(); draw(); });
        return b;
      }))
      : modes.length > 1 ? el("div", { class: "cmp-modes", role: "tablist", "aria-label": "Compare by" }, modes.map(([m, l]) => {
        const b = el("button", { type: "button", role: "tab", class: `cmp-mode${mode === m ? " on" : ""}`, "aria-selected": String(mode === m) }, l);
        b.addEventListener("click", () => { if (mode === m) return; mode = m; chipFilter = ""; staged = new Map(); draw(); });
        return b;
      })) : null;
    if (br === "time" && mode !== "custom" && mode !== "filters") mode = "windows";
    const hint = el("p", { class: "cmp-hint" }, br === "time" ? (TT.find(([t]) => tabOn(t)) || TT[1])[2] : modes.find(([m]) => m === mode)[2]);
    const timeTabs = br === "time";
    let body;
    if (mode === "custom") body = customForm();
    else if (mode === "filters") body = facetBuilder();
    else if (mode === "product") body = productBuilder(false);
    else {
      const prods = mode === "product" ? products(allRounds()) : [];
      const list = mode === "product" ? prods.flatMap((g) => g.items)
        : { years: opts.years, windows: opts.windows, tournaments: opts.tournaments, courses: opts.courses, rounds: opts.rounds, months: opts.months, tours: opts.tours }[mode] || [];
      const filterOf = (o) => (mode === "years" ? { years: [o.value] } : mode === "windows" ? windowFilter(o.value) : mode === "tournaments" ? { events: [o.value] } : mode === "courses" ? { courses: [o.value] } : mode === "rounds" ? { roundNos: [o.value] } : mode === "months" ? { months: [o.value] } : mode === "product" ? { clubs: [o.value] } : { tours: [o.value] });
      const long = list.length > 14 && mode !== "windows"; // (update 233: no search in Time windows)
      const search = long ? el("input", { type: "search", class: "cmp-chip-search", placeholder: `Find ${FIND[mode] || "one"}\u2026`, value: chipFilter }) : null;
      const chipsBox = el("div", { class: "cmp-chips-wrap" });
      const addRow = el("div", { class: "cmp-addrow" });
      // (update 244) already in the comparison: not offered again
      const inUse = (o) => mode === "windows" && (has(`windows:${o.value}`) || (o.value.startsWith("year:") && sels.some((x) => x.id === `years:${o.value.slice(5)}`)) || (/^(last|prev)(ev)?:\d+$/.test(o.value) && sels.some((x) => x.id === `windows:${o.value}`)));
      const chip = (o) => {
        if (inUse(o)) return null;
        const on = staged.has(o.value);
        // (a small dot for each selection already in the comparison that includes it)
        const inSel = multi() ? [] : sels.filter((x) => x.mode === mode && x.values?.includes(o.value));
        const b = el("button", { type: "button", class: `cmp-chip${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, mode === "windows" ? o.label.replace(/ before that$/, " before") : o.label, o.n == null ? null : el("span", { class: "cmp-chip-n" }, `${o.n} rd${o.n === 1 ? "" : "s"}`),
          inSel.length ? el("span", { class: "cmp-chip-dots", title: `In: ${inSel.map((x) => x.name).join(", ")}` }, inSel.map((x) => el("i", { style: `background:${x.color}` }))) : null]);
        b.addEventListener("click", () => { if (on) staged.delete(o.value); else staged.set(o.value, { label: o.long || o.label, f: o.f || filterOf(o) }); drawChips(); drawAdd(); });
        return b;
      };
      const drawChips = () => {
        const t = chipFilter.trim().toLowerCase();
        const shown = list.filter((o) => !t || o.label.toLowerCase().includes(t)).slice(0, long && !t ? 30 : 200);
        if (mode === "windows") {
          // (update 235) three filters: Season, Rounds, Months (seasons, months and round numbers moved here from
          // Tournaments & courses). Rounds: recent form and the rounds / events just before (rounds on one row,
          // events on the next), then each round number.
          const tabsW = [["season", "Season"], ["rounds", "Rounds"], ["months", "Months"]];
          const nIn = (t) => [...staged.keys()].filter((v) => (t === "season" ? /^(year:|all$)/.test(v) : t === "months" ? v.startsWith("mo:") : /^(last|prev)(ev)?:|^rn:/.test(v))).length;
          const tabRow = el("div", { class: "cmp-fx-heads cmp-win-tabs" }, tabsW.map(([t, l]) => {
            const n = nIn(t);
            const b = el("button", { type: "button", class: `cmp-fx-h${winTab === t ? " open" : ""}${n ? " set" : ""}`, "aria-expanded": String(winTab === t) }, [l, n ? el("span", { class: "cmp-fx-n" }, String(n)) : null]);
            b.addEventListener("click", () => { winTab = t; drawChips(); });
            return b;
          }));
          const grp = (title, rows) => el("div", { class: "cmp-chip-group" }, [title ? el("p", { class: "cmp-chip-gt" }, title) : null, ...rows]);
          let content;
          if (winTab === "season") {
            content = [grp(null, [el("div", { class: "cmp-chips" }, list.filter((o) => o.value.startsWith("year:") || o.value === "all").map(chip))])];
          } else if (winTab === "rounds") {
            const ownStaged = [...staged].filter(([v]) => !list.some((o) => o.value === v) && /^(last|prev)(ev)?:/.test(v)).map(([v, x]) => ({ value: v, label: x.label, n: Number(v.split(":")[1]) }));
            const row = (re, kind) => el("div", { class: "cmp-chips cmp-win-row" }, [...[...list, ...ownStaged].filter((o) => re.test(o.value)).map(chip), ownWindow(kind)]);
            const rnds = (opts.rounds || []).map((o) => ({ value: `rn:${o.value}`, label: `Round ${o.value}s`, long: `Round ${o.value}s`, n: o.n, f: { roundNos: [o.value] } }));
            content = [grp("Recent form", [row(/^last:/, "last"), row(/^lastev:/, "lastev")]), grp("The rounds or events just before", [row(/^prev:/, "prev"), row(/^prevev:/, "prevev")]),
              rnds.length > 1 ? grp("Round number", [el("div", { class: "cmp-chips" }, rnds.map(chip))]) : null];
          } else {
            // months: in every season, or one season's (the season pills narrow them)
            const rsAll = sgRounds(allRounds());
            const ys = [...new Set(rsAll.map(yr))].sort().reverse();
            if (winYear && !ys.includes(winYear)) winYear = "";
            const yPill = (v, l) => { const on = winYear === v; const b = el("button", { type: "button", class: `cmp-chip small${on ? " on" : ""}`, "aria-pressed": String(on) }, l); b.addEventListener("click", () => { winYear = v; drawChips(); }); return b; };
            const cnt = new Map(); for (const rd of rsAll) { if (winYear && yr(rd) !== winYear) continue; const m = /^\d{4}-(\d{2})/.exec(String(rd.date || "")); if (m) { const k = Number(m[1]) - 1; cnt.set(k, (cnt.get(k) || 0) + 1); } }
            const MNS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const ms = [...cnt].sort((a, b) => a[0] - b[0]).map(([m, n]) => ({ value: `mo:${m}|${winYear}`, label: winYear ? `${MNS[m].slice(0, 3)} ${winYear}` : MNS[m], long: winYear ? `${MNS[m]} ${winYear}` : `${MNS[m]} (every year)`, n, f: winYear ? { months: [String(m)], years: [winYear] } : { months: [String(m)] } }));
            content = [ys.length > 1 ? grp("Year", [el("div", { class: "cmp-chips" }, [yPill("", "Every year"), ...ys.map((y) => yPill(y, y))])]) : null, grp("Month", [el("div", { class: "cmp-chips" }, ms.map(chip))])];
          }
          mount(chipsBox, [timeTabs ? null : tabRow, ...content]);
        } else if (mode === "product") {
          mount(chipsBox, prods.length ? prods.map((g) => { const xs = g.items.filter((o) => shown.includes(o)); return xs.length ? el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, g.group === "Other" ? "Other clubs" : g.group === "Ball" ? "Golf balls" : g.group === "Non-Driver" ? "Non-Driver (tee shots)" : `${g.group}s`), el("div", { class: "cmp-chips" }, xs.map(chip))]) : null; })
            : el("div", { class: "cmp-empty-note" }, [el("strong", {}, "No club data in this file yet."), el("p", { class: "muted small" }, "Once the data has each shot\u2019s equipment (clubType, clubBrand, clubModel, ballBrand and ballModel columns), every club model shows here, grouped by type (drivers, fairway woods, hybrids, irons, wedges, putters), with the golf balls after them. Pick one model against another to see how they play with each.")]));
        } else mount(chipsBox, el("div", { class: "cmp-chips" }, shown.map(chip)));
      };
      // (update 206) picks are compared against each other; tick "Combine" to pool them into one group instead
      const drawAdd = () => {
        const n = staged.size;
        const add = el("button", { type: "button", class: "btn cmp-add", disabled: !n }, n > 1 ? (combine ? `\uff0b Add these ${n} as one group` : `\uff0b Compare these ${n}`) : "\uff0b Add to comparison");
        add.addEventListener("click", addStaged);
        const clear = n ? el("button", { type: "button", class: "link" }, "Clear picks") : null;
        clear?.addEventListener("click", () => { staged = new Map(); drawChips(); drawAdd(); });
        const box = el("input", { type: "checkbox", checked: combine ? true : null });
        box.addEventListener("change", () => { combine = box.checked; drawAdd(); });
        const comb = n > 1 ? el("label", { class: "cmp-combine" }, [box, el("span", {}, "Combine them into one group (their rounds pooled)")]) : null;
        mount(addRow, [add, comb, el("span", { class: "muted small" }, n ? (n > 1 ? (combine ? `${n} picked: added as one group.` : `${n} picked: each one added on its own.`) : "1 picked.") : "Tap one or more, then add them."), clear]);
      };
      // (update 190) your own window: "Last [n] rounds" / "The [n] before that"
      function ownWindow(kind) {
        const ev = kind === "lastev" || kind === "prevev", base = ev ? kind.slice(0, -2) : kind, unit = ev ? "events" : "rounds", have = ev ? opts.events : opts.total;
        const inp = el("input", { type: "number", min: 1, max: 999, class: "cmp-own-n", "aria-label": base === "last" ? `How many latest ${unit}` : `How many ${unit} before those`, placeholder: "#" });
        const go = el("button", { type: "button", class: "cmp-own-go", "aria-label": "Pick it" }, "\u2713");
        const pick = () => {
          const n = Math.round(Number(inp.value));
          if (!n || n < 1) { inp.focus(); return; }
          if (base === "last" ? n > have : 2 * n > have) { flashNote(base === "last" ? `They have ${have} ${unit} here.` : `Only ${have} ${unit} here: ${Math.floor(have / 2)} at most, so there are that many before them.`); return; }
          const v = `${kind}:${n}`, label = base === "last" ? `Last ${n} ${unit}` : ev ? `The ${n} events before that` : `The ${n} rounds before that`;
          staged.set(v, { label, f: windowFilter(v) }); drawChips(); drawAdd();
        };
        go.addEventListener("click", pick);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pick(); } });
        return el("span", { class: "cmp-chip cmp-own" }, [base === "last" ? "Last" : "The", inp, base === "last" ? unit : ev ? "events before" : "rounds before", go]);
      }
      search?.addEventListener("input", () => { chipFilter = search.value; drawChips(); });
      drawChips(); drawAdd();
      body = el("div", {}, [search, chipsBox, long && !chipFilter && mode !== "product" ? el("p", { class: "muted small" }, `Showing the latest 30 of ${list.length}: type to find others.`) : null, addRow]);
    }
    return el("section", { class: "panel cmp-build" }, [el("div", { class: "cmp-build-top" }, [el("h2", {}, "Compare by"), sourceSeg()]), tabs, hint, body, note, includeRow()]);
  }
  /* (update 216) filters that narrow each other: Season, Tour, Tournament, Course, Round, Month. Open one to pick from
     it; every other filter then only offers what's left (2026 picked: only 2026's tournaments and courses). */
  const fx = { years: new Set(), tours: new Set(), events: new Set(), courses: new Set(), roundNos: new Set(), months: new Set(), open: "events", q: "" };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FACETS_ALL = [
    ["years", "Season", "Seasons", (rd) => yr(rd), (v) => v],
    ["tours", "Tour", "Tours", (rd) => rd.tour || null, (v) => v],
    ["events", "Tournament", "Tournaments", (rd) => rd.event || null, (v) => v],
    ["courses", "Course", "Courses", (rd) => rd.course || null, (v) => v],
    ["roundNos", "Round", "Rounds", (rd) => (rd.roundNo ? String(rd.roundNo) : null), (v) => `Round ${v}`],
    ["months", "Month", "Months", (rd) => { const m = /^\d{4}-(\d{2})/.exec(String(rd.date || "")); return m ? String(Number(m[1]) - 1) : null; }, (v) => MON[Number(v)] || v],
  ];
  const FACETS = FACETS_ALL.filter(([k]) => !["years", "roundNos", "months"].includes(k)); // (update 235: those are in Time windows)
  function facetBuilder() {
    const rs = sgRounds(allRounds());
    const facets = FACETS.filter(([k, , , f]) => new Set(rs.map(f).filter(Boolean)).size > 1 || fx[k].size);
    const fits = (rd, skip) => facets.every(([k, , , f]) => k === skip || !fx[k].size || fx[k].has(f(rd)));
    if (!facets.some(([k]) => k === fx.open)) fx.open = facets[0]?.[0] || null;
    const latest = new Map(); for (const rd of rs) { const e = rd.event; if (e && String(rd.date) > (latest.get(e) || "")) latest.set(e, String(rd.date)); }
    const optsOf = (k, f) => {
      const m = new Map(); for (const rd of rs) { if (!fits(rd, k)) continue; const v = f(rd); if (v) m.set(v, (m.get(v) || 0) + 1); }
      for (const v of fx[k]) if (!m.has(v)) m.set(v, 0);
      const xs = [...m];
      return k === "years" ? xs.sort((a, b) => b[0].localeCompare(a[0])) : k === "events" ? xs.sort((a, b) => (latest.get(b[0]) || "").localeCompare(latest.get(a[0]) || "")) : k === "roundNos" || k === "months" ? xs.sort((a, b) => Number(a[0]) - Number(b[0])) : xs.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    const box = el("div", { class: "cmp-fx" });
    const redraw = () => { mount(box, inner()); };
    const inner = () => {
      const heads = el("div", { class: "cmp-fx-heads" }, facets.map(([k, l]) => {
        const n = fx[k].size;
        const b = el("button", { type: "button", class: `cmp-fx-h${fx.open === k ? " open" : ""}${n ? " set" : ""}`, "aria-expanded": String(fx.open === k) }, [l, n ? el("span", { class: "cmp-fx-n" }, String(n)) : null, el("span", { class: "cmp-fx-car", "aria-hidden": "true" }, fx.open === k ? "\u25b4" : "\u25be")]);
        b.addEventListener("click", () => { fx.open = fx.open === k ? null : k; fx.q = ""; redraw(); });
        return b;
      }));
      let opts_ = null;
      if (fx.open) {
        const [k, l, , f, lab] = facets.find(([x]) => x === fx.open);
        const all = optsOf(k, f), t = fx.q.trim().toLowerCase();
        const shown = all.filter(([v]) => !t || lab(v).toLowerCase().includes(t));
        const search = all.length > 12 ? el("input", { type: "search", class: "cmp-chip-search", placeholder: `Find a ${l.toLowerCase()}\u2026`, value: fx.q }) : null;
        search?.addEventListener("input", () => { const pos = search.selectionStart; fx.q = search.value; redraw(); const a = box.querySelector(".cmp-chip-search"); if (a) { a.focus(); try { a.setSelectionRange(pos, pos); } catch {} } });
        // (update 248) lots to pick from: Select all (the ones showing, so a search narrows it first) and Clear
        const showVals = shown.slice(0, t ? 200 : 40).filter(([, n]) => n).map(([v]) => v);
        const allOn = showVals.length && showVals.every((v) => fx[k].has(v));
        const selAll = showVals.length > 2 ? (() => { const b = el("button", { type: "button", class: "cmp-chip cmp-selall" }, allOn ? "Clear" : t ? "Select all these" : "Select all"); b.addEventListener("click", () => { for (const v of showVals) allOn ? fx[k].delete(v) : fx[k].add(v); redraw(); }); return b; })() : null;
        opts_ = el("div", { class: "cmp-fx-opts" }, [search, el("div", { class: "cmp-chips" }, [selAll, ...shown.slice(0, t ? 200 : 40).map(([v, n]) => {
          const on = fx[k].has(v);
          const b = el("button", { type: "button", class: `cmp-chip${on ? " on" : ""}${!n && !on ? " off" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, lab(v), el("span", { class: "cmp-chip-n" }, `${n} rd${n === 1 ? "" : "s"}`)]);
          b.addEventListener("click", () => { on ? fx[k].delete(v) : fx[k].add(v); redraw(); });
          return b;
        })]), !t && shown.length > 40 ? el("p", { class: "muted small" }, `Showing 40 of ${shown.length}: type to find others.`) : null]);
      }
      // what the picks make, and adding it
      const picked = facets.filter(([k]) => fx[k].size);
      const match = rs.filter((rd) => fits(rd, null));
      const fOf = (over = {}) => { const f = {}; for (const [k] of facets) { const vs = over[k] || [...fx[k]]; if (!vs.length) continue; if (k === "events") { const names = new Set(vs); f.events = [...new Set(rs.filter((rd) => names.has(rd.event)).map(evk))]; } else f[k] = vs; } return f; };
      const nameOf = (over = {}) => picked.map(([k, , , , lab]) => { const vs = over[k] || [...fx[k]]; return vs.length <= 2 ? vs.map(lab).join(" + ") : `${lab(vs[0])} + ${vs.length - 1} more`; }).join(" \u00b7 ");
      const add = (list) => {
        const fresh = list.filter((x) => !has(x.id));
        if (!fresh.length) { flashNote("That\u2019s already in the comparison."); return; }
        if (!room(sels.length + fresh.length, inPlay().length)) { flashNote(capNote()); return; }
        for (const x of fresh) sels = [...sels, { ...x, mode: "filters", full: x.name, color: nextColor() }];
        touched = true; draw();
      };
      const sel = (over) => { const f = fOf(over); return { id: `filters:${JSON.stringify(f)}`, name: nameOf(over) || "All rounds", f }; };
      const multiF = picked.filter(([k]) => fx[k].size > 1);
      const acts = [];
      if (picked.length) {
        for (const [k, , pl] of multiF) { const b = el("button", { type: "button", class: "btn cmp-add" }, `\uff0b Each of the ${fx[k].size} ${pl.toLowerCase()} separately`); b.addEventListener("click", () => add([...fx[k]].map((v) => sel({ [k]: [v] })))); acts.push(b); }
        const one = el("button", { type: "button", class: multiF.length ? "btn ghost" : "btn cmp-add", disabled: match.length ? null : true }, `${multiF.length ? "\uff0b Combine into one group" : `\uff0b Add \u201c${nameOf()}\u201d`} (${match.length} rds)`);
        one.addEventListener("click", () => add([sel()]));
        acts.push(one);
        const clr = el("button", { type: "button", class: "link" }, "Clear filters"); clr.addEventListener("click", () => { for (const [k] of FACETS) fx[k].clear(); redraw(); }); acts.push(clr);
      }
      return [heads, opts_, el("div", { class: "cmp-addrow" }, picked.length ? acts : [el("span", { class: "muted small" }, "Open a filter above and pick from it.")])];
    };
    redraw();
    return box;
  }
  // (update 189) the picks, as one selection (several: their rounds pooled, so it's their average)
  async function addStaged() {
    if (!staged.size) return;
    // (update 206) not combining: each pick is its own selection
    if (!combine && staged.size > 1) {
      const list = [...staged].filter(([v]) => !has(`${mode}:${v}`));
      if (!room(sels.length + list.length, inPlay().length)) { flashNote(capNote()); return; }
      for (const [v, x] of list) sels = [...sels, { id: `${mode}:${v}`, name: x.label, f: x.f, mode, values: [v], full: x.label, color: nextColor() }];
      staged = new Map(); touched = true;
      draw();
      return;
    }
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
  // (update 218) tap two or more in the bar, then Combine: they become one group (their rounds pooled)
  let joinPick = new Set();
  function combineSels() {
    const pick = sels.filter((s) => joinPick.has(s.id));
    if (pick.length < 2) return;
    const fs = pick.map((s) => s.f || {});
    const sameYears = fs.every((f) => JSON.stringify(f.years || null) === JSON.stringify(fs[0].years || null));
    const plainProducts = fs.every((f) => f.clubs?.length && !f.balls && Object.keys(f).every((k) => k === "clubs" || k === "years")) && sameYears;
    const f = plainProducts ? { clubs: [...new Set(fs.flatMap((x) => x.clubs))], ...(fs[0].years ? { years: fs[0].years } : {}) } : { any: fs };
    const name = pick.length === 2 ? `${pick[0].name} + ${pick[1].name}` : `${pick[0].name}, ${pick[1].name} + ${pick.length - 2} more`;
    const at = sels.indexOf(pick[0]);
    const one = { id: `combo:${pick.map((s) => s.id).sort().join("&")}`, parts: plainProducts ? null : pick.map((s) => ({ name: s.name, f: s.f })), name, full: pick.map((s) => s.full || s.name).join(" + "), f, mode: plainProducts ? "product" : pick[0].mode, values: plainProducts ? f.clubs : null, color: pick[0].color };
    sels = sels.filter((s) => !joinPick.has(s.id)); sels.splice(Math.min(at, sels.length), 0, one);
    joinPick = new Set(); touched = true; draw();
  }
  /* ------------------------------ (update 246) inside the groups ------------------------------ */
  const gearName = (v) => { const gi = gearInfo(v); return `${gi.brand || ""} ${gi.model || ""}`.trim() || String(v).replace(/^[^|]*\|/, ""); };
  // the parts of a group: each model (or ball) in it, else each season, else each pick it was combined from
  function membersOf(sel) {
    const f = sel?.f || {};
    if (f.any?.length > 1) return (sel.parts || f.any.map((ff, i) => ({ name: `Part ${i + 1}`, f: ff }))).map((p0, i) => ({ key: `any:${i}`, name: p0.name, f: p0.f }));
    if (f.clubs?.length > 1) return f.clubs.map((v) => ({ key: v, name: gearName(v), f: { ...f, clubs: [v] } }));
    if (f.balls?.length > 1) return f.balls.map((v) => ({ key: v, name: gearName(v), f: { ...f, balls: [v] } }));
    if (f.years?.length > 1) return f.years.map((y) => ({ key: `y:${y}`, name: y, f: { ...f, years: [y] } }));
    return null;
  }
  // (update 248) a time window (the last 12 rounds, the 12 before): its number can be changed
  const winOf = (sel) => { const f = sel?.f || {}; return f.last ? ["last", f.last] : f.prev ? ["prev", f.prev] : f.lastEv ? ["lastev", f.lastEv] : f.prevEv ? ["prevev", f.prevEv] : null; };
  const winSel = (kind, n) => { const ev = kind === "lastev" || kind === "prevev", u = ev ? "events" : "rounds"; return { id: `windows:${kind}:${n}`, name: kind.startsWith("last") ? `Last ${n} ${u}` : `The ${n} ${u} before that`, f: windowFilter(`${kind}:${n}`), mode: "windows", values: [`${kind}:${n}`] }; };
  const editable = (sel) => !!(winOf(sel) || membersOf(sel) || sel.f?.clubs?.length || sel.f?.balls?.length);
  function openWindowEdit(id) {
    const sel = sels.find((s0) => s0.id === id), w = winOf(sel);
    if (!w) return;
    const [kind, n0] = w, ev = kind === "lastev" || kind === "prevev", unit = ev ? "events" : "rounds";
    const twin = kind.startsWith("last") ? kind.replace("last", "prev") : kind.replace("prev", "last");
    const pair = sels.find((s0) => { const w2 = winOf(s0); return w2 && w2[0] === twin && w2[1] === n0; });
    const have = ev ? opts.events : opts.total;
    const inp = el("input", { type: "number", min: 1, max: 999, class: "cmp-own-n cmp-win-n", value: String(n0), "aria-label": `How many ${unit}` });
    const both = pair ? el("input", { type: "checkbox", checked: true }) : null;
    const quick = [5, 10, 12, 20, 40].filter((q) => (kind.startsWith("last") ? q <= have : 2 * q <= have)).map((q) => { const b = el("button", { type: "button", class: `cmp-chip small${q === n0 ? " on" : ""}` }, String(q)); b.addEventListener("click", () => { inp.value = String(q); }); return b; });
    const save = el("button", { type: "button", class: "btn cmp-add" }, "Save");
    const cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Change the window" }, el("div", { class: "gx-pop wl-pop cmp-rd-pop cmp-win-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Change the window"), el("h2", {}, [el("i", { class: "cmp-dot", style: `--c:${sel.color}` }), sel.name]), el("p", { class: "gx-sub" }, `They have ${have} ${unit} here.`)]), close]),
      el("div", { class: "wl-pop-body cmp-ge" }, [
        el("label", { class: "cmp-field" }, [el("span", {}, kind.startsWith("last") ? `Last` : "The"), inp, el("span", {}, kind.startsWith("last") ? unit : `${unit} before that`)]),
        el("div", { class: "cmp-chips" }, quick),
        pair ? el("label", { class: "cmp-combine" }, [both, el("span", {}, `Change \u201c${pair.name}\u201d to match`)]) : null,
        el("div", { class: "cmp-guide-row" }, [save, cancel]),
      ])]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); if (e.key === "Enter" && e.target === inp) save.click(); };
    close.addEventListener("click", shut); cancel.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    save.addEventListener("click", () => {
      const n = Math.round(Number(inp.value));
      if (!n || n < 1) { inp.focus(); return; }
      const chg = both?.checked && pair;
      if (kind.startsWith("last") ? n > have : 2 * n > have) { flashNote(`They have ${have} ${unit} here.`); return; }
      if (chg && 2 * n > have) { flashNote(`Only ${have} ${unit} here: ${Math.floor(have / 2)} at most, so there are that many before them.`); return; }
      shut();
      sels = sels.map((s0) => (s0.id === id ? { ...s0, ...winSel(kind, n) } : chg && s0.id === pair.id ? { ...s0, ...winSel(twin, n) } : s0));
      touched = true; draw();
    });
    document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll"); document.body.appendChild(overlay); inp.focus(); inp.select();
  }
  function insideSection(items) {
    const live = items.filter((it) => it.s.n);
    const groups = live.map((it) => ({ it, sel: sels.find((s0) => s0.id === (it.base || it.id)) })).map((x) => ({ ...x, mem: membersOf(x.sel) })).filter((x) => x.mem);
    if (!groups.length) return null;
    const inc = incNow();
    const topBest = Math.max(...live.map((it) => it.s.sg.TOTAL));
    const blocks = groups.map(({ it, sel, mem }) => {
      const rows = mem.map((m) => { const rs = includeShots(roundsFor(roundsOf(it), m.f), inc); return { m, s: summarize(rs) }; }).filter((r) => r.s.n).sort((a, b) => b.s.sg.TOTAL - a.s.sg.TOTAL);
      if (!rows.length) return null;
      const g0 = it.s.sg.TOTAL, max = Math.max(0.05, ...rows.map((r) => Math.abs(r.s.sg.TOTAL - g0)));
      const below = rows.filter((r) => r.s.sg.TOTAL < g0 - 0.005).length;
      const star = rows[0].s.sg.TOTAL > topBest + 1e-9 && live.length > 1 ? rows[0] : null;
      const say = `${rows.length > 1 ? `${rows.length - below} of ${rows.length} above the group\u2019s ${fmtSG(g0)}; ` : ""}best: **${rows[0].m.name}** (${fmtSG(rows[0].s.sg.TOTAL)}, ${rows[0].s.n} rds)${rows.length > 1 ? `, worst: **${rows.at(-1).m.name}** (${fmtSG(rows.at(-1).s.sg.TOTAL)})` : ""}.${star ? ` **${star.m.name} on its own beats every selection here.**` : ""}`;
      const md = (t) => t.split(/\*\*/).map((p0, i) => (i % 2 ? el("strong", {}, p0) : p0));
      const drop = (m) => { const b = el("button", { type: "button", class: "cmp-in-drop", title: `Take ${m.name} out of this group` }, "\u2715"); b.addEventListener("click", (e) => { e.stopPropagation(); setMembers(sel.id, mem.filter((x) => x.key !== m.key)); }); return b; };
      return el("div", { class: "cmp-in-g" }, [
        el("div", { class: "cmp-in-h" }, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), el("strong", {}, it.name), el("span", { class: "muted small" }, ` \u00b7 ${fmtSG(g0)} a round together \u00b7 ${it.s.n} rds`), (() => { const b = el("button", { type: "button", class: "link small" }, "Edit group"); b.addEventListener("click", () => openGroupEdit(sel.id)); return b; })()]),
        el("p", { class: "muted small cmp-in-say" }, md(say)),
        el("div", { class: "cmp-conds" }, rows.map((r) => {
          const d = r.s.sg.TOTAL - g0, w = Math.abs(d) / max * 50;
          return el("div", { class: `cmp-cond cmp-in-row${r === star ? " star" : ""}` }, [
            el("span", { class: "cmp-cond-l" }, [r.m.name, el("span", { class: "muted" }, ` \u00b7 ${r.s.n} rd${r.s.n === 1 ? "" : "s"}`), r.s.n < FEW ? el("span", { class: "cmp-few-mark", title: "Only a few rounds" }, " *") : null]),
            el("span", { class: "cmp-cond-bar" }, [el("span", { class: "mid" }), el("span", { class: `b ${d >= 0 ? "pos" : "neg"}`, style: d >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` })]),
            el("strong", { class: `cmp-cond-v ${tone(r.s.sg.TOTAL)}` }, fmtSG(r.s.sg.TOTAL)),
            el("span", { class: `cmp-cond-d ${tone(d)}` }, fmtSigned(d)),
            mem.length > 1 ? drop(r.m) : el("span"),
          ]);
        })),
      ]);
    }).filter(Boolean);
    if (!blocks.length) return null;
    return el("section", { class: "panel cmp-sec cmp-inside" }, [
      el("div", { class: "cmp-sec-head" }, [el("h2", {}, "Inside the groups"), el("p", { class: "muted small" }, "Each model (or ball, season or pick) in a group on its own: strokes gained a round, and how far above or below the group as a whole. \u2715 takes one out of the group; Edit group adds more.")]),
      ...blocks,
    ]);
  }
  // a group's parts changed: its filter, and its name when the name was made for it
  function setMembers(id, mem, extra = {}) {
    const sel = sels.find((s0) => s0.id === id);
    if (!sel || !mem.length) { flashNote("A group needs at least one."); return; }
    const f0 = sel.f || {};
    let f;
    if (f0.any?.length > 1 || mem[0].key.startsWith("any:")) f = mem.length === 1 ? mem[0].f : { any: mem.map((m) => m.f) };
    else if (mem[0].key.startsWith("y:")) f = { ...f0, years: mem.map((m) => m.key.slice(2)) };
    else if (f0.clubs?.length && !(f0.balls?.length > 1 && f0.clubs.length === 1)) f = { ...f0, clubs: mem.map((m) => m.key) };
    else f = { ...f0, balls: mem.map((m) => m.key) };
    Object.assign(f, extra.f || {});
    if (f.years && !f.years.length) delete f.years;
    const yrsTxt = (ys) => { const n = ys.map(Number).sort((a, b) => a - b); return n.length > 1 && n.every((v, i) => !i || v === n[i - 1] + 1) ? `${n[0]}\u2013${n.at(-1)}` : n.join(" + "); };
    const auto = extra.name || (sel.custom ? sel.name : `${mem.length <= 3 ? mem.map((m) => m.name.replace(/ \u00b7 .*$/, "")).join(" + ") : `${sel.name.replace(/ \u00b7 [\d\u2013+ ]+$/, "").replace(/ \(edited\)$/, "")} (edited)`}${f.years?.length && !mem[0].key.startsWith("y:") ? ` \u00b7 ${yrsTxt(f.years)}` : ""}`);
    sels = sels.map((s0) => (s0.id === id ? { ...s0, f, name: auto, full: auto, custom: !!extra.name || s0.custom, parts: f.any ? mem.map((m) => ({ name: m.name, f: m.f })) : null, values: f.clubs || f.balls || s0.values } : s0));
    touched = true; draw();
  }
  // the editor: what's in the group (untick to drop), what else of the same kind there is (tap to add), the seasons
  function openGroupEdit(id) {
    const sel = sels.find((s0) => s0.id === id);
    if (!sel) return;
    const f0 = sel.f || {};
    const mem0 = membersOf(sel) || (f0.clubs?.length ? f0.clubs.map((v) => ({ key: v, name: gearName(v), f: { ...f0, clubs: [v] } })) : f0.balls?.length ? f0.balls.map((v) => ({ key: v, name: gearName(v), f: { ...f0, balls: [v] } })) : []);
    const byClubs = mem0.length && !mem0[0].key.startsWith("any:") && !mem0[0].key.startsWith("y:") && (f0.clubs?.length && !(f0.balls?.length > 1 && f0.clubs.length === 1));
    const byBalls = mem0.length && !byClubs && !mem0[0].key.startsWith("any:") && !mem0[0].key.startsWith("y:");
    const keep = new Set(mem0.map((m) => m.key)), added = new Map();
    const yrs = new Set(f0.years || []);
    let name = sel.name, q = "";
    // the other models of the same kind(s), with this group's other settings (seasons, ball)
    const cat = products(allRounds());
    const kinds = byClubs ? cat.filter((k) => k.items.some((o) => mem0.some((m) => m.key === o.value))) : byBalls ? cat.filter((k) => k.group === "Ball") : [];
    const pool = kinds.flatMap((k) => k.items).filter((o) => !mem0.some((m) => m.key === o.value));
    const body = el("div", { class: "wl-pop-body cmp-ge" });
    const paint = () => {
      const chip = (on, label, n, click) => { const b = el("button", { type: "button", class: `cmp-chip${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, label, n != null ? el("span", { class: "cmp-chip-n" }, `${n} rds`) : null]); b.addEventListener("click", click); return b; };
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const more = pool.filter((o) => words.every((w) => `${o.label} ${o.value}`.toLowerCase().includes(w)));
      const nameIn = el("input", { type: "text", class: "cmp-name", value: name, maxLength: 60, "aria-label": "Name" });
      nameIn.addEventListener("input", () => { name = nameIn.value; });
      const search = pool.length > 8 ? el("input", { type: "search", class: "cmp-chip-search cmp-ge-q", placeholder: "Find a model\u2026", value: q }) : null;
      search?.addEventListener("input", () => { const pos = search.selectionStart; q = search.value; paint(); const a = body.querySelector(".cmp-ge-q"); if (a) { a.focus(); try { a.setSelectionRange(pos, pos); } catch {} } });
      mount(body, [
        el("label", { class: "cmp-field" }, [el("span", {}, "Name"), nameIn]),
        el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, "In this group (tap to take one out)"), el("div", { class: "cmp-chips" }, mem0.map((m) => chip(keep.has(m.key), m.name, null, () => { keep.has(m.key) ? keep.delete(m.key) : keep.add(m.key); paint(); })))]),
        pool.length ? el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, `Add more ${byBalls ? "balls" : kinds.length === 1 ? groupName(kinds[0].group).toLowerCase() : "clubs"}`), search, el("div", { class: "cmp-chips" }, more.map((o) => chip(added.has(o.value), o.label, o.n, () => { added.has(o.value) ? added.delete(o.value) : added.set(o.value, o.label); paint(); })))]) : null,
        (byClubs || byBalls) && opts.years.length > 1 ? el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, "Seasons (none = any season)"), el("div", { class: "cmp-chips" }, opts.years.map((y) => chip(yrs.has(y.value), y.label, null, () => { yrs.has(y.value) ? yrs.delete(y.value) : yrs.add(y.value); paint(); })))]) : null,
        el("div", { class: "cmp-guide-row" }, [save, cancel]),
      ]);
    };
    const save = el("button", { type: "button", class: "btn cmp-add" }, "Save the group");
    const cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Edit the group" }, el("div", { class: "gx-pop wl-pop cmp-rd-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Edit the group"), el("h2", {}, [el("i", { class: "cmp-dot", style: `--c:${sel.color}` }), sel.name]), el("p", { class: "gx-sub" }, "Take some out, add more of the same kind, or change the seasons. Everything on the page updates.")]), close]),
      body]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut); cancel.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    save.addEventListener("click", () => {
      const mem = [...mem0.filter((m) => keep.has(m.key)), ...[...added].map(([v, l]) => ({ key: v, name: gearName(v) || l, f: byBalls ? { ...f0, balls: [v] } : { ...f0, clubs: [v] } }))];
      if (!mem.length) { flashNote("A group needs at least one."); return; }
      const yearsF = byClubs || byBalls ? { years: [...yrs].sort() } : {};
      const named = name.trim() && name.trim() !== sel.name ? name.trim() : null;
      shut();
      setMembers(id, mem, { f: yearsF, name: named });
    });
    paint();
    document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll"); document.body.appendChild(overlay); close.focus();
  }
  function selectedBar(items) {
    const clear = el("button", { type: "button", class: "link cmp-clear" }, "Clear all");
    clear.addEventListener("click", backToStart);
    for (const id of [...joinPick]) if (!sels.some((s) => s.id === id)) joinPick.delete(id);
    const joinB = joinPick.size >= 2 ? el("button", { type: "button", class: "btn small cmp-join" }, `Combine these ${joinPick.size}`) : null;
    joinB?.addEventListener("click", combineSels);
    const hint = sels.length >= 2 ? el("span", { class: "muted small cmp-join-hint" }, joinPick.size ? (joinPick.size === 1 ? "Tap another to combine them" : "") : "Tap two or more to combine them") : null;
    return el("div", { class: "cmp-selbar" }, [...items.map((it) => {
      const x = el("button", { type: "button", class: "cmp-key-x", "aria-label": it.base ? `Remove ${sels.find((s) => s.id === it.base)?.name} (for every player)` : `Remove ${it.name}` }, "\u2715");
      x.addEventListener("click", () => { sels = sels.filter((s) => s.id !== (it.base || it.id)); touched = true; if (!sels.length) backToStart(); else draw(); });
      const sid = it.base || it.id, on = joinPick.has(sid);
      // (update 246) a group (several models, balls, seasons or picks): open it to drop some or add more
      const selNow = sels.find((s0) => s0.id === sid);
      const ed = selNow && editable(selNow) ? el("button", { type: "button", class: "cmp-key-ed", title: winOf(selNow) ? "Change how many" : "Open this group: drop some, add more", "aria-label": `Edit ${selNow.name}` }, "\u270e") : null;
      ed?.addEventListener("click", (e) => { e.stopPropagation(); if (winOf(selNow)) openWindowEdit(sid); else openGroupEdit(sid); });
      const key = el("span", { class: `cmp-key cmp-key-pick${on ? " picked" : ""}`, style: `--c:${it.color}`, title: `${it.full || it.name} (tap to pick it for combining)`, role: "button", tabindex: "0", "aria-pressed": String(on) }, [el("i", { "aria-hidden": "true" }), on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, el("span", {}, it.name), el("span", { class: "cmp-key-n" }, `${it.s.n}`), x]);
      if (ed) key.insertBefore(ed, key.querySelector(".cmp-key-x"));
      const flip = (e) => { if (e.target.closest(".cmp-key-x") || e.target.closest(".cmp-key-ed")) return; on ? joinPick.delete(sid) : joinPick.add(sid); draw(); };
      key.addEventListener("click", flip); key.addEventListener("keydown", (e) => { if (e.key === "Enter") flip(e); });
      return hoverable(key, it.i);
    }), joinB, hint, clear]);
  }
  const hoverable = (node, i) => { node.addEventListener("mouseenter", () => { root.dataset.hl = String(i); }); node.addEventListener("mouseleave", () => { delete root.dataset.hl; }); return node; };

  /* ------------------------------ results ------------------------------ */
  // (update 194) a category no selection has any strokes gained in (a driver's Approach, say) isn't shown anywhere
  const used1 = (items) => { const u = usedCats(items); return u.length === 1 ? u[0][1] : "Total"; };
  const usedCats = (items) => CATEGORIES.filter(([k]) => items.some((it) => it.s.n && Math.abs(it.s.sg[k] || 0) >= 0.005));
  // the rows of strokes gained worth showing: with one category, just it (Total and Tee to Green would only repeat it)
  const sgRowsFor = (items) => {
    const used = usedCats(items);
    if (used.length <= 1) return used.length ? SG_ROWS.filter(([k]) => k === used[0][0]) : SG_ROWS.slice(0, 1);
    const putt = used.some(([k]) => k === "PUTT"), t2g = used.filter(([k]) => k !== "PUTT").length;
    return SG_ROWS.filter(([k]) => k === "TOTAL" || used.some(([u]) => u === k) || (k === "T2G" && putt && t2g > 1));
  };
  // (update 215) comparing time frames (seasons, last 10 against the 10 before, dates of your own)
  const timeMode = () => ["years", "windows", "custom"].includes(mode);
  function cards(items0) {
    const used = usedCats(items0);
    const head = used.length === 1 ? used[0] : ["TOTAL", "Total"];
    // (update 215) time frames: best to worst, by the number shown big
    const items = timeMode() ? [...items0].sort((a, b) => (b.s.n ? b.s.sg[head[0]] ?? -99 : -99) - (a.s.n ? a.s.sg[head[0]] ?? -99 : -99)) : items0;
    // (update 221) two or more: the leaderboard above has each one (tap it for its card and tournaments); here, the Verdict
    if (items.filter((it) => it.s.n).length >= 2) return el("section", { class: "cmp-cards cmp-cards-verdict" }, compCard(items, head));
    return el("section", { class: "cmp-cards" }, items.map((it) => hoverable(tapCard(el("article", { class: "panel cmp-card", style: `--c:${it.color}`, "data-s": it.i }, [
      ...cardBody(it, used, head),
      it.s.n ? el("p", { class: "cmp-card-tap" }, "Tap for the tournaments \u203a") : null,
    ]), it), it.i)));
  }
  // a selection's card: its rounds, SG a round (and by category), best and worst
  function cardBody(it, used, head) {
    return [
      el("div", { class: "cmp-card-top" }, [el("span", { class: "cmp-card-name" }, it.name)]),
      it.s.n ? el("p", { class: "cmp-card-meta" }, `${it.s.n.toLocaleString()} round${it.s.n === 1 ? "" : "s"} \u00b7 ${it.s.events} event${it.s.events === 1 ? "" : "s"} \u00b7 ${dateTxt(it.s.from)} \u2013 ${dateTxt(it.s.to)}`) : el("p", { class: "cmp-card-meta" }, "No rounds"),
      // (update 210) a small sample says so, so 3 rounds isn't read like 60
      it.s.n && it.s.n < FEW ? el("p", { class: "cmp-few" }, `Only ${it.s.n} round${it.s.n === 1 ? "" : "s"}: read with care.`) : null,
      el("div", { class: "cmp-card-big" }, [el("strong", { class: tone(it.s.sg.TOTAL) }, it.s.n ? fmtSG(it.s.sg.TOTAL) : "\u2014"), el("span", {}, `SG: ${head[1]} a round`)]),
      used.length > 1 ? el("div", { class: "cmp-card-cats", style: `grid-template-columns:repeat(${used.length},1fr)` }, used.map(([k]) => el("div", {}, [el("span", {}, k), el("strong", { class: tone(it.s.sg[k]) }, it.s.n ? fmtSG(it.s.sg[k]) : "\u2014")]))) : null,
      it.s.n >= 2 ? el("p", { class: "cmp-card-foot" }, `Best ${fmtSG(it.s.best)} \u00b7 worst ${fmtSG(it.s.worst)} \u00b7 ${Math.round(it.s.gaining * 100)}% of rounds gaining`) : null,
    ];
  }
  // (update 218) the "Comparison" card: how far apart they are (the best against each of the others), and why
  function compCard(items0, head) {
    const live = items0.filter((it) => it.s.n);
    if (live.length < 2) return [];
    const k = head[0], items = [...live].sort((a, b) => (b.s.sg[k] ?? -99) - (a.s.sg[k] ?? -99));
    const top = items[0], rest = items.slice(1);
    const cats = CATEGORIES.filter(([c]) => items.some((it) => Math.abs(it.s.sg[c] || 0) >= 0.005));
    const gap = (a, b, c) => (a.s.sg[c] ?? 0) - (b.s.sg[c] ?? 0);
    // (update 221) the Verdict: which one is best, in big letters, and by how much
    const close = Math.abs(gap(top, rest[0], k)) < 0.05;
    const node = el("article", { class: "panel cmp-card cmp-card-comp cmp-tap", tabindex: "0", role: "button", "aria-haspopup": "dialog", style: `--c:${top.color}` }, [
      el("div", { class: "cmp-card-top" }, [el("span", { class: "cmp-card-name" }, "Verdict")]),
      el("p", { class: "cmp-verdict-win" }, [el("span", { class: "cmp-verdict-trophy", "aria-hidden": "true" }, "\ud83c\udfc6 "), el("i", { class: "cmp-dot", style: `--c:${top.color}` }), top.name]),
      el("p", { class: "cmp-verdict-sub" }, close ? `is best, but only just: ${fmtSigned(gap(top, rest[0], k))} a round ahead of ${rest[0].name}.` : rest.length === 1 ? `is better, by ${gap(top, rest[0], k).toFixed(2)} strokes a round (SG: ${head[1]}).` : `is the best of ${items.length}.`),
      ...(rest.length === 1 ? [cats.length > 1 ? el("div", { class: "cmp-card-cats", style: `grid-template-columns:repeat(${cats.length},1fr)` }, cats.map(([c]) => el("div", {}, [el("span", {}, c), el("strong", { class: tone(gap(top, b0(), c)) }, fmtSigned(gap(top, b0(), c)))]))) : null]
        : rest.slice(0, 4).map((b) => el("p", { class: "cmp-verdict-row" }, [el("i", { class: "cmp-dot", style: `--c:${b.color}` }), b.name, el("strong", { class: tone(-gap(top, b, k)) }, ` ${gap(top, b, k).toFixed(2)} behind`)]))),
      rest.length > 4 ? el("p", { class: "muted small" }, `+ ${rest.length - 4} more`) : null,
      rest.length === 1 ? el("p", { class: "cmp-verdict-fit" }, fitStory(top, rest[0]).sum) : null, // (update 234)
      el("p", { class: "muted small cmp-verdict-sure" }, sureWords(top.s.rounds, rest.at(-1).s.rounds)), // (update 222: how sure)
      el("p", { class: "cmp-card-tap" }, "Tap for why \u203a"),
    ]);
    function b0() { return rest[0]; }
    const go = () => openWhy(top, rest);
    node.addEventListener("click", go); node.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return [node];
  }
  /* (update 234) is the winner unusually good, or the other unusually bad? Each one against that player's usual
     (their average over every round here, over the same parts of the game), so "better at A than B" says whether
     A is a strength, B a weak spot, or both. */
  /* (update 240) a club or ball against the average one of its kind: a driver against every driver (everyone's, or
     the player's own: "their average driver"), a putter against every putter, a ball against every ball. Counted the
     same way as the pick: only those shots, in the rounds they were used. */
  const KIND_WORD = { Driver: "driver", "Non-Driver": "non-driver tee club", "Fairway Wood": "fairway wood", Hybrid: "hybrid", Iron: "iron", Wedge: "wedge", Putter: "putter", Ball: "ball", Other: "club" };
  const baseMemo = new WeakMap(); // (each player's rounds → kind → the average)
  const prodBase = (it) => {
    const f = it.f || {};
    if (!f.clubs?.length && !f.balls?.length) return null;
    const kinds = f.clubs?.length ? [...new Set(it.rs.flatMap((rd) => rd.shots.map((x) => x.clubCat)).filter(Boolean))].sort() : [];
    const ball = !f.clubs?.length || !!f.balls?.length;
    if (f.clubs?.length && !kinds.length) return null;
    const pk = it.pk || inPlay()[0]?.key, key = `${kinds.join(",")}|${ball}`, rsK = roundsOfKey(pk);
    const memo = baseMemo.get(rsK) || (baseMemo.set(rsK, new Map()), baseMemo.get(rsK));
    if (!memo.has(key)) {
      const ks = new Set(kinds), hit = (x) => (!ks.size || ks.has(x.clubCat)) && (!ball || !!x.ball);
      let t = 0, n = 0;
      for (const rd of sgRounds(rsK)) { let sum = 0, any = false; for (const x of rd.shots) if (hit(x)) { sum += x.sg; any = true; } if (any) { t += sum; n++; } }
      const word = kinds.length === 1 ? KIND_WORD[kinds[0]] || "club" : kinds.length ? "club of the same kind" : "ball";
      memo.set(key, { v: n ? t / n : 0, label: `${pk === EVERY ? "the" : "their"} average ${word}${kinds.length && ball ? ` (with any ball)` : ""}` });
    }
    return memo.get(key);
  };
  const usualOf = (it) => {
    const pb0 = prodBase(it);
    if (pb0) return pb0.v;
    const pk = it.pk || inPlay()[0]?.key, cs = [...new Set(it.rs.flatMap((rd) => rd.shots.map((x) => x.cat)))];
    const rs = sgRounds(roundsOfKey(pk)), all4 = cs.length >= 4;
    return rs.length ? rs.reduce((t, rd) => t + (all4 ? rdSG(rd, "TOTAL") : cs.reduce((u, c) => u + rdSG(rd, c), 0)), 0) / rs.length : 0;
  };
  const BAND = 0.2; // within 0.2 a round of their usual: about their usual
  function fitStory(a, b) {
    const ua = usualOf(a), ub = usualOf(b), va = a.s.sg.TOTAL, vb = b.s.sg.TOTAL, da = va - ua, db = vb - ub;
    const same = (a.pk || "") === (b.pk || "");
    const ref = prodBase(a)?.label || "their usual"; // (update 240: a club or ball against the average one of its kind)
    const vs = (d) => (Math.abs(d) < BAND ? `about ${ref}` : `${Math.abs(d).toFixed(2)} ${d > 0 ? "better" : "worse"} than ${ref}`);
    const line = (it, v, d, u) => `${it.name}: ${fmtSigned(v)} a round, ${vs(d)}${same ? "" : ` (${fmtSigned(u)})`}.`;
    const up = (d) => d >= BAND, down = (d) => d <= -BAND;
    const sum = up(da) && down(db) ? `So it\u2019s both: ${a.name} is better than usual and ${b.name} is worse.`
      : up(da) && up(db) ? `Both are better than usual; ${a.name} is just more so.`
      : down(da) && down(db) ? `Both are worse than usual; ${b.name} is just more so.`
      : up(da) ? `So the gap is ${a.name} being unusually good, not ${b.name} being bad.`
      : down(db) ? `So the gap is ${b.name} being unusually bad, not ${a.name} being especially good.`
      : `Both are about ${ref}, so neither stands out much on its own.`;
    return { lines: [line(a, va, da, ua), line(b, vb, db, ub)], sum, usual: same ? ua : null, ref };
  }
  const cut = (t) => (t.length > 16 ? `${t.slice(0, 15).trim()}\u2026` : t);
  // (update 240) two clubs or balls: the Why goes deep on their part of the game only
  const deepFor = (a, b) => {
    if (!prodBase(a) || !prodBase(b)) return null;
    const cats = new Set([...a.rs, ...b.rs].flatMap((rd) => rd.shots.map((x) => x.cat)).filter(Boolean));
    if (!cats.size || cats.size >= 4) return null;
    const ob = (it) => includeShots(statSets(roundsOf(it), [it.f])[0] || [], null);
    return { cats, obsA: ob(a), obsB: ob(b) };
  };
  function openWhy(top, rest) {
    const say = (b) => (lead) => `Mostly ${lead.l}: ${top.name} ${lead.d >= 0 ? "gains" : "loses"} ${Math.abs(lead.d).toFixed(2)} a round ${lead.d >= 0 ? "more than" : "against"} ${b.name}.`;
    // (update 221) the columns are A and B (each with its colour); their full names are spelled out above
    const tag = (it, L) => el("span", { class: "cmp-why-tag" }, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), L]);
    const blocks = rest.map((b) => el("div", { class: "wl-pop-block" }, [
      el("div", { class: "cmp-why-key" }, [el("p", {}, [tag(top, "A"), " ", el("strong", {}, top.name), el("span", { class: "muted" }, ` \u00b7 ${fmtSG(top.s.sg.TOTAL)} a round`)]), el("p", {}, [tag(b, "B"), " ", el("strong", {}, b.name), el("span", { class: "muted" }, ` \u00b7 ${fmtSG(b.s.sg.TOTAL)} a round`)])]),
      (() => { const f = fitStory(top, b); return el("div", { class: "cmp-fit" }, [el("p", { class: "cmp-why-h" }, [el("strong", {}, "Strength or weak spot? "), f.sum]), el("ul", { class: "cmp-fit-l" }, f.lines.map((t) => el("li", {}, t))), f.usual != null ? el("p", { class: "muted small" }, (f.ref === "their usual" ? `Their usual: ${fmtSigned(f.usual)} a round over every round here.` : `${f.ref.charAt(0).toUpperCase()}${f.ref.slice(1)}: ${fmtSigned(f.usual)} a round.`) + ` Within ${BAND.toFixed(2)} of it counts as about the same.`) : el("p", { class: "muted small" }, `Each against their own usual (in brackets): their average over every round here.`)]); })(),
      whyCore(top.rs, b.rs, () => tag(top, "A"), () => tag(b, "B"), say(b), true, deepFor(top, b))]));
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Comparison" }, el("div", { class: "gx-pop wl-pop cmp-rd-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Verdict"), el("h2", {}, `Why ${top.name} is best`), el("p", { class: "gx-sub" }, "Where the difference comes from: strokes gained in each part of the game, and the stats behind it.")]), close]),
      el("div", { class: "wl-pop-body" }, blocks)]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll"); document.body.appendChild(overlay); close.focus();
  }
  // (update 215) a card opens its rounds: tournament by tournament, and each one opens to its rounds
  const rdSG = (rd, k) => rd.shots.reduce((t, s) => t + (k === "TOTAL" || s.cat === k ? s.sg : 0), 0);
  const SGK = [["TOTAL", "Total"], ["OTT", "OTT"], ["APP", "APP"], ["ARG", "ARG"], ["PUTT", "PUTT"]];
  function tapCard(node, it) {
    if (!it.s.n) return node;
    node.classList.add("cmp-tap"); node.tabIndex = 0; node.setAttribute("role", "button"); node.setAttribute("aria-haspopup", "dialog");
    const go = () => openRounds(it);
    node.addEventListener("click", go); node.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return node;
  }
  function openRounds(it) {
    const rs = [...it.rs].filter((rd) => rd.shots?.length).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const evs = new Map();
    const pk0 = it.pk || inPlay()[0]?.key;
    for (const rd of rs) { const k = `${rd.pk || ""}|${rd.event || "\u2014"}|${rd.year || String(rd.date || "").slice(0, 4)}`; (evs.get(k) || evs.set(k, { event: rd.event || "\u2014", pk: rd.pk || pk0, rounds: [] }).get(k)).rounds.push(rd); }
    const hasFin = finishes.size > 0;
    const SGKs = SGK.filter(([k]) => k === "TOTAL" || rs.some((rd) => rd.shots.some((x) => x.cat === k))); // (update 221)
    const multiP = new Set(list0().map((e) => e.pk)).size > 1, namesP = new Map(players), nameOfP = (k) => namesP.get(k) || String(k || "").replace(/^c_/, "");
    function list0() { return [...evs.values()]; }
    const list = [...evs.values()].reverse(); // (latest first)
    const open = new Set();
    let all = false;
    const avg = (xs, k) => xs.reduce((t, rd) => t + rdSG(rd, k), 0) / xs.length;
    const td = (v, strong) => el("td", { class: `num ${tone(v)}${strong ? " strong" : ""}` }, fmtSG(v));
    const body = el("div", { class: "wl-pop-body" });
    const allB = el("button", { type: "button", class: "btn ghost small" }, "Show every round");
    const paint = () => {
      allB.textContent = all ? "Tournaments only" : "Show every round";
      const rows = [];
      for (const [i, e] of list.entries()) {
        const on = all || open.has(i);
        const tr = el("tr", { class: `cmp-ev-row cmp-tap${on ? " on" : ""}`, tabindex: "0", title: on ? "Hide its rounds" : "Show its rounds" }, [
          el("td", {}, [el("span", { class: "cmp-ev-caret", "aria-hidden": "true" }, on ? "\u25be " : "\u25b8 "), e.event, el("span", { class: "muted cmp-ev-date" }, [dateTxt(e.rounds.at(-1).date), pk0 === EVERY || multiP ? ` \u00b7 ${nameOfP(e.pk)}` : ""])]),
          el("td", { class: "num" }, String(e.rounds.length)), hasFin ? el("td", { class: `num cmp-fin${finishOf(e.pk, e.rounds[0]) === "MC" ? " mc" : ""}` }, finishOf(e.pk, e.rounds[0])) : null, ...SGKs.map(([k]) => td(avg(e.rounds, k), k === "TOTAL"))]);
        const flip = () => { if (all) { all = false; list.forEach((_, j) => open.add(j)); } open.has(i) ? open.delete(i) : open.add(i); paint(); };
        tr.addEventListener("click", flip); tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") flip(); });
        rows.push(tr);
        if (on) for (const rd of e.rounds) rows.push(el("tr", { class: "cmp-rd-row" }, [el("td", {}, [rd.roundNo ? `Round ${rd.roundNo}` : "Round", el("span", { class: "cmp-ev-date" }, dateTxt(rd.date))]), el("td", { class: "num muted" }, ""), hasFin ? el("td", {}, "") : null, ...SGKs.map(([k]) => td(rdSG(rd, k), k === "TOTAL"))]));
      }
      mount(body, el("div", { class: "wl-pop-tw" }, el("table", { class: "wl-pop-table cmp-ev-table" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Tournament"), el("th", { class: "num" }, "Rds"), hasFin ? el("th", { class: "num", title: "Finish: by SG: Total among those who played every round; MC = fewer rounds (missed the cut)" }, "Fin") : null, ...SGKs.map(([, l]) => el("th", { class: "num" }, l))])),
        el("tbody", {}, rows),
      ])));
    };
    allB.addEventListener("click", () => { all = !all; if (!all) open.clear(); paint(); });
    paint();
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": it.name }, el("div", { class: "gx-pop wl-pop cmp-rd-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, `${it.s.n} round${it.s.n === 1 ? "" : "s"} \u00b7 ${list.length} tournament${list.length === 1 ? "" : "s"}`), el("h2", {}, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.name]),
        el("p", { class: "gx-sub" }, "Strokes gained a round at each tournament, latest first. Tap one to see its rounds.")]), close]),
      el("div", { class: "cmp-pop-card", style: `--c:${it.color}` }, cardBody(it, usedCats([it]), (() => { const u = usedCats([it]); return u.length === 1 ? u[0] : ["TOTAL", "Total"]; })()).slice(1)), // (update 221: its card)
      el("div", { class: "cmp-rd-acts" }, allB), body]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll"); document.body.appendChild(overlay); close.focus();
  }
  // (update 215) time frames: every round in order, the ones being compared in their colour, each one's average dashed
  /* (update 216) where and when they play best: every course (tournament, month, round) across all their appearances,
     best first; tap one to see each visit (a tournament: every year there; a month: every tournament in it …) */
  const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const PLACE = [["tournaments", "Tournament", (rd) => rd.event || null], ["courses", "Course", (rd) => rd.course || null], ["months", "Month", (rd) => { const m = /^\d{4}-(\d{2})/.exec(String(rd.date || "")); return m ? MN[Number(m[1]) - 1] : null; }], ["rounds", "Round", (rd) => (rd.roundNo ? `Round ${rd.roundNo}` : null)],
    // (update 219) the season, and where it fell in a run of tournaments
    ["seasons", "Season", (rd) => yr(rd)], ["weeks", "Event week", (rd) => weekTag.get(`${rd.pk}|${evk(rd)}`) || null]];
  let weekTag = new Map(), placePick = new Set();
  const WEEKS = ["First event back", "2nd week in a row", "3rd+ week in a row"];
  // (update 217) why they play better (or worse) there: each part of the game, and the stats behind it, against their usual
  const WHY_STATS = ["drive", "fwy", "gir", "hitGreen", "prox", "scramble", "ud", "make", "goodLag", "putts"];
  function whyBox(x, all) {
    const per = (rds, k) => rds.reduce((t, rd) => t + rdSG(rd, k), 0) / rds.length;
    return whyCore(x.rds, all, "Here", "Usual", (lead, better) => `${better ? "Mostly" : "Mostly down to"} ${lead.l}: ${fmtSigned(lead.d)} a round ${lead.d >= 0 ? "better" : "worse"} than their usual here.`, x.v >= per(all, "TOTAL"));
  }
  // (update 218) the parts of the game, and the stats, of one set of rounds (a) against another (b)
  function whyCore(aRds, bRds, la, lb, say, better, deep = null) {
    const per = (rds, k) => rds.reduce((t, rd) => t + rdSG(rd, k), 0) / rds.length;
    const x = { rds: aRds }, all = bRds;
    const L = (v) => (typeof v === "function" ? v() : v); // (a label can be made fresh for each table)
    const good = (d, def) => (def.higher == null || Math.abs(d) < 1e-9 ? "" : (def.higher === false ? -d : d) > 0 ? "pos" : "neg");
    const dTxt = (d, def) => { const f = fmtStat({ ...def, pct: false, unit: def.pct ? " pct" : def.unit }, Math.abs(d)); return `${d > 0 ? "+" : d < 0 ? "\u2212" : ""}${f}`; };
    const head3 = (t) => el("thead", {}, el("tr", {}, [el("th", {}, t), el("th", { class: "num" }, L(la)), el("th", { class: "num" }, L(lb)), el("th", { class: "num" }, "Diff")]));
    if (deep) {
      /* (update 240) a club or ball against another: only its part of the game, as deep as the data goes. Strokes
         gained a round, a shot and shots a round; then by distance; then every stat of that part of the game, each
         at every distance (a putter: Made Putt % and Good Lag % from 3 feet, 10 feet, 30 feet …). */
      const cats = CATEGORIES.filter(([k]) => deep.cats.has(k));
      const shotsOf = (rds, k) => rds.reduce((t, rd) => t + rd.shots.reduce((u, s0) => u + (s0.cat === k ? s0.w || 1 : 0), 0), 0);
      const sumOf = (rds, k) => rds.reduce((t, rd) => t + rdSG(rd, k), 0);
      const prof = distanceProfile([aRds, bRds], "round"), profS = distanceProfile([aRds, bRds], "shot");
      const sgRows = [], dRows = [];
      for (const [k, l] of cats) {
        const a = per(aRds, k), b = per(bRds, k), na = shotsOf(aRds, k), nb = shotsOf(bRds, k);
        sgRows.push({ l: `${l}: a round`, a, b, d: a - b, strong: true });
        if (na && nb) { const sa = sumOf(aRds, k) / na, sb = sumOf(bRds, k) / nb; sgRows.push({ l: "A shot", a: sa, b: sb, d: sa - sb, f3: true, sub: true }); sgRows.push({ l: "Shots a round", a: na / aRds.length, b: nb / bRds.length, d: na / aRds.length - nb / bRds.length, plain: true, sub: true }); }
        for (const r of prof[k] || []) { const [ra, rb] = r.values; if (ra == null || rb == null) continue; const sr = (profS[k] || []).find((q) => q.dist === r.dist); dRows.push({ l: r.dist, a: ra, b: rb, d: ra - rb, sa: sr?.values[0], sb: sr?.values[1], cat: l }); }
      }
      const n3 = (v) => (v == null ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}`);
      const leadD = [...dRows].sort((p, q) => (better ? q.d - p.d : p.d - q.d))[0];
      const tot = sgRows.find((r) => r.strong);
      const why = !tot ? "" : leadD && Math.abs(leadD.d) >= 0.02 ? `${Math.abs(tot.d) < 0.02 ? "Level overall, but" : "Mostly"} from **${leadD.l}**: ${fmtSigned(leadD.d)} a round${leadD.sa != null && leadD.sb != null ? ` (${n3(leadD.sa - leadD.sb)} a shot)` : ""}.` : `No one distance stands out: it\u2019s a little from everywhere.`;
      const fmtR = (r, v) => (r.plain ? (v == null ? "\u2014" : v.toFixed(1)) : r.f3 ? n3(v) : fmtSG(v));
      const sgT = el("table", { class: "cmp-table cmp-why-t" }, [head3("Strokes gained"), el("tbody", {}, [
        ...sgRows.map((r) => el("tr", { class: `${r.strong ? "strong" : ""}${r.sub ? " cmp-sub" : ""}` }, [el("td", {}, r.l), el("td", { class: `num ${r.plain ? "" : tone(r.a)}` }, fmtR(r, r.a)), el("td", { class: "num muted" }, fmtR(r, r.b)), el("td", { class: `num ${r.plain ? "" : tone(r.d)}` }, r.plain ? (r.d >= 0 ? "+" : "\u2212") + Math.abs(r.d).toFixed(1) : r.f3 ? n3(r.d) : fmtSigned(r.d))])),
        ...(dRows.length ? [el("tr", { class: "cmp-grp" }, el("td", { colspan: 4 }, "By distance: a round (a shot)"))] : []),
        ...dRows.map((r) => el("tr", { class: `cmp-sub${r === leadD && Math.abs(r.d) >= 0.02 ? " strong" : ""}` }, [el("td", {}, r.l), el("td", { class: `num ${tone(r.a)}` }, [fmtSG(r.a), r.sa != null ? el("span", { class: "muted small" }, ` (${n3(r.sa)})`) : null]), el("td", { class: "num muted" }, [fmtSG(r.b), r.sb != null ? el("span", { class: "small" }, ` (${n3(r.sb)})`) : null]), el("td", { class: `num ${tone(r.d)}` }, fmtSigned(r.d))])),
      ])]);
      const blocks = statBlocks([deep.obsA || [], deep.obsB || []]).filter((bk) => deep.cats.has(bk.cat));
      const statT = blocks.length ? el("table", { class: "cmp-table cmp-why-t" }, [head3("Stats"), el("tbody", {}, blocks.flatMap((bk) => [
        ...(blocks.length > 1 ? [el("tr", { class: "cmp-grp" }, el("td", { colspan: 4 }, bk.label))] : []),
        ...bk.rows.filter((r) => r.values[0] != null || r.values[1] != null).map((r) => { const [a, b] = r.values, d = a != null && b != null ? a - b : null; return el("tr", { class: r.dist ? "cmp-sub" : "strong" }, [el("td", {}, r.dist ? r.dist : r.def.label), el("td", { class: "num" }, fmtStat(r.def, a)), el("td", { class: "num muted" }, fmtStat(r.def, b)), el("td", { class: `num ${d == null ? "" : good(d, r.def)}` }, d == null ? "\u2014" : dTxt(d, r.def))]); }),
      ]))]) : null;
      const md = (t) => t.split(/\*\*/).map((p0, i) => (i % 2 ? el("strong", {}, p0) : p0));
      return el("div", { class: "cmp-why" }, [
        el("p", { class: "cmp-why-h" }, [el("strong", {}, "Why? "), ...md(why)]),
        el("div", { class: "cmp-why-grid" }, [sgT, statT]),
      ]);
    }
    const cats = CATEGORIES.map(([k, l]) => ({ k, l, here: per(x.rds, k), usual: per(all, k) })).map((c) => ({ ...c, d: c.here - c.usual })).filter((c) => Math.abs(c.here) >= 0.005 || Math.abs(c.usual) >= 0.005); // (update 221: not a part of the game neither has)
    const lead = [...cats].sort((a, b) => (better ? b.d - a.d : a.d - b.d))[0];
    const agg = (rds, k) => { let s = 0, w = 0, s2 = 0, w2 = 0; for (const rd of rds) for (const o of rd.obs || []) { if (o.k !== k || o.v == null || !Number.isFinite(o.v)) continue; const ww = o.w || 1; if (!o.dist) { s += o.v * ww; w += ww; } else { s2 += o.v * ww; w2 += ww; } } return w ? s / w : w2 ? s2 / w2 : null; };
    const stats = WHY_STATS.map((k) => { const def = k === "gir" ? { ...statDef(k), label: "GIR %" } : statDef(k); const here = agg(x.rds, k), usual = agg(all, k); return here == null || usual == null ? null : { def, here, usual, d: here - usual }; }).filter(Boolean);
    const why = Math.abs(lead.d) < 0.05 ? `No one part of the game stands out: it\u2019s a little from everywhere.` : say(lead, better);
    return el("div", { class: "cmp-why" }, [
      el("p", { class: "cmp-why-h" }, [el("strong", {}, "Why? "), why]),
      el("div", { class: "cmp-why-grid" }, [
        el("table", { class: "cmp-table cmp-why-t" }, [head3("Strokes gained a round"),
          el("tbody", {}, cats.map((c) => el("tr", { class: c === lead && Math.abs(lead.d) >= 0.05 ? "strong" : "" }, [el("td", {}, c.l), el("td", { class: `num ${tone(c.here)}` }, fmtSG(c.here)), el("td", { class: "num muted" }, fmtSG(c.usual)), el("td", { class: `num ${tone(c.d)}` }, fmtSigned(c.d))])))]),
        stats.length ? el("table", { class: "cmp-table cmp-why-t" }, [head3("Stats"),
          el("tbody", {}, stats.map((st) => el("tr", {}, [el("td", {}, st.def.label), el("td", { class: "num" }, fmtStat(st.def, st.here)), el("td", { class: "num muted" }, fmtStat(st.def, st.usual)), el("td", { class: `num ${good(st.d, st.def)}` }, dTxt(st.d, st.def))])))]) : null,
      ]),
    ]);
  }
  // (update 219) the picked ones, side by side (every table and chart), as selections
  function placeBar(groups, dimL, order = [...groups.keys()]) {
    for (const k of [...placePick]) if (!groups.has(k)) placePick.delete(k);
    const n = placePick.size;
    const fOf = (k, rds) => ({ tournaments: { events: [...new Set(rds.map(evk))] }, weeks: { events: [...new Set(rds.map(evk))] }, courses: { courses: [k] }, months: { months: [String(MN.indexOf(k))] }, rounds: { roundNos: [k.replace("Round ", "")] }, seasons: { years: [k] } }[placeDim]);
    // (update 236) several of them as one: their filters merged (any of these courses / tournaments / months …)
    const merged = (keys) => { const f = {}; for (const k of keys) for (const [field, vs] of Object.entries(fOf(k, groups.get(k)))) f[field] = [...new Set([...(f[field] || []), ...vs])]; return f; };
    const plural = `${dimL.toLowerCase()}s`;
    const show = (list) => { backToPlace = placeDim; sels = list.map((x, i) => ({ mode: "filters", color: COLORS[i % COLORS.length], ...x })); mode = "filters"; placePick = new Set(); touched = true; g.open = false; draw(); root.querySelector(".cmp-cards")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
    const go = el("button", { type: "button", class: "btn cmp-add small", disabled: n >= 2 ? null : true }, n >= 2 ? `Compare these ${n} \u2192` : `Tick two or more numbers to compare them`);
    go.addEventListener("click", () => {
      const list = [...placePick].slice(0, Math.max(2, Math.floor(MAX_SEL / Math.max(1, inPlay().length))));
      show(list.map((k) => ({ id: `place:${placeDim}:${k}`, name: k, full: `${dimL}: ${k}`, f: fOf(k, groups.get(k)) })));
    });
    // (update 236) the ticked ones together against all the others ("my top 5 courses vs the rest")
    const restKeys = order.filter((k) => !placePick.has(k));
    const vsRest = n >= 1 && restKeys.length ? el("button", { type: "button", class: "btn cmp-add small ghost" }, `${n === 1 ? "This one" : `These ${n} together`} vs the rest \u2192`) : null;
    vsRest?.addEventListener("click", () => {
      const picked = order.filter((k) => placePick.has(k));
      const isTop = picked.every((k, i) => order[i] === k);
      const name = n === 1 ? picked[0] : isTop ? `Top ${n} ${plural}` : n <= 3 ? picked.join(" + ") : `${n} picked ${plural}`;
      show([
        { id: `place:${placeDim}:grp:${picked.join("+")}`, name, full: `${dimL}: ${picked.join(", ")}`, f: merged(picked) },
        { id: `place:${placeDim}:rest:${picked.join("+")}`, name: `Every other ${dimL.toLowerCase()} (${restKeys.length})`, full: `${dimL}: every one but ${name}`, f: merged(restKeys) },
      ]);
    });
    // quick picks: the best few
    const tops = [3, 5, 10].filter((t) => t < order.length).map((t) => { const b = el("button", { type: "button", class: "link" }, `Top ${t}`); b.addEventListener("click", () => { placePick = new Set(order.slice(0, t)); draw(); }); return b; });
    const clear = n ? el("button", { type: "button", class: "link" }, "Clear picks") : null;
    clear?.addEventListener("click", () => { placePick = new Set(); draw(); });
    return el("div", { class: "cmp-place-bar" }, [go, vsRest, tops.length ? el("span", { class: "cmp-place-tops muted small" }, ["Tick: ", ...tops.flatMap((b, i) => (i ? [" \u00b7 ", b] : [b]))]) : null, clear]);
  }
  function placeSection() {
    const ps = inPlay().filter((p) => p.key !== EVERY).slice(0, 4);
    const pool = ps.length ? ps : inPlay();
    const rsOf = (p) => sgRounds(roundsOfKey(p.key)).map((rd) => ({ ...rd, pk: rd.pk || p.key }));
    const all = pool.flatMap(rsOf);
    // (update 219) each tournament: the first one back after a break (3+ weeks off), or the 2nd / 3rd+ in a row
    weekTag = new Map();
    for (const p of pool) {
      const evs = [...new Map(all.filter((rd) => rd.pk === p.key).map((rd) => [evk(rd), rd.date])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      let run = 0, prev = null;
      for (const [k, d] of evs) { const t = Date.parse(d); run = prev != null && t - prev < 17 * 864e5 ? run + 1 : 1; prev = t; weekTag.set(`${p.key}|${k}`, WEEKS[Math.min(run, 3) - 1]); }
    }
    const dims = PLACE.filter(([, , f]) => new Set(all.map(f).filter(Boolean)).size > 1);
    if (!dims.length) return el("section", { class: "panel cmp-empty" }, el("p", { class: "muted" }, "Not enough variety in these rounds to rank."));
    if (!dims.some(([d]) => d === placeDim)) placeDim = dims[0][0];
    const [, dimL, keyOf] = dims.find(([d]) => d === placeDim);
    const avgAll = all.reduce((t, rd) => t + rdSG(rd, "TOTAL"), 0) / all.length;
    const groups = new Map();
    for (const rd of all) { const k = keyOf(rd); if (!k) continue; (groups.get(k) || groups.set(k, []).get(k)).push(rd); }
    const evsOf = (rds) => [...rds.reduce((m, rd) => { const k = `${rd.pk}|${evk(rd)}`; (m.get(k) || m.set(k, []).get(k)).push(rd); return m; }, new Map()).values()];
    let list = [...groups].map(([k, rds]) => ({ k, rds, n: rds.length, evs: evsOf(rds).length, v: rds.reduce((t, rd) => t + rdSG(rd, "TOTAL"), 0) / rds.length, byP: pool.map((p) => { const x = rds.filter((rd) => rd.pk === p.key); return x.length ? x.reduce((t, rd) => t + rdSG(rd, "TOTAL"), 0) / x.length : null; }) }));
    list = placeDim === "rounds" || placeDim === "seasons" || placeDim === "weeks" ? list.sort((a, b) => b.v - a.v) : list.sort((a, b) => (b.n >= 3) - (a.n >= 3) || b.v - a.v);
    const max = Math.max(0.05, ...list.map((x) => Math.abs(x.v - avgAll)));
    const tabs = el("div", { class: "cmp-seg small cmp-dims" }, dims.map(([d, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${placeDim === d ? " on" : ""}` }, l); b.addEventListener("click", () => { placeDim = d; placeOpen = new Set(); placePick = new Set(); draw(); }); return b; }));
    const many = pool.length > 1;
    const rows = list.flatMap((x, i) => {
      const on = placeOpen.has(x.k), w = Math.abs(x.v - avgAll) / max * 50;
      const row = el("button", { type: "button", class: `cmp-cond cmp-tap cmp-place${on ? " on" : ""}${x.n < 3 ? " few" : ""}`, "aria-expanded": String(on) }, [
        (() => { // (update 219) tick some, then "Compare these"
          const picked = placePick.has(x.k);
          const ck = el("span", { class: `cmp-cond-rank cmp-place-ck${picked ? " on" : ""}`, role: "checkbox", "aria-checked": String(picked), tabindex: "0", title: picked ? "Picked to compare (tap to take it out)" : "Pick it to compare" }, picked ? "\u2713" : String(i + 1));
          const flip = (e) => { e.stopPropagation(); e.preventDefault(); picked ? placePick.delete(x.k) : placePick.add(x.k); draw(); };
          ck.addEventListener("click", flip); ck.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") flip(e); });
          return ck;
        })(),
        el("span", { class: "cmp-cond-l" }, [el("span", { class: "cmp-ev-caret", "aria-hidden": "true" }, on ? "\u25be " : "\u25b8 "), x.k, el("span", { class: "muted" }, ` \u00b7 ${x.evs} visit${x.evs === 1 ? "" : "s"}, ${x.n} rd${x.n === 1 ? "" : "s"}`)]),
        el("span", { class: "cmp-cond-bar" }, [el("span", { class: "mid" }), el("span", { class: `b ${x.v >= avgAll ? "pos" : "neg"}`, style: x.v >= avgAll ? `left:50%;width:${w}%` : `right:50%;width:${w}%` })]),
        el("strong", { class: `cmp-cond-v ${tone(x.v)}` }, fmtSG(x.v)),
        el("span", { class: `cmp-cond-d ${tone(x.v - avgAll)}` }, fmtSigned(x.v - avgAll)),
      ]);
      row.addEventListener("click", () => { on ? placeOpen.delete(x.k) : placeOpen.add(x.k); draw(); });
      if (!on) return [row];
      // each visit: a tournament's years, a course's tournaments, a month's tournaments, a round's tournaments
      const visits = evsOf(x.rds).sort((a, b) => String(b.at(-1).date).localeCompare(String(a.at(-1).date)));
      const pname = (pk) => pool.find((p) => p.key === pk)?.label || "";
      const det = el("div", { class: "cmp-place-det" }, el("table", { class: "cmp-table cmp-place-t" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, placeDim === "tournaments" ? "Year" : "Tournament"), el("th", { class: "num" }, "Rds"), finishes.size ? el("th", { class: "num", title: "Finish: by SG: Total among those who played every round; MC = fewer rounds" }, "Fin") : null, el("th", { class: "num" }, "SG/rd"), el("th", { class: "ph-hide" }, placeDim === "rounds" ? "Date" : "Each round")])),
        el("tbody", {}, visits.map((rds) => { const v = rds.reduce((t, rd) => t + rdSG(rd, "TOTAL"), 0) / rds.length, f = finishOf(rds[0].pk, rds[0]);
          return el("tr", {}, [el("td", {}, [placeDim === "tournaments" ? yr(rds[0]) : `${rds[0].event || "\u2014"} ${yr(rds[0])}`, many ? el("span", { class: "muted small" }, ` \u00b7 ${pname(rds[0].pk)}`) : null, placeDim === "tournaments" && rds[0].course ? el("span", { class: "muted small" }, ` \u00b7 ${rds[0].course}`) : null]),
            el("td", { class: "num" }, String(rds.length)), finishes.size ? el("td", { class: `num cmp-fin${f === "MC" ? " mc" : ""}` }, f) : null, el("td", { class: `num strong ${tone(v)}` }, fmtSG(v)),
            el("td", { class: "ph-hide cmp-rd-chips" }, placeDim === "rounds" ? dateTxt(rds[0].date) : [...rds].sort((a, b) => Number(a.roundNo || 0) - Number(b.roundNo || 0)).map((rd) => el("span", { class: `cmp-rd-chip ${tone(rdSG(rd, "TOTAL"))}` }, `R${rd.roundNo || "?"} ${fmtSG(rdSG(rd, "TOTAL"))}`)))]); })),
      ]));
      return [row, whyBox(x, all), det];
    });
    return el("section", { class: "panel cmp-sec career-sec" }, [
      el("div", { class: "cmp-sec-head" }, [el("h2", {}, `Where they play best: by ${dimL.toLowerCase()}`), el("p", { class: "muted small" }, `Every ${dimL.toLowerCase()} across all their rounds, best first: SG: Total a round, and how far above or below their overall average (${fmtSG(avgAll)}). ${placeDim === "rounds" ? "" : "Fewer than 3 rounds sit at the bottom. "}Tap one to see each visit and why, or tick numbers to compare them side by side.`)]),
      tabs,
      placeBar(groups, dimL, list.map((x) => x.k)),
      el("div", { class: "cmp-conds" }, [el("div", { class: "cmp-cond cmp-cond-h" }, [el("span", {}, "#"), el("span", {}, ""), el("span", { class: "cmp-cond-bar-h" }, [el("span", {}, "worse"), el("span", {}, "their average"), el("span", {}, "better")]), el("span", {}, "SG"), el("span", {}, "vs avg")]), ...rows]),
    ]);
  }
  /* (update 220) the leaderboard at the top of every comparison: best first, each bar against that player's usual
     (their average over every round here). Tap one for its tournaments. */
  function boardSection(items) {
    const live = items.filter((it) => it.s.n);
    if (live.length < 2) return null;
    const avgOf = new Map();
    // (update 221) "their average" over the same parts of the game the pick has (a driver: their Off-the-Tee average)
    // (update 240) a club or ball: the average one of its kind
    const usual = (it) => {
      if (prodBase(it)) return prodBase(it).v;
      const pk = it.pk || inPlay()[0]?.key, cs = [...new Set(it.rs.flatMap((rd) => rd.shots.map((x) => x.cat)))].sort(), key = `${pk}|${cs.join(",")}`;
      if (!avgOf.has(key)) { const rs = sgRounds(roundsOfKey(pk)), all4 = cs.length >= 4; avgOf.set(key, rs.length ? rs.reduce((t, rd) => t + (all4 ? rdSG(rd, "TOTAL") : cs.reduce((u, c) => u + rdSG(rd, c), 0)), 0) / rs.length : 0); }
      return avgOf.get(key);
    };
    const list = [...live].map((it) => ({ it, v: it.s.sg.TOTAL, d: it.s.sg.TOTAL - usual(it) })).sort((a, b) => b.v - a.v);
    const max = Math.max(0.05, ...list.map((x) => Math.abs(x.d)));
    const pks = new Set(live.map((it) => it.pk || inPlay()[0]?.key));
    const rows = list.map((x, i) => {
      const w = Math.abs(x.d) / max * 50;
      const row = el("button", { type: "button", class: "cmp-cond cmp-tap cmp-board-row", title: "See its tournaments", "data-s": x.it.i }, [
        el("span", { class: "cmp-cond-rank" }, String(i + 1)),
        el("span", { class: "cmp-cond-l" }, [el("i", { class: "cmp-dot", style: `--c:${x.it.color}` }), x.it.name, el("span", { class: "muted" }, ` \u00b7 ${x.it.s.n} rd${x.it.s.n === 1 ? "" : "s"}`), x.it.s.n < FEW ? el("span", { class: "cmp-few-mark", title: "Only a few rounds" }, " *") : null]),
        el("span", { class: "cmp-cond-bar" }, [el("span", { class: "mid" }), el("span", { class: `b ${x.d >= 0 ? "pos" : "neg"}`, style: x.d >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` })]),
        el("strong", { class: `cmp-cond-v ${tone(x.v)}` }, fmtSG(x.v)),
        el("span", { class: `cmp-cond-d ${tone(x.d)}` }, fmtSigned(x.d)),
      ]);
      row.addEventListener("click", () => openRounds(x.it));
      return hoverable(row, x.it.i);
    });
    const avgTxt = pks.size === 1 && new Set(live.map(usual)).size === 1 ? ` (${fmtSG(usual(live[0]))})` : "";
    // (update 240) clubs and balls: against the average one of its kind
    const pbs = live.map(prodBase), prodAll = pbs.every(Boolean), sameKind = prodAll && new Set(pbs.map((x) => x.label)).size === 1;
    const midL = prodAll ? (sameKind ? pbs[0].label : "the average of its kind") : pks.size === 1 ? "their average" : "their averages";
    const descr = prodAll ? `Best first: strokes gained a round with each, and how far above or below ${sameKind ? pbs[0].label : "the average club or ball of its kind"}${sameKind ? ` (${fmtSG(pbs[0].v)}: every ${pbs[0].label.replace(/^(the|their) average /, "")}\u2019s shots${pks.has(EVERY) ? "" : " of theirs"}, in the rounds it was used)` : ""}. Tap one for its card and tournaments.`
      : `Best first: strokes gained a round, and how far above or below ${pks.size === 1 ? "their" : "each player\u2019s"} average over every round (in the same parts of the game)${avgTxt}. Tap one for its card and tournaments.`;
    return el("section", { class: "panel cmp-sec career-sec cmp-board" }, [
      el("div", { class: "cmp-sec-head" }, [el("h2", {}, "Leaderboard"), el("p", { class: "muted small" }, descr)]),
      el("div", { class: "cmp-conds" }, [el("div", { class: "cmp-cond cmp-cond-h" }, [el("span", {}, "#"), el("span", {}, ""), el("span", { class: "cmp-cond-bar-h" }, [el("span", {}, "worse"), el("span", {}, midL), el("span", {}, "better")]), el("span", {}, "SG"), el("span", {}, "vs avg")]), ...rows]),
    ]);
  }
  function timelineSection(items) {
    if (!timeMode()) return null;
    const pks = [...new Set(items.filter((it) => it.s.n).map((it) => it.pk || inPlay()[0]?.key))].filter((k) => k && k !== EVERY).slice(0, 4);
    if (!pks.length) return null;
    const blocks = pks.map((pk) => {
      const mine = items.filter((it) => it.s.n && (it.pk || inPlay()[0]?.key) === pk);
      const inIt = new Map(); // round key → the first item it's in
      for (const it of mine) for (const rd of it.rs) if (!inIt.has(rd.key)) inIt.set(rd.key, it);
      const allRs = [...sgRounds(roundsOfKey(pk))].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const first = allRs.findIndex((rd) => inIt.has(rd.key));
      const rs = first < 0 ? [] : allRs.slice(Math.max(0, first - 2));
      if (!rs.length) return null;
      // (update 216) round by round, or tournament by tournament (each one's SG: Total a round)
      const units = tlBy === "rounds" ? rs.map((rd) => ({ rds: [rd], label: dateTxt(rd.date), sub: [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" \u00b7 ") }))
        : [...rs.reduce((m, rd) => { const k = evk(rd); (m.get(k) || m.set(k, []).get(k)).push(rd); return m; }, new Map()).values()].map((rds) => ({ rds, label: dateTxt(rds.at(-1).date), sub: `${rds[0].event || "\u2014"} \u00b7 ${rds.length} rd${rds.length === 1 ? "" : "s"}${finishes.size ? ` \u00b7 ${finishOf(pk, rds[0])}` : ""}` }));
      const bars = units.map((u) => { const it = u.rds.map((rd) => inIt.get(rd.key)).find(Boolean); return { label: u.label, sub: u.sub, v: u.rds.reduce((t, rd) => t + rdSG(rd, "TOTAL"), 0) / u.rds.length, on: !!it, color: it?.color }; });
      const ref = mine.map((it) => { const keys = new Set(it.rs.map((x) => x.key)); const idx = units.map((u, i) => (u.rds.some((rd) => keys.has(rd.key)) ? i : -1)).filter((i) => i >= 0); return idx.length ? { v: it.s.sg.TOTAL, label: it.name.replace(/^.* \u00b7 /, ""), from: idx[0], to: idx.at(-1) + 1, color: it.color } : null; }).filter(Boolean);
      return { kind: "bars", fmt: "sg", items: bars, ref, title: pks.length > 1 || multi() ? (players.find(([k]) => k === pk)?.[1] || (pk === player?.key ? player.label : pk)) : null };
    }).filter(Boolean);
    if (!blocks.length) return null;
    return el("section", { class: "panel cmp-sec" }, [
      el("div", { class: "cmp-sec-head cmp-tl-head" }, [el("div", {}, [el("h2", {}, tlBy === "rounds" ? "Round by round" : "Tournament by tournament"),
        el("p", { class: "muted small" }, `SG: Total ${tlBy === "rounds" ? "in every round" : "a round at every tournament"}, in order. The ones being compared are in their colour; each dashed line is that group\u2019s average.`)]),
        el("div", { class: "cmp-seg small" }, [["rounds", "Rounds"], ["events", "Tournaments"]].map(([v, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${tlBy === v ? " on" : ""}` }, l); b.addEventListener("click", () => { tlBy = v; draw(); }); return b; }))]),
      el("div", { class: "cmp-legend" }, items.filter((it) => it.s.n).map((it) => el("span", { class: "cmp-legend-i" }, [el("i", { style: `background:${it.color}` }), it.name]))),
      ...renderBlocks(blocks),
    ]);
  }
  // (update 216) seasons side by side: the tournaments (or courses) they played in more than one of them, year over year
  function yoySection(items) {
    const ys = items.filter((it) => it.s.n && it.f?.years?.length === 1);
    if (ys.length < 2 || ys.length !== items.filter((it) => it.s.n).length) return null;
    const pks = new Set(ys.map((it) => it.pk || inPlay()[0]?.key));
    if (pks.size > 1) return null;
    const cols = [...ys].sort((a, b) => a.f.years[0].localeCompare(b.f.years[0]));
    const keyOf = (rd) => (yoyBy === "event" ? rd.event : rd.course) || null;
    const per = cols.map((it) => { const m = new Map(); for (const rd of it.rs) { const k = keyOf(rd); if (!k) continue; const o = m.get(k) || m.set(k, { n: 0, sg: 0, rd }).get(k); o.n++; o.sg += rdSG(rd, "TOTAL"); } return m; });
    const names = [...new Set(per.flatMap((m) => [...m.keys()]))].filter((k) => per.filter((m) => m.has(k)).length >= 2);
    if (!names.length) return null;
    const pk = [...pks][0];
    const rows = names.map((k) => { const vals = per.map((m) => (m.has(k) ? m.get(k).sg / m.get(k).n : null)); const got = vals.map((v, i) => [v, i]).filter(([v]) => v != null); return { k, vals, ns: per.map((m) => m.get(k)?.n || 0), fins: per.map((m) => (m.has(k) && yoyBy === "event" && finishes.size ? finishOf(pk, m.get(k).rd) : null)), ch: got.at(-1)[0] - got[0][0] }; }).sort((a, b) => b.ch - a.ch);
    const big = Math.max(...rows.map((x) => Math.abs(x.ch)));
    const tabs = el("div", { class: "cmp-seg small" }, [["event", "Tournaments"], ["course", "Courses"]].map(([v, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${yoyBy === v ? " on" : ""}` }, l); b.addEventListener("click", () => { yoyBy = v; draw(); }); return b; }));
    return el("section", { class: "panel cmp-sec cmp-yoy" }, [
      el("div", { class: "cmp-sec-head cmp-tl-head" }, [el("div", {}, [el("h2", {}, "Year over year"), el("p", { class: "muted small" }, `${yoyBy === "event" ? "Tournaments" : "Courses"} played in more than one of these seasons: SG: Total a round each year${yoyBy === "event" && finishes.size ? " (and where they finished)" : ""}, biggest improvement first.`)]), tabs]),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, yoyBy === "event" ? "Tournament" : "Course"), ...cols.map((it) => el("th", { class: "num" }, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.f.years[0]])), el("th", { class: "num" }, "Change")])),
        el("tbody", {}, rows.map((x) => el("tr", { class: Math.abs(x.ch) === big ? "strong" : "" }, [el("td", {}, x.k),
          ...x.vals.map((v, i) => el("td", { class: `num ${tone(v)}` }, v == null ? "\u2014" : [fmtSG(v), el("span", { class: "cmp-yoy-n" }, x.fins[i] ? ` fin ${x.fins[i]}` : ` ${x.ns[i]} rds`)])),
          el("td", { class: `num cmp-delta strong ${tone(x.ch)}` }, `${x.ch > 0.004 ? "\u25b2" : x.ch < -0.004 ? "\u25bc" : "\u25c6"}\u00a0${Math.abs(x.ch).toFixed(2)}`)]))),
      ])),
    ]);
  }
  function standout(items) {
    const list = insights(items.map((it) => ({ name: it.name, s: it.s })));
    if (!list.length) return null;
    return el("section", { class: "panel cmp-standout" }, [el("h2", {}, "What stands out"), el("ul", {}, list.map((x) => el("li", { class: x.tone }, x.text)))]);
  }

  // strokes gained: the table (each row shaded best to worst) and the grouped bars
  // (update 209) one table: strokes gained, then every other stat by category and distance (no bar chart)
  function sgSection(all) {
    const live = all.filter((it) => it.s.n), items = live; // (a selection with no rounds: no column of dashes)
    if (!live.length) return null;
    const rowsShown = sgRowsFor(live);
    const shadeBy = (vals, v, higher = true) => { const xs = vals.filter((x) => x != null); if (xs.length < 2 || v == null || higher == null) return ""; const best = higher === false ? Math.min(...xs) : Math.max(...xs), worst = higher === false ? Math.max(...xs) : Math.min(...xs); return Math.abs(best - worst) < 1e-9 ? "" : v === best ? "hi" : v === worst ? "lo" : ""; };
    const head = (t) => el("tr", { class: "cmp-grp" }, el("td", { colspan: items.length + 1 }, t));
    const rows = [head("Strokes gained a round"), ...rowsShown.map(([k, l]) => {
      const vals = items.map((it) => it.s.sg[k]);
      return el("tr", { class: k === "TOTAL" ? "strong" : "" }, [el("td", {}, l), ...items.map((it, j) => el("td", { class: `num ${tone(vals[j])} ${shadeBy(vals, vals[j])}`, "data-s": it.i }, vals[j] == null ? "—" : fmtSG(vals[j])))]);
    })];
    // the other stats, by category (and distance), for the same selections
    const obsSets = items.map((it) => statSets(roundsOf(it), [it.f])[0] || []);
    for (const bk of statBlocks(obsSets, incNow())) {
      const keep = bk.rows.filter((r) => r.values.some((v) => v != null && Math.abs(v) > 1e-9));
      if (!keep.length) continue;
      rows.push(head(bk.label));
      for (const r of keep) rows.push(el("tr", { class: r.dist ? "cmp-sub" : "" }, [
        el("td", { title: r.def.help || "" }, r.dist ? r.dist : r.label),
        ...items.map((it, j) => el("td", { class: `num ${shadeBy(r.values, r.values[j], r.def.higher)}`, "data-s": it.i, title: r.w[j] ? `${Math.round(r.w[j])} attempts` : "" }, fmtStat(r.def, r.values[j]))),
      ]));
    }
    const table = el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, ""), ...items.map((it) => hoverable(el("th", { class: "num", "data-s": it.i }, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.name, it.s.n < FEW ? el("span", { class: "cmp-few-mark", title: `Only ${it.s.n} rounds` }, " *") : null]), it.i))])),
      el("tbody", {}, rows),
    ]));
    const fewOnes = items.filter((it) => it.s.n < FEW);
    const fewNote = fewOnes.length ? el("p", { class: "cmp-few" }, `* Only a few rounds: ${fewOnes.map((it) => `${it.name} (${it.s.n})`).join(", ")}. Differences against ${fewOnes.length === 1 ? "it" : "them"} may just be chance.`) : null;
    let conf = null;
    if (live.length >= 2) {
      const s = [...live].sort((a, b) => b.s.sg.TOTAL - a.s.sg.TOTAL), c = confidence(s[0].s.rounds, s.at(-1).s.rounds);
      conf = el("p", { class: "muted small" }, [`Best against worst in SG: ${used1(live)}: ${s[0].name} is ${Math.abs(s[0].s.sg.TOTAL - s.at(-1).s.sg.TOTAL).toFixed(2)} a round better than ${s.at(-1).name}. `, el("strong", { class: `cmp-conf c-${c.word.replace(/ /g, "-")}` }, sureWords(s[0].s.rounds, s.at(-1).s.rounds))]); // (update 222)
    }
    return el("section", { class: "panel cmp-sec" }, [secHead("Side by side", "Strokes gained, then the other stats by part of the game and distance. The best in each row is shaded green, the worst red (lower is better for some, like Proximity). Hover a stat for how many attempts it’s from."), table, fewNote, conf]);
  }
  // every round as a dot, and how each selection unfolded (a 5-round rolling average)
  function roundsSection(items) {
    const live = items.filter((it) => it.s.n);
    return el("section", { class: "panel cmp-sec" }, [
      secHead("Every round", "Each dot is a round (SG: Total). The bar is the middle half of the rounds, the white tick the median, the diamond the average."),
      legend(live), strip(live),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table compact" }, [
        el("thead", {}, el("tr", {}, ["", "Rounds", "Average", "Median", "Best", "Worst", "Swing (±)", "Gaining"].map((h, i) => el("th", { class: `${i ? "num" : ""}${[3, 6, 7].includes(i) ? " ph-hide" : ""}` }, h)))),
        el("tbody", {}, live.map((it) => el("tr", { "data-s": it.i }, [el("td", {}, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.name]), el("td", { class: "num" }, String(it.s.n)),
          el("td", { class: `num ${tone(it.s.sg.TOTAL)}` }, fmtSG(it.s.sg.TOTAL)), el("td", { class: `num ph-hide ${tone(it.s.median)}` }, fmtSG(it.s.median)), el("td", { class: "num pos" }, fmtSG(it.s.best)), el("td", { class: "num neg" }, fmtSG(it.s.worst)),
          el("td", { class: "num ph-hide" }, it.s.sd == null ? "\u2014" : it.s.sd.toFixed(2)), el("td", { class: "num ph-hide" }, `${Math.round((it.s.gaining || 0) * 100)}%`)]))),
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
  // (update 194) the stats for each category of shot (Driving Distance, Fairways and GIR off the tee; Hit Green %,
  // Proximity, Pin-High and On-Line for approaches; Good Lag and Made Putt % on the green), and at each distance
  const FEW = 10; // (update 210) fewer rounds than this: flagged everywhere
  const statsSection = () => null; // (update 209: part of "Side by side" now)
  // (update 209) product usage across everyone in the data: how many use it, share, switching, how long they stay
  /* ------------------------------ (update 211) Generate AI Report ------------------------------ */
  function reportBar(items) {
    const live = items.filter((it) => it.s.n);
    if (!live.length) return null;
    const b = el("button", { type: "button", class: "hero-insights cmp-ai-btn" }, "\u2728 Generate AI Report");
    const status = el("span", { class: "muted small" }, "");
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await makeReport(live, (t) => { status.textContent = t; }); status.textContent = "Done: the report opened in a new tab (and downloaded)."; }
      catch (err) { console.warn(err); status.textContent = "Couldn\u2019t make the report. Try again."; }
      b.disabled = false;
    });
    return el("div", { class: "cmp-ai" }, [b, status]);
  }
  /* (update 239) the insight engine for the report. Two selections: the better one (A) against the other (B); three
     or more: the best against the worst, with the order. For each part of the game: did it help or hurt, by how much,
     and which stats moved (Hit Green % up, Made Putt % down …), including when the stats and strokes gained disagree.
     Then the scoring pattern (birdies, bogeys, pars), each one's biggest weapon and weak spot against the field, and
     steadiness. **bold** marks what matters. */
  function deepInsights(live, blocks) {
    const ord0 = [...live].sort((a, b) => b.s.sg.TOTAL - a.s.sg.TOTAL);
    const two = live.length === 2;
    // two stretches of time, one after the other (this season and last; the last 5 events and the 5 before): the
    // later one against the earlier, as a change ("improved", "slipped"), whichever is better
    const dk0 = (v) => String(v || "").slice(0, 10);
    const timeWise = two && live.every((it) => it.s.from && it.s.to) && (dk0(live[0].s.to) <= dk0(live[1].s.from) || dk0(live[1].s.to) <= dk0(live[0].s.from));
    const A = timeWise ? [...live].sort((a, b) => dk0(b.s.to).localeCompare(dk0(a.s.to)))[0] : ord0[0];
    const B = timeWise ? live.find((x) => x !== A) : two ? ord0[1] : ord0.at(-1), ia = live.indexOf(A), ib = live.indexOf(B);
    const UP = timeWise ? "improved" : `was better (${A.name} over ${B.name})`, DOWN = timeWise ? "slipped" : `was worse (${A.name} against ${B.name})`;
    const catName = Object.fromEntries(CATEGORIES);
    const cats = usedCats(live).map(([k]) => k);
    const sg2 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
    const strokes = (v) => `${Math.abs(v).toFixed(2)} a round`;
    const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
    const gap = A.s.sg.TOTAL - B.s.sg.TOTAL;
    const D = Object.fromEntries(cats.map((c) => [c, (A.s.sg[c] ?? 0) - (B.s.sg[c] ?? 0)]));
    const STEP = 0.03;
    const ups = cats.filter((c) => D[c] >= STEP).sort((a, b) => D[b] - D[a]), downs = cats.filter((c) => D[c] <= -STEP).sort((a, b) => D[a] - D[b]);
    const upSum = ups.reduce((t, c) => t + D[c], 0), downSum = downs.reduce((t, c) => t + D[c], 0);
    // the stats: each category's (and scoring's) rows, A against B
    const statsOf = (cat) => (blocks.find((b) => b.cat === cat)?.rows || []).filter((r) => !r.dist && r.values[ia] != null && r.values[ib] != null)
      .map((r) => { const d = r.values[ia] - r.values[ib], good = r.def.higher == null ? null : (r.def.higher === false ? -d : d) > 0; const rel = Math.abs(d) / Math.max(Math.abs(r.values[ib]), 1e-9); return { r, d, good, rel }; });
    const vTxt = (x, i) => fmtStat(x.r.def, x.r.values[i]);
    const dTxt = (x) => `${x.d >= 0 ? "+" : "\u2212"}${fmtStat({ ...x.r.def, pct: false, unit: x.r.def.pct ? " pct" : x.r.def.unit }, Math.abs(x.d))}`;
    const MEAN = (x) => (x.r.def.pct ? Math.abs(x.d) >= 1 : x.rel >= 0.01); // a move worth mentioning (1 pct, or 1%)
    const statLine = (x) => `${x.r.def.label} **${vTxt(x, ia)}** vs ${vTxt(x, ib)} (${dTxt(x)})`;
    const who = two ? B.name : `${B.name} (the lowest)`;
    const story = [], hi = [], lo = [];

    /* the story */
    story.push(timeWise ? `From **${B.name}** to **${A.name}**, strokes gained ${gap >= 0 ? "**rose**" : "**fell**"} by **${strokes(gap)}** (**${sg2(B.s.sg.TOTAL)}** to **${sg2(A.s.sg.TOTAL)}**).`
      : `**${A.name}** ${two ? "beat" : "is best of " + live.length + ", beating"} **${who}** by **${strokes(gap)}** overall (**${sg2(A.s.sg.TOTAL)}** against **${sg2(B.s.sg.TOTAL)}**).`);
    if (cats.length > 1) {
      const nm = (cs) => list(cs.map((c) => `**${catName[c]}** (${sg2(D[c])})`));
      if (ups.length && !downs.length) story.push(`${timeWise ? "It got better" : "It was better"} almost everywhere, led by ${nm(ups.slice(0, 2))}.`);
      else if (!ups.length && downs.length >= 2 && timeWise) story.push(`It slipped almost everywhere, most in ${nm(downs.slice(0, 2))}.`);
      else if (ups.length && downs.length) {
        const others = cats.filter((c) => c !== ups[0]), allOthers = ups.length === 1 && downs.length === others.length;
        story.push(`${ups.length === 1 ? `It all came from ${nm(ups)}` : `The gain came from ${nm(ups)}`}. ${allOthers ? `**Every other part of the game got worse**: ${nm(downs)}` : `Meanwhile ${nm(downs)} ${downs.length === 1 ? "went" : "all went"} the other way`}, **${sg2(downSum)} a round** combined.`);
        story.push(upSum + downSum > 0 ? `So the ${ups.length === 1 ? catName[ups[0]] : "gains"} ${ups.length === 1 ? (timeWise ? "improvement was" : "edge was") : "were"} big enough (**${sg2(upSum)}**) to more than cover the ${timeWise ? "slide" : "rest"}, and it still came out **${strokes(gap)} better**. ${downs.length >= 2 ? `The upside: if ${downs.length === 2 ? "those two" : "those"} get back to where ${downs.length === 2 ? "they were" : "they were"}, there\u2019s about **${strokes(-downSum)}** more on the table.` : ""}`.trim()
          : `${timeWise ? "The slide" : "The rest"} outweighed ${ups.length === 1 ? `the ${catName[ups[0]]} gain` : "the gains"} (**${sg2(upSum)}** against **${sg2(downSum)}**), so it came out **${strokes(gap)} ${gap >= 0 ? "better" : "worse"}**.`);
      } else if (downs.length) story.push(`Even so, ${nm(downs)} ${downs.length === 1 ? "was" : "were"} worse; the rest made up for it.`);
      else story.push(`No single part of the game stands out: the gap is a little from everywhere.`);
    }

    /* highlights: what got better (and why), the scoring pattern, the biggest weapon */
    for (const c of ups) {
      const st = statsOf(c).filter(MEAN), good = st.filter((x) => x.good === true).sort((a, b) => b.rel - a.rel).slice(0, 2), bad = st.filter((x) => x.good === false).sort((a, b) => b.rel - a.rel)[0];
      hi.push(`**${catName[c]}** ${ups[0] === c && ups.length === 1 && downs.length && gap > 0 ? "made the whole difference" : UP}: **${sg2(D[c])} a round** (${sg2(A.s.sg[c])} vs ${sg2(B.s.sg[c])}).${good.length ? ` Behind it: ${list(good.map(statLine))}.` : ""}${bad ? (good.length ? ` (${bad.r.def.label} dipped a little: ${vTxt(bad, ia)} vs ${vTxt(bad, ib)}.)` : ` That\u2019s despite ${bad.r.def.label} going the wrong way (${vTxt(bad, ia)} vs ${vTxt(bad, ib)}), so the gain came from somewhere else.`) : ""}`);
    }
    // scoring: birdies, bogeys, pars
    {
      const sc = statsOf("ROUND"), g = (k) => sc.find((x) => x.r.key === k);
      const avg = g("scoring"), bir = g("birdiesRd"), bog = g("bogeysRd"), dbl = g("dblBogeysRd"), par = g("parsRd"), eag = g("eagles");
      const good = [], bad = [];
      if (avg && Math.abs(avg.d) >= 0.05) (avg.good ? good : bad).push(`scoring average **${vTxt(avg, ia)}** vs ${vTxt(avg, ib)}`);
      if (bir && bog && Math.abs(bir.d) >= 0.1 && Math.abs(bog.d) >= 0.1) {
        const pattern = bir.d < 0 && bog.d < 0 ? `**fewer mistakes rather than more birdies**: bogeys down ${Math.abs(bog.d).toFixed(2)} a round${par && par.d > 0 ? ` and pars up ${par.d.toFixed(2)}` : ""}, while birdies fell ${Math.abs(bir.d).toFixed(2)}`
          : bir.d > 0 && bog.d > 0 ? `**more aggressive**: ${bir.d.toFixed(2)} more birdies a round, but ${bog.d.toFixed(2)} more bogeys too`
          : bir.d > 0 ? `**more birdies and fewer bogeys** (birdies +${bir.d.toFixed(2)}, bogeys \u2212${Math.abs(bog.d).toFixed(2)} a round)` : `**fewer birdies and more bogeys** (birdies \u2212${Math.abs(bir.d).toFixed(2)}, bogeys +${bog.d.toFixed(2)} a round)`;
        (bir.d < 0 && bog.d > 0 ? bad : good).push(`the scorecard shows ${pattern}`);
      }
      if (eag && eag.d >= 0.03) good.push(`eagles up to ${vTxt(eag, ia)} a round`);
      if (dbl && Math.abs(dbl.d) >= 0.05) (dbl.d < 0 ? good : bad).push(`double bogeys ${dbl.d < 0 ? "down" : "up"}: **${vTxt(dbl, ia)}** a round vs ${vTxt(dbl, ib)}${dbl.d > 0 && bog && bog.d < 0 ? ", so fewer mistakes overall, but the big ones crept in" : ""}`);
      const say = (xs) => `**Scoring.** ${xs[0].charAt(0).toUpperCase()}${xs[0].slice(1)}${xs.length > 1 ? `; ${xs.slice(1).join("; ")}` : ""}.`;
      if (good.length) hi.push(say(good));
      if (bad.length) lo.push(say(bad));
    }
    // the biggest weapon (against the field: 0 is tour average)
    if (cats.length > 1) {
      const w = [...cats].sort((a, b) => (A.s.sg[b] ?? 0) - (A.s.sg[a] ?? 0))[0];
      if ((A.s.sg[w] ?? 0) >= 0.2) hi.push(`**${catName[w]}** is ${timeWise ? "still " : ""}the biggest weapon: **${sg2(A.s.sg[w])} a round** against the field${D[w] <= -STEP ? (timeWise ? `, even after slipping ${strokes(D[w])}` : `, though ${strokes(D[w])} less than for ${B.name}`) : D[w] >= STEP ? (timeWise ? ", and getting better" : `, and better than for ${B.name}`) : ""}.`);
    }
    // steadiness
    if (A.s.sd != null && B.s.sd != null) {
      const dd = A.s.sd - B.s.sd;
      if (dd <= -0.2) hi.push(`**Steadier**: rounds within about \u00b1${A.s.sd.toFixed(1)} of the average, against \u00b1${B.s.sd.toFixed(1)}${A.s.gaining != null ? `, and **${Math.round(A.s.gaining * 100)}%** of rounds gaining strokes` : ""}.`);
      else if (dd >= 0.2) lo.push(`**More up and down**: single rounds swing about \u00b1${A.s.sd.toFixed(1)} (from ${sg2(A.s.worst)} to ${sg2(A.s.best)}), against \u00b1${B.s.sd.toFixed(1)}. ${gap > 0 ? "A better average, but" : "And"} less predictable week to week.`);
    }

    /* lowlights: what got worse (and why), and where it still loses to the field */
    for (const c of downs) {
      const st = statsOf(c).filter(MEAN), bad = st.filter((x) => x.good === false).sort((a, b) => b.rel - a.rel).slice(0, 2), good = st.filter((x) => x.good === true).sort((a, b) => b.rel - a.rel)[0];
      lo.push(`**${catName[c]}** ${DOWN} by **${strokes(D[c])}** (${sg2(A.s.sg[c])} vs ${sg2(B.s.sg[c])}).${bad.length ? ` ${list(bad.map(statLine))} ${bad.length === 1 ? "explains" : "explain"} it.` : ""}${good ? (bad.length ? ` (${good.r.def.label} did rise, ${vTxt(good, ia)} vs ${vTxt(good, ib)}, so the misses cost more.)` : ` That\u2019s despite ${good.r.def.label} improving (${vTxt(good, ia)} vs ${vTxt(good, ib)}): the shots that went wrong cost more than before.`) : ""}${(A.s.sg[c] ?? 0) <= -0.05 ? ` It\u2019s now a **net loss against the field** (${sg2(A.s.sg[c])} a round): the clearest place to find strokes.` : ""}`);
    }
    for (const c of cats) if ((A.s.sg[c] ?? 0) <= -0.05 && !downs.includes(c)) lo.push(`**${catName[c]}** is still a net loss against the field: **${sg2(A.s.sg[c])} a round**. ${D[c] >= STEP ? (timeWise ? "Better than before, but the clearest room to grow." : "Better than for " + B.name + ", but the clearest room to grow.") : "The clearest place to find strokes."}`);
    // nothing worse: the part of the game with the most room to grow
    if (!lo.length && cats.length > 1) { const w = [...cats].sort((a, b) => (A.s.sg[a] ?? 0) - (A.s.sg[b] ?? 0))[0]; lo.push(`${timeWise ? "Nothing got worse" : `${A.name} wasn\u2019t worse anywhere`}, but **${catName[w]}** adds the least: ${sg2(A.s.sg[w] ?? 0)} a round against the field, the part of the game with **the most room to grow**.`); }
    // three or more: the order
    if (!two) story.push(`In order: ${ord0.map((x, i) => `${i + 1}. **${x.name}** ${sg2(x.s.sg.TOTAL)}`).join("; ")}.`);
    const few = live.filter((it) => it.s.n < FEW);
    if (few.length) lo.push(`Only a few rounds for ${list(few.map((it) => `**${it.name}** (${it.s.n})`))}: treat ${few.length === 1 ? "it" : "them"} as a hint, not a verdict.`);
    // the parts of the game first, then scoring and steadiness
    const rank = (t) => (cats.some((c) => t.startsWith(`**${catName[c]}**`)) ? 0 : t.startsWith("**Scoring") ? 1 : 2);
    const byRank = (xs) => xs.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t);
    return { story, hi: byRank(hi).slice(0, 6), lo: byRank(lo).slice(0, 6) };
  }
  async function makeReport(live0, say) {
    say("Working out the highlights\u2026");
    // (names that all start the same, "Everyone · …", lose the shared start; it goes in the subtitle)
    const pre = (() => { const m = /^(.+? \u00b7 )/.exec(live0[0].name); return m && live0.every((it) => it.name.startsWith(m[1])) ? m[1] : ""; })();
    const live = live0.map((it) => ({ ...it, name: it.name.slice(pre.length) }));
    const catName = Object.fromEntries(CATEGORIES);
    const used = usedCats(live);
    const by = (k) => [...live].sort((a, b) => b.s.sg[k] - a.s.sg[k]);
    const words = (v) => `${Math.abs(v).toFixed(2)} stroke${Math.abs(v).toFixed(2) === "1.00" ? "" : "s"} a round`;
    const hi = [], lo = [];
    const order = by("TOTAL"), best = order[0], worst = order.at(-1);
    if (live.length > 1) hi.push(`${best.name} is best overall: ${f2s(best.s.sg.TOTAL)} a round, ${words(best.s.sg.TOTAL - worst.s.sg.TOTAL)} ahead of ${worst.name}.`);
    else hi.push(`${best.name}: ${f2s(best.s.sg.TOTAL)} strokes gained a round over ${best.s.n} rounds.`);
    for (const [k] of used.length > 1 ? used : []) {
      const o = by(k), top = o[0], bot = o.at(-1);
      if (live.length > 1 && top.s.sg[k] - bot.s.sg[k] >= 0.15) hi.push(`${catName[k]}: ${top.name} is best (${f2s(top.s.sg[k])} a round), ${words(top.s.sg[k] - bot.s.sg[k])} ahead of ${bot.name}.`);
      for (const it of live) if (it.s.sg[k] <= -0.3) lo.push(`${it.name} loses ${words(it.s.sg[k])} on ${catName[k]}.`);
      for (const it of live) if (it.s.sg[k] >= 0.5 && !hi.some((t) => t.startsWith(`${catName[k]}: ${it.name}`))) hi.push(`${it.name} gains ${words(it.s.sg[k])} on ${catName[k]}.`);
    }
    if (live.length > 1) lo.unshift(`${worst.name} trails the rest overall (${f2s(worst.s.sg.TOTAL)} a round).`);
    const st = live.filter((x) => x.s.sd != null).sort((a, b) => a.s.sd - b.s.sd);
    if (st.length >= 2 && st.at(-1).s.sd - st[0].s.sd >= 0.4) { hi.push(`${st[0].name} is the most consistent from round to round.`); lo.push(`${st.at(-1).name} is the most up and down from round to round.`); }
    const few = live.filter((it) => it.s.n < FEW);
    if (few.length) lo.push(`Only a few rounds for ${few.map((it) => `${it.name} (${it.s.n})`).join(", ")}: treat ${few.length === 1 ? "it" : "them"} as a hint, not a verdict.`);
    // the table: strokes gained, then the main stats (no distances)
    const tones = (vals, higher = true) => { const xs = vals.filter((v) => v != null); if (xs.length < 2) return vals.map(() => ""); const hiV = higher === false ? Math.min(...xs) : Math.max(...xs), loV = higher === false ? Math.max(...xs) : Math.min(...xs); return vals.map((v) => (v == null || Math.abs(hiV - loV) < 1e-9 ? "" : v === hiV ? "up" : v === loV ? "down" : "")); };
    const rows = [{ group: "Strokes gained a round" }, ...sgRowsFor(live).map(([k, l]) => { const vals = live.map((it) => it.s.sg[k]); return { label: l, cells: vals.map(f2s), tones: tones(vals) }; })];
    const obsSets = live.map((it) => statSets(roundsOf(it), [it.f])[0] || []);
    for (const bk of statBlocks(obsSets, incNow())) {
      const main = bk.rows.filter((r) => !r.dist && r.values.some((v) => v != null));
      if (!main.length) continue;
      rows.push({ group: bk.label });
      for (const r of main) rows.push({ label: r.label, cells: r.values.map((v) => fmtStat(r.def, v)), tones: tones(r.values, r.def.higher) });
    }
    rows.push({ group: "Rounds" }, { label: "Rounds", cells: live.map((it) => String(it.s.n)) });
    let fallback = insights(live.map((it) => ({ name: it.name, s: it.s }))).map((x) => x.text).join(" ");
    // (update 239) the story: where the gap really came from (what got better, what got worse, and what it netted),
    // and highlights / lowlights backed by the stats behind each part of the game
    let story = null;
    if (live.length > 1) {
      story = deepInsights(live, statBlocks(obsSets, incNow()));
      hi.length = 0; hi.push(...story.hi); lo.length = 0; lo.push(...story.lo);
      fallback = story.story.join(" ");
    }
    // the AI summary, when the service is set up
    let summary = null;
    const url = window.PORTAL_CONFIG?.insightsUrl;
    if (url) {
      say("Writing the summary\u2026");
      try {
        const token = await getState().user?.getIdToken?.();
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ comparison: { what: guideSummary(), selections: live.map((it) => ({ name: it.name, rounds: it.s.n, sg: it.s.sg, best: it.s.best, worst: it.s.worst, steadiness: it.s.sd })), highlights: hi, lowlights: lo, table: rows.filter((r) => !r.group).map((r) => [r.label, ...r.cells]), usage: lastUsage?.rows || null } }) });
        if (res.ok) summary = (await res.json()).summary || null;
      } catch { /* the report still works without it */ }
    }
    say("Making the PDF\u2026");
    const { buildComparePdf } = await import("../compareReport.js");
    const bytes = buildComparePdf({
      title: live.length > 1 ? live.map((it) => it.name).slice(0, 3).join(" vs ") + (live.length > 3 ? ` + ${live.length - 3} more` : "") : live[0].name,
      subtitle: g.what ? guideSummary() : `${pre ? `${pre.replace(/ \u00b7 $/, "")} \u00b7 ` : ""}${live.length} selection${live.length === 1 ? "" : "s"}`,
      summary, fallback, highlights: hi.slice(0, 6), lowlights: lo.slice(0, 6),
      cols: live.map((it) => ({ name: it.name, n: it.s.n, few: it.s.n < FEW, color: it.color })), rows,
      // (update 237) the hero cards, the visuals and the verdict
      sels: live.map((it) => ({ name: it.name, color: it.color, n: it.s.n, events: it.s.events, few: it.s.n < FEW, sg: it.s.sg, best: it.s.best, worst: it.s.worst, median: it.s.median, q1: it.s.q1, q3: it.s.q3, sd: it.s.sd, gaining: it.s.gaining, rounds: it.s.rounds })),
      cats: used.length > 1 ? used : [],
      ...(() => {
        if (live.length < 2) return {};
        const o = by("TOTAL"), a0 = o[0], b0 = o[1], gap = a0.s.sg.TOTAL - b0.s.sg.TOTAL;
        const sure = a0.s.n < 3 || b0.s.n < 3 ? { word: "Too few rounds", tone: "warn" } : null; // (update 240: no "clear gap" / "probably real")
        const f = fitStory(a0, b0);
        return { sure, verdict: { lines: [`${a0.name} is ${Math.abs(gap) < 0.05 ? "best, but only just" : "best"}: ${f2s(a0.s.sg.TOTAL)} strokes gained a round against ${f2s(b0.s.sg.TOTAL)} for ${b0.name}${live.length > 2 ? ", the next best" : ""}. ${sureWords(a0.s.rounds, b0.s.rounds)}`.trim(), `${f.sum} ${f.lines.join(" ")}`] } };
      })(),
      usage: lastUsage?.rows ? { cols: lastUsage.cols, rows: lastUsage.rows } : null,
      notes: ["Strokes gained scores every shot against the baseline in the data: + means strokes gained, \u2212 strokes lost. A round\u2019s total is the sum of its shots; the numbers here are averages a round.",
        "Green is the best in a row and red the worst (for stats like Proximity, lower is better).",
        `Anything with fewer than ${FEW} rounds is marked *: with so few rounds a difference can be luck.`],
    });
    const blob = new Blob([bytes], { type: "application/pdf" });
    const href = URL.createObjectURL(blob);
    const a = el("a", { href, download: `Compare report ${new Date().toISOString().slice(0, 10)}.pdf` });
    document.body.append(a); a.click(); a.remove();
    window.open(href, "_blank");
    window.__lastComparePdf = bytes; // (for tests)
  }
  const f2s = (v) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`);
  let lastUsage = null;
  function usageSection(items) {
    lastUsage = null;
    const ps = sels.filter((s) => s.f?.clubs?.length && !s.f.balls); // (update 217: not a club-and-ball combination)
    const pooled = others.has(`${EVERY}|tour`) ? roundsOfKey(EVERY) : null; // (update 222: on the tours picked)
    if (!ps.length || !pooled || source !== "tour") return null;
    // (a group for one season counts that season's tournaments only)
    const u = ps.map((s) => (productUsage(s.f.years ? pooled.filter((rd) => s.f.years.includes(String(rd.year || String(rd.date || "").slice(0, 4)))) : pooled, [{ clubs: s.f.clubs }]) || [null])[0]);
    if (!u || !u.some(Boolean)) return null;
    const colorOf = (s) => items.find((it) => (it.base || it.id) === s.id)?.color || s.color;
    const kind = ps[0].f.clubs[0].startsWith("Ball|") ? "golf balls" : groupNameOf(ps[0].f.clubs[0].split("|")[0]).toLowerCase();
    const f1 = (v) => (v == null ? "\u2014" : v.toFixed(1)), pc = (v) => (v == null ? "\u2014" : `${Math.round(v)}%`), n0 = (v) => (v == null ? "\u2014" : Number(v).toLocaleString());
    lastUsage = { cols: ps.map((s) => s.name), u, rowsOf: null };
    const ROWS = [
      ["Players who used it", (x) => n0(x.players), "Different players with at least one shot with it."],
      ["Players a tournament", (x) => f1(x.perEvent), "On average, how many players used it at each tournament."],
      ["Market share", (x) => pc(x.share), `Of every player at every tournament, how often it was their main ${kind.replace(/s$/, "")} (the one they hit the most shots with).`],
      ["Rounds played with it", (x) => `${n0(x.rounds)}${x.rounds < FEW ? " *" : ""}`, "* Fewer than 10 rounds: read the rest of this column with care."],
      ["Switched to it", (x) => n0(x.switchIn), "Times a player changed to it from another one."],
      ["Switched away", (x) => n0(x.switchOut), "Times a player changed from it to another one."],
      ["Stays with it", (x) => (x.stay == null ? "\u2014" : `${f1(x.stay)} events`), "After switching to it, how many tournaments in a row they kept it (on average)."],
      ["Still using it", (x) => pc(x.kept), "Of the players who used it, the share whose latest tournament was with it."],
    ];
    lastUsage.rows = ROWS.map(([l, f]) => [l, ...u.map((x) => (x ? f(x) : "\u2014"))]);
    return el("section", { class: "panel cmp-sec" }, [
      secHead("Product usage", `Across everyone in the data (${new Set(pooled.map((rd) => rd.pk)).size.toLocaleString()} players). A player\u2019s model at a tournament is the one they hit the most shots with there. Hover a row for what it means.`),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), ...ps.map((s) => el("th", { class: "num" }, [el("i", { class: "cmp-dot", style: `--c:${colorOf(s)}` }), s.name]))])),
        el("tbody", {}, ROWS.map(([l, f, help], ri) => {
          const tr = el("tr", {}, [el("td", { title: help }, ri === 0 ? [l, el("span", { class: "cmp-tap-hint" }, " \u203a")] : l), ...u.map((x) => el("td", { class: "num" }, x ? f(x) : "\u2014"))]);
          // (update 213) "Players who used it": tap for the list of everyone who did
          if (ri === 0) { tr.classList.add("cmp-tap"); tr.tabIndex = 0; tr.title = "See everyone who used it"; const go = () => openUsers(ps, u); tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); }
          return tr;
        })),
      ])),
    ]);
  }
  // (update 213) everyone who used each product in the comparison, in a pop-up that scrolls
  async function openUsers(ps, u) {
    const { openBadge } = await import("../badgePopup.js");
    const names = new Map(players);
    const nameOf = (pk) => names.get(pk) || String(pk).replace(/^c_/, "");
    const md = (d) => { const t = String(d || "").slice(0, 10); if (!t) return "\u2014"; const x = new Date(`${t}T12:00:00`); return Number.isNaN(+x) ? t : x.toLocaleDateString("en-US", { month: "short", year: "numeric" }); };
    const blocks = ps.map((s, i) => {
      const x = u[i]; if (!x) return null;
      const multiModel = s.f.clubs.length > 1;
      const cols = [["Player"], ...(multiModel ? [["Model"]] : []), ["Rds", "num"], ["Events", "num"], ["Last used", "num"], ["Now", "num"]];
      return { kind: "table", title: `${s.name} \u00b7 ${x.who.length} player${x.who.length === 1 ? "" : "s"}`, cols,
        rows: x.who.map((w) => ({ cells: [nameOf(w.pk), ...(multiModel ? [w.top ? gearLabel(w.top) : "\u2014"] : []), String(w.rounds), String(w.events), md(w.last), { text: w.still ? "\u2713" : "", tone: w.still ? "pos" : "" }] })) };
    }).filter(Boolean);
    openBadge({ text: "Players who used it", info: () => ({ sub: "Most rounds first. Rds: rounds with it. Now \u2713: still their main one at their latest tournament.", blocks }) }, ps.length === 1 ? ps[0].name : "Product usage");
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
      const step = Math.max(1, Math.ceil(it.s.rounds.length / 500)); // (everyone's rounds: a sample of 500 dots, so the chart stays quick)
      it.s.rounds.forEach((v, k) => { if (k % step) return; const jitter = ((k * 37) % 11) / 10 - 0.5; const c = mk("circle", { cx: X(v), cy: cy + jitter * 22, r: 3.2, fill: it.color, "fill-opacity": 0.85 }); c.append(mk("title", {}, `${it.name}: ${fmtSG(v)}`)); g.append(c); });
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
