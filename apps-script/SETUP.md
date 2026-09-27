# Audit Log — Setup (Google Sheets + Apps Script)

ทำครั้งเดียว ใช้เวลา ~5 นาที ด้วยบัญชี Google Workspace ของคุณ

## 1. สร้าง Sheet
1. ไปที่ https://sheets.new → ตั้งชื่อ เช่น `Nozomi Summary — Usage Log`
2. เมนู **Extensions → Apps Script**

## 2. วางโค้ด
1. ลบโค้ดเดิมใน `Code.gs` แล้ววางเนื้อหาจาก [`Code.gs`](Code.gs) ทั้งไฟล์ → **Save** (Ctrl+S)
2. เลือกฟังก์ชัน `setup` ในแถบด้านบน → **Run**
3. ครั้งแรกจะขอสิทธิ์ → Review permissions → เลือกบัญชี → Allow
4. กลับไปที่ Sheet ควรเห็นแท็บ `Log` (มี header) และ `Summary`

## 3. Deploy เป็น Web App
1. **Deploy → New deployment** → ⚙️ เลือก **Web app**
2. ตั้งค่า:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
3. **Deploy** → คัดลอก **Web app URL** (`https://script.google.com/macros/s/.../exec`)
4. ส่ง URL นั้นให้ผู้ดูแลโค้ด (ใส่ใน `app.js` และ `extension/src/audit.js`)

ทดสอบ: เปิด URL ในเบราว์เซอร์ ควรเห็น `{"ok":true,"service":"nozomi-summary-audit"}`

## อัปเดตเป็น v1.2.0 (หน้า Audit บนเว็บ)
1. วาง [`Code.gs`](Code.gs) เวอร์ชันใหม่ทับทั้งไฟล์ → **Save**
2. **Deploy → Manage deployments → ✏️ (deployment เดิม) → Version: New version → Deploy**
   — ห้ามกด *New deployment* เพราะ URL จะเปลี่ยน และ extension ของทุกคนจะส่ง log ไม่ได้
3. ทดสอบ: เปิด `<Web app URL>?action=logs` ควรเห็น `{"ok":true,"generated_at":...,"rows":[...]}`

## การแก้โค้ดภายหลัง
แก้ `Code.gs` แล้วต้อง **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**
(URL เดิมยังใช้ได้ ไม่ต้องแก้ฝั่ง client)

## ถ้าโดน spam
1. เปลี่ยน `TOKEN` ใน `Code.gs` + ใน `app.js` + `extension/src/audit.js`
2. **New deployment** (ได้ URL ใหม่) → archive deployment เก่า
3. อัปเดต URL ฝั่ง client (`app.js`→`audit.js`, `extension/src/audit.js`, `audit-view.js`) แล้ว deploy เว็บ + แจก extension ใหม่

## สิทธิ์การเข้าถึง
- Sheet เป็นของคุณคนเดียว — แชร์แบบ **Viewer** ให้คนที่ต้องดู
- "Anyone" ใน Web App หมายถึงใครก็ *ส่ง* log ได้ (จำเป็น เพราะผู้ใช้ไม่ได้ login Google)
- ตั้งแต่ v1.2.0 ใครก็ *อ่าน* log ผ่าน `?action=logs` ได้ (หน้า Audit บนเว็บ) — ย้อนหลัง 90 วัน สูงสุด 2,000 แถว
  และ **ไม่ส่ง `device_id` / `user_agent`** ออกไป; ตัว Sheet ยังเป็นของคุณคนเดียวเหมือนเดิม
- เว็บ (`audit-view.js`) มี URL เดียวกันอีกที่ — ถ้าเปลี่ยน URL ต้องแก้ `audit.js`, `extension/src/audit.js` และ `audit-view.js`
