import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { watchClientDatasets, getDatasetRows, getFieldStats } from "../store.js";
import { detectColumns, isShotData, prepare, summaryPlayers } from "../sg.js";
import { sgDashboard } from "../sgDashboard.js";
import { plainName, teamLabels } from "../names.js";
import { effectiveTeam } from "../preview.js";
import { render as renderDataset } from "./dataset.js";
import { teamPlayerSelect } from "../teamPlayerSelect.js";

// My Data: opens the player's data straight away. A strokes-gained file gets the same dashboard as the
// admin's Analyze page (filters, cards, category charts, trends, rankings); any other file gets the
// plain chart and table. Players have one data file; if there are ever more, tabs let them switch.
export async function render(main, { previewClient, flash }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile?.clientKey;
  if (!clientKey) return; // signed out or profile gone mid-navigation
  const teamRole = previewClient?.role || null; // set when a coach, caddy, ... is viewing a player

  const tabs = el("nav", { class: "subnav small", "aria-label": "Data files" });
  const box = el("div", { class: "embedded-dataset" });
  mount(main, [teamPlayerSelect(previewClient, "/dashboard"), tabs, box]);

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
      const dash = sgDashboard(inner, { me, field: field.length ? field : [{ ...me, summaryOnly: true }], idx, mode: "player", state: dashState });
      stopDataset = () => dash.destroy();
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

  return () => { unsub(); stopDataset(); };
}
