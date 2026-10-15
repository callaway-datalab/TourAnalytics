/*
 * Practice pieces shared by sessions, rounds, games and Launch Data (update 138): the shot card (the made-up hole,
 * green or putt, the aim map, and entering the result), the shot text, tiles, tables and patterns.
 */
import { el, mount } from "../ui.js";
import { teeResult, greenResult, fairwayX, puttLevels, withFall, fallOf, fallText, FALL_SEV, myAimText } from "../practice/model.js";
// (update 157) the red dot on the picture, where what you've typed puts the ball
const previewAt = (from, pt) => from.closest(".pr-shot")?.querySelector(".pr-visual svg")?.__preview?.(pt);
import { holeSvg, greenSvg, puttSvg, planeSvg, scatterSvg, driveScatterSvg } from "../practice/draw.js";
import { resultFromSpeech } from "../practice/analysis.js";

/** The red microphone (the same as Enter New Round's voice input), with a label. */
export function micIcon() {
  const span = el("span", { class: "mic-icon", "aria-hidden": "true" });
  span.innerHTML = '<svg viewBox="0 0 40 40" width="22" height="22"><circle cx="20" cy="20" r="20" fill="#e5252a"/><rect x="15.5" y="7.5" width="9" height="16" rx="4.5" fill="#fff"/><path d="M12 19.5a8 8 0 0 0 16 0" fill="none" stroke="#fff" stroke-width="2"/><line x1="20" y1="27.5" x2="20" y2="31.5" stroke="#fff" stroke-width="2"/><line x1="15.5" y1="32" x2="24.5" y2="32" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
  return span;
}
export const sayKids = (text) => [micIcon(), el("span", {}, text)];

export const SG = (v, dp = 2) => (v == null || Number.isNaN(v) ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(dp)}`);
export const sgCls = (v) => (v == null ? "" : v >= 0.005 ? "pos" : v <= -0.005 ? "neg" : "");
export const n1 = (v, u = "") => (v == null || Number.isNaN(v) ? "\u2014" : `${Math.round(v * 10) / 10}${u}`);
export const p0 = (v) => (v == null ? "\u2014" : `${Math.round(v)}%`);

/**
 * One shot to play: the header (with the hole's detail), the picture with its aim map, the result and how to enter it.
 *   opts: { shot, stimp, aim: { spread, label } , eyebrow, title, onPrev, onNext, onResult(r), next: { label, onClick }, more: [elements],
 *           heat: { on, set(v) } }
 * onResult is called with each result (or null when it's cleared); the card redraws itself.
 */
/** "Club" for a shot (update 145): your bag (WITB) if you have one, else the usual clubs. */
export function clubSelect(clubs, value, onChange) {
  const sel = el("select", { class: "pr-club-sel", "aria-label": "Club used" }, [el("option", { value: "" }, "Club\u2026"), ...clubs.map((c) => el("option", { value: c, selected: c === value }, c))]);
  if (value && !clubs.includes(value)) sel.appendChild(el("option", { value, selected: true }, value));
  sel.addEventListener("change", () => onChange(sel.value || null));
  return el("label", { class: "pr-club-row" }, [el("span", { class: "rd-label" }, "Club"), sel]);
}

export function shotCard({ shot, stimp = 11, aim: aimInfo = null, eyebrow = "", title = null, onPrev = null, onNext = null, onResult, next = null, more = [], heat = { on: true, set() {} }, clubs = null, onClub = null, monitor = false, fixedAim = false, onStimp = null }) {
  let showHeat = false; // the strokes gained map: off to start, every shot (update 154)
  const carry = shot.kind === "tee" ? shot.carry || (shot.club === "3 wood" ? 260 : shot.club === "Iron" ? 225 : 290) : null;
  // the target: down the middle of the fairway (round a dogleg) or at the pin; no "best aim" (update 154)
  // (update 156) hold the end of the target line and drag it: kept with the shot
  let aim = shot.kind === "putt" ? null : shot.aimAt || (shot.kind === "tee" ? { x: fairwayX(shot, Math.min(carry, shot.hole - 40)), y: Math.min(carry, shot.hole - 40) } : { x: shot.pin.x, y: shot.pin.y });
  const onAim = (x, y) => { aim = { x, y }; shot.aimAt = aim; onClub?.(); drawVisual(); drawInputs(); };
  void fixedAim; void aimInfo;
  const visual = el("div", { class: "pr-visual" });
  const resultLine = el("p", { class: "pr-result", "aria-live": "polite" });
  const inputs = el("div", { class: "pr-inputs" });
  const setResult = (r) => {
    onResult(r);
    drawVisual(); drawResult();
    // typed into a box: leave the boxes as they are (rebuilding them mid-typing loses your place)
    const typing = r?.source === "typed" && inputs.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
    if (typing || !r) { const nb = inputs.querySelector(".pr-next"); if (nb) nb.disabled = !r && !next?.always; } else drawInputs();
  };
  const drawVisual = () => {
    const r = shot.result;
    if (shot.kind === "tee") mount(visual, holeSvg(shot, { aim, onAim, showHeat, carry, result: r && r.total != null ? r : null, onTap: (total, offline) => setResult({ ...teeResult(shot, total, offline), total, offline, source: "tap" }) }));
    else if (shot.kind === "putt") mount(visual, puttSvg(shot, { stimp, showHeat, result: r && r.x != null ? r : null, onTap: (x, y) => { const d = Math.round(Math.hypot(x, y) * 10) / 10; setResult(d <= 0.25 ? { lie: "Holed", dist: 0, unit: "ft", x: 0, y: 0, source: "tap" } : { lie: "Green", dist: d, unit: "ft", x, y, source: "tap" }); } }));
    else mount(visual, greenSvg(shot, { aim, onAim, showHeat, result: r && r.x != null ? r : null, onTap: (x, y) => setResult({ ...greenResult(shot, x, y), source: "tap" }) }));
  };
  const drawResult = () => {
    const r = shot.result;
    if (!r) { mount(resultLine, null); return; }
    const relOff = shot.kind === "tee" ? Math.round(r.offline - aimLineX(aim, r.total || 0)) : 0;
    const where = shot.kind === "tee" ? `${r.zone || r.lie} \u00b7 ${r.total} yds, ${relOff ? `${Math.abs(relOff)} ${relOff < 0 ? "left" : "right"} of your line` : "on your line"}${r.penalty ? "" : ` \u00b7 ${r.dist} to go`}`
      : r.lie === "Holed" ? "In the hole!" : r.penalty === "ob" ? `${r.zone || "Out of bounds"} \u00b7 stroke and distance` : r.penalty ? "Water \u00b7 penalty stroke" : `${r.lie} \u00b7 ${n1(r.dist)} ${r.unit}`;
    mount(resultLine, [el("span", {}, where), el("strong", { class: `pr-sgchip ${sgCls(shot.sg)}` }, `${SG(shot.sg)} SG`)]);
  };
  // a launch monitor session: no typing, just Next (the file fills the result in at the end)
  const monNext = () => { const b = el("button", { type: "button", class: "btn pr-next" }, next.label); b.addEventListener("click", () => next.onClick()); return el("div", { class: "pr-mon-next" }, b); };
  function drawInputs() { mount(inputs, monitor && next && !shot.result ? monNext() : inputsFor(shot, setResult, next, { aim })); }
  drawVisual(); drawResult(); drawInputs();
  // a putt (update 151): set its break and slope to match the putt in front of you; the plane tilts to show it
  const titleH = el("h2", {}, title || shotTitle(shot));
  const factsDl = el("dl", { class: "pr-facts" });
  const drawFacts = () => { mount(factsDl, shotFacts(shot, stimp).map(([k, v]) => el("div", {}, [el("dt", {}, k), el("dd", {}, v)]))); if (!title) titleH.textContent = shotTitle(shot); };
  drawFacts();
  let slopeBox = null;
  if (shot.kind === "putt") {
    const plane = el("div", { class: "pr-plane-box" });
    const drawPlane = () => { const lv = puttLevels(shot); mount(plane, planeSvg(lv.side, lv.fwd)); };
    const opt = (val, label, cur) => el("option", { value: String(val), selected: val === cur }, label);
    // (update 157) the fall line: the clock time water would run off the hole (6 o'clock: straight uphill), and how severe
    const f0 = fallOf(shot);
    const clk = el("select", { "aria-label": "Fall line" }, [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((v) => opt(v, `${v} o'clock${v === 12 ? " (downhill)" : v === 6 ? " (uphill)" : v === 3 ? " (breaks right)" : v === 9 ? " (breaks left)" : ""}`, f0.clock)));
    const sev = el("select", { "aria-label": "Slope" }, [0, 1, 2, 3].map((v) => opt(v, FALL_SEV[v], Math.min(3, Math.round(f0.sev)))));
    const change = () => { withFall(shot, Number(clk.value), Number(sev.value)); clk.disabled = sev.value === "0"; drawPlane(); drawVisual(); drawFacts(); onClub?.(); };
    clk.disabled = !f0.sev;
    clk.addEventListener("change", change); sev.addEventListener("change", change);
    drawPlane();
    // the green speed (update 154): the session's, set here for every putt that follows
    const st = el("input", { type: "number", inputmode: "decimal", min: 6, max: 16, step: 0.5, value: stimp, "aria-label": "Green speed (stimp)" });
    st.addEventListener("change", () => { const v = Math.max(6, Math.min(16, Number(st.value) || 11)); st.value = v; stimp = v; onStimp?.(v); drawVisual(); drawFacts(); });
    slopeBox = el("div", { class: "pr-slopes" }, [
      el("div", { class: "pr-slope-pick" }, [el("label", {}, [el("span", { class: "rd-label" }, "Fall line"), clk]), el("label", {}, [el("span", { class: "rd-label" }, "Slope"), sev]), el("label", { class: "pr-stimp-in" }, [el("span", { class: "rd-label" }, "Stimp"), st])]),
      plane,
    ]);
  }
  const heatBtn = el("button", { type: "button", class: `pr-toggle${showHeat ? " on" : ""}`, "aria-pressed": showHeat ? "true" : "false" }, "Strokes gained map");
  heatBtn.addEventListener("click", () => { showHeat = !showHeat; heatBtn.classList.toggle("on", showHeat); heatBtn.setAttribute("aria-pressed", String(showHeat)); drawVisual(); });
  void heat;
  const navBtn = (txt, label, fn) => { const b = el("button", { type: "button", class: "pr-nav", "aria-label": label, disabled: fn ? null : true }, txt); if (fn) b.addEventListener("click", fn); return b; };
  return el("section", { class: "panel pr-shot" }, [
    el("div", { class: "pr-shot-head" }, [navBtn("\u2039", "Previous shot", onPrev), el("div", { class: "pr-shot-t" }, [eyebrow ? el("p", { class: "pr-eyebrow" }, eyebrow) : null, titleH, shot.kind === "putt" ? el("p", { class: "pr-shot-sub" }, shotSub(shot, aim, stimp)) : null]), navBtn("\u203A", "Next shot", onNext)]),
    // (update 160: no write-up of the hole, fairway, sides and bunkers; the picture shows them)
    el("div", { class: "pr-play" }, [
      el("div", { class: "pr-vis-col" }, [visual, el("div", { class: "pr-vis-tools" }, [heatBtn, el("span", { class: "muted small" }, shot.kind === "putt" ? legend(shot) : "Gold: your target. Hold its end and drag to move it.")]), slopeBox]),
      el("div", { class: "pr-in-col" }, [
        clubs && shot.kind !== "putt" ? clubSelect(clubs, shot.clubUsed || null, (v) => { shot.clubUsed = v || undefined; onClub?.(v); }) : null,
        monitor ? el("p", { class: "pr-monitor-note" }, "Using a launch monitor: just hit the shot and tap Next. You'll load the file at the end, and it fills the shots in this order.") : null,
        resultLine, inputs, more.filter(Boolean).length ? el("div", { class: "pr-more" }, more) : null]),
    ]),
  ]);
}

export function shotTitle(x) {
  if (x.kind === "tee") return x.startLie && x.startLie !== "Tee box" ? `${x.hole} yds \u00b7 ${x.startLie.toLowerCase()}, down the fairway` : `${x.club} \u00b7 ${x.hole}-yd par ${x.par}`;
  if (x.kind === "putt") return `${n1(x.startDist)} ft${x.spot ? ` \u00b7 ${x.spot}` : ""} · ${fallText(x) === "Flat" ? "flat" : `fall line ${fallText(x)}`}`;
  if (x.startLie === "Fringe") return `${Math.round(x.startDist * 3)} ft \u00b7 fringe`;
  const lie = x.startLie === "Tee box" ? `tee, par 3` : x.startLie === "Bunker" ? (x.startDist <= 50 ? "greenside bunker" : "fairway bunker") : x.startLie.toLowerCase();
  return `${Math.round(x.startDist)} yds \u00b7 ${lie}`;
}
export function shotSub(x, aim, stimp, aimLabel) {
  const pattern = aimLabel ? ` ${aimLabel}` : "";
  if (x.kind === "tee") {
    const a = aim ? (Math.abs(aim.x) < 1.5 ? "Aim at the middle of the fairway." : `Aim ${Math.round(Math.abs(aim.x))} yds ${aim.x < 0 ? "left" : "right"} of the middle.`) : "";
    return `${a}${pattern}`;
  }
  if (x.kind === "putt") return x.myAim ? `Your aim here: ${myAimText(x.myAim)}.` : `Set the break and slope to match your putt. Stimp ${stimp || 11}.`;
  const off = aim ? Math.hypot(aim.x - x.pin.x, aim.y - x.pin.y) : 0;
  const dir = aim ? [aim.y - x.pin.y > 1.5 ? "long" : aim.y - x.pin.y < -1.5 ? "short" : "", aim.x - x.pin.x > 1.5 ? "right" : aim.x - x.pin.x < -1.5 ? "left" : ""].filter(Boolean).join(" and ") : "";
  return `${off >= 2 && dir ? `Best aim: ${Math.round(off)} yds ${dir} of the pin.` : "Best aim: at the pin."}${pattern}`;
}
/** The detail of each made-up hole / green / putt, as [label, value] pairs. */
const SIDE_KIND = { ob: "Out of bounds", water: "Water", trees: "Trees", bunker: "Waste area", rough: "Rough" };
const where = (x, y, rx, ry) => {
  const fb = y < -0.35 * ry ? "short" : y > 0.35 * ry ? "long" : "", lr = x < -0.35 * rx ? "left" : x > 0.35 * rx ? "right" : "";
  return [fb, lr].filter(Boolean).join("-") || "middle";
};
export function shotFacts(x, stimp) {
  if (x.kind === "tee") {
    const half = x.width / 2;
    const side = (k) => { const t = x.sides[k]; return t.kind === "rough" ? "Rough all the way" : `${SIDE_KIND[t.kind]} ${t.at} yds past the edge (${Math.round(half + t.at)} from the middle)`; };
    const out = [
      ["Fairway", `${x.width} yds wide (${half} either side of the middle)`],
      ["Left", side("left")],
      ["Right", side("right")],
    ];
    if (x.bunker) out.push(["Fairway bunker", `${x.bunker.side < 0 ? "Left" : "Right"} side, ${x.bunker.y0}\u2013${x.bunker.y1} yds off the tee`]);
    return out;
  }
  if (x.kind === "putt") {
    return [
      ["Fall line", fallText(x)],
      x.myAim ? ["Your aim", myAimText(x.myAim)] : ["Green speed", `Stimp ${stimp || 11}`],
    ];
  }
  const { rx, ry } = x.green, { x: px, y: py } = x.pin;
  const ey = ry * Math.sqrt(Math.max(0, 1 - (px / rx) ** 2)), ex = rx * Math.sqrt(Math.max(0, 1 - (py / ry) ** 2));
  const r = (v) => Math.max(0, Math.round(v));
  const trouble = x.hazards.filter((h) => !h.start).map((h) => (h.type === "water" ? `water ${h.side < 0 ? "left" : "right"}` : `bunker ${where(h.cx, h.cy, rx, ry)}`));
  const out = [
    ["Green", `${r(2 * ry)} yds deep, ${r(2 * rx)} wide`],
    ["Pin", `${r(py + ey)} yds on from the front, ${r(ey - py)} from the back`],
    ["Side to side", `${r(px + ex)} yds from the left edge, ${r(ex - px)} from the right`],
    ["Trouble", trouble.length ? trouble.join(", ").replace(/^./, (c) => c.toUpperCase()) : "None"],
  ];
  if (x.startDist <= 50 && x.from) out.push(["Playing from", `${x.startLie === "Bunker" ? "Bunker" : x.startLie}, ${where(x.from.x, x.from.y, rx, ry)} of the green`]);
  return out;
}
export function legend(x) {
  if (x.kind === "putt") return "Arrows: the way it breaks. Rings: 3 and 6 ft.";
  return "Green = fewest strokes left, red = most. Gold ring: best aim.";
}
export function resultText(x) {
  const r = x.result;
  if (!r) return "";
  if (x.kind === "tee") return `${r.zone || r.lie}, ${r.total} yds, ${r.offline ? `${Math.abs(r.offline)} ${r.offline < 0 ? "L" : "R"}` : "on line"}`;
  if (r.lie === "Holed") return "Holed";
  if (r.penalty === "ob") return "Out of bounds";
  if (r.penalty) return "Water";
  return `${r.lie}, ${n1(r.dist)} ${r.unit}`;
}
export function tile(k, v, cls = "", sub = "") {
  return el("div", { class: "pr-tile" }, [el("span", { class: "pr-tile-k" }, k), el("strong", { class: cls }, v), sub ? el("span", { class: "pr-tile-s" }, sub) : null]);
}
export function keyTiles(cat, s) {
  if (!s.n) return [];
  if (cat === "OTT") return [tile("Fairways", p0(s.fairwayPct)), tile("Avg distance", n1(s.avgTotal, " yds")), tile("Avg offline", n1(s.avgOffline, " yds"), "", s.leftPct != null ? `${Math.round(s.leftPct)}% left` : ""), tile("Penalties", p0(s.penaltyPct))];
  if (cat === "PUTT") return [tile("Made", p0(s.makePct)), tile("Avg leave", n1(s.avgLeave, " ft"), "", "misses"), tile("Within 3 ft", p0(s.within3Pct), "", "of misses"), tile("Long", p0(s.longPct), "", "of misses"), tile("Pro side", p0(s.proSidePct), "", "breaking misses")];
  return [tile(cat === "ARG" ? "On the green" : "Greens hit", p0(s.greenPct)), tile("Avg proximity", n1(s.avgProx, " ft")), tile("Median", n1(s.medProx, " ft")), tile("Long", p0(s.longPct)), ...(s.holed ? [tile("Holed", String(s.holed))] : [tile("Water", p0(s.penaltyPct))])];
}
export function bucketTable(cat, rows, course, compact = false) {
  const metric = cat === "OTT" ? ["Fairways", (r) => p0(r.fairwayPct)] : cat === "PUTT" ? ["Made", (r) => p0(r.makePct)] : ["Proximity", (r) => n1(r.avgProx, " ft")];
  const body = rows.filter((r) => r.n || (!compact && course[r.id]?.n)).map((r) => {
    const c = course[r.id], gap = r.sgPer != null && c?.sgPer != null ? r.sgPer - c.sgPer : null;
    return el("tr", {}, [el("td", {}, r.label), el("td", { class: "num" }, String(r.n || "—")), el("td", { class: `num ${sgCls(r.sgPer)}` }, r.n ? SG(r.sgPer) : "—"),
      el("td", { class: "num" }, r.n ? metric[1](r) : "—"), el("td", { class: `num ${sgCls(c?.sgPer)}` }, c?.n ? SG(c.sgPer) : "—"), el("td", { class: `num pr-gap ${sgCls(gap)}` }, gap == null ? "—" : SG(gap))]);
  });
  if (!body.length) return el("p", { class: "muted" }, "No shots yet.");
  return el("div", { class: "table-scroll" }, el("table", { class: "plain pr-btable" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, cat === "OTT" ? "Club" : "Distance"), el("th", { class: "num" }, "Shots"), el("th", { class: "num" }, "SG / shot"), el("th", { class: "num" }, metric[0]), el("th", { class: "num" }, "On course"), el("th", { class: "num", title: "Practice minus on course" }, "Gap")])),
    el("tbody", {}, body),
  ]));
}
export function patternPanel(cat, shots, title) {
  if (!shots.length) return null;
  let svg = null, cap = "";
  if (cat === "OTT") {
    const pts = shots.filter((s) => s.result.total != null).map((s) => ({ x: s.result.offline, y: s.result.total, good: s.result.lie === "Fairway" }));
    svg = driveScatterSvg(pts, { width: 32 }); cap = "Distance and how far off line. Green: in the fairway. The shaded band is a 32-yd fairway.";
  } else if (cat === "PUTT") {
    const pts = shots.filter((s) => s.result.x != null).map((s) => ({ x: s.result.x, y: s.result.y, good: s.result.lie === "Holed" }));
    if (!pts.length) return null;
    svg = scatterSvg(pts, { range: 8, unit: "ft", rings: [3, 6], label: "Where your putts finished" }); cap = "Where your putts stopped, the hole in the middle; up is long. Rings: 3 and 6 ft.";
  } else {
    const pts = shots.filter((s) => s.result.x != null).map((s) => ({ x: (s.result.x - s.pin.x) * 3, y: (s.result.y - s.pin.y) * 3, good: s.result.lie === "Green" || s.result.lie === "Holed" }));
    if (!pts.length) return null;
    const range = cat === "ARG" ? 30 : 60;
    svg = scatterSvg(pts, { range, unit: "ft", rings: cat === "ARG" ? [5, 10, 20] : [10, 20, 40], label: "Where your shots finished round the pin" }); cap = "Round the pin, in feet; up is long. Green: on the green.";
  }
  return el("section", { class: "panel pr-pattern" }, [el("h2", {}, title), el("div", { class: "pr-pat" }, svg), el("p", { class: "muted small" }, cap)]);
}

/* ===================================================== entering a result ===================================================== */
export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
/** Where the aim line is, side to side, at a distance (yds from the middle): the line from the tee to the aim point. */
export const aimLineX = (aim, total) => (aim && aim.y > 0 ? (aim.x * total) / aim.y : 0);
/*
 * Offline (update 160): one number, negative = left, positive = right (no Left / Right buttons). "L12" / "12 R"
 * work too. Phones' number pads have no minus key, so a ± button beside the box flips the sign.
 */
export function parseOff(v) {
  const t = String(v ?? "").trim().replace(/[\u2212\u2013]/g, "-").replace(",", ".");
  if (!t) return 0;
  const lr = /^([lr])\s*([\d.]+)$/i.exec(t) || /^([\d.]+)\s*([lr])$/i.exec(t);
  if (lr) { const [a, b] = /^[lr]$/i.test(lr[1]) ? [lr[1], lr[2]] : [lr[2], lr[1]]; return (a.toLowerCase() === "l" ? -1 : 1) * Number(b); }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
export const fmtOff = (v) => (v == null || v === "" || !Number(v) ? "" : String(Math.round(Number(v) * 10) / 10));
export function offInput(value, label, attrs = {}) {
  const input = el("input", { type: "text", inputmode: "decimal", value: value ?? "", "aria-label": label, placeholder: "e.g. \u22128", autocomplete: "off", ...attrs });
  const pm = el("button", { type: "button", class: "pr-pm", "aria-label": "Switch left / right", title: "Left (\u2212) or right (+)" }, "\u00b1");
  pm.addEventListener("click", () => {
    const n = parseOff(input.value);
    if (!n) { input.value = input.value.trim().startsWith("-") ? input.value.trim().slice(1) : `-${input.value.trim()}`; }
    else input.value = fmtOff(-n);
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); input.focus();
  });
  return { input, pm, box: el("span", { class: "pr-off-box" }, [input, pm]) };
}
export function inputsFor(shot, setResult, next, { aim = null } = {}) {
  const r = shot.result;
  const nextBtn = next ? el("button", { type: "button", class: "btn pr-next", disabled: r || next.always ? null : true }, next.label) : null;
  nextBtn?.addEventListener("click", () => next.onClick());
  const say = SpeechRec ? (() => {
    const b = el("button", { type: "button", class: "btn ghost pr-say voice-mic" }, sayKids("Say it"));
    b.addEventListener("click", () => {
      const rec = new SpeechRec();
      rec.lang = navigator.language || "en-US"; rec.interimResults = false; rec.maxAlternatives = 3;
      mount(b, sayKids("Listening…")); b.dataset.listening = "1"; b.classList.add("on"); b.disabled = true;
      rec.onresult = (e) => {
        const alts = [...e.results[0]].map((a) => a.transcript);
        let got = alts.map((t) => resultFromSpeech(shot, t)).find(Boolean);
        // a tee shot's "12 left" is from your aim line (update 152)
        if (got && shot.kind === "tee" && got.total != null && aim) { const abs = Math.round(aimLineX(aim, got.total) + (got.offline || 0)); got = { ...teeResult(shot, got.total, abs), total: got.total, offline: abs, source: got.source || "said" }; }
        if (got) setResult(got); else { delete b.dataset.listening; b.classList.remove("on"); mount(b, sayKids(`Didn’t catch “${alts[0]}”`)); }
      };
      rec.onend = () => { b.disabled = false; if (b.dataset.listening) mount(b, sayKids("Say it")); delete b.dataset.listening; b.classList.remove("on"); };
      rec.onerror = () => { b.disabled = false; b.classList.remove("on"); delete b.dataset.listening; mount(b, sayKids("Say it")); };
      try { rec.start(); } catch { b.disabled = false; }
    });
    return b;
  })() : null;
  const num = (val, label, attrs = {}) => el("input", { type: "text", inputmode: "decimal", value: val ?? "", "aria-label": label, placeholder: label, autocomplete: "off", ...attrs });
  if (shot.kind === "tee") {
    // Offline is from your aim line when there is one (update 152), not from the middle of the fairway
    const rel = r?.offline != null ? Math.round(r.offline - aimLineX(aim, r.total || 0)) : null;
    const tot = num(r?.total, "Total yds"), { input: off, box: offBox } = offInput(fmtOff(rel), "Offline yds, minus is left");
    const hint = el("p", { class: "muted small pr-tip", "aria-live": "polite" });
    const apply = () => {
      const t = Number(tot.value), o = parseOff(off.value);
      hint.textContent = "";
      if (!(t >= 50)) return;
      if (!Number.isFinite(o)) { hint.textContent = "Offline: a number, minus for left (e.g. \u22128)."; return; }
      const offline = Math.round(aimLineX(aim, t) + o);
      setResult({ ...teeResult(shot, Math.round(t), offline), total: Math.round(t), offline, source: "typed" });
    };
    tot.addEventListener("change", apply); off.addEventListener("change", apply);
    const pv = () => { const t = Number(tot.value), o = parseOff(off.value); previewAt(tot, t > 0 && Number.isFinite(o) ? { x: aimLineX(aim, t) + o, y: t } : null); };
    tot.addEventListener("input", pv); off.addEventListener("input", pv);
    return [el("div", { class: "pr-fields" }, [el("label", {}, [el("span", { class: "rd-label" }, "Hit Distance (yds)"), tot]), el("label", {}, [el("span", { class: "rd-label" }, aim && Math.abs(aim.x) >= 1.5 ? "Offline from aim line (yds)" : "Offline (yds)"), offBox])]), hint,
      el("div", { class: "pr-actions" }, [say, nextBtn]), el("p", { class: "muted small pr-tip" }, "Offline: minus is left, plus is right (\u00b1 flips it). Say it like \u201c285, 12 left\u201d.")];
  }
  // how far you hit it and how far offline: where it finished (and what's left) is worked out (update 154)
  if (shot.kind === "putt") {
    const made = el("button", { type: "button", class: `btn ${r?.lie === "Holed" ? "" : "ghost"} pr-made` }, "✓ Made");
    made.addEventListener("click", () => setResult({ lie: "Holed", dist: 0, unit: "ft", x: 0, y: 0, source: "typed" }));
    // (the hole is the putt's length straight ahead: rolled 2 ft past it = long 2)
    const D = shot.startDist;
    const rolled = num(r && r.lie !== "Holed" && r.y != null ? Math.round((D + r.y) * 10) / 10 : "", "Rolled ft"), { input: off, box: offBox } = offInput(r && r.x ? fmtOff(r.x) : "", "Offline ft, minus is left");
    const hint = el("p", { class: "muted small pr-tip", "aria-live": "polite" });
    const apply = () => {
      const h = Number(rolled.value), o = parseOff(off.value);
      hint.textContent = "";
      if (!(h > 0)) return;
      if (!Number.isFinite(o)) { hint.textContent = "Offline: a number, minus for left."; return; }
      const x = o, y = h - D, d = Math.round(Math.hypot(x, y) * 10) / 10;
      setResult(d <= 0.2 ? { lie: "Holed", dist: 0, unit: "ft", x: 0, y: 0, source: "typed" } : { lie: "Green", dist: d, unit: "ft", x, y, source: "typed" });
    };
    rolled.addEventListener("change", apply); off.addEventListener("change", apply);
    const pv = () => { const h = Number(rolled.value), o = parseOff(off.value); previewAt(rolled, h > 0 && Number.isFinite(o) ? { x: o, y: h - D } : null); };
    rolled.addEventListener("input", pv); off.addEventListener("input", pv);
    return [el("div", { class: "pr-fields" }, [made, el("label", {}, [el("span", { class: "rd-label" }, "Rolled (ft)"), rolled]), el("label", {}, [el("span", { class: "rd-label" }, "Offline (ft)"), offBox])]), hint,
      el("div", { class: "pr-actions" }, [say, nextBtn]), el("p", { class: "muted small pr-tip" }, "Rolled: how far the ball went (past the hole is more than the putt's length). Offline: minus is left. Say “made it” or “2 feet long”.")];
  }
  // approach / around the green: how far it went towards the pin, and how far offline (or tap where it finished)
  // (along your target line: at the pin unless you've moved it)
  const tx = aim?.x ?? shot.pin.x, ty = aim?.y ?? shot.pin.y;
  const fx = shot.from.x, fy = shot.from.y, dd = Math.hypot(tx - fx, ty - fy) || 1, ux = (tx - fx) / dd, uy = (ty - fy) / dd;
  const along = r && r.x != null ? (r.x - fx) * ux + (r.y - fy) * uy : null, across = r && r.x != null ? (r.x - fx) * uy - (r.y - fy) * ux : null; // (+ right)
  const hit = num(along != null ? Math.round(along) : "", "Hit yds"), { input: off, box: offBox } = offInput(across && Math.abs(across) >= 0.5 ? fmtOff(Math.round(across)) : "", "Offline yds, minus is left");
  const hint = el("p", { class: "muted small pr-tip", "aria-live": "polite" });
  const holed = el("button", { type: "button", class: `btn ${r?.lie === "Holed" ? "" : "ghost"} pr-made` }, "✓ Holed");
  holed.addEventListener("click", () => setResult({ lie: "Holed", dist: 0, unit: "ft", x: shot.pin.x, y: shot.pin.y, source: "typed" }));
  const apply = () => {
    const h = Number(hit.value), a = parseOff(off.value);
    hint.textContent = "";
    if (!(h > 0)) return;
    if (!Number.isFinite(a)) { hint.textContent = "Offline: a number, minus for left."; return; }
    const x = fx + ux * h + uy * a, y = fy + uy * h - ux * a;
    setResult({ ...greenResult(shot, Math.round(x * 10) / 10, Math.round(y * 10) / 10), source: "typed" });
  };
  hit.addEventListener("change", apply); off.addEventListener("change", apply);
  const pv = () => { const h = Number(hit.value), a = parseOff(off.value); if (!(h > 0) || !Number.isFinite(a)) { previewAt(hit, null); return; } previewAt(hit, { x: fx + ux * h + uy * a, y: fy + uy * h - ux * a }); };
  hit.addEventListener("input", pv); off.addEventListener("input", pv);
  return [el("div", { class: "pr-fields" }, [el("label", {}, [el("span", { class: "rd-label" }, "Hit Distance (yds)"), hit]), el("label", {}, [el("span", { class: "rd-label" }, aim && Math.hypot(aim.x - shot.pin.x, aim.y - shot.pin.y) >= 1.5 ? "Offline from aim line (yds)" : "Offline (yds)"), offBox]), holed]), hint,
    el("div", { class: "pr-actions" }, [say, nextBtn]), el("p", { class: "muted small pr-tip" }, "Hit: how far it went along your target line; offline: how far off it, minus for left. Where it finished, and what's left, are worked out. Or tap where it finished.")];

}
