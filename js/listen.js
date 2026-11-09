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

let R = null, running = false, owner = null, skip = 0, count = 0, lastEvt = 0;
// (update 651) what happened on the last try, to say why nothing was heard: { asked, started, audio, sound, speech, error, ended }
const diag = { asked: 0, started: 0, audio: 0, sound: 0, speech: 0, error: "", ended: 0 };
const mark = (k, v = 1) => { diag[k] = v; lastEvt = Date.now(); };
export function whyNothing() {
  if (typeof navigator !== "undefined" && navigator.standalone && isIOS() && !diag.started) return "the iPhone home-screen app may not allow speech; try Cal in Safari";
  if (diag.error) return { "not-allowed": "microphone blocked for this site", "service-not-allowed": "speech recognition isn\u2019t allowed here (Settings \u203a Safari, or Siri & Dictation off?)", "no-speech": "no speech heard", "audio-capture": "no microphone found or it\u2019s busy", network: "speech service couldn\u2019t be reached", aborted: "it was interrupted" }[diag.error] || `error: ${diag.error}`;
  if (!diag.started) return "the microphone never started";
  if (!diag.audio) return "the microphone started but got no audio";
  if (!diag.speech && !diag.sound) return "no sound reached it";
  return "it heard sound but no words";
}
function rec() {
  if (R) return R;
  R = new SR();
  R.lang = navigator.language || "en-US"; R.continuous = true; R.interimResults = true; R.maxAlternatives = 1;
  R.onstart = () => { running = true; mark("started"); };
  R.onaudiostart = () => mark("audio"); R.onsoundstart = () => mark("sound"); R.onspeechstart = () => mark("speech");
  R.onresult = (e) => { count = e.results.length; lastEvt = Date.now(); owner?._result(e); };
  R.onerror = (e) => { mark("error", e.error || "unknown"); owner?._error(e); };
  R.onend = () => { mark("ended"); running = false; count = 0; skip = 0; const o = owner; o?._end(); };
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
    let r = rec();
    // (the last session still winding down: carry on in it, from here; one gone quiet for 3 s is dropped for a new one)
    if (running && Date.now() - lastEvt < 3000) { skip = count; return; }
    if (running) { try { R.abort(); } catch { /* */ } R = null; running = false; r = rec(); }
    Object.assign(diag, { asked: 1, started: 0, audio: 0, sound: 0, speech: 0, error: "", ended: 0 }); lastEvt = Date.now();
    skip = 0; running = true; // (counted as running from the call: a tap's stop must reach it even before it has begun)
    try { r.start(); } catch (err) { running = false; throw err; }
  };
  return self;
}
