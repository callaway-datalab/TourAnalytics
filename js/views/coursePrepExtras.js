/*
 * Play › Course Prep (update 160): the pieces around the course itself.
 *   Course Reports: the PDFs shared with you (or your players), at the top of the page.
 *   A real course:  Course Maps (PDFs uploaded for that course), Course History (the player's numbers at that course,
 *                   from the stats file's Course column) or Simulate Round (the course prep round).
 */
import { el, mount, formatWhen, openTabNow } from "../ui.js";
import { reportCategory } from "../data.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels } from "../names.js";
import { CATEGORIES, detectColumns, isShotData, prepare, summaryPlayers, sameCourse, courseKey, fmtSG } from "../sg.js";
import { tile, SG, sgCls } from "./practiceShot.js";

/* ------------------------------------------------ the documents you can see ------------------------------------------------ */
let docsCache = null; // { at, docs }
/** Every report you can see (the admin: all of them; a coach: their players'; a player: theirs), once. */
export async function courseDocs(ctx) {
  if (docsCache && Date.now() - docsCache.at < 60000) return docsCache.docs;
  const store = await import("../store.js");
  const state = ctx.state, team = effectiveTeam(state);
  const once = (watch) => new Promise((res) => {
    let un = null, done = false;
    const finish = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); };
    try { un = watch((list) => finish(list || [])); } catch { finish([]); }
    setTimeout(() => finish([]), 8000);
  });
  let lists = [];
  if (state.isAdmin && !team.preview) lists = [await once((cb) => store.watchAdminDocuments(cb))];
  else if (team.isTeam) lists = await Promise.all(Object.entries(team.teamAccess).map(([k, a]) => once((cb) => store.watchDocumentsFor(k, a.role || "coach", cb))));
  else if (state.profile?.clientKey) lists = [await once((cb) => store.watchDocumentsFor(state.profile.clientKey, null, cb))];
  const seen = new Map();
  for (const d of lists.flat()) seen.set(d.id, d);
  const docs = [...seen.values()].sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0));
  docsCache = { at: Date.now(), docs };
  return docs;
}

async function openDoc(ctx, d, link) {
  if (link.dataset.busy) return;
  link.dataset.busy = "1";
  const isPdf = d.mimeType === "application/pdf";
  const tab = isPdf ? openTabNow() : null; // (on the tap, so phones allow it)
  const was = link.querySelector(".row-title")?.textContent;
  if (was) link.querySelector(".row-title").textContent = "Opening…";
  try {
    const { getDocumentBlobUrl } = await import("../store.js");
    const url = await getDocumentBlobUrl(d);
    if (isPdf) tab.show(url, d.originalName || "report.pdf");
    else { const a = document.createElement("a"); a.href = url; a.download = d.originalName; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { tab?.close(); ctx.flash?.("Couldn't open that file. Try again.", "error"); }
  finally { if (was) link.querySelector(".row-title").textContent = was; delete link.dataset.busy; }
}
const docRow = (ctx, d) => {
  const link = el("a", { class: "row-main", href: "#" }, [el("span", { class: "row-title" }, d.title), d.description ? el("span", { class: "muted" }, d.description) : null]);
  link.addEventListener("click", (e) => { e.preventDefault(); openDoc(ctx, d, link); });
  return el("li", {}, [link, el("span", { class: "row-meta" }, [el("span", { class: "tag" }, d.mimeType === "application/pdf" ? "PDF" : "PowerPoint"), el("br"), el("span", { class: "muted" }, formatWhen(d.uploadedAt))])]);
};

/** (update 162) A course's reports and maps: a Course Map or Course Report for that course, or an older Course Report
 *  (uploaded before reports had a course) whose title or description names it. */
export const forCourse = (d, name) => {
  const cat = reportCategory(d);
  if (cat !== "map" && cat !== "course") return false;
  if (d.course) return sameCourse(d.course, name);
  return cat === "course" && (sameCourse(d.title, name) || [d.title, d.description].some((t) => courseKey(t || "").includes(courseKey(name)) && courseKey(name).length >= 4));
};
/** (no longer on the page: a course's reports are under Course Maps) */
export function reportsPanel(ctx) {
  const list = el("ul", { class: "rows" }, el("p", { class: "muted ta-loading" }, "Loading…"));
  const admin = ctx.state.isAdmin && !effectiveTeam(ctx.state).preview;
  courseDocs(ctx).then((docs) => {
    const items = docs.filter((d) => reportCategory(d) === "course");
    mount(list, items.length ? items.map((d) => docRow(ctx, d)) : el("p", { class: "empty" }, "No course reports yet."));
  }).catch(() => mount(list, el("p", { class: "empty" }, "Couldn't load the course reports.")));
  return el("section", { class: "panel cp-reports" }, [
    el("div", { class: "pr-sub" }, [el("h2", {}, "Course Reports"), admin ? el("a", { class: "link", href: "#/admin/documents" }, "Upload ›") : null]),
    list,
  ]);
}

/* ------------------------------------------------ a real course: the three choices ------------------------------------------------ */
export function drawPrepMenu(ctx, course) {
  const back = el("button", { type: "button", class: "link" }, "← Course Prep");
  back.addEventListener("click", () => ctx.home());
  const par = course.par.reduce((a, b) => a + (b || 0), 0), yds = course.yards.reduce((a, b) => a + (Number(b) || 0), 0);
  const nMaps = el("span", { class: "cp-opt-n" });
  const holesTxt = course.holeMaps ? `${course.par.length} hole maps` : "";
  if (holesTxt) nMaps.textContent = holesTxt;
  courseDocs(ctx).then((docs) => { const n = docs.filter((d) => forCourse(d, course.name)).length; nMaps.textContent = [holesTxt, n ? `${n} report${n === 1 ? "" : "s"}` : holesTxt ? "" : "None yet"].filter(Boolean).join(" \u00b7 "); }).catch(() => {});
  const opt = (title, sub, extra, go) => {
    const b = el("button", { type: "button", class: "cp-opt" }, [el("strong", {}, title), el("span", { class: "muted small" }, sub), extra]);
    b.addEventListener("click", go);
    return b;
  };
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel pr-plan" }, [
    el("p", { class: "pr-eyebrow" }, "Course Prep"), el("h1", {}, course.name),
    el("p", { class: "muted" }, [course.location, `${course.par.length} holes · par ${par}${yds ? ` · ${yds.toLocaleString()} yds` : ""}`].filter(Boolean).join(" · ")),
    el("div", { class: "cp-opts" }, [
      opt("Course Maps", course.holeMaps ? "A map of every hole, and the course reports" : "The course reports and maps for this course", nMaps, () => ctx.go({ name: "prepMaps", course })),
      opt("Course History", "Your numbers at this course, from the stats", null, () => ctx.go({ name: "prepHistory", course })),
      opt("Simulate Round", "Play it on the range, shot by shot", null, () => ctx.go({ name: "prepCourse", course })),
    ]),
  ])]);
}

export async function drawMaps(ctx, course) {
  const back = el("button", { type: "button", class: "link" }, `← ${course.name}`);
  back.addEventListener("click", () => ctx.go({ name: "prepMenu", course }));
  const list = el("ul", { class: "rows" }, el("p", { class: "muted ta-loading" }, "Loading…"));
  const holes = course.holeMaps ? holeGrid(course) : null;
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel" }, [el("p", { class: "pr-eyebrow" }, course.name), el("h1", {}, "Course Maps"),
    holes, holes ? el("h2", { class: "cp-rep-h" }, "Course reports") : null, list])]);
  const docs = await courseDocs(ctx).catch(() => []);
  const maps = docs.filter((d) => forCourse(d, course.name));
  mount(list, maps.length ? maps.map((d) => docRow(ctx, d)) : el("p", { class: "empty" }, `No ${holes ? "reports" : "reports or maps"} for ${course.name} yet.${ctx.state.isAdmin ? " Upload one with this course's name in Course." : " Ask your Callaway analyst."}`));
}

/* (update 452) a built-in course's hole maps: a card for each hole (tap for the big view, with previous / next) */
const holeUrl = (course, n) => `${course.holeMaps}/${n}.webp?v=1`;
function holeGrid(course) {
  const n = course.par.length;
  const nine = (from) => el("div", { class: "cp-holes" }, Array.from({ length: Math.min(9, n - from) }, (_, i) => {
    const h = from + i + 1;
    const b = el("button", { type: "button", class: "cp-hole", "aria-label": `Hole ${h}, par ${course.par[h - 1]}, ${course.yards[h - 1] || "?"} yards` }, [
      el("img", { src: holeUrl(course, h), alt: "", loading: "lazy", decoding: "async" }),
      el("span", { class: "cp-hole-t" }, [el("strong", {}, `${h}`), el("span", {}, `Par ${course.par[h - 1]}${course.yards[h - 1] ? ` \u00b7 ${course.yards[h - 1]} yds` : ""}`)]),
    ]);
    b.addEventListener("click", () => holeViewer(course, h));
    return b;
  }));
  const sum = (a, b) => a.slice(b[0], b[1]).reduce((t, v) => t + (Number(v) || 0), 0);
  const head = (lab, r) => el("p", { class: "cp-nine" }, [el("strong", {}, lab), el("span", { class: "muted small" }, ` \u00b7 par ${sum(course.par, r)} \u00b7 ${sum(course.yards, r).toLocaleString()} yds`)]);
  return el("div", { class: "cp-holemaps" }, [
    el("p", { class: "muted small" }, `${course.tees ? `${course.tees} tees. ` : ""}Tee on the left, green on the right. Tap a hole to see it bigger.`),
    head("Front nine", [0, 9]), nine(0), n > 9 ? head("Back nine", [9, 18]) : null, n > 9 ? nine(9) : null]);
}
function holeViewer(course, start) {
  const n = course.par.length;
  let h = start;
  const dlg = el("dialog", { class: "cp-hv" });
  document.body.appendChild(dlg);
  const close = () => { try { dlg.close(); } catch { /* */ } dlg.remove(); document.removeEventListener("keydown", key); };
  const img = el("img", { class: "cp-hv-img", alt: "" });
  const title = el("h3", {});
  const prev = el("button", { type: "button", class: "btn ghost small", "aria-label": "Previous hole" }, "\u2190 Prev");
  const next = el("button", { type: "button", class: "btn ghost small", "aria-label": "Next hole" }, "Next \u2192");
  const x = el("button", { type: "button", class: "btn ghost small", "aria-label": "Close" }, "\u2715");
  const show = () => {
    img.src = holeUrl(course, h); img.alt = `Hole ${h} map`;
    title.textContent = `Hole ${h} \u00b7 Par ${course.par[h - 1]}${course.yards[h - 1] ? ` \u00b7 ${course.yards[h - 1]} yds` : ""}`;
    prev.disabled = h <= 1; next.disabled = h >= n;
    if (h < n) { const pre = new Image(); pre.src = holeUrl(course, h + 1); }
  };
  prev.addEventListener("click", () => { if (h > 1) { h--; show(); } });
  next.addEventListener("click", () => { if (h < n) { h++; show(); } });
  x.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  // swipe left / right for the next / previous hole
  let sx = null;
  img.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  img.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) { if (dx < 0 && h < n) h++; else if (dx > 0 && h > 1) h--; show(); } });
  const key = (e) => { if (e.key === "ArrowRight" && h < n) { h++; show(); } else if (e.key === "ArrowLeft" && h > 1) { h--; show(); } };
  document.addEventListener("keydown", key);
  mount(dlg, [el("div", { class: "cp-hv-head" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, course.name), title]), x]), el("div", { class: "cp-hv-pic" }, img), el("div", { class: "cp-hv-nav" }, [prev, next])]);
  show();
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
}

/* ------------------------------------------------ Course History ------------------------------------------------ */
const once = (watch) => new Promise((res) => { let un = null, done = false; const fin = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); }; un = watch(fin); setTimeout(() => fin([]), 8000); });
const roundsCache = new Map(); // player key → { rounds, field, ds }
async function playerData(key) {
  if (roundsCache.has(key)) return roundsCache.get(key);
  const store = await import("../store.js");
  const list = await once((cb) => store.watchClientDatasets(key, cb));
  const ds = (list || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
  if (!ds) { const out = { rounds: [], field: [], ds: null }; roundsCache.set(key, out); return out; }
  const [rows, summary] = await Promise.all([store.getDatasetRows(key, ds.id, ds.chunkCount), store.getFieldStats(ds.id).catch(() => null)]);
  const out = { rounds: prepare(rows, detectColumns(ds.columns || [])).filter((rd) => rd.shots.length), field: summaryPlayers(summary).filter((p) => p.rounds.length), ds };
  roundsCache.set(key, out);
  return out;
}
const perRound = (rs, cat = null) => (rs.length ? rs.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + (!cat || s.cat === cat ? s.sg : 0), 0), 0) / rs.length : null);
const scoring = (rs) => { let v = 0, w = 0; for (const rd of rs) for (const o of rd.obs || []) if (o.k === "scoring") { v += o.v * o.w; w += o.w; } return w ? v / w : null; };

/** Whose history: a player sees theirs; a coach picks one of their players; the admin searches. */
export async function drawHistory(ctx, course) {
  const back = el("button", { type: "button", class: "link" }, `← ${course.name}`);
  back.addEventListener("click", () => ctx.go({ name: "prepMenu", course }));
  const state = ctx.state, team = effectiveTeam(state);
  const out = el("div", {});
  let who = null; // { key, label }
  let picker = null;
  if (state.isAdmin && !team.preview) {
    const [{ adminAllClients }, { playerPicker }] = await Promise.all([import("../store.js"), import("../playerPicker.js")]);
    const { labels, ids } = await adminAllClients();
    const pp = playerPicker(labels, (p) => { who = p; show(); }, ids);
    picker = pp.node;
  } else if (team.isTeam) {
    const names = teamLabels(team.teamAccess);
    const keys = Object.keys(team.teamAccess).sort((a, b) => (names.get(a) || a).localeCompare(names.get(b) || b));
    const pref = ctx.previewClient && team.teamAccess[ctx.previewClient.key] ? ctx.previewClient.key : keys[0];
    who = pref ? { key: pref, label: names.get(pref) || pref } : null;
    if (keys.length > 1) {
      const sel = el("select", { "aria-label": "Player" }, keys.map((k) => el("option", { value: k, selected: k === pref }, names.get(k) || k)));
      sel.addEventListener("change", () => { who = { key: sel.value, label: names.get(sel.value) || sel.value }; show(); });
      picker = el("label", { class: "inline-select" }, ["Player", sel]);
    }
  } else if (state.profile?.clientKey) who = { key: state.profile.clientKey, label: state.profile.name || "You" };
  mount(ctx.body, [el("p", { class: "crumb" }, back), el("section", { class: "panel" }, [el("p", { class: "pr-eyebrow" }, course.name), el("h1", {}, "Course History"), picker]), out]);

  async function show() {
    if (!who) { mount(out, el("p", { class: "empty center" }, state.isAdmin ? "Pick a player." : "No player yet.")); return; }
    mount(out, el("p", { class: "muted center ta-loading" }, "Loading…"));
    const me = who;
    let data;
    try { data = await playerData(me.key); } catch (err) { console.error(err); mount(out, el("p", { class: "empty center" }, "Couldn't load the stats. Try again.")); return; }
    if (who !== me) return;
    mount(out, historyBody(course, me, data));
  }
  show();
}

function historyBody(course, who, { rounds, field, ds }) {
  if (!ds) return el("section", { class: "panel" }, el("p", { class: "empty" }, `No stats file for ${who.label} yet.`));
  const anyCourse = rounds.some((rd) => rd.course);
  const here = rounds.filter((rd) => sameCourse(rd.course, course.name));
  if (!here.length) {
    const names = [...new Set(rounds.map((rd) => rd.course).filter(Boolean))].sort();
    return el("section", { class: "panel" }, [
      el("p", { class: "empty" }, anyCourse ? `No rounds for ${who.label} at ${course.name} in the stats.` : "The stats file doesn’t have a Course column yet. Add one and re-upload it, and each player’s history at a course shows up here."),
      anyCourse && names.length ? el("p", { class: "muted small" }, `Courses in ${who.label}’s stats: ${names.slice(0, 12).join(", ")}${names.length > 12 ? `, and ${names.length - 12} more` : ""}.`) : null,
    ]);
  }
  const all = perRound(rounds), mine = perRound(here);
  // the field at this course (players with 2 or more rounds here), from the shared summary
  const fieldHere = field.map((p) => ({ p, rs: p.rounds.filter((rd) => sameCourse(rd.course, course.name)) })).filter((x) => x.rs.length >= 2 || x.p.key === who.key);
  const ranked = fieldHere.map((x) => ({ key: x.p.key, v: x.p.key === who.key ? mine : perRound(x.rs), rs: x.rs })).sort((a, b) => b.v - a.v);
  const rank = ranked.findIndex((x) => x.key === who.key) + 1;
  const others = ranked.filter((x) => x.key !== who.key);
  const fieldAvg = (cat) => (others.length ? others.reduce((t, x) => t + perRound(x.rs, cat), 0) / others.length : null);
  const events = new Map();
  for (const rd of here) { const k = `${rd.event}|${rd.year}`; (events.get(k) || events.set(k, { event: rd.event, year: rd.year, end: rd.date, rs: [] }).get(k)).rs.push(rd); if (String(rd.date) > String(events.get(k).end)) events.get(k).end = rd.date; }
  // each tournament here: the finish among those who played the most rounds there (from the summary)
  const finish = (e) => {
    const played = field.map((p) => ({ p, rs: p.rounds.filter((rd) => rd.event === e.event && String(rd.year) === String(e.year)) })).filter((x) => x.rs.length);
    if (!played.length) return null;
    const most = Math.max(...played.map((x) => x.rs.length));
    const list = played.filter((x) => x.rs.length >= most).map((x) => ({ key: x.p.key, v: perRound(x.rs) })).sort((a, b) => b.v - a.v);
    const i = list.findIndex((x) => x.key === who.key);
    return i < 0 ? (e.rs.length < most ? "MC" : null) : `${i + 1} of ${list.length}`;
  };
  const sc = scoring(here), scAll = scoring(rounds);
  const best = [...here].sort((a, b) => perRound([b]) - perRound([a]));
  const dateTxt = (d) => { const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" }); };
  return el("div", {}, [
    el("section", { class: "panel" }, [
      el("h2", {}, who.label),
      el("div", { class: "pr-tiles" }, [
        tile("Rounds here", String(here.length), "", `${events.size} tournament${events.size === 1 ? "" : "s"}`),
        tile("SG / round here", SG(mine), sgCls(mine), `${SG(all)} everywhere`),
        tile("Here vs everywhere", SG(mine - all), sgCls(mine - all), "strokes a round"),
        rank && ranked.length > 1 ? tile("Rank here", `${rank} of ${ranked.length}`, "", "players with 2+ rounds here") : null,
        sc != null ? tile("Scoring avg here", sc.toFixed(2), scAll != null ? (sc < scAll ? "pos" : sc > scAll ? "neg" : "") : "", scAll != null ? `${scAll.toFixed(2)} everywhere` : "") : null,
      ].filter(Boolean)),
    ]),
    el("section", { class: "panel" }, [el("h2", {}, "By category"), el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Category"), el("th", { class: "num" }, "Here"), el("th", { class: "num" }, "Everywhere"), el("th", { class: "num" }, "Difference"), others.length ? el("th", { class: "num" }, "Field here") : null])),
      el("tbody", {}, [[null, "Total"], ...CATEGORIES].map(([k, l]) => {
        const h = perRound(here, k), a = perRound(rounds, k), f = fieldAvg(k);
        return el("tr", {}, [el("td", {}, l), el("td", { class: `num ${sgCls(h)}` }, fmtSG(h)), el("td", { class: `num ${sgCls(a)}` }, fmtSG(a)), el("td", { class: `num ${sgCls(h - a)}` }, fmtSG(h - a)), others.length ? el("td", { class: `num ${sgCls(f)}` }, fmtSG(f)) : null]);
      })),
    ]))]),
    el("section", { class: "panel" }, [el("h2", {}, "Tournaments here"), el("div", { class: "table-scroll" }, el("table", { class: "plain" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Tournament"), el("th", { class: "num" }, "Rds"), el("th", { class: "num" }, "SG / round"), el("th", { class: "num" }, "Finish")])),
      el("tbody", {}, [...events.values()].sort((a, b) => String(b.end).localeCompare(String(a.end))).map((e) => { const v = perRound(e.rs); return el("tr", {}, [el("td", {}, dateTxt(e.end)), el("td", {}, e.event), el("td", { class: "num" }, String(e.rs.length)), el("td", { class: `num ${sgCls(v)}` }, fmtSG(v)), el("td", { class: "num" }, finish(e) || "—")]); })),
    ])),
    here.length >= 2 ? el("p", { class: "muted small" }, `Best round here: ${fmtSG(perRound([best[0]]))} (${best[0].event}, ${dateTxt(best[0].date)}). Toughest: ${fmtSG(perRound([best.at(-1)]))} (${best.at(-1).event}, ${dateTxt(best.at(-1).date)}).`) : null]),
  ]);
}
