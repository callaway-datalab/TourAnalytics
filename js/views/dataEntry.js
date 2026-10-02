// Data Entry, for everyone (players, coaches, caddies, analysts, the admin).
//   #/entry                    your rounds + "Start a new round"
//   #/entry/new                round details, then the scorecard (typed in, or read from a photo)
//   #/entry/:player/:round     shot-by-shot entry, one hole at a time; then a summary
// Built phone-first: one column, big tap targets, chip pickers instead of dropdowns, number keypads,
// a sticky bottom bar, and every change saved automatically.
import { el, mount, formatWhen, confirmAction } from "../ui.js";
import { getState } from "../auth.js";
import { UserError } from "../store.js";
import { createRound, saveHole, updateRound, deleteRound, watchRound, watchPlayerRounds, watchMyRounds } from "../rounds.js";
import { LIES, END_LIES, unitFor, strokesGained, holeScore, roundToPrepared } from "../roundCalc.js";
import { readScorecard } from "../scorecardReader.js";
import { courseCombobox, courseHistory } from "../courseSearch.js";
import { getBag, clubLabel, clubRank, clubMake } from "../bag.js";
import { fmtSG, sgColor, CATEGORIES } from "../sg.js";

// Short lie names for the narrow shot bands (the full words are in the band's label).
const SHORT_LIE = { "Tee box": "Tee", Fairway: "Fwy", Rough: "Rgh", Bunker: "Bkr", Recovery: "Rec", Green: "Grn", Penalty: "Pen" };
const todayISO = () => new Date().toISOString().slice(0, 10);
const toPar = (n) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));

export async function render(main, { params, routeId, flash, previewClient }) {
  if (routeId === "entry-new") return renderNew(main, flash);
  if (routeId === "entry-round") return renderRound(main, params, flash, previewClient);
  return renderList(main);
}

/* ================================== whose rounds ================================== */
// Rounds are always the signed-in person's own: a player's, a coach's, an analyst's, or the admin's.
// Players and team members use their own key; the admin (who has no player key) gets "a_<uid>".
export function myEntryKey(state = getState()) {
  return state.isAdmin && !state.profile?.clientKey ? `a_${state.user.uid}` : state.profile?.clientKey;
}
export const myName = (state = getState()) => state.profile?.name || state.user?.displayName || state.user?.email?.split("@")[0] || "Me";

/* ======================================== round list ======================================== */
function renderList(main) {
  const state = getState();
  const myKey = myEntryKey(state);
  const list = el("div", { class: "entry-list" });
  mount(main, [
    el("div", { class: "entry-top" }, [
      el("a", { class: "btn entry-big", href: "#/entry/new" }, "\uFF0B Start a new round"),
    ]),
    list,
  ]);
  const draw = (rounds) => {
    if (!rounds.length) { mount(list, el("p", { class: "empty center" }, "No rounds yet. Start one above \u2014 it takes a minute to set up.")); return; }
    const row = (r) => {
      const { score, thru, par } = roundTotals(r);
      // ✕ deletes the round, only for rounds you entered yourself.
      const del = r.ownerUid === state.user.uid ? el("button", { type: "button", class: "entry-del", "aria-label": `Delete round at ${r.course || "this course"} on ${r.date}`, title: "Delete round" }, "\u2715") : null;
      del?.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!confirmAction(`Delete your round at ${r.course || "this course"} on ${r.date}, and every shot in it? This can't be undone.`)) return;
        del.disabled = true;
        try { await deleteRound(r.playerKey, r.id); } catch { del.disabled = false; alert("Couldn't delete that round. Try again."); }
      });
      const card = el("a", { class: "entry-card", href: `#/entry/${encodeURIComponent(r.playerKey)}/${r.id}` }, [
        el("div", { class: "entry-card-main" }, [
          el("strong", {}, r.course || "Round"),
          el("span", { class: "muted" }, [r.date, r.type ? ` \u00b7 ${r.type === "tournament" ? "Tournament" : "Practice"}` : "", r.location ? ` \u00b7 ${r.location}` : ""].join("")),
        ]),
        el("div", { class: "entry-card-score" }, r.status === "complete"
          ? [el("strong", {}, String(score)), el("span", { class: "muted" }, toPar(score - par))]
          : [el("strong", {}, thru ? toPar(score - parThru(r)) : "\u2014"), el("span", { class: "muted" }, thru ? `thru ${thru}` : "not started")]),
      ]);
      return el("div", { class: "entry-row" }, [card, del]);
    };
    const live = rounds.filter((r) => r.status !== "complete"), done = rounds.filter((r) => r.status === "complete");
    mount(list, [
      live.length ? el("h2", {}, "In progress") : null, ...live.map(row),
      done.length ? el("h2", {}, "Completed") : null, ...done.map(row),
    ]);
  };
  return watchPlayerRounds(myKey, draw); // only your own rounds; someone else's are deleted from inside their portal
}

function roundTotals(r) {
  let score = 0, thru = 0, par = 0;
  for (const h of r.holes || []) {
    par += h.par;
    const hs = holeScore(r.shots?.[`h${h.n}`]);
    if (hs.done) { score += hs.strokes; thru++; }
  }
  return { score, thru, par };
}
const parThru = (r) => (r.holes || []).filter((h) => holeScore(r.shots?.[`h${h.n}`]).done).reduce((a, h) => a + h.par, 0);

/* ======================================== new round ======================================== */
async function renderNew(main, flash) {
  const state = getState();
  const player = { key: myEntryKey(state), label: myName(state) }; // always your own round
  let holesCount = 18;
  let holes = blankHoles(18);

  // --- details ---
  const date = el("input", { type: "date", value: todayISO(), required: true });
  const course = el("input", { required: true, placeholder: "Start typing a course\u2026", autocomplete: "off", maxLength: 80, enterkeyhint: "next" });
  const locationIn = el("input", { placeholder: "e.g. La Jolla, CA", autocomplete: "off", maxLength: 80 });
  // Tees: also tells the scorecard reader which row of yardages to use.
  const teesIn = el("input", { list: "tee-names", placeholder: "e.g. Blue", autocomplete: "off", maxLength: 30, enterkeyhint: "done" });
  const teeNames = el("datalist", { id: "tee-names" }, ["Black", "Blue", "White", "Gold", "Green", "Red", "Silver", "Championship", "Tournament", "Back", "Middle", "Forward"].map((t) => el("option", { value: t })));
  let lastCard = null; // the photo, so changing Tees can re-read that tee's yardages
  // Tournament or Practice: two pills, exactly one picked.
  let roundType = "";
  const typePills = el("div", { class: "seg", role: "radiogroup", "aria-label": "Round type" });
  const tournamentIn = el("input", { placeholder: "e.g. Club Championship", autocomplete: "off", maxLength: 80, enterkeyhint: "next" });
  const tournamentField = el("label", { hidden: true }, ["Tournament name", tournamentIn]);
  const drawType = () => {
    typePills.querySelectorAll(".seg-btn").forEach((b) => { const on = b.dataset.v === roundType; b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false"); });
    tournamentField.hidden = roundType !== "tournament";
  };
  mount(typePills, [["tournament", "Tournament"], ["practice", "Practice"]].map(([v, l]) => {
    const b = el("button", { type: "button", role: "radio", class: "seg-btn", "data-v": v, "aria-checked": "false" }, l);
    b.addEventListener("click", () => { roundType = v; drawType(); if (v === "tournament" && !tournamentIn.value) tournamentIn.focus({ preventScroll: true }); });
    return b;
  }));
  drawType();

  // --- scorecard ---
  const grid = el("div", { class: "card-grid" });
  const totals = el("p", { class: "muted center card-totals" });
  const photoStatus = el("p", { class: "muted center", role: "status" });
  const photo = el("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden" });
  const photoBtn = el("label", { class: "btn ghost entry-big photo-btn" }, ["\uD83D\uDCF7  Read a scorecard photo", photo]);
  const photoHint = el("p", { class: "muted small center" }, "Fill in your Tees above first: the photo's yardages are read from that row.");
  const countPills = el("div", { class: "seg" });

  const drawCount = () => mount(countPills, [18, 9].map((n) => {
    const b = el("button", { type: "button", class: "seg-btn" + (holesCount === n ? " on" : ""), "aria-pressed": holesCount === n ? "true" : "false" }, `${n} holes`);
    b.addEventListener("click", () => { holesCount = n; holes = blankHoles(n).map((h, i) => ({ ...h, ...(holes[i] || {}), n: i + 1 })); drawCount(); drawGrid(); });
    return b;
  }));
  const drawTotals = () => {
    const par = holes.reduce((a, h) => a + (h.par || 0), 0), yds = holes.reduce((a, h) => a + (Number(h.yards) || 0), 0);
    totals.textContent = `Par ${par || "\u2014"} \u00b7 ${yds ? yds.toLocaleString() : "\u2014"} yds`;
  };
  const drawGrid = () => {
    mount(grid, holes.map((h, i) => {
      const parBtns = el("div", { class: "seg seg-sm", role: "group", "aria-label": `Hole ${h.n} par` }, [3, 4, 5].map((p) => {
        const b = el("button", { type: "button", class: "seg-btn" + (h.par === p ? " on" : ""), "aria-pressed": h.par === p ? "true" : "false" }, String(p));
        b.addEventListener("click", () => {
          holes[i].par = p;
          b.parentElement.querySelectorAll(".seg-btn").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on ? "true" : "false"); });
          drawTotals();
        });
        return b;
      }));
      const yards = el("input", { type: "number", inputmode: "numeric", min: 50, max: 750, placeholder: "yds", value: h.yards ?? "", "aria-label": `Hole ${h.n} yards` });
      yards.addEventListener("input", () => { holes[i].yards = yards.value === "" ? null : Number(yards.value); drawTotals(); });
      const hcp = el("input", { type: "number", inputmode: "numeric", min: 1, max: 18, placeholder: "hcp", value: h.hcp ?? "", "aria-label": `Hole ${h.n} handicap` });
      hcp.addEventListener("input", () => { holes[i].hcp = hcp.value === "" ? null : Number(hcp.value); });
      return el("div", { class: "card-row" }, [el("span", { class: "card-hole" }, String(h.n)), parBtns, yards, hcp]);
    }));
    drawTotals();
  };

  // Course: type-ahead from your past courses and OpenStreetMap; picking one fills the location, and a
  // course you've played before also refills its scorecard.
  const pastRounds = await new Promise((res) => { const un = watchPlayerRounds(player.key, (r) => { res(r); setTimeout(() => un(), 0); }); });
  const courseBox = courseCombobox(course, {
    history: courseHistory(pastRounds),
    onPick: (c) => {
      if (c.location) locationIn.value = c.location;
      if (c.tees && !teesIn.value) teesIn.value = c.tees;
      if (c.holes?.length) {
        holesCount = c.holes.length === 9 ? 9 : 18;
        holes = blankHoles(holesCount).map((h, i) => ({ ...h, ...(c.holes[i] || {}), n: i + 1 }));
        drawCount(); drawGrid();
        photoStatus.textContent = `Scorecard filled from your round here on ${c.date}. Check it's the same tees.`;
      }
    },
  });

  // Read the photo: pars, handicaps, and the yardages of the tees in the Tees box.
  // (window.__scorecardEngine lets a test supply the text reader.)
  let reading = false;
  async function readCard(file, { yardsOnly = false } = {}) {
    if (reading) return;
    reading = true;
    photoStatus.textContent = "Reading the scorecard\u2026";
    try {
      const read = await readScorecard(file, {
        tees: teesIn.value, holes: holesCount, engine: window.__scorecardEngine || null,
        onProgress: (p, what) => { photoStatus.textContent = `${what}\u2026 ${Math.round(p * 100)}%`; },
      });
      let found = 0;
      holes = holes.map((h, i) => {
        const next = { ...h };
        if (!yardsOnly && read.par[i]) { next.par = read.par[i]; found++; }
        if (read.yards[i]) { next.yards = read.yards[i]; found++; }
        if (!yardsOnly && read.hcp[i]) { next.hcp = read.hcp[i]; found++; }
        return next;
      });
      drawGrid();
      const total = holesCount * (yardsOnly ? 1 : 3);
      photoStatus.textContent = (found
        ? `Filled in ${found} of ${total} boxes from the photo${read.teeRow ? ` (yardages from the ${read.teeRow} row)` : ""}. Check them below and fix anything that's off.`
        : "Couldn't make out the numbers in that photo. Try a sharper, straight-on shot in good light, or type them in below.")
        + (read.notes.length ? ` ${read.notes.join(" ")}` : "");
    } catch (err) {
      console.error(err);
      photoStatus.textContent = "The scorecard reader isn't available right now. Type the holes in below.";
    } finally { reading = false; }
  }
  // Changing Tees after reading a photo re-reads that tee's yardages from the same photo.
  teesIn.addEventListener("change", () => { if (lastCard && teesIn.value.trim()) readCard(lastCard, { yardsOnly: true }); });
  photo.addEventListener("change", async () => {
    const f = photo.files[0];
    if (!f) return;
    lastCard = f;
    photo.value = "";
    await readCard(f);
  });

  const start = el("button", { class: "btn entry-big", type: "submit" }, "Start round \u25B6");
  const form = el("form", {
    class: "entry-form",
    onSubmit: async (e) => {
      e.preventDefault();
      if (!roundType) { flash("Pick Tournament or Practice.", "error"); typePills.querySelector("button")?.focus(); return; }
      if (roundType === "tournament" && !tournamentIn.value.trim()) { flash("Enter the tournament name.", "error"); tournamentIn.focus(); return; }
      if (!course.value.trim()) { flash("Enter the course.", "error"); course.focus(); return; }
      const missing = holes.filter((h) => !h.par).map((h) => h.n);
      if (missing.length) { flash(`Pick a par for hole${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`, "error"); return; }
      start.disabled = true;
      try {
        const id = await createRound({
          playerKey: player.key, playerLabel: player.label, ownerUid: state.user.uid, ownerName: state.profile?.name || state.user.email || "",
          date: date.value, course: course.value.trim(), location: locationIn.value.trim(), tees: teesIn.value.trim(), type: roundType, tournament: roundType === "tournament" ? tournamentIn.value.trim() : "",
          holes: holes.map((h) => ({ n: h.n, par: h.par, yards: h.yards ?? null, hcp: h.hcp ?? null })),
        });
        location.hash = `#/entry/${encodeURIComponent(player.key)}/${id}`;
      } catch (err) {
        console.error(err);
        flash(err instanceof UserError ? err.message : "Couldn't create the round. Check your connection and try again.", "error");
        start.disabled = false;
      }
    },
  }, [
    el("section", { class: "entry-section" }, [
      el("h2", {}, "Round details"),
      el("div", { class: "field" }, [el("span", { class: "field-label" }, "Round type"), typePills]),
      tournamentField,
      el("label", {}, ["Date", date]),
      el("label", { class: "course-label" }, ["Course", courseBox.node]),
      el("label", {}, ["Location (optional)", locationIn]),
      el("label", {}, ["Tees", teesIn, teeNames]),
    ]),
    el("section", { class: "entry-section" }, [
      el("h2", {}, "Scorecard"),
      countPills,
      photoBtn,
      photoHint,
      photoStatus,
      el("p", { class: "muted center small" }, "or tap in each hole's par, yardage and handicap:"),
      el("div", { class: "card-head" }, [el("span", {}, "#"), el("span", {}, "Par"), el("span", {}, "Yards"), el("span", {}, "Hcp")]),
      grid,
      totals,
    ]),
    el("div", { class: "entry-bar" }, start),
  ]);
  mount(main, [el("p", { class: "crumb" }, el("a", { href: "#/entry" }, "\u2190 Data Entry")), form]);
  drawCount(); drawGrid();
}
const blankHoles = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, par: null, yards: null, hcp: null }));

/* ===================================== entering a round ===================================== */
function renderRound(main, params, flash, previewClient) {
  const state = getState();
  const playerKey = decodeURIComponent(params.player);
  const roundId = params.round;
  let round = null;
  let holeIdx = 0;
  let strokes = [];           // the hole on screen, being edited
  let saveTimer = null;
  let firstLoad = true;
  const status = el("span", { class: "save-status", role: "status" });

  // Whoever entered a round can change or delete it. The admin can too, but only from inside that
  // player's portal (a preview), never from the admin's own pages.
  const canEdit = () => round && (round.ownerUid === state.user.uid || (state.isAdmin && previewClient?.key === playerKey));
  // Your clubs (WITB), for the optional Club on each shot.
  let bag = [];
  getBag(state.user.uid).then((clubs) => {
    bag = clubs.map((c) => ({ label: clubLabel(c), model: clubMake(c), cat: c.cat })).filter((c) => c.label).sort((a, b) => clubRank(a.label) - clubRank(b.label));
    if (round && holeIdx >= 0 && bag.length) drawHole();
  });
  const hole = () => round.holes[holeIdx];
  const key = (h) => `h${h.n}`;

  const unsub = watchRound(playerKey, roundId, (r) => {
    if (!r) { mount(main, el("p", { class: "empty center" }, "That round isn't available.")); return; }
    const editingNow = saveTimer !== null;
    round = r;
    if (firstLoad) {
      firstLoad = false;
      // Open on the first unfinished hole.
      const next = r.holes.findIndex((h) => !holeScore(r.shots?.[key(h)]).done);
      holeIdx = r.status === "complete" ? -1 : Math.max(0, next);
      loadHole();
      draw();
    } else {
      // A save coming back from the database. The database doesn't keep field order, so compare the
      // contents, not the text. Our own save (or anything while you're typing in this hole) only
      // refreshes the score and the hole strip, never the shots on screen.
      if (holeIdx < 0) { draw(); return; }
      const typing = editingNow || holeBox.contains(document.activeElement);
      if (typing || sameShots(r.shots?.[key(hole())], cleanStrokes())) { drawStrip(); updateScore(); return; }
      // Someone else (another device) really changed this hole: update it in place, keeping open shots
      // open and the page where it is.
      const wasOpen = strokes.map((x) => x.open);
      loadHole();
      strokes.forEach((x, j) => { if (wasOpen[j]) x.open = true; });
      drawHole(); updateScore();
    }
  });

  // Same shots, ignoring field order and how numbers were typed ("150" vs 150).
  function sameShots(a = [], b = []) {
    const canon = (list) => JSON.stringify((list || []).map((o) => Object.keys(o).sort()
      .filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "" && k !== "open")
      .map((k) => [k, /Dist$/.test(k) ? Number(o[k]) : o[k]])));
    return canon(a) === canon(b);
  }

  function loadHole() {
    if (holeIdx < 0) return;
    const h = hole();
    const saved = round.shots?.[key(h)];
    strokes = saved && saved.length ? saved.map((s) => ({ ...s })) : Array.from({ length: h.par }, () => blankStroke());
    if (!strokes[0].startLie) { strokes[0].startLie = "Tee box"; strokes[0].startDist = h.yards ?? ""; }
    chain();
    strokes.forEach((s) => { s.open = !isComplete(s); }); // finished shots start as summary bands
  }
  // A shot is complete once it has where it started, where it finished and how far was left.
  const isComplete = (s) => !!(s.startLie && s.startDist !== "" && s.startDist !== null && s.endLie
    && (s.endLie === "Holed" || (s.endDist !== "" && s.endDist !== null && s.endDist !== undefined)));
  const blankStroke = () => ({ startLie: "", startDist: "", endLie: "", endDist: "" });

  // Each shot starts where the one before it finished (unless it was changed by hand).
  function chain() {
    for (let i = 1; i < strokes.length; i++) {
      const prev = strokes[i - 1], s = strokes[i];
      if (s.manualStart) continue;
      if (prev.endLie && prev.endLie !== "Holed") {
        s.startLie = prev.endLie === "Penalty" ? (s.startLie || "Rough") : prev.endLie;
        s.startDist = prev.endLie === "Penalty" ? (s.startDist || prev.endDist || prev.startDist) : prev.endDist;
      }
    }
  }

  // Taps (lie chips, add/remove shot) redraw the hole. Typing a distance must NOT redraw, or the phone
  // keyboard would close after every digit, so it only updates the bits that depend on it.
  function changed(redraw = true, anchor = null) {
    chain();
    if (redraw) drawHole(anchor); else refreshDerived();
    if (!canEdit()) return;
    status.textContent = "Saving\u2026";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  const cleanStrokes = () => strokes.map(({ startLie, startDist, endLie, endDist, manualStart, club, clubMake, clubCat }) => ({
    ...(club ? { club } : {}), ...(club && clubMake ? { clubMake } : {}), ...(club && clubCat ? { clubCat } : {}),
    startLie, startDist: startDist === "" || startDist === null ? null : Number(startDist), endLie,
    endDist: endLie === "Holed" ? 0 : endDist === "" || endDist === null || endDist === undefined ? null : Number(endDist),
    ...(manualStart ? { manualStart: true } : {}),
  }));
  async function save() {
    const h = hole();
    const clean = cleanStrokes();
    try {
      await saveHole(playerKey, roundId, h.n, clean);
      status.textContent = "Saved \u2713";
    } catch (err) {
      console.error(err);
      status.textContent = "Not saved \u2014 check your connection";
    } finally { saveTimer = null; }
  }
  async function flushSave() { if (saveTimer) { clearTimeout(saveTimer); await save(); } }

  async function go(i) {
    await flushSave();
    const y = window.scrollY;
    holeIdx = i;
    loadHole();
    draw();
    window.scrollTo(0, y);
    // Stay put, unless the new hole's title would be above the screen: then bring just that into view.
    const title = main.querySelector(".hole-title, .round-summary");
    if (title && title.getBoundingClientRect().top < 0) window.scrollTo(0, window.scrollY + title.getBoundingClientRect().top - 12);
  }

  /* ---------- layout ---------- */
  const strip = el("nav", { class: "hole-strip", "aria-label": "Holes" });
  const holeBox = el("div", { class: "hole-box" });
  const bar = el("div", { class: "entry-bar entry-nav" });

  const scoreLine = el("span");
  function updateScore() {
    const { score, thru } = roundTotals(round);
    mount(scoreLine, [el("strong", {}, thru ? toPar(score - parThru(round)) : "E"),
      el("span", { class: "muted" }, thru === round.holes.length ? ` \u00b7 ${score} total` : ` \u00b7 thru ${thru}`)]);
  }
  function draw() {
    updateScore();
    const head = el("header", { class: "round-head" }, [
      el("p", { class: "crumb" }, el("a", { href: "#/entry" }, "\u2190 Data Entry")),
      el("h1", {}, round.course || "Round"),
      el("p", { class: "muted" }, [round.type ? (round.type === "tournament" ? `${round.tournament || "Tournament"} \u00b7 ` : "Practice round \u00b7 ") : "", round.date, round.location ? ` \u00b7 ${round.location}` : "", round.tees ? ` \u00b7 ${round.tees} tees` : ""].join("")),
      el("p", { class: "round-score" }, [scoreLine, " ", status]),
      canEdit() ? null : el("p", { class: "muted small" }, `Entered by ${round.ownerName || "someone else"} \u2014 view only.`),
    ]);
    if (holeIdx < 0) { mount(main, [head, summary()]); return; }
    mount(main, [head, strip, holeBox, bar]);
    drawStrip(); drawHole(); drawBar();
  }

  function drawStrip() {
    let running = 0; // score to par through each hole (finished holes only)
    mount(strip, [...round.holes.map((h, i) => {
      const hs = holeScore(i === holeIdx ? strokes : round.shots?.[key(h)]);
      const diff = hs.done ? hs.strokes - h.par : null;
      if (hs.done) running += diff;
      // Outline: grey par, green birdie, lime eagle or better, orange bogey, red double bogey or worse.
      const tone = !hs.done ? "" : diff <= -2 ? " eagle" : diff === -1 ? " birdie" : diff === 0 ? " par" : diff === 1 ? " bogey" : " double";
      const b = el("button", { type: "button", class: "hole-chip" + (i === holeIdx ? " on" : "") + (hs.done ? " done" : "") + tone,
        "aria-current": i === holeIdx ? "step" : null, "aria-label": hs.done ? `Hole ${h.n}: ${scoreName(diff)}, ${toPar(running)} through ${h.n}` : `Hole ${h.n}` }, [
        el("span", { class: "hc-n" }, String(h.n)),
        el("small", { class: "hc-res" }, hs.done ? shortScore(diff) : "\u00a0"),
        el("small", { class: "hc-tot" }, hs.done ? toPar(running) : "\u00a0"),
      ]);
      b.addEventListener("click", () => go(i));
      return b;
    }), (() => { const b = el("button", { type: "button", class: "hole-chip sum" }, [el("span", {}, "\u2211"), el("small", {}, "card")]); b.addEventListener("click", () => go(-1)); return b; })()]);
    requestAnimationFrame(() => {
      const on = strip.querySelector(".hole-chip.on");
      if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2; // sideways only, never the page
    });
  }

  // Redraw the hole without moving the screen: the shot you're working on (anchor) stays exactly where it
  // was, and the box you were typing in keeps focus.
  function drawHole(anchor = null) {
    const h = hole();
    const ro = !canEdit();
    const hs = holeScore(strokes);
    const anchorEl = anchor !== null ? holeBox.querySelector(`[data-i="${anchor}"]`) : null;
    const before = anchorEl ? anchorEl.getBoundingClientRect().top : null;
    const y = window.scrollY;
    const act = document.activeElement;
    const actCard = act?.closest?.("[data-i]")?.dataset.i, actRole = act?.dataset?.role;
    holeBox.style.minHeight = `${holeBox.offsetHeight}px`;
    mount(holeBox, [
      el("div", { class: "hole-title" }, [
        el("h2", {}, `Hole ${h.n}`),
        el("p", {}, [`Par ${h.par}`, h.yards ? ` \u00b7 ${h.yards} yds` : "", h.hcp ? ` \u00b7 Hcp ${h.hcp}` : ""].join("")),
        hs.done ? el("p", { class: "hole-result" }, `${hs.strokes} \u00b7 ${scoreName(hs.strokes - h.par)}`) : null,
      ]),
      ...strokes.map((s, i) => strokeCard(s, i, ro)),
      ro ? null : el("div", { class: "shot-tools" }, [
        (() => { const b = el("button", { type: "button", class: "btn ghost add-shot" }, "\uFF0B Add a shot"); b.addEventListener("click", () => { strokes.push({ ...blankStroke(), open: true }); changed(true, strokes.length - 1); }); return b; })(),
        strokes.length > 1 ? (() => { const b = el("button", { type: "button", class: "link danger" }, "Remove last shot"); b.addEventListener("click", () => { strokes.pop(); changed(); }); return b; })() : null,
      ]),
    ]);
    const after = anchor !== null ? holeBox.querySelector(`[data-i="${anchor}"]`) : null;
    if (before !== null && after) window.scrollTo(0, y + after.getBoundingClientRect().top - before);
    else window.scrollTo(0, y);
    if (actRole && actCard !== undefined) holeBox.querySelector(`[data-i="${actCard}"] input[data-role="${actRole}"]`)?.focus({ preventScroll: true });
    // If the hole got shorter (shots folded), keep just enough room below that the page can't snap upward.
    requestAnimationFrame(() => { holeBox.style.minHeight = `${Math.max(0, window.innerHeight - holeBox.getBoundingClientRect().top)}px`; });
    drawStrip();
  }

  // Fold finished shots (other than the one being worked on) into bands, in place, so the shot you're
  // on doesn't move and its keyboard stays open.
  function collapseOthers(i) {
    const keep = holeBox.querySelector(`[data-i="${i}"]`);
    const before = keep ? keep.getBoundingClientRect().top : null;
    let changedAny = false;
    strokes.forEach((x, j) => {
      if (j === i || !x.open || !isComplete(x)) return;
      x.open = false; changedAny = true;
      holeBox.querySelector(`[data-i="${j}"]`)?.replaceWith(strokeCard(x, j, !canEdit()));
    });
    if (changedAny && keep && before !== null) window.scrollBy(0, keep.getBoundingClientRect().top - before);
  }

  function refreshDerived() {
    holeBox.querySelectorAll(".shot-band").forEach((band) => {
      const j = Number(band.dataset.i);
      if (strokes[j]) band.replaceWith(strokeCard(strokes[j], j, !canEdit()));
    });
    holeBox.querySelectorAll(".shot-card").forEach((card) => {
      const s = strokes[Number(card.dataset.i)];
      if (!s) return;
      const start = card.querySelector('input[data-role="start"]');
      if (start && document.activeElement !== start && String(start.value) !== String(s.startDist ?? "")) start.value = s.startDist ?? "";
      card.querySelectorAll(".chips")[0]?.querySelectorAll(".chip").forEach((c) => {
        const on = c.textContent === s.startLie;
        c.classList.toggle("on", on); c.setAttribute("aria-checked", on ? "true" : "false");
      });
      const units = card.querySelectorAll(".unit");
      if (units[0]) units[0].textContent = unitFor(s.startLie);
      const sg = strokesGained(s);
      const tag = card.querySelector(".shot-sg");
      tag.textContent = sg === null ? "" : `${fmtSG(sg)} SG`;
      tag.style.color = sg === null ? "" : sgColor(sg);
    });
    holeBox.querySelectorAll(".shot-card").forEach((card) => {
      const s = strokes[Number(card.dataset.i)];
      const done = card.querySelector(".done-shot");
      if (s && done) done.disabled = !isComplete(s);
    });
    const hs = holeScore(strokes), h = hole();
    const res = holeBox.querySelector(".hole-result");
    if (res && hs.done) res.textContent = `${hs.strokes} \u00b7 ${scoreName(hs.strokes - h.par)}`;
  }

  // Club for a shot: your WITB clubs, or a nudge to fill out WITB.
  function clubPicker(s, ro) {
    if (!bag.length) {
      return s.club ? el("p", { class: "club-note" }, s.club)
        : el("p", { class: "muted small club-note" }, ["Fill out ", el("a", { href: "#/witb" }, "WITB"), " in the Account section to track club usage."]);
    }
    // The shot keeps the club, its brand / model and its group, so stats can sort by any of them.
    const inBag = bag.findIndex((c) => c.label === s.club && (c.model || "") === (s.clubMake || ""));
    const sel = el("select", { class: "club-select", "aria-label": "Club", disabled: ro }, [
      el("option", { value: "" }, "\u2014"),
      ...bag.map((c, i) => el("option", { value: String(i), selected: i === inBag }, c.model ? `${c.label} \u00b7 ${c.model}` : c.label)),
      ...(s.club && inBag < 0 ? [el("option", { value: "kept", selected: true }, s.clubMake ? `${s.club} \u00b7 ${s.clubMake}` : s.club)] : []),
    ]);
    sel.addEventListener("change", () => {
      if (sel.value === "kept") return;
      const c = bag[Number(sel.value)];
      s.club = c?.label || undefined; s.clubMake = c?.model || undefined; s.clubCat = c?.cat || undefined;
      changed(false);
    });
    return sel;
  }

  function strokeCard(s, i, ro) {
    const sg = strokesGained(s);
    if (!s.open && isComplete(s)) {
      // Narrow summary band; tap to open it again.
      const u1 = unitFor(s.startLie), u2 = unitFor(s.endLie === "Penalty" ? s.startLie : s.endLie);
      const full = `${s.startLie} ${s.startDist} ${u1} \u2192 ${s.endLie === "Holed" ? "Holed" : `${s.endLie} ${s.endDist} ${u2}`}`;
      const short = (l) => SHORT_LIE[l] || l, su = (u) => (u === "yds" ? "y" : "ft");
      const band = el("button", { type: "button", class: "shot-band", "data-i": String(i), "aria-expanded": "false", "aria-label": `Shot ${i + 1}: ${full}. Tap to edit.`, title: full }, [
        el("span", { class: "band-n" }, String(i + 1)),
        el("span", { class: "band-text" }, `${s.club ? `${s.club} \u00b7 ` : ""}${short(s.startLie)} ${s.startDist}${su(u1)} \u2192 ${s.endLie === "Holed" ? "Holed" : `${short(s.endLie)} ${s.endDist}${su(u2)}`}`),
        el("span", { class: "band-sg", style: sg === null ? "" : `color:${sgColor(sg)}` }, sg === null ? "" : fmtSG(sg)),
        el("span", { class: "band-edit", "aria-hidden": "true" }, "\u270E"),
      ]);
      band.addEventListener("click", () => { s.open = true; drawHole(i); });
      return band;
    }
    const chips = (lies, value, onPick, label) => el("div", { class: "chips", role: "radiogroup", "aria-label": label }, lies.map((l) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": value === l ? "true" : "false", class: "chip" + (value === l ? " on" : "") + (l === "Holed" ? " holed" : l === "Penalty" ? " pen" : ""), disabled: ro }, l);
      b.addEventListener("click", () => onPick(l));
      return b;
    }));
    const distInput = (value, unit, onInput, label, role) => {
      const inp = el("input", { type: "number", inputmode: "decimal", min: 0, step: "any", value: value ?? "", placeholder: "0", disabled: ro, "aria-label": label, "data-role": role, enterkeyhint: "next" });
      inp.addEventListener("input", () => onInput(inp.value));
      // "Next" on the phone keyboard jumps to the next distance box.
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const all = [...holeBox.querySelectorAll(".dist input:not([disabled])")];
        const nxt = all[all.indexOf(inp) + 1];
        if (nxt) { nxt.focus(); nxt.select?.(); } else inp.blur();
      });
      return el("div", { class: "dist" }, [inp, el("span", { class: "unit" }, unit)]);
    };
    const after = strokes.slice(0, i).some((x) => x.endLie === "Holed");
    const card = el("section", { class: "shot-card" + (after ? " after-holed" : ""), "data-i": String(i) }, [
      el("div", { class: "shot-head" }, [
        el("h3", {}, `Shot ${i + 1}`),
        el("span", { class: "shot-sg", style: sg === null ? "" : `color:${sgColor(sg)}`, title: "Strokes gained (placeholder numbers)" }, sg === null ? "" : `${fmtSG(sg)} SG`),
      ]),
      after ? el("p", { class: "muted small" }, "This comes after the ball was holed \u2014 remove it if it's extra.") : null,
      el("p", { class: "shot-label" }, "Club (optional)"),
      clubPicker(s, ro),
      el("p", { class: "shot-label" }, "From"),
      chips(LIES, s.startLie, (l) => { s.startLie = l; s.manualStart = i > 0; changed(true, i); }, `Shot ${i + 1} starting lie`),
      distInput(s.startDist, unitFor(s.startLie), (v) => { s.startDist = v; s.manualStart = i > 0; changed(false); }, `Shot ${i + 1} starting distance`, "start"),
      el("p", { class: "shot-label" }, "To"),
      chips(END_LIES, s.endLie, (l) => {
        s.endLie = l;
        if (l === "Holed") { s.endDist = 0; strokes = strokes.slice(0, i + 1); } // holed: any later shots are removed
        else if (s.endDist === 0) s.endDist = "";
        changed(true, i);
      }, `Shot ${i + 1} result`),
      s.endLie === "Holed" ? el("p", { class: "holed-note" }, "\u26F3 In the hole") : distInput(s.endDist, unitFor(s.endLie === "Penalty" ? s.startLie : s.endLie), (v) => { s.endDist = v; changed(false); }, `Shot ${i + 1} distance left`, "end"),
      // Done is always there; it switches on as soon as the shot has a start, a finish and the distance left.
      ro ? null : (() => {
        const d = el("button", { type: "button", class: "btn ghost done-shot", disabled: !isComplete(s), title: "Fill in where it finished to fold this shot" }, "Done \u2713");
        d.addEventListener("click", () => { if (!isComplete(s)) return; s.open = false; drawHole(i); });
        return d;
      })(),
    ]);
    // Starting on another shot folds the finished ones away (without moving this one).
    return card; // a shot folds into a band only when you tap Done
  }

  function drawBar() {
    const last = holeIdx === round.holes.length - 1;
    // "◀ Hole 6" / "Hole 8 ▶": no Prev on the first hole; the last hole finishes the round instead.
    const prev = holeIdx === 0 ? el("span", { class: "bar-spacer", "aria-hidden": "true" })
      : el("button", { type: "button", class: "btn ghost" }, `\u25C0 Hole ${round.holes[holeIdx - 1].n}`);
    if (holeIdx > 0) prev.addEventListener("click", () => go(holeIdx - 1));
    const next = el("button", { type: "button", class: "btn" }, last ? (canEdit() ? "Finish round \u2713" : "Scorecard") : `Hole ${round.holes[holeIdx + 1].n} \u25B6`);
    next.addEventListener("click", async () => {
      if (last && canEdit()) {
        await flushSave();
        const open = round.holes.filter((h, i) => !holeScore(i === holeIdx ? strokes : round.shots?.[key(h)]).done).map((h) => h.n);
        if (open.length && !confirmAction(`Hole${open.length > 1 ? "s" : ""} ${open.join(", ")} ${open.length > 1 ? "aren't" : "isn't"} finished. Finish the round anyway?`)) return;
        try { await updateRound(playerKey, roundId, { status: "complete" }); } catch { flash("Couldn't finish the round. Try again.", "error"); return; }
        go(-1);
      } else go(last ? -1 : holeIdx + 1);
    });
    mount(bar, [prev, el("span", { class: "bar-mid" }, `${holeIdx + 1} / ${round.holes.length}`), next]);
  }

  function summary() {
    const p = roundToPrepared({ ...round, id: roundId });
    const per = (cat) => p.shots.filter((s) => !cat || s.cat === cat).reduce((a, s) => a + s.sg, 0);
    const { score, par, thru } = roundTotals(round);
    const thruAll = thru === round.holes.length;
    const rows = round.holes.map((h) => {
      const hs = holeScore(round.shots?.[key(h)]);
      return el("tr", {}, [el("td", {}, String(h.n)), el("td", { class: "num" }, String(h.par)), el("td", { class: "num" }, h.yards ? String(h.yards) : "\u2014"),
        el("td", { class: "num" + (hs.done ? (hs.strokes < h.par ? " good" : hs.strokes > h.par ? " bad" : "") : "") }, hs.done ? String(hs.strokes) : "\u2014")]);
    });
    const del = canEdit() ? el("button", { type: "button", class: "link danger" }, "Delete this round") : null;
    del?.addEventListener("click", async () => {
      if (!confirmAction("Delete this round and every shot in it? This can't be undone.")) return;
      try { await deleteRound(playerKey, roundId); location.hash = "#/entry"; } catch { flash("Couldn't delete the round.", "error"); }
    });
    const reopen = canEdit() && round.status === "complete" ? el("button", { type: "button", class: "btn ghost" }, "Edit shots") : null;
    reopen?.addEventListener("click", async () => { await updateRound(playerKey, roundId, { status: "in-progress" }); go(0); });
    return el("div", { class: "round-summary" }, [
      el("div", { class: "sg-cards" }, [["", "SG: Total"], ...CATEGORIES.map(([k, l]) => [k, `SG: ${l}`])].map(([k, l]) => {
        const v = per(k);
        return el("div", { class: "sg-card" }, [el("h3", {}, l), el("p", { class: "sg-value", style: `color:${sgColor(v)}` }, fmtSG(v))]);
      })),
      el("p", { class: "muted small center" }, "Strokes gained for entered rounds uses placeholder numbers for now. Full charts: Stats \u2192 Entered Rounds."),
      el("div", { class: "table-scroll" }, el("table", { class: "plain stats" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Hole"), el("th", { class: "num" }, "Par"), el("th", { class: "num" }, "Yds"), el("th", { class: "num" }, "Score")])),
        el("tbody", {}, rows),
        el("tfoot", {}, el("tr", {}, [el("td", {}, "Total"), el("td", { class: "num" }, String(par)), el("td", {}),
          el("td", { class: "num" }, thruAll ? `${score} (${toPar(score - par)})` : `${score} thru ${thru} (${toPar(score - parThru(round))})`)])),
      ])),
      el("div", { class: "entry-top" }, [round.status === "complete" ? reopen : (() => { const b = el("button", { type: "button", class: "btn" }, "Back to the holes"); b.addEventListener("click", () => go(Math.max(0, round.holes.findIndex((h) => !holeScore(round.shots?.[key(h)]).done)))); return b; })(), del]),
    ]);
  }

  const onLeave = () => { if (saveTimer) { clearTimeout(saveTimer); save(); } };
  window.addEventListener("pagehide", onLeave);
  return () => { onLeave(); unsub(); window.removeEventListener("pagehide", onLeave); };
}

// Short names for the hole chips.
const shortScore = (d) => ({ "-3": "Albatross", "-2": "Eagle", "-1": "Birdie", 0: "Par", 1: "Bogey", 2: "Dbl Bogey", 3: "Tpl Bogey" }[d] ?? (d < -3 ? "Condor" : `+${d}`));
const scoreName = (d) => ({ "-3": "Albatross", "-2": "Eagle", "-1": "Birdie", 0: "Par", 1: "Bogey", 2: "Double bogey", 3: "Triple bogey" }[d] ?? (d > 0 ? `+${d}` : String(d)));
