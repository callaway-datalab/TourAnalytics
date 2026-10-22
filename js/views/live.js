// (update 259) Live Feed: the latest tournaments in the data, round by round, the way a live leaderboard reads them.
// One tournament of each tour up top (the newest), any earlier one a tap away; R1–R4 and the Event (each player's
// strokes gained added up over the rounds played); a leaderboard of strokes gained and stats that sorts by any
// column, with ranks, a Columns picker and Min Sample; and a card for any player.
// It reads the field summary of the newest strokes-gained file (fieldSummary.js), the same numbers as Leaderboards,
// and redraws by itself when a new file is uploaded.
import { el, mount } from "../ui.js";
import { CATEGORIES, statRounds, statAgg, statsIn, statDef, fmtStat } from "../sg.js";
import { watchNewestDataset, fieldOf } from "../fieldSummary.js";

const SPLITS = CATEGORIES.map(([k, l]) => [k, l]); // OTT, APP, ARG, PUTT
const COLS = [["TOTAL", "Total"], ...SPLITS, ["T2G", "Tee-to-Green"]];
const ROUNDS = [["1", "R1"], ["2", "R2"], ["3", "R3"], ["4", "R4"], ["event", "Event"]];
const BASE_KEYS = COLS.map((c) => c[0]);
const MIN_N = { round: 3, event: 5 };
// which group each stat goes in, for the Columns picker (the same homes Compare uses), and the ones on by default
const GROUP = { drive: "Driving", fwy: "Driving", gir: "Approach", hitGreen: "Approach", prox: "Approach", pinHigh: "Approach - More", onLine: "Approach - More",
  ud: "Short Game", scramble: "Short Game", putts: "Putting", make: "Putting", goodLag: "Putting - More", threePutt: "Putting",
  scoring: "Scoring", par3: "Scoring - More", par4: "Scoring - More", par5: "Scoring - More", eagles: "Scoring", birdiesRd: "Scoring", parsRd: "Scoring - More",
  bogeysRd: "Scoring", dblBogeysRd: "Scoring - More", birdie: "Scoring - More", parOrBetter: "Scoring - More", bogey: "Scoring - More", owgr: "More Stats" };
const ON = new Set(["drive", "fwy", "gir", "prox", "scramble", "putts", "birdiesRd", "bogeysRd"]);
const ls = {
  get: (k, d = null) => { try { const v = localStorage.getItem(`lv.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`lv.${k}`, JSON.stringify(v)); } catch { /* private window */ } },
};
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.\-]/g, " ").trim();
const fmt = (n) => { if (n == null) return "\u2013"; const r = Math.round(n * 100) / 100; return (r > 0 ? "+" : r < 0 ? "\u2212" : "") + Math.abs(r).toFixed(2); }; // (rounds first: no "\u22120.00")
const tone = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
const ago = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const dayTxt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }) : "");
const dk = (rd) => String(rd.date || "").slice(0, 10);
const yr = (rd) => String(rd.year || dk(rd).slice(0, 4));
const sgOf = (rd, cat) => rd.shots.reduce((t, s) => t + (!cat || cat === "TOTAL" || s.cat === cat || (cat === "T2G" && s.cat !== "PUTT") ? s.sg || 0 : 0), 0);

/* ---------------------------------------------------------------- the field, as tournaments */
/** Every tournament in the field: [{ id, tour, event, year, course, start, end, roundNos, players: Map(key → { name, rounds }) }], newest first. */
function tournaments(field) {
  const evs = new Map(), byName = new Map();
  const near = (a, b) => Math.abs(Date.parse(`${a}T12:00:00`) - Date.parse(`${b}T12:00:00`)) <= 10 * 864e5;
  for (const p of field) for (const rd of p.rounds) {
    if (!rd.event || rd.eventLevel || !rd.shots?.length) continue;
    const tour = rd.tour || "Tour", base = `${tour}|${rd.event}|${yr(rd)}`;
    // the same name twice in a year (two playings): a tournament is the rounds within days of each other
    const list = byName.get(base) || byName.set(base, []).get(base);
    let e = list.find((x) => !dk(rd) || near(dk(rd), x.start) || near(dk(rd), x.end));
    if (!e) { const id = list.length ? `${base}|${dk(rd)}` : base; e = { id, tour, event: rd.event, year: yr(rd), course: rd.course || null, start: dk(rd), end: dk(rd), roundNos: new Set(), players: new Map() }; list.push(e); evs.set(id, e); }
    if (dk(rd) && (!e.start || dk(rd) < e.start)) e.start = dk(rd);
    if (dk(rd) > e.end) e.end = dk(rd);
    if (rd.roundNo) e.roundNos.add(String(rd.roundNo));
    const pl = e.players.get(p.key) || e.players.set(p.key, { key: p.key, name: p.name, rounds: [] }).get(p.key);
    pl.rounds.push(rd);
  }
  return [...evs.values()].sort((a, b) => b.end.localeCompare(a.end) || b.players.size - a.players.size);
}
/** Live while it's recent and not all four rounds are in; final otherwise. */
function statusOf(e) {
  const days = (Date.now() - new Date(`${e.end}T12:00:00`).getTime()) / 864e5;
  return days <= 3 && Math.max(0, ...[...e.roundNos].map(Number)) < 4 ? "live" : "final";
}
/** One tournament as leaderboard rows: { rounds: { "1": { round, rows } … }, event: { rows }, latest_round, stats: [keys] } */
function board(e) {
  const rowOf = (pl, rs, isEvent) => {
    const r = { player_id: pl.key, name: pl.name, rounds: rs.length, x: {} };
    // a round: its strokes gained; the Event: added up over the rounds played (stats are averaged, weighted by attempts)
    for (const [k] of COLS) { const v = rs.reduce((t, rd) => t + sgOf(rd, k), 0); r[k] = { [isEvent ? "event" : "round"]: v }; }
    for (const k of statsIn([rs])) {
      if (k === "sg") continue;
      const a = statAgg(statRounds(rs, k));
      if (a.value == null) continue;
      const d = statDef(k), counts = d.pct || k === "prox";
      const made = d.pct && a.w ? Math.round((a.value * a.w) / 100) : null;
      r.x[k] = { v: a.value, n: counts ? Math.round(a.w) : null, d: fmtStat(d, a.value) + (counts && a.w ? (d.pct ? ` (${made}/${Math.round(a.w)})` : ` (${Math.round(a.w)})`) : "") };
    }
    return r;
  };
  const rounds = {};
  for (const n of [...e.roundNos].sort()) {
    const rows = [...e.players.values()].map((pl) => { const rs = pl.rounds.filter((rd) => String(rd.roundNo) === n); return rs.length ? rowOf(pl, rs, false) : null; }).filter(Boolean);
    if (rows.length) rounds[n] = { round: Number(n), rows };
  }
  const event = { round: Math.max(0, ...Object.keys(rounds).map(Number)) || null, rows: [...e.players.values()].map((pl) => rowOf(pl, pl.rounds, true)) };
  const latest = Math.max(0, ...Object.keys(rounds).map(Number)) || null;
  const keys = new Set();
  for (const r of event.rows) for (const k of Object.keys(r.x)) keys.add(k);
  return { rounds, event, latest_round: latest, stats: statsIn([[...e.players.values()].flatMap((pl) => pl.rounds)]).filter((k) => keys.has(k)) };
}

export async function render(main) {
  const root = el("div", { class: "lv" });
  mount(main, root);

  // ------------------------------------------------------------------ state
  let field = [], tours = [], events = [], lb = null, file = null, statsMeta = [], metaById = {}, uploadedAt = null, loadErr = "", version = null;
  let visible = ls.get("cols2", null); // null = the default columns
  let showRanks = ls.get("ranks", true), minOn = ls.get("min", true), wide = ls.get("wide", false);
  let sel = { player: null, t: null, view: "latest" }, sortKey = "TOTAL", sortDir = -1;
  let colsOpen = false, pickerQ = "", q = "";
  const famOpen = {}, subOpen = {};
  let ranksCache = {};

  const valKey = () => (sel.view === "event" ? "event" : "round");
  const saveVisible = () => ls.set("cols2", visible);
  const allKeys = () => BASE_KEYS.concat(statsMeta.map((m) => `x:${m.id}`));
  const defaultKeys = () => BASE_KEYS.concat(statsMeta.filter((m) => m.default !== false).map((m) => `x:${m.id}`));
  const isOn = (key) => (visible === null ? defaultKeys().includes(key) : visible.includes(key));
  const columns = () => COLS.filter(([k]) => isOn(k)).map(([key, label]) => ({ key, label }))
    .concat(statsMeta.filter((m) => isOn(`x:${m.id}`)).map((m) => ({ key: `x:${m.id}`, label: m.label, tip: (m.tip || "") + (m.lower ? " (Lower is better.)" : ""), id: m.id, lower: m.lower })));
  const lowSample = (id, e) => { const m = metaById[id]; if (!minOn || !m || !m.counts || !e || e.n == null) return false; return e.n < MIN_N[valKey()]; };
  const getVal = (r, key, k) => { if (!key.startsWith("x:")) return r[key]?.[k]; const id = key.slice(2), e = r.x?.[id]; if (!e) return undefined; return lowSample(id, e) ? null : e.v; };
  const lowerOf = (key) => (key.startsWith("x:") ? !!metaById[key.slice(2)]?.lower : false);
  function ranksFor(key) {
    if (ranksCache[key]) return ranksCache[key];
    const k = valKey(), lower = lowerOf(key), items = [];
    (lb?.rows || []).forEach((r) => { const v = getVal(r, key, k); if (v != null) items.push([r.player_id, v]); });
    items.sort((a, b) => (lower ? a[1] - b[1] : b[1] - a[1]));
    const rank = {}, tally = {}; let prev, cur = 0;
    items.forEach(([pid, v], i) => { if (i === 0 || Math.abs(v - prev) > 1e-9) cur = i + 1; rank[pid] = cur; tally[cur] = (tally[cur] || 0) + 1; prev = v; });
    return (ranksCache[key] = { rank, tally, n: items.length });
  }
  const rankText = (key, pid) => { if (key.startsWith("x:") && metaById[key.slice(2)]?.rank === false) return null; const R = ranksFor(key), n = R.rank[pid]; return n == null ? null : R.tally[n] > 1 ? `T${n}` : String(n); };

  // ------------------------------------------------------------------ the page's parts (kept, and redrawn on their own)
  const head = el("div", { class: "lv-head" });
  const tourBox = el("div", { class: "lv-tours" });
  const roundBox = el("div", { class: "seg small lv-rounds", role: "group", "aria-label": "Round" });
  const searchIn = el("input", { type: "search", class: "lv-q", placeholder: "Search a player…", autocomplete: "off", autocapitalize: "words", "aria-label": "Search a player" });
  const results = el("ul", { class: "lv-results" });
  const playerBox = el("div", { class: "lv-player" });
  const toolbar = el("div", { class: "lv-tools" });
  const colPanel = el("div", { class: "lv-colpanel", hidden: true });
  const boardWrap = el("div", { class: "lv-board" }, el("p", { class: "muted lv-msg" }, "Loading…"));
  const meta = el("p", { class: "muted small lv-meta" });
  const grid = el("div", { class: `lv-grid${wide ? " wide" : ""}` }, [
    el("section", { class: "panel lv-side" }, [searchIn, results, playerBox]),
    el("section", { class: "panel lv-main" }, [
      el("div", { class: "lv-main-top" }, [el("div", {}, [el("h2", {}, "Leaderboard"), meta]), toolbar]),
      colPanel, boardWrap,
      el("details", { class: "lv-legend" }, [el("summary", {}, "How to read this"),
        el("p", { class: "muted small" }, "Each round shows the strokes gained and stats of that round. The Event tab adds each player’s strokes gained up over the rounds they played (RDS); other stats are averaged over those rounds, weighted by attempts. The small grey number under each value is its rank (T = tied) among the players shown; for lower-is-better stats the lowest value ranks first, and the first tap on its heading sorts lowest first. Min Sample greys out percentages and averages built on very few attempts (under 3 in a round, under 5 for the event) and leaves them out of ranks and sorting. The numbers are the latest uploaded data file’s, the same as Leaderboards; this page updates by itself when a new file is uploaded.")]),
    ]),
  ]);
  mount(root, [head, el("div", { class: "lv-pick" }, [tourBox, roundBox]), grid]);

  // ------------------------------------------------------------------ header, tours, rounds, toolbar
  function drawHead() {
    const st = sel.t ? statusOf(sel.t) : null;
    mount(head, [
      el("div", {}, [el("p", { class: "gx-eyebrow" }, "Live"), el("h1", {}, "Live Feed")]),
      st ? el("span", { class: `lv-status${st === "live" ? " on" : ""}` }, [el("i", { "aria-hidden": "true" }), st === "live" ? "In progress" : "Final"]) : null,
    ]);
  }
  function drawTours() {
    mount(tourBox, tours.map((t) => {
      const shown = sel.t && sel.t.tour === t.tour ? sel.t : t.events[0];
      const on = sel.t?.tour === t.tour, live = statusOf(shown) === "live";
      const card = el("button", { type: "button", class: `lv-tour${on ? " on" : ""}`, "aria-pressed": String(on) }, [
        el("span", { class: "lv-tour-k" }, [live ? el("i", { class: "lv-dot", "aria-hidden": "true" }) : null, t.tour]),
        el("span", { class: "lv-tour-n" }, shown.event), el("span", { class: "lv-tour-s muted" }, `${dayTxt(shown.start)}${shown.end !== shown.start ? `–${dayTxt(shown.end)}` : ""}, ${shown.year} · ${live ? "in progress" : "final"} · ${shown.players.size} players`)]);
      card.addEventListener("click", () => { if (on) return; pickEvent(t.events[0]); });
      // earlier tournaments of this tour
      const pick = t.events.length > 1 ? el("select", { class: "lv-ev", "aria-label": `${t.tour} tournament` }, t.events.slice(0, 60).map((e, i) => el("option", { value: e.id, selected: shown.id === e.id }, `${i === 0 ? "Latest: " : ""}${e.event} (${dayTxt(e.start)}, ${e.year})`))) : null;
      pick?.addEventListener("change", () => pickEvent(events.find((e) => e.id === pick.value)));
      return el("div", { class: "lv-tour-box" }, [card, pick]);
    }));
  }
  function pickEvent(e) { if (!e) return; sel.t = e; sel.view = "latest"; refresh(); }
  function drawRounds(active) {
    mount(roundBox, ROUNDS.map(([v, l]) => {
      const on = v === active;
      const has = !file ? true : v === "event" ? !!file.event?.rows?.length : !!file.rounds?.[v]?.rows?.length; // (rounds not in the data yet can't be picked)
      const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on), disabled: file && !has ? true : null, title: file && !has ? "No data for this round yet" : "" }, l);
      b.addEventListener("click", () => { sel.view = v; refresh(); });
      return b;
    }));
  }
  function drawTools() {
    const tg = (label, on, title, click, cls = "") => { const b = el("button", { type: "button", class: `cmp-chip small lv-tg${on ? " on" : ""} ${cls}`, "aria-pressed": String(on), title }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "✓") : null, label]); b.addEventListener("click", click); return b; };
    mount(toolbar, [
      tg(`Columns (${columns().length})`, colsOpen, "Choose which stats show", () => { colsOpen = !colsOpen; colPanel.hidden = !colsOpen; drawTools(); if (colsOpen) drawPicker(); }, "lv-colbtn"),
      tg("Ranks", showRanks, "Show each value’s rank under it", () => { showRanks = !showRanks; ls.set("ranks", showRanks); drawTools(); drawBoard(); }),
      tg("Min Sample", minOn, "Grey out small samples and leave them out of ranks and sorting", () => { minOn = !minOn; ls.set("min", minOn); ranksCache = {}; drawTools(); drawBoard(); drawPlayer(); }),
      tg("Full Width", wide, "Give the leaderboard the whole width", () => { wide = !wide; ls.set("wide", wide); grid.classList.toggle("wide", wide); drawTools(); fitTable(); }, "lv-widebtn"),
    ]);
  }

  // ------------------------------------------------------------------ the Columns picker: category > sub-category > stat
  function pickerTree() {
    const fams = [], byFam = {};
    const add = (group, key, label, def) => {
      const fam = group.split(" - ")[0];
      if (!byFam[fam]) { byFam[fam] = { name: fam, subs: [], map: {} }; fams.push(byFam[fam]); }
      const F = byFam[fam];
      if (!F.map[group]) { F.map[group] = { group, name: group === fam ? "Main" : group.slice(fam.length + 3), items: [] }; F.subs.push(F.map[group]); }
      F.map[group].items.push({ key, label, def, group });
    };
    COLS.forEach(([k, l]) => add("Strokes Gained", k, l, true));
    statsMeta.forEach((m) => add(m.group || "More Stats", `x:${m.id}`, m.label, m.default !== false));
    return fams;
  }
  const stateOf = (items) => { const n = items.filter((i) => isOn(i.key)).length; return n === 0 ? "off" : n === items.length ? "on" : "part"; };
  function setKeys(keys, on) {
    const cur = visible === null ? defaultKeys() : visible;
    visible = on ? [...new Set([...cur, ...keys])] : cur.filter((x) => !keys.includes(x));
    saveVisible(); ranksCache = {}; drawPicker(); drawTools(); drawBoard(); drawPlayer();
  }
  function drawPicker() {
    if (!colsOpen) return;
    const keepTop = colPanel.scrollTop;
    const statChip = (i) => { const on = isOn(i.key); const b = el("button", { type: "button", class: `cmp-chip small${on ? " on" : ""}`, "aria-pressed": String(on), title: `${i.label}${i.group ? `  (${i.group})` : ""}` }, [on ? el("span", { class: "cmp-chip-tick", "aria-hidden": "true" }, "✓") : null, i.label]); b.addEventListener("click", () => setKeys([i.key], !on)); return b; };
    const triChip = (text, items, title) => { const st = stateOf(items), n = items.filter((i) => isOn(i.key)).length; const b = el("button", { type: "button", class: `cmp-chip small lv-tri ${st}`, title }, [text, el("span", { class: "cmp-chip-n" }, `${n}/${items.length}`)]); b.addEventListener("click", () => setKeys(items.map((i) => i.key), st !== "on")); return b; };
    const caret = (open, title, click) => { const b = el("button", { type: "button", class: `lv-car${open ? " open" : ""}`, title, "aria-expanded": String(open) }, open ? "▾" : "▸"); b.addEventListener("click", click); return b; };
    const fams = pickerTree();
    const search = el("input", { type: "search", class: "cmp-chip-search lv-csearch", placeholder: "Find a stat…", value: pickerQ, autocomplete: "off" });
    search.addEventListener("input", () => { const pos = search.selectionStart; pickerQ = search.value; drawPicker(); const s = colPanel.querySelector(".lv-csearch"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch { /* */ } } });
    const btns = [["Default", () => null], ["All", () => allKeys()], ["None", () => []]].map(([name, make]) => { const b = el("button", { type: "button", class: "btn ghost small" }, name); b.addEventListener("click", () => { visible = make(); saveVisible(); ranksCache = {}; drawPicker(); drawTools(); drawBoard(); drawPlayer(); }); return b; });
    const parts = [el("div", { class: "lv-crow" }, [search, el("span", { class: "lv-cbtns" }, btns)])];
    const qq = pickerQ.trim().toLowerCase();
    if (qq) {
      const found = fams.flatMap((F) => F.subs.flatMap((s) => s.items)).filter((i) => i.label.toLowerCase().includes(qq) || i.group.toLowerCase().includes(qq));
      parts.push(el("div", { class: "cmp-chips" }, found.length ? found.slice(0, 60).map(statChip) : el("span", { class: "muted small" }, "No stats match.")));
    } else {
      parts.push(el("p", { class: "muted small" }, "Tap a category to show or hide all of its stats; the arrow opens it to pick individual ones."));
      parts.push(el("div", { class: "cmp-chips" }, fams.map((F) => el("span", { class: "lv-fam" }, [triChip(F.name, F.subs.flatMap((s) => s.items), `Show or hide all ${F.name} stats`), caret(!!famOpen[F.name], `Choose individual ${F.name} stats`, () => { famOpen[F.name] = !famOpen[F.name]; drawPicker(); })]))));
      for (const F of fams.filter((F0) => famOpen[F0.name])) {
        parts.push(el("div", { class: "lv-cdetail" }, [
          el("p", { class: "cmp-chip-gt" }, F.name),
          el("div", { class: "cmp-chips" }, F.subs.map((S) => el("span", { class: "lv-fam" }, [triChip(S.name, S.items, `Show or hide ${S.group}`), caret(!!subOpen[S.group], "Choose individual stats", () => { subOpen[S.group] = !subOpen[S.group]; drawPicker(); })]))),
          ...F.subs.filter((S) => subOpen[S.group]).map((S) => el("div", { class: "cmp-chips lv-cstats" }, S.items.map(statChip))),
        ]));
      }
    }
    mount(colPanel, parts);
    colPanel.scrollTop = keepTop;
  }

  // ------------------------------------------------------------------ the leaderboard
  function fitTable() {
    const table = boardWrap.querySelector("table");
    if (!table) return;
    for (let d = 0; d <= 3; d++) { boardWrap.dataset.density = String(d); if (table.scrollWidth <= boardWrap.clientWidth + 1) break; }
  }
  function drawMeta() {
    if (!sel.t) { meta.textContent = ""; return; }
    meta.textContent = [sel.t.tour, sel.t.event, sel.t.course, lb?.round ? (sel.view === "event" ? "Event total" : `Round ${lb.round}`) : null,
      uploadedAt ? `Data as of ${new Date(uploadedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (${ago(uploadedAt)})` : null,
      navigator.onLine === false ? "offline" : null].filter(Boolean).join(" · ");
  }
  function drawBoard(scrollToSel) {
    drawMeta();
    if (loadErr) { mount(boardWrap, el("p", { class: "lv-msg lv-err" }, loadErr)); return; }
    if (!lb || !lb.rows.length) { mount(boardWrap, el("p", { class: "muted lv-msg" }, lb?.note || "No data yet.")); return; }
    const keepTop = boardWrap.scrollTop, keepLeft = boardWrap.scrollLeft;
    const k = valKey(), cols = columns();
    if (!cols.some((c) => c.key === sortKey) && cols.length) sortKey = cols[0].key;
    const get = (r) => getVal(r, sortKey, k);
    const rows = [...lb.rows].sort((a, b) => { const x = get(a), y = get(b); if (x == null && y == null) return a.name.localeCompare(b.name); if (x == null) return 1; if (y == null) return -1; return (x - y) * sortDir || a.name.localeCompare(b.name); });
    const vals = rows.map(get), rankNum = [], tally = {}; // ties share a place: T3, T3, 5
    vals.forEach((v, i) => { rankNum[i] = v == null ? null : i > 0 && vals[i - 1] != null && Math.abs(vals[i - 1] - v) < 1e-9 ? rankNum[i - 1] : i + 1; if (rankNum[i] != null) tally[rankNum[i]] = (tally[rankNum[i]] || 0) + 1; });
    const place = (i) => (rankNum[i] == null ? "–" : tally[rankNum[i]] > 1 ? `T${rankNum[i]}` : String(rankNum[i]));
    const heads = [["#"], ["Player"], ...cols.map((c) => [c.label, c.key, c.tip, c.lower]), ...(sel.view === "event" ? [["RDS"]] : [])].map(([label, key, tip, lower]) => {
      const on = key && key === sortKey;
      const th = el("th", { title: tip || null, class: key ? "lv-sort" : null, "aria-sort": on ? (sortDir < 0 ? "descending" : "ascending") : null, tabindex: key ? "0" : null }, [label, on ? el("span", { class: "lv-arrow", "aria-hidden": "true" }, sortDir < 0 ? " ▼" : " ▲") : null]);
      if (key) {
        const go = () => { if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = lower ? 1 : -1; } drawBoard(); };
        th.addEventListener("click", go);
        th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      }
      return th;
    });
    const body = rows.map((r, i) => {
      const cells = cols.map((c) => {
        let v, cls, title = null;
        if (c.id) {
          const e = r.x?.[c.id];
          v = e?.d ?? "–"; cls = "lv-ex";
          if (lowSample(c.id, e)) { cls += " lv-low"; title = `Fewer than ${MIN_N[k]} attempts: not ranked or sorted`; }
        } else { const n = r[c.key]?.[k]; v = fmt(n); cls = tone(n); }
        const rt = showRanks ? rankText(c.key, r.player_id) : null;
        return el("td", { class: cls, title }, [el("span", { class: "lv-v" }, v), rt ? el("small", { class: "lv-rk" }, rt) : null]);
      });
      const tr = el("tr", { class: sel.player?.player_id === r.player_id ? "sel" : null, dataset: { id: r.player_id } }, [el("td", { class: "lv-pos" }, place(i)), el("td", { title: r.name }, r.name), ...cells, sel.view === "event" ? el("td", { class: "muted" }, String(r.rounds ?? "–")) : null]);
      tr.addEventListener("click", () => pick({ player_id: r.player_id, name: r.name }));
      return tr;
    });
    mount(boardWrap, el("table", { class: "lv-table" }, [el("thead", {}, el("tr", {}, heads)), el("tbody", {}, body)]));
    fitTable();
    boardWrap.scrollTop = keepTop; boardWrap.scrollLeft = keepLeft;
    const s = boardWrap.querySelector("tr.sel");
    if (scrollToSel && s) { const rr = s.getBoundingClientRect(), wr = boardWrap.getBoundingClientRect(); boardWrap.scrollTop += rr.top - wr.top - boardWrap.clientHeight / 2 + rr.height / 2; }
  }

  // ------------------------------------------------------------------ search and the player card
  function drawResults() {
    const toks = norm(q).split(/\s+/).filter(Boolean);
    if (!toks.length) { mount(results, null); return; }
    const inEvent = new Set(sel.t ? sel.t.players.keys() : []);
    const hits = field.filter((p) => { const w = norm(p.name).split(" "); return toks.every((t) => w.some((x) => x.startsWith(t))); })
      .sort((a, b) => Number(inEvent.has(b.key)) - Number(inEvent.has(a.key)) || a.name.localeCompare(b.name)).slice(0, 8);
    mount(results, hits.length ? hits.map((p) => { const b = el("button", { type: "button" }, [el("span", {}, p.name), el("small", { class: "muted" }, inEvent.has(p.key) ? "in this event" : "not in this event")]); b.addEventListener("click", () => pick({ player_id: p.key, name: p.name })); return el("li", {}, b); })
      : el("li", { class: "muted small lv-none" }, "No player by that name."));
  }
  searchIn.addEventListener("input", () => { q = searchIn.value; drawResults(); });
  function pick(p) {
    sel.player = p; q = ""; searchIn.value = ""; searchIn.blur(); drawResults();
    drawBoard(true); drawPlayer();
    if (window.innerWidth < 900) playerBox.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function drawPlayer() {
    if (!sel.player) { mount(playerBox, el("p", { class: "muted small lv-hint" }, "Search for a player, or tap a row on the leaderboard.")); return; }
    const row = lb ? lb.rows.find((r) => r.player_id === sel.player.player_id) : null;
    const k = valKey(), pid = sel.player.player_id;
    const toBoard = el("button", { type: "button", class: "link small lv-toboard" }, "↓ Back to leaderboard");
    toBoard.addEventListener("click", () => grid.querySelector(".lv-main").scrollIntoView({ behavior: "smooth", block: "start" }));
    const close = el("button", { type: "button", class: "gx-pop-x lv-x", "aria-label": "Close" }, "✕");
    close.addEventListener("click", () => { sel.player = null; drawPlayer(); drawBoard(); });
    const top = [el("div", { class: "lv-p-top" }, [el("div", {}, [el("h2", {}, sel.player.name),
      el("p", { class: "muted small" }, [sel.t?.event, lb?.round ? (sel.view === "event" ? `Event total · ${row?.rounds || 0} rounds` : `Round ${lb.round}`) : null].filter(Boolean).join(" · "))]), close]), toBoard];
    if (!lb) { mount(playerBox, top); return; }
    if (!row) { mount(playerBox, [...top, el("p", { class: "muted lv-msg" }, "No strokes gained for this player in this round. They may not be in the field, or haven’t played it.")]); return; }
    const t = row.TOTAL?.[k], trk = rankText("TOTAL", pid), t2g = row.T2G?.[k], t2r = rankText("T2G", pid);
    const max = Math.max(3, ...SPLITS.map(([s]) => Math.abs(row[s]?.[k] ?? 0)));
    const parts = [...top,
      el("div", { class: "lv-total" }, [el("strong", { class: tone(t) }, fmt(t)), el("span", { class: "muted" }, [`Strokes gained${trk ? ` · rank ${trk} of ${ranksFor("TOTAL").n}` : ""}`, t2g != null ? el("br") : null, t2g != null ? `Tee-to-Green ${fmt(t2g)}${t2r ? ` · rank ${t2r}` : ""}` : null])]),
      el("div", { class: "lv-splits" }, SPLITS.map(([s, label]) => {
        const v = row[s]?.[k], r = rankText(s, pid), w = v == null ? 0 : Math.min(Math.abs(v) / max, 1) * 50;
        return el("div", { class: "lv-split" }, [
          el("div", { class: "lv-split-top" }, [el("span", {}, label), el("span", {}, [el("strong", { class: tone(v) }, fmt(v)), r ? el("small", { class: "muted" }, `rank ${r}`) : null])]),
          el("div", { class: "lv-track" }, el("span", { class: v > 0 ? "pos" : "neg", style: `${v > 0 ? "left" : "right"}:50%;width:${w}%` })),
        ]);
      })),
    ];
    const extras = statsMeta.filter((m) => row.x?.[m.id] && (m.default !== false || isOn(`x:${m.id}`)));
    if (extras.length) parts.push(el("div", { class: "lv-more" }, [el("p", { class: "cmp-chip-gt" }, "Stats"), ...extras.map((m) => {
      const xr = rankText(`x:${m.id}`, pid);
      return el("div", { class: "lv-stat" }, [el("span", { title: m.tip || null }, m.label), el("span", { class: "lv-stat-v" }, [el("strong", {}, row.x[m.id].d), xr ? el("small", { class: "muted" }, `rank ${xr}`) : null])]);
    })]));
    mount(playerBox, parts);
  }

  // ------------------------------------------------------------------ loading
  function refresh() {
    if (!sel.t) return;
    const view = sel.view;
    drawTours(); drawHead();
    file = board(sel.t);
    statsMeta = file.stats.map((k) => { const d = statDef(k); return { id: k, label: d.label, group: GROUP[k] || "More Stats", tip: d.help || "", lower: d.higher === false, rank: d.higher != null, counts: !!(d.pct || k === "prox"), default: ON.has(k) }; });
    metaById = Object.fromEntries(statsMeta.map((m) => [m.id, m]));
    let d = view === "event" ? file.event : view === "latest" ? (file.latest_round ? file.rounds[String(file.latest_round)] : null) : file.rounds[view];
    if (!d) d = { round: null, rows: [], note: "No data for this round yet." };
    lb = d; ranksCache = {};
    drawRounds(view === "latest" ? (d.round ? String(d.round) : "") : view);
    drawTools(); drawPicker(); drawBoard(); drawPlayer();
  }
  function useField(f) {
    field = f;
    events = tournaments(field);
    const byTour = new Map();
    for (const e of events) (byTour.get(e.tour) || byTour.set(e.tour, []).get(e.tour)).push(e);
    // tours with the most recent tournament first
    tours = [...byTour].map(([tour, evs]) => ({ tour, events: evs })).sort((a, b) => b.events[0].end.localeCompare(a.events[0].end));
    if (!events.length) { loadErr = "No tournaments with strokes gained in the data yet. They appear once a stats file has been uploaded."; drawHead(); drawTours(); drawBoard(); return; }
    // stay on the same tournament (or tour) when the data is refreshed
    const keep = sel.t && (events.find((e) => e.id === sel.t.id) || tours.find((t) => t.tour === sel.t.tour)?.events[0]);
    sel.t = keep || tours[0].events[0];
    refresh();
  }

  drawHead(); drawTools(); drawPlayer();
  const stop = watchNewestDataset(async (ds) => {
    if (!root.isConnected) { stop?.(); return; }
    if (!ds) { loadErr = "No leaderboard yet. It appears once a stats file has been uploaded."; drawBoard(); return; }
    const v = `${ds.id}|${ds.uploadedAt?.toMillis?.() ?? ""}`;
    if (v === version) return;
    version = v; uploadedAt = ds.uploadedAt?.toMillis?.() ?? null; loadErr = "";
    try { const f = await fieldOf(ds); if (version !== v) return; useField(f); }
    catch (err) { console.error(err); loadErr = "Couldn’t load the latest data. Try again in a moment."; drawBoard(); }
  });
  const onResize = () => { clearTimeout(onResize.t); onResize.t = setTimeout(fitTable, 120); };
  window.addEventListener("resize", onResize);
  const tick = setInterval(() => { if (!root.isConnected) { clearInterval(tick); window.removeEventListener("resize", onResize); stop?.(); } else drawMeta(); }, 60000);
  document.fonts?.ready?.then(fitTable);
  return () => { clearInterval(tick); window.removeEventListener("resize", onResize); stop?.(); };
}
