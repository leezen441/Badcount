// ============================================================
// BadCount — Badminton Session Tracker
// ============================================================

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------- Init Firebase ----------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const SESSIONS = collection(db, "sessions");

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

// ---------- Authentication ----------
// SHA-256 ของรหัส "SundayHH@" — ไม่เก็บรหัสตรงๆ ในซอร์ส
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
// ใช้ sessionStorage — ปิดเบราว์เซอร์แล้วต้องใส่ใหม่
const MANAGER_PASSCODE = "SHH123";
const MANAGER_AUTH_KEY = "bcManagerAuth";
const MANAGER_SESSIONS_KEY = "bcManagerSessions"; // จำ session ที่เคยเข้า

function isManagerAuthed() {
  return localStorage.getItem(MANAGER_AUTH_KEY) === "1";
}

function setManagerAuthed() {
  localStorage.setItem(MANAGER_AUTH_KEY, "1");
}

function getManagerSessions() {
  try {
    return JSON.parse(localStorage.getItem(MANAGER_SESSIONS_KEY) || "[]");
  } catch { return []; }
}

function saveManagerSession(id, dateText, ts) {
  let sessions = getManagerSessions();
  // Remove if exists
  sessions = sessions.filter(s => s.id !== id);
  // Add to top
  sessions.unshift({ id, dateText, ts: ts || Date.now() });
  // Keep only last 20
  if (sessions.length > 20) sessions.length = 20;
  localStorage.setItem(MANAGER_SESSIONS_KEY, JSON.stringify(sessions));
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

// คืนค่าเป็น array ของเบอร์ลูกแบด (อาจมีซ้ำได้) เพื่อให้ตรวจสอบเบอร์ซ้ำได้
function listShuttleNumbers(str) {
  if (!str) return [];
  const nums = [];
  const parts = String(str).trim().split(/[\s,]+/);
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

function parseShuttleCount(str) {
  if (!str) return 0;
  let count = 0;
  const parts = String(str).trim().split(/[\s,]+/);
  parts.forEach(p => {
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

function showBrowserNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const notif = new Notification(title, {
      body,
      icon: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏸</text></svg>`),
      tag: "badcount-newmember",     // ถ้ามีหลาย notification ติดกัน จะ overwrite อันเก่า
      requireInteraction: false,      // หายไปเองภายในไม่กี่วินาที
      silent: false
    });
    // คลิก → focus กลับมาที่ tab นี้
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    // Auto-close หลัง 6 วินาที (เผื่อ browser ไม่ auto-close)
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

  // ซ่อน nav เมื่ออยู่หน้า join, login, manager-login หรือ session แบบ manager-mode
  const logo = $("logoLink");
  const nav = $("mainNav");
  const shouldLockNav = name === "join" || name === "login" || name === "manager-login" || (name === "session" && opts.lockNav);

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
}

// ---------- Router (hash-based for GitHub Pages) ----------
function route() {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\/?/, "").split("/");

  // Clean up previous listeners
  if (unsubscribeSession) { unsubscribeSession(); unsubscribeSession = null; }
  if (joinUnsubscribe) { joinUnsubscribe(); joinUnsubscribe = null; }

  const authed = isAuthed();

  // #/m/{id} = manager link — ต้องใส่รหัส manager ก่อน (หรือเป็น admin authed อยู่แล้ว)
  // #/session/{id} = admin view — แสดง nav ถ้า authed, ล็อกถ้าไม่ authed
  if ((parts[0] === "session" || parts[0] === "m") && parts[1]) {
    currentSessionId = parts[1];
    const isManagerLink = parts[0] === "m";

    // Manager link: ถ้ายังไม่ผ่าน manager auth และไม่ใช่ admin → แสดงหน้าใส่รหัส
    if (isManagerLink && !authed && !isManagerAuthed()) {
      showView("manager-login");
      return;
    }

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

  // หน้าอื่นๆ (home, history) ต้อง login (Admin) ก่อน
  if (!authed) {
    // ถ้าไม่มีสิทธิ์ admin แต่มีสิทธิ์ manager ให้ไปหน้า manager home แทน
    if (isManagerAuthed() && (parts[0] === "" || parts[0] === "history")) {
      location.hash = "#/m-home";
      return;
    }
    showView("login");
    return;
  }

  if (parts[0] === "history") {
    showView("history");
    loadHistory();
  } else {
    showView("home");
    loadRecentSessions();
  }
}

// Render Manager Home
function renderManagerHome() {
  const list = $("managerSessionsList");
  if (!list) return;
  const sessions = getManagerSessions();
  
  if (sessions.length === 0) {
    list.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">ยังไม่มีกลุ่มที่เคยเข้าจัดการ<br>กรุณาเปิดลิงก์ Manager ที่ Admin ส่งให้</p>`;
    return;
  }

  list.innerHTML = sessions.map(s => `
    <a href="#/m/${s.id}" class="block bg-slate-50 hover:bg-emerald-50 border border-slate-100 p-4 rounded-xl transition-colors">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-bold text-slate-800">${s.dateText}</div>
          <div class="text-xs text-slate-500 mt-1 text-mono">${s.id}</div>
        </div>
        <div class="text-emerald-600 font-bold">→</div>
      </div>
    </a>
  `).join("");
}

let appHashHistory = [location.hash || "#/"];
window.addEventListener("hashchange", () => {
  if (appHashHistory[appHashHistory.length - 1] !== location.hash) {
    appHashHistory.push(location.hash || "#/");
  }
  route();
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
  container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">กำลังโหลด...</p>`;
  try {
    const q = query(SESSIONS, orderBy("createdAt", "desc"), limit(5));
    const snap = await getDocs(q);
    renderSessionList(container, snap, true);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="text-red-500 text-center py-6 text-sm">โหลดไม่ได้: ${err.message}<br/><span class="text-xs">ตรวจสอบ Firebase config และ Security Rules</span></p>`;
  }
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    const ref = await addDoc(SESSIONS, newSession);
    location.hash = `#/session/${ref.id}`;
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const ref = await addDoc(SESSIONS, newSession);
    toast(`สร้างก๊วน ${formatDate(nextSunday)} แล้ว 🎉`, 3000);
    location.hash = `#/session/${ref.id}`;
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

    // ถ้าเป็น Manager ให้จำ session นี้ไว้ในประวัติ
    if (location.hash.startsWith("#/m/") && isManagerAuthed()) {
      saveManagerSession(currentSessionId, formatDate(newSession.date), newSession.createdAt);
    }

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
    if (document.activeElement !== el) el.value = val ?? "";
  };
  setIfNotFocused($("fldLocation"), s.location);
  setIfNotFocused($("fldDate"), s.date);
  setIfNotFocused($("fldCourtFee"), s.courtFee || "");
  setIfNotFocused($("fldCourtFeeType"), s.courtFeeType || "perPerson");
  setIfNotFocused($("fldShuttlePrice"), s.shuttlePrice || "");
  setIfNotFocused($("fldOtherCostType"), s.otherCostType || "perPerson");
  setIfNotFocused($("fldOtherCost"), s.otherCost || "");

  // Status badge
  const badge = $("sessionStatusBadge");
  const btnClose = $("btnCloseSession");

  if (s.status === "closed") {
    badge.textContent = "ปิดแล้ว";
    badge.className = "text-xs font-semibold px-2 py-1 rounded-full bg-slate-200 text-slate-700 whitespace-nowrap";
    btnClose.innerHTML = "🔓 เปิด Court อีกครั้ง";
    // เปลี่ยนเป็นปุ่มสีเขียวอ่อนเมื่อก๊วนปิดแล้ว
    btnClose.className = "flex-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 py-3 rounded-lg font-medium transition-colors";
  } else {
    badge.textContent = "เปิดอยู่";
    badge.className = "text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap";
    btnClose.innerHTML = "✅ ปิด Court";
    // กลับเป็นปุ่มสีเทาปกติเมื่อก๊วนยังเปิดอยู่
    btnClose.className = "flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-medium transition-colors";
  }

  renderMembers();
  renderMemberSuggestions();
  renderMatches();
  renderSummary();
  renderCourts();
  updatePaymentReminder();
}

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
          <button id="btnSuggestCourts" class="px-3 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full font-medium transition-transform active:scale-95 shadow-sm">
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
    <div class="flex items-center gap-1.5 sm:gap-2 bg-slate-50 p-2 rounded-lg">
      <span class="text-xs font-bold text-slate-500 shrink-0">สนาม</span>
      <input type="text" data-court-id="${c.id}" data-field="number" placeholder="?" maxlength="6"
        value="${escapeHtml(c.number || '')}"
        class="w-14 text-center px-1 py-1 border border-slate-200 rounded font-bold text-sm focus:outline-none focus:border-emerald-500" />
      <span class="text-slate-400 text-sm shrink-0">🕐</span>
      <input type="time" data-court-id="${c.id}" data-field="startTime"
        value="${c.startTime || ''}"
        style="color-scheme: light;"
        class="text-xs px-1 py-1 border border-slate-200 rounded min-w-0 flex-1 focus:outline-none focus:border-emerald-500" />
      <span class="text-slate-400 shrink-0 text-xs">–</span>
      <input type="time" data-court-id="${c.id}" data-field="endTime"
        value="${c.endTime || ''}"
        style="color-scheme: light;"
        class="text-xs px-1 py-1 border border-slate-200 rounded min-w-0 flex-1 focus:outline-none focus:border-emerald-500" />
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
        <button data-quick-add="${escapeHtml(name)}" class="px-2.5 py-1 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full transition-transform active:scale-95 font-medium">
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

  const members = currentSession.members || [];
  if (members.length === 0) {
    card.classList.add("hidden");
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

  if (unpaidCount === 0) {
    card.classList.add("hidden");
  } else {
    card.classList.remove("hidden");
    $("unpaidCount").textContent = unpaidCount;
    $("unpaidTotal").textContent = fmt(unpaidTotal);
  }
}

$("btnCopyDueList").addEventListener("click", () => {
  if (!currentSession) return;
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

  const totalDue = unpaid.reduce((sum, x) => sum + x.amount, 0);
  const hasQR = !!s.bankQR;

  // Load QR image safely (same pattern as Export Bill — works on mobile)
  const loadImageSafe = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
    const timer = setTimeout(() => { console.warn("[Reminder] QR timeout"); finish(null); }, 10000);
    img.onload = () => {
      if (typeof img.decode === "function") {
        img.decode().then(() => { clearTimeout(timer); finish(img); }).catch(() => { clearTimeout(timer); finish(img); });
      } else {
        clearTimeout(timer); finish(img);
      }
    };
    img.onerror = () => { clearTimeout(timer); finish(null); };
    img.src = src;
    if (img.complete && img.naturalWidth > 0) img.onload();
  });

  const buildReminder = (qrImg) => {
    // Layout constants
    const W = 540;
    const PAD = 32;
    const innerW = W - PAD * 2;
    const rowH = 40;
    const FONT = "'Sarabun', -apple-system, 'Segoe UI', sans-serif";

    // QR sizing (preserve aspect ratio)
    let qrW = 0, qrH = 0;
    if (qrImg) {
      const maxQrSize = 260;
      const aspect = qrImg.width / qrImg.height;
      if (aspect >= 1) { qrW = maxQrSize; qrH = Math.round(maxQrSize / aspect); }
      else { qrH = maxQrSize; qrW = Math.round(maxQrSize * aspect); }
    }

    // Calculate height
    let H = 0;
    H += 56;                                  // top accent + title margin
    H += 28;                                  // title
    H += 22;                                  // subtitle
    H += 36;                                  // gap before list
    H += 24;                                  // list header underline
    H += unpaid.length * rowH + 8;            // rows
    H += 20;                                  // gap before total
    H += 56;                                  // total box
    if (qrImg) H += 28 + 18 + qrH + 24;       // QR section
    H += 40;                                  // footer

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Top accent gradient (rose theme — "ค้างจ่าย")
    const topGrad = ctx.createLinearGradient(0, 0, W, 0);
    topGrad.addColorStop(0, "#f43f5e");
    topGrad.addColorStop(1, "#e11d48");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 6);

    // ===== Title =====
    let y = 50;
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 22px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText("⏳ ทวงค่าแบดมินตัน", W / 2, y);

    y += 24;
    ctx.fillStyle = "#64748b";
    ctx.font = "13px " + FONT;
    const subtitle = (s.location ? s.location + "  ·  " : "") + formatDate(s.date);
    ctx.fillText(subtitle, W / 2, y);

    y += 36;

    // ===== List header =====
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 11px " + FONT;
    ctx.textAlign = "left";
    ctx.fillText(`ยังไม่จ่าย ${unpaid.length} คน`, PAD, y);
    ctx.textAlign = "right";
    ctx.fillText("ยอดที่ค้าง", W - PAD, y);

    y += 8;
    ctx.beginPath();
    ctx.strokeStyle = "#fecdd3";
    ctx.lineWidth = 1;
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();

    y += 22;

    // ===== Unpaid rows =====
    unpaid.forEach((u, idx) => {
      // Status dot (rose, indicating unpaid)
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(PAD + 7, y - 6, 6, 0, Math.PI * 2);
      ctx.fill();

      // Name
      ctx.fillStyle = "#0f172a";
      ctx.font = "17px " + FONT;
      ctx.textAlign = "left";
      ctx.fillText(u.name, PAD + 22, y);

      // Amount
      ctx.fillStyle = "#dc2626";
      ctx.font = "bold 18px " + FONT;
      ctx.textAlign = "right";
      ctx.fillText(fmt(u.amount) + " ฿", W - PAD, y);

      // Divider
      if (idx < unpaid.length - 1) {
        ctx.beginPath();
        ctx.strokeStyle = "#fef2f2";
        ctx.lineWidth = 1;
        ctx.moveTo(PAD, y + 12);
        ctx.lineTo(W - PAD, y + 12);
        ctx.stroke();
      }
      y += rowH;
    });

    y += 12;

    // ===== Total box =====
    const totalBoxY = y;
    ctx.fillStyle = "#fff1f2";
    roundRectPath(ctx, PAD, totalBoxY, innerW, 50, 12);
    ctx.fill();

    ctx.fillStyle = "#9f1239";
    ctx.font = "bold 16px " + FONT;
    ctx.textAlign = "left";
    ctx.fillText("รวมค้างจ่าย", PAD + 18, totalBoxY + 32);
    ctx.fillStyle = "#dc2626";
    ctx.font = "bold 22px " + FONT;
    ctx.textAlign = "right";
    ctx.fillText(fmt(totalDue) + " ฿", W - PAD - 18, totalBoxY + 32);

    y = totalBoxY + 56;

    // ===== QR section =====
    if (qrImg) {
      y += 28;
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 14px " + FONT;
      ctx.textAlign = "center";
      ctx.fillText("📱 สแกน QR เพื่อโอน", W / 2, y);

      y += 18;
      const qrX = (W - qrW) / 2;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      roundRectPath(ctx, qrX - 8, y, qrW + 16, qrH + 16, 12);
      ctx.fill();
      ctx.stroke();
      ctx.drawImage(qrImg, qrX, y + 8, qrW, qrH);
    }

    // ===== Footer =====
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "10px " + FONT;
    ctx.textAlign = "center";
    const ts = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
    ctx.fillText("BadCount  ·  " + ts, W / 2, H - 16);

    // ===== Download =====
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const a = document.createElement("a");
    a.href = dataUrl;
    const safeLoc = (s.location || "due").replace(/[^a-zA-Z0-9ก-๙]/g, "_").slice(0, 25);
    a.download = `Due_${safeLoc}_${s.date || todayISO()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    toast(`📥 บันทึกรูปทวง ${unpaid.length} คนแล้ว`, 3000);
  };

  loadImageSafe(hasQR ? s.bankQR : null).then((qrImg) => {
    if (hasQR && !qrImg) {
      toast("⚠️ โหลด QR ไม่ได้ — บันทึกรูปไม่มี QR");
    }
    buildReminder(qrImg);
  });
});

function renderMembers() {
  const list = $("membersList");
  const members = currentSession.members || [];
  $("memberCount").textContent = members.length;

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
    const priceColor = isPaid ? "text-emerald-500" : "text-rose-500";
    
    return `
    <div class="py-3 flex items-center gap-2 sm:gap-3">
      <button data-act="toggle-paid" data-idx="${idx}" class="w-6 h-6 shrink-0 rounded-md border flex items-center justify-center transition-colors ${isPaid ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-300 text-transparent hover:border-emerald-400'}" title="ทำเครื่องหมายว่าจ่ายแล้ว">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
      </button>
      
      <div class="flex-1 min-w-0 flex items-center justify-between pr-1 sm:pr-2">
        <div class="min-w-0 flex-1 truncate">
          <span class="font-medium ${isPaid ? 'text-slate-400' : 'text-slate-800'}">${escapeHtml(m.name)}</span>
          ${pStats[m.id].games > 0 
            ? `<span class="text-xs text-slate-400 ml-1" title="ล่าสุดเล่นกับ: ${pStats[m.id].lastPartners.map(pid => members.find(x => x.id === pid)?.name || '?').join(', ')}">(ตี ${pStats[m.id].games} เกม • ล่าสุด: ${escapeHtml(pStats[m.id].lastPartners.map(pid => members.find(x => x.id === pid)?.name || '?').join(', '))})</span>`
            : `<span class="text-xs text-slate-300 ml-1">(ยังไม่ได้ลงสนาม)</span>`
          }
        </div>
        <div class="font-bold text-lg ${priceColor} whitespace-nowrap ml-2">${fmt(totals.perMember[idx])} ฿</div>
      </div>
      
      <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1 shrink-0">
        <button data-act="dec" data-idx="${idx}" class="w-7 h-7 sm:w-8 sm:h-8 rounded-md bg-white hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600">−</button>
        <div class="w-7 sm:w-10 text-center font-semibold text-sm" title="ลูกในเกม: ${matchShuttles}, ลูกเบิกเอง: ${m.shuttlesUsed || 0}">${displayShuttles}</div>
        <button data-act="inc" data-idx="${idx}" class="w-7 h-7 sm:w-8 sm:h-8 rounded-md bg-white hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600">+</button>
      </div>
      
      <button data-act="del" data-idx="${idx}" class="text-slate-300 hover:text-red-500 pl-1 pr-2 text-xl shrink-0 leading-none">×</button>
    </div>
  `}).join("");

  // Wire up +/- and delete
  list.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      const idx = parseInt(btn.dataset.idx, 10);
      const members = [...(currentSession.members || [])];
      
      if (act === "inc") members[idx].shuttlesUsed = (members[idx].shuttlesUsed || 0) + 1;
      else if (act === "dec") members[idx].shuttlesUsed = Math.max(0, (members[idx].shuttlesUsed || 0) - 1);
      else if (act === "toggle-paid") members[idx].isPaid = !members[idx].isPaid;
      else if (act === "del") {
        if (!confirm(`ลบ "${members[idx].name}" ออกจากก๊วน?`)) return;
        members.splice(idx, 1);
      }
      
      saveSession({ members });
    });
  });
}

function calcTotals() {
  const s = currentSession;
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
    
    const count = parseShuttleCount(match.shuttleNumbers);
    matchShuttlesTotal += count;
    pIds.forEach(id => {
      matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + count;
    });
  });

  const totalShuttles = manualShuttles + matchShuttlesTotal;

  const totalCourtCost = courtFeeType === "total" ? courtFee : courtFee * N;
  const courtPer = N > 0 ? (courtFeeType === "total" ? courtFee / N : courtFee) : 0;
  
  const totalOtherCost = otherCostType === "total" ? otherCost : otherCost * N;
  const otherPer = N > 0 ? (otherCostType === "total" ? otherCost / N : otherCost) : 0;

  let totalShuttleCost = 0;
  const perMember = members.map(m => {
    const individualShuttles = (m.shuttlesUsed || 0) + (matchShuttlesMap[m.id] || 0);
    totalShuttleCost += individualShuttles * shuttlePrice;
    return courtPer + otherPer + (individualShuttles * shuttlePrice);
  });
  
  const totalAll = totalCourtCost + totalShuttleCost + totalOtherCost;

  return { totalShuttles, totalShuttleCost, totalCourtCost, totalOtherCost, totalAll, perMember, matchShuttlesMap };
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

  list.innerHTML = matches.map((m, idx) => `
    <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-start justify-between gap-3">
      <div class="flex-1 text-sm min-w-0">
        <div class="flex justify-between items-center mb-1">
          <div class="font-bold text-slate-700">เกมที่ ${idx + 1}</div>
          ${m.shuttleNumbers ? `<div class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-md">ลูกที่ ${escapeHtml(m.shuttleNumbers)}</div>` : ''}
        </div>
        <div class="text-emerald-700 font-medium text-xs leading-relaxed">
          ${(m.players || [m.a1, m.a2, m.b1, m.b2].filter(Boolean)).map(pid => escapeHtml(membersMap[pid] || '?')).join(", ")}
        </div>
      </div>
      <div class="flex flex-col items-center gap-1">
        <button data-match-edit="${m.id}" class="text-slate-400 hover:text-emerald-600 px-1 text-sm">✏️</button>
        <button data-match-del="${m.id}" class="text-slate-300 hover:text-red-500 px-1 py-0.5 text-xl leading-none">&times;</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("button[data-match-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const matchId = btn.dataset.matchEdit;
      const match = (currentSession.matches || []).find(x => x.id === matchId);
      if (!match) return;
      
      editingMatchId = matchId;
      matchDraftPlayers = [...(match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean))];
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
      toast("บันทึกไม่ได้: " + err.message);
    }
  }, 400);
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

// QR
$("btnQR").addEventListener("click", () => {
  const url = location.href;
  const canvas = $("qrCanvas");
  canvas.innerHTML = "";
  QRCode.toCanvas(url, { width: 220, margin: 1 }, (err, c) => {
    if (err) { toast("สร้าง QR ไม่ได้"); return; }
    canvas.appendChild(c);
  });
  $("qrUrlText").textContent = url;
  $("qrModal").classList.remove("hidden");
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
  if (!confirm("ลบก๊วนนี้ทิ้ง? (ไม่สามารถกู้คืนได้)")) return;
  const deletingId = currentSessionId;
  try {
    // Mark ว่าเป็น user-initiated delete (ป้องกัน toast "ไม่พบก๊วน" ที่ซ้ำซ้อน)
    recentlyDeletedSessionId = deletingId;
    setTimeout(() => {
      if (recentlyDeletedSessionId === deletingId) recentlyDeletedSessionId = null;
    }, 5000);

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
let editingMatchId = null;

$("btnAddMatch").addEventListener("click", () => {
  const members = currentSession.members || [];
  if (members.length < 4) return alert("ต้องมีสมาชิกอย่างน้อย 4 คน ถึงจะจัดเกมได้ครับ");
  
  editingMatchId = null;
  matchDraftPlayers = [];
  $("fldMatchShuttles").value = "";
  $("matchModalTitle").textContent = "🏸 จัดเกมใหม่";
  renderMatchDraft();
  $("matchModal").classList.remove("hidden");
});

function renderMatchDraft() {
  const allMembers = currentSession.members || [];
  const selectedDiv = $("selectedPlayers");
  const availableDiv = $("availablePlayers");

  $("selPlayerCount").textContent = matchDraftPlayers.length;

  let selHtml = "";
  let availHtml = "";

  // 1. Calculate games played for each member
  const gamesPlayed = {};
  const partneredCount = {};
  const matches = currentSession.matches || [];
  
  allMembers.forEach(m => {
    gamesPlayed[m.id] = 0;
    partneredCount[m.id] = 0;
  });

  matches.forEach(match => {
    const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
    pIds.forEach(id => {
      if (gamesPlayed[id] !== undefined) gamesPlayed[id]++;
    });
    
    // If this match includes ANY of the currently selected players, increment partnered count
    if (matchDraftPlayers.length > 0) {
      const hasSelected = pIds.some(id => matchDraftPlayers.includes(id));
      if (hasSelected) {
        pIds.forEach(id => {
          if (partneredCount[id] !== undefined) partneredCount[id]++;
        });
      }
    }
  });

  // Find minimum games played among AVAILABLE players
  let minGames = Infinity;
  allMembers.forEach(m => {
    if (!matchDraftPlayers.includes(m.id) && gamesPlayed[m.id] < minGames) {
      minGames = gamesPlayed[m.id];
    }
  });

  // Find minimum partnered count among AVAILABLE players who are at minGames
  let minPartnered = Infinity;
  if (matchDraftPlayers.length > 0) {
    allMembers.forEach(m => {
      if (!matchDraftPlayers.includes(m.id) && gamesPlayed[m.id] === minGames) {
        if (partneredCount[m.id] < minPartnered) {
          minPartnered = partneredCount[m.id];
        }
      }
    });
  }

  allMembers.forEach(m => {
    const isSel = matchDraftPlayers.includes(m.id);
    let chipClass = "";
    let extraHtml = "";

    if (isSel) {
      chipClass = "bg-emerald-500 text-white shadow-sm";
      extraHtml = " ✕";
    } else {
      let isRecommended = false;
      if (gamesPlayed[m.id] === minGames) {
        if (matchDraftPlayers.length > 0) {
          isRecommended = (partneredCount[m.id] === minPartnered);
        } else {
          isRecommended = true;
        }
      }

      if (isRecommended) {
        // Highlight!
        chipClass = "bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 shadow-sm font-bold ring-2 ring-amber-200 ring-offset-1";
        extraHtml = ` <span class="text-[10px] ml-1 bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">แนะนำ</span> +`;
      } else {
        // Not recommended, could be they have more games, or played together too much
        if (matchDraftPlayers.length > 0 && partneredCount[m.id] > 0) {
          chipClass = "bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 opacity-60";
        } else {
          chipClass = "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50";
        }
        extraHtml = " +";
      }
    }

    const chip = `<button data-draft-id="${m.id}" class="px-3 py-1.5 rounded-full text-sm font-medium transition-transform active:scale-95 ${chipClass}">${escapeHtml(m.name)}${extraHtml}</button>`;
    
    if (isSel) selHtml += chip;
    else availHtml += chip;
  });
  
  if(matchDraftPlayers.length === 0) selHtml = `<div class="text-slate-300 text-sm py-2 w-full text-center">ยังไม่ได้เลือกผู้เล่น</div>`;
  if(availHtml === "") availHtml = `<div class="text-slate-300 text-sm py-2 w-full text-center">ไม่มีผู้เล่นเหลือ</div>`;
  
  selectedDiv.innerHTML = selHtml;
  availableDiv.innerHTML = availHtml;
  
  $("btnSaveMatch").disabled = matchDraftPlayers.length !== 4;
  $("btnSaveMatch").className = matchDraftPlayers.length === 4 ? "flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-medium text-sm" : "flex-1 bg-slate-200 text-slate-400 py-3 rounded-xl font-medium text-sm cursor-not-allowed";

  $("matchModal").querySelectorAll("button[data-draft-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.draftId;
      if (matchDraftPlayers.includes(pid)) {
        matchDraftPlayers = matchDraftPlayers.filter(id => id !== pid);
      } else {
        if (matchDraftPlayers.length >= 4) return toast("เลือกได้สูงสุด 4 คนครับ");
        matchDraftPlayers.push(pid);
      }
      renderMatchDraft();
    });
  });
}

$("btnCancelMatch").addEventListener("click", () => $("matchModal").classList.add("hidden"));
$("matchModal").addEventListener("click", e => { if (e.target.id === "matchModal") $("matchModal").classList.add("hidden"); });

$("btnSaveMatch").addEventListener("click", () => {
  if (matchDraftPlayers.length !== 4) return alert("กรุณาเลือกผู้เล่นให้ครบ 4 คน");

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

  if (editingMatchId) {
    const idx = matches.findIndex(x => x.id === editingMatchId);
    if (idx !== -1) {
      matches[idx] = { ...matches[idx], players: matchDraftPlayers, shuttleNumbers: shuttles };
      delete matches[idx].a1; delete matches[idx].a2; delete matches[idx].b1; delete matches[idx].b2;
    }
  } else {
    matches.push({ id: uid(), players: matchDraftPlayers, shuttleNumbers: shuttles });
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
    html = `<p class="text-center text-slate-500 text-sm py-4">ยังไม่มีข้อมูลสถิติ เริ่มจัดเกมได้เลย</p>`;
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
          return `<span class="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-full px-2.5 py-1 text-xs">
            <span class="text-slate-700">${escapeHtml(name)}</span>
            <span class="${badgeColor} text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center">${count}</span>
          </span>`;
        }).join("");
      }

      html += `
        <div class="bg-white p-3 rounded-xl border border-slate-200 text-sm">
          <div class="flex justify-between items-center mb-2">
            <span class="font-bold text-slate-800">${escapeHtml(st.name)}</span>
            <span class="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-semibold">🏸 ${st.games} เกม</span>
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
              <span class="font-semibold text-slate-800">${num}</span>
              ${timeStr ? `<span class="text-xs text-slate-500">🕐 ${timeStr}</span>` : ""}
            </li>`;
          }).join("");
        }
      }

// --- Render members + payment info ---
      const mems = s.members || [];
      $("joinCount").textContent = mems.length;

      const isClosed = s.status === "closed";
      const totals = calcSessionTotals(s);

      // Toggle banner ปิดก๊วน
      const closedBanner = $("joinClosedBanner");
      if (closedBanner) closedBanner.classList.toggle("hidden", !isClosed);

      // Toggle payment section (total + QR) — แสดงเฉพาะตอนปิดก๊วน
      const paySection = $("joinPaymentSection");
      const totalDueBox = $("joinTotalDueBox");
      const qrWrap = $("joinQRWrap");
      const qrImg = $("joinQRImg");

      // Hide join form when session is closed (no more registration allowed)
      const formSection = $("joinFormSection");
      const btnJoinAnother = $("btnJoinAnother");

      if (isClosed) {
        // ซ่อน form ลงชื่อ + ปุ่ม "+ ลงชื่อให้คนอื่นเพิ่ม"
        formSection?.classList.add("hidden");
        btnJoinAnother?.classList.add("hidden");

        const unpaidCount = mems.filter(m => !m.isPaid).length;
        const allPaid = mems.length > 0 && unpaidCount === 0;

        if (allPaid) {
          // ✅ ทุกคนจ่ายครบ — ซ่อน QR/ยอด, เปลี่ยน banner เป็นสไตล์ดีใจ
          paySection?.classList.add("hidden");
          totalDueBox?.classList.add("hidden");
          qrWrap?.classList.add("hidden");

          if (closedBanner) {
            closedBanner.textContent = "✅ ปิด Court แล้ว — ทุกคนจ่ายครบ 🎉";
            closedBanner.className = "bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl mb-4 text-center text-sm font-semibold";
          }
        } else {
          // ⏳ ยังมีคนค้าง — โชว์ banner เตือน + QR + จำนวนคนค้าง
          paySection?.classList.remove("hidden");

          if (closedBanner) {
            closedBanner.textContent = "🔒 ปิดแล้ว — ดูยอดที่ต้องจ่ายและ QR โอนเงินด้านล่าง";
            closedBanner.className = "bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl mb-4 text-center text-sm font-semibold";
          }

          if (unpaidCount > 0) {
            totalDueBox?.classList.remove("hidden");
            $("joinUnpaidCount").textContent = unpaidCount;
          } else {
            totalDueBox?.classList.add("hidden");
          }

          // แสดง QR ถ้ามี
          if (s.bankQR && qrImg && qrWrap) {
            qrImg.src = s.bankQR;
            qrWrap.classList.remove("hidden");
          } else {
            qrWrap?.classList.add("hidden");
          }
        }
      } else {
        paySection?.classList.add("hidden");
        totalDueBox?.classList.add("hidden");
        qrWrap?.classList.add("hidden");

        // กลับมาแสดง form ตอนเปิดก๊วน (เผื่อเปิดใหม่หลังปิด)
        formSection?.classList.remove("hidden");
        btnJoinAnother?.classList.remove("hidden");
      }

      // Render members list
      // - ปิดก๊วน: แสดงยอดเงิน + สถานะจ่าย
      // - เปิดก๊วน: แสดงแค่ชื่อ (ไม่โชว์ยอด)
      $("joinMembersList").innerHTML = mems.map((m, idx) => {
        const isPaid = !!m.isPaid;

        if (isClosed) {
          const cost = totals.perMember?.[idx] ?? 0;
          const priceBadge = isPaid
            ? `<span class="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">✓ จ่ายแล้ว</span>`
            : `<span class="text-sm font-bold text-rose-600">${fmt(cost)} ฿</span>`;
          return `
            <li class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 pr-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="${isPaid ? 'text-emerald-500' : 'text-rose-400'} shrink-0 text-xs">●</span>
                <span class="${isPaid ? 'text-slate-500 line-through' : 'text-slate-800 font-medium'} truncate">${escapeHtml(m.name)}</span>
              </div>
              <div class="text-right shrink-0 ml-2">${priceBadge}</div>
            </li>
          `;
        }

        // เปิดก๊วน — แค่ชื่อ
        return `
          <li class="flex items-center gap-2 py-1.5">
            <span class="text-emerald-500 text-xs">●</span>
            <span class="text-slate-800">${escapeHtml(m.name)}</span>
          </li>
        `;
      }).join("");
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
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("ไม่พบก๊วนนี้");

    const s = snap.data();
    const members = s.members || [];

    // Prevent duplicate names
    const exists = members.some(m => (m.name || "").trim().toLowerCase() === name.toLowerCase());
    if (exists) {
      toast(`มีชื่อ "${name}" ในก๊วนแล้ว`);
      return;
    }

    const newId = uid();
    trackOwnSubmit(newId);
    members.push({ id: newId, name, shuttlesUsed: 0 });
    await updateDoc(ref, { members });
    addKnownMember(name); // จดจำชื่อในเครื่องของผู้เล่นไว้

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
$("btnShareJoin").addEventListener("click", async () => {
  if (!currentSessionId || !currentSession) return;
  const joinUrl = location.origin + location.pathname + `#/join/${currentSessionId}`;
  const dateText = currentSession.date ? formatDate(currentSession.date) : "วันนี้";

  if (navigator.share) {
    try {
      await navigator.share({
        title: "🏸 Register เข้าร่วมก๊วน",
        text: `Register เข้าร่วมก๊วนของวันที่ ${dateText}`,
        url: joinUrl
      });
      toast("แชร์ลิงก์สำเร็จ ✓");
    } catch (err) {
      if (err.name !== "AbortError") toast("แชร์ไม่สำเร็จ");
    }
  } else {
    navigator.clipboard.writeText(joinUrl).then(() => {
      toast("คัดลอกลิงก์แล้ว (วางในเบราว์เซอร์ได้เลย)");
    }).catch(() => {
      toast("ไม่สามารถคัดลอกได้");
    });
  }
});

$("btnShare").addEventListener("click", async () => {
  if (!currentSessionId || !currentSession) return;
  // ใช้ #/m/{id} เพื่อให้ผู้รับล็อกอยู่ใน session view เสมอ ไม่ว่าเครื่องเขาจะ login ไว้หรือไม่
  const managerUrl = location.origin + location.pathname + `#/m/${currentSessionId}`;
  const dateText = currentSession.date ? formatDate(currentSession.date) : "วันนี้";

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Manager Link",
        text: `Manager Link - ${dateText}`,
        url: managerUrl
      });
      toast("แชร์ลิงก์ Manager สำเร็จ ✓");
    } catch (err) {
      if (err.name !== "AbortError") toast("แชร์ไม่สำเร็จ");
    }
  } else {
    navigator.clipboard.writeText(managerUrl).then(() => {
      toast("คัดลอกลิงก์ Manager แล้ว (วางในเบราว์เซอร์ได้เลย)");
    }).catch(() => {
      toast("ไม่สามารถคัดลอกได้");
    });
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
  container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">กำลังโหลด...</p>`;
  try {
    const q = query(SESSIONS, orderBy("createdAt", "desc"), limit(HISTORY_LIMIT));
    const snap = await getDocs(q);
    renderSessionList(container, snap, false);
  } catch (err) {
    container.innerHTML = `<p class="text-red-500 text-center py-6 text-sm">${err.message}</p>`;
  }
}

function renderSessionList(container, snap, isHome) {
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
      ? "block p-3 pr-10 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 transition"
      : "block p-3 pr-10 rounded-xl border border-slate-100 hover:border-emerald-300 hover:bg-emerald-50/50 transition";
    const priceClass = isClosed ? "font-bold text-emerald-700" : "font-bold text-emerald-600";
    const statusBadge = isClosed
      ? `<span class="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">✓ ปิดแล้ว</span>`
      : `<span class="text-xs text-emerald-600">เปิดอยู่</span>`;

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
          <div class="mt-2 pt-2 border-t border-emerald-100/50">
            <div class="text-[10px] font-semibold text-rose-600 mb-1">ค้างชำระ:</div>
            <div class="flex flex-wrap gap-1.5">
              ${unpaidMembers.map(u => `
                <span class="inline-flex items-center gap-1 bg-white border border-rose-200 text-rose-700 text-[10px] px-1.5 py-0.5 rounded shadow-sm">
                  <span class="truncate max-w-[80px]">${escapeHtml(u.name)}</span>
                  <span class="font-bold border-l border-rose-200 pl-1">${fmt(u.amount)}฿</span>
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
        <a href="#/session/${d.id}" class="${cardClass}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-semibold truncate ${isClosed ? "text-emerald-900" : ""}">${escapeHtml(s.location || "ก๊วน")}</div>
              <div class="text-xs ${isClosed ? "text-emerald-700/70" : "text-slate-500"} mt-0.5">${formatDate(s.date)} · ${members.length} คน · ${totals.totalShuttles} ลูก${courtSummary}</div>
            </div>
            <div class="text-right flex flex-col items-end shrink-0">
              <div class="${priceClass}">${fmt(totals.totalAll)} ฿</div>
              <div class="mt-0.5">${statusBadge}</div>
            </div>
          </div>
          ${unpaidListHtml}
        </a>
        <button data-quick-del="${d.id}" class="absolute top-3 right-2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="ลบก๊วนนี้">
          ✕
        </button>
      </div>
    `);
  });
  container.innerHTML = rows.join("");

  container.querySelectorAll("button[data-quick-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("ต้องการลบก๊วนนี้ทิ้งใช่หรือไม่? (ไม่สามารถกู้คืนได้)")) return;
      try {
        await deleteDoc(doc(db, "sessions", btn.dataset.quickDel));
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

    const count = parseShuttleCount(match.shuttleNumbers);
    matchShuttlesTotal += count;
    pIds.forEach(id => {
      matchShuttlesMap[id] = (matchShuttlesMap[id] || 0) + count;
    });
  });

  const totalShuttles = manualShuttles + matchShuttlesTotal;

  // คำนวณค่าคอร์ดและค่าอื่นๆ ต่อคน
  const courtPer = N > 0 ? (courtFeeType === "total" ? courtFee / N : courtFee) : 0;
  const otherPer = N > 0 ? (otherCostType === "total" ? otherCost / N : otherCost) : 0;

  let totalAll = 0;
  let unpaidTotal = 0;

  // คำนวณยอดเงินรายบุคคล
  const perMember = members.map((m) => {
    const individualShuttles = (m.shuttlesUsed || 0) + (matchShuttlesMap[m.id] || 0);
    const cost = courtPer + otherPer + (individualShuttles * shuttlePrice);
    
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
