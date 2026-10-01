// Reading a scorecard photo: hole yardages, pars and handicaps.
// The text is read in the browser with Tesseract (open-source OCR), then the rows are picked out by
// their labels ("Par", "Hcp"/"Handicap", and the row of yardages). It's a starting point you check:
// the setup screen shows what was read so it can be corrected before the round starts.

const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

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

/** Read the text in an image file. onProgress(0..1) while it works. */
export async function readImageText(file, onProgress) {
  const T = await loadTesseract();
  const worker = await T.createWorker("eng", 1, {
    logger: (m) => { if (m.status === "recognizing text" && onProgress) onProgress(m.progress); },
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

const nums = (line) => (line.match(/\d+/g) || []).map(Number);

/**
 * Pick yardages, pars and handicaps out of scorecard text. Scorecards list each row as
 * label, holes 1-9, OUT, holes 10-18, IN, TOTAL (or front and back nine on separate lines).
 * Returns { yards: [], par: [], hcp: [] } with up to 18 values each (missing ones are null).
 */
export function parseScorecard(text, holes = 18) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const take = (test, keep) => lines.filter((l) => test(l)).flatMap((l) => nums(l).filter(keep));
  const par = take((l) => /\bpar\b/i.test(l), (n) => n >= 3 && n <= 6);
  const hcp = take((l) => /\b(hcp|hdcp|handicap|hdcap|index|s\.?\s?i\.?|stroke)\b/i.test(l), (n) => n >= 1 && n <= 18);
  // Yardage: the first line (or pair of lines) where most numbers look like hole lengths.
  const yardLines = lines.filter((l) => !/\b(par|hcp|hdcp|handicap|index)\b/i.test(l))
    .filter((l) => { const n = nums(l); return n.length >= 5 && n.filter((x) => x >= 80 && x <= 700).length >= n.length * 0.6; });
  let yards = [];
  for (const l of yardLines) {
    yards.push(...nums(l).filter((n) => n >= 80 && n <= 700));
    if (yards.length >= holes) break;
  }
  // Drop OUT / IN totals if they slipped into the yardage row (they're the sum of the nine before).
  yards = dropTotals(yards);
  const fit = (a) => Array.from({ length: holes }, (_, i) => (a[i] ?? null));
  return { yards: fit(yards), par: fit(par), hcp: fit(hcp) };
}

function dropTotals(list) {
  const out = [];
  for (const n of list) {
    const last9 = out.slice(-9);
    if (last9.length === 9 && Math.abs(last9.reduce((a, b) => a + b, 0) - n) <= 2) continue;
    out.push(n);
  }
  return out;
}
