// (update 726) Home: questions. A greeting, one line to ask Cal, "Suggested for you" (questions picked from the player's own
// numbers: the part of the game costing the most, what's slipped lately, a club they keep switching, the next tournament,
// another season to compare), then tabs of example questions covering everything the site does. A question asks one
// follow-up when it needs one (which player, over what stretch, which course …), then opens the page already set up for
// it, with a one-time pop-up on how Cal answers it (askExplain.js). Players see "my"; coaches and analysts their players;
// the admin any player, and the tour.
import { el, mount, calAllowed, holdToTalk, icon } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { detectColumns, isShotData, summaryPlayers, gearInfo } from "../sg.js";
import { queueExplain } from "../askExplain.js";
import { sgRounds, roundsFor, perRound } from "../compareData.js"; // (update 728: the rounds and numbers exactly as Compare counts them)

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
  const root = el("div", { class: "ah td" });
  mount(main, root);

  // ---- who's who ----
  let labels = new Map();
  if (team.isTeam) labels = teamLabels(team.teamAccess);
  const myName = plainName(previewClient?.label || state.profile?.name || state.user?.displayName || "");
  if (selfKey) labels = new Map([[selfKey, myName || "You"]]);
  const nameOf = (k) => plainName(labels.get(k) || (typeof field !== "undefined" && field.find?.((p) => p.key === k)?.name) || String(k || "").replace(/^c_/, "")); /* (update 734: the field's full name when there's no label) */
  const firstOf = (k) => String(nameOf(k)).split(" ")[0] || "them";
  let focus = selfKey || (teamKeys.length === 1 ? teamKeys[0] : null);
  const isMe = (k) => !!selfKey && k === selfKey;
  const poss = (n) => `${n}’${/s$/i.test(n) ? "" : "s"}`; // (update 727: "Blades’", "Sam’s")
  const W = (k) => (isMe(k) ? { I: "I", my: "my", me: "me", am: "am I", do: "do I", have: "have I", s: "" } : { I: firstOf(k), my: poss(firstOf(k)), me: firstOf(k), am: `is ${firstOf(k)}`, do: `does ${firstOf(k)}`, have: `has ${firstOf(k)}`, s: "s" });

  // ---- where a question goes ----
  const statsHref = (k) => (isMe(k) || (!admin && !team.isTeam) ? "#/dashboard" : admin ? `#/admin/player-stats?player=${encodeURIComponent(k)}` : `#/view-as/${encodeURIComponent(k)}?label=${encodeURIComponent(nameOf(k))}&to=/dashboard`);
  const pageHref = (k, page) => (isMe(k) || !team.isTeam ? `#${page}` : `#/view-as/${encodeURIComponent(k)}?label=${encodeURIComponent(nameOf(k))}&to=${page}`);
  // (update 729) Stats opens on the tour picked here (tourFor: Stats keeps a tour only when it was set for that player)
  const toStats = (k, st, scroll, ex) => { st = { tour: [tourPick || ALL], tourFor: k, ...st }; try { sessionStorage.setItem("ta.statsPreset", JSON.stringify({ at: Date.now(), st, scroll })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = statsHref(k); };
  const toHole = (heat, hole, ex) => { try { sessionStorage.setItem("cal.open", JSON.stringify({ heat, hole, pin: null })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = `#/course-prep?cal=${Date.now()}`; };
  const go = (href, ex) => { if (ex) queueExplain(ex); location.hash = href; };
  // (update 737) a ranking opens the leaderboard (that part of the game, season and tour), not the player's own stats
  const boardHref = () => (admin ? "#/admin/analyze" : "#/leaderboards");
  const toBoard = (st, scroll, ex) => { st = { tour: [tourPick || ALL], tourFor: "__field", view2: "full", span: 0, ...st }; try { sessionStorage.setItem("ta.statsPreset", JSON.stringify({ at: Date.now(), st, scroll })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = boardHref(); };
  const cmpBase = (k) => `#/comparisons?player=${encodeURIComponent(k)}${tourPick && tourPick !== ALL ? `&tour=${encodeURIComponent(tourPick)}` : ""}`; // (update 729: Compare on the same tour)

  // ---- the data (filled in as it arrives) ----
  let field = [], years = [], heat = null, next = null;
  const heatP = import("../courseHeat.js").then((m) => m.listHeatCourses()).then((l) => (heat = (l || []).filter((c) => c.par?.length))).catch(() => (heat = []));
  const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  // (update 729) the tour picked at the top: everything (highlights, ranks, the pages they open) on that tour's rounds only;
  // "All" (picked by hand) every tour together. null until the data's in, then the tour the players have the most rounds on.
  const ALL = "__all";
  let tourPick = null, who = null; // who: the player picked at the top (null: all of them)
  const tourOf = (rd) => rd.tour || "", onTour = (rd) => !tourPick || tourPick === ALL || tourOf(rd) === tourPick;
  const tourName = (t) => (t === ALL ? "All tours" : t || "No tour");
  const tmemo = new Map();
  const rawOf = (p) => { if (!p) return []; const kk = `${p.key}|${tourPick}`; let r = tmemo.get(kk); if (!r || r.src !== p.rounds) { r = { src: p.rounds, v: p.rounds.filter(onTour) }; tmemo.set(kk, r); } return r.v; };
  const roundsOf = (k) => rawOf(field.find((p) => p.key === k)).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
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
    product: (q, kind) => ({ id: `prod-${kind}`, q, steps: [`Each bar is a tournament, colored by the ${KIND_WORD[kind] || "product"} used most there.`, "The table under it: strokes gained a round with each model, over the rounds it was used, and the stats recorded with it.", "Wrong model at a tournament? Tap Edit and then that bar to put it right; it’s kept through new data."] }),
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
    seasons: { icon: "🗓️", t: (k) => { const ys = yearsOf(k); return ys.length >= 2 ? `How does ${ys.at(-1)} compare to ${ys.at(-2)}${isMe(k) ? "" : ` for ${firstOf(k)}`}?` : `How ${isMe(k) ? "have I" : `has ${firstOf(k)}`} changed season to season?`; }, to: "Compare · Seasons", run: P(async (q, k) => { const ys = yearsOf(k).slice(-2); go(`${cmpBase(k)}${ys.length >= 2 ? `&pick=years:${ys.join(",")}` : ""}`, EX.cmpYears(q)); }) },
    window: { icon: "⏱️", t: (k) => `${isMe(k) ? "Am I" : `Is ${firstOf(k)}`} better now than 12 rounds ago?`, to: "Compare · Last 12 vs 12 before", run: P(async (q, k) => go(`${cmpBase(k)}&pick=win:12`, EX.cmpWin(q))) },
    vs: { icon: "⚖️", t: (k) => `How ${isMe(k) ? "do I" : `does ${firstOf(k)}`} compare to another player?`, to: "Compare · Players", run: P(async (q, k) => go(`${cmpBase(k)}`, EX.cmpPlayer(q))) },
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
    const inp = el("input", { type: "text", class: "ah-ask-in", placeholder: "Ask Cal, the AI Caddie…", "aria-label": "Ask Cal" });
    const mic = el("button", { type: "button", class: "ah-mic", "aria-label": "Ask Cal: tap to open, hold to talk", title: "Ask Cal (hold to talk)" }, icon("calface")); /* (update 730: Cal's logo) */
    const send = async () => { const t = inp.value.trim(); const m = await import("../callie.js"); if (t) { inp.value = ""; m.askHeld(t); } else m.openCallie(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    let held = false; mic.addEventListener("click", (e) => { e.stopPropagation(); if (held) { held = false; return; } send(); }); holdToTalk(mic, () => { held = true; });
    return el("div", { class: "ah-ask td-ask" }, [inp, mic]);
  })() : null;
  const tourRow = el("div", { class: "td-grp", hidden: true, role: "group", "aria-label": "Tour" }), whoRow = el("div", { class: "td-grp", hidden: true, role: "group", "aria-label": "Players" });
  const feed = el("div", { class: "td-feed" }, el("p", { class: "td-wait" }, "Putting today’s edition together…"));
  const secNav = el("nav", { class: "td-secs", "aria-label": "Sections" });
  const tabBar = el("div", { class: "ah-tabs", role: "tablist" }), list = el("div", { class: "ah-list" });
  let tab = 0;
  const card = (id, k) => { const D = Q[id]; const qtext = D.t(k);
    const b = el("button", { type: "button", class: "ah-q" }, [el("span", { class: "ah-e", "aria-hidden": "true" }, D.icon), el("span", { class: "ah-tx" }, [qtext, el("span", { class: "ah-to" }, ["→ ", el("b", {}, D.to.split(" · ")[0]), D.to.includes(" · ") ? ` · ${D.to.split(" · ").slice(1).join(" · ")}` : ""])])]);
    b.addEventListener("click", () => D.run(qtext, k)); return b; };
  const drawTabs = () => {
    mount(tabBar, TABS.map(([nm], i) => { const b = el("button", { type: "button", role: "tab", class: `ah-tab${i === tab ? " on" : ""}`, "aria-selected": String(i === tab) }, nm); b.addEventListener("click", () => { tab = i; drawTabs(); }); return b; }));
    mount(list, TABS[tab][1].map((id) => card(id, focus)));
  };
  // (update 731) Home as a newspaper, "Tour Analytics Daily": a masthead, the filters as its section bar, a front page
  // (the day's biggest story and the next three), then a section for each kind of highlight. Headlines are fixed wording
  // for each kind of highlight, filled in with the numbers. Colors: css/daily.css (dark, or light with the site's theme).
  const asked = el("details", { class: "hl-more td-asked" }, [el("summary", {}, "Ask Cal a question"), tabBar, list]);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const edition = el("span", {}, ""), nextLine = el("a", { class: "td-live", href: "#/live", title: "Open the Event Feed" }, ""), /* (update 734: this week’s event: a link to the Event Feed) */ roleLbl = el("span", { class: "td-top-r" }, "");
  mount(root, [
    el("header", { class: "td-mast" }, el("h1", {}, ["Tour Analytics ", el("i", {}, "Daily")])),
    el("div", { class: "td-date" }, [el("span", {}, today), edition, nextLine]),
    el("div", { class: "td-nav" }, [tourRow, whoRow, askBox]),
    secNav, feed, asked,
    el("div", { class: "td-foot" }, "Tour Analytics Daily · compiled by Cal from every shot on record · tap any story to dig deeper"),
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
  roleLbl.textContent = selfKey ? "Your edition" : `${{ admin: "Admin", analyst: "Analyst", caddy: "Caddie", coach: "Coach" }[ROLE] || "Coach"}’s edition`;
  // (update 731) a phone: equipment stories for 2 players at most (each loads that player's own rounds)
  let GEARN = 6; import("../fieldCache.js").then((m) => { if (m.isLiteDevice?.()) GEARN = 2; }).catch(() => {});
  let keys = [];

  // ---- the highlights ----
  // { score (what matters most first), kind (Result, Milestone, Trend, Rank, Equipment, Next event, Practice, Tour), k (the
  //   player), title, detail, to ("Stats · Tournaments"), run () }
  const sg2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  const UPCOMING = { name: "The American Express", re: /american express|amex\b/i, course: /pete dye stadium|pga west|la quinta/i, not: /sawgrass|tpc/i }; /* (update 737: the Pete Dye Stadium Course at PGA West) */ /* (update 736) */
  // ---- (update 731) the newspaper ----
  const SEC = { res: ["Results & Milestones", "The week’s best and worst"], form: ["Form", "The last 12 rounds against the 12 before"], gear: ["Equipment", "New in the bag"],
    rank: ["Rankings", ""], focus: ["Where to Improve", "The biggest leak, and the fix"], next: ["This Week", ""], prac: ["Practice", "On the range"], tour: ["Around the Tour", "Briefs"], course: ["Course Insights & Strategy", `Up next: ${UPCOMING.name}`] };
  const SEC_OF = { Result: "res", Milestone: "res", Trend: "form", Slide: "form", Rank: "rank", Equipment: "gear", Focus: "focus", "Next event": "next", Practice: "prac", Tour: "tour", Course: "course" };
  const ORDER = ROLE === "caddy" ? ["next", "course", "form", "res", "focus", "gear", "rank", "prac", "tour"] : ["form", "gear", "rank", "res", "focus", "next", "course", "prac", "tour"];
  const FULL = new Set(["form", "tour", "course"]);
  const CATW = { OTT: "driving", APP: "approach play", ARG: "short game", PUTT: "putting" };
  const ordN = (r) => (r === 1 ? "No. 1" : `${r}${["th", "st", "nd", "rd"][((r % 100) - 20) % 10] || ["th", "st", "nd", "rd"][r % 100] || "th"}`);
  const rkName = (c) => (c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase());
  const sur = (k) => { const w = String(nameOf(k)).split(/\s+/).filter((x) => x && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); return w.at(-1) || nameOf(k); };
  const cls = (v) => (v > 0.005 ? "up" : v < -0.005 ? "down" : "");
  // headline, number and the kicker over it, for each kind of highlight (a player's own Home: the card's own wording)
  function dress(h) {
    const k = h.k, x = h.x || {}, S = k ? sur(k) : "", me = k && isMe(k), t = h.id.split("-")[0];
    const o = { kick: h.kind, hl: h.title, deck: h.detail || "", num: null, nc: "", cap: "" };
    if (t === "ev") { o.kick = x.best ? "Milestone" : x.worst ? "Rough week" : "Result"; o.hl = me ? h.title : x.best ? `${poss(S)} best week of ${x.yr}, at ${x.ev}` : x.worst ? `A tough week for ${S} at ${x.ev}` : x.d > 0 ? `${S} beats the ${x.yr} average at ${x.ev}` : `${S} slips below the ${x.yr} average at ${x.ev}`; o.num = sg2(x.v); o.nc = cls(x.v); o.cap = `strokes gained total a round, over ${x.n} rounds there`; }
    else if (t === "br") { const on = tourPick && tourPick !== ALL ? `the ${tourName(tourPick)}` : "tour"; o.kick = x.tourBest ? "Best on tour" : "Personal best"; o.hl = x.tourBest ? `${me ? "You" : S} fired the best round on ${on} in ${x.yr}` : me ? h.title : `${poss(S)} best round of ${x.yr}`; o.num = sg2(x.v); o.nc = cls(x.v); o.cap = `strokes gained total, at ${x.ev}${x.tourBest ? "" : ` (${me ? "your" : poss(S)} best this season; not the tour’s best)`}`; }
    else if (t === "st") { o.hl = me ? h.title : `${S} stretches the streak to ${x.n} rounds in the black`; o.num = String(x.n); o.nc = "up"; o.cap = "rounds in a row with strokes gained total above zero"; }
    else if (t === "fm") { o.kick = x.d > 0 ? "Trending up" : "Slipping"; o.hl = me ? h.title : x.d > 0 ? `${S} is heating up` : `${S} is cooling off`; o.num = sg2(x.d); o.nc = cls(x.d); o.cap = `strokes gained total a round: ${sg2(x.a)} in the last ${x.FL}, ${sg2(x.b)} in the ${x.n} before`; }
    else if (t === "cm") { o.kick = x.d > 0 ? "Trending up" : "Slipping"; o.hl = me ? h.title : x.d > 0 ? `${poss(S)} ${CATW[x.c]} is on the rise` : `${poss(S)} ${CATW[x.c]} slips`; o.num = sg2(x.d); o.nc = cls(x.d); o.cap = `strokes gained a round ${CAT_IN[x.c]}: ${sg2(x.a)} lately, from ${sg2(x.b)}`; }
    else if (t === "wk") { o.kick = CATN[x.c]; o.hl = me ? h.title : `${CATN[x.c]} is costing ${S} ${Math.abs(x.v).toFixed(2)} a round`; o.num = sg2(x.v); o.nc = "down"; o.cap = `strokes gained a round ${CAT_IN[x.c]} in ${x.yr}`; }
    else if (t === "rkb") { const f = x.hits?.[0]; o.kick = "Room to climb"; o.nc = "down"; if (f) { o.hl = `${S} ${ordN(f.r)} of ${f.n} in ${rkName(f.c)}`; o.num = ordN(f.r).replace("No. ", ""); o.cap = `of ${f.n} players in ${x.yr}`; } }
    else if (t === "rk") { const f = x.hits?.[0]; if (f) { o.hl = me ? h.title : `${S} ${ordN(f.r)} on tour in ${rkName(f.c)}`; o.num = ordN(f.r).replace("No. ", ""); o.cap = `of ${f.n} players in ${x.yr}`; } }
    else if (t === "eq") { o.kick = `New ${KIND_WORD[x.pill] || "club"}`; o.hl = `The ${x.neu} is ${x.dd >= 0 ? "beating" : "trailing"} the ${x.old} so far ${me ? "for you" : `for ${S}`}`; /* (update 735: whose) */ o.num = sg2(x.dd); o.nc = cls(x.dd); o.cap = `strokes gained a round ${COL_IN[x.c]}, against the ${x.old}`; }
    else if (t === "next") { o.kick = next?.live ? "On now" : "Coming up"; o.hl = `Where to aim at ${next?.name || "the next event"}`; }
    return o;
  }
  // a player's season so far, for the lead story
  // (update 732) each story is about one thing: the part of the game it's about (null: strokes gained total)
  const catOf = (h) => { const t = h.id.split("-")[0], x = h.x || {};
    if (t === "eq" || t === "cm" || t === "wk") return x.c || null;
    if (t === "rk" || t === "rkb") { const c = x.hits?.[0]?.c; return c && c !== "TOTAL" ? c : null; }
    return null; };
  const catLbl = (c) => (c ? `strokes gained ${CAT_IN[c]}` : "strokes gained total");
  const ctxOf = (k, c) => { const p = field.find((q) => q.key === k), rs = sgRounds(rawOf(p)); if (!rs.length) return null; const yr = yrOf(rs.at(-1)), se = rs.filter((r) => yrOf(r) === yr), f = c ? (r) => inCat(r, c) : tot;
    return { yr, n: se.length, ev: new Set(se.map((r) => r.event)).size, avg: avgOf(se, f), spark: rs.slice(-24).map(f) }; };
  const spark = (vals) => { if (vals.length < 8) return null; const W = 300, H = 80, lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), y = (v) => 6 + (H - 12) * (1 - (v - lo) / (hi - lo || 1)), dx = W / (vals.length - 1);
    // a rolling average of 4 rounds, so the line reads as form, not noise
    const sm = vals.map((_, i) => avgOf(vals.slice(Math.max(0, i - 3), i + 1), (v) => v)), pts = sm.map((v, i) => `${(i * dx).toFixed(1)},${y(v).toFixed(1)}`), cut = Math.max(0, sm.length - 12);
    const ns = "http://www.w3.org/2000/svg", mk = (tag, at) => { const n = document.createElementNS(ns, tag); for (const [a2, b2] of Object.entries(at)) n.setAttribute(a2, b2); return n; };
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H + 16}`, width: "100%", class: "td-spark", "aria-hidden": "true" });
    svg.append(mk("line", { x1: 0, y1: y(0), x2: W, y2: y(0), class: "td-zero" }), mk("polyline", { points: pts.slice(0, cut + 1).join(" "), class: "td-l0" }), mk("polyline", { points: pts.slice(cut).join(" "), class: "td-l1" }),
      mk("circle", { cx: pts.at(-1).split(",")[0], cy: pts.at(-1).split(",")[1], r: 4, class: "td-dot" }));
    const tx = (x0, anchor, text) => { const n = mk("text", { x: x0, y: H + 14, "text-anchor": anchor, class: "td-tx" }); n.textContent = text; return n; };
    svg.append(tx(0, "start", `${vals.length} rounds ago`), tx(W, "end", "Last round")); return svg; };
  // (update 737) the main story's chart: bars, tournament by tournament (the last 14), in the story's part of the game;
  // an equipment story's bars colored by the model used (the new one gold)
  const ns0 = "http://www.w3.org/2000/svg", mk0 = (tag, at, txt) => { const n = document.createElementNS(ns0, tag); for (const [a2, b2] of Object.entries(at)) n.setAttribute(a2, b2); if (txt != null) n.textContent = txt; return n; };
  function barSvg(items, { note } = {}) { if (items.length < 3) return null;
    const W = 320, H = 130, top = 8, bot = 22, vs = items.map((x) => x.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y0 = top + hi * sc, bw = W / items.length;
    const svg = mk0("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "td-bars", role: "img", "aria-label": note || "Bar chart" });
    items.forEach((x, i) => { const h = Math.max(1.5, Math.abs(x.v) * sc), yy = x.v >= 0 ? y0 - h : y0;
      const r = mk0("rect", { x: (i * bw + bw * 0.14).toFixed(1), y: yy.toFixed(1), width: (bw * 0.72).toFixed(1), height: h.toFixed(1), rx: 2, class: `td-bar ${x.cls || (x.v >= 0 ? "up" : "down")}${x.hot ? " hot" : ""}` });
      r.append(mk0("title", {}, `${x.label}: ${sg2(x.v)}`)); svg.append(r); });
    svg.append(mk0("line", { x1: 0, x2: W, y1: y0.toFixed(1), y2: y0.toFixed(1), class: "td-zero" }));
    svg.append(mk0("text", { x: 0, y: H - 6, class: "td-tx" }, items[0].short), mk0("text", { x: W, y: H - 6, "text-anchor": "end", class: "td-tx" }, items.at(-1).short));
    return svg; }
  const shortEv = (e) => String(e || "").replace(/^the\s+/i, "").replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/i, "").replace(/\bChampionship\b/i, "Champ.").slice(0, 22);
  function storyBars(h, cat) {
    const t = h.id.split("-")[0];
    if (t === "eq" && h.k && gearData.has(h.k)) { // the player's own rounds, by tournament: that kind of club's shots, by model
      const x = h.x, val = (s0) => (x.pill === "Balls" ? (s0.ball ? `Ball|${s0.ball}` : null) : s0.gear || null);
      const nmOf = (g) => { const gi = gearInfo(g); return `${gi.brand} ${gi.model}`.trim() || g; };
      const rs = (gearData.get(h.k) || []).filter(onTour); const evs = eventsOf(rs).slice(-14);
      const items = evs.map((e) => { const m = new Map(); let sgs = 0, n = 0; for (const r of e.rs) { let any = false; for (const s0 of r.shots) { const g = val(s0); if (!g) continue; const nm2 = nmOf(g); if (nm2 !== x.neu && nm2 !== x.old && x.pill !== "Balls") { /* another model */ } m.set(nm2, (m.get(nm2) || 0) + (s0.w || 1)); any = true; if (!x.c || s0.cat === x.c) sgs += s0.sg; } if (any) n++; }
        const topM = [...m].sort((a2, b2) => b2[1] - a2[1])[0]?.[0]; return n ? { v: sgs / n, label: `${e.event} ${e.year} · ${topM || ""}`, short: shortEv(e.event), cls: topM === x.neu ? "gold" : "gray" } : null; }).filter(Boolean);
      const svg = barSvg(items, { note: "By tournament" }); if (!svg) return null;
      return [el("div", { class: "td-kick mute" }, `Strokes gained a round ${COL_IN[x.c]}, tournament by tournament`), svg, el("div", { class: "td-legend" }, [el("span", { class: "gold" }, x.neu), el("span", { class: "gray" }, x.old)])];
    }
    if (!h.k) return null;
    const p = field.find((q) => q.key === h.k), rs = sgRounds(rawOf(p)); if (!rs.length) return null;
    const f = cat ? (r) => inCat(r, cat) : tot, evs = eventsOf(rs).slice(-14), lastEv = evs.at(-1);
    const items = evs.map((e) => ({ v: avgOf(e.rs, f), label: `${e.event} ${e.year}`, short: shortEv(e.event), hot: e === lastEv }));
    const svg = barSvg(items, { note: "By tournament" }); if (!svg) return null;
    const lbl = catLbl(cat);
    return [el("div", { class: "td-kick mute" }, `${lbl[0].toUpperCase()}${lbl.slice(1)} a round, tournament by tournament`), svg];
  }
  const tap = (node, h) => { node.setAttribute("role", "link"); node.tabIndex = 0; node.addEventListener("click", (e) => { if (!e.target.closest("button, a, summary")) h.run(); }); node.addEventListener("keydown", (e) => { if (e.key === "Enter") h.run(); }); return node; };
  const more = (h) => { const [pg, ...rest] = h.to.split(" · "); return el("span", { class: "td-more" }, `${pg}${rest.length ? ` · ${rest.join(" · ")}` : ""} →`); };
  const whoTag = (h) => (staff && h.k ? el("div", { class: "td-who" }, nameOf(h.k)) : null);
  const kicker = (h, d, withWho) => el("div", { class: `td-kick${d.nc === "down" && /Slipping|Rough/.test(d.kick) ? " down" : ""}` }, `${d.kick}${withWho && staff && h.k ? ` · ${nameOf(h.k)}` : ""}`);
  function leadStory(h) {
    const cat = catOf(h), d = dress(h), c = h.k ? ctxOf(h.k, cat) : null, lbl = catLbl(cat);
    const body = [el("p", {}, d.deck)];
    // (update 732) the season line and the chart: the same part of the game as the story, and it says which
    if (c) body.push(el("p", {}, `${cat ? `${CATN[cat]}: ` : ""}${isMe(h.k) ? "you’re" : `${nameOf(h.k)} is`} averaging ${sg2(c.avg)} ${lbl} a round in ${c.yr}${tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : ""}, over ${c.n} round${c.n === 1 ? "" : "s"} (${c.ev} tournament${c.ev === 1 ? "" : "s"}).`.replace(/^./, (m) => m.toUpperCase())));
    const bars = storyBars(h, cat), sp = !bars && c ? spark(c.spark) : null; /* (update 737: bar charts, not "the number") */
    const fig = el("div", { class: "td-fig" }, bars || [el("div", { class: "td-kick mute" }, `${lbl[0].toUpperCase()}${lbl.slice(1)}, round by round (4-round average)`), sp]);
    return tap(el("article", { class: "td-lead" }, [kicker(h, d, true), el("h2", {}, d.hl), el("div", { class: "td-by" }, `By Cal · ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`),
      el("div", { class: "td-leadgrid" }, [el("div", { class: "td-body" }, [...body, more(h)]), fig])]), h);
  }
  const brief = (h) => { const d = dress(h); return tap(el("article", { class: "td-brief" }, [kicker(h, d, false), el("h3", {}, d.hl), el("p", {}, d.num ? `${d.num} ${d.cap}` : d.deck), whoTag(h)]), h); };
  const column = (h) => { const d = dress(h); return tap(el("article", { class: "td-col" }, [kicker(h, d, false), el("h3", {}, d.hl), d.num ? el("div", { class: `td-big ${d.nc}` }, d.num) : null, el("p", {}, d.num ? d.cap : d.deck), d.num && d.deck && !/^(fm|cm)-/.test(h.id) ? el("p", { class: "td-small" }, d.deck) : null, whoTag(h), more(h)]), h); };
  const gearStory = (h) => { const d = dress(h), x = h.x, row = (nm, r, isNew) => el("tr", { class: isNew ? "new" : "" }, [el("td", {}, [nm, isNew ? el("span", { class: "td-note" }, " · new") : null]), el("td", { class: cls(r.v) }, sg2(r.v)), el("td", {}, String(r.n)), el("td", {}, String(r.ev))]);
    return tap(el("article", { class: "td-gear" }, [el("div", { class: "td-kick" }, `${staff ? `${nameOf(h.k)} · ` : ""}${KIND_WORD[x.pill] || "club"}`), el("h3", {}, d.hl),
      el("table", { class: "td-tape" }, [el("thead", {}, el("tr", {}, ["Model", `SG ${COL_IN[x.c]}`, "Rounds", "Events"].map((t2) => el("th", {}, t2)))), el("tbody", {}, [row(x.neu, x.A, true), row(x.old, x.B, false)])]),
      el("p", { class: "td-note" }, `${x.where[0].toUpperCase()}${x.where.slice(1)}, as the product table on Stats counts it.`), more(h)]), h); };
  const rankBox = (items) => { const rows = [];
    for (const h of items) for (const f of h.x?.hits || []) { const bad = f.n && f.r > f.n / 2;
      const tr = el("tr", {}, [el("td", { class: `r${bad ? " down" : ""}` }, String(f.r)), el("td", {}, `${staff ? `${nameOf(h.k)} · ` : ""}${rkName(f.c)[0].toUpperCase()}${rkName(f.c).slice(1)}${f.n ? ` (of ${f.n})` : ""}`), el("td", { class: "v" }, f.v == null ? "" : sg2(f.v))]);
      tr.dataset.r = String(bad ? 1000 + f.r : f.r);
      rows.push(tap(tr, { run: () => toBoard({ year: [h.x.yr], cats: f.c === "TOTAL" ? [] : [f.c] }, "Rankings", EX.lead(`Who leads in ${rkName(f.c)}?`)) })); } /* (update 737: the leaderboard for that part of the game) */
    rows.sort((a, b) => Number(a.dataset.r) - Number(b.dataset.r));
    return el("table", { class: "td-box" }, el("tbody", {}, rows.slice(0, 14))); };
  const wire = (h) => { const d = dress(h); return tap(el("div", { class: "td-wire-i" }, [el("b", {}, d.hl), el("p", {}, d.num ? `${d.num} ${d.cap}` : d.deck)]), h); };
  function drawFeed(items) {
    const seen = new Set(), sorted = items.filter((x) => x && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => b.score - a.score);
    if (!sorted.length) { mount(secNav, []); mount(feed, el("p", { class: "td-wait" }, staff && !keys.length ? "Add players to your favorites (+ above) and their stories will run here every day." : tourPick && tourPick !== ALL ? `Nothing new on the ${tourName(tourPick)} today. Try another tour, or All.` : "Stories will run here once rounds are in.")); return; }
    // the front page: the lead, and the next three (from other sections where there are some)
    const lead = sorted[0], fp = [lead], used = new Set([SEC_OF[lead.kind]]);
    for (const h of sorted.slice(1)) { if (fp.length >= 4) break; if (!used.has(SEC_OF[h.kind])) { fp.push(h); used.add(SEC_OF[h.kind]); } }
    for (const h of sorted.slice(1)) { if (fp.length >= 4) break; if (!fp.includes(h)) fp.push(h); }
    const rest = sorted /* (update 732: front-page stories run in their own section too, so every section shows) */, many = !who && keys.length > 1, secs = [];
    for (const id of ORDER) {
      const mine = rest.filter((h) => SEC_OF[h.kind] === id); if (!mine.length) continue;
      const pick = [], byK = new Map(); // up to 6 (2 a player first, when there are several)
      const cap = id === "tour" ? 9 : 6; /* (update 736: more briefs) */
      for (const h of mine) { if (pick.length >= cap) break; const n = byK.get(h.k || "") || 0; if (many && h.k && n >= 2) continue; pick.push(h); byK.set(h.k || "", n + 1); }
      for (const h of mine) { if (pick.length >= cap) break; if (!pick.includes(h)) pick.push(h); }
      const [title, sub0] = SEC[id], sub = id === "rank" ? `${pick[0].x?.yr || ""} · ${tourPick && tourPick !== ALL ? tourName(tourPick) : "every tour"}` : id === "next" ? next?.name || "" : sub0;
      const content = id === "gear" ? el("div", { class: "td-stack" }, pick.map(gearStory)) : id === "rank" ? rankBox(pick) : id === "tour" ? el("div", { class: "td-wire" }, pick.map(wire)) : el("div", { class: "td-cols" }, pick.map(column));
      secs.push(el("section", { class: `td-sec${FULL.has(id) ? " full" : ""}`, id: `td-${id}` }, [el("div", { class: "td-sh" }, [el("h2", {}, title), sub ? el("span", {}, sub) : null]), content]));
    }
    // (update 735) two half-width sections side by side: left and right worked out in order (a full-width one starts a new
    // row); a half left alone on its row takes the full width
    for (let i = 0, col = 0; i < secs.length; i++) { const x = secs[i]; if (x.classList.contains("full")) { col = 0; continue; }
      if (col === 0) { const nx = secs[i + 1]; if (!nx || nx.classList.contains("full")) { x.classList.add("full"); continue; } x.classList.add("l"); col = 1; } else { x.classList.add("r"); col = 0; } }
    mount(feed, [el("section", { class: "td-front", id: "td-front" }, [leadStory(lead), el("aside", { class: "td-side" }, fp.slice(1).map(brief))]), el("div", { class: "td-grid" }, secs)]);
    const go2 = (id) => { const n = document.getElementById(`td-${id}`); if (!n) return; const bar = document.querySelector(".rail")?.getBoundingClientRect().bottom || 0; /* (the top bar stays put over the page) */ window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - Math.max(0, bar) - 12, behavior: "smooth" }); }; /* (update 734: to the header, clear of the top bar) */
    mount(secNav, [["front", "Front page"], ...secs.map((x) => [x.id.slice(3), SEC[x.id.slice(3)][0]])].map(([id, t2], i) => { const a2 = el("a", { href: "#", class: i ? "" : "on" }, t2); a2.addEventListener("click", (e) => { e.preventDefault(); go2(id); }); return a2; }));
  }
  const cats = ["OTT", "APP", "ARG", "PUTT"], CATN = { OTT: "Off-the-Tee", APP: "Approach", ARG: "Around-the-Green", PUTT: "Putting" };
  const tot = (rd) => rd.shots.reduce((t, s) => t + s.sg, 0), inCat = (rd, c) => rd.shots.filter((s) => s.cat === c).reduce((t, s) => t + s.sg, 0);
  const avgOf = (rs, f) => (rs.length ? rs.reduce((t, r) => t + f(r), 0) / rs.length : null);
  const he = (k) => (isMe(k) ? "you" : firstOf(k)), His = (k) => (isMe(k) ? "Your" : poss(firstOf(k))), his = (k) => (isMe(k) ? "your" : poss(firstOf(k)));
  const eventsOf = (rs) => { const m = new Map(); for (const r of rs) { const kk = `${r.event}|${yrOf(r)}`; (m.get(kk) || m.set(kk, { event: r.event, year: yrOf(r), rs: [] }).get(kk)).rs.push(r); } return [...m.values()].map((e) => ({ ...e, end: e.rs.map((r) => String(r.date)).sort().at(-1), avg: avgOf(e.rs, tot) })).sort((a, b) => a.end.localeCompare(b.end)); };
  // season ranks among the players with enough rounds (the Stats page's default Min. rounds)
  let rankMemo = null;
  const ranksFor = (year) => { if (rankMemo?.year === year && rankMemo.tour === tourPick) return rankMemo;
    const ps = field.map((p) => ({ k: p.key, rs: rawOf(p).filter((r) => yrOf(r) === year) })).filter((p) => p.rs.length); // (update 729: only the players on the tour picked)
    const most = Math.max(0, ...ps.map((p) => p.rs.length)), minR = Math.max(1, Math.floor((most * 0.33) / 5) * 5);
    const ok = ps.filter((p) => p.rs.length >= minR), by = {};
    for (const c of ["TOTAL", ...cats]) { const v = ok.map((p) => [p.k, avgOf(p.rs, c === "TOTAL" ? tot : (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1]); by[c] = new Map(v.map(([k], i) => [k, i + 1])); by[`${c}#`] = v.length; }
    rankMemo = { year, tour: tourPick, by }; return rankMemo; };
  // (update 734) the best round on the tour picked in a season (every player's), to say when a player's best is everyone's
  const tbMemo = new Map();
  const tourBestOf = (yr) => { const kk = `${yr}|${tourPick}`; if (!tbMemo.has(kk)) { let m = -Infinity; for (const p of field) for (const r of rawOf(p)) if (yrOf(r) === yr && !r.eventLevel) { const v = tot(r); if (v > m) m = v; } tbMemo.set(kk, m); } return tbMemo.get(kk); };
  // (update 734) Form, as everywhere on the site: the last 12 rounds against the 12 before; the DP World Tour (or every tour
  // together with some of it): the last 3 events against the 3 before, each event's rounds pooled. Needs both stretches whole.
  const isDP = (t) => /^(dpwt|dp world tour)$/i.test(String(t || "").trim());
  const formSplit = (rs) => { const ev = tourPick && tourPick !== ALL ? isDP(tourPick) : rs.some((r) => isDP(r.tour));
    const u = ev ? eventsOf(rs).map((e) => e.rs) : rs.map((r) => [r]), n = ev ? 3 : 12; if (u.length < 2 * n) return null;
    return { n, lbl: ev ? `${n} events` : `${n} rounds`, last: u.slice(-n).flat(), prev: u.slice(-2 * n, -n).flat() }; };
  function highlightsFor(k) {
    const raw = rawOf(field.find((p) => p.key === k)), out = [], rs = sgRounds(raw); if (!rs.length) return out; // (update 728: Compare's rounds and order)
    const ys = yearsOf(k), last = ys.at(-1), season = rs.filter((r) => yrOf(r) === last), evs = eventsOf(season), sAvg = avgOf(season, tot);
    const ago = (d) => (Date.now() - (Date.parse(String(d).slice(0, 10)) || 0)) / 864e5, recent = (d) => ago(d) <= 21;
    // the last tournament: against the season
    const le = evs.at(-1);
    if (le && evs.length >= 3 && recent(le.end)) { const better = [...evs].sort((a, b) => b.avg - a.avg), pos = better.indexOf(le) + 1, d = le.avg - sAvg;
      const best = pos === 1, worst = pos === evs.length;
      if (best || worst || Math.abs(d) >= 0.6) out.push({ id: `ev-${k}`, k, x: { ev: le.event, v: le.avg, d, best, worst, n: le.rs.length, yr: last }, kind: best ? "Milestone" : worst ? "Slide" : "Result", score: (best || worst ? 8 : 6) + Math.abs(d),
        title: `${le.event}: ${sg2(le.avg)} a round${best ? `, ${isMe(k) ? "your" : "the"} best tournament of ${last}` : worst ? `, the toughest of ${last}` : ""}`,
        detail: `${Math.abs(d).toFixed(2)} ${d >= 0 ? "better" : "worse"} than ${his(k)} ${last} average (${sg2(sAvg)}) · ${le.rs.length} rounds`,
        to: "Stats · Tournaments", run: () => toStats(k, { view2: "full", year: [last], span: 0 }, "Tournaments", null) });
      // the best round of the season, just played
      const bestR = [...season].sort((a, b) => tot(b) - tot(a))[0];
      if (bestR && le.rs.includes(bestR) && season.length >= 8) out.push({ id: `br-${k}`, k, x: { v: tot(bestR), ev: le.event, yr: last, tourBest: tot(bestR) >= tourBestOf(last) - 1e-9 }, kind: "Milestone", score: 8.5, title: `${His(k)} best round of ${last}: ${sg2(tot(bestR))}`, detail: `Round ${bestR.roundNo || ""} at ${le.event}`.replace("Round  ", "A round "), to: "Stats · SG Trends", run: () => toStats(k, { view2: "full", year: [last], span: 0, trendBy: "round" }, "SG Trends", null) }); }
    // gaining strokes round after round
    let streak = 0; for (let i = rs.length - 1; i >= 0 && tot(rs[i]) > 0; i--) streak++;
    if (streak >= 5) out.push({ id: `st-${k}`, k, x: { n: streak, ev: rs[rs.length - streak].event }, kind: "Milestone", score: 6 + streak * 0.2, title: `${streak} rounds in a row gaining strokes`, detail: `${isMe(k) ? "You’ve" : `${firstOf(k)} has`} beaten the tour average every round since ${rs[rs.length - streak].event}`, to: "Stats · Elite stretches", run: () => toStats(k, { view2: "full", year: [], span: 0 }, "Elite Stretches", EX.elite(`When ${isMe(k) ? "do I" : `does ${firstOf(k)}`} play best?`)) });
    // form: the last 12 rounds against the 12 before, and each part of the game
    const fs = formSplit(rs); if (fs) { const a = fs.last, b = fs.prev, d = perRound(a) - perRound(b), FL = fs.lbl; /* (update 734: Form, as everywhere: 12 rounds; the DP World Tour 3 events) */ // (update 728: as Compare's Last 12 rounds and The 12 rounds before that)
      if (Math.abs(d) >= 0.3) out.push({ id: `fm-${k}`, k, x: { d, a: perRound(a), b: perRound(b), FL, n: fs.n }, kind: d > 0 ? "Trend" : "Slide", score: 5 + Math.abs(d) * 2, title: `${His(k)} form is ${d > 0 ? "heating up" : "cooling off"}: ${sg2(d)} a round`, detail: `Last ${FL} ${sg2(perRound(a))} against ${sg2(perRound(b))} in the ${fs.n} before`, to: "Compare · Last 12 vs 12 before", run: () => go(`${cmpBase(k)}&pick=win:12`, EX.cmpWin("What changed over the last 12 rounds?")) });
      const ch = cats.map((c) => [c, perRound(a, c) - perRound(b, c)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      // (update 728) opens Compare (its Verdict shows each part of the game's difference, the same numbers)
      for (const [c, dc] of ch.slice(0, 2)) if (Math.abs(dc) >= 0.2) out.push({ id: `cm-${k}-${c}`, k, x: { c, d: dc, a: perRound(a, c), b: perRound(b, c), FL, n: fs.n }, kind: dc > 0 ? "Trend" : "Slide", score: 4.5 + Math.abs(dc) * 2, title: `${CATN[c]} ${dc > 0 ? "up" : "down"} ${Math.abs(dc).toFixed(2)} a round lately`, detail: `${His(k)} last ${FL} (${sg2(perRound(a, c))}) against the ${fs.n} before (${sg2(perRound(b, c))})`, to: "Compare · Last 12 vs 12 before", run: () => go(`${cmpBase(k)}&pick=win:12`, EX.cmpWin(`${CATN[c]}: what changed?`)) }); }
    // the part of the game costing the most this season
    const weak = cats.map((c) => [c, avgOf(season, (r) => inCat(r, c))]).filter(([, v]) => v != null).sort((x, y) => x[1] - y[1])[0];
    if (weak && weak[1] <= -0.1 && season.length >= 6) out.push({ id: `wk-${k}`, k, x: { c: weak[0], v: weak[1], yr: last }, kind: "Focus", score: 4 + Math.abs(weak[1]) * 2, title: `${CATN[weak[0]]} is costing ${he(k)} ${Math.abs(weak[1]).toFixed(2)} a round`, detail: `${His(k)} weakest part of the game in ${last}: where, and the drills for it`, to: `Stats · Focus · ${CATN[weak[0]]}`, run: () => toStats(k, { view2: "focus", focusCats: [weak[0]], focusPick: weak[0], year: [last], span: 0 }, "Where you stand", EX.cat(`Where is ${CATN[weak[0]].toLowerCase()} costing strokes?`, weak[0])) });
    // (update 737) tour ranks this season. A player's own Home: every rank, good or bad. Everyone else: the good ones (top 10;
    // top 25 in strokes gained overall) and the bad ones (the bottom 10; bottom 25 overall)
    if (last) { const R = ranksFor(last).by, nm = (x) => (x === "TOTAL" ? "strokes gained" : CATN[x].toLowerCase());
      const all = ["TOTAL", ...cats].map((c) => ({ c, r: R[c]?.get(k), n: R[`${c}#`], v: avgOf(season, c === "TOTAL" ? tot : (r0) => inCat(r0, c)) })).filter((x) => x.r && x.n >= 10);
      const lim = (x) => (x.c === "TOTAL" ? 25 : 10), good = all.filter((x) => x.n >= 20 && x.r <= lim(x)).sort((a, b) => a.r - b.r), bad = all.filter((x) => x.n >= 20 && x.r > x.n - lim(x)).sort((a, b) => (b.r / b.n) - (a.r / a.n));
      const where = `in ${last}${tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : ""}`;
      const run = (c) => () => toBoard({ year: [last], cats: c === "TOTAL" ? [] : [c] }, "Rankings", EX.lead(`Who leads in ${nm(c)}?`));
      if (isMe(k) && all.length) { const tp = all[0];
        out.push({ id: `rk-${k}`, k, x: { hits: all, yr: last, all: true }, kind: "Rank", score: 5.5, title: `Your tour ranks ${where}: ${ordN(tp.r)} in strokes gained`,
          detail: all.slice(1).map((x) => `${ordN(x.r)} in ${nm(x.c)}`).join(", ") + ` · of ${tp.n} players with enough rounds`, to: "Leaderboards · Rankings", run: run(tp.c) }); }
      else {
        if (good.length) { const f = good[0]; out.push({ id: `rk-${k}`, k, x: { hits: good, yr: last }, kind: "Rank", score: 5 + (11 - Math.min(10, f.r)) * 0.25 + good.length * 0.2, title: `${ordN(f.r)} on tour in ${nm(f.c)} this season`,
          detail: `${good.length > 1 ? `Also ${good.slice(1).map((x) => `${ordN(x.r)} in ${nm(x.c)}`).join(", ")} · ` : ""}out of ${f.n} players with enough rounds ${where}`, to: "Leaderboards · Rankings", run: run(f.c) }); }
        if (bad.length) { const f = bad[0]; out.push({ id: `rkb-${k}`, k, x: { hits: bad, yr: last, bad: true }, kind: "Rank", score: 4.6 + (f.r / f.n) * 0.5, title: `${ordN(f.r)} of ${f.n} in ${nm(f.c)} this season`,
          detail: `${bad.length > 1 ? `Also ${bad.slice(1).map((x) => `${ordN(x.r)} in ${nm(x.c)}`).join(", ")} · ` : ""}near the bottom of the players with enough rounds ${where}`, to: "Leaderboards · Rankings", run: run(f.c) }); } } }
    return out;
  }
  function highlightsAll() {
    const out = [];
    for (const k of shownKeys()) out.push(...highlightsFor(k));
    // this week's tournament, with its strategy maps (caddies first)
    if (next?.heat) out.push({ id: "next", k: null, kind: "Next event", score: ROLE === "caddy" ? 9 : 5.5, title: `${next.live ? "On now" : "Coming up"}: ${next.name}`, detail: "Cal’s targets for every hole: where to aim off the tee and where to miss the green", to: "Course Prep · Strategy Maps", run: () => toHole(next.heat, 1, EX.course(`How should I play ${next.name}?`)) });
    // the tour (analysts and the admin): the biggest movers over the last 12 rounds
    if (!who) { /* (update 736: everyone, not just analysts and the admin) */
      // (update 734) as Stats' Hot & Cold: Form (the last 12 rounds against the 12 before; the DP World Tour 3 events
      // against 3) over this season's rounds on the tour picked; full names
      const yr0 = field.reduce((m, p) => { for (const r of rawOf(p)) { const y = yrOf(r); if (y > m) m = y; } return m; }, "");
      let FL0 = "12 rounds";
      const mv = field.map((p) => { const rs = sgRounds(rawOf(p)).filter((r) => yrOf(r) === yr0), fs = formSplit(rs); if (!fs) return null; FL0 = fs.lbl;
        const l = perRound(fs.last), b0 = perRound(fs.prev); return l == null || b0 == null ? null : [p.key, l - b0, l, b0]; }).filter(Boolean).sort((a, b) => b[1] - a[1]);
      const where = `${yr0}${tourPick && tourPick !== ALL ? `, ${tourName(tourPick)}` : ""}`;
      const lst = (xs) => xs.map(([k2, d]) => `${nameOf(k2)} ${sg2(d)}`).join(", ");
      if (mv.length >= 4) { const top = mv.filter((m) => m[1] > 0).slice(0, 3), bot = mv.filter((m) => m[1] < 0).slice(-3).reverse();
        if (top.length) out.push({ id: "movers", k: null, x: { top }, kind: "Tour", score: 5, title: `Heating up: ${lst(top)}`, detail: `Strokes gained total a round, the last ${FL0} against the ${FL0.split(" ")[0]} before (${where}), as Hot & Cold on Stats`, to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) });
        if (bot.length) out.push({ id: "fallers", k: null, x: { top: bot }, kind: "Tour", score: 4, title: `Cooling off: ${lst(bot)}`, detail: `Strokes gained total a round, the last ${FL0} against the ${FL0.split(" ")[0]} before (${where}), as Hot & Cold on Stats`, to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) }); }
    }
    if (!who) out.push(...tourBits(), ...courseBits());
    else out.push(...courseBits());
    if (ROLE === "caddy") for (const h of out) if (h.kind === "Rank" || h.kind === "Tour") h.score -= 2; // (a caddy: the course and the form first)
    return out;
  }
  // ---- (update 736) around the tour: this season on the tour picked (as the Stats page counts it) ----
  const toLead = (ex) => () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead(ex));
  function tourBits() {
    const out = [], yr0 = field.reduce((m, p) => { for (const r of rawOf(p)) { const y = yrOf(r); if (y > m) m = y; } return m; }, ""); if (!yr0) return out;
    const on = tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : "", W0 = `${yr0}${on}`;
    const sp = field.map((p) => ({ k: p.key, rs: sgRounds(rawOf(p)).filter((r) => yrOf(r) === yr0) })).filter((p) => p.rs.length);
    const rl = (rs) => rs.filter((r) => !r.eventLevel); // single rounds only (not a whole event in one row)
    const most = Math.max(0, ...sp.map((p) => p.rs.length)), minR = Math.max(1, Math.floor((most * 0.33) / 5) * 5), ok = sp.filter((p) => p.rs.length >= minR);
    const add = (id, score, title, detail) => out.push({ id: `tb-${id}`, k: null, kind: "Tour", score, title, detail, to: "Leaderboards", run: toLead(title) });
    // the round of the year
    let best = null; for (const p of sp) for (const r of rl(p.rs)) { const v = tot(r); if (!best || v > best.v) best = { k: p.k, v, r }; }
    if (best) add("roy", 3.9, `Round of the year: ${nameOf(best.k)}, ${sg2(best.v)}`, `${best.r.event}${best.r.roundNo ? `, round ${best.r.roundNo}` : ""} · the best single round in ${W0}`);
    // the leaders in each part of the game
    if (ok.length >= 10) { const lead = cats.map((c) => { const v = ok.map((p) => [p.k, avgOf(p.rs, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0]; return `${CATN[c]}: ${nameOf(v[0])} ${sg2(v[1])}`; });
      add("kings", 3.8, `Best in each part of the game`, `${lead.join(" · ")} (strokes gained a round, ${W0}, ${minR}+ rounds)`); }
    // the longest run of rounds gaining strokes, still going
    const st = sp.map((p) => { const rs = rl(p.rs); let n = 0; for (let i = rs.length - 1; i >= 0 && tot(rs[i]) > 0; i--) n++; return [p.k, n]; }).sort((a, b) => b[1] - a[1])[0];
    if (st && st[1] >= 4) add("streak", 3.7, `Hottest streak: ${nameOf(st[0])}, ${st[1]} rounds in a row gaining strokes`, `Strokes gained total above zero every round, still going (${W0})`);
    // the steadiest, and the wildest (how much a player's rounds swing)
    const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
    const sw = ok.map((p) => [p.k, sd(rl(p.rs).map(tot)), rl(p.rs).length]).filter((x) => x[2] >= minR).sort((a, b) => a[1] - b[1]);
    if (sw.length >= 10) { add("steady", 3.4, `Mr. Consistent: ${nameOf(sw[0][0])}`, `The smallest round-to-round swing (±${sw[0][1].toFixed(2)} strokes gained) of anyone with ${minR}+ rounds in ${W0}`);
      const wl = sw.at(-1); add("wild", 3.3, `Rollercoaster: ${nameOf(wl[0])}`, `The biggest round-to-round swing (±${wl[1].toFixed(2)} strokes gained) of anyone with ${minR}+ rounds in ${W0}`); }
    // the latest tournament's standout
    let lastEv = null; for (const p of sp) for (const r of p.rs) if (!lastEv || String(r.date) > lastEv.d) lastEv = { d: String(r.date), e: r.event };
    if (lastEv) { const at = sp.map((p) => { const rs = p.rs.filter((r) => r.event === lastEv.e); return rs.length >= 2 ? [p.k, perRound(rs), rs.length] : null; }).filter(Boolean).sort((a, b) => b[1] - a[1]);
      if (at.length >= 5) add("week", 3.6, `Best of the week at ${lastEv.e}: ${nameOf(at[0][0])}, ${sg2(at[0][1])} a round`, `Strokes gained total a round over ${at[0][2]} rounds · next best: ${at.slice(1, 3).map(([k2, v]) => `${nameOf(k2)} ${sg2(v)}`).join(", ")}`); }
    // (update 737) more from the latest tournament: its best round, the best in each part of the game, and who played
    // furthest above their own season
    if (lastEv) { const E = lastEv.e, atE = sp.map((p) => ({ k: p.k, rs: p.rs.filter((r) => r.event === E), all: p.rs })).filter((x) => x.rs.length);
      let br = null; for (const x of atE) for (const r of rl(x.rs)) { const v = tot(r); if (!br || v > br.v) br = { k: x.k, v, r }; }
      if (br) add("ev-round", 3.65, `At ${E}: round of the week, ${nameOf(br.k)} ${sg2(br.v)}`, `${br.r.roundNo ? `Round ${br.r.roundNo}` : "A round"} · strokes gained total`);
      const two = atE.filter((x) => x.rs.length >= 2);
      if (two.length >= 5) { const lead = cats.map((c) => { const v = two.map((x) => [x.k, avgOf(x.rs, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0]; return `${CATN[c]}: ${nameOf(v[0])} ${sg2(v[1])}`; });
        add("ev-kings", 3.62, `At ${E}: the best in each part of the game`, `${lead.join(" · ")} (strokes gained a round)`);
        const above = two.map((x) => { const sAvg = perRound(x.all.filter((r) => r.event !== E)), e = perRound(x.rs); return sAvg == null || e == null ? null : [x.k, e - sAvg, e, sAvg]; }).filter(Boolean).sort((a, b) => b[1] - a[1])[0];
        if (above && above[1] > 0.5) add("ev-above", 3.58, `At ${E}: ${nameOf(above[0])} played ${above[1].toFixed(2)} above their season`, `${sg2(above[2])} a round there, against ${sg2(above[3])} the rest of ${yr0}`); } }
    // the biggest bounce-back: from one round to the next at the same tournament
    let bb = null; for (const p of sp) { const rs = rl(p.rs); for (let i = 1; i < rs.length; i++) if (rs[i].event === rs[i - 1].event) { const d = tot(rs[i]) - tot(rs[i - 1]); if (!bb || d > bb.d) bb = { k: p.k, d, a: tot(rs[i - 1]), b: tot(rs[i]), e: rs[i].event }; } }
    if (bb && bb.d >= 3) add("bounce", 3.5, `Biggest bounce-back: ${nameOf(bb.k)}, ${sg2(bb.a)} to ${sg2(bb.b)}`, `From one round to the next at ${bb.e}, a ${bb.d.toFixed(2)}-stroke turnaround (${W0})`);
    // the ironman
    const iron = [...sp].sort((a, b) => b.rs.length - a.rs.length)[0];
    if (iron && sp.length >= 10) add("iron", 3.0, `Ironman: ${nameOf(iron.k)}, ${iron.rs.length} rounds`, `The most rounds played in ${W0} (${new Set(iron.rs.map((r) => r.event)).size} tournaments)`);
    return out;
  }
  // ---- (update 736) the next tournament: its course, Cal's strategy, and who plays it well. Hard-coded for now (the
  // schedule will come later): The American Express. ----
  let upHoles = null; // (update 737) { id, holes: [{ h, par, yds, toPar }] }: the next course's holes, from its scoring
  async function loadUpCourse() { const U = UPCOMING; await heatP;
    const c = heat?.find((h) => (h.events || []).some((e) => U.re.test(e.name)) && !U.not.test(h.name)) || heat?.find((h) => U.course.test(h.name) && !U.not.test(h.name)); if (!c) return;
    const { heatData } = await import("../courseHeat.js"); const d = await heatData(c).catch(() => null); if (!d?.holes) return;
    const holes = Object.entries(d.holes).map(([h, Hh]) => { const tees = Object.values(Hh.pins || {}).flatMap((P) => (P.rows || []).filter((q) => /tee/i.test(q.lie || ""))); let sw = 0, sv = 0; for (const q of tees) { const w = q.n || 1; sw += w; sv += q.v * w; }
      const par = Hh.par || c.par?.[Number(h) - 1]; return sw && par ? { h: Number(h), par, yds: Hh.yards || c.yards?.[Number(h) - 1] || null, toPar: sv / sw - par } : null; }).filter(Boolean).sort((a, b) => a.h - b.h);
    upHoles = { id: c.id, holes }; drawFeed(collect()); }
  function courseBits() {
    const out = [], U = UPCOMING, isU = (r) => U.re.test(String(r.event || ""));
    const c = heat?.find((h) => (h.events || []).some((e) => U.re.test(e.name)) && !U.not.test(h.name)) || heat?.find((h) => U.course.test(h.name) && !U.not.test(h.name));
    out.push({ id: "up-strat", k: null, kind: "Course", score: ROLE === "caddy" ? 8.8 : 5.2, title: `How to play ${c?.name || U.name}`, detail: c ? `Cal’s targets for every hole: where to aim off the tee and where to miss the green, from every shot the field has hit there` : `Strategy maps and course insights for ${U.name}`,
      to: c ? "Course Prep · Strategy Maps" : "Course Prep", run: () => (c ? toHole(c.id, 1, EX.course(`How should I play ${U.name}?`)) : go("#/course-prep", EX.course(`How should I play ${U.name}?`))) });
    // (update 737) the course's key holes, from the strategy maps' scoring (every shot the field has hit there)
    if (c && upHoles?.id === c.id && upHoles.holes.length >= 9) { const H = upHoles.holes, pm = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`, hn = (x) => `No. ${x.h} (par ${x.par}${x.yds ? `, ${x.yds} yds` : ""})`;
      const hard = [...H].sort((a, b) => b.toPar - a.toPar), easy = [...H].sort((a, b) => a.toPar - b.toPar);
      out.push({ id: "up-hard", k: null, kind: "Course", score: 4.9, title: `The hardest hole at ${c.name}: ${hn(hard[0])}, ${pm(hard[0].toPar)} a round`, detail: `Then No. ${hard[1].h} (${pm(hard[1].toPar)}) and No. ${hard[2].h} (${pm(hard[2].toPar)}) · against par, from every shot the field has hit there`,
        to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, hard[0].h, EX.hole(`How should I play hole ${hard[0].h}?`)) });
      out.push({ id: "up-easy", k: null, kind: "Course", score: 4.8, title: `Birdie chances: ${hn(easy[0])}, ${pm(easy[0].toPar)}`, detail: `Then No. ${easy[1].h} (${pm(easy[1].toPar)}) and No. ${easy[2].h} (${pm(easy[2].toPar)}) · against par, the field's scoring`,
        to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, easy[0].h, EX.hole(`How should I play hole ${easy[0].h}?`)) });
      const byPar = [3, 4, 5].map((pp) => { const xs = H.filter((x) => x.par === pp); return xs.length ? [pp, xs.reduce((t, x) => t + x.toPar, 0) / xs.length, xs.length] : null; }).filter(Boolean), sum = H.reduce((t, x) => t + x.toPar, 0);
      if (byPar.length >= 2) { const bestP = [...byPar].sort((a, b) => a[1] - b[1])[0];
        out.push({ id: "up-pars", k: null, kind: "Course", score: 4.7, title: `Par ${bestP[0]}s are the scoring holes: ${pm(bestP[1])} a hole`, detail: `${byPar.map(([pp, v, n]) => `Par ${pp}s ${pm(v)} (${n})`).join(" · ")} · the course plays ${pm(sum)} against par for the field`,
          to: "Course Prep · Course Insights", run: () => toHole(c.id, 1, EX.course(`How does ${c.name} play?`)) }); } }
    // course form: the best there over the years (on the tour picked)
    const hist = field.map((p) => { const rs = sgRounds(rawOf(p)).filter(isU); return rs.length ? { k: p.key, rs, v: perRound(rs), yrs: new Set(rs.map(yrOf)).size } : null; }).filter(Boolean);
    const horses = hist.filter((x) => x.rs.length >= 8).sort((a, b) => b.v - a.v).slice(0, 3);
    if (horses.length >= 2) out.push({ id: "up-horses", k: null, kind: "Course", score: 4.4, title: `Horses for courses at ${U.name}`, detail: horses.map((x) => `${nameOf(x.k)} ${sg2(x.v)} a round (${x.rs.length} rounds, ${x.yrs} year${x.yrs === 1 ? "" : "s"})`).join(" · "),
      to: "Leaderboards", run: toLead(`Who plays ${U.name} best?`) });
    // the players picked: their own record there
    for (const k of shownKeys().slice(0, 4)) { const x = hist.find((h) => h.k === k); if (!x) continue;
      const byYr = new Map(); for (const r of x.rs) { const y = yrOf(r); (byYr.get(y) || byYr.set(y, []).get(y)).push(r); }
      const bestY = [...byYr].map(([y, rs]) => [y, perRound(rs)]).sort((a, b) => b[1] - a[1])[0], evNames = [...new Set(x.rs.map((r) => r.event))];
      out.push({ id: `up-me-${k}`, k, kind: "Course", score: 4.5 + Math.max(0, x.v) * 0.3, x: { v: x.v }, title: `${isMe(k) ? "Your" : poss(nameOf(k))} record at ${U.name}: ${sg2(x.v)} a round`, detail: `${x.rs.length} rounds over ${x.yrs} year${x.yrs === 1 ? "" : "s"}${bestY && byYr.size > 1 ? ` · best in ${bestY[0]} (${sg2(bestY[1])} a round)` : ""} · strokes gained total`,
        to: "Stats · Tournaments", run: () => toStats(k, { view2: "full", year: [], span: 0, event: evNames }, "Tournaments", null) }); }
    return out;
  }
  // equipment: a club switched in the last few tournaments. (update 729) Each model's number is the one in the SG Trends by
  // Product table on Stats (every round on the tour picked, all years): strokes gained in that club's part of the game with
  // that model's shots, over the rounds it was used in (a ball: every part of the game); with the rounds and tournaments.
  const gearData = new Map(), gearP = new Map(); // k → that player's own rounds (with the clubs)
  const loadGear = (k) => gearP.get(k) || gearP.set(k, (async () => { const { loadSource } = await import("../reportGen.js");
    // (update 731) the player's own rounds only (not the whole field again), kept for the visit
    if (!HINTS.has(k)) { const d = await loadSource("tour", k, nameOf(k), { detail: false, field: false }).catch(() => null); HINTS.set(k, (d?.me?.rounds || []).filter((r) => r.shots?.length)); while (HINTS.size > 8) HINTS.delete(HINTS.keys().next().value); }
    gearData.set(k, HINTS.get(k)); })().catch(() => gearData.set(k, []))).get(k);
  const PROD_COL = { Driver: "OTT", "Non-Driver": "OTT", Irons: "APP", Wedges: "ARG", Putters: "PUTT", Balls: null };
  const COL_IN = { OTT: "off the tee", APP: "on approach", ARG: "around the green", PUTT: "putting", null: "in total" };
  function gearHighlights(k) {
    const rs = (gearData.get(k) || []).filter(onTour).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); if (!rs.length) return [];
    const evs = eventsOf(rs).slice(-16), out = [], plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    for (const pill of ["Driver", "Putters", "Irons", "Wedges", "Non-Driver", "Balls"]) {
      const val = (s) => (pill === "Balls" ? (s.ball ? `Ball|${s.ball}` : null) : s.gear && KIND_PILL[gearInfo(s.gear).kind] === pill ? s.gear : null);
      const top = evs.map((e) => { const m = new Map(); for (const r of e.rs) for (const s of r.shots) { const v = val(s); if (v) m.set(v, (m.get(v) || 0) + (s.w || 1)); } return [...m].sort((x, y) => y[1] - x[1])[0]?.[0] || null; });
      const i = top.length - 1; if (!top[i]) continue;
      let j = i; while (j > 0 && (top[j - 1] === top[i] || !top[j - 1])) j--; // the first tournament with the new one
      if (j === 0 || i - j > 5 || !top[j - 1]) continue;
      const neu = top[i], old = top[j - 1], c = PROD_COL[pill], nm = (g) => { const gi = gearInfo(g); return `${gi.brand} ${gi.model}`.trim() || g; };
      // as the product table: the rounds with any shot with the model; its shots' strokes gained in the column's part of the game ÷ those rounds
      const row = (g) => { const rds = rs.filter((rd) => rd.shots.some((s) => val(s) === g)); if (!rds.length) return null;
        return { v: rds.reduce((t, rd) => t + rd.shots.reduce((u, s) => u + (val(s) === g && (!c || s.cat === c) ? s.sg : 0), 0), 0) / rds.length, n: rds.length, ev: new Set(rds.map((r) => `${r.event}|${yrOf(r)}`)).size }; };
      const A = row(neu), B = row(old); if (!A || !B) continue;
      const dd = A.v - B.v, where = tourPick && tourPick !== ALL ? `every ${tourName(tourPick)} round` : "every round on every tour";
      out.push({ id: `eq-${k}-${pill}`, k, x: { pill, neu: nm(neu), old: nm(old), A, B, c, dd, where }, kind: "Equipment", score: 7 + Math.abs(dd) * 2, title: `New ${KIND_WORD[pill] || "club"}: ${nm(neu)}, ${sg2(dd)} a round ${COL_IN[c]}`,
        detail: `${sg2(A.v)} a round over ${plural(A.n, "round")} (${plural(A.ev, "tournament")}) with it, against ${sg2(B.v)} over ${plural(B.n, "round")} (${plural(B.ev, "tournament")}) with the ${nm(old)} · ${where}, as the product table on Stats counts it`,
        to: "Stats · SG Trends by Product", run: () => toStats(k, { view2: "full", productKind: pill, year: [], span: 0, cats: [] }, "SG Trends by Product", EX.product(`How is the new ${KIND_WORD[pill] || "club"} working?`, pill)) });
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
  // ---- (update 729) the tour and player pills at the top ----
  let favs = [], practice = [], gen = 0;
  const pill = (on, label, fn, cls = "") => { const b = el("button", { type: "button", class: `hl-pill${on ? " on" : ""}${cls}`, "aria-pressed": String(!!on) }, label); b.addEventListener("click", fn); return b; };
  function drawPills() {
    const cnt = new Map(), src = keys.length ? field.filter((p) => keys.includes(p.key)) : field;
    for (const p of src) for (const rd of p.rounds) cnt.set(tourOf(rd), (cnt.get(tourOf(rd)) || 0) + 1);
    const tours = [...cnt].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    if (tourPick !== ALL && !tours.includes(tourPick)) { tourPick = tours[0] ?? null; tmemo.clear(); }
    const showTours = tours.length > 1;
    mount(tourRow, showTours ? [el("span", { class: "hl-pl" }, "Tour"), ...tours.map((t) => pill(tourPick === t, tourName(t), () => setTour(t))), pill(tourPick === ALL, "All", () => setTour(ALL))] : []);
    tourRow.hidden = !showTours;
    edition.textContent = tourPick ? `${tourName(tourPick)} Edition` : ""; nextLine.textContent = next ? `${next.name} · ${next.live ? "on now" : "coming up"}` : ""; nextLine.classList.toggle("on", !!next?.live); /* (update 735: glows while it's live) */
    if (!staff) { whoRow.hidden = true; return; }
    const fav = favs.filter((k) => keys.includes(k) && playsTour(k)); // (update 730: only the players on the tour picked)
    if (who && !playsTour(who)) who = null;
    const add = el("button", { type: "button", class: "hl-pill hl-add", "aria-label": "Add a favorite player" }, "+");
    add.addEventListener("click", addFav);
    mount(whoRow, [el("span", { class: "hl-pl" }, "Players"), pill(!who, staff && team.isTeam ? "All my players" : "All favorites", () => setWho(null)), ...fav.map((k) => { const b = pill(who === k, nameOf(k), () => setWho(who === k ? null : k));
      // (update 734) the picked favorite has an × to take them off the list
      if (who === k) { const x = el("span", { class: "hl-x", role: "button", tabindex: "0", "aria-label": `Remove ${nameOf(k)} from favorites`, title: "Remove from favorites" }, "×");
        const rm = (e) => { e.stopPropagation(); removeFav(k); }; x.addEventListener("click", rm); x.addEventListener("keydown", (e) => { if (e.key === "Enter") rm(e); }); b.append(x); }
      return b; }), add]);
    whoRow.hidden = false;
  }
  const playsTour = (k) => !tourPick || tourPick === ALL || !field.length || (field.find((p) => p.key === k)?.rounds || []).some((rd) => tourOf(rd) === tourPick);
  const shownKeys = () => (who ? [who] : keys.filter(playsTour));
  const setTour = (t) => { if (tourPick === t) return; tourPick = t; tmemo.clear(); rankMemo = null; refresh(); }; // (tbMemo is keyed by tour)
  const setWho = (k) => { who = k; if (k) { focus = k; drawTabs(); } refresh(); };
  async function removeFav(k) {
    try { const wl = await import("../watchlist.js"); await wl.saveWatch({ players: (wl.watchPrefs().players || []).filter((x) => x !== k) }); } catch (e) { console.error(e); alert("Couldn’t update your favorites just now."); return; }
    favs = favs.filter((x) => x !== k); if (admin) keys = keys.filter((x) => x !== k); who = null; refresh();
  }
  async function addFav() {
    const ks = await playersList(); const opts = ks.filter((k) => !favs.includes(k) && playsTour(k)).map((k) => ({ value: k, label: nameOf(k) })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    if (!opts.length) { alert(tourPick && tourPick !== ALL ? `Every ${tourName(tourPick)} player you can see is already a favorite.` : "Every player you can see is already a favorite."); return; }
    const k = await sheet({ q: "Add a favorite", title: tourPick && tourPick !== ALL ? `Which ${tourName(tourPick)} player?` : "Which player?", options: opts, search: true }); if (!k) return;
    try { const wl = await import("../watchlist.js"); await wl.saveWatch({ players: [...(wl.watchPrefs().players || []), k] }); } catch (e) { console.error(e); alert("Couldn’t save that favorite just now."); return; }
    favs = [...favs, k]; if (!keys.includes(k)) keys = [...keys, k]; who = k; refresh();
  }
  const collect = () => { const shown = shownKeys().slice(0, selfKey ? 1 : GEARN);
    return [...highlightsAll(), ...shown.flatMap((k) => (gearData.has(k) ? gearHighlights(k) : [])), ...practice]; };
  async function refresh() {
    const my = ++gen; drawPills(); drawFeed(collect());
    for (const k of shownKeys().slice(0, selfKey ? 1 : GEARN)) { if (gearData.has(k)) continue; await loadGear(k); if (my !== gen) return; drawFeed(collect()); }
  }
  // (the data, once everything above is defined)
  // (the data, once everything above is defined)
  if (window.__homeTest) Object.assign(window.__homeTest, { setField: (f) => { field = f; tmemo.clear(); rankMemo = null; }, setKeys: (k) => { keys = k; }, setFavs: (f) => { favs = f; }, setGear: (k, rs) => { gearData.set(k, rs); gearP.set(k, Promise.resolve()); }, setTour, setWho, draw: () => { drawPills(); drawFeed(collect()); }, state: () => ({ tourPick, who }) }); // (tests only)
  try {
    if (selfKey) keys = [selfKey];
    else {
      if (admin) await playersList();
      let fav = []; try { const wl = await import("../watchlist.js"); await wl.loadWatch(true).catch(() => {}); fav = wl.watchPrefs().players || []; } catch { /* */ }
      favs = admin ? fav : fav.filter((k) => teamKeys.includes(k));
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
    await nextP; await heatP; /* (update 736: the courses, for Course Insights & Strategy) */
    refresh();
    loadUpCourse().catch(() => {}); /* (update 737) */
    if (selfKey) { practice = await practiceHighlights(selfKey).catch(() => []); if (practice.length) drawFeed(collect()); }
  } catch (err) { console.error(err); mount(feed, el("p", { class: "muted small" }, "Couldn’t put the highlights together just now.")); }
}
