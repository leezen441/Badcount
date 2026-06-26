// ============================================================
// LINE Webhook — /api/line-webhook
// คำสั่งเดียวที่รับ:
//   • startbadcount → จำแชต/กลุ่มนี้เป็นปลายทาง + เริ่มทำงาน (active)
//   • stopbadcount  → หยุดทำงาน (ไม่ push อะไรอีก)
// นอกนั้นเงียบหมด (ไม่มีเมนู/คำสั่งอื่น)
// ============================================================
import { db } from "./_firebase.js";
import { doc, setDoc } from "firebase/firestore";
import { verifySignature, replyMessage } from "./_line.js";

// อ่าน raw body ก่อนแตะ req.body (จำเป็นสำหรับตรวจลายเซ็น)
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("BadCount LINE webhook is running ✅");
    return;
  }

  const raw = await getRawBody(req);
  if (!verifySignature(raw, req.headers["x-line-signature"])) {
    res.status(401).send("invalid signature");
    return;
  }

  let body;
  try { body = JSON.parse(raw.toString("utf8")); }
  catch { res.status(400).send("bad json"); return; }

  await Promise.all((body.events || []).map(ev => handleEvent(ev).catch(e => console.error("event error", e))));
  res.status(200).end();
}

async function handleEvent(event) {
  if (event.type === "join" || event.type === "follow") {
    await replyMessage(event.replyToken,
      "🏸 BadCount Bot\nพิมพ์ startbadcount เพื่อเริ่มใช้งานในแชต/กลุ่มนี้");
    return;
  }

  if (event.type !== "message" || !event.message || event.message.type !== "text") return;

  const text = (event.message.text || "").trim();
  if (/^start\s*badcount$/i.test(text)) { await startBot(event); return; }
  if (/^stop\s*badcount$/i.test(text)) { await stopBot(event); return; }
  // ข้อความอื่น → เงียบ
}

// เริ่มทำงาน: จำปลายทางนี้ (เคลียร์ปลายทางเก่า ให้ทำงานทีละที่) + active
async function startBot(event) {
  const source = event.source || {};
  const patch = { active: true, groupId: null, roomId: null, directUserId: null, updatedAt: Date.now() };
  let where = "แชตนี้";
  if (source.type === "group" && source.groupId) { patch.groupId = source.groupId; where = "กลุ่มนี้"; }
  else if (source.type === "room" && source.roomId) { patch.roomId = source.roomId; where = "ห้องนี้"; }
  else if (source.type === "user" && source.userId) { patch.directUserId = source.userId; where = "แชตนี้"; }

  await setDoc(doc(db, "settings", "lineBot"), patch, { merge: true });
  await replyMessage(event.replyToken,
    `✅ BadCount เริ่มทำงานใน${where}แล้ว\nเปิดก๊วนใหม่หรือมีคนลงชื่อ ระบบจะอัปเดตรายชื่อมาที่นี่อัตโนมัติ\n\n(พิมพ์ stopbadcount เพื่อหยุด)`);
}

// หยุดทำงาน
async function stopBot(event) {
  await setDoc(doc(db, "settings", "lineBot"), { active: false, updatedAt: Date.now() }, { merge: true });
  await replyMessage(event.replyToken,
    "⏹️ BadCount หยุดทำงานแล้ว — จะไม่ส่งข้อความอีก\n\n(พิมพ์ startbadcount เพื่อเริ่มใหม่)");
}
