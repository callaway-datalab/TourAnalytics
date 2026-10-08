// Data → Analyze: the strokes-gained dashboard for any player, with rankings across every player.
// Players see the same dashboard on their own My Data page (see sgDashboard.js).
import { el, mount, num, subNav } from "../ui.js";
import { adminAllClients, watchAdminDatasets, publishFieldStats, fieldStatsSource } from "../store.js";
import { loadDatasetPlayers } from "../fieldCache.js";
import { playerPicker } from "../playerPicker.js";
import { detectColumns, isShotData, prepare, buildFieldSummary } from "../sg.js";
import { sgDashboard } from "../sgDashboard.js";
import { getAllRounds, watchPlayerRounds } from "../rounds.js";
import { myRoundsTable } from "../myRoundsTable.js";
import { getState } from "../auth.js";
import { myEntryKey, myName } from "./dataEntry.js";
import { enteredPlayers, ENTERED_IDX } from "../roundCalc.js";

export const ENTERED_NOTE = "Entered rounds: strokes gained is measured against the scoring-average baseline by lie and distance.";

const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export async function render(main, { flash }) {
  let player = null;               // { key, label }
  let datasets = [];
  let loadToken = 0;
  let dash = null;                 // the dashboard for the current file
  let fieldPlayers = [];           // [{ key, label, rounds }]
  const dashState = {};            // filters survive switching players
  const enteredState = {};
  let source = "tour";             // "tour": uploaded Tour stats; "entered": rounds from Data Entry
  const rowsCache = new Map();     // `${datasetId}|${playerKey}` -> { label, rows }
  const preparedCache = new Map(); // `${datasetId}|${uploadedAt}` -> [{ key, label, rounds }]
  let displayLabels = new Map();   // player key -> name (the ID when there's no name)

  const pickerBox = el("div");
  let fileId = "";                 // the file being analyzed: the newest strokes-gained file
  const status = el("p", { class: "muted center", role: "status" });
  const portalLink = el("p", { class: "center" });
  let enteredUpdated = null;
  let pickerRef = null; // the player search (so the leaderboard can pick a player)
  const sourceHome = el("div", { class: "pill-row source-home" });
  queueMicrotask(() => { if (!sourcePills.parentNode) sourceHome.appendChild(sourcePills); });
  // the player search + portal link: placed by the dashboard under its pills (above the dropdowns);
  // when there's no dashboard (nothing to show yet) it sits here
  const pickerSlot = el("div", { class: "analyze-picker" }, [pickerBox]); // (no portal link: that's on Player Access)
  const pickerHome = el("div", { class: "picker-home" }, pickerSlot);
  const body = el("div", { class: "sg-body" });

  // Tour | Entered Rounds
  const sourcePills = el("nav", { class: "subnav source-pills", "aria-label": "Data" });
  const viewHost = el("div", { class: "view-host" }); // Basic / Advanced, right under the data pills
  const drawSource = () => mount(sourcePills, [["tour", "Tour Events"], ["entered", "Entered Rounds"]].map(([v, l]) => {
    const a = el("a", { href: "#", "aria-current": source === v ? "page" : null }, l);
    a.addEventListener("click", (e) => { e.preventDefault(); if (source === v) return; source = v; drawSource(); if (v === "entered") watchMine(); else { stopMine(); stopMine = () => {}; } refresh(); });
    return a;
  }));
  drawSource();

  mount(main, [
    subNav([["#/admin/analyze", "Analyze"], ["#/admin/datasets", "Upload"]], "#/admin/analyze"),
    sourceHome, // the data pills sit here until the stats draw them into their one row of pills
    pickerHome,
    status,
    body,
  ]);

  // Every player's rows: from memory, or the copy kept on this device, or (first time / new upload) Firestore.
  async function loadAll(ds, token) {
    const total = (ds.clientKeys || []).length;
    status.textContent = "Loading players\u2026";
    const { players } = await loadDatasetPlayers(ds.id, { ds, onProgress: (done) => {
      if (token === loadToken) status.textContent = `Loading players\u2026 ${done} of ${total}. This is kept on this device, so the next refresh is quick.`;
    } });
    for (const [key, p] of players) if (p) rowsCache.set(`${ds.id}|${key}`, p);
  }

  const meFrom = () => (player && fieldPlayers.find((p) => p.key === player.key)) || null;

  async function refresh() {
    dash?.destroy(); dash = null;
    if (source === "entered") return refreshEntered();
    const ds = datasets.find((d) => d.id === fileId);
    if (!ds) { status.textContent = ""; mount(body, el("p", { class: "empty center" }, "Upload a data file to analyze.")); return; }
    const token = ++loadToken;
    mount(body, null);
    await loadAll(ds, token);
    if (token !== loadToken) return;
    status.textContent = "";
    const idx = detectColumns(ds.columns || []);
    if (!isShotData(idx)) { renderGeneric(ds); return; }
    // reading each player's rows into rounds is done once per file (not again on every redraw)
    const pk = `${ds.id}|${ds.uploadedAt?.toMillis?.() ?? ""}`;
    if (!preparedCache.has(pk)) {
      preparedCache.clear();
      preparedCache.set(pk, (ds.clientKeys || []).map((key) => {
        const c = rowsCache.get(`${ds.id}|${key}`) || { label: key, rows: [] };
        return { key, label: c.label, rounds: prepare(c.rows, idx) };
      }).filter((p) => p.rounds.length));
    }
    fieldPlayers = preparedCache.get(pk).map((p) => ({ ...p, label: displayLabels.get(p.key) || p.label || p.key.replace(/^c_/, "") }));
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me: meFrom(), field: fieldPlayers, idx, mode: "admin", state: dashState, viewHost, updatedAt: ds.uploadedAt?.toMillis?.() ?? null, slot: pickerSlot, slotHome: pickerHome, lead: sourcePills, leadHome: sourceHome, onPick: (key) => pickerRef?.select?.(key) });
    publishIfStale(ds);
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
    fieldPlayers = enteredPlayers(rounds, (r) => displayLabels.get(r.playerKey) || r.playerLabel);
    drawEntered();
  }

  // Entered Rounds shows strokes gained only for the player picked above: nothing until one is picked,
  // and a plain message when that player hasn't entered any rounds (never anyone else's numbers).
  function drawEntered() {
    dash?.destroy(); dash = null;
    const me = meFrom();
    if (!player) { mount(body, el("p", { class: "empty center" }, "Pick a player above to see their entered rounds.")); return; }
    if (!me) {
      mount(body, el("p", { class: "empty center" }, `${player.label} hasn't entered any rounds yet${player.key === myEntryKey(getState()) ? " \u2014 record one in Data Entry." : "."}`));
      return;
    }
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me, field: fieldPlayers, idx: ENTERED_IDX, entered: true, mode: "admin", state: enteredState, note: ENTERED_NOTE, viewHost, updatedAt: enteredUpdated, slot: pickerSlot, slotHome: pickerHome, lead: sourcePills, leadHome: sourceHome, onPick: (key) => pickerRef?.select?.(key) });
  }

  // Keep the players' rankings (the published per-round summary) in step with this file.
  async function publishIfStale(ds) {
    try {
      const uploaded = ds.uploadedAt?.toMillis?.() ?? 0;
      const src = await fieldStatsSource(ds.id);
      if (src !== null && src >= uploaded) return;
      await publishFieldStats(ds.id, buildFieldSummary(fieldPlayers.map((p) => ({ key: p.key, name: p.label, rounds: p.rounds }))), Date.now());
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
    if (source === "entered") watchMine();
    drawPortalLink();
    if (source === "entered") drawEntered();
    else if (dash) dash.update({ me: meFrom() });
    else if (datasets.length) refresh(); // simple comparison: redraw with the highlight (rows are cached)
  }, ids, meKey);
  mount(pickerBox, picker.node);
  if (dash) dash.update({ field: fieldPlayers, me: meFrom() });
  picker.restore();

  return () => { loadToken++; dash?.destroy(); stopFiles(); stopMine(); };
}
