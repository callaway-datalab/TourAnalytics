// (update 815) What the Player Dossier, Course Fit and Practice Week pages share: who can be picked (the admin: anyone;
// a coach or caddie: their players; a player: themself), the picked player kept in the address (?player=), a section
// card, and the small number formats.
import { el } from "../ui.js";
import { getState } from "../auth.js";
import { effectiveTeam } from "../preview.js";
import { teamLabels, plainName } from "../names.js";

export const sg2 = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) < 0.005 ? "0.00" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);
export const sg3 = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) < 0.0005 ? "0.000" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`);
export const cls = (v) => (v == null ? "" : v > 0.005 ? "pos" : v < -0.005 ? "neg" : "");
export const ord = (n) => `${n}${["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;

/** { self, labels: Map(key → name), favs: [keys] } for the person signed in */
export async function whoCanBePicked(previewClient) {
  const state = getState(), team = effectiveTeam(state);
  if (previewClient?.key) return { state, self: previewClient.key, labels: new Map([[previewClient.key, previewClient.label || "Player"]]), favs: [previewClient.key] };
  if (!state.isAdmin && !state.isTeam && state.profile?.clientKey) return { state, self: state.profile.clientKey, labels: new Map([[state.profile.clientKey, state.profile.name || "Me"]]), favs: [state.profile.clientKey] };
  let labels = new Map();
  if (state.isAdmin && !team.preview) { const { adminAllClients } = await import("../store.js"); labels = new Map([...((await adminAllClients().catch(() => ({ labels: new Map() }))).labels)].map(([k, l]) => [k, plainName(l)])); }
  else labels = new Map([...teamLabels(team.teamAccess || {})].map(([k, l]) => [k, plainName(l)]));
  let favs = []; try { const wl = await import("../watchlist.js"); await wl.loadWatch(true).catch(() => {}); favs = (wl.watchPrefs().players || []).filter((k) => labels.has(k) || state.isAdmin); } catch { /* */ }
  for (const k of favs) if (!labels.has(k)) labels.set(k, k.replace(/^c_/, ""));
  return { state, self: null, labels, favs };
}
export const pickedFromHash = () => { const m = /[?&]player=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
export const setPickedInHash = (k) => { const base = location.hash.split("?")[0], q = new URLSearchParams(location.hash.split("?")[1] || ""); if (k) q.set("player", k); else q.delete("player"); history.replaceState(null, "", `${base}${q.toString() ? `?${q}` : ""}`); };

/** the pills of the favorites, and a search over everyone (a <select> with type-ahead) */
export function playerBar(who, current, onPick) {
  if (who.self) return null;
  const favs = who.favs.filter((k) => who.labels.has(k));
  const pills = el("div", { class: "ip-pills", role: "group", "aria-label": "Favorites" }, favs.map((k) => { const on = k === current, b = el("button", { type: "button", class: `ip-pill${on ? " on" : ""}`, "aria-pressed": String(on) }, who.labels.get(k)); b.addEventListener("click", () => onPick(k)); return b; }));
  const all = [...who.labels].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const sel = el("select", { class: "ip-sel", "aria-label": "Any player" }, [el("option", { value: "" }, "Any player…"), ...all.map(([k, l]) => el("option", { value: k }, l))]);
  if (current && !favs.includes(current)) sel.value = current;
  sel.addEventListener("change", () => { if (sel.value) onPick(sel.value); });
  return el("div", { class: "ip-bar" }, [pills, sel]);
}
export const card = (title, color, body, cls0 = "") => el("section", { class: `ip-card ${cls0}`, style: `--ipc:${color}` }, [el("p", { class: "ip-kick" }, title), ...[].concat(body)]);
export const samp = (t) => el("p", { class: "ip-samp" }, t);
