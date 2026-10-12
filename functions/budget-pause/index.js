/*
 * Budget pause for Tour Analytics (update 128).
 *
 * A Cloud Run function triggered by the budget's Pub/Sub topic ("budget-alerts"). Cloud Billing posts
 * there several times a day with the month's spend. When the spend reaches the budget, this sets
 *   config/billing { paused: true, period, cost, budget, at }
 * in Firestore. The portal then stops downloading from Cloud Storage (the storage rules refuse it too) and
 * falls back to the round totals, as it worked before Blaze. Nothing is deleted and billing stays on.
 *
 * The admin switches it back on from Analyze (Resume). After a Resume it won't pause again in the same budget
 * month; it starts watching again when the next month's budget period begins.
 *
 * Deploy: see DEPLOY_BLAZE.md (Google Cloud console -> Cloud Run -> Write a function).
 * Entry point: budgetPause   Runtime: Node.js 22   Trigger: Pub/Sub topic budget-alerts
 */
const functions = require("@google-cloud/functions-framework");
const { Firestore, FieldValue } = require("@google-cloud/firestore");

const db = new Firestore(); // (this project's default database, as the function's service account)

functions.cloudEvent("budgetPause", async (event) => {
  const raw = event.data?.message?.data;
  if (!raw) return;
  const msg = JSON.parse(Buffer.from(raw, "base64").toString());
  const cost = Number(msg.costAmount), budget = Number(msg.budgetAmount), period = msg.costIntervalStart || null;
  console.log(`Budget "${msg.budgetDisplayName}": ${cost} of ${budget} (${period})`);
  if (!(budget > 0) || !(cost >= budget)) return; // still under budget

  const ref = db.doc("config/billing");
  const cur = (await ref.get()).data() || {};
  if (cur.paused === true) return; // already paused
  if (period && cur.resumedPeriod === period) { console.log("Resumed by the admin this month: not pausing again."); return; }
  await ref.set({ paused: true, period, cost, budget, at: FieldValue.serverTimestamp() }, { merge: true });
  console.log("Downloads paused.");
});
