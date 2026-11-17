// (update 816) the real header: the current player's chip, Search, the phone's bottom bar; Back keeps the place
const { chromium } = require("playwright"); const out = process.argv[2];
(async () => { const b = await chromium.launch(); const log = (...a) => console.log(...a);
  const page = async (w, url) => { const pg = await b.newPage({ viewport: { width: w, height: 900 } }); const errs = [];
    pg.on("pageerror", (e) => errs.push("PAGEERR " + e.message)); pg.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errs.push(m.text()); });
    await pg.goto(url); await pg.waitForTimeout(3500); return [pg, errs]; };
  // 1. desktop: current player from another page → Dossier opens on them, chip shows
  let [pg, errs] = await page(1280, "http://localhost:8765/__shell.html?p=dossier&cur=Si%20Woo%20Kim");
  log("h1:", await pg.textContent("h1.ip-h").catch(() => "?"), "| chip:", await pg.textContent(".cur-chip").catch(() => "?"));
  await pg.screenshot({ path: `${out}/s-dossier.png` });
  // 2. Ctrl+K, type "burn", screenshot, Enter → Burns's dossier, chip says Burns
  await pg.keyboard.press("Control+k"); await pg.waitForTimeout(300); await pg.keyboard.type("burn"); await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${out}/s-search.png` });
  await pg.keyboard.press("Enter"); await pg.waitForTimeout(400);
  log("after Enter hash:", await pg.evaluate(() => location.hash), "| chip:", await pg.textContent(".cur-chip"), "| stored:", await pg.evaluate(() => localStorage.getItem("ta.current")));
  // 3. search a page
  await pg.keyboard.press("Control+k"); await pg.keyboard.type("drills"); await pg.waitForTimeout(500);
  log("drills →", await pg.$$eval(".pal-row .pal-main b", (n) => n.slice(0, 4).map((x) => x.textContent)));
  await pg.keyboard.press("Escape");
  await pg.keyboard.press("Control+k"); await pg.keyboard.type("amex"); await pg.waitForTimeout(500);
  log("amex →", await pg.$$eval(".pal-row .pal-main b", (n) => n.map((x) => x.textContent)));
  await pg.keyboard.press("Escape");
  // 3b. the chip opens the player picker; a pick changes the header player without leaving the page
  await pg.click(".cur-chip .cur-go"); await pg.waitForTimeout(400); await pg.keyboard.type("mcki"); await pg.waitForTimeout(400);
  log("pick mode rows:", await pg.$$eval(".pal-row .pal-main b", (n) => n.map((x) => x.textContent))); await pg.keyboard.press("Enter"); await pg.waitForTimeout(300);
  log("after pick:", await pg.evaluate(() => location.hash), await pg.textContent(".cur-chip"));
  // 4. chip × clears
  await pg.click(".cur-x"); log("after ×:", await pg.evaluate(() => localStorage.getItem("ta.current")), "chip:", await pg.textContent(".cur-chip"));
  log("errs1", JSON.stringify(errs)); await pg.close();
  // 5. focus from a Home story
  [pg, errs] = await page(1280, "http://localhost:8765/__shell.html?p=dossier&cur=Sam%20Burns");
  await pg.evaluate(() => { history.replaceState(null, "", "#/dossier?player=c_samburns&focus=" + encodeURIComponent("PUTT|10-15 ft")); });
  await pg.close();
  // 6. phone: bottom bar, search
  [pg, errs] = await page(390, "http://localhost:8765/__shell.html?p=week&cur=Sam%20Burns");
  await pg.screenshot({ path: `${out}/s-phone.png` });
  await pg.click(".botbar-search"); await pg.waitForTimeout(300); await pg.keyboard.type("x"); await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}/s-phone-search.png` });
  log("errs2", JSON.stringify(errs)); await pg.close();
  [pg, errs] = await page(1280, "http://localhost:8765/__shell.html?p=fit&light");
  await pg.screenshot({ path: `${out}/s-fit-light.png` }); log("errs3", JSON.stringify(errs));
  await b.close(); })();
