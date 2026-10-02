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
import { readScorecard, readScorecardFromTaps, rotateImage, analyzeCard } from "../scorecardReader.js";
import { courseCombobox, courseHistory } from "../courseSearch.js";
import { getBag, clubLabel, clubRank, clubMake } from "../bag.js";
import { parseShots } from "../voiceShots.js";
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
  let roundType = "practice"; // Practice unless you pick Tournament
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
  const tapBtn = el("button", { type: "button", class: "link tap-btn", hidden: true }, "\uD83D\uDC46 Check the rows on the photo");
  // Tees: a dropdown of the tees found on the card (each fills its yardages), or type your own.
  let cardTees = []; // [{ name, yards }] from the last photo
  const teeSelect = el("select", { "aria-label": "Tees from the card", hidden: true });
  const teesBox = el("div", { class: "tees-box" }, [teeSelect, teesIn, teeNames]);
  const drawTeeSelect = () => {
    teeSelect.hidden = !cardTees.length;
    teesIn.hidden = !!cardTees.length && teeSelect.value !== "__own";
    if (!cardTees.length) return;
    const cur = teeSelect.value;
    mount(teeSelect, [
      el("option", { value: "" }, "Pick your tees\u2026"),
      ...cardTees.map((t, i) => el("option", { value: String(i), selected: cur === String(i) }, `${t.name} \u00b7 ${t.yards.reduce((a, v) => a + (v || 0), 0).toLocaleString()} yds`)),
      el("option", { value: "__own", selected: cur === "__own" }, "Other (type them)"),
    ]);
  };
  const applyTee = (i) => {
    const t = cardTees[i];
    if (!t) return;
    teesIn.value = t.name;
    holes = holes.map((h, j) => ({ ...h, yards: t.yards[j] ?? h.yards }));
    drawGrid();
  };
  teeSelect.addEventListener("change", () => {
    if (teeSelect.value === "__own") { teesIn.value = ""; drawTeeSelect(); teesIn.focus(); return; }
    applyTee(Number(teeSelect.value)); drawTeeSelect();
  });
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

  // Read the photo: pars, handicaps and every tee row (each tee goes in the Tees dropdown).
  // (window.__scorecardEngine lets a test supply the text reader.)
  let reading = false;
  function applyRead(read) {
    let found = 0;
    holes = holes.map((h, i) => {
      const next = { ...h };
      if (read.par[i]) { next.par = read.par[i]; found++; }
      if (read.hcp[i]) { next.hcp = read.hcp[i]; found++; }
      return next;
    });
    cardTees = (read.tees || []).filter((t) => t.yards.some(Boolean));
    found += cardTees.reduce((n, t) => n + t.yards.filter(Boolean).length, 0);
    // keep the tees you'd already typed if the card has them; one tee: pick it
    const typed = teesIn.value.trim().toLowerCase();
    const match = cardTees.findIndex((t) => t.name.toLowerCase() === typed || t.name.toLowerCase().split(" ")[0] === typed);
    const pickI = match >= 0 ? match : cardTees.length === 1 ? 0 : -1;
    drawTeeSelect();
    if (pickI >= 0) { teeSelect.value = String(pickI); applyTee(pickI); drawTeeSelect(); } else drawGrid();
    return found;
  }
  async function runRead(fn, what) {
    if (reading) return;
    reading = true;
    photoStatus.textContent = `${what}\u2026`;
    try {
      const read = await fn((p, label) => { photoStatus.textContent = `${label}\u2026 ${Math.round(p * 100)}%`; });
      if (read.upright) lastUpright = read.upright; // a sideways photo, turned upright: use that for pointing too
      const found = read.found ? applyRead(read) : 0;
      const teeLine = cardTees.length ? ` Found ${cardTees.length} set${cardTees.length > 1 ? "s" : ""} of tees: pick yours in Tees below.` : "";
      photoStatus.textContent = (found
        ? `Filled in ${found} boxes from the photo.${teeLine} Check them and fix anything that's off.`
        : "Couldn't make out the card on its own. Tap \u201cPoint to the rows on the photo\u201d to show it where the rows are, or type the holes in below.")
        + (found && read.notes.length ? ` ${read.notes.join(" ")}` : ""); // (nothing found: the first sentence says it)
      tapBtn.hidden = false;
    } catch (err) {
      console.error(err);
      photoStatus.textContent = "The scorecard reader isn't available right now. Type the holes in below.";
    } finally { reading = false; }
  }
  let lastAnalysis = null;
  // From the table you confirmed: its numbers as they are, or (after changes) read again from your rows.
  const readFromTable = (taps, src, ready) => runRead(async (onProgress) => {
    if (ready) return ready;
    const read = await readScorecardFromTaps(src, { taps, holes: holesCount, engine: window.__scorecardEngine || null, onProgress });
    // keep the editor's table in step with what was read
    if (lastAnalysis) {
      const par = lastAnalysis.rows.find((r) => r.kind === "par"), hcp = lastAnalysis.rows.find((r) => r.kind === "hcp");
      if (par) { par.values = read.par; par.readAs = "par"; }
      if (hcp) { hcp.values = read.hcp; hcp.readAs = "hcp"; }
      lastAnalysis.rows.filter((r) => r.kind === "tee").forEach((r, i) => { r.values = read.tees[i]?.yards || null; r.readAs = "tee"; });
      lastAnalysis.notes = read.notes;
    }
    return read;
  }, "Reading the rows you confirmed");
  async function readCard(file) {
    if (reading) return;
    reading = true;
    photoStatus.textContent = "Reading everything on the card\u2026";
    try {
      lastAnalysis = await analyzeCard(file, { holes: holesCount, engine: window.__scorecardEngine || null, onProgress: (p, label) => { photoStatus.textContent = `${label}\u2026 ${Math.round(p * 100)}%`; } });
      if (lastAnalysis.rotation) lastUpright = lastAnalysis.src;
      photoStatus.textContent = "Check the rows and columns on the photo, then tap \u201cUse these rows\u201d.";
      tapBtn.hidden = false;
    } catch (err) { console.error(err); photoStatus.textContent = "The scorecard reader isn't available right now. Type the holes in below."; reading = false; return; }
    reading = false;
    openCardEditor(lastAnalysis, holesCount, readFromTable);
  }
  let lastUpright = null;
  tapBtn.addEventListener("click", () => {
    if (lastAnalysis) openCardEditor(lastAnalysis, holesCount, readFromTable);
    else if (lastCard) openTapper(lastUpright || lastCard, holesCount, (taps, src) => readFromTable(taps, src));
  });
  photo.addEventListener("change", async () => {
    const f = photo.files[0];
    if (!f) return;
    lastCard = f; lastUpright = null;
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
    ]),
    el("section", { class: "entry-section" }, [
      el("h2", {}, "Scorecard"),
      countPills,
      photoBtn,
      photoStatus,
      tapBtn,
      el("label", { class: "tees-label" }, ["Tees", teesBox]),
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
    bag = clubs.map((c) => ({ label: clubLabel(c), model: clubMake(c), cat: c.cat, type: c.type })).filter((c) => c.label).sort((a, b) => clubRank(a.label) - clubRank(b.label));
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
      ro ? null : voiceBox(),
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

  // Voice input: say how the hole went; it's written down (your phone's speech recognition, or your
  // keyboard's 🎤 / typing where that isn't available), turned into shots, and fills the hole when you tap Fill in.
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let voiceOpen = false, voiceText = "", listening = null;
  function voiceBox() {
    const btn = el("button", { type: "button", class: "btn ghost voice-btn", "aria-expanded": voiceOpen ? "true" : "false" }, "\uD83C\uDF99 Voice input");
    btn.addEventListener("click", () => { voiceOpen = !voiceOpen; if (!voiceOpen) stopListening(); drawHole(); if (voiceOpen && SpeechRec && !voiceText) startListening(); });
    if (!voiceOpen) return el("div", { class: "voice" }, btn);
    const text = el("textarea", { class: "voice-text", rows: 4, placeholder: "e.g. Driver to the fairway, 180 left. 6 iron on the green, 15 feet. Missed the putt, 3 feet left, then made it.", "aria-label": "What happened on this hole" }, voiceText);
    text.value = voiceText;
    const preview = el("ol", { class: "voice-preview" });
    const notes = el("p", { class: "muted small voice-notes" });
    const showParse = () => {
      const r = parseShots(text.value, { bag });
      const unit = (lie) => (lie === "Green" ? "ft" : "yds");
      mount(preview, r.shots.map((p) => el("li", {}, [
        el("strong", {}, p.club || p.saidClub || "Shot"), " \u2192 ",
        p.endLie === "Holed" ? "In the hole" : `${p.endLie || "?"}${p.endDist != null ? `, ${p.endDist} ${unit(p.endLie)} left` : ""}`,
      ])));
      notes.textContent = r.notes.join(" ");
      fill.disabled = !r.shots.length;
      return r;
    };
    text.addEventListener("input", () => { voiceText = text.value; showParse(); });
    const mic = SpeechRec ? el("button", { type: "button", class: "btn ghost voice-mic" + (listening ? " on" : "") }, listening ? "\u25A0 Stop" : "\uD83C\uDF99 Speak") : null;
    mic?.addEventListener("click", () => { if (listening) stopListening(); else startListening(); });
    const fill = el("button", { type: "button", class: "btn" }, "Fill in the hole");
    fill.addEventListener("click", () => applyVoice(showParse()));
    const cancel = el("button", { type: "button", class: "link" }, "Close");
    cancel.addEventListener("click", () => { voiceOpen = false; stopListening(); drawHole(); });
    const box = el("div", { class: "voice open" }, [
      el("p", { class: "muted small" }, SpeechRec ? (listening ? "Listening\u2026 say how the hole went, then tap Stop." : "Tap Speak and say how the hole went, or type it.") : "Type how the hole went, or use your keyboard\u2019s \uD83C\uDF99 to dictate."),
      text, el("div", { class: "voice-actions" }, [mic, fill, cancel]), preview, notes,
    ]);
    queueMicrotask(showParse);
    return box;
  }
  function startListening() {
    if (!SpeechRec || listening) return;
    const rec = new SpeechRec();
    rec.lang = navigator.language || "en-US"; rec.continuous = true; rec.interimResults = true;
    const before = voiceText ? `${voiceText.trim()} ` : "";
    rec.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      voiceText = before + said;
      const ta = holeBox.querySelector(".voice-text");
      if (ta) { ta.value = voiceText; ta.dispatchEvent(new Event("input")); }
    };
    rec.onend = () => { listening = null; if (voiceOpen) drawHole(); };
    rec.onerror = (e) => { listening = null; flash(e.error === "not-allowed" ? "Allow the microphone for this site to use voice input (or type it instead)." : "Voice input stopped. Try again, or type it.", "error"); if (voiceOpen) drawHole(); };
    try { rec.start(); listening = rec; } catch { listening = null; }
    if (voiceOpen) drawHole();
  }
  function stopListening() { try { listening?.stop(); } catch { /* already stopped */ } listening = null; }
  function applyVoice(r) {
    if (!r.shots.length) return;
    const h = hole();
    strokes = r.shots.map((p, i) => ({
      ...blankStroke(), open: true,
      ...(i === 0 ? { startLie: "Tee box", startDist: h.yards ?? "" } : {}),
      endLie: p.endLie || "", endDist: p.endDist ?? "",
      ...(p.club ? { club: p.club, clubMake: p.clubMake, clubCat: p.clubCat } : {}),
    }));
    // "…hit 7 iron from 160": that's how far the shot before left you
    r.shots.forEach((p, i) => { if (p.startDist != null && i > 0 && (strokes[i - 1].endDist === "" || strokes[i - 1].endDist == null)) strokes[i - 1].endDist = p.startDist; });
    stopListening(); voiceOpen = false; voiceText = "";
    changed(true);
    flash(`Filled in ${strokes.length} shot${strokes.length === 1 ? "" : "s"} from what you said. Check them below.`, "ok");
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
        d.addEventListener("click", () => {
          if (!isComplete(s)) return;
          s.open = false; drawHole(i);
          // Bring the next shot to the top of the screen, ready to fill in.
          const next = holeBox.querySelector(`[data-i="${i + 1}"]`);
          // (on a computer the header stays pinned at the top, so land just below it)
          const rail = document.querySelector(".rail");
          const pinned = rail && ["sticky", "fixed"].includes(getComputedStyle(rail).position) ? Math.max(0, rail.getBoundingClientRect().bottom) : 0;
          if (next) window.scrollTo({ top: window.scrollY + next.getBoundingClientRect().top - pinned - 8, behavior: "smooth" });
        });
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

/* ======================= pointing to the rows on a scorecard photo ======================= */
// A full-screen view of the photo. You tap the 1, 9, 10 and 18 in the Hole row (1 and 9 for a nine-hole
// card), then the Par row, the Handicap row and each tee row. onDone gets the taps in the photo's own pixels.
function openTapper(source, holes, onDone) {
  let src = source; // a File, or a canvas (a photo already turned upright)
  let url = null;
  const show = async () => {
    if (url) URL.revokeObjectURL(url);
    const blob = src instanceof HTMLCanvasElement ? await new Promise((r) => src.toBlob(r, "image/jpeg", 0.92)) : src;
    url = URL.createObjectURL(blob);
    img.src = url;
  };
  const steps = [
    { key: "h1", say: "Tap the 1 in the Hole row" },
    { key: "h9", say: "Tap the 9 in the Hole row" },
    ...(holes === 18 ? [{ key: "h10", say: "Tap the 10 in the Hole row" }, { key: "h18", say: "Tap the 18 in the Hole row" }] : []),
    { key: "par", say: "Tap anywhere on the Par row" },
    { key: "hcp", say: "Tap anywhere on the Handicap row", optional: true },
    { key: "tees", say: "Tap each tee row you might play from, then Done", many: true },
  ];
  const taps = { tees: [] };
  const order = []; // for Undo
  let i = 0, zoom = 1;
  const say = el("p", { class: "tap-say", role: "status" });
  const img = el("img", { alt: "Your scorecard photo", draggable: "false" });
  const marks = el("div", { class: "tap-marks", "aria-hidden": "true" });
  const stage = el("div", { class: "tap-stage" }, [img, marks]);
  const scroller = el("div", { class: "tap-scroll" }, stage);
  const undo = el("button", { type: "button", class: "btn ghost" }, "Undo");
  const skip = el("button", { type: "button", class: "btn ghost" }, "Skip");
  const done = el("button", { type: "button", class: "btn" }, "Done");
  const cancel = el("button", { type: "button", class: "link", "aria-label": "Close" }, "Cancel");
  const zin = el("button", { type: "button", class: "btn ghost tap-zoom", "aria-label": "Zoom in" }, "+");
  const zout = el("button", { type: "button", class: "btn ghost tap-zoom", "aria-label": "Zoom out" }, "\u2212");
  const rot = el("button", { type: "button", class: "btn ghost", "aria-label": "Turn the photo a quarter turn", title: "Turn the photo" }, "\u27F3 Rotate");
  const overlay = el("div", { class: "tapper", role: "dialog", "aria-modal": "true", "aria-label": "Point to the rows on your scorecard" }, [
    el("div", { class: "tap-top" }, [say, el("div", { class: "tap-actions" }, [rot, zout, zin, undo, skip, done, cancel])]),
    scroller,
  ]);
  const label = { h1: "1", h9: "9", h10: "10", h18: "18", par: "Par", hcp: "Hcp" };
  const draw = () => {
    const st = steps[Math.min(i, steps.length - 1)];
    say.textContent = i >= steps.length ? "All set: tap Done to read the card." : `${i + 1} of ${steps.length}: ${st.say}${st.many && taps.tees.length ? ` (${taps.tees.length} so far)` : ""}`;
    skip.hidden = !(st.optional && i < steps.length);
    done.hidden = !(st.many && taps.tees.length);
    undo.disabled = !order.length;
    stage.style.width = `${zoom * 100}%`;
    const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
    mount(marks, [
      ...["h1", "h9", "h10", "h18", "par", "hcp"].filter((k) => taps[k]).map((k) => el("span", { class: "tap-dot" + (["par", "hcp"].includes(k) ? " row" : ""), style: `left:${(taps[k].x / W) * 100}%;top:${(taps[k].y / H) * 100}%` }, label[k])),
      ...taps.tees.map((t, n) => el("span", { class: "tap-dot row tee", style: `left:${(t.x / W) * 100}%;top:${(t.y / H) * 100}%` }, `Tee ${n + 1}`)),
    ]);
  };
  img.addEventListener("click", (e) => {
    if (i >= steps.length) return;
    const r = img.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * img.naturalWidth, y: ((e.clientY - r.top) / r.height) * img.naturalHeight };
    const st = steps[i];
    if (st.many) { taps.tees.push(p); order.push("tees"); }
    else { taps[st.key] = p; order.push(st.key); i++; }
    draw();
  });
  undo.addEventListener("click", () => {
    const k = order.pop();
    if (!k) return;
    if (k === "tees") taps.tees.pop();
    else if (k.startsWith("skip:")) i = steps.findIndex((s) => s.key === k.slice(5));
    else { delete taps[k]; i = steps.findIndex((s) => s.key === k); }
    draw();
  });
  skip.addEventListener("click", () => { order.push(`skip:${steps[i].key}`); i++; draw(); });
  // Turn the photo a quarter turn (clockwise); taps start again.
  rot.addEventListener("click", async () => {
    const bmp = src instanceof HTMLCanvasElement ? src : await createImageBitmap(src);
    src = rotateImage(bmp, 90);
    for (const k of Object.keys(taps)) if (k !== "tees") delete taps[k];
    taps.tees.length = 0; order.length = 0; i = 0;
    await show(); draw();
  });
  zin.addEventListener("click", () => { zoom = Math.min(4, zoom * 1.5); draw(); });
  zout.addEventListener("click", () => { zoom = Math.max(1, zoom / 1.5); draw(); });
  const close = () => { overlay.remove(); if (url) URL.revokeObjectURL(url); document.removeEventListener("keydown", onKey); document.body.classList.remove("tapping"); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  cancel.addEventListener("click", close);
  done.addEventListener("click", () => { const t = { ...taps, tees: [...taps.tees] }, used = src; close(); onDone(t, used); });
  img.addEventListener("load", draw);
  document.addEventListener("keydown", onKey);
  document.body.classList.add("tapping");
  document.body.appendChild(overlay);
  show(); draw();
}

/* ======================= checking the card as a table ======================= */
// The photo with the reader's table on top: a band for each row of numbers (labelled Hole, Par,
// Handicap, a tee, or Ignore; tap a label to change it, drag ⇕ to move a row), a guide for each hole
// column (drag the 1, 9, 10 and 18 to move them; the rest follow), and the number read at each crossing.
// If the Hole row wasn't found you first tap the 1, 9, 10 and 18. "Use these rows" hands back taps for
// readScorecardFromTaps (in the photo's own pixels).
const KIND_LABEL = { hole: "Hole", par: "Par", hcp: "Handicap", tee: "Tee", ignore: "Ignore" };
function openCardEditor(an, holes, onConfirm) {
  const W = an.width, H = an.height, slope = an.slope || 0;
  let refX = an.refX || 0, rows = an.rows.map((r, i) => ({ ...r, id: r.id ?? i, readAs: r.readAs ?? (r.values ? r.kind : null) })), anchors = an.anchors ? { ...an.anchors } : null;
  // (on a phone the card starts zoomed in, so the rows and numbers are big enough to tap; scroll sideways)
  let zoom = window.innerWidth < 700 ? 2.5 : 1, showWords = false, adding = false, placing = anchors ? null : 0, menuFor = null, drag = null, colsMoved = false;
  const PLACE = holes === 18 ? ["h1", "h9", "h10", "h18"] : ["h1", "h9"];
  const PLACE_SAY = { h1: "the 1", h9: "the 9", h10: "the 10", h18: "the 18" };
  if (!anchors) anchors = {};
  const yAt = (r, x) => r.y + slope * (x - refX);
  const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  const colPt = (k) => (k <= 9 ? lerp(anchors.h1, anchors.h9, (k - 1) / 8) : lerp(anchors.h10, anchors.h18, (k - 10) / 8));
  const haveCols = () => PLACE.every((k) => anchors[k]);
  const pct = (x, y) => `left:${(x / W) * 100}%;top:${(y / H) * 100}%`;
  const isNum = (t) => /^\d{1,4}$/.test(t) || /^\d{1,2}\/\d{1,2}$/.test(t);
  const spacing = () => (haveCols() ? Math.hypot(anchors.h9.x - anchors.h1.x, anchors.h9.y - anchors.h1.y) / 8 : an.spacing || W / 30);
  // the number read nearest each crossing (live, so it follows your drags)
  const valueAt = (x, y) => {
    let best = null, bd = Infinity;
    for (const w of an.words) {
      if (!isNum(w.text)) continue;
      const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, d = Math.hypot((cx - x) / spacing(), (cy - y) / (an.rowH * 0.6));
      if (d < bd && Math.abs(cx - x) < spacing() * 0.5 && Math.abs(cy - y) < an.rowH * 0.45) { bd = d; best = w.text.split("/")[0]; }
    }
    return best;
  };

  const url = an.src instanceof HTMLCanvasElement ? null : URL.createObjectURL(an.src);
  const img = el("img", { alt: "Your scorecard", draggable: "false" });
  if (url) img.src = url; else an.src.toBlob((b) => { img.src = URL.createObjectURL(b); }, "image/jpeg", 0.92);
  const layer = el("div", { class: "ce-layer" });
  const stage = el("div", { class: "tap-stage ce-stage" }, [img, layer]);
  const scroller = el("div", { class: "tap-scroll" }, stage);
  const say = el("p", { class: "tap-say", role: "status" });
  const zin = el("button", { type: "button", class: "btn ghost tap-zoom", "aria-label": "Zoom in" }, "+");
  const zout = el("button", { type: "button", class: "btn ghost tap-zoom", "aria-label": "Zoom out" }, "\u2212");
  const wordsBtn = el("button", { type: "button", class: "btn ghost", "aria-pressed": "false" }, "Show all words");
  const addBtn = el("button", { type: "button", class: "btn ghost" }, "+ Add a row");
  const useBtn = el("button", { type: "button", class: "btn" }, "Use these rows");
  const cancel = el("button", { type: "button", class: "link" }, "Cancel");
  const overlay = el("div", { class: "tapper card-editor", role: "dialog", "aria-modal": "true", "aria-label": "Check the rows and columns on your scorecard" }, [
    el("div", { class: "tap-top" }, [say, el("div", { class: "tap-actions" }, [zout, zin, wordsBtn, addBtn, useBtn, cancel])]),
    scroller,
  ]);

  function draw() {
    stage.style.width = `${zoom * 100}%`;
    const parts = [];
    if (placing != null) say.textContent = `The Hole row wasn't found: tap ${PLACE_SAY[PLACE[placing]]} in the Hole row (${placing + 1} of ${PLACE.length}).`;
    else if (adding) say.textContent = "Tap the photo where the new row is.";
    else say.textContent = "Check the rows and columns: tap a label to change it, drag \u21D5 to move a row, drag 1 / 9 / 10 / 18 to line up the columns.";
    useBtn.disabled = placing != null;
    // all the words read (optional)
    if (showWords) for (const w of an.words) parts.push(el("span", { class: "ce-word", style: `${pct(w.x0, w.y0)};width:${((w.x1 - w.x0) / W) * 100}%;height:${((w.y1 - w.y0) / H) * 100}%`, title: w.text }, el("i", {}, w.text)));
    // row bands
    for (const r of rows) {
      const y0 = yAt(r, 0), y1 = yAt(r, W);
      const angle = Math.atan2(y1 - y0, W) * 180 / Math.PI;
      const chip = el("button", { type: "button", class: `ce-chip k-${r.kind}`, "aria-label": `Row: ${r.kind === "tee" ? `Tee ${r.name}` : KIND_LABEL[r.kind]}. Change it` },
        r.kind === "tee" ? `Tee \u00b7 ${r.name || "?"}` : KIND_LABEL[r.kind]);
      chip.addEventListener("click", (e) => { e.stopPropagation(); menuFor = menuFor === r.id ? null : r.id; draw(); });
      const grip = el("span", { class: "ce-grip", title: "Drag to move this row", "aria-hidden": "true" }, "\u21D5");
      grip.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); drag = { type: "row", id: r.id }; grip.setPointerCapture?.(e.pointerId); });
      // the label and its drag handle sit together at the left, so both stay in reach when zoomed in
      const band = el("div", { class: `ce-row k-${r.kind}`, style: `left:0;top:${(y0 / H) * 100}%;height:${(an.rowH / H) * 100}%;transform:translateY(-50%) rotate(${angle}deg)` },
        el("div", { class: "ce-handle" }, [chip, grip]));
      parts.push(band);
      if (menuFor === r.id) parts.push(kindMenu(r, y0));
      // the digital table: the number read at each hole
      if (haveCols() && r.kind !== "ignore") for (let k = 1; k <= holes; k++) {
        const c = colPt(k), yy = yAt(r, c.x);
        const v = r.kind === "hole" ? String(k) : r.values && !colsMoved ? (r.values[k - 1] != null ? String(r.values[k - 1]) : null) : valueAt(c.x, yy);
        parts.push(el("span", { class: "ce-val" + (v ? "" : " missing"), style: pct(c.x, yy) }, v || "?"));
      }
    }
    // hole columns
    if (haveCols()) for (let k = 1; k <= holes; k++) {
      const c = colPt(k), handle = anchors[`h${k}`] && ["h1", "h9", "h10", "h18"].includes(`h${k}`);
      parts.push(el("div", { class: "ce-col", style: `left:${(c.x / W) * 100}%` }));
      const tag = el("span", { class: "ce-hole" + (handle ? " handle" : ""), style: pct(c.x, c.y), title: handle ? "Drag to line up the columns" : "" }, String(k));
      if (handle) tag.addEventListener("pointerdown", (e) => { e.preventDefault(); drag = { type: "anchor", key: `h${k}` }; tag.setPointerCapture?.(e.pointerId); });
      parts.push(tag);
    }
    for (const k of PLACE) if (anchors[k] && !haveCols()) parts.push(el("span", { class: "ce-hole handle", style: pct(anchors[k].x, anchors[k].y) }, k.slice(1)));
    mount(layer, parts);
  }

  function kindMenu(r, y0) {
    const pick = (kind) => {
      if (kind === "hole") rows.forEach((o) => { if (o.kind === "hole") o.kind = "ignore"; });
      if ((kind === "par" || kind === "hcp")) rows.forEach((o) => { if (o.kind === kind && o.id !== r.id) o.kind = "ignore"; });
      if (r.kind !== kind) r.values = kind === r.readAs ? r.values : null; // a new job for this row: read it as that
      r.kind = kind;
      if (kind === "hole" && haveCols()) { // the columns' numbers move to this row
        const dy = (k) => yAt(r, anchors[k].x) - anchors[k].y;
        for (const k of PLACE) anchors[k] = { x: anchors[k].x, y: anchors[k].y + dy(k) };
      }
      menuFor = null; draw();
    };
    const nameIn = el("input", { value: r.name || cleanTee(r.label), placeholder: "Tee name (e.g. Blue)", maxLength: 40, "aria-label": "Tee name" });
    const teeGo = el("button", { type: "button", class: "btn" }, "Tee");
    teeGo.addEventListener("click", () => { r.name = nameIn.value.trim() || "Tees"; pick("tee"); });
    const opts = ["hole", "par", "hcp", "ignore"].map((k) => { const b = el("button", { type: "button", class: `ce-opt k-${k}` }, KIND_LABEL[k]); b.addEventListener("click", () => pick(k)); return b; });
    const del = el("button", { type: "button", class: "link danger" }, "Remove row");
    del.addEventListener("click", () => { rows = rows.filter((o) => o.id !== r.id); menuFor = null; draw(); });
    const m = el("div", { class: "ce-menu", style: `left:1%;top:${((y0 + an.rowH * 0.6) / H) * 100}%` }, [el("div", { class: "ce-opts" }, opts), el("div", { class: "ce-tee" }, [nameIn, teeGo]), del]);
    m.addEventListener("click", (e) => e.stopPropagation());
    return m;
  }
  const cleanTee = (t) => String(t || "").replace(/[^A-Za-z0-9 '&-]/g, " ").replace(/\s+/g, " ").trim();

  // pointer → photo pixels
  const toPhoto = (e) => { const b = img.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H }; };
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = toPhoto(e);
    if (drag.type === "row") { const r = rows.find((o) => o.id === drag.id); if (r) { r.y = p.y - slope * (p.x - refX); r.values = null; } } // moved: read it again
    else { anchors[drag.key] = p; colsMoved = true; }
    draw();
  });
  const endDrag = () => { if (drag) { drag = null; rows.sort((a, b) => a.y - b.y); draw(); } };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  img.addEventListener("click", (e) => {
    const p = toPhoto(e);
    if (placing != null) {
      anchors[PLACE[placing]] = p; placing++;
      if (placing >= PLACE.length) { placing = null; if (!an.anchors) refX = anchors.h1.x; }
      draw(); return;
    }
    if (adding) { rows.push({ id: Date.now(), y: p.y - slope * (p.x - refX), kind: "ignore", name: "", label: "" }); rows.sort((a, b) => a.y - b.y); adding = false; menuFor = rows.find((r) => r.kind === "ignore" && Math.abs(r.y - (p.y - slope * (p.x - refX))) < 1)?.id ?? null; draw(); return; }
    if (menuFor != null) { menuFor = null; draw(); }
  });
  zin.addEventListener("click", () => { zoom = Math.min(4, zoom * 1.5); draw(); });
  zout.addEventListener("click", () => { zoom = Math.max(1, zoom / 1.5); draw(); });
  wordsBtn.addEventListener("click", () => { showWords = !showWords; wordsBtn.setAttribute("aria-pressed", showWords ? "true" : "false"); wordsBtn.textContent = showWords ? "Hide words" : "Show all words"; draw(); });
  addBtn.addEventListener("click", () => { adding = true; draw(); });
  const close = () => { overlay.remove(); if (url) URL.revokeObjectURL(url); document.removeEventListener("keydown", onKey); document.body.classList.remove("tapping"); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  cancel.addEventListener("click", close);
  useBtn.addEventListener("click", () => {
    if (!haveCols()) return;
    const at = (r) => ({ x: anchors.h1.x, y: yAt(r, anchors.h1.x) });
    const par = rows.find((r) => r.kind === "par"), hcp = rows.find((r) => r.kind === "hcp");
    const tees = rows.filter((r) => r.kind === "tee");
    const taps = { ...Object.fromEntries(PLACE.map((k) => [k, anchors[k]])), par: par ? at(par) : null, hcp: hcp ? at(hcp) : null, tees: tees.map((r) => ({ ...at(r), name: r.name || "Tees" })) };
    // Nothing to re-read (every row in use already has its numbers, columns where they were): use them as is.
    const used = rows.filter((r) => ["par", "hcp", "tee"].includes(r.kind));
    const ready = !colsMoved && used.length && used.every((r) => r.values && r.readAs === r.kind);
    const result = ready ? { found: true, notes: an.notes || [], par: par?.values || Array(holes).fill(null), hcp: hcp?.values || Array(holes).fill(null),
      tees: tees.map((r) => ({ name: r.name || "Tees", yards: r.values })) } : null;
    Object.assign(an, { rows, anchors: { ...anchors }, refX }); // reopening shows your changes
    close();
    onConfirm(taps, an.src, result);
  });
  document.addEventListener("keydown", onKey);
  document.body.classList.add("tapping");
  document.body.appendChild(overlay);
  img.addEventListener("load", draw);
  draw();
}
