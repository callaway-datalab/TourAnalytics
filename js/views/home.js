// (update 726) Home: questions. A greeting, one line to ask Cal, "Suggested for you" (questions picked from the player's own
// numbers: the part of the game costing the most, what's slipped lately, a club they keep switching, the next tournament,
// another season to compare), then tabs of example questions covering everything the site does. A question asks one
// follow-up when it needs one (which player, over what stretch, which course …), then opens the page already set up for
// it, with a one-time pop-up on how Cal answers it (askExplain.js). Players see "my"; coaches and analysts their players;
// the admin any player, and the tour.
import { el, mount, calAllowed, holdToTalk } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { detectColumns, isShotData, summaryPlayers, gearInfo } from "../sg.js";
import { queueExplain } from "../askExplain.js";

const HINTS = new Map(); // (each player's product question, worked out once a visit to the site)
const once = (watch) => new Promise((res) => { let un = null, done = false; const fin = (v) => { if (done) return; done = true; res(v); setTimeout(() => un?.(), 0); }; try { un = watch(fin); } catch { fin(null); } });
const CAT_IN = { OTT: "off the tee", APP: "on approach shots", ARG: "around the green", PUTT: "on the greens" };
const CAT_PLAY = { OTT: "driving", APP: "approach play", ARG: "short game", PUTT: "putting" };
const KIND_PILL = { Driver: "Driver", "Non-Driver": "Non-Driver", "Fairway Wood": "Non-Driver", Hybrid: "Non-Driver", Iron: "Irons", Wedge: "Wedges", Putter: "Putters", Ball: "Balls" };
const KIND_WORD = { Driver: "driver", "Non-Driver": "fairway wood or hybrid", Irons: "set of irons", Wedges: "wedge", Putters: "putter", Balls: "ball" };

export async function render(main, { previewClient } = {}) {
  const state = getState(), team = effectiveTeam(state);
  const admin = state.isAdmin && !team.preview && !previewClient;
  const teamKeys = team.isTeam ? Object.keys(team.teamAccess) : [];
  const selfKey = !admin && !team.isTeam ? previewClient?.key || state.profile?.clientKey || null : null;
  const staff = !selfKey, analyst = state.profile?.kind === "analyst";
  const store = await import("../store.js");
  const root = el("div", { class: "ah" });
  mount(main, root);

  // ---- who's who ----
  let labels = new Map();
  if (team.isTeam) labels = teamLabels(team.teamAccess);
  const myName = plainName(previewClient?.label || state.profile?.name || state.user?.displayName || "");
  if (selfKey) labels = new Map([[selfKey, myName || "You"]]);
  const nameOf = (k) => plainName(labels.get(k) || String(k || "").replace(/^c_/, ""));
  const firstOf = (k) => String(nameOf(k)).split(" ")[0] || "them";
  let focus = selfKey || (teamKeys.length === 1 ? teamKeys[0] : null);
  const isMe = (k) => !!selfKey && k === selfKey;
  const W = (k) => (isMe(k) ? { I: "I", my: "my", me: "me", am: "am I", do: "do I", have: "have I", s: "" } : { I: firstOf(k), my: `${firstOf(k)}’s`, me: firstOf(k), am: `is ${firstOf(k)}`, do: `does ${firstOf(k)}`, have: `has ${firstOf(k)}`, s: "s" });

  // ---- where a question goes ----
  const statsHref = (k) => (isMe(k) || (!admin && !team.isTeam) ? "#/dashboard" : admin ? `#/admin/player-stats?player=${encodeURIComponent(k)}` : `#/view-as/${encodeURIComponent(k)}?label=${encodeURIComponent(nameOf(k))}&to=/dashboard`);
  const pageHref = (k, page) => (isMe(k) || !team.isTeam ? `#${page}` : `#/view-as/${encodeURIComponent(k)}?label=${encodeURIComponent(nameOf(k))}&to=${page}`);
  const toStats = (k, st, scroll, ex) => { try { sessionStorage.setItem("ta.statsPreset", JSON.stringify({ at: Date.now(), st, scroll })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = statsHref(k); };
  const toHole = (heat, hole, ex) => { try { sessionStorage.setItem("cal.open", JSON.stringify({ heat, hole, pin: null })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = `#/course-prep?cal=${Date.now()}`; };
  const go = (href, ex) => { if (ex) queueExplain(ex); location.hash = href; };

  // ---- the data (filled in as it arrives) ----
  let field = [], years = [], heat = null, next = null;
  const heatP = import("../courseHeat.js").then((m) => m.listHeatCourses()).then((l) => (heat = (l || []).filter((c) => c.par?.length))).catch(() => (heat = []));
  const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  const roundsOf = (k) => (field.find((p) => p.key === k)?.rounds || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const yearsOf = (k) => [...new Set(roundsOf(k).map(yrOf).filter((y) => /^\d{4}$/.test(y)))].sort();

  // ---- the follow-up sheet: one question, a few answers ----
  function sheet({ q, title, sub = "", options, search = false }) {
    return new Promise((done) => {
      let pick = options.find((o) => o.on)?.value ?? options[0]?.value ?? null;
      const list = el("div", { class: "ah-opts" }), go2 = el("button", { type: "button", class: "btn ah-go" }, "Show me ›");
      const qIn = search ? el("input", { type: "search", class: "ah-search", placeholder: "Search players…", "aria-label": "Search" }) : null;
      const draw = () => { const t = qIn?.value.trim().toLowerCase() || "";
        mount(list, options.filter((o) => !t || String(o.label).toLowerCase().includes(t)).slice(0, search ? 40 : 99).map((o) => { const b = el("button", { type: "button", class: `ah-opt${o.value === pick ? " on" : ""}` }, [el("span", {}, [o.label, o.note ? el("small", {}, ` · ${o.note}`) : null]), el("i", { class: "ah-r" })]);
          b.addEventListener("click", () => { pick = o.value; draw(); if (search) { close(); done(pick); } }); return b; })); };
      qIn?.addEventListener("input", draw);
      const back = el("div", { class: "ah-back" }), box = el("section", { class: "ah-sheet", role: "dialog", "aria-modal": "true", "aria-label": title }, [el("div", { class: "ah-grab" }), el("p", { class: "ah-sq" }, q), el("h2", { class: "ah-sh" }, title), sub ? el("p", { class: "ah-sub" }, sub) : null, qIn, list, search ? null : go2]);
      const wrap = el("div", { class: "ah-sheet-wrap" }, [back, box]);
      const close = () => wrap.remove();
      back.addEventListener("click", () => { close(); done(null); });
      go2.addEventListener("click", () => { close(); done(pick); });
      document.body.appendChild(wrap); draw(); if (qIn) setTimeout(() => qIn.focus(), 50);
    });
  }
  // which player (coaches with several players, analysts, the admin)
  let allPlayers = null;
  const playersList = async () => { if (allPlayers) return allPlayers; if (admin) { try { const l = (await store.adminAllClients()).labels; for (const [k, v] of l) labels.set(k, v); allPlayers = [...l.keys()]; } catch { allPlayers = []; } } else allPlayers = teamKeys; return allPlayers; };
  const askPlayer = async (q) => { if (selfKey) return selfKey; if (teamKeys.length === 1) return teamKeys[0];
    const ks = await playersList(); const opts = ks.map((k) => ({ value: k, label: nameOf(k) })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    if (focus) { const i = opts.findIndex((o) => o.value === focus); if (i > 0) opts.unshift(...opts.splice(i, 1)); }
    return sheet({ q, title: "Which player?", options: opts, search: true }); };
  const askPeriod = (q, k) => { const ys = yearsOf(k), last = ys.at(-1), prev = ys.at(-2);
    return sheet({ q, title: "Over what stretch?", sub: "Cal compares those rounds with the tour average, shot by shot.", options: [
      ...(last ? [{ value: { year: [last], span: 0 }, label: `${last} season`, note: `${roundsOf(k).filter((r) => yrOf(r) === last).length} rounds`, on: true }] : []),
      { value: { year: [], span: "12" }, label: "Last 12 months" },
      ...(prev ? [{ value: { year: [prev], span: 0 }, label: `${prev} season`, note: `${roundsOf(k).filter((r) => yrOf(r) === prev).length} rounds` }] : []),
      { value: { year: [], span: 0 }, label: "Every round" }] }); };
  const askCourse = async (q) => { await heatP; if (!heat?.length) { alert("No courses with strategy maps yet."); return null; }
    const opts = heat.map((c) => ({ value: c.id, label: c.name, note: (c.events || []).map((e) => e.name).slice(0, 1).join("") })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    if (next?.heat) { const i = opts.findIndex((o) => o.value === next.heat); if (i >= 0) { opts[i].on = true; opts[i].note = `this week: ${next.name}`; opts.unshift(...opts.splice(i, 1)); } }
    return sheet({ q, title: "Which course?", options: opts, search: opts.length > 12 }); };
  const askHole = async (q, heatId) => { const c = heat?.find((x) => x.id === heatId); const n = c?.par?.length || 18;
    return sheet({ q, title: "Which hole?", options: Array.from({ length: n }, (_, i) => ({ value: i + 1, label: `Hole ${i + 1}`, note: c?.par?.[i] ? `par ${c.par[i]}${c.yards?.[i] ? ` · ${c.yards[i]} yds` : ""}` : "" })) }); };
  const askKind = (q) => sheet({ q, title: "Which club?", options: ["Driver", "Non-Driver", "Irons", "Wedges", "Putters", "Balls"].map((k, i) => ({ value: k, label: k === "Non-Driver" ? "Fairway woods & hybrids" : k, on: !i })) });

  // ---- how Cal answers each kind of question (the pop-up on the page it opens) ----
  const EX = {
    lost: (q) => ({ id: "lost", q, steps: ["Every shot is scored against what a typical tour player does from the same spot (strokes gained).", "Shots are grouped by part of the game and distance (chips inside 30 yds, putts inside 5 ft…).", "Each group’s strokes a round are ranked, biggest loss first: the top one is worth the most to fix.", "Each comes with a drill: tap Add to practice to put it in the practice plan."] }),
    cat: (q, c) => ({ id: `cat-${c}`, q, steps: [`Focus is set to ${CAT_PLAY[c]} only.`, "Where you stand: the season, the last rounds and the trend, against the tour.", `Below it, each distance ${CAT_IN[c]} ranked by the strokes it costs a round, with a drill for each.`, "Tap Add to practice on any of them to put it in the practice plan."] }),
    trend: (q) => ({ id: "trend", q, steps: ["Each bar is a tournament: strokes gained a round there.", "Form compares the last 12 rounds with the 12 before them (the DP World Tour: 3 events against 3).", "Getting better or worse compares 12 against 12 and 48 against 48 for the longer view."] }),
    rank: (q) => ({ id: "rank", q, steps: ["Every player compared with enough rounds in this selection is ranked on strokes gained a round.", "Change the part of the game at the top to rank on driving, approach, short game or putting.", "Min. rounds sets how many rounds a player needs to be ranked."] }),
    elite: (q) => ({ id: "elite", q, steps: ["Elite stretches: the player’s best runs of rounds, and what made them good.", "Path back to Elite: what’s different now, part by part, and the drills to close the gap."] }),
    product: (q, kind) => ({ id: `prod-${kind}`, q, steps: [`Each bar is a tournament, coloured by the ${KIND_WORD[kind] || "product"} used most there.`, "The table under it: strokes gained a round with each model, over the rounds it was used, and the stats recorded with it.", "Wrong model at a tournament? Tap Edit and then that bar to put it right; it’s kept through new data."] }),
    cmpYears: (q) => ({ id: "cmp-years", q, steps: ["Each season is its own selection: strokes gained a round in each part of the game, side by side.", "Side by side lists every stat for both; the better one is highlighted.", "For a PDF of this: open Stats with both seasons picked, tap Generate PDF Report, then Compare."] }),
    cmpWin: (q) => ({ id: "cmp-win", q, steps: ["The last 12 rounds against the 12 before them, part by part of the game.", "Where a part of the game has moved, the stats under it show why (Hit Green %, Proximity, Made Putt %…)."] }),
    cmpPlayer: (q) => ({ id: "cmp-player", q, steps: ["Pick the other player (or several) at the top.", "Each is shown side by side: strokes gained a round in each part of the game, then every stat.", "Generate PDF Report makes a write-up of the comparison."] }),
    report: (q) => ({ id: "report", q, steps: ["Both seasons are picked at the top of Stats.", "Tap ✨ Generate PDF Report, then Compare: each season side by side, the differences highlighted.", "Combine makes one report over both seasons together."] }),
    hole: (q) => ({ id: "hole", q, steps: ["Every round played to this pin, and where each shot finished.", "Cal’s circles (8 or 10 yds): off the tee, where to aim and what to avoid; on the approach, the best, 2nd best and worst places to miss.", "Each circle’s numbers are the shots inside it: tap anywhere on the map for a circle of your own and see them."] }),
    course: (q) => ({ id: "course", q, steps: ["Strategy Maps: each hole and pin, how the field scored from every spot.", "Turn on Cal’s Targets for where to aim and where to miss on each hole.", "Course Insights and the course report sum up the holes that cost the most."] }),
    lm: (q) => ({ id: "lm", q, steps: ["Every launch monitor shot (TrackMan or GCQuad), by club.", "The table: each club’s averages; tap a club for its models and every shot.", "Dispersion and trajectory show the spread; Over time shows any number improving or not."] }),
    practice: (q) => ({ id: "practice", q, steps: ["Your practice sessions: in progress, not yet started and completed.", "Create Practice Session picks the ranges to work on, each with a target a set.", "Drills added from Stats arrive here with their target already set."] }),
    goals: (q) => ({ id: "goals", q, steps: ["Each goal: the stat, the target and the rounds it has to be met in.", "On track, met or missed, from the rounds played since it was set."] }),
    lead: (q) => ({ id: "lead", q, steps: ["Every player ranked on strokes gained a round, for the season and tour picked.", "Pick a part of the game at the top for the leaders in it."] }),
  };

  // ---- the questions ----
  // { id, icon, t: (k) => text, to: "Stats · Focus", who: needs a player, run: async (k) => …}
  const P = (fn) => async (q, k0) => { const k = k0 || (await askPlayer(q)); if (k) await fn(q, k); };
  const lastYear = (k) => yearsOf(k).at(-1);
  const Q = {
    lost: { icon: "📉", t: (k) => `Where ${W(k).am} losing the most strokes?`, to: "Stats · Focus", run: P(async (q, k) => { const per = await askPeriod(q, k); if (per) toStats(k, { ...per, view2: "focus", focusCats: [], focusPick: null }, "Where you stand", EX.lost(q)); }) },
    trend: { icon: "📈", t: (k) => `${isMe(k) ? "Am I" : `Is ${firstOf(k)}`} getting better or worse?`, to: "Stats · Form & trends", run: P(async (q, k) => toStats(k, { view2: "full", year: [], span: "12" }, "SG Trends", EX.trend(q))) },
    rank: { icon: "🏆", t: (k) => `Where ${isMe(k) ? "do I" : `does ${firstOf(k)}`} rank on tour this season?`, to: "Stats · Rankings", run: P(async (q, k) => toStats(k, { view2: "full", year: lastYear(k) ? [lastYear(k)] : [], span: 0 }, "Rankings", EX.rank(q))) },
    elite: { icon: "⭐", t: (k) => `When ${isMe(k) ? "do I" : `does ${firstOf(k)}`} play ${isMe(k) ? "my" : "their"} best golf, and why?`, to: "Stats · Elite stretches", run: P(async (q, k) => toStats(k, { view2: "full", year: [], span: 0 }, "Elite Stretches", EX.elite(q))) },
    report: { icon: "📄", t: (k) => `Make ${isMe(k) ? "me a" : "a"} report comparing this season to last${isMe(k) ? "" : ` for ${firstOf(k)}`}`, to: "PDF report · Season comparison", run: P(async (q, k) => { const ys = yearsOf(k).slice(-2); toStats(k, { view2: "full", year: ys, span: 0 }, null, EX.report(q)); }) },
    seasons: { icon: "🗓️", t: (k) => { const ys = yearsOf(k); return ys.length >= 2 ? `How does ${ys.at(-1)} compare to ${ys.at(-2)}${isMe(k) ? "" : ` for ${firstOf(k)}`}?` : `How ${isMe(k) ? "have I" : `has ${firstOf(k)}`} changed season to season?`; }, to: "Compare · Seasons", run: P(async (q, k) => { const ys = yearsOf(k).slice(-2); go(`#/comparisons?player=${encodeURIComponent(k)}${ys.length >= 2 ? `&pick=years:${ys.join(",")}` : ""}`, EX.cmpYears(q)); }) },
    window: { icon: "⏱️", t: (k) => `${isMe(k) ? "Am I" : `Is ${firstOf(k)}`} better now than 12 rounds ago?`, to: "Compare · Last 12 vs 12 before", run: P(async (q, k) => go(`#/comparisons?player=${encodeURIComponent(k)}&pick=win:12`, EX.cmpWin(q))) },
    vs: { icon: "⚖️", t: (k) => `How ${isMe(k) ? "do I" : `does ${firstOf(k)}`} compare to another player?`, to: "Compare · Players", run: P(async (q, k) => go(`#/comparisons?player=${encodeURIComponent(k)}`, EX.cmpPlayer(q))) },
    product: { icon: "🏌️", t: (k) => `Which club works best for ${W(k).me}?`, to: "Stats · SG Trends by Product", run: P(async (q, k) => { const kind = await askKind(q); if (kind) toStats(k, { view2: "full", productKind: kind, year: [], span: 0 }, "SG Trends by Product", EX.product(q, kind)); }) },
    lm: { icon: "📡", t: (k) => `What are ${W(k).my} carry numbers by club?`, to: "Practice · Launch Monitor", run: P(async (q, k) => go(isMe(k) || !admin ? `${pageHref(k, "/practice")}${isMe(k) ? "?tab=lm" : ""}` : "#/practice?tab=lm", EX.lm(q))) },
    witb: { icon: "🎒", t: (k) => `What’s in ${W(k).my} bag?`, to: "WITB", run: P(async (q, k) => go(isMe(k) ? "#/witb" : `#/witb?player=${encodeURIComponent(k)}`)) },
    plan: { icon: "🎯", t: (k) => `What should ${W(k).I} practice this week?`, to: "Stats · Focus → Practice", run: P(async (q, k) => toStats(k, { view2: "focus", focusCats: [], focusPick: null, year: [], span: "12" }, "Where you stand", EX.lost(q))) },
    sessions: { icon: "✅", t: (k) => `${isMe(k) ? "My" : `${firstOf(k)}’s`} practice sessions`, to: "Practice", run: P(async (q, k) => go(isMe(k) || !team.isTeam ? "#/practice" : pageHref(k, "/practice"), EX.practice(q))) },
    goals: { icon: "🏁", t: (k) => `${isMe(k) ? "Am I" : `Is ${firstOf(k)}`} on track for ${isMe(k) ? "my" : "their"} goals?`, to: "Goals", run: P(async (q, k) => go(isMe(k) || !team.isTeam ? "#/goals" : pageHref(k, "/goals"), EX.goals(q))) },
    course: { icon: "⛳", t: () => (next?.heat ? `How should I play ${next.name}?` : "How should I play my next tournament?"), to: "Course Prep · Strategy Maps", run: async (q) => { const id = next?.heat && !next.ask ? next.heat : await askCourse(q); if (id) toHole(id, 1, EX.course(q)); } },
    hole: { icon: "🎯", t: () => "Where should I aim and miss on a hole?", to: "Strategy Maps · Cal’s Targets", run: async (q) => { const id = await askCourse(q); if (!id) return; const h = await askHole(q, id); if (h) toHole(id, h, EX.hole(q)); } },
    insights: { icon: "🧭", t: () => "Which holes cost the field the most?", to: "Course Prep · Course Insights", run: async (q) => { const id = await askCourse(q); if (id) toHole(id, 1, EX.course(q)); } },
    leaders: { icon: "🥇", t: () => "Who leads the tour in each part of the game?", to: "Leaderboards", run: async (q) => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead(q)) },
    live: { icon: "🔴", t: () => "What’s happening at this week’s tournament?", to: "Event Feed", run: async () => go("#/live") },
    bulk: { icon: "🗂️", t: () => "Make PDF reports for a group of players", to: "Bulk Reports", run: async () => go("#/bulk-reports") },
  };
  const TABS = [
    [selfKey ? "My game" : team.isTeam ? "My players" : "Players", ["lost", "trend", "rank", "elite", "report"]],
    ["Next event", ["course", "hole", "insights", "live"]],
    ["Equipment", ["product", "lm", "witb"]],
    ["Practice", ["plan", "sessions", "goals"]],
    ["Compare", ["seasons", "window", "vs"]],
    ...(staff ? [["Tour", ["leaders", "live", ...(admin || analyst ? ["bulk"] : [])]]] : []),
  ];

  // ---- the page ----
  const hr = new Date().getHours(), tod = hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening", first = String(myName || "").split(" ")[0];
  const askBox = calAllowed() ? (() => {
    const inp = el("input", { type: "text", class: "ah-ask-in", placeholder: "Ask Cal anything about your game…", "aria-label": "Ask Cal" });
    const mic = el("button", { type: "button", class: "ah-mic", "aria-label": "Ask Cal: tap to open, hold to talk" }, "🎙");
    const send = async () => { const t = inp.value.trim(); const m = await import("../callie.js"); if (t) { inp.value = ""; m.askHeld(t); } else m.openCallie(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    let held = false; mic.addEventListener("click", (e) => { e.stopPropagation(); if (held) { held = false; return; } send(); }); holdToTalk(mic, () => { held = true; });
    return el("div", { class: "ah-ask" }, [el("span", { class: "ah-spark", "aria-hidden": "true" }, "✦"), inp, mic]);
  })() : null;
  const sugBox = el("div", { class: "ah-sug" }, el("p", { class: "muted small" }, "Looking at your numbers…"));
  const tabBar = el("div", { class: "ah-tabs", role: "tablist" }), list = el("div", { class: "ah-list" });
  let tab = 0;
  const card = (id, k, why = null, hot = false) => { const D = Q[id]; const qtext = D.t(k);
    const b = el("button", { type: "button", class: `ah-q${hot ? " hot" : ""}` }, [el("span", { class: "ah-e", "aria-hidden": "true" }, D.icon), el("span", { class: "ah-tx" }, [qtext, el("span", { class: "ah-to" }, [why ? el("em", {}, `${why} · `) : null, "→ ", el("b", {}, D.to.split(" · ")[0]), D.to.includes(" · ") ? ` · ${D.to.split(" · ").slice(1).join(" · ")}` : ""])])]);
    b.addEventListener("click", () => D.run(qtext, k)); return b; };
  const drawTabs = () => {
    mount(tabBar, TABS.map(([nm], i) => { const b = el("button", { type: "button", role: "tab", class: `ah-tab${i === tab ? " on" : ""}`, "aria-selected": String(i === tab) }, nm); b.addEventListener("click", () => { tab = i; drawTabs(); }); return b; }));
    mount(list, TABS[tab][1].map((id) => card(id, focus)));
  };
  mount(root, [
    el("p", { class: "ah-hi" }, `Good ${tod}${first ? `, ${first}` : ""}`),
    el("h1", { class: "ah-big" }, ["What do you want to ", el("em", {}, "know"), " today?"]),
    askBox,
    el("p", { class: "ah-lbl" }, staff && focus ? `SUGGESTED · ${nameOf(focus).toUpperCase()}` : "SUGGESTED FOR YOU"), sugBox,
    el("p", { class: "ah-lbl" }, "EVERYTHING YOU CAN ASK"), tabBar, list,
  ]);
  drawTabs();

  // ---- this week's tournament (for "How should I play …") ----
  const nextP = import("../liveData.js").then((m) => m.liveFile("current.json")).then(async (cur) => {
    const ts = (cur?.tours || []).filter((x) => x.name), day = (d) => Date.parse(`${String(d || "").slice(0, 10)}T12:00:00`) || 0, now = Date.now();
    const on = ts.find((x) => x.status === "live") || ts.filter((x) => x.status !== "final" && day(x.start) >= now - 864e5).sort((a, b) => day(a.start) - day(b.start))[0];
    if (!on) return; await heatP;
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const c = heat?.find((h) => (h.events || []).some((e) => norm(e.name) === norm(on.name)) || (on.course && norm(h.name) === norm(on.course)));
    next = { name: on.name, heat: c?.id || null };
  }).catch(() => {});

  // ---- the players' data, then the suggestions ----
  try {
    if (admin || team.isTeam) {
      if (admin) await playersList();
      try { const wl = await import("../watchlist.js"); await wl.loadWatch(true).catch(() => {}); const fav = wl.watchPrefs().players || []; focus ||= fav.find((k) => admin || teamKeys.includes(k)) || teamKeys[0] || null; } catch { focus ||= teamKeys[0] || null; }
    }
    const via = focus || selfKey || teamKeys[0];
    const dsList = admin ? await once((cb) => store.watchAdminDatasets(cb)) : via ? await once((cb) => store.watchClientDatasets(via, cb)) : [];
    const ds = (dsList || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
    const summary = ds ? await store.getFieldStats(ds.id).catch(() => null) : null;
    field = summaryPlayers(summary).filter((p) => p.rounds.length);
    for (const p of field) if (!labels.has(p.key) && p.name) labels.set(p.key, p.name);
    drawTabs(); // (names and seasons known now)
    await nextP; drawTabs();
    drawSuggestions();
  } catch (err) { console.error(err); mount(sugBox, el("p", { class: "muted small" }, "Couldn’t look at the numbers just now.")); }

  // What to suggest, from the numbers: [score, card]
  function drawSuggestions(extra = []) {
    const k = focus, out = [];
    if (!k) { mount(sugBox, el("p", { class: "muted small" }, staff ? "Add players to your Watchlist (Home › Players) and their questions will be suggested here." : "Questions picked from your own numbers will appear here once your first rounds are in.")); return; }
    const rs = roundsOf(k), ys = yearsOf(k), last = ys.at(-1);
    const per = (list, c) => (list.length ? list.reduce((t, rd) => t + rd.shots.filter((s) => s.cat === c).reduce((u, s) => u + s.sg, 0), 0) / list.length : null);
    const season = rs.filter((r) => yrOf(r) === last), cats = ["OTT", "APP", "ARG", "PUTT"];
    // the part of the game costing the most this season
    const vals = cats.map((c) => [c, per(season, c)]).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
    if (vals.length && vals[0][1] < 0.05) { const [c, v] = vals[0];
      out.push([3 + Math.max(0, -v), cardFor(`How can ${W(k).I} gain strokes ${CAT_IN[c]}?`, "🧩", `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} a round ${CAT_IN[c]}, ${isMe(k) ? "your" : "their"} weakest part this season`, "Stats · Focus", (q) => toStats(k, { view2: "focus", focusCats: [c], focusPick: c, year: last ? [last] : [], span: 0 }, "Where you stand", EX.cat(q, c)))]); }
    // what's slipped lately: the last 12 rounds against the 12 before
    if (rs.length >= 24) { const a = rs.slice(-12), b = rs.slice(-24, -12);
      const ch = cats.map((c) => [c, per(a, c) - per(b, c)]).sort((x, y) => x[1] - y[1]);
      if (ch[0][1] <= -0.2) { const [c, d] = ch[0]; out.push([2.5 - d, cardFor(`Why has ${W(k).my} ${CAT_PLAY[c]} dropped off lately?`, "📉", `down ${Math.abs(d).toFixed(2)} a round over the last 12 rounds`, "Stats · Focus", (q) => toStats(k, { view2: "focus", focusCats: [c], focusPick: c, year: [], span: 0 }, "Where you stand", EX.cat(q, c)))]); }
      const up = ch.at(-1); if (up[1] >= 0.25) out.push([1.5, cardFor(`What’s behind ${W(k).my} better ${CAT_PLAY[up[0]]} lately?`, "🚀", `up ${up[1].toFixed(2)} a round over the last 12 rounds`, "Compare · Last 12 vs 12 before", (q) => go(`#/comparisons?player=${encodeURIComponent(k)}&pick=win:12`, EX.cmpWin(q)))]); }
    // another season to compare
    if (ys.length >= 2) out.push([1.2, card("seasons", k, `${ys.at(-2)} and ${ys.at(-1)} both have rounds`)]);
    // the next tournament
    if (next?.heat) out.push([2.2, card("course", k, "this week’s tournament")]);
    out.push(...extra);
    const top = out.sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, c]) => c);
    mount(sugBox, top.length ? top : el("p", { class: "muted small" }, "No suggestions yet: try the questions below."));
    if (!extra.length) productHint(k).then((ex) => { if (ex.length) drawSuggestions(ex); }).catch(() => {});
  }
  function cardFor(text, icon, why, to, run) {
    const [pg, ...rest] = to.split(" · ");
    const b = el("button", { type: "button", class: "ah-q hot" }, [el("span", { class: "ah-e", "aria-hidden": "true" }, icon), el("span", { class: "ah-tx" }, [text, el("span", { class: "ah-to" }, [el("em", {}, `${why} · `), "→ ", el("b", {}, pg), rest.length ? ` · ${rest.join(" · ")}` : ""])])]);
    b.addEventListener("click", () => run(text)); return b;
  }
  // a club they keep switching: two or more models of one kind in their latest season (their own rows, loaded after the page)
  async function productHint(k) {
    if (!k) return [];
    if (HINTS.has(k)) return HINTS.get(k);
    const r = await productHint0(k).catch(() => []); HINTS.set(k, r); return r;
  }
  async function productHint0(k) {
    const { loadSource } = await import("../reportGen.js");
    const d = await loadSource("tour", k, nameOf(k), { detail: false }).catch(() => null);
    const rs = d?.me?.rounds || []; if (!rs.length) return [];
    const last = [...new Set(rs.map(yrOf))].sort().at(-1), m = new Map();
    for (const rd of rs) { if (yrOf(rd) !== last) continue; for (const s of rd.shots) { if (!s.gear) continue; const pill = KIND_PILL[gearInfo(s.gear).kind]; if (!pill) continue; (m.get(pill) || m.set(pill, new Map()).get(pill)).set(s.gear, ((m.get(pill)?.get(s.gear)) || 0) + 1); } }
    const many = [...m].map(([pill, g]) => [pill, [...g].filter(([, n]) => n >= 20).length]).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
    if (!many) return [];
    const [pill, n] = many, word = KIND_WORD[pill] || "club";
    return [[2.8 + n * 0.2, cardFor(`Which ${word} works best for ${W(k).me}?`, "🏌️", `${n} different ${word}${word.endsWith("s") ? "" : "s"} used in ${last}`, "Stats · SG Trends by Product", (q) => toStats(k, { view2: "full", productKind: pill, year: [], span: 0 }, "SG Trends by Product", EX.product(q, pill)))]];
  }
}
