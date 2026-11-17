const { chromium } = require("playwright");
(async () => { const out = process.argv[2], b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto("http://localhost:8765/__home.html?light"); await p.waitForTimeout(8000);
  await p.screenshot({ path: `${out}/light.png`, fullPage: true });
  // text too faint on light: computed color too close to the background
  const bad = await p.evaluate(() => { const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return 1; const [r, g, b] = m.map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    const out = []; for (const n of document.querySelectorAll(".td *")) { if (!n.childNodes.length || ![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue; const cs = getComputedStyle(n); if (cs.visibility === "hidden" || cs.display === "none") continue; if (lum(cs.color) > 0.72) out.push(`${n.className || n.tagName}: ${cs.color} "${n.textContent.trim().slice(0, 30)}"`); }
    return [...new Set(out)].slice(0, 25); });
  console.log(bad.join("\n")); await b.close(); })();
