/*
 * Practice › Launch Data (update 152): how each of your clubs launches. Pick the club (its make, model and shaft, from
 * your bag or typed in), load a GCQuad or TrackMan CSV, and every number in it shows per club: speeds, smash,
 * launch, spin, delivery (attack, path, face), height, descent, carry, total and dispersion, with the gaps
 * through the bag. (Carry and offline still feed the aim maps elsewhere in Practice.)
 */
import { el, mount, confirmAction } from "../ui.js";
import { normClub, sortClubs } from "../practice/clubs.js";
import { readLaunchFile, launchStats, METRICS, METRIC, fmtMetric } from "../practice/launch.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, kids = []) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); for (const k of [].concat(kids)) if (k) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); return n; };
const r0 = (v) => (v == null ? "\u2014" : String(Math.round(v)));
const r1 = (v) => (v == null ? "\u2014" : (Math.round(v * 10) / 10).toFixed(1));
const lr = (v) => (v == null ? "\u2014" : Math.abs(v) < 0.5 ? "on line" : `${r1(Math.abs(v))} ${v < 0 ? "L" : "R"}`);
// the bag's club types (the same names as WITB)
const TYPES = ["Driver", "2w", "3w", "4w", "5w", "7w", "9w", "2H", "3H", "4H", "5H", "6H", "7H", "2i", "3i", "4i", "5i", "6i", "7i", "8i", "9i", "PW", "AW", "GW", "SW", "LW",
  "46°", "48°", "50°", "52°", "54°", "56°", "58°", "60°", "62°", "64°"];
const TABLE_KEYS = ["clubSpeed", "ballSpeed", "smash", "launch", "spin", "attack", "path", "faceToPath", "height", "landAngle", "carry", "total", "offline"];

let picked = null; // the club open in the detail panel
let bagCache = null;

/** A club as you set it up: { key, type, label, brand, model, shaft, flex, loft }. */
const specLabel = (sp) => [sp.type, [sp.brand, sp.model].filter(Boolean).join(" "), [sp.shaft, sp.flex].filter(Boolean).join(" ")].filter(Boolean).join(" \u00b7 ");
const specKeyOf = (sp) => sp.bagId ? `bag:${sp.bagId}` : `c:${[sp.type, sp.brand, sp.model, sp.shaft, sp.flex, sp.loft].map((x) => String(x || "").trim().toLowerCase()).join("|")}`;

/** Your clubs' launch shots, grouped by club: Map(key -> { spec, shots, sessions }). */
function clubsFrom(sessions) {
  const by = new Map();
  for (const s of sessions) {
    if (s.cat !== "BAG" || s.source !== "monitor") continue;
    for (const x of s.shots || []) {
      const key = x.spec || `c:${(x.club || "?").toLowerCase()}`;
      const spec = s.specs?.[key] || { type: x.club || "Club", label: x.club || "Club" };
      if (!by.has(key)) by.set(key, { key, spec, shots: [], sessions: new Set() });
      const g = by.get(key);
      g.shots.push(x.m ? x : { ...x, m: { carry: x.carry, total: x.total, offline: x.offline, ballSpeed: x.ball, spin: x.spin, launch: x.launch, height: x.height } });
      g.sessions.add(s.id);
    }
  }
  const order = (g) => TYPES.indexOf(g.spec.type) >= 0 ? TYPES.indexOf(g.spec.type) : 999;
  return [...by.values()].sort((a, b) => order(a) - order(b) || specLabel(a.spec).localeCompare(specLabel(b.spec)));
}

export async function render(ctx) {
  const v = ctx.view;
  if (v.name === "bagImport") return drawImport(ctx, v);
  const clubs = clubsFrom(ctx.sessions);
  const add = el("button", { type: "button", class: "btn" }, "\uFF0B  Add launch data");
  add.addEventListener("click", () => ctx.go({ name: "bagImport" }));
  const hero = el("section", { class: "panel pr-hero" }, [
    el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, "Launch Data"),
      el("p", { class: "muted pr-lede" }, "How each of your clubs launches. Pick the club (make, model and shaft), load a GCQuad or TrackMan export, and every number shows here: speeds, smash, launch, spin, delivery, height, carry and dispersion.")]),
    el("div", { class: "pr-row pr-wrap-row" }, [add]),
  ]);
  if (!clubs.length) {
    mount(ctx.body, [hero, el("section", { class: "panel pr-empty" }, [el("h2", {}, "How it works"), el("ol", {}, [
      "Tap \u201cAdd launch data\u201d and pick the club from your bag (What's in the Bag), or type in its make, model, shaft and flex.",
      "Export the session from your GCQuad (FSX) or TrackMan as a CSV and load it. A file with a Club column can hold every club at once.",
      "Every number in the file shows per club: averages, how much each varies, and every shot.",
      "Compare clubs side by side, and see the carry gaps through the bag.",
    ].map((t) => el("li", {}, t)))])]);
    return;
  }
  if (!picked || !clubs.some((c) => c.key === picked)) picked = clubs[0].key;
  const stats = new Map(clubs.map((c) => [c.key, launchStats(c.shots)]));
  const keys = TABLE_KEYS.filter((k) => clubs.some((c) => stats.get(c.key)[k]));
  const detail = el("div");
  const drawDetail = () => { const c = clubs.find((x) => x.key === picked); mount(detail, clubDetail(ctx, c, stats.get(c.key))); };
  const table = el("div", { class: "table-scroll" }, el("table", { class: "plain pr-bag pr-launch" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Club"), el("th", { class: "num" }, "Shots"), ...keys.map((k) => el("th", { class: "num", title: METRIC[k].label }, `${METRIC[k].label}${METRIC[k].unit && METRIC[k].unit !== "°" ? ` (${METRIC[k].unit})` : ""}`))])),
    el("tbody", {}, clubs.map((c) => {
      const st = stats.get(c.key);
      const tr = el("tr", { class: c.key === picked ? "on" : "", tabindex: 0 }, [
        el("td", {}, [el("strong", {}, c.spec.type), el("div", { class: "muted small" }, specLabel({ ...c.spec, type: "" }) || "\u2014")]),
        el("td", { class: "num" }, String(c.shots.length)),
        ...keys.map((k) => el("td", { class: "num" }, st[k] ? fmtMetric(k, st[k].avg) : "\u2014")),
      ]);
      const open = () => { picked = c.key; table.querySelectorAll("tr.on").forEach((x) => x.classList.remove("on")); tr.classList.add("on"); drawDetail(); detail.scrollIntoView({ behavior: "smooth", block: "start" }); };
      tr.addEventListener("click", open); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    })),
  ]));
  drawDetail();
  // carry gaps through the bag (one entry per club type: its most-hit version)
  const pats = {};
  for (const c of clubs) {
    const carry = c.shots.map((x) => x.m?.carry).filter((x) => x != null);
    if (!carry.length || (pats[c.spec.type] && pats[c.spec.type].n >= carry.length)) continue;
    const s = [...carry].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.round((s.length - 1) * p))];
    pats[c.spec.type] = { n: carry.length, carry: carry.reduce((a, b) => a + b, 0) / carry.length, carryLo: q(0.1), carryHi: q(0.9) };
  }
  const gapClubs = sortClubs(Object.keys(pats));
  mount(ctx.body, [
    hero,
    el("section", { class: "panel" }, [el("h2", {}, "Your clubs"), el("p", { class: "muted small" }, "Averages over every shot loaded for each club. Angles: L / R is left / right of the target. Tap a club for all its numbers."), table]),
    detail,
    gapClubs.length > 1 ? el("section", { class: "panel" }, [el("h2", {}, "Carry gaps"), gapSvg(pats, gapClubs)]) : null,
    filesPanel(ctx),
  ]);
}

/* ---------------------------------------------- one club ---------------------------------------------- */
function clubDetail(ctx, c, st) {
  const groups = [
    ["Speed", ["clubSpeed", "ballSpeed", "smash"]],
    ["Launch", ["launch", "launchDir", "spin", "backSpin", "sideSpin", "spinAxis"]],
    ["Delivery", ["attack", "path", "face", "faceToPath", "dynLoft", "swingPlane", "impactH", "impactV"]],
    ["Flight", ["height", "landAngle", "hang", "carry", "total", "offline", "carrySide"]],
  ];
  const tile = (k) => {
    const s = st[k]; if (!s) return null;
    return el("div", { class: "pr-tile" }, [el("span", { class: "pr-tile-k" }, METRIC[k].label), el("strong", {}, fmtMetric(k, s.avg)),
      el("span", { class: "pr-tile-s" }, [METRIC[k].unit && METRIC[k].unit !== "°" ? METRIC[k].unit : "", s.sd != null ? ` \u00b1${(Math.round(s.sd * 10 ** (METRIC[k].dp)) / 10 ** METRIC[k].dp).toFixed(METRIC[k].dp)}` : ""].join(""))]);
  };
  const keys = METRICS.map(([k]) => k).filter((k) => st[k]);
  const shotsTable = el("div", { class: "table-scroll five-rows pr-shots-scroll" }, el("table", { class: "plain" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "#"), ...keys.map((k) => el("th", { class: "num" }, METRIC[k].label))])),
    el("tbody", {}, c.shots.map((x, i) => el("tr", {}, [el("td", {}, String(i + 1)), ...keys.map((k) => el("td", { class: "num" }, fmtMetric(k, x.m?.[k])))]))),
  ]));
  const disp = c.shots.filter((x) => x.m?.carry != null);
  const p = disp.length >= 3 ? (() => {
    const carry = disp.map((x) => x.m.carry), off = disp.map((x) => x.m.offline ?? x.m.carrySide ?? 0);
    const m = (a) => a.reduce((s, v) => s + v, 0) / a.length, sdv = (a) => { const mm = m(a); return Math.sqrt(a.reduce((s, v) => s + (v - mm) ** 2, 0) / Math.max(1, a.length - 1)); };
    return { carry: m(carry), offline: m(off), carrySd: sdv(carry), offlineSd: sdv(off) };
  })() : null;
  return el("section", { class: "panel pr-club" }, [
    el("div", { class: "pr-sub" }, [el("div", {}, [el("h2", {}, c.spec.type), el("p", { class: "muted small" }, `${specLabel({ ...c.spec, type: "" }) || "No make or shaft recorded"} \u00b7 ${c.shots.length} shot${c.shots.length === 1 ? "" : "s"}`)])]),
    el("div", { class: "pr-club-grid" }, [
      p ? el("div", { class: "pr-pat" }, [dispersionSvg(disp.map((x) => ({ carry: x.m.carry, offline: x.m.offline ?? x.m.carrySide ?? 0 })), p), el("p", { class: "muted small center" }, `Finishes ${lr(p.offline)} on average, \u00b1${r0(p.offlineSd)} yds side to side and \u00b1${r0(p.carrySd)} yds long and short (1 sd)`)]) : null,
      el("div", {}, groups.map(([g, ks]) => { const t = ks.map(tile).filter(Boolean); return t.length ? el("div", { class: "pr-lgroup" }, [el("p", { class: "ti-col-title" }, g), el("div", { class: "pr-tiles" }, t)]) : null; })),
    ]),
    el("h3", { class: "subhead" }, "Every shot"), shotsTable,
  ]);
}

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


/* ---------------------------------------------- the files loaded ---------------------------------------------- */
function filesPanel(ctx) {
  const list = ctx.sessions.filter((s) => s.cat === "BAG" && s.source === "monitor");
  if (!list.length) return null;
  return el("section", { class: "panel" }, [el("h2", {}, "Files loaded"), el("div", { class: "pr-sessions" }, list.map((s) => {
    const by = {};
    for (const x of s.shots || []) { const lbl = s.specs?.[x.spec]?.type || x.club || "Club"; by[lbl] = (by[lbl] || 0) + 1; }
    const del = el("button", { type: "button", class: "link danger" }, "Delete");
    del.addEventListener("click", async () => { if (!confirmAction("Delete this file's shots from Launch Data?")) return; await ctx.remove(s.id); render(ctx); });
    return el("div", { class: "pr-sess pr-sess-static" }, [
      el("span", { class: "pr-sess-d" }, [new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), el("span", { class: "pr-sess-tag" }, s.fileName || "Launch monitor")]),
      el("span", { class: "muted" }, sortClubs(Object.keys(by)).map((c) => `${c} \u00d7${by[c]}`).join(", ")),
      el("strong", {}, `${(s.shots || []).length}`),
      del,
    ]);
  }))]);
}

/* ---------------------------------------------- adding launch data ---------------------------------------------- */
async function drawImport(ctx) {
  if (!bagCache) { try { const m = await import("../bag.js"); const clubs = await m.getBag(ctx.uid); bagCache = (clubs || []).filter((c) => c.cat !== "Putter").map((c, i) => ({ bagId: c.id || `${c.cat}-${c.type}-${i}`, type: normClub(m.clubLabel(c)) || m.clubLabel(c), label: m.clubLabel(c), brand: c.brand || "", model: c.model || "", shaft: c.shaft || "", flex: c.flex || "", loft: "" })); } catch { bagCache = []; } }
  const bag = bagCache;
  const which = el("select", { "aria-label": "Club" }, [
    el("option", { value: "file" }, "Every club in the file (by its Club column)"),
    ...bag.map((c, i) => el("option", { value: `bag:${i}` }, `${c.label}${c.brand || c.model ? ` \u00b7 ${[c.brand, c.model].filter(Boolean).join(" ")}` : ""}${c.shaft ? ` \u00b7 ${c.shaft}${c.flex ? ` ${c.flex}` : ""}` : ""}`)),
    el("option", { value: "other" }, "Another club\u2026"),
  ]);
  const type = el("select", { "aria-label": "Club" }, TYPES.map((t) => el("option", { value: t, selected: t === "7i" }, t)));
  const brand = el("input", { maxLength: 40, placeholder: "e.g. Callaway" }), model = el("input", { maxLength: 40, placeholder: "e.g. Apex Pro" });
  const shaft = el("input", { maxLength: 50, placeholder: "e.g. Project X LZ 6.0" }), flex = el("input", { maxLength: 10, placeholder: "e.g. S, X" }), loft = el("input", { maxLength: 8, placeholder: "e.g. 34°" });
  const other = el("div", { class: "pr-spec", hidden: true }, [
    el("div", { class: "inline-form" }, [el("label", {}, ["Club", type]), el("label", {}, ["Loft (optional)", loft])]),
    el("div", { class: "inline-form" }, [el("label", {}, ["Make", brand]), el("label", {}, ["Model", model])]),
    el("div", { class: "inline-form" }, [el("label", {}, ["Shaft", shaft]), el("label", {}, ["Flex", flex])]),
  ]);
  which.addEventListener("change", () => { other.hidden = which.value !== "other"; });
  const input = el("input", { type: "file", accept: ".csv,text/csv,.txt" });
  const status = el("p", { class: "muted small", "aria-live": "polite" });
  const save = el("button", { type: "button", class: "btn pr-go", disabled: true }, "Save to Launch Data");
  let parsed = null, fileName = "";
  // which club each shot is: the one picked, or (every club) the file's Club column matched to your bag
  const assign = () => {
    const specs = {};
    const put = (sp) => { const key = specKeyOf(sp); specs[key] = { type: sp.type, brand: sp.brand || "", model: sp.model || "", shaft: sp.shaft || "", flex: sp.flex || "", loft: sp.loft || "" }; return key; };
    const fixed = which.value.startsWith("bag:") ? bag[Number(which.value.slice(4))] : which.value === "other" ? { type: type.value, brand: brand.value.trim(), model: model.value.trim(), shaft: shaft.value.trim(), flex: flex.value.trim(), loft: loft.value.trim() } : null;
    const shots = parsed.shots.map((x, i) => {
      let sp = fixed;
      if (!sp) { const t = normClub(x.club) || "Club"; sp = bag.find((b) => b.type === t) || { type: t }; }
      return { ...x, club: sp.type, spec: put(sp), at: `${new Date().toISOString()}#${String(i).padStart(4, "0")}` };
    });
    return { shots, specs };
  };
  const preview = () => {
    if (!parsed) { save.disabled = true; return; }
    if (which.value === "file" && !parsed.shots.some((x) => x.club)) { status.textContent = `${parsed.shots.length} shots, but the file has no Club column: pick the club above.`; save.disabled = true; return; }
    const { shots, specs } = assign();
    const by = {};
    for (const x of shots) by[specs[x.spec].type] = (by[specs[x.spec].type] || 0) + 1;
    status.textContent = `${shots.length} shots: ${sortClubs(Object.keys(by)).map((c) => `${c} \u00d7${by[c]}`).join(", ")}. Numbers found: ${parsed.keys.map((k) => METRIC[k].label).join(", ")}.`;
    save.disabled = false;
  };
  which.addEventListener("change", preview);
  [type, brand, model, shaft, flex, loft].forEach((x) => x.addEventListener("change", preview));
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    try { parsed = readLaunchFile(await f.text()); fileName = f.name.slice(0, 60); preview(); }
    catch (err) { parsed = null; status.textContent = err.message || "Couldn't read that file."; save.disabled = true; }
  });
  save.addEventListener("click", async () => {
    if (!parsed) return;
    if (which.value === "other" && !brand.value.trim() && !model.value.trim() && !confirmAction("Save without the club's make or model?")) return;
    const { shots, specs } = assign();
    save.disabled = true;
    const s = { id: ctx.newId(), cat: "BAG", status: "done", source: "monitor", fileName, startedAt: new Date().toISOString(), shots, specs };
    ctx.add(s); await ctx.save(s, true);
    ctx.flash?.(`Saved ${shots.length} shots.`, "ok");
    ctx.go({ name: "home" });
  });
  const back = el("button", { type: "button", class: "link" }, "\u2190 Back");
  back.addEventListener("click", () => ctx.go({ name: "home" }));
  mount(ctx.body, [
    el("p", { class: "crumb" }, back),
    el("section", { class: "panel pr-plan" }, [
      el("p", { class: "pr-eyebrow" }, "Launch Data"), el("h1", {}, "Add launch data"),
      el("label", { class: "pr-club-pick" }, [el("span", { class: "rd-label" }, "Which club"), which]),
      bag.length ? null : el("p", { class: "muted small" }, "Add your clubs in What's in the Bag to pick them here with their make, model and shaft, or choose \u201cAnother club\u201d."),
      other,
      el("label", { class: "pr-file" }, [el("span", { class: "rd-label" }, "GCQuad or TrackMan CSV"), input]),
      status, save,
      el("p", { class: "muted small" }, "GCQuad: FSX \u2192 export the session as CSV. TrackMan: the session's Export \u2192 CSV. Every column it has is kept: speeds, launch, spin, delivery, height, descent, carry, total and side."),
    ]),
  ]);
}
