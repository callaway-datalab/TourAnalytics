// (update 817) Course Fit, one player: every tournament on their main tour ranked by how well their game suits it, and why.
// (update 819) Room to gain: strokes gained exists because players differ, so a part of the game where the field spreads out
// more at a tournament (hard greens, long approaches into firm greens …) has more strokes there for a good player to gain,
// and one where everyone does about the same (easy greens, short putts left by easy approaches) has fewer. For each part:
// how far that week's field spread in it (the standard deviation of player-weeks, strokes gained a round, within each year)
// against the tour's usual spread; small samples pulled toward usual (a tournament with few player-weeks says less). A
// player's edge there in each part = their season in it × (room − 1): a good putter's edge shrinks where putting spreads
// less, but never turns into a loss. Fit vs a normal week: those added up. Their own record there beside it.
// It's Stats' Course Fit tab; the old #/course-fit address opens Stats on it.
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { card, samp, sg2, cls } from "./insightPages.js";
import { openStatsTab, lastName } from "../current.js";

export function render() { openStatsTab("fit"); }

const tot = (r) => (r.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const inCat = (r, c) => (r.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg || 0 : 0), 0);
const evName = (e) => String(e || "").replace(/\s+\d{4}$/, "").trim();

/** every tournament on a tour: { name, yrs, n (player-weeks), perYr, small, sd {cat}, room {cat: × usual, shrunk} } */
const SHRINK = 60; // player-weeks at which a tournament's own spread counts half (and the tour's usual, half)
function eventRoom(field, tour) {
  const by = new Map(); // event → year|player → rounds
  for (const p of field) for (const r of p.rounds) { if (tour && r.tour !== tour) continue; const e = evName(r.event); if (!e) continue;
    const m = by.get(e) || by.set(e, new Map()).get(e), k = `${PI.yrOf(r)}|${p.key}`; (m.get(k) || m.set(k, []).get(k)).push(r); }
  const evs = [];
  for (const [name, m] of by) {
    const weeks = [...m].map(([k, rs]) => ({ yr: k.split("|")[0], v: Object.fromEntries(PI.CATS.map((c) => [c, rs.reduce((t, r) => t + inCat(r, c), 0) / rs.length])) }));
    if (weeks.length < 20) continue; // too few on record
    const yrs = [...new Set(weeks.map((w) => w.yr))].sort();
    // the spread within each year (a year's conditions shift everyone alike), pooled over the years
    const sd = Object.fromEntries(PI.CATS.map((c) => { let ss = 0, df = 0; for (const y of yrs) { const xs = weeks.filter((w) => w.yr === y).map((w) => w.v[c]); if (xs.length < 3) continue; const mu = xs.reduce((t, x) => t + x, 0) / xs.length; ss += xs.reduce((t, x) => t + (x - mu) ** 2, 0); df += xs.length - 1; } return [c, df > 0 ? Math.sqrt(ss / df) : null]; }));
    if (PI.CATS.some((c) => sd[c] == null)) continue;
    evs.push({ name, yrs, n: weeks.length, perYr: weeks.length / yrs.length, sd });
  }
  // the tour's usual spread in each part: every tournament's, weighted by its player-weeks
  const usual = Object.fromEntries(PI.CATS.map((c) => { const w = evs.reduce((t, e) => t + e.n, 0); return [c, w ? Math.sqrt(evs.reduce((t, e) => t + e.n * e.sd[c] ** 2, 0) / w) : null]; }));
  const mid = [...evs.map((e) => e.perYr)].sort((a, b) => a - b)[Math.floor(evs.length / 2)] || 0; // (a small field: well under the tour's usual field in the file)
  for (const e of evs) { const k = e.n / (e.n + SHRINK); e.small = e.perYr < 0.6 * mid;
    e.raw = Object.fromEntries(PI.CATS.map((c) => [c, usual[c] ? e.sd[c] / usual[c] : 1]));
    e.room = Object.fromEntries(PI.CATS.map((c) => [c, Math.min(1.8, Math.max(0.5, 1 + (e.raw[c] - 1) * k))])); }
  return { evs, usual, mid };
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
  const { evs: D, mid } = eventRoom(field, tour);
  if (!D.length) { mount(wrap, el("p", { class: "muted" }, `Not enough of the ${tour || "tour"}'s tournaments in the stats file to rank yet.`)); return; }
  // their own record at each tournament (every year, their own file or the stats file)
  const mine = (fp?.rounds || base).filter((r) => !tour || r.tour === tour);
  const rows = D.map((d) => { const here = mine.filter((r) => evName(r.event) === d.name);
    const parts = PI.CATS.map((c) => ({ c, room: d.room[c], me: P.cat[c] || 0, edge: (P.cat[c] || 0) * (d.room[c] - 1) }));
    const eff = parts.reduce((t, x) => t + x.edge, 0);
    return { ...d, fit: season + eff, eff, here: here.length, hereSg: here.length ? here.reduce((t, r) => t + tot(r), 0) / here.length : null, parts }; }).sort((a, b) => b.eff - a.eff);
  const xx = (v) => `${v.toFixed(2)}×`, part = (c) => PI.CATN[c].toLowerCase();
  const why = (r) => { const most = [...r.parts].sort((a, b) => b.room - a.room)[0], least = [...r.parts].sort((a, b) => a.room - b.room)[0], big = [...r.parts].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
    const edgeTxt = Math.abs(big.edge) < 0.01 ? `${last}’s game is worth about the same here as in a normal week.`
      : big.me >= 0 ? `${last}’s ${part(big.c)}, a strength (${sg2(big.me)} a round in a normal week), is worth ${Math.abs(big.edge).toFixed(2)} ${big.edge >= 0 ? "more" : "less"} here.`
      : `${last}’s ${part(big.c)}, a weakness (${sg2(big.me)} a round in a normal week), costs ${Math.abs(big.edge).toFixed(2)} ${big.edge < 0 ? "more" : "less"} here.`;
    return `Most room to gain here: ${part(most.c)} (${xx(most.room)} usual). Least: ${part(least.c)} (${xx(least.room)}). ${edgeTxt}`; };
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.eff)));
  const detail = (r) => el("div", { class: "cf-det" }, [el("p", {}, why(r)), r.small ? el("p", { class: "cf-small" }, `Small field (about ${Math.round(r.perYr)} players a year in the file, against about ${Math.round(mid)} usually; likely no cut): a rough guide.`) : null,
    el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["Part of the game", "Room to gain here", `${last} in a normal week`, "Edge here vs usual"].map((h, i) => el("th", { class: i ? "num" : null }, h)))),
      el("tbody", {}, r.parts.map((x) => el("tr", {}, [el("td", {}, PI.CATN[x.c]), el("td", { class: "num strong" }, [xx(x.room), el("span", { class: "cf-arrow" }, x.room > 1.03 ? " ▲" : x.room < 0.97 ? " ▼" : "")]), el("td", { class: `num ${cls(x.me)}` }, `${sg2(x.me)} a round`), el("td", { class: `num strong ${cls(x.edge)}` }, sg2(x.edge))])))]),
    el("p", { class: "muted small" }, `Room to gain: how far the field spread out in each part here (${r.n} player-weeks, ${r.yrs.length > 1 ? `${r.yrs[0]}-${r.yrs.at(-1).slice(2)}` : r.yrs[0]}) against a normal ${tour || "tour"} week, 1.00× being usual. Edge here vs usual: ${last}’s normal week in that part × (room − 1). Projected there: ${sg2(r.fit)} strokes gained a round. ${r.here ? `${last} on record there: ${r.here} rounds, ${sg2(r.hereSg)} a round.` : `${last} hasn't played it on record.`}`)]);
  const table = el("div", { class: "ip-tw" }, el("table", { class: "ip-t cf-t" }, [
    el("thead", {}, el("tr", {}, ["#", "Tournament", "Fit vs a normal week", "", "Rounds there"].map((h, i) => el("th", { class: i === 2 || i === 4 ? "num" : null }, h)))),
    el("tbody", {}, rows.flatMap((r, i) => { const open = el("tr", { class: "cf-open", hidden: true }, el("td", { colspan: "5" }, null));
      const tr = el("tr", { class: "cf-tr", tabindex: "0", role: "button", "aria-expanded": "false" }, [el("td", { class: "ip-rk" }, String(i + 1)), el("td", {}, [el("span", { class: "cf-caret", "aria-hidden": "true" }, "▸"), r.name, r.small ? el("span", { class: "cf-tag", title: "Small field: a rough guide" }, "small field") : null]),
        el("td", { class: `num strong ${cls(r.eff)}` }, sg2(r.eff)),
        el("td", { class: "cf-bart" }, el("span", { class: "cf-mid" }, el("i", { class: r.eff >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(r.eff) / max) * 50)}%` }))),
        el("td", { class: "num muted" }, r.here ? String(r.here) : "—")]);
      const toggle = () => { const on = open.hidden; if (on && !open.firstChild.firstChild) open.firstChild.append(detail(r)); open.hidden = !on; tr.classList.toggle("on", on); tr.setAttribute("aria-expanded", String(on)); };
      tr.addEventListener("click", toggle); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      return [tr, open]; }))]));
  const lead = (r) => { const big = [...r.parts].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0]; return `${part(big.c)} has ${xx(big.room)} the usual room to gain (${last}: ${sg2(big.me)} a round)`; };
  const best = rows.slice(0, 3), worst = rows.slice(-3).reverse();
  mount(wrap, [el("header", { class: "ip-head ip-head-slim" }, el("div", {}, [el("p", { class: "ip-kick", style: "--ipc:#64d2ff" }, `Course Fit · ${tour || ""} ${year}`.trim()), el("h2", { class: "ip-h" }, `Where ${last}’s game fits best`)])),
    el("div", { class: "ip-grid2" }, [card("Best fits", "#30d158", el("ul", { class: "ip-bul" }, best.map((r) => el("li", {}, [el("b", {}, r.name), `: ${sg2(r.eff)} a round better suited than a normal week; ${lead(r)}`])))),
      card("Toughest fits", "#ff453a", el("ul", { class: "ip-bul" }, worst.map((r) => el("li", {}, [el("b", {}, r.name), `: ${sg2(r.eff)} a round; ${lead(r)}`]))))]),
    table,
    samp(`Room to gain: strokes gained only exists because players differ, so where the field spreads out more in a part of the game there's more for a good player to gain, and where everyone does about the same (easy greens, short putts) there's less. For each tournament and part: the spread of that week's field (every year in the stats file) against a normal ${tour || "tour"} week, pulled toward usual when there are few player-weeks. Fit vs a normal week: ${last}’s ${year} season in each part (${P.n} rounds) × (room − 1), added up, strokes a round. It shows where there's more room, not why (the shot-by-shot data could, for courses in Strategy Maps). A guide to fit, not a forecast.`)]);
}
