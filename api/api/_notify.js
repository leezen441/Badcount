// ============================================================
// Shared push helper — ส่งข้อความ invite (รายชื่อล่าสุด) เข้าทุกปลายทางที่บอทจำไว้
// ใช้ร่วมกัน: line-notify (ปุ่มกดเอง) + line-webhook (ตอนมีคนลงชื่อผ่าน LINE)
// ============================================================
import { db } from "./_firebase.js";
import { doc, getDoc } from "firebase/firestore";
import { pushMessage } from "./_line.js";
import { buildShareText, joinUrl } from "./_sessions.js";

export async function getConfig() {
  const snap = await getDoc(doc(db, "settings", "lineBot"));
  return snap.exists() ? snap.data() : {};
}

// push ข้อความ invite ของ session เข้าปลายทาง — คืน { ok, targets, skipped? }
// จะส่งก็ต่อเมื่อ active=true (ตั้งผ่าน startbadcount) เท่านั้น
export async function pushInvite(session) {
  const cfg = await getConfig();
  if (!cfg.active) return { ok: true, targets: 0, skipped: "inactive" };
  const targets = [...new Set([cfg.groupId, cfg.roomId, cfg.directUserId].filter(Boolean))];
  if (targets.length === 0) return { ok: true, targets: 0, skipped: "no target" };
  const text = buildShareText(session, joinUrl(session.id));
  let anyOk = false;
  for (const to of targets) { if (await pushMessage(to, text)) anyOk = true; }
  return { ok: anyOk, targets: targets.length };
}
