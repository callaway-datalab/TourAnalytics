// (update 194) "Getting better or worse?" and "Where they play their best": a player's whole career, at the
// bottom of the Stats page (they were on Comparisons until now). Tapping a row opens Comparisons with it.
//   careerBlocks(rounds, { key, source, ui }) → a list of page sections (or [] when there's too little to say)
//   ui: an object kept between redraws (which grouping tab is open).
import { el } from "./ui.js";
import { fmtSG } from "./sg.js";
import { trajectory, conditions, DIMENSIONS, fmtSigned, SG_ROWS, sgRounds } from "./compareData.js";
import { openBadge } from "./badgePopup.js";

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

export function careerBlocks(rounds, { key = null, source = "tour", ui = {}, redraw = () => {}, only = null, cols = null } = {}) {
  const rs = sgRounds(rounds || []);
  if (rs.length < 6) return [];
  const go = (pick) => { location.hash = compareLink(key, source, pick); };
  // (update 205) only: "trajectory" (right under the hero card) or "conditions" (at the bottom)
  return [only !== "conditions" ? trajectoryBlock(rs, cols) : null, only !== "trajectory" ? conditionsBlock(rs, go, ui, redraw) : null].filter(Boolean);
}

// (update 218) just the last 10 against the 10 before, and the last 40 against the 40 before; tapping one opens its
// rounds (a bar chart, the two stretches highlighted, each one's average dashed) and the change in each category
const sgOfRd = (rd, k = "TOTAL") => rd.shots.reduce((t, x) => t + (k === "TOTAL" || x.cat === k || (k === "T2G" && x.cat !== "PUTT") || (k.startsWith("d:") && x.dist === k.slice(2)) ? x.sg : 0), 0);
// (update 283) the table's columns: [key, heading, name in the pop-up] (Total and the four categories, unless the filters say otherwise)
const DEFAULT_COLS = SG_ROWS.slice(0, 5).map(([k, l]) => [k, k === "TOTAL" ? "Total" : k, k === "TOTAL" ? "SG: Total" : l]);
const changeOf = (rs, n, cols) => { const last = rs.slice(-n), prev = rs.slice(-2 * n, -n), avg = (xs, k) => xs.reduce((t, rd) => t + sgOfRd(rd, k), 0) / xs.length; return Object.fromEntries(cols.map(([k]) => [k, avg(last, k) - avg(prev, k)])); };
const dShort = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : String(d || ""); };
function openTrajectory(rs, x, cols = DEFAULT_COLS) {
  const n = x.n, show = rs.slice(-2 * n), prev = show.slice(0, n), last = show.slice(n);
  const avg = (xs, k) => xs.reduce((t, rd) => t + sgOfRd(rd, k), 0) / xs.length;
  openBadge({ text: `Last ${n} rounds vs the ${n} before`, info: () => ({
    sub: `Strokes gained in each round: the ${n} before in grey, the last ${n} in colour, each stretch\u2019s average dashed.`,
    blocks: [
      { kind: "bars", fmt: "sg", items: show.map((rd, i) => ({ label: dShort(rd.date), sub: [rd.event, rd.roundNo ? `R${rd.roundNo}` : ""].filter(Boolean).join(" \u00b7 "), v: sgOfRd(rd), on: i >= n })), ref: [{ v: avg(prev, "TOTAL"), label: `Before`, from: 0, to: n }, { v: avg(last, "TOTAL"), label: `Last ${n}`, from: n, to: 2 * n }] },
      { kind: "table", title: "By category (a round)", cols: [["Category"], [`Previous ${n}`, "num"], [`Last ${n}`, "num"], ["Change", "num"]],
        rows: cols.map(([k, , l]) => ({ strong: k === "TOTAL", cells: [l, { sg: avg(prev, k) }, { sg: avg(last, k) }, { sg: avg(last, k) - avg(prev, k), arrow: true }] })) },
    ] }) }, "Getting better or worse?");
}
// (update 281) the summary in long-term (last 40 vs the 40 before) and short-term (last 10 vs the 10 before) words
function termWords(tr) {
  // (update 282) "Up over the long-term; Down over the short-term"
  const word = (x) => (x.ch.TOTAL > 0.15 ? "Up" : x.ch.TOTAL < -0.15 ? "Down" : "Steady");
  const lt = tr.find((x) => x.n === 40), st = tr.find((x) => x.n === 10);
  if (lt && st) return word(lt) === word(st) ? `${word(lt)} over both the long-term and the short-term.` : `${word(lt)} over the long-term; ${word(st)} over the short-term.`;
  const one = lt || st;
  return `${word(one)} over the ${one === lt ? "long" : "short"}-term.`;
}
function trajectoryBlock(rs, cols0) {
  const cols = cols0 || DEFAULT_COLS;
  const tr = trajectory(rs).filter((x) => x.n === 10 || x.n === 40).map((x) => ({ ...x, ch: { ...x.ch, ...changeOf(rs, x.n, cols) } }));
  if (!tr.length) return null;
  const cell = (v, strong = false) => el("td", { class: `num ${tone(v)} cmp-delta${strong ? " strong" : ""}` }, v == null ? "—" : `${v > 0.004 ? "▲" : v < -0.004 ? "▼" : "◆"}\u00a0${Math.abs(v).toFixed(2)}`);
  return el("section", { class: "panel cmp-sec cmp-traj career-sec" }, [
    secHead("Getting better or worse?", "Their latest rounds against the same number just before. Tap a row to see the rounds."),
    el("p", { class: "cmp-traj-words" }, termWords(tr)),
    el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table cmp-traj-t" }, [
      // (update 205) just the change in each category (no Before / Latest / Change columns)
      el("thead", {}, el("tr", {}, ["Rounds", ...cols.map(([, h]) => h)].map((h, i) => el("th", { class: i ? "num" : "" }, h)))), // (update 208: Total back, first; update 283: the filters' columns)
      el("tbody", {}, tr.map((x) => {
        const row = el("tr", { class: "cmp-tap", tabindex: "0", title: `See the last ${x.n} and the ${x.n} before`, "aria-haspopup": "dialog" }, [
          el("td", {}, `Last ${x.n} vs ${x.n} before`),
          ...cols.map(([k]) => cell(x.ch[k], k === "TOTAL"))]);
        row.addEventListener("click", () => openTrajectory(rs, x, cols)); row.addEventListener("keydown", (e) => { if (e.key === "Enter") openTrajectory(rs, x, cols); });
        return row;
      })),
    ])),
  ]);
}

function conditionsBlock(rs, go, ui, redraw) {
  const distinct = (f) => new Set(rs.map(f).filter(Boolean)).size;
  const dims = DIMENSIONS.filter(([d]) => d !== "tour" || distinct((rd) => rd.tour) > 1).filter(([d]) => d !== "course" || distinct((rd) => rd.course) > 1).filter(([d]) => d !== "round" || distinct((rd) => rd.roundNo) > 1);
  if (!dims.length) return null;
  if (!dims.some(([d]) => d === ui.dim)) ui.dim = dims[0][0];
  const dim = ui.dim;
  const list = conditions(rs, dim, 3);
  const tabs = el("div", { class: "cmp-seg small cmp-dims" }, dims.map(([d, l]) => { const b = el("button", { type: "button", class: `cmp-seg-b${dim === d ? " on" : ""}` }, l); b.addEventListener("click", () => { ui.dim = d; redraw(); }); return b; }));
  const max = Math.max(0.05, ...list.map((x) => Math.abs(x.vsAll)));
  const pickOf = (x) => (["round", "course", "month", "year", "tour", "event"].includes(dim) ? `cond:${dim}:${dim === "round" ? x.label.replace("Round ", "") : dim === "month" ? MONTHS.indexOf(x.label) : x.label}` : null);
  const rows = list.map((x, j) => {
    const pick = pickOf(x);
    const w = Math.abs(x.vsAll) / max * 50;
    const row = el(pick ? "button" : "div", { type: pick ? "button" : null, class: `cmp-cond${pick ? " cmp-tap" : ""}`, title: pick ? "Look at it in Compare" : null }, [
      el("span", { class: "cmp-cond-rank" }, String(j + 1)),
      el("span", { class: "cmp-cond-l" }, [x.label, el("span", { class: "muted" }, ` · ${x.n} rds`)]),
      el("span", { class: "cmp-cond-bar" }, [el("span", { class: "mid" }), el("span", { class: `b ${x.vsAll >= 0 ? "pos" : "neg"}`, style: x.vsAll >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` })]),
      el("strong", { class: `cmp-cond-v ${tone(x.v)}` }, fmtSG(x.v)),
      el("span", { class: `cmp-cond-d ${tone(x.vsAll)}` }, fmtSigned(x.vsAll)),
    ]);
    if (pick) row.addEventListener("click", () => go(pick));
    return row;
  });
  return el("section", { class: "panel cmp-sec career-sec" }, [
    secHead("Where they play their best", "Every round grouped by one condition, best first: SG: Total a round, and how far above or below their overall average. Tap one to compare it."),
    tabs,
    rows.length === 1 ? el("p", { class: "muted" }, "Every round falls in the same group here, so there’s nothing to compare yet.") : rows.length ? el("div", { class: "cmp-conds" }, [el("div", { class: "cmp-cond cmp-cond-h" }, [el("span", {}, "#"), el("span", {}, ""), el("span", { class: "cmp-cond-bar-h" }, [el("span", {}, "worse"), el("span", {}, "their average"), el("span", {}, "better")]), el("span", {}, "SG"), el("span", {}, "vs avg")]), ...rows])
      : el("p", { class: "muted" }, "Not enough rounds in any group yet (3 or more)."),
  ]);
}
