// How players' names are shown outside the admin's own pages.
// When two player IDs share a name, the admin sees "Chris Walker (10452)". Players never see the ID,
// and coaches only see it when they work with both players of that name (so they can tell them apart).
const ID_SUFFIX = /\s\([^()]+\)$/;

export const plainName = (label) => String(label ?? "").replace(ID_SUFFIX, "");

/** For a team member's players ({ key: { label } }): key -> name, keeping the ID only where two of
 *  *their* players share a name. */
export function teamLabels(access = {}) {
  const entries = Object.entries(access).map(([k, g]) => [k, g.label || k.replace(/^c_/, "")]);
  const count = new Map();
  for (const [, l] of entries) { const b = plainName(l).toLowerCase(); count.set(b, (count.get(b) || 0) + 1); }
  return new Map(entries.map(([k, l]) => [k, count.get(plainName(l).toLowerCase()) > 1 ? l : plainName(l)]));
}
