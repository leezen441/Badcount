// ============================================================
// Notify — /api/line-notify
// เรียกได้ 2 ทาง: ปุ่ม "LINE" ในหน้าก๊วน + ตอนมีคนลงชื่อผ่านลิงก์ join
// → push ข้อความ invite (รายชื่อล่าสุด) เข้าทุกปลายทางที่บอทจำไว้
// ============================================================
import { db } from "./_firebase.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { pushInvite, pushText } from "./_notify.js";
import { buildDueListText, buildCourtsOpenText } from "./_sessions.js";

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

    // ประกาศ "คอร์ดวันนี้เปิดแล้ว" — ส่งครั้งเดียวต่อก๊วน (กันส่งซ้ำด้วย lineOpenNotifiedAt)
    if (payload && payload.type === "open") {
      if (s.lineOpenNotifiedAt) { res.status(200).json({ ok: true, skipped: "already notified" }); return; }
      const r = await pushText(buildCourtsOpenText(s));
      if (r.ok && !r.skipped) { try { await updateDoc(ref, { lineOpenNotifiedAt: Date.now() }); } catch (_) {} }
      res.status(200).json(r);
      return;
    }

    let result;
    if (payload && payload.type === "due") {
      // ทวงเงิน → คำนวณยอดค้างฝั่ง server (แม่นยำ ไม่ต้องเชื่อ text จาก client)
      const dueText = buildDueListText(s);
      result = dueText ? await pushText(dueText) : { ok: true, skipped: "all paid" };
    } else {
      result = await pushInvite(s);   // รายชื่อ invite
    }
    if (result.ok && !result.skipped) { try { await updateDoc(ref, { lineNotifiedAt: Date.now() }); } catch (_) {} }
    res.status(200).json(result);
  } catch (e) {
    console.error("notify error", e);
    res.status(500).json({ ok: false, error: "server" });
  }
}
