// The Chat page: the same for everyone (chat.js). Replaces Questions (update 101).

export async function render(main, { flash }) {
  // (update 829) outside Callaway (players, coaches, caddies): Chat & support (an issue, a question, a feature request),
  // all to Callaway's analysts and the admin; the admin and analysts keep the full Chat to answer them
  const st = (await import("../auth.js")).getState();
  if (!st.isAdmin && st.profile?.kind !== "analyst") return (await import("./support.js")).render(main, { flash });
  // (update 893) the admin and the analysts: the support inbox (Issues, Questions, Feature requests; claim, assign, done) and the team's own chat
  return (await import("./inbox.js")).render(main, { flash });
}
