// Data → Analyze: a strokes-gained dashboard modeled on the original player site.
//   Player search · data file · rounds window
//   SG summary cards (TOTAL, T2G, OTT, APP, ARG, PUTT) colored by how the player ranks
//   One tab per category (Off-the-Tee, Approach, Around-the-Green, Putting), each with the
//   visuals that suit it, then Strokes Gained Trends and a Tour Rankings-style table.
// Files without shot-level strokes-gained columns fall back to a simple player comparison.
import { el, mount, num, subNav, loadScript } from "../ui.js";
import { adminAllClients, watchAdminDatasets, getDatasetMeta, getDatasetRows } from "../store.js";
import { playerPicker } from "../playerPicker.js";
import { render as renderDataset } from "./dataset.js";
import {
  CATEGORIES, detectColumns, isShotData, prepare, lastRounds, sgPerRound, sgBy, trend, statTable,
  missSplit, leavePoints, leaveHistogram, rank, gradeColor, sgColor, fmtSG,
} from "../sg.js";

const CHART_JS = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
const WINDOWS = [["12", "Last 12 rounds"], ["24", "Last 24 rounds"], ["0", "All rounds"]];
const SUMMARY = [["TOTAL", "SG: Total"], ["T2G", "SG: Tee to Green"], ["OTT", "SG: Off-the-Tee"], ["APP", "SG: Approach"], ["ARG", "SG: Around-the-Green"], ["PUTT", "SG: Putting"]];
// Which "SG by …" breakdowns each category shows, in order.
const BREAKDOWNS = {
  OTT: [["distanceRange", "SG by Club"], ["dogleg", "SG by Dogleg"]],
  APP: [["distanceRange", "SG by Distance"], ["lie", "SG by Lie"], ["pin", "SG by Pin Location"]],
  ARG: [["distanceRange", "SG by Distance"], ["lie", "SG by Lie"]],
  PUTT: [["distanceRange", "SG by Distance"], ["puttBreak", "SG by Break"]],
};
const LEAVE_SCALE = { APP: 60, ARG: 20 };
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export async function render(main, { flash }) {
  let player = null;                // { key, label }
  let datasets = [];
  let category = "OTT";
  let trendBy = "event";
  let windowN = 12;
  let loadToken = 0;
  let current = null;              // { ds, idx, players: [{ key, label, rounds }] }
  const rowsCache = new Map();     // `${datasetId}|${playerKey}` -> { label, rows }
  let displayLabels = new Map();   // player key -> name shown (the ID when there's no name)
  const charts = [];
  const destroyCharts = () => { while (charts.length) charts.pop().destroy(); };

  const pickerBox = el("div");
  const fileSel = el("select", { "aria-label": "Data file" });
  const windowSel = el("select", { "aria-label": "Rounds" }, WINDOWS.map(([v, l]) => el("option", { value: v, selected: v === "12" }, l)));
  const status = el("p", { class: "muted center", role: "status" });
  const body = el("div", { class: "sg-body" });
  const seesBox = el("div");

  mount(main, [
    subNav([["#/admin/datasets", "Upload"], ["#/admin/analyze", "Analyze"]], "#/admin/analyze"),
    pickerBox,
    el("div", { class: "analyze-controls" }, [el("label", {}, ["Data file", fileSel]), el("label", {}, ["Rounds", windowSel])]),
    status,
    body,
    seesBox,
  ]);

  /* ------------------------------ data loading ------------------------------ */
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
            rowsCache.set(ck, { label: meta.clientLabel, rows: await getDatasetRows(key, ds.id, meta.chunkCount) });
          } catch { rowsCache.set(ck, { label: key.replace(/^c_/, ""), rows: [] }); }
        }
        done++;
        if (token === loadToken) status.textContent = `Loading players\u2026 ${done} of ${total}`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, next));
  }

  async function refresh() {
    const ds = datasets.find((d) => d.id === fileSel.value);
    destroyCharts();
    if (!ds) { current = null; status.textContent = ""; mount(body, el("p", { class: "empty center" }, "Upload a data file to analyze.")); return; }
    const token = ++loadToken;
    mount(body, null);
    await loadAll(ds, token);
    if (token !== loadToken) return;
    const idx = detectColumns(ds.columns || []);
    if (!isShotData(idx)) {
      current = null;
      status.textContent = "";
      renderGeneric(ds);
      return;
    }
    current = {
      ds, idx,
      players: (ds.clientKeys || []).map((key) => {
        const c = rowsCache.get(`${ds.id}|${key}`) || { label: key, rows: [] };
        return { key, label: c.label || key.replace(/^c_/, ""), allRounds: prepare(c.rows, idx) };
      }).filter((p) => p.allRounds.length),
    };
    status.textContent = "";
    draw();
  }

  /* ------------------------------ the dashboard ------------------------------ */
  function draw() {
    destroyCharts();
    if (!current) return;
    const { idx } = current;
    const players = current.players.map((p) => ({ ...p, label: displayLabels.get(p.key) || p.label, rounds: lastRounds(p.allRounds, windowN) }))
      .map((p) => ({ ...p, sg: sgPerRound(p.rounds) }));
    const me = player && players.find((p) => p.key === player.key);
    const field = players.map((p) => p.rounds);

    // Summary cards: the selected player's SG per round, colored by where they rank.
    const cards = el("div", { class: "sg-cards" }, SUMMARY.map(([k, label]) => {
      if (!me) return el("div", { class: "sg-card" }, [el("h3", {}, label), el("p", { class: "sg-value muted" }, "\u2014")]);
      const ranked = rank(players.map((p) => ({ key: p.key, value: p.sg[k] })));
      const r = ranked.find((x) => x.key === me.key);
      const pct = players.length > 1 ? 1 - (r.rank - 1) / (players.length - 1) : 1;
      return el("div", { class: "sg-card" }, [
        el("h3", {}, label),
        el("p", { class: "sg-value", style: `color:${gradeColor(pct)}` }, fmtSG(me.sg[k])),
        el("p", { class: "sg-rank" }, `Rank ${r.rank} of ${players.length}`),
      ]);
    }));

    const tabs = el("nav", { class: "subnav sg-tabs", "aria-label": "Category" }, CATEGORIES.map(([k, label]) => {
      const a = el("a", { href: "#", "aria-current": k === category ? "page" : null }, label);
      a.addEventListener("click", (e) => { e.preventDefault(); category = k; draw(); });
      return a;
    }));

    const panel = el("div", { class: "sg-panel" });
    mount(body, [
      me ? el("h2", { class: "sg-player" }, [me.label, el("span", { class: "muted" }, ` \u00b7 ${me.rounds.length} rounds`)])
        : el("p", { class: "muted center" }, "Search for a player to see their strokes-gained breakdown. The rankings below cover every player."),
      cards,
      tabs,
      panel,
    ]);

    const [, catLabel] = CATEGORIES.find(([k]) => k === category);
    const blocks = [];

    if (me) {
      // Headline + Stat Averages
      const ranked = rank(players.map((p) => ({ key: p.key, value: p.sg[category] })));
      const r = ranked.find((x) => x.key === me.key);
      const stats = statTable(category, me.rounds, field, idx);
      blocks.push(el("div", { class: "sg-row" }, [
        el("div", { class: "sg-headline panel" }, [
          el("h3", {}, `SG: ${catLabel}`),
          el("p", { class: "sg-big", style: `color:${sgColor(me.sg[category])}` }, fmtSG(me.sg[category])),
          el("p", { class: "muted" }, `per round \u00b7 rank ${r.rank} of ${players.length}`),
        ]),
        el("div", { class: "panel grow" }, [
          el("h3", {}, "Stat Averages"),
          stats.length ? el("div", { class: "table-scroll" }, el("table", { class: "plain stats" }, [
            el("thead", {}, el("tr", {}, [el("th", {}, "Stat"), el("th", { class: "num" }, me.label), el("th", { class: "num" }, "All players")])),
            el("tbody", {}, stats.map((s) => {
              const fmt = (v) => (v === null ? "\u2014" : ["pct", "onePutt", "driverPct"].includes(s.kind) ? `${nf1.format(v)}%` : v.toFixed(s.dp ?? 1));
              const better = s.higher === null || s.field === null ? null : s.higher ? s.value >= s.field : s.value <= s.field;
              return el("tr", {}, [
                el("td", {}, s.label),
                el("td", { class: "num" + (better === null ? "" : better ? " good" : " bad") }, fmt(s.value)),
                el("td", { class: "num muted" }, fmt(s.field)),
              ]);
            })),
          ])) : el("p", { class: "empty" }, "This file doesn't have the columns for these stats."),
        ]),
      ]));

      // Category-specific visuals
      const visuals = [];
      if (category === "OTT") {
        const miss = missSplit(me.rounds, idx);
        if (miss) visuals.push(panelBox("Miss Tendencies", missBar(miss)));
      }
      if (category === "APP" || category === "ARG") {
        const pts = leavePoints(me.rounds, idx, category);
        if (pts) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c) => scatterChart(c, pts, LEAVE_SCALE[category]), "tall")));
        else {
          const hist = leaveHistogram(me.rounds, idx, category);
          if (hist) visuals.push(panelBox("Leave Distribution (ft)", chartBox((c) => barChart(c, hist.map((h) => h.label), hist.map((h) => h.count), { single: "#44ce1b", title: "Shots" }))));
        }
      }
      for (const [fieldName, title] of BREAKDOWNS[category]) {
        const groups = sgBy(me.rounds, idx, category, fieldName);
        if (!groups) continue;
        const fieldAvg = groups.map((g) => {
          const vals = field.map((rs) => (sgBy(rs, idx, category, fieldName) || []).find((x) => x.label === g.label)?.perRound).filter((v) => v !== undefined);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
        visuals.push(panelBox(title, chartBox((c) => barChart(c, groups.map((g) => g.label), groups.map((g) => g.perRound), {
          title: "SG / round", compare: fieldAvg, tooltip: (i) => `${groups[i].shots} shots`,
        }))));
      }
      if (visuals.length) blocks.push(el("div", { class: "sg-grid" }, visuals));

      // Strokes Gained Trends
      const t = trend(me.rounds, category, trendBy);
      const toggles = el("div", { class: "subnav small trend-toggles" }, [["event", "Event"], ["month", "Month"], ["year", "Year"]].map(([v, l]) => {
        const a = el("a", { href: "#", "aria-current": v === trendBy ? "page" : null }, l);
        a.addEventListener("click", (e) => { e.preventDefault(); trendBy = v; draw(); });
        return a;
      }));
      const avg = t.length ? t.reduce((a, g) => a + g.value, 0) / t.length : 0;
      blocks.push(panelBox("Strokes Gained Trends", [toggles, chartBox((c) => barChart(c, t.map((g) => g.label), t.map((g) => g.value), {
        title: "SG / round", average: avg, tooltip: (i) => `${t[i].rounds} ${t[i].rounds === 1 ? "round" : "rounds"}`,
      }), "wide")], "full"));
    }

    // Tour Rankings for this category (admin only: every player)
    const ranked = rank(players.map((p) => ({ key: p.key, label: p.label, value: p.sg[category], rounds: p.rounds.length })));
    const third = Math.max(1, Math.ceil(ranked.length / 3));
    blocks.push(panelBox(`Rankings \u00b7 SG: ${catLabel}`, el("div", { class: "table-scroll rank-scroll" }, el("table", { class: "plain rankings" }, [
      el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "Rank"), el("th", {}, "Player"), el("th", { class: "num" }, "SG / Round"), el("th", { class: "num" }, "Rounds")])),
      el("tbody", {}, ranked.map((r) => el("tr", { class: `tier-${r.rank <= third ? "top" : r.rank > ranked.length - third ? "bottom" : "mid"}` + (r.key === me?.key ? " me" : "") }, [
        el("td", { class: "num" }, String(r.rank)),
        el("td", {}, r.label),
        el("td", { class: "num" }, fmtSG(r.value)),
        el("td", { class: "num" }, String(r.rounds)),
      ]))),
    ])), "full"));

    mount(panel, blocks);
  }

  /* ------------------------------ building blocks ------------------------------ */
  function panelBox(title, content, size = "") {
    return el("section", { class: `panel sg-box ${size}` }, [el("h3", {}, title), ...[].concat(content)]);
  }

  // A canvas that draws itself once it's on the page.
  function chartBox(make, size = "") {
    const wrap = el("div", { class: `sg-chart ${size}` });
    const canvas = el("canvas", {});
    wrap.appendChild(canvas);
    requestAnimationFrame(() => { if (typeof Chart !== "undefined" && canvas.isConnected) charts.push(make(canvas)); });
    return wrap;
  }

  function baseOptions(extra = {}) {
    const muted = "#b8c2ba", grid = "rgba(255,255,255,0.12)";
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "rgba(0,0,0,0.9)", borderColor: "#fff", borderWidth: 1 } },
      scales: {
        x: { ticks: { color: muted }, grid: { color: grid } },
        y: { ticks: { color: muted }, grid: { color: (c) => (c.tick?.value === 0 ? "#ffffff" : grid), lineWidth: (c) => (c.tick?.value === 0 ? 2 : 1) } },
      },
      ...extra,
    };
  }

  // Bars colored green (gained) / red (lost), optional all-players markers and an average line.
  function barChart(canvas, labels, values, { title, compare, average, single, tooltip } = {}) {
    const datasets = [{
      type: "bar", label: title || "", data: values, borderRadius: 4, maxBarThickness: 60,
      backgroundColor: single || values.map((v) => (v >= 0 ? "#44ce1b" : "#e51f1f")),
    }];
    if (compare) datasets.push({ type: "line", label: "All players", data: compare, showLine: false, pointStyle: "line", pointRadius: 14, pointBorderWidth: 3, borderColor: "#ffc703" });
    if (average !== undefined) datasets.push({ type: "line", label: "Average", data: labels.map(() => average), borderColor: "#ffc703", borderDash: [6, 6], borderWidth: 2, pointRadius: 0 });
    const opts = baseOptions();
    opts.plugins.legend = { display: !!(compare || average !== undefined), labels: { color: "#fff", boxWidth: 14 } };
    if (tooltip) opts.plugins.tooltip.callbacks = { afterLabel: (c) => (c.datasetIndex === 0 ? tooltip(c.dataIndex) : "") };
    if (title) opts.scales.y.title = { display: true, text: title, color: "#b8c2ba" };
    return new Chart(canvas, { data: { labels, datasets }, options: opts });
  }

  // Where shots finished around the hole, with a dashed ellipse covering ~1 standard deviation.
  function scatterChart(canvas, pts, lim) {
    const m = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const mx = m(pts.map((p) => p.x)), my = m(pts.map((p) => p.y));
    const sx = Math.sqrt(m(pts.map((p) => (p.x - mx) ** 2))), sy = Math.sqrt(m(pts.map((p) => (p.y - my) ** 2)));
    const ellipse = {
      id: "ellipse",
      afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y } } = chart;
        ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = "#ffc703"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x.getPixelForValue(mx), y.getPixelForValue(my), Math.abs(x.getPixelForValue(mx + sx) - x.getPixelForValue(mx)),
          Math.abs(y.getPixelForValue(my + sy) - y.getPixelForValue(my)), 0, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x.getPixelForValue(0), y.getPixelForValue(0), 5, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      },
    };
    const opts = baseOptions();
    opts.scales.x = { ...opts.scales.x, min: -lim, max: lim, title: { display: true, text: "\u2190 Left   \u00b7   Right \u2192", color: "#b8c2ba" }, grid: { color: (c) => (c.tick?.value === 0 ? "#fff" : "rgba(255,255,255,0.12)") } };
    opts.scales.y = { ...opts.scales.y, min: -lim, max: lim, title: { display: true, text: "\u2190 Short   \u00b7   Long \u2192", color: "#b8c2ba" } };
    return new Chart(canvas, { type: "scatter", data: { datasets: [{ data: pts, pointRadius: 3, backgroundColor: "rgba(68,206,27,0.55)", borderColor: "rgba(68,206,27,0.9)" }] }, options: opts, plugins: [ellipse] });
  }

  // Left | Fairway | Right split bar, like the original Miss Tendencies bar.
  function missBar(parts) {
    const color = (l) => (l === "Fairway" ? "#44ce1b" : /^l/i.test(l) ? "#1f6fb2" : /^r/i.test(l) ? "#7b4bb5" : "#5c6670");
    return el("div", { class: "miss" }, [
      el("div", { class: "miss-bar" }, parts.map((p) => el("div", { style: `width:${p.pct}%;background:${color(p.label)}`, title: `${p.label}: ${p.count} shots` }, p.pct >= 8 ? `${Math.round(p.pct)}%` : ""))),
      el("div", { class: "miss-legend" }, parts.map((p) => el("span", {}, [el("i", { style: `background:${color(p.label)}` }), `${p.label} ${nf1.format(p.pct)}%`]))),
    ]);
  }

  /* ------------------------ files without strokes-gained ------------------------ */
  function renderGeneric(ds) {
    const numeric = (ds.columns || []).map((c, i) => ({ ...c, i })).filter((c) => c.type === "number");
    const statSel = el("select", {}, numeric.length ? numeric.map((c) => el("option", { value: String(c.i) }, c.name)) : el("option", { value: "" }, "No number columns"));
    const tableBox = el("div");
    const drawTable = () => {
      const col = statSel.value === "" ? -1 : Number(statSel.value);
      const rows = (ds.clientKeys || []).map((key) => {
        const { label, rows: r } = rowsCache.get(`${ds.id}|${key}`) || { label: key, rows: [] };
        const vals = col < 0 ? [] : r.map((x) => x[col]).filter((v) => v !== null && v !== "" && !isNaN(Number(v))).map(Number);
        return { key, label, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: r.length };
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
      el("p", { class: "muted center" }, "This file isn't shot-level strokes-gained data (it needs a Category column with Off-the-Tee / Approach / Around-the-Green / Putting and an SG column), so here's a simple comparison instead."),
      el("section", { class: "panel sg-box full" }, [el("h3", {}, "Compare players"), el("label", { class: "inline-select" }, ["Stat", statSel]), tableBox]),
    ]);
    drawTable();
  }

  /* ------------------------------ what the player sees ------------------------------ */
  let stopSees = () => {};
  async function drawSees() {
    stopSees(); stopSees = () => {};
    if (!player) { mount(seesBox, null); return; }
    const box = el("div", { class: "embedded-dataset" });
    const d = el("details", { class: "archive sees" }, [el("summary", {}, `What ${player.label} sees on My Data`), box]);
    mount(seesBox, d);
    d.addEventListener("toggle", async () => {
      if (!d.open || box.childNodes.length) return;
      const ds = datasets.find((x) => x.id === fileSel.value);
      if (!ds) return;
      const cleanup = await renderDataset(box, { params: { id: ds.id }, previewClient: { key: player.key, label: player.label }, flash, embedded: true });
      if (typeof cleanup === "function") stopSees = cleanup;
    });
  }

  /* ------------------------------ wiring ------------------------------ */
  fileSel.addEventListener("change", () => { refresh(); drawSees(); });
  windowSel.addEventListener("change", () => { windowN = Number(windowSel.value); draw(); });

  const stopFiles = watchAdminDatasets((list) => {
    const keep = fileSel.value;
    datasets = list;
    mount(fileSel, list.length ? list.map((d) => el("option", { value: d.id }, d.name)) : el("option", { value: "" }, "No data files yet"));
    if (list.some((d) => d.id === keep)) fileSel.value = keep;
    else {
      // Default to the newest file that has strokes-gained columns.
      const sg = list.find((d) => isShotData(detectColumns(d.columns || [])));
      if (sg) fileSel.value = sg.id;
    }
    refresh();
  });

  loadScript(CHART_JS).then(() => draw()).catch(() => { status.textContent = "The chart library didn't load. Check your connection and reload."; });
  const { labels, ids } = await adminAllClients();
  displayLabels = labels;
  const picker = playerPicker(labels, (p) => {
    player = p;
    if (current) draw(); else if (datasets.length) refresh();
    drawSees();
  }, ids);
  mount(pickerBox, picker.node);
  if (current) draw(); // names are known now
  picker.restore();

  return () => { loadToken++; destroyCharts(); stopFiles(); stopSees(); };
}
