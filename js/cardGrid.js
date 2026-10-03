// Reading a scorecard photo as a grid.
//   1. Upright (the phone's turn note applied; a sideways card is turned by checking which way reads), then
//      straighten the small tilt from the card's long horizontal edges.
//   2. Find the table's lines: horizontal ones (drawn lines and the edges of coloured bands) and vertical ones.
//      The photo is split into strips, lines are found in each strip and joined across them, so a card shot at
//      an angle (lines not quite parallel) still lines up.
//   3. Rows × columns of cells; every word read on the page goes into the cell it sits in.
//   4. Find the Hole row (1 … 18 across the columns) and what each row is (Hole, Par, Handicap, a tee, other).
//   5. Fill in any needed cell that came out empty by reading just that cell.
// Everything is in the straightened photo's own pixels (result.src is that photo).
import {
  toGray, cleanPage, cellCanvas, bitmapOf, rotateImage, textScore, findHoleRow, cleanName, NOT_TEE, checkNine, settleHandicaps, tesseractEngine,
} from "./scorecardReader.js";

const LONG = 1800; // working size (long side), px

function canvasOf(src, w, h, angle = 0) {
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h);
  if (angle) { x.translate(w / 2, h / 2); x.rotate(angle); x.translate(-w / 2, -h / 2); }
  x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, w, h);
  return c;
}

/**
 * The small tilt (radians): along each strong, nearly horizontal edge the brightness changes going down, and
 * the direction of that change shows which way the edge runs. The most common direction over the card is
 * its tilt (background texture points every which way, so it doesn't sway the answer).
 */
function tiltOf({ g, w, h }) {
  const hist = new Float32Array(81); // -10° … +10° in 0.25° steps
  for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
    const i = y * w + x;
    // Sobel
    const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
    const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
    const m = Math.hypot(gx, gy);
    if (m < 0.5 || Math.abs(gy) < 4 * Math.abs(gx)) continue;
    const deg = (Math.atan2(-gx, gy) * 180) / Math.PI; // the edge's slope
    const d = deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg;
    if (Math.abs(d) > 10) continue;
    hist[Math.round((d + 10) * 4)] += m;
  }
  let bi = 40, bv = -1;
  for (let i = 2; i < 79; i++) { const v = hist[i - 2] + 2 * hist[i - 1] + 3 * hist[i] + 2 * hist[i + 1] + hist[i + 2]; if (v > bv) { bv = v; bi = i; } }
  return ((bi / 4 - 10) * Math.PI) / 180;
}

function tiltOfOld({ g, w, h }) {
  const s = Math.max(1, Math.round(w / 600)); // look at a small copy
  const W = Math.floor(w / s), H = Math.floor(h / s);
  const pts = [];
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const gy = Math.abs(g[(y + 1) * s * w + x * s] - g[(y - 1) * s * w + x * s]);
    if (gy > 0.12) pts.push(x, y);
  }
  let best = { a: 0, score: -1 };
  for (let deg = -10; deg <= 10.001; deg += 0.25) {
    const t = Math.tan((deg * Math.PI) / 180);
    const hist = new Float32Array(H * 2 + 2);
    for (let i = 0; i < pts.length; i += 2) { const yy = Math.round(pts[i + 1] - pts[i] * t) + H; if (yy >= 0 && yy < hist.length) hist[yy]++; }
    let score = 0; for (const v of hist) score += v * v;
    if (score > best.score) best = { a: (deg * Math.PI) / 180, score };
  }
  return best.a;
}

/**
 * Lines across the photo, found strip by strip and joined: a list of polylines [{ pts: [[along, across]…] }].
 * along: the direction the lines run (x for horizontal lines); across: their position (y for horizontal).
 */
function findLines(mask, along, across, { strips = 8, minFrac = 0.33, minStrips = 3, drift: driftIn = null } = {}) {
  // mask(a, c) = 1 where there's an edge running along this direction at (along a, across c)
  const sw = along / strips;
  const peaksBy = [];
  for (let s = 0; s < strips; s++) {
    const a0 = Math.floor(s * sw), a1 = Math.floor((s + 1) * sw);
    const prof = new Float32Array(across);
    for (let c = 1; c < across - 1; c++) {
      let n = 0;
      for (let a = a0; a < a1; a++) if (mask(a, c) || mask(a, c - 1) || mask(a, c + 1)) n++;
      prof[c] = n / (a1 - a0);
    }
    const peaks = [];
    for (let c = 2; c < across - 2; c++) {
      const v = prof[c];
      if (v >= minFrac && v >= prof[c - 1] && v >= prof[c + 1] && v >= prof[c - 2] && v >= prof[c + 2]) {
        if (peaks.length && c - peaks[peaks.length - 1].c < 5) { if (v > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = { c, v }; }
        else peaks.push({ c, v });
      }
    }
    peaksBy.push(peaks.map((p) => p.c));
  }
  // join peaks across neighbouring strips (a small drift is allowed: perspective / curl)
  const drift = driftIn ?? Math.max(5, across * 0.008);
  const used = peaksBy.map((p) => new Array(p.length).fill(false));
  const lines = [];
  for (let s = 0; s < strips; s++) for (let i = 0; i < peaksBy[s].length; i++) {
    if (used[s][i]) continue;
    used[s][i] = true;
    const pts = [[(s + 0.5) * sw, peaksBy[s][i]]];
    let last = peaksBy[s][i], misses = 0;
    for (let t = s + 1; t < strips; t++) {
      let bj = -1, bd = drift;
      peaksBy[t].forEach((c, j) => { if (!used[t][j] && Math.abs(c - last) < bd) { bd = Math.abs(c - last); bj = j; } });
      if (bj < 0) { if (++misses > 1) break; continue; }
      used[t][bj] = true; misses = 0;
      last = peaksBy[t][bj];
      pts.push([(t + 0.5) * sw, last]);
    }
    if (pts.length >= minStrips) lines.push({ pts });
  }
  return lines;
}

/** Where a polyline is at a given point along it (straight beyond its ends). */
function lineAt(line, a) {
  const p = line.pts;
  if (p.length === 1) return p[0][1];
  let i = 0;
  while (i < p.length - 2 && a > p[i + 1][0]) i++;
  const [a0, c0] = p[i], [a1, c1] = p[i + 1];
  return c0 + ((c1 - c0) * (a - a0)) / (a1 - a0 || 1);
}
const meanAcross = (line) => line.pts.reduce((t, q) => t + q[1], 0) / line.pts.length;

/** Keep one of any two lines closer together than `min` (double lines, thick borders). */
function dedupe(lines, min) {
  const sorted = [...lines].sort((a, b) => meanAcross(a) - meanAcross(b));
  const out = [];
  for (const l of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(meanAcross(l) - meanAcross(prev)) < min) { if (l.pts.length > prev.pts.length) out[out.length - 1] = l; }
    else out.push(l);
  }
  return out;
}

/* ============================== the detection ============================== */
/**
 * Find the grid on a scorecard photo and read it.
 *   nine: null (whole card), "front" (holes 1-9) or "back" (10-18)
 * Returns { src, W, H, hLines, vLines, rows, cols, cells[r][c] = { text, x0, y0, x1, y1 }, words,
 *           holeRow, holeCols: { k: c }, rowInfo: [{ kind, name, label }], holes: [k…] }
 */
export async function detectCardGrid(file, { nine = null, engine = null, onProgress = () => {} } = {}) {
  const own = !engine;
  engine = engine || await tesseractEngine();
  try {
    onProgress(0.03, "Getting the photo ready");
    let img = await bitmapOf(file);
    const want = nine === "front" ? [1, 9] : nine === "back" ? [10, 18] : [1, 18];
    const holeRowOf = (words) => {
      const r = findHoleRow(words.filter((w) => !/^\d+$/.test(w.text) || (+w.text >= want[0] && +w.text <= want[1])));
      return r;
    };
    // upright: the way the most of the Hole row (or text) reads
    const sized = (src, angle = 0) => { const k = LONG / Math.max(src.width, src.height); return canvasOf(src, Math.round(src.width * k), Math.round(src.height * k), angle); };
    let work = sized(img);
    let gray = toGray(work, 1);
    onProgress(0.08, "Reading the card");
    let words = await engine.words(cleanPage(gray));
    let hr = holeRowOf(words);
    if (!hr || hr.seen < Math.min(6, want[1] - want[0])) {
      let best = { hr, words, img, work, gray, text: textScore(words) };
      for (const deg of [90, 270, 180]) {
        onProgress(0.12, "Turning the photo upright");
        const turned = rotateImage(img, deg);
        const wk = sized(turned), g = toGray(wk, 1), w = await engine.words(cleanPage(g)), r = holeRowOf(w), t = textScore(w);
        if ((r && (!best.hr || r.seen > best.hr.seen)) || (!r && !best.hr && t > best.text * 1.25)) best = { hr: r, words: w, img: turned, work: wk, gray: g, text: t };
        if (best.hr && best.hr.seen >= 7) break;
      }
      ({ hr, words, img, work, gray } = best);
    }
    // straighten
    onProgress(0.22, "Straightening");
    // the tilt: from the Hole row's numbers when it was found (they sit on one line), else from the long edges
    const tilt = tiltOf(gray);
    if (Math.abs(tilt) > 0.002) {
      work = canvasOf(img, work.width, work.height, -tilt);
      gray = toGray(work, 1);
      words = await engine.words(cleanPage(gray));
    }
    const { g, w: W, h: H } = gray;
    // edges: horizontal (change going down) and vertical (change going across)
    onProgress(0.35, "Finding the grid");
    const T = 0.07;
    // Edges, kept only where they run on: real lines are long and unbroken; the strokes of digits and
    // letters are short. (A 1-pixel step either side is allowed, for slightly tilted lines.)
    const edgeH = new Uint8Array(W * H), edgeV = new Uint8Array(W * H);
    // (colour as well as brightness: a navy band next to a dark green one is the same brightness)
    const rgb = work.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const diff = (i, j) => Math.max(Math.abs(rgb[4 * i] - rgb[4 * j]), Math.abs(rgb[4 * i + 1] - rgb[4 * j + 1]), Math.abs(rgb[4 * i + 2] - rgb[4 * j + 2])) / 255;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (Math.abs(g[i + W] - g[i - W]) > T || diff(i + W, i - W) > 0.1) edgeH[i] = 1;
      if (Math.abs(g[i + 1] - g[i - 1]) > T || diff(i + 1, i - 1) > 0.14) edgeV[i] = 1;
    }
    const runsH = new Uint8Array(W * H), runsV = new Uint8Array(W * H);
    const minRunH = Math.max(24, Math.round(W * 0.02)), minRunV = Math.max(24, Math.round(H * 0.035)); // longer than a digit is tall
    for (let y = 1; y < H - 1; y++) {
      let start = -1, gap = 0;
      for (let x = 0; x <= W; x++) {
        const on = x < W && (edgeH[y * W + x] || edgeH[(y - 1) * W + x] || edgeH[(y + 1) * W + x]);
        if (on) { if (start < 0) start = x; gap = 0; }
        else if (start >= 0 && ++gap > 2) { const end = x - gap; if (end - start >= minRunH) for (let k = start; k <= end; k++) runsH[y * W + k] = 1; start = -1; gap = 0; }
      }
    }
    for (let x = 1; x < W - 1; x++) {
      let start = -1, gap = 0;
      for (let y = 0; y <= H; y++) {
        const on = y < H && (edgeV[y * W + x] || edgeV[y * W + x - 1] || edgeV[y * W + x + 1]);
        if (on) { if (start < 0) start = y; gap = 0; }
        else if (start >= 0 && ++gap > 2) { const end = y - gap; if (end - start >= minRunV) for (let k = start; k <= end; k++) runsV[k * W + x] = 1; start = -1; gap = 0; }
      }
    }
    let hLines = findLines((a, c) => runsH[c * W + a] === 1, W, H, { strips: 8, minFrac: 0.3, minStrips: 3 });
    let vLines = findLines((a, c) => runsV[a * W + c] === 1, H, W, { strips: 8, minFrac: 0.3, minStrips: 2, drift: Math.max(4, W * 0.005) });
    // a column line runs (nearly) straight up and down: drop zig-zags
    vLines = vLines.filter((l) => { const xs = l.pts.map((q) => q[1]); return Math.max(...xs) - Math.min(...xs) < W * 0.03; });
    // the table: where the words are, roughly; keep lines that cross it
    const spacingOf = (lines) => { const m = lines.map(meanAcross).sort((a, b) => a - b); const d = m.slice(1).map((v, i) => v - m[i]).filter((v) => v > 4).sort((a, b) => a - b); return d.length ? d[Math.floor(d.length / 2)] : 20; };
    hLines = dedupe(hLines, Math.max(5, spacingOf(hLines) * 0.35));
    vLines = dedupe(vLines, Math.max(8, spacingOf(vLines) * 0.5));
    // Read from a sharp copy of just the table, re-drawn from the full-size photo (the card is often a small
    // part of a phone photo, so its numbers are small at the working size).
    onProgress(0.42, "Reading the table up close");
    const xs = vLines.flatMap((l) => l.pts.map((q) => q[1])), ys = hLines.flatMap((l) => l.pts.map((q) => q[1]));
    const box = { x0: Math.max(0, Math.min(...xs) - 10), x1: Math.min(W, Math.max(...xs) + 10), y0: Math.max(0, Math.min(...ys) - 10), y1: Math.min(H, Math.max(...ys) + 10) };
    const k = Math.min(3, Math.max(1, 2400 / (box.x1 - box.x0)), (img.width / work.width) * 1.0 || 1);
    let hi = null;
    if (Number.isFinite(box.x0) && box.x1 > box.x0 && box.y1 > box.y0) {
      const cw = Math.round((box.x1 - box.x0) * k), chh = Math.round((box.y1 - box.y0) * k);
      const c = Object.assign(document.createElement("canvas"), { width: cw, height: chh });
      const x = c.getContext("2d");
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, cw, chh);
      x.setTransform(k, 0, 0, k, -box.x0 * k, -box.y0 * k); // the table's corner at (0, 0), k times bigger
      x.translate(W / 2, H / 2); x.rotate(-tilt); x.translate(-W / 2, -H / 2); // the same straightening as the working copy
      x.imageSmoothingQuality = "high";
      x.drawImage(img, 0, 0, W, H);
      hi = { gray: toGray(c, 1), k, box };
    }
    // cells: every square, read on its own
    const hl = hLines, vl = vLines;
    const cells = [];
    for (let r = 0; r < hl.length - 1; r++) {
      const row = [];
      for (let c = 0; c < vl.length - 1; c++) {
        const ymid = (meanAcross(hl[r]) + meanAcross(hl[r + 1])) / 2;
        const xm = (lineAt(vl[c], ymid) + lineAt(vl[c + 1], ymid)) / 2;
        const y0 = lineAt(hl[r], xm), y1 = lineAt(hl[r + 1], xm), ym = (y0 + y1) / 2;
        row.push({ x0: lineAt(vl[c], ym), y0, x1: lineAt(vl[c + 1], ym), y1, text: "" });
      }
      cells.push(row);
    }
    const src2 = hi || { gray, k: 1, box: { x0: 0, y0: 0 } };
    const toHi = (cell, inset = 0.12) => {
      const w = cell.x1 - cell.x0, h = cell.y1 - cell.y0;
      return [(cell.x0 + w * inset - src2.box.x0) * src2.k, (cell.y0 + h * 0.06 - src2.box.y0) * src2.k, (cell.x1 - w * inset - src2.box.x0) * src2.k, (cell.y1 - h * 0.06 - src2.box.y0) * src2.k];
    };
    // how much ink is in the middle of a square (empty squares aren't read)
    const page = cleanPage(src2.gray);
    const pctx = page.getContext("2d", { willReadFrequently: true });
    const inkOf = (cell) => {
      const [x0, y0, x1, y1] = toHi(cell, 0.18).map(Math.round);
      if (x1 - x0 < 3 || y1 - y0 < 3) return 0;
      const d = pctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
      return n / ((x1 - x0) * (y1 - y0));
    };
    const widths = cells.flat().map((c) => c.x1 - c.x0).sort((a, b) => a - b);
    const medW = widths[Math.floor(widths.length / 2)] || 30;
    const all = cells.flatMap((row, r) => row.map((cell, c) => ({ r, c, cell }))).filter(({ cell }) => cell.x1 - cell.x0 > 4 && inkOf(cell) > 0.025);
    let done = 0;
    for (const { cell } of all) {
      const wide = cell.x1 - cell.x0 > medW * 1.8; // the label column: words; the rest: numbers
      const [x0, y0, x1, y1] = toHi(cell, wide ? 0.02 : 0.08);
      if (wide) {
        const cv = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(x1 - x0)), height: Math.max(1, Math.round(y1 - y0)) });
        cv.getContext("2d").drawImage(page, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
        cell.text = (await engine.lines(cv)).map((l) => l.text).join(" ").trim();
      } else {
        const cv = cellCanvas(src2.gray, x0, y0, x1, y1);
        if (cv) for (const mode of [7, 8]) { const t = (await engine.digits(cv, mode)).replace(/\s+/g, "").trim(); if (/^\d{1,4}$/.test(t)) { cell.text = t; break; } }
      }
      onProgress(0.45 + 0.4 * (++done / all.length), "Reading each square");
    }
    onProgress(0.5, "Working out the rows");
    const info = interpret(cells, want);
    // handicap squares often hold two numbers (men's over women's): read just the top one
    const hcpR = info.rowInfo.findIndex((ri) => ri.kind === "hcp");
    if (hcpR >= 0) for (const k of Object.keys(info.holeCols)) {
      const cell = cells[hcpR][info.holeCols[k]];
      if (!cell) continue;
      const [x0, y0, x1, y1] = toHi(cell, 0.08);
      const cv = cellCanvas(src2.gray, x0, y0, x1, y1, true);
      if (cv) for (const mode of [7, 8]) { const t = (await engine.digits(cv, mode)).trim(); if (/^\d{1,2}$/.test(t) && +t >= 1 && +t <= 18) { cell.text = t; break; } }
    }
    // read one square again later (after you split a row in the editor): its text, or just its top number
    const readCell = async (cell, top = false) => {
      const [x0, y0, x1, y1] = toHi(cell, 0.08);
      const cv = cellCanvas(src2.gray, x0, y0, x1, y1, top);
      if (cv) for (const mode of [7, 8]) { const t = (await engine.digits(cv, mode)).replace(/\s+/g, "").trim(); if (/^\d{1,4}$/.test(t)) return t; }
      return "";
    };
    return { src: work, W, H, hLines: hl, vLines: vl, cells, ...info, tilt, nine, readCell };
  } finally {
    if (own) await engine.terminate?.();
  }
}

/** Split row r with a new straight line at y (photo pixels): the cells are rebuilt; the new cells start empty. */
export function splitRow(grid, r, y) {
  const top = grid.hLines[r], bottom = grid.hLines[r + 1];
  if (!top || !bottom) return false;
  const W = grid.W, mid = { pts: [[0, 0], [W, 0]] };
  // follow the slope of the lines either side
  const a0 = (lineAt(top, 0) + lineAt(bottom, 0)) / 2, a1 = (lineAt(top, W) + lineAt(bottom, W)) / 2, here = (a0 + a1) / 2;
  mid.pts = [[0, y + (a0 - here)], [W, y + (a1 - here)]];
  grid.hLines.splice(r + 1, 0, mid);
  const rebuild = (rr) => grid.vLines.slice(0, -1).map((_, c) => {
    const ymid = (lineAt(grid.hLines[rr], W / 2) + lineAt(grid.hLines[rr + 1], W / 2)) / 2;
    const xm = (lineAt(grid.vLines[c], ymid) + lineAt(grid.vLines[c + 1], ymid)) / 2;
    const y0 = lineAt(grid.hLines[rr], xm), y1 = lineAt(grid.hLines[rr + 1], xm), ym = (y0 + y1) / 2;
    return { x0: lineAt(grid.vLines[c], ym), y0, x1: lineAt(grid.vLines[c + 1], ym), y1, text: "" };
  });
  grid.cells.splice(r, 1, rebuild(r), rebuild(r + 1));
  grid.rowInfo.splice(r, 1, { ...grid.rowInfo[r], r }, { r: r + 1, label: "", vals: [], kind: "ignore", name: "", added: true });
  grid.rowInfo.forEach((ri, i) => { ri.r = i; });
  return true;
}
export { lineAt };

/* ============================== what each row is ============================== */
const isNum = (t) => /^\d{1,4}$/.test(t);
const firstNum = (t) => { const m = String(t || "").match(/\d{1,4}/); return m ? Number(m[0]) : null; };

/** Find the Hole row and the hole columns, and guess what each row is. */
export function interpret(cells, want = [1, 18]) {
  const R = cells.length, C = R ? cells[0].length : 0;
  // the Hole row: the row with the most of want[0]..want[1], in order across the columns
  let best = { r: -1, cols: {} , n: 0 };
  for (let r = 0; r < R; r++) {
    const cols = {};
    let lastC = -1;
    for (let c = 0; c < C; c++) {
      const v = cells[r][c].text.trim();
      if (!isNum(v)) continue;
      const k = Number(v);
      if (k >= want[0] && k <= want[1] && !(k in cols) && c > lastC) { cols[k] = c; lastC = c; }
    }
    const n = Object.keys(cols).length;
    if (n > best.n) best = { r, cols, n };
  }
  const holeCols = { ...best.cols };
  // fill missing holes from their neighbours (columns run on without a gap within a nine)
  for (let k = want[0]; k <= want[1]; k++) {
    if (k in holeCols) continue;
    const nineLo = k <= 9 ? 1 : 10, nineHi = k <= 9 ? 9 : 18;
    let a = null, b = null;
    for (let j = k - 1; j >= nineLo; j--) if (j in holeCols) { a = j; break; }
    for (let j = k + 1; j <= nineHi; j++) if (j in holeCols) { b = j; break; }
    if (a != null && b != null && holeCols[b] - holeCols[a] === b - a) holeCols[k] = holeCols[a] + (k - a);
    else if (a != null && b == null && holeCols[a] + (k - a) < C) holeCols[k] = holeCols[a] + (k - a);
    else if (b != null && a == null && holeCols[b] - (b - k) >= 0) holeCols[k] = holeCols[b] - (b - k);
  }
  const firstHoleCol = Object.keys(holeCols).length ? Math.min(...Object.values(holeCols)) : 1;
  const ks = Object.keys(holeCols).map(Number);
  const rowInfo = cells.map((row, r) => {
    const label = row.slice(0, Math.max(1, firstHoleCol)).map((c) => c.text).join(" ").trim();
    const vals = ks.map((k) => firstNum(row[holeCols[k]]?.text)).filter((v) => v != null);
    return { r, label, vals, kind: r === best.r ? "hole" : "ignore", name: "" };
  });
  const parI = rowInfo.findIndex((ri) => ri.kind !== "hole" && /\bpar\b/i.test(ri.label));
  if (parI >= 0) rowInfo[parI].kind = "par";
  else { const i = rowInfo.findIndex((ri) => ri.kind === "ignore" && ri.vals.length >= ks.length * 0.6 && ri.vals.filter((v) => v >= 3 && v <= 6).length >= ri.vals.length * 0.75); if (i >= 0) rowInfo[i].kind = "par"; }
  const hcpI = rowInfo.findIndex((ri) => ri.kind === "ignore" && /hand|hcp|hdcp|index|stroke/i.test(ri.label));
  if (hcpI >= 0) rowInfo[hcpI].kind = "hcp";
  else {
    const p = rowInfo.findIndex((ri) => ri.kind === "par");
    const next = p >= 0 ? rowInfo[p + 1] : null;
    if (next && next.vals.length >= ks.length * 0.5 && next.vals.filter((v) => v >= 1 && v <= 18).length >= next.vals.length * 0.7) next.kind = "hcp";
  }
  for (const ri of rowInfo) {
    if (ri.kind !== "ignore") continue;
    const name = cleanName(ri.label);
    const yards = ri.vals.length >= ks.length * 0.5 && ri.vals.filter((v) => v >= 50 && v <= 750).length >= ri.vals.length * 0.6;
    if (yards && !(name && NOT_TEE.test(name))) { ri.kind = "tee"; ri.name = name || ""; }
  }
  // unnamed tees: number them
  let n = 0;
  for (const ri of rowInfo) if (ri.kind === "tee" && !ri.name) ri.name = `Tees ${++n}`;
  return { holeRow: best.r, holeCols, rowInfo, holes: Object.keys(holeCols).map(Number).sort((a, b) => a - b) };
}

/** The numbers in a grid for the setup screen, from the rows and hole columns as they now stand. */
export function gridValues(grid, rowInfo, holeCols, holes = 18) {
  const ks = Array.from({ length: holes }, (_, i) => i + 1);
  const valAt = (r, k, lo, hi) => {
    const c = holeCols[k];
    if (c == null || !grid.cells[r]?.[c]) return null;
    const v = firstNum(grid.cells[r][c].text);
    return v != null && v >= lo && v <= hi ? v : null;
  };
  const rowOf = (kind) => rowInfo.findIndex((ri) => ri.kind === kind);
  const totalAt = (r, k, lo, hi) => { const c = holeCols[k]; const cell = c != null ? grid.cells[r]?.[c + 1] : null; const v = cell ? firstNum(cell.text) : null; return v != null && v >= lo && v <= hi ? v : null; };
  const nineFix = (r, vals, lo, hi, tLo, tHi) => {
    for (const [a, b] of [[0, 9], [9, 18]]) {
      if (b > holes) continue;
      const t = totalAt(r, b, tLo, tHi);
      const res = checkNine(vals.slice(a, b), t, lo, hi);
      if (res.fixed.length || res.filled != null) vals.splice(a, b - a, ...res.values);
    }
    return vals;
  };
  const parR = rowOf("par"), hcpR = rowOf("hcp");
  const par = ks.map((k) => (parR >= 0 ? valAt(parR, k, 3, 6) : null));
  const hcp = settleHandicaps(ks.map((k) => (hcpR >= 0 ? valAt(hcpR, k, 1, 18) : null)));
  const tees = rowInfo.filter((ri) => ri.kind === "tee").map((ri) => ({ name: ri.name || "Tees", yards: nineFix(ri.r, ks.map((k) => valAt(ri.r, k, 50, 750)), 50, 750, 500, 4500) }));
  return { par: parR >= 0 ? nineFix(parR, par, 3, 6, 27, 45) : par, hcp, tees };
}
