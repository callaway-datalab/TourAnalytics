// (update 756) Stats › Tournament Results: a recap of each tournament the player played.
// (update 759) Built from the course's own shot data (Strategy Maps, with its tournament column): every player's every
// shot that week, so everything is ranked against the field: strokes gained per round in total and in each part of the
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
const nameKeyOf = (s) => String(s || "").replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/[^a-z\s,]/g, "").split(/[\s,]+/).filter(Boolean).sort().join(" ");
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
      const idv = r[4] != null && r[4] !== "" ? (Number.isFinite(num(r[4])) ? String(num(r[4])) : String(r[4])) : r[3] != null ? String(r[3]) : null; /* (update 814: an id that isn't a number kept as it is, not "NaN" for everyone) */ if (!idv) continue;
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

  // ---- (update 918) the season at a glance, every tournament he played, and the one opened ----
  if (!st.resYear || !(st.resYear === "all" || years.includes(st.resYear))) st.resYear = years[0];
  const ySel = el("select", { class: "tr-sel", "aria-label": "Season" }, [...years.map((y) => el("option", { value: y }, y)), el("option", { value: "all" }, "All seasons")]);
  ySel.value = st.resYear;
  ySel.addEventListener("change", () => { st.resYear = ySel.value; st.resOpen = false; S.draw(); });
  const inYr = evs.filter((e) => st.resYear === "all" || e.year === st.resYear), who = me?.label || "", whoL = String(who).replace(/\s*\([^)]*\)\s*$/, "").trim().split(/\s+/).slice(-1)[0] || "His";
  const sumBox = el("div", { class: "tr-sum" }, el("p", { class: "muted small" }, "Loading the season…"));
  const listBox = el("div", { class: "tr-list" });
  // (update 919) opening a tournament takes you down to it, clear of the top bar; again once its first box has loaded, if that moved it
  const toDetail = () => { const go1 = () => { const n = document.querySelector(".tr-heroes"); if (!n) return; const bar = Math.max(0, document.querySelector(".rail")?.getBoundingClientRect().bottom || 0); window.scrollTo({ top: Math.max(0, n.getBoundingClientRect().top + window.scrollY - bar - 12), behavior: "smooth" }); };
    let moved = false; const mv = () => { moved = true; }; addEventListener("wheel", mv, { once: true, passive: true }); addEventListener("touchmove", mv, { once: true, passive: true });
    setTimeout(go1, 120); setTimeout(() => { removeEventListener("wheel", mv); removeEventListener("touchmove", mv); if (moved) return; const n = document.querySelector(".tr-heroes"); if (n && Math.abs(n.getBoundingClientRect().top - Math.max(0, document.querySelector(".rail")?.getBoundingClientRect().bottom || 0) - 12) > 40) go1(); }, 1500); };
  const sgRd = (e) => avg(e.rs.filter((r) => !r.eventLevel), tot);
  const drawList = (fin = new Map()) => { const pos = (e) => fin.get(e.key);
    mount(listBox, [el("div", { class: "tr-lb-wrap" }, el("table", { class: "tr-lb-t tr-evs" }, [el("thead", {}, el("tr", {}, ["Date", "Tournament", "Finish", "To par", "Rounds", "SG per round"].map((h, i) => el("th", { class: i >= 2 ? "num" : "" }, h)))),
      el("tbody", {}, inYr.map((e) => { const o = pos(e), open = st.resOpen && st.resKey === e.key, v = sgRd(e);
        const tr = el("tr", { class: `tr-ev${open ? " on" : ""}`, tabindex: "0", title: open ? "Close" : "Open this tournament" }, [el("td", { class: "muted" }, new Date(`${String(e.rs[0]?.date || e.end).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(st.resYear === "all" ? { year: "numeric" } : {}) })),
          el("td", {}, [open ? "\u25BE " : "\u25B8 ", e.event]), el("td", { class: `num strong ${o?.pos === "1" ? "pos" : /^(CUT|MC|WD|DQ)$/i.test(o?.pos || "") ? "neg" : ""}` }, o?.pos ? (/^\d+$/.test(o.pos) ? ord(Number(o.pos)) : o.pos) : "—"),
          el("td", { class: "num" }, o?.total == null ? "—" : Number(o.total) === 0 ? "E" : Number(o.total) > 0 ? `+${o.total}` : String(o.total).replace("-", "\u2212")),
          el("td", { class: "num" }, String(new Set(e.rs.map((r) => r.roundNo)).size)), el("td", { class: `num ${cls(v)}` }, v == null ? "—" : fmtSG(v))]);
        const go = () => { if (open) { st.resOpen = false; } else { st.resKey = e.key; st.resOpen = true; st.resRound = null; st.resHole = null; } S.draw(); if (!open) toDetail(); };
        tr.addEventListener("click", go); tr.addEventListener("keydown", (k) => { if (k.key === "Enter") go(); }); return tr; }))])),
      fin.size && inYr.some((e) => !fin.get(e.key)?.pos) ? el("p", { class: "muted small" }, "— : no official result saved for that tournament (the live feed has no leaderboard for it, as with some majors)") : null]); };
  drawList();
  // the cards: events, cuts, wins, top 10s, average finish; and from the scorecards, contention and clutch
  (async () => {
    const PI = await import("./playerInsights.js"), code = PI.tourCodeOf(rs0[0]?.tour), yrs = [...new Set(inYr.map((e) => e.year))];
    const fin = new Map(); if (code) { await PI.ensureResults(code, yrs).catch(() => null); for (const e of inYr) { const o = PI.officialSync(e.event, e.year, who, code, e.end); if (o && !o.missing) fin.set(e.key, o); } }
    drawList(fin);
    const n = inYr.length, posN = (e) => { const p = fin.get(e.key)?.pos; return p && /^T?\d+$/i.test(p) ? Number(String(p).replace(/^T/i, "")) : null; };
    const missed = inYr.filter((e) => { const p = fin.get(e.key)?.pos; return p ? /^(CUT|MC)$/i.test(p) : new Set(e.rs.map((r) => r.roundNo)).size <= 2; }).length;
    const places = inYr.map(posN).filter((v) => v != null), wins = places.filter((v) => v === 1).length, t10 = places.filter((v) => v <= 10).length;
    const card = (label, big, sub, c0 = "") => el("div", { class: `tr-sc-card ${c0}` }, [el("span", { class: "tr-sc-l" }, label), el("b", {}, big), sub ? el("small", {}, sub) : null]);
    const base = [card("Events", String(n), st.resYear === "all" ? "all seasons" : st.resYear), card("Cuts made", `${n - missed} of ${n}`, n ? `${Math.round((100 * (n - missed)) / n)}%` : ""), card("Wins", String(wins), wins ? "" : "\u00a0", wins ? "pos" : ""), card("Top 10s", String(t10), places.length ? `of ${places.length} with a finish` : "no official finishes"),
      card("Average finish", places.length ? ord(Math.round(places.reduce((a, b) => a + b, 0) / places.length)) : "—", places.length ? "made cuts" : "")];
    mount(sumBox, el("div", { class: "tr-sc-cards" }, base));
    try { const [M0, evsC] = await Promise.all([import("./clutch.js"), PI.clutchEvents(["R", "H"], yrs.length ? yrs : years)]); const all = M0.clutchFrom(evsC), o = [...all.values()].find((x) => nameKeyOf(x.name) === nameKeyOf(who)), f = M0.clutchFmt;
      if (o) { const cont = o.cont.filter((c) => st.resYear === "all" || c.year === st.resYear);
        mount(sumBox, el("div", { class: "tr-sc-cards" }, [...base,
          card("In contention", `${cont.length}×`, `within 3 of the lead into the final round · ${cont.filter((c) => c.won).length} won`),
          card("Clutch", f(o.clutch), o.contN ? `final rounds in contention vs his usual (${o.contN})` : "not in contention yet", (o.clutch ?? 0) >= 0.005 ? "pos" : (o.clutch ?? 0) <= -0.005 ? "neg" : ""),
          card("54-hole leads", o.leads ? `${o.leadWins} of ${o.leads}` : "—", o.leads ? "converted" : "none"),
          card("Wins from behind", String(o.winsBehind), o.winsBehind ? `up to ${o.maxBackWon} back` : "\u00a0"),
          o.label ? card("Type", o.label.t, o.label.why, o.label.k === "fader" ? "neg" : "pos") : null].filter(Boolean)),
          el("p", { class: "muted small" }, "Contention and clutch from every saved scorecard (Scouting \u203a Clutch explains them)")); } } catch (e2) { console.warn("clutch", e2); }
  })();
  const picker = el("section", { class: "panel tr-pick" }, [el("div", { class: "tr-pick-head" }, [el("p", { class: "fx-eyebrow" }, `Tournament results${who ? ` \u00b7 ${who.replace(/\s*\([^)]*\)\s*$/, "")}` : ""}`), ySel]), sumBox,
    el("p", { class: "fx-eyebrow tr-list-h" }, `${whoL === "His" ? "His" : `${whoL}'s`} tournaments · tap one to open it`), listBox]);
  if (!st.resOpen) return [picker]; // (nothing opened: the season and the list only)

  const heroBox = el("section", { class: "panel tr-heroes" }, el("p", { class: "muted small" }, "Loading the week…"));
  const lbBox = el("section", { class: "panel tr-lb" }, el("p", { class: "muted small" }, "Loading the leaderboard…"));
  const storyBox = el("section", { class: "panel tr-story", hidden: true }); // (update 915) how the tournament played out

  // (update 925) a player's scorecard, round by round: the official hole-by-hole scores (the live feed's scorecards), and where
  // Strategy Maps has the tournament's shots, each hole's strokes gained and, tapped, its shots on the hole's picture
  function cardFor(o) {
    const holder = el("div", { class: "tr-sc tr-sc-in" }, el("p", { class: "muted small" }, "Loading the scorecard…"));
    wkP.then(({ W }) => {
      const C = o.C, pk = W ? ([...W.players.values()].find((p) => nameKey(p.name) === nameKey(o.name) || (o.key && p.pk === o.key))?.pk || null) : null;
      const myT = pk ? [...W.trails.values()].filter((t) => t.pk === pk) : [];
      if (pk && !myT.some((t) => t.qs.some((q) => q.myRank))) W.shots.filter((x) => x.pk === pk).forEach((x, i) => { x.q.myRank = i + 1; });
      const nOwn = pk ? W.shots.filter((x) => x.pk === pk).length : 0;
      const cR = C && o.pid ? Object.keys(C.rounds || {}).filter((k) => Array.isArray(C.rounds[k]?.[o.pid]) && C.rounds[k][o.pid].some((v) => v > 0)) : [];
      const rIds = [...new Set([...cR.map(String), ...myT.map((t) => String(t.rd))])].sort((a, b) => Number(a) - Number(b));
      if (!rIds.length) { mount(holder, el("p", { class: "muted small" }, `No hole-by-hole scores for ${o.name} here yet: they come from the live feed's scorecards${W ? "" : " (or the tournament's shots in Strategy Maps)"}.`)); return; }
      let rd = o.me && rIds.includes(String(st.resRound)) ? String(st.resRound) : rIds[0], hole = null;
      if (o.me && st.resHole && rd === String(st.resRound) && myT.some((t) => String(t.rd) === rd && t.h === st.resHole)) { hole = st.resHole; st.resHole = null; } // (update 926: a shot picked in the pop-up)
      const tOf = (h) => myT.find((t) => String(t.rd) === rd && t.h === h);
      const parOf = (h) => (C?.par?.[h - 1] > 0 ? C.par[h - 1] : tOf(h)?.par ?? tOf(h)?.meta?.par?.[h - 1] ?? null);
      const scoreOf = (h) => { const v = C?.rounds?.[rd]?.[o.pid]?.[h - 1]; if (v > 0) return v; const t = tOf(h); return t?.s != null && parOf(h) != null ? parOf(h) + t.s : null; };
      const sgOf = (h) => { const t = tOf(h); return t ? t.qs.reduce((a, q) => a + (q.sg || 0), 0) : null; };
      const sgT = (v) => (matchMedia("(max-width: 520px)").matches ? `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(1)}` : fmtSG(v)); // (update 926: a phone's narrow cells, one decimal)
      const cardBox = el("div", { class: "tr-card" }), holeBox = el("div", { class: "tr-hole" }), tabs = el("div", { class: "tr-rounds", role: "group", "aria-label": "Round" });
      const draw = () => {
        const fromC = Array.isArray(C?.rounds?.[rd]?.[o.pid]), holes = fromC ? Array.from({ length: 18 }, (_, i) => i + 1) : [...new Set(myT.filter((t) => String(t.rd) === rd).map((t) => t.h))].sort((a, b) => a - b);
        const withSG = myT.some((t) => String(t.rd) === rd);
        mount(tabs, rIds.map((id) => { const on = id === rd, b = el("button", { type: "button", class: `tr-rd${on ? " on" : ""}`, "aria-pressed": String(on) }, `R${id}`); b.addEventListener("click", () => { if (!on) { rd = id; hole = null; if (o.me) st.resRound = id; draw(); } }); return b; }));
        const half = (hs, lab) => { if (!hs.length) return []; const sum = (f) => { const v = hs.map(f); return v.every((x) => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
          const cell = (h) => { const p = parOf(h), sc = scoreOf(h), d = p != null && sc != null ? sc - p : null, t = tOf(h);
            const b = el("td", { class: `tr-sc-c${hole === h ? " on" : ""}${t ? "" : " flat"}`, ...(t ? { role: "button", tabindex: "0", title: `Hole ${h}: its shots` } : { title: `Hole ${h}` }) }, el("span", { class: `tr-sc-s ${d == null ? "" : d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "dbl"}` }, sc == null ? "·" : String(sc)));
            if (t) { const go = () => { hole = hole === h ? null : h; draw(); }; b.addEventListener("click", go); b.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); }
            return b; };
          return [el("tr", { class: "tr-sc-hr" }, [el("th", {}, "Hole"), ...hs.map((h) => el("th", {}, String(h))), el("th", {}, lab)]),
            el("tr", {}, [el("th", {}, "Par"), ...hs.map((h) => el("td", { class: "muted" }, parOf(h) ?? "")), el("td", { class: "muted" }, sum(parOf) ?? "")]),
            el("tr", {}, [el("th", {}, "Score"), ...hs.map(cell), el("td", { class: "tr-tot" }, sum(scoreOf) ?? "")]),
            withSG ? el("tr", {}, [el("th", {}, "SG"), ...hs.map((h) => { const v = sgOf(h); return el("td", { class: `tr-sg ${cls(v)}` }, v == null ? "" : sgT(v)); }), el("td", { class: `tr-sg ${cls(sum(sgOf))}` }, sum(sgOf) == null ? "" : sgT(sum(sgOf)))]) : null].filter(Boolean); };
        mount(cardBox, [el("div", { class: "tr-sc-scroll" }, el("table", { class: "tr-sc-t" }, el("tbody", {}, [...half(holes.filter((h) => h <= 9), "Out"), ...half(holes.filter((h) => h > 9), "In")]))),
          el("p", { class: "muted small" }, withSG ? `Tap a hole for its shots and the hole · ${[...new Set(myT.filter((t) => String(t.rd) === rd).map((t) => t.meta.name))].join(" & ")}` : "From the official scorecard (no shots for this round in Strategy Maps, so no hole pictures or shot breakdown)")]);
        drawHole();
      };
      // a hole: its shots beside the hole's picture with the trail, into the cup
      const drawHole = () => {
        const h = hole, t = h ? tOf(h) : null; if (!t) { mount(holeBox, null); return; }
        const rows = t.qs.map((q, i) => el("tr", {}, [el("td", {}, String(i + 1)), el("td", {}, cap(q.lie)), el("td", {}, q.d != null ? `${Math.round(q.d)} ${q.lie === "green" ? "ft" : "yds"}` : "—"), el("td", { class: `num ${cls(q.sg)}` }, q.sg != null ? fmtSG(q.sg) : ""), el("td", { class: `num ${q.myRank && q.myRank <= 10 ? "pos" : "muted"}` }, q.myRank ? `${ord(q.myRank)} of ${nOwn}` : "")]));
        if (o.me && shotPop) rows.forEach((tr, i) => { const q = t.qs[i]; if (!q.myRank) return; tr.classList.add("tr-tap"); tr.setAttribute("role", "button"); tr.tabIndex = 0; const go = () => shotPop("mine", q); tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
        const pic = el("div", { class: "tr-pic" }, el("p", { class: "muted small" }, "Loading the hole…"));
        mount(holeBox, [el("h3", {}, [`Hole ${h}`, parOf(h) ? ` · par ${parOf(h)}` : "", scoreOf(h) != null ? ` · ${scoreOf(h)}` : "", sgOf(h) != null ? el("span", { class: `tr-hsg ${cls(sgOf(h))}` }, ` · SG ${fmtSG(sgOf(h))}`) : null]),
          el("div", { class: "tr-hole-grid" }, [pic, el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, ["#", "Lie", "Distance", "SG", "Their rank"].map((x, i) => el("th", { class: i >= 3 ? "num" : null }, x)))), el("tbody", {}, rows)])])]);
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
      mount(holder, [el("div", { class: "tr-sc-h" }, [el("p", { class: "fx-eyebrow" }, `${o.name} · scorecard`), tabs]), cardBox, holeBox]);
      draw();
    }).catch((e) => { console.warn("scorecard", e); mount(holder, el("p", { class: "muted small" }, "The scorecard couldn't be drawn.")); });
    return holder;
  }

  // (update 836) the leaderboard: the PGA Tour's official one (position, to par), each player's strokes gained per round
  // that week beside it where the stats file has them; without an official one (DP World Tour, or not saved yet), the
  // stats file's field ranked by strokes gained per round
  // (update 915) how it played out: the plain-words story and a race chart (the top five's strokes behind the lead, every hole)
  const drawStory = (S2, B) => storyInto(storyBox, S2, B, ev); // (update 933: shared with Historical's tournament view)
  (async () => {
    const sgOf = new Map(); // nameKey → { label, sg, n }
    // (update 844) the field's own names for the event can carry the year ("Baycurrent Classic 2026"), and its players their name as .name
    const evN = (e) => String(e || "").replace(/\s+\d{4}$/, "").trim().toLowerCase(), want = evN(ev.event);
    for (const p of field || []) { const rs = (p.rounds || []).filter((r) => evN(r.event) === want && yrOf(r) === ev.year && !r.eventLevel); if (!rs.length) continue;
      const nm = p.label || p.name || (me && p.key === me.key ? me.label : "") || ""; if (!nm) continue;
      const t = rs.reduce((a, r) => a + (r.shots || []).reduce((b, s) => b + (s.sg || 0), 0), 0); sgOf.set(nameKey(nm), { key: p.key, label: nm, sg: t / rs.length, n: rs.length }); }
    const sgRank = new Map([...sgOf.values()].sort((a, b) => b.sg - a.sg).map((o, i) => [o, i + 1]));
    const isMe = (nm, key) => !!me && ((key && key === me.key) || nameKey(nm) === nameKey(me.label));
    let B = null, why = "";
    try { const PI = await import("./playerInsights.js"), code = PI.tourCodeOf(evRs[0]?.tour);
      if (!code) why = "The DP World Tour has no official leaderboard in the live feed";
      else { await PI.ensureResults(code, [ev.year]); B = PI.officialBoard(ev.event, ev.year, code, evRs.at(-1)?.date); const nEv = PI.resultsInfo(code, ev.year);
        why = nEv == null ? `The live feed hasn't saved any official ${code === "H" ? "Korn Ferry Tour" : "PGA TOUR"} results for ${ev.year} yet (the live-feed function from update 824 or later has to be deployed and have run)`
          : `The live feed's ${ev.year} results (${nEv} event${nEv === 1 ? "" : "s"} so far) don't include this one yet`; } } catch (e) { console.warn("leaderboard", e); why = "The official results couldn't be read just now"; }
    const par = (t) => (t == null || !Number.isFinite(Number(t)) ? "—" : Number(t) === 0 ? "E" : Number(t) > 0 ? `+${Number(t)}` : String(Number(t)).replace("-", "\u2212"));
    const pos = (p) => { const u = String(p || "").toUpperCase(); return /^(CUT|MC)$/.test(u) ? "MC" : u || "—"; };
    const sgCell = (o) => (o ? el("td", { class: `num ${o.sg >= 0 ? "pos" : "neg"}` }, [fmtSG(o.sg), el("span", { class: "tr-lb-rk" }, ` (${sgRank.get(o)})`)]) : el("td", { class: "num muted" }, "—"));
    let rows, head, note;
    // (update 915) the scorecards: each round's score on the leaderboard, and how the tournament played out
    let S = null, C = null; if (B?.tid) { try { const [PI, TS] = await Promise.all([import("./playerInsights.js"), import("./tourneyStory.js")]); C = await PI.loadCards(B.tid); if (C) { S = TS.tourneyStory(C, B.rows); if (!S && C.note) console.warn("Scorecards couldn't be read; their layout:", C.note); } } catch (e) { console.warn("scorecards", e); } }
    if (S) drawStory(S, B);
    if (B) {
      const nR = S ? Math.max(...S.series.rounds, 0) : 0, rCols = Array.from({ length: nR }, (_, i) => i + 1);
      head = ["Pos", "Player", ...rCols.map((r) => `R${r}`), "To par"];
      rows = B.rows.map((r) => { const o = sgOf.get(nameKey(r.name)), rr = S && r.pid ? S.roundsOf(r.pid) : null; return { me: isMe(r.name, o?.key), id: `p${r.pid || nameKey(r.name)}`, name: r.name, pid: r.pid ? String(r.pid) : null, key: o?.key || null, tds: [el("td", {}, pos(r.pos)), el("td", {}, r.name), ...rCols.map((k) => el("td", { class: "num tr-rd" }, rr?.[k] != null ? String(rr[k]) : "—")), el("td", { class: "num strong" }, par(r.total))] }; });
      note = `Official PGA Tour leaderboard${B.final ? "" : " (not final)"}.${S ? " Each round's score from the official scorecards." : " Round-by-round scores appear once the live feed has saved this event's scorecards."}`;
    } else if (sgOf.size) {
      head = ["SG rank", "Player", "SG per round", "Rounds"];
      rows = [...sgOf.values()].sort((a, b) => b.sg - a.sg).map((o, i) => ({ me: isMe(o.label, o.key), id: `k${o.key || nameKey(o.label)}`, name: o.label, pid: null, key: o.key, tds: [el("td", {}, String(i + 1)), el("td", {}, o.label), el("td", { class: `num ${o.sg >= 0 ? "pos" : "neg"}` }, fmtSG(o.sg)), el("td", { class: "num" }, String(o.n))] }));
      note = `${why || "The official leaderboard isn't in for this event"}, so this is the stats file's field ranked by strokes gained per round.`; // (update 844: which it is)
    } else { mount(lbBox, [el("p", { class: "fx-eyebrow" }, "Leaderboard"), el("p", { class: "muted small" }, "No leaderboard for this event yet."), me ? cardFor({ name: String(me.label || "").replace(/\s*\([^)]*\)\s*$/, ""), key: me.key, pid: null, C: null, me: true }) : null]); return; }
    let all = false; const TOP = 10;
    // (update 925) tap a player for their scorecard (the selected player's opens to start); tap again to close
    if (st.resLbOpen?.ev !== ev.key) st.resLbOpen = { ev: ev.key, id: rows.find((r) => r.me)?.id || null };
    const cards = new Map(); // (each opened card kept, so its round and hole stay put while others open and close)
    const draw = () => {
      const meI = rows.findIndex((r) => r.me), shown = all ? rows : rows.filter((r, i) => i < TOP || i === meI);
      const tb = el("tbody", {}, shown.flatMap((r) => { const open = st.resLbOpen.id === r.id;
        const tr = el("tr", { class: `tr-lb-row${r.me ? " tr-lb-me" : ""}${open ? " open" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(open), title: open ? "Close the scorecard" : "Open the scorecard" }, r.tds.map((td, i) => { const c = td.cloneNode(true); if (i === 1) c.prepend(el("span", { class: "tr-lb-car" }, open ? "\u25BE " : "\u25B8 ")); return c; }));
        const go = () => { st.resLbOpen.id = open ? null : r.id; draw(); const w = lbBox.querySelector(".tr-lb-wrap"); if (w) w.scrollLeft = 0; }; tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        if (!open) return [tr];
        if (!cards.has(r.id)) cards.set(r.id, cardFor({ name: r.name, pid: r.pid, key: r.key, C, me: r.me }));
        return [tr, el("tr", { class: "tr-lb-x" }, el("td", { colspan: String(head.length) }, cards.get(r.id)))]; }));
      const more = rows.length > TOP ? (() => { const b = el("button", { type: "button", class: "link tr-lb-more" }, all ? "Show top 10" : `Show all ${rows.length}`); b.addEventListener("click", () => { all = !all; draw(); }); return b; })() : null;
      mount(lbBox, [el("p", { class: "fx-eyebrow" }, `Leaderboard · ${ev.event} ${ev.year}`), el("div", { class: "tr-lb-wrap" }, el("table", { class: "tr-lb-t" }, [el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { class: i >= 2 ? "num" : "" }, h)))), tb])), more, el("p", { class: "muted small" }, `${note} Tap a player for their scorecard.`)]);
    };
    draw();
  })();

  // (update 925) the tournament's week in Strategy Maps (its shots), loaded once: the hero cards and the leaderboard's scorecards share it
  const wkP = (async () => {
    // (update 760) the course(s) from the tournament itself: those whose shots carry its name that year (no picking by hand)
    let list = [], metas = [], W = null;
    try { const CH = await import("./courseHeat.js"); list = (await CH.listHeatCourses().catch(() => [])) || [];
      const hasYr = (e) => !e.years?.length || e.years.map(String).includes(ev.year), withRaw = list.filter((c) => c.rawChunks);
      metas = withRaw.filter((c) => (c.events || []).some((e) => evMatch(e.name, ev.event) && hasYr(e)));
      if (!metas.length) metas = withRaw.filter((c) => (c.events || []).some((e) => evMatch(e.name, ev.event)));
      if (!metas.length) { const course = evRs.find((r) => r.course)?.course; if (course) metas = withRaw.filter((c) => !(c.events || []).length && (norm(c.name) === norm(course) || norm(c.name).includes(norm(course)) || norm(course).includes(norm(c.name)))); }
      if (metas.length) W = await weekOf(metas, ev);
    } catch (e) { console.warn("results", e); }
    return { W, metas, cName: metas.map((m) => m.name).join(" & ") };
  })();
  let shotPop = null; // (the selected player's shots pop-up, once the hero cards have it)
  (async () => {
    const { W } = await wkP;
    // the player: by their key, else by their name
    const pk = !W || !me ? null : W.players.has(me.key) ? me.key : [...W.players.values()].find((p) => nameKey(p.name) === nameKey(me.label))?.pk || null;
    const P = pk ? W.players.get(pk) : null;

    // ---- the hero cards: against the week's field ----
    const field0 = W ? [...W.players.values()] : [];
    const perRd = (p, f) => f(p) / Math.max(1, p.rds.size);
    const rk = (f) => (P ? rankIn(field0.map((p) => [p.pk, perRd(p, f)]), pk) : null);
    const best = P ? W.shots.find((s) => s.pk === pk) : null;
    // (update 763) each of the player's shots ranked among their own (1 to however many they hit), and in the field
    const myShots = P ? W.shots.filter((x) => x.pk === pk) : [], myN = myShots.length; myShots.forEach((x, i) => { x.q.myRank = i + 1; }); void myN;
    const CATL = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" }, dTxt = (q) => (q.d != null ? `${Math.round(q.d)} ${q.lie === "green" ? "ft" : "yds"}` : "—");
    // a pop-up of shots, best first: the player's own, or every shot in the field (theirs marked); opens at the one tapped
    function openShots(mode, focus) {
      document.querySelector(".tr-popwrap")?.remove();
      const close = () => wrap.remove(), xb = el("button", { type: "button", class: "tr-pop-x", "aria-label": "Close" }, "×"); xb.addEventListener("click", close);
      const back = el("div", { class: "tr-pop-back" }); back.addEventListener("click", close);
      const holder = el("div", { class: "tr-pop-scroll tr-shots-scroll" }), head = el("p", { class: "muted small" });
      const tg = el("div", { class: "tr-rounds", role: "group", "aria-label": "Which shots" });
      // one of theirs: its hole, opened in their scorecard on the leaderboard (update 926)
      const openHole = (x) => { close(); st.resRound = String(x.T.rd); st.resHole = x.T.h; st.resLbOpen = null; S.draw(); setTimeout(() => document.querySelector(".tr-sc-in .tr-hole h3")?.scrollIntoView({ behavior: "smooth", block: "start" }), 900); };
      const draw = (m) => {
        mount(tg, [["mine", `${me?.label || "Their"} shots (${myN})`], ["field", `Every shot in the field (${W.nShots.toLocaleString()})`]].map(([v, l]) => { const b = el("button", { type: "button", class: `tr-rd${v === m ? " on" : ""}`, "aria-pressed": String(v === m) }, l); b.addEventListener("click", () => { if (v !== m) draw(v); }); return b; }));
        const list = m === "mine" ? myShots : W.shots, f = m === "field";
        mount(head, f ? `Every player's every shot that week, best first; ${me?.label || "their"} shots are highlighted.` : `Every shot ${me?.label || "they"} hit that week, best first; the last column is its rank among every shot in the field.`);
        let target = null;
        // (update 765) where each shot started and finished (lie and distance; the last one holed); one of theirs opens its hole
        const endOf = (x) => { const nx = x.T.qs[x.T.qs.indexOf(x.q) + 1]; return nx ? [cap(nx.lie), dTxt(nx)] : x.T.s != null ? ["Holed", "In"] : ["—", "—"]; };
        // (update 926) a phone: fewer, fuller columns (the shot: round, hole and part of the game; from → to; SG; its rank)
        const ph = matchMedia("(max-width: 600px)").matches, CATS3 = { OTT: "Tee shot", APP: "Approach", ARG: "Short game", PUTT: "Putt" }, lastN = (n) => String(n || "").trim().split(/\s+/).slice(-1)[0];
        if (ph) {
          const rows = list.map((x, i) => { const q = x.q, mine = x.pk === pk, [eL, eD] = endOf(x), tr = el("tr", { class: [f && mine ? "mine" : null, q === focus ? "target" : null, mine ? "tr-tap" : null].filter(Boolean).join(" ") || null },
            [el("td", { class: "num" }, String(i + 1)), f ? el("td", { class: "tr-sh-who" }, lastN(x.T.name)) : null,
              el("td", { class: "tr-sh-what" }, [el("b", {}, `R${x.T.rd} · No. ${x.T.h}`), el("small", {}, CATS3[q.cat] || CATL[q.cat] || "")]),
              el("td", { class: "tr-sh-what" }, [el("span", {}, `${cap(q.lie)} ${dTxt(q)}`), el("small", {}, eL === "Holed" ? "→ holed" : `→ ${eL}${eD !== "—" ? ` ${eD}` : ""}`)]),
              el("td", { class: `num strong ${cls(x.sg)}` }, fmtSG(x.sg)), f ? null : el("td", { class: "num muted" }, ord(q.rank))]); if (q === focus) target = tr; return tr; });
          mount(holder, el("table", { class: "tr-shots tr-shots-ph" }, [el("thead", {}, el("tr", {}, ["#", f ? "Player" : null, "Shot", "From → to", "SG", f ? null : "Field"].filter(Boolean).map((x0, i) => el("th", { class: i === 0 || /SG|Theirs|Field/.test(x0) ? "num" : null }, x0)))), el("tbody", {}, rows)]));
          mount(head, f ? `Every shot that week, best first; ${me?.label || "their"} shots highlighted (tap one for its hole).` : `Every shot ${me?.label || "they"} hit that week, best first; last column: its rank among all ${W.nShots.toLocaleString()} in the field.`);
          rows.forEach((tr, i) => { const x = list[i]; if (x.pk !== pk) return; tr.addEventListener("click", () => openHole(x)); });
          requestAnimationFrame(() => { if (target) holder.scrollTop = Math.max(0, target.offsetTop - holder.clientHeight / 2); });
          return;
        }
        const rows = list.map((x, i) => { const q = x.q, mine = x.pk === pk, [eL, eD] = endOf(x), tr = el("tr", { class: [f && mine ? "mine" : null, q === focus ? "target" : null, mine ? "tr-tap" : null].filter(Boolean).join(" ") || null, title: mine ? `Open hole ${x.T.h}, round ${x.T.rd}` : null }, [
          el("td", { class: "num" }, String(i + 1)), f ? el("td", {}, x.T.name) : null, el("td", {}, `R${x.T.rd}`), el("td", {}, String(x.T.h)), el("td", {}, CATL[q.cat] || ""), el("td", {}, cap(q.lie)), el("td", {}, dTxt(q)), el("td", {}, eL), el("td", {}, eD),
          el("td", { class: `num ${cls(x.sg)}` }, fmtSG(x.sg)), el("td", { class: "num muted" }, f ? (mine ? `${ord(q.myRank)} of ${myN} of theirs` : "") : `${ord(q.rank)} of ${W.nShots.toLocaleString()}`)]); if (q === focus) target = tr; return tr; });
        mount(holder, el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, ["Rank", f ? "Player" : null, "Round", "Hole", "Category", "Start lie", "Start distance", "End lie", "End distance", "SG", f ? "Their rank" : "In the field"].filter(Boolean).map((x0, i) => el("th", { class: i === 0 || /SG|rank|field/i.test(x0) ? "num" : null }, x0)))), el("tbody", {}, rows)]));
        rows.forEach((tr, i) => { const x = list[i]; if (x.pk !== pk) return; tr.addEventListener("click", () => openHole(x)); });
        requestAnimationFrame(() => { if (target) holder.scrollTop = Math.max(0, target.offsetTop - holder.clientHeight / 2); });
      };
      const box = el("section", { class: "tr-pop tr-pop-wide", role: "dialog", "aria-modal": "true" }, [xb, el("p", { class: "fx-eyebrow" }, `${ev.event} · ${ev.year}`), el("h3", {}, "Shot by shot, ranked"), tg, head, holder]);
      const wrap = el("div", { class: "tr-popwrap" }, [back, box]); document.body.appendChild(wrap); draw(mode); xb.focus();
    }
    const card = (label, v, r, big, c) => { const n = el("div", { class: `tr-hero${big ? " big" : ""}`, role: "button", tabindex: "0", title: "Tap for each distance" }, [el("span", { class: "tr-hero-l" }, label), el("strong", { class: cls(v) }, v == null ? "—" : fmtSG(v)), el("span", { class: "tr-hero-s" }, ["per round", r ? [" · ", el("b", { class: r.r <= 10 ? "pos" : "" }, `${ord(r.r)} of ${r.n}`), " in the field"] : ""])]);
      const go = () => openDist(c); n.addEventListener("click", go); n.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); return n; };
    const nR = P ? P.rds.size : evRs.length;
    const vTot = P ? perRd(P, (p) => p.tot) : avg(evRs, tot);
    const cards = [card("Total", vTot, rk((p) => p.tot), true, null), ...CATS.map(([c, l]) => card(l, P ? perRd(P, (p) => p.cat[c]) : avg(evRs, (r) => inCat(r, c)), rk((p) => p.cat[c]), false, c))];
    const bestLine = best ? (() => { const b = el("button", { type: "button", class: "tr-best", title: "See every shot in the field" }, [el("strong", {}, best.q.rank === 1 ? "The best shot of the tournament: " : `Best shot: `), `${fmtSG(best.sg)} on hole ${best.T.h}, round ${best.T.rd}, ${dTxt(best.q)} from the ${best.q.lie}`, el("span", { class: "muted" }, ` · ${ord(best.q.rank)} of ${W.nShots.toLocaleString()} shots in the field · tap for every shot`)]);
      b.addEventListener("click", () => openShots("field", best.q)); return b; })() : null;
    mount(heroBox, [el("div", { class: "tr-head" }, [el("h2", {}, ev.event), el("span", { class: "muted" }, `${ev.year} · ${nR} round${nR === 1 ? "" : "s"}${W ? ` · ${field0.length} player${field0.length === 1 ? "" : "s"} on record` : ""}`)]), el("div", { class: "tr-hero-row" }, cards), bestLine,
      P ? null : el("p", { class: "muted small" }, "These numbers are from the stats file: the ranks and the shots need the tournament's shots in Strategy Maps.")].filter(Boolean));

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
        el("div", { class: "tr-pop-scroll" }, el("table", { class: "tr-shots" }, [el("thead", {}, el("tr", {}, [c ? "Distance" : "Part · distance", "Shots", "SG a shot", "SG per round", "Rank in the field"].map((x, i) => el("th", { class: i ? "num" : null }, x)))),
          el("tbody", {}, rows.map((o) => el("tr", {}, [el("td", {}, c ? o.bd : `${CATN[o.cat]} · ${o.bd}`), el("td", { class: "num" }, String(o.n)), el("td", { class: `num ${cls(o.per)}` }, fmtSG(o.per)), el("td", { class: `num ${cls(o.rd)}` }, fmtSG(o.rd)), el("td", { class: `num ${o.r && o.r.r <= 10 ? "pos" : ""}` }, o.r ? `${ord(o.r.r)} of ${o.r.n}` : "—")])))]))];
      const box = el("section", { class: "tr-pop", role: "dialog", "aria-modal": "true" }, [xb, el("p", { class: "fx-eyebrow" }, `${ev.event} · ${ev.year}`), el("h3", {}, `${c ? CATN[c] : "Every part of the game"} by distance`), ...body].filter(Boolean));
      const wrap = el("div", { class: "tr-popwrap" }, [back, box]); document.body.appendChild(wrap); xb.focus();
    }

    shotPop = openShots;
  })().catch((e) => { console.warn("results", e); mount(heroBox, el("p", { class: "muted small" }, `This tournament couldn’t be drawn (${e?.message || e}).`)); }); // (update 760: never a blank page)
  return [picker, heroBox, storyBox, lbBox]; // (update 925: each player's scorecard opens inside the leaderboard)
}

// (update 933) how a tournament played out, and its race chart: shared by a player's tournament and Historical's
function storyInto(storyBox, S, B, ev) {
  const ICON = { lead: "\u{1F3C6}", comeback: "\u{1F4C8}", turn: "\u21AA", slip: "\u26A0", margin: "\u{1F3C1}", changes: "\u21C4", big: "\u2B06", charge: "\u{1F680}", low: "\u2B50" };
  const rl = el("div", { class: "tr-rl" }, S.roundLeaders.map((x) => el("div", { class: "tr-rl-c" }, [el("span", { class: "muted small" }, `After round ${x.r}`), el("b", {}, x.leaders.length > 2 ? `${x.leaders.length} tied` : x.leaders.map((n) => String(n).split(/\s+/).slice(-1)[0]).join(", ")),
    el("small", { class: "muted" }, `${x.score === 0 ? "E" : x.score > 0 ? `+${x.score}` : `\u2212${-x.score}`}${x.margin ? ` · by ${x.margin}` : x.leaders.length > 1 ? " · tied" : ""}${x.winnerBack ? ` · ${String(S.winnerName).split(/\s+/).slice(-1)[0]} ${x.winnerBack} back` : ""}`)])));
  storyBox.hidden = false;
  mount(storyBox, [el("p", { class: "fx-eyebrow" }, `How it played out · ${B.name || ev.event} ${ev.year}`), el("ul", { class: "tr-facts" }, S.facts.map((f) => el("li", { class: `tr-f tr-f-${f.k}` }, [el("span", { class: "tr-fi", "aria-hidden": "true" }, ICON[f.k] || "\u2022"), el("span", {}, f.t)]))),
    rl, raceChart(S), el("p", { class: "muted small" }, "From every player's hole-by-hole scorecard. Holes are compared in number order (with two tees in the early rounds, \"after No. 9\" is the same hole for everyone, not the same moment).")]);
}
function raceChart(S) {
  const { n, lines, rounds } = S.series, W = window.innerWidth < 640 ? 420 : 720, H = window.innerWidth < 640 ? 260 : 240, L = 34, Rm = 110, T = 12, Bm = 22, NS = "http://www.w3.org/2000/svg";
  const sv = (t, a = {}, kids = []) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); for (const c of [].concat(kids)) if (c != null) e.append(c); return e; };
  const mx = Math.max(4, ...lines.flatMap((l) => l.pts.filter((v) => v != null))), cap = Math.min(mx, 12);
  const X = (c) => L + (c / Math.max(1, n - 1)) * (W - L - Rm), Y = (v) => T + (Math.min(v, cap) / cap) * (H - T - Bm);
  const COL = ["#ffcc00", "#64d2ff", "#30d158", "#bf5af2", "#ff9f0a"], g = [];
  for (let v = 0; v <= cap; v += cap > 8 ? 4 : 2) g.push(sv("line", { x1: L, x2: W - Rm, y1: Y(v), y2: Y(v), class: "tr-grid" }), sv("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", class: "tr-ax" }, v === 0 ? "Lead" : `+${v}`));
  rounds.forEach((r, i) => { const x0 = X(i * 18); if (i) g.push(sv("line", { x1: x0, x2: x0, y1: T, y2: H - Bm, class: "tr-grid" })); g.push(sv("text", { x: X(i * 18 + 9), y: H - 6, "text-anchor": "middle", class: "tr-ax" }, `Round ${r}`)); });
  const labs = [];
  lines.forEach((l, i) => { let d = "", pen = false; l.pts.forEach((v, c) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(c).toFixed(1)} ${Y(v).toFixed(1)} `; pen = true; });
    const lastI = l.pts.findLastIndex((v) => v != null), col = COL[i % COL.length];
    g.push(sv("path", { d, fill: "none", stroke: col, "stroke-width": l.win ? 2.8 : 1.6, opacity: l.win ? 1 : 0.85 }));
    if (lastI >= 0) labs.push({ x: X(lastI) + 6, y: Y(l.pts[lastI]) + 4, col, t: String(l.name).split(/\s+/).slice(-1)[0] }); });
  // the names at the line ends, nudged apart so they never overlap
  labs.sort((a, b) => a.y - b.y); for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 13) labs[i].y = labs[i - 1].y + 13;
  for (const lb of labs) g.push(sv("text", { x: lb.x, y: lb.y, class: "tr-lbl", fill: lb.col }, lb.t));
  return el("div", { class: "tr-race" }, [el("p", { class: "muted small" }, "Strokes behind the lead after every hole (top of the chart = leading), the top five finishers"), sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "tr-race-svg", role: "img", "aria-label": "Strokes behind the lead" }, g)]);
}

/** (update 933) Leaderboards › Historical: a tournament opened from the list: how it played out (from the scorecards) and the
 *  official leaderboard, each player's scorecard a tap away. */
export function tournamentDetail({ event, year, tour, date = null }) {
  const box = el("div", { class: "tr-detail" }, el("p", { class: "muted small" }, "Loading the tournament…"));
  (async () => {
    const [PI, TS] = await Promise.all([import("./playerInsights.js"), import("./tourneyStory.js")]), code = PI.tourCodeOf(tour);
    if (!code) { mount(box, el("p", { class: "muted small" }, "This tour has no official leaderboards in the live feed (the PGA TOUR and Korn Ferry Tour do).")); return; }
    await PI.ensureResults(code, [String(year)]).catch(() => null);
    const B = PI.officialBoard(event, String(year), code, date);
    if (!B) { mount(box, el("p", { class: "muted small" }, `The live feed hasn't saved an official leaderboard for ${event} ${year} yet.`)); return; }
    const C = B.tid ? await PI.loadCards(B.tid).catch(() => null) : null, S = C ? TS.tourneyStory(C, B.rows) : null;
    const storyBox = el("section", { class: "panel tr-story", hidden: true }); if (S) storyInto(storyBox, S, B, { event, year: String(year) });
    const nR = S ? Math.max(...S.series.rounds, 0) : 0, rCols = Array.from({ length: nR }, (_, i) => i + 1);
    const tp = (t) => (t == null || !Number.isFinite(Number(t)) ? "—" : Number(t) === 0 ? "E" : Number(t) > 0 ? `+${Number(t)}` : `−${-Number(t)}`);
    const pos = (p) => { const u = String(p || "").toUpperCase(); return /^(CUT|MC)$/.test(u) ? "MC" : u || "—"; };
    const head = ["Pos", "Player", ...rCols.map((r) => `R${r}`), "To par"];
    let all = false, open = null; const TOP = 25;
    const lb = el("section", { class: "panel tr-lb" });
    const draw = () => { const rows = all ? B.rows : B.rows.slice(0, TOP);
      const tb = el("tbody", {}, rows.flatMap((r) => { const id = String(r.pid || r.name), isOpen = open === id, rr = S && r.pid ? S.roundsOf(r.pid) : null;
        const tr = el("tr", { class: `tr-lb-row${isOpen ? " open" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(isOpen) }, [el("td", {}, pos(r.pos)), el("td", {}, [el("span", { class: "tr-lb-car" }, isOpen ? "▾ " : "▸ "), r.name]),
          ...rCols.map((k) => el("td", { class: "num tr-rd" }, rr?.[k] != null ? String(rr[k]) : "—")), el("td", { class: "num strong" }, tp(r.total))]);
        const go = () => { open = isOpen ? null : id; draw(); }; tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        return isOpen ? [tr, el("tr", { class: "tr-lb-x" }, el("td", { colspan: String(head.length) }, officialCard(C, r)))] : [tr]; }));
      const more = B.rows.length > TOP ? (() => { const b = el("button", { type: "button", class: "link tr-lb-more" }, all ? `Show the top ${TOP}` : `Show all ${B.rows.length}`); b.addEventListener("click", () => { all = !all; draw(); }); return b; })() : null;
      mount(lb, [el("p", { class: "fx-eyebrow" }, `Leaderboard · ${B.name || event} ${year}`), el("div", { class: "tr-lb-wrap" }, el("table", { class: "tr-lb-t" }, [el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { class: i >= 2 ? "num" : "" }, h)))), tb])), more,
        el("p", { class: "muted small" }, `Official PGA Tour leaderboard${B.final ? "" : " (not final)"}.${C ? " Tap a player for his scorecard." : " Round scores and scorecards appear once the live feed has saved this event's scorecards."}`)]); };
    draw();
    mount(box, [S ? storyBox : null, lb]);
  })().catch((e) => { console.warn("tournament", e); mount(box, el("p", { class: "muted small" }, "This tournament couldn’t be drawn just now.")); });
  return box;
}
// a player's official scorecard, round by round (no strokes gained: that needs the tournament's shots)
function officialCard(C, r) {
  const pid = r.pid ? String(r.pid) : null, rIds = C && pid ? Object.keys(C.rounds || {}).filter((k) => Array.isArray(C.rounds[k]?.[pid]) && C.rounds[k][pid].some((v) => v > 0)).sort((a, b) => a - b) : [];
  if (!rIds.length) return el("p", { class: "muted small" }, `No hole-by-hole scores for ${r.name} saved yet.`);
  const wrap = el("div", { class: "tr-sc tr-sc-in" }); let rd = rIds[0];
  const par = (h) => (C.par?.[h - 1] > 0 ? C.par[h - 1] : null), sc = (h) => { const v = C.rounds[rd]?.[pid]?.[h - 1]; return v > 0 ? v : null; };
  const draw = () => {
    const tabs = el("div", { class: "tr-rounds" }, rIds.map((id) => { const b = el("button", { type: "button", class: `tr-rd${id === rd ? " on" : ""}` }, `R${id}`); b.addEventListener("click", (e) => { e.stopPropagation(); rd = id; draw(); }); return b; }));
    const half = (hs, lab) => { const sum = (f) => { const v = hs.map(f); return v.every((x) => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
      return [el("tr", { class: "tr-sc-hr" }, [el("th", {}, "Hole"), ...hs.map((h) => el("th", {}, String(h))), el("th", {}, lab)]),
        el("tr", {}, [el("th", {}, "Par"), ...hs.map((h) => el("td", { class: "muted" }, par(h) ?? "")), el("td", { class: "muted" }, sum(par) ?? "")]),
        el("tr", {}, [el("th", {}, "Score"), ...hs.map((h) => { const p0 = par(h), v = sc(h), d = p0 != null && v != null ? v - p0 : null; return el("td", { class: "tr-sc-c flat" }, el("span", { class: `tr-sc-s ${d == null ? "" : d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "dbl"}` }, v == null ? "·" : String(v))); }), el("td", { class: "tr-tot" }, sum(sc) ?? "")])]; };
    mount(wrap, [el("div", { class: "tr-sc-h" }, [el("p", { class: "fx-eyebrow" }, `${r.name} · scorecard`), tabs]),
      el("div", { class: "tr-sc-scroll" }, el("table", { class: "tr-sc-t" }, el("tbody", {}, [...half([1, 2, 3, 4, 5, 6, 7, 8, 9], "Out"), ...half([10, 11, 12, 13, 14, 15, 16, 17, 18], "In")])))]); };
  draw(); return wrap;
}
