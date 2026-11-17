// (update 815) The player's page; (update 817) it's Stats' Overview tab now, for the header's player: no filters, buttons or
// player pickers of its own, only a + to add them to your favorites. The season (strokes gained in total and each part of
// the game, with tour ranks), form (the last 12 rounds against the 12 before, round by round; the DP World Tour 3 events
// against 3), where the strokes go by distance, the clubs and ball in the bag and how each is doing, and the fit for the
// next event. Every number says what it rests on. The old #/dossier address opens Stats on this tab.
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { makeCharts } from "../homeCharts.js";
import { bar0 } from "../miniCharts.js";
import { card, samp, sg2, sg3, cls, ord, popup } from "./insightPages.js";
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
    // (update 820) every part of the game; tap one for its own round by round (event by event on the DP World Tour)
    el("ul", { class: "ip-formlist" }, PI.CATS.map((c) => [c, F.cat[c].a - F.cat[c].b, F.cat[c]]).sort((a, b) => b[1] - a[1]).map(([c, d, o]) => { const li = el("li", { class: "ip-click", role: "button", tabindex: "0", title: `${PI.CATN[c]}: ${F.lbl === "3 events" ? "event by event" : "round by round"}` }, [el("span", {}, [`${PI.CATN[c]}: `, el("b", { class: cls(d) }, sg2(d)), ` (${sg2(o.a)} lately, ${sg2(o.b)} before)`]), el("span", { class: "ip-chev" }, "›")]);
      const open = () => popup(`${PI.CATN[c]}, ${/event/.test(F.lbl) ? "event by event" : "round by round"}`, [el("div", { class: "td ip-chartbox" }, CH.formRounds({ prevR: F.prev, lastR: F.last, n: F.n, FL: F.lbl }, c)),
        el("p", {}, [`The last ${F.lbl}: `, el("b", { class: cls(o.a) }, `${sg2(o.a)} a round`), `; the ${F.lbl} before: `, el("b", { class: cls(o.b) }, `${sg2(o.b)} a round`), `; the change `, el("b", { class: cls(d) }, sg2(d)), "."]), samp(`Strokes gained ${PI.CATN[c].toLowerCase()} a round, ${name}, ${tour || ""} ${year}`)], `Form · ${name}`);
      li.addEventListener("click", open); li.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); }); return li; })),
    samp(`The last ${F.lbl} against the ${F.lbl} before, strokes gained a round`)] : [el("p", { class: "muted" }, "Not enough rounds yet for form.")]);
  // where the strokes go (a Home story can ask for one range: it's added if need be, lit and scrolled to)
  let focus = null; try { focus = sessionStorage.getItem("ta.ovFocus"); sessionStorage.removeItem("ta.ovFocus"); } catch { /* */ }
  const fR = focus && focus.includes("|") ? P.ranges.find((o) => `${o.c}|${o.d}` === focus) : null;
  const rows0 = [...P.leaks.slice(0, 3), ...P.strengths.slice(0, 2)], rows = fR && !rows0.includes(fR) ? [...rows0, fR] : rows0, mx = Math.max(0.01, ...rows.map((o) => Math.abs(o.rd)));
  const goesCard = card("Where the strokes go", "#ff453a", [el("h3", { class: "ip-h3" }, "By distance, strokes gained a round"),
    rows.length ? el("div", { class: "ip-bars" }, rows.map((o) => clickable(el("div", { class: `ip-barrow ip-click${o === fR ? " ip-focus" : ""}` }, [el("span", {}, `${o.c === "PUTT" ? "Putts" : o.c === "ARG" ? "Chips" : "Approach"} ${o.d}`), el("span", { class: "ip-bartrack" }, el("i", { class: o.rd >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(o.rd) / mx) * 100)}%` })), el("b", { class: cls(o.rd) }, sg2(o.rd)), el("span", { class: "ip-barn" }, `${sg3(o.shot)} a shot · ${Math.round(o.n)} shots`)]), () => rangePop(o)))) : el("p", { class: "muted" }, "Not enough shots by distance yet."),
    P.ranges.length > rows.length ? (() => { const b = el("button", { type: "button", class: "ip-link" }, `Show more (all ${P.ranges.filter((o) => o.n >= 10).length} ranges)`); b.addEventListener("click", allRanges); return b; })() : null,
    samp(`${year} season, ${P.n} rounds · a range needs 25+ shots`)]);
  // the bag (clubs, the Non-Driver off the tee, and the ball)
  const bagCard = card("In the bag", "#ff9f0a", P.gear.length ? [el("table", { class: "ip-t" }, [el("thead", {}, el("tr", {}, ["Club", "Model", "SG a round", "Rounds"].map((h, i) => el("th", { class: i >= 2 ? "num" : null }, h)))),
    el("tbody", {}, P.gear.map((g) => clickable(el("tr", { class: "ip-click" }, [el("td", {}, g.kind), el("td", {}, [g.model, g.isNew ? el("span", { class: "ip-new" }, "new") : null, g.isNew && g.was ? el("span", { class: "ip-was" }, ` (was ${g.was})`) : null]), el("td", { class: `num ${cls(g.rd)}` }, sg2(g.rd)), el("td", { class: "num" }, String(g.n))]), () => gearPop(g))))]),
    samp(`Strokes gained a round with each, over the rounds it was used (${year}): a club in its own part of the game (off the tee for the Driver and Non-Driver), the ball on every shot`)] : [el("p", { class: "muted" }, "No clubs in this player's data.")]);
  // (update 820) the pop-ups: a distance range, every range, a club or the ball
  function rangePop(o) {
    const inR = (r) => (r.shots || []).filter((s) => s.cat === o.c && s.dist === o.d), sum = (rs) => rs.reduce((t, r) => t + inR(r).reduce((u, s) => u + (s.sg || 0), 0), 0), cnt = (rs) => rs.reduce((t, r) => t + inR(r).reduce((u, s) => u + (s.w || 1), 0), 0);
    const tileP = (l, v, sub) => el("div", { class: "ip-tile" }, [el("span", { class: "ip-tl" }, l), el("strong", { class: cls(typeof v === "number" ? v : null) }, typeof v === "number" ? sg2(v) : v), el("span", { class: "ip-ts" }, sub)]);
    const lr = F?.last || [], pr = F?.prev || [];
    const evRows = P.evs.slice(-12).map((e) => ({ e, v: e.rs.length ? sum(e.rs) / e.rs.length : null, n: cnt(e.rs) })).filter((x) => x.n > 0), mx = Math.max(0.01, ...evRows.map((x) => Math.abs(x.v)));
    const lies = new Map(); for (const r of P.rs) for (const s of inR(r)) { const l = s.lie || "—", m = lies.get(l) || lies.set(l, { sg: 0, n: 0 }).get(l); m.sg += s.sg || 0; m.n += s.w || 1; }
    popup(`${o.c === "PUTT" ? "Putts" : o.c === "ARG" ? "Chips and pitches" : o.c === "OTT" ? "Tee shots" : "Approaches"} from ${o.d}`, [
      el("div", { class: "ip-popstats" }, [tileP("A round", o.rd, `${year} · ${P.n} rounds`), tileP("A shot", sg3(o.shot), `${Math.round(o.n)} shots`), tileP("Shots a round", (o.n / Math.max(1, P.n)).toFixed(1), "how often it comes up"),
        lr.length && pr.length ? tileP(`Last ${F.lbl}`, sum(lr) / lr.length - sum(pr) / pr.length, `${sg2(sum(lr) / lr.length)} lately, ${sg2(sum(pr) / pr.length)} before`) : null]),
      evRows.length ? el("p", { class: "cf-sub" }, "Event by event, strokes gained a round from here") : null,
      evRows.length ? el("div", { class: "ip-bars" }, evRows.map((x) => el("div", { class: "ip-barrow" }, [el("span", {}, `${PI.evName(x.e.event)} ${x.e.year}`), el("span", { class: "ip-bartrack" }, el("i", { class: x.v >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(x.v) / mx) * 100)}%` })), el("b", { class: cls(x.v) }, sg2(x.v)), el("span", { class: "ip-barn" }, `${Math.round(x.n)} shots`)]))) : null,
      lies.size > 1 ? el("p", { class: "cf-sub" }, "By lie, strokes gained a shot") : null,
      lies.size > 1 ? el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["Lie", "A shot", "Shots"].map((h, i) => el("th", { class: i ? "num" : null }, h)))), el("tbody", {}, [...lies].sort((a, b) => b[1].n - a[1].n).map(([l, m]) => el("tr", {}, [el("td", {}, l), el("td", { class: `num ${cls(m.sg / m.n)}` }, sg3(m.sg / m.n)), el("td", { class: "num" }, String(Math.round(m.n)))])))]) : null,
      samp(`${name}, ${tour || ""} ${year}: every shot from ${o.d}, strokes gained against the tour baseline`)], `Where the strokes go · ${name}`);
  }
  function allRanges() {
    const all = P.ranges.filter((o) => o.n >= 10).sort((a, b) => PI.CATS.indexOf(a.c) - PI.CATS.indexOf(b.c) || a.rd - b.rd), mx2 = Math.max(0.01, ...all.map((o) => Math.abs(o.rd)));
    const close = popup("Every distance range", [el("p", { class: "muted small" }, "Strokes gained a round from each range (10+ shots). Tap one for more."), ...PI.CATS.filter((c) => all.some((o) => o.c === c)).flatMap((c) => [el("p", { class: "cf-sub" }, PI.CATN[c]),
      el("div", { class: "ip-bars" }, all.filter((o) => o.c === c).map((o) => clickable(el("div", { class: "ip-barrow ip-click" }, [el("span", {}, o.d), el("span", { class: "ip-bartrack" }, el("i", { class: o.rd >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(o.rd) / mx2) * 100)}%` })), el("b", { class: cls(o.rd) }, sg2(o.rd)), el("span", { class: "ip-barn" }, `${sg3(o.shot)} a shot · ${Math.round(o.n)} shots${o.n < 25 ? " · few shots" : ""}`)]), () => { close(); rangePop(o); })))])], `${name} · ${year}`);
  }
  function gearPop(g) {
    const kindOf = (gr) => String(gr || "").split("|")[0], modelOf = (gr) => String(gr || "").split("|").slice(1).join("|");
    const valOf = (s) => (g.kind === "Ball" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear && kindOf(s.gear) === g.kind ? s.gear : null);
    const c = g.cat === "TOTAL" ? null : g.cat;
    const evs = P.evs.map((e) => { const m = new Map(); for (const r of e.rs) for (const s of r.shots || []) { const v = valOf(s); if (v) m.set(v, (m.get(v) || 0) + 1); } const top = [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
      const sgv = e.rs.reduce((t, r) => t + (r.shots || []).reduce((u, s) => u + (valOf(s) && (!c || s.cat === c) ? s.sg || 0 : 0), 0), 0) / Math.max(1, e.rs.length);
      return top ? { e, model: modelOf(top), sg: sgv, n: e.rs.length } : null; }).filter(Boolean);
    const byModel = new Map(); for (const x of evs) { const m = byModel.get(x.model) || byModel.set(x.model, { sg: 0, n: 0, ev: 0 }).get(x.model); m.sg += x.sg * x.n; m.n += x.n; m.ev++; }
    popup(`${g.kind}: ${g.model}`, [
      el("p", {}, [`Strokes gained ${c ? PI.CATN[c].toLowerCase() : "in total"} a round with it: `, el("b", { class: cls(g.rd) }, sg2(g.rd)), ` over ${g.n} rounds in ${year}.`, g.isNew && g.was ? ` New in the bag lately (was ${g.was}).` : ""]),
      byModel.size > 1 ? el("p", { class: "cf-sub" }, "Each model this season") : null,
      byModel.size > 1 ? el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["Model", "Events", "Rounds", "SG a round"].map((h, i) => el("th", { class: i ? "num" : null }, h)))), el("tbody", {}, [...byModel].map(([mdl, m]) => el("tr", {}, [el("td", {}, mdl), el("td", { class: "num" }, String(m.ev)), el("td", { class: "num" }, String(m.n)), el("td", { class: `num strong ${cls(m.sg / m.n)}` }, sg2(m.sg / m.n))])))]) : null,
      el("p", { class: "cf-sub" }, "Event by event"),
      el("div", { class: "ip-tw ip-tw0" }, el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["Event", "Model", "Rounds", "SG a round"].map((h, i) => el("th", { class: i >= 2 ? "num" : null }, h)))), el("tbody", {}, [...evs].reverse().map((x) => el("tr", {}, [el("td", {}, `${PI.evName(x.e.event)} ${x.e.year}`), el("td", {}, x.model), el("td", { class: "num" }, String(x.n)), el("td", { class: `num ${cls(x.sg)}` }, sg2(x.sg))])))])),
      samp(`The model used most at each event; strokes gained a round ${c ? `in ${PI.CATN[c].toLowerCase()} on the shots hit with it` : "on every shot, with that ball"}`)], `In the bag · ${name}`);
  }
  const fitBox = card("Next event fit", "#64d2ff", el("p", { class: "muted" }, "Loading the course…"), "ip-fit");
  mount(wrap, [head(`${tour || ""} ${year}`.trim()), tiles, el("div", { class: "ip-grid ip-grid-2" }, [formCard, goesCard]), el("div", { class: "ip-bag" }, bagCard), fitBox,
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

/** (update 820) a row that opens something: a tap, or Enter */
function clickable(n, f) { n.setAttribute("role", "button"); n.setAttribute("tabindex", "0"); n.addEventListener("click", f); n.addEventListener("keydown", (e) => { if (e.key === "Enter") f(); }); return n; }
function drillBtn(o, key, name) {
  const msg = el("span", { class: "muted small" }), b = el("button", { type: "button", class: "ip-act" }, `＋ Add a drill: ${o.c === "PUTT" ? "putts" : o.c === "ARG" ? "chips" : "approaches"} from ${o.d}`);
  b.addEventListener("click", async () => { b.disabled = true; try { const [P0, { getState }] = await Promise.all([import("../practice/plan.js"), import("../auth.js")]); const n = await P0.addToPlan(getState(), { items: [{ drill: P0.drillFor(o.c, o.d) }], playerKey: key, playerLabel: name }); mount(msg, n ? "Added to the practice plan." : "It's already in the plan."); }
    catch (e) { console.warn(e); b.disabled = false; mount(msg, "Couldn't add it (practice may not be open for this player)."); } });
  return el("div", { class: "ip-actrow" }, [b, msg]);
}
