// ============================================================
// LINE Webhook — /api/line-webhook
// คำสั่งเดียวที่รับ:
//   • startbadcount → จำแชต/กลุ่มนี้เป็นปลายทาง + เริ่มทำงาน (active)
//   • stopbadcount  → หยุดทำงาน (ไม่ push อะไรอีก)
// นอกนั้นเงียบหมด (ไม่มีเมนู/คำสั่งอื่น)
// ============================================================
import { db } from "./_firebase.js";
import { doc, getDoc, setDoc } from "firebase/firestore";
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
      "🏸 BadCount Bot\nType \"startbadcount\" to activate me here.");
    return;
  }

  if (event.type !== "message" || !event.message || event.message.type !== "text") return;

  const text = (event.message.text || "").trim();
  const isStart = /^start\s*badcount$/i.test(text);
  const isStop = /^stop\s*badcount$/i.test(text);
  if (!isStart && !isStop) return;   // ข้อความอื่น → เงียบ

  // ล็อกเจ้าของ: เฉพาะ LINE ID เจ้าของเท่านั้นที่สั่ง start/stop ได้
  const userId = event.source && event.source.userId;
  if (!(await isOwner(userId))) return;   // ไม่ใช่เจ้าของ → เงียบ

  if (isStart) await startBot(event);
  else await stopBot(event);
}

// Trust-On-First-Use: ยังไม่มีเจ้าของ → คนแรกที่สั่ง = เจ้าของ (ล็อกถาวร) · มีแล้ว → ต้องตรง userId
async function isOwner(userId) {
  if (!userId) return false;
  const ref = doc(db, "settings", "lineBot");
  const snap = await getDoc(ref);
  const cfg = snap.exists() ? snap.data() : {};
  if (!cfg.adminUserId) {
    await setDoc(ref, { adminUserId: userId }, { merge: true });
    return true;
  }
  return cfg.adminUserId === userId;
}

// เริ่มทำงาน: จำปลายทางนี้ (เคลียร์ปลายทางเก่า ให้ทำงานทีละที่) + active
async function startBot(event) {
  const source = event.source || {};
  const patch = { active: true, groupId: null, roomId: null, directUserId: null, updatedAt: Date.now() };
  let where = "this chat";
  if (source.type === "group" && source.groupId) { patch.groupId = source.groupId; where = "this group"; }
  else if (source.type === "room" && source.roomId) { patch.roomId = source.roomId; where = "this room"; }
  else if (source.type === "user" && source.userId) { patch.directUserId = source.userId; where = "this chat"; }

  await setDoc(doc(db, "settings", "lineBot"), patch, { merge: true });
  await replyMessage(event.replyToken,
    `✅ BadCount is now active in ${where}.\nNew sessions and sign-ups will be posted here automatically.`);
}

// หยุดทำงาน
async function stopBot(event) {
  await setDoc(doc(db, "settings", "lineBot"), { active: false, updatedAt: Date.now() }, { merge: true });
  await replyMessage(event.replyToken,
    "⏹️ BadCount stopped. No more messages will be sent here.");
}
