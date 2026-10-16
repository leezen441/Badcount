// ============================================================
// LINE Webhook — /api/line-webhook
// คำสั่งที่รับ (ทุกคำตอบเป็น reply = ไม่กินโควตา push ของ LINE):
//   • startbadcount → จำแชต/กลุ่มนี้เป็นปลายทาง + เริ่มทำงาน (active)        [เจ้าของ]
//   • stopbadcount  → หยุดทำงาน (คำสั่งอื่นเงียบหมด)                           [เจ้าของ]
//   • invite        → ตอบ list invite ของก๊วนที่เปิดอยู่ล่าสุด                   [ทุกคน]
//   • close         → ก๊วนล่าสุด (วันที่ ≤ วันนี้):
//                       ปิดแล้ว → ตอบ list จ่ายเงิน                              [ทุกคน]
//                       ยังเปิด → ปิด Court ให้ + ตอบ list จ่ายเงิน                [เจ้าของ + คนที่อนุญาต]
//                                 คนที่ยังไม่อนุญาต → ได้รหัส 4 หลักให้เจ้าของอนุมัติ
//   • allow <code>  → อนุญาตคนที่ขอรหัสนั้น ให้สั่ง close ปิด Court ได้          [เจ้าของ]
//   • closers       → ดูรายชื่อคนที่ปิด Court ได้                                [เจ้าของ]
//   • disallow <n>  → ถอนสิทธิ์คนลำดับที่ n จาก closers                         [เจ้าของ]
// invite/close ใช้ได้เฉพาะตอนบอท active · นอกนั้นเงียบหมด
// ============================================================
import { db } from "./_firebase.js";
import { doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp } from "firebase/firestore";
import { verifySignature, replyMessage, getProfile } from "./_line.js";
import { getConfig } from "./_notify.js";
import { buildShareText, getLatestOpenSession, getLatestSession } from "./_sessions.js";

const CFG_REF = () => doc(db, "settings", "lineBot");
const CODE_TTL_MS = 30 * 60 * 1000;   // รหัสขออนุญาตหมดอายุใน 30 นาที

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
  const cmd = text.toLowerCase();
  const userId = event.source && event.source.userId;

  if (cmd === "invite") return replyInvite(event);
  if (cmd === "close") return handleClose(event, userId);

  const allowMatch = cmd.match(/^allow\s+(\d{4})$/);
  const disallowMatch = cmd.match(/^disallow\s+(\d+)$/);
  if (allowMatch || disallowMatch || cmd === "closers") {
    const cfg = await getConfig();
    if (!userId || cfg.adminUserId !== userId) return;   // ไม่ใช่เจ้าของ → เงียบ
    if (allowMatch) return allowCloser(event, cfg, allowMatch[1]);
    if (disallowMatch) return disallowCloser(event, cfg, Number(disallowMatch[1]));
    return listClosers(event, cfg);
  }

  const isStart = /^start\s*badcount$/i.test(text);
  const isStop = /^stop\s*badcount$/i.test(text);
  if (!isStart && !isStop) return;   // ข้อความอื่น → เงียบ

  // ล็อกเจ้าของ: เฉพาะ LINE ID เจ้าของเท่านั้นที่สั่ง start/stop ได้
  if (!(await isOwner(userId))) return;   // ไม่ใช่เจ้าของ → เงียบ

  if (isStart) await startBot(event);
  else await stopBot(event);
}

// ---------- invite ----------
async function replyInvite(event) {
  const cfg = await getConfig();
  if (!cfg.active) return;
  const s = await getLatestOpenSession();
  await replyMessage(event.replyToken, s ? buildShareText(s) : "🏸 No open court right now.");
}

// ---------- close ----------
async function handleClose(event, userId) {
  const cfg = await getConfig();
  if (!cfg.active) return;

  const s = await getLatestSession();
  if (!s) {
    await replyMessage(event.replyToken, "🏸 No court found.");
    return;
  }
  if (s.status === "closed") {
    await replyMessage(event.replyToken, buildShareText(s));
    return;
  }

  // ยังเปิดอยู่ → ต้องเป็นเจ้าของหรือคนที่อนุญาตถึงจะปิดได้
  const closers = cfg.closers || {};
  const allowed = !!userId && (userId === cfg.adminUserId || !!closers[userId]);
  const name = await displayName(event.source);

  if (!allowed) {
    if (!userId) return;
    const code = String(Math.floor(1000 + Math.random() * 9000));
    await setDoc(CFG_REF(), {
      pendingCloser: { code, userId, name, expiresAt: Date.now() + CODE_TTL_MS }
    }, { merge: true });
    await replyMessage(event.replyToken,
      `🔒 ${name} isn't allowed to close the court yet.\nOwner: type "allow ${code}" to allow ${name}.`);
    return;
  }

  // ปิด Court — เหมือนกดปุ่ม "ปิด Court" ในแอป (status + updatedAt)
  await updateDoc(doc(db, "sessions", s.id), { status: "closed", updatedAt: serverTimestamp() });
  await replyMessage(event.replyToken, [
    `🔴 Court closed by ${name}.`,
    buildShareText({ ...s, status: "closed" })
  ]);
}

// ---------- closers management (owner only) ----------
async function allowCloser(event, cfg, code) {
  const p = cfg.pendingCloser;
  if (!p || p.code !== code || Date.now() > Number(p.expiresAt || 0)) {
    await replyMessage(event.replyToken, "⚠️ That code is invalid or expired. Ask them to type \"close\" again.");
    return;
  }
  await updateDoc(CFG_REF(), {
    [`closers.${p.userId}`]: { name: p.name, addedAt: Date.now() },
    pendingCloser: deleteField()
  });
  await replyMessage(event.replyToken, `✅ ${p.name} can now close the court.`);
}

function closerList(cfg) {
  return Object.entries(cfg.closers || {})
    .map(([uid, v]) => ({ uid, name: (v && v.name) || "Unknown", addedAt: (v && v.addedAt) || 0 }))
    .sort((a, b) => a.addedAt - b.addedAt);
}

async function listClosers(event, cfg) {
  const list = closerList(cfg);
  const lines = ["🔑 Can close the court:", "• Owner (you)"];
  list.forEach((c, i) => lines.push(`${i + 1}. ${c.name}`));
  if (list.length) lines.push("", "Type \"disallow <number>\" to remove someone.");
  await replyMessage(event.replyToken, lines.join("\n"));
}

async function disallowCloser(event, cfg, n) {
  const c = closerList(cfg)[n - 1];
  if (!c) {
    await replyMessage(event.replyToken, "⚠️ No one with that number. Type \"closers\" to see the list.");
    return;
  }
  await updateDoc(CFG_REF(), { [`closers.${c.uid}`]: deleteField() });
  await replyMessage(event.replyToken, `🚫 ${c.name} can no longer close the court.`);
}

async function displayName(source) {
  const p = await getProfile(source);
  return (p && p.displayName) || "Someone";
}

// Trust-On-First-Use: ยังไม่มีเจ้าของ → คนแรกที่สั่ง = เจ้าของ (ล็อกถาวร) · มีแล้ว → ต้องตรง userId
async function isOwner(userId) {
  if (!userId) return false;
  const ref = CFG_REF();
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

  await setDoc(CFG_REF(), patch, { merge: true });
  await replyMessage(event.replyToken,
    `✅ BadCount is now active in ${where}.`);
}

// หยุดทำงาน
async function stopBot(event) {
  await setDoc(CFG_REF(), { active: false, updatedAt: Date.now() }, { merge: true });
  await replyMessage(event.replyToken,
    "⏹️ BadCount stopped. No more messages will be sent here.");
}
