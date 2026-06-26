// ============================================================
// Shared session helpers for the LINE bot (read Firestore, format text)
// ============================================================
import { db } from "./_firebase.js";
import { collection, query, orderBy, limit, getDocs, doc, getDoc } from "firebase/firestore";

export const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://badcount.vercel.app").replace(/\/+$/, "");

export const joinUrl = (id) => `${BASE_URL}/#/join/${id}`;

export const randId = () => Math.random().toString(36).slice(2, 10);

export async function getSessionById(id) {
  const snap = await getDoc(doc(db, "sessions", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ก๊วนล่าสุดที่ยังเปิดอยู่ (ไม่ปิดยอด) — ถ้าไม่มีก๊วนเปิดเลย คืน null
export async function getLatestOpenSession() {
  const snap = await getDocs(query(collection(db, "sessions"), orderBy("date", "desc"), limit(15)));
  let open = null;
  snap.forEach((d) => {
    if (open) return;
    const s = { id: d.id, ...d.data() };
    if (s.status !== "closed") open = s;
  });
  return open;
}

export function formatThaiDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || "";
  return d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function sessionSummaryText(s) {
  const lines = [];
  lines.push("🏸 ก๊วน BadCount");
  lines.push("📅 " + formatThaiDate(s.date));
  if (s.location) lines.push("📍 " + s.location);
  const count = (s.members || []).length;
  lines.push(`👥 ลงชื่อแล้ว ${count} คน`);
  lines.push("");
  lines.push("ลงชื่อ/ดูยอด/จ่ายเงิน:");
  lines.push(joinUrl(s.id));
  return lines.join("\n");
}
