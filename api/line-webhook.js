// ============================================================
// LINE Webhook — /api/line-webhook
// รับ event จาก LINE → ตรวจลายเซ็น → ตอบกลับ/อัปเดต Firestore
// คำสั่ง: "เมนู", "ก๊วน/ลิงก์", "ลงชื่อ", "ยอด"
// ============================================================
import { db } from "./_firebase.js";
import { doc, setDoc, runTransaction } from "firebase/firestore";
import { verifySignature, replyMessage, getProfile } from "./_line.js";
import {
  getLatestOpenSession, getSessionById, sessionSummaryText, joinUrl, randId
} from "./_sessions.js";

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

  // ประมวลผลทุก event ให้เสร็จก่อนตอบ 200 (LINE รอได้ไม่กี่วินาที)
  await Promise.all((body.events || []).map(ev => handleEvent(ev).catch(e => console.error("event error", e))));
  res.status(200).end();
}

async function handleEvent(event) {
  const source = event.source || {};

  // จดจำปลายทางทุกครั้งที่เห็น event → ใช้ push แจ้งเตือนภายหลัง
  // - กลุ่ม → groupId · แชต 1:1 → directUserId (สำหรับเทส/เตือนแอดมิน)
  if (source.type === "group" && source.groupId) {
    await rememberTarget({ groupId: source.groupId }).catch(() => {});
  } else if (source.type === "user" && source.userId) {
    await rememberTarget({ directUserId: source.userId }).catch(() => {});
  }

  if (event.type === "join" || event.type === "follow") {
    await replyMessage(event.replyToken, welcomeText());
    return;
  }

  if (event.type !== "message" || !event.message || event.message.type !== "text") return;

  const text = (event.message.text || "").trim();
  const lc = text.toLowerCase();

  if (/^(เมนู|help|คำสั่ง|\?|menu)$/i.test(text)) {
    await replyMessage(event.replyToken, welcomeText());
    return;
  }
  if (/(ลงชื่อ|สมัคร|join|มาเล่น|จองคิว|ขอลง)/i.test(lc)) {
    await handleJoin(event, source);
    return;
  }
  if (/(ลิงก์|link|ก๊วน|วันนี้|อาทิตย์นี้)/i.test(lc)) {
    await handleLatestLink(event);
    return;
  }
  if (/(ยอด|เงิน|ค้าง|จ่าย|บิล|bill|balance|pay)/i.test(lc)) {
    await handleBalance(event, source);
    return;
  }

  // ไม่เข้าใจ → ตอบเฉพาะแชต 1:1 (ในกลุ่มเงียบไว้ ไม่กวน)
  if (source.type !== "group" && source.type !== "room") {
    await replyMessage(event.replyToken, "พิมพ์ \"เมนู\" เพื่อดูคำสั่งที่ใช้ได้ครับ 🏸");
  }
}

// ---------- handlers ----------

async function handleLatestLink(event) {
  const s = await getLatestOpenSession();
  if (!s) { await replyMessage(event.replyToken, "ยังไม่มีก๊วนที่เปิดอยู่ตอนนี้ครับ 🙏"); return; }
  await replyMessage(event.replyToken, sessionSummaryText(s));
}

async function handleJoin(event, source) {
  const s = await getLatestOpenSession();
  if (!s) { await replyMessage(event.replyToken, "ยังไม่มีก๊วนเปิดให้ลงชื่อครับ 🙏"); return; }
  if (s.status === "closed" || s.registrationClosed) {
    await replyMessage(event.replyToken, "ก๊วนนี้ปิดรับสมาชิกแล้วครับ");
    return;
  }

  const profile = await getProfile(source);
  const name = (profile && profile.displayName ? profile.displayName : "").trim();
  if (!name) {
    await replyMessage(event.replyToken, "ขอชื่อจากไลน์ไม่ได้ครับ ลงชื่อผ่านลิงก์นี้แทนได้เลย:\n" + joinUrl(s.id));
    return;
  }

  let result = "ok";
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "sessions", s.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) { result = "gone"; return; }
      const data = snap.data();
      if (data.status === "closed" || data.registrationClosed) { result = "closed"; return; }
      const members = data.members || [];
      if (members.some(m => (m.name || "").trim().toLowerCase() === name.toLowerCase())) { result = "dup"; return; }
      if (members.length >= 50) { result = "full"; return; }
      members.push({
        id: randId(),
        name,
        shuttlesUsed: 0,
        skill: null,
        buddyId: null,
        isPaused: true,   // ลงชื่อผ่านไลน์ = ยังไม่มาถึง → พักคิวไว้ก่อน (เหมือนลงผ่านลิงก์ join)
        viaLine: true
      });
      tx.update(ref, { members });
    });
  } catch (e) {
    console.error("join tx error", e);
    result = "error";
  }

  const messages = {
    gone:   "ก๊วนหายไปแล้วครับ ลองใหม่อีกครั้ง",
    closed: "ก๊วนนี้ปิดรับสมาชิกแล้วครับ",
    dup:    `มีชื่อ "${name}" ในก๊วนแล้วครับ ✓`,
    full:   "ก๊วนเต็มแล้วครับ (50 คน)",
    error:  "เกิดข้อผิดพลาด ลองลงชื่อผ่านลิงก์แทน:\n" + joinUrl(s.id),
    ok:     `ลงชื่อ "${name}" เรียบร้อย 🏸\n(สถานะ: พักคิวไว้ก่อน — พอถึงสนามให้แอดมินปลดพักคิว)\n\nดูยอด/จ่ายเงิน:\n${joinUrl(s.id)}`
  };
  await replyMessage(event.replyToken, messages[result] || messages.ok);
}

async function handleBalance(event, source) {
  // v1: ยังไม่คำนวณตัวเลขในบอท (กันเลขเงินผิด) → ส่งลิงก์ไปหน้าจ่ายเงินที่โชว์ยอดจริง
  const s = await getLatestOpenSession();
  if (!s) { await replyMessage(event.replyToken, "ยังไม่มีก๊วนที่เปิดอยู่ครับ"); return; }
  const profile = await getProfile(source);
  const name = profile && profile.displayName ? profile.displayName : "";
  const hint = name
    ? `ดูยอดของ "${name}" ได้ในลิงก์นี้เลยครับ 👇`
    : "ดูยอดของคุณได้ในลิงก์นี้เลยครับ 👇";
  await replyMessage(event.replyToken, `${hint}\n${joinUrl(s.id)}`);
}

// ---------- utils ----------

async function rememberTarget(patch) {
  await setDoc(doc(db, "settings", "lineBot"), { ...patch, updatedAt: Date.now() }, { merge: true });
}

function welcomeText() {
  return [
    "🏸 BadCount Bot — คำสั่งที่ใช้ได้:",
    "",
    "• พิมพ์ \"ลงชื่อ\" — เข้าร่วมก๊วนล่าสุด",
    "• พิมพ์ \"ก๊วน\" — ดูก๊วน + ลิงก์ลงชื่อ",
    "• พิมพ์ \"ยอด\" — ดูยอดที่ต้องจ่าย",
    "• พิมพ์ \"เมนู\" — แสดงเมนูนี้",
  ].join("\n");
}
