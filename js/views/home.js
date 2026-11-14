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
  const poss = (n) => `${n}’${/s$/i.test(n) ? "" : "s"}`; // (update 727: "Blades’", "Sam’s")
  const W = (k) => (isMe(k) ? { I: "I", my: "my", me: "me", am: "am I", do: "do I", have: "have I", s: "" } : { I: firstOf(k), my: poss(firstOf(k)), me: firstOf(k), am: `is ${firstOf(k)}`, do: `does ${firstOf(k)}`, have: `has ${firstOf(k)}`, s: "s" });

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
  const feed = el("div", { class: "hl-feed" }, el("p", { class: "muted small" }, "Putting today’s highlights together…"));
  const tabBar = el("div", { class: "ah-tabs", role: "tablist" }), list = el("div", { class: "ah-list" });
  let tab = 0;
  const card = (id, k) => { const D = Q[id]; const qtext = D.t(k);
    const b = el("button", { type: "button", class: "ah-q" }, [el("span", { class: "ah-e", "aria-hidden": "true" }, D.icon), el("span", { class: "ah-tx" }, [qtext, el("span", { class: "ah-to" }, ["→ ", el("b", {}, D.to.split(" · ")[0]), D.to.includes(" · ") ? ` · ${D.to.split(" · ").slice(1).join(" · ")}` : ""])])]);
    b.addEventListener("click", () => D.run(qtext, k)); return b; };
  const drawTabs = () => {
    mount(tabBar, TABS.map(([nm], i) => { const b = el("button", { type: "button", role: "tab", class: `ah-tab${i === tab ? " on" : ""}`, "aria-selected": String(i === tab) }, nm); b.addEventListener("click", () => { tab = i; drawTabs(); }); return b; }));
    mount(list, TABS[tab][1].map((id) => card(id, focus)));
  };
  // (update 727) the day's highlights first; the questions under them
  const asked = el("details", { class: "hl-more" }, [el("summary", {}, "Ask something else"), tabBar, list]);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  mount(root, [
    el("p", { class: "ah-hi" }, today),
    el("h1", { class: "ah-big" }, [`Good ${tod}${first ? `, ${first}` : ""}. `, el("em", {}, "Here’s what’s new.")]),
    askBox,
    el("p", { class: "ah-lbl" }, "TODAY’S HIGHLIGHTS"), feed, asked,
  ]);
  drawTabs();

  // ---- this week's tournament ----
  const nextP = import("../liveData.js").then((m) => m.liveFile("current.json")).then(async (cur) => {
    const ts = (cur?.tours || []).filter((x) => x.name), day = (d) => Date.parse(`${String(d || "").slice(0, 10)}T12:00:00`) || 0, now = Date.now();
    const live = ts.find((x) => x.status === "live"), on = live || ts.filter((x) => x.status !== "final" && day(x.start) >= now - 864e5).sort((a, b) => day(a.start) - day(b.start))[0];
    if (!on) return; await heatP;
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const c = heat?.find((h) => (h.events || []).some((e) => norm(e.name) === norm(on.name)) || (on.course && norm(h.name) === norm(on.course)));
    next = { name: on.name, heat: c?.id || null, live: !!live, start: on.start };
  }).catch(() => {});

  // ---- the players: whose highlights (a player: their own; a coach / caddy / analyst: their players, the Watchlist's
  // first; the admin: the Watchlist's) ----
  const roleOf = () => { if (selfKey) return "player"; if (admin) return "admin"; if (analyst) return "analyst";
    const rs = Object.values(team.teamAccess || {}).map((a) => String(a?.role || "").toLowerCase()); const m = new Map(); for (const r of rs) m.set(r, (m.get(r) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || "coach"; };
  const ROLE = roleOf();
  let keys = [];

  // ---- the highlights ----
  // { score (what matters most first), kind (Result, Milestone, Trend, Rank, Equipment, Next event, Practice, Tour), k (the
  //   player), title, detail, to ("Stats · Tournaments"), run () }
  const sg2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  const KIND = { Result: ["#0a84ff", "🏆"], Milestone: ["#d4b483", "⭐"], Trend: ["#30d158", "📈"], Slide: ["#ff453a", "📉"], Rank: ["#bf5af2", "🥇"], Equipment: ["#ff9f0a", "🏌️"], "Next event": ["#64d2ff", "⛳"], Practice: ["#ffd60a", "🎯"], Tour: ["#8e8e93", "📊"], Focus: ["#ff6482", "🧩"] };
  function drawFeed(items) {
    // (update 727) the 12 that matter most, with some variety: 4 at most about one player (when there are several), 3 of a kind
    const seen = new Set(), sorted = items.filter((x) => x && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => b.score - a.score), byK = new Map(), byKind = new Map(), list0 = [];
    for (const h of sorted) { if (list0.length >= 12) break; const pk = h.k || "", nk = (byK.get(pk) || 0), nd = (byKind.get(h.kind) || 0);
      if ((keys.length > 1 && h.k && nk >= 4) || nd >= 3) continue; list0.push(h); byK.set(pk, nk + 1); byKind.set(h.kind, nd + 1); }
    for (const h of sorted) { if (list0.length >= 12) break; if (!list0.includes(h)) list0.push(h); } // (room left: the rest in order)
    if (!list0.length) { mount(feed, el("p", { class: "muted small" }, staff && !keys.length ? "Add players to your Watchlist and their highlights will show here every day." : "Highlights will show here once rounds are in.")); return; }
    mount(feed, list0.map((h) => { const [col, icon] = KIND[h.kind] || KIND.Tour, [pg, ...rest] = h.to.split(" · ");
      const b = el("button", { type: "button", class: "hl-card", style: `--hl:${col}` }, [
        el("span", { class: "hl-top" }, [el("span", { class: "hl-kind" }, [el("span", { "aria-hidden": "true" }, icon), ` ${h.kind}`]), staff && h.k ? el("span", { class: "hl-who" }, nameOf(h.k)) : null]),
        el("strong", { class: "hl-title" }, h.title), h.detail ? el("span", { class: "hl-detail" }, h.detail) : null,
        el("span", { class: "hl-to" }, ["Dig deeper → ", el("b", {}, pg), rest.length ? ` · ${rest.join(" · ")}` : ""])]);
      b.addEventListener("click", () => h.run()); return b; }));
  }
  const cats = ["OTT", "APP", "ARG", "PUTT"], CATN = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" };
  const tot = (rd) => rd.shots.reduce((t, s) => t + s.sg, 0), inCat = (rd, c) => rd.shots.filter((s) => s.cat === c).reduce((t, s) => t + s.sg, 0);
  const avgOf = (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null);
  const he = (k) => (isMe(k) ? "you" : firstOf(k)), His = (k) => (isMe(k) ? "Your" : poss(firstOf(k))), his = (k) => (isMe(k) ? "your" : poss(firstOf(k)));
  const eventsOf = (rs) => { const m = new Map(); for (const r of rs) { const kk = `${r.event}|${yrOf(r)}`; (m.get(kk) || m.set(kk, { event: r.event, year: yrOf(r), rs: [] }).get(kk)).rs.push(r); } return [...m.values()].map((e) => ({ ...e, end: e.rs.map((r) => String(r.date)).sort().at(-1), avg: avgOf(e.rs, tot) })).sort((a, b) => a.end.localeCompare(b.end)); };
  // season ranks among the players with enough rounds (the Stats page's default Min. rounds)
  let rankMemo = null;
  const ranksFor = (year) => { if (rankMemo?.year === year) return rankMemo;
    const ps = field.map((p) => ({ k: p.key, rs: p.rounds.filter((r) => yrOf(r) === year) })).filter((p) => p.rs.length);
    const most = Math.max(0, ...ps.map((p) => p.rs.length)), minR = Math.max(1, Math.floor((most * 0.33) / 5) * 5);
    const ok = ps.filter((p) => p.rs.length >= minR), by = {};
    for (const c of ["TOTAL", ...cats]) { const v = ok.map((p) => [p.k, avgOf(p.rs, c === "TOTAL" ? tot : (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1]); by[c] = new Map(v.map(([k], i) => [k, i + 1])); by[`${c}#`] = v.length; }
    rankMemo = { year, by }; return rankMemo; };
  function highlightsFor(k) {
    const out = [], rs = roundsOf(k); if (!rs.length) return out;
    const ys = yearsOf(k), last = ys.at(-1), season = rs.filter((r) => yrOf(r) === last), evs = eventsOf(season), sAvg = avgOf(season, tot);
    const ago = (d) => (Date.now() - (Date.parse(String(d).slice(0, 10)) || 0)) / 864e5, recent = (d) => ago(d) <= 21;
    // the last tournament: against the season
    const le = evs.at(-1);
    if (le && evs.length >= 3 && recent(le.end)) { const better = [...evs].sort((a, b) => b.avg - a.avg), pos = better.indexOf(le) + 1, d = le.avg - sAvg;
      const best = pos === 1, worst = pos === evs.length;
      if (best || worst || Math.abs(d) >= 0.6) out.push({ id: `ev-${k}`, k, kind: best ? "Milestone" : worst ? "Slide" : "Result", score: (best || worst ? 8 : 6) + Math.abs(d),
        title: `${le.event}: ${sg2(le.avg)} a round${best ? `, ${isMe(k) ? "your" : "the"} best tournament of ${last}` : worst ? `, the toughest of ${last}` : ""}`,
        detail: `${Math.abs(d).toFixed(2)} ${d >= 0 ? "better" : "worse"} than ${his(k)} ${last} average (${sg2(sAvg)}) · ${le.rs.length} rounds`,
        to: "Stats · Tournaments", run: () => toStats(k, { view2: "full", year: [last], span: 0 }, "Tournaments", null) });
      // the best round of the season, just played
      const bestR = [...season].sort((a, b) => tot(b) - tot(a))[0];
      if (bestR && le.rs.includes(bestR) && season.length >= 8) out.push({ id: `br-${k}`, k, kind: "Milestone", score: 8.5, title: `${His(k)} best round of ${last}: ${sg2(tot(bestR))}`, detail: `Round ${bestR.roundNo || ""} at ${le.event}`.replace("Round  ", "A round "), to: "Stats · SG Trends", run: () => toStats(k, { view2: "full", year: [last], span: 0, trendBy: "round" }, "SG Trends", null) }); }
    // gaining strokes round after round
    let streak = 0; for (let i = rs.length - 1; i >= 0 && tot(rs[i]) > 0; i--) streak++;
    if (streak >= 5) out.push({ id: `st-${k}`, k, kind: "Milestone", score: 6 + streak * 0.2, title: `${streak} rounds in a row gaining strokes`, detail: `${isMe(k) ? "You’ve" : `${firstOf(k)} has`} beaten the tour average every round since ${rs[rs.length - streak].event}`, to: "Stats · Elite stretches", run: () => toStats(k, { view2: "full", year: [], span: 0 }, "Elite Stretches", EX.elite(`When ${isMe(k) ? "do I" : `does ${firstOf(k)}`} play best?`)) });
    // form: the last 12 rounds against the 12 before, and each part of the game
    if (rs.length >= 24) { const a = rs.slice(-12), b = rs.slice(-24, -12), d = avgOf(a, tot) - avgOf(b, tot);
      if (Math.abs(d) >= 0.3) out.push({ id: `fm-${k}`, k, kind: d > 0 ? "Trend" : "Slide", score: 5 + Math.abs(d) * 2, title: `${His(k)} form is ${d > 0 ? "heating up" : "cooling off"}: ${sg2(d)} a round`, detail: `Last 12 rounds ${sg2(avgOf(a, tot))} against ${sg2(avgOf(b, tot))} in the 12 before`, to: "Compare · Last 12 vs 12 before", run: () => go(`#/comparisons?player=${encodeURIComponent(k)}&pick=win:12`, EX.cmpWin("What changed over the last 12 rounds?")) });
      const ch = cats.map((c) => [c, avgOf(a, (r) => inCat(r, c)) - avgOf(b, (r) => inCat(r, c))]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      for (const [c, dc] of ch.slice(0, 2)) if (Math.abs(dc) >= 0.2) out.push({ id: `cm-${k}-${c}`, k, kind: dc > 0 ? "Trend" : "Slide", score: 4.5 + Math.abs(dc) * 2, title: `${CATN[c]} ${dc > 0 ? "up" : "down"} ${Math.abs(dc).toFixed(2)} a round lately`, detail: `${His(k)} last 12 rounds against the 12 before`, to: `Stats · Focus · ${CATN[c]}`, run: () => toStats(k, { view2: "focus", focusCats: [c], focusPick: c, year: [], span: 0 }, "Where you stand", EX.cat(`${CATN[c]}: what changed?`, c)) }); }
    // the part of the game costing the most this season
    const weak = cats.map((c) => [c, avgOf(season, (r) => inCat(r, c))]).filter(([, v]) => v != null).sort((x, y) => x[1] - y[1])[0];
    if (weak && weak[1] <= -0.1 && season.length >= 6) out.push({ id: `wk-${k}`, k, kind: "Focus", score: 4 + Math.abs(weak[1]) * 2, title: `${CATN[weak[0]]} is costing ${he(k)} ${Math.abs(weak[1]).toFixed(2)} a round`, detail: `${His(k)} weakest part of the game in ${last}: where, and the drills for it`, to: `Stats · Focus · ${CATN[weak[0]]}`, run: () => toStats(k, { view2: "focus", focusCats: [weak[0]], focusPick: weak[0], year: [last], span: 0 }, "Where you stand", EX.cat(`Where is ${CATN[weak[0]].toLowerCase()} costing strokes?`, weak[0])) });
    // tour ranks this season: top 10 (and top 25 overall)
    if (last) { const R = ranksFor(last).by;
      // (update 727) one card: the best of their top-10 ranks (top 25 for strokes gained overall), the others listed
      const ord = (r) => (r === 1 ? "No. 1" : `${r}${["th", "st", "nd", "rd"][((r % 100) - 20) % 10] || ["th", "st", "nd", "rd"][r % 100] || "th"}`);
      const hits = ["TOTAL", ...cats].map((c) => [c, R[c]?.get(k), R[`${c}#`]]).filter(([c, r, n]) => r && n >= 20 && r <= (c === "TOTAL" ? 25 : 10)).sort((a, b) => a[1] - b[1]);
      if (hits.length) { const [c, r, n] = hits[0], nm = (x) => (x === "TOTAL" ? "strokes gained" : CATN[x].toLowerCase());
        out.push({ id: `rk-${k}`, k, kind: "Rank", score: 5 + (11 - Math.min(10, r)) * 0.25 + hits.length * 0.2, title: `${ord(r)} on tour in ${nm(c)} this season`,
          detail: `${hits.length > 1 ? `Also ${hits.slice(1).map(([x, rr]) => `${ord(rr)} in ${nm(x)}`).join(", ")} · ` : ""}out of ${n} players with enough rounds in ${last}`,
          to: "Stats · Rankings", run: () => toStats(k, { view2: "full", year: [last], span: 0, cats: c === "TOTAL" ? [] : [c] }, "Rankings", EX.rank("Where do I rank?")) }); } }
    return out;
  }
  function highlightsAll() {
    const out = [];
    for (const k of keys) out.push(...highlightsFor(k));
    // this week's tournament, with its strategy maps (caddies first)
    if (next?.heat) out.push({ id: "next", k: null, kind: "Next event", score: ROLE === "caddy" ? 9 : 5.5, title: `${next.live ? "On now" : "Coming up"}: ${next.name}`, detail: "Cal’s targets for every hole: where to aim off the tee and where to miss the green", to: "Course Prep · Strategy Maps", run: () => toHole(next.heat, 1, EX.course(`How should I play ${next.name}?`)) });
    // the tour (analysts and the admin): the biggest movers over the last 12 rounds
    if (ROLE === "analyst" || ROLE === "admin") {
      const mv = field.filter((p) => p.rounds.length >= 24).map((p) => { const rs = [...p.rounds].sort((a, b) => String(a.date).localeCompare(String(b.date))); return [p.key, avgOf(rs.slice(-12), tot) - avgOf(rs.slice(-24, -12), tot)]; }).sort((a, b) => b[1] - a[1]);
      if (mv.length >= 10) { const top = mv.slice(0, 3); out.push({ id: "movers", k: null, kind: "Tour", score: 5, title: `Biggest risers: ${top.map(([k2, d]) => `${firstOf(k2)} ${sg2(d)}`).join(", ")}`, detail: "Strokes gained a round, the last 12 rounds against the 12 before", to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) });
        const bot = mv.slice(-3).reverse(); out.push({ id: "fallers", k: null, kind: "Tour", score: 4, title: `Biggest drops: ${bot.map(([k2, d]) => `${firstOf(k2)} ${sg2(d)}`).join(", ")}`, detail: "Strokes gained a round, the last 12 rounds against the 12 before", to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) }); }
    }
    if (ROLE === "caddy") for (const h of out) if (h.kind === "Rank" || h.kind === "Tour") h.score -= 2; // (a caddy: the course and the form first)
    return out;
  }
  // equipment: a club switched in the last few tournaments, and how that part of the game has gone since
  async function gearHighlights(k) {
    const { loadSource } = await import("../reportGen.js");
    const d = HINTS.has(k) ? HINTS.get(k) : await loadSource("tour", k, nameOf(k), { detail: false }).catch(() => null); HINTS.set(k, d);
    const rs = (d?.me?.rounds || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); if (!rs.length) return [];
    const evs = eventsOf(rs).slice(-16), out = [];
    for (const pill of ["Driver", "Putters", "Irons", "Wedges", "Non-Driver", "Balls"]) {
      const val = (s) => (pill === "Balls" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear && KIND_PILL[gearInfo(s.gear).kind] === pill ? s.gear : null);
      const top = evs.map((e) => { const m = new Map(); for (const r of e.rs) for (const s of r.shots) { const v = val(s); if (v) m.set(v, (m.get(v) || 0) + (s.w || 1)); } return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || null; });
      const i = top.length - 1; if (!top[i]) continue;
      let j = i; while (j > 0 && (top[j - 1] === top[i] || !top[j - 1])) j--; // the first tournament with the new one
      if (j === 0 || i - j > 5 || !top[j - 1]) continue;
      const neu = top[i], old = top[j - 1], since = evs.slice(j), before = evs.slice(Math.max(0, j - 6), j);
      const sgWith = (es, g) => { const r0 = es.flatMap((e) => e.rs); const n = r0.length; return n ? r0.reduce((t, r) => t + r.shots.filter((s) => val(s) === g).reduce((u, s) => u + s.sg, 0), 0) / n : null; };
      const a = sgWith(since, neu), b = sgWith(before, old), nm = (g) => { const gi = gearInfo(g); return `${gi.brand} ${gi.model}`.trim() || g; };
      if (a == null || b == null) continue;
      const dd = a - b;
      out.push({ id: `eq-${k}-${pill}`, k, kind: "Equipment", score: 7 + Math.abs(dd) * 2, title: `New ${KIND_WORD[pill] || "club"}: ${nm(neu)}, ${sg2(dd)} a round so far`, detail: `${since.length} tournament${since.length === 1 ? "" : "s"} with it (${sg2(a)} a round with those shots) against ${sg2(b)} with the ${nm(old)} before`, to: "Stats · SG Trends by Product", run: () => toStats(k, { view2: "full", productKind: pill, year: [], span: 0 }, "SG Trends by Product", EX.product(`How is the new ${KIND_WORD[pill] || "club"} working?`, pill)) });
    }
    return out;
  }
  // practice (a player's own): sessions on the go, and launch monitor sessions this week
  async function practiceHighlights(k) {
    const out = [], { listPlan, planOwner } = await import("../practice/plan.js");
    const plan = await listPlan(planOwner(state)).catch(() => []), sess = plan.filter((x) => x.type === "session");
    const open = sess.filter((s) => s.items?.some((it) => (it.setsDone || 0) > 0 || (it.secs || 0) > 0) && !s.items.every((it) => it.done || (it.mode !== "time" && (it.setsDone || 0) >= (it.sets || 1))));
    if (open.length) out.push({ id: "pr-open", k, kind: "Practice", score: 4.5, title: `${open.length} practice session${open.length === 1 ? "" : "s"} in progress`, detail: open.map((s) => s.title || "Practice").slice(0, 3).join(", "), to: "Practice", run: () => go("#/practice", EX.practice("My practice sessions")) });
    const fromStats = sess.filter((s) => s.fromStats && !(s.items || []).some((it) => (it.setsDone || 0) > 0));
    if (fromStats.length) out.push({ id: "pr-new", k, kind: "Practice", score: 4, title: `${fromStats.length} new drill${fromStats.length === 1 ? "" : "s"} from Stats waiting`, detail: "Added from your weak spots, each with its target", to: "Practice", run: () => go("#/practice", EX.practice("My practice sessions")) });
    return out;
  }
  // (the data, once everything above is defined)
  if (window.__homeTest) Object.assign(window.__homeTest, { setField: (f) => { field = f; }, setKeys: (k) => { keys = k; }, draw: () => drawFeed(highlightsAll()) }); // (tests only)
  try {
    if (selfKey) keys = [selfKey];
    else {
      if (admin) await playersList();
      let fav = []; try { const wl = await import("../watchlist.js"); await wl.loadWatch(true).catch(() => {}); fav = wl.watchPrefs().players || []; } catch { /* */ }
      keys = admin ? fav : [...fav.filter((k) => teamKeys.includes(k)), ...teamKeys.filter((k) => !fav.includes(k))];
      keys = keys.slice(0, 12); focus ||= keys[0] || null;
    }
    const via = keys[0] || teamKeys[0];
    const dsList = admin ? await once((cb) => store.watchAdminDatasets(cb)) : via ? await once((cb) => store.watchClientDatasets(via, cb)) : [];
    const ds = (dsList || []).filter((d) => isShotData(detectColumns(d.columns || []))).sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0))[0];
    const summary = ds ? await store.getFieldStats(ds.id).catch(() => null) : null;
    field = summaryPlayers(summary).filter((p) => p.rounds.length);
    for (const p of field) if (!labels.has(p.key) && p.name) labels.set(p.key, p.name);
    drawTabs();
    await nextP;
    drawFeed(highlightsAll());
    // equipment (each player's own rows, loaded after the page: the first few)
    const gear = [];
    for (const k of keys.slice(0, selfKey ? 1 : 4)) { gear.push(...(await gearHighlights(k).catch(() => []))); drawFeed([...highlightsAll(), ...gear]); }
    if (selfKey) { const pr = await practiceHighlights(selfKey).catch(() => []); if (pr.length) drawFeed([...highlightsAll(), ...gear, ...pr]); }
  } catch (err) { console.error(err); mount(feed, el("p", { class: "muted small" }, "Couldn’t put the highlights together just now.")); }
}
