/*
 * (update 456) Course Prep › Strategy Maps: each hole's image with the scoring zones over it. Pins switch in place (the
 * image stays); Field or the player picked (the zones weighted by their own strokes gained at that distance and lie);
 * Aim / Avoid (each zone against the zones about as far from the pin) or Scoring (the scoring itself, birdie to bogey, as
 * in the course report). Tap a zone for its numbers.
 */
import { el, mount, infoTip } from "../ui.js";
import { sameCourse } from "../sg.js";
import { heatData, heatImage, zonesOf, keyZones, buildOverlay, paintHeat, paintBase, toDisp, toImg, zoneAt, skillIndex, fmtPar, scoreT } from "../courseHeat.js";
import { pickWho, playerData } from "./coursePrepExtras.js";

const st = { hole: 1, pin: {}, view: "field", mode: "zones" }; // (kept while the app is open)

export async function drawHeat(ctx, course) {
  const meta = course.heat;
  const back = el("button", { type: "button", class: "link" }, `← ${course.name}`);
  back.addEventListener("click", () => ctx.go({ name: "prepMenu", course }));
  const body = el("div", {}, el("p", { class: "muted ta-loading" }, "Loading the zones…"));
  let who = null, ix = null, mineHere = null;
  const W = await pickWho(ctx, (p) => { who = p; loadWho(); });
  who = W.who;
  const whoLine = el("p", { class: "muted small sh-who" });
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel sh" }, [
    el("p", { class: "pr-eyebrow" }, course.name), el("div", { class: "sh-title" }, [el("h1", {}, "Strategy Maps"),
      infoTip("Each zone is the centre of a cluster of shots the tour has played from on this hole and pin; the colour blends from one zone to the next, and stops where the lie changes on the image (a fairway zone colours only the fairway, a rough zone only the rough). Aim / Avoid compares each zone with the zones about as far from the pin: green scores better than its neighbours (somewhere to aim), red worse (somewhere to stay away from); ✓ marks the best three, ✕ the worst three. Scoring shows the scoring itself, birdie (blue) to bogey (red), as in the course report. With a player picked, Player weights every zone by their own strokes gained from that distance and lie, against the tour.")]),
    W.node, whoLine]), body]);
  let data;
  try { data = await heatData(meta); } catch (err) { console.error(err); mount(body, el("p", { class: "empty" }, "Couldn’t load the zones. Try again.")); return; }
  const holeNums = [...new Set([...Object.keys(data.holes || {}), ...Object.keys(meta.holes || {})].map(Number))].filter((n) => n > 0).sort((a, b) => a - b);
  if (!holeNums.length) { mount(body, el("p", { class: "empty" }, "No holes for this course yet.")); return; }
  if (!holeNums.includes(st.hole) || st.course !== meta.id) { st.hole = holeNums[0]; st.course = meta.id; st.pin = {}; }

  // the page: holes, then pins and the switches, then the picture
  const holeBar = el("div", { class: "sh-holes", role: "tablist", "aria-label": "Hole" });
  const pinBar = el("div", { class: "sh-pins", role: "group", "aria-label": "Pin" });
  const viewSeg = el("div", { class: "seg seg-sm", role: "group", "aria-label": "Whose scoring" });
  const modeSeg = el("div", { class: "seg seg-sm", role: "group", "aria-label": "What the colours show" });
  const head = el("div", { class: "sh-head" });
  const img = new Image(); // (drawn on a canvas, so a phone can show it upright)
  const base = el("canvas", { class: "sh-img", role: "img", "aria-label": "Hole map" });
  const cv = el("canvas", { class: "sh-cv", "aria-hidden": "true" });
  const pop = el("div", { class: "sh-pop", hidden: true, role: "dialog", "aria-label": "Zone" });
  const stage = el("div", { class: "sh-stage" }, [base, cv, pop]);
  const legend = el("div", { class: "sh-legend" });
  const keys = el("div", { class: "sh-keys" });
  const prev = el("button", { type: "button", class: "btn ghost small" }, "← Prev"), next = el("button", { type: "button", class: "btn ghost small" }, "Next →");
  prev.addEventListener("click", () => go(-1)); next.addEventListener("click", () => go(1));
  mount(body, el("section", { class: "panel sh-panel" }, [holeBar, head, el("div", { class: "sh-ctl" }, [pinBar, el("div", { class: "sh-sw" }, [modeSeg, viewSeg])]), stage, legend, keys, el("div", { class: "sh-nav" }, [prev, next])]));

  let Z = null, par = 4, size = { w: 0, h: 0 }, pinNow = null, imgFor = null, rot = false;
  // a wide hole on a phone: turned upright, tee at the bottom (as the Course Maps are)
  const setGeom = () => { rot = !!size.w && matchMedia("(max-width: 600px)").matches && size.w > size.h * 1.25; stage.style.aspectRatio = size.w ? (rot ? `${size.h} / ${size.w}` : `${size.w} / ${size.h}`) : "16 / 9"; stage.classList.toggle("rot", rot); };
  // (update 457) the zones' picture is worked out once (it reads the image for the edges of each lie), then only drawn
  let ov = null;
  const rebuild = () => { ov = Z && size.w ? buildOverlay(img.naturalWidth ? img : null, Z, { W: size.w, H: size.h, par, mode: st.mode }) : null; };
  const drawAll = () => { paintBase(base, img, { W: size.w, H: size.h, rot }); if (Z && size.w) paintHeat(cv, Z, ov, { W: size.w, H: size.h, pin: pinNow, rot }); };
  img.addEventListener("load", () => { rebuild(); drawAll(); });
  const seg = (box, list, key, onSet) => mount(box, list.map(([v, l, dis]) => { const b = el("button", { type: "button", class: `seg-btn${st[key] === v ? " on" : ""}`, "aria-pressed": String(st[key] === v), disabled: !!dis, title: dis || null }, l); b.addEventListener("click", () => { if (st[key] === v) return; st[key] = v; onSet(); }); return b; }));
  const go = (d) => { const i = holeNums.indexOf(st.hole) + d; if (i >= 0 && i < holeNums.length) { st.hole = holeNums[i]; showHole(); } };
  function drawHoleBar() {
    mount(holeBar, holeNums.map((n) => { const b = el("button", { type: "button", role: "tab", class: `sh-hole${n === st.hole ? " on" : ""}`, "aria-selected": String(n === st.hole) }, String(n)); b.addEventListener("click", () => { if (st.hole !== n) { st.hole = n; showHole(); } }); return b; }));
    holeBar.querySelector(".on")?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }
  async function showHole() {
    pop.hidden = true;
    const n = st.hole, H = data.holes?.[n] || { pins: {} }, hm = meta.holes?.[n] || null;
    par = H.par || meta.par?.[n - 1] || course.par?.[n - 1] || 4;
    const yds = H.yards || meta.yards?.[n - 1] || course.yards?.[n - 1];
    mount(head, [el("h2", {}, `Hole ${n} · Par ${par}${yds ? ` · ${yds} yds` : ""}`)]);
    drawHoleBar();
    prev.disabled = holeNums.indexOf(n) <= 0; next.disabled = holeNums.indexOf(n) >= holeNums.length - 1;
    const pins = Object.keys(H.pins || {}).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    if (!pins.includes(st.pin[n])) st.pin[n] = pins[0];
    // the pins: a switch each (the picture stays; only the zones change)
    mount(pinBar, pins.length ? pins.map((p, i) => { const b = el("button", { type: "button", class: `sh-pin${st.pin[n] === p ? " on" : ""}`, "aria-pressed": String(st.pin[n] === p) }, /^\d+$/.test(p) ? `Pin ${p}` : String(p).replace(/[-_]+/g, " ")); /* (update 458: its own name) */ b.title = String(p); b.addEventListener("click", () => { if (st.pin[n] === p) return; st.pin[n] = p; [...pinBar.children].forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }); paint(); }); return b; }) : el("span", { class: "muted small" }, "No zones for this hole yet."));
    // the picture: only when the hole changes
    if (hm) {
      size = { w: hm.w, h: hm.h }; setGeom();
      if (imgFor !== `${meta.id}|${n}`) {
        imgFor = `${meta.id}|${n}`; img.removeAttribute("src"); base.getContext("2d").clearRect(0, 0, base.width, base.height); stage.classList.add("loading");
        const url = await heatImage(meta, n).catch(() => null);
        if (st.hole !== n) return;
        stage.classList.remove("loading");
        if (url) img.src = url;
        const nx = holeNums[holeNums.indexOf(n) + 1]; if (nx) heatImage(meta, nx).catch(() => {}); // (the next one, ready)
      }
    } else { size = { w: 0, h: 0 }; img.removeAttribute("src"); imgFor = null; setGeom(); base.getContext("2d").clearRect(0, 0, base.width, base.height); }
    stage.classList.toggle("noimg", !hm);
    paint();
  }
  function paint() {
    pop.hidden = true;
    const n = st.hole, H = data.holes?.[n] || { pins: {} }, pin = H.pins?.[st.pin[n]];
    pinNow = pin || null;
    seg(modeSeg, [["zones", "Aim / Avoid"], ["score", "Scoring"]], "mode", paint);
    seg(viewSeg, [["field", "Field"], ["player", who ? who.label.split(" ")[0] || "Player" : "Player", !who ? "Pick a player" : !ix ? "Loading their stats…" : null]], "view", paint);
    if (!pin || !size.w) { const c = cv.getContext("2d"); c.clearRect(0, 0, cv.width, cv.height); Z = null; mount(keys, size.w ? null : el("p", { class: "muted small" }, "No image for this hole yet: upload the course’s images zip on Upload Data.")); drawLegend(); return; }
    const usePlayer = st.view === "player" && !!ix;
    const Hn = data.holes?.[n] || {};
    Z = zonesOf(pin, par, ix, { toGo: !!data.toGo, yards: Hn.yards || meta.yards?.[n - 1] || course.yards?.[n - 1] || null }); // (update 458)
    const K = keyZones(Z, usePlayer);
    rebuild();
    paintHeat(cv, Z, ov, { W: size.w, H: size.h, pin, rot });
    drawLegend();
    // the key zones in words
    const line = (z) => { const b = el("button", { type: "button", class: `sh-key ${z.key.kind}` }, [el("strong", {}, `${z.key.kind === "target" ? "✓" : "✕"}${z.key.n}`), ` ${lieList(z)}${z.dp ? ` · ${Math.round(z.dp)} yds out` : ""} · ${z.toGo ? `${z.raw.toFixed(2)} to hole out` : `${fmtPar(z.v)} to par`}`, el("span", { class: "muted" }, ` (${fmtPar(z.diff)} vs zones as far out)`)]); b.addEventListener("click", () => openZone(z)); return b; };
    mount(keys, [K.target.length ? el("div", {}, [el("p", { class: "sh-k-h pos" }, "Aim here"), ...K.target.map(line)]) : null, K.avoid.length ? el("div", {}, [el("p", { class: "sh-k-h neg" }, "Stay away from"), ...K.avoid.map(line)]) : null,
      !K.target.length && !K.avoid.length ? el("p", { class: "muted small" }, "No zone stands out from the ones around it on this pin.") : null]);
  }
  function drawLegend() {
    if (st.mode === "zones") { mount(legend, [el("span", { class: "sh-lg" }, [el("i", { class: "sh-sw-g" }), "Scores better than zones as far out"]), el("span", { class: "sh-lg" }, [el("i", { class: "sh-sw-r" }), "Scores worse"]), el("span", { class: "sh-lg" }, [el("i", { class: "sh-sw-p" }), "Pin"])]); return; }
    const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { const v = par >= 5 ? (t <= 0.5 ? -1 + t : -0.5 + (t - 0.5) * 2) : t - 0.5; return [t, scoreT(v, par)]; });
    const bar = el("i", { class: "sh-grad" }); bar.style.background = `linear-gradient(90deg, ${stops.map(([t]) => `rgb(${rgbAt(t)}) ${t * 100}%`).join(", ")})`;
    mount(legend, [el("span", { class: "sh-lg" }, [par >= 5 ? "Eagle" : "Birdie", bar, "Bogey"]), el("span", { class: "muted small" }, `${par >= 5 ? "−1 to +0.5 to par (birdie in the middle)" : "−0.5 to +0.5 to par (par in the middle)"}: the hole score from there, reached in regulation`)]);
  }
  const lieList = (z) => { const m = new Map(); for (const r of z.rows) m.set(r.lie || "Any lie", (m.get(r.lie || "Any lie") || 0) + (r.n || 1)); return [...m].sort((a, b) => b[1] - a[1]).map(([l]) => l).slice(0, 2).join(" / "); };
  // tap: the zone under the finger
  cv.addEventListener("click", (e) => {
    if (!Z || !size.w) return;
    const r = cv.getBoundingClientRect(), DW = rot ? size.h : size.w, DH = rot ? size.w : size.h;
    const [x, y] = toImg(((e.clientX - r.left) / r.width) * DW, ((e.clientY - r.top) / r.height) * DH, size.w, rot);
    const z = zoneAt(Z.zones, x, y, ov);
    if (!z) { pop.hidden = true; return; }
    openZone(z, e.clientX - r.left, e.clientY - r.top);
  });
  function openZone(z, px = null, py = null) {
    const r = cv.getBoundingClientRect();
    if (px == null) { const [dx, dy] = toDisp(z.x, z.y, size.w, rot); px = (dx / (rot ? size.h : size.w)) * r.width; py = (dy / (rot ? size.w : size.h)) * r.height; }
    const usePlayer = st.view === "player" && !!ix;
    const share = Z.total ? Math.round((100 * (z.n || 0)) / Z.total) : null;
    const x = el("button", { type: "button", class: "sh-pop-x", "aria-label": "Close" }, "✕"); x.addEventListener("click", () => { pop.hidden = true; });
    const ttl = z.key ? (z.key.kind === "target" ? `Aim here ✓${z.key.n}` : `Stay away ✕${z.key.n}`) : "Zone";
    const rows = [...z.rows].sort((a, b) => (b.n || 0) - (a.n || 0));
    mount(pop, [el("div", { class: "sh-pop-h" }, [el("strong", { class: z.key?.kind === "target" ? "pos" : z.key?.kind === "avoid" ? "neg" : "" }, ttl), x]),
      z.toGo ? el("p", {}, [`Strokes to hole out: `, el("strong", {}, z.raw.toFixed(2)), usePlayer && z.rawP != null ? [` · ${who.label.split(" ")[0]} `, el("strong", {}, z.rawP.toFixed(2))] : null]) : null,
      el("p", {}, [z.toGo ? `Hole score from here${z.k != null ? ` (${z.k === 0 ? "from the tee" : `in ${z.k} ${z.k === 1 ? "shot" : "shots"}`})` : ""}: ` : `Scoring from here: `, el("strong", {}, `${(par + z.field).toFixed(2)}`), ` (${fmtPar(z.field)} to par)`]),
      usePlayer && z.player != null && !z.toGo ? el("p", {}, [`${who.label}: `, el("strong", {}, `${(par + z.player).toFixed(2)}`), ` (${fmtPar(z.player)}), from their strokes gained from here`]) : null,
      el("p", { class: "muted small" }, [z.L === "tee" ? "The tee" : `${fmtPar(z.diff)} against zones about as far from the pin${z.dp ? ` (${Math.round(z.dp)} yds)` : ""}`, Z.hasN && z.n ? ` · ${z.n.toLocaleString()} shots${share != null ? ` (${share < 1 ? "under 1" : share}% of this pin’s)` : ""}` : ""]),
      el("table", { class: "plain sh-pop-t" }, [el("thead", {}, el("tr", {}, [el("th", {}, "Lie"), el("th", {}, "Distance"), Z.hasN ? el("th", { class: "num" }, "Shots") : null, el("th", { class: "num" }, z.toGo ? "To hole out" : "Tour"), usePlayer ? el("th", { class: "num" }, who.label.split(" ")[0]) : null])),
        el("tbody", {}, rows.map((q) => el("tr", {}, [el("td", {}, q.lie || "—"), el("td", {}, q.d || "—"), Z.hasN ? el("td", { class: "num" }, q.n ? q.n.toLocaleString() : "—") : null, el("td", { class: "num" }, z.toGo ? q.v.toFixed(2) : fmtPar(q.f)),
          usePlayer ? el("td", { class: "num", title: q.sk ? `${q.sk.sg >= 0 ? "Gains" : "Loses"} ${Math.abs(q.sk.sg).toFixed(3)} a shot${q.sk.band ? ` at ${q.sk.band}` : ""}${q.sk.lie ? ` from the ${q.sk.lie}` : ""} (${Math.round(q.sk.shots)} shots)` : null }, z.toGo ? (q.v - (q.sk?.sg || 0)).toFixed(2) : fmtPar(q.p)) : null])))]),
    ]);
    pop.hidden = false;
    const pw = Math.min(320, r.width - 16); pop.style.width = `${pw}px`;
    const left = Math.max(8, Math.min(r.width - pw - 8, px + (px < r.width / 2 ? 14 : -pw - 14)));
    pop.style.left = `${left}px`;
    requestAnimationFrame(() => { const ph = pop.offsetHeight; pop.style.top = `${Math.max(8, Math.min(Math.max(8, r.height - ph - 8), py - ph / 2))}px`; });
  }
  // the zones redraw when the picture changes size (a turned phone, a narrower window)
  let rT = null; new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(() => { const was = rot; setGeom(); if (was !== rot) pop.hidden = true; drawAll(); }, 80); }).observe(stage);
  // swipe for the next / previous hole
  let sx = null; stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); });

  async function loadWho() {
    ix = null; mineHere = null;
    if (!who) { whoLine.textContent = ""; st.view = "field"; paint(); return; }
    const me = who; whoLine.textContent = `Loading ${who.label}’s stats…`; paint();
    try {
      const d = await playerData(me.key);
      if (who !== me) return;
      ix = d.rounds.length ? skillIndex(d.rounds) : null;
      mineHere = d.rounds.filter((rd) => sameCourse(rd.course, course.name));
      const sgR = mineHere.length ? mineHere.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + s.sg, 0), 0) / mineHere.length : null;
      const link = el("button", { type: "button", class: "link" }, "Course History ›"); link.addEventListener("click", () => ctx.go({ name: "prepHistory", course }));
      mount(whoLine, !d.rounds.length ? `No stats file for ${me.label} yet, so the zones show the field.` : [`Player view: the zones weighted by ${me.label}’s strokes gained from each distance and lie. `,
        mineHere.length ? [`${mineHere.length} ${mineHere.length === 1 ? "round" : "rounds"} here (${sgR >= 0 ? "+" : "−"}${Math.abs(sgR).toFixed(2)} a round). `, link] : `No rounds here in the stats yet.`]);
      if (ix && st.view !== "player" && st.autoPlayer !== false) st.view = "player";
    } catch (err) { console.error(err); whoLine.textContent = "Couldn’t load their stats, so the zones show the field."; }
    paint();
  }
  showHole();
  if (who) loadWho();
}
const RD = [[5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31]];
function rgbAt(t) { const x = Math.max(0, Math.min(1, t)) * (RD.length - 1), i = Math.min(RD.length - 2, Math.floor(x)), f = x - i; return RD[i].map((c, k) => Math.round(c + (RD[i + 1][k] - c) * f)).join(","); }
