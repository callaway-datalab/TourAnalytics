const { chromium } = require("playwright"); const out = process.argv[2];
(async () => { const b = await chromium.launch();
  for (const [tab, who, w, x] of [["overview", "Xander Schauffele", 1280, ""], ["fit", "Xander Schauffele", 1280, ""], ["practice", "Sam Burns", 1280, ""], ["fit", "Erik van Rooyen", 390, ""], ["overview", "Sam Burns", 390, ""]]) {
    const pg = await b.newPage({ viewport: { width: w, height: 900 } }); const errs = [];
    pg.on("pageerror", (e) => errs.push("PAGEERR " + e.message)); pg.on("console", (m) => { if (m.type() === "error" && !/404|TUNNEL/.test(m.text())) errs.push(m.text()); });
    await pg.goto(`http://localhost:8765/__insights.html?tab=${tab}&who=${encodeURIComponent(who)}${x}`); await pg.waitForTimeout(4500);
    const f = `${out}/t-${tab}-${w}.png`; await pg.screenshot({ path: f, fullPage: true }); console.log(f, JSON.stringify(errs).slice(0, 600)); await pg.close(); }
  await b.close(); })();
