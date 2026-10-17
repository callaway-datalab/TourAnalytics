// (update 197) Plain words, shared by every page.
// (update 200) Strokes gained is described as itself ("gaining 1.2 strokes a round"), never as "better than the
// average tour player": the only comparison made is with the real field average of the players in the data.
import { el } from "./ui.js";

/** A difference between two real things: "1.2 strokes a round better" / "0.3 strokes a round worse" / "about even" */
export function strokesWords(v, { dp = 1, per = "a round" } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v).toFixed(dp);
  if (Number(a) === 0) return "about even";
  return `${a} stroke${a === (1).toFixed(dp) ? "" : "s"} ${per} ${v > 0 ? "better" : "worse"}`;
}

/** A strokes-gained number in words: "gaining 1.2 strokes a round" / "losing 0.3 strokes a round" / "breaking even" */
export function sgWords(v, { dp = 1, cap = false } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v).toFixed(dp);
  const t = Number(a) === 0 ? "breaking even" : `${v > 0 ? "gaining" : "losing"} ${a} stroke${a === (1).toFixed(dp) ? "" : "s"} a round`;
  return cap ? t[0].toUpperCase() + t.slice(1) : t;
}

/** The real field average of the players in the data on screen: "Field average here: +0.15 (18 players)." */
export const fieldLine = (avg, n) => (avg == null || !Number.isFinite(avg) || n < 3 ? "" : `Field average here: ${avg >= 0 ? "+" : "−"}${Math.abs(avg).toFixed(2)} (${n} players).`);

/** A small "What does this mean?" link that opens a short explanation of strokes gained, in place. */
export function sgHelp(label = "What does this mean?") {
  const box = el("div", { class: "sg-explain", hidden: true }, [
    el("p", {}, [el("strong", {}, "Strokes gained"), " scores every shot against the baseline in the data: the number of strokes expected from that distance and lie."]),
    el("ul", {}, [
      el("li", {}, [el("strong", { class: "pos" }, "+1.0"), " a round = gaining one stroke a round."]),
      el("li", {}, [el("strong", { class: "neg" }, "−1.0"), " a round = losing one stroke a round."]),
      el("li", {}, "The four parts of the game add up to the total: Tee Shots, Approach, Short Game and Putting."),
    ]),
  ]);
  const btn = el("button", { type: "button", class: "sg-help-btn", "aria-expanded": "false" }, [el("span", { class: "sg-help-i", "aria-hidden": "true" }, "i"), label]);
  btn.addEventListener("click", (e) => { e.stopPropagation(); box.hidden = !box.hidden; btn.setAttribute("aria-expanded", String(!box.hidden)); });
  return el("div", { class: "sg-help" }, [btn, box]);
}
