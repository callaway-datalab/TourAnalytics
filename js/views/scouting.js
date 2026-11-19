// (update 889) Scouting: whole careers, to judge a player's trajectory (is he getting better, and is it lasting?).
// Two ranks, side by side: the strokes-gained rank (every player on the tour picked, strokes gained per round, from the
// stats file: each season's year-end rank among players with the season's minimum rounds, and a rolling rank over each
// player's last 24 rounds against everyone else's last 24 as of that date, among players with 24+ rounds who have played
// in the year before) and the OWGR, when the stats file carries it (each season's last value, and the latest).
// A board of every player (sortable: year-end ranks each season and the change from the season before, seasons improving
// in a row, the rolling rank now and a year ago), and one player's career: a chart of the rolling rank (and the OWGR) over
// time with each season's year-end rank, the seasons in a table (strokes gained and rank in each part of the game).
import { el, mount } from "../ui.js";
import * as PI from "../playerInsights.js";
import { card, samp, sg2, ord } from "./insightPages.js";
import { lastName } from "../current.js";
import * as DEF from "../defs.js";
import { scoutModel } from "../scoutModel.js"; // (update 890) comps, grades, tier odds, risers

const ROLL = 24, DAY = 864e5, YEAR = 365 * DAY;
const tot = (r) => (r.shots || []).reduce((t, s) => t + (s.sg || 0), 0);
const inCat = (r, c) => (r.shots || []).filter((s) => s.cat === c).reduce((t, s) => t + (s.sg || 0), 0);
const avg = (xs, f) => (xs.length ? xs.reduce((t, x) => t + f(x), 0) / xs.length : null);
const dOf = (r) => Date.parse(`${String(r.date || "").slice(0, 10)}T12:00:00`) || 0;
const owgrOf = (r) => { const o = (r.obs || []).find((x) => x.k === "owgr"); return o && Number.isFinite(o.v) && o.v > 0 ? o.v : null; };
const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const NS = "http://www.w3.org/2000/svg", sv = (t, a = {}, kids = []) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) n.setAttribute(k, v); for (const c of [].concat(kids)) if (c != null) n.append(c); return n; };

export async function scoutTab(box, key0, name0) {
  mount(box, el("div", { class: "ip ip-embed sc" }, el("p", { class: "muted ip-wait" }, "Building every player's career…")));
  const wrap = box.firstChild, st = window.__authState || {};
  const { field } = await PI.loadField(st).catch(() => ({ field: [] }));
  if (!field.length) { mount(wrap, el("p", { class: "muted" }, "No stats file to scout from yet.")); return; }
  const tours = [...new Set(field.flatMap((p) => p.rounds.map((r) => r.tour)).filter(Boolean))].sort((a, b) => field.reduce((t, p) => t + p.rounds.filter((r) => r.tour === b).length, 0) - field.reduce((t, p) => t + p.rounds.filter((r) => r.tour === a).length, 0));
  const fp0 = field.find((p) => p.key === key0);
  let tour = (fp0 && [...new Set(fp0.rounds.map((r) => r.tour))].sort((a, b) => fp0.rounds.filter((r) => r.tour === b).length - fp0.rounds.filter((r) => r.tour === a).length)[0]) || tours[0] || null;
  let sel = key0, sortK = "roll", sortDir = 1, q = "", minSeasons = 1, part = "board";
  const memo = new Map(), mMemo = new Map(), modelOf = (T) => mMemo.get(T) || mMemo.set(T, scoutModel(build(T))).get(T);

  // everything for one tour: each player's rounds (dated, with running sums), each season's ranks, the rolling ranks
  function build(T) {
    if (memo.has(T)) return memo.get(T);
    const onT = (r) => !T || r.tour === T;
    const P = field.map((p) => { const hasSg = (r) => (r.shots || []).some((x) => x.sg != null && (x.w ?? 1) > 0); /* (update 894: a round with no strokes gained in the file isn't a 0.00 round) */
      let rs = p.rounds.filter((r) => onT(r) && !r.eventLevel && hasSg(r)); if (!rs.length) rs = p.rounds.filter((r) => onT(r) && hasSg(r)); /* (a tour kept event by event: those) */
      rs = rs.slice().sort((a, b) => dOf(a) - dOf(b)); const ds = rs.map(dOf), cum = [0]; for (const r of rs) cum.push(cum.at(-1) + tot(r));
      return { k: p.key, nm: p.name, birth: p.birth, rs, ds, cum }; }).filter((p) => p.rs.length);
    const years = [...new Set(P.flatMap((p) => p.rs.map(PI.yrOf)))].sort();
    // year-end ranks: each season, total and each part of the game, among players with the season's minimum rounds
    const season = {}; for (const y of years) { const F = P.map((p) => ({ p, rs: p.rs.filter((r) => PI.yrOf(r) === y) })).filter((x) => x.rs.length >= DEF.MIN.seasonRounds);
      const out = new Map(); for (const x of F) out.set(x.p.k, { n: x.rs.length, sg: avg(x.rs, tot), cat: Object.fromEntries(PI.CATS.map((c) => [c, avg(x.rs, (r) => inCat(r, c))])), ow: [...x.rs].reverse().map(owgrOf).find((v) => v != null) ?? null });
      const rankBy = (f, set) => { const l = [...out].sort((a, b) => f(b[1]) - f(a[1])); l.forEach(([k], i) => set(out.get(k), i + 1)); };
      rankBy((o) => o.sg, (o, r) => { o.rank = r; }); for (const c of PI.CATS) rankBy((o) => o.cat[c], (o, r) => { (o.cr ||= {})[c] = r; });
      season[y] = { of: out.size, by: out }; }
    const lastY = years.at(-1), lastDate = Math.max(...P.map((p) => p.ds.at(-1)));
    // rolling: a player's last 24 rounds as of a date (null when fewer, or none in the year before)
    const ub = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; } return lo; };
    const rollAt = (p, t) => { const i = ub(p.ds, t); if (i < ROLL || t - p.ds[i - 1] > YEAR) return null; return (p.cum[i] - p.cum[i - ROLL]) / ROLL; };
    const rankAt = (p, t) => { const me = rollAt(p, t); if (me == null) return null; let r = 1, n = 0; for (const o of P) { const v = rollAt(o, t); if (v == null) continue; n++; if (o !== p && v > me) r++; } return { r, n, v: me }; };
    const rows = P.map((p) => { const ranks = years.map((y) => season[y].by.get(p.k) || null), now = rankAt(p, lastDate), ago = rankAt(p, lastDate - YEAR);
      // seasons improving (or slipping) in a row, up to the latest season they're ranked in
      const rk = ranks.map((o) => o?.rank ?? null), have = rk.map((v, i) => [v, i]).filter(([v]) => v != null); let streak = 0;
      for (let i = have.length - 1; i > 0; i--) { const d = have[i - 1][0] - have[i][0]; if (d === 0) break; const dir = Math.sign(d); if (streak === 0 || Math.sign(streak) === dir) streak += dir; else break; }
      const ows = p.rs.map(owgrOf).filter((v) => v != null);
      return { p, k: p.k, nm: p.nm, age: p.birth ? Math.floor((Date.now() - Date.parse(p.birth)) / (365.25 * DAY)) : null, ranks, rk, streak, nSeasons: have.length, now, ago,
        trend: now && ago ? ago.r - now.r : null, ow: ows.length ? ows.at(-1) : null, last: rk.findLast((v) => v != null) ?? null }; });
    const out = { P, years, season, lastY, lastDate, rows, rankAt, hasOw: rows.some((r) => r.ow != null) }; memo.set(T, out); return out;
  }

  function draw() {
    const B = build(tour), { years, lastY } = B, M = modelOf(tour), T1 = M.tiers[0], T2 = M.tiers[1];
    const pc = (v) => (v == null ? "—" : v < 0.005 ? "<1%" : v > 0.995 ? ">99%" : `${Math.round(v * 100)}%`);
    const gCls = (g) => (g >= 90 ? "g-hi" : g >= 70 ? "g-good" : g >= 35 ? "g-avg" : g >= 15 ? "g-low" : "g-poor"); // (update 899: 0-100)
    const gEl = (g, t = null) => el("b", { class: `sc-g ${gCls(g)}`, title: t }, String(g));
    const pills = tours.length > 1 ? el("div", { class: "ip-pills" }, tours.map((t) => { const b = el("button", { type: "button", class: `ip-pill${t === tour ? " on" : ""}`, "aria-pressed": String(t === tour) }, t); b.addEventListener("click", () => { tour = t; draw(); }); return b; })) : null;
    const search = el("input", { type: "search", class: "ip-sel sc-q", placeholder: "Find a player", value: q, "aria-label": "Find a player" });
    search.addEventListener("input", () => { q = search.value; drawBoard(); });
    const minSel = el("select", { class: "ip-sel", "aria-label": "Seasons ranked" }, [1, 2, 3].map((n) => el("option", { value: String(n), ...(n === minSeasons ? { selected: true } : {}) }, n === 1 ? "Any players" : `${n}+ seasons ranked`)));
    minSel.addEventListener("change", () => { minSeasons = Number(minSel.value); drawBoard(); });
    const detail = el("div", { class: "sc-detail" }), boardBox = el("div", {});
    mount(wrap, [el("header", { class: "ip-head ip-head-slim" }, el("div", {}, [el("p", { class: "ip-kick", style: "--ipc:#bf5af2" }, `Scouting · ${tour || ""}`.trim()), el("h2", { class: "ip-h" }, "Scouting"),
      el("p", { class: "muted" }, `Who's rising, how good they could get, and who they look like. Ratings 0-100 (better than that % of the tour), odds of a top-${M.tiers[0] || 10} season, comps from every past season in the file, fast risers, and each career's trajectory (year-end strokes-gained rank, the rolling rank over the last ${ROLL} rounds${B.hasOw ? ", the OWGR" : ""}). Tap a player for their report.`)])),
      el("div", { class: "sc-ctl" }, [pills, search, minSel]), partPills(), detail, boardBox]);
    function partPills() { return el("div", { class: "ip-pills sc-parts" }, [["board", "Every player"], ["risers", "Fast risers"], ["how", "How it works"]].map(([v, l]) => { const b = el("button", { type: "button", class: `ip-pill${v === part ? " on" : ""}`, "aria-pressed": String(v === part) }, l); b.addEventListener("click", () => { part = v; draw(); }); return b; })); }

    function drawBoard() {
      const qq = q.trim().toLowerCase(), list = B.rows.filter((r) => r.nSeasons >= minSeasons && (!qq || r.nm.toLowerCase().includes(qq)));
      const S = (r) => M.scout(r.k);
      const val = (r) => (sortK === "now" ? -(S(r)?.grades.now ?? 0) : sortK === "ceil" ? -(S(r)?.grades.ceil ?? 0) : sortK === "t1" ? -(S(r)?.odds[T1]?.p ?? -1) : sortK === "t2" ? -(S(r)?.odds[T2]?.p ?? -1) : sortK === "roll" ? r.now?.r ?? 1e9 : sortK === "trend" ? -(r.trend ?? -1e9) : sortK === "streak" ? -(r.streak) : sortK === "age" ? r.age ?? 1e9 : sortK === "ow" ? r.ow ?? 1e9 : sortK === "nm" ? r.nm : sortK.startsWith("y") ? r.rk[Number(sortK.slice(1))] ?? 1e9 : 0);
      list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir; });
      const th = (k, label, cls0 = "num", title = null) => { const b = el("th", { class: `${cls0} sc-sort${sortK === k ? " on" : ""}`, title, tabindex: "0" }, [label, sortK === k ? (sortDir > 0 ? " ▲" : " ▼") : ""]);
        const go = () => { if (sortK === k) sortDir = -sortDir; else { sortK = k; sortDir = 1; } drawBoard(); }; b.addEventListener("click", go); b.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); return b; };
      const chg = (a, b) => (a == null || b == null ? null : a - b); // (positive: up the ranks)
      const yrCell = (r, i) => { const o = r.ranks[i]; if (!o) return el("td", { class: "num muted" }, "—"); const prev = r.rk.slice(0, i).findLast((v) => v != null), d = chg(prev, o.rank);
        return el("td", { class: "num sc-yr", title: `${years[i]}: ${ord(o.rank)} of ${B.season[years[i]].of} (${sg2(o.sg)} per round, ${o.n} rounds)${d != null ? `; ${d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : "no change"} from the season before` : ""}` },
          [`${o.rank}`, d ? el("small", { class: d > 0 ? "pos" : "neg" }, ` ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`) : null]); };
      const rows = list.slice(0, 300).map((r) => { const tr = el("tr", { class: `sc-row${r.k === sel ? " on" : ""}`, tabindex: "0" }, [
          el("td", { class: "sc-nm" }, r.nm), el("td", { class: "num" }, r.age ?? "—"), ...years.map((_, i) => yrCell(r, i)),
          el("td", { class: "num strong" }, r.now ? `${r.now.r}` : "—"), el("td", { class: `num ${r.trend > 0 ? "pos" : r.trend < 0 ? "neg" : ""}` }, r.trend == null ? "—" : r.trend === 0 ? "0" : `${r.trend > 0 ? "▲" : "▼"}${Math.abs(r.trend)}`),
          el("td", { class: `num ${r.streak > 0 ? "pos" : r.streak < 0 ? "neg" : ""}` }, r.streak > 0 ? `${r.streak} up` : r.streak < 0 ? `${-r.streak} down` : "—"),
          B.hasOw ? el("td", { class: "num" }, r.ow != null ? String(Math.round(r.ow)) : "—") : null,
          ...(() => { const sc = S(r); if (!sc) return [el("td", { class: "num muted" }, "—"), el("td", { class: "num muted" }, "—"), T1 ? el("td", { class: "num muted" }, "—") : null, T2 ? el("td", { class: "num muted" }, "—") : null];
            return [el("td", { class: "num" }, gEl(sc.grades.now)), el("td", { class: "num" }, gEl(sc.grades.ceil)), T1 ? el("td", { class: "num" }, pc(sc.odds[T1]?.p)) : null, T2 ? el("td", { class: "num" }, pc(sc.odds[T2]?.p)) : null]; })()]);
        const pick = () => { sel = r.k; drawBoard(); drawDetail(); detail.scrollIntoView({ behavior: "smooth", block: "start" }); };
        tr.addEventListener("click", pick); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); }); return tr; });
      mount(boardBox, card(`Every player · ${tour || ""}`.trim(), "#bf5af2", [
        el("div", { class: "ip-tw sc-tw" }, el("table", { class: "ip-t sc-t" }, [el("thead", {}, el("tr", {}, [th("nm", "Player", ""), th("age", "Age"), ...years.map((y, i) => th(`y${i}`, y === lastY ? `${y}*` : y, "num", `Year-end strokes-gained rank, ${y}${y === lastY ? " (so far)" : ""}`)),
          th("roll", `Last ${ROLL}`, "num", `Rolling rank: strokes gained per round over their last ${ROLL} rounds, against everyone else's last ${ROLL}`), th("trend", "1-yr change", "num", `Rolling rank now against a year ago (▲ moved up the ranks)`), th("streak", "Streak", "num", "Seasons in a row their year-end rank improved (up) or slipped (down)"), B.hasOw ? th("ow", "OWGR") : null,
          th("now", "Now", "num", "Rating now, 0-100: better than that % of the tour's ranked players"), th("ceil", "Ceiling", "num", "Ceiling rating: a good next season (the projection's 80th percentile)"), T1 ? th("t1", `Top ${T1} odds`, "num", `Chance of a top-${T1} season next year`) : null, T2 ? th("t2", `Top ${T2} odds`, "num", `Chance of a top-${T2} season next year`) : null])),
          el("tbody", {}, rows)])),
        list.length > 300 ? el("p", { class: "muted small" }, `Showing 300 of ${list.length}: find a player or sort to see others.`) : null,
        samp(`Year-end rank: strokes gained per round over the season, among the ${tour || "tour"}'s players with ${DEF.MIN.seasonRounds}+ rounds that season (* this season so far); ▲▼ the change from their previous ranked season. Last ${ROLL}: the same over each player's last ${ROLL} rounds as of the latest round in the file, among players with ${ROLL}+ rounds and a round in the past year; 1-yr change: against the same rank a year earlier. Streak: seasons in a row the year-end rank moved the same way.${B.hasOw ? " OWGR: the latest in the stats file." : ""}`)]));
    }

    function drawDetail() {
      const r = B.rows.find((x) => x.k === sel);
      if (!r) { mount(detail, card("A player's career", "#bf5af2", el("p", { class: "muted" }, sel ? `No ${tour || ""} rounds on record for ${name0 || "this player"}. Tap a player below.` : "Tap a player below to see their career."))); return; }
      const p = r.p, last = lastName(r.nm);
      // the chart's points: the rolling rank at the end of each of their events (and the OWGR there)
      const ends = []; { const byEv = new Map(); for (const x of p.rs) byEv.set(`${x.event}|${PI.yrOf(x)}`, Math.max(byEv.get(`${x.event}|${PI.yrOf(x)}`) || 0, dOf(x))); for (const t of [...byEv.values()].sort((a, b) => a - b)) ends.push(t); }
      const pts = ends.map((t) => ({ t, rr: B.rankAt(p, t), ow: (() => { const i = p.ds.findLastIndex((d) => d <= t); for (let j = i; j >= 0; j--) { const v = owgrOf(p.rs[j]); if (v != null) return v; } return null; })() })).filter((x) => x.rr || x.ow != null);
      const yrPts = years.map((y, i) => r.ranks[i] ? { y, o: r.ranks[i], t: Math.max(...p.rs.filter((x) => PI.yrOf(x) === y).map(dOf)) } : null).filter(Boolean);
      const chart = careerChart(pts, yrPts, B.hasOw, wrap.clientWidth || 640);
      // the story
      const seq = yrPts.map((x) => `${ord(x.o.rank)}${x.y === lastY ? ` (${x.y} so far)` : ` (${x.y})`}`).join(" → ");
      const best = pts.filter((x) => x.rr).sort((a, b) => a.rr.r - b.rr.r)[0];
      const bullets = [
        yrPts.length ? `Year-end rank: ${seq}` : `Not ranked in a season yet (needs ${DEF.MIN.seasonRounds}+ rounds in one)`,
        r.streak >= 2 ? `Improved ${r.streak} seasons in a row` : r.streak <= -2 ? `Slipped ${-r.streak} seasons in a row` : r.streak === 1 ? "Improved on the season before" : r.streak === -1 ? "Slipped from the season before" : null,
        r.now ? `Last ${ROLL} rounds: ${ord(r.now.r)} of ${r.now.n} (${sg2(r.now.v)} per round)${r.ago ? `; a year ago ${ord(r.ago.r)} (${r.trend > 0 ? `up ${r.trend}` : r.trend < 0 ? `down ${-r.trend}` : "the same"})` : ""}` : `Fewer than ${ROLL} rounds in the past year: no rolling rank now`,
        best ? `Best rolling rank: ${ord(best.rr.r)} (${fmtD(best.t)})` : null,
        r.ow != null ? `OWGR: ${Math.round(r.ow)} (latest in the file)${(() => { const ys = yrPts.filter((x) => x.o.ow != null); return ys.length >= 2 ? `; year-end ${ys.map((x) => `${Math.round(x.o.ow)} (${x.y})`).join(" → ")}` : ""; })()}` : null,
        r.age != null ? `Age ${r.age}` : null].filter(Boolean);
      // the seasons, with each part of the game (where the change came from)
      const segs = yrPts.map((x, i) => { const prev = yrPts[i - 1]?.o; return el("tr", {}, [el("td", {}, x.y === lastY ? `${x.y}*` : x.y), el("td", { class: "num" }, x.o.n), el("td", { class: "num strong" }, sg2(x.o.sg)),
        el("td", { class: "num strong" }, [`${ord(x.o.rank)}`, prev ? el("small", { class: prev.rank > x.o.rank ? "pos" : prev.rank < x.o.rank ? "neg" : "" }, ` ${prev.rank > x.o.rank ? "▲" : prev.rank < x.o.rank ? "▼" : ""}${prev.rank !== x.o.rank ? Math.abs(prev.rank - x.o.rank) : ""}`) : null]),
        ...PI.CATS.map((c) => el("td", { class: "num", title: `${PI.CATN[c]}: ${sg2(x.o.cat[c])} per round, ${ord(x.o.cr[c])}` }, [sg2(x.o.cat[c]), el("small", { class: "muted" }, ` ${ord(x.o.cr[c])}`)])),
        B.hasOw ? el("td", { class: "num" }, x.o.ow != null ? String(Math.round(x.o.ow)) : "—") : null]); });
      mount(detail, [reportCard(r), card(`${r.nm} · career`, "#bf5af2", [el("ul", { class: "ip-bul" }, bullets.map((b) => el("li", {}, b))), chart,
        segs.length ? el("div", { class: "ip-tw" }, el("table", { class: "ip-t sc-seasons" }, [el("thead", {}, el("tr", {}, ["Season", "Rounds", "SG per round", "Rank", ...PI.CATS.map((c) => PI.CATN[c]), B.hasOw ? "OWGR" : null].filter(Boolean).map((h, i) => el("th", { class: i ? "num" : null }, h)))), el("tbody", {}, segs)])) : null,
        samp(`Strokes gained per round on the ${tour || "tour"}, with the rank among that season's players with ${DEF.MIN.seasonRounds}+ rounds in each part of the game: which parts moved ${last}'s rank. The chart: the rolling rank over the last ${ROLL} rounds at the end of each event (higher on the chart is better)${B.hasOw ? ", the OWGR beside it" : ""}, and each season's year-end rank.`)])]);
    }
    // (update 890) the scouting report: grades, the projection and tier odds, comps, and the paths successful players took
    function reportCard(r) {
      const sc = M.scout(r.k); if (!sc) return card(`${r.nm} · scouting report`, "#ffcc00", el("p", { class: "muted" }, `Not ranked in a season yet (needs ${DEF.MIN.seasonRounds}+ rounds in one): no report.`));
      const G = sc.grades, cur = sc.cur, gBox = (label, g, sub) => el("div", { class: "sc-gbox" }, [el("span", { class: "sc-gl" }, label), gEl(g), sub ? el("small", { class: "muted" }, sub) : null]);
      const odds = M.tiers.map((t) => { const o = sc.odds[t]; if (!o || o.p == null) return null; return el("div", { class: "sc-odd", title: `Comps: ${pc(o.cohort)} · projection: ${pc(o.model)}` }, [el("span", { class: "sc-ol" }, `Top ${t}`), el("div", { class: "sc-ob" }, el("i", { style: `width:${Math.max(1, Math.round(o.p * 100))}%` })), el("b", {}, pc(o.p))]); });
      const nx = (x) => (x.next ? `${ord(x.next.rank)}${x.next.partial ? " so far" : ""} (${sg2(x.next.sg)})` : "—");
      const so = cur.partial ? " so far" : "", crk = B.season[cur.y]?.by.get(r.k)?.cr || {};
      return card(`${r.nm} · scouting report`, "#ffcc00", [
        el("p", { class: "sc-rankline" }, [el("b", {}, `${ord(cur.rank)} of ${cur.of}`), ` on the ${tour || "tour"} in ${cur.y}${so} (${sg2(cur.sg)} strokes gained per round, ${cur.n} rounds)`, r.now ? ` · ${ord(r.now.r)} of ${r.now.n} over the last ${ROLL} rounds (${sg2(r.now.v)})` : ""]),
        el("div", { class: "sc-grades" }, [gBox("Now", G.now, `${ord(cur.rank)}${so}`), gBox("Next season", G.proj, `${sg2(sc.proj)} · ≈${ord(G.projRank)}`), gBox("Ceiling", G.ceil, `a good season · ≈${ord(G.ceilRank)}`),
          ...PI.CATS.map((c) => gBox(PI.CATN[c], G.tools[c], `${sg2(cur[c])}${crk[c] ? ` · ${ord(crk[c])}` : ""}`))]),
        el("p", { class: "muted small" }, `Ratings (0-100) come straight from rank, against the ${G.refY} season's ${G.refN} ranked players: the share of them the number beats (50 the middle player, 90 the top 10%, 99 the best). ≈ the rank that number would have had in ${G.refY}. Next season's projection: ${sg2(sc.proj)} strokes gained per round, 80% of the time between ${sg2(sc.lo)} and ${sg2(sc.hi)}.`),
        odds.some(Boolean) ? el("div", { class: "sc-odds" }, [el("p", { class: "ip-kick" }, "Odds of next season's year-end rank"), ...odds]) : null,
        sc.comps.length ? el("div", {}, [el("p", { class: "ip-kick" }, `Comps · the past seasons most like ${r.nm.split(" ").at(-1)}'s ${cur.y}${cur.partial ? " (so far)" : ""}`), el("p", { class: "muted small" }, `Players whose season looked like his (${ord(cur.rank)}, ${sg2(cur.sg)} per round, and the same shape: strong and weak in the same parts of the game) and what they did the season after. That's why they sit near his rank.`),
          el("div", { class: "ip-tw" }, el("table", { class: "ip-t sc-comps" }, [el("thead", {}, el("tr", {}, ["Player", "Season", "Similarity", "That season", "Next season"].map((h, i) => el("th", { class: i > 1 ? "num" : null }, h)))),
            el("tbody", {}, sc.comps.slice(0, 8).map((c) => el("tr", {}, [el("td", { class: "sc-nm" }, c.x.nm), el("td", {}, `${c.x.y}${c.x.age != null ? ` (age ${Math.floor(c.x.age)})` : ""}`), el("td", { class: "num strong" }, String(c.sim)),
              el("td", { class: "num" }, `${ord(c.x.rank)} (${sg2(c.x.sg)})`), el("td", { class: `num strong ${c.x.next.rank < c.x.rank ? "pos" : c.x.next.rank > c.x.rank ? "neg" : ""}` }, nx(c.x))])))]))]) : null,
        sc.pre.length ? el("div", {}, [el("p", { class: "ip-kick" }, "Before the breakout · the most similar seasons that came a year before a top-10 season"),
          el("ul", { class: "ip-bul" }, sc.pre.map((c) => el("li", {}, `${c.x.nm} in ${c.x.y} (similarity ${c.sim}): ${ord(c.x.rank)} that season, then ${nx(c.x)}`)))]) : null,
        samp(`Comps from ${M.pool.length} past player-seasons with a season after them; the odds blend the comps' next seasons (${Math.round(sc.wC * 100)}% here, ${sc.effN.toFixed(0)} effective comps) with the projection. See "How it works".`)]); }
    // (update 890) fast risers: the rolling 24-round strokes gained now against a year ago, against the round-to-round noise
    function drawRisers() {
      const list = M.risers.filter((x) => x.dv > 0).slice(0, 25);
      mount(boardBox, card(`Fast risers · ${tour || ""}`.trim(), "#30d158", [el("div", { class: "ip-tw sc-tw" }, el("table", { class: "ip-t sc-t" }, [el("thead", {}, el("tr", {}, ["Player", "Age", "A year ago", "Now", "Change", "Rank", "Real?", "Ceiling", T1 ? `Top ${T1} odds` : null].filter(Boolean).map((h, i) => el("th", { class: i ? "num" : null }, h)))),
        el("tbody", {}, list.map((x) => { const sc = M.scout(x.r.k), tr = el("tr", { class: `sc-row${x.r.k === sel ? " on" : ""}`, tabindex: "0" }, [el("td", { class: "sc-nm" }, x.r.nm), el("td", { class: "num" }, x.r.age ?? "—"), el("td", { class: "num" }, sg2(x.r.ago.v)), el("td", { class: "num strong" }, sg2(x.r.now.v)),
          el("td", { class: "num pos strong" }, sg2(x.dv)), el("td", { class: "num" }, `${ord(x.r.ago.r)} → ${ord(x.r.now.r)}`), el("td", { class: "num" }, x.z >= 1.65 ? el("b", { class: "pos" }, "Clear") : x.z >= 1 ? "Likely" : el("span", { class: "muted" }, "Could be noise")),
          el("td", { class: "num" }, sc ? gEl(sc.grades.ceil) : "—"), T1 ? el("td", { class: "num" }, sc ? pc(sc.odds[T1]?.p) : "—") : null]);
          const pick = () => { sel = x.r.k; drawRisers(); drawDetail(); detail.scrollIntoView({ behavior: "smooth", block: "start" }); }; tr.addEventListener("click", pick); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); }); return tr; }))])),
        samp(`Strokes gained per round over each player's last ${ROLL} rounds, now and a year earlier (players with ${ROLL}+ rounds at both points). Real?: "Clear" when the rise is bigger than round-to-round luck allows about 95% of the time (one round's spread here is ${M.rdSd.toFixed(2)} strokes, so two ${ROLL}-round averages differ by about ${M.noise.toFixed(2)} by chance alone); "Likely" past one standard deviation of that luck.`)]));
    }
    function drawHow() {
      const f = M.fit;
      mount(boardBox, card("How it works", "#8e8e93", [el("ol", { class: "ip-bul" }, [
        el("li", {}, [el("b", {}, "Comps (from baseball's PECOTA and FiveThirtyEight's NBA CARMELO). "), `Every player-season in the file is a profile: strokes gained per round and in each part of the game, the change from the season before, age (when the file has birth dates), seasons on the tour and rounds played. Each is put on the same scale (standard deviations across every player-season) and weighted (strokes gained per round counts most). A player's latest season is matched with the nearest past player-seasons that have a season after them. Similarity: 100 identical, 0 as different as a typical pair of players.`]),
        el("li", {}, [el("b", {}, "Tier odds, two ways, blended. "), `(1) The comps' cohort (hockey's Prospect Cohort Success): of the 25 most similar past seasons, weighted by how similar, the share whose next season finished in each tier (year-end strokes-gained rank). (2) A projection: next season's strokes gained per round from this one (pulled toward average by its rounds: a ${20}-round season counts for half) and its change from the season before, fitted on ${f.n} past season-to-season pairs${f.fallback ? " (too few yet: standard values used)" : ""}: next ≈ ${f.a.toFixed(2)} + ${f.b.toFixed(2)} × this season${Math.abs(f.c) >= 0.005 ? ` ${f.c >= 0 ? "+" : "−"} ${Math.abs(f.c).toFixed(2)} × the change` : ""}, give or take ${f.s.toFixed(2)} per round. The odds are the chance of beating each tier's usual line (${M.tiers.map((t) => `top ${t}: ${sg2(M.tierLine[t])}`).join(", ")} per round). The cohort counts for up to half, more when its comps are close and many.`]),
        el("li", {}, [el("b", {}, "Ratings, 0-100. "), "The percentile: the share of the latest full season's ranked players the number beats, so 50 is the middle player, 90 the top 10% and 99 the best. Now: this season. Next season and Ceiling: the projection and a good outcome (its 80th percentile). One for each part of the game the same way. (Baseball scouts use a 20-80 scale; a percentile says the same thing in plain numbers.)"]),
        el("li", {}, [el("b", {}, "Fast risers. "), `The rolling ${ROLL}-round strokes gained now against a year ago, flagged "Clear" only when the rise is bigger than luck explains.`]),
        el("li", {}, [el("b", {}, "Before the breakout. "), "The past seasons most like a player's latest that came the year before a top-10 season (from outside the top 10): the paths successful players took."]),
        el("li", {}, [el("b", {}, "Limits. "), `The file covers ${B.years[0]}-${B.years.at(-1)}: comps and odds learn from those seasons only (${M.pool.length} player-seasons with a season after them), so they get sharper as seasons are added. The current season counts as it stands so far.`])])]));
    }
    drawDetail(); if (part === "risers") drawRisers(); else if (part === "how") drawHow(); else drawBoard();
  }
  draw();
}

/** the career chart: rank over time (1 at the top), the rolling rank as a line, each season's year-end rank a dot, the OWGR a second line */
function careerChart(pts, yrPts, hasOw, boxW = 640) {
  const roll = pts.filter((x) => x.rr), ow = hasOw ? pts.filter((x) => x.ow != null) : [];
  if (roll.length + yrPts.length + ow.length < 2) return el("p", { class: "muted small" }, "Not enough rounds yet for a chart.");
  const W = Math.max(320, Math.min(760, Math.round(boxW) - 40)), H = W < 500 ? 230 : 260, L = 34, R = 10, T = 16, Bm = 24; // (drawn at the width it shows: the text stays readable on a phone)
  const ts = [...roll.map((x) => x.t), ...yrPts.map((x) => x.t), ...ow.map((x) => x.t)], t0 = Math.min(...ts), t1 = Math.max(...ts) + 1;
  const mx = Math.max(10, ...roll.map((x) => x.rr.r), ...yrPts.map((x) => x.o.rank), ...ow.map((x) => x.ow));
  // a square-root scale: the top of the ranks gets more room (1st to 10th matters more than 150th to 160th)
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (r) => T + (Math.sqrt(Math.max(1, r)) - 1) / (Math.sqrt(mx) - 1) * (H - T - Bm);
  const ticks = [1, 5, 10, 25, 50, 100, 150, 200, 300, 400, 500, 700].filter((v) => v <= mx); // (update 894: the whole scale, down to the lowest rank shown)
  const g = [];
  for (const v of ticks) g.push(sv("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: "sc-grid" }), sv("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", class: "sc-ax" }, String(v)));
  const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
  for (let y = y0; y <= y1; y++) { const t = Date.parse(`${y}-01-01T12:00:00`); if (t < t0 || t > t1) continue; g.push(sv("line", { x1: X(t), x2: X(t), y1: T, y2: H - Bm, class: "sc-grid" })); }
  for (let y = y0; y <= y1; y++) { const a = Math.max(t0, Date.parse(`${y}-01-01T12:00:00`)), b = Math.min(t1, Date.parse(`${y + 1}-01-01T12:00:00`)); if (b - a > 20 * 864e5) g.push(sv("text", { x: (X(a) + X(b)) / 2, y: H - 8, "text-anchor": "middle", class: "sc-ax" }, String(y))); }
  const path = (xs, f) => xs.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)} ${Y(f(x)).toFixed(1)}`).join(" ");
  if (ow.length > 1) g.push(sv("path", { d: path(ow, (x) => x.ow), class: "sc-ow" }));
  if (roll.length > 1) g.push(sv("path", { d: path(roll, (x) => x.rr.r), class: "sc-roll" }));
  for (const x of roll) g.push(sv("circle", { cx: X(x.t), cy: Y(x.rr.r), r: 2.2, class: "sc-rolld" }, sv("title", {}, `${fmtD(x.t)}: ${ord(x.rr.r)} of ${x.rr.n} over the last ${ROLL} rounds (${sg2(x.rr.v)} per round)${x.ow != null ? `; OWGR ${Math.round(x.ow)}` : ""}`)));
  for (const x of yrPts) g.push(sv("circle", { cx: X(x.t), cy: Y(x.o.rank), r: 5.5, class: "sc-yrd" }, sv("title", {}, `${x.y} year-end: ${ord(x.o.rank)} (${sg2(x.o.sg)} per round, ${x.o.n} rounds)`)),
    sv("text", { x: X(x.t), y: Y(x.o.rank) - 9, "text-anchor": "middle", class: "sc-yrl" }, ord(x.o.rank)));
  return el("div", { class: "sc-chart" }, [sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "sc-svg", role: "img", "aria-label": "Rank over time" }, g),
    el("div", { class: "td-legend sc-lg" }, [el("span", { class: "sc-lg-roll" }, `Rolling rank (last ${ROLL} rounds)`), el("span", { class: "sc-lg-yr" }, "Year-end rank"), ow.length ? el("span", { class: "sc-lg-ow" }, "OWGR") : null])]);
}
