// (update 726) Home: questions. A greeting, one line to ask Cal, "Suggested for you" (questions picked from the player's own
// numbers: the part of the game costing the most, what's slipped lately, a club they keep switching, the next tournament,
// another season to compare), then tabs of example questions covering everything the site does. A question asks one
// follow-up when it needs one (which player, over what stretch, which course …), then opens the page already set up for
// it, with a one-time pop-up on how Cal answers it (askExplain.js). Players see "my"; coaches and analysts their players;
// the admin any player, and the tour.
import { el, mount, calAllowed, holdToTalk, icon } from "../ui.js";
import { getState } from "../auth.js";
import { setCurrent, currentPlayer, onCurrent, openStatsTab } from "../current.js"; // (update 817: a story's player becomes the header's player)
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";
import { detectColumns, isShotData, summaryPlayers, gearInfo, STAT_DEFS } from "../sg.js";
import { queueExplain } from "../askExplain.js";
import { sgRounds, roundsFor, perRound } from "../compareData.js";
import { goOf } from "../strategy.js"; // (update 747)
import { clientKey } from "../data.js";
import { expectModel, shotSG } from "../courseExp.js"; // (update 761: expected strokes from the course's own holes) // (update 760: a course's player ids to the players' keys)
import { scatterSvg, radarSvg, pairBars, proxScatter, bar0, groupBars } from "../miniCharts.js"; // (update 750) // (update 728: the rounds and numbers exactly as Compare counts them)

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
  // (update 863) a coach or caddie with one player: Home is always that player (as a player's own Home is theirs); with
  // several: those players only (their favorites, set for them)
  const lockKey = !admin && team.isTeam && teamKeys.length === 1 ? teamKeys[0] : null;
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
  // (update 796) a player named by one name is always the last name ("Burns", not "Sam"): kept as firstOf for the callers
  const firstOf = (k) => { const w = String(nameOf(k)).split(/\s+/).filter((x) => x && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); if (!w.length) return nameOf(k) || "them";
    let i = w.length - 1; while (i > 1 && /^(van|von|der|den|de|da|di|du|la|le|del|dos|ter|mac)$/i.test(w[i - 1])) i--; return w.slice(i).join(" "); }; // (update 817: "van Rooyen", not "Rooyen")
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
  const toStats = (k, st, scroll, ex) => { if (k && !isMe(k)) setCurrent({ key: k, label: nameOf(k) }); st = { tour: [tourPick || ALL], tourFor: k, ...st }; try { sessionStorage.setItem("ta.statsPreset", JSON.stringify({ at: Date.now(), st, scroll })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = statsHref(k); };
  const toHole = (heat, hole, ex) => { try { sessionStorage.setItem("cal.open", JSON.stringify({ heat, hole, pin: null })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = `#/course-prep?cal=${Date.now()}`; };
  const go = (href, ex) => { if (ex) queueExplain(ex); location.hash = href; };
  // (update 737) a ranking opens the leaderboard (that part of the game, season and tour), not the player's own stats
  const boardHref = () => (admin ? "#/admin/analyze" : "#/leaderboards");
  const toBoard = (st, scroll, ex) => { st = { tour: [tourPick || ALL], tourFor: "__field", view2: "full", span: 0, ...st }; try { sessionStorage.setItem("ta.statsPreset", JSON.stringify({ at: Date.now(), st, scroll })); } catch { /* */ } if (ex) queueExplain(ex); location.hash = boardHref(); };
  const cmpBase = (k) => `#/comparisons?player=${encodeURIComponent(k)}${tourPick && tourPick !== ALL ? `&tour=${encodeURIComponent(tourPick)}` : ""}`; // (update 729: Compare on the same tour)

  // ---- the data (filled in as it arrives) ----
  let field = [], years = [], heat = null, next = null, ownP = null, dsRef = null, detail = null, ownAll = []; // (update 863) ownAll: every round you've entered (any holes, quick ones too) // (update 749) detail: { tour, by: Map(key → rounds with each shot's distance and lie) } // (update 742) ownP: { key, rounds, own }: the signed-in person's own entered rounds
  const playerOf = (k) => (ownP && k === ownP.key ? ownP : field.find((p) => p.key === k));
  const heatP = import("../courseHeat.js").then((m) => m.listHeatCourses()).then((l) => (heat = (l || []).filter((c) => c.par?.length))).catch(() => (heat = []));
  const yrOf = (rd) => String(rd.year || String(rd.date || "").slice(0, 4));
  // (update 729) the tour picked at the top: everything (highlights, ranks, the pages they open) on that tour's rounds only;
  // "All" (picked by hand) every tour together. null until the data's in, then the tour the players have the most rounds on.
  const ALL = "__all";
  let tourPick = null, tourTouched = false; /* (update 841: a tour tapped on Home stays picked) */ const picked = new Set(); // (update 740) the players picked at the top (none: all of them); several at once
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
    lost: (q) => ({ id: "lost", q, steps: ["Every shot is scored against what a typical tour player does from the same spot (strokes gained).", "Shots are grouped by part of the game and distance (chips inside 30 yds, putts inside 5 ft…).", "Each group’s strokes per round are ranked, biggest loss first: the top one is worth the most to fix.", "Each comes with a drill: tap Add to practice to put it in the practice plan."] }),
    cat: (q, c) => ({ id: `cat-${c}`, q, steps: [`Focus is set to ${CAT_PLAY[c]} only.`, "Where you stand: the season, the last rounds and the trend, against the tour.", `Below it, each distance ${CAT_IN[c]} ranked by the strokes it costs per round, with a drill for each.`, "Tap Add to practice on any of them to put it in the practice plan."] }),
    trend: (q) => ({ id: "trend", q, steps: ["Each bar is a tournament: strokes gained per round there.", "Form compares the last 12 rounds with the 12 before them (the DP World Tour: 3 events against 3).", "Getting better or worse compares 12 against 12 and 48 against 48 for the longer view."] }),
    rank: (q) => ({ id: "rank", q, steps: ["Every player compared with enough rounds in this selection is ranked on strokes gained per round.", "Change the part of the game at the top to rank on driving, approach, short game or putting.", "Min. rounds sets how many rounds a player needs to be ranked."] }),
    elite: (q) => ({ id: "elite", q, steps: ["Elite stretches: the player’s best runs of rounds, and what made them good.", "Path back to Elite: what’s different now, part by part, and the drills to close the gap."] }),
    product: (q, kind) => ({ id: `prod-${kind}`, q, steps: [`Each bar is a tournament, colored by the ${KIND_WORD[kind] || "product"} used most there.`, "The table under it: strokes gained per round with each model, over the rounds it was used, and the stats recorded with it.", "Wrong model at a tournament? Tap Edit and then that bar to put it right; it’s kept through new data."] }),
    cmpYears: (q) => ({ id: "cmp-years", q, steps: ["Each season is its own selection: strokes gained per round in each part of the game, side by side.", "Side by side lists every stat for both; the better one is highlighted.", "For a PDF of this: open Stats with both seasons picked, tap Generate PDF Report, then Compare."] }),
    cmpWin: (q) => ({ id: "cmp-win", q, steps: ["The last 12 rounds against the 12 before them, part by part of the game.", "Where a part of the game has moved, the stats under it show why (Hit Green %, Proximity, Made Putt %…)."] }),
    cmpPlayer: (q) => ({ id: "cmp-player", q, steps: ["Pick the other player (or several) at the top.", "Each is shown side by side: strokes gained per round in each part of the game, then every stat.", "Generate PDF Report makes a write-up of the comparison."] }),
    report: (q) => ({ id: "report", q, steps: ["Both seasons are picked at the top of Stats.", "Tap ✨ Generate PDF Report, then Compare: each season side by side, the differences highlighted.", "Combine makes one report over both seasons together."] }),
    hole: (q) => ({ id: "hole", q, steps: ["Every round played to this pin, and where each shot finished.", "Cal’s circles (8 or 10 yds): off the tee, where to aim and what to avoid; on the approach, the best, 2nd best and worst places to miss.", "Each circle’s numbers are the shots inside it: tap anywhere on the map for a circle of your own and see them."] }),
    course: (q) => ({ id: "course", q, steps: ["Strategy Maps: each hole and pin, how the field scored from every spot.", "Turn on Cal’s Targets for where to aim and where to miss on each hole.", "Course Insights and the course report sum up the holes that cost the most."] }),
    lm: (q) => ({ id: "lm", q, steps: ["Every launch monitor shot (TrackMan or GCQuad), by club.", "The table: each club’s averages; tap a club for its models and every shot.", "Dispersion and trajectory show the spread; Over time shows any number improving or not."] }),
    practice: (q) => ({ id: "practice", q, steps: ["Your practice sessions: in progress, not yet started and completed.", "Create Practice Session picks the ranges to work on, each with a target a set.", "Drills added from Stats arrive here with their target already set."] }),
    goals: (q) => ({ id: "goals", q, steps: ["Each goal: the stat, the target and the rounds it has to be met in.", "On track, met or missed, from the rounds played since it was set."] }),
    lead: (q) => ({ id: "lead", q, steps: ["Every player ranked on strokes gained per round, for the season and tour picked.", "Pick a part of the game at the top for the leaders in it."] }),
  };

  // ---- the questions ----
  // { id, icon, t: (k) => text, to: "Stats · Player Stats", who: needs a player, run: async (k) => …}
  const P = (fn) => async (q, k0) => { const k = k0 || (await askPlayer(q)); if (k) await fn(q, k); };
  const lastYear = (k) => yearsOf(k).at(-1);
  const Q = {
    lost: { icon: "📉", t: (k) => `Where ${W(k).am} losing the most strokes?`, to: "Stats · Player Stats", run: P(async (q, k) => { const per = await askPeriod(q, k); if (per) toStats(k, { ...per, view2: "full", focusCats: [], focusPick: null }, "Where you stand", EX.lost(q)); }) },
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
    plan: { icon: "🎯", t: (k) => `What should ${W(k).I} practice this week?`, to: "Stats · Player Stats → Practice", run: P(async (q, k) => toStats(k, { view2: "full", focusCats: [], focusPick: null, year: [], span: "12" }, "Where you stand", EX.lost(q))) },
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
  // (update 780) each question's player: the one player picked; else one of the favorites at random; else one of the top 20
  // in strokes gained this season at random (kept per question until the choices change)
  const askMemo = new Map();
  const whoFor = (id) => {
    try { if (selfKey) return selfKey; if (picked.size === 1) return [...picked][0];
      let pool = keys.filter(playsTour);
      if (!pool.length) { const F = seasonField(), avg = (rs) => rs.reduce((t, r) => t + r.shots.reduce((u, x) => u + x.sg, 0), 0) / rs.length; pool = F.ok.map((p) => [p.k, avg(p.rs)]).sort((a, b) => b[1] - a[1]).slice(0, 20).map((x) => x[0]); }
      if (!pool.length) return focus;
      const sig = pool.join(","), m = askMemo.get(id); if (m && m.sig === sig) return m.k;
      const k = pool[Math.floor(Math.random() * pool.length)]; askMemo.set(id, { sig, k }); return k;
    } catch { return focus; } // (the field not loaded yet)
  };
  const drawTabs = () => {
    mount(tabBar, TABS.map(([nm], i) => { const b = el("button", { type: "button", role: "tab", class: `ah-tab${i === tab ? " on" : ""}`, "aria-selected": String(i === tab) }, nm); b.addEventListener("click", () => { tab = i; drawTabs(); }); return b; }));
    mount(list, TABS[tab][1].map((id) => card(id, whoFor(id))));
  };
  // (update 731) Home as a newspaper, "Tour Analytics Daily": a masthead, the filters as its section bar, a front page
  // (the day's biggest story and the next three), then a section for each kind of highlight. Headlines are fixed wording
  // for each kind of highlight, filled in with the numbers. Colors: css/daily.css (dark, or light with the site's theme).
  const asked = el("details", { class: "hl-more td-asked" }, [el("summary", {}, "Ask Cal a question"), tabBar, list]);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const edition = el("span", {}, ""), nextLine = el("a", { class: "td-live", href: "#/live", title: "Open the Event Feed" }, ""), /* (update 734: this week’s event: a link to the Event Feed) */ roleLbl = el("span", { class: "td-top-r" }, "");
  // (update 836) Stats' Overview at the top of Home: one player (you, or the one picked in the header) in full; several
  // (favorites, or a coach's players) as a row each, closed, with the name: a tap opens that player's Overview
  let playerBuild = null; const secBoxes = new Map(), headBoxes = new Map();
  // (update 845) a favorite's card: the line under the name and their numbers (strokes gained total and its tour rank, form,
  // the last 20 rounds as little bars), filled in as the data comes in
  // (update 846) the cards' strokes gained and form coloured on a scale across the cards shown: best green, worst red
  const favGrad = () => { for (const g of ["sg", "fm"]) { const els = [...ovTop.querySelectorAll(`[data-g="${g}"]`)], vs = els.map((x) => Number(x.dataset.v)).filter(Number.isFinite), lo = Math.min(...vs), hi = Math.max(...vs);
    for (const x of els) { const v = Number(x.dataset.v); x.style.color = !Number.isFinite(v) ? "" : gradC(divV(v, vs)); } void lo; void hi; } }; // (update 853: diverging at 0)
  const fillHead = (k) => { const hb = headBoxes.get(k); if (!hb) return; try {
    // (update 847) the DP World Tour's numbers are a value an event (eventLevel): counted as events, its bars an event each
    const SY = seasonYr(), raw = sgRounds(rawOf(playerOf(k))), byEv = raw.length > 0 && raw.every((r) => r.eventLevel), all = byEv ? eventsOf(raw).map((e) => ({ ...e.rs[0], shots: [{ cat: "x", sg: avgOf(e.rs, tot) }], date: e.end })) : raw.filter((r) => !r.eventLevel), rs = all.filter((r) => yrOf(r) === SY);
    const tn = tourPick && tourPick !== ALL ? tourName(tourPick) : "every tour";
    if (!rs.length) { hb.sub.textContent = field.length ? `No rounds on ${tourPick && tourPick !== ALL ? `the ${tn}` : "record"} in ${SY}` : "Loading…"; mount(hb.stats, []); return; }
    const R = ranksFor(SY).by, rk = R.TOTAL?.get(k), n = R["TOTAL#"], av = avgOf(rs, tot), fm = formAll.get(k)?.x;
    const ent = fieldsPI ? ["R", "H"].flatMap((c) => fieldsPI.fieldEventsSync(nameOf(k), c) || []).sort((a, b) => String(a.start).localeCompare(String(b.start)))[0] : null;
    hb.sub.textContent = [tn, `${rs.length} ${byEv ? "events" : "rounds"} in ${SY}`, ent ? `Next: ${fullEv(ent.name)}` : null].filter(Boolean).join(" · ");
    const last = all.slice(-20), mx = Math.max(0.5, ...last.map((r) => Math.abs(tot(r)))), W = 100, H = 30, bw = W / Math.max(1, last.length);
    const svg = mk0("svg", { viewBox: `0 0 ${W} ${H}`, class: "td-fav-spark", "aria-hidden": "true" }); svg.append(mk0("line", { x1: 0, x2: W, y1: H / 2, y2: H / 2, class: "td-fav-zero" }));
    last.forEach((r, i) => { const v = tot(r), h = Math.max(1, (Math.abs(v) / mx) * (H / 2 - 1)); svg.append(mk0("rect", { x: (i * bw + bw * 0.15).toFixed(1), y: (v >= 0 ? H / 2 - h : H / 2).toFixed(1), width: (bw * 0.7).toFixed(1), height: h.toFixed(1), rx: 0.8, class: v >= 0 ? "up" : "down" })); });
    const stat = (big, lab, g, v) => el("div", { class: "td-fav-stat" }, [el("strong", { "data-g": g, "data-v": String(v) }, big), el("span", {}, lab)]);
    mount(hb.stats, [stat(sg2(av), rk ? `SG: Total · ${ord1(rk)} of ${n}` : "SG: Total per round", "sg", av),
      fm ? stat(`${fm.d >= 0 ? "▲" : "▼"} ${Math.abs(fm.d).toFixed(2)}`, `form, last ${fm.n}${/event/.test(fm.FL || "") ? " events" : ""}`, "fm", fm.d) : null,
      el("div", { class: "td-fav-sparkw", title: "The last 20 rounds, strokes gained total" }, svg)]);
  } catch (e) { console.warn("favorite card", e); } }; // (update 839) a favorite's row: its sections' box
  const fillSecs = (k) => { const b = secBoxes.get(k); if (!b || !playerBuild) return; const r0 = playerBuild(k);
    mount(b, r0.laid.length ? el("div", { class: "td-grid" }, r0.laid) : el("p", { class: "td-wait" }, "No stories about them yet.")); };
  const hasSeason = (k) => { try { const SY = seasonYr(); return !field.length || sgRounds(rawOf(playerOf(k))).some((r) => yrOf(r) === SY); } catch { return true; } };
  const ovKeys = () => (selfKey ? [selfKey] : picked.size ? [...picked] : (favs.length ? favs : keys).filter((k, i, a) => a.indexOf(k) === i).filter(hasSeason)); // (update 847: none without rounds on the tour picked)
  const ovTop = el("section", { class: "td-ov" }), frontBox = el("div", { class: "td-frontbox" }); // (update 837: the front page above it)
  async function drawOvTop() {
    if (isFresh()) { mount(ovTop, []); ovTop.dataset.sig = ""; return; } // (update 863: a new account's page has no favorites row)
    const ks = ovKeys();
    const sig = `${ks.join(",")}|${tourPick}`; if (ovTop.dataset.sig === sig) return; ovTop.dataset.sig = sig; secBoxes.clear(); headBoxes.clear();
    if (!ks.length) { mount(ovTop, []); return; }
    if (selfKey || picked.size) { mount(ovTop, []); return; } // (update 847: one player picked (or your own); a filtered list of one still shows) // (update 841: no overview on Home; one player's sections are the page's)
    // (update 846) a section like the others; each card opens that player's pages, as picking them in Search does
    mount(ovTop, el("section", { class: "td-sec full td-favsec", id: "td-fav", "data-sec": "fav" }, [el("div", { class: "td-sh" }, [el("h2", {}, favs.length ? "Your favorites" : "Your players"), el("span", {}, "Tap a player for their Home")]),
      el("div", { class: "td-favs" }, ks.map((k) => {
        // (update 845) a card: initials, the name and a line under it (tour, rounds, next event), then their numbers
        const nm = nameOf(k), ini = nm.split(/\s+/).filter(Boolean).map((w) => w[0]).filter((ch) => /[A-Z]/.test(ch)).slice(0, 1).concat(nm.split(/\s+/).filter(Boolean).slice(-1).map((w) => w[0].toUpperCase())).join("");
        const hb = { sub: el("span", { class: "td-fav-sub" }, ""), stats: el("div", { class: "td-fav-stats" }) }; headBoxes.set(k, hb);
        const card = el("button", { type: "button", class: "td-fav", title: `Open ${nm}'s pages` }, [el("span", { class: "td-fav-av", "aria-hidden": "true", style: `--h:${Math.round(hash(nm) * 360)}` }, ini),
          el("div", { class: "td-fav-id" }, [el("strong", {}, nm), hb.sub]), hb.stats, el("span", { class: "td-ov-chev", "aria-hidden": "true" }, "›")]);
        card.addEventListener("click", () => { setCurrent({ key: k, label: nm }); window.scrollTo({ top: 0 }); }); // (update 848: their Home, as the header's player) void openStatsTab;
        fillHead(k); return card; }))]));
    favGrad();
  }
  mount(root, [ // (update 839: the Daily Tour Report and its headings first, then the front page, Your favorites, the sections)
    el("header", { class: "td-mast" }, el("h1", {}, ["Your Tour ", el("i", {}, "Report")]) /* (update 849: was Daily Tour Report) */ /* (update 776) */), /* (update 750: was "The Daily Tour") */
    el("div", { class: "td-date" }, [el("span", {}, today), edition, nextLine]),
    el("div", { class: "td-nav" }, [tourRow, whoRow] /* (update 798: no Ask Cal bar on Home) */),
    secNav, frontBox, ovTop, feed, asked,
    el("div", { class: "td-foot" }, "Your Tour Report · tap any story to dig deeper"),
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
  let GEARN = 14; /* (update 802: every favorite on a computer, not the first 6; 808: all 12 favorites and you) */ (() => { try { if (matchMedia("(hover: none) and (pointer: coarse)").matches) GEARN = 4; } catch { /* */ } })(); /* (update 820: only a phone holds fewer; a big stats file on a computer no longer cut it to 2, which left Equipment with one player) */ void import("../fieldCache.js").catch(() => {});
  let keys = [];

  // ---- the highlights ----
  // { score (what matters most first), kind (Result, Milestone, Trend, Rank, Equipment, Next event, Practice, Tour), k (the
  //   player), title, detail, to ("Stats · Tournaments"), run () }
  const sg2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  // (update 848) Course Strategy's event: the one picked with Change event (kept on this device), else The American Express
  const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), evCore = (n) => String(n || "").replace(/^the\s+/i, "").replace(/\s+(presented|powered|hosted|sponsored)\s+by\b.*$/i, "").trim();
  const mkUP = (name, course) => ({ name, re: new RegExp(escRe(evCore(name)), "i"), course: course ? new RegExp(escRe(course), "i") : /(?!)/, not: /(?!)/ });
  const UP0 = { name: "The American Express", re: /american express|amex\b/i, course: /pete dye stadium|pga west|la quinta/i, not: /sawgrass|tpc/i }; /* (update 737: the Pete Dye Stadium Course at PGA West) */ /* (update 736) */
  let UPCOMING = (() => { try { const v = JSON.parse(localStorage.getItem("ta.homeEvent") || "null"); return v?.name ? mkUP(v.name, v.course) : UP0; } catch { return UP0; } })();
  // the pick: every tournament with a course in Strategy Maps, in the schedule's order (the next ones first)
  async function changeEvent() {
    await heatP; const { popup } = await import("./insightPages.js"), PI = await import("../playerInsights.js");
    const evs = new Map(); for (const h of heat || []) for (const e of h.events || []) if (e?.name && !evs.has(evCore(e.name).toLowerCase())) evs.set(evCore(e.name).toLowerCase(), { name: e.name, course: h.name, shots: !!h.rawChunks });
    const names = [...evs.values()].map((e) => e.name), SO = await PI.scheduleOrder(names, tourPick && tourPick !== ALL ? tourPick : "PGA").catch(() => ({ on: names.map((n) => ({ name: n })), off: [] }));
    const up = (await PI.upcomingFor(tourPick && tourPick !== ALL ? tourPick : "PGA").catch(() => ({ list: [] }))).list.map((e) => PI.matchEventName(e.name, names)).filter(Boolean);
    const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short" }) : "");
    const byN = (n) => [...evs.values()].find((e) => e.name === n);
    let close = null;
    const row = (n, sub) => { const e = byN(n), b = el("button", { type: "button", class: `ip-evrow${n === UPCOMING.name ? " on" : ""}` }, [el("b", {}, n), el("span", {}, [e?.course || "", sub ? ` · ${sub}` : "", e?.shots ? "" : " · holes only"].join(""))]);
      b.addEventListener("click", () => { pickEvent(e); close?.(); }); return b; };
    const reset = el("button", { type: "button", class: "ip-evrow" }, [el("b", {}, "Back to the default"), el("span", {}, UP0.name)]); reset.addEventListener("click", () => { pickEvent(null); close?.(); });
    close = popup("Course Strategy for…", [up.length ? el("p", { class: "cf-sub" }, "Coming up on the schedule") : null, up.length ? el("div", { class: "ip-evlist" }, [...new Set(up)].slice(0, 8).map((n) => row(n, "next"))) : null,
      el("p", { class: "cf-sub" }, "Every tournament with its course in Strategy Maps, in schedule order"), el("div", { class: "ip-evlist" }, [...SO.on.map((o) => row(o.name, fmt(o.start))), ...SO.off.map((n) => row(n, ""))]),
      el("div", { class: "ip-evlist" }, [reset])], "Change event");
  }
  function pickEvent(e) {
    try { if (e) localStorage.setItem("ta.homeEvent", JSON.stringify({ name: e.name, course: e.course })); else localStorage.removeItem("ta.homeEvent"); } catch { /* */ }
    UPCOMING = e ? mkUP(e.name, e.course) : UP0; upHoles = null; upRaw = null; factMemo = null;
    if (lastItems) drawFeed(collect()); loadUpCourse().catch(() => {});
    requestAnimationFrame(() => document.getElementById("td-course")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
  // ---- (update 731) the newspaper ----
  const SEC = { res: ["Results & Milestones", "The week’s best and worst"], form: ["Form", "The last 12 rounds against the 12 before"], gear: ["Equipment", "New in the bag"],
    rank: ["Ranks", "Where they stand on tour"], fact: ["Did You Know?", ""], bestwk: ["Best Week", "Their best weeks of the season: overall, each part of the game, each distance"], spot: ["Player Spotlight", "Strengths, steadiness and what drives the good weeks"], focus: ["Where to Improve", "The biggest leak, and the fix"], next: ["This Week", ""], prac: ["Practice", "On the range"], tour: ["Around the Tour", "Briefs"], course: ["Course Strategy", `Up next: ${UPCOMING.name}`] };
  const SEC_OF = { Result: "res", Milestone: "res", Trend: "form", Slide: "form", Rank: "rank", Equipment: "gear", Focus: "focus", "Next event": "next", Practice: "prac", Tour: "tour", Course: "course", Spotlight: "spot", Fact: "fact", "Best week": "bestwk" };
  // (update 780) Player Spotlight beside Where to Improve, then Equipment, Rankings and Results & Milestones as a row of three
  const ORDER = ROLE === "caddy" ? ["next", "course", "fact", "spot", "focus", "res", "prac", "tour"] : ["fact", "spot", "focus", "res", "next", "course", "prac", "tour"]; // (update 839: no Form or Equipment sections)
  const PLAYER_IDS = ["rank", "bestwk", "fact", "spot", "focus", "res", "next", "course", "prac"]; // (update 839) inside a favorite's row (841: and Did You Know)
  const PAIR = ["spot", "focus"], TRIO = []; // (update 821: no Rankings; Equipment full width, two a row) // (update 789: Equipment beside Rankings; Results & Milestones full width below)
  const FULL = new Set(["form", "tour", "course", "fact", "res", "gear", "rank", "bestwk"]);
  // (update 831) one player (picked in the header, or a player's own Home): no Did You Know; Ranks and Best Week in its place
  const solo = () => !!selfKey || picked.size === 1;
  const orderNow = () => (solo() ? ORDER.flatMap((id) => (id === "fact" ? ["rank", "bestwk"] : [id])) : ORDER); // (update 849: no Did You Know for one player: their At a glance is beside the hero)
  const CATW = { OTT: "driving", APP: "approach play", ARG: "short game", PUTT: "putting" };
  const ordN = (r) => (r === 1 ? "No. 1" : `${r}${["th", "st", "nd", "rd"][((r % 100) - 20) % 10] || ["th", "st", "nd", "rd"][r % 100] || "th"}`);
  const rkName = (c) => (c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase());
  const sur = (k) => firstOf(k); // (update 820: "van Rooyen", as firstOf (the surname) does)
  const cls = (v) => (v > 0.005 ? "up" : v < -0.005 ? "down" : "");
  // headline, number and the kicker over it, for each kind of highlight (a player's own Home: the card's own wording)
  function dress(h) {
    const k = h.k, x = h.x || {}, S = k ? sur(k) : "", me = k && isMe(k), t = h.id.split("-")[0];
    const o = { kick: h.kick ?? (h.kind === "Course" ? "" : h.kind), hl: h.title, /* (update 745: no "Course" over the course cards) */ deck: h.detail || "", num: null, nc: "", cap: "" };
    if (t === "ev") { o.kick = x.best ? "Milestone" : x.worst ? "Rough week" : "Result"; o.hl = me ? h.title : x.best ? `${poss(S)} best week of ${x.yr}, at ${x.ev}` : x.worst ? `A tough week for ${S} at ${x.ev}` : x.d > 0 ? `${S} beats the ${x.yr} average at ${x.ev}` : `${S} slips below the ${x.yr} average at ${x.ev}`; o.num = sg2(x.v); o.nc = cls(x.v); o.cap = `strokes gained total per round, over ${x.n} rounds there`; }
    else if (t === "br") { const on = tourPick && tourPick !== ALL ? `the ${tourName(tourPick)}` : "tour"; o.kick = x.tourBest ? "Best on tour" : "Personal best"; o.hl = x.tourBest ? `${me ? "You" : S} fired the best round on ${on} in ${x.yr}` : me ? h.title : `${poss(S)} best round of ${x.yr}`; o.num = sg2(x.v); o.nc = cls(x.v); o.cap = `strokes gained total, at ${x.ev}${x.tourBest ? "" : ` (${me ? "your" : poss(S)} best this season; not the tour’s best)`}`; }
    else if (t === "st") { o.hl = me ? h.title : `${S} stretches the streak to ${x.n} ${x.unit || "round"}s in the black`; o.num = String(x.n); o.nc = "up"; o.cap = `${x.unit || "round"}s in a row with strokes gained total above zero`; }
    else if (t === "fm") { o.kick = x.d > 0 ? "Trending up" : "Slipping"; o.hl = me ? h.title : x.d > 0 ? `${S} is heating up` : `${S} is cooling off`; o.num = sg2(x.d); o.nc = cls(x.d); o.cap = `change in strokes gained total per round`; } /* (update 854: the before and after are in the line under it) */
    else if (t === "cm") { o.kick = x.d > 0 ? "Trending up" : "Slipping"; o.hl = me ? h.title : x.d > 0 ? `${poss(S)} ${CATW[x.c]} is on the rise` : `${poss(S)} ${CATW[x.c]} slips`; o.num = sg2(x.d); o.nc = cls(x.d); o.cap = `strokes gained per round ${CAT_IN[x.c]}: ${sg2(x.a)} lately, from ${sg2(x.b)}`; }
    else if (t === "fd") { o.kick = x.up ? "Trending up" : "Slipping"; o.nc = x.up ? "up" : "down"; } /* (update 805) */
    else if (t === "wk") { o.kick = CATN[x.c]; o.hl = x.v < 0 ? `${CATN[x.c]} is costing ${me ? "you" : S}` : `${CATN[x.c]}: ${me ? "your" : poss(S)} weakest part of the game`; /* (update 738: the number below, not in the headline; 802: gaining everywhere, the least of it) */ o.num = sg2(x.v); o.nc = x.v < 0 ? "down" : "up"; o.cap = `strokes gained per round ${CAT_IN[x.c]} in ${x.yr}${x.v >= 0 ? ", the lowest of the four" : ""}`; }
    else if (t === "rkb") { const f = x.hits?.[0]; o.kick = "Room to climb"; o.nc = "down"; if (f) { o.hl = `${S} ${ordN(f.r)} of ${f.n} in ${rkName(f.c)}`; o.num = ordN(f.r).replace("No. ", ""); o.cap = `of ${f.n} players in ${x.yr}`; } }
    else if (t === "rk") { const f = x.hits?.[0]; if (f) { o.hl = me ? h.title : `${S} ${ordN(f.r)} on tour in ${rkName(f.c)}`; o.num = ordN(f.r).replace("No. ", ""); o.cap = `of ${f.n} players in ${x.yr}`; } }
    else if (t === "eq") { o.kick = `New ${KIND_WORD[x.pill] || "club"}`; o.hl = x.first ? `The ${x.neu} ${x.dd >= 0 ? "outperforms" : "underperforms"} in ${me ? "your" : `${poss(S)}`} first event with it in the bag` : x.sure === false ? `The ${x.neu} vs the ${x.old}: ${Math.abs(x.dd) < 0.15 ? "level so far" : x.dd > 0 ? "ahead so far" : "behind so far"} ${me ? "for you" : `for ${S}`}, too early to call` : `The ${x.neu} is ${x.dd >= 0 ? "beating" : "trailing"} the ${x.old} ${me ? "for you" : `for ${S}`}, clearly enough to count`; /* (update 760: one event said as one event) */ /* (update 735: whose) */ o.num = sg2(x.dd); o.nc = cls(x.dd); o.cap = `strokes gained per round ${COL_IN[x.c]}, against the ${x.old}`; }
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
  let barWide = false;
  // (update 794) form, round by round: the stretch before in grey, the last stretch green / red, each with its average as a
  // dashed line and label (as Stats' SG chart), across the lead story's full width
  function formRounds(x, cat) { let pr = x.prevR || [], la = x.lastR || []; if (pr.length + la.length < 6 && !/event/.test(x.FL || "")) return null;
    const dist = typeof x.d === "string" ? x.d : null; /* (update 822: x.d is a range's distance in a range story, the change in a part-of-the-game one) */ const f0 = dist ? (r) => r.shots.reduce((t0, s0) => t0 + (s0.cat === x.c && s0.dist === dist ? s0.sg : 0), 0) : cat ? (r) => inCat(r, cat) : tot;
    // (update 805) the DP World Tour (its numbers by event): a bar an event, 3 against 3
    const evM = /event/.test(x.FL || ""); if (evM) { const byE = (rs0) => eventsOf(rs0).map((e) => ({ event: e.event, date: e.end, shots: [], _rs: e.rs })); pr = byE(pr); la = byE(la); }
    const f = evM ? (e) => avgOf(e._rs, f0) : f0, all = [...pr.map((r) => [r, 0]), ...la.map((r) => [r, 1])], vs = all.map(([r]) => f(r));
    const W = 760, H = 210, L = 46, R2 = 10, top = 14, bot = 26, lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y = (v) => top + (hi - v) * sc, bw = (W - L - R2) / all.length;
    const svg = mk0("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "td-bars td-formr", role: "img", "aria-label": "Round by round, before and lately" });
    for (const t0 of [hi, 0, lo]) { svg.append(mk0("line", { x1: L, x2: W - R2, y1: y(t0).toFixed(1), y2: y(t0).toFixed(1), class: t0 === 0 ? "td-zero" : "td-grid" })); svg.append(mk0("text", { x: L - 6, y: (y(t0) + 3).toFixed(1), "text-anchor": "end", class: "td-tx" }, sg2(t0))); }
    all.forEach(([r, g], i) => { const v = f(r), h = Math.max(1.2, Math.abs(v) * sc), x0 = L + i * bw + bw * 0.14; const b = bar0(mk0, { x: x0.toFixed(1), y: (v >= 0 ? y(0) - h : y(0)).toFixed(1), width: (bw * 0.72).toFixed(1), height: h.toFixed(1), rx: 2, class: `td-bar ${g ? (v >= 0 ? "up hot" : "down hot") : "gray"}` }, v >= 0); b.append(mk0("title", {}, `${r.event}${r.roundNo ? ` R${r.roundNo}` : ""}: ${sg2(v)}`)); svg.append(b); });
    const avgLine = (from, to, v, lbl) => { const x1 = L + from * bw, x2 = L + to * bw; svg.append(mk0("line", { x1: x1.toFixed(1), x2: x2.toFixed(1), y1: y(v).toFixed(1), y2: y(v).toFixed(1), class: "td-avgl" })); svg.append(mk0("text", { x: (x2 - 4).toFixed(1), y: (y(v) - 5).toFixed(1), "text-anchor": "end", class: "td-avgt" }, `${lbl} ${sg2(v)}`)); };
    if (pr.length) avgLine(0, pr.length, avgOf(pr, f), `${x.n} before`); if (la.length) avgLine(pr.length, all.length, avgOf(la, f), `Last ${x.n}`);
    const d0 = (r) => String(r.date || "").slice(5, 10).replace("-", "/");
    return el("div", { class: "td-chart" }, [el("div", { class: "td-kick mute" }, `${evM ? "Event by event" : "Round by round"} · ${dist ? `${CATN[x.c]} from ${dist}` : cat ? CATN[cat] : "SG: Total"}${evM ? " (per round)" : ""}`), svg, el("div", { class: "td-strip-ax" }, [el("span", {}, d0(all[0][0])), el("span", {}, d0(all.at(-1)[0]))])]); }
  function barSvg(items, { note } = {}) { if (items.length < 3) return null;
    const W = barWide ? 760 : 320, H = 176, top = 8, bot = 70, /* (update 791: wide, in the lead story's full width) */ /* (update 738: room for a label under every bar) */ vs = items.map((x) => x.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sc = (H - top - bot) / (hi - lo || 1), y0 = top + hi * sc, LP = 46, bw = (W - LP) / items.length; /* (update 738: room on the left for the first labels) */
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
      const rs = (gearData.get(h.k) || []).filter((r) => (ownP?.key === h.k || onTour(r)) && yrOf(r) === seasonYr()); const evs = eventsOf(rs); // (update 851: every tournament of the season, as the table under it counts, not the last 14)
      const items = evs.map((e) => { const m = new Map(); let sgs = 0, n = 0; for (const r of e.rs) { let any = false; for (const s0 of r.shots) { const g = val(s0); if (!g) continue; const nm2 = nmOf(g); if (nm2 !== x.neu && nm2 !== x.old && x.pill !== "Balls") { /* another model */ } m.set(nm2, (m.get(nm2) || 0) + (s0.w || 1)); any = true; if (!x.c || s0.cat === x.c) sgs += s0.sg; } if (any) n++; } /* (that kind of club's shots only, as the product table) */
        const topM = [...m].sort((a2, b2) => b2[1] - a2[1])[0]?.[0]; return n ? { v: sgs / n, label: `${e.event} ${e.year} · ${topM || ""}`, short: shortEv(e.event), cls: (x.all || []).find((m) => m.nm === topM)?.cls || (topM === x.neu ? "m-a" : topM === x.old ? "m-b" : "m-o") } : null; }).filter(Boolean);
      const svg = barSvg(items, { note: "By tournament" }); if (!svg) return null;
      const shownC = new Set(items.map((it) => it.cls)); // (update 851) the legend: only the models that colour a bar
      return [el("div", { class: "td-kick mute" }, `Strokes gained per round ${COL_IN[x.c]}, tournament by tournament`), svg, el("div", { class: "td-legend" }, (x.all || [{ nm: x.neu, cls: "m-a" }, { nm: x.old, cls: "m-b" }]).filter((m) => shownC.has(m.cls)).map((m) => el("span", { class: m.cls }, m.nm))) /* (update 757: the bars' own colors) (update 821: every model) */];
    }
    if (!h.k) return null;
    const p = playerOf(h.k), rs = sgRounds(rawOf(p)).filter((r) => yrOf(r) === seasonYr()); if (!rs.length) return null;
    const f = cat ? (r) => inCat(r, cat) : tot, evs = eventsOf(rs).slice(-14), lastEv = evs.at(-1);
    const items = evs.map((e) => ({ v: avgOf(e.rs, f), label: `${e.event} ${e.year}`, short: shortEv(e.event), hot: e === lastEv }));
    const svg = barSvg(items, { note: "By tournament" }); if (!svg) return null;
    const lbl = catLbl(cat);
    return [el("div", { class: "td-kick mute" }, `${lbl[0].toUpperCase()}${lbl.slice(1)} per round, tournament by tournament`), svg];
  }
  // (update 751) a tap opens the story in a pop-up, here on Home: its headline and detail, its chart, and what's behind it
  // (a ranking: the whole leaderboard; form: every part of the game, before and after; a hole: its picture). The page it
  // came from is still a tap away at the bottom
  const tap = (node, h) => { node.setAttribute("role", "button"); node.tabIndex = 0; node.addEventListener("click", (e) => { if (!e.target.closest("button, a, summary")) openPop(h); }); node.addEventListener("keydown", (e) => { if (e.key === "Enter") openPop(h); }); return node; };
  const boardRows = (b) => { if (b.rows) return b.rows; const F = seasonField(); const win = (rs) => (b.win === "l12" ? rs.filter((r) => !r.eventLevel).slice(-12) : rs);
    if (b.c) { const f = b.c === "TOTAL" ? tot : (r) => inCat(r, b.c); return F.ok.map((p) => { const v = avgOf(win(p.rs), f); return v == null ? null : [p.k, v, `${sg2(v)} per round`]; }).filter(Boolean).sort((a, c2) => c2[1] - a[1]); }
    if (b.key && STAT_DEFS[b.key]) { const def = STAT_DEFS[b.key]; return F.ok.map((p) => { const v = obsAvg(win(p.rs), b.key); return v == null ? null : [p.k, v, fmtStat(def, v)]; }).filter(Boolean).sort((a, c2) => (def.higher ? c2[1] - a[1] : a[1] - c2[1])); }
    return []; };
  const boardTitle = (b) => b.title || (b.c ? `${b.c === "TOTAL" ? "Strokes gained" : `Strokes gained ${CAT_IN[b.c]}`} per round${b.win === "l12" ? ", the last 12 rounds" : `, ${seasonYr()}`}` : b.key ? `${STAT_DEFS[b.key]?.label || b.key}, ${seasonYr()}` : "");
  function boardTable(b) { const rows = boardRows(b); if (!rows.length) return null; const shown = new Set(shownKeys());
    return el("div", { class: "td-pop-board" }, [el("p", { class: "td-kick mute" }, `${boardTitle(b)}${tourPick && tourPick !== ALL ? ` · ${tourName(tourPick)}` : ""} · ${rows.length} players`),
      el("div", { class: "td-pop-scroll" }, el("table", { class: "td-box" }, el("tbody", {}, rows.map(([k2, , txt], i) => el("tr", { class: [shown.has(k2) ? "me" : null, k2 === b.focus ? "target" : null].filter(Boolean).join(" ") || null }, [el("td", { class: `r${i < 20 ? " up" : i >= rows.length - 10 ? " down" : ""}` }, String(i + 1)), el("td", {}, nameOf(k2)), el("td", { class: "v" }, txt)])))))]); }
  function formTable(x, h = null) { return el("table", { class: "td-tape td-ftab" }, [el("thead", {}, el("tr", {}, ["", `Last ${x.n}`, `${x.n} before`, "Change"].map((t2) => el("th", {}, t2)))), /* (update 780: the last stretch first, always) */
    el("tbody", {}, cats.map((c0, i) => { const a = x.rb[i], b = x.ra[i], tr = el("tr", {}, [el("td", {}, h ? [CATN[c0], el("span", { class: "td-ftab-go", "aria-hidden": "true" }, " ›")] : CATN[c0]), el("td", {}, sg2(b)), el("td", {}, sg2(a)), el("td", { class: cls(b - a) }, sg2(b - a))]);
      if (h?.x?.lastR) { tr.classList.add("td-clk"); tr.setAttribute("role", "button"); tr.tabIndex = 0; tr.title = `${CATN[c0]}: round by round and each distance`; const go3 = (e) => { e.stopPropagation(); catPop(h, c0).catch((er) => console.warn(er)); }; tr.addEventListener("click", go3); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go3(e); }); } /* (update 837: a part of the game opens its pop-up) */
      return tr; }))]); }
  // (update 761) How to find it yourself: every highlight with the page, the filters and where to look, so it can be found
  // again (and others like it). The pop-up shows the steps, and its button opens that page with those filters already set,
  // the steps shown again there. { steps: [text], run?: a run that sets the filters }
  function howOf(h) {
    const x = h.x || {}, t = h.id.split("-")[0], k = h.k, SY = seasonYr(), tourT = tourPick && tourPick !== ALL ? tourName(tourPick) : "All tours";
    const who = k ? nameOf(k) : "", cN = (c) => (c && c !== "TOTAL" ? CATN[c] : "All categories (SG: Total)");
    const stats = (more) => [`Open Stats${who ? ` with ${who} picked` : ""} (Player Stats at the top).`, `Filters: Season ${SY} · Tour ${tourT}${more ? ` · ${more}` : ""}.`];
    const board = (c, more) => [`Open Leaderboards.`, `Filters: Season ${SY} · Tour ${tourT} · Part of the game: ${cN(c)}${more ? ` · ${more}` : ""}.`, who ? `Find ${who} in the Rankings table (the rank is their row).` : "The Rankings table is the leaderboard."];
    const sp = h.id.startsWith("sp-") ? h.id.split("-")[1] : null;
    if (sp === "drives") return { steps: [...stats("Strokes Gained · All categories"), "Scroll to Best & worst tournaments: every tournament best to worst, each part of the game beside it.", "The bottom rows average the best 3 and the worst 3; the highlighted Difference is what drives the good weeks."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [] }, "Best & worst tournaments", null) };
    if (sp === "steady") return { steps: [...stats("Strokes Gained"), `Scroll to Ability vs Consistency and pick the ${cN(x.c)} tab.`, "Across: strokes gained per round. Up: how much the rounds swing (lower is steadier). The rank is how many players swing less."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], steadyCat: x.c || "TOTAL" }, "Ability vs Consistency", null) };
    if (sp === "weapon" || sp === "gap" || t === "rk" || t === "rkb") { const c = sp ? x.c : x.hits?.[0]?.c; return { steps: board(c), run: () => toBoard({ year: [SY], cats: c && c !== "TOTAL" ? [c] : [] }, "Rankings", null) }; }
    if (sp === "stat") return { steps: [...board(null), "Change Stat Type at the top to the stat named in the story, then find the player's row."] };
    if (sp === "yoy") return { steps: [`Open Compare${who ? ` with ${who}` : ""}.`, `Pick Seasons: ${Number(SY) - 1} and ${SY}.`, "The Verdict lists each part of the game for both seasons; the biggest change is the story."] };
    if (t === "fm" || t === "cm") return { steps: [`Open Compare${who ? ` with ${who}` : ""}.`, "Pick Last 12 rounds against The 12 before (the DP World Tour: 3 events against 3).", t === "cm" ? `Look at ${CATN[x.c]} in the Verdict, then the stats under it for why.` : "The Verdict shows each part of the game before and after; the radar here is the same numbers.", `Or on Stats: the Form pill on the hero card is the same comparison.`] };
    if (t === "wk") return { steps: [...stats(`Strokes Gained · ${CATN[x.c]}`), `The table lists ${CATN[x.c].toLowerCase()} at each distance: the most negative rows are where the strokes go.`, "Focus (at the top) with the same part of the game ranks them and adds a drill for each."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [x.c] }, null, null) };
    if (t === "ev") return { steps: [...stats("Strokes Gained · All categories"), `Scroll to Best & worst tournaments: ${x.ev} is listed with its place among the season's tournaments.`, "Or tap the events pill on the hero card at the top (e.g. “18 Events”): every tournament of the season as bars, oldest on the left, and as a list with where each finished."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [] }, "Best & worst tournaments", null) };
    if (t === "br" || t === "st") return { steps: [...stats("Strokes Gained · All categories"), "Tap the rounds pill on the hero card at the top (e.g. “64 rounds”): every round of the season as bars, oldest on the left, and as a list with where each ranked that day.", t === "br" ? "The tallest bar is the best round." : "The run of green bars at the right end is the streak."],
      run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], openRounds: true }, null, null) };
    if (t === "eq") return { steps: [...stats("Strokes Gained"), `Scroll to SG Trends by Product and pick ${KIND_WORD[x.pill] || x.pill}.`, "Each bar is a tournament colored by the model used most; the table under it has each model's strokes gained per round and its rounds."] };
    if (t === "fx") { if (h.id.startsWith("fx-wk-")) { const c = h.id.split("-")[2]; return { steps: [...stats(`Strokes Gained · ${CATN[c]}`), "Pick the part of the game in the filters, then tap the events pill on the hero card at the top (e.g. “18 Events”): every tournament of the season as bars, oldest on the left, and as a list with where each finished.", "The tallest bar is the best week."], run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [c], openEvents: true }, null, null) }; }
      if (h.id.startsWith("fx-rd-")) return { steps: [...stats("Strokes Gained"), "Tap the rounds pill on the hero card at the top (e.g. “64 rounds”): every round of the season as bars, oldest on the left, and as a list with where each ranked that day.", "The tallest bar is the round; Leaderboards with the Round filter shows where it ranks among every round on tour."], run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], openRounds: true }, null, null) };
      const b = h.board || {}; const dist = /· ([^·]+) · /.exec(h.fx?.lbl || "")?.[1];
      return { steps: board(b.c, `${dist && !b.c ? `Distance: ${dist} · ` : ""}${b.win === "l12" ? "Last 12 rounds (Range filter)" : ""}`.replace(/ · $/, "")), run: b.c ? () => toBoard({ year: [SY], cats: cats.includes(b.c) ? [b.c] : [], ...(b.win === "l12" ? { span: "12" } : {}) }, "Rankings", null) : null }; }
    if (t === "dz" || t === "lie") return { steps: [...stats(`Strokes Gained · ${CATN[x.c] || "the part of the game"}`), "The table breaks it down by distance (and the Lie filter by lie): strokes gained per round in each.", "Focus with the same part of the game ranks the ranges and gives a drill."] };
    if (t === "up") return { steps: h.id.startsWith("up-me") ? [...stats(`Tournament: ${UPCOMING.name} (every year)`).map((x0) => x0.replace(`Season ${SY} · `, "Season: all · ")), "The hero card's strokes gained is the record here; take the Tournament filter off to compare with every other week."]
      : ["Open Course Prep, then Strategy Maps for the course.", "Pick the hole: the map shows every shot the field hit there, colored by how it scored.", "Turn on Cal's Targets for where to aim and where to miss; tap a circle for its shots and scoring."] };
    if (t === "tb") return { steps: board(h.board?.c || null) };
    // (update 842) the newer cards: a distance's rank and the SG: Total rank (Leaderboards), and At a glance (Stats)
    if (t === "ds" && x.c) return { steps: board(x.c, `Distance: ${x.d}`), run: () => toBoard({ year: [SY], cats: [x.c], dist: [x.d] }, "Rankings", null) };
    if (t === "fs") return { steps: board(null), run: () => toBoard({ year: [SY], cats: [] }, "Rankings", null) };
    if (t === "gl") { const g = h.id.split("-")[1];
      if (g === "steady") { const c = cats.find((c0) => h.kick?.includes(CATN[c0])) || null; return { steps: [...stats("Strokes Gained"), `Scroll to Ability vs Consistency and pick the ${cN(c)} tab.`, "Up: how much the rounds swing (lower is steadier); their dot is highlighted."], run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], steadyCat: c || "TOTAL" }, "Ability vs Consistency", null) }; }
      if (g === "up") return { steps: [...stats("Strokes Gained"), "Pick the part of the game in the filters, then tap the rounds pill on the hero card at the top (e.g. “64 rounds”): every round of the season as bars, oldest on the left, and as a list with where each ranked that day.", "The best 12-round stretch is the highest run of bars; Comparisons can line it up against the season too."], run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], openRounds: true }, null, null) };
      return { steps: [...stats("Strokes Gained · All categories"), "Tap the rounds pill on the hero card at the top (e.g. “64 rounds”): every round of the season as bars, oldest on the left, and as a list with where each ranked that day.", g === "run" ? "The longest unbroken run of green bars is the best run." : "Every green bar is a round in the green."], run: () => toStats(k, { view2: "full", year: [SY], span: 0, cats: [], openRounds: true }, null, null) }; }
    return { steps: [`Open ${h.to || "the page"}.`] };
  }
  function openPop(h) {
    document.querySelector(".td-popwrap")?.remove();
    const d = dress(h), x = h.x || {}, t = h.id.split("-")[0], parts = [];
    if (h.hole && h.cid) { const meta = heat?.find((m) => m.id === h.cid); if (meta) { const img = el("img", { class: "td-pop-hole", alt: `Hole ${h.hole}` }); import("../courseHeat.js").then((m) => m.heatImage(meta, h.hole)).then((u) => { if (u) img.src = u; else img.remove(); }).catch(() => img.remove()); parts.push(img); } }
    else { const ch = chartFor(h) || (h.k && (h.id.startsWith("eq-") || catOf(h)) ? (() => { const b = storyBars(h, catOf(h)); return b ? el("div", { class: "td-chart" }, b) : null; })() : null); if (ch) parts.push(ch); }
    if (t === "fm" && x.ra) parts.push(formTable(x));
    const placeEl = t === "fm" && x.fRk ? el("p", { class: "td-place td-pop-place" }, formPlace(x)) : null; // (update 854: its place on tour)
    if (h.id.startsWith("eq-") && x.A) parts.push(el("table", { class: "td-tape" }, [el("thead", {}, el("tr", {}, ["Model", `SG ${COL_IN[x.c]}`, "Rounds", "Events"].map((t2) => el("th", {}, t2)))), el("tbody", {}, (x.all ? x.all.map((m) => [m.nm, m.r, m.cls]) : [[x.neu, x.A], [x.old, x.B]]).map(([nm2, r, mc]) => el("tr", {}, [el("td", {}, [mc ? el("i", { class: `td-sw ${mc}` }) : null, nm2]), el("td", { class: cls(r.v) }, sg2(r.v)), el("td", {}, String(r.n)), el("td", {}, String(r.ev))])))]));
    // the leaderboard behind a ranking
    const bd = h.board || x.board || (t === "rk" || t === "rkb" ? { c: x.hits?.[0]?.c } : h.id.startsWith("sp-weapon") ? { c: x.c } : null);
    if (bd) { const tb = boardTable({ ...bd, focus: h.k }); if (tb) parts.push(tb); }
    if (h.id === "tb-kings") for (const c0 of cats) { const tb = boardTable({ c: c0 }); if (tb) parts.push(tb); }
    if (t === "rk" && x.hits?.length > 1) for (const f of x.hits.slice(1, 3)) { const tb = boardTable({ c: f.c }); if (tb) parts.push(tb); }
    const close = () => wrap.remove(), xb = el("button", { type: "button", class: "td-pop-x", "aria-label": "Close" }, "×"); xb.addEventListener("click", close);
    const how = howOf(h), go0 = how.run || h.run, d0 = d;
    const howBox = how.steps?.length ? el("details", { class: "td-how" }, [el("summary", { class: "td-kick mute" }, "How to find this yourself"), el("ol", {}, how.steps.map((x0) => el("li", {}, x0)))]) : null; // (update 854: folded away)
    const goB = go0 ? el("button", { type: "button", class: "td-pop-go" }, `Open ${/^Open ([A-Z][\w ]*?)(?: with| \(|\.|,|$)/.exec(how.steps?.[0] || "")?.[1] || String(h.to || "the page").split(" · ")[0]} with these filters →` /* (update 762: the page the steps name) */) : null;
    goB?.addEventListener("click", () => { close(); go0(); if (how.steps?.length) queueExplain({ id: `how-${h.id.split("-")[0]}`, q: d0.hl, steps: how.steps }); }); // (update 761: the steps again on the page)
    const back = el("div", { class: "td-pop-back" }); back.addEventListener("click", close);
    const box = el("section", { class: "td-pop", role: "dialog", "aria-modal": "true", "aria-label": d.hl }, [xb, d.kick || (staff && h.k) ? el("div", { class: "td-kick" }, `${d.kick || ""}${staff && h.k ? `${d.kick ? " · " : ""}${nameOf(h.k)}` : ""}`) : null, el("h2", {}, d.hl),
      d.num ? el("div", { class: `td-big ${d.nc}` }, [d.num, el("span", { class: "td-cap" }, ` ${d.cap}`)]) : null, d.deck ? deckEl(d.deck, "td-pop-deck") : null, placeEl, parts.length ? el("div", { class: `td-pop-body${parts.length > 1 ? " two" : ""}` }, parts) : null, el("div", { class: "td-pop-foot" }, [goB, howBox])]); // (update 854: the charts and tables side by side, centred)
    const wrap = el("div", { class: "ah td td-popwrap" }, [back, box]); document.body.appendChild(wrap);
    // (update 854) always on the screen whole: shrink it (all of it, type included) until it fits; only past 60% does it scroll
    const fit = () => { if (!box.isConnected) return; box.style.zoom = ""; box.style.maxHeight = ""; box.classList.remove("td-pop-scrolls");
      const room = innerHeight - 24, over = () => { const r0 = box.getBoundingClientRect(); return r0.height > room || r0.top < 6 || r0.bottom > innerHeight - 6; };
      let z = 1; while (z > 0.6 && over()) { z = Math.round((z - 0.04) * 100) / 100; box.style.zoom = String(z); }
      if (over()) { box.style.maxHeight = `${Math.floor(room / z)}px`; box.classList.add("td-pop-scrolls"); } };
    requestAnimationFrame(fit); setTimeout(fit, 350); box.addEventListener("toggle", () => requestAnimationFrame(fit), true); addEventListener("resize", fit, { once: true });
    const esc = (e) => { if (e.key === "Escape") { close(); removeEventListener("keydown", esc); } }; addEventListener("keydown", esc); xb.focus();
    // (update 758) a leaderboard opens at the player
    requestAnimationFrame(() => { const row = box.querySelector("tr.target"), sc0 = row?.closest(".td-pop-scroll"); if (row && sc0) sc0.scrollTop = Math.max(0, row.offsetTop - sc0.clientHeight / 2 + row.offsetHeight / 2); });
  }
  const more = (h) => { const [pg, ...rest] = h.to.split(" · "); return el("span", { class: "td-more" }, `${pg}${rest.length ? ` · ${rest.join(" · ")}` : ""} →`); };
  const whoTag = (h) => (staff && h.k ? el("div", { class: "td-who" }, nameOf(h.k)) : null);
  const kicker = (h, d, withWho) => (!d.kick && !(withWho && staff && h.k) ? null : el("div", { class: `td-kick${d.nc === "down" && /Slipping|Rough/.test(d.kick) ? " down" : ""}` }, `${d.kick}${withWho && staff && h.k ? ` · ${nameOf(h.k)}` : ""}`.replace(/^ · /, "")));
  function leadStory(h) {
    const cat = catOf(h), d = dress(h), c = h.k ? ctxOf(h.k, cat) : null, lbl = catLbl(cat);
    const body = [d.deck ? deckEl(d.deck) : null];
    // (update 732) the season line and the chart: the same part of the game as the story, and it says which
    if (c) body.push(el("p", {}, `${cat ? `${CATN[cat]}: ` : ""}${isMe(h.k) ? "you’re" : `${nameOf(h.k)} is`} averaging ${sg2(c.avg)} ${lbl} per round in ${c.yr}${tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : ""}, over ${c.n} round${c.n === 1 ? "" : "s"} (${c.ev} tournament${c.ev === 1 ? "" : "s"}).`.replace(/^./, (m) => m.toUpperCase())));
    if (h.id.startsWith("fm-") && h.x?.fRk) body.push(el("p", { class: "td-place" }, formPlace(h.x))); // (update 852: its place on tour)
    // (update 754) the picture: three numbers (the season, the tour rank, the latest tournament), every round this season as a
    // strip of squares (green gaining, red losing, brighter the bigger), and the story's own chart (a radar, a scatter, the
    // hole…); a club: its bars by model
    const isEq = h.id.startsWith("eq-"), viz = [];
    if (h.k) { const p0 = playerOf(h.k), SY = seasonYr(), rs = sgRounds(rawOf(p0)).filter((r) => yrOf(r) === SY), f = cat ? (r) => inCat(r, cat) : tot;
      if (rs.length) { const R = ranksFor(SY).by, rk = R[cat || "TOTAL"]?.get(h.k), n = R[`${cat || "TOTAL"}#`], le = eventsOf(rs).at(-1), lv = le ? avgOf(le.rs, f) : null, av = avgOf(rs, f);
        const tile = (big, small, c0 = "") => el("div", { class: "td-tile" }, [el("strong", { class: c0 }, big), el("span", {}, small)]);
        // (update 761) the three numbers are the story's own (before, after, the change …); the season's only when the story has none
        const x = h.x || {}, t0 = h.id.split("-")[0], nmC = cat ? CATN[cat] : "SG: Total", own3 = t0 === "fm" || t0 === "cm" ? [tile(sg2(x.a), `${nmC}, last ${x.n || 12}${/event/.test(x.FL || "") ? " events" : ""}`, cls(x.a)), tile(sg2(x.b), `${nmC}, ${x.n || 12}${/event/.test(x.FL || "") ? " events" : ""} before`, cls(x.b)), tile(sg2(x.d), "the change", cls(x.d))]
          : t0 === "eq" && x.A ? [tile(sg2(x.B.v), `the ${x.old} (${x.B.n} rds)`, cls(x.B.v)), tile(sg2(x.A.v), `the ${x.neu} (${x.A.n} rds)`, cls(x.A.v)), tile(sg2(x.dd), "the difference", cls(x.dd))]
          : t0 === "ev" && x.v != null ? [tile(sg2(x.v), `per round at ${fullEv(x.ev)}`, cls(x.v)), tile(sg2(av), `${SY} average`, cls(av)), tile(sg2(x.d), "against the average", cls(x.d))]
          : t0 === "br" && x.v != null ? [tile(sg2(x.v), `the round, at ${fullEv(x.ev)}`, cls(x.v)), tile(sg2(av), `per round in ${SY}`, cls(av)), rk ? tile(ordN(rk).replace("No. ", "#"), `on tour, of ${n}`) : null]
          : t0 === "st" && x.n ? [tile(String(x.n), `${x.unit || "round"}s in a row gaining`, "up"), tile(sg2(x.avg ?? avgOf(rs.slice(-x.n), tot)), "per round in the streak", "up"), tile(sg2(av), `per round in ${SY}`, cls(av))]
          : t0 === "wk" && x.v != null ? [tile(sg2(x.v), `${CATN[x.c]} per round`, cls(x.v)), rk ? tile(ordN(rk).replace("No. ", "#"), `in ${CATN[x.c].toLowerCase()}, of ${n}`) : null, tile(sg2(avgOf(rs, tot)), `SG: Total per round`, cls(avgOf(rs, tot)))]
          : null;
        // (update 789) a fourth number: how steady they are in it (their round-to-round swing and its rank)
        const st4 = (() => { try { const F = seasonField(); if (F.ok.length < 10) return null; const sds = F.ok.map((p1) => [p1.k, sdOf(p1.rs.filter((r) => !r.eventLevel).map(f))]).filter((x1) => x1[1] != null).sort((a, b) => a[1] - b[1]), i1 = sds.findIndex((x1) => x1[0] === h.k);
          return i1 < 0 ? null : tile(`±${sds[i1][1].toFixed(2)}`, `round-to-round swing ${cat ? CAT_IN[cat] : "in strokes gained"}, ${ordN(i1 + 1).replace("No. ", "")} steadiest of ${sds.length}`); } catch { return null; } })();
        viz.push(el("div", { class: "td-tiles" }, own3 || [tile(sg2(av), `${cat ? CATN[cat] : "Strokes gained"} per round, ${SY}`, cls(av)), rk ? tile(ordN(rk).replace("No. ", "#"), `on tour, of ${n}`) : tile(String(rs.length), `rounds in ${SY}`), le ? tile(sg2(lv), `${cat ? CATN[cat] : "SG: Total"} per round in ${isMe(h.k) ? "your" : "their"} last event, ${fullEv(le.event)}${(() => { const at = field.map((p1) => { const r1 = sgRounds(rawOf(p1)).filter((r) => r.event === le.event && yrOf(r) === SY); return r1.length >= 2 || (r1.length && p1.key === h.k) ? [p1.key, avgOf(r1, f)] : null; }).filter(Boolean).sort((a, b) => b[1] - a[1]), i1 = at.findIndex((x1) => x1[0] === h.k); return i1 >= 0 && at.length >= 5 ? ` · ${ordN(i1 + 1).replace("No. ", "")} of ${at.length} there` : ""; })()}`, cls(lv)) /* (update 787: and where it ranked there) */ : null, st4] /* (update 785: why it's there) */));
        const last = rs.filter((r) => !r.eventLevel).slice(-30), mx = Math.max(1, ...last.map((r) => Math.abs(f(r))));
        if (false && last.length >= 6 && !isEq) viz.push( /* (update 770: no round-by-round strip) */ /* (update 762: a club change: its bars by model instead) */el("div", { class: "td-strip-w" }, [el("div", { class: "td-kick mute" }, `Round by round · ${cat ? CATN[cat] : "strokes gained"}`), el("div", { class: "td-strip" }, last.map((r) => { const v = f(r); return el("i", { class: v >= 0 ? "up" : "down", style: `opacity:${(0.25 + 0.75 * Math.min(1, Math.abs(v) / mx)).toFixed(2)}`, title: `${r.event}${r.roundNo ? ` R${r.roundNo}` : ""}: ${sg2(v)}` }); })),
          el("div", { class: "td-strip-ax" }, [el("span", {}, shortEv(last[0].event)), el("span", {}, shortEv(last.at(-1).event))])])); } }
    // (update 788) what fills the space, by the kind of story: a rank, the leaderboard around the player (the top 10, or the
    // 4 either side); a best round, every round of the season; a result or a streak, the season tournament by tournament;
    // anything else, ability against consistency
    const miniBoard = (b) => { const rows = boardRows(b); const i = rows.findIndex((r) => r[0] === h.k); if (i < 0 || rows.length < 5) return null;
      const lo = i < 5 ? 0 : Math.max(0, i - 2), hi = i < 5 ? Math.min(rows.length, 5) : Math.min(rows.length, i + 3); // (update 790: 5 rows, compact)
      return el("div", { class: "td-chart td-mini-board" }, [el("div", { class: "td-kick mute" }, `${boardTitle(b)} · ${rows.length} players`), el("table", { class: "td-box" }, el("tbody", {}, rows.slice(lo, hi).map(([k2, , txt], j) => el("tr", { class: k2 === h.k ? "target" : null }, [el("td", { class: "r" }, String(lo + j + 1)), el("td", {}, nameOf(k2)), el("td", { class: "v" }, txt)]))))]); };
    const fillFor = () => { const t0 = h.id.split("-")[0], x0 = h.x || {};
      if (t0 === "br") return chartFor(h);
      if (t0 === "ev" || t0 === "st") { const b = storyBars(h, cat); return b ? el("div", { class: "td-chart" }, b) : null; }
      const bd = h.board || x0.board || (t0 === "rk" || t0 === "rkb" ? { c: x0.hits?.[0]?.c } : /^sp-(weapon|gap)/.test(h.id) ? { c: x0.c } : null);
      return (bd && bd.c !== undefined || bd?.key || bd?.rows ? miniBoard(bd) : null) || steadyFor(); };
    const steadyFor = () => { if (!h.k) return null; const F = seasonField(); if (F.ok.length < 10) return null; const fC = cat ? (r) => inCat(r, cat) : tot;
      const pts = F.ok.map((p1) => { const rs1 = p1.rs.filter((r) => !r.eventLevel); const sd = sdOf(rs1.map(fC)); return sd == null ? null : { x: avgOf(p1.rs, fC), y: sd, label: nameOf(p1.k), hot: p1.k === h.k }; }).filter(Boolean);
      const sv = pts.some((q) => q.hot) ? scatterSvg(pts, { xLab: `Strokes gained ${cat ? CAT_IN[cat] : "total"}`, yLab: "Swing", fmtX: sg2 }) : null;
      return sv ? el("div", { class: "td-chart" }, [el("div", { class: "td-kick mute" }, `Ability vs consistency · ${cat ? CATN[cat] : "SG: Total"} · ${seasonYr()}`), sv]) : null; };
    const isForm = /^(fm|cm|fd)-/.test(h.id) && h.x?.lastR, wideT = (/^(br|ev|st)-/.test(h.id) || isForm) && viz.length > 0; barWide = wideT; // (update 791: a result's bars across the whole story, under the words and the numbers)
    const own = isForm ? formRounds(h.x, /^(cm|fd)-/.test(h.id) ? h.x.c : null) : (isEq ? (() => { const b = storyBars(h, cat); return b ? el("div", { class: "td-chart" }, b) : null; })() : /^(ev|br|st|rk|rkb)-/.test(h.id) ? null : chartFor(h)) || (/^(fm|eq)-/.test(h.id) ? null : fillFor()); /* (update 787/788: no chart of its own: one picked for the story fills the space) */
    // (update 761) the story's chart under the words (no empty column beside a tall figure); the form story's table beside
    // (update 762) form: the before / after table only (the radar repeats the Form section below); a club change: its
    // bars by model up beside the words, under the three numbers
    const isFm = h.id.startsWith("fm-") && h.x?.ra; let wideEl = null;
    if (isFm) viz.push(formTable(h.x, h));
    if (isForm && own) wideEl = own;
    else if (isFm) { /* (the table only) */ }
    else if (own && (!viz.length || isEq)) viz.push(own); else if (own && wideT) wideEl = own; else if (own) body.push(own);
    barWide = false;
    const fig = viz.length ? el("div", { class: "td-fig" }, viz) : null;
    return tap(el("article", { class: "td-lead" }, [kicker(h, d, true), el("h2", {}, d.hl), /* (update 792: no "By Cal" line) */
      el("div", { class: `td-leadgrid${fig ? "" : " solo"}` }, [el("div", { class: "td-body" }, [...body.slice(0, 2), more(h), ...body.slice(2)]), fig]), wideEl ? el("div", { class: "td-lead-wide" }, wideEl) : null]), h);
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
    // (update 858) the shots you'll face here: each part of the game and distance, a round here against a usual week
    if (x.att?.rows?.length) { const A = x.att, CN = { OTT: "Off the tee", APP: "Approach", ARG: "Around the green", PUTT: "Putting" }, lb = (b0) => String(b0).replace(/^\w+\|/, "").replace(/ tee shots$/, "");
      const dOf = (q) => (A.mine ? q.dm : q.d), absA = A.rows.map((q) => Math.abs(dOf(q))).sort((p0, q0) => q0 - p0), mx = Math.max(0.2, absA[1] && absA[0] > absA[1] * 2.5 ? absA[1] * 1.3 : absA[0] || 0); /* (one outlier doesn't flatten the rest) */
      const bar = (v) => { const w = Math.min(50, (Math.abs(v) / mx) * 50); return el("div", { class: "td-sk-bar me" }, [el("i", { style: `width:${w.toFixed(1)}%;${v >= 0 ? "left:50%" : `left:${(50 - w).toFixed(1)}%`}` }), el("span", { class: v >= 0.05 ? "up" : v <= -0.05 ? "down" : "" }, `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`)]); };
      const cats0 = [...new Set(A.rows.map((q) => q.cat))];
      const attBox = el("div", { class: "td-chart td-att" }, [el("div", { class: "td-kick mute" }, A.mine ? `Shots ${A.mine === "You" ? "you'll" : `${A.mine} will`} face here · per round, against ${A.mine === "You" ? "your" : "their"} usual week` : "Shots the field faces here · per round, against a usual week on tour"),
        ...cats0.map((c0) => el("div", { class: "td-att-cat" }, [el("div", { class: "td-att-h" }, CN[c0] || c0),
          el("div", { class: "td-sk-rows" }, A.rows.filter((q) => q.cat === c0).map((q) => el("div", { class: "td-sk-row td-att-row" }, [el("span", { class: "td-sk-l" }, lb(q.b)), bar(dOf(q)),
            el("span", { class: "td-att-n" }, A.mine ? `${q.mineH.toFixed(1)} vs ${q.mineU.toFixed(1)}` : `${q.here.toFixed(1)} vs ${q.tour.toFixed(1)}`)])))])),
        el("div", { class: "td-legend" }, [el("span", { class: "gray" }, A.mine ? "Expected here vs usual, a round" : "Here vs tour, a round")])]);
      return attBox; }
    // (update 866) each hole's aggressiveness index (birdie-or-better % less bogey-or-worse %); (update 867) the field's, a card of its own
    if (x.agg?.rows?.length) { const G = x.agg, mxA = Math.max(0.2, ...G.rows.map((o) => Math.abs(o.f))), pcA = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.round(Math.abs(v) * 100)}`, pc0 = (v) => `${Math.round(v * 100)}%`;
      // (update 868) each hole: its index as a bar (birdie or better % minus bogey or worse %), the two percentages, and a ⚠ on the blow-up holes
      const barA = (v) => { const w = Math.min(50, (Math.abs(v) / mxA) * 50); return el("div", { class: "td-sk-bar top" }, el("i", { style: `width:${w.toFixed(1)}%;${v >= 0 ? "left:50%" : `left:${(50 - w).toFixed(1)}%`}` })); };
      return el("div", { class: "td-chart td-agg" }, [el("div", { class: "td-kick mute" }, "Aggressiveness by hole · birdie or better % minus bogey or worse % · the field"),
        el("div", { class: "td-agg-row td-agg-head" }, [el("span", {}, "Hole"), el("span", {}, ""), el("span", {}, "Index"), el("span", {}, "Birdie+"), el("span", {}, "Bogey+")]),
        el("div", { class: "td-agg-rows" }, G.rows.map((o) => el("div", { class: `td-agg-row${o.blow ? " blow" : ""}`, title: o.blow ? `Blow-up hole: ${pc0(o.d2)} double bogey or worse` : null }, [el("span", { class: "td-sk-l" }, [`No. ${o.h} \u00b7 P${o.par}`, o.blow ? el("b", { class: "td-agg-warn" }, " \u26a0") : null]), barA(o.f),
          el("span", { class: `td-agg-v ${o.f >= 0.005 ? "up" : o.f <= -0.005 ? "down" : ""}` }, pcA(o.f)), el("span", { class: "td-agg-p" }, pc0(o.b)), el("span", { class: "td-agg-p" }, [pc0(o.g), o.blow ? el("small", {}, ` \u00b7 ${pc0(o.d2)} dbl+`) : null])]))),
        el("div", { class: "td-legend" }, [el("span", { class: "gold" }, "The field"), G.rows.some((o) => o.blow) ? el("span", { class: "td-agg-lg" }, "\u26a0 Blow-up hole: 6%+ double bogey or worse") : null])]); }
    // (update 797) a skill at the course: the player against the top 10 in each part of the game (strokes gained per round)
    if (x.skill?.bands?.length) { const sk = x.skill, lbl0 = (b0) => String(b0).replace(/^\w+\|/, "").replace(/ tee shots$/, ""), f3 = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(sk.perRound ? 2 : 3);
      // (update 846) readable at any width: a row for each distance, two bars from a centre line
      const absV = sk.bands.flatMap((b0) => [Math.abs(sk.a[b0] ?? 0), Math.abs(sk.top[b0] ?? 0)]).sort((p0, q0) => q0 - p0);
      const mxS = Math.max(0.001, absV[1] && absV[0] > absV[1] * 2.5 ? absV[1] * 1.3 : absV[0] || 0); // (one outlier doesn't flatten the rest: its bar runs to the edge)
      const barS = (v, c0) => { v = v ?? 0; const w = Math.min(50, (Math.abs(v) / mxS) * 50); return el("div", { class: `td-sk-bar ${c0}` }, [el("i", { style: `width:${w.toFixed(1)}%;${v >= 0 ? "left:50%" : `left:${(50 - w).toFixed(1)}%`}` }), el("span", { class: v >= 0 ? "up" : "down" }, f3(v))]); };
      return el("div", { class: "td-chart td-skill" }, [el("div", { class: "td-kick mute" }, sk.perDist ? `${CATN[sk.cat]} by distance · strokes gained per round ${sk.where}` : sk.perRound ? `Each part of the game · strokes gained per round ${sk.where}` : `${CATN[sk.cat]} by distance · strokes gained a shot ${sk.where}`),
        el("div", { class: "td-sk-rows" }, sk.bands.map((b0) => el("div", { class: "td-sk-row" }, [el("span", { class: "td-sk-l" }, lbl0(b0)), el("div", {}, [barS(sk.a[b0], "me"), barS(sk.top[b0], "top")])]))),
        el("div", { class: "td-legend" }, [el("span", { class: "gray" }, sk.who), el("span", { class: "gold" }, "Top 10")])]);
      const g = 0 && groupBars(sk.bands.map((b0) => ({ label: String(b0).replace(/^\w+\|/, "").replace(/ tee shots$/, ""), a: sk.a[b0] ?? 0, b: sk.top[b0] ?? 0 })), { la: sk.who, lb: "Top 10", fmt: (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3) }); /* (update 799: that part of the game by distance; 803: a shot, 3 decimals) */
      return g ? el("div", { class: "td-chart" }, [el("div", { class: "td-kick mute" }, `${CATN[sk.cat]} by distance · strokes gained a shot ${sk.where}`), g, el("div", { class: "td-legend" }, [el("span", { class: "gray" }, sk.who), el("span", { class: "gold" }, "Top 10")])]) : null; }
    if (t === "fm" && x.ra && x.rb) return el("div", { class: "td-chart" }, [radarSvg(cats.map((c0) => CSHORT[c0]), [{ vals: x.rb, cls: "a", label: `The ${x.n} before` }, { vals: x.ra, cls: "b", label: `The last ${x.FL}` }]), el("div", { class: "td-legend" }, [el("span", { class: "gold" }, `Last ${x.FL}`), el("span", { class: "gray" }, `${x.FL} before`)])]);
    if (t === "fd" && x.lastR) return formRounds(x, x.c); /* (update 805: a range's form, round by round) */
    if (t === "cm" && x.a != null) return el("div", { class: "td-chart" }, pairBars(x.b, x.a, { la: `${x.n} before`, lb: `Last ${x.n}` }) /* (update 793: a chart runs in time order, before then now) */);
    // (update 758) the best round: every round this season (that one bright); a week or a streak: every tournament
    if (t === "br" && h.k) { const rs = sgRounds(rawOf(playerOf(h.k))).filter((r) => yrOf(r) === seasonYr() && !r.eventLevel), mx = Math.max(...rs.map(tot)); if (rs.length < 4) return null;
      const svg = barSvg(rs.map((r) => ({ v: tot(r), label: `${r.event} R${r.roundNo || ""}`, short: "", hot: tot(r) === mx })), { note: "Every round" });
      return svg ? el("div", { class: "td-chart" }, [el("div", { class: "td-kick mute" }, `Every round of ${seasonYr()}, strokes gained total`), svg, el("div", { class: "td-strip-ax" }, [el("span", {}, shortEv(rs[0].event)), el("span", {}, shortEv(rs.at(-1).event))])]) : null; }
    if ((t === "ev" || t === "st") && h.k) { const b = storyBars(h, null); return b ? el("div", { class: "td-chart" }, b.slice(1)) : null; }
    if (t === "wk" && x.all) return el("div", { class: "td-chart" }, catBars(x.all, x.c));
    if (h.id.startsWith("sp-weapon") && x.all) return el("div", { class: "td-chart" }, catBars(x.all, x.c));
    if (h.id.startsWith("sp-steady") && x.pts) return el("div", { class: "td-chart" }, scatterSvg(x.pts, { xLab: `Strokes gained ${CAT_IN[x.c]}`, yLab: "Swing", fmtX: sg2 }));
    if (false && t === "dz" && x.c && TOUR_FT(x.c, x.d)) { /* (update 805: no made-up illustration) */ const tf = TOUR_FT(x.c, x.d), mf = tf * Math.max(0.6, Math.min(1.6, 1 - x.per * 2.5)); return el("div", { class: "td-chart" }, proxScatter(tf, mf, { seed: hash(h.id), who: h.k ? sur(h.k) : "Player" })); }
    if (h.hole && h.cid) return holeImg(h);
    // (update 750) practice: an illustration of what the work is for, a typical short-game spread against the target's
    if (t === "pr") return el("div", { class: "td-chart" }, proxScatter(8, 11, { seed: hash(`${h.id}|${DAY}`), who: "now", aLab: "target" }));
  } catch (e) { console.warn("chart", e); } return null; }
  const brief = (h) => { const d = dress(h); return tap(el("article", { class: "td-brief" }, [kicker(h, d, false), el("h3", {}, d.hl), briefBody(h, d), whoTag(h)]), h); };
  // (update 787) a side story's numbers as bullet points: form as the last stretch, the one before, then the change
  function briefBody(h, d) { const x = h.x || {}, t = h.id.split("-")[0];
    if ((t === "fm" || t === "cm") && x.a != null) { const nm = t === "cm" ? CATN[x.c] : "SG: Total"; return el("ul", { class: "td-bul" }, [el("li", {}, `${nm}, last ${x.n}${/event/.test(x.FL || "") ? " events" : ""}: ${sg2(x.a)} per round`), el("li", {}, `${x.n}${/event/.test(x.FL || "") ? " events" : ""} before: ${sg2(x.b)}`), el("li", {}, ["Change: ", el("b", { class: cls(x.d) }, sg2(x.d))]),
      x.fRk ? el("li", {}, formPlace(x)) : null]); } // (update 852: and its place on tour)
    if (t === "ev" && x.v != null) return el("ul", { class: "td-bul" }, [el("li", {}, `${sg2(x.v)} strokes gained total per round`), el("li", {}, `${Math.abs(x.d).toFixed(2)} ${x.d >= 0 ? "better" : "worse"} than ${isMe(h.k) ? "your" : "their"} ${x.yr} average`)]);
    return d.num ? el("p", {}, `${d.num} ${d.cap}`) : deckEl(d.deck); }
  // (update 786) a story's detail as bullet points where it has several parts (" · "), not one long paragraph
  const formPlace = (x) => { const p = Math.round((100 * x.fRk) / x.fN); return `${x.d >= 0 ? "Biggest climb" : "Change"}: ${ord1(x.fRk)} of ${x.fN} on tour (${p <= 50 ? `top ${Math.max(1, p)}%` : `bottom ${Math.max(1, 101 - p)}%`}) · tour median ${sg2(x.fMed)}`.replace(/^Biggest climb: 1st/, "Biggest climb on tour: 1st"); };
  const deckEl = (text, cls0) => { const parts = String(text || "").split(" · ").map((x0) => x0.trim()).filter(Boolean); if (!parts.length) return null;
    return parts.length > 1 ? el("ul", { class: `td-bul${cls0 ? ` ${cls0}` : ""}` }, parts.map((x0) => el("li", {}, x0.replace(/^./, (m) => m.toUpperCase())))) : el("p", { class: cls0 || null }, parts[0]); };
  const column = (h) => { const d = dress(h); return tap(el("article", { class: "td-col" }, [kicker(h, d, false), el("h3", {}, d.hl), h.hole ? chartFor(h) : null, d.num ? el("div", { class: `td-big ${d.nc}` }, d.num) : null, d.num ? el("p", {}, d.cap) : deckEl(d.deck), d.num && d.deck && !/^(fm|cm)-/.test(h.id) ? deckEl(d.deck, "td-small") : null, h.hole ? null : chartFor(h), whoTag(h), more(h)]), h); };
  const gearStory = (h) => { const d = dress(h), x = h.x, row = (nm, r, isNew, mc) => el("tr", { class: isNew ? "new" : "" }, [el("td", {}, [mc ? el("i", { class: `td-sw ${mc}` }) : null, nm, isNew ? el("span", { class: "td-note" }, " · new") : null]), el("td", { class: cls(r.v) }, sg2(r.v)), el("td", {}, String(r.n)), el("td", {}, String(r.ev))]);
    return tap(el("article", { class: "td-gear" }, [el("div", { class: "td-kick" }, `${staff ? `${nameOf(h.k)} · ` : ""}${KIND_WORD[x.pill] || "club"}`), el("h3", {}, d.hl),
      el("table", { class: "td-tape" }, [el("thead", {}, el("tr", {}, ["Model", `SG ${COL_IN[x.c]}`, "Rounds", "Events"].map((t2) => el("th", {}, t2)))), el("tbody", {}, x.all ? x.all.map((m) => row(m.nm, m.r, m.isNew, m.cls)) : [row(x.neu, x.A, true), row(x.old, x.B, false)])]),
      el("p", { class: "td-note" }, `${x.where[0].toUpperCase()}${x.where.slice(1)}, as the product table on Stats counts it.`), (() => { const b = storyBars(h, x.c); return b ? el("div", { class: "td-chart" }, b.slice(1)) : null; })(), more(h)]), h); }; /* (update 821: the legend comes with the bars: b.slice(1) is the chart and its legend) */ /* (update 750: its bars) */
  const rankBox = (items) => { const rows = [];
    for (const h of items) for (const f of h.x?.hits || []) { const bad = f.n && f.r > f.n / 2, top = f.r <= 20; /* (update 744: the top 20 in green) */
      const lbl = f.c === "TOTAL" ? "Total" : `${rkName(f.c)[0].toUpperCase()}${rkName(f.c).slice(1)}`; /* (update 744: "Total", not "Strokes gained") */
      const tr = el("tr", {}, [el("td", { class: `r${top ? " up" : bad ? " down" : ""}` }, String(f.r)), el("td", {}, `${staff ? `${nameOf(h.k)} · ` : ""}${lbl}`), el("td", { class: "v" }, f.v == null ? "" : sg2(f.v))]); /* (update 751: no bar) */
      tr.dataset.r = String(bad ? 1000 + f.r : f.r);
      rows.push(tap(tr, { id: `rkrow-${f.c}-${h.k}`, k: h.k, kind: "Rank", kick: "Rankings", title: `${staff ? `${nameOf(h.k)}: ` : ""}${ordN(f.r)} of ${f.n} in ${f.c === "TOTAL" ? "strokes gained" : rkName(f.c)}`, detail: f.v == null ? "" : `${sg2(f.v)} per round in ${h.x.yr}`, board: { c: f.c }, to: "Leaderboards · Rankings", run: () => toBoard({ year: [h.x.yr], cats: f.c === "TOTAL" ? [] : [f.c] }, "Rankings", EX.lead(`Who leads in ${rkName(f.c)}?`)) })); } /* (update 751: a pop-up with that leaderboard) */
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
  // (update 771) Around the Tour in three parts: the last event, the last 3 months and the year to date, up to 4 each
  const tourGroups = (list, shown = []) => el("div", { class: "td-tgroups" }, [["last", "Last Event"], ["3m", "Last 3 Months"], ["ytd", "Year-to-date"]].map(([g, t]) => { const xs = list.filter((h) => (h.grp || "ytd") === g).slice(0, 4); shown.push(...xs);
    return xs.length ? el("div", { class: "td-tgroup" }, [el("p", { class: "td-kick td-tg-h" }, t), el("div", { class: "td-wire" }, xs.map(wire))]) : null; }));
  // (update 780) Course Strategy in three parts: the players' history here, the skills that matter here, and how to play
  // the holes (up to 3 each)
  // (update 867) Talking Points: how the course plays, the shots you'll face and each hole's aggressiveness; Player Outlook: a
  // player's record and how the course plays for them; Skill Importance: what kind of week it is and what wins
  const cgOf = (h) => (/^up-(att|agg|fun)$/.test(h.id) ? "talk" : /^up-(me|holes|horses)/.test(h.id) ? "player" : /^up-(talk|skill|mix)/.test(h.id) ? "skill" : "hole"); // (update 804: a hole (where the top 10 win it) is hole strategy)
  let courseShuf = 0; const secShuf = {}, secSeen = {}, secMore = {}; const MORE3 = ["form", "spot", "focus", "res", "gear"]; const STEP = (id) => (id === "gear" ? 4 : 3); // (update 821: Equipment 4 at a time) // (update 820: 3 at a time, "Show more" for 3 more) // (update 797/801: the sections' shuffles)
  const courseGroups = (list, shown = []) => el("div", { class: "td-cgroups" }, [["talk", "Talking Points"], ["player", "Player Outlook"], ["skill", "Skill Importance"], ["hole", "Hole Strategy"]].map(([g, t]) => { const xs = list.filter((h) => cgOf(h) === g).slice(0, 3); shown.push(...xs); void courseShuf;
    return xs.length ? el("div", { class: "td-cgroup" }, [el("p", { class: "td-kick td-tg-h" }, t), el("div", { class: "td-cols" }, xs.map(column))]) : null; }));
  const wire = (h) => { const d = dress(h); return tap(el("div", { class: "td-wire-i" }, [el("b", {}, d.hl), el("p", {}, d.num ? `${d.num} ${d.cap}` : d.deck)]), h); };
  // (update 740) a different paper every day: each story's place moves a little with the date (the evergreen ones, about a
  // player's strengths, steadiness, gaps and stats, the most), so the front page and the sections change day to day
  const DAY = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
  const nmKey = (n) => String(n || "").toLowerCase().replace(/[^a-z\s,]/g, "").split(/[\s,]+/).filter(Boolean).sort().join(" "); // (update 780)
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const jit = (id, amp) => (hash(`${id}|${DAY}`) - 0.5) * 2 * amp;
  let lastItems = null, reroll = false, shownLead = null;
  let fieldsPI = null; import("../playerInsights.js").then((m) => m.ensureFields().then((f) => { if (!f) return; fieldsPI = m; if (lastItems && main.isConnected) drawFeed(lastItems); })).catch(() => {}); // (update 824) // (update 784: the front page's refresh button)

  // ---- (update 837) the front page and the sections built from each player's distances ----
  // the front page: the biggest mover among the players shown leads (their form, last 12 rounds against the 12 before, either
  // way); beside it the next 4 biggest movers, or (fewer than 4 more, or one player) how to play the next course, their tour
  // rank in strokes gained total, what wins for them and their best distance's tour rank
  const formAll = new Map(); // k → that player's form story, any size of change
  const dkey = (d) => { const t = String(d); if (/bunker|sand/i.test(t)) return 1e6; const m = /([<>])?\s*(\d+(?:\.\d+)?)/.exec(t); if (!m) return 5e5; return m[1] === "<" ? -1 : m[1] === ">" ? Number(m[2]) + 0.5 : Number(m[2]); };
  const rdKey = (r) => `${String(r.date || "").slice(0, 10)}|${r.event}|${r.roundNo ?? ""}`;
  const detRounds = (k) => { const own = gearData.get(k), rs = own && own.length ? own : detail?.by.get(k) || []; return rs.filter((r) => onTour(r) && !r.eventLevel); };
  const pn = (v) => (v > 0.005 ? "pos" : v < -0.005 ? "neg" : "");
  const rngName = (c, d) => (c === "OTT" ? `Off-the-Tee: ${d}` : `${CATN[c]} from ${d}`);
  // the field's season by distance (the shot detail): strokes gained per round in each part of the game from each range,
  // ranked among the players with enough rounds who've hit 15+ of those shots
  let dbMemo = null;
  const distBoard = () => { if (!detail) return null; const F = seasonField(), kk = `${F.SY}|${tourPick}|${detail.tour}|${F.ok.length}`; if (dbMemo?.kk === kk) return dbMemo;
    const by = new Map();
    for (const p of F.ok) { const rs = (detail.by.get(p.k) || []).filter((r) => yrOf(r) === F.SY && (detail.tour === "all" || (r.tour || "") === detail.tour) && !r.eventLevel); if (rs.length < 4) continue;
      const m = new Map(); for (const r of rs) for (const s of r.shots || []) if (s.dist && s.cat) { const q = `${s.cat}|${s.dist}`, a = m.get(q) || m.set(q, [0, 0]).get(q); a[0] += s.sg || 0; a[1] += s.w || 1; }
      for (const [q, [sg, n]] of m) if (n >= 15) (by.get(q) || by.set(q, []).get(q)).push([p.k, sg / rs.length, n]); }
    for (const l of by.values()) l.sort((a, b) => b[1] - a[1]);
    dbMemo = { kk, by }; return dbMemo; };
  const distRank = (k, q) => { const l = distBoard()?.by.get(q); if (!l || l.length < 20) return null; const i = l.findIndex((x) => x[0] === k); return i < 0 ? null : { r: i + 1, n: l.length, v: l[i][1], shots: l[i][2], list: l }; };
  const distsOf = (k, c = null) => { const B = distBoard(); if (!B) return []; return [...B.by.keys()].filter((q) => !c || q.startsWith(`${c}|`)).map((q) => ({ q, c: q.split("|")[0], d: q.split("|").slice(1).join("|"), ...(distRank(k, q) || {}) })).filter((o) => o.r).sort((a, b) => dkey(a.d) - dkey(b.d)); };
  // a player's own ranges this season (before the field's detail is in): strokes gained per round, 15+ shots
  const ownRanges = (k, c = null) => { const rs = detRounds(k).filter((r) => yrOf(r) === seasonYr()); if (!rs.length) return [];
    const m = new Map(); for (const r of rs) for (const s of r.shots || []) if (s.dist && s.cat && (!c || s.cat === c)) { const q = `${s.cat}|${s.dist}`, a = m.get(q) || m.set(q, [0, 0]).get(q); a[0] += s.sg || 0; a[1] += s.w || 1; }
    return [...m].filter(([, a]) => a[1] >= 15).map(([q, a]) => ({ q, c: q.split("|")[0], d: q.split("|").slice(1).join("|"), v: a[0] / rs.length, shots: a[1] })).sort((a, b) => dkey(a.d) - dkey(b.d)); };
  const distStory = (k, o, kick) => ({ id: `ds-${o.q}-${k}`, k, kind: "Rank", kick, title: `${isMe(k) ? "You rank" : `${nameOf(k)} ranks`} ${o.r === 1 ? "1st" : ordN(o.r)} of ${o.n} on tour in ${rngName(o.c, o.d)}`,
    detail: `${sg2(o.v)} strokes gained per round (${Math.round(o.shots)} shots) in ${seasonYr()} · ${o.r > 1 ? `the leader, ${nameOf(o.list[0][0])}: ${sg2(o.list[0][1])}` : `next best, ${nameOf(o.list[1][0])}: ${sg2(o.list[1][1])}`}`,
    board: { rows: o.list.map(([kk, v, n]) => [kk, v, `${sg2(v)} (${Math.round(n)} shots)`]), title: `Strokes gained per round, ${rngName(o.c, o.d)}, ${seasonYr()}` }, x: { c: o.c, d: o.d },
    to: "Leaderboards · Rankings", run: () => toBoard({ year: [seasonYr()], cats: [o.c], dist: [o.d] }, "Rankings", null) }); // (update 842: a rank's leaderboard is on Leaderboards)
  function fixedSides(k, news0) {
    const SY = seasonYr(), R = ranksFor(SY).by, r = R.TOTAL?.get(k), n = R["TOTAL#"], season = sgRounds(rawOf(playerOf(k))).filter((x) => yrOf(x) === SY);
    const strat = news0.find((h) => h.id === "up-strat");
    const rk = r ? { id: `fs-rk-${k}`, k, kind: "Rank", kick: "Tour rank", title: `${isMe(k) ? "You rank" : `${nameOf(k)} ranks`} ${r === 1 ? "1st" : ordN(r)} on tour in SG: Total`, detail: `${sg2(avgOf(season, tot))} strokes gained total per round in ${SY} · of ${n} players with enough rounds`, board: { c: "TOTAL" }, to: "Leaderboards · Rankings", run: () => toBoard({ year: [SY], cats: [] }, "Rankings", null) } : null;
    const wins = news0.find((h) => h.k === k && /^sp-drives/.test(h.id));
    const best = distsOf(k).sort((a, b) => a.r / a.n - b.r / b.n)[0];
    return [strat, rk, wins, best ? distStory(k, best, "Best distance") : null].filter(Boolean);
  }
  // a part of the game's distances, the last stretch against the one before (as Stats' Overview Form pop-up)
  function rangeTable(c, L, P, la, lb) {
    const by = (rs) => { const m = new Map(); for (const r of rs) for (const sh of r.shots || []) { if (sh.cat !== c || !sh.dist) continue; const o = m.get(sh.dist) || m.set(sh.dist, { sg: 0, n: 0 }).get(sh.dist); o.sg += sh.sg || 0; o.n += sh.w || 1; } return m; };
    const A = by(L), B = by(P), nA = Math.max(1, L.length), nB = Math.max(1, P.length);
    const rows = [...new Set([...A.keys(), ...B.keys()])].sort((a, b) => dkey(a) - dkey(b)).map((d) => { const a = A.get(d), b = B.get(d); return { d, a: a ? a.sg / nA : 0, b: b ? b.sg / nB : 0, na: a?.n || 0, nb: b?.n || 0 }; }).filter((x) => x.na + x.nb >= 5);
    if (!rows.length) return el("p", { class: "muted small" }, "No distances on record for these rounds, so no breakdown by range.");
    const mx = Math.max(0.01, ...rows.map((x) => Math.abs(x.a - x.b)));
    return el("div", {}, [el("p", { class: "cf-sub" }, `Each distance, the ${la.toLowerCase()} against the ${lb} (strokes gained per round)`),
      el("div", { class: "ip-tw ip-tw0 ip-full" }, el("table", { class: "ip-t cf-parts ip-fr" }, [el("thead", {}, el("tr", {}, ["Range", la, lb, "Change", ""].map((t2, i) => el("th", { class: i && i < 4 ? "num" : null }, t2)))),
        el("tbody", {}, rows.map((x) => { const d = x.a - x.b; return el("tr", {}, [el("td", {}, x.d), el("td", { class: `num ${pn(x.a)}` }, sg2(x.a)), el("td", { class: `num ${pn(x.b)}` }, sg2(x.b)), el("td", { class: `num strong ${pn(d)}` }, sg2(d)),
          el("td", { class: "ip-frbar" }, el("span", { class: "cf-mid" }, el("i", { class: d >= 0 ? "pos" : "neg", style: `width:${Math.round((Math.abs(d) / mx) * 50)}%` })))]); }))]))]);
  }
  async function catPop(h, c) {
    const x = h.x, k = h.k, { popup } = await import("./insightPages.js");
    const a = avgOf(x.lastR, (r) => inCat(r, c)), b = avgOf(x.prevR, (r) => inCat(r, c)), dd = a - b;
    const wL = new Set(x.lastR.map(rdKey)), wP = new Set(x.prevR.map(rdKey)), dr = detRounds(k), L = dr.filter((r) => wL.has(rdKey(r))), P = dr.filter((r) => wP.has(rdKey(r)));
    const chart = formRounds(x, c), la = `Last ${x.FL}`, lb = `${x.FL} before`;
    popup(`${CATN[c]}: the last ${x.FL} against the ${x.FL} before`, [chart ? el("div", { class: "td ip-chartbox" }, chart) : null,
      el("p", {}, [`${la}: `, el("b", { class: pn(a) }, `${sg2(a)} per round`), `; ${lb}: `, el("b", { class: pn(b) }, `${sg2(b)} per round`), "; the change ", el("b", { class: pn(dd) }, sg2(dd)), "."]),
      rangeTable(c, L, P, la, lb), el("p", { class: "ip-samp" }, `Strokes gained ${CATN[c].toLowerCase()} per round, ${nameOf(k)}${tourPick && tourPick !== ALL ? `, ${tourName(tourPick)}` : ""}`)], `Form · ${nameOf(k)}`);
  }
  // Player Spotlight / Where to Improve: the 3 distances they rank best / worst in on tour (their own best / worst by strokes
  // gained per round until the field's detail is in)
  const rngCard = (k, o, good) => { const h = o.r ? distStory(k, o, good ? "Strength" : "Room to improve") : { id: `ds-${o.q}-${k}`, k, kind: "Spotlight", kick: CATN[o.c], title: rngName(o.c, o.d), detail: `${sg2(o.v)} strokes gained per round (${Math.round(o.shots)} shots) in ${seasonYr()}`, to: "Stats · Player Stats", run: () => toStats(k, { view2: "full", year: [seasonYr()], span: 0 }, null, null) };
    return tap(el("article", { class: "td-col td-rng" }, [el("div", { class: `td-kick${good ? "" : " down"}` }, CATN[o.c]), el("h3", {}, o.c === "OTT" ? `Off the tee: ${o.d}` : `${CATN[o.c]} from ${o.d}`),
      o.r ? el("div", { class: `td-big ${good ? "up" : "down"}` }, `#${o.r}`) : el("div", { class: `td-big ${cls(o.v)}` }, sg2(o.v)),
      el("p", {}, o.r ? `of ${o.n} on tour · ${sg2(o.v)} per round (${Math.round(o.shots)} shots)` : `strokes gained per round (${Math.round(o.shots)} shots)`), more(h)]), h); };
  const chev = () => el("span", { class: "td-rk-chev", "aria-hidden": "true" }, "▸");
  // (update 842) one part of the game open at a time: the rest of the table greys out until it's closed
  // (update 845) each column's colours scaled to the rows in view only: the open part of the game and its distances, else
  // the rows shown (best green, worst red, the middle grey); strokes gained by value, ranks by place
  const recolor = (tb) => { if (!tb) return; const focus = tb.classList.contains("td-rk-focus");
    // like with like: closed, the parts of the game (not SG: Total); open, just its distances (not the part's own row)
    const rows = [...tb.rows].filter((x) => !x.hidden && (focus ? x.classList.contains("td-rk-on") && x.classList.contains("td-rk-sub") : !x.classList.contains("td-rk-tot") && !x.classList.contains("td-rk-sub")));
    const own = [...tb.rows].filter((x) => !x.hidden && !rows.includes(x) && (!focus || x.classList.contains("td-rk-on") || x.classList.contains("td-rk-tot")));
    for (const tr of own) for (const td of tr.cells) { if (td.dataset.v != null) td.style.color = sgSt(Number(td.dataset.v), scOf(tr.className)).replace("color:", ""); else if (td.dataset.r != null) { const q = Number(td.dataset.r); td.style.color = gradC(1 - 2 * Math.min(1, Math.max(0, q))); } }
    const cols = new Map(); for (const tr of rows) [...tr.cells].forEach((td, i) => { if (td.dataset.v != null || td.dataset.r != null) (cols.get(i) || cols.set(i, []).get(i)).push(td); });
    for (const tds of cols.values()) { const isR = tds[0].dataset.r != null, vs = tds.map((td) => Number(isR ? td.dataset.r : td.dataset.v)).filter(Number.isFinite);
      for (const td of tds) { const v = Number(isR ? td.dataset.r : td.dataset.v); if (!Number.isFinite(v)) { td.style.color = ""; continue; } td.style.color = gradC(isR ? divR(v, vs) : divV(v, vs)); } } // (update 853: diverging at 0 / the median)
    for (const tr of tb.rows) if (tr.hidden || (!rows.includes(tr) && !own.includes(tr))) for (const td of tr.cells) if (td.dataset.v != null || td.dataset.r != null) td.style.color = ""; };
  const expander = (tr, subs) => { if (!subs.length) return; tr.classList.add("td-rk-cat"); tr.setAttribute("role", "button"); tr.tabIndex = 0; subs.forEach((s) => { s.hidden = true; });
    tr._subs = subs;
    const tog = () => { const tb0 = tr.parentElement, open = subs[0].hidden;
      if (tb0) for (const o of tb0.querySelectorAll("tr.td-rk-cat.open")) if (o !== tr) { o.classList.remove("open"); (o._subs || []).forEach((s) => { s.hidden = true; }); }
      subs.forEach((s) => { s.hidden = !open; }); tr.classList.toggle("open", open);
      if (tb0) { tb0.classList.toggle("td-rk-focus", open); for (const x of tb0.rows) x.classList.toggle("td-rk-on", open && (x === tr || subs.includes(x))); recolor(tb0); } };
    tr.addEventListener("click", tog); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") tog(); }); };
  // (update 842) colours on a scale: red through a neutral grey to green, by how big the number is (strokes gained per round:
  // its own scale for SG: Total, a part of the game and a distance) or where the rank sits in the field
  const mixC = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(",")})`; };
  // (update 853) the middle: grey, 0 (or the median) reads as neutral
  const neutralC = () => (document.documentElement.getAttribute("data-theme") === "light" ? "#8e8e93" : "#a1a1a6"); // (grey in the middle, as asked)
  const gradC = (t) => (t >= 0 ? mixC(neutralC(), "#30d158", Math.min(1, t)) : mixC(neutralC(), "#ff453a", Math.min(1, -t)));
  // (update 853) diverging scales: strokes gained from 0 (positives white to green, scaled to the biggest positive in view;
  // negatives white to red, to the biggest negative); ranks from the tour's median (better green, worse red) the same way
  const divV = (v, vs) => { if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005) return 0; const mx = v > 0 ? Math.max(...vs.filter((x) => x > 0)) : Math.max(...vs.filter((x) => x < 0).map((x) => -x)); return mx > 0 ? (v > 0 ? v / mx : v / mx) : 0; };
  const divR = (q, qs) => { if (q == null || !Number.isFinite(q) || Math.abs(q - 0.5) < 0.005) return 0; const mx = q < 0.5 ? Math.max(...qs.filter((x) => x < 0.5).map((x) => 0.5 - x)) : Math.max(...qs.filter((x) => x > 0.5).map((x) => x - 0.5)); return mx > 0 ? (q < 0.5 ? (0.5 - q) / mx : -(q - 0.5) / mx) : 0; };
  const sgSt = (v, sc) => (v == null || !Number.isFinite(v) ? "" : `color:${gradC(Math.max(-1, Math.min(1, v / sc)))}`);
  const rkSt = (r, n) => (!r || !n ? "" : `color:${gradC(n > 1 ? 1 - (2 * (r - 1)) / (n - 1) : 0)}`);
  const scOf = (cl) => (/tot/.test(cl) ? 1.5 : /sub/.test(cl) ? 0.3 : 0.75);
  // Ranks: strokes gained total and each part of the game, each opening to its distance ranges
  function rankTable(k) {
    const SY = seasonYr(), R = ranksFor(SY).by, rs = sgRounds(rawOf(playerOf(k))).filter((r) => yrOf(r) === SY); if (!rs.length) return null;
    const row = (lbl, v, r, n, cl = "") => el("tr", { class: cl }, [el("td", {}, lbl), el("td", { class: "v", ...(v != null ? { "data-v": String(v) } : {}) }, v == null ? "—" : sg2(v)), el("td", { class: "r", ...(r ? { "data-r": String(r / (n || 1)) } : {}) }, r ? `${r} of ${n}` : "—")]);
    const tb = el("tbody", {}, [row("SG: Total", avgOf(rs, tot), R.TOTAL?.get(k), R["TOTAL#"], "td-rk-tot")]);
    for (const c of cats) { const ds = distsOf(k, c), tr = row([ds.length ? chev() : null, CATN[c]], avgOf(rs, (r) => inCat(r, c)), R[c]?.get(k), R[`${c}#`]);
      const subs = ds.map((o) => { const t = row(o.d, o.v, o.r, o.n, "td-rk-sub"); t.addEventListener("click", () => openPop(distStory(k, o, "Tour rank"))); return t; });
      tb.append(tr, ...subs); expander(tr, subs); }
    recolor(tb); // (update 845)
    return el("div", {}, [el("div", { class: "td-tw" }, el("table", { class: "td-box td-rk" }, [el("thead", {}, el("tr", {}, ["Category / distance range", "SG per round", "Tour rank"].map((t2) => el("th", {}, t2)))), tb])),
      el("p", { class: "td-note" }, distBoard() ? "Tap a part of the game for its distance ranges, and a range for its leaderboard. Ranked among the players with enough rounds (a range: 15+ shots)." : "The distance ranges open once the field’s shot detail has loaded.")]);
  }
  // Best Week: overall, each part of the game and (opened) each of its distance ranges: the week, strokes gained per round
  // there and its rank in that week's field, against their usual (the season, and its tour rank)
  function bestTable(k) {
    const SY = seasonYr(), dr = detRounds(k).filter((r) => yrOf(r) === SY), sum = sgRounds(rawOf(playerOf(k))).filter((r) => yrOf(r) === SY), base = dr.length ? dr : sum;
    const evs = eventsOf(base).filter((e) => e.rs.length >= 2); if (evs.length < 3) return null;
    const R = ranksFor(SY).by;
    const atEv = (ev, f, useDet) => { const src = useDet ? (detail ? [...detail.by] : []) : field.map((p) => [p.key, sgRounds(rawOf(p))]), out = [];
      for (const [kk, rs] of src) { const w = rs.filter((r) => r.event === ev.event && yrOf(r) === ev.year && !r.eventLevel && (!useDet || detail.tour === "all" || (r.tour || "") === detail.tour)); if (w.length >= 2) out.push([kk, avgOf(w, f)]); }
      return out.sort((a, b) => b[1] - a[1]); };
    const line = (lbl, f, useDet, usual, cl = "") => { const b = evs.map((e) => [e, avgOf(e.rs, f)]).filter((x) => x[1] != null).sort((a, c) => c[1] - a[1])[0]; if (!b) return null;
      const at = atEv(b[0], f, useDet), i = at.findIndex((x) => x[0] === k);
      const okR = i >= 0 && at.length >= 5, dv = (v) => (v != null && Number.isFinite(v) ? { "data-v": String(v) } : {});
      const tr = el("tr", { class: cl }, [el("td", {}, lbl), el("td", {}, fullEv(b[0].event)), el("td", { class: "v", ...dv(b[1]) }, sg2(b[1])), el("td", { class: "r", ...(okR ? { "data-r": String((i + 1) / at.length) } : {}) }, okR ? `${i + 1} of ${at.length}` : "—"),
        el("td", { class: "v", ...dv(usual.v) }, usual.v == null ? "—" : sg2(usual.v)), el("td", { class: "r", ...(usual.r ? { "data-r": String(usual.r / (usual.n || 1)) } : {}) }, usual.r ? `${usual.r} of ${usual.n}` : "—")]);
      // (update 842) a distance: tap for every event's number in it, as bars
      if (/sub/.test(cl)) { tr.title = "Every event in it, as bars"; tr.addEventListener("click", (e) => { e.stopPropagation(); evBarsPop(tr.dataset.full || lbl, f, b[0], { bestV: b[1], wk: okR ? `${i + 1} of ${at.length}` : null, usual, nR: useDet ? dr.length : sum.length }); }); } // (update 857: the table's own numbers in the pop-up)
      return tr; };
    // (update 842) a distance range's strokes gained per round at each event this season, a bar each (the best week bright)
    const evBarsPop = async (lbl, f, bestE, info = {}) => { const { popup } = await import("./insightPages.js");
      const items = evs.map((e) => { const v = avgOf(e.rs, f); return v == null ? null : { v, label: `${fullEv(e.event)} (${e.rs.length} rounds)`, short: shortEv(e.event), hot: e === bestE }; }).filter(Boolean);
      barWide = true; const svg = barSvg(items, { note: `${lbl} by event` }); barWide = false;
      const cN = /^(<|>)?\s*\d/.test(lbl) ? null : lbl, avg = avgOf(items, (x) => x.v);
      popup(`${lbl}: every event of ${SY}`, [svg ? el("div", { class: "td ip-chartbox" }, el("div", { class: "td-chart" }, [el("div", { class: "td-kick mute" }, `Strokes gained per round · ${items.length} events`), svg])) : el("p", { class: "muted" }, "Not enough events to chart."),
        // (update 857) the same numbers as the row: the best week (and its rank that week) and the usual (the season's
        // strokes gained per round over every round, and its tour rank), not an average of the bars
        el("p", {}, [`Best week: `, el("b", {}, fullEv(bestE.event)), ", ", el("b", { style: sgSt(info.bestV, 0.3) }, `${sg2(info.bestV ?? avg)} per round`), info.wk ? ` (${info.wk} that week)` : ""]),
        info.usual?.v != null ? el("p", {}, [`Usual: `, el("b", { style: sgSt(info.usual.v, 0.3) }, `${sg2(info.usual.v)} per round`), ` over the season (${info.nR} rounds)`, info.usual.r ? `, ${ord1(info.usual.r)} of ${info.usual.n} on tour` : ""]) : null,
        el("p", { class: "ip-samp" }, `${cN || "Strokes gained per round from this distance"}, ${nameOf(k)}: each event of ${SY} with 2+ rounds as a bar (per round there). The usual is every round of the season together, so it can differ from the bars' middle.`)], `Best week · ${nameOf(k)}`); };
    const tb = el("tbody", {}, [line("SG: Total", tot, false, { v: avgOf(sum, tot), r: R.TOTAL?.get(k), n: R["TOTAL#"] }, "td-rk-tot")].filter(Boolean));
    for (const c of cats) { const f = (r) => inCat(r, c), tr = line(CATN[c], f, false, { v: avgOf(sum, f), r: R[c]?.get(k), n: R[`${c}#`] }); if (!tr) continue;
      const subs = dr.length ? ownRanges(k, c).map((o) => { const fr = (r) => (r.shots || []).reduce((t, s0) => t + (s0.cat === c && s0.dist === o.d ? s0.sg || 0 : 0), 0), dRk = distRank(k, o.q);
        const t0 = line(o.d, fr, true, { v: o.v, r: dRk?.r, n: dRk?.n }, "td-rk-sub"); if (t0) t0.dataset.full = rngName(c, o.d); return t0; }).filter(Boolean) : [];
      if (subs.length) tr.firstChild.prepend(chev()); tb.append(tr, ...subs); expander(tr, subs); }
    recolor(tb); // (update 845)
    return el("div", {}, [el("div", { class: "td-tw" }, el("table", { class: "td-box td-rk td-bw" }, [el("thead", {}, el("tr", {}, ["Category / distance range", "Best week", "Per round", "Rank that week", "Usual per round", "Usual rank"].map((t2) => el("th", {}, t2)))), tb])),
      el("p", { class: "td-note" }, `${isMe(k) ? "Your" : poss(nameOf(k))} best tournament of ${SY} in each (2+ rounds there), strokes gained per round; its rank among that week's field, and ${isMe(k) ? "your" : "their"} season average and tour rank beside it. Tap a part of the game for its distance ranges.`)]);
  }
  // (update 849) one player's Home ends with their PDF report: this season on the tour picked, made here and saved
  function pdfCard(k) {
    const SY = seasonYr(), tn = tourPick && tourPick !== ALL ? tourName(tourPick) : "every tour", status = el("p", { class: "td-pdf-st", role: "status" }, "");
    const btn = el("button", { type: "button", class: "td-pdf-btn" }, [el("span", { "aria-hidden": "true" }, "✨"), " Generate PDF Report"]);
    btn.addEventListener("click", async () => { if (btn.disabled) return; btn.disabled = true; btn.classList.add("busy");
      try { const R = await import("../reportGen.js"), out = await R.makePlayerReport({ key: k, label: nameOf(k), tour: tourPick === ALL ? "__all" : tourPick, year: SY, onStep: (t) => { status.textContent = t; } });
        if (!out || out.empty) { status.textContent = `No rounds to report on for ${SY} on ${tn}.`; return; }
        const url = URL.createObjectURL(new Blob([out.bytes], { type: "application/pdf" })), a = el("a", { href: url, download: out.name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        status.textContent = `Saved: ${out.name} (${out.rounds} rounds).`; }
      catch (e) { console.error(e); status.textContent = "Couldn’t make the report just now. Try again in a moment."; }
      finally { btn.disabled = false; btn.classList.remove("busy"); } });
    return el("section", { class: "td-pdf", id: "td-pdf" }, [el("div", { class: "td-pdf-ic", "aria-hidden": "true" }, icon("report")),
      el("div", { class: "td-pdf-txt" }, [el("p", { class: "td-kick" }, "Season report"), el("h2", {}, `${isMe(k) ? "Your" : poss(nameOf(k))} ${SY} performance report`),
        el("p", {}, `Everything on this page and more, as a PDF to keep or send: strokes gained in every part of the game, where the strokes go, best and toughest weeks, equipment and tour ranks (${tn}).`), status]), btn]);
  }
  function newSec(id, k, sfx = "") {
    if (!k) return null; const SY = seasonYr(), P = isMe(k) ? "Your" : poss(nameOf(k)); let content = null, sub = "";
    if (id === "spot" || id === "focus") { const good = id === "spot", ranked = distsOf(k);
      const pick = ranked.length ? [...ranked].sort((a, b) => (good ? a.r / a.n - b.r / b.n : b.r / b.n - a.r / a.n)).slice(0, 3) : [...ownRanges(k)].sort((a, b) => (good ? b.v - a.v : a.v - b.v)).slice(0, 3);
      if (!pick.length) return null; content = el("div", { class: "td-cols" }, pick.map((o) => rngCard(k, o, good)));
      sub = ranked.length ? `${P} 3 ${good ? "best" : "weakest"} distances on tour in ${SY}, by tour rank` : `${P} 3 ${good ? "best" : "weakest"} distances in ${SY}, strokes gained per round`; }
    else if (id === "rank") { content = rankTable(k); sub = `${SY}${tourPick && tourPick !== ALL ? ` · ${tourName(tourPick)}` : ""}`; }
    else if (id === "bestwk") { content = bestTable(k); sub = `${SY} · each part of the game and distance`; }
    if (!content) return null;
    return el("section", { class: `td-sec${FULL.has(id) ? " full" : ""}`, id: `td-${id}${sfx}`, "data-sec": id }, [el("div", { class: "td-sh" }, [el("h2", {}, SEC[id][0]), sub ? el("span", {}, sub) : null]), content]);
  }
  // ---- (update 863) a new account: no favorites and no players of your own (a coach's players count) ----
  // The page: the players on each tour, ranked, to search and star (Pick your players), the next event's Course Strategy
  // and Around the Tour. Starring one keeps you here; "See your Tour Report" switches to your favorites.
  const isFresh = () => staff && !selfKey && !keys.filter((k) => k !== ownKey).length && !picked.size && !(team.isTeam && teamKeys.length);
  let freshQ = "", freshAdded = new Set();
  function freshPlayers() {
    const SY = seasonYr(), R = ranksFor(SY).by, rk = R.TOTAL || new Map(), nR = R["TOTAL#"] || rk.size;
    const ps = field.map((p) => { const rs = rawOf(p).filter((r) => yrOf(r) === SY); return rs.length ? { k: p.key, name: nameOf(p.key), rs, n: rs.length, ev: rs.every((r) => r.eventLevel), v: avgOf(rs, tot), rk: rk.get(p.key) || null } : null; }).filter(Boolean)
      .sort((a, b) => (a.rk ?? 1e9) - (b.rk ?? 1e9) || b.v - a.v);
    const favNow = new Set([...favs, ...freshAdded]);
    const list = el("div", { class: "td-pl-list", role: "list" }), cnt = el("span", { class: "td-pl-n" });
    const go = el("button", { type: "button", class: "td-pl-go", hidden: !favNow.size }, "See your Tour Report \u2192");
    const paint = () => { const q = freshQ.trim().toLowerCase(), xs = ps.filter((x) => !q || x.name.toLowerCase().includes(q));
      cnt.textContent = `${xs.length} player${xs.length === 1 ? "" : "s"}${tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : ""} · ${SY}`;
      go.hidden = !favNow.size; go.textContent = `See your Tour Report (${favNow.size} favorite${favNow.size === 1 ? "" : "s"}) \u2192`;
      mount(list, xs.length ? xs.map((x) => { const on = favNow.has(x.k), star = el("button", { type: "button", class: `td-pl-star${on ? " on" : ""}`, "aria-pressed": String(on), "aria-label": `${on ? "Remove" : "Add"} ${x.name} ${on ? "from" : "to"} your favorites` }, on ? "\u2605" : "\u2606");
        star.addEventListener("click", async () => { star.disabled = true;
          try { const wl = await import("../watchlist.js"); await wl.loadWatch().catch(() => {}); await wl.toggleFavorite(x.k); const now = (wl.watchPrefs().players || []).includes(x.k);
            if (now) { favNow.add(x.k); freshAdded.add(x.k); } else { favNow.delete(x.k); freshAdded.delete(x.k); favs = favs.filter((k) => k !== x.k); } labels.set(x.k, x.name); paint(); }
          catch (e) { console.error(e); alert("Couldn\u2019t update your favorites just now."); star.disabled = false; } });
        return el("div", { class: `td-pl-row${on ? " on" : ""}`, role: "listitem" }, [el("span", { class: "td-pl-rk" }, x.rk ? String(x.rk) : "\u2014"), el("span", { class: "td-pl-nm" }, x.name),
          el("span", { class: `td-pl-v ${x.v >= 0 ? "up" : "down"}`, title: "Strokes gained total per round this season" }, sg2(x.v)), el("span", { class: "td-pl-r" }, `${x.n} ${x.ev ? "ev" : "rds"}`), star]); })
        : el("p", { class: "td-wait" }, field.length ? "No players match." : "Loading the players\u2026")); };
    const search = el("input", { type: "search", class: "td-pl-q", placeholder: "Search players", "aria-label": "Search players", value: freshQ });
    search.addEventListener("input", () => { freshQ = search.value; paint(); });
    go.addEventListener("click", () => { favs = [...new Set([...favs, ...freshAdded])]; keys = [...new Set([...keys, ...favs])].slice(0, 12); freshAdded = new Set(); focus ||= keys[0] || null; window.scrollTo({ top: 0 }); refresh(); drawOvTop().catch(() => {}); });
    paint();
    return el("section", { class: "td-sec full td-pl", id: "td-players", "data-sec": "players" }, [el("div", { class: "td-sh" }, [el("h2", {}, "Pick your players"), el("span", {}, "Ranked by strokes gained per round this season · tap \u2606 to add a favorite")]),
      el("div", { class: "td-pl-top" }, [search, cnt]), list, el("p", { class: "td-pl-foot" }, [`Rank: strokes gained total per round among the ${nR} players with enough rounds; \u2014 not enough rounds yet.`]), go]);
  }
  function drawFresh(sorted) {
    mount(frontBox, []); mount(ovTop, []); ovTop.dataset.sig = "";
    const crs = sorted.filter((h) => SEC_OF[h.kind] === "course" && !h.k && cgOf(h) !== "player"), trs = sorted.filter((h) => SEC_OF[h.kind] === "tour");
    const sec = (id, title, sub, content, extra = null) => el("section", { class: "td-sec full", id: `td-${id}`, "data-sec": id }, [el("div", { class: "td-sh" }, [el("h2", {}, title), extra, sub ? el("span", {}, sub) : null]), content]);
    const chg = (() => { const b = el("button", { type: "button", class: "td-shuf td-chg" }, "Change event"); b.addEventListener("click", () => changeEvent().catch((e) => console.warn(e))); return b; })();
    const secs = [freshPlayers(), crs.length ? sec("course", "Next Event Course Strategy", `Up next: ${UPCOMING.name}`, courseGroups(crs), chg) : null, trs.length ? sec("tour", "Around the Tour", "Briefs", tourGroups(trs)) : null].filter(Boolean);
    mount(feed, [ownKey && ownAll.length ? myGame() : null, el("div", { class: "td-grid" }, secs)]);
    const go2 = (id) => document.getElementById(`td-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    mount(secNav, secs.map((x) => { const id = x.dataset.sec, a2 = el("a", { href: "#", "data-sec": id }, x.querySelector("h2")?.textContent || id); a2.addEventListener("click", (e) => { e.preventDefault(); go2(id); }); return a2; }));
  }
  // ---- (update 863) "Me": your own game from whatever you've entered (part of one round is enough), against the tour ----
  function myGame() {
    const rs = ownAll, holesOf = (r) => r.basic?.holes || new Set((r.shots || []).map((x) => x.hole)).size;
    const H = rs.reduce((t, r) => t + holesOf(r), 0), shotRs = rs.filter((r) => r.shots?.length), sH = shotRs.reduce((t, r) => t + new Set(r.shots.map((x) => x.hole)).size, 0), per18 = (v, h) => (h ? (v / h) * 18 : null);
    const sc = rs.reduce((t, r) => t + (r.basic?.score || 0), 0), par = rs.reduce((t, r) => t + (r.basic?.par || 0), 0), scH = rs.reduce((t, r) => t + (r.basic?.holes || 0), 0);
    const b = (k) => rs.reduce((t, r) => t + (r.basic?.[k] || 0), 0), pc = (a, n) => (n ? `${Math.round((a / n) * 100)}%` : "\u2014");
    const allShots = shotRs.flatMap((r) => r.shots), sgT = allShots.reduce((t, x) => t + x.sg, 0);
    // where each part would rank on the tour picked (this season's players with enough rounds, strokes gained per round)
    // (the tour picked, else, for your own Practice rounds, the tour with the most rounds in the stats file)
    const tc = new Map(); for (const p of field) for (const r of p.rounds || []) if (!r.eventLevel) tc.set(tourOf(r), (tc.get(tourOf(r)) || 0) + 1);
    const TM = tourPick && tourPick !== ALL && tc.has(tourPick) ? tourPick : [...tc].sort((a, b) => b[1] - a[1])[0]?.[0];
    const SYs = [...new Set(field.flatMap((p) => (p.rounds || []).filter((r) => tourOf(r) === TM).map(yrOf)))].sort().at(-1);
    const tourRs = field.map((p) => (p.rounds || []).filter((r) => yrOf(r) === SYs && tourOf(r) === TM && !r.eventLevel)).filter((x) => x.length >= 8);
    const rankOn = (v, f) => { if (v == null || !tourRs.length) return null; const vals = tourRs.map((x) => avgOf(x, f)); return { rk: 1 + vals.filter((y) => y > v).length, of: vals.length }; };
    const tile = (big, lab, sub = "") => el("div", { class: "td-my-tile" }, [el("strong", {}, big), el("span", {}, lab), sub ? el("small", {}, sub) : null]);
    const toParV = scH ? per18(sc - par, scH) : null, sgR = per18(sgT, sH), rT = rankOn(sgR, tot);
    const tiles = [tile(String(rs.length), rs.length === 1 ? "round entered" : "rounds entered", `${H} hole${H === 1 ? "" : "s"}`),
      toParV != null ? tile(`${toParV >= 0 ? "+" : "\u2212"}${Math.abs(toParV).toFixed(1)}`, "to par per 18 holes", `${sc - par >= 0 ? "+" : "\u2212"}${Math.abs(sc - par)} over ${scH} holes`) : null,
      sgR != null ? tile(sg2(sgR), "strokes gained per round", rT ? `${sH < 36 ? "\u2248" : "about "}${ord1(rT.rk)} of ${rT.of} on the ${TM ? tourName(TM) : "tour"} (${SYs})` : `${sH} holes with shots`) : null,
      b("fwyN") ? tile(pc(b("fwy"), b("fwyN")), "fairways", `${b("fwy")} of ${b("fwyN")}`) : null, scH ? tile(pc(b("gir"), scH), "greens in regulation", `${b("gir")} of ${scH}`) : null,
      b("puttHoles") ? tile((b("putts") / b("puttHoles") * 18).toFixed(1), "putts per 18 holes", `${b("putts")} putts, ${b("puttHoles")} holes`) : null].filter(Boolean);
    const parts = sH ? cats.map((c) => { const xs = allShots.filter((x) => x.cat === c); if (!xs.length) return null; const v = per18(xs.reduce((t, x) => t + x.sg, 0), sH), R2 = rankOn(v, (r) => inCat(r, c));
      return el("tr", {}, [el("td", {}, CATN[c]), el("td", { class: `num strong ${v >= 0 ? "up" : "down"}` }, sg2(v)), el("td", { class: "num" }, sg2(xs.reduce((t, x) => t + x.sg, 0) / xs.length)), el("td", { class: "num" }, String(xs.length)), el("td", { class: "num muted" }, R2 ? `${sH < 36 ? "\u2248" : ""}${ord1(R2.rk)} of ${R2.of}` : "\u2014")]); }).filter(Boolean) : [];
    const byD = new Map(); for (const x of allShots) if (x.dist) { const o = byD.get(`${x.cat}|${x.dist}`) || byD.set(`${x.cat}|${x.dist}`, { c: x.cat, d: x.dist, n: 0, v: 0 }).get(`${x.cat}|${x.dist}`); o.n++; o.v += x.sg; }
    const ds = [...byD.values()].filter((o) => o.n >= 3).map((o) => ({ ...o, a: o.v / o.n })).sort((a, b) => b.a - a.a), best = ds.slice(0, 2), worst = ds.slice(-2).reverse().filter((o) => !best.includes(o));
    const dTxt = (o) => `${CATN[o.c]}, ${String(o.d).replace(/^Par (\d) tee shots$/, "tee shots on par $1s")}: ${sg2(o.a)} a shot (${o.n} shots)`;
    const rows = [...rs].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8).map((r) => { const h = holesOf(r), tp = r.basic?.holes ? r.basic.score - r.basic.par : null, sh = r.shots?.length ? new Set(r.shots.map((x) => x.hole)).size : 0;
      return el("tr", {}, [el("td", {}, String(r.date || "").slice(0, 10)), el("td", {}, r.course || r.event || "\u2014"), el("td", { class: "num" }, String(h)), el("td", { class: "num strong" }, tp == null ? "\u2014" : `${tp >= 0 ? "+" : "\u2212"}${Math.abs(tp)}`), el("td", { class: "num" }, sh ? sg2(per18(tot(r), sh)) : "\u2014")]); });
    const tbl = (head, body, cls = "") => el("div", { class: "td-my-tw" }, el("table", { class: `td-my-t ${cls}` }, [el("thead", {}, el("tr", {}, head.map((t, i) => el("th", { class: i ? "num" : null }, t)))), el("tbody", {}, body)]));
    return el("section", { class: "td-sec full td-my", id: "td-mine", "data-sec": "mine" }, [el("div", { class: "td-sh" }, [el("h2", {}, "Your game so far"), el("span", {}, rs.length < 5 ? "From what you've entered: more rounds make it sharper" : "From the rounds you've entered")]),
      el("div", { class: "td-my-tiles" }, tiles),
      parts.length ? el("div", {}, [el("h3", { class: "td-my-h" }, "Each part of the game"), tbl(["Part", "SG per round", "SG a shot", "Shots", "On tour"], parts),
        el("p", { class: "td-my-note" }, `Strokes gained against the tour's baseline, per round: your total over the holes with shots, scaled to 18 holes (${sH} so far). On tour: where that would rank among the ${TM ? tourName(TM) : "tour"}'s ${SYs} players with 8+ rounds${sH < 36 ? " (\u2248: under two rounds' worth of holes, a rough guide only)" : ""}.`)]) : null,
      best.length ? el("ul", { class: "td-my-ul" }, [...best.map((o) => el("li", { class: "up" }, `Best: ${dTxt(o)}`)), ...worst.map((o) => el("li", { class: "down" }, `Costliest: ${dTxt(o)}`))]) : null,
      el("h3", { class: "td-my-h" }, rs.length === 1 ? "Your round" : "Your rounds"), tbl(["Date", "Course", "Holes", "To par", "SG per 18"], rows)]);
  }
  function drawFeed(items) { lastItems = items;
    const seen = new Set(), sorted = items.filter((x) => x && !seen.has(x.id) && seen.add(x.id)).map((x) => ({ ...x, score: x.kind === "Fact" ? x.score : x.score + jit(x.id, x.ever ? 1.6 : 0.6) })) /* (update 791: facts keep their shuffled order) */.sort((a, b) => b.score - a.score);
    if (isFresh()) { drawFresh(sorted); return; } // (update 863) no favorites, no players of your own: Around the Tour, the next event and the players to pick from
    if (!sorted.length && solo() && ownKey && picked.has(ownKey) && ownAll.length) { mount(secNav, []); mount(frontBox, []); mount(feed, myGame()); return; } // (update 863: your rounds, before there's any story)
    if (!sorted.length) { mount(secNav, []); mount(frontBox, []); mount(feed, el("p", { class: "td-wait" }, staff && !keys.length ? "Add players to your favorites (the + beside a player's name on Stats › Overview) and their stories will run here every day." : tourPick && tourPick !== ALL ? `Nothing new on the ${tourName(tourPick)} today. Try another tour, or All.` : "Stories will run here once rounds are in.")); return; }
    // the front page: the lead, and the next three (from other sections where there are some)
    // (update 779) the lead changes every 12 hours (local time): one of the top 6 stories, a different one each half day
    const HALF = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 432e5), news0 = sorted.filter((h) => h.kind !== "Fact"), LEADS = new Set(["Result", "Milestone", "Trend", "Slide", "Equipment", "Rank"]) /* (update 781: only real news can lead: no course notes, facts or briefs) */, cands = news0.filter((h) => LEADS.has(h.kind) && h.k).slice(0, 6), pickI = cands.length ? Math.floor(hash(`lead|${HALF}|${tourPick}`) * cands.length) : 0;
    // (update 783) the front page is drawn again as each piece of data arrives (the season, each player's clubs and shots,
    // the course): once a lead and the three beside it are shown they stay for the half day (kept on this device), so the
    // page doesn't switch stories a few seconds after it opens
    const FPK = `ta.front|${HALF}|${tourPick}|${[...picked].sort().join(",")}`;
    let kept = null; try { kept = JSON.parse(localStorage.getItem(FPK) || "null"); } catch { /* */ }
    const byIdN = new Map(news0.map((h) => [h.id, h]));
    let news = cands.length ? [cands[pickI], ...news0.filter((h) => h !== cands[pickI])] : news0;
    // (update 784) the refresh button: a different lead (at random among the top player news) and three others beside it
    if (reroll) { reroll = false; kept = null; const pool = cands.filter((h) => h.id !== shownLead), nl = pool.length ? pool[Math.floor(Math.random() * pool.length)] : cands[0];
      const others = news0.filter((h) => h !== nl).slice(0, 14).map((h) => [Math.random(), h]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); if (nl) news = [nl, ...others, ...news0.filter((h) => h !== nl && !others.includes(h))]; }
    const keptLead = kept?.lead && byIdN.get(kept.lead);
    if (keptLead) news = [keptLead, ...news0.filter((h) => h !== keptLead)];
    // (update 831) one player: the lead is always a milestone or a trend, the most striking either way (the best or the
    // worst news); beside it 1-2 of their ranks, how to play the next course, and What wins (else another trend or milestone)
    let soloSide = null;
    if (solo()) { const big = (h) => h.score + Math.abs(Number(h.x?.d ?? h.x?.v ?? 0)) * 0.5, TM = (h) => h.k && ["Milestone", "Trend", "Slide"].includes(h.kind);
      const leadS = (keptLead && TM(keptLead) ? keptLead : null) || [...news0].filter(TM).sort((a, b) => big(b) - big(a))[0];
      if (leadS) { const ranks = news0.filter((h) => h.kind === "Rank" && h.k).slice(0, 2), strat = news0.find((h) => h.id === "up-strat") || news0.find((h) => h.kind === "Course" && !h.k);
        const third = news0.find((h) => /drives/.test(h.id) && h !== leadS) || news0.find((h) => TM(h) && h !== leadS);
        soloSide = [...ranks, strat, third].filter(Boolean);
        news = [leadS, ...soloSide, ...news0.filter((h) => h !== leadS && !ranks.includes(h) && h !== strat && h !== third)]; kept = null; } }
    const lead = news[0] || sorted[0], fp = [lead], used = new Set([SEC_OF[lead.kind]]);
    if (soloSide) { for (const h of soloSide) if (!fp.includes(h)) fp.push(h); while (fp.length < 4) fp.push(null); } // (update 831: just those, in that order)
    if (keptLead && kept) for (const id of kept.side || []) { const h = byIdN.get(id); if (h && !fp.includes(h) && fp.length < 4) { fp.push(h); used.add(SEC_OF[h.kind]); } }
    for (const h of news.slice(1)) { if (fp.length >= 4) break; if (!fp.includes(h) && !used.has(SEC_OF[h.kind])) { fp.push(h); used.add(SEC_OF[h.kind]); } }
    for (const h of news.slice(1)) { if (fp.length >= 4) break; if (!fp.includes(h)) fp.push(h); }
    for (let i = fp.length - 1; i >= 0; i--) if (fp[i] == null) fp.splice(i, 1); // (update 831: one player's side column holds only its own stories)
    if (lead?.id && LEADS.has(lead.kind)) try { localStorage.setItem(FPK, JSON.stringify({ lead: lead.id, side: fp.slice(1).map((h) => h.id) })); for (let i = localStorage.length - 1; i >= 0; i--) { const kk = localStorage.key(i); if (kk?.startsWith("ta.front|") && !kk.startsWith(`ta.front|${HALF}|`)) localStorage.removeItem(kk); } } catch { /* */ }
    // (update 837) the biggest mover leads; the next 4 beside it, or (fewer, or one player) the fixed four about them
    const movers = shownKeys().map((k) => formAll.get(k)).filter(Boolean).sort((a, b) => Math.abs(b.x.d) - Math.abs(a.x.d));
    // (update 838) and a new club or ball with enough rounds to judge, switched to fairly recently: in the same running, by
    // the size of its difference (strokes gained per round in its part of the game) against a form change's
    const eqRipe = sorted.filter((h) => h.id.startsWith("eq-") && h.x?.ripe && shownKeys().includes(h.k));
    const pool = [...movers.map((h) => [h, Math.abs(h.x.d)]), ...eqRipe.map((h) => [h, Math.abs(h.x.dd)])].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    if (window.__homeTest) window.__homeTest.eqRipe = eqRipe.map((h) => `${h.id} ${h.x.dd.toFixed(2)} since ${h.x.since}`); // (the test page)
    const moverMode = pool.length > 0, leadM = moverMode ? pool[0] : lead, others = pool.slice(1);
    // (update 848) one player: beside the hero, their At a glance (rounds in the green, best run, biggest upside, steadiest)
    const glK = solo() ? selfKey || [...picked][0] || leadM?.k : null, glSide = glK ? glanceFacts(glK) : [];
    // (update 855) three beside the hero, not four
    const side4 = glSide.length ? [...glSide, ...fixedSides(glK, news0)].slice(0, 4) : !moverMode ? fp.slice(1, 5) : others.length >= 3 && !selfKey && !solo() ? others.slice(0, 4) : [...others.filter((h) => h.id.startsWith("eq-")), ...fixedSides(leadM.k, news0)].slice(0, 4);
    const sideM = side4.slice(0, 3), side4th = side4[3] || null; // (update 856: a fourth only beside a really tall hero)
    const subjK = leadM?.k || selfKey || shownKeys()[0] || null;
    // (update 839) the sections, built for the page (one player: all of theirs; several: Around the Tour only) and, inside
    // each favorite's row in Your favorites, for that player (their stories, and the next course's)
    const buildSecs = (ids, rest, subj, sfx = "") => { const many = !sfx && picked.size !== 1 && keys.length > 1, secs = [], pairRest = new Map();
    for (const id of ids) { const sk = `${id}${sfx}`;
      if (["spot", "focus", "rank", "bestwk"].includes(id)) { const s0 = newSec(id, subj, sfx); if (s0) secs.push(s0); continue; } // (update 837)
      let mine = rest.filter((h) => SEC_OF[h.kind] === id); if (!mine.length) continue;
      // (update 801) every section's shuffle: the stories not shown last time first, the ones shown after them (turned
      // round by the number of presses), so each press changes the section
      if (secShuf[sk] && id !== "fact") { const seen = secSeen[sk] || new Set(), fresh = mine.filter((h) => !seen.has(h.id)).sort((a, b) => hash(`${a.id}|${secShuf[sk]}`) - hash(`${b.id}|${secShuf[sk]}`)), old = mine.filter((h) => seen.has(h.id)), r0 = old.length ? secShuf[sk] % old.length : 0;
        mine = [...fresh, ...old.slice(r0), ...old.slice(0, r0)]; }
      const pick = [], byK = new Map(), grpShown = []; // up to 6 (2 a player first, when there are several)
      const nIn = (i2) => rest.filter((h) => SEC_OF[h.kind] === i2).length, eqSF = nIn("spot") && nIn("focus") ? Math.min(6, Math.max(2, Math.min(nIn("spot"), nIn("focus")))) : 6; /* (update 780: the pair about the same length) */
      const cap = MORE3.includes(id) ? STEP(id) * (1 + (secMore[sk] || 0)) : id === "tour" || id === "course" ? 9 : id === "fact" ? 8 : id === "bestwk" ? 8 : id === "rank" ? 4 : PAIR.includes(id) ? eqSF : 6; /* (update 736: more briefs) */
      for (const h of mine) { if (pick.length >= cap) break; const n = byK.get(h.k || "") || 0; if (many && h.k && n >= 2) continue; pick.push(h); byK.set(h.k || "", n + 1); }
      for (const h of mine) { if (pick.length >= cap) break; if (!pick.includes(h)) pick.push(h); }
      const [title, sub0] = SEC[id], chg = id === "course" ? (() => { const b = el("button", { type: "button", class: "td-shuf td-chg" }, "Change event"); b.addEventListener("click", () => changeEvent().catch((e) => console.warn(e))); return b; })() : null; /* (update 848) */
      const sub = id === "course" ? `Up next: ${UPCOMING.name}` : id === "rank" ? `${pick[0].x?.yr || ""} · ${tourPick && tourPick !== ALL ? tourName(tourPick) : "every tour"}${pick[0].x?.hits?.[0]?.n ? ` · ${pick[0].x.hits[0].n} players with enough rounds` : ""}` : id === "next" ? next?.name || "" : sub0;
      const content = id === "gear" ? el("div", { class: "td-gear2" }, pick.map(gearStory)) : id === "rank" ? rankBox(pick) : id === "fact" || id === "bestwk" ? el("div", { class: "td-fxs" }, pick.map(factCard)) : id === "tour" ? tourGroups(mine, grpShown) : id === "course" ? courseGroups(mine, grpShown) : el("div", { class: "td-cols" }, pick.map(column));
      const shuf = (() => { const b = el("button", { type: "button", class: "td-shuf", title: "Show other stories", "aria-label": `Shuffle ${title}` }, "↻ Shuffle"); /* (update 801: every section) */
        b.addEventListener("click", () => { if (id === "fact") { factShuf++; factMemo = null; } else secShuf[sk] = (secShuf[sk] || 0) + 1; drawFeed(collect()); requestAnimationFrame(() => document.getElementById(`td-${sk}`)?.scrollIntoView({ block: "nearest" })); }); return b; })();
      // (update 820) 3 stories to start (Form, Player Spotlight, Where to Improve, Results & Milestones): "Show more" adds 3 more each press
      const moreB = MORE3.includes(id) && mine.length > pick.length ? (() => { const left = mine.filter((h) => !pick.includes(h)), b = el("button", { type: "button", class: "td-more-btn" }, `Show more (${left.length})`);
        b.addEventListener("click", () => { secMore[sk] = (secMore[sk] || 0) + 1; for (const h of left.splice(0, STEP(id))) { content.appendChild(id === "gear" ? gearStory(h) : column(h)); pick.push(h); } secSeen[sk] = new Set(pick.map((h) => h.id)); if (left.length) b.textContent = `Show more (${left.length})`; else b.remove(); }); return el("div", { class: "td-more-row" }, b); })() : null;
      secs.push(el("section", { class: `td-sec${FULL.has(id) ? " full" : ""}`, id: `td-${id}${sfx}`, "data-sec": id }, [el("div", { class: "td-sh" }, [el("h2", {}, title), /* (update 845: no Shuffle) */ chg, sub ? el("span", {}, sub) : null]), content, moreB]));
      if (PAIR.includes(id) && !MORE3.includes(id)) pairRest.set(id, { box: content, more: mine.filter((h) => !pick.includes(h)) }); /* (update 789: to even the pair up) */
      secSeen[sk] = new Set((grpShown.length ? grpShown : pick).map((h) => h.id));
    }
    // (update 780) laid out in order: full-width sections on their own; Player Spotlight and Where to Improve side by side;
    // Equipment, Rankings and Results & Milestones in a row of three (two side by side, or one full, when some are missing);
    // any other half-width section in two balanced columns (update 757)
    const byId = new Map(secs.map((x) => [x.dataset.sec, x])), done = new Set(), laid = []; let run = [];
    const est = (x) => 1.2 + x.querySelectorAll("article").length * 2 + x.querySelectorAll("tr").length * 0.45 + x.querySelectorAll(".td-wire-i, .td-fx").length * 0.9 + x.querySelectorAll("svg.mc, .td-chart, .td-holewrap").length * 1.6;
    const flush = () => { if (!run.length) return; if (run.length === 1) { run[0].classList.add("full"); laid.push(run[0]); run = []; return; }
      const cols = [[], []], h = [0, 0]; for (const x of run) { const i2 = h[0] <= h[1] ? 0 : 1; cols[i2].push(x); h[i2] += est(x); }
      laid.push(el("div", { class: "td-two" }, [el("div", { class: "td-stackc" }, cols[0]), el("div", { class: "td-stackc" }, cols[1])])); run = []; };
    const group = (ids) => { const xs = ids.map((i2) => byId.get(i2)).filter(Boolean); xs.forEach((x) => done.add(x)); if (!xs.length) return;
      if (xs.length === 1) { xs[0].classList.add("full"); laid.push(xs[0]); return; }
      laid.push(el("div", { class: xs.length === 3 ? "td-three" : "td-two td-pair" }, xs.map((x) => el("div", { class: "td-stackc" }, [x])))); };
    for (const id of ids) { const x = byId.get(id); if (!x || done.has(x)) continue;
      if (PAIR.includes(id)) { flush(); group(PAIR); continue; }
      if (TRIO.includes(id)) { flush(); group(TRIO); continue; }
      if (FULL.has(id)) { flush(); x.classList.add("full"); laid.push(x); done.add(x); continue; }
      run.push(x); done.add(x); }
    flush();
    return { secs, laid, pairRest }; };
    const multiFav = !selfKey && !picked.size && (favs.length ? favs : keys).length > 1; // (update 847)
    // (update 846) several players: the course's Skill Importance and Hole Strategy (and This Week) on the page, above Around the Tour
    // (update 849) no player picked: Did You Know (the tour's leaders first, then facts), This Week, the course (nothing about one
    // player in it) and Around the Tour
    const pageRest = !multiFav && glSide.length ? sorted.filter((h) => !h.id.startsWith("gl-")) /* (update 848: on the side instead) */ : multiFav ? sorted.filter((h) => SEC_OF[h.kind] === "tour" || (SEC_OF[h.kind] === "fact" && !h.id.startsWith("gl-")) || (SEC_OF[h.kind] === "course" && !h.k && cgOf(h) !== "player") || (SEC_OF[h.kind] === "next" && !h.k)) : sorted;
    const { secs, laid, pairRest } = buildSecs(multiFav ? ["fact", "next", "course", "tour"] : orderNow(), pageRest, subjK);
    playerBuild = (k) => buildSecs(PLAYER_IDS, sorted.filter((h) => h.k === k || (!h.k && ["course", "next"].includes(SEC_OF[h.kind]))), k, `-${String(k).replace(/[^a-z0-9]/gi, "")}`);
    for (const [k, b] of secBoxes) if (b.closest("details")?.open) fillSecs(k);
    drawOvTop().catch(() => {}); for (const k of headBoxes.keys()) fillHead(k); favGrad(); // (update 845) (847: the list again for the tour picked)
    shownLead = lead?.id || null;
    const reB = el("button", { type: "button", class: "td-shuf td-reroll", title: "Show other top stories", "aria-label": "Show other top stories" }, "↻ Shuffle") /* (update 790: as Did You Know's) */;
    reB.addEventListener("click", (e) => { e.stopPropagation(); reroll = true; if (lastItems) drawFeed(lastItems); document.getElementById("td-front")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); });
    const leadEl = leadStory(leadM); void reB; /* (update 845: no Shuffle) */ /* (update 791: the shuffle at the top; 837: not with the biggest mover) */
    const sideEl = el("aside", { class: "td-side" }, sideM.map(brief));
    // (update 795) a lead taller than the stories beside it: more of the day's stories down the side (up to 3 more) until
    // they come out about even
    requestAnimationFrame(() => { const more2 = news.filter((h) => !fp.includes(h) && h.kind !== "Fact"); if (innerWidth <= 860 || !side4th) return; void more2; /* (update 856: three, and the fourth only when the hero is much taller) */ const used = () => (sideEl.lastElementChild ? sideEl.lastElementChild.getBoundingClientRect().bottom - sideEl.getBoundingClientRect().top : 0); /* (the aside is stretched to the lead's height: measure its stories) */
      if (leadEl.offsetHeight - used() >= 220) sideEl.appendChild(brief(side4th)); });
    // (update 866) no real story about a player to lead with (no mover, no result, trend, rank or new club: you with a round or
    // two, or no favorites): no top section at all, rather than course notes the Course Strategy section below repeats
    const heroOk = moverMode || (leadM && leadM.k && LEADS.has(leadM.kind));
    if (!heroOk) mount(frontBox, []); else
    mount(frontBox, el("section", { class: "td-front", id: "td-front" }, [leadEl, sideEl])); // (update 837: at the very top)
    const meNow = solo() && ownKey && (picked.has(ownKey) || subjK === ownKey) && ownAll.length; // (update 863) "Me": your own game, from whatever you've entered
    mount(feed, [meNow ? myGame() : null, el("div", { class: "td-grid" }, laid), solo() && subjK ? pdfCard(subjK) : null]); // (update 839: no Today) (update 849: and their PDF report at the end)
    // (update 789) Player Spotlight and Where to Improve about the same length: stories added to the shorter one (as many as
    // it has) until it reaches the other
    requestAnimationFrame(() => { const a = pairRest.get("spot"), b = pairRest.get("focus"); if (!a || !b) return;
      for (let n = 0; n < 8; n++) { const ha = a.box.offsetHeight || 0, hb = b.box.offsetHeight || 0, /* (the stories' own height: the cards are stretched to match) */ sh = ha < hb ? a : b, gap = Math.abs(ha - hb);
        if (gap < 140 || !sh.more.length) break; sh.box.appendChild(column(sh.more.shift())); } });
    const go2 = (id) => { const n = document.getElementById(`td-${id}`); if (!n) return; const bar = document.querySelector(".rail")?.getBoundingClientRect().bottom || 0; /* (the top bar stays put over the page) */ window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - Math.max(0, bar) - 12, behavior: "smooth" }); }; /* (update 734: to the header, clear of the top bar) */
    mount(secNav, [...secs.map((x) => [x.dataset.sec, SEC[x.dataset.sec][0]])].map(([id, t2], i) => { const a2 = el("a", { href: "#", "data-sec": id }, t2); void i; a2.addEventListener("click", (e) => { e.preventDefault(); go2(id); }); return a2; }));
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
    for (const c of ["TOTAL", ...cats]) { const v = ok.map((p) => [p.k, avgOf(p.rs, c === "TOTAL" ? tot : (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1]), q = (x) => Math.round(x * 100) / 100; let rk = 0; by[c] = new Map(v.map(([k, x], i) => { if (!i || q(x) !== q(v[i - 1][1])) rk = i + 1; return [k, rk]; })); by[`${c}#`] = v.length; } // (update 849: ties share the place)
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
      add("weapon", "Strength", `${CATN[best[0]]} is ${me ? "your" : P} weapon`, `${sg2(best[1])} strokes gained per round ${CAT_IN[best[0]]}${r ? `, ${ordN(r)} of ${n} on tour` : ""} in ${SY}${on}`, toB(best[0]), "Leaderboards · Rankings", 4.4, { c: best[0], all: cats.map((c0) => [c0, avgC(c0)]) }); }
    // steadiness against the tour, the part of the game where they rank best for it
    if (ok && F.ok.length >= 10) { let pick = null;
      for (const c of cats) { const sds = F.ok.map((p) => [p.k, sdOf(p.rs.filter((r) => !r.eventLevel).map((r) => inCat(r, c)))]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]);
        const i = sds.findIndex((x) => x[0] === k); if (i < 0) continue; if (!pick || i < pick.i) pick = { c, i, sd: sds[i][1], typ: sds[Math.floor(sds.length / 2)][1], n: sds.length, pts: sds.map(([kk, sd]) => ({ x: avgOf(F.ok.find((p) => p.k === kk).rs, (r) => inCat(r, c)), y: sd, label: nameOf(kk), hot: kk === k })) }; }
      if (pick && pick.i < pick.n / 3) add("steady", "Steady", `${S} ${me ? "are" : "is"} the ${pick.i === 0 ? "" : `${ordN(pick.i + 1)} `}steadiest ${CAT_WHO[pick.c]} on tour`, `A round-to-round swing of ±${pick.sd.toFixed(2)} strokes ${CAT_IN[pick.c]}, against the tour's typical ±${pick.typ.toFixed(2)} (${SY}${on})`, toB(pick.c), "Leaderboards · Rankings", 4.2, { c: pick.c, pts: pick.pts }); }
    // what drives the good weeks
    const evs = eventsOf(rs).filter((e) => e.rs.length >= 2);
    if (evs.length >= 6) { const byT = [...evs].sort((a, b) => b.avg - a.avg), top = byT.slice(0, 3), bot = byT.slice(-3);
      const d = cats.map((c) => { const a = avgOf(top.flatMap((e) => e.rs), (r) => inCat(r, c)), b = avgOf(bot.flatMap((e) => e.rs), (r) => inCat(r, c)); return [c, a - b, a, b]; }).sort((a, b) => b[1] - a[1])[0];
      add("drives", "What wins", `${CATN[d[0]]} drives ${me ? "your" : P} good weeks`, `In ${me ? "your" : "the"} 3 best tournaments of ${SY}: ${sg2(d[2])} per round ${CAT_IN[d[0]]}; in the 3 worst: ${sg2(d[3])}`, () => toStats(k, { view2: "full", year: [SY], span: 0 }, "Tournaments", null), "Stats · Tournaments"); }
    // the gap to the leader, in a part of the game that changes with the day
    if (ok && F.ok.length >= 10) { const c = ["TOTAL", ...cats][Math.floor(hash(`${k}|${DAY}`) * 5)], nm = c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase();
      const vs = F.ok.map((p) => [p.k, avgOf(p.rs, c === "TOTAL" ? tot : (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1]), i = vs.findIndex((x) => x[0] === k);
      const xg = { c, board: { c } };
      if (i === 0) add("gap", "Leader", `${S} lead${me ? "" : "s"} the tour in ${nm}`, `${sg2(vs[0][1])} per round, ${(vs[0][1] - vs[1][1]).toFixed(2)} clear of ${nameOf(vs[1][0])} (${SY}${on})`, toB(c), "Leaderboards · Rankings", 4.6, xg);
      else if (i > 0) add("gap", "The chase", `${S} ${me ? "are" : "is"} ${(vs[0][1] - vs[i][1]).toFixed(2)} behind the lead in ${nm}`, `${ordN(i + 1)} at ${sg2(vs[i][1])} per round; ${nameOf(vs[0][0])} leads at ${sg2(vs[0][1])} (${SY}${on})`, toB(c), "Leaderboards · Rankings", 3.9, xg); }
    // a stat, a different one each day
    if (ok && STAT_KEYS.length) { const order = [...STAT_KEYS].sort((a, b) => hash(`${a}|${k}|${DAY}`) - hash(`${b}|${k}|${DAY}`));
      for (const key of order) { const def = STAT_DEFS[key], vs = F.ok.map((p) => [p.k, obsAvg(p.rs, key)]).filter((x) => x[1] != null); if (vs.length < 10) continue;
        vs.sort((a, b) => (def.higher ? b[1] - a[1] : a[1] - b[1])); const i = vs.findIndex((x) => x[0] === k); if (i < 0) continue;
        add("stat", def.label, `${S}: ${ordN(i + 1)} on tour in ${def.label.replace(/ %$/, "").toLowerCase()}`, `${fmtStat(def, vs[i][1])}${i ? `; the leader, ${nameOf(vs[0][0])}: ${fmtStat(def, vs[0][1])}` : `; next: ${nameOf(vs[1][0])}, ${fmtStat(def, vs[1][1])}`} (${SY}${on}, of ${vs.length} players)`,
          () => toBoard({ year: [SY] }, null, EX.lead(`Who leads in ${def.label}?`)), "Leaderboards", i < 10 ? 4.3 : 3.7, { board: { key } }); break; } }
    // year on year: the part of the game that's come on most since last season
    const prev = sgRounds(rawOf(playerOf(k))).filter((r) => yrOf(r) === String(Number(SY) - 1));
    if (prev.length >= 20 && rs.length >= 15) { const g = cats.map((c) => [c, avgC(c) - avgOf(prev, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0];
      if (g[1] >= 0.15) add("yoy", "Year on year", `${P} ${CATW[g[0]]} is up ${g[1].toFixed(2)} per round on ${Number(SY) - 1}`, `Strokes gained ${CAT_IN[g[0]]}: ${sg2(avgC(g[0]))} per round in ${SY}, against ${sg2(avgOf(prev, (r) => inCat(r, g[0])))} last season`, () => go(`${cmpBase(k)}&pick=years:${Number(SY) - 1},${SY}`, EX.cmpYears("How does this season compare to last?")), "Compare · Seasons", 4.1); }
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
  let factMemo = null, factShuf = 0; const factSeen = new Set(); // (update 789: the shuffle button; 791: facts not yet shown first)
  // (update 841) the PDF report's "At a glance" as Did You Know cards, for each player this season on the tour picked:
  // rounds in the green (and where that ranks on tour), the best run of rounds gaining, the biggest upside (getting back to
  // their best 12-round stretch in a part of the game) and the steadiest part of the game (and where that ranks). The DP
  // World Tour (a value an event): by event, its best 3-event stretch.
  const glMemo = new Map();
  const ord1 = (n) => (n === 1 ? "1st" : ordN(n));
  // (update 849) Did You Know with no player picked: the tour's leaders this season (most rounds in the green, the longest
  // run of them, the steadiest, the streakiest, the hottest form), each with its leaderboard
  let tlMemo = null;
  function tourLeaders() {
    const F = seasonField(), SY = F.SY, mk0 = `${SY}|${tourPick}|${F.ok.length}`; if (tlMemo?.k === mk0) return tlMemo.v; const out = []; tlMemo = { k: mk0, v: out };
    if (F.ok.length < 10) return out;
    const sdv = (a) => { if (a.length < 2) return null; const m = a.reduce((t, v) => t + v, 0) / a.length; return Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / (a.length - 1)); };
    const P = F.ok.map((p) => { const rs = p.rs.filter((r) => !r.eventLevel).sort((a, b) => String(a.date).localeCompare(String(b.date))), v = rs.map(tot); if (v.length < 8) return null;
      let run = 0, best = 0; for (const x of v) { run = x > 0 ? run + 1 : 0; best = Math.max(best, run); }
      const fs = formSplit(p.rs); return { k: p.k, n: v.length, green: v.filter((x) => x > 0).length / v.length, run: best, sd: sdv(v), form: fs ? perRound(fs.last) - perRound(fs.prev) : null }; }).filter(Boolean);
    if (P.length < 10) return out;
    const on = tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : "";
    const add = (id, kick, list, val, txt, big, small, title, extra = "") => { const L = list.filter((x) => val(x) != null).sort((a, b) => val(b) - val(a)); if (!L.length) return; const w = L[0];
      out.push({ id: `tl-${id}`, k: w.k, kind: "Fact", kick, score: 3.6 - out.length * 0.01, fx: { big: big(w), small, lbl: `${nameOf(w.k)} · ${SY}${on}` }, title: title(w), detail: `${extra ? `${extra(w, L)} · ` : ""}next: ${L.slice(1, 3).map((x) => `${nameOf(x.k)} ${txt(x)}`).join(", ")} · of ${L.length} players`,
        board: { rows: L.map((x) => [x.k, val(x), txt(x)]), title: `${kick}, ${SY}${on}` }, to: "Leaderboards · Rankings", run: () => toBoard({ year: [SY], cats: [] }, "Rankings", null) }); };
    add("green", "Most rounds in the green", P, (x) => x.green, (x) => `${Math.round(x.green * 100)}%`, (x) => `${Math.round(x.green * 100)}%`, "of rounds gaining strokes", (x) => `${nameOf(x.k)} gains strokes in ${Math.round(x.green * 100)}% of rounds${on}`, (x) => `${Math.round(x.green * x.n)} of ${x.n} rounds`);
    add("run", "Longest run", P, (x) => x.run, (x) => `${x.run} rounds`, (x) => String(x.run), "rounds in a row gaining", (x) => `${nameOf(x.k)}'s ${x.run} straight rounds gaining strokes is the longest run of ${SY}${on}`);
    add("steady", "Steadiest", P, (x) => (x.sd == null ? null : -x.sd), (x) => `±${x.sd.toFixed(2)}`, (x) => `±${x.sd.toFixed(2)}`, "typical swing round to round", (x) => `${nameOf(x.k)} is the steadiest player${on}: about ±${x.sd.toFixed(2)} strokes from one round to the next`);
    add("streaky", "Streakiest", P, (x) => x.sd, (x) => `±${x.sd.toFixed(2)}`, (x) => `±${x.sd.toFixed(2)}`, "typical swing round to round", (x) => `${nameOf(x.k)} is the streakiest player${on}: boom or bust, about ±${x.sd.toFixed(2)} strokes from one round to the next`);
    add("hot", "Hottest form", P, (x) => x.form, (x) => sg2(x.form), (x) => sg2(x.form), "per round, last 12 vs the 12 before", (x) => `${nameOf(x.k)} has the hottest form${on}: ${sg2(x.form)} per round better over the last 12 rounds`);
    return out;
  }
  function glanceFacts(k) {
    const F = seasonField(), SY = F.SY, mk0 = `${k}|${SY}|${tourPick}|${field.length}|${F.ok.length}`; if (glMemo.has(mk0)) return glMemo.get(mk0);
    const rs0 = sgRounds(rawOf(playerOf(k))).filter((r) => yrOf(r) === SY), byEv = rs0.length > 0 && rs0.every((r) => r.eventLevel), u = byEv ? "event" : "round";
    const ser = (rs) => (byEv ? eventsOf(rs).map((e) => ({ date: e.end, v: avgOf(e.rs, tot), c: Object.fromEntries(cats.map((c) => [c, avgOf(e.rs, (r) => inCat(r, c))])) }))
      : rs.filter((r) => !r.eventLevel).sort((a, b) => String(a.date).localeCompare(String(b.date))).map((r) => ({ date: r.date, v: tot(r), c: Object.fromEntries(cats.map((c) => [c, inCat(r, c)])) })));
    const S = ser(rs0), out = []; glMemo.set(mk0, out); if (S.length < 6) return out;
    const me = isMe(k), P = me ? "Your" : poss(nameOf(k)), who = me ? "You" : nameOf(k), on = tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : "";
    const sdv = (a) => { if (a.length < 2) return null; const m = a.reduce((t, v) => t + v, 0) / a.length; return Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / (a.length - 1)); };
    const md = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const fieldS = F.ok.map((p) => [p.k, ser(p.rs)]).filter(([, s0]) => s0.length >= 6);
    const add = (id, kick, fx, title, detail, extra = {}) => out.push({ id: `gl-${id}-${k}`, k, kind: "Fact", kick, fx, title, detail, score: 3.4 - out.length * 0.01, ever: true, to: "Stats · Player Stats", run: () => toStats(k, { view2: "full", year: [SY], span: 0 }, null, null), ...extra });
    // rounds in the green
    // (update 852) every card with its place on tour: the rank (ties share it), the percentile and the tour's median
    const rankIn = (list, mine, higher = true) => (list.length >= 10 && mine != null ? 1 + list.filter((x) => (higher ? x[1] > mine + 1e-9 : x[1] < mine - 1e-9)).length : null);
    const pctW = (rk, n) => { const p = Math.round((100 * rk) / n); return p <= 50 ? `top ${Math.max(1, p)}%` : `bottom ${Math.max(1, 101 - p)}%`; };
    const medOf = (list) => { const v = list.map((x) => x[1]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const ctx = (rk, n, med) => (rk ? `${ord1(rk)} of ${n} on tour (${pctW(rk, n)})${med != null ? ` · tour median ${med}` : ""}` : "");
    const pos = S.filter((q) => q.v > 0).length, pct = Math.round((pos / S.length) * 100);
    const gl = fieldS.map(([kk, s0]) => [kk, s0.filter((q) => q.v > 0).length / s0.length]).sort((a, b) => b[1] - a[1]), gr = rankIn(gl, pos / S.length), gi = gr ? gr - 1 : -1, gMed = medOf(gl);
    add("green", `${byEv ? "Events" : "Rounds"} in the green`, { big: `${pos} of ${S.length}`, small: `${u}s gaining strokes`, lbl: `${pct}% in ${SY}${gr ? ` · ${ord1(gr)} of ${gl.length} (${pctW(gr, gl.length)})` : ""}` },
      `${who} gained strokes in ${pos} of ${S.length} ${u}s in ${SY}${on}`, `${pct}% of ${u}s better than the tour average${gr ? ` · ${ctx(gr, gl.length, `${Math.round(gMed * 100)}%`)}` : ""}`,
      gi >= 0 ? { board: { rows: gl.map(([kk, v]) => [kk, v, `${Math.round(v * 100)}%`]), title: `Share of ${u}s gaining strokes, ${SY}` } } : {});
    // best run
    let run = 0, st = 0, best = { len: 0 }; S.forEach((q, i) => { if (q.v > 0) { if (!run) st = i; run++; if (run > best.len) best = { len: run, from: S[st].date, to: q.date }; } else run = 0; });
    const runOf = (s0) => { let r0 = 0, b0 = 0; for (const q of s0) { r0 = q.v > 0 ? r0 + 1 : 0; b0 = Math.max(b0, r0); } return b0; };
    const rl = fieldS.map(([kk, s0]) => [kk, runOf(s0)]).sort((a, b) => b[1] - a[1]), rr = rankIn(rl, best.len), rMed = medOf(rl);
    if (best.len >= 2) add("run", "Best run", { big: String(best.len), small: `${u}s in a row gaining`, lbl: `${md(best.from)} – ${md(best.to)}${rr ? ` · ${ord1(rr)} of ${rl.length} (${pctW(rr, rl.length)})` : `, ${SY}`}` },
      `${P} best run of ${SY}: ${best.len} ${u}s in a row gaining strokes`, `${md(best.from)} to ${md(best.to)}${on}${rr ? ` · ${ctx(rr, rl.length, `${rMed} ${u}s`)}` : ""}`,
      rr ? { board: { rows: rl.map(([kk, v]) => [kk, v, `${v} ${u}s`]), title: `Longest run of ${u}s gaining strokes, ${SY}` } } : {});
    // biggest upside
    const win = byEv ? 3 : 12;
    if (S.length >= win + 2) { const up = cats.map((c) => { let b = -Infinity, at = 0; for (let i = 0; i + win <= S.length; i++) { const v = avgOf(S.slice(i, i + win), (q) => q.c[c] ?? 0); if (v > b) { b = v; at = i; } }
        const now = avgOf(S, (q) => q.c[c] ?? 0); return { c, gain: b - now, b, now, from: S[at].date, to: S[at + win - 1].date }; }).sort((a, b) => b.gain - a.gain)[0];
      // (update 852) against the tour: each player's own gap to their best stretch in that part of the game
      const gapOf = (s0) => { if (s0.length < win + 2) return null; let b0 = -Infinity; for (let i = 0; i + win <= s0.length; i++) b0 = Math.max(b0, avgOf(s0.slice(i, i + win), (q) => q.c[up.c] ?? 0)); return b0 - avgOf(s0, (q) => q.c[up.c] ?? 0); };
      const ul = up ? fieldS.map(([kk, s0]) => [kk, gapOf(s0)]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]) : [], ur = up ? rankIn(ul, up.gain) : null, uMed = medOf(ul);
      if (up) up.ctx = ur ? ` · the ${ord1(ur)} biggest in ${CATN[up.c].toLowerCase()} of ${ul.length} on tour (${pctW(ur, ul.length)}) · tour median ${sg2(uMed)}` : "";
      if (up && up.gain > 0.01) add("up", `Biggest upside · ${CATN[up.c]}`, { big: sg2(up.gain), small: `per round in ${CATN[up.c].toLowerCase()}`, lbl: `back to ${me ? "your" : "their"} best ${win}-${u} stretch (${sg2(up.b)}, ${md(up.from)} – ${md(up.to)})` },
        `${CATN[up.c]}: ${sg2(up.gain)} per round to gain by getting back to ${his(k)} best ${win}-${u} stretch`, `${sg2(up.b)} per round from ${md(up.from)} to ${md(up.to)}, against ${sg2(up.now)} over ${SY}${up.ctx || ""}`, ur ? { board: { rows: ul.map(([kk, v]) => [kk, v, sg2(v)]), title: `Gap to their best ${win}-${u} stretch, ${CATN[up.c].toLowerCase()}, ${SY}` } } : {}); }
    // steadiest
    const sw = cats.map((c) => ({ c, sd: sdv(S.map((q) => q.c[c] ?? 0)) })).filter((x) => x.sd != null).sort((a, b) => a.sd - b.sd);
    if (sw.length) { const s0 = sw[0], sx = sw.at(-1);
      const fsd = fieldS.map(([kk, s1]) => [kk, sdv(s1.map((q) => q.c[s0.c] ?? 0))]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]), sR = rankIn(fsd, s0.sd, false), si = sR ? sR - 1 : -1, sMed = medOf(fsd);
      add("steady", `Steadiest · ${CATN[s0.c]}`, { big: `±${s0.sd.toFixed(2)}`, small: `typical swing ${u} to ${u}`, lbl: [si >= 0 ? `${ord1(si + 1)} steadiest of ${fsd.length} (${pctW(si + 1, fsd.length)})` : "", sw.length > 1 ? `${CATN[sx.c]} swings the most (±${sx.sd.toFixed(2)})` : ""].filter(Boolean).join(" · ") },
        `${P} steadiest part of the game: ${CATN[s0.c].toLowerCase()}, about ±${s0.sd.toFixed(2)} from one ${u} to the next`, `Strokes gained ${CAT_IN[s0.c]}: a typical swing of ±${s0.sd.toFixed(2)} ${u} to ${u} in ${SY}${si >= 0 ? ` · ${ord1(si + 1)} steadiest of ${fsd.length} on tour (${pctW(si + 1, fsd.length)}) · tour median ±${sMed.toFixed(2)}` : ""}${sw.length > 1 ? ` · ${CATN[sx.c].toLowerCase()} swings the most: ±${sx.sd.toFixed(2)}` : ""}`,
        si >= 0 ? { board: { rows: fsd.map(([kk, v]) => [kk, v, `±${v.toFixed(2)}`]), title: `Steadiest ${CATN[s0.c].toLowerCase()}: typical swing ${u} to ${u}, ${SY}` } } : {}); }
    return out;
  }
  function factsAll() {
    const keysF = shownKeys(), mk = `${SLOT}|${factShuf}|${tourPick}|${keysF.join(",")}|${field.length}`; if (factMemo?.k === mk) return factMemo.v;
    const F = seasonField(), SY = F.SY, on = tourPick && tourPick !== ALL ? ` on the ${tourName(tourPick)}` : "", cand = [];
    if (F.ok.length >= 10) {
      const last12 = (rs) => rs.filter((r) => !r.eventLevel).slice(-12);
      const wins = [["season", `in ${SY}${on}`, (p) => p.rs, F.ok], ["l12", `over the last 12 rounds${on}`, (p) => last12(p.rs), F.ok.filter((p) => last12(p.rs).length >= 12)]];
      // (update 749) strokes gained by part of the game as it was; every other stat only at a distance (below, from the detail)
      const mets = ["TOTAL", ...cats].map((c) => ({ id: c, lbl: c === "TOTAL" ? "strokes gained" : `strokes gained ${CAT_IN[c]}`, higher: true, val: (rs) => avgOf(rs, c === "TOTAL" ? tot : (r) => inCat(r, c)), fmt: (v) => `${sg2(v)} per round` }));
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
          if (false && b && b[1] > 0.5) cand.push({ fx: { big: sg2(b[1]), small: "per round", lbl: `Best ${CATW[c]} week · ${fullEv(b[0].event)}` }, id: `fx-wk-${c}-${k}`, k, kick: "Best week", title: `${me ? "Your" : poss(nameOf(k))} best ${CATW[c]} week of ${SY}: ${sg2(b[1])} per round at ${b[0].event}`, detail: `Strokes gained ${CAT_IN[c]}, over ${b[0].rs.length} rounds there`, run: () => toStats(k, { view2: "full", year: [SY], span: 0 }, "Tournaments", null), to: "Stats · Tournaments" }); }
        // a single round among the season's best on tour (any part of the game)
        for (const c of ["TOTAL", ...cats]) { const f = c === "TOTAL" ? tot : (r) => inCat(r, c), mine = pl.rs.filter((r) => !r.eventLevel).map((r) => [r, f(r)]).sort((a, b) => b[1] - a[1])[0]; if (!mine) continue;
          let better = 0; for (const p of F.all) for (const r of p.rs) if (!r.eventLevel && f(r) > mine[1]) { better++; if (better > 10) break; }
          if (better < 5) cand.push({ fx: { big: sg2(mine[1]), small: better ? `top ${better + 1} on tour` : "best on tour", lbl: `${c === "TOTAL" ? "SG: Total" : `SG: ${CATN[c]}`}, one round · ${fullEv(mine[0].event)}` }, id: `fx-rd-${c}-${k}`, k, kick: "Round to remember", title: `${me ? "Your" : poss(nameOf(k))} ${sg2(mine[1])} ${c === "TOTAL" ? "round" : `${CATW[c]} round`} at ${mine[0].event} is ${better ? `in the top ${better + 1}` : "the best"} on tour this season`, detail: `Strokes gained ${c === "TOTAL" ? "total" : CAT_IN[c]}${mine[0].roundNo ? `, round ${mine[0].roundNo}` : ""} (${SY}${on})`, run: () => toStats(k, { view2: "full", year: [SY], span: 0, openRounds: true }, null, null), to: "Stats · Player Stats · Rounds" }); } }
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
            run: () => toBoard({ year: [SYd], cats: isSG ? [parts[1]] : [], dist: [dist] }, "Rankings", null), to: "Leaderboards · Rankings" }); } } } // (update 842: Leaderboards, not the old Focus view)
    // a different set each half day: shuffled by the slot, at most 2 a player when there are several
    cand.sort((a, b) => (factShuf ? (factSeen.has(a.id) ? 1 : 0) - (factSeen.has(b.id) ? 1 : 0) : 0) || hash(`${a.id}|${SLOT}|${factShuf}`) - hash(`${b.id}|${SLOT}|${factShuf}`));
    const out = [], per = new Map(); for (const x of cand) { if (out.length >= 8) break; const n = per.get(x.k) || 0; if (keysF.length > 1 && n >= 2) continue; per.set(x.k, n + 1); out.push({ ...x, kind: "Fact", score: 3.2 - out.length * 0.01 }); }
    out.forEach((x) => factSeen.add(x.id)); if (factSeen.size >= cand.length) factSeen.clear(); factMemo = { k: mk, v: out }; return out;
  }
  // (update 800) Where to Improve's detail: inside the part of the game, the distance ranges losing the most (per round), any
  // range holding up despite it, and a practice fix for the worst, from the player's own shots this season (their clubs'
  // rounds, else the field's shot detail; until either is in, nothing)
  // (update 801) the course's distance ranges (as bandOf in the course read) for a range label from the stats ("150-175 yds",
  // "<5 ft"): its middle, put in the course's range; and a player's season in them, strokes gained per round
  const bandLbl = (c0, d) => (c0 === "APP" ? `APP|${d < 75 ? "30-75" : d < 125 ? "75-125" : d < 175 ? "125-175" : d < 225 ? "175-225" : "225+"} yds` : c0 === "ARG" ? `ARG|${d < 10 ? "0-10" : d < 20 ? "10-20" : "20-30"} yds` : c0 === "PUTT" ? `PUTT|${d < 5 ? "0-5" : d < 10 ? "5-10" : d < 20 ? "10-20" : d < 40 ? "20-40" : "40+"} ft` : null);
  const midOf = (lab) => { const t = String(lab); let m = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/.exec(t); if (m) return (Number(m[1]) + Number(m[2])) / 2; m = /^[<≤]\s*(\d+)/.exec(t); if (m) return Number(m[1]) / 2; m = /(\d+)\s*\+|^>\s*(\d+)/.exec(t); if (m) return Number(m[1] || m[2]) * 1.1; m = /(\d+)/.exec(t); return m ? Number(m[1]) : null; };
  // (update 809) the distance ranges the data itself uses for a part of the game ("140-160 yds", "<30 yds", ">25 ft"), read
  // from the players' shots; a course's shots go in the range that holds their distance, so every card uses the same ranges
  const rngLbl = (t) => { t = String(t); let m = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/.exec(t); if (m) return [Number(m[1]), Number(m[2])]; m = /^\s*[<≤]\s*(\d+)/.exec(t); if (m) return [0, Number(m[1])]; m = /^\s*[>≥]\s*(\d+)|(\d+)\s*\+/.exec(t); if (m) return [Number(m[1] || m[2]), 1e9]; return null; };
  // (update 860) the stats data's own ranges only: not the rounds entered by hand (Enter New Round buckets differently:
  // 50-75 yds, 200-225 yds), and only ranges with real use (1%+ of that part of the game's shots)
  const dataLabels = (c) => { const seen = new Map(), cnt = new Map(); let tot = 0; const add = (rs0) => { for (const r of rs0 || []) for (const s0 of r.shots || []) if (s0.cat === c && s0.dist) { tot++; cnt.set(s0.dist, (cnt.get(s0.dist) || 0) + 1); if (!seen.has(s0.dist)) seen.set(s0.dist, rngLbl(s0.dist)); } };
    for (const [k0, rs0] of gearData) if (!(ownP && k0 === ownP.key)) add(rs0); if (detail?.by) for (const [k0, rs0] of detail.by) if (!(ownP && k0 === ownP.key)) add(rs0);
    const keep = [...seen].filter(([l, g]) => g && (cnt.get(l) || 0) >= Math.max(3, tot * 0.01)).sort((a, b) => (cnt.get(b[0]) || 0) - (cnt.get(a[0]) || 0)), out0 = [];
    for (const x of keep) if (!out0.some((y) => x[1][0] < y[1][1] && y[1][0] < x[1][1])) out0.push(x); /* (a range overlapping a more used one: another way of bucketing, dropped) */
    return out0.sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]); };
  const lblFor = (labs, d) => labs.find(([, g]) => d >= g[0] && d < g[1])?.[0] || null;
  // the course's shots in those ranges: strokes gained a shot for the top 10, the rest and one player, and attempts per round
  function courseBands(R0, c, pk, perRd = 0) { /* (update 867) perRd: the player's rounds here: strokes gained per round, not a shot */ const labs = dataLabels(c); if (!labs.length) return null; const acc = new Map(), get = (l) => acc.get(l) || acc.set(l, { t: [0, 0], r: [0, 0], p: [0, 0], n: 0 }).get(l);
    for (const [c1, d, sg, top, who] of R0.shotsC) { if (c1 !== c) continue; const l = lblFor(labs, d); if (!l) continue; const o = get(l); o.n++; o[top ? "t" : "r"][0] += sg; o[top ? "t" : "r"][1]++; if (pk && who === pk) { o.p[0] += sg; o.p[1]++; } }
    if (perRd) return labs.map(([l]) => [l, acc.get(l)]).filter(([, o]) => o && o.n >= 10).map(([l, o]) => ({ l, top: o.t[1] >= 5 && R0.nTop ? o.t[0] / R0.nTop : null, rest: o.r[1] && R0.nRest ? o.r[0] / R0.nRest : null, me: o.p[1] >= 3 && perRd > 0 ? o.p[0] / perRd : null, att: o.n / Math.max(1, R0.nRds) }));
    return labs.map(([l]) => [l, acc.get(l)]).filter(([, o]) => o && o.n >= 10).map(([l, o]) => ({ l, top: o.t[1] >= 5 ? o.t[0] / o.t[1] : null, rest: o.r[1] ? o.r[0] / o.r[1] : null, me: o.p[1] >= 3 ? o.p[0] / o.p[1] : null, att: o.n / Math.max(1, R0.nRds) })); }
  function seasonBands(k, c, SY, perRd = false) { /* (update 867) perRd: strokes gained per round */ const rs = (gearData.get(k) || detail?.by.get(k) || []).filter((r) => yrOf(r) === String(SY) && (ownP?.key === k || onTour(r)) && !r.eventLevel); if (rs.length < 6) return null;
    const out = {}, nn = {}; for (const r of rs) for (const s0 of r.shots || []) if (s0.cat === c && s0.dist) { const b = s0.dist; out[b] = (out[b] || 0) + s0.sg; nn[b] = (nn[b] || 0) + (s0.w || 1); } /* (update 809: the data's own ranges) */
    for (const b in out) out[b] /= perRd ? rs.length : nn[b]; return Object.keys(out).length ? out : null; } // (update 803: strokes gained a shot)
  function leakDetail(k, c, SY) {
    const rs = (gearData.get(k) || detail?.by.get(k) || []).filter((r) => yrOf(r) === String(SY) && (ownP?.key === k || onTour(r)) && !r.eventLevel); if (rs.length < 6) return "";
    const g = new Map(); for (const r of rs) for (const s0 of r.shots || []) if (s0.cat === c && s0.dist) { const o = g.get(s0.dist) || g.set(s0.dist, [0, 0]).get(s0.dist); o[0] += s0.sg; o[1] += s0.w || 1; }
    const xs = [...g].filter(([, o]) => o[1] >= 8).map(([d, o]) => ({ d, rd: o[0] / rs.length, sh: o[0] / o[1], n: o[1] })).sort((a, b) => a.rd - b.rd); if (!xs.length) return "";
    const bad = xs.filter((x) => x.rd <= -0.05).slice(0, 2), good = [...xs].reverse().find((x) => x.rd >= 0.05);
    const what = { APP: "approach shots", ARG: "chips and pitches", PUTT: "putts", OTT: "tee shots" }[c] || "shots";
    const fix = bad[0] ? { APP: `${bad[0].d} approaches at a pin, measuring how far each finishes from the hole`, ARG: `chips and pitches from ${bad[0].d} to a hole, counting the up-and-downs`, PUTT: `putts from ${bad[0].d}, counting the makes`, OTT: `drives at a fairway-width target, counting the hits` }[c] : "";
    return [bad[0] ? `Biggest leak: ${what} from ${bad[0].d}, ${sg2(bad[0].rd)} per round (${sg2(bad[0].sh)} a shot, ${Math.round(bad[0].n)} shots)` : "", bad[1] ? `Also ${bad[1].d}: ${sg2(bad[1].rd)} per round` : "",
      good ? `Holding up: ${good.d}, ${sg2(good.rd)} per round` : ""].filter(Boolean) /* (update 805: no fix line) */.join(" · ");
  }
  // (update 852) every player's form change on the tour (last 12 against the 12 before), for the form stories' place on tour
  let ftMemo = null;
  const formTour = () => { const F = seasonField(), kk = `${F.SY}|${tourPick}|${F.ok.length}`; if (ftMemo?.k === kk) return ftMemo.v;
    const v = F.ok.map((p) => { const fs = formSplit(p.rs); return fs ? [p.k, perRound(fs.last) - perRound(fs.prev)] : null; }).filter(Boolean).sort((a, b) => b[1] - a[1]); ftMemo = { k: kk, v }; return v; };
  function highlightsFor(k) {
    const raw = rawOf(playerOf(k)), out = [], SY = seasonYr(), rs = sgRounds(raw).filter((r) => yrOf(r) === SY); if (!rs.length) return out; /* (update 738: this season only) */ // (update 728: Compare's rounds and order)
    const last = SY, season = rs, evs = eventsOf(season), sAvg = avgOf(season, tot);
    const ago = (d) => (Date.now() - (Date.parse(String(d).slice(0, 10)) || 0)) / 864e5, recent = (d) => ago(d) <= 21;
    // the last tournament: against the season
    const le = evs.at(-1);
    if (le && evs.length >= 3 && recent(le.end)) { const better = [...evs].sort((a, b) => b.avg - a.avg), pos = better.indexOf(le) + 1, d = le.avg - sAvg;
      const best = pos === 1, worst = pos === evs.length;
      if (best || worst || Math.abs(d) >= 0.6) out.push({ id: `ev-${k}`, k, x: { ev: le.event, v: le.avg, d, best, worst, n: le.rs.length, yr: last }, kind: best ? "Milestone" : worst ? "Slide" : "Result", score: (best || worst ? 8 : 6) + Math.abs(d),
        title: `${le.event}: ${sg2(le.avg)} per round${best ? `, ${isMe(k) ? "your" : "the"} best tournament of ${last}` : worst ? `, the toughest of ${last}` : ""}`,
        detail: `${Math.abs(d).toFixed(2)} ${d >= 0 ? "better" : "worse"} than ${his(k)} ${last} average (${sg2(sAvg)}) · ${le.rs.length} rounds`,
        to: "Stats · Tournaments", run: () => toStats(k, { view2: "full", year: [last], span: 0 }, "Tournaments", null) });
      // the best round of the season, just played
      const bestR = [...season].sort((a, b) => tot(b) - tot(a))[0];
      if (bestR && le.rs.includes(bestR) && season.length >= 8) out.push({ id: `br-${k}`, k, x: { v: tot(bestR), ev: le.event, yr: last, tourBest: tot(bestR) >= tourBestOf(last) - 1e-9 }, kind: "Milestone", score: 8.5, title: `${His(k)} best round of ${last}: ${sg2(tot(bestR))}`, detail: `Round ${bestR.roundNo || ""} at ${le.event}`.replace("Round  ", "A round "), to: "Stats · SG Trends", run: () => toStats(k, { view2: "full", year: [last], span: 0, openRounds: true }, null, null) }); }
    // gaining strokes round after round
    // (update 796) the DP World Tour's numbers are whole events (not single rounds): its streak counted in events
    const stEv = tourPick && tourPick !== ALL ? isDP(tourPick) : rs.some((r) => isDP(r.tour)), stU = stEv ? eventsOf(rs).map((e) => e.rs) : rs.map((r) => [r]), stW = stEv ? "event" : "round";
    let streak = 0; for (let i = stU.length - 1; i >= 0 && avgOf(stU[i], tot) > 0; i--) streak++;
    const stRs = stU.slice(-streak).flat(), stFrom = stRs[0]?.event;
    if (streak >= (stEv ? 3 : 5)) out.push({ id: `st-${k}`, k, x: { n: streak, unit: stW, ev: stFrom, avg: avgOf(stRs, tot) }, kind: "Milestone", score: 6 + streak * (stEv ? 0.6 : 0.2), title: `${streak} ${stW}s in a row gaining strokes`, detail: `${isMe(k) ? "You’ve" : `${firstOf(k)} has`} beaten the tour average ${stEv ? "at every event" : "every round"} since ${stFrom}`, to: "Stats · Elite stretches", run: () => toStats(k, { view2: "full", year: [], span: 0 }, "Elite Stretches", EX.elite(`When ${isMe(k) ? "do I" : `does ${firstOf(k)}`} play best?`)) });
    // (update 797) milestones beyond the last event: the season's best week (a few weeks back), a streak closing in on the
    // season's best run, and a season rank closing in on the top 1, 10 or 25
    { const bestE = [...evs].sort((a, b) => b.avg - a.avg)[0], days = bestE ? Math.round(ago(bestE.end)) : 999;
      if (bestE && bestE !== le && days <= 70 && evs.length >= 5) { const wk = Math.max(1, Math.round(days / 7));
        out.push({ id: `mb-${k}`, k, x: { ev: bestE.event, v: bestE.avg }, kind: "Milestone", score: 5.4, title: `${wk === 1 ? "Last week" : `${wk} weeks ago`}: ${isMe(k) ? "your" : poss(firstOf(k))} best week of ${last}, at ${bestE.event}`,
          detail: `${sg2(bestE.avg)} strokes gained total per round there · ${(bestE.avg - sAvg).toFixed(2)} better than ${his(k)} ${last} average (${sg2(sAvg)}) · still the best of ${evs.length} tournaments this season`, to: "Stats · Best & worst tournaments", run: () => toStats(k, { view2: "full", year: [last], span: 0, cats: [] }, "Best & worst tournaments", null) }); }
      // the season's runs in the black (rounds; the DP World Tour: events): the current one closing in on the best
      const runs = []; let cur0 = 0; for (const u of stU) { if (avgOf(u, tot) > 0) cur0++; else { if (cur0) runs.push(cur0); cur0 = 0; } }
      const bestRun = Math.max(0, ...runs);
      if (cur0 >= 2 && bestRun > cur0 && bestRun - cur0 <= 2) out.push({ id: `ap-run-${k}`, k, x: { n: cur0, m: bestRun }, kind: "Milestone", score: 5.2, title: `${isMe(k) ? "You're" : `${firstOf(k)} is`} ${bestRun - cur0} ${stW}${bestRun - cur0 === 1 ? "" : "s"} from matching ${his(k)} best run of ${last}`,
        detail: `${cur0} ${stW}s in a row gaining strokes now · the season's best: ${bestRun} in a row`, to: "Stats · SG Trends", run: () => toStats(k, { view2: "full", year: [last], span: 0, cats: [], trendBy: stEv ? "event" : "round" }, "SG Trends", null) });
      // a season rank closing in on the lead, the top 10 or the top 25 (strokes gained total)
      try { const F = seasonField(), vs = F.ok.map((p) => [p.k, avgOf(p.rs, tot)]).sort((a, b) => b[1] - a[1]), i = vs.findIndex((x0) => x0[0] === k);
        // (update 849) a tie (the same to 2 decimals) is the same place: tied for 10th is in the top 10, not "0.00 from" it
        const r2 = (v) => Math.round(v * 100) / 100, myV = i >= 0 ? r2(vs[i][1]) : null, rk = i >= 0 ? 1 + vs.filter((x0) => r2(x0[1]) > myV).length : 0;
        if (i > 0 && vs.length >= 30) for (const T of [1, 10, 25]) { if (rk <= T) continue; const gap = r2(vs[T - 1][1]) - myV; if (gap > 0 && gap <= 0.12 && rk - T <= 6) {
          out.push({ id: `ap-rank-${k}`, k, x: { r: rk, T, gap }, kind: "Milestone", score: 5.3, title: `${isMe(k) ? "You're" : `${firstOf(k)} is`} ${gap.toFixed(2)} per round from ${T === 1 ? "the lead on tour" : `the tour's top ${T}`}`,
            detail: `${ordN(rk).replace("No. ", "")} in strokes gained total in ${last} (${sg2(vs[i][1])} per round) · ${T === 1 ? `the leader, ${nameOf(vs[0][0])}` : `${ordN(T).replace("No. ", "")}, ${nameOf(vs[T - 1][0])}`}: ${sg2(vs[T - 1][1])} · of ${vs.length} players`, board: { c: "TOTAL", focus: k }, to: "Leaderboards · Rankings", run: () => toBoard({ year: [last], cats: [] }, "Rankings", null) }); break; } } } catch { /* */ } }
    // form: the last 12 rounds against the 12 before, and each part of the game
    const fs = formSplit(rs); if (fs) { const a = fs.last, b = fs.prev, d = perRound(a) - perRound(b), FL = fs.lbl; /* (update 734: Form, as everywhere: 12 rounds; the DP World Tour 3 events) */ // (update 728: as Compare's Last 12 rounds and The 12 rounds before that)
      const FT = formTour(), fRk = FT.length >= 10 ? 1 + FT.filter((x0) => x0[1] > d + 1e-9).length : null, fMed = FT.length ? FT.map((x0) => x0[1]).sort((a0, b0) => a0 - b0)[Math.floor(FT.length / 2)] : null; // (update 852)
      { const fmS = { id: `fm-${k}`, k, x: { fRk, fN: FT.length, fMed, d, a: perRound(a), b: perRound(b), FL, n: fs.n, lastR: a, prevR: b, ra: cats.map((c0) => perRound(a, c0)), rb: cats.map((c0) => perRound(b, c0)) }, kind: d > 0 ? "Trend" : "Slide", score: 5 + Math.abs(d) * 2, title: `${His(k)} form is ${d > 0 ? "heating up" : "cooling off"}: ${sg2(d)} per round`, detail: `Last ${FL} ${sg2(perRound(a))} against ${sg2(perRound(b))} in the ${fs.n} before`, to: `Compare · Last ${FL} vs ${FL.split(" ")[0]} before`, /* (update 805: 3 events on the DP World Tour) */ run: () => go(`${cmpBase(k)}&pick=win:12`, EX.cmpWin("What changed over the last 12 rounds?")) }; formAll.set(k, fmS); if (Math.abs(d) >= 0.3) out.push(fmS); } // (update 837: every player's form, for the biggest movers)
      const ch = cats.map((c) => [c, perRound(a, c) - perRound(b, c)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      // (update 728) opens Compare (its Verdict shows each part of the game's difference, the same numbers)
      for (const [c, dc] of ch.slice(0, 2)) if (Math.abs(dc) >= 0.2) out.push({ id: `cm-${k}-${c}`, k, x: { c, d: dc, a: perRound(a, c), b: perRound(b, c), FL, n: fs.n, lastR: a, prevR: b }, kind: dc > 0 ? "Trend" : "Slide", score: 4.5 + Math.abs(dc) * 2, title: `${CATN[c]} ${dc > 0 ? "up" : "down"} ${Math.abs(dc).toFixed(2)} per round lately`, detail: `${His(k)} last ${FL} (${sg2(perRound(a, c))}) against the ${fs.n} before (${sg2(perRound(b, c))})`, to: `Compare · Last ${FL} vs ${FL.split(" ")[0]} before`, /* (update 805: 3 events on the DP World Tour) */ run: () => go(`${cmpBase(k)}&pick=win:12`, EX.cmpWin(`${CATN[c]}: what changed?`)) }); }
    // the part of the game costing the most this season
    const weak = cats.map((c) => [c, avgOf(season, (r) => inCat(r, c))]).filter(([, v]) => v != null).sort((x, y) => x[1] - y[1])[0];
    if (weak && season.length >= 6) out.push({ id: `wk-${k}`, /* (update 802: every player, even one gaining everywhere: their weakest part) */ k, x: { c: weak[0], v: weak[1], yr: last, all: cats.map((c0) => [c0, avgOf(season, (r) => inCat(r, c0))]) }, kind: "Focus", score: weak[1] < 0 ? 4 + Math.abs(weak[1]) * 2 : 3.6, title: weak[1] < 0 ? `${CATN[weak[0]]} is costing ${he(k)} ${Math.abs(weak[1]).toFixed(2)} per round` : `${CATN[weak[0]]} is ${his(k)} weakest part of the game`, detail: leakDetail(k, weak[0], last) /* (update 800: where in it, and the fix) */, to: `Stats · Player Stats · ${CATN[weak[0]]}`, run: () => toStats(k, { view2: "full", focusCats: [weak[0]], focusPick: weak[0], year: [last], span: 0 }, "Where you stand", EX.cat(`Where is ${CATN[weak[0]].toLowerCase()} costing strokes?`, weak[0])) });
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
    const out = []; formAll.clear(); // (update 845: a player's form on the tour picked only)
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
        if (top.length) out.push({ board: { rows: mvRows, title: `Change in strokes gained per round, the last ${FL0} against the ${FL0.split(" ")[0]} before` }, id: "movers", k: null, x: { top }, kind: "Tour", score: 5, title: `Heating up: ${lst(top)}`, detail: `Strokes gained total per round, the last ${FL0} against the ${FL0.split(" ")[0]} before (${where}), as Hot & Cold on Stats`, to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) });
        if (bot.length) out.push({ board: { rows: [...mvRows].reverse(), title: "The biggest drops first" }, id: "fallers", k: null, x: { top: bot }, kind: "Tour", score: 4, title: `Cooling off: ${lst(bot)}`, detail: `Strokes gained total per round, the last ${FL0} against the ${FL0.split(" ")[0]} before (${where}), as Hot & Cold on Stats`, to: "Leaderboards", run: () => go(admin ? "#/admin/analyze" : "#/leaderboards", EX.lead("Who’s playing best?")) }); }
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
    // (update 771) each in a sub-section: the last event, the last 3 months, or the year to date
    const add = (id, score, title, detail, grp) => out.push({ id: `tb-${id}`, k: null, kind: "Tour", score, title, detail, to: "Leaderboards", run: toLead(title), grp: grp || (/^(week|ev-)/.test(id) ? "last" : "ytd") });
    // the round of the year
    let best = null; for (const p of sp) for (const r of rl(p.rs)) { const v = tot(r); if (!best || v > best.v) best = { k: p.k, v, r }; }
    if (best) add("roy", 3.9, `Round of the year: ${nameOf(best.k)}, ${sg2(best.v)}`, `${best.r.event}${best.r.roundNo ? `, round ${best.r.roundNo}` : ""} · the best single round in ${W0}`);
    // the leaders in each part of the game
    if (ok.length >= 10) { const lead = cats.map((c) => { const v = ok.map((p) => [p.k, avgOf(p.rs, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0]; return `${CATN[c]}: ${nameOf(v[0])} ${sg2(v[1])}`; });
      add("kings", 3.8, `Best in each part of the game`, `${lead.join(" · ")} (strokes gained per round, ${W0}, ${minR}+ rounds)`); }
    // the longest run of rounds gaining strokes, still going
    const dpT = tourPick && tourPick !== ALL ? isDP(tourPick) : false, stUnit = dpT ? "event" : "round"; // (update 796: the DP World Tour in events)
    const st = sp.map((p) => { const us = dpT ? eventsOf(p.rs).map((e) => e.rs) : rl(p.rs).map((r) => [r]); let n = 0; for (let i = us.length - 1; i >= 0 && avgOf(us[i], tot) > 0; i--) n++; return [p.k, n]; }).sort((a, b) => b[1] - a[1])[0];
    if (st && st[1] >= (dpT ? 3 : 4)) add("streak", 3.7, `Hottest streak: ${nameOf(st[0])}, ${st[1]} ${stUnit}s in a row gaining strokes`, `Strokes gained total above zero ${dpT ? "at every event" : "every round"}, still going (${W0})`);
    // the steadiest, and the wildest (how much a player's rounds swing)
    const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
    const sw = ok.map((p) => [p.k, sd(rl(p.rs).map(tot)), rl(p.rs).length]).filter((x) => x[2] >= minR).sort((a, b) => a[1] - b[1]);
    if (sw.length >= 10) { add("steady", 3.4, `Mr. Consistent: ${nameOf(sw[0][0])}`, `The smallest round-to-round swing (±${sw[0][1].toFixed(2)} strokes gained) of anyone with ${minR}+ rounds in ${W0}`);
      const wl = sw.at(-1); add("wild", 3.3, `Rollercoaster: ${nameOf(wl[0])}`, `The biggest round-to-round swing (±${wl[1].toFixed(2)} strokes gained) of anyone with ${minR}+ rounds in ${W0}`); }
    // the latest tournament's standout
    let lastEv = null; for (const p of sp) for (const r of p.rs) if (!lastEv || String(r.date) > lastEv.d) lastEv = { d: String(r.date), e: r.event };
    if (lastEv) { const at = sp.map((p) => { const rs = p.rs.filter((r) => r.event === lastEv.e); return rs.length >= 2 ? [p.k, perRound(rs), rs.length] : null; }).filter(Boolean).sort((a, b) => b[1] - a[1]);
      if (at.length >= 5) add("week", 3.6, `Best of the week at ${lastEv.e}: ${nameOf(at[0][0])}, ${sg2(at[0][1])} per round`, `Strokes gained total per round over ${at[0][2]} rounds · next best: ${at.slice(1, 3).map(([k2, v]) => `${nameOf(k2)} ${sg2(v)}`).join(", ")}`); }
    // (update 737) more from the latest tournament: its best round, the best in each part of the game, and who played
    // furthest above their own season
    if (lastEv) { const E = lastEv.e, atE = sp.map((p) => ({ k: p.k, rs: p.rs.filter((r) => r.event === E), all: p.rs })).filter((x) => x.rs.length);
      let br = null; for (const x of atE) for (const r of rl(x.rs)) { const v = tot(r); if (!br || v > br.v) br = { k: x.k, v, r }; }
      if (br) add("ev-round", 3.65, `At ${E}: round of the week, ${nameOf(br.k)} ${sg2(br.v)}`, `${br.r.roundNo ? `Round ${br.r.roundNo}` : "A round"} · strokes gained total`);
      const two = atE.filter((x) => x.rs.length >= 2);
      if (two.length >= 5) { const lead = cats.map((c) => { const v = two.map((x) => [x.k, avgOf(x.rs, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0]; return `${CATN[c]}: ${nameOf(v[0])} ${sg2(v[1])}`; });
        add("ev-kings", 3.62, `At ${E}: the best in each part of the game`, `${lead.join(" · ")} (strokes gained per round)`);
        const above = two.map((x) => { const sAvg = perRound(x.all.filter((r) => r.event !== E)), e = perRound(x.rs); return sAvg == null || e == null ? null : [x.k, e - sAvg, e, sAvg]; }).filter(Boolean).sort((a, b) => b[1] - a[1])[0];
        if (above && above[1] > 0.5) add("ev-above", 3.58, `At ${E}: ${nameOf(above[0])} played ${above[1].toFixed(2)} above their season`, `${sg2(above[2])} per round there, against ${sg2(above[3])} the rest of ${yr0}`); } }
    // the biggest bounce-back: from one round to the next at the same tournament
    let bb = null; for (const p of sp) { const rs = rl(p.rs); for (let i = 1; i < rs.length; i++) if (rs[i].event === rs[i - 1].event) { const d = tot(rs[i]) - tot(rs[i - 1]); if (!bb || d > bb.d) bb = { k: p.k, d, a: tot(rs[i - 1]), b: tot(rs[i]), e: rs[i].event }; } }
    if (bb && bb.d >= 3) add("bounce", 3.5, `Biggest bounce-back: ${nameOf(bb.k)}, ${sg2(bb.a)} to ${sg2(bb.b)}`, `From one round to the next at ${bb.e}, a ${bb.d.toFixed(2)}-stroke turnaround (${W0})`);
    // (update 740) rotating: a stat's leader (a different stat each day), the tightest race and the runaway leader
    if (ok.length >= 10) { const keyD = STAT_KEYS[Math.floor(hash(`stat|${DAY}`) * STAT_KEYS.length)], def = keyD && STAT_DEFS[keyD];
      if (def) { const vs = ok.map((p) => [p.k, obsAvg(p.rs, keyD)]).filter((x) => x[1] != null).sort((a, b) => (def.higher ? b[1] - a[1] : a[1] - b[1]));
        if (vs.length >= 10) out.push({ board: { key: keyD }, id: `tb-stat-${keyD}`, k: null, kind: "Tour", grp: "ytd", ever: true, score: 3.75, title: `${def.label} leader: ${nameOf(vs[0][0])}, ${fmtStat(def, vs[0][1])}`, detail: `Then ${vs.slice(1, 3).map(([k2, v]) => `${nameOf(k2)} ${fmtStat(def, v)}`).join(", ")} (${W0}, ${minR}+ rounds)`, to: "Leaderboards", run: () => toBoard({ year: [yr0] }, null, EX.lead(`Who leads in ${def.label}?`)) }); }
      const races = ["TOTAL", ...cats].map((c) => { const vs = ok.map((p) => [p.k, avgOf(p.rs, c === "TOTAL" ? tot : (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1]); return { c, a: vs[0], b: vs[1], gap: vs[0][1] - vs[1][1] }; }).sort((a, b) => a.gap - b.gap);
      const nmC = (c) => (c === "TOTAL" ? "strokes gained" : CATN[c].toLowerCase()), tight = races[0], run = races.at(-1);
      out.push({ board: { c: tight.c }, id: `tb-tight-${tight.c}`, k: null, kind: "Tour", grp: "ytd", ever: true, score: 3.55, title: `Tightest race: ${nmC(tight.c)}`, detail: `${nameOf(tight.a[0])} ${sg2(tight.a[1])} per round leads ${nameOf(tight.b[0])} ${sg2(tight.b[1])} by ${tight.gap.toFixed(2)} (${W0})`, to: "Leaderboards · Rankings", run: () => toBoard({ year: [yr0], cats: tight.c === "TOTAL" ? [] : [tight.c] }, "Rankings", null) });
      out.push({ board: { c: run.c }, id: `tb-run-${run.c}`, k: null, kind: "Tour", grp: "ytd", ever: true, score: 3.5, title: `Runaway leader: ${nameOf(run.a[0])} in ${nmC(run.c)}`, detail: `${sg2(run.a[1])} per round, ${run.gap.toFixed(2)} clear of ${nameOf(run.b[0])} (${W0})`, to: "Leaderboards · Rankings", run: () => toBoard({ year: [yr0], cats: run.c === "TOTAL" ? [] : [run.c] }, "Rankings", null) }); }
    // (update 771) the last 3 months (to the latest round on record): who's in form, the risers and fallers against their
    // year before then, the best in each part of the game, and the round of that stretch
    { const latest = sp.reduce((m, p) => p.rs.reduce((m2, r) => (String(r.date) > m2 ? String(r.date) : m2), m), ""), t1 = Date.parse(latest.slice(0, 10));
      if (Number.isFinite(t1)) { const cut = new Date(t1 - 92 * 864e5).toISOString().slice(0, 10), yrAgo = new Date(t1 - 365 * 864e5).toISOString().slice(0, 10);
        const all3 = field.map((p) => { const rs = sgRounds(rawOf(p)); return { k: p.key, rs: rs.filter((r) => String(r.date) >= cut), pre: rs.filter((r) => String(r.date) < cut && String(r.date) >= yrAgo) }; }).filter((p) => p.rs.length);
        const most3 = Math.max(0, ...all3.map((p) => p.rs.length)), min3 = Math.max(4, Math.floor(most3 * 0.33)), ok3 = all3.filter((p) => p.rs.length >= min3), W3 = `the last 3 months${on}, ${min3}+ rounds`;
        if (ok3.length >= 10) { const hot = ok3.map((p) => [p.k, perRound(p.rs), p.rs.length]).sort((a, b) => b[1] - a[1]);
          add("3m-hot", 3.85, `In form: ${nameOf(hot[0][0])}, ${sg2(hot[0][1])} per round`, `The best strokes gained per round over ${W3} · then ${hot.slice(1, 3).map(([k2, v]) => `${nameOf(k2)} ${sg2(v)}`).join(", ")}`, "3m");
          const lead3 = cats.map((c) => { const v = ok3.map((p) => [p.k, avgOf(p.rs, (r) => inCat(r, c))]).sort((a, b) => b[1] - a[1])[0]; return `${CATN[c]}: ${nameOf(v[0])} ${sg2(v[1])}`; });
          add("3m-kings", 3.7, `The last 3 months: the best in each part of the game`, `${lead3.join(" · ")} (strokes gained per round, ${W3})`, "3m");
          const ch = ok3.filter((p) => p.pre.length >= min3).map((p) => [p.k, perRound(p.rs) - perRound(p.pre), perRound(p.rs), perRound(p.pre)]).sort((a, b) => b[1] - a[1]);
          if (ch.length >= 10 && ch[0][1] > 0.4) add("3m-rise", 3.8, `Biggest riser: ${nameOf(ch[0][0])}, up ${ch[0][1].toFixed(2)} per round`, `${sg2(ch[0][2])} per round over the last 3 months, against ${sg2(ch[0][3])} in the 9 months before`, "3m");
          if (ch.length >= 10 && ch.at(-1)[1] < -0.4) { const f0 = ch.at(-1); add("3m-fall", 3.6, `Biggest drop: ${nameOf(f0[0])}, down ${Math.abs(f0[1]).toFixed(2)} per round`, `${sg2(f0[2])} per round over the last 3 months, against ${sg2(f0[3])} in the 9 months before`, "3m"); } }
        let b3 = null; for (const p of all3) for (const r of rl(p.rs)) { const v = tot(r); if (!b3 || v > b3.v) b3 = { k: p.k, v, r }; }
        if (b3) add("3m-roy", 3.55, `Round of the last 3 months: ${nameOf(b3.k)}, ${sg2(b3.v)}`, `${b3.r.event}${b3.r.roundNo ? `, round ${b3.r.roundNo}` : ""} · strokes gained total`, "3m"); } }
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
      const q = { h, st, par: num(r[7]), pid, who, yr: String(r[0] ?? ""), rd: String(r[5] ?? ""), lie, x, y, v: num(r[15]), d: num(r[21]) ?? num(r[18]) }; /* (update 861) the file's true_distance (the real distance to the hole), as Strategy Maps use; its 'distance' isn't */
      if (lie === "green" && q.v != null) greens.push(q.v);
      const tk = `${h}|${who}|${q.yr}|${q.rd}`; let T = trails.get(tk); if (!T) { T = { h, pid, who, nm: r[3] != null ? String(r[3]) : "", yr: q.yr, rd: q.rd, par: q.par, qs: [], s: null }; trails.set(tk, T); } T.qs.push(q);
      if (num(r[12]) === 1) { const sf = num(r[11]); T.s = sf != null ? Math.round(sf) : q.par ? st - q.par : null; }
      if (st === 1 && x != null) { const a = teeXY.get(h) || teeXY.set(h, [0, 0, 0]).get(h); a[0] += x; a[1] += y; a[2]++; }
      const px = num(r[16]), py = num(r[17]); if (px != null && py != null) { const a = pinXY.get(`${h}|${pid}`) || pinXY.set(`${h}|${pid}`, [0, 0, 0]).get(`${h}|${pid}`); a[0] += px; a[1] += py; a[2]++; } }
    greens.sort((a, b) => a - b); const toGo = greens.length ? greens[Math.floor(greens.length / 2)] < 2.6 : true;
    const T = [...trails.values()].filter((t) => t.s != null); for (const t of T) t.qs.sort((a, b) => a.st - b.st);
    // each hole: birdie (or better) and bogey (or worse) rates; the attack / defend index (birdies per bogey)
    const byH = new Map(); for (const t of T) { const o = byH.get(t.h) || byH.set(t.h, { h: t.h, par: t.par, n: 0, bird: 0, bog: 0, dbl: 0, sum: 0 }).get(t.h); o.n++; o.sum += t.s; if (t.s <= -1) o.bird++; if (t.s >= 1) o.bog++; if (t.s >= 2) o.dbl++; } /* (update 868: doubles or worse too) */
    const holesR = [...byH.values()].filter((o) => o.n >= 40).map((o) => ({ ...o, b: o.bird / o.n, g: o.bog / o.n, d2: o.dbl / o.n, avg: o.sum / o.n, idx: (o.bird / o.n) / Math.max(0.01, o.bog / o.n) }));
    // the top 10 each year (of those who played every round), against the rest: by hole and by part of the game
    const tot = new Map(); for (const t of T) { const k = `${t.who}|${t.yr}`, o = tot.get(k) || tot.set(k, { who: t.who, yr: t.yr, s: 0, rds: new Set(), holes: 0 }).get(k); o.s += t.s; o.rds.add(t.rd); o.holes++; }
    const top = new Set(); const byYr = new Map(); for (const o of tot.values()) (byYr.get(o.yr) || byYr.set(o.yr, []).get(o.yr)).push(o);
    for (const list of byYr.values()) { const mx = Math.max(...list.map((o) => o.rds.size)); list.filter((o) => o.rds.size === mx && o.holes >= mx * 18 * 0.9).sort((a, b) => a.s - b.s).slice(0, 10).forEach((o) => top.add(`${o.who}|${o.yr}`)); }
    const isTop = (t) => top.has(`${t.who}|${t.yr}`);
    const hEdge = new Map(); for (const t of T) { const o = hEdge.get(t.h) || hEdge.set(t.h, [0, 0, 0, 0]).get(t.h); if (isTop(t)) { o[0] += t.s; o[1]++; } else { o[2] += t.s; o[3]++; } }
    const edges = [...hEdge].filter(([, o]) => o[1] >= 10 && o[3] >= 30).map(([h, o]) => ({ h, d: o[0] / o[1] - o[2] / o[3] })).sort((a, b) => a.d - b.d);
    const E = expectModel(T), sgMemo = new Map(), sgOfT = (t) => sgMemo.get(t) || sgMemo.set(t, shotSG(t, E)).get(t); void toGo; // (update 761: not the file's scoring_avg, which can be the player's own strokes left)
    const catOfQ = (q) => (q.lie === "green" ? "PUTT" : q.st === 1 && (q.par || 4) >= 4 ? "OTT" : q.d != null && q.d < 50 ? "ARG" : "APP"); /* (update 861: within 50 yds is around the green, as the stats data's 30-50 yds) */
    // (update 799) a shot's distance range in its part of the game (the course's yards; feet on the green)
    const bandOf = (q, par) => { const c0 = catOfQ(q), d = q.d; if (c0 === "OTT") return `OTT|Par ${par || 4} tee shots`; if (d == null) return null;
      if (c0 === "APP") return `APP|${d < 75 ? "30-75" : d < 125 ? "75-125" : d < 175 ? "125-175" : d < 225 ? "175-225" : "225+"} yds`;
      if (c0 === "ARG") return `ARG|${d < 10 ? "0-10" : d < 20 ? "10-20" : "20-30"} yds`; return `PUTT|${d < 5 ? "0-5" : d < 10 ? "5-10" : d < 20 ? "10-20" : d < 40 ? "20-40" : "40+"} ft`; };
    const cs = { top: { OTT: 0, APP: 0, ARG: 0, PUTT: 0, band: {}, bandN: {}, n: {}, rds: new Set() }, rest: { OTT: 0, APP: 0, ARG: 0, PUTT: 0, band: {}, bandN: {}, n: {}, rds: new Set() } };
    const keyOf = (w) => clientKey(String(Number(w) || w));
    const shotsC = [], rdAll = new Set(); // (update 809: [cat, distance, sg, top 10?, player key], banded later in the data's own ranges)
    for (const t of T) { const G = isTop(t) ? cs.top : cs.rest; rdAll.add(`${t.who}|${t.yr}|${t.rd}`); G.rds.add(`${t.who}|${t.yr}|${t.rd}`);
      const sg0 = sgOfT(t); for (let i = 0; i < t.qs.length; i++) if (sg0[i] != null) { const c1 = catOfQ(t.qs[i]); if (c1 !== "OTT" && t.qs[i].d != null) shotsC.push([c1, t.qs[i].d, sg0[i], isTop(t) ? 1 : 0, keyOf(t.who)]); G[c1] += sg0[i]; G.n[c1] = (G.n[c1] || 0) + 1; const bk = bandOf(t.qs[i], t.par); if (bk) { G.band[bk] = (G.band[bk] || 0) + sg0[i]; G.bandN[bk] = (G.bandN[bk] || 0) + 1; } } }
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
    const ply = new Map(); // (keyOf: above)
    for (const t of T) { const pk = keyOf(t.who), P = ply.get(pk) || ply.set(pk, { nm: t.nm, cat: { OTT: 0, APP: 0, ARG: 0, PUTT: 0 }, rds: new Set(), holes: new Map(), notes: [] }).get(pk);
      P.rds.add(`${t.yr}|${t.rd}`); const hh = P.holes.get(t.h) || P.holes.set(t.h, [0, 0, t.par, 0, 0]).get(t.h); hh[0] += t.s; hh[1]++; if (t.s <= -1) hh[3]++; if (t.s >= 1) hh[4]++; /* (update 859: birdies and bogeys too) */
      const sg1 = sgOfT(t); for (let i = 0; i < t.qs.length; i++) if (sg1[i] != null) { const c1 = catOfQ(t.qs[i]); P.cat[c1] += sg1[i]; (P.n ||= {})[c1] = (P.n[c1] || 0) + 1; const bk = bandOf(t.qs[i], t.par); if (bk) { (P.band ||= {})[bk] = (P.band[bk] || 0) + sg1[i]; (P.bandN ||= {})[bk] = (P.bandN[bk] || 0) + 1; } }
      if ((t.par || 4) >= 5 && t.s <= -1) { const q2 = t.qs.find((q) => q.st === 2), q3 = t.qs.find((q) => q.st === 3), gs = goShare.get(t.h);
        if (q2 && q3 && q2.d != null && q2.d <= 300 && gs != null) { const g = goOf(arr7(q2), arr7(q3), t.par, null);
          if (g && g !== "go" && gs >= 0.6) P.notes.push({ h: t.h, yr: t.yr, rd: t.rd, s: t.s, kind: "lay", share: gs, d: q2.d });
          else if (g === "go" && gs <= 0.4) P.notes.push({ h: t.h, yr: t.yr, rd: t.rd, s: t.s, kind: "go", share: gs, d: q2.d }); } } }
    const per = (G) => Object.fromEntries(cats.map((c0) => [c0, G[c0] / Math.max(1, G.rds.size)]));
    const perBR = (G) => Object.fromEntries(Object.entries(G.band).filter(([kk]) => (G.bandN[kk] || 0) >= 10).map(([kk, v]) => [kk, v / Math.max(1, G.rds.size)])); // (update 849: per round)
    const perB = (G) => Object.fromEntries(Object.entries(G.band).filter(([kk]) => (G.bandN[kk] || 0) >= 10).map(([kk, v]) => [kk, v / G.bandN[kk]])); // (update 803: strokes gained a shot)
    const perS = (G) => Object.fromEntries(cats.map((c0) => [c0, G[c0] / Math.max(1, G.n[c0] || 0)]));
    const plyName = new Map(); for (const [pk0, P0] of ply) { P0.pk = pk0; if (P0.nm) plyName.set(nmKey(P0.nm), P0); } // (update 780: a player found by name when the ids don't match)
    upRaw = { id: c.id, plyName, shotsC, nRds: rdAll.size, nTop: cs.top.rds?.size || 0, nRest: cs.rest.rds?.size || 0, /* (update 867: rounds, for per round by distance) */ holesR, edges, catEdge, catTop: per(cs.top), catRest: per(cs.rest), bandTop: perB(cs.top), bandRest: perB(cs.rest), bandTopR: perBR(cs.top), bandRestR: perBR(cs.rest), att: (() => { const rds = new Set(), m = {}; for (const t of T) { rds.add(`${t.who}|${t.yr}|${t.rd}`); for (const q of t.qs) { const bk = bandOf(q, t.par); if (bk && !bk.startsWith("OTT")) m[bk] = (m[bk] || 0) + 1; } } for (const b in m) m[b] /= Math.max(1, rds.size); return m; })(), /* (update 804: attempts per round in each range) */ shotTop: perS(cs.top), shotRest: perS(cs.rest), yrs: [...new Set(T.map((t) => t.yr))].sort(), ply, fAvg, appD, misses, goLay, pinName: (h, pid) => CH.pinLabel(c, h, pid) }; drawFeed(collect());
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
      if (Sd.length && !c.rawChunks) { const x = Sd[0]; out.push({ id: "up-side", hole: x.h, cid: c.id, k: null, kind: "Course", score: 4.72, title: `The costliest miss: ${x.worst.nm} of No. ${x.h}`, detail: `Miss ${x.best.nm} instead (${x.best.v.toFixed(2)} strokes to finish the hole, against ${x.worst.v.toFixed(2)}; lower is better): ${x.spread.toFixed(2)} strokes fewer${Sd[1] ? ` · also No. ${Sd[1].h}: ${Sd[1].best.nm}, never ${Sd[1].worst.nm} (${Sd[1].spread.toFixed(2)})` : ""} · within 30 yds of the pin`,
        to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, x.h, EX.hole(`Where should I miss on hole ${x.h}?`)) }); } }
    // (update 849) Talking points: what to say if someone asks about the course this week (no player in them; per round)
    if (c && upRaw?.id === c.id) { const R0 = upRaw, CW = { OTT: "driving", APP: "approach play", ARG: "the short game", PUTT: "putting" }, p2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
      const ce = R0.catEdge || [], top = ce[0], low = ce.at(-1);
      const bands = Object.keys(R0.bandTopR || {}).filter((b0) => R0.bandRestR?.[b0] != null).map((b0) => ({ b: b0, d: R0.bandTopR[b0] - R0.bandRestR[b0] })).sort((a, b) => b.d - a.d), kb = bands[0];
      const bl = (b0) => { const [c0, rest0] = String(b0).split("|"); return c0 === "OTT" ? `driving on ${rest0.replace(/ tee shots$/, "s").toLowerCase()}` : `${CW[c0]} from ${rest0}`; };
      const H = R0.holesR || [], toParR = H.reduce((t, o) => t + (o.avg || 0), 0), parT = H.reduce((t, o) => t + (o.par || 0), 0), birdR = H.reduce((t, o) => t + o.b, 0), bogR = H.reduce((t, o) => t + o.g, 0);
      /* (update 859) a hole's avg is already its score to par (the data's own to-par column): no par to take off again */ const tough = [...H].sort((a, b) => b.avg - a.avg)[0], easy = [...H].sort((a, b) => a.avg - b.avg)[0], pm1 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
      // (update 859) one player shown (and update 866: their own numbers in the talking points' chart when they've played here)
      const one = shownKeys().length === 1 ? shownKeys()[0] : null, P1 = one ? R0.ply?.get(one) || R0.plyName?.get(nmKey(nameOf(one))) : null;
      const P1ok = !!(P1 && P1.rds.size >= 2), whoA = P1ok ? (isMe(one) ? "You" : `${firstOf(one)}, ${P1.rds.size} rounds here`) : "Rest of the field";
      const chartA = P1ok ? Object.fromEntries(cats.map((c0) => [`CAT|${CATN[c0]}`, (P1.cat[c0] || 0) / P1.rds.size])) : Object.fromEntries(cats.map((c0) => [`CAT|${CATN[c0]}`, R0.catRest?.[c0] ?? 0]));
      if (top) out.push({ id: "up-talk", k: null, kind: "Course", score: 5.4, title: `${U.name} is ${/^[aeiou]/i.test(CW[top[0]].replace(/^the /, "")) ? "an" : "a"} ${CW[top[0]].replace(/^the /, "")} week` /* (update 860: "an approach play week") */,
        detail: [`The top 10 here gain ${p2(top[1])} per round more than the rest of the field in ${CATN[top[0]].toLowerCase()}, the most of any part of the game`,
          kb ? `The skill that decides it: ${bl(kb.b)}, worth ${p2(kb.d)} per round between the top 10 and the rest` : null,
          low ? `It matters least in ${CATN[low[0]].toLowerCase()} (${p2(low[1])} per round)` : null,
          P1ok ? `${isMe(one) ? "You" : firstOf(one)} here (${P1.rds.size} rounds): ${p2((P1.cat[top[0]] || 0) / P1.rds.size)} per round in ${CATN[top[0]].toLowerCase()}, against the top 10's ${p2(R0.catTop?.[top[0]] ?? 0)}` : null].filter(Boolean).join(" · "),
        x: { skill: { cat: top[0], perRound: true, who: whoA, where: `at ${U.name}`, bands: cats.map((c0) => `CAT|${CATN[c0]}`), a: chartA, top: Object.fromEntries(cats.map((c0) => [`CAT|${CATN[c0]}`, R0.catTop?.[c0] ?? 0])) } },
        to: "Course Prep · Course Insights", run: () => toHole(c.id, 1, EX.course(`What wins at ${U.name}?`)) });
      // (update 859) one player shown: how the course plays for them (their own shots here), beside the field
      const myH = P1 ? [...P1.holes].map(([h, o]) => ({ h, par: o[2], n: o[1], avg: o[0] / o[1], b: (o[3] || 0) / o[1], g: (o[4] || 0) / o[1], f: H.find((x) => x.h === h) })).filter((x) => x.f) : [];
      if (one && P1 && P1.rds.size >= 2 && myH.length >= 9) { const me1 = isMe(one), S1 = me1 ? "You" : nameOf(one), Pw1 = me1 ? "your" : "their";
        const myTP = myH.reduce((t, x) => t + x.avg, 0), fTP = myH.reduce((t, x) => t + x.f.avg, 0), myB = myH.reduce((t, x) => t + x.b, 0), myG = myH.reduce((t, x) => t + x.g, 0), fB = myH.reduce((t, x) => t + x.f.b, 0), fG = myH.reduce((t, x) => t + x.f.g, 0);
        const ok = myH.filter((x) => x.n >= 2), worst = [...ok].sort((a, b) => (b.avg - b.f.avg) - (a.avg - a.f.avg))[0], best = [...ok].sort((a, b) => (a.avg - a.f.avg) - (b.avg - b.f.avg))[0];
        out.push({ id: "up-mefun", k: null, kind: "Course", score: 5.35, title: `How ${c.name} plays for ${me1 ? "you" : nameOf(one)}`,
          detail: [`${S1} ${me1 ? "average" : "averages"} ${pm1(myTP)} to par per round over these ${myH.length} holes (${P1.rds.size} rounds on record here), against the field's ${pm1(fTP)}: ${myTP <= fTP ? `${(fTP - myTP).toFixed(2)} a round better` : `${(myTP - fTP).toFixed(2)} a round worse`}`,
            `${myB.toFixed(1)} birdies and ${myG.toFixed(1)} bogeys a round (the field: ${fB.toFixed(1)} and ${fG.toFixed(1)})`,
            worst ? `Toughest for ${me1 ? "you" : firstOf(one)}: No. ${worst.h} (par ${worst.par}), ${pm1(worst.avg)} to par on average against the field's ${pm1(worst.f.avg)} (${worst.n} plays)` : null,
            best && best !== worst ? `Best for ${me1 ? "you" : firstOf(one)}: No. ${best.h} (par ${best.par}), ${pm1(best.avg)} to par against the field's ${pm1(best.f.avg)} (${best.n} plays)` : null].filter(Boolean).join(" · "),
          to: "Course Prep · Strategy Maps", run: () => toHole(c.id, worst?.h || 1, EX.course(`How does ${c.name} play for ${Pw1 === "your" ? "me" : nameOf(one)}?`)) }); }
      else if (H.length >= 9) out.push({ id: "up-fun", k: null, kind: "Course", score: 5.35, title: `How ${c.name} plays${one ? ` (the field: no shots of ${isMe(one) ? "yours" : nameOf(one)} here on record)` : ""}`,
        detail: [`The field averages ${pm1(toParR)} to par per round over these ${H.length} holes (${(parT + toParR).toFixed(1)} strokes, par ${parT})`, `${birdR.toFixed(1)} birdies and ${bogR.toFixed(1)} bogeys a round`,
          tough ? `Toughest: No. ${tough.h} (par ${tough.par}), plays ${pm1(tough.avg)} to par on average (${(tough.par + tough.avg).toFixed(2)} strokes), ${Math.round(tough.g * 100)}% bogey or worse` : null,
          easy ? `Easiest: No. ${easy.h} (par ${easy.par}), plays ${pm1(easy.avg)} to par on average (${(easy.par + easy.avg).toFixed(2)} strokes), ${Math.round(easy.b * 100)}% birdie or better` : null].filter(Boolean).join(" · "),
        to: "Course Prep · Strategy Maps", run: () => toHole(c.id, tough?.h || 1, EX.course(`How does ${c.name} play?`)) }); }
    if (c && upRaw?.id === c.id) { const R0 = upRaw, pc = (v) => `${Math.round(v * 100)}%`, pm3 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
      const H = [...R0.holesR].sort((a, b) => b.idx - a.idx), atk = H[0], dfd = H.at(-1);
      if (H.length >= 9) { out.push({ id: "up-attack", hole: atk.h, cid: c.id, k: null, kind: "Course", score: 4.95, title: `Attack No. ${atk.h} (par ${atk.par}): ${pc(atk.b)} birdies against ${pc(atk.g)} bogeys`, detail: `The most birdies for every bogey on the course (${atk.idx.toFixed(1)} to 1)${H[1] ? `; then No. ${H[1].h} (${H[1].idx.toFixed(1)})` : ""} · ${atk.n} holes played there`, to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, atk.h, EX.hole(`How should I play hole ${atk.h}?`)) });
        out.push({ id: "up-defend", hole: dfd.h, cid: c.id, k: null, kind: "Course", score: 4.92, title: `Defend No. ${dfd.h} (par ${dfd.par}): ${pc(dfd.g)} bogeys against ${pc(dfd.b)} birdies`, detail: `The fewest birdies for every bogey (${dfd.idx.toFixed(2)} to 1)${H.at(-2) ? `; then No. ${H.at(-2).h} (${H.at(-2).idx.toFixed(2)})` : ""} · par is a good score here`, to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, dfd.h, EX.hole(`How should I play hole ${dfd.h}?`)) }); }
      if (R0.edges.length >= 3) { const e = R0.edges[0], ce = R0.catEdge[0];
        out.push({ id: "up-top10", hole: e.h, cid: c.id, k: null, kind: "Course", score: 4.85, title: `Where the top 10 win it: No. ${e.h}, where they score ${Math.abs(e.d).toFixed(2)} strokes a play lower than the rest of the field`, detail: `Their biggest scoring edge on a hole (average score; lower is better)${R0.edges[1] ? `, then No. ${R0.edges[1].h} (${Math.abs(R0.edges[1].d).toFixed(2)} lower)` : ""} · by part of the game, ${CATN[ce[0]].toLowerCase()}: ${pm3(ce[1])} strokes gained per round more than the rest`, to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, e.h, EX.hole(`How should I play hole ${e.h}?`)) }); }
      // approach distances: here against the shown players' own season (their usual week), in the same ranges their data
      // uses (update 745: the course's shots put in those ranges, so the two are counted alike)
      if (R0.appD.length >= 200) { const rngOf = (t0) => { const t = String(t0); let m = /(\d+)\s*-\s*(\d+)/.exec(t); if (m) return [Number(m[1]), Number(m[2])]; m = /^<\s*(\d+)/.exec(t); if (m) return [0, Number(m[1])]; m = /(\d+)\s*\+/.exec(t); if (m) return [Number(m[1]), 9999]; return null; };
        const usual = new Map(); let nU = 0;
        for (const k of shownKeys()) for (const r of (gearData.get(k) || []).filter((r0) => yrOf(r0) === seasonYr())) for (const s0 of r.shots) if (s0.cat === "APP" && s0.dist) { const g = rngOf(s0.dist); if (!g) continue; const o = usual.get(s0.dist) || usual.set(s0.dist, { lab: s0.dist, lo: g[0], hi: g[1], n: 0, here: 0 }).get(s0.dist); o.n++; nU++; }
        if (nU >= 200) { const B = [...usual.values()].sort((a, b) => a.lo - b.lo); let nH = 0; for (const d of R0.appD) { const o = B.find((x) => d >= x.lo && d < x.hi); if (o) { o.here++; nH++; } }
          const r1 = B.filter((x) => nH && x.here / nH >= 0.08 && x.n / nU >= 0.03).map((x) => ({ ...x, h: x.here / nH, u: x.n / nU, ratio: (x.here / nH) / (x.n / nU) })).sort((a, b) => b.ratio - a.ratio)[0];
          if (false && r1 && r1.ratio >= 1.2) out.push({ id: "up-mix", /* (update 837: attempts per round only, as "Expect more approaches from …") */ k: null, kind: "Course", score: 4.8, title: `Approaches from ${r1.lab.replace(/\s*yds?$/i, "")} yds come up ${r1.ratio.toFixed(1)}× as often here`, detail: `${pc(r1.h)} of approach shots at ${c.name} (${nH} shots on record), against ${pc(r1.u)} in a usual week (your players' ${nU} approaches this season) · practice that range`, to: "Practice", run: () => go("#/practice", EX.practice("Practice for this week")) }); } }
      // (update 804) attempt mix: the range that comes up most more often here than on tour (shots per round, the field here
      // against the season's field on the tour picked, both put in the course's ranges)
      // (update 858) every part of the game and every distance, not just the one range: the shots you'll face here a round
      // against a usual week on the tour picked (one player shown: their own usual mix, scaled by how much more or less
      // often each range comes up here)
      { const src = detail?.by ? [...detail.by.values()] : [...gearData.values()], SYm = seasonYr(); const tourAtt = {}; let nR = 0; /* (update 809: the data's own ranges) */
        const ACATS = ["OTT", "APP", "ARG", "PUTT"], key2 = (c0, b0) => `${c0}|${b0}`;
        for (const rs0 of src) for (const r of rs0 || []) { if (yrOf(r) !== SYm || r.eventLevel || !onTour(r)) continue; nR++; for (const s0 of r.shots || []) if (s0.dist && ACATS.includes(s0.cat)) { const kk = key2(s0.cat, s0.dist); tourAtt[kk] = (tourAtt[kk] || 0) + (s0.w || 1); } }
        if (nR >= 100) { for (const b in tourAtt) tourAtt[b] /= nR;
          // one player shown: their own season's mix of shots a round
          const one = shownKeys().length === 1 ? shownKeys()[0] : null, own = {}; let nOwn = 0;
          if (one) { const rs1 = (gearData.get(one) || detail?.by?.get(one) || []).filter((r) => yrOf(r) === SYm && !r.eventLevel && (ownP?.key === one || onTour(r)));
            if (rs1.length >= 8) { nOwn = rs1.length; for (const r of rs1) for (const s0 of r.shots || []) if (s0.dist && ACATS.includes(s0.cat)) { const kk = key2(s0.cat, s0.dist); own[kk] = (own[kk] || 0) + (s0.w || 1); } for (const b in own) own[b] /= nOwn; } }
          const ownG = {}; for (const kk in own) { const c0 = kk.slice(0, kk.indexOf("|")), g0 = (c0 === "ARG" ? "APP" : c0) + kk.slice(kk.indexOf("|")); ownG[g0] = (ownG[g0] || 0) + own[kk]; }
          const rows = [];
          // (update 860) approach and short game on one distance scale: the course calls a shot from 30-50 yds an approach,
          // the stats data may call it the short game, so each shot goes to the data's range for its distance, whichever part
          const GRP = (c0) => (c0 === "ARG" ? "APP" : c0), labsG = { APP: [...dataLabels("APP").map((l) => [...l, "APP"]), ...dataLabels("ARG").map((l) => [...l, "ARG"])].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]), PUTT: dataLabels("PUTT").map((l) => [...l, "PUTT"]) };
          const tourG = {}; for (const kk in tourAtt) { const [c0, b0] = [kk.slice(0, kk.indexOf("|")), kk.slice(kk.indexOf("|") + 1)]; const g0 = GRP(c0) + "|" + b0; tourG[g0] = (tourG[g0] || 0) + tourAtt[kk]; }
          const hereG = new Map(); for (const [c1, d] of R0.shotsC || []) { const g = GRP(c1), L = labsG[g]; if (!L) continue; const hit = L.find(([, rg]) => d >= rg[0] && d < rg[1]); if (hit) hereG.set(g + "|" + hit[0], (hereG.get(g + "|" + hit[0]) || 0) + 1); }
          const bandsAll = []; for (const g of ["APP", "PUTT"]) for (const [l, , c0] of labsG[g]) { const n = hereG.get(g + "|" + l) || 0; if (n >= 10 && !bandsAll.some((x) => x.g === g && x.l === l)) bandsAll.push({ g, c0, l, att: n / Math.max(1, R0.nRds) }); }
          for (const b0 of bandsAll) { const c0 = b0.c0, kk = key2(b0.g, b0.l), tour = tourG[kk]; if (tour == null || tour < 0.05) continue;
            const ratio = b0.att / tour, mineU = nOwn ? ownG[kk] || 0 : null, mineH = mineU != null ? mineU * ratio : null;
            rows.push({ cat: c0, b: b0.l, here: b0.att, tour, d: b0.att - tour, ratio, mineU, mineH, dm: mineU != null ? mineH - mineU : null }); }
          const DV = (x) => (nOwn ? x.dm : x.d), diffs = rows.filter((x) => x.cat === "APP").sort((a, b) => DV(b) - DV(a)), big = [...rows].sort((a, b) => DV(b) - DV(a));
          const WH = { OTT: "tee shots", APP: "approaches", ARG: "chips and pitches", PUTT: "putts" };
          const up = DV(diffs[0] || { d: 0, dm: 0 }) >= 0.3 ? diffs[0] : big[0], dn = big.at(-1), lb = (x) => String(x.b).replace(/^\w+\|/, "").replace(/ tee shots$/, "");
          const whoA = nOwn ? (isMe(one) ? "You" : nameOf(one)) : null, hv = (x) => (nOwn ? x.mineH : x.here), uv = (x) => (nOwn ? x.mineU : x.tour), vs = nOwn ? `in ${whoA === "You" ? "your" : "their"} usual week` : "on tour this season";
          const line = (x, rng = true) => `${hv(x).toFixed(1)} per round${rng ? ` from ${lb(x)}` : ""} here, against ${uv(x).toFixed(1)} ${vs}`;
          // (update 866) beside it: each hole's aggressiveness (birdies or better less bogeys or worse, % of plays): the field's, and
          // the player's own where they've played it (2+ plays)
          // (update 867: the field's only, and a card of its own)
          const HA = (R0.holesR || []).slice().sort((a, b) => a.h - b.h);
          if (HA.length >= 9) { const rowsA = HA.map((o) => ({ h: o.h, par: o.par, f: o.b - o.g, b: o.b, g: o.g, d2: o.d2 || 0 })), byA = [...rowsA].sort((a, b) => b.f - a.f), hi = byA[0], lo = byA.at(-1), pcA = (v) => `${v >= 0 ? "+" : "\u2212"}${Math.round(Math.abs(v) * 100)}`;
            // (update 868) the blow-up holes: the most doubles or worse (6% of plays or more), up to 3
            const blow = [...rowsA].filter((o) => o.d2 >= 0.06).sort((a, b) => b.d2 - a.d2).slice(0, 3); for (const o of blow) o.blow = true; const pc0 = (v) => `${Math.round(v * 100)}%`;
            out.push({ id: "up-agg", k: null, kind: "Course", score: 4.85, title: `Attack No. ${hi.h}, hold back on No. ${lo.h}`,
              x: { agg: { rows: rowsA } }, detail: [`No. ${hi.h} (par ${hi.par}): the field makes birdie or better ${pc0(hi.b)} of the time and bogey or worse ${pc0(hi.g)}, an aggressiveness index of ${pcA(hi.f)}`,
                `No. ${lo.h} (par ${lo.par}): ${pc0(lo.b)} birdie or better, ${pc0(lo.g)} bogey or worse (${pcA(lo.f)})`,
                blow.length ? `Blow-up holes to avoid: ${blow.map((o) => `No. ${o.h} (${pc0(o.d2)} double bogey or worse)`).join(", ")}` : "No blow-up holes: none has 6% or more doubles or worse",
                "Aggressiveness index: birdie or better % minus bogey or worse %, the field's, every hole below"].join(" · "),
              to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, hi.h, EX.hole(`How should I play hole ${hi.h}?`)) }); }
          if (up && DV(up) >= 0.3 && rows.length >= 4) out.push({ id: "up-att", k: null, kind: "Course", score: 4.86, x: { att: { rows, mine: nOwn ? (isMe(one) ? "You" : nameOf(one)) : null } },
            title: `Expect more ${WH[up.cat]} from ${lb(up)} at ${U.name}`,
            /* (update 860) the same numbers as the chart under it: the player's when one is shown, else the field's */
            detail: `${whoA ? `${whoA} can expect` : "The field hits"} ${line(up)}: ${DV(up).toFixed(1)} more per round${dn && DV(dn) <= -0.3 ? ` · fewer ${WH[dn.cat]} from ${lb(dn)}: ${line(dn, false)}` : ""} · every distance below`, to: "Practice", run: () => go("#/practice", EX.practice("Practice for this week")) }); } }
      // (update 747) the par 5 where going for it (or laying up) matters most
      if (R0.goLay?.length) { const g = R0.goLay[0], go = g.d > 0;
        out.push({ id: "up-golay", hole: g.h, cid: c.id, k: null, kind: "Course", score: 4.88, title: `No. ${g.h}: ${go ? "go for it in two" : "lay up"}, ${Math.abs(g.d).toFixed(2)} strokes a hole lower`, detail: `Average score to par (lower is better). Went for the green with the second shot: ${pm3(g.ga)} (${g.go.length} players) · laid up: ${pm3(g.la)} (${g.lay.length}) · from within 300 yds${R0.goLay[1] ? ` · also No. ${R0.goLay[1].h}: ${R0.goLay[1].d > 0 ? "go for it" : "lay up"} (${Math.abs(R0.goLay[1].d).toFixed(2)})` : ""}`,
          to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, g.h, EX.hole(`Should I go for hole ${g.h} in two?`)) }); }
      // each pin's costliest miss, described in full
      const M = R0.misses.filter((x) => x.spread >= 0.15);
      if (M.length) { const x = M[0], M2 = M.find((m) => m.worst.h !== x.worst.h) /* (update 780: the "also" from another hole, not the same miss again) */, w = x.worst, b = x.best, pn = R0.pinName(w.h, w.pid), shotN = w.k === 1 ? "the tee shot" : `the approach (shot ${w.k})`, lieW = (l) => (l === "rough" ? "in the rough" : l === "bunker" ? "in a bunker" : l === "fairway" ? "in the fairway" : `in the ${l}`);
        const shotW = w.k === 1 ? "off the tee" : "on the approach", pinT = pn ? `, ${/\bpin\b/i.test(pn) ? pn : `${pn} pin`}` : "";
        out.push({ id: "up-side", hole: w.h, cid: c.id, k: null, kind: "Course", score: 4.9, title: `No. ${w.h}${pinT}: avoid the ${w.sec} miss ${lieW(w.lie)} ${shotW}`,
          detail: `Players there scored ${pm3(w.avg)} to par on the hole (${w.n} shots, as if there in ${w.k}; lower is better), ${x.spread.toFixed(2)} strokes higher than the best miss, ${b.sec} ${lieW(b.lie)} (${pm3(b.avg)}, ${b.n} shots) · every shot played from within 30 yds of the green${M2 ? ` · also No. ${M2.worst.h}: avoid ${M2.worst.sec} ${lieW(M2.worst.lie)} (${pm3(M2.worst.avg)})` : ""}`,
          to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, w.h, EX.hole(`Where should I miss on hole ${w.h}?`)) }); }
    }
    // course form: the best there over the years (on the tour picked)
    const hist = field.map((p) => { const rs = sgRounds(rawOf(p)).filter(isU); return rs.length ? { k: p.key, rs, v: perRound(rs), yrs: new Set(rs.map(yrOf)).size } : null; }).filter(Boolean);
    const horses = hist.filter((x) => x.rs.length >= 8).sort((a, b) => b.v - a.v).slice(0, 3);
    if (horses.length >= 2) out.push({ id: "up-horses", k: null, kind: "Course", score: 4.4, title: `Horses for courses at ${U.name}`, detail: horses.map((x) => `${nameOf(x.k)} ${sg2(x.v)} per round (${x.rs.length} rounds, ${x.yrs} year${x.yrs === 1 ? "" : "s"})`).join(" · "),
      to: "Leaderboards", run: toLead(`Who plays ${U.name} best?`) });
    // (update 760) the players picked: their record there, always with its context (is it good, is it enough to win, how
    // it compares with their other events), the skills that win here against theirs, and their own holes
    const ordS = (n) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
    const byYrU = new Map(); for (const h0 of hist) for (const r of h0.rs) { const y = yrOf(r), m = byYrU.get(y) || byYrU.set(y, new Map()).get(y); (m.get(h0.k) || m.set(h0.k, []).get(h0.k)).push(r); }
    const yrBoards = [...byYrU].map(([y, m]) => [y, [...m].filter(([, rs]) => rs.length >= 3).map(([kk, rs]) => [kk, perRound(rs)]).sort((a, b) => b[1] - a[1])]).filter(([, l]) => l.length >= 8); // (update 786: a smaller field on record still gives a winner's number)
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
      const verdict = diff == null ? "" : diff >= 0.4 ? `${me ? "You play" : `${S} plays`} this course well: ${sg2(diff)} strokes gained per round more than ${Pw} usual week (${sg2(usual)})` : diff <= -0.4 ? `${me ? "You play" : `${S} plays`} worse here than usual: ${sg2(diff)} per round against ${Pw} usual ${sg2(usual)}` : `About ${Pw} usual level (${sg2(usual)} per round elsewhere)`;
      out.push({ id: `up-me-${k}`, k, kind: "Course", score: 5.35 + Math.abs(diff || 0) * 0.1, x: { v: x.v }, title: `${me ? "Your" : poss(nameOf(k))} record at ${U.name}: ${sg2(x.v)} strokes gained per round${pace ? `, a ${ordS(pace)}-place pace` : ""}`,
        detail: [verdict, nEv > 3 ? `${ordS(evRank)} best of ${nEv} events on ${Pw} schedule` : "", winV != null ? `The average winner here: ${sg2(winV)} strokes gained per round (a top 10: ${sg2(t10V)})${x.v >= t10V ? `; ${he} have played at top-10 level here` : `; ${he} are ${(t10V - x.v).toFixed(2)} per round short of a top 10`}` : "", hereRank ? `${ordS(hereRank[0])} of ${hereRank[1]} players with 4+ rounds here` : "", `${x.rs.length} rounds here over ${x.yrs} year${x.yrs === 1 ? "" : "s"}${bestY && byYr.size > 1 ? `; ${me ? "your" : "their"} best year at ${U.name}: ${bestY[0]} (${sg2(bestY[1])} per round)` : ""}`].filter(Boolean).join(" · "),
        to: "Stats · Tournaments", run: () => toStats(k, { view2: "full", year: [], span: 0, event: evNames }, "Tournaments", null) });
      if (!(c && upRaw?.id === c.id)) continue;
      const R0 = upRaw, P = R0.ply.get(k) || R0.plyName.get(nmKey(nameOf(k))), cat0 = [...R0.catEdge].sort((a, b) => b[1] - a[1]);
      // the skills that win here: the top 10's edge over the rest, by part of the game, against theirs (here when they have
      // 2+ rounds of shots on record, else their season)
      const mine = P && P.rds.size >= 2 ? Object.fromEntries(cats.map((c0) => [c0, P.cat[c0] / P.rds.size])) : null;
      const seasonRs = (playerOf(k) ? sgRounds(rawOf(playerOf(k))) : []).filter((r) => yrOf(r) === seasonYr()), theirs = mine || (seasonRs.length >= 8 ? Object.fromEntries(cats.map((c0) => [c0, avgOf(seasonRs, (r) => inCat(r, c0))])) : null);
      // (update 780) short: the skill that wins here, the player's number in it against the top 10's, and the biggest gap
      if (theirs && cat0.length) { const key = cat0[0][0], gap = R0.catTop[key] - theirs[key], gaps = cats.map((c0) => [c0, R0.catTop[c0] - theirs[c0]]).sort((a, b) => b[1] - a[1]), src = mine ? "here" : `in ${seasonYr()} (no shots of ${Pw} here on record)`;
        // (update 799) that part of the game by distance: the player's shots here (else the rest of the field) against the top 10's
        const yrsT = R0.yrs.length ? (R0.yrs.length === 1 ? R0.yrs[0] : `${R0.yrs[0]}-${R0.yrs.at(-1).slice(2)}`) : "", CB = courseBands(R0, key, P?.pk || null, mine ? P.rds.size : -1) || []; /* (update 867: per round) */
        const mineB = mine && CB.some((b0) => b0.me != null) ? Object.fromEntries(CB.filter((b0) => b0.me != null).map((b0) => [b0.l, b0.me])) : null, seasB = mineB ? null : seasonBands(k, key, seasonYr(), true); /* (update 801: no shots here: their season; 809: the data's ranges) */
        out.push({ id: `up-skill-${k}`, k, kind: "Course", x: { skill: { cat: key, perRound: true, perDist: true, bands: CB.filter((b0) => b0.top != null).map((b0) => b0.l), a: mineB || seasB || Object.fromEntries(CB.map((b0) => [b0.l, b0.rest])), top: Object.fromEntries(CB.map((b0) => [b0.l, b0.top])), who: mineB ? (me ? "You" : S) : seasB ? `${me ? "You" : S}, ${seasonYr()} season` : "Rest of the field", where: mineB || !seasB ? `at ${U.name}, ${yrsT}` : `(top 10: at ${U.name}, ${yrsT})` } }, score: 5.3, title: `What wins at ${U.name}: ${CATN[key]}`,
          detail: (() => { const tS = R0.shotTop[key], rS = R0.shotRest[key], pS = mine && P?.n?.[key] ? P.cat[key] / P.n[key] : (() => { const rs1 = (gearData.get(k) || detail?.by.get(k) || []).filter((r) => yrOf(r) === seasonYr() && !r.eventLevel); let a = 0, n = 0; for (const r of rs1) for (const s0 of r.shots || []) if (s0.cat === key) { a += s0.sg; n += s0.w || 1; } return n >= 20 ? a / n : null; })();
            void tS; void rS; void pS; // (update 867: per round, as the chart)
            const tR = R0.catTop?.[key], rR = R0.catRest?.[key], pR = mine ? mine[key] : theirs?.[key];
            return `Strokes gained per round ${CAT_IN[key]} (every round at ${U.name} on record, ${yrsT}): the top 10 ${sg2(tR)}, the rest of the field ${sg2(rR)} · ${me ? "You" : S}: ${pR == null ? "not enough shots on record" : `${sg2(pR)} per round ${mine ? `here (${P.rds.size} rounds)` : `on the ${seasonYr()} season (no shots of ${Pw} at ${U.name} on record)`}${tR - pR > 0.005 ? `, ${(tR - pR).toFixed(2)} a round short of the top 10` : ", at top-10 level"}`}`; })(),
          to: "Strategy Maps · Cal’s Targets", run: () => toHole(c.id, 1, EX.course(`What wins at ${U.name}?`)) }); }
      // their own holes: best and worst against the field, and a par 5 played against the grain
      if (P) { const hs = [...P.holes].filter(([, o]) => o[1] >= 8).map( /* (update 781: 8+ plays of a hole, not 2) */([h, o]) => { const f = R0.fAvg.get(h); return f && f[1] >= 20 ? { h, par: o[2], n: o[1], d: o[0] / o[1] - f[0] / f[1] } : null; }).filter(Boolean).sort((a, b) => a.d - b.d);
        const note = P.notes.sort((a, b) => a.s - b.s)[0];
        if (hs.length >= 6 || note) { const b = hs[0], w = hs.at(-1), sc = (s0) => (s0 <= -2 ? "an eagle" : "a birdie");
          const nl = note ? `In ${note.yr} (round ${note.rd}) on No. ${note.h}, ${he} made ${sc(note.s)} by ${note.kind === "lay" ? `laying up from ${Math.round(note.d)} yds when ${Math.round(note.share * 100)}% of the field went for it` : `going for it from ${Math.round(note.d)} yds when only ${Math.round(note.share * 100)}% of the field did`}` : "";
          out.push({ id: `up-holes-${k}`, k, kind: "Course", hole: note ? note.h : b?.h, cid: c.id, score: note ? 5.0 : 4.6,
            title: note ? `${U.name}: ${me ? "your" : poss(S)} ${note.kind === "lay" ? "lay-up" : "go"} against the grain on No. ${note.h} paid off` : `${U.name}: ${me ? "you score" : `${S} scores`} best on No. ${b.h} and worst on No. ${w.h}`,
            detail: [nl, b && hs.length >= 6 ? `At ${c.name}, No. ${b.h} (par ${b.par}) is ${me ? "your" : poss(S)} best hole: ${me ? "you score" : "they score"} ${(-b.d).toFixed(2)} strokes a play lower than the field's average (${b.n} plays). ${w && w.d > 0.15 ? `On No. ${w.h} (par ${w.par}) ${me ? "you score" : "they score"} ${w.d.toFixed(2)} a play higher than the field: the one to plan for.` : ""}` : ""].filter(Boolean).join(" · ").trim(),
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
      let i = top.length - 1; while (i >= 0 && !top[i]) i--; if (i < 0) continue; // (update 807: the latest event with that kind of club on record, not just the very last event)
      let j = i; while (j > 0 && (top[j - 1] === top[i] || !top[j - 1])) j--; // the first tournament with the new one
      if (j === 0 || i - j > 8 || !top[j - 1]) continue; // (update 805: a switch in the last 9 events)
      const neu = top[i], old = top[j - 1], c = PROD_COL[pill], nm = (g) => { const gi = gearInfo(g); return `${gi.brand} ${gi.model}`.trim() || g; };
      // as the product table: the rounds with any shot with the model; its shots' strokes gained in the column's part of the game ÷ those rounds
      const row = (g) => { const rds = rs.filter((rd) => rd.shots.some((s) => val(s) === g)); if (!rds.length) return null;
        const vals = rds.map((rd) => rd.shots.reduce((u, s) => u + (val(s) === g && (!c || s.cat === c) ? s.sg : 0), 0));
        return { v: vals.reduce((t, v) => t + v, 0) / rds.length, vals, n: rds.length, ev: new Set(rds.map((r) => `${r.event}|${yrOf(r)}`)).size }; };
      const A = row(neu), B = row(old); if (!A || !B) continue;
      // (update 821) every model of that kind this season, each with its own colour: the new one, the one before, then the rest by rounds
      const MC = ["m-a", "m-b", "m-c", "m-d", "m-e", "m-f"], allG = [...new Set(rs.flatMap((rd) => rd.shots.map(val).filter(Boolean)))];
      const all = [neu, old, ...allG.filter((g) => g !== neu && g !== old).map((g) => [g, row(g)]).filter(([, r]) => r).sort((a, b) => b[1].n - a[1].n).map(([g]) => g)]
        .map((g, i) => ({ nm: nm(g), r: g === neu ? A : g === old ? B : row(g), cls: MC[i] || "m-o", isNew: g === neu })).filter((m) => m.r);
      // (update 760) only a comparison that holds up: its first event in the bag (said as such), or 8+ rounds with each
      // and a difference clear of the round-to-round noise (Welch's t of 1.65+, about 90% sure which is better)
      const sdv = (a) => { if (a.length < 2) return 0; const m = a.reduce((t, v) => t + v, 0) / a.length; return Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / (a.length - 1)); };
      const first = A.ev === 1, tStat = Math.abs(A.v - B.v) / Math.max(1e-6, Math.sqrt(sdv(A.vals) ** 2 / A.n + sdv(B.vals) ** 2 / B.n));
      const sure = first || (A.n >= 8 && B.n >= 8 && tStat >= 1.65); // (update 807: a one-round first event shows too) // (update 805: every recent switch shows; one not yet clear is said to be too early to call)
      // (update 838) ready for the front page: past its first event, 8+ rounds with each and a clear difference, and the
      // switch fairly recent (its first event within 120 days of their latest round)
      const since = String(evs[j].end || "").slice(0, 10), lastD = String(rs.at(-1).date || "").slice(0, 10), ripe = sure && !first && !!since && (Date.parse(lastD) - Date.parse(since)) / 864e5 <= 120;
      const dd = A.v - B.v, where = tourPick && tourPick !== ALL ? `every ${tourName(tourPick)} round in ${seasonYr()}` : `every round in ${seasonYr()}`;
      out.push({ id: `eq-${k}-${pill}`, k, x: { pill, neu: nm(neu), old: nm(old), A, B, c, dd, where, first, sure, all, since, ripe }, kind: "Equipment", score: (first ? 6 : sure ? 7 : 5) + Math.abs(dd) * 2, title: `New ${KIND_WORD[pill] || "club"}: ${nm(neu)}, ${sg2(dd)} per round ${COL_IN[c]}`,
        detail: `${first ? "Only one event so far, so it’s early: " : ""}${sg2(A.v)} per round over ${plural(A.n, "round")} (${plural(A.ev, "tournament")}) with it, against ${sg2(B.v)} over ${plural(B.n, "round")} (${plural(B.ev, "tournament")}) with the ${nm(old)} · ${where}, as the product table on Stats counts it`,
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
    const toF = (c) => () => toStats(k, { view2: "full", focusCats: [c], focusPick: c, year: [SY], span: 0 }, "Where you stand", EX.cat(`Where is ${CATN[c].toLowerCase()} costing strokes?`, c));
    const cand = [];
    if (G.length >= 3) { const b = G[0], w = G.at(-1);
      if (b.rd > 0.05) cand.push({ x: { c: b.c, d: b.d, per: b.per }, id: `dz-best-${k}`, kick: "Sweet spot", title: `${P} sweet spot: ${rng(b)}`, detail: `${sg2(b.per)} a shot over ${Math.round(b.n)} shots, ${sg2(b.rd)} strokes per round from there in ${SY}`, run: toF(b.c), to: `Stats · Player Stats · ${CATN[b.c]}` });
      // (update 803) the weakest range always goes to Where to Improve (even a player gaining everywhere has a weakest)
      out.push({ x: { c: w.c, d: w.d, per: w.per }, id: `dz-leak-${k}`, k, kind: "Focus", score: w.rd < 0 ? 4.3 + Math.abs(w.rd) : 3.7, kick: w.rd < 0 ? "The leak" : "Weakest range", title: w.rd < 0 ? `${P} biggest leak: ${rng(w)}` : `${P} weakest range: ${rng(w)}`, detail: `${sg2(w.per)} a shot over ${Math.round(w.n)} shots · ${sg2(w.rd)} strokes per round from there in ${SY}${(() => { const nx = [...G].reverse().slice(1).find((g) => g.c === w.c && g.rd < 0); return nx ? ` · next in ${CATN[w.c].toLowerCase()}: ${nx.d}, ${sg2(nx.rd)} per round` : ""; })()}`, run: toF(w.c), to: `Stats · Player Stats · ${CATN[w.c]}` }); }
    // (update 803) form at a distance: the last 12 rounds (3 events on the DP World Tour) against the 12 before, in each
    // range with 10+ shots in both; the biggest rise and the biggest drop, strokes gained a shot
    { const all = (gearData.get(k) || []).filter((r) => (ownP?.key === k || onTour(r)) && !r.eventLevel).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))), fs = formSplit(all);
      if (fs) { const agg = (rs0) => { const m = new Map(); for (const r of rs0) for (const s0 of r.shots) if (s0.dist && ["APP", "ARG", "PUTT"].includes(s0.cat)) { const kk = `${s0.cat}|${s0.dist}`, o = m.get(kk) || m.set(kk, [0, 0]).get(kk); o[0] += s0.sg; o[1] += s0.w || 1; } return m; };
        const A = agg(fs.last), B = agg(fs.prev), ch = [...A].filter(([kk, a]) => a[1] >= 10 && (B.get(kk)?.[1] || 0) >= 10).map(([kk, a]) => { const b = B.get(kk), [c0, d0] = kk.split("|"); return { c: c0, d: d0, a: a[0] / a[1], b: b[0] / b[1], na: a[1], nb: b[1] }; }).map((x) => ({ ...x, dd: x.a - x.b })).sort((a, b) => b.dd - a.dd);
        const lbl = (x) => `${CATN[x.c]} from ${x.d}`, mk2 = (x, up) => ({ id: `fd-${up ? "up" : "dn"}-${k}`, k, x: { c: x.c, d: x.d, up, n: fs.n, FL: fs.lbl, lastR: fs.last, prevR: fs.prev }, kind: up ? "Trend" : "Slide", score: 4.4 + Math.abs(x.dd) * 6, title: `${P} ${lbl(x)} ${up ? "on the rise" : "slipping"}`,
          detail: `Last ${fs.n}${/event/.test(fs.lbl) ? " events" : ""}: ${sg2(x.a)} a shot (${Math.round(x.na)} shots) · ${fs.n}${/event/.test(fs.lbl) ? " events" : ""} before: ${sg2(x.b)} (${Math.round(x.nb)} shots) · change: ${sg2(x.dd)} a shot`, run: toF(x.c), to: `Stats · Player Stats · ${CATN[x.c]}` });
        if (ch[0] && ch[0].dd >= 0.08) out.push(mk2(ch[0], true)); if (ch.at(-1) && ch.at(-1).dd <= -0.08) out.push(mk2(ch.at(-1), false)); } }
    for (const c of ["APP", "ARG"]) { const fw = lieG.get(`${c}|the fairway`), bad = ["the rough", "a bunker"].map((L) => lieG.get(`${c}|${L}`)).filter((g) => g && g.n >= 20).sort((a, b) => a.sg / a.n - b.sg / b.n)[0];
      if (fw && fw.n >= 20 && bad) { const gap = fw.sg / fw.n - bad.sg / bad.n; if (gap > 0.04) cand.push({ id: `lie-${c}-${k}`, kick: "By lie", title: `From ${bad.L}, ${S} ${me ? "give" : "gives"} back ${gap.toFixed(2)} a shot ${c === "APP" ? "on approach" : "around the green"}`, detail: `${sg2(bad.sg / bad.n)} a shot from ${bad.L} (${Math.round(bad.n)} shots) against ${sg2(fw.sg / fw.n)} from the fairway (${Math.round(fw.n)}) in ${SY}`, run: toF(c), to: `Stats · Player Stats · ${CATN[c]}` }); } }
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
    // (update 845) only the tours the players on Home play: yours, the one picked in the header, else the favorites
    const selK = selfKey ? [selfKey] : picked.size ? [...picked] : isFresh() ? [] /* (update 863: every tour's players) */ : keys, cnt = new Map(), src = selK.length ? field.filter((p) => selK.includes(p.key)) : field;
    const srcR = [...src.map((p) => p.rounds), ...(ownP && selK.includes(ownP.key) && !src.some((p) => p.key === ownP.key) ? [ownP.rounds] : [])];
    for (const rs of srcR) for (const rd of rs) cnt.set(tourOf(rd), (cnt.get(tourOf(rd)) || 0) + 1);
    const tours = [...cnt].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    if (tourPick !== ALL && !tours.includes(tourPick)) { tourPick = tours[0] ?? null; tmemo.clear(); }
    // (update 841) one player (yours, or picked in the header): the tour they've played the most, until a tour is tapped
    { const k1 = selfKey || (picked.size === 1 ? [...picked][0] : null); if (k1 && !tourTouched && field.length) { const c1 = new Map(); for (const rd of (ownP?.key === k1 ? ownP.rounds : playerOf(k1)?.rounds) || []) c1.set(tourOf(rd), (c1.get(tourOf(rd)) || 0) + 1);
      const t1 = [...c1].sort((a, b) => b[1] - a[1])[0]?.[0]; if (t1 != null && tours.includes(t1) && t1 !== tourPick) { tourPick = t1; tmemo.clear(); rankMemo = null; setTimeout(() => { refresh(); loadDetail().catch(() => {}); }, 0); } } }
    const showTours = tours.length > 1;
    mount(tourRow, showTours ? [el("span", { class: "hl-pl" }, "Tour"), ...tours.map((t) => pill(tourPick === t, tourName(t), () => setTour(t))), pill(tourPick === ALL, "All", () => setTour(ALL))] : []);
    tourRow.hidden = !showTours;
    edition.textContent = tourPick ? `${tourName(tourPick)} Edition` : ""; nextLine.textContent = next ? `${next.name} · ${next.live ? "on now" : "coming up"}` : ""; nextLine.classList.toggle("on", !!next?.live); /* (update 735: glows while it's live) */
    // (update 822) no players row: Home is every favorite, or just the player picked in the header (on their own tour)
    whoRow.hidden = true; mount(whoRow, []);
    if (picked.size === 1) { const k = [...picked][0]; if (field.length && !playsTour(k)) { const c2 = new Map(); for (const rd of playerOf(k)?.rounds || []) c2.set(tourOf(rd), (c2.get(tourOf(rd)) || 0) + 1); const t = [...c2].sort((a, b) => b[1] - a[1])[0]?.[0]; if (t != null && t !== tourPick) { tourPick = t; tmemo.clear(); rankMemo = null; mount(tourRow, showTours ? [el("span", { class: "hl-pl" }, "Tour"), ...tours.map((t2) => pill(tourPick === t2, tourName(t2), () => setTour(t2))), pill(tourPick === ALL, "All", () => setTour(ALL))] : []); edition.textContent = tourPick ? `${tourName(tourPick)} Edition` : ""; } } }
  }
  const playsTour = (k) => !tourPick || tourPick === ALL || !field.length || (ownP && k === ownP.key) || (playerOf(k)?.rounds || []).some((rd) => tourOf(rd) === tourPick);
  const shownKeys = () => (picked.size ? [...picked] : keys.filter(playsTour));
  // (update 822) the header's player is Home's player: picked there, Home is about them alone; cleared, every favorite again
  const syncPicked = () => { picked.clear(); const c0 = staff && !selfKey ? currentPlayer() : null;
    // (update 863) a coach or caddie: only their own players (or "Me"); one player: always them
    const allowed = (k) => admin || !team.isTeam || teamKeys.includes(k) || k === ownKey;
    const c = c0?.key && allowed(c0.key) ? c0 : lockKey ? { key: lockKey, label: labels.get(lockKey) || lockKey } : null;
    if (lockKey && (!c0?.key || !allowed(c0.key))) setTimeout(() => setCurrent({ key: lockKey, label: labels.get(lockKey) || lockKey }), 0);
    if (!c?.key) return;
    picked.add(c.key); if (!keys.includes(c.key)) keys = [...keys, c.key]; if (!labels.has(c.key) && c.label) labels.set(c.key, c.label); focus = c.key; };
  const setTour = (t) => { tourTouched = true; if (tourPick === t) return; tourPick = t; tmemo.clear(); rankMemo = null; refresh(); loadDetail().catch(() => {}); }; // (tbMemo is keyed by tour)
  // (update 740) a tap picks a player, or unpicks one already picked; All: none picked (everyone)
  const setWho = (k) => { if (k == null) picked.clear(); else if (picked.has(k)) picked.delete(k); else { picked.add(k); if (!keys.includes(k)) keys = [...keys, k]; focus = k; } drawTabs(); refresh(); }; // (update 780: the questions follow every change of who's picked)
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
  // (update 831) Best Week, for one player: their best week of the season overall, in each part of the game and from each of
  // the data's distance ranges (their own shots), strokes gained per round, each against their season average
  function bestWeeks(k) {
    const pl = playerOf(k), own = (gearData.get(k) || []).filter((r) => (ownP?.key === k || onTour(r)) && yrOf(r) === seasonYr());
    const base = own.length ? own : (pl ? rawOf(pl).filter((r) => yrOf(r) === seasonYr()) : []); if (!base.length) return [];
    const evs = eventsOf(base).filter((e) => e.rs.length >= 2 || e.rs.some((r) => r.eventLevel)); if (evs.length < 3) return [];
    const out = [], me = isMe(k), P = me ? "Your" : poss(nameOf(k));
    const push = (id, lbl, f, n0) => { const vals = evs.map((e) => [e, avgOf(e.rs, f)]).filter((x) => x[1] != null), b = [...vals].sort((a, c) => c[1] - a[1])[0]; if (!b || b[1] <= 0) return;
      const seas = avgOf(base, f) ?? 0; out.push({ id: `bw-${id}-${k}`, k, kind: "Best week", score: (id === "tot" ? 12 : id.startsWith("d-") ? 8 : 10) + Math.min(1, b[1] - seas) * 0.1, kick: "Best week", fx: { big: sg2(b[1]), small: "per round", lbl: `${lbl} · ${fullEv(b[0].event)}` },
        title: `${P} best ${lbl.toLowerCase()} week of ${seasonYr()}: ${sg2(b[1])} per round at ${fullEv(b[0].event)}`, detail: `${sg2(b[1])} strokes gained per round ${n0 || ""}at ${fullEv(b[0].event)}, against ${sg2(seas)} over the season`.replace("  ", " "), x: { v: b[1] } }); };
    push("tot", "Overall", tot);
    for (const c of ["OTT", "APP", "ARG", "PUTT"]) push(c, CATW[c][0].toUpperCase() + CATW[c].slice(1), (r) => inCat(r, c), `${CAT_IN[c]} `);
    if (own.length) { const dists = new Map(); for (const r of own) for (const s0 of r.shots || []) if (s0.dist && s0.cat !== "OTT") dists.set(`${s0.cat}|${s0.dist}`, (dists.get(`${s0.cat}|${s0.dist}`) || 0) + (s0.w || 1));
      const per0 = [...dists].filter(([, n]) => n >= 25).map(([kk]) => kk), per = per0.filter((kk) => per0.filter((x) => x.split("|")[0] === kk.split("|")[0]).length > 1); // (a part of the game with one range: its own card says it)
      const cand = []; for (const kk of per) { const [c, d] = kk.split("|"), f = (r) => (r.shots || []).reduce((t, s0) => t + (s0.cat === c && s0.dist === d ? s0.sg || 0 : 0), 0); const n0 = out.length; push(`d-${c}-${d}`, `${c === "PUTT" ? "Putting" : c === "ARG" ? "Short game" : "Approach"} from ${d}`, f); if (out.length > n0) cand.push(out.pop()); }
      out.push(...cand.sort((a, b) => b.x.v - a.x.v).slice(0, 4)); }
    return out;
  }
  const collect = () => { const shown = shownKeys().slice(0, selfKey ? 1 : GEARN);
    return [...highlightsAll(), ...shownKeys().flatMap(glanceFacts) /* (update 841) */, ...(solo() ? [] : shownKeys().length ? tourLeaders().map((h, i) => ({ ...h, score: 2.9 - i * 0.01 })) : tourLeaders()) /* (update 849) (update 866: with favorites, the tour's leaders only fill in after your players' facts) */, ...shown.flatMap((k) => (gearData.has(k) ? [...gearHighlights(k), ...detailSpots(k)] : [])), /* (update 845: Best Week has its own section) */ ...practice]; };
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
      // (update 863) a coach or caddie with several players: all of them are favorites (saved so every page has them)
      if (!admin && team.isTeam && teamKeys.length > 1) { const miss = teamKeys.filter((k) => !fav.includes(k)); if (miss.length) { fav = [...fav, ...miss]; import("../watchlist.js").then((wl) => wl.saveWatch({ players: fav })).catch((e) => console.warn("auto favorites", e)); } }
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
    syncPicked(); drawTabs(); drawOvTop().catch((e) => console.warn(e));
    { const off = onCurrent(() => { if (!main.isConnected) { off(); return; } syncPicked(); drawTabs(); refresh(); drawOvTop().catch(() => {}); }); }
    if (ownKey) { try { const { loadSource } = await import("../reportGen.js"); const d = await loadSource("entered", ownKey, myName || "Me").catch(() => null), rs = (d?.me?.rounds || []).filter((r) => r.shots?.length);
      ownAll = (d?.me?.rounds || []).filter((r) => r.shots?.length || r.basic?.holes); if (ownAll.length && !labels.has(ownKey)) labels.set(ownKey, myName || "Me"); /* (update 863: even part of one round) */
      if (rs.length) { ownP = { key: ownKey, name: myName || "Me", rounds: rs, own: true }; labels.set(ownKey, myName || "Me"); gearData.set(ownKey, rs); gearP.set(ownKey, Promise.resolve()); if (!keys.includes(ownKey)) keys = [ownKey, ...keys]; } } catch (e) { console.warn("own rounds", e); } }
    await nextP; await heatP; /* (update 736: the courses, for Course Insights & Strategy) */
    refresh();
    loadUpCourse().catch(() => {}); /* (update 737) */
    loadDetail().catch((e) => console.warn("detail", e)); /* (update 749) */
    if (selfKey || ownP) { practice = await practiceHighlights(selfKey || ownP.key).catch(() => []); if (practice.length) drawFeed(collect()); }
  } catch (err) { console.error(err); mount(feed, el("p", { class: "muted small" }, "Couldn’t put the highlights together just now.")); }
}
