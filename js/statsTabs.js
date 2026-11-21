// (update 817) Stats' own tabs beyond Full stats / Focus / Tournament Results: Overview (the player's page), Course Fit (every
// course and tournament ranked for them) and Practice & Goals (the practice week, the practice sessions and the goals).
// Each is for the player Stats has (the header's player); the dashboard keeps what's drawn here while it redraws.
import { el, mount } from "./ui.js";

const flash = () => {};
export async function fill(box, kind, me, { st }) {
  if (kind === "scout" && !me) { if (!window.__taScout) return; const m = await import("./views/scouting.js"); return m.scoutTab(box, null, ""); } // (update 928: no player picked)
  const pv = window.__previewClient || null, name = me.label || me.key.replace(/^c_/, "");
  if (kind === "overview") { const m = await import("./views/dossier.js"); return m.overview(box, me.key, name); }
  if (kind === "scout" && !window.__taScout) { mount(box, el("div", { class: "ip ip-embed" }, el("p", { class: "muted" }, "Scouting isn't open for your account. Ask Callaway to turn it on."))); return; } // (update 891)
  if (kind === "scout") { const m = await import("./views/scouting.js"); return m.scoutTab(box, me.key, name); } // (update 889)
  if (kind === "fit") { const m = await import("./views/courseFit.js"); return m.fitTab(box, me.key, name); }
  // (update 829) What's in the Bag, for the player Stats has
  // (update 829) What's in the Bag, for the player Stats has; (update 830) and a switch to your own bag ("My bag")
  if (kind === "bag") {
    const st0 = window.__authState || {}, myKey = st0.isAdmin && !st0.profile?.clientKey ? `a_${st0.user?.uid}` : st0.profile?.clientKey;
    const isPlayer = !st0.isAdmin && !st0.isTeam && st0.profile?.kind !== "analyst", canMine = !isPlayer && !pv && me.key !== myKey;
    const inner = el("div", { class: "st-bag" }), sw = el("div", { class: "ip ip-embed st-pg-top" });
    const show = async (mine) => {
      if (canMine) mount(sw, el("div", { class: "ip-pills st-pg-pills", role: "group", "aria-label": "Whose bag" }, [[false, `${name}’s bag`], [true, "My bag"]].map(([v, l]) => { const b = el("button", { type: "button", class: `ip-pill${v === mine ? " on" : ""}`, "aria-pressed": String(v === mine) }, l); b.addEventListener("click", () => { if (v !== mine) show(v); }); return b; })));
      mount(inner, el("p", { class: "muted center" }, "Loading…"));
      try { await (await import("./views/witb.js")).render(inner, { flash, previewClient: pv, playerKey: mine ? null : me.key, playerLabel: name, embedded: true, mine }); }
      catch (e) { console.error(e); mount(inner, el("p", { class: "muted center" }, "Couldn’t open What’s in the Bag just now.")); } };
    mount(box, [sw, inner]); await show(false); return;
  }
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
    } catch (e) { console.error(e); const why = String(e?.message || e || "unknown").slice(0, 160); import("./perf.js").then((p) => p.bootLog(`practice ${sub} failed: ${why}`)).catch(() => {}); // (update 962: why, and Try again)
      const again = el("button", { type: "button", class: "btn small" }, "Try again"); again.addEventListener("click", () => (/dynamically imported module|module script failed|Load failed|Failed to fetch|NetworkError/i.test(why) ? location.reload() : show(sub)));
      mount(inner, el("div", { class: "center" }, [el("p", { class: "muted" }, "Couldn\u2019t open this just now."), again, el("p", { class: "muted small" }, `(${why})`)])); }
  };
  mount(box, [el("div", { class: "ip ip-embed st-pg-top" }, pills), body]);
  await show(PARTS.some(([v]) => v === st.pgSub) ? st.pgSub : "week");
}
