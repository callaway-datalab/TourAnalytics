// (update 756) Stats › Tournament Results: a recap of each tournament the player played. Pick the year and the
// tournament: hero cards (strokes gained a round, and in each part of the game, with the rank in that week's field; the
// rounds; the best round), then a scorecard for each round (every hole's score against par and its strokes gained). A
// hole opens to its shots (the lie, the distance, the club, the strokes gained of each) and, where the course has
// Strategy Maps, the hole itself with the player's trail drawn on it.
//   Scores and par come from the course's own shot data (Strategy Maps); without it the scorecard shows strokes counted
//   from the shots and their strokes gained.
import { el, mount } from "./ui.js";
import { fmtSG } from "./sg.js";

const CATS = [["OTT", "Off-the-Tee"], ["APP", "Approach"], ["ARG", "Around-the-Green"], ["PUTT", "Putting"]];
const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
const norm = (s) => String(s || "").toLowerCase().replace(/^the\s+/, "").replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/, "").replace(/[^a-z0-9]/g, "");
const tot = (rd) => (rd.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const inCat = (rd, c) => (rd.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg || 0 : 0), 0);
const avg = (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null);
const cls = (v) => (v == null ? "" : v > 0.005 ? "pos" : v < -0.005 ? "neg" : "");
const ord = (n) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
const LIES = ["Tee", "Fairway", "Rough", "Bunker", "Green", "Water", "Other"];

/** rounds: the player's rounds on the tour picked (every year); field: every player's rounds there (for each week's ranks). */
export function resultsView(S, rounds, field) {
  const st = S.st, me = S.me, rs0 = (rounds || []).filter((r) => r.event);
  const evMap = new Map();
  for (const r of rs0) { const k = `${r.event}|${yrOf(r)}`; (evMap.get(k) || evMap.set(k, { key: k, event: r.event, year: yrOf(r), rs: [] }).get(k)).rs.push(r); }
  const evs = [...evMap.values()].map((e) => ({ ...e, end: e.rs.map((r) => String(r.date)).sort().at(-1) })).sort((a, b) => b.end.localeCompare(a.end));
  if (!evs.length) return [el("section", { class: "panel" }, el("p", { class: "muted" }, "No tournaments with strokes gained on this tour yet."))];
  if (!evMap.has(st.resKey)) st.resKey = evs[0].key;
  const ev = evMap.get(st.resKey), years = [...new Set(evs.map((e) => e.year))].sort().reverse();
  const evRs = [...ev.rs].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.roundNo).localeCompare(String(b.roundNo)));

  // ---- the picker: the year, then the tournament ----
  const ySel = el("select", { class: "tr-sel", "aria-label": "Year" }, years.map((y) => el("option", { value: y, selected: y === ev.year ? "" : null }, y)));
  const eSel = el("select", { class: "tr-sel", "aria-label": "Tournament" }, evs.filter((e) => e.year === ev.year).map((e) => el("option", { value: e.key, selected: e.key === ev.key ? "" : null }, e.event)));
  ySel.value = ev.year; eSel.value = ev.key; // (update 757: the one showing is the one picked)
  ySel.addEventListener("change", () => { const e = evs.find((x) => x.year === ySel.value); if (e) { st.resKey = e.key; st.resRound = null; S.draw(); } });
  eSel.addEventListener("change", () => { st.resKey = eSel.value; st.resRound = null; S.draw(); });
  const picker = el("section", { class: "panel tr-pick" }, [el("p", { class: "fx-eyebrow" }, "Tournament results"), el("div", { class: "tr-pick-row" }, [ySel, eSel])]);

  // (update 757) a card's pop-up: that part of the game (the total: every part) by distance range that week, a shot and a
  // round, against their own season from that range; the biggest gain and loss called out
  const seasonRs = rs0.filter((r) => yrOf(r) === ev.year && !(r.event === ev.event));
  const byDist = (rs, c) => { const m = new Map(); for (const r of rs) for (const s of r.shots || []) if ((!c || s.cat === c) && s.dist) { const k = `${s.cat}|${s.dist}`, o = m.get(k) || m.set(k, { cat: s.cat, d: s.dist, sg: 0, n: 0 }).get(k); o.sg += s.sg || 0; o.n += s.w || 1; } return m; };
  const lo = (d) => { const m = /(\d+)/.exec(String(d)); return m ? Number(m[1]) * (/^</.test(d) ? 0.5 : 1) : 999; };
  function openDist(c) {
    document.querySelector(".tr-popwrap")?.remove();
    const W = byDist(evRs, c), Sx = byDist(seasonRs, c), nW = evRs.length, nS = Math.max(1, seasonRs.length);
    const rows = [...W.values()].sort((a, b) => CATS.findIndex(([k]) => k === a.cat) - CATS.findIndex(([k]) => k === b.cat) || lo(a.d) - lo(b.d)).map((o) => { const s0 = Sx.get(`${o.cat}|${o.d}`); return { ...o, rd: o.sg / nW, per: o.sg / o.n, sPer: s0 && s0.n >= 5 ? s0.sg / s0.n : null, sRd: s0 ? s0.sg / nS : null }; });
    const best = [...rows].sort((a, b) => b.rd - a.rd)[0], worst = [...rows].sort((a, b) => a.rd - b.rd)[0], nm = (c0) => CATS.find(([k]) => k === c0)?.[1] || c0;
    const close = () => wrap.remove(), xb = el("button", { type: "button", class: "tr-pop-x", "aria-label": "Close" }, "×"); xb.addEventListener("click", close);
    const back = el("div", { class: "tr-pop-back" }); back.addEventListener("click", close);
    const body = !rows.length ? el("p", { class: "muted" }, "No distances recorded on these shots.") : [
      el("div", { class: "tr-pop-calls" }, [best && best.rd > 0 ? el("p", {}, [el("strong", { class: "pos" }, `Best: ${nm(best.cat)} from ${best.d}`), ` · ${fmtSG(best.rd)} a round (${fmtSG(best.per)} a shot, ${Math.round(best.n)} shots)${best.sPer != null ? `, against ${fmtSG(best.sPer)} a shot the rest of ${ev.year}` : ""}`]) : null,
        worst && worst.rd < 0 ? el("p", {}, [el("strong", { class: "neg" }, `Costliest: ${nm(worst.cat)} from ${worst.d}`), ` · ${fmtSG(worst.rd)} a round (${fmtSG(worst.per)} a shot, ${Math.round(worst.n)} shots)${worst.sPer != null ? `, against ${fmtSG(worst.sPer)} a shot the rest of ${ev.year}` : ""}`]) : null]),
      el("div", { class: "tr-pop-scroll" }, el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, [c ? "Distance" : "Part · distance", "Shots", "SG a shot", "SG a round", `Rest of ${ev.year}`, "Better or worse"].map((x, i) => el("th", { class: i ? "num" : null }, x)))),
        el("tbody", {}, rows.map((o) => { const dlt = o.sPer != null ? o.per - o.sPer : null; return el("tr", {}, [el("td", {}, c ? o.d : `${nm(o.cat)} · ${o.d}`), el("td", { class: "num" }, String(Math.round(o.n))), el("td", { class: `num ${cls(o.per)}` }, fmtSG(o.per)), el("td", { class: `num ${cls(o.rd)}` }, fmtSG(o.rd)), el("td", { class: "num muted" }, o.sPer != null ? fmtSG(o.sPer) : "—"), el("td", { class: `num ${cls(dlt)}` }, dlt != null ? `${dlt > 0 ? "▲" : "▼"} ${Math.abs(dlt).toFixed(2)}` : "")]); }))]))];
    const box = el("section", { class: "tr-pop", role: "dialog", "aria-modal": "true" }, [xb, el("p", { class: "fx-eyebrow" }, `${ev.event} · ${ev.year}`), el("h3", {}, `${c ? nm(c) : "Every part of the game"} by distance`), body]);
    const wrap = el("div", { class: "tr-popwrap" }, [back, box]); document.body.appendChild(wrap); xb.focus();
  }
  const tapC = (n, c) => { const go = () => openDist(c); n.addEventListener("click", go); n.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); return n; };
  // ---- the hero cards: the week, against that week's field ----
  const wk = (field || []).map((p) => ({ k: p.key, rs: (p.key === me?.key ? evRs : (p.rounds || []).filter((r) => r.event === ev.event && yrOf(r) === ev.year)) })).filter((p) => p.rs.length);
  const rankOf = (f) => { const vs = wk.map((p) => [p.k, avg(p.rs, f)]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]); const i = vs.findIndex((x) => x[0] === me?.key); return i < 0 ? null : { r: i + 1, n: vs.length }; };
  const card = (label, v, rk, big = false, c = null) => tapC(el("div", { class: `tr-hero${big ? " big" : ""}`, role: "button", tabindex: "0", title: "Tap for each distance" }, [el("span", { class: "tr-hero-l" }, label), el("strong", { class: cls(v) }, v == null ? "—" : fmtSG(v)), el("span", { class: "tr-hero-s" }, [`a round`, rk ? ` · ${ord(rk.r)} of ${rk.n} in the field` : ""])]), c);
  const best = [...evRs].sort((a, b) => tot(b) - tot(a))[0];
  const heroes = el("section", { class: "panel tr-heroes" }, [
    el("div", { class: "tr-head" }, [el("h2", {}, ev.event), el("span", { class: "muted" }, `${ev.year} · ${evRs.length} round${evRs.length === 1 ? "" : "s"}${best ? ` · best round ${fmtSG(tot(best))} (R${best.roundNo || "?"})` : ""}`)]),
    el("div", { class: "tr-hero-row" }, [card("Total", avg(evRs, tot), rankOf(tot), true, null), ...CATS.map(([c, l]) => card(l, avg(evRs, (r) => inCat(r, c)), rankOf((r) => inCat(r, c)), false, c))]),
  ]);

  // ---- the scorecard: a round at a time ----
  const rIds = evRs.map((r, i) => String(r.roundNo || i + 1));
  if (!rIds.includes(st.resRound)) st.resRound = rIds[0];
  const rd = evRs[rIds.indexOf(st.resRound)];
  const tabs = el("div", { class: "seg seg-sm tr-rounds", role: "group", "aria-label": "Round" }, rIds.map((id) => { const on = id === st.resRound, b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on) }, `Round ${id}`); b.addEventListener("click", () => { if (!on) { st.resRound = id; st.resHole = null; S.draw(); } }); return b; }));
  const cardBox = el("div", { class: "tr-card" }, el("p", { class: "muted small" }, "Loading the scorecard…")), holeBox = el("div", { class: "tr-hole" });
  const sc = el("section", { class: "panel tr-sc" }, [el("div", { class: "tr-sc-h" }, [el("p", { class: "fx-eyebrow" }, "Scorecard"), tabs]), cardBox, holeBox]);

  // the course's own shots (par, score, each shot's spot) when it has Strategy Maps; else the stats file's shots alone
  const shotsByHole = new Map(); for (const s of rd.shots || []) if (s.hole != null) (shotsByHole.get(s.hole) || shotsByHole.set(s.hole, []).get(s.hole)).push(s);
  (async () => {
    let meta = null, trails = null;
    // (update 757) the rounds here can come without each shot's hole: then the player's own rows (they have it)
    if (!shotsByHole.size && me) { try { const { loadSource } = await import("./reportGen.js"); const d = await loadSource("tour", me.key, me.label || "", { detail: false, field: false });
      const own = (d?.me?.rounds || []).find((r) => r.event === ev.event && yrOf(r) === ev.year && String(r.roundNo) === String(rd.roundNo));
      for (const s of own?.shots || []) if (s.hole != null) (shotsByHole.get(s.hole) || shotsByHole.set(s.hole, []).get(s.hole)).push(s); } catch (e) { console.warn("own rows", e); } }
    try {
      const CH = await import("./courseHeat.js"), list = await CH.listHeatCourses().catch(() => []);
      meta = (list || []).find((c) => (c.events || []).some((e) => norm(e.name) === norm(ev.event) && (!e.years?.length || e.years.map(String).includes(ev.year))))
        || (list || []).find((c) => (c.events || []).some((e) => norm(e.name) === norm(ev.event)))
        || (rd.course ? (list || []).find((c) => norm(c.name) === norm(rd.course) || norm(c.name).includes(norm(rd.course)) || norm(rd.course).includes(norm(c.name))) : null) || null; // (update 757: or by the course's name)
      if (meta && me) { const CS = await import("./courseShots.js"); const tr = await CS.playerTrails(meta, me.key).catch(() => null); trails = (tr?.trails || []).filter((t) => String(t.y) === ev.year && String(t.r) === String(rd.roundNo)); }
    } catch (e) { console.warn("scorecard", e); }
    const tOf = (h) => trails?.find((t) => Number(t.h) === h) || null;
    const holes = [...new Set([...shotsByHole.keys(), ...(trails || []).map((t) => Number(t.h))])].filter((h) => h >= 1 && h <= 18).sort((a, b) => a - b);
    if (!holes.length) { mount(cardBox, el("p", { class: "muted small" }, "No hole-by-hole shots for this round in the data.")); return; }
    const parOf = (h) => tOf(h)?.par ?? meta?.par?.[h - 1] ?? null, scoreOf = (h) => { const t = tOf(h); if (t?.s != null && parOf(h) != null) return parOf(h) + t.s; const ss = shotsByHole.get(h); return ss?.length && ss.every((s) => (s.w || 1) === 1) ? ss.length : null; };
    const sgOf = (h) => { const ss = shotsByHole.get(h); return ss ? ss.reduce((t, s) => t + (s.sg || 0), 0) : null; };
    const half = (hs, lab) => { if (!hs.length) return null; const sum = (f) => { const v = hs.map(f); return v.every((x) => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
      const cell = (h) => { const p = parOf(h), s = scoreOf(h), d = p != null && s != null ? s - p : null; const b = el("td", { class: `tr-sc-c${st.resHole === h ? " on" : ""}`, role: "button", tabindex: "0", title: `Hole ${h}` }, el("span", { class: `tr-sc-s ${d == null ? "" : d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "dbl"}` }, s == null ? "·" : String(s)));
        const go = () => { st.resHole = st.resHole === h ? null : h; drawCard(); drawHole(); }; b.addEventListener("click", go); b.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); return b; };
      return [el("tr", { class: "tr-sc-hr" }, [el("th", {}, "Hole"), ...hs.map((h) => el("th", {}, String(h))), el("th", {}, lab)]),
        el("tr", {}, [el("th", {}, "Par"), ...hs.map((h) => el("td", { class: "muted" }, parOf(h) ?? "")), el("td", { class: "muted" }, sum(parOf) ?? "")]),
        el("tr", {}, [el("th", {}, "Score"), ...hs.map(cell), el("td", { class: "tr-tot" }, sum(scoreOf) ?? "")]),
        el("tr", {}, [el("th", {}, "SG"), ...hs.map((h) => { const v = sgOf(h); return el("td", { class: `tr-sg ${cls(v)}` }, v == null ? "" : fmtSG(v)); }), el("td", { class: `tr-sg ${cls(sum(sgOf))}` }, sum(sgOf) == null ? "" : fmtSG(sum(sgOf)))])]; };
    const drawCard = () => mount(cardBox, [el("div", { class: "tr-sc-scroll" }, el("table", { class: "tr-sc-t" }, el("tbody", {}, [...(half(holes.filter((h) => h <= 9), "Out") || []), ...(half(holes.filter((h) => h > 9), "In") || [])]))),
      el("p", { class: "muted small" }, [meta ? "" : "Par and the hole pictures come from Strategy Maps; this course doesn't have them yet. ", "Tap a hole for its shots."])]);
    // a hole: its shots, then its picture with the trail
    const drawHole = () => {
      const h = st.resHole; if (!h) { mount(holeBox, null); return; }
      const ss = shotsByHole.get(h) || [], t = tOf(h), tq = t?.shots || [];
      const rows = (ss.length ? ss : tq).map((s, i) => { const q = tq[i]; const lie = s.lie || (q ? LIES[q[3]] : ""), dist = s.dist || (q && q[4] != null ? `${Math.round(q[4])} ${q[3] === 4 ? "ft" : "yds"}` : "");
        return el("tr", {}, [el("td", {}, String(i + 1)), el("td", {}, lie || "—"), el("td", {}, dist || "—"), el("td", {}, s.club || "—"), el("td", { class: `num ${cls(s.sg)}` }, s.sg != null ? fmtSG(s.sg) : "")]); });
      const show = meta && t?.shots?.length ? el("button", { type: "button", class: "btn ghost tr-show" }, "Show it on the course") : null;
      const pic = el("div", { class: "tr-pic" });
      show?.addEventListener("click", async () => { show.disabled = true; show.textContent = "Loading the hole…";
        try { const CH = await import("./courseHeat.js"), url = await CH.heatImage(meta, h); if (!url) throw new Error("no picture");
          const img = new Image(); img.src = url; await img.decode();
          const W = img.naturalWidth, H = img.naturalHeight, NS = "http://www.w3.org/2000/svg", sv = (tag, a = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
          const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "tr-trail" }), pts = tq.filter((q) => q[1] != null && q[2] != null), r0 = Math.max(W, H) / 120;
          svg.append(sv("polyline", { points: pts.map((q) => `${q[1]},${q[2]}`).join(" "), fill: "none", stroke: "#fff", "stroke-width": r0 * 0.45, "stroke-linejoin": "round", opacity: 0.9 }));
          pts.forEach((q, i) => { svg.append(sv("circle", { cx: q[1], cy: q[2], r: r0, fill: i === 0 ? "#30d158" : "#d4b483", stroke: "#111", "stroke-width": r0 * 0.2 })); const tx = sv("text", { x: q[1], y: q[2] + r0 * 0.4, "text-anchor": "middle", "font-size": r0 * 1.15, "font-weight": 800, fill: "#111" }); tx.textContent = String(i + 1); svg.append(tx); });
          mount(pic, el("div", { class: "tr-pic-in", style: `aspect-ratio:${W}/${H}` }, [img, svg])); show.remove();
        } catch (e) { console.warn(e); show.textContent = "The hole's picture isn't available"; } });
      mount(holeBox, [el("h3", {}, [`Hole ${h}`, parOf(h) ? ` · par ${parOf(h)}` : "", scoreOf(h) != null ? ` · ${scoreOf(h)}` : "", sgOf(h) != null ? el("span", { class: `tr-hsg ${cls(sgOf(h))}` }, ` · SG ${fmtSG(sgOf(h))}`) : null]),
        rows.length ? el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, ["#", "Lie", "Distance", "Club", "SG"].map((x, i) => el("th", { class: i === 4 ? "num" : null }, x)))), el("tbody", {}, rows)]) : el("p", { class: "muted small" }, "No shots recorded on this hole."),
        show, pic]);
    };
    drawCard(); drawHole();
  })();
  return [picker, heroes, sc];
}
