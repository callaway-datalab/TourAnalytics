// Goals, in three levels you can fold: SG Total → each category → each skill (category + distance).
// Every level has a slider: its left end is the player's worst 10-round average, the right end their best,
// and it starts where they are now (their last 10 rounds). Set a goal at any level (e.g. just "+0.50 SG
// Total"), pick a deadline, save, and follow the progress. Players set their own; coaches and the admin can too.
import { el, mount } from "../ui.js";
import { getState } from "../auth.js";
import { loadSource } from "../reportGen.js";
import { goalLevels, watchGoals, saveGoals } from "../goals.js";
import { teamPlayerSelect } from "../teamPlayerSelect.js";

const fmt = (v) => (v == null || !Number.isFinite(v) ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}`);
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** #/goals: your own goals, or (a coach, the admin's preview) the player's. */
export async function render(main, { previewClient, flash }) {
  const state = getState();
  const playerKey = previewClient ? previewClient.key : state.profile?.clientKey;
  if (!playerKey) return;
  const label = previewClient?.label || state.profile?.name || "My";
  const box = el("div");
  mount(main, [teamPlayerSelect(previewClient, "/goals"), box]);
  const panel = goalsPanel(box, { playerKey, label, flash, own: !previewClient });
  return () => panel.destroy();
}

export function goalsPanel(container, { playerKey, label, flash = () => {}, own = false }) {
  const state = getState();
  let levels = [], goals = null, editing = false, draft = {}, deadline = "", source = "", unsub = () => {}, alive = true;
  const folded = new Set(); // levels folded away (start fully open)
  const whose = own || label === "My" ? "My" : `${label}'s`;
  mount(container, el("p", { class: "muted center" }, "Loading\u2026"));
  (async () => {
    try {
      let data = await loadSource("tour", playerKey, label); source = "Tour Events";
      if (!data || !data.me.rounds.length) { data = await loadSource("entered", playerKey, label); source = "Entered Rounds"; }
      if (!alive) return;
      levels = data && data.me.rounds.length ? goalLevels(data.me) : [];
      if (!levels.length) { mount(container, el("p", { class: "empty center" }, "Not enough rounds yet to set goals on (at least 3).")); return; }
      unsub = watchGoals(playerKey, (g) => { goals = g; if (!editing) draw(); });
    } catch (err) { console.error(err); mount(container, el("p", { class: "empty center" }, "Couldn't load the stats for goals.")); }
  })();
  const saved = () => goals?.skills || {};
  const draw = () => { if (!alive) return; if (editing || !Object.keys(saved()).length) editor(); else dashboard(); };
  const win = () => levels[0]?.win || 10;

  /* ---------------- progress ---------------- */
  function dashboard() {
    const list = Object.entries(saved()).map(([key, g]) => ({ key, g, s: levels.find((x) => x.key === key) })).filter((x) => x.s);
    const lv = { total: 0, cat: 1, skill: 2 };
    list.sort((a, b) => lv[a.s.level] - lv[b.s.level] || levels.indexOf(a.s) - levels.indexOf(b.s));
    const status = ({ g, s }) => {
      const reached = s.now >= g.value, span = g.value - g.start;
      const pct = reached ? 1 : span > 0 ? Math.max(0, Math.min(1, (s.now - g.start) / span)) : 0;
      return { reached, pct, word: reached ? "Achieved" : s.now > g.start + 0.005 ? "Getting closer" : s.now < g.start - 0.005 ? "Going backwards" : "Not moved yet" };
    };
    const done = list.filter((x) => status(x).reached).length;
    const dl = goals?.deadline;
    const daysLeft = dl ? Math.ceil((new Date(`${dl}T23:59:59`) - new Date()) / 86400000) : null;
    const edit = el("button", { type: "button", class: "btn ghost" }, "Edit goals");
    edit.addEventListener("click", () => { editing = true; draft = Object.fromEntries(Object.entries(saved()).map(([k, g]) => [k, { ...g }])); deadline = goals?.deadline || ""; draw(); });
    mount(container, [
      el("div", { class: "goals-head" }, [
        el("div", {}, [el("h2", {}, `${whose} goals`), el("p", { class: "muted small" }, `${source} \u00b7 now = the last ${win()} rounds`)]),
        edit,
      ]),
      el("div", { class: "goals-score" }, [
        el("div", {}, [el("strong", {}, `${done} of ${list.length}`), ` goal${list.length === 1 ? "" : "s"} reached`]),
        dl ? el("div", { class: `goals-deadline${daysLeft != null && daysLeft < 0 ? " past" : ""}` }, [el("span", {}, "Deadline"), el("strong", {}, fmtDay(dl)),
          el("span", {}, daysLeft == null ? "" : daysLeft > 1 ? `${daysLeft} days left` : daysLeft === 1 ? "1 day left" : daysLeft === 0 ? "today" : "passed")]) : null,
      ]),
      el("div", { class: "goal-cards" }, list.map((x) => {
        const st = status(x), { g, s } = x;
        return el("article", { class: `goal-card lvl-${s.level}${st.reached ? " reached" : ""}` }, [
          el("div", { class: "goal-card-top" }, [el("h3", {}, s.label), el("span", { class: `goal-pill ${st.reached ? "ok" : st.word === "Going backwards" ? "bad" : ""}` }, st.word)]),
          el("div", { class: "goal-track" }, [el("div", { class: "goal-fill", style: `width:${Math.round(st.pct * 100)}%` })]),
          el("div", { class: "goal-nums" }, [
            el("div", {}, [el("span", { class: "gl" }, "Start"), el("strong", {}, fmt(g.start))]),
            el("div", {}, [el("span", { class: "gl" }, "Now"), el("strong", {}, fmt(s.now))]),
            el("div", {}, [el("span", { class: "gl" }, "Goal"), el("strong", {}, fmt(g.value))]),
          ]),
        ]);
      })),
      el("p", { class: "muted small" }, "Strokes gained a round. Start is where it was when the goal was set; Now is the average of the last rounds."),
    ]);
  }

  /* ---------------- setting goals: SG Total → categories → skills, each foldable ---------------- */
  function editor() {
    const total = levels.find((l) => l.level === "total");
    const cats = levels.filter((l) => l.level === "cat");
    const skillsOf = (cat) => levels.filter((l) => l.level === "skill" && l.cat === cat);
    const dateIn = el("input", { type: "date", value: deadline, "aria-label": "Deadline" });
    dateIn.addEventListener("change", () => { deadline = dateIn.value; });
    const save = el("button", { type: "button", class: "btn" }, "Save goals");
    const cancel = Object.keys(saved()).length ? el("button", { type: "button", class: "link" }, "Cancel") : null;
    cancel?.addEventListener("click", () => { editing = false; draft = {}; draw(); });
    save.addEventListener("click", async () => {
      const out = {};
      for (const [k, g] of Object.entries(draft)) {
        const s = levels.find((x) => x.key === k); if (!s) continue;
        out[k] = { value: Math.round(g.value * 1000) / 1000, start: Math.round(s.now * 1000) / 1000, label: s.label, setAt: new Date().toISOString().slice(0, 10) };
        if (saved()[k]?.start != null) { out[k].start = saved()[k].start; out[k].setAt = saved()[k].setAt || out[k].setAt; } // keeps where it started
      }
      if (!Object.keys(out).length) { flash("Move a slider to set at least one goal.", "error"); return; }
      save.disabled = true;
      try { await saveGoals(playerKey, out, deadline || null, state.user.uid); editing = false; goals = { skills: out, deadline: deadline || null }; draw(); flash("Goals saved.", "ok"); }
      catch (err) { console.error(err); flash("Couldn't save the goals. Try again.", "error"); save.disabled = false; }
    });
    const branch = (node, kids) => {
      const open = !folded.has(node.key);
      return el("div", { class: `goal-branch lvl-${node.level}` }, [row(node, kids.length ? open : null), open && kids.length ? el("div", { class: "goal-kids" }, kids) : null]);
    };
    mount(container, [
      el("div", { class: "goals-head" }, [
        el("div", {}, [el("h2", {}, `Set ${whose === "My" ? "my" : whose} goals`), el("p", { class: "muted small" },
          `Each slider runs from the worst to the best ${win()}-round average; the gold mark is now (the last ${win()} rounds). Set a goal at any level: SG Total, a category, or one skill. Fold a level with \u25BE.`)]),
      ]),
      el("div", { class: "goals-toolbar" }, [el("label", { class: "goal-deadline-in" }, ["Deadline", dateIn])]),
      el("section", { class: "panel goal-tree" }, [
        total ? branch(total, cats.map((c) => branch(c, skillsOf(c.cat).map((sk) => branch(sk, []))))) : null,
      ]),
      el("div", { class: "goals-actions" }, [save, cancel]),
    ]);
  }

  function row(s, open) {
    const g = draft[s.key];
    const lo = Math.min(s.worst, s.now, g?.value ?? Infinity), hi = Math.max(s.best, s.now, g?.value ?? -Infinity);
    const readout = el("span", { class: "goal-readout" });
    const onOff = el("input", { type: "checkbox", checked: !!g, "aria-label": `Goal for ${s.label}` });
    const slider = el("input", { type: "range", min: lo, max: hi, step: 0.01, value: g?.value ?? s.now, "aria-label": `${s.label}: goal` });
    const show = () => { const d = draft[s.key]; readout.textContent = d ? `Goal: ${fmt(d.value)}` : "No goal"; readout.classList.toggle("off", !d); };
    slider.addEventListener("input", () => { draft[s.key] = { value: Math.round(Number(slider.value) * 100) / 100 }; onOff.checked = true; show(); }); // (two decimals, as shown)
    onOff.addEventListener("change", () => { if (onOff.checked) draft[s.key] = { value: Math.round(Math.min(hi, s.now + 0.05) * 100) / 100 }; else delete draft[s.key]; editor(); });
    show();
    const frac = (s.now - lo) / (hi - lo || 1);
    const fold = open === null ? null : el("button", { type: "button", class: "goal-fold", "aria-expanded": open ? "true" : "false", "aria-label": `${open ? "Fold" : "Open"} ${s.label}` }, open ? "\u25BE" : "\u25B8");
    fold?.addEventListener("click", () => { if (folded.has(s.key)) folded.delete(s.key); else folded.add(s.key); editor(); });
    return el("div", { class: `goal-row lvl-${s.level}` }, [
      el("div", { class: "goal-row-top" }, [
        el("div", { class: "goal-name-wrap" }, [fold, el("label", { class: "goal-name" }, [onOff, s.label])]),
        el("span", { class: "goal-now" }, `Now ${fmt(s.now)}`),
      ]),
      el("div", { class: "goal-slider" }, [slider, el("span", { class: "goal-nowmark", style: `left:calc(${frac * 100}% + ${((0.5 - frac) * 16).toFixed(1)}px)`, title: "Now" })]),
      el("div", { class: "goal-ends" }, [el("span", {}, `Worst ${fmt(s.worst)}`), readout, el("span", {}, `Best ${fmt(s.best)}`)]),
    ]);
  }

  return { destroy() { alive = false; unsub(); } };
}
