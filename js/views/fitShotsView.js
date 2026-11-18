// (update 862) The shot files' read of a course, shared by Course Fit (a tournament opened) and Course Insights:
// why the Top 10 win there (better shots, or more of them), where (a few holes or all over, and the blow-up holes), and, for a
// player, their misses from every course on record and what those misses are worth there. Strokes per round throughout.
import { el } from "../ui.js";
import { whyTopWin, whereTopWin, missWords, CAT_NAMES } from "../courseFitShots.js";

const sg2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const cls = (v) => (v >= 0.005 ? "pos" : v <= -0.005 ? "neg" : "");
const lb = (b) => String(b).replace(/^\w+\|/, ""), possOf = (n) => `${n}\u2019${/s$/i.test(n) ? "" : "s"}`;

/** meta: the course's record (with .fit); opts: { prof (missProfile), mf (missFit), who ("you" | a name), self, fitNote } */
export function fitShotsBlock(meta, { prof = null, mf = null, who = null, self = false } = {}) {
  const F = meta.fit, W = whyTopWin(F), H = whereTopWin(F), kids = [];
  const Who = self ? "You" : who, poss = self ? "your" : who ? possOf(who) : "";
  // 1. why the Top 10 win: better at the same shots, or more of them
  if (W?.parts.length) {
    const top = W.parts.filter((p) => p.gap > 0.05).slice(0, 3);
    kids.push(el("div", { class: "fs-blk" }, [el("h4", {}, "Why the top 10 win here"),
      el("ul", { class: "fs-ul" }, [
        ...top.map((p) => { const b = Math.max(0, p.better), m = p.more, mostly = Math.abs(m) < 0.25 * Math.abs(p.gap) ? "mostly better shots" : b < 0.5 * p.gap ? "mostly more of the shots that matter" : "both";
          return el("li", {}, [el("b", {}, `${CAT_NAMES[p.cat]}: ${sg2(p.gap)} a round`), ` over the rest of the field — ${sg2(p.better)} from hitting the same shots better, ${sg2(p.more)} from ${p.more >= 0 ? "facing more" : "facing fewer"} of them (${mostly})`]); }),
        W.faced.length ? el("li", {}, `They face different shots: ${W.faced.map((x) => `${Math.abs(x.aT - x.aR).toFixed(1)} ${x.aT > x.aR ? "more" : "fewer"} from ${lb(x.b)}`).join(", ")} a round than the rest (the shot before set them up${W.parts.find((p) => p.cat === "OTT" && p.gap > 0.1) ? ": they drive it better here" : ""})`) : null,
      ]),
      el("p", { class: "fs-note" }, "Better: strokes gained a shot, at the rest's number of attempts. More: attempts a round, at strokes gained a shot. Together they make the top 10's edge in that part.")]));
  }
  // 2. where: a few holes or everywhere, and the blow-up holes
  if (H) {
    const t3 = H.top3.filter((x) => x.edge > 0);
    kids.push(el("div", { class: "fs-blk" }, [el("h4", {}, "Where they win it"),
      el("ul", { class: "fs-ul" }, [
        t3.length ? el("li", {}, H.even ? `All over the course: the three biggest holes (${t3.map((x) => `No. ${x.h}`).join(", ")}) hold only ${Math.round(H.conc * 100)}% of the top 10's edge` : [el("b", {}, `${Math.round(H.conc * 100)}% of the top 10's edge comes from three holes: `), t3.map((x) => `No. ${x.h} (par ${x.par}, ${x.edge.toFixed(2)} a round better than the rest)`).join(", ")]) : null,
        ...H.blowups.map((x) => el("li", {}, [el("b", {}, `Blow-up hole No. ${x.h} (par ${x.par}): `), `${Math.round(x.dbl * 100)}% doubles or worse (top 10 ${Math.round(x.dblTop * 100)}%, the rest ${Math.round(x.dblRest * 100)}%), costing the field ${x.blow.toFixed(2)} a round beyond a bogey`])),
        !H.blowups.length ? el("li", {}, "No blow-up holes: no hole has 6% or more doubles or worse") : null,
      ])]));
  }
  // 3. the player: their misses, and what they're worth here
  if (prof && mf) {
    const worst = mf.holes.filter((x) => x.cost > 0.02).slice(0, 3), best = [...mf.holes].reverse().filter((x) => x.cost < -0.02).slice(0, 2);
    kids.push(el("div", { class: "fs-blk fs-me" }, [el("h4", {}, `${self ? "Your" : possOf(who)} misses here`),
      el("ul", { class: "fs-ul" }, [
        ...missWords(prof, Who || "They").map((t) => el("li", { class: "fs-m" }, t)),
        el("li", {}, [el("b", {}, `What ${poss} misses are worth here: `), el("span", { class: cls(mf.total) }, sg2(mf.total)), ` a round against an average player (off the tee ${sg2(mf.tee)}, approaches ${sg2(mf.app)}${mf.ratio != null ? `, blow-ups ${sg2(mf.blow)}` : ""})`]),
        ...worst.map((x) => el("li", {}, [el("b", {}, `No. ${x.h}: `), el("span", { class: "neg" }, sg2(-x.cost)), x.why.length ? ` — ${x.why.join("; ")}` : ""])),
        mf.without && mf.without.cost >= 0.05 ? el("li", {}, [el("b", {}, `Avoid trouble on No. ${mf.without.h}: `), `the rest of the course is worth ${sg2(mf.without.total)} a round to ${poss} misses${mf.total < 0 && mf.without.total >= 0 ? ": the one hole that makes it a poor fit" : ""}`]) : null,
        ...best.map((x) => el("li", {}, [el("b", {}, `No. ${x.h}: `), el("span", { class: "pos" }, sg2(-x.cost)), " — suits their misses"])),
      ]),
      el("p", { class: "fs-note" }, `Misses from every course with shot data (${prof.courses} course${prof.courses === 1 ? "" : "s"}), pulled toward the field's when there are few. Worth here: which way ${self ? "you miss" : "they miss"}, not how often (that's ${self ? "your" : "their"} driving and approach play, already in the parts of the game): at the field's miss rate on each hole, ${self ? "your" : "their"} split of the misses (left against right off the tee; short, long, left, right on the approach) against the field's, times what each side costs there. Blow-ups: ${self ? "your" : "their"} doubles or worse against the field's, where this course's cost more or less than a usual course's.`)]));
  } else if (prof) kids.push(el("div", { class: "fs-blk fs-me" }, [el("h4", {}, `${self ? "Your" : possOf(who)} misses`), el("ul", { class: "fs-ul" }, missWords(prof, Who || "They").map((t) => el("li", {}, t)))]));
  return kids.length ? el("div", { class: "fs" }, kids) : null;
}
