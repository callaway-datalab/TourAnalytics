// Which team member (coach, caddy, analyst) the admin is previewing, if any, and a helper that answers
// "whose team view is on screen?" for the pages that show one.
let previewTeam = null; // { uid, name, email, kind, access }

export const getPreviewTeam = () => previewTeam;
export const setPreviewTeam = (t) => { previewTeam = t; };

/** The team view being shown: the admin's preview of someone, or the signed-in team member's own. */
export function effectiveTeam(state) {
  if (state.isAdmin && previewTeam) {
    return { isTeam: true, preview: true, teamAccess: previewTeam.access || {}, uid: previewTeam.uid, email: previewTeam.email, name: previewTeam.name };
  }
  return { isTeam: !!state.isTeam, preview: false, teamAccess: state.teamAccess || {}, uid: state.user?.uid, email: state.user?.email, name: state.profile?.name };
}
