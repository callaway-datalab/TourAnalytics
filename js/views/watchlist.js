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
import { playerCard, metricCatalog, metricLabel, PERIODS, ordinal } from "../watchlistData.js";
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
  let detail = null;
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
    const d = detail?.find((p) => p.key === key);
    if (d) { ownCache.set(key, d.rounds); return d.rounds; }
    let rows = [];
    try {
      if (admin) rows = await store.getDatasetRowsListed(key, ds.id);
      else { const meta = await store.getDatasetMeta(key, ds.id); rows = await store.getDatasetRows(key, ds.id, meta.chunkCount); }
    } catch { rows = []; }
    const r = rows.length ? prepare(rows, idx) : null;
    ownCache.set(key, r);
    return r;
  }
  // (update 312) the field's detail (loaded up front, while the app opens): waited for here, so each player's rounds
  // come from it rather than being fetched one by one
  if (ds) {
    try { const res = await (await import("../fieldStore.js")).getFieldDetail(ds.id, ds.uploadedAt?.toMillis?.() ?? 0); if (res?.players?.length) detail = res.players; } catch { /* the rows, one by one */ }
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
  await loadWatch();
  let prefs = watchPrefs();
  const picker = multi ? playerPicker(labels, (p) => { if (!p) return; if (!prefs.players.includes(p.key)) { prefs = { ...prefs, players: [...prefs.players, p.key] }; saveWatch({ players: prefs.players }); draw(); } setTimeout(() => { const i = pickerBox.querySelector("input"); if (i) i.value = ""; }, 0); }) : null;
  const pickerBox = el("div", { class: "wl-add" }, picker ? [picker.node] : []);
  let menuOpen = false;
  // (update 180) metrics for everyone, or a player's own (watchlists.metricsFor[key]: theirs instead of everyone's)
  let menuFor = "all";
  const metricsOf = (k) => (Array.isArray(prefs.metricsFor?.[k]) ? prefs.metricsFor[k] : prefs.metrics);
  const listFor = (who) => (who === "all" ? prefs.metrics : metricsOf(who));
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
    const cur = PERIODS.some(([v]) => v === prefs.period) ? prefs.period : "season";
    const cards0 = keys.map((k, i) => playerCard(k, { field: fieldNow, detail: detailNow, own: owns[i], label: nameOf(k), period: cur, metrics: metricsOf(k), tour: tourPick.get(k) ?? null, nameOf: anyName, noRanks: source === "entered",
      lite: multi && !openCards.has(k) })); // (update 329: folded cards: just their ranks; the rest when opened)
    // (update 319) the order: yours (drag to change), A–Z, or by SG: Total rank (best first)
    let sortBy = "mine"; try { sortBy = localStorage.getItem("wl.sort") || "mine"; } catch { /* */ }
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
    const period = el("div", { class: "wl-period", role: "group", "aria-label": "Period" }, PERIODS.map(([v, l]) => {
      const b = el("button", { type: "button", class: `wl-per${cur === v ? " on" : ""}`, "aria-pressed": String(cur === v) }, l);
      b.addEventListener("click", () => { saveWatch({ period: v }); draw(); });
      return b;
    }));
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
    const controls = el("div", { class: "wl-controls" }, [sourceSeg, period, sortSeg, metricsBtn, meBtn, multi ? pickerBox : null]);
    const where = source === "entered" ? "entered rounds" : "ranked on their tour";
    // (update 186) just how many players
    const sub = multi ? (keys.length ? `${keys.length} Player${keys.length === 1 ? "" : "s"}` : "Follow the players you care about")
      : `${nameOf(single)} · ${PERIODS.find(([v]) => v === cur)[1].toLowerCase()} · ${source === "entered" ? "entered rounds" : "ranked on the tour"}`;
    // (update 168) previewing someone: their own Watchlist, and changes aren't kept
    const subLine = multi && watchIsPreview() ? `${sub} · their Watchlist (changes in a preview aren't saved)` : sub;

    // ---- the cards ----
    const body = multi && !keys.length ? emptyState() : el("div", { class: `wl-cards${multi ? "" : " solo"}` }, cards.map((c) => { const n = cardView(c); n.dataset.key = c.key; return n; }));
    if (multi && keys.length > 1 && !watchIsPreview() && sortBy === "mine") dragToReorder(body); // (update 249; 319: only in your own order)
    // (update 169) redrawing (ticking a metric, the period) keeps your place on the page
    const y = y0, keepFocus = document.activeElement?.closest?.(".wl-menu-o")?.textContent || null, keepChip = document.activeElement?.closest?.(".wl-range")?.dataset.id || null;
    const dragHint = multi && keys.length > 1 && !watchIsPreview() && sortBy === "mine" ? el("p", { class: "muted small center wl-drag-hint" }, "Hold a card and drag it to change the order.") : null; // (update 249)
    mount(root, [heroShell(controls, subLine), menu, body, dragHint,
      el("div", { class: "center wl-foot" }, infoTip(source === "entered"
        ? `Strokes Gained values represent per round averages. Trends: the last 10 rounds against the 10 before; with fewer than 20 rounds, the latest half against the half before (at least 3 each, so 6 rounds or more).${rel ? " Relative to Avg: each value less the average of everyone else on that tour in this period." : ""}`
        : `Strokes Gained values represent per round averages. Trends: the last 10 rounds against the 10 before; with fewer than 20 rounds, the latest half against the half before (at least 3 each, so 6 rounds or more).${rel ? " Relative to Avg: each value less the average of everyone else on that tour in this period." : ""} Ranks: among players with ${cards[0]?.minR || "enough"} or more rounds on the tour shown, in this period. A player on more than one tour has a switch on their card${detail ? "" : ". Distance ranks appear once the field's lie and distance detail has been published"}.`))]);
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
  const rankPill = (r, of) => (src() === "entered" ? null : r ? el("span", { class: `wl-rank ${rkCls(r)}`, title: `${ordinal(r)} of ${of}` }, ordinal(r)) : el("span", { class: "wl-rank none" }, "—"));

  /* (update 249) hold a card, then drag it: the order is saved (this week's guys at the top). A hold (a third of a
     second without moving) starts it, so taps, clicks and scrolling work as before. */
  function dragToReorder(box) {
    let hold = null, drag = null;
    const cardsNow = () => [...box.querySelectorAll(":scope > .wl-card")];
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
      const card = e.target.closest(".wl-card");
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
      if (!b.info) return el("span", { class: `wl-badge ${b.tone || ""}` }, [el("span", { "aria-hidden": "true" }, b.icon), b.text]);
      const btn = el("button", { type: "button", class: `wl-badge ${b.tone || ""}`, "aria-haspopup": "dialog", title: "See the details" }, [el("span", { "aria-hidden": "true" }, b.icon), b.text]);
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
      el("span", { class: "wl-m-l" }, m.label), rel && m.v != null && m.avgO != null ? (() => { const dd = m.v - m.avgO, good = m.higher == null || Math.abs(dd) < 1e-9 ? "" : (m.higher === false ? dd < 0 : dd > 0) ? "pos" : "neg"; return el("strong", { class: `wl-m-v ${good}`, title: `${m.text}; the rest average ${m.fmtCh(m.avgO)}` }, `${dd >= 0 ? "+" : "\u2212"}${m.fmtCh(dd)}`); })() : el("strong", { class: "wl-m-v" }, m.text), rankPill(m.rank, m.of), trendEl(m.trend, { higher: m.higher, fmt: m.fmtCh, band: m.id.startsWith("dist:") || /^sg:sd@.*\|/.test(m.id) ? 0.005 : m.id.startsWith("stat:") ? Math.max(0.01, Math.abs(m.trend?.prev || 0) * 0.005) : 0.05 }),
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
