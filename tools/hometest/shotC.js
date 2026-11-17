const { chromium } = require("playwright"); const out = process.argv[2];
(async () => { const b = await chromium.launch();
  for (const w of [1280, 390]) { const pg = await b.newPage({ viewport: { width: w, height: 900 } }); const errs = [];
    pg.on("pageerror", (e) => { if (e.message !== "done") errs.push(e.message); });
    await pg.goto("http://localhost:8765/__insights.html?tab=fit&who=Xander%20Schauffele"); await pg.waitForTimeout(4000);
    await pg.click(".cf-tr >> nth=1"); await pg.waitForTimeout(300);
    await pg.screenshot({ path: `${out}/cf-${w}.png`, fullPage: true }); console.log(w, errs); await pg.close(); }
  await b.close(); })();
