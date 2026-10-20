// (update 244) Compare → "Ask AI": a request in plain English ("Compare all Callaway drivers played by Xander
// Schauffele from 2024-2026 and tell me which was best. Exclude the 2025 Masters.") turned into a comparison.
// Two steps: read the request (who, what, which seasons, what to leave out); then, once that player's rounds are
// loaded, match the clubs, brands, models and tournaments to what's in the data. When the portal's AI service is
// set up (config.js insightsUrl), it reads the request first and this file matches its answer to the data; when it
// isn't (or it can't answer), the same reading is done here.

const KINDS = [
  [/\bdrivers?\b/, "Driver"], [/\bputters?\b/, "Putter"], [/\birons?\b/, "Iron"], [/\bwedges?\b/, "Wedge"],
  [/\b(fairway woods?|fairways woods?|woods?)\b/, "Fairway Wood"], [/\bhybrids?\b/, "Hybrid"], [/\b(golf )?balls?\b/, "Ball"],
];
const EXCL = /\b(?:exclud(?:e|ing)|except(?: for)?|without|leav(?:e|ing) out|not counting|ignor(?:e|ing)|minus|but not|skip(?:ping)?)\b\s+(.+?)(?=$|[.;!?]|\b(?:and (?:tell|let|show|which|who)|tell me|let me know)\b)/gi;
const SPLIT = /\s+(?:vs\.?|versus|against|compared (?:to|with)|as opposed to)\s+/i;
const norm = (t) => String(t || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, "-");
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (hay, w) => new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`).test(hay);

/** Seasons in a piece of text: "2024-2026", "2024 to 2026", "since 2024", "2025 and 2026", "this season", "last season". */
export function yearsIn(text, maxYear) {
  const t = norm(text), out = new Set();
  const top = Number(maxYear) || new Date().getFullYear();
  for (const m of t.matchAll(/\b(20\d\d)\s*(?:-|to|through|thru|until|till)\s*(20\d\d)\b/g)) { const a = Number(m[1]), b = Number(m[2]); for (let y = Math.min(a, b); y <= Math.max(a, b); y++) out.add(String(y)); }
  for (const m of t.matchAll(/\b(?:since|from|after)\s+(20\d\d)\b(?!\s*(?:-|to|through|thru|until|till)\s*20\d\d)/g)) for (let y = Number(m[1]); y <= top; y++) out.add(String(y));
  for (const m of t.matchAll(/\b(20\d\d)\b/g)) out.add(m[1]);
  if (/\bthis (season|year)\b/.test(t)) out.add(String(top));
  if (/\blast (season|year)\b/.test(t)) out.add(String(top - 1));
  return [...out].sort();
}

/**
 * Step one: read the request. players: [[key, label]]. Returns
 * { players: [{ key, label }], everyone, years, sides: [text], excl: [text], exclRounds: [n], together, last, kinds, text }
 */
export function readAsk(text, { players = [], maxYear = null } = {}) {
  let t = norm(text);
  // what to leave out, then the rest of the request without it
  const excl = [], exclRounds = [];
  t = t.replace(EXCL, (_, what) => {
    for (const part of what.split(/\s*(?:,|\band\b|\bor\b|&)\s*/)) {
      const p = part.trim().replace(/^the\s+/, "");
      if (!p) continue;
      const r = /^(?:round|rd|r)\s*([1-4])s?\b/.exec(p) || /^([1-4])(?:st|nd|rd|th) rounds?\b/.exec(p);
      if (r) exclRounds.push(r[1]); else excl.push(p);
    }
    return " ";
  });
  // who: full names first, then a last name when it's only one player's
  const found = new Map();
  const lower = players.map(([k, l]) => [k, l, norm(l)]);
  for (const [k, l, n] of lower) if (n.length > 3 && wordIn(t, n)) found.set(k, l);
  if (!found.size) {
    const lastOf = new Map();
    for (const [k, l, n] of lower) { const last = n.split(/\s+/).pop(); if (last.length > 3) (lastOf.get(last) || lastOf.set(last, []).get(last)).push([k, l]); }
    for (const [last, list] of lastOf) if (list.length === 1 && wordIn(t, last)) found.set(list[0][0], list[0][1]);
  }
  const everyone = /\b(everyone|everybody|all players|every player|the field|whole field|all of tour|across tour|tour players)\b/.test(t);
  const years = yearsIn(t, maxYear);
  const sides = t.split(SPLIT).map((s) => s.trim().replace(/[\s.!?,;:]+$/, "")).filter(Boolean);
  const kinds = KINDS.filter(([re]) => re.test(t)).map(([, k]) => k);
  const together = /\b(together|combined|as one|as a group|pooled|all in one)\b/.test(t);
  const lm = /\blast\s+(\d+)\s+(rounds?|events?|tournaments?)\b/.exec(t);
  const last = lm ? { n: Number(lm[1]), unit: /round/.test(lm[2]) ? "rounds" : "events" } : null;
  return { players: [...found].map(([key, label]) => ({ key, label })), everyone, years, sides: sides.length > 1 ? sides : [t], excl, exclRounds, together, last, kinds, text: t };
}

/**
 * Step two, products: the groups to compare, matched to the data. catalog: products() output with gearInfo on
 * each item ({ group, items: [{ value, brand, model, label, n }] }). Returns [{ name, f: { clubs | balls, years? } }].
 */
export function productGroups(ask, catalog, { maxYear = null } = {}) {
  const items = catalog.flatMap((k) => k.items.map((o) => ({ ...o, kind: k.group })));
  const brandsAll = [...new Set(items.map((o) => o.brand).filter(Boolean))];
  const kindWord = { Driver: "drivers", Putter: "putters", Iron: "irons", Wedge: "wedges", "Fairway Wood": "fairway woods", Hybrid: "hybrids", Ball: "balls" };
  const yrsTxt = (ys) => { const n = ys.map(Number); return n.length > 1 && n.every((v, i) => !i || v === n[i - 1] + 1) ? `${ys[0]}–${ys.at(-1)}` : ys.join(" + "); };
  const sideSpec = (txt) => {
    const t = norm(txt);
    const kinds = KINDS.filter(([re]) => re.test(t)).map(([, k]) => k);
    const brands = brandsAll.filter((b) => wordIn(t, norm(b)));
    // a model: its name (without the brand) in the text ("paradym ai smoke"), or a word of it that's its own
    // ("trtl", "jailbird": every model with that word)
    const GENERIC = new Set(["the", "max", "tour", "pro", "plus", "mini", "fast", "lite", "ls", "td", "hl", "x", "one", "ai", "new", "black", "white", "blue", "red", "model", "models", "driver", "putter", "iron", "irons", "wedge", "wood", "hybrid", "ball"]);
    const brandWords = new Set(brandsAll.map((b) => norm(b)));
    const models = items.filter((o) => {
      const m = norm(o.model || o.label.replace(new RegExp(`^${esc(o.brand || "")}\\s+`), ""));
      if (m.length >= 3 && wordIn(t, m)) return true;
      return m.split(/[\s/]+/).some((w) => w.length >= 3 && !GENERIC.has(w) && !brandWords.has(w) && !/^\d+$/.test(w) && wordIn(t, w));
    });
    return { kinds, brands, models, years: yearsIn(t, maxYear) };
  };
  const whole = sideSpec(ask.text);
  const specs = ask.sides.map(sideSpec).map((s) => ({
    kinds: s.kinds.length ? s.kinds : whole.kinds,
    brands: s.brands.length || s.models.length ? s.brands : ask.sides.length > 1 ? [] : whole.brands,
    models: s.models,
    years: s.years.length ? s.years : ask.sides.length > 1 ? [] : whole.years,
  }));
  // a year said once for the whole request goes to every side that didn't name its own: none named ("2026
  // drivers: Callaway vs TaylorMade"), or only the last one, at its end ("Callaway vs TaylorMade drivers in 2026")
  const withY = specs.filter((s) => s.years.length);
  const tailYears = specs.length > 1 && withY.length === 1 && specs.at(-1).years.length && /(?:in|for|during|from|over|since)\s+(?:the\s+)?(?:20\d\d|this season|last season)(?:\s*(?:-|to|through|and)\s*20\d\d)?\s*(?:season|seasons)?\s*$/.test(ask.sides.at(-1));
  if (tailYears) for (const s of specs) if (!s.years.length) s.years = specs.at(-1).years;
  const anyYears = specs.some((s) => s.years.length) ? null : whole.years;
  const groups = [];
  const mk = (list, name, years) => {
    if (!list.length) return;
    const isBall = list.every((o) => o.kind === "Ball");
    const vals = [...new Set(list.map((o) => o.value))];
    const f = isBall ? { balls: vals } : { clubs: vals };
    if (years?.length) f.years = years;
    groups.push({ name: `${name}${years?.length ? ` · ${yrsTxt(years)}` : ""}`, f });
  };
  for (const s of specs) {
    const years = s.years.length ? s.years : anyYears || [];
    let pool = items;
    if (s.kinds.length) pool = pool.filter((o) => s.kinds.includes(o.kind));
    if (s.models.length) pool = pool.filter((o) => s.models.some((m) => m.value === o.value));
    else if (s.brands.length) pool = pool.filter((o) => s.brands.includes(o.brand));
    else if (!s.kinds.length) pool = [];
    if (!pool.length) continue;
    const kindTxt = (list) => { const ks = [...new Set(list.map((o) => o.kind))]; return ks.length === 1 ? kindWord[ks[0]] || ks[0].toLowerCase() : "clubs"; };
    if (specs.length > 1 || ask.together) {
      // one group a side ("TRTL vs Jailbird"): every model that side names, together
      const name = s.models.length ? [...new Set(s.models.map((o) => o.model || o.label))].join(" + ") : `All ${s.brands.length ? `${s.brands.join(" + ")} ` : ""}${kindTxt(pool)}`;
      mk(pool, name, years);
    } else if (s.models.length > 1 || (!s.models.length && (s.brands.length <= 1))) {
      // one side: each model on its own ("all Callaway drivers": which one was best)
      for (const o of pool) mk([o], o.label, years);
    } else if (s.brands.length > 1) for (const b of s.brands) mk(pool.filter((o) => o.brand === b), `All ${b} ${kindTxt(pool)}`, years);
    else mk(pool, s.models.length ? s.models[0].label : `All ${kindTxt(pool)}`, years);
  }
  return groups;
}

/** Tournaments to leave out, matched to the ones in the data: evs [{ k: "event|year", event, year }] → [k]. */
export function matchEvents(phrases, evs) {
  const out = new Map();
  const STOP = new Set(["the", "a", "an", "of", "at", "in", "tournament", "event", "events", "week"]);
  for (const ph of phrases) {
    const p = norm(ph);
    const y = /\b(20\d\d)\b/.exec(p)?.[1] || null;
    const words = p.replace(/\b20\d\d\b/g, " ").split(/[^a-z0-9']+/).filter((w) => w && !STOP.has(w)).map((w) => (w === "players" ? "players" : w));
    if (!words.length) continue;
    for (const e of evs) {
      if (y && e.year !== y) continue;
      const n = norm(e.event);
      if (words.every((w) => n.includes(w) || n.includes(w.replace(/'?s$/, "")))) out.set(e.k, `${e.year} ${e.event}`);
    }
  }
  return out;
}
