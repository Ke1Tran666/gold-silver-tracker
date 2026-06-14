# Gold Silver Tracker VN

Phan mem web realtime de theo doi gia vang trong pham vi Viet Nam, gia bac va mot so gia kim loai quy the gioi. Ung dung co backend rieng de lay du lieu dinh ky, day cap nhat realtime len giao dien va xuat bao cao Excel.

## Muc Luc

- [Tinh nang chinh](#tinh-nang-chinh)
- [Cong nghe su dung](#cong-nghe-su-dung)
- [Chay local](#chay-local)
- [Cau hinh](#cau-hinh)
- [Xuat file Excel](#xuat-file-excel)
- [Nguon du lieu](#nguon-du-lieu)
- [Ho tro AI voi Codex](#ho-tro-ai-voi-codex)
- [Tac gia](#tac-gia)

## Tinh nang chinh

- Theo doi gia vang Viet Nam theo thuong hieu, khu vuc va loai vang.
- Theo doi gia bac quy doi theo VND va USD.
- Hien thi gia vang the gioi, bac the gioi va cac kim loai quy lien quan.
- Cap nhat realtime bang Server-Sent Events tai `/api/stream`.
- Bieu do nen theo phong cach TradingView, co volume, crosshair va tooltip mau den khi hover.
- Bang du lieu co phan trang, toi da 30 dong moi trang.
- Hover vao dong bang de xem tham chieu: nguon, thoi diem cap nhat, don vi va URL.
- Xuat file `.xlsx` chuan Excel gom nhieu sheet.

## Cong nghe su dung

- Node.js built-in HTTP server.
- Frontend thuan HTML, CSS va JavaScript.
- Server-Sent Events cho realtime stream.
- Canvas API cho bieu do nen.
- OpenXML/ZIP tu tao tren backend de xuat file Excel `.xlsx`, khong can cai them package.

## Chay local

```powershell
cd D:\job\Project\gold-silver-tracker
npm start
```

Mo trinh duyet tai:

```text
http://127.0.0.1:4587
```

Neu PowerShell chan `npm.ps1`, dung:

```powershell
npm.cmd start
```

## Kiem tra mot lan

```powershell
npm run once
```

Lenh nay goi toan bo nguon du lieu, in thong ke dong lay duoc va thoat.

## Cau hinh

Co the doi port va chu ky lay du lieu bang bien moi truong:

```powershell
$env:PORT=4590
$env:POLL_INTERVAL_MS=30000
npm start
```

Bat them nguon `https://api.metals.live/v1/spot`:

```powershell
$env:ENABLE_METALS_LIVE=1
npm start
```

## Xuat file Excel

Tai file Excel tai:

```text
http://127.0.0.1:4587/api/export.xlsx
```

Workbook gom cac sheet:

- `Vang trong nuoc`
- `Bac`
- `The gioi`
- `Lich su`
- `Nguon du lieu`

## Nguon du lieu

- Vang trong nuoc: `https://giavang.org/trong-nuoc/...`
- Vang the gioi: `https://giavang.org/the-gioi/`, `https://www.kitco.com/price/precious-metals`
- Bac: `https://giabac.net/`

Backend giu viec lay du lieu o server de tranh loi CORS tren trinh duyet.

## Ho tro AI voi Codex

Du an co su ho tro cua AI thong qua OpenAI Codex/CodeX trong qua trinh:

- Phan tich yeu cau va thiet ke cau truc ung dung.
- Viet backend realtime, parser du lieu va exporter Excel.
- Xay dung giao dien dashboard, bang du lieu, phan trang va bieu do.
- Kiem tra local, sua loi va cap nhat tai lieu.

AI chi dong vai tro cong cu ho tro lap trinh; viec dinh huong san pham, yeu cau tinh nang va xac nhan ket qua do tac gia quan ly.

## Tac gia

KeiTran666
