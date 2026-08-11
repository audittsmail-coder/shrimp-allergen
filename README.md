# บันทึกผลเชื้อรายสัปดาห์ (Weekly Shrimp Culture Log)

เว็บแอปหน้าเดียว (ไม่มี build step) สำหรับวางไฟล์รายงานผลตรวจเชื้อรายสัปดาห์ (รูปแบบเดียวกับ
`summary_v2.html`) แล้วให้ระบบแยกข้อมูลผลเชื้อรายบ่อ/รายฟาร์มออกมาอัตโนมัติ ตรวจสอบ/แก้ไขก่อนบันทึก
แล้วเก็บลง Firebase (Firestore) เพื่อดูประวัติย้อนหลังและเทรนด์รายบ่อในสัปดาห์ถัดๆ ไป

## โครงสร้างไฟล์

- `index.html` — หน้าแอป (นำเข้ารายงาน / ประวัติ / เทรนด์รายบ่อ)
- `parser.js` — ตัวแยกข้อมูลจาก HTML รายงาน (อ่าน `.farm-group`, `.pcard`, `.severe`/`.alert`,
  `.compare-table` ฯลฯ ตามโครงสร้าง class ที่รายงานใช้ซ้ำทุกสัปดาห์)
- `firebase.js` — เชื่อมต่อ Firebase (Firestore + Anonymous Auth) และบันทึก/อ่านข้อมูล
- `app.js` — เชื่อม UI เข้ากับ parser และ firebase
- `style.css` — ธีมสี/ฟอนต์ให้ใกล้เคียงกับรายงานต้นฉบับ

## วิธีตั้งค่า Firebase (ทำครั้งเดียว)

1. ไปที่ [Firebase Console](https://console.firebase.google.com) → สร้างโปรเจกต์ (หรือใช้โปรเจกต์เดิม)
2. เปิดใช้งาน **Firestore Database** (โหมด production หรือ test ก็ได้ จะตั้ง rule เองด้านล่าง)
3. เปิดใช้งาน **Authentication → Sign-in method → Anonymous** (แอปนี้ใช้ anonymous auth
   เพื่อให้ทุกคนที่เปิดแอปเขียนข้อมูลได้โดยไม่ต้องมีระบบ login แยก)
4. ไปที่ Project settings → General → เลื่อนลงมาที่ "Your apps" → เพิ่มเว็บแอป (ไอคอน `</>`) →
   คัดลอกค่า `firebaseConfig` object
5. เปิดแอปนี้ → กด **⚙️ ตั้งค่า Firebase** ที่มุมขวาบน → วางค่า config (เป็น JSON) → กด "บันทึกและเชื่อมต่อ"

ค่า config จะถูกเก็บไว้ใน `localStorage` ของเบราว์เซอร์เท่านั้น **ไม่ได้ถูกเขียนลงในโค้ด/คอมมิต**
ดังนั้นทุกเครื่อง/เบราว์เซอร์ที่เปิดแอปต้องตั้งค่านี้เอง 1 ครั้ง

### กฎความปลอดภัย Firestore (แนะนำ)

ไปที่ Firestore → Rules แล้ววางกฎนี้ (อนุญาตเฉพาะผู้ที่ผ่าน anonymous auth แล้ว):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /reports/{reportId} {
      allow read, write: if request.auth != null;
    }
    match /pondHistory/{pondNo}/entries/{entryId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## โครงสร้างข้อมูลใน Firestore

- คอลเลกชัน `reports/{autoId}` — 1 เอกสารต่อการนำเข้อ 1 ครั้ง เก็บ title/เขต/รอบ, รายการบ่อทั้งหมด
  (`ponds[]`), การแจ้งเตือน (`alerts[]`), ข่าวดี (`goodNews[]`), คำแนะนำ (`recommendations[]`)
  และตารางเทียบผลดิบ (`compareTables[]`)
- คอลเลกชัน `pondHistory/{pondNo}/entries/{autoId}` — บันทึกแยกรายบ่อ (คัดลอกมาจาก `ponds[]`
  ตอนบันทึก) ใช้สำหรับหน้าจอ "เทรนด์รายบ่อ" โดยไม่ต้องสแกนทุกรายงาน

## การใช้งานรายสัปดาห์

1. เปิดแท็บ **📥 นำเข้ารายงาน**
2. อัปโหลดไฟล์ HTML รายงานสัปดาห์นั้น (หรือวางข้อความ HTML)
3. กด **🔍 แยกข้อมูล** — ระบบจะอ่านตาราง "สถานะแต่ละบ่อ" และดึงชื่อฟาร์ม/บ่อ/สถานะ/ระดับ
   (ปกติ-เฝ้าระวัง-วิกฤต) ออกมาเป็นตารางที่แก้ไขได้
4. ตรวจสอบ/แก้ไขวันที่ สถานะ หรือเพิ่ม-ลบแถวได้ตามต้องการ ก่อนบันทึก
5. กด **💾 บันทึกลง Firebase**
6. ดูย้อนหลังได้ที่แท็บ **🗂️ ประวัติรายสัปดาห์** หรือดูเทรนด์ต่อบ่อได้ที่ **📈 เทรนด์รายบ่อ**

## การรันแบบโลคัล

เนื่องจากแอปใช้ ES modules (`type="module"`) ต้องเปิดผ่าน HTTP server ไม่ใช่เปิดไฟล์ตรงๆ
(`file://`) เช่น:

```bash
python3 -m http.server 8080
# หรือ
npx http-server -p 8080
```

แล้วเปิด `http://localhost:8080`

## การ deploy

อัปโหลดไฟล์ `index.html`, `app.js`, `parser.js`, `firebase.js`, `style.css` ขึ้นโฮสต์ static
ใดก็ได้ (Firebase Hosting, GitHub Pages, Netlify, Vercel ฯลฯ) ไม่ต้อง build

ตัวอย่างด้วย Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # เลือกโฟลเดอร์นี้เป็น public directory
firebase deploy
```

## ข้อจำกัดของการแยกข้อมูลอัตโนมัติ

- Parser อ่านตามโครงสร้าง class ของรายงาน (`.farm-group`, `.pcard`, `.compare-table` ฯลฯ)
  ถ้ารายงานสัปดาห์ถัดไปใช้เทมเพลตเดิม จะแยกข้อมูลได้ถูกต้องอัตโนมัติ
- วันที่ของแต่ละบ่อจะอ้างอิงจากหัวข้อ/ป้ายวันที่ที่ใกล้ที่สุดในเอกสาร (เช่น
  "สถานะแต่ละบ่อ แยกตามฟาร์ม (ล่าสุด 10/8)") ถ้าบางฟาร์มมีวันที่อัปเดตต่างจากหัวข้อรวม
  ควรตรวจสอบ/แก้ไขคอลัมน์วันที่ในตารางก่อนกดบันทึก
- ตารางเทียบผลหลายสัปดาห์ (`.compare-table`) ถูกเก็บเป็นข้อมูลดิบ (หัวตาราง + แถว) ไว้อ้างอิง
  ไม่ได้แยกเป็นฟิลด์ VA/VV/Vp/แคลเซียมแยกกัน เนื่องจากแต่ละตารางมีคอลัมน์ไม่เหมือนกัน
