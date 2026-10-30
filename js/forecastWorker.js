// (update 403) The forecaster, off the page: learning it takes a few seconds to a minute on a big field, and on the
// page itself that froze Compare. The page sends the field's season totals once (forecastInput), then asks for players.
import { forecastModel, forecastPlayer, forecastStory, FORECAST_CATS } from "./forecast.js";
let input = null, inputId = null;
self.onmessage = (e) => {
  const { id, inputId: iid, input: inp, tour, keys, names } = e.data || {};
  try {
    if (inp) { input = inp; inputId = iid; }
    if (!input || iid !== inputId) { self.postMessage({ id, needInput: true }); return; }
    const m = forecastModel(input, { tour });
    const fcs = (keys || []).map((k, i) => { const f = forecastPlayer(m, k); if (f && names?.[i]) f.name = names[i]; return f; });
    const ok = fcs.filter(Boolean);
    const story = forecastStory(m, ok);
    const ageAt = {};
    if (m.ageOk) for (const f of ok) if (f.age != null) { const a = m.ageCurve(f.age); ageAt[f.key] = FORECAST_CATS.reduce((t, c) => t + a[c], 0); }
    self.postMessage({ id, fcs, story, info: { target: m.target, years: m.years, lastYear: m.lastYear, params: m.params, err: m.err, outOfSample: m.outOfSample, ageOk: m.ageOk, agePlayers: m.agePlayers, fieldN: m.fieldProj[0]?.length || 0, ageAt } });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
