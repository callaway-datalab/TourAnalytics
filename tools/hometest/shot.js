const { chromium, devices } = require("playwright");
(async () => { const out = process.argv[2], b = await chromium.launch();
  for (const [name, opts] of [["desktop", { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 }], ["phone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }]]) {
    const ctx = await b.newContext(opts), p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push("pageerror: " + e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
    await p.goto("http://localhost:8765/__home.html"); await p.waitForTimeout(6000);
    await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    const info = await p.evaluate(() => ({ secs: [...document.querySelectorAll(".td-sec")].map((s) => `${s.id}:${s.querySelectorAll("article, .td-wire-i, .td-fx").length}`), lead: document.querySelector(".td-lead h2")?.textContent, sw: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    console.log(name, JSON.stringify(info)); errs.slice(0, 8).forEach((e) => console.log("  ", e)); await ctx.close(); }
  await b.close(); })();
