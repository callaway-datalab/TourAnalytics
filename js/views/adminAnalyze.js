// Analyze → Leaderboards (#/admin/analyze) and Analyze → Player Stats (#/admin/player-stats), update 158.
//   Leaderboards: the whole field (Tour Events only); tapping a name opens that player in Player Stats.
//   Player Stats: starts with just the player search; pick a player for their stats (Tour Events,
//   Entered Rounds or Practice). Players see the same dashboard on their own My Stats page (see sgDashboard.js).
import { el, mount, num, subNav, relocateSectionNav } from "../ui.js";
import { adminAllClients, watchAdminDatasets, publishFieldStats, fieldStatsSource, getFieldStats } from "../store.js";
import { loadDatasetPlayers, loadErrorText, reloadPlayerRows, isLiteDevice } from "../fieldCache.js";
import { publishFieldDetail, detailSource, getFieldDetail, billingState, resumeDownloads } from "../fieldStore.js";
import { playerPicker } from "../playerPicker.js";
import { detectColumns, isShotData, prepare, buildFieldSummary, summaryPlayers } from "../sg.js";
import { sgDashboard } from "../sgDashboard.js";
import { getAllRounds, watchPlayerRounds } from "../rounds.js";
import { myRoundsTable } from "../myRoundsTable.js";
import { getState } from "../auth.js";
import { myEntryKey, myName } from "./dataEntry.js";
import { enteredPlayers, ENTERED_IDX } from "../roundCalc.js";

export const ENTERED_NOTE = "Entered rounds: strokes gained is measured against the scoring-average baseline by lie and distance.";

const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
// (update 227) kept while the app is open (not just while this page is), so coming back to Analyze is instant
const ROWS = new Map(), PREPARED = new Map(), DETAIL = new Map(), DETAIL_WHY = new Map(), STAGED = new Map();
const keepFew = (m, n = 4) => { while (m.size > n) m.delete(m.keys().next().value); };

export async function render(main, { flash, routeId }) {
  const board = routeId !== "admin-player-stats"; // Leaderboards (no player) or Player Stats
  const onPick = board
    ? (key) => { location.hash = `#/admin/player-stats?player=${encodeURIComponent(key)}`; }
    : (key) => pickerRef?.select?.(key);
  let player = null;               // { key, label }
  let datasets = [];
  let loadToken = 0;
  let dash = null;                 // the dashboard for the current file
  let fieldPlayers = [];           // [{ key, label, rounds }]
  const dashState = {};            // filters survive switching players
  const enteredState = {};
  let source = "tour";             // "tour": uploaded Tour stats; "entered": rounds from Data Entry
  const rowsCache = ROWS;          // `${datasetId}|${playerKey}` -> { label, rows }
  const preparedCache = PREPARED;  // `${datasetId}|${uploadedAt}` -> [{ key, label, rounds }]
  let displayLabels = new Map();   // player key -> name (the ID when there's no name)

  const pickerBox = el("div");
  let fileId = "";                 // the file being analyzed: the newest strokes-gained file
  const status = el("p", { class: "muted center", role: "status" });
  const portalLink = el("p", { class: "center" });
  let enteredUpdated = null;
  let pickerRef = null; // the player search (so the leaderboard can pick a player)
  let pendingNote = ""; // (said once the file that was switched to has loaded)
  let loadNote = "";    // (players whose rows didn't load)
  // (hidden while loading, so Tour Events / Entered Rounds don't flash outside the Filters panel; shown
  // only when there's nothing to draw, so the other source can still be picked)
  const sourceHome = el("div", { class: "pill-row source-home", hidden: true });
  const showPills = () => { if (board || !player) return; if (!sourcePills.parentNode || sourcePills.parentNode === sourceHome) { sourceHome.appendChild(sourcePills); sourceHome.hidden = false; } };
  queueMicrotask(() => { if (!sourcePills.parentNode) sourceHome.appendChild(sourcePills); });
  // the player search + portal link: placed by the dashboard under its pills (above the dropdowns);
  // when there's no dashboard (nothing to show yet) it sits here
  const pickerSlot = el("div", { class: "analyze-picker" }, [pickerBox]); // (no portal link: that's on Player Access)
  // the Stats / Performance Reports / WITB / … row goes under the player search (it travels with it)
  const undoTop = relocateSectionNav(main, pickerSlot);
  const pickerHome = el("div", { class: "picker-home" }, pickerSlot);
  const body = el("div", { class: "sg-body" });

  // Tour | Entered Rounds
  const sourcePills = el("nav", { class: "subnav source-pills", "aria-label": "Data" });
  const viewHost = el("div", { class: "view-host" }); // (kept empty: Basic / Advanced was here)
  // what every dashboard on this page gets: Player Stats has the player search and the data pills
  // (blank: with no player on screen, show just the search; a "nothing here yet" note for a player picked is shown)
  const dashOpts = (blank = true) => (board ? { onPick }
    : { slot: pickerSlot, slotHome: pickerHome, lead: sourcePills, leadHome: sourceHome, onPick, blankWithoutMe: blank });
  // (update 169) no Practice pill: just Tour Events | Entered Rounds
  // (update 223) no Tour Events / Entered Rounds pills: the player's entered rounds join their tour data (each on its own tour)
  const drawSource = () => mount(sourcePills, null);
  drawSource();

  const fullNote = el("p", { class: "muted small center analyze-bg-note", role: "status" }); // (update 227)
  mount(main, board ? [status, fullNote, body] : [
    sourceHome, // the data pills sit here until the stats draw them into their one row of pills
    pickerHome,
    status,
    fullNote,
    body,
  ]);

  // Every player's rows: from memory, or the copy kept on this device, or (first time / new upload) Firestore.
  async function loadAll(ds, token) {
    const total = (ds.clientKeys || []).length;
    status.textContent = "Loading players\u2026";
    const { players, failed, error } = await loadDatasetPlayers(ds.id, { ds, onProgress: (done) => {
      if (token === loadToken) status.textContent = `Loading players\u2026 ${done} of ${total}. This is kept on this device, so the next refresh is quick.`;
    } });
    for (const [key, p] of players) if (p) rowsCache.set(`${ds.id}|${key}`, p);
    // (some players didn't load: say so, rather than leaving them out without a word)
    loadNote = failed?.length ? `Couldn\u2019t load ${failed.length} of ${total} players\u2019 rows: ${loadErrorText(error)}. They\u2019re left out for now and tried again next time you open this page.` : "";
  }

  // (update 223) the player picked: their tour rows plus the rounds entered for them
  const enteredOf = new Map(); let stopEnt = () => {}, entFor = null;
  const meBase = () => (player && fieldPlayers.find((p) => p.key === player.key)) || null;
  const meFrom = () => {
    const base = meBase(), ent = player ? enteredOf.get(player.key) || [] : [];
    if (!ent.length) return base;
    if (!base) return { key: player.key, label: displayLabels.get(player.key) || player.label, rounds: ent };
    return { ...base, rounds: [...base.rounds, ...ent].sort((a, b) => String(a.date).localeCompare(String(b.date))) };
  };
  function watchEntered(key) {
    if (entFor === key) return;
    stopEnt(); entFor = key;
    if (!key) { stopEnt = () => {}; return; }
    stopEnt = watchPlayerRounds(key, (rounds) => {
      enteredOf.set(key, enteredPlayers(rounds, () => "", { withQuick: true })[0]?.rounds || []);
      if (player?.key !== key || !dash) return;
      const me = meFrom();
      if (me && !meBase()) status.textContent = "";
      dash.update({ me });
    });
  }

  async function refresh() {
    dash?.destroy(); dash = null; sourceHome.hidden = true;
    if (source === "entered") return refreshEntered();
    if (source === "practice") return refreshPractice();
    const ds = datasets.find((d) => d.id === fileId);
    if (!ds) { status.textContent = ""; emptyDash("Upload a data file to analyze."); return; }
    const token = ++loadToken;
    mount(body, null);
    if (isLiteDevice() && isShotData(detectColumns(ds.columns || []))) return refreshLite(ds, token);
    // (update 231) a computer, the first time this file is opened this session: the players load in stages (the
    // latest season's PGA players first, then that season's other tours, then the season before, and so on), and the
    // page shows as soon as the first stage is in, filling in quietly as the rest arrive
    {
      const idx0 = detectColumns(ds.columns || []), pk0 = `${ds.id}|${ds.uploadedAt?.toMillis?.() ?? ""}`;
      if (isShotData(idx0) && !preparedCache.has(pk0)) {
        const job = STAGED.get(pk0) || startStaged(ds, pk0, idx0);
        if (!job.firstDone) { status.textContent = "Loading\u2026"; await job.first; if (token !== loadToken) return; status.textContent = ""; }
        if (!preparedCache.has(pk0)) {
          const labelled = () => [...job.prepared.values()].map((p) => ({ ...p, label: displayLabels.get(p.key) || p.label || p.key.replace(/^c_/, "") }));
          fieldPlayers = labelled();
          const box = el("div");
          mount(body, box);
          dash = sgDashboard(box, { me: meFrom(), field: fieldPlayers, idx: idx0, mode: "admin", state: dashState, viewHost, updatedAt: ds.uploadedAt?.toMillis?.() ?? null, ...dashOpts() });
          const myDash = dash;
          job.onUpdate = () => { if (dash !== myDash || fileId !== ds.id) return; fieldPlayers = labelled(); dash.update({ field: fieldPlayers, me: meFrom() }); };
          watchCoverage(job);
          return;
        }
      }
    }
    if (!preparedCache.has(`${ds.id}|${ds.uploadedAt?.toMillis?.() ?? ""}`)) await loadAll(ds, token); // (update 227: already read this session: no need)
    if (token !== loadToken) return;
    status.textContent = [pendingNote, loadNote].filter(Boolean).join(" "); pendingNote = "";
    const idx = detectColumns(ds.columns || []);
    if (!isShotData(idx)) { renderGeneric(ds); return; }
    // reading each player's rows into rounds is done once per file (not again on every redraw)
    const pk = `${ds.id}|${ds.uploadedAt?.toMillis?.() ?? ""}`;
    if (!preparedCache.has(pk)) {
      keepFew(preparedCache);
      preparedCache.set(pk, (ds.clientKeys || []).map((key) => {
        const c = rowsCache.get(`${ds.id}|${key}`) || { label: key, rows: [] };
        return { key, label: c.label, rounds: prepare(c.rows, idx) };
      }).filter((p) => p.rounds.length));
    }
    fieldPlayers = preparedCache.get(pk).map((p) => ({ ...p, label: displayLabels.get(p.key) || p.label || p.key.replace(/^c_/, "") }));
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me: meFrom(), field: fieldPlayers, idx, mode: "admin", state: dashState, viewHost, updatedAt: ds.uploadedAt?.toMillis?.() ?? null, ...dashOpts() });
    publishIfStale(ds);
  }

  // (update 231) staged loading. Stages: for each season (latest first), its PGA players, then its other tours'.
  function startStaged(ds, pk, idx) {
    const job = { prepared: new Map(), covered: new Set(), combos: new Set(), firstDone: false, done: false, onUpdate: null };
    let firstResolve; job.first = new Promise((res) => { firstResolve = res; });
    STAGED.set(pk, job);
    const finishFirst = () => { if (!job.firstDone) { job.firstDone = true; firstResolve(); } };
    (async () => {
      const keys = ds.clientKeys || [];
      // who played which season and tour (from the shared summary: a few numbers per round)
      const summary = await getFieldStats(ds.id).catch(() => null);
      const sp = summaryPlayers(summary);
      const yt = new Map(); // key → Set("year|tour")
      const tourN = new Map();
      for (const p of sp) { const s0 = new Set(); for (const rd of p.rounds) { const y = String(rd.year || String(rd.date || "").slice(0, 4)), t = rd.tour || ""; s0.add(`${y}|${t}`); job.combos.add(`${y}|${t}`); tourN.set(t, (tourN.get(t) || 0) + 1); } yt.set(p.key, s0); }
      const isPga = (t) => /pga/i.test(t) && !/champ/i.test(t);
      const years = [...new Set([...job.combos].map((c) => c.split("|")[0]))].sort().reverse();
      const tours = [...tourN.keys()].sort((a, b) => (isPga(b) - isPga(a)) || tourN.get(b) - tourN.get(a));
      const pgaT = tours.filter(isPga), otherT = tours.filter((t) => !isPga(t));
      const stages = [];
      const taken = new Set();
      for (const y of years) for (const ts of [pgaT, otherT]) {
        if (!ts.length) continue;
        const want = new Set(ts.map((t) => `${y}|${t}`));
        const ks = keys.filter((k) => [...(yt.get(k) || [])].some((c) => want.has(c)));
        stages.push({ combos: want, keys: ks });
        for (const k of ks) taken.add(k);
      }
      const order = [...new Set([...stages.flatMap((st) => st.keys), ...keys])];
      if (!stages.length) stages.push({ combos: new Set(job.combos), keys });
      // read a player's rows into rounds once they're here; a stage is ready once all its players are
      const loaded = new Set();
      let next = 0;
      const prepOne = (k) => { if (job.prepared.has(k)) return; const c = rowsCache.get(`${ds.id}|${k}`); if (!c) return; const rounds = prepare(c.rows, idx); if (rounds.length) job.prepared.set(k, { key: k, label: c.label, rounds }); };
      const advance = () => {
        let moved = false;
        while (next < stages.length && stages[next].keys.every((k) => loaded.has(k))) {
          for (const k of stages[next].keys) prepOne(k);
          for (const c of stages[next].combos) job.covered.add(c);
          next++; moved = true;
        }
        if (moved) { finishFirst(); job.onUpdate?.(); }
      };
      let pend = null;
      const onPlayer = (k, p) => { if (p) rowsCache.set(`${ds.id}|${k}`, p); loaded.add(k); if (!pend) pend = setTimeout(() => { pend = null; advance(); }, 120); };
      try {
        const { players } = await loadDatasetPlayers(ds.id, { ds, order, onPlayer });
        for (const [k, p] of players) { if (p) rowsCache.set(`${ds.id}|${k}`, p); loaded.add(k); }
      } catch (err) { console.warn(err); for (const k of keys) loaded.add(k); }
      clearTimeout(pend);
      // everyone: every stage, then anyone left over
      for (let i = 0; i < keys.length; i++) { prepOne(keys[i]); if (i % 40 === 39) await new Promise((res) => setTimeout(res, 0)); }
      for (const c of job.combos) job.covered.add(c);
      next = stages.length;
      keepFew(preparedCache);
      preparedCache.set(pk, keys.map((k) => job.prepared.get(k)).filter(Boolean));
      job.done = true; finishFirst();
      job.onUpdate?.();
      publishIfStale(ds);
    })().catch((err) => { console.warn(err); finishFirst(); });
    return job;
  }
  // (update 231) while it loads: say so only when what's on screen (a season, tour or player) isn't in yet
  let coverTimer = null;
  function watchCoverage(job) {
    clearInterval(coverTimer);
    const check = () => {
      if (job.done || !dash) { fullNote.textContent = ""; clearInterval(coverTimer); return; }
      const ys = dashState.year?.length ? dashState.year.map(String) : null, ts = dashState.tour?.length ? dashState.tour : null;
      const needed = [...job.combos].filter((c) => { const [y, t] = c.split("|"); return (!ys || ys.includes(y)) && (!ts || ts.includes(t)); });
      const missing = needed.some((c) => !job.covered.has(c)) || (player && !job.prepared.has(player.key) && !fieldPlayers.some((p) => p.key === player.key));
      fullNote.textContent = missing ? "Data is loading. Thank you for your patience." : "";
    };
    check();
    coverTimer = setInterval(check, 500);
  }
  // Phones and tablets: everyone from the shared field summary (small: a few numbers per round), and full rows
  // only for the player picked (fetched when they're picked). Loading every player's rows of a big file is more
  // than a phone's browser allows a page to hold: it stops the page and reloads it, over and over.
  async function refreshLite(ds, token) {
    const idx = detectColumns(ds.columns || []);
    const uploaded = ds.uploadedAt?.toMillis?.() ?? 0;
    const dk = `detail|${ds.id}|${uploaded}`;
    // the whole field with lie / distance detail, once it's here (from Cloud Storage; see loadDetailLite)
    if (detailCache.has(dk)) {
      const list = detailCache.get(dk).map((p) => ({ ...p, label: displayLabels.get(p.key) || p.name || p.key.replace(/^c_/, "") }));
      // (a player picked who isn't in the detail but whose rows were fetched: added, so they aren't fetched again)
      const full = player ? rowsCache.get(`${ds.id}|${player.key}`) : null;
      if (full && !list.some((p) => p.key === player.key)) list.push({ key: player.key, label: displayLabels.get(player.key) || player.label, rounds: prepare(full.rows, idx) });
      return drawLite(ds, idx, list, "");
    }
    status.textContent = "Loading players\u2026";
    const summary = await getFieldStats(ds.id).catch(() => null);
    if (token !== loadToken) return;
    const pk = `lite|${ds.id}|${uploaded}`;
    if (!preparedCache.has(pk)) { keepFew(preparedCache); preparedCache.set(pk, summaryPlayers(summary).filter((p) => p.rounds.length)); }
    // (the player picked, with their full rows, in place of their summary line)
    const full = player ? rowsCache.get(`${ds.id}|${player.key}`) : null;
    fieldPlayers = preparedCache.get(pk).map((p) => {
      const label = displayLabels.get(p.key) || p.name || p.key.replace(/^c_/, "");
      return full && p.key === player.key ? { key: p.key, label, rounds: prepare(full.rows, idx) } : { ...p, label };
    });
    if (full && !fieldPlayers.some((p) => p.key === player.key)) fieldPlayers.push({ key: player.key, label: displayLabels.get(player.key) || player.label, rounds: prepare(full.rows, idx) });
    const ranked = fieldPlayers.some((p) => p.summaryOnly);
    const why = detailWhy.get(dk);
    const note = !ranked ? "The rankings for this file haven\u2019t been built yet. Open Analyze once on a computer to build them; here you can still pick a player to see their own numbers."
      : why === undefined || why === null ? "Loading lie and distance detail\u2026"
      : why === "paused" ? "Lie and distance ranks are paused: this month\u2019s budget was reached."
      : why === "none" || why === "stale" ? "Lie and distance ranks appear once Analyze has been opened on a computer since the last upload."
      : "Couldn\u2019t load the lie and distance detail, so rankings don\u2019t break down by lie or distance.";
    drawLite(ds, idx, fieldPlayers, note, why === "paused");
    if (why === undefined) loadDetailLite(ds, dk);
  }

  // Phones: the field's lie / distance detail, once per upload (kept on the device after the first time).
  const detailCache = DETAIL, detailWhy = DETAIL_WHY;
  async function loadDetailLite(ds, dk) {
    detailWhy.set(dk, null); // (asked for: not asked again while it loads)
    const { players, why } = await getFieldDetail(ds.id, ds.uploadedAt?.toMillis?.() ?? 0);
    detailWhy.set(dk, why);
    if (players) { keepFew(detailCache, 2); detailCache.set(dk, players); for (const k of [...preparedCache.keys()]) if (k.startsWith("lite|")) preparedCache.delete(k); }
    if (source === "tour" && fileId === ds.id) refresh(); // (redrawn with the detail, or with the reason it isn't there)
  }

  function drawLite(ds, idx, players, note, paused = false) {
    fieldPlayers = players;
    const notes = [pendingNote, note]; pendingNote = "";
    status.textContent = notes.filter(Boolean).join(" ");
    if (paused) {
      // (the budget function switched downloads off; the admin can switch them back on)
      const btn = el("button", { type: "button", class: "link" }, "Resume");
      btn.addEventListener("click", async () => { btn.disabled = true; await resumeDownloads().catch(() => {}); detailWhy.clear(); refresh(); });
      status.append(" ", btn);
    }
    const me = meFrom();
    if (!fieldPlayers.length) {
      mount(body, el("p", { class: "empty center" }, player ? `Loading ${player.label}\u2026` : "Pick a player above."));
      showPills();
      if (player) pickerRef?.select?.(player.key);
      return;
    }
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me: me && !me.summaryOnly ? me : null, field: fieldPlayers, idx, mode: "admin", state: dashState, viewHost, updatedAt: ds.uploadedAt?.toMillis?.() ?? null, ...dashOpts() });
    // (never published from here: this field is the summary itself)
    if (player && (!me || me.summaryOnly)) pickerRef?.select?.(player.key); // fetch the picked player's full rows
  }

  // Rounds from Data Entry, every player, in the same dashboard.
  // Your own rounds table (with Delete), kept live while Entered Rounds is showing.
  const roundsTableBox = el("div");
  let stopMine = () => {};
  let firstMine = true;
  // The rounds table follows the player picked above: their entered rounds only (yours when you pick
  // yourself). In admin mode, Delete appears only on rounds you entered.
  function watchMine() {
    stopMine(); stopMine = () => {};
    firstMine = true;
    if (!player) { mount(roundsTableBox, el("p", { class: "muted center small" }, "Pick a player to see their entered rounds.")); return; }
    const uid = getState().user.uid;
    const mineKey = myEntryKey(getState());
    stopMine = watchPlayerRounds(player.key, (rounds) => {
      mount(roundsTableBox, null && myRoundsTable(rounds, { flash, canDelete: (r) => r.ownerUid === uid,
        title: player.key === mineKey ? "Your rounds" : `${player.label}'s rounds` }) || el("p", { class: "muted center small" }, `${player.label} has no entered rounds yet.`));
      if (!firstMine && source === "entered") refreshEntered(); // a round was added or deleted: redo the stats
      firstMine = false;
    });
  }

  async function refreshEntered() {
    const token = ++loadToken;
    status.textContent = "Loading entered rounds\u2026";
    const rounds = await getAllRounds().catch(() => []);
    enteredUpdated = Math.max(0, ...rounds.map((r) => r.updatedAt?.toMillis?.() ?? 0)) || null; // for "last updated"
    if (token !== loadToken) return;
    status.textContent = "";
    fieldPlayers = enteredPlayers(rounds, (r) => displayLabels.get(r.playerKey) || r.playerLabel, { withQuick: true });
    drawEntered();
  }

  // Entered Rounds shows strokes gained only for the player picked above: nothing until one is picked,
  // and a plain message when that player hasn't entered any rounds (never anyone else's numbers).
  function drawEntered() {
    dash?.destroy(); dash = null; sourceHome.hidden = true;
    const me = meFrom();
    if (!player) { emptyDash("Pick a player above to see their entered rounds."); return; }
    if (!me) { emptyDash(`${player.label} hasn't entered any rounds yet${player.key === myEntryKey(getState()) ? " \u2014 record one in Enter New Round." : "."}`); return; }
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me, field: fieldPlayers, idx: ENTERED_IDX, entered: true, mode: "admin", state: enteredState, note: ENTERED_NOTE, viewHost, updatedAt: enteredUpdated, ...dashOpts() });
  }

  // Nothing to show yet: the same Filters panel (with Tour Events | Entered Rounds | Practice in it) and why (update 145)
  const emptyState = {};
  function emptyDash(note, { practice = false } = {}) {
    dash?.destroy(); dash = null;
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me: null, field: [], idx: ENTERED_IDX, entered: true, mode: "admin", rankings: false, practice, state: emptyState, emptyNote: note, viewHost,
      ...dashOpts(!player) });
  }

  // Practice (update 139): the picked player's practice sessions, games and Course Prep rounds.
  const practiceState = {};
  async function refreshPractice() {
    dash?.destroy(); dash = null; sourceHome.hidden = true;
    if (!player) { emptyDash("Pick a player above to see their practice.", { practice: true }); return; }
    const token = ++loadToken;
    status.textContent = "Loading practice\u2026";
    const { loadPracticeFor } = await import("../practice/toStats.js");
    const st = getState();
    // (you: your own practice, kept under your account; a player: theirs, under their player key)
    const key = player.key === myEntryKey(st) ? st.user.uid : player.key;
    let rounds = [];
    try { rounds = await loadPracticeFor(key); } catch (err) { console.error(err); }
    if (token !== loadToken) return;
    status.textContent = "";
    if (!rounds.length) { emptyDash(`${player.label} hasn't logged any practice yet.`, { practice: true }); return; }
    const me = { key: player.key, label: player.label, rounds };
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me, field: [me], idx: ENTERED_IDX, entered: true, practice: true, mode: "admin", rankings: false, state: practiceState, note: "Practice: sessions, games and Course Prep rounds, measured against the Tour baselines by distance (and lie, where it's known).", viewHost, ...dashOpts() });
  }

  // Keep the players' rankings (the published per-round summary) in step with this file.
  async function publishIfStale(ds) {
    if (loadNote) return; // (not while some players' rows are missing: the shared summary would leave them out)
    try {
      const uploaded = ds.uploadedAt?.toMillis?.() ?? 0;
      const src = await fieldStatsSource(ds.id);
      const asPublished = () => fieldPlayers.map((p) => ({ key: p.key, name: p.label, rounds: p.rounds }));
      if (src === null || src < uploaded) await publishFieldStats(ds.id, buildFieldSummary(asPublished()), Date.now());
      // the per-round lie / distance detail for phones and players' portals (Cloud Storage)
      const dsrc = await detailSource(ds.id);
      if (dsrc === null || dsrc < uploaded) {
        const res = await publishFieldDetail(ds.id, asPublished(), Date.now());
        if (res?.skipped === "paused") console.info("Detail not published: downloads are paused (budget reached).");
      }
    } catch (err) { console.error("Couldn't publish rankings for players", err); }
  }

  function renderGeneric(ds) {
    const numeric = (ds.columns || []).map((c, i) => ({ ...c, i })).filter((c) => c.type === "number");
    const statSel = el("select", {}, numeric.length ? numeric.map((c) => el("option", { value: String(c.i) }, c.name)) : el("option", { value: "" }, "No number columns"));
    const tableBox = el("div");
    const drawTable = () => {
      const col = statSel.value === "" ? -1 : Number(statSel.value);
      const rows = (ds.clientKeys || []).map((key) => {
        const { label, rows: r } = rowsCache.get(`${ds.id}|${key}`) || { label: key, rows: [] };
        const vals = col < 0 ? [] : r.map((x) => x[col]).filter((v) => v !== null && v !== "" && !isNaN(Number(v))).map(Number);
        return { key, label: displayLabels.get(key) || label, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: r.length };
      }).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
      mount(tableBox, el("div", { class: "table-scroll rank-scroll" }, el("table", { class: "plain rankings" }, [
        el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, `Average ${statSel.selectedOptions[0]?.textContent || ""}`), el("th", { class: "num" }, "Rows")])),
        el("tbody", {}, rows.map((r, i) => el("tr", { class: r.key === player?.key ? "me" : null }, [
          el("td", { class: "num" }, r.value === null ? "\u2014" : String(i + 1)), el("td", {}, r.label),
          el("td", { class: "num" }, r.value === null ? "\u2014" : nf1.format(r.value)), el("td", { class: "num" }, num(r.n)),
        ]))),
      ])));
    };
    statSel.addEventListener("change", drawTable);
    mount(body, [
      el("p", { class: "muted center" }, "This file isn't strokes-gained data (it needs a category column with Off-the-Tee / Approach / Around-the-Green / Putting and strokes gained, either per shot or per attempt with attempts), so here's a simple comparison instead."),
      el("section", { class: "panel sg-box full" }, [el("h3", {}, "Compare players"), el("label", { class: "inline-select" }, ["Stat", statSel]), tableBox]),
    ]);
    drawTable();
  }

  const drawPortalLink = () => mount(portalLink, null && player && !player.key.startsWith("a_")
    ? el("a", { href: `#/view-as/${encodeURIComponent(player.key)}?label=${encodeURIComponent(player.label)}` }, `See ${player.label}'s portal`)
    : null);

  const stopFiles = watchAdminDatasets((list) => {
    datasets = list; // newest first
    const sg = list.find((d) => isShotData(detectColumns(d.columns || [])));
    fileId = (sg || list[0])?.id || "";
    if (source === "tour") refresh();
  });

  const { labels, ids } = await adminAllClients();
  // "Me" first: your own entered rounds (Data Entry), alongside every player.
  const meKey = myEntryKey(getState());
  displayLabels = new Map([[meKey, myName()], ...labels]); // you, by your Profile name, at the top
  fieldPlayers = fieldPlayers.map((p) => ({ ...p, label: labels.get(p.key) || p.label }));
  const picker = pickerRef = playerPicker(displayLabels, (p) => {
    player = p;
    watchEntered(p?.key || null); // (update 223)
    if (source === "entered") watchMine();
    drawPortalLink();
    if (source === "entered") drawEntered();
    else if (source === "practice") refreshPractice();
    else if (dash || datasets.length) {
      // A player who isn't in the file on screen: open the newest file that has them, or say why there's nothing
      // (rather than leaving the leaderboard up as if the click did nothing).
      status.textContent = "";
      if (p && (!meBase() || meBase().summaryOnly) && !(enteredOf.get(p.key) || []).length) {
        const other = meFrom() ? null : datasets.find((d) => d.id !== fileId && isShotData(detectColumns(d.columns || [])) && (d.clientKeys || []).includes(p.key));
        if (other) { fileId = other.id; pendingNote = `${p.label} is in ${other.name || "another file"}, so that file is showing.`; refresh(); return; }
        const cur = datasets.find((d) => d.id === fileId);
        const inFile = (cur?.clientKeys || []).includes(p.key);
        if (inFile) {
          // in the file but not on screen: their rows didn't load (or can't be read). Fetch them again now.
          status.textContent = `Loading ${p.label}\u2026`;
          reloadPlayerRows(cur.id, p.key).then((rows) => {
            if (player?.key !== p.key) return;
            const rounds = prepare(rows, detectColumns(cur.columns || []));
            if (!rounds.length) {
              status.textContent = rows.length ? `${p.label} has ${rows.length.toLocaleString()} rows in ${cur.name || "this file"}, but none could be read as rounds (each needs a date, a tournament, a stat and a value).`
                : `${p.label} is listed in ${cur.name || "this file"}, but no rows were stored for them. Re-upload the file to fix it.`;
              if (dash) dash.update({ me: null });
              return;
            }
            rowsCache.set(`${cur.id}|${p.key}`, { label: p.label, rows });
            const one = { key: p.key, label: displayLabels.get(p.key) || p.label, rounds };
            fieldPlayers = [...fieldPlayers.filter((q) => q.key !== p.key), one];
            for (const [k, list] of preparedCache) preparedCache.set(k, [...list.filter((q) => q.key !== p.key), one]);
            status.textContent = "";
            if (dash) dash.update({ field: fieldPlayers, me: one }); else refresh();
          }).catch((err) => {
            if (player?.key !== p.key) return;
            status.textContent = `Couldn\u2019t load ${p.label}\u2019s rows: ${loadErrorText(err)}. Try again in a moment.`;
            if (dash) dash.update({ me: null });
          });
          return;
        }
        status.textContent = `${p.label} has no tour data in ${cur?.name || "the uploaded file"} and no entered rounds yet. Upload a file with their rows, or enter a round for them.`;
        if (dash) dash.update({ me: null });
        return;
      }
      if (dash) dash.update({ me: meFrom() });
      else refresh(); // simple comparison: redraw with the highlight (rows are cached)
    }
  }, ids, meKey);
  mount(pickerBox, picker.node);
  if (dash) dash.update({ field: fieldPlayers, me: meFrom() });
  // Player Stats starts blank: just the search (or on the player tapped on the Leaderboards)
  const wanted = new URLSearchParams(location.hash.split("?")[1] || "").get("player");
  if (!board && wanted) picker.select(wanted);

  return () => { loadToken++; clearInterval(coverTimer); dash?.destroy(); stopFiles(); stopMine(); stopEnt(); undoTop(); };
}
