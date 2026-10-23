// (update 267) A minimal keyboard on phones: no word suggestions, autocorrect or spell-check underlines, and no
// "AutoFill Contact" in the portal's own fields. Set on every text box as it's added to the page (iOS decides how
// the keyboard looks when the box is tapped, so it has to be there before). Sign-in boxes keep their autofill
// (email and password): anything with its own autocomplete setting (other than "off") is left as it is, and so is
// anything marked data-keep-keyboard.
const TEXT = new Set(["", "text", "search", "url", "tel", "number"]);
let n = 0;
// (update 271) A number pad stays cleanest with nothing but inputmode (test N on an iPhone): autocomplete="off",
// pattern, maxlength or enterkeyhint each bring back the "one-time code" suggestion above the keys. So those come
// off any text box with a number pad, and the length limit is kept by trimming what's typed instead.
function numPad(box) {
  for (const a of ["autocomplete", "autocorrect", "spellcheck", "pattern", "enterkeyhint", "name"]) box.removeAttribute(a);
  const max = box.maxLength > 0 ? box.maxLength : 0;
  box.removeAttribute("maxlength");
  if (max) box.addEventListener("input", () => { if (box.value.length > max) box.value = box.value.slice(0, max); }, true);
  box.dataset.kbQuiet = "1";
}
function quiet(box) {
  if (box.dataset.keepKeyboard != null || box.dataset.kbQuiet) return;
  if (box instanceof HTMLInputElement && box.type === "text" && /^(numeric|decimal)$/.test(box.inputMode)) return numPad(box);
  if (box instanceof HTMLInputElement && !TEXT.has(box.type)) return;
  const ac = box.getAttribute("autocomplete");
  if (ac && ac !== "off") return; // (email, password, name: their autofill is wanted)
  box.setAttribute("autocomplete", "off");
  box.setAttribute("autocorrect", "off");
  box.setAttribute("spellcheck", "false");
  // Safari offers contact autofill from a box's name and label ("location", "city" …): a name of its own stops that guess
  if (!box.name) box.setAttribute("name", `f${(++n).toString(36)}`);
  box.dataset.kbQuiet = "1";
}
function scan(node) {
  if (node.nodeType !== 1) return;
  if (node.matches("input, textarea")) quiet(node);
  node.querySelectorAll?.("input, textarea").forEach(quiet);
}
export function minimalKeyboard() {
  scan(document.body);
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(scan); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("focusin", (e) => { if (e.target.matches?.("input, textarea")) quiet(e.target); }, true); // (and any missed)
}
