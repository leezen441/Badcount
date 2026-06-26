// ============================================================
// LINE Messaging API helpers (signature verify + reply/push + profile)
// อ่าน secret จาก Environment Variables (Vercel) — ไม่ฝังในโค้ด
//   LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
// ============================================================
import crypto from "crypto";

const LINE_API = "https://api.line.me/v2/bot";
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
export const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";

// ---- ตรวจลายเซ็น webhook (กันคนปลอม request) ----
export function verifySignature(rawBody, signature) {
  if (!CHANNEL_SECRET || !signature) return false;
  const hash = crypto.createHmac("sha256", CHANNEL_SECRET).update(rawBody).digest("base64");
  try {
    const a = Buffer.from(hash);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

// แปลง string เป็น text message object
function normalize(messages) {
  const arr = Array.isArray(messages) ? messages : [messages];
  return arr.map(m => (typeof m === "string" ? { type: "text", text: m } : m)).slice(0, 5);
}

async function linePost(path, payload) {
  if (!TOKEN) { console.error("[LINE] missing LINE_CHANNEL_ACCESS_TOKEN"); return false; }
  const r = await fetch(LINE_API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify(payload)
  });
  if (!r.ok) console.error("[LINE]", path, r.status, await r.text().catch(() => ""));
  return r.ok;
}

export function replyMessage(replyToken, messages) {
  return linePost("/message/reply", { replyToken, messages: normalize(messages) });
}

export function pushMessage(to, messages) {
  return linePost("/message/push", { to, messages: normalize(messages) });
}

// ---- ดึงชื่อผู้ใช้ (รองรับทั้ง 1:1, group, room) ----
export async function getProfile(source) {
  if (!TOKEN || !source || !source.userId) return null;
  let url;
  if (source.type === "group" && source.groupId) url = `${LINE_API}/group/${source.groupId}/member/${source.userId}`;
  else if (source.type === "room" && source.roomId) url = `${LINE_API}/room/${source.roomId}/member/${source.userId}`;
  else url = `${LINE_API}/profile/${source.userId}`;
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN } });
    if (!r.ok) return null;
    return await r.json(); // { displayName, userId, pictureUrl }
  } catch (_) {
    return null;
  }
}
