// (update 927) Future Outlook, moved here from Comparisons: Scouting's Outlook tab. Pick up to four players: the next three
// seasons (the site's one forecaster, js/forecast.js, worked out in a worker), the report's pages on the page itself (the
// overview with the verdict and the takeaways, side by side with the odds, a profile of each player with strengths,
// weaknesses and risks: the same pages the PDF prints, from js/outlookReport.js), what the forecast learned, and the
// report to print or save as a PDF.
import { el, mount, infoTip } from "../ui.js";

const ordinal = (n) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${t[(v - 20) % 10] || t[v] || t[0]}`; };
const MAX = 4;
const ST = { picks: null, open: new Set(), runs: new Map(), q: "" };
/** (update 927) another page (Comparisons, Cal) asks for these players' outlook: Scouting opens on the Outlook tab with them */
export function wantOutlook(keys) { ST.picks = [...new Set(keys)].slice(0, MAX); ST.goto = true; }
export function takeGoto() { const g = !!ST.goto; ST.goto = false; return g; }

/** box: where it goes; players: [{ k, nm }] everyone on the page; fieldP: () => Promise(the field the forecaster uses);
 *  tour: the tour the forecasts are on; sel: the player opened on the page (picked to start); redraw: draw the tab again;
 *  ownRounds: (key) => that player's rounds (for the report's distances) */
export function outlookTab(box, { players, fieldP, tour, sel = null, redraw, ownRounds = null }) {
  if (!ST.picks) ST.picks = sel ? [sel] : [];
  const nameOf = (k) => players.find((p) => p.k === k)?.nm || k;
  // ---- who: up to four, a search to add, the player opened as a one-tap add ----
  const chips = el("div", { class: "ol-chips" }, ST.picks.map((k) => { const b = el("button", { type: "button", class: "ol-chip", title: `Remove ${nameOf(k)}` }, [nameOf(k), el("span", { "aria-hidden": "true" }, " ✕")]);
    b.addEventListener("click", () => { ST.picks = ST.picks.filter((x) => x !== k); redraw(); }); return b; }));
  const q = el("input", { type: "search", class: "ol-q", placeholder: ST.picks.length >= MAX ? `Up to ${MAX} players` : "Add a player…", value: ST.q, disabled: ST.picks.length >= MAX ? true : null, "aria-label": "Add a player" });
  const sugg = el("div", { class: "ol-sugg" });
  const showSugg = () => { const t = q.value.trim().toLowerCase(); ST.q = q.value; if (!t) { mount(sugg, null); return; }
    const hits = players.filter((p) => !ST.picks.includes(p.k) && p.nm.toLowerCase().includes(t)).slice(0, 8);
    mount(sugg, hits.length ? hits.map((p) => { const b = el("button", { type: "button", class: "ol-hit" }, p.nm); b.addEventListener("click", () => { ST.picks = [...ST.picks, p.k].slice(0, MAX); ST.q = ""; redraw(); }); return b; }) : el("p", { class: "muted small" }, "No player by that name."));
  };
  q.addEventListener("input", showSugg);
  const addSel = sel && !ST.picks.includes(sel) && ST.picks.length < MAX ? (() => { const b = el("button", { type: "button", class: "btn ghost small" }, `+ ${nameOf(sel)}`); b.addEventListener("click", () => { ST.picks = [...ST.picks, sel]; redraw(); }); return b; })() : null;
  const head = el("div", { class: "cmp-sec-head info-head" }, [el("h2", {}, "Future Outlook: the next three seasons"),
infoTip("A forecast learned from this site\u2019s own data (update 435). Every round is first credited for the strength of its field. Then a Kalman filter follows each player event by event, per part of the game: then each player’s talent is worked out the way baseball’s projection systems (Marcel, Steamer, ZiPS) and Data Golf do it: a weighted average of their rounds, recent ones counting most, regressed toward the average once by an amount learned from the data; later seasons add only aging (the delta method, as in baseball). Plus what players of their age typically gain or lose (when the data has their birth date), and any signals (ball speed and distance changes, recent form, other tours, rounds played) that proved to help on past seasons. Every setting is learned, not chosen: see \u201cWhat the forecast learned\u201d below. The range and the accuracy are from forecasting past seasons using only the seasons before them. Ranks and chances are against every player ranked on the tour, forecast the same way; the chances come from 3,000 simulated seasons.")]);
  const pickCard = el("section", { class: "panel ol-pick" }, [head, el("p", { class: "muted small" }, `Pick up to ${MAX} players to compare. Everything below, and the PDF report, is for them.`), chips, el("div", { class: "ol-addrow" }, [q, addSel]), sugg]);
  requestAnimationFrame(() => { if (ST.q) { q.focus(); showSugg(); } });
  const out = el("div", { class: "ol-out" });
  mount(box, [pickCard, out]);
  if (!ST.picks.length) { mount(out, el("p", { class: "muted" }, "Pick one or more players to see their outlook.")); return; }

  // ---- the forecast for these players (with their chances), worked out off the page ----
  const pl = ST.picks.map((k) => ({ key: k, label: nameOf(k) })), key = `${tour}|${ST.picks.join(",")}`;
  let R = ST.runs.get(key);
  if (!R) { R = { busy: true }; ST.runs.set(key, R);
    Promise.all([fieldP(), import("../forecastClient.js")]).then(async ([fld, FC]) => { R.field = fld; R.res = await FC.runForecast(fld, { tour, players: pl }); })
      .catch((e) => { console.error(e); R.err = "Couldn’t work out the forecast just now."; }).finally(() => { R.busy = false; if (box.isConnected) redraw(); }); }
  if (R.busy) { mount(out, el("p", { class: "muted small ta-loading" }, "Working out the forecast… (up to a minute on a big file; the page stays usable while it does)")); return; }
  if (R.err) { mount(out, el("p", { class: "muted small" }, R.err)); return; }
  const { fcs, story, info } = R.res, m = info, ok = fcs.filter(Boolean), missing = pl.filter((p, i) => !fcs[i]).map((p) => p.label);
  if (!ok.length) { mount(out, el("p", { class: "muted small" }, `Not enough rounds on ${m.target || "the tour"} to forecast ${missing.join(", ")}.`)); return; }
  const f2 = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);
  const pct = (v) => (v == null ? "—" : v < 0.005 ? "<1%" : v > 0.995 ? ">99%" : `${Math.round(v * 100)}%`);
  const yrs = ok[0].years.map((y) => y.year);
  const order = [...ok].sort((a, b) => b.years.reduce((t, y) => t + y.total, 0) - a.years.reduce((t, y) => t + y.total, 0));
  const CATN = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" };
    const rows = [];
    order.forEach((f, i) => {
      const open = ST.open.has(f.key);
      const tr = el("tr", { class: "sg-tap", role: "button", tabindex: "0", "aria-expanded": String(open) }, [
        el("td", {}, [el("span", { class: "sg-exp", "aria-hidden": "true" }, open ? "▾ " : "▸ "), el("strong", {}, `${i + 1}. ${f.name}`), el("span", { class: "muted small" }, f.age != null ? ` · ${Math.floor(f.age)}` : " · age ?")]),
        el("td", { class: "num" }, f.now ? [el("span", { class: f.now.total >= 0 ? "pos" : "neg" }, f2(f.now.total)), el("span", { class: "muted small fc-sub" }, `${f.now.n} rds`), f.now.rank ? el("span", { class: "small fc-sub", title: f.now.ranked ? "This season so far, as the Stats page ranks it" : "Not enough rounds to be ranked yet: where they'd sit" }, `${ordinal(f.now.rank)}${f.now.ranked ? "" : "*"}`) : null] : "\u2014"), // (update 413: this season's rank)
        ...f.years.map((y) => el("td", { class: "num" }, [el("strong", { class: y.total >= 0 ? "pos" : "neg" }, f2(y.total)), el("span", { class: "muted small fc-sub" }, `${f2(y.lo)} to ${f2(y.hi)}`), el("span", { class: "small fc-sub" }, `~${ordinal(y.rank)}`)])),
      ]);
      const flip = () => { open ? ST.open.delete(f.key) : ST.open.add(f.key); redraw(); };
      tr.addEventListener("click", flip); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
      rows.push(tr);
      if (!open) return;
      for (const c of ["OTT", "APP", "ARG", "PUTT"]) rows.push(el("tr", { class: "cmp-sub cmp-deep" }, [el("td", {}, CATN[c]), el("td", { class: "num" }, f.now ? f2(f.now.cats[c]) : "—"), ...f.years.map((y) => el("td", { class: "num" }, f2(y.cats[c])))]));
      rows.push(el("tr", { class: "cmp-sub cmp-deep" }, [el("td", {}, "Chance of a top 10 / 50 / 100 season"), el("td", {}, ""), ...f.years.map((y) => el("td", { class: "num small" }, `${pct(y.top10)} / ${pct(y.top50)} / ${pct(y.top100)}`))])); // (update 414: + top 100)
    });
    const e1 = m.err[0];
    // (update 406) on players with a real season to check (20+ rounds), against the two simple guesses on the same seasons
    const acc = e1 ? `${m.outOfSample ? "Checked on seasons it hadn\u2019t seen" : "Checked on past seasons"}: one season ahead, off by about ${(e1.bt?.model ?? e1.mae).toFixed(2)} per round on average (${e1.bt?.n ?? e1.n} seasons of 20+ rounds)${e1.bt ? `; their latest season alone was off by ${e1.bt.last.toFixed(2)}, the tour average by ${e1.bt.avg.toFixed(2)}` : ""}.` : "";
    const ageNote = !m.ageOk ? "No birth dates in the data yet (add a birth_date column), so age isn’t taken into account." : `Age from ${m.agePlayers} players’ birth dates.`;
    // (update 397) what it learned from the data, in plain words
    // (update 410) what the new forecaster learned, in plain words
    const pr = m.params, pctS = (v) => `${Math.round(v * 100)}%`, pc = pr.cats || {};
    const learned = el("details", { class: "fc-learned" }, [el("summary", {}, "What the forecast learned from this data"),
      el("ul", { class: "fc-learned-l" }, [
        el("li", {}, `Field strength: every round is credited for the strength of its field (the average level of the players in it, worked out together with theirs), so a weak-field week counts for less and every tour sits on one scale. On ${m.target}, a field moves per round by ${f2(pr.field?.spread?.[0] ?? 0)} to ${f2(pr.field?.spread?.[1] ?? 0)} (the middle 80% of ${pr.field?.events ?? 0} events, last two seasons).`),
        // (update 435) the method baseball’s projection systems use (Marcel, Steamer) and Data Golf uses in golf
        el("li", {}, `The method: the one baseball’s projection systems are built on (Marcel, Steamer, ZiPS) and Data Golf uses for golf. A player’s talent is a weighted average of their rounds (recent rounds count most), regressed toward the average by adding a set number of rounds of average play, so a short record is pulled in more than a long one. That regression happens once; later seasons only add aging. Like Steamer and Data Golf, the weights and the regression are learned from this data: whatever best forecast each next season.`),
        el("li", {}, `A round’s weight halves every ${["OTT", "APP", "ARG", "PUTT"].map((c) => `${(pc[c]?.halfLife ?? 0)} year${pc[c]?.halfLife === 1 ? "" : "s"} (${CATN[c]})`).join(", ")}. Rounds of average added: ${["OTT", "APP", "ARG", "PUTT"].map((c) => `${CATN[c]} ${pc[c]?.regressRounds ?? 0}`).join(", ")}. Weight of each part in the total (Data Golf finds driving tells the most and putting the least): ${["OTT", "APP", "ARG", "PUTT"].map((c) => `${CATN[c]} ${(pc[c]?.weight ?? 1).toFixed(2)}`).join(", ")}.`),
        el("li", {}, `How much a full season (${pr.typicalN} rounds) above or below average carries into the next forecast: ${["OTT", "APP", "ARG", "PUTT"].map((c) => `${CATN[c]} ${pctS(pr.carry[c])}`).join(", ")}. A single round swings around a player’s level by about ${["OTT", "APP", "ARG", "PUTT"].map((c) => `${CATN[c]} ±${(pc[c]?.noise ?? 0).toFixed(2)}`).join(", ")}.`),
        pr.choices ? el("li", {}, `${pr.choices.useData ? "Settings used: the data’s own (age trusted by how much data each age has, no trend carried forward), because they predicted the seasons it hadn’t seen better than trend-following with age at full strength." : `Settings used: trend-following (each player’s direction over the last two seasons carried forward, fading by ${Math.round((1 - pr.choices.trendFade) * 100)}% a season) and age at full strength, because they predicted the seasons it hadn’t seen better than the data’s own settings.`}${pr.choices.cmp.some(Boolean) ? ` On seasons it hadn’t seen these were off by ${pr.choices.cmp.map((x, i) => (x ? `${x.yours.toFixed(3)} with trend and full age, ${x.dataOnly.toFixed(3)} with the data’s own settings, ${i ? `${i + 1} seasons ahead` : "one season ahead"}` : "")).filter(Boolean).join(", ")}.` : ""} Ranges show the middle half of a player’s likely level.`) : null,
        pr.signals?.tried ? el("li", {}, `Signals tested on seasons it hadn’t seen (each season held out in turn): ${pr.signals.kept.length ? `kept ${pr.signals.kept.map((k) => `${k.label.replace(/ \(.*\)$/, "")} (one typical difference, ±${k.sd.toFixed(k.key === "rounds" ? 2 : k.key === "ballSpeed" || k.key === "drive" ? 1 : 2)}, moves next season by ${f2(k.perSd[0])})`).join("; ")}` : "none helped, so none are used"}${pr.signals.tried.filter((t) => t.key !== "all" && !t.kept).length ? `. Not kept (no help on unseen seasons): ${pr.signals.tried.filter((t) => t.key !== "all" && !t.kept).map((t) => t.label.replace(/ \(.*\)$/, "")).join(", ")}` : ""}.`) : null,
        pr.age?.shared != null && Math.abs(pr.age.shared) >= 0.005 ? el("li", {}, `The average change from one season to the next, across all players and ages: ${f2(pr.age.shared)} per round. It’s already in next season’s forecast and isn’t added again after that: it would move every player down by the same amount (mostly the tour getting stronger), changing no rank or chance, so projections stay against today’s average field, as Marcel’s are against today’s league. The age effect below is how a player’s age makes them differ from it (centered, as Marcel’s age adjustment is).`) : null,
        el("li", {}, m.ageOk ? `Age (from ${pr.age.players} players’ birth dates): how much better or worse than the average change a season is at each age: ${[24, 28, 32, 36, 40].map((a) => `${f2(pr.age.at[a])} at ${a}`).join(", ")}. Worked out the way baseball does it (the delta method): every player’s change from one season to the next, averaged by age, with players who didn’t come back given the season they’d have been expected to have (so only the survivors don’t make aging look kinder than it is), smoothed over nearby ages${pr.choices?.ageFull ? ". Each age’s own value is used in full, at every age (your choice: the data alone would have leaned ages with few players on the ages around them)" : ""}.` : pr.age?.none ? "Age: left out. On seasons it hadn’t seen, projections were more accurate without it." : "Age: no birth dates in the data yet, so it isn’t learned or used."),
        el("li", {}, `Ranges: the middle half of a player’s likely level, sized from how far forecasts missed on seasons it hadn’t seen, less the part one season’s luck alone explains (about ±${(Math.sqrt((pr.sig2Tot ?? 0) / Math.max(1, pr.typicalN)) * 1.28).toFixed(2)} per round over a ${pr.typicalN}-round season). The chances of a top 10, 50 or 100 season include that luck.`),
        el("li", {}, `${pr.outOfSample ? "On seasons it hadn’t seen (each forecast only from the seasons before it)" : "On the seasons it learned from (too few seasons yet to hold some back)"}, for players with 20+ rounds, it was off by about ${m.err.map((x, i) => (x ? `${(x.bt?.model ?? x.mae).toFixed(2)} ${i ? `${i + 1} seasons ahead` : "one season ahead"}${x.bt ? ` (latest season alone ${x.bt.last.toFixed(2)}, tour average ${x.bt.avg.toFixed(2)})` : ""}` : "")).filter(Boolean).join("; ")} per round on average. Lower is better.`),
        el("li", {}, "Every setting above is learned from this data (by how well it forecast past seasons), not chosen."),
      ])]);

  // ---- the report's pages, on the page (the same as the PDF), in their own styles ----
  const pagesHost = el("div", { class: "ol-report" });
  try {
    const go = (B) => { const W = B.buildOutlookReport({ field: R.field, detail: null, fcs: order, info: m, ownRounds, web: true });
      const sh = pagesHost.shadowRoot || pagesHost.attachShadow({ mode: "open" }), light = document.documentElement.dataset.theme === "light";
      sh.innerHTML = `<style>${W.css}${WEB_CSS}${light ? "" : DARK_CSS}</style><div class="olw">${W.pages.join("\n")}</div>`; };
    if (R.B) go(R.B); else import("../outlookReport.js").then((B) => { R.B = B; if (pagesHost.isConnected) go(B); }).catch((e) => { console.warn(e); });
  } catch (e) { console.warn("outlook pages", e); mount(pagesHost, el("p", { class: "muted small" }, "The report's pages couldn’t be drawn here (the PDF may still work).")); }
  // ---- the PDF ----
  const exp = el("button", { type: "button", class: "btn small" }, "⭳ Export PDF report");
  exp.addEventListener("click", () => exportReport(exp, { field: R.field, fcs: order, info: m, ownRounds, missing }));
  mount(out, [
    el("section", { class: "panel ol-sec" }, [el("div", { class: "fc-foot fc-top" }, [exp, el("span", { class: "muted small" }, `A report of 5 pages or fewer: each player, side by side, and the projection${ok.length > 4 ? " (the first 4 players)" : ""}`)]),
      el("p", { class: "muted small" }, `Strokes gained per round against an average ${m.target || "tour"} field (each round credited for the strength of its field; close to the Stats page for a typical schedule). This season so far is as on the Stats page. With the middle half of their likely level (a single season’s luck can land wider) and the rank it would mean. Tap a player for each part of the game and their chances.`),
      el("div", { class: "cmp-tw" }, el("table", { class: "cmp-table fc-t" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", { class: "num" }, String(m.lastYear)), ...yrs.map((y) => el("th", { class: "num" }, y))])),
        el("tbody", {}, rows)])),
      el("div", { class: "fc-story" }, story.map((t) => el("p", {}, t))),
      missing.length ? el("p", { class: "muted small" }, `Not enough rounds on ${m.target} to forecast ${missing.join(", ")}.`) : null]),
    el("section", { class: "panel ol-sec" }, [el("p", { class: "fx-eyebrow" }, "The report"), el("p", { class: "muted small" }, "The overview and the verdict, side by side with the odds, then a profile of each player: strengths, weaknesses, risks, by season and month by month. The PDF prints these same pages."), pagesHost]),
    el("section", { class: "panel ol-sec" }, [el("p", { class: "fx-eyebrow" }, "How the forecast works"), el("p", { class: "muted small" }, [acc, " ", ageNote]), learned]),
  ]);
}

/** The PDF: the full report (with the field's distances when they come within a few seconds), in a new tab to print or
 *  save; on a phone or the installed app, on a page of its own (outlook.html) or over the page. */
async function exportReport(btn, { field, fcs, info, ownRounds, missing }) {
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = "Building the report…";
  const inApp = (() => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); } catch { return false; } })();
  const win = inApp ? null : window.open("", "_blank");
  try {
    const [{ buildOutlookReport }, FS] = await Promise.all([import("../outlookReport.js"), import("../fieldSummary.js")]);
    const det = await Promise.race([FS.currentFieldDetail().catch(() => null), new Promise((r) => setTimeout(() => r(null), 8000))]);
    const dataUrl = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); const b = await r.blob(); if (!/^image\//.test(b.type)) throw new Error("not an image"); return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); }); };
    const logo = await dataUrl("media/logo.png").catch(() => dataUrl("icons/icon-192.png")).catch(() => null);
    const html = buildOutlookReport({ field, detail: det?.field || null, fcs, info, ownRounds, extra: missing, logo });
    if (inApp) { let ok = false; try { sessionStorage.setItem("ta.outlookReport", html); ok = true; } catch { /* */ } if (ok) location.href = "outlook.html"; else showReportOverlay(html); }
    else if (win) {
      win.document.open(); win.document.write(html.replace(' onclick="print()"', "")); win.document.close();
      const wire = () => {
        const b = win.document.getElementById("printBtn"); if (b && !b.dataset.wired) { b.dataset.wired = "1"; b.addEventListener("click", () => { win.focus(); win.print(); }); }
        const c = win.document.getElementById("closeBtn"); if (c && !c.dataset.wired) { c.dataset.wired = "1"; c.addEventListener("click", () => { win.close(); if (!win.closed) { try { window.focus(); } catch { /* */ } } }); }
      };
      wire(); win.addEventListener("load", wire);
    } else {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const a = document.createElement("a"); a.href = url; a.download = "outlook-report.html"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }
  } catch (err) { console.error(err); win?.close(); alert("The report couldn’t be built just now."); }
  finally { btn.disabled = false; btn.textContent = "⭳ Export PDF report"; }
}

/** (update 443) The report over the page (phones and the installed app): a full-screen frame with Close and Print. */
function showReportOverlay(html) {
  document.querySelector(".rep-ov")?.remove();
  const frame = el("iframe", { class: "rep-ov-frame", title: "Outlook report" });
  frame.srcdoc = html.replace(/<div class="bar">[\s\S]*?<\/div>\n/, "");
  const close = el("button", { type: "button", class: "btn small rep-ov-close" }, "✕ Close");
  const print = el("button", { type: "button", class: "btn ghost small rep-ov-print" }, "Print or save as PDF");
  const ov = el("div", { class: "rep-ov", role: "dialog", "aria-modal": "true", "aria-label": "Outlook report" }, [el("div", { class: "rep-ov-bar" }, [close, print]), frame]);
  const done = () => { ov.remove(); document.documentElement.classList.remove("rep-ov-open"); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") done(); };
  close.addEventListener("click", done);
  print.addEventListener("click", () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { console.error(err); } });
  document.addEventListener("keydown", onKey);
  document.documentElement.classList.add("rep-ov-open");
  document.body.append(ov);
}

// the report's pages on the site: no fixed page size, one column on a phone, wide tables scroll sideways
const WEB_CSS = `:host{display:block}.olw{font:13px/1.45 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#1b1f24}
.olw .page{width:auto!important;min-height:0!important;height:auto!important;margin:0 0 14px!important;padding:16px!important;box-shadow:none!important;border-radius:12px;background:#fff;page-break-after:auto}
.olw .player{height:auto!important}.olw .pbody{display:block}.olw .pbody>*{margin-bottom:10px}
.olw table{display:block;overflow-x:auto;max-width:100%}.olw .cols>*,.olw .takes>*,.olw .card.band>*{min-width:0}.olw .page{max-width:100%;overflow:hidden}.olw h3 small{white-space:normal}.olw *{overflow-wrap:anywhere}.olw td,.olw th{overflow-wrap:normal}.olw .cols{gap:14px}.olw svg{max-width:100%;height:auto}
@media (max-width:760px){.olw .cols,.olw .c55,.olw .c50,.olw .c64,.olw .c3,.olw .c40,.olw .takes,.olw .cards{grid-template-columns:1fr!important}
.olw .card.band{grid-template-columns:1fr!important}.olw .boxes,.olw .boxes.b2{grid-template-columns:1fr 1fr!important}.olw h1{font-size:20px}.olw .banner{font-size:14px}.olw .page{padding:12px!important}
.olw .side .cols,.olw .side .cols.c3{gap:14px}.olw .brandbar em{display:none}}`;
// the dark theme: the same pages on the site's dark surfaces
const DARK_CSS = `.olw{color:#f2f2f7}.olw .page{background:#1c1c1e!important;border:1px solid rgba(255,255,255,.08)}
.olw .muted,.olw small,.olw .kicker,.olw h3 small,.olw .bl,.olw .labq,.olw .take .tk,.olw .take .nums,.olw .agebig,.olw .ph .pl{color:#8e8e93!important}
.olw th{color:#a1a1a6}.olw th,.olw td{border-bottom-color:rgba(255,255,255,.1)}.olw tr.hl td,.olw td.hlc,.olw th.hlc,.olw .tkbox,.olw .meth div{background:#2c2c2e!important}
.olw .tks b,.olw h1,.olw h2,.olw h3,.olw .who{color:#f2f2f7}.olw .card,.olw .take,.olw .box{border-color:rgba(255,255,255,.12)}.olw .pos{color:#30d158}.olw .neg{color:#ff6b5e}
.olw .banner{background:#000}.olw svg text.ax,.olw .spark text.ax{fill:#8e8e93}.olw svg line.grid{stroke:rgba(255,255,255,.08)}.olw svg line.zero{stroke:rgba(255,255,255,.3)}
.olw .box.s .bt,.olw .lab.s{color:#30d158}.olw .box.w .bt,.olw .lab.w{color:#ff6b5e}.olw .box.a .bt,.olw .lab.pj{color:#64a8ff}`;
