// (update 211) Compare → "Generate AI Report": a 1-2 page PDF of the comparison on screen, written so anyone can
// follow it. The numbers, highlights and lowlights are worked out here; when the AI summary service is set up
// (config.js insightsUrl, functions/insights), its plain-English summary goes at the top.
import { PdfDoc, wrap } from "./pdfLite.js";

const P = { night: "#0a0a0b", night2: "#16201a", ink: "#1d1d1f", grey: "#5f6368", soft: "#86868b", faint: "#a1a1a6", hair: "#e3e3e8", mist: "#f5f5f7",
  gold: "#b08d57", up: "#1e8e4a", upTint: "#e7f5ec", down: "#d0342c", downTint: "#fdecea", warn: "#b26a00" };
const f2 = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);

/**
 * r: { title, subtitle, summary (AI text or null), highlights: [text], lowlights: [text],
 *      cols: [{ name, n, few }], rows: [{ group?, label, cells: [text], tones: ["up"|"down"|""] }],
 *      usage: { cols: [name], rows: [[label, ...cells]] } | null, notes: [text] }
 */
export function buildComparePdf(r) {
  const d = new PdfDoc();
  const M = 44, W = d.W - 2 * M, H = d.H;
  let y = 0, page = 1;
  const cap = (t, x, yy, color = P.soft, align = "left", size = 7) => d.text(String(t).toUpperCase(), x, yy, { size, bold: true, color, spacing: 1.4, align });
  const footer = () => { d.line(M, H - 34, M + W, H - 34, { color: P.hair, width: 0.5 }); cap("Tour Analytics  ·  Compare", M, H - 20, P.faint); cap(`Page ${page}`, M + W, H - 20, P.faint, "right"); };
  const newPage = () => { footer(); d.addPage(); page++; y = 46; };
  const need = (h) => { if (y + h > H - 50) newPage(); };
  const section = (kicker, title) => { need(70); y += 14; d.rect(M, y - 7, 3, 9, { fill: P.gold }); cap(kicker, M + 9, y, P.gold); y += 21; d.text(title, M, y, { size: 15, bold: true, color: P.ink }); y += 14; };
  const para = (t, size = 10, color = P.ink) => { for (const line of wrap(t, W, size)) { need(size * 1.5); d.text(line, M, y + size, { size, color }); y += size * 1.45; } };

  // ---- the header band ----
  d.gradient(0, 0, d.W, 132, P.night, P.night2, { dir: "v", steps: 40 });
  d.rect(0, 130, d.W, 2, { fill: P.gold });
  cap("Compare", M, 44, P.gold, "left", 8);
  const tl = wrap(r.title, W, 20, true).slice(0, 2);
  tl.forEach((l, i) => d.text(l, M, (tl.length > 1 ? 66 : 76) + i * 22, { size: 20, bold: true, color: "#ffffff" }));
  d.text(wrap(r.subtitle || "", W, 9)[0] || "", M, 100, { size: 9, color: "#a1a1a6" });
  d.text(`Made ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`, M, 115, { size: 8, color: "#86868b" });
  y = 150;

  // ---- the short version ----
  section("In plain English", "The short version");
  para(r.summary || r.fallback || "", 10.5);
  y += 4;

  // ---- highlights and lowlights, side by side ----
  const colW = (W - 14) / 2;
  const box = (x, title, items, fill, color) => {
    const lines = items.flatMap((t) => wrap(`•  ${t}`, colW - 20, 9.5));
    const h = 30 + lines.length * 13.5;
    d.roundRect(x, y, colW, h, 8, { fill });
    cap(title, x + 10, y + 16, color, "left", 7.5);
    lines.forEach((l, i) => d.text(l, x + 10, y + 32 + i * 13.5, { size: 9.5, color: P.ink }));
    return h;
  };
  const hl = r.highlights.length ? r.highlights : ["Nothing stands out above the rest."], ll = r.lowlights.length ? r.lowlights : ["No clear weak spot."];
  const hH = 30 + hl.flatMap((t) => wrap(`•  ${t}`, colW - 20, 9.5)).length * 13.5, lH = 30 + ll.flatMap((t) => wrap(`•  ${t}`, colW - 20, 9.5)).length * 13.5;
  need(Math.max(hH, lH) + 20); y += 12;
  const h1 = box(M, "Highlights", hl, P.upTint, P.up), h2 = box(M + colW + 14, "Lowlights", ll, P.downTint, P.down);
  y += Math.max(h1, h2) + 6;

  // ---- the numbers ----
  const table = (cols, rows, kicker, title, note) => {
    section(kicker, title);
    const n = cols.length, labelW = Math.min(170, W * 0.34), cw = (W - labelW) / Math.max(1, n);
    const xs = cols.map((_, i) => M + labelW + cw * (i + 1));
    need(30);
    // column names (wrapped to two lines)
    const heads = cols.map((c) => wrap(`${c.name}${c.few ? " *" : ""}`, cw - 6, 7.5, true).slice(0, 2));
    const hh = Math.max(...heads.map((h) => h.length)) * 9;
    heads.forEach((h, i) => h.forEach((l, j) => d.text(l.toUpperCase(), xs[i], y + 8 + j * 9, { size: 7, bold: true, color: cols[i].few ? P.warn : P.soft, align: "right" })));
    y += hh + 6;
    for (const row of rows) {
      if (row.group) { need(26); y += 14; cap(row.group, M, y, P.gold, "left", 7.5); y += 4; continue; }
      need(16); y += 14;
      d.text(wrap(row.label, labelW - 8, 9)[0], M + (row.sub ? 10 : 0), y, { size: row.sub ? 8.5 : 9, bold: !row.sub, color: row.sub ? P.grey : P.ink });
      row.cells.forEach((c, i) => d.text(c, xs[i], y, { size: 9, bold: row.tones?.[i] === "up" || row.tones?.[i] === "down", color: row.tones?.[i] === "up" ? P.up : row.tones?.[i] === "down" ? P.down : P.ink, align: "right" }));
      d.line(M, y + 4, M + W, y + 4, { color: P.hair, width: 0.4 });
    }
    if (note) { y += 14; for (const l of wrap(note, W, 8)) { need(12); d.text(l, M, y, { size: 8, color: P.warn }); y += 11; } }
  };
  table(r.cols, r.rows, "The numbers", "Side by side", r.cols.some((c) => c.few) ? `* Only a few rounds (${r.cols.filter((c) => c.few).map((c) => `${c.name}: ${c.n}`).join(", ")}), so differences against ${r.cols.filter((c) => c.few).length === 1 ? "it" : "them"} may just be chance.` : null);
  if (r.usage) table(r.usage.cols.map((name) => ({ name })), r.usage.rows.map(([label, ...cells]) => ({ label, cells })), "Products", "Who uses them, and for how long", null);

  // ---- how to read it ----
  section("How to read this", "What the numbers mean");
  for (const t of r.notes) para(t, 9, P.grey);
  footer();
  return d.output();
}
