import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const FALLBACK_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg",
  authDomain: "fir-lms-prod.firebaseapp.com",
  projectId: "fir-lms-prod"
};

function getFirebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || FALLBACK_FIREBASE_CONFIG.apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || FALLBACK_FIREBASE_CONFIG.authDomain,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || FALLBACK_FIREBASE_CONFIG.projectId
  };
}

export function getSynchroFirebaseApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === "synchro-s");
  if (existing) return existing;
  try {
    return getApp("synchro-s");
  } catch {
    return initializeApp(getFirebaseConfig(), "synchro-s");
  }
}

export function getSynchroFirebaseAuth() {
  return getAuth(getSynchroFirebaseApp());
}

export function getSynchroFirestore() {
  return getFirestore(getSynchroFirebaseApp());
}
