// ============================================================
// Daily reminder cron — /api/line-cron
// รันทุกเช้า 8 โมง (Bangkok) ผ่าน Vercel Cron (ตั้งใน vercel.json)
// → หา "ก๊วนที่ปิด Court ล่าสุดที่ยังมีคนค้างจ่าย" แล้วโพสทวงเข้า LINE
// → ถ้าทุกคนจ่ายครบ ไม่โพส (cron จะหยุดทวงเอง)
// ============================================================
import { db } from "./_firebase.js";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { buildDueListText } from "./_sessions.js";
import { pushText } from "./_notify.js";

export default async function handler(req, res) {
  // ถ้าตั้ง CRON_SECRET ไว้ ให้ตรวจ (Vercel ส่ง Authorization: Bearer <CRON_SECRET> มาให้)
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  try {
    // ดูก๊วนล่าสุด ~25 อัน หาตัวแรกที่ปิด Court แล้วยังมีคนค้างจ่าย
    const snap = await getDocs(query(collection(db, "sessions"), orderBy("date", "desc"), limit(25)));
    let target = null;
    let dueText = null;
    for (const d of snap.docs) {
      const s = { id: d.id, ...d.data() };
      if (s.status !== "closed") continue;
      const t = buildDueListText(s);
      if (t) { target = s; dueText = t; break; }   // เจอก๊วนปิดที่ยังค้างจ่าย
    }

    if (!dueText) { res.status(200).json({ ok: true, skipped: "no unpaid session" }); return; }

    const result = await pushText("⏰ แจ้งเตือนประจำวัน\n\n" + dueText);
    res.status(200).json({ ok: result.ok, session: target.id, ...result });
  } catch (e) {
    console.error("cron error", e);
    res.status(500).json({ ok: false, error: "server" });
  }
}
