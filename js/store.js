import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, writeBatch,
  runTransaction, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { auth, db } from "./firebase-init.js";
import { chunkRows, splitString, DOC_CHUNK_CHARS, UserError, makeCode } from "./data.js";

export { UserError };

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
      tx.set(doc(db, "users", uid), {
        email, name, clientKey: invite.data().clientKey, clientLabel: invite.data().clientLabel,
        inviteCode: code, createdAt: serverTimestamp(),
      });
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

const BATCH_LIMIT = 450; // Firestore hard limit is 500 writes per batch

async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
}

async function deleteCollection(colRef) {
  const snap = await getDocs(colRef);
  await commitInChunks(snap.docs.map((d) => (batch) => batch.delete(d.ref)));
}

/**
 * dataset: { idColumn, columns, byClient: Map<clientKey, {label, rows}>, rowCount, blankIdRows }
 * name/description as entered by the admin. Uploading the same name again replaces it.
 */
export async function uploadDataset(name, description, dataset) {
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
    chunks.forEach((data, i) => ops.push((batch) =>
      batch.set(doc(db, "clientData", clientKey, "datasets", datasetId, "chunks", String(i)), { data })));
  }
  await commitInChunks(ops);
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
  usersSnap.forEach((d) => labels.set(d.data().clientKey, d.data().clientLabel));
  invitesSnap.forEach((d) => { if (!labels.has(d.data().clientKey)) labels.set(d.data().clientKey, d.data().clientLabel); });
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

export async function uploadDocument({ title, description, audienceClientKey, file }) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new UserError("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
  const chunks = splitString(base64, DOC_CHUNK_CHARS);
  const docRef = doc(collection(db, "documents"));
  const ops = [(batch) => batch.set(docRef, {
    title, description: description || "", audienceClientKey: audienceClientKey || null,
    originalName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size,
    chunkCount: chunks.length, uploadedAt: serverTimestamp(),
  })];
  chunks.forEach((data, i) => ops.push((batch) => batch.set(doc(docRef, "chunks", String(i)), { data })));
  await commitInChunks(ops);
  return docRef.id;
}

export async function deleteDocumentFile(docId) {
  await deleteCollection(collection(db, "documents", docId, "chunks"));
  await deleteDoc(doc(db, "documents", docId));
}

export async function getDocumentBlobUrl(docMeta) {
  const chunks = await Promise.all(
    Array.from({ length: docMeta.chunkCount }, (_, i) => getDoc(doc(db, "documents", docMeta.id, "chunks", String(i)))));
  const base64 = chunks.map((snap) => snap.data().data).join("");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: docMeta.mimeType }));
}

/* ============================== Questions ============================== */

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

export async function askQuestion({ uid, clientKey, clientLabel, askerName, askerEmail, subject, body }) {
  // Two sequential writes, not one batch: the message-create rule reads the parent thread to
  // confirm ownership, and a sibling document created in the same batch isn't guaranteed visible
  // to that read yet. Awaiting the thread's creation first makes the second write unambiguous.
  const threadRef = doc(collection(db, "threads"));
  await setDoc(threadRef, {
    uid, clientKey, clientLabel, askerName, askerEmail, subject,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), adminUnread: true, userUnread: false, lastFromAdmin: false,
  });
  await addDoc(collection(db, "threads", threadRef.id, "messages"), {
    fromAdmin: false, body, authorUid: uid, createdAt: serverTimestamp(),
  });
  return threadRef.id;
}

export async function replyToThread(threadId, { fromAdmin, body, authorUid }) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "threads", threadId, "messages")), { fromAdmin, body, authorUid, createdAt: serverTimestamp() });
  batch.update(doc(db, "threads", threadId), {
    updatedAt: serverTimestamp(), adminUnread: !fromAdmin, userUnread: fromAdmin, lastFromAdmin: fromAdmin,
  });
  await batch.commit();
}

export function markThreadReadByAdmin(threadId) {
  return updateDoc(doc(db, "threads", threadId), { adminUnread: false });
}
export function markThreadReadByUser(threadId) {
  return updateDoc(doc(db, "threads", threadId), { userUnread: false });
}
