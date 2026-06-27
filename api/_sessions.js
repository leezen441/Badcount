// ============================================================
// Shared session helpers for the LINE bot (read Firestore, format text)
// ข้อความใช้รูปแบบเดียวกับปุ่ม Invite ในเว็บ (buildShareText) — มีรายชื่อสมาชิก
// ============================================================
import { db } from "./_firebase.js";
import { collection, query, orderBy, limit, getDocs, doc, getDoc } from "firebase/firestore";
import { calcSessionTotals } from "./_totals.js";

const fmt = (n) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://badcount.vercel.app").replace(/\/+$/, "");

// ตรงกับลิงก์ที่ปุ่ม Invite ใช้ (มี ?openExternalBrowser=1 ให้ LINE เปิดในเบราว์เซอร์จริง)
export const joinUrl = (id) => `${BASE_URL}/?openExternalBrowser=1#/join/${id}`;

export const randId = () => Math.random().toString(36).slice(2, 10);

export async function getSessionById(id) {
  const snap = await getDoc(doc(db, "sessions", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ก๊วนล่าสุดที่ยังเปิดอยู่ (ไม่ปิดยอด) — ถ้าไม่มีก๊วนเปิดเลย คืน null
export async function getLatestOpenSession() {
  const snap = await getDocs(query(collection(db, "sessions"), orderBy("date", "desc"), limit(15)));
  let open = null;
  snap.forEach((d) => {
    if (open) return;
    const s = { id: d.id, ...d.data() };
    if (s.status !== "closed") open = s;
  });
  return open;
}

// ---- ต่อไปนี้ยกมาจาก app.js ฝั่งเว็บ (formatDate / formatCourtsForShare / buildShareText) ----

function formatDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

function formatTimeRangeForShare(startTime, endTime) {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  if (startTime) return `เริ่ม ${startTime}`;
  if (endTime) return `ถึง ${endTime}`;
  return "";
}

function formatCourtsForShare(courts) {
  const valid = (courts || []).filter(c => c.number || c.startTime || c.endTime);
  if (valid.length === 0) return "";

  const groups = new Map();
  valid.forEach(c => {
    const key = `${c.startTime || ""}|${c.endTime || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });

  const lines = [];
  groups.forEach(group => {
    const numbers = group.map(c => c.number).filter(Boolean);
    const timeStr = formatTimeRangeForShare(group[0].startTime, group[0].endTime);
    let line = "";
    if (numbers.length > 0) line += `🏟️ สนาม ${numbers.join(", ")}`;
    if (timeStr) line += (line ? "  " : "") + `🕐 ${timeStr}`;
    if (line) lines.push(line);
  });
  return lines.join("\n");
}

function buildShareStatusHeader(session) {
  if (session.status === "closed") return `🔴 ปิด Court — ต้องชำระเงิน\n━━━━━━━━━━━━━━━\n\n`;
  if (session.registrationClosed) return `🟡 ปิดรับสมาชิกแล้ว\n━━━━━━━━━━━━━━━\n\n`;
  return `🟢 เปิดรับสมาชิก\n━━━━━━━━━━━━━━━\n\n`;
}

// ข้อความรูปแบบเดียวกับปุ่ม Invite — รับ url แยก (ถ้าไม่ส่งมาใช้ joinUrl ของก๊วนนั้น)
export function buildShareText(session, url) {
  const link = url || joinUrl(session.id);
  const courtClosed = session.status === "closed";
  const regClosed = !!session.registrationClosed || courtClosed;
  const dateText = session.date ? formatDate(session.date) : "วันนี้";
  const members = session.members || [];
  const courtInfo = formatCourtsForShare(session.courts);

  let text = buildShareStatusHeader(session);

  if (courtClosed || regClosed) {
    text += `🏸 ตีแบดวันที่ ${dateText}\n`;
  } else {
    text += `🏸 Register ตีแบดวันที่ ${dateText}\n`;
  }
  if (courtInfo) text += `${courtInfo}\n`;

  if (members.length > 0) {
    const memberLabel = regClosed ? "สมาชิก" : "อัปเดตคนลงชื่อแล้ว";
    const memberEmoji = regClosed ? "" : " 🔥";
    text += `${memberLabel} (${members.length} คน)${memberEmoji}\n`;
    members.forEach((m, idx) => {
      text += `${idx + 1}. ${m.name}\n`;
    });
  }

  if (courtClosed) {
    text += `💰 คลิกลิงก์เพื่อชำระเงิน :\n${link}`;
  } else if (regClosed) {
    text += `👀 ดูรายชื่อสมาชิก :\n${link}`;
  } else {
    text += `👇 กดลิงก์ลงชื่อเลย 😎 :\n${link}`;
  }

  return text;
}

// ข้อความ "ปิด Court — รายชื่อค้างชำระ + ยอดเงิน" (คืน null ถ้าทุกคนจ่ายครบ)
// ฟอร์แมตตรงกับ buildDueListText ฝั่งเว็บ (app.js)
export function buildDueListText(session) {
  const members = session.members || [];
  const totals = calcSessionTotals(session);
  const unpaid = [];
  members.forEach((m, idx) => {
    if (!m.isPaid) unpaid.push({ name: m.name, amount: totals.perMember[idx] });
  });
  if (unpaid.length === 0) return null;

  const dateText = session.date ? formatDate(session.date) : "วันนี้";
  const courtInfo = formatCourtsForShare(session.courts);

  let text = `🔴 ปิด Court — ต้องชำระเงิน\n━━━━━━━━━━━━━━━\n\n`;
  text += `🏸 ตีแบดวันที่ ${dateText}\n`;
  if (courtInfo) text += `${courtInfo}\n`;
  text += `\nรายชื่อที่ยังค้างชำระ (${unpaid.length} คน):\n`;
  unpaid.forEach((u, idx) => {
    text += `${idx + 1}. ${u.name} : ${fmt(u.amount)} ฿\n`;
  });
  text += `\n💰 คลิกลิงก์เพื่อชำระเงิน :\n${joinUrl(session.id)}`;
  return text;
}

// ข้อความประกาศ "คอร์ดวันนี้เปิดแล้ว" (ภาษาอังกฤษ ไม่มีลิงก์) — ใช้ตอนสร้างเกมแรกของวัน
export function buildCourtsOpenText() {
  return `🔥 Courts are open 🏸\nToday's session has started!`;
}
