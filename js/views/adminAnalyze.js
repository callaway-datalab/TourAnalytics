// Data → Analyze: the strokes-gained dashboard for any player, with rankings across every player.
// Players see the same dashboard on their own My Data page (see sgDashboard.js).
import { el, mount, num, subNav } from "../ui.js";
import { adminAllClients, watchAdminDatasets, getDatasetMeta, getDatasetRows, publishFieldStats, fieldStatsSource } from "../store.js";
import { playerPicker } from "../playerPicker.js";
import { detectColumns, isShotData, prepare, buildFieldSummary } from "../sg.js";
import { sgDashboard } from "../sgDashboard.js";

const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export async function render(main, { flash }) {
  let player = null;               // { key, label }
  let datasets = [];
  let loadToken = 0;
  let dash = null;                 // the dashboard for the current file
  let fieldPlayers = [];           // [{ key, label, rounds }]
  const dashState = {};            // filters survive switching players
  const rowsCache = new Map();     // `${datasetId}|${playerKey}` -> { label, rows }
  let displayLabels = new Map();   // player key -> name (the ID when there's no name)

  const pickerBox = el("div");
  const fileSel = el("select", { "aria-label": "Data file" });
  const status = el("p", { class: "muted center", role: "status" });
  const portalLink = el("p", { class: "center" });
  const body = el("div", { class: "sg-body" });

  mount(main, [
    subNav([["#/admin/datasets", "Upload"], ["#/admin/analyze", "Analyze"]], "#/admin/analyze"),
    pickerBox,
    el("div", { class: "analyze-controls" }, [el("label", {}, ["Data file", fileSel])]),
    portalLink,
    status,
    body,
  ]);

  async function loadAll(ds, token) {
    const keys = [...(ds.clientKeys || [])];
    const total = keys.length;
    let done = 0;
    const next = async () => {
      while (keys.length && token === loadToken) {
        const key = keys.shift();
        const ck = `${ds.id}|${key}`;
        if (!rowsCache.has(ck)) {
          try {
            const meta = await getDatasetMeta(key, ds.id);
            rowsCache.set(ck, { label: meta.playerName || meta.clientLabel, rows: await getDatasetRows(key, ds.id, meta.chunkCount) });
          } catch { rowsCache.set(ck, { label: key.replace(/^c_/, ""), rows: [] }); }
        }
        done++;
        if (token === loadToken) status.textContent = `Loading players\u2026 ${done} of ${total}`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, next));
  }

  const meFrom = () => (player && fieldPlayers.find((p) => p.key === player.key)) || null;

  async function refresh() {
    const ds = datasets.find((d) => d.id === fileSel.value);
    dash?.destroy(); dash = null;
    if (!ds) { status.textContent = ""; mount(body, el("p", { class: "empty center" }, "Upload a data file to analyze.")); return; }
    const token = ++loadToken;
    mount(body, null);
    await loadAll(ds, token);
    if (token !== loadToken) return;
    status.textContent = "";
    const idx = detectColumns(ds.columns || []);
    if (!isShotData(idx)) { renderGeneric(ds); return; }
    fieldPlayers = (ds.clientKeys || []).map((key) => {
      const c = rowsCache.get(`${ds.id}|${key}`) || { label: key, rows: [] };
      return { key, label: displayLabels.get(key) || c.label || key.replace(/^c_/, ""), rounds: prepare(c.rows, idx) };
    }).filter((p) => p.rounds.length);
    const box = el("div");
    mount(body, box);
    dash = sgDashboard(box, { me: meFrom(), field: fieldPlayers, idx, mode: "admin", state: dashState });
    publishIfStale(ds);
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

  const drawPortalLink = () => mount(portalLink, player
    ? el("a", { href: `#/view-as/${encodeURIComponent(player.key)}?label=${encodeURIComponent(player.label)}` }, `See ${player.label}'s portal`)
    : null);

  fileSel.addEventListener("change", refresh);
  const stopFiles = watchAdminDatasets((list) => {
    const keep = fileSel.value;
    datasets = list;
    mount(fileSel, list.length ? list.map((d) => el("option", { value: d.id }, d.name)) : el("option", { value: "" }, "No data files yet"));
    if (list.some((d) => d.id === keep)) fileSel.value = keep;
    else {
      const sg = list.find((d) => isShotData(detectColumns(d.columns || [])));
      if (sg) fileSel.value = sg.id;
    }
    refresh();
  });

  const { labels, ids } = await adminAllClients();
  displayLabels = labels;
  fieldPlayers = fieldPlayers.map((p) => ({ ...p, label: labels.get(p.key) || p.label }));
  const picker = playerPicker(labels, (p) => {
    player = p;
    drawPortalLink();
    if (dash) dash.update({ me: meFrom() });
    else if (datasets.length) refresh(); // simple comparison: redraw with the highlight (rows are cached)
  }, ids);
  mount(pickerBox, picker.node);
  if (dash) dash.update({ field: fieldPlayers, me: meFrom() });
  picker.restore();

  return () => { loadToken++; dash?.destroy(); stopFiles(); };
}
