import { el, mount } from "../ui.js";
import { getState, subscribe } from "../auth.js";
import { roleLabel } from "../data.js";

// Landing page for a team member (coach, caddy, ...): the players they've been given access to.
export async function render(main) {
  const list = el("ul", { class: "rows" });

  mount(main, [
    el("p", { class: "muted intro" }, "Choose a player to see their data and reports. You can look, but not change anything."),
    list,
  ]);

  // Re-draw whenever the administrator changes who this person can see.
  const draw = (state) => {
    const players = Object.entries(state.teamAccess || {})
      .map(([key, v]) => ({ key, label: v.label || key.replace(/^c_/, ""), role: v.role }))
      .sort((a, b) => a.label.localeCompare(b.label));
    mount(list, players.length
      ? players.map((p) => el("li", {}, [
          el("a", { class: "row-main", href: `#/view-as/${encodeURIComponent(p.key)}?label=${encodeURIComponent(p.label)}` }, [
            el("span", { class: "row-title" }, p.label),
            el("span", { class: "muted" }, p.role === "analyst" ? "Callaway Access" : `You're their ${roleLabel(p.role).toLowerCase() || "team member"}`),
          ]),
          el("span", { class: "row-meta" }, el("span", { class: "tag" }, roleLabel(p.role))),
        ]))
      : el("p", { class: "empty" }, "You haven't been given access to any players yet. Callaway Analysts will add them for you."));
  };
  return subscribe(draw);
}
