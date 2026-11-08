// (update 645) Listening that keeps going until you stop it: the browser's speech to text ends a session on its own
// (a pause, a few seconds of quiet, iPhone Safari now and then for no reason), so each end while still listening starts
// it again straight away, keeping what was heard so far. Words heard but not yet "final" when a session ends are kept
// too (iPhone often never finalises them, which lost the middle of what was said).
const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canListen = () => !!SR;
const join = (...a) => a.map((x) => String(x || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/**
 * listener({ onText(text), onBlocked() }) → { start(prefix?), stop(): Promise<text>, cancel(), on() }
 * onText gets everything heard so far (prefix first) each time it changes.
 */
export function listener({ onText = () => {}, onBlocked = () => {} } = {}) {
  let active = false, rec = null, done = "", fin = "", tmp = "", ended = null, fails = 0;
  const text = () => join(done, fin, tmp);
  const session = () => {
    if (!active) return;
    const r = new SR(); rec = r; fin = ""; tmp = "";
    r.lang = navigator.language || "en-US"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let endRes; ended = new Promise((res) => { endRes = res; });
    r.onresult = (e) => {
      if (rec !== r) return;
      let f = "", t = "";
      for (const x of e.results) { if (x.isFinal) f += `${x[0].transcript} `; else t += `${x[0].transcript} `; }
      fin = f; tmp = t; fails = 0; onText(text());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { active = false; onBlocked(); }
      // no-speech, aborted, network, audio-capture: the session ends and (still listening) starts again
    };
    r.onend = () => {
      if (rec === r) { done = text(); fin = ""; tmp = ""; rec = null; }
      endRes();
      if (!active) return;
      // started again at once; a start that fails is tried again a little later (a few times)
      const again = () => { if (!active || rec) return; try { session(); } catch { if (++fails < 6) setTimeout(again, 250); else { active = false; } } };
      again();
    };
    r.start();
  };
  return {
    on: () => active,
    start(prefix = "") { if (active) return; active = true; done = prefix; fin = ""; tmp = ""; fails = 0; try { session(); } catch (err) { active = false; throw err; } },
    async stop() {
      active = false;
      const r = rec;
      try { r?.stop(); } catch { /* already stopped */ }
      if (r) await Promise.race([ended, new Promise((res) => setTimeout(res, 1200))]);
      const t = text(); rec = null; return t;
    },
    cancel() { active = false; const r = rec; rec = null; try { r?.abort(); } catch { /* */ } },
  };
}
