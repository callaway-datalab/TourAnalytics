const { chromium } = require("playwright");
(async () => { const out = process.argv[2], b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8765/__home.html"); await p.waitForTimeout(8000);
  await p.click("#td-focus article"); await p.waitForTimeout(600);
  const r = await p.evaluate(() => ({ act: document.querySelector(".td-act")?.textContent, samp: document.querySelector(".td-pop .td-samp")?.textContent, how: !!document.querySelector(".td-how") }));
  await p.screenshot({ path: `${out}/pop.png` }); console.log(JSON.stringify({ ...r, errs })); await b.close(); })();
