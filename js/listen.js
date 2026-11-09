// (update 645) Listening that keeps going until you stop it.
// (update 646) iPhone / iPad: Safari only hears with a session started straight from a touch; one it's restarted on its
// own (after a pause) shows as listening but hears nothing. So there a session that ends isn't restarted: what was heard
// is kept and the caller is told (onPause). Elsewhere a session the browser ends is started again a moment later.
// (update 647) one speech recogniser for the whole page, used again and again: on iPhone the first one worked and every
// new one made after it heard nothing ("I didn't catch that" from the second hold on). A tap that isn't a hold stops it
// gently (stop, not abort), and a new start while the last is still winding down takes over that session.
const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canListen = () => !!SR;
export const isIOS = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const join = (...a) => a.map((x) => String(x || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

let R = null, running = false, owner = null, skip = 0, count = 0;
function rec() {
  if (R) return R;
  R = new SR();
  R.lang = navigator.language || "en-US"; R.continuous = true; R.interimResults = true; R.maxAlternatives = 1;
  R.onstart = () => { running = true; };
  R.onresult = (e) => { count = e.results.length; owner?._result(e); };
  R.onerror = (e) => owner?._error(e);
  R.onend = () => { running = false; count = 0; skip = 0; const o = owner; o?._end(); };
  return R;
}

/**
 * listener({ onText(text), onBlocked(), onPause(text) }) → { start(prefix?), stop(): Promise<text>, cancel(), on() }
 * start() must be called straight from a tap / touch (no await before it) for iPhone to hear.
 */
export function listener({ onText = () => {}, onBlocked = () => {}, onPause = () => {} } = {}) {
  let active = false, done = "", fin = "", tmp = "", endRes = null, ended = Promise.resolve(), began = 0, heard = false, quick = 0;
  const text = () => join(done, fin, tmp);
  const self = {
    _result(e) {
      if (owner !== self) return;
      let f = "", t = "";
      for (let i = skip; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) f += `${x[0].transcript} `; else t += `${x[0].transcript} `; }
      fin = f; tmp = t; if (f || t) { heard = true; quick = 0; } onText(text());
    },
    _error(e) { if (owner === self && (e.error === "not-allowed" || e.error === "service-not-allowed")) { active = false; onBlocked(); } },
    _end() {
      if (owner !== self) return;
      done = text(); fin = ""; tmp = "";
      endRes?.();
      if (!active) { owner = null; return; }
      if (isIOS()) { active = false; owner = null; onPause(done); return; } // (iPhone: a restart wouldn't hear)
      quick = !heard && Date.now() - began < 1500 ? quick + 1 : 0;
      if (quick >= 4) { active = false; owner = null; onPause(done); return; }
      setTimeout(() => { if (active && owner === self) { try { begin(); } catch { active = false; owner = null; onPause(done); } } }, quick ? 400 : 120);
    },
    on: () => active,
    start(prefix = "") {
      if (active) return;
      active = true; done = prefix; quick = 0; owner = self;
      try { begin(); } catch (err) { active = false; owner = null; throw err; }
    },
    async stop() {
      const was = active; active = false;
      if (owner === self && running) { try { R.stop(); } catch { /* */ } await Promise.race([ended, new Promise((res) => setTimeout(res, 1500))]); }
      if (owner === self) owner = null;
      return was || done || fin || tmp ? text() : "";
    },
    cancel() { active = false; if (owner === self) { owner = null; try { if (running) R.stop(); } catch { /* */ } } },
  };
  const begin = () => {
    fin = ""; tmp = ""; began = Date.now(); heard = false;
    ended = new Promise((res) => { endRes = res; });
    const r = rec();
    if (running) { skip = count; return; } // (the last session still winding down: carry on in it, from here)
    skip = 0; running = true; // (counted as running from the call: a tap's stop must reach it even before it has begun)
    try { r.start(); } catch (err) { running = false; throw err; }
  };
  return self;
}
