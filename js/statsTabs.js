// (update 817) Stats' own tabs beyond Full stats / Focus / Tournament Results: Overview (the player's page), Course Fit (every
// course and tournament ranked for them) and Practice & Goals (the practice week, the practice sessions and the goals).
// Each is for the player Stats has (the header's player); the dashboard keeps what's drawn here while it redraws.
import { el, mount } from "./ui.js";

const flash = () => {};
export async function fill(box, kind, me, { st }) {
  const pv = window.__previewClient || null, name = me.label || me.key.replace(/^c_/, "");
  if (kind === "overview") { const m = await import("./views/dossier.js"); return m.overview(box, me.key, name); }
  if (kind === "fit") { const m = await import("./views/courseFit.js"); return m.fitTab(box, me.key, name); }
  // (update 827) Compare, on the Stats page (it opens on the header's player, as on its own page)
  if (kind === "compare") { const inner = el("div", { class: "st-cmp" }); mount(box, inner); try { await (await import("./views/comparisons.js")).render(inner, { previewClient: pv, flash, routeId: "comparisons" }); } catch (e) { console.error(e); mount(inner, el("p", { class: "muted center" }, "Couldn’t open Compare just now.")); } return; }
  // Practice & Goals: three parts, one at a time (the plan for the week first)
  const PARTS = [["week", "Recommended Practice"], ["practice", "Custom Practice"], ["goals", "Goals"]];
  const body = el("div", { class: "st-pg-body" });
  const pills = el("div", { class: "ip-pills st-pg-pills", role: "group", "aria-label": "Practice & Goals" });
  const show = async (sub) => { st.pgSub = sub;
    mount(pills, PARTS.map(([v, l]) => { const b = el("button", { type: "button", class: `ip-pill${v === sub ? " on" : ""}`, "aria-pressed": String(v === sub) }, l); b.addEventListener("click", () => { if (v !== sub) show(v); }); return b; }));
    const inner = el("div", {}); mount(body, inner);
    try {
      if (sub === "week") await (await import("./views/practiceWeek.js")).render(inner, { previewClient: pv, key: me.key, label: name });
      else if (sub === "practice") await (await import("./views/practiceSimple.js")).render(inner, { previewClient: pv, flash });
      else { const st0 = window.__authState || {}; if (st0.isAdmin && !pv) await (await import("./views/adminGoals.js")).render(inner, { flash }); else await (await import("./views/goals.js")).render(inner, { previewClient: pv, flash }); }
    } catch (e) { console.error(e); mount(inner, el("p", { class: "muted center" }, "Couldn’t open this just now.")); }
  };
  mount(box, [el("div", { class: "ip ip-embed st-pg-top" }, pills), body]);
  await show(PARTS.some(([v]) => v === st.pgSub) ? st.pgSub : "week");
}
