// Pages that are on the way: Live Event Feed (under Data) and Practice (under Planning).
import { el, mount } from "../ui.js";

const PAGES = {
  live: { eyebrow: "Analyze", title: "Live Event Feed", text: "Follow a round hole by hole as it's played, with strokes gained updating after every shot." },
  // (update 163)
  "product-usage": { eyebrow: "Analyze", title: "Product Usage", text: "Dashboards on how Callaway products are used across the Tour and by each player, and how players perform with each one, to see which products work best for which players." },
  practice: { eyebrow: "Planning", title: "Practice", text: "Practice plans built from your strokes-gained data, and a log of what you've worked on." },
  "practice-recs": { eyebrow: "Planning \u00b7 Practice", title: "Practice Recommendations", text: "Drills and focus areas picked from where you're losing the most strokes." },
  "practice-tracking": { eyebrow: "Planning \u00b7 Practice", title: "Practice Tracking", text: "Log your sessions and see how practice lines up with your results on the course." },
};

export function render(main, { routeId }) {
  const p = PAGES[routeId] || PAGES.live;
  const practice = routeId.startsWith("practice");
  // Practice has two parts of its own
  const tabs = practice ? el("nav", { class: "subnav small soon-tabs", "aria-label": "Practice" }, [["practice-recs", "#/practice/recommendations", "Practice Recommendations"], ["practice-tracking", "#/practice/tracking", "Practice Tracking"]]
    .map(([id, href, l]) => el("a", { href, "aria-current": routeId === id ? "page" : null }, l))) : null;
  mount(main, [tabs, el("section", { class: "panel soon-panel" }, [
    el("p", { class: "gx-eyebrow" }, p.eyebrow),
    el("h1", {}, p.title),
    el("span", { class: "soon-badge" }, "Coming soon"),
    el("p", { class: "muted" }, p.text),
  ])]);
}
