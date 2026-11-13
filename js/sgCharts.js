// (sgDashboard split) The charts: chart boxes, bar and scatter charts, and their options.
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { el, nf1 } from "./sgShared.js";

export function rankPicker(S) {
  const sel = el("select", { class: "rank-pick", "aria-label": "Compare with",
    title: "Which players the gold dots show. On SG Trends: the best result (or the average of the best results) each round, event, month or year, among the players who played it. On the other charts: the best players over the selected time frame." },
    S.RANK_TOPS.map(([v, l]) => el("option", { value: v, selected: (S.st.rankTop || "all") === v }, l)));
  sel.addEventListener("change", () => { S.st.rankTop = sel.value; S.st.rankTopManual = true; S.st.rankTopFor = S.me?.key; S.draw(); });
  return sel;
}
export function chartBox(S, make, size = "", key = null, { rankPick = false } = {}) {
  const seq = S.chartSeq++; // its place on the page (charts can share a title)
  const wrap = el("div", { class: `sg-chart ${size}` });
  let canvas = el("canvas", {});
  wrap.appendChild(canvas);
  let chart = null;
  const build = () => {
    if (typeof Chart === "undefined" || !wrap.isConnected) return;
    if (chart) { const i = S.charts.indexOf(chart); if (i >= 0) S.charts.splice(i, 1); chart.destroy(); }
    const fresh = el("canvas", {});
    canvas.replaceWith(fresh); canvas = fresh;
    // (update 308) Hide Comps: this card's dots and legend off (remembered per chart while the page is open)
    S.hideCompsNow = !!(key && !S.st.showComps?.[key]); S.cmpSeen = false; // (update 311: hidden until Show Comps)
    chart = make(canvas, (key && S.st.chartTypes[key]) || "bar");
    S.hideCompsNow = false;
    S.charts.push(chart);
    if (key && S.cmpSeen) S.compsToggle(wrap, key);
    // Only a chart whose bars changed grows in again; the rest appear as they were. When just the gold
    // dots changed (Top 1 / 10 / 25 / 50 / All), the bars stay put and the dots glide to their new places.
    try {
      const d = chart.data || {}, sets = d.datasets || [];
      const id = `${seq}|${key || ""}|${sets[0]?.label || ""}|${size}|${(d.labels || []).length}`;
      const dots = sets.find((x) => x.$dots) || null;
      const bars = JSON.stringify([d.labels, sets.filter((x) => !x.$dots).map((x) => [x.type, x.data])]) + ((key && S.st.chartTypes[key]) || "");
      const prev = S.lastSig.get(id);
      if (prev && prev.bars === bars && typeof chart.stop === "function") {
        chart.stop();
        const dotsMoved = !!dots && JSON.stringify(prev.dots) !== JSON.stringify(dots.data);
        if (dotsMoved) {
          const next = dots.data;
          dots.data = prev.dots && prev.dots.length === next.length ? prev.dots.slice() : next.map(() => null);
          chart.update("none");                           // as it was a moment ago
          chart.$dotsOnly = true; dots.data = next;
          chart.config.options.animation = { ...(chart.config.options.animation || {}), duration: 450, easing: "easeOutCubic" };
          chart.update(); // the bars hold still; only the dots move
        } else chart.update("none");
      }
      S.lastSig.set(id, { bars, dots: dots ? dots.data.slice() : null });
    } catch { /* fine */ }
  };
  requestAnimationFrame(build);
  // (update 142: no bar / line switch; each chart keeps its own style)
  void rankPick; // (update 228: no dropdown on the charts; the Top pills sit on the stats table / category chart)
  return key ? el("div", { class: "chart-holder" }, [wrap]) : wrap;
}
export function compsToggle(S, wrap, key) {
  const card = wrap.closest(".sg-box");
  if (!card) return;
  const keys = new Set((card.dataset.ckeys || "").split("|").filter(Boolean)); keys.add(key);
  card.dataset.ckeys = [...keys].join("|");
  const hidden = () => ![...keys].some((k) => S.st.showComps?.[k]);
  let b = card.querySelector(":scope > .comp-toggle");
  if (!b) {
    b = el("button", { type: "button", class: "comp-toggle" });
    b.addEventListener("click", () => {
      const ks = (card.dataset.ckeys || "").split("|").filter(Boolean), show = !ks.some((k) => S.st.showComps?.[k]);
      S.st.showComps = { ...(S.st.showComps || {}) }; ks.forEach((k) => { S.st.showComps[k] = show; });
      S.draw();
    });
    card.classList.add("has-comp-toggle");
    card.appendChild(b);
  }
  b.textContent = hidden() ? "Show Comps" : "Hide Comps";
  b.setAttribute("aria-pressed", String(hidden()));
}
export function baseOptions(S) {
  const muted = "#8e8e93", grid = "rgba(255,255,255,0.06)";
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: "rgba(28,28,30,0.96)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, padding: 10, cornerRadius: 10, titleFont: { family: "Inter, system-ui, sans-serif", weight: "600" }, bodyFont: { family: "Inter, system-ui, sans-serif" } } },
    scales: {
      x: { ticks: { color: muted }, grid: { display: false }, border: { display: false } },
      y: { ticks: { color: muted }, border: { display: false }, grid: { color: (c) => (c.tick?.value === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.05)"), lineWidth: (c) => (c.tick?.value === 0 ? 1.5 : 1) } },
    },
    animation: { duration: 650, easing: "easeOutQuart" },
    animations: { y: { from: (c) => (c.chart?.$dotsOnly || !c.chart?.scales?.y ? undefined : c.chart.scales.y.getPixelForValue(0)) } },
  };
}
// the colour stops for one side: [fraction of the span, colour]
export function rampStops(S, near, far, minAbs, maxAbs) {
  const r = maxAbs > 0 ? minAbs / maxAbs : 0;
  if (r <= 0.35 || r >= 0.999) return [[0, near], [1, far]];
  return [[0, near], [r, S.mix(near, far, 0.22)], [1, far]]; // bars bunched far from zero: spread their tips
}
export function barFill(S, c, single) {
  const { chart, dataIndex } = c, area = chart.chartArea, y = chart.scales?.y;
  const v = c.dataset.data[dataIndex];
  const [near, far] = S.rampOf(single, v);
  if (!area || !y || v == null) return far;
  const side = c.dataset.data.map(Number).filter((x) => Number.isFinite(x) && (v >= 0 ? x >= 0 : x < 0)).map(Math.abs);
  const maxAbs = Math.max(...side, 1e-9), minAbs = Math.min(...side);
  const z = y.getPixelForValue(0), end = y.getPixelForValue(v >= 0 ? maxAbs : -maxAbs);
  if (!Number.isFinite(z) || !Number.isFinite(end) || Math.abs(z - end) < 1) return far;
  const g = chart.ctx.createLinearGradient(0, z, 0, end); // the same span for every bar on this side
  // strokes gained: straight from zero; one-colour stats (often far from zero): spread between their min and max
  for (const [t, col] of single ? S.rampStops(near, far, minAbs, maxAbs) : [[0, near], [1, far]]) g.addColorStop(t, col);
  return g;
}
export function barChart(S, canvas, labels, values0, { title: title0, compare: compareIn, compareLabel = "All players", average: averageIn, single, tooltip, shortLabels = null, as = "bar", colors = null, allTicks = false, onBarClick = null } = {}) { // (update 711) allTicks: a label under every bar
  if ((Array.isArray(compareIn) && compareIn.some((x) => x != null)) || averageIn !== undefined) S.cmpSeen = true;
  const compare0 = S.hideCompsNow ? null : compareIn, average = S.hideCompsNow ? undefined : averageIn; // (update 308: Hide Comps)
  // (update 228) Relative to Avg: each bar less the compared players' value at it (the dots become the zero line)
  const relNow = S.relOn() && Array.isArray(compare0) && compare0.some((x) => x != null);
  const values = relNow ? values0.map((v, i) => (v != null && compare0[i] != null ? v - compare0[i] : null)) : values0;
  const compare = relNow ? null : compare0;
  const title = relNow ? `${title0 || ""} vs ${compareLabel.replace(/ \(avg\)$/, "")}`.trim() : title0;
  const signColors = values.map((v) => (v >= 0 ? "#30d158" : "#ff453a"));
  const lineCol = single ? S.LINE_COLOR[single] || S.LINE_COLOR.blue : null;
  const lineFill = single === "up" ? "rgba(48,209,88,0.12)" : "rgba(47,155,255,0.13)";
  const datasets = [as === "line"
    // Line: a champagne line through green / red points, shaded green above zero and red below
    // (one-colour charts, like stats other than strokes gained: a blue line, shaded blue).
    ? { type: "line", label: title || "", data: values, order: 2, borderColor: lineCol || "#c8a97e", borderWidth: 2.5, tension: 0.35,
        pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: lineCol || signColors, pointBorderColor: lineCol || signColors,
        fill: single ? { target: "origin", above: lineFill } : { target: "origin", above: "rgba(48,209,88,0.10)", below: "rgba(255,69,58,0.10)" } }
    // Bars: dark at the zero line, brightening (brighter green up, brighter red down) the further they reach;
    // square where they meet zero, rounded at the tip; a glint on hover; growing from zero when drawn.
    : { type: "bar", label: title || "", data: values, order: 2, maxBarThickness: 46, categoryPercentage: 0.72, barPercentage: 0.9,
        borderRadius: 8, borderSkipped: "start",
        backgroundColor: colors ? colors : (c) => S.barFill(c, single), hoverBackgroundColor: colors ? colors : (c) => S.barFill(c, single), // (update 299: a colour per bar, by product)
        borderWidth: 0 }];
  // Reference marks: "All players" as blue dashes at each bar, "Average" as a yellow dashed line.
  // the other players: gold dots in front of the bars
  // (gold dots, no line)
  // the other players: champagne dots in front of the bars (no line)
  if (compare) datasets.push({ type: "line", label: compareLabel, data: compare, $dots: true, showLine: false, borderColor: "#d4b483", backgroundColor: "#d4b483",
    pointStyle: "circle", pointRadius: 4, pointHoverRadius: 5.5, pointBackgroundColor: "#d4b483", pointBorderColor: "#0a0a0b", pointBorderWidth: 1, order: 0 });
  if (average !== undefined) datasets.push({ type: "line", label: "Average", data: labels.map(() => average), borderColor: "#ffd60a", borderDash: [6, 6], borderWidth: 2, pointRadius: 0, order: 0 }); // yellow dashes, in front
  const o = S.baseOptions();
  // Legend: only the reference marks (no "SG / round" entry); the other players shown as a gold dot.
  o.plugins.legend = { display: !!(compare || average !== undefined), labels: {
    color: "#a1a1a6", boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle", font: { family: "Inter, system-ui, sans-serif", size: 12 },
    filter: (item) => item.datasetIndex !== 0,
  } };
  if (tooltip) o.plugins.tooltip.callbacks = { afterLabel: (c) => (c.datasetIndex === 0 ? tooltip(c.dataIndex) : "") };
  // Long labels (tournament names) are shortened under the bars, and on small screens an event shows just
  // its date; tapping a bar shows the full name.
  const narrow = (canvas.parentElement?.clientWidth || 800) < 640;
  // (update 227) the full name under each bar, wrapped onto as many lines as it needs (never cut short)
  // (update 381) only when each bar has room for it (about 6.5px a letter at this size); else the short label
  // (a date), tilted and thinned out so no two labels overlap
  const fsz = narrow ? 9 : 11, perBar = Math.max(1, (canvas.parentElement?.clientWidth || 800) - 50) / Math.max(1, labels.length);
  const few = perBar >= (narrow ? 58 : 70);
  const wrapAt = Math.max(6, Math.floor(perBar / (fsz * 0.62)));
  const wrapL = (l) => { const out = []; let cur = ""; for (const w of String(l).split(/\s+/)) { if (cur && (cur + " " + w).length > wrapAt) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; } if (cur) out.push(cur); return out.length > 1 ? out : out[0] || ""; };
  const shortOf = (i) => {
    const l = String(labels[i] ?? "");
    if (!few && shortLabels?.[i]) return shortLabels[i];
    return few ? wrapL(l) : l.length > 16 ? `${l.slice(0, 15)}\u2026` : l;
  };
  o.scales.x = { ...(o.scales.x || {}), ticks: { ...((o.scales.x || {}).ticks || {}), callback: (v, i) => shortOf(i), autoSkip: !few && !allTicks, autoSkipPadding: 8, maxRotation: few ? 0 : allTicks ? 90 : 50, minRotation: 0, font: { size: allTicks && !few && perBar < 14 ? Math.max(7, fsz - 2) : fsz } } };
  o.plugins.tooltip.callbacks = { ...(o.plugins.tooltip.callbacks || {}), title: (items) => String(labels[items[0].dataIndex] ?? "") };
  if (title) o.scales.y.title = { display: true, text: title, color: "#8e8e93" };
  // (update 713) a bar that can be tapped (SG Trends by Product's Edit)
  if (onBarClick) { o.onClick = (e, els) => { if (els?.length) onBarClick(els[0].index); }; o.onHover = (e, els) => { const t = e?.native?.target; if (t) t.style.cursor = els?.length ? "pointer" : "default"; }; }
  return new Chart(canvas, { data: { labels, datasets }, options: o });
}
export function scatterChart(S, canvas, pts, lim) {
  const m = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const mx = m(pts.map((p) => p.x)), my = m(pts.map((p) => p.y));
  const sx = Math.sqrt(m(pts.map((p) => (p.x - mx) ** 2))), sy = Math.sqrt(m(pts.map((p) => (p.y - my) ** 2)));
  const ellipse = {
    id: "ellipse",
    afterDatasetsDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = "#c8a97e"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.ellipse(x.getPixelForValue(mx), y.getPixelForValue(my), Math.abs(x.getPixelForValue(mx + sx) - x.getPixelForValue(mx)), Math.abs(y.getPixelForValue(my + sy) - y.getPixelForValue(my)), 0, 0, 2 * Math.PI);
      ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x.getPixelForValue(0), y.getPixelForValue(0), 5, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
    },
  };
  const o = S.baseOptions();
  o.scales.x = { ...o.scales.x, min: -lim, max: lim, title: { display: true, text: "\u2190 Left   \u00b7   Right \u2192", color: "#8e8e93" }, grid: { color: (c) => (c.tick?.value === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.06)") } };
  o.scales.y = { ...o.scales.y, min: -lim, max: lim, title: { display: true, text: "\u2190 Short   \u00b7   Long \u2192", color: "#8e8e93" } };
  return new Chart(canvas, { type: "scatter", data: { datasets: [{ data: pts, pointRadius: 3, backgroundColor: "rgba(200,169,126,0.55)", borderColor: "rgba(200,169,126,0.95)" }] }, options: o, plugins: [ellipse] });
}
export function missBar(S, parts) {
  const color = (l) => (l === "Fairway" ? "#30d158" : /^l/i.test(l) ? "#0a84ff" : /^r/i.test(l) ? "#bf5af2" : "#48484a");
  return el("div", { class: "miss" }, [
    el("div", { class: "miss-bar" }, parts.map((p) => el("div", { style: `width:${p.pct}%;background:${color(p.label)}`, title: `${p.label}: ${p.count} shots` }, p.pct >= 8 ? `${Math.round(p.pct)}%` : ""))),
    el("div", { class: "miss-legend" }, parts.map((p) => el("span", {}, [el("i", { style: `background:${color(p.label)}` }), `${p.label} ${nf1.format(p.pct)}%`]))),
  ]);
}
