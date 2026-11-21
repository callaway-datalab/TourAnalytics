// (update 817) Course Fit, one player: every tournament on their main tour ranked by how well their game suits it, and why.
// (update 819) Room to gain: strokes gained exists because players differ, so a part of the game where the field spreads out
// more at a tournament (hard greens, long approaches into firm greens …) has more strokes there for a good player to gain,
// and one where everyone does about the same (easy greens, short putts left by easy approaches) has fewer. For each part:
// how far that week's field spread in it (the standard deviation of player-weeks, strokes gained per round, within each year)
// against the tour's usual spread; small samples pulled toward usual (a tournament with few player-weeks says less). A
// player's edge there in each part = their season in it × (room − 1): a good putter's edge shrinks where putting spreads
// less, but never turns into a loss. Fit vs a normal week: those added up. Their own record there beside it.
// It's Stats' Course Fit tab; the old #/course-fit address opens Stats on it.
import { el, mount } from "../ui.js";
const theE = (n) => (/^the\s/i.test(String(n || "")) ? n : `the ${n}`); // (update 820: "The American Express", not "the The …")
import * as PI from "../playerInsights.js";
import { card, samp, sg2, cls } from "./insightPages.js";
import { openStatsTab, lastName } from "../current.js";
import { fitShotsBlock } from "./fitShotsView.js"; // (update 862)

export function render() { openStatsTab("fit"); }

const tot = (r) => (r.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const { evName, eventRoom } = PI; // (update 820: shared with Recommended Practice)

export async function fitTab(box, key, name) {
  mount(box, el("div", { class: "ip ip-embed" }, el("p", { class: "muted ip-wait" }, `Ranking every course for ${name}…`)));
  const wrap = box.firstChild, st = window.__authState || {}, last = lastName(name), self = PI.isSelfKey(key); // (update 834: your own: "you", "your")
  const poss = self ? "your" : `${last}\u2019${/s$/i.test(last) ? "" : "s"}`, Poss = self ? "Your" : poss; // (update 838: "Burns’", not "Burns’s")
  const [{ field }, rounds] = await Promise.all([PI.loadField(st).catch(() => ({ field: [] })), PI.loadShots(key, name)]);
  const fp = field.find((p) => p.key === key), base = rounds.length ? rounds : fp?.rounds || [];
  if (!base.length) { mount(wrap, el("p", { class: "muted" }, `No rounds on record for ${name}.`)); return; }
  const tour = [...new Set(base.map((r) => r.tour).filter(Boolean))].sort((a, b) => base.filter((r) => r.tour === b).length - base.filter((r) => r.tour === a).length)[0] || null;
  const year = [...new Set(base.filter((r) => !tour || r.tour === tour).map(PI.yrOf))].sort().at(-1);
  const P = PI.profile(base, { year, tour, field, key }), season = PI.CATS.reduce((t, c) => t + (P.cat[c] || 0), 0);
  // (update 952) by course: each course once (its own field spread, the player's history there, every tournament held there),
  // the tournaments under it; a tournament whose course the stats file doesn't name stays a row of its own
  const { evs: D, mid } = eventRoom(field, tour, { by: "course" });
  const evList = (d) => (d.events || []).map((e) => e.name), evLine = (d) => (d.noCourse ? "" : (d.events || []).map((e) => `${e.name} (${e.yrs.length > 1 ? `${e.yrs[0]}-${e.yrs.at(-1).slice(2)}` : e.yrs[0]})`).join(" \u00b7 "));
  // (update 824) the official results (each year in the stats file) and who's entered in the coming events, when the live feed has them
  const code = PI.tourCodeOf(tour); await Promise.all([PI.ensureFields().catch(() => null), code ? PI.ensureResults(code, [...new Set(D.flatMap((d) => d.yrs))]).catch(() => null) : null]);
  const enteredIn = code ? (PI.fieldEventsSync(name, code) || []) : [], entered = (n) => enteredIn.find((e) => PI.matchEventName(e.name, [n]));
  if (!D.length) { mount(wrap, el("p", { class: "muted" }, `Not enough of the ${tour || "tour"}'s courses in the stats file to rank yet.`)); return; }
  // (update 862) the shot files: a tournament whose course has shot data adds what the player's misses (off the tee, the
  // approach) and blow-ups are worth there; each capped at ±0.75 a round so one course's quirks can't swamp the rest
  let metas = [], prof = null, usual = null, FS = null;
  try { const [{ listHeatCourses }, M] = await Promise.all([import("../courseHeat.js"), import("../courseFitShots.js")]); FS = M; metas = (await listHeatCourses()).filter(M.hasFit); if (metas.length) { prof = M.missProfile(key, metas); usual = M.usualExposure(metas); } } catch (e) { console.warn("course fit shots", e); }
  const cap = (v) => Math.max(-0.75, Math.min(0.75, v || 0));
  const shotFor = (n) => { if (!FS || !prof) return null; const m = FS.metaForEvent(metas, n, PI.matchEventName); if (!m) return null; const mf = FS.missFit(prof, m.fit, usual); mf.tee = cap(mf.tee); mf.app = cap(mf.app); mf.blow = cap(mf.blow); mf.total = mf.tee + mf.app + mf.blow; return { meta: m, mf }; };
  // their own record at each tournament (every year, their own file or the stats file)
  const mine = (fp?.rounds || base).filter((r) => !tour || r.tour === tour);
  // (update 950) course history: how they've actually played there against their own usual in those same years (the rest
  // of that season's rounds), in total and in each part of the game; blended with the game fit by rounds played there:
  // history counts for half once there are KH rounds of it (a week or two there is mostly luck; ten years of it isn't)
  const KH = 32, RSD = 2.8, inC = (r, c) => (r.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg || 0 : 0), 0);
  const U = new Map(); for (const r of mine) { if (r.eventLevel) continue; const y = PI.yrOf(r), o = U.get(y) || U.set(y, { n: 0, s: 0, c: Object.fromEntries(PI.CATS.map((c) => [c, 0])) }).get(y); o.n++; o.s += tot(r); for (const c of PI.CATS) o.c[c] += inC(r, c); }
  const histOf = (here) => { const by = new Map(); for (const r of here) { if (r.eventLevel) continue; const y = PI.yrOf(r); (by.get(y) || by.set(y, []).get(y)).push(r); }
    let n = 0, s = 0; const cs = Object.fromEntries(PI.CATS.map((c) => [c, 0])), yrs = [];
    for (const [y, hs] of by) { const u = U.get(y), rest = u ? u.n - hs.length : 0; if (rest < 8) continue; // (their usual that year: 8 or more other rounds)
      yrs.push(y); for (const r of hs) { n++; s += tot(r) - (u.s - hs.reduce((t, q) => t + tot(q), 0)) / rest; for (const c of PI.CATS) cs[c] += inC(r, c) - (u.c[c] - hs.reduce((t, q) => t + inC(q, c), 0)) / rest; } }
    return n ? { n, resid: s / n, cat: Object.fromEntries(PI.CATS.map((c) => [c, cs[c] / n])), yrs: yrs.sort() } : null; };
  const rows = D.map((d) => { const here = mine.filter((r) => PI.courseGroupOf(r) === d.key);
    const parts = PI.CATS.map((c) => ({ c, room: d.room[c], me: P.cat[c] || 0, edge: (P.cat[c] || 0) * (d.room[c] - 1) }));
    const eff0 = parts.reduce((t, x) => t + x.edge, 0), sh = evList(d).map(shotFor).find(Boolean) || null, eff = eff0 + (sh ? sh.mf.total : 0);
    const hist = histOf(here), adj = hist ? (KH * eff + hist.n * hist.resid) / (KH + hist.n) : eff;
    return { ...d, fit: season + adj, eff, adj, hist, eff0, sh, here: here.length, hereSg: here.length ? here.reduce((t, r) => t + tot(r), 0) / here.length : null, parts }; }).sort((a, b) => b.adj - a.adj);
  const xx = (v) => `${v.toFixed(2)}×`, part = (c) => PI.CATN[c].toLowerCase();
  const why = (r) => { const most = [...r.parts].sort((a, b) => b.room - a.room)[0], least = [...r.parts].sort((a, b) => a.room - b.room)[0], big = [...r.parts].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
    const edgeTxt = Math.abs(big.edge) < 0.01 ? `${Poss} game is worth about the same here as in a normal week.`
      : big.me >= 0 ? `${Poss} ${part(big.c)}, a strength (${sg2(big.me)} per round in a normal week), is worth ${Math.abs(big.edge).toFixed(2)} ${big.edge >= 0 ? "more" : "less"} here.`
      : `${Poss} ${part(big.c)}, a weakness (${sg2(big.me)} per round in a normal week), costs ${Math.abs(big.edge).toFixed(2)} ${big.edge < 0 ? "more" : "less"} here.`;
    return `Here, ${part(most.c)} matters most (${xx(most.room)} as much as in a normal week) and ${part(least.c)} least (${xx(least.room)}). ${edgeTxt}`; }; // (update 838: plain words)
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.adj)));
  // (update 950) why history and the game fit disagree: the part of the game where they've played most differently there
  // from what the fit expects, and whether that's more than luck over that many rounds (a round's strokes gained swings
  // about ±${RSD} on its own, so N rounds' average about ±RSD/√N)
  const Who = self ? "You" : last, them = self ? "you" : last, their = self ? "your" : poss; // (update 958: the name, not they / their)
  const histWhy = (r) => { const h = r.hist;
    if (!h) return `${self ? "You haven't" : `${last} hasn't`} played it enough on record to judge (a year there needs 8 other rounds that season to compare with): the overall edge is the game edge.`;
    const pred = Object.fromEntries(r.parts.map((x) => [x.c, x.edge + (r.sh ? (x.c === "OTT" ? r.sh.mf.tee : x.c === "APP" ? r.sh.mf.app : 0) : 0)]));
    const gap = h.resid - r.eff, se = RSD / Math.sqrt(h.n), big = [...PI.CATS].sort((a, b) => Math.abs(h.cat[b] - pred[b]) - Math.abs(h.cat[a] - pred[a]))[0];
    const yrs = h.yrs.length > 1 ? `${h.yrs[0]}-${h.yrs.at(-1).slice(2)}` : h.yrs[0];
    const lines = [`${Who} ${self ? "have" : "has"} played ${h.n} rounds there (${yrs}): ${sg2(h.resid)} a round against ${their} usual those years. The game edge expected ${sg2(r.eff)}.`];
    if (Math.abs(gap) < 0.15) lines.push("History agrees with the game edge.");
    else { lines.push(`${gap > 0 ? "Better" : "Worse"} than the game edge expects by ${Math.abs(gap).toFixed(2)} a round, mostly ${PI.CATN[big].toLowerCase()}: ${sg2(h.cat[big])} a round there against ${their} usual, where the game edge expected ${sg2(pred[big])}.`);
      lines.push(Math.abs(gap) <= 1.5 * se ? `Over ${h.n} rounds, luck alone moves an average by about ±${se.toFixed(2)} a round, so this may just be luck.` : `That's more than luck alone explains over ${h.n} rounds (about ±${se.toFixed(2)}): something about the place suits ${them} ${gap > 0 ? "better" : "less"} than ${their} stats say.`); }
    lines.push(`Overall edge ${sg2(r.adj)}: history counts for ${Math.round((100 * h.n) / (KH + h.n))}% (${h.n} rounds; it counts for half at ${KH}).`);
    return lines.join(" "); };
  // (update 820) opened: why, the parts, and their own weeks there (every year in the stats file), side by side
  // the official finish when the results are in; else their place by strokes gained among the file's players (marked ≈)
  // (update 834) two columns: the official finish (Won, T5, Missed cut …) where the results are in (else their place by
  // strokes gained among those who played every round, marked ≈), and their rank that week by strokes gained per round
  // among everyone there, whatever rounds they played
  const fin = (h, evName) => { const o = code ? PI.officialSync(evName, h.yr, name, code) : null; if (o?.pos) { h.official = true; return PI.posText(o.pos); }
    return h.cut ? "Missed cut" : h.pos == null ? "\u2014" : `\u2248${h.tied ? "T" : ""}${h.pos}`; };
  const sgRk = (h) => (h.sgPos ? `${h.sgTied ? "T" : ""}${h.sgPos} of ${h.of}` : "\u2014");
  const detail = (r) => { const H = PI.courseHistory(field, key, r.key, tour);
    const hist = H.length ? el("table", { class: `ip-t cf-hist${new Set(H.map((h) => h.ev)).size <= 1 ? " cf-one" : ""}` }, [el("thead", {}, el("tr", {}, ["Year", "Tournament", "Finish", "SG rank", H.some((h) => h.eventLevel) ? "Events" : "Rounds", "SG per round", ...PI.CATS.map((c) => ({ OTT: "OTT", APP: "APP", ARG: "ARG", PUTT: "PUTT" })[c])].map((h, i) => el("th", { class: i >= 2 ? "num" : null }, h)))),
      el("tbody", {}, H.map((h) => el("tr", {}, [el("td", {}, h.yr), el("td", {}, h.ev || "\u2014"), el("td", { class: "num strong" }, fin(h, h.ev)), el("td", { class: "num" }, sgRk(h)), el("td", { class: "num" }, String(h.rounds)), el("td", { class: `num strong ${cls(h.sg)}` }, sg2(h.sg)), ...PI.CATS.map((c) => el("td", { class: `num ${cls(h.cat[c])}` }, sg2(h.cat[c])))])))])
      : el("p", { class: "muted" }, `${self ? "You haven't" : `${last} hasn't`} played it on record.`);
    const shBlock = r.sh ? el("div", { class: "cf-shots" }, [el("p", { class: "cf-sub" }, `From the shot data at ${r.sh.meta.name}`),
      el("p", { class: "muted small" }, `Game edge vs a normal week ${sg2(r.eff)}: the parts of the game ${sg2(r.eff0)}, ${poss} misses off the tee ${sg2(r.sh.mf.tee)}, approaches ${sg2(r.sh.mf.app)}, blow-ups ${sg2(r.sh.mf.blow)}.`),
      fitShotsBlock(r.sh.meta, { prof, mf: r.sh.mf, who: last, self })]) : el("p", { class: "muted small cf-noshots" }, "No shot data for this course yet: the fit is from the stats file's parts of the game only.");
    return el("div", { class: "cf-det" }, [el("p", { class: "cf-why" }, why(r)), el("p", { class: "cf-why cf-histwhy" }, [el("b", {}, "Course history: "), histWhy(r)]), shBlock, r.small ? el("p", { class: "cf-small" }, `Small field (about ${Math.round(r.perYr)} players a year in the file, against about ${Math.round(mid)} usually; likely no cut): a rough guide.`) : null,
      el("div", { class: "cf-cols" }, [
        el("div", {}, [el("p", { class: "cf-sub" }, "What the course asks"), el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["Part", "Impact here", "Normally", "Worth here"].map((h, i) => el("th", { class: i ? "num" : null }, h)))),
          el("tbody", {}, r.parts.map((x) => el("tr", {}, [el("td", {}, PI.CATN[x.c]), el("td", { class: "num strong" }, [xx(x.room), el("span", { class: "cf-arrow" }, x.room > 1.03 ? " ▲" : x.room < 0.97 ? " ▼" : "")]), el("td", { class: `num ${cls(x.me)}` }, `${sg2(x.me)} per round`), el("td", { class: `num strong ${cls(x.edge)}` }, sg2(x.edge))])))])]),
        el("div", {}, [el("p", { class: "cf-sub" }, `${self ? "You" : last} at ${r.noCourse ? theE(r.name) : r.name}`), hist])]),
      el("p", { class: "muted small" }, `Impact vs usual: how far the field spread out in each part here (${r.n} player-weeks, ${r.yrs.length > 1 ? `${r.yrs[0]}-${r.yrs.at(-1).slice(2)}` : r.yrs[0]}) against a normal ${tour || "tour"} week, 1.00× being usual. What it's worth here: ${Poss} normal week in that part × (impact − 1). Projected there (with course history): ${sg2(r.fit)} strokes gained per round.${H.length ? " Finish: the official finish where the results are in (≈: their place by strokes gained among those who played every round, until the results are in). SG rank: their rank that week by strokes gained per round, among everyone in the stats file, whatever rounds they played. The parts are strokes gained per round." : ""}`)]); };
  const table = el("div", { class: "ip-tw" }, el("table", { class: "ip-t cf-t" }, [
    el("thead", {}, el("tr", {}, ["#", "Course", "Game edge", "History", "Overall edge", ""].map((h, i) => el("th", { class: i >= 2 && i <= 4 ? "num" : null, title: ["", "", "What their game gains on the field here, against a normal week", "How they've actually played there against their usual those years (rounds there)", "The two together: history counts more the more rounds there", ""][i] || null }, h)))),
    el("tbody", {}, rows.flatMap((r, i) => { const open = el("tr", { class: "cf-open", hidden: true }, el("td", { colspan: "6" }, null));
      const tr = el("tr", { class: "cf-tr", tabindex: "0", role: "button", "aria-expanded": "false" }, [el("td", { class: "ip-rk" }, String(i + 1)), el("td", {}, [el("span", { class: "cf-caret", "aria-hidden": "true" }, "▸"), r.name, evLine(r) ? el("small", { class: "cf-evs" }, evLine(r)) : null, r.small ? el("span", { class: "cf-tag", title: "Small field: a rough guide" }, "small field") : null, r.sh ? el("span", { class: "cf-tag cf-sh", title: "Includes the shot data: misses and blow-up holes" }, "shot data") : null, (() => { const e = evList(r).map(entered).find(Boolean); return e ? el("span", { class: "cf-tag cf-in", title: `${name} is in the field${e.start ? ` (${e.start})` : ""}` }, "✓ entered") : null; })()]),
        el("td", { class: `num ${cls(r.eff)}` }, sg2(r.eff)),
        el("td", { class: `num ${r.hist ? cls(r.hist.resid) : "muted"}` }, r.hist ? [sg2(r.hist.resid), el("small", { class: "cf-rds" }, `${r.hist.n} rds`)] : "—"),
        el("td", { class: `num strong ${cls(r.adj)}` }, sg2(r.adj)),
        el("td", { class: "cf-bart" }, el("span", { class: "cf-mid" }, el("i", { class: r.adj >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(r.adj) / max) * 50)}%` })))]);
      const toggle = () => { const on = open.hidden; if (on && !open.firstChild.firstChild) open.firstChild.append(detail(r)); open.hidden = !on; tr.classList.toggle("on", on); tr.setAttribute("aria-expanded", String(on)); };
      tr.addEventListener("click", toggle); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      return [tr, open]; }))]));
  const lead = (r) => { const big = [...r.parts].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
    // (update 862) the shot data's part, when it's the bigger: their misses (or blow-ups) there
    if (r.sh && Math.abs(r.sh.mf.total) > Math.abs(big.edge)) { const m = r.sh.mf, k = [["tee", "misses off the tee"], ["app", "approach misses"], ["blow", "blow-ups"]].sort((a, b) => Math.abs(m[b[0]]) - Math.abs(m[a[0]]))[0];
      return `${self ? "your" : poss} ${k[1]} ${m[k[0]] >= 0 ? "suit" : "hurt"} ${self ? "you" : "them"} there (${sg2(m[k[0]])} a round)${m.holes[0]?.cost > 0.05 && m[k[0]] < 0 ? `, most on No. ${m.holes[0].h}` : ""}`; }
    return PI.fitWords(big, self ? "your" : `${last}’s`.replace(/s’s$/, "s’"), self ? "" : last); }; // (update 838: plain words)
  // (update 886) what adds up to the fit: each part of the game's share (their number × how much more or less it matters there), and the misses
  const parts = (r) => { const xs = r.parts.filter((x) => Math.abs(x.edge) >= 0.005).sort((a, b) => b.edge - a.edge).map((x) => `${PI.CATN[x.c].toLowerCase()} ${sg2(x.edge)} (${sg2(x.me)} × ${(x.room - 1 >= 0 ? "+" : "−") + Math.abs(x.room - 1).toFixed(2)})`);
    if (r.sh && Math.abs(r.sh.mf.total) >= 0.005) xs.push(`misses ${sg2(r.sh.mf.total)}`); return xs.length ? ` · adds up from: ${xs.join(", ")}` : ""; };
  const best = rows.slice(0, 3), worst = rows.slice(-3).reverse();
  const hTxt = (r) => (r.hist ? `; history there ${sg2(r.hist.resid)} vs ${their} usual over ${r.hist.n} rounds` : "; no history there");
  const fold = (sec) => { const kick = sec.querySelector(".ip-kick"), d = el("details", { class: "cf-fold" }, [el("summary", {}, [kick])]); sec.insertBefore(d, sec.firstChild); while (d.nextSibling) d.append(d.nextSibling); return sec; };
  mount(wrap, [el("header", { class: "ip-head ip-head-slim" }, el("div", {}, [el("p", { class: "ip-kick", style: "--ipc:#64d2ff" }, `Course Edge · ${tour || ""} ${year}`.trim()), el("h2", { class: "ip-h" }, `Where ${self ? "you gain" : `${last} gains`} the most on the field`)])),
    // (update 950) folded to start (a tap opens each), on the overall fit, with what history added
    el("div", { class: "ip-grid2" }, [fold(card("Biggest edges", "#30d158", el("ul", { class: "ip-bul" }, best.map((r) => el("li", {}, [el("b", {}, r.name), `: ${sg2(r.adj)} per round overall; game edge ${sg2(r.eff)} (${lead(r)}${parts(r)})${hTxt(r)}`]))))),
      fold(card("Toughest courses", "#ff453a", el("ul", { class: "ip-bul" }, worst.map((r) => el("li", {}, [el("b", {}, r.name), `: ${sg2(r.adj)} per round overall; game edge ${sg2(r.eff)} (${lead(r)}${parts(r)})${hTxt(r)}`])))))]),
    table,
    samp(`Edge: how much better (or worse) than the field ${self ? "you" : last} should do at each course, in strokes per round. Game edge: a course rewards the parts of the game where its field spreads out the most. Where everyone putts about the same (easy greens), a great putter gains little; where approach play separates players, a great iron player gains a lot. So a course that suits everyone gives no one an edge. It\u2019s ${Poss.toLowerCase() === "your" ? "your" : Poss} ${year} season in each part (${P.n} rounds) times how much more (or less) that part separates the field there than in a normal ${tour || "tour"} week (every year in the stats file; closer to a normal week when few have played it). History: how ${self ? "you\u2019ve" : `${last} has`} actually played there, against ${their} usual that same season (8 or more other rounds that year to compare with). Overall edge: the two together, history counting more the more rounds there are (half at ${KH}). Tap a course to see why. A guide, not a forecast.`)]);
}
