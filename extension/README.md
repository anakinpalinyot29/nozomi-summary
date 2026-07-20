# Nozomi SOAR Robot — Browser Extension

เอ็กซ์เทนชัน (Manifest V3, ใช้ได้ทั้ง Chrome และ Edge) ที่ดึง alert ของกะจาก
Nozomi Vantage แล้ว normalize เป็น Excel ในคลิกเดียว — โดยใช้ session ที่คุณ
ล็อกอิน Vantage ไว้อยู่แล้ว **ไม่ต้องลง Python ไม่ต้อง 2FA ซ้ำ**

## ติดตั้ง (Load unpacked)

1. เปิดแท็บ **Vantage แล้วล็อกอินให้เสร็จ** (user + pass + 2FA) ไปหน้า `/alerts`
2. Chrome: `chrome://extensions` · Edge: `edge://extensions`
3. เปิด **Developer mode** → **Load unpacked** → เลือกโฟลเดอร์ `extension` นี้
4. (ครั้งแรก) กลับไปแท็บ Vantage → **refresh หน้า `/alerts` หนึ่งครั้ง** ให้ดัก `vantage-org`

## ใช้งาน

1. อยู่บนแท็บ Vantage (ล็อกอินแล้ว) → คลิกไอคอนบน toolbar
2. เลือก **วันที่** และ **กะ**: ☀️ Day · 🌙 Night · 📅 ทั้งวัน (Day+Night สแตกในไฟล์เดียว)
3. กด **⚡ Export & Download** → ได้ `.xlsx` ในโฟลเดอร์ Downloads
4. วางบล็อก (label + header + data ที่ลงสีแล้ว) ลงในไฟล์ SharePoint ที่แชร์กันด้วยมือ

ชิป `tab:` / `org:` ด้านบน popup บอกสถานะพร้อมใช้งาน (ต้องเป็น ✓ ทั้งคู่)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `manifest.json` | MV3, host_permissions โดเมน Vantage |
| `background.js` | ดัก `vantage-org` header จาก request ของ SPA (อ่านอย่างเดียว) |
| `popup.{html,css,js}` | UI + orchestration; ยิง API + normalize + download |
| `src/shifts.js` | คำนวณ window Day/Night (UTC+7) — port จาก `nozomi/shifts.py` |
| `src/normalize.js` | record→row + สร้าง Excel — port จาก `nozomi/normalize.py` + `config.py` |
| `lib/xlsx.bundle.js` | xlsx-js-style 1.2.0 (bundle ในเครื่อง; MV3 CSP โหลด CDN ไม่ได้) |

## หมายเหตุ

- ข้อมูล alert ไม่ออกนอกเครื่อง: fetch ทำใน origin ของ Vantage, สร้าง Excel ในเบราว์เซอร์
- ฟอร์แมต/สี/คอลัมน์ตรงกับ robot ฝั่ง Python และเว็บ nozomi-summary (สเปคเดียวกัน)
- tenant อื่น: URL ยังเข้าเงื่อนไข `https://*.vantage.nozominetworks.io/*`
- อัปเดตเวอร์ชัน = แทนไฟล์ในโฟลเดอร์แล้วกด reload ที่หน้า extensions (load unpacked ไม่ auto-update)
