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

## การตั้งค่า Firebase

โปรเจกต์ Firebase (`shrimp-farm-data`) ถูกตั้งเป็นค่าเริ่มต้นไว้ใน `firebase.js` แล้ว (`DEFAULT_CONFIG`)
เปิดแอปแล้วเชื่อมต่อได้เลยโดยไม่ต้องกรอกอะไรเพิ่ม — ค่านี้เป็น Firebase **web config** ซึ่งไม่ใช่ความลับ
(ระบุแค่ว่าเชื่อมโปรเจกต์ไหน การเข้าถึงจริงถูกควบคุมด้วย Firestore security rules + Auth ด้านล่าง
ไม่ใช่ด้วยการซ่อนค่านี้) จึงฝังไว้ในโค้ดได้อย่างปลอดภัย

ก่อนใช้งานจริง ให้ไปที่ [Firebase Console](https://console.firebase.google.com/project/shrimp-farm-data)
แล้วตรวจสอบว่าเปิดใช้งานสิ่งเหล่านี้แล้ว:

1. **Firestore Database** (โหมด production หรือ test ก็ได้ จะตั้ง rule เองด้านล่าง)
2. **Authentication → Sign-in method → Anonymous** (แอปนี้ใช้ anonymous auth
   เพื่อให้ทุกคนที่เปิดแอปเขียนข้อมูลได้โดยไม่ต้องมีระบบ login แยก)

ถ้าต้องการใช้โปรเจกต์ Firebase อื่นแทน (เช่น เปิดจากเครื่อง/บัญชีอื่น) กด **⚙️ ตั้งค่า Firebase**
มุมขวาบนของแอป แล้ววาง config ของโปรเจกต์นั้นแทนได้ ค่าที่ใส่เองจะถูกเก็บไว้ใน `localStorage`
ของเบราว์เซอร์นั้นๆ และมีผลเหนือค่าเริ่มต้นในโค้ด

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
