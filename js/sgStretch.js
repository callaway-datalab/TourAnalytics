// (sgDashboard split) Best stretches and Elite Round Share: the ladder, the stretch popup and the profile line.
// Each function takes S first: the Stats page's state and helpers (see sgDashboard.js), read live.
import { CATEGORIES, LEVELS, MIX_CAUSE, bucketsOf, distLead, el, gearInfo, gearList, groupSplit, kv, mixLead, mixWords, sgn2, splitOf } from "./sgShared.js";

// (update 308) who the gold dots on the charts are, matching the comparison picked above the stats table:
//   Personal Peak: the player's own best run of rounds (the same rounds as the table's "Vs best N rds");
//   #1 / #10 / #25 / #50: that one player (the same golfer the table's "VS #N" uses), not an average of a group;
//   All: every ranked player's average
export function topPlayers(S, list) {
  if (S.soloTour) return []; // (update 307: Practice or a typed-in tour: no comparisons)
  // (update 330) the dots are the selected stretch (Best Stretches above the stats table); nothing selected: no dots
  if (S.st.vsRank === "peak" && S.isSG()) { const pk = S.curPeak(); return pk && !pk.short ? [{ key: "__peak", label: "Elite rounds", rounds: pk.rounds }] : []; }
  void list;
  return [];
}
/** (update 315) The player ranked #n in this selection by the strokes gained on screen (SG: Total, or the one category
 *  picked: the #1 putter on Putting), the player on screen included: when they're #1, #1 is them. Table and dots alike. */
export function refPlayer(S, slicedField, n, cat = S.peakCtx?.cat || "") {
  const byTot = S.rankedField(slicedField).map((p) => ({ p, t: S.rowVals(p.rounds, cat).get(cat ? "sg" : "c:TOTAL") }))
    .filter((x) => x.t != null && Number.isFinite(x.t)).sort((a, b) => b.t - a.t);
  return byTot.length ? byTot[Math.min(n, byTot.length) - 1].p : null;
}
/** The player's best run of N rounds in a row (Peak Length), by the strokes gained the filters are about. */
export function peakOf(S, rounds, cat, peakN) {
  const ordered = [...rounds].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const scored = ordered.map((rd) => { let t = 0, any = false; for (const x of rd.shots) if (!cat || x.cat === cat) { t += x.sg; any = true; } return { rd, t, any }; }).filter((x) => x.any);
  if (scored.length < peakN) return { map: new Map(), rounds: [], short: true, have: scored.length };
  // (update 299) the best stretch of N rounds in a row (oldest first), by the filters' total
  const seq = [...scored].sort((x, y) => String(x.rd.date || "").localeCompare(String(y.rd.date || "")));
  let sum = 0, bestSum = -Infinity, bestAt = 0;
  seq.forEach((x, i) => { sum += x.t; if (i >= peakN) sum -= seq[i - peakN].t; if (i >= peakN - 1 && sum > bestSum) { bestSum = sum; bestAt = i - peakN + 1; } });
  const best = seq.slice(bestAt, bestAt + peakN).map((x) => x.rd);
  return { map: S.rowVals(best, cat), rounds: best, short: false };
}
/** (update 335) Elite rounds: the player's best n rounds by the strokes gained the filters are about, in any order
 *  (oldest first, as everywhere). */
export function eliteOf(S, rounds, cat, n) {
  const scored = S.stretchSeq(rounds, cat);
  if (scored.length < n) return { map: new Map(), rounds: [], short: true, have: scored.length };
  const best = [...scored].sort((a, b) => b.t - a.t).slice(0, n).map((x) => x.rd).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  return { map: S.rowVals(best, cat), rounds: best, short: false, elite: true };
}
// (update 322) the peak's dates as a filter: the page shows just those rounds (from the top); a chip clears it
export function setRange(S, r) {
  if (!r?.from || !r?.to) return;
  S.st.dateRange = r;
  const ys = [...new Set([r.from.slice(0, 4), r.to.slice(0, 4)])];
  S.st.year = ys; S.st.yearKept = ys; S.st.span = 0;
  S.draw();
  setTimeout(() => { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); } }, 80); // (after the redraw puts your place back)
}
export function rangeChip(S) {
  if (!S.st.dateRange) return null;
  const b = el("button", { type: "button", class: "range-chip", title: "Show every date again" }, [`Dates: ${S.st.dateRange.label}`, el("span", { "aria-hidden": "true" }, " \u00d7")]);
  b.addEventListener("click", () => { S.st.dateRange = null; S.draw(); });
  return el("div", { class: "range-chip-row" }, b);
}
// (update 322) Needed for #1: the longest run of rounds in a row whose average would still rank #1 (else #10, #25,
// #50), by the strokes gained on screen, against everyone else's average for this selection
export function peakNeeded(S) {
  const { mine = [], cat = "" } = S.peakCtx || {};
  const key = cat ? "sg" : "c:TOTAL";
  const others = S.rankedField(S.lastSliced || []).filter((p) => p.key !== S.me?.key).map((p) => S.rowVals(p.rounds, cat).get(key)).filter((v) => v != null && Number.isFinite(v));
  const seq = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((rd) => { let t = 0, any = false; for (const x of rd.shots) if (!cat || x.cat === cat) { t += x.sg; any = true; } return any ? t : null; }).filter((t) => t != null);
  if (!seq.length || !others.length) { S.st.peakMsg = "Not enough rounds or players in this selection."; S.draw(); return; }
  const pre = [0]; for (const t of seq) pre.push(pre.at(-1) + t);
  const bestAvg = (n) => { let best = -Infinity; for (let i = n; i < pre.length; i++) best = Math.max(best, pre[i] - pre[i - n]); return best / n; };
  const rankOf = (v) => 1 + others.filter((x) => x > v + 1e-12).length;
  const who = S.me?.label || "The player";
  for (const target of [1, 10, 25, 50]) {
    for (let n = seq.length; n >= 1; n--) {
      if (rankOf(bestAvg(n)) <= target) {
        S.st.peakN = n; S.st.peakMsgN = n;
        S.st.peakMsg = `#${target} from best ${n} ${n === 1 ? "round" : "rounds"}`; // (update 323)
        S.draw(); return;
      }
    }
  }
  S.st.peakN = 1; S.st.peakMsgN = 1;
  S.st.peakMsg = `${who}\u2019s best single round would rank ${S.ordinal(rankOf(bestAvg(1)))}.`;
  S.draw();
}
export function topPills(S, label = null) {
  // (update 228) Top 1 / 10 / 25 / 50 / All: who the gold dots and the "All Players" column are
  return el("div", { class: "top-pills" }, [label ? el("span", { class: "ms-label" }, label) : null, el("div", { class: "seg small" }, S.RANK_TOPS.map(([v, l]) => {
    const on = (S.st.rankTop || "all") === v;
    const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, l);
    b.addEventListener("click", () => { S.st.rankTop = v; S.st.rankTopManual = true; S.st.rankTopFor = S.me?.key; S.draw(); });
    return b;
  }))]);
}
// (update 330) Best Stretches, above the stats table (it replaces the #1 / #10 / #25 / #50 player comparisons):
//   the ladder: for #1, #10, #25 and #50, the longest run of rounds in a row whose average would rank there (by the
//   strokes gained the filters are about, against everyone else's average for this selection); or any length you pick.
//   Selecting one shows when it was, what was working (and the equipment), and every stat: the stretch next to the season.
export function stretchSeq(S, mine, cat) {
  return [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((rd) => { let t = 0, any = false; for (const x of rd.shots) if (!cat || x.cat === cat) { t += x.sg; any = true; } return any ? { rd, t } : null; }).filter(Boolean);
}
export function ladderRows(S, mine, cat) {
  const key = cat ? "sg" : "c:TOTAL";
  const others = S.rankedField(S.lastSliced || []).filter((p) => p.key !== S.me?.key).map((p) => S.rowVals(p.rounds, cat).get(key)).filter((v) => v != null && Number.isFinite(v));
  const seq = S.stretchSeq(mine, cat);
  if (!seq.length || !others.length) return null;
  const pre = [0]; for (const x of seq) pre.push(pre.at(-1) + x.t);
  const best = (n) => { let b = -Infinity, at = 0; for (let i = n; i < pre.length; i++) { const v = pre[i] - pre[i - n]; if (v > b) { b = v; at = i - n; } } return { avg: b / n, at }; };
  const rankOf = (v) => 1 + others.filter((x) => x > v + 1e-12).length;
  const seasonRank = rankOf(pre.at(-1) / seq.length);
  const memo = new Map(); const bestM = (n) => (memo.has(n) ? memo.get(n) : (memo.set(n, best(n)), memo.get(n)));
  // (update 334) Elite Round Share for each mark: the most of their best rounds (any order) that together still reach it
  const desc = seq.map((x) => x.t).sort((a, b) => b - a);
  const shareFor = (target) => { let k = 0, sum = 0; for (let i = 0; i < desc.length; i++) { sum += desc[i]; if (rankOf(sum / (i + 1)) <= target) k = i + 1; else break; } return { k, of: desc.length, pct: desc.length ? k / desc.length : 0 }; };
  const out = [1, 10, 25, 50].map((target) => ({ ...rung(target), share: shareFor(target) }));
  // (update 348) for the profile: every round (best first), how to rank an average, the field size, the overall rank
  out.prof = { desc, rankOf, N: others.length + 1, seasonRank, field: [...others].sort((a, b) => b - a), avg: pre.at(-1) / seq.length };
  return out;
  function rung(target) {
    if (seasonRank <= target) return { target, already: true, rank: seasonRank };
    for (let n = seq.length; n >= 1; n--) {
      const b = bestM(n);
      if (rankOf(b.avg) <= target) return { target, n, from: seq[b.at].rd.date, to: seq[b.at + n - 1].rd.date };
    }
    return { target, none: true, bestRound: rankOf(bestM(1).avg) };
  }
}
export function selectStretch(S, n, target = null) {
  S.st.pathStretch = null; // (update 455: a card picked: the Path compares against it, not the best stretch)
  if (S.st.vsRank === "peak" && S.st.peakN === n && (S.st.ladderT ?? null) === target) { S.st.vsRank = null; S.st.ladderT = null; }
  else { S.st.vsRank = "peak"; S.st.peakN = n; S.st.ladderT = target; }
  S.draw();
}
/** What was working in the stretch: where it gained most over the season, and the equipment in the bag. */
export function whatWorked(S, stretch, season0, cat) {
  const out = [];
  // (update 344) against the non-elite rounds (every round in the time frame except these), not the average with them in
  const inStretch = new Set(stretch), season = season0.filter((rd) => !inStretch.has(rd));
  const restName = S.NM().cut;
  const per = (rs, f) => { if (!rs.length) return 0; let t = 0; for (const rd of rs) for (const x of rd.shots) if (f(x)) t += x.sg; return t / rs.length; };
  const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
  const f2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  // the parts of the game (or, one category picked: its distances) that gained the most against the other rounds, each
  // split (update 345) into playing better per shot and facing different shots (more of the strong, fewer of the weak)
  const bS = bucketsOf(stretch), bN = bucketsOf(season), bU = bucketsOf(season0);
  const nN = Math.max(1, season.length);
  const sp = (pre) => groupSplit(bS, stretch.length, bN, nN, (k) => k.startsWith(pre), bU);
  const dists = (c) => [...new Set([...bS.keys(), ...bN.keys()].filter((k) => k.startsWith(`${c}|`)).map((k) => k.split("|")[1]).filter(Boolean))];
  const parts = cat ? dists(cat).map((d) => ({ name: d, pre: `${cat}|${d}|` })) : CATEGORIES.map(([c]) => ({ name: catName(c), k: c, pre: `${c}|` }));
  const gains = parts.map((p) => { const t = sp(p.pre); return { ...p, ...t, a: t.ae * t.pe, b: t.ab * t.pb }; })
    .filter((p) => p.total > 0.005).sort((x, y) => y.total - x.total).slice(0, 2);
  // (update 356) each part of the game as a heading line, then one short labelled line per point
  for (const g of gains) {
    // (update 358) the plain-English takeaway first, then the numbers behind it
    const mostlyMix = g.mix > 0 && g.mix >= 0.7 * g.total, mostlySkill = g.skill >= 0.7 * g.total;
    const take = `${g.name} was ${sgn2(g.total)} a round better in the ${S.NM().kept}: ${mostlySkill ? "nearly all of it from hitting the same shots better." : mostlyMix ? `mostly from facing different shots (${mixLead(g)}), not from hitting them better. ${MIX_CAUSE[g.k || cat] || ""}` : `partly from hitting the shots better, partly from facing different ones (${mixLead(g)}).`}`;
    const rowsOut = [kv("Takeaway", take, "bs-take"), kv("Hitting it better", `${sgn2(g.skill)} a round`)];
    if (Math.abs(g.mix) >= 0.02) rowsOut.push(kv("Facing different shots", `${sgn2(g.mix)} a round (${mixWords(g, sgn2)})`));
    if (!cat && g.k) { // the distance they played best (per shot) in these rounds
      const ds = dists(g.k).map((d) => ({ d, s: sp(`${g.k}|${d}|`) })).filter((x) => x.s.skill > 0.005).sort((a, b) => b.s.skill - a.s.skill);
      if (ds[0]) { const x = ds[0].s; rowsOut.push(kv("Biggest change", `${ds[0].d}: ${sgn2(x.total)} a round better in the ${S.NM().kept} (${sgn2(x.skill)} from hitting it better: ${sgn2(x.pe)} a shot against ${sgn2(x.pb)}${Math.abs(x.mix) >= 0.01 ? `; ${sgn2(x.mix)} from facing ${x.ae < x.ab ? "fewer" : "more"} of them` : ""})`)); }
    }
    out.push([el("div", { class: "bs-item-head" }, [el("strong", {}, g.name), el("span", { class: "muted" }, ` ${sgn2(g.a)} a round in the ${S.NM().kept} \u00b7 ${sgn2(g.b)} in the ${restName}`)]), ...rowsOut]);
  }
  if (!gains.length) out.push("No part of the game stands out: it was a little better everywhere.");
  // (update 337) the equipment: in each kind, what was used most in these rounds; and, if another of that kind was used
  // less but played better (strokes gained a shot, 5 shots or more), that one in brackets
  const byKind = new Map(); for (const g of gearList(stretch)) (byKind.get(g.kind) || byKind.set(g.kind, []).get(g.kind)).push(g);
  const nm = (g) => `${g.brand} ${g.model}`.trim();
  const f3 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}`;
  const kit = [...byKind.values()].map((list) => {
    const most = [...list].sort((a, b) => b.shots - a.shots)[0];
    const per = (g) => (g.shots ? g.sg / g.shots : null);
    const better = list.filter((g) => g !== most && g.shots >= 5 && per(g) != null && per(most) != null && per(g) > per(most) + 1e-9).sort((a, b) => per(b) - per(a))[0];
    return { shots: most.shots, text: [el("span", { class: "bs-kit-kind" }, String(most.kind || "").replace(/^\w/, (c) => c.toUpperCase())), ` ${nm(most)}`,
      better ? el("div", { class: "bs-kit-better muted small" }, `Played better with the ${nm(better)}: ${f3(per(better))} a shot against ${f3(per(most))}`) : null] };
  }).sort((a, b) => b.shots - a.shots).slice(0, 6).map((x) => x.text);
  if (kit.length) out.push([el("div", { class: "bs-item-head" }, el("strong", {}, "In the bag")), el("ul", { class: "bs-kit" }, kit.map((t) => el("li", {}, t)))]);
  return out;
}
// (update 335) Elite Round Share, above the stats table: for #1, #10, #25 and #50, the most of the player's best rounds
// (in any order) that together average at that rank, as a share of all their rounds. Tap one (or pick a number of
// rounds) to see those rounds: what was working, the equipment, and every stat next to their average.
/** (update 353) What the two sets of rounds are called: the best rounds picked (kept) and the rest (cut). For the
 * Best on Tour box they're the elite rounds; for the other levels, the rounds kept and the rounds cut to get there. */
export function NM(S) {
  // (update 354) always the kept rounds and the cut rounds, whichever level is picked
  const T = S.st.ladderT;
  const lvl = !S.showRanks ? "their best" : T && LEVELS[T] ? LEVELS[T] : LEVELS[1];
  return { kept: "kept rounds", cut: "cut rounds", Kept: "Kept", Cut: "Cut", lvl, T: S.showRanks ? T || 1 : null };
}
export function stretchesBlock(S, mine, cat) {
  const what = cat ? `${CATEGORIES.find(([k]) => k === cat)?.[1] || cat} ` : "";
  const rows = S.ladderRows(mine, cat);
  S.st.peakMode = "elite";
  const sel = S.st.vsRank === "peak" ? Math.max(1, Math.round(Number(S.st.peakN) || 10)) : null;
  const help = el("details", { class: "bs-help" }, [el("summary", { "aria-label": "What is this?" }, "\u24d8"),
    el("p", { class: "muted small" }, "How much of the player\u2019s golf was at each level (their best rounds, in any order, that together would rank there), and the other way round: how many of their worst rounds they\u2019d have to cut to get there."),
    el("p", { class: "muted small" }, "The four levels are named for what they mean on Tour. Best on Tour (#1): the season average of the best player in this selection. Contender (#10): a top-10 player, in contention most weeks. Tour Championship level (#25): around the top 30 who make the Tour Championship. Signature event level (#50): the top 50 who earn spots in the signature events. Each level is the average a player would need over the selected rounds to rank there in this field, so on other tours\u2019 data the names are a guide, not a fact."),
    el("p", { class: "muted small" }, "Elite Round Share asks how much of a player\u2019s golf was at each level. Take their best rounds, in any order, and keep adding the next best while the average of the ones taken would still rank at that level. The share is how many rounds that is, out of all their rounds. Seen the other way, the rest are the rounds they\u2019d have to cut: Next steps lists, from where they sit now, how many of their worst rounds each level above would take to cut (or how much better every round would have to be). Tap a box or a step to see the rounds: the ones to cut, what set the kept rounds apart, what hurt in the cut ones, and the path to get there."),
    el("p", { class: "muted small" }, "The line under the boxes says how much #1-level golf is in them, and their best stretch: the longest run of rounds in a row whose average on its own would rank #1, and where that ranks among every player\u2019s longest (the Elite Stretches table on the Leaderboards). Tap its dates to see just those rounds."),
    el("p", { class: "muted small" }, "The path compares the kept rounds with the cut rounds: the gap between them in strokes, the five parts of the game and distances that make up most of it, a target in plain stats where the file has one, when the kept rounds tend to come, and practice to match. What helped during the kept rounds and what hurt during the cut rounds sit above the table. It\u2019s worked out from the numbers on the page, not by AI."),
    el("p", { class: "muted small" }, "Per shot or how often: every difference in strokes gained is split in two. Per shot is playing the same shots better. How often is facing different shots at the same level per shot (by distance and lie), split again into more of their strong shots (ones they gain strokes on) and fewer of their weak ones (ones they lose strokes on). When a difference is mostly how often, it\u2019s a strategy question (or the shot before it), so it gets a strategy note instead of a drill; Where the shots came from lists the biggest of these.")]);
  // (update 342) no rankings (only the player's own practice or entered rounds): no #1 / #10 ladder to measure against,
  // so it's simply their best N rounds (10 to start)
  if (!S.showRanks) {
    const inp = el("input", { type: "number", class: "peak-len", min: "1", max: "500", step: "1", value: String(sel || 10), inputmode: "numeric", "aria-label": "How many of their best rounds" });
    const apply = () => { const n = Math.round(Number(inp.value)); if (!Number.isFinite(n) || n < 1) { inp.value = String(sel || 10); return; } const v = Math.min(500, n); if (sel === v) return; S.st.vsRank = "peak"; S.st.peakN = v; S.st.ladderT = null; S.draw(); };
    inp.addEventListener("change", apply);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    const show = el("button", { type: "button", class: "btn ghost small bs-go" }, "Show");
    show.addEventListener("click", () => { if (!sel) { S.st.vsRank = "peak"; S.st.peakN = Math.max(1, Math.round(Number(inp.value)) || 10); S.st.ladderT = null; S.draw(); } else apply(); });
    const clear = sel ? (() => { const c = el("button", { type: "button", class: "link small" }, "Clear"); c.addEventListener("click", () => { S.st.vsRank = null; S.st.ladderT = null; S.draw(); }); return c; })() : null;
    const pick = el("div", { class: "bs-pick peak-len-wrap" }, [el("span", { class: "muted small" }, "Their best"), inp, el("span", { class: "muted small" }, "rounds"), sel ? null : show, clear]);
    return el("div", { class: "bs" }, [
      el("div", { class: "bs-title" }, [el("span", { class: "ms-label" }, `${what ? `${what.trim()} ` : ""}Best Rounds`), el("details", { class: "bs-help" }, [el("summary", { "aria-label": "What is this?" }, "\u24d8"),
        el("p", { class: "muted small" }, "These rounds aren\u2019t ranked against other players, so there\u2019s no #1 or #10 level to measure against. Pick how many of their best rounds to look at: what was working, what was in the bag, every stat from them next to their average, and the path back to playing like that.")])]),
      pick, elitePart(),
    ]);
  }
  const ladder = rows ? el("div", { class: "bs-ladder", role: "list" }, rows.map((r) => {
    const k = r.share?.k || 0;
    const on = !!(sel && k && sel === k && S.st.ladderT === r.target);
    // (update 353) the level's name, the share of rounds at it, and (the other way round) how many of the worst rounds to cut
    const of = r.share?.of || 0;
    // (update 361) the next steps live in the cards: cut the worst N rounds, or gain this much a round across every round
    const P = rows.prof, bar = P?.field?.[r.target - 1], gain = bar != null && P ? Math.max(0.01, bar - P.avg + 0.005) : null;
    const body = [el("span", { class: "bs-pct" }, `${Math.round((r.share?.pct || 0) * 100)}%`),
      ...(r.already ? [el("span", { class: "bs-when muted" }, `all ${of} rounds`), el("span", { class: "bs-when bs-there" }, `Already there (${S.ordinal(r.rank)})`)]
        : [el("span", { class: "bs-when muted" }, k ? `best ${k} of ${of}` : `best round ranks ${S.ordinal(r.bestRound ?? r.share?.bestRound ?? 0)}`),
          k ? el("span", { class: "bs-when" }, `Cut the worst ${of - k}, or`) : null,
          gain != null ? el("span", { class: "bs-when" }, `Gain ${sgn2(gain)} a round`) : null])];
    const b = el(k ? "button" : "div", { type: k ? "button" : null, class: `bs-row${on ? " on" : ""}${k ? "" : " flat"}`, role: "listitem", "aria-pressed": k ? String(on) : null }, [el("span", { class: "bs-rank" }, [el("span", { class: "bs-lvl" }, LEVELS[r.target]), el("span", { class: "bs-lvl-n" }, ` #${r.target}`)]), ...body]);
    if (k) b.addEventListener("click", () => S.selectStretch(k, r.target));
    return b;
  })) : el("p", { class: "muted small" }, "Not enough rounds or players in the selected time frame.");
  function elitePart() {
  let detail = null;
  if (sel) {
    const pk = S.curPeak();
    if (!pk || pk.short) detail = el("p", { class: "muted small" }, `Only ${pk?.have ?? 0} ${what}rounds in the selected time frame: fewer than ${sel}. Pick fewer or widen the filters.`);
    else {
      const season = [...mine].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      const share = Math.round((sel / Math.max(1, season.length)) * 100);
      const sgR = (rd) => { let t = 0; for (const x of rd.shots) if (!cat || x.cat === cat) t += x.sg; return t; };
      // (update 357) one line for a set of rounds, the kept ones or the cut ones: how many, which tournaments (tap for the
      // list: by tournament, or round by round), and the dates. Kept: best first; cut: worst first.
      function roundsLine(label, rounds, key, worstFirst) {
        const byDate = [...rounds].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
        const evs = new Set(rounds.map((rd) => `${rd.event}|${String(rd.date || "").slice(0, 4)}`)).size;
        const first = byDate[0]?.date, last = byDate.at(-1)?.date;
        const open = !!S.st[`${key}EvOpen`];
        const byEv = new Map();
        for (const rd of rounds) { const k2 = `${rd.event}|${String(rd.date || "").slice(0, 4)}`; const g = byEv.get(k2) || byEv.set(k2, { event: rd.event || "Tournament", first: rd.date, rs: [] }).get(k2); g.rs.push(rd); }
        const allAt = (g) => season.filter((rd) => rd.event === g.event && String(rd.date || "").slice(0, 4) === String(g.first || "").slice(0, 4)).length;
        const dir = worstFirst ? 1 : -1;
        const link = el("button", { type: "button", class: "link bs-evs-btn", "aria-expanded": String(open) }, `${evs} ${evs === 1 ? "tournament" : "tournaments"} ${open ? "\u25B4" : "\u25BE"}`);
        link.addEventListener("click", () => { S.st[`${key}EvOpen`] = !open; S.draw(); });
        const byEvent = () => el("ul", { class: "bs-evs" }, [...byEv.values()].map((g) => ({ ...g, avg: g.rs.reduce((t, rd) => t + sgR(rd), 0) / g.rs.length })).sort((a, b) => dir * (a.avg - b.avg)).map((g) => {
          const nums = g.rs.map((rd) => rd.roundNo).filter((x) => x != null && x !== "").sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)).map((x) => `R${x}`);
          return el("li", {}, [el("span", { class: "bs-ev-name" }, g.event), el("span", { class: "muted" }, ` \u00b7 ${S.shortDay(g.first)} \u00b7 ${g.rs.length} of ${allAt(g)} ${allAt(g) === 1 ? "round" : "rounds"}${nums.length ? ` (${nums.join(", ")})` : ""} \u00b7 `), el("span", { class: g.avg >= 0 ? "pos" : "neg" }, `${sgn2(g.avg)} a round`)]);
        }));
        // (update 363) always round by round; tap a round for its strokes gained by part of the game, and each part
        // of the game for its distances
        const rKey = (rd) => `${String(rd.date || "").slice(0, 10)}|${rd.event || ""}|${rd.roundNo ?? ""}`;
        const roundDetail = (rd) => {
          const by = new Map();
          for (const x of rd.shots) { if (!x.cat) continue; const c = by.get(x.cat) || by.set(x.cat, { sg: 0, n: 0, d: new Map() }).get(x.cat); c.sg += x.sg; c.n += x.w || 1; if (x.dist) { const dd = c.d.get(x.dist) || c.d.set(x.dist, { sg: 0, n: 0 }).get(x.dist); dd.sg += x.sg; dd.n += x.w || 1; } }
          const open = new Set(S.st.rdCats || []);
          return el("div", { class: "bs-rd" }, CATEGORIES.filter(([c]) => by.has(c)).flatMap(([c, l]) => {
            const v = by.get(c), ds = [...v.d].sort((a, b) => distLead(a[0]) - distLead(b[0]) || a[0].localeCompare(b[0]));
            const row = el("button", { type: "button", class: "bs-rd-row", "aria-expanded": String(open.has(c)), disabled: !ds.length }, [
              el("span", { class: "bs-rd-l" }, [ds.length ? el("span", { class: "cmp-caret" }, open.has(c) ? "\u25BE " : "\u25B8 ") : null, l]),
              el("span", { class: `bs-rd-v ${v.sg >= 0 ? "pos" : "neg"}` }, sgn2(v.sg))]);
            row.addEventListener("click", (e) => { e.stopPropagation(); const n = new Set(S.st.rdCats || []); n.has(c) ? n.delete(c) : n.add(c); S.st.rdCats = [...n]; S.draw(); });
            // (shots with no distance in the file: one more line, so the distances add up to the part of the game)
            const restSg = v.sg - ds.reduce((t, [, x]) => t + x.sg, 0), restN = v.n - ds.reduce((t, [, x]) => t + x.n, 0);
            const sub = (lbl, sg, n) => el("div", { class: "bs-rd-row sub" }, [el("span", { class: "bs-rd-l" }, `${lbl} \u00b7 ${Math.round(n)} ${Math.round(n) === 1 ? "shot" : "shots"}`), el("span", { class: `bs-rd-v ${sg >= 0 ? "pos" : "neg"}` }, sgn2(sg))]);
            return [row, ...(open.has(c) ? [...ds.map(([d, x]) => sub(d, x.sg, x.n)), ...(Math.abs(restSg) >= 0.005 && restN > 0 ? [sub("Other shots", restSg, restN)] : [])] : [])];
          }));
        };
        const byRound = () => el("ul", { class: "bs-evs" }, rounds.map((rd) => ({ rd, v: sgR(rd) })).sort((a, b) => dir * (a.v - b.v)).map(({ rd, v }) => {
          const on = S.st.rdOpen === rKey(rd);
          const li = el("li", { class: `bs-rd-li${on ? " on" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(on) }, [
            el("div", { class: "bs-rd-head" }, [el("span", { class: v >= 0 ? "pos" : "neg" }, sgn2(v)), el("span", { class: "muted" }, " \u00b7 "), el("span", { class: "bs-ev-name" }, rd.event || "Tournament"),
              el("span", { class: "muted" }, `${rd.roundNo != null && rd.roundNo !== "" ? ` \u00b7 R${rd.roundNo}` : ""} \u00b7 ${S.shortDay(rd.date)}`)]),
            on ? roundDetail(rd) : null]);
          const tog = () => { S.st.rdOpen = on ? null : rKey(rd); S.draw(); };
          li.addEventListener("click", tog); li.addEventListener("keydown", (e) => { if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tog(); } });
          return li;
        }));
        const pct = Math.round((rounds.length / Math.max(1, season.length)) * 100);
        return [el("p", { class: "bs-head" }, [el("strong", {}, `${label}: the ${worstFirst ? "worst" : "best"} ${rounds.length} of ${season.length} (${pct}%) by ${cat ? `SG: ${what.trim()}` : "SG: Total"}`),
          ...(rounds.length ? [` \u00b7 from `, link, `${first ? `, ${S.shortDay(first)} \u2013 ${S.shortDay(last)}` : ""}.`] : ["."])]),
          open && rounds.length ? el("div", { class: "bs-evs-wrap" }, [byRound()]) : null];
      }
      const N0 = S.NM();
      const keptSet = new Set(pk.rounds);
      const cutRounds = season.filter((rd) => !keptSet.has(rd));
      detail = el("div", { class: "bs-detail" }, [
        ...(N0.T && N0.T !== 1 ? [el("p", { class: "bs-head" }, el("strong", {}, `${N0.lvl} (#${N0.T}): their best ${sel} of ${season.length} rounds would rank #${N0.T}.`))] : []),
        ...roundsLine("Kept rounds", pk.rounds, "kept", false),
        ...roundsLine("Cut rounds", cutRounds, "cut", true),
        // (update 362) What helped / What hurt / Where the shots came from: taken out (the path below covers it)
      ]);
    }
  }
  return detail;
  }
  const detail = null; // (update 442: no kept / cut lines under the cards; the table below compares them)
  // (update 442) every round, best to worst (or by date), each one opening to its parts of the game and distances
  const roundDetailOf = (rd) => {
    const by = new Map();
    for (const x of rd.shots) { if (!x.cat) continue; const c = by.get(x.cat) || by.set(x.cat, { sg: 0, n: 0, d: new Map() }).get(x.cat); c.sg += x.sg; c.n += x.w || 1; if (x.dist) { const dd = c.d.get(x.dist) || c.d.set(x.dist, { sg: 0, n: 0 }).get(x.dist); dd.sg += x.sg; dd.n += x.w || 1; } }
    const open = new Set(S.st.rdCats || []);
    return el("div", { class: "bs-rd" }, CATEGORIES.filter(([c]) => by.has(c)).flatMap(([c, l]) => {
      const v = by.get(c), ds = [...v.d].sort((a, b) => distLead(a[0]) - distLead(b[0]) || a[0].localeCompare(b[0]));
      const row = el("button", { type: "button", class: "bs-rd-row", "aria-expanded": String(open.has(c)), disabled: !ds.length }, [
        el("span", { class: "bs-rd-l" }, [ds.length ? el("span", { class: "cmp-caret" }, open.has(c) ? "\u25BE " : "\u25B8 ") : null, l]),
        el("span", { class: `bs-rd-v ${v.sg >= 0 ? "pos" : "neg"}` }, sgn2(v.sg))]);
      row.addEventListener("click", (e) => { e.stopPropagation(); const n = new Set(S.st.rdCats || []); n.has(c) ? n.delete(c) : n.add(c); S.st.rdCats = [...n]; S.draw(); });
      // (shots with no distance in the file: one more line, so the distances add up to the part of the game)
      const restSg = v.sg - ds.reduce((t, [, x]) => t + x.sg, 0), restN = v.n - ds.reduce((t, [, x]) => t + x.n, 0);
      const sub = (lbl, sg, n) => el("div", { class: "bs-rd-row sub" }, [el("span", { class: "bs-rd-l" }, `${lbl} \u00b7 ${Math.round(n)} ${Math.round(n) === 1 ? "shot" : "shots"}`), el("span", { class: `bs-rd-v ${sg >= 0 ? "pos" : "neg"}` }, sgn2(sg))]);
      return [row, ...(open.has(c) ? [...ds.map(([d, x]) => sub(d, x.sg, x.n)), ...(Math.abs(restSg) >= 0.005 && restN > 0 ? [sub("Other shots", restSg, restN)] : [])] : [])];
    }));
  };
  const sgOfRd = (rd) => { let t = 0; for (const x of rd.shots) if (!cat || x.cat === cat) t += x.sg; return t; };
  const allRounds = false ? (() => { // (update 445: All Rounds taken out)
    const open = !!S.st.allRoundsOpen, byDate = S.st.allRoundsSort === "date";
    const tog = el("button", { type: "button", class: "link bs-evs-btn bs-all-btn", "aria-expanded": String(open) }, `All Rounds (${mine.length}) ${open ? "\u25B4" : "\u25BE"}`);
    tog.addEventListener("click", () => { S.st.allRoundsOpen = !open; S.draw(); });
    if (!open) return { tog, list: null };
    const sortBtn = (k, lab) => { const on = (k === "date") === byDate; const b = el("button", { type: "button", class: `pp-tog${on ? " on" : ""}`, "aria-pressed": String(on) }, lab); b.addEventListener("click", () => { S.st.allRoundsSort = k; S.draw(); }); return b; };
    const rKey = (rd) => `${String(rd.date || "").slice(0, 10)}|${rd.event || ""}|${rd.roundNo ?? ""}`;
    const list = mine.map((rd) => ({ rd, v: sgOfRd(rd) })).sort((a, b) => (byDate ? String(b.rd.date || "").localeCompare(String(a.rd.date || "")) || (parseFloat(b.rd.roundNo) || 0) - (parseFloat(a.rd.roundNo) || 0) : b.v - a.v));
    return { tog, list: el("div", { class: "bs-all" }, [
      el("div", { class: "sg-peak-ctl bs-all-sort" }, [el("span", { class: "muted small" }, "Sort:"), sortBtn("sg", "Best to worst"), sortBtn("date", "By date")]),
      el("div", { class: "bs-evs-wrap" }, el("ul", { class: "bs-evs" }, list.map(({ rd, v }) => {
        const on = S.st.rdOpen === rKey(rd);
        const li = el("li", { class: `bs-rd-li${on ? " on" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(on) }, [
          el("div", { class: "bs-rd-head" }, [el("span", { class: v >= 0 ? "pos" : "neg" }, sgn2(v)), el("span", { class: "muted" }, " \u00b7 "), el("span", { class: "bs-ev-name" }, rd.event || "Tournament"),
            el("span", { class: "muted" }, `${rd.roundNo != null && rd.roundNo !== "" ? ` \u00b7 R${rd.roundNo}` : ""} \u00b7 ${S.shortDay(rd.date)}`)]),
          on ? roundDetailOf(rd) : null]);
        const t2 = () => { S.st.rdOpen = on ? null : rKey(rd); S.draw(); };
        li.addEventListener("click", t2); li.addEventListener("keydown", (e) => { if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t2(); } });
        return li;
      })))]) };
  })() : null;

  return el("div", { class: "bs" }, [
    el("div", { class: "bs-title" }, [el("span", { class: "ms-label" }, `${what ? `${what.trim()} ` : ""}Elite Round Share`), help]),

    rows?.prof ? el("p", { class: "bs-now" }, [`Currently `, el("strong", {}, S.ordinal(rows.prof.seasonRank)), ` of ${rows.prof.N} (${sgn2(rows.prof.avg)} a round)`]) : null,
    ladder, S.profileLine(mine, cat, rows, allRounds?.tog), allRounds?.list, detail,
  ]);
}
/* (update 345) Where the shots came from: the parts of the game and distances where elite rounds simply had more of the
 * player's strong shots or fewer of their weak ones (at the same per-shot level), and what that was worth. */
export function shotMix(S, elite, season, cat) {
  const eSet = new Set(elite), rest = season.filter((rd) => !eSet.has(rd));
  if (!rest.length) return { items: [], total: null };
  const inCat = (x) => !cat || x.cat === cat;
  const bE = bucketsOf(elite, inCat), bN = bucketsOf(rest, inCat), bU = bucketsOf(season, inCat);
  const total = groupSplit(bE, elite.length, bN, rest.length, () => true, bU);
  const f2 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
  const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
  // (update 358) the biggest pieces both ways (helped and hurt), so the list adds up to the summary; putting and short-game
  // counts are a result of the shot before, not a choice
  const items = [...new Set([...bE.keys(), ...bN.keys()])].filter((k) => k.split("|")[1])
    .map((k) => ({ k, s: splitOf(bE.get(k), elite.length, bN.get(k), rest.length, bU.get(k)) }))
    .filter((x) => Math.abs(x.s.mix) >= 0.08 && (bN.get(x.k)?.n || 0) >= 5).sort((a, b) => Math.abs(b.s.mix) - Math.abs(a.s.mix)).slice(0, 4)
    .map(({ k, s: x }) => { const [c, d] = k.split("|"); const fewer = x.ae < x.ab, helped = x.mix > 0;
      const choice = c === "OTT" || c === "APP";
      const kindTxt = x.pu < 0 ? "a shot they usually lose strokes on" : "a shot they usually gain strokes on";
      return [el("div", { class: "bs-item-head" }, [el("strong", {}, `${catName(c)} \u00b7 ${d}`), el("span", { class: helped ? "pos" : "neg" }, ` ${helped ? "helped" : "hurt"} ${sgn2(x.mix)} a round`)]),
        kv("Takeaway", `The ${S.NM().kept} had ${fewer ? "fewer" : "more"} of these (${x.ae.toFixed(1)} a round, against ${x.ab.toFixed(1)}), and it\u2019s ${kindTxt} (${sgn2(x.pu)} a shot). ${choice ? MIX_CAUSE[c] : "That comes from the shot before, not a choice."}`)];
    });
  return { items, total };
}
/* (update 343) What hurts in the other rounds (moved up under What was working): a part of the game costing a stroke
 * or more in a round, and bad positions traced back to the shot that put them there. Text only. */
export function whatHurts(S, elite, season, cat) {
  const N = S.NM();
  const eSet = new Set(elite), others = season.filter((rd) => !eSet.has(rd));
  const f2 = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`;
  const catName = (k) => CATEGORIES.find(([c]) => c === k)?.[1] || k;
  // what hurts: a part of the game costing a stroke or more in a round, and bad positions (approach / short game from rough, sand,
  // recovery) that happen more often in the rest than in the best rounds
  const avoid = [];
  const per = (rs, pred) => (rs.length ? rs.reduce((t, rd) => { let n = 0; for (const x of rd.shots) if (pred(x)) n += x.w || 1; return t + n; }, 0) / rs.length : 0);
  // (the data is grouped by part of the game, lie and distance, not single shots, so "bad" is judged a round at a time:
  // how often a part of the game cost them a stroke or more in a round, in the rest against the best rounds)
  const roundSg = (rd, c) => { let t = 0; for (const x of rd.shots) if (x.cat === c) t += x.sg; return t; };
  const badShare = (rs, c) => (rs.length ? rs.filter((rd) => roundSg(rd, c) <= -1).length / rs.length : 0);
  const where = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
  for (const [c] of CATEGORIES) {
    if (cat && c !== cat) continue;
    const o = badShare(others, c), e = badShare(elite, c);
    if (others.length >= 3 && o - e >= 0.15) avoid.push({ v: (o - e) * 1.5, t: `${where[c] || catName(c)} cost them a stroke or more in ${Math.round(o * 100)}% of ${N.cut}, against ${Math.round(e * 100)}% of ${N.kept}.` });
  }
  // bad lies: more approaches from the rough (or short-game shots from off the green) usually isn't a rough problem, it's
  // the shot before. So: if they played as well as usual from there, point at the shot that put them there (driving for
  // approaches, approach for the short game); only if they also played worse from there is the lie itself something to work on.
  const pa = (rs, pL) => { let sg = 0, n = 0; for (const rd of rs) for (const x of rd.shots) if (pL(x)) { sg += x.sg; n += x.w || 1; } return { v: n ? sg / n : null, n }; };
  const rootOf = { APP: { c: "OTT", what: "getting there off the tee", stat: /^fwy/i }, ARG: { c: "APP", what: "missing greens", stat: /^gir/i } };
  for (const c of ["APP", "ARG"]) {
    if (cat && c !== cat) continue;
    const lies = new Set(); for (const rd of others) for (const x of rd.shots) if (x.cat === c && x.lie && !/fairway|green|tee/i.test(x.lie)) lies.add(x.lie);
    for (const lie of lies) {
      const pL = (x) => x.cat === c && x.lie === lie;
      const o = per(others, pL), e = per(elite, pL);
      if (o - e < 0.5) continue;
      // strokes gained already allows for how hard the lie is, so the test is against the tour baseline (zero): losing
      // 0.08 or more an attempt from there is a problem with the shots themselves. (Elite rounds were picked for being
      // good, so their numbers from the rough are flattered and aren't a fair yardstick.)
      const po = pa(others, pL);
      const worse = po.v != null && po.v <= -0.08;
      const root = rootOf[c], lieName = String(lie).toLowerCase();
      // the stat behind the root cause (fairways for driving, greens hit for approach), when the file has it
      const sm = (rs) => { let t = 0, w = 0; for (const rd of rs) for (const ob of rd.obs || []) if (!ob.cat && root.stat.test(ob.k)) { t += ob.v * ob.w; w += ob.w; } return w ? t / w : null; };
      const so = sm(others), se = sm(elite);
      const statBit = so != null && se != null && se > so ? ` ${c === "APP" ? "Fairways hit" : "Greens hit"}: ${so.toFixed(0)}% in ${N.cut}, ${se.toFixed(0)}% in ${N.kept}.` : "";
      const head = `${c === "APP" ? "Approaches" : "Short-game shots"} from the ${lieName}: ${o.toFixed(1)} attempts a round in ${N.cut}, ${e.toFixed(1)} in ${N.kept}.`;
      const t = worse
        ? `${head} They also lost ground from there (${f2(po.v)} an attempt against the tour baseline), so it\u2019s both: ${root.what} and the shots from the ${lieName}.${statBit}`
        : `${head} From there they held their own (${f2(po.v)} an attempt against the tour baseline), so the problem is ${root.what}, not the ${lieName} shots.${statBit}`;
      avoid.push({ v: (o - e) * 0.3 + (worse ? -po.v * o : 0), t });
    }
  }
  avoid.sort((a, b) => b.v - a.v);
  return avoid.slice(0, 3).map((a) => a.t);
}
/* (update 353) Next steps: from where they sit now, each level above, nearest first: how many of their worst rounds they\u2019d
 * have to cut to get there (or how much better every round would have to be). Tap one to see the rounds to cut and what
 * set them apart. */
export function nextSteps(S, rows) {
  const P = rows?.prof;
  if (!P) return null;
  const R = P.seasonRank;
  if (R <= 1) return el("p", { class: "bs-next muted small" }, `Already ${LEVELS[1]}: 1st of ${P.N}.`);
  const ahead = rows.filter((r) => r.target < R && r.share?.k).sort((a, b) => b.target - a.target);
  if (!ahead.length) return null;
  const need = (T) => { const bar = P.field[T - 1]; return bar == null ? null : Math.max(0.01, bar - P.avg + 0.005); };
  return el("div", { class: "bs-next" }, [
    el("p", { class: "bs-sub" }, "Next steps"),
    el("p", { class: "muted small bs-next-now" }, `Now ${S.ordinal(R)} of ${P.N} (${sgn2(P.avg)} a round).`),
    el("ol", { class: "bs-next-list" }, ahead.map((r) => {
      const cut = r.share.of - r.share.k, on = S.st.vsRank === "peak" && S.st.ladderT === r.target && Number(S.st.peakN) === r.share.k, g = need(r.target);
      const b = el("button", { type: "button", class: `bs-next-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, [
        el("strong", {}, `${LEVELS[r.target]} (#${r.target})`), `: cut the worst ${cut} ${cut === 1 ? "round" : "rounds"}`,
        g != null ? el("span", { class: "muted" }, `, or ${sgn2(g)} a round across every round`) : null]);
      b.addEventListener("click", () => S.selectStretch(r.share.k, r.target));
      return el("li", {}, b);
    })),
  ]);
}
/* (update 350) The best stretch in a pop-up: every round in order as a bar, the stretch\u2019s rounds in gold, the #1 level
 * as a dashed line. Tap a bar for that round. "Show just these rounds" filters the page to the stretch\u2019s dates. */
export function stretchPopup(S, row, cat, when, place, withN) {
  const seq = S.stretchSeq(row.p.rounds, cat);
  const day = (rd) => String(rd.date || "").slice(0, 10);
  const i0 = seq.findIndex((x) => day(x.rd) === String(row.from).slice(0, 10));
  const inSt = (i) => i >= i0 && i < i0 + row.n;
  const avg = seq.slice(i0, i0 + row.n).reduce((t, x) => t + x.t, 0) / row.n;
  const W = 340, H = 170, pad = 6, n = seq.length;
  const mx = Math.max(0.5, ...seq.map((x) => Math.abs(x.t)), Math.abs(row.bar || 0));
  const y0 = H / 2, sc = (H / 2 - pad) / mx, bw = W / n;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
  const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, class: "bs-st-svg", role: "img", "aria-label": `Every round, the best stretch of ${row.n} highlighted` });
  // the stretch's span behind its bars, the zero line and the #1 level
  if (i0 >= 0) svg.appendChild(mk("rect", { x: i0 * bw, y: 0, width: row.n * bw, height: H, fill: "rgba(212,180,131,0.10)" }));
  svg.appendChild(mk("line", { x1: 0, x2: W, y1: y0, y2: y0, stroke: "rgba(255,255,255,0.25)", "stroke-width": 1 }));
  const yb = y0 - (row.bar || 0) * sc;
  svg.appendChild(mk("line", { x1: 0, x2: W, y1: yb, y2: yb, stroke: "#d4b483", "stroke-width": 1, "stroke-dasharray": "4 3", opacity: 0.8 }));
  const lbl = mk("text", { x: W - 2, y: yb - 3, "text-anchor": "end", fill: "#d4b483", "font-size": 9 }); lbl.textContent = LEVELS[1]; svg.appendChild(lbl);
  // (update 352) every round in a table below, oldest first; the stretch's rows highlighted; a bar's row is picked out
  // (update 380) a round opens to its strokes gained by part of the game, and each part of the game to its distances
  const rdBreak = (rd) => {
    const by = new Map();
    for (const x of rd.shots || []) { if (!x.cat) continue; const c = by.get(x.cat) || by.set(x.cat, { sg: 0, n: 0, d: new Map() }).get(x.cat); c.sg += x.sg; c.n += x.w || 1; if (x.dist) { const dd = c.d.get(x.dist) || c.d.set(x.dist, { sg: 0, n: 0 }).get(x.dist); dd.sg += x.sg; dd.n += x.w || 1; } }
    return el("div", { class: "bs-rd" }, CATEGORIES.filter(([c]) => by.has(c)).flatMap(([c, l]) => {
      const v = by.get(c), ds = [...v.d].sort((a, b) => distLead(a[0]) - distLead(b[0]) || a[0].localeCompare(b[0]));
      const restSg = v.sg - ds.reduce((t, [, x]) => t + x.sg, 0), restN = v.n - ds.reduce((t, [, x]) => t + x.n, 0);
      const sub = (lbl, sg, n) => el("div", { class: "bs-rd-row sub", style: "display:none" }, [el("span", { class: "bs-rd-l" }, `${lbl} \u00b7 ${Math.round(n)} ${Math.round(n) === 1 ? "shot" : "shots"}`), el("span", { class: `bs-rd-v ${sg >= 0 ? "pos" : "neg"}` }, sgn2(sg))]);
      const subs = [...ds.map(([d, x]) => sub(d, x.sg, x.n)), ...(Math.abs(restSg) >= 0.005 && restN > 0 ? [sub("Other shots", restSg, restN)] : [])];
      const caret = ds.length ? el("span", { class: "cmp-caret" }, "\u25B8 ") : null;
      const row = el("button", { type: "button", class: "bs-rd-row", "aria-expanded": "false", disabled: !ds.length }, [el("span", { class: "bs-rd-l" }, [caret, l]), el("span", { class: `bs-rd-v ${v.sg >= 0 ? "pos" : "neg"}` }, sgn2(v.sg))]);
      row.addEventListener("click", (e) => { e.stopPropagation(); const open = row.getAttribute("aria-expanded") !== "true"; row.setAttribute("aria-expanded", String(open)); if (caret) caret.textContent = open ? "\u25BE " : "\u25B8 "; subs.forEach((x) => { x.style.display = open ? "" : "none"; }); });
      return [row, ...subs];
    }));
  };
  const trs = seq.map((x, i) => el("tr", { class: inSt(i) ? "in" : "" }, [
    el("td", {}, [el("span", { class: "cmp-caret" }, "\u25B8 "), `${S.shortDay(x.rd.date)} ${String(x.rd.date || "").slice(2, 4) ? `\u2019${String(x.rd.date).slice(2, 4)}` : ""}`]),
    el("td", {}, `${x.rd.event || "Round"}${x.rd.roundNo ? ` \u00b7 R${x.rd.roundNo}` : ""}`),
    el("td", { class: `num ${x.t >= 0 ? "pos" : "neg"}` }, sgn2(x.t))]));
  const bodyRows = [];
  seq.forEach((x, i) => {
    if (!inSt(i)) return;
    const tr = trs[i], det = el("tr", { class: "bs-st-det", hidden: true }, el("td", { colspan: 3 }, rdBreak(x.rd)));
    tr.classList.add("bs-st-tap"); tr.setAttribute("role", "button"); tr.setAttribute("tabindex", "0"); tr.setAttribute("aria-expanded", "false");
    const flip = () => { const open = tr.getAttribute("aria-expanded") !== "true"; tr.setAttribute("aria-expanded", String(open)); tr.querySelector(".cmp-caret").textContent = open ? "\u25BE " : "\u25B8 "; det.hidden = !open; };
    tr.addEventListener("click", flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    bodyRows.push(tr, det);
  });
  // (update 380) the stretch in numbers: each part of the game over the stretch against their whole selection
  const stRds = seq.filter((_, i) => inSt(i)).map((x) => x.rd), allRds = seq.filter((_, i) => !inSt(i)).map((x) => x.rd); // (update 385: the rest, outside the stretch)
  const catAvg = (rs, c) => (rs.length ? rs.reduce((t, rd) => t + (rd.shots || []).reduce((u, x) => u + (!c || x.cat === c ? x.sg : 0), 0), 0) / rs.length : null);
  const stVals = seq.filter((_, i) => inSt(i)).map((x) => x.t);
  const bestI = stVals.indexOf(Math.max(...stVals)), worstI = stVals.indexOf(Math.min(...stVals));
  const evN = new Set(stRds.map((rd) => `${rd.event}|${String(rd.date || "").slice(0, 4)}`)).size;
  const sumRow = (l, a, b, strong = false) => el("tr", { class: strong ? "strong" : "" }, [el("td", {}, l), el("td", { class: `num ${a >= 0 ? "pos" : "neg"}` }, sgn2(a)), el("td", { class: "num" }, sgn2(b)), el("td", { class: `num ${a - b >= 0 ? "pos" : "neg"}` }, sgn2(a - b))]);
  const summary = el("div", { class: "bs-st-sum" }, [
    el("div", { class: "bs-st-facts" }, [
      el("span", {}, [el("strong", {}, String(row.n)), ` ${row.n === 1 ? "round" : "rounds"} \u00b7 ${evN} ${evN === 1 ? "event" : "events"}`]),
      el("span", {}, [el("strong", {}, `${stVals.filter((v) => v > 0).length} of ${row.n}`), " gaining"]),
      stVals.length ? el("span", {}, ["Best ", el("strong", { class: "pos" }, sgn2(stVals[bestI])), " \u00b7 worst ", el("strong", { class: stVals[worstI] >= 0 ? "pos" : "neg" }, sgn2(stVals[worstI]))]) : null]),
    el("div", { class: "bs-st-tw" }, el("table", { class: "bs-st-table bs-st-cats" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "A round"), el("th", { class: "num" }, "Stretch"), el("th", { class: "num", title: "Their other rounds in the selection (outside the stretch)" }, "Rest"), el("th", { class: "num", title: "Stretch less rest" }, "Diff")])),
      el("tbody", {}, [sumRow("SG: Total", catAvg(stRds, null), catAvg(allRds, null), true), ...CATEGORIES.flatMap(([c, l]) => {
        // (update 445) each part of the game opens to its distances
        const tr = sumRow(l, catAvg(stRds, c), catAvg(allRds, c)), ds = S.distsIn([...stRds, ...allRds], c);
        if (!ds.length) return [tr];
        const kids = ds.map((d) => { const k = sumRow(d, S.perRd(stRds, c, d), S.perRd(allRds, c, d)); k.classList.add("bs-st-kid"); k.hidden = true; return k; });
        const caret = el("span", { class: "cmp-caret" }, "\u25B8 "); tr.firstChild.prepend(caret); tr.classList.add("bs-st-tap"); tr.setAttribute("role", "button"); tr.setAttribute("tabindex", "0"); tr.setAttribute("aria-expanded", "false");
        const flip = () => { const open = tr.getAttribute("aria-expanded") !== "true"; tr.setAttribute("aria-expanded", String(open)); caret.textContent = open ? "\u25BE " : "\u25B8 "; kids.forEach((x) => { x.hidden = !open; }); };
        tr.addEventListener("click", flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
        return [tr, ...kids];
      })])])),
  ]);
  const table = el("div", { class: "bs-st-tw" }, el("table", { class: "bs-st-table" }, [el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Event"), el("th", { class: "num" }, "SG")])), el("tbody", {}, bodyRows)])); // (update 377: just the stretch's rounds; 380: each opens)
  const bars = seq.map((x, i) => {
    const h = Math.max(1, Math.abs(x.t) * sc), on = inSt(i);
    const r = mk("rect", { x: i * bw + bw * 0.12, width: Math.max(0.8, bw * 0.76), y: x.t >= 0 ? y0 - h : y0, height: h, rx: Math.min(2, bw * 0.2),
      fill: x.t >= 0 ? (on ? "#30d158" : "rgba(48,209,88,0.28)") : (on ? "#ff453a" : "rgba(255,69,58,0.28)"), class: `bs-st-bar${on ? " in" : ""}` });
    // a wider invisible target so thin bars are easy to tap
    const hit = mk("rect", { x: i * bw, width: bw, y: 0, height: H, fill: "transparent", style: "cursor:pointer" });
    hit.addEventListener("click", () => {
      bars.forEach((b, j) => b.setAttribute("stroke", j === i ? "#fff" : "none"));
      trs.forEach((t, j) => t.classList.toggle("picked", j === i));
      if (inSt(i)) trs[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    svg.appendChild(r); svg.appendChild(hit);
    return r;
  });
  const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
  // (update 467) the products used during the stretch, by kind: strokes gained a round with each (its shots, over the
  // rounds it was used in), how many shots and how many rounds
  const prodBlock = (() => {
    const by = new Map();
    for (const rd of stRds) {
      const per = new Map();
      for (const x of rd.shots || []) {
        if (cat && x.cat !== cat) continue;
        for (const v of [x.gear || null, x.ball ? `Ball|${x.ball}` : null]) { if (!v) continue; const a = per.get(v) || per.set(v, { sg: 0, w: 0 }).get(v); a.sg += x.sg || 0; a.w += x.w || 1; }
      }
      for (const [v, a] of per) { const t = by.get(v) || by.set(v, { sg: 0, w: 0, rounds: 0 }).get(v); t.sg += a.sg; t.w += a.w; t.rounds++; }
    }
    if (!by.size) return null;
    const KIND_ORDER = ["Driver", "Non-Driver", "Fairway Wood", "Hybrid", "Iron", "Wedge", "Putter", "Ball", "Other"];
    const groups = new Map();
    for (const [v, t] of by) { const gi = gearInfo(v), k = gi.kind || "Other"; (groups.get(k) || groups.set(k, []).get(k)).push({ name: `${gi.brand} ${gi.model}`.trim() || v, ...t }); }
    const kinds = [...groups.keys()].sort((a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99));
    const kindName = (k) => ({ Ball: "Golf ball", "Non-Driver": "Fairway woods & hybrids" }[k] || (k.endsWith("s") ? k : `${k}s`));
    return el("div", { class: "bs-st-prods" }, [
      el("p", { class: "bs-st-prods-h" }, "Products used in the stretch"),
      el("div", { class: "bs-st-tw" }, el("table", { class: "bs-st-table bs-st-prod-t" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Product"), el("th", { class: "num" }, "SG / rd"), el("th", { class: "num" }, "Shots"), el("th", { class: "num", title: "Rounds" }, "Rds")])),
        el("tbody", {}, kinds.flatMap((k) => [el("tr", { class: "bs-st-kind" }, el("td", { colspan: 4 }, kindName(k))),
          ...groups.get(k).sort((a, b) => b.w - a.w).map((t) => { const v = t.rounds ? t.sg / t.rounds : 0; return el("tr", {}, [el("td", {}, t.name), el("td", { class: `num ${v >= 0 ? "pos" : "neg"}` }, sgn2(v)), el("td", { class: "num" }, String(Math.round(t.w))), el("td", { class: "num" }, String(t.rounds))]); })])),
      ])),
      el("p", { class: "muted small" }, "SG / rd: strokes gained a round on the shots hit with it, over the rounds it was used in."),
    ]);
  })();
  const show = el("button", { type: "button", class: "btn ghost small" }, "Show just these rounds");
  const what = cat ? `SG: ${CATEGORIES.find(([k]) => k === cat)?.[1] || cat}` : "SG: Total";
  const overlay = el("div", { class: "gx-pop-overlay bs-st-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Best stretch" }, el("div", { class: "gx-pop bs-st-pop" }, [
    el("div", { class: "gx-pop-head" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, "Best stretch"), el("h2", {}, `${row.n} ${row.n === 1 ? "round" : "rounds in a row"} \u00b7 ${when}`),
      el("p", { class: "gx-sub" }, `${what}: ${sgn2(avg)} a round over the stretch; the ${LEVELS[1]} level is ${sgn2(row.bar || 0)} (the best season average of any other player).${place ? ` The ${place === 1 ? "longest" : `${S.ordinal(place)}-longest`} elite stretch of ${withN}.` : ""}`)]), close]),
    svg,
    summary,
    prodBlock,
    el("p", { class: "muted small bs-st-count" }, `All ${n} rounds in the chart, oldest first, the stretch bright. Below, the ${row.n} ${row.n === 1 ? "round" : "rounds"} in the stretch: tap one for its strokes gained by part of the game and distance.`),
    table,
    el("div", { class: "bs-st-foot" }, [show]),
  ]));
  const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") shut(); };
  close.addEventListener("click", shut);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
  document.addEventListener("keydown", onKey);
  show.addEventListener("click", () => { shut(); S.setRange({ from: String(row.from).slice(0, 10), to: String(row.to).slice(0, 10), label: when }); });
  document.body.appendChild(overlay);
  close.focus();
}
/* (update 350) Under the boxes: how much #1-level golf is in them, and their best stretch: the longest run of rounds in a
 * row that on its own would rank #1, and where that run ranks among every player's longest (as on the Leaderboards). */
// (update 443) All Rounds at the end of the line, in the same type
export function profileLine(S, mine, cat, rows, tail = null) { const p = S.profileLine0(mine, cat, rows); if (p && tail) p.append(" ", tail); return p || tail; }
export function profileLine0(S, mine, cat, rows) {
  if (!rows || !S.me) return null;
  const all = S.longestStretches(S.lastSliced || [], cat);
  const mineRow = all.find((r) => r.p.key === S.me.key);
  const s = rows.find((r) => r.target === 1)?.share?.pct ?? 0;
  const amount = s >= 0.3 ? "Plenty of" : s >= 0.1 ? "Some" : s > 0 ? "A little" : "No";
  const lead = `${amount} \u201c${LEVELS[1]}\u201d caliber golf in them (${Math.round(s * 100)}% of their rounds).`;
  if (!mineRow || !mineRow.n) {
    const r1 = rows.find((r) => r.target === 1);
    return el("p", { class: "bs-profile" }, [el("strong", {}, `${lead} `), el("span", { class: "muted" }, `No run of rounds reaches a #1 level yet${r1?.bestRound ? `; their best single round ranks ${S.ordinal(r1.bestRound)}` : ""}.`)]);
  }
  if (mineRow.whole) return el("p", { class: "bs-profile" }, [el("strong", {}, `${lead} `), el("span", { class: "muted" }, `All ${mineRow.n} of their rounds together already rank #1.`)]);
  // its place among everyone's longest (players with the same length share a place)
  const place = 1 + all.filter((r) => r.n > mineRow.n).length, withN = all.filter((r) => r.n > 0).length;
  const when = mineRow.from === mineRow.to ? S.shortDay(mineRow.from) : `${S.shortDay(mineRow.from)} \u2013 ${S.shortDay(mineRow.to)}`;
  const link = el("button", { type: "button", class: "link bs-stretch-link", title: "Every round, with this stretch picked out" }, when);
  link.addEventListener("click", () => S.stretchPopup(mineRow, cat, when, place, withN));
  // (update 455) "best stretch" tapped: picked out, and the Path table below compares the last N rounds with it
  const bsOn = S.st.pathStretch === (cat || "") && !!mineRow.rds?.length;
  const bsBtn = el("button", { type: "button", class: `link bs-best-btn${bsOn ? " on" : ""}`, "aria-pressed": String(bsOn), title: bsOn ? "Compare the last rounds with the rest again" : "Compare the last rounds with this stretch in the table below" }, "best stretch");
  bsBtn.addEventListener("click", () => { if (bsOn) S.st.pathStretch = null; else { S.st.pathStretch = cat || ""; if (S.st.vsRank === "peak") { S.st.vsRank = null; S.st.ladderT = null; } } S.draw(); });
  return el("p", { class: `bs-profile${bsOn ? " bs-on" : ""}` }, [el("strong", {}, `${lead} `), el("span", { class: "muted" }, [
    "Their ", bsBtn, `: ${mineRow.n} ${mineRow.n === 1 ? "round" : "rounds in a row"}, `, link, `, enough on ${mineRow.n === 1 ? "its" : "their"} own for ${LEVELS[1]}. That\u2019s the ${place === 1 ? "longest" : `${S.ordinal(place)}-longest`} elite stretch of ${withN} capable ${withN === 1 ? "player" : "players"}.`])]);
}
