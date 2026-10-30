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

/* (update 403) The same files, built a player at a time: each player's rounds go straight into packed number arrays, so
 * a whole field never sits in memory as little objects (what ran the cloud rebuild out of memory on big files).
 * detailBuilder().add({ key, name, rounds }) … .finish() → [{ year, bytes }], as encodeFieldDetail. mergeDetailYears
 * joins one year's files built from different players (the cloud rebuild in parts) into one. */
function yearBuilder(year) {
  const dict = [null], at = new Map([[null, 0]]);
  const id = (s) => { const k = s === undefined || s === null ? null : String(s); let i = at.get(k); if (i === undefined) { i = dict.length; at.set(k, i); dict.push(k); } return i; };
  const grow = (a, need) => { if (need <= a.length) return a; const b = new a.constructor(Math.max(need, a.length * 2)); b.set(a); return b; };
  let sI = new Uint32Array(7 * 4096), sF = new Float32Array(2 * 4096), oI = new Uint32Array(6 * 1024), oF = new Float32Array(2 * 1024), nS = 0, nO = 0;
  const hp = [];
  return {
    add(p, rounds) {
      const rs = [];
      for (const rd of rounds) {
        const ns = rd.shots.length, obs = rd.obs || [], no = obs.length;
        sI = grow(sI, (nS + ns) * 7); sF = grow(sF, (nS + ns) * 2); oI = grow(oI, (nO + no) * 6); oF = grow(oF, (nO + no) * 2);
        for (const x of rd.shots) { const b = nS * 7; sI[b] = id(x.cat); sI[b + 1] = id(x.lie); sI[b + 2] = id(x.dist); sI[b + 3] = id(x.club); sI[b + 4] = id(x.clubCat); sI[b + 5] = id(x.gear); sI[b + 6] = id(x.ball); sF[nS * 2] = x.sg; sF[nS * 2 + 1] = x.w; nS++; }
        for (const o of obs) { const b = nO * 6; oI[b] = id(o.k); oI[b + 1] = id(o.cat); oI[b + 2] = id(o.lie); oI[b + 3] = id(o.dist); oI[b + 4] = id(o.gear); oI[b + 5] = id(o.ball); oF[nO * 2] = o.v; oF[nO * 2 + 1] = o.w; nO++; }
        const plain = rd.key === `${rd.date}|${rd.event}|${rd.roundNo}`;
        rs.push([plain ? null : rd.key, id(rd.date), id(rd.event), rd.roundNo, id(rd.tour), rd.eventLevel ? 1 : 0, ns, no, id(rd.course || null)]);
      }
      hp.push([p.key, p.name ?? p.label ?? null, rs]);
    },
    finish() {
      const wide = dict.length > 65535, I = wide ? Uint32Array : Uint16Array;
      const header = new TextEncoder().encode(JSON.stringify({ v: 2, year, wide, nS, nO, dict, players: hp }));
      const parts = [I.from(sI.subarray(0, nS * 7)), sF.subarray(0, nS * 2), I.from(oI.subarray(0, nO * 6)), oF.subarray(0, nO * 2)];
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
    },
  };
}
export function detailBuilder() {
  const years = new Map();
  return {
    add(p) {
      const by = new Map();
      for (const rd of p.rounds) { const y = String(rd.year ?? ""); (by.get(y) || by.set(y, []).get(y)).push(rd); }
      for (const [y, rs] of by) (years.get(y) || years.set(y, yearBuilder(y)).get(y)).add(p, rs);
    },
    finish() { return [...years].map(([year, b]) => ({ year, bytes: b.finish() })); },
  };
}
/** One year's files (uncompressed bytes), each from different players, as one file. */
export function mergeDetailYears(list) {
  if (list.length === 1) return list[0];
  let b = null;
  for (const bytes of list) {
    const ps = decodeFieldDetail(bytes);
    for (const p of ps) { b ||= yearBuilder(p.rounds[0]?.year ?? ""); b.add(p, p.rounds); }
  }
  return (b || yearBuilder("")).finish();
}

/* (update 327) Compact columns. A whole field is about a million shots: as a million little objects that was more than
 * an iPhone lets a page hold, so the page was restarted ("A problem repeatedly occurred"). Now the shots (and the
 * other stats) stay in the file's packed number arrays, and each round's `shots` / `obs` is a light list over its
 * slice of them. It works like the array it replaces (length, for…of, filter, map, reduce, some …); a shot is read
 * from the columns only while it's being looked at, so almost nothing per shot is kept in memory. */
const r4 = (x) => Math.round(x * 10000) / 10000; // (float32 back to the number as written: 0.484, not 0.48399999737739563)
const own = (o, k, v) => Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
class ShotV {
  constructor(t, i) { this.t = t; this.i = i; }
  get cat() { return this.t.d[this.t.I[this.i * this.t.N]]; } set cat(v) { own(this, "cat", v); }
  get lie() { return this.t.d[this.t.I[this.i * this.t.N + 1]]; } set lie(v) { own(this, "lie", v); }
  get dist() { return this.t.d[this.t.I[this.i * this.t.N + 2]]; } set dist(v) { own(this, "dist", v); }
  get club() { return this.t.clubs ? this.t.d[this.t.I[this.i * this.t.N + 3]] : undefined; } set club(v) { own(this, "club", v); }
  get clubCat() { return this.t.clubs ? this.t.d[this.t.I[this.i * this.t.N + 4]] : undefined; } set clubCat(v) { own(this, "clubCat", v); }
  get gear() { const x = this.t.N === 7 ? this.t.I[this.i * 7 + 5] : 0; return x ? this.t.d[x] : undefined; } set gear(v) { own(this, "gear", v); }
  get ball() { const x = this.t.N === 7 ? this.t.I[this.i * 7 + 6] : 0; return x ? this.t.d[x] : undefined; } set ball(v) { own(this, "ball", v); }
  get sg() { return r4(this.t.F[this.i * 2]); } set sg(v) { own(this, "sg", v); }
  get w() { return r4(this.t.F[this.i * 2 + 1]); } set w(v) { own(this, "w", v); }
  toJSON() { return { cat: this.cat, sg: this.sg, w: this.w, lie: this.lie, dist: this.dist, club: this.club, clubCat: this.clubCat, gear: this.gear, ball: this.ball }; }
}
class ObsV {
  constructor(t, i) { this.t = t; this.i = i; }
  get k() { return this.t.d[this.t.I[this.i * this.t.N]]; } set k(v) { own(this, "k", v); }
  get cat() { return this.t.d[this.t.I[this.i * this.t.N + 1]]; } set cat(v) { own(this, "cat", v); }
  get lie() { return this.t.d[this.t.I[this.i * this.t.N + 2]]; } set lie(v) { own(this, "lie", v); }
  get dist() { return this.t.d[this.t.I[this.i * this.t.N + 3]]; } set dist(v) { own(this, "dist", v); }
  get gear() { const x = this.t.N === 6 ? this.t.I[this.i * 6 + 4] : 0; return x ? this.t.d[x] : undefined; } set gear(v) { own(this, "gear", v); }
  get ball() { const x = this.t.N === 6 ? this.t.I[this.i * 6 + 5] : 0; return x ? this.t.d[x] : undefined; } set ball(v) { own(this, "ball", v); }
  get v() { return r4(this.t.F[this.i * 2]); } set v(x) { own(this, "v", x); }
  get w() { return r4(this.t.F[this.i * 2 + 1]); } set w(x) { own(this, "w", x); }
  toJSON() { return { k: this.k, cat: this.cat, lie: this.lie, dist: this.dist, gear: this.gear, ball: this.ball, v: this.v, w: this.w }; }
}
/** One stat's entries read as shots (what statRounds() makes: no strokes gained, no club). */
class StatV extends ObsV {
  get sg() { return 0; } set sg(v) { own(this, "sg", v); }
  get club() { return null; } set club(v) { own(this, "club", v); }
  get clubCat() { return null; } set clubCat(v) { own(this, "clubCat", v); }
  toJSON() { return { cat: this.cat, lie: this.lie, dist: this.dist, v: this.v, w: this.w, sg: 0, club: null, clubCat: null, gear: this.gear, ball: this.ball }; }
}
/** A round's shots (or stats) over the columns: a start and a count, or (after a filter) a list of positions. */
export class ColList {
  constructor(t, View, start, n, idx = null) { this.t = t; this.View = View; this.start = start; this.n = n; this.idx = idx; }
  get length() { return this.n; }
  pos(j) { return this.idx ? this.idx[j] : this.start + j; }
  at(j) { if (j < 0) j += this.n; return j >= 0 && j < this.n ? new this.View(this.t, this.pos(j)) : undefined; }
  [Symbol.iterator]() { let j = 0; const me = this; return { next: () => (j < me.n ? { value: new me.View(me.t, me.pos(j++)), done: false } : { value: undefined, done: true }), [Symbol.iterator]() { return this; } }; }
  forEach(f) { for (let j = 0; j < this.n; j++) f(new this.View(this.t, this.pos(j)), j, this); }
  map(f) { const out = new Array(this.n); for (let j = 0; j < this.n; j++) out[j] = f(new this.View(this.t, this.pos(j)), j, this); return out; }
  flatMap(f) { return this.map(f).flat(); }
  filter(f) {
    const keep = new Uint32Array(this.n); let m = 0;
    for (let j = 0; j < this.n; j++) { const p = this.pos(j); if (f(new this.View(this.t, p), j, this)) keep[m++] = p; }
    return new ColList(this.t, this.View, 0, m, keep.slice(0, m));
  }
  reduce(f, init) {
    let j = 0, acc = init;
    if (arguments.length < 2) { if (!this.n) throw new TypeError("Reduce of empty list with no initial value"); acc = new this.View(this.t, this.pos(0)); j = 1; }
    for (; j < this.n; j++) acc = f(acc, new this.View(this.t, this.pos(j)), j, this);
    return acc;
  }
  some(f) { for (let j = 0; j < this.n; j++) if (f(new this.View(this.t, this.pos(j)), j, this)) return true; return false; }
  every(f) { for (let j = 0; j < this.n; j++) if (!f(new this.View(this.t, this.pos(j)), j, this)) return false; return true; }
  find(f) { for (let j = 0; j < this.n; j++) { const v = new this.View(this.t, this.pos(j)); if (f(v, j, this)) return v; } return undefined; }
  findIndex(f) { for (let j = 0; j < this.n; j++) if (f(new this.View(this.t, this.pos(j)), j, this)) return j; return -1; }
  slice(a = 0, b = this.n) { if (a < 0) a += this.n; if (b < 0) b += this.n; a = Math.max(0, Math.min(this.n, a)); b = Math.max(a, Math.min(this.n, b)); const idx = new Uint32Array(b - a); for (let j = a; j < b; j++) idx[j - a] = this.pos(j); return new ColList(this.t, this.View, 0, b - a, idx); }
  concat(...more) { return [...this, ...more.flatMap((x) => (x && typeof x[Symbol.iterator] === "function" && typeof x !== "string" ? [...x] : [x]))]; }
  sort(f) { return [...this].sort(f); }
  toArray() { return [...this]; }
  /** (stats only) this round's entries of one stat, as shots, without making an object for each */
  asStat(key) {
    if (this.View !== ObsV) return null;
    const keep = new Uint32Array(this.n); let m = 0;
    const { d, I, N } = this.t;
    for (let j = 0; j < this.n; j++) { const p = this.pos(j); if (d[I[p * N]] === key) keep[m++] = p; }
    return new ColList(this.t, StatV, 0, m, keep.slice(0, m));
  }
  toJSON() { return this.toArray(); }
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
  // (each column copied out of the file into its own array, so the rest of the file (the header text) can be let go)
  const take = (T, n, sz) => { const t = new T(buf, base + off, n).slice(); off = pad4(off + n * sz); return t; };
  const sI = take(I, h.nS * SN, isz), sF = take(Float32Array, h.nS * 2, 4), oI = take(I, h.nO * ON, isz), oF = take(Float32Array, h.nO * 2, 4);
  const d = h.dict;
  let clubs = false;
  for (let i = 0; i < h.nS && !clubs; i++) if (sI[i * SN + 3] || (SN === 7 && (sI[i * SN + 5] || sI[i * SN + 6]))) clubs = true;
  const st = { d, I: sI, F: sF, N: SN, clubs }, ot = { d, I: oI, F: oF, N: ON };
  const year = String(h.year ?? "");
  let a = 0, b = 0;
  return h.players.map(([key, name, rounds]) => ({
    key, name,
    rounds: rounds.map(([rk, di, ei, roundNo, ti, ev, ns, no, ci]) => {
      const shots = new ColList(st, ShotV, a, ns), obs = new ColList(ot, ObsV, b, no);
      const has = new Set();
      for (let i = 0; i < no; i++) has.add(d[oI[(b + i) * ON]]);
      if (ns) has.add("sg");
      a += ns; b += no;
      const date = d[di] ?? "", event = d[ei] ?? "";
      const rd = { key: rk ?? `${date}|${event}|${roundNo}`, date, event, roundNo, year, tour: d[ti] ?? "", ...(ci && d[ci] ? { course: d[ci] } : {}), shots, obs, ...(ev ? { eventLevel: true } : {}) };
      rd.has = has;
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
