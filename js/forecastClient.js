// (update 403) Ask the forecaster (forecastWorker.js) without freezing the page. Falls back to running it here when a
// worker can't start. runForecast(field, { tour, players: [{ key, label }] }) → { fcs, story, info }
import { forecastInput } from "./forecast.js";
let worker = null, seq = 0, sent = null, nextId = 1; const inlineModels = new WeakMap();
const pending = new Map(), inputs = new WeakMap(), results = new Map();
function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL("./forecastWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => { const p = pending.get(e.data?.id); if (p) { pending.delete(e.data.id); p(e.data); } };
    worker.onerror = (e) => { console.warn("Forecast worker", e?.message); for (const p of pending.values()) p({ error: "worker" }); pending.clear(); worker = false; sent = null; };
  } catch { worker = false; }
  return worker;
}
const inputOf = (field) => { let x = inputs.get(field); if (!x) { x = { id: nextId++, input: forecastInput(field) }; inputs.set(field, x); } return x; };
async function inline(inp, tour, players, lite = false) {
  const F = await import("./forecast.js");
  const mk = `${tour}`, mm = (inlineModels.get(inp) || inlineModels.set(inp, new Map()).get(inp)), m = mm.get(mk) || mm.set(mk, F.forecastModel(inp, { tour })).get(mk); // (update 905: kept)
  const fcs = players.map((p) => { const f = F.forecastPlayer(m, p.key, { chances: !lite }); if (f) f.name = p.label || f.name; return f; });
  const ok = fcs.filter(Boolean), ageAt = {};
  if (m.ageOk) for (const f of ok) if (f.age != null) { const a = m.ageCurve(f.age); ageAt[f.key] = F.FORECAST_CATS.reduce((t, c) => t + a[c], 0); }
  return { fcs, story: F.forecastStory(m, ok), info: { target: m.target, years: m.years, lastYear: m.lastYear, params: m.params, err: m.err, outOfSample: m.outOfSample, ageOk: m.ageOk, agePlayers: m.agePlayers, fieldN: m.fieldProj[0]?.length || 0, ageAt } };
}
export function runForecast(field, { tour = null, players = [], lite = false } = {}) { // (update 905) lite: no chances (a whole-field table)
  const x = inputOf(field), rk = `${x.id}|${tour}|${lite ? "L" : ""}|${players.map((p) => `${p.key}:${p.label}`).join(",")}`;
  if (results.has(rk)) return results.get(rk);
  const job = (async () => {
    const w = getWorker();
    if (!w) return inline(x.input, tour, players, lite);
    const ask = (withInput) => new Promise((res) => {
      const id = ++seq; pending.set(id, res);
      w.postMessage({ id, inputId: x.id, ...(withInput ? { input: x.input } : {}), tour, lite, keys: players.map((p) => p.key), names: players.map((p) => p.label) });
    });
    let r = await ask(sent !== x.id);
    sent = x.id;
    if (r.needInput) r = await ask(true);
    if (r.error === "worker") return inline(x.input, tour, players, lite);
    if (r.error) throw new Error(r.error);
    return r;
  })();
  results.set(rk, job);
  job.catch(() => results.delete(rk));
  return job;
}
