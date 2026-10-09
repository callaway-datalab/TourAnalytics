import { el, mount, relocateSectionNav } from "../ui.js";
import { getState } from "../auth.js";
import { watchClientDatasets, getDatasetRows, getFieldStats } from "../store.js";
import { detectColumns, isShotData, prepare, summaryPlayers } from "../sg.js";
import { sgDashboard } from "../sgDashboard.js";
import { plainName, teamLabels } from "../names.js";
import { effectiveTeam } from "../preview.js";
import { render as renderDataset } from "./dataset.js";
import { teamPlayerSelect } from "../teamPlayerSelect.js";
import { watchPlayerRounds, watchMyRounds } from "../rounds.js";
import { myRoundsTable } from "../myRoundsTable.js";
import { myEntryKey } from "./dataEntry.js";
import { enteredPlayers, ENTERED_IDX } from "../roundCalc.js";

let lastSource = "tour"; // Tour | Entered Rounds, remembered while the app is open

// My Stats: opens the player's stats straight away, with Tour | Entered Rounds pills on top. A strokes-gained file gets the same dashboard as the
// admin's Analyze page (filters, cards, category charts, trends, rankings); any other file gets the
// plain chart and table. Players have one data file; if there are ever more, tabs let them switch.
export async function render(main, { previewClient, flash }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile?.clientKey;
  if (!clientKey) return; // signed out or profile gone mid-navigation
  const teamRole = previewClient?.role || null; // set when a coach, caddy, ... is viewing a player

  const tabs = el("nav", { class: "subnav small", "aria-label": "Data files" });
  const box = el("div", { class: "embedded-dataset" });
  const tourBox = el("div", {}, [tabs, box]);
  const enteredBox = el("div", { class: "embedded-dataset entered-box" });
  const roundsTableBox = el("div");
  const enteredDashBox = el("div");
  mount(enteredBox, [roundsTableBox, enteredDashBox]);
  // Your own view (a player, or a coach on "Me"): the table of your rounds, with Delete.
  const ownView = !previewClient || previewClient.self;
  const uid = state.user.uid;
  // In the admin's preview of a player, their rounds show with Delete (acting as that player).
  const adminPreviewOfPlayer = state.isAdmin && previewClient && !previewClient.role && !previewClient.self;
  const unsubTable = ownView
    ? watchPlayerRounds(myEntryKey(state), (rounds) => mount(roundsTableBox, myRoundsTable(rounds, { flash, canDelete: (r) => r.ownerUid === uid })))
    : adminPreviewOfPlayer
      ? watchPlayerRounds(clientKey, (rounds) => mount(roundsTableBox, myRoundsTable(rounds, { flash, title: `${previewClient.label}'s rounds` })))
      : () => {};

  // Tour (uploaded stats) | Entered Rounds (from Data Entry). "Me" (a coach's own) has only entered rounds.
  if (previewClient?.self) lastSource = "entered";
  let tourDashNow = null;
  const sourcePills = el("nav", { class: "subnav source-pills", "aria-label": "Data" });
  const viewHost = el("div", { class: "view-host" }); // (kept empty: Basic / Advanced was here)
  const drawSource = () => {
    tourBox.hidden = lastSource !== "tour";
    enteredBox.hidden = lastSource !== "entered";
    mount(sourcePills, [["tour", "Tour Events"], ["entered", "Entered Rounds"]].map(([v, l]) => {
      const a = el("a", { href: "#", "aria-current": lastSource === v ? "page" : null }, l);
      a.addEventListener("click", (e) => {
        e.preventDefault(); lastSource = v; drawSource();
        const d = v === "tour" ? tourDashNow : enteredDash;
        if (d) d.update({}); // it takes the pills into its Filters panel
        else { sourceHome.appendChild(sourcePills); sourceHome.hidden = false; } // nothing to show there: keep the pills on the page
      });
      return a;
    }));
  };
  // lent to the stats' one row of pills; hidden while loading (so the pills don't flash outside the Filters
  // panel), shown when there's nothing to draw
  const sourceHome = el("div", { class: "pill-row source-home", hidden: true }, sourcePills);
  const showPills = () => { if (sourcePills.parentNode === sourceHome || !sourcePills.parentNode) { sourceHome.appendChild(sourcePills); sourceHome.hidden = false; } };
  // a coach's player dropdown: the Stats / Performance Reports / … row goes under it (as on the admin's Stats)
  const picker = teamPlayerSelect(previewClient, "/dashboard");
  const secHome = el("div", { class: "sec-home" });
  mount(main, [picker, picker ? secHome : null, sourceHome, tourBox, enteredBox]);
  const undoTop = picker ? relocateSectionNav(main, secHome) : () => {};
  drawSource();

  let current = null;       // id of the file on screen
  let shownVersion = null;  // id + upload time, so a re-upload refreshes the view
  let stopDataset = () => {};
  const dashState = {};

  const show = async (d) => {
    const version = `${d.id}|${d.uploadedAt?.toMillis?.() ?? ""}`;
    if (version === shownVersion) return;
    shownVersion = version;
    stopDataset(); stopDataset = () => {};
    const idx = detectColumns(d.columns || []);
    if (isShotData(idx)) {
      mount(box, el("p", { class: "empty center" }, "Loading\u2026"));
      const [rows, summary] = await Promise.all([getDatasetRows(clientKey, d.id, d.chunkCount), getFieldStats(d.id).catch(() => null)]);
      if (shownVersion !== version) return;
      // Names without "(ID)": a coach keeps the ID only for their own players who share a name.
      const tl = previewClient?.role ? teamLabels(effectiveTeam(getState()).teamAccess) : new Map();
      const shown = (key, name) => tl.get(key) ?? plainName(name || key.replace(/^c_/, ""));
      const field = summaryPlayers(summary).map((p) => ({ ...p, label: shown(p.key, p.name) }));
      const label = field.find((p) => p.key === clientKey)?.label || shown(clientKey, d.playerName || previewClient?.label || d.clientLabel);
      const me = { key: clientKey, label, rounds: prepare(rows, idx) };
      const inner = el("div");
      mount(box, inner);
      const dash = sgDashboard(inner, { me, field: field.length ? field : [{ ...me, summaryOnly: true }], idx, mode: "player", teamRole, state: dashState, updatedAt: d.uploadedAt?.toMillis?.() ?? null, viewHost, lead: sourcePills, leadHome: sourceHome });
      stopDataset = () => dash.destroy();
      tourDashNow = dash;
      // The admin looking through a player's portal can read everyone's full data: load it, so the charts by
      // lie, distance and club get their comparison dashes and Rank filter too (players only have the summary).
      const st0 = getState();
      if (st0.isAdmin && previewClient && !previewClient.self && field.length) {
        const myVersion = version;
        (async () => {
          const { loadDatasetPlayers, isLiteDevice } = await import("../fieldCache.js");
          if (isLiteDevice()) return; // (phones and tablets: the summary is enough; every player's rows is too much for them)
          const { players } = await loadDatasetPlayers(d.id).catch(() => ({ players: new Map() }));
          const full = field.map((p) => {
            if (p.key === clientKey) return { key: p.key, label: p.label, rounds: me.rounds };
            const got = players.get(p.key);
            return got ? { key: p.key, label: p.label, rounds: prepare(got.rows, idx) } : null; // that player's file isn't there: leave them out
          }).filter((p) => p && p.rounds.length);
          if (shownVersion !== myVersion || full.length < 2) return;
          dash.update({ field: full });
        })();
      }
      return;
    }
    const cleanup = await renderDataset(box, { params: { id: d.id }, previewClient, flash, embedded: true, hideTitle: true });
    if (typeof cleanup === "function") stopDataset = cleanup;
  };

  const unsub = watchClientDatasets(clientKey, (datasets) => {
    if (!datasets.length) {
      current = null; shownVersion = null; stopDataset(); stopDataset = () => {};
      mount(tabs, null); tabs.hidden = true;
      mount(box, el("p", { class: "empty center" }, teamRole ? "No data has been added for this player yet."
        : "No data has been added to your account yet. It will appear here as soon as it's uploaded."));
      if (lastSource === "tour") showPills();
      return;
    }
    datasets.sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0));
    if (!current || !datasets.some((d) => d.id === current)) current = datasets[0].id;
    tabs.hidden = datasets.length < 2;
    const drawTabs = () => mount(tabs, datasets.length < 2 ? null : datasets.map((d) => {
      const a = el("a", { href: "#", "aria-current": d.id === current ? "page" : null }, d.name);
      a.addEventListener("click", (e) => { e.preventDefault(); current = d.id; drawTabs(); show(d); });
      return a;
    }));
    drawTabs();
    show(datasets.find((d) => d.id === current));
  });

  // Entered rounds: this player's own rounds from Data Entry. Nobody else's are shown here, so no rankings.
  let enteredDash = null;
  const enteredState = {};
  const unsubEntered = watchPlayerRounds(clientKey, (rounds) => {
    const players = enteredPlayers(rounds, () => "", { withQuick: true });
    const tl = previewClient?.role ? teamLabels(effectiveTeam(getState()).teamAccess) : new Map();
    const label = tl.get(clientKey) ?? plainName(previewClient?.label || state.profile?.name || "You");
    enteredDash?.destroy(); enteredDash = null;
    if (!players.length) {
      mount(enteredDashBox, el("p", { class: "empty center" }, ["No entered rounds yet. Record one in ", el("a", { href: "#/entry" }, "Track Round"), " and it shows up here."]));
      if (lastSource === "entered") showPills();
      return;
    }
    const me = { ...players[0], label };
    const inner = el("div");
    mount(enteredDashBox, inner);
    enteredDash = sgDashboard(inner, { me, field: [me], idx: ENTERED_IDX, entered: true, mode: "player", teamRole, state: enteredState, rankings: false, viewHost, lead: sourcePills, leadHome: sourceHome,
      note: "Entered rounds: strokes gained is measured against the scoring-average baseline by lie and distance." });
  });

  return () => { unsub(); stopDataset(); unsubEntered(); unsubTable(); enteredDash?.destroy(); undoTop(); };
}
