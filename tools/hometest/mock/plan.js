// (update 815: Practice Week needs more of plan.js; a saved session goes on window.__saved)
export const addToPlan = async () => 0; export const removeFromPlan = async () => {};
export const listPlan = async () => [{ id: "old1", type: "session", title: "Approach work", createdAt: "2026-07-01T12:00:00Z", items: [{ key: "APP|140-160 yds", cat: "APP" }, { key: "PUTT|5-10 ft", cat: "PUTT" }] }];
export const newPlanId = () => "p" + Math.random().toString(36).slice(2, 8);
export const isMine = () => false; export const planOwnerFor = (s, k) => k;
export const savePlanItem = async (o, it) => { (window.__saved ||= []).push([o, it]); };
export const drillFor = (c, d) => ({ cat: c, dist: d });
export function goalText(d) {
  if (d.goal == null) return "Set your mark, then beat it";
  if (d.kind === "prox") return d.higher ? `Average ${d.goal} ${d.unit || "yds"} or more` : `Average inside ${d.goal} ft`;
  const verb = { make: "Hole", lag: "Leave", updown: "Get up and down", fairway: "Hit", green: "Hit", bunker: "Leave" }[d.kind] || "Get";
  const tail = { lag: " inside 3 ft", fairway: " fairways", ...(d.cat === "ARG" ? { green: " onto the green" } : {}), green: " greens", bunker: " inside 10 ft" }[d.kind] || "";
  return `${verb} ${d.goal} of ${d.reps}${tail}`; }
export const deletePlanItem = async () => {}; export const planOwner = () => "me"; export const goalSource = () => "";
