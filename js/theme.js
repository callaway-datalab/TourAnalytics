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
