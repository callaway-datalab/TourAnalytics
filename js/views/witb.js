// WITB (Account → WITB): "what's in the bag". Up to 14 clubs, each with its club, type, brand, model
// and a note. Saved automatically. The clubs become the "Club" choice on each shot in Data Entry, and a
// Club filter on Stats → Entered Rounds.
// Old bags: when you change the clubs themselves (not just notes), the make-up you had when you opened
// this page is filed under Old bags with the dates it was in use, once you leave the page.
import { el, mount, confirmAction } from "../ui.js";
import { getState } from "../auth.js";
import { watchBagDoc, saveBag, saveBagHistory, bagMakeup, CLUB_TYPES, CLUB_CATS, MAX_CLUBS, clubLabel, clubRank, clubMake } from "../bag.js";

const blank = () => ({ cat: "", type: "", brand: "", model: "", note: "" });
const fmtDate = (iso) => { const d = new Date(`${iso}T12:00:00`); return isNaN(d) ? iso || "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };

export async function render(main) {
  const uid = getState().user.uid;
  let clubs = Array.from({ length: MAX_CLUBS }, blank);
  let history = [], since = null, opened = null; // opened: the make-up when you arrived (for Old bags)
  let loaded = false, timer = null, archived = false;
  const status = el("span", { class: "save-status", role: "status" });
  const list = el("div", { class: "bag-list" });
  const count = el("span", { class: "muted" });
  const oldBox = el("div", { class: "old-bags" });

  const filled = () => clubs.filter((c) => c.cat && c.type).map((c) => ({ cat: c.cat, type: c.type, brand: c.brand.trim(), model: c.model.trim(), note: c.note.trim() }));
  const save = () => {
    clearTimeout(timer);
    status.textContent = "Saving\u2026";
    timer = setTimeout(async () => {
      timer = null;
      try { await saveBag(uid, filled(), { history, since }); status.textContent = "Saved \u2713"; }
      catch { status.textContent = "Not saved \u2014 check your connection"; }
    }, 500);
  };
  const drawCount = () => { count.textContent = `${filled().length} of ${MAX_CLUBS} clubs`; };

  const row = (c, i) => {
    const cat = el("select", { "aria-label": `Slot ${i + 1} club` }, [el("option", { value: "" }, "Club\u2026"), ...CLUB_CATS.map((k) => el("option", { value: k, selected: c.cat === k }, k))]);
    const type = el("select", { "aria-label": `Slot ${i + 1} type`, disabled: !c.cat });
    const fillTypes = () => mount(type, [el("option", { value: "" }, c.cat ? "Type\u2026" : "\u2014"), ...(CLUB_TYPES[c.cat] || []).map((t) => el("option", { value: t, selected: c.type === t }, t))]);
    fillTypes();
    const input = (field, ph, max) => {
      const inp = el("input", { value: c[field] || "", placeholder: ph, maxLength: max, autocomplete: "off", "aria-label": `Slot ${i + 1} ${ph.toLowerCase()}`, disabled: !c.cat });
      inp.addEventListener("input", () => { c[field] = inp.value; save(); });
      return inp;
    };
    const brand = input("brand", "Brand", 40), model = input("model", "Model", 50), note = input("note", "Note", 120);
    cat.addEventListener("change", () => {
      c.cat = cat.value;
      c.type = c.cat === "Putter" ? "Putter" : (CLUB_TYPES[c.cat] || []).includes(c.type) ? c.type : "";
      [type, brand, model, note].forEach((x) => { x.disabled = !c.cat; });
      fillTypes(); drawCount(); save();
    });
    type.addEventListener("change", () => { c.type = type.value; drawCount(); save(); });
    const clear = el("button", { type: "button", class: "entry-del", "aria-label": `Clear slot ${i + 1}`, title: "Clear" }, "\u2715");
    clear.addEventListener("click", () => { clubs[i] = blank(); draw(); save(); });
    return el("div", { class: "bag-row" }, [el("span", { class: "bag-n" }, String(i + 1)), cat, type, brand, model, note, clear]);
  };
  const draw = () => { mount(list, clubs.map(row)); drawCount(); };

  const drawOld = () => mount(oldBox, history.length ? history.map((b, i) => {
    const del = el("button", { type: "button", class: "link danger" }, "Delete");
    del.addEventListener("click", async () => {
      if (!confirmAction("Delete this old bag from your history?")) return;
      history = history.filter((_, j) => j !== i);
      drawOld();
      try { await saveBagHistory(uid, history); } catch { /* shown again on next load */ }
    });
    const sorted = [...b.clubs].sort((x, y) => clubRank(clubLabel(x)) - clubRank(clubLabel(y)));
    return el("details", { class: "old-bag" }, [
      el("summary", {}, [el("strong", {}, `${b.from ? fmtDate(b.from) : "Earlier"} \u2013 ${fmtDate(b.to)}`), el("span", { class: "muted" }, ` \u00b7 ${b.clubs.length} clubs`)]),
      el("ul", {}, sorted.map((c) => el("li", {}, [el("strong", {}, clubLabel(c)), clubMake(c) ? ` \u00b7 ${clubMake(c)}` : "", c.note ? el("span", { class: "muted" }, ` \u2014 ${c.note}`) : null]))),
      del,
    ]);
  }) : el("p", { class: "muted small" }, "When you change clubs, the bag you had is kept here with the dates you used it."));

  const sortBtn = el("button", { type: "button", class: "btn ghost" }, "Sort Driver \u2192 Putter");
  sortBtn.addEventListener("click", () => {
    const f = clubs.filter((c) => c.cat && c.type).sort((a, b) => clubRank(clubLabel(a)) - clubRank(clubLabel(b)));
    clubs = [...f, ...Array.from({ length: MAX_CLUBS - f.length }, blank)];
    draw(); save();
  });

  mount(main, [
    el("header", { class: "page-head" }, [el("h1", {}, "What's in the bag"), el("p", { class: "muted" }, ["Up to 14 clubs. These become the Club choices on each shot in Data Entry. ", status])]),
    el("section", { class: "panel bag-panel" }, [
      el("div", { class: "bag-top" }, [count, sortBtn]),
      el("div", { class: "bag-head" }, ["#", "Club", "Type", "Brand", "Model", "Note", ""].map((h) => el("span", {}, h))),
      list,
    ]),
    el("section", { class: "panel bag-panel" }, [el("h3", {}, "Old bags"), oldBox]),
  ]);
  draw(); drawOld();

  const unsub = watchBagDoc(uid, (d) => {
    history = d.history || [];
    drawOld();
    if (loaded) return; // after the first load, the page is the source of truth for the current clubs
    loaded = true;
    since = d.since || null;
    const saved = (d.clubs || []).map((c) => ({ cat: c.cat, type: c.type, brand: c.brand || "", model: c.model || "", note: c.note || "" }));
    // A separate copy: editing the rows must not change the bag you started with.
    opened = { clubs: saved.map((c) => ({ ...c })), from: since, makeup: bagMakeup(saved) };
    clubs = [...saved.map((c) => ({ ...c })), ...Array.from({ length: Math.max(0, MAX_CLUBS - saved.length) }, blank)].slice(0, MAX_CLUBS);
    draw();
  });

  // Leaving the page: if the clubs themselves changed, file the bag you started with under Old bags.
  const archive = async () => {
    if (archived || !opened || !opened.clubs.length) return;
    if (bagMakeup(filled()) === opened.makeup) return;
    archived = true;
    clearTimeout(timer);
    try { await saveBag(uid, filled(), { history, oldBag: { clubs: opened.clubs, from: opened.from } }); } catch { archived = false; }
  };
  window.addEventListener("pagehide", archive);
  return () => { unsub(); window.removeEventListener("pagehide", archive); archive(); };
}
