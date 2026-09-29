// Data → Analyze.
//  1. Pick a player and see their data exactly as they do (same charts and tables).
//  2. "Compare players": admin-only charts across every player in a data file. Players never see these.
import { el, mount, num, subNav, loadScript } from "../ui.js";
import { adminAllClients, watchClientDatasets, watchAdminDatasets, getDatasetMeta, getDatasetRows } from "../store.js";
import { playerPicker } from "../playerPicker.js";
import { render as renderDataset } from "./dataset.js";

const CHART_JS = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
const SUMMARIES = [
  ["mean", "Average"], ["sum", "Total"], ["max", "Highest"], ["min", "Lowest"], ["count", "Number of rows"],
];
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export async function render(main, { flash }) {
  const pickerBox = el("div");
  const playerSection = el("section", { class: "analyze-player" });
  const compareSection = el("section", { class: "analyze-compare" });
  mount(main, [
    subNav([["#/admin/datasets", "Upload"], ["#/admin/analyze", "Analyze"]], "#/admin/analyze"),
    pickerBox,
    playerSection,
    compareSection,
  ]);

  let player = null;
  const cleanups = new Set();
  const track = (fn) => { cleanups.add(fn); return () => { fn(); cleanups.delete(fn); }; };

  /* ------------------------- 1. The player's own view ------------------------- */
  let stopPlayer = () => {};
  const datasetBox = el("div", { class: "embedded-dataset" });
  let stopDataset = () => {};

  const showDataset = async (ds) => {
    stopDataset();
    stopDataset = () => {};
    mount(datasetBox, el("p", { class: "empty" }, "Loading\u2026"));
    const cleanup = await renderDataset(datasetBox, {
      params: { id: ds.id }, previewClient: { key: player.key, label: player.label }, flash, embedded: true,
    });
    stopDataset = track(typeof cleanup === "function" ? cleanup : () => {});
  };

  const showPlayer = (p) => {
    player = p;
    stopPlayer(); stopDataset();
    stopPlayer = () => {}; stopDataset = () => {};
    redrawComparison(); // re-highlight
    playerSection.hidden = !p; // nothing between the search and "Compare players" until a player is picked
    if (!p) { mount(playerSection, null); return; }
    const tabs = el("nav", { class: "subnav small", "aria-label": "Data files" });
    mount(playerSection, [
      el("h2", {}, `What ${p.label} sees`),
      tabs,
      datasetBox,
    ]);
    let current = null;
    stopPlayer = track(watchClientDatasets(p.key, (datasets) => {
      datasets.sort((a, b) => a.name.localeCompare(b.name));
      if (!datasets.length) {
        mount(tabs, null);
        mount(datasetBox, el("p", { class: "empty" }, `No data has been uploaded for ${p.label} yet.`));
        return;
      }
      if (!current || !datasets.some((d) => d.id === current)) current = datasets[0].id;
      const drawTabs = () => mount(tabs, datasets.map((d) => {
        const a = el("a", { href: "#", "aria-current": d.id === current ? "page" : null }, d.name);
        a.addEventListener("click", (e) => { e.preventDefault(); if (d.id === current) return; current = d.id; drawTabs(); showDataset(d); });
        return a;
      }));
      drawTabs();
      showDataset(datasets.find((d) => d.id === current));
    }));
  };

  /* ------------------------- 2. Compare players (admin only) ------------------------- */
  const fileSel = el("select", {});
  const statSel = el("select", {});
  const sumSel = el("select", {}, SUMMARIES.map(([v, l]) => el("option", { value: v }, l)));
  const status = el("p", { class: "muted", role: "status" });
  const canvasWrap = el("div", { class: "chart-wrap compare-chart" });
  const tableBox = el("div");
  let datasets = [];
  let chart = null;
  const rowsCache = new Map(); // `${datasetId}|${playerKey}` -> rows
  let loadToken = 0;
  let results = []; // [{ key, label, value, n }]

  mount(compareSection, [
    el("h2", {}, "Compare players"),
    el("p", { class: "muted" }, "Only you see this section. Players never see other players' numbers."),
    el("div", { class: "chart-panel" }, [
      el("div", { class: "controls" }, [
        el("label", {}, ["Data file", fileSel]),
        el("label", {}, ["Stat", statSel]),
        el("label", {}, ["Per player", sumSel]),
      ]),
      status,
      canvasWrap,
    ]),
    tableBox,
  ]);

  const currentFile = () => datasets.find((d) => d.id === fileSel.value);

  const fillStats = () => {
    const ds = currentFile();
    const numeric = (ds?.columns || []).map((c, i) => ({ ...c, i })).filter((c) => c.type === "number");
    mount(statSel, numeric.length
      ? numeric.map((c) => el("option", { value: String(c.i) }, c.name))
      : el("option", { value: "" }, "No number columns"));
    sumSel.value = numeric.length ? sumSel.value : "count";
  };

  async function loadRows(ds, token) {
    const keys = ds.clientKeys || [];
    let done = 0;
    const next = async () => {
      while (keys.length && token === loadToken) {
        const key = keys.shift();
        const cacheKey = `${ds.id}|${key}`;
        if (!rowsCache.has(cacheKey)) {
          try {
            const meta = await getDatasetMeta(key, ds.id);
            rowsCache.set(cacheKey, { label: meta.clientLabel, rows: await getDatasetRows(key, ds.id, meta.chunkCount) });
          } catch { rowsCache.set(cacheKey, { label: key, rows: [] }); }
        }
        done++;
        if (token === loadToken) status.textContent = `Loading players\u2026 ${done} of ${ds.clientKeys.length}`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, next));
  }

  async function compute() {
    const ds = currentFile();
    if (!ds) { status.textContent = "Upload a data file to compare players."; mount(tableBox, null); drawChart(); return; }
    const token = ++loadToken;
    await loadRows({ ...ds, clientKeys: [...(ds.clientKeys || [])] }, token);
    if (token !== loadToken) return;
    const col = statSel.value === "" ? -1 : Number(statSel.value);
    const how = sumSel.value;
    results = (ds.clientKeys || []).map((key) => {
      const { label, rows } = rowsCache.get(`${ds.id}|${key}`) || { label: key, rows: [] };
      const vals = col < 0 ? [] : rows.map((r) => r[col]).filter((v) => v !== null && v !== "" && !isNaN(Number(v))).map(Number);
      let value = null;
      if (how === "count") value = rows.length;
      else if (vals.length) {
        if (how === "sum") value = vals.reduce((a, b) => a + b, 0);
        if (how === "mean") value = vals.reduce((a, b) => a + b, 0) / vals.length;
        if (how === "max") value = Math.max(...vals);
        if (how === "min") value = Math.min(...vals);
      }
      return { key, label: label || key.replace(/^c_/, ""), value, n: rows.length };
    }).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    status.textContent = `${results.length} ${results.length === 1 ? "player" : "players"} in ${ds.name}.`;
    redrawComparison();
  }

  function statName() {
    const how = SUMMARIES.find(([v]) => v === sumSel.value)?.[1] || "";
    const stat = statSel.selectedOptions[0]?.textContent || "";
    return sumSel.value === "count" ? how : `${how} ${stat}`;
  }

  function drawChart() {
    if (chart) { chart.destroy(); chart = null; }
    const shown = results.filter((r) => r.value !== null);
    mount(canvasWrap, null);
    if (!shown.length || typeof Chart === "undefined") return;
    const canvas = el("canvas", { role: "img", "aria-label": `${statName()} by player` });
    canvasWrap.style.height = `${Math.max(240, shown.length * 28 + 60)}px`;
    canvasWrap.appendChild(canvas);
    const styles = getComputedStyle(document.body);
    Chart.defaults.color = styles.getPropertyValue("--muted").trim();
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: shown.map((r) => r.label),
        datasets: [{
          label: statName(), data: shown.map((r) => r.value), borderRadius: 3,
          backgroundColor: shown.map((r) => (r.key === player?.key ? "#ffc703" : "#44ce1b")),
        }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { grid: { color: styles.getPropertyValue("--line").trim() } }, y: { grid: { display: false } } },
      },
    });
  }

  function redrawComparison() {
    if (!results.length) { mount(tableBox, null); drawChart(); return; }
    mount(tableBox, el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, statName()), el("th", { class: "num" }, "Rows")])),
      el("tbody", {}, results.map((r, i) => el("tr", { class: r.key === player?.key ? "highlight" : null }, [
        el("td", { class: "num" }, r.value === null ? "\u2014" : String(i + 1)),
        el("td", {}, r.label),
        el("td", { class: "num" }, r.value === null ? "\u2014" : nf.format(r.value)),
        el("td", { class: "num" }, num(r.n)),
      ]))),
    ])));
    drawChart();
  }

  fileSel.addEventListener("change", () => { fillStats(); compute(); });
  statSel.addEventListener("change", compute);
  sumSel.addEventListener("change", compute);

  const stopFiles = track(watchAdminDatasets((list) => {
    const keep = fileSel.value;
    datasets = list;
    mount(fileSel, list.length ? list.map((d) => el("option", { value: d.id }, d.name)) : el("option", { value: "" }, "No data files yet"));
    if (list.some((d) => d.id === keep)) fileSel.value = keep;
    fillStats();
    compute();
  }));

  /* ------------------------- Start ------------------------- */
  loadScript(CHART_JS).then(() => drawChart()).catch(() => { status.textContent = "The chart library didn't load. Check your connection and reload."; });
  const { labels } = await adminAllClients();
  const picker = playerPicker(labels, showPlayer);
  mount(pickerBox, picker.node);
  showPlayer(null);
  picker.restore();

  return () => {
    loadToken++;
    if (chart) chart.destroy();
    stopFiles();
    [...cleanups].forEach((fn) => fn());
  };
}
