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
import { detectColumns, isShotData, summaryPlayers, gearInfo, STAT_DEFS } from "../sg.js";
import { queueExplain } from "../askExplain.js";
import { sgRounds, roundsFor, perRound } from "../compareData.js";
import { goOf } from "../strategy.js"; // (update 747)
import { clientKey } from "../data.js";
import { expectModel, shotSG } from "../courseExp.js"; // (update 761: expected strokes from the course's own holes) // (update 760: a course's player ids to the players' keys)
import { scatterSvg, radarSvg, pairBars, proxScatter, bar0 } from "../miniCharts.js"; // (update 750) // (update 728: the rounds and numbers exactly as Compare counts them)

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
  // (update 742) staff's own game: the rounds they enter for themselves (Enter New Round, with their WITB) under their own key
  // (the admin: "a_<uid>", as Enter New Round saves them); "Me" at the top, written as "you"
  const ownKey = !selfKey && state.user?.uid ? (state.isAdmin && !state.profile?.clientKey ? `a_${state.user.uid}` : state.profile?.clientKey || null) : null;
  const isMe = (k) => (!!selfKey && k === selfKey) || (!!ownKey && k === ownKey);
  const poss = (n) => `${n}’${/s$/i.test(n) ? "" : "s"}`; // (update 727: "Blades’", "Sam’s")
  const W = (k) => (isMe(k) ? { I: "I", my: "my", me: "me", am: "am I", do: "do I", have: "have I", s: "" } : { I: firstOf(k), my: poss(firstOf(k)), me: firstOf(k), am: `is ${firstOf(k)}`, do: `does ${firstOf(k)}`, have: `has ${firstOf(k)}`, s: "s" });

  // ---- where a question goes ----
  const statsHref = (k) => (ownKey && k === ownKey ? `#/view-as/${encodeURIComponent(k)}?label=${encodeURIComponent(myName || "Me")}&to=/dashboard` /* (update 742: your own rounds) */ : isMe(k) || (!admin && !team.isTeam) ? "#/dashboard" : admin ? `#/admin/player-stats?player=${encodeURIComponent(k)}` : `#/view-as/${encodeURIComponent(k)}?label=${encodeURIComponent(nameOf(k))}&to=/dashboard`);
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
  let field = [], years = [], heat = null, next = null, ownP = null, dsRef = null, detail = null; // (update 749) detail: { tour, by: Map(key → rounds with each shot's distance and lie) } // (update 742) ownP: { key, rounds, own }: the signed-in person's own entered rounds
  const playerOf = (k) => (ownP && k === ownP.key ? ownP : field.find((p) => p.key === k));
  const heatP = import("../courseHeat.js").then((m) => m.listHeatCourses()).then((l) => (heat = (l || []).filter((c) => c.par?.length))).catch(() => (heat = []));
  const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  // (update 729) the tour picked at the top: everything (highlights, ranks, the pages they open) on that tour's rounds only;
  // "All" (picked by hand) every tour together. null until the data's in, then the tour the players have the most rounds on.
  const ALL = "__all";
  let tourPick = null; const picked = new Set(); // (update 740) the players picked at the top (none: all of them); several at once
  const tourOf = (rd) => rd.tour || "", onTour = (rd) => !tourPick || tourPick === ALL || tourOf(rd) === tourPick;
  const tourName = (t) => (t === ALL ? "All tours" : t || "No tour");
  const tmemo = new Map();
  // (update 738) Home is about this season: the latest season on the tour picked (course history the only exception)
  let syMemo = null;
  const seasonYr = () => { const kk = `${tourPick}|${field.length}`; if (syMemo?.k === kk) return syMemo.y; let m = ""; for (const p of field) for (const r of rawOf(p)) { const y = yrOf(r); if (y > m) m = y; } syMemo = { k: kk, y: m }; return m; };
  const rawOf = (p) => { if (!p) return []; if (p.own) return p.rounds; /* (update 742: their own rounds: every one) */ const kk = `${p.key}|${tourPick}`; let r = tmemo.get(kk); if (!r || r.src !== p.rounds) { r = { src: p.rounds, v: p.rounds.filter(onTour) }; tmemo.set(kk, r); } return r.v; };
  const roundsOf = (k) => rawOf(playerOf(k)).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
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
    el("header", { class: "td-mast" }, el("h1", {}, ["The Tour ", el("i", {}, "Report")])), /* (update 750: was "The Daily Tour") */
    el("div", { class: "td-date" }, [el("span", {}, today), edition, nextLine]),
    el("div", { class: "td-nav" }, [tourRow, whoRow, askBox]),
    secNav, feed, asked,
    el("div", { class: "td-foot" }, "The Tour Report · compiled by Cal from every shot on record · tap any story to dig deeper"),
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
    rank: ["Rankings", ""], fact: ["Did You Know?", ""], spot: ["Player Spotlight", "Strengths, steadiness and what drives the good weeks"], focus: ["Where to Improve", "The biggest leak, and the fix"], next: ["This Week", ""], prac: ["Practice", "On the range"], tour: ["Around the Tour", "Briefs"], course: ["Course Strategy", `Up next: ${UPCOMING.name}`] };
  const SEC_OF = { Result: "res", Milestone: "res", Trend: "form", Slide: "form", Rank: "rank", Equipment: "gear", Focus: "focus", "Next event": "next", Practice: "prac", Tour: "tour", Course: "course", Spotlight: "spot", Fact: "fact" };
  const ORDER = ROLE === "caddy" ? ["next", "course", "fact", "form", "res", "spot", "focus", "gear", "rank", "prac", "tour"] : ["fact", "form", "spot", "gear", "rank", "res", "focus", "next", "course", "prac", "tour"];
  const FULL = new Set(["form", "tour", "course", "fact"]);
  const CATW = { OTT: "driving", APP: "approach play", ARG: "short game", PUTT: "putting" };
  const ordN = (r) => (r === 1 ? "No. 1" : `${r}${["th", "st", "nd", "rd"][((r % 100) - 20) % 10] || ["th", "st", "nd", "rd"][r % 100] || "th"}`);
  const rkName = (c) => (c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase());
  const sur = (k) => { const w = String(nameOf(k)).split(/\s+/).filter((x) => x && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); return w.at(-1) || nameOf(k); };
  const cls = (v) => (v > 0.005 ? "up" : v < -0.005 ? "down" : "");
  // headline, number and the kicker over it, for each kind of highlight (a player's own Home: the card's own wording)
  function dress(h) {
    const k = h.k, x = h.x || {}, S = k ? sur(k) : "", me = k && isMe(k), t = h.id.split("-")[0];
    const o = { kick: h.kick ?? (h.kind === "Course" ? "" : h.kind), hl: h.title, /* (update 745: no "Course" over the course cards) */ deck: h.detail || "", num: null, nc: "", cap: "" };
    if (t === "ev") { o.kick = x.best ? "Milestone" : x.worst ? "Rough week" : "Result"; o.hl = me ? h.title : x.best ? `${poss(S)} best week of ${x.yr}, at ${x.ev}` : x.worst ? `A tough week for ${S} at ${x.ev}` : x.d > 0 ? `${S} beats the ${x.yr} average at ${x.ev}` : `${S} slips below the ${x.yr} average at ${x.ev}`; o.num = sg2(x.v); o.nc = cls(x.v); o.cap = `strokes gained total a round, over ${x.n} rounds there`; }
    else if (t === "br") { const on = tourPick && tourPick !== ALL ? `the ${tourName(tourPick)}` : "tour"; o.kick = x.tourBest ? "Best on tour" : "Personal best"; o.hl = x.tourBest ? `${me ? "You" : S} fired the best round on ${on} in ${x.yr}` : me ? h.title : `${poss(S)} best round of ${x.yr}`; o.num = sg2(x.v); o.nc = cls(x.v); o.cap = `strokes gained total, at ${x.ev}${x.tourBest ? "" : ` (${me ? "your" : poss(S)} best this season; not the tour’s best)`}`; }
    else if (t === "st") { o.hl = me ? h.title : `${S} stretches the streak to ${x.n} rounds in the black`; o.num = String(x.n); o.nc = "up"; o.cap = "rounds in a row with strokes gained total above zero"; }
    else if (t === "fm") { o.kick = x.d > 0 ? "Trending up" : "Slipping"; o.hl = me ? h.title : x.d > 0 ? `${S} is heating up` : `${S} is cooling off`; o.num = sg2(x.d); o.nc = cls(x.d); o.cap = `strokes gained total a round: ${sg2(x.a)} in the last ${x.FL}, ${sg2(x.b)} in the ${x.n} before`; }
    else if (t === "cm") { o.kick = x.d > 0 ? "Trending up" : "Slipping"; o.hl = me ? h.title : x.d > 0 ? `${poss(S)} ${CATW[x.c]} is on the rise` : `${poss(S)} ${CATW[x.c]} slips`; o.num = sg2(x.d); o.nc = cls(x.d); o.cap = `strokes gained a round ${CAT_IN[x.c]}: ${sg2(x.a)} lately, from ${sg2(x.b)}`; }
    else if (t === "wk") { o.kick = CATN[x.c]; o.hl = `${CATN[x.c]} is costing ${me ? "you" : S}`; /* (update 738: the number below, not in the headline) */ o.num = sg2(x.v); o.nc = "down"; o.cap = `strokes a round ${CAT_IN[x.c]} in ${x.yr}`; }
    else if (t === "rkb") { const f = x.hits?.[0]; o.kick = "Room to climb"; o.nc = "down"; if (f) { o.hl = `${S} ${ordN(f.r)} of ${f.n} in ${rkName(f.c)}`; o.num = ordN(f.r).replace("No. ", ""); o.cap = `of ${f.n} players in ${x.yr}`; } }
    else if (t === "rk") { const f = x.hits?.[0]; if (f) { o.hl = me ? h.title : `${S} ${ordN(f.r)} on tour in ${rkName(f.c)}`; o.num = ordN(f.r).replace("No. ", ""); o.cap = `of ${f.n} players in ${x.yr}`; } }
    else if (t === "eq") { o.kick = `New ${KIND_WORD[x.pill] || "club"}`; o.hl = x.first ? `The ${x.neu} ${x.dd >= 0 ? "outperforms" : "underperforms"} in ${me ? "your" : `${poss(S)}`} first event with it in the bag` : `The ${x.neu} is ${x.dd >= 0 ? "beating" : "trailing"} the ${x.old} ${me ? "for you" : `for ${S}`}, clearly enough to count`; /* (update 760: one event said as one event) */ /* (update 735: whose) */ o.num = sg2(x.dd); o.nc = cls(x.dd); o.cap = `strokes gained a round ${COL_IN[x.c]}, against the ${x.old}`; }
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
  const ctxOf = (k, c) => { const p = playerOf(k), rs = sgRounds(rawOf(p)).filter((r) => yrOf(r) === seasonYr()); if (!rs.length) return null; const yr = seasonYr(), se = rs, f = c ? (r) => inCat(r, c) : tot;
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
    const W = 320, H = 176, top = 8, bot = 70, /* (update 738: room for a label under every bar) */ vs = items.map((x) => x.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y0 = top + hi * sc, LP = 46, bw = (W - LP) / items.length; /* (update 738: room on the left for the first labels) */
    const svg = mk0("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "td-bars", role: "img", "aria-label": note || "Bar chart" });
    items.forEach((x, i) => { const h = Math.max(1.5, Math.abs(x.v) * sc), yy = x.v >= 0 ? y0 - h : y0;
      const r = bar0(mk0, { x: (LP + i * bw + bw * 0.14).toFixed(1), y: yy.toFixed(1), width: (bw * 0.72).toFixed(1), height: h.toFixed(1), rx: 2, class: `td-bar ${x.cls || (x.v >= 0 ? "up" : "down")}${x.hot ? " hot" : ""}` }, x.v >= 0);
      r.append(mk0("title", {}, `${x.label}: ${sg2(x.v)}`)); svg.append(r); });
    svg.append(mk0("line", { x1: LP, x2: W, y1: y0.toFixed(1), y2: y0.toFixed(1), class: "td-zero" }));
    // (update 738) each bar's tournament under it, angled (the latest in full color)
    const base = H - bot + 10;
    items.forEach((x, i) => { const cx = LP + i * bw + bw / 2; svg.append(mk0("text", { x: cx.toFixed(1), y: base, transform: `rotate(-45 ${cx.toFixed(1)} ${base})`, "text-anchor": "end", class: `td-tx${x.hot ? " hot" : ""}` }, x.short)); });
    return svg; }
  // (update 761) a tournament's name in full (just the sponsor dropped), where there's room for it: cards, tiles
  const fullEv = (e) => String(e || "").replace(/^the\s+/i, "").replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/i, "").trim();
  const shortEv = (e) => { const t = String(e || "").replace(/^the\s+/i, "").replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/i, "").replace(/\bChampionship\b/i, "Champ.").replace(/\bInvitational\b/i, "Inv.").replace(/\bTournament\b/i, "Tourn.").replace(/\bInternational\b/i, "Intl.").trim(); return t.length > 15 ? `${t.slice(0, 14).trimEnd()}…` : t; };
  function storyBars(h, cat) {
    const t = h.id.split("-")[0];
    if (t === "eq" && h.k && gearData.has(h.k)) { // the player's own rounds, by tournament: that kind of club's shots, by model
      const x = h.x, val = (s0) => (x.pill === "Balls" ? (s0.ball ? `Ball|${s0.ball}` : null) : s0.gear && KIND_PILL[gearInfo(s0.gear).kind] === x.pill ? s0.gear : null); /* (update 743: only that kind of club, so the model is the one the story is about) */
      const nmOf = (g) => { const gi = gearInfo(g); return `${gi.brand} ${gi.model}`.trim() || g; };
      const rs = (gearData.get(h.k) || []).filter((r) => (ownP?.key === h.k || onTour(r)) && yrOf(r) === seasonYr()); const evs = eventsOf(rs).slice(-14);
      const items = evs.map((e) => { const m = new Map(); let sgs = 0, n = 0; for (const r of e.rs) { let any = false; for (const s0 of r.shots) { const g = val(s0); if (!g) continue; const nm2 = nmOf(g); if (nm2 !== x.neu && nm2 !== x.old && x.pill !== "Balls") { /* another model */ } m.set(nm2, (m.get(nm2) || 0) + (s0.w || 1)); any = true; if (!x.c || s0.cat === x.c) sgs += s0.sg; } if (any) n++; } /* (that kind of club's shots only, as the product table) */
        const topM = [...m].sort((a2, b2) => b2[1] - a2[1])[0]?.[0]; return n ? { v: sgs / n, label: `${e.event} ${e.year} · ${topM || ""}`, short: shortEv(e.event), cls: topM === x.neu ? "m-a" : topM === x.old ? "m-b" : "m-o" } : null; }).filter(Boolean);
      const svg = barSvg(items, { note: "By tournament" }); if (!svg) return null;
      return [el("div", { class: "td-kick mute" }, `Strokes gained a round ${COL_IN[x.c]}, tournament by tournament`), svg, el("div", { class: "td-legend" }, [el("span", { class: "m-a" }, x.neu), el("span", { class: "m-b" }, x.old)]) /* (update 757: the bars' own colors) */];
    }
    if (!h.k) return null;
    const p = playerOf(h.k), rs = sgRounds(rawOf(p)).filter((r) => yrOf(r) === seasonYr()); if (!rs.length) return null;
    const f = cat ? (r) => inCat(r, cat) : tot, evs = eventsOf(rs).slice(-14), lastEv = evs.at(-1);
    const items = evs.map((e) => ({ v: avgOf(e.rs, f), label: `${e.event} ${e.year}`, short: shortEv(e.event), hot: e === lastEv }));
    const svg = barSvg(items, { note: "By tournament" }); if (!svg) return null;
    const lbl = catLbl(cat);
    return [el("div", { class: "td-kick mute" }, `${lbl[0].toUpperCase()}${lbl.slice(1)} a round, tournament by tournament`), svg];
  }
  // (update 751) a tap opens the story in a pop-up, here on Home: its headline and detail, its chart, and what's behind it
  // (a ranking: the whole leaderboard; form: every part of the game, before and after; a hole: its picture). The page it
  // came from is still a tap away at the bottom
  const tap = (node, h) => { node.setAttribute("role", "button"); node.tabIndex = 0; node.addEventListener("click", (e) => { if (!e.target.closest("button, a, summary")) openPop(h); }); node.addEventListener("keydown", (e) => { if (e.key === "Enter") openPop(h); }); return node; };
  const boardRows = (b) => { if (b.rows) return b.rows; const F = seasonField(); const win = (rs) => (b.win === "l12" ? rs.filter((r) => !r.eventLevel).slice(-12) : rs);
    if (b.c) { const f = b.c === "TOTAL" ? tot : (r) => inCat(r, b.c); return F.ok.map((p) => { const v = avgOf(win(p.rs), f); return v == null ? null : [p.k, v, `${sg2(v)} a round`]; }).filter(Boolean).sort((a, c2) => c2[1] - a[1]); }
    if (b.key && STAT_DEFS[b.key]) { const def = STAT_DEFS[b.key]; return F.ok.map((p) => { const v = obsAvg(win(p.rs), b.key); return v == null ? null : [p.k, v, fmtStat(def, v)]; }).filter(Boolean).sort((a, c2) => (def.higher ? c2[1] - a[1] : a[1] - c2[1])); }
    return []; };
  const boardTitle = (b) => b.title || (b.c ? `${b.c === "TOTAL" ? "Strokes gained" : `Strokes gained ${CAT_IN[b.c]}`} a round${b.win === "l12" ? ", the last 12 rounds" : `, ${seasonYr()}`}` : b.key ? `${STAT_DEFS[b.key]?.label || b.key}, ${seasonYr()}` : "");
  function boardTable(b) { const rows = boardRows(b); if (!rows.length) return null; const shown = new Set(shownKeys());
    return el("div", { class: "td-pop-board" }, [el("p", { class: "td-kick mute" }, `${boardTitle(b)}${tourPick && tourPick !== ALL ? ` · ${tourName(tourPick)}` : ""} · ${rows.length} players`),
      el("div", { class: "td-pop-scroll" }, el("table", { class: "td-box" }, el("tbody", {}, rows.map(([k2, , txt], i) => el("tr", { class: [shown.has(k2) ? "me" : null, k2 === b.focus ? "target" : null].filter(Boolean).join(" ") || null }, [el("td", { class: `r${i < 20 ? " up" : i >= rows.length - 10 ? " down" : ""}` }, String(i + 1)), el("td", {}, nameOf(k2)), el("td", { class: "v" }, txt)])))))]); }
  function formTable(x) { return el("table", { class: "td-tape" }, [el("thead", {}, el("tr", {}, ["", `The ${x.n} before`, `Last ${x.FL}`, "Change"].map((t2) => el("th", {}, t2)))),
    el("tbody", {}, cats.map((c0, i) => { const a = x.rb[i], b = x.ra[i]; return el("tr", {}, [el("td", {}, CATN[c0]), el("td", {}, sg2(a)), el("td", {}, sg2(b)), el("td", { class: cls(b - a) }, sg2(b - a))]); }))]); }
  // (update 761) How to find it yourself: every highlight with the page, the filters and where to look, so it can be found
  // again (and others like it). The pop-up shows the steps, and its button opens that page with those filters already set,
  // the steps shown again there. { steps: [text], run?: a run that sets the filters }
  function howOf(h) {
    const x = h.x || {}, t = h.id.split("-")[0], k = h.k, SY = seasonYr(), tourT = tourPick && tourPick !== ALL ? tourName(tourPick) : "All tours";
    const who = k ? nameOf(k) : "", cN = (c) => (c && c !== "TOTAL" ? CATN[c] : "All categories (SG: Total)");
    const stats = (more) => [`Open Stats${who ? ` with ${who} picked` : ""} (Full stats at the top).`, `Filters: Season ${SY} · Tour ${tourT}${more ? ` · ${more}` : ""}.`];
    const board = (c, more) => [`Open Leaderboards.`, `Filters: Season ${SY} · Tour ${tourT} · Part of the game: ${cN(c)}${more ? ` · ${more}` : ""}.`, who ? `Find ${who} in the Rankings table (the rank is their row).` : "The Rankings table is the leaderboard."];
    const sp = h.id.startsWith("sp-") ? h.id.split("-")[1] : null;
    if (sp === "drives") return { steps: [...stats("Strokes Gained · All categories"), "Scroll to Best & worst tournaments: every tournament best to worst, each part of the game beside it.", "The bottom rows average the best 3 and the worst 3; the highlighted Difference is what drives the good weeks."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [] }, "Best & worst tournaments", null) };
    if (sp === "steady") return { steps: [...stats("Strokes Gained"), `Scroll to Ability vs Consistency and pick the ${cN(x.c)} tab.`, "Across: strokes gained a round. Up: how much the rounds swing (lower is steadier). The rank is how many players swing less."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], steadyCat: x.c || "TOTAL" }, "Ability vs Consistency", null) };
    if (sp === "weapon" || sp === "gap" || t === "rk" || t === "rkb") { const c = sp ? x.c : x.hits?.[0]?.c; return { steps: board(c), run: () => toBoard({ year: [SY], cats: c && c !== "TOTAL" ? [c] : [] }, "Rankings", null) }; }
    if (sp === "stat") return { steps: [...board(null), "Change Stat Type at the top to the stat named in the story, then find the player's row."] };
    if (sp === "yoy") return { steps: [`Open Compare${who ? ` with ${who}` : ""}.`, `Pick Seasons: ${Number(SY) - 1} and ${SY}.`, "The Verdict lists each part of the game for both seasons; the biggest change is the story."] };
    if (t === "fm" || t === "cm") return { steps: [`Open Compare${who ? ` with ${who}` : ""}.`, "Pick Last 12 rounds against The 12 before (the DP World Tour: 3 events against 3).", t === "cm" ? `Look at ${CATN[x.c]} in the Verdict, then the stats under it for why.` : "The Verdict shows each part of the game before and after; the radar here is the same numbers.", `Or on Stats: the Form pill on the hero card is the same comparison.`] };
    if (t === "wk") return { steps: [...stats(`Strokes Gained · ${CATN[x.c]}`), `The table lists ${CATN[x.c].toLowerCase()} at each distance: the most negative rows are where the strokes go.`, "Focus (at the top) with the same part of the game ranks them and adds a drill for each."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [x.c] }, null, null) };
    if (t === "ev") return { steps: [...stats("Strokes Gained · All categories"), `Scroll to Best & worst tournaments: ${x.ev} is listed with its place among the season's tournaments.`, "SG Trends (set to Event) shows the same as bars."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [] }, "Best & worst tournaments", null) };
    if (t === "br" || t === "st") return { steps: [...stats("Strokes Gained · All categories"), "Scroll to SG Trends and switch it to Round: every round of the season as a bar.", t === "br" ? "The tallest bar is the best round; tap it for the tournament." : "The run of bars above zero at the right end is the streak."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], trendBy: "round" }, "SG Trends", null) };
    if (t === "eq") return { steps: [...stats("Strokes Gained"), `Scroll to SG Trends by Product and pick ${KIND_WORD[x.pill] || x.pill}.`, "Each bar is a tournament colored by the model used most; the table under it has each model's strokes gained a round and its rounds."] };
    if (t === "fx") { if (h.id.startsWith("fx-wk-")) { const c = h.id.split("-")[2]; return { steps: [...stats(`Strokes Gained · ${CATN[c]}`), "Scroll to SG Trends (set to Event): the tallest bar is the best week.", "Or Best & worst tournaments with All categories: sort by eye down the column."], run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [c], trendBy: "event" }, "SG Trends", null) }; }
      if (h.id.startsWith("fx-rd-")) return { steps: [...stats("Strokes Gained"), "Scroll to SG Trends and switch it to Round: the tallest bar is the round.", "Leaderboards with the Round filter shows where it ranks among every round on tour."], run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], trendBy: "round" }, "SG Trends", null) };
      const b = h.board || {}; const dist = /· ([^·]+) · /.exec(h.fx?.lbl || "")?.[1];
      return { steps: board(b.c, `${dist && !b.c ? `Distance: ${dist} · ` : ""}${b.win === "l12" ? "Last 12 rounds (Range filter)" : ""}`.replace(/ · $/, "")), run: b.c ? () => toBoard({ year: [SY], cats: cats.includes(b.c) ? [b.c] : [], ...(b.win === "l12" ? { span: "12" } : {}) }, "Rankings", null) : null }; }
    if (t === "dz" || t === "lie") return { steps: [...stats(`Strokes Gained · ${CATN[x.c] || "the part of the game"}`), "The table breaks it down by distance (and the Lie filter by lie): strokes gained a round in each.", "Focus with the same part of the game ranks the ranges and gives a drill."] };
    if (t === "up") return { steps: h.id.startsWith("up-me") ? [...stats(`Tournament: ${UPCOMING.name} (every year)`).map((x0) => x0.replace(`Season ${SY} · `, "Season: all · ")), "The hero card's strokes gained is the record here; take the Tournament filter off to compare with every other week."]
      : ["Open Course Prep, then Strategy Maps for the course.", "Pick the hole: the map shows every shot the field hit there, colored by how it scored.", "Turn on Cal's Targets for where to aim and where to miss; tap a circle for its shots and scoring."] };
    if (t === "tb") return { steps: board(h.board?.c || null) };
    return { steps: [`Open ${h.to || "the page"}.`] };
  }
  function openPop(h) {
    document.querySelector(".td-popwrap")?.remove();
    const d = dress(h), x = h.x || {}, t = h.id.split("-")[0], parts = [];
    if (h.hole && h.cid) { const meta = heat?.find((m) => m.id === h.cid); if (meta) { const img = el("img", { class: "td-pop-hole", alt: `Hole ${h.hole}` }); import("../courseHeat.js").then((m) => m.heatImage(meta, h.hole)).then((u) => { if (u) img.src = u; else img.remove(); }).catch(() => img.remove()); parts.push(img); } }
    else { const ch = chartFor(h) || (h.k && (h.id.startsWith("eq-") || catOf(h)) ? (() => { const b = storyBars(h, catOf(h)); return b ? el("div", { class: "td-chart" }, b) : null; })() : null); if (ch) parts.push(ch); }
    if (t === "fm" && x.ra) parts.push(formTable(x));
    if (h.id.startsWith("eq-") && x.A) parts.push(el("table", { class: "td-tape" }, [el("thead", {}, el("tr", {}, ["Model", `SG ${COL_IN[x.c]}`, "Rounds", "Events"].map((t2) => el("th", {}, t2)))), el("tbody", {}, [[x.neu, x.A], [x.old, x.B]].map(([nm2, r]) => el("tr", {}, [el("td", {}, nm2), el("td", { class: cls(r.v) }, sg2(r.v)), el("td", {}, String(r.n)), el("td", {}, String(r.ev))])))]));
    // the leaderboard behind a ranking
    const bd = h.board || x.board || (t === "rk" || t === "rkb" ? { c: x.hits?.[0]?.c } : h.id.startsWith("sp-weapon") ? { c: x.c } : null);
    if (bd) { const tb = boardTable({ ...bd, focus: h.k }); if (tb) parts.push(tb); }
    if (h.id === "tb-kings") for (const c0 of cats) { const tb = boardTable({ c: c0 }); if (tb) parts.push(tb); }
    if (t === "rk" && x.hits?.length > 1) for (const f of x.hits.slice(1, 3)) { const tb = boardTable({ c: f.c }); if (tb) parts.push(tb); }
    const close = () => wrap.remove(), xb = el("button", { type: "button", class: "td-pop-x", "aria-label": "Close" }, "×"); xb.addEventListener("click", close);
    const how = howOf(h), go0 = how.run || h.run, d0 = d;
    const howBox = how.steps?.length ? el("div", { class: "td-how" }, [el("p", { class: "td-kick mute" }, "How to find this yourself"), el("ol", {}, how.steps.map((x0) => el("li", {}, x0)))]) : null;
    const goB = go0 ? el("button", { type: "button", class: "td-pop-go" }, `Open ${/^Open ([A-Z][\w ]*?)(?: with| \(|\.|,|$)/.exec(how.steps?.[0] || "")?.[1] || String(h.to || "the page").split(" · ")[0]} with these filters →` /* (update 762: the page the steps name) */) : null;
    goB?.addEventListener("click", () => { close(); go0(); if (how.steps?.length) queueExplain({ id: `how-${h.id.split("-")[0]}`, q: d0.hl, steps: how.steps }); }); // (update 761: the steps again on the page)
    const back = el("div", { class: "td-pop-back" }); back.addEventListener("click", close);
    const box = el("section", { class: "td-pop", role: "dialog", "aria-modal": "true", "aria-label": d.hl }, [xb, d.kick || (staff && h.k) ? el("div", { class: "td-kick" }, `${d.kick || ""}${staff && h.k ? `${d.kick ? " · " : ""}${nameOf(h.k)}` : ""}`) : null, el("h2", {}, d.hl),
      d.num ? el("div", { class: `td-big ${d.nc}` }, [d.num, el("span", { class: "td-cap" }, ` ${d.cap}`)]) : null, d.deck ? el("p", { class: "td-pop-deck" }, d.deck) : null, ...parts, howBox, goB]);
    const wrap = el("div", { class: "ah td td-popwrap" }, [back, box]); document.body.appendChild(wrap);
    const esc = (e) => { if (e.key === "Escape") { close(); removeEventListener("keydown", esc); } }; addEventListener("keydown", esc); xb.focus();
    // (update 758) a leaderboard opens at the player
    requestAnimationFrame(() => { const row = box.querySelector("tr.target"), sc0 = row?.closest(".td-pop-scroll"); if (row && sc0) sc0.scrollTop = Math.max(0, row.offsetTop - sc0.clientHeight / 2 + row.offsetHeight / 2); });
  }
  const more = (h) => { const [pg, ...rest] = h.to.split(" · "); return el("span", { class: "td-more" }, `${pg}${rest.length ? ` · ${rest.join(" · ")}` : ""} →`); };
  const whoTag = (h) => (staff && h.k ? el("div", { class: "td-who" }, nameOf(h.k)) : null);
  const kicker = (h, d, withWho) => (!d.kick && !(withWho && staff && h.k) ? null : el("div", { class: `td-kick${d.nc === "down" && /Slipping|Rough/.test(d.kick) ? " down" : ""}` }, `${d.kick}${withWho && staff && h.k ? ` · ${nameOf(h.k)}` : ""}`.replace(/^ · /, "")));
  function leadStory(h) {
    const cat = catOf(h), d = dress(h), c = h.k ? ctxOf(h.k, cat) : null, lbl = catLbl(cat);
    const body = [d.deck ? el("p", {}, d.deck) : null];
    // (update 732) the season line and the chart: the same part of the game as the story, and it says which
    if (c) body.push(el("p", {}, `${cat ? `${CATN[cat]}: ` : ""}${isMe(h.k) ? "you’re" : `${nameOf(h.k)} is`} averaging ${sg2(c.avg)} ${lbl} a round in ${c.yr}${tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : ""}, over ${c.n} round${c.n === 1 ? "" : "s"} (${c.ev} tournament${c.ev === 1 ? "" : "s"}).`.replace(/^./, (m) => m.toUpperCase())));
    // (update 754) the picture: three numbers (the season, the tour rank, the latest tournament), every round this season as a
    // strip of squares (green gaining, red losing, brighter the bigger), and the story's own chart (a radar, a scatter, the
    // hole…); a club: its bars by model
    const isEq = h.id.startsWith("eq-"), viz = [];
    if (h.k) { const p0 = playerOf(h.k), SY = seasonYr(), rs = sgRounds(rawOf(p0)).filter((r) => yrOf(r) === SY), f = cat ? (r) => inCat(r, cat) : tot;
      if (rs.length) { const R = ranksFor(SY).by, rk = R[cat || "TOTAL"]?.get(h.k), n = R[`${cat || "TOTAL"}#`], le = eventsOf(rs).at(-1), lv = le ? avgOf(le.rs, f) : null, av = avgOf(rs, f);
        const tile = (big, small, c0 = "") => el("div", { class: "td-tile" }, [el("strong", { class: c0 }, big), el("span", {}, small)]);
        // (update 761) the three numbers are the story's own (before, after, the change …); the season's only when the story has none
        const x = h.x || {}, t0 = h.id.split("-")[0], nmC = cat ? CATN[cat] : "SG: Total", own3 = t0 === "fm" || t0 === "cm" ? [tile(sg2(x.b), `${nmC}, the ${x.FL || "12 rounds"} before`, cls(x.b)), tile(sg2(x.a), `${nmC}, the last ${x.FL || 12}`, cls(x.a)), tile(sg2(x.d), "the change", cls(x.d))]
          : t0 === "eq" && x.A ? [tile(sg2(x.B.v), `the ${x.old} (${x.B.n} rds)`, cls(x.B.v)), tile(sg2(x.A.v), `the ${x.neu} (${x.A.n} rds)`, cls(x.A.v)), tile(sg2(x.dd), "the difference", cls(x.dd))]
          : t0 === "ev" && x.v != null ? [tile(sg2(x.v), `a round at ${fullEv(x.ev)}`, cls(x.v)), tile(sg2(av), `${SY} average`, cls(av)), tile(sg2(x.d), "against the average", cls(x.d))]
          : t0 === "br" && x.v != null ? [tile(sg2(x.v), `the round, at ${fullEv(x.ev)}`, cls(x.v)), tile(sg2(av), `a round in ${SY}`, cls(av)), rk ? tile(ordN(rk).replace("No. ", "#"), `on tour, of ${n}`) : null]
          : t0 === "st" && x.n ? [tile(String(x.n), "rounds in a row gaining", "up"), tile(sg2(avgOf(rs.slice(-x.n), tot)), "a round in the streak", "up"), tile(sg2(av), `a round in ${SY}`, cls(av))]
          : t0 === "wk" && x.v != null ? [tile(sg2(x.v), `${CATN[x.c]} a round`, cls(x.v)), rk ? tile(ordN(rk).replace("No. ", "#"), `in ${CATN[x.c].toLowerCase()}, of ${n}`) : null, tile(sg2(avgOf(rs, tot)), `SG: Total a round`, cls(avgOf(rs, tot)))]
          : null;
        viz.push(el("div", { class: "td-tiles" }, own3 || [tile(sg2(av), `${cat ? CATN[cat] : "Strokes gained"} a round, ${SY}`, cls(av)), rk ? tile(ordN(rk).replace("No. ", "#"), `on tour, of ${n}`) : tile(String(rs.length), `rounds in ${SY}`), le ? tile(sg2(lv), fullEv(le.event), cls(lv)) : null]));
        const last = rs.filter((r) => !r.eventLevel).slice(-30), mx = Math.max(1, ...last.map((r) => Math.abs(f(r))));
        if (false && last.length >= 6 && !isEq) viz.push( /* (update 770: no round-by-round strip) */ /* (update 762: a club change: its bars by model instead) */el("div", { class: "td-strip-w" }, [el("div", { class: "td-kick mute" }, `Round by round · ${cat ? CATN[cat] : "strokes gained"}`), el("div", { class: "td-strip" }, last.map((r) => { const v = f(r); return el("i", { class: v >= 0 ? "up" : "down", style: `opacity:${(0.25 + 0.75 * Math.min(1, Math.abs(v) / mx)).toFixed(2)}`, title: `${r.event}${r.roundNo ? ` R${r.roundNo}` : ""}: ${sg2(v)}` }); })),
          el("div", { class: "td-strip-ax" }, [el("span", {}, shortEv(last[0].event)), el("span", {}, shortEv(last.at(-1).event))])])); } }
    const own = isEq ? (() => { const b = storyBars(h, cat); return b ? el("div", { class: "td-chart" }, b) : null; })() : /^(ev|br|st)-/.test(h.id) ? null : chartFor(h);
    // (update 761) the story's chart under the words (no empty column beside a tall figure); the form story's table beside
    // (update 762) form: the before / after table only (the radar repeats the Form section below); a club change: its
    // bars by model up beside the words, under the three numbers
    const isFm = h.id.startsWith("fm-") && h.x?.ra;
    if (isFm) viz.push(formTable(h.x));
    else if (own && (!viz.length || isEq)) viz.push(own); else if (own) body.push(own);
    const fig = viz.length ? el("div", { class: "td-fig" }, viz) : null;
    return tap(el("article", { class: "td-lead" }, [kicker(h, d, true), el("h2", {}, d.hl), el("div", { class: "td-by" }, `By Cal · ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`),
      el("div", { class: `td-leadgrid${fig ? "" : " solo"}` }, [el("div", { class: "td-body" }, [...body.slice(0, 2), more(h), ...body.slice(2)]), fig])]), h);
  }
  // (update 750) a chart for each kind of story: form as a radar (the 12 before against the last 12) or a pair of bars; a
  // tournament's bars; every part of the game; ability against consistency; a proximity illustration; the hole itself
  const CSHORT = { OTT: "Tee", APP: "Approach", ARG: "Short game", PUTT: "Putting" };
  const TOUR_FT = (c, d) => { const m = /(\d+)\s*-\s*(\d+)/.exec(String(d)) || /(\d+)/.exec(String(d)); if (!m) return null; const mid = m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1]); return c === "APP" ? mid * 0.17 : c === "ARG" ? mid * 0.55 : null; };
  const holeImg = (h) => { const meta = heat?.find((x) => x.id === h.cid); if (!meta || !h.hole) return null; const img = el("img", { class: "td-hole", alt: `Hole ${h.hole}`, loading: "lazy" });
    import("../courseHeat.js").then((m) => m.heatImage(meta, h.hole)).then((u) => { if (u) img.src = u; else img.remove(); }).catch(() => img.remove()); return el("div", { class: "td-holewrap" }, img); };
  const catBars = (all, hot) => barSvg(all.map(([c0, v]) => ({ v, label: CATN[c0], short: CSHORT[c0], hot: c0 === hot })), { note: "By part of the game" });
  function chartFor(h) { try {
    const t = h.id.split("-")[0], x = h.x || {};
    if (t === "fm" && x.ra && x.rb) return el("div", { class: "td-chart" }, [radarSvg(cats.map((c0) => CSHORT[c0]), [{ vals: x.rb, cls: "a", label: `The ${x.n} before` }, { vals: x.ra, cls: "b", label: `The last ${x.FL}` }]), el("div", { class: "td-legend" }, [el("span", { class: "gray" }, `The ${x.n} before`), el("span", { class: "gold" }, `The last ${x.FL}`)])]);
    if (t === "cm" && x.a != null) return el("div", { class: "td-chart" }, pairBars(x.b, x.a, { la: `The ${x.n} before`, lb: `Last ${x.FL || x.n}` }));
    // (update 758) the best round: every round this season (that one bright); a week or a streak: every tournament
    if (t === "br" && h.k) { const rs = sgRounds(rawOf(playerOf(h.k))).filter((r) => yrOf(r) === seasonYr() && !r.eventLevel), mx = Math.max(...rs.map(tot)); if (rs.length < 4) return null;
      const svg = barSvg(rs.map((r) => ({ v: tot(r), label: `${r.event} R${r.roundNo || ""}`, short: "", hot: tot(r) === mx })), { note: "Every round" });
      return svg ? el("div", { class: "td-chart" }, [el("div", { class: "td-kick mute" }, `Every round of ${seasonYr()}, strokes gained total`), svg, el("div", { class: "td-strip-ax" }, [el("span", {}, shortEv(rs[0].event)), el("span", {}, shortEv(rs.at(-1).event))])]) : null; }
    if ((t === "ev" || t === "st") && h.k) { const b = storyBars(h, null); return b ? el("div", { class: "td-chart" }, b.slice(1)) : null; }
    if (t === "wk" && x.all) return el("div", { class: "td-chart" }, catBars(x.all, x.c));
    if (h.id.startsWith("sp-weapon") && x.all) return el("div", { class: "td-chart" }, catBars(x.all, x.c));
    if (h.id.startsWith("sp-steady") && x.pts) return el("div", { class: "td-chart" }, scatterSvg(x.pts, { xLab: `Strokes gained ${CAT_IN[x.c]}`, yLab: "Swing", fmtX: sg2 }));
    if (t === "dz" && x.c && TOUR_FT(x.c, x.d)) { const tf = TOUR_FT(x.c, x.d), mf = tf * Math.max(0.6, Math.min(1.6, 1 - x.per * 2.5)); return el("div", { class: "td-chart" }, proxScatter(tf, mf, { seed: hash(h.id), who: h.k ? sur(h.k) : "Player" })); }
    if (h.hole && h.cid) return holeImg(h);
    // (update 750) practice: an illustration of what the work is for, a typical short-game spread against the target's
    if (t === "pr") return el("div", { class: "td-chart" }, proxScatter(8, 11, { seed: hash(`${h.id}|${DAY}`), who: "now", aLab: "target" }));
  } catch (e) { console.warn("chart", e); } return null; }
  const brief = (h) => { const d = dress(h); return tap(el("article", { class: "td-brief" }, [kicker(h, d, false), el("h3", {}, d.hl), el("p", {}, d.num ? `${d.num} ${d.cap}` : d.deck), whoTag(h)]), h); };
  const column = (h) => { const d = dress(h); return tap(el("article", { class: "td-col" }, [kicker(h, d, false), el("h3", {}, d.hl), h.hole ? chartFor(h) : null, d.num ? el("div", { class: `td-big ${d.nc}` }, d.num) : null, el("p", {}, d.num ? d.cap : d.deck), d.num && d.deck && !/^(fm|cm)-/.test(h.id) ? el("p", { class: "td-small" }, d.deck) : null, h.hole ? null : chartFor(h), whoTag(h), more(h)]), h); };
  const gearStory = (h) => { const d = dress(h), x = h.x, row = (nm, r, isNew) => el("tr", { class: isNew ? "new" : "" }, [el("td", {}, [nm, isNew ? el("span", { class: "td-note" }, " · new") : null]), el("td", { class: cls(r.v) }, sg2(r.v)), el("td", {}, String(r.n)), el("td", {}, String(r.ev))]);
    return tap(el("article", { class: "td-gear" }, [el("div", { class: "td-kick" }, `${staff ? `${nameOf(h.k)} · ` : ""}${KIND_WORD[x.pill] || "club"}`), el("h3", {}, d.hl),
      el("table", { class: "td-tape" }, [el("thead", {}, el("tr", {}, ["Model", `SG ${COL_IN[x.c]}`, "Rounds", "Events"].map((t2) => el("th", {}, t2)))), el("tbody", {}, [row(x.neu, x.A, true), row(x.old, x.B, false)])]),
      el("p", { class: "td-note" }, `${x.where[0].toUpperCase()}${x.where.slice(1)}, as the product table on Stats counts it.`), (() => { const b = storyBars(h, x.c); return b ? el("div", { class: "td-chart" }, b.slice(1)) : null; })(), more(h)]), h); }; /* (update 750: its bars) */
  const rankBox = (items) => { const rows = [];
    for (const h of items) for (const f of h.x?.hits || []) { const bad = f.n && f.r > f.n / 2, top = f.r <= 20; /* (update 744: the top 20 in green) */
      const lbl = f.c === "TOTAL" ? "Total" : `${rkName(f.c)[0].toUpperCase()}${rkName(f.c).slice(1)}`; /* (update 744: "Total", not "Strokes gained") */
      const tr = el("tr", {}, [el("td", { class: `r${top ? " up" : bad ? " down" : ""}` }, String(f.r)), el("td", {}, `${staff ? `${nameOf(h.k)} · ` : ""}${lbl}`), el("td", { class: "v" }, f.v == null ? "" : sg2(f.v))]); /* (update 751: no bar) */
      tr.dataset.r = String(bad ? 1000 + f.r : f.r);
      rows.push(tap(tr, { id: `rkrow-${f.c}-${h.k}`, k: h.k, kind: "Rank", kick: "Rankings", title: `${staff ? `${nameOf(h.k)}: ` : ""}${ordN(f.r)} of ${f.n} in ${f.c === "TOTAL" ? "strokes gained" : rkName(f.c)}`, detail: f.v == null ? "" : `${sg2(f.v)} a round in ${h.x.yr}`, board: { c: f.c }, to: "Leaderboards · Rankings", run: () => toBoard({ year: [h.x.yr], cats: f.c === "TOTAL" ? [] : [f.c] }, "Rankings", EX.lead(`Who leads in ${rkName(f.c)}?`)) })); } /* (update 751: a pop-up with that leaderboard) */
    rows.sort((a, b) => Number(a.dataset.r) - Number(b.dataset.r));
    return el("table", { class: "td-box" }, el("tbody", {}, rows.slice(0, 14))); };
  // (update 754) "Did you know?" as cards: the number big, what it's for in a line, where they sit in the field (a dot for each
  // player, theirs in gold), and the name hidden until tapped (a second tap: the whole story and the leaderboard)
  const factCard = (h) => { const f = h.fx; if (!f) return wire(h);
    let strip = null;
    if (h.board) { const rows = boardRows(h.board); if (rows.length >= 10) { const vs = rows.map((r) => r[1]), lo = Math.min(...vs), hi = Math.max(...vs), W = 300;
      const svg = mk0("svg", { viewBox: `0 0 ${W} 22`, width: "100%", class: "td-dots", "aria-hidden": "true" }); svg.append(mk0("line", { x1: 4, x2: W - 4, y1: 11, y2: 11, class: "td-zero" }));
      const xOf = (v) => 4 + ((v - lo) / (hi - lo || 1)) * (W - 8), better = rows[0][1] >= rows.at(-1)[1]; // (best on the right)
      for (const [k2, v] of rows) svg.append(mk0("circle", { cx: (better ? xOf(v) : W - xOf(v)).toFixed(1), cy: 11, r: k2 === h.k ? 6 : 2.2, class: k2 === h.k ? "td-dot" : "td-dotf" }));
      strip = el("div", { class: "td-dots-w" }, [svg, el("div", { class: "td-strip-ax" }, [el("span", {}, "worst"), el("span", {}, "best")])]); } }
    // (update 758) the player's name the card's heading; the number; one short line; where they sit
    const card = el("article", { class: "td-fx", role: "button", tabindex: "0" }, [el("div", { class: `td-kick${/Room/.test(h.kick || "") ? " down" : ""}` }, h.kick || "Did you know"), el("h3", { class: "td-fx-nm" }, h.k ? nameOf(h.k) : ""), el("div", { class: "td-fx-big" }, [el("strong", {}, f.big), el("span", {}, f.small)]), el("p", { class: "td-fx-lbl" }, f.lbl)]); void strip; /* (update 760: no best-to-worst dot strip) */
    const act = () => openPop(h); // (update 755: the name shown; a tap opens the story)
    card.addEventListener("click", act); card.addEventListener("keydown", (e) => { if (e.key === "Enter") act(); }); return card; };
  const wire = (h) => { const d = dress(h); return tap(el("div", { class: "td-wire-i" }, [el("b", {}, d.hl), el("p", {}, d.num ? `${d.num} ${d.cap}` : d.deck)]), h); };
  // (update 740) a different paper every day: each story's place moves a little with the date (the evergreen ones, about a
  // player's strengths, steadiness, gaps and stats, the most), so the front page and the sections change day to day
  const DAY = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const jit = (id, amp) => (hash(`${id}|${DAY}`) - 0.5) * 2 * amp;
  function drawFeed(items) {
    const seen = new Set(), sorted = items.filter((x) => x && !seen.has(x.id) && seen.add(x.id)).map((x) => ({ ...x, score: x.score + jit(x.id, x.ever ? 1.6 : 0.6) })).sort((a, b) => b.score - a.score);
    if (!sorted.length) { mount(secNav, []); mount(feed, el("p", { class: "td-wait" }, staff && !keys.length ? "Add players to your favorites (+ above) and their stories will run here every day." : tourPick && tourPick !== ALL ? `Nothing new on the ${tourName(tourPick)} today. Try another tour, or All.` : "Stories will run here once rounds are in.")); return; }
    // the front page: the lead, and the next three (from other sections where there are some)
    const news = sorted.filter((h) => h.kind !== "Fact"), lead = news[0] || sorted[0], fp = [lead], used = new Set([SEC_OF[lead.kind]]);
    for (const h of news.slice(1)) { if (fp.length >= 4) break; if (!used.has(SEC_OF[h.kind])) { fp.push(h); used.add(SEC_OF[h.kind]); } }
    for (const h of news.slice(1)) { if (fp.length >= 4) break; if (!fp.includes(h)) fp.push(h); }
    const rest = sorted /* (update 732: front-page stories run in their own section too, so every section shows) */, many = picked.size !== 1 && keys.length > 1, secs = [];
    for (const id of ORDER) {
      const mine = rest.filter((h) => SEC_OF[h.kind] === id); if (!mine.length) continue;
      const pick = [], byK = new Map(); // up to 6 (2 a player first, when there are several)
      const cap = id === "tour" || id === "course" ? 9 : id === "fact" ? 8 : 6; /* (update 736: more briefs) */
      for (const h of mine) { if (pick.length >= cap) break; const n = byK.get(h.k || "") || 0; if (many && h.k && n >= 2) continue; pick.push(h); byK.set(h.k || "", n + 1); }
      for (const h of mine) { if (pick.length >= cap) break; if (!pick.includes(h)) pick.push(h); }
      const [title, sub0] = SEC[id], sub = id === "rank" ? `${pick[0].x?.yr || ""} · ${tourPick && tourPick !== ALL ? tourName(tourPick) : "every tour"}${pick[0].x?.hits?.[0]?.n ? ` · ${pick[0].x.hits[0].n} players with enough rounds` : ""}` : id === "next" ? next?.name || "" : sub0;
      const content = id === "gear" ? el("div", { class: "td-stack" }, pick.map(gearStory)) : id === "rank" ? rankBox(pick) : id === "fact" ? el("div", { class: "td-fxs" }, pick.map(factCard)) : id === "tour" ? el("div", { class: "td-wire" }, pick.map(wire)) : el("div", { class: "td-cols" }, pick.map(column));
      secs.push(el("section", { class: `td-sec${FULL.has(id) ? " full" : ""}`, id: `td-${id}`, "data-sec": id }, [el("div", { class: "td-sh" }, [el("h2", {}, title), sub ? el("span", {}, sub) : null]), content]));
    }
    // (update 735) two half-width sections side by side: left and right worked out in order (a full-width one starts a new
    // row); a half left alone on its row takes the full width
    for (let i = 0, col = 0; i < secs.length; i++) { const x = secs[i]; if (x.classList.contains("full")) { col = 0; continue; }
      if (col === 0) { const nx = secs[i + 1]; if (!nx || nx.classList.contains("full")) { x.classList.add("full"); continue; } x.classList.add("l"); col = 1; } else { x.classList.add("r"); col = 0; } }
    // (update 757) no gaps: a run of half-width sections goes into two columns, each section to the shorter one (its
    // height judged by its stories and rows), so a short one doesn't leave a hole beside a long one
    const est = (x) => 1.2 + x.querySelectorAll("article").length * 2 + x.querySelectorAll("tr").length * 0.45 + x.querySelectorAll(".td-wire-i, .td-fx").length * 0.9 + x.querySelectorAll("svg.mc, .td-chart, .td-holewrap").length * 1.6;
    const laid = []; let run = [];
    const flush = () => { if (!run.length) return; if (run.length === 1) { run[0].classList.add("full"); laid.push(run[0]); run = []; return; }
      const cols = [[], []], h = [0, 0]; for (const x of run) { x.classList.remove("l", "r", "full"); const i = h[0] <= h[1] ? 0 : 1; cols[i].push(x); h[i] += est(x); }
      laid.push(el("div", { class: "td-two" }, [el("div", { class: "td-stackc" }, cols[0]), el("div", { class: "td-stackc" }, cols[1])])); run = []; };
    for (const x of secs) { if (x.classList.contains("full") && !x.classList.contains("l") && !x.classList.contains("r") && FULL.has(x.id.slice(3))) { flush(); laid.push(x); } else run.push(x); }
    flush();
    mount(feed, [el("section", { class: "td-front", id: "td-front" }, [leadStory(lead), el("aside", { class: "td-side" }, fp.slice(1).map(brief))]), el("div", { class: "td-grid" }, laid)]);
    const go2 = (id) => { const n = document.getElementById(`td-${id}`); if (!n) return; const bar = document.querySelector(".rail")?.getBoundingClientRect().bottom || 0; /* (the top bar stays put over the page) */ window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - Math.max(0, bar) - 12, behavior: "smooth" }); }; /* (update 734: to the header, clear of the top bar) */
    mount(secNav, [...secs.map((x) => [x.id.slice(3), SEC[x.id.slice(3)][0]])].map(([id, t2], i) => { const a2 = el("a", { href: "#", "data-sec": id }, t2); void i; a2.addEventListener("click", (e) => { e.preventDefault(); go2(id); }); return a2; }));
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
  let sfMemo = null;
  const seasonField = () => { const SY = seasonYr(), kk = `${SY}|${tourPick}|${field.length}`; if (sfMemo?.k === kk) return sfMemo;
    const all = field.map((p) => ({ k: p.key, rs: sgRounds(rawOf(p)).filter((r) => yrOf(r) === SY) })).filter((p) => p.rs.length);
    const most = Math.max(0, ...all.map((p) => p.rs.length)), minR = Math.max(1, Math.floor((most * 0.33) / 5) * 5);
    sfMemo = { k: kk, SY, all, ok: all.filter((p) => p.rs.length >= minR), minR }; return sfMemo; };
  const sdOf = (xs) => { if (xs.length < 2) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
  // a stat over a set of rounds (the whole-round number when there is one, else every part of the game's)
  const obsAvg = (rs, key) => { let v = 0, w = 0, v2 = 0, w2 = 0; for (const r of rs) for (const o of r.obs || []) if (o.k === key) { const ww = o.w || 1; if (o.cat == null) { v += o.v * ww; w += ww; } else { v2 += o.v * ww; w2 += ww; } } return w ? v / w : w2 ? v2 / w2 : null; };
  const fmtStat = (def, v) => (def.pct ? `${(v <= 1.5 ? v * 100 : v).toFixed(1)}%` : `${v.toFixed(def.dp ?? 1)}${def.unit || ""}`);
  const STAT_KEYS = ["drive", "fwy", "gir", "ud", "scramble", "putts", "birdie", "threePutt", "bogey"] /* (update 744: none that needs a distance to mean anything: proximity, made putts, hit green, pin high, on line) */.filter((k) => STAT_DEFS[k] && STAT_DEFS[k].higher != null);
  const CAT_WHO = { OTT: "driver of the ball", APP: "iron player", ARG: "short-game player", PUTT: "putter" };
  // (update 740) evergreen stories about a player, rotated day to day: their weapon, how steady they are against the tour,
  // what drives their good weeks, how far they are from the leader, where they rank in a stat, and the year on year gain
  function spotlightFor(k, rs, SY) {
    const out = [], F = seasonField(); if (!F.ok.length || !rs.length) return out;
    const me = isMe(k), S = me ? "You" : sur(k), P = me ? "Your" : poss(sur(k)), on = tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : "";
    const add = (id, kick, title, detail, run, to, score = 4.2, x = null) => out.push({ id: `sp-${id}-${k}`, k, kind: "Spotlight", kick, ever: true, score, title, detail, to, run, x });
    const R = ranksFor(SY).by, ok = F.ok.some((p) => p.k === k);
    const avgC = (c) => avgOf(rs, c === "TOTAL" ? tot : (r) => inCat(r, c));
    const toB = (c) => () => toBoard({ year: [SY], cats: c === "TOTAL" ? [] : [c] }, "Rankings", EX.lead(`Who leads in ${c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase()}?`));
    // the weapon
    const best = cats.map((c) => [c, avgC(c)]).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0.1) { const r = R[best[0]]?.get(k), n = R[`${best[0]}#`];
      add("weapon", "Strength", `${CATN[best[0]]} is ${me ? "your" : P} weapon`, `${sg2(best[1])} strokes gained a round ${CAT_IN[best[0]]}${r ? `, ${ordN(r)} of ${n} on tour` : ""} in ${SY}${on}`, toB(best[0]), "Leaderboards · Rankings", 4.4, { c: best[0], all: cats.map((c0) => [c0, avgC(c0)]) }); }
    // steadiness against the tour, the part of the game where they rank best for it
    if (ok && F.ok.length >= 10) { let pick = null;
      for (const c of cats) { const sds = F.ok.map((p) => [p.k, sdOf(p.rs.filter((r) => !r.eventLevel).map((r) => inCat(r, c)))]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]);
        const i = sds.findIndex((x) => x[0] === k); if (i < 0) continue; if (!pick || i < pick.i) pick = { c, i, sd: sds[i][1], typ: sds[Math.floor(sds.length / 2)][1], n: sds.length, pts: sds.map(([kk, sd]) => ({ x: avgOf(F.ok.find((p) => p.k === kk).rs, (r) => inCat(r, c)), y: sd, label: nameOf(kk), hot: kk === k })) }; }
      if (pick && pick.i < pick.n / 3) add("steady", "Steady", `${S} ${me ? "are" : "is"} the ${pick.i === 0 ? "" : `${ordN(pick.i + 1)} `}steadiest ${CAT_WHO[pick.c]} on tour`, `A round-to-round swing of ±${pick.sd.toFixed(2)} strokes ${CAT_IN[pick.c]}, against the tour's typical ±${pick.typ.toFixed(2)} (${SY}${on})`, toB(pick.c), "Leaderboards · Rankings", 4.2, { c: pick.c, pts: pick.pts }); }
    // what drives the good weeks
    const evs = eventsOf(rs).filter((e) => e.rs.length >= 2);
    if (evs.length >= 6) { const byT = [...evs].sort((a, b) => b.avg - a.avg), top = byT.slice(0, 3), bot = byT.slice(-3);
      const d = cats.map((c) => { const a = avgOf(top.flatMap((e) => e.rs), (r) => inCat(r, c)), b = avgOf(bot.flatMap((e) => e.rs), (r) => inCat(r, c)); return [c, a - b, a, b]; }).sort((a, b) => b[1] - a[1])[0];
      add("drives", "What wins", `${CATN[d[0]]} drives ${me ? "your" : P} good weeks`, `In ${me ? "your" : "the"} 3 best tournaments of ${SY}: ${sg2(d[2])} a round ${CAT_IN[d[0]]}; in the 3 worst: ${sg2(d[3])}`, () => toStats(k, { view2: "full", year: [SY], span: 0 }, "Tournaments", null), "Stats · Tournaments"); }
    // the gap to the leader, in a part of the game that changes with the day
    if (ok && F.ok.length >= 10) { const c = ["TOTAL", ...cats][Math.floor(hash(`${k}|${DAY}`) * 5)], nm = c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase();
      const vs = F.ok.map((p) => [p.k, avgOf(p.rs, c === "TOTAL" ? tot : (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1]), i = vs.findIndex((x) => x[0] === k);
      const xg = { c, board: { c } };
      if (i === 0) add("gap", "Leader", `${S} lead${me ? "" : "s"} the tour in ${nm}`, `${sg2(vs[0][1])} a round, ${(vs[0][1] - vs[1][1]).toFixed(2)} clear of ${nameOf(vs[1][0])} (${SY}${on})`, toB(c), "Leaderboards · Rankings", 4.6, xg);
      else if (i > 0) add("gap", "The chase", `${S} ${me ? "are" : "is"} ${(vs[0][1] - vs[i][1]).toFixed(2)} behind the lead in ${nm}`, `${ordN(i + 1)} at ${sg2(vs[i][1])} a round; ${nameOf(vs[0][0])} leads at ${sg2(vs[0][1])} (${SY}${on})`, toB(c), "Leaderboards · Rankings", 3.9, xg); }
    // a stat, a different one each day
    if (ok && STAT_KEYS.length) { const order = [...STAT_KEYS].sort((a, b) => hash(`${a}|${k}|${DAY}`) - hash(`${b}|${k}|${DAY}`));
      for (const key of order) { const def = STAT_DEFS[key], vs = F.ok.map((p) => [p.k, obsAvg(p.rs, key)]).filter((x) => x[1] != null); if (vs.length < 10) continue;
        vs.sort((a, b) => (def.higher ? b[1] - a[1] : a[1] - b[1])); const i = vs.findIndex((x) => x[0] === k); if (i < 0) continue;
        add("stat", def.label, `${S}: ${ordN(i + 1)} on tour in ${def.label.replace(/ %$/, "").toLowerCase()}`, `${fmtStat(def, vs[i][1])}${i ? `; the leader, ${nameOf(vs[0][0])}: ${fmtStat(def, vs[0][1])}` : `; next: ${nameOf(vs[1][0])}, ${fmtStat(def, vs[1][1])}`} (${SY}${on}, of ${vs.length} players)`,
          () => toBoard({ year: [SY] }, null, EX.lead(`Who leads in ${def.label}?`)), "Leaderboards", i < 10 ? 4.3 : 3.7, { board: { key } }); break; } }
    // year on year: the part of the game that's come on most since last season
    const prev = sgRounds(rawOf(playerOf(k))).filter((r) => yrOf(r) === String(Number(SY) - 1));
    if (prev.length >= 20 && rs.length >= 15) { const g = cats.map((c) => [c, avgC(c) - avgOf(prev, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0];
      if (g[1] >= 0.15) add("yoy", "Year on year", `${P} ${CATW[g[0]]} is up ${g[1].toFixed(2)} a round on ${Number(SY) - 1}`, `Strokes gained ${CAT_IN[g[0]]}: ${sg2(avgC(g[0]))} a round in ${SY}, against ${sg2(avgOf(prev, (r) => inCat(r, g[0])))} last season`, () => go(`${cmpBase(k)}&pick=years:${Number(SY) - 1},${SY}`, EX.cmpYears("How does this season compare to last?")), "Compare · Seasons", 4.1); }
    return out;
  }
  // (update 749) the field's shot-by-shot detail (each shot's distance and lie), this season on the tour picked, for facts at
  // a distance; one shared copy (the Stats page uses the same), loaded after the page is up
  async function loadDetail() { if (!dsRef || !tourPick) return; const SY = seasonYr(), tp = tourPick === ALL ? "all" : tourPick;
    if (detail?.tour === tp) return; const { getFieldDetail } = await import("../fieldStore.js");
    const det = await getFieldDetail(dsRef.id, dsRef.uploadedAt?.toMillis?.() ?? 0, { tour: tp, years: [SY] }).catch(() => null); if (!det?.players?.length) return;
    detail = { tour: tp, by: new Map(det.players.map((p) => [p.key, p.rounds])) }; factMemo = null; drawFeed(collect()); }
  // (update 748) "Did you know?": random facts about the players shown, a new set every 12 hours. Where they rank (top 10
  // or bottom 10 of the players with enough rounds) this season and over their last 12 rounds, in strokes gained and the
  // part-of-the-game stats that don't need a distance; their best week in each part of the game; a single round among the
  // best on tour this season. Picked by the half day, so the section changes twice a day
  const SLOT = Math.floor(Date.now() / 432e5);
  let factMemo = null;
  function factsAll() {
    const keysF = shownKeys(), mk = `${SLOT}|${tourPick}|${keysF.join(",")}|${field.length}`; if (factMemo?.k === mk) return factMemo.v;
    const F = seasonField(), SY = F.SY, on = tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : "", cand = [];
    if (F.ok.length >= 10) {
      const last12 = (rs) => rs.filter((r) => !r.eventLevel).slice(-12);
      const wins = [["season", `in ${SY}${on}`, (p) => p.rs, F.ok], ["l12", `over the last 12 rounds${on}`, (p) => last12(p.rs), F.ok.filter((p) => last12(p.rs).length >= 12)]];
      // (update 749) strokes gained by part of the game as it was; every other stat only at a distance (below, from the detail)
      const mets = ["TOTAL", ...cats].map((c) => ({ id: c, lbl: c === "TOTAL" ? "strokes gained" : `strokes gained ${CAT_IN[c]}`, higher: true, val: (rs) => avgOf(rs, c === "TOTAL" ? tot : (r) => inCat(r, c)), fmt: (v) => `${sg2(v)} a round` }));
      const rankMemo2 = new Map();
      const ranksOf = (w, m) => { const kk = `${w[0]}|${m.id}`; if (rankMemo2.has(kk)) return rankMemo2.get(kk); const vs = w[3].map((p) => [p.k, m.val(w[2](p))]).filter((x) => x[1] != null).sort((a, b) => (m.higher ? b[1] - a[1] : a[1] - b[1])); rankMemo2.set(kk, vs); return vs; };
      for (const k of keysF) { const me = isMe(k), N = me ? "You" : nameOf(k), P = me ? "your" : poss(nameOf(k));
        for (const w of wins) for (const m of mets) { const vs = ranksOf(w, m); if (vs.length < 20) continue; const i = vs.findIndex((x) => x[0] === k); if (i < 0) continue;
          const top = i < 10, bot = i >= vs.length - 10; if (!top && !bot) continue;
          cand.push({ fx: { big: `#${i + 1}`, small: `of ${vs.length}`, lbl: `${m.id === "TOTAL" ? "SG: Total" : `SG: ${CATN[m.id]}`} · ${w[0] === "l12" ? "last 12 rounds" : SY}` }, board: { c: m.id, win: w[0] }, id: `fx-${w[0]}-${m.id}-${k}`, k, kick: top ? "Top 10" : "Room to grow", title: `${N} ${me ? "rank" : "ranks"} ${ordN(i + 1)} of ${vs.length} in ${m.lbl} ${w[1]}`, detail: `${m.fmt(vs[i][1])}${i ? `; the leader, ${nameOf(vs[0][0])}: ${m.fmt(vs[0][1])}` : `; next best, ${nameOf(vs[1][0])}: ${m.fmt(vs[1][1])}`}`,
            run: () => toBoard({ year: [SY], cats: cats.includes(m.id) ? [m.id] : [] }, "Rankings", EX.lead(`Who leads in ${m.lbl}?`)), to: "Leaderboards" }); }
        // their best week this season in each part of the game
        const pl = F.all.find((p) => p.k === k); if (!pl) continue; const evs = eventsOf(pl.rs).filter((e) => e.rs.length >= 2);
        if (evs.length >= 4) for (const c of cats) { const b = evs.map((e) => [e, avgOf(e.rs, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0];
          if (b && b[1] > 0.5) cand.push({ fx: { big: sg2(b[1]), small: "a round", lbl: `Best ${CATW[c]} week · ${fullEv(b[0].event)}` }, id: `fx-wk-${c}-${k}`, k, kick: "Best week", title: `${me ? "Your" : poss(nameOf(k))} best ${CATW[c]} week of ${SY}: ${sg2(b[1])} a round at ${b[0].event}`, detail: `Strokes gained ${CAT_IN[c]}, over ${b[0].rs.length} rounds there`, run: () => toStats(k, { view2: "full", year: [SY], span: 0 }, "Tournaments", null), to: "Stats · Tournaments" }); }
        // a single round among the season's best on tour (any part of the game)
        for (const c of ["TOTAL", ...cats]) { const f = c === "TOTAL" ? tot : (r) => inCat(r, c), mine = pl.rs.filter((r) => !r.eventLevel).map((r) => [r, f(r)]).sort((a, b) => b[1] - a[1])[0]; if (!mine) continue;
          let better = 0; for (const p of F.all) for (const r of p.rs) if (!r.eventLevel && f(r) > mine[1]) { better++; if (better > 10) break; }
          if (better < 5) cand.push({ fx: { big: sg2(mine[1]), small: better ? `top ${better + 1} on tour` : "best on tour", lbl: `${c === "TOTAL" ? "SG: Total" : `SG: ${CATN[c]}`}, one round · ${fullEv(mine[0].event)}` }, id: `fx-rd-${c}-${k}`, k, kick: "Round to remember", title: `${me ? "Your" : poss(nameOf(k))} ${sg2(mine[1])} ${c === "TOTAL" ? "round" : `${CATW[c]} round`} at ${mine[0].event} is ${better ? `in the top ${better + 1}` : "the best"} on tour this season`, detail: `Strokes gained ${c === "TOTAL" ? "total" : CAT_IN[c]}${mine[0].roundNo ? `, round ${mine[0].roundNo}` : ""} (${SY}${on})`, run: () => toStats(k, { view2: "full", year: [SY], span: 0, trendBy: "round" }, "SG Trends", null), to: "Stats · SG Trends" }); } }
    }
    // (update 749) at a distance, from the detail: strokes gained a shot (a part of the game from a distance range) and each
    // stat recorded with a distance (proximity, up & down, made putts, hit green …), this season and over the last 12 rounds;
    // ranked among the players with enough rounds who've had enough of those shots (15 this season, 6 over 12 rounds)
    if (detail && F.ok.length >= 10) {
      const SYd = SY, okSet = new Set(F.ok.map((p) => p.k)), roundsOf2 = (k) => (detail.by.get(k) || []).filter((r) => yrOf(r) === SYd && (detail.tour === "all" || (r.tour || "") === detail.tour) && !r.eventLevel).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const aggOf = (rs) => { const m = new Map(); const put = (kk, v, w) => { const a = m.get(kk) || m.set(kk, [0, 0]).get(kk); a[0] += v * w; a[1] += w; };
        for (const r of rs) { for (const sh of r.shots || []) if (sh.dist && sh.cat && sh.cat !== "OTT") put(`sg|${sh.cat}|${sh.dist}`, sh.sg, sh.w || 1); for (const o of r.obs || []) if (o.dist && STAT_DEFS[o.k] && STAT_DEFS[o.k].higher != null) put(`o|${o.k}|${o.cat || ""}|${o.dist}`, o.v, o.w || 1); } return m; };
      const W2 = [["season", `in ${SYd}${on}`, (rs) => rs, 15], ["l12", `over the last 12 rounds${on}`, (rs) => rs.slice(-12), 6]];
      // the metrics the players shown have enough of (a few dozen, picked by the half day), then the field on just those
      const mine = new Map(); for (const k of keysF) { const rs = roundsOf2(k); for (const w of W2) mine.set(`${w[0]}|${k}`, aggOf(w[2](rs))); }
      const metsD = new Set(); for (const [wk, m] of mine) { const w = W2.find((x) => wk.startsWith(`${x[0]}|`)); for (const [kk, a] of m) if (a[1] >= w[3]) metsD.add(`${w[0]}#${kk}`); }
      const chosen = [...metsD].sort((a, b) => hash(`${a}|${SLOT}`) - hash(`${b}|${SLOT}`)).slice(0, 40), want = new Set(chosen);
      const fieldV = new Map(); // `${win}#${kk}` → [[key, v, w]]
      for (const p of F.ok) { const rs = roundsOf2(p.k); if (!rs.length) continue; for (const w of W2) { const ag = aggOf(w[2](rs)); for (const [kk, a] of ag) { const id = `${w[0]}#${kk}`; if (!want.has(id) || a[1] < w[3]) continue; (fieldV.get(id) || fieldV.set(id, []).get(id)).push([p.k, a[0] / a[1], a[1]]); } } }
      const WHAT = { APP: "on approach", ARG: "around the green", PUTT: "putting" };
      for (const id of chosen) { const [wn, kk] = id.split("#"), w = W2.find((x) => x[0] === wn), parts = kk.split("|"), list = fieldV.get(id) || []; if (list.length < 20) continue;
        const isSG = parts[0] === "sg", def = isSG ? null : STAT_DEFS[parts[1]], dist = isSG ? parts[2] : parts[3], higher = isSG ? true : def.higher;
        list.sort((a, b) => (higher ? b[1] - a[1] : a[1] - b[1]));
        const lbl = isSG ? `strokes gained ${WHAT[parts[1]] || CAT_IN[parts[1]]} from ${dist}` : `${def.label.replace(/ %$/, " %").toLowerCase()}${parts[2] ? ` ${CAT_IN[parts[2]] || ""}` : ""} from ${dist}`.replace(/\s+/g, " ");
        const fmtV = (v) => (isSG ? `${sg2(v)} a shot` : fmtStat(def, v));
        for (const k of keysF) { const i = list.findIndex((x) => x[0] === k); if (i < 0 || !okSet.has(k)) continue; const top = i < 10, bot = i >= list.length - 10; if (!top && !bot) continue;
          const me = isMe(k), N = me ? "You" : nameOf(k);
          cand.push({ fx: { big: `#${i + 1}`, small: `of ${list.length}`, lbl: `${isSG ? `SG ${{ APP: "approach", ARG: "short game", PUTT: "putting" }[parts[1]] || ""}` : def.label.replace(/ %$/, " %")} · ${dist} · ${wn === "l12" ? "last 12 rounds" : SYd}` }, board: { rows: list.map(([kk, v, n]) => [kk, v, `${fmtV(v)} (${Math.round(n)})`]), title: `${lbl} ${w[1]}` }, id: `fx-${id}-${k}`, k, kick: top ? "Top 10" : "Room to grow", title: `${N} ${me ? "rank" : "ranks"} ${ordN(i + 1)} of ${list.length} in ${lbl} ${w[1]}`,
            detail: `${fmtV(list[i][1])} (${Math.round(list[i][2])} ${isSG ? "shots" : "attempts"})${i ? `; the leader, ${nameOf(list[0][0])}: ${fmtV(list[0][1])}` : `; next best, ${nameOf(list[1][0])}: ${fmtV(list[1][1])}`}`,
            run: () => toStats(k, { view2: "focus", focusCats: isSG ? [parts[1]] : [], focusPick: isSG ? parts[1] : null, year: [SYd], span: 0 }, "Where you stand", null), to: "Stats · Focus" }); } } }
    // a different set each half day: shuffled by the slot, at most 2 a player when there are several
    cand.sort((a, b) => hash(`${a.id}|${SLOT}`) - hash(`${b.id}|${SLOT}`));
    const out = [], per = new Map(); for (const x of cand) { if (out.length >= 8) break; const n = per.get(x.k) || 0; if (keysF.length > 1 && n >= 2) continue; per.set(x.k, n + 1); out.push({ ...x, kind: "Fact", score: 3.2 - out.length * 0.01 }); }
    factMemo = { k: mk, v: out }; return out;
  }
  function highlightsFor(k) {
    const raw = rawOf(playerOf(k)), out = [], SY = seasonYr(), rs = sgRounds(raw).filter((r) => yrOf(r) === SY); if (!rs.length) return out; /* (update 738: this season only) */ // (update 728: Compare's rounds and order)
    const last = SY, season = rs, evs = eventsOf(season), sAvg = avgOf(season, tot);
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
      if (Math.abs(d) >= 0.3) out.push({ id: `fm-${k}`, k, x: { d, a: perRound(a), b: perRound(b), FL, n: fs.n, ra: cats.map((c0) => perRound(a, c0)), rb: cats.map((c0) => perRound(b, c0)) }, kind: d > 0 ? "Trend" : "Slide", score: 5 + Math.abs(d) * 2, title: `${His(k)} form is ${d > 0 ? "heating up" : "cooling off"}: ${sg2(d)} a round`, detail: `Last ${FL} ${sg2(perRound(a))} against ${sg2(perRound(b))} in the ${fs.n} before`, to: "Compare · Last 12 vs 12 before", run: () => go(`${cmpBase(k)}&pick=win:12`, EX.cmpWin("What changed over the last 12 rounds?")) });
      const ch = cats.map((c) => [c, perRound(a, c) - perRound(b, c)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      // (update 728) opens Compare (its Verdict shows each part of the game's difference, the same numbers)
      for (const [c, dc] of ch.slice(0, 2)) if (Math.abs(dc) >= 0.2) out.push({ id: `cm-${k}-${c}`, k, x: { c, d: dc, a: perRound(a, c), b: perRound(b, c), FL, n: fs.n }, kind: dc > 0 ? "Trend" : "Slide", score: 4.5 + Math.abs(dc) * 2, title: `${CATN[c]} ${dc > 0 ? "up" : "down"} ${Math.abs(dc).toFixed(2)} a round lately`, detail: `${His(k)} last ${FL} (${sg2(perRound(a, c))}) against the ${fs.n} before (${sg2(perRound(b, c))})`, to: "Compare · Last 12 vs 12 before", run: () => go(`${cmpBase(k)}&pick=win:12`, EX.cmpWin(`${CATN[c]}: what changed?`)) }); }
    // the part of the game costing the most this season
    const weak = cats.map((c) => [c, avgOf(season, (r) => inCat(r, c))]).filter(([, v]) => v != null).sort((x, y) => x[1] - y[1])[0];
    if (weak && weak[1] <= -0.1 && season.length >= 6) out.push({ id: `wk-${k}`, k, x: { c: weak[0], v: weak[1], yr: last, all: cats.map((c0) => [c0, avgOf(season, (r) => inCat(r, c0))]) }, kind: "Focus", score: 4 + Math.abs(weak[1]) * 2, title: `${CATN[weak[0]]} is costing ${he(k)} ${Math.abs(weak[1]).toFixed(2)} a round`, detail: "" /* (update 770: no line under it) */, to: `Stats · Focus · ${CATN[weak[0]]}`, run: () => toStats(k, { view2: "focus", focusCats: [weak[0]], focusPick: weak[0], year: [last], span: 0 }, "Where you stand", EX.cat(`Where is ${CATN[weak[0]].toLowerCase()} costing strokes?`, weak[0])) });
    // (update 737) tour ranks this season. A player's own Home: every rank, good or bad. Everyone else: the good ones (top 10;
    // top 25 in strokes gained overall) and the bad ones (the bottom 10; bottom 25 overall)
    if (last) { const R = ranksFor(last).by, nm = (x) => (x === "TOTAL" ? "strokes gained" : CATN[x].toLowerCase());
      const all = ["TOTAL", ...cats].map((c) => ({ c, r: R[c]?.get(k), n: R[`${c}#`], v: avgOf(season, c === "TOTAL" ? tot : (r0) => inCat(r0, c)) })).filter((x) => x.r && x.n >= 10);
      const lim = (x) => (x.c === "TOTAL" ? 25 : 10), good = all.filter((x) => x.n >= 20 && x.r <= lim(x)).sort((a, b) => a.r - b.r), bad = all.filter((x) => x.n >= 20 && x.r > x.n - lim(x)).sort((a, b) => (b.r / b.n) - (a.r / a.n));
      const where = `in ${last}${tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : ""}`;
      const run = (c) => () => toBoard({ year: [last], cats: c === "TOTAL" ? [] : [c] }, "Rankings", EX.lead(`Who leads in ${nm(c)}?`));
      // (update 743) a player picked at the top: all their ranks too (a mid-pack player otherwise has none to show)
      if ((isMe(k) || picked.has(k)) && all.length) { const tp = all[0];
        out.push({ id: `rk-${k}`, k, x: { hits: all, yr: last, all: true }, kind: "Rank", score: 5.5, title: `${isMe(k) ? "Your" : poss(nameOf(k))} tour ranks ${where}: ${ordN(tp.r)} in strokes gained`,
          detail: all.slice(1).map((x) => `${ordN(x.r)} in ${nm(x.c)}`).join(", ") + ` · of ${tp.n} players with enough rounds`, to: "Leaderboards · Rankings", run: run(tp.c) }); }
      else {
        if (good.length) { const f = good[0]; out.push({ id: `rk-${k}`, k, x: { hits: good, yr: last }, kind: "Rank", score: 5 + (11 - Math.min(10, f.r)) * 0.25 + good.length * 0.2, title: `${ordN(f.r)} on tour in ${nm(f.c)} this season`,
          detail: `${good.length > 1 ? `Also ${good.slice(1).map((x) => `${ordN(x.r)} in ${nm(x.c)}`).join(", ")} · ` : ""}out of ${f.n} players with enough rounds ${where}`, to: "Leaderboards · Rankings", run: run(f.c) }); }
        if (bad.length) { const f = bad[0]; out.push({ id: `rkb-${k}`, k, x: { hits: bad, yr: last, bad: true }, kind: "Rank", score: 4.6 + (f.r / f.n) * 0.5, title: `${ordN(f.r)} of ${f.n} in ${nm(f.c)} this season`,
          detail: `${bad.length > 1 ? `Also ${bad.slice(1).map((x) => `${ordN(x.r)} in ${nm(x.c)}`).join(", ")} · ` : ""}near the bottom of the players with enough rounds ${where}`, to: "Leaderboards · Rankings", run: run(f.c) }); } } }
    out.push(...spotlightFor(k, rs, SY)); // (update 740)
    return out;
  }
  function highlightsAll() {
    const out = [];
    for (const k of shownKeys()) out.push(...highlightsFor(k));
    // this week's tournament, with its strategy maps (caddies first)
    if (next?.heat) out.push({ id: "next", k: null, kind: "Next event", score: ROLE === "caddy" ? 9 : 5.5, title: `${next.live ? "On now" : "Coming up"}: ${next.name}`, detail: "Cal’s targets for every hole: where to aim off the tee and where to miss the green", to: "Course Prep · Strategy Maps", run: () => toHole(next.heat, 1, EX.course(`How should I play ${next.name}?`)) });
    // the tour (analysts and the admin): the biggest movers over the last 12 rounds
    if (!picked.size) { /* (update 736: everyone, not just analysts and the admin) */
      // (update 734) as Stats' Hot & Cold: Form (the last 12 rounds against the 12 before; the DP World Tour 3 events
      // against 3) over this season's rounds on the tour picked; full names
      const yr0 = field.reduce((m, p) => { for (const r of rawOf(p)) { const y = yrOf(r); if (y > m) m = y; } return m; }, "");
      let FL0 = "12 rounds";
      const mv = field.map((p) => { const rs = sgRounds(rawOf(p)).filter((r) => yrOf(r) === yr0), fs = formSplit(rs); if (!fs) return null; FL0 = fs.lbl;
        const l = perRound(fs.last), b0 = perRound(fs.prev); return l == null || b0 == null ? null : [p.key, l - b0, l, b0]; }).filter(Boolean).sort((a, b) => b[1] - a[1]);
      const where = `${yr0}${tourPick && tourPick !== ALL ? `, ${tourName(tourPick)}` : ""}`;
      const lst = (xs) => xs.map(([k2, d]) => `${nameOf(k2)} ${sg2(d)}`).join(", ");
      if (mv.length >= 4) { const top = mv.filter((m) => m[1] > 0).slice(0, 3), bot = mv.filter((m) => m[1] < 0).slice(-3).reverse();
        const mvRows = mv.map(([k2, d, l, b0]) => [k2, d, `${sg2(d)} (${sg2(l)} last, ${sg2(b0)} before)`]);
        if (top.length) out.push({ board: { rows: mvRows, title: `Change in strokes gained a round, the last ${FL0} against the ${FL0.split(" ")[0]} before` }, id: "movers", k: null, x: { top }, kind: "Tour", score: 5, title: `Heating up: ${lst(top)}`, detail: `Strokes gained total a round, the last ${FL0} against the ${FL0.split(" ")[0]} before (${where}), as Hot & Cold on Stats`, to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) });
        if (bot.length) out.push({ board: { rows: [...mvRows].reverse(), title: "The biggest drops first" }, id: "fallers", k: null, x: { top: bot }, kind: "Tour", score: 4, title: `Cooling off: ${lst(bot)}`, detail: `Strokes gained total a round, the last ${FL0} against the ${FL0.split(" ")[0]} before (${where}), as Hot & Cold on Stats`, to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) }); }
    }
    out.push(...factsAll()); // (update 748)
    if (!picked.size) out.push(...tourBits(), ...courseBits());
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
    // (update 740) rotating: a stat's leader (a different stat each day), the tightest race and the runaway leader
    if (ok.length >= 10) { const keyD = STAT_KEYS[Math.floor(hash(`stat|${DAY}`) * STAT_KEYS.length)], def = keyD && STAT_DEFS[keyD];
      if (def) { const vs = ok.map((p) => [p.k, obsAvg(p.rs, keyD)]).filter((x) => x[1] != null).sort((a, b) => (def.higher ? b[1] - a[1] : a[1] - b[1]));
        if (vs.length >= 10) out.push({ board: { key: keyD }, id: `tb-stat-${keyD}`, k: null, kind: "Tour", ever: true, score: 3.75, title: `${def.label} leader: ${nameOf(vs[0][0])}, ${fmtStat(def, vs[0][1])}`, detail: `Then ${vs.slice(1, 3).map(([k2, v]) => `${nameOf(k2)} ${fmtStat(def, v)}`).join(", ")} (${W0}, ${minR}+ rounds)`, to: "Leaderboards", run: () => toBoard({ year: [yr0] }, null, EX.lead(`Who leads in ${def.label}?`)) }); }
      const races = ["TOTAL", ...cats].map((c) => { const vs = ok.map((p) => [p.k, avgOf(p.rs, c === "TOTAL" ? tot : (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1]); return { c, a: vs[0], b: vs[1], gap: vs[0][1] - vs[1][1] }; }).sort((a, b) => a.gap - b.gap);
      const nmC = (c) => (c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase()), tight = races[0], run = races.at(-1);
      out.push({ board: { c: tight.c }, id: `tb-tight-${tight.c}`, k: null, kind: "Tour", ever: true, score: 3.55, title: `Tightest race: ${nmC(tight.c)}`, detail: `${nameOf(tight.a[0])} ${sg2(tight.a[1])} a round leads ${nameOf(tight.b[0])} ${sg2(tight.b[1])} by ${tight.gap.toFixed(2)} (${W0})`, to: "Leaderboards · Rankings", run: () => toBoard({ year: [yr0], cats: tight.c === "TOTAL" ? [] : [tight.c] }, "Rankings", null) });
      out.push({ board: { c: run.c }, id: `tb-run-${run.c}`, k: null, kind: "Tour", ever: true, score: 3.5, title: `Runaway leader: ${nameOf(run.a[0])} in ${nmC(run.c)}`, detail: `${sg2(run.a[1])} a round, ${run.gap.toFixed(2)} clear of ${nameOf(run.b[0])} (${W0})`, to: "Leaderboards · Rankings", run: () => toBoard({ year: [yr0], cats: run.c === "TOTAL" ? [] : [run.c] }, "Rankings", null) }); }
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
    const { heatData } = await import("../courseHeat.js"); const d = await heatData(c).catch(() => null); if (!d?.holes) return; upFromData(c, d); }
  function upFromData(c, d) {
    const holes = Object.entries(d.holes).map(([h, Hh]) => { const tees = Object.values(Hh.pins || {}).flatMap((P) => (P.rows || []).filter((q) => /tee/i.test(q.lie || ""))); let sw = 0, sv = 0; for (const q of tees) { const w = q.n || 1; sw += w; sv += q.v * w; }
      const par = Hh.par || c.par?.[Number(h) - 1]; return sw && par ? { h: Number(h), par, yds: Hh.yards || c.yards?.[Number(h) - 1] || null, toPar: sv / sw - par } : null; }).filter(Boolean).sort((a, b) => a.h - b.h);
    // (update 738) where the strategy matters most, from the field's scoring at every spot:
    //   fairway: rough and bunkers against the fairway at the same distance (25-yd bands, 100+ yds out), strokes
    //   around the green (within 30 yds, off it): each side of the pin by the line of play, the worst against the best
    const LI = (l) => { l = String(l || "").toLowerCase(); return /green/.test(l) ? "green" : /fairway/.test(l) ? "fw" : /rough|bunker|sand/.test(l) ? "miss" : /tee/.test(l) ? "tee" : null; };
    const SEC8 = ["long", "long-right", "right", "short-right", "short", "short-left", "left", "long-left"];
    const fw = [], side = [];
    for (const [h, Hh] of Object.entries(d.holes)) { const par = Hh.par || c.par?.[Number(h) - 1]; if (!par) continue;
      const bands = new Map(), secs = new Map();
      for (const P of Object.values(Hh.pins || {})) { const rows = P.rows || [];
        if (par >= 4) for (const q of rows) { const L = LI(q.lie); if ((L !== "fw" && L !== "miss") || q.dist == null || q.dist < 100) continue; const b = Math.floor(q.dist / 25), w = q.n || 1, B = bands.get(b) || bands.set(b, { fw: [0, 0], miss: [0, 0] }).get(b); B[L][0] += q.v * w; B[L][1] += w; }
        const tees = rows.filter((q) => LI(q.lie) === "tee"); if (P.x == null || !tees.length) continue;
        const tx = tees.reduce((t, q) => t + q.x, 0) / tees.length, ty = tees.reduce((t, q) => t + q.y, 0) / tees.length, lx = P.x - tx, ly = P.y - ty, ll = Math.hypot(lx, ly); if (!ll) continue;
        for (const q of rows) { const L = LI(q.lie); if (L === "green" || L === "tee" || L == null || q.dist == null || q.dist > 30) continue;
          const dx = q.x - P.x, dy = q.y - P.y, along = (dx * lx + dy * ly) / ll, across = (lx * dy - ly * dx) / ll, ang = Math.atan2(across, along) * 180 / Math.PI;
          const sname = SEC8[((Math.round(ang / 45) % 8) + 8) % 8], w = q.n || 1, S0 = secs.get(sname) || secs.set(sname, [0, 0]).get(sname); S0[0] += q.v * w; S0[1] += w; } }
      let num = 0, den = 0; for (const B of bands.values()) if (B.fw[1] >= 5 && B.miss[1] >= 5) { num += (B.miss[0] / B.miss[1] - B.fw[0] / B.fw[1]) * B.miss[1]; den += B.miss[1]; }
      if (den >= 20) fw.push({ h: Number(h), par, pen: num / den, n: den });
      const ss = [...secs].filter(([, v]) => v[1] >= 8).map(([nm2, v]) => ({ nm: nm2, v: v[0] / v[1], n: v[1] })).sort((a, b) => a.v - b.v);
      if (ss.length >= 3) side.push({ h: Number(h), par, best: ss[0], worst: ss.at(-1), spread: ss.at(-1).v - ss[0].v }); }
    fw.sort((a, b) => b.pen - a.pen); side.sort((a, b) => b.spread - a.spread);
    upHoles = { id: c.id, holes, fw, side }; drawFeed(collect());
    loadUpRaw(c).catch((e) => console.warn("course shots", e)); }
  // (update 744) the course's own shots (every player, hole, pin and round on record there): how often the field birdies
  // and bogeys each hole (the attack / defend index), what the top 10 finishers did best, which approach distances come up
  // more than in a usual week, and each pin's costliest miss (where, from which lie, after which shot). Not on phones.
  let upRaw = null;
  async function loadUpRaw(c) {
    if (!c.rawChunks) return; const CH = await import("../courseHeat.js");
    // (update 746) a phone: the shots load once Course Strategy is (nearly) on screen, as Strategy Maps loads them there
    if (CH.LOW_MEM) await new Promise((ok) => { const near = () => { const n = document.getElementById("td-course"); return n && n.getBoundingClientRect().top < innerHeight + 600; };
      if (near()) return ok(); const f = () => { if (near()) { removeEventListener("scroll", f); ok(); } }; addEventListener("scroll", f, { passive: true }); });
    const { loadRaw } = await import("../courseRaw.js"); const rows = await loadRaw(c); if (!rows?.length) return; upRawFrom(c, rows, CH); }
  function upRawFrom(c, rows, CH) {
    const num = (v) => (v == null || v === "" ? null : Number(v));
    const trails = new Map(), teeXY = new Map(), pinXY = new Map(), greens = [];
    for (const r of rows) { const h = num(r[6]), st = num(r[10]), x = num(r[13]), y = num(r[14]); if (!h || st == null) continue;
      const pid = String(r[8] ?? "1").trim() || "1", who = r[4] != null && r[4] !== "" ? r[4] : r[3], lie = CH.lieName(r[9]) || "other";
      const q = { h, st, par: num(r[7]), pid, who, yr: String(r[0] ?? ""), rd: String(r[5] ?? ""), lie, x, y, v: num(r[15]), d: num(r[18]) };
      if (lie === "green" && q.v != null) greens.push(q.v);
      const tk = `${h}|${who}|${q.yr}|${q.rd}`; let T = trails.get(tk); if (!T) { T = { h, pid, who, yr: q.yr, rd: q.rd, par: q.par, qs: [], s: null }; trails.set(tk, T); } T.qs.push(q);
      if (num(r[12]) === 1) { const sf = num(r[11]); T.s = sf != null ? Math.round(sf) : q.par ? st - q.par : null; }
      if (st === 1 && x != null) { const a = teeXY.get(h) || teeXY.set(h, [0, 0, 0]).get(h); a[0] += x; a[1] += y; a[2]++; }
      const px = num(r[16]), py = num(r[17]); if (px != null && py != null) { const a = pinXY.get(`${h}|${pid}`) || pinXY.set(`${h}|${pid}`, [0, 0, 0]).get(`${h}|${pid}`); a[0] += px; a[1] += py; a[2]++; } }
    greens.sort((a, b) => a - b); const toGo = greens.length ? greens[Math.floor(greens.length / 2)] < 2.6 : true;
    const T = [...trails.values()].filter((t) => t.s != null); for (const t of T) t.qs.sort((a, b) => a.st - b.st);
    // each hole: birdie (or better) and bogey (or worse) rates; the attack / defend index (birdies per bogey)
    const byH = new Map(); for (const t of T) { const o = byH.get(t.h) || byH.set(t.h, { h: t.h, par: t.par, n: 0, bird: 0, bog: 0, sum: 0 }).get(t.h); o.n++; o.sum += t.s; if (t.s <= -1) o.bird++; if (t.s >= 1) o.bog++; }
    const holesR = [...byH.values()].filter((o) => o.n >= 40).map((o) => ({ ...o, b: o.bird / o.n, g: o.bog / o.n, avg: o.sum / o.n, idx: (o.bird / o.n) / Math.max(0.01, o.bog / o.n) }));
    // the top 10 each year (of those who played every round), against the rest: by hole and by part of the game
    const tot = new Map(); for (const t of T) { const k = `${t.who}|${t.yr}`, o = tot.get(k) || tot.set(k, { who: t.who, yr: t.yr, s: 0, rds: new Set(), holes: 0 }).get(k); o.s += t.s; o.rds.add(t.rd); o.holes++; }
    const top = new Set(); const byYr = new Map(); for (const o of tot.values()) (byYr.get(o.yr) || byYr.set(o.yr, []).get(o.yr)).push(o);
    for (const list of byYr.values()) { const mx = Math.max(...list.map((o) => o.rds.size)); list.filter((o) => o.rds.size === mx && o.holes >= mx * 18 * 0.9).sort((a, b) => a.s - b.s).slice(0, 10).forEach((o) => top.add(`${o.who}|${o.yr}`)); }
    const isTop = (t) => top.has(`${t.who}|${t.yr}`);
    const hEdge = new Map(); for (const t of T) { const o = hEdge.get(t.h) || hEdge.set(t.h, [0, 0, 0, 0]).get(t.h); if (isTop(t)) { o[0] += t.s; o[1]++; } else { o[2] += t.s; o[3]++; } }
    const edges = [...hEdge].filter(([, o]) => o[1] >= 10 && o[3] >= 30).map(([h, o]) => ({ h, d: o[0] / o[1] - o[2] / o[3] })).sort((a, b) => a.d - b.d);
    const E = expectModel(T), sgMemo = new Map(), sgOfT = (t) => sgMemo.get(t) || sgMemo.set(t, shotSG(t, E)).get(t); void toGo; // (update 761: not the file's scoring_avg, which can be the player's own strokes left)
    const catOfQ = (q) => (q.lie === "green" ? "PUTT" : q.st === 1 && (q.par || 4) >= 4 ? "OTT" : q.d != null && q.d <= 30 ? "ARG" : "APP");
    const cs = { top: { OTT: 0, APP: 0, ARG: 0, PUTT: 0, rds: new Set() }, rest: { OTT: 0, APP: 0, ARG: 0, PUTT: 0, rds: new Set() } };
    for (const t of T) { const G = isTop(t) ? cs.top : cs.rest; G.rds.add(`${t.who}|${t.yr}|${t.rd}`);
      const sg0 = sgOfT(t); for (let i = 0; i < t.qs.length; i++) if (sg0[i] != null) G[catOfQ(t.qs[i])] += sg0[i]; }
    const catEdge = cats.map((c0) => [c0, cs.top[c0] / Math.max(1, cs.top.rds.size) - cs.rest[c0] / Math.max(1, cs.rest.rds.size)]).sort((a, b) => b[1] - a[1]);
    // approach distances here (25-yd bands, 50-250 yds)
    const appD = []; for (const t of T) for (const q of t.qs) if (catOfQ(q) === "APP" && q.d != null && q.d > 30) appD.push(q.d); // (update 745: every approach's distance, put in the players' own ranges below)
    // each pin's costliest miss: where the approach (shot 1 on a par 3, 2 on a par 4, 3 on a par 5) finished off the green
    // within 30 yds, by side of the pin (the line from the tee) and lie, and the hole's average score from there
    const SEC8 = ["long", "long-right", "right", "short-right", "short", "short-left", "left", "long-left"], grp = new Map();
    // (update 747) as Cal's Way now reads it: every shot played from within 30 yds off the green (any stroke), as the hole
    // plays if you're there after the approach (a par 3's shot 1, a par 4's 2, a par 5's 2), its side from the shot before it
    for (const t of T) { const k0 = Math.max(1, Math.min(2, (t.par || 4) - 2)), pin = pinXY.get(`${t.h}|${t.pid}`); if (!pin) continue; const px = pin[0] / pin[2], py = pin[1] / pin[2];
      t.qs.forEach((nx, i) => { if (i === 0 || nx.st < 2 || nx.lie === "green" || nx.d == null || nx.d > 30 || nx.x == null) return; const ap = t.qs[i - 1]; if (ap.x == null) return;
        const lx = px - ap.x, ly = py - ap.y, ll = Math.hypot(lx, ly); if (!ll) return;
        const dx = nx.x - px, dy = nx.y - py, ang = Math.atan2((lx * dy - ly * dx) / ll, (dx * lx + dy * ly) / ll) * 180 / Math.PI, sec = SEC8[((Math.round(ang / 45) % 8) + 8) % 8];
        const kk = `${t.h}|${t.pid}|${sec}|${nx.lie}`, g = grp.get(kk) || grp.set(kk, { h: t.h, pid: t.pid, par: t.par, k: k0, sec, lie: nx.lie, n: 0, s: 0 }).get(kk); g.n++; g.s += t.s - nx.st + k0 + 1; }); }
    const byPin = new Map(); for (const g of grp.values()) if (g.n >= 8) (byPin.get(`${g.h}|${g.pid}`) || byPin.set(`${g.h}|${g.pid}`, []).get(`${g.h}|${g.pid}`)).push({ ...g, avg: g.s / g.n });
    const misses = [...byPin.values()].filter((l) => l.length >= 2).map((l) => { l.sort((a, b) => a.avg - b.avg); return { best: l[0], worst: l.at(-1), spread: l.at(-1).avg - l[0].avg }; }).sort((a, b) => b.spread - a.spread);
    // (update 747) par 5s: going for it in two against laying up (the second shot, from within 300 yds), by hole
    const LI7 = ["tee", "fairway", "rough", "bunker", "green", "water", "other"], arr7 = (q) => [q.st, q.x, q.y, Math.max(0, LI7.indexOf(q.lie)), q.d];
    const goH = new Map(); for (const t of T) { if ((t.par || 4) < 5) continue; const q2 = t.qs.find((q) => q.st === 2), q3 = t.qs.find((q) => q.st === 3); if (!q2 || !q3 || q2.d == null || q2.d > 300) continue;
      const g = goOf(arr7(q2), arr7(q3), t.par, null); if (!g) continue; const o = goH.get(t.h) || goH.set(t.h, { h: t.h, par: t.par, go: [], lay: [] }).get(t.h); o[g === "go" ? "go" : "lay"].push(t.s); }
    const goLay = [...goH.values()].filter((o) => o.go.length >= 10 && o.lay.length >= 10).map((o) => { const ga = o.go.reduce((a, b) => a + b, 0) / o.go.length, la = o.lay.reduce((a, b) => a + b, 0) / o.lay.length; return { ...o, ga, la, d: la - ga }; }).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    // (update 760) each player's own week here: strokes gained by part of the game (against the field here), each hole to par
    // against the field, and the par 5s where they went against the grain (laid up when most went for it, or the other way) and birdied
    const goShare = new Map([...goH.values()].map((o) => [o.h, o.go.length / Math.max(1, o.go.length + o.lay.length)]));
    const fAvg = new Map(); for (const t of T) { const o = fAvg.get(t.h) || fAvg.set(t.h, [0, 0]).get(t.h); o[0] += t.s; o[1]++; }
    const ply = new Map(), keyOf = (w) => clientKey(String(Number(w) || w));
    for (const t of T) { const pk = keyOf(t.who), P = ply.get(pk) || ply.set(pk, { cat: { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }, rds: new Set(), holes: new Map(), notes: [] }).get(pk);
      P.rds.add(`${t.yr}|${t.rd}`); const hh = P.holes.get(t.h) || P.holes.set(t.h, [0, 0, t.par]).get(t.h); hh[0] += t.s; hh[1]++;
      const sg1 = sgOfT(t); for (let i = 0; i < t.qs.length; i++) if (sg1[i] != null) P.cat[catOfQ(t.qs[i])] += sg1[i];
      if ((t.par || 4) >= 5 && t.s <= -1) { const q2 = t.qs.find((q) => q.st === 2), q3 = t.qs.find((q) => q.st === 3), gs = goShare.get(t.h);
        if (q2 && q3 && q2.d != null && q2.d <= 300 && gs != null) { const g = goOf(arr7(q2), arr7(q3), t.par, null);
          if (g && g !== "go" && gs >= 0.6) P.notes.push({ h: t.h, yr: t.yr, rd: t.rd, s: t.s, kind: "lay", share: gs, d: q2.d });
          else if (g === "go" && gs <= 0.4) P.notes.push({ h: t.h, yr: t.yr, rd: t.rd, s: t.s, kind: "go", share: gs, d: q2.d }); } } }
    const per = (G) => Object.fromEntries(cats.map((c0) => [c0, G[c0] / Math.max(1, G.rds.size)]));
    upRaw = { id: c.id, holesR, edges, catEdge, catTop: per(cs.top), catRest: per(cs.rest), ply, fAvg, appD, misses, goLay, pinName: (h, pid) => CH.pinLabel(c, h, pid) }; drawFeed(collect());
  }
  function courseBits() {
    const out = [], U = UPCOMING, isU = (r) => U.re.test(String(r.event || ""));
    const c = heat?.find((h) => (h.events || []).some((e) => U.re.test(e.name)) && !U.not.test(h.name)) || heat?.find((h) => U.course.test(h.name) && !U.not.test(h.name));
    out.push({ id: "up-strat", k: null, kind: "Course", score: ROLE === "caddy" ? 8.8 : 5.2, title: `How to play ${c?.name || U.name}`, detail: c ? `Cal’s targets for every hole: where to aim off the tee and where to miss the green, from every shot the field has hit there` : `Strategy maps and course insights for ${U.name}`,
      to: c ? "Course Prep · Strategy Maps" : "Course Prep", run: () => (c ? toHole(c.id, 1, EX.course(`How should I play ${U.name}?`)) : go("#/course-prep", EX.course(`How should I play ${U.name}?`))) });
    // (update 737) the course's key holes, from the strategy maps' scoring (every shot the field has hit there)
    if (c && upHoles?.id === c.id && upHoles.holes.length >= 9 && !c.rawChunks) { /* (update 746: a course with its shots on record: their read only, on a phone too) */ /* (update 744: the shots' own read replaces this when it's loaded) */ const H = upHoles.holes, pm = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`, hn = (x) => `No. ${x.h} (par ${x.par}${x.yds ? `, ${x.yds} yds` : ""})`;
      const hard = [...H].sort((a, b) => b.toPar - a.toPar), easy = [...H].sort((a, b) => a.toPar - b.toPar);
      out.push({ id: "up-hard", hole: hard[0].h, cid: c.id, k: null, kind: "Course", score: 4.9, title: `The hardest hole at ${c.name}: ${hn(hard[0])}, ${pm(hard[0].toPar)} against par`, detail: `Then No. ${hard[1].h} (${pm(hard[1].toPar)}) and No. ${hard[2].h} (${pm(hard[2].toPar)}) · against par, from every shot the field has hit there`,
        to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, hard[0].h, EX.hole(`How should I play hole ${hard[0].h}?`)) });
      out.push({ id: "up-easy", hole: easy[0].h, cid: c.id, k: null, kind: "Course", score: 4.8, title: `Birdie chances: ${hn(easy[0])}, ${pm(easy[0].toPar)}`, detail: `Then No. ${easy[1].h} (${pm(easy[1].toPar)}) and No. ${easy[2].h} (${pm(easy[2].toPar)}) · against par, the field's scoring`,
        to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, easy[0].h, EX.hole(`How should I play hole ${easy[0].h}?`)) });
      const byPar = [3, 4, 5].map((pp) => { const xs = H.filter((x) => x.par === pp); return xs.length ? [pp, xs.reduce((t, x) => t + x.toPar, 0) / xs.length, xs.length] : null; }).filter(Boolean), sum = H.reduce((t, x) => t + x.toPar, 0);
      if (byPar.length >= 2) { const bestP = [...byPar].sort((a, b) => a[1] - b[1])[0];
        out.push({ id: "up-pars", k: null, kind: "Course", score: 4.7, title: `Par ${bestP[0]}s are the scoring holes: ${pm(bestP[1])} a hole`, detail: `${byPar.map(([pp, v, n]) => `Par ${pp}s ${pm(v)} (${n})`).join(" · ")} · the course plays ${pm(sum)} against par for the field`,
          to: "Course Prep · Course Insights", run: () => toHole(c.id, 1, EX.course(`How does ${c.name} play?`)) }); } }
    if (c && upHoles?.id === c.id) { const pm2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
      const F = upHoles.fw.filter((x) => x.pen >= 0.1);
      if (F.length) out.push({ id: "up-fw", hole: F[0].h, cid: c.id, k: null, kind: "Course", score: 4.75, title: `Find the fairway on No. ${F[0].h}: missing it costs ${pm2(F[0].pen)} strokes`, detail: `${F.length > 1 ? `Then No. ${F[1].h} (${pm2(F[1].pen)})${F[2] ? ` and No. ${F[2].h} (${pm2(F[2].pen)})` : ""} · ` : ""}rough and bunkers against the fairway from the same distance, 100+ yds out, the field's scoring`,
        to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, F[0].h, EX.hole(`Where should I aim off the tee on hole ${F[0].h}?`)) });
      const Sd = upHoles.side.filter((x) => x.spread >= 0.15);
      if (Sd.length && !c.rawChunks) { const x = Sd[0]; out.push({ id: "up-side", hole: x.h, cid: c.id, k: null, kind: "Course", score: 4.72, title: `The costliest miss: ${x.worst.nm} of No. ${x.h}`, detail: `Miss ${x.best.nm} instead (${x.best.v.toFixed(2)} to finish against ${x.worst.v.toFixed(2)}): ${x.spread.toFixed(2)} strokes better${Sd[1] ? ` · also No. ${Sd[1].h}: ${Sd[1].best.nm}, never ${Sd[1].worst.nm} (${Sd[1].spread.toFixed(2)})` : ""} · within 30 yds of the pin`,
        to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, x.h, EX.hole(`Where should I miss on hole ${x.h}?`)) }); } }
    if (c && upRaw?.id === c.id) { const R0 = upRaw, pc = (v) => `${Math.round(v * 100)}%`, pm3 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
      const H = [...R0.holesR].sort((a, b) => b.idx - a.idx), atk = H[0], dfd = H.at(-1);
      if (H.length >= 9) { out.push({ id: "up-attack", hole: atk.h, cid: c.id, k: null, kind: "Course", score: 4.95, title: `Attack No. ${atk.h} (par ${atk.par}): ${pc(atk.b)} birdies against ${pc(atk.g)} bogeys`, detail: `The most birdies for every bogey on the course (${atk.idx.toFixed(1)} to 1)${H[1] ? `; then No. ${H[1].h} (${H[1].idx.toFixed(1)})` : ""} · ${atk.n} holes played there`, to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, atk.h, EX.hole(`How should I play hole ${atk.h}?`)) });
        out.push({ id: "up-defend", hole: dfd.h, cid: c.id, k: null, kind: "Course", score: 4.92, title: `Defend No. ${dfd.h} (par ${dfd.par}): ${pc(dfd.g)} bogeys against ${pc(dfd.b)} birdies`, detail: `The fewest birdies for every bogey (${dfd.idx.toFixed(2)} to 1)${H.at(-2) ? `; then No. ${H.at(-2).h} (${H.at(-2).idx.toFixed(2)})` : ""} · par is a good score here`, to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, dfd.h, EX.hole(`How should I play hole ${dfd.h}?`)) }); }
      if (R0.edges.length >= 3) { const e = R0.edges[0], ce = R0.catEdge[0];
        out.push({ id: "up-top10", hole: e.h, cid: c.id, k: null, kind: "Course", score: 4.85, title: `Where the top 10 win it: No. ${e.h}, ${pm3(e.d)} a round against the field`, detail: `The top 10 finishers' biggest edge on a hole${R0.edges[1] ? ` (then No. ${R0.edges[1].h}, ${pm3(R0.edges[1].d)})` : ""} · by part of the game, ${CATN[ce[0]].toLowerCase()}: ${pm3(ce[1])} strokes a round better than the rest`, to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, e.h, EX.hole(`How should I play hole ${e.h}?`)) }); }
      // approach distances: here against the shown players' own season (their usual week), in the same ranges their data
      // uses (update 745: the course's shots put in those ranges, so the two are counted alike)
      if (R0.appD.length >= 200) { const rngOf = (t0) => { const t = String(t0); let m = /(\d+)\s*-\s*(\d+)/.exec(t); if (m) return [Number(m[1]), Number(m[2])]; m = /^<\s*(\d+)/.exec(t); if (m) return [0, Number(m[1])]; m = /(\d+)\s*\+/.exec(t); if (m) return [Number(m[1]), 9999]; return null; };
        const usual = new Map(); let nU = 0;
        for (const k of shownKeys()) for (const r of (gearData.get(k) || []).filter((r0) => yrOf(r0) === seasonYr())) for (const s0 of r.shots) if (s0.cat === "APP" && s0.dist) { const g = rngOf(s0.dist); if (!g) continue; const o = usual.get(s0.dist) || usual.set(s0.dist, { lab: s0.dist, lo: g[0], hi: g[1], n: 0, here: 0 }).get(s0.dist); o.n++; nU++; }
        if (nU >= 200) { const B = [...usual.values()].sort((a, b) => a.lo - b.lo); let nH = 0; for (const d of R0.appD) { const o = B.find((x) => d >= x.lo && d < x.hi); if (o) { o.here++; nH++; } }
          const r1 = B.filter((x) => nH && x.here / nH >= 0.08 && x.n / nU >= 0.03).map((x) => ({ ...x, h: x.here / nH, u: x.n / nU, ratio: (x.here / nH) / (x.n / nU) })).sort((a, b) => b.ratio - a.ratio)[0];
          if (r1 && r1.ratio >= 1.2) out.push({ id: "up-mix", k: null, kind: "Course", score: 4.8, title: `Approaches from ${r1.lab.replace(/\s*yds?$/i, "")} yds come up ${r1.ratio.toFixed(1)}× as often here`, detail: `${pc(r1.h)} of approach shots at ${c.name} (${nH} shots on record), against ${pc(r1.u)} in a usual week (your players' ${nU} approaches this season) · practice that range`, to: "Practice", run: () => go("#/practice", EX.practice("Practice for this week")) }); } }
      // (update 747) the par 5 where going for it (or laying up) matters most
      if (R0.goLay?.length) { const g = R0.goLay[0], go = g.d > 0;
        out.push({ id: "up-golay", hole: g.h, cid: c.id, k: null, kind: "Course", score: 4.88, title: `No. ${g.h}: ${go ? "go for it in two" : "lay up"}, ${Math.abs(g.d).toFixed(2)} a hole better`, detail: `Went for the green with the second shot: ${pm3(g.ga)} to par (${g.go.length} players) · laid up: ${pm3(g.la)} (${g.lay.length}) · from within 300 yds${R0.goLay[1] ? ` · also No. ${R0.goLay[1].h}: ${R0.goLay[1].d > 0 ? "go for it" : "lay up"} (${Math.abs(R0.goLay[1].d).toFixed(2)})` : ""}`,
          to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, g.h, EX.hole(`Should I go for hole ${g.h} in two?`)) }); }
      // each pin's costliest miss, described in full
      const M = R0.misses.filter((x) => x.spread >= 0.15);
      if (M.length) { const x = M[0], w = x.worst, b = x.best, pn = R0.pinName(w.h, w.pid), shotN = w.k === 1 ? "the tee shot" : `the approach (shot ${w.k})`, lieW = (l) => (l === "rough" ? "in the rough" : l === "bunker" ? "in a bunker" : l === "fairway" ? "in the fairway" : `in the ${l}`);
        const shotW = w.k === 1 ? "off the tee" : "on the approach", pinT = pn ? `, ${/\bpin\b/i.test(pn) ? pn : `${pn} pin`}` : "";
        out.push({ id: "up-side", hole: w.h, cid: c.id, k: null, kind: "Course", score: 4.9, title: `No. ${w.h}${pinT}: avoid the ${w.sec} miss ${lieW(w.lie)} ${shotW}`,
          detail: `${pm3(w.avg)} to par from there (${w.n} shots, as if you're there in ${w.k}); ${x.spread.toFixed(2)} worse than the best miss, ${b.sec} ${lieW(b.lie)} (${pm3(b.avg)}, ${b.n} shots) · every shot played from within 30 yds of the green${M[1] ? ` · also No. ${M[1].worst.h}: avoid ${M[1].worst.sec} ${lieW(M[1].worst.lie)} (${pm3(M[1].worst.avg)})` : ""}`,
          to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, w.h, EX.hole(`Where should I miss on hole ${w.h}?`)) }); }
    }
    // course form: the best there over the years (on the tour picked)
    const hist = field.map((p) => { const rs = sgRounds(rawOf(p)).filter(isU); return rs.length ? { k: p.key, rs, v: perRound(rs), yrs: new Set(rs.map(yrOf)).size } : null; }).filter(Boolean);
    const horses = hist.filter((x) => x.rs.length >= 8).sort((a, b) => b.v - a.v).slice(0, 3);
    if (horses.length >= 2) out.push({ id: "up-horses", k: null, kind: "Course", score: 4.4, title: `Horses for courses at ${U.name}`, detail: horses.map((x) => `${nameOf(x.k)} ${sg2(x.v)} a round (${x.rs.length} rounds, ${x.yrs} year${x.yrs === 1 ? "" : "s"})`).join(" · "),
      to: "Leaderboards", run: toLead(`Who plays ${U.name} best?`) });
    // (update 760) the players picked: their record there, always with its context (is it good, is it enough to win, how
    // it compares with their other events), the skills that win here against theirs, and their own holes
    const ordS = (n) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
    const byYrU = new Map(); for (const h0 of hist) for (const r of h0.rs) { const y = yrOf(r), m = byYrU.get(y) || byYrU.set(y, new Map()).get(y); (m.get(h0.k) || m.set(h0.k, []).get(h0.k)).push(r); }
    const yrBoards = [...byYrU].map(([y, m]) => [y, [...m].filter(([, rs]) => rs.length >= 4).map(([kk, rs]) => [kk, perRound(rs)]).sort((a, b) => b[1] - a[1])]).filter(([, l]) => l.length >= 20);
    const winV = yrBoards.length ? yrBoards.reduce((t, [, l]) => t + l[0][1], 0) / yrBoards.length : null, t10V = yrBoards.length ? yrBoards.reduce((t, [, l]) => t + l[Math.min(9, l.length - 1)][1], 0) / yrBoards.length : null;
    const paceOf = (v) => (yrBoards.length ? Math.round(yrBoards.reduce((t, [, l]) => t + l.filter((x) => x[1] > v).length + 1, 0) / yrBoards.length) : null);
    for (const k of shownKeys().slice(0, 4)) { const x = hist.find((h0) => h0.k === k); if (!x) continue;
      const me = isMe(k), S = me ? "You" : sur(k), Pw = me ? "your" : poss(sur(k)), he = me ? "you" : "they";
      const byYr = new Map(); for (const r of x.rs) { const y = yrOf(r); (byYr.get(y) || byYr.set(y, []).get(y)).push(r); }
      const bestY = [...byYr].map(([y, rs]) => [y, perRound(rs)]).sort((a, b) => b[1] - a[1])[0], evNames = [...new Set(x.rs.map((r) => r.event))];
      // their usual: every other event in the same years; this event's place among them
      const yrs = new Set(x.rs.map(yrOf)), other = (playerOf(k) ? sgRounds(rawOf(playerOf(k))) : []).filter((r) => yrs.has(yrOf(r)) && !isU(r)), usual = other.length >= 8 ? perRound(other) : null;
      const evAv = new Map(); for (const r of other) { const m = evAv.get(r.event) || evAv.set(r.event, []).get(r.event); m.push(r); }
      const evL = [...evAv.values()].filter((rs) => rs.length >= 2).map((rs) => perRound(rs)), evRank = evL.filter((v) => v > x.v).length + 1, nEv = evL.length + 1;
      const hereRank = (() => { const l = hist.filter((h0) => h0.rs.length >= 4).sort((a, b) => b.v - a.v); const i = l.findIndex((h0) => h0.k === k); return i < 0 ? null : [i + 1, l.length]; })();
      const pace = paceOf(x.v), diff = usual != null ? x.v - usual : null;
      const verdict = diff == null ? "" : diff >= 0.4 ? `${me ? "You play" : `${S} plays`} this course well: ${sg2(diff)} a round better than ${Pw} usual week (${sg2(usual)})` : diff <= -0.4 ? `${me ? "You play" : `${S} plays`} worse here than usual: ${sg2(diff)} a round against ${Pw} usual ${sg2(usual)}` : `About ${Pw} usual level (${sg2(usual)} a round elsewhere)`;
      out.push({ id: `up-me-${k}`, k, kind: "Course", score: 5.35 + Math.abs(diff || 0) * 0.1, x: { v: x.v }, title: `${me ? "Your" : poss(nameOf(k))} record at ${U.name}: ${sg2(x.v)} a round${pace ? `, a ${ordS(pace)}-place pace` : ""}`,
        detail: [verdict, nEv > 3 ? `${ordS(evRank)} best of ${nEv} events on ${Pw} schedule` : "", winV != null ? `winning here has taken about ${sg2(winV)} a round, a top 10 ${sg2(t10V)}${x.v >= t10V ? `: ${he} have played at top-10 level here` : `: ${sg2(t10V - x.v).replace("+", "")} a round short of a top 10`}` : "", hereRank ? `${ordS(hereRank[0])} of ${hereRank[1]} players with 4+ rounds here` : "", `${x.rs.length} rounds over ${x.yrs} year${x.yrs === 1 ? "" : "s"}${bestY && byYr.size > 1 ? `, best in ${bestY[0]} (${sg2(bestY[1])})` : ""}`].filter(Boolean).join(" · "),
        to: "Stats · Tournaments", run: () => toStats(k, { view2: "full", year: [], span: 0, event: evNames }, "Tournaments", null) });
      if (!(c && upRaw?.id === c.id)) continue;
      const R0 = upRaw, P = R0.ply.get(k), cat0 = [...R0.catEdge].sort((a, b) => b[1] - a[1]);
      // the skills that win here: the top 10's edge over the rest, by part of the game, against theirs (here when they have
      // 2+ rounds of shots on record, else their season)
      const mine = P && P.rds.size >= 2 ? Object.fromEntries(cats.map((c0) => [c0, P.cat[c0] / P.rds.size])) : null;
      const seasonRs = (playerOf(k) ? sgRounds(rawOf(playerOf(k))) : []).filter((r) => yrOf(r) === seasonYr()), theirs = mine || (seasonRs.length >= 8 ? Object.fromEntries(cats.map((c0) => [c0, avgOf(seasonRs, (r) => inCat(r, c0))])) : null);
      if (theirs && cat0.length) { const key = cat0[0][0], gap = R0.catTop[key] - theirs[key], gaps = cats.map((c0) => [c0, R0.catTop[c0] - theirs[c0]]).sort((a, b) => b[1] - a[1]);
        out.push({ id: `up-skill-${k}`, k, kind: "Course", score: 5.3, title: `What wins at ${U.name}: ${CATN[key].toLowerCase()}. ${me ? "You're" : `${S} is`} ${gap > 0.05 ? `${sg2(gap).replace("+", "")} a round behind the top 10 there` : "at top-10 level there"}`,
          detail: `The top 10 gain ${sg2(cat0[0][1])} a round over the rest of the field ${CAT_IN[key]}${cat0[1] ? `, then ${sg2(cat0[1][1])} ${CAT_IN[cat0[1][0]]}` : ""} · ${mine ? `${Pw} shots here` : `${Pw} ${seasonYr()} season (no shots of ${Pw} here on record)`}: ${cats.map((c0) => `${CATN[c0]} ${sg2(theirs[c0])} (top 10 ${sg2(R0.catTop[c0])})`).join(", ")} · the biggest gap to close: ${CATN[gaps[0][0]].toLowerCase()} (${sg2(gaps[0][1]).replace("+", "")})`,
          to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, 1, EX.course(`What wins at ${U.name}?`)) }); }
      // their own holes: best and worst against the field, and a par 5 played against the grain
      if (P) { const hs = [...P.holes].filter(([, o]) => o[1] >= 2).map(([h, o]) => { const f = R0.fAvg.get(h); return f && f[1] >= 20 ? { h, par: o[2], n: o[1], d: o[0] / o[1] - f[0] / f[1] } : null; }).filter(Boolean).sort((a, b) => a.d - b.d);
        const note = P.notes.sort((a, b) => a.s - b.s)[0];
        if (hs.length >= 6 || note) { const b = hs[0], w = hs.at(-1), sc = (s0) => (s0 <= -2 ? "an eagle" : "a birdie");
          const nl = note ? `In ${note.yr} (round ${note.rd}) on No. ${note.h}, ${he} made ${sc(note.s)} by ${note.kind === "lay" ? `laying up from ${Math.round(note.d)} yds when ${Math.round(note.share * 100)}% of the field went for it` : `going for it from ${Math.round(note.d)} yds when only ${Math.round(note.share * 100)}% of the field did`}` : "";
          out.push({ id: `up-holes-${k}`, k, kind: "Course", hole: note ? note.h : b?.h, cid: c.id, score: note ? 5.32 : 5.25,
            title: note ? `Against the grain: ${me ? "your" : poss(S)} ${note.kind === "lay" ? "lay-up" : "go"} on No. ${note.h} paid off` : `${me ? "Your" : poss(nameOf(k))} best hole here: No. ${b.h}, ${sg2(-b.d)} a play against the field`,
            detail: [nl, b && hs.length >= 6 ? `best hole No. ${b.h} (par ${b.par}): ${sg2(-b.d)} a play against the field (${b.n} plays)` : "", w && hs.length >= 6 && w.d > 0.15 ? `the one that hurts: No. ${w.h} (par ${w.par}), ${sg2(-w.d)} against the field` : ""].filter(Boolean).join(" · "),
            to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, note ? note.h : b.h, EX.hole(`How should I play hole ${note ? note.h : b.h}?`)) }); } }
    }
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
    const rs = (gearData.get(k) || []).filter((r) => (ownP?.key === k || onTour(r)) && yrOf(r) === seasonYr()) /* (update 742: their own rounds: every one) */.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); if (!rs.length) return [];
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
        const vals = rds.map((rd) => rd.shots.reduce((u, s) => u + (val(s) === g && (!c || s.cat === c) ? s.sg : 0), 0));
        return { v: vals.reduce((t, v) => t + v, 0) / rds.length, vals, n: rds.length, ev: new Set(rds.map((r) => `${r.event}|${yrOf(r)}`)).size }; };
      const A = row(neu), B = row(old); if (!A || !B) continue;
      // (update 760) only a comparison that holds up: its first event in the bag (said as such), or 8+ rounds with each
      // and a difference clear of the round-to-round noise (Welch's t of 1.65+, about 90% sure which is better)
      const sdv = (a) => { if (a.length < 2) return 0; const m = a.reduce((t, v) => t + v, 0) / a.length; return Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / (a.length - 1)); };
      const first = A.ev === 1, tStat = Math.abs(A.v - B.v) / Math.max(1e-6, Math.sqrt(sdv(A.vals) ** 2 / A.n + sdv(B.vals) ** 2 / B.n));
      if (!first && (A.n < 8 || B.n < 8 || tStat < 1.65)) continue;
      const dd = A.v - B.v, where = tourPick && tourPick !== ALL ? `every ${tourName(tourPick)} round in ${seasonYr()}` : `every round in ${seasonYr()}`;
      out.push({ id: `eq-${k}-${pill}`, k, x: { pill, neu: nm(neu), old: nm(old), A, B, c, dd, where, first }, kind: "Equipment", score: (first ? 6 : 7) + Math.abs(dd) * 2, title: `New ${KIND_WORD[pill] || "club"}: ${nm(neu)}, ${sg2(dd)} a round ${COL_IN[c]}`,
        detail: `${first ? "Only one event so far, so it’s early: " : ""}${sg2(A.v)} a round over ${plural(A.n, "round")} (${plural(A.ev, "tournament")}) with it, against ${sg2(B.v)} over ${plural(B.n, "round")} (${plural(B.ev, "tournament")}) with the ${nm(old)} · ${where}, as the product table on Stats counts it`,
        to: "Stats · SG Trends by Product", run: () => toStats(k, { view2: "full", productKind: pill, year: [seasonYr()], span: 0, cats: [] }, "SG Trends by Product", EX.product(`How is the new ${KIND_WORD[pill] || "club"} working?`, pill)) });
    }
    return out;
  }
  // (update 743) by distance and lie, from the player's own shots (the field summary has neither): their best and worst
  // ranges (approach, around the green, putting) and what the rough or a bunker costs them; two a day, rotated
  function detailSpots(k) {
    const SY = seasonYr(), rs = (gearData.get(k) || []).filter((r) => (ownP?.key === k || onTour(r)) && yrOf(r) === SY); if (rs.length < 8) return [];
    const me = isMe(k), S = me ? "You" : sur(k), P = me ? "Your" : poss(sur(k)), nR = rs.length, out = [];
    const grp = new Map(), lieG = new Map(), lieOf = (l) => { l = String(l || "").toLowerCase(); return /fairway/.test(l) ? "the fairway" : /rough/.test(l) ? "the rough" : /bunker|sand/.test(l) ? "a bunker" : null; };
    for (const r of rs) for (const s0 of r.shots) { if (!["APP", "ARG", "PUTT"].includes(s0.cat)) continue; const w = s0.w || 1;
      if (s0.dist) { const kk = `${s0.cat}|${s0.dist}`, g = grp.get(kk) || grp.set(kk, { c: s0.cat, d: s0.dist, sg: 0, n: 0 }).get(kk); g.sg += s0.sg; g.n += w; }
      const L = s0.cat !== "PUTT" ? lieOf(s0.lie) : null; if (L) { const kk = `${s0.cat}|${L}`, g = lieG.get(kk) || lieG.set(kk, { c: s0.cat, L, sg: 0, n: 0 }).get(kk); g.sg += s0.sg; g.n += w; } }
    const G = [...grp.values()].filter((g) => g.n >= 25).map((g) => ({ ...g, per: g.sg / g.n, rd: g.sg / nR })).sort((a, b) => b.rd - a.rd);
    const WHAT = { APP: "approach", ARG: "around the green", PUTT: "putting" }, rng = (g) => `${WHAT[g.c] === "around the green" ? "chips and pitches" : WHAT[g.c]} from ${g.d}`;
    const toF = (c) => () => toStats(k, { view2: "focus", focusCats: [c], focusPick: c, year: [SY], span: 0 }, "Where you stand", EX.cat(`Where is ${CATN[c].toLowerCase()} costing strokes?`, c));
    const cand = [];
    if (G.length >= 3) { const b = G[0], w = G.at(-1);
      if (b.rd > 0.05) cand.push({ x: { c: b.c, d: b.d, per: b.per }, id: `dz-best-${k}`, kick: "Sweet spot", title: `${P} sweet spot: ${rng(b)}`, detail: `${sg2(b.per)} a shot over ${Math.round(b.n)} shots, ${sg2(b.rd)} strokes a round from there in ${SY}`, run: toF(b.c), to: `Stats · Focus · ${CATN[b.c]}` });
      if (w.rd < -0.05) cand.push({ x: { c: w.c, d: w.d, per: w.per }, id: `dz-leak-${k}`, kick: "The leak", title: `${P} biggest leak: ${rng(w)}`, detail: `${sg2(w.per)} a shot over ${Math.round(w.n)} shots, ${sg2(w.rd)} strokes a round from there in ${SY}`, run: toF(w.c), to: `Stats · Focus · ${CATN[w.c]}` }); }
    for (const c of ["APP", "ARG"]) { const fw = lieG.get(`${c}|the fairway`), bad = ["the rough", "a bunker"].map((L) => lieG.get(`${c}|${L}`)).filter((g) => g && g.n >= 20).sort((a, b) => a.sg / a.n - b.sg / b.n)[0];
      if (fw && fw.n >= 20 && bad) { const gap = fw.sg / fw.n - bad.sg / bad.n; if (gap > 0.04) cand.push({ id: `lie-${c}-${k}`, kick: "By lie", title: `From ${bad.L}, ${S} ${me ? "give" : "gives"} back ${gap.toFixed(2)} a shot ${c === "APP" ? "on approach" : "around the green"}`, detail: `${sg2(bad.sg / bad.n)} a shot from ${bad.L} (${Math.round(bad.n)} shots) against ${sg2(fw.sg / fw.n)} from the fairway (${Math.round(fw.n)}) in ${SY}`, run: toF(c), to: `Stats · Focus · ${CATN[c]}` }); } }
    cand.sort((a, b) => hash(`${a.id}|${DAY}`) - hash(`${b.id}|${DAY}`));
    for (const x of cand.slice(0, 2)) out.push({ ...x, k, kind: "Spotlight", ever: true, score: 4.25 });
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
    for (const k of [...picked]) if (!playsTour(k)) picked.delete(k);
    const meKey = ownP ? ownP.key : null; // (update 742) the signed-in person's own game (their entered rounds), when they have any
    const add = el("button", { type: "button", class: "hl-pill hl-add", "aria-label": "Add a favorite player" }, "+");
    add.addEventListener("click", addFav);
    const favPill = (k, label) => { const on = picked.has(k), b = pill(on, label, () => setWho(k));
      // (update 734) a picked favorite has an × to take them off the list
      if (on && k !== meKey) { const x = el("span", { class: "hl-x", role: "button", tabindex: "0", "aria-label": `Remove ${nameOf(k)} from favorites`, title: "Remove from favorites" }, "×");
        const rm = (e) => { e.stopPropagation(); removeFav(k); }; x.addEventListener("click", rm); x.addEventListener("keydown", (e) => { if (e.key === "Enter") rm(e); }); b.append(x); }
      return b; };
    mount(whoRow, [el("span", { class: "hl-pl" }, "Players"), pill(!picked.size, staff && team.isTeam ? "All my players" : "All favorites", () => setWho(null)),
      meKey && playsTour(meKey) ? favPill(meKey, "Me") : null, ...fav.filter((k) => k !== meKey).map((k) => favPill(k, nameOf(k))), add]);
    whoRow.hidden = false;
  }
  const playsTour = (k) => !tourPick || tourPick === ALL || !field.length || (ownP && k === ownP.key) || (playerOf(k)?.rounds || []).some((rd) => tourOf(rd) === tourPick);
  const shownKeys = () => (picked.size ? [...picked] : keys.filter(playsTour));
  const setTour = (t) => { if (tourPick === t) return; tourPick = t; tmemo.clear(); rankMemo = null; refresh(); loadDetail().catch(() => {}); }; // (tbMemo is keyed by tour)
  // (update 740) a tap picks a player, or unpicks one already picked; All: none picked (everyone)
  const setWho = (k) => { if (k == null) picked.clear(); else if (picked.has(k)) picked.delete(k); else { picked.add(k); if (!keys.includes(k)) keys = [...keys, k]; focus = k; drawTabs(); } refresh(); };
  async function removeFav(k) {
    try { const wl = await import("../watchlist.js"); await wl.saveWatch({ players: (wl.watchPrefs().players || []).filter((x) => x !== k) }); } catch (e) { console.error(e); alert("Couldn’t update your favorites just now."); return; }
    favs = favs.filter((x) => x !== k); if (admin) keys = keys.filter((x) => x !== k); picked.delete(k); refresh();
  }
  // (update 740) +: every player you can see, your favorites ticked; a tap ticks or unticks one; Done saves the changes
  async function addFav() {
    const ks = await playersList(); const all = [...new Set([...ks, ...favs])].filter((k) => playsTour(k) || favs.includes(k));
    const opts = all.map((k) => ({ value: k, label: nameOf(k) })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const now = await pickMany({ q: "Your favorites", title: tourPick && tourPick !== ALL ? `${tourName(tourPick)} players` : "Players", options: opts, on: new Set(favs) }); if (!now) return;
    const added = [...now].filter((k) => !favs.includes(k)), gone = favs.filter((k) => !now.has(k)); if (!added.length && !gone.length) return;
    try { const wl = await import("../watchlist.js"); const cur = wl.watchPrefs().players || []; await wl.saveWatch({ players: [...cur.filter((k) => !gone.includes(k)), ...added.filter((k) => !cur.includes(k))] }); } catch (e) { console.error(e); alert("Couldn’t save your favorites just now."); return; }
    favs = [...favs.filter((k) => !gone.includes(k)), ...added]; for (const k of added) if (!keys.includes(k)) keys = [...keys, k]; if (admin) keys = keys.filter((k) => !gone.includes(k)); for (const k of gone) picked.delete(k); refresh();
  }
  function pickMany({ q, title, options, on }) {
    return new Promise((done) => {
      const sel = new Set(on), list = el("div", { class: "ah-opts" }), qIn = el("input", { type: "search", class: "ah-search", placeholder: "Search players…", "aria-label": "Search" });
      const ok = el("button", { type: "button", class: "btn ah-go" }, "Done");
      const draw = () => { const t = qIn.value.trim().toLowerCase();
        mount(list, options.filter((o) => !t || String(o.label).toLowerCase().includes(t)).slice(0, 60).map((o) => { const b = el("button", { type: "button", class: `ah-opt ah-check${sel.has(o.value) ? " on" : ""}`, "aria-pressed": String(sel.has(o.value)) }, [el("span", {}, o.label), el("i", { class: "ah-tick", "aria-hidden": "true" }, sel.has(o.value) ? "✓" : "")]);
          b.addEventListener("click", () => { sel.has(o.value) ? sel.delete(o.value) : sel.add(o.value); draw(); }); return b; })); };
      qIn.addEventListener("input", draw);
      const back = el("div", { class: "ah-back" }), box = el("section", { class: "ah-sheet", role: "dialog", "aria-modal": "true", "aria-label": title }, [el("div", { class: "ah-grab" }), el("p", { class: "ah-sq" }, q), el("h2", { class: "ah-sh" }, title), el("p", { class: "ah-sub" }, "Tap to add or take off; Done to save."), qIn, list, ok]);
      const wrap = el("div", { class: "ah-sheet-wrap" }, [back, box]), close = () => wrap.remove();
      back.addEventListener("click", () => { close(); done(null); }); ok.addEventListener("click", () => { close(); done(sel); });
      document.body.appendChild(wrap); draw(); setTimeout(() => qIn.focus(), 50);
    });
  }
  const collect = () => { const shown = shownKeys().slice(0, selfKey ? 1 : GEARN);
    return [...highlightsAll(), ...shown.flatMap((k) => (gearData.has(k) ? [...gearHighlights(k), ...detailSpots(k)] : [])), ...practice]; };
  async function refresh() {
    const my = ++gen; drawPills(); drawFeed(collect());
    for (const k of shownKeys().slice(0, selfKey ? 1 : GEARN)) { if (gearData.has(k)) continue; await loadGear(k); if (my !== gen) return; drawFeed(collect()); }
  }
  // (the data, once everything above is defined)
  // (the data, once everything above is defined)
  if (window.__homeTest) Object.assign(window.__homeTest, { setField: (f) => { field = f; tmemo.clear(); rankMemo = null; }, setKeys: (k) => { keys = k; }, setFavs: (f) => { favs = f; }, setGear: (k, rs) => { gearData.set(k, rs); gearP.set(k, Promise.resolve()); }, setHeat: (h) => { heat = h; }, upFromData, setDetail: (tour, by) => { detail = { tour, by }; factMemo = null; }, upRawFrom: async (c, rows) => upRawFrom(c, rows, await import("../courseHeat.js")), setOwn: (k, rs) => { ownP = { key: k, name: "Charlie Test", rounds: rs, own: true }; labels.set(k, "Charlie Test"); gearData.set(k, rs); gearP.set(k, Promise.resolve()); keys = [k, ...keys]; }, setTour, setWho, draw: () => { drawPills(); drawFeed(collect()); }, state: () => ({ tourPick, who: [...picked][0] || null, picked: [...picked] }) }); // (tests only)
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
    const summary = ds ? await store.getFieldStats(ds.id).catch(() => null) : null; dsRef = ds; // (update 749)
    field = summaryPlayers(summary).filter((p) => p.rounds.length);
    for (const p of field) if (!labels.has(p.key) && p.name) labels.set(p.key, p.name);
    drawTabs();
    if (ownKey) { try { const { loadSource } = await import("../reportGen.js"); const d = await loadSource("entered", ownKey, myName || "Me").catch(() => null), rs = (d?.me?.rounds || []).filter((r) => r.shots?.length);
      if (rs.length) { ownP = { key: ownKey, name: myName || "Me", rounds: rs, own: true }; labels.set(ownKey, myName || "Me"); gearData.set(ownKey, rs); gearP.set(ownKey, Promise.resolve()); if (!keys.includes(ownKey)) keys = [ownKey, ...keys]; } } catch (e) { console.warn("own rounds", e); } }
    await nextP; await heatP; /* (update 736: the courses, for Course Insights & Strategy) */
    refresh();
    loadUpCourse().catch(() => {}); /* (update 737) */
    loadDetail().catch((e) => console.warn("detail", e)); /* (update 749) */
    if (selfKey || ownP) { practice = await practiceHighlights(selfKey || ownP.key).catch(() => []); if (practice.length) drawFeed(collect()); }
  } catch (err) { console.error(err); mount(feed, el("p", { class: "muted small" }, "Couldn’t put the highlights together just now.")); }
}
