// (update 756) Stats › Tournament Results: a recap of each tournament the player played.
// (update 759) Built from the course's own shot data (Strategy Maps, with its tournament column): every player's every
// shot that week, so everything is ranked against the field: strokes gained a round in total and in each part of the
// game, each distance range (a shot), and every single shot ("the best shot of the tournament"). Each shot's strokes
// gained: the strokes to hole out from where it was played less those from where it finished, less one. A round's
// scorecard from it (par, score, strokes gained a hole), a hole's shots (each with its rank in the field), and the hole
// itself with the trail, into the cup. A tournament whose course isn't in Strategy Maps: the stats file's numbers, and
// a picker to link the course.
import { el, mount } from "./ui.js";
import { fmtSG } from "./sg.js";

const CATS = [["OTT", "Off-the-Tee"], ["APP", "Approach"], ["ARG", "Around-the-Green"], ["PUTT", "Putting"]];
const CATN = Object.fromEntries(CATS);
const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
const norm = (s) => String(s || "").toLowerCase().replace(/^the\s+/, "").replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/, "").replace(/[^a-z0-9]/g, "");
const tot = (rd) => (rd.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const inCat = (rd, c) => (rd.shots || []).reduce((t, s) => t + (s.cat === c ? s.sg || 0 : 0), 0);
const avg = (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null);
const cls = (v) => (v == null ? "" : v > 0.005 ? "pos" : v < -0.005 ? "neg" : "");
const ord = (n) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
const LIES = ["tee", "fairway", "rough", "bunker", "green", "water", "other"];
const cap = (t) => String(t || "").replace(/^./, (c) => c.toUpperCase());
// (update 760) a tournament's name as two files may spell it ("TOUR Championship" / "The Tour Championship presented by …")
const evMatch = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)))); };
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z\s,]/g, "").split(/[\s,]+/).filter(Boolean).sort().join(" ");

// ---- the week from the course's shots: every player, every shot ----
const weekMemo = new Map();
async function courseWeek(meta, ev) {
  const mk = `${meta.id}|${ev.year}|${norm(ev.event)}`; if (weekMemo.has(mk)) return weekMemo.get(mk);
  const p = (async () => {
    const [CR, CH, D] = await Promise.all([import("./courseRaw.js"), import("./courseHeat.js"), import("./data.js")]);
    const rows = await CR.loadRaw(meta); if (!rows?.length) return null;
    const num = (v) => (v == null || v === "" ? null : Number(v)), EX = await import("./courseExp.js");
    const hasEv = rows.some((r) => String(r[0]) === ev.year && r[19]);
    const inWeek = (r) => String(r[0]) === ev.year && (!hasEv || evMatch(r[19], ev.event));
    // (update 761) every finished hole on record at the course (every year), for the expected strokes from each spot
    const all = new Map(), trails = new Map();
    for (const r of rows) { const h = num(r[6]), st = num(r[10]); if (!h || st == null) continue;
      const idv = r[4] != null && r[4] !== "" ? String(num(r[4]) ?? r[4]) : r[3] != null ? String(r[3]) : null; if (!idv) continue;
      const wk = inWeek(r), pk = D.clientKey(idv), lie = CH.lieName(r[9]) || "other", q = { st, lie, d: num(r[21]) ?? num(r[18]), x: num(r[13]), y: num(r[14]) };
      const ak = `${r[0]}|${pk}|${r[5]}|${h}`; let T = all.get(ak);
      if (!T) { T = { meta, pk, name: r[3] != null ? String(r[3]) : idv, rd: String(num(r[5]) ?? r[5] ?? ""), h, par: num(r[7]), pid: String(r[8] ?? "1"), px: num(r[16]), py: num(r[17]), qs: [], s: null }; all.set(ak, T); if (wk) trails.set(`${pk}|${r[5]}|${h}`, T); }
      T.qs.push(q); if (num(r[12]) === 1) { const sf = num(r[11]); T.s = sf != null ? Math.round(sf) : T.par ? st - T.par : null; }
      if (T.px == null && num(r[16]) != null) { T.px = num(r[16]); T.py = num(r[17]); } }
    if (!trails.size) return null;
    for (const T of all.values()) T.qs.sort((a, b) => a.st - b.st);
    const E = EX.expectModel(all.values());
    const band = (cat, q) => { const d = q.d; if (d == null) return null; if (cat === "PUTT") { const ft = d; return ft < 5 ? "0-5 ft" : ft < 10 ? "5-10 ft" : ft < 20 ? "10-20 ft" : ft < 30 ? "20-30 ft" : "30+ ft"; }
      if (cat === "ARG") return d < 10 ? "0-10 yds" : d < 20 ? "10-20 yds" : "20-30 yds"; if (cat === "APP") { if (d >= 250) return "250+ yds"; const lo = Math.floor(d / 25) * 25; return `${lo}-${lo + 25} yds`; } return null; };
    const players = new Map(), shots = [];
    for (const T of trails.values()) {
      const P = players.get(T.pk) || players.set(T.pk, { pk: T.pk, name: T.name, rds: new Set(), tot: 0, cat: { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }, band: new Map() }).get(T.pk); P.rds.add(T.rd);
      const sgs = EX.shotSG(T, E);
      T.qs.forEach((q, i) => { const sg = sgs[i]; if (sg == null) return;
        const cat = q.lie === "green" ? "PUTT" : q.st === 1 && (T.par || 4) >= 4 ? "OTT" : q.d != null && q.d <= 30 ? "ARG" : "APP"; q.sg = sg; q.cat = cat;
        P.tot += sg; P.cat[cat] += sg; const bd = band(cat, q); if (bd) { const k = `${cat}|${bd}`, o = P.band.get(k) || P.band.set(k, [0, 0]).get(k); o[0] += sg; o[1]++; q.band = bd; }
        shots.push({ pk: T.pk, sg, T, q }); }); }
    shots.sort((a, b) => b.sg - a.sg); shots.forEach((s, i) => { s.q.rank = i + 1; });
    return { trails, players, shots, nShots: shots.length };
  })();
  weekMemo.set(mk, p); p.catch(() => weekMemo.delete(mk)); return p;
}
// (update 760) the week over every course it was played on (a rota like The American Express): merged, every shot ranked again
async function weekOf(metas, ev) {
  const ws = (await Promise.all(metas.map((m) => courseWeek(m, ev).catch((e) => { console.warn(e); return null; })))).filter(Boolean); if (!ws.length) return null;
  if (ws.length === 1) return ws[0];
  const trails = new Map(), players = new Map(), shots = [];
  ws.forEach((w, i) => { for (const [k, t] of w.trails) trails.set(`${i}|${k}`, t); shots.push(...w.shots);
    for (const p of w.players.values()) { const o = players.get(p.pk); if (!o) { players.set(p.pk, { ...p, rds: new Set(p.rds), cat: { ...p.cat }, band: new Map([...p.band].map(([k, v]) => [k, [...v]])) }); continue; }
      p.rds.forEach((r) => o.rds.add(r)); o.tot += p.tot; for (const c in p.cat) o.cat[c] += p.cat[c]; for (const [k, v] of p.band) { const b = o.band.get(k) || o.band.set(k, [0, 0]).get(k); b[0] += v[0]; b[1] += v[1]; } } });
  shots.sort((a, b) => b.sg - a.sg); shots.forEach((x, i) => { x.q.rank = i + 1; });
  return { trails, players, shots, nShots: shots.length };
}
const rankIn = (vals, key, higher = true) => { const s = [...vals].sort((a, b) => (higher ? b[1] - a[1] : a[1] - b[1])); const i = s.findIndex((x) => x[0] === key); return i < 0 ? null : { r: i + 1, n: s.length, lead: s[0] }; };

/** rounds: the player's rounds on the tour picked (every year); field: every player's rounds there (the stats-file fallback). */
export function resultsView(S, rounds, field) {
  const st = S.st, me = S.me, rs0 = (rounds || []).filter((r) => r.event);
  const evMap = new Map();
  for (const r of rs0) { const k = `${r.event}|${yrOf(r)}`; (evMap.get(k) || evMap.set(k, { key: k, event: r.event, year: yrOf(r), rs: [] }).get(k)).rs.push(r); }
  const evs = [...evMap.values()].map((e) => ({ ...e, end: e.rs.map((r) => String(r.date)).sort().at(-1) })).sort((a, b) => b.end.localeCompare(a.end));
  if (!evs.length) return [el("section", { class: "panel" }, el("p", { class: "muted" }, "No tournaments with strokes gained on this tour yet."))];
  if (!evMap.has(st.resKey)) st.resKey = evs[0].key;
  const ev = evMap.get(st.resKey), years = [...new Set(evs.map((e) => e.year))].sort().reverse();
  const evRs = [...ev.rs].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.roundNo).localeCompare(String(b.roundNo)));

  // ---- the picker ----
  const ySel = el("select", { class: "tr-sel", "aria-label": "Year" }, years.map((y) => el("option", { value: y }, y)));
  const eSel = el("select", { class: "tr-sel", "aria-label": "Tournament" }, evs.filter((e) => e.year === ev.year).map((e) => el("option", { value: e.key }, e.event)));
  ySel.value = ev.year; eSel.value = ev.key;
  ySel.addEventListener("change", () => { const e = evs.find((x) => x.year === ySel.value); if (e) { st.resKey = e.key; st.resRound = null; st.resHole = null; S.draw(); } });
  eSel.addEventListener("change", () => { st.resKey = eSel.value; st.resRound = null; st.resHole = null; S.draw(); });
  const picker = el("section", { class: "panel tr-pick" }, [el("p", { class: "fx-eyebrow" }, "Tournament results"), el("div", { class: "tr-pick-row" }, [ySel, eSel])]);

  const heroBox = el("section", { class: "panel tr-heroes" }, el("p", { class: "muted small" }, "Loading the week…"));
  const scBox = el("section", { class: "panel tr-sc" }, el("p", { class: "muted small" }, "Loading the scorecard…"));

  (async () => {
    // (update 760) the course(s) from the tournament itself: those whose shots carry its name that year (no picking by hand)
    let list = [], metas = [], W = null;
    try { const CH = await import("./courseHeat.js"); list = (await CH.listHeatCourses().catch(() => [])) || [];
      const hasYr = (e) => !e.years?.length || e.years.map(String).includes(ev.year), withRaw = list.filter((c) => c.rawChunks);
      metas = withRaw.filter((c) => (c.events || []).some((e) => evMatch(e.name, ev.event) && hasYr(e)));
      if (!metas.length) metas = withRaw.filter((c) => (c.events || []).some((e) => evMatch(e.name, ev.event)));
      if (!metas.length) { const course = evRs.find((r) => r.course)?.course; if (course) metas = withRaw.filter((c) => !(c.events || []).length && (norm(c.name) === norm(course) || norm(c.name).includes(norm(course)) || norm(course).includes(norm(c.name)))); }
      if (metas.length) W = await weekOf(metas, ev);
    } catch (e) { console.warn("results", e); }
    const cName = metas.map((m) => m.name).join(" & ");
    // the player: by their key, else by their name
    const pk = !W || !me ? null : W.players.has(me.key) ? me.key : [...W.players.values()].find((p) => nameKey(p.name) === nameKey(me.label))?.pk || null;
    const P = pk ? W.players.get(pk) : null;

    // ---- the hero cards: against the week's field ----
    const field0 = W ? [...W.players.values()] : [];
    const perRd = (p, f) => f(p) / Math.max(1, p.rds.size);
    const rk = (f) => (P ? rankIn(field0.map((p) => [p.pk, perRd(p, f)]), pk) : null);
    const best = P ? W.shots.find((s) => s.pk === pk) : null;
    // (update 763) each of the player's shots ranked among their own (1 to however many they hit), and in the field
    const myShots = P ? W.shots.filter((x) => x.pk === pk) : [], myN = myShots.length; myShots.forEach((x, i) => { x.q.myRank = i + 1; });
    const CATL = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" }, dTxt = (q) => (q.d != null ? `${Math.round(q.d)} ${q.lie === "green" ? "ft" : "yds"}` : "—");
    // a pop-up of shots, best first: the player's own, or every shot in the field (theirs marked); opens at the one tapped
    function openShots(mode, focus) {
      document.querySelector(".tr-popwrap")?.remove();
      const close = () => wrap.remove(), xb = el("button", { type: "button", class: "tr-pop-x", "aria-label": "Close" }, "×"); xb.addEventListener("click", close);
      const back = el("div", { class: "tr-pop-back" }); back.addEventListener("click", close);
      const holder = el("div", { class: "tr-pop-scroll tr-shots-scroll" }), head = el("p", { class: "muted small" });
      const tg = el("div", { class: "tr-rounds", role: "group", "aria-label": "Which shots" });
      const draw = (m) => {
        mount(tg, [["mine", `${me?.label || "Their"} shots (${myN})`], ["field", `Every shot in the field (${W.nShots.toLocaleString()})`]].map(([v, l]) => { const b = el("button", { type: "button", class: `tr-rd${v === m ? " on" : ""}`, "aria-pressed": String(v === m) }, l); b.addEventListener("click", () => { if (v !== m) draw(v); }); return b; }));
        const list = m === "mine" ? myShots : W.shots, f = m === "field";
        mount(head, f ? `Every player's every shot that week, best first; ${me?.label || "their"} shots are highlighted.` : `Every shot ${me?.label || "they"} hit that week, best first; the last column is its rank among every shot in the field.`);
        let target = null;
        const rows = list.map((x, i) => { const q = x.q, mine = x.pk === pk, tr = el("tr", { class: [f && mine ? "mine" : null, q === focus ? "target" : null].filter(Boolean).join(" ") || null }, [
          el("td", { class: "num" }, String(i + 1)), f ? el("td", {}, x.T.name) : null, el("td", {}, `R${x.T.rd}`), el("td", {}, String(x.T.h)), el("td", {}, CATL[q.cat] || ""), el("td", {}, cap(q.lie)), el("td", {}, dTxt(q)),
          el("td", { class: `num ${cls(x.sg)}` }, fmtSG(x.sg)), el("td", { class: "num muted" }, f ? (mine ? `${ord(q.myRank)} of ${myN} of theirs` : "") : `${ord(q.rank)} of ${W.nShots.toLocaleString()}`)]); if (q === focus) target = tr; return tr; });
        mount(holder, el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, ["Rank", f ? "Player" : null, "Round", "Hole", "Category", "Lie", "Distance", "SG", f ? "Their rank" : "In the field"].filter(Boolean).map((x0, i) => el("th", { class: i === 0 || /SG|rank|field/i.test(x0) ? "num" : null }, x0)))), el("tbody", {}, rows)]));
        requestAnimationFrame(() => { if (target) holder.scrollTop = Math.max(0, target.offsetTop - holder.clientHeight / 2); });
      };
      const box = el("section", { class: "tr-pop tr-pop-wide", role: "dialog", "aria-modal": "true" }, [xb, el("p", { class: "fx-eyebrow" }, `${ev.event} · ${ev.year}`), el("h3", {}, "Shot by shot, ranked"), tg, head, holder]);
      const wrap = el("div", { class: "tr-popwrap" }, [back, box]); document.body.appendChild(wrap); draw(mode); xb.focus();
    }
    const card = (label, v, r, big, c) => { const n = el("div", { class: `tr-hero${big ? " big" : ""}`, role: "button", tabindex: "0", title: "Tap for each distance" }, [el("span", { class: "tr-hero-l" }, label), el("strong", { class: cls(v) }, v == null ? "—" : fmtSG(v)), el("span", { class: "tr-hero-s" }, ["a round", r ? [" · ", el("b", { class: r.r <= 10 ? "pos" : "" }, `${ord(r.r)} of ${r.n}`), " in the field"] : ""])]);
      const go = () => openDist(c); n.addEventListener("click", go); n.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); return n; };
    const nR = P ? P.rds.size : evRs.length;
    const vTot = P ? perRd(P, (p) => p.tot) : avg(evRs, tot);
    const cards = [card("Total", vTot, rk((p) => p.tot), true, null), ...CATS.map(([c, l]) => card(l, P ? perRd(P, (p) => p.cat[c]) : avg(evRs, (r) => inCat(r, c)), rk((p) => p.cat[c]), false, c))];
    const bestLine = best ? (() => { const b = el("button", { type: "button", class: "tr-best", title: "See every shot in the field" }, [el("strong", {}, best.q.rank === 1 ? "The best shot of the tournament: " : `Best shot: `), `${fmtSG(best.sg)} on hole ${best.T.h}, round ${best.T.rd}, ${dTxt(best.q)} from the ${best.q.lie}`, el("span", { class: "muted" }, ` · ${ord(best.q.rank)} of ${W.nShots.toLocaleString()} shots in the field · tap for every shot`)]);
      b.addEventListener("click", () => openShots("field", best.q)); return b; })() : null;
    mount(heroBox, [el("div", { class: "tr-head" }, [el("h2", {}, ev.event), el("span", { class: "muted" }, `${ev.year} · ${nR} round${nR === 1 ? "" : "s"}${W ? ` · ${field0.length} players on record` : ""}`)]), el("div", { class: "tr-hero-row" }, cards), bestLine,
      P ? null : el("p", { class: "muted small" }, "These numbers are from the stats file: the ranks, the scorecard and the shots need the tournament's shots in Strategy Maps.")].filter(Boolean));

    // a card: each distance range, a shot, with the rank in the field
    function openDist(c) {
      document.querySelector(".tr-popwrap")?.remove();
      let rows = [];
      if (P) { const keys = [...P.band.keys()].filter((k) => !c || k.startsWith(`${c}|`));
        rows = keys.map((k) => { const [cat, bd] = k.split("|"), [sg, n] = P.band.get(k), r = rankIn(field0.filter((p) => (p.band.get(k)?.[1] || 0) >= 2).map((p) => [p.pk, p.band.get(k)[0] / p.band.get(k)[1]]), pk); return { cat, bd, per: sg / n, n, rd: sg / Math.max(1, P.rds.size), r }; })
          .sort((a, b) => CATS.findIndex(([x]) => x === a.cat) - CATS.findIndex(([x]) => x === b.cat) || (parseFloat(a.bd) || 0) - (parseFloat(b.bd) || 0)); }
      const close = () => wrap.remove(), xb = el("button", { type: "button", class: "tr-pop-x", "aria-label": "Close" }, "×"); xb.addEventListener("click", close);
      const back = el("div", { class: "tr-pop-back" }); back.addEventListener("click", close);
      const top3 = [...rows].filter((o) => o.r).sort((a, b) => a.r.r / a.r.n - b.r.r / b.r.n)[0];
      const body = !rows.length ? [el("p", { class: "muted" }, P ? "No distances on these shots." : "Distance ranks need the course's shots (Strategy Maps).")] : [
        top3 ? el("p", { class: "tr-pop-calls" }, [el("strong", { class: "pos" }, `Best: ${CATN[top3.cat]} ${top3.bd}`), ` · ${ord(top3.r.r)} of ${top3.r.n} in the field (${fmtSG(top3.per)} a shot)`]) : null,
        el("div", { class: "tr-pop-scroll" }, el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, [c ? "Distance" : "Part · distance", "Shots", "SG a shot", "SG a round", "Rank in the field"].map((x, i) => el("th", { class: i ? "num" : null }, x)))),
          el("tbody", {}, rows.map((o) => el("tr", {}, [el("td", {}, c ? o.bd : `${CATN[o.cat]} · ${o.bd}`), el("td", { class: "num" }, String(o.n)), el("td", { class: `num ${cls(o.per)}` }, fmtSG(o.per)), el("td", { class: `num ${cls(o.rd)}` }, fmtSG(o.rd)), el("td", { class: `num ${o.r && o.r.r <= 10 ? "pos" : ""}` }, o.r ? `${ord(o.r.r)} of ${o.r.n}` : "—")])))]))];
      const box = el("section", { class: "tr-pop", role: "dialog", "aria-modal": "true" }, [xb, el("p", { class: "fx-eyebrow" }, `${ev.event} · ${ev.year}`), el("h3", {}, `${c ? CATN[c] : "Every part of the game"} by distance`), ...body].filter(Boolean));
      const wrap = el("div", { class: "tr-popwrap" }, [back, box]); document.body.appendChild(wrap); xb.focus();
    }

    // ---- the scorecard: a round at a time ----
    if (!W || !P) { mount(scBox, [el("p", { class: "fx-eyebrow" }, "Scorecard"), el("p", { class: "muted small" }, !metas.length ? `No course in Strategy Maps has ${ev.event} ${ev.year} in its tournament column yet. Upload that course's shot file (with the tournament column) in Strategy Maps and it will show here.` : !W ? `${cName} has no shots for ${ev.event} ${ev.year} in Strategy Maps.` : `${cName} has ${ev.event} ${ev.year}, but no shots of ${me?.label || "this player"}'s in it.`)]); return; }
    const myT = [...W.trails.values()].filter((t) => t.pk === pk), rIds = [...new Set(myT.map((t) => t.rd))].sort((a, b) => Number(a) - Number(b));
    if (!rIds.includes(st.resRound)) st.resRound = rIds[0];
    const tOf = (h) => myT.find((t) => t.rd === st.resRound && t.h === h), holes = [...new Set(myT.filter((t) => t.rd === st.resRound).map((t) => t.h))].sort((a, b) => a - b);
    const parOf = (h) => tOf(h)?.par ?? tOf(h)?.meta?.par?.[h - 1] ?? null, scoreOf = (h) => { const t = tOf(h); return t?.s != null && parOf(h) != null ? parOf(h) + t.s : null; }, sgOf = (h) => { const t = tOf(h); return t ? t.qs.reduce((a, q) => a + (q.sg || 0), 0) : null; };
    if (!holes.includes(st.resHole)) st.resHole = holes[0] ?? null;
    const tabs = el("div", { class: "tr-rounds", role: "group", "aria-label": "Round" }, rIds.map((id) => { const on = id === st.resRound, b = el("button", { type: "button", class: `tr-rd${on ? " on" : ""}`, "aria-pressed": String(on) }, `R${id}`); b.addEventListener("click", () => { if (!on) { st.resRound = id; st.resHole = null; S.draw(); } }); return b; }));
    const cardBox = el("div", { class: "tr-card" }), holeBox = el("div", { class: "tr-hole" });
    const half = (hs, lab) => { if (!hs.length) return []; const sum = (f) => { const v = hs.map(f); return v.every((x) => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
      const cell = (h) => { const p = parOf(h), s = scoreOf(h), d = p != null && s != null ? s - p : null; const b = el("td", { class: `tr-sc-c${st.resHole === h ? " on" : ""}`, role: "button", tabindex: "0", title: `Hole ${h}` }, el("span", { class: `tr-sc-s ${d == null ? "" : d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "dbl"}` }, s == null ? "·" : String(s)));
        const go = () => { st.resHole = h; drawCard(); drawHole(); }; b.addEventListener("click", go); b.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); return b; };
      return [el("tr", { class: "tr-sc-hr" }, [el("th", {}, "Hole"), ...hs.map((h) => el("th", {}, String(h))), el("th", {}, lab)]),
        el("tr", {}, [el("th", {}, "Par"), ...hs.map((h) => el("td", { class: "muted" }, parOf(h) ?? "")), el("td", { class: "muted" }, sum(parOf) ?? "")]),
        el("tr", {}, [el("th", {}, "Score"), ...hs.map(cell), el("td", { class: "tr-tot" }, sum(scoreOf) ?? "")]),
        el("tr", {}, [el("th", {}, "SG"), ...hs.map((h) => { const v = sgOf(h); return el("td", { class: `tr-sg ${cls(v)}` }, v == null ? "" : fmtSG(v)); }), el("td", { class: `tr-sg ${cls(sum(sgOf))}` }, sum(sgOf) == null ? "" : fmtSG(sum(sgOf)))])]; };
    const drawCard = () => mount(cardBox, [el("div", { class: "tr-sc-scroll" }, el("table", { class: "tr-sc-t" }, el("tbody", {}, [...half(holes.filter((h) => h <= 9), "Out"), ...half(holes.filter((h) => h > 9), "In")]))), el("p", { class: "muted small" }, `Tap a hole for its shots and the hole · ${[...new Set(myT.filter((t) => t.rd === st.resRound).map((t) => t.meta.name))].join(" & ")}`)]);
    // a hole: its shots (each ranked among every shot that week) beside the hole itself with the trail, into the cup
    const drawHole = () => {
      const h = st.resHole, t = h ? tOf(h) : null; if (!t) { mount(holeBox, null); return; }
      const rows = t.qs.map((q, i) => el("tr", {}, [el("td", {}, String(i + 1)), el("td", {}, cap(q.lie)), el("td", {}, q.d != null ? `${Math.round(q.d)} ${q.lie === "green" ? "ft" : "yds"}` : "—"), el("td", { class: `num ${cls(q.sg)}` }, q.sg != null ? fmtSG(q.sg) : ""), el("td", { class: `num ${q.myRank && q.myRank <= 10 ? "pos" : "muted"}` }, q.myRank ? `${ord(q.myRank)} of ${myN}` : "")]));
      rows.forEach((tr, i) => { const q = t.qs[i]; if (!q.myRank) return; tr.classList.add("tr-tap"); tr.setAttribute("role", "button"); tr.tabIndex = 0; const go = () => openShots("mine", q); tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
      const pic = el("div", { class: "tr-pic" }, el("p", { class: "muted small" }, "Loading the hole…"));
      mount(holeBox, [el("h3", {}, [`Hole ${h}`, parOf(h) ? ` · par ${parOf(h)}` : "", scoreOf(h) != null ? ` · ${scoreOf(h)}` : "", sgOf(h) != null ? el("span", { class: `tr-hsg ${cls(sgOf(h))}` }, ` · SG ${fmtSG(sgOf(h))}`) : null]),
        el("div", { class: "tr-hole-grid" }, [pic, el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, ["#", "Lie", "Distance", "SG", "Rank of their shots"].map((x, i) => el("th", { class: i >= 3 ? "num" : null }, x)))), el("tbody", {}, rows)])])]);
      (async () => { try { const CH = await import("./courseHeat.js"), url = await CH.heatImage(t.meta, h); if (!url) throw new Error("no picture");
        const img = new Image(); img.src = url; await img.decode();
        const Wd = img.naturalWidth, Hd = img.naturalHeight, NS = "http://www.w3.org/2000/svg", sv = (tag, a = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
        const svg = sv("svg", { viewBox: `0 0 ${Wd} ${Hd}`, class: "tr-trail" }), pts = t.qs.filter((q) => q.x != null && q.y != null).map((q) => [q.x, q.y]), r0 = Math.max(Wd, Hd) / 110;
        if (t.s != null && t.px != null) pts.push([t.px, t.py]); // (the last putt: into the cup)
        svg.append(sv("polyline", { points: pts.map((q) => q.join(",")).join(" "), fill: "none", stroke: "#fff", "stroke-width": r0 * 0.45, "stroke-linejoin": "round", opacity: 0.95 }));
        t.qs.filter((q) => q.x != null).forEach((q, i) => { svg.append(sv("circle", { cx: q.x, cy: q.y, r: r0, fill: i === 0 ? "#30d158" : "#d4b483", stroke: "#111", "stroke-width": r0 * 0.2 })); const tx = sv("text", { x: q.x, y: q.y + r0 * 0.4, "text-anchor": "middle", "font-size": r0 * 1.15, "font-weight": 800, fill: "#111" }); tx.textContent = String(i + 1); svg.append(tx); });
        if (t.s != null && t.px != null) { svg.append(sv("circle", { cx: t.px, cy: t.py, r: r0 * 0.55, fill: "#111", stroke: "#fff", "stroke-width": r0 * 0.25 })); svg.append(sv("line", { x1: t.px, y1: t.py, x2: t.px, y2: t.py - r0 * 3, stroke: "#fff", "stroke-width": r0 * 0.25 })); svg.append(sv("polygon", { points: `${t.px},${t.py - r0 * 3} ${t.px + r0 * 1.6},${t.py - r0 * 2.5} ${t.px},${t.py - r0 * 2}`, fill: "#ff453a" })); }
        mount(pic, el("div", { class: "tr-pic-in", style: `aspect-ratio:${Wd}/${Hd}` }, [img, svg]));
      } catch (e) { console.warn(e); mount(pic, el("p", { class: "muted small" }, "The hole's picture isn't available.")); } })();
    };
    mount(scBox, [el("div", { class: "tr-sc-h" }, [el("p", { class: "fx-eyebrow" }, "Scorecard"), tabs]), cardBox, holeBox]);
    drawCard(); drawHole();
  })().catch((e) => { console.warn("results", e); mount(scBox, el("p", { class: "muted small" }, `This tournament couldn’t be drawn (${e?.message || e}).`)); }); // (update 760: never a blank page)
  return [picker, heroBox, scBox];
}
