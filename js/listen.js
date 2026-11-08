// (update 645) Listening that keeps going until you stop it.
// (update 646) iPhone / iPad: Safari only hears with a session started straight from a touch; one it's restarted on its
// own (after a pause) shows as listening but hears nothing. So there a session that ends isn't restarted: what was heard
// is kept and the caller is told (onPause) so it can say "tap to keep talking". Elsewhere (Chrome, Edge, Android) a
// session the browser ends is started again (the same one, a moment later), and a run of quick empty ends stops it.
// Words heard but not yet "final" when a session ends are kept too.
const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canListen = () => !!SR;
export const isIOS = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const join = (...a) => a.map((x) => String(x || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/**
 * listener({ onText(text), onBlocked(), onPause(text) }) → { start(prefix?), stop(): Promise<text>, cancel(), on() }
 * start() must be called straight from a tap / touch (no await before it) for iPhone to hear.
 */
export function listener({ onText = () => {}, onBlocked = () => {}, onPause = () => {} } = {}) {
  let active = false, r = null, done = "", fin = "", tmp = "", endRes = null, ended = Promise.resolve(), began = 0, heard = false, quick = 0;
  const text = () => join(done, fin, tmp);
  const begin = () => {
    fin = ""; tmp = ""; began = Date.now(); heard = false;
    ended = new Promise((res) => { endRes = res; });
    r.start();
  };
  const make = () => {
    r = new SR();
    r.lang = navigator.language || "en-US"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let f = "", t = "";
      for (const x of e.results) { if (x.isFinal) f += `${x[0].transcript} `; else t += `${x[0].transcript} `; }
      fin = f; tmp = t; heard = true; quick = 0; onText(text());
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { active = false; onBlocked(); } };
    r.onend = () => {
      done = text(); fin = ""; tmp = "";
      endRes?.();
      if (!active) return;
      if (isIOS()) { active = false; onPause(done); return; } // (iPhone: a restart wouldn't hear)
      quick = !heard && Date.now() - began < 1500 ? quick + 1 : 0;
      if (quick >= 4) { active = false; onPause(done); return; }
      setTimeout(() => { if (active) { try { begin(); } catch { active = false; onPause(done); } } }, quick ? 400 : 120);
    };
  };
  return {
    on: () => active,
    start(prefix = "") { if (active) return; active = true; done = prefix; quick = 0; if (!r) make(); try { begin(); } catch (err) { active = false; throw err; } },
    async stop() {
      const was = active; active = false;
      try { r?.stop(); } catch { /* already stopped */ }
      if (was) await Promise.race([ended, new Promise((res) => setTimeout(res, 1500))]);
      return text();
    },
    cancel() { active = false; try { r?.abort(); } catch { /* */ } },
  };
}
