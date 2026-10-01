// Data Entry, for everyone (players, coaches, caddies, analysts, the admin).
//   #/entry                    your rounds + "Start a new round"
//   #/entry/new                round details, then the scorecard (typed in, or read from a photo)
//   #/entry/:player/:round     shot-by-shot entry, one hole at a time; then a summary
// Built phone-first: one column, big tap targets, chip pickers instead of dropdowns, number keypads,
// a sticky bottom bar, and every change saved automatically.
import { el, mount, formatWhen, confirmAction } from "../ui.js";
import { getState } from "../auth.js";
import { adminAllClients, UserError } from "../store.js";
import { createRound, saveHole, updateRound, deleteRound, watchRound, watchPlayerRounds, watchRoundsFor, watchAllRounds } from "../rounds.js";
import { LIES, END_LIES, unitFor, strokesGained, holeScore, roundToPrepared } from "../roundCalc.js";
import { readImageText, parseScorecard } from "../scorecardReader.js";
import { teamLabels, plainName } from "../names.js";
import { fmtSG, sgColor, CATEGORIES } from "../sg.js";
import { playerPicker } from "../playerPicker.js";

const todayISO = () => new Date().toISOString().slice(0, 10);
const toPar = (n) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));

export async function render(main, { params, routeId, flash }) {
  if (routeId === "entry-new") return renderNew(main, flash);
  if (routeId === "entry-round") return renderRound(main, params, flash);
  return renderList(main);
}

/* ================================== who can enter for whom ================================== */
async function playersICanEnterFor() {
  const state = getState();
  if (state.isAdmin) {
    const { labels, ids } = await adminAllClients();
    return { admin: true, labels, ids };
  }
  if (state.isTeam) return { team: true, labels: teamLabels(state.teamAccess) };
  return { self: { key: state.profile.clientKey, label: plainName(state.profile.name || state.profile.clientLabel) } };
}

/* ======================================== round list ======================================== */
function renderList(main) {
  const state = getState();
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
      return el("a", { class: "entry-card", href: `#/entry/${encodeURIComponent(r.playerKey)}/${r.id}` }, [
        el("div", { class: "entry-card-main" }, [
          el("strong", {}, r.course || "Round"),
          el("span", { class: "muted" }, [r.date, r.location ? ` \u00b7 ${r.location}` : "", state.profile?.clientKey === r.playerKey ? "" : ` \u00b7 ${plainName(r.playerLabel)}`].join("")),
        ]),
        el("div", { class: "entry-card-score" }, r.status === "complete"
          ? [el("strong", {}, String(score)), el("span", { class: "muted" }, toPar(score - par))]
          : [el("strong", {}, thru ? toPar(score - parThru(r)) : "\u2014"), el("span", { class: "muted" }, thru ? `thru ${thru}` : "not started")]),
      ]);
    };
    const live = rounds.filter((r) => r.status !== "complete"), done = rounds.filter((r) => r.status === "complete");
    mount(list, [
      live.length ? el("h2", {}, "In progress") : null, ...live.map(row),
      done.length ? el("h2", {}, "Completed") : null, ...done.map(row),
    ]);
  };
  if (state.isAdmin) return watchAllRounds(draw);
  if (state.isTeam) return watchRoundsFor(Object.keys(state.teamAccess || {}), draw);
  return watchPlayerRounds(state.profile.clientKey, draw);
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
  const who = await playersICanEnterFor();
  let player = who.self || null;
  let holesCount = 18;
  let holes = blankHoles(18);

  // --- details ---
  let playerField;
  if (who.self) playerField = null;
  else if (who.team) {
    const opts = [...who.labels].sort((a, b) => a[1].localeCompare(b[1]));
    const sel = el("select", { "aria-label": "Player" }, [el("option", { value: "" }, "Choose a player\u2026"), ...opts.map(([k, l]) => el("option", { value: k }, l))]);
    if (opts.length === 1) { sel.value = opts[0][0]; player = { key: opts[0][0], label: opts[0][1] }; }
    sel.addEventListener("change", () => { player = sel.value ? { key: sel.value, label: who.labels.get(sel.value) } : null; });
    playerField = el("label", {}, ["Player", sel]);
  } else {
    const pick = playerPicker(who.labels, (p) => { player = p; }, who.ids);
    playerField = pick.node;
  }
  const date = el("input", { type: "date", value: todayISO(), required: true });
  const course = el("input", { required: true, placeholder: "e.g. Torrey Pines South", autocomplete: "off", maxLength: 80 });
  const locationIn = el("input", { placeholder: "e.g. La Jolla, CA", autocomplete: "off", maxLength: 80 });

  // --- scorecard ---
  const grid = el("div", { class: "card-grid" });
  const totals = el("p", { class: "muted center card-totals" });
  const photoStatus = el("p", { class: "muted center", role: "status" });
  const photo = el("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden" });
  const photoBtn = el("label", { class: "btn ghost entry-big photo-btn" }, ["\uD83D\uDCF7  Read a scorecard photo", photo]);
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
        b.addEventListener("click", () => { holes[i].par = p; drawGrid(); });
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

  photo.addEventListener("change", async () => {
    const f = photo.files[0];
    if (!f) return;
    photoStatus.textContent = "Reading the scorecard\u2026 this can take 20\u201330 seconds.";
    try {
      const text = await readImageText(f, (p) => { photoStatus.textContent = `Reading the scorecard\u2026 ${Math.round(p * 100)}%`; });
      const read = parseScorecard(text, holesCount);
      let found = 0;
      holes = holes.map((h, i) => {
        const next = { ...h };
        if (read.par[i]) { next.par = read.par[i]; found++; }
        if (read.yards[i]) { next.yards = read.yards[i]; found++; }
        if (read.hcp[i]) { next.hcp = read.hcp[i]; found++; }
        return next;
      });
      drawGrid();
      photoStatus.textContent = found
        ? `Filled in ${found} of ${holesCount * 3} boxes from the photo. Check them below and fix anything that's off.`
        : "Couldn't make out the numbers in that photo. Try a sharper, straight-on shot in good light, or type them in below.";
    } catch (err) {
      console.error(err);
      photoStatus.textContent = "The scorecard reader isn't available right now. Type the holes in below.";
    } finally { photo.value = ""; }
  });

  const start = el("button", { class: "btn entry-big", type: "submit" }, "Start round \u25B6");
  const form = el("form", {
    class: "entry-form",
    onSubmit: async (e) => {
      e.preventDefault();
      if (!player) { flash("Choose the player this round is for.", "error"); return; }
      if (!course.value.trim()) { flash("Enter the course.", "error"); course.focus(); return; }
      const missing = holes.filter((h) => !h.par).map((h) => h.n);
      if (missing.length) { flash(`Pick a par for hole${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`, "error"); return; }
      start.disabled = true;
      try {
        const id = await createRound({
          playerKey: player.key, playerLabel: player.label, ownerUid: state.user.uid, ownerName: state.profile?.name || state.user.email || "",
          date: date.value, course: course.value.trim(), location: locationIn.value.trim(),
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
      playerField,
      el("label", {}, ["Date", date]),
      el("label", {}, ["Course", course]),
      el("label", {}, ["Location (optional)", locationIn]),
    ]),
    el("section", { class: "entry-section" }, [
      el("h2", {}, "Scorecard"),
      countPills,
      photoBtn,
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
function renderRound(main, params, flash) {
  const state = getState();
  const playerKey = decodeURIComponent(params.player);
  const roundId = params.round;
  let round = null;
  let holeIdx = 0;
  let strokes = [];           // the hole on screen, being edited
  let saveTimer = null;
  let firstLoad = true;
  const status = el("span", { class: "save-status", role: "status" });

  const canEdit = () => round && (state.isAdmin || round.ownerUid === state.user.uid);
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
    } else if (!editingNow) {
      // Someone else (or another device) changed it: refresh unless we're mid-edit.
      if (holeIdx >= 0) loadHole();
      draw();
    }
  });

  function loadHole() {
    if (holeIdx < 0) return;
    const h = hole();
    const saved = round.shots?.[key(h)];
    strokes = saved && saved.length ? saved.map((s) => ({ ...s })) : Array.from({ length: h.par }, () => blankStroke());
    if (!strokes[0].startLie) { strokes[0].startLie = "Tee box"; strokes[0].startDist = h.yards ?? ""; }
    chain();
  }
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
  function changed(redraw = true) {
    chain();
    if (redraw) drawHole(); else refreshDerived();
    if (!canEdit()) return;
    status.textContent = "Saving\u2026";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  async function save() {
    const h = hole();
    const clean = strokes.map(({ startLie, startDist, endLie, endDist, manualStart }) => ({
      startLie, startDist: startDist === "" ? null : Number(startDist), endLie, endDist: endDist === "" || endLie === "Holed" ? (endLie === "Holed" ? 0 : null) : Number(endDist),
      ...(manualStart ? { manualStart: true } : {}),
    }));
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
    holeIdx = i;
    loadHole();
    draw();
    window.scrollTo(0, 0);
  }

  /* ---------- layout ---------- */
  const strip = el("nav", { class: "hole-strip", "aria-label": "Holes" });
  const holeBox = el("div", { class: "hole-box" });
  const bar = el("div", { class: "entry-bar entry-nav" });

  function draw() {
    const { score, thru } = roundTotals(round);
    const head = el("header", { class: "round-head" }, [
      el("p", { class: "crumb" }, el("a", { href: "#/entry" }, "\u2190 Data Entry")),
      el("h1", {}, round.course || "Round"),
      el("p", { class: "muted" }, [round.date, round.location ? ` \u00b7 ${round.location}` : "", ` \u00b7 ${plainName(round.playerLabel)}`].join("")),
      el("p", { class: "round-score" }, [
        el("strong", {}, thru ? toPar(score - parThru(round)) : "E"),
        el("span", { class: "muted" }, thru === round.holes.length ? ` \u00b7 ${score} total` : ` \u00b7 thru ${thru}`),
        " ", status,
      ]),
      canEdit() ? null : el("p", { class: "muted small" }, `Entered by ${round.ownerName || "someone else"} \u2014 view only.`),
    ]);
    if (holeIdx < 0) { mount(main, [head, summary()]); return; }
    mount(main, [head, strip, holeBox, bar]);
    drawStrip(); drawHole(); drawBar();
  }

  function drawStrip() {
    mount(strip, [...round.holes.map((h, i) => {
      const hs = holeScore(i === holeIdx ? strokes : round.shots?.[key(h)]);
      const diff = hs.done ? hs.strokes - h.par : null;
      const b = el("button", { type: "button", class: "hole-chip" + (i === holeIdx ? " on" : "") + (hs.done ? " done" : ""), "aria-current": i === holeIdx ? "step" : null, "aria-label": `Hole ${h.n}` }, [
        el("span", {}, String(h.n)), el("small", {}, hs.done ? (diff === 0 ? "par" : toPar(diff)) : "\u00a0"),
      ]);
      b.addEventListener("click", () => go(i));
      return b;
    }), (() => { const b = el("button", { type: "button", class: "hole-chip sum" }, [el("span", {}, "\u2211"), el("small", {}, "card")]); b.addEventListener("click", () => go(-1)); return b; })()]);
    requestAnimationFrame(() => strip.querySelector(".hole-chip.on")?.scrollIntoView({ inline: "center", block: "nearest" }));
  }

  function drawHole() {
    const h = hole();
    const ro = !canEdit();
    const hs = holeScore(strokes);
    mount(holeBox, [
      el("div", { class: "hole-title" }, [
        el("h2", {}, `Hole ${h.n}`),
        el("p", {}, [`Par ${h.par}`, h.yards ? ` \u00b7 ${h.yards} yds` : "", h.hcp ? ` \u00b7 Hcp ${h.hcp}` : ""].join("")),
        hs.done ? el("p", { class: "hole-result" }, `${hs.strokes} \u00b7 ${scoreName(hs.strokes - h.par)}`) : null,
      ]),
      ...strokes.map((s, i) => strokeCard(s, i, ro)),
      ro ? null : el("div", { class: "shot-tools" }, [
        (() => { const b = el("button", { type: "button", class: "btn ghost add-shot" }, "\uFF0B Add a shot"); b.addEventListener("click", () => { strokes.push(blankStroke()); changed(); requestAnimationFrame(() => holeBox.querySelector(".shot-card:last-of-type")?.scrollIntoView({ block: "center", behavior: "smooth" })); }); return b; })(),
        strokes.length > 1 ? (() => { const b = el("button", { type: "button", class: "link danger" }, "Remove last shot"); b.addEventListener("click", () => { strokes.pop(); changed(); }); return b; })() : null,
      ]),
    ]);
    drawStrip();
  }

  function refreshDerived() {
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
    const hs = holeScore(strokes), h = hole();
    const res = holeBox.querySelector(".hole-result");
    if (res && hs.done) res.textContent = `${hs.strokes} \u00b7 ${scoreName(hs.strokes - h.par)}`;
  }

  function strokeCard(s, i, ro) {
    const sg = strokesGained(s);
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
    return el("section", { class: "shot-card" + (after ? " after-holed" : ""), "data-i": String(i) }, [
      el("div", { class: "shot-head" }, [
        el("h3", {}, `Shot ${i + 1}`),
        el("span", { class: "shot-sg", style: sg === null ? "" : `color:${sgColor(sg)}`, title: "Strokes gained (placeholder numbers)" }, sg === null ? "" : `${fmtSG(sg)} SG`),
      ]),
      after ? el("p", { class: "muted small" }, "This comes after the ball was holed \u2014 remove it if it's extra.") : null,
      el("p", { class: "shot-label" }, "From"),
      chips(LIES, s.startLie, (l) => { s.startLie = l; s.manualStart = i > 0; changed(); }, `Shot ${i + 1} starting lie`),
      distInput(s.startDist, unitFor(s.startLie), (v) => { s.startDist = v; s.manualStart = i > 0; changed(false); }, `Shot ${i + 1} starting distance`, "start"),
      el("p", { class: "shot-label" }, "To"),
      chips(END_LIES, s.endLie, (l) => {
        s.endLie = l;
        if (l === "Holed") { s.endDist = 0; strokes = strokes.filter((x, j) => j <= i || x.startDist !== "" || x.endLie); }
        else if (s.endDist === 0) s.endDist = "";
        changed();
      }, `Shot ${i + 1} result`),
      s.endLie === "Holed" ? el("p", { class: "holed-note" }, "\u26F3 In the hole") : distInput(s.endDist, unitFor(s.endLie === "Penalty" ? s.startLie : s.endLie), (v) => { s.endDist = v; changed(false); }, `Shot ${i + 1} distance left`, "end"),
    ]);
  }

  function drawBar() {
    const last = holeIdx === round.holes.length - 1;
    const prev = el("button", { type: "button", class: "btn ghost", disabled: holeIdx === 0 }, "\u25C0 Prev");
    prev.addEventListener("click", () => go(holeIdx - 1));
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

const scoreName = (d) => ({ "-3": "Albatross", "-2": "Eagle", "-1": "Birdie", 0: "Par", 1: "Bogey", 2: "Double bogey", 3: "Triple bogey" }[d] ?? (d > 0 ? `+${d}` : String(d)));
