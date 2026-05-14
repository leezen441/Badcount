# 🏸 BadCount — แอปบันทึกเกมแบดมินตัน

Web App (PWA) สำหรับจดสมาชิก นับลูก คำนวณค่าใช้จ่าย และจัดเกมแบดมินตัน
Real-time sync ทุกคนเห็นพร้อมกัน — ใช้ฟรี 100%

🌐 **Live Demo**: https://badcount.vercel.app

---

## ✨ คุณสมบัติหลัก

### 👥 จัดการกลุ่ม
- ✅ สร้างกลุ่มของแต่ละวัน
- ✅ ปุ่ม **"ก๊วนอาทิตย์หน้า"** Copy ค่าจากกลุ่มล่าสุด + auto-set วันอาทิตย์ใกล้ที่สุด
- ✅ แชร์ลิงก์ **Invite** / **Manager Link** ให้เพื่อน (real-time)
- ✅ เพิ่ม/ลบสมาชิกได้ตลอด + suggestion จากประวัติชื่อเก่า
- ✅ ประวัติย้อนหลัง (โหลด 50 รายการล่าสุด)
- ✅ Highlight กลุ่มที่ปิดแล้วด้วยกรอบเขียว

### 🏟️ จัดการสนาม
- ✅ ระบุเลขสนาม + เวลา (เปิด-ปิดแต่ละสนามไม่พร้อมกันได้)
- ✅ Time picker dropdown 24-hour
- ✅ Suggestion จากกลุ่มก่อนหน้า

### 💰 คำนวณค่าใช้จ่าย
- ✅ ค่าคอร์ด: toggle **"รวม (หารเท่ากัน)"** หรือ **"ต่อคน"**
- ✅ ค่าลูกแบดตามที่ใช้จริง (พิมพ์ range เช่น `1-5, 8`)
- ✅ ค่าอื่นๆ (น้ำ/อาหาร) toggle เดียวกัน
- ✅ Mark สถานะ "จ่ายแล้ว" รายคน + strikethrough

### 🎮 จัดเกม + สถิติ
- ✅ จัดเกม 4 คน — AI recommend ("แนะนำ" คนที่เล่นน้อย/ยังไม่เคยเล่นด้วยกัน)
- ✅ บันทึกเบอร์ลูกที่ใช้ในแต่ละเกม
- ✅ สถิติ **"เคยเล่นด้วยกัน"** รายคน (badge สี 3 ระดับ)

### 📤 Export & Sharing
- ✅ **Bill JPG** — สรุปยอดสวยๆ พร้อม QR เงิน
- ✅ **บันทึกภาพทวงค่า** — รูปสำหรับส่งไลน์ทวงคนค้างจ่าย
- ✅ **Bank QR (Promptpay)** — แชร์ทั้งระบบ ทุกคนเห็นเดียวกัน (Cloud sync)

### 🔔 Notification (Real-time แจ้งเตือนเมื่อคนใหม่เข้าร่วม)
- ✅ Toast ในแอป + ping sound
- ✅ Tab title กระพริบ + count
- ✅ **Native OS notification** (admin/manager เท่านั้น)
- ✅ คลิก notification → focus tab BadCount ทันที

### 📲 PWA — Install เป็นแอปได้
- ✅ Manifest + Service Worker
- ✅ Install บน home screen (Android / iOS / Desktop)
- ✅ เปิดเต็มจอ ไม่มี URL bar
- ✅ Offline support (cache HTML/JS/CSS)

### 🔒 Authentication
- ✅ Passcode login (SHA-256 hashed)
- ✅ Session 30 วัน
- ✅ 3 ระดับสิทธิ์ผ่าน URL pattern

---

## 🌐 Routes / URL Patterns

| URL | สิทธิ์ | ใช้ทำอะไร |
|---|---|---|
| `/#/` | Admin (ต้อง login) | หน้าหลัก + สร้างกลุ่มใหม่ |
| `/#/history` | Admin (ต้อง login) | ดูประวัติย้อนหลัง 50 รายการ |
| `/#/session/{id}` | Admin (ต้อง login) | จัดการกลุ่ม (เต็มสิทธิ์) |
| `/#/m/{id}` | Manager (ไม่ต้อง login) | จัดการเฉพาะกลุ่มนี้ (lock nav) |
| `/#/join/{id}` | Member (public) | ลงชื่อเข้าร่วม + ดูยอดของตัวเอง |

---

## 📁 โครงสร้างไฟล์

```
Badminton/
  ├─ index.html          ← UI ทั้งหมด
  ├─ app.js              ← Logic + Firebase + PWA registration
  ├─ firebase-config.js  ← Firebase config (แก้ไฟล์นี้)
  ├─ manifest.json       ← PWA manifest
  ├─ icon.svg            ← App icon (gradient + 🏸)
  ├─ icon-maskable.svg   ← Android adaptive icon
  ├─ sw.js               ← Service Worker (cache + notification click)
  ├─ qrcode.min.js       ← QR Code library (สำหรับสร้าง QR แชร์ลิงก์)
  ├─ .gitignore
  └─ README.md           ← ไฟล์นี้
```

---

## 🚀 วิธีติดตั้ง (Setup ครั้งเดียว ใช้ตลอด)

### ขั้นที่ 1: สร้าง Firebase Project (ฟรี)

1. ไปที่ https://console.firebase.google.com/
2. คลิก **Add project** → ตั้งชื่อ เช่น `badcount`
3. **ปิด Google Analytics** (ไม่จำเป็น)
4. รอจนสร้างเสร็จ → Continue

### ขั้นที่ 2: เพิ่ม Web App

1. ที่หน้า Project Overview → กดไอคอน **`</>`** (Web)
2. ตั้งชื่อ app เช่น `badcount-web` → **Register app**
3. **Copy `firebaseConfig`** (เก็บไว้ใช้ในขั้นที่ 5)
4. กด **Continue to console**

### ขั้นที่ 3: เปิด Firestore Database

1. เมนูซ้าย → **Build** → **Firestore Database**
2. **Create database** → เลือก **Standard edition**
3. **Location**: เลือก **`asia-southeast3 (Bangkok)`** ⚠️ เลือกครั้งเดียวเปลี่ยนไม่ได้
4. **Start in test mode** → Create
5. รอจนเสร็จ ~30 วินาที

### ขั้นที่ 4: ตั้ง Security Rules (สำคัญมาก!)

ใน Firestore → tab **Rules** → ลบทั้งหมด แล้วแปะอันนี้:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // กลุ่มแบดแต่ละครั้ง
    match /sessions/{sessionId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['date', 'members', 'status'])
                    && request.resource.data.members.size() <= 50;
      allow update: if request.resource.data.members.size() <= 50;
      allow delete: if true;
    }
    // Global settings (Bank QR ที่ใช้ร่วมกัน)
    match /settings/{docId} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

กด **Publish** → ยืนยัน

### ขั้นที่ 5: ใส่ Firebase Config

เปิดไฟล์ `firebase-config.js` แทนที่ด้วยค่าที่ copy จากขั้นที่ 2:

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

> 💡 ค่าเหล่านี้ **ไม่ใช่ความลับ** — Firebase ออกแบบให้ใส่ใน frontend ได้
> ความปลอดภัยจริงๆ มาจาก Security Rules (ขั้นที่ 4)

### ขั้นที่ 6: ตั้งรหัส Passcode

ในไฟล์ `app.js` หา `PASSCODE_HASH` แล้วเปลี่ยน

**วิธีสร้าง SHA-256 hash**:
1. เปิด Browser Console (F12)
2. รันโค้ดนี้ (เปลี่ยน `YOUR_PASSWORD` เป็นรหัสที่ต้องการ):

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

3. Copy hash ที่ได้ ไปใส่ใน `PASSCODE_HASH`

### ขั้นที่ 7: Push ขึ้น GitHub

```bash
cd Badminton/
git init
git add .
git commit -m "Initial BadCount app"

# สร้าง repo ใหม่บน GitHub แล้วลิงก์
git remote add origin https://github.com/USERNAME/badcount.git
git branch -M main
git push -u origin main
```

### ขั้นที่ 8: Deploy บน Vercel

1. ไปที่ https://vercel.com → Sign up with GitHub
2. **Add New Project** → Import repo `badcount`
3. ไม่ต้องตั้งค่าอะไรเพิ่ม → **Deploy**
4. รอ ~30 วินาที → ได้ URL `https://your-app.vercel.app`
5. (Optional) Project settings → เปลี่ยนชื่อ subdomain

✅ ทุกครั้งที่ commit + push GitHub → Vercel auto-deploy

### ขั้นที่ 9: Firebase Authorized domains

Firebase Console → **Authentication** → Settings → **Authorized domains**
→ Add domain → ใส่ `your-app.vercel.app`

🎉 **เสร็จ!** แชร์ URL ให้เพื่อนใช้ได้เลย

---

## 🧮 สูตรคำนวณค่าใช้จ่าย

```
จำนวนคนทั้งหมด = N

ค่าคอร์ดต่อคน  = (รวม ÷ N) หรือ (ต่อคนตามที่ตั้ง)
ค่าอื่นๆ ต่อคน = (รวม ÷ N) หรือ (ต่อคนตามที่ตั้ง)
ค่าลูกของคน X = (จำนวนลูกที่ X ใช้) × ราคาลูก/ลูก

ยอดที่คน X จ่าย = ค่าคอร์ดต่อคน + ค่าอื่นๆ ต่อคน + ค่าลูกของ X
```

**ตัวอย่าง**: ค่าคอร์ดรวม 400, ลูกละ 25, ค่าน้ำ 100, 4 คน (A,B,C,D), ลูกใช้ A=2, B=1, C=2, D=1

| คน | ค่าคอร์ด | ค่าน้ำ | ค่าลูก | รวม |
|---|---|---|---|---|
| A | 100 | 25 | 50 | **175 ฿** |
| B | 100 | 25 | 25 | **150 ฿** |
| C | 100 | 25 | 50 | **175 ฿** |
| D | 100 | 25 | 25 | **150 ฿** |
| **รวม** | 400 | 100 | 150 | **650 ฿** ✓ |

---

## 📲 PWA Install

### 🤖 Android (Chrome)
1. เปิด URL ใน Chrome
2. กดเมนู ⋮ (มุมขวาบน) → **Install app** หรือ **Add to Home screen**
3. หรือรอ Chrome แสดง banner

### 🍎 iOS (Safari เท่านั้น)
1. เปิด URL ใน **Safari** (Chrome iOS ไม่รองรับ)
2. แตะปุ่ม **Share** (□↑) ด้านล่าง
3. เลื่อนหา **"Add to Home Screen"** → กด Add
4. (Optional) ใน Settings → Notifications → BadCount → เปิด

### 💻 Desktop (Chrome / Edge / Brave)
1. มีไอคอน install ที่ address bar (จอ + ลูกศร) → คลิก
2. หรือเมนู ⋮ → **Install BadCount...**

---

## 🛠️ ทดสอบในเครื่องก่อน Deploy

**วิธี A: Python (ถ้าติดตั้งไว้)**
```bash
cd Badminton
python -m http.server 8000
# เปิด browser → http://localhost:8000
```

**วิธี B: VS Code Live Server**
1. ติดตั้ง extension **"Live Server"** (Ritwick Dey)
2. คลิกขวาที่ `index.html` → **Open with Live Server**

---

## 💰 ค่าใช้จ่าย

ฟรี 100% ภายใต้ขีดจำกัด:

| Service | Free Tier | เพียงพอสำหรับ |
|---|---|---|
| **Vercel Hosting** | 100 GB bandwidth/เดือน | ~10,000 sessions/เดือน |
| **Firebase Firestore (Spark)** | 50K reads + 20K writes/วัน | กลุ่มแบดเป็นพันๆ ครั้ง |
| **Firebase Storage** | 1 GB | QR code ของหลายร้อยกลุ่ม |

ใช้กลุ่มเพื่อนปกติ — ฟรีตลอดไป

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JS (no build) |
| Backend | Firebase Firestore (real-time) |
| Hosting | Vercel (auto-deploy via GitHub) |
| Auth | Passcode + Web Crypto API (SHA-256) |
| PWA | Web App Manifest + Service Worker |
| Notification | Web Notifications API + Web Audio API |
| QR Code | qrcode.min.js (CDN) |

---

## 🔒 หมายเหตุด้านความปลอดภัย

- ✅ Login passcode + SHA-256 hash (ไม่เก็บรหัสตรงๆ ใน source)
- ✅ HTTPS เท่านั้น (Vercel auto)
- ✅ Firestore Rules จำกัดขนาด document และจำนวนสมาชิก
- ⚠️ ใครที่มี link `/session/{id}` หรือ `/m/{id}` แก้ไขกลุ่มนั้นได้ — เหมาะกับเพื่อนที่ไว้ใจ
- ⚠️ ถ้าอยากเข้มกว่านี้ → ใช้ Firebase Authentication + Custom Claims (ต้องเขียนเพิ่ม)

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend: badcount.vercel.app                  │
│  ├─ index.html / app.js / sw.js (PWA)           │
│  └─ Tailwind CSS (CDN)                          │
└─────────────────────────────────────────────────┘
                       ↕ Real-time (onSnapshot)
┌─────────────────────────────────────────────────┐
│  Firebase Firestore (Bangkok region)            │
│  ├─ sessions/{id}     — กลุ่มแต่ละครั้ง         │
│  └─ settings/defaults — Bank QR (global)        │
└─────────────────────────────────────────────────┘
                       ↕
┌─────────────────────────────────────────────────┐
│  Local Storage (per-device)                     │
│  ├─ Auth token (30-day session)                 │
│  ├─ Last-used defaults (location, fee, etc.)    │
│  └─ Cached Bank QR                              │
└─────────────────────────────────────────────────┘
```

---

## 📝 License

MIT — Free to use, modify, share

ใช้ฟรี แก้ไขได้ตามต้องการ ไม่ต้องขออนุญาต
