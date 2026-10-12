/*
 * Practice (update 136): plan a session, play it shot by shot, and see how it went.
 *
 *   Categories: Off the Tee, Approach, Around the Green, Putting (pills at the top).
 *   Plan:       how many shots, how they're split across distances (with your on-course strokes gained for each,
 *               from the Stats data), and the mix of lies / pins / fairway widths / breaks. Then a random order.
 *   Play:       each shot on a made-up hole or green, with a heat map of where to aim (from the strokes-gained
 *               baseline and your own shot pattern once there's enough of it). Enter the result by tapping where
 *               it finished, typing, saying it, or loading a TrackMan / GCQuad file.
 *   Results:    strokes gained against Tour average (the same baseline as Track Round), by distance, the key numbers
 *               for the category, your pattern, and how practice compares with the course.
 */
import { el, mount, confirmAction } from "../ui.js";
import { getState } from "../auth.js";
import { CATS, CAT_ORDER, BUCKETS, MIXES, generateShots, distribute, scoreShot, spreadFor } from "../practice/model.js";
import { trendSvg } from "../practice/draw.js";
import { summarize, scored, personalSpread, courseByBucket, readLaunchMonitor, resultFromMonitor } from "../practice/analysis.js";
import { listSessions, saveSession, deleteSession, newSessionId } from "../practice/store.js";
import { bagPatterns, clubFor } from "../practice/clubs.js";
import { gameById, gameProgress, personalBest, fmtGameScore } from "../practice/games.js";
import { SG, sgCls, tile, shotTitle, resultText, keyTiles, bucketTable, patternPanel, shotCard } from "./practiceShot.js";
import { myEntryKey, myName } from "./dataEntry.js";

const LS_CAT = "ta:practice:cat";
// The tools beside the four categories (update 138)
const TOOLS = { ROUND: "Sim Round", PREP: "Course Prep", GAMES: "Games", BAG: "My Clubs" };
const TOOL_ORDER = ["ROUND", "PREP", "GAMES", "BAG"];
const DEF_TOTAL = { OTT: 14, APP: 20, ARG: 20, PUTT: 24 };

export async function render(main, { flash }) {
  const state = getState();
  const uid = state.user.uid;
  const playerKey = state.profile?.clientKey || null;
  const label = state.profile?.name || myName(state);
  let cat = new URLSearchParams(location.hash.split("?")[1] || "").get("cat") || (() => { try { return localStorage.getItem(LS_CAT); } catch { return null; } })() || "APP";
  if (!CATS[cat] && !TOOLS[cat]) cat = "APP";
  let sessions = [];
  let view = { name: "home" }; // home | plan | play | summary (sessions and games) · round | roundEnd (rounds) · tool pages
  let lastKey = "";
  let saveTimer = null;
  let showHeat = true;
  const courseCache = new Map(); // cat -> { bucketId: { sgPer, n } }
  let roundsP = null;

  const pills = el("nav", { class: "pr-pills", "aria-label": "Practice category" });
  const tools = el("nav", { class: "pr-pills pr-tools", "aria-label": "Practice tools" });
  const body = el("div", { class: "pr-body" });
  mount(main, [el("div", { class: "pr-wrap" }, [pills, tools, body])]);
  const pick = (c) => { cat = c; try { localStorage.setItem(LS_CAT, c); } catch { /* */ } view = { name: "home" }; drawPills(); draw(); };
  const drawPills = () => {
    mount(pills, CAT_ORDER.map((c) => {
      const a = el("button", { type: "button", class: `pr-pill${c === cat ? " on" : ""}`, "aria-pressed": c === cat ? "true" : "false" }, [el("span", { class: "pr-pl-full" }, CATS[c].label), el("span", { class: "pr-pl-short", "aria-hidden": "true" }, c === "ARG" ? "Around Green" : CATS[c].label)]);
      a.addEventListener("click", () => pick(c));
      return a;
    }));
    mount(tools, TOOL_ORDER.map((t) => {
      const a = el("button", { type: "button", class: `pr-pill${t === cat ? " on" : ""}`, "aria-pressed": t === cat ? "true" : "false" }, TOOLS[t]);
      a.addEventListener("click", () => pick(t));
      return a;
    }));
  };

  // your rounds (the Tour Events file and your entered rounds), for "on course" by bucket
  const courseFor = async (c) => {
    if (courseCache.has(c)) return courseCache.get(c);
    roundsP ||= (async () => {
      const { loadSource } = await import("../reportGen.js");
      const [tour, entered] = await Promise.all([
        playerKey ? loadSource("tour", playerKey, label, { detail: false }).catch(() => null) : null,
        loadSource("entered", myEntryKey(state), label).catch(() => null),
      ]);
      return [...(tour?.me?.rounds || []), ...(entered?.me?.rounds || [])];
    })();
    const res = courseByBucket(c, await roundsP);
    courseCache.set(c, res);
    return res;
  };

  function save(s, now = false) {
    clearTimeout(saveTimer);
    const run = () => saveSession(uid, s).catch((err) => { console.error(err); flash?.("Couldn't save just now. It'll try again with the next shot.", "error"); });
    if (now) return run();
    saveTimer = setTimeout(run, 700);
  }

  /** Where the aim map's spread comes from: your club's pattern (My Clubs), else your practice pattern, else a typical one. */
  function aimFor(shot) {
    if (shot.kind === "putt") return null;
    const pats = bagPatterns(sessions, { min: 8 });
    if (shot.kind === "tee") {
      const club = shot.club === "Driver" ? "Driver" : shot.club === "3 wood" ? "3w" : null, p = club && pats[club];
      if (p?.carrySd != null) return { spread: { sx: Math.max(4, p.offlineSd), sy: Math.max(4, p.carrySd) }, label: `Aim map uses your ${club} pattern (${p.n} shots).` };
      const ps = personalSpread("OTT", sessions, shot.club);
      return ps ? { spread: ps, label: `Aim map uses your pattern (${ps.n} shots).` } : { spread: spreadFor(shot) };
    }
    if (shot.startDist > 50 && shot.startLie !== "Bunker") {
      const c = clubFor(pats, shot.startDist);
      if (c) return { spread: c, label: `Aim map uses your ${c.club} pattern (${c.n} shots).` };
    }
    const p = personalSpread(shot.startDist <= 50 ? "ARG" : "APP", sessions);
    if (p) return { spread: { sx: p.fx * shot.startDist, sy: p.fy * shot.startDist }, label: `Aim map uses your pattern (${p.n} shots).` };
    return { spread: spreadFor(shot) };
  }

  // what the tool pages get to work with
  const ctx = {
    body, uid, state, flash, label, playerKey, save,
    get sessions() { return sessions; },
    add(s) { sessions = [s, ...sessions.filter((x) => x.id !== s.id)]; },
    async remove(id) { await deleteSession(uid, id).catch(() => {}); sessions = sessions.filter((x) => x.id !== id); },
    aimFor, newId: newSessionId,
    heat: { get on() { return showHeat; }, set(v) { showHeat = v; } },
    go(v) { view = v; draw(); }, home() { view = { name: "home" }; draw(); },
    get view() { return view; },
    playSession(s) { sessions = [s, ...sessions.filter((x) => x.id !== s.id)]; view = { name: "play", session: s, at: Math.max(0, s.shots.findIndex((x) => !x.result)) }; draw(); },
    showSummary(s) { view = { name: "summary", session: s }; draw(); },
    courseFor,
  };

  drawPills(); mount(body, el("p", { class: "muted pr-loading" }, "Loading your practice\u2026"));
  try { sessions = await listSessions(uid); } catch (err) { console.error(err); flash?.("Couldn't load your practice sessions. Check your connection.", "error"); }
  drawPills(); draw();

  async function draw() {
    // a new page or a new shot starts at the top
    const key = `${view.name}:${view.at ?? ""}:${view.hole ?? ""}:${view.k ?? ""}:${cat}`;
    if (key !== lastKey) { lastKey = key; try { window.scrollTo({ top: 0 }); } catch { /* */ } }
    if (view.name === "play") return drawPlay();
    if (view.name === "summary") return drawSummary(view.session);
    if (["round", "roundEnd", "prepCourse", "prepNew"].includes(view.name) || cat === "ROUND" || cat === "PREP") {
      const m = await import("./practiceRound.js");
      return m.render(ctx, cat === "PREP" ? "prep" : "sim");
    }
    if (cat === "GAMES") { const m = await import("./practiceGames.js"); return m.render(ctx); }
    if (cat === "BAG" || view.name.startsWith("bag")) { const m = await import("./practiceClubs.js"); return m.render(ctx); }
    if (view.name === "plan") return drawPlan();
    return drawHome();
  }

  /* =============================================== home: your practice in this category =============================================== */
  async function drawHome() {
    const mine = sessions.filter((s) => s.cat === cat);
    const done = mine.filter((s) => s.status === "done"), active = mine.find((s) => s.status === "active");
    const startBtn = el("button", { type: "button", class: "btn pr-start" }, "＋  Start new practice session");
    startBtn.addEventListener("click", () => { view = { name: "plan" }; draw(); });
    const head = el("section", { class: "panel pr-hero" }, [
      el("div", {}, [el("p", { class: "pr-eyebrow" }, "Practice"), el("h1", {}, CATS[cat].label), el("p", { class: "muted pr-lede" }, LEDE[cat])]),
      startBtn,
    ]);
    const resume = active ? (() => {
      const left = active.shots.filter((s) => !s.result).length;
      const b = el("button", { type: "button", class: "btn ghost" }, "Resume");
      b.addEventListener("click", () => ctx.playSession(active));
      const x = el("button", { type: "button", class: "link danger" }, "Discard");
      x.addEventListener("click", async () => { if (!confirmAction("Discard this unfinished session?")) return; await ctx.remove(active.id); draw(); });
      return el("section", { class: "panel pr-resume" }, [el("div", {}, [el("strong", {}, "Session in progress"), el("span", { class: "muted" }, ` · ${active.shots.length - left} of ${active.shots.length} shots · ${new Date(active.startedAt).toLocaleDateString()}`)]), el("div", { class: "pr-row" }, [b, x])]);
    })() : null;
    if (!done.length) {
      mount(body, [head, resume, el("section", { class: "panel pr-empty" }, [
        el("h2", {}, "How it works"),
        el("ol", {}, HOW[cat].map((t) => el("li", {}, t))),
      ])]);
      return;
    }
    const allShots = done.flatMap((s) => s.shots || []);
    const all = summarize(cat, allShots);
    const recent = done.filter((s) => Date.now() - Date.parse(s.startedAt) < 30 * 864e5);
    const recentSum = summarize(cat, recent.flatMap((s) => s.shots || []));
    const tiles = el("div", { class: "pr-tiles" }, [
      tile("Sessions", String(done.length)), tile("Shots", String(all.n)),
      tile("SG / shot", SG(all.sgPer), sgCls(all.sgPer), "all time, vs Tour avg"), tile("Last 30 days", SG(recentSum.sgPer), sgCls(recentSum.sgPer), `${recentSum.n} shots`),
      ...keyTiles(cat, all),
    ]);
    const trend = [...done].reverse().map((s) => ({ label: new Date(s.startedAt).toLocaleDateString(), v: s.summary?.sgPer ?? summarize(cat, s.shots).sgPer ?? 0 }));
    const course = await courseFor(cat).catch(() => ({}));
    if (view.name !== "home") return;
    const table = bucketTable(cat, all.byBucket, course);
    const list = el("div", { class: "pr-sessions" }, done.map((s) => {
      const sm = s.summary || summarize(cat, s.shots);
      const g = s.mode === "game" ? gameById(s.gameId) : null;
      const row = el("button", { type: "button", class: "pr-sess" }, [
        el("span", { class: "pr-sess-d" }, [new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), g ? el("span", { class: "pr-sess-tag" }, g.title) : null]),
        el("span", { class: "muted" }, `${sm.n} shots`),
        el("strong", { class: sgCls(sm.sg) }, SG(sm.sg, 1)),
        el("span", { class: `pr-sess-per ${sgCls(sm.sgPer)}` }, `${SG(sm.sgPer)} / shot`),
      ]);
      row.addEventListener("click", () => { view = { name: "summary", session: s }; draw(); });
      return row;
    }));
    mount(body, [head, resume,
      el("section", { class: "panel" }, [el("h2", {}, "Your practice"), tiles, trend.length > 1 ? el("div", { class: "pr-chart" }, [el("p", { class: "pr-cap" }, "Strokes gained per shot, session by session"), trendSvg(trend)]) : null]),
      el("section", { class: "panel" }, [el("h2", {}, "By distance"), el("p", { class: "muted small" }, "Practice against your strokes gained per shot on the course (Tour Events and Track Round), on the same baseline."), table]),
      patternPanel(cat, allShots.filter((s) => s.result).slice(-150), "Your pattern (last 150 shots)"),
      el("section", { class: "panel" }, [el("h2", {}, "Sessions"), list]),
    ]);
  }

  /* =============================================== plan a session =============================================== */
  async function drawPlan() {
    const buckets = BUCKETS[cat];
    const course = await courseFor(cat).catch(() => ({}));
    const pastAll = summarize(cat, sessions.filter((s) => s.cat === cat && s.status === "done").flatMap((s) => s.shots || []));
    let total = DEF_TOTAL[cat];
    let mode = "even"; // even | focus | custom
    let counts = {};
    const weightsFor = (m) => buckets.map((b) => {
      if (m !== "focus") return 1;
      // more shots where you lose the most (on course, else in practice); a little for everything
      const v = course[b.id]?.n >= 8 ? course[b.id].sgPer : pastAll.byBucket.find((x) => x.id === b.id)?.sgPer;
      return v == null ? 0.6 : Math.max(0.25, 0.6 - v * (cat === "PUTT" ? 6 : 4));
    });
    const defaultOn = (b) => !(cat === "APP" && (b.lo >= 225)) ; // (225-250 off unless you add it)
    const reflow = () => {
      const w = weightsFor(mode).map((v, i) => (defaultOn(buckets[i]) || mode === "focus" ? v : 0));
      distribute(total, w).forEach((n, i) => { counts[buckets[i].id] = n; });
    };
    reflow();
    const mixes = Object.fromEntries((MIXES[cat] || []).map((m) => [m.id, Object.fromEntries(m.options.map(([k, , d]) => [k, d]))]));
    let stimp = 11;

    const totalVal = el("strong", { class: "pr-total-v" }, String(total));
    const stepBtn = (txt, fn, label) => { const b = el("button", { type: "button", class: "pr-step", "aria-label": label }, txt); b.addEventListener("click", fn); return b; };
    const setTotal = (v) => { total = Math.max(1, Math.min(150, v)); totalVal.textContent = String(total); if (mode === "custom") mode = "even"; reflow(); drawRows(); drawModes(); };
    const totalBox = el("div", { class: "pr-total" }, [el("span", { class: "rd-label" }, "Shots"), el("div", { class: "pr-stepper" }, [stepBtn("−", () => setTotal(total - (total > 20 ? 5 : 1)), "Fewer shots"), totalVal, stepBtn("+", () => setTotal(total + (total >= 20 ? 5 : 1)), "More shots")])]);
    const modes = el("div", { class: "seg seg-sm pr-modes", role: "group", "aria-label": "Spread the shots" });
    const drawModes = () => mount(modes, [["even", "Even"], ["focus", "Focus on weak spots"]].map(([m, l]) => {
      const b = el("button", { type: "button", class: `seg-btn${mode === m ? " on" : ""}` }, l);
      b.addEventListener("click", () => { mode = m; reflow(); drawRows(); drawModes(); });
      return b;
    }));
    const rows = el("div", { class: "pr-brows" });
    const drawRows = () => {
      const max = Math.max(1, ...buckets.map((b) => counts[b.id] || 0));
      mount(rows, [
        el("div", { class: "pr-brow head" }, [el("span", {}, cat === "OTT" ? "Club" : "Distance"), el("span", {}, "Course"), el("span", {}, "Practice"), el("span", {}, "Shots")]),
        ...buckets.map((b) => {
          const c = course[b.id], pr = pastAll.byBucket.find((x) => x.id === b.id);
          const v = el("span", { class: "pr-cnt" }, String(counts[b.id] || 0));
          const set = (d) => { counts[b.id] = Math.max(0, (counts[b.id] || 0) + d); mode = "custom"; total = buckets.reduce((t, x) => t + (counts[x.id] || 0), 0); totalVal.textContent = String(total); drawRows(); drawModes(); };
          return el("div", { class: "pr-brow" }, [
            el("span", { class: "pr-bl" }, [b.label, el("i", { class: "pr-bbar", style: `--w:${((counts[b.id] || 0) / max) * 100}%` })]),
            el("span", { class: `pr-bv ${sgCls(c?.sgPer)}`, title: c?.n ? `${Math.round(c.n)} shots on course` : "No shots on course yet" }, c?.n ? SG(c.sgPer) : "—"),
            el("span", { class: `pr-bv ${sgCls(pr?.sgPer)}`, title: pr?.n ? `${pr.n} practice shots` : "Not practised yet" }, pr?.n ? SG(pr.sgPer) : "—"),
            el("span", { class: "pr-stepper sm" }, [stepBtn("−", () => set(-1), `Fewer at ${b.label}`), v, stepBtn("+", () => set(1), `More at ${b.label}`)]),
          ]);
        }),
      ]);
    };
    drawRows(); drawModes();
    const mixBox = el("div", { class: "pr-mixes" }, (MIXES[cat] || []).map((m) => {
      const box = el("div", { class: "pr-mix" });
      const drawMix = () => {
        const sum = Object.values(mixes[m.id]).reduce((a, b) => a + b, 0) || 1;
        mount(box, [el("span", { class: "rd-label" }, m.label), ...m.options.map(([k, l]) => {
          const val = el("span", { class: "pr-cnt" }, `${Math.round((mixes[m.id][k] / sum) * 100)}%`);
          const set = (d) => { mixes[m.id][k] = Math.max(0, mixes[m.id][k] + d); drawMix(); };
          return el("div", { class: "pr-mixrow" }, [el("span", {}, l), el("span", { class: "pr-stepper sm" }, [stepBtn("−", () => set(-5), `Less ${l}`), val, stepBtn("+", () => set(5), `More ${l}`)])]);
        })]);
      };
      drawMix();
      return box;
    }));
    const stimpIn = cat === "PUTT" ? el("input", { type: "number", inputmode: "decimal", min: 7, max: 15, step: 0.5, value: stimp, "aria-label": "Green speed (stimp)" }) : null;
    stimpIn?.addEventListener("input", () => { stimp = Number(stimpIn.value) || 11; });
    const go = el("button", { type: "button", class: "btn pr-go" }, "Build my session ▶");
    go.addEventListener("click", async () => {
      const plan = { cat, counts: { ...counts }, mixes, stimp };
      const shots = generateShots(plan);
      if (!shots.length) { flash?.("Add some shots first.", "error"); return; }
      const s = { id: newSessionId(), cat, status: "active", startedAt: new Date().toISOString(), plan: { counts: plan.counts, mixes, stimp, total: shots.length }, shots, playerKey: playerKey || myEntryKey(state), playerLabel: label };
      save(s);
      ctx.playSession(s);
    });
    const back = el("button", { type: "button", class: "link" }, "← Back");
    back.addEventListener("click", () => { view = { name: "home" }; draw(); });
    mount(body, [
      el("p", { class: "crumb" }, back),
      el("section", { class: "panel pr-plan" }, [
        el("div", { class: "pr-plan-head" }, [el("div", {}, [el("p", { class: "pr-eyebrow" }, `New session · ${CATS[cat].label}`), el("h1", {}, "Plan your session")]), totalBox]),
        el("div", { class: "pr-plan-grid" }, [
          el("div", {}, [el("div", { class: "pr-sub" }, [el("h2", {}, cat === "OTT" ? "Clubs" : "Distances"), modes]), rows,
            el("p", { class: "muted small" }, "On course and practice: strokes gained per shot against Tour average (0.00). “Focus on weak spots” puts more shots where you lose the most.")]),
          el("div", {}, [el("h2", {}, "Mix"), mixBox, stimpIn ? el("label", { class: "pr-stimp" }, [el("span", { class: "rd-label" }, "Green speed (stimp)"), stimpIn]) : null,
            el("p", { class: "muted small" }, "Every shot is drawn at random from this plan, in a random order, so no two in a row are the same.")]),
        ]),
        go,
      ]),
    ]);
  }

  /* =============================================== play a session (or a game) =============================================== */
  function drawPlay() {
    const s = view.session, shots = s.shots, game = s.mode === "game" ? gameById(s.gameId) : null;
    const at = Math.max(0, Math.min(shots.length - 1, view.at ?? 0));
    const shot = shots[at];
    const go = (i) => { view.at = Math.max(0, Math.min(shots.length - 1, i)); draw(); };
    const count = el("span", { class: "muted pr-count" });
    const prog = el("i");
    const right = el("strong", { class: "pr-sgsum" });
    const live = game ? el("div", { class: "pr-game-live", "aria-live": "polite" }) : null;
    const update = () => {
      const doneN = shots.filter((x) => x.result).length;
      count.textContent = `${doneN} / ${shots.length}`;
      prog.style.setProperty("--w", `${(doneN / shots.length) * 100}%`);
      if (game) {
        const g = gameProgress(game, s), pb = personalBest(game, sessions);
        right.textContent = `${fmtGameScore(game, g.score)} ${game.sg ? "SG" : game.unit === "makes" ? "made" : "pts"}`;
        live.className = `pr-game-live ${g.status}`;
        mount(live, [el("span", {}, [el("strong", {}, `Target ${fmtGameScore(game, game.target)}`), pb != null ? ` \u00b7 Best ${fmtGameScore(game, pb)}` : ""]), el("span", {}, g.need || "")]);
      } else right.textContent = SG(scored(shots).reduce((t, x) => t + x.sg, 0));
    };
    const finish = el("button", { type: "button", class: "btn ghost pr-finish" }, "Finish");
    finish.addEventListener("click", () => finishSession(s));
    const monitor = (shot.kind === "tee" || shot.kind === "green") && s.cat !== "ARG" ? monitorButton(s, at, (n) => { flash?.(`Filled ${n} shot${n === 1 ? "" : "s"} from the file.`, "ok"); draw(); }) : null;
    const card = shotCard({
      shot, stimp: s.plan?.stimp || 11, aim: aimFor(shot), eyebrow: `${game ? `${game.title} \u00b7 ` : ""}Shot ${at + 1} of ${shots.length}`,
      onPrev: at > 0 ? () => go(at - 1) : null, onNext: at < shots.length - 1 ? () => go(at + 1) : null,
      onResult: (r) => { shot.result = r || undefined; shot.sg = r ? scoreShot(shot) : null; save(s); update(); },
      next: at === shots.length - 1 ? { label: game ? "Finish game \u2713" : "Finish session \u2713", onClick: () => finishSession(s) } : { label: "Next shot \u203A", onClick: () => go(at + 1) },
      more: [monitor, finish], heat: ctx.heat,
    });
    const bar = el("div", { class: "pr-bar" }, [
      el("div", { class: "pr-bar-l" }, [el("strong", {}, game ? game.title : CATS[s.cat].label), count]),
      el("div", { class: "pr-prog" }, prog),
      el("div", { class: "pr-bar-r" }, [el("span", { class: "muted small" }, game ? "Score" : "Session"), right]),
    ]);
    const list = el("details", { class: "panel pr-list" }, [el("summary", {}, "Shot list"), el("ol", {}, shots.map((x, i) => {
      const li = el("li", { class: i === at ? "on" : "" }, [el("span", {}, shotTitle(x)), el("span", { class: sgCls(x.sg) }, x.result ? (game && !game.sg ? `${game.points(x)} pt` : SG(x.sg)) : "")]);
      li.addEventListener("click", () => go(i));
      return li;
    }))]);
    update();
    mount(body, [bar, live, card, list]);
  }

  async function finishSession(s) {
    const game = s.mode === "game" ? gameById(s.gameId) : null;
    const done = s.shots.filter((x) => x.result);
    if (!done.length) {
      if (!confirmAction(`No shots entered yet. Discard this ${game ? "game" : "session"}?`)) return;
      await ctx.remove(s.id);
      view = { name: "home" }; draw(); return;
    }
    const partial = done.length < s.shots.length;
    if (partial && !confirmAction(game ? `Finish with ${done.length} of ${s.shots.length} shots? An unfinished game doesn't count for your best.` : `Finish with ${done.length} of ${s.shots.length} shots? The rest are left out.`)) return;
    if (game) {
      const before = personalBest(game, sessions.filter((x) => x.id !== s.id));
      const g = gameProgress(game, s);
      s.game = { score: g.score, target: game.target, passed: !partial && (game.better === "low" ? g.score <= game.target : game.sg ? g.score > game.target : g.score >= game.target), complete: !partial,
        best: !partial && (before == null || (game.better === "low" ? g.score < before : g.score > before)) };
    }
    s.shots = done;
    s.status = "done";
    s.finishedAt = new Date().toISOString();
    const sm = summarize(s.cat, s.shots);
    s.summary = { n: sm.n, sg: sm.sg, sgPer: sm.sgPer };
    await save(s, true);
    view = { name: "summary", session: s }; draw();
  }

  /* =============================================== a session's (or game's) results =============================================== */
  async function drawSummary(s) {
    const game = s.mode === "game" ? gameById(s.gameId) : null;
    const sm = summarize(s.cat, s.shots);
    const course = await courseFor(s.cat).catch(() => ({}));
    const back = el("button", { type: "button", class: "link" }, "\u2190 Back");
    back.addEventListener("click", () => { view = { name: "home" }; draw(); });
    const del = el("button", { type: "button", class: "link danger" }, game ? "Delete game" : "Delete session");
    del.addEventListener("click", async () => { if (!confirmAction("Delete this? It can't be undone.")) return; await ctx.remove(s.id); view = { name: "home" }; draw(); });
    const again = el("button", { type: "button", class: "btn" }, game ? "\u21BB  Play again" : "\uFF0B  New session");
    again.addEventListener("click", async () => {
      if (game) { const m = await import("./practiceGames.js"); m.startGame(ctx, game); return; }
      view = { name: "plan" }; draw();
    });
    const shotRows = scored(s.shots).map((x) => el("tr", {}, [
      el("td", { class: "num" }, String(x.i)), el("td", {}, shotTitle(x)), el("td", { class: `num ${sgCls(x.sg)}` }, SG(x.sg)), el("td", {}, resultText(x)),
      game && !game.sg ? el("td", { class: "num" }, String(game.points(x))) : null,
    ]));
    const date = new Date(s.startedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    const hero = game
      ? el("section", { class: `panel pr-sum-hero pr-game-hero ${s.game?.passed ? "passed" : "failed"}` }, [
        el("div", {}, [el("p", { class: "pr-eyebrow" }, `${game.title} \u00b7 ${date}`),
          el("div", { class: "pr-big" }, [el("strong", {}, fmtGameScore(game, s.game?.score)), el("span", {}, game.sg ? "strokes gained" : game.unit)]),
          el("p", { class: "pr-verdict" }, [s.game?.passed ? "\u2713 Target beaten" : s.game?.complete === false ? "Unfinished" : "Target missed", ` (target ${fmtGameScore(game, game.target)})`, s.game?.best ? el("span", { class: "pr-pb" }, "New personal best") : ""]),
          el("p", { class: "muted" }, `${sm.n} shots \u00b7 ${SG(sm.sg)} strokes gained vs Tour average`)]),
        again])
      : el("section", { class: "panel pr-sum-hero" }, [
        el("div", {}, [el("p", { class: "pr-eyebrow" }, `${CATS[s.cat].label} \u00b7 ${date}`),
          el("div", { class: "pr-big" }, [el("strong", { class: sgCls(sm.sg) }, SG(sm.sg, 2)), el("span", {}, "strokes gained vs Tour average")]),
          el("p", { class: "muted" }, `${sm.n} shots \u00b7 ${SG(sm.sgPer)} a shot`)]),
        again]);
    mount(body, [
      el("p", { class: "crumb pr-crumb" }, [back, del]),
      hero,
      el("section", { class: "panel" }, [el("div", { class: "pr-tiles" }, keyTiles(s.cat, sm))]),
      game ? null : el("section", { class: "panel" }, [el("h2", {}, "By distance"), bucketTable(s.cat, sm.byBucket, course, true)]),
      patternPanel(s.cat, scored(s.shots), "Where they finished"),
      el("section", { class: "panel" }, [el("h2", {}, "Shot by shot"), el("div", { class: "table-scroll" }, el("table", { class: "plain pr-shots" }, [
        el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "#"), el("th", {}, "Shot"), el("th", { class: "num" }, "SG"), el("th", {}, "Result"), game && !game.sg ? el("th", { class: "num" }, "Pts") : null])), el("tbody", {}, shotRows)]))]),
    ]);
  }

  /* --------------------------------------------- pieces --------------------------------------------- */
  function monitorButton(s, at, done) {
    const input = el("input", { type: "file", accept: ".csv,text/csv", class: "visually-hidden" });
    input.addEventListener("change", async () => {
      const f = input.files[0]; input.value = "";
      if (!f) return;
      try {
        const rows = readLaunchMonitor(await f.text());
        // fill the shots without a result, in order, from this one on
        let k = 0;
        for (let i = at; i < s.shots.length && k < rows.length; i++) {
          const sh = s.shots[i];
          if (sh.result) continue;
          sh.result = resultFromMonitor(sh, rows[k++]); sh.sg = scoreShot(sh);
        }
        save(s, true);
        view.at = Math.min(s.shots.length - 1, at + k);
        done(k);
      } catch (err) { flash?.(err.message || "Couldn't read that file.", "error"); }
    });
    return el("label", { class: "btn ghost pr-monitor", title: "A CSV export from TrackMan or GCQuad (FSX): Carry / Total and Side or Offline columns" }, ["TrackMan / GCQuad file", input]);
  }
}

/* ===================================================== text ===================================================== */
const LEDE = {
  OTT: "Made-up holes with real trouble: a hard side, an easier side, fairway bunkers, and fairways from 24 to 40 yards wide.",
  APP: "Random distances and lies into greens with pins, bunkers and water, scored with strokes gained, with a map of where to aim.",
  ARG: "Chips, pitches and bunker shots to tucked and open pins, scored by how many strokes it leaves you.",
  PUTT: "Distances, breaks and slopes at random, with a read for each, scored by makes and the putt you leave.",
};
const HOW = {
  OTT: ["Pick how many drives, with which clubs, and the mix of fairway widths and trouble.", "Each tee shot gets its own hole. The aim map shows where the fewest strokes are, for your pattern.", "Tap where it finished, type the distance and how far off line, say it, or load a TrackMan / GCQuad file.", "See your fairways, misses, penalties and strokes gained against Tour average."],
  APP: ["Pick how many shots and how they're split across distances. Your on-course strokes gained shows for each.", "Mix in rough and bunker lies, and middle, corner and tucked pins.", "Tap where the ball finished on the green, type it, say it (“14 feet short”), or load a launch monitor file.", "See proximity, greens hit, strokes gained by distance and your pattern round the pin."],
  ARG: ["Pick how many shots, the distances and the mix of lies (fringe, rough, bunker).", "Pins range from lots of green to short-sided.", "Tap where it stopped, type it or say it.", "See proximity, up-and-down chances and strokes gained by distance."],
  PUTT: ["Pick how many putts, the distances, and the mix of breaks and slopes. Set the green speed.", "Each putt comes with a read: where to aim and how it plays.", "Tap where it stopped (or Made), type the leave or say it (“2 feet long”).", "See make %, speed, the putts you leave and the “pro side” on breaking putts."],
};
