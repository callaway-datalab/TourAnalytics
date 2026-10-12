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
import { CATS, CAT_ORDER, BUCKETS, MIXES, generateShots, distribute, teeResult, greenResult, scoreShot, bestAim, spreadFor, puttRead } from "../practice/model.js";
import { holeSvg, greenSvg, puttSvg, scatterSvg, driveScatterSvg, trendSvg, describePin } from "../practice/draw.js";
import { summarize, scored, personalSpread, courseByBucket, readLaunchMonitor, resultFromMonitor, resultFromSpeech } from "../practice/analysis.js";
import { listSessions, saveSession, deleteSession, newSessionId } from "../practice/store.js";
import { myEntryKey, myName } from "./dataEntry.js";

const SG = (v, dp = 2) => (v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}`);
const sgCls = (v) => (v == null ? "" : v >= 0.005 ? "pos" : v <= -0.005 ? "neg" : "");
const n1 = (v, u = "") => (v == null || Number.isNaN(v) ? "—" : `${Math.round(v * 10) / 10}${u}`);
const p0 = (v) => (v == null ? "—" : `${Math.round(v)}%`);
const LS_CAT = "ta:practice:cat";
const DEF_TOTAL = { OTT: 14, APP: 20, ARG: 20, PUTT: 24 };

export async function render(main, { flash }) {
  const state = getState();
  const uid = state.user.uid;
  const playerKey = state.profile?.clientKey || null;
  const label = state.profile?.name || myName(state);
  let cat = new URLSearchParams(location.hash.split("?")[1] || "").get("cat") || (() => { try { return localStorage.getItem(LS_CAT); } catch { return null; } })() || "APP";
  if (!CATS[cat]) cat = "APP";
  let sessions = [];
  let view = { name: "home" }; // home | plan | play | summary
  let lastKey = "";
  let saveTimer = null;
  let showHeat = true;
  const courseCache = new Map(); // cat -> { bucketId: { sgPer, n } }
  let roundsP = null;

  const pills = el("nav", { class: "pr-pills", "aria-label": "Practice category" });
  const body = el("div", { class: "pr-body" });
  mount(main, [el("div", { class: "pr-wrap" }, [pills, body])]);
  const drawPills = () => mount(pills, CAT_ORDER.map((c) => {
    const a = el("button", { type: "button", class: `pr-pill${c === cat ? " on" : ""}`, "aria-pressed": c === cat ? "true" : "false" }, [el("span", { class: "pr-pl-full" }, CATS[c].label), el("span", { class: "pr-pl-short", "aria-hidden": "true" }, c === "ARG" ? "Around Green" : CATS[c].label)]);
    a.addEventListener("click", () => { if (view.name === "play" && !confirmLeave()) return; cat = c; try { localStorage.setItem(LS_CAT, c); } catch { /* */ } view = { name: "home" }; drawPills(); draw(); });
    return a;
  }));
  const confirmLeave = () => true; // (a session in progress is saved as you go; you can pick it up again)

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

  drawPills(); mount(body, el("p", { class: "muted pr-loading" }, "Loading your practice\u2026"));
  try { sessions = await listSessions(uid); } catch (err) { console.error(err); flash?.("Couldn't load your practice sessions. Check your connection.", "error"); }
  drawPills(); draw();

  function draw() {
    // a new page or a new shot starts at the top
    const key = `${view.name}:${view.at ?? ""}:${cat}`;
    if (key !== lastKey) { lastKey = key; try { window.scrollTo({ top: 0 }); } catch { /* */ } }
    if (view.name === "plan") return drawPlan();
    if (view.name === "play") return drawPlay();
    if (view.name === "summary") return drawSummary(view.session);
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
      b.addEventListener("click", () => { view = { name: "play", session: active, at: active.shots.findIndex((s) => !s.result) }; draw(); });
      const x = el("button", { type: "button", class: "link danger" }, "Discard");
      x.addEventListener("click", async () => { if (!confirmAction("Discard this unfinished session?")) return; await deleteSession(uid, active.id).catch(() => {}); sessions = sessions.filter((s) => s.id !== active.id); draw(); });
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
      const row = el("button", { type: "button", class: "pr-sess" }, [
        el("span", { class: "pr-sess-d" }, new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })),
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
      sessions = [s, ...sessions];
      save(s);
      view = { name: "play", session: s, at: 0 };
      draw();
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

  /* =============================================== play a session =============================================== */
  function save(s, now = false) {
    clearTimeout(saveTimer);
    const run = () => saveSession(uid, s).catch((err) => { console.error(err); flash?.("Couldn't save the session just now. It'll try again with the next shot.", "error"); });
    if (now) return run();
    saveTimer = setTimeout(run, 700);
  }
  function drawPlay() {
    const s = view.session, shots = s.shots;
    let at = Math.max(0, Math.min(shots.length - 1, view.at ?? 0));
    const shot = shots[at];
    const doneN = shots.filter((x) => x.result).length;
    const sgSum = scored(shots).reduce((t, x) => t + x.sg, 0);
    const go = (i) => { view.at = Math.max(0, Math.min(shots.length - 1, i)); draw(); };
    const prev = el("button", { type: "button", class: "pr-nav", "aria-label": "Previous shot", disabled: at === 0 ? true : null }, "‹");
    prev.addEventListener("click", () => go(at - 1));
    const next = el("button", { type: "button", class: "pr-nav", "aria-label": "Next shot", disabled: at === shots.length - 1 ? true : null }, "›");
    next.addEventListener("click", () => go(at + 1));
    const finish = el("button", { type: "button", class: "btn ghost pr-finish" }, doneN === shots.length ? "See results" : "Finish");
    finish.addEventListener("click", () => finishSession(s));
    // personal pattern (once there's enough of it)
    const mineSpread = (() => {
      const p = personalSpread(cat, sessions, shot.kind === "tee" ? shot.club : null);
      if (!p) return null;
      return shot.kind === "tee" ? p : { sx: p.fx * shot.startDist, sy: p.fy * shot.startDist, n: p.n };
    })();
    const spread = mineSpread || spreadFor(shot);
    const carry = shot.kind === "tee" ? (BUCKETS.OTT.find((b) => b.id === shot.bucket)?.carry || 280) : null;
    const aim = shot.kind === "putt" ? null : bestAim(shot, spread, carry);
    const visual = el("div", { class: "pr-visual" });
    const resultLine = el("p", { class: "pr-result", "aria-live": "polite" });
    const setResult = (r) => {
      shot.result = r; shot.sg = scoreShot(shot);
      save(s);
      drawVisual(); drawResult(); drawInputs();
      bar.querySelector(".pr-sgsum").textContent = SG(scored(shots).reduce((t, x) => t + x.sg, 0), 2);
      bar.querySelector(".pr-count").textContent = `${shots.filter((x) => x.result).length} / ${shots.length}`;
    };
    const drawVisual = () => {
      const r = shot.result;
      if (shot.kind === "tee") mount(visual, holeSvg(shot, { aim, showHeat, carry, result: r && r.total != null ? r : null, onTap: (total, offline) => setResult({ ...teeResult(shot, total, offline), total, offline, source: "tap" }) }));
      else if (shot.kind === "putt") mount(visual, puttSvg(shot, { stimp: s.plan?.stimp || 11, result: r && r.x != null ? r : null, onTap: (x, y) => { const d = Math.round(Math.hypot(x, y) * 10) / 10; setResult(d <= 0.25 ? { lie: "Holed", dist: 0, unit: "ft", x: 0, y: 0, source: "tap" } : { lie: "Green", dist: d, unit: "ft", x, y, source: "tap" }); } }));
      else mount(visual, greenSvg(shot, { aim, showHeat, result: r && r.x != null ? r : null, onTap: (x, y) => setResult({ ...greenResult(shot, x, y), source: "tap" }) }));
    };
    const drawResult = () => {
      const r = shot.result;
      if (!r) { mount(resultLine, el("span", { class: "muted" }, shot.kind === "putt" ? "Tap where it stopped (or Made), type it, or say it." : "Tap where it finished, type it, or say it.")); return; }
      const sg = shot.sg;
      const where = shot.kind === "tee" ? `${r.zone || r.lie} · ${r.total} yds, ${Math.abs(r.offline)} ${r.offline < 0 ? "left" : r.offline > 0 ? "right" : "on line"}${r.penalty ? "" : ` · ${r.dist} to go`}`
        : r.lie === "Holed" ? "In the hole!" : r.penalty ? "Water · penalty stroke" : `${r.lie} · ${n1(r.dist)} ${r.unit}`;
      mount(resultLine, [el("span", {}, where), el("strong", { class: `pr-sgchip ${sgCls(sg)}` }, `${SG(sg)} SG`)]);
    };
    const inputs = el("div", { class: "pr-inputs" });
    const drawInputs = () => mount(inputs, inputsFor(shot, setResult, () => go(at + 1), at === shots.length - 1 ? () => finishSession(s) : null));
    drawVisual(); drawResult(); drawInputs();

    const heatBtn = el("button", { type: "button", class: `pr-toggle${showHeat ? " on" : ""}`, "aria-pressed": showHeat ? "true" : "false" }, "Aim map");
    heatBtn.addEventListener("click", () => { showHeat = !showHeat; heatBtn.classList.toggle("on", showHeat); heatBtn.setAttribute("aria-pressed", String(showHeat)); drawVisual(); });
    const monitor = (shot.kind === "tee" || shot.kind === "green") && cat !== "ARG" ? monitorButton(s, at, (n) => { flash?.(`Filled ${n} shot${n === 1 ? "" : "s"} from the file.`, "ok"); draw(); }) : null;
    const bar = el("div", { class: "pr-bar" }, [
      el("div", { class: "pr-bar-l" }, [el("strong", {}, CATS[cat].label), el("span", { class: "muted pr-count" }, `${doneN} / ${shots.length}`)]),
      el("div", { class: "pr-prog" }, el("i", { style: `--w:${(doneN / shots.length) * 100}%` })),
      el("div", { class: "pr-bar-r" }, [el("span", { class: "muted small" }, "Session"), el("strong", { class: "pr-sgsum" }, SG(sgSum))]),
    ]);
    const card = el("section", { class: "panel pr-shot" }, [
      el("div", { class: "pr-shot-head" }, [prev, el("div", { class: "pr-shot-t" }, [el("p", { class: "pr-eyebrow" }, `Shot ${at + 1} of ${shots.length}`), el("h2", {}, shotTitle(shot)), el("p", { class: "muted pr-shot-sub" }, shotSub(shot, aim, s.plan?.stimp, mineSpread))]), next]),
      el("div", { class: "pr-play" }, [
        el("div", { class: "pr-vis-col" }, [visual, el("div", { class: "pr-vis-tools" }, [heatBtn, el("span", { class: "muted small" }, legend(shot))])]),
        el("div", { class: "pr-in-col" }, [resultLine, inputs, el("div", { class: "pr-more" }, [monitor, finish])]),
      ]),
    ]);
    const list = el("details", { class: "panel pr-list" }, [el("summary", {}, "Shot list"), el("ol", {}, shots.map((x, i) => {
      const li = el("li", { class: i === at ? "on" : "" }, [el("span", {}, shotTitle(x)), el("span", { class: sgCls(x.sg) }, x.result ? SG(x.sg) : "")]);
      li.addEventListener("click", () => go(i));
      return li;
    }))]);
    mount(body, [bar, card, list]);
  }

  async function finishSession(s) {
    const done = s.shots.filter((x) => x.result);
    if (!done.length) {
      if (!confirmAction("No shots entered yet. Discard this session?")) return;
      await deleteSession(uid, s.id).catch(() => {});
      sessions = sessions.filter((x) => x.id !== s.id);
      view = { name: "home" }; draw(); return;
    }
    if (done.length < s.shots.length && !confirmAction(`Finish with ${done.length} of ${s.shots.length} shots? The rest are left out.`)) return;
    s.shots = done;
    s.status = "done";
    s.finishedAt = new Date().toISOString();
    const sm = summarize(s.cat, s.shots);
    s.summary = { n: sm.n, sg: sm.sg, sgPer: sm.sgPer };
    await save(s, true);
    view = { name: "summary", session: s }; draw();
  }

  /* =============================================== a session's results =============================================== */
  async function drawSummary(s) {
    const sm = summarize(s.cat, s.shots);
    const course = await courseFor(s.cat).catch(() => ({}));
    const back = el("button", { type: "button", class: "link" }, "← Practice");
    back.addEventListener("click", () => { view = { name: "home" }; draw(); });
    const del = el("button", { type: "button", class: "link danger" }, "Delete session");
    del.addEventListener("click", async () => { if (!confirmAction("Delete this session? This can't be undone.")) return; await deleteSession(uid, s.id).catch(() => {}); sessions = sessions.filter((x) => x.id !== s.id); view = { name: "home" }; draw(); });
    const again = el("button", { type: "button", class: "btn" }, "＋  New session");
    again.addEventListener("click", () => { view = { name: "plan" }; draw(); });
    const shotRows = scored(s.shots).map((x) => el("tr", {}, [
      el("td", { class: "num" }, String(x.i)), el("td", {}, shotTitle(x)), el("td", { class: `num ${sgCls(x.sg)}` }, SG(x.sg)), el("td", {}, resultText(x)),
    ]));
    mount(body, [
      el("p", { class: "crumb pr-crumb" }, [back, del]),
      el("section", { class: "panel pr-sum-hero" }, [
        el("div", {}, [el("p", { class: "pr-eyebrow" }, `${CATS[s.cat].label} · ${new Date(s.startedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`),
          el("div", { class: "pr-big" }, [el("strong", { class: sgCls(sm.sg) }, SG(sm.sg, 2)), el("span", {}, "strokes gained vs Tour average")]),
          el("p", { class: "muted" }, `${sm.n} shots · ${SG(sm.sgPer)} a shot`)]),
        again,
      ]),
      el("section", { class: "panel" }, [el("div", { class: "pr-tiles" }, keyTiles(s.cat, sm))]),
      el("section", { class: "panel" }, [el("h2", {}, "By distance"), bucketTable(s.cat, sm.byBucket, course, true)]),
      patternPanel(s.cat, scored(s.shots), "Where they finished"),
      el("section", { class: "panel" }, [el("h2", {}, "Shot by shot"), el("div", { class: "table-scroll" }, el("table", { class: "plain pr-shots" }, [
        el("thead", {}, el("tr", {}, [el("th", { class: "num" }, "#"), el("th", {}, "Shot"), el("th", { class: "num" }, "SG"), el("th", {}, "Result")])), el("tbody", {}, shotRows)]))]),
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
function shotTitle(x) {
  if (x.kind === "tee") return `${x.club} · ${x.hole}-yd par ${x.par}`;
  if (x.kind === "putt") return `${x.startDist} ft · ${x.breakDir === "lr" ? "left to right" : x.breakDir === "rl" ? "right to left" : "straight"}${x.slope !== "flat" ? `, ${x.slope}hill` : ""}`;
  return `${x.startDist} yds · ${x.startLie === "Bunker" ? (x.cat === "ARG" ? "greenside bunker" : "fairway bunker") : x.startLie.toLowerCase()}`;
}
function shotSub(x, aim, stimp, mine) {
  const pattern = mine ? ` Aim map uses your pattern (${mine.n} shots).` : "";
  if (x.kind === "tee") {
    const t = (side) => { const k = x.sides[side].kind; return k === "ob" ? "out of bounds" : k === "water" ? "water" : k === "trees" ? "trees" : k === "bunker" ? "waste area" : "rough"; };
    const a = aim ? (Math.abs(aim.x) < 1.5 ? "Aim at the middle of the fairway." : `Aim ${Math.round(Math.abs(aim.x))} yds ${aim.x < 0 ? "left" : "right"} of the middle.`) : "";
    return `${x.width}-yd fairway · ${t("left")} left, ${t("right")} right. ${a}${pattern}`;
  }
  if (x.kind === "putt") {
    const r = puttRead(x, stimp || 11);
    return `${r.aimIn ? `Aim about ${r.cups} cup${r.cups === 1 ? "" : "s"} ${r.aimSide} (${r.aimIn} in).` : "Straight: aim at the hole."}${r.plays ? ` Plays about ${Math.abs(r.plays)} ft ${r.plays > 0 ? "longer" : "shorter"}.` : ""} Stimp ${stimp || 11}.`;
  }
  const off = aim ? Math.hypot(aim.x - x.pin.x, aim.y - x.pin.y) : 0;
  const dir = aim ? [aim.y - x.pin.y > 1.5 ? "long" : aim.y - x.pin.y < -1.5 ? "short" : "", aim.x - x.pin.x > 1.5 ? "right" : aim.x - x.pin.x < -1.5 ? "left" : ""].filter(Boolean).join(" and ") : "";
  return `Pin ${describePin(x)}. ${off >= 2 && dir ? `Best aim: ${Math.round(off)} yds ${dir} of the pin.` : "Best aim: at the pin."}${pattern}`;
}
function legend(x) {
  if (x.kind === "putt") return "Arrows: the way it breaks. Gold ring: where to aim. Rings: 3 and 6 ft.";
  return "Green = fewest strokes left, red = most. Gold ring: best aim.";
}
function resultText(x) {
  const r = x.result;
  if (!r) return "";
  if (x.kind === "tee") return `${r.zone || r.lie}, ${r.total} yds, ${Math.abs(r.offline)} ${r.offline < 0 ? "L" : r.offline > 0 ? "R" : ""}`;
  if (r.lie === "Holed") return "Holed";
  if (r.penalty) return "Water";
  return `${r.lie}, ${n1(r.dist)} ${r.unit}`;
}
function tile(k, v, cls = "", sub = "") {
  return el("div", { class: "pr-tile" }, [el("span", { class: "pr-tile-k" }, k), el("strong", { class: cls }, v), sub ? el("span", { class: "pr-tile-s" }, sub) : null]);
}
function keyTiles(cat, s) {
  if (!s.n) return [];
  if (cat === "OTT") return [tile("Fairways", p0(s.fairwayPct)), tile("Avg distance", n1(s.avgTotal, " yds")), tile("Avg offline", n1(s.avgOffline, " yds"), "", s.leftPct != null ? `${Math.round(s.leftPct)}% left` : ""), tile("Penalties", p0(s.penaltyPct))];
  if (cat === "PUTT") return [tile("Made", p0(s.makePct)), tile("Avg leave", n1(s.avgLeave, " ft"), "", "misses"), tile("Within 3 ft", p0(s.within3Pct), "", "of misses"), tile("Long", p0(s.longPct), "", "of misses"), tile("Pro side", p0(s.proSidePct), "", "breaking misses")];
  return [tile(cat === "ARG" ? "On the green" : "Greens hit", p0(s.greenPct)), tile("Avg proximity", n1(s.avgProx, " ft")), tile("Median", n1(s.medProx, " ft")), tile("Long", p0(s.longPct)), ...(s.holed ? [tile("Holed", String(s.holed))] : [tile("Water", p0(s.penaltyPct))])];
}
function bucketTable(cat, rows, course, compact = false) {
  const metric = cat === "OTT" ? ["Fairways", (r) => p0(r.fairwayPct)] : cat === "PUTT" ? ["Made", (r) => p0(r.makePct)] : ["Proximity", (r) => n1(r.avgProx, " ft")];
  const body = rows.filter((r) => r.n || (!compact && course[r.id]?.n)).map((r) => {
    const c = course[r.id], gap = r.sgPer != null && c?.sgPer != null ? r.sgPer - c.sgPer : null;
    return el("tr", {}, [el("td", {}, r.label), el("td", { class: "num" }, String(r.n || "—")), el("td", { class: `num ${sgCls(r.sgPer)}` }, r.n ? SG(r.sgPer) : "—"),
      el("td", { class: "num" }, r.n ? metric[1](r) : "—"), el("td", { class: `num ${sgCls(c?.sgPer)}` }, c?.n ? SG(c.sgPer) : "—"), el("td", { class: `num pr-gap ${sgCls(gap)}` }, gap == null ? "—" : SG(gap))]);
  });
  if (!body.length) return el("p", { class: "muted" }, "No shots yet.");
  return el("div", { class: "table-scroll" }, el("table", { class: "plain pr-btable" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, cat === "OTT" ? "Club" : "Distance"), el("th", { class: "num" }, "Shots"), el("th", { class: "num" }, "SG / shot"), el("th", { class: "num" }, metric[0]), el("th", { class: "num" }, "On course"), el("th", { class: "num", title: "Practice minus on course" }, "Gap")])),
    el("tbody", {}, body),
  ]));
}
function patternPanel(cat, shots, title) {
  if (!shots.length) return null;
  let svg = null, cap = "";
  if (cat === "OTT") {
    const pts = shots.filter((s) => s.result.total != null).map((s) => ({ x: s.result.offline, y: s.result.total, good: s.result.lie === "Fairway" }));
    svg = driveScatterSvg(pts, { width: 32 }); cap = "Distance and how far off line. Green: in the fairway. The shaded band is a 32-yd fairway.";
  } else if (cat === "PUTT") {
    const pts = shots.filter((s) => s.result.x != null).map((s) => ({ x: s.result.x, y: s.result.y, good: s.result.lie === "Holed" }));
    if (!pts.length) return null;
    svg = scatterSvg(pts, { range: 8, unit: "ft", rings: [3, 6], label: "Where your putts finished" }); cap = "Where your putts stopped, the hole in the middle; up is long. Rings: 3 and 6 ft.";
  } else {
    const pts = shots.filter((s) => s.result.x != null).map((s) => ({ x: (s.result.x - s.pin.x) * 3, y: (s.result.y - s.pin.y) * 3, good: s.result.lie === "Green" || s.result.lie === "Holed" }));
    if (!pts.length) return null;
    const range = cat === "ARG" ? 30 : 60;
    svg = scatterSvg(pts, { range, unit: "ft", rings: cat === "ARG" ? [5, 10, 20] : [10, 20, 40], label: "Where your shots finished round the pin" }); cap = "Round the pin, in feet; up is long. Green: on the green.";
  }
  return el("section", { class: "panel pr-pattern" }, [el("h2", {}, title), el("div", { class: "pr-pat" }, svg), el("p", { class: "muted small" }, cap)]);
}

/* ===================================================== entering a result ===================================================== */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
function inputsFor(shot, setResult, next, finish) {
  const r = shot.result;
  const nextBtn = el("button", { type: "button", class: "btn pr-next", disabled: r ? null : true }, finish ? "Finish session ✓" : "Next shot ›");
  nextBtn.addEventListener("click", () => (finish ? finish() : next()));
  const say = SpeechRec ? (() => {
    const b = el("button", { type: "button", class: "btn ghost pr-say" }, "🎙 Say it");
    b.addEventListener("click", () => {
      const rec = new SpeechRec();
      rec.lang = navigator.language || "en-US"; rec.interimResults = false; rec.maxAlternatives = 3;
      b.textContent = "Listening…"; b.disabled = true;
      rec.onresult = (e) => {
        const alts = [...e.results[0]].map((a) => a.transcript);
        const got = alts.map((t) => resultFromSpeech(shot, t)).find(Boolean);
        if (got) setResult(got); else { b.textContent = `Didn’t catch “${alts[0]}”`; }
      };
      rec.onend = () => { b.disabled = false; if (b.textContent === "Listening…") b.textContent = "🎙 Say it"; };
      rec.onerror = () => { b.disabled = false; b.textContent = "🎙 Say it"; };
      try { rec.start(); } catch { b.disabled = false; }
    });
    return b;
  })() : null;
  const num = (val, label, attrs = {}) => el("input", { type: "text", inputmode: "decimal", value: val ?? "", "aria-label": label, placeholder: label, autocomplete: "off", ...attrs });
  if (shot.kind === "tee") {
    const tot = num(r?.total, "Total yds"), off = num(r?.offline != null ? Math.abs(r.offline) : "", "Offline yds");
    let side = r?.offline < 0 ? -1 : 1;
    const sideSeg = el("div", { class: "seg seg-sm pr-side" });
    const drawSide = () => mount(sideSeg, [[-1, "Left"], [1, "Right"]].map(([v, l]) => { const b = el("button", { type: "button", class: `seg-btn${side === v ? " on" : ""}` }, l); b.addEventListener("click", () => { side = v; drawSide(); apply(); }); return b; }));
    drawSide();
    const apply = () => { const t = Number(tot.value), o = Number(off.value || 0) * side; if (t >= 50) setResult({ ...teeResult(shot, Math.round(t), Math.round(o)), total: Math.round(t), offline: Math.round(o), source: "typed" }); };
    tot.addEventListener("change", apply); off.addEventListener("change", apply);
    return [el("div", { class: "pr-fields" }, [el("label", {}, [el("span", { class: "rd-label" }, "Total (yds)"), tot]), el("label", {}, [el("span", { class: "rd-label" }, "Offline (yds)"), off]), el("div", {}, [el("span", { class: "rd-label" }, "Side"), sideSeg])]),
      el("div", { class: "pr-actions" }, [say, nextBtn]), el("p", { class: "muted small pr-tip" }, "Say it like “285, 12 left”.")];
  }
  if (shot.kind === "putt") {
    const made = el("button", { type: "button", class: `btn ${r?.lie === "Holed" ? "" : "ghost"} pr-made` }, "✓ Made");
    made.addEventListener("click", () => setResult({ lie: "Holed", dist: 0, unit: "ft", x: 0, y: 0, source: "typed" }));
    const leave = num(r && r.lie !== "Holed" ? r.dist : "", "Feet");
    let dir = r?.y > 0 ? "long" : r?.y < 0 ? "short" : null;
    const dirSeg = el("div", { class: "seg seg-sm pr-dir" });
    const drawDir = () => mount(dirSeg, [["short", "Short"], ["long", "Long"], ["left", "Left"], ["right", "Right"]].map(([v, l]) => { const b = el("button", { type: "button", class: `seg-btn${dir === v ? " on" : ""}` }, l); b.addEventListener("click", () => { dir = v; drawDir(); apply(); }); return b; }));
    drawDir();
    const apply = () => {
      const d = Number(leave.value); if (!(d > 0)) return;
      const v = { short: [0, -1], long: [0, 1], left: [-1, 0], right: [1, 0] }[dir] || null;
      setResult({ lie: "Green", dist: d, unit: "ft", ...(v ? { x: v[0] * d, y: v[1] * d } : {}), source: "typed" });
    };
    leave.addEventListener("change", apply);
    return [el("div", { class: "pr-fields" }, [made, el("label", {}, [el("span", { class: "rd-label" }, "Missed by (ft)"), leave]), el("div", {}, [el("span", { class: "rd-label" }, "Which way"), dirSeg])]),
      el("div", { class: "pr-actions" }, [say, nextBtn]), el("p", { class: "muted small pr-tip" }, "Say “made it” or “2 feet long”.")];
  }
  // approach / around the green: the lie and the distance (or tap)
  let lie = r?.lie && r.lie !== "Penalty" ? r.lie : r?.penalty ? "Water" : null;
  const dist = num(r && r.lie !== "Holed" && !r.penalty ? r.dist : "", "Distance");
  const unitOf = (l) => (l === "Green" || l === "Fringe" ? "ft" : "yds");
  const unitTag = el("span", { class: "pr-unit" }, lie ? unitOf(lie) : "");
  const lieSeg = el("div", { class: "pr-lies" });
  const drawLie = () => mount(lieSeg, ["Green", "Fringe", "Fairway", "Rough", "Bunker", "Water", "Holed"].map((l) => {
    const b = el("button", { type: "button", class: `pr-chip${lie === l ? " on" : ""}` }, l);
    b.addEventListener("click", () => { lie = l; drawLie(); unitTag.textContent = unitOf(l); apply(true); });
    return b;
  }));
  drawLie();
  const apply = (fromLie = false) => {
    if (lie === "Holed") return setResult({ lie: "Holed", dist: 0, unit: "ft", x: shot.pin.x, y: shot.pin.y, source: "typed" });
    if (lie === "Water") return setResult({ lie: "Penalty", penalty: "water", dist: Number(dist.value) || Math.round(shot.startDist / 4), unit: "yds", source: "typed" });
    const d = Number(dist.value);
    if (!lie || !(d >= 0) || dist.value === "") { if (!fromLie) dist.focus(); return; }
    setResult({ lie, dist: d, unit: unitOf(lie), source: "typed" });
  };
  dist.addEventListener("change", () => apply());
  return [el("div", { class: "pr-fields col" }, [el("div", {}, [el("span", { class: "rd-label" }, "Finished on"), lieSeg]), el("label", { class: "pr-dist" }, [el("span", { class: "rd-label" }, "From the pin"), el("div", { class: "pr-dist-in" }, [dist, unitTag])])]),
    el("div", { class: "pr-actions" }, [say, nextBtn]), el("p", { class: "muted small pr-tip" }, "Say it like “green, 14 feet short” or “rough, 8 yards”.")];
}
