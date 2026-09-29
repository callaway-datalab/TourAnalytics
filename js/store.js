import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, writeBatch,
  runTransaction, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { auth, db } from "./firebase-init.js";
import {
  chunkRows, splitString, DOC_CHUNK_CHARS, UserError, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, readableSize, makeCode, isTeamKey, normRole, teamKey, norm, rosterByEmail, sameAccess,
} from "./data.js";

export { UserError };

/** A readable reason for a failed upload, for the admin. Also logs the raw error to the console. */
export function uploadErrorMessage(err, what = "that file") {
  console.error(err);
  if (err instanceof UserError) return err.message;
  const code = err?.code || "";
  if (code.includes("permission-denied")) {
    return `Firebase refused to save ${what}. The security rules published in Firebase are probably out of date or have a different admin UID: paste in the latest firestore.rules (with your UID) and click Publish, then try again.`;
  }
  if (code.includes("invalid-argument") || code.includes("resource-exhausted")) {
    return `Firebase rejected ${what} (${code.replace("firestore/", "")}). If it's a large file, try a smaller one.`;
  }
  if (code.includes("unavailable")) return "Couldn't reach Firebase. Check your internet connection and try again.";
  return `Couldn't upload ${what}${code ? ` (${code.replace("firestore/", "")})` : ""}. Try again.`;
}

/* ============================== Invites ============================== */

export async function fetchInvite(code) {
  const snap = await getDoc(doc(db, "invites", code));
  return snap.exists() ? snap.data() : null;
}

/** Creates the Firebase Auth account, claims the invite, and writes the user profile — atomically
 *  for the Firestore half. If the invite turns out to be already claimed (a race), the freshly
 *  created Auth account is left signed out and unlinked to any client; see README for the caveat
 *  that its email address stays reserved (Firebase has no client-side "delete this stranger" call). */
export async function signUpWithCode({ code, name, email, password }) {
  email = String(email).trim().toLowerCase();
  // Team-member codes from the roster are tied to one email address. Check before creating the
  // login, so a mismatch doesn't leave an orphaned account behind.
  const pre = await fetchInvite(code);
  if (pre?.email && pre.email !== email) {
    throw new UserError("This access code was issued for a different email address. Sign up with the email address Callaway Analysts has for you.");
  }
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  try {
    await runTransaction(db, async (tx) => {
      const inviteRef = doc(db, "invites", code);
      const invite = await tx.get(inviteRef);
      if (!invite.exists() || invite.data().usedBy || invite.data().revoked
          || (invite.data().expiresAt && invite.data().expiresAt.toMillis() < Date.now())) {
        throw new UserError("That access code isn't valid anymore. Ask for a new one.");
      }
      tx.update(inviteRef, { usedBy: uid, usedAt: serverTimestamp() });
      const profile = {
        email, name, clientKey: invite.data().clientKey, clientLabel: invite.data().clientLabel,
        inviteCode: code, createdAt: serverTimestamp(),
      };
      if (invite.data().access) profile.access = invite.data().access; // team member: players from the roster
      tx.set(doc(db, "users", uid), profile);
    });
  } catch (err) {
    await auth.signOut();
    throw err;
  }
  return uid;
}

export function logIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function changeOwnPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, newPassword);
}

/* ============================== Admin: clients & codes ============================== */

export function watchInvites(cb) {
  return onSnapshot(query(collection(db, "invites"), orderBy("createdAt", "desc")), (snap) =>
    cb(snap.docs.map((d) => ({ code: d.id, ...d.data() }))));
}

export async function createInvite({ clientKey, clientLabel, note, days }) {
  const code = makeCode();
  const expiresAt = days > 0 ? Timestamp.fromMillis(Date.now() + days * 86400000) : null;
  await setDoc(doc(db, "invites", code), {
    clientKey, clientLabel, note: note || "", createdAt: serverTimestamp(), expiresAt,
    usedBy: null, usedAt: null, revoked: false,
  });
  return code;
}

export function revokeInvite(code) {
  return updateDoc(doc(db, "invites", code), { revoked: true });
}

export function watchUsers(cb) {
  return onSnapshot(collection(db, "users"), (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))));
}

/* ============================== Team roster ============================== */

const ROSTER_REF = () => doc(db, "config", "teamRoster");

export function watchTeamRoster(cb) {
  return onSnapshot(ROSTER_REF(), (snap) => cb(snap.exists() ? snap.data() : { entries: [], uploadedAt: null }));
}
export async function getTeamRoster() {
  const snap = await getDoc(ROSTER_REF());
  return snap.exists() ? snap.data() : { entries: [], uploadedAt: null };
}

/**
 * Makes the roster the single source of truth for team access:
 *  - saves it (so the admin can download it back and so other pages can show it),
 *  - sets every team member's account to exactly the players listed for their email
 *    (someone removed from the file loses all their players),
 *  - makes sure everyone listed who hasn't signed up yet has one open access code, tied to
 *    their email and carrying their players, and retires codes nobody needs any more.
 * Player accounts are never touched.
 */
export async function applyTeamRoster(entries) {
  const byEmail = rosterByEmail(entries);
  const [usersSnap, invitesSnap, previous] = await Promise.all([
    getDocs(collection(db, "users")), getDocs(collection(db, "invites")), getTeamRoster(),
  ]);
  const ops = [(b) => b.set(ROSTER_REF(), { entries, uploadedAt: serverTimestamp() })];

  // Each player's team, readable by that player: it's what the question form's checkboxes list.
  const byPlayer = new Map();
  for (const e of entries) {
    if (!byPlayer.has(e.playerKey)) byPlayer.set(e.playerKey, []);
    byPlayer.get(e.playerKey).push({ email: e.email, name: e.name, role: e.role });
  }
  for (const [key, members] of byPlayer) {
    ops.push((b) => b.set(doc(db, "teams", key), { members, updatedAt: serverTimestamp() }));
  }
  for (const key of new Set((previous.entries || []).map((e) => e.playerKey))) {
    if (!byPlayer.has(key)) ops.push((b) => b.delete(doc(db, "teams", key)));
  }

  const hasAccount = new Set();
  let updated = 0;
  usersSnap.forEach((d) => {
    const u = d.data();
    if (!isTeamKey(u.clientKey)) return;
    const email = norm(u.email);
    hasAccount.add(email);
    const next = byEmail.get(email)?.access || {};
    if (!sameAccess(u.access || {}, next)) { ops.push((b) => b.update(d.ref, { access: next })); updated++; }
  });

  const now = Date.now();
  const openCode = new Map();
  invitesSnap.forEach((d) => {
    const v = d.data();
    if (!isTeamKey(v.clientKey) || !v.email || v.usedBy || v.revoked || (v.expiresAt && v.expiresAt.toMillis() < now)) return;
    const email = norm(v.email);
    if (byEmail.has(email) && !hasAccount.has(email) && !openCode.has(email)) openCode.set(email, d);
    else ops.push((b) => b.update(d.ref, { revoked: true })); // removed from roster, already signed up, or a duplicate
  });

  let newCodes = 0;
  for (const [email, person] of byEmail) {
    if (hasAccount.has(email)) continue;
    const existing = openCode.get(email);
    if (existing) {
      const v = existing.data();
      if (!sameAccess(v.access || {}, person.access) || v.clientLabel !== person.name) {
        ops.push((b) => b.update(existing.ref, { access: person.access, clientLabel: person.name }));
      }
    } else {
      const code = makeCode();
      ops.push((b) => b.set(doc(db, "invites", code), {
        clientKey: teamKey(), clientLabel: person.name, note: "From team roster", email, access: person.access,
        createdAt: serverTimestamp(), expiresAt: null, usedBy: null, usedAt: null, revoked: false,
      }));
      newCodes++;
    }
  }
  await commitInChunks(ops);
  return { people: byEmail.size, links: entries.length, updated, newCodes };
}

export const sendPasswordReset = (email) => sendPasswordResetEmail(auth, email);

/** Revokes a client's access to their data (deletes their profile). Their Firebase Auth account
 *  still technically exists — deleting it outright needs the Admin SDK, which this app doesn't
 *  have. See README for the one-click manual step in the Firebase console. */
export function removeUserAccess(uid) {
  return deleteDoc(doc(db, "users", uid));
}

/* ============================== Datasets ============================== */

export function watchAdminDatasets(cb) {
  return onSnapshot(query(collection(db, "datasets"), orderBy("uploadedAt", "desc")), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

const BATCH_LIMIT = 450;            // Firestore hard limit is 500 writes per batch
const BATCH_BYTES = 2 * 1024 * 1024; // ...and ~10 MiB per request; small batches upload more reliably
const STALL_MS = 120000;             // a single batch taking longer than this is treated as stuck

/** Tag a batch op with roughly how many bytes it writes, so big uploads get split up. */
const sized = (op, bytes) => Object.assign(op, { bytes });

function commitWithWatchdog(batch) {
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new UserError(
      "The upload stopped making progress. Check your internet connection, reload the page, and try again. " +
      "If it keeps happening, try from a different network (some work or hotel networks block large uploads).")), STALL_MS);
  });
  return Promise.race([batch.commit(), stalled]).finally(() => clearTimeout(timer));
}

/** Commits ops in batches small enough for Firestore. onProgress(doneBytes, totalBytes) after each. */
async function commitInChunks(ops, onProgress) {
  const total = ops.reduce((n, op) => n + (op.bytes || 1000), 0);
  let batch = writeBatch(db), count = 0, bytes = 0, done = 0;
  const flush = async () => {
    await commitWithWatchdog(batch);
    done += bytes; if (onProgress) onProgress(done, total);
    batch = writeBatch(db); count = 0; bytes = 0;
  };
  for (const op of ops) {
    const b = op.bytes || 1000;
    if (count && (count >= BATCH_LIMIT || bytes + b > BATCH_BYTES)) await flush();
    op(batch); count++; bytes += b;
  }
  if (count) await flush();
}

async function deleteCollection(colRef) {
  const snap = await getDocs(colRef);
  await commitInChunks(snap.docs.map((d) => (batch) => batch.delete(d.ref)));
}

/**
 * dataset: { idColumn, columns, byClient: Map<clientKey, {label, rows}>, rowCount, blankIdRows }
 * name/description as entered by the admin. Uploading the same name again replaces it.
 */
export async function uploadDataset(name, description, dataset, onProgress) {
  const existing = await getDocs(query(collection(db, "datasets"), where("name", "==", name)));
  const datasetId = existing.empty ? doc(collection(db, "datasets")).id : existing.docs[0].id;
  const oldClientKeys = existing.empty ? [] : existing.docs[0].data().clientKeys || [];

  // Clean up client data this upload no longer covers, and any stale data for clients it still covers.
  const newClientKeys = [...dataset.byClient.keys()];
  for (const key of new Set([...oldClientKeys, ...newClientKeys])) {
    await deleteCollection(collection(db, "clientData", key, "datasets", datasetId, "chunks"));
  }

  const ops = [];
  ops.push((batch) => batch.set(doc(db, "datasets", datasetId), {
    name, description: description || "", idColumn: dataset.idColumn, columns: dataset.columns,
    rowCount: dataset.rowCount, blankIdRows: dataset.blankIdRows, clientKeys: newClientKeys,
    uploadedAt: serverTimestamp(),
  }));
  for (const key of oldClientKeys.filter((k) => !newClientKeys.includes(k))) {
    ops.push((batch) => batch.delete(doc(db, "clientData", key, "datasets", datasetId)));
  }
  for (const [clientKey, group] of dataset.byClient) {
    const chunks = chunkRows(group.rows);
    ops.push((batch) => batch.set(doc(db, "clientData", clientKey, "datasets", datasetId), {
      name, description: description || "", idColumn: dataset.idColumn, columns: dataset.columns,
      clientLabel: group.label, rowCount: group.rows.length, chunkCount: chunks.length, uploadedAt: serverTimestamp(),
    }));
    chunks.forEach((data, i) => ops.push(sized((batch) =>
      batch.set(doc(db, "clientData", clientKey, "datasets", datasetId, "chunks", String(i)), { data }), data.length * 2)));
  }
  await commitInChunks(ops, onProgress);
  return { datasetId, clients: newClientKeys.length };
}

export async function deleteDataset(datasetId) {
  const snap = await getDoc(doc(db, "datasets", datasetId));
  if (!snap.exists()) return;
  for (const key of snap.data().clientKeys || []) {
    await deleteCollection(collection(db, "clientData", key, "datasets", datasetId, "chunks"));
    await deleteDoc(doc(db, "clientData", key, "datasets", datasetId));
  }
  await deleteDoc(doc(db, "datasets", datasetId));
}

export function watchClientDatasets(clientKey, cb) {
  return onSnapshot(collection(db, "clientData", clientKey, "datasets"), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getDatasetMeta(clientKey, datasetId) {
  const snap = await getDoc(doc(db, "clientData", clientKey, "datasets", datasetId));
  if (!snap.exists()) throw new UserError("That dataset isn't available to you.");
  return { id: snap.id, ...snap.data() };
}

export async function getDatasetRows(clientKey, datasetId, chunkCount) {
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => getDoc(doc(db, "clientData", clientKey, "datasets", datasetId, "chunks", String(i)))));
  return chunks.flatMap((snap) => JSON.parse(snap.data().data));
}

/** Every clientKey known to the system, with a display label, from users/invites/datasets. */
export async function adminAllClients() {
  const [usersSnap, invitesSnap, datasetsSnap] = await Promise.all([
    getDocs(collection(db, "users")), getDocs(collection(db, "invites")), getDocs(collection(db, "datasets")),
  ]);
  const labels = new Map();
  // Players only: team members (coaches, caddies, ...) have "t_" keys and no data of their own.
  usersSnap.forEach((d) => { if (!isTeamKey(d.data().clientKey)) labels.set(d.data().clientKey, d.data().clientLabel); });
  invitesSnap.forEach((d) => {
    const k = d.data().clientKey;
    if (!isTeamKey(k) && !labels.has(k)) labels.set(k, d.data().clientLabel);
  });
  datasetsSnap.forEach((d) => (d.data().clientKeys || []).forEach((k) => { if (!labels.has(k)) labels.set(k, k.replace(/^c_/, "")); }));
  return { labels, usersSnap, invitesSnap, datasetsSnap };
}

export async function adminStats() {
  const [{ labels, usersSnap, invitesSnap, datasetsSnap }, documentsSnap] =
    await Promise.all([adminAllClients(), getDocs(collection(db, "documents"))]);
  const now = Date.now();
  const openInvites = invitesSnap.docs.filter((d) => {
    const v = d.data();
    return !v.usedBy && !v.revoked && (!v.expiresAt || v.expiresAt.toMillis() > now);
  }).length;
  return { clients: labels.size, accounts: usersSnap.size, openInvites, datasets: datasetsSnap.size, documents: documentsSnap.size };
}

/* ============================== Documents (PDF/PPTX) ============================== */

export function watchAdminDocuments(cb) {
  return onSnapshot(query(collection(db, "documents"), orderBy("uploadedAt", "desc")), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/** Two listeners merged client-side (shared docs + this client's own), so no composite index is needed. */
export function watchVisibleDocuments(clientKey, cb) {
  const state = { shared: [], mine: [] };
  const emit = () => cb([...state.shared, ...state.mine].sort((a, b) => (b.uploadedAt?.toMillis() ?? 0) - (a.uploadedAt?.toMillis() ?? 0)));
  const un1 = onSnapshot(query(collection(db, "documents"), where("audienceClientKey", "==", null)), (s) => {
    state.shared = s.docs.map((d) => ({ id: d.id, ...d.data() })); emit();
  });
  const un2 = onSnapshot(query(collection(db, "documents"), where("audienceClientKey", "==", clientKey)), (s) => {
    state.mine = s.docs.map((d) => ({ id: d.id, ...d.data() })); emit();
  });
  return () => { un1(); un2(); };
}

/** What a team member sees for one player: documents shared with everyone, plus that player's
 *  documents opened up to the team member's role. The latter are read from small pointer records
 *  at teamDocs/{player}/roles/{role}/docs/{docId}, because Firestore rules can only approve a
 *  query they can check up front, and "is my role in this document's list?" isn't one of those. */
export function watchTeamDocuments(clientKey, role, cb) {
  const state = { shared: [], team: [] };
  const emit = () => cb([...state.shared, ...state.team].sort((a, b) => (b.uploadedAt?.toMillis() ?? 0) - (a.uploadedAt?.toMillis() ?? 0)));
  const un1 = onSnapshot(query(collection(db, "documents"), where("audienceClientKey", "==", null)), (s) => {
    state.shared = s.docs.map((d) => ({ id: d.id, ...d.data() })); emit();
  });
  const un2 = onSnapshot(collection(db, "teamDocs", clientKey, "roles", role, "docs"), (s) => {
    state.team = s.docs.map((d) => ({ id: d.id, ...d.data() })); emit();
  }, () => { state.team = []; emit(); });
  return () => { un1(); un2(); };
}

/** Pick the right document feed for whoever is looking: a team member viewing a player, or the
 *  player themselves (also used for the admin's preview, which shows exactly what the player sees). */
export function watchDocumentsFor(clientKey, teamRole, cb) {
  return teamRole ? watchTeamDocuments(clientKey, teamRole, cb) : watchVisibleDocuments(clientKey, cb);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new UserError(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function base64ChunksToBlobUrl(getChunk, chunkCount, mimeType) {
  const chunks = await Promise.all(Array.from({ length: chunkCount }, (_, i) => getChunk(i)));
  const base64 = chunks.map((snap) => snap.data().data).join("");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export async function uploadDocument({ title, description, audienceClientKey, teamRoles = [], category = "performance", file, onProgress }) {
  const base64 = await fileToBase64(file);
  const chunks = splitString(base64, DOC_CHUNK_CHARS);
  const docRef = doc(collection(db, "documents"));
  const roles = audienceClientKey ? [...new Set(teamRoles.map(normRole).filter(Boolean))] : [];
  const meta = {
    title, description: description || "", audienceClientKey: audienceClientKey || null, teamRoles: roles, category,
    originalName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size,
    chunkCount: chunks.length, uploadedAt: serverTimestamp(),
  };
  // Chunks first, the visible records last, so nobody ever sees a document whose file isn't there yet.
  // Big files go up in several batches; if something fails part-way, clear out what was written.
  try {
    await commitInChunks(chunks.map((data, i) => sized((batch) => batch.set(doc(docRef, "chunks", String(i)), { data }), data.length)), onProgress);
    await commitInChunks([
      (batch) => batch.set(docRef, meta),
      ...roles.map((role) => (batch) => batch.set(doc(db, "teamDocs", audienceClientKey, "roles", role, "docs", docRef.id), meta)),
    ]);
  } catch (err) {
    deleteCollection(collection(db, "documents", docRef.id, "chunks")).catch(() => {});
    throw err;
  }
  return docRef.id;
}

/** Admin: move a report between Performance and Course (also updates the team copies). */
export async function setReportCategory(docId, category) {
  const snap = await getDoc(doc(db, "documents", docId));
  if (!snap.exists()) return;
  const { audienceClientKey, teamRoles = [] } = snap.data();
  const batch = writeBatch(db);
  batch.update(snap.ref, { category });
  for (const role of audienceClientKey ? teamRoles : []) {
    batch.update(doc(db, "teamDocs", audienceClientKey, "roles", role, "docs", docId), { category });
  }
  await batch.commit();
}

export async function deleteDocumentFile(docId) {
  const snap = await getDoc(doc(db, "documents", docId));
  const { audienceClientKey, teamRoles = [] } = snap.exists() ? snap.data() : {};
  for (const role of audienceClientKey ? teamRoles : []) {
    await deleteDoc(doc(db, "teamDocs", audienceClientKey, "roles", role, "docs", docId));
  }
  await deleteCollection(collection(db, "documents", docId, "chunks"));
  await deleteDoc(doc(db, "documents", docId));
}

export function getDocumentBlobUrl(docMeta) {
  return base64ChunksToBlobUrl(
    (i) => getDoc(doc(db, "documents", docMeta.id, "chunks", String(i))), docMeta.chunkCount, docMeta.mimeType);
}

/* ============================== Attachments ============================== */
// Files attached to a question or reply live with the conversation:
//   threads/{threadId}/attachments/{id}           details
//   threads/{threadId}/attachments/{id}/chunks/n  the file, in pieces
// and the message lists them, so anyone who can read the conversation can open them.

export function checkAttachments(files) {
  if (files.length > MAX_ATTACHMENTS) throw new UserError(`You can attach up to ${MAX_ATTACHMENTS} files at a time.`);
  const big = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (big) throw new UserError(`${big.name} is larger than the ${readableSize(MAX_ATTACHMENT_BYTES)} limit for attachments.`);
}

async function uploadAttachments(threadId, files, uid, onProgress) {
  const out = [];
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  let before = 0;
  for (const file of files) {
    const chunks = splitString(await fileToBase64(file), DOC_CHUNK_CHARS);
    const ref = doc(collection(db, "threads", threadId, "attachments"));
    await commitInChunks(
      chunks.map((data, i) => sized((b) => b.set(doc(ref, "chunks", String(i)), { data }), data.length)),
      onProgress && ((done, all) => onProgress(before + (file.size * done) / all, total)),
    );
    const meta = { name: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, chunkCount: chunks.length };
    await setDoc(ref, { ...meta, uploaderUid: uid, createdAt: serverTimestamp() });
    out.push({ id: ref.id, ...meta });
    before += file.size;
    if (onProgress) onProgress(before, total);
  }
  return out;
}

export function getAttachmentBlobUrl(threadId, att) {
  return base64ChunksToBlobUrl(
    (i) => getDoc(doc(db, "threads", threadId, "attachments", att.id, "chunks", String(i))), att.chunkCount, att.mimeType);
}

/* ============================== Questions ============================== */

/** The team listed for a player in the roster: [{ email, name, role }]. */
export async function getPlayerTeam(clientKey) {
  const snap = await getDoc(doc(db, "teams", clientKey));
  return snap.exists() ? snap.data().members || [] : [];
}

/** For a team member: questions their players chose to share with them, across all their players. */
export function watchSharedWithMe(playerKeys, email, cb) {
  const byPlayer = new Map();
  const emit = () => cb([...byPlayer.values()].flat().sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)));
  const unsubs = playerKeys.map((key) => onSnapshot(
    collection(db, "threadShares", key, "members", norm(email), "threads"),
    (snap) => { byPlayer.set(key, snap.docs.map((d) => ({ id: d.id, ...d.data() }))); emit(); },
    () => { byPlayer.set(key, []); emit(); },
  ));
  if (!playerKeys.length) cb([]);
  return () => unsubs.forEach((u) => u());
}

export function watchAdminThreads(cb) {
  return onSnapshot(query(collection(db, "threads"), orderBy("updatedAt", "desc")), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/** Sorted client-side (not server-side) so no composite index is required. */
export function watchMyThreads(uid, cb) {
  return onSnapshot(query(collection(db, "threads"), where("uid", "==", uid)), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0))));
}

export function watchThread(threadId, cb) {
  return onSnapshot(doc(db, "threads", threadId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

export function watchMessages(threadId, cb) {
  return onSnapshot(query(collection(db, "threads", threadId, "messages"), orderBy("createdAt", "asc")), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/** sample: true marks a test question the admin sends from the player preview. It's stored under the
 *  admin's own account, so the real player never sees it. */
export async function askQuestion({ uid, clientKey, clientLabel, askerName, askerEmail, subject, body, sample = false, shareWith = [], files = [], onProgress }) {
  checkAttachments(files);
  // Two sequential writes, not one batch: the message-create rule reads the parent thread to
  // confirm ownership, and a sibling document created in the same batch isn't guaranteed visible
  // to that read yet. Awaiting the thread's creation first makes the second write unambiguous.
  const threadRef = doc(collection(db, "threads"));
  await setDoc(threadRef, {
    uid, clientKey, clientLabel, askerName, askerEmail, subject,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), adminUnread: true, userUnread: false, lastFromAdmin: false,
    ...(sample ? { sample: true } : {}),
    // Team members the player chose to include. They can read the conversation; the admin always gets it.
    sharedWith: shareWith.map((m) => norm(m.email)),
    sharedWithNames: shareWith.map((m) => ({ name: m.name, role: m.role })),
  });
  const attachments = await uploadAttachments(threadRef.id, files, uid, onProgress);
  await addDoc(collection(db, "threads", threadRef.id, "messages"), {
    fromAdmin: false, body, authorUid: uid, createdAt: serverTimestamp(), attachments,
  });
  // A small pointer per team member so it shows up in their My Questions list.
  const shares = await Promise.allSettled(shareWith.map((m) => setDoc(
    doc(db, "threadShares", clientKey, "members", norm(m.email), "threads", threadRef.id),
    { subject, clientLabel, askerName, createdAt: serverTimestamp() })));
  shares.filter((r) => r.status === "rejected").forEach((r) => console.error("Couldn't share question:", r.reason));
  return threadRef.id;
}

export async function replyToThread(threadId, { fromAdmin, body, authorUid, files = [], onProgress }) {
  checkAttachments(files);
  const attachments = await uploadAttachments(threadId, files, authorUid, onProgress);
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "threads", threadId, "messages")), { fromAdmin, body, authorUid, createdAt: serverTimestamp(), attachments });
  batch.update(doc(db, "threads", threadId), {
    updatedAt: serverTimestamp(), adminUnread: !fromAdmin, userUnread: fromAdmin, lastFromAdmin: fromAdmin,
    archived: false, // a new message brings a completed question back
  });
  await batch.commit();
}

/** Mark a question completed (moves it to Archived) or reopen it. Completing also clears
 *  its "new" flag for whoever did it. */
export function setThreadArchived(threadId, archived, { asAdmin }) {
  const update = { archived, archivedAt: archived ? serverTimestamp() : null };
  if (archived) update[asAdmin ? "adminUnread" : "userUnread"] = false;
  return updateDoc(doc(db, "threads", threadId), update);
}

/** Delete a question for everyone: its messages, attachments and team shares, then the question. */
export async function deleteThread(threadId) {
  const ref = doc(db, "threads", threadId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const t = snap.data();
  const ops = (t.sharedWith || []).map((email) => (b) =>
    b.delete(doc(db, "threadShares", t.clientKey, "members", email, "threads", threadId)));
  const atts = await getDocs(collection(ref, "attachments"));
  atts.forEach((a) => {
    for (let i = 0; i < (a.data().chunkCount || 0); i++) ops.push((b) => b.delete(doc(a.ref, "chunks", String(i))));
    ops.push((b) => b.delete(a.ref));
  });
  const msgs = await getDocs(collection(ref, "messages"));
  msgs.forEach((m) => ops.push((b) => b.delete(m.ref)));
  await commitInChunks(ops);
  await deleteDoc(ref); // last: the rules above check ownership against it
}

export function markThreadReadByAdmin(threadId) {
  return updateDoc(doc(db, "threads", threadId), { adminUnread: false });
}
export function markThreadReadByUser(threadId) {
  return updateDoc(doc(db, "threads", threadId), { userUnread: false });
}
