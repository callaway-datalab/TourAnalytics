import { el, mount } from "../ui.js";
import { getState, subscribe } from "../auth.js";
import { roleLabel } from "../data.js";

// Landing page for a team member (coach, caddy, ...): the players they've been given access to.
export async function render(main) {
  const list = el("ul", { class: "rows" });
  const firstName = (getState().profile?.name || "").split(" ")[0];

  mount(main, [
    el("header", { class: "page-head" }, [
      el("h1", {}, firstName ? `Hello, ${firstName}` : "My players"),
      el("p", { class: "muted" }, "Choose a player to see their data and documents. You can look, but not change anything."),
    ]),
    el("section", {}, [el("h2", {}, "My players"), list]),
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
            el("span", { class: "muted" }, `You're their ${roleLabel(p.role).toLowerCase() || "team member"}`),
          ]),
          el("span", { class: "row-meta" }, el("span", { class: "tag" }, roleLabel(p.role))),
        ]))
      : el("p", { class: "empty" }, "You haven't been given access to any players yet. The administrator will add them for you."));
  };
  return subscribe(draw);
}
