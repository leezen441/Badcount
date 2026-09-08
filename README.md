# 🏸 BadCount — แอปบันทึกเกมแบดมินตัน

Web App (PWA) ธีม **Sporty Neon-Lime & Sleek Graphite-Black** สำหรับจดสมาชิก นับลูก คำนวณค่าใช้จ่าย และจัดคิวเกมแบดมินตัน
Real-time sync ทุกคนเห็นพร้อมกัน — ใช้ฟรี 100%

เวอร์ชันปัจจุบัน: **`3.16.0`** (cache `badcount-v33`)

🌐 **Live**: [badcount.vercel.app](https://badcount.vercel.app)  
📦 **GitHub**: [leezen441/Badcount](https://github.com/leezen441/Badcount)

---

## ✨ คุณสมบัติหลัก

### 🎨 ธีมพรีเมียม Sporty Neon-Lime & Sleek Graphite-Black (CI 100%)
- ✅ **บังคับธีมดาร์กโหมดถาวร (Forced Dark Mode)**: ดีไซน์สปอร์ตด้วยเขียวสะท้อนแสงนีออน (`#b5f714`) และดำกราไฟต์ (`#0d0e12`) — `initTheme()` ใส่คลาส `dark` ตลอด ไม่มีโหมดสว่าง
- ✅ **เน้นการอ่านออกได้ง่ายและชัดเจน (High Legibility)**: คอนทราสต์อักษรสีดำเข้ม (`#121315`) บนปุ่มเขียวนีออน อ่านง่ายภายใต้แสงสนาม
- ✅ **ดีไซน์ Opaque Card เรียบหรู**: หลีกเลี่ยงเลเยอร์โปร่งแสงที่ทับซ้อน ทำให้อ่านประวัติ ยอดเงิน และตารางเกมได้ชัด
- ✅ **สปอร์ตไอคอนเฉพาะตัว (Abstract Brand Identity)**: โลโก้ PWA และ Favicon เป็นเวกเตอร์ไม้แบด + ลูกขนไก่
- ✅ **ปุ่มหลักพร้อม Micro-Animations**: ปุ่มในหน้ารายละเอียดกลุ่ม (**Invite**, **Temp Manager**, **Export**, **QR Payment**) เรืองแสงนีออน พร้อมคลิกย่อตัวและ hover glow
- ✅ **ตัวเลือกปฏิทิน/เวลาความคมชัดสูง**: ในดาร์กโหมด ไอคอน date/time picker เป็นสีขาวคมชัด

### 👥 จัดการกลุ่ม (Session Management)
- ✅ **สร้างกลุ่ม/ก๊วนของแต่ละวัน**: จัดการรายชื่อสมาชิก จำนวนสนาม และค่าใช้จ่าย
- ✅ **ปุ่ม "สร้างกลุ่มอาทิตย์หน้า" (Recurring Session)**: คัดลอกจากก๊วนล่าสุดเฉพาะ **สถานที่ / ค่าคอร์ต / ค่าลูก / ค่าอื่นๆ / สนาม / QR ธนาคาร** แล้วตั้งวันที่เป็นวันอาทิตย์ที่ใกล้ที่สุด — **ไม่คัดลอกสมาชิกและแมตช์** ก๊วนใหม่เริ่มว่าง สถานะเปิด เปิดรับสมาชิก
- ✅ **การจัดการสมาชิกแบบยืดหยุ่น**: เพิ่ม/ลบได้ตลอด พร้อม suggestion จากชื่อที่เคยลงเล่นในเครื่องนั้น (สูงสุด 30 ชื่อ)
- ✅ **พักคิวสมาชิกชั่วคราว (Pause Members)**: หยุดไม่ให้เข้า Auto Draft โดยไม่ต้องลบชื่อ — คนที่ลงชื่อผ่านลิงก์ join จะถูกพักคิวอัตโนมัติจนกว่าแอดมินจะปลด
- ✅ **ปิดรับสมาชิก**: ล็อกไม่ให้ลงชื่อเพิ่มได้ แม้ Court ยังเปิดอยู่ (ปิด Court = ปิดรับอัตโนมัติ)
- ✅ **ประวัติย้อนหลัง (History)**: แสดงรายการกลุ่มย้อนหลังสูงสุด 50 รายการล่าสุด
- ✅ **Highlight สถานะกลุ่ม**: กลุ่มที่ปิดยอดแล้วเด่นด้วยกรอบเขียวนีออน กลุ่มที่กำลังเปิดอยู่แยกชัด

### 🏟️ จัดการสนาม (Court Management)
- ✅ **ระบุเลขสนาม + ช่วงเวลา**: เปิด-ปิดแต่ละสนามไม่พร้อมกันได้
- ✅ **Time Picker**: นาฬิกา 24 ชั่วโมง
- ✅ **Suggestion จากกลุ่มก่อน**: ดึงสนามล่าสุดจาก `settings/defaults` (`lastUsedCourts`)

### 💰 คำนวณค่าใช้จ่าย (Expense Calculation)
- ✅ **ค่าคอร์ตแบบยืดหยุ่น**: toggle **"รวม (หารเท่ากัน)"** หรือ **"ต่อคน"**
- ✅ **ค่าลูกแบดตามใช้จริง**: โหมดเบอร์ลูก (เช่น `1-5, 8`) หรือโหมดนับจำนวนอย่างง่าย (`simpleShuttleCount`) — ลูกจากแมตช์หารให้ผู้เล่นในเกมนั้น (ยกเว้นคนที่ถูก exempt)
- ✅ **ค่าใช้จ่ายอื่นๆ (ค่าน้ำ/อาหาร)**: หารเท่ากันทุกคน หรือคิดรายคน
- ✅ **ยกเว้น / กำหนดยอดเอง**: ฟรีค่าลูกทั้งก๊วน, เว้นจำนวนลูก, หรือ `manualFee` ให้แอดมินใส่ยอดคงที่รายคน
- ✅ **ติดตามสถานะการชำระเงิน**: ติ๊ก "จ่ายแล้ว" รายคนแบบ realtime พร้อมขีดฆ่าชื่อ

### 🎮 จัดเกม + สถิติ (Matchmaking & Stats)
- ✅ **Auto Draft**: จัด 4 คนจากผู้ที่ลงน้อย, คู่ซ้ำน้อย, บาลานซ์มือ, buddy อยู่ฝั่งเดียวกัน (คนพักคิว / จ่ายแล้วไม่ถูกสุ่ม)
- ✅ **Auto Split**: แบ่งฝั่ง Team A vs Team B จากระดับมือ (A / B / C / P / S)
- ✅ **Buddy (คู่หู)**: ในโหมด advance สมาชิกเลือก buddy ได้ตอนลงชื่อ เพื่อให้อยู่ฝั่งเดียวกัน
- ✅ **Co-play Badges**: badge 3 ระดับว่าใครเคยเล่นด้วยกันกี่ครั้ง
- ✅ **บันทึกแมตช์นับลูก**: เก็บผู้เล่น 4 คน, เบอร์/จำนวนลูก, และผู้เล่นที่ยกเว้นค่าลูกในเกมนั้น — **ไม่มีฟิลด์คะแนน rally**

### 📲 หน้าต่างโต้ตอบบนมือถือ (Mobile Modals & Layout)
- ✅ **Centered Modals**: หน้าต่างเกมใหม่, PromptPay, และอื่นๆ กึ่งกลางจอ มุมโค้ง `rounded-2xl`
- ✅ **ปุ่มล่างไม่ถูกบัง**: ความสูง modal สูงสุด ~90% ของจอ มีสกรอลล์ภายใน
- ✅ **ปุ่มย้อนกลับบนมือถือ**: History API + LIFO modal stack — กด Back ปิด modal ล่าสุดก่อน ไม่ออกจากหน้า
- ✅ **PWA Install**: ติดตั้งแบบ standalone เต็มจอ

### ⚡ Cache-Busting & PWA Resilient Updates
- ✅ **Service Worker**: namespace **`badcount-v33`** ใน `sw.js` — เคลียร์แคชเก่าเมื่ออัปเดต
- ✅ **Cache-busting query**: `premium.css?v=3.16.0` และ `app.js?v=3.16.0` ใน `index.html`
  - ⚠️ **กฎสำคัญ**: ทุกครั้งที่แก้ `app.js` / `premium.css` ต้อง bump `?v=` ใน `index.html` และ `CACHE_NAME` ใน `sw.js` ไม่งั้นผู้ใช้ไม่เห็นของใหม่
- ✅ **Resilient Realtime Sync**: แจ้ง online/offline และ resubscribe Firestore เมื่อกลับมาจาก background

### 📤 Export & Sharing
- ✅ **Bill JPG**: สรุปยอดก๊วนพร้อม QR รับเงิน
- ✅ **ภาพทวงค่า**: ส่งต่อทางแชต (LINE / Messenger) แจ้งยอดค้างรายคน
- ✅ **PromptPay QR Cloud Sync**: สร้าง QR ไดนามิกจากเบอร์/ID ใน `settings/defaults` (canonical EMV + quiet zone) — fallback เป็น `session.bankQR` ถ้ายังไม่มี PromptPay ID
- ✅ **สลิปโอนเงิน**: อัปโหลดเก็บใน `sessions/{id}/receipts/{memberId}` เป็น base64 ใน Firestore (ไม่ใช้ Firebase Storage) พร้อม metadata ลบอัตโนมัติ ~30 วัน

### 🔔 Notification System
- ✅ **Toast + เสียง**: แจ้งเมื่อมีคนลงชื่อใหม่
- ✅ **Dynamic Tab Title**: กระพริบชื่อแท็บพร้อมจำนวนผู้เล่น
- ✅ **Native OS Notifications**: แจ้งแอดมิน/ผู้จัดการเมื่อย่อหน้าต่าง

### 🔒 Authentication & Access Level
- ✅ **Admin passcode**: เทียบ SHA-256 กับ `PASSCODE_HASH` ใน `app.js` — จำใน `localStorage` 30 วัน
- ✅ **Manager passcode**: รหัสผู้ช่วยแยกต่างหากใน `app.js` (ข้อความตรง ไม่ได้ hash) — จำจนกว่าจะออกจากระบบ
- ✅ **Temp Manager PIN**: PIN 4 หลักต่อก๊วน + วันหมดอายุ ใช้เข้า `/#/m/{id}`
- ✅ **3-Tier Permission**: Admin / Manager / Member (ลิงก์ join สาธารณะ ไม่มีล็อกอิน)

### 🆕 ฟีเจอร์ล่าสุด (ตรงกับโค้ดปัจจุบัน)
- ✅ **🤖 LINE Bot**: ปุ่มส่งรายชื่อ, ทวงเงิน, ประกาศคอร์ดเปิด, cron ทวงเช้า — **ไม่ส่งอัตโนมัติทุกครั้งที่มีคนลงชื่อ** (ตัดเพื่อประหยัดโควตา LINE)
- ✅ **ลงชื่อ = พักคิวอัตโนมัติ**: join ผ่านลิงก์ → `isPaused: true` จนแอดมินปลดเมื่อมาถึงสนาม
- ✅ **จำระดับมือข้ามก๊วน**: ชื่อที่เคยตั้งมือไว้ ระบบใส่ระดับล่าสุดให้ตอนลงชื่อ/เพิ่มสมาชิก
- ✅ **Personal Stats แบบ Chip + Suggest**: พิมพ์/กดชื่อหลายคน + แนะนำชื่อใกล้เคียง (ไทย↔อังกฤษ เช่น Ball↔บอล)
- ✅ **PromptPay QR สแกนได้หลายแบงก์**: field order แบบ canonical + ขอบขาว (quiet zone)

---

## 🌐 Routes / URL Patterns

Hash router ใน `app.js` (`route()`):

| URL | สิทธิ์ | หน้าที่ |
|---|---|---|
| `/#/` | Admin | แดชบอร์ด สร้าง/เปิดก๊วน |
| `/#/history` | Admin (Manager ถูกส่งไป m-home) | ประวัติกลุ่ม 50 รายการล่าสุด |
| `/#/personal-stats` | Admin & Manager | สถิติรายคน จำนวนเกม ค่าลูก ยอดเงิน ตามช่วงเวลา |
| `/#/admin-summary` | Admin & Manager | สรุปยอดรับ จ่าย ค้าง |
| `/#/session/{id}` | Admin (ไม่ล็อกอินจะล็อก nav) | จัดการก๊วนเต็มสิทธิ์: สมาชิก สนาม เงิน จัดเกมนับลูก |
| `/#/m-home` | Manager / Admin | รายการก๊วนล่าสุดสำหรับผู้จัดการ |
| `/#/m/{id}` | Temp Manager | จัดการก๊วนนี้ (ต้อง PIN 4 หลักของก๊วนนั้น ถ้ายังไม่ผ่าน) |
| `/#/join/{id}` | Public | ลงชื่อ (พักคิวอัตโนมัติ · จำระดับมือ) ดูยอด อัปโหลดสลิป — เลือก buddy ได้เมื่อก๊วนเป็นโหมด advance |

---

## 🤖 LINE Bot Integration (instance หลัก)

บอท LINE Official Account ผ่าน **Vercel Serverless Functions** (`api/`) ต่อ Firestore โปรเจกต์เดียวกัน (`badcount-a1296`)

### คำสั่งบอท (สั่งได้เฉพาะเจ้าของ)
| พิมพ์ในแชต/กลุ่ม | การทำงาน |
|---|---|
| `startbadcount` | เริ่มทำงาน + จำแชต/กลุ่มนี้เป็นปลายทาง · **คนแรกที่พิมพ์ = เจ้าของถาวร** (Trust-On-First-Use) คนอื่นสั่งไม่ได้ |
| `stopbadcount` | หยุดทำงาน ไม่ส่งข้อความอีก |

ข้อความอื่นบอทเงียบ / ตอนถูกเชิญเข้ากลุ่มจะทักให้พิมพ์ `startbadcount`

### สิ่งที่บอททำจริง (ตรงกับโค้ด)
- **ปุ่ม LINE** ในหน้าก๊วน: ส่งข้อมูลก๊วน + รายชื่อเข้ากลุ่มทันที
- **ไม่ auto-invite ทุกครั้งที่มีคนลงชื่อ** — ตัดออกเพื่อประหยัดโควตา LINE ให้กดปุ่ม LINE รอบเดียวแทน
- **ปิดรับสมาชิกค้าง 10 วินาที** (ยังปิดอยู่จริง) → โพสต์รายชื่อล่าสุดเข้ากลุ่ม (เปิดรับใหม่ภายใน 10 วิ → ยกเลิก)
- **ปิด Court ค้าง 10 วินาที** (ยังปิดอยู่จริง) → โพสต์รายชื่อค้างชำระ (เปิดใหม่ภายใน 10 วิ → ยกเลิก)
- **เกมแรกอยู่ครบ 10 วินาที** (ไม่ถูกลบ) → ประกาศ "คอร์ดเปิด" ครั้งเดียวต่อก๊วน (`lineOpenNotifiedAt`)
- **Cron ทุกเช้า 08:00 เวลาไทย** (`0 1 * * *` UTC ใน `vercel.json`): ทวงก๊วนที่ปิดล่าสุดที่ยังมีคนค้างจ่าย — จ่ายครบแล้วไม่โพสต์

### การตั้งค่า (ครั้งเดียว)
1. สร้าง **Messaging API channel** ที่ [LINE Developers Console](https://developers.line.biz) → ได้ Channel access token + Channel secret
2. ใส่ใน **Vercel → Environment Variables**: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` (ตัวเลือก `CRON_SECRET` กันคนนอกเรียก cron, `PUBLIC_BASE_URL` ถ้าต้องการบังคับโดเมน)
3. ตั้ง **Webhook URL** = `https://<โดเมน>/api/line-webhook` → เปิด Use webhook
4. ที่ [OA Manager](https://manager.line.biz): ปิด Auto-reply · เปิด Webhooks · เปิด Allow bots to join group chats
5. เชิญบอทเข้ากลุ่ม → พิมพ์ `startbadcount` (คนพิมพ์คนแรก = เจ้าของ)

LINE API รันได้เมื่อ deploy บน Vercel (หรือ `vercel dev`) — สแตติกเซิร์ฟเวอร์อย่าง `python -m http.server` จะไม่รัน `/api/*`

### ผลต่อฐานข้อมูล
- doc `settings/lineBot` — `adminUserId`, `active`, `groupId` / `roomId` / `directUserId`, `updatedAt`
- field ใน session: `lineNotifiedAt`, `lineOpenNotifiedAt` (optional) — ไม่แตะ members / ค่าใช้จ่าย / สลิป

> บอทผูกกับ Firebase project ของ instance นั้น — ถ้าจะทำ Team B ต้องสร้าง channel + ตั้ง env แยก และชี้ firebase config ใน `api/_firebase.js` ไปโปรเจกต์นั้น

---

## 📁 โครงสร้างไฟล์

```
Badcount/
  ├─ index.html          ← UI หลัก (premium.css?v=3.16.0 / app.js?v=3.16.0)
  ├─ premium.css         ← ธีมเขียวนีออน-ดำกราไฟต์
  ├─ app.js              ← Logic หลักทั้งหมด (จัดคิว, คำนวณเงิน, PWA, join, LINE ฝั่งไคลเอนต์)
  ├─ firebase-config.js  ← Firestore web config (โปรเจกต์ badcount-a1296)
  ├─ manifest.json       ← PWA manifest
  ├─ icon.svg / icon-maskable.svg
  ├─ sw.js               ← Service Worker (CACHE_NAME = badcount-v33)
  ├─ qrcode.min.js       ← สร้าง PromptPay QR (local)
  ├─ package.json        ← dependency `firebase` สำหรับ serverless เท่านั้น
  ├─ vercel.json         ← Cron ทวงเช้า 8 โมงไทย = 0 1 * * * UTC
  ├─ api/                ← LINE Bot — Vercel Serverless Functions
  │   ├─ line-webhook.js   ← startbadcount / stopbadcount
  │   ├─ line-notify.js    ← push invite / ทวงเงิน / คอร์ดเปิด
  │   ├─ line-cron.js      ← cron ทวงทุกเช้า
  │   ├─ _totals.js        ← สูตรเงิน (ต้องตรงกับ calcSessionTotals ใน app.js)
  │   └─ _firebase.js / _line.js / _sessions.js / _notify.js
  ├─ .gitignore
  └─ README.md
```

ไม่มี bundler / TypeScript / ชุดทดสอบ — เปิด `index.html` คุยกับ Firestore โดยตรง

---

## 🚀 วิธีติดตั้ง (Setup ครั้งเดียว)

### ขั้นที่ 1: สร้าง Firebase Project (ฟรี)

1. ไปที่ [Firebase Console](https://console.firebase.google.com/)
2. คลิก **Add project** → ตั้งชื่อโครงการ เช่น `badcount`
3. **ปิด Google Analytics** (ไม่จำเป็น)
4. รอโครงการสร้างเสร็จ → กด Continue

### ขั้นที่ 2: เพิ่ม Web App

1. ที่หน้า Project Overview → กดไอคอน **`</>`** (Web App)
2. ตั้งชื่อแอป เช่น `badcount-web` → กด **Register app**
3. **คัดลอกวัตถุ `firebaseConfig`** ไปใส่ใน `firebase-config.js`
4. กด **Continue to console**

แอปนี้ **ไม่ใช้ Firebase Authentication** — ล็อกอินเป็น passcode ฝั่งไคลเอนต์ ไม่ต้องเปิด Auth

### ขั้นที่ 3: เปิดใช้งาน Firestore Database

1. เมนูซ้าย → **Build** → **Firestore Database**
2. กด **Create database** → เลือก **Standard edition**
3. **Location**: แนะนำ **`asia-southeast3 (Bangkok)`** (เปลี่ยนทีหลังไม่ได้)
4. เลือก **Start in test mode** → กด Create

### ขั้นที่ 4: ตั้งค่า Security Rules

ใน Firestore → แท็บ **Rules** — rules ชุดที่ใช้อยู่เปิดอ่าน/เขียนได้ทุกคน (จำกัดขนาดสมาชิก ≤ 50):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['date', 'members', 'status'])
                    && request.resource.data.members.size() <= 50;
      allow update: if request.resource.data.members.size() <= 50;
      allow delete: if true;

      match /receipts/{memberId} {
        allow read: if true;
        allow write: if true;
      }
    }
    match /settings/{docId} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

กด **Publish**

> ผู้ที่มีลิงก์ก๊วนหรือ join URL อ่าน/แก้ข้อมูลได้ตาม rules ด้านบน — แชร์เฉพาะกลุ่มที่ไว้ใจ

### ขั้นที่ 5: ตั้งค่า `firebase-config.js`

แก้ไฟล์ `firebase-config.js` ในโฟลเดอร์โปรเจกต์:

```javascript
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

ค่าเหล่านี้เป็น public client config ตามที่ Firebase ออกแบบไว้ ความคุมสิทธิ์อยู่ที่ Security Rules

### ขั้นที่ 6: ตั้งรหัสผ่านแอดมิน (Passcode)

ใน `app.js` หา `PASSCODE_HASH` แล้วนำรหัสที่ต้องการมา hash เป็น SHA-256

ใน Console ของเบราว์เซอร์ (F12):

```javascript
const buf = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode("YOUR_PASSWORD")
);
console.log(
  Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
);
```

วางผลลัพธ์ลง `PASSCODE_HASH`  
รหัสผู้ช่วย (`MANAGER_PASSCODE`) ตั้งแยกในไฟล์เดียวกัน — เป็นข้อความตรง ไม่ได้ hash

### ขั้นที่ 7: GitHub

รีโปที่ใช้อยู่แล้ว: `https://github.com/leezen441/Badcount.git`

ถ้าเริ่มรีโปใหม่:

```bash
git init
git add .
git commit -m "Initial BadCount App Setup"

git remote add origin https://github.com/USERNAME/badcount.git
git branch -M main
git push -u origin main
```

### ขั้นที่ 8: Deploy ขึ้น Vercel

1. [Vercel](https://vercel.com) → Import รีโปจาก GitHub
2. ไม่ต้องตั้ง build command (สแตติก + `/api`)
3. ใส่ env ของ LINE ถ้าจะใช้บอท → Deploy
4. ได้ URL เช่น `https://your-app.vercel.app`

🎉 ส่งลิงก์ก๊วนให้สมาชิกลงชื่อและสแกนจ่ายได้ทันที

---

## 🧮 สูตรคำนวณค่าใช้จ่าย

สูตรใน `calcSessionTotals` (`app.js`) และ `api/_totals.js` ต้องตรงกัน:

```
N = จำนวนสมาชิกในก๊วน

ค่าคอร์ตต่อคน  = (ค่าคอร์ตรวม ÷ N)  หรือ  ราคาต่อคนคงที่   ตาม courtFeeType
ค่าอื่นๆ ต่อคน  = (ค่ารวม ÷ N)      หรือ  ราคาต่อคนคงที่   ตาม otherCostType

ลูกของสมาชิก X =
  shuttlesUsed (ใส่เอง) + ส่วนแบ่งลูกจากทุกแมตช์ที่ X ลง
  (แมตช์หารให้ผู้เล่นในเกมนั้น; ถ้ามีคน exempt คนที่เหลือแบกส่วนนั้น)

ลูกที่คิดเงิน = 0 ถ้า excludeAllShuttles
             หรือ max(0, ลูกของ X − shuttlesExcluded)
             หรือตามปกติ

ยอด X = ค่าคอร์ตต่อคน + ค่าอื่นๆ ต่อคน + (ลูกที่คิดเงิน × shuttlePrice)

ถ้ามี manualFee → ใช้ยอดนั้นแทนทั้งสูตร
```

โหมดลูก:
- **เบอร์ลูก** (ค่าเริ่ม): ใส่ `1-5, 8` แล้วระบบนับจำนวน
- **นับจำนวน** (`simpleShuttleCount`): ใส่ตัวเลขจำนวนลูกตรงๆ

### ตัวอย่าง (ยังไม่มียกเว้น / manualFee)
ก๊วน 4 คน ค่าคอร์ตรวม 400 · ค่าน้ำรวม 100 · ลูกละ 25 · A ใช้ 2, B 1, C 2, D 1

| สมาชิก | ค่าสนาม | ค่าน้ำ/อื่นๆ | ค่าลูก | ยอดสุทธิ |
|:---:|:---:|:---:|:---:|:---:|
| **A** | 100 ฿ | 25 ฿ | 50 ฿ (2 ลูก) | **175 ฿** |
| **B** | 100 ฿ | 25 ฿ | 25 ฿ (1 ลูก) | **150 ฿** |
| **C** | 100 ฿ | 25 ฿ | 50 ฿ (2 ลูก) | **175 ฿** |
| **D** | 100 ฿ | 25 ฿ | 25 ฿ (1 ลูก) | **150 ฿** |
| **รวม** | **400 ฿** | **100 ฿** | **150 ฿** | **650 ฿** |

---

## 📲 PWA Install

### 🤖 Android (Chrome)
1. เปิด URL ด้วย Chrome
2. เมนู (⋮) → **Install app** / **Add to Home screen**

### 🍎 iOS (Safari เท่านั้น)
1. เปิดด้วย **Safari**
2. Share → **Add to Home Screen**
3. (ถ้าต้องการแจ้งเตือน) Settings → Notifications → BadCount

### 💻 Desktop (Chrome / Edge)
1. ไอคอนติดตั้งใน address bar หรือเมนู → **Install BadCount...**

ถ้าเปิดใน LINE in-app browser แอปจะพยายามเด้งออกไปบราวเซอร์จริง (`openExternalBrowser=1`) เพราะแชร์รูป/กล้องใน LINE มักไม่ครบ

---

## 🛠️ รันในเครื่อง

**แอปหลัก (สแตติก + Firestore):**
```bash
python -m http.server 8000
```
เปิด `http://localhost:8000`  
หรือ VS Code **Live Server** ที่ `index.html`

ต้องมีเน็ตสำหรับ Firebase + CDN (Tailwind, Fonts, jsQR)

**LINE `/api/*`:** ใช้ `vercel dev` หลัง `npm install` และใส่ env ของ LINE — `http.server` ไม่รัน serverless

---

## 💰 โควตาฟรี

| บริการ | Free tier ที่เกี่ยวข้อง | หมายเหตุของแอปนี้ |
|---|---|---|
| **Vercel Hosting** | bandwidth ตามแพลน Hobby | สแตติก + cron + serverless LINE |
| **Firestore (Spark)** | reads / writes รายวัน | ฐานข้อมูลหลัก + สลิป base64 ใน subcollection `receipts` |
| **LINE Messaging API** | ตามโควตาช่องทาง | เลยตัด auto-invite ต่อการลงชื่อ |

ไม่ใช้ Firebase Storage — รูปสลิปอยู่ใน Firestore document

---

## 🏗️ เทคโนโลยี (Tech Stack)

| เลเยอร์ | ของที่ใช้ |
|---|---|
| **Frontend** | HTML + `premium.css` + Tailwind CDN + Vanilla JS (ไม่มี build) |
| **Database** | Firebase Firestore realtime (`onSnapshot`) |
| **Hosting** | Vercel (push GitHub → deploy) + Cron |
| **Auth** | Admin SHA-256 + Manager passcode + Temp PIN — ไม่ใช้ Firebase Auth |
| **PWA** | Manifest + Service Worker + Notification API |
| **QR** | `qrcode.min.js` (สร้าง PromptPay) + jsQR CDN (อ่านสลิป) |
| **LINE** | Messaging API ผ่าน `api/*.js` |

---

## 🔒 ข้อควรระวังด้านความปลอดภัย

- รหัสแอดมินเก็บเป็น **SHA-256** ในซอร์ส ไม่เก็บรหัสดิบของแอดมิน
- รหัสผู้ช่วย (`MANAGER_PASSCODE`) เป็นข้อความตรงใน `app.js` — เปลี่ยนเองถ้าแชร์รีโปสาธารณะ
- ทราฟฟิกผ่าน **HTTPS** ของ Vercel
- Firestore rules ชุดปัจจุบัน **อ่าน/เขียนได้ทุกคน** (จำกัดสมาชิก ≤ 50) — ผู้ที่มีลิงก์ `/#/session/{id}`, `/#/m/{id}` หรือ `/#/join/{id}` เข้าถึงข้อมูลก๊วนนั้นได้
- `/api/line-notify` ไม่มี auth ของผู้เรียก — ใครรู้ `sessionId` ตอนบอท active อาจทริกเกอร์โพสต์ LINE ได้
- ถ้าต้องการล็อกเข้มขึ้น ค่อยเพิ่ม Firebase Authentication ในภายหลัง

---

## 📝 สัญญาอนุญาต (License)

โปรเจกต์นี้อยู่ภายใต้สัญญาอนุญาตสิทธิ์ **MIT License**

นำไปปรับแต่ง แก้ไข แจกจ่าย หรือพัฒนาต่อยอดในก๊วนของคุณได้โดยไม่ต้องขออนุญาต

🏸 **BadCount — Count Every Game. Enjoy Every Match.**
