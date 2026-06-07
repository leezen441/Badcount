// ============================================================
// BadCount — Badminton Session Tracker
// ============================================================

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  initializeFirestore, collection, addDoc, doc, getDoc, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, limit, getDocs, serverTimestamp,
  arrayUnion, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------- Init Firebase ----------
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});
const SESSIONS = collection(db, "sessions");

// ============================================================
// 💰 PromptPay Dynamic QR — EMVCo Standard (Thailand)
// ============================================================
// สร้าง payload สำหรับ QR Code ที่ lock ยอดเงิน
// Usage: generatePromptPayPayload("0812345678", { amount: 150, type: "phone" })

function generatePromptPayPayload(promptpayId, opts = {}) {
  const { amount, type = "auto" } = opts;
  if (!promptpayId) return null;

  const cleanId = String(promptpayId).replace(/\D/g, "");
  if (!cleanId) return null;

  // Detect type or use explicit
  let merchantTag, merchantValue;
  const isPhone = type === "phone" || (type === "auto" && cleanId.length === 10);
  const isId    = type === "id"    || (type === "auto" && cleanId.length === 13);

  if (isPhone) {
    merchantTag = "01";
    // Phone: drop leading 0, prefix "0066" (country code 66 + 00 padding)
    const phoneDigits = cleanId.startsWith("0") ? cleanId.substring(1) : cleanId;
    merchantValue = "0066" + phoneDigits;
    if (merchantValue.length !== 13) return null;
  } else if (isId) {
    merchantTag = "02";
    merchantValue = cleanId;
    if (merchantValue.length !== 13) return null;
  } else {
    return null;
  }

  const tlv = (tag, value) => tag + String(value.length).padStart(2, "0") + value;
  const merchantAccount = tlv("00", "A000000677010111") + tlv(merchantTag, merchantValue);

  const parts = [
    tlv("00", "01"),
    tlv("01", amount > 0 ? "12" : "11"),
    tlv("29", merchantAccount),
    tlv("53", "764"),
  ];
  if (amount && amount > 0) parts.push(tlv("54", Number(amount).toFixed(2)));
  parts.push(tlv("58", "TH"));

  const crc16 = (data) => {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  };

  const payloadBeforeCrc = parts.join("") + "6304";
  return payloadBeforeCrc + crc16(payloadBeforeCrc);
}

// Render PromptPay QR into a container (DIV) — returns Promise<dataURL>
// ใช้ davidshimjs/qrcodejs API: new QRCode(element, { text, width, height, correctLevel })
async function renderPromptPayQR(container, promptpayId, amount, type = "auto") {
  const payload = generatePromptPayPayload(promptpayId, { amount, type });
  if (!payload) {
    console.error("[PromptPay] Invalid ID — must be 10-digit phone or 13-digit ID");
    return null;
  }
  if (typeof QRCode === "undefined") {
    throw new Error("qrcode.js not loaded");
  }
  if (!container) {
    throw new Error("container is required");
  }
  // ล้างของเดิม + วาดใหม่
  container.innerHTML = "";
  // eslint-disable-next-line no-new
  new QRCode(container, {
    text: payload,
    width: 256,
    height: 256,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
  // davidshimjs วาด <canvas> + <img> ภายใน container — รอ tick ให้ render เสร็จ (เพิ่มเวลาขึ้นสำหรับ mobile WebViews/LINE)
  await new Promise(r => setTimeout(r, 100));
  const cv = container.querySelector("canvas");
  const img = container.querySelector("img");

  // บนมือถือสมัยใหม่ davidshimjs วาดลง canvas เป็นหลัก ส่วน img อาจไม่มี src
  // → โชว์ canvas + ซ่อน img เพื่อให้ภาพไม่หายไปเป็นจุดขาว
  if (cv) {
    cv.style.display = "block";
    cv.style.margin = "0 auto";
    cv.style.width = "256px";
    cv.style.height = "256px";
  }
  if (img) {
    img.style.display = "none";
  }

  // dataURL — prefer canvas (สด/ตรงเสมอ), fallback img.src
  if (cv) {
    try { return cv.toDataURL("image/png"); } catch (_) {}
  }
  return img && img.src ? img.src : null;
}

// 🔧 Expose to window สำหรับทดสอบใน Console
window.generatePromptPayPayload = generatePromptPayPayload;
window.renderPromptPayQR = renderPromptPayQR;

// ============================================================
// 🧪 Test PromptPay Modal — ทดสอบ generator ก่อนใช้จริง
// ============================================================
function setupTestPromptPayModal() {
  const btnOpen = document.getElementById("btnTestPromptPay");
  const modal = document.getElementById("testPromptPayModal");
  const btnClose = document.getElementById("btnCloseTestModal");
  const btnGen = document.getElementById("btnGenerateTestQR");
  const btnDownload = document.getElementById("btnDownloadTestQR");
  if (!btnOpen || !modal || !btnGen) return;

  btnOpen.addEventListener("click", () => modal.classList.remove("hidden"));
  btnClose?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target.id === "testPromptPayModal") modal.classList.add("hidden");
  });

  btnGen.addEventListener("click", async () => {
    const id = document.getElementById("testPpId").value.trim();
    const type = document.getElementById("testPpType").value;
    const amount = parseFloat(document.getElementById("testPpAmount").value) || 1;

    if (!id) {
      toast("⚠️ กรุณาใส่เบอร์/เลขบัตร PromptPay");
      return;
    }

    const canvas = document.getElementById("testQRCanvas");
    const payloadDisplay = document.getElementById("testPayload");
    const display = document.getElementById("testQRDisplay");

    try {
      const dataUrl = await renderPromptPayQR(canvas, id, amount, type);
      if (!dataUrl) {
        toast("⚠️ สร้าง QR ไม่สำเร็จ — ตรวจสอบ format (เบอร์ 10 หลัก / บัตร 13 หลัก)");
        display.classList.add("hidden");
        return;
      }
      const payload = generatePromptPayPayload(id, { amount, type });
      payloadDisplay.textContent = payload;
      display.classList.remove("hidden");
      toast(`✅ สร้าง QR สำหรับ ${amount} ฿ สำเร็จ — ลองสแกนได้`);
    } catch (err) {
      console.error(err);
      toast("เกิดข้อผิดพลาด: " + err.message);
    }
  });

  btnDownload?.addEventListener("click", () => {
    const container = document.getElementById("testQRCanvas");
    if (!container) return;
    const cv = container.querySelector("canvas");
    const img = container.querySelector("img");
    let dataUrl = null;
    if (cv) { try { dataUrl = cv.toDataURL("image/png"); } catch (_) {} }
    if (!dataUrl && img && img.src) dataUrl = img.src;
    if (!dataUrl) {
      toast("⚠️ ยังไม่มี QR ให้บันทึก");
      return;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `promptpay-test-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast("💾 บันทึก QR แล้ว");
  });
}

// เรียกตอน DOM พร้อม
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupTestPromptPayModal);
} else {
  setupTestPromptPayModal();
}

// ============================================================
// 📁 Receipts Subcollection (sessions/{id}/receipts/{memberId})
// ============================================================
// แยกออกจาก main session document — กันชน 1MB limit
// Auto-delete หลัง 30 วัน ตอนโหลด

const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 วัน

async function saveReceipt(sessionId, memberId, imageDataUrl) {
  if (!sessionId || !memberId || !imageDataUrl) return false;
  try {
    const ref = doc(db, "sessions", sessionId, "receipts", memberId);
    await setDoc(ref, {
      imageBase64: imageDataUrl,
      uploadedAt: Date.now(),
      autoDeleteAt: Date.now() + RECEIPT_TTL_MS
    });
    return true;
  } catch (err) {
    console.error("[Receipt] save failed:", err);
    return false;
  }
}

async function getReceipt(sessionId, memberId) {
  if (!sessionId || !memberId) return null;
  try {
    const ref = doc(db, "sessions", sessionId, "receipts", memberId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    // Auto-delete ถ้าเก่ากว่า 30 วัน
    if (data.autoDeleteAt && data.autoDeleteAt < Date.now()) {
      deleteDoc(ref).catch(() => {});
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[Receipt] read failed:", err);
    return null;
  }
}

async function deleteReceipt(sessionId, memberId) {
  if (!sessionId || !memberId) return;
  try {
    await deleteDoc(doc(db, "sessions", sessionId, "receipts", memberId));
  } catch (err) {
    console.warn("[Receipt] delete failed:", err);
  }
}

// ลบ receipts ทั้งหมดของ session (best-effort) — เรียกก่อนลบ session
async function deleteAllReceiptsForSession(sessionId) {
  if (!sessionId) return;
  try {
    const snap = await getDocs(collection(db, "sessions", sessionId, "receipts"));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
  } catch (err) {
    console.warn("[Receipt] bulk delete failed:", err);
  }
}

// ---------- App State ----------
let currentSessionId = null;
let currentSession = null;
let unsubscribeSession = null;
let unsubscribeList = null;
let debounceTimer = null;

// ---------- Global Defaults (shared in cloud, ex: bankQR) ----------
const GLOBAL_DEFAULTS_DOC = doc(db, "settings", "defaults");
let globalDefaults = {};
let globalDefaultsLoaded = false;
let globalDefaultsPromise = null;

async function loadGlobalDefaults() {
  if (globalDefaultsPromise) return globalDefaultsPromise;
  globalDefaultsPromise = (async () => {
    try {
      const snap = await getDoc(GLOBAL_DEFAULTS_DOC);
      globalDefaults = snap.exists() ? snap.data() : {};
    } catch (err) {
      console.warn("[Defaults] Failed to load:", err);
      globalDefaults = {};
    }
    globalDefaultsLoaded = true;
    return globalDefaults;
  })();
  return globalDefaultsPromise;
}

async function saveGlobalDefaults(patch) {
  // Optimistic local update
  Object.assign(globalDefaults, patch);
  try {
    await setDoc(GLOBAL_DEFAULTS_DOC, patch, { merge: true });
  } catch (err) {
    console.warn("[Defaults] Failed to save:", err);
    toast("บันทึก default ขึ้น cloud ไม่ได้ (ดูใน console)");
  }
}

// Start loading defaults at app boot — non-blocking
loadGlobalDefaults();

// ---------- Admin PromptPay Settings (Dynamic QR) ----------
// เก็บใน settings/defaults (globalDefaults) → แก้ผ่าน UI ได้
// Fields: adminPromptpayId (string), adminPromptpayType ("phone" | "id")

function getAdminPromptPayConfig() {
  const id = (globalDefaults.adminPromptpayId || "").trim();
  const type = globalDefaults.adminPromptpayType === "id" ? "id" : "phone";
  return { id, type };
}

async function setupAdminPromptpaySettings() {
  const idInput = document.getElementById("fldAdminPromptpayId");
  const typeSelect = document.getElementById("fldAdminPromptpayType");
  const btnSave = document.getElementById("btnSaveAdminPromptpay");
  const statusEl = document.getElementById("adminPromptpayStatus");
  if (!idInput || !typeSelect || !btnSave) return;

  // โหลดค่าเดิมจาก cloud
  await loadGlobalDefaults();
  const cfg = getAdminPromptPayConfig();
  if (cfg.id) {
    idInput.value = cfg.id;
    typeSelect.value = cfg.type;
    if (statusEl) statusEl.textContent = "✓ ตั้งค่าแล้ว";
  } else {
    if (statusEl) statusEl.textContent = "ยังไม่ได้ตั้งค่า";
  }

  btnSave.addEventListener("click", async () => {
    const rawId = idInput.value.trim();
    const cleanId = rawId.replace(/\D/g, "");
    const type = typeSelect.value === "id" ? "id" : "phone";

    if (!cleanId) {
      toast("⚠️ กรุณาใส่เบอร์/เลขบัตรพร้อมเพย์");
      return;
    }
    if (type === "phone" && cleanId.length !== 10) {
      toast("⚠️ เบอร์โทรต้อง 10 หลัก");
      return;
    }
    if (type === "id" && cleanId.length !== 13) {
      toast("⚠️ เลขบัตรประชาชนต้อง 13 หลัก");
      return;
    }

    // ทดสอบ generate payload เพื่อ verify
    const payload = generatePromptPayPayload(cleanId, { amount: 1, type });
    if (!payload) {
      toast("⚠️ format ไม่ถูกต้อง");
      return;
    }

    btnSave.disabled = true;
    btnSave.textContent = "กำลังบันทึก...";
    try {
      await saveGlobalDefaults({
        adminPromptpayId: cleanId,
        adminPromptpayType: type
      });
      if (statusEl) statusEl.textContent = "✓ บันทึกแล้ว";
      toast("💾 บันทึก PromptPay สำหรับรับเงินแล้ว");
    } catch (err) {
      console.error(err);
      toast("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "บันทึก";
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupAdminPromptpaySettings);
} else {
  setupAdminPromptpaySettings();
}

// ---------- Authentication ----------
// SHA-256 ของรหัส "XXXX" — ไม่เก็บรหัสตรงๆ ในซอร์ส
const PASSCODE_HASH = "1f82ca11405f1594f1b6fde356b019b74e3bbd210576162f84b46223522daf7d";
const AUTH_KEY = "bcAuthExp";
const AUTH_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน
 
async function hashString(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
 
function isAuthed() {
  const exp = parseInt(localStorage.getItem(AUTH_KEY) || "0", 10);
  return exp > Date.now();
}
 
function setAuthed() {
  localStorage.setItem(AUTH_KEY, String(Date.now() + AUTH_DURATION_MS));
}
 
// ---------- Manager Link Authentication ----------
// รหัสคงที่สำหรับ manager (ผู้ช่วยจัดการกลุ่มรายวัน)
const MANAGER_PASSCODE = "SHH123";
const MANAGER_AUTH_KEY = "bcManagerAuth";

function isManagerAuthed() {
  return localStorage.getItem(MANAGER_AUTH_KEY) === "1";
}

function setManagerAuthed() {
  localStorage.setItem(MANAGER_AUTH_KEY, "1");
}

// ---------- Known Members (จดจำชื่อที่เคยใช้) ----------
const KNOWN_MEMBERS_KEY = "knownMembers";
const KNOWN_MEMBERS_MAX = 30;

function getKnownMembers() {
  try {
    const stored = JSON.parse(localStorage.getItem(KNOWN_MEMBERS_KEY) || "[]");
    return Array.isArray(stored) ? stored.filter(n => typeof n === "string") : [];
  } catch { return []; }
}

function addKnownMember(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  const list = getKnownMembers();
  // ลบของเดิม (case-insensitive) แล้วเอามาไว้ต้น = เรียงตามใช้ล่าสุด
  const filtered = list.filter(n => n.toLowerCase() !== trimmed.toLowerCase());
  filtered.unshift(trimmed);
  if (filtered.length > KNOWN_MEMBERS_MAX) filtered.length = KNOWN_MEMBERS_MAX;
  localStorage.setItem(KNOWN_MEMBERS_KEY, JSON.stringify(filtered));
}

function removeKnownMember(name) {
  const trimmed = (name || "").trim().toLowerCase();
  if (!trimmed) return;
  const filtered = getKnownMembers().filter(n => n.toLowerCase() !== trimmed);
  localStorage.setItem(KNOWN_MEMBERS_KEY, JSON.stringify(filtered));
}

// ---------- Utility ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Dark Mode Init (Forced Dark Mode) ----------
function initTheme() {
  document.documentElement.classList.add('dark');
}
initTheme();

// คืนค่าเป็น array ของเบอร์ลูกแบด (อาจมีซ้ำได้) เพื่อให้ตรวจสอบเบอร์ซ้ำได้
function listShuttleNumbers(str, sessionObj = null) {
  const s = sessionObj || currentSession;
  if (!str || s?.simpleShuttleCount) return [];
  const nums = [];
  const parts = String(str).trim().split(/[\s,\/\\|]+/);
  parts.forEach(p => {
    if (!p) return;
    if (p.includes('-')) {
      const [s, e] = p.split('-');
      const start = parseInt(s, 10);
      const end = parseInt(e, 10);
      if (!isNaN(start) && !isNaN(end) && end >= start && end - start < 50) {
        for (let i = start; i <= end; i++) nums.push(i);
      }
    } else {
      const n = parseInt(p, 10);
      if (!isNaN(n)) nums.push(n);
    }
  });
  return nums;
}

function parseShuttleCount(str, sessionObj = null) {
  if (!str) return 0;
  const s = sessionObj || currentSession;
  if (s?.simpleShuttleCount) {
    const val = parseInt(str, 10);
    return isNaN(val) ? 0 : val;
  }
  let count = 0;
  const parts = String(str).trim().split(/[\s,\/\\|]+/);
  parts.forEach(p => {
    if (!p) return;
    if (p.includes('-')) {
      const [s, e] = p.split('-');
      const start = parseInt(s, 10);
      const end = parseInt(e, 10);
      if (!isNaN(start) && !isNaN(end) && end >= start && end - start < 50) count += (end - start + 1);
      else if (p) count += 1;
    } else if (p) count += 1;
  });
  return count;
}

function toast(msg, ms = 2200) {
  const el = $("toast");
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = "0"; }, ms);
}

// ============================================================
// 🔔 New-Member Notification (Toast + Tab Title Flash + Sound)
// ============================================================
const ORIGINAL_TITLE = document.title;
let pendingNotifCount = 0;
let titleFlashInterval = null;
let mySubmittedJoinIds = new Set();   // กัน notify ตัวเองตอนเพิ่งลงชื่อ

function notifyNewMember(name, options = {}) {
  // 1️⃣ Toast (เสมอ)
  toast(`🎉 ${name} เพิ่งเข้าร่วม!`, 3500);

  // 2️⃣ Tab title flash + count (เฉพาะตอน tab ไม่ active)
  if (document.hidden) {
    pendingNotifCount++;
    flashTabTitle();
  }

  // 3️⃣ Ping sound (ไม่บังคับ เผื่อ browser block)
  playPing();

  // 4️⃣ Native OS notification (เฉพาะ admin/manager — ไม่แสดงในหน้า join)
  if (options.nativeNotify) {
    showBrowserNotification(
      "🏸 BadCount — มีคนเข้าร่วมก๊วน",
      `${name} เพิ่งกดลงชื่อเข้าร่วม`
    );
  }
}

function flashTabTitle() {
  if (titleFlashInterval) clearInterval(titleFlashInterval);
  let toggle = false;
  const showAlert = () => { document.title = `(${pendingNotifCount}) 🎉 มีคนเข้าร่วม!`; };
  const showNormal = () => { document.title = `(${pendingNotifCount}) ${ORIGINAL_TITLE}`; };
  showAlert();
  titleFlashInterval = setInterval(() => {
    if (toggle) showAlert(); else showNormal();
    toggle = !toggle;
  }, 1200);
}

function resetTabTitle() {
  pendingNotifCount = 0;
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
  }
  document.title = ORIGINAL_TITLE;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) resetTabTitle();
});
window.addEventListener("focus", resetTabTitle);

// ---------- Native Browser Notification (Chrome/Safari/Firefox) ----------
// แสดง notification ของ OS — ใช้ได้แม้ tab ไม่ active
// iOS Safari ต้อง install เป็น PWA ก่อนถึงจะใช้ได้

let notificationPermissionRequested = false;

async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (notificationPermissionRequested) return false;

  notificationPermissionRequested = true;
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      toast("🔔 เปิดการแจ้งเตือนแล้ว — จะเตือนเมื่อมีคนเข้าร่วมก๊วน", 3500);
    }
    return result === "granted";
  } catch (e) {
    return false;
  }
}

async function showBrowserNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  
  const options = {
    body,
    tag: "badcount-newmember",
    requireInteraction: false,
    silent: false
  };

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return; // Success via SW
      }
    }
    
    // Fallback to traditional Notification API
    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    setTimeout(() => notif.close(), 6000);
  } catch (e) {
    console.warn("[Notification] failed:", e);
  }
}

function playPing() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);   // A5
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08); // up to E6
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Silent — บาง browser block จนกว่า user จะ interact
  }
}

// Diff helper: ใช้เปรียบเทียบรายชื่อก่อน-หลัง หาคนที่เพิ่งเพิ่ม
function findNewMembers(prev, current, skipIds) {
  if (!Array.isArray(prev) || !Array.isArray(current)) return [];
  return current.filter(cm => {
    if (skipIds && skipIds.has(cm.id)) return false;
    return !prev.some(pm => pm.id === cm.id);
  });
}

// Mark ว่าตัวเองเพิ่งเพิ่มสมาชิกคนนี้ (กัน notify ซ้ำซ้อน)
// auto cleanup 5 วินาทีหลังเพิ่ม
function trackOwnSubmit(memberId) {
  if (!memberId) return;
  mySubmittedJoinIds.add(memberId);
  setTimeout(() => mySubmittedJoinIds.delete(memberId), 5000);
}

function showView(name, opts = {}) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $("view-" + name).classList.add("active");
  window.scrollTo({ top: 0, behavior: "instant" });

  // ซ่อน nav เมื่ออยู่หน้า join, login, manager-login
  // หน้า session แบบ manager-mode: ไม่ซ่อน nav ถ้าเป็น manager ที่ login แล้ว
  const logo = $("logoLink");
  const nav = $("mainNav");
  let shouldLockNav = name === "login" || name === "manager-login";
  if (name === "join") {
    // หน้า join ถ้าเป็น Admin/Manager ไม่ต้องซ่อนเมนูด้านล่าง
    shouldLockNav = !(isAuthed() || isManagerAuthed());
  }
  if (name === "session" && opts.lockNav) {
    if (isManagerAuthed() || isAuthed()) {
      shouldLockNav = false; // Admin/Manager ได้สิทธิ์เห็นเมนู Home/Back
    } else {
      shouldLockNav = true;
    }
  }

  if (shouldLockNav) {
    if (nav) nav.classList.add("hidden");
    if (logo) {
      logo.removeAttribute("href");
      logo.classList.add("pointer-events-none", "cursor-default");
    }
  } else {
    if (nav) nav.classList.remove("hidden");
    if (logo) {
      // ให้กด logo แล้วไปหน้า home หรือ m-home ขึ้นอยู่กับสิทธิ์
      logo.setAttribute("href", isAuthed() ? "#/" : (isManagerAuthed() ? "#/m-home" : "#/"));
      logo.classList.remove("pointer-events-none", "cursor-default");
    }
  }

  // Move install banner to the active view if appropriate
  const banner = $("installBanner");
  if (banner) {
    if (name === "home" || name === "manager-home" || name === "manager-login") {
      $("view-" + name).prepend(banner);
    }
  }
}

// ---------- Router (hash-based for GitHub Pages) ----------
function route() {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\/?/, "").split("/");

  // Clean up previous listeners
  if (unsubscribeSession) { unsubscribeSession(); unsubscribeSession = null; }
  if (joinUnsubscribe) { joinUnsubscribe(); joinUnsubscribe = null; }
  
  // Clean up list listener unless we are going to a list view
  if (parts[0] !== "" && parts[0] !== "m-home" && parts[0] !== "history" && parts[0] !== "personal-stats" && parts[0] !== "admin-summary") {
    if (unsubscribeList) { unsubscribeList(); unsubscribeList = null; }
  }

  const authed = isAuthed();

  // #/m/{id} = Temporary Manager link — ต้องใส่ PIN 4 หลักก่อน (ยกเว้น admin authed)
  // #/session/{id} = admin view — แสดง nav ถ้า authed, ล็อกถ้าไม่ authed
  if ((parts[0] === "session" || parts[0] === "m") && parts[1]) {
    console.log("[Router] Session/Manager route matched:", parts[0], parts[1]);
    currentSessionId = parts[1];
    const isManagerLink = parts[0] === "m";

    // Manager link: ถ้ายังไม่ผ่าน Temp Manager PIN และไม่ใช่ admin/manager → แสดงหน้าใส่ PIN
    if (isManagerLink && !authed && !isManagerAuthed() && !hasValidTempManagerPin(parts[1])) {
      console.log("[Router] Showing Manager PIN view");
      showView("manager-pin");
      return;
    }

    console.log("[Router] Showing Session view");
    showView("session", { lockNav: isManagerLink || !authed });
    subscribeSession(currentSessionId);
    return;
  }

  // หน้า join เปิดได้ทุกคน (ล็อก nav อยู่แล้ว)
  if (parts[0] === "join" && parts[1]) {
    currentSessionId = parts[1];
    showView("join");
    setupJoinView(currentSessionId);
    return;
  }

  // หน้า Manager Home
  if (parts[0] === "m-home") {
    if (!authed && !isManagerAuthed()) {
      showView("login");
      return;
    }
    showView("manager-home");
    renderManagerHome();
    return;
  }

  // หน้าอื่นๆ (home, history, stats, summary) ต้อง login (Admin) ก่อน
  if (!authed) {
    // ถ้าไม่มีสิทธิ์ admin แต่มีสิทธิ์ manager ให้ไปหน้า manager home แทน
    if (isManagerAuthed() && (parts[0] === "" || parts[0] === "history")) {
      location.hash = "#/m-home";
      return;
    }
    // manager สามารถเข้า summary & stats ได้
    if (isManagerAuthed() && (parts[0] === "admin-summary" || parts[0] === "personal-stats")) {
      // allow
    } else {
      showView("login");
      return;
    }
  }

  if (parts[0] === "history") {
    showView("history");
    loadHistory();
  } else if (parts[0] === "personal-stats") {
    showView("personal-stats");
    populatePlayerDatalist();
  } else if (parts[0] === "admin-summary") {
    showView("admin-summary");
    loadAdminSummaryData($("fldAdminSummaryFilter").value);
  } else {
    showView("home");
    loadRecentSessions();
  }
}

// Render Manager Home (Load directly from Firebase)
function renderManagerHome() {
  loadManagerRecentSessions();
}

async function loadManagerRecentSessions() {
  const container = $("managerSessionsList");
  if (!container) return;
  
  if (unsubscribeList) { unsubscribeList(); unsubscribeList = null; }
  
  container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">กำลังโหลด...</p>`;
  try {
    const q = query(SESSIONS, orderBy("createdAt", "desc"), limit(2));
    unsubscribeList = onSnapshot(q, (snap) => {
      renderSessionList(container, snap, false, true); // isManager = true
    }, (err) => {
      console.error(err);
      container.innerHTML = `<p class="text-red-500 text-center py-6 text-sm">โหลดผิดพลาด: ${err.message}</p>`;
    });
  } catch (err) {
    console.error(err);
  }
}

// Manager Logout
$("btnManagerLogout")?.addEventListener("click", () => {
  localStorage.removeItem(MANAGER_AUTH_KEY);
  localStorage.removeItem(AUTH_KEY); // In case they were admin too
  location.hash = "#/";
  route();
});

// Manager / Admin Nav Buttons
$("btnGotoAdminSummary")?.addEventListener("click", () => {
  location.hash = "#/admin-summary";
});
$("btnGotoPersonalStats")?.addEventListener("click", () => {
  location.hash = "#/personal-stats";
});
$("btnGotoPersonalStatsHome")?.addEventListener("click", () => {
  location.hash = "#/personal-stats";
});

// Admin Logout
$("btnAdminLogout")?.addEventListener("click", () => {
  localStorage.removeItem(AUTH_KEY);
  location.hash = "#/";
  route();
});

let appHashHistory = [location.hash || "#/"];
window.addEventListener("hashchange", () => {
  if (appHashHistory[appHashHistory.length - 1] !== location.hash) {
    appHashHistory.push(location.hash || "#/");
  }
  route();
});

// ============================================================
// REALTIME SYNC RESILIENCE
// ============================================================
// แก้ปัญหา onSnapshot ของ Firestore หยุดรับ update เวลาที่:
//   1. มือถือ freeze tab ที่อยู่ background นาน (เพื่อประหยัด battery)
//   2. Network drop ชั่วครู่แล้วกลับมา (เช่น cellular handoff)
//   3. เครื่องเข้า sleep แล้วตื่นมา
// → เมื่อเหตุการณ์เหล่านี้เกิด ระบบจะ force re-subscribe โดยอัตโนมัติ

let lastVisibleAt = Date.now();
const RESYNC_HIDDEN_THRESHOLD_MS = 10 * 1000; // 10 วินาที

function forceResyncFirestore(reason = "") {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\/?/, "").split("/");

  console.log(`[Sync] Force resync${reason ? " — " + reason : ""}`);

  if ((parts[0] === "session" || parts[0] === "m") && parts[1]) {
    if (unsubscribeSession) { unsubscribeSession(); unsubscribeSession = null; }
    subscribeSession(parts[1]);
  } else if (parts[0] === "join" && parts[1]) {
    if (joinUnsubscribe) { joinUnsubscribe(); joinUnsubscribe = null; }
    setupJoinView(parts[1]);
  } else if (parts[0] === "" || parts[0] === undefined || parts[0] === "history") {
    // home / history — re-route จะ refresh list
    route();
  }
}

// เมื่อ tab กลับมา visible หลังจากซ่อนไปนาน → re-subscribe
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const hiddenDuration = Date.now() - lastVisibleAt;
    if (hiddenDuration > RESYNC_HIDDEN_THRESHOLD_MS) {
      forceResyncFirestore(`tab กลับมาหลังหายไป ${Math.round(hiddenDuration / 1000)}s`);
    }
  }
  lastVisibleAt = Date.now();
});

// เมื่อ network กลับมา online → re-subscribe ทันที
window.addEventListener("online", () => {
  forceResyncFirestore("network กลับมา online");
  toast("🌐 เชื่อมต่ออินเทอร์เน็ตได้แล้ว — กำลังโหลดข้อมูลใหม่");
});

// แจ้งเตือนเมื่อ offline
window.addEventListener("offline", () => {
  toast("⚠️ ไม่มีอินเทอร์เน็ต — ข้อมูลอาจไม่อัปเดต", 4000);
});

// ปุ่ม 🔄 manual refresh ในหัวเว็บ — ให้ user กดเองได้เมื่อสงสัยว่าข้อมูล stale
$("btnRefresh")?.addEventListener("click", () => {
  const btn = $("btnRefresh");
  // หมุน icon ระหว่าง refresh
  btn.style.transition = "transform 0.6s";
  btn.style.transform = "rotate(360deg)";
  setTimeout(() => {
    btn.style.transition = "";
    btn.style.transform = "";
  }, 600);

  forceResyncFirestore("manual refresh");
  toast("🔄 โหลดข้อมูลใหม่แล้ว");
});

// ---------- Back Navigation ----------
const navBackBtn = $("navBack");
if (navBackBtn) {
  navBackBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (appHashHistory.length > 1) {
      appHashHistory.pop(); // remove current
      const prev = appHashHistory.pop(); // get previous
      location.hash = prev || "#/";
    } else {
      location.hash = "#/";
    }
  });
}
// ---------- Login submit ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("fldPasscode").value;
  const hashed = await hashString(input);
  if (hashed === PASSCODE_HASH) {
    setAuthed();
    $("fldPasscode").value = "";
    $("loginError").classList.add("hidden");
    // ถ้า hash เป็น "#/" อยู่แล้ว set ซ้ำไม่ trigger hashchange ต้อง re-route เอง
    if (location.hash === "" || location.hash === "#/" || location.hash === "#") {
      route();
    } else {
      location.hash = "#/";
    }
  } else if (input === MANAGER_PASSCODE) {
    setManagerAuthed();
    $("fldPasscode").value = "";
    $("loginError").classList.add("hidden");
    location.hash = "#/m-home";
  } else {
    $("loginError").classList.remove("hidden");
    $("fldPasscode").value = "";
    $("fldPasscode").focus();
  }
});

// ---------- Manager login submit ----------
$("managerLoginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("fldManagerPasscode").value;
  if (input === MANAGER_PASSCODE) {
    setManagerAuthed();
    $("fldManagerPasscode").value = "";
    $("managerLoginError").classList.add("hidden");
    // re-route ไป session ที่ผู้ใช้เปิดอยู่ (currentSessionId ถูก set ไว้แล้วใน router)
    route();
  } else {
    $("managerLoginError").classList.remove("hidden");
    $("fldManagerPasscode").value = "";
    $("fldManagerPasscode").focus();
  }
});

// ============================================================
// HOME VIEW
// ============================================================
async function loadRecentSessions() {
  const container = $("recentSessions");
  if (!container) return;
  
  if (unsubscribeList) { unsubscribeList(); unsubscribeList = null; }

  container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">กำลังโหลด...</p>`;
  try {
    const q = query(SESSIONS, orderBy("createdAt", "desc"), limit(5));
    unsubscribeList = onSnapshot(q, (snap) => {
      renderSessionList(container, snap, true);
    }, (err) => {
      console.error(err);
      container.innerHTML = `<p class="text-red-500 text-center py-6 text-sm">โหลดไม่ได้: ${err.message}<br/><span class="text-xs">ตรวจสอบ Firebase config และ Security Rules</span></p>`;
    });
  } catch (err) {
    console.error(err);
  }
}

// ---------- Session slug (วันที่ DDMMYY เป็น Firestore doc ID) ----------
// แปลง ISO date "2026-05-17" → "170526"
function dateToSlug(dateISO) {
  if (!dateISO) return "";
  const parts = dateISO.split("-"); // YYYY-MM-DD
  if (parts.length !== 3) return "";
  const [yyyy, mm, dd] = parts;
  return `${dd}${mm}${yyyy.slice(2)}`;
}

// หา slug ที่ว่างอยู่ — ถ้าซ้ำให้ลอง -2, -3, ฯลฯ
async function findAvailableSessionSlug(baseSlug) {
  let candidate = baseSlug;
  let n = 1;
  // จำกัด loop ไว้ที่ 50 รอบ (โอกาสเกิดน้อยมาก แต่กันไม่ให้ infinite)
  while (n <= 50) {
    const ref = doc(db, "sessions", candidate);
    const snap = await getDoc(ref);
    if (!snap.exists()) return candidate;
    n++;
    candidate = `${baseSlug}-${n}`;
  }
  // Fallback: ถ้าชนกัน 50 ครั้ง ใส่ timestamp ท้าย (กันชนแน่ๆ)
  return `${baseSlug}-${Date.now()}`;
}

$("btnCreateSession").addEventListener("click", async () => {
  try {
    // Ensure global defaults are loaded before reading (มี QR ที่แชร์กันทั้งระบบ)
    if (!globalDefaultsLoaded) await loadGlobalDefaults();

    // QR: ใช้ของ cloud ก่อน, fallback ไป localStorage ถ้า cloud ไม่มี
    const defaultBankQR = globalDefaults.bankQR || localStorage.getItem("defaultBankQR") || null;
    const defaultLocation = localStorage.getItem("defaultLocation") !== null
                              ? localStorage.getItem("defaultLocation")
                              : "Sunday Hey-Ha / PuunPlus Sport Club";
    const defaultCourtFee = parseFloat(localStorage.getItem("defaultCourtFee")) || 0;
    const defaultCourtFeeType = localStorage.getItem("defaultCourtFeeType") || "perPerson";
    const defaultShuttlePrice = parseFloat(localStorage.getItem("defaultShuttlePrice")) || 0;
    const defaultOtherCost = parseFloat(localStorage.getItem("defaultOtherCost")) || 0;
    const defaultOtherCostType = localStorage.getItem("defaultOtherCostType") || "perPerson";
    
    const newSession = {
      date: todayISO(),
      location: defaultLocation,
      courtFee: defaultCourtFee,
      courtFeeType: defaultCourtFeeType,
      shuttlePrice: defaultShuttlePrice,
      otherCost: defaultOtherCost,
      otherCostType: defaultOtherCostType,
      members: [],
      matches: [],
      courts: [],
      bankQR: defaultBankQR || null,
      status: "open",
      registrationClosed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    // ใช้ DDMMYY เป็น doc ID — ถ้าซ้ำในวันเดียวกัน append -2, -3
    const baseSlug = dateToSlug(newSession.date);
    const slug = await findAvailableSessionSlug(baseSlug);
    await setDoc(doc(db, "sessions", slug), newSession);
    location.hash = `#/session/${slug}`;
  } catch (err) {
    alert("สร้างก๊วนไม่สำเร็จ: " + err.message);
  }
});

// ---------- "ก๊วนอาทิตย์หน้า" — Clone จากก๊วนล่าสุด ----------

// หาวันอาทิตย์ที่ใกล้ถึงที่สุด (ถ้าวันนี้คือวันอาทิตย์ ใช้วันนี้)
function getNextSundayISO() {
  const now = new Date();
  const day = now.getDay(); // 0=อาทิตย์, 1=จันทร์, ..., 6=เสาร์
  const daysUntilSunday = day === 0 ? 0 : (7 - day);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  // ใช้ local date (ไม่ใช่ UTC) เพื่อให้ตรงกับเขตเวลาไทย
  const yyyy = sunday.getFullYear();
  const mm = String(sunday.getMonth() + 1).padStart(2, "0");
  const dd = String(sunday.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

$("btnCreateRecurring").addEventListener("click", async () => {
  const btn = $("btnCreateRecurring");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span>⏳</span> <span>กำลังสร้าง...</span>`;

  try {
    // ดึงก๊วนล่าสุด 1 อัน
    const q = query(SESSIONS, orderBy("createdAt", "desc"), limit(1));
    const snap = await getDocs(q);

    if (snap.empty) {
      toast("ยังไม่มีก๊วนเก่าให้ copy — กด + Open Court สร้างก๊วนแรกได้เลย", 3500);
      return;
    }

    const last = snap.docs[0].data();
    const nextSunday = getNextSundayISO();

    // Copy ทุกอย่างยกเว้น members, matches, status, isPaid
    // - regenerate court IDs เพื่อความสะอาด
    const newSession = {
      date: nextSunday,
      location: last.location || "",
      courtFee: last.courtFee || 0,
      courtFeeType: last.courtFeeType || "perPerson",
      shuttlePrice: last.shuttlePrice || 0,
      otherCost: last.otherCost || 0,
      otherCostType: last.otherCostType || "perPerson",
      courts: (last.courts || []).map(c => ({
        id: uid(),
        number: c.number || "",
        startTime: c.startTime || "",
        endTime: c.endTime || ""
      })),
      bankQR: last.bankQR || null,
      members: [],   // ❌ ไม่ copy
      matches: [],   // ❌ ไม่ copy
      status: "open",
      registrationClosed: false,   // เริ่มต้นด้วย เปิดรับสมาชิก
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // ใช้ DDMMYY เป็น doc ID — ถ้าซ้ำในวันเดียวกัน append -2, -3
    const baseSlug = dateToSlug(newSession.date);
    const slug = await findAvailableSessionSlug(baseSlug);
    await setDoc(doc(db, "sessions", slug), newSession);
    toast(`สร้างก๊วน ${formatDate(nextSunday)} แล้ว 🎉`, 3000);
    location.hash = `#/session/${slug}`;
  } catch (err) {
    alert("สร้างก๊วนไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

// ============================================================
// SESSION VIEW
// ============================================================
// Track sessions ที่ user เพิ่งกดลบเอง — จะได้ไม่โชว์ toast ซ้ำ
let recentlyDeletedSessionId = null;

// Track รายชื่อสมาชิกก่อนหน้า เพื่อตรวจจับ "คนเข้าร่วมใหม่"
let previousSessionMembers = null;

function subscribeSession(id) {
  // Reset เมื่อสลับ session
  previousSessionMembers = null;

  // ขอ permission แจ้งเตือน (admin/manager เท่านั้น) — ถามครั้งเดียวต่อ page load
  ensureNotificationPermission();

  const ref = doc(db, "sessions", id);
  unsubscribeSession = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      // ❌ ห้าม replace innerHTML ของ view-session (จะทำให้ DOM elements หายและพังเวลาเข้าก๊วนอื่น)
      // ✅ Redirect กลับหน้า Home แทน — DOM ของ view-session ยังอยู่พร้อมใช้
      if (recentlyDeletedSessionId !== id) {
        toast("ไม่พบก๊วนนี้ อาจถูกลบไปแล้ว");
      }
      // Cleanup listener ก่อน redirect
      if (unsubscribeSession) { unsubscribeSession(); unsubscribeSession = null; }
      if (location.hash !== "#/") location.hash = "#/";
      return;
    }
    const newSession = { id: snap.id, ...snap.data() };

    // 🔔 ตรวจคนที่เพิ่งเข้าร่วม (เปรียบเทียบกับ snapshot ก่อนหน้า)
    // admin/manager → ใช้ native OS notification ด้วย (option { nativeNotify: true })
    const currentMembers = newSession.members || [];
    if (previousSessionMembers !== null) {
      const newcomers = findNewMembers(previousSessionMembers, currentMembers, mySubmittedJoinIds);
      newcomers.forEach(m => notifyNewMember(m.name || "ใครบางคน", { nativeNotify: true }));
    }
    previousSessionMembers = currentMembers.map(m => ({ id: m.id }));

    currentSession = newSession;
    renderSession();
  }, (err) => {
    console.error(err);
    toast("โหลดข้อมูลก๊วนไม่ได้: " + err.message);
  });
}

function renderSession() {
  if (!currentSession) return;
  const s = currentSession;

  // Update fields only if not currently focused (avoid stomping user input)
  const setIfNotFocused = (el, val) => {
    if (el && document.activeElement !== el) el.value = val ?? "";
  };
  setIfNotFocused($("fldLocation"), s.location);
  setIfNotFocused($("fldDate"), s.date);
  setIfNotFocused($("fldCourtFee"), s.courtFee || "");
  setIfNotFocused($("fldCourtFeeType"), s.courtFeeType || "perPerson");
  setIfNotFocused($("fldShuttlePrice"), s.shuttlePrice || "");
  setIfNotFocused($("fldOtherCostType"), s.otherCostType || "perPerson");
  setIfNotFocused($("fldOtherCost"), s.otherCost || "");
  
  const chkSimpleShuttleCount = $("fldSimpleShuttleCount");
  if (chkSimpleShuttleCount) {
    chkSimpleShuttleCount.checked = !!s.simpleShuttleCount;
  }

  // Status badge
  const badge = $("sessionStatusBadge");
  const btnClose = $("btnCloseSession");

  if (s.status === "closed") {
    badge.textContent = "ปิดแล้ว";
    badge.className = "text-xs font-semibold px-2 py-1 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 whitespace-nowrap";
    btnClose.innerHTML = "🔓 เปิด Court อีกครั้ง";
    // เปลี่ยนเป็นปุ่มสีเขียวอ่อนเมื่อก๊วนปิดแล้ว
    btnClose.className = "flex-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/50 dark:text-emerald-300 py-3 rounded-lg font-medium transition-colors border border-emerald-200 dark:border-emerald-800/50";
  } else {
    badge.textContent = "เปิดอยู่";
    badge.className = "text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 whitespace-nowrap";
    btnClose.innerHTML = "✅ ปิด Court";
    // กลับเป็นปุ่มสีเทาปกติเมื่อก๊วนยังเปิดอยู่
    btnClose.className = "flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 py-3 rounded-lg font-medium transition-colors border border-slate-200 dark:border-slate-700";
  }

  // ✨ NEW: Update Invite button + Toggle Registration button based on state
  updateInviteButtonState();

  // 🛡️ Update Temp Manager PIN display
  updateTempPinDisplay();

  renderMembers();
  renderMemberSuggestions();
  renderMatches();
  renderSummary();
  renderCourts();
  updatePaymentReminder();
  updateCleanupButton();
  
  // Hide or show the delete session button based on whether we are in manager mode
  const btnDelete = $("btnDeleteSession");
  if (btnDelete) {
    if (isInManagerLinkView() || isManagerAuthed()) {
      btnDelete.classList.add("hidden");
    } else {
      btnDelete.classList.remove("hidden");
    }
  }
  
  // If matchmaking modal is open, re-render it in real-time to reflect any updates
  if ($("matchModal") && !$("matchModal").classList.contains("hidden")) {
    renderMatchDraft();
  }
}

// 🎨 Update สีปุ่ม Invite + Label ปุ่ม ปิดรับ/เปิดรับ ตามสถานะ
function updateInviteButtonState() {
  const s = currentSession;
  if (!s) return;
  const inviteBtn = $("btnShareJoin");
  const toggleBtn = $("btnToggleRegistration");
  const toggleIcon = $("btnToggleRegistrationIcon");
  const toggleLabel = $("btnToggleRegistrationLabel");
  if (!inviteBtn || !toggleBtn) return;

  const courtClosed = s.status === "closed";
  const regClosed = !!s.registrationClosed || courtClosed;  // court closed = reg auto closed

  // ===== Invite Button Color =====
  if (courtClosed) {
    // 🔴 แดง
    inviteBtn.className = "bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-700 dark:text-rose-400 py-2.5 rounded-lg font-medium border border-rose-300 dark:border-rose-700 flex flex-col items-center justify-center gap-1 transition-colors";
  } else if (regClosed) {
    // 🟡 เหลือง
    inviteBtn.className = "bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-800 dark:text-amber-400 py-2.5 rounded-lg font-medium border border-amber-300 dark:border-amber-700 flex flex-col items-center justify-center gap-1 transition-colors";
  } else {
    // 🟢 เขียว (default)
    inviteBtn.className = "bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 py-2.5 rounded-lg font-medium border border-emerald-200 dark:border-emerald-800/50 flex flex-col items-center justify-center gap-1 transition-colors";
  }

  // ===== Toggle Registration Button =====
  if (courtClosed) {
    // Disabled (court closed → can't toggle)
    toggleBtn.disabled = true;
    toggleIcon.textContent = "🔒";
    toggleLabel.textContent = "ปิดรับ";
    toggleBtn.className = "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 py-1.5 px-2 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1 cursor-not-allowed opacity-60";
  } else if (regClosed) {
    // Registration closed (active state — yellow)
    toggleBtn.disabled = false;
    toggleIcon.textContent = "🔒";
    toggleLabel.textContent = "ปิดรับ";
    toggleBtn.className = "bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 text-amber-800 dark:text-amber-300 py-1.5 px-2 rounded-md text-[11px] font-semibold border border-amber-300 dark:border-amber-700 flex items-center justify-center gap-1 transition-colors";
  } else {
    // Open (default — show "เปิดรับ")
    toggleBtn.disabled = false;
    toggleIcon.textContent = "✅";
    toggleLabel.textContent = "เปิดรับ";
    toggleBtn.className = "bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-600 dark:text-slate-400 py-1.5 px-2 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1 transition-colors";
  }
}

// Toggle Registration handler
$("btnToggleRegistration")?.addEventListener("click", () => {
  if (!currentSession || currentSession.status === "closed") return;
  const newValue = !currentSession.registrationClosed;
  saveSession({ registrationClosed: newValue });
  toast(newValue ? "🔒 ปิดรับสมาชิกแล้ว" : "✅ เปิดรับสมาชิกอีกครั้ง");
});

// ---------- Courts ----------
function renderCourts() {
  const list = $("courtsList");
  const suggestions = $("courtSuggestions");
  if (!list) return;

  if (list.contains(document.activeElement)) return;

  const courts = currentSession.courts || [];
  $("courtCount").textContent = courts.length;

  // --- 2. แก้ไขตรงนี้: ดึงข้อมูลจาก Cloud (globalDefaults) ---
  if (suggestions) {
    if (courts.length === 0) {
      // ดึงจากตัวแปร globalDefaults ที่โหลดมาจาก Firebase ตอนเปิดแอป
      const lastCourts = globalDefaults.lastUsedCourts || []; 
      const validCourts = lastCourts.filter(c => c.number || c.startTime || c.endTime);
      
      if (validCourts.length > 0) {
        const courtDesc = validCourts.map(c => c.number ? `สนาม ${c.number}` : "เวลา " + (c.startTime || '')).join(", ");
        suggestions.innerHTML = `
          <button id="btnSuggestCourts" class="px-3 py-1.5 text-xs bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 text-emerald-700 border border-emerald-200 dark:border-emerald-800/50 rounded-full font-medium transition-transform active:scale-95 shadow-sm">
            + ดึงสนามล่าสุด (${escapeHtml(courtDesc)})
          </button>
        `;
        
        $("btnSuggestCourts").addEventListener("click", () => {
          const newCourts = validCourts.map(c => ({ ...c, id: uid() }));
          saveSession({ courts: newCourts });
        });
      } else {
        suggestions.innerHTML = "";
      }
    } else {
      suggestions.innerHTML = "";
    }
  }
  // -------------------------------------------------------

  if (courts.length === 0) {
    list.innerHTML = `<p class="text-slate-400 text-center py-3 text-xs">ยังไม่ได้ระบุสนาม กดเพิ่มได้</p>`;
    return;
  }

  list.innerHTML = courts.map(c => `
    <div class="flex items-center gap-1.5 sm:gap-2 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
      <span class="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">สนาม</span>
      <input type="text" data-court-id="${c.id}" data-field="number" placeholder="?" maxlength="6"
        value="${escapeHtml(c.number || '')}"
        class="w-14 text-center px-1 py-1 border border-slate-200 dark:border-slate-700 rounded font-bold text-sm focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-900" />
      <span class="text-slate-400 text-sm shrink-0">🕐</span>
      <input type="time" data-court-id="${c.id}" data-field="startTime"
        value="${c.startTime || ''}"
        style="color-scheme: light;"
        class="text-xs px-1 py-1 border border-slate-200 dark:border-slate-700 rounded min-w-0 flex-1 focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-900" />
      <span class="text-slate-400 shrink-0 text-xs">–</span>
      <input type="time" data-court-id="${c.id}" data-field="endTime"
        value="${c.endTime || ''}"
        style="color-scheme: light;"
        class="text-xs px-1 py-1 border border-slate-200 dark:border-slate-700 rounded min-w-0 flex-1 focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-900" />
      <button data-del-court="${c.id}" class="text-slate-300 hover:text-red-500 px-1 shrink-0 text-lg leading-none">×</button>
    </div>
  `).join("");
}

// Add court
$("btnAddCourt").addEventListener("click", () => {
  if (!currentSession) return;
  const newId = uid();
  const newCourts = [...(currentSession.courts || []), { id: newId, number: "", startTime: "", endTime: "" }];
  saveSession({ courts: newCourts });
  // Focus หลัง render เพื่อพิมพ์ต่อได้เลย
  setTimeout(() => {
    const input = document.querySelector(`input[data-court-id="${newId}"][data-field="number"]`);
    if (input) input.focus();
  }, 80);
});

// Event delegation: input changes
$("courtsList").addEventListener("input", (e) => {
  const input = e.target;
  if (!input.matches("input[data-court-id]")) return;
  const id = input.dataset.courtId;
  const field = input.dataset.field;
  const val = input.value;
  const newCourts = (currentSession.courts || []).map(c => c.id === id ? { ...c, [field]: val } : c);
  saveSession({ courts: newCourts });
});

// Event delegation: delete button
$("courtsList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-del-court]");
  if (!btn) return;
  const id = btn.dataset.delCourt;
  const newCourts = (currentSession.courts || []).filter(c => c.id !== id);
  // --- เพิ่มบรรทัดนี้: เตะโฟกัสออกจากปุ่มลบ เพื่อให้ UI ยอมวาดหน้าจอใหม่ ---
  if (document.activeElement) document.activeElement.blur();
  // -----------------------------------------------------------
  saveSession({ courts: newCourts });
});

function renderMemberSuggestions() {
  const container = $("memberSuggestions");
  if (!container || !currentSession) return;

  const known = getKnownMembers();
  const currentNames = new Set((currentSession.members || []).map(m => (m.name || "").toLowerCase()));
  const suggestions = known.filter(n => !currentNames.has(n.toLowerCase())).slice(0, 12);

  if (suggestions.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="text-[11px] text-slate-400 mb-1.5">เพิ่มเร็ว (จากที่เคยใช้) — แตะค้างเพื่อลบจากประวัติ</div>
    <div class="flex flex-wrap gap-1.5">
      ${suggestions.map(name => `
        <button data-quick-add="${escapeHtml(name)}" class="px-2.5 py-1 text-xs bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 text-emerald-700 border border-emerald-200 dark:border-emerald-800/50 rounded-full transition-transform active:scale-95 font-medium">
          + ${escapeHtml(name)}
        </button>
      `).join("")}
    </div>
  `;

  container.querySelectorAll("button[data-quick-add]").forEach(btn => {
    const name = btn.dataset.quickAdd;

    // คลิก = เพิ่มลงก๊วน
    btn.addEventListener("click", () => {
      const members = [...(currentSession.members || [])];
      if (members.some(m => (m.name || "").toLowerCase() === name.toLowerCase())) {
        toast(`มีชื่อ "${name}" ในก๊วนแล้ว`);
        return;
      }
      const newId = uid();
      trackOwnSubmit(newId);
      members.push({ id: newId, name, shuttlesUsed: 0 });
      addKnownMember(name); // bump ขึ้นต้นใหม่
      saveSession({ members });
    });

    // แตะค้าง / คลิกขวา = ลบจากประวัติ
    let holdTimer = null;
    const startHold = () => {
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (confirm(`ลบ "${name}" ออกจากรายการที่เคยใช้?`)) {
          removeKnownMember(name);
          renderMemberSuggestions();
        }
      }, 600);
    };
    const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    btn.addEventListener("touchstart", startHold, { passive: true });
    btn.addEventListener("touchend", cancelHold);
    btn.addEventListener("touchmove", cancelHold);
    btn.addEventListener("mousedown", startHold);
    btn.addEventListener("mouseup", cancelHold);
    btn.addEventListener("mouseleave", cancelHold);
    btn.addEventListener("contextmenu", e => {
      e.preventDefault();
      cancelHold();
      if (confirm(`ลบ "${name}" ออกจากรายการที่เคยใช้?`)) {
        removeKnownMember(name);
        renderMemberSuggestions();
      }
    });
  });
}

// ---------- Payment Reminder ----------
function updatePaymentReminder() {
  const card = $("paymentReminderCard");
  if (!card || !currentSession) return;

  const s = currentSession;
  const isClosed = s.status === "closed";
  const members = s.members || [];
  if (members.length === 0) {
    card.classList.add("hidden");
    updateSubRowPaymentButtons(0);
    return;
  }

  const totals = calcTotals();
  let unpaidCount = 0;
  let unpaidTotal = 0;
  members.forEach((m, idx) => {
    if (!m.isPaid) {
      unpaidCount++;
      unpaidTotal += totals.perMember[idx];
    }
  });

  // จุดที่สอง: ส่วนนี้จะแสดงก็ต่อเมื่อกดปิด court แล้วเท่านั้น และยังมีคนค้างชำระ
  if (isClosed && unpaidCount > 0) {
    card.classList.remove("hidden");
    $("unpaidCount").textContent = unpaidCount;
    $("unpaidTotal").textContent = fmt(unpaidTotal);
  } else {
    card.classList.add("hidden");
  }

  updateSubRowPaymentButtons(unpaidCount);
}

// ปรับสถานะปุ่ม "ทวง" + "Mark all" ใน sub-row ตามจำนวนคนค้างจ่าย
function updateSubRowPaymentButtons(unpaidCount) {
  const btnRemind = $("btnRemindUnpaid");
  const btnMarkAll = $("btnMarkAllPaid");
  const remindLabel = $("btnRemindUnpaidLabel");
  if (!btnRemind || !btnMarkAll) return;

  const s = currentSession;
  const isClosed = s && s.status === "closed";
  const hasUnpaid = unpaidCount > 0;

  // ----- ปุ่ม "ทวง" -----
  const remindBase = "col-start-3 py-1.5 px-2 rounded-md text-[11px] font-semibold border flex items-center justify-center gap-1 transition-all";
  if (hasUnpaid) {
    if (isClosed) {
      // สีแดงเมื่อปิดคอร์ดแล้วยังมีคนค้างชำระ
      btnRemind.className = `${remindBase} bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white border-rose-600 cursor-pointer shadow-sm`;
    } else {
      // สีเหลืองเวลาปกติ
      btnRemind.className = `${remindBase} bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-800/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50 cursor-pointer`;
    }
    btnRemind.disabled = false;
    if (remindLabel) remindLabel.textContent = `ทวง (${unpaidCount})`;
  } else {
    btnRemind.className = `${remindBase} bg-slate-50 dark:bg-slate-900/30 text-slate-300 dark:text-slate-600 border-slate-100 dark:border-slate-800 opacity-60 cursor-not-allowed`;
    btnRemind.disabled = true;
    if (remindLabel) remindLabel.textContent = "ทวง";
  }

  // ----- ปุ่ม "Mark all" -----
  const markBase = "col-start-4 py-1.5 px-2 rounded-md text-[11px] font-semibold border flex items-center justify-center gap-1 transition-all";
  if (hasUnpaid) {
    btnMarkAll.className = `${markBase} bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50 cursor-pointer`;
    btnMarkAll.disabled = false;
  } else {
    btnMarkAll.className = `${markBase} bg-slate-50 dark:bg-slate-900/30 text-slate-300 dark:text-slate-600 border-slate-100 dark:border-slate-800 opacity-60 cursor-not-allowed`;
    btnMarkAll.disabled = true;
  }
}

// ---------- "ทวง" sub-row button — ใช้ logic เดียวกับ btnCopyDueList ----------
$("btnRemindUnpaid").addEventListener("click", () => {
  if ($("btnRemindUnpaid").disabled) return;
  $("btnCopyDueList").click();
});

// ---------- "Mark all paid" sub-row button — confirm แล้วเซ็ตทุกคน isPaid: true ----------
$("btnMarkAllPaid").addEventListener("click", () => {
  if ($("btnMarkAllPaid").disabled) return;
  if (!currentSession) return;
  const members = currentSession.members || [];
  const unpaidNames = members.filter(m => !m.isPaid).map(m => m.name);
  if (unpaidNames.length === 0) return;

  const msg = `ยืนยันว่าทุกคนจ่ายเงินครบแล้ว?\n\nจะทำเครื่องหมาย ${unpaidNames.length} คนเป็น "จ่ายแล้ว":\n${unpaidNames.map(n => `• ${n}`).join("\n")}`;
  if (!confirm(msg)) return;

  const newMembers = members.map(m => ({ ...m, isPaid: true }));
  saveSession({ members: newMembers });
  toast(`✓ ทำเครื่องหมายจ่ายแล้ว ${unpaidNames.length} คน`);
});

$("btnCopyDueList").addEventListener("click", async () => {
  if (!currentSession || !currentSessionId) return;
  const s = currentSession;
  const members = s.members || [];
  const totals = calcTotals();

  const unpaid = [];
  members.forEach((m, idx) => {
    if (!m.isPaid) unpaid.push({ name: m.name, amount: totals.perMember[idx] });
  });

  if (unpaid.length === 0) {
    toast("ทุกคนจ่ายครบแล้ว 🎉");
    return;
  }

  const joinUrl = location.origin + location.pathname + `?openExternalBrowser=1#/join/${currentSessionId}`;
  const dateText = s.date ? formatDate(s.date) : "วันนี้";
  const courtInfo = formatCourtsForShare(s.courts);

  let text = `🔴 ปิด Court — ต้องชำระเงิน\n━━━━━━━━━━━━━━━\n\n`;
  text += `🏸 ตีแบดวันที่ ${dateText}\n`;
  if (courtInfo) text += `${courtInfo}\n`;

  text += `\nรายชื่อที่ยังค้างชำระ (${unpaid.length} คน):\n`;
  unpaid.forEach((u, idx) => {
    text += `${idx + 1}. ${u.name} : ${fmt(u.amount)} ฿\n`;
  });
  text += `\n`;
  text += `💰 คลิกลิงก์เพื่อชำระเงิน :\n${joinUrl}`;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile && navigator.share) {
    try {
      await navigator.share({ text });
      toast("แชร์ข้อความทวงเงินสำเร็จ ✓");
    } catch (err) {
      if (err.name !== "AbortError") toast("แชร์ไม่สำเร็จ");
    }
  } else {
    navigator.clipboard.writeText(text).then(() => {
      toast("📋 คัดลอกข้อความทวงเงินแล้ว (สามารถนำไปวางในไลน์ได้เลย)");
    }).catch(() => {
      toast("ไม่สามารถคัดลอกได้");
    });
  }
});

function renderMembers() {
  const list = $("membersList");
  const members = currentSession.members || [];
  // แสดงเป็น "ยังไม่จ่าย/ทั้งหมด" — เช่น 8/11
  // - ยังไม่มีสมาชิก หรือยังไม่มีใครจ่าย → ตัวเลขเดียว
  // - มีคนจ่ายบางส่วน → "unpaid/total"
  // - ทุกคนจ่ายครบ → แสดงตัวเลขเต็ม + " All Paid" ข้าง parens
  const unpaidCount = members.filter(m => !m.isPaid).length;
  const anyPaid = members.some(m => m.isPaid);
  let memberCountText;
  let statusText = "";
  if (members.length === 0) {
    memberCountText = "0";
  } else if (unpaidCount === 0) {
    memberCountText = String(members.length);
    statusText = "All Paid ✓";
  } else if (anyPaid) {
    memberCountText = `${unpaidCount}/${members.length}`;
  } else {
    memberCountText = String(members.length);
  }
  $("memberCount").textContent = memberCountText;
  const memberStatusEl = $("memberStatus");
  if (memberStatusEl) memberStatusEl.textContent = statusText;

  if (members.length === 0) {
    list.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">ยังไม่มีสมาชิก เพิ่มคนแรกได้เลย</p>`;
    return;
  }

  const totals = calcTotals();
  const matches = currentSession.matches || [];
  
  // Pre-calculate stats
  const pStats = {};
  members.forEach(m => { pStats[m.id] = { games: 0, lastPartners: null }; });
  
  matches.forEach(match => {
    const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
    pIds.forEach(id => {
      if (pStats[id]) {
        pStats[id].games++;
        pStats[id].lastPartners = pIds.filter(pid => pid !== id);
      }
    });
  });

  list.innerHTML = members.map((m, idx) => {
    const matchShuttles = totals.matchShuttlesMap ? totals.matchShuttlesMap[m.id] || 0 : 0;
    const displayShuttles = (m.shuttlesUsed || 0) + matchShuttles;
    const isPaid = !!m.isPaid;
    const isPaused = !!m.isPaused;
    const priceColor = isPaid ? "text-emerald-500" : "text-rose-500";
    
    const leadingButton = isPaused ? `
      <button data-act="toggle-pause-row" data-idx="${idx}" class="w-6 h-6 shrink-0 flex items-center justify-center text-base hover:scale-110 active:scale-95 transition-transform" title="ยกเลิกการพักคิว (กลับเข้าคิวจัดเกม)">
        ⏸️
      </button>
    ` : `
      <button data-act="toggle-paid" data-idx="${idx}" class="w-6 h-6 shrink-0 rounded-md border flex items-center justify-center transition-colors ${isPaid ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-300 dark:border-slate-600 text-transparent hover:border-emerald-400'}" title="ทำเครื่องหมายว่าจ่ายแล้ว">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
      </button>
    `;

    return `
    <div class="py-2.5 sm:py-3 flex items-center gap-1 sm:gap-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      ${leadingButton}
      
      <div class="flex-1 min-w-0 flex items-center justify-between gap-2 sm:gap-3 rounded-xl transition-all ${isPaused ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40 px-2 py-1.5' : ''}">
        <div class="flex-1 min-w-0 flex items-center justify-between gap-1 sm:gap-2">
          <div class="min-w-0 flex-1 flex flex-col gap-0.5 sm:gap-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <button data-act="edit-player" data-idx="${idx}" class="font-bold truncate text-left hover:text-emerald-600 transition-colors ${isPaid ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-800 dark:text-slate-100'}" title="${pStats[m.id].games > 0 ? `ตี ${pStats[m.id].games} เกม • ล่าสุด: ${pStats[m.id].lastPartners.map(pid => members.find(x => x.id === pid)?.name || '?').join(', ')}` : 'ยังไม่ได้ลงสนาม'} - คลิกเพื่อตั้งค่าระดับมือ/Buddy">
                ${escapeHtml(m.name)}
              </button>
              ${pStats[m.id].games > 0
                ? `<span class="hidden sm:inline text-[11px] text-slate-400 font-normal">(ตี ${pStats[m.id].games} เกม)</span>`
                : `<span class="hidden sm:inline text-[11px] text-slate-300 font-normal">(ยังไม่ได้ลงสนาม)</span>`
              }
            </div>
            
            <div class="flex flex-wrap items-center gap-1">
              ${m.skill ? `<span class="text-[9px] px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-extrabold rounded shrink-0">${m.skill}</span>` : ''}
              ${(() => {
                const buddy = m.buddyId 
                  ? members.find(x => x.id === m.buddyId) 
                  : members.find(x => x.buddyId === m.id);
                if (buddy) {
                  return `<span class="text-[9px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-extrabold rounded shrink-0">🤝 ${escapeHtml(buddy.name)}</span>`;
                }
                return "";
              })()}
              ${m.excludeAllShuttles ? `<span class="text-[9px] px-1.5 py-0.5 bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 font-extrabold rounded shrink-0">ฟรีค่าลูก</span>` : ''}
              ${(!m.excludeAllShuttles && m.shuttlesExcluded > 0) ? `<span class="text-[9px] px-1.5 py-0.5 bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 font-extrabold rounded shrink-0">เว้น ${m.shuttlesExcluded} ลูก</span>` : ''}
              ${(m.manualFee !== undefined && m.manualFee !== null && m.manualFee !== "" && !isNaN(m.manualFee)) ? `<span class="text-[9px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-extrabold rounded shrink-0" title="กำหนดราคาคงที่เองโดยผู้ดูแล: ${m.manualFee} ฿">✍️ ${m.manualFee} ฿</span>` : ''}
              ${pStats[m.id].games > 0
                ? `<span class="inline sm:hidden text-[9px] text-slate-400 font-semibold">${pStats[m.id].games} เกม</span>`
                : `<span class="inline sm:hidden text-[9px] text-slate-300 font-semibold">ยังไม่เล่น</span>`
              }
            </div>
          </div>
          
          <div class="flex flex-col items-end justify-center shrink-0 min-w-[60px] sm:min-w-[85px]">
            <div class="font-extrabold text-xs sm:text-base ${priceColor} whitespace-nowrap">${fmt(totals.perMember[idx])} ฿</div>
            <div class="flex gap-1 mt-0.5">
              ${(m.slipImage || m.slipQR || m.hasReceipt) ? `
                <button data-act="view-slip" data-idx="${idx}" class="text-[9px] px-1 py-0.25 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-extrabold rounded flex items-center gap-0.5 hover:scale-105 transition-transform" title="ดูสลิป">
                  <span>🖼️</span>
                </button>
              ` : ''}
              ${!isPaid ? `
                <button data-act="show-dyn-qr" data-idx="${idx}" class="text-[9px] px-1 py-0.25 bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-extrabold rounded flex items-center gap-0.5 hover:scale-105 transition-transform" title="สแกน QR">
                  <span>💸</span>
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-0.5 sm:gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 sm:p-1 shrink-0 ${isPaused ? 'opacity-90' : ''}">
          <button data-act="dec" data-idx="${idx}" class="w-6 h-6 sm:w-8 sm:h-8 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600 dark:text-slate-400 text-xs sm:text-base">−</button>
          <div class="w-6 sm:w-10 text-center font-semibold text-xs sm:text-sm" title="ลูกในเกม: ${matchShuttles}, ลูกเบิกเอง: ${m.shuttlesUsed || 0}">${displayShuttles}</div>
          <button data-act="inc" data-idx="${idx}" class="w-6 h-6 sm:w-8 sm:h-8 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600 dark:text-slate-400 text-xs sm:text-base">+</button>
        </div>
      </div>
      
      <button data-act="del" data-idx="${idx}" class="text-slate-300 hover:text-red-500 pl-1 pr-2 text-xl shrink-0 leading-none">×</button>
    </div>
    `
  }).join("");

  // Wire up +/- and delete
  list.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      const idx = parseInt(btn.dataset.idx, 10);

      // view-slip = action ที่ไม่ได้ modify data → เปิด modal แล้ว return
      if (act === "view-slip") {
        const m = (currentSession.members || [])[idx];
        if (m && (m.slipImage || m.slipQR || m.hasReceipt)) {
          openSlipViewer(m.id, m.name, m.slipImage, m.slipQR, m.slipQRAmount);
        }
        return;
      }

      // show-dyn-qr = แสดง Dynamic QR (PromptPay ล็อกยอด) สำหรับสมาชิกคนนั้น
      if (act === "show-dyn-qr") {
        openPaymentModal(idx);
        return;
      }

      // edit-player = แสดงตั้งค่าผู้เล่น
      if (act === "edit-player") {
        openPlayerSettingsModal(idx, true);
        return;
      }

      // toggle-pause-row = ยกเลิกสถานะ pause
      if (act === "toggle-pause-row") {
        const members = [...(currentSession.members || [])];
        if (members[idx]) {
          members[idx].isPaused = false;
        }
        saveSession({ members });
        toast(`พาคุณ ${members[idx].name} กลับเข้าคิวเรียบร้อย 🏸`);
        return;
      }

      const members = [...(currentSession.members || [])];

      if (act === "inc") members[idx].shuttlesUsed = (members[idx].shuttlesUsed || 0) + 1;
      else if (act === "dec") members[idx].shuttlesUsed = Math.max(0, (members[idx].shuttlesUsed || 0) - 1);
      else if (act === "toggle-paid") members[idx].isPaid = !members[idx].isPaid;
      else if (act === "del") {
        if (!confirm(`ลบ "${members[idx].name}" ออกจากก๊วน?`)) return;
        const removed = members[idx];
        members.splice(idx, 1);
        // ลบ receipt subcollection doc (best-effort)
        if (removed?.id && currentSessionId) deleteReceipt(currentSessionId, removed.id);
      }

      saveSession({ members });
    });
  });
}

// 🚀 Memoize cache — เก็บผล calcTotals ถ้าข้อมูลไม่เปลี่ยน
let __calcTotalsCache = { key: null, result: null };

function __makeTotalsKey(s) {
  if (!s) return "";
  // สร้าง fingerprint แบบเร็ว (ไม่ใช้ JSON.stringify เพราะช้า)
  const mems = s.members || [];
  const mKey = mems.map(m => `${m.id}|${m.shuttlesUsed || 0}|${m.isPaid ? 1 : 0}|${m.excludeAllShuttles ? 1 : 0}|${m.shuttlesExcluded || 0}|${m.manualFee || ""}`).join(";");
  const matchKey = (s.matches || []).map(m => {
    const pIds = m.players || [m.a1, m.a2, m.b1, m.b2].filter(Boolean);
    return `${m.id}:${m.shuttleNumbers || ""}:${(m.exemptPlayers || []).join("-")}:${pIds.join("-")}`;
  }).join(",");
  return `${s.courtFee}|${s.courtFeeType}|${s.shuttlePrice}|${s.otherCost}|${s.otherCostType}|${mKey}|${matchKey}`;
}

function calcTotals(sessionObj) {
  const s = sessionObj || currentSession;
  if (!s) return { totalShuttles: 0, totalShuttleCost: 0, totalCourtCost: 0, totalOtherCost: 0, totalAll: 0, perMember: [], matchShuttlesMap: {} };

  // 🚀 Memoize: ถ้าข้อมูลไม่เปลี่ยน → คืน cache ทันที (ไม่คำนวณซ้ำ)
  const key = __makeTotalsKey(s);
  if (key === __calcTotalsCache.key && __calcTotalsCache.result) {
    return __calcTotalsCache.result;
  }

  const members = s.members || [];
  const matches = s.matches || [];
  const N = members.length;
  const courtFee = +s.courtFee || 0;
  const courtFeeType = s.courtFeeType || "perPerson";
  const shuttlePrice = +s.shuttlePrice || 0;
  const otherCost = +s.otherCost || 0;
  const otherCostType = s.otherCostType || "perPerson";

  const manualShuttles = members.reduce((sum, m) => sum + (m.shuttlesUsed || 0), 0);
  
  let matchShuttlesTotal = 0;
  const matchShuttlesMap = {};
  
  matches.forEach(match => {
    const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
    if (pIds.length === 0) return;
    
    const count = parseShuttleCount(match.shuttleNumbers, s);
    matchShuttlesTotal += count;

    // ตรวจสอบรายชื่อสมาชิกที่ถูกยกเว้นค่าลูกในเกมนี้
    const exemptPlayers = match.exemptPlayers || [];
    const activeExempts = pIds.filter(id => exemptPlayers.includes(id));
    const exemptCount = activeExempts.length;

    if (exemptCount > 0 && exemptCount < pIds.length) {
      // มีบางคนได้สิทธิ์ยกเว้น: ตัวหารน้อยลง คนที่เหลือแบกรับภาระค่าลูกของคนที่ถูกยกเว้นเพิ่มขึ้น
      const payingCount = pIds.length - exemptCount;
      const multiplier = pIds.length / payingCount; // เช่น ยกเว้น 2 คน จาก 4 คน -> multiplier = 4/2 = 2 เท่า!
      pIds.forEach(id => {
        if (!exemptPlayers.includes(id)) {
          matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + (count * multiplier);
        }
      });
    } else {
      // ไม่มีคนยกเว้น หรือยกเว้นทุกคน: จ่ายเฉลี่ยเท่ากันปกติ
      pIds.forEach(id => {
        matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + count;
      });
    }
  });

  const totalShuttles = manualShuttles + matchShuttlesTotal;

  const totalCourtCost = courtFeeType === "total" ? courtFee : courtFee * N;
  const courtPer = N > 0 ? (courtFeeType === "total" ? courtFee / N : courtFee) : 0;
  
  const totalOtherCost = otherCostType === "total" ? otherCost : otherCost * N;
  const otherPer = N > 0 ? (otherCostType === "total" ? otherCost / N : otherCost) : 0;

  let totalShuttleCost = 0;
  const perMember = members.map(m => {
    // ✍️ Manual Override: ถ้ากำหนดราคาเองโดยผู้ดูแลระบบ ให้ใช้ราคานั้นโดยไม่สนการคำนวณใดๆ
    if (m.manualFee !== undefined && m.manualFee !== null && m.manualFee !== "" && !isNaN(m.manualFee)) {
      return +m.manualFee;
    }

    const individualShuttles = (m.shuttlesUsed || 0) + (matchShuttlesMap[m.id] || 0);
    
    // คำนวณจำนวนลูกที่จะคิดเงิน โดยลบส่วนที่ยกเว้นออก
    let payableShuttles = individualShuttles;
    if (m.excludeAllShuttles) {
      payableShuttles = 0;
    } else if (m.shuttlesExcluded && m.shuttlesExcluded > 0) {
      payableShuttles = Math.max(0, individualShuttles - m.shuttlesExcluded);
    }
    
    totalShuttleCost += payableShuttles * shuttlePrice;
    return courtPer + otherPer + (payableShuttles * shuttlePrice);
  });
  
  // ยอดรวมทั้งหมดของเซสชัน = ผลรวมยอดของสมาชิกทุกคน
  const totalAll = perMember.reduce((sum, cost) => sum + cost, 0);

  const result = { totalShuttles, totalShuttleCost, totalCourtCost, totalOtherCost, totalAll, perMember, matchShuttlesMap };
  __calcTotalsCache = { key, result };
  return result;
}

function renderSummary() {
  const t = calcTotals();
  const s = currentSession;
  $("sumCourt").textContent = fmt(t.totalCourtCost) + " ฿";
  $("sumShuttle").textContent = fmt(t.totalShuttleCost) + " ฿";
  $("sumShuttleQty").textContent = t.totalShuttles;
  $("sumOther").textContent = fmt(t.totalOtherCost) + " ฿";
  $("sumTotal").textContent = fmt(t.totalAll) + " ฿";
}

function renderAuditLog() {
  const s = currentSession;
  const tbody = $("auditLogTableBody");
  if (!s || !tbody) return;

  const headerEl = $("lblAuditLogShuttleHeader");
  if (headerEl) {
    headerEl.textContent = s.simpleShuttleCount ? "🏸 จำนวนลูก" : "🏷️ เบอร์ลูก";
  }

  const matches = s.matches || [];
  if (matches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-slate-400 text-center py-6 text-xs">ยังไม่มีประวัติการใช้ลูกในเกม</td></tr>`;
    return;
  }

  const membersMap = {};
  (s.members || []).forEach(m => membersMap[m.id] = m.name);

  tbody.innerHTML = matches.map((m, idx) => {
    // 1. Shuttles Used (🏷️ ลูกเบอร์ที่ใช้ หรือ จำนวนลูก)
    const shuttlesVal = m.shuttleNumbers
      ? (s.simpleShuttleCount ? `${escapeHtml(m.shuttleNumbers)} ลูก` : escapeHtml(m.shuttleNumbers).trim())
      : "—";
    
    // 2. Players (👥 ผู้เล่นในสนาม)
    const pIds = m.players || [m.a1, m.a2, m.b1, m.b2].filter(Boolean);
    const playerNames = pIds.map(pid => escapeHtml(membersMap[pid] || "?")).join(", ");
    
    // 3. Responsible Players (💰 ผู้รับผิดชอบ/บวกลูก)
    const exempts = m.exemptPlayers || [];
    let responsibleStr = "";
    
    if (exempts.length === 0 || exempts.length === pIds.length) {
      responsibleStr = `<span class="text-slate-400 font-semibold">ปกติ</span>`;
    } else {
      const nonExempts = pIds.filter(pid => !exempts.includes(pid));
      if (nonExempts.length > 0) {
        responsibleStr = `<span class="text-rose-500 font-extrabold">${nonExempts.map(pid => escapeHtml(membersMap[pid] || "?")).join(", ")}</span>`;
      } else {
        responsibleStr = `<span class="text-slate-400 font-semibold">ปกติ</span>`;
      }
    }

    return `
      <tr class="border-b border-slate-100 dark:border-slate-800/40 text-xs text-slate-700 dark:text-slate-300">
        <td class="py-2.5 pr-2 font-bold text-center text-slate-500">${idx + 1}</td>
        <td class="py-2.5 px-2 text-center font-black text-slate-900 dark:text-slate-100">${shuttlesVal}</td>
        <td class="py-2.5 px-2 font-medium leading-relaxed">${playerNames}</td>
        <td class="py-2.5 pl-2 font-semibold leading-relaxed">${responsibleStr}</td>
      </tr>
    `;
  }).join("");
}

function renderMatches() {
  const list = $("matchesList");
  const matches = currentSession.matches || [];
  $("matchCount").textContent = matches.length;

  if (matches.length === 0) {
    list.innerHTML = `<p class="text-slate-400 text-center py-4 text-sm">ยังไม่มีเกม กดจัดเกมด้านล่าง</p>`;
    return;
  }

  const membersMap = {};
  (currentSession.members || []).forEach(m => membersMap[m.id] = m.name);

  list.innerHTML = matches.map((m, idx) => {
    const finished = !!m.finished;
    // เกมที่ "จบแล้ว" → จางลง + ขีดทับเล็กน้อย เพื่อให้รู้ว่าผ่านไปแล้ว
    const rowBgClass = finished
      ? "bg-emerald-50/40 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/30 opacity-70"
      : "bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800";
    const titleClass = finished
      ? "text-slate-400 dark:text-slate-500 line-through"
      : "text-slate-700 dark:text-slate-300";
    const playersClass = finished
      ? "text-emerald-700/60 dark:text-emerald-400/60"
      : "text-emerald-700 dark:text-emerald-400";

    // Checkbox สำหรับ "เกมนี้จบแล้ว"
    const finishedCheckbox = finished
      ? `<button data-match-finish="${m.id}" class="w-6 h-6 shrink-0 rounded-md bg-emerald-500 border border-emerald-500 text-white flex items-center justify-center transition-colors" title="เกมนี้จบแล้ว — กดเพื่อยกเลิก">
           <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
             <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
           </svg>
         </button>`
      : `<button data-match-finish="${m.id}" class="w-6 h-6 shrink-0 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:border-emerald-400 flex items-center justify-center transition-colors" title="กดเมื่อเกมนี้จบแล้ว">
         </button>`;

    return `
    <div class="${rowBgClass} p-3 rounded-xl border flex items-start justify-between gap-3 transition-colors">
      <div class="flex-1 text-sm min-w-0">
        <div class="flex justify-between items-center mb-1 gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <button data-match-del="${m.id}" class="text-slate-300 dark:text-slate-600 hover:text-red-500 px-1 text-lg leading-none shrink-0" title="ลบเกมนี้">&times;</button>
            <div class="font-bold ${titleClass}">เกมที่ ${idx + 1}</div>
          </div>
          ${(() => {
            if (currentSession?.simpleShuttleCount) {
              const qty = escapeHtml(m.shuttleNumbers || "0");
              return `
                <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 shrink-0 select-none">
                  <button data-match-shuttle-dec="${m.id}" class="w-5 h-5 rounded bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-650 flex items-center justify-center font-black text-slate-600 dark:text-slate-350 text-[10px] transition-transform active:scale-90" title="ลดจำนวนลูก">−</button>
                  <div class="px-1.5 text-center font-bold text-[11px] text-slate-700 dark:text-slate-200 tabular-nums">${qty} ลูก</div>
                  <button data-match-shuttle-inc="${m.id}" class="w-5 h-5 rounded bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-650 flex items-center justify-center font-black text-slate-600 dark:text-slate-350 text-[10px] transition-transform active:scale-90" title="เพิ่มจำนวนลูก">+</button>
                </div>
              `;
            }
            const displayVal = m.shuttleNumbers || "—";
            return `
              <div class="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 rounded-lg p-0.5 shrink-0 select-none">
                <button data-match-shuttle-dec="${m.id}" class="w-5 h-5 rounded bg-white dark:bg-emerald-800 hover:bg-slate-100 dark:hover:bg-emerald-700 flex items-center justify-center font-black text-emerald-800 dark:text-emerald-300 text-[10px] transition-transform active:scale-90" title="ลดจำนวนลูก">−</button>
                <div class="px-1.5 text-center font-bold text-[10px] tabular-nums">ลูกที่ ${escapeHtml(displayVal)}</div>
                <button data-match-shuttle-inc="${m.id}" class="w-5 h-5 rounded bg-white dark:bg-emerald-800 hover:bg-slate-100 dark:hover:bg-emerald-700 flex items-center justify-center font-black text-emerald-800 dark:text-emerald-300 text-[10px] transition-transform active:scale-90" title="เพิ่มจำนวนลูก">+</button>
              </div>
            `;
          })()}
        </div>
        <div class="${playersClass} font-medium text-xs leading-relaxed pl-7 flex items-center flex-wrap gap-1">
          ${(() => {
            const pIds = m.players || [m.a1, m.a2, m.b1, m.b2].filter(Boolean);
            const exempts = m.exemptPlayers || [];
            
            const formatName = (pid) => {
              const name = escapeHtml(membersMap[pid] || '?');
              if (exempts.includes(pid)) {
                return `<span class="line-through text-slate-400 dark:text-slate-500 font-normal" title="ฟรีค่าลูกในเกมนี้">${name} 🏸</span>`;
              }
              return name;
            };

            if (pIds.length === 4 && useTeams()) {
              const n1 = formatName(pIds[0]);
              const n2 = formatName(pIds[1]);
              const n3 = formatName(pIds[2]);
              const n4 = formatName(pIds[3]);
              return `<span class="text-rose-600 dark:text-rose-400 font-bold">${n1}, ${n2}</span> <span class="text-slate-400 font-black mx-1">VS</span> <span class="text-sky-600 dark:text-sky-400 font-bold">${n3}, ${n4}</span>`;
            }
            return pIds.map(formatName).join(", ");
          })()}
        </div>
      </div>
      <div class="flex flex-col items-center gap-1.5">
        <button data-match-edit="${m.id}" class="text-slate-400 hover:text-emerald-600 px-1 text-sm" title="แก้ไขเกม">✏️</button>
        ${finishedCheckbox}
      </div>
    </div>
  `}).join("");

  list.querySelectorAll("button[data-match-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const matchId = btn.dataset.matchEdit;
      const match = (currentSession.matches || []).find(x => x.id === matchId);
      if (!match) return;

      editingMatchId = matchId;
      matchDraftPlayers = [...(match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean))];
      matchDraftExempts = [...(match.exemptPlayers || [])];
      $("fldMatchShuttles").value = match.shuttleNumbers || "";
      $("matchModalTitle").textContent = "✏️ แก้ไขเกม";

      renderMatchDraft();
      $("matchModal").classList.remove("hidden");
    });
  });

  list.querySelectorAll("button[data-match-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("ลบเกมนี้?")) return;
      const newMatches = (currentSession.matches || []).filter(x => x.id !== btn.dataset.matchDel);
      saveSession({ matches: newMatches });
    });
  });

  // Checkbox "เกมนี้จบแล้ว" → toggle field `finished` ของเกมนั้น
  list.querySelectorAll("button[data-match-finish]").forEach(btn => {
    btn.addEventListener("click", () => {
      const matchId = btn.dataset.matchFinish;
      const newMatches = (currentSession.matches || []).map(m =>
        m.id === matchId ? { ...m, finished: !m.finished } : m
      );
      saveSession({ matches: newMatches });
    });
  });

  // บวกลดจำนวนลูกแบดในเกมจากหน้า card โดยตรง (รองรับทั้งสองโหมด)
  list.querySelectorAll("button[data-match-shuttle-dec]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const matchId = btn.dataset.matchShuttleDec;
      const isSimple = !!currentSession?.simpleShuttleCount;
      const match = (currentSession.matches || []).find(x => x.id === matchId);
      if (!match) return;

      let newShuttles = "";
      if (isSimple) {
        const currentCount = parseInt(match.shuttleNumbers, 10) || 0;
        const newCount = Math.max(0, currentCount - 1);
        if (!confirm("ลดจำนวนลูก 1 ลูก?")) return;
        newShuttles = String(newCount);
      } else {
        const nums = listShuttleNumbers(match.shuttleNumbers || "");
        if (nums.length === 0) return toast("ไม่มีลูกให้ลดแล้วครับ");
        nums.sort((a, b) => a - b);
        const lastNum = nums[nums.length - 1];
        if (!confirm(`ลดลูกเบอร์ ${lastNum}?`)) return;
        nums.pop();
        newShuttles = formatShuttleNumbers(nums);
      }

      const newMatches = (currentSession.matches || []).map(m =>
        m.id === matchId ? { ...m, shuttleNumbers: newShuttles } : m
      );
      saveSession({ matches: newMatches });
      const idx = (currentSession.matches || []).findIndex(x => x.id === matchId);
      toast(`ลดจำนวนลูกเกมที่ ${idx + 1} เรียบร้อย 🏸`);
    });
  });

  list.querySelectorAll("button[data-match-shuttle-inc]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const matchId = btn.dataset.matchShuttleInc;
      const isSimple = !!currentSession?.simpleShuttleCount;
      const match = (currentSession.matches || []).find(x => x.id === matchId);
      if (!match) return;

      let newShuttles = "";
      if (isSimple) {
        const currentCount = parseInt(match.shuttleNumbers, 10) || 0;
        const newCount = currentCount + 1;
        if (!confirm("เพิ่มจำนวนลูก 1 ลูก?")) return;
        newShuttles = String(newCount);
      } else {
        const nums = listShuttleNumbers(match.shuttleNumbers || "");
        const nextFree = getNextUnusedShuttle(nums, matchId);
        if (!confirm(`เพิ่มลูกเบอร์ ${nextFree}?`)) return;
        nums.push(nextFree);
        newShuttles = formatShuttleNumbers(nums);
      }

      const newMatches = (currentSession.matches || []).map(m =>
        m.id === matchId ? { ...m, shuttleNumbers: newShuttles } : m
      );
      saveSession({ matches: newMatches });
      const idx = (currentSession.matches || []).findIndex(x => x.id === matchId);
      toast(`เพิ่มจำนวนลูกเกมที่ ${idx + 1} เรียบร้อย 🏸`);
    });
  });
}

// ---------- Save (debounced) ----------
async function saveSession(patch) {
  if (!currentSessionId) return;

// --- 1. เพิ่มบล็อกนี้เพื่อจดจำสนามล่าสุดลงในเครื่อง ---
  if (patch.courts && patch.courts.length > 0) {
    saveGlobalDefaults({ lastUsedCourts: patch.courts });
  }
  // ------------------------------------------------

  // Optimistic local update so UI feels snappy
  Object.assign(currentSession, patch);
  renderSession();

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      await updateDoc(doc(db, "sessions", currentSessionId), {
        ...patch,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
      // ถ้าเจอ "doc size > 1MB" → เสนอลบรูปสลิปอัตโนมัติ
      if (err.message?.includes("exceeds the maximum") || err.message?.includes("size")) {
        await handleDocSizeError(patch);
      } else {
        toast("บันทึกไม่ได้: " + err.message);
      }
    }
  }, 400);
}

// ประมาณขนาด document ของ session (เพื่อโชว์เตือนก่อนจะเต็ม 1MB)
function estimateSessionSize(session) {
  if (!session) return 0;
  try {
    return new Blob([JSON.stringify(session)]).size;
  } catch {
    return 0;
  }
}

// อัปเดต UI ของปุ่ม "🧹 ลดขนาด" — โชว์ปุ่มเมื่อใช้ > 70% ของ 1MB
function updateCleanupButton() {
  const btn = $("btnCleanupSize");
  const label = $("cleanupSizeLabel");
  if (!btn || !currentSession) return;

  const size = estimateSessionSize(currentSession);
  const FIRESTORE_LIMIT = 1048576;
  const pct = Math.round((size / FIRESTORE_LIMIT) * 100);
  const removableCount = (currentSession.members || [])
    .filter(m => m.isPaid && m.slipQR && m.slipImage).length;

  // โชว์ปุ่มเฉพาะเมื่อใช้ > 70% AND มีสลิปให้ลบได้
  if (pct >= 70 && removableCount > 0) {
    btn.classList.remove("hidden");
    if (label) label.textContent = `ลดขนาด (${pct}%)`;
    // ใช้ > 85% → เปลี่ยนสีแดงเตือน
    if (pct >= 85) {
      btn.classList.remove("bg-amber-50", "dark:bg-amber-900/30", "text-amber-700", "dark:text-amber-300", "border-amber-200", "dark:border-amber-800/50", "hover:bg-amber-100");
      btn.classList.add("bg-rose-50", "dark:bg-rose-900/30", "text-rose-700", "dark:text-rose-300", "border-rose-200", "dark:border-rose-800/50", "hover:bg-rose-100", "animate-pulse");
    } else {
      btn.classList.remove("bg-rose-50", "dark:bg-rose-900/30", "text-rose-700", "dark:text-rose-300", "border-rose-200", "dark:border-rose-800/50", "hover:bg-rose-100", "animate-pulse");
      btn.classList.add("bg-amber-50", "dark:bg-amber-900/30", "text-amber-700", "dark:text-amber-300", "border-amber-200", "dark:border-amber-800/50", "hover:bg-amber-100");
    }
  } else {
    btn.classList.add("hidden");
  }
}

$("btnCleanupSize")?.addEventListener("click", async () => {
  if (!currentSession || !currentSessionId) return;
  const members = currentSession.members || [];
  const removableCount = members.filter(m => m.isPaid && m.slipQR && m.slipImage).length;
  if (removableCount === 0) {
    toast("ไม่มีสลิปที่ลบได้ — ต้องเป็นคนที่ verify ด้วย QR แล้ว");
    return;
  }
  const size = estimateSessionSize(currentSession);
  const sizeKB = Math.round(size / 1024);
  if (!confirm(`ลดขนาด session?\n\n• ขนาดปัจจุบัน: ${sizeKB} KB\n• จะลบรูปสลิป ${removableCount} รูป (เฉพาะคนที่ verify QR แล้ว)\n• ยังเก็บข้อมูล QR ไว้สำหรับ verify ภายหลัง\n\nดำเนินการ?`)) return;

  const cleaned = members.map(m => {
    if (m.isPaid && m.slipQR && m.slipImage) {
      const { slipImage, ...rest } = m;
      return rest;
    }
    return m;
  });
  try {
    await updateDoc(doc(db, "sessions", currentSessionId), {
      members: cleaned,
      updatedAt: serverTimestamp()
    });
    toast(`✓ ลบสลิป ${removableCount} รูปแล้ว — ลดขนาด session สำเร็จ`, 4000);
  } catch (err) {
    toast("ลดขนาดไม่สำเร็จ: " + err.message);
  }
});

// แก้ปัญหา Firestore document > 1MB
// เกิดจากรูปสลิป (base64) สะสมเยอะเกิน → ลบรูปสลิปของคนที่ verify ด้วย QR แล้ว
async function handleDocSizeError(patch) {
  const members = currentSession.members || [];
  const removableCount = members.filter(m => m.isPaid && m.slipQR && m.slipImage).length;

  if (removableCount === 0) {
    toast("⚠️ ก๊วนนี้มีข้อมูลเกิน 1 MB และไม่มีสลิปที่ verify ด้วย QR ให้ลบได้", 5000);
    alert("⚠️ ขนาดข้อมูลก๊วนเกิน 1 MB\n\nไม่สามารถลบสลิปอัตโนมัติได้เพราะยังไม่มีสลิปที่ verify ด้วย QR\n\nวิธีแก้:\n• ลบสมาชิกที่ไม่จำเป็น\n• ลบเกมเก่าที่ไม่ใช้\n• ติดต่อ admin เพื่อย้ายไปก๊วนใหม่");
    return;
  }

  const proceed = confirm(`⚠️ ขนาดข้อมูลก๊วนเกิน 1 MB\n\nระบบสามารถลดขนาดได้โดยลบรูปสลิป ${removableCount} รูป\n(เฉพาะคนที่ verify ด้วย QR แล้ว — ยังคงเก็บข้อมูล QR ไว้)\n\nดำเนินการลบและลองบันทึกใหม่?`);
  if (!proceed) {
    toast("⚠️ บันทึกไม่ได้ — ยกเลิกการลบสลิป", 4000);
    return;
  }

  // ลบ slipImage แต่เก็บ slipQR ไว้
  const cleanedMembers = members.map(m => {
    if (m.isPaid && m.slipQR && m.slipImage) {
      const { slipImage, ...rest } = m;
      return rest;
    }
    return m;
  });

  try {
    await updateDoc(doc(db, "sessions", currentSessionId), {
      members: cleanedMembers,
      ...patch,
      updatedAt: serverTimestamp()
    });
    toast(`✓ ลดขนาดสำเร็จ — ลบสลิป ${removableCount} รูป (ยังเก็บข้อมูล QR)`, 4000);
  } catch (err2) {
    console.error("[Cleanup] Retry failed:", err2);
    toast("⚠️ ลดขนาดแล้วยังบันทึกไม่ได้: " + err2.message, 5000);
  }
}

// Field listeners
$("fldLocation").addEventListener("input", e => {
  const loc = e.target.value;
  localStorage.setItem("defaultLocation", loc);
  saveSession({ location: loc });
});
$("fldDate").addEventListener("change", e => saveSession({ date: e.target.value }));
$("fldCourtFee").addEventListener("input", e => {
  const val = +e.target.value || 0;
  localStorage.setItem("defaultCourtFee", val);
  saveSession({ courtFee: val });
});
$("fldCourtFeeType").addEventListener("change", e => {
  const val = e.target.value;
  localStorage.setItem("defaultCourtFeeType", val);
  saveSession({ courtFeeType: val });
});
$("fldShuttlePrice").addEventListener("input", e => {
  const val = +e.target.value || 0;
  localStorage.setItem("defaultShuttlePrice", val);
  saveSession({ shuttlePrice: val });
});
$("fldOtherCost").addEventListener("input", e => {
  const val = +e.target.value || 0;
  localStorage.setItem("defaultOtherCost", val);
  saveSession({ otherCost: val });
});
$("fldOtherCostType").addEventListener("change", e => {
  const val = e.target.value;
  localStorage.setItem("defaultOtherCostType", val);
  saveSession({ otherCostType: val });
});

$("fldSimpleShuttleCount")?.addEventListener("change", e => saveSession({ simpleShuttleCount: e.target.checked }));

// Add member
function addMember() {
  const input = $("fldNewMember");
  const name = input.value.trim();
  if (!name) return;
  const members = [...(currentSession.members || [])];
  if (members.some(m => (m.name || "").toLowerCase() === name.toLowerCase())) {
    toast(`มีชื่อ "${name}" ในก๊วนแล้ว`);
    return;
  }
  const newId = uid();
  trackOwnSubmit(newId);
  members.push({ id: newId, name, shuttlesUsed: 0 });
  addKnownMember(name); // จดจำไว้สำหรับครั้งหน้า
  saveSession({ members });
  input.value = "";
  input.focus();
}
$("btnAddMember").addEventListener("click", addMember);
$("fldNewMember").addEventListener("keypress", e => { if (e.key === "Enter") addMember(); });

// Share link (Listener moved to bottom)

// QR — legacy share-session link QR (dead element; kept as defensive no-op)
$("btnQR").addEventListener("click", () => {
  const url = location.href;
  const canvas = $("qrCanvas");
  if (canvas && typeof QRCode !== "undefined") {
    canvas.innerHTML = "";
    try {
      new QRCode(canvas, { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    } catch (e) { /* ignore */ }
  }
  const txt = $("qrUrlText"); if (txt) txt.textContent = url;
  const modal = $("qrModal"); if (modal) modal.classList.remove("hidden");
});
$("btnCloseQR").addEventListener("click", () => $("qrModal").classList.add("hidden"));
$("qrModal").addEventListener("click", e => { if (e.target.id === "qrModal") $("qrModal").classList.add("hidden"); });

// Close/reopen
$("btnCloseSession").addEventListener("click", () => {
  const newStatus = currentSession.status === "closed" ? "open" : "closed";
  saveSession({ status: newStatus });
  toast(newStatus === "closed" ? "ปิด Court แล้ว ✓" : "เปิด Court อีกครั้ง ✓");
});

// Delete
$("btnDeleteSession").addEventListener("click", async () => {
  if (isInManagerLinkView() || isManagerAuthed()) {
    toast("เฉพาะ Admin เท่านั้นที่สามารถลบก๊วนได้");
    return;
  }
  if (!confirm("ลบก๊วนนี้ทิ้ง? (ไม่สามารถกู้คืนได้)")) return;
  const deletingId = currentSessionId;
  try {
    // Mark ว่าเป็น user-initiated delete (ป้องกัน toast "ไม่พบก๊วน" ที่ซ้ำซ้อน)
    recentlyDeletedSessionId = deletingId;
    setTimeout(() => {
      if (recentlyDeletedSessionId === deletingId) recentlyDeletedSessionId = null;
    }, 5000);

    // ลบ receipts subcollection ก่อน (best-effort) — กัน orphan
    await deleteAllReceiptsForSession(deletingId);
    await deleteDoc(doc(db, "sessions", deletingId));
    // Cleanup listener ทันที (snapshot fire "ไม่มี" จะไม่ trigger logic)
    if (unsubscribeSession) { unsubscribeSession(); unsubscribeSession = null; }
    location.hash = "#/";
    toast("ลบก๊วนแล้ว");
  } catch (err) {
    recentlyDeletedSessionId = null;
    toast("ลบไม่ได้: " + err.message);
  }
});

// ============================================================
// MATCH & STATS
// ============================================================
let matchDraftPlayers = [];
let matchDraftExempts = [];
let editingMatchId = null;

function getNextShuttleNumber() {
  const matches = currentSession?.matches || [];
  let maxShuttle = 0;
  matches.forEach(m => {
    const nums = listShuttleNumbers(m.shuttleNumbers || "");
    nums.forEach(n => {
      if (n > maxShuttle) maxShuttle = n;
    });
  });
  return maxShuttle + 1;
}

function formatShuttleNumbers(nums) {
  if (nums.length === 0) return "";
  const uniqueNums = Array.from(new Set(nums)).sort((a, b) => a - b);
  const parts = [];
  let start = uniqueNums[0];
  let prev = start;
  for (let i = 1; i <= uniqueNums.length; i++) {
    const curr = uniqueNums[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      if (prev === start) {
        parts.push(String(start));
      } else {
        parts.push(start + "-" + prev);
      }
      start = curr;
      prev = curr;
    }
  }
  return parts.join(", ");
}

function getNextUnusedShuttle(currentNums, excludeMatchId = editingMatchId) {
  const sessionMatches = currentSession?.matches || [];
  let maxShuttle = 0;
  
  sessionMatches.forEach(m => {
    if (m.id === excludeMatchId) return;
    const nums = listShuttleNumbers(m.shuttleNumbers || "");
    nums.forEach(n => {
      if (n > maxShuttle) maxShuttle = n;
    });
  });
  
  currentNums.forEach(n => {
    if (n > maxShuttle) maxShuttle = n;
  });
  
  return maxShuttle + 1;
}

$("btnAddMatch").addEventListener("click", () => {
  const members = currentSession.members || [];
  if (members.length < 4) return alert("ต้องมีสมาชิกอย่างน้อย 4 คน ถึงจะจัดเกมได้ครับ");
  
  editingMatchId = null;
  matchDraftPlayers = [];
  matchDraftExempts = [];
  
  const isSimple = !!currentSession?.simpleShuttleCount;
  $("fldMatchShuttles").value = isSimple ? "" : String(getNextShuttleNumber());
  
  $("matchModalTitle").textContent = "🏸 จัดเกมใหม่";
  renderMatchDraft();
  $("matchModal").classList.remove("hidden");
});

// ============================================================
// 🎖️  Skill / Mode helpers (Phase 1-3 of Advance mode feature)
// ============================================================
// Skill: A=5 (เก่งสุด), B=4, C=3, P=2, S=1 (อ่อนสุด)
const SKILL_VALUE = { A: 5, B: 4, C: 3, P: 2, S: 1 };
const SKILL_LEVELS = ["A", "B", "C", "P", "S"];

function isAdvanceMode() {
  if (!currentSession || !Array.isArray(currentSession.members)) return false;
  return currentSession.members.some(m => m && m.skill);
}
function useTeams() { return true; }

function getSkillValue(memberId, members) {
  const m = (members || currentSession?.members || []).find(x => x.id === memberId);
  const s = (m && m.skill) || null;
  return s && SKILL_VALUE[s] ? SKILL_VALUE[s] : 2.5; // unknown → กลางๆ
}

// Check if two players are buddies
function areBuddies(id1, id2, members) {
  const m1 = (members || currentSession?.members || []).find(m => m.id === id1);
  const m2 = (members || currentSession?.members || []).find(m => m.id === id2);
  if (!m1 || !m2) return false;
  return m1.buddyId === id2 || m2.buddyId === id1;
}

// คะแนน skill gap ของ 4 ใน combo — split เป็น 2 vs 2 ทั้ง 3 วิธี เลือก gap ต่ำสุด
function bestSkillSplitGap(ids, members) {
  if (ids.length !== 4) return 0;
  const v = ids.map(id => getSkillValue(id, members));
  const pairs = [
    Math.abs((v[0] + v[1]) - (v[2] + v[3])),
    Math.abs((v[0] + v[2]) - (v[1] + v[3])),
    Math.abs((v[0] + v[3]) - (v[1] + v[2]))
  ];
  return Math.min(...pairs);
}

// คืน split ที่ดีที่สุดของ 4 ids → { teamA, teamB, gap }
// ถ้า teammateCount มี → minimize teammate overlap ก่อน skill gap
function findBestTeamSplit(ids, members, teammateCount) {
  if (ids.length !== 4) return { teamA: ids.slice(0, 2), teamB: ids.slice(2, 4), gap: 0 };
  const splits = [
    { a: [ids[0], ids[1]], b: [ids[2], ids[3]] },
    { a: [ids[0], ids[2]], b: [ids[1], ids[3]] },
    { a: [ids[0], ids[3]], b: [ids[1], ids[2]] }
  ];
  const scored = splits.map(s => {
    const va = getSkillValue(s.a[0], members) + getSkillValue(s.a[1], members);
    const vb = getSkillValue(s.b[0], members) + getSkillValue(s.b[1], members);
    const gap = Math.abs(va - vb);
    let teammateOverlap = 0;
    if (teammateCount) {
      teammateOverlap += (teammateCount[s.a[0]]?.[s.a[1]] || 0);
      teammateOverlap += (teammateCount[s.b[0]]?.[s.b[1]] || 0);
    }
    
    // Add Buddy separation penalty
    let buddyPenalty = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const idI = ids[i];
        const idJ = ids[j];
        if (areBuddies(idI, idJ, members)) {
          const separated = (s.a.includes(idI) && s.b.includes(idJ)) || (s.b.includes(idI) && s.a.includes(idJ));
          if (separated) {
            buddyPenalty += 99999;
          }
        }
      }
    }
    
    return { teamA: s.a, teamB: s.b, gap: gap + buddyPenalty, teammateOverlap, strA: va, strB: vb };
  });
  // ลำดับความสำคัญ: teammateOverlap ↑ → gap ↑ → สุ่ม (กันได้ split เดิมซ้ำๆ)
  scored.sort((x, y) => {
    if (x.teammateOverlap !== y.teammateOverlap) return x.teammateOverlap - y.teammateOverlap;
    if (x.gap !== y.gap) return x.gap - y.gap;
    return Math.random() - 0.5;
  });
  return scored[0];
}

// ---------- Match scoring helpers (shared by renderMatchDraft + auto-draft) ----------
// คำนวณคะแนนของชุด N คน (ปกติ N=4) เพื่อใช้ในการแนะนำและสุ่ม
//   balance = ผลรวมเกมส่วนเกินจาก minGames (ยิ่งน้อย = ทุกคนเล่นเท่าๆ กัน)
//   max     = คู่ที่จับกันมากสุดในชุด (ยิ่งน้อย = ไม่สร้างคู่ที่ซ้ำหนัก)
//   unmet   = จำนวนคู่ในชุดที่ยังไม่เคยจับกันมาก่อน (ยิ่งมาก = สร้างคู่ใหม่ๆ)
//   sum     = ผลรวม partner overlap ทุกคู่ (tiebreaker)
function scoreMatchCombo(ids, gamesPlayed, partnerCount, minGames, opts) {
  let sum = 0, max = 0, unmet = 0;
  const n = ids.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const o = (partnerCount[ids[i]] && partnerCount[ids[i]][ids[j]]) || 0;
      sum += o;
      if (o > max) max = o;
      if (o === 0) unmet++;
    }
  }
  const balance = ids.reduce((acc, id) => acc + (gamesPlayed[id] - minGames), 0);
  
  // ใน Advance mode → คะแนน skillGap = gap ของ best 2v2 split ในชุดนี้
  let skillGap = 0;
  if (opts && opts.advanceMode && n === 4) {
    skillGap = bestSkillSplitGap(ids, opts.members);
  }
  
  // ใน Buddy system → prioritized buddy pairing in auto draft
  let buddyImbalance = 0;
  if (opts && opts.members && n === 4) {
    ids.forEach(id => {
      const m = (opts.members || []).find(x => x.id === id);
      if (m) {
        const buddyId = m.buddyId 
          ? m.buddyId 
          : (opts.members || []).find(x => x.buddyId === m.id)?.id || null;
        if (buddyId) {
          // m has a buddy. Check if the buddy is registered in this session and NOT paid (eligible to play)
          const buddyExists = (opts.members || []).some(x => x.id === buddyId && !x.isPaid);
          if (buddyExists) {
            const buddyInCombo = ids.includes(buddyId);
            if (!buddyInCombo) {
              // One buddy is selected but the other is left behind on the bench!
              buddyImbalance += 10; // add a penalty to avoid splitting buddies
            }
          }
        }
      }
    });
  }
  
  let teamImbalance = 0;
  
  return { balance, max, unmet, sum, skillGap, teamImbalance, buddyImbalance };
}

// เปรียบเทียบ score: buddyImbalance ↓ (ถ้ามี) → balance ↑ → max ↑ → skillGap ↑ (Advance only) → unmet ↓ → sum ↑
function compareScores(x, y) {
  if ((x.buddyImbalance || 0) !== (y.buddyImbalance || 0)) {
    return (x.buddyImbalance || 0) - (y.buddyImbalance || 0);
  }
  if ((x.teamImbalance || 0) !== (y.teamImbalance || 0)) {
    return (x.teamImbalance || 0) - (y.teamImbalance || 0);
  }
  if (x.balance !== y.balance) return x.balance - y.balance;
  if (x.max !== y.max) return x.max - y.max;
  // skillGap มีค่าเฉพาะ Advance — ถ้าเป็น 0 ทั้งคู่ก็ไม่กระทบลำดับ
  if ((x.skillGap || 0) !== (y.skillGap || 0)) return (x.skillGap || 0) - (y.skillGap || 0);
  if (x.unmet !== y.unmet) return y.unmet - x.unmet;
  return x.sum - y.sum;
}

// หา "ชุดที่ดีที่สุด" สำหรับเติมที่นั่ง slotsNeeded ที่เหลือ โดยมี fixedIds ที่ถูกเลือกไว้แล้ว
// deterministic = true → เลือกแบบคงที่ (สำหรับ UI), false → สุ่มในกลุ่มเสมอ (สำหรับ Auto Draft)
function findOptimalAddition(availableMembers, fixedIds, slotsNeeded, gamesPlayed, partnerCount, minGames, deterministic, opts) {
  if (slotsNeeded <= 0) return [];
  const ids = availableMembers.map(m => m.id);
  if (ids.length < slotsNeeded) return ids.slice();

  const combos = [];
  const picked = [];

  function recurse(start) {
    if (picked.length === slotsNeeded) {
      const combined = fixedIds.concat(picked);
      const sc = scoreMatchCombo(combined, gamesPlayed, partnerCount, minGames, opts);
      combos.push({ pickedIds: picked.slice(), ...sc });
      return;
    }
    const remaining = slotsNeeded - picked.length;
    for (let i = start; i <= ids.length - remaining; i++) {
      picked.push(ids[i]);
      recurse(i + 1);
      picked.pop();
    }
  }
  recurse(0);

  combos.sort(compareScores);
  const best = combos[0];
  const tied = combos.filter(c =>
    c.balance === best.balance && c.max === best.max &&
    c.unmet === best.unmet && c.sum === best.sum &&
    (c.teamImbalance || 0) === (best.teamImbalance || 0) &&
    (c.buddyImbalance || 0) === (best.buddyImbalance || 0) &&
    (c.skillGap || 0) === (best.skillGap || 0)
  );

  if (deterministic) {
    // tie-break แบบคงที่ — เรียง id ที่ sort แล้วเป็น string
    tied.sort((a, b) => {
      const ak = a.pickedIds.slice().sort().join('|');
      const bk = b.pickedIds.slice().sort().join('|');
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
    return tied[0].pickedIds;
  } else {
    return tied[Math.floor(Math.random() * tied.length)].pickedIds;
  }
}

// อัปเดต info badges ใน header ของ match modal — เกมที่ X + ลูกล่าสุด #Y
function updateMatchModalInfo() {
  const allMatches = currentSession?.matches || [];

  // คำนวณ "เกมที่ X"
  // - สร้างใหม่ → matches.length + 1
  // - แก้ไข → index ของเกมนั้น + 1
  let gameNum;
  if (editingMatchId) {
    const idx = allMatches.findIndex(m => m.id === editingMatchId);
    gameNum = idx >= 0 ? idx + 1 : allMatches.length;
  } else {
    gameNum = allMatches.length + 1;
  }
  const gameNumEl = $("matchModalGameNum");
  if (gameNumEl) gameNumEl.textContent = gameNum;

  // หาเบอร์ลูกล่าสุดที่เคยใช้ (max number ในเกมทั้งหมด ยกเว้นเกมที่กำลังแก้)
  const otherMatches = allMatches.filter(m => m.id !== editingMatchId);
  let maxShuttle = null;
  otherMatches.forEach(m => {
    const nums = listShuttleNumbers(m.shuttleNumbers || "");
    nums.forEach(n => {
      if (maxShuttle === null || n > maxShuttle) maxShuttle = n;
    });
  });

  const lastShuttleWrap = $("matchModalLastShuttle");
  const lastShuttleNumEl = $("matchModalLastShuttleNum");
  if (maxShuttle !== null && lastShuttleWrap && lastShuttleNumEl) {
    lastShuttleNumEl.textContent = maxShuttle;
    lastShuttleWrap.classList.remove("hidden");
  } else {
    lastShuttleWrap?.classList.add("hidden");
  }
}

function renderMatchDraft() {
  const allMembers = currentSession.members || [];
  const selectedDiv = $("selectedPlayers");
  const availableDiv = $("availablePlayers");

  // อัปเดตข้อมูลฉลาก (Label) และ placeholder ของช่องกรอกลูกแบดแบบไดนามิกตามโหมดระบบนับลูกแบด
  const isSimple = !!currentSession?.simpleShuttleCount;
  const lblShuttles = $("lblMatchShuttles");
  const fldShuttles = $("fldMatchShuttles");
  const stepperContainer = $("matchShuttlesStepper");
  const stepperDisplay = $("displayMatchShuttles");
  
  if (lblShuttles && fldShuttles) {
    if (stepperContainer) {
      stepperContainer.classList.remove("hidden");
    }
    if (isSimple) {
      lblShuttles.textContent = "จำนวนลูกแบดที่ใช้ในเกมนี้ (กดปุ่มบวกลบได้เลย)";
      fldShuttles.classList.add("hidden");
      if (stepperDisplay) {
        let count = parseInt(fldShuttles.value, 10);
        if (isNaN(count) || count < 0) {
          count = 1;
          fldShuttles.value = "1";
        }
        stepperDisplay.textContent = count;
      }
    } else {
      lblShuttles.textContent = "เบอร์ลูกแบดที่ใช้ในเกมนี้ (ระบุเบอร์ลูก เช่น 1, 2 หรือ 1-3)";
      fldShuttles.classList.remove("hidden");
      fldShuttles.placeholder = "เว้นว่างได้ถ้าไม่ระบุ";
      fldShuttles.type = "text";
      if (stepperDisplay) {
        const nums = listShuttleNumbers(fldShuttles.value);
        stepperDisplay.textContent = nums.length;
      }
    }
  }

  // อัปเดต header info ทุกครั้งที่ render
  updateMatchModalInfo();

  // ----- Compute stats (ยกเว้นเกมที่กำลังแก้ไข) -----
  const matches = (currentSession.matches || []).filter(m => m.id !== editingMatchId);
  const matchesCount = matches.length;

  const gamesPlayed = {};
  const partnerCount = {}; // partnerCount[a][b] = ครั้งที่ a เคยอยู่ทีมเดียวกับ b
  const lastMatchIndex = {};
  allMembers.forEach(m => {
    gamesPlayed[m.id] = 0;
    partnerCount[m.id] = {};
    lastMatchIndex[m.id] = -1;
  });

  matches.forEach((match, idx) => {
    const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
    pIds.forEach(id => {
      if (gamesPlayed[id] !== undefined) {
        gamesPlayed[id]++;
        lastMatchIndex[id] = idx;
      }
    });
    for (let i = 0; i < pIds.length; i++) {
      for (let j = i + 1; j < pIds.length; j++) {
        const a = pIds[i], b = pIds[j];
        if (partnerCount[a] && partnerCount[b]) {
          partnerCount[a][b] = (partnerCount[a][b] || 0) + 1;
          partnerCount[b][a] = (partnerCount[b][a] || 0) + 1;
        }
      }
    }
  });

  // ----- Selected players (กล่องบน) -----
  const useT = useTeams();
  const selectedBox = $("selectedPlayersBox");
  const teamBoxes = $("teamBoxes");

  // Ensure matchDraftPlayers has exactly 4 elements to preserve slot positions
  while (matchDraftPlayers.length < 4) {
    matchDraftPlayers.push(null);
  }

  const activeCount = matchDraftPlayers.filter(Boolean).length;
  $("selPlayerCount").textContent = activeCount;

  if (useT) {
    selectedBox?.classList.add("hidden");
    teamBoxes?.classList.remove("hidden");
    
    // Render Team A Slot 0 & 1
    let teamAHtml = "";
    let countA = 0;
    const teamAPlayers = [];
    [0, 1].forEach(slotIdx => {
      const id = matchDraftPlayers[slotIdx];
      if (id) {
        countA++;
        teamAPlayers.push(id);
        const m = allMembers.find(x => x.id === id);
        if (m) {
          const editSkillBadge = `<button data-act="edit-player-skill" data-player-id="${id}" class="bg-rose-700 hover:bg-rose-800 text-white font-extrabold rounded px-1.5 py-0.5 text-[9px] transition-transform active:scale-95 shrink-0" title="คลิกเพื่อตั้งระดับมือ">${m.skill || '?'}</button>`;
          const isExempt = matchDraftExempts.includes(id);
          teamAHtml += `
            <div class="inline-flex items-center bg-rose-500 text-white text-xs font-semibold rounded-full shadow-sm ring-2 ${isExempt ? 'ring-amber-400 ring-offset-2' : 'ring-rose-300 dark:ring-rose-900/50 ring-offset-1'} pr-1.5 pl-3 py-0.5 gap-1.5 shrink-0">
              <span class="truncate max-w-[65px] ${isExempt ? 'text-amber-200 line-through font-normal' : ''}">${escapeHtml(m.name)}</span>
              ${editSkillBadge}
              <button data-draft-id="${id}" class="hover:bg-rose-600 rounded-full w-4 h-4 flex items-center justify-center font-bold text-[10px] shrink-0" title="เอาออกจากทีม A">✕</button>
            </div>
          `;
        }
      } else {
        // Dotted empty placeholder
        teamAHtml += `<div class="px-3 py-1.5 border border-dashed border-rose-300 dark:border-rose-800 text-rose-400 dark:text-rose-600/70 text-xs rounded-full cursor-default select-none font-medium flex items-center justify-center shrink-0 w-28">ว่าง (Slot ${slotIdx + 1})</div>`;
      }
    });
    $("teamAPlayers").innerHTML = `<div class="flex flex-wrap gap-2">${teamAHtml}</div>`;
    $("teamACount").textContent = countA;
    
    // Render Team B Slot 2 & 3
    let teamBHtml = "";
    let countB = 0;
    const teamBPlayers = [];
    [2, 3].forEach(slotIdx => {
      const id = matchDraftPlayers[slotIdx];
      if (id) {
        countB++;
        teamBPlayers.push(id);
        const m = allMembers.find(x => x.id === id);
        if (m) {
          const editSkillBadge = `<button data-act="edit-player-skill" data-player-id="${id}" class="bg-sky-700 hover:bg-sky-800 text-white font-extrabold rounded px-1.5 py-0.5 text-[9px] transition-transform active:scale-95 shrink-0" title="คลิกเพื่อตั้งระดับมือ">${m.skill || '?'}</button>`;
          const isExempt = matchDraftExempts.includes(id);
          teamBHtml += `
            <div class="inline-flex items-center bg-sky-500 text-white text-xs font-semibold rounded-full shadow-sm ring-2 ${isExempt ? 'ring-amber-400 ring-offset-2' : 'ring-sky-300 dark:ring-sky-900/50 ring-offset-1'} pr-1.5 pl-3 py-0.5 gap-1.5 shrink-0">
              <span class="truncate max-w-[65px] ${isExempt ? 'text-amber-200 line-through font-normal' : ''}">${escapeHtml(m.name)}</span>
              ${editSkillBadge}
              <button data-draft-id="${id}" class="hover:bg-sky-600 rounded-full w-4 h-4 flex items-center justify-center font-bold text-[10px] shrink-0" title="เอาออกจากทีม B">✕</button>
            </div>
          `;
        }
      } else {
        // Dotted empty placeholder
        teamBHtml += `<div class="px-3 py-1.5 border border-dashed border-sky-300 dark:border-sky-800 text-sky-400 dark:text-sky-600/70 text-xs rounded-full cursor-default select-none font-medium flex items-center justify-center shrink-0 w-28">ว่าง (Slot ${slotIdx - 1})</div>`;
      }
    });
    $("teamBPlayers").innerHTML = `<div class="flex flex-wrap gap-2">${teamBHtml}</div>`;
    $("teamBCount").textContent = countB;
    
    // Calculate strengths
    const getTeamStrength = (playerIds) => {
      return playerIds.reduce((sum, id) => sum + getSkillValue(id, allMembers), 0);
    };
    const strA = getTeamStrength(teamAPlayers);
    const strB = getTeamStrength(teamBPlayers);
    
    $("teamAStrength").textContent = `Strength: ${strA.toFixed(1)}`;
    $("teamBStrength").textContent = `Strength: ${strB.toFixed(1)}`;

    // Update team-level exempt buttons UI (บวกลูก: team who carries the fee)
    const isExemptA = teamAPlayers.length > 0 && teamAPlayers.every(id => matchDraftExempts.includes(id));
    const isExemptB = teamBPlayers.length > 0 && teamBPlayers.every(id => matchDraftExempts.includes(id));

    const btnExemptA = $("btnExemptTeamA");
    if (btnExemptA) {
      if (isExemptB) {
        btnExemptA.className = "px-2.5 py-0.5 rounded-full text-[10px] font-extrabold transition-all active:scale-95 bg-amber-400 dark:bg-amber-500 text-slate-900 shadow-sm ring-2 ring-amber-400 dark:ring-amber-500 ring-offset-1 dark:ring-offset-slate-950 flex items-center gap-0.5";
        btnExemptA.title = "ยกเลิก บวกลูกทีม A (ทีม A รับผิดชอบ) 🏸";
      } else {
        btnExemptA.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all active:scale-95 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm flex items-center gap-0.5";
        btnExemptA.title = "บวกลูกทีม A (ทีม A รับผิดชอบค่าลูกทั้งหมด) 🏸";
      }
    }

    const btnExemptB = $("btnExemptTeamB");
    if (btnExemptB) {
      if (isExemptA) {
        btnExemptB.className = "px-2.5 py-0.5 rounded-full text-[10px] font-extrabold transition-all active:scale-95 bg-amber-400 dark:bg-amber-500 text-slate-900 shadow-sm ring-2 ring-amber-400 dark:ring-amber-500 ring-offset-1 dark:ring-offset-slate-950 flex items-center gap-0.5";
        btnExemptB.title = "ยกเลิก บวกลูกทีม B (ทีม B รับผิดชอบ) 🏸";
      } else {
        btnExemptB.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all active:scale-95 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm flex items-center gap-0.5";
        btnExemptB.title = "บวกลูกทีม B (ทีม B รับผิดชอบค่าลูกทั้งหมด) 🏸";
      }
    }
  } else {
    selectedBox?.classList.remove("hidden");
    teamBoxes?.classList.add("hidden");
    
    let selHtml = "";
    matchDraftPlayers.forEach(id => {
      if (!id) return;
      const m = allMembers.find(x => x.id === id);
      if (!m) return;
      const editSkillBadge = `<button data-act="edit-player-skill" data-player-id="${id}" class="bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold rounded px-1.5 py-0.5 text-[9px] transition-transform active:scale-95 shrink-0" title="คลิกเพื่อตั้งระดับมือ">${m.skill || '?'}</button>`;
      const isExempt = matchDraftExempts.includes(id);
      const exemptBtn = `
        <button data-act="toggle-exempt" data-player-id="${id}" class="w-4 h-4 flex items-center justify-center rounded-full text-[10px] transition-transform active:scale-95 shrink-0 ${isExempt ? 'bg-amber-400 text-slate-900 font-extrabold' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}" title="${isExempt ? 'จ่ายปกติ' : 'ยกเว้นค่าลูกเกมนี้'}">
          🏸
        </button>
      `;
      selHtml += `
        <div class="inline-flex items-center bg-emerald-500 text-white text-xs font-semibold rounded-full shadow-sm ring-2 ${isExempt ? 'ring-amber-400 ring-offset-2' : 'ring-emerald-300 dark:ring-emerald-900/50 ring-offset-1'} pr-1.5 pl-3 py-0.5 gap-1.5 shrink-0">
          <span class="truncate max-w-[65px] ${isExempt ? 'text-amber-200 line-through font-normal' : ''}">${escapeHtml(m.name)}</span>
          ${editSkillBadge}
          ${exemptBtn}
          <button data-draft-id="${id}" class="hover:bg-emerald-600 rounded-full w-4 h-4 flex items-center justify-center font-bold text-[10px] shrink-0" title="เอาออก">✕</button>
        </div>
      `;
    });

    if (activeCount === 0) {
      selHtml = `<div class="text-slate-400 text-sm py-4 w-full text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">ยังไม่ได้เลือกผู้เล่น<br><span class="text-xs">แตะชื่อด้านล่างเพื่อดึงลงสนาม</span></div>`;
    } else {
      selHtml = `<div class="flex flex-wrap gap-2">${selHtml}</div>`;
    }
    selectedDiv.innerHTML = selHtml;
  }

  // ----- Available players (รายการแนวตั้ง) -----
  // คนที่จ่ายเงินแล้ว = "ออกจากก๊วน" → ไม่อยู่ใน pool ให้เลือกจัดเกมใหม่
  // (ประวัติเกมเก่ายังมีชื่ออยู่ ไม่กระทบ — เพราะอ่านจาก currentSession.matches โดยตรง)
  const available = allMembers.filter(m => !matchDraftPlayers.includes(m.id) && !m.isPaid);
  const activeAvailable = available.filter(m => !m.isPaused);
  const pausedAvailable = available.filter(m => m.isPaused);

  if (available.length === 0) {
    availableDiv.innerHTML = `<div class="text-slate-400 text-sm py-2 w-full text-center">ไม่มีผู้เล่นเหลือ</div>`;
  } else {
    // Partner overlap กับคนที่เลือกแล้ว (ใช้แสดง pill ในแถว)
    const overlapWithSelected = {}; // { id: { selectedId: count } }
    const totalOverlap = {};
    available.forEach(m => {
      overlapWithSelected[m.id] = {};
      let total = 0;
      matchDraftPlayers.forEach(selId => {
        if (!selId) return;
        const cnt = partnerCount[m.id][selId] || 0;
        if (cnt > 0) overlapWithSelected[m.id][selId] = cnt;
        total += cnt;
      });
      totalOverlap[m.id] = total;
    });

    // ✨ Joint Optimization: หาชุด "คนที่ดีที่สุดที่ควรเพิ่มเข้าที่นั่งที่เหลือ"
    // ใช้ algorithm เดียวกับ Auto Draft → Top ① ② ③ ④ จะตรงกับ Auto Draft เสมอ
    const minGames = Math.min(...allMembers.map(m => gamesPlayed[m.id]));
    const slotsNeeded = 4 - activeCount;
    let topPickIds = new Set();
    if (slotsNeeded > 0) {
      const optimal = findOptimalAddition(
        activeAvailable, matchDraftPlayers.filter(Boolean), slotsNeeded,
        gamesPlayed, partnerCount, minGames, true /* deterministic */,
        { advanceMode: isAdvanceMode(), members: allMembers, useTeams: useTeams() }
      );
      topPickIds = new Set(optimal);
    }

    // เรียงสำหรับการแสดงผล: games asc → totalOverlap asc → restCount desc
    const indivSort = (a, b) => {
      if (gamesPlayed[a.id] !== gamesPlayed[b.id]) return gamesPlayed[a.id] - gamesPlayed[b.id];
      if (totalOverlap[a.id] !== totalOverlap[b.id]) return totalOverlap[a.id] - totalOverlap[b.id];
      const restA = lastMatchIndex[a.id] === -1 ? 9999 : (matchesCount - 1 - lastMatchIndex[a.id]);
      const restB = lastMatchIndex[b.id] === -1 ? 9999 : (matchesCount - 1 - lastMatchIndex[b.id]);
      return restB - restA;
    };

    // แยก Top picks (จาก joint optimization) ออกจาก rest และ paused
    const topPicks = activeAvailable.filter(m => topPickIds.has(m.id)).sort(indivSort);
    const restPicks = activeAvailable.filter(m => !topPickIds.has(m.id)).sort(indivSort);
    const pausedPicks = pausedAvailable.sort(indivSort);

    // map: id → rank ใน top picks (สำหรับ badge ① ② ③ ④)
    const rankMap = new Map();
    topPicks.forEach((m, idx) => rankMap.set(m.id, idx + 1));

    const renderRow = (m) => {
      const isTop = rankMap.has(m.id);
      const rank = rankMap.get(m.id) || null;
      const games = gamesPlayed[m.id];
      const lastIdx = lastMatchIndex[m.id];

      // Rest calculation
      let restHtml;
      if (matchesCount === 0) {
        restHtml = `<span class="text-slate-300 text-sm">—</span>`;
      } else if (lastIdx === -1) {
        // ยังไม่เคยลงเลย — พักมานานกว่าทุกคน
        restHtml = `<span class="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <span class="text-base">🪑</span>
            <span class="font-medium text-slate-700 dark:text-slate-300 tabular-nums">${matchesCount}</span>
          </span>`;
      } else {
        const rested = matchesCount - 1 - lastIdx;
        if (rested === 0) {
          restHtml = `<span class="text-base" title="เพิ่งลงเกมที่แล้ว">🔥</span>`;
        } else {
          restHtml = `<span class="flex items-center gap-1 text-slate-500 dark:text-slate-400" title="พักมา ${rested} เกม">
              <span class="text-base">🪑</span>
              <span class="font-medium text-slate-700 dark:text-slate-300 tabular-nums">${rested}</span>
            </span>`;
        }
      }

      // Rank badge — top 4 only, or pause icon for paused members
      const rankBadge = isTop
        ? `<span class="w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold bg-emerald-500 text-white flex-shrink-0">${rank}</span>`
        : (m.isPaused
            ? `<span class="w-6 h-6 flex items-center justify-center text-sm flex-shrink-0" title="พักคิวชั่วคราว">⏸️</span>`
            : `<span class="w-6 h-6 flex-shrink-0"></span>`);

      // Partner pills — แสดงเฉพาะคนที่เคยจับคู่กับคนที่ selected
      let partnerHtml = "";
      const partnerEntries = Object.entries(overlapWithSelected[m.id]);
      if (partnerEntries.length > 0) {
        const pills = partnerEntries
          .sort((a, b) => b[1] - a[1]) // มากสุดก่อน
          .map(([selId, cnt]) => {
            const selMember = allMembers.find(x => x.id === selId);
            const partnerName = selMember ? selMember.name : "?";
            const color = cnt >= 3
              ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400"
              : cnt === 2
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300"
                : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
            return `<span class="${color} px-1.5 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap">${escapeHtml(partnerName)}·${cnt}</span>`;
          })
          .join('');
        partnerHtml = `<div class="flex flex-wrap items-center gap-1 w-full pl-8 mt-1.5">${pills}</div>`;
      }

      const rowClass = isTop
        ? "bg-emerald-50/50 dark:bg-emerald-900/10 border-l-4 border-emerald-500"
        : (m.isPaused
            ? "bg-amber-50/20 dark:bg-amber-950/10 border-l-4 border-amber-400/50 opacity-70"
            : "bg-white dark:bg-slate-800 border-l-4 border-transparent");

      const nameClass = isTop
        ? "font-semibold text-slate-800 dark:text-slate-100"
        : (m.isPaused
            ? "font-medium text-slate-500 dark:text-slate-400"
            : "font-medium text-slate-700 dark:text-slate-300");

      const editSkillBadge = `<button data-act="edit-player-skill" data-player-id="${m.id}" class="text-[9px] px-1.5 py-0.5 rounded transition-all active:scale-95 shrink-0 ${m.skill ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-extrabold' : 'border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-500 dark:text-indigo-400 font-bold bg-white dark:bg-slate-900 hover:border-indigo-500 hover:text-indigo-600'}" title="คลิกเพื่อตั้งระดับมือ">
            ${m.skill ? m.skill : '+ ระดับมือ'}
          </button>`;

      return `
        <div class="w-full px-3 py-2 flex flex-col gap-1 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors ${rowClass}">
          <div class="w-full flex items-center justify-between gap-2">
            <button data-draft-id="${m.id}" class="flex-1 text-left flex items-center gap-2 min-w-0 py-1">
              ${rankBadge}
              <span class="${nameClass} truncate">${escapeHtml(m.name)}</span>
              ${(() => {
                const buddy = m.buddyId 
                  ? allMembers.find(x => x.id === m.buddyId) 
                  : allMembers.find(x => x.buddyId === m.id);
                if (buddy) {
                  return `<span class="text-[9px] px-1.5 py-0.25 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-extrabold rounded shrink-0">🤝 ${escapeHtml(buddy.name)}</span>`;
                }
                return "";
              })()}
              ${m.excludeAllShuttles ? `<span class="text-[9px] px-1.5 py-0.25 bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 font-extrabold rounded shrink-0">🏸 ฟรีค่าลูก</span>` : ''}
              ${(!m.excludeAllShuttles && m.shuttlesExcluded > 0) ? `<span class="text-[9px] px-1.5 py-0.25 bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 font-extrabold rounded shrink-0">🏸 ยกเว้น ${m.shuttlesExcluded} ลูก</span>` : ''}
            </button>
            
            <div class="flex items-center gap-1.5 shrink-0">
              ${editSkillBadge}
              
              <span class="flex items-center gap-0.5 text-xs text-slate-400">
                <span>🏸</span>
                <span class="font-bold text-slate-700 dark:text-slate-300 tabular-nums w-4 text-right">${games}</span>
              </span>
              <span class="flex items-center text-xs shrink-0">${restHtml}</span>
            </div>
          </div>
          ${partnerHtml}
        </div>
      `;
    };

    const topRowsHtml = topPicks.map(renderRow).join('');
    const restRowsHtml = restPicks.map(renderRow).join('');
    const pausedRowsHtml = pausedPicks.map(renderRow).join('');

    // ถ้ามีทั้ง Top และ Rest → ใส่ section header เล็กๆ คั่น
    const restSection = restPicks.length > 0
      ? `<div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 bg-slate-50 dark:bg-slate-900/50 uppercase tracking-wide border-t border-slate-200 dark:border-slate-700">อื่นๆ</div>${restRowsHtml}`
      : '';

    // ถ้ามีคนถูกพักคิว → แสดง section พักคิว
    const pausedSection = pausedPicks.length > 0
      ? `<div class="px-3 py-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-500 bg-amber-50/50 dark:bg-amber-950/20 uppercase tracking-wide border-t border-amber-200 dark:border-amber-900/30 flex items-center gap-1"><span>⏸️</span> สมาชิกที่พักคิว</div>${pausedRowsHtml}`
      : '';

    availableDiv.innerHTML = `<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div class="divide-y divide-slate-100">${topRowsHtml}</div>
      ${restSection ? `<div class="divide-y divide-slate-100">${restSection}</div>` : ''}
      ${pausedSection ? `<div class="divide-y divide-slate-100">${pausedSection}</div>` : ''}
    </div>`;
  }
  
  $("btnSaveMatch").disabled = activeCount !== 4;
  $("btnSaveMatch").className = activeCount === 4
    ? "text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg font-bold shadow-sm flex items-center gap-1 transition-all active:scale-95 shrink-0"
    : "text-xs bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 px-2.5 py-1.5 rounded-lg font-bold shrink-0 cursor-not-allowed";

  $("matchModal").querySelectorAll("button[data-draft-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.draftId;
      if (matchDraftPlayers.includes(pid)) {
        const idx = matchDraftPlayers.indexOf(pid);
        if (idx !== -1) {
          matchDraftPlayers[idx] = null;
          matchDraftExempts = matchDraftExempts.filter(id => id !== pid);
        }
      } else {
        const m = allMembers.find(x => x.id === pid);
        if (!m) return;
        
        let targetIdx = -1;
        if (useT) {
          if (m.team === "A") {
            if (matchDraftPlayers[0] === null) targetIdx = 0;
            else if (matchDraftPlayers[1] === null) targetIdx = 1;
            else if (matchDraftPlayers[2] === null) targetIdx = 2;
            else if (matchDraftPlayers[3] === null) targetIdx = 3;
          } else if (m.team === "B") {
            if (matchDraftPlayers[2] === null) targetIdx = 2;
            else if (matchDraftPlayers[3] === null) targetIdx = 3;
            else if (matchDraftPlayers[0] === null) targetIdx = 0;
            else if (matchDraftPlayers[1] === null) targetIdx = 1;
          } else {
            targetIdx = matchDraftPlayers.findIndex(x => x === null);
          }
        } else {
          targetIdx = matchDraftPlayers.findIndex(x => x === null);
        }
        
        if (targetIdx !== -1) {
          matchDraftPlayers[targetIdx] = pid;
        } else {
          return toast("เลือกได้สูงสุด 4 คนครับ");
        }
      }
      renderMatchDraft();
    });
  });

  // Wire up "toggle-exempt" buttons inside Match Modal
  $("matchModal").querySelectorAll("button[data-act='toggle-exempt']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // ป้องกันการไปโดนคลิกถอดถอนผู้เล่นหลัก
      const pid = btn.dataset.playerId;
      if (matchDraftExempts.includes(pid)) {
        matchDraftExempts = matchDraftExempts.filter(id => id !== pid);
      } else {
        matchDraftExempts.push(pid);
      }
      renderMatchDraft();
    });
  });

  // Wire up "edit-player-skill" buttons inside Match Modal
  $("matchModal").querySelectorAll("button[data-act='edit-player-skill']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent bubbling up to drafting event handlers
      const pid = btn.dataset.playerId;
      const idx = allMembers.findIndex(x => x.id === pid);
      if (idx !== -1) {
        openPlayerSettingsModal(idx, true);
      }
    });
  });
}

$("btnCancelMatch").addEventListener("click", () => $("matchModal").classList.add("hidden"));
$("matchModal").addEventListener("click", e => { if (e.target.id === "matchModal") $("matchModal").classList.add("hidden"); });

$("btnAutoSplit")?.addEventListener("click", () => {
  const original = [...matchDraftPlayers];
  const players = matchDraftPlayers.filter(Boolean);
  if (players.length !== 4) return toast("กรุณาเลือกผู้เล่นให้ครบ 4 คนก่อนครับ");
  
  // Shuffle until we get a different pairing/placement
  let attempts = 0;
  while (attempts < 10) {
    // Fisher-Yates shuffle
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
    
    // Check if it's different from the original order
    const isDifferent = players.some((p, idx) => p !== original[idx]);
    if (isDifferent) break;
    attempts++;
  }
  
  matchDraftPlayers = players;
  renderMatchDraft();
  toast("สุ่มสลับตำแหน่ง/ทีมเรียบร้อยครับ 🎲");
});

// ---------- Auto Draft (สุ่มจัดคิว) ----------
const autoDraftBtn = $("btnAutoDraft");
if (autoDraftBtn) {
  autoDraftBtn.addEventListener("click", () => {
    const allMembers = (currentSession && currentSession.members) || [];
    // คนที่จ่ายเงินแล้ว หรือพักคิวอยู่ = ไม่อยู่ใน pool — ใช้เฉพาะคนที่ยังไม่จ่ายและไม่พักคิว
    const eligibleMembers = allMembers.filter(m => !m.isPaid && !m.isPaused);
    if (eligibleMembers.length < 4) {
      return toast("ต้องมีสมาชิกที่พร้อมเล่น (ยังไม่จ่ายและไม่พักคิว) อย่างน้อย 4 คน");
    }

    try {
      const allMatches = (currentSession.matches || []).filter(m => m.id !== editingMatchId);
      const gamesPlayed = {};
      const partnerCount = {};      // นับ "เคยอยู่ในเกมเดียวกัน" (รวม opponents)
      const teammateCount = {};     // นับ "เคยเป็นเพื่อนร่วมทีม" (ไม่รวม opponents)
      // ใช้ allMembers สำหรับ initialization (เพื่อให้ score คำนวณถูกต้องถ้ามี edge case
      // ที่คนเคยจ่ายแล้วถูก unmark หลังจัดเกม) — แต่ pool ที่เลือกจะใช้ eligibleMembers
      allMembers.forEach(m => {
        gamesPlayed[m.id] = 0;
        partnerCount[m.id] = {};
        teammateCount[m.id] = {};
      });

      allMatches.forEach(match => {
        const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
        pIds.forEach(id => { if (gamesPlayed[id] !== undefined) gamesPlayed[id]++; });

        // partnerCount = นับทุกคู่ในเกมเดียวกัน (ใช้สำหรับ findOptimalAddition)
        for (let i = 0; i < pIds.length; i++) {
          for (let j = i + 1; j < pIds.length; j++) {
            const a = pIds[i], b = pIds[j];
            if (partnerCount[a] && partnerCount[b]) {
              partnerCount[a][b] = (partnerCount[a][b] || 0) + 1;
              partnerCount[b][a] = (partnerCount[b][a] || 0) + 1;
            }
          }
        }

        // teammateCount = นับเฉพาะคู่ที่อยู่ทีมเดียวกัน (positions 0-1 = ทีม A, 2-3 = ทีม B)
        // ใช้สำหรับ findBestTeamSplit เพื่อให้รู้ว่าใครเคยเป็นคู่ทีมกันบ้าง
        if (pIds.length === 4) {
          [[0, 1], [2, 3]].forEach(([i, j]) => {
            const a = pIds[i], b = pIds[j];
            if (teammateCount[a] && teammateCount[b]) {
              teammateCount[a][b] = (teammateCount[a][b] || 0) + 1;
              teammateCount[b][a] = (teammateCount[b][a] || 0) + 1;
            }
          });
        }
      });

      // minGames คำนวณเฉพาะคนที่ eligible — ไม่งั้นคนจ่ายแล้วที่เล่นน้อยจะดึง balance ผิด
      const minGames = Math.min(...eligibleMembers.map(m => gamesPlayed[m.id]));
      const picked = findOptimalAddition(eligibleMembers, [], 4, gamesPlayed, partnerCount, minGames, false, {
        advanceMode: isAdvanceMode(),
        members: allMembers,
        useTeams: useTeams()
      });

      if (picked && picked.length === 4) {
        if (useTeams()) {
          // ส่ง teammateCount (ไม่ใช่ partnerCount!) เข้าไป
          // เพราะ findBestTeamSplit ต้องการรู้ "ใครเคยเป็นเพื่อนร่วมทีม" ไม่ใช่ "ใครเคยอยู่เกมเดียวกัน"
          const split = findBestTeamSplit(picked, allMembers, teammateCount);
          matchDraftPlayers = [split.teamA[0] || null, split.teamA[1] || null, split.teamB[0] || null, split.teamB[1] || null];
        } else {
          matchDraftPlayers = [...picked];
        }
        renderMatchDraft();
        toast("สุ่มจัดคิวเรียบร้อย ✨");
      }
    } catch (err) {
      console.error("[AutoDraft] Error:", err);
      toast("เกิดข้อผิดพลาดในการสุ่ม");
    }
  });
}

$("btnSaveMatch").addEventListener("click", () => {
  if (matchDraftPlayers.filter(Boolean).length !== 4) return alert("กรุณาเลือกผู้เล่นให้ครบ 4 คน");

  const shuttles = $("fldMatchShuttles").value.trim();
  const matches = [...(currentSession.matches || [])];

  // ตรวจสอบเบอร์ลูกแบดซ้ำ
  const newNumbers = listShuttleNumbers(shuttles);
  if (newNumbers.length > 0) {
    // 1) เบอร์ซ้ำในเกมเดียวกัน
    const seen = new Set();
    const dupesInThis = new Set();
    newNumbers.forEach(n => {
      if (seen.has(n)) dupesInThis.add(n);
      seen.add(n);
    });
    if (dupesInThis.size > 0) {
      return alert(`เบอร์ลูกแบดซ้ำในเกมนี้: ${[...dupesInThis].sort((a, b) => a - b).join(", ")}`);
    }

    // 2) เบอร์ซ้ำกับเกมอื่น (ยกเว้นเกมที่กำลังแก้ไขอยู่)
    const otherUsed = new Map(); // number -> matchIndex (1-based)
    matches.forEach((m, i) => {
      if (m.id === editingMatchId) return;
      listShuttleNumbers(m.shuttleNumbers || "").forEach(n => {
        if (!otherUsed.has(n)) otherUsed.set(n, i + 1);
      });
    });
    const conflicts = [...new Set(newNumbers)].filter(n => otherUsed.has(n));
    if (conflicts.length > 0) {
      const sorted = conflicts.sort((a, b) => a - b);
      const detail = sorted.map(n => `${n} (เกมที่ ${otherUsed.get(n)})`).join(", ");
      return alert(`เบอร์ลูกแบดถูกใช้ในเกมอื่นแล้ว: ${detail}`);
    }
  }

  const finalDraftPlayers = [...matchDraftPlayers];
  const finalDraftExempts = [...matchDraftExempts];

  if (editingMatchId) {
    const idx = matches.findIndex(x => x.id === editingMatchId);
    if (idx !== -1) {
      matches[idx] = { ...matches[idx], players: finalDraftPlayers, shuttleNumbers: shuttles, exemptPlayers: finalDraftExempts };
      delete matches[idx].a1; delete matches[idx].a2; delete matches[idx].b1; delete matches[idx].b2;
    }
  } else {
    matches.push({ id: uid(), players: finalDraftPlayers, shuttleNumbers: shuttles, exemptPlayers: finalDraftExempts });
  }

  saveSession({ matches });
  $("matchModal").classList.add("hidden");
});

$("btnViewStats").addEventListener("click", () => {
  const members = currentSession.members || [];
  const matches = currentSession.matches || [];

  // playedWith[id1][id2] = จำนวนเกมที่ id1 และ id2 อยู่ในเกมเดียวกัน
  const stats = {};
  members.forEach(m => { stats[m.id] = { name: m.name, games: 0, playedWith: {} }; });

  matches.forEach(m => {
    const p = m.players || [m.a1, m.a2, m.b1, m.b2].filter(Boolean);
    p.forEach(id1 => {
      if (!stats[id1]) return;
      stats[id1].games++;
      p.forEach(id2 => {
        if (id1 !== id2 && stats[id2]) {
          stats[id1].playedWith[id2] = (stats[id1].playedWith[id2] || 0) + 1;
        }
      });
    });
  });

  // เรียงจากคนที่เล่นน้อยที่สุดก่อน (เพื่อเห็นว่าใครต้องลงเล่นเพิ่ม)
  const sortedIds = Object.keys(stats).sort((a, b) => stats[a].games - stats[b].games);

  let html = "";
  if (matches.length === 0) {
    html = `<p class="text-center text-slate-500 dark:text-slate-400 text-sm py-4">ยังไม่มีข้อมูลสถิติ เริ่มจัดเกมได้เลย</p>`;
  } else {
    sortedIds.forEach(id => {
      const st = stats[id];

      // เรียงคนที่เล่นด้วยจากมาก -> น้อย
      const playedEntries = Object.entries(st.playedWith).sort((a, b) => b[1] - a[1]);

      let chipsHtml = "";
      if (playedEntries.length === 0) {
        chipsHtml = `<span class="text-slate-400 italic">ยังไม่ได้ลงเล่น</span>`;
      } else {
        chipsHtml = playedEntries.map(([pid, count]) => {
          const name = stats[pid] ? stats[pid].name : "?";
          // สีของ badge: เล่นด้วยกันมาก = เขียวเข้ม, น้อย = เทา
          const badgeColor = count >= 3
            ? "bg-emerald-500 text-white"
            : count === 2
              ? "bg-emerald-300 text-emerald-900"
              : "bg-slate-200 text-slate-700";
          return `<span class="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-2.5 py-1 text-xs">
            <span class="text-slate-700 dark:text-slate-300">${escapeHtml(name)}</span>
            <span class="${badgeColor} text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center">${count}</span>
          </span>`;
        }).join("");
      }

      html += `
        <div class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm">
          <div class="flex justify-between items-center mb-2">
            <span class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(st.name)}</span>
            <span class="bg-emerald-100 text-emerald-800 dark:text-emerald-300 text-xs px-2.5 py-1 rounded-full font-semibold">🏸 ${st.games} เกม</span>
          </div>
          <div class="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wide font-semibold">เคยเล่นด้วยกัน</div>
          <div class="flex flex-wrap gap-1.5">
            ${chipsHtml}
          </div>
        </div>
      `;
    });
  }
  $("statsContent").innerHTML = html;
  $("statsModal").classList.remove("hidden");
});

$("btnCloseStats").addEventListener("click", () => $("statsModal").classList.add("hidden"));
$("statsModal").addEventListener("click", e => { if (e.target.id === "statsModal") $("statsModal").classList.add("hidden"); });

// Bind Audit Log Modal Events
$("btnViewAuditLog")?.addEventListener("click", () => {
  renderAuditLog();
  $("auditLogModal").classList.remove("hidden");
});
$("btnCloseAuditLog")?.addEventListener("click", () => $("auditLogModal").classList.add("hidden"));
$("btnCloseAuditLogFooter")?.addEventListener("click", () => $("auditLogModal").classList.add("hidden"));
$("auditLogModal")?.addEventListener("click", e => { if (e.target.id === "auditLogModal") $("auditLogModal").classList.add("hidden"); });

// ============================================================
// PAYMENT QR + SLIP UPLOAD
// ============================================================

// ---------- QR decoding (jsQR) ----------
// อ่าน QR จากไฟล์รูป (สลิปที่ user upload)
async function decodeQRFromFile(file) {
  return new Promise((resolve) => {
    if (typeof window.jsQR !== "function") return resolve(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Downscale image if too large (max 1000px on either side) to prevent out-of-memory crashes on iOS WebViews/LINE
        let width = img.width;
        let height = img.height;
        const maxDim = 1000;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(imageData.data, imageData.width, imageData.height);
          resolve(code ? code.data : null);
        } catch (err) {
          console.warn("[decodeQR] failed:", err);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Parse EMVCo TLV string เพื่อหายอดเงิน (tag 54)
// คืน number ถ้าเจอ, null ถ้าไม่ใช่ format นี้หรือไม่มี tag 54
function parseAmountFromEMVQR(qrString) {
  if (!qrString || typeof qrString !== "string") return null;
  // EMVCo TLV ต้องเริ่มด้วย "0002" (Payload Format Indicator tag) + "01" (value length=2)
  // ตามด้วย "01" (value = format version)
  if (!/^00020[12]/.test(qrString)) return null;

  let pos = 0;
  let safetyCounter = 0;
  while (pos < qrString.length - 4 && safetyCounter < 100) {
    safetyCounter++;
    const tag = qrString.substr(pos, 2);
    const lenStr = qrString.substr(pos + 2, 2);
    const len = parseInt(lenStr, 10);
    if (isNaN(len) || len < 0) break;
    const value = qrString.substr(pos + 4, len);
    if (tag === "54") {
      // tag 54 = Transaction Amount
      const amount = parseFloat(value);
      return isNaN(amount) ? null : amount;
    }
    pos += 4 + len;
  }
  return null;
}

// อ่าน QR จาก video frame (live camera scan)
function decodeQRFromVideoFrame(video, canvas) {
  if (typeof window.jsQR !== "function") return null;
  if (!video.videoWidth || !video.videoHeight) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(imageData.data, imageData.width, imageData.height);
  } catch (err) {
    return null;
  }
}

// ---------- Image compression ----------
// ย่อรูปด้วย HTML5 Canvas → คืน base64 (JPEG)
async function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("โหลดรูปไม่สำเร็จ"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // 🚀 Adaptive compression — ถ้ายังใหญ่เกิน 700KB → ลด quality ไปเรื่อยๆ
        const TARGET_SIZE = 700 * 1024;  // 700KB
        const MIN_QUALITY = 0.3;
        let currentQuality = quality;
        let dataUrl = canvas.toDataURL("image/jpeg", currentQuality);

        // ขนาด data URL ≈ base64 size * 0.75 ~= file size
        while (dataUrl.length * 0.75 > TARGET_SIZE && currentQuality > MIN_QUALITY) {
          currentQuality = Math.max(MIN_QUALITY, currentQuality - 0.1);
          dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
        }
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Payment Modal (Join View + Manage View Show-QR) ----------
let paymentMemberIdx = null;
let paymentQRDataUrl = null;        // เก็บ dataURL ปัจจุบันสำหรับปุ่ม Download
let paymentQRMemberName = null;

async function openPaymentModal(memberIdx) {
  if (!currentSession) return;
  const members = currentSession.members || [];
  const m = members[memberIdx];
  if (!m) return;

  paymentMemberIdx = memberIdx;
  paymentQRMemberName = m.name || "member";
  paymentQRDataUrl = null;

  const totals = calcSessionTotals(currentSession);
  const cost = totals.perMember?.[memberIdx] ?? 0;

  $("paymentMemberName").textContent = m.name || "—";
  $("paymentAmount").textContent = fmt(cost) + " ฿";

  // Reset UI
  $("paymentSlipInput").value = "";
  $("paymentUploadLabel").classList.remove("hidden");
  $("paymentUploading").classList.add("hidden");
  $("paymentModal").classList.remove("hidden");

  const wrap = $("paymentQRWrap");
  const noQR = $("paymentNoQR");
  const canvas = $("paymentQRCanvas");
  const imgEl = $("paymentQRImg");
  const modeEl = $("paymentQRMode");
  const btnDownload = $("btnDownloadPaymentQR");

  // ดึง PromptPay ID (โหลด defaults ถ้ายังไม่โหลด)
  if (!globalDefaultsLoaded) {
    try { await loadGlobalDefaults(); } catch (_) {}
  }
  const cfg = getAdminPromptPayConfig();

  // === 1) Dynamic QR (PromptPay) — preferred ===
  if (cfg.id && cost > 0) {
    try {
      // Show canvas, hide img during generation so the browserWebView/LINE WebView paints it 100% successfully
      if (canvas) {
        canvas.classList.remove("hidden");
        imgEl?.classList.add("hidden");
      }

      const dataUrl = await renderPromptPayQR(canvas, cfg.id, cost, cfg.type);
      if (!dataUrl) throw new Error("payload invalid");

      // ALWAYS set the download URL to the local base64 Data URL so programmatic downloads work 100% natively without opening new tabs!
      paymentQRDataUrl = dataUrl;

      // Set image source to base64 Data URL, show image, and hide raw canvas
      if (imgEl) {
        imgEl.src = dataUrl;
        imgEl.classList.remove("hidden");
      }
      if (canvas) {
        canvas.classList.add("hidden");
      }

      if (modeEl) modeEl.textContent = "📱 สแกน QR — ยอดเงินถูกล็อกอัตโนมัติ ✓";
      if (btnDownload) btnDownload.classList.remove("hidden");
      wrap?.classList.remove("hidden");
      noQR?.classList.add("hidden");
      return;
    } catch (err) {
      console.warn("[Payment] Dynamic QR failed, fallback:", err);
      // continue to fallback
    }
  }

  // === 2) Fallback: Static bankQR (per-session image) ===
  if (currentSession.bankQR) {
    if (canvas) canvas.classList.add("hidden");
    if (imgEl) {
      imgEl.src = currentSession.bankQR;
      imgEl.classList.remove("hidden");
    }
    if (modeEl) modeEl.textContent = "📱 สแกน QR — กรุณาใส่ยอดเงินเอง";
    if (btnDownload) btnDownload.classList.add("hidden");  // ไม่ให้โหลด static (มีปุ่มแยกใน Manage อยู่แล้ว)
    wrap?.classList.remove("hidden");
    noQR?.classList.add("hidden");
    return;
  }

  // === 3) No QR at all ===
  wrap?.classList.add("hidden");
  noQR?.classList.remove("hidden");
}

// Download dynamic QR ลงเครื่อง
$("btnDownloadPaymentQR")?.addEventListener("click", () => {
  if (!paymentQRDataUrl) {
    toast("⚠️ ยังไม่มี QR ให้บันทึก");
    return;
  }

  // Intercept if running inside LINE in-app browser to guide user to open in Chrome/Safari
  const isLine = /Line/i.test(navigator.userAgent);
  if (isLine) {
    alert(
      "⚠️ แอป LINE ไม่รองรับการดาวน์โหลดรูปภาพโดยตรง!\n\n" +
      "กรุณาเปิดลิงก์นี้ในเบราว์เซอร์ปกติเพื่อบันทึกรูปภาพ:\n" +
      "• สำหรับ iPhone (iOS): แตะไอคอนรูปเข็มทิศ 🧭 ที่มุมขวาล่างสุด เพื่อเปิดใน Safari\n" +
      "• สำหรับ Android: แตะปุ่มจุด 3 จุด ┇ ที่มุมขวาบนสุด แล้วเลือก 'เปิดด้วยเบราว์เซอร์อื่น' หรือ 'เปิดใน Chrome'"
    );
    return;
  }

  const safeName = (paymentQRMemberName || "member").replace(/[^a-zA-Z0-9ก-๙]/g, "_").slice(0, 25);
  const a = document.createElement("a");
  a.href = paymentQRDataUrl;
  a.download = `PromptPay_${safeName}_${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast("💾 บันทึก QR แล้ว");
});

function closePaymentModal() {
  $("paymentModal").classList.add("hidden");
  paymentMemberIdx = null;
}

$("btnClosePaymentModal")?.addEventListener("click", closePaymentModal);
$("paymentModal")?.addEventListener("click", (e) => {
  if (e.target.id === "paymentModal") closePaymentModal();
});

$("paymentSlipInput")?.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || paymentMemberIdx === null || !currentSession || !currentSessionId) return;

  $("paymentUploadLabel").classList.add("hidden");
  $("paymentUploading").classList.remove("hidden");

  try {
    // 1) decode QR จากไฟล์ "ต้นฉบับ" (ก่อน compress) — ความละเอียดเต็มอ่านง่ายกว่า
    const qrData = await decodeQRFromFile(file);

    // 2) เช็คยอดเงินจาก QR (EMVCo tag 54)
    const totals = calcSessionTotals(currentSession);
    const expectedAmount = totals.perMember?.[paymentMemberIdx] ?? 0;
    const qrAmount = parseAmountFromEMVQR(qrData);

    // ตรวจสอบ 3 case:
    // (a) QR มียอด + ยอดไม่ตรง → Reject ทันที
    // (b) QR ไม่มียอด → confirm กับ user
    // (c) QR มียอด + ตรง → ผ่านอัตโนมัติ
    if (qrAmount !== null && Math.abs(qrAmount - expectedAmount) > 0.01) {
      alert(`❌ ยอดเงินในสลิปไม่ตรง\n\n• ยอดในสลิป: ${qrAmount.toFixed(2)} ฿\n• ยอดที่ต้องจ่าย: ${expectedAmount.toFixed(2)} ฿\n\nกรุณาตรวจสอบและส่งสลิปที่ถูกต้อง`);
      $("paymentUploadLabel").classList.remove("hidden");
      $("paymentUploading").classList.add("hidden");
      $("paymentSlipInput").value = "";
      return;
    }

    if (!qrData) {
      const proceed = confirm("⚠️ ไม่พบ QR Code ในรูปนี้\n\nอาจเป็นเพราะ:\n• รูปไม่ใช่สลิป\n• QR เบลอ/ไม่ชัด\n• สลิปไม่มี QR (ธนาคารบางที่)\n\nยืนยันส่งสลิปนี้?");
      if (!proceed) {
        $("paymentUploadLabel").classList.remove("hidden");
        $("paymentUploading").classList.add("hidden");
        $("paymentSlipInput").value = "";
        return;
      }
    } else if (qrAmount === null) {
      // มี QR แต่ไม่มียอด (URL หรือ format อื่น) — confirm
      const proceed = confirm(`คุณยืนยันว่าโอน ${expectedAmount.toFixed(2)} ฿ ถูกต้องแล้ว?`);
      if (!proceed) {
        $("paymentUploadLabel").classList.remove("hidden");
        $("paymentUploading").classList.add("hidden");
        $("paymentSlipInput").value = "";
        return;
      }
    }

    // 3) compress เพื่อบันทึก — แยกเก็บลง receipts subcollection (กัน main doc เต็ม 1MB)
    const base64 = await compressImage(file, 600, 0.55);

    // 4) บันทึกรูปสลิปลง subcollection (sessions/{id}/receipts/{memberId})
    const targetId = currentSession.members?.[paymentMemberIdx]?.id;
    if (!targetId) throw new Error("ไม่พบ memberId");

    const receiptSaved = await saveReceipt(currentSessionId, targetId, base64);
    if (!receiptSaved) {
      throw new Error("บันทึกรูปสลิปไม่สำเร็จ");
    }

    // 5) Auto-tick: อัปเดต member status (ไม่เก็บรูปใน main doc)
    const newMembers = (currentSession.members || []).map(m =>
      m.id === targetId
        ? {
            ...m,
            isPaid: true,
            hasReceipt: true,             // flag → admin เปิดดูสลิปจาก subcollection
            slipQR: qrData || null,
            slipQRAmount: qrAmount !== null ? qrAmount : null
          }
        : m
    );
    await updateDoc(doc(db, "sessions", currentSessionId), {
      members: newMembers,
      updatedAt: serverTimestamp()
    });

    if (qrAmount !== null) {
      toast(`✓ จ่ายเงินเรียบร้อย (ยอดตรง ${qrAmount.toFixed(2)} ฿ ✓)`);
    } else if (qrData) {
      toast("✓ จ่ายเงินเรียบร้อย (พบ QR ✓)");
    } else {
      toast("✓ จ่ายเงินเรียบร้อย");
    }
    closePaymentModal();
  } catch (err) {
    console.error("[Payment] Upload error:", err);
    toast("เกิดข้อผิดพลาดในการอัปโหลด: " + (err.message || err));
    $("paymentUploadLabel").classList.remove("hidden");
    $("paymentUploading").classList.add("hidden");
  }
});

// ---------- Slip Viewer Modal (Admin View) ----------
// signature: openSlipViewer(memberId, memberName, legacySlipImage, slipQR, slipQRAmount)
// - legacySlipImage = รูปที่อาจเก็บไว้ใน member doc (back-compat); ใหม่จะดึงจาก receipts subcollection
async function openSlipViewer(memberId, memberName, legacySlipImage, slipQR, slipQRAmount) {
  $("slipViewerName").textContent = memberName || "—";
  const imgEl = $("slipViewerImg");

  // 1) ใช้ legacy slipImage ก่อน (ถ้ามี) เพื่อโชว์เร็ว
  if (legacySlipImage) {
    imgEl.src = legacySlipImage;
    imgEl.classList.remove("hidden");
  } else {
    imgEl.src = "";
    imgEl.classList.add("hidden");
  }

  $("slipViewerModal").classList.remove("hidden");

  // 2) ดึงรูปจาก receipts subcollection (ใหม่)
  if (memberId && currentSessionId) {
    try {
      const receipt = await getReceipt(currentSessionId, memberId);
      if (receipt && receipt.imageBase64) {
        imgEl.src = receipt.imageBase64;
        imgEl.classList.remove("hidden");
      } else if (!legacySlipImage) {
        // ไม่มีทั้งคู่ — โชว์ข้อความ
        imgEl.classList.add("hidden");
      }
    } catch (err) {
      console.warn("[SlipViewer] fetch receipt failed:", err);
    }
  }
  // แสดง QR text (ถ้ามี) ใต้รูป
  let qrInfoEl = $("slipViewerQRInfo");
  if (!qrInfoEl) {
    qrInfoEl = document.createElement("div");
    qrInfoEl.id = "slipViewerQRInfo";
    qrInfoEl.className = "mt-3 p-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/50 rounded-lg text-xs break-all";
    imgEl.parentNode.insertBefore(qrInfoEl, imgEl.nextSibling);
  }
  if (slipQR) {
    const amountBadge = (slipQRAmount !== null && slipQRAmount !== undefined)
      ? `<div class="mb-2 inline-block bg-emerald-200 dark:bg-emerald-800/50 text-emerald-900 dark:text-emerald-100 px-2 py-1 rounded font-bold text-sm">💰 ยอดในสลิป: ${Number(slipQRAmount).toFixed(2)} ฿ ✓</div>`
      : "";
    qrInfoEl.innerHTML = `
      <div class="font-bold text-emerald-700 dark:text-emerald-300 mb-1.5">🔍 ข้อมูล QR ที่อ่านได้</div>
      ${amountBadge}
      <div class="font-mono text-emerald-900 dark:text-emerald-200 text-[10px]">${escapeHtml(slipQR)}</div>
      <div class="text-[10px] text-emerald-600 dark:text-emerald-400 mt-2">💡 ใช้ link/code นี้เช็คกับธนาคารเพื่อ verify สลิป</div>`;
    qrInfoEl.classList.remove("hidden");
  } else {
    qrInfoEl.classList.add("hidden");
  }
  $("slipViewerModal").classList.remove("hidden");
}

function closeSlipViewer() {
  $("slipViewerModal").classList.add("hidden");
  $("slipViewerImg").src = "";
}

$("btnCloseSlipViewer")?.addEventListener("click", closeSlipViewer);
$("btnCloseSlipViewer2")?.addEventListener("click", closeSlipViewer);
$("slipViewerModal")?.addEventListener("click", (e) => {
  if (e.target.id === "slipViewerModal") closeSlipViewer();
});

$("btnDownloadSlip")?.addEventListener("click", () => {
  const img = $("slipViewerImg");
  const name = $("slipViewerName").textContent || "slip";
  if (!img.src) return;
  const a = document.createElement("a");
  a.href = img.src;
  a.download = `slip_${name}_${Date.now()}.jpg`;
  a.click();
});

// ---------- Camera QR Scanner (admin/manager scan member's slip QR live) ----------
let cameraStream = null;
let cameraScanInterval = null;
let cameraScanTargetId = null;

async function openCameraScan(memberIdx) {
  if (!currentSession) return;
  const member = currentSession.members?.[memberIdx];
  if (!member) return;

  if (typeof window.jsQR !== "function") {
    return toast("⚠️ Library อ่าน QR โหลดไม่สำเร็จ ลองรีเฟรชหน้า");
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return toast("⚠️ เบราว์เซอร์นี้ไม่รองรับกล้อง");
  }

  cameraScanTargetId = member.id;
  $("cameraScanMemberName").textContent = member.name;
  $("cameraScanStatus").textContent = "⏳ กำลังเปิดกล้อง...";
  $("cameraScanModal").classList.remove("hidden");

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    const video = $("cameraScanVideo");
    video.srcObject = cameraStream;
    await video.play();

    $("cameraScanStatus").textContent = "🔍 กำลังสแกน QR...";

    const canvas = document.createElement("canvas");
    let scanning = true;

    cameraScanInterval = setInterval(() => {
      if (!scanning) return;
      const code = decodeQRFromVideoFrame(video, canvas);
      if (code && code.data) {
        scanning = false;
        handleCameraQRDetected(code.data);
      }
    }, 250);

  } catch (err) {
    console.error("[Camera] Error:", err);
    $("cameraScanStatus").textContent = "❌ เปิดกล้องไม่ได้: " + (err.message || err);
    setTimeout(closeCameraScan, 2500);
  }
}

function closeCameraScan() {
  if (cameraScanInterval) {
    clearInterval(cameraScanInterval);
    cameraScanInterval = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = $("cameraScanVideo");
  if (video) video.srcObject = null;
  $("cameraScanModal").classList.add("hidden");
  cameraScanTargetId = null;
}

async function handleCameraQRDetected(qrData) {
  if (!cameraScanTargetId || !currentSession || !currentSessionId) {
    closeCameraScan();
    return;
  }

  const member = (currentSession.members || []).find(m => m.id === cameraScanTargetId);
  if (!member) {
    closeCameraScan();
    return;
  }

  // เช็คยอดเงินจาก QR
  const memberIdx = (currentSession.members || []).findIndex(m => m.id === cameraScanTargetId);
  const totals = calcSessionTotals(currentSession);
  const expectedAmount = totals.perMember?.[memberIdx] ?? 0;
  const qrAmount = parseAmountFromEMVQR(qrData);

  // กรณียอดไม่ตรง — ขอ confirm จาก admin (เพราะ admin scan เอง สามารถตัดสินใจได้)
  if (qrAmount !== null && Math.abs(qrAmount - expectedAmount) > 0.01) {
    closeCameraScan();
    const proceed = confirm(`⚠️ ยอดเงินไม่ตรง\n\n• ยอดในสลิป: ${qrAmount.toFixed(2)} ฿\n• ยอดที่ต้องจ่าย: ${expectedAmount.toFixed(2)} ฿\n\nยืนยันรับชำระจาก ${member.name} หรือไม่?`);
    if (!proceed) {
      toast("ยกเลิก — ยอดไม่ตรง");
      return;
    }
    // admin ยืนยันแล้ว → ดำเนินการต่อ
    await saveCameraScanResult(member, qrData, qrAmount);
    return;
  }

  $("cameraScanStatus").textContent = qrAmount !== null
    ? `✓ พบ QR — ยอด ${qrAmount.toFixed(2)} ฿ ตรง! กำลังบันทึก...`
    : `✓ พบ QR! กำลังบันทึก...`;

  await saveCameraScanResult(member, qrData, qrAmount);
}

async function saveCameraScanResult(member, qrData, qrAmount) {
  try {
    const newMembers = (currentSession.members || []).map(m =>
      m.id === member.id
        ? { ...m, isPaid: true, slipQR: qrData, slipQRAmount: qrAmount !== null ? qrAmount : null }
        : m
    );
    await updateDoc(doc(db, "sessions", currentSessionId), {
      members: newMembers,
      updatedAt: serverTimestamp()
    });
    const amountMsg = qrAmount !== null ? ` · ยอด ${qrAmount.toFixed(2)} ฿ ✓` : "";
    toast(`✓ ${member.name} จ่ายแล้ว${amountMsg}`);
    closeCameraScan();
  } catch (err) {
    console.error("[CameraScan] Save error:", err);
    $("cameraScanStatus").textContent = "❌ บันทึกไม่สำเร็จ: " + (err.message || err);
    setTimeout(closeCameraScan, 2500);
  }
}

$("btnCloseCameraScan")?.addEventListener("click", closeCameraScan);

// ============================================================
// JOIN VIEW
// ============================================================
let joinUnsubscribe = null;
let previousJoinMembers = null;  // เปรียบเทียบเพื่อ detect คนใหม่

async function setupJoinView(id) {
  $("joinFormSection").classList.remove("hidden");
  $("joinSuccessSection").classList.add("hidden");
  $("fldJoinName").value = "";
  $("joinSessionName").textContent = "กำลังโหลด...";
  $("joinSessionDate").textContent = "";
  $("joinCount").textContent = "0";
  $("joinMembersList").innerHTML = "";
  previousJoinMembers = null;  // reset เมื่อเปิด join view ใหม่

  if (joinUnsubscribe) { joinUnsubscribe(); joinUnsubscribe = null; }

  try {
    const ref = doc(db, "sessions", id);
    // Subscribe to live updates immediately
    joinUnsubscribe = onSnapshot(ref, (docSnap) => {
      if (!docSnap.exists()) {
        $("joinSessionName").textContent = "ไม่พบก๊วนนี้ หรือถูกลบไปแล้ว";
        $("joinFormSection").classList.add("hidden");
        return;
      }
      const s = docSnap.data();
      currentSession = { id: docSnap.id, ...s }; // เก็บใส่ตัวแปรโกลบอลให้ปุ่มแชร์เข้าถึงได้

      // 🔔 Detect คนเพิ่งเข้าร่วม (ยกเว้นตัวเองที่เพิ่งกดลงชื่อ)
      const currentMembers = s.members || [];
      if (previousJoinMembers !== null) {
        const newcomers = findNewMembers(previousJoinMembers, currentMembers, mySubmittedJoinIds);
        newcomers.forEach(m => notifyNewMember(m.name || "ใครบางคน"));
      }
      previousJoinMembers = currentMembers.map(m => ({ id: m.id }));

      $("joinSessionName").textContent = s.location || "ก๊วนแบดมินตัน";
      $("joinSessionDate").textContent = s.date ? formatDate(s.date) : "";

      // Render courts info — ซ่อนเมื่อก๊วนปิดแล้ว (ไม่จำเป็นต้องดูสนามอีก)
      const courtsSection = $("joinCourtsSection");
      const courtsListEl = $("joinCourtsList");
      const courts = (s.courts || []).filter(c => c.number || c.startTime || c.endTime);
      const sessionClosed = s.status === "closed";
      if (courtsSection && courtsListEl) {
        if (courts.length === 0 || sessionClosed) {
          courtsSection.classList.add("hidden");
        } else {
          courtsSection.classList.remove("hidden");
          courtsListEl.innerHTML = courts.map(c => {
            const num = c.number ? `สนาม ${escapeHtml(c.number)}` : "สนาม —";
            let timeStr = "";
            if (c.startTime && c.endTime) timeStr = `${c.startTime} - ${c.endTime}`;
            else if (c.startTime) timeStr = `เริ่ม ${c.startTime}`;
            else if (c.endTime) timeStr = `ถึง ${c.endTime}`;
            return `<li class="flex items-center gap-2">
              <span class="font-semibold text-slate-800 dark:text-slate-200">${num}</span>
              ${timeStr ? `<span class="text-xs text-slate-500 dark:text-slate-400">🕐 ${timeStr}</span>` : ""}
            </li>`;
          }).join("");
        }
      }

// --- Render members + payment info ---
      const mems = s.members || [];
      $("joinCount").textContent = mems.length;

      const isClosed = s.status === "closed";
      const regClosed = !!s.registrationClosed && !isClosed;  // ปิดรับเฉยๆ (Court ยังเปิด)
      const totals = calcSessionTotals(s);

      const closedBanner = $("joinClosedBanner");
      const paySection = $("joinPaymentSection");
      const totalDueBox = $("joinTotalDueBox");
      const formSection = $("joinFormSection");
      const btnJoinAnother = $("btnJoinAnother");

      // ===== State 3: ปิด Court แล้ว =====
      if (isClosed) {
        if (closedBanner) closedBanner.classList.remove("hidden");
        formSection?.classList.add("hidden");
        btnJoinAnother?.classList.add("hidden");

        const unpaidCount = mems.filter(m => !m.isPaid).length;
        const allPaid = mems.length > 0 && unpaidCount === 0;

        if (allPaid) {
          paySection?.classList.add("hidden");
          totalDueBox?.classList.add("hidden");
          if (closedBanner) {
            closedBanner.textContent = "✅ ปิด Court แล้ว — ทุกคนจ่ายครบ 🎉";
            closedBanner.className = "bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl mb-4 text-center text-sm font-semibold";
          }
        } else {
          paySection?.classList.remove("hidden");
          if (closedBanner) {
            closedBanner.textContent = "🔒 ปิดแล้ว — กดปุ่ม 💰 จ่ายเงิน ที่ชื่อของคุณเพื่อดู QR";
            closedBanner.className = "bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl mb-4 text-center text-sm font-semibold";
          }
          if (unpaidCount > 0) {
            totalDueBox?.classList.remove("hidden");
            $("joinUnpaidCount").textContent = unpaidCount;
          } else {
            totalDueBox?.classList.add("hidden");
          }
        }
      }
      // ===== State 2: ปิดรับสมาชิกแล้ว (Court ยังเปิดอยู่) =====
      else if (regClosed) {
        if (closedBanner) {
          closedBanner.classList.remove("hidden");
          closedBanner.textContent = "🔒 ปิดรับสมาชิกแล้ว";
          closedBanner.className = "bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl mb-4 text-center text-sm font-semibold";
        }
        // ซ่อน form + ปุ่มลงชื่อให้คนอื่น
        formSection?.classList.add("hidden");
        btnJoinAnother?.classList.add("hidden");
        // ไม่แสดงยอด (Court ยังเปิดอยู่)
        paySection?.classList.add("hidden");
        totalDueBox?.classList.add("hidden");
      }
      // ===== State 1: เปิดรับ + เปิด Court =====
      else {
        if (closedBanner) closedBanner.classList.add("hidden");
        paySection?.classList.add("hidden");
        totalDueBox?.classList.add("hidden");
        formSection?.classList.remove("hidden");
        btnJoinAnother?.classList.remove("hidden");
      }

      // Show/hide join form skill and team sections based on session settings
      const joinSkillSec = $("joinSkillSection");
      const joinBuddySec = $("joinBuddySection");
      if (joinSkillSec) {
        if (s.mode === "advance") {
          joinSkillSec.classList.remove("hidden");
          joinBuddySec?.classList.remove("hidden");
          populateBuddyDropdown($("fldJoinBuddy"), null);
        } else {
          joinSkillSec.classList.add("hidden");
          joinBuddySec?.classList.add("hidden");
        }
      }

      // Render members list
      // - ปิดก๊วน: แสดงยอดเงิน + สถานะจ่าย
      // - เปิดก๊วน: แสดงแค่ชื่อ (ไม่โชว์ยอด)
      $("joinMembersList").innerHTML = mems.map((m, idx) => {
        const isPaid = !!m.isPaid;
        const badgeSkill = m.skill ? `<span class="text-[9px] px-1 py-0.25 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold rounded shrink-0">${m.skill}</span>` : '';
        
        let badgeBuddy = '';
        const buddyMember = m.buddyId 
          ? mems.find(x => x.id === m.buddyId) 
          : mems.find(x => x.buddyId === m.id);
        if (buddyMember) {
          badgeBuddy = `<span class="text-[9px] px-1.5 py-0.25 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold rounded shrink-0">🤝 ${escapeHtml(buddyMember.name)}</span>`;
        }

        if (isClosed) {
          const cost = totals.perMember?.[idx] ?? 0;
          const priceBadge = isPaid
            ? `<span class="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">✓ จ่ายแล้ว</span>`
            : `<span class="text-sm font-bold text-rose-600 dark:text-rose-400">${fmt(cost)} ฿</span>`;

          // ปุ่ม "💰 จ่ายเงิน" — แสดงเฉพาะคนยังไม่จ่าย
          const payBtn = isPaid ? "" : `
            <button data-pay-member-idx="${idx}"
              class="ml-2 shrink-0 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-[11px] font-bold px-2.5 py-1 rounded-md shadow-sm transition-transform active:scale-95">
              💰 จ่ายเงิน
            </button>`;

          return `
            <li class="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0 pr-2">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="${isPaid ? 'text-emerald-500' : 'text-rose-400'} shrink-0 text-xs">●</span>
                <button data-act="edit-player-join" data-idx="${idx}" class="text-left font-medium hover:text-emerald-600 flex items-center gap-1.5 ${isPaid ? 'text-slate-500 dark:text-slate-500 line-through' : 'text-slate-800 dark:text-slate-100'} truncate" title="คลิกเพื่อตั้งค่าระดับมือ">
                  <span>${escapeHtml(m.name)}</span>
                  ${badgeSkill}
                  ${badgeBuddy}
                </button>
              </div>
              <div class="flex items-center shrink-0 ml-2">
                ${priceBadge}
                ${payBtn}
              </div>
            </li>
          `;
        }

        // เปิดก๊วน — แค่ชื่อ
        return `
          <li class="flex items-center gap-2 py-1.5 border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
            <span class="text-emerald-500 text-xs shrink-0">●</span>
            <button data-act="edit-player-join" data-idx="${idx}" class="text-left font-medium text-slate-800 dark:text-slate-200 hover:text-emerald-600 flex items-center gap-1.5 truncate" title="คลิกเพื่อตั้งค่าระดับมือ">
              <span>${escapeHtml(m.name)}</span>
              ${badgeSkill}
              ${badgeBuddy}
            </button>
          </li>
        `;
      }).join("");

      // Wire up "💰 จ่ายเงิน" buttons
      $("joinMembersList").querySelectorAll("button[data-pay-member-idx]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.payMemberIdx, 10);
          if (!isNaN(idx)) openPaymentModal(idx);
        });
      });

      // Wire up "edit-player-join" buttons
      $("joinMembersList").querySelectorAll("button[data-act='edit-player-join']").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (!isNaN(idx)) openPlayerSettingsModal(idx, false);
        });
      });
      // --- สิ้นสุด ---
    });
  } catch (e) {
    $("joinSessionName").textContent = "เกิดข้อผิดพลาดในการโหลด";
    console.error(e);
  }
}

$("btnSubmitJoin").addEventListener("click", async () => {
  const name = $("fldJoinName").value.trim();
  if (!name) return toast("กรุณาพิมพ์ชื่อ");
  if (!currentSessionId) return;

  $("btnSubmitJoin").disabled = true;
  $("btnSubmitJoin").textContent = "กำลังลงชื่อ...";

  try {
    const ref = doc(db, "sessions", currentSessionId);
    let errorMsg = "";
    const newId = uid();
    const skill = (currentSession && currentSession.mode === "advance") ? currentJoinSkill : null;
    const buddyId = (currentSession && currentSession.mode === "advance") ? ($("fldJoinBuddy")?.value || null) : null;

    await runTransaction(db, async (transaction) => {
      const sfDoc = await transaction.get(ref);
      if (!sfDoc.exists()) throw new Error("ไม่พบก๊วนนี้");

      const s = sfDoc.data();

      // Guard: ถ้าปิดรับ/ปิด Court แล้ว ห้ามลงทะเบียนเพิ่ม (race condition safety)
      if (s.status === "closed") {
        errorMsg = "🔒 ก๊วนนี้ปิดแล้ว — ไม่รับสมาชิกเพิ่ม";
        return;
      }
      if (s.registrationClosed) {
        errorMsg = "🔒 ปิดรับสมาชิกแล้ว — ไม่สามารถลงชื่อได้";
        return;
      }

      const members = s.members || [];

      // Prevent duplicate names
      const exists = members.some(m => (m.name || "").trim().toLowerCase() === name.toLowerCase());
      if (exists) {
        errorMsg = `มีชื่อ "${name}" ในก๊วนแล้ว`;
        return;
      }

      members.push({
        id: newId,
        name,
        shuttlesUsed: 0,
        skill: skill || null,
        buddyId: buddyId || null
      });

      transaction.update(ref, { members });
    });

    if (errorMsg) {
      toast(errorMsg);
      return;
    }

    trackOwnSubmit(newId);
    addKnownMember(name); // จดจำชื่อในเครื่องของผู้เล่นไว้

    // รีเซ็ตการเลือกฟอร์มลงชื่อหลังกดเข้าร่วมสำเร็จ
    currentJoinSkill = null;
    const joinBuddySelect = $("fldJoinBuddy");
    if (joinBuddySelect) joinBuddySelect.value = "";
    updateJoinSkillUI();

    // Show success with the added name
    const successNameEl = $("joinSuccessName");
    if (successNameEl) successNameEl.textContent = `เพิ่ม "${name}" แล้ว 🎉`;

    $("joinFormSection").classList.add("hidden");
    $("joinSuccessSection").classList.remove("hidden");

  } catch (e) {
    toast("ผิดพลาด: " + e.message);
  } finally {
    $("btnSubmitJoin").disabled = false;
    $("btnSubmitJoin").textContent = "ลงชื่อเข้าร่วม";
  }
});

// "ลงชื่อให้คนอื่นเพิ่ม" — กลับไปแสดง form อีกครั้ง
const btnJoinAnother = $("btnJoinAnother");
if (btnJoinAnother) {
  btnJoinAnother.addEventListener("click", () => {
    $("joinSuccessSection").classList.add("hidden");
    $("joinFormSection").classList.remove("hidden");
    const input = $("fldJoinName");
    if (input) {
      input.value = "";
      input.focus();
    }
  });
}

// ============================================================
// SHARE & BANK QR
// ============================================================

// แปลง startTime/endTime → string สำหรับแสดง
function formatTimeRangeForShare(startTime, endTime) {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  if (startTime) return `เริ่ม ${startTime}`;
  if (endTime) return `ถึง ${endTime}`;
  return "";
}

// สร้างข้อความ "🏟️ สนาม X  🕐 เวลา" สำหรับ share message
// - group courts ที่เวลาเดียวกัน → รวมเลขสนามในบรรทัดเดียว
// - คนละเวลา → แยกบรรทัด
// - คืน "" ถ้าไม่มีข้อมูลสนามเลย
function formatCourtsForShare(courts) {
  const valid = (courts || []).filter(c => c.number || c.startTime || c.endTime);
  if (valid.length === 0) return "";

  // จัดกลุ่มตามคู่ (startTime, endTime)
  const groups = new Map();
  valid.forEach(c => {
    const key = `${c.startTime || ''}|${c.endTime || ''}`;
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

// 🎨 Helper: สร้าง status header สำหรับ share text (เน้นคำสำคัญด้วยเส้นแบ่ง)
function buildShareStatusHeader(session) {
  if (session.status === "closed") {
    return `🔴 ปิด Court — ต้องชำระเงิน\n━━━━━━━━━━━━━━━\n\n`;
  }
  if (session.registrationClosed) {
    return `🟡 ปิดรับสมาชิกแล้ว\n━━━━━━━━━━━━━━━\n\n`;
  }
  return `🟢 เปิดรับสมาชิก\n━━━━━━━━━━━━━━━\n\n`;
}

// 🎨 Helper: สร้าง share text แบ่งตาม state (ใช้กับ btnShareJoin + btnShareJoinPublic)
function buildShareText(session, joinUrl) {
  const courtClosed = session.status === "closed";
  const regClosed = !!session.registrationClosed || courtClosed;
  const dateText = session.date ? formatDate(session.date) : "วันนี้";
  const members = session.members || [];
  const courtInfo = formatCourtsForShare(session.courts);

  // ===== Status Header =====
  let text = buildShareStatusHeader(session);

  // ===== Body Header =====
  // ใส่ "Register" เฉพาะตอนเปิดรับเท่านั้น
  if (courtClosed || regClosed) {
    text += `🏸 ตีแบดวันที่ ${dateText}\n`;
  } else {
    text += `🏸 Register ตีแบดวันที่ ${dateText}\n`;
  }
  if (courtInfo) text += `${courtInfo}\n`;

  // ===== Member List =====
  if (members.length > 0) {
    const memberLabel = regClosed ? "สมาชิก" : "อัปเดตคนลงชื่อแล้ว";
    const memberEmoji = regClosed ? "" : " 🔥";
    text += `${memberLabel} (${members.length} คน)${memberEmoji}\n`;
    members.forEach((m, idx) => {
      text += `${idx + 1}. ${m.name}\n`;
    });
  }

  // ===== CTA + Link =====
  if (courtClosed) {
    text += `💰 คลิกลิงก์เพื่อชำระเงิน :\n${joinUrl}`;
  } else if (regClosed) {
    text += `👀 ดูรายชื่อสมาชิก :\n${joinUrl}`;
  } else {
    text += `👇 กดลิงก์ลงชื่อเลย 😎 :\n${joinUrl}`;
  }

  return text;
}

$("btnShareJoin").addEventListener("click", async () => {
  if (!currentSessionId || !currentSession) return;
  const joinUrl = location.origin + location.pathname + `?openExternalBrowser=1#/join/${currentSessionId}`;
  const shareText = buildShareText(currentSession, joinUrl);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile && navigator.share) {
    try {
      await navigator.share({ text: shareText });
      toast("แชร์ลิงก์สำเร็จ ✓");
    } catch (err) {
      if (err.name !== "AbortError") toast("แชร์ไม่สำเร็จ");
    }
  } else {
    // บังคับก๊อปปี้สำหรับใช้งานบนคอมพิวเตอร์ (เอาแค่ลิงก์เปล่าๆ ตามที่ขอ)
    const textToCopy = isMobile ? shareText : joinUrl;
    navigator.clipboard.writeText(textToCopy).then(() => {
      toast(isMobile ? "คัดลอกข้อความแล้ว (นำไปวางในไลน์ได้เลย)" : "คัดลอกลิงก์แล้ว (นำไปวางในเบราว์เซอร์ได้เลย)");
    }).catch(() => {
      toast("ไม่สามารถคัดลอกได้");
    });
  }
});

$("btnShareJoinPublic").addEventListener("click", async () => {
  if (!currentSessionId || !currentSession) return;
  const joinUrl = location.origin + location.pathname + `?openExternalBrowser=1#/join/${currentSessionId}`;
  const shareText = buildShareText(currentSession, joinUrl);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile && navigator.share) {
    try {
      await navigator.share({ text: shareText });
      toast("แชร์ลิงก์สำเร็จ ✓");
    } catch (err) {
      if (err.name !== "AbortError") toast("แชร์ไม่สำเร็จ");
    }
  } else {
    const textToCopy = isMobile ? shareText : joinUrl;
    navigator.clipboard.writeText(textToCopy).then(() => {
      toast(isMobile ? "คัดลอกข้อความแล้ว" : "คัดลอกลิงก์แล้ว");
    }).catch(() => {
      toast("ไม่สามารถคัดลอกได้");
    });
  }
});

// ============================================================
// 🛡️ Temporary Manager PIN System
// ============================================================
// - แต่ละ session มี PIN 4 หลัก + วันหมดอายุ (24 ชม.)
// - ผู้รับลิงก์ #/m/{id} ต้องใส่ PIN ก่อนจัดการกลุ่ม
// - admin/manager ที่ login → bypass

const TM_PIN_TTL_MS = 24 * 60 * 60 * 1000; // 24 ชั่วโมง

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Format expiry → "อีก X ชม." หรือ "อีก X น."
function formatExpiry(expiresAt) {
  if (!expiresAt) return "";
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "หมดอายุ";
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `อีก ${hours} ชม.`;
  return `อีก ${mins} น.`;
}

// Local "ตั๋วเข้า" — เก็บใน localStorage ว่าใส่ PIN ถูกต้องแล้ว
function setTempManagerAuth(sessionId, expiresAt) {
  if (!sessionId || !expiresAt) return;
  localStorage.setItem(`tmAuth_${sessionId}`, String(expiresAt));
}

function hasValidTempManagerPin(sessionId) {
  if (!sessionId) return false;
  const exp = parseInt(localStorage.getItem(`tmAuth_${sessionId}`) || "0", 10);
  return exp > Date.now();
}

// เช็คว่าตอนนี้ user กำลังดู session ผ่าน manager link หรือไม่
function isInManagerLinkView() {
  return (location.hash || "").startsWith("#/m/");
}

function updateTempPinDisplay() {
  const s = currentSession;
  const display = $("tempPinSmallDisplay");
  if (!s || !display) return;

  const pin = s.tempManagerPin;
  const expiresAt = s.tempManagerExpiresAt || 0;
  const valid = pin && expiresAt > Date.now();

  if (valid) {
    display.classList.remove("hidden");
    $("tempPinValueSmall").textContent = pin;
    $("tempPinExpirySmall").textContent = formatExpiry(expiresAt);

    // ใน manager link view — ห้าม reset PIN
    const inMgrView = isInManagerLinkView();
    const resetIcon = $("tempPinResetIcon");
    display.disabled = inMgrView;
    if (inMgrView) {
      display.classList.remove("cursor-pointer", "hover:bg-indigo-100", "dark:hover:bg-indigo-800/40", "active:scale-95");
      display.classList.add("cursor-default");
      display.title = "PIN สำหรับ Temp Manager (ดูได้อย่างเดียว)";
      if (resetIcon) resetIcon.classList.add("hidden");
    } else {
      display.classList.add("cursor-pointer", "hover:bg-indigo-100", "dark:hover:bg-indigo-800/40", "active:scale-95");
      display.classList.remove("cursor-default");
      display.title = "กดเพื่อรีเซ็ต PIN ใหม่";
      if (resetIcon) resetIcon.classList.remove("hidden");
    }
  } else {
    display.classList.add("hidden");
  }
}

// Click ปุ่ม Temp Manager — Generate PIN (ถ้ายังไม่มีหรือหมดอายุ) + Copy ลิงก์
$("btnShare").addEventListener("click", async () => {
  if (!currentSessionId || !currentSession) return;

  const s = currentSession;
  const expired = !s.tempManagerExpiresAt || s.tempManagerExpiresAt < Date.now();

  let pin = s.tempManagerPin;
  let expiresAt = s.tempManagerExpiresAt;

  // ถ้ายังไม่มี PIN หรือหมดอายุ → Generate ใหม่
  if (!pin || expired) {
    pin = generatePin();
    expiresAt = Date.now() + TM_PIN_TTL_MS;
    await saveSession({
      tempManagerPin: pin,
      tempManagerExpiresAt: expiresAt
    });
  }

  const managerUrl = location.origin + location.pathname + `?openExternalBrowser=1#/m/${currentSessionId}`;
  const dateText = s.date ? formatDate(s.date) : "วันนี้";

  const shareText = `🛡️ Temporary Manager — ${dateText}
━━━━━━━━━━━━━━━

📋 ลิงก์: ${managerUrl}
🔢 PIN: ${pin}
⏰ หมดอายุ: ${formatExpiry(expiresAt)}`;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile && navigator.share) {
    try {
      await navigator.share({ text: shareText });
      toast("แชร์ลิงก์ Temp Manager สำเร็จ ✓");
    } catch (err) {
      if (err.name !== "AbortError") toast("แชร์ไม่สำเร็จ");
    }
  } else {
    const textToCopy = isMobile ? shareText : managerUrl;
    navigator.clipboard.writeText(textToCopy).then(() => {
      toast(`คัดลอกแล้ว · PIN: ${pin} (24 ชม.)`, 4000);
    }).catch(() => {
      toast("ไม่สามารถคัดลอกได้");
    });
  }

  updateTempPinDisplay();
});

// ---------- Click ตัว PIN counter → Reset PIN ใหม่ ----------
$("tempPinSmallDisplay")?.addEventListener("click", async () => {
  if (!currentSessionId || !currentSession) return;
  // Manager link view ห้าม reset
  if (isInManagerLinkView()) return;
  const s = currentSession;
  const currentPin = s.tempManagerPin;
  if (!currentPin) return;

  if (!confirm(`รีเซ็ต PIN ใหม่?\n\nPIN ปัจจุบัน (${currentPin}) จะใช้ไม่ได้ทันที — คนที่ถือลิงก์เดิมต้องใช้ PIN ใหม่`)) return;

  const newPin = generatePin();
  const newExpiresAt = Date.now() + TM_PIN_TTL_MS;
  await saveSession({
    tempManagerPin: newPin,
    tempManagerExpiresAt: newExpiresAt
  });

  // Copy ลิงก์ + PIN ใหม่ไป clipboard (ทำเหมือนตอนกดปุ่ม Temp Manager)
  const managerUrl = location.origin + location.pathname + `?openExternalBrowser=1#/m/${currentSessionId}`;
  const dateText = s.date ? formatDate(s.date) : "วันนี้";
  const shareText = `🛡️ Temporary Manager — ${dateText}
━━━━━━━━━━━━━━━

📋 ลิงก์: ${managerUrl}
🔢 PIN: ${newPin}
⏰ หมดอายุ: ${formatExpiry(newExpiresAt)}`;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile && navigator.share) {
    try { await navigator.share({ text: shareText }); } catch (err) { /* ignore */ }
  } else {
    try { await navigator.clipboard.writeText(shareText); } catch (err) { /* ignore */ }
  }

  toast(`✓ PIN ใหม่: ${newPin}`, 4000);
  updateTempPinDisplay();
});

// PIN input UX — auto-submit เมื่อพิมพ์ครบ 4 หลัก + clear error ตอนพิมพ์
$("fldManagerPin")?.addEventListener("input", (e) => {
  const v = e.target.value.replace(/\D/g, "").slice(0, 4);
  e.target.value = v;
  $("managerPinError")?.classList.add("hidden");
  if (v.length === 4) {
    // auto-submit เมื่อพิมพ์ครบ 4 หลัก
    $("managerPinForm")?.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});

// PIN Entry Form — ตรวจ PIN ก่อนเข้า session
$("managerPinForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("fldManagerPin");
  const errorEl = $("managerPinError");
  const pin = input.value.trim();

  if (!/^\d{4}$/.test(pin)) {
    errorEl.textContent = "PIN ต้องเป็นตัวเลข 4 หลัก";
    errorEl.classList.remove("hidden");
    return;
  }

  if (!currentSessionId) {
    errorEl.textContent = "ไม่พบ session";
    errorEl.classList.remove("hidden");
    return;
  }

  // ตรวจกับ Firestore
  try {
    const ref = doc(db, "sessions", currentSessionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      errorEl.textContent = "ไม่พบกลุ่มนี้ อาจถูกลบไปแล้ว";
      errorEl.classList.remove("hidden");
      return;
    }

    const data = snap.data();
    const correctPin = data.tempManagerPin;
    const expiresAt = data.tempManagerExpiresAt || 0;

    if (!correctPin || expiresAt < Date.now()) {
      errorEl.textContent = "ลิงก์หมดอายุแล้ว — แจ้ง Admin ขอ PIN ใหม่";
      errorEl.classList.remove("hidden");
      return;
    }

    if (pin !== correctPin) {
      errorEl.textContent = "PIN ไม่ถูกต้อง";
      errorEl.classList.remove("hidden");
      input.value = "";
      input.focus();
      return;
    }

    // ✅ Pass — save auth ใน localStorage + redirect
    setTempManagerAuth(currentSessionId, expiresAt);
    errorEl.classList.add("hidden");
    input.value = "";
    toast("✅ เข้าจัดการกลุ่มได้แล้ว");
    // Re-route เพื่อให้เข้า session view
    route();
  } catch (err) {
    console.error(err);
    errorEl.textContent = "เกิดข้อผิดพลาด: " + err.message;
    errorEl.classList.remove("hidden");
  }
});

// Helper: rounded rectangle path
function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

$("btnExport").addEventListener("click", () => {
  const s = currentSession;
  if (!s || !s.members || s.members.length === 0) return toast("ไม่มีข้อมูลให้ออกบิล");

  const totals = calcTotals();
  const members = s.members;
  const hasQR = !!s.bankQR;

  const buildBill = (qrImg) => {
    // ===== Layout constants =====
    const W = 540;
    const PAD = 32;
    const innerW = W - PAD * 2;
    const rowH = 42;
    const FONT = "'Sarabun', -apple-system, 'Segoe UI', sans-serif";

    // QR dimensions (preserve aspect ratio)
    let qrW = 0, qrH = 0;
    if (qrImg) {
      const maxQrSize = 240;
      const aspect = qrImg.width / qrImg.height;
      if (aspect >= 1) { qrW = maxQrSize; qrH = Math.round(maxQrSize / aspect); }
      else            { qrH = maxQrSize; qrW = Math.round(maxQrSize * aspect); }
    }

    // ===== Pre-calc canvas height =====
    const hasOther = totals.totalOtherCost > 0;
    const summaryRows = 2 + (hasOther ? 1 : 0);
    const summaryH = 24 + summaryRows * 24 + 16 + 32 + 16;
    const qrSectionH = qrImg ? (28 + 18 + qrH + 32) : 0;

    let H = 0;
    H += 56;                          // top accent + title margin
    H += 28;                          // title
    H += 24;                          // subtitle
    H += 32;                          // gap to list header
    H += 24;                          // list header + underline
    H += members.length * rowH + 8;   // rows
    H += 20;                          // gap before summary
    H += summaryH;                    // summary box
    H += qrSectionH;                  // optional QR
    H += 40;                          // footer

    // ===== Canvas =====
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Top accent gradient
    const topGrad = ctx.createLinearGradient(0, 0, W, 0);
    topGrad.addColorStop(0, "#10b981");
    topGrad.addColorStop(1, "#059669");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 6);

    // ===== Title =====
    let y = 52;
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 22px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText("🏸 " + (s.location || "สรุปก๊วน"), W / 2, y);

    y += 26;
    ctx.fillStyle = "#64748b";
    ctx.font = "13px " + FONT;
    ctx.fillText(formatDate(s.date) + "  ·  " + members.length + " คน  ·  " + totals.totalShuttles + " ลูก", W / 2, y);

    y += 36;

    // ===== List header =====
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 11px " + FONT;
    ctx.textAlign = "left";
    ctx.fillText("รายชื่อ", PAD, y);
    ctx.textAlign = "right";
    ctx.fillText("ยอดที่ต้องจ่าย", W - PAD, y);

    y += 8;
    ctx.beginPath();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();

    y += 22;

    // ===== Member rows =====
    members.forEach((m, idx) => {
      const cost = totals.perMember[idx];
      const isPaid = !!m.isPaid;

      // Status indicator (circle/check)
      const dotX = PAD + 7;
      const dotY = y - 6;
      if (isPaid) {
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(dotX - 3, dotY);
        ctx.lineTo(dotX - 1, dotY + 3);
        ctx.lineTo(dotX + 4, dotY - 3);
        ctx.stroke();
        ctx.lineCap = "butt";
      } else {
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Name
      const nameX = PAD + 22;
      ctx.fillStyle = isPaid ? "#94a3b8" : "#0f172a";
      ctx.font = "18px " + FONT;
      ctx.textAlign = "left";
      ctx.fillText(m.name, nameX, y);

      if (isPaid) {
        const tw = ctx.measureText(m.name).width;
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(nameX, y - 6);
        ctx.lineTo(nameX + tw, y - 6);
        ctx.stroke();
      }

      // Price
      ctx.fillStyle = isPaid ? "#10b981" : "#dc2626";
      ctx.font = "bold 18px " + FONT;
      ctx.textAlign = "right";
      ctx.fillText(fmt(cost) + " ฿", W - PAD, y);

      // Subtle row divider
      if (idx < members.length - 1) {
        ctx.beginPath();
        ctx.strokeStyle = "#f1f5f9";
        ctx.lineWidth = 1;
        ctx.moveTo(PAD, y + 14);
        ctx.lineTo(W - PAD, y + 14);
        ctx.stroke();
      }

      y += rowH;
    });

    y += 12;

    // ===== Summary box =====
    const sumBoxY = y;
    ctx.fillStyle = "#f0fdf4";
    roundRectPath(ctx, PAD, sumBoxY, innerW, summaryH, 12);
    ctx.fill();

    let sy = sumBoxY + 26;
    ctx.font = "14px " + FONT;
    ctx.fillStyle = "#475569";
    ctx.textAlign = "left";
    ctx.fillText("ค่าคอร์ด", PAD + 18, sy);
    ctx.textAlign = "right";
    ctx.fillText(fmt(totals.totalCourtCost) + " ฿", W - PAD - 18, sy);

    sy += 22;
    ctx.textAlign = "left";
    ctx.fillText("ค่าลูก (" + totals.totalShuttles + " ลูก)", PAD + 18, sy);
    ctx.textAlign = "right";
    ctx.fillText(fmt(totals.totalShuttleCost) + " ฿", W - PAD - 18, sy);

    if (hasOther) {
      sy += 22;
      ctx.textAlign = "left";
      ctx.fillText("ค่าอื่นๆ", PAD + 18, sy);
      ctx.textAlign = "right";
      ctx.fillText(fmt(totals.totalOtherCost) + " ฿", W - PAD - 18, sy);
    }

    sy += 16;
    ctx.beginPath();
    ctx.strokeStyle = "#bbf7d0";
    ctx.lineWidth = 1;
    ctx.moveTo(PAD + 18, sy);
    ctx.lineTo(W - PAD - 18, sy);
    ctx.stroke();

    sy += 22;
    ctx.fillStyle = "#065f46";
    ctx.font = "bold 16px " + FONT;
    ctx.textAlign = "left";
    ctx.fillText("รวมทั้งสิ้น", PAD + 18, sy);
    ctx.fillStyle = "#059669";
    ctx.font = "bold 20px " + FONT;
    ctx.textAlign = "right";
    ctx.fillText(fmt(totals.totalAll) + " ฿", W - PAD - 18, sy);

    y = sumBoxY + summaryH;

    // ===== QR section =====
    if (qrImg) {
      y += 28;
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 14px " + FONT;
      ctx.textAlign = "center";
      ctx.fillText("📱 สแกน QR เพื่อโอนเงิน", W / 2, y);

      y += 18;
      const qrX = (W - qrW) / 2;

      // White frame around QR
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      roundRectPath(ctx, qrX - 8, y, qrW + 16, qrH + 16, 12);
      ctx.fill();
      ctx.stroke();

      // QR image (aspect-ratio preserved)
      ctx.drawImage(qrImg, qrX, y + 8, qrW, qrH);
    }

    // ===== Footer =====
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "10px " + FONT;
    ctx.textAlign = "center";
    const ts = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
    ctx.fillText("สร้างด้วย BadCount  ·  " + ts, W / 2, H - 16);

    // ===== Download =====
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const a = document.createElement("a");
    a.href = dataUrl;
    const safeLoc = (s.location || "bill").replace(/[^a-zA-Z0-9ก-๙]/g, "_").slice(0, 30);
    a.download = `Bill_${safeLoc}_${s.date || todayISO()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast("บันทึกรูปสรุปค่าใช้จ่ายแล้ว");
  };

  // Robust image loader with decode() for mobile compatibility
  const loadImageSafe = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };

    // Timeout fallback (10s) in case mobile hangs
    const timer = setTimeout(() => {
      console.warn("[Export] QR image load timeout");
      finish(null);
    }, 10000);

    img.onload = () => {
      // decode() ensures the image is fully decoded and ready for drawImage
      if (typeof img.decode === "function") {
        img.decode()
          .then(() => { clearTimeout(timer); finish(img); })
          .catch((err) => { console.warn("[Export] decode failed:", err); clearTimeout(timer); finish(img); });
      } else {
        clearTimeout(timer); finish(img);
      }
    };
    img.onerror = (err) => {
      console.warn("[Export] QR image failed to load:", err);
      clearTimeout(timer);
      finish(null);
    };

    // Crucial: assign onload before src
    img.src = src;

    // Already cached/sync? Force check.
    if (img.complete && img.naturalWidth > 0) {
      img.onload();
    }
  });

  loadImageSafe(hasQR ? s.bankQR : null).then((qrImg) => {
    if (hasQR && !qrImg) {
      toast("⚠️ โหลด QR ไม่ได้ — บิลจะออกโดยไม่มี QR");
    }
    buildBill(qrImg);
  });
});

function renderBankQR() {
  if (!currentSession) return;
  if (currentSession.bankQR) {
    $("qrUploadSection").classList.add("hidden");
    $("qrDisplaySection").classList.remove("hidden");
    $("qrDisplaySection").classList.add("flex");
    $("bankQRImg").src = currentSession.bankQR;
    $("btnDownloadQR").classList.remove("hidden");
  } else {
    $("qrUploadSection").classList.remove("hidden");
    $("qrUploadSection").classList.add("flex");
    $("qrDisplaySection").classList.add("hidden");
    $("qrDisplaySection").classList.remove("flex");
    $("btnDownloadQR").classList.add("hidden");
  }
}

$("btnQR").addEventListener("click", () => {
  if (!currentSession) return;
  renderBankQR();
  $("qrModal").classList.remove("hidden");
});

$("fldBankQR").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement("canvas");
      const MAX_WIDTH = 600;
      let width = img.width;
      let height = img.height;
      if (width > MAX_WIDTH) {
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      // Save 3 places: localStorage (cache), session (Firestore), global defaults (Firestore)
      localStorage.setItem("defaultBankQR", dataUrl);
      Promise.all([
        saveSession({ bankQR: dataUrl }),
        saveGlobalDefaults({ bankQR: dataUrl })
      ]).then(() => {
        renderBankQR();
        toast("อัปโหลด QR Code สำเร็จ — ใช้ได้ทุกก๊วน ✓");
      });
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});

$("btnRemoveQR").addEventListener("click", () => {
  if (!confirm("ต้องการลบรูป QR Code รับเงินใช่หรือไม่? (จะลบทั้งระบบ — ก๊วนใหม่จะไม่มี QR)")) return;
  localStorage.removeItem("defaultBankQR");
  Promise.all([
    saveSession({ bankQR: null }),
    saveGlobalDefaults({ bankQR: null })
  ]).then(() => {
    $("fldBankQR").value = "";
    renderBankQR();
  });
});

$("btnCloseQR").addEventListener("click", () => $("qrModal").classList.add("hidden"));
$("qrModal").addEventListener("click", e => { if (e.target.id === "qrModal") $("qrModal").classList.add("hidden"); });

$("btnDownloadQR").addEventListener("click", () => {
  const img = $("bankQRImg");
  
  if (img && img.src) {
    const w = window.open();
    if (w) {
      w.document.write(`
        <!DOCTYPE html>
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;font-family:sans-serif;">
          <img src="${img.src}" style="width:100%;max-width:350px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
          <p style="margin-top:24px;color:#475569;font-weight:bold;">แตะค้างที่รูปภาพเพื่อบันทึกลงเครื่อง (Save Image)</p>
          <button onclick="window.close()" style="margin-top:20px;padding:10px 24px;border:none;background:#10b981;color:white;border-radius:8px;font-size:16px;">ปิดหน้าต่าง</button>
        </body>
        </html>
      `);
      w.document.close();
    } else {
      const a = document.createElement("a");
      a.href = img.src;
      a.download = `Bank_QR_${todayISO()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }
});

// ============================================================
// HISTORY VIEW
// ============================================================
// แสดงก๊วนล่าสุด 50 อัน — ก๊วนเก่ากว่านี้ยังอยู่ใน DB เข้าได้ผ่าน URL โดยตรง
const HISTORY_LIMIT = 50;

async function loadHistory() {
  const container = $("historyList");
  if (!container) return;
  
  if (unsubscribeList) { unsubscribeList(); unsubscribeList = null; }

  container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">กำลังโหลด...</p>`;
  try {
    const q = query(SESSIONS, orderBy("createdAt", "desc"), limit(HISTORY_LIMIT));
    unsubscribeList = onSnapshot(q, (snap) => {
      renderSessionList(container, snap, false);
    }, (err) => {
      console.error(err);
      container.innerHTML = `<p class="text-red-500 text-center py-6 text-sm">${err.message}</p>`;
    });
  } catch (err) {
    console.error(err);
  }
}

function renderSessionList(container, snap, isHome, isManager = false) {
  if (snap.empty) {
    container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">ยังไม่มีก๊วน${isHome ? " เริ่มก๊วนแรกได้เลย" : ""}</p>`;
    return;
  }

  const rows = [];
  snap.forEach(d => {
    const s = d.data();
    const totals = calcSessionTotals(s);
    const members = s.members || [];
    const isClosed = s.status === "closed";

    const cardClass = isClosed
      ? "block p-3 pr-10 rounded-xl border-2 border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:border-emerald-400 transition"
      : "block p-3 pr-10 rounded-xl border border-slate-100 dark:border-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-slate-800/50 transition";
    const priceClass = isClosed ? "font-bold text-emerald-700 dark:text-emerald-400" : "font-bold text-emerald-600 dark:text-emerald-500";
    const statusBadge = isClosed
      ? `<span class="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded">✓ ปิดแล้ว</span>`
      : `<span class="text-xs text-emerald-600 dark:text-emerald-500">เปิดอยู่</span>`;

    // Courts compact summary
    const courtNums = (s.courts || []).map(c => c.number).filter(Boolean);
    const courtSummary = courtNums.length > 0
      ? ` · 🏟️ ${escapeHtml(courtNums.join(","))}`
      : "";

// 1. ตรวจสอบรายชื่อคนที่ยังไม่ได้จ่ายเงิน
    let unpaidListHtml = "";
    if (isClosed) {
      const unpaidMembers = [];
      members.forEach((m, idx) => {
        // เช็คว่ายังไม่จ่าย และมียอดที่ต้องจ่ายมากกว่า 0
        if (!m.isPaid && totals.perMember && totals.perMember[idx] > 0) {
          unpaidMembers.push({ name: m.name, amount: totals.perMember[idx] });
        }
      });

      // 2. ถ้ามีคนค้างจ่าย ให้สร้าง HTML แสดงรายชื่อและจำนวนเงิน
      if (unpaidMembers.length > 0) {
        unpaidListHtml = `
          <div class="mt-2 pt-2 border-t border-emerald-100/50 dark:border-slate-700">
            <div class="text-[10px] font-semibold text-rose-600 dark:text-rose-400 mb-1">ค้างชำระ:</div>
            <div class="flex flex-wrap gap-1.5">
              ${unpaidMembers.map(u => `
                <span class="inline-flex items-center gap-1 bg-white dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 text-[10px] px-1.5 py-0.5 rounded shadow-sm">
                  <span class="truncate max-w-[80px]">${escapeHtml(u.name)}</span>
                  <span class="font-bold border-l border-rose-200 dark:border-rose-800/50 pl-1">${fmt(u.amount)}฿</span>
                </span>
              `).join("")}
            </div>
          </div>
        `;
      }
    }

    // 3. วาดการ์ดแสดงผล
    rows.push(`
      <div class="relative">
        <a href="#/${isManager ? 'm' : 'session'}/${d.id}" class="${cardClass}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-semibold truncate ${isClosed ? "text-emerald-900 dark:text-emerald-300" : "text-slate-800 dark:text-slate-200"}">${escapeHtml(s.location || "ก๊วน")}</div>
              <div class="text-xs ${isClosed ? "text-emerald-700/70 dark:text-emerald-400/70" : "text-slate-500 dark:text-slate-400"} mt-0.5">${formatDate(s.date)} · ${members.length} คน · ${totals.totalShuttles} ลูก${courtSummary}</div>
            </div>
            <div class="text-right flex flex-col items-end shrink-0">
              <div class="${priceClass}">${fmt(totals.totalAll)} ฿</div>
              <div class="mt-0.5">${statusBadge}</div>
            </div>
          </div>
          ${unpaidListHtml}
        </a>
        ${isManager ? '' : `
        <button data-quick-del="${d.id}" class="absolute top-3 right-2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="ลบก๊วนนี้">
          ✕
        </button>
        `}
      </div>
    `);
  });
  container.innerHTML = rows.join("");

  container.querySelectorAll("button[data-quick-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("ต้องการลบก๊วนนี้ทิ้งใช่หรือไม่? (ไม่สามารถกู้คืนได้)")) return;
      try {
        const delId = btn.dataset.quickDel;
        await deleteAllReceiptsForSession(delId);
        await deleteDoc(doc(db, "sessions", delId));
        toast("ลบก๊วนแล้ว");
        if (isHome) loadRecentSessions();
        else loadHistory();
      } catch (err) {
        toast("ลบไม่ได้: " + err.message);
      }
    });
  });
}

function calcSessionTotals(s) {
  const members = s.members || [];
  const matches = s.matches || [];
  const N = members.length;
  
  // ดึงตั้งค่าค่าใช้จ่าย
  const courtFee = +s.courtFee || 0;
  const courtFeeType = s.courtFeeType || "total"; 
  const shuttlePrice = +s.shuttlePrice || 0;
  const otherCost = +s.otherCost || 0;
  const otherCostType = s.otherCostType || "perPerson";

  // คำนวณลูกแบด
  const manualShuttles = members.reduce((sum, m) => sum + (m.shuttlesUsed || 0), 0);
  let matchShuttlesTotal = 0;
  const matchShuttlesMap = {};

  matches.forEach(match => {
    const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
    if (pIds.length === 0) return;

    const count = parseShuttleCount(match.shuttleNumbers, s);
    matchShuttlesTotal += count;
    
    // ตรวจสอบรายชื่อสมาชิกที่ถูกยกเว้นค่าลูกในเกมนี้
    const exemptPlayers = match.exemptPlayers || [];
    const activeExempts = pIds.filter(id => exemptPlayers.includes(id));
    const exemptCount = activeExempts.length;

    if (exemptCount > 0 && exemptCount < pIds.length) {
      // มีบางคนได้สิทธิ์ยกเว้น: ตัวหารน้อยลง คนที่เหลือแบกรับภาระค่าลูกของคนที่ถูกยกเว้นเพิ่มขึ้น
      const payingCount = pIds.length - exemptCount;
      const multiplier = pIds.length / payingCount; // เช่น ยกเว้น 2 คน จาก 4 คน -> multiplier = 4/2 = 2 เท่า!
      pIds.forEach(id => {
        if (!exemptPlayers.includes(id)) {
          matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + (count * multiplier);
        }
      });
    } else {
      // ไม่มีคนยกเว้น หรือยกเว้นทุกคน: จ่ายเฉลี่ยเท่ากันปกติ
      pIds.forEach(id => {
        matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + count;
      });
    }
  });

  const totalShuttles = manualShuttles + matchShuttlesTotal;

  // คำนวณค่าคอร์ดและค่าอื่นๆ ต่อคน
  const courtPer = N > 0 ? (courtFeeType === "total" ? courtFee / N : courtFee) : 0;
  const otherPer = N > 0 ? (otherCostType === "total" ? otherCost / N : otherCost) : 0;

  let totalAll = 0;
  let unpaidTotal = 0;

  // คำนวณยอดเงินรายบุคคล
  const perMember = members.map((m) => {
    // ✍️ Manual Override: ถ้ากำหนดราคาเองโดยผู้ดูแลระบบ ให้ใช้ราคานั้นโดยไม่สนการคำนวณใดๆ
    if (m.manualFee !== undefined && m.manualFee !== null && m.manualFee !== "" && !isNaN(m.manualFee)) {
      const cost = +m.manualFee;
      totalAll += cost;
      if (!m.isPaid) {
        unpaidTotal += cost;
      }
      return cost;
    }

    const individualShuttles = (m.shuttlesUsed || 0) + (matchShuttlesMap[m.id] || 0);
    
    // คำนวณจำนวนลูกที่จะคิดเงิน โดยลบส่วนที่ยกเว้นออก
    let payableShuttles = individualShuttles;
    if (m.excludeAllShuttles) {
      payableShuttles = 0;
    } else if (m.shuttlesExcluded && m.shuttlesExcluded > 0) {
      payableShuttles = Math.max(0, individualShuttles - m.shuttlesExcluded);
    }

    const cost = courtPer + otherPer + (payableShuttles * shuttlePrice);
    
    totalAll += cost;

    // ถ้ายอดนี้ยังไม่ถูกทำเครื่องหมายว่าจ่ายแล้ว ให้บวกเข้ายอดค้างชำระ
    if (!m.isPaid) {
      unpaidTotal += cost;
    }

    return cost;
  });

  return { totalShuttles, totalAll, unpaidTotal, perMember };
}

function formatDate(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

// ============================================================
// PWA Install Button
// ============================================================
let deferredInstallPrompt = null;
const INSTALL_DISMISSED_KEY = "installDismissed";

// Detect platform
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isInStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}

// Show/hide install banner based on platform
function updateInstallBanner() {
  const banner = $("installBanner");
  if (!banner) return;

  // Already installed as PWA — hide
  if (isInStandaloneMode()) {
    banner.classList.add("hidden");
    return;
  }

  // User dismissed before — hide (reset after 7 days)
  const dismissed = parseInt(localStorage.getItem(INSTALL_DISMISSED_KEY) || "0", 10);
  if (dismissed > Date.now()) {
    banner.classList.add("hidden");
    return;
  }

  // Android/Desktop: show only if beforeinstallprompt was captured
  // iOS: always show (will open instruction modal)
  if (isIOS() || deferredInstallPrompt) {
    banner.classList.remove("hidden");
  }
}

// Capture beforeinstallprompt (Android / Desktop Chrome)
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallBanner();
});

// Handle install button click
$("btnInstallApp")?.addEventListener("click", async () => {
  if (isIOS()) {
    // iOS: show instruction modal
    $("iosInstallModal")?.classList.remove("hidden");
    return;
  }

  if (deferredInstallPrompt) {
    // Android/Desktop: trigger native install prompt
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    if (result.outcome === "accepted") {
      toast("ติดตั้ง BadCount สำเร็จ! 🎉");
      $("installBanner")?.classList.add("hidden");
    }
    deferredInstallPrompt = null;
  }
});

// Close iOS modal
$("btnCloseIosModal")?.addEventListener("click", () => {
  $("iosInstallModal")?.classList.add("hidden");
  // Dismiss banner for 7 days
  localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
  $("installBanner")?.classList.add("hidden");
});

// Hide banner when app is installed
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("installBanner")?.classList.add("hidden");
  toast("ติดตั้ง BadCount สำเร็จ! 🎉");
});

// Check on page load (after a short delay for iOS detection)
setTimeout(updateInstallBanner, 1000);

// ============================================================
// ADMIN SUMMARY & PERSONAL STATS
// ============================================================

// --- Admin Summary ---
async function loadAdminSummaryData(filterType) {
  const container = $("adminSummaryResult");
  if (!container) return;
  
  container.classList.add("hidden");
  $("asPeriod").textContent = "กำลังคำนวณ...";
  container.classList.remove("hidden");

  try {
    const snap = await getDocs(SESSIONS);
    let totalCourt = 0, totalShuttle = 0, totalOther = 0;
    let closedRevenue = 0, expectedCollection = 0, unpaid = 0;
    const now = new Date();
    const currYear = String(now.getFullYear());
    const currMonth = String(now.getMonth() + 1).padStart(2, '0');

    snap.forEach(doc => {
      const s = doc.data();
      if (!s.date) return;
      
      let match = false;
      if (filterType === 'all') match = true;
      else if (filterType === 'year' && s.date.startsWith(currYear)) match = true;
      else if (filterType === 'month' && s.date.startsWith(`${currYear}-${currMonth}`)) match = true;

      if (match) {
        const totals = calcTotals(s);
        totalCourt += totals.totalCourtCost || 0;
        totalShuttle += totals.totalShuttleCost || 0;
        totalOther += totals.totalOtherCost || 0;
        
        // Expected collection is sum of what every member owes
        const sessionExpected = (totals.perMember || []).reduce((sum, cost) => sum + cost, 0);
        expectedCollection += sessionExpected;

        // Unpaid is sum of what unpaid members owe
        let sessionUnpaid = 0;
        (s.members || []).forEach((m, idx) => {
          if (!m.isPaid) sessionUnpaid += (totals.perMember[idx] || 0);
        });
        unpaid += sessionUnpaid;

        // รายรับปิดคอร์ด (Revenue) — คำนวณเฉพาะ session ที่ปิดคอร์ดแล้วเท่านั้น
        if (s.status === "closed") {
          closedRevenue += sessionExpected;
        }
      }
    });

    $("asTotalCourt").textContent = fmt(totalCourt) + " ฿";
    $("asTotalShuttle").textContent = fmt(totalShuttle) + " ฿";
    $("asTotalOther").textContent = fmt(totalOther) + " ฿";
    $("asActualCost").textContent = fmt(closedRevenue) + " ฿";
    $("asExpectedCollection").textContent = fmt(expectedCollection) + " ฿";
    $("asUnpaid").textContent = fmt(unpaid) + " ฿";

    let periodLabel = "ทั้งหมด (All Time)";
    if (filterType === 'month') periodLabel = `เดือน ${currMonth}/${currYear}`;
    else if (filterType === 'year') periodLabel = `ปี ${currYear}`;
    $("asPeriod").textContent = `ข้อมูล: ${periodLabel}`;

  } catch (err) {
    console.error(err);
    $("asPeriod").textContent = "เกิดข้อผิดพลาดในการโหลดข้อมูล";
  }
}

$("btnLoadAdminSummary")?.addEventListener("click", () => {
  loadAdminSummaryData($("fldAdminSummaryFilter").value);
});

// --- Personal Stats ---
async function loadPersonalStatsData(playerName, filterType) {
  const container = $("personalStatsResult");
  const namesToSearch = (playerName || "")
    .split("+")
    .map(n => n.trim().toLowerCase())
    .filter(Boolean);
  
  if (namesToSearch.length === 0) {
    toast("กรุณาใส่ชื่อผู้เล่น");
    return;
  }

  // จดจำชื่อไว้แนะนำคราวหน้า (แยกทีละชื่อ)
  (playerName || "").split("+").forEach(n => {
    const trimmed = n.trim();
    if (trimmed) {
      addKnownMember(trimmed);
    }
  });

  container.classList.add("hidden");
  $("psPeriod").textContent = "กำลังคำนวณ...";
  container.classList.remove("hidden");
  $("psName").textContent = playerName;

  try {
    const snap = await getDocs(query(SESSIONS, orderBy("date", "desc")));
    let sessionsCount = 0, gamesPlayed = 0, shuttlesUsed = 0, totalCost = 0;
    const historyList = [];
    const now = new Date();
    const currYear = String(now.getFullYear());
    const currMonth = String(now.getMonth() + 1).padStart(2, '0');

    snap.forEach(doc => {
      const s = doc.data();
      if (!s.date || !s.members) return;
      
      let match = false;
      if (filterType === 'all') match = true;
      else if (filterType === 'year' && s.date.startsWith(currYear)) match = true;
      else if (filterType === 'month' && s.date.startsWith(`${currYear}-${currMonth}`)) match = true;

      if (!match) return;

      // ค้นหาสมาชิกทั้งหมดในสัญจรนี้ที่มีชื่อตรงกับในรายการค้นหา
      const matchedMembers = [];
      s.members.forEach((m, idx) => {
        const mNameNormalized = (m.name || "").trim().toLowerCase();
        if (namesToSearch.includes(mNameNormalized)) {
          matchedMembers.push({ member: m, index: idx });
        }
      });

      if (matchedMembers.length > 0) {
        sessionsCount++;
        const totals = calcTotals(s);
        
        let sGames = 0;
        let sShuttles = 0;
        let sCost = 0;
        let sPaid = true;

        matchedMembers.forEach(({ member, index }) => {
          // Count games for this player
          let pGames = 0;
          (s.matches || []).forEach(matchObj => {
            const pIds = matchObj.players || [matchObj.a1, matchObj.a2, matchObj.b1, matchObj.b2].filter(Boolean);
            if (pIds.includes(member.id)) pGames++;
          });
          sGames += pGames;

          // Shuttles
          const pShuttles = (member.shuttlesUsed || 0) + (totals.matchShuttlesMap ? totals.matchShuttlesMap[member.id] || 0 : 0);
          sShuttles += pShuttles;

          // Cost
          const pCost = totals.perMember[index] || 0;
          sCost += pCost;

          if (!member.isPaid) {
            sPaid = false;
          }
        });

        gamesPlayed += sGames;
        shuttlesUsed += sShuttles;
        totalCost += sCost;

        if (historyList.length < 10) {
          historyList.push({
            date: s.date,
            location: s.location,
            cost: sCost,
            paid: sPaid
          });
        }
      }
    });

    $("psSessions").textContent = sessionsCount;
    $("psGames").textContent = gamesPlayed;
    $("psShuttles").textContent = shuttlesUsed;
    $("psTotalCost").textContent = fmt(totalCost) + " ฿";

    const histContainer = $("psHistoryList");
    if (historyList.length === 0) {
      histContainer.innerHTML = `<p class="text-slate-400 text-sm text-center py-2">ไม่พบประวัติการเล่นในช่วงเวลานี้</p>`;
    } else {
      histContainer.innerHTML = historyList.map(h => {
        const d = new Date(h.date);
        const dateStr = isNaN(d) ? h.date : d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
        return `
        <div class="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg text-sm">
          <div>
            <div class="font-bold text-slate-700 dark:text-slate-300">${dateStr}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(h.location || 'ไม่ระบุสถานที่')}</div>
          </div>
          <div class="text-right">
            <div class="font-bold ${h.paid ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${fmt(h.cost)} ฿</div>
            <div class="text-[10px] ${h.paid ? 'text-emerald-500' : 'text-rose-500'}">${h.paid ? 'จ่ายแล้ว' : 'ค้างจ่าย'}</div>
          </div>
        </div>
      `}).join("");
    }

    let periodLabel = "ทั้งหมด (All Time)";
    if (filterType === 'month') periodLabel = `เดือน ${currMonth}/${currYear}`;
    else if (filterType === 'year') periodLabel = `ปี ${currYear}`;
    $("psPeriod").textContent = `ข้อมูล: ${periodLabel}`;

  } catch (err) {
    console.error(err);
    $("psPeriod").textContent = "เกิดข้อผิดพลาดในการโหลดข้อมูล";
  }
}

$("btnLoadPersonalStats")?.addEventListener("click", () => {
  loadPersonalStatsData($("fldStatsPlayerName").value, $("fldStatsFilter").value);
});
$("fldStatsPlayerName")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    loadPersonalStatsData($("fldStatsPlayerName").value, $("fldStatsFilter").value);
  }
});

// ---------- Player Suggestions Cache ----------
let allPlayerNamesCache = null;

async function populatePlayerDatalist() {
  const datalist = $("playersDatalist");
  if (!datalist) return;

  // 1. เริ่มจากชื่อในเครื่องก่อน (เร็ว)
  let names = new Set(getKnownMembers());
  const updateUI = () => {
    const sortedNames = Array.from(names).sort((a, b) => a.localeCompare(b, 'th'));
    datalist.innerHTML = sortedNames.map(name => `<option value="${escapeHtml(name)}">`).join("");
  };
  
  updateUI();

  // 2. ถ้าเคยโหลดจาก Cloud แล้วในเซสชันนี้ ให้ใช้ของเดิม
  if (allPlayerNamesCache) {
    names = allPlayerNamesCache;
    updateUI();
    return;
  }

  // 3. ดึงจาก Cloud (ทุกก๊วน) เพื่อความครอบคลุม
  try {
    const q = query(SESSIONS);
    const snap = await getDocs(q);
    snap.forEach(doc => {
      const s = doc.data();
      (s.members || []).forEach(m => {
        if (m.name) {
          const trimmed = m.name.trim();
          if (trimmed) names.add(trimmed);
        }
      });
    });
    allPlayerNamesCache = names;
    updateUI();
  } catch (err) {
    console.warn("Failed to fetch all player names for suggestions:", err);
  }
}

let editingPlayerIdx = null;
let editingPlayerIsAdmin = true;
let editingPlayerSkill = null;
let editingPlayerBuddyId = null;

// Public Join form state
let currentJoinSkill = null;

function populateBuddyDropdown(selectEl, currentBuddyId, excludeMemberId = null) {
  if (!selectEl) return;
  const members = currentSession?.members || [];
  let html = '<option value="">ไม่มี Buddy</option>';
  members.forEach(m => {
    if (excludeMemberId && m.id === excludeMemberId) return;
    const selected = m.id === currentBuddyId ? 'selected' : '';
    html += `<option value="${m.id}" ${selected}>${escapeHtml(m.name)}</option>`;
  });
  selectEl.innerHTML = html;
}

function updateJoinSkillUI() {
  const container = $("joinSkillSection");
  if (!container) return;
  container.querySelectorAll("button[data-join-skill]").forEach(btn => {
    const s = btn.dataset.joinSkill;
    if (s === currentJoinSkill) {
      btn.className = "py-2.5 rounded-xl font-bold border transition-all text-sm flex flex-col items-center justify-center bg-indigo-600 border-indigo-600 text-white shadow-md scale-95";
    } else {
      btn.className = "py-2.5 rounded-xl font-bold border transition-all text-sm flex flex-col items-center justify-center bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800";
    }
  });
}

// Bind Join Form selectors
$("joinSkillSection")?.querySelectorAll("button[data-join-skill]").forEach(btn => {
  btn.addEventListener("click", () => {
    currentJoinSkill = btn.dataset.joinSkill;
    updateJoinSkillUI();
  });
});

// Settings Modal controls
function updateModalSkillUI() {
  const container = $("playerModalSkillSection");
  if (!container) return;
  container.querySelectorAll("button[data-skill-opt]").forEach(btn => {
    const s = btn.dataset.skillOpt;
    if (s === editingPlayerSkill) {
      btn.className = "py-2.5 rounded-xl font-bold border transition-all text-sm flex flex-col items-center justify-center bg-indigo-600 border-indigo-600 text-white shadow-md scale-95";
    } else {
      btn.className = "py-2.5 rounded-xl font-bold border transition-all text-sm flex flex-col items-center justify-center bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800";
    }
  });
}

// Bind Settings Modal selectors
$("playerModalSkillSection")?.querySelectorAll("button[data-skill-opt]").forEach(btn => {
  btn.addEventListener("click", () => {
    // Toggle: re-clicking the active skill clears it
    editingPlayerSkill = (editingPlayerSkill === btn.dataset.skillOpt) ? null : btn.dataset.skillOpt;
    updateModalSkillUI();
  });
});

// Close player modal
$("btnClosePlayerSettings")?.addEventListener("click", () => $("playerSettingsModal").classList.add("hidden"));
$("playerSettingsModal")?.addEventListener("click", e => {
  if (e.target.id === "playerSettingsModal") $("playerSettingsModal").classList.add("hidden");
});

$("btnEditPlayerName")?.addEventListener("click", () => {
  const currentName = $("playerModalName").textContent.trim();
  const newName = prompt("แก้ไขชื่อผู้เล่น:", currentName);
  if (newName !== null && newName.trim() !== "") {
    $("playerModalName").textContent = newName.trim();
  }
});

function openPlayerSettingsModal(idx, isAdminView) {
  const members = currentSession?.members || [];
  const m = members[idx];
  if (!m) return;
  
  editingPlayerIdx = idx;
  editingPlayerIsAdmin = isAdminView;
  editingPlayerSkill = m.skill || null;
  editingPlayerBuddyId = m.buddyId || members.find(x => x.buddyId === m.id)?.id || null;
  
  $("playerModalName").textContent = m.name;
  
  // The settings modal is only accessible by administrators/managers.
  // We always show both the Skill and Buddy sections so they can configure players at any time.
  const skillSec = $("playerModalSkillSection");
  const buddySec = $("playerModalBuddySection");
  
  if (skillSec) skillSec.classList.remove("hidden");
  if (buddySec) {
    buddySec.classList.remove("hidden");
    // Populate Buddy dropdown
    populateBuddyDropdown($("fldPlayerBuddy"), editingPlayerBuddyId, m.id);
  }
  
  // Populate Shuttle Exclusion fields
  const fldExType = $("fldPlayerExclusionType");
  const fldExCount = $("fldPlayerExclusionCount");
  const countSec = $("playerExclusionCountSection");
  if (fldExType && fldExCount && countSec) {
    if (m.excludeAllShuttles) {
      fldExType.value = "all";
      fldExCount.value = "";
      countSec.classList.add("hidden");
    } else if (m.shuttlesExcluded && m.shuttlesExcluded > 0) {
      fldExType.value = "partial";
      fldExCount.value = m.shuttlesExcluded;
      countSec.classList.remove("hidden");
    } else {
      fldExType.value = "none";
      fldExCount.value = "";
      countSec.classList.add("hidden");
    }
  }

  // Populate Manual Fee field
  const fldManualFee = $("fldPlayerManualFee");
  if (fldManualFee) {
    fldManualFee.value = (m.manualFee !== undefined && m.manualFee !== null) ? m.manualFee : "";
  }

  // Render current values
  updateModalSkillUI();
  
  $("playerSettingsModal").classList.remove("hidden");
}

$("btnSavePlayerSettings")?.addEventListener("click", async () => {
  if (editingPlayerIdx === null) return;
  
  const saveBtn = $("btnSavePlayerSettings");
  saveBtn.disabled = true;
  saveBtn.textContent = "กำลังบันทึก...";
  
  try {
    const ref = doc(db, "sessions", currentSessionId);
    const chosenBuddyId = $("fldPlayerBuddy")?.value || null;
    const exType = $("fldPlayerExclusionType")?.value || "none";
    const exCountVal = $("fldPlayerExclusionCount")?.value.trim() || "";
    const manualFeeVal = $("fldPlayerManualFee")?.value.trim() || "";
    const chosenName = $("playerModalName").textContent.trim();
    
    let finalExcludeAllShuttles = false;
    let finalShuttlesExcluded = 0;
    
    if (exType === "all") {
      finalExcludeAllShuttles = true;
    } else if (exType === "partial") {
      if (exCountVal === "" || isNaN(parseInt(exCountVal, 10))) {
        finalExcludeAllShuttles = true;
      } else {
        finalShuttlesExcluded = Math.max(1, parseInt(exCountVal, 10));
      }
    }

    let finalManualFee = null;
    if (manualFeeVal !== "" && !isNaN(parseFloat(manualFeeVal))) {
      finalManualFee = parseFloat(manualFeeVal);
    }
    
    if (editingPlayerIsAdmin) {
      // Admin View - modify in currentSession.members directly
      const members = [...(currentSession.members || [])];
      if (members[editingPlayerIdx]) {
        const currentPlayer = members[editingPlayerIdx];
        members.forEach(y => {
          if (y.id !== currentPlayer.id && y.buddyId === currentPlayer.id) {
            if (chosenBuddyId !== y.id) y.buddyId = null;
          }
        });
        members[editingPlayerIdx] = {
          ...currentPlayer,
          name: chosenName, // Save edited name
          skill: editingPlayerSkill || null,
          buddyId: chosenBuddyId,
          excludeAllShuttles: finalExcludeAllShuttles,
          shuttlesExcluded: finalShuttlesExcluded,
          manualFee: finalManualFee
        };
      }
      await saveSession({ members });
      toast("บันทึกการตั้งค่าผู้เล่นสำเร็จ ✨");
    } else {
      // User View - fetch snapshot to avoid race conditions, then save
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("ไม่พบข้อมูลก๊วน");
      
      const s = snap.data();
      const members = [...(s.members || [])];
      if (members[editingPlayerIdx]) {
        const currentPlayer = members[editingPlayerIdx];
        members.forEach(y => {
          if (y.id !== currentPlayer.id && y.buddyId === currentPlayer.id) {
            if (chosenBuddyId !== y.id) y.buddyId = null;
          }
        });
        members[editingPlayerIdx] = {
          ...currentPlayer,
          name: chosenName, // Save edited name
          skill: editingPlayerSkill || null,
          buddyId: chosenBuddyId,
          excludeAllShuttles: finalExcludeAllShuttles,
          shuttlesExcluded: finalShuttlesExcluded,
          manualFee: finalManualFee
        };
      }
      await updateDoc(ref, { members });
      toast("ตั้งค่าผู้เล่นเรียบร้อยครับ ✨");
    }
    
    $("playerSettingsModal").classList.add("hidden");
  } catch (err) {
    console.error(err);
    toast("เกิดข้อผิดพลาด: " + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "บันทึกตั้งค่า";
  }
});

// ============================================================
// Init
// ============================================================
route();

// ---------- Register Service Worker (PWA support) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => console.log("[PWA] Service worker registered"))
      .catch((err) => console.warn("[PWA] SW registration failed:", err));
  });
}


// ---------- พักคิวสมาชิก (Pause Queue Management) ----------
function openPauseMembersModal() {
  if (!currentSession) return;
  const container = $("pauseMembersListContainer");
  if (!container) return;

  const members = currentSession.members || [];
  if (members.length === 0) {
    container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">ยังไม่มีสมาชิก</p>`;
  } else {
    container.innerHTML = members.map((m, idx) => {
      const isPaused = !!m.isPaused;
      return `
        <div class="flex items-center justify-between py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/30 px-2 rounded-lg transition-colors cursor-pointer">
          <label class="flex items-center gap-3 w-full cursor-pointer select-none">
            <input type="checkbox" data-pause-idx="${idx}" class="w-5 h-5 accent-amber-600 rounded cursor-pointer border-slate-300 dark:border-slate-600 dark:bg-slate-900" ${isPaused ? 'checked' : ''} />
            <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">${escapeHtml(m.name)}</span>
          </label>
        </div>
      `;
    }).join("");
  }

  $("pauseMembersModal").classList.remove("hidden");
}

async function savePauseMembers() {
  if (!currentSession) return;
  const container = $("pauseMembersListContainer");
  if (!container) return;

  const saveBtn = $("btnSavePauseMembers");
  saveBtn.disabled = true;
  const originalText = saveBtn.textContent;
  saveBtn.textContent = "กำลังบันทึก...";

  try {
    const members = [...(currentSession.members || [])];
    const checkboxes = container.querySelectorAll("input[data-pause-idx]");
    checkboxes.forEach(cb => {
      const idx = parseInt(cb.dataset.pauseIdx, 10);
      if (members[idx]) {
        members[idx].isPaused = cb.checked;
      }
    });

    await saveSession({ members });
    toast("✓ บันทึกสถานะการพักคิวแล้ว ⏸️");
    $("pauseMembersModal").classList.add("hidden");
  } catch (err) {
    console.error(err);
    toast("เกิดข้อผิดพลาด: " + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

// === [PATCH] Clear-all player skills (with confirm) ===
async function clearAllPlayerSkills() {
  if (!currentSession || !Array.isArray(currentSession.members) || currentSession.members.length === 0) {
    toast("ยังไม่มีสมาชิก");
    return;
  }
  const haveSkillCount = currentSession.members.filter(m => m && m.skill).length;
  if (haveSkillCount === 0) {
    toast("ยังไม่มีใครตั้งระดับมือ");
    return;
  }
  const ok = confirm("ยืนยันล้างระดับมือของสมาชิกทั้งหมด " + haveSkillCount + " คน?\nการกระทำนี้ย้อนกลับไม่ได้");
  if (!ok) return;
  const members = currentSession.members.map(m => {
    const copy = Object.assign({}, m || {});
    delete copy.skill;
    return copy;
  });
  try {
    await saveSession({ members });
    toast("ล้างระดับมือทั้งหมดเรียบร้อย");
  } catch (e) {
    console.error("[clearAllPlayerSkills] save failed:", e);
    toast("บันทึกไม่สำเร็จ ลองอีกครั้ง");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // LINE App In-App Browser Warning Banner
  const isLine = /Line/i.test(navigator.userAgent);
  const lineAlert = document.getElementById("lineBrowserAlert");
  const closeAlertBtn = document.getElementById("btnCloseLineAlert");
  if (isLine && lineAlert) {
    const isDismissed = sessionStorage.getItem("lineAlertDismissed") === "true";
    if (!isDismissed) {
      lineAlert.classList.remove("hidden");
    }
  }
  if (closeAlertBtn && lineAlert) {
    closeAlertBtn.addEventListener("click", () => {
      lineAlert.classList.add("hidden");
      sessionStorage.setItem("lineAlertDismissed", "true");
    });
  }

  const clearBtn = document.getElementById("btnClearAllSkills");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAllPlayerSkills);
  }

  // Bind Pause Queue event listeners
  const pauseBtn = document.getElementById("btnPauseMembers");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", openPauseMembersModal);
  }
  const closePauseBtn = document.getElementById("btnClosePauseMembers");
  if (closePauseBtn) {
    closePauseBtn.addEventListener("click", () => {
      $("pauseMembersModal").classList.add("hidden");
    });
  }
  const savePauseBtn = document.getElementById("btnSavePauseMembers");
  if (savePauseBtn) {
    savePauseBtn.addEventListener("click", savePauseMembers);
  }
  const pauseModal = $("pauseMembersModal");
  if (pauseModal) {
    pauseModal.addEventListener("click", (e) => {
      if (e.target === pauseModal) {
        pauseModal.classList.add("hidden");
      }
    });
  }

  // Bind Shuttle Exclusion event listeners inside player settings modal
  const playerExclusionTypeSelect = document.getElementById("fldPlayerExclusionType");
  if (playerExclusionTypeSelect) {
    playerExclusionTypeSelect.addEventListener("change", () => {
      const type = playerExclusionTypeSelect.value;
      const countSection = $("playerExclusionCountSection");
      if (type === "partial") {
        countSection.classList.remove("hidden");
      } else {
        countSection.classList.add("hidden");
      }
    });
  }

  // Bind team-level shuttle exemption button clicks
  const btnExemptA = document.getElementById("btnExemptTeamA");
  if (btnExemptA) {
    btnExemptA.addEventListener("click", (e) => {
      e.stopPropagation();
      const pA1 = matchDraftPlayers[0];
      const pA2 = matchDraftPlayers[1];
      const pIdsA = [pA1, pA2].filter(Boolean);
      if (pIdsA.length === 0) return toast("เลือกผู้เล่นทีม A ก่อนครับ");

      const pB1 = matchDraftPlayers[2];
      const pB2 = matchDraftPlayers[3];
      const pIdsB = [pB1, pB2].filter(Boolean);
      if (pIdsB.length === 0) return toast("เลือกผู้เล่นทีม B ก่อนครับ");

      const allBExempt = pIdsB.every(id => matchDraftExempts.includes(id));
      if (allBExempt) {
        // Clear all team exemptions (making neither team responsible)
        matchDraftExempts = matchDraftExempts.filter(id => !pIdsB.includes(id) && !pIdsA.includes(id));
        toast("ยกเลิก บวกลูกทีม A 🏸");
      } else {
        // Exempt Team B (making Team A responsible), and clear Team A exemption
        matchDraftExempts = matchDraftExempts.filter(id => !pIdsA.includes(id));
        pIdsB.forEach(id => {
          if (!matchDraftExempts.includes(id)) matchDraftExempts.push(id);
        });
        toast("บวกลูก Team A (ทีม A รับผิดชอบค่าลูกทั้งหมด) 🏸");
      }
      renderMatchDraft();
    });
  }

  const btnExemptB = document.getElementById("btnExemptTeamB");
  if (btnExemptB) {
    btnExemptB.addEventListener("click", (e) => {
      e.stopPropagation();
      const pB1 = matchDraftPlayers[2];
      const pB2 = matchDraftPlayers[3];
      const pIdsB = [pB1, pB2].filter(Boolean);
      if (pIdsB.length === 0) return toast("เลือกผู้เล่นทีม B ก่อนครับ");

      const pA1 = matchDraftPlayers[0];
      const pA2 = matchDraftPlayers[1];
      const pIdsA = [pA1, pA2].filter(Boolean);
      if (pIdsA.length === 0) return toast("เลือกผู้เล่นทีม A ก่อนครับ");

      const allAExempt = pIdsA.every(id => matchDraftExempts.includes(id));
      if (allAExempt) {
        // Clear all team exemptions
        matchDraftExempts = matchDraftExempts.filter(id => !pIdsA.includes(id) && !pIdsB.includes(id));
        toast("ยกเลิก บวกลูกทีม B 🏸");
      } else {
        // Exempt Team A (making Team B responsible), and clear Team B exemption
        matchDraftExempts = matchDraftExempts.filter(id => !pIdsB.includes(id));
        pIdsA.forEach(id => {
          if (!matchDraftExempts.includes(id)) matchDraftExempts.push(id);
        });
        toast("บวกลูก Team B (ทีม B รับผิดชอบค่าลูกทั้งหมด) 🏸");
      }
      renderMatchDraft();
    });
  }

  // ระบบปุ่มบวกลดจำนวนลูกแบดในป็อปอัปจัดเกม (Match Modal Stepper)
  const btnMatchDec = document.getElementById("btnMatchDecShuttles");
  const btnMatchInc = document.getElementById("btnMatchIncShuttles");
  const fldShuttlesInput = document.getElementById("fldMatchShuttles");
  const stepperDisplayEl = document.getElementById("displayMatchShuttles");

  if (btnMatchDec && btnMatchInc && fldShuttlesInput && stepperDisplayEl) {
    btnMatchDec.addEventListener("click", () => {
      const isSimple = !!currentSession?.simpleShuttleCount;
      if (isSimple) {
        let count = parseInt(fldShuttlesInput.value, 10) || 0;
        count = Math.max(0, count - 1);
        fldShuttlesInput.value = String(count);
        stepperDisplayEl.textContent = count;
      } else {
        const val = fldShuttlesInput.value;
        const nums = listShuttleNumbers(val);
        if (nums.length > 0) {
          nums.sort((a, b) => a - b);
          nums.pop();
        }
        const newVal = formatShuttleNumbers(nums);
        fldShuttlesInput.value = newVal;
        stepperDisplayEl.textContent = nums.length;
      }
    });

    btnMatchInc.addEventListener("click", () => {
      const isSimple = !!currentSession?.simpleShuttleCount;
      if (isSimple) {
        let count = parseInt(fldShuttlesInput.value, 10) || 0;
        count = count + 1;
        fldShuttlesInput.value = String(count);
        stepperDisplayEl.textContent = count;
      } else {
        const val = fldShuttlesInput.value;
        const nums = listShuttleNumbers(val);
        const nextFree = getNextUnusedShuttle(nums);
        nums.push(nextFree);
        const newVal = formatShuttleNumbers(nums);
        fldShuttlesInput.value = newVal;
        stepperDisplayEl.textContent = nums.length;
      }
    });

    // ซิงค์จำนวนลูกบน Stepper ขณะที่ผู้ใช้พิมพ์ในกล่องข้อความแบบ Real-time
    fldShuttlesInput.addEventListener("input", () => {
      const isSimple = !!currentSession?.simpleShuttleCount;
      if (!isSimple) {
        const nums = listShuttleNumbers(fldShuttlesInput.value);
        stepperDisplayEl.textContent = nums.length;
      }
    });
  }
});

// ============================================================
// 📱 Android Hardware Back Button Modal Closing Integration
// ============================================================
(function() {
  const modalIds = [
    "testPromptPayModal",
    "iosInstallModal",
    "qrModal",
    "matchModal",
    "paymentModal",
    "slipViewerModal",
    "cameraScanModal",
    "playerSettingsModal",
    "pauseMembersModal",
    "statsModal",
    "auditLogModal"
  ];

  // เก็บลำดับ Modals ที่เปิดอยู่ (เพื่อใช้เวลา Hashเปลี่ยน หรือปิดตามลำดับ LIFO ในเคสอื่นๆ)
  let openModalsStack = [];

  function updateBodyScrollLock() {
    if (openModalsStack.length > 0) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
  }

  // มอนิเตอร์การเปิด-ปิด Modals ด้วย MutationObserver
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === "class") {
        const target = mutation.target;
        const isHidden = target.classList.contains("hidden");
        const modalId = target.id;

        if (!isHidden) {
          // Modal ถูกเปิด!
          if (!openModalsStack.includes(modalId)) {
            openModalsStack.push(modalId);
            console.log(`[ModalHistory] Opened: ${modalId}, stack:`, openModalsStack);
            updateBodyScrollLock();
            
            // เช็คว่าประวัติศาสตร์ปัจจุบันไม่ได้มีสถานะของ Modal ตัวนี้อยู่ก่อนแล้ว เพื่อป้องกันการ push ซ้ำ
            if (!history.state || history.state.modalId !== modalId) {
              history.pushState({ isModal: true, modalId: modalId }, "");
            }
          }
        } else {
          // Modal ถูกปิด!
          const index = openModalsStack.indexOf(modalId);
          if (index !== -1) {
            openModalsStack.splice(index, 1);
            console.log(`[ModalHistory] Closed: ${modalId}, stack:`, openModalsStack);
            updateBodyScrollLock();
            
            // หากประวัติศาสตร์ปัจจุบันยังชี้ไปที่ Modal นี้อยู่ (แปลว่าถูกปิดแบบแมนนวล เช่น กดปิดปุ่ม X)
            // เราต้องย้อนประวัติศาสตร์กลับ 1 ขั้นเพื่อให้ประวัติศาสตร์สอดคล้องกับ UI
            if (history.state && history.state.isModal && history.state.modalId === modalId) {
              history.back();
            }
          }
        }
      }
    });
  });

  // รอให้ DOM โหลดเต็มที่แล้วเริ่มการผูกการสังเกตการณ์
  function initModalObserver() {
    modalIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el, { attributes: true, attributeFilter: ["class"] });
        // กรณีเริ่มต้นถ้าเปิดอยู่ (ปกติจะซ่อนอยู่)
        if (!el.classList.contains("hidden")) {
          openModalsStack.push(id);
        }
      }
    });
    updateBodyScrollLock();

    // ฟังการเคลื่อนไหวย้อนกลับ (Back)
    window.addEventListener("popstate", (event) => {
      // ดึง modalId จาก state ปัจจุบันที่ย้อนกลับมาถึง (ถ้ามี)
      const stateModalId = (event.state && event.state.isModal) ? event.state.modalId : null;

      console.log(`[ModalHistory] Popstate fired. Current state modalId: ${stateModalId}, stack:`, openModalsStack);

      // วนลูปปิด Modal ที่ยังเปิดอยู่ใน stack แต่สถานะประวัติศาสตร์บอกว่าควรจะปิดไปแล้ว
      // โดยการลูปจากท้ายสุด (LIFO)
      for (let i = openModalsStack.length - 1; i >= 0; i--) {
        const modalId = openModalsStack[i];
        if (modalId !== stateModalId) {
          const el = document.getElementById(modalId);
          if (el && !el.classList.contains("hidden")) {
            console.log(`[ModalHistory] Intercepted back action! Closing: ${modalId}`);
            el.classList.add("hidden");
          }
        }
      }
    });

    // เมื่อ URL Hash เปลี่ยน (เช่น ผู้ใช้กดปุ่มเมนู Home หรือ Back เพื่อเปลี่ยนหน้า)
    // ให้ปิด Modals ทั้งหมดที่เปิดค้างอยู่
    window.addEventListener("hashchange", () => {
      if (openModalsStack.length > 0) {
        console.log("[ModalHistory] Hash changed, closing all modals:", openModalsStack);
        // ทำสำเนาเพื่อความปลอดภัยขณะวนลูปปิด
        const toClose = [...openModalsStack];
        toClose.reverse().forEach((modalId) => {
          const el = document.getElementById(modalId);
          if (el) {
            el.classList.add("hidden");
          }
        });
        openModalsStack = [];
        updateBodyScrollLock();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initModalObserver);
  } else {
    initModalObserver();
  }
})();
