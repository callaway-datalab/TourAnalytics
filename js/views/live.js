// (update 259) Live Feed: the latest tournaments in the data, round by round, the way a live leaderboard reads them.
// One tournament of each tour up top (the newest), any earlier one a tap away; R1–R4 and the Event (each player's
// strokes gained added up over the rounds played); a leaderboard of strokes gained and stats that sorts by any
// column, with ranks, a Columns picker and Min Sample; and a card for any player.
// It reads the field summary of the newest strokes-gained file (fieldSummary.js), the same numbers as Leaderboards,
// and redraws by itself when a new file is uploaded.
// (update 264) And the PGA Tour API: each tour's current tournament as it's played (every 30 minutes, the live-feed
// function, kept in Firestore: liveData.js), with "thru N" for rounds in progress. Its tournaments come first; the
// uploaded ones are there for everything earlier (and a tournament in both shows the API's).
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { CATEGORIES, statRounds, statAgg, statsIn, statDef, fmtStat } from "../sg.js";
import { watchNewestDataset, fieldOf } from "../fieldSummary.js";
import { watchLiveFile, liveFile } from "../liveData.js";

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
// (update 264) the API's stats that are lower-is-better, so ranks are right before stats_meta.json says so (from PGA_Live)
const LOWER_DEFAULT = new Set(["02420", "02421", "02722", "336", "337", "338", "339", "340", "431", "472", "374", "481", "375", "376", "378", "379", "380", "381", "382", "104", "119", "349", "02428", "426", "184", "520", "521", "171", "172", "173", "02414"]);
const NOTES = {
  not_yet: "Strokes gained isn\u2019t published yet. It usually appears once round 1 is done.",
  no_shotlink: "No strokes gained data for this event. Events without ShotLink don\u2019t have it.",
  fetch_failed: "The last data run couldn\u2019t reach the Tour\u2019s API. The next run retries automatically.",
};
// the same tour, whichever way it's written ("PGA TOUR", "PGA Tour", "R"; "Korn Ferry Tour", "H")
const famOf = (t) => { const x = String(t || "").toLowerCase(); return /korn|^h$/.test(x) ? "kft" : /pga|^r$/.test(x) ? "pga" : x.replace(/[^a-z0-9]/g, ""); };
const sameName = (a, b) => { const f = (x) => String(x || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, ""); const x = f(a), y = f(b); return !!x && (x === y || (Math.min(x.length, y.length) >= 8 && (x.includes(y) || y.includes(x)))); };
const entryN = (e) => { if (!e) return null; if (e.n != null) return e.n; const m = /\((?:\d+\/)?(\d+)\)\s*$/.exec(e.d || ""); return m ? +m[1] : null; };
/** (update 264) An API tournament file (PGA_Live's format) as leaderboard rows, like board() makes from the uploaded data. */
function boardFromApi(b, overrides) {
  const KEYS = { TOTAL: "total", OTT: "off_the_tee", APP: "approach", ARG: "around_the_green", PUTT: "putting", T2G: "tee_to_green" };
  const conv = (r) => {
    const o = { player_id: String(r.player_id), name: r.name, country: r.country, rounds: r.rounds, thru: r.thru, thru_round: r.thru_round, x: {} };
    for (const [k, a] of Object.entries(KEYS)) o[k] = r[a] || {};
    for (const [id, e] of Object.entries(r.x || {})) o.x[id] = { ...e, n: entryN(e) };
    return o;
  };
  const rounds = {};
  for (const [n, d] of Object.entries(b.rounds || {})) if (d?.rows?.length) rounds[n] = { round: d.round ?? Number(n), rows: d.rows.map(conv) };
  const latest = b.latest_round || Math.max(0, ...Object.keys(rounds).map(Number)) || null;
  const event = b.event?.rows?.length ? { round: latest, rows: b.event.rows.map(conv) } : { round: null, rows: [] };
  const meta = (b.stats || []).map((m) => { const o = overrides[m.id] || {}; return { id: m.id, label: o.label || m.label, group: o.group || m.group || "More Stats", tip: o.tip || m.tip || "",
    lower: o.lower !== undefined ? o.lower : !!m.lower || LOWER_DEFAULT.has(m.id), default: o.default !== undefined ? o.default : m.default !== false,
    rank: o.rank !== undefined ? o.rank : m.rank !== false, counts: o.counts !== undefined ? o.counts : !!m.counts, ratio: o.ratio !== undefined ? o.ratio : !!m.ratio }; });
  return { rounds, event, latest_round: latest, meta, warnings: b.warnings || null, fetched_at: b.fetched_at || null };
}
const ls = {
  get: (k, d = null) => { try { const v = localStorage.getItem(`lv.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`lv.${k}`, JSON.stringify(v)); } catch { /* private window */ } },
};
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.\-]/g, " ").trim();
const fmt = (n) => { if (n == null) return "\u2013"; const r = Math.round(n * 100) / 100; return (r > 0 ? "+" : r < 0 ? "\u2212" : "") + Math.abs(r).toFixed(2); }; // (rounds first: no "\u22120.00")
const shortName = (n) => { const w = String(n || "").trim().split(/\s+/); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : n; }; // (update 283: "S. Scheffler" on phones)
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
/** Live while it's recent and not all four rounds are in; final otherwise. (update 264: the API says which, for its own) */
function statusOf(e) {
  if (e.api) return e.api.status === "live" ? "live" : e.api.status === "final" ? "final" : "upcoming";
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
  // (update 264) the API's side: its tournaments, its stat names, its players (for the search)
  let apiEvents = [], apiOverrides = {}, apiPlayers = [], uploadEvents = [], apiSeen = false, curVis = null, refreshing = "", stopEvent = null, watchedRel = null, reqId = 0;
  let field = [], tours = [], events = [], lb = null, file = null, statsMeta = [], metaById = {}, uploadedAt = null, loadErr = "", version = null;
  let visible = ls.get("cols2", null); // null = the default columns
  let showRanks = ls.get("ranks", window.innerWidth >= 700), minOn = ls.get("min", true), wide = ls.get("wide", false);
  let sel = { player: null, t: null, view: "latest" }, sortKey = "TOTAL", sortDir = -1;
  let colsOpen = false, pickerQ = "", q = "";
  const famOpen = {}, subOpen = {};
  let ranksCache = {};

  const valKey = () => (sel.view === "event" ? "event" : "round");
  const saveVisible = () => ls.set(curVis || "cols2", visible); // (update 264: the API's stats and the uploaded ones are chosen separately)
  const allKeys = () => BASE_KEYS.concat(statsMeta.map((m) => `x:${m.id}`));
  const defaultKeys = () => BASE_KEYS.concat(statsMeta.filter((m) => m.default !== false).map((m) => `x:${m.id}`));
  const isOn = (key) => (visible === null ? defaultKeys().includes(key) : visible.includes(key));
  const columns = () => COLS.filter(([k]) => isOn(k)).map(([key, label]) => ({ key, label }))
    .concat(statsMeta.filter((m) => isOn(`x:${m.id}`)).map((m) => ({ key: `x:${m.id}`, label: m.label, tip: (m.tip || "") + (m.lower ? " (Lower is better.)" : ""), id: m.id, lower: m.lower })));
  const lowSample = (id, e) => { const m = metaById[id]; if (!minOn || !m || !m.counts || m.ratio || !e || e.n == null) return false; return e.n < MIN_N[valKey()]; };
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
  const boardWrap = el("div", { class: "lv-board" }, el("p", { class: "muted lv-msg ta-loading" }, "Loading…"));
  const warnBar = el("p", { class: "lv-warn", hidden: true }, "Some values on this tournament failed an automatic check. Treat the numbers with caution until the next update."); // (update 264)
  const meta = el("p", { class: "muted small lv-meta" });
  const grid = el("div", { class: `lv-grid${wide ? " wide" : ""}` }, [
    el("section", { class: "panel lv-side" }, [searchIn, results, playerBox]),
    el("section", { class: "panel lv-main" }, [
      el("div", { class: "lv-main-top" }, [el("div", {}, [el("h2", {}, "Leaderboard"), meta]), toolbar]),
      colPanel, warnBar, boardWrap,
      el("details", { class: "lv-legend" }, [el("summary", {}, "How to read this"),
        el("p", { class: "muted small" }, "Each round shows the strokes gained and stats of that round. The Event tab adds each player’s strokes gained up over the rounds they played (RDS); other stats are averaged over those rounds, weighted by attempts. The small grey number under each value is its rank (T = tied) among the players shown; for lower-is-better stats the lowest value ranks first, and the first tap on its heading sorts lowest first. Min Sample greys out percentages and averages built on very few attempts (under 3 in a round, under 5 for the event) and leaves them out of ranks and sorting. A tournament marked Live comes from the PGA Tour\u2019s API, updated about every 30 minutes; \u201cthru N\u201d marks a round still in progress, so its totals only cover the holes played so far (and Tee-to-Green and Total come straight from the Tour\u2019s feed, so they won\u2019t equal the sum of the parts until the round is final). Earlier tournaments are your uploaded data, the same as Leaderboards. The page updates by itself.")]),
    ]),
  ]);
  // (the page is put together once the tour pills exist, below)

  // ------------------------------------------------------------------ header, tours, rounds, toolbar
  function drawHead() {
    const st = sel.t ? statusOf(sel.t) : null;
    // (update 263) nothing in progress in the data: say how current it is, so an old tournament isn't taken for this week's
    const newest = events[0]?.end || null, days = newest ? Math.floor((Date.now() - new Date(`${newest}T12:00:00`).getTime()) / 864e5) : null;
    const stale = events.length && !events.some((e) => statusOf(e) === "live") && days >= 3
      ? el("p", { class: "lv-stale" }, apiSeen ? `Nothing is in progress right now: the newest rounds are from ${dayTxt(newest)}. The next tournament shows here from the PGA Tour\u2019s API once it starts.`
        : `The newest round in your data is from ${dayTxt(newest)} (${days} days ago), so nothing is in progress here. A tournament shows here as it\u2019s played once its rounds are in an uploaded stats file${uploadedAt ? `; the latest file was uploaded ${ago(uploadedAt)}` : ""}.`) : null;
    // (update 264) the admin can fetch from the API now, instead of waiting for the next half hour
    const url = window.PORTAL_CONFIG?.liveFeedUrl;
    const again = getState().isAdmin && url ? el("button", { type: "button", class: "btn ghost small lv-refresh", disabled: refreshing === "busy" ? true : null, title: "Fetch the PGA Tour API now" }, refreshing === "busy" ? "Refreshing\u2026" : "Refresh now") : null;
    again?.addEventListener("click", async () => {
      refreshing = "busy"; drawHead();
      try {
        const token = await getState().user?.getIdToken?.();
        const r = await fetch(url, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const out = await r.json().catch(() => ({}));
        refreshing = out.ok ? (out.skipped ? "An update is already running; it\u2019ll show when it finishes." : `Updated (${Math.round(out.seconds || 0)} s).`) : `Couldn\u2019t update: ${out.error || r.status}.`;
      } catch { refreshing = "Couldn\u2019t reach the live feed."; }
      drawHead(); setTimeout(() => { if (refreshing !== "busy") { refreshing = ""; drawHead(); } }, 8000);
    });
    mount(head, [
      el("div", {}, [el("p", { class: "gx-eyebrow" }, "Live"), el("h1", {}, "Event Feed")]),
      el("div", { class: "lv-head-r" }, [refreshing && refreshing !== "busy" ? el("span", { class: "muted small" }, refreshing) : null, again,
        st ? el("span", { class: `lv-status${st === "live" ? " on" : ""}` }, [el("i", { "aria-hidden": "true" }), st === "live" ? (sel.t?.api ? "Live" : "In progress") : st === "upcoming" ? "Upcoming" : "Final"]) : null]),
      stale,
    ]);
  }
  // (update 283) tour pills (PGA TOUR / Korn Ferry) on top; under them the tour's current tournaments (in progress or
  // upcoming) as cards, and every finished one in an "Archived Events" list
  const tourPills = el("div", { class: "seg lv-tourpills", role: "group", "aria-label": "Tour" });
  const isFinal = (e) => statusOf(e) === "final";
  const firstOf = (t) => t.events.find((e) => !isFinal(e)) || t.events[0];
  function drawTours() {
    const cur = tours.find((t) => sel.t && t.tour === sel.t.tour) || tours[0];
    mount(tourPills, tours.length > 1 ? tours.map((t) => {
      const on = t === cur, live = t.events.some((e) => statusOf(e) === "live");
      const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, [live ? el("i", { class: "lv-dot", "aria-hidden": "true" }) : null, t.tour]);
      b.addEventListener("click", () => { if (!on) pickEvent(firstOf(t)); });
      return b;
    }) : null);
    tourPills.hidden = tours.length < 2;
    if (!cur) { mount(tourBox, null); return; }
    const card = (e) => {
      const on = sel.t?.id === e.id, st = statusOf(e), live = st === "live";
      const b = el("button", { type: "button", class: `lv-tour${on ? " on" : ""}`, "aria-pressed": String(on) }, [
        el("span", { class: "lv-tour-k" }, [live ? el("i", { class: "lv-dot", "aria-hidden": "true" }) : null, live ? (e.api ? "Live" : "In progress") : st === "upcoming" ? "Upcoming" : "Final"]),
        el("span", { class: "lv-tour-n" }, e.event), el("span", { class: "lv-tour-s muted" }, `${dayTxt(e.start)}${e.end && e.end !== e.start ? `\u2013${dayTxt(e.end)}` : ""}, ${e.year}${e.players.size ? ` \u00b7 ${e.players.size} players` : ""}`)]);
      b.addEventListener("click", () => { if (!on) pickEvent(e); });
      return b;
    };
    const current = cur.events.filter((e) => !isFinal(e)), archived = cur.events.filter(isFinal);
    const showing = sel.t && isFinal(sel.t) && sel.t.tour === cur.tour ? [sel.t] : []; // a finished one that's open shows as a card too
    const arch = archived.length ? el("select", { class: "lv-ev", "aria-label": `${cur.tour}: archived events` }, [
      el("option", { value: "", selected: !(sel.t && isFinal(sel.t)) }, `Archived Events (${archived.length})`),
      ...archived.slice(0, 80).map((e) => el("option", { value: e.id, selected: sel.t?.id === e.id }, `${e.event} (${dayTxt(e.start)}, ${e.year})`)),
    ]) : null;
    arch?.addEventListener("change", () => { if (arch.value) pickEvent(events.find((e) => e.id === arch.value)); });
    mount(tourBox, el("div", { class: "lv-tour-box" }, [
      ...current.map(card), ...showing.map(card),
      !current.length && !showing.length ? el("p", { class: "muted small lv-none-now" }, "Nothing in progress on this tour right now.") : null,
      arch,
    ]));
  }
  mount(root, [head, tourPills, el("div", { class: "lv-pick" }, [tourBox, roundBox]), grid]);
  function pickEvent(e) { if (!e) return; sel.t = e; sel.view = "latest"; refresh(); }
  function drawRounds(active) {
    mount(roundBox, ROUNDS.map(([v, l]) => {
      const on = v === active;
      const has = !file ? true : v === "event" ? !!file.event?.rows?.length : !!file.rounds?.[v]?.rows?.length; // (rounds not in the data yet can't be picked)
      const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on), disabled: file && !has ? true : null, title: file && !has ? "No data for this round yet" : "" }, l);
      b.addEventListener("click", () => { sel.view = v; sel.auto = false; refresh(); });
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
    const most = window.innerWidth < 700 ? 1 : 3; // (update 283: on a phone it scrolls sideways rather than shrinking to tiny text)
    for (let d = 0; d <= most; d++) { boardWrap.dataset.density = String(d); if (table.scrollWidth <= boardWrap.clientWidth + 1) break; }
  }
  function drawMeta() {
    if (!sel.t) { meta.textContent = ""; return; }
    const fa = sel.t.api ? (file?.fetched_at ? Date.parse(file.fetched_at) : null) : uploadedAt;
    const late = sel.t.api && statusOf(sel.t) === "live" && fa && Date.now() - fa > 90 * 60000;
    meta.textContent = [sel.t.tour, sel.t.event, sel.t.course, lb?.round ? (sel.view === "event" ? "Event total" : `Round ${lb.round}`) : null,
      fa ? `${sel.t.api ? "PGA Tour API, as of" : "Data as of"} ${new Date(fa).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (${ago(fa)}${late ? ", may be delayed" : ""})` : null,
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
      const tr = el("tr", { class: sel.player?.player_id === r.player_id ? "sel" : null, dataset: { id: r.player_id } }, [el("td", { class: "lv-pos" }, place(i)), el("td", { title: r.thru != null ? `${r.name}: round ${r.thru_round || lb.round} in progress, thru ${r.thru}` : r.name }, [el("span", { class: "lv-nm-full" }, r.name), el("span", { class: "lv-nm-short" }, shortName(r.name)), r.thru != null ? el("small", { class: "lv-thru" }, `thru ${r.thru}`) : null]), ...cells, sel.view === "event" ? el("td", { class: "muted" }, String(r.rounds ?? "–")) : null]);
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
    const pool = sel.t?.api ? apiPlayers.map((p) => ({ key: String(p.player_id), name: p.name })) : field; // (update 264)
    const hits = pool.filter((p) => { const w = norm(p.name).split(" "); return toks.every((t) => w.some((x) => x.startsWith(t))); })
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
      el("p", { class: "muted small" }, [sel.t?.event, lb?.round ? (sel.view === "event" ? `Event total · ${row?.rounds || 0} rounds` : `Round ${lb.round}`) : null, row?.thru != null ? `thru ${row.thru}` : null].filter(Boolean).join(" · "))]), close]), toBoard];
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
  async function refresh() {
    if (!sel.t) return;
    const t = sel.t, id = ++reqId;
    drawTours(); drawHead();
    // (update 264) an API tournament: its file (and watch it, so a new half-hour update shows by itself)
    if (t.api) {
      if (watchedRel !== t.api.path) { stopEvent?.(); watchedRel = t.api.path; let first = true; stopEvent = watchLiveFile(t.api.path, (m) => { if (first) { first = false; return; } if (m && sel.t?.api?.path === t.api.path) { t.file = null; t.entry = m; refresh(); } }); }
      if (!t.file) {
        loadErr = ""; mount(boardWrap, el("p", { class: "muted lv-msg ta-loading" }, "Loading the live data\u2026"));
        try {
          const b = await liveFile(t.api.path, t.entry || null);
          if (id !== reqId) return;
          t.file = b ? boardFromApi(b, apiOverrides) : { rounds: {}, event: { rows: [] }, latest_round: null, meta: [], warnings: null };
          if (!t.file.latest_round) t.file.note = NOTES[t.api.reason] || "No strokes gained for this tournament yet.";
          t.players = new Map((t.file.event.rows.length ? t.file.event.rows : Object.values(t.file.rounds).at(-1)?.rows || []).map((r) => [r.player_id, { name: r.name }]));
          t.roundNos = new Set(Object.keys(t.file.rounds));
          drawTours();
        } catch (err) { if (id !== reqId) return; loadErr = err.message || "Couldn\u2019t load the live data."; file = null; lb = null; drawRounds(""); drawBoard(); return; }
      }
    } else { stopEvent?.(); stopEvent = null; watchedRel = null; }
    loadErr = "";
    file = t.api ? t.file : board(t);
    statsMeta = file.meta || file.stats.map((k) => { const d = statDef(k); return { id: k, label: d.label, group: GROUP[k] || "More Stats", tip: d.help || "", lower: d.higher === false, rank: d.higher != null, counts: !!(d.pct || k === "prox"), default: ON.has(k) }; });
    metaById = Object.fromEntries(statsMeta.map((m) => [m.id, m]));
    const vk = t.api ? "colsApi" : "cols2"; if (vk !== curVis) { curVis = vk; visible = ls.get(vk, null); }
    warnBar.hidden = !(file.warnings && file.warnings.length);
    // (update 263) opening a tournament: a final one on the Event (the whole tournament), one in progress on its latest round
    let view = sel.view;
    if (view === "latest") sel.auto = true; // (picked for them: a new upload moves it on; a tab they tap stays)
    if (view === "latest") view = statusOf(t) === "final" && file.event?.rows?.length ? "event" : file.latest_round ? String(file.latest_round) : "event";
    sel.view = view;
    let d = view === "event" ? file.event : file.rounds[view];
    if (!d || !d.rows?.length) d = { round: null, rows: [], note: file.note || "No data for this round yet." };
    lb = d; ranksCache = {};
    drawRounds(view);
    drawTools(); drawPicker(); drawBoard(); drawPlayer();
  }
  /** (update 264) The tournaments: the API's current ones, then the uploaded ones (one in both shows the API's), by tour. */
  function rebuild() {
    const shown = apiEvents.map((e) => { const up = uploadEvents.find((u) => famOf(u.tour) === famOf(e.tour)); return up ? Object.assign(e, { tour: up.tour }) : e; });
    const rest = uploadEvents.filter((u) => !shown.some((e) => famOf(e.tour) === famOf(u.tour) && e.year === u.year && sameName(e.event, u.event)));
    events = [...shown, ...rest].sort((a, b) => String(b.end || b.start || "").localeCompare(String(a.end || a.start || "")) || (b.api ? 1 : 0) - (a.api ? 1 : 0));
    const byTour = new Map();
    for (const e of events) (byTour.get(e.tour) || byTour.set(e.tour, []).get(e.tour)).push(e);
    tours = [...byTour].map(([tour, evs]) => ({ tour, events: evs })).sort((a, b) => famOf(a.tour) === "pga" ? -1 : famOf(b.tour) === "pga" ? 1 : String(b.events[0].end).localeCompare(String(a.events[0].end)));
    if (!events.length) { if (!loadErr) loadErr = "No tournaments with strokes gained yet. They appear once a stats file has been uploaded, or once the PGA Tour API feed has run."; drawHead(); drawTours(); drawBoard(); return; }
    loadErr = "";
    // stay on the same tournament (or tour) when the data is refreshed
    const sameTour = sel.t && tours.find((t) => famOf(t.tour) === famOf(sel.t.tour));
    const keep = sel.t && (events.find((e) => e.id === sel.t.id) || (sameTour && firstOf(sameTour)));
    if (sel.auto || !keep || keep.id !== sel.t?.id) sel.view = "latest"; // (update 263: keep up with a new round)
    sel.t = keep || firstOf(tours[0]);
    refresh();
  }
  function useField(f) { field = f; uploadEvents = tournaments(field); rebuild(); }
  /** (update 264) The API's current tournaments (current.json), its stat names and players. */
  async function useApi(entry) {
    if (!entry) { if (apiEvents.length || !apiSeen) { apiEvents = []; apiSeen = false; rebuild(); } return; }
    try {
      const [cur, metaList, players] = await Promise.all([liveFile("current.json", entry), liveFile("stats_meta.json").catch(() => null), liveFile("players.json").catch(() => null)]);
      apiOverrides = Object.fromEntries((metaList || []).map((m) => [m.id, m]));
      apiPlayers = players || [];
      const old = new Map(apiEvents.map((e) => [e.id, e]));
      apiEvents = (cur?.tours || []).filter((x) => x.path && (x.has_data || x.status === "live")).map((x) => {
        const id = `api|${x.tour}|${x.year}-${x.t_num}`, prev = old.get(id);
        return Object.assign(prev || { id, players: new Map(), roundNos: new Set() }, { api: x, tour: x.label || x.tour, event: x.name, year: String(x.year), course: null, start: x.start, end: x.end || x.start });
      });
      apiSeen = true;
      rebuild();
    } catch (err) { console.warn("Live data:", err); }
  }

  drawHead(); drawTools(); drawPlayer();
  const stopApi = watchLiveFile("current.json", (m) => { if (!root.isConnected) { stopApi?.(); return; } useApi(m); }); // (update 264)
  const stop = watchNewestDataset(async (ds) => {
    if (!root.isConnected) { stop?.(); return; }
    if (!ds) { uploadEvents = []; rebuild(); return; }
    const v = `${ds.id}|${ds.uploadedAt?.toMillis?.() ?? ""}`;
    if (v === version) return;
    version = v; uploadedAt = ds.uploadedAt?.toMillis?.() ?? null; loadErr = "";
    try { const f = await fieldOf(ds); if (version !== v) return; useField(f); }
    catch (err) { console.error(err); if (!apiEvents.length) { loadErr = "Couldn\u2019t load the latest data. Try again in a moment."; drawBoard(); } }
  });
  const onResize = () => { clearTimeout(onResize.t); onResize.t = setTimeout(fitTable, 120); };
  window.addEventListener("resize", onResize);
  const stopAll = () => { clearInterval(tick); window.removeEventListener("resize", onResize); stop?.(); stopApi?.(); stopEvent?.(); };
  const tick = setInterval(() => { if (!root.isConnected) stopAll(); else drawMeta(); }, 60000);
  document.fonts?.ready?.then(fitTable);
  return stopAll;
}
