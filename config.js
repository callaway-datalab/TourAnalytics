// Copy this file to config.js (same folder) and fill in your own values.
// config.js is loaded by index.html; keep both files, only config.js is edited.
//
// Firebase config: Firebase Console -> Project settings -> General -> "Your apps" -> SDK setup and
// configuration -> Config. These values are not secret — they identify your project to the browser;
// the Firestore rules are what actually protect the data.
window.PORTAL_CONFIG = {
  portalName: "tour-analytics",

  firebase: {
    apiKey: "AIzaSyBdmwPyvexzKEpPIpcq5V5n6upEz5w8YpE",
    authDomain: "touranalytics-dd46e.firebaseapp.com",
    projectId: "touranalytics-dd46e",
    storageBucket: "touranalytics-dd46e.firebasestorage.app",
    messagingSenderId: "226979865222",
    appId: "1:226979865222:web:1166de620dd2210b07a707",
  },

  // Your admin account's Firebase Auth UID (Console -> Authentication -> your user -> "User UID").
  // Must exactly match the UID(s) you put in firestore.rules, or the admin screens will look empty.
  adminUids: ["gpz41RIE02U2Jxteu8H6AGCUjCx1"],
};
