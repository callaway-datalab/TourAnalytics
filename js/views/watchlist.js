/*
 * Watchlist (update 164): the players you follow, at a glance. Everyone with more than one player has it (the admin,
 * analysts, coaches with several players); a player (or one player's coach) gets the same page as "Home", for just
 * that player, without the adding and removing.
 *   Each player: strokes gained a round (Total, OTT, APP, ARG, PUTT) with ranks and how it's trending (last 10 rounds
 *   against the 10 before), their 3 best and 3 worst distances, any extra metrics you pick, and badges for big moves,
 *   hot streaks and slumps, form landmarks, best rounds, wins and milestones (on each card; update 167 took the alerts
 *   row off the top).
 */
import { el, mount, infoTip } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { detectColumns, isShotData, prepare, summaryPlayers, fmtSG } from "../sg.js";
// (update 443) the years in the data, newest first (kept per field)
const yearsMemo = new WeakMap();
function yearsOf(field, owns) {
  let ys = yearsMemo.get(field);
  if (!ys) { const set = new Set(); for (const p of field || []) for (const r of p.rounds || []) { const y = String(r.year || String(r.date || "").slice(0, 4)); if (/^\d{4}$/.test(y)) set.add(y); } ys = [...set]; if (field) yearsMemo.set(field, ys); }
  const set = new Set(ys); for (const rs of owns || []) for (const r of rs || []) { const y = String(r.year || String(r.date || "").slice(0, 4)); if (/^\d{4}$/.test(y)) set.add(y); }
  return [...set].sort((a, b) => b.localeCompare(a));
}
import { playerCard, metricCatalog, metricLabel, RECENT_PERIODS, periodLabel, ordinal, normMetricId } from "../watchlistData.js";
import { watchPrefs, loadWatch, saveWatch, watchIsPreview } from "../watchlist.js";
import { playerPicker } from "../playerPicker.js";

const once = (watch) => new Promise((res) => { let un = null, done = false; const fin = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); }; try { un = watch(fin); } catch { fin([]); } setTimeout(() => fin([]), 10000); });
const rkCls = (r) => (!r ? "" : r <= 10 ? "rk-10" : r <= 50 ? "rk-50" : r <= 100 ? "rk-100" : r <= 150 ? "rk-150" : "rk-out");
const sgCls = (v) => (v == null ? "" : Math.round(v * 100) === 0 ? "zero" : v > 0 ? "pos" : "neg");
const dateTxt = (d) => { const x = new Date(d); return isNaN(x) ? d || "" : x.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

export async function render(main, { previewClient }) {
  const state = getState(), team = effectiveTeam(state);
  const admin = state.isAdmin && !team.preview && !previewClient;
  const teamKeys = team.isTeam ? Object.keys(team.teamAccess) : [];
  const multi = admin || teamKeys.length > 1;
  const single = multi ? null : team.isTeam ? teamKeys[0] : previewClient?.key || state.profile?.clientKey || null;
  const store = await import("../store.js");

  const root = el("div", { class: "wl" });
  mount(main, root);
  const loadingNote = el("p", { class: "muted center wl-loading ta-loading" }, "Loading…");
  mount(root, [heroShell(), loadingNote]);
  if (!multi && !single) { mount(root, [heroShell(), el("section", { class: "panel" }, el("p", { class: "empty center" }, "No players have been added to your account yet."))]); return () => {}; }

  // ---- who: names, and who can be added ----
  let labels = new Map();
  if (admin) labels = (await store.adminAllClients()).labels;
  else if (team.isTeam) labels = teamLabels(team.teamAccess);
  else labels = new Map([[single, plainName(previewClient?.label || state.profile?.name || "You")]]);
  if (single && team.isTeam) labels = new Map([[single, labels.get(single) || single]]);
  const nameOf = (k) => labels.get(k) || k.replace(/^c_/, "");

  // ---- the data: the newest stats file, the field's shared summary, and the lie / distance detail ----
  const via = single || teamKeys[0];
  const list = admin ? await once((cb) => store.watchAdminDatasets(cb)) : await once((cb) => store.watchClientDatasets(via, cb));
  const ds = (list || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
  // (update 169: with no Tour file yet, Entered Rounds still works)
  const idx = ds ? detectColumns(ds.columns || []) : {};
  const summary = ds ? await store.getFieldStats(ds.id).catch(() => null) : null;
  let field = summaryPlayers(summary).filter((p) => p.rounds.length);
  let detail = null, detailMeta = null; // (update 543: what a phone's partial detail covers)
  // (update 178) anyone's name for the badge pop-ups: yours / your players', else the field's (the same names as
  // the Rankings), never a bare ID
  const fieldNames = new Map(field.filter((p) => p.name).map((p) => [p.key, plainName(p.name)]));
  const anyName = (k) => labels.get(k) || fieldNames.get(k) || enteredField?.find((p) => p.key === k)?.label || k.replace(/^c_/, "");
  const ownCache = new Map(); // key → full rounds (lie / distance)
  async function ownRounds(key) {
    // (update 223) their tour rows and their entered rounds together
    const ent = enteredField?.find((p) => p.key === key)?.rounds || [];
    const base = await tourRounds(key);
    if (!ent.length) return base;
    return [...(base || []), ...ent].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  async function tourRounds(key) {
    if (!ds) return null;
    if (ownCache.has(key)) return ownCache.get(key);
    const d = detailMeta?.partial ? null : detail?.find((p) => p.key === key); // (update 543: a partial detail has only some seasons: their own rows instead)
    if (d) { ownCache.set(key, d.rounds); return d.rounds; }
    let rows = [];
    try {
      if (admin) rows = await store.getDatasetRowsListed(key, ds.id);
      else { const meta = await store.getDatasetMeta(key, ds.id); rows = await store.getDatasetRows(key, ds.id, meta.chunkCount); }
    } catch { rows = []; }
    const r = rows.length ? prepare(rows, idx, key) : null;
    ownCache.set(key, r);
    return r;
  }
  // (update 312) the field's detail (loaded up front, while the app opens): waited for here, so each player's rounds
  // come from it rather than being fetched one by one
  if (ds) {
    try { const res = await (await import("../fieldStore.js")).getFieldDetail(ds.id, ds.uploadedAt?.toMillis?.() ?? 0); if (res?.players?.length) { detail = res.players; detailMeta = { partial: !!res.partial, years: new Set(res.years || []), tour: res.tour ?? null }; } } catch { /* the rows, one by one */ }
  }

  // ---- (update 169) Entered Rounds: the rounds entered in Enter New Round, yours included ----
  // You: your own entered rounds (add yourself with "＋ Me"). The admin sees everyone's; a coach their players' and
  // their own. Ranked among the players whose entered rounds you can see.
  const preview = team.preview || !!previewClient;
  const myKey = preview ? null : state.isAdmin && !state.profile?.clientKey ? `a_${state.user.uid}` : state.profile?.clientKey || null;
  const youLabel = "You";
  const src = () => "tour"; // (update 223: no Tour Events / Entered Rounds switch; entered rounds join the tour data)
  // each player's entered rounds added to their rounds in a field (and anyone with only entered rounds added)
  const mergeMemo = new WeakMap();
  const withEntered = (list) => {
    if (!list || !enteredField?.length) return list;
    if (mergeMemo.has(list)) return mergeMemo.get(list);
    const ent = new Map(enteredField.map((p) => [p.key, p]));
    const out = list.map((p) => (ent.has(p.key) ? { ...p, rounds: [...p.rounds, ...ent.get(p.key).rounds].sort((a, b) => String(a.date).localeCompare(String(b.date))) } : p));
    for (const p of enteredField) if (!list.some((q) => q.key === p.key)) out.push(p);
    mergeMemo.set(list, out);
    return out;
  };
  let enteredField = null, enteredLoading = null;
  const loadEntered = () => (enteredLoading ||= (async () => {
    const { liveAllRounds, watchPlayerRounds, isPlayerKey } = await import("../rounds.js");
    const { enteredPlayers } = await import("../roundCalc.js");
    const keysToLoad = [...new Set([...(multi ? teamKeys : [single]), myKey].filter(Boolean))];
    const rounds = admin ? ((await liveAllRounds()) || []).filter((r) => isPlayerKey(r.playerKey) || r.playerKey === myKey) : (await Promise.all(keysToLoad.map((k) => once((cb) => watchPlayerRounds(k, cb))))).flat();
    enteredField = enteredPlayers(rounds || [], (r) => (r.playerKey === myKey && multi ? youLabel : labels.get(r.playerKey) || plainName(r.playerLabel || r.playerKey.replace(/^c_/, ""))));
    for (const p of enteredField) if (!labels.has(p.key)) labels.set(p.key, p.label);
    return enteredField;
  })());
  if (myKey && multi) labels.set(myKey, youLabel); // (update 177: one player's own page keeps their name)
  await loadWatch(true);
  let prefs = watchPrefs();
  const picker = multi ? playerPicker(labels, (p) => { import("../perf.js").then((m) => m.bootLog(`watchlist search picked ${p?.key || "none"}`)).catch(() => {}); if (!p) return; const now = watchPrefs().players || []; if (!now.includes(p.key)) { prefs = { ...watchPrefs(), players: [...now, p.key] }; saveWatch({ players: prefs.players }); draw(); } setTimeout(() => { const i = pickerBox.querySelector("input"); if (i) i.value = ""; }, 0); }, new Map(), null, { autoPick: false }) : null;
  const pickerBox = el("div", { class: "wl-add" }, picker ? [picker.node] : []);
  { const i = picker?.node.querySelector("input"); if (i) i.placeholder = "Add a player to the Watchlist\u2026"; } // (update 556)
  // (update 556) the Tour filter at the top (in place of a tour switch on each card): null = every tour
  let tourSel = null; try { tourSel = localStorage.getItem("wl.tour") || null; } catch { /* */ }
  let filtersOpen = false;
  // (update 560) the table's order: tap a column (again: the other way; a third time: your own order)
  // (update 607) the Watchlist opens on the calm view (how each player is doing, in a sentence); "See all the numbers": the table
  let calm = true; try { calm = localStorage.getItem("wl.view") !== "numbers"; } catch { /* */ }
  // (update 608) a player's own Home (one player): the calm page too, its own setting
  let pcalm = true; try { pcalm = localStorage.getItem("wl.pview") !== "numbers"; } catch { /* */ }
  const setPCalm = (v) => { pcalm = v; try { localStorage.setItem("wl.pview", v ? "calm" : "numbers"); } catch { /* */ } };
  const setCalm = (v) => { calm = v; try { localStorage.setItem("wl.view", v ? "calm" : "numbers"); } catch { /* */ } };
  const briefOpen = { concern: false, hot: false }; // (update 601) Trending Down / Up start folded; a tap on the header opens one
  let colSort = { k: null, dir: -1 }; try { colSort = { ...colSort, ...(JSON.parse(localStorage.getItem("wl.colSort") || "null") || {}) }; } catch { /* */ }
  const setSort = (k) => { colSort = colSort.k !== k ? { k, dir: k === "name" ? 1 : -1 } : colSort.dir === (k === "name" ? 1 : -1) ? { k, dir: -colSort.dir } : { k: null, dir: -1 }; try { localStorage.setItem("wl.colSort", JSON.stringify(colSort)); } catch { /* */ } draw(); };
  let menuOpen = false;
  // (update 180) metrics for everyone, or a player's own (watchlists.metricsFor[key]: theirs instead of everyone's)
  let menuFor = "all";
  const normList = (l) => [...new Set((l || []).map(normMetricId))]; // (update 406)
  const metricsOf = (k) => normList(Array.isArray(prefs.metricsFor?.[k]) ? prefs.metricsFor[k] : prefs.metrics);
  const listFor = (who) => (who === "all" ? normList(prefs.metrics) : metricsOf(who));
  const setList = (who, m) => (who === "all" ? saveWatch({ metrics: m }) : saveWatch({ metricsFor: { ...(prefs.metricsFor || {}), [who]: m } }));
  // (update 171) each card starts folded (name, badges, the five strokes gained); opened ones stay open while you're
  // on the page. A player on more than one tour: the tour picked on their card (this visit).
  // (update 223) every card the same height folded: the badges area as tall as the tallest one's (blank space below fewer)
  const evenBadges = () => {
    const bs = [...root.querySelectorAll(".wl-cards .wl-badges")];
    bs.forEach((b) => { b.style.minHeight = ""; });
    // (update 294) cards in one column (a phone): nothing to line up, so no padding under the badges
    const cards0 = [...root.querySelectorAll(".wl-cards .wl-card")];
    if (cards0.length < 2 || new Set(cards0.map((c) => Math.round(c.getBoundingClientRect().left))).size < 2) { cards0.forEach((c) => { c.style.minHeight = ""; }); return; }
    const max = Math.max(0, ...bs.map((b) => b.getBoundingClientRect().height));
    bs.forEach((b) => { b.style.minHeight = `${max}px`; });
    // and anything else (a tour switch on one card): every folded card as tall as the tallest folded one
    const cs = [...root.querySelectorAll(".wl-cards .wl-card:not(.open)")];
    cs.forEach((c) => { c.style.minHeight = ""; });
    const top = Math.max(0, ...cs.map((c) => c.getBoundingClientRect().height));
    if (cs.length > 1) cs.forEach((c) => { c.style.minHeight = `${top}px`; });
  };
  let evenT = null;
  window.addEventListener("resize", () => { clearTimeout(evenT); evenT = setTimeout(() => { if (root.isConnected) evenBadges(); }, 150); });
  const openCards = new Set(), tourPick = new Map(), distOpen = new Set();
  let rel = false; // (update 226) Relative to Tour Avg // (update 223: distance lists opened to the rest)
  if (!multi && single) openCards.add(single); // (update 177: one player: their card starts open)

  // (update 189) no date, title or count: the filters are the top of the page (a preview still says whose)
  function heroShell(controls = null, sub = "") {
    if (!controls) return null;
    return el("header", { class: "panel wl-hero wl-hero-bare" }, [controls, sub && watchIsPreview() ? el("p", { class: "wl-sub wl-preview-note" }, "Their Watchlist (changes in a preview aren\u2019t saved).") : null]);
  }


  async function draw() {
    // (update 187) where you are, before anything moves (the player search is moved into the new controls,
    // which used to shorten the page and scroll you up a little on every redraw)
    const y0 = window.scrollY, h0 = root.offsetHeight;
    root.style.minHeight = `${h0}px`;
    prefs = watchPrefs();
    rel = false; // (update 242: always raw values; no Raw / Relative switch)
    const source = src();
    if (!enteredField) { try { await loadEntered(); } catch { enteredField = []; } }
    const fieldNow = withEntered(field) || [], detailNow = withEntered(detail);
    const keys = (multi ? prefs.players : [single]).filter((k) => labels.has(k) || fieldNow.some((p) => p.key === k));
    const owns = await Promise.all(keys.map((k) => ownRounds(k)));
    // (update 443) the years in the data (newest first), and the last 1 / 3 / 6 months; "season" is the newest year
    const years = yearsOf(fieldNow, owns);
    const ok = (p) => RECENT_PERIODS.some(([v]) => v === p) || (/^y:\d{4}$/.test(String(p)) && years.includes(String(p).slice(2)));
    let cur = ok(prefs.period) ? prefs.period : "season";
    if (cur === "season" && years.length) cur = `y:${years[0]}`;
    // (update 543) a phone's partial detail (some seasons of one tour): used for ranks only when it covers the period and
    // the player's tour; otherwise ranked by category against the summary
    const newestLoaded = detailMeta?.years?.size ? [...detailMeta.years].sort().pop() : null;
    const detailFor = (k) => {
      if (!detailMeta?.partial) return detailNow;
      const yOk = /^y:\d{4}$/.test(String(cur)) ? detailMeta.years.has(String(cur).slice(2)) : newestLoaded === years[0];
      const t = tourPick.get(k) ?? null, tOk = detailMeta.tour == null || t == null || t === detailMeta.tour;
      return yOk && tOk ? detailNow : null;
    };
    if (multi) for (const k of keys) { if (tourSel) tourPick.set(k, tourSel); else tourPick.delete(k); } // (update 556: the Tour filter)
    const cards0 = keys.map((k, i) => playerCard(k, { field: fieldNow, detail: detailFor(k), own: owns[i], label: nameOf(k), period: cur, metrics: metricsOf(k), tour: tourPick.get(k) ?? null, nameOf: anyName, noRanks: source === "entered",
      lite: multi && !openCards.has(k) })); // (update 329: folded cards: just their ranks; the rest when opened)
    // (update 319) the order: yours (drag to change), A–Z, or by SG: Total rank (best first)
    const sortBy = "mine"; // (update 560: the table's column headings sort it now; the old order buttons are gone)
    const lastName = (c) => String(c.label || "").trim().split(/\s+/).slice(-1)[0] || "";
    const cards = !multi || sortBy === "mine" ? cards0 : [...cards0].sort((a, b) => sortBy === "az"
      ? lastName(a).localeCompare(lastName(b)) || String(a.label).localeCompare(String(b.label))
      : (a.sg?.[0]?.rank ?? 1e9) - (b.sg?.[0]?.rank ?? 1e9) || String(a.label).localeCompare(String(b.label)));
    // (update 329) the list of metrics to pick from is only worked out when the + Metrics menu is open
    const catalog = menuOpen ? metricCatalog(fieldNow, owns.filter(Boolean).map((rounds) => ({ rounds })), detailNow, { noRanks: source === "entered" }) : [];
    // (update 213) metrics picked before that aren't offered any more: listed so they can be taken off
    if (menuOpen) {
      const offered = new Set(catalog.flatMap((g) => g.items.flatMap(([id, , rg]) => [id, ...(rg || []).map((x) => x.id)])));
      const old = [...new Set(listFor(menuFor))].filter((m) => !offered.has(m));
      if (old.length) catalog.push({ group: "No longer offered (untick to remove)", items: old.map((m) => [m, metricLabel(m), []]) });
    }

    // ---- controls ----
    const perBtn = ([v, l]) => {
      const b = el("button", { type: "button", class: `wl-per${cur === v ? " on" : ""}`, "aria-pressed": String(cur === v) }, l);
      b.addEventListener("click", () => { saveWatch({ period: v }); draw(); });
      return b;
    };
    const period = el("div", { class: "wl-periods" }, [
      el("div", { class: "wl-period", role: "group", "aria-label": "Year" }, years.map((y) => perBtn([`y:${y}`, y]))),
      el("div", { class: "wl-period", role: "group", "aria-label": "Recent" }, RECENT_PERIODS.map(perBtn)),
    ]);
    const metricsBtn = el("button", { type: "button", class: "btn ghost wl-metrics-btn", "aria-expanded": String(menuOpen) }, ["＋ Metrics", prefs.metrics.length ? el("span", { class: "wl-count" }, String(prefs.metrics.length)) : null]);
    metricsBtn.addEventListener("click", () => { menuOpen = !menuOpen; draw(); });
    // (update 180) whose metrics: everyone's, or one player's own (starting from everyone's)
    if (menuFor !== "all" && !keys.includes(menuFor)) menuFor = "all";
    const list = listFor(menuFor), own = menuFor !== "all" && Array.isArray(prefs.metricsFor?.[menuFor]);
    const whoSel = multi && keys.length ? (() => {
      const sel = el("select", { class: "wl-menu-who", "aria-label": "Metrics for" }, [el("option", { value: "all", selected: menuFor === "all" }, "Everyone"),
        ...keys.map((k) => el("option", { value: k, selected: menuFor === k }, `${nameOf(k)}${Array.isArray(prefs.metricsFor?.[k]) ? " (own)" : ""}`))]);
      sel.addEventListener("change", () => { menuFor = sel.value; draw(); });
      return sel;
    })() : null;
    const whoNote = menuFor === "all" ? (Object.keys(prefs.metricsFor || {}).some((k) => keys.includes(k)) ? el("p", { class: "muted small wl-menu-note" }, "Everyone except the players with their own (marked \u201cown\u201d).") : null)
      : own ? el("p", { class: "muted small wl-menu-note" }, [`${nameOf(menuFor)} has their own metrics. `, (() => { const b = el("button", { type: "button", class: "link" }, "Use everyone\u2019s instead"); b.addEventListener("click", () => { const mf = { ...(prefs.metricsFor || {}) }; delete mf[menuFor]; saveWatch({ metricsFor: mf }); draw(); }); return b; })()])
      : el("p", { class: "muted small wl-menu-note" }, `${nameOf(menuFor)} uses everyone\u2019s metrics. Change any and they get their own.`);
    const menu = menuOpen ? el("div", { class: "panel wl-menu", role: "group", "aria-label": "Metrics" }, [
      el("div", { class: "wl-menu-top" }, [el("div", { class: "wl-menu-who-row" }, [el("strong", {}, "Metrics for"), whoSel || el("strong", {}, "every card")]), el("div", { class: "wl-menu-acts" }, [
        // (update 214) Clear: take every metric off (for whoever the menu is for)
        list.length ? (() => { const b = el("button", { type: "button", class: "btn ghost small wl-menu-clear" }, "Clear"); b.addEventListener("click", () => { setList(menuFor, []); draw(); }); return b; })() : null,
        (() => { const b = el("button", { type: "button", class: "link" }, "Done"); b.addEventListener("click", () => { menuOpen = false; draw(); }); return b; })()])]),
      whoNote,
      el("div", { class: "wl-menu-groups" }, catalog.map((g) => el("div", { class: "wl-menu-g" }, [el("p", { class: "wl-menu-gt" }, g.group), ...g.items.map(([id, l, ranges]) => {
        // (update 172) Hit Green %, Pin-High %, On-Line %, Proximity, Up & Down %, Made Putt %: once ticked, pick
        // distances too ("All distances" is the stat over every shot); each pick is its own row on the cards
        const mine = (m) => m === id || (ranges || []).some((x) => x.id === m);
        const on = list.some(mine);
        const cb = el("input", { type: "checkbox", checked: on });
        // (update 214) ticking one starts with just "All" (every distance together); pick distances to add rows for them
        cb.addEventListener("change", () => { const m = cb.checked ? [...list, id] : list.filter((x) => !mine(x)); setList(menuFor, [...new Set(m)]); draw(); });
        const opt = el("label", { class: "wl-menu-o" }, [cb, el("span", {}, l)]);
        if (!on || !ranges?.length) return opt;
        const chip = (cid, text) => {
          const sel = list.includes(cid);
          const b = el("button", { type: "button", class: `wl-range${sel ? " on" : ""}`, "aria-pressed": String(sel), dataset: { id: cid } }, text);
          b.addEventListener("click", () => {
            let m = sel ? list.filter((x) => x !== cid) : [...list, cid];
            if (!m.some(mine)) m = list.filter((x) => !mine(x)); // (nothing left picked: the stat is off)
            setList(menuFor, m); draw();
          });
          return b;
        };
        const cats = [...new Set(ranges.map((r) => r.cat))];
        return el("div", { class: "wl-menu-stat" }, [opt, el("div", { class: "wl-ranges", role: "group", "aria-label": `${l}: distances` }, [
          chip(id, "All"),
          ...cats.flatMap((c) => [cats.length > 1 ? el("span", { class: "wl-range-cat" }, ranges.find((r) => r.cat === c).catLabel) : null, ...ranges.filter((r) => r.cat === c).map((r) => chip(r.id, r.label))]),
        ])]);
      })]))),
    ]) : null;
    const sourceSeg = null; // (update 223: no Tour Events / Entered Rounds switch)
    const meBtn = multi && myKey && !prefs.players.includes(myKey) ? (() => {
      const b = el("button", { type: "button", class: "btn ghost wl-me-btn", title: "Watch your own entered rounds" }, "＋ Me");
      b.addEventListener("click", () => { saveWatch({ players: [myKey, ...watchPrefs().players] }); draw(); });
      return b;
    })() : null;
    // (update 226) Raw stat value | Relative to Tour Avg
    const relSeg = el("div", { class: "wl-period wl-rel", role: "group", "aria-label": "Values" }, [[false, "Raw value"], [true, "Relative to Avg"]].map(([v, l]) => {
      const b = el("button", { type: "button", class: `wl-per${rel === v ? " on" : ""}`, "aria-pressed": String(rel === v) }, l);
      b.addEventListener("click", () => { if (rel === v) return; saveWatch({ rel: v }); draw(); });
      return b;
    }));
    const sortSeg = multi && keys.length > 1 ? el("div", { class: "wl-period wl-sort", role: "group", "aria-label": "Order" }, [["mine", "My Order"], ["az", "A\u2013Z"], ["rank", "SG Rank"]].map(([v, l]) => {
      const b = el("button", { type: "button", class: `wl-per${sortBy === v ? " on" : ""}`, "aria-pressed": String(sortBy === v), title: v === "mine" ? "Your order (hold a card and drag it)" : v === "az" ? "By last name" : "By SG: Total rank, best first" }, l);
      b.addEventListener("click", () => { try { localStorage.setItem("wl.sort", v); } catch { /* */ } draw(); });
      return b;
    })) : null;
    // (update 556) the Tour filter (each tour with how many of the players played it this period), the search, and the
    // rest folded into Filters
    const tourN = new Map(); for (const c of cards) for (const t of c.tours || []) tourN.set(t.tour, (tourN.get(t.tour) || 0) + 1);
    if (multi && tourSel && !tourN.has(tourSel) && keys.length) { tourSel = null; try { localStorage.removeItem("wl.tour"); } catch { /* */ } return draw(); }
    const tourPill = (t, label) => { const on = (tourSel || null) === t; const b = el("button", { type: "button", class: `wl-per wl-tourf${on ? " on" : ""}`, "aria-pressed": String(on) }, label);
      b.addEventListener("click", () => { if (on) return; tourSel = t; try { t ? localStorage.setItem("wl.tour", t) : localStorage.removeItem("wl.tour"); } catch { /* */ } draw(); }); return b; };
    const tourBar = multi && tourN.size ? el("div", { class: "wl-period wl-tourbar", role: "group", "aria-label": "Tour" }, [tourPill(null, `All (${cards.length})`), ...[...tourN].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([t, n]) => tourPill(t, `${t} (${n})`))]) : null;
    // (update 557) one slim bar: the tours, the search, the period (a drop-down) and a small Filters menu that opens over the
    // page (the order, + Metrics, + Me) rather than pushing the players down
    const perSel = (() => {
      const sel = el("select", { class: "wl-sel", "aria-label": "Period" }, [
        el("optgroup", { label: "Season" }, years.map((y) => el("option", { value: `y:${y}`, selected: cur === `y:${y}` }, y))),
        el("optgroup", { label: "Recent" }, RECENT_PERIODS.map(([v, l]) => el("option", { value: v, selected: cur === v }, l)))]);
      sel.addEventListener("change", () => { saveWatch({ period: sel.value }); draw(); });
      return sel;
    })();
    const filters = multi ? (() => {
      const d = el("details", { class: "wl-fmenu", ...(filtersOpen ? { open: true } : {}) }, [el("summary", { title: "Order, metrics and more" }, ["Filters", prefs.metrics.length ? el("span", { class: "wl-count" }, String(prefs.metrics.length)) : null]),
        el("div", { class: "wl-fmenu-pop" }, [el("p", { class: "wl-fmenu-t" }, "Show"), el("div", { class: "wl-filters-btns" }, [metricsBtn, meBtn])])]);
      d.addEventListener("toggle", () => { filtersOpen = d.open; });
      return d;
    })() : null;
    const controls = multi ? el("div", { class: "wl-bar" }, [
      el("div", { class: "wl-bar-top" }, [el("div", { class: "wl-title" }, [el("h1", {}, "Watchlist"), el("p", {}, [`${keys.length} player${keys.length === 1 ? "" : "s"}`, tourSel ? ` \u00b7 ${tourSel}` : "", ` \u00b7 ${periodLabel(cur)}`].join(""))]),
        el("div", { class: "wl-bar-r" }, [perSel, filters])]),
      el("div", { class: "wl-bar-mid" }, [tourBar, pickerBox])]) : el("div", { class: "wl-controls" }, [sourceSeg, period, sortSeg, metricsBtn, meBtn]);
    const where = source === "entered" ? "entered rounds" : "ranked on their tour";
    // (update 186) just how many players
    const sub = multi ? (keys.length ? `${keys.length} Player${keys.length === 1 ? "" : "s"}` : "Follow the players you care about")
      : `${nameOf(single)} · ${/^y:/.test(cur) ? periodLabel(cur) : periodLabel(cur).toLowerCase()} · ${source === "entered" ? "entered rounds" : "ranked on the tour"}`;
    // (update 168) previewing someone: their own Watchlist, and changes aren't kept
    const subLine = multi && watchIsPreview() ? `${sub} · their Watchlist (changes in a preview aren't saved)` : sub;

    // ---- the cards ----
    const shown = multi && tourSel ? cards.filter((c) => (c.tours || []).some((t) => t.tour === tourSel)) : cards;
    const ctx = { field: fieldNow, owns, keys, cur, detailFor };
    // (update 607) the calm view
    if (multi && keys.length && calm) {
      const add = el("details", { class: "wlc-add" }, [el("summary", {}, "+ Add or remove players"), el("div", { class: "wlc-add-b" }, [tourBar, pickerBox])]);
      mount(root, [calmView(shown, ctx, () => { setCalm(false); draw(); }, add)]);
      requestAnimationFrame(() => { root.style.minHeight = ""; });
      return;
    }
    // (update 608) one player (a player's own Home, or a coach with one player): the calm page
    if (!multi && pcalm && cards[0] && !cards[0].empty) {
      mount(root, [playerHome(cards[0], () => { setPCalm(false); draw(); window.scrollTo(0, 0); })]);
      requestAnimationFrame(() => { root.style.minHeight = ""; });
      return;
    }
    const brief = multi && shown.length ? briefing(shown, ctx) : null; // (update 557)
    const body = multi && !keys.length ? emptyState() : multi ? tableView(shown, ctx, brief?.status) : el("div", { class: "wl-cards solo" }, cards.map((c) => { const n = cardView(c); n.dataset.key = c.key; return n; }));
    if (multi && keys.length > 1 && !watchIsPreview() && colSort.k == null) dragToReorder(body, ".wl-row[data-key]"); // (update 249; 319: only in your own order; 556: the table's rows)
    // (update 169) redrawing (ticking a metric, the period) keeps your place on the page
    const y = y0, keepFocus = document.activeElement?.closest?.(".wl-menu-o")?.textContent || null, keepChip = document.activeElement?.closest?.(".wl-range")?.dataset.id || null;
    const dragHint = multi && keys.length > 1 && !watchIsPreview() && colSort.k == null ? el("p", { class: "muted small center wl-drag-hint" }, "Tap a player for their card, a column heading to sort by it. Hold a row and drag it to change your order.") : null; // (update 249)
    const toCalm = (multi && keys.length) || (!multi && cards[0] && !cards[0].empty) ? (() => { const b = el("button", { type: "button", class: "link wlc-back" }, "\u2190 Simple view"); b.addEventListener("click", () => { if (multi) setCalm(true); else setPCalm(true); draw(); window.scrollTo(0, 0); }); return b; })() : null; // (update 607; 608: one player too)
    mount(root, [toCalm, multi ? el("header", { class: "wl-hero2" }, controls) : heroShell(controls, subLine), menu, brief?.node || null, body, dragHint,
      el("div", { class: "center wl-foot" }, infoTip(source === "entered"
        ? `Strokes Gained values represent per round averages. Trends: the last 20 rounds against the 20 before (the DP World Tour: the last 5 events against the 5 before); with fewer than 24 rounds, the latest half against the half before (at least 3 each, so 6 rounds or more).${rel ? " Relative to Avg: each value less the average of everyone else on that tour in this period." : ""}`
        : `Strokes Gained values represent per round averages. Trends: the last 20 rounds against the 20 before (the DP World Tour: the last 5 events against the 5 before); with fewer than 24 rounds, the latest half against the half before (at least 3 each, so 6 rounds or more).${rel ? " Relative to Avg: each value less the average of everyone else on that tour in this period." : ""} Ranks: among players with ${cards[0]?.minR || "enough"} or more rounds on the tour shown, in this period. A player on more than one tour has a switch on their card${detail ? "" : ". Distance ranks appear once the field's lie and distance detail has been published"}.`))]);
    window.scrollTo(0, y);
    if (keepFocus) [...root.querySelectorAll(".wl-menu-o")].find((o) => o.textContent === keepFocus)?.querySelector("input")?.focus({ preventScroll: true });
    if (keepChip) [...root.querySelectorAll(".wl-range")].find((o) => o.dataset.id === keepChip)?.focus({ preventScroll: true });
    requestAnimationFrame(() => { root.style.minHeight = ""; evenBadges(); window.scrollTo(0, y); });
  }

  function emptyState() {
    // (update 291) just the message: players are added with the search above (no suggested-player chips)
    return el("section", { class: "panel wl-empty" }, [
      el("div", { class: "wl-empty-star", "aria-hidden": "true" }, "★"),
      el("h2", {}, "Build your Watchlist"),
      el("p", { class: "muted" }, "Add the players you follow: their strokes gained, ranks, trends and alerts all land here, and they sit at the top of every player search."),
    ]);
  }

  function openPlayer(key) {
    if (key && key === myKey) { location.hash = "#/entry"; return; } // (you: your entered rounds)
    if (admin) location.hash = `#/admin/player-stats?player=${encodeURIComponent(key)}`;
    else if (team.isTeam) location.hash = `#/view-as/${encodeURIComponent(key)}?label=${encodeURIComponent(nameOf(key))}&to=/dashboard`;
    else location.hash = "#/dashboard";
  }

  const trendEl = (t, { higher = true, fmt = (x) => Math.abs(x).toFixed(2), band = 0.05 } = {}) => {
    if (!t) return el("span", { class: "wl-tr muted" }, "—");
    const flat = Math.abs(t.ch) < band;
    const good = higher == null ? null : higher ? t.ch > 0 : t.ch < 0;
    return el("span", { class: `wl-tr ${flat ? "flat" : good == null ? "" : good ? "up" : "down"}`, title: `Last ${t.n}: ${t.last?.toFixed?.(2)} · previous ${t.n}: ${t.prev?.toFixed?.(2)}` }, flat ? "◆ steady" : `${t.ch > 0 ? "▲" : "▼"} ${fmt(t.ch)}`);
  };
  // (update 387) nothing ranked (practice rounds): no rank pill at all
  const rankPill = (r, of) => (src() === "entered" || !of ? null : r ? el("span", { class: `wl-rank ${rkCls(r)}`, title: `${ordinal(r)} of ${of}` }, ordinal(r)) : el("span", { class: "wl-rank none" }, "—"));

  /* (update 249) hold a card, then drag it: the order is saved (this week's guys at the top). A hold (a third of a
     second without moving) starts it, so taps, clicks and scrolling work as before. */
  function dragToReorder(box, sel = ".wl-card") {
    let hold = null, drag = null;
    const cardsNow = () => [...box.querySelectorAll(`:scope > ${sel}`)];
    const place = (e) => {
      const c = drag.card;
      c.style.transform = "none";
      const r = c.getBoundingClientRect();
      c.style.transform = `translate(${e.clientX - drag.gx - r.left}px, ${e.clientY - drag.gy - r.top}px) scale(1.02)`;
    };
    const onMove = (e) => {
      if (hold) { if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) stop(); return; }
      if (!drag) return;
      e.preventDefault();
      // over another card: this one goes before or after it (whichever half the pointer's in)
      const over = cardsNow().find((c) => { if (c === drag.card) return false; const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
      if (over) {
        const r = over.getBoundingClientRect(), list = cardsNow(), before = list.indexOf(drag.card) > list.indexOf(over);
        // one card a row (a phone): by height; side by side (a grid row): by side
        const lefts = new Set(list.map((x) => Math.round(x.getBoundingClientRect().left / 8)));
        const firstHalf = lefts.size === 1 ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
        if (before && firstHalf) box.insertBefore(drag.card, over); else if (!before && !firstHalf) box.insertBefore(drag.card, over.nextSibling);
      }
      place(e);
      const edge = 70; // near the top or bottom of the window: scroll
      if (e.clientY < edge) window.scrollBy(0, -12); else if (e.clientY > innerHeight - edge) window.scrollBy(0, 12);
    };
    const noScroll = (e) => { if (drag) e.preventDefault(); };
    const stop = () => {
      if (hold) { clearTimeout(hold.t); hold = null; }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("touchmove", noScroll);
      if (!drag) return;
      const c = drag.card; drag = null;
      c.classList.remove("wl-dragging"); c.style.transform = ""; box.classList.remove("wl-reordering");
      const order = cardsNow().map((x) => x.dataset.key).filter(Boolean);
      const all = watchPrefs().players || [];
      saveWatch({ players: [...order, ...all.filter((k) => !order.includes(k))] });
      // the click that ends a drag isn't a click on the card
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 60);
    };
    box.addEventListener("pointerdown", (e) => {
      const card = e.target.closest(sel);
      if (!card || card.parentElement !== box || e.button > 0 || drag) return;
      if (e.target.closest("input, select, textarea")) return;
      hold = { x: e.clientX, y: e.clientY, t: setTimeout(() => {
        const r = card.getBoundingClientRect();
        drag = { card, gx: hold.x - r.left, gy: hold.y - r.top };
        hold = null;
        card.classList.add("wl-dragging"); box.classList.add("wl-reordering");
        try { navigator.vibrate?.(15); } catch { /* */ }
      }, 320) };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("touchmove", noScroll, { passive: false });
    });
    box.addEventListener("contextmenu", (e) => { if (drag || hold) e.preventDefault(); });
    box.addEventListener("dragstart", (e) => e.preventDefault());
  }
  /* (update 561) the briefing: the 5 biggest swings across the players, each one a part of the game, a distance or a lie
     ("Down in Approach · 150-175 yds"), the last 20 rounds against the 20 before, in strokes a round. Each player's
     biggest drop can be in Trending Down and their biggest rise in Trending Up. A tap: that one thing, in detail. */
  /* (update 607) the calm view: how many are playing well, steady or worth a look; a line on the latest week; then each
     player in a sentence (their strokes gained a round, the last 20 rounds against the 20 before, or the DP World Tour's
     5 events against 5, and where most of the change came from) with their latest event. A tap: their card. */
  const CAT_WORD = { OTT: "off the tee", APP: "on approach", ARG: "around the green", PUTT: "putting" };
  /* (update 608) a player's own Home: a greeting, how they're playing in a sentence (the last 12 rounds against the 12
     before; the DP World Tour: 5 events against 5), their latest event, their two best distances and one to work on.
     A coach with one player: the same, about the player. "See all your numbers": their full card. */
  function playerHome(c, toNumbers) {
    const you = !team.isTeam, first = String(c.label || "").split(" ")[0] || c.label;
    const hr = new Date().getHours(), tod = hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening";
    const cats = (c.areas?.list || []).filter((a) => !a.dist && !a.lie);
    const ch = cats.length ? cats.reduce((t, a) => t + a.ch, 0) : c.sg?.[0]?.trend?.ch ?? null;
    const n = c.areas?.n, unit = c.areas?.unit || "rounds";
    const st = ch == null ? "steady" : ch >= 0.3 ? "well" : ch <= -0.3 ? "look" : "steady";
    const lead = cats.filter((a) => (st === "well" ? a.ch > 0 : a.ch < 0)).sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch))[0];
    const PART = { OTT: "driving", APP: "approach play", ARG: "short game", PUTT: "putting" };
    const who = you ? "You\u2019re" : `${first} is`, their = you ? "your" : "their";
    const big = ch == null || !n ? `Not enough recent golf to say how ${you ? "you\u2019re" : `${first} is`} playing yet.`
      : st === "steady" ? `${who} playing about the same as ${their} previous ${n} ${unit}.`
      : `${who} ${st === "well" ? "up" : "down"} ${Math.abs(ch).toFixed(2)} strokes a round over ${their} last ${n} ${unit}.`;
    const small = st !== "steady" && lead ? `Most of it is ${st === "well" ? "from" : "in"} ${their} ${PART[lead.cat] || "game"}.` : null;
    const chip = { well: "Playing well", steady: "Steady", look: "Worth a look" }[st];
    const L = c.latest;
    const ev = L?.event ? el("div", { class: "ph-card" }, [el("p", { class: "ph-lbl" }, `${you ? "Your" : "Their"} latest event`),
      el("div", { class: "ph-ev" }, [el("div", {}, [el("b", {}, L.event), el("small", {}, [L.pos ? `${L.tie ? "T" : ""}${ordinal(L.pos)} of ${L.of} in strokes gained` : null, L.rounds ? `${L.rounds} round${L.rounds === 1 ? "" : "s"}` : null].filter(Boolean).join(" \u00b7 "))]),
        L.sg != null ? el("span", { class: `ph-v ${L.sg >= 0 ? "pos" : "neg"}` }, fmtSG(L.sg)) : null])]) : null;
    const WORD = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" };
    const nm = (d) => (d.cat === "APP" ? `Approach from ${d.dist}` : `${WORD[d.cat] || d.cat}, ${d.dist}`);
    const why = (d) => (d.rank && d.of > 1 && d.rank <= Math.max(3, Math.ceil(d.of * 0.1)) ? "One of the best on tour from here"
      : d.trend?.ch > 0.005 ? "Better than tour average and improving" : "Better than tour average");
    const best = (c.dists?.best || []).slice(0, 2), work = (c.dists?.worst || [])[0];
    const item = (d, kind, sub) => el("div", { class: `ph-row ${kind}` }, [el("span", { class: "ph-dot", "aria-hidden": "true" }, kind === "g" ? "\u25B2" : "\u25C6"), el("span", { class: "ph-t" }, [el("b", {}, nm(d)), el("span", {}, sub)])]);
    const parts = best.length || work ? el("div", { class: "ph-card" }, [
      best.length ? el("p", { class: "ph-lbl" }, "What\u2019s going well") : null, ...best.map((d) => item(d, "g", why(d))),
      work ? el("p", { class: "ph-lbl ph-lbl2" }, "One thing to work on") : null, work ? item(work, "w", `${you ? "Your" : "The"} biggest chance to pick up strokes`) : null]) : null;
    const more = el("button", { type: "button", class: "link wlc-more" }, `See all ${you ? "your" : `${first}\u2019s`} numbers \u2192`);
    more.addEventListener("click", toNumbers);
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    return el("div", { class: "wlc ph" }, [
      el("p", { class: "wlc-date" }, today), el("h1", { class: "wlc-h" }, you ? `Good ${tod}, ${first}` : `How ${first} is doing`),
      el("div", { class: `ph-hero ${st}` }, [el("span", { class: `wlc-chip ${st}` }, chip), el("p", { class: "ph-big" }, big), small ? el("p", { class: "ph-small" }, small) : null]),
      ev, parts, more,
    ]);
  }
  function calmView(cards, ctx, toNumbers, add) {
    const dOf = (d) => { const t = Date.parse(String(d || "").slice(0, 10)); return Number.isFinite(t) ? t : null; };
    const newest = Math.max(0, ...cards.map((c) => dOf(c.latest?.date) || 0));
    const two = (v) => Math.abs(v).toFixed(2);
    const rows = cards.filter((c) => !c.empty).map((c) => {
      const cats = (c.areas?.list || []).filter((a) => !a.dist && !a.lie);
      const ch = cats.length ? cats.reduce((t, a) => t + a.ch, 0) : c.sg?.[0]?.trend?.ch ?? null;
      const n = c.areas?.n, unit = c.areas?.unit || "rounds";
      const st = ch == null ? "steady" : ch >= 0.3 ? "well" : ch <= -0.3 ? "look" : "steady";
      const lead = cats.filter((a) => (st === "well" ? a.ch > 0 : a.ch < 0)).sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch))[0];
      const say = ch == null || !n ? "Not enough recent golf to say yet."
        : st === "steady" ? `About the same over the last ${n} ${unit} as the ${n} before.`
        : `${st === "well" ? "Up" : "Down"} ${two(ch)} a round over the last ${n} ${unit}${lead ? `, mostly ${CAT_WORD[lead.cat] || lead.cat}` : ""}.`;
      const L = c.latest, latest = L?.event ? `Latest: ${L.event}${L.pos ? ` \u00b7 ${L.tie ? "T" : ""}${ordinal(L.pos).replace(/^T?/, "")} of ${L.of} in strokes gained` : ""}${L.sg != null ? ` (${fmtSG(L.sg)} a round)` : ""}` : null;
      const fresh = !!(dOf(L?.date) && newest && newest - dOf(L.date) <= 10 * 864e5);
      return { c, st, ch, say, latest, lead, fresh };
    });
    const G = { well: rows.filter((r) => r.st === "well").sort((a, b) => b.ch - a.ch), steady: rows.filter((r) => r.st === "steady"), look: rows.filter((r) => r.st === "look").sort((a, b) => a.ch - b.ch) };
    const first = (r) => String(r.c.label || "").split(" ")[0];
    // this week: the best strokes-gained finish among those who just played, and the biggest worry
    const wk = [];
    const top = rows.filter((r) => r.fresh && r.c.latest?.pos).sort((a, b) => a.c.latest.pos - b.c.latest.pos)[0];
    if (top) wk.push(`${first(top)} was ${top.c.latest.tie ? "T" : ""}${ordinal(top.c.latest.pos)} in strokes gained at the ${top.c.latest.event}.`);
    const worry = G.look[0];
    if (worry && worry.lead) wk.push(`${first(worry)}\u2019s ${({ OTT: "driving", APP: "approach play", ARG: "short game", PUTT: "putting" })[worry.lead.cat] || "game"} has cooled off lately.`);
    const row = (r) => {
      const ini = String(r.c.label || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      const chip = { well: "Playing well", steady: "Steady", look: "Worth a look" }[r.st];
      const b = el("button", { type: "button", class: "wlc-p" }, [el("span", { class: "wlc-av", "aria-hidden": "true" }, ini),
        el("span", { class: "wlc-t" }, [el("span", { class: "wlc-n" }, [r.c.label, r.c.tour ? el("small", {}, r.c.tour) : null]), el("span", { class: "wlc-w" }, r.say), r.latest ? el("span", { class: "wlc-l" }, r.latest) : null]),
        el("span", { class: `wlc-chip ${r.st}` }, chip)]);
      b.addEventListener("click", () => openCard(r.c, ctx));
      return b;
    };
    const grp = (k, t) => (G[k].length ? [el("p", { class: "wlc-lbl" }, t), ...G[k].map(row)] : []);
    const more = el("button", { type: "button", class: "link wlc-more" }, "See all the numbers \u2192");
    more.addEventListener("click", toNumbers);
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    return el("div", { class: "wlc" }, [
      el("p", { class: "wlc-date" }, today), el("h1", { class: "wlc-h" }, "Your players"),
      el("div", { class: "wlc-sum" }, [["well", "playing well"], ["steady", "steady"], ["look", "worth a look"]].map(([k, l]) => el("div", { class: k }, [el("b", {}, String(G[k].length)), el("span", {}, l)]))),
      wk.length ? el("div", { class: "wlc-note" }, [el("b", {}, "This week: "), wk.join(" ")]) : null,
      ...grp("well", "Playing well"), ...grp("steady", "Steady"), ...grp("look", "Worth a look"),
      more, add,
      el("p", { class: "wlc-foot" }, "Playing well or worth a look: strokes gained a round up or down 0.30 or more over the last 20 rounds against the 20 before (the DP World Tour: 5 events against 5). Strokes gained at an event: against the players there who played as many rounds."),
    ]);
  }
  const CAT_NAME = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" };
  const areaName = (a) => `${CAT_NAME[a.cat] || a.cat}${a.dist ? ` · ${a.dist}` : a.lie ? ` · from the ${String(a.lie).toLowerCase()}` : ""}`;
  function briefing(cards, ctx) {
    const live = cards.filter((c) => !c.empty && c.areas?.list?.length);
    const dOf = (d) => { const t = Date.parse(String(d || "").slice(0, 10)); return Number.isFinite(t) ? t : null; };
    const newest = Math.max(0, ...cards.map((c) => dOf(c.latest?.date) || 0));
    const down = [], up = [];
    for (const c of live) {
      const cats = new Map(c.areas.list.filter((a) => !a.dist && !a.lie).map((a) => [a.cat, a]));
      // a distance or lie that's every shot of its part of the game (every tee shot is from the tee) only repeats it
      const ok = (a) => (a.wPrev >= 6 && a.wLast >= 6) && (!(a.dist || a.lie) || (cats.get(a.cat) && Math.abs(a.wPrev + a.wLast - cats.get(a.cat).wPrev - cats.get(a.cat).wLast) > 0.5));
      // (update 596) each player's 3 distances losing the most (Trending Down) and gaining the most (Trending Up), with
      // their total; the 5 players with the biggest totals in each
      const dists = c.areas.list.filter((a) => ok(a) && a.dist);
      const worst = dists.filter((a) => a.ch < 0).sort((a, b) => a.ch - b.ch).slice(0, 3), best = dists.filter((a) => a.ch > 0).sort((a, b) => b.ch - a.ch).slice(0, 3);
      const sum = (xs) => xs.reduce((t, a) => t + a.ch, 0);
      const fresh = !!(dOf(c.latest?.date) && newest && newest - dOf(c.latest.date) <= 10 * 864e5);
      if (worst.length && sum(worst) <= -0.2) down.push({ c, list: worst, tot: sum(worst), a: worst[0], fresh });
      if (best.length && sum(best) >= 0.2) up.push({ c, list: best, tot: sum(best), a: best[0], fresh });
    }
    down.sort((x, y) => x.tot - y.tot); up.sort((x, y) => y.tot - x.tot);
    const topD = down.slice(0, 5), topU = up.slice(0, 5);
    const status = new Map();
    for (const x of topU) status.set(x.c.key, "hot");
    for (const x of topD) status.set(x.c.key, "concern");
    const col = (kind, title, sub, list) => { const hd = el("button", { type: "button", class: "wlb-h wlb-fold", "aria-expanded": String(briefOpen[kind]) }, [el("span", { class: "wlb-dot", "aria-hidden": "true" }), el("h3", {}, title), el("span", { class: "wlb-n" }, String(list.length)), el("span", { class: "wlb-chev", "aria-hidden": "true" }, "\u25BE")]);
      const sec = el("section", { class: `wlb-col wlb-${kind}${briefOpen[kind] ? "" : " folded"}` }, [
      hd,
      el("p", { class: "wlb-sub" }, sub),
      list.length ? el("ul", {}, list.map((x) => {
        const dn = kind === "concern", unit = x.c.areas.unit === "events" ? "an event" : "a round";
        // (update 596) the player and their total, then each of their 3 distances (a tap: that one, in detail)
        return el("li", { class: "wlb-item wlb-multi" }, [
          el("span", { class: "wlb-name" }, [x.c.label, el("small", {}, x.c.tour || ""), x.fresh ? el("em", { class: "wlb-fresh" }, "Just played") : null]),
          el("span", { class: "wlb-act", title: `${dn ? "Losing" : "Gaining"} ${fmtSG(x.tot)} strokes ${unit} across these ${x.list.length}` }, fmtSG(x.tot)),
          el("span", { class: "wlb-area" }, `${dn ? "Losing" : "Gaining"} ${fmtSG(Math.abs(x.tot)).replace(/^\+/, "")} ${unit} in ${x.list.length === 1 ? "1 distance" : `${x.list.length} distances`}`),
          el("div", { class: "wlb-dists" }, x.list.map((a) => {
            const b = el("button", { type: "button", class: "wlb-dist", title: `${fmtSG(a.last)} over the last ${x.c.areas.n} ${x.c.areas.unit || "rounds"}, ${fmtSG(a.prev)} over the ${x.c.areas.n} before` }, [el("span", {}, areaName(a)), el("b", {}, fmtSG(a.ch))]);
            b.addEventListener("click", () => openFocus({ ...x, a }, kind, ctx));
            return b;
          }))]);
      })) : el("p", { class: "wlb-none" }, kind === "concern" ? "Nobody trending down." : "Nobody trending up.")]);
      hd.addEventListener("click", () => { briefOpen[kind] = !briefOpen[kind]; sec.classList.toggle("folded", !briefOpen[kind]); hd.setAttribute("aria-expanded", String(briefOpen[kind])); });
      return sec; };
    const node = el("div", { class: "wl-brief" }, [
      col("concern", "Trending Down", "The 5 players losing the most: each one\u2019s 3 worst distances and their total, the last 20 rounds against the 20 before. Tap a distance for the detail.", topD),
      col("hot", "Trending Up", "The 5 players gaining the most: each one\u2019s 3 best distances and their total, the same way.", topU),
    ]);
    return { node, status };
  }
  /* (update 556) the players as a table: the name, then Total and each part of the game, each cell its value, rank and
     trend (small); a tap opens the player's card */
  function tableView(cards, ctx, status = new Map()) {
    const heads = (cards.find((c) => !c.empty)?.sg || [{ short: "Total" }, { short: "OTT" }, { short: "APP" }, { short: "ARG" }, { short: "PUTT" }]).map((s) => s.short);
    const hb = (k, label, cls) => { const on = colSort.k === k; const b = el("button", { type: "button", class: `${cls} wl-sortb${on ? " on" : ""}`, "aria-sort": on ? (colSort.dir > 0 ? "ascending" : "descending") : "none", title: `Sort by ${label}` }, [label, on ? el("span", { class: "wl-sortar", "aria-hidden": "true" }, colSort.dir > 0 ? " \u25b2" : " \u25bc") : null]); b.addEventListener("click", () => setSort(k)); return b; };
    const head = el("div", { class: "wl-row wl-thead", role: "row" }, [hb("name", "Player", "wl-c-name"), ...heads.map((h, i) => hb(i, h, `wl-c${i === 0 ? " total" : ""}`))]);
    if (colSort.k != null) {
      const last = (c) => String(c.label || "").trim().split(/\s+/).slice(-1)[0] || "";
      const v = (c) => (c.empty ? null : c.sg?.[colSort.k]?.v ?? null);
      cards = [...cards].sort((a, b) => colSort.k === "name" ? colSort.dir * (last(a).localeCompare(last(b)) || String(a.label).localeCompare(String(b.label)))
        : (v(a) == null) - (v(b) == null) || colSort.dir * ((v(a) ?? 0) - (v(b) ?? 0)));
    }
    const rows = cards.map((c) => {
      // (update 558) the star: take them off the Watchlist
      const star = watchIsPreview() ? null : el("button", { type: "button", class: "wl-star on wl-row-star", "aria-label": `Remove ${c.label} from your Watchlist`, title: "Remove from Watchlist" }, "\u2605");
      star?.addEventListener("click", (e) => { e.stopPropagation(); saveWatch({ players: watchPrefs().players.filter((k) => k !== c.key) }); draw(); });
      star?.addEventListener("pointerdown", (e) => e.stopPropagation());
      // (update 561: the star beside the tour and rounds, so the name has the cell's full width)
      const nameCell = el("span", { class: "wl-c-name" }, [el("strong", {}, c.label), el("span", { class: "wl-c-nm" }, [star, el("small", {}, c.empty ? "No rounds" : `${c.tour ? `${c.tour} \u00b7 ` : ""}${c.rounds} rd${c.rounds === 1 ? "" : "s"}`)])]);
      const cells = c.empty ? heads.map((_, i) => el("span", { class: `wl-c${i === 0 ? " total" : ""}` }, "\u2014")) : c.sg.map((s, i) => el("span", { class: `wl-c${i === 0 ? " total" : ""}` }, [
        el("strong", { class: `wl-c-v ${sgCls(s.v)}` }, fmtSG(s.v)),
        el("span", { class: "wl-c-f" }, [rankPill(s.rank, s.of), trendEl(s.trend)]),
      ]));
      const r = el("div", { class: `wl-row${status.get(c.key) ? ` st-${status.get(c.key)}` : ""}`, role: "button", tabindex: "0", title: `${c.label}: open their card`, dataset: { key: c.key } }, [nameCell, ...cells]);
      const go = () => openCard(c, ctx);
      r.addEventListener("click", go);
      r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      return r;
    });
    return el("div", { class: "panel wl-table", role: "table" }, [head, ...rows]);
  }
  // (update 556) the player's card, in a pop-up: who and where, SG: Total big with its rank and trend, the alerts, each part
  // of the game, then the distances, metrics and clubs; Open stats and Remove at the bottom
  /* (update 561) one swing in detail: that part of the game, distance or lie only. Its numbers (last 12 against the 12
     before), what's inside it (a part of the game: its distances and lies), and each round's strokes gained there. */
  async function openFocus(x, kind, ctx) {
    const { renderBlocks } = await import("../badgePopup.js");
    const { distLead } = await import("../sg.js");
    const c = x.c, a = x.a, n = c.areas.n, dn = kind === "concern";
    const perShot = (sg, w) => (w ? sg / w : null), f3 = (v) => (v == null ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}`);
    const sumA = (xs) => xs.reduce((t, v) => t + v, 0);
    const stats = { kind: "table", title: `${areaName(a)}: the last ${n} ${c.areas.unit || "rounds"} against the ${n} before`, cols: [[""], [`Previous ${n}`, "num"], [`Last ${n}`, "num"], ["Change", "num"]], rows: [
      { strong: true, cells: ["SG a round", { sg: a.prev }, { sg: a.last }, { sg: a.ch, arrow: true }], pick: () => drawChart(a), picked: true },
      (() => { const w1 = a.wPrevR ?? a.wPrev / n, w2 = a.wLastR ?? a.wLast / n; return { cells: ["Shots a round", { text: w1.toFixed(1) }, { text: w2.toFixed(1) }, { text: `${w2 >= w1 ? "+" : "\u2212"}${Math.abs(w2 - w1).toFixed(1)}` }] }; })(), // (update 581: per round, events too)
      (() => { const p1 = a.ps1 !== undefined ? a.ps1 : perShot(sumA(a.sg.slice(0, n)), a.wPrev), p2 = a.ps2 !== undefined ? a.ps2 : perShot(sumA(a.sg.slice(n)), a.wLast); return { cells: ["SG a shot", { text: f3(p1) }, { text: f3(p2) }, p1 != null && p2 != null ? { text: `${p2 >= p1 ? "\u25B2" : "\u25BC"} ${Math.abs(p2 - p1).toFixed(3)}`, tone: p2 > p1 ? "pos" : p2 < p1 ? "neg" : "" } : { text: "\u2014" }] }; })(), // (update 562: its change too)
    ] };
    // inside a part of the game: its distances (in order) and lies, the one(s) behind the swing in bold
    let inside = [];
    if (!a.dist && !a.lie) {
      const kids = c.areas.list.filter((k) => k.cat === a.cat && (k.dist || k.lie) && k.wPrev + k.wLast >= 6);
      const tb = (title, list) => (list.length ? { kind: "table", title, cols: [[title.includes("istance") ? "Distance" : "Lie"], [`Previous ${n}`, "num"], [`Last ${n}`, "num"], ["Change", "num"]],
        rows: list.map((k) => ({ strong: dn ? k.ch <= -0.1 : k.ch >= 0.1, cells: [k.dist || k.lie, { sg: k.prev }, { sg: k.last }, { sg: k.ch, arrow: true }], pick: () => drawChart(k) })) } : null); // (update 562: a tap charts that one)
      inside = [tb("By distance (strokes gained a round)", kids.filter((k) => k.dist).sort((p, q) => distLead(p.dist) - distLead(q.dist))), tb("By lie (strokes gained a round)", kids.filter((k) => k.lie && a.cat === "ARG").sort((p, q) => String(p.lie).localeCompare(String(q.lie))))].filter(Boolean);
    }
    const rs = c.areas.rounds;
    // (update 562) the chart: the swing's area to start, or whichever distance or lie is tapped in the tables
    const chartT = el("p", { class: "wlh-sec" }), chartBox = el("div");
    function drawChart(z) {
      chartT.textContent = `${areaName(z)}: each ${c.areas.unit === "events" ? "event (a round there)" : "round"}, the ${n} before against the last ${n} (tap a row above to chart it)`;
      mount(chartBox, renderBlocks([{ kind: "bars", fmt: "sg", zero: true, items: rs.map((r, i) => ({ label: dateTxt(r.date), sub: [r.event, r.roundNo ? `R${r.roundNo}` : ""].filter(Boolean).join(" \u00b7 "), v: z.sg[i], on: i >= n })),
        ref: [{ v: z.prev, label: `Previous ${n}`, from: 0, to: n }, { v: z.last, label: `Last ${n}`, from: n, to: 2 * n }] }]));
    }
    drawChart(a);
    // (update 562) just played: that event on its own, against the rest of the last 12 and the 12 before
    const justPlayed = (() => {
      if (!x.fresh || !rs.length) return null;
      const byEvU = c.areas.unit === "events"; // (update 582: each unit is an event: no round counts)
      const lastR = rs.at(-1), yOf = (r) => String(r.date || "").slice(0, 4);
      let k0 = rs.length - 1; while (k0 > 0 && rs[k0 - 1].event === lastR.event && yOf(rs[k0 - 1]) === yOf(lastR)) k0--;
      const ev = a.sg.slice(k0), nE = ev.length; if (!nE || k0 < n) return null;
      const evAvg = sumA(ev) / nE, rest = a.sg.slice(n, k0), restAvg = rest.length ? sumA(rest) / rest.length : null;
      const better = evAvg - (restAvg ?? a.prev) > 0, evN = lastR.event || "The last event";
      const line = dn ? (better ? `Trending down over the last ${n}, but ${evN} came back up: ${fmtSG(evAvg)} a round there.` : `${evN} kept it going: ${fmtSG(evAvg)} a round there.`)
        : (better ? `${evN} kept it going: ${fmtSG(evAvg)} a round there.` : `Trending up over the last ${n}, but ${evN} slipped back: ${fmtSG(evAvg)} a round there.`);
      return el("div", { class: `wlh-jp ${better ? "up" : "down"}` }, [el("p", { class: "wlh-sec" }, byEvU ? `Just played \u00b7 ${evN} \u00b7 ${dateTxt(lastR.date)}` : `Just played \u00b7 ${evN} \u00b7 ${nE} round${nE === 1 ? "" : "s"} \u00b7 ${dateTxt(lastR.date)}`), el("p", { class: "wlh-jp-l" }, line),
        ...renderBlocks([{ kind: "table", cols: [[areaName(a)], ["SG a round", "num"]], rows: [
          { strong: true, cells: [byEvU ? evN : `${evN} (${nE} rd${nE === 1 ? "" : "s"})`, { sg: evAvg }] },
          ...(restAvg != null ? [{ cells: [`The rest of the last ${n} (${rest.length} ${byEvU ? (rest.length === 1 ? "event" : "events") : "rds"})`, { sg: restAvg }] }] : []),
          { cells: [`The ${n} before`, { sg: a.prev }] }] }])]);
    })();
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "✕");
    const cardB = el("button", { type: "button", class: "btn ghost" }, "Full card");
    const statsB = el("button", { type: "button", class: "btn" }, "Open stats");
    const overlay = el("div", { class: "gx-pop-overlay wlh-ov", role: "dialog", "aria-modal": "true", "aria-label": c.label }, el("div", { class: "gx-pop wlh-pop" }, [
      el("div", { class: "wlh-top" }, [el("div", {}, [el("p", { class: "gx-eyebrow" }, `${c.tour ? `${c.tour} · ` : ""}${c.rounds} rounds`), el("h2", {}, c.label)]), close]),
      el("div", { class: "wlh-body" }, [
        el("div", { class: `wlh-why wlb-${kind}` }, [el("strong", {}, `Trending ${dn ? "down" : "up"} in ${areaName(a)}`), el("span", {}, `${fmtSG(a.ch)} strokes a round: ${fmtSG(a.last)} over the last ${n} ${c.areas.unit || "rounds"} against ${fmtSG(a.prev)} over the ${n} before.`), x.fresh ? el("em", { class: "wlb-fresh" }, `Just played: ${c.latest.event || ""} ${fmtSG(c.latest.sg)}`) : null]),
        justPlayed,
        ...renderBlocks([stats, ...inside]),
        chartT, chartBox,
        el("div", { class: "wlh-acts" }, [cardB, statsB]),
      ]),
    ]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    close.addEventListener("click", shut);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    cardB.addEventListener("click", () => { shut(); openCard(c, ctx); });
    statsB.addEventListener("click", () => { shut(); openPlayer(c.key); });
    document.addEventListener("keydown", onKey);
    document.body.classList.add("gx-noscroll");
    document.body.appendChild(overlay);
    close.focus({ preventScroll: true });
  }
  function openCard(c0, ctx, bin = null) {
    const i = ctx.keys.indexOf(c0.key);
    const c = c0.lite ? playerCard(c0.key, { field: ctx.field, detail: ctx.detailFor(c0.key), own: ctx.owns[i], label: nameOf(c0.key), period: ctx.cur, metrics: metricsOf(c0.key), tour: tourPick.get(c0.key) ?? c0.tour ?? null, nameOf: anyName, noRanks: src() === "entered", lite: false }) : c0;
    openCards.add(c.key);
    const card = cardView(c);
    const close = el("button", { type: "button", class: "gx-pop-x", "aria-label": "Close" }, "\u2715");
    const t = c.sg?.[0];
    const top = el("div", { class: "wlh-top" }, [
      el("div", {}, [el("p", { class: "gx-eyebrow" }, [c.tour || "", c.rounds != null ? ` \u00b7 ${c.rounds} round${c.rounds === 1 ? "" : "s"}` : "", ` \u00b7 ${/^y:/.test(ctx.cur) ? periodLabel(ctx.cur) : periodLabel(ctx.cur)}`].join("").replace(/^ \u00b7 /, "")), el("h2", {}, c.label)]),
      close]);
    const big = t ? el("div", { class: "wlh-big" }, [el("strong", { class: `wlh-v ${sgCls(t.v)}` }, fmtSG(t.v)), el("span", { class: "wlh-u" }, "strokes gained a round"), el("span", { class: "wlh-f" }, [rankPill(t.rank, t.of), t.of ? el("span", { class: "muted small" }, ` of ${t.of}`) : null, trendEl(t.trend)])]) : null;
    const latest = c.latest ? el("p", { class: "wlh-meta muted small" }, `Last event: ${fmtSG(c.latest.sg)}${c.latest.rounds > 1 ? " a round" : ""}${c.latest.event ? ` at ${c.latest.event}` : ""}`) : null;
    const badges = card.querySelector(".wl-badges"), sg = card.querySelector(".wl-sg"), more = card.querySelector(".wl-more");
    sg?.firstElementChild?.remove(); // (Total is the big number)
    if (more) { more.hidden = false; more.querySelector(".wl-meta")?.remove(); }
    const openB = el("button", { type: "button", class: "btn" }, "Open stats"); // (update 557: the PDF report is on the Stats page)
    const rmB = el("button", { type: "button", class: "btn ghost" }, "Remove from Watchlist");
    const overlay = el("div", { class: "gx-pop-overlay wlh-ov", role: "dialog", "aria-modal": "true", "aria-label": c.label }, el("div", { class: "gx-pop wlh-pop" }, [
      top, el("div", { class: "wlh-body" }, [bin ? el("div", { class: `wlh-why wlb-${bin.kind}` }, [el("strong", {}, bin.title), el("span", {}, bin.why.join(" \u00b7 "))]) : null, big, latest, badges, sg, more, el("div", { class: "wlh-acts" }, [openB, watchIsPreview() ? null : rmB])]),
    ]));
    const shut = () => { overlay.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("gx-noscroll"); };
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".wl-pop")) shut(); };
    close.addEventListener("click", shut);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });
    openB.addEventListener("click", () => { shut(); openPlayer(c.key); });
    rmB.addEventListener("click", () => { shut(); saveWatch({ players: watchPrefs().players.filter((k) => k !== c.key) }); draw(); });
    document.addEventListener("keydown", onKey);
    document.body.classList.add("gx-noscroll");
    document.body.appendChild(overlay);
    close.focus({ preventScroll: true });
  }
  // the alerts first (biggest first), then the rest of the badges
  const sortBadges = (bs) => [...bs].sort((x, y) => (y.kind === "form") - (x.kind === "form") || (y.alert ? y.sev || 1 : 0) - (x.alert ? x.sev || 1 : 0)); // (update 372: current form first)
  function cardView(c) {
    const name = el("button", { type: "button", class: "wl-name", title: `Open ${c.label}'s stats` }, c.label);
    name.addEventListener("click", () => openPlayer(c.key));
    const star = multi ? el("button", { type: "button", class: "wl-star on", "aria-label": `Remove ${c.label} from your Watchlist`, title: "Remove from Watchlist" }, "★") : null;
    star?.addEventListener("click", () => { saveWatch({ players: watchPrefs().players.filter((k) => k !== c.key) }); draw(); });
    if (c.empty) return el("article", { class: "panel wl-card empty" }, [el("div", { class: "wl-card-head" }, [el("div", {}, [name, el("p", { class: "wl-meta" }, src() === "entered" ? "No entered rounds in this period." : "No rounds in this period.")]), star])]);
    const total = c.sg[0];
    const isOpen = openCards.has(c.key);
    // (update 171) more than one tour in this period: switch between them (ranked against that tour's field)
    // (update 186) a pill for their tour even when there's only one (more than one: switch between them)
    const tourSeg = c.tours?.length ? el("div", { class: "wl-tours", role: "group", "aria-label": `${c.label}'s tour` }, c.tours.map(({ tour: t, n }) => {
      const b = el("button", { type: "button", class: `wl-tour${t === c.tour ? " on" : ""}`, "aria-pressed": String(t === c.tour), title: `${n} round${n === 1 ? "" : "s"} on ${t}` }, t);
      b.addEventListener("click", () => { if (t === c.tour) return; tourPick.set(c.key, t); draw(); });
      return b;
    })) : null;
    const moreBtn = el("button", { type: "button", class: "wl-more-btn", "aria-expanded": String(isOpen), "aria-label": isOpen ? `Show less for ${c.label}` : `Show more for ${c.label}`, title: isOpen ? "Show less" : "Show more" }, el("span", { "aria-hidden": "true" }, "\u203a"));
    // (update 177) one player: no name row (the page says whose) and no folding (it's open), just a tour switch if any
    const head = multi ? el("div", { class: "wl-card-head" }, [
      el("div", { class: "wl-id" }, [name, tourSeg]),
      el("div", { class: "wl-head-r" }, [moreBtn, star]),
    ]) : tourSeg ? el("div", { class: "wl-card-head" }, [el("div", { class: "wl-id" }, [tourSeg])]) : null;
    const meta = el("p", { class: "wl-meta" }, [c.tours?.length ? "" : c.tour || "", `${c.rounds} round${c.rounds === 1 ? "" : "s"}`, c.latest ? `Last Event: ${fmtSG(c.latest.sg)}${c.latest.rounds > 1 ? " a round" : ""}${c.latest.event ? ` at ${c.latest.event}` : ""}, ${dateTxt(c.latest.date)}` : ""].filter(Boolean).join(" · "));
    // (update 173) a badge opens what's behind it: a chart, a table, or both
    const badges = el("div", { class: "wl-badges" }, sortBadges(c.badges).map((b) => {
      if (!b.info) return el("span", { class: `wl-badge ${b.tone || ""}`, ...(b.color ? { style: `background:${b.color};color:#0b0b0d;border-color:transparent` } : {}) }, [el("span", { "aria-hidden": "true" }, b.icon), b.text]);
      const btn = el("button", { type: "button", class: `wl-badge ${b.tone || ""}`, "aria-haspopup": "dialog", title: "See the details", ...(b.color ? { style: `background:${b.color};color:#0b0b0d;border-color:transparent` } : {}) }, [el("span", { "aria-hidden": "true" }, b.icon), b.text]);
      btn.addEventListener("click", async () => (await import("../badgePopup.js")).openBadge(b, c.label));
      return btn;
    })); // (update 223: always there, so the cards line up)
    // (update 182) tap a tile, a distance or a metric: its form
    const tappable = (node, title, info) => {
      if (!info) return node;
      node.classList.add("wl-tap"); node.setAttribute("role", "button"); node.setAttribute("tabindex", "0"); node.setAttribute("aria-haspopup", "dialog"); node.title = `${title}: form`;
      const go = async () => (await import("../badgePopup.js")).openBadge({ text: title, info }, c.label);
      node.addEventListener("click", go);
      node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      return node;
    };
    const sg = el("div", { class: "wl-sg" }, c.sg.map((s, i) => tappable(el("div", { class: `wl-tile${i === 0 ? " total" : ""}` }, [
      el("span", { class: "wl-tile-k" }, s.short),
      rel && s.v != null && s.avgO != null ? el("strong", { class: `wl-tile-v ${sgCls(s.v - s.avgO)}`, title: `${fmtSG(s.v)} a round; the rest average ${fmtSG(s.avgO)}` }, fmtSG(s.v - s.avgO)) : el("strong", { class: `wl-tile-v ${sgCls(s.v)}` }, fmtSG(s.v)),
      el("div", { class: "wl-tile-f" }, [rankPill(s.rank, s.of), trendEl(s.trend)]),
    ]), s.label, s.info)));
    // (update 223) 3 of each to start (by total strokes gained there); "+ N more" opens the rest. A trend under each rank.
    const distList = (title, all, tone) => {
      const k = `${c.key}|${tone}`, open = distOpen.has(k), xs = open ? all : all.slice(0, 3);
      const more = all.length > 3 ? el("button", { type: "button", class: "link wl-dist-more", "aria-expanded": String(open) }, open ? "\u25b4 Show 3" : `\u25be ${all.length - 3} more`) : null;
      more?.addEventListener("click", (e) => { e.stopPropagation(); open ? distOpen.delete(k) : distOpen.add(k); draw(); });
      return el("div", { class: `wl-dist ${tone}` }, [el("p", { class: "wl-col-t" }, title), xs.length ? el("ol", {}, xs.map((d) => tappable(el("li", {}, [
        el("span", { class: "wl-dist-l" }, [el("span", {}, d.label), el("span", { class: "wl-dist-n" }, `${d.n} shots`)]),
        (() => { const x = rel && d.avgO != null ? d.v - d.avgO : d.v; return el("span", { class: `wl-dist-v ${sgCls(x)}` }, `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(3)}`); })(),
        el("span", { class: "wl-dist-rk" }, [rankPill(d.rank, d.of), trendEl(d.trend, { fmt: (x) => Math.abs(x).toFixed(3), band: 0.005 })]),
      ]), d.label, d.info))) : el("p", { class: "muted small" }, tone === "best" ? "Nowhere gaining yet." : "Nowhere losing."), more]);
    };
    const dists = el("div", { class: "wl-two" }, [distList("Best distances", c.dists.best, "best"), distList("Toughest distances", c.dists.worst, "worst")]);
    const metrics = c.metrics.length ? el("div", { class: "wl-metrics" }, [el("p", { class: "wl-col-t" }, "Additional Metrics"), el("div", { class: "wl-mrows" }, c.metrics.map((m) => tappable(el("div", { class: "wl-mrow" }, [
      el("span", { class: "wl-m-l" }, m.label), rel && m.v != null && m.avgO != null ? (() => { const dd = m.v - m.avgO, good = m.higher == null || Math.abs(dd) < 1e-9 ? "" : (m.higher === false ? dd < 0 : dd > 0) ? "pos" : "neg"; return el("strong", { class: `wl-m-v ${good}`, title: `${m.text}; the rest average ${m.fmtCh(m.avgO)}` }, `${dd >= 0 ? "+" : "\u2212"}${m.fmtCh(dd)}`); })() : el("strong", { class: "wl-m-v" }, m.text), rankPill(m.rank, m.of) || el("span", { class: "wl-rank wl-rank-none", "aria-hidden": "true" }), trendEl(m.trend, { higher: m.higher, fmt: m.fmtCh, band: m.id.startsWith("dist:") || /^sg:sd@.*\|/.test(m.id) ? 0.005 : m.id.startsWith("stat:") ? Math.max(0.01, Math.abs(m.trend?.prev || 0) * 0.005) : 0.05 }),
    ]), m.label, m.info)))]) : null;
    // (update 211) club breakdowns: each model side by side (a model with under 10 rounds is marked)
    const clubs = (c.clubTables || []).map((t) => el("div", { class: "wl-clubs" }, [
      el("p", { class: "wl-col-t" }, `${t.title} \u00b7 ${t.what}`),
      t.cols.length ? el("div", { class: "wl-clubs-tw" }, el("table", { class: "wl-clubs-t" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), ...t.cols.map((x) => el("th", {}, [x.label, x.rounds < 10 ? el("span", { class: "wl-few", title: `Only ${x.rounds} rounds` }, " *") : null]))])),
        el("tbody", {}, [
          el("tr", {}, [el("td", {}, "SG a round"), ...t.cols.map((x) => el("td", { class: `num ${sgCls(x.v)}` }, fmtSG(x.v)))]),
          el("tr", { class: "muted" }, [el("td", {}, "Rounds"), ...t.cols.map((x) => el("td", { class: "num" }, String(x.rounds)))]),
        ]),
      ])) : el("p", { class: "muted small" }, "Not used in this period."),
      t.cols.some((x) => x.rounds < 10) ? el("p", { class: "muted small wl-few-note" }, "* Fewer than 10 rounds: read with care.") : null,
    ]));
    const more = el("div", { class: "wl-more", hidden: !isOpen }, [meta, dists, metrics, ...clubs]);
    const card = el("article", { class: `panel wl-card${isOpen ? " open" : ""}${multi && !isOpen ? " compact" : ""}` }, [head, badges, sg, more]); // (update 317: folded = compact: the name, then each category and its rank) // (update 226: every card the same, no glow for some)
    moreBtn.addEventListener("click", () => {
      if (c.lite) { openCards.add(c.key); draw(); return; } // (update 329: a folded card works out the rest now)
      const open = !openCards.has(c.key);
      if (open) openCards.add(c.key); else openCards.delete(c.key);
      more.hidden = !open; card.classList.toggle("open", open); card.classList.toggle("compact", multi && !open); // (update 318: open: everything back)
      moreBtn.setAttribute("aria-expanded", String(open)); moreBtn.title = open ? "Show less" : "Show more";
      moreBtn.setAttribute("aria-label", `${open ? "Show less" : "Show more"} for ${c.label}`);
    });
    return card;
  }

  await draw();
  return () => {};
}
