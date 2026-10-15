/*
 * Watchlist (update 164): the players you follow, at a glance. Everyone with more than one player has it (the admin,
 * analysts, coaches with several players); a player (or one player's coach) gets the same page as "Home", for just
 * that player, without the adding and removing.
 *   Each player: strokes gained a round (Total, OTT, APP, ARG, PUTT) with ranks and how it's trending (last 10 rounds
 *   against the 10 before), their 3 best and 3 worst distances, any extra metrics you pick, and badges for big moves,
 *   hot streaks and slumps, form landmarks, best rounds, wins and milestones. The alerts sit at the top.
 */
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { detectColumns, isShotData, prepare, summaryPlayers, fmtSG } from "../sg.js";
import { playerCard, metricCatalog, metricLabel, PERIODS, ordinal } from "../watchlistData.js";
import { watchPrefs, loadWatch, saveWatch } from "../watchlist.js";
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
  const loadingNote = el("p", { class: "muted center wl-loading" }, "Loading…");
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
  if (!ds) { mount(root, [heroShell(), el("section", { class: "panel" }, el("p", { class: "empty center" }, "No stats yet. They show here as soon as a stats file is uploaded."))]); return () => {}; }
  const idx = detectColumns(ds.columns || []);
  const summary = await store.getFieldStats(ds.id).catch(() => null);
  let field = summaryPlayers(summary).filter((p) => p.rounds.length);
  let detail = null;
  const ownCache = new Map(); // key → full rounds (lie / distance)
  async function ownRounds(key) {
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
  import("../fieldStore.js").then(({ getFieldDetail }) => getFieldDetail(ds.id, ds.uploadedAt?.toMillis?.() ?? 0)).then((res) => {
    if (res?.players?.length) { detail = res.players; draw(); }
  }).catch(() => {});

  await loadWatch();
  let prefs = watchPrefs();
  const picker = multi ? playerPicker(labels, (p) => { if (!p) return; if (!prefs.players.includes(p.key)) { prefs = { ...prefs, players: [...prefs.players, p.key] }; saveWatch({ players: prefs.players }); draw(); } setTimeout(() => { const i = pickerBox.querySelector("input"); if (i) i.value = ""; }, 0); }) : null;
  const pickerBox = el("div", { class: "wl-add" }, picker ? [picker.node] : []);
  let menuOpen = false;

  function heroShell(controls = null, sub = "") {
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    return el("header", { class: "panel wl-hero" }, [
      el("div", { class: "wl-hero-l" }, [el("p", { class: "wl-eyebrow" }, today), el("h1", {}, multi ? "Watchlist" : "Home"), sub ? el("p", { class: "wl-sub" }, sub) : null]),
      controls,
    ]);
  }

  async function draw() {
    prefs = watchPrefs();
    const keys = multi ? prefs.players.filter((k) => labels.has(k) || field.some((p) => p.key === k)) : [single];
    const owns = await Promise.all(keys.map((k) => ownRounds(k)));
    const cards = keys.map((k, i) => playerCard(k, { field, detail, own: owns[i], label: nameOf(k), period: prefs.period, metrics: prefs.metrics }));
    const catalog = metricCatalog(field, owns.filter(Boolean).map((rounds) => ({ rounds })));

    // ---- controls ----
    const period = el("div", { class: "seg seg-sm wl-period", role: "group", "aria-label": "Period" }, PERIODS.map(([v, l]) => {
      const b = el("button", { type: "button", class: `seg-btn${prefs.period === v ? " on" : ""}`, "aria-pressed": String(prefs.period === v) }, l);
      b.addEventListener("click", () => { saveWatch({ period: v }); draw(); });
      return b;
    }));
    const metricsBtn = el("button", { type: "button", class: "btn ghost wl-metrics-btn", "aria-expanded": String(menuOpen) }, ["＋ Metrics", prefs.metrics.length ? el("span", { class: "wl-count" }, String(prefs.metrics.length)) : null]);
    metricsBtn.addEventListener("click", () => { menuOpen = !menuOpen; draw(); });
    const menu = menuOpen ? el("div", { class: "panel wl-menu", role: "group", "aria-label": "Metrics" }, [
      el("div", { class: "wl-menu-top" }, [el("strong", {}, "Metrics on every card"), (() => { const b = el("button", { type: "button", class: "link" }, "Done"); b.addEventListener("click", () => { menuOpen = false; draw(); }); return b; })()]),
      el("div", { class: "wl-menu-groups" }, catalog.map((g) => el("div", { class: "wl-menu-g" }, [el("p", { class: "wl-menu-gt" }, g.group), ...g.items.map(([id, l]) => {
        const cb = el("input", { type: "checkbox", checked: prefs.metrics.includes(id) });
        cb.addEventListener("change", () => { const m = cb.checked ? [...prefs.metrics, id] : prefs.metrics.filter((x) => x !== id); saveWatch({ metrics: m }); draw(); });
        return el("label", { class: "wl-menu-o" }, [cb, el("span", {}, l)]);
      })]))),
    ]) : null;
    const controls = el("div", { class: "wl-controls" }, [period, metricsBtn, multi ? pickerBox : null]);
    const sub = multi ? `${keys.length ? `${keys.length} player${keys.length === 1 ? "" : "s"}` : "Follow the players you care about"} · ${PERIODS.find(([v]) => v === prefs.period)[1].toLowerCase()} · ranked on their tour`
      : `${nameOf(single)} · ${PERIODS.find(([v]) => v === prefs.period)[1].toLowerCase()} · ranked on the tour`;

    // ---- alerts: the biggest first ----
    const alerts = cards.flatMap((c) => c.alerts || []).sort((a, b) => b.sev - a.sev).slice(0, 12);
    const alertsBox = alerts.length ? el("section", { class: "wl-alerts", "aria-label": "Alerts" }, [
      el("div", { class: "wl-sec-h" }, [el("h2", {}, "Alerts"), el("span", { class: "muted small" }, multi ? "Big moves, streaks, landmarks and milestones" : "What's moving in your game")]),
      el("div", { class: "wl-alert-row" }, alerts.map((a) => el("button", { type: "button", class: `wl-alert ${a.tone || ""}`, title: `Open ${a.label}` }, [
        el("span", { class: "wl-alert-i", "aria-hidden": "true" }, a.icon), el("span", { class: "wl-alert-t" }, [multi ? el("strong", {}, a.label) : null, el("span", {}, a.text)]),
      ]))),
    ]) : null;
    alertsBox?.querySelectorAll(".wl-alert").forEach((b, i) => b.addEventListener("click", () => openPlayer(alerts[i].key)));

    // ---- the cards ----
    const body = multi && !keys.length ? emptyState() : el("div", { class: `wl-cards${multi ? "" : " solo"}` }, cards.map(cardView));
    mount(root, [heroShell(controls, sub), menu, alertsBox, body,
      el("p", { class: "muted small center wl-foot" }, `Trends: the last 10 rounds against the 10 before. Ranks: among players with ${cards[0]?.minR || "enough"} or more rounds on the same tour in this period${detail ? "" : "; distance ranks appear once the field's lie and distance detail has been published"}.`)]);
  }

  function emptyState() {
    // suggestions: your players (a coach), else this season's leaders
    const sugg = team.isTeam ? teamKeys : [...field].map((p) => ({ k: p.key, v: p.rounds.length >= 10 ? p.rounds.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + s.sg, 0), 0) / p.rounds.length : -99 })).sort((a, b) => b.v - a.v).slice(0, 8).map((x) => x.k);
    return el("section", { class: "panel wl-empty" }, [
      el("div", { class: "wl-empty-star", "aria-hidden": "true" }, "★"),
      el("h2", {}, "Build your Watchlist"),
      el("p", { class: "muted" }, "Add the players you follow: their strokes gained, ranks, trends and alerts all land here, and they sit at the top of every player search."),
      el("div", { class: "wl-sugg" }, sugg.filter((k) => labels.has(k) || field.some((p) => p.key === k)).map((k) => {
        const b = el("button", { type: "button", class: "wl-chip" }, ["＋ ", nameOf(k)]);
        b.addEventListener("click", () => { saveWatch({ players: [...watchPrefs().players, k] }); draw(); });
        return b;
      })),
    ]);
  }

  function openPlayer(key) {
    if (admin) location.hash = `#/admin/player-stats?player=${encodeURIComponent(key)}`;
    else if (team.isTeam) location.hash = `#/view-as/${encodeURIComponent(key)}?label=${encodeURIComponent(nameOf(key))}&to=/dashboard`;
    else location.hash = "#/dashboard";
  }

  function spark(vals) {
    const v = vals.filter((x) => x != null);
    if (v.length < 3) return null;
    const W = 120, H = 34, lo = Math.min(-0.5, ...v), hi = Math.max(0.5, ...v);
    const X = (i) => (i / (v.length - 1)) * W, Y = (x) => H - 3 - ((x - lo) / (hi - lo)) * (H - 6);
    const NS = "http://www.w3.org/2000/svg", s = (t, a) => { const n = document.createElementNS(NS, t); for (const [k, x] of Object.entries(a)) n.setAttribute(k, String(x)); return n; };
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "wl-spark", role: "img", "aria-label": "Rolling 10-round strokes gained" });
    const path = v.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(x).toFixed(1)}`).join(" ");
    const grad = s("linearGradient", { id: `wlg${Math.random().toString(36).slice(2, 7)}`, x1: 0, x2: 0, y1: 0, y2: 1 });
    grad.append(s("stop", { offset: "0%", "stop-color": "#d4b483", "stop-opacity": 0.35 }), s("stop", { offset: "100%", "stop-color": "#d4b483", "stop-opacity": 0 }));
    const defs = s("defs", {}); defs.appendChild(grad); svg.appendChild(defs);
    svg.appendChild(s("line", { x1: 0, x2: W, y1: Y(0), y2: Y(0), stroke: "rgba(255,255,255,0.18)", "stroke-width": 0.8, "stroke-dasharray": "2 2" }));
    svg.appendChild(s("path", { d: `${path} L${W} ${H} L0 ${H} Z`, fill: `url(#${grad.id})` }));
    svg.appendChild(s("path", { d: path, fill: "none", stroke: "#d4b483", "stroke-width": 1.6, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    svg.appendChild(s("circle", { cx: X(v.length - 1), cy: Y(v.at(-1)), r: 2.4, fill: v.at(-1) >= 0 ? "#30d158" : "#ff453a" }));
    return svg;
  }
  const trendEl = (t, { higher = true, fmt = (x) => Math.abs(x).toFixed(2), band = 0.05 } = {}) => {
    if (!t) return el("span", { class: "wl-tr muted" }, "—");
    const flat = Math.abs(t.ch) < band;
    const good = higher == null ? null : higher ? t.ch > 0 : t.ch < 0;
    return el("span", { class: `wl-tr ${flat ? "flat" : good == null ? "" : good ? "up" : "down"}`, title: `Last ${t.n}: ${t.last?.toFixed?.(2)} · previous ${t.n}: ${t.prev?.toFixed?.(2)}` }, flat ? "◆ steady" : `${t.ch > 0 ? "▲" : "▼"} ${fmt(t.ch)}`);
  };
  const rankPill = (r, of) => (r ? el("span", { class: `wl-rank ${rkCls(r)}`, title: `${ordinal(r)} of ${of}` }, ordinal(r)) : el("span", { class: "wl-rank none" }, "—"));

  function cardView(c) {
    const name = el("button", { type: "button", class: "wl-name", title: `Open ${c.label}'s stats` }, c.label);
    name.addEventListener("click", () => openPlayer(c.key));
    const star = multi ? el("button", { type: "button", class: "wl-star on", "aria-label": `Remove ${c.label} from your Watchlist`, title: "Remove from Watchlist" }, "★") : null;
    star?.addEventListener("click", () => { saveWatch({ players: watchPrefs().players.filter((k) => k !== c.key) }); draw(); });
    if (c.empty) return el("article", { class: "panel wl-card empty" }, [el("div", { class: "wl-card-head" }, [el("div", {}, [name, el("p", { class: "wl-meta" }, "No rounds in this period.")]), star])]);
    const total = c.sg[0];
    const head = el("div", { class: "wl-card-head" }, [
      el("div", { class: "wl-id" }, [name, el("p", { class: "wl-meta" }, [c.tour || "", `${c.rounds} round${c.rounds === 1 ? "" : "s"}`, c.latest ? `last: ${fmtSG(c.latest.sg)} at ${c.latest.event || "a tournament"}, ${dateTxt(c.latest.date)}` : ""].filter(Boolean).join(" · "))]),
      el("div", { class: "wl-head-r" }, [el("div", { class: "wl-spark-box" }, [spark(c.spark), el("span", { class: "wl-spark-l" }, "10-round form")]), star]),
    ]);
    const badges = c.badges.length ? el("div", { class: "wl-badges" }, c.badges.slice(0, 6).map((b) => el("span", { class: `wl-badge ${b.tone || ""}` }, [el("span", { "aria-hidden": "true" }, b.icon), b.text]))) : null;
    const sg = el("div", { class: "wl-sg" }, c.sg.map((s, i) => el("div", { class: `wl-tile${i === 0 ? " total" : ""}` }, [
      el("span", { class: "wl-tile-k" }, s.short),
      el("strong", { class: `wl-tile-v ${sgCls(s.v)}` }, fmtSG(s.v)),
      el("div", { class: "wl-tile-f" }, [rankPill(s.rank, s.of), trendEl(s.trend)]),
    ])));
    const distList = (title, xs, tone) => el("div", { class: `wl-dist ${tone}` }, [el("p", { class: "wl-col-t" }, title), xs.length ? el("ol", {}, xs.map((d) => el("li", {}, [
      el("span", { class: "wl-dist-l" }, [el("span", {}, d.label), el("span", { class: "wl-dist-n" }, `${d.n} shots`)]),
      el("span", { class: `wl-dist-v ${sgCls(d.v)}` }, `${d.v >= 0 ? "+" : "−"}${Math.abs(d.v).toFixed(3)}`), rankPill(d.rank, d.of),
    ]))) : el("p", { class: "muted small" }, "Not enough shots yet.")]);
    const dists = el("div", { class: "wl-two" }, [distList("Best distances", c.dists.best, "best"), distList("Toughest distances", c.dists.worst, "worst")]);
    const metrics = c.metrics.length ? el("div", { class: "wl-metrics" }, [el("p", { class: "wl-col-t" }, "Your metrics"), el("div", { class: "wl-mrows" }, c.metrics.map((m) => el("div", { class: "wl-mrow" }, [
      el("span", { class: "wl-m-l" }, m.label), el("strong", { class: "wl-m-v" }, m.text), rankPill(m.rank, m.of), trendEl(m.trend, { higher: m.higher, fmt: m.fmtCh, band: m.id.startsWith("dist:") ? 0.005 : m.id.startsWith("stat:") ? Math.max(0.01, Math.abs(m.trend?.prev || 0) * 0.005) : 0.05 }),
    ])))]) : null;
    return el("article", { class: `panel wl-card${total.rank && total.rank <= 10 ? " elite" : ""}` }, [head, badges, sg, dists, metrics]);
  }

  await draw();
  return () => {};
}
