/*
 * (update 456) Course Prep › Strategy Maps: each hole's image with the scoring zones over it. Pins switch in place (the
 * image stays); Field or the player picked (the zones weighted by their own strokes gained at that distance and lie);
 * the scoring itself, birdie to bogey, as in the course report. Tap a spot for its numbers (a dot marks it). (update 461)
 * Zoom in (pinch, the wheel, or + / −) and drag to look around; the picture is redrawn sharp at each zoom.
 */
import { el, mount, infoTip } from "../ui.js";
import { sameCourse } from "../sg.js";
import { effectiveTeam } from "../preview.js";
const CAT_NAME = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" };
import { heatData, heatImage, pinsOn, pinLabel, renamePin, setPinOff, withMerges, mergePins, splitPins, zonesOf, keyZones, buildOverlay, paintHeat, paintBase, toDisp, toImg, zoneAt, zoneCat, learnOf, skillIndex, fmtPar, scoreT, pinForShot, shotsFor } from "../courseHeat.js";
import { pickWho, playerData } from "./coursePrepExtras.js";
import { playerTrails, LIE_NAMES } from "../courseShots.js"; // (update 479)
import { BUILD_VERSION } from "../courseRaw.js"; // (update 498)

const st = { hole: 1, pin: {}, view: "field", mode: "score", shot: "1" }; // (kept while the app is open)

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
    el("p", { class: "pr-eyebrow" }, `${course.name}${course.mapEvents ? ` \u00b7 ${course.mapEvents}` : ""}`), el("div", { class: "sh-title" }, [el("h1", {}, "Strategy Maps"),
      infoTip("Each zone is the centre of a cluster of shots the tour has played from on this hole and pin; the colour blends from one zone to the next, and stops where the lie changes on the image (a fairway zone colours only the fairway, a rough zone only the rough). The colours are the scoring, birdie (blue) to bogey (red), as in the course report. Pinch or scroll to zoom in, and drag to look around. With a player picked, Player weights every zone by their own strokes gained from that distance and lie, against the tour.")]),
    W.node, whoLine]), body]);
  let data, raw;
  try { raw = await heatData(meta); data = withMerges(meta, raw); /* (update 468: with the admin's combined pins) */ } catch (err) { console.error(err); mount(body, el("p", { class: "empty" }, "Couldn’t load the zones. Try again.")); return; }
  const holeNums = [...new Set([...Object.keys(data.holes || {}), ...Object.keys(meta.holes || {})].map(Number))].filter((n) => n > 0).sort((a, b) => a - b);
  if (!holeNums.length) { mount(body, el("p", { class: "empty" }, "No holes for this course yet.")); return; }
  if (!holeNums.includes(st.hole) || st.course !== meta.id) { st.hole = holeNums[0]; st.course = meta.id; st.pin = {}; }
  if (course.startHole && holeNums.includes(course.startHole)) { st.hole = course.startHole; delete course.startHole; } // (update 491: from Course Insights)

  // the page: holes, then pins and the switches, then the picture
  const holeBar = el("div", { class: "sh-holes", role: "tablist", "aria-label": "Hole" });
  const pinBar = el("div", { class: "sh-pins", role: "group", "aria-label": "Pin" });
  // (update 494) the pins hardest first (by their scoring average to par; pins without scores last)
  const pinAvg = (n, p) => { const h = data.holes?.[n]?.pins?.[p]?.hist || {}; let t = 0, c = 0; for (const [k, v] of Object.entries(h)) { t += Number(k) * v; c += v; } return c ? t / c : -Infinity; };
  const pinsByHard = (n) => pinsOn(meta, data, n).map((p, i) => [p, pinAvg(n, p), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
  const isP = () => !!who; // (update 494: no Field / Player switch: a player picked shows the player, else the field)
  const shotSeg = el("div", { class: "seg seg-sm", role: "group", "aria-label": "Which shot" }); // (update 482)
  const shotRow = el("div", { class: "sh-sw sh-shot-row", hidden: true }, shotSeg);
  const head = el("div", { class: "sh-head" });
  const img = new Image(); // (drawn on a canvas, so a phone can show it upright)
  const base = el("canvas", { class: "sh-img", role: "img", "aria-label": "Hole map" });
  const cv = el("canvas", { class: "sh-cv", "aria-hidden": "true" });
  const pop = el("div", { class: "sh-pop", hidden: true, role: "dialog", "aria-label": "Zone" });
  // (update 461) zoom: the picture (and the zones over it) inside a frame that scales and moves; the dot and the popup
  // stay outside it, on top
  // (update 479) the player's past shots on the hole, drawn over the map (inside the zoom, so they zoom with it)
  const NS = "http://www.w3.org/2000/svg", sv = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, v); return e; };
  const trSvg = sv("svg", { class: "sh-trails", preserveAspectRatio: "none", "aria-hidden": "true" });
  const bdSvg = sv("svg", { class: "sh-trails sh-board", preserveAspectRatio: "none", "aria-hidden": "true" }); // (update 497: the up & down board)
  const zoomBox = el("div", { class: "sh-zoom" }, [base, cv, trSvg, bdSvg]);
  const pastBtn = el("button", { type: "button", class: "sh-past", hidden: true }, "Show Past Shots");
  const hist = el("div", { class: "sh-hist" });
  const trKey = el("div", { class: "sh-legend sh-tr-key", hidden: true }); // (the past shots' colours)
  let trails = null; // (the player picked: their rounds here, shot by shot)
  const dot = el("i", { class: "sh-dot", hidden: true, "aria-hidden": "true" });
  const zIn = el("button", { type: "button", class: "sh-zb", "aria-label": "Zoom in" }, "+"), zOut = el("button", { type: "button", class: "sh-zb", "aria-label": "Zoom out" }, "\u2212"), zFit = el("button", { type: "button", class: "sh-zb sh-zfit", "aria-label": "Whole hole", hidden: true }, "Fit");
  const stage = el("div", { class: "sh-stage" }, [zoomBox, dot, pop, pastBtn, el("div", { class: "sh-zbar" }, [zIn, zOut, zFit])]);
  const legend = el("div", { class: "sh-legend" });
  const keys = el("div", { class: "sh-keys" });
  const teeBox = el("div", { class: "sh-tee", hidden: true }); // (update 492) the left and right tee misses, this pin
  const udBox = el("div", { class: "sh-ud", hidden: true }); // (update 491) up & down by where the approach missed, this pin
  const prev = el("button", { type: "button", class: "btn ghost small" }, "← Prev"), next = el("button", { type: "button", class: "btn ghost small" }, "Next →");
  prev.addEventListener("click", () => go(-1)); next.addEventListener("click", () => go(1));
  mount(body, el("section", { class: "panel sh-panel" }, [holeBar, head, hist, teeBox, el("div", { class: "sh-ctl" }, [pinBar]), shotRow, stage, legend, trKey, udBox, keys, el("div", { class: "sh-nav" }, [prev, next])]));

  let Z = null, par = 4, size = { w: 0, h: 0 }, pinNow = null, imgFor = null, rot = false;
  // a wide hole on a phone: turned upright, tee at the bottom (as the Course Maps are)
  const setGeom = () => { rot = !!size.w && matchMedia("(max-width: 600px)").matches && size.w > size.h * 1.25; stage.style.aspectRatio = size.w ? (rot ? `${size.h} / ${size.w}` : `${size.w} / ${size.h}`) : "16 / 9"; stage.style.setProperty("--ar", size.w ? String(rot ? size.h / size.w : size.w / size.h) : "1.78"); /* (update 490: the width that keeps the whole hole on the screen) */ stage.classList.toggle("rot", rot); };
  // (update 457) the zones' picture is worked out once (it reads the image for the edges of each lie), then only drawn
  let ov = null;
  // (update 461) worked out at the image's own size (sharp edges where the lie changes), once for each hole, pin and view
  const ovMemo = new Map();
  // (update 482) the shot picked (where shot 1, 2 or 3 finished), when this hole has it: 0 for every shot
  // (update 484) no All shots: shot 1 unless another is picked (0 only for courses uploaded before update 482)
  const kOf = (n, parN) => { const H = data.holes?.[n]; if (!Object.values(H?.pins || {}).some((p) => p.byShot)) return 0; const k = Number(st.shot) || 1; return shotsFor(parN).includes(k) ? k : 1; };
  const vkOf = () => (isP() && ix ? `p:${who?.key}` : "f");
  const memoKey = (n, pid, parN, im = 1) => `${n}|${pid}|${vkOf()}|s${kOf(n, parN)}|${im}`;
  const zonesFor = (n, pid, parN) => {
    const H = data.holes?.[n] || { pins: {} }, k = kOf(n, parN), p = pinForShot(H.pins[pid], k);
    return zonesOf(p, parN, ix, { toGo: !!data.toGo, yards: H.yards || meta.yards?.[n - 1] || course.yards?.[n - 1] || null, dense: !!data.shots || (p.rows?.length || 0) > 600, played: k || null });
  };
  const rebuild = () => {
    if (!Z || !size.w) { ov = null; return; }
    const k = memoKey(st.hole, st.pin[st.hole], par, img.naturalWidth ? 1 : 0);
    ov = ovMemo.get(k) || buildOverlay(img.naturalWidth ? img : null, Z, { W: size.w, H: size.h, par, mode: "score", learn: learnOf(data.holes?.[st.hole]), learnKey: `${meta.id}|${st.hole}` });
    if (ovMemo.size > 40) ovMemo.clear();
    ovMemo.set(k, ov);
    prewarm();
  };
  // (update 480) then the next hole: its picture and its first pin, so Next is quick too
  let warmedHole = null;
  const warmNextHole = async (vk) => {
    const nx = holeNums[holeNums.indexOf(st.hole) + 1], hm = nx ? meta.holes?.[nx] : null, H = nx ? data.holes?.[nx] : null;
    if (!nx || !hm || !H || warmedHole === `${nx}|${vk}`) return;
    warmedHole = `${nx}|${vk}`;
    try {
      const url = await heatImage(meta, nx); if (!url) return;
      const im = new Image(); im.src = url; await im.decode();
      const p0 = st.pin[nx] && pinsByHard(nx).includes(st.pin[nx]) ? st.pin[nx] : pinsByHard(nx)[0];
      const parN = H.par || meta.par?.[nx - 1] || course.par?.[nx - 1] || 4;
      if (!p0 || ovMemo.has(memoKey(nx, p0, parN))) return;
      await new Promise((r) => setTimeout(r, 200));
      const Zp = zonesFor(nx, p0, parN);
      keyZones(Zp, isP() && !!ix);
      ovMemo.set(memoKey(nx, p0, parN), buildOverlay(im, Zp, { W: hm.w, H: hm.h, par: parN, mode: "score", learn: learnOf(H), learnKey: `${meta.id}|${nx}` }));
    } catch { /* (it's only a head start) */ }
  };
  // (update 480) the hole's other pins worked out while the map is looked at, one at a time, so switching is instant
  let warmT = null;
  const prewarm = () => {
    clearTimeout(warmT);
    warmT = setTimeout(() => {
      if (!img.naturalWidth || !size.w) return;
      const n = st.hole, H = data.holes?.[n]; if (!H) return;
      const vk = `${vkOf()}|s${Number(st.shot) || 0}`;
      const next = pinsByHard(n).find((p) => !ovMemo.has(memoKey(n, p, par)));
      if (!next) { warmNextHole(vk); return; }
      const Zp = zonesFor(n, next, par);
      keyZones(Zp, isP() && !!ix);
      ovMemo.set(memoKey(n, next, par), buildOverlay(img, Zp, { W: size.w, H: size.h, par, mode: "score", learn: learnOf(H), learnKey: `${meta.id}|${n}` }));
      prewarm();
    }, 250);
  };
  const drawAll = () => { drawTrails(); drawBoard(); paintBase(base, img, { W: size.w, H: size.h, rot }); if (Z && size.w) paintHeat(cv, Z, ov, { W: size.w, H: size.h, pin: pinNow, rot }); placeDot(); };
  img.addEventListener("load", () => { rebuild(); drawAll(); });
  const seg = (box, list, key, onSet) => mount(box, list.map(([v, l, dis]) => { const b = el("button", { type: "button", class: `seg-btn${st[key] === v ? " on" : ""}`, "aria-pressed": String(st[key] === v), disabled: !!dis, title: dis || null }, l); b.addEventListener("click", () => { if (st[key] === v) return; st[key] = v; onSet(); }); return b; }));
  const go = (d) => { const i = holeNums.indexOf(st.hole) + d; if (i >= 0 && i < holeNums.length) { st.hole = holeNums[i]; showHole(); } };
  function drawHoleBar() {
    mount(holeBar, holeNums.map((n) => { const b = el("button", { type: "button", role: "tab", class: `sh-hole${n === st.hole ? " on" : ""}`, "aria-selected": String(n === st.hole) }, String(n)); b.addEventListener("click", () => { if (st.hole !== n) { st.hole = n; showHole(); } }); return b; }));
    holeBar.querySelector(".on")?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }
  async function showHole() {
    pop.hidden = true; hideDot(); resetZoom(false);
    const n = st.hole, H = data.holes?.[n] || { pins: {} }, hm = meta.holes?.[n] || null;
    if (st.shotHole !== `${meta.id}|${n}`) { st.shotHole = `${meta.id}|${n}`; st.shot = "1"; } // (update 483; 484: a new hole starts on Shot 1)
    par = H.par || meta.par?.[n - 1] || course.par?.[n - 1] || 4;
    const yds = H.yards || meta.yards?.[n - 1] || course.yards?.[n - 1];
    mount(head, [el("h2", {}, `Hole ${n} · Par ${par}${yds ? ` · ${yds} yds` : ""}`)]);
    drawHoleBar();
    prev.disabled = holeNums.indexOf(n) <= 0; next.disabled = holeNums.indexOf(n) >= holeNums.length - 1;
    const pins = pinsByHard(n); // (update 463: not the ones the admin deleted)
    if (!pins.includes(st.pin[n])) st.pin[n] = pins[0];
    // the pins: a switch each (the picture stays; only the zones change)
    drawPins(n, pins);
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
  // (update 463) the pins: a switch each (the picture stays; only the zones change). The admin can rename or delete them
  // (Edit pins); deleted ones can be brought back.
  const isAdmin = ctx.state?.isAdmin && !effectiveTeam(ctx.state).preview;
  let editPins = false, picking = null; // (update 468) picking: the pins ticked to combine
  function drawPins(n, pins) {
    if (picking) { // pick two or more, then Combine
      const tick = pins.map((p) => { const on = picking.has(p); const b = el("button", { type: "button", class: `sh-pin sh-pick${on ? " on" : ""}`, "aria-pressed": String(on) }, [on ? "\u2713 " : "", pinLabel(meta, n, p)]); b.addEventListener("click", () => { on ? picking.delete(p) : picking.add(p); drawPins(n, pins); }); return b; });
      const go = el("button", { type: "button", class: "link small sh-pin-edit", disabled: picking.size < 2 }, `Combine (${picking.size})`);
      go.addEventListener("click", async () => {
        const of = pins.filter((p) => picking.has(p)); if (of.length < 2) return;
        const name = prompt("Name for the combined pin:", of.map((p) => pinLabel(meta, n, p)).join(" + "));
        if (name === null) return;
        let id; try { id = await mergePins(meta, n, of, name); } catch (err) { console.error(err); alert("Couldn\u2019t combine those pins. Try again."); return; }
        picking = null; data = withMerges(meta, raw); ovMemo.clear(); st.pin[n] = id; drawPins(n, pinsByHard(n)); paint();
      });
      const cancel = el("button", { type: "button", class: "link small sh-pin-edit" }, "Cancel"); cancel.addEventListener("click", () => { picking = null; drawPins(n, pins); });
      mount(pinBar, [el("span", { class: "muted small" }, "Pick the pins to combine:"), ...tick, go, cancel]);
      return;
    }
    const items = pins.map((p) => {
      const b = el("button", { type: "button", class: `sh-pin${st.pin[n] === p ? " on" : ""}`, "aria-pressed": String(st.pin[n] === p), title: String(p) }, pinLabel(meta, n, p));
      b.addEventListener("click", () => { if (st.pin[n] === p) return; st.pin[n] = p; [...pinBar.querySelectorAll(".sh-pin")].forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }); paint(); });
      if (!editPins) return b;
      const ren = el("button", { type: "button", class: "sh-pin-ed", "aria-label": `Rename ${pinLabel(meta, n, p)}`, title: "Rename" }, "\u270E");
      ren.addEventListener("click", () => {
        const inp = el("input", { type: "text", class: "sh-pin-in", value: pinLabel(meta, n, p), maxLength: 60, "aria-label": "Pin name" });
        let done = false;
        const save = async (keep) => { if (done) return; done = true; const v = inp.value.trim(); if (keep && v !== pinLabel(meta, n, p)) { try { await renamePin(meta, n, p, v === p ? "" : v); } catch (err) { console.error(err); alert("Couldn\u2019t rename that pin. Try again."); } } drawPins(n, pinsByHard(n)); };
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(true); } else if (e.key === "Escape") save(false); });
        inp.addEventListener("blur", () => save(true));
        wrap.replaceWith(inp); inp.focus(); inp.select();
      });
      const merged = !!data.holes?.[n]?.pins?.[p]?.merged;
      const del = el("button", { type: "button", class: "sh-pin-ed del", "aria-label": merged ? `Split ${pinLabel(meta, n, p)}` : `Delete ${pinLabel(meta, n, p)}`, title: merged ? "Split back into its pins" : "Delete" }, "\u2715");
      if (merged) del.addEventListener("click", async () => { // (update 468: a combined pin splits back into its pins)
        if (!confirm(`Split ${pinLabel(meta, n, p)} back into ${data.holes[n].pins[p].merged.map((q) => pinLabel(meta, n, q)).join(", ")}?`)) return;
        try { await splitPins(meta, n, p); } catch (err) { console.error(err); alert("Couldn\u2019t split that pin. Try again."); return; }
        data = withMerges(meta, raw); ovMemo.clear(); st.pin[n] = pinsByHard(n)[0]; drawPins(n, pinsByHard(n)); paint();
      });
      else del.addEventListener("click", async () => {
        if (!confirm(`Delete ${pinLabel(meta, n, p)} on hole ${n}? It stops showing for everyone (in Strategy Maps and Simulate Round). You can bring it back with Edit pins.`)) return;
        try { await setPinOff(meta, n, p, true); } catch (err) { console.error(err); alert("Couldn\u2019t delete that pin. Try again."); return; }
        const left = pinsByHard(n); if (st.pin[n] === p) st.pin[n] = left[0]; drawPins(n, left); paint();
      });
      const wrap = el("span", { class: "sh-pin-wrap" }, [b, ren, del]);
      return wrap;
    });
    const off = isAdmin ? Object.keys(data.holes?.[n]?.pins || {}).filter((p) => (meta.pinsOff || []).includes(`${n}|${p}`)) : []; // (deleted ones, not ones in a combined pin)
    const restore = editPins && off.length ? el("select", { class: "sh-pin-restore", "aria-label": "Bring back a deleted pin" }, [el("option", { value: "" }, `Bring back (${off.length})`), ...off.map((p) => el("option", { value: p }, pinLabel(meta, n, p)))]) : null;
    restore?.addEventListener("change", async () => { const p = restore.value; if (!p) return; try { await setPinOff(meta, n, p, false); } catch (err) { console.error(err); alert("Couldn\u2019t bring that pin back."); } st.pin[n] ||= p; drawPins(n, pinsByHard(n)); paint(); });
    const edit = isAdmin ? (() => { const b = el("button", { type: "button", class: "link small sh-pin-edit" }, editPins ? "Done" : "Edit pins"); b.addEventListener("click", () => { editPins = !editPins; drawPins(n, pinsByHard(n)); }); return b; })() : null;
    const combine = isAdmin && editPins && pins.length >= 2 ? (() => { const b = el("button", { type: "button", class: "link small sh-pin-edit" }, "Combine pins"); b.addEventListener("click", () => { picking = new Set(); drawPins(n, pins); }); return b; })() : null;
    mount(pinBar, [...(items.length ? items : [el("span", { class: "muted small" }, off.length ? "Every pin on this hole is deleted." : "No zones for this hole yet.")]), restore, combine, edit]);
  }
  function paint() {
    pop.hidden = true; hideDot();
    const n = st.hole, H = data.holes?.[n] || { pins: {} }, pin = H.pins?.[st.pin[n]];
    pinNow = pin || null;
    drawHist(); drawTrails(); drawTee(); drawUD(); drawBoard(); // (update 479; 491: up & down; 492: tee misses)
    drawShotSeg();
    if (!pin || !size.w) { const c = cv.getContext("2d"); c.clearRect(0, 0, cv.width, cv.height); Z = null; mount(keys, size.w ? null : el("p", { class: "muted small" }, "No image for this hole yet: upload the course’s images zip on Upload Data.")); drawLegend(); return; }
    const usePlayer = isP() && !!ix;
    const Hn = data.holes?.[n] || {};
    Z = zonesFor(n, st.pin[n], par); // (update 458; 480: smoothed when shot by shot, or when there are lots of small zones; 482: or one shot's results)
    const K = keyZones(Z, usePlayer);
    rebuild();
    paintHeat(cv, Z, ov, { W: size.w, H: size.h, pin, rot });
    drawLegend();
    // the key zones in words
    const line = (z) => { const b = el("button", { type: "button", class: `sh-key ${z.key.kind}` }, [el("strong", {}, `${z.key.n}`), ` ${lieList(z)}${z.dp ? ` · ${Math.round(z.dp)} yds out` : ""} · ${z.toGo ? `${z.raw.toFixed(2)} to hole out` : `${fmtPar(z.v)} to par`}`, el("span", { class: "muted" }, ` (${fmtPar(z.diff)} vs zones as far out)`)]); b.addEventListener("click", () => openZone(z)); return b; };
    mount(keys, null); // (update 467: no Aim here / Stay away from lists)
  }
  // (update 482) which shot's results: every shot, or where shot 1 (2, 3) finished. Shot 1 on a par 3, 1-2 on a par 4,
  // 1-3 on a par 5. Only for courses uploaded shot by shot since update 482.
  function drawShotSeg() {
    const H = data.holes?.[st.hole], has = Object.values(H?.pins || {}).some((p) => p.byShot);
    shotRow.hidden = !has;
    if (!has) return;
    const k = kOf(st.hole, par);
    mount(shotSeg, shotsFor(par).map((i) => [String(i), `Shot ${i}`]).map(([v, l]) => {
      const on = Number(v) === k;
      const b = el("button", { type: "button", class: `seg-btn${on ? " on" : ""}`, "aria-pressed": String(on), title: `Where shot ${v} finished: the spots shot ${Number(v) + 1} was hit from` }, l);
      b.addEventListener("click", () => { if (on) return; st.shot = v; paint(); });
      return b;
    }));
  }
  function drawLegend() {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { const v = par >= 5 ? (t <= 0.5 ? -1 + t : -0.5 + (t - 0.5) * 2) : t - 0.5; return [t, scoreT(v, par)]; });
    const bar = el("i", { class: "sh-grad" }); bar.style.background = `linear-gradient(90deg, ${stops.map(([t]) => `rgb(${rgbAt(t)}) ${t * 100}%`).join(", ")})`;
    mount(legend, [el("span", { class: "sh-lg" }, [par >= 5 ? "Eagle" : "Birdie", bar, "Bogey"]), el("span", { class: "muted small" }, `${kOf(st.hole, par) ? `Where shot ${kOf(st.hole, par)} finished. ` : ""}${par >= 5 ? "−1 to +0.5 to par (birdie in the middle)" : "−0.5 to +0.5 to par (par in the middle)"}: the hole score from there${kOf(st.hole, par) ? "" : ", reached in regulation"}. ${Z?.hasN ? "Fainter: fewer shots from there." : ""}`)]);
  }
  const lieList = (z) => { const m = new Map(); for (const r of z.rows) m.set(r.lie || "Any lie", (m.get(r.lie || "Any lie") || 0) + (r.n || 1)); return [...m].sort((a, b) => b[1] - a[1]).map(([l]) => l).slice(0, 2).join(" / "); };
  // tap: the zone under the finger
  cv.addEventListener("click", (e) => {
    if (!Z || !size.w || zm.moved) { zm.moved = false; return; }
    const r = cv.getBoundingClientRect(), DW = rot ? size.h : size.w, DH = rot ? size.w : size.h;
    const [x, y] = toImg(((e.clientX - r.left) / r.width) * DW, ((e.clientY - r.top) / r.height) * DH, size.w, rot);
    const z = zoneAt(Z.zones, x, y, ov);
    if (!z) { pop.hidden = true; hideDot(); return; } // (no colour there: nothing to show)
    if (z.none) { // (update 465) a lie with no shots from it for this pin (a bunker no one found): said so
      tapAt = { x, y };
      const xb = el("button", { type: "button", class: "sh-pop-x", "aria-label": "Close" }, "\u2715"); xb.addEventListener("click", () => { pop.hidden = true; hideDot(); });
      const name = { bunker: "bunker", fairway: "fairway", rough: "rough", green: "green", tee: "tee" }[z.L] || z.L;
      mount(pop, [el("div", { class: "sh-pop-h" }, [el("strong", {}, "This spot"), xb]), el("p", { class: "muted small" }, `No shots from the ${name} near here on this pin.`)]);
      pop.hidden = false; placeDot(); requestAnimationFrame(placeDot); return;
    }
    openZone(z, { x, y });
  });
  // (update 461) the spot tapped: a dot there (it follows zoom and drag), and the popup beside it, never over it
  let tapAt = null;
  const hideDot = () => { tapAt = null; dot.hidden = true; };
  const screenOf = (ix0, iy0) => { const r = cv.getBoundingClientRect(), sr = stage.getBoundingClientRect(), [dx, dy] = toDisp(ix0, iy0, size.w, rot); return [r.left - sr.left + (dx / (rot ? size.h : size.w)) * r.width, r.top - sr.top + (dy / (rot ? size.w : size.h)) * r.height]; };
  function placeDot() {
    if (!tapAt || !size.w) { dot.hidden = true; return; }
    const [px, py] = screenOf(tapAt.x, tapAt.y), sr = stage.getBoundingClientRect();
    const inside = px >= 0 && py >= 0 && px <= sr.width && py <= sr.height;
    dot.hidden = !inside; dot.style.left = `${px}px`; dot.style.top = `${py}px`;
    if (!pop.hidden) placePop(px, py);
  }
  function placePop(px, py) {
    const sr = stage.getBoundingClientRect(), gap = 16;
    const pw = Math.min(320, sr.width - 16); pop.style.width = `${pw}px`;
    const ph = pop.offsetHeight || 200;
    let left, top;
    if (sr.width - px - gap >= pw + 8 || px - gap >= pw + 8) { // beside it
      left = sr.width - px - gap >= pw + 8 && (px < sr.width / 2 || px - gap < pw + 8) ? px + gap : px - gap - pw;
      top = Math.max(8, Math.min(Math.max(8, sr.height - ph - 8), py - ph / 2));
    } else { // a narrow screen: above or below it
      left = Math.max(8, Math.min(sr.width - pw - 8, px - pw / 2));
      const below = py + gap, above = py - gap - ph;
      top = py < sr.height / 2 ? (below + ph <= sr.height - 4 || above < 4 ? below : above) : (above >= 4 || below + ph > sr.height ? Math.max(4, above) : below);
    }
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  }
  function openZone(z, at = null) {
    tapAt = at || { x: z.x, y: z.y };
    const usePlayer = isP() && !!ix;
    const cat = zoneCat(z), catN = Z.zones.filter((o) => zoneCat(o) === cat).reduce((t, o) => t + (o.n || 0), 0);
    const catShare = catN ? Math.round((100 * (z.n || 0)) / catN) : null;
    const x = el("button", { type: "button", class: "sh-pop-x", "aria-label": "Close" }, "✕"); x.addEventListener("click", () => { pop.hidden = true; hideDot(); });
    const ttl = z.key ? (z.key.kind === "target" ? `Aim here (${z.key.n})` : `Stay away (${z.key.n})`) : "This spot";
    const rows = [...z.rows].sort((a, b) => (b.n || 0) - (a.n || 0));
    mount(pop, [el("div", { class: "sh-pop-h" }, [el("strong", { class: z.key?.kind === "target" ? "pos" : z.key?.kind === "avoid" ? "neg" : "" }, ttl), x]),
      z.toGo ? el("p", {}, [`Strokes to hole out: `, el("strong", {}, z.raw.toFixed(2)), ...(usePlayer && z.rawP != null ? [` · ${who.label.split(" ")[0]} `, el("strong", {}, z.rawP.toFixed(2))] : [])]) : null,
      z.toGo ? null : el("p", {}, [`Scoring from here: `, el("strong", {}, `${(par + z.field).toFixed(2)}`), ` (${fmtPar(z.field)} to par)`]),
      usePlayer && z.player != null && !z.toGo ? el("p", {}, [`${who.label}: `, el("strong", {}, `${(par + z.player).toFixed(2)}`), ` (${fmtPar(z.player)}), from their strokes gained from here`]) : null,
      // (update 464) in plain words: harder or easier than the usual from that far out, and its share of that part of the
      // game's attempts on this hole (this pin)
      el("p", { class: "muted small" }, [z.L === "tee" ? "The tee" : `${Math.abs(z.diff) < 0.005 ? "Plays about average" : `Plays ${Math.abs(z.diff).toFixed(2)} ${Math.abs(z.diff) >= 0.995 && Math.abs(z.diff) < 1.005 ? "stroke" : "strokes"} ${z.diff > 0 ? "harder" : "easier"} than average`} from this distance${z.dp ? ` (${Math.round(z.dp)} yds)` : ""}`,
        Z.hasN && z.n ? (kOf(st.hole, par) ? ` · ${z.n.toLocaleString()} of ${Z.total.toLocaleString()} ${["", "tee shots", "second shots", "third shots"][kOf(st.hole, par)]} finished here (${Math.round((100 * z.n) / (Z.total || 1)) < 1 ? "under 1" : Math.round((100 * z.n) / (Z.total || 1))}%)`
          : ` · ${z.n.toLocaleString()} ${z.n === 1 ? "shot" : "shots"}${catShare != null ? ` (${catShare < 1 ? "under 1" : catShare}% of the ${CAT_NAME[cat]} attempts on this hole)` : ""}`) : ""]),
      el("table", { class: "plain sh-pop-t" }, [el("thead", {}, el("tr", {}, [el("th", {}, "Lie"), el("th", {}, "Distance"), Z.hasN ? el("th", { class: "num" }, "Shots") : null, el("th", { class: "num" }, z.toGo ? "To hole out" : "Tour"), usePlayer ? el("th", { class: "num" }, who.label.split(" ")[0]) : null])),
        el("tbody", {}, rows.map((q) => el("tr", {}, [el("td", {}, q.lie || "—"), el("td", {}, q.d || "—"), Z.hasN ? el("td", { class: "num" }, q.n ? q.n.toLocaleString() : "—") : null, el("td", { class: "num" }, z.toGo ? q.v.toFixed(2) : fmtPar(q.f)),
          usePlayer ? el("td", { class: "num", title: q.sk ? `${q.sk.sg >= 0 ? "Gains" : "Loses"} ${Math.abs(q.sk.sg).toFixed(3)} a shot${q.sk.band ? ` at ${q.sk.band}` : ""}${q.sk.lie ? ` from the ${q.sk.lie}` : ""} (${Math.round(q.sk.shots)} shots)` : null }, z.toGo ? (q.v - (q.sk?.sg || 0)).toFixed(2) : fmtPar(q.p)) : null])))]),
    ]);
    pop.hidden = false;
    // a spot off the screen (zoomed in, from the list): brought into view first
    { const [px, py] = screenOf(tapAt.x, tapAt.y), sr = stage.getBoundingClientRect(); if (px < 0 || py < 0 || px > sr.width || py > sr.height) { zm.tx += sr.width / 2 - px; zm.ty += sr.height / 2 - py; clampZoom(); applyZoom(); } }
    placeDot();
    requestAnimationFrame(placeDot);
  }

  // the zones redraw when the picture changes size (a turned phone, a narrower window)
  let rT = null; new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(() => { const was = rot; setGeom(); if (was !== rot) pop.hidden = true; drawAll(); }, 80); }).observe(stage);
  // (update 461) zoom and drag: pinch (two fingers), the wheel (or a trackpad pinch), + / −; one finger or the mouse drags
  // when zoomed in; at the whole hole a sideways swipe still changes holes and an up-down one scrolls the page
  const zm = { z: 1, tx: 0, ty: 0, moved: false };
  let sharpT = null;
  function clampZoom() { const w = stage.clientWidth, h = stage.clientHeight; zm.z = Math.max(1, Math.min(6, zm.z)); zm.tx = Math.min(0, Math.max(w - w * zm.z, zm.tx)); zm.ty = Math.min(0, Math.max(h - h * zm.z, zm.ty)); }
  function applyZoom(sharpen = true) {
    zoomBox.style.transform = `translate(${zm.tx}px, ${zm.ty}px) scale(${zm.z})`;
    stage.classList.toggle("zoomed", zm.z > 1.001); zFit.hidden = zm.z <= 1.001; zOut.disabled = zm.z <= 1.001; zIn.disabled = zm.z >= 6;
    placeDot();
    clearTimeout(sharpT); if (sharpen) sharpT = setTimeout(drawAll, 140); // (redrawn at the new size once it settles: sharp)
  }
  function zoomAt(f, cx, cy) { const nz = Math.max(1, Math.min(6, zm.z * f)), k = nz / zm.z; zm.tx = cx - (cx - zm.tx) * k; zm.ty = cy - (cy - zm.ty) * k; zm.z = nz; clampZoom(); applyZoom(); }
  function resetZoom(draw = true) { zm.z = 1; zm.tx = 0; zm.ty = 0; zoomBox.style.transform = ""; stage.classList.remove("zoomed"); zFit.hidden = true; zOut.disabled = true; zIn.disabled = false; if (draw) drawAll(); }
  const mid = () => [stage.clientWidth / 2, stage.clientHeight / 2];
  zIn.addEventListener("click", (e) => { e.stopPropagation(); zoomAt(1.6, ...mid()); });
  zOut.addEventListener("click", (e) => { e.stopPropagation(); zoomAt(1 / 1.6, ...mid()); });
  zFit.addEventListener("click", (e) => { e.stopPropagation(); resetZoom(); });
  stage.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && zm.z <= 1.001) return; // (at the whole hole the wheel scrolls the page; Ctrl + wheel, or a trackpad pinch, zooms)
    e.preventDefault(); const sr = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX - sr.left, e.clientY - sr.top);
  }, { passive: false });
  // the mouse: drag to look around
  let md = null;
  stage.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || zm.z <= 1.001 || e.target.closest(".sh-pop, .sh-zbar")) return; md = { x: e.clientX, y: e.clientY, tx: zm.tx, ty: zm.ty }; zm.moved = false; });
  window.addEventListener("pointermove", (e) => { if (!md) return; const dx = e.clientX - md.x, dy = e.clientY - md.y; if (Math.abs(dx) + Math.abs(dy) > 4) zm.moved = true; zm.tx = md.tx + dx; zm.ty = md.ty + dy; clampZoom(); applyZoom(false); });
  window.addEventListener("pointerup", () => { if (md) { md = null; if (zm.moved) drawAll(); } });
  // fingers: pinch to zoom, drag when zoomed, swipe for the next / previous hole when not
  let tg = null;
  const dist2 = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  stage.addEventListener("touchstart", (e) => {
    if (e.target.closest(".sh-pop, .sh-zbar")) return;
    const sr = stage.getBoundingClientRect(), t = e.touches;
    if (t.length === 2) tg = { pinch: true, d: dist2(t), z: zm.z, cx: (t[0].clientX + t[1].clientX) / 2 - sr.left, cy: (t[0].clientY + t[1].clientY) / 2 - sr.top, tx: zm.tx, ty: zm.ty };
    else if (t.length === 1) tg = { pinch: false, x: t[0].clientX, y: t[0].clientY, tx: zm.tx, ty: zm.ty, zoomed: zm.z > 1.001 };
    zm.moved = false;
  }, { passive: true });
  stage.addEventListener("touchmove", (e) => {
    if (!tg) return;
    const t = e.touches;
    if (tg.pinch && t.length === 2) {
      e.preventDefault();
      const sr = stage.getBoundingClientRect(), cx = (t[0].clientX + t[1].clientX) / 2 - sr.left, cy = (t[0].clientY + t[1].clientY) / 2 - sr.top;
      const nz = Math.max(1, Math.min(6, tg.z * dist2(t) / tg.d)), k = nz / tg.z;
      zm.z = nz; zm.tx = cx - (tg.cx - tg.tx) * k; zm.ty = cy - (tg.cy - tg.ty) * k; zm.moved = true; clampZoom(); applyZoom(false);
    } else if (!tg.pinch && t.length === 1 && tg.zoomed) {
      e.preventDefault();
      const dx = t[0].clientX - tg.x, dy = t[0].clientY - tg.y; if (Math.abs(dx) + Math.abs(dy) > 6) zm.moved = true;
      zm.tx = tg.tx + dx; zm.ty = tg.ty + dy; clampZoom(); applyZoom(false);
    }
  }, { passive: false });
  stage.addEventListener("touchend", (e) => {
    if (!tg) return;
    if (tg.pinch || tg.zoomed) { if (!e.touches.length) { if (zm.moved) drawAll(); tg = null; } return; }
    const c = e.changedTouches[0], dx = c.clientX - tg.x, dy = c.clientY - tg.y; tg = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { zm.moved = true; go(dx < 0 ? 1 : -1); }
  });

  /* ---------------- (update 479) hole history and past shots ---------------- */
  const SC = { "-2": "Eagle+", "-1": "Birdie", "0": "Par", "1": "Bogey", "2": "Double+" };
  const scName = (s) => (s <= -2 ? "Eagle or better" : s === -1 ? "Birdie" : s === 0 ? "Par" : s === 1 ? "Bogey" : s === 2 ? "Double bogey" : s > 2 ? `+${s}` : "");
  const scColor = (s) => (s <= -2 ? "#7d6bff" : s === -1 ? "#3d9cff" : s === 0 ? "#f2f2f2" : s === 1 ? "#ff9f43" : "#ff453a");
  // (update 490) a row each: who, a bar of how the hole was scored (eagle+ to double+), the average to par; the counts on a
  // tap (or hover), the colours' key once below
  const histLine = (label, h, extra = null) => {
    const n = Object.values(h || {}).reduce((t, v) => t + v, 0); if (!n) return null;
    const avg = Object.entries(h).reduce((t, [k, v]) => t + Number(k) * v, 0) / n; // (doubles and worse counted as +2)
    const ks = ["-2", "-1", "0", "1", "2"].filter((k) => h[k]);
    const detail = `${n} ${n === 1 ? "round" : "rounds"} \u00b7 avg ${(par + avg).toFixed(2)} \u00b7 ${ks.map((k) => `${SC[k]} ${h[k]}`).join(", ")}`;
    const bar = el("span", { class: "sh-hb" }, ks.map((k) => { const p = (100 * h[k]) / n; return el("i", { style: `width:${p}%;background:${scColor(Number(k))}`, class: k === "0" ? "par" : null }, p >= 14 ? `${Math.round(p)}%` : ""); }));
    const row = el("button", { type: "button", class: "sh-hl", title: detail, "aria-label": `${label}: ${detail}` }, [
      el("span", { class: "sh-hl-k" }, [label, el("small", {}, `${n} rds`)]), bar,
      el("strong", { class: `sh-hl-avg ${avg > 0.005 ? "neg" : avg < -0.005 ? "pos" : ""}` }, avg > 0.005 ? `+${avg.toFixed(2)}` : avg < -0.005 ? `\u2212${Math.abs(avg).toFixed(2)}` : "E")]);
    const more = el("div", { class: "muted small sh-hl-more", hidden: true }, detail);
    row.addEventListener("click", () => { more.hidden = !more.hidden; });
    return el("div", { class: "sh-hl-wrap" }, [row, more, extra]);
  };
  const histKey = () => el("div", { class: "sh-hl-key" }, ["-2", "-1", "0", "1", "2"].map((k) => el("span", {}, [el("i", { style: `background:${scColor(Number(k))}` }), SC[k]])));
  const myTrails = () => (trails?.trails || []).filter((t) => Number(t.h) === Number(st.hole));
  function drawHist() {
    const n = st.hole, H = data.holes?.[n];
    if (!data.shots || !H) { mount(hist, null); pastBtn.hidden = true; return; }
    const pinId = st.pin[n], P = H.pins?.[pinId];
    const pins = Object.keys(H.pins || {}).length;
    const lines = [histLine(pins > 1 ? "This pin" : "Field", P?.hist)]; // (update 494: no All pins line)
    const mine = isP() && who ? myTrails() : [];
    if (mine.length) { const h = {}; for (const t of mine) if (t.s != null) { const k = String(Math.max(-2, Math.min(2, t.s))); h[k] = (h[k] || 0) + 1; } lines.push(histLine(who.label.split(" ")[0] || who.label, h)); }
    // (update 480) Player view with no past shots: say why (not in this course's shot data, or not on this hole)
    if (isP() && who && !mine.length && data.shots) {
      const nP = Object.keys(meta.players || {}).length, inData = !!meta.players?.[who.key];
      lines.push(el("p", { class: "muted small sh-hl-none" }, inData ? `No past shots for ${who.label} on this hole.` : `No shots for ${who.label} in this course\u2019s shot data${nP ? ` (it has ${nP} players, matched by playerID)` : ""}.`));
    }
    const shown = lines.filter(Boolean);
    mount(hist, shown.length ? [...shown, histKey()] : null);
    pastBtn.hidden = !(isP() && mine.length);
    pastBtn.textContent = st.showPast ? "Hide Past Shots" : `Show Past Shots (${mine.length})`;
    pastBtn.classList.toggle("on", !!st.showPast);
  }
  pastBtn.addEventListener("click", (e) => { e.stopPropagation(); st.showPast = !st.showPast; drawHist(); drawTrails(); });
  // (update 491) up & down by where the approach missed the green (app_side_loc), for this pin (a combined pin: its pins
  // added up): a grid around the green, each side's share got up and down, then by the lie it left
  // (update 492) off the tee: the scoring after a left miss, the fairway and a right miss (drive_direction), this pin (a
  // combined pin: its pins added up; a course uploaded before update 492: the hole's)
  function drawTee() {
    const n = st.hole, X = data.insights?.holes?.[n], pid = st.pin[n];
    if (!X || (X.par || par) < 4) { teeBox.hidden = true; mount(teeBox, null); return; }
    const ids = pinNow?.merged || [pid], D = {};
    const src = X.drivePins ? ids.map((id) => X.drivePins[id]).filter(Boolean) : [X.drive];
    for (const o of src) for (const [k, a] of Object.entries(o || {})) { const b = (D[k] ||= [0, 0]); b[0] += a[0]; b[1] += a[1]; }
    const avg = (k) => (D[k]?.[0] >= 5 ? par + D[k][1] / D[k][0] : null), L = avg("L"), C = avg("C"), R = avg("R");
    if (L == null && R == null) { teeBox.hidden = true; mount(teeBox, null); return; }
    const worse = L != null && R != null && Math.abs(L - R) >= 0.02 ? (L > R ? "L" : "R") : null;
    // (update 494) one compact row under the scoring bar: left miss · fairway · right miss, the worse miss in red
    const chip = (k, label, v) => el("span", { class: `sh-tee-chip${worse === k ? " worse" : ""}`, title: D[k]?.[0] ? `${D[k][0]} tee shots` : null }, [el("small", {}, label), el("strong", {}, v == null ? "\u2014" : v.toFixed(2))]);
    teeBox.hidden = false;
    mount(teeBox, [el("span", { class: "sh-hl-k" }, ["Off the tee", el("small", {}, worse ? `${worse === "L" ? "left" : "right"} +${Math.abs(L - R).toFixed(2)}` : "avg score")]),
      el("span", { class: "sh-tee-chips" }, [chip("L", "Left", L), chip("C", "Fairway", C), chip("R", "Right", R)])]);
  }
  // (update 497) the up & down board over the green for this pin's usual approach line: the green's front and back edges
  // and its sides, the lines of a tic-tac-toe board (Show on map)
  function drawBoard() {
    while (bdSvg.firstChild) bdSvg.removeChild(bdSvg.firstChild);
    const n = st.hole, ids = pinNow?.merged || [st.pin[n]], B = ids.map((id) => data.insights?.holes?.[n]?.udBoards?.[id]).find(Boolean);
    const show = st.showBoard && B && size.w;
    bdSvg.style.display = show ? "" : "none";
    if (!show) return;
    const W = size.w, Hh = size.h;
    bdSvg.setAttribute("viewBox", rot ? `0 0 ${Hh} ${W}` : `0 0 ${W} ${Hh}`);
    const g = sv("g", rot ? { transform: `translate(0 ${W}) rotate(-90)` } : {}); bdSvg.appendChild(g);
    const P = (al, la) => [B.gx + al * B.ux - la * B.uy, B.gy + al * B.uy + la * B.ux], e = 0.8 * Math.max(B.a1 - B.a0, B.l1 - B.l0);
    const line = (p, q) => { const d = `M${p[0]} ${p[1]} L${q[0]} ${q[1]}`; g.appendChild(sv("path", { d, stroke: "rgba(0,0,0,0.6)", "stroke-width": 4, "vector-effect": "non-scaling-stroke", fill: "none" })); g.appendChild(sv("path", { d, stroke: "#fff", "stroke-width": 2, "stroke-dasharray": "6 4", "vector-effect": "non-scaling-stroke", fill: "none" })); };
    for (const al of [B.a0, B.a1]) line(P(al, B.l0 - e), P(al, B.l1 + e));
    for (const la of [B.l0, B.l1]) line(P(B.a0 - e, la), P(B.a1 + e, la));
    // the approach's direction: an arrow coming in from short of the green
    const t0 = P(B.a0 - e * 1.6, 0), t1 = P(B.a0 - e * 0.25, 0);
    g.appendChild(sv("path", { d: `M${t0[0]} ${t0[1]} L${t1[0]} ${t1[1]}`, stroke: "#ffd60a", "stroke-width": 2.5, "vector-effect": "non-scaling-stroke", fill: "none", "marker-end": "url(#sh-arrow)" }));
    const defs = sv("defs"); const m = sv("marker", { id: "sh-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }); m.appendChild(sv("path", { d: "M0 0 L10 5 L0 10 z", fill: "#ffd60a" })); defs.appendChild(m); bdSvg.insertBefore(defs, g);
  }
  function drawUD() {
    const n = st.hole, X = data.insights?.holes?.[n], pid = st.pin[n];
    const ids = pinNow?.merged || [pid], U = {};
    for (const id of ids) for (const [side, lies] of Object.entries(X?.udPins?.[id] || {})) for (const [lie, a] of Object.entries(lies)) { const o = (U[side] ||= {}), b = (o[lie] ||= [0, 0]); b[0] += a[0]; b[1] += a[1]; }
    if (!Object.keys(U).length) { udBox.hidden = true; mount(udBox, null); return; }
    const col = (p) => (p == null ? "" : p >= 75 ? "good" : p >= 50 ? "mid" : "bad");
    const cell = (side) => {
      const o = U[side] || {}, tot = Object.values(o).reduce((t, a) => [t[0] + a[0], t[1] + a[1]], [0, 0]);
      const p = tot[0] >= 3 ? Math.round((100 * tot[1]) / tot[0]) : null;
      const lies = [["Fairway", "Fwy"], ["Rough", "Rgh"], ["Bunker", "Bnk"]].filter(([l]) => o[l]?.[0] >= 3).map(([l, s2]) => `${s2} ${Math.round((100 * o[l][1]) / o[l][0])}`);
      return el("div", { class: `sh-ud-c ${col(p)}`, title: tot[0] ? `${side.replace("-", " ")}: ${tot[1]} of ${tot[0]} got up and down` : null }, [
        el("span", { class: "sh-ud-k" }, side.replace("-", " ")),
        el("strong", {}, p == null ? "\u2014" : `${p}%`),
        el("span", { class: "sh-ud-l" }, p == null ? (tot[0] ? `${tot[0]} ${tot[0] === 1 ? "miss" : "misses"}` : "") : lies.join(" \u00b7 ") || `${tot[0]} misses`)]);
    };
    udBox.hidden = false;
    const hasB = (pinNow?.merged || [pid]).some((id) => X?.udBoards?.[id]);
    const tog = hasB ? el("button", { type: "button", class: `link small sh-ud-tog${st.showBoard ? " on" : ""}` }, st.showBoard ? "Hide on map" : "Show on map") : null;
    tog?.addEventListener("click", () => { st.showBoard = !st.showBoard; drawUD(); drawBoard(); if (st.showBoard) stage.scrollIntoView({ behavior: "smooth", block: "center" }); });
    // (update 498) the admin: maps an older version built (the up & down sides worked out the old way) say so
    const stale = isAdmin && meta.builtVersion !== BUILD_VERSION ? el("p", { class: "sh-ud-stale" }, meta.rawChunks ? "These maps were built by an older version. Press Rebuild maps on Upload Data \u203a Strategy Maps to rebuild them from the saved shots." : "No shots saved on the site for this course yet, so its maps can\u2019t be rebuilt: upload it once with the new course_upload.py (update 496), then press Rebuild maps on Upload Data \u203a Strategy Maps.") : null;
    mount(udBox, [el("div", { class: "sh-ud-h" }, [el("strong", {}, "Up & down by miss"), el("span", { class: "muted small" }, "this pin \u00b7 within 30 yds of the green"), tog]), stale,
      el("div", { class: "sh-ud-grid" }, [cell("Long-Left"), cell("Long"), cell("Long-Right"), cell("Left"), el("div", { class: "sh-ud-green", "aria-hidden": "true" }, el("i")), cell("Right"), cell("Short-Left"), cell("Short"), cell("Short-Right")])]);
  }
  // (update 487) the past shots: only the leg of the shot picked (Shot 1: tee to where it finished), a score's trails from
  // the key (Birdie, Par …: tap to show only those, tap more to add, again to take away), one trail from a tap on it
  const trState = { hole: null, scores: new Set(), one: null };
  const legOf = (t, k, pin) => {
    const pts = t.shots.map((q) => [q[1], q[2], q[0]]);
    if (t.s != null && pin?.x != null) pts.push([pin.x, pin.y, Infinity]); // (the last shot went in)
    if (!k) return pts;
    const a = pts.findIndex((q) => q[2] === k);
    return a < 0 || a + 1 >= pts.length ? null : [pts[a], pts[a + 1]];
  };
  function drawTrails() {
    while (trSvg.firstChild) trSvg.removeChild(trSvg.firstChild);
    const show = st.showPast && isP() && who && size.w;
    trSvg.style.display = show ? "" : "none";
    trKey.hidden = !show;
    if (!show) return;
    if (trState.hole !== `${meta.id}|${st.hole}`) { trState.hole = `${meta.id}|${st.hole}`; trState.scores.clear(); trState.one = null; }
    const W = size.w, Hh = size.h, H = data.holes?.[st.hole], k = kOf(st.hole, par);
    const sc = (t) => Math.max(-2, Math.min(2, t.s ?? 0));
    const all = myTrails().map((t) => ({ t, leg: legOf(t, 0, H?.pins?.[t.p]) })).filter((x) => x.leg && x.leg.length > 1); // (update 494: the whole trail again)
    if (trState.one && !all.some((x) => x.t === trState.one)) trState.one = null;
    const shown = all.filter((x) => (trState.one ? x.t === trState.one : !trState.scores.size || trState.scores.has(sc(x.t))));
    // the key: each score with how many, a button that filters
    const counts = new Map(); for (const x of all) counts.set(sc(x.t), (counts.get(sc(x.t)) || 0) + 1);
    const chips = [-2, -1, 0, 1, 2].filter((v) => counts.get(v)).map((v) => {
      const on = !trState.one && (!trState.scores.size || trState.scores.has(v));
      const b = el("button", { type: "button", class: `sh-lg sh-lg-btn${on ? "" : " off"}`, "aria-pressed": String(trState.scores.has(v)), title: `Only the ${SC[String(v)].toLowerCase()}s (tap more to add)` }, [el("i", { style: `background:${scColor(v)}` }), `${SC[String(v)]} ${counts.get(v)}`]);
      b.addEventListener("click", () => { trState.one = null; if (trState.scores.has(v)) trState.scores.delete(v); else trState.scores.add(v); if (trState.scores.size === counts.size) trState.scores.clear(); pop.hidden = true; drawTrails(); });
      return b;
    });
    const filtered = trState.one || trState.scores.size;
    const allBtn = filtered ? el("button", { type: "button", class: "link small sh-lg-all" }, "Show all") : null;
    allBtn?.addEventListener("click", () => { trState.one = null; trState.scores.clear(); pop.hidden = true; drawTrails(); });
    mount(trKey, [el("span", { class: "muted small" }, "Past shots:"), ...chips, allBtn,
      null]);
    trSvg.setAttribute("viewBox", rot ? `0 0 ${Hh} ${W}` : `0 0 ${W} ${Hh}`);
    const g = sv("g", rot ? { transform: `translate(0 ${W}) rotate(-90)` } : {}); trSvg.appendChild(g);
    const r0 = Math.max(W, Hh) / 400;
    for (const { t, leg } of shown) {
      const d = leg.map((q, i) => `${i ? "L" : "M"}${q[0]} ${q[1]}`).join(" "), col = scColor(t.s ?? 0), wide = trState.one === t;
      // (update 494) each trail a little see-through, so two on top of each other show darker
      const tg = sv("g", { opacity: wide ? 1 : 0.6 }); g.appendChild(tg);
      tg.appendChild(sv("path", { d, fill: "none", stroke: "rgba(0,0,0,0.55)", "stroke-width": wide ? 6 : 4, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
      tg.appendChild(sv("path", { d, fill: "none", stroke: col, "stroke-width": wide ? 3.5 : 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
      for (const q of leg) if (Number.isFinite(q[2])) tg.appendChild(sv("circle", { cx: q[0], cy: q[1], r: r0, fill: col, stroke: "#111", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
      const hit = sv("path", { d, fill: "none", stroke: "transparent", "stroke-width": 14, "vector-effect": "non-scaling-stroke", class: "sh-trail-hit" });
      hit.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && !trState.one) trailPop(t, e); });
      // a tap: only this one (and its details); tapped again, all of them back
      hit.addEventListener("click", (e) => { e.stopPropagation(); trState.one = trState.one === t ? null : t; drawTrails(); if (trState.one) trailPop(t, e); else pop.hidden = true; });
      g.appendChild(hit);
    }
  }
  function trailPop(t, e) {
    const sr = stage.getBoundingClientRect(), px = e.clientX - sr.left, py = e.clientY - sr.top;
    const x = el("button", { type: "button", class: "sh-pop-x", "aria-label": "Close" }, "\u2715"); x.addEventListener("click", () => { pop.hidden = true; });
    const pinName = (() => { const b = [...pinBar.querySelectorAll(".sh-pin")].find((q) => q.title === String(t.p)); return b ? b.textContent : String(t.p).replace(/[-_]+/g, " "); })();
    const fmtD = (q) => (q[4] == null ? "" : `${Math.round(q[4])} ${q[3] === 4 ? "ft" : "yds"}`);
    mount(pop, [el("div", { class: "sh-pop-h" }, [el("strong", { style: `color:${scColor(t.s ?? 0)}` }, `${t.s != null ? `${scName(t.s)} (${par + t.s})` : "Unfinished"}`), x]),
      el("p", { class: "muted small" }, `${t.y ? `${t.y} \u00b7 ` : ""}Round ${t.r || "?"} \u00b7 ${pinName}`),
      el("ol", { class: "sh-tr-list" }, [...t.shots.map((q) => el("li", { class: q[0] === kOf(st.hole, par) ? "on" : null }, [el("strong", {}, LIE_NAMES[q[3]] || "Shot"), ` ${fmtD(q)}`, q[5] != null ? el("span", { class: "muted" }, ` \u00b7 ${Number(q[5]).toFixed(0)} to hole out`) : null])),]), t.s != null ? el("p", { class: "sh-tr-in" }, "\u2713 In the hole") : null]);
    pop.hidden = false; tapAt = null; dot.hidden = true;
    requestAnimationFrame(() => placePop(px, py));
  }
  async function loadWho() {
    ix = null; mineHere = null; trails = null;
    if (!who) { whoLine.textContent = ""; paint(); return; }
    const me = who; whoLine.textContent = `Loading ${who.label}’s stats…`; paint();
    // (update 479) their own shots here first (they don't need a stats file)
    trails = await playerTrails(meta, me.key).catch(() => null);
    if (who !== me) return;
    paint();
    try {
      const d = await playerData(me.key);
      if (who !== me) return;
      ix = d.rounds.length ? skillIndex(d.rounds) : null;
      mineHere = d.rounds.filter((rd) => sameCourse(rd.course, course.name));
      const sgR = mineHere.length ? mineHere.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + s.sg, 0), 0) / mineHere.length : null;
      const link = el("button", { type: "button", class: "link" }, "Course History ›"); link.addEventListener("click", () => ctx.go({ name: "prepHistory", course }));
      // (update 461) one flat list (a list inside it is what made this say it couldn't load their stats)
      mount(whoLine, !d.rounds.length ? `No stats file for ${me.label} yet, so the zones show the field.` : [`Player view: the zones weighted by ${me.label}’s strokes gained from each distance and lie. `,
        ...(mineHere.length ? [`${mineHere.length} ${mineHere.length === 1 ? "round" : "rounds"} here (${sgR >= 0 ? "+" : "−"}${Math.abs(sgR).toFixed(2)} a round). `, link] : [`No rounds here in the stats yet.`])]);
    } catch (err) { console.error(err); whoLine.textContent = "Couldn’t load their stats, so the zones show the field."; }
    paint();
  }
  showHole();
  if (who) loadWho();
}
const RD = [[5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31]];
function rgbAt(t) { const x = Math.max(0, Math.min(1, t)) * (RD.length - 1), i = Math.min(RD.length - 2, Math.floor(x)), f = x - i; return RD[i].map((c, k) => Math.round(c + (RD[i + 1][k] - c) * f)).join(","); }
