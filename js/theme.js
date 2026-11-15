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
