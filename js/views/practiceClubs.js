/*
 * Practice › My Clubs (update 138): each club's stock pattern — carry, how much it varies, the miss and how wide —
 * from launch monitor files (TrackMan, GCQuad, anything with Club / Carry / Side columns) or shots you enter,
 * with the gaps between clubs. The patterns also drive the aim maps elsewhere in Practice.
 */
import { el, mount, confirmAction } from "../ui.js";
import { readLaunchMonitor, resultFromSpeech } from "../practice/analysis.js";
import { CLUB_LIST, sortClubs, normClub, bagPatterns, clubStats, gapping } from "../practice/clubs.js";
import { SpeechRec, sayKids } from "./practiceShot.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, kids = []) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); for (const k of [].concat(kids)) if (k) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); return n; };
const r0 = (v) => (v == null ? "—" : String(Math.round(v)));
const r1 = (v) => (v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1));
const lr = (v) => (v == null ? "—" : Math.abs(v) < 0.5 ? "on line" : `${r1(Math.abs(v))} ${v < 0 ? "L" : "R"}`);
const COMMON = ["Driver", "3w", "5w", "4H", "4i", "5i", "6i", "7i", "8i", "9i", "PW", "50°", "54°", "58°"];

let picked = null; // the club open in the detail panel

export async function render(ctx) {
  const v = ctx.view;
  if (v.name === "bagEntry") return drawEntry(ctx, v);
  if (v.name === "bagImport") return drawImport(ctx, v);
  const pats = bagPatterns(ctx.sessions);
  const clubs = sortClubs(Object.keys(pats));
  const file = fileButton(ctx);
  const hit = el("button", { type: "button", class: "btn" }, "＋  Hit a club");
  hit.addEventListener("click", () => ctx.go({ name: "bagEntry", club: null, shots: [] }));
  const hero = el("section", { class: "panel pr-hero" }, [
    el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "My Clubs"),
      el("p", { class: "muted pr-lede" }, "Every club's stock shot: how far it carries, how much that varies, which way it misses and how wide, and the gaps through the bag. Once a club has 8 shots, the aim maps in Practice use its real pattern.")]),
    el("div", { class: "pr-row pr-wrap-row" }, [hit, file]),
  ]);
  if (!clubs.length) {
    mount(ctx.body, [hero, el("section", { class: "panel pr-empty" }, [el("h2", {}, "How it works"), el("ol", {}, [
      "Load a CSV export from TrackMan, GCQuad (FSX) or most launch monitors: Club, Carry, Total and Side (or Offline) columns. A file can hold every club.",
      "No launch monitor? Tap “Hit a club”, pick the club, and type or say each shot: “152, 6 left”.",
      "Each club's carry, its spread, its miss and the gaps between clubs show here.",
      "The aim maps on approach and tee shots switch to your own pattern for the club you'd hit.",
    ].map((t) => el("li", {}, t)))])]);
    return;
  }
  if (!picked || !pats[picked]) picked = clubs[0];
  const detail = el("div");
  const drawDetail = () => mount(detail, clubDetail(ctx, picked, pats[picked]));
  const table = el("div", { class: "table-scroll" }, el("table", { class: "plain pr-bag" }, [
    el("thead", {}, el("tr", {}, ["Club", "Shots", "Carry", "Carry range", "Total", "Miss", "80% within", "Ball", "Spin"].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
    el("tbody", {}, clubs.map((c) => {
      const p = pats[c];
      const tr = el("tr", { class: c === picked ? "on" : "", tabindex: 0 }, [el("td", {}, el("strong", {}, c)), el("td", { class: "num" }, String(p.n)), el("td", { class: "num" }, r0(p.carry)), el("td", { class: "num" }, p.n >= 3 ? `${r0(p.carryLo)}–${r0(p.carryHi)}` : "—"),
        el("td", { class: "num" }, r0(p.total)), el("td", { class: "num" }, lr(p.offline)), el("td", { class: "num" }, p.width80 != null && p.n >= 3 ? `±${r0(p.width80)} yds` : "—"), el("td", { class: "num" }, p.ball ? `${r0(p.ball)} mph` : "—"), el("td", { class: "num" }, p.spin ? r0(p.spin) : "—")]);
      const open = () => { picked = c; table.querySelectorAll("tr.on").forEach((x) => x.classList.remove("on")); tr.classList.add("on"); drawDetail(); detail.scrollIntoView({ behavior: "smooth", block: "start" }); };
      tr.addEventListener("click", open); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    })),
  ]));
  drawDetail();
  const gaps = gapping(pats);
  mount(ctx.body, [
    hero,
    el("section", { class: "panel" }, [el("h2", {}, "Your bag"), el("p", { class: "muted small" }, "Carry range: the middle 80% of shots. Miss: where they finish on average. 80% within: how far either side of that line 80% of shots finish. Tap a club for its pattern."), table]),
    detail,
    el("section", { class: "panel" }, [el("h2", {}, "Gapping"), gapSvg(pats, clubs), gaps.some((g) => g.note) ? el("ul", { class: "pr-gap-notes" }, gaps.filter((g) => g.note).map((g) => el("li", { class: g.note === "big gap" ? "warn" : "info" }, `${g.from} → ${g.to}: ${r0(g.gap)} yds ${g.note === "big gap" ? "— a big gap; a club (or a partial shot) to cover it?" : "— these two overlap"}`))) : el("p", { class: "muted small" }, "No big gaps or overlaps.")]),
    sessionsPanel(ctx),
  ]);
}

/* ---------------------------------------------- one club ---------------------------------------------- */
function clubDetail(ctx, club, p) {
  const shots = p.shots.slice(-60);
  const lines = [
    `Carries ${r0(p.carry)} yds on average${p.n >= 3 ? `; 80% between ${r0(p.carryLo)} and ${r0(p.carryHi)}` : ""}${p.total && Math.abs(p.total - p.carry) >= 2 ? `, and runs out to ${r0(p.total)}` : ""}.`,
    p.n >= 3 ? `Finishes ${Math.abs(p.offline) < 0.5 ? "on your line" : `${r1(Math.abs(p.offline))} yds ${p.offline < 0 ? "left" : "right"}`} on average; 80% within ${r0(p.width80)} yds either side of that. ${Math.round(p.leftPct)}% finish left, ${Math.round(p.rightPct)}% right.` : "Hit a few more for its pattern.",
    p.n >= 8 ? `The aim maps use this pattern for shots of about ${r0(p.carry - 15)}–${r0(p.carry + 15)} yds.` : `${8 - p.n} more shot${8 - p.n === 1 ? "" : "s"} and the aim maps start using it.`,
  ];
  const more = el("button", { type: "button", class: "btn ghost" }, `＋  Hit more ${club}`);
  more.addEventListener("click", () => ctx.go({ name: "bagEntry", club, shots: [] }));
  return el("section", { class: "panel pr-club" }, [
    el("div", { class: "pr-sub" }, [el("h2", {}, `${club} · stock shot`), more]),
    el("div", { class: "pr-club-grid" }, [
      el("div", { class: "pr-pat" }, dispersionSvg(shots, p)),
      el("div", {}, [
        el("div", { class: "pr-tiles" }, [
          tileEl("Carry", r0(p.carry), p.n >= 3 ? `±${r0(p.carrySd)} (1 sd)` : ""), tileEl("Total", r0(p.total)), tileEl("Miss", lr(p.offline)), tileEl("80% within", p.n >= 3 ? `±${r0(p.width80)}` : "—", "yds of the line"),
          p.ball ? tileEl("Ball speed", `${r0(p.ball)}`, "mph") : null, p.spin ? tileEl("Spin", r0(p.spin), "rpm") : null, p.launch ? tileEl("Launch", `${r1(p.launch)}°`) : null, p.height ? tileEl("Height", r0(p.height)) : null,
        ].filter(Boolean)),
        el("ul", { class: "pr-stock" }, lines.map((t) => el("li", {}, t))),
      ]),
    ]),
  ]);
}
const tileEl = (k, v, sub = "") => el("div", { class: "pr-tile" }, [el("span", { class: "pr-tile-k" }, k), el("strong", {}, v), sub ? el("span", { class: "pr-tile-s" }, sub) : null]);

/** The club's shots round its average: left/right across, carry up; rings at 1 and 2 standard deviations. */
function dispersionSvg(shots, p) {
  const sx = Math.max(3, p.offlineSd || 5), sy = Math.max(3, p.carrySd || 5);
  const R = Math.max(12, Math.ceil(Math.max(2.4 * sx, 2.4 * sy, ...shots.map((s) => Math.max(Math.abs(s.offline - p.offline), Math.abs(s.carry - p.carry)))) / 5) * 5 + 3);
  const svg = svgEl("svg", { viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`, class: "pr-svg pr-scatter", role: "img", "aria-label": "Where this club's shots finish" });
  svg.appendChild(svgEl("rect", { x: -R, y: -R, width: 2 * R, height: 2 * R, fill: "#141416" }));
  // the target line (where you aim) and the carry yardage lines
  svg.appendChild(svgEl("line", { x1: -p.offline, x2: -p.offline, y1: -R, y2: R, stroke: "rgba(200,169,126,0.45)", "stroke-width": R / 160, "stroke-dasharray": `${R / 40} ${R / 40}` }));
  for (let d = -Math.floor(R / 5) * 5; d <= R; d += 5) {
    svg.appendChild(svgEl("line", { x1: -R, x2: R, y1: -d, y2: -d, stroke: "rgba(255,255,255,0.06)", "stroke-width": R / 250 }));
    if (d % 10 === 0) svg.appendChild(svgEl("text", { x: -R + R / 40, y: -d - R / 80, class: "pr-yd", style: `font-size:${R / 14}px` }, String(Math.round(p.carry + d))));
  }
  for (const k of [2, 1]) svg.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx: k * sx, ry: k * sy, fill: k === 1 ? "rgba(200,169,126,0.14)" : "rgba(200,169,126,0.06)", stroke: "rgba(200,169,126,0.6)", "stroke-width": R / 200 }));
  for (const s of shots) svg.appendChild(svgEl("circle", { cx: Math.max(-R, Math.min(R, s.offline - p.offline)), cy: Math.max(-R, Math.min(R, -(s.carry - p.carry))), r: R / 45, fill: "rgba(245,245,247,0.85)" }));
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: R / 70, fill: "#d4b483" }));
  svg.appendChild(svgEl("text", { x: R - R / 40, y: R - R / 30, class: "pr-yd", "text-anchor": "end", style: `font-size:${R / 15}px` }, "gold line: your target"));
  return svg;
}

/** Carry for every club: a bar to the average, the middle-80% range, gaps marked. */
function gapSvg(pats, clubs) {
  const list = clubs.filter((c) => pats[c].n >= 1).sort((a, b) => pats[b].carry - pats[a].carry);
  const max = Math.ceil(Math.max(...list.map((c) => pats[c].carryHi || pats[c].carry)) / 25) * 25 + 10;
  const W = 340, rowH = 18, pad = 46, H = list.length * rowH + 22;
  const X = (v) => pad + (v / max) * (W - pad - 30);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "pr-svg pr-gapsvg", role: "img", "aria-label": "Carry by club" });
  for (let v = 50; v <= max; v += 50) {
    svg.appendChild(svgEl("line", { x1: X(v), x2: X(v), y1: 0, y2: H - 16, stroke: "rgba(255,255,255,0.07)", "stroke-width": 0.6 }));
    svg.appendChild(svgEl("text", { x: X(v), y: H - 4, class: "pr-yd", "text-anchor": "middle" }, String(v)));
  }
  list.forEach((c, i) => {
    const p = pats[c], y = i * rowH + 4;
    svg.appendChild(svgEl("text", { x: pad - 6, y: y + 11, class: "pr-yd pr-gl", "text-anchor": "end" }, c));
    svg.appendChild(svgEl("rect", { x: X(0), y: y + 4, width: X(p.carry) - X(0), height: 8, rx: 4, fill: "rgba(200,169,126,0.35)" }));
    if (p.n >= 3) svg.appendChild(svgEl("rect", { x: X(p.carryLo), y: y + 2, width: Math.max(1, X(p.carryHi) - X(p.carryLo)), height: 12, rx: 3, fill: "none", stroke: "#d4b483", "stroke-width": 0.9 }));
    svg.appendChild(svgEl("circle", { cx: X(p.carry), cy: y + 8, r: 2.6, fill: "#f5f5f7" }));
    svg.appendChild(svgEl("text", { x: X(Math.max(p.carryHi || p.carry, p.carry)) + 5, y: y + 11, class: "pr-yd" }, r0(p.carry)));
  });
  return svg;
}

function sessionsPanel(ctx) {
  const list = ctx.sessions.filter((s) => s.cat === "BAG");
  if (!list.length) return null;
  return el("section", { class: "panel" }, [el("h2", {}, "Sessions"), el("div", { class: "pr-sessions" }, list.map((s) => {
    const by = {};
    for (const x of s.shots || []) by[x.club] = (by[x.club] || 0) + 1;
    const del = el("button", { type: "button", class: "link danger" }, "Delete");
    del.addEventListener("click", async () => { if (!confirmAction("Delete this session's shots from My Clubs?")) return; await ctx.remove(s.id); render(ctx); });
    return el("div", { class: "pr-sess pr-sess-static" }, [
      el("span", { class: "pr-sess-d" }, [new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), el("span", { class: "pr-sess-tag" }, s.source === "monitor" ? s.fileName || "Launch monitor" : "Entered")]),
      el("span", { class: "muted" }, sortClubs(Object.keys(by)).map((c) => `${c} ×${by[c]}`).join(", ")),
      el("strong", {}, `${(s.shots || []).length}`),
      del,
    ]);
  }))]);
}

/* ---------------------------------------------- loading a launch monitor file ---------------------------------------------- */
function fileButton(ctx) {
  const input = el("input", { type: "file", accept: ".csv,text/csv", class: "visually-hidden" });
  input.addEventListener("change", async () => {
    const f = input.files[0]; input.value = "";
    if (!f) return;
    try {
      const rows = readLaunchMonitor(await f.text());
      ctx.go({ name: "bagImport", rows, fileName: f.name.slice(0, 60) });
    } catch (err) { ctx.flash?.(err.message || "Couldn't read that file.", "error"); }
  });
  return el("label", { class: "btn ghost" }, ["⇧  TrackMan / GCQuad file", input]);
}

function drawImport(ctx, v) {
  const hasClub = v.rows.some((r) => r.club);
  let fallback = null;
  const rows = v.rows.map((r) => ({ ...r, club: r.club ? normClub(r.club) : null }));
  const summary = el("div");
  const save = el("button", { type: "button", class: "btn pr-go" }, "Save to My Clubs");
  const drawSummary = () => {
    const by = {};
    for (const r of rows) { const c = r.club || fallback; if (c) by[c] = (by[c] || 0) + 1; }
    const keys = sortClubs(Object.keys(by));
    save.disabled = !keys.length;
    mount(summary, keys.length ? el("ul", { class: "pr-import-list" }, keys.map((c) => el("li", {}, [el("strong", {}, c), ` ${by[c]} shot${by[c] === 1 ? "" : "s"} · ${r0(clubStats(rows.filter((r) => (r.club || fallback) === c)).carry)} carry`]))) : el("p", { class: "muted" }, "Pick the club these shots were hit with."));
  };
  const picker = !hasClub || rows.some((r) => !r.club) ? clubChips(null, (c) => { fallback = c; drawSummary(); }) : null;
  drawSummary();
  save.addEventListener("click", async () => {
    const at = new Date().toISOString();
    const shots = rows.filter((r) => r.club || fallback).map((r, i) => ({ club: r.club || fallback, carry: r.carry ?? r.total, total: r.total ?? r.carry, offline: r.offline ?? 0, ...(r.ball != null ? { ball: r.ball } : {}), ...(r.spin != null ? { spin: r.spin } : {}), ...(r.launch != null ? { launch: r.launch } : {}), ...(r.height != null ? { height: r.height } : {}), at: `${at}#${String(i).padStart(4, "0")}`, source: "monitor" }));
    const s = { id: ctx.newId(), cat: "BAG", status: "done", source: "monitor", fileName: v.fileName, startedAt: at, shots };
    ctx.add(s); await ctx.save(s, true);
    ctx.flash?.(`Saved ${shots.length} shots.`, "ok");
    ctx.home();
  });
  const back = el("button", { type: "button", class: "link" }, "← Cancel");
  back.addEventListener("click", () => ctx.home());
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, "My Clubs · launch monitor file"), el("h1", {}, v.fileName || "Your file"),
    el("p", { class: "muted" }, `${v.rows.length} shots in the file.${hasClub ? "" : " There's no Club column, so pick the club."}`),
    picker ? el("div", {}, [el("span", { class: "rd-label" }, hasClub ? "Club for shots with none" : "Club"), picker]) : null,
    summary, save,
  ])]);
}

/** Chips to pick a club (your WITB bag first, if you have one, else the usual set; "Other" for the full list). */
function clubChips(current, onPick) {
  const box = el("div", { class: "pr-chips-row" });
  let full = false;
  const draw = () => mount(box, [...(full ? CLUB_LIST : COMMON).map((c) => {
    const b = el("button", { type: "button", class: `pr-chip${c === current ? " on" : ""}` }, c);
    b.addEventListener("click", () => { current = c; onPick(c); draw(); });
    return b;
  }), full ? null : (() => { const b = el("button", { type: "button", class: "pr-chip ghost" }, "More…"); b.addEventListener("click", () => { full = true; draw(); }); return b; })()]);
  draw();
  return box;
}

/* ---------------------------------------------- entering shots by hand ---------------------------------------------- */
function drawEntry(ctx, v) {
  const shots = v.shots;
  let club = v.club;
  const list = el("ol", { class: "pr-hole-shots pr-entry-list" });
  const statsBox = el("div");
  const drawList = () => {
    mount(list, shots.map((x, i) => {
      const rm = el("button", { type: "button", class: "link danger", "aria-label": `Remove shot ${i + 1}` }, "✕");
      rm.addEventListener("click", () => { shots.splice(i, 1); drawList(); });
      return el("li", {}, [el("span", {}, x.club), el("span", {}, `${r0(x.carry)} carry${x.total && x.total !== x.carry ? ` · ${r0(x.total)} total` : ""}`), el("span", { class: "muted" }, lr(x.offline)), rm]);
    }));
    const mine = shots.filter((x) => x.club === club);
    const st = mine.length >= 2 ? clubStats(mine) : null;
    mount(statsBox, st ? el("p", { class: "muted small" }, `This session, ${club}: ${r0(st.carry)} carry on average, ${lr(st.offline)}, ${mine.length} shots.`) : null);
    save.disabled = !shots.length;
  };
  const chips = clubChips(club, (c) => { club = c; carry.focus(); drawList(); });
  const num = (ph, label) => el("input", { type: "text", inputmode: "decimal", placeholder: ph, "aria-label": label, autocomplete: "off" });
  const carry = num("Carry", "Carry (yds)"), total = num("Total", "Total (yds, optional)"), off = num("Offline", "Offline (yds)");
  let side = 0;
  const sideSeg = el("div", { class: "seg seg-sm pr-side" });
  const drawSide = () => mount(sideSeg, [[-1, "Left"], [1, "Right"]].map(([s, l]) => { const b = el("button", { type: "button", class: `seg-btn${side === s ? " on" : ""}` }, l); b.addEventListener("click", () => { side = side === s ? 0 : s; drawSide(); }); return b; }));
  drawSide();
  const hint = el("p", { class: "muted small pr-tip", "aria-live": "polite" });
  const addShot = (c, t, o) => {
    shots.push({ club, carry: c, total: t || c, offline: o, at: `${new Date().toISOString()}`, source: "typed" });
    carry.value = ""; total.value = ""; off.value = ""; side = 0; drawSide(); hint.textContent = ""; drawList(); carry.focus();
  };
  const add = el("button", { type: "button", class: "btn" }, "Add shot");
  add.addEventListener("click", () => {
    if (!club) { hint.textContent = "Pick the club first."; return; }
    const c = Number(carry.value), t = Number(total.value) || null, o = Number(off.value) || 0;
    if (!(c > 0)) { hint.textContent = "Type the carry."; carry.focus(); return; }
    if (o && !side) { hint.textContent = "Left or right?"; return; }
    addShot(c, t, o * (side || 1));
  });
  [carry, total, off].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); }));
  const say = SpeechRec ? (() => {
    const b = el("button", { type: "button", class: "btn ghost pr-say voice-mic" }, sayKids("Say it"));
    b.addEventListener("click", () => {
      if (!club) { hint.textContent = "Pick the club first."; return; }
      const rec = new SpeechRec();
      rec.lang = navigator.language || "en-US"; rec.maxAlternatives = 3;
      mount(b, sayKids("Listening…")); b.dataset.listening = "1"; b.classList.add("on"); b.disabled = true;
      rec.onresult = (e) => {
        const alts = [...e.results[0]].map((a) => a.transcript);
        // read it like a tee shot: "152, 6 left"
        const fake = { kind: "tee", width: 30, sides: { left: { kind: "rough", at: 99 }, right: { kind: "rough", at: 99 } }, hole: 600 };
        const got = alts.map((t) => resultFromSpeech(fake, t.replace(/\b(\d{2,3})\b/, (m) => (Number(m) < 100 ? `${Number(m) + 1000}` : m)))).find(Boolean);
        if (got) addShot(got.total > 1000 ? got.total - 1000 : got.total, null, got.offline); else hint.textContent = `Didn’t catch “${alts[0]}”`;
      };
      rec.onend = () => { b.disabled = false; b.classList.remove("on"); if (b.dataset.listening) mount(b, sayKids("Say it")); delete b.dataset.listening; };
      rec.onerror = () => { b.disabled = false; b.classList.remove("on"); delete b.dataset.listening; mount(b, sayKids("Say it")); };
      try { rec.start(); } catch { b.disabled = false; }
    });
    return b;
  })() : null;
  const save = el("button", { type: "button", class: "btn pr-go" }, "Save to My Clubs");
  save.addEventListener("click", async () => {
    if (!shots.length) return;
    const s = { id: ctx.newId(), cat: "BAG", status: "done", source: "typed", startedAt: new Date().toISOString(), shots: shots.map((x, i) => ({ ...x, at: `${x.at}#${String(i).padStart(4, "0")}` })) };
    ctx.add(s); await ctx.save(s, true);
    picked = club;
    ctx.flash?.(`Saved ${shots.length} shots.`, "ok");
    ctx.home();
  });
  const back = el("button", { type: "button", class: "link" }, "← Back");
  back.addEventListener("click", () => { if (shots.length && !confirmAction("Leave without saving these shots?")) return; ctx.home(); });
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, "My Clubs"), el("h1", {}, "Hit a club"),
    el("p", { class: "muted small" }, "Pick the club, then add each shot: carry, and how far off line (left or right). Total is optional. Switch clubs any time."),
    el("div", {}, [el("span", { class: "rd-label" }, "Club"), chips]),
    el("div", { class: "pr-fields pr-bag-fields" }, [el("label", {}, [el("span", { class: "rd-label" }, "Carry (yds)"), carry]), el("label", {}, [el("span", { class: "rd-label" }, "Total (optional)"), total]), el("label", {}, [el("span", { class: "rd-label" }, "Offline (yds)"), off]), el("div", {}, [el("span", { class: "rd-label" }, "Side"), sideSeg])]),
    hint,
    el("div", { class: "pr-actions" }, [say, add]),
    el("p", { class: "muted small pr-tip" }, "Say it like “152, 6 left”."),
    statsBox, list, save,
  ])]);
  drawList();
}
