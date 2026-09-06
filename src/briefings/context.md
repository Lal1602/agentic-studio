# Panduan Komprehensif: Arsitektur UI AI Chatbot, Inline Parser, dan Dedicated Canvas

Dokumen ini menjelaskan secara mendalam bagaimana antarmuka (UI) AI Chatbot modern menangani berbagai tipe data (teks, kode pemrograman, tabel, matematika, diagram) di dalam bubble chat utama, serta klasifikasi lengkap jenis-jenis **Canvas / Artifacts (Side Workspace)** yang digunakan pada platform AI mutakhir.

---

## 1. Konsep Dasar: Inline Rendering vs. Dedicated Canvas

Dalam rekayasa antarmuka AI modern, terdapat pemisahan tanggung jawab (*separation of concerns*) antara komponen di dalam alur percakapan (chat flow) dan panel kerja mandiri (canvas/workspace):

```
+-----------------------------------------------------------------------------------+
| AI Chatbot Application Window                                                     |
|                                                                                   |
|  +-------------------------------------+  +------------------------------------+  |
|  | Main Chat Thread (Inline Parser)    |  | Dedicated Canvas / Artifacts Panel |  |
|  |                                     |  |                                    |  |
|  | [User]: "Buatkan dashboard React"   |  | [ Mode: Live Web Preview / Editor ]|  |
|  |                                     |  |                                    |  |
|  | [AI]: Penjelasan singkat & ringkasan|  |  +------------------------------+  |  |
|  |  - AST Markdown parsing             |  |  | <h1>Dashboard Analytics</h1> |  |  |
|  |  - Inline syntax highlight          |  |  | [ Interactive Chart Component] |  |  |
|  |  - Mini summary table               |  |  | Button | Filters | Real-time |  |  |
|  |                                     |  |  +------------------------------+  |  |
|  | [Open Artifact / Canvas Button] ----+->| [Monaco Editor] / [Sandpack Iframe]|  |
|  +-------------------------------------+  +------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Di Dalam Bubble Chat: Arsitektur Markdown Parser

AI model (seperti Gemini, GPT, atau Claude) hanya mengirimkan **plain text stream berformat Markdown**. Kotak chat **tidak memerlukan canvas terpisah** untuk setiap elemen. Sebaliknya, aplikasi frontend memanfaatkan **Abstract Syntax Tree (AST) Parser** untuk mengubah teks tersebut secara dinamis menjadi komponen UI interaktif:

### Komponen Inline yang Dihasilkan Parser:

1. **Tipografi & Teks Terstruktur (`<p>`, `<h1>`–`<h6>`, `<ul>`, `<ol>`, `<blockquote>`)**
   - Mengubah sintaks Markdown standar menjadi elemen HTML semantik.
   - Dilengkapi styling responsif, line-height proporsional, dan spacing dinamis.

2. **Code Blocks (`react-syntax-highlighter`, `shiki`, `PrismJS`)**
   - Mendeteksi *fenced code blocks* (````lang ... ````).
   - Menambahkan fitur penomoran baris (*line numbers*), tombol *Copy to Clipboard*, deteksi bahasa otomatis, dan tema warna (*syntax highlighting*).

3. **Data Tables (`remark-gfm`, `<table>`)**
   - Memetakan sintaks tabel Markdown (`| Kolom 1 | Kolom 2 |`) ke tag `<table>`, `<thead>`, `<tbody>`, dan `<tr>`.
   - Dilengkapi container dengan `overflow-x: auto` agar tabel lebar tetap nyaman dibaca pada perangkat mobile.

4. **Notasi Matematika & Rumus Ilmiah (`KaTeX`, `MathJax`)**
   - Memproses notasi TeX/LaTeX (misal `$E=mc^2$` atau `$$\int_0^\infty f(x)dx$$`) menjadi elemen SVG atau HTML berformat matematika presisi tinggi.

5. **Inline Media, Embeds, & Action Cards**
   - Merender tag kustom atau tautan gambar menjadi preview kartu, tombol aksi cepat (*quick action chips*), atau form interaktif.

---

## 3. Klasifikasi Lengkap Jenis-Jenis "Canvas" (Side Workspace)

Ketika konten terlalu panjang, kompleks, interaktif, atau membutuhkan kolaborasi langsung, platform AI memindahkan konten tersebut ke **Dedicated Canvas** di panel samping. Berikut adalah daftar lengkap jenis-jenis canvas yang digunakan di industri:

| No | Jenis Canvas | Deskripsi & Fungsi Utama | Library & Teknologi Populer |
|:---|:---|:---|:---|
| 1 | **Code Editor Canvas** | Panel editor kode penuh dengan dukungan multi-file, autocompletion, linting, code diffing, dan syntax tree inspection. | Monaco Editor (core VS Code), CodeMirror 6 |
| 2 | **Live Interactive UI Canvas** | Sandbox terisolasi untuk menjalankan dan merender kode web (React, Vue, HTML/CSS/JS, Tailwind) secara real-time langsung di browser. | Sandpack (CodeSandbox), WebContainers (StackBlitz), Iframe Sandbox |
| 3 | **Rich Text Document Canvas** | Pengolah dokumen panjang bergaya Notion / Google Docs untuk menulis artikel, esai, dan laporan dengan formatting block terstruktur. | Tiptap, ProseMirror, Lexical, Slate.js |
| 4 | **Data & Spreadsheet Canvas** | Lembar kerja tabular untuk manipulasi dataset besar, sorting, filtering, pivot table, dan eksekusi formula ala Microsoft Excel / Google Sheets. | AG Grid, TanStack Table, Handsontable, FortuneSheet |
| 5 | **Diagram & Flowchart Canvas** | Kanvas visual interaktif berbasis node & edge untuk merender arsitektur cloud, UML, mindmap, dan alur proses bisnis. | React Flow, Mermaid.js, Excalidraw, PlantUML |
| 6 | **Visual / Graphic Canvas** | Kanvas grafis murni 2D/3D untuk menggambar vektor, anotasi citra, manipulasi pixel, dan visualisasi spasial 3D. | HTML5 `<canvas>`, Fabric.js, Konva.js, Three.js, PixiJS |
| 7 | **Executable Notebook Canvas** | Lingkungan komputasi berbasis cell (REPL) untuk mengeksekusi script Python/R, analisis statistik data, dan visualisasi grafik (Matplotlib/Plotly). | Pyodide (Wasm Python), Jupyter Kernel Web Client |

---

## 4. Matriks Keputusan: Kapan Menggunakan Inline vs Canvas?

| Parameter Kebutuhan | Gunakan Inline Chat (Bubble) | Buka Dedicated Canvas (Panel Samping) |
|:---|:---|:---|
| **Panjang Kode** | Snippet pendek (< 50 baris) | Kode lengkap, modul penuh (> 100 baris) |
| **Interaktivitas Pengguna** | Teks bacaan & referensi statis | UI yang perlu diklik, digeser, atau di-preview |
| **Penyuntingan (Editing)** | Percakapan tanya-jawab linier | Pengguna ingin mengedit langsung teks/dokumen/kode |
| **Format & Tata Letak** | Respons berformat paragraf umum | Dokumen terstruktur (proposal, laporan, esai) |
| **Eksplorasi Data** | Ringkasan data (tabel mini 3-5 baris) | Dataset mentah yang butuh filter, sort, dan kalkulasi |

---

## 5. Rekomendasi Tech Stack untuk Membangun UI Chatbot Modern

Bagi pengembang yang ingin mengimplementasikan arsitektur ini menggunakan **React / Next.js**:

### A. Untuk Inline Chat Parser
- `react-markdown`: Core Markdown-to-JSX renderer.
- `remark-gfm`: Plugin dukungan tabel GitHub Flavored Markdown, checklist, dan strikethrough.
- `rehype-highlight` / `@shikijs/rehype`: Highlighting kode tingkat produksi.
- `remark-math` + `rehype-katex`: Parser persamaan matematika.

### B. Untuk Side Canvas
- **Editor:** `@monaco-editor/react` (untuk kode) atau `@tiptap/react` (untuk dokumen).
- **Live Preview:** `@codesandbox/sandpack-react` (untuk React/JS runner terisolasi).
- **Diagram:** `reactflow` atau `@mermaid-js/mermaid`.
- **Spreadsheet:** `@tanstack/react-table` atau `ag-grid-react`.

---
*Dokumen dirangkum untuk referensi arsitektur frontend AI Chatbot.*
