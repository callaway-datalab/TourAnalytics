// (update 814) Home's charts, out of home.js: the bar chart (a bar a tournament or round, square at zero) and form round by
// round (the stretch before in grey, the last one green / red, each with its average). makeCharts takes Home's helpers.
export function makeCharts({ el, sg2, avgOf, inCat, tot, eventsOf, CATN, bar0 }) {
  const ns0 = "http://www.w3.org/2000/svg", mk0 = (tag, at, txt) => { const n = document.createElementNS(ns0, tag); for (const [a2, b2] of Object.entries(at)) n.setAttribute(a2, b2); if (txt != null) n.textContent = txt; return n; };
  let barWide = false; const setWide = (v) => { barWide = !!v; };
  // (update 794) form, round by round: the stretch before in grey, the last stretch green / red, each with its average as a
  // dashed line and label (as Stats' SG chart), across the lead story's full width
  function formRounds(x, cat) { let pr = x.prevR || [], la = x.lastR || []; if (pr.length + la.length < 6 && !/event/.test(x.FL || "")) return null;
    const f0 = x.d ? (r) => r.shots.reduce((t0, s0) => t0 + (s0.cat === x.c && s0.dist === x.d ? s0.sg : 0), 0) : cat ? (r) => inCat(r, cat) : tot;
    // (update 805) the DP World Tour (its numbers by event): a bar an event, 3 against 3
    const evM = /event/.test(x.FL || ""); if (evM) { const byE = (rs0) => eventsOf(rs0).map((e) => ({ event: e.event, date: e.end, shots: [], _rs: e.rs })); pr = byE(pr); la = byE(la); }
    const f = evM ? (e) => avgOf(e._rs, f0) : f0, all = [...pr.map((r) => [r, 0]), ...la.map((r) => [r, 1])], vs = all.map(([r]) => f(r));
    const W = 760, H = 210, L = 46, R2 = 10, top = 14, bot = 26, lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y = (v) => top + (hi - v) * sc, bw = (W - L - R2) / all.length;
    const svg = mk0("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "td-bars td-formr", role: "img", "aria-label": "Round by round, before and lately" });
    for (const t0 of [hi, 0, lo]) { svg.append(mk0("line", { x1: L, x2: W - R2, y1: y(t0).toFixed(1), y2: y(t0).toFixed(1), class: t0 === 0 ? "td-zero" : "td-grid" })); svg.append(mk0("text", { x: L - 6, y: (y(t0) + 3).toFixed(1), "text-anchor": "end", class: "td-tx" }, sg2(t0))); }
    all.forEach(([r, g], i) => { const v = f(r), h = Math.max(1.2, Math.abs(v) * sc), x0 = L + i * bw + bw * 0.14; const b = bar0(mk0, { x: x0.toFixed(1), y: (v >= 0 ? y(0) - h : y(0)).toFixed(1), width: (bw * 0.72).toFixed(1), height: h.toFixed(1), rx: 2, class: `td-bar ${g ? (v >= 0 ? "up hot" : "down hot") : "gray"}` }, v >= 0); b.append(mk0("title", {}, `${r.event}${r.roundNo ? ` R${r.roundNo}` : ""}: ${sg2(v)}`)); svg.append(b); });
    const avgLine = (from, to, v, lbl) => { const x1 = L + from * bw, x2 = L + to * bw; svg.append(mk0("line", { x1: x1.toFixed(1), x2: x2.toFixed(1), y1: y(v).toFixed(1), y2: y(v).toFixed(1), class: "td-avgl" })); svg.append(mk0("text", { x: (x2 - 4).toFixed(1), y: (y(v) - 5).toFixed(1), "text-anchor": "end", class: "td-avgt" }, `${lbl} ${sg2(v)}`)); };
    if (pr.length) avgLine(0, pr.length, avgOf(pr, f), `${x.n} before`); if (la.length) avgLine(pr.length, all.length, avgOf(la, f), `Last ${x.n}`);
    const d0 = (r) => String(r.date || "").slice(5, 10).replace("-", "/");
    return el("div", { class: "td-chart" }, [el("div", { class: "td-kick mute" }, `${evM ? "Event by event" : "Round by round"} · ${x.d ? `${CATN[x.c]} from ${x.d}` : cat ? CATN[cat] : "SG: Total"}${evM ? " (a round)" : ""}`), svg, el("div", { class: "td-strip-ax" }, [el("span", {}, d0(all[0][0])), el("span", {}, d0(all.at(-1)[0]))])]); }
  function barSvg(items, { note } = {}) { if (items.length < 3) return null;
    const W = barWide ? 760 : 320, H = 176, top = 8, bot = 70, /* (update 791: wide, in the lead story's full width) */ /* (update 738: room for a label under every bar) */ vs = items.map((x) => x.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y0 = top + hi * sc, LP = 46, bw = (W - LP) / items.length; /* (update 738: room on the left for the first labels) */
    const svg = mk0("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "td-bars", role: "img", "aria-label": note || "Bar chart" });
    items.forEach((x, i) => { const h = Math.max(1.5, Math.abs(x.v) * sc), yy = x.v >= 0 ? y0 - h : y0;
      const r = bar0(mk0, { x: (LP + i * bw + bw * 0.14).toFixed(1), y: yy.toFixed(1), width: (bw * 0.72).toFixed(1), height: h.toFixed(1), rx: 2, class: `td-bar ${x.cls || (x.v >= 0 ? "up" : "down")}${x.hot ? " hot" : ""}` }, x.v >= 0);
      r.append(mk0("title", {}, `${x.label}: ${sg2(x.v)}`)); svg.append(r); });
    svg.append(mk0("line", { x1: LP, x2: W, y1: y0.toFixed(1), y2: y0.toFixed(1), class: "td-zero" }));
    // (update 738) each bar's tournament under it, angled (the latest in full color)
    const base = H - bot + 10;
    items.forEach((x, i) => { const cx = LP + i * bw + bw / 2; svg.append(mk0("text", { x: cx.toFixed(1), y: base, transform: `rotate(-45 ${cx.toFixed(1)} ${base})`, "text-anchor": "end", class: `td-tx${x.hot ? " hot" : ""}` }, x.short)); });
    return svg; }
  return { mk0, barSvg, formRounds, setWide };
}
