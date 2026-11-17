// (update 815) The player's page; (update 817) it's Stats' Overview tab now, for the header's player: no filters, buttons or
// player pickers of its own, only a + to add them to your favorites. The season (strokes gained in total and each part of
// the game, with tour ranks), form (the last 12 rounds against the 12 before, round by round; the DP World Tour 3 events
// against 3), where the strokes go by distance, the clubs and ball in the bag and how each is doing, and the fit for the
// next event. Every number says what it rests on. The old #/dossier address opens Stats on this tab.
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { makeCharts } from "../homeCharts.js";
import { bar0, radarSvg } from "../miniCharts.js";
import { card, samp, sg2, sg3, cls, ord, popup } from "./insightPages.js";
import { setCurrent, openStatsTab, lastName } from "../current.js";

export async function render() {
  const m = /[?&]player=([^&]+)/.exec(location.hash); if (m) setCurrent({ key: decodeURIComponent(m[1]) });
  const f = /[?&]focus=([^&]+)/.exec(location.hash); try { if (f) sessionStorage.setItem("ta.ovFocus", decodeURIComponent(f[1])); } catch { /* */ }
  location.hash = "#/home"; // (update 838: the overview is on Home now)
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

const ordS = (n) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
export async function overview(box, key, name, opts = {}) { // (update 837) opts.home: Home's copy (no Where the strokes go: Home splits it into Player Spotlight and Where to Improve)
  mount(box, el("div", { class: "ip ip-embed" }, el("p", { class: "muted ip-wait" }, `Putting ${name}’s overview together…`)));
  const wrap = box.firstChild, st = window.__authState || {};
  const [{ field }, rounds, fav] = await Promise.all([PI.loadField(st).catch(() => ({ field: [] })), PI.loadShots(key, name), favButton(key, name)]);
  const fp = field.find((p) => p.key === key), base = rounds.length ? rounds : fp?.rounds || [];
  // (update 824) the facts from their PGA Tour bio: age, turned pro, seasons on their tour, career money
  await PI.ensureBios().catch(() => null); const bio = PI.bioSync(name);
  const tourNm = (t) => (t === "H" ? "Korn Ferry Tour" : !t || t === "R" ? "PGA TOUR" : t);
  const bioLine = bio ? [bio.age ? `Age ${Math.round(bio.age)}` : null, bio.pro ? `Turned pro ${Math.round(bio.pro)}` : null, bio.since ? `${ordS(new Date().getFullYear() - Math.round(bio.since) + 1)} season on the ${tourNm(bio.tour)}` : null, bio.money ? `$${bio.money >= 1e6 ? `${(bio.money / 1e6).toFixed(1)}M` : Math.round(bio.money).toLocaleString()} career earnings` : null].filter(Boolean).join(" · ") : "";
  const head = (sub) => el("header", { class: "ip-head ip-head-slim" }, [el("div", {}, [el("p", { class: "ip-kick" }, `Overview${sub ? ` · ${sub}` : ""}`), el("h2", { class: "ip-h" }, [name, fav]), bioLine ? el("p", { class: "ip-bio" }, bioLine) : null])]);
  if (!base.length) { mount(wrap, [head(), el("p", { class: "muted" }, `No rounds on record for ${name}.`)]); return; }
  const tours = [...new Set(base.map((r) => r.tour).filter(Boolean))];
  const tour = [...tours].sort((a, b) => base.filter((r) => r.tour === b).length - base.filter((r) => r.tour === a).length)[0] || null;
  const year = [...new Set(base.filter((r) => !tour || r.tour === tour).map(PI.yrOf))].sort().at(-1);
  const P = PI.profile(base, { year, tour, field, key }), self = PI.isSelfKey(key), nameS = self ? "You" : lastName(name); // (update 834: your own Overview says "you")
  const CH = makeCharts({ el, sg2, avgOf: (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null), inCat: (r, c) => (r.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg : 0), 0), tot: (r) => (r.shots || []).reduce((t, s) => t + s.sg, 0), eventsOf: (rs) => PI.eventsOf(rs), CATN: PI.CATN, bar0 });
  CH.setWide(true);
  // the five numbers
  const tile = (lbl, v, rk, sub) => el("div", { class: "ip-tile" }, [el("span", { class: "ip-tl" }, lbl), el("strong", { class: cls(v) }, sg2(v)), el("span", { class: "ip-ts" }, [rk ? `${ord(rk.r)} of ${rk.n}` : "not ranked", sub ? ` · ${sub}` : ""])]);
  const tiles = el("div", { class: "ip-tiles" }, [tile("SG: Total per round", P.tot, P.ranks.TOTAL, `${P.n} rounds`), ...PI.CATS.map((c) => tile(PI.CATN[c], P.cat[c], P.ranks[c]))]);
  // form
  // (update 836) Form: Yearly Trends (this season against last) | Recent Trends (the last 12 rounds against the 12 before; the
  // DP World Tour 3 events against 3): the round by round chart, and a radar of each part of the game, then against now;
  // a tap on a part of the game's name opens its distances, then against now
  const F = P.form, prevYr = String(Number(year) - 1), lastSeason = P.all.filter((r) => PI.yrOf(r) === prevYr && !r.eventLevel);
  let fMode = "recent"; try { fMode = localStorage.getItem("ta.ovForm") || "recent"; } catch { /* */ }
  const SHORT = { OTT: "Tee", APP: "Approach", ARG: "Short game", PUTT: "Putting" }, inC = (r, c) => (r.shots || []).reduce((t, s0) => t + (s0.cat === c ? s0.sg || 0 : 0), 0), totR = (r) => (r.shots || []).reduce((t, s0) => t + (s0.sg || 0), 0);
  const avgR = (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null);
  const formBody = el("div", {});
  const formWin = () => (fMode === "yearly" && lastSeason.length >= 4 ? { prev: lastSeason, last: P.rs, lbB: prevYr, lbA: String(year), word: `${year} against ${prevYr}`, nowL: String(year), befL: prevYr }
    : F ? { prev: F.prev, last: F.last, lbB: `${F.lbl} before`, lbA: `Last ${F.lbl}`, word: `the last ${F.lbl} against the ${F.lbl} before`, nowL: `Last ${F.lbl}`, befL: `${F.lbl} before`, n: F.n } : null);
  const drawForm = () => {
    const W0 = formWin(); if (!W0) { mount(formBody, el("p", { class: "muted" }, fMode === "yearly" ? `No ${prevYr} rounds to compare with.` : "Not enough rounds yet for form.")); return; }
    const a = avgR(W0.last, totR), b = avgR(W0.prev, totR), now = Object.fromEntries(PI.CATS.map((c) => [c, avgR(W0.last, (r) => inC(r, c))])), bef = Object.fromEntries(PI.CATS.map((c) => [c, avgR(W0.prev, (r) => inC(r, c))]));
    const lim = Math.max(0.6, ...PI.CATS.flatMap((c) => [Math.abs(now[c] || 0), Math.abs(bef[c] || 0)])) * 1.1;
    const radar = radarSvg(PI.CATS.map((c) => `${SHORT[c]}\n${sg2(now[c])}`), [{ vals: PI.CATS.map((c) => bef[c] || 0), cls: "a", label: W0.befL }, { vals: PI.CATS.map((c) => now[c] || 0), cls: "b", label: W0.nowL }], { lo: -lim, hi: lim });
    // the radar's names open their distances
    radar?.querySelectorAll("text").forEach((t) => { const c = PI.CATS.find((k) => t.textContent.trim() === SHORT[k]); if (!c) return; t.classList.add("ip-radar-lbl"); t.setAttribute("role", "button"); t.setAttribute("tabindex", "0");
      const open = () => popup(`${PI.CATN[c]}: ${W0.word}`, [el("div", { class: "td ip-chartbox" }, CH.formRounds({ prevR: W0.prev, lastR: W0.last, n: W0.n || "", FL: F?.lbl || "", lbB: W0.lbB, lbA: W0.lbA }, c)),
        el("p", {}, [`${W0.nowL}: `, el("b", { class: cls(now[c]) }, `${sg2(now[c])} per round`), `; ${W0.befL}: `, el("b", { class: cls(bef[c]) }, `${sg2(bef[c])} per round`), "; the change ", el("b", { class: cls((now[c] || 0) - (bef[c] || 0)) }, sg2((now[c] || 0) - (bef[c] || 0))), "."]),
        formRanges(c, W0), samp(`Strokes gained ${PI.CATN[c].toLowerCase()} per round, ${name}, ${tour || ""}`)], `Form · ${name}`);
      t.addEventListener("click", open); t.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); }); });
    mount(formBody, [el("h3", { class: "ip-h3" }, `${a - b >= 0 ? "Heating up" : "Cooling off"}: ${sg2(a - b)} strokes gained per round`),
      el("div", { class: "td ip-chartbox" }, CH.formRounds({ prevR: W0.prev, lastR: W0.last, n: W0.n || "", FL: F?.lbl || "", lbB: W0.lbB, lbA: W0.lbA }, null)),
      el("div", { class: "td ip-radarbox" }, [radar, el("div", { class: "td-legend" }, [el("span", { class: "gold" }, W0.nowL), el("span", { class: "gray" }, W0.befL)]), el("p", { class: "muted small" }, "Tap a part of the game for its distances.")]),
      samp(`${W0.word[0].toUpperCase()}${W0.word.slice(1)}, strokes gained per round`)]);
  };
  const fTog = el("div", { class: "ip-pills ip-ftog", role: "group", "aria-label": "Form" }, [["yearly", "Yearly Trends"], ["recent", "Recent Trends"]].map(([v, l]) => { const bt = el("button", { type: "button", class: `ip-pill${v === fMode ? " on" : ""}`, "aria-pressed": String(v === fMode) }, l);
    bt.addEventListener("click", () => { fMode = v; try { localStorage.setItem("ta.ovForm", v); } catch { /* */ } fTog.querySelectorAll(".ip-pill").forEach((x) => { const on = x === bt; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }); drawForm(); }); return bt; }));
  const formCard = card("Form", "#30d158", [fTog, formBody]);
  drawForm();
  // where the strokes go (a Home story can ask for one range: it's added if need be, lit and scrolled to)
  let focus = null; try { focus = sessionStorage.getItem("ta.ovFocus"); sessionStorage.removeItem("ta.ovFocus"); } catch { /* */ }
  const fR = focus && focus.includes("|") ? P.ranges.find((o) => `${o.c}|${o.d}` === focus) : null;
  const rows0 = [...P.leaks.slice(0, 3), ...P.strengths.slice(0, 3)] /* (update 823: the bottom 3 and the top 3) */, rows = fR && !rows0.includes(fR) ? [...rows0, fR] : rows0, mx = Math.max(0.01, ...rows.map((o) => Math.abs(o.rd)));
  const goesCard = card("Where the strokes go", "#ff453a", [el("h3", { class: "ip-h3" }, "By distance, strokes gained per round"),
    // (update 836) two bars each: the season, and the last 12 rounds (the DP World Tour: 3 events)
    rows.length ? (() => { const L = F?.last || [], nL = Math.max(1, L.length), l12 = (o) => (L.length ? L.reduce((t, r) => t + (r.shots || []).reduce((u, s0) => u + (s0.cat === o.c && s0.dist === o.d ? s0.sg || 0 : 0), 0), 0) / nL : null);
      const mx2 = Math.max(0.01, ...rows.flatMap((o) => [Math.abs(o.rd), Math.abs(l12(o) ?? 0)]));
      const bar = (v, kind) => el("span", { class: `ip-bartrack ip-bt-${kind}` }, v == null ? null : el("i", { class: v >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(v) / mx2) * 100)}%` }));
      return el("div", { class: "ip-bars ip-bars2" }, [el("div", { class: "ip-bkey" }, [el("span", { class: "ip-k-s" }, `${year} season`), el("span", { class: "ip-k-l" }, `Last ${F?.lbl || "12 rounds"}`)]),
        ...rows.map((o) => { const v2 = l12(o); return clickable(el("div", { class: `ip-barrow ip-barrow2 ip-click${o === fR ? " ip-focus" : ""}` }, [el("span", { class: "ip-bl" }, `${o.c === "PUTT" ? "Putts" : o.c === "ARG" ? "Chips" : "Approach"} ${o.d}`),
          el("span", { class: "ip-b2" }, [bar(o.rd, "s"), bar(v2, "l")]), el("span", { class: "ip-v2" }, [el("b", { class: cls(o.rd) }, sg2(o.rd)), el("b", { class: `ip-vl ${cls(v2)}` }, v2 == null ? "\u2014" : sg2(v2))]),
          el("span", { class: "ip-barn" }, `${sg3(o.shot)} a shot · ${Math.round(o.n)} shots in the season`)]), () => rangePop(o)); })]); })() : el("p", { class: "muted" }, "Not enough shots by distance yet."),
    P.ranges.length > rows.length ? (() => { const b = el("button", { type: "button", class: "ip-link" }, `Show all (${P.ranges.filter((o) => o.n >= 10).length} ranges)`); b.addEventListener("click", allRanges); return b; })() : null,
    samp(`${year} season, ${P.n} rounds · a range needs 25+ shots`)]);
  // the bag (clubs, the Non-Driver off the tee, and the ball)
  const bagCard = card("In the bag", "#ff9f0a", P.gear.length ? [el("table", { class: "ip-t" }, [el("thead", {}, el("tr", {}, ["Club", "Model", "SG per round", "Rounds", "Tried", "Rank"].map((h, i) => el("th", { class: i >= 2 ? "num" : null, title: i === 4 ? `How many models of that club they've used in ${year}` : i === 5 ? "Where the one in the bag now ranks among them by strokes gained per round (* under 4 rounds)" : null }, h)))),
    el("tbody", {}, P.gear.map((g) => clickable(el("tr", { class: "ip-click" }, [el("td", {}, g.kind), el("td", {}, [g.model, g.isNew ? el("span", { class: "ip-new" }, "new") : null, g.isNew && g.was ? el("span", { class: "ip-was" }, ` (was ${g.was})`) : null]), el("td", { class: `num ${cls(g.rd)}` }, sg2(g.rd)), el("td", { class: "num" }, String(g.n)), el("td", { class: "num" }, String(g.tried)), el("td", { class: `num strong${g.few ? " ip-few" : ""}`, title: g.few ? "Under 4 rounds with it: a small sample" : null }, g.rank ? `${g.rank}/${g.ranked}${g.few ? "*" : ""}` : "—")]), () => gearPop(g))))]),
    samp(`Strokes gained per round with each, over the rounds it was used (${year}): a club in its own part of the game (off the tee for the Driver and Non-Driver), the ball on every shot. Tried: the models of each used in ${year}; Rank: the one in the bag now among them, by strokes gained per round (* in italics: under 4 rounds, a small sample)`)] : [el("p", { class: "muted" }, "No clubs in this player's data.")]);
  // (update 825) a part of the game's form in each of its distance ranges: lately against before, strokes gained per round
  function formRanges(c, W0 = null) {
    const Fw = W0 ? { last: W0.last, prev: W0.prev, lbl: W0.nowL } : F;
    const by = (rs) => { const m = new Map(); for (const r of rs) for (const sh of r.shots || []) { if (sh.cat !== c || !sh.dist) continue; const o = m.get(sh.dist) || m.set(sh.dist, { sg: 0, n: 0 }).get(sh.dist); o.sg += sh.sg || 0; o.n += sh.w || 1; } return m; };
    const A = by(Fw.last || []), B = by(Fw.prev || []), nA = Math.max(1, (Fw.last || []).length), nB = Math.max(1, (Fw.prev || []).length);
    const dk = (d) => { const t = String(d); if (/bunker|sand/i.test(t)) return 1e6; const m = /([<>])?\s*(\d+(?:\.\d+)?)/.exec(t); if (!m) return 5e5; return m[1] === "<" ? -1 : m[1] === ">" ? Number(m[2]) + 0.5 : Number(m[2]); };
    const rows = [...new Set([...A.keys(), ...B.keys()])].sort((a, b) => dk(a) - dk(b)).map((d) => { const a = A.get(d), b = B.get(d); return { d, a: a ? a.sg / nA : 0, b: b ? b.sg / nB : 0, na: a?.n || 0, nb: b?.n || 0 }; }).filter((x) => x.na + x.nb >= 5);
    if (!rows.length) return el("p", { class: "muted small" }, "No distances in these rounds (an event's totals only), so no breakdown by range.");
    const mx = Math.max(0.01, ...rows.map((x) => Math.abs(x.a - x.b)));
    return el("div", {}, [el("p", { class: "cf-sub" }, W0 ? `Each distance, ${W0.word} (strokes gained per round)` : `Each distance, the last ${F.lbl} against the ${F.lbl} before (strokes gained per round)`),
      el("div", { class: "ip-tw ip-tw0" }, el("table", { class: "ip-t cf-parts ip-fr" }, [el("thead", {}, el("tr", {}, ["Range", W0 ? W0.nowL : "Lately", W0 ? W0.befL : "Before", "Change", ""].map((h, i) => el("th", { class: i && i < 4 ? "num" : null }, h)))),
        el("tbody", {}, rows.map((x) => { const d = x.a - x.b; return el("tr", {}, [el("td", {}, x.d), el("td", { class: `num ${cls(x.a)}` }, sg2(x.a)), el("td", { class: `num ${cls(x.b)}` }, sg2(x.b)), el("td", { class: `num strong ${cls(d)}` }, sg2(d)),
          el("td", { class: "ip-frbar" }, el("span", { class: "cf-mid" }, el("i", { class: d >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(d) / mx) * 50)}%` })))]); }))]))]);
  }
  // (update 820) the pop-ups: a distance range, every range, a club or the ball
  function rangePop(o) {
    const inR = (r) => (r.shots || []).filter((s) => s.cat === o.c && s.dist === o.d), sum = (rs) => rs.reduce((t, r) => t + inR(r).reduce((u, s) => u + (s.sg || 0), 0), 0), cnt = (rs) => rs.reduce((t, r) => t + inR(r).reduce((u, s) => u + (s.w || 1), 0), 0);
    const tileP = (l, v, sub) => el("div", { class: "ip-tile" }, [el("span", { class: "ip-tl" }, l), el("strong", { class: cls(typeof v === "number" ? v : null) }, typeof v === "number" ? sg2(v) : v), el("span", { class: "ip-ts" }, sub)]);
    const lr = F?.last || [], pr = F?.prev || [];
    const evRows = P.evs.slice(-12).map((e) => ({ e, v: e.rs.length ? sum(e.rs) / e.rs.length : null, n: cnt(e.rs) })).filter((x) => x.n > 0), mx = Math.max(0.01, ...evRows.map((x) => Math.abs(x.v)));
    const lies = new Map(); for (const r of P.rs) for (const s of inR(r)) { const l = s.lie || "—", m = lies.get(l) || lies.set(l, { sg: 0, n: 0 }).get(l); m.sg += s.sg || 0; m.n += s.w || 1; }
    popup(`${o.c === "PUTT" ? "Putts" : o.c === "ARG" ? "Chips and pitches" : o.c === "OTT" ? "Tee shots" : "Approaches"} from ${o.d}`, [
      el("div", { class: "ip-popstats" }, [tileP("A round", o.rd, `${year} · ${P.n} rounds`), tileP("A shot", sg3(o.shot), `${Math.round(o.n)} shots`), tileP("Shots per round", (o.n / Math.max(1, P.n)).toFixed(1), "how often it comes up"),
        lr.length && pr.length ? tileP(`Last ${F.lbl}`, sum(lr) / lr.length - sum(pr) / pr.length, `${sg2(sum(lr) / lr.length)} lately, ${sg2(sum(pr) / pr.length)} before`) : null]),
      evRows.length ? el("p", { class: "cf-sub" }, "Event by event, strokes gained per round from here") : null,
      evRows.length ? el("div", { class: "ip-bars" }, evRows.map((x) => el("div", { class: "ip-barrow" }, [el("span", {}, `${PI.evName(x.e.event)} ${x.e.year}`), el("span", { class: "ip-bartrack" }, el("i", { class: x.v >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(x.v) / mx) * 100)}%` })), el("b", { class: cls(x.v) }, sg2(x.v)), el("span", { class: "ip-barn" }, `${Math.round(x.n)} shots`)]))) : null,
      lies.size > 1 ? el("p", { class: "cf-sub" }, "By lie, strokes gained a shot") : null,
      lies.size > 1 ? el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["Lie", "A shot", "Shots"].map((h, i) => el("th", { class: i ? "num" : null }, h)))), el("tbody", {}, [...lies].sort((a, b) => b[1].n - a[1].n).map(([l, m]) => el("tr", {}, [el("td", {}, l), el("td", { class: `num ${cls(m.sg / m.n)}` }, sg3(m.sg / m.n)), el("td", { class: "num" }, String(Math.round(m.n)))])))]) : null,
      samp(`${name}, ${tour || ""} ${year}: every shot from ${o.d}, strokes gained against the tour baseline`)], `Where the strokes go · ${name}`);
  }
  function allRanges() {
    // (update 823) by part of the game, then distance, nearest first ("<5 ft", "5-10 ft" … ">25 ft"; "Bunker" last)
    const dk = (d) => { const t = String(d); if (/bunker|sand/i.test(t)) return 1e6; const m = /([<>])?\s*(\d+(?:\.\d+)?)/.exec(t); if (!m) return 5e5; return m[1] === "<" ? -1 : m[1] === ">" ? Number(m[2]) + 0.5 : Number(m[2]); };
    // (update 831) longest first within each part of the game (bunker shots last), off the tee as it was
    const dDesc = (o) => (/bunker|sand/i.test(String(o.d)) ? 1e9 : -dk(o.d));
    const all = P.ranges.filter((o) => o.n >= 10).sort((a, b) => PI.CATS.indexOf(a.c) - PI.CATS.indexOf(b.c) || (a.c === "OTT" ? dk(a.d) - dk(b.d) : dDesc(a) - dDesc(b))), mx2 = Math.max(0.01, ...all.map((o) => Math.abs(o.rd)));
    const close = popup("Every distance range", [el("p", { class: "muted small" }, "Strokes gained per round from each range (10+ shots), by part of the game, longest first. Tap one for more."), ...PI.CATS.filter((c) => all.some((o) => o.c === c)).flatMap((c) => [el("p", { class: "cf-sub" }, PI.CATN[c]),
      el("div", { class: "ip-bars" }, all.filter((o) => o.c === c).map((o) => clickable(el("div", { class: "ip-barrow ip-click" }, [el("span", {}, o.d), el("span", { class: "ip-bartrack" }, el("i", { class: o.rd >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(o.rd) / mx2) * 100)}%` })), el("b", { class: cls(o.rd) }, sg2(o.rd)), el("span", { class: "ip-barn" }, `${sg3(o.shot)} a shot · ${Math.round(o.n)} shots${o.n < 25 ? " · few shots" : ""}`)]), () => { close(); rangePop(o); })))])], `${name} · ${year}`);
  }
  function gearPop(g) {
    const kindOf = (gr) => String(gr || "").split("|")[0], modelOf = (gr) => String(gr || "").split("|").slice(1).join("|");
    const valOf = (s) => (g.kind === "Ball" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear && kindOf(s.gear) === g.kind ? s.gear : null);
    const c = g.cat === "TOTAL" ? null : g.cat;
    // (update 826) every model used in the season on the page, as Tried and Rank count them
    // (update 826) the season on the page (as Tried and Rank count it)
    const allEv = P.evs, multiYr = false;
    const evs = allEv.map((e) => { const m = new Map(); for (const r of e.rs) for (const s of r.shots || []) { const v = valOf(s); if (v) m.set(v, (m.get(v) || 0) + 1); } const top = [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
      const sgv = e.rs.reduce((t, r) => t + (r.shots || []).reduce((u, s) => u + (valOf(s) && (!c || s.cat === c) ? s.sg || 0 : 0), 0), 0) / Math.max(1, e.rs.length);
      return top ? { e, model: modelOf(top), sg: sgv, n: e.rs.length } : null; }).filter(Boolean);
    const byModel = new Map(); for (const r of P.rs) { const per = new Map(); for (const s of r.shots || []) { const v = valOf(s); if (v) per.set(v, (per.get(v) || 0) + (!c || s.cat === c ? s.sg || 0 : 0)); }
      for (const [v, x] of per) { const mdl = modelOf(v), o = byModel.get(mdl) || byModel.set(mdl, { sg: 0, n: 0, evs: new Set(), yrs: new Set() }).get(mdl); o.sg += x; o.n++; o.evs.add(`${r.event}|${PI.yrOf(r)}`); o.yrs.add(PI.yrOf(r)); } }
    const ranked = [...byModel].sort( /* (update 836: every model; under 4 rounds in italics, *) */(a, b) => b[1].sg / b[1].n - a[1].sg / a[1].n).map(([m]) => m);
    const models = [...byModel].sort((a, b) => (ranked.includes(a[0]) ? ranked.indexOf(a[0]) : 99) - (ranked.includes(b[0]) ? ranked.indexOf(b[0]) : 99) || b[1].n - a[1].n);
    const MC = ["m-a", "m-b", "m-c", "m-d", "m-e", "m-f"], colorOrder = [g.model, ...models.map(([m]) => m).filter((m) => m !== g.model)], mc = (m) => MC[colorOrder.indexOf(m)] || "m-o";
    const shown = evs.slice(-24);
    popup(`${g.kind}: ${g.model}`, [
      el("p", {}, [`Strokes gained ${c ? PI.CATN[c].toLowerCase() : "in total"} per round with it: `, el("b", { class: cls(g.rd) }, sg2(g.rd)), ` over ${g.n} rounds in ${year}.`, g.isNew && g.was ? ` New in the bag lately (was ${g.was}).` : ""]),
      el("p", { class: "cf-sub" }, `Every model in ${year} (${byModel.size} tried)`),
      el("div", { class: "ip-tw ip-tw0" }, el("table", { class: "ip-t cf-parts" }, [el("thead", {}, el("tr", {}, ["", "Model", "Events", "Rounds", "SG per round", "Rank"].map((h, i) => el("th", { class: i > 2 ? "num" : null }, h)))),
        el("tbody", {}, models.map(([mdl, o]) => el("tr", { class: [mdl === g.model ? "ip-now" : null, o.n < 4 ? "ip-few" : null].filter(Boolean).join(" ") || null, title: o.n < 4 ? "Under 4 rounds: a small sample" : null }, [el("td", {}, el("i", { class: `td-sw ${mc(mdl)}` })), el("td", {}, [`${mdl}${o.n < 4 ? "*" : ""}`, mdl === g.model ? el("span", { class: "ip-new" }, "in the bag") : null]), el("td", { class: "num" }, String(o.evs.size)), el("td", { class: "num" }, String(o.n)), el("td", { class: `num strong ${cls(o.sg / o.n)}` }, sg2(o.sg / o.n)), el("td", { class: "num strong" }, ranked.includes(mdl) ? `${ranked.indexOf(mdl) + 1}/${ranked.length}` : "—")])))])),
      el("p", { class: "cf-sub" }, `Event by event, strokes gained per round${evs.length > shown.length ? ` (the last ${shown.length} events)` : ""}`),
      // (update 823) a bar an event, each model its own colour, with the key under it (update 826: room for the names under the bars)
      (() => { const used = [...new Set(shown.map((x) => x.model))];
        const svg = CH.barSvg(shown.map((x) => ({ v: x.sg, label: `${PI.evName(x.e.event)} ${x.e.year} · ${x.model} · ${x.n} rounds`, short: `${PI.evName(x.e.event).replace(/^the\s+/i, "").split(" ").slice(0, 2).join(" ")}${multiYr ? ` '${String(x.e.year).slice(2)}` : ""}`, cls: mc(x.model) })), { note: "By event" });
        return el("div", { class: "td ip-chartbox ip-gearchart" }, svg ? [svg, el("div", { class: "td-legend" }, colorOrder.filter((m) => used.includes(m)).map((m) => el("span", { class: mc(m) }, m)))] : el("p", { class: "muted" }, "Too few events to chart."));
      })(),
      samp(`Every ${tour || ""} round in ${year}: strokes gained per round ${c ? `in ${PI.CATN[c].toLowerCase()} on the shots hit with each model` : "on every shot, with each ball"}, over the rounds it was used. Rank: every model, by strokes gained per round; * in italics: under 4 rounds, a small sample. The chart: the model used most at each event`)], `In the bag · ${name}`);
  }
  const fitBox = card("Next event fit", "#64d2ff", el("p", { class: "muted" }, "Loading the course…"), "ip-fit");
  mount(wrap, [head(`${tour || ""} ${year}`.trim()), tiles, opts.home ? formCard : el("div", { class: "ip-grid ip-grid-2" }, [formCard, goesCard]), el("div", { class: "ip-bag" }, bagCard), fitBox,
    el("p", { class: "ip-foot" }, `Strokes gained against the tour baseline. Ranks among players with 8+ rounds on the ${tour || "tour"} in ${year}.${tours.length > 1 ? ` ${self ? "You also have" : `${name} also has`} rounds on the ${tours.filter((t) => t !== tour).join(", ")}: this is their main tour.` : ""}`)]);
  if (focus) requestAnimationFrame(() => { const t = fR ? wrap.querySelector(".ip-focus") : PI.CATS.includes(focus) ? wrap.querySelectorAll(".ip-tile")[1 + PI.CATS.indexOf(focus)] : null; if (t) { t.classList.add("ip-focus"); t.scrollIntoView({ block: "center", behavior: "smooth" }); } });
  // (update 823) the next event: the schedule's next on their tour, or the one picked with Change (kept for the player; shared
  // with Recommended Practice). Its fit vs a normal week (room to gain, from the stats file: every tournament on record) and,
  // when its course is in Strategy Maps with its shots, the ranges that decide that course
  const heatL = await import("../courseHeat.js").then((m) => m.listHeatCourses()).catch(() => []);
  const ER = PI.eventRoom(field, tour), names = ER.evs.map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const drawFit = async () => {
    const ev = await PI.nextEventFor(key, tour, names, name), stName = ev.name ? PI.matchEventName(ev.name, names) : null, E = stName ? ER.evs.find((e) => e.name === stName) : null;
    const when = ev.start ? new Date(`${ev.start}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
    const change = el("button", { type: "button", class: "ip-btn ghost ip-chg" }, "Change"); change.addEventListener("click", () => pickEvent(ev));
    const head = el("div", { class: "ip-fit-head" }, [el("p", { class: "ip-kick" }, `${PI.pickedNext(key) ? "Preparing for" : ev.entered ? "Next event (entered)" : "Next event"}${ev.name ? ` · ${ev.name}` : ""}${when ? ` · ${when}` : ""}${ev.course ? ` · ${ev.course}` : ""}`), change]);
    if (!ev.name) { mount(fitBox, [head, el("p", { class: "muted" }, "No schedule for this tour yet: pick a tournament with Change.")]); return; }
    const parts = E ? PI.CATS.map((c) => ({ c, room: E.room[c], me: P.cat[c] || 0, edge: (P.cat[c] || 0) * (E.room[c] - 1) })) : null, eff = parts ? parts.reduce((t, x) => t + x.edge, 0) : null;
    const roomBox = parts ? [el("h3", { class: "ip-h3" }, [`Fit vs a normal week: `, el("b", { class: cls(eff) }, `${sg2(eff)} strokes per round`)]),
      el("ul", { class: "ip-bul" }, [...parts].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)).map((x) => el("li", {}, [(() => { const t = PI.fitWords(x, self ? "your" : `${nameS}’s`.replace(/s’s$/, "s’"), self ? "" : nameS); return t[0].toUpperCase() + t.slice(1); })(), "; worth ", el("b", { class: cls(x.edge) }, `${sg2(x.edge)} per round`), " here against a normal week"]) /* (update 838: plain words) */))]
      : [el("p", { class: "muted" }, `No ${ev.name} on record in the stats file yet, so no fit from it.`)];
    mount(fitBox, [head, ...roomBox, el("div", { class: "ip-fit-course" }, el("p", { class: "muted small" }, "Looking for the course in Strategy Maps…"))]);
    const meta = PI.heatCourseFor(heatL, ev), box2 = fitBox.querySelector(".ip-fit-course");
    const C = meta ? await PI.loadCourse(meta, [P.rs]).catch(() => null) : null;
    const goFit = el("button", { type: "button", class: "ip-link" }, `Every tournament for ${self ? "you" : nameS} →`); goFit.addEventListener("click", () => openStatsTab("fit"));
    if (!C) { mount(box2, [goFit, samp(`${E ? `Impact vs usual: how far the field spread out in each part at ${/^the\s/i.test(ev.name) ? ev.name : `the ${ev.name}`} (${E.n} player-weeks) against a normal week. ` : ""}${meta ? `${meta.name}'s shots couldn't be read.` : "Its course isn't in Strategy Maps with shots, so there's no distance detail."}`)]); return; }
    const fit = PI.fitFor(P, C, key, name), yrsT = C.yrs.length > 1 ? `${C.yrs[0]}-${C.yrs.at(-1).slice(2)}` : C.yrs[0] || "";
    mount(box2, [el("p", { class: "cf-sub" }, `At ${meta.name}, by distance`),
      el("ul", { class: "ip-bul" }, [...fit.key3.map((x) => el("li", {}, [`${PI.CATN[x.c]} from ${x.l} (${Math.round(x.share * 100)}% of what wins here; ${x.att.toFixed(1)} ${x.c === "PUTT" ? "putts" : x.c === "ARG" ? "chips and pitches" : "approaches"} per round from there): ${nameS} `, el("b", { class: cls(x.me) }, x.me == null ? "not enough shots" : `${sg3(x.me)} a shot`), `, the top 10 there ${sg3(x.top)} (strokes gained a shot)`])),
        el("li", {}, fit.hereRds ? `${fit.hereRds} rounds there on record` : "No rounds there on record")]), goFit,
      samp(`Impact vs usual: the field's spread in each part there against a normal week (stats file). Distances: every round on record at ${meta.name} (${yrsT}, ${C.nRds} rounds), the top 10 against the rest`)]);
  };
  // Change: the schedule's coming events first, then any tournament on record in the schedule's order (update 836)
  const pickEvent = async (ev) => {
    const SO = await PI.scheduleOrder(names, tour);
    const row = (n, sub, pickName) => { const b = el("button", { type: "button", class: `ip-evrow${n === ev.name ? " on" : ""}` }, [el("b", {}, n), sub ? el("span", {}, sub) : null]); b.addEventListener("click", () => { PI.setPickedNext(key, pickName); close(); drawFit(); }); return b; };
    const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
    const code = PI.tourCodeOf(tour), entered = (PI.fieldEventsSync(name, code) || []).map((e) => e.name);
    const isIn = (n) => entered.some((x) => x === n || PI.matchEventName(x, [n]));
    const close = popup("Preparing for", [
      ev.upcoming.length ? el("p", { class: "cf-sub" }, "Coming up on the schedule") : null,
      ev.upcoming.length ? el("div", { class: "ip-evlist" }, [row(`Next: ${ev.upcoming[0].name}`, fmt(ev.upcoming[0].start), null), ...ev.upcoming.slice(0, 14).map((e) => row(e.name, `${fmt(e.start)}${e.course ? ` · ${e.course}` : ""}${isIn(e.name) ? ` · ✓ ${self ? "you're" : nameS} entered` : ""}`, e.name))]) : null,
      el("p", { class: "cf-sub" }, SO.on.length ? "Any tournament on record, in schedule order" : "Any tournament on record"),
      el("div", { class: "ip-evlist" }, SO.on.map((o) => row(o.name, new Date(`${o.start}T12:00:00`).toLocaleDateString(undefined, { month: "short" }), o.name))),
      SO.off.length ? el("p", { class: "cf-sub" }, SO.on.length ? "Not on the current schedule" : "") : null,
      SO.off.length ? el("div", { class: "ip-evlist" }, SO.off.map((n) => row(n, null, n))) : null], `Next event fit · ${name}`);
  };
  drawFit();
}

/** (update 820) a row that opens something: a tap, or Enter */
function clickable(n, f) { n.setAttribute("role", "button"); n.setAttribute("tabindex", "0"); n.addEventListener("click", f); n.addEventListener("keydown", (e) => { if (e.key === "Enter") f(); }); return n; }
function drillBtn(o, key, name) {
  const msg = el("span", { class: "muted small" }), b = el("button", { type: "button", class: "ip-act" }, `＋ Add a drill: ${o.c === "PUTT" ? "putts" : o.c === "ARG" ? "chips" : "approaches"} from ${o.d}`);
  b.addEventListener("click", async () => { b.disabled = true; try { const [P0, { getState }] = await Promise.all([import("../practice/plan.js"), import("../auth.js")]); const n = await P0.addToPlan(getState(), { items: [{ drill: P0.drillFor(o.c, o.d) }], playerKey: key, playerLabel: name }); mount(msg, n ? "Added to the practice plan." : "It's already in the plan."); }
    catch (e) { console.warn(e); b.disabled = false; mount(msg, "Couldn't add it (practice may not be open for this player)."); } });
  return el("div", { class: "ip-actrow" }, [b, msg]);
}
