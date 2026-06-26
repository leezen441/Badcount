// ============================================================
// Shared Firebase (Firestore) client for serverless functions
// ใช้ config เดียวกับเว็บ (public) — Security Rules เปิดอยู่แล้ว จึงไม่ต้องใช้ service account
// ============================================================
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCacBRujL5GrmROxT-mirOWe_UUPuny2ss",
  authDomain: "badcount-a1296.firebaseapp.com",
  projectId: "badcount-a1296",
  storageBucket: "badcount-a1296.firebasestorage.app",
  messagingSenderId: "676843944300",
  appId: "1:676843944300:web:2298912c5e4c3319511b49"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
