// A small PDF builder for generated reports: text in Helvetica / Helvetica-Bold (measured for wrapping and
// alignment), filled rectangles, lines and JPEG images, over several pages. No outside library.
// Coordinates are in points from the top-left of the page (612 × 792 = US Letter).

// Character widths (per 1000) for Helvetica and Helvetica-Bold, characters 32-126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

// Text → WinAnsi bytes (the standard fonts' character set); a few symbols are swapped for plain ones.
const SWAP = { "\u2212": "-", "\u2192": "->", "\u2190": "<-", "\u2191": "^", "\u2193": "v", "\u2264": "<=", "\u2265": ">=", "\u00a0": " ", "\u2009": " ", "\u202f": " ",
  "\u2713": "", "\u2715": "x", "\u25B2": "^", "\u25BC": "v", "\u2022": "\u2022" };
const WIN = { "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84, "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02c6": 0x88, "\u2030": 0x89,
  "\u0160": 0x8a, "\u2039": 0x8b, "\u0152": 0x8c, "\u017d": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94, "\u2022": 0x95, "\u2013": 0x96,
  "\u2014": 0x97, "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203a": 0x9b, "\u0153": 0x9c, "\u017e": 0x9e, "\u0178": 0x9f };
export function toWinAnsi(str) {
  const out = [];
  for (const ch0 of String(str)) {
    const ch = SWAP[ch0] ?? ch0;
    for (const ch2 of ch) {
      const c = ch2.charCodeAt(0);
      if (WIN[ch2] !== undefined) out.push(WIN[ch2]);
      else if (c >= 32 && c <= 255 && !(c >= 0x7f && c < 0xa0)) out.push(c);
      else out.push(63); // ?
    }
  }
  return out;
}
const charW = (c, bold) => (c >= 32 && c <= 126 ? (bold ? W_BOLD : W_REG)[c - 32] : c === 0x95 ? 350 : c === 0x96 ? 556 : c === 0x97 ? 1000 : c === 0x85 ? 1000 : 556);

export function textWidth(str, size, bold = false) {
  return toWinAnsi(str).reduce((t, c) => t + charW(c, bold), 0) * size / 1000;
}

/** Split text into lines no wider than maxW. */
export function wrap(str, maxW, size, bold = false) {
  const lines = [];
  for (const para of String(str).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= maxW || !line) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (c) => {
  if (Array.isArray(c)) return c;
  const h = String(c).replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};

export class PdfDoc {
  constructor(width = 612, height = 792) {
    this.W = width; this.H = height;
    this.pages = []; this.images = [];
    this.addPage();
  }
  addPage() { this.ops = []; this.pages.push(this.ops); return this; }
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 1 } = {}) {
    const Y = this.H - y - h;
    if (fill) this.ops.push(`${rgb(fill).map(num).join(" ")} rg`);
    if (stroke) this.ops.push(`${rgb(stroke).map(num).join(" ")} RG ${num(lineWidth)} w`);
    this.ops.push(`${num(x)} ${num(Y)} ${num(w)} ${num(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
    return this;
  }
  line(x1, y1, x2, y2, { color = "#000000", width = 1, dash = null } = {}) {
    this.ops.push(`${rgb(color).map(num).join(" ")} RG ${num(width)} w ${dash ? `[${dash.join(" ")}] 0 d` : "[] 0 d"}`);
    this.ops.push(`${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S`);
    return this;
  }
  /** Text with its baseline at y. align: left | right | center (x is the anchor); spacing: extra points between letters. */
  text(str, x, y, { size = 10, bold = false, color = "#111111", align = "left", spacing = 0 } = {}) {
    const bytes = toWinAnsi(str);
    const w = bytes.reduce((t, c) => t + charW(c, bold), 0) * size / 1000 + spacing * Math.max(0, bytes.length - 1);
    const X = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    const esc = bytes.map((c) => (c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : c < 128 ? String.fromCharCode(c) : `\\${c.toString(8).padStart(3, "0")}`)).join("");
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(spacing)} Tc ${rgb(color).map(num).join(" ")} rg ${num(X)} ${num(this.H - y)} Td (${esc}) Tj ET`);
    return w;
  }
  /** A rectangle with rounded corners (radius r). */
  roundRect(x, y, w, h, r, { fill = null, stroke = null, lineWidth = 1 } = {}) {
    const k = 0.5523 * r, Y = (v) => num(this.H - v);
    if (fill) this.ops.push(`${rgb(fill).map(num).join(" ")} rg`);
    if (stroke) this.ops.push(`${rgb(stroke).map(num).join(" ")} RG ${num(lineWidth)} w [] 0 d`);
    this.ops.push([`${num(x + r)} ${Y(y)} m`, `${num(x + w - r)} ${Y(y)} l`, `${num(x + w - r + k)} ${Y(y)} ${num(x + w)} ${Y(y + r - k)} ${num(x + w)} ${Y(y + r)} c`,
      `${num(x + w)} ${Y(y + h - r)} l`, `${num(x + w)} ${Y(y + h - r + k)} ${num(x + w - r + k)} ${Y(y + h)} ${num(x + w - r)} ${Y(y + h)} c`,
      `${num(x + r)} ${Y(y + h)} l`, `${num(x + r - k)} ${Y(y + h)} ${num(x)} ${Y(y + h - r + k)} ${num(x)} ${Y(y + h - r)} c`,
      `${num(x)} ${Y(y + r)} l`, `${num(x)} ${Y(y + r - k)} ${num(x + r - k)} ${Y(y)} ${num(x + r)} ${Y(y)} c`, `h ${fill && stroke ? "B" : fill ? "f" : "S"}`].join(" "));
    return this;
  }
  /** A smooth colour blend across a rectangle (drawn as fine bands): dir "h" (left → right) or "v" (top → bottom). */
  gradient(x, y, w, h, from, to, { dir = "v", steps = 48 } = {}) {
    const a = rgb(from), b = rgb(to);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1), c = a.map((v, k) => v + (b[k] - v) * t);
      if (dir === "v") this.rect(x, y + (h * i) / steps, w, h / steps + 0.6, { fill: c });
      else this.rect(x + (w * i) / steps, y, w / steps + 0.6, h, { fill: c });
    }
    return this;
  }
  /** A line through several points, with round joins and ends. */
  polyline(points, { color = "#000000", width = 1 } = {}) {
    if (points.length < 2) return this;
    this.ops.push(`${rgb(color).map(num).join(" ")} RG ${num(width)} w 1 J 1 j [] 0 d`);
    this.ops.push(`${points.map(([x, y], i) => `${num(x)} ${num(this.H - y)} ${i ? "l" : "m"}`).join(" ")} S 0 J 0 j`);
    return this;
  }
  /** A filled dot. */
  dot(x, y, r, color) {
    const k = 0.5523 * r, Y = (v) => num(this.H - v);
    this.ops.push(`${rgb(color).map(num).join(" ")} rg ${num(x + r)} ${Y(y)} m ${num(x + r)} ${Y(y - k)} ${num(x + k)} ${Y(y - r)} ${num(x)} ${Y(y - r)} c ${num(x - k)} ${Y(y - r)} ${num(x - r)} ${Y(y - k)} ${num(x - r)} ${Y(y)} c ${num(x - r)} ${Y(y + k)} ${num(x - k)} ${Y(y + r)} ${num(x)} ${Y(y + r)} c ${num(x + k)} ${Y(y + r)} ${num(x + r)} ${Y(y + k)} ${num(x + r)} ${Y(y)} c f`);
    return this;
  }
  /** Wrapped text from y (top of the first line); returns the y below the last line. */
  para(str, x, y, maxW, { size = 10, bold = false, color = "#111111", leading = 1.35 } = {}) {
    let yy = y + size;
    for (const line of wrap(str, maxW, size, bold)) { this.text(line, x, yy, { size, bold, color }); yy += size * leading; }
    return yy - size * (leading - 1) + 2;
  }
  /** A JPEG (data URL from canvas.toDataURL("image/jpeg")) drawn at x, y with width w and height h. */
  image(dataUrl, x, y, w, h, pxW, pxH) {
    const b64 = dataUrl.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const id = this.images.length;
    this.images.push({ bytes, w: pxW, h: pxH });
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.H - y - h)} cm /Im${id} Do Q`);
    return this;
  }
  /** The finished PDF as bytes. */
  output() {
    const enc = new TextEncoder();
    const chunks = []; let len = 0; const offsets = [];
    const push = (data) => { const b = typeof data === "string" ? latin1(data) : data; chunks.push(b); len += b.length; };
    const latin1 = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; }; // object numbers from 1
    // fixed: 1 catalog, 2 pages, 3 F1, 4 F2; then images, then page + content pairs
    add(null); add(null);
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imgNums = this.images.map((im) => add({ stream: im.bytes, dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>` }));
    const xobj = imgNums.length ? `/XObject << ${imgNums.map((n, i) => `/Im${i} ${n} 0 R`).join(" ")} >>` : "";
    const pageNums = [];
    for (const ops of this.pages) {
      const content = latin1(ops.join("\n"));
      const c = add({ stream: content, dict: `<< /Length ${content.length} >>` });
      pageNums.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xobj} >> /Contents ${c} 0 R >>`));
    }
    objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNums.length} >>`;
    push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    objs.forEach((o, i) => {
      offsets.push(len);
      if (typeof o === "string") push(`${i + 1} 0 obj\n${o}\nendobj\n`);
      else { push(`${i + 1} 0 obj\n${o.dict}\nstream\n`); push(o.stream); push("\nendstream\nendobj\n"); }
    });
    const xref = len;
    push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
    push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out = new Uint8Array(len); let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    void enc;
    return out;
  }
}
