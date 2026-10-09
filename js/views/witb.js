// WITB: every club you've ever played, and your bag.
//   Add a club at the top. Tap a club in the list to put it in (or take it out of) your bag: clubs in the
//   bag are highlighted and listed under "Your bag" at the bottom (up to 14). Each club shows how many
//   entered rounds it was used in, its attempts a round and its strokes gained per attempt.
// Your bag becomes the Club choice on each shot in Data Entry.
import { el, mount, confirmAction } from "../ui.js";
import { getState } from "../auth.js";
import { watchBagDoc, saveLibrary, libraryFrom, newClubId, CLUB_TYPES, CLUB_CATS, MAX_CLUBS, clubLabel, clubRank, clubMake, shotUsesClub, shaftText, FLEXES } from "../bag.js";
import { watchPlayerRounds } from "../rounds.js";
import { strokesGained } from "../roundCalc.js";
import { fmtSG, sgColor } from "../sg.js";
import { myEntryKey } from "./dataEntry.js";
import { effectiveTeam } from "../preview.js";
import { uidForClient, getUserProfile } from "../store.js";

export async function render(main, { flash, previewClient }) {
  const state = getState();
  // Whose bag: your own, or (the admin in someone's portal) that player's or team member's. Theirs is shown
  // as it is: only they can change it.
  let uid = state.user.uid, entryKey = myEntryKey(state), viewing = null;
  const team = effectiveTeam(state);
  if (state.isAdmin && team.preview && team.uid) {
    uid = team.uid; viewing = team.name || "This person";
    entryKey = (await getUserProfile(uid).catch(() => null))?.clientKey || null;
  } else if (state.isAdmin && previewClient && !previewClient.self && !previewClient.role) {
    viewing = previewClient.label || "This player"; entryKey = previewClient.key;
    uid = await uidForClient(previewClient.key).catch(() => null);
    if (!uid) {
      mount(main, [el("header", { class: "page-head" }, [el("h1", {}, `${viewing}\u2019s bag`)]),
        el("p", { class: "empty center" }, `${viewing} hasn\u2019t signed up yet, so there are no clubs to show.`)]);
      return () => {};
    }
  }
  const readOnly = !!viewing;
  let library = [], inBag = [], rounds = [], loaded = false;
  const status = el("span", { class: "save-status", role: "status" });

  const save = async () => {
    if (readOnly) return;
    status.textContent = "Saving\u2026";
    try { await saveLibrary(uid, library, inBag); status.textContent = "Saved \u2713"; }
    catch { status.textContent = "Not saved \u2014 check your connection"; }
  };

  // Rounds used, shots (attempts) and strokes gained per attempt, from your entered rounds. Several clubs
  // together (an iron set): rounds where any of them was used, and all their shots.
  const usage = (clubs) => {
    clubs = [].concat(clubs);
    let used = 0, sg = 0, n = 0, shots = 0;
    for (const r of rounds) {
      let inRound = false;
      for (const strokes of Object.values(r.shots || {})) for (const st of strokes || []) {
        if (!clubs.some((c) => shotUsesClub(st, c))) continue;
        inRound = true; shots++;
        const v = strokesGained(st);
        if (v != null) { sg += v; n++; }
      }
      if (inRound) used++;
    }
    return { used, shots, perRound: used ? shots / used : null, avg: n ? sg / n : null };
  };

  /* ---------- add a club (or, for irons and wedges, a whole set) ---------- */
  const cat = el("select", { "aria-label": "Club" }, [el("option", { value: "" }, "Club\u2026"), ...CLUB_CATS.map((k) => el("option", { value: k }, k))]);
  const type = el("select", { "aria-label": "Type", disabled: true }, el("option", { value: "" }, "Type\u2026"));
  const brand = el("input", { placeholder: "Brand", maxLength: 40, autocomplete: "off", "aria-label": "Brand" });
  const model = el("input", { placeholder: "Model", maxLength: 50, autocomplete: "off", "aria-label": "Model" });
  const note = el("input", { placeholder: "Note", maxLength: 120, autocomplete: "off", "aria-label": "Note (optional)" });
  const shaftIn = el("input", { placeholder: "Shaft model", maxLength: 50, autocomplete: "off", "aria-label": "Shaft model" });
  const flexIn = el("select", { "aria-label": "Flex" }, [el("option", { value: "" }, "Flex"), ...FLEXES.map((f) => el("option", { value: f }, f))]);
  const weightIn = el("input", { type: "number", inputmode: "numeric", min: "20", max: "160", placeholder: "Weight (g)", "aria-label": "Shaft weight in grams" });
  const yardsIn = el("input", { type: "number", inputmode: "numeric", min: "0", max: "400", placeholder: "Stock yds", "aria-label": "Stock yardage" });
  // set mode: one dropdown where you tick the clubs you want
  let setMode = false, picked = [];
  const pickBtn = el("button", { type: "button", class: "ms-btn set-pick", "aria-expanded": "false", "aria-haspopup": "true" });
  const pickPanel = el("div", { class: "ms-panel set-panel", hidden: true, role: "group", "aria-label": "Clubs in the set" });
  const setBox = el("div", { class: "set-box", hidden: true }, [pickBtn, pickPanel]);
  const setToggle = el("button", { type: "button", class: "link set-toggle", hidden: true });
  const drawPick = () => {
    const ts = CLUB_TYPES[cat.value] || [];
    picked = ts.filter((t) => picked.includes(t)); // keep set order
    mount(pickBtn, [el("span", { class: "ms-sum" }, picked.length ? picked.join(", ") : "Pick clubs\u2026"), el("span", { class: "ms-caret", "aria-hidden": "true" }, "\u25BE")]);
    mount(pickPanel, el("div", { class: "ms-options" }, ts.map((t) => {
      const box = el("input", { type: "checkbox", checked: picked.includes(t), "aria-label": t });
      box.addEventListener("change", () => { picked = box.checked ? [...picked, t] : picked.filter((x) => x !== t); drawPick(); });
      return el("label", { class: "ms-row" }, [box, el("span", {}, t)]);
    })));
  };
  // open / close the list; while open, its block sits above the blocks below (so the list isn't hidden)
  const setOpen = (open) => {
    pickPanel.hidden = !open; pickBtn.setAttribute("aria-expanded", open ? "true" : "false");
    setBox.closest(".bag-panel")?.classList.toggle("raised", open);
  };
  pickBtn.addEventListener("click", () => setOpen(pickPanel.hidden));
  document.addEventListener("pointerdown", (e) => { if (!setBox.contains(e.target)) setOpen(false); });
  const addBtn = el("button", { class: "btn", type: "submit" }, "Add club");
  const drawAddMode = () => {
    const canSet = cat.value === "Iron" || cat.value === "Wedge";
    if (!canSet) setMode = false;
    setToggle.hidden = !canSet;
    setToggle.textContent = setMode ? "Add just one club" : `Add a set of ${cat.value === "Wedge" ? "wedges" : "irons"}`;
    setBox.hidden = !setMode; type.hidden = setMode;
    addBtn.textContent = setMode ? "Add set" : "Add club";
    if (setMode) {
      // start with the usual set ticked; change it freely
      if (!picked.length || !picked.every((t) => (CLUB_TYPES[cat.value] || []).includes(t)))
        picked = cat.value === "Wedge" ? ["50\u00b0", "54\u00b0", "58\u00b0"] : ["4i", "5i", "6i", "7i", "8i", "9i", "PW"];
      drawPick();
    }
  };
  cat.addEventListener("change", () => {
    mount(type, [el("option", { value: "" }, "Type\u2026"), ...(CLUB_TYPES[cat.value] || []).map((t) => el("option", { value: t }, t))]);
    type.disabled = !cat.value;
    if (cat.value === "Putter") type.value = "Putter";
    drawAddMode();
  });
  setToggle.addEventListener("click", () => { setMode = !setMode; drawAddMode(); });
  const same = (x, c) => x.cat === c.cat && x.type === c.type && x.brand.toLowerCase() === c.brand.toLowerCase() && x.model.toLowerCase() === c.model.toLowerCase();
  const addForm = el("form", {
    class: "club-add",
    onSubmit: async (e) => {
      e.preventDefault();
      const b = brand.value.trim(), m = model.value.trim(), n = note.value.trim();
      const shaftBits = { shaft: shaftIn.value.trim(), flex: flexIn.value, weight: weightIn.value ? String(Math.round(Number(weightIn.value))) : "", yards: yardsIn.value ? String(Math.round(Number(yardsIn.value))) : "" };
      if (setMode) {
        const pick = [...picked];
        if (!pick.length) { flash("Tick the clubs in the set.", "error"); return; }
        let added = 0, bagged = 0, skipped = 0;
        for (const t of pick) {
          const c = { id: newClubId(), cat: cat.value, type: t, brand: b, model: m, note: n, ...shaftBits };
          if (library.some((x) => same(x, c))) { skipped++; continue; }
          library = [c, ...library]; added++;
          if (inBag.length < MAX_CLUBS) { inBag = [...inBag, c.id]; bagged++; }
        }
        const name = [b, m].filter(Boolean).join(" ");
        flash(`Added ${added} club${added === 1 ? "" : "s"} (${pick.join(", ")}${name ? ` \u00b7 ${name}` : ""})${bagged < added ? `; ${bagged} fit in your bag` : ""}${skipped ? `; ${skipped} already in your list` : ""}.`, "ok");
      } else {
        if (!cat.value || !type.value) { flash("Pick the club and its type.", "error"); return; }
        const c = { id: newClubId(), cat: cat.value, type: type.value, brand: b, model: m, note: n, ...shaftBits };
        if (library.some((x) => same(x, c))) { flash(`${clubLabel(c)}${clubMake(c) ? ` \u00b7 ${clubMake(c)}` : ""} is already in your list.`, "error"); return; }
        library = [c, ...library];
        if (inBag.length < MAX_CLUBS) inBag = [...inBag, c.id]; // new clubs go straight in the bag (if there's room)
      }
      [brand, model, note, shaftIn, weightIn, yardsIn].forEach((x) => { x.value = ""; }); flexIn.value = "";
      draw(); await save();
    },
  }, [cat, type, setBox, brand, model, yardsIn, shaftIn, flexIn, weightIn, note, addBtn]);

  /* ---------- editing a club ---------- */
  let editing = null; // id of the club being edited
  function editRow(c) {
    const ecat = el("select", { "aria-label": "Club" }, CLUB_CATS.map((k) => el("option", { value: k, selected: c.cat === k }, k)));
    const etype = el("select", { "aria-label": "Type" });
    const fill = () => mount(etype, (CLUB_TYPES[ecat.value] || []).map((t) => el("option", { value: t, selected: c.type === t }, t)));
    fill(); ecat.addEventListener("change", fill);
    const eb = el("input", { value: c.brand, placeholder: "Brand", maxLength: 40, "aria-label": "Brand" });
    const em = el("input", { value: c.model, placeholder: "Model", maxLength: 50, "aria-label": "Model" });
    const en = el("input", { value: c.note, placeholder: "Note", maxLength: 120, "aria-label": "Note" });
    const es = el("input", { value: c.shaft || "", placeholder: "Shaft model", maxLength: 50, "aria-label": "Shaft model" });
    const ef = el("select", { "aria-label": "Flex" }, [el("option", { value: "" }, "Flex"), ...FLEXES.map((f) => el("option", { value: f, selected: c.flex === f }, f))]);
    const ew = el("input", { type: "number", inputmode: "numeric", min: "20", max: "160", value: c.weight || "", placeholder: "Weight (g)", "aria-label": "Shaft weight in grams" });
    const ey = el("input", { type: "number", inputmode: "numeric", min: "0", max: "400", value: c.yards || "", placeholder: "Stock yds", "aria-label": "Stock yardage" });
    const saveB = el("button", { type: "button", class: "btn" }, "Save");
    const cancelB = el("button", { type: "button", class: "link" }, "Cancel");
    saveB.addEventListener("click", async () => {
      const next = { ...c, cat: ecat.value, type: etype.value, brand: eb.value.trim(), model: em.value.trim(), note: en.value.trim(),
        shaft: es.value.trim(), flex: ef.value, weight: ew.value ? String(Math.round(Number(ew.value))) : "", yards: ey.value ? String(Math.round(Number(ey.value))) : "" };
      if (library.some((x) => x.id !== c.id && same(x, next))) { flash("You already have that club in your list.", "error"); return; }
      library = library.map((x) => (x.id === c.id ? next : x));
      editing = null; draw(); await save();
    });
    cancelB.addEventListener("click", () => { editing = null; draw(); });
    return el("tr", { class: "club-edit" }, el("td", { colspan: "6" }, el("div", { class: "club-add club-edit-form" }, [ecat, etype, eb, em, ey, es, ef, ew, en, el("div", { class: "edit-actions" }, [saveB, cancelB])])));
  }

  /* ---------- the list and the bag ---------- */
  const listBox = el("div");
  const bagBox = el("div");
  const toggle = (c) => {
    if (readOnly) return; // (someone else's bag: look, don't change)
    if (inBag.includes(c.id)) inBag = inBag.filter((id) => id !== c.id);
    else if (inBag.length >= MAX_CLUBS) { flash(`Your bag already has ${MAX_CLUBS} clubs. Take one out first.`, "error"); return; }
    else inBag = [...inBag, c.id];
    draw(); save();
  };
  const sorted = (list) => [...list].sort((a, b) => clubRank(clubLabel(a)) - clubRank(clubLabel(b)) || clubMake(a).localeCompare(clubMake(b)));
  // "All your clubs", grouped by club type (Driver, Fairway Wood, Hybrid, Iron, Wedge, Putter). Irons of the same
  // brand and model are a set, shown as one row that opens to its clubs. Where you have more than one of the same
  // club (two drivers, two 7-irons), a champagne star marks the one with the best SG / Attempt.
  const GROUP_NAMES = { Driver: "Drivers", "Fairway Wood": "Fairway woods", Hybrid: "Hybrids", Iron: "Irons", Wedge: "Wedges", Putter: "Putters" };
  let openSets = new Set();
  try { openSets = new Set(JSON.parse(localStorage.getItem("ta:witbOpenSets") || "[]")); } catch { /* fine */ }
  const keepOpenSets = () => { try { localStorage.setItem("ta:witbOpenSets", JSON.stringify([...openSets])); } catch { /* fine */ } };
  const sameKind = (c) => (c.cat === "Driver" || c.cat === "Putter" ? c.cat : clubLabel(c)); // "the same club": any driver; otherwise the same club (7i, 56° wedge)
  const fmtAtt = (v) => (v == null ? "\u2014" : (Math.round(v * 10) / 10).toFixed(1));
  const sgCell = (v) => el("td", { class: "num c-sg", style: v == null ? "" : `color:${sgColor(v)}` }, v == null ? "\u2014" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`);
  function clubRow(c, use, star, inSet = false) {
    const on = inBag.includes(c.id);
    if (editing === c.id) return editRow(c);
    const edit = el("button", { type: "button", class: "link club-edit-btn", "aria-label": `Edit ${clubLabel(c)}` }, "Edit");
    edit.addEventListener("click", (e) => { e.stopPropagation(); if (!readOnly) { editing = c.id; draw(); } });
    const del = el("button", { type: "button", class: "entry-del", "aria-label": `Remove ${clubLabel(c)} from your list`, title: "Remove from list" }, "\u2715");
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (readOnly) return;
      if (!confirmAction(`Remove ${clubLabel(c)}${clubMake(c) ? ` \u00b7 ${clubMake(c)}` : ""} from your list? Shots already entered with it keep it.`)) return;
      library = library.filter((x) => x.id !== c.id); inBag = inBag.filter((id) => id !== c.id); draw(); save();
    });
    const starEl = star ? el("span", { class: "club-star", title: `Best SG / Attempt of your ${c.cat === "Driver" || c.cat === "Putter" ? GROUP_NAMES[c.cat].toLowerCase() : clubLabel(c)}s`, "aria-label": "Best SG per attempt" }, "\u2605") : null;
    const make = clubMake(c);
    const tr = el("tr", { class: "club-row" + (on ? " in-bag" : "") + (inSet ? " in-set" : ""), tabindex: "0", role: "button", "aria-pressed": on ? "true" : "false",
      title: readOnly ? "" : on ? "In your bag. Tap to take it out." : "Tap to put it in your bag." }, [
      el("td", { class: "c-club" }, [el("strong", {}, clubLabel(c)), on ? el("span", { class: "tag type-player bag-tag" }, "In bag") : null,
        make ? el("span", { class: "mobile-make" }, [make, starEl ? " " : null, starEl ? starEl.cloneNode(true) : null]) : null, // brand / model under the name on phones
        c.note ? el("span", { class: "club-note" }, c.note) : null]),
      el("td", { class: "c-make" }, make ? [make, starEl ? " " : null, starEl] : el("span", { class: "muted" }, "\u2014")),
      el("td", { class: "num c-rounds" }, String(use.used)),
      el("td", { class: "num c-att" }, fmtAtt(use.perRound)),
      sgCell(use.avg),
      el("td", { class: "actions" }, [edit, del]),
    ]);
    tr.addEventListener("click", () => toggle(c));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(c); } });
    return tr;
  }
  function draw() {
    const use = new Map(library.map((c) => [c.id, usage(c)]));
    // the star: per kind of club, the best SG / Attempt when at least two of them have one
    const starred = new Set();
    const kinds = new Map();
    for (const c of library) { const k = sameKind(c); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(c); }
    for (const list of kinds.values()) {
      const rated = list.filter((c) => use.get(c.id).avg != null);
      if (list.length < 2 || rated.length < 2) continue;
      const best = rated.reduce((a, b) => (use.get(b.id).avg > use.get(a.id).avg ? b : a));
      // (a tie at the three decimals shown: no star)
      if (!rated.some((c) => c !== best && Math.round(use.get(c.id).avg * 1000) === Math.round(use.get(best.id).avg * 1000))) starred.add(best.id);
    }
    const rows = [];
    for (const cat of CLUB_CATS) {
      const list = sorted(library.filter((c) => c.cat === cat));
      if (!list.length) continue;
      rows.push(el("tr", { class: "club-group" }, el("th", { colspan: "6", scope: "colgroup" }, [GROUP_NAMES[cat] || cat, el("span", { class: "club-group-n" }, ` ${list.length}`)])));
      if (cat !== "Iron") { for (const c of list) rows.push(clubRow(c, use.get(c.id), starred.has(c.id))); continue; }
      // irons: a set is two or more irons of the same brand and model
      const bySet = new Map();
      for (const c of list) { const k = clubMake(c).toLowerCase(); if (!bySet.has(k)) bySet.set(k, []); bySet.get(k).push(c); }
      const done = new Set();
      for (const c of list) {
        const k = clubMake(c).toLowerCase(), set = bySet.get(k);
        if (!k || set.length < 2) { rows.push(clubRow(c, use.get(c.id), starred.has(c.id))); continue; }
        if (done.has(k)) continue;
        done.add(k);
        const open = openSets.has(k), u = usage(set), nBag = set.filter((x) => inBag.includes(x.id)).length;
        const range = set.length > 1 ? `${clubLabel(set[0])}\u2013${clubLabel(set[set.length - 1])}` : clubLabel(set[0]);
        const tr = el("tr", { class: `club-set${open ? " open" : ""}${nBag ? " has-bag" : ""}`, tabindex: "0", role: "button", "aria-expanded": open ? "true" : "false",
          title: open ? "Close the set" : "Show the clubs in this set" }, [
          el("td", { class: "c-club" }, [el("span", { class: "set-caret", "aria-hidden": "true" }, open ? "\u25BE" : "\u25B8"), el("strong", {}, `${range} set`),
            el("span", { class: "mobile-make" }, clubMake(set[0])), el("span", { class: "club-note" }, `${set.length} clubs${nBag ? ` \u00b7 ${nBag} in bag` : ""}`)]),
          el("td", { class: "c-make" }, clubMake(set[0])),
          el("td", { class: "num c-rounds" }, String(u.used)),
          el("td", { class: "num c-att" }, fmtAtt(u.perRound)),
          sgCell(u.avg),
          el("td", { class: "actions" }),
        ]);
        const flip = () => { if (open) openSets.delete(k); else openSets.add(k); keepOpenSets(); draw(); };
        tr.addEventListener("click", flip);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
        rows.push(tr);
        if (open) for (const x of set) rows.push(clubRow(x, use.get(x.id), starred.has(x.id), true));
      }
    }
    mount(listBox, library.length ? el("div", { class: "table-scroll" }, el("table", { class: "plain club-table" }, [
      el("thead", {}, el("tr", {}, [["Club", ""], ["Brand / model", "c-make"], ["Rounds", "num c-rounds"], ["Attempts / Round", "num c-att"], ["SG / Attempt", "num c-sg"], ["", ""]].map(([h, cls]) =>
        el("th", { class: cls }, h === "Attempts / Round" ? [el("span", { class: "long" }, h), el("span", { class: "short" }, "Att / Rd")] : h === "SG / Attempt" ? [el("span", { class: "long" }, h), el("span", { class: "short" }, "SG / Att")] : h)))),
      el("tbody", {}, rows),
    ])) : el("p", { class: "empty" }, "No clubs yet. Add the clubs you play above."));
    const bag = sorted(inBag.map((id) => library.find((c) => c.id === id)).filter(Boolean));
    mount(bagBox, bag.length ? el("ul", { class: "bag-chips" }, bag.map((c) => {
      const b = el("button", { type: "button", class: "bag-chip", title: "Take it out of your bag" }, [el("strong", {}, clubLabel(c)), clubMake(c) ? el("span", {}, clubMake(c)) : null, el("span", { class: "bag-x", "aria-hidden": "true" }, "\u2715")]);
      b.addEventListener("click", () => toggle(c));
      return el("li", {}, b);
    })) : el("p", { class: "muted" }, readOnly ? "Their bag is empty." : "Your bag is empty. Tap clubs in the list above to put them in."));
    bagTitle.textContent = `${readOnly ? "Their" : "Your"} bag (${bag.length} of ${MAX_CLUBS})`;
  }
  const bagTitle = el("h3", {}, "Your bag");

  mount(main, [
    readOnly ? el("header", { class: "page-head" }, [el("h1", {}, `${viewing}\u2019s bag`), el("p", { class: "muted" }, `Every club ${viewing} has played, and what\u2019s in their bag. Only they can change it.`)])
      : el("header", { class: "page-head" }, [el("h1", {}, "What's in the bag"), el("p", { class: "muted" }, ["Every club you've played. Tap one to put it in your bag or take it out. ", status])]),
    readOnly ? null : el("section", { class: "panel bag-panel" }, [el("h3", {}, "Add a club"), addForm, setToggle]),
    el("section", { class: `panel bag-panel${readOnly ? " witb-readonly" : ""}` }, [el("h3", {}, readOnly ? "All their clubs" : "All your clubs"), listBox]),
    el("section", { class: "panel bag-panel your-bag" }, [bagTitle, bagBox]),
  ]);
  draw();

  const unBag = watchBagDoc(uid, (d) => {
    if (loaded) return; // after the first load the page is the source of truth
    loaded = true;
    ({ library, inBag } = libraryFrom(d));
    draw();
    if (!Array.isArray(d.library) && library.length) save(); // first visit after the update: keep the built list
  });
  const unRounds = entryKey ? watchPlayerRounds(entryKey, (rs) => { rounds = rs; draw(); }) : () => {};
  return () => { unBag(); unRounds(); };
}
