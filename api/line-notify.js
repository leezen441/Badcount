// ============================================================
// Notify group on new session — /api/line-notify
// เว็บแอปเรียกตอนเปิดก๊วนใหม่ → push แจ้งกลุ่มไลน์ + ลิงก์ลงชื่อ
// กัน spam: push ได้ครั้งเดียวต่อก๊วน (ใช้ flag lineNotified บน doc)
// ============================================================
import { db } from "./_firebase.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { pushMessage } from "./_line.js";
import { sessionSummaryText } from "./_sessions.js";

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  // CORS (เผื่อเรียกข้ามโดเมน — ปกติ same-origin)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method" }); return; }

  let payload = {};
  try {
    const raw = await getRawBody(req);
    payload = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch { res.status(400).json({ ok: false, error: "bad json" }); return; }

  const sessionId = payload && payload.sessionId;
  if (!sessionId) { res.status(400).json({ ok: false, error: "missing sessionId" }); return; }

  try {
    const ref = doc(db, "sessions", String(sessionId));
    const snap = await getDoc(ref);
    if (!snap.exists()) { res.status(404).json({ ok: false, error: "session not found" }); return; }

    const s = { id: snap.id, ...snap.data() };

    // หา groupId ที่บอทจดไว้ตอนถูกเชิญเข้ากลุ่ม
    const gSnap = await getDoc(doc(db, "settings", "lineBot"));
    const groupId = gSnap.exists() ? gSnap.data().groupId : null;
    if (!groupId) { res.status(200).json({ ok: true, skipped: "no group registered" }); return; }

    // ปุ่มกดเอง → ส่งได้ทุกครั้ง (admin คุมเอง) จดเวลาส่งล่าสุดไว้เฉยๆ
    const ok = await pushMessage(groupId, "🏸 ก๊วนเปิดรับลงชื่อแล้ว!\n\n" + sessionSummaryText(s));
    if (ok) { try { await updateDoc(ref, { lineNotifiedAt: Date.now() }); } catch (_) {} }
    res.status(200).json({ ok });
  } catch (e) {
    console.error("notify error", e);
    res.status(500).json({ ok: false, error: "server" });
  }
}
