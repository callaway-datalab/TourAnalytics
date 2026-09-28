/**
 * Tests the actual firestore.rules file against the real Firestore emulator — the layer that
 * enforces data privacy in this app. Claude could not run this suite (no internet access in that
 * sandbox), so it has not been verified against a live emulator. Run it yourself before trusting
 * the rules with real client data:
 *
 *   npm install --no-save firebase-tools @firebase/rules-unit-testing
 *   npx firebase emulators:exec --only firestore "node tests/rules.test.mjs"
 *
 * (needs Node 18+ and a JVM for the emulator; `java -version` should print something).
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

const ADMIN_UID = "admin-uid";
let testEnv;
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "\n      " + e.message); }
}

async function seedAsAdmin(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8")
  .replace("REPLACE_WITH_ADMIN_UID", ADMIN_UID);
testEnv = await initializeTestEnvironment({
  projectId: "rules-test", firestore: { rules, host: "127.0.0.1", port: 8080 },
});

const admin = () => testEnv.authenticatedContext(ADMIN_UID).firestore();
const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

// ---------------------------------------------------------------------------
await t("admin can create an invite; a signed-out visitor can read it by its code (get, not list)", async () => {
  await assertSucceeds(setDoc(doc(admin(), "invites", "CODE123"), {
    clientKey: "c_acme", clientLabel: "Acme", note: "", createdAt: serverTimestamp(),
    expiresAt: null, usedBy: null, usedAt: null, revoked: false,
  }));
  await assertSucceeds(getDoc(doc(anon(), "invites", "CODE123")));
});

await t("a non-admin cannot create an invite", async () => {
  await assertFails(setDoc(doc(asUser("mallory"), "invites", "HACKED1"), {
    clientKey: "c_acme", clientLabel: "Acme", note: "", createdAt: serverTimestamp(),
    expiresAt: null, usedBy: null, usedAt: null, revoked: false,
  }));
});

await t("nobody can list the invites collection except admin (codes aren't browsable)", async () => {
  await assertFails((async () => { const { getDocs } = await import("firebase/firestore"); return getDocs(collection(asUser("mallory"), "invites")); })());
  const { getDocs } = await import("firebase/firestore");
  await assertSucceeds(getDocs(collection(admin(), "invites")));
});

await t("signing up claims the invite and creates a matching profile in one go", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "invites", "CODE456"), {
    clientKey: "c_beta", clientLabel: "Beta Co", note: "", createdAt: serverTimestamp(),
    expiresAt: null, usedBy: null, usedAt: null, revoked: false,
  }));
  const db = asUser("alice-uid");
  await assertSucceeds(updateDoc(doc(db, "invites", "CODE456"), { usedBy: "alice-uid", usedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, "users", "alice-uid"), {
    email: "alice@example.com", name: "Alice", clientKey: "c_beta", clientLabel: "Beta Co",
    inviteCode: "CODE456", createdAt: serverTimestamp(),
  }));
});

await t("a client cannot invent a clientKey that doesn't match the invite they're claiming", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "invites", "CODE789"), {
    clientKey: "c_gamma", clientLabel: "Gamma", note: "", createdAt: serverTimestamp(),
    expiresAt: null, usedBy: null, usedAt: null, revoked: false,
  }));
  const db = asUser("mallory-uid");
  await assertFails(setDoc(doc(db, "users", "mallory-uid"), {
    email: "m@example.com", name: "Mallory", clientKey: "c_beta", // wrong key, doesn't match CODE789
    clientLabel: "Beta Co", inviteCode: "CODE789", createdAt: serverTimestamp(),
  }));
});

await t("an already-used invite cannot be claimed again", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "invites", "USED001"), {
    clientKey: "c_delta", clientLabel: "Delta", note: "", createdAt: serverTimestamp(),
    expiresAt: null, usedBy: "someone-else", usedAt: serverTimestamp(), revoked: false,
  }));
  await assertFails(updateDoc(doc(asUser("mallory-uid"), "invites", "USED001"), { usedBy: "mallory-uid", usedAt: serverTimestamp() }));
});

await t("a client can read only their own clientData; not another client's", async () => {
  await seedAsAdmin(async (db) => {
    await setDoc(doc(db, "users", "alice-uid"), { email: "a@x.com", name: "A", clientKey: "c_beta", clientLabel: "Beta Co", inviteCode: "x", createdAt: serverTimestamp() });
    await setDoc(doc(db, "clientData", "c_beta", "datasets", "ds1"), { name: "Sales", columns: [], idColumn: "id", clientLabel: "Beta Co", rowCount: 1, chunkCount: 1, uploadedAt: serverTimestamp() });
    await setDoc(doc(db, "clientData", "c_beta", "datasets", "ds1", "chunks", "0"), { data: "[[1]]" });
    await setDoc(doc(db, "clientData", "c_other", "datasets", "ds2"), { name: "Other", columns: [], idColumn: "id", clientLabel: "Other Co", rowCount: 1, chunkCount: 1, uploadedAt: serverTimestamp() });
  });
  const alice = asUser("alice-uid");
  await assertSucceeds(getDoc(doc(alice, "clientData", "c_beta", "datasets", "ds1")));
  await assertSucceeds(getDoc(doc(alice, "clientData", "c_beta", "datasets", "ds1", "chunks", "0")));
  await assertFails(getDoc(doc(alice, "clientData", "c_other", "datasets", "ds2")));
});

await t("a document shared with everyone is readable by any signed-in client; a private one only by its client", async () => {
  await seedAsAdmin(async (db) => {
    await setDoc(doc(db, "users", "alice-uid"), { email: "a@x.com", name: "A", clientKey: "c_beta", clientLabel: "Beta Co", inviteCode: "x", createdAt: serverTimestamp() });
    await setDoc(doc(db, "users", "bob-uid"), { email: "b@x.com", name: "B", clientKey: "c_other", clientLabel: "Other", inviteCode: "y", createdAt: serverTimestamp() });
    await setDoc(doc(db, "documents", "doc1"), { title: "Shared", audienceClientKey: null, originalName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, chunkCount: 1, uploadedAt: serverTimestamp() });
    await setDoc(doc(db, "documents", "doc1", "chunks", "0"), { data: "AA==" });
    await setDoc(doc(db, "documents", "doc2"), { title: "Private", audienceClientKey: "c_beta", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: 1, chunkCount: 1, uploadedAt: serverTimestamp() });
    await setDoc(doc(db, "documents", "doc2", "chunks", "0"), { data: "AA==" });
  });
  await assertSucceeds(getDoc(doc(asUser("bob-uid"), "documents", "doc1")));
  await assertSucceeds(getDoc(doc(asUser("alice-uid"), "documents", "doc2")));
  await assertFails(getDoc(doc(asUser("bob-uid"), "documents", "doc2")));
  await assertFails(getDoc(doc(asUser("bob-uid"), "documents", "doc2", "chunks", "0")));
});

await t("a client can create and read their own question thread; not someone else's", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "users", "alice-uid"), { email: "a@x.com", name: "A", clientKey: "c_beta", clientLabel: "Beta Co", inviteCode: "x", createdAt: serverTimestamp() }));
  const alice = asUser("alice-uid");
  const threadRef = doc(collection(alice, "threads"));
  await assertSucceeds(setDoc(threadRef, {
    uid: "alice-uid", clientKey: "c_beta", clientLabel: "Beta Co", askerName: "A", askerEmail: "a@x.com",
    subject: "Hi", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), adminUnread: true, userUnread: false, lastFromAdmin: false,
  }));
  await assertFails(getDoc(doc(asUser("bob-uid"), "threads", threadRef.id)));
  await assertSucceeds(getDoc(doc(admin(), "threads", threadRef.id)));
});

await t("a client cannot mark their own follow-up as already answered (can't forge lastFromAdmin)", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "users", "alice-uid"), { email: "a@x.com", name: "A", clientKey: "c_beta", clientLabel: "Beta Co", inviteCode: "x", createdAt: serverTimestamp() }));
  const alice = asUser("alice-uid");
  const threadRef = doc(collection(alice, "threads"));
  await seedAsAdmin((db) => setDoc(doc(db, "threads", threadRef.id), {
    uid: "alice-uid", clientKey: "c_beta", clientLabel: "Beta Co", askerName: "A", askerEmail: "a@x.com",
    subject: "Hi", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), adminUnread: false, userUnread: false, lastFromAdmin: true,
  }));
  await assertFails(updateDoc(doc(alice, "threads", threadRef.id), { lastFromAdmin: false, adminUnread: false, userUnread: false }));
});

await t("only admin or the asker can post into a thread's messages, and only as themselves", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "threads", "t1"), {
    uid: "alice-uid", clientKey: "c_beta", clientLabel: "Beta Co", askerName: "A", askerEmail: "a@x.com",
    subject: "Hi", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), adminUnread: true, userUnread: false, lastFromAdmin: false,
  }));
  await assertSucceeds(addDoc(collection(asUser("alice-uid"), "threads", "t1", "messages"), { fromAdmin: false, body: "hey", authorUid: "alice-uid", createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(asUser("bob-uid"), "threads", "t1", "messages"), { fromAdmin: false, body: "hey", authorUid: "bob-uid", createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(asUser("alice-uid"), "threads", "t1", "messages"), { fromAdmin: true, body: "hey", authorUid: "alice-uid", createdAt: serverTimestamp() }));
  await assertSucceeds(addDoc(collection(admin(), "threads", "t1", "messages"), { fromAdmin: true, body: "reply", authorUid: ADMIN_UID, createdAt: serverTimestamp() }));
});

await t("messages can't be edited or deleted by anyone", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "threads", "t2"), {
    uid: "alice-uid", clientKey: "c_beta", clientLabel: "Beta Co", askerName: "A", askerEmail: "a@x.com",
    subject: "Hi", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), adminUnread: true, userUnread: false, lastFromAdmin: false,
  }));
  const msgRef = doc(collection(asUser("alice-uid"), "threads", "t2", "messages"));
  await seedAsAdmin((db) => setDoc(doc(db, "threads", "t2", "messages", msgRef.id), { fromAdmin: false, body: "hey", authorUid: "alice-uid", createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asUser("alice-uid"), "threads", "t2", "messages", msgRef.id), { body: "edited" }));
  await assertFails(deleteDoc(doc(admin(), "threads", "t2", "messages", msgRef.id)));
});

// ---------------------------------------------------------------------------
// Team members (coaches, caddies, ...)
await t("team member: admin can grant access; the team member (or a player) cannot grant it to themselves", async () => {
  const { getDocs } = await import("firebase/firestore");
  await seedAsAdmin(async (db) => {
    await setDoc(doc(db, "users", "coach-uid"), { email: "c@x.com", name: "Coach", clientKey: "t_coach1", clientLabel: "Coach", inviteCode: "X", createdAt: serverTimestamp() });
    await setDoc(doc(db, "users", "pat-uid"), { email: "p@x.com", name: "Pat", clientKey: "c_pat", clientLabel: "Pat", inviteCode: "Y", createdAt: serverTimestamp() });
  });
  await assertFails(updateDoc(doc(asUser("coach-uid"), "users", "coach-uid"), { access: { c_pat: { role: "coach", label: "Pat" } } }));
  await assertFails(updateDoc(doc(asUser("pat-uid"), "users", "pat-uid"), { access: { c_beta: { role: "coach", label: "Beta" } } }));
  await assertFails(updateDoc(doc(admin(), "users", "coach-uid"), { access: { c_pat: { role: "coach", label: "Pat" } }, clientKey: "c_pat" }));
  await assertSucceeds(updateDoc(doc(admin(), "users", "coach-uid"), { access: { c_pat: { role: "coach", label: "Pat" } } }));
});

await t("team member: reads only the players they were given, and can't write their data", async () => {
  const { getDocs } = await import("firebase/firestore");
  await seedAsAdmin(async (db) => {
    await setDoc(doc(db, "clientData", "c_pat", "datasets", "d1"), { name: "S", columns: [], idColumn: "id", clientLabel: "Pat", rowCount: 1, chunkCount: 1, uploadedAt: serverTimestamp() });
    await setDoc(doc(db, "clientData", "c_pat", "datasets", "d1", "chunks", "0"), { data: "[[1]]" });
    await setDoc(doc(db, "clientData", "c_other", "datasets", "d2"), { name: "S", columns: [], idColumn: "id", clientLabel: "O", rowCount: 1, chunkCount: 1, uploadedAt: serverTimestamp() });
  });
  const coach = asUser("coach-uid");
  await assertSucceeds(getDocs(collection(coach, "clientData", "c_pat", "datasets")));
  await assertSucceeds(getDoc(doc(coach, "clientData", "c_pat", "datasets", "d1", "chunks", "0")));
  await assertFails(getDocs(collection(coach, "clientData", "c_other", "datasets")));
  await assertFails(setDoc(doc(coach, "clientData", "c_pat", "datasets", "d1"), { name: "hacked" }));
});

await t("team member: sees a player's document only if their role was ticked", async () => {
  const { getDocs } = await import("firebase/firestore");
  const meta = (roles) => ({ title: "T", audienceClientKey: "c_pat", teamRoles: roles, originalName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, chunkCount: 1, uploadedAt: serverTimestamp() });
  await seedAsAdmin(async (db) => {
    await setDoc(doc(db, "documents", "forCoach"), meta(["coach"]));
    await setDoc(doc(db, "documents", "forCoach", "chunks", "0"), { data: "AA==" });
    await setDoc(doc(db, "teamDocs", "c_pat", "roles", "coach", "docs", "forCoach"), meta(["coach"]));
    await setDoc(doc(db, "documents", "playerOnly"), meta([]));
    await setDoc(doc(db, "documents", "playerOnly", "chunks", "0"), { data: "AA==" });
  });
  const coach = asUser("coach-uid");
  await assertSucceeds(getDocs(collection(coach, "teamDocs", "c_pat", "roles", "coach", "docs")));
  await assertFails(getDocs(collection(coach, "teamDocs", "c_pat", "roles", "caddy", "docs")));
  await assertSucceeds(getDoc(doc(coach, "documents", "forCoach", "chunks", "0")));
  await assertFails(getDoc(doc(coach, "documents", "playerOnly", "chunks", "0")));
  await assertFails(setDoc(doc(coach, "teamDocs", "c_pat", "roles", "coach", "docs", "fake"), meta(["coach"])));
});

await t("a code without players can't be used to sign up with players filled in", async () => {
  await seedAsAdmin((db) => setDoc(doc(db, "invites", "TEAMCODE1"), { clientKey: "t_new", clientLabel: "New", note: "", createdAt: serverTimestamp(), expiresAt: null, usedBy: null, usedAt: null, revoked: false }));
  await assertFails(setDoc(doc(asUser("new-uid"), "users", "new-uid"), {
    email: "n@x.com", name: "New", clientKey: "t_new", clientLabel: "New", inviteCode: "TEAMCODE1", createdAt: serverTimestamp(),
    access: { c_pat: { role: "coach", label: "Pat" } },
  }));
});

await t("roster code: signs up only with its email, and must copy the invite's players exactly", async () => {
  const access = { c_pat: { role: "coach", label: "Pat" } };
  await seedAsAdmin((db) => setDoc(doc(db, "invites", "ROSTER001"), {
    clientKey: "t_r1", clientLabel: "Mike", note: "From team roster", email: "mike@x.com", access,
    createdAt: serverTimestamp(), expiresAt: null, usedBy: null, usedAt: null, revoked: false,
  }));
  const profile = (extra) => ({ email: "mike@x.com", name: "Mike", clientKey: "t_r1", clientLabel: "Mike", inviteCode: "ROSTER001", createdAt: serverTimestamp(), ...extra });
  const as = (uid, email) => testEnv.authenticatedContext(uid, { email }).firestore();
  await assertFails(setDoc(doc(as("evil-uid", "evil@x.com"), "users", "evil-uid"), profile({ access })));
  await assertFails(setDoc(doc(as("m1", "mike@x.com"), "users", "m1"), profile({ access: { c_pat: { role: "coach", label: "Pat" }, c_other: { role: "coach", label: "O" } } })));
  await assertFails(setDoc(doc(as("m1", "mike@x.com"), "users", "m1"), profile({})));
  await assertSucceeds(setDoc(doc(as("m1", "mike@x.com"), "users", "m1"), profile({ access })));
});

await t("config (the roster) is admin-only", async () => {
  await assertSucceeds(setDoc(doc(admin(), "config", "teamRoster"), { entries: [] }));
  await assertFails(getDoc(doc(asUser("coach-uid"), "config", "teamRoster")));
});

console.log(`\n${passed} passed, ${failed} failed`);
await testEnv.cleanup();
process.exit(failed ? 1 : 0);
