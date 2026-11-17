// (update 815) The player's page; (update 817) it's Stats' Overview tab now, for the header's player: no filters, buttons or
// player pickers of its own, only a + to add them to your favorites. The season (strokes gained in total and each part of
// the game, with tour ranks), form (the last 12 rounds against the 12 before, round by round; the DP World Tour 3 events
// against 3), where the strokes go by distance, the clubs and ball in the bag and how each is doing, and the fit for the
// next event. Every number says what it rests on. The old #/dossier address opens Stats on this tab.
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { makeCharts } from "../homeCharts.js";
import { bar0 } from "../miniCharts.js";
import { card, samp, sg2, sg3, cls, ord } from "./insightPages.js";
import { setCurrent, openStatsTab, lastName } from "../current.js";

export async function render() {
  const m = /[?&]player=([^&]+)/.exec(location.hash); if (m) setCurrent({ key: decodeURIComponent(m[1]) });
  const f = /[?&]focus=([^&]+)/.exec(location.hash); try { if (f) sessionStorage.setItem("ta.ovFocus", decodeURIComponent(f[1])); } catch { /* */ }
  openStatsTab("overview");
}

/** a + beside the name: add them to your favorites (★ once they are; tap to take them off) */
async function favButton(key, name) {
  let wl; try { wl = await import("../watchlist.js"); await wl.loadWatch().catch(() => {}); } catch { return null; }
  const st = window.__authState || {}; if (!st.isAdmin && !st.isTeam) return null; // (a player: there's only them)
  const b = el("button", { type: "button", class: "ip-fav" });
  const paint = () => { const on = (wl.watchPrefs().players || []).includes(key); b.textContent = on ? "★" : "+"; b.classList.toggle("on", on); b.title = on ? `${name} is a favorite (tap to take them off)` : `Add ${name} to your favorites`; b.setAttribute("aria-label", b.title); };
  b.addEventListener("click", async () => { b.disabled = true; try { await wl.toggleFavorite(key); } catch (e) { console.warn(e); } b.disabled = false; paint(); });
  paint(); return b;
}

export async function overview(box, key, name) {
  mount(box, el("div", { class: "ip ip-embed" }, el("p", { class: "muted ip-wait" }, `Putting ${name}’s overview together…`)));
  const wrap = box.firstChild, st = window.__authState || {};
  const [{ field }, rounds, fav] = await Promise.all([PI.loadField(st).catch(() => ({ field: [] })), PI.loadShots(key, name), favButton(key, name)]);
  const fp = field.find((p) => p.key === key), base = rounds.length ? rounds : fp?.rounds || [];
  const head = (sub) => el("header", { class: "ip-head ip-head-slim" }, [el("div", {}, [el("p", { class: "ip-kick" }, `Overview${sub ? ` · ${sub}` : ""}`), el("h2", { class: "ip-h" }, [name, fav])])]);
  if (!base.length) { mount(wrap, [head(), el("p", { class: "muted" }, `No rounds on record for ${name}.`)]); return; }
  const tours = [...new Set(base.map((r) => r.tour).filter(Boolean))];
  const tour = [...tours].sort((a, b) => base.filter((r) => r.tour === b).length - base.filter((r) => r.tour === a).length)[0] || null;
  const year = [...new Set(base.filter((r) => !tour || r.tour === tour).map(PI.yrOf))].sort().at(-1);
  const P = PI.profile(base, { year, tour, field, key }), nameS = lastName(name);
  const CH = makeCharts({ el, sg2, avgOf: (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null), inCat: (r, c) => (r.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg : 0), 0), tot: (r) => (r.shots || []).reduce((t, s) => t + s.sg, 0), eventsOf: (rs) => PI.eventsOf(rs), CATN: PI.CATN, bar0 });
  CH.setWide(true);
  // the five numbers
  const tile = (lbl, v, rk, sub) => el("div", { class: "ip-tile" }, [el("span", { class: "ip-tl" }, lbl), el("strong", { class: cls(v) }, sg2(v)), el("span", { class: "ip-ts" }, [rk ? `${ord(rk.r)} of ${rk.n}` : "not ranked", sub ? ` · ${sub}` : ""])]);
  const tiles = el("div", { class: "ip-tiles" }, [tile("SG: Total a round", P.tot, P.ranks.TOTAL, `${P.n} rounds`), ...PI.CATS.map((c) => tile(PI.CATN[c], P.cat[c], P.ranks[c]))]);
  // form
  const F = P.form, formCard = card("Form", "#30d158", F ? [
    el("h3", { class: "ip-h3" }, `${F.a - F.b >= 0 ? "Heating up" : "Cooling off"}: ${sg2(F.a - F.b)} strokes gained a round`),
    el("div", { class: "td ip-chartbox" }, CH.formRounds({ prevR: F.prev, lastR: F.last, n: F.n, FL: F.lbl }, null)),
    el("ul", { class: "ip-bul" }, PI.CATS.map((c) => [c, F.cat[c].a - F.cat[c].b, F.cat[c]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([c, d, o]) => el("li", {}, [`${PI.CATN[c]}: `, el("b", { class: cls(d) }, sg2(d)), ` (${sg2(o.a)} lately, ${sg2(o.b)} before)`]))),
    samp(`The last ${F.lbl} against the ${F.lbl} before, strokes gained a round`)] : [el("p", { class: "muted" }, "Not enough rounds yet for form.")]);
  // where the strokes go (a Home story can ask for one range: it's added if need be, lit and scrolled to)
  let focus = null; try { focus = sessionStorage.getItem("ta.ovFocus"); sessionStorage.removeItem("ta.ovFocus"); } catch { /* */ }
  const fR = focus && focus.includes("|") ? P.ranges.find((o) => `${o.c}|${o.d}` === focus) : null;
  const rows0 = [...P.leaks.slice(0, 3), ...P.strengths.slice(0, 2)], rows = fR && !rows0.includes(fR) ? [...rows0, fR] : rows0, mx = Math.max(0.01, ...rows.map((o) => Math.abs(o.rd)));
  const goesCard = card("Where the strokes go", "#ff453a", [el("h3", { class: "ip-h3" }, "By distance, strokes gained a round"),
    rows.length ? el("div", { class: "ip-bars" }, rows.map((o) => el("div", { class: `ip-barrow${o === fR ? " ip-focus" : ""}` }, [el("span", {}, `${o.c === "PUTT" ? "Putts" : o.c === "ARG" ? "Chips" : "Approach"} ${o.d}`), el("span", { class: "ip-bartrack" }, el("i", { class: o.rd >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(o.rd) / mx) * 100)}%` })), el("b", { class: cls(o.rd) }, sg2(o.rd)), el("span", { class: "ip-barn" }, `${sg3(o.shot)} a shot · ${Math.round(o.n)} shots`)]))) : el("p", { class: "muted" }, "Not enough shots by distance yet."),
    P.leaks[0] ? drillBtn(P.leaks[0], key, name) : null,
    (() => { const b = el("button", { type: "button", class: "ip-link" }, "Plan the practice week →"); b.addEventListener("click", () => openStatsTab("practice", "week")); return b; })(),
    samp(`${year} season, ${P.n} rounds · a range needs 25+ shots`)]);
  // the bag (clubs, the Non-Driver off the tee, and the ball)
  const bagCard = card("In the bag", "#ff9f0a", P.gear.length ? [el("table", { class: "ip-t" }, [el("thead", {}, el("tr", {}, ["Club", "Model", "SG a round", "Rounds"].map((h, i) => el("th", { class: i >= 2 ? "num" : null }, h)))),
    el("tbody", {}, P.gear.map((g) => el("tr", {}, [el("td", {}, g.kind), el("td", {}, [g.model, g.isNew ? el("span", { class: "ip-new" }, "new") : null, g.isNew && g.was ? el("span", { class: "ip-was" }, ` (was ${g.was})`) : null]), el("td", { class: `num ${cls(g.rd)}` }, sg2(g.rd)), el("td", { class: "num" }, String(g.n))])))]),
    samp(`Strokes gained a round with each, over the rounds it was used (${year}): a club in its own part of the game (off the tee for the Driver and Non-Driver), the ball on every shot`)] : [el("p", { class: "muted" }, "No clubs in this player's data.")]);
  const fitBox = card("Next event fit", "#64d2ff", el("p", { class: "muted" }, "Loading the course…"), "ip-fit");
  mount(wrap, [head(`${tour || ""} ${year}`.trim()), tiles, el("div", { class: "ip-grid" }, [formCard, goesCard, bagCard]), fitBox,
    el("p", { class: "ip-foot" }, `Strokes gained against the tour baseline. Ranks among players with 8+ rounds on the ${tour || "tour"} in ${year}.${tours.length > 1 ? ` ${name} also has rounds on the ${tours.filter((t) => t !== tour).join(", ")}: this is their main tour.` : ""}`)]);
  if (focus) requestAnimationFrame(() => { const t = fR ? wrap.querySelector(".ip-focus") : PI.CATS.includes(focus) ? wrap.querySelectorAll(".ip-tile")[1 + PI.CATS.indexOf(focus)] : null; if (t) { t.classList.add("ip-focus"); t.scrollIntoView({ block: "center", behavior: "smooth" }); } });
  // the next event: their fit there
  const list = await import("../courseHeat.js").then((m) => m.listHeatCourses()).catch(() => []), meta = PI.nextCourse(list);
  if (!meta) { mount(fitBox, [el("p", { class: "ip-kick" }, "Next event fit"), el("p", { class: "muted" }, "The next event's course isn't in Strategy Maps yet.")]); return; }
  const C = await PI.loadCourse(meta, [P.rs]).catch(() => null);
  if (!C) { mount(fitBox, [el("p", { class: "ip-kick" }, "Next event fit"), el("p", { class: "muted" }, `${meta.name}'s shots couldn't be read.`)]); return; }
  const fit = PI.fitFor(P, C, key, name), yrsT = C.yrs.length > 1 ? `${C.yrs[0]}-${C.yrs.at(-1).slice(2)}` : C.yrs[0] || "";
  const goFit = el("button", { type: "button", class: "ip-link" }, `Every course and tournament for ${nameS} →`); goFit.addEventListener("click", () => openStatsTab("fit"));
  mount(fitBox, [el("p", { class: "ip-kick" }, `Next event fit · ${PI.NEXT.name}`),
    el("h3", { class: "ip-h3" }, `Projected ${sg2(fit.proj)} strokes gained a round at ${meta.name} (${sg2(fit.vsSeason)} against the season)`),
    el("ul", { class: "ip-bul" }, [...fit.key3.map((x) => el("li", {}, [`${PI.CATN[x.c]} from ${x.l} (${Math.round(x.share * 100)}% of what wins here; ${x.att.toFixed(1)} ${x.c === "PUTT" ? "putts" : x.c === "ARG" ? "chips and pitches" : "approaches"} a round from there): ${nameS} `, el("b", { class: cls(x.me) }, x.me == null ? "not enough shots" : `${sg3(x.me)} a shot`), `, the top 10 there ${sg3(x.top)} (strokes gained a shot)`])),
      el("li", {}, fit.hereRds ? `${fit.hereRds} rounds here on record` : `No rounds here on record: the projection is from the ${year} season`)]),
    goFit,
    samp(`Course: every round on record (${yrsT}, ${C.nRds} rounds) · projected: the ${year} season with the course's mix of distances (covering ${Math.round(fit.coverage * 100)}% of its shots by distance), plus driving`)]);
}

function drillBtn(o, key, name) {
  const msg = el("span", { class: "muted small" }), b = el("button", { type: "button", class: "ip-act" }, `＋ Add a drill: ${o.c === "PUTT" ? "putts" : o.c === "ARG" ? "chips" : "approaches"} from ${o.d}`);
  b.addEventListener("click", async () => { b.disabled = true; try { const [P0, { getState }] = await Promise.all([import("../practice/plan.js"), import("../auth.js")]); const n = await P0.addToPlan(getState(), { items: [{ drill: P0.drillFor(o.c, o.d) }], playerKey: key, playerLabel: name }); mount(msg, n ? "Added to the practice plan." : "It's already in the plan."); }
    catch (e) { console.warn(e); b.disabled = false; mount(msg, "Couldn't add it (practice may not be open for this player)."); } });
  return el("div", { class: "ip-actrow" }, [b, msg]);
}
