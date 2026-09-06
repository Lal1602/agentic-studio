# Briefing: Canvas Tier 2 — Interactive Spreadsheet / Data Table
> spreadsheet-canvas.md · Agentic Studio Feature Briefing

---

## 📌 Vision

render_spreadsheet sudah berjalan (terbukti dari test CSV data produk). Briefing ini mendokumentasikan spesifikasi lengkap canvas spreadsheet sebagai referensi untuk improvement lebih lanjut: fitur tambahan yang masih bisa ditambahkan, bug yang perlu diwaspadai, dan format data yang Qwen harus gunakan.

---

## ✅ Status Saat Ini

Spreadsheet canvas sudah berfungsi dengan:
- AG Grid Community via CDN (sort, filter, resize kolom)
- Dark theme (ag-theme-alpine-dark)
- Download CSV via header button
- Auto-detect kolom dari JSON keys
- Pagination untuk data > 50 baris

---

## 🔧 Perbaikan Tier 2

### 1. Export ke Excel (.xlsx) — bukan hanya CSV

Saat ini tombol Download di canvas header mengunduh SVG/PNG (untuk diagram) atau tidak ada (untuk spreadsheet). Tambahkan tombol "Download Excel" di dalam spreadsheet iframe sendiri.

`javascript
// Di dalam spreadsheetDoc srcDoc
function downloadExcel() {
  // AG Grid has built-in Excel export via ag-grid-enterprise
  // For community: use SheetJS via CDN
  const XLSX = window.XLSX;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, 'data.xlsx');
}
`

Tambahkan SheetJS CDN ke spreadsheetDoc:
`html
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
`

### 2. Toolbar dalam iframe

Tambahkan mini toolbar di atas grid dengan:
- Judul spreadsheet
- Tombol Download CSV (built-in AG Grid: gridApi.exportDataAsCsv())
- Tombol Download Excel (SheetJS)
- Search/filter global
- Row count indicator

`html
<div id="toolbar">
  <span id="title">Data Produk</span>
  <span id="row-count">8 baris</span>
  <button onclick="gridApi.exportDataAsCsv({ fileName: 'data.csv' })">⬇ CSV</button>
  <button onclick="downloadExcel()">⬇ Excel</button>
</div>
`

### 3. Auto-format angka

Qwen sering mengirimkan angka sebagai string ("8500000"). Tambahkan formatter di AG Grid:

`javascript
const numFormatter = (params) => {
  const n = Number(params.value);
  if (!isNaN(n) && params.value !== '') {
    // Detect if it looks like currency (> 1000 and contains harga/price in header)
    if (params.colDef.field.toLowerCase().includes('harga') ||
        params.colDef.field.toLowerCase().includes('price')) {
      return new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(n);
    }
    return new Intl.NumberFormat('id-ID').format(n);
  }
  return params.value;
};
`

### 4. Sortable columns default ON

Saat ini sortable sudah aktif. Pastikan juga:
`javascript
defaultColDef: {
  sortable: true,
  resizable: true,
  filter: true,
  flex: 1,
  minWidth: 100,
  cellStyle: { color: '#e2e8f0' }  // pastikan teks putih
}
`

### 5. Error handling untuk data kosong/invalid

`javascript
if (!Array.isArray(rows) || rows.length === 0) {
  document.body.innerHTML = 
    <div style="color:#f59e0b;padding:2rem;font-family:monospace">
      <p>⚠ Tidak ada data untuk ditampilkan.</p>
      <p style="color:#666;font-size:12px">Qwen mengembalikan data kosong atau format JSON tidak valid.</p>
    </div>;
  return;
}
`

---

## 📐 Format Data yang Harus Qwen Kirim

### ✅ Benar
`json
[
  {"ID": "P001", "Nama Produk": "Laptop Gaming", "Kategori": "Elektronik", "Harga": "8500000", "Stok": "15"},
  {"ID": "P002", "Nama Produk": "Smartphone", "Kategori": "Elektronik", "Harga": "3200000", "Stok": "45"}
]
`

### ❌ Salah — nested objects
`json
{"products": [{"id": 1, "name": "..."}]}
`

### ❌ Salah — array of arrays
`json
[["ID", "Nama"], ["P001", "Laptop"]]
`

### ❌ Salah — mixed types
`json
[{"id": 1, "harga": 8500000}]  // angka langsung OK sebenarnya, tapi format cell jadi weird
`

---

## 🔧 Perbaikan render_spreadsheet validator

Tambahkan di middleware route.ts jika data bukan array:
`	ypescript
if (toolName === 'render_spreadsheet') {
  const data = toolArgs.data;
  if (!data?.trim()) {
    // self-correct: data kosong
    chatMessages.push({ role:'tool', name:toolName, content:'ERROR: data is empty...' });
    continue;
  }
  // Try parse: if not array → self-correct
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      chatMessages.push({ role:'tool', name:toolName, content:'ERROR: data must be a JSON array of objects, not an object or nested structure. Example: [{"Col":"Val"}]. Call render_spreadsheet again.' });
      continue;
    }
  } catch {
    chatMessages.push({ role:'tool', name:toolName, content:'ERROR: data is not valid JSON. Must be a JSON array. Call render_spreadsheet again.' });
    continue;
  }
}
`

---

## 🎯 Use Cases yang Disupport

| Request | Data yang dihasilkan |
|---------|---------------------|
| "buat data produk 10 baris" | Array produk dengan ID, nama, harga, stok |
| "perbandingan framework frontend" | Array dengan kolom Framework, Stars, License, Size, Learning |
| "analisa log server" | Array dengan Timestamp, Level, Message, Service |
| "daftar negara ASEAN" | Array dengan Negara, Ibukota, Populasi, GDP |
| "buat invoice sederhana" | Array dengan No, Item, Qty, Harga, Subtotal |
| "rangkum data dari file excel ini" | Array dari rows file yang dibaca Tool A |

---

## 🔗 Integrasi dengan Tool A (read_file_document)

Workflow ideal:
`
User: "baca file data-penjualan.xlsx dan tampilkan dalam spreadsheet"
  │
  ├─ Tool A: read_file_document("data-penjualan.xlsx")
  │     returns: JSON array of rows
  │
  └─ Tool B: render_spreadsheet(data=<hasil Tool A>)
        → canvas spreadsheet interaktif
`

Route.ts perlu mendukung chained tool calls untuk ini.

---

## 📋 Improvement Checklist

- [ ] Tambah SheetJS CDN ke spreadsheetDoc
- [ ] Implementasi toolbar dalam iframe (judul + row count + download buttons)
- [ ] Implementasi downloadExcel() via SheetJS
- [ ] Tambah number formatter untuk kolom harga/angka
- [ ] Tambah JSON array validator di middleware
- [ ] Update render_spreadsheet description dengan format data yang lebih jelas
- [ ] Tambah contoh format data di system prompt cheatsheet
- [ ] Test: data 50 baris (pagination), sort, filter, download CSV, download Excel
