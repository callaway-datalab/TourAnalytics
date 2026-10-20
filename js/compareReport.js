// (update 211) Compare → "Generate AI Report": a PDF of the comparison on screen, written so anyone can follow it.
// (update 237) Premium: a dark hero with the verdict in big numbers and a mini leaderboard, a hero card for each
// selection (its strokes gained, best and worst rounds, and a bar for each part of the game), the verdict and the
// short version in plain English, highlight cards, then the visuals (where the strokes come from, round by round
// spread) and the full table side by side. The AI summary, when the service is set up, is the short version.
import { PdfDoc, wrap, textWidth } from "./pdfLite.js";

const P = { night: "#0a0a0b", night2: "#16201a", panel: "#141815", ink: "#1d1d1f", grey: "#5f6368", soft: "#86868b", faint: "#a1a1a6", hair: "#e3e3e8", mist: "#f5f5f7",
  gold: "#b08d57", goldLight: "#d4b483", up: "#1e8e4a", upLight: "#7ee2a2", upTint: "#e7f5ec", down: "#d0342c", downLight: "#ff8a80", downTint: "#fdecea", warn: "#b26a00", note: "#faf6ee", track: "#eceef1" };
const f2 = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);
const tone = (v) => (v == null || Math.abs(v) < 0.005 ? P.grey : v > 0 ? P.up : P.down);
// the selection colours are made for a dark screen: a deeper shade of each for text and thin lines on white
const deepen = (hex, k = 0.62) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.round(x * k)); return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`; };
const ord = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };

/**
 * r: { title, subtitle, summary (AI text or null), fallback, highlights: [text], lowlights: [text],
 *      sels: [{ name, color, n, events, few, sg: { TOTAL, OTT, APP, ARG, PUTT }, best, worst, median, q1, q3, sd, gaining, rounds: [sg], usualD }],
 *      cats: [[key, label]], verdict: { lines: [text] } | null,
 *      cols: [{ name, n, few }], rows: [{ group?, label, cells: [text], tones: ["up"|"down"|""] }],
 *      usage: { cols: [name], rows: [[label, ...cells]] } | null, notes: [text] }
 */
export function buildComparePdf(r) {
  const d = new PdfDoc();
  const M = 44, W = d.W - 2 * M, H = d.H;
  let y = 0, page = 1;
  const sels = r.sels || [];
  const cap = (t, x, yy, color = P.soft, align = "left", size = 7) => d.text(String(t).toUpperCase(), x, yy, { size, bold: true, color, spacing: 1.4, align });
  const footer = () => { d.line(M, H - 34, M + W, H - 34, { color: P.hair, width: 0.5 }); cap("Tour Analytics  ·  Comparison Report", M, H - 20, P.faint); cap(`Page ${page}`, M + W, H - 20, P.faint, "right"); };
  const newPage = () => { footer(); d.addPage(); page++; y = 46; };
  const need = (h) => { if (y + h > H - 50) newPage(); };
  const section = (kicker, title, room = 60) => { y += 26; /* (update 238: a little more room between sections) */ need(40 + room); d.rect(M, y - 7, 3, 9, { fill: P.gold }); cap(kicker, M + 9, y, P.gold); y += 23; d.text(title, M, y, { size: 17, bold: true, color: P.ink }); y += 14; };
  const badge = (text, x, yy, fill, color = "#ffffff") => {
    const T = String(text).toUpperCase(), w = textWidth(T, 7, true) + 1.1 * (T.length - 1) + 16;
    d.roundRect(x, yy - 10, w, 15, 7.5, { fill });
    d.text(T, x + 8, yy, { size: 7, bold: true, spacing: 1.1, color });
    return w;
  };
  // a bar from the zero line: rounded at the far end, square at zero
  const bar = (zx, yy, w, h, v, fill) => {
    if (v == null || !Number.isFinite(v) || w < 0.5) return;
    const x0 = v >= 0 ? zx : zx - w, rr = Math.min(h / 2, w / 2);
    d.roundRect(x0, yy, w, h, rr, { fill });
    d.rect(v >= 0 ? zx : zx - Math.min(rr, w), yy, Math.min(rr, w), h, { fill });
  };
  /* (update 238) bold for what matters: the selections' names, the strokes-gained numbers, and the key words
     ("unusually good", "clear", "could still be luck" …). **like this** in a text is bold too. */
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const KEY = ["unusually good", "unusually bad", "better than usual", "worse than usual", "about their usual", "is best", "best overall", "trails the rest", "only just",
    "clear", "very likely real", "probably real", "could still be luck", "too few rounds", "most consistent", "most up and down", "a hint, not a verdict", "Most of that is"];
  const emphRe = (() => {
    const names = [...new Set(sels.map((q) => q.name).filter((n) => n && n.length > 1))].sort((a, b) => b.length - a.length).map(esc);
    const parts = [...names, "[+\u2212-]\\d+\\.\\d+(?: strokes? a round)?", "\\d+\\.\\d+ strokes? a round", "\\d+(?:\\.\\d+)? (?:better|worse) than", ...KEY.map(esc)];
    return new RegExp(`\\*\\*(.+?)\\*\\*|(${parts.join("|")})`, "g");
  })();
  // a text as words, each bold or not
  const richWords = (t) => {
    const out = [], push = (str, b) => { for (const w of str.split(/(\s+)/)) if (w) out.push({ w, b }); };
    let last = 0;
    for (const m of String(t).matchAll(emphRe)) { push(t.slice(last, m.index), false); push(m[1] ?? m[2], true); last = m.index + m[0].length; }
    push(String(t).slice(last), false);
    return out;
  };
  const richWrap = (t, maxW, size) => {
    const lines = []; let line = [], w = 0;
    for (const x of richWords(t)) {
      const ww = textWidth(x.w, size, x.b);
      if (/^\s+$/.test(x.w)) { if (line.length) { line.push(x); w += ww; } continue; }
      if (w + ww > maxW && line.length) { while (line.length && /^\s+$/.test(line.at(-1).w)) line.pop(); lines.push(line); line = []; w = 0; }
      line.push(x); w += ww;
    }
    if (line.length) lines.push(line);
    return lines;
  };
  const richLine = (line, x, yy, size, color) => {
    let cx = x, seg = "", b = null;
    const flush = () => { if (seg) cx += d.text(seg, cx, yy, { size, bold: b, color: b ? P.ink : color }); seg = ""; };
    for (const q of line) { if (q.b !== b && !/^\s+$/.test(q.w)) { flush(); b = q.b; } seg += q.w; }
    flush();
  };
  const ranked = [...sels].sort((a, b) => (b.sg.TOTAL ?? -99) - (a.sg.TOTAL ?? -99));
  const top = ranked[0], second = ranked[1];

  /* ---------- the hero ---------- */
  const heroH = 262;
  d.gradient(0, 0, d.W, heroH, P.night, P.night2, { dir: "v", steps: 60 });
  d.gradient(0, heroH - 3, d.W, 3, P.gold, P.goldLight, { dir: "h", steps: 40 });
  cap("Comparison Report", M, 40, P.goldLight, "left", 7.5);
  cap(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), M + W, 40, "#8e8e93", "right", 7);
  const leftW = W * 0.55;
  const tl = wrap(r.title, leftW, 22, true).slice(0, 2);
  tl.forEach((l, i) => d.text(l, M, 70 + i * 25, { size: 22, bold: true, color: "#ffffff" }));
  let hy = 70 + tl.length * 25 - 6;
  wrap(r.subtitle || "", leftW, 8.5).slice(0, 2).forEach((l) => { d.text(l, M, hy, { size: 8.5, color: "#8e8e93" }); hy += 11; });
  hy = Math.max(hy + 10, 128);
  if (top && second) {
    // the verdict: who's best, and by how much
    cap("The verdict", M, hy, "#8e8e93"); hy += 16;
    d.dot(M + 5, hy - 4, 5, top.color);
    d.text(wrap(top.name, leftW - 14, 13, true)[0], M + 15, hy, { size: 13, bold: true, color: P.goldLight });
    const gap = (top.sg.TOTAL ?? 0) - (second.sg.TOTAL ?? 0);
    d.text(f2(gap), M - 3, hy + 52, { size: 50, bold: true, color: gap >= 0 ? P.upLight : P.downLight, spacing: -1.5 });
    const gw = textWidth(f2(gap), 50, true) - 1.5 * 4;
    wrap(`strokes a round ahead of ${second.name}${ranked.length > 2 ? `, the next best of ${ranked.length}` : ""}`, leftW - gw - 14, 9).slice(0, 3).forEach((l, i) => d.text(l, M + gw + 8, hy + 30 + i * 11.5, { size: 9, color: "#c7c7cc" }));
  } else if (top) {
    cap("Strokes gained a round", M, hy, "#8e8e93");
    d.text(f2(top.sg.TOTAL), M - 3, hy + 52, { size: 54, bold: true, color: (top.sg.TOTAL ?? 0) >= 0 ? P.upLight : P.downLight, spacing: -1.5 });
  }
  // badges
  let bx = M;
  if (r.sure?.word) bx += badge(r.sure.word, bx, heroH - 22, r.sure.tone === "up" ? P.up : r.sure.tone === "warn" ? "#8a5a00" : "#3a3a3c") + 6;
  bx += badge(`${sels.length} selection${sels.length === 1 ? "" : "s"}`, bx, heroH - 22, "#3a3a3c") + 6;
  const totalRds = sels.reduce((t, s) => t + (s.n || 0), 0);
  bx += badge(`${totalRds.toLocaleString()} rounds`, bx, heroH - 22, "#3a3a3c") + 6;
  // the mini leaderboard (right)
  {
    const x0 = M + W * 0.6, w = W * 0.4, list = ranked.slice(0, 6), rowH = 20, top0 = 70;
    const ht = 30 + list.length * rowH + 8;
    d.roundRect(x0 - 12, top0 - 18, w + 12, ht, 12, { fill: P.panel });
    cap("Leaderboard  ·  SG a round", x0, top0 - 2, "#8e8e93", "left", 6.5);
    const max = Math.max(0.1, ...list.map((s) => Math.abs(s.sg.TOTAL ?? 0)));
    const anyNeg = list.some((s) => (s.sg.TOTAL ?? 0) < 0), anyPos = list.some((s) => (s.sg.TOTAL ?? 0) > 0);
    const nameW = 88, valW = 34, bw = w - nameW - valW - 12;
    const zx = x0 + nameW + (anyNeg && anyPos ? bw / 2 : anyNeg ? bw : 0), half = anyNeg && anyPos ? bw / 2 : bw;
    list.forEach((s, i) => {
      const yy = top0 + 16 + i * rowH;
      d.text(String(i + 1), x0, yy, { size: 7.5, bold: true, color: i === 0 ? P.goldLight : "#8e8e93" });
      d.dot(x0 + 13, yy - 2.6, 3, s.color);
      d.text(wrap(s.name, nameW - 22, 7.5, true)[0], x0 + 20, yy, { size: 7.5, bold: true, color: "#e5e5ea" });
      d.roundRect(x0 + nameW, yy - 7, bw, 8, 4, { fill: "#20262a" });
      bar(zx, yy - 7, Math.abs(s.sg.TOTAL ?? 0) / max * half, 8, s.sg.TOTAL ?? 0, s.color);
      d.text(f2(s.sg.TOTAL), x0 + w - 4, yy, { size: 8, bold: true, color: (s.sg.TOTAL ?? 0) >= 0 ? P.upLight : P.downLight, align: "right" });
    });
    if (ranked.length > list.length) d.text(`+ ${ranked.length - list.length} more`, x0, top0 + 16 + list.length * rowH, { size: 7, color: "#8e8e93" });
  }
  y = heroH + 22;

  /* ---------- a hero card for each selection ---------- */
  {
    const per = sels.length <= 2 ? sels.length : sels.length === 3 ? 3 : sels.length === 4 ? 4 : 3;
    const gap = 10, cw = (W - gap * (per - 1)) / Math.max(1, per), cats = r.cats || [];
    const ch = 132 + cats.length * 13;
    const rankOf = new Map(ranked.map((s, i) => [s, i + 1]));
    for (let i = 0; i < sels.length; i += per) {
      need(ch + 10);
      sels.slice(i, i + per).forEach((s, j) => {
        const x = M + j * (cw + gap), yy = y, rk = rankOf.get(s);
        d.roundRect(x, yy, cw, ch, 10, { fill: P.mist });
        d.roundRect(x, yy, cw, 5, 2.5, { fill: s.color }); d.rect(x, yy + 2.5, cw, 2.5, { fill: s.color });
        if (sels.length > 1) badge(rk === 1 ? "Best" : ord(rk), x + 12, yy + 22, rk === 1 ? P.gold : "#8e8e93");
        const nm = wrap(s.name, cw - 24, 10, true).slice(0, 2);
        nm.forEach((l, k) => d.text(l, x + 12, yy + (sels.length > 1 ? 40 : 24) + k * 12, { size: 10, bold: true, color: P.ink }));
        const by = yy + (sels.length > 1 ? 40 : 24) + nm.length * 12 + 26;
        d.text(f2(s.sg.TOTAL), x + 10, by, { size: 28, bold: true, color: tone(s.sg.TOTAL), spacing: -0.8 });
        d.text("SG a round", x + 12, by + 12, { size: 7.5, color: P.grey });
        d.text(`${s.n} rd${s.n === 1 ? "" : "s"}${s.events ? ` · ${s.events} event${s.events === 1 ? "" : "s"}` : ""}${s.few ? " *" : ""}`, x + cw - 12, by + 12, { size: 7.5, bold: true, color: s.few ? P.warn : P.grey, align: "right" });
        // best / worst / gaining
        const sy = by + 30, third = (cw - 24) / 3;
        [["Best", f2(s.best), P.up], ["Worst", f2(s.worst), P.down], ["Gaining", s.gaining == null ? "—" : `${Math.round(s.gaining * 100)}%`, P.ink]].forEach(([l, v, c], k) => {
          cap(l, x + 12 + k * third, sy, P.soft, "left", 6);
          d.text(v, x + 12 + k * third, sy + 12, { size: 9.5, bold: true, color: c });
        });
        // each part of the game
        if (cats.length) {
          const max = Math.max(0.2, ...sels.flatMap((q) => cats.map(([c]) => Math.abs(q.sg[c] ?? 0))));
          const lx = x + 12, bw = cw - 24 - 46 - 34, zx = lx + 46 + bw / 2;
          cats.forEach(([c], k) => {
            const ry = sy + 30 + k * 13, v = s.sg[c];
            d.text(c, lx, ry, { size: 7, bold: true, color: P.grey });
            d.roundRect(lx + 46, ry - 6.5, bw, 7, 3.5, { fill: P.track });
            bar(zx, ry - 6.5, Math.abs(v ?? 0) / max * (bw / 2), 7, v ?? 0, (v ?? 0) >= 0 ? P.up : P.down);
            d.line(zx, ry - 8, zx, ry + 2, { color: "#000000", width: 0.6 });
            d.text(f2(v), x + cw - 12, ry, { size: 7.5, bold: true, color: tone(v), align: "right" });
          });
        }
      });
      y += ch + 10;
    }
  }

  /* ---------- the verdict, and the short version ---------- */
  const noteBox = (title, texts, accent, fill, size = 9.5) => {
    const lines = texts.flatMap((t, i) => [...richWrap(t, W - 32, size), ...(i < texts.length - 1 ? [[]] : [])]);
    const h = 30 + lines.length * size * 1.42;
    need(h + 8);
    d.roundRect(M, y, W, h, 10, { fill });
    d.roundRect(M, y, 4, h, 2, { fill: accent });
    cap(title, M + 16, y + 17, accent, "left", 7.5);
    lines.forEach((l, i) => richLine(l, M + 16, y + 33 + i * size * 1.42, size, "#3a3a3c"));
    y += h + 10;
  };
  y += 4;
  if (r.verdict?.lines?.length) noteBox("The verdict", r.verdict.lines, P.gold, P.note);
  noteBox(r.summary ? "The short version  ·  AI summary" : "The short version", [r.summary || r.fallback || ""], P.ink, P.mist, 9.5);

  /* ---------- highlights and lowlights: cards ---------- */
  {
    const colW = (W - 14) / 2;
    const hl = r.highlights.length ? r.highlights : ["Nothing stands out above the rest."], ll = r.lowlights.length ? r.lowlights : ["No clear weak spot."];
    const hOf = (list) => list.reduce((t, s) => t + 18 + richWrap(s, colW - 28, 8.8).length * 11.5, 0) + 20;
    section("Highlights", "What stands out", Math.min(300, Math.max(hOf(hl), hOf(ll))));
    const col = (x, title, list, accent, tint) => {
      let yy = y + 4;
      cap(title, x, yy + 6, accent); yy += 14;
      for (const t of list) {
        const lines = richWrap(t, colW - 28, 8.8), h = 16 + lines.length * 11.5;
        if (yy + h > H - 50) break;
        d.roundRect(x, yy, colW, h, 8, { fill: tint });
        d.roundRect(x, yy, 4, h, 2, { fill: accent });
        lines.forEach((l, i) => richLine(l, x + 14, yy + 14 + i * 11.5, 8.8, "#3a3a3c"));
        yy += h + 6;
      }
      return yy;
    };
    y = Math.max(col(M, "Highlights", hl, P.up, P.upTint), col(M + colW + 14, "Lowlights", ll, P.down, P.downTint)) + 4;
  }

  /* ---------- where the strokes come from: each part of the game, every selection ---------- */
  const cats = r.cats || [];
  if (cats.length && sels.length) {
    const rowH = 11, blockH = 18 + sels.length * rowH + 8;
    section("By category", "Where the strokes come from", Math.min(cats.length * blockH, 2 * blockH) + 20);
    d.text("Strokes gained a round in each part of the game. The black line is zero (the tour baseline).", M, y + 1, { size: 8, color: P.grey });
    y += 14;
    const max = Math.max(0.2, ...sels.flatMap((s) => cats.map(([c]) => Math.abs(s.sg[c] ?? 0))));
    const nameW = 130, valW = 46, bw = W - nameW - valW, zx = M + nameW + bw / 2;
    for (const [c, l] of cats) {
      need(blockH);
      d.text(l, M, y + 12, { size: 11, bold: true, color: P.ink });
      const bestV = Math.max(...sels.map((s) => s.sg[c] ?? -99));
      y += 18;
      d.roundRect(M + nameW - 6, y - 2, bw + 12, sels.length * rowH + 4, 6, { fill: P.mist });
      sels.forEach((s, i) => {
        const yy = y + i * rowH, v = s.sg[c];
        d.dot(M + 4, yy + 4, 3, s.color);
        d.text(wrap(s.name, nameW - 22, 7.5)[0], M + 12, yy + 7, { size: 7.5, color: P.grey });
        bar(zx, yy + 1, Math.abs(v ?? 0) / max * (bw / 2 - 4), 7, v ?? 0, s.color);
        d.text(f2(v), M + W, yy + 7.5, { size: 8, bold: v === bestV && sels.length > 1, color: tone(v), align: "right" });
      });
      d.line(zx, y - 2, zx, y + sels.length * rowH + 2, { color: "#000000", width: 0.8 });
      y += sels.length * rowH + 10;
    }
  }

  /* ---------- round by round: the spread of each selection ---------- */
  if (sels.some((s) => s.rounds?.length >= 2)) {
    const list = sels.filter((s) => s.rounds?.length);
    const rowH = 26;
    section("Consistency", "Round by round", list.length * rowH + 50);
    d.text("Each line runs from the worst round to the best. The box is the middle half of the rounds, the tick the median, the dot the average.", M, y + 1, { size: 8, color: P.grey });
    y += 16;
    const all = list.flatMap((s) => s.rounds);
    const lo = Math.min(-1, Math.floor(Math.min(...all))), hi = Math.max(1, Math.ceil(Math.max(...all)));
    const nameW = 130, sw = W - nameW - 60, X = (v) => M + nameW + ((v - lo) / (hi - lo)) * sw;
    const top0 = y;
    d.roundRect(M + nameW - 8, top0 - 4, sw + 16, list.length * rowH + 24, 8, { fill: P.mist });
    for (let t = lo; t <= hi; t++) { if ((hi - lo) > 10 && t % 2) continue; d.line(X(t), top0, X(t), top0 + list.length * rowH, { color: t === 0 ? "#000000" : P.hair, width: t === 0 ? 0.8 : 0.5, dash: t === 0 ? null : [1.5, 2] }); d.text(t > 0 ? `+${t}` : String(t).replace("-", "−"), X(t), top0 + list.length * rowH + 12, { size: 6.5, color: P.soft, align: "center" }); }
    list.forEach((s, i) => {
      const yy = top0 + i * rowH + rowH / 2, dc = deepen(s.color);
      d.dot(M + 4, yy - 2.5, 3, s.color);
      d.text(wrap(s.name, nameW - 22, 8, true)[0], M + 12, yy, { size: 8, bold: true, color: P.ink });
      d.line(X(s.worst), yy - 2.5, X(s.best), yy - 2.5, { color: dc, width: 1 });
      if (s.q1 != null && s.q3 != null) d.roundRect(X(s.q1), yy - 8, Math.max(2, X(s.q3) - X(s.q1)), 11, 3, { fill: s.color });
      if (s.median != null) d.line(X(s.median), yy - 9, X(s.median), yy + 4, { color: "#ffffff", width: 1.6 });
      d.dot(X(s.sg.TOTAL ?? 0), yy - 2.5, 3.2, P.ink);
      d.text(s.sd == null ? "" : `±${s.sd.toFixed(1)}`, M + W, yy, { size: 8, bold: true, color: P.grey, align: "right" });
    });
    cap("Swing", M + W, top0 - 8, P.soft, "right", 6);
    y = top0 + list.length * rowH + 22;
  }

  /* ---------- the numbers: side by side ---------- */
  const table = (cols, rows, kicker, title, note) => {
    section(kicker, title, 80);
    const n = cols.length, labelW = Math.min(170, W * 0.34), cw = (W - labelW) / Math.max(1, n);
    const xs = cols.map((_, i) => M + labelW + cw * (i + 1) - 8);
    const heads = cols.map((c) => wrap(`${c.name}${c.few ? " *" : ""}`, cw - 18, 7.5, true).slice(0, 2));
    const hh = Math.max(...heads.map((h) => h.length)) * 9 + 14;
    const head = () => {
      d.roundRect(M, y, W, hh, 6, { fill: P.night });
      heads.forEach((h, i) => { if (cols[i].color) d.dot(xs[i] - textWidth(h[0].toUpperCase(), 7, true) - 1.1 * h[0].length - 6, y + 12.5, 2.6, cols[i].color); h.forEach((l, j) => d.text(l.toUpperCase(), xs[i], y + 15 + j * 9, { size: 7, bold: true, spacing: 1.1, color: cols[i].few ? "#ffb74d" : "#e5e5ea", align: "right" })); });
      y += hh + 2;
    };
    need(hh + 40); head();
    let zebra = false;
    for (const row of rows) {
      if (row.group) { if (y + 40 > H - 50) { newPage(); head(); } y += 16; cap(row.group, M + 4, y, P.gold, "left", 7.5); y += 5; zebra = false; continue; }
      if (y + 17 > H - 50) { newPage(); head(); }
      if (zebra) d.rect(M, y, W, 16, { fill: "#fafafc" });
      zebra = !zebra;
      d.text(wrap(row.label, labelW - 8, 9)[0], M + (row.sub ? 14 : 4), y + 11, { size: row.sub ? 8.5 : 9, bold: !row.sub, color: row.sub ? P.grey : P.ink });
      row.cells.forEach((c, i) => {
        const t = row.tones?.[i];
        if (t === "up" || t === "down") { const tw = textWidth(c, 9, true) + 10; d.roundRect(xs[i] - tw + 5, y + 2.5, tw, 12, 6, { fill: t === "up" ? P.upTint : P.downTint }); }
        d.text(c, xs[i], y + 11, { size: 9, bold: t === "up" || t === "down", color: t === "up" ? P.up : t === "down" ? P.down : P.ink, align: "right" });
      });
      y += 16;
    }
    if (note) { y += 12; for (const l of wrap(note, W, 8)) { need(12); d.text(l, M, y, { size: 8, color: P.warn }); y += 11; } }
    y += 10;
  };
  table(r.cols, r.rows, "The numbers", "Side by side", r.cols.some((c) => c.few) ? `* Only a few rounds (${r.cols.filter((c) => c.few).map((c) => `${c.name}: ${c.n}`).join(", ")}), so differences against ${r.cols.filter((c) => c.few).length === 1 ? "it" : "them"} may just be chance.` : null);
  if (r.usage) table(r.usage.cols.map((name) => ({ name })), r.usage.rows.map(([label, ...cells]) => ({ label, cells })), "Products", "Who uses them, and for how long", null);

  /* ---------- how to read it ---------- */
  section("How to read this", "What the numbers mean", 60);
  for (const t of r.notes) { for (const line of wrap(t, W, 9)) { need(14); d.text(line, M, y + 9, { size: 9, color: P.grey }); y += 13; } y += 4; }
  footer();
  return d.output();
}
