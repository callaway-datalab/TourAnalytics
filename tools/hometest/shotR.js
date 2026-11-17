const { chromium, devices } = require("playwright");
(async () => { const out = process.argv[2], b = await chromium.launch();
  for (const [name, opts] of [["results-desktop", { viewport: { width: 1280, height: 900 } }], ["results-phone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }]]) {
    const ctx = await b.newContext(opts), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto("http://localhost:8765/__results.html"); await p.waitForTimeout(4000);
    await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    console.log(name, JSON.stringify({ sw: await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]), best: await p.evaluate(() => document.querySelector(".tr-best")?.textContent?.slice(0, 120)), errs })); await ctx.close(); }
  await b.close(); })();
