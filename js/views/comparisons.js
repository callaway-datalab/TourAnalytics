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
import { CATEGORIES, fmtStat, fmtSG, gearInfo, gearLabel } from "../sg.js";
import {
  COLORS, MAX_SEL, SG_ROWS, options, roundsFor, windowFilter, summarize, confidence, distanceProfile, statSets,
  products, insights, fmtSigned, includeShots, shotScope, statBlocks, productUsage, sgRounds,
} from "../compareData.js";
import { renderBlocks } from "../badgePopup.js";

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
  const wanted = q.get("player"); // (update 214: the start screen asks who; only a link from the Stats page picks one)
  if (self) player = { key: self[0], label: self[1] };
  else if (wanted && players.some(([k]) => k === wanted)) player = { key: wanted, label: players.find(([k]) => k === wanted)[1] };
  else if (players.length === 1) player = { key: players[0][0], label: players[0][1] };

  let pickParam = q.get("pick");
  let source = q.get("src") === "entered" ? "entered" : "tour", mode = "years", data = null, opts = null, sels = [], loadingFor = null, chipFilter = "", distCat = "APP", distPer = "round", dim = "round";
  // (update 189) picks wait here until "Add to comparison": several together become one group (their rounds pooled)
  let staged = new Map(); // value → { label, f }
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
  const everyOk = () => staff && source === "tour" && !!dsInfo && !lite;
  const everyLabel = () => `Everyone${everyN ? ` (${everyN.toLocaleString()} players)` : ""}`;
  const inPlay = () => (!player ? [] : !staff ? [player] : chosen.length ? chosen.map((p) => (p.key === EVERY ? { key: EVERY, label: "Everyone" } : p)) : everyOk() ? [{ key: EVERY, label: "Everyone" }] : [player]);
  const multi = () => inPlay().length > 1;
  const roundsOfKey = (k) => (k === player?.key ? data.rounds : others.get(`${k}|${source}`) || []);
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
    mode = "years"; // (update 206) nothing picked to start with: the questions (or your own picks) decide
  }

  // (update 194) opened from the Stats page on one comparison: "win:10" (the last 10 against the 10 before) or "cond:course:Riviera"
  function applyPick(p) {
    const m = /^win:(\d+)$/.exec(p);
    if (m) { const n = Number(m[1]); mode = "windows"; sels = [{ id: `windows:prev:${n}`, name: `The ${n} before that`, f: { prev: n }, mode: "windows", values: [`prev:${n}`], color: COLORS[0] }, { id: `windows:last:${n}`, name: `Last ${n} rounds`, f: { last: n }, mode: "windows", values: [`last:${n}`], color: COLORS[1] }]; touched = true; return; }
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
    if (g.open) { mount(root, [head, guideBox()]); window.scrollTo(0, y); return; }
    mount(root, [
      head,
      guideBox(),
      editBox(),
      items.length ? reportBar(items) : null,
      items.length ? selectedBar(items) : null,
      items.length ? cards(items) : el("section", { class: "panel cmp-empty small" }, el("p", { class: "muted" }, "Pick two or more above to compare them.")),
      items.length >= 2 ? standout(items) : null,
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
      if (res?.datasetId) { source = "tour"; player = { key: k, label: l }; data = { rounds: res.me?.rounds || [] }; others.set(`${k}|tour`, data.rounds); dsInfo = { id: res.datasetId, idx: res.idx }; break; }
    }
    if (!player) { busy = ""; draw(); flashNote("Couldn\u2019t find Tour Events data to compare."); return; }
    productsOnly = true; chosen = []; g = { open: true, who: "everyone" }; opts = options(data.rounds);
    busy = "Loading everyone\u2019s rounds\u2026"; draw();
    await loadEveryone();
    opts = options(allRounds()); defaults(); busy = ""; loadingFor = `${player.key}|tour`;
    draw();
  }
  // (update 211/212) no player: back to the very start (for staff, "Compare everyone"). Start over does this too.
  function clearAll(keepPicks = false) { player = null; data = null; chosen = []; productsOnly = false; sels = []; staged = new Map(); touched = false; g = { open: true }; loadingFor = null; h2h = false; pb.brands.clear(); pb.models.clear(); pb.groups = []; pb.q = ""; if (!keepPicks) startPicks = []; ls.set(LS_PLAYER, ""); draw(); window.scrollTo(0, 0); }
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
    return el("section", { class: "panel cmp-guide cmp-start" }, [
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
    if (g.what === "place" && !g.place) return "place";
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
      if (g.when === "form") { mode = "windows"; out = [mk(`windows:prev:${n}`, `The ${n} before that`, { prev: n }, "windows", [`prev:${n}`]), mk(`windows:last:${n}`, `Last ${n} rounds`, { last: n }, "windows", [`last:${n}`])]; }
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
    if (g.what === "place") {
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
    root.querySelector(".cmp-cards, .cmp-edit")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  /* ------------------------------ (update 210) building product groups ------------------------------ */
  // Kind of club, then brands, then (optionally) models, and a season: each pick becomes a group, e.g. "All Callaway
  // drivers" against "All TaylorMade drivers", "Callaway drivers · 2026" against "· 2025", or two models against one.
  const pb = { kind: null, brands: new Set(), models: new Set(), season: "any", groups: [], q: "" };
  function productBuilder(inGuide) {
    const kinds = products(allRounds());
    if (!kinds.length) return el("div", { class: "cmp-empty-note" }, [el("strong", {}, "No club data in this file yet."), el("p", { class: "muted small" }, "Once the data has each shot\u2019s clubType, clubBrand, clubModel, ballBrand and ballModel, every product shows here.")]);
    // (update 212) the search box: every pill below narrows to what matches as you type (kind, brand or model)
    const words = (pb.q || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (k, o) => { const t = `${groupName(k.group)} ${k.group} ${o.brand} ${o.label}`.toLowerCase(); return words.every((w) => t.includes(w)); };
    const kindsAll = kinds.map((k) => ({ ...k, items: k.items.map((o) => ({ ...o, ...gearInfo(o.value) })) }));
    const kindsShown = words.length ? kindsAll.filter((k) => k.items.some((o) => hit(k, o))) : kindsAll;
    if (!pb.kind || !kindsAll.some((k) => k.group === pb.kind) || (kindsShown.length && !kindsShown.some((k) => k.group === pb.kind))) { pb.kind = (kindsShown[0] || kindsAll[0]).group; pb.brands.clear(); pb.models.clear(); }
    const kindNow = kindsAll.find((k) => k.group === pb.kind);
    const items = kindNow.items;
    const matches = words.length ? items.filter((o) => hit(kindNow, o)) : items;
    const brands = [...new Set([...matches.map((o) => o.brand), ...pb.brands])].filter((b) => items.some((o) => o.brand === b)).sort();
    const pill = (on, label, n, click) => { const b = el("button", { type: "button", class: `cmp-chip${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "\u2713") : null, label, n != null ? el("span", { class: "cmp-chip-n" }, `${n} rds`) : null]); b.addEventListener("click", click); return b; };
    const row = (t, kids) => el("div", { class: "cmp-chip-group" }, [el("p", { class: "cmp-chip-gt" }, t), el("div", { class: "cmp-chips" }, kids)]);
    const kindName = groupName(pb.kind);
    const search = el("input", { type: "search", class: "cmp-pb-q", placeholder: "Search products (e.g. Elyte, TaylorMade, putter)\u2026", autocomplete: "off", enterkeyhint: "search", value: pb.q || "" });
    search.addEventListener("input", () => {
      const pos = search.selectionStart; pb.q = search.value; draw();
      const again = root.querySelector(".cmp-pb-q"); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
    });
    const searchRow = el("div", { class: "cmp-pb-search" }, [search, words.length && !kindsShown.length ? el("p", { class: "muted small" }, `Nothing matches \u201c${pb.q.trim()}\u201d.`) : null]);
    const kindRow = row("Kind of club", kindsShown.map((k) => pill(pb.kind === k.group, groupName(k.group), null, () => { pb.kind = k.group; pb.brands.clear(); pb.models.clear(); draw(); })));
    const brandRow = row("Brand", brands.map((b) => pill(pb.brands.has(b), b, null, () => { pb.brands.has(b) ? pb.brands.delete(b) : pb.brands.add(b); for (const m of [...pb.models]) if (!pb.brands.has(items.find((o) => o.value === m)?.brand)) pb.models.delete(m); draw(); })));
    const shown = items.filter((o) => pb.brands.has(o.brand));
    const modelPills = (words.length ? [...new Map([...shown.filter((o) => matches.includes(o) || pb.models.has(o.value)), ...matches].map((o) => [o.value, o])).values()] : shown);
    const modelRow = pb.brands.size || words.length ? row(words.length && !pb.brands.size ? "Model" : "Model (none picked = every model of those brands)", modelPills.map((o) => pill(pb.models.has(o.value), o.label, o.n, () => { if (pb.models.has(o.value)) pb.models.delete(o.value); else { pb.models.add(o.value); pb.brands.add(o.brand); } draw(); }))) : null;
    const seasonRow = opts.years.length > 1 ? row("Season", [["any", "Any season"], ...opts.years.map((y) => [y.value, y.label])].map(([v, l]) => pill(pb.season === v, l, null, () => { pb.season = v; draw(); }))) : null;
    // the group the picks make
    const pickVals = pb.models.size ? [...pb.models] : shown.map((o) => o.value);
    const yrs = pb.season === "any" ? null : [pb.season];
    const nameOf = (vals, all) => {
      const ls = vals.map((v) => items.find((o) => o.value === v)?.label || v);
      const bs = [...new Set(vals.map((v) => items.find((o) => o.value === v)?.brand))];
      const base = all ? `All ${bs.length === 1 ? `${bs[0]} ` : bs.length === 2 ? `${bs[0]} + ${bs[1]} ` : ""}${kindName.toLowerCase()}` : ls.length === 1 ? ls[0] : ls.length === 2 ? `${ls[0]} + ${ls[1]}` : `${ls[0]}, ${ls[1]} + ${ls.length - 2} more`;
      return `${base}${yrs ? ` \u00b7 ${yrs[0]}` : ""}`;
    };
    const groupOfVals = (vals, name) => { const f = { clubs: vals, ...(yrs ? { years: yrs } : {}) }; return { id: `product:${[...vals].sort().join("|")}${yrs ? `@${yrs[0]}` : ""}`, name, f, n: roundsFor(allRounds(), f).length }; };
    const cur = pickVals.length ? groupOfVals(pickVals, nameOf(pickVals, !pb.models.size)) : null;
    const taken = new Set((inGuide ? pb.groups : sels.filter((s) => s.f?.clubs)).flatMap((x) => x.f.clubs));
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
    const restB = restVals.length && (taken.size || cur) ? el("button", { type: "button", class: "btn ghost" }, `\uff0b All the other ${kindName.toLowerCase()}${yrs ? ` \u00b7 ${yrs[0]}` : ""}`) : null;
    restB?.addEventListener("click", () => { if (cur) addGroup(cur); const g2 = groupOfVals(restVals.filter((v) => !(cur?.f.clubs || []).includes(v)), `All other ${kindName.toLowerCase()}${yrs ? ` \u00b7 ${yrs[0]}` : ""}`); if (g2.f.clubs.length) addGroup(g2); });
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
      inGuide ? el("p", { class: "muted small" }, "Make each group: pick a kind of club, then one or more brands (and models, if you want just some), and a season. Add it, then make the next. E.g. all Callaway drivers vs all TaylorMade drivers, or two Callaway models vs one Titleist.") : null,
      searchRow, kindRow, brandRow, modelRow, seasonRow, el("div", { class: "cmp-guide-row" }, [sepB, addB, restB]), hint, groupsBox, go,
    ]);
  }
  function guideSummary() {
    const who = g.who === "everyone" ? "Everyone in the data" : g.who === "several" ? inPlay().map((p) => p.label).join(", ") : player.label;
    const what = g.what === "time" ? { seasons: "this season vs last season", form: "recent form against the rounds before", career: "this season vs their whole career", own: "dates of your own" }[g.when]
      : g.what === "gear" ? "products" : g.what === "place" ? `by ${g.place === "rounds" ? "round" : g.place.replace(/s$/, "")}` : g.what === "versus" ? `against each other${g.h2h ? ", head to head" : ""}, ${SEASONS.find(([x]) => x === g.stretch)?.[1].toLowerCase()}` : "";
    return `${who} · ${what}`;
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
        opts.courses.length > 1 ? opt("courses", "Course", "Their 4 most-played courses") : null,
        opts.tournaments.length > 1 ? opt("tournaments", "Tournament", "Their latest 4 tournaments") : null,
        opts.rounds.length > 1 ? opt("rounds", "Round", "Round 1 against round 2, 3 and 4") : null,
        opts.months.length > 1 ? opt("months", "Time of year", "Their 4 busiest months") : null,
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
      el("summary", {}, [el("span", { class: "cmp-edit-t" }, "Edit the filters yourself"), el("span", { class: "muted small" }, "Players, seasons, tournaments, products, which shots count…")]),
      playersRow(), builder(),
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
    else if (mode === "product") body = productBuilder(false);
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
    return el("section", { class: "panel cmp-build" }, [el("div", { class: "cmp-build-top" }, [el("h2", {}, "Compare by"), sourceSeg()]), tabs, hint, body, note, includeRow()]);
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
    return el("section", { class: "cmp-cards" }, items.map((it) => hoverable(tapCard(el("article", { class: "panel cmp-card", style: `--c:${it.color}`, "data-s": it.i }, [
      el("div", { class: "cmp-card-top" }, [el("span", { class: "cmp-card-name" }, it.name)]),
      it.s.n ? el("p", { class: "cmp-card-meta" }, `${it.s.n.toLocaleString()} round${it.s.n === 1 ? "" : "s"} \u00b7 ${it.s.events} event${it.s.events === 1 ? "" : "s"} \u00b7 ${dateTxt(it.s.from)} \u2013 ${dateTxt(it.s.to)}`) : el("p", { class: "cmp-card-meta" }, "No rounds"),
      // (update 210) a small sample says so, so 3 rounds isn't read like 60
      it.s.n && it.s.n < FEW ? el("p", { class: "cmp-few" }, `Only ${it.s.n} round${it.s.n === 1 ? "" : "s"}: read with care.`) : null,
      el("div", { class: "cmp-card-big" }, [el("strong", { class: tone(it.s.sg.TOTAL) }, it.s.n ? fmtSG(it.s.sg.TOTAL) : "\u2014"), el("span", {}, `SG: ${head[1]} a round`)]),
      used.length > 1 ? el("div", { class: "cmp-card-cats", style: `grid-template-columns:repeat(${used.length},1fr)` }, used.map(([k]) => el("div", {}, [el("span", {}, k), el("strong", { class: tone(it.s.sg[k]) }, it.s.n ? fmtSG(it.s.sg[k]) : "\u2014")]))) : null,
      it.s.n >= 2 ? el("p", { class: "cmp-card-foot" }, `Best ${fmtSG(it.s.best)} \u00b7 worst ${fmtSG(it.s.worst)} \u00b7 ${Math.round(it.s.gaining * 100)}% of rounds gaining`) : null,
      it.s.n ? el("p", { class: "cmp-card-tap" }, "Tap for the tournaments \u203a") : null,
    ]), it), it.i)));
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
    for (const rd of rs) { const k = `${rd.pk || ""}|${rd.event || "\u2014"}|${rd.year || String(rd.date || "").slice(0, 4)}`; (evs.get(k) || evs.set(k, { event: rd.event || "\u2014", rounds: [] }).get(k)).rounds.push(rd); }
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
          el("td", {}, [el("span", { class: "cmp-ev-caret", "aria-hidden": "true" }, on ? "\u25be " : "\u25b8 "), e.event, el("span", { class: "muted cmp-ev-date" }, dateTxt(e.rounds.at(-1).date))]),
          el("td", { class: "num" }, String(e.rounds.length)), ...SGK.map(([k]) => td(avg(e.rounds, k), k === "TOTAL"))]);
        const flip = () => { if (all) { all = false; list.forEach((_, j) => open.add(j)); } open.has(i) ? open.delete(i) : open.add(i); paint(); };
        tr.addEventListener("click", flip); tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") flip(); });
        rows.push(tr);
        if (on) for (const rd of e.rounds) rows.push(el("tr", { class: "cmp-rd-row" }, [el("td", {}, [rd.roundNo ? `Round ${rd.roundNo}` : "Round", el("span", { class: "cmp-ev-date" }, dateTxt(rd.date))]), el("td", { class: "num muted" }, ""), ...SGK.map(([k]) => td(rdSG(rd, k), k === "TOTAL"))]));
      }
      mount(body, el("div", { class: "wl-pop-tw" }, el("table", { class: "wl-pop-table cmp-ev-table" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Tournament"), el("th", { class: "num" }, "Rds"), ...SGK.map(([, l]) => el("th", { class: "num" }, l))])),
        el("tbody", {}, rows),
      ])));
    };
    allB.addEventListener("click", () => { all = !all; if (!all) open.clear(); paint(); });
    paint();
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": it.name }, el("div", { class: "gx-pop wl-pop cmp-rd-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, `${it.s.n} round${it.s.n === 1 ? "" : "s"} \u00b7 ${list.length} tournament${list.length === 1 ? "" : "s"}`), el("h2", {}, [el("i", { class: "cmp-dot", style: `--c:${it.color}` }), it.name]),
        el("p", { class: "gx-sub" }, "Strokes gained a round at each tournament, latest first. Tap one to see its rounds.")]), close]),
      el("div", { class: "cmp-rd-acts" }, allB), body]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll"); document.body.appendChild(overlay); close.focus();
  }
  // (update 215) time frames: every round in order, the ones being compared in their colour, each one's average dashed
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
      const bars = rs.map((rd) => { const it = inIt.get(rd.key); return { label: dateTxt(rd.date), sub: [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" \u00b7 "), v: rdSG(rd, "TOTAL"), on: !!it, color: it?.color }; });
      const ref = mine.map((it) => { const idx = rs.map((rd, i) => (it.rs.some((x) => x.key === rd.key) ? i : -1)).filter((i) => i >= 0); return idx.length ? { v: it.s.sg.TOTAL, label: it.name.replace(/^.* \u00b7 /, ""), from: idx[0], to: idx.at(-1) + 1, color: it.color } : null; }).filter(Boolean);
      return { kind: "bars", fmt: "sg", items: bars, ref, title: pks.length > 1 || multi() ? (players.find(([k]) => k === pk)?.[1] || (pk === player?.key ? player.label : pk)) : null };
    }).filter(Boolean);
    if (!blocks.length) return null;
    return el("section", { class: "panel cmp-sec" }, [
      secHead("Round by round", "SG: Total in every round, in order. The rounds being compared are in their colour; each dashed line is that group\u2019s average."),
      el("div", { class: "cmp-legend" }, items.filter((it) => it.s.n).map((it) => el("span", { class: "cmp-legend-i" }, [el("i", { style: `background:${it.color}` }), it.name]))),
      ...renderBlocks(blocks),
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
      conf = el("p", { class: "muted small" }, [`Best against worst in SG: ${used1(live)}: ${fmtSigned(s[0].s.sg.TOTAL - s.at(-1).s.sg.TOTAL)} a round, `, el("strong", { class: `cmp-conf c-${c.word.replace(/ /g, "-")}` }, c.word), ` (allowing for how much rounds vary${c.word === "too few rounds" ? "" : `; z = ${Math.abs(c.z).toFixed(1)}`}).`]);
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
    const fallback = insights(live.map((it) => ({ name: it.name, s: it.s }))).map((x) => x.text).join(" ");
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
      cols: live.map((it) => ({ name: it.name, n: it.s.n, few: it.s.n < FEW })), rows,
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
    const ps = sels.filter((s) => s.f?.clubs?.length);
    const pooled = others.get(`${EVERY}|tour`);
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
