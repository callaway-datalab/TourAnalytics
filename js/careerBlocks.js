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

export function careerBlocks(rounds, { key = null, source = "tour", ui = {}, redraw = () => {}, only = null } = {}) {
  const rs = sgRounds(rounds || []);
  if (rs.length < 6) return [];
  const go = (pick) => { location.hash = compareLink(key, source, pick); };
  // (update 205) only: "trajectory" (right under the hero card) or "conditions" (at the bottom)
  return [only !== "conditions" ? trajectoryBlock(rs, go) : null, only !== "trajectory" ? conditionsBlock(rs, go, ui, redraw) : null].filter(Boolean);
}

function trajectoryBlock(rs, go) {
  const tr = trajectory(rs);
  if (!tr.length) return null;
  const cell = (v) => el("td", { class: `num ${tone(v)} cmp-delta` }, v == null ? "—" : `${v > 0.004 ? "▲" : v < -0.004 ? "▼" : "◆"} ${Math.abs(v).toFixed(2)}`);
  return el("section", { class: "panel cmp-sec cmp-traj career-sec" }, [
    secHead("Getting better or worse?", "Their latest rounds against the same number just before, at several time scales. Tap a row to compare the two."),
    el("p", { class: "cmp-traj-words" }, trajectoryWords(tr)),
    el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table cmp-traj-t" }, [
      // (update 205) just the change in each category (no Before / Latest / Change columns)
      el("thead", {}, el("tr", {}, ["Time scale", ...SG_ROWS.slice(1, 5).map(([k]) => k)].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
      el("tbody", {}, tr.map((x) => {
        const row = el("tr", { class: "cmp-tap", tabindex: "0", title: `Compare the last ${x.n} with the ${x.n} before` }, [
          el("td", {}, `Last ${x.n} vs ${x.n} before`),
          ...SG_ROWS.slice(1, 5).map(([k]) => cell(x.ch[k]))]);
        row.addEventListener("click", () => go(`win:${x.n}`)); row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(`win:${x.n}`); });
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
    const row = el(pick ? "button" : "div", { type: pick ? "button" : null, class: `cmp-cond${pick ? " cmp-tap" : ""}`, title: pick ? "Look at it in Deep Dives" : null }, [
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
