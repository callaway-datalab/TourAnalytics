const { chromium } = require("playwright");
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (/warn|error/.test(m.type())) errs.push(m.text()); });
  await p.goto("http://localhost:8765/__home.html"); await p.waitForTimeout(9000);
  console.log((await p.innerText("#td-course")).slice(0, 6000)); console.log(errs.slice(0, 6).join("\n")); await b.close(); })();
