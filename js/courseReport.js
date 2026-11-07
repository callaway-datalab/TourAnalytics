/*
 * (update 506) Course Prep › Generate PDF: a premium course strategy report, letter landscape, the Callaway Tour
 * Analytics bar on every page and its headers in capitals: a cover (the scores to beat, every hole's difficulty), the
 * course overview (each hole's numbers), the game plan (holes to attack and play safe, where the fairway, the green and
 * going for it matter, the tee miss to avoid, against the Top 10, the shots the course asks for), then a page a hole: the
 * Strategy Maps heatmaps (where tee shots and approaches finish), its scoring, pins, tee misses and up & down by miss.
 * Filtered by a player (their own shots here) or, with none or none of theirs here, the field. Opened in the report viewer
 * the Outlook report uses (outlook.html: Save PDF there), or a tab of its own.
 */
import { el, mount } from "./ui.js";
import { heatData, heatImage, withMerges, zonesOf, keyZones, buildOverlay, learnOf, pinForShot, shotsFor, listHeatCourses, pinLabel, pinsOn } from "./courseHeat.js";
import { playerTrails, skillsOf, ATT_B } from "./courseShots.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toPar = (v) => (v == null ? "—" : v > 0 ? `+${v}` : v === 0 ? "E" : `−${Math.abs(v)}`);
const sgn = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0.0049 ? "+" : v < -0.0049 ? "−" : ""}${Math.abs(v).toFixed(d)}`);
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const SCC = { e: "#1f4fd1", b: "#8fd3ff", p: "#e9ecef", g: "#ff9f43" };
const udCls = (p) => (p == null ? "" : p >= 75 ? "good" : p >= 50 ? "mid" : "bad");

/** The button's dialog: "Filter by player?", an optional player search; then the report. */
export async function openReportDialog(ctx, course, btn) {
  const { pickWho } = await import("./views/coursePrepExtras.js");
  let who = null;
  const shade = el("div", { class: "cr-shade" });
  const box = el("div", { class: "cr-dlg", role: "dialog", "aria-label": "Generate the course report" });
  const W = await pickWho(ctx, (p) => { who = p; note.textContent = p ? `For ${p.label}` : ""; });
  const mine = !W.node && W.who; // (a player: their own, or the field)
  const note = el("p", { class: "muted small" }, "");
  const useMine = mine ? el("label", { class: "cr-check" }, [el("input", { type: "checkbox", checked: true }), ` Use my shots (${W.who.label})`]) : null;
  const go = el("button", { type: "button", class: "btn" }, "Generate PDF"), cancel = el("button", { type: "button", class: "btn ghost" }, "Cancel");
  const close = () => { shade.remove(); box.remove(); };
  cancel.addEventListener("click", close); shade.addEventListener("click", close);
  go.addEventListener("click", async () => {
    const pick = mine ? (useMine.querySelector("input").checked ? W.who : null) : who;
    const inApp = (() => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); } catch { return false; } })();
    const win = inApp ? null : window.open("", "_blank"); // (opened now, while it's still a tap: pop-up blockers allow it)
    if (win) win.document.write("<p style=\"font:14px sans-serif;padding:20px\">Building the course report…</p>");
    go.disabled = true; cancel.disabled = true;
    try {
      const html = await buildCourseReport(course, pick, (t) => { go.textContent = t; if (btn) btn.textContent = t; });
      close(); if (btn) btn.textContent = "Generate PDF";
      openHtml(html, win, inApp);
    } catch (err) {
      console.error(err); if (win) win.close();
      go.disabled = false; cancel.disabled = false; go.textContent = "Generate PDF"; if (btn) btn.textContent = "Generate PDF";
      note.textContent = `Couldn’t build the report: ${err?.message || err}`;
    }
  });
  mount(box, [el("h2", {}, "Filter by player?"), el("p", { class: "muted small" }, "Optional. Leave it blank for the field’s numbers; a player with no shots at this course gets the field’s too."),
    W.node || useMine, note, el("div", { class: "cr-acts" }, [cancel, go])]);
  document.body.append(shade, box);
}

/** The report written into the new tab, or (a phone, the installed app) the report viewer in this one. */
function openHtml(html, win, inApp) {
  if (inApp) {
    let ok = false; try { sessionStorage.setItem("ta.outlookReport", html); ok = true; } catch { /* (too big for this tab's storage) */ }
    if (ok) { location.href = "outlook.html"; return; }
  }
  if (win) {
    // (update 511) the tab's Save PDF and Close: the report page's own script (outlookView.js), loaded into the tab
    // (update 511) the tab opens the report page (outlook.html: Save PDF and Close), which takes the report from this one
    // (the site's security rules don't let a report written straight into a tab run its Save PDF)
    window.__taReport = html;
    win.location.href = new URL("outlook.html?tab=1", location.href).href;
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a"); a.href = url; a.download = "course-report.html"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

const dataUrlOf = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); const b = await r.blob(); return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); }); };
const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

/** A hole's heatmap as a picture: the image, the scoring zones over it (shot k's results), the pin. */
async function holeMap(img, hm, H, P, par, k, learnKey) {
  const pin = pinForShot(P, k);
  if (!pin?.rows?.length) return null;
  const Z = zonesOf(pin, par, null, { toGo: true, yards: H.yards || null, dense: true, played: k || null });
  if (!Z.zones.length) return null;
  keyZones(Z, false);
  const ov = buildOverlay(img, Z, { W: hm.w, H: hm.h, par, mode: "score", res: 1400, learn: learnOf(H), learnKey });
  const maxW = 760, s = Math.min(1, maxW / hm.w), cw = Math.round(hm.w * s), ch = Math.round(hm.h * s);
  const c = document.createElement("canvas"); c.width = cw; c.height = ch;
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, cw, ch); g.drawImage(ov.canvas, 0, 0, cw, ch);
  if (P.x != null) { const px = P.x * s, py = P.y * s, r = Math.max(5, cw / 90); g.fillStyle = "#ffd60a"; g.strokeStyle = "#111"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py - r); g.lineTo(px + r, py); g.lineTo(px, py + r); g.lineTo(px - r, py); g.closePath(); g.fill(); g.stroke(); }
  const url = c.toDataURL("image/jpeg", 0.8); c.width = 0; c.height = 0;
  return { url, tall: hm.h > hm.w };
}

/** The whole report (an HTML document). */
export async function buildCourseReport(course, who, onStatus = () => {}) {
  const meta = course.heat;
  onStatus("Loading the course…");
  const raw = await heatData(meta), data = withMerges(meta, raw);
  let I = data?.insights;
  if (!I) throw new Error("this course has no insights yet: rebuild its maps on Upload Data");
  // (update 509) maps built before update 508 have no numbers for each pin: worked out here from the course's saved shots
  // (not saved; Rebuild maps on Upload Data saves them)
  if (meta.rawChunks && Object.values(I.holes || {}).some((x) => !x.pinStats)) {
    try {
      onStatus("Working out each pin from the saved shots\u2026");
      const [{ loadRaw, RAW_COLS }, { shotAggregator }] = await Promise.all([import("./courseRaw.js"), import("./courseShots.js")]);
      const rows = await loadRaw(meta), agg = shotAggregator();
      for (let i = 0; i < rows.length; i += 100000) agg.add({ columns: meta.rawCols || RAW_COLS, rows: rows.slice(i, i + 100000) });
      const fresh = agg.finish().sort((x, y) => y.players.size - x.players.size)[0]?.data?.insights;
      if (fresh?.holes) I = { ...I, holes: Object.fromEntries(Object.entries(I.holes).map(([h, x]) => [h, x.pinStats || !fresh.holes[h]?.pinStats ? x : { ...x, pinStats: fresh.holes[h].pinStats }])) };
    } catch (err) { console.warn("pin numbers", err); }
  }
  const [{ subject, holeFacts }, all] = await Promise.all([import("./views/coursePrepInsights.js"), listHeatCourses().catch(() => [])]);
  let mine = null;
  if (who) { const tr = await playerTrails(meta, who.key).catch(() => null); mine = tr?.trails?.length ? tr.trails : null; }
  const S = subject(I, mine, mine ? who.key : null), name = mine ? who.label : "Field", first = mine ? who.label.split(" ")[0] : "the field";
  const holeNums = Object.keys(I.holes).map(Number).sort((a, b) => a - b);
  const yardsOf = (h) => data.holes?.[h]?.yards || meta.yards?.[h - 1] || null;
  const HF = holeFacts(I, holeNums, yardsOf, S);
  const logo = await dataUrlOf("media/logo.png").catch(() => dataUrlOf("icons/icon-192.png")).catch(() => null);
  const ev = I.events, events = course.mapEvents || ev.map((e) => e.y).join(", ");
  const pages = [];
  const page = (kicker, body, cls = "") => pages.push(`<section class="page ${cls}"><div class="brandbar">${logo ? `<img src="${logo}" alt="">` : ""}<span>Callaway Tour Analytics</span><em>${esc(kicker)}</em></div>${body}</section>`);
  const av = (k) => { const v = ev.map((e) => e[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const subjLabel = mine ? esc(who.label) : "Field averages";
  const avgOf = (o, par) => (o?.n ? par + o.sum / o.n : null);

  // 1. the cover, with the game plan on it (update 507: no course overview page)
  const tone = (v) => { if (v == null) return "#f1f3f5"; const t = Math.max(-1, Math.min(1, v / 0.35)); return t < 0 ? `rgba(61,156,255,${0.18 + 0.55 * -t})` : `rgba(255,${Math.round(159 - 90 * t)},${Math.round(67 - 9 * t)},${0.18 + 0.6 * t})`; };
  const top3 = (list, key, min = -Infinity) => list.filter((x) => x[key] != null && x[key] > min).sort((a, b) => b[key] - a[key]).slice(0, 3);
  const agg = HF.map((x) => ({ ...x, ix: x.birdie - x.bogey }));
  const blocks = [
    ["ATTACK", "pos", top3(agg, "ix", 0), (x) => [`${Math.round(x.birdie)}%`, "birdies", `${Math.round(x.bogey)}% bogeys`]],
    ["PLAY SAFE", "neg", agg.filter((x) => x.ix < 0).sort((a, b) => a.ix - b.ix).slice(0, 3), (x) => [`${Math.round(x.bogey)}%`, "bogeys", `${Math.round(x.birdie)}% birdies`]],
    ["FAIRWAYS MATTER", "", top3(HF, "fwy", 0.05), (x) => [x.fwy.toFixed(2), "strokes", "missing the fairway"]],
    ["GREENS MATTER", "", top3(HF, "gir", 0.05), (x) => [x.gir.toFixed(2), "strokes", "missing the green"]],
    ["GO FOR IT", "pos", top3(HF, "go", 0.05), (x) => [x.go.toFixed(2), "strokes", "saved going for it"]],
    ["TEE MISS TO AVOID", "neg", HF.filter((x) => x.miss && x.miss.by >= 0.1).sort((a, b) => b.miss.by - a.miss.by).slice(0, 3), (x) => [x.miss.worse === "left" ? "Left" : "Right", "miss", `+${x.miss.by.toFixed(2)} vs the opposite`]],
  ].filter(([, , l]) => l.length);
  const holesV = HF.map((x) => { const a = x.me?.n ? x.me.sum / x.me.n : null, t = x.top?.n ? x.top.sum / x.top.n : null; return { h: x.h, v: a != null && t != null ? t - a : null }; }).filter((x) => x.v != null);
  const dists = skillsOf(S.sg, S.topSg).map((b) => { const me = S.rounds ? (S.sg[b] || 0) / S.rounds : null, tp = S.topRounds ? (S.topSg[b] || 0) / S.topRounds : null; return { b, v: me != null && tp != null ? me - tp : null }; }).filter((x) => x.v != null && (S.sg[x.b] != null || S.topSg[x.b] != null));
  const bars = (list, k, n) => { const l = list.filter((x) => x.v < -0.005).sort((a, b) => a.v - b.v).slice(0, n), m = Math.max(...list.map((x) => Math.abs(x.v)), 0.01); return l.map((x) => `<div class="vr"><span>${esc(k(x))}</span><i><b class="neg" style="width:${(Math.abs(x.v) / m) * 100}%"></b></i><em class="neg">${sgn(x.v)}</em></div>`).join("") || `<p class="muted small">None</p>`; };
  const tour = {}; for (const c of all) for (const [b, n] of Object.entries(c.attempts || {})) tour[b] = (tour[b] || 0) + n;
  const tt = Object.values(tour).reduce((a, b) => a + b, 0), st2 = Object.values(S.attempts).reduce((a, b) => a + b, 0);
  const faced = tt && st2 && all.length >= 2 ? ATT_B.map((b) => ({ b, d: (100 * (S.attempts[b] || 0)) / st2 - (100 * (tour[b] || 0)) / tt })).filter((r) => r.d >= 0.5) : [];
  page("Course strategy report", `<div class="cover">
    <div class="chead"><div><div class="ck">COURSE STRATEGY REPORT</div><h1>${esc(course.name)}</h1><div class="cev">${esc(events)} \u00b7 ${mine ? `Prepared for <b>${esc(who.label)}</b>` : who ? `${esc(who.label)} has no shots here: <b>field averages</b>` : "<b>Field averages</b>"}</div></div>
      <div class="scores">${[["Make the cut", av("cut"), "#c8372d"], ["Top 25", av("top25"), "#e07a1f"], ["Top 10", av("top10"), "#c99a00"], ["Win", av("win"), "#1e8a4c"]].filter(([, v]) => v != null).map(([l, v, c]) => `<div class="sc"><span>${l}</span><b style="color:${c}">${toPar(v)}</b></div>`).join("")}</div></div>
    <div class="strip">${HF.map((x) => { const v = x.me?.n ? x.me.sum / x.me.n : null; return `<div class="t" style="background:${tone(v)}"><b>${x.h}</b><span>Par ${x.par}</span><em>${v == null ? "\u2014" : sgn(v)}</em><i>${ord(x.hcp)}</i></div>`; }).join("")}</div>
    <div class="plan">${blocks.map(([t, tn, l, val]) => `<div class="blk ${tn}"><h3>${t}</h3><div class="cards3">${l.map((x) => { const [big, unit, nt] = val(x); return `<div class="bc"><span>HOLE \u00b7 PAR ${x.par}</span><b>${x.h}</b><em><strong>${big}</strong> ${unit}</em><small>${nt}</small></div>`; }).join("")}</div></div>`).join("")}</div>
    <div class="cols c3">
      <div><h3>AGAINST THE TOP 10 \u00b7 HOLES</h3>${bars(holesV.map((x) => ({ ...x, k: `Hole ${x.h}` })), (x) => x.k, 5)}</div>
      <div><h3>AGAINST THE TOP 10 \u00b7 SKILLS</h3>${bars(dists, (x) => x.b, 5)}</div>
      <div><h3>SHOTS YOU\u2019LL FACE MORE THAN NORMAL</h3>${faced.length ? faced.sort((a, b) => b.d - a.d).slice(0, 5).map((r) => `<div class="vr"><span>${esc(r.b)}</span><i><b class="gold" style="width:${Math.min(100, r.d * 12)}%"></b></i><em>+${r.d.toFixed(1)}%</em></div>`).join("") : `<p class="muted small">About the same mix as an average course.</p>`}</div>
    </div>
    <p class="muted foot">Scores to beat: the week, to par, the average of ${ev.length} ${ev.length === 1 ? "event" : "events"} here. Tiles: ${mine ? `${esc(first)}\u2019s` : "the field\u2019s"} scoring to par on each hole (blue under, orange over) and how hard it plays. Against the Top 10: where they gain most on ${esc(first)}.</p>
  </div>`, "cov");

  // 2. (update 507) the player's history at this course, from their stats: only when they have rounds here
  if (who) {
    try {
      const [{ playerData }, { sameCourse }] = await Promise.all([import("./views/coursePrepExtras.js"), import("./sg.js")]);
      onStatus("Loading the player\u2019s course history\u2026");
      const d = await Promise.race([playerData(who.key), new Promise((r) => setTimeout(() => r(null), 12000))]); // (not waited on for ever)
      const rounds = d?.rounds || [], here = rounds.filter((rd) => sameCourse(rd.course, course.name));
      if (here.length) {
        // (update 508) here against everywhere else (their rounds at other courses); by category, by distance (where they
        // gain and lose most here, against elsewhere), by year, best and toughest rounds, each tournament
        const elsewhere = rounds.filter((rd) => !sameCourse(rd.course, course.name));
        const per = (rs, cat = null, dist = null) => (rs.length ? rs.reduce((t, rd) => t + rd.shots.reduce((u, x) => u + ((!cat || x.cat === cat) && (!dist || x.dist === dist) ? x.sg || 0 : 0), 0), 0) / rs.length : null);
        const CATS = [[null, "Total"], ["OTT", "Off the tee"], ["APP", "Approach"], ["ARG", "Around the green"], ["PUTT", "Putting"]], CN = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
        const evs = new Map(); for (const rd of here) { const k = `${rd.event}|${rd.year}`; (evs.get(k) || evs.set(k, { event: rd.event, year: rd.year, end: rd.date, rs: [] }).get(k)).rs.push(rd); const e = evs.get(k); if (String(rd.date) > String(e.end)) e.end = rd.date; }
        const yrs = new Map(); for (const rd of here) { const y = String(rd.year || String(rd.date || "").slice(0, 4)); (yrs.get(y) || yrs.set(y, []).get(y)).push(rd); }
        const cls = (v) => (v == null ? "" : v > 0.005 ? "pos" : v < -0.005 ? "neg" : "");
        const shotsAt = (rs, cat, dist) => rs.reduce((t, rd) => t + rd.shots.reduce((u, x) => u + (x.cat === cat && x.dist === dist ? x.w || 1 : 0), 0), 0);
        const dl = []; const seen = new Set(); for (const rd of here) for (const x of rd.shots) { if (!x.cat || !x.dist) continue; const k = `${x.cat}|${x.dist}`; if (seen.has(k)) continue; seen.add(k); if (shotsAt(here, x.cat, x.dist) < 4) continue; const a = per(here, x.cat, x.dist), b = per(elsewhere, x.cat, x.dist); if (a != null && b != null) dl.push({ cat: x.cat, dist: x.dist, d: a - b, a, b }); }
        const gains = dl.filter((x) => x.d > 0.005).sort((a, b) => b.d - a.d).slice(0, 5), losses = dl.filter((x) => x.d < -0.005).sort((a, b) => a.d - b.d).slice(0, 5);
        const dRow = (x) => `<tr><td>${CN[x.cat] || x.cat} \u00b7 ${esc(x.dist)}</td><td class="${cls(x.a)}">${sgn(x.a)}</td><td class="${cls(x.b)}">${sgn(x.b)}</td><td class="${cls(x.d)}"><b>${sgn(x.d)}</b></td></tr>`;
        const sorted = [...here].sort((a, b) => per([b]) - per([a])), best = sorted[0], worst = sorted.at(-1);
        const ph = per(here), pe = per(elsewhere);
        // (update 509) laid out to fill the page: the headline numbers, here against elsewhere by category (bars), by year and
        // each tournament, then the shots they gain and lose most here
        const catMax = Math.max(0.05, ...CATS.flatMap(([k]) => [Math.abs(per(here, k) || 0), Math.abs(per(elsewhere, k) || 0)]));
        const hbar = (v, c) => `<div class="hb"><i class="${c}" style="${v < 0 ? "right:50%" : "left:50%"};width:${(Math.min(1, Math.abs(v || 0) / catMax) * 50).toFixed(1)}%"></i></div>`;
        // (update 511) each tournament's finish: among the players with the most rounds in it, by strokes gained a round (as the
        // website's Course History); fewer rounds than them: MC
        const field = d?.field || [];
        const finish = (e) => {
          const played = field.map((p) => ({ p, rs: p.rounds.filter((rd) => rd.event === e.event && String(rd.year) === String(e.year)) })).filter((x) => x.rs.length);
          if (!played.length) return "\u2014";
          const most = Math.max(...played.map((x) => x.rs.length));
          const list = played.filter((x) => x.rs.length >= most).map((x) => ({ key: x.p.key, v: per(x.rs) })).sort((a, b) => b.v - a.v);
          const i = list.findIndex((x) => x.key === who.key);
          return i < 0 ? (e.rs.length < most ? "MC" : "\u2014") : `${i + 1} of ${list.length}`;
        };
        const rdName = (rd) => esc(`${rd.event || ""} ${rd.year || ""}${rd.roundNo ? ` \u00b7 Round ${rd.roundNo}` : ""}`); /* (update 510) */
        const tbl = (head, rows, empty) => `<table><thead><tr>${head.map((h, i2) => `<th${i2 ? ' class="n"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="muted">${empty}</td></tr>`}</tbody></table>`;
        const dRow2 = (x) => `<tr><td>${CN[x.cat] || x.cat} \u00b7 ${esc(x.dist)}</td><td class="n ${cls(x.a)}">${sgn(x.a)}</td><td class="n ${cls(x.b)}">${sgn(x.b)}</td><td class="n ${cls(x.d)}"><b>${sgn(x.d)}</b></td></tr>`;
        page("Course history", `<div class="hist"><h2 class="h">COURSE HISTORY <small>${esc(who.label)} at ${esc(course.name)} against elsewhere (their rounds at other courses), from the stats</small></h2>
          <div class="scores s6"><div class="sc"><span>Rounds here</span><b>${here.length}</b><small>${evs.size} ${evs.size === 1 ? "tournament" : "tournaments"}</small></div><div class="sc"><span>SG a round here</span><b class="${cls(ph)}">${sgn(ph)}</b><small>strokes gained</small></div><div class="sc"><span>Elsewhere</span><b class="${cls(pe)}">${sgn(pe)}</b><small>${elsewhere.length} rounds</small></div><div class="sc"><span>Here vs else</span><b class="${cls(ph - pe)}">${sgn(ph - pe)}</b><small>a round</small></div>
            <div class="sc"><span>Best round here</span><b class="${cls(per([best]))}">${sgn(per([best]))}</b><small>${rdName(best)}</small></div><div class="sc"><span>Toughest here</span><b class="${cls(per([worst]))}">${sgn(per([worst]))}</b><small>${rdName(worst)}</small></div></div>
          <div class="hrow r1">
            <div><h3>HERE AGAINST ELSEWHERE <small>strokes gained a round</small></h3>
              <div class="hcat"><div class="hk"><div>Category</div><div><span class="hlg"><i class="here"></i>Here</span> <span class="hlg"><i class="else"></i>Elsewhere</span></div><div class="n">Here / else</div><div class="n">Diff</div></div>
              ${CATS.map(([k, l]) => { const h0 = per(here, k), a0 = per(elsewhere, k); return `<div class="hc${k ? "" : " tot"}"><span class="l">${l}</span><div class="bars">${hbar(h0, "here")}${hbar(a0, "else")}</div><span class="v"><b class="${cls(h0)}">${sgn(h0)}</b><em class="${cls(a0)}">${sgn(a0)}</em></span><span class="n ${cls(h0 - a0)}"><b>${sgn(h0 - a0)}</b></span></div>`; }).join("")}</div></div>
            <div><h3>TOURNAMENTS HERE</h3>${tbl(["Tournament", "Rounds", "SG / round", "Finish"], [...evs.values()].sort((a, b) => String(b.end).localeCompare(String(a.end))).slice(0, 8).map((e) => `<tr><td>${esc(e.event)} ${esc(e.year || "")}</td><td class="n">${e.rs.length}</td><td class="n ${cls(per(e.rs))}"><b>${sgn(per(e.rs))}</b></td><td class="n"><b>${esc(finish(e))}</b></td></tr>`), "None")}</div>
          </div>
          <div class="hrow r2">
            <div><h3>BETTER HERE <small>shots where they gain most, a round</small></h3>${tbl(["Shot", "Here", "Elsewhere", "Diff"], gains.map(dRow2), "None")}</div>
            <div><h3>WORSE HERE <small>shots where they lose most, a round</small></h3>${tbl(["Shot", "Here", "Elsewhere", "Diff"], losses.map(dRow2), "None")}</div>
          </div></div>`, "hpage");
      }
    } catch (err) { console.warn("course history", err); }
  }

  // 3. a page for every pin on every hole: its heatmaps, scoring, tee misses, up & down
  const mixRow = (label, o, par) => { if (!o?.n) return ""; const ks = ["e", "b", "p", "g"].filter((k) => o[k] > 0); return `<div class="mix"><span>${esc(label)}<small>${o.n} rds</small></span><i>${ks.map((k) => { const p = (100 * o[k]) / o.n; return `<b style="width:${p}%;background:${SCC[k]}">${p >= 14 ? `${Math.round(p)}%` : ""}</b>`; }).join("")}</i><em>${(par + o.sum / o.n).toFixed(2)}</em></div>`; };
  const fromHist = (h) => { const o = { n: 0, sum: 0, e: 0, b: 0, p: 0, g: 0 }; for (const [k, v] of Object.entries(h || {})) { const s = Number(k); o.n += v; o.sum += s * v; o[s <= -2 ? "e" : s === -1 ? "b" : s === 0 ? "p" : "g"] += v; } return o; };
  const fromTrails = (ts) => { const o = { n: 0, sum: 0, e: 0, b: 0, p: 0, g: 0 }; for (const t of ts) { if (t.s == null) continue; o.n++; o.sum += t.s; o[t.s <= -2 ? "e" : t.s === -1 ? "b" : t.s === 0 ? "p" : "g"]++; } return o; };
  const total = HF.reduce((t, x) => t + pinsOn(meta, data, x.h).length, 0); let done = 0;
  for (const x of HF) {
    const X = I.holes[x.h], H = data.holes?.[x.h] || { pins: {} }, hm = meta.holes?.[x.h], par = x.par;
    const pinAvg = (p) => { const o = fromHist(H.pins?.[p]?.hist); return o.n ? { avg: par + o.sum / o.n, n: o.n } : null; };
    const pins = pinsOn(meta, data, x.h).sort((a, b) => (pinAvg(b)?.avg ?? -9) - (pinAvg(a)?.avg ?? -9)); // (hardest first)
    let img = null; if (hm) { try { img = await loadImg(await heatImage(meta, x.h)); } catch (err) { console.warn("hole image", x.h, err); } }
    for (const pid of pins) {
      onStatus(`Drawing hole ${x.h}, ${pinLabel(meta, x.h, pid)} (${++done} of ${total})\u2026`);
      await new Promise((r) => setTimeout(r, 0));
      const P = H.pins[pid], ids = P?.merged || [pid], maps = [];
      if (img && P) {
        const ks = P.byShot ? (par <= 3 ? [1] : [1, par - 2]) : [0];
        for (const k of ks) { try { const m = await holeMap(img, hm, H, P, par, k, `${meta.id}|${x.h}`); if (m) maps.push({ ...m, cap: k === 0 ? "EVERY SHOT" : k === 1 && par >= 4 ? "WHERE TEE SHOTS FINISH" : "WHERE APPROACHES FINISH" }); } catch (err) { console.warn("hole map", x.h, pid, err); } }
      }
      // this pin's tee misses and up & down (a combined pin: its pins added up; older builds: the hole's)
      const D = {}; for (const o of X.drivePins ? ids.map((id) => X.drivePins[id]).filter(Boolean) : [X.drive]) for (const [k, a] of Object.entries(o || {})) { const b = (D[k] ||= [0, 0]); b[0] += a[0]; b[1] += a[1]; }
      const U = {}; for (const id of ids) for (const [side, lies] of Object.entries(X.udPins?.[id] || {})) for (const [lie, a] of Object.entries(lies)) { const o = (U[side] ||= {}), b = (o[lie] ||= [0, 0]); b[0] += a[0]; b[1] += a[1]; }
      const okD = (o) => o && o[0] >= 5, dAvg = (o) => (okD(o) ? par + o[1] / o[0] : null);
      const worse = okD(D.L) && okD(D.R) ? (dAvg(D.L) > dAvg(D.R) ? "L" : "R") : null;
      // (update 508) each square by lie (any attempts at all; fewer than 5 in italics)
      const cell = (side) => {
        const o = U[side] || {}, t = Object.values(o).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]), p = t[0] ? Math.round((100 * t[1]) / t[0]) : null;
        const lies = [["Fairway", "Fwy"], ["Rough", "Rgh"], ["Bunker", "Bnk"]].filter(([l]) => o[l]?.[0]).map(([l, sh]) => `<em class="${o[l][0] < 5 ? "few" : ""}">${sh} ${Math.round((100 * o[l][1]) / o[l][0])}% <small>(${o[l][0]})</small></em>`).join("");
        return `<div class="u ${udCls(p)}${t[0] && t[0] < 5 ? " few" : ""}"><span>${side.replace("-", " ")}</span><b>${p == null ? "\u2014" : `${p}%`}</b>${lies || "<small></small>"}</div>`;
      };
      // (update 508) what matters, for this pin (a combined pin: its pins added up); a course built before update 508: the hole's
      const PSs = ids.map((id) => X.pinStats?.[id]).filter(Boolean), sum2 = (k) => { const o = {}; for (const P0 of PSs) for (const [kk, a] of Object.entries(P0[k] || {})) { const b = (o[kk] ||= [0, 0]); b[0] += a[0]; b[1] += a[1]; } return o; };
      const m2 = (a) => (a && a[0] ? a[1] / a[0] : null);
      const valOf = (o, k) => { if (k === "go") { const g = o.go, l = o.lay; return g && l && g[0] >= 3 && l[0] >= 3 ? m2(l) - m2(g) : null; } const h = o.hit, m = o.miss; return h && m && h[0] >= 3 && m[0] >= 3 ? m2(m) - m2(h) : null; };
      const pv = PSs.length ? { fwy: par >= 4 ? valOf(sum2("fwy"), "fwy") : null, gir: valOf(sum2("gir"), "gir"), go: par >= 4 ? valOf(sum2("go"), "go") : null, widths: Object.entries(PSs[0].widths || {}).map(([c, w]) => [Number(c), w]).sort((a, b) => a[0] - b[0]) } : { fwy: x.fwy, gir: x.gir, go: x.go, widths: x.widths };
      const sumSc = (k) => { const o = { n: 0, sum: 0, e: 0, b: 0, p: 0, g: 0 }; for (const P0 of PSs) for (const kk of Object.keys(o)) o[kk] += P0[k]?.[kk] || 0; return o; };
      // (update 522) the fairway's worth from the same tee shots as OFF THE TEE: the left and right misses together against
      // the fairway, so the two never disagree (the old way also counted penalties and lost balls as misses)
      if (par >= 4 && okD(D.C) && (okD(D.L) || okD(D.R))) { const L0 = D.L || [0, 0], R0 = D.R || [0, 0]; pv.fwy = (L0[1] + R0[1]) / (L0[0] + R0[0]) - D.C[1] / D.C[0]; }
      const facts = [];
      if (pv.fwy != null) facts.push(`<b>Fairway</b> missing it costs ${pv.fwy.toFixed(2)}`);
      if (pv.gir != null) facts.push(`<b>Green in regulation</b> missing it costs ${pv.gir.toFixed(2)}`);
      if (pv.go != null) facts.push(`<b>Going for it</b> ${pv.go >= 0 ? `saves ${pv.go.toFixed(2)}` : `costs ${Math.abs(pv.go).toFixed(2)}`} on laying up`);
      if (pv.widths.length) facts.push(`<b>Fairway width</b> about ${Math.min(...pv.widths.map((w) => w[1]))}\u2013${Math.max(...pv.widths.map((w) => w[1]))} yds where drives land`);
      const myPin = mine ? fromTrails(mine.filter((t) => Number(t.h) === x.h && ids.includes(String(t.p)))) : null;
      const tallMaps = maps.length && maps.every((m) => m.tall), pl = pinLabel(meta, x.h, pid);
      // (update 588) strategy: what the shots say to aim for and avoid (a combined pin: its member with the most rounds; too
      // few rounds to the pin: every pin on the hole together)
      const SG = X.strategy || {}; let sg = ids.map((id) => SG[id]).filter(Boolean).sort((a, b) => b.n - a.n)[0], sgAll = false;
      if (!sg && SG["*"]) { sg = SG["*"]; sgAll = true; }
      const SGK = { tee: "Off the tee", miss: "Approach", surprise: "Surprise", layup: "Go or lay up" };
      const sgItems = (sg?.items || []).slice(0, 6);
      page(`Hole ${x.h} \u00b7 ${pl}`, `<div class="hh"><h2 class="h">HOLE ${x.h} \u00b7 ${esc(pl.toUpperCase())} <small>Par ${par}${x.yds ? ` \u00b7 ${x.yds} yds` : ""} \u00b7 ${ord(x.hcp)} hardest hole${pins.length > 1 ? ` \u00b7 ${ord(pins.indexOf(pid) + 1)} hardest of its ${pins.length} pins` : ""}</small></h2></div>
        <div class="hole ${tallMaps ? "tall" : ""}${sgItems.length ? " st" : ""}">
          <div class="maps n${maps.length || 1}">${maps.length ? maps.map((m) => `<figure><figcaption>${m.cap}</figcaption><img src="${m.url}" alt=""></figure>`).join("") : `<p class="muted">No hole image for this hole yet.</p>`}
            ${maps.length ? `<div class="lg"><span>Birdie</span><i></i><span>Bogey</span><small>The hole score from each spot</small></div>` : ""}</div>
          <div class="side">
            <div class="sec"><h3>SCORING <small>this pin</small></h3>${mine && myPin?.n ? mixRow(first, myPin, par) : ""}${mixRow("Field", PSs.length ? sumSc("field") : fromHist(P?.hist), par)}${PSs.length ? mixRow("Top 10", sumSc("top"), par) : ""}</div>
            ${par >= 4 && (okD(D.L) || okD(D.R)) ? `<div class="sec"><h3>OFF THE TEE <small>average score after</small></h3><div class="tee">${[["L", "Left miss", dAvg(D.L)], ["C", "Fairway", dAvg(D.C)], ["R", "Right miss", dAvg(D.R)]].map(([k, l, v]) => `<div class="${worse === k ? "worse" : ""}"><span>${l}</span><b>${v == null ? "\u2014" : v.toFixed(2)}</b></div>`).join("")}</div></div>` : ""}
            ${Object.keys(U).length ? `<div class="sec"><h3>UP &amp; DOWN BY MISS <small>this pin, within 30 yds</small></h3><div class="ud">${cell("Long-Left")}${cell("Long")}${cell("Long-Right")}${cell("Left")}<div class="u gr"><i></i></div>${cell("Right")}${cell("Short-Left")}${cell("Short")}${cell("Short-Right")}</div></div>` : ""}
            ${facts.length ? `<div class="sec"><h3>WHAT MATTERS <small>${PSs.length ? "this pin" : "the hole"}</small></h3><ul class="facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul></div>` : ""}
          </div>
        </div>
        ${sgItems.length ? `<div class="strat"><h3><span class="cr-ava">\u{1F916}</span>CAL\u2019S READ <em class="cr-tag">AI CADDY</em> <small>${sgAll ? "every pin on this hole \u00b7 " : ""}${sg.n} rounds \u00b7 hole average ${sg.base.toFixed(2)}</small></h3><ul>${sgItems.map((it) => `<li class="sg-${it.k}"><b>${SGK[it.k] || ""}</b>${esc(it.t.replace(/^(Approach|Surprise): (.)/, (_, k, c) => c.toUpperCase()))}</li>`).join("")}</ul></div>` : ""}`, "holep");
    }
  }

  const title = `${course.name} · Course Strategy Report${mine ? ` · ${who.label}` : ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="bar"><span>${esc(title)} · ${pages.length} pages</span><button id="pdfBtn" type="button">Save PDF</button><button id="closeBtn" type="button">Close</button></div>
${pages.join("\n")}</body></html>`;
}

const CSS = `@page{size:letter landscape;margin:0}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{.page{height:8.49in;overflow:hidden;padding:calc(0.35in + 4px) calc(0.35in + 2px)!important}}
body{font:12.5px/1.4 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#1b1f24;margin:0;background:#fff}
.page{page-break-after:always;break-after:page;padding:4px 2px;position:relative;overflow:hidden}.page:last-child{page-break-after:auto;break-after:auto}
@media screen{body{background:#eef1f5}.page{background:#fff;width:11in;height:8.5in;margin:16px auto;padding:0.35in;box-shadow:0 2px 10px rgba(0,0,0,.12)}}
.brandbar{display:flex;align-items:center;gap:10px;background:#111418;color:#fff;border-radius:6px;padding:5px 12px;margin:0 0 10px}.brandbar img{height:22px;width:auto}.brandbar span{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.brandbar em{margin-left:auto;font-style:normal;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#b9c0c8}
h1{font-size:34px;margin:2px 0 4px;letter-spacing:-.01em}h2.h{font-size:19px;margin:2px 0 8px;letter-spacing:.04em}h2 small,h3 small{font-weight:400;color:#6b7480;font-size:11px;letter-spacing:0;margin-left:6px;text-transform:none}
h3{font-size:11.5px;margin:8px 0 4px;letter-spacing:.06em;color:#4a535e}
.muted{color:#6b7480}small{font-size:10px;color:#6b7480}.small{font-size:10.5px}.pos{color:#1e8a4c}.neg{color:#c8372d}
/* (update 508) the cover: spread over the whole page */
.cover{display:flex;flex-direction:column;justify-content:space-between;height:calc(100% - 46px);gap:8px}
.chead{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end}.cover .ck{font-size:11px;letter-spacing:.24em;color:#a07c3b;font-weight:800}.cover h1{font-size:30px;text-transform:uppercase;letter-spacing:.02em;margin:2px 0 3px}.cev{font-size:13px;color:#4a535e}
.cover .scores{grid-template-columns:repeat(4,118px);gap:8px;margin:0}.cover .sc{padding:8px 12px}.cover .sc span{font-size:9.5px}.cover .sc b{font-size:30px}.cover .strip{gap:5px;margin:0}.cover .strip .t{padding:6px 8px}.cover .strip b{font-size:17px}.cover .strip em{font-size:13px}.cover .strip span,.cover .strip i{font-size:9px}
.cover .plan{gap:8px 16px}.cover .blk h3{margin:0 0 4px;font-size:11.5px}.cover .bc{padding:6px 9px}.cover .bc b{font-size:26px}.cover .bc em{font-size:11px}.cover .bc em strong{font-size:13.5px}.cover .bc small{font-size:9px;white-space:nowrap;letter-spacing:-.01em}.cover .bc span{font-size:8.5px}
.cover .cols{margin:0;gap:22px}.cover .cols h3{font-size:11.5px;margin:0 0 4px}.cover .vr{font-size:11.5px;padding:2px 0;grid-template-columns:80px 1fr 46px}.cover .vr i{height:9px}.foot{font-size:9.5px;margin:0}
.scores.s3{grid-template-columns:repeat(3,1fr);margin:4px 0 10px}.scores.s5{grid-template-columns:repeat(5,1fr);gap:10px;margin:4px 0 10px}
/* (update 509) course history: fills the page */
.hist{display:flex;flex-direction:column;height:calc(100% - 46px);gap:14px}.hist h2.h{margin:0}.hist h3{font-size:12px;margin:0 0 6px}.hist h3 small{font-weight:500;color:#6b7480;letter-spacing:0;text-transform:none;margin-left:6px}
.scores.s6{grid-template-columns:repeat(6,1fr);gap:10px;margin:0}.scores.s6 .sc{padding:10px 12px}.scores.s6 .sc b{font-size:28px}.scores.s6 .sc small{font-size:9.5px;color:#6b7480;line-height:1.25}
.hist{justify-content:space-between}.hrow{display:grid;grid-template-columns:1.25fr 1fr;gap:26px}.hrow.r2{grid-template-columns:1fr 1fr}
.hist table{width:100%;border-collapse:collapse;margin:0 0 10px}.hist th{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7480;text-align:left;padding:5px 6px;border-bottom:1.5px solid #1b1e22}.hist td{font-size:12.5px;padding:6px 6px;border-bottom:1px solid #e6e8eb}.hist .n{text-align:right}
.hcat{display:flex;flex-direction:column;gap:2px}.hk,.hc{display:grid;grid-template-columns:120px 1fr 92px 58px;gap:10px;align-items:center}.hk{font-size:9.5px;color:#6b7480;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px;border-bottom:1.5px solid #1b1e22}.hk .hlg{display:inline-flex;align-items:center;gap:4px;margin-right:10px}.hk .hlg i{width:10px;height:10px;border-radius:2px;display:inline-block}
.hc{padding:8px 0;border-bottom:1px solid #e6e8eb}.hc .l{font-size:13px;font-weight:600}.hc.tot .l{font-weight:800}.hc .v{display:flex;flex-direction:column;align-items:flex-end;font-size:12.5px;line-height:1.25}.hc .v em{font-style:normal;font-size:11px}.hc .n b{font-size:14px}
.bars{display:flex;flex-direction:column;gap:3px}.hb{position:relative;height:10px;background:#f1f2f4;border-radius:3px}.hb::after{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#9aa1a9}.hb i{position:absolute;top:0;bottom:0;border-radius:3px}
i.here{background:#a07c3b}i.else{background:#b9bec5}.scores.s5 .sc b{font-size:26px}.sc small{display:block;font-size:9.5px}.c2{grid-template-columns:1fr 1fr}.c3h{grid-template-columns:1fr 1.15fr 1fr}.c3h table td{font-size:11.5px;padding:4px 5px}
.scores{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:6px 0 4px}.sc{border:1px solid #e3e6ea;border-radius:10px;padding:12px 14px}.sc span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7480;font-weight:700}.sc b{font-size:38px;line-height:1.1}
.strip{display:grid;grid-template-columns:repeat(9,1fr);gap:6px;margin-top:4px}.strip .t{border-radius:8px;padding:6px 8px;display:flex;flex-direction:column;line-height:1.15}.strip b{font-size:18px}.strip span,.strip i{font-size:9.5px;color:#4a535e;font-style:normal}.strip em{font-style:normal;font-weight:700;font-size:13px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e3e6ea;padding:5px 6px;text-align:right}th:first-child,td:first-child{text-align:left}th{font-size:9.5px;color:#4a535e;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
table.ov td{font-size:12px;padding:5.5px 6px}td.hi{background:#4db94b;color:#fff;font-weight:700}td.good{color:#1e8a4c;font-weight:700}td.mid{color:#c27c00;font-weight:700}td.bad{color:#c8372d;font-weight:700}
.plan{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 14px}.blk h3{margin:2px 0 4px}.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.bc{border:1px solid #e3e6ea;border-radius:8px;padding:5px 8px;display:flex;flex-direction:column;line-height:1.15}.blk.pos .bc{background:#eef6ff;border-color:#cfe3fb}.blk.neg .bc{background:#fff1ef;border-color:#f6d3cd}.bc span{font-size:8px;letter-spacing:.06em;color:#6b7480}.bc b{font-size:26px;font-weight:800}.bc em{font-style:normal;font-size:10.5px}.bc em strong{font-size:13px}.bc small{font-size:9px}
.cols{display:grid;gap:18px;margin-top:6px}.c3{grid-template-columns:1fr 1fr 1fr}
.vr{display:grid;grid-template-columns:72px 1fr 44px;gap:6px;align-items:center;font-size:11px;padding:2px 0}.vr i{height:9px;background:#f1f3f5;border-radius:5px;overflow:hidden;display:block}.vr i b{display:block;height:100%;border-radius:5px}.vr b.neg{background:#e8685a}.vr b.pos{background:#2fbf71}.vr b.gold{background:#d4b483}.vr b.gray{background:#b0b6bd}.vr em{font-style:normal;text-align:right;font-weight:700}
.hh h2{margin:0 0 6px}.hole{display:grid;grid-template-columns:1fr 3.5in;gap:16px;height:calc(100% - 80px)}.hole.tall{grid-template-columns:1fr 3.6in}
.maps{display:grid;gap:10px;align-content:start}.maps.n2{grid-template-columns:1fr 1fr}.hole:not(.tall) .maps.n2{grid-template-columns:1fr}.maps figure{margin:0}.maps figcaption{font-size:10px;font-weight:800;letter-spacing:.08em;color:#4a535e;margin:0 0 3px}.maps img{display:block;width:100%;max-height:6.1in;object-fit:contain;border-radius:6px;background:#0c0c0e;max-height:5.75in}.hole:not(.tall) .maps.n2 img{max-height:2.8in}
.lg{grid-column:1/-1;display:flex;align-items:center;gap:6px;font-size:10px}.lg i{width:120px;height:8px;border-radius:4px;background:linear-gradient(90deg,#2166ac,#92c5de,#f7f7f7,#f4a582,#b2182b);display:inline-block}.lg small{margin-left:8px}
.side h3:first-child{margin-top:0}
/* (update 510) the side panel: its sections spread down the page */
.holep .side{display:flex;flex-direction:column;justify-content:space-between;gap:14px;height:100%;min-height:0}.holep .side .sec h3{margin:0 0 7px}.holep .side .ud{gap:6px}.holep .side .u{padding:7px 4px}.holep .side .u b{font-size:16px}.holep .side .tee>div{padding-top:8px;padding-bottom:8px}.holep .side .facts li{margin:0 0 5px;font-size:12px}.mix{display:grid;grid-template-columns:52px 1fr 38px;gap:6px;align-items:center;margin:3px 0}.mix span{font-weight:700;font-size:11px;line-height:1.05}.mix span small{display:block;font-weight:400;font-size:8.5px}.mix i{display:flex;height:15px;border-radius:4px;overflow:hidden;background:#f1f3f5}.mix i b{display:flex;align-items:center;justify-content:center;font-size:8.5px;color:#111}.mix em{font-style:normal;font-weight:800;text-align:right}
table.pins td{padding:3px 4px;font-size:11px}.tee{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.tee div{border:1px solid #e3e6ea;border-radius:6px;padding:4px 6px;text-align:center}.tee span{display:block;font-size:9px;color:#6b7480}.tee b{font-size:14px}.tee .worse{background:#fff1ef;border-color:#e8685a}.tee .worse b{color:#c8372d}
.ud{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.u{border:1px solid #e3e6ea;border-radius:6px;padding:3px 4px;text-align:center;line-height:1.1}.u span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.03em;color:#6b7480}.u b{font-size:14px}.u small{display:block;font-size:8px}.u.good b{color:#1e8a4c}.u.mid b{color:#c27c00}.u.bad b{color:#c8372d}.u.gr{display:flex;align-items:center;justify-content:center;border:0}.u em{display:block;font-style:normal;font-size:8.5px;line-height:1.25;color:#4a535e;white-space:nowrap}.u em small{display:inline;font-size:7.5px}.u em small{font-size:7.5px}.u em.few,.u.few b{font-style:italic;opacity:.8}.u.gr i{width:34px;height:24px;border-radius:50%;background:radial-gradient(circle at 45% 40%,#7fcf6a,#3e8e3a);display:block}
/* (update 588) the strategy band under a hole's maps */
.hole.st{height:calc(100% - 80px - 1.3in)}.hole.st .maps img{max-height:4.45in}.hole.st:not(.tall) .maps.n2 img{max-height:2.15in}.holep .hole.st .side{gap:6px}
.strat{margin-top:8px;border:1px solid #e8dcc6;background:#fbf8f2;border-radius:8px;padding:6px 10px;height:calc(1.3in - 8px);overflow:hidden}.strat h3{margin:0 0 4px;color:#a07c3b;display:flex;align-items:center;gap:6px}.strat h3 small{margin-left:4px}.cr-ava{width:17px;height:17px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#f0d9b0,#a07c3b);display:inline-grid;place-items:center;font-size:10px}.cr-tag{font-style:normal;font-size:7.5px;font-weight:800;letter-spacing:.12em;padding:2px 6px;border-radius:999px;background:#d4b483;color:#111}
.strat ul{list-style:none;margin:0;padding:0;columns:2;column-gap:18px}.strat li{break-inside:avoid;font-size:10px;line-height:1.3;margin:0 0 3px}.strat li b{font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:#6b7480;margin-right:5px}.strat li.sg-surprise b{color:#a07c3b}
ul.facts{margin:2px 0;padding-left:15px}ul.facts li{font-size:11px;margin:2px 0}
.bar{position:sticky;top:0;background:#1b1f24;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:12px;z-index:2}.bar button{font:inherit;padding:5px 12px;border-radius:6px;border:0;background:#fff;color:#1b1f24;font-weight:600;cursor:pointer}@media print{.bar{display:none}}`;
