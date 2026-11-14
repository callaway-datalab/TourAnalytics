// (update 726) After a question on Home takes you to a page: a small pop-up, "How Cal answers this", saying how the
// answer was worked out and what to look at, once per question unless "Don't show again" (kept on this device).
//   sessionStorage "ta.explain": { id, q, steps: [text], at }   localStorage "ta.explainOff": [ids]
import { el } from "./ui.js";

const offIds = () => { try { return new Set(JSON.parse(localStorage.getItem("ta.explainOff") || "[]")); } catch { return new Set(); } };
export function queueExplain(x) { try { sessionStorage.setItem("ta.explain", JSON.stringify({ ...x, at: Date.now() })); } catch { /* */ } }
export function showExplain() {
  let x = null; try { x = JSON.parse(sessionStorage.getItem("ta.explain") || "null"); sessionStorage.removeItem("ta.explain"); } catch { return; }
  if (!x || !x.steps?.length || Date.now() - (x.at || 0) > 30000 || offIds().has(x.id)) return;
  document.querySelector(".ax-wrap")?.remove();
  const close = () => wrap.remove();
  const got = el("button", { type: "button", class: "btn ax-got" }, "Got it"), never = el("button", { type: "button", class: "btn ghost ax-never" }, "Don’t show again");
  got.addEventListener("click", close);
  never.addEventListener("click", () => { const s = offIds(); s.add(x.id); try { localStorage.setItem("ta.explainOff", JSON.stringify([...s])); } catch { /* */ } close(); });
  const back = el("div", { class: "ax-back" }); back.addEventListener("click", close);
  const wrap = el("div", { class: "ax-wrap" }, [back, el("section", { class: "ax-pop", role: "dialog", "aria-modal": "true", "aria-label": "How Cal answers this" }, [
    el("p", { class: "ax-k" }, "HOW CAL ANSWERS THIS"), el("h3", { class: "ax-q" }, x.q),
    ...x.steps.map((t, i) => el("div", { class: "ax-step" }, [el("span", { class: "ax-n" }, String(i + 1)), el("p", {}, t)])),
    el("div", { class: "ax-btns" }, [never, got])])]);
  setTimeout(() => { document.body.appendChild(wrap); got.focus(); }, 700);
}
