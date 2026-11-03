// (sgDashboard split) The hero card: the player's headline numbers, the weekly rank chart and its popups (Form, tournaments, rank).
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { CATEGORIES, applyFilters, el, fmtSG, fmtStat, getState, infoTip, mount, shortDate } from "./sgShared.js";

export function heroBox(S, mine, slicedField, f) {
  const foot = el("p", { class: "hero-foot" }, S.updatedTxt());
  const sg = S.isSG();
  if (S.me && mine && mine.length) {
    // the player: their number, rank, form, a rolling-average chart, and a tile for each category to explore
    const total = S.metric(mine), r = S.rankAmong(slicedField, S.me.key);
    const ordered = [...mine].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const per = ordered.map((rd) => S.metric([rd]));
    // (update 168) the rank after each round: where they stood in the field on that date, this selection
    const hist = S.showRanks ? S.rankHistory(ordered, slicedField, r) : S.rollingOnly(ordered); // (update 183: no ranks: the rolling average alone)
    const n = Math.min(12, Math.floor(per.length / 2));
    let form = null;
    if (n >= 2) {
      const last = S.metric(ordered.slice(-n)), prev = S.metric(ordered.slice(-2 * n, -n));
      if (last != null && prev != null) {
        const ch = last - prev, steady = Math.abs(ch) < S.steadyBand(prev);
        const amt = sg ? Math.abs(ch).toFixed(2) : fmtStat({ ...S.def, unit: S.def.pct ? "" : S.def.unit }, Math.abs(ch)).replace("%", S.def.pct ? " pct" : "");
        form = steady ? ["Steady", ""] : sg ? (ch > 0 ? [`Better by ${amt}`, "up"] : [`Worse by ${amt}`, "down"]) // (update 182: Better / Worse, not Up / Down)
          : S.def.higher == null ? [`${ch > 0 ? "Higher" : "Lower"} by ${amt}`, ""] : (S.def.higher ? ch > 0 : ch < 0) ? [`Better by ${amt}`, "up"] : [`Worse by ${amt}`, "down"];
      }
    }
    // a tile per category this stat has (with its rank among the same players, every category counted)
    const allCats = S.nz(applyFilters(S.me.rounds, { ...f, cats: [] }));
    const fieldAllCats = S.catsAvail.length > 1 ? S.sliceOnce("allcats", { ...S.lastRankF, cats: [] }) : []; // (update 328: kept while the filters don't change)
    // A lie / distance / club filter belongs to the category picked: the other categories' tiles keep their
    // own numbers (only the year / tour / tournament / round / span filters apply), dimmed and not clickable.
    const apart = (k) => !!(S.narrowed() && S.st.cats.length && !S.st.cats.includes(k));
    const noShot = { lie: [], dist: [], club: [] };
    const anyApart = S.catsAvail.some(([k]) => apart(k));
    const allCatsBare = anyApart ? S.nz(applyFilters(S.me.rounds, { ...f, ...noShot, cats: [] })) : null;
    const fieldBare = anyApart ? S.sliceOnce("bare", { ...S.lastRankF, ...noShot, cats: [] }) : [];
    const avgIn = (list, k) => { const v = S.rankedField(list).map((p) => S.metric(p.rounds, k)).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const tiles = S.catsAvail.length < 2 ? [] : S.catsAvail.map(([k, l]) => {
      const off = apart(k), mineK = off ? allCatsBare : allCats, fieldK = off ? fieldBare : fieldAllCats;
      const v = S.metric(mineK, k), rk = S.rankAmong(fieldK, S.me.key, k);
      const on = S.st.cats.length === 1 && S.st.cats[0] === k;
      const b = el("button", { type: "button", class: `hero-tile${on ? " on" : ""}${off ? " apart" : ""}`, "aria-pressed": on ? "true" : "false", disabled: off ? true : null,
        title: off ? "Lie / distance / club filters don\u2019t apply here: this is the whole category. Reset the filters to explore it." : on ? "Back to all categories" : `Explore ${l}` }, [
        el("span", { class: "ht-name" }, l), (() => { const ref = S.relOn() ? S.othersAvg(fieldK, S.me.key, k) : null; return el("strong", { class: v == null ? "" : S.showCls(v, ref, sg ? null : avgIn(fieldK, k)) }, S.showV(v, ref)); })(), el("span", { class: "ht-rank" }, S.showRanks && rk.rank && rk.of > 1 ? `${S.ordinal(rk.rank)} of ${rk.of}` : ""),
      ]);
      if (!off) b.addEventListener("click", () => { S.st.cats = on ? [] : [k]; S.draw(); });
      return b;
    });
    const heroRef = S.relOn() ? S.othersAvg(slicedField, S.me.key) : null; // (update 226)
    const fieldVals = sg ? null : S.rankAmong(slicedField, null).vals;
    const fieldAvg = fieldVals && fieldVals.length ? fieldVals.reduce((t, x) => t + x.v, 0) / fieldVals.length : null;
    const trendName = sg ? "SG" : S.def.label;
    return el("section", { class: "panel hero" }, [
      el("div", { class: "hero-top" }, [
        el("div", { class: "hero-id" }, [
          el("span", { class: "hero-kicker" }, `${S.describe()}`),
          el("h2", { class: "hero-name" }, S.me.label),
          el("div", { class: "hero-big" }, [el("strong", { class: S.showCls(total, heroRef, fieldAvg) }, S.showV(total, heroRef)), el("span", {}, S.relOn() && heroRef != null ? `${sg ? "strokes gained a round" : S.def.label} vs the field (${S.fmtV(heroRef)})` : sg ? "strokes gained a round" : S.def.label)]),
          sg ? null : el("p", { class: "hero-help" }, S.def.help),
          S.tourButtons(), // (update 376: the tour, right under the big number, above the pills)
          // (update 159: each pill opens a table: the rankings, every round, the form, the wins and top 10s)
          el("div", { class: "hero-chips" }, [
            // (coloured by rank, as in the report: top 10, 11-50, 51-100, 101-150, past 150)
            S.showRanks && r.rank && r.of > 1 ? S.chipBtn(`hero-chip rank-chip ${r.rank <= 10 ? "rk-10" : r.rank <= 50 ? "rk-50" : r.rank <= 100 ? "rk-100" : r.rank <= 150 ? "rk-150" : "rk-out"}`,
              `${S.ordinal(r.rank)} of ${r.of}`, "Show the rankings", () => S.rankPopup()) : null,
            S.chipBtn("hero-chip", S.rw(mine.length), `Show every ${S.unit}`, () => S.tournamentsPopup(ordered, slicedField, "Rounds")),
            // (update 175) Events: each tournament, their average there and where it placed
            S.unit === "event" ? null : (() => { const n = new Set(ordered.map((rd) => `${rd.event}|${S.yearOf(rd)}`)).size;
              return S.chipBtn("hero-chip", `${n} Event${n === 1 ? "" : "s"}`, "Show every tournament", () => S.eventsPopup(ordered, slicedField, r, "event")); })(),
            form ? S.chipBtn(`hero-chip ${form[1]}`, `Form: ${form[0]}`, "Show the form", () => S.formPopup(ordered)) : null,
          ]),
          (() => {
            if (!S.showRanks || !S.rankedField(slicedField).some((p) => p.key !== S.me.key)) return null;
            const res = S.myFinishes(slicedField), wins = res.filter((x) => x.rank === 1), tops = res.filter((x) => x.rank <= 10);
            return el("div", { class: "hero-chips hero-chips2" }, [
              S.chipBtn("hero-chip", `${wins.length} ${wins.length === 1 ? "Win" : "Wins"}`, "Show the wins", () => S.finishesPopup(wins, "Wins", res)),
              S.chipBtn("hero-chip", `${tops.length} Top 10${tops.length === 1 ? "" : "s"}`, "Show the top 10s", () => S.finishesPopup(tops, "Top 10s", res)),
            ]);
          })(),
          S.insightsButton(slicedField),
        ]),
        (() => {
          // tap the chart: every round, its number and its rank in the field
          if (hist.length < 2) return null;
          // (update 177: one point a tournament; Min. rounds is no longer here, it's in the Rankings)
          const labels = hist.map((x) => { const d = new Date(x.date); return isNaN(d) ? x.date : shortDate(d); });
          // (update 174) Rank | Stat: the rolling rank, or the rolling average (everything up to that date, this selection)
          const mode = () => (!S.showRanks || S.st.heroChartMode === "stat" ? "stat" : "rank");
          const title = () => (mode() === "stat" ? "Weekly Rolling Average" : "Weekly Rank History");
          const makeChart = () => S.chartBox((c) => (mode() === "stat" ? S.heroChart(c, labels, hist.map((x) => x.avg)) : S.rankChart(c, labels, hist)));
          const titleEl = el("span", { class: "hero-chart-title" }, title());
          const seg = el("div", { class: "hero-chart-mode", role: "group", "aria-label": "Chart shows" }, [["rank", "Rank"], ["stat", "Stat"]].map(([v, l]) => {
            const b = el("button", { type: "button", class: `hcm-btn${mode() === v ? " on" : ""}`, "aria-pressed": String(mode() === v), title: v === "rank" ? "Plot the rolling rank" : "Plot the rolling average" }, l);
            b.addEventListener("click", () => {
              if (mode() === v) return;
              S.st.heroChartMode = v;
              for (const x of seg.children) { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }
              titleEl.textContent = title();
              const fresh = makeChart(); chartEl.replaceWith(fresh); chartEl = fresh;
            });
            return b;
          }));
          for (const ev of ["click", "keydown", "pointerdown"]) seg.addEventListener(ev, (e) => e.stopPropagation());
          let chartEl = makeChart();
          const box = el("div", { class: "hero-chart hero-chart-tap", role: "button", tabindex: "0", title: `Show every ${S.unit === "event" ? "event" : "tournament"}`, "aria-label": `${trendName} history chart. Show every tournament in a table.` }, [
            el("span", { class: "hero-chart-label" }, [titleEl, S.showRanks ? el("span", { class: "hero-chart-ctrls" }, [seg]) : null]),
            chartEl]);
          const openT = () => S.eventsPopup(ordered, slicedField, r);
          // (update 393) press and hold on the chart: a thin line where you touch, the point on the curve, and that
          // week's numbers; slide to move it, let go to put it away (a quick tap still opens every tournament)
          let holdT = null, scrubbing = false, skipClick = false, sx = 0, sy = 0;
          const evAt = new Map(); for (const rd of ordered) { const d = String(rd.date || ""); const k = `${rd.event}|${S.yearOf(rd)}`; const cur = evAt.get(k); if (!cur || d > cur.end) evAt.set(k, { end: d, event: rd.event, k }); }
          const evByEnd = new Map([...evAt.values()].map((x) => [x.end, x]));
          const weekSG = (k) => { const rs = ordered.filter((rd) => `${rd.event}|${S.yearOf(rd)}` === k); return rs.length ? { v: S.metric(rs), n: rs.length } : null; };
          // (update 455) that week's own rank: where their average at that tournament ranked in its field (the same as
          // Event Rank in the tournaments table), worked out once on the first touch
          let weekRk = null;
          const weekRank = (k) => {
            if (!S.showRanks) return null;
            if (!weekRk) { weekRk = new Map(); for (const e of S.eventsOf(S.rankedField(slicedField))) { const mineE = [...e.by].find(([p]) => p.key === S.me.key); if (!mineE) continue; const i = e.ranked.findIndex((x) => x.p.key === S.me.key); weekRk.set(`${e.event}|${S.yearOf(mineE[1][0])}`, i < 0 ? null : { rank: i + 1, of: e.ranked.length }); } }
            return weekRk.get(k) || null;
          };
          const scrub = el("div", { class: "hc-scrub", hidden: true }, [el("i", { class: "hc-line" }), el("i", { class: "hc-dot" }), el("div", { class: "hc-tip" })]);
          const place = (clientX) => {
            const cv = box.querySelector("canvas"), ch = cv && typeof Chart !== "undefined" && Chart.getChart ? Chart.getChart(cv) : null;
            if (!ch) return;
            const pts = ch.getDatasetMeta(0)?.data || [];
            if (!pts.length) return;
            const cr = cv.getBoundingClientRect(), br = box.getBoundingClientRect(), x = clientX - cr.left;
            let i = 0; for (let j = 1; j < pts.length; j++) if (Math.abs(pts[j].x - x) < Math.abs(pts[i].x - x)) i = j;
            const pt = pts[i], h = hist[i]; if (!h) return;
            const ox = cr.left - br.left, oy = cr.top - br.top;
            scrub.hidden = false;
            const [line, dot, tip] = scrub.children;
            line.style.cssText = `left:${ox + pt.x}px;top:${oy + (ch.chartArea?.top ?? 0)}px;height:${(ch.chartArea?.bottom ?? cr.height) - (ch.chartArea?.top ?? 0)}px`;
            dot.style.cssText = `left:${ox + pt.x}px;top:${oy + pt.y}px`;
            const ev = evByEnd.get(String(h.date)), wk = ev ? weekSG(ev.k) : null, wr = ev ? weekRank(ev.k) : null;
            const d = new Date(`${String(h.date).slice(0, 10)}T12:00:00`);
            mount(tip, [el("strong", {}, isNaN(d) ? String(h.date) : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })),
              ev?.event ? el("span", { class: "hc-tip-ev" }, ev.event) : null,
              mode() === "rank" && h.rank ? el("span", {}, [`Rank `, el("b", {}, `${S.ordinal(h.rank)} of ${h.of}`)]) : null,
              h.avg != null ? el("span", {}, [`Rolling average `, el("b", { class: S.isSG() ? (h.avg >= 0 ? "pos" : "neg") : "" }, S.fmtV(h.avg))]) : null,
              wk && wk.v != null ? el("span", {}, [`That week `, el("b", { class: S.isSG() ? (wk.v >= 0 ? "pos" : "neg") : "" }, S.fmtV(wk.v)), ` (${wk.n} ${wk.n === 1 ? "round" : "rounds"})`]) : null,
              wr ? el("span", {}, [`That week\u2019s rank `, el("b", {}, `${S.ordinal(wr.rank)} of ${wr.of}`)]) : null]);
            // (update 395) beside the line, never over the dot: to its right in the left half of the chart, to its left in
            // the right half, level with the dot (kept inside the chart)
            const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 80, dx = ox + pt.x, dy = oy + pt.y, gap = 14;
            let left = dx < br.width / 2 ? dx + gap : dx - gap - tw;
            left = Math.max(4, Math.min(br.width - tw - 4, left));
            const top = Math.max(4, Math.min(br.height - th - 4, dy - th / 2));
            // (squeezed on a narrow chart so it can't sit beside it: above or below the dot instead)
            const overlapX = dx >= left - 6 && dx <= left + tw + 6;
            tip.style.left = `${left}px`;
            tip.style.top = `${overlapX ? (dy > br.height / 2 ? Math.max(4, dy - th - gap) : Math.min(br.height - th - 4, dy + gap)) : top}px`;
          };
          const endScrub = () => { clearTimeout(holdT); holdT = null; if (scrubbing) { scrubbing = false; skipClick = true; scrub.hidden = true; box.classList.remove("scrubbing"); } };
          box.addEventListener("pointerdown", (e) => {
            if (e.target.closest(".hero-chart-ctrls")) return;
            sx = e.clientX; sy = e.clientY;
            clearTimeout(holdT);
            holdT = setTimeout(() => { scrubbing = true; box.classList.add("scrubbing"); try { box.setPointerCapture(e.pointerId); } catch { /* */ } place(sx); }, 280);
          });
          box.addEventListener("pointermove", (e) => {
            if (scrubbing) { place(e.clientX); return; }
            if (holdT && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) { clearTimeout(holdT); holdT = null; } // (scrolling, not holding)
          });
          for (const ev of ["pointerup", "pointercancel", "pointerleave"]) box.addEventListener(ev, endScrub);
          box.addEventListener("touchmove", (e) => { if (scrubbing) e.preventDefault(); }, { passive: false });
          box.addEventListener("contextmenu", (e) => { if (scrubbing || holdT) e.preventDefault(); });
          box.appendChild(scrub);
          box.addEventListener("click", (e) => { if (skipClick) { skipClick = false; e.stopPropagation(); return; } openT(); });
          box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openT(); } });
          return box;
        })(),
      ]),
      tiles.length ? el("div", { class: `hero-tiles n${tiles.length}` }, tiles) : null,
      S.heroHypo ? el("div", { class: "hero-hypo" }, S.heroHypo) : null,
      foot,
    ]);
  }
  // no player: the leaderboard
  const minR = S.minRoundsFor(slicedField.filter((p) => p.rounds.length));
  const ranked = S.rankedField(slicedField).map((p) => ({ p, v: S.metric(p.rounds), n: p.rounds.length })).filter((x) => x.v != null).sort(S.byBest);
  const minBox = S.minRoundsBox(slicedField.filter((p) => p.rounds.length));
  const shown = ranked.map((x, i) => ({ ...x, i })); // everyone; the list scrolls
  const max = Math.max(...shown.map((x) => Math.abs(x.v)), 0.01);
  const posMax = Math.max(...shown.filter((x) => x.v >= 0).map((x) => x.v), 0.01), negMax = Math.max(...shown.filter((x) => x.v < 0).map((x) => -x.v), 0.01);
  // another stat: one blue bar, its length from the lowest value to the highest (so the differences show)
  const lo = Math.min(...shown.map((x) => x.v)), hi = Math.max(...shown.map((x) => x.v));
  const blueBar = (v) => { const fr = hi - lo > 1e-9 ? 0.12 + (0.88 * (v - lo)) / (hi - lo) : 1; return `width:${fr * 100}%;background:linear-gradient(90deg, #0a2f66, #4db2ff);background-size:${100 / fr}% 100%;background-repeat:no-repeat`; };
  return el("section", { class: "panel hero" }, [
    el("div", { class: "hb-head" }, [el("div", {}, [el("span", { class: "hero-kicker" }, S.describe()), el("h2", { class: "hero-name" }, "Leaderboard"),
      el("p", { class: "hero-help" }, [el("strong", {}, S.def.label), `: ${S.def.help}`])]), minBox]),
    S.tourButtons(),
    ranked.length ? null : el("p", { class: "muted small" }, `No one has ${S.sgEligible ? `${minR} strokes-gained ${minR === 1 ? "round" : "rounds"}` : S.rw(minR)} in this selection.`),
    el("div", { class: `hero-board${sg ? "" : " stat-board"}`, tabindex: "0", "aria-label": `Leaderboard: ${ranked.length} players (scroll for more)` }, shown.map((x) => el("div", { class: "hb-row" }, [
      el("span", { class: "hb-rank" }, S.showRanks ? String(x.i + 1) : ""),
      S.pickable(x.p.key) ? (() => { const b = el("button", { type: "button", class: "hb-name hb-link", title: `Open ${x.p.label}` }, S.starred(x.p.key, x.p.label)); b.addEventListener("click", () => S.opts.onPick(x.p.key)); return b; })() : el("span", { class: "hb-name", title: x.p.label }, S.starred(x.p.key, x.p.label)),
      // a value that shows as +0.00 is yellow (neither gained nor lost, to two places)
      el("span", { class: "hb-bar" }, el("span", { class: sg ? S.signCls(x.v) : "", style: !sg ? blueBar(x.v) : S.isZero(x.v) ? "width:4%;background:#ffd60a" : S.htmlBarStyle(x.v, Math.abs(x.v) / max, Math.abs(x.v) / (x.v >= 0 ? posMax : negMax)) })),
      el("strong", { class: sg ? S.signCls(x.v) : "" }, S.fmtV(x.v)),
    ]))),
    (() => { const t = [S.opts.onPick ? S.opts.pickNote || "Tap a name for that player's view." : "",
      !sg && S.def.higher === false ? " Lower is better, so the lowest is first." : !sg && S.def.higher == null ? " Highest first." : ""].join("").trim();
      return t ? el("p", { class: "muted small" }, t) : null; })(),
    // the average of everyone on the leaderboard
    shown.length ? (() => { const avg = shown.reduce((t, x) => t + x.v, 0) / shown.length;
      return el("p", { class: "hb-avg" }, ["Tour Avg = ", el("strong", { class: sg ? S.signCls(avg) : "" }, S.fmtV(avg))]); })() : null,
    foot,
  ]);
}
// a pop-up over the page: eyebrow, title, a line under it, then the content. Returns its close function.
export function popup(S, eyebrow, title, sub, content, label = title) {
  const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
  const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": label }, el("div", { class: "gx-pop hero-pop" }, [
    el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, eyebrow), el("h2", {}, title), sub ? el("p", { class: "gx-sub" }, sub) : null]), close]),
    ...[].concat(content)]));
  const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
  const onKey = (e) => { if (e.key === "Escape") shut(); };
  close.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
  document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll");
  document.body.appendChild(overlay);
  close.focus();
  return shut;
}
// Steadiness: how much the rounds swing (standard deviation), the last n against the n before
export function steadinessLine(S, ordered, n) {
  const a = S.sdOf(S.roundVals(ordered.slice(-n))), b = S.sdOf(S.roundVals(ordered.slice(-2 * n, -n)));
  if (a == null || b == null) return null;
  const ch = a - b, same = Math.abs(ch) < (S.isSG() ? 0.05 : Math.max(1e-9, b * 0.05));
  const head = same ? "Steadiness is about the same" : ch < 0 ? "Steadiness is improving" : "Steadiness is declining";
  return `${head}: \u00b1${S.fmtDelta(a)} a ${S.unit} (standard deviation) over the last ${S.rw(n)}, against \u00b1${S.fmtDelta(b)} in the ${n} before${same ? "" : ` (${ch < 0 ? "steadier" : "streakier"} by ${S.fmtDelta(ch)})`}.`;
}
// Form: the last n rounds and their average, then the n before and theirs
// (update 181) Form, like the Watchlist's Big move: each round as a bar (the last n coloured) with the two
// averages, then where the change came from, category by category
export async function formPopup(S, ordered) {
  const { renderBlocks } = await import("./badgePopup.js");
  const n = Math.min(12, Math.floor(ordered.length / 2));
  const last = ordered.slice(-n), prev = ordered.slice(-2 * n, -n), sg = S.isSG();
  const goodTone = (v, ref) => (sg ? null : S.def.higher == null || v == null || ref == null ? "gold" : S.better(v, ref) ? "pos" : "neg");
  const prevAvg = S.metric(prev), lastAvg = S.metric(last);
  // (update 455) the bars follow the row picked in the table below: SG: Total to start, or a part of the game, or one
  // of its distances
  const valOf = (rs, k = null, d = null) => (d ? S.perRd(rs, k, d) : S.metric(rs, k));
  const nameOf = (k, d) => (!k ? (sg ? "SG: Total" : S.def.label) : `${CATEGORIES.find(([q]) => q === k)?.[1] || k}${d ? ` \u00b7 ${d}` : ""}`);
  const holder = el("div", { class: "wl-form-bars" });
  const barsFor = (k = null, d = null) => {
    const pa = valOf(prev, k, d), la = valOf(last, k, d);
    const items = [...prev, ...last].map((rd, i) => { const v = valOf([rd], k, d); return { label: S.dateTxt(rd.date), sub: [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" \u00b7 "), v, on: i >= prev.length, tone: sg ? null : goodTone(v, pa) }; });
    mount(holder, [el("p", { class: "wl-pop-t" }, nameOf(k, d)),
      ...renderBlocks([{ kind: "bars", fmtFn: S.fmtV, zero: sg, items, ref: [{ v: pa, label: `Previous ${n}`, from: 0, to: prev.length }, { v: la, label: `Last ${n}`, from: prev.length, to: prev.length + last.length }] }])]);
  };
  barsFor();
  const cell = (v) => (sg ? { sg: v } : { text: S.fmtV(v) });
  const change = (a, b) => { if (a == null || b == null) return sg ? { sg: null } : { text: "\u2014" };
    if (sg) return { sg: a - b, arrow: true };
    const d = a - b, same = Math.abs(d) < 1e-9;
    return { text: `${same ? "" : d > 0 ? "\u25B2 " : "\u25BC "}${S.fmtDelta(d)}`, tone: same || S.def.higher == null ? "" : S.better(a, b) ? "pos" : "neg" }; };
  const rows = [[null, sg ? "SG: Total" : S.catsAvail.length > 1 ? "All" : S.def.label], ...(S.catsAvail.length > 1 ? S.catsAvail : [])].map(([k, l]) => {
    const a = S.metric(last, k), b = S.metric(prev, k);
    // (update 445) each part of the game opens to its distances
    const kids = sg && k ? S.distsIn([...prev, ...last], k).map((d) => { const da = S.perRd(last, k, d), db = S.perRd(prev, k, d); return { cells: [d, { sg: db }, { sg: da }, { sg: da - db, arrow: true }], pick: () => barsFor(k, d) }; }) : null;
    return { strong: !k, cells: [l, cell(b), cell(a), change(a, b)], pick: () => barsFor(k), picked: !k, ...(kids?.length ? { kids } : {}) };
  });
  const blocks = [
    { kind: "table", title: S.catsAvail.length > 1 ? `By category (a ${S.unit})` : "The averages", note: S.catsAvail.length > 1 ? "Tap a category or a distance to chart it above." : null, cols: [["Category"], [`Previous ${n}`, "num"], [`Last ${n}`, "num"], ["Change", "num"]], rows },
  ];
  return S.popup("Form", S.me.label, `${sg ? "Strokes gained" : S.def.label} in each ${S.unit}: the last ${n} (highlighted) against the ${n} before, and where the change came from.`,
    el("div", { class: "wl-pop-body" }, [holder, ...renderBlocks(blocks)]), "Form");
}
// Each tournament in the selection: who played the most rounds there, best first (the "winner" leads)
export function eventsOf(S, players) {
  const ev = new Map();
  for (const p of players) for (const rd of p.rounds) {
    if (!rd.event) continue;
    const k = `${rd.event}|${S.yearOf(rd)}`;
    const e = ev.get(k) || ev.set(k, { event: rd.event, end: rd.date, by: new Map() }).get(k);
    if (String(rd.date) > String(e.end)) e.end = rd.date;
    (e.by.get(p) || e.by.set(p, []).get(p)).push(rd);
  }
  return [...ev.values()].map((e) => {
    const most = Math.max(...[...e.by.values()].map((rs) => rs.length));
    const ranked = [...e.by].filter(([, rs]) => rs.length >= most).map(([p, rs]) => ({ p, v: S.metric(rs), rs })).filter((x) => x.v != null).sort(S.byBest);
    return { ...e, players: e.by.size, ranked, best: ranked[0] || null, top10: ranked.slice(0, 10) };
  }).sort((a, b) => String(a.end).localeCompare(String(b.end)));
}
// the player's finish at each tournament (among those who played every round), newest first
export function myFinishes(S, slicedField) {
  return S.eventsOf(S.rankedField(slicedField)).map((e) => { const i = e.ranked.findIndex((x) => x.p.key === S.me.key); return i < 0 ? null : { e, rank: i + 1, of: e.ranked.length, v: e.ranked[i].v }; })
    .filter(Boolean).reverse();
}
export async function finishesPopup(S, list, what, all = []) {
  // (update 181) every tournament they finished as a bar, the wins (or top 10s) highlighted, then the list
  const { renderBlocks } = await import("./badgePopup.js");
  const hit = (x) => (what === "Wins" ? x.rank === 1 : x.rank <= 10);
  const chart = all.length ? renderBlocks([{ kind: "bars", fmtFn: S.fmtV, zero: S.isSG(), items: [...all].reverse().map((x) => ({ label: S.dateTxt(x.e.end), sub: `${x.e.event} \u00b7 ${S.ordinal(x.rank)} of ${x.of}`, v: x.v, on: hit(x), tone: S.isSG() ? null : "gold" })) }]) : [];
  const table = list.length ? el("div", { class: "table-scroll hero-tourn-scroll" }, el("table", { class: "plain rankings hero-tourn" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), el("th", { class: "num" }, S.isSG() ? "SG / Round" : S.def.label), el("th", { class: "num" }, "Finish")])),
    el("tbody", {}, list.map((x) => el("tr", {}, [el("td", { class: "ht-date" }, S.dateTxt(x.e.end)), el("td", { class: "ht-name" }, x.e.event),
      el("td", { class: `num ${S.isSG() ? S.signCls(x.v) : ""}` }, S.fmtV(x.v)), el("td", { class: `num ht-win ${x.rank === 1 ? "ht-won" : ""}` }, [String(x.rank), el("span", { class: "ht-of" }, ` of ${x.of}`)])]))),
  ])) : el("p", { class: "empty center" }, `No ${what.toLowerCase()} in this selection.`);
  S.popup(what, S.me.label, `${list.length} ${list.length === 1 ? "tournament" : "tournaments"} \u00b7 ${S.isSG() ? "strokes gained a round" : S.def.label}, newest first`, [...chart, table,
    infoTip(`${what === "Wins" ? "Best in the field" : "Top 10 in the field"} in ${S.isSG() ? "strokes gained a round" : S.def.label}, among the players who played every round there.`)], what);
}
export function rankPopup(S) {
  S.rankShut?.();
  let shut = null, redone = false;
  // (the box can report its change twice, e.g. again as the old pop-up closes: redraw once)
  const block = S.rankingsBlock(S.lastSliced, () => { if (redone) return; redone = true; shut?.(); S.draw(); S.rankPopup(); });
  block.classList.add("rank-pop");
  const close = S.popup("Rankings", S.isSG() ? "Strokes Gained" : S.def.label, S.describe(), block, "Rankings");
  shut = S.rankShut = () => { close(); if (S.rankShut === shut) S.rankShut = null; };
  S.centerRankings();
}
// The hero chart's table (update 158) and the rounds pill's (update 159): every round, newest at the top, the
// player's number in it and where it ranked among everyone in the field who played that round.
export function tournamentsPopup(S, ordered, slicedField = [], eyebrow = null) {
  const sameRound = (x, rd) => x.event === rd.event && S.yearOf(x) === S.yearOf(rd) && (rd.roundNo ? x.roundNo === rd.roundNo : x.date === rd.date);
  const rankCell = (rd) => {
    const mineV = S.metric([rd]);
    const vals = [];
    if (mineV != null) for (const p of slicedField || []) {
      if (p.key === S.me.key) continue;
      const x = (p.rounds || []).find((y) => sameRound(y, rd));
      const v = x ? S.metric([x]) : null;
      if (v != null) vals.push(v);
    }
    if (!vals.length) return el("td", { class: "num ht-win" }, "\u2014");
    const r = 1 + vals.filter((v) => S.better(v, mineV) && Math.abs(v - mineV) > 1e-9).length;
    return el("td", { class: `num ht-win ${r === 1 ? "ht-won" : ""}` }, [String(r), el("span", { class: "ht-of" }, ` of ${vals.length + 1}`)]);
  };
  const events = new Set(ordered.map((rd) => `${rd.event}|${S.yearOf(rd)}`)).size;
  S.popup(eyebrow || `${S.isSG() ? "SG" : S.def.label} trend`, S.me.label, `${S.rw(ordered.length)} \u00b7 ${events} ${events === 1 ? "tournament" : "tournaments"} \u00b7 newest first`, [
    el("div", { class: "table-scroll hero-tourn-scroll" }, S.roundsTable([...ordered].reverse(), { rank: rankCell })),
    infoTip(`Rank: where that ${S.unit} placed among everyone in the field who played it.`),
  ], S.unit === "event" ? "Tournaments" : "Rounds");
}
// (update 174) The hero chart's table: one row per tournament, newest first: their average there and where it
// placed, and their rolling average and rank (everything up to the end of that tournament, this selection)
// (update 175) two views of it: "rolling" (the chart's table: Rolling Avg and Rank) and "event" (the Events pill:
// Event Avg and Rank)
export function eventsPopup(S, ordered, slicedField, now, view = "rolling") {
  const rolling = view === "rolling";
  const hist = rolling ? (S.showRanks ? S.rankHistory(ordered, slicedField, now, { all: true }) : S.rollingOnly(ordered)) : [];
  const at = new Map(hist.map((x) => [String(x.date || ""), x]));
  const fin = new Map();
  if (!rolling && S.showRanks) for (const e of S.eventsOf(S.rankedField(slicedField))) {
    const mineE = [...e.by].find(([p]) => p.key === S.me.key);
    if (!mineE) continue;
    const i = e.ranked.findIndex((x) => x.p.key === S.me.key);
    fin.set(`${e.event}|${S.yearOf(mineE[1][0])}`, i < 0 ? null : { rank: i + 1, of: e.ranked.length });
  }
  const groups = new Map();
  for (const rd of ordered) { const k = `${rd.event}|${S.yearOf(rd)}`; (groups.get(k) || groups.set(k, { event: rd.event, rs: [] }).get(k)).rs.push(rd); }
  const rows = [...groups].map(([k, g]) => { const end = g.rs.reduce((m, rd) => (String(rd.date) > String(m) ? rd.date : m), g.rs[0].date); return { k, ...g, end, v: S.metric(g.rs), fin: fin.get(k), roll: at.get(String(end || "")) }; })
    .sort((a, b) => String(b.end).localeCompare(String(a.end)));
  const rankTd = (x, won = false) => (x ? el("td", { class: `num ht-win ${won && x.rank === 1 ? "ht-won" : ""}` }, [String(x.rank), el("span", { class: "ht-of" }, ` of ${x.of}`)]) : el("td", { class: "num ht-win" }, "\u2014"));
  const valTd = (v) => el("td", { class: `num ${S.isSG() ? S.signCls(v) : ""}` }, S.fmtV(v));
  const table = el("table", { class: "plain rankings hero-tourn hero-events" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), S.unit === "event" ? null : el("th", { class: "num" }, "Rds"),
      ...(rolling ? [el("th", { class: "num" }, "Rolling Avg"), S.showRanks ? el("th", { class: "num" }, "Rolling Rank") : null] : [el("th", { class: "num" }, "Event Avg"), S.showRanks ? el("th", { class: "num" }, "Event Rank") : null])])),
    el("tbody", {}, rows.flatMap((x) => { const tr = el("tr", {}, [el("td", { class: "ht-date" }, S.dateTxt(x.end)), el("td", { class: "ht-name" }, x.event || "\u2014"),
      S.unit === "event" ? null : el("td", { class: "num" }, String(x.rs.length)),
      ...(rolling ? [valTd(x.roll?.avg ?? null), S.showRanks ? rankTd(x.roll) : null] : [valTd(x.v), S.showRanks ? rankTd(x.fin, true) : null])]);
      // (update 445) an event opens to its parts of the game (a round), each to its distances
      return S.isSG() && x.rs.some((rd) => (rd.shots || []).some((y) => y.cat)) ? S.openRow(tr, 3 + (S.unit === "event" ? 0 : 1) + (S.showRanks ? 1 : 0), () => S.sgBreakdown(x.rs)) : [tr]; })),
  ]);
  S.popup(rolling ? `${S.isSG() ? "SG" : S.def.label} history` : "Events", S.me.label, `${rows.length} ${rows.length === 1 ? "tournament" : "tournaments"} \u00b7 ${S.rw(ordered.length)} \u00b7 newest first`, [
    el("div", { class: "table-scroll hero-tourn-scroll" }, table),
    el("p", { class: "muted small" }, !S.showRanks ? (rolling ? "Rolling Avg: everything up to the end of that tournament in this selection." : `Event Avg: ${S.isSG() ? "strokes gained a round" : S.def.label} at that tournament.`) : rolling
      ? "Rolling Avg and Rolling Rank: everything up to the end of that tournament in this selection, ranked as on the chart (the same Min. rounds)."
      : `Event Avg: ${S.isSG() ? "strokes gained a round" : S.def.label} at that tournament. Event Rank: where that placed among the players who played every round there (\u2014 when they didn\u2019t).`),
  ], "Tournaments");
  table.closest(".gx-pop")?.classList.add("hero-events-pop"); // (wider: seven columns)
}
// ✨ Generate AI Insights: the Reports page's report builder, in a pop-up, for the player on screen
export function insightsButton(S, slicedField = []) {
  if (!S.me || !S.me.key) return null;
  const btn = el("button", { type: "button", class: "hero-insights" }, "\u2728 Generate AI Report");
  btn.addEventListener("click", async () => {
    const { reportBuilder } = await import("./reportGen.js");
    const state = getState();
    const flashMsg = (msg) => { const n = el("p", { class: "hero-pop-msg", role: "status" }, msg); body.prepend(n); setTimeout(() => n.remove(), 4000); };
    const builder = reportBuilder({ playerKey: S.me.key, playerLabel: S.me.label, canSave: false, flash: flashMsg, // (update 164: no Save to Reports here)
      source: S.opts.entered ? "entered" : "tour", minRounds: S.minRoundsFor(slicedField.filter((p) => p.rounds.length)), tour: S.tourCounts.length ? (S.st.tour[0] ?? null) : null,
      fullField: S.fieldIsSummary() ? null : S.fieldAll }); // (the admin: everyone's rows, for ranks by distance)
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const body = el("div", { class: "hero-pop-body" }, builder.node || builder);
    const overlay = el("div", { class: "gx-pop-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Generate AI Report" }, el("div", { class: "gx-pop hero-pop" }, [
      el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Performance report"), el("h2", {}, S.me.label)]), close]), body]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut); overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    document.addEventListener("keydown", onKey); document.body.classList.add("gx-noscroll");
    document.body.appendChild(overlay);
    overlay.querySelector(".report-gen-open")?.click(); // straight to the options
  });
  return btn;
}
// (update 168) Rank history: after each of the player's rounds, their rank among the same players with what each
// had played by that date (Min. rounds scaled to the most played by then). The last point is the rank shown.
// (update 183) no ranks (entered rounds): their rolling average at the end of each tournament
export function rollingOnly(S, ordered) {
  const dk = (d) => String(d || ""), ends = new Map();
  for (const rd of ordered) { const k = `${rd.event}|${S.yearOf(rd)}`; if (dk(rd.date) > (ends.get(k) || "")) ends.set(k, dk(rd.date)); }
  return [...new Set(ends.values())].sort().map((d) => ({ date: d, avg: S.metric(ordered.filter((rd) => dk(rd.date) <= d)) })).filter((x) => x.avg != null);
}
export function rankHistory(S, ordered, slicedField, now, { all = false } = {}) {
  const dk = (d) => String(d || "");
  const ranked = S.rankedField(slicedField);
  if (!ranked.some((p) => p.key !== S.me.key)) return [];
  const sorted = ranked.map((p) => ({ key: p.key, rs: [...p.rounds].sort((a, b) => dk(a.date).localeCompare(dk(b.date))) }));
  const mostNow = Math.max(1, ...sorted.map((p) => p.rs.length));
  const minNow = Math.max(1, S.minRoundsFor(slicedField.filter((p) => p.rounds.length)));
  // the dates to plot: the end of each tournament (update 177: weekly, not each round; at most 60, spread
  // evenly, always the latest)
  const ends = new Map();
  for (const rd of ordered) { const k = `${rd.event}|${S.yearOf(rd)}`; if (dk(rd.date) > (ends.get(k) || "")) ends.set(k, dk(rd.date)); }
  let dates = [...new Set(ends.values())].sort();
  if (!all && dates.length > 60) { const step = (dates.length - 1) / 59; dates = Array.from({ length: 60 }, (_, i) => dates[Math.round(i * step)]); }
  const upTo = (rs, d) => { let lo = 0, hi = rs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dk(rs[m].date) <= d) lo = m + 1; else hi = m; } return lo; };
  // strokes gained: running totals, so each date is quick
  const sgFast = S.isSG();
  const cum = sgFast ? sorted.map((p) => { let t = 0; return p.rs.map((rd) => { for (const x of rd.shots) t += x.sg; return t; }); }) : null;
  const out = [];
  for (const d of dates) {
    const counts = sorted.map((p) => upTo(p.rs, d));
    const most = Math.max(1, ...counts);
    const need = Math.max(1, Math.round((minNow * most) / mostNow));
    const vals = [];
    sorted.forEach((p, i) => {
      const n = counts[i];
      if (!n || (n < need && p.key !== S.me.key)) return;
      const v = sgFast ? cum[i][n - 1] / n : S.metric(p.rs.slice(0, n));
      if (v != null) vals.push({ key: p.key, v });
    });
    vals.sort(S.byBest);
    const i = vals.findIndex((x) => x.key === S.me.key);
    if (i >= 0) out.push({ date: d, rank: i + 1, of: vals.length, avg: vals[i].v }); // (avg: their rolling average, update 174)
  }
  if (out.length && now?.rank) Object.assign(out[out.length - 1], { rank: now.rank, of: now.of }); // (the same as the pill)
  return out;
}
// the rank line: 1st at the top, a gold line, the latest point marked
export function rankChart(S, canvas, labels, hist) {
  const ctx = canvas.getContext("2d"), h = canvas.parentNode?.clientHeight || 180;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(212,180,131,0.35)"); grad.addColorStop(1, "rgba(212,180,131,0)");
  const ranks = hist.map((x) => x.rank), worst = Math.max(...ranks);
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data: ranks, borderColor: "#d4b483", backgroundColor: grad, fill: "end", borderWidth: 2.4, stepped: false, tension: 0.25,
      pointRadius: ranks.map((_, i) => (i === ranks.length - 1 ? 3.5 : 0)), pointBackgroundColor: "#f3dfbd", pointHoverRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${S.ordinal(c.parsed.y)} of ${hist[c.dataIndex].of}` } } },
      scales: {
        x: { display: true, grid: { display: false }, border: { display: false }, ticks: { color: "#6e6e73", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, padding: 2 } },
        y: { reverse: true, min: 1, suggestedMax: Math.max(5, worst + 1), grid: { color: "rgba(255,255,255,0.06)" }, border: { display: false },
          ticks: { color: "#8e8e93", maxTicksLimit: 5, precision: 0, callback: (v) => (Number.isInteger(v) ? S.ordinal(v) : "") } } } },
  });
}
export function heroChart(S, canvas, labels, vals) {
  const ctx = canvas.getContext("2d"), h = canvas.parentNode?.clientHeight || 180;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(212,180,131,0.45)"); grad.addColorStop(1, "rgba(212,180,131,0)");
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data: vals, borderColor: "#d4b483", backgroundColor: grad, fill: S.isSG() ? "origin" : "start", borderWidth: 2.4, tension: 0.25,
      pointRadius: vals.map((_, i) => (i === vals.length - 1 ? 3.5 : 0)), pointBackgroundColor: "#f3dfbd", pointHoverRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${S.fmtV(c.parsed.y)} (rolling average)` } } },
      scales: {
        // a minimal x-axis: a few dates, small and grey, no grid
        x: { display: true, grid: { display: false }, border: { display: false }, ticks: { color: "#6e6e73", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, padding: 2 } },
        y: { grid: { color: (c) => (c.tick.value === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.06)") }, ticks: { color: "#8e8e93", maxTicksLimit: 4, callback: (v) => (S.isSG() ? fmtSG(v) : fmtStat({ ...S.def, dp: Math.min(S.def.dp ?? 1, 1) }, v)) }, border: { display: false } } } },
  });
}
