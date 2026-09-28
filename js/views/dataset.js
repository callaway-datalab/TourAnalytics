import { el, mount, formatWhen, num, loadScript } from "../ui.js";
import { getState } from "../auth.js";
import { getDatasetMeta, getDatasetRows } from "../store.js";
import { toCsv, slugify } from "../data.js";

const PALETTE = ["#44ce1b", "#ffc703", "#4fc3f7", "#ff6b4d", "#ffffff", "#c38bff", "#ff9f40", "#9be7c4"];
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });

export async function render(main, { params, previewClient, flash }) {
  const state = getState();
  const clientKey = previewClient ? previewClient.key : state.profile.clientKey;
  let meta;
  try {
    meta = await getDatasetMeta(clientKey, params.id);
  } catch (err) {
    mount(main, el("p", { class: "empty" }, err.message || "That dataset isn't available."));
    return () => {};
  }

  mount(main, [
    el("header", { class: "page-head" }, [
      el("p", { class: "crumb" }, el("a", { href: "#/dashboard" }, previewClient?.role ? `${previewClient.label}: data` : "My data")),
      el("h1", {}, meta.name),
      el("p", { class: "muted" }, `${num(meta.rowCount)} rows \u00b7 Updated ${formatWhen(meta.uploadedAt)}` + (meta.description ? ` \u00b7 ${meta.description}` : "")),
    ]),
    el("p", { id: "status", class: "empty", role: "status" }, "Loading your data\u2026"),
  ]);

  let rows;
  try {
    rows = await getDatasetRows(clientKey, params.id, meta.chunkCount);
  } catch {
    main.querySelector("#status").textContent = "We couldn't load this data. Reload the page to try again.";
    return () => {};
  }
  main.querySelector("#status").remove();

  const cols = meta.columns.map((c) => ({ ...c }));
  cols.forEach((c, i) => {
    if (c.type !== "number") return;
    let dec = 0;
    for (const r of rows.slice(0, 500)) {
      const m = String(r[i] ?? "").match(/\.(\d+)/);
      if (m) dec = Math.max(dec, Math.min(4, m[1].length));
    }
    c.nf = new Intl.NumberFormat(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  });
  const fmt = (v, i) => (v === null || v === undefined || v === "" ? "" : cols[i].type === "number" ? (cols[i].nf || nf).format(v) : String(v));
  const label = (v, i) => (v === null || v === undefined || v === "" ? "(blank)" : fmt(v, i));

  const truncated = rows.length > 100000;
  const view = { rows: truncated ? rows.slice(0, 100000) : rows, sortCol: -1, sortDir: 1, page: 0, size: 25, filtered: null };

  const xSel = el("select", {});
  const aggSel = el("select", {}, [
    el("option", { value: "none" }, "Show each row"), el("option", { value: "sum" }, "Add up"),
    el("option", { value: "mean" }, "Average"), el("option", { value: "count" }, "Count rows"),
  ]);
  const typeSel = el("select", {}, [el("option", { value: "line" }, "Line"), el("option", { value: "bar" }, "Bar"), el("option", { value: "pie" }, "Pie")]);
  const yFieldset = el("fieldset", {}, el("legend", {}, "Values to plot"));
  const chartMsg = el("p", { class: "muted", hidden: true });
  const canvas = el("canvas", { role: "img", "aria-label": "Chart of your data" });
  let chart = null;

  const search = el("input", { type: "search", placeholder: "Type to filter rows" });
  const countLabel = el("span", { class: "muted", id: "count" });
  const table = el("table", { id: "tbl" });
  const pageInfo = el("span", { class: "muted" });
  const prevBtn = el("button", { class: "btn ghost", type: "button" }, "Previous");
  const nextBtn = el("button", { class: "btn ghost", type: "button" }, "Next");

  main.append(
    el("div", {}, [
      truncated ? el("p", { class: "flash info" }, "This table is very large, so only the first 100,000 rows are shown here. Use Download for the full set.") : null,
      el("section", { class: "chart-panel", "aria-label": "Chart" }, [
        el("div", { class: "controls" }, [
          el("label", {}, ["Chart", typeSel]),
          el("label", {}, ["Horizontal axis", xSel]),
          el("label", {}, ["Combine rows", aggSel]),
          yFieldset,
        ]),
        el("div", { class: "chart-wrap" }, canvas),
        chartMsg,
      ]),
      el("section", { "aria-label": "Table" }, [
        el("div", { class: "table-tools" }, [
          el("label", { class: "search" }, ["Search this table", search]),
          countLabel,
          el("a", { class: "btn ghost", href: "#", onClick: (e) => { e.preventDefault(); downloadCsv(); } }, "Download CSV"),
        ]),
        el("div", { class: "table-scroll" }, table),
        el("div", { class: "pager" }, [prevBtn, pageInfo, nextBtn]),
      ]),
    ]),
  );

  function downloadCsv() {
    const csv = toCsv(cols, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${slugify(meta.name)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------------- Table ---------------- */
  function setupTable() {
    const thead = el("thead", {}, el("tr", {}, cols.map((c, i) => {
      const th = el("th", { scope: "col", class: c.type === "number" ? "num" : null });
      const b = el("button", { type: "button", onClick: () => sortBy(i) }, c.name);
      th.appendChild(b);
      return th;
    })));
    mount(table, [thead, el("tbody")]);
    search.addEventListener("input", () => { applySearch(); });
    prevBtn.addEventListener("click", () => { view.page--; renderRows(); });
    nextBtn.addEventListener("click", () => { view.page++; renderRows(); });
    renderRows();
  }

  function currentRows() { return view.filtered ?? view.rows; }

  function applySearch() {
    const q = search.value.trim().toLowerCase();
    view.filtered = q ? view.rows.filter((r) => r.some((v) => v !== null && String(v).toLowerCase().includes(q))) : null;
    if (view.sortCol >= 0) sortInPlace(currentRows());
    view.page = 0;
    renderRows();
  }

  function sortBy(i) {
    view.sortDir = view.sortCol === i ? -view.sortDir : 1;
    view.sortCol = i;
    if (view.filtered === null) view.filtered = view.rows.slice();
    sortInPlace(currentRows());
    table.querySelectorAll("th").forEach((th, j) => th.setAttribute("aria-sort", j === i ? (view.sortDir === 1 ? "ascending" : "descending") : "none"));
    view.page = 0;
    renderRows();
  }

  function sortInPlace(arr) {
    const i = view.sortCol, dir = view.sortDir, isNum = cols[i].type === "number";
    arr.sort((a, b) => {
      const x = a[i], y = b[i];
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      return dir * (isNum ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }));
    });
  }

  function renderRows() {
    const data = currentRows();
    const total = data.length;
    const pages = Math.max(1, Math.ceil(total / view.size));
    view.page = Math.min(Math.max(0, view.page), pages - 1);
    const start = view.page * view.size;
    const slice = data.slice(start, start + view.size);
    const tbody = table.querySelector("tbody");
    mount(tbody, slice.length
      ? slice.map((r) => el("tr", {}, r.map((v, i) => el("td", { class: cols[i].type === "number" ? "num" : null }, fmt(v, i)))))
      : el("tr", {}, el("td", { colSpan: cols.length, class: "muted" }, "No rows match your search.")));
    countLabel.textContent = `${total.toLocaleString()} ${total === 1 ? "row" : "rows"}`;
    pageInfo.textContent = `Page ${view.page + 1} of ${pages}`;
    prevBtn.disabled = view.page === 0;
    nextBtn.disabled = view.page >= pages - 1;
  }

  /* ---------------- Chart ---------------- */
  function setupChartControls() {
    cols.forEach((c, i) => xSel.add(new Option(c.name, i)));
    const firstOf = (t) => cols.findIndex((c) => c.type === t);
    const xi = firstOf("date") >= 0 ? firstOf("date") : firstOf("text") >= 0 ? firstOf("text") : 0;
    xSel.value = xi;

    let checked = false;
    const numCols = cols.filter((c) => c.type === "number");
    if (!numCols.length) {
      yFieldset.appendChild(el("span", { class: "muted" }, "This table has no number columns, so you can chart row counts."));
      aggSel.value = "count";
    } else {
      const box = el("div", { class: "y-options" });
      cols.forEach((c, i) => {
        if (c.type !== "number") return;
        const cb = el("input", { type: "checkbox", value: String(i), onChange: drawChart });
        if (!checked && i !== xi) { cb.checked = true; checked = true; }
        box.appendChild(el("label", {}, [cb, c.name]));
      });
      yFieldset.appendChild(box);
    }
    xSel.addEventListener("change", () => { setDefaultAgg(); drawChart(); });
    typeSel.addEventListener("change", drawChart);
    aggSel.addEventListener("change", drawChart);
    if (aggSel.value !== "count") setDefaultAgg();
  }

  function setDefaultAgg() {
    const xi = +xSel.value;
    const unique = new Set(rows.map((r) => r[xi])).size === rows.length;
    aggSel.value = unique ? "none" : "sum";
  }

  const toNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

  function buildSeries() {
    const xi = +xSel.value, xType = cols[xi].type, agg = aggSel.value;
    const ys = [...yFieldset.querySelectorAll("input:checked")].map((i) => +i.value);
    if (agg !== "count" && !ys.length) return null;
    const ordered = xType === "date" || xType === "number";
    const cmp = (a, b) => (xType === "number" ? a - b : String(a).localeCompare(String(b)));
    let labels, series;

    if (agg === "none") {
      const idx = rows.map((_, i) => i);
      if (ordered) idx.sort((a, b) => cmp(rows[a][xi] ?? "", rows[b][xi] ?? ""));
      labels = idx.map((i) => label(rows[i][xi], xi));
      series = ys.map((yi) => ({ name: cols[yi].name, data: idx.map((i) => toNum(rows[i][yi])) }));
    } else {
      const groups = new Map();
      for (const r of rows) {
        const k = r[xi];
        if (!groups.has(k)) groups.set(k, { n: 0, sum: ys.map(() => 0), cnt: ys.map(() => 0) });
        const g = groups.get(k);
        g.n++;
        ys.forEach((yi, j) => { const v = toNum(r[yi]); if (v !== null && !isNaN(v)) { g.sum[j] += v; g.cnt[j]++; } });
      }
      let keys = [...groups.keys()];
      if (ordered) keys = keys.filter((k) => k !== null).sort(cmp).concat(keys.filter((k) => k === null));
      labels = keys.map((k) => label(k, xi));
      if (agg === "count") series = [{ name: "Rows", data: keys.map((k) => groups.get(k).n) }];
      else series = ys.map((yi, j) => ({ name: cols[yi].name, data: keys.map((k) => { const g = groups.get(k); return agg === "sum" ? g.sum[j] : g.cnt[j] ? g.sum[j] / g.cnt[j] : null; }) }));
    }
    return { labels, series };
  }

  function drawChart() {
    if (chart) { chart.destroy(); chart = null; }
    chartMsg.hidden = true;
    if (typeof Chart === "undefined") { chartMsg.textContent = "The chart library didn't load. Check your connection and reload."; chartMsg.hidden = false; return; }
    const built = buildSeries();
    if (!built) { chartMsg.textContent = "Choose at least one value to plot."; chartMsg.hidden = false; return; }

    const type = typeSel.value;
    const { labels, series } = built;
    const styles = getComputedStyle(document.body);
    const ink = styles.getPropertyValue("--muted").trim() || "#5b6b72";
    const grid = styles.getPropertyValue("--line").trim() || "#d6dedc";
    Chart.defaults.color = ink;
    Chart.defaults.font.family = styles.fontFamily;
    const many = labels.length > 200;

    let config;
    if (type === "pie") {
      const s = series[0];
      let pairs = labels.map((l, i) => [l, Math.max(0, s.data[i] || 0)]).sort((a, b) => b[1] - a[1]);
      if (pairs.length > 12) pairs = pairs.slice(0, 11).concat([["Other", pairs.slice(11).reduce((t, p) => t + p[1], 0)]]);
      config = { type: "doughnut", data: { labels: pairs.map((p) => p[0]), datasets: [{ label: s.name, data: pairs.map((p) => p[1]), backgroundColor: pairs.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" } } } };
    } else {
      config = { type, data: { labels, datasets: series.map((s, i) => {
        const color = PALETTE[i % PALETTE.length];
        return type === "line"
          ? { label: s.name, data: s.data, borderColor: color, backgroundColor: color + "22", tension: 0.25, pointRadius: many ? 0 : 3, borderWidth: 2, spanGaps: true }
          : { label: s.name, data: s.data, backgroundColor: color, borderRadius: 3 };
      }) },
        options: { responsive: true, maintainAspectRatio: false, animation: labels.length > 500 ? false : undefined,
          interaction: { mode: "index", intersect: false }, plugins: { legend: { display: series.length > 1 } },
          scales: { x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 0 } },
            y: { beginAtZero: type === "bar", grid: { color: grid }, ticks: { callback: (v) => compact.format(v) } } } } };
    }
    chart = new Chart(canvas, config);
  }

  setupTable();
  try {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js");
    setupChartControls();
    drawChart();
  } catch {
    chartMsg.textContent = "The chart library didn't load. Check your connection and reload.";
    chartMsg.hidden = false;
  }

  return () => { if (chart) chart.destroy(); };
}
