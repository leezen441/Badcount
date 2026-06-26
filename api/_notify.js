// ============================================================
// Shared push helper — ส่งข้อความ invite (รายชื่อล่าสุด) เข้าทุกปลายทางที่บอทจำไว้
// ใช้ร่วมกัน: line-notify (ปุ่มกดเอง) + line-webhook (ตอนมีคนลงชื่อผ่าน LINE)
// ============================================================
import { db } from "./_firebase.js";
import { doc, getDoc } from "firebase/firestore";
import { pushMessage } from "./_line.js";
import { buildShareText, joinUrl } from "./_sessions.js";

export async function getTargets() {
  const snap = await getDoc(doc(db, "settings", "lineBot"));
  const cfg = snap.exists() ? snap.data() : {};
  // กลุ่ม + แชต 1:1 ล่าสุด (กันซ้ำ)
  return [...new Set([cfg.groupId, cfg.directUserId].filter(Boolean))];
}

// push ข้อความ invite ของ session เข้าทุกปลายทาง — คืน { ok, targets, skipped? }
export async function pushInvite(session) {
  const targets = await getTargets();
  if (targets.length === 0) return { ok: true, targets: 0, skipped: "no target" };
  const text = buildShareText(session, joinUrl(session.id));
  let anyOk = false;
  for (const to of targets) { if (await pushMessage(to, text)) anyOk = true; }
  return { ok: anyOk, targets: targets.length };
}
