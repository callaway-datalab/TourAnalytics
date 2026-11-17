// (update 815) the Player Dossier, Course Fit and Practice Week pages: desktop, phone and light
const { chromium } = require("playwright"); const out = process.argv[2];
(async () => { const b = await chromium.launch();
  const runs = [["dossier", "Sam Burns", 1280, ""], ["dossier", "Erik van Rooyen", 390, ""], ["fit", "", 1280, ""], ["fit", "", 390, ""], ["week", "Sam Burns", 1280, ""], ["week", "Sam Burns", 390, ""], ["dossier", "Sam Burns", 1280, "&light"], ["week", "Sam Burns", 1280, "&light"]];
  for (const [p, who, w, x] of runs) { const pg = await b.newPage({ viewport: { width: w, height: 900 } }); const logs = [];
    pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.text()); }); pg.on("pageerror", (e) => logs.push("PAGEERR " + e.message));
    await pg.goto(`http://localhost:8765/__insights.html?p=${p}&who=${encodeURIComponent(who)}${x}`); await pg.waitForTimeout(4000);
    if (p === "week" && w === 1280 && !x) { await pg.click("text=Send to Burns").catch((e) => logs.push("click " + e.message)); await pg.waitForTimeout(500); logs.push("saved " + JSON.stringify(await pg.evaluate(() => (window.__saved || []).map(([o, i]) => [o, i.title, i.items[0].target])))); }
    const f = `${out}/${p}-${w}${x ? "-light" : ""}.png`; await pg.screenshot({ path: f, fullPage: true });
    console.log(f, JSON.stringify(logs).slice(0, 1500), await pg.evaluate(() => JSON.stringify(window.__errs || []))); await pg.close(); }
  await b.close(); })();
