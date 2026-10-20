/*
 * The field's per-round detail (every player's strokes gained and other stats by category, lie, distance
 * and club, round by round), packed small enough for a phone.
 *
 * Built on a computer from every player's full rows and saved to Cloud Storage as one gzipped file per
 * year. Phones, players' own portals and their reports read it back instead of every player's full rows:
 *   - the strings (categories, lies, distances, clubs, dates, tournaments …) are stored once, in a dictionary;
 *   - every entry is a few small numbers in packed arrays (18 bytes for a strokes-gained entry);
 *   - reading it back makes the same { key, name, rounds } players the full rows give (minus the raw rows).
 *
 * File layout: "TAD1", header length (u32), header JSON, then the packed arrays (each 4-byte aligned):
 *   shots: cat, lie, dist, club, clubCat, gear, ball (dictionary indexes) + sg, w (float32)
 *   obs:   k, cat, lie, dist, gear, ball (dictionary indexes) + v, w (float32)
 * (update 243, version 2: each shot's and stat's equipment, the club model and the ball, so the club and ball
 *  breakdowns work from the detail too. Version 1 files, without them, still read.)
 * Index 0 in the dictionary is "no value" (null).
 */

const MAGIC = "TAD1";

/** Each year's rounds, packed: [{ year, bytes }] (bytes uncompressed; see gzip()). */
export function encodeFieldDetail(players) {
  const years = new Map();
  for (const p of players) for (const rd of p.rounds) {
    const y = String(rd.year ?? "");
    if (!years.has(y)) years.set(y, new Map());
    const byP = years.get(y);
    if (!byP.has(p.key)) byP.set(p.key, { key: p.key, name: p.name ?? p.label ?? null, rounds: [] });
    byP.get(p.key).rounds.push(rd);
  }
  return [...years].map(([year, byP]) => ({ year, bytes: encodeYear([...byP.values()]) }));
}

function encodeYear(players) {
  const dict = [null], at = new Map([[null, 0]]);
  const id = (s) => { const k = s === undefined || s === null ? null : String(s); if (!at.has(k)) { at.set(k, dict.length); dict.push(k); } return at.get(k); };
  let nS = 0, nO = 0;
  for (const p of players) for (const rd of p.rounds) { nS += rd.shots.length; nO += (rd.obs || []).length; }
  const sI = new Uint32Array(nS * 7), sF = new Float32Array(nS * 2), oI = new Uint32Array(nO * 6), oF = new Float32Array(nO * 2);
  let a = 0, b = 0;
  const hp = players.map((p) => [p.key, p.name, p.rounds.map((rd) => {
    for (const s of rd.shots) { sI.set([id(s.cat), id(s.lie), id(s.dist), id(s.club), id(s.clubCat), id(s.gear), id(s.ball)], a * 7); sF[a * 2] = s.sg; sF[a * 2 + 1] = s.w; a++; }
    for (const o of rd.obs || []) { oI.set([id(o.k), id(o.cat), id(o.lie), id(o.dist), id(o.gear), id(o.ball)], b * 6); oF[b * 2] = o.v; oF[b * 2 + 1] = o.w; b++; }
    const plain = rd.key === `${rd.date}|${rd.event}|${rd.roundNo}`;
    // [key (null when it's date|event|round), date, event, round, tour, event-level, shots, obs, course (update 160)]
    return [plain ? null : rd.key, id(rd.date), id(rd.event), rd.roundNo, id(rd.tour), rd.eventLevel ? 1 : 0, rd.shots.length, (rd.obs || []).length, id(rd.course || null)];
  })]);
  // the indexes fit in 16 bits unless the dictionary is huge
  const wide = dict.length > 65535, I = wide ? Uint32Array : Uint16Array;
  const header = new TextEncoder().encode(JSON.stringify({ v: 2, year: players[0]?.rounds[0]?.year ?? "", wide, nS, nO, dict, players: hp }));
  const parts = [I.from(sI), sF, I.from(oI), oF];
  const pad4 = (n) => (n + 3) & ~3;
  let size = pad4(8 + header.length);
  for (const t of parts) size = pad4(size + t.byteLength);
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let off = pad4(8 + header.length);
  for (const t of parts) { out.set(new Uint8Array(t.buffer, t.byteOffset, t.byteLength), off); off = pad4(off + t.byteLength); }
  return out;
}

/** One packed year back into players: [{ key, name, rounds }]. */
export function decodeFieldDetail(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (new TextDecoder().decode(u8.subarray(0, 4)) !== MAGIC) throw new Error("Not a field detail file");
  const hl = new DataView(u8.buffer, u8.byteOffset).getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
  if (h.v !== 1 && h.v !== 2) throw new Error("Unknown field detail version");
  const SN = h.v === 2 ? 7 : 5, ON = h.v === 2 ? 6 : 4; // (version 2: a shot's and a stat's gear and ball too)
  const pad4 = (n) => (n + 3) & ~3;
  // (copied to a fresh buffer when the file's arrays don't sit on 4-byte boundaries in memory)
  const buf = u8.byteOffset % 4 === 0 ? u8.buffer : u8.slice().buffer, base = u8.byteOffset % 4 === 0 ? u8.byteOffset : 0;
  const I = h.wide ? Uint32Array : Uint16Array, isz = h.wide ? 4 : 2;
  let off = pad4(8 + hl);
  const take = (T, n, sz) => { const t = new T(buf, base + off, n); off = pad4(off + n * sz); return t; };
  const sI = take(I, h.nS * SN, isz), sF = take(Float32Array, h.nS * 2, 4), oI = take(I, h.nO * ON, isz), oF = take(Float32Array, h.nO * 2, 4);
  const d = h.dict;
  let a = 0, b = 0;
  const year = String(h.year ?? "");
  const r4 = (x) => Math.round(x * 10000) / 10000; // (float32 back to the number as written: 0.484, not 0.48399999737739563)
  let clubs = false;
  for (let i = 0; i < h.nS && !clubs; i++) if (sI[i * SN + 3] || (SN === 7 && (sI[i * SN + 5] || sI[i * SN + 6]))) clubs = true;
  return h.players.map(([key, name, rounds]) => ({
    key, name,
    rounds: rounds.map(([rk, di, ei, roundNo, ti, ev, ns, no, ci]) => {
      const shots = new Array(ns), obs = new Array(no);
      // (club only when the file has clubs: two fewer fields on every shot, which adds up over a whole field)
      if (clubs) for (let i = 0; i < ns; i++, a++) {
        const q = a * SN, sh = { cat: d[sI[q]], sg: r4(sF[a * 2]), w: r4(sF[a * 2 + 1]), lie: d[sI[q + 1]], dist: d[sI[q + 2]], club: d[sI[q + 3]], clubCat: d[sI[q + 4]] };
        if (SN === 7) { if (sI[q + 5]) sh.gear = d[sI[q + 5]]; if (sI[q + 6]) sh.ball = d[sI[q + 6]]; }
        shots[i] = sh;
      }
      else for (let i = 0; i < ns; i++, a++) shots[i] = { cat: d[sI[a * SN]], sg: r4(sF[a * 2]), w: r4(sF[a * 2 + 1]), lie: d[sI[a * SN + 1]], dist: d[sI[a * SN + 2]] };
      for (let i = 0; i < no; i++, b++) {
        const q = b * ON, ob = { k: d[oI[q]], cat: d[oI[q + 1]], lie: d[oI[q + 2]], dist: d[oI[q + 3]], v: r4(oF[b * 2]), w: r4(oF[b * 2 + 1]) };
        if (ON === 6) { if (oI[q + 4]) ob.gear = d[oI[q + 4]]; if (oI[q + 5]) ob.ball = d[oI[q + 5]]; }
        obs[i] = ob;
      }
      const date = d[di] ?? "", event = d[ei] ?? "";
      const rd = { key: rk ?? `${date}|${event}|${roundNo}`, date, event, roundNo, year, tour: d[ti] ?? "", ...(ci && d[ci] ? { course: d[ci] } : {}), shots, obs, ...(ev ? { eventLevel: true } : {}) };
      rd.has = new Set(obs.map((o) => o.k));
      if (shots.length) rd.has.add("sg");
      return rd;
    }),
  }));
}

/** Several years' players into one list (a player's rounds oldest first, as prepare() gives them). */
export function mergeYears(lists) {
  const by = new Map();
  for (const list of lists) for (const p of list) {
    if (!by.has(p.key)) by.set(p.key, { key: p.key, name: p.name, rounds: [] });
    by.get(p.key).rounds.push(...p.rounds);
  }
  for (const p of by.values()) p.rounds.sort((x, y) => (Date.parse(x.date) || 0) - (Date.parse(y.date) || 0));
  return [...by.values()];
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream("gzip"));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream("gzip"));
