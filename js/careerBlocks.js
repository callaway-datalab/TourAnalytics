// (update 194) "Getting better or worse?" and "Where they play their best": a player's whole career, at the
// bottom of the Stats page (they were on Comparisons until now). Tapping a row opens Comparisons with it.
//   careerBlocks(rounds, { key, source, ui }) → a list of page sections (or [] when there's too little to say)
//   ui: an object kept between redraws (which grouping tab is open).
import { el } from "./ui.js";
import { fmtSG } from "./sg.js";
import { trajectory, trajectoryWords, conditions, DIMENSIONS, fmtSigned, SG_ROWS, sgRounds } from "./compareData.js";

const tone = (v) => (v == null ? "" : Math.round(v * 100) === 0 ? "zero" : v > 0 ? "pos" : "neg");
const secHead = (t, sub) => el("div", { class: "cmp-sec-head" }, [el("h2", {}, t), sub ? el("p", { class: "muted small" }, sub) : null]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The Comparisons page, opened on one comparison ("win:10", "cond:course:Riviera"). */
export function compareLink(key, source, pick) {
  const q = new URLSearchParams();
  if (key) q.set("player", key);
  if (source && source !== "tour") q.set("src", source);
  q.set("pick", pick);
  return `#/comparisons?${q}`;
}

export function careerBlocks(rounds, { key = null, source = "tour", ui = {}, redraw = () => {} } = {}) {
  const rs = sgRounds(rounds || []);
  if (rs.length < 6) return [];
  const go = (pick) => { location.hash = compareLink(key, source, pick); };
  return [trajectoryBlock(rs, go), conditionsBlock(rs, go, ui, redraw)].filter(Boolean);
}

// (update 196) Plain words first: one verdict, a simple "form over time" bar chart, what's behind it in plain
// names. The full table of numbers is still there, folded away under "Show the numbers".
const PLAIN = { OTT: "Driving", APP: "Approach shots", ARG: "Short game", PUTT: "Putting" };
const SAME = 0.25; // a change smaller than a quarter of a stroke a round is "about the same"
const way = (v) => (v == null ? 0 : v >= SAME ? 1 : v <= -SAME ? -1 : 0);
const strokes = (v) => `${Math.abs(v).toFixed(1)} stroke${Math.abs(v).toFixed(1) === "1.0" ? "" : "s"} a round`;

function verdict(tr) {
  const short = tr.find((x) => x.n === 10) || tr[0];
  const long = [...tr].reverse().find((x) => x.n >= 20 && x.n > short.n) || null;
  const s = way(short.ch.TOTAL), l = long ? way(long.ch.TOTAL) : 0;
  const lately = `the last ${short.n} rounds`, then = long ? `${long.n * 2} rounds ago` : "";
  const V = {
    "1,1": ["up", "Trending up", `Playing better over ${lately}, and better than ${then} too.`],
    "1,-1": ["up", "Bouncing back", `Playing better over ${lately}, but not yet back to where they were ${then}.`],
    "1,0": ["up", "Better lately", `Playing better over ${lately}.`],
    "-1,1": ["down", "Cooling off", `A dip over ${lately}, but still better than ${then}.`],
    "-1,-1": ["down", "Trending down", `Playing worse over ${lately}, and worse than ${then} too.`],
    "-1,0": ["down", "A recent dip", `Playing worse over ${lately}.`],
    "0,1": ["flat", "Steady, and better than before", `About the same over ${lately}, and better than ${then}.`],
    "0,-1": ["flat", "Steady, but below their best", `About the same over ${lately}, but not at the level of ${then}.`],
    "0,0": ["flat", "Steady", "About the same as before, recently and over the longer run."],
  }[`${s},${long ? l : 0}`];
  // what's behind the recent change, in plain names
  const parts = Object.entries(PLAIN).map(([k, name]) => ({ name, d: short.ch[k] })).filter((x) => x.d != null);
  const up = parts.filter((x) => x.d >= 0.15).sort((a, b) => b.d - a.d)[0];
  const down = parts.filter((x) => x.d <= -0.15).sort((a, b) => a.d - b.d)[0];
  return { short, dir: V[0], title: V[1], line: V[2], up, down };
}

// form over time: their rounds in blocks (10 at a time, or 5 with fewer than 40), oldest on the left
function formChart(rs) {
  const size = rs.length >= 40 ? 10 : 5;
  const n = Math.min(8, Math.floor(rs.length / size));
  if (n < 2) return null;
  const blocks = Array.from({ length: n }, (_, i) => {
    const part = rs.slice(rs.length - (n - i) * size, rs.length - (n - i - 1) * size);
    const v = part.reduce((t, rd) => t + rd.shots.reduce((u, x) => u + x.sg, 0), 0) / part.length;
    const d = String(part.at(-1).date || "");
    const m = /^(\d{4})-(\d{2})/.exec(d);
    return { v, label: i === n - 1 ? "Latest" : m ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ’${m[1].slice(2)}` : "" };
  });
  const NS = "http://www.w3.org/2000/svg";
  const mk = (t, a = {}, text = null) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v)); if (text != null) e.textContent = text; return e; };
  const W = 560, H = 210, T = 22, B = 44, L = 8, R = 8;
  const max = Math.max(0.5, ...blocks.map((b) => Math.abs(b.v)));
  const mid = T + (H - T - B) / 2, Y = (v) => mid - (v / max) * ((H - T - B) / 2);
  const slot = (W - L - R) / n, bw = Math.min(46, slot * 0.62);
  const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "form-chart", role: "img", "aria-label": `Strokes gained a round, ${size} rounds at a time, oldest to latest` });
  svg.append(mk("line", { x1: L, x2: W - R, y1: mid, y2: mid, stroke: "rgba(255,255,255,0.25)" }));
  blocks.forEach((b, i) => {
    const x = L + slot * i + slot / 2, y = Y(b.v), last = i === n - 1;
    const col = b.v >= 0 ? "#30d158" : "#ff453a";
    svg.append(mk("rect", { x: x - bw / 2, y: Math.min(y, mid), width: bw, height: Math.max(2, Math.abs(y - mid)), rx: 5, fill: col, "fill-opacity": last ? 1 : 0.55 }));
    svg.append(mk("text", { x, y: b.v >= 0 ? y - 6 : y + 15, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: last ? "#fff" : "rgba(235,235,245,0.75)" }, `${b.v >= 0 ? "+" : "−"}${Math.abs(b.v).toFixed(1)}`));
    svg.append(mk("text", { x, y: H - 8, "text-anchor": "middle", "font-size": 11.5, "font-weight": last ? 700 : 400, fill: last ? "#fff" : "rgba(235,235,245,0.6)" }, b.label));
  });
  return el("div", { class: "form-wrap" }, [
    el("p", { class: "form-cap" }, `Each bar is ${size} rounds, oldest on the left. Above the line = strokes gained; below = strokes lost.`),
    el("div", { class: "form-chart-box" }, svg),
  ]);
}

function trajectoryBlock(rs, go) {
  const tr = trajectory(rs);
  if (!tr.length) return null;
  const v = verdict(tr);
  const icon = { up: "▲", down: "▼", flat: "◆" }[v.dir];
  const why = [
    v.up ? el("li", { class: "pos" }, [el("strong", {}, `${v.up.name}:`), ` better by ${strokes(v.up.d)}`]) : null,
    v.down ? el("li", { class: "neg" }, [el("strong", {}, `${v.down.name}:`), ` worse by ${strokes(v.down.d)}`]) : null,
  ].filter(Boolean);
  const cmpBtn = el("button", { type: "button", class: "btn ghost small form-cmp" }, `Compare the last ${v.short.n} with the ${v.short.n} before →`);
  cmpBtn.addEventListener("click", () => go(`win:${v.short.n}`));
  // the full numbers, for whoever wants them
  const cell = (x) => el("td", { class: `num ${tone(x)} cmp-delta` }, x == null ? "—" : `${x > 0.004 ? "▲" : x < -0.004 ? "▼" : "◆"} ${Math.abs(x).toFixed(2)}`);
  const details = el("details", { class: "form-more" }, [
    el("summary", {}, "Show the numbers"),
    el("p", { class: "muted small" }, "Each row: their latest rounds against the same number just before. Before and Latest are strokes gained a round; the rest is the change (▲ better, ▼ worse). Tap a row to compare the two."),
    el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table cmp-traj-t" }, [
      el("thead", {}, el("tr", {}, ["Rounds", "Before", "Latest", "Change", ...Object.values(PLAIN)].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
      el("tbody", {}, tr.map((x) => {
        const row = el("tr", { class: "cmp-tap", tabindex: "0" }, [el("td", {}, `Last ${x.n} vs ${x.n} before`), el("td", { class: `num ${tone(x.prev)}` }, fmtSG(x.prev)), el("td", { class: `num ${tone(x.last)}` }, fmtSG(x.last)),
          ...["TOTAL", "OTT", "APP", "ARG", "PUTT"].map((k) => cell(x.ch[k]))]);
        row.addEventListener("click", () => go(`win:${x.n}`)); row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(`win:${x.n}`); });
        return row;
      })),
    ])),
  ]);
  return el("section", { class: "panel cmp-sec career-sec form-sec" }, [
    el("p", { class: "form-eyebrow" }, "Form"),
    el("div", { class: `form-verdict ${v.dir}` }, [el("span", { class: "form-icon", "aria-hidden": "true" }, icon), el("div", {}, [el("h2", {}, v.title), el("p", {}, v.line)])]),
    why.length ? el("div", { class: "form-why" }, [el("p", { class: "form-why-t" }, `Over the last ${v.short.n} rounds, against the ${v.short.n} before:`), el("ul", {}, why)]) : null,
    formChart(rs),
    el("div", { class: "form-foot" }, [cmpBtn]),
    details,
  ]);
}

function conditionsBlock(rs, go, ui, redraw) {
  const distinct = (f) => new Set(rs.map(f).filter(Boolean)).size;
  const dims = DIMENSIONS.filter(([d]) => d !== "tour" || distinct((rd) => rd.tour) > 1).filter(([d]) => d !== "course" || distinct((rd) => rd.course) > 1).filter(([d]) => d !== "round" || distinct((rd) => rd.roundNo) > 1);
  if (!dims.length) return null;
  if (!dims.some(([d]) => d === ui.dim)) ui.dim = dims[0][0];
  const dim = ui.dim;
  const list = conditions(rs, dim, 3);
  const tabs = el("div", { class: "cmp-seg small cmp-dims" }, dims.map(([d, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${dim === d ? " on" : ""}` }, l); b.addEventListener("click", () => { ui.dim = d; ui.all = false; redraw(); }); return b; }));
  const max = Math.max(0.05, ...list.map((x) => Math.abs(x.vsAll)));
  const pickOf = (x) => (["round", "course", "month", "year", "tour", "event"].includes(dim) ? `cond:${dim}:${dim === "round" ? x.label.replace("Round ", "") : dim === "month" ? MONTHS.indexOf(x.label) : x.label}` : null);
  // (update 196) one plain number: how much better or worse than their usual, with a bar
  const row = (x) => {
    const pick = pickOf(x), w = Math.abs(x.vsAll) / max * 50;
    const r = el(pick ? "button" : "div", { type: pick ? "button" : null, class: `cmp-cond cond-simple${pick ? " cmp-tap" : ""}`, title: pick ? "Compare it in detail" : null }, [
      el("span", { class: "cmp-cond-l" }, [x.label, el("span", { class: "muted" }, ` · ${x.n} rounds`)]),
      el("span", { class: "cmp-cond-bar" }, [el("span", { class: "mid" }), el("span", { class: `b ${x.vsAll >= 0 ? "pos" : "neg"}`, style: x.vsAll >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` })]),
      el("span", { class: `cmp-cond-d ${tone(x.vsAll)}` }, Math.abs(x.vsAll) < 0.05 ? "usual" : `${x.vsAll > 0 ? "+" : "−"}${Math.abs(x.vsAll).toFixed(1)}`),
    ]);
    if (pick) r.addEventListener("click", () => go(pick));
    return r;
  };
  const what = { round: "round", course: "course", event: "tournament", month: "month", year: "season", tour: "tour", field: "point in a run of events" }[dim] || "group";
  let summary = null;
  if (list.length >= 2) {
    const best = list[0], worst = list.at(-1);
    summary = el("p", { class: "cond-summary" }, [
      "Best ", what, ": ", el("strong", { class: "pos" }, best.label), best.vsAll >= 0.05 ? ` (${strokes(best.vsAll)} better than usual)` : "",
      ". Toughest: ", el("strong", { class: "neg" }, worst.label), worst.vsAll <= -0.05 ? ` (${strokes(worst.vsAll)} worse)` : "", ".",
    ]);
  }
  const showAll = ui.all || list.length <= 6;
  const shown = showAll ? list : [...list.slice(0, 3), null, ...list.slice(-3)];
  const more = !showAll ? el("button", { type: "button", class: "link cond-more" }, `Show all ${list.length}`) : null;
  more?.addEventListener("click", () => { ui.all = true; redraw(); });
  return el("section", { class: "panel cmp-sec career-sec" }, [
    secHead("Where they play their best", `Their rounds grouped by ${what}, best first. The number is strokes a round better (+) or worse (−) than their usual. Tap one to compare it.`),
    tabs,
    summary,
    list.length < 2 ? el("p", { class: "muted" }, list.length ? "Every round falls in the same group here, so there’s nothing to compare yet." : "Not enough rounds in any group yet (3 or more).")
      : el("div", { class: "cmp-conds" }, [el("div", { class: "cmp-cond cond-simple cmp-cond-h" }, [el("span", {}, ""), el("span", { class: "cmp-cond-bar-h" }, [el("span", {}, "worse"), el("span", {}, "usual"), el("span", {}, "better")]), el("span", {}, "vs usual")]),
        ...shown.map((x) => (x ? row(x) : el("div", { class: "cond-gap", "aria-hidden": "true" }, "⋯")))]),
    more,
  ]);
}
