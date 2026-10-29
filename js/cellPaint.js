/*
 * (update 365) Difference columns (headed Diff, Difference or Change) in the stats and compare tables: each green
 * (.pos) or red (.neg) number gets a green or red background, brighter the bigger it is against the rest of its column,
 * with white text. Nothing else is touched (trends and the values themselves keep their coloured text), and cells
 * that already have their own background (worked out in the page) are left as they are.
 */
const TABLES = "table"; // (any table: only its Diff / Difference / Change columns are painted)
const num = (t) => { const m = String(t || "").replace(/[−–]/g, "-").replace(/[▲▼◆+,%]/g, "").match(/-?\d+(\.\d+)?/); return m ? Math.abs(Number(m[0])) : null; };

function paintTable(table) {
  // which columns are differences, from the header
  const heads = [...(table.querySelector("thead tr")?.children || [])];
  const diffCols = new Set(heads.map((th, i) => (/^(diff|difference|change)$/i.test(th.textContent.trim()) ? i : -1)).filter((i) => i >= 0));
  if (!diffCols.size) return;
  const cols = new Map(); // column index -> [{ td, v }]
  for (const tr of table.querySelectorAll("tbody tr")) {
    if (tr.children.length !== heads.length) continue; // (a heading row across the table)
    [...tr.children].forEach((td, i) => {
      if (!diffCols.has(i) || td.tagName !== "TD" || !(td.classList.contains("pos") || td.classList.contains("neg"))) return;
      if (td.style.background || td.dataset.painted === "own") return;
      const v = num(td.textContent);
      if (v == null) return;
      (cols.get(i) || cols.set(i, []).get(i)).push({ td, v });
    });
  }
  for (const list of cols.values()) {
    const max = Math.max(...list.map((x) => x.v), 1e-9);
    for (const { td, v } of list) {
      const t = Math.min(1, v / max), up = td.classList.contains("pos");
      td.style.background = `rgba(${up ? "48,209,88" : "255,69,58"},${((up ? 0.06 : 0.05) + (up ? 0.32 : 0.28) * t).toFixed(3)})`;
      td.style.color = "#fff";
      td.dataset.painted = "1";
    }
  }
}

// (update 387) with a part of the game opened in a table, the other parts of the game lose their colours (so the open
// one and its distances stand out); closing it brings them back
function muteOthers(table) {
  const tops = [...table.querySelectorAll("tbody > tr[aria-expanded]")].filter((tr) => !tr.classList.contains("cmp-deep") && !tr.closest(".bs-st-det"));
  const anyOpen = tops.some((tr) => tr.getAttribute("aria-expanded") === "true");
  for (const tr of tops) tr.classList.toggle("row-muted", anyOpen && tr.getAttribute("aria-expanded") !== "true");
}
let queued = false;
function paintAll() { queued = false; document.querySelectorAll(TABLES).forEach((t) => { paintTable(t); muteOthers(t); }); }
/** Watch the page: whenever a table is drawn or redrawn, paint its coloured cells. */
export function startCellPaint() {
  const obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(paintAll); } });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded"] }); // (update 387: and rows opening in place)
  paintAll();
}
