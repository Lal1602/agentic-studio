# Briefing: Code Canvas — Syntax Highlighting Upgrade
> code-canvas-highlight.md · Agentic Studio Feature Briefing

---

## 📌 Vision

Canvas kode saat ini hanya menampilkan teks mentah monokrom di dalam `<pre>`. Kita akan mengubahnya menjadi **editor read-only ala VS Code** yang punya:
- Syntax highlighting per bahasa (TypeScript, Python, CSS, HTML, JSON, Bash, dll)
- Nomor baris (line numbers)
- Tema dark yang konsisten dengan UI
- Scroll horizontal untuk baris panjang
- Tombol Copy code (single-click copy to clipboard)

---

## 🏗 Arsitektur

### Pendekatan: iframe dengan highlight.js CDN

Alih-alih memasang library berat (Monaco Editor, CodeMirror) yang menambah bundle size 1MB+, kita inject **highlight.js** via CDN ke dalam iframe, persis seperti yang sudah kita lakukan untuk Mermaid.

**Keuntungan:**
- Zero bundle size tambahan
- Semua 190+ bahasa tersedia via CDN
- Tema tom-one-dark cocok persis dengan warna UI kita
- Nomor baris via plugin highlightjs-line-numbers.js

---

## 🎨 Tampilan Target

`
┌─────────────────────────────────────────────────────┐
│  📄 MyComponent.tsx                    [Copy Code]   │
├─────────────────────────────────────────────────────┤
│  1  │ import React from 'react'                     │  ← biru
│  2  │                                               │
│  3  │ interface Props {                             │  ← kuning
│  4  │   name: string                                │  ← putih
│  5  │   age: number                                 │
│  6  │ }                                             │
│  7  │                                               │
│  8  │ export default function Greeting({ name }: Props) {  │
│  9  │   return <div className="hi">Hello {name}!</div>     │  ← hijau
│ 10  │ }                                             │
└─────────────────────────────────────────────────────┘
`

---

## 🔧 Implementation

### 1. Computed variable codeDoc (page.tsx)

Ganti logika ctiveCanvas.type === 'code' dari <pre> biasa menjadi iframe dengan srcDoc:

`	ypescript
const codeDoc = activeCanvas?.type === 'code' ? <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/atom-one-dark.min.css">
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/highlight.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js@2.9.0/dist/highlightjs-line-numbers.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: #1a1b26; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; }
    
    #toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px; background: #16171f; border-bottom: 1px solid #2a2b36;
      font-size: 12px; color: #888;
    }
    #toolbar .filename { color: #a9b1d6; font-weight: 600; }
    #copy-btn {
      background: #2a2b36; border: 1px solid #3a3b46; color: #a9b1d6;
      padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;
      transition: background 0.15s;
    }
    #copy-btn:hover { background: #3a3b46; }
    #copy-btn.copied { color: #9ece6a; border-color: #9ece6a; }

    #code-wrapper { overflow: auto; height: calc(100vh - 37px); }
    pre { margin: 0; padding: 16px 0; }
    code { display: block; padding: 0 16px !important; }

    /* Line numbers plugin styles */
    .hljs-ln { border-collapse: collapse; width: 100%; }
    .hljs-ln td { padding: 0; }
    .hljs-ln-numbers {
      width: 40px; min-width: 40px; padding: 0 12px 0 8px !important;
      text-align: right; color: #3b4261; border-right: 1px solid #2a2b36;
      user-select: none; vertical-align: top;
    }
    .hljs-ln-code { padding-left: 16px !important; white-space: pre; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #1a1b26; }
    ::-webkit-scrollbar-thumb { background: #3b4261; border-radius: 4px; }
  </style>
</head>
<body>
  <div id="toolbar">
    <span class="filename"></span>
    <button id="copy-btn" onclick="copyCode()">Copy</button>
  </div>
  <div id="code-wrapper">
    <pre><code class="language-"></code></pre>
  </div>
  <script>
    hljs.highlightAll();
    hljs.initLineNumbersOnLoad();
    function copyCode() {
      navigator.clipboard.writeText().then(() => {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      });
    }
  </script>
</body>
</html> : '';
`

### 2. Ubah render branch (page.tsx)

Sebelum (teks mentah):
`	sx
activeCanvas.type === 'code' || (activeCanvas.type === 'preview' && activeCanvas.showCode) ? (
  <pre className={styles.codeCanvas}><code>{activeCanvas.content}</code></pre>
)
`

Sesudah (highlighted iframe):
`	sx
activeCanvas.type === 'code' ? (
  <iframe
    key={code--}
    srcDoc={codeDoc}
    className={styles.previewIframe}
    sandbox="allow-scripts"
    title="Code Editor"
  />
) : (activeCanvas.type === 'preview' && activeCanvas.showCode) ? (
  <pre className={styles.codeCanvas}><code>{activeCanvas.content}</code></pre>
)
`

---

## 🎨 Language Detection

highlight.js auto-detect bahasa dari class="language-xxx". Registry open_code_editor sudah punya field language — tinggal pass ke iframe.

Mapping bahasa yang didukung:
| User request | language value |
|---|---|
| TypeScript | typescript |
| JavaScript | javascript |
| Python | python |
| CSS | css |
| HTML | html |
| JSON | json |
| Bash / Terminal | bash |
| SQL | sql |
| Rust | rust |
| Go | go |

---

## ✅ Keuntungan vs Monaco Editor

| Fitur | Monaco | highlight.js (kita) |
|---|---|---|
| Bundle size | ~2MB | 0 (CDN) |
| Editable | ✅ | ❌ (read-only, sesuai use case) |
| Syntax highlight | ✅ | ✅ |
| Line numbers | ✅ | ✅ (plugin) |
| Copy button | custom | ✅ built-in |
| Setup | complex | minimal |

---

## 📋 Implementation Checklist

- [ ] Tambah computed var codeDoc sebelum return JSX di page.tsx
- [ ] Update render branch: ganti <pre> dengan iframe srcDoc={codeDoc}
- [ ] Tambah key prop ke iframe code
- [ ] Pastikan ctiveCanvas.language di-pass dari tool call (sudah ada di registry)
- [ ] Test dengan: TypeScript, Python, CSS, JSON, Bash
- [ ] Cek tombol Copy berfungsi
- [ ] Cek line numbers tampil rapi
