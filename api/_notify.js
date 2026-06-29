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

// ปลายทางที่ active (ต้อง startbadcount ก่อน) — คืน { targets, skipped? }
async function getActiveTargets() {
  const cfg = await getConfig();
  if (!cfg.active) return { targets: [], skipped: "inactive" };
  const targets = [...new Set([cfg.groupId, cfg.roomId, cfg.directUserId].filter(Boolean))];
  if (targets.length === 0) return { targets: [], skipped: "no target" };
  return { targets };
}

async function pushToTargets(text) {
  const { targets, skipped } = await getActiveTargets();
  if (skipped) return { ok: true, targets: 0, skipped };
  let anyOk = false;
  const errors = [];
  for (const to of targets) {
    const res = await pushMessage(to, text);
    if (res.ok) {
      anyOk = true;
    } else {
      errors.push({ target: to, status: res.status, body: res.body, error: res.error });
    }
  }
  return { ok: anyOk, targets: targets.length, errors: errors.length ? errors : undefined };
}

// push ข้อความ invite (รายชื่อล่าสุด) ของ session
export async function pushInvite(session) {
  return pushToTargets(buildShareText(session, joinUrl(session.id)));
}

// push ข้อความ text ตรงๆ (ใช้กับ auto-post ตอนปิด Court — ข้อความค้างชำระที่เว็บคำนวณมาแล้ว)
export async function pushText(text) {
  return pushToTargets(text);
}
