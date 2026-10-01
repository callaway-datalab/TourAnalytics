// "Your rounds" table at the top of Entered Rounds: the four most recent show, the rest scroll.
// Each row opens the round; Delete removes it (after a confirm).
import { el, mount, confirmAction } from "./ui.js";
import { deleteRound } from "./rounds.js";
import { holeScore } from "./roundCalc.js";

const toPar = (n) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));

export function myRoundsTable(rounds, { flash, canDelete = () => true, title = "Your rounds" } = {}) {
  if (!rounds.length) return null;
  const rows = rounds.map((r) => {
    let score = 0, thru = 0, parThru = 0;
    for (const h of r.holes || []) {
      const hs = holeScore(r.shots?.[`h${h.n}`]);
      if (hs.done) { score += hs.strokes; thru++; parThru += h.par; }
    }
    const done = r.status === "complete";
    const href = `#/entry/${encodeURIComponent(r.playerKey)}/${r.id}`;
    const del = canDelete(r) ? el("button", { type: "button", class: "link danger", "aria-label": `Delete ${r.course || "round"} on ${r.date}` }, "Delete") : null;
    del?.addEventListener("click", async () => {
      if (!confirmAction(`Delete your round at ${r.course || "this course"} on ${r.date}, and every shot in it? This can't be undone.`)) return;
      del.disabled = true;
      try { await deleteRound(r.playerKey, r.id); flash?.("Round deleted.", "ok"); }
      catch { flash?.("Couldn't delete that round.", "error"); del.disabled = false; }
    });
    return el("tr", {}, [
      el("td", { class: "nowrap" }, r.date || "\u2014"),
      el("td", {}, [el("a", { href }, r.course || "Round"), r.type ? el("div", { class: "muted small" }, r.type === "tournament" ? "Tournament" : "Practice") : null]),
      el("td", { class: "num nowrap" }, thru ? `${score} (${toPar(score - parThru)})` : "\u2014"),
      el("td", { class: "muted nowrap" }, done ? "Complete" : thru ? `Thru ${thru}` : "Not started"),
      el("td", { class: "actions" }, del),
    ]);
  });
  return el("section", { class: "panel sg-box my-rounds" }, [
    el("h3", {}, `${title} (${rounds.length})`),
    el("div", { class: "table-scroll four-rows" }, el("table", { class: "plain stats" }, [
      el("thead", {}, el("tr", {}, ["Date", "Course", "Score", "Status", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows),
    ])),
  ]);
}
