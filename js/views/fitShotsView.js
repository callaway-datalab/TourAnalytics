// (update 862) The shot files' read of a course, shared by Course Fit (a tournament opened) and Course Insights:
// why the Top 10 win there (better shots, or more of them), where (a few holes or all over, and the blow-up holes), and, for a
// player, their misses from every course on record and what those misses are worth there. Strokes per round throughout.
import { el } from "../ui.js";
import { whyTopWin, whereTopWin, missWords, CAT_NAMES } from "../courseFitShots.js";

const sg2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const cls = (v) => (v >= 0.005 ? "pos" : v <= -0.005 ? "neg" : "");
const lb = (b) => String(b).replace(/^\w+\|/, ""), possOf = (n) => `${n}\u2019${/s$/i.test(n) ? "" : "s"}`;

// (update 953) plain words: what a shift in the shots they face means on the course, not the distance buckets themselves
const DOING = { OTT: "driving it better", APP: "hitting better approach shots", ARG: "chipping and pitching better", PUTT: "putting better" };
const nums = (b) => (String(b).match(/\d+/g) || []).map(Number);
function facedWords(x) {
  const n = Math.abs(x.aT - x.aR), more = x.aT > x.aR, d = lb(x.b), ns = nums(d), hi = d.startsWith(">") ? Infinity : Math.max(...ns, 0), lo = d.startsWith("<") ? 0 : Math.min(...ns);
  const amt = `${n.toFixed(1)} ${more ? "more" : "fewer"} a round`;
  if (x.cat === "PUTT") {
    if (hi <= 5) return more ? `more short putts left (${amt} from ${d}): their chips and long putts finish closer to the hole` : `fewer short putts left to tidy up (${amt} from ${d}): they hole more of their longer putts first`;
    if (lo >= 20) return more ? `more long putts (${amt} from ${d}): they hit more greens, but from farther away` : `fewer long putts (${amt} from ${d}): their approach shots finish closer to the hole`;
    return more ? `more mid-length putts (${amt} from ${d}): their approaches finish closer` : `fewer mid-length putts (${amt} from ${d}): they hit it closer, or hole more from farther away`;
  }
  if (x.cat === "ARG") return more ? `more chips and pitches (${amt} from ${d}): they miss more greens, often from going for them` : `fewer chips and pitches (${amt} from ${d}): they hit more greens`;
  if (x.cat === "APP") {
    if (lo >= 180) return more ? `more long approach shots (${amt} from ${d}): going for greens in two, or shorter drives` : `fewer long approach shots (${amt} from ${d}): they drive it farther, so they come in with shorter clubs`;
    if (hi <= 120) return more ? `more short approach shots (${amt} from ${d}): longer drives leave them wedges in` : `fewer short approach shots (${amt} from ${d})`;
    return `${more ? "more" : "fewer"} approach shots from ${d} (${amt})`;
  }
  return `${amt} shots from ${d}`;
}
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
          // (update 953) plain words: how much they gain, and how: hitting the shots better, or the shots they get to play
          const how = mostly === "mostly better shots" ? `mostly by ${DOING[p.cat]} (${sg2(p.better)})` : mostly === "both" ? `by ${DOING[p.cat]} (${sg2(p.better)}) and from the shots they get to play (${sg2(p.more)})` : `mostly from the shots they get to play (${sg2(p.more)}), more than by ${DOING[p.cat]} (${sg2(p.better)})`;
          return el("li", {}, [el("b", {}, `${CAT_NAMES[p.cat]}: the top 10 gain ${p.gap.toFixed(2)} strokes a round on the rest of the field`), `, ${how}`]); }),
        W.faced.length ? el("li", {}, [el("b", {}, "Compared with the rest, the top 10 have: "), el("ul", { class: "fs-ul fs-sub" }, W.faced.map((x) => el("li", {}, facedWords(x))))]) : null,
      ]),
      el("p", { class: "fs-note" }, "Strokes a round. \u201cBetter\u201d: what they gain hitting the same shots better. \u201cThe shots they get to play\u201d: what they gain from easier shots, such as shorter approaches after longer drives, or fewer chips because they hit more greens.")]));
  }
  // 2. where: a few holes or everywhere, and the blow-up holes
  if (H) {
    const t3 = H.top3.filter((x) => x.edge > 0);
    kids.push(el("div", { class: "fs-blk" }, [el("h4", {}, "Where they win it"),
      el("ul", { class: "fs-ul" }, [
        t3.length ? el("li", {}, H.even ? `All over the course: even the three holes where they gain most (${t3.map((x) => `No. ${x.h}`).join(", ")}) are only ${Math.round(H.conc * 100)}% of the top 10's edge` : [el("b", {}, `${Math.round(H.conc * 100)}% of the top 10's edge comes from three holes: `), t3.map((x) => `No. ${x.h} (par ${x.par}, where they score ${x.edge.toFixed(2)} strokes better than the rest)`).join(", ")]) : null,
        ...H.blowups.map((x) => el("li", {}, [el("b", {}, `Blow-up hole No. ${x.h} (par ${x.par}): `), `${Math.round(x.dbl * 100)}% of scores are double bogey or worse (top 10: ${Math.round(x.dblTop * 100)}%, everyone else: ${Math.round(x.dblRest * 100)}%): those cost the field ${x.blow.toFixed(2)} strokes a round more than if they'd been bogeys`])),
        !H.blowups.length ? el("li", {}, "No blow-up holes: no hole has 6% or more doubles or worse") : null,
      ])]));
  }
  // 3. the player: their misses, and what they're worth here
  if (prof && mf) {
    const worst = mf.holes.filter((x) => x.cost > 0.02).slice(0, 3), best = [...mf.holes].reverse().filter((x) => x.cost < -0.02).slice(0, 2);
    kids.push(el("div", { class: "fs-blk fs-me" }, [el("h4", {}, `${self ? "Your" : possOf(who)} misses here`),
      el("ul", { class: "fs-ul" }, [
        ...missWords(prof, Who || "They").map((t) => el("li", { class: "fs-m" }, t)),
        el("li", {}, [el("b", {}, `How ${poss} usual misses play here: `), el("span", { class: cls(mf.total) }, sg2(mf.total)), ` strokes a round compared with an average player (off the tee ${sg2(mf.tee)}, approaches ${sg2(mf.app)}${mf.ratio != null ? `, big numbers ${sg2(mf.blow)}` : ""})`]),
        ...worst.map((x) => el("li", {}, [el("b", {}, `No. ${x.h}: `), el("span", { class: "neg" }, sg2(-x.cost)), x.why.length ? ` — ${x.why.join("; ")}` : ""])),
        mf.without && mf.without.cost >= 0.05 ? el("li", {}, [el("b", {}, `No. ${mf.without.h} is the hole to watch: `), `without it, ${poss} misses would ${mf.without.total >= 0 ? "gain" : "cost"} ${Math.abs(mf.without.total).toFixed(2)} strokes a round here${mf.total < 0 && mf.without.total >= 0 ? ": it's the one hole that makes this a poor fit" : ""}`]) : null,
        ...best.map((x) => el("li", {}, [el("b", {}, `No. ${x.h}: `), el("span", { class: "pos" }, sg2(-x.cost)), " — suits their misses"])),
      ]),
      el("p", { class: "fs-note" }, `Based on where ${self ? "you" : "they"} miss on every course with shot data (${prof.courses} course${prof.courses === 1 ? "" : "s"}; closer to an average player's when there are few). This is about which way ${self ? "you miss" : "they miss"}, not how often (that's already in ${self ? "your" : "their"} driving and approach numbers): on each hole here, what ${self ? "your" : "their"} usual misses (left or right off the tee; short, long, left or right of the green) would cost, compared with an average player's. Big numbers: ${self ? "your" : "their"} double bogeys or worse, where this course punishes them more or less than usual.`)]));
  } else if (prof) kids.push(el("div", { class: "fs-blk fs-me" }, [el("h4", {}, `${self ? "Your" : possOf(who)} misses`), el("ul", { class: "fs-ul" }, missWords(prof, Who || "They").map((t) => el("li", {}, t)))]));
  return kids.length ? el("div", { class: "fs" }, kids) : null;
}
