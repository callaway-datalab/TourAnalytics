// Reading a scorecard photo: hole yardages (for your tees), pars and handicaps.
//
// How it works (all in the browser, with Tesseract, an open-source text reader):
//   1. Clean the photo: enlarge, grey, flip light-on-dark rows to dark-on-light, drop table lines.
//   2. Find the "Hole" row (1 … 18): where those numbers sit gives the 18 columns. Every card has it.
//      The photo is straightened first if it's a little tilted.
//   3. Read the row labels on the left to find the Par, Handicap and your Tees rows.
//   4. Cut out each cell under a hole column and read it on its own, digits only. Handicap cells that
//      are fractions (men's / women's) are read from the top number only.
//   5. Check the results with rules every card follows (handicaps 1-18 each used once, usually odd on
//      one nine and even on the other; pars 3-6) and fill gaps where that settles them. A missing par is
//      estimated from the hole's yardage, with a note to check it.
// The setup screen shows everything that was read so it can be corrected before the round starts.

const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

/* ============================== OCR engine (Tesseract.js) ============================== */
// The reader talks to the engine through three calls, so it can be swapped for testing.
//   words(canvas)          -> [{ text, x0, y0, x1, y1 }]   sparse text, word boxes
//   lines(canvas)          -> [{ text, y0, y1 }]           a block of text, line boxes
//   digits(canvas, mode)   -> string                       one cell, digits only
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESSERACT; s.async = true;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error("Couldn't load the scorecard reader."));
    document.head.appendChild(s);
  });
}

export async function tesseractEngine() {
  const T = await loadTesseract();
  const worker = await T.createWorker("eng", 1);
  const run = async (canvas, params) => { await worker.setParameters(params); return (await worker.recognize(canvas, {}, { blocks: true, text: true })).data; };
  const eachLine = (data, fn) => (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach(fn)));
  return {
    async words(canvas) {
      const data = await run(canvas, { tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
      const out = [];
      eachLine(data, (l) => (l.words || []).forEach((w) => out.push({ text: w.text, ...w.bbox })));
      return out;
    },
    async lines(canvas) {
      const data = await run(canvas, { tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
      const out = [];
      eachLine(data, (l) => out.push({ text: l.text.trim(), y0: l.bbox.y0, y1: l.bbox.y1 }));
      return out;
    },
    async digits(canvas, mode) {
      const data = await run(canvas, { tessedit_pageseg_mode: String(mode), tessedit_char_whitelist: "0123456789" });
      return (data.text || "").trim();
    },
    terminate: () => worker.terminate(),
  };
}

/* ============================== image helpers ============================== */
function toGray(src, scale, angle = 0) {
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  if (angle) { ctx.translate(w / 2, h / 2); ctx.rotate(angle); ctx.translate(-w / 2, -h / 2); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]) / 255;
  return { g, w, h };
}

// Local mean / spread / skew around each pixel, from summed-area tables.
function boxStats(g, w, h, r) {
  const W = w + 1;
  const s1 = new Float64Array(W * (h + 1)), s2 = new Float64Array(W * (h + 1)), s3 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let a = 0, b = 0, c = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]; a += v; b += v * v; c += v * v * v;
      const i = (y + 1) * W + x + 1;
      s1[i] = s1[i - W] + a; s2[i] = s2[i - W] + b; s3[i] = s3[i - W] + c;
    }
  }
  return (x, y) => {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const n = (x1 - x0) * (y1 - y0);
    const S = (s) => s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
    const m1 = S(s1) / n, m2 = S(s2) / n, m3 = S(s3) / n;
    const sd = Math.sqrt(Math.max(m2 - m1 * m1, 1e-6));
    return { m1, sd, skew: (m3 - 3 * m1 * m2 + 2 * m1 * m1 * m1) / (sd * sd * sd) };
  };
}

/** Black-and-white page for finding words: every row's text made dark-on-light, table lines removed. */
function cleanPage({ g, w, h }) {
  const st = boxStats(g, w, h, 22);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const { m1, sd, skew } = st(x, y);
    const flip = skew > 0; // bright text is the minority tone: flip it dark
    const v = flip ? 1 - g[y * w + x] : g[y * w + x], m = flip ? 1 - m1 : m1;
    ink[y * w + x] = sd > 0.06 && v < m - 0.12 * Math.max(sd, 0.08) ? 1 : 0;
  }
  // remove long straight runs (table lines): far taller or wider than any digit
  const kill = new Uint8Array(w * h), vmin = 50, hmin = 120;
  for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
    if (!ink[y * w + x]) { y++; continue; }
    let y2 = y; while (y2 < h && ink[y2 * w + x]) y2++;
    if (y2 - y >= vmin) for (let k = y; k < y2; k++) kill[k * w + x] = 1;
    y = y2;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
    if (!ink[y * w + x]) { x++; continue; }
    let x2 = x; while (x2 < w && ink[y * w + x2]) x2++;
    if (x2 - x >= hmin) for (let k = x; k < x2; k++) kill[y * w + k] = 1;
    x = x2;
  }
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = ink[i] && !kill[i] ? 0 : 255; img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

function crop(page, x0, y0, x1, y1) {
  const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(x1 - x0)), height: Math.max(1, Math.round(y1 - y0)) });
  c.getContext("2d").drawImage(page, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}

const pct = (arr, p) => { const a = Array.from(arr).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))]; };

/** One cell, ready to read: dark digits on white, cropped to the digits' band, edge lines blanked, padded.
 *  top: take the top band of digits (a fraction's top number) instead of the tallest. */
function cellCanvas({ g, w, h }, x0, y0, x1, y1, top = false, avoid = null) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
  const cw = x1 - x0, ch = y1 - y0;
  if (cw < 4 || ch < 4) return null;
  const a = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) a[y * cw + x] = g[(y0 + y) * w + x0 + x] * 255;
  let med = pct(a, 50), p2 = pct(a, 2), p98 = pct(a, 98);
  if (p98 - med > med - p2) { for (let i = 0; i < a.length; i++) a[i] = 255 - a[i]; [p2, p98, med] = [255 - p98, 255 - p2, 255 - med]; }
  const span = Math.max(med - p2, 1);
  for (let i = 0; i < a.length; i++) a[i] = Math.min(1, Math.max(0, (a[i] - p2) / span)) * 255;
  // the digits are the tallest run of inked rows; thin runs are lines
  const rowInk = (y) => { let n = 0; for (let x = 0; x < cw; x++) if (a[y * cw + x] < 150) n++; return n / cw; };
  const runs = []; let y = 0;
  while (y < ch) { if (rowInk(y) > 0.02) { let y2 = y; while (y2 < ch && rowInk(y2) > 0.02) y2++; runs.push([y, y2]); y = y2; } else y++; }
  // For the top number: ignore digits that belong to the row above (avoid = that row's band, in this
  // window's coordinates), or, without that, anything touching the window's top edge.
  const tall = runs.filter(([s, e]) => e - s >= (top ? 0.12 : 0.18) * ch
    && !(top && (avoid ? (s + e) / 2 > avoid[0] && (s + e) / 2 < avoid[1] : s === 0)));
  let r0 = 0, r1 = ch;
  if (tall.length) {
    [r0, r1] = top ? tall[0] : tall.reduce((b, r) => (r[1] - r[0] > b[1] - b[0] ? r : b));
    r0 = Math.max(0, r0 - 4); r1 = Math.min(ch, r1 + 4);
  }
  const bh = r1 - r0;
  // underlines / fraction bars touching the digits: rows with far more ink than a row through digits
  const bandInk = []; for (let yy = r0; yy < r1; yy++) bandInk.push(rowInk(yy));
  const typical = [...bandInk].sort((p, q) => p - q)[Math.floor(bandInk.length / 2)];
  if (top) bandInk.forEach((v, i) => { if (i > bandInk.length * 0.65 && v > Math.max(0.25, typical * 2.2)) for (let x = 0; x < cw; x++) a[(r0 + i) * cw + x] = 255; });
  for (let x = 0; x < cw; x++) {
    if (x > cw * 0.2 && x < cw * 0.8) continue;
    let n = 0; for (let yy = r0; yy < r1; yy++) if (a[yy * cw + x] < 150) n++;
    if (n / bh > 0.85) for (let yy = r0; yy < r1; yy++) a[yy * cw + x] = 255;
  }
  // Resize so the digits are about 28 px tall (Tesseract reads best around there; much bigger and it
  // starts confusing 5 with 9), with a white margin.
  const s = Math.max(0.3, Math.min(3, 34 / bh)), pad = 20, ow = Math.round(cw * s) + 2 * pad, oh = Math.round(bh * s) + 2 * pad;
  const src = Object.assign(document.createElement("canvas"), { width: cw, height: bh });
  const sctx = src.getContext("2d"); const id = sctx.createImageData(cw, bh);
  for (let yy = 0; yy < bh; yy++) for (let x = 0; x < cw; x++) { const v = a[(r0 + yy) * cw + x], i = 4 * (yy * cw + x); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  sctx.putImageData(id, 0, 0);
  const out = Object.assign(document.createElement("canvas"), { width: ow, height: oh });
  const octx = out.getContext("2d"); octx.fillStyle = "#fff"; octx.fillRect(0, 0, ow, oh);
  octx.imageSmoothingQuality = "high"; octx.drawImage(src, pad, pad, ow - 2 * pad, oh - 2 * pad);
  return out;
}

/* ============================== layout ============================== */
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Find the Hole row: the line with the most of 1..18. Returns { y, h, cols: {1..18: x}, spacing, angle } or null. */
export function findHoleRow(words) {
  const nums = words.filter((wd) => /^\d{1,2}$/.test(wd.text) && +wd.text >= 1 && +wd.text <= 18)
    .map((wd) => ({ n: +wd.text, x: (wd.x0 + wd.x1) / 2, y: (wd.y0 + wd.y1) / 2, h: wd.y1 - wd.y0 }));
  let best = null;
  for (const a of nums) {
    const line = nums.filter((b) => Math.abs(b.y - a.y) < a.h * 0.7);
    const distinct = new Set(line.map((b) => b.n)).size;
    if (!best || distinct > best.distinct) best = { distinct, line };
  }
  if (!best || best.distinct < 6) return null;
  const pos = {};
  for (const b of best.line.sort((p, q) => p.x - q.x)) if (!(b.n in pos)) pos[b.n] = b;
  const cols = {};
  // Each nine: robust straight-line fit of x against hole number (a misread number can't drag it off).
  for (const [lo, hi] of [[1, 9], [10, 18]]) {
    const ks = Object.keys(pos).map(Number).filter((k) => k >= lo && k <= hi);
    if (ks.length < 2) continue;
    let inliers = null;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const sl = (pos[ks[j]].x - pos[ks[i]].x) / (ks[j] - ks[i]); if (sl <= 0) continue;
      const b = pos[ks[i]].x - sl * ks[i];
      const inl = ks.filter((k) => Math.abs(pos[k].x - (sl * k + b)) < sl * 0.3);
      if (!inliers || inl.length > inliers.length) inliers = inl;
    }
    if (!inliers || inliers.length < 2) continue;
    const mx = inliers.reduce((s, k) => s + k, 0) / inliers.length, my = inliers.reduce((s, k) => s + pos[k].x, 0) / inliers.length;
    const sl = inliers.reduce((s, k) => s + (k - mx) * (pos[k].x - my), 0) / inliers.reduce((s, k) => s + (k - mx) ** 2, 0);
    for (let k = lo; k <= hi; k++) cols[k] = my + sl * (k - mx);
  }
  if (!cols[1] && !cols[10]) return null;
  const spacing = median([...Array(17).keys()].map((i) => cols[i + 2] - cols[i + 1]).filter((d) => d > 0 && Number.isFinite(d)));
  // tilt: slope of y against x along the row
  const pts = Object.values(pos);
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const angle = den ? Math.atan(pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den) : 0;
  return { y: my, h: median(pts.map((p) => p.h)), cols, spacing, angle };
}

// Loose match for the tee name: the name may appear anywhere in the label with stray marks around it
// ("iereen" still finds Green, ") iBlack" finds Black). Up to one wrong letter, two for long names.
export function similar(text, name) {
  if (!name) return false;
  if (text.includes(name)) return true;
  if (name.length < 3) return false;
  // edit distance between the name and the best-matching stretch of the text
  let prev = Array(text.length + 1).fill(0); // free start anywhere in the text
  for (let i = 1; i <= name.length; i++) {
    const cur = [i];
    for (let j = 1; j <= text.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (name[i - 1] === text[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev) <= (name.length <= 3 ? 0 : name.length >= 7 ? 2 : 1);
}
function findRow(lines, test) {
  for (const l of lines) {
    const words = l.text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    if (test(words, l.text.toLowerCase())) return (l.y0 + l.y1) / 2;
  }
  return null;
}

/* ============================== checks with golf's rules ============================== */
/** Fill handicap gaps where the card's rules settle them: each of 1-18 once, usually odd on one nine and even on the other. */
export function settleHandicaps(hcp, raws = []) {
  const out = [...hcp];
  const counts = {}; out.forEach((v) => { if (v) counts[v] = (counts[v] || 0) + 1; });
  out.forEach((v, i) => { if (v && counts[v] > 1) out[i] = null; }); // a value used twice: neither is trustworthy
  if (out.length !== 18) return out;
  for (const [lo, hi] of [[0, 9], [9, 18]]) {
    const known = out.slice(lo, hi).filter(Boolean);
    const odd = known.filter((v) => v % 2).length;
    const parity = known.length >= 5 && (odd >= known.length - 1 || odd <= 1) ? (odd > known.length / 2 ? 1 : 0) : null;
    if (parity === null) continue;
    for (let i = lo; i < hi; i++) if (out[i] && out[i] % 2 !== parity) out[i] = null; // wrong parity: a misread
    const used = new Set(out.filter(Boolean));
    const left = []; for (let v = 1; v <= 18; v++) if (v % 2 === parity && !used.has(v)) left.push(v);
    const gaps = () => { const g = []; for (let i = lo; i < hi; i++) if (!out[i]) g.push(i); return g; };
    if (gaps().length === 1 && left.length === 1) { out[gaps()[0]] = left[0]; continue; }
    // several gaps: use what the reader half-saw in each cell (e.g. "38" contains 8)
    for (const i of gaps()) {
      const seen = (raws[i] || []).join(" ");
      const fits = left.filter((v) => seen.includes(String(v)));
      const best = fits.sort((a, b) => String(b).length - String(a).length)[0];
      if (best && fits.filter((v) => String(v).length === String(best).length).length === 1) { out[i] = best; left.splice(left.indexOf(best), 1); }
    }
    if (gaps().length === 1 && left.length === 1) out[gaps()[0]] = left[0];
  }
  return out;
}

/**
 * Check one nine against the card's OUT / IN total. If it's off, look for a single hole whose number
 * differs by one look-alike digit (5/9, 6/8, 3/8, 1/7, 0/8) and makes it add up; or, with one blank
 * hole, fill it from the total. Returns { values, fixed: [{ i, from, to }], filled, mismatch }.
 */
const LOOKALIKE = { 5: "9", 9: "5", 6: "8", 8: "6038", 3: "8", 1: "7", 7: "1", 0: "8" };
export function checkNine(values, total, lo, hi) {
  const out = [...values];
  if (!total) return { values: out, fixed: [], filled: null, mismatch: false };
  const sum = out.reduce((a, v) => a + (v || 0), 0);
  const blanks = out.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  if (blanks.length === 1) {
    const v = total - sum;
    if (v >= lo && v <= hi) { out[blanks[0]] = v; return { values: out, fixed: [], filled: blanks[0], mismatch: false }; }
  }
  if (blanks.length || sum === total) return { values: out, fixed: [], filled: null, mismatch: !blanks.length && sum !== total };
  // the total itself may be the misread one (one digit away from the sum)
  const ts = String(total), ss = String(sum);
  const totalOneOff = ts.length === ss.length && [...ts].filter((c, i) => c !== ss[i]).length === 1;
  const fixes = [];
  out.forEach((v, i) => {
    const str = String(v);
    for (let d = 0; d < str.length; d++) for (const alt of LOOKALIKE[str[d]] || "") {
      const nv = Number(str.slice(0, d) + alt + str.slice(d + 1));
      if (nv >= lo && nv <= hi && sum - v + nv === total) fixes.push({ i, from: v, to: nv });
    }
  });
  if (fixes.length === 1 && !totalOneOff) { out[fixes[0].i] = fixes[0].to; return { values: out, fixed: fixes, filled: null, mismatch: false }; }
  // no single look-alike hole explains it, but the total is one digit off: the total was misread
  if (!fixes.length && totalOneOff) return { values: out, fixed: [], filled: null, mismatch: false, totalMisread: true };
  return { values: out, fixed: [], filled: null, mismatch: true, candidates: fixes };
}

/** A par from the hole's yardage, when the card's par couldn't be read. */
export const parFromYards = (y) => (y == null ? null : y <= 250 ? 3 : y <= 480 ? 4 : 5);

/* ============================== reading rows of cells ============================== */
// layout: where the hole columns are. at(k, dy): the centre of hole k's cell in the row dy below the Hole row;
// spacing: the gap between holes; rowH: a row's height. A row is given by its offset (dy) from the Hole row,
// so a tilted photo still lines up (each hole's cell moves with the tilt).
async function readCell(engine, gray, layout, k, dy, { top = false, avoidDy = null, lo, hi, modes = [7, 8, 6] }) {
  const { x, y } = layout.at(k, dy), w = layout.spacing * 0.86, rowH = layout.rowH;
  // Handicap: a tall window reaching up, ignoring the row above's own digits, taking the top number.
  const wy0 = y - rowH * (top ? 1.1 : 0.5);
  const ay = avoidDy != null ? layout.at(k, avoidDy).y : null;
  const avoid = top && ay != null ? [ay - wy0 - rowH * 0.42, ay - wy0 + rowH * 0.42] : null;
  const cv = cellCanvas(gray, x - w / 2, wy0, x + w / 2, y + rowH * 0.5, top, avoid);
  const seen = [];
  if (cv) for (const mode of modes) {
    const t = await engine.digits(cv, mode);
    seen.push(t);
    const m = t.match(/^\s*(\d+)\s*$/);
    if (m && +m[1] >= lo && +m[1] <= hi) return { value: +m[1], seen, cv };
  }
  return { value: null, seen, cv };
}

async function readTotal(engine, gray, layout, k, dy, lo, hi) {
  const p = layout.at(k, dy), x = p.x + layout.spacing, y = p.y + layout.spacing * (layout.slope || 0), w = layout.spacing * 0.95;
  const cv = cellCanvas(gray, x - w / 2, y - layout.rowH * 0.5, x + w / 2, y + layout.rowH * 0.5);
  if (!cv) return null;
  for (const mode of [7, 8, 6]) { const m = (await engine.digits(cv, mode)).match(/^\s*(\d+)\s*$/); if (m && +m[1] >= lo && +m[1] <= hi) return +m[1]; }
  return null;
}

/** Read the Par row, the Handicap row and every tee row; check each nine against OUT / IN. */
async function readRows(engine, gray, layout, { holes, parDy, hcpDy, tees }, onProgress) {
  const notes = [];
  const total = holes * ((parDy != null) + (hcpDy != null) + tees.length);
  let done = 0;
  const tick = () => onProgress(0.3 + 0.65 * (++done / Math.max(1, total)), "Reading the holes");
  const rowOf = async (dy, opts) => {
    const vals = [], raws = [];
    for (let k = 1; k <= holes; k++) { const r = await readCell(engine, gray, layout, k, dy, opts); vals.push(r.value); raws.push(r.seen); tick(); }
    return { vals, raws };
  };
  const par = parDy != null ? (await rowOf(parDy, { lo: 3, hi: 6 })).vals : Array(holes).fill(null);
  let hcp = Array(holes).fill(null);
  if (hcpDy != null) {
    const parAbove = parDy != null && parDy < hcpDy && hcpDy - parDy < layout.rowH * 1.8;
    const r = await rowOf(hcpDy, { top: true, avoidDy: parAbove ? parDy : null, lo: 1, hi: 18 });
    hcp = settleHandicaps(r.vals, r.raws);
  }
  const teeOut = [];
  for (const t of tees) teeOut.push({ name: t.name, yards: (await rowOf(t.dy, { lo: 50, hi: 750 })).vals, dy: t.dy });
  // Each nine against the card's OUT / IN total (yardages per tee, and par).
  const checkRow = async (values, dy, key, what, nineLo, nineHi, lo, hi, teeName) => {
    for (const [a, b, label] of [[0, 9, "front nine"], [9, 18, "back nine"]]) {
      if (b > holes) continue;
      const totalV = await readTotal(engine, gray, layout, b, dy, nineLo, nineHi);
      const r = checkNine(values.slice(a, b), totalV, lo, hi);
      // Before warning, read the total again in other ways: if any reading matches the holes, all's well.
      if (r.mismatch && totalV != null) {
        const sum = r.values.reduce((t, v) => t + (v || 0), 0);
        const p = layout.at(b, dy), x = p.x + layout.spacing, y = p.y + layout.spacing * (layout.slope || 0), w = layout.spacing * 0.95;
        const cv = cellCanvas(gray, x - w / 2, y - layout.rowH * 0.5, x + w / 2, y + layout.rowH * 0.5);
        for (const mode of [8, 6, 13]) { if (cv && (await engine.digits(cv, mode)).replace(/\D/g, "") === String(sum)) { r.mismatch = false; r.candidates = []; break; } }
      }
      if (r.mismatch && r.candidates?.length) {
        const confirmed = [];
        for (const f of r.candidates) {
          const c = await readCell(engine, gray, layout, a + f.i + 1, dy, { lo, hi, modes: [8, 6, 13] });
          if (c.seen.some((t) => t.replace(/\D/g, "") === String(f.to))) confirmed.push(f);
        }
        if (confirmed.length === 1) { r.values[confirmed[0].i] = confirmed[0].to; r.fixed = confirmed; r.mismatch = false; }
      }
      values.splice(a, b - a, ...r.values);
      const who = teeName ? `${teeName} ` : "";
      for (const f of r.fixed) notes.push(`${who}hole ${a + f.i + 1} ${what} read as ${f.from}; changed to ${f.to} so the ${label} matches the card's total (${totalV}).`);
      if (r.filled != null) notes.push(`${who}hole ${a + r.filled + 1} ${what} was worked out from the card's ${label} total (${totalV}).`);
      if (r.mismatch && r.candidates?.length) {
        const hs = [...new Set(r.candidates.map((f) => a + f.i + 1))];
        notes.push(`Check ${who}hole${hs.length > 1 ? "s" : ""} ${hs.join(" and ")} ${what}: the ${label} adds up to ${r.values.reduce((t, v) => t + (v || 0), 0)}, but the card's total reads ${totalV} (the total itself may be the misread one).`);
      } else if (r.mismatch) notes.push(`The ${who}${label} ${what === "par" ? "pars" : "yardages"} don't add up to the card's total (${totalV}); check them.`);
    }
  };
  for (const t of teeOut) await checkRow(t.yards, t.dy, "yards", "yardage", 500, 4500, 50, 750, t.name);
  if (parDy != null) await checkRow(par, parDy, "par", "par", 27, 45, 3, 6);
  // Missing pars: estimate from the first tee's yardage, and say so.
  const guessed = [];
  const yds = teeOut[0]?.yards || [];
  par.forEach((p, i) => { if (p == null && yds[i] != null) { par[i] = parFromYards(yds[i]); guessed.push(i + 1); } });
  if (guessed.length) notes.push(`Par for hole${guessed.length > 1 ? "s" : ""} ${guessed.join(", ")} was estimated from the yardage. Check ${guessed.length > 1 ? "them" : "it"}.`);
  return { par, hcp, tees: teeOut.map(({ name, yards }) => ({ name, yards })), notes };
}

// A row label → a tidy tee name. Stray marks are dropped, and a label that's clearly one of the usual tee
// names is written that way ("iBlack" → "Black", "iereen" → "Green", "Siver" → "Silver").
const TEE_NAMES = ["Black", "Blue", "White", "Gold", "Green", "Red", "Silver", "Taupe", "Copper", "Jade", "Teal", "Orange", "Yellow",
  "Purple", "Burgundy", "Bronze", "Platinum", "Tan", "Combo", "Tips", "Championship", "Tournament", "Back", "Middle", "Forward", "Members"];
const cleanName = (t) => {
  let words = t.replace(/[^A-Za-z0-9 '&/-]/g, " ").split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  // a usual tee name anywhere in the label: start there ("oom Taupe Permission Only" → "Taupe Permission Only")
  const at = words.findIndex((w) => TEE_NAMES.some((n) => w.toLowerCase() === n.toLowerCase() || (n.length >= 4 && similar(w.toLowerCase(), n.toLowerCase()))));
  if (at >= 0) {
    const w = words[at].toLowerCase();
    words[at] = TEE_NAMES.find((n) => w === n.toLowerCase()) || TEE_NAMES.find((n) => n.length >= 4 && similar(w, n.toLowerCase()));
    words = words.slice(at);
  } else {
    while (words.length > 1 && /^[a-z]{1,3}$/.test(words[0])) words.shift(); // leading stray marks
    if (words[0]) words[0] = words[0].replace(/^[a-z](?=[A-Z])/, ""); // "iBlack"-style stray first letter
  }
  // trailing stray marks ("Green im", "Silver il si"): short all-lowercase words
  while (words.length > 1 && /^[a-z]{1,3}$/.test(words[words.length - 1])) words.pop();
  return words.join(" ").trim();
};
const NOT_TEE = /hole|^par\b|hand|hcp|hdcp|index|stroke|scor|attest|date|match|your|play|net|adj|^tot|^out\b|^in\b|signature|player|men|women|ladies|rating|slope/i;

async function bitmapOf(file) {
  return file instanceof HTMLCanvasElement || file instanceof HTMLImageElement || (typeof ImageBitmap !== "undefined" && file instanceof ImageBitmap) ? file : await createImageBitmap(file);
}

/* ============================== automatic reading ============================== */
/**
 * Read a scorecard photo on its own.
 * Returns { par, hcp, tees: [{ name, yards }], notes, found } (one value or null per hole).
 */
export async function readScorecard(file, { holes = 18, onProgress = () => {}, engine = null } = {}) {
  const own = !engine;
  engine = engine || await tesseractEngine();
  try {
    const bmp = await bitmapOf(file);
    const scale = Math.max(0.5, Math.min(3, 2400 / bmp.width));
    onProgress(0.05, "Cleaning up the photo");
    let gray = toGray(bmp, scale);
    let words = await engine.words(cleanPage(gray));
    let row = findHoleRow(words);
    if (row && Math.abs(row.angle) > 0.004) {
      onProgress(0.15, "Straightening the photo");
      gray = toGray(bmp, scale, -row.angle);
      words = await engine.words(cleanPage(gray));
      row = findHoleRow(words) || row;
    }
    if (!row) return { par: [], hcp: [], tees: [], found: false, notes: ["Couldn't find the Hole row (1, 2, 3 …) on its own."] };
    onProgress(0.25, "Finding the rows");
    const page = cleanPage(gray);
    const firstCol = Math.min(...Object.values(row.cols));
    const lines = await engine.lines(crop(page, 0, 0, Math.max(10, firstCol - row.spacing * 0.6), gray.h));
    const parY = findRow(lines, (ws) => ws.includes("par"));
    let hcpY = findRow(lines, (ws, t) => /hand|hcp|hdcp|index|stroke|ndica|andic/.test(t));
    if (hcpY == null && parY != null) {
      const below = lines.map((l) => ({ y: (l.y0 + l.y1) / 2, t: l.text.toLowerCase() }))
        .filter((l) => l.y > parY + row.h * 1.2 && l.y < parY + row.h * 4.5 && /[a-z]{3,}/.test(l.t) && !/scor|attest|date|sign/.test(l.t))
        .sort((p, q) => p.y - q.y);
      if (below.length) hcpY = below[0].y;
    }
    const layout = { at: (k, dy) => ({ x: row.cols[k], y: row.y + dy }), spacing: row.spacing, rowH: row.h * 2.5, slope: 0 };
    // Tee rows: other labeled rows whose first holes read as yardages.
    const tees = [];
    const used = [row.y, parY, hcpY].filter((v) => v != null);
    for (const l of lines) {
      const y = (l.y0 + l.y1) / 2, name = cleanName(l.text);
      if (!name || NOT_TEE.test(name) || used.some((u) => Math.abs(u - y) < layout.rowH * 0.5) || tees.some((t) => Math.abs(t.y - y) < layout.rowH * 0.5)) continue;
      let ok = 0;
      for (const k of [1, 2, 3]) { const r = await readCell(engine, gray, layout, k, y - row.y, { lo: 50, hi: 750, modes: [7] }); if (r.value) ok++; if (ok >= 2) break; }
      if (ok >= 2) tees.push({ name, y, dy: y - row.y });
    }
    tees.sort((a, b) => a.y - b.y);
    const res = await readRows(engine, gray, layout, { holes, parDy: parY != null ? parY - row.y : null, hcpDy: hcpY != null ? hcpY - row.y : null, tees }, onProgress);
    if (parY == null) res.notes.push("Couldn't find the Par row.");
    if (hcpY == null) res.notes.push("Couldn't find the Handicap row.");
    if (!tees.length) res.notes.push("Couldn't find any tee rows.");
    return { ...res, found: true };
  } finally {
    if (own) await engine.terminate?.();
  }
}

/* ============================== reading with your taps ============================== */
/**
 * Read a scorecard from points you tapped on the photo (in the photo's own pixels):
 *   taps.h1, taps.h9 (and for 18 holes taps.h10, taps.h18): the 1 / 9 / 10 / 18 in the Hole row
 *   taps.par, taps.hcp: anywhere on the Par / Handicap rows (hcp optional)
 *   taps.tees: [{ x, y, name? }]: each tee row (its name is read from the label if not given)
 */
export async function readScorecardFromTaps(file, { taps, holes = 18, onProgress = () => {}, engine = null } = {}) {
  const own = !engine;
  engine = engine || await tesseractEngine();
  try {
    const bmp = await bitmapOf(file);
    const scale = Math.max(0.5, Math.min(3, 2400 / bmp.width));
    onProgress(0.1, "Getting the photo ready");
    const gray = toGray(bmp, scale);
    const P = (p) => p && { x: p.x * scale, y: p.y * scale };
    const h1 = P(taps.h1), h9 = P(taps.h9), h10 = P(taps.h10 || taps.h9), h18 = P(taps.h18 || taps.h9);
    // Holes 1-9 evenly between the 1 and the 9 taps; 10-18 between the 10 and the 18 (the OUT column sits between).
    const at = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    const col = (k) => (k <= 9 ? at(h1, h9, (k - 1) / 8) : at(h10, h18, (k - 10) / 8));
    const spacing = Math.hypot(h9.x - h1.x, h9.y - h1.y) / 8;
    // the Hole row's line (for the offset of any other tap)
    const slope = (h18.x !== h1.x ? (h18.y - h1.y) / (h18.x - h1.x) : 0);
    const dyOf = (p) => p.y - (h1.y + slope * (p.x - h1.x));
    const rowDys = [taps.par, taps.hcp, ...(taps.tees || [])].filter(Boolean).map((p) => dyOf(P(p))).sort((a, b) => a - b);
    const gaps = rowDys.slice(1).map((d, i) => d - rowDys[i]).filter((g) => g > spacing * 0.5);
    const rowH = 0.85 * Math.min(spacing * 1.15, gaps.length ? Math.min(...gaps) : spacing);
    const n2 = 1 + slope * slope;
    const layout = { at: (k, dy) => { const c = col(k); return { x: c.x - (slope * dy) / n2, y: c.y + dy / n2 }; }, spacing, rowH, slope };
    const page = cleanPage(gray);
    // You can tap anywhere on a row: move each row to the middle of its band of numbers nearby.
    const pctx = page.getContext("2d", { willReadFrequently: true });
    const snap = (dy) => {
      const ks = holes === 18 ? [2, 5, 8, 11, 14, 17] : [2, 4, 6, 8];
      const span = Math.round(rowH * 0.9), prof = new Array(2 * span + 1).fill(0);
      for (const k of ks) {
        const pt = layout.at(k, dy), x0 = Math.round(pt.x - spacing * 0.35), cy = Math.round(pt.y);
        const d = pctx.getImageData(x0, cy - span, Math.round(spacing * 0.7), 2 * span + 1).data;
        for (let r = 0; r <= 2 * span; r++) for (let c = 0; c < Math.round(spacing * 0.7); c++) if (d[4 * (r * Math.round(spacing * 0.7) + c)] < 128) prof[r]++;
      }
      // the run of inked rows nearest the tap
      const on = prof.map((v) => v > 2);
      let best = null;
      for (let r = 0; r <= 2 * span;) {
        if (!on[r]) { r++; continue; }
        let e = r; while (e <= 2 * span && on[e]) e++;
        const mid = (r + e - 1) / 2, dist = Math.abs(mid - span);
        if (e - r >= rowH * 0.2 && (!best || dist < best.dist)) best = { mid, dist };
        r = e;
      }
      return best && best.dist < rowH * 0.6 ? dy + (best.mid - span) : dy;
    };
    // Tee names: read from each row's label, left of hole 1 (unless given).
    const tees = [];
    // Read the whole label column once (that reads more reliably than one strip at a time), then match
    // each tapped row to the label beside it; a single strip is the fallback.
    const labelW = Math.max(10, Math.min(h1.x, h10.x) - spacing * 0.6);
    const labels = (taps.tees || []).some((t) => !t.name) ? await engine.lines(crop(page, 0, 0, labelW, gray.h)) : [];
    for (const [i, t] of (taps.tees || []).entries()) {
      const dy = snap(dyOf(P(t)));
      let name = t.name;
      if (!name) {
        const y = h1.y + slope * (labelW / 2 - h1.x) + dy; // the row, where its label sits (left of hole 1)
        const near = labels.map((l) => ({ l, d: Math.abs((l.y0 + l.y1) / 2 - y) })).filter((c) => c.d < rowH * 0.7 && cleanName(c.l.text)).sort((p, q) => p.d - q.d)[0];
        name = near ? cleanName(near.l.text) : "";
        if (!name || name.length < 3) {
          const lines = await engine.lines(crop(page, 0, y - rowH * 0.6, labelW, y + rowH * 0.6));
          const alt = cleanName(lines.map((l) => l.text).join(" "));
          if (alt.length > name.length) name = alt;
        }
        // a short scrap that isn't a tee name ("ian") is no help: number it instead (you can rename it)
        if (!name || (name.length <= 3 && !TEE_NAMES.some((n) => n.toLowerCase() === name.toLowerCase()))) name = `Tees ${i + 1}`;
      }
      tees.push({ name, dy });
    }
    const res = await readRows(engine, gray, layout, { holes, parDy: taps.par ? snap(dyOf(P(taps.par))) : null, hcpDy: taps.hcp ? dyOf(P(taps.hcp)) : null, tees }, onProgress);
    return { ...res, found: true };
  } finally {
    if (own) await engine.terminate?.();
  }
}
