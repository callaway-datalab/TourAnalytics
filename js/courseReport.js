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
import { playerTrails, SG_B, ATT_B } from "./courseShots.js";

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
    win.document.open(); win.document.write(html.replace(' onclick="print()"', "")); win.document.close();
    const wire = () => {
      const b = win.document.getElementById("printBtn"); if (b && !b.dataset.wired) { b.dataset.wired = "1"; b.addEventListener("click", () => { win.focus(); win.print(); }); }
      const c = win.document.getElementById("closeBtn"); if (c && !c.dataset.wired) { c.dataset.wired = "1"; c.addEventListener("click", () => win.close()); }
    };
    wire(); win.addEventListener("load", wire);
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
  const raw = await heatData(meta), data = withMerges(meta, raw), I = data?.insights;
  if (!I) throw new Error("this course has no insights yet: rebuild its maps on Upload Data");
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

  // 1. the cover
  const tone = (v) => { if (v == null) return "#f1f3f5"; const t = Math.max(-1, Math.min(1, v / 0.35)); return t < 0 ? `rgba(61,156,255,${0.18 + 0.55 * -t})` : `rgba(255,${Math.round(159 - 90 * t)},${Math.round(67 - 9 * t)},${0.18 + 0.6 * t})`; };
  page("Course strategy report", `<div class="cover">
    <div class="ck">COURSE STRATEGY REPORT</div><h1>${esc(course.name)}</h1><div class="cev">${esc(events)}</div>
    <div class="cwho">${mine ? `Prepared for <b>${esc(who.label)}</b>` : who ? `${esc(who.label)} has no shots at this course: <b>field averages</b>` : "<b>Field averages</b>"}</div>
    <div class="scores">${[["Make the cut", av("cut"), "#c8372d"], ["Top 25", av("top25"), "#e07a1f"], ["Top 10", av("top10"), "#c99a00"], ["Win", av("win"), "#1e8a4c"]].filter(([, v]) => v != null).map(([l, v, c]) => `<div class="sc"><span>${l}</span><b style="color:${c}">${toPar(v)}</b></div>`).join("")}</div>
    <div class="muted small">Scores to beat for the week, to par: the average of ${ev.length} ${ev.length === 1 ? "event" : "events"} here.</div>
    <h3>EVERY HOLE <small>${mine ? `${esc(first)}’s` : "the field’s"} scoring to par (blue under, orange over), and how hard it plays</small></h3>
    <div class="strip">${HF.map((x) => { const v = x.me?.n ? x.me.sum / x.me.n : null; return `<div class="t" style="background:${tone(v)}"><b>${x.h}</b><span>Par ${x.par}</span><em>${v == null ? "—" : sgn(v)}</em><i>${ord(x.hcp)}</i></div>`; }).join("")}</div>
  </div>`, "cov");

  // 2. the course overview: a row a hole
  const q75 = (k) => { const v = HF.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length >= 4 ? v[Math.floor(0.75 * (v.length - 1))] : Infinity; };
  const cut = { fwy: q75("fwy"), gir: q75("gir"), go: q75("go") };
  const vcell = (r, k) => `<td class="${r[k] != null && r[k] >= cut[k] && r[k] > 0 ? "hi" : ""}">${r[k] == null ? "" : r[k].toFixed(2)}</td>`;
  const udAll = (X) => { const t = Object.values(X.ud || {}).flatMap((o) => Object.values(o)).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]); return t[0] ? Math.round((100 * t[1]) / t[0]) : null; };
  page("Course overview", `<h2 class="h">COURSE OVERVIEW <small>${subjLabel} against the Top 10 finishers</small></h2>
    <table class="ov"><thead><tr><th>Hole</th><th>Par</th><th>Yds</th><th>Hcp</th><th>Avg score</th><th>Top 10</th><th>Birdie+</th><th>Bogey+</th><th>Hit Fwy</th><th>Hit GIR</th><th>Go for it</th><th>Worse miss</th><th>Up &amp; down</th></tr></thead><tbody>
    ${HF.map((x) => { const a = avgOf(x.me, x.par), t = avgOf(x.top, x.par), u = udAll(I.holes[x.h]); return `<tr><td><b>${x.h}</b></td><td>${x.par}</td><td>${x.yds || "—"}</td><td>${x.hcp}</td><td class="${a != null && t != null ? (a - t > 0.1 ? "neg" : a - t < -0.05 ? "pos" : "") : ""}"><b>${a == null ? "—" : a.toFixed(2)}</b></td><td>${t == null ? "—" : t.toFixed(2)}</td><td>${Math.round(x.birdie)}%</td><td>${Math.round(x.bogey)}%</td>${vcell(x, "fwy")}${vcell(x, "gir")}${vcell(x, "go")}<td>${x.miss && x.miss.by >= 0.05 ? `${x.miss.worse === "left" ? "Left" : "Right"} <small>+${x.miss.by.toFixed(2)}</small>` : "—"}</td><td class="${udCls(u)}">${u == null ? "—" : `${u}%`}</td></tr>`; }).join("")}
    </tbody></table>
    <p class="muted small">Hcp: 1 is the hardest hole here. Hit Fwy / Hit GIR: how much higher the scoring average is for those who missed the fairway / the green in regulation (shaded: the most important holes). Go for it: what going for it (inside 30 yds) saves on laying up (30–100 yds). Worse miss: the costlier side off the tee. Up &amp; down: approaches that missed the green, got up and down.</p>`);

  // 3. the game plan
  const top3 = (list, key, min = -Infinity) => list.filter((x) => x[key] != null && x[key] > min).sort((a, b) => b[key] - a[key]).slice(0, 3);
  const agg = HF.map((x) => ({ ...x, ix: x.birdie - x.bogey }));
  const blocks = [
    ["ATTACK", "pos", top3(agg, "ix", 0), (x) => [`${Math.round(x.birdie)}%`, "birdies", `${Math.round(x.bogey)}% bogeys`]],
    ["PLAY SAFE", "neg", agg.filter((x) => x.ix < 0).sort((a, b) => a.ix - b.ix).slice(0, 3), (x) => [`${Math.round(x.bogey)}%`, "bogeys", `${Math.round(x.birdie)}% birdies`]],
    ["FAIRWAYS MATTER", "", top3(HF, "fwy", 0.05), (x) => [x.fwy.toFixed(2), "strokes", "missing the fairway"]],
    ["GREENS MATTER", "", top3(HF, "gir", 0.05), (x) => [x.gir.toFixed(2), "strokes", "missing the green"]],
    ["GO FOR IT", "pos", top3(HF, "go", 0.05), (x) => [x.go.toFixed(2), "strokes", "saved going for it"]],
    ["TEE MISS TO AVOID", "neg", HF.filter((x) => x.miss && x.miss.by >= 0.1).sort((a, b) => b.miss.by - a.miss.by).slice(0, 3), (x) => [x.miss.worse === "left" ? "Left" : "Right", "miss", `+${x.miss.by.toFixed(2)} vs the other side`]],
  ].filter(([, , l]) => l.length);
  const holesV = HF.map((x) => { const a = x.me?.n ? x.me.sum / x.me.n : null, t = x.top?.n ? x.top.sum / x.top.n : null; return { h: x.h, v: a != null && t != null ? t - a : null }; }).filter((x) => x.v != null);
  const dists = SG_B.map((b) => { const me = S.rounds ? (S.sg[b] || 0) / S.rounds : null, tp = S.topRounds ? (S.topSg[b] || 0) / S.topRounds : null; return { b, v: me != null && tp != null ? me - tp : null }; }).filter((x) => x.v != null && (S.sg[x.b] != null || S.topSg[x.b] != null));
  const bars = (list, k, n, worst) => { const l = list.filter((x) => (worst ? x.v < -0.005 : x.v > 0.005)).sort((a, b) => (worst ? a.v - b.v : b.v - a.v)).slice(0, n), m = Math.max(...list.map((x) => Math.abs(x.v)), 0.01); return l.map((x) => `<div class="vr"><span>${esc(k(x))}</span><i><b class="${worst ? "neg" : "pos"}" style="width:${(Math.abs(x.v) / m) * 100}%"></b></i><em class="${worst ? "neg" : "pos"}">${sgn(x.v)}</em></div>`).join("") || `<p class="muted small">None</p>`; };
  const tour = {}; for (const c of all) for (const [b, n] of Object.entries(c.attempts || {})) tour[b] = (tour[b] || 0) + n;
  const tt = Object.values(tour).reduce((a, b) => a + b, 0), st2 = Object.values(S.attempts).reduce((a, b) => a + b, 0);
  const faced = tt && st2 && all.length >= 2 ? ATT_B.map((b) => ({ b, d: (100 * (S.attempts[b] || 0)) / st2 - (100 * (tour[b] || 0)) / tt })).filter((r) => Math.abs(r.d) >= 0.5) : [];
  page("Game plan", `<h2 class="h">GAME PLAN <small>${subjLabel}</small></h2>
    <div class="plan">${blocks.map(([t, tn, l, val]) => `<div class="blk ${tn}"><h3>${t}</h3><div class="cards3">${l.map((x) => { const [big, unit, nt] = val(x); return `<div class="bc"><span>HOLE · PAR ${x.par}</span><b>${x.h}</b><em><strong>${big}</strong> ${unit}</em><small>${nt}</small></div>`; }).join("")}</div></div>`).join("")}</div>
    <div class="cols c3">
      <div><h3>AGAINST THE TOP 10 · HOLES <small>where they gain most</small></h3>${bars(holesV.map((x) => ({ ...x, k: `Hole ${x.h}` })), (x) => x.k, 5, true)}</div>
      <div><h3>AGAINST THE TOP 10 · SKILLS <small>where they gain most, a round</small></h3>${bars(dists, (x) => x.b, 5, true)}</div>
      <div><h3>SHOTS YOU’LL FACE <small>against an average course</small></h3>${faced.length ? faced.sort((a, b) => b.d - a.d).slice(0, 6).map((r) => `<div class="vr"><span>${esc(r.b)}</span><i><b class="${r.d > 0 ? "gold" : "gray"}" style="width:${Math.min(100, Math.abs(r.d) * 12)}%"></b></i><em>${r.d > 0 ? "+" : "−"}${Math.abs(r.d).toFixed(1)}%</em></div>`).join("") : `<p class="muted small">About the same mix as an average course.</p>`}</div>
    </div>`);

  // 4. a page a hole: its heatmaps, scoring, pins, tee misses, up & down
  const mixRow = (label, o, par) => { if (!o?.n) return ""; const ks = ["e", "b", "p", "g"].filter((k) => o[k] > 0); return `<div class="mix"><span>${esc(label)}<small>${o.n} rds</small></span><i>${ks.map((k) => { const p = (100 * o[k]) / o.n; return `<b style="width:${p}%;background:${SCC[k]}">${p >= 14 ? `${Math.round(p)}%` : ""}</b>`; }).join("")}</i><em>${(par + o.sum / o.n).toFixed(2)}</em></div>`; };
  for (const [hi, x] of HF.entries()) {
    onStatus(`Drawing hole ${x.h} (${hi + 1} of ${HF.length})…`);
    await new Promise((r) => setTimeout(r, 0));
    const X = I.holes[x.h], H = data.holes?.[x.h] || { pins: {} }, hm = meta.holes?.[x.h], par = x.par;
    const pins = pinsOn(meta, data, x.h), pinAvg = (p) => { const h = H.pins?.[p]?.hist || {}; let t = 0, c = 0; for (const [k, v] of Object.entries(h)) { t += Number(k) * v; c += v; } return c ? { avg: par + t / c, n: c } : null; };
    // the pin most played, for the maps
    const main = [...pins].sort((a, b) => (pinAvg(b)?.n || 0) - (pinAvg(a)?.n || 0))[0];
    const maps = [];
    if (hm && main) {
      try {
        const url = await heatImage(meta, x.h), img = await loadImg(url), P = H.pins[main], hasShot = !!P?.byShot;
        const ks = hasShot ? (par <= 3 ? [1] : [1, par - 2]) : [0];
        for (const k of ks) { const m = await holeMap(img, hm, H, P, par, k, `${meta.id}|${x.h}`); if (m) maps.push({ ...m, cap: k === 0 ? "EVERY SHOT" : k === 1 && par >= 4 ? "WHERE TEE SHOTS FINISH" : "WHERE APPROACHES FINISH" }); }
      } catch (err) { console.warn("hole map", x.h, err); }
    }
    const L = X.drive?.L, C = X.drive?.C, R = X.drive?.R, okD = (o) => o && o[0] >= 5, dAvg = (o) => (okD(o) ? par + o[1] / o[0] : null);
    const worse = okD(L) && okD(R) ? (dAvg(L) > dAvg(R) ? "L" : "R") : null;
    const U = X.ud || {}, cell = (side) => { const o = U[side] || {}, t = Object.values(o).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]), p = t[0] >= 3 ? Math.round((100 * t[1]) / t[0]) : null; return `<div class="u ${udCls(p)}"><span>${side.replace("-", " ")}</span><b>${p == null ? "—" : `${p}%`}</b><small>${t[0] ? `${t[0]} att` : ""}</small></div>`; };
    const facts = [];
    if (x.fwy != null) facts.push(`<b>Fairway</b> missing it costs ${x.fwy.toFixed(2)}`);
    if (x.gir != null) facts.push(`<b>Green in regulation</b> missing it costs ${x.gir.toFixed(2)}`);
    if (x.go != null) facts.push(`<b>Going for it</b> ${x.go >= 0 ? `saves ${x.go.toFixed(2)}` : `costs ${Math.abs(x.go).toFixed(2)}`} on laying up`);
    if (x.widths.length) facts.push(`<b>Fairway width</b> about ${Math.min(...x.widths.map((w) => w[1]))}–${Math.max(...x.widths.map((w) => w[1]))} yds where drives land`);
    const tallMaps = maps.length && maps.every((m) => m.tall);
    page(`Hole ${x.h}`, `<div class="hh"><h2 class="h">HOLE ${x.h} <small>Par ${par}${x.yds ? ` · ${x.yds} yds` : ""} · ${ord(x.hcp)} hardest</small></h2></div>
      <div class="hole ${tallMaps ? "tall" : ""}">
        <div class="maps n${maps.length || 1}">${maps.length ? maps.map((m) => `<figure><figcaption>${m.cap}</figcaption><img src="${m.url}" alt=""></figure>`).join("") : `<p class="muted">No hole image for this hole yet.</p>`}
          ${maps.length ? `<div class="lg"><span>Birdie</span><i></i><span>Bogey</span><small>The hole score from each spot · ${esc(pinLabel(meta, x.h, main))} pin</small></div>` : ""}</div>
        <div class="side">
          <h3>SCORING</h3>${mixRow(mine ? first : "Field", x.me, par)}${mine ? mixRow("Field", x.field, par) : ""}${mixRow("Top 10", x.top, par)}
          ${pins.length > 1 ? `<h3>PINS <small>hardest first</small></h3><table class="pins">${pins.map((p) => [p, pinAvg(p)]).filter(([, a]) => a).sort((a, b) => b[1].avg - a[1].avg).map(([p, a]) => `<tr><td>${esc(pinLabel(meta, x.h, p))}</td><td>${a.avg.toFixed(2)}</td><td><small>${a.n} rds</small></td></tr>`).join("")}</table>` : ""}
          ${par >= 4 && (okD(L) || okD(R)) ? `<h3>OFF THE TEE <small>average score after</small></h3><div class="tee">${[["L", "Left miss", dAvg(L)], ["C", "Fairway", dAvg(C)], ["R", "Right miss", dAvg(R)]].map(([k, l, v]) => `<div class="${worse === k ? "worse" : ""}"><span>${l}</span><b>${v == null ? "—" : v.toFixed(2)}</b></div>`).join("")}</div>` : ""}
          ${Object.keys(U).length ? `<h3>UP &amp; DOWN BY MISS <small>within 30 yds</small></h3><div class="ud">${cell("Long-Left")}${cell("Long")}${cell("Long-Right")}${cell("Left")}<div class="u gr"><i></i></div>${cell("Right")}${cell("Short-Left")}${cell("Short")}${cell("Short-Right")}</div>` : ""}
          ${facts.length ? `<h3>WHAT MATTERS</h3><ul class="facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>` : ""}
        </div>
      </div>`, "holep");
  }

  const title = `${course.name} · Course Strategy Report${mine ? ` · ${who.label}` : ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="bar"><span>${esc(title)} · ${pages.length} pages</span><button id="printBtn" onclick="print()">Print or save as PDF</button><button id="closeBtn" onclick="window.close()">Close</button></div>
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
.cover .ck{font-size:12px;letter-spacing:.24em;color:#a07c3b;font-weight:800;margin-top:14px}.cover h1{font-size:40px;text-transform:uppercase;letter-spacing:.02em}.cev{font-size:15px;color:#4a535e}.cwho{margin:10px 0 14px;font-size:15px}
.scores{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:6px 0 4px}.sc{border:1px solid #e3e6ea;border-radius:10px;padding:12px 14px}.sc span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7480;font-weight:700}.sc b{font-size:38px;line-height:1.1}
.strip{display:grid;grid-template-columns:repeat(9,1fr);gap:6px;margin-top:4px}.strip .t{border-radius:8px;padding:6px 8px;display:flex;flex-direction:column;line-height:1.15}.strip b{font-size:18px}.strip span,.strip i{font-size:9.5px;color:#4a535e;font-style:normal}.strip em{font-style:normal;font-weight:700;font-size:13px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e3e6ea;padding:5px 6px;text-align:right}th:first-child,td:first-child{text-align:left}th{font-size:9.5px;color:#4a535e;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
table.ov td{font-size:12px;padding:5.5px 6px}td.hi{background:#4db94b;color:#fff;font-weight:700}td.good{color:#1e8a4c;font-weight:700}td.mid{color:#c27c00;font-weight:700}td.bad{color:#c8372d;font-weight:700}
.plan{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 14px}.blk h3{margin:2px 0 4px}.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.bc{border:1px solid #e3e6ea;border-radius:8px;padding:5px 8px;display:flex;flex-direction:column;line-height:1.15}.blk.pos .bc{background:#eef6ff;border-color:#cfe3fb}.blk.neg .bc{background:#fff1ef;border-color:#f6d3cd}.bc span{font-size:8px;letter-spacing:.06em;color:#6b7480}.bc b{font-size:26px;font-weight:800}.bc em{font-style:normal;font-size:10.5px}.bc em strong{font-size:13px}.bc small{font-size:9px}
.cols{display:grid;gap:18px;margin-top:6px}.c3{grid-template-columns:1fr 1fr 1fr}
.vr{display:grid;grid-template-columns:72px 1fr 44px;gap:6px;align-items:center;font-size:11px;padding:2px 0}.vr i{height:9px;background:#f1f3f5;border-radius:5px;overflow:hidden;display:block}.vr i b{display:block;height:100%;border-radius:5px}.vr b.neg{background:#e8685a}.vr b.pos{background:#2fbf71}.vr b.gold{background:#d4b483}.vr b.gray{background:#b0b6bd}.vr em{font-style:normal;text-align:right;font-weight:700}
.hh h2{margin:0 0 6px}.hole{display:grid;grid-template-columns:1fr 3.5in;gap:16px;height:calc(100% - 70px)}.hole.tall{grid-template-columns:1fr 3.6in}
.maps{display:grid;gap:10px;align-content:start}.maps.n2{grid-template-columns:1fr 1fr}.hole:not(.tall) .maps.n2{grid-template-columns:1fr}.maps figure{margin:0}.maps figcaption{font-size:10px;font-weight:800;letter-spacing:.08em;color:#4a535e;margin:0 0 3px}.maps img{display:block;width:100%;max-height:6.1in;object-fit:contain;border-radius:6px;background:#0c0c0e;max-height:5.9in}.hole:not(.tall) .maps.n2 img{max-height:2.8in}
.lg{grid-column:1/-1;display:flex;align-items:center;gap:6px;font-size:10px}.lg i{width:120px;height:8px;border-radius:4px;background:linear-gradient(90deg,#2166ac,#92c5de,#f7f7f7,#f4a582,#b2182b);display:inline-block}.lg small{margin-left:8px}
.side h3:first-child{margin-top:0}.mix{display:grid;grid-template-columns:52px 1fr 38px;gap:6px;align-items:center;margin:3px 0}.mix span{font-weight:700;font-size:11px;line-height:1.05}.mix span small{display:block;font-weight:400;font-size:8.5px}.mix i{display:flex;height:15px;border-radius:4px;overflow:hidden;background:#f1f3f5}.mix i b{display:flex;align-items:center;justify-content:center;font-size:8.5px;color:#111}.mix em{font-style:normal;font-weight:800;text-align:right}
table.pins td{padding:3px 4px;font-size:11px}.tee{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.tee div{border:1px solid #e3e6ea;border-radius:6px;padding:4px 6px;text-align:center}.tee span{display:block;font-size:9px;color:#6b7480}.tee b{font-size:14px}.tee .worse{background:#fff1ef;border-color:#e8685a}.tee .worse b{color:#c8372d}
.ud{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.u{border:1px solid #e3e6ea;border-radius:6px;padding:3px 4px;text-align:center;line-height:1.1}.u span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.03em;color:#6b7480}.u b{font-size:14px}.u small{display:block;font-size:8px}.u.good b{color:#1e8a4c}.u.mid b{color:#c27c00}.u.bad b{color:#c8372d}.u.gr{display:flex;align-items:center;justify-content:center;border:0}.u.gr i{width:34px;height:24px;border-radius:50%;background:radial-gradient(circle at 45% 40%,#7fcf6a,#3e8e3a);display:block}
ul.facts{margin:2px 0;padding-left:15px}ul.facts li{font-size:11px;margin:2px 0}
.bar{position:sticky;top:0;background:#1b1f24;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:12px;z-index:2}.bar button{font:inherit;padding:5px 12px;border-radius:6px;border:0;background:#fff;color:#1b1f24;font-weight:600;cursor:pointer}@media print{.bar{display:none}}`;
