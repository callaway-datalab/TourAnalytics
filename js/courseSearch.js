// Course search for Data Entry: a type-ahead list that narrows with each letter.
//   1. Courses you've played before (instant, and picking one also refills that course's scorecard).
//   2. Golf courses from OpenStreetMap (via the free Photon search service), with their town, so the
//      location fills itself in. "Courses near me" uses the phone's location if you allow it.
import { el, mount } from "./ui.js";

const PHOTON = "https://photon.komoot.io/api/";
const US_STATES = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY" };

/** "La Jolla, CA" / "St Andrews, Scotland" from a Photon result's properties. */
export function placeLabel(p = {}) {
  const town = p.city || p.town || p.village || p.district || p.county || "";
  const us = (p.countrycode || "").toUpperCase() === "US";
  const region = us ? (US_STATES[p.state] || p.state || "") : (p.state && p.state !== town ? p.state : p.country || "");
  return [town, region].filter(Boolean).join(", ");
}

export async function searchCourses(text, near) {
  const q = new URLSearchParams({ q: text || "golf", limit: "8", lang: "en" });
  q.append("osm_tag", "leisure:golf_course");
  if (near) { q.set("lat", String(near.lat)); q.set("lon", String(near.lon)); }
  const res = await fetch(`${PHOTON}?${q}`);
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  return (data.features || []).map((f) => ({ name: f.properties?.name || "", location: placeLabel(f.properties) }))
    .filter((c) => c.name && !seen.has(`${c.name}|${c.location}`) && seen.add(`${c.name}|${c.location}`));
}

/**
 * Turn a text input into a course picker.
 *   history: [{ name, location, holes, date }] from your earlier rounds (newest first)
 *   onPick({ name, location, holes? })
 */
export function courseCombobox(input, { history = [], onPick }) {
  const listId = "course-list-" + Math.random().toString(36).slice(2, 7);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");
  const list = el("ul", { class: "combo-list", id: listId, role: "listbox", hidden: true });
  const wrap = el("div", { class: "combo" }, [input, list]);
  let items = [], active = -1, timer = null, seq = 0, near = null;

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const choose = (it) => { input.value = it.name; close(); onPick(it); };
  const draw = (groups, msg) => {
    items = groups.flatMap((g) => g.items);
    let n = 0;
    mount(list, [
      ...groups.filter((g) => g.items.length).flatMap((g) => [
        el("li", { class: "combo-head", role: "presentation" }, g.title),
        ...g.items.map((it) => {
          const i = n++;
          const li = el("li", { class: "combo-item" + (i === active ? " on" : ""), role: "option", id: `${listId}-${i}`, "aria-selected": i === active ? "true" : "false" }, [
            el("strong", {}, it.name), it.location ? el("span", { class: "muted" }, it.location) : null,
            it.holes ? el("span", { class: "combo-tag" }, "scorecard saved") : null,
          ]);
          li.addEventListener("pointerdown", (e) => { e.preventDefault(); choose(it); }); // before the input loses focus
          return li;
        }),
      ]),
      msg ? el("li", { class: "combo-msg", role: "presentation" }, msg) : null,
    ]);
    const show = items.length || msg;
    list.hidden = !show;
    input.setAttribute("aria-expanded", show ? "true" : "false");
    input.setAttribute("aria-activedescendant", active >= 0 ? `${listId}-${active}` : "");
  };

  const mine = (t) => history.filter((h) => !t || h.name.toLowerCase().includes(t) || (h.location || "").toLowerCase().includes(t)).slice(0, 5);

  const update = () => {
    const text = input.value.trim();
    const t = text.toLowerCase();
    const first = { title: "Your courses", items: mine(t) };
    clearTimeout(timer);
    if (text.length < 3 && !near) { draw([first], text ? "Keep typing to search all courses\u2026" : (navigator.geolocation ? null : null)); return; }
    draw([first], "Searching\u2026");
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const found = (await searchCourses(text, near)).filter((c) => !first.items.some((m) => m.name.toLowerCase() === c.name.toLowerCase()));
        if (my !== seq) return;
        draw([first, { title: near && !text ? "Near you" : "All courses", items: found }], found.length || first.items.length ? null : "No courses found \u2014 just type the name.");
      } catch {
        if (my === seq) draw([first], "Course search isn't available right now \u2014 just type the name.");
      }
    }, 300);
  };

  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      list.querySelectorAll(".combo-item").forEach((li, i) => { li.classList.toggle("on", i === active); li.setAttribute("aria-selected", i === active ? "true" : "false"); });
      input.setAttribute("aria-activedescendant", `${listId}-${active}`);
      list.querySelector(".combo-item.on")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === "Escape") close();
  });

  // "Courses near me": bias the search to where the phone is.
  const nearBtn = navigator.geolocation ? el("button", { type: "button", class: "link near-btn" }, "\uD83D\uDCCD Courses near me") : null;
  nearBtn?.addEventListener("click", () => {
    nearBtn.textContent = "Finding you\u2026";
    navigator.geolocation.getCurrentPosition(
      (pos) => { near = { lat: pos.coords.latitude, lon: pos.coords.longitude }; nearBtn.textContent = "\uD83D\uDCCD Showing courses near you"; input.focus(); update(); },
      () => { nearBtn.textContent = "\uD83D\uDCCD Location not available"; },
      { timeout: 8000, maximumAge: 600000 },
    );
  });
  return { node: el("div", {}, [wrap, nearBtn]) };
}

/** Your earlier courses, newest first, one entry per course (with its location and scorecard). */
export function courseHistory(rounds) {
  const out = new Map();
  for (const r of [...rounds].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    const k = (r.course || "").trim().toLowerCase();
    if (!k || out.has(k)) continue;
    out.set(k, { name: r.course.trim(), location: r.location || "", tees: r.tees || "", holes: r.holes || null, date: r.date });
  }
  return [...out.values()];
}
