// ============================================================
// BadCount — Badminton Session Tracker
// ============================================================

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, updateDoc,
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

// ---------- Utility ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);

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

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $("view-" + name).classList.add("active");
  window.scrollTo({ top: 0, behavior: "instant" });

  // Lock navigation when in join view (so members can't navigate to manager pages)
  const logo = $("logoLink");
  const nav = $("mainNav");
  if (name === "join") {
    if (nav) nav.classList.add("hidden");
    if (logo) {
      logo.removeAttribute("href");
      logo.classList.add("pointer-events-none", "cursor-default");
    }
  } else {
    if (nav) nav.classList.remove("hidden");
    if (logo) {
      logo.setAttribute("href", "#/");
      logo.classList.remove("pointer-events-none", "cursor-default");
    }
  }
}

// ---------- Router (hash-based for GitHub Pages) ----------
function route() {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\/?/, "").split("/");

  // Clean up previous session listener
  if (unsubscribeSession) { unsubscribeSession(); unsubscribeSession = null; }

  if (parts[0] === "session" && parts[1]) {
    currentSessionId = parts[1];
    showView("session");
    subscribeSession(currentSessionId);
  } else if (parts[0] === "join" && parts[1]) {
    currentSessionId = parts[1];
    showView("join");
    setupJoinView(currentSessionId);
  } else if (parts[0] === "history") {
    showView("history");
    loadHistory();
  } else {
    showView("home");
    loadRecentSessions();
  }
}
window.addEventListener("hashchange", route);

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
    const defaultBankQR = localStorage.getItem("defaultBankQR");
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

// ============================================================
// SESSION VIEW
// ============================================================
function subscribeSession(id) {
  const ref = doc(db, "sessions", id);
  unsubscribeSession = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      $("view-session").innerHTML = `<div class="bg-white rounded-2xl shadow-sm p-8 text-center"><p class="text-slate-500">ไม่พบก๊วนนี้ อาจถูกลบไปแล้ว</p><a href="#/" class="inline-block mt-4 text-emerald-600 hover:underline">← กลับหน้าหลัก</a></div>`;
      return;
    }
    currentSession = { id: snap.id, ...snap.data() };
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
  if (s.status === "closed") {
    badge.textContent = "ปิดแล้ว";
    badge.className = "text-xs font-semibold px-2 py-1 rounded-full bg-slate-200 text-slate-700 whitespace-nowrap";
    $("btnCloseSession").innerHTML = "🔓 เปิดก๊วนอีกครั้ง";
  } else {
    badge.textContent = "เปิดอยู่";
    badge.className = "text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap";
    $("btnCloseSession").innerHTML = "✅ ปิดก๊วน";
  }

  renderMembers();
  renderMatches();
  renderSummary();
  updatePaymentReminder();
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

$("btnCopyDueList").addEventListener("click", async () => {
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

  const total = unpaid.reduce((sum, x) => sum + x.amount, 0);
  const lines = unpaid.map(x => `• ${x.name} — ${fmt(x.amount)} ฿`);
  const locationLine = s.location ? ` (${s.location})` : "";

  const msg =
`🏸 ค่าก๊วน ${formatDate(s.date)}${locationLine}

ยังไม่จ่าย ${unpaid.length} คน:
${lines.join("\n")}
─────────────
รวมค้าง  ${fmt(total)} ฿

📱 โอนตาม QR ที่ส่งให้นะครับ
ขอบคุณครับ 🙏`;

  try {
    await navigator.clipboard.writeText(msg);
    toast(`คัดลอกข้อความทวง ${unpaid.length} คนแล้ว ✓ (ไปแปะในไลน์ได้เลย)`, 3000);
  } catch (e) {
    // Fallback: show in prompt for manual copy
    prompt("คัดลอกข้อความนี้:", msg);
  }
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
  members.push({ id: uid(), name, shuttlesUsed: 0 });
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
  toast(newStatus === "closed" ? "ปิดก๊วนแล้ว ✓" : "เปิดก๊วนอีกครั้ง ✓");
});

// Delete
$("btnDeleteSession").addEventListener("click", async () => {
  if (!confirm("ลบก๊วนนี้ทิ้ง? (ไม่สามารถกู้คืนได้)")) return;
  try {
    await deleteDoc(doc(db, "sessions", currentSessionId));
    location.hash = "#/";
    toast("ลบก๊วนแล้ว");
  } catch (err) {
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
  
  const stats = {};
  members.forEach(m => { stats[m.id] = { name: m.name, games: 0, partners: {} }; });
  
  matches.forEach(m => {
    const p = m.players || [m.a1, m.a2, m.b1, m.b2].filter(Boolean);
    p.forEach(id1 => {
      if (!stats[id1]) return;
      stats[id1].games++;
      p.forEach(id2 => {
        if (id1 !== id2 && stats[id2]) {
          stats[id1].partners[id2] = (stats[id1].partners[id2] || 0) + 1;
        }
      });
    });
  });
  
  const sortedIds = Object.keys(stats).sort((a,b) => stats[a].games - stats[b].games);
  
  let html = "";
  if (matches.length === 0) {
    html = `<p class="text-center text-slate-500 text-sm py-4">ยังไม่มีข้อมูลสถิติ เริ่มจัดเกมได้เลย</p>`;
  } else {
    sortedIds.forEach(id => {
      const st = stats[id];
      let partnersText = "ยังไม่เคยคู่ใคร";
      if (Object.keys(st.partners).length > 0) {
        partnersText = Object.keys(st.partners).map(pid => {
          return `${escapeHtml(stats[pid] ? stats[pid].name : '?')}${st.partners[pid] > 1 ? `(${st.partners[pid]})` : ''}`;
        }).join(", ");
      }
      html += `
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 text-sm">
          <div class="flex justify-between items-center mb-1">
            <span class="font-bold text-slate-800">${escapeHtml(st.name)}</span>
            <span class="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-semibold">${st.games} เกม</span>
          </div>
          <div class="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            <span class="font-semibold text-slate-600">เคยคู่กับ:</span> ${partnersText}
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

async function setupJoinView(id) {
  $("joinFormSection").classList.remove("hidden");
  $("joinSuccessSection").classList.add("hidden");
  $("fldJoinName").value = "";
  $("joinSessionName").textContent = "กำลังโหลด...";
  $("joinSessionDate").textContent = "";
  $("joinCount").textContent = "0";
  $("joinMembersList").innerHTML = "";
  
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
      $("joinSessionName").textContent = s.location || "ก๊วนแบดมินตัน";
      $("joinSessionDate").textContent = s.date ? formatDate(s.date) : "";
      
      const mems = s.members || [];
      $("joinCount").textContent = mems.length;
      $("joinMembersList").innerHTML = mems.map(m => `<li class="flex items-center gap-2"><span class="text-emerald-500">●</span> ${escapeHtml(m.name)}</li>`).join("");
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

    members.push({ id: uid(), name, shuttlesUsed: 0 });
    await updateDoc(ref, { members });

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
$("btnShareJoin").addEventListener("click", () => {
  if (!currentSessionId) return;
  // Construct the join URL
  const joinUrl = location.origin + location.pathname + `#/join/${currentSessionId}`;
  navigator.clipboard.writeText(joinUrl).then(() => {
    toast("คัดลอกลิงก์ชวนเพื่อนแล้ว (ส่งให้เพื่อนกดลงชื่อได้เลย)");
  }).catch(() => {
    toast("ไม่สามารถคัดลอกลิงก์ได้");
  });
});

$("btnShare").addEventListener("click", () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    toast("คัดลอกลิงก์เรียบร้อยแล้ว");
  }).catch(() => {
    toast("ไม่สามารถคัดลอกลิงก์ได้");
  });
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
      localStorage.setItem("defaultBankQR", dataUrl);
      saveSession({ bankQR: dataUrl }).then(() => {
        renderBankQR();
        toast("อัปโหลด QR Code สำเร็จ");
      });
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});

$("btnRemoveQR").addEventListener("click", () => {
  if(confirm("ต้องการลบรูป QR Code รับเงินใช่หรือไม่?")) {
    localStorage.removeItem("defaultBankQR");
    saveSession({ bankQR: null }).then(() => {
      $("fldBankQR").value = "";
      renderBankQR();
    });
  }
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
async function loadHistory() {
  const container = $("historyList");
  container.innerHTML = `<p class="text-slate-400 text-center py-6 text-sm">กำลังโหลด...</p>`;
  try {
    const q = query(SESSIONS, orderBy("createdAt", "desc"));
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
    rows.push(`
      <div class="relative">
        <a href="#/session/${d.id}"
           class="block p-3 pr-10 rounded-xl border border-slate-100 hover:border-emerald-300 hover:bg-emerald-50/50 transition">
          <div class="flex items-center justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-semibold truncate">${escapeHtml(s.location || "ก๊วน")}</div>
              <div class="text-xs text-slate-500 mt-0.5">${formatDate(s.date)} · ${members.length} คน · ${totals.totalShuttles} ลูก</div>
            </div>
            <div class="text-right">
              <div class="font-bold text-emerald-600">${fmt(totals.totalAll)} ฿</div>
              <div class="text-xs ${s.status === "closed" ? "text-slate-400" : "text-emerald-600"}">${s.status === "closed" ? "ปิดแล้ว" : "เปิดอยู่"}</div>
            </div>
          </div>
        </a>
        <button data-quick-del="${d.id}" class="absolute top-1/2 -translate-y-1/2 right-2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="ลบก๊วนนี้">
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
  
  const manualShuttles = members.reduce((sum, m) => sum + (m.shuttlesUsed || 0), 0);
  let matchShuttlesTotal = 0;
  let collectedShuttles = 0;
  
  matches.forEach(match => {
    const count = parseShuttleCount(match.shuttleNumbers);
    matchShuttlesTotal += count;
    
    const pIds = match.players || [match.a1, match.a2, match.b1, match.b2].filter(Boolean);
    collectedShuttles += count * pIds.length;
  });
  
  const totalShuttles = manualShuttles + matchShuttlesTotal;
  
  const courtFeeType = s.courtFeeType || "total";
  const courtFee = +s.courtFee || 0;
  const totalCourtCost = courtFeeType === "total" ? courtFee : courtFee * N;
  
  const totalAll = totalCourtCost + (manualShuttles + collectedShuttles) * (+s.shuttlePrice || 0) + (+s.otherCost || 0);
  return { totalShuttles, totalAll };
}

function formatDate(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

// ============================================================
// Init
// ============================================================
route();
