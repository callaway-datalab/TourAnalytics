// Copy this file to config.js (same folder) and fill in your own values.
// config.js is loaded by index.html; keep both files, only config.js is edited.
//
// Firebase config: Firebase Console -> Project settings -> General -> "Your apps" -> SDK setup and
// configuration -> Config. These values are not secret — they identify your project to the browser;
// the Firestore rules are what actually protect the data.
window.PORTAL_CONFIG = {
  portalName: "Your Portal Name",

  firebase: {
    apiKey: "REPLACE_ME",
    authDomain: "REPLACE_ME.firebaseapp.com",
    projectId: "REPLACE_ME",
    storageBucket: "REPLACE_ME.appspot.com",
    messagingSenderId: "REPLACE_ME",
    appId: "REPLACE_ME",
  },

  // Your admin account's Firebase Auth UID (Console -> Authentication -> your user -> "User UID").
  // Must exactly match the UID(s) you put in firestore.rules, or the admin screens will look empty.
  adminUids: ["REPLACE_WITH_ADMIN_UID"],
};
