const { chromium } = require("playwright"); const out = process.argv[2];
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message)); await pg.goto("http://localhost:8765/__bw.html"); await pg.waitForTimeout(2500);
  await pg.screenshot({ path: `${out}/bw.png`, fullPage: true }); console.log(errs, await pg.$$eval(".bw-t tbody tr", (r) => r.length)); await b.close(); })();
