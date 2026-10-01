// WITB (Account → WITB): "what's in the bag". Up to 14 clubs, each with its club, type and
// brand / model. Saved automatically. The clubs then appear as the "Club" choice on each shot in
// Data Entry, and as a Club filter on Stats → Entered Rounds.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { watchBag, saveBag, CLUB_TYPES, CLUB_CATS, MAX_CLUBS, clubLabel, clubRank } from "../bag.js";

export async function render(main) {
  const state = getState();
  const uid = state.user.uid;
  let clubs = Array.from({ length: MAX_CLUBS }, () => ({ cat: "", type: "", model: "" }));
  let loaded = false, timer = null;
  const status = el("span", { class: "save-status", role: "status" });
  const list = el("div", { class: "bag-list" });
  const count = el("span", { class: "muted" });

  const save = () => {
    clearTimeout(timer);
    status.textContent = "Saving\u2026";
    timer = setTimeout(async () => {
      const filled = clubs.filter((c) => c.cat && c.type).map((c) => ({ cat: c.cat, type: c.type, model: c.model.trim() }));
      try { await saveBag(uid, filled); status.textContent = "Saved \u2713"; }
      catch { status.textContent = "Not saved \u2014 check your connection"; }
    }, 500);
  };
  const drawCount = () => { count.textContent = `${clubs.filter((c) => c.cat && c.type).length} of ${MAX_CLUBS} clubs`; };

  const row = (c, i) => {
    const cat = el("select", { "aria-label": `Slot ${i + 1} club` }, [el("option", { value: "" }, "Club\u2026"), ...CLUB_CATS.map((k) => el("option", { value: k, selected: c.cat === k }, k))]);
    const type = el("select", { "aria-label": `Slot ${i + 1} type`, disabled: !c.cat });
    const fillTypes = () => mount(type, [el("option", { value: "" }, c.cat ? "Type\u2026" : "\u2014"), ...(CLUB_TYPES[c.cat] || []).map((t) => el("option", { value: t, selected: c.type === t }, t))]);
    fillTypes();
    const model = el("input", { value: c.model, placeholder: "Brand / model", maxLength: 60, autocomplete: "off", "aria-label": `Slot ${i + 1} brand and model`, disabled: !c.cat });
    cat.addEventListener("change", () => {
      c.cat = cat.value;
      c.type = c.cat === "Putter" ? "Putter" : (CLUB_TYPES[c.cat] || []).includes(c.type) ? c.type : "";
      type.disabled = !c.cat; model.disabled = !c.cat; fillTypes(); drawCount(); save();
    });
    type.addEventListener("change", () => { c.type = type.value; drawCount(); save(); });
    model.addEventListener("input", () => { c.model = model.value; save(); });
    const clear = el("button", { type: "button", class: "entry-del", "aria-label": `Clear slot ${i + 1}`, title: "Clear" }, "\u2715");
    clear.addEventListener("click", () => { clubs[i] = { cat: "", type: "", model: "" }; draw(); save(); });
    return el("div", { class: "bag-row" }, [el("span", { class: "bag-n" }, String(i + 1)), cat, type, model, clear]);
  };
  const draw = () => { mount(list, clubs.map(row)); drawCount(); };

  const sortBtn = el("button", { type: "button", class: "btn ghost" }, "Sort Driver \u2192 Putter");
  sortBtn.addEventListener("click", () => {
    const filled = clubs.filter((c) => c.cat && c.type).sort((a, b) => clubRank(clubLabel(a)) - clubRank(clubLabel(b)));
    clubs = [...filled, ...Array.from({ length: MAX_CLUBS - filled.length }, () => ({ cat: "", type: "", model: "" }))];
    draw(); save();
  });

  mount(main, [
    el("header", { class: "page-head" }, [el("h1", {}, "What's in the bag"), el("p", { class: "muted" }, ["Up to 14 clubs. These become the Club choices on each shot in Data Entry. ", status])]),
    el("section", { class: "panel bag-panel" }, [
      el("div", { class: "bag-top" }, [count, sortBtn]),
      el("div", { class: "bag-head" }, [el("span", {}, "#"), el("span", {}, "Club"), el("span", {}, "Type"), el("span", {}, "Brand / model"), el("span", {})]),
      list,
    ]),
  ]);
  draw();
  const unsub = watchBag(uid, (saved) => {
    if (loaded) return; // after the first load, the page is the source of truth while you edit
    loaded = true;
    clubs = [...saved.map((c) => ({ cat: c.cat, type: c.type, model: c.model || "" })), ...Array.from({ length: Math.max(0, MAX_CLUBS - saved.length) }, () => ({ cat: "", type: "", model: "" }))].slice(0, MAX_CLUBS);
    draw();
  });
  return () => { unsub(); if (timer) { clearTimeout(timer); } };
}
