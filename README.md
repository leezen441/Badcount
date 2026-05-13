# 🏸 BadCount — แอปบันทึกเกมแบดมินตัน

แอปเว็บง่ายๆ สำหรับจดสมาชิกที่มาตีแบด, นับลูกที่ใช้, คำนวณค่าใช้จ่ายต่อคน และเก็บประวัติย้อนหลังได้
ทุกคนเปิดดูพร้อมกันได้ผ่านลิงก์เดียวกัน — real-time sync

## ✨ คุณสมบัติหลัก

- ✅ สร้าง "กลุ่ม" ของแต่ละวัน แชร์ลิงก์เดียว ทุกคนเข้าได้
- ✅ เพิ่มชื่อสมาชิกได้เรื่อยๆ
- ✅ กดปุ่ม +/− นับลูกที่แต่ละคนใช้
- ✅ คำนวณอัตโนมัติ: ค่าคอร์ดหารเท่ากัน + ค่าลูกตามที่ใช้จริง + ค่าอื่นๆ หารเท่ากัน
- ✅ ดูประวัติย้อนหลังได้
- ✅ มี QR code แชร์ง่ายๆ
- ✅ Real-time sync — ทุกคนเห็นการอัปเดตพร้อมกัน
- ✅ ไม่ต้อง login ใดๆ

## 🚀 วิธีติดตั้ง (ทำครั้งเดียว ใช้ตลอด)

### ขั้นที่ 1: สร้าง Firebase project (ฟรี)

1. ไปที่ https://console.firebase.google.com/
2. คลิก **Add project** → ตั้งชื่อ เช่น `badcount` → กด Continue ไปเรื่อยๆ (ปิด Analytics ก็ได้)
3. รอจนสร้างเสร็จ → กด Continue

### ขั้นที่ 2: เพิ่ม Web App ใน Firebase

1. ที่หน้า Project Overview กดไอคอน **`</>`** (Web)
2. ตั้งชื่อ app เช่น `badcount-web` → กด Register app
3. **Copy ค่า `firebaseConfig` ที่ขึ้นมา** (ทั้งก้อน) — เดี๋ยวเอาไปแปะในขั้นถัดไป
4. กด Continue to console

### ขั้นที่ 3: เปิด Firestore Database

1. ในเมนูซ้าย → **Build** → **Firestore Database**
2. กด **Create database**
3. เลือก **Start in test mode** (ใช้ทดลองได้ 30 วัน เดี๋ยวเราตั้ง Rules ภายหลัง)
4. เลือก region ใกล้ๆ เช่น **asia-southeast1 (Singapore)** → Enable

### ขั้นที่ 4: ตั้ง Security Rules ให้ปลอดภัย (สำคัญมาก!)

ใน Firestore Database → tab **Rules** → แทนที่เนื้อหาทั้งหมดด้วยกฎด้านล่าง แล้วกด **Publish**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      // ทุกคนอ่าน/เขียนข้อมูล session ได้ (เหมาะกับ public sharing)
      // แต่ป้องกัน abuse: จำกัดขนาด document และจำนวนสมาชิก
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['date', 'members', 'status'])
                    && request.resource.data.members.size() <= 50;
      allow update: if request.resource.data.members.size() <= 50
                    && request.resource.data.size() < 30;
      allow delete: if true;
    }
  }
}
```

> 💡 ถ้าอยากเข้มกว่านี้ เช่น ลบได้แค่ภายใน 24 ชม. หรือต้องมี passcode ให้แก้ rules นี้ตามต้องการ

### ขั้นที่ 5: ใส่ Firebase config ในโปรเจกต์

เปิดไฟล์ **`firebase-config.js`** ในโฟลเดอร์นี้
แทนที่ค่าใน object `firebaseConfig` ด้วยค่าที่ copy มาจาก Firebase (ขั้นที่ 2)

```javascript
export const firebaseConfig = {
  apiKey: "AIza...",                    // ← ค่าจริงจาก Firebase
  authDomain: "badcount.firebaseapp.com",
  projectId: "badcount",
  storageBucket: "badcount.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

> หมายเหตุ: ค่าเหล่านี้ **ไม่ใช่ความลับ** — Firebase ออกแบบให้ใส่ใน frontend ได้
> ความปลอดภัยจริงๆ มาจาก Firestore Security Rules ที่เราตั้งในขั้นที่ 4

### ขั้นที่ 6: Push ขึ้น GitHub

```bash
# ใน folder Badminton/
git init
git add .
git commit -m "Initial BadCount app"

# สร้าง repo ใน GitHub แล้วลิงก์
git remote add origin https://github.com/USERNAME/badcount.git
git branch -M main
git push -u origin main
```

### ขั้นที่ 7: เปิด GitHub Pages

1. ใน GitHub repo → **Settings** → **Pages**
2. ใต้ **Branch** เลือก `main` → folder `/ (root)` → Save
3. รอสัก 1-2 นาที จะได้ URL `https://USERNAME.github.io/badcount/`
4. **สำคัญ**: กลับไปที่ Firebase Console → Project Settings → Authorized domains → Add domain → ใส่ `USERNAME.github.io`

🎉 เสร็จ! แชร์ URL ให้เพื่อนๆ ได้เลย

## 🧮 สูตรคำนวณค่าใช้จ่าย

```
จำนวนคนทั้งหมด = N
ค่าคอร์ดต่อคน = ค่าคอร์ดรวม ÷ N           ← หารเท่ากัน
ค่าอื่นๆ ต่อคน = ค่าอื่นๆ ÷ N             ← หารเท่ากัน
ค่าลูกของคน X = (จำนวนลูกที่ X ใช้) × ราคาลูก/ลูก

ยอดที่คน X จ่าย = ค่าคอร์ดต่อคน + ค่าอื่นๆ ต่อคน + ค่าลูกของ X
```

**ตัวอย่าง**: คอร์ด 400, ลูกละ 25, ค่าน้ำ 100, มี 4 คน (A,B,C,D), ลูกใช้ A=2, B=1, C=2, D=1
- ค่าคอร์ดต่อคน = 100
- ค่าน้ำต่อคน = 25
- A จ่าย = 100 + 25 + (2×25) = 175 ฿
- B จ่าย = 100 + 25 + (1×25) = 150 ฿
- C จ่าย = 100 + 25 + (2×25) = 175 ฿
- D จ่าย = 100 + 25 + (1×25) = 150 ฿
- รวม = 650 ฿ ✓ (= 400 + 150 + 100)

## 📁 โครงสร้างไฟล์

```
Badminton/
  ├─ index.html          ← UI ทั้งหมด
  ├─ app.js              ← Logic + Firebase
  ├─ firebase-config.js  ← ค่า config (แก้ไฟล์นี้)
  └─ README.md           ← ไฟล์นี้
```

## 🛠️ ทดสอบในเครื่องก่อน push

วิธีง่ายที่สุด (ต้องมี Python):
```bash
cd Badminton
python -m http.server 8000
# เปิด browser ไปที่ http://localhost:8000
```

หรือใช้ VS Code extension **Live Server** → คลิกขวาที่ `index.html` → Open with Live Server

## 💰 ค่าใช้จ่าย

ทั้งหมด **ฟรี** ภายใต้ขีดจำกัด:
- **GitHub Pages**: ฟรีไม่จำกัดเวลา (สำหรับ public repo)
- **Firebase Firestore (Spark Plan)**:
  - 1 GB storage
  - 50,000 reads / 20,000 writes ต่อวัน
  - เพียงพอสำหรับก๊วนแบดเป็นพันๆ ก๊วน

## 🔒 หมายเหตุด้านความปลอดภัย

- ใครก็ตามที่มีลิงก์ของ session จะแก้ไขได้ (รวมถึงลบ) — เหมาะกับกลุ่มเพื่อนที่ไว้ใจกัน
- ถ้าอยาก lock ก๊วนเก่าไม่ให้แก้ ใช้ปุ่ม "ปิดก๊วน" (แต่ตอนนี้ปิดเฉพาะ UI status เท่านั้น)
- ถ้าต้องการให้แก้ไขได้แค่คนสร้าง ต้องเพิ่ม Firebase Authentication

## 📝 License

MIT — ใช้ฟรี แก้ไขได้ตามต้องการ
