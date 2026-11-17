const { chromium } = require("playwright"); const out = process.argv[2];
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto("http://localhost:8765/__home.html"); await pg.waitForTimeout(6000);
  const n = () => pg.evaluate(() => ["form", "spot", "focus", "res"].map((id) => { const s = document.getElementById(`td-${id}`); return `${id}:${s?.querySelectorAll(".td-cols > *").length}:${s?.querySelector(".td-more-btn")?.textContent || "-"}`; }));
  console.log(await n()); await pg.click("#td-form .td-more-btn"); await pg.waitForTimeout(300); console.log(await n());
  await pg.click("#td-form .td-more-btn").catch(() => {}); await pg.waitForTimeout(300); console.log(await n());
  await pg.locator("#td-form").screenshot({ path: `${out}/form.png` }); console.log(errs); await b.close(); })();
