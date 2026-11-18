// (update 881) Dates without a time ("2025-08-07", as the stats files have them) were read as midnight UTC: in America that's
// the evening before, so every event showed a day early (Wednesday to Saturday, not Thursday to Sunday). Loaded before
// everything else: a bare date is read as noon on that day where you are, so it shows as that day everywhere, and the same
// date in any time zone (noon is 12 hours from either end). A date with a time is read as it always was.
(function () {
  if (window.__taDateFix) return; window.__taDateFix = true;
  var D = Date, ISO = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;
  function noon(s) { var m = ISO.exec(s); return m ? new D(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0).getTime() : null; }
  function TADate() {
    var a = arguments;
    if (!(this instanceof TADate)) return D(); // Date() as a function: the time now, as text
    if (a.length === 1 && typeof a[0] === "string") { var t = noon(a[0]); if (t != null) return new D(t); }
    if (a.length === 0) return new D();
    return new (Function.prototype.bind.apply(D, [null].concat(Array.prototype.slice.call(a))))();
  }
  TADate.prototype = D.prototype;
  TADate.now = D.now; TADate.UTC = D.UTC;
  TADate.parse = function (s) { if (typeof s === "string") { var t = noon(s); if (t != null) return t; } return D.parse(s); };
  try { Object.setPrototypeOf(TADate, D); } catch (e) { /* */ }
  window.Date = TADate;
})();
