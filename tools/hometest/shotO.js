const { chromium } = require("playwright"); const out = process.argv[2];
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
  pg.on("pageerror", (e) => { if (e.message !== "done") errs.push(e.message); });
  await pg.goto("http://localhost:8765/__insights.html?tab=overview&who=Sam%20Burns"); await pg.waitForTimeout(4000);
  await pg.screenshot({ path: `${out}/o-main.png`, fullPage: true });
  for (const [sel, n] of [[".ip-formlist li", "form"], [".ip-bars .ip-barrow.ip-click", "range"], ["button.ip-link", "all"], [".ip-bag tr.ip-click >> nth=1", "gear"], [".ip-bag tr.ip-click >> nth=5", "ball"]]) {
    await pg.click(sel); await pg.waitForTimeout(500); await pg.screenshot({ path: `${out}/o-${n}.png` }); await pg.keyboard.press("Escape"); await pg.waitForTimeout(200); }
  await pg.goto("http://localhost:8765/__insights.html?tab=practice&who=Sam%20Burns"); await pg.waitForTimeout(4000); await pg.screenshot({ path: `${out}/o-rec.png` });
  console.log(errs); await b.close(); })();
