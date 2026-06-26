// ============================================================
// Notify — /api/line-notify
// เรียกได้ 2 ทาง: ปุ่ม "LINE" ในหน้าก๊วน + ตอนมีคนลงชื่อผ่านลิงก์ join
// → push ข้อความ invite (รายชื่อล่าสุด) เข้าทุกปลายทางที่บอทจำไว้
// ============================================================
import { db } from "./_firebase.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { pushInvite } from "./_notify.js";

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
    const result = await pushInvite(s);   // ข้อความรูปแบบ Invite → ทุกปลายทาง
    if (result.ok && !result.skipped) { try { await updateDoc(ref, { lineNotifiedAt: Date.now() }); } catch (_) {} }
    res.status(200).json(result);
  } catch (e) {
    console.error("notify error", e);
    res.status(500).json({ ok: false, error: "server" });
  }
}
