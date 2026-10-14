/*
 * The made-up holes, greens and putts, drawn like a course flyover (update 155): grass with grain and mowing
 * stripes, gentle undulations lit from the top left, a collar round the fairway and green, sculpted bunkers with
 * lips, water with depth and a bank, tree clusters with shadows, a soft vignette. All SVG (sharp on any screen),
 * drawn the same way every time for the same hole.
 */
const NS = "http://www.w3.org/2000/svg";
export const svgEl = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const k of [].concat(kids)) if (k) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  return n;
};

/** A seeded random number generator, so a hole looks the same each time it's drawn. */
export function rng(seed) {
  let a = Math.floor(Math.abs(seed) * 9973) % 2147483647 || 1;
  return () => { a = (a * 48271) % 2147483647; return a / 2147483647; };
}
export const seedOf = (...vals) => vals.reduce((h, v) => (h * 31 + Math.round(Number(v || 0) * 100)) % 1000003, 7);

export const PAL = {
  rough: "#2b4a24", roughDeep: "#1f3a1b", cut: "#3f7a34", fairway: "#4f9a3e", fairwayLt: "#5aa847", green: "#5cb04a", greenLt: "#6cc257",
  collar: "#4a8f3a", sand: "#e6d3a3", sandDk: "#c9b27c", lip: "#7a8f4a", water: "#1d5f86", waterDk: "#0f3a57", waterLt: "#3f8fb8", tree: "#244a26", treeLt: "#3c6e35",
};

/**
 * The shared look: grass grain, the light on the undulations, soft shadows and gradients. scale: px per unit (roughly),
 * so the grain stays fine whether the unit is yards or feet. Returns the ids to use.
 */
export function sceneDefs(svg, { grain = 1.6, relief = 0.035, bump = 5, uid = Math.random().toString(36).slice(2, 7) } = {}) {
  const id = (n) => `${n}-${uid}`;
  const defs = svgEl("defs");
  // grass: fine noise multiplied over the colour, and soft undulations lit from the top left
  defs.appendChild(svgEl("filter", { id: id("grass"), x: "-5%", y: "-5%", width: "110%", height: "110%", "color-interpolation-filters": "sRGB" }, [
    svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: grain, numOctaves: 2, seed: 3, result: "n" }),
    svgEl("feColorMatrix", { in: "n", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.55 0.62", result: "dots" }),
    svgEl("feComposite", { in: "dots", in2: "SourceGraphic", operator: "in", result: "dots2" }),
    svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: relief, numOctaves: 3, seed: 11, result: "h" }),
    svgEl("feDiffuseLighting", { in: "h", surfaceScale: bump, diffuseConstant: 1.1, "lighting-color": "#fff8e8", result: "lit" }, svgEl("feDistantLight", { azimuth: 225, elevation: 48 })),
    svgEl("feComposite", { in: "SourceGraphic", in2: "lit", operator: "arithmetic", k1: 1.32, k2: 0, k3: 0, k4: 0, result: "shaded" }),
    svgEl("feBlend", { in: "dots2", in2: "shaded", mode: "multiply" }),
  ]));
  // sand: a finer, paler grain
  defs.appendChild(svgEl("filter", { id: id("sand"), "color-interpolation-filters": "sRGB" }, [
    svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: grain * 1.8, numOctaves: 2, seed: 5, result: "n" }),
    svgEl("feColorMatrix", { in: "n", type: "matrix", values: "0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.15  0 0 0 -0.6 0.45", result: "d" }),
    svgEl("feComposite", { in: "d", in2: "SourceGraphic", operator: "in", result: "d2" }),
    svgEl("feBlend", { in: "d2", in2: "SourceGraphic", mode: "multiply" }),
  ]));
  // water: a gentle ripple of light
  defs.appendChild(svgEl("filter", { id: id("water"), "color-interpolation-filters": "sRGB" }, [
    svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: `${relief * 2.5} ${relief * 9}`, numOctaves: 2, seed: 8, result: "w" }),
    svgEl("feColorMatrix", { in: "w", type: "matrix", values: "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -0.95", result: "glint" }),
    svgEl("feComposite", { in: "glint", in2: "SourceGraphic", operator: "in", result: "g2" }),
    svgEl("feBlend", { in: "g2", in2: "SourceGraphic", mode: "screen" }),
  ]));
  // shadows (trees, the flag, the ball) and a soft edge for the heat map
  defs.appendChild(svgEl("filter", { id: id("shadow"), x: "-50%", y: "-50%", width: "200%", height: "200%" }, svgEl("feGaussianBlur", { stdDeviation: 0.9 })));
  defs.appendChild(svgEl("filter", { id: id("soft"), x: "-5%", y: "-5%", width: "110%", height: "110%" }, svgEl("feGaussianBlur", { stdDeviation: 1.4 })));
  // gradients
  const radial = (name, stops, attrs = {}) => defs.appendChild(svgEl("radialGradient", { id: id(name), ...attrs }, stops.map(([o, c, a = 1]) => svgEl("stop", { offset: o, "stop-color": c, "stop-opacity": a }))));
  const linear = (name, stops, attrs = {}) => defs.appendChild(svgEl("linearGradient", { id: id(name), ...attrs }, stops.map(([o, c, a = 1]) => svgEl("stop", { offset: o, "stop-color": c, "stop-opacity": a }))));
  radial("sandG", [["0%", "#f3e6c2"], ["70%", PAL.sand], ["100%", PAL.sandDk]], { cx: "40%", cy: "35%", r: "75%" });
  radial("greenG", [["0%", PAL.greenLt], ["75%", PAL.green], ["100%", "#4c9a3c"]], { cx: "38%", cy: "32%", r: "80%" });
  radial("treeG", [["0%", PAL.treeLt], ["65%", PAL.tree], ["100%", "#15301a"]], { cx: "35%", cy: "30%", r: "75%" });
  linear("waterG", [["0%", PAL.waterLt], ["45%", PAL.water], ["100%", PAL.waterDk]], { x1: "0", y1: "0", x2: "1", y2: "1" });
  linear("fwG", [["0%", PAL.fairwayLt], ["100%", PAL.fairway]], { x1: "0", y1: "0", x2: "1", y2: "1" });
  radial("vig", [["55%", "#000", 0], ["100%", "#000", 0.42]], { cx: "50%", cy: "50%", r: "75%" });
  radial("cup", [["0%", "#000"], ["70%", "#0b0b0b"], ["100%", "#2a2a2a"]]);
  svg.appendChild(defs);
  return { id, url: (n) => `url(#${id(n)})` };
}

/** A smooth closed path through points (Catmull-Rom → Bézier). */
export function smoothPath(pts, closed = true) {
  const n = pts.length;
  if (n < 3) return "";
  const p = (i) => pts[(i + n) % n];
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = closed ? p(i - 1) : pts[Math.max(0, i - 1)], p1 = p(i), p2 = closed ? p(i + 1) : pts[Math.min(n - 1, i + 1)], p3 = closed ? p(i + 2) : pts[Math.min(n - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return closed ? `${d} Z` : d;
}
/** An organic blob round (cx, cy): a wobbly ellipse (bunkers, greens, ponds). */
export function blob(cx, cy, rx, ry, rand, { wobble = 0.16, n = 12, rot = 0 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = 1 + (rand() - 0.5) * 2 * wobble;
    const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return smoothPath(pts);
}
/** A sculpted bunker: grass lip, a shadow on the face, the sand. */
export function bunker(g, d, ids, { lip = 0.9 } = {}) {
  g.appendChild(svgEl("path", { d, fill: PAL.lip, stroke: "#5e7438", "stroke-width": lip * 1.4, opacity: 0.95 }));
  g.appendChild(svgEl("path", { d, fill: ids.url("sandG"), filter: ids.url("sand") }));
  g.appendChild(svgEl("path", { d, fill: "none", stroke: "rgba(80,60,20,0.35)", "stroke-width": lip, transform: "translate(0.35 0.35)" }));
}
/** A tree: its shadow (down and to the right), then the canopy, lit from the top left. */
export function tree(g, x, y, r, ids, rand) {
  g.appendChild(svgEl("ellipse", { cx: x + r * 0.45, cy: y + r * 0.5, rx: r * 1.05, ry: r * 0.95, fill: "#06140a", opacity: 0.55, filter: ids.url("shadow") }));
  g.appendChild(svgEl("path", { d: blob(x, y, r, r * (0.9 + rand() * 0.15), rand, { wobble: 0.12, n: 9 }), fill: ids.url("treeG") }));
  g.appendChild(svgEl("circle", { cx: x - r * 0.3, cy: y - r * 0.3, r: r * 0.35, fill: "#5c8f4c", opacity: 0.35 }));
}
/** The flag: pole, cloth and their shadow. */
export function flag(g, x, y, h, ids) {
  g.appendChild(svgEl("line", { x1: x + h * 0.08, y1: y, x2: x + h * 0.45, y2: y - h * 0.15, stroke: "#000", "stroke-opacity": 0.35, "stroke-width": h * 0.05, filter: ids.url("shadow") }));
  g.appendChild(svgEl("ellipse", { cx: x, cy: y, rx: h * 0.09, ry: h * 0.07, fill: ids.url("cup") }));
  g.appendChild(svgEl("line", { x1: x, y1: y, x2: x, y2: y - h, stroke: "#f5f5f7", "stroke-width": h * 0.045, "stroke-linecap": "round" }));
  g.appendChild(svgEl("path", { d: `M${x} ${y - h} q${h * 0.28} ${h * 0.05} ${h * 0.5} ${h * 0.14} q-${h * 0.22} ${h * 0.1} -${h * 0.5} ${h * 0.16} z`, fill: "#e8332b" }));
}
/** The ball, with its shadow. */
export function ball(g, x, y, r, ids) {
  g.appendChild(svgEl("circle", { cx: x + r * 0.35, cy: y + r * 0.4, r: r * 1.05, fill: "#000", opacity: 0.45, filter: ids.url("shadow") }));
  g.appendChild(svgEl("circle", { cx: x, cy: y, r, fill: "#fff", stroke: "#bdbdbd", "stroke-width": r * 0.12, class: "pr-ball" }));
}
/** A soft dark edge round the picture. */
export function vignette(svg, x, y, w, h, ids) {
  svg.appendChild(svgEl("rect", { x, y, width: w, height: h, fill: ids.url("vig"), "pointer-events": "none" }));
}
/** A label on a dark pill, readable over grass. */
export function pill(g, x, y, text, size, { anchor = "start", color = "#fff" } = {}) {
  const w = text.length * size * 0.56 + size * 0.9, h = size * 1.45;
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  g.appendChild(svgEl("rect", { x: x0, y: y - h * 0.72, width: w, height: h, rx: h / 2, fill: "rgba(8,12,9,0.62)" }));
  g.appendChild(svgEl("text", { x: x0 + w / 2, y: y + size * 0.05, "text-anchor": "middle", class: "pr-yd", style: `font-size:${size}px;fill:${color}` }, text));
}
