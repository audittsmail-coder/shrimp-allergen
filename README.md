# ผลตรวจเชื้อรายบ่อ (Per-Pond Pathogen Viewer)

เว็บแอปหน้าเดียว (ไม่มี build step) สำหรับ**ดู**ผลตรวจเชื้อรายบ่อที่เก็บไว้ใน Firebase (Firestore)
หน้าแรกแสดงบ่อทั้งหมดเป็นช่องสี่เหลี่ยม จัดกลุ่มตามฟาร์ม สีของช่องบอกระดับผลเชื้อล่าสุด
(แดง = วิกฤต, เหลือง = เฝ้าระวัง, เขียว = ปกติ, เทา = ยังไม่มีข้อมูล) กดเข้าไปที่บ่อใดบ่อหนึ่งจะเห็น
ประวัติผลเชื้อทุกสัปดาห์ที่เคยบันทึกไว้ของบ่อนั้น

**แอปนี้ไม่มีหน้า "นำเข้ารายงาน" แล้ว** — การนำเข้าข้อมูลผลเชื้อรายสัปดาห์ใหม่ทำโดยส่งไฟล์รายงาน
ให้ Claude แยกข้อมูลแล้วบันทึกลง Firebase โดยตรง ไม่ต้องผ่านหน้าเว็บนี้

## โครงสร้างไฟล์

- `index.html` — หน้าแอป (หน้าแรก = กริดบ่อ, หน้ารายละเอียด = ประวัติผลเชื้อของบ่อนั้น)
- `app.js` — เชื่อม UI เข้ากับ firebase.js, จัดกลุ่มบ่อตามฟาร์ม, แสดง/ลบประวัติรายบ่อ
- `firebase.js` — เชื่อมต่อ Firebase (Firestore + Anonymous Auth), อ่านข้อมูลบ่อ/ประวัติผลเชื้อ,
  ลบรายการ/ล้างข้อมูลรายบ่อ (ไม่มีฟังก์ชันเขียน/บันทึกรายงานใหม่แล้ว)
- `style.css` — ธีมสีเข้ม (dark theme)
- `parser.js` — ตัวแยกข้อมูลจาก HTML รายงาน เก็บไว้ในโปรเจกต์เพื่อให้ Claude เรียกใช้ตอนนำเข้า
  รายงานใหม่ (ไม่ได้ถูกอ้างอิงจาก `index.html`/`app.js` แล้ว)

## การตั้งค่า Firebase

โปรเจกต์ Firebase (`shrimp-farm-data`) ถูกตั้งเป็นค่าเริ่มต้นไว้ใน `firebase.js` แล้ว (`DEFAULT_CONFIG`)
เปิดแอปแล้วเชื่อมต่อได้เลยโดยไม่ต้องกรอกอะไรเพิ่ม — ค่านี้เป็น Firebase **web config** ซึ่งไม่ใช่ความลับ
(ระบุแค่ว่าเชื่อมโปรเจกต์ไหน การเข้าถึงจริงถูกควบคุมด้วย Firestore security rules + Auth ด้านล่าง
ไม่ใช่ด้วยการซ่อนค่านี้) จึงฝังไว้ในโค้ดได้อย่างปลอดภัย

ก่อนใช้งานจริง ให้ไปที่ [Firebase Console](https://console.firebase.google.com/project/shrimp-farm-data)
แล้วตรวจสอบว่าเปิดใช้งานสิ่งเหล่านี้แล้ว:

1. **Firestore Database** (โหมด production หรือ test ก็ได้ จะตั้ง rule เองด้านล่าง)
2. **Authentication → Sign-in method → Anonymous** (แอปนี้ใช้ anonymous auth
   เพื่อให้ทุกคนที่เปิดแอปอ่านข้อมูลได้โดยไม่ต้องมีระบบ login แยก)

### กฎความปลอดภัย Firestore (แนะนำ)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /ponds/{pondId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## โครงสร้างข้อมูลใน Firestore

แอปนี้เชื่อมกับ Firestore ของ**อีกแอปที่มีอยู่แล้ว** (แอปจัดการบ่อ/บันทึกการเจริญเติบโตรายสัปดาห์)
โดยอ่านผลเชื้อจาก**เอกสารบ่อโดยตรง** (`ponds/{pondId}`) ไม่แตะต้องคอลเลกชัน `records`
(ซึ่งเป็นบันทึกการเจริญเติบโต/ให้อาหารรายสัปดาห์ของอีกแอป คนละเรื่องกับผลเชื้อ)

- **`ponds/{pondId}`** (มีอยู่แล้ว) — เอกสาร 1 อันต่อ 1 บ่อ มีฟิลด์เดิม `name` (เลขบ่อ เช่น
  `"303"` หรือ `"303(ชื่อเล่น)"`), `farmId`, `species`, `brand`, `releaseDate`, `releaseCount`
  และฟิลด์ผลเชื้อที่แอปนี้อ่าน:
  - `pathogenStatus`, `pathogenSeverity` (`normal`/`watch`/`critical`), `pathogenWorsened`,
    `pathogenDate`, `pathogenAmmonia`, `pathogenNitrite`, `pathogenPh`, `pathogenAlkalinity`,
    `pathogenSalinity`, `pathogenReportId` — ผลล่าสุดเท่านั้น ใช้แสดงสีของช่องบ่อในหน้าแรก
  - `pathogenHistory[]` — array เก็บผลทุกสัปดาห์ที่เคยนำเข้า แต่ละรายการมี
    `{ weekDate, status, severity, worsened, ammonia, nitrite, ph, alkalinity, salinity, reportId }`
    ใช้แสดงในหน้ารายละเอียดของบ่อนั้น

## วิธีนำเข้าผลเชื้อรายสัปดาห์ใหม่

ส่งไฟล์ HTML รายงานผลตรวจเชื้อ (รูปแบบเดียวกับที่เคยใช้) ให้ Claude ในเซสชันนี้ — Claude จะ:

1. แยกข้อมูลด้วย `parser.js` (รองรับหลายเทมเพลตรายงานที่เคยเจอมาแล้ว)
2. จับคู่เลขบ่อในรายงานกับบ่อที่ลงทะเบียนไว้แล้วใน `ponds` (ข้ามบ่อที่ยังไม่ได้เพิ่มในแอปจัดการบ่อ
   และแจ้งให้ทราบว่าบ่อไหนถูกข้าม)
3. เขียนผลเชื้อของแต่ละบ่อลง `ponds/{pondId}` โดยตรงผ่าน Firestore REST API (อัปเดตฟิลด์ล่าสุด
   + เพิ่มรายการใหม่เข้า `pathogenHistory[]`)
4. ยืนยันผลกลับมาว่าบ่อไหนบันทึกสำเร็จ/บ่อไหนยังไม่ได้ลงทะเบียน

ไม่ต้องเปิดแอปนี้ระหว่างนำเข้าข้อมูล — เปิดแอปนี้เพื่อ**ดูผล**หลังจากบันทึกเสร็จแล้วก็พอ

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

อัปโหลดไฟล์ `index.html`, `app.js`, `firebase.js`, `style.css` ขึ้นโฮสต์ static ใดก็ได้
(Firebase Hosting, GitHub Pages, Netlify, Vercel ฯลฯ) ไม่ต้อง build (`parser.js` ไม่จำเป็นต้อง
deploy เพราะไม่ได้ถูกใช้จากหน้าเว็บแล้ว แต่เก็บไว้ใน repo ก็ไม่มีผลเสียอะไร)

ตัวอย่างด้วย Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # เลือกโฟลเดอร์นี้เป็น public directory
firebase deploy
```
