// WITB (Account → WITB): every club you've ever played, and your bag.
//   Add a club at the top. Tap a club in the list to put it in (or take it out of) your bag: clubs in the
//   bag are highlighted and listed under "Your bag" at the bottom (up to 14). Each club shows how many
//   entered rounds it was used in and its average strokes gained per shot.
// Your bag becomes the Club choice on each shot in Data Entry.
import { el, mount, confirmAction } from "../ui.js";
import { getState } from "../auth.js";
import { watchBagDoc, saveLibrary, libraryFrom, newClubId, CLUB_TYPES, CLUB_CATS, MAX_CLUBS, clubLabel, clubRank, clubMake, shotUsesClub } from "../bag.js";
import { watchPlayerRounds } from "../rounds.js";
import { strokesGained } from "../roundCalc.js";
import { fmtSG, sgColor } from "../sg.js";
import { myEntryKey } from "./dataEntry.js";

export async function render(main, { flash }) {
  const state = getState();
  const uid = state.user.uid;
  let library = [], inBag = [], rounds = [], loaded = false;
  const status = el("span", { class: "save-status", role: "status" });

  const save = async () => {
    status.textContent = "Saving\u2026";
    try { await saveLibrary(uid, library, inBag); status.textContent = "Saved \u2713"; }
    catch { status.textContent = "Not saved \u2014 check your connection"; }
  };

  // Rounds used and average strokes gained per shot, from your entered rounds.
  const usage = (c) => {
    let used = 0, sg = 0, n = 0;
    for (const r of rounds) {
      let inRound = false;
      for (const strokes of Object.values(r.shots || {})) for (const st of strokes || []) {
        if (!shotUsesClub(st, c)) continue;
        inRound = true;
        const v = strokesGained(st);
        if (v != null) { sg += v; n++; }
      }
      if (inRound) used++;
    }
    return { used, avg: n ? sg / n : null };
  };

  /* ---------- add a club (or, for irons and wedges, a whole set) ---------- */
  const cat = el("select", { "aria-label": "Club" }, [el("option", { value: "" }, "Club\u2026"), ...CLUB_CATS.map((k) => el("option", { value: k }, k))]);
  const type = el("select", { "aria-label": "Type", disabled: true }, el("option", { value: "" }, "Type\u2026"));
  const brand = el("input", { placeholder: "Brand", maxLength: 40, autocomplete: "off", "aria-label": "Brand" });
  const model = el("input", { placeholder: "Model", maxLength: 50, autocomplete: "off", "aria-label": "Model" });
  const note = el("input", { placeholder: "Note", maxLength: 120, autocomplete: "off", "aria-label": "Note (optional)" });
  // set mode: From … To (and, for wedges, the gap between lofts)
  let setMode = false;
  const fromT = el("select", { "aria-label": "From" }), toT = el("select", { "aria-label": "To" });
  const gap = el("select", { "aria-label": "Loft gap" }, [["2", "every 2\u00b0"], ["4", "every 4\u00b0"], ["6", "every 6\u00b0"]].map(([v, l]) => el("option", { value: v, selected: v === "4" }, l)));
  const setToggle = el("button", { type: "button", class: "link set-toggle", hidden: true });
  const setBox = el("div", { class: "set-box", hidden: true }, [el("span", { class: "set-label" }, "From"), fromT, el("span", { class: "set-label" }, "to"), toT, gap]);
  const addBtn = el("button", { class: "btn", type: "submit" }, "Add club");
  const drawAddMode = () => {
    const canSet = cat.value === "Iron" || cat.value === "Wedge";
    if (!canSet) setMode = false;
    setToggle.hidden = !canSet;
    setToggle.textContent = setMode ? "Add just one club" : `Add a set of ${cat.value === "Wedge" ? "wedges" : "irons"}`;
    setBox.hidden = !setMode; type.hidden = setMode;
    gap.hidden = cat.value !== "Wedge";
    addBtn.textContent = setMode ? "Add set" : "Add club";
    if (setMode) {
      const ts = CLUB_TYPES[cat.value] || [];
      const [f0, t0] = cat.value === "Wedge" ? ["50\u00b0", "58\u00b0"] : ["4i", "PW"];
      mount(fromT, ts.map((t) => el("option", { value: t, selected: t === f0 }, t)));
      mount(toT, ts.map((t) => el("option", { value: t, selected: t === t0 }, t)));
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
      if (setMode) {
        const ts = CLUB_TYPES[cat.value];
        const i0 = ts.indexOf(fromT.value), i1 = ts.indexOf(toT.value);
        if (i0 > i1) { flash("The first club has to come before the last one.", "error"); return; }
        const step = cat.value === "Wedge" ? Number(gap.value) / 2 : 1; // wedge lofts are listed every 2°
        const pick = ts.slice(i0, i1 + 1).filter((_, j) => j % step === 0);
        if (cat.value === "Wedge" && !pick.includes(toT.value)) pick.push(toT.value);
        let added = 0, bagged = 0, skipped = 0;
        for (const t of pick) {
          const c = { id: newClubId(), cat: cat.value, type: t, brand: b, model: m, note: n };
          if (library.some((x) => same(x, c))) { skipped++; continue; }
          library = [c, ...library]; added++;
          if (inBag.length < MAX_CLUBS) { inBag = [...inBag, c.id]; bagged++; }
        }
        const name = [b, m].filter(Boolean).join(" ");
        flash(`Added ${added} club${added === 1 ? "" : "s"} (${pick.join(", ")}${name ? ` \u00b7 ${name}` : ""})${bagged < added ? `; ${bagged} fit in your bag` : ""}${skipped ? `; ${skipped} already in your list` : ""}.`, "ok");
      } else {
        if (!cat.value || !type.value) { flash("Pick the club and its type.", "error"); return; }
        const c = { id: newClubId(), cat: cat.value, type: type.value, brand: b, model: m, note: n };
        if (library.some((x) => same(x, c))) { flash(`${clubLabel(c)}${clubMake(c) ? ` \u00b7 ${clubMake(c)}` : ""} is already in your list.`, "error"); return; }
        library = [c, ...library];
        if (inBag.length < MAX_CLUBS) inBag = [...inBag, c.id]; // new clubs go straight in the bag (if there's room)
      }
      [brand, model, note].forEach((x) => { x.value = ""; });
      draw(); await save();
    },
  }, [cat, type, setBox, brand, model, note, addBtn]);

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
    const saveB = el("button", { type: "button", class: "btn" }, "Save");
    const cancelB = el("button", { type: "button", class: "link" }, "Cancel");
    saveB.addEventListener("click", async () => {
      const next = { ...c, cat: ecat.value, type: etype.value, brand: eb.value.trim(), model: em.value.trim(), note: en.value.trim() };
      if (library.some((x) => x.id !== c.id && same(x, next))) { flash("You already have that club in your list.", "error"); return; }
      library = library.map((x) => (x.id === c.id ? next : x));
      editing = null; draw(); await save();
    });
    cancelB.addEventListener("click", () => { editing = null; draw(); });
    return el("tr", { class: "club-edit" }, el("td", { colspan: "6" }, el("div", { class: "club-add club-edit-form" }, [ecat, etype, eb, em, en, el("div", { class: "edit-actions" }, [saveB, cancelB])])));
  }

  /* ---------- the list and the bag ---------- */
  const listBox = el("div");
  const bagBox = el("div");
  const toggle = (c) => {
    if (inBag.includes(c.id)) inBag = inBag.filter((id) => id !== c.id);
    else if (inBag.length >= MAX_CLUBS) { flash(`Your bag already has ${MAX_CLUBS} clubs. Take one out first.`, "error"); return; }
    else inBag = [...inBag, c.id];
    draw(); save();
  };
  const sorted = (list) => [...list].sort((a, b) => clubRank(clubLabel(a)) - clubRank(clubLabel(b)) || clubMake(a).localeCompare(clubMake(b)));
  function draw() {
    mount(listBox, library.length ? el("div", { class: "table-scroll" }, el("table", { class: "plain club-table" }, [
      el("thead", {}, el("tr", {}, ["Club", "Brand / model", "Note", "Rounds", "Avg SG", ""].map((h) => el("th", { class: ["Rounds", "Avg SG"].includes(h) ? "num" : "" }, h)))),
      el("tbody", {}, sorted(library).map((c) => {
        const on = inBag.includes(c.id);
        const u = usage(c);
        if (editing === c.id) return editRow(c);
        const edit = el("button", { type: "button", class: "link club-edit-btn", "aria-label": `Edit ${clubLabel(c)}` }, "Edit");
        edit.addEventListener("click", (e) => { e.stopPropagation(); editing = c.id; draw(); });
        const del = el("button", { type: "button", class: "entry-del", "aria-label": `Remove ${clubLabel(c)} from your list`, title: "Remove from list" }, "\u2715");
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!confirmAction(`Remove ${clubLabel(c)}${clubMake(c) ? ` \u00b7 ${clubMake(c)}` : ""} from your list? Shots already entered with it keep it.`)) return;
          library = library.filter((x) => x.id !== c.id); inBag = inBag.filter((id) => id !== c.id); draw(); save();
        });
        const tr = el("tr", { class: "club-row" + (on ? " in-bag" : ""), tabindex: "0", role: "button", "aria-pressed": on ? "true" : "false",
          title: on ? "In your bag. Tap to take it out." : "Tap to put it in your bag." }, [
          el("td", {}, [el("strong", {}, clubLabel(c)), on ? el("span", { class: "tag type-player bag-tag" }, "In bag") : null,
            clubMake(c) ? el("span", { class: "mobile-make" }, clubMake(c)) : null]), // brand / model under the name on phones
          el("td", {}, clubMake(c) || el("span", { class: "muted" }, "\u2014")),
          el("td", { class: "muted" }, c.note || ""),
          el("td", { class: "num" }, String(u.used)),
          el("td", { class: "num", style: u.avg == null ? "" : `color:${sgColor(u.avg)}` }, u.avg == null ? "\u2014" : fmtSG(u.avg)),
          el("td", { class: "actions" }, [edit, del]),
        ]);
        tr.addEventListener("click", () => toggle(c));
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(c); } });
        return tr;
      })),
    ])) : el("p", { class: "empty" }, "No clubs yet. Add the clubs you play above."));
    const bag = sorted(inBag.map((id) => library.find((c) => c.id === id)).filter(Boolean));
    mount(bagBox, bag.length ? el("ul", { class: "bag-chips" }, bag.map((c) => {
      const b = el("button", { type: "button", class: "bag-chip", title: "Take it out of your bag" }, [el("strong", {}, clubLabel(c)), clubMake(c) ? el("span", {}, clubMake(c)) : null, el("span", { class: "bag-x", "aria-hidden": "true" }, "\u2715")]);
      b.addEventListener("click", () => toggle(c));
      return el("li", {}, b);
    })) : el("p", { class: "muted" }, "Your bag is empty. Tap clubs in the list above to put them in."));
    bagTitle.textContent = `Your bag (${bag.length} of ${MAX_CLUBS})`;
  }
  const bagTitle = el("h3", {}, "Your bag");

  mount(main, [
    el("header", { class: "page-head" }, [el("h1", {}, "What's in the bag"), el("p", { class: "muted" }, ["Every club you've played. Tap one to put it in your bag or take it out. ", status])]),
    el("section", { class: "panel bag-panel" }, [el("h3", {}, "Add a club"), addForm, setToggle]),
    el("section", { class: "panel bag-panel" }, [el("h3", {}, "All your clubs"), listBox]),
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
  const unRounds = watchPlayerRounds(myEntryKey(state), (rs) => { rounds = rs; draw(); });
  return () => { unBag(); unRounds(); };
}
