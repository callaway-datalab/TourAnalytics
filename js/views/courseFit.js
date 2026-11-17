// (update 817) Course Fit, one player: every tournament on their main tour ranked by how well their game suits it, and why.
// For each tournament (every year on record in the stats file): how much each part of the game separated the top 10 from
// the rest of that week's field, strokes gained a round, as shares of the whole. A player's fit there is their season,
// each part weighted by how much it decides that tournament (an even split, a quarter each, gives back their season).
// Course effect: the fit minus their season, what the tournament's demands do for them. Their own record there beside it.
// It's Stats' Course Fit tab; the old #/course-fit address opens Stats on it.
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { card, samp, sg2, cls } from "./insightPages.js";
import { openStatsTab, lastName } from "../current.js";

export function render() { openStatsTab("fit"); }

const tot = (r) => (r.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const inCat = (r, c) => (r.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg || 0 : 0), 0);
const evName = (e) => String(e || "").replace(/\s+\d{4}$/, "").trim();

/** every tournament on a tour: { name, yrs, n (player-weeks), share {cat: 0-1}, edge {cat: strokes a round} } */
function eventDemands(field, tour) {
  const by = new Map(); // event → year|player → rounds
  for (const p of field) for (const r of p.rounds) { if (tour && r.tour !== tour) continue; const e = evName(r.event); if (!e) continue;
    const m = by.get(e) || by.set(e, new Map()).get(e), k = `${PI.yrOf(r)}|${p.key}`; (m.get(k) || m.set(k, []).get(k)).push(r); }
  const out = [];
  for (const [name, m] of by) {
    const weeks = [...m].map(([k, rs]) => ({ yr: k.split("|")[0], key: k.split("|").slice(1).join("|"), rs, sum: rs.reduce((t, r) => t + tot(r), 0) }));
    if (weeks.length < 20) continue; // too few in the field on record
    const top = new Set(); for (const yr of new Set(weeks.map((w) => w.yr))) weeks.filter((w) => w.yr === yr).sort((a, b) => b.sum - a.sum).slice(0, 10).forEach((w) => top.add(w));
    const mean = (ws, c) => { let a = 0, n = 0; for (const w of ws) for (const r of w.rs) { a += inCat(r, c); n++; } return n ? a / n : 0; };
    const T = weeks.filter((w) => top.has(w)), R = weeks.filter((w) => !top.has(w)); if (T.length < 5 || R.length < 5) continue;
    const edge = Object.fromEntries(PI.CATS.map((c) => [c, mean(T, c) - mean(R, c)])), pos = PI.CATS.reduce((t, c) => t + Math.max(0, edge[c]), 0); if (pos <= 0) continue;
    out.push({ name, yrs: [...new Set(weeks.map((w) => w.yr))].sort(), n: weeks.length, edge, share: Object.fromEntries(PI.CATS.map((c) => [c, Math.max(0, edge[c]) / pos])) });
  }
  return out;
}

export async function fitTab(box, key, name) {
  mount(box, el("div", { class: "ip ip-embed" }, el("p", { class: "muted ip-wait" }, `Ranking every tournament for ${name}…`)));
  const wrap = box.firstChild, st = window.__authState || {}, last = lastName(name);
  const [{ field }, rounds] = await Promise.all([PI.loadField(st).catch(() => ({ field: [] })), PI.loadShots(key, name)]);
  const fp = field.find((p) => p.key === key), base = rounds.length ? rounds : fp?.rounds || [];
  if (!base.length) { mount(wrap, el("p", { class: "muted" }, `No rounds on record for ${name}.`)); return; }
  const tour = [...new Set(base.map((r) => r.tour).filter(Boolean))].sort((a, b) => base.filter((r) => r.tour === b).length - base.filter((r) => r.tour === a).length)[0] || null;
  const year = [...new Set(base.filter((r) => !tour || r.tour === tour).map(PI.yrOf))].sort().at(-1);
  const P = PI.profile(base, { year, tour, field, key }), season = PI.CATS.reduce((t, c) => t + (P.cat[c] || 0), 0);
  const D = eventDemands(field, tour);
  if (!D.length) { mount(wrap, el("p", { class: "muted" }, `Not enough of the ${tour || "tour"}'s tournaments in the stats file to rank yet.`)); return; }
  // their own record at each tournament (every year, their own file or the stats file)
  const mine = (fp?.rounds || base).filter((r) => !tour || r.tour === tour);
  // the tour's usual mix (every tournament's shares, averaged): a tournament's effect is how its mix differs from that
  const avgShare = Object.fromEntries(PI.CATS.map((c) => [c, D.reduce((t, d) => t + d.share[c], 0) / D.length]));
  const rows = D.map((d) => { const here = mine.filter((r) => evName(r.event) === d.name);
    const parts = PI.CATS.map((c) => ({ c, w: d.share[c], avg: avgShare[c], me: P.cat[c] || 0, gain: (d.share[c] - avgShare[c]) * (P.cat[c] || 0) })).sort((a, b) => b.w - a.w);
    const eff = parts.reduce((t, x) => t + x.gain, 0);
    return { ...d, fit: season + eff, eff, here: here.length, hereSg: here.length ? here.reduce((t, r) => t + tot(r), 0) / here.length : null, parts }; }).sort((a, b) => b.eff - a.eff);
  const pc = (v) => `${Math.round(v * 100)}%`;
  const why = (r) => { const big = [...r.parts].sort((x, y) => Math.abs(y.w - y.avg) - Math.abs(x.w - x.avg))[0], helps = [...r.parts].sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain))[0];
    return `${PI.CATN[r.parts[0].c]} decides ${pc(r.parts[0].w)} here (${pc(r.parts[0].avg)} at an average ${tour || "tour"} event)${big.c !== r.parts[0].c ? `; ${PI.CATN[big.c].toLowerCase()} ${pc(big.w)} (usually ${pc(big.avg)})` : ""}. ${last}’s ${PI.CATN[helps.c].toLowerCase()}, ${sg2(helps.me)} a round, ${helps.gain >= 0 ? "helps" : "hurts"} most here (${sg2(helps.gain)}).`; };
  // (update 818) one table, every tournament by course effect; tap a row for everything behind it
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.eff)));
  const detail = (r) => el("div", { class: "cf-det" }, [el("p", {}, why(r)),
    el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["Part of the game", "Decides here", "At an average event", `${last} a round`, "Effect a round"].map((h, i) => el("th", { class: i ? "num" : null }, h)))),
      el("tbody", {}, r.parts.map((x) => el("tr", {}, [el("td", {}, PI.CATN[x.c]), el("td", { class: "num strong" }, pc(x.w)), el("td", { class: "num muted" }, pc(x.avg)), el("td", { class: `num ${cls(x.me)}` }, sg2(x.me)), el("td", { class: `num strong ${cls(x.gain)}` }, sg2(x.gain))])))]),
    el("p", { class: "muted small" }, `Projected there: ${sg2(r.fit)} strokes gained a round (the season, ${sg2(season)}, plus the course effect). ${r.here ? `${last} on record there: ${r.here} rounds, ${sg2(r.hereSg)} a round.` : `${last} hasn't played it on record.`} Based on ${r.n} player-weeks, ${r.yrs.length > 1 ? `${r.yrs[0]}-${r.yrs.at(-1).slice(2)}` : r.yrs[0]}.`)]);
  const table = el("div", { class: "ip-tw" }, el("table", { class: "ip-t cf-t" }, [
    el("thead", {}, el("tr", {}, ["#", "Tournament", "Course effect a round", "", "Rounds there"].map((h, i) => el("th", { class: i === 2 || i === 4 ? "num" : null }, h)))),
    el("tbody", {}, rows.flatMap((r, i) => { const open = el("tr", { class: "cf-open", hidden: true }, el("td", { colspan: "5" }, null));
      const tr = el("tr", { class: "cf-tr", tabindex: "0", role: "button", "aria-expanded": "false" }, [el("td", { class: "ip-rk" }, String(i + 1)), el("td", {}, [el("span", { class: "cf-caret", "aria-hidden": "true" }, "▸"), r.name]),
        el("td", { class: `num strong ${cls(r.eff)}` }, sg2(r.eff)),
        el("td", { class: "cf-bart" }, el("span", { class: "cf-mid" }, el("i", { class: r.eff >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(r.eff) / max) * 50)}%` }))),
        el("td", { class: "num muted" }, r.here ? String(r.here) : "—")]);
      const toggle = () => { const on = open.hidden; if (on && !open.firstChild.firstChild) open.firstChild.append(detail(r)); open.hidden = !on; tr.classList.toggle("on", on); tr.setAttribute("aria-expanded", String(on)); };
      tr.addEventListener("click", toggle); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      return [tr, open]; }))]));
  const best = rows.slice(0, 3), worst = rows.slice(-3).reverse();
  mount(wrap, [el("header", { class: "ip-head ip-head-slim" }, el("div", {}, [el("p", { class: "ip-kick", style: "--ipc:#64d2ff" }, `Course Fit · ${tour || ""} ${year}`.trim()), el("h2", { class: "ip-h" }, `Where ${last}’s game fits best`)])),
    el("div", { class: "ip-grid2" }, [card("Best fits", "#30d158", el("ul", { class: "ip-bul" }, best.map((r) => el("li", {}, [el("b", {}, r.name), `: ${sg2(r.eff)} a round against ${last}’s season; ${PI.CATN[r.parts[0].c].toLowerCase()} decides ${pc(r.parts[0].w)} (usually ${pc(r.parts[0].avg)})`])))),
      card("Toughest fits", "#ff453a", el("ul", { class: "ip-bul" }, worst.map((r) => el("li", {}, [el("b", {}, r.name), `: ${sg2(r.eff)} a round; ${PI.CATN[r.parts[0].c].toLowerCase()} decides ${pc(r.parts[0].w)} (usually ${pc(r.parts[0].avg)})`]))))]),
    table,
    samp(`For each tournament: the top 10 each year against the rest of the field, strokes gained a round in each part of the game, as shares of what separates them (all years in the stats file). Course effect: ${last}’s ${year} season in each part (${P.n} rounds) × how much more (or less) that part decides this tournament than an average ${tour || "tour"} event, added up, in strokes a round; ranked by it. Projected: the season (${sg2(season)} a round) plus the course effect. A guide to fit, not a forecast: form, the field and the weather move results more.`)]);
}
