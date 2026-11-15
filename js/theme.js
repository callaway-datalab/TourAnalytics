// (update 731) Dark or light, for every page: picked in the account menu, kept on this device (localStorage "ta.theme").
// Loaded (not as a module) before the styles, so a page never flashes the other theme first. Dark unless light was picked.
(function () {
  var KEY = "ta.theme";
  function get() { try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; } }
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", t === "light" ? "#f6f2ea" : "#08080a");
  }
  apply(get());
  window.taTheme = {
    get: get,
    set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) { /* this device won't remember it */ } apply(t); try { window.dispatchEvent(new CustomEvent("ta-theme", { detail: t })); } catch (e) { /* */ } },
  };
})();
// (update 734) Charts (Chart.js) in the light theme: their text, gridlines and tooltips are turned dark-on-paper; the
// data colors (bars, lines) stay as they are, so they match the legends drawn beside them. window.taThemeCharts() is
// called before each chart is made; it sets itself up once.
(function () {
  function parse(c) {
    if (typeof c !== "string") return null; c = c.trim().toLowerCase();
    if (c === "white") return [255, 255, 255, 1]; if (c === "black") return [0, 0, 0, 1];
    var m = c.match(/^#([0-9a-f]{3,8})$/); if (m) { var h = m[1]; if (h.length < 6) h = h.split("").map(function (x) { return x + x; }).join(""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]; }
    m = c.match(/^rgba?\(([^)]*)\)$/); if (m) { var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    return null;
  }
  function light(c, role) { // role: "text" | "line" | "back"
    var p = parse(c); if (!p) return c;
    var r = p[0] / 255, g = p[1] / 255, b = p[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, s = mx === mn ? 0 : (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
    if (s >= 0.15) return role === "back" ? c : c; // a real color: kept
    if (role === "back") return l < 0.5 ? "rgba(255,253,248," + Math.max(0.94, p[3]) + ")" : c;
    if (p[3] < 0.999 || role === "line") return l > 0.5 ? "rgba(0,0,0," + Math.min(0.5, p[3] * 0.9) + ")" : c;
    if (l > 0.3) { var v = Math.round(255 * Math.max(0.07, (1 - l) * 0.5)); return "rgb(" + v + "," + Math.round(v * 0.97) + "," + Math.round(v * 0.92) + ")"; }
    return c;
  }
  var wrapIt = function (v, role) { return typeof v === "function" ? function () { return light(v.apply(this, arguments), role); } : Array.isArray(v) ? v.map(function (x) { return light(x, role); }) : light(v, role); };
  var PATHS = [["ticks", "color", "text"], ["grid", "color", "line"], ["border", "color", "line"], ["title", "color", "text"], ["pointLabels", "color", "text"], ["angleLines", "color", "line"]];
  function theme(chart) {
    var o = chart.config && chart.config.options; if (!o) return;
    var orig = chart.$taOrig || (chart.$taOrig = new Map()), on = document.documentElement.getAttribute("data-theme") === "light";
    function set(obj, key, role, id) { if (!obj) return; if (!orig.has(id)) orig.set(id, obj[key]); var v = orig.get(id); if (v === undefined) return; obj[key] = on ? wrapIt(v, role) : v; }
    var sc = o.scales || {}; Object.keys(sc).forEach(function (k) { PATHS.forEach(function (pp) { set(sc[k][pp[0]], pp[1], pp[2], "s." + k + "." + pp[0]); }); });
    var pl = o.plugins || {};
    if (pl.legend && pl.legend.labels) set(pl.legend.labels, "color", "text", "legend");
    if (pl.tooltip) { set(pl.tooltip, "backgroundColor", "back", "tt.bg"); ["titleColor", "bodyColor", "footerColor"].forEach(function (k) { set(pl.tooltip, k, "text", "tt." + k); }); set(pl.tooltip, "borderColor", "line", "tt.border"); }
  }
  function defaults() { var C = window.Chart; if (!C || !C.defaults) return; var on = document.documentElement.getAttribute("data-theme") === "light";
    if (!C.$taDef) C.$taDef = { color: C.defaults.color, borderColor: C.defaults.borderColor };
    C.defaults.color = on ? "#2a2825" : C.$taDef.color; C.defaults.borderColor = on ? "rgba(0,0,0,0.12)" : C.$taDef.borderColor; }
  window.taThemeCharts = function () {
    var C = window.Chart; if (!C || C.$taThemed) return; C.$taThemed = true; defaults();
    C.register({ id: "taTheme", beforeInit: theme });
    window.addEventListener("ta-theme", function () { defaults(); var all = C.instances || {}; Object.keys(all).forEach(function (k) { try { theme(all[k]); all[k].update("none"); } catch (e) { /* */ } }); });
  };
})();
// (update 737) Colors set by the pages' code (inline styles, and the fill / stroke of drawn charts) in the light theme:
// grays flipped (white text and lines dark, dark backgrounds light), bright colored text darkened; real colors (bars,
// lines, shading) kept. The originals are kept on the element (data-ta-o) and put back for the dark theme. Course maps
// drawn over photos are left alone.
(function () {
  var KEEP = ".sh-stage, .sh-stage-wrap, .cp-holemaps, .cp-hole, .cp-hv-img, [data-keep-colors]";
  function hsl(r, g, b) { r /= 255; g /= 255; b /= 255; var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, s = 0, h = 0;
    if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
  function rgb(h, s, l) { function f(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
    if (!s) return [l * 255, l * 255, l * 255]; var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]; }
  function parse(c) { c = String(c || "").trim().toLowerCase(); if (c === "white") return [255, 255, 255, 1]; if (c === "black") return [0, 0, 0, 1];
    var m = c.match(/^#([0-9a-f]{3,8})$/); if (m) { var x = m[1]; if (x.length < 6) x = x.split("").map(function (y) { return y + y; }).join(""); return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1]; }
    m = c.match(/^rgba?\(([^)]*)\)$/); if (m) { var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; } return null; }
  function out(r, g, b, a) { return a >= 0.999 ? "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")" : "rgba(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + "," + (+a.toFixed(3)) + ")"; }
  function map(c, role) { // role: text | back | shape | line
    var p = parse(c); if (!p) return c; var t = hsl(p[0], p[1], p[2]), s = t[1], l = t[2], a = p[3];
    if (s >= 0.15) { // a real color
      if (role === "text" && l > 0.5) { var d = rgb(t[0], Math.min(1, s * 1.05), 0.3 + (l - 0.5) * 0.2); return out(d[0], d[1], d[2], a); }
      if (role === "back" && l < 0.22) { var e = rgb(t[0], Math.min(s, 0.4), 1 - l * 0.6); return out(e[0], e[1], e[2], a); }
      return c; }
    if (a < 0.999) return l > 0.5 ? out(0, 0, 0, Math.min(0.85, a * (role === "text" ? 1.2 : 0.9))) : (role === "back" ? out(255, 253, 248, Math.max(0.9, a)) : c);
    if (role === "text" || role === "line") { if (l > 0.3) { var v = 255 * Math.max(0.07, (1 - l) * 0.5); return out(v, v * 0.97, v * 0.92, a); } return c; }
    var nl = 1 - l; if (nl > 0.86) nl = 0.955 - (1 - nl) * 0.35; var w = rgb(40 / 360, nl > 0.8 ? 0.28 : 0.04, nl); return out(w[0], w[1], w[2], a); // back / shape: flipped
  }
  var STY = [["color", "text"], ["backgroundColor", "back"], ["borderColor", "line"], ["borderTopColor", "line"], ["borderBottomColor", "line"], ["fill", "shape"], ["stroke", "line"]];
  function isText(n) { var t = n.tagName && n.tagName.toLowerCase(); return t === "text" || t === "tspan"; }
  function fixOne(n) {
    if (n.hasAttribute && n.hasAttribute("data-ta-o")) return; if (n.closest && n.closest(KEEP)) return;
    var svg = n.ownerSVGElement; if (svg && svg.querySelector("image")) return;
    var o = {}, any = false;
    ["fill", "stroke"].forEach(function (k) { var v = n.getAttribute && n.getAttribute(k); if (!v || v === "none" || /^(url|currentcolor|var)/i.test(v)) return;
      var nv = map(v, k === "stroke" ? "line" : isText(n) ? "text" : "shape"); if (nv !== v) { o["a:" + k] = v; n.setAttribute(k, nv); any = true; } });
    if (n.style && n.style.length) STY.forEach(function (q) { var v = n.style[q[0]]; if (!v || /var\(|gradient|url/.test(v)) return;
      var role = q[1] === "shape" && isText(n) ? "text" : q[1], nv = map(v, role); if (nv !== v) { o["s:" + q[0]] = v; n.style[q[0]] = nv; any = true; } });
    if (any) n.setAttribute("data-ta-o", JSON.stringify(o));
  }
  function fixTree(root) { if (!root || root.nodeType !== 1) return; fixOne(root); var all = root.querySelectorAll("[fill], [stroke], [style]"); for (var i = 0; i < all.length; i++) fixOne(all[i]); }
  function restoreAll() { var all = document.querySelectorAll("[data-ta-o]"); for (var i = 0; i < all.length; i++) { var n = all[i], o = {}; try { o = JSON.parse(n.getAttribute("data-ta-o")); } catch (e) { /* */ }
    Object.keys(o).forEach(function (k) { if (k.indexOf("a:") === 0) n.setAttribute(k.slice(2), o[k]); else n.style[k.slice(2)] = o[k]; }); n.removeAttribute("data-ta-o"); } }
  var on = function () { return document.documentElement.getAttribute("data-theme") === "light"; };
  function start() {
    new MutationObserver(function (ms) { if (!on()) return; for (var i = 0; i < ms.length; i++) { var a = ms[i].addedNodes; for (var j = 0; j < a.length; j++) fixTree(a[j]); } })
      .observe(document.body, { childList: true, subtree: true });
    if (on()) fixTree(document.body);
    window.addEventListener("ta-theme", function (e) { if (e.detail === "light") fixTree(document.body); else restoreAll(); });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
