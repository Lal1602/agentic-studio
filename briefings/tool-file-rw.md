# Briefing: Tool A & B — Read & Create File Documents
> tool-file-rw.md · Agentic Studio Feature Briefing

---

## 📌 Vision

Qwen dapat membaca dokumen nyata dari disk pengguna (Excel, Word, PPT, PDF) dan menghasilkan dokumen baru dari nol yang bisa didownload langsung dari canvas — seperti seorang asisten kantor.

---

## 🧩 Dua Tool Baru

### Tool A — read_file_document
Membaca file dari path lokal dan mengembalikan konten teks/data terstruktur.

### Tool B — create_file_document
Membuat file Office baru dari data Qwen + preview & tombol download di canvas.

---

## 🏗 Arsitektur

`
User prompt
    │
    ▼
route.ts (orchestrator)
    │  detects: wantsReadFile / wantsCreateFile
    │
    ├─ Tool A: read_file_document
    │     └─ calls /api/file/read
    │           ├─ .xlsx/.xls  → xlsx (SheetJS)
    │           ├─ .docx       → mammoth
    │           ├─ .pptx       → adm-zip (parse XML)
    │           └─ .pdf        → pdf-parse
    │
    └─ Tool B: create_file_document
          └─ calls /api/file/create
                ├─ .xlsx  → xlsx (SheetJS) → base64
                ├─ .docx  → docx (npm) → base64
                ├─ .pptx  → pptxgenjs → base64
                └─ .pdf   → pdfkit → base64
          └─ page.tsx: file-download canvas + Download button
`

---

## 📦 Libraries

| Format | Read | Write | Package |
|--------|------|-------|---------|
| Excel (.xlsx) | ✅ | ✅ | xlsx (SheetJS) |
| Word (.docx)  | ✅ | ✅ | mammoth (read) + docx (write) |
| PPT (.pptx)   | ⚠️ | ✅ | adm-zip (read xml) + pptxgenjs (write) |
| PDF           | ✅ | ✅ | pdf-parse (read) + pdfkit (write) |

npm install: xlsx mammoth docx pptxgenjs pdf-parse pdfkit adm-zip

---

## 🔧 Tool A — read_file_document

### Registry
`	ypescript
{
  name: "read_file_document",
  description: "Reads a local file (.xlsx, .docx, .pdf, .pptx) and returns its content as text/structured data. Use when user asks: 'baca file', 'buka dokumen', 'ringkas pdf', 'analisa excel', 'baca word', 'buka ppt'.",
  parameters: {
    filepath: "Absolute path to file, e.g. 'C:/Users/user/Downloads/data.xlsx'",
    instruction: "What to do: 'summarize', 'extract table', 'list headings', 'translate'"
  }
}
`

### API: src/app/api/file/read/route.ts
`	ypescript
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export async function POST(req: NextRequest) {
  const { filepath } = await req.json();
  const ext = path.extname(filepath).toLowerCase();
  const buffer = fs.readFileSync(filepath);

  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheets: Record<string, any[]> = {};
    wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n]); });
    return NextResponse.json({ type: 'excel', data: sheets });
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return NextResponse.json({ type: 'docx', content: result.value });
  }
  if (ext === '.pdf') {
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    return NextResponse.json({ type: 'pdf', content: data.text, pages: data.numpages });
  }
  if (ext === '.pptx') {
    const AdmZip = await import('adm-zip');
    const zip = new AdmZip.default(buffer);
    const slides: string[] = [];
    zip.getEntries().forEach(e => {
      if (e.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
        const xml = e.getData().toString('utf8');
        const texts = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g)?.map(t => t.replace(/<[^>]+>/g,'')) ?? [];
        slides.push(texts.join(' '));
      }
    });
    return NextResponse.json({ type: 'pptx', slides });
  }
  return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
}
`

---

## 🔧 Tool B — create_file_document

### Registry
`	ypescript
{
  name: "create_file_document",
  description: "Creates a downloadable Office file (.xlsx, .docx, .pdf, .pptx). Use when user says: 'buat file excel', 'export ke pdf', 'buat laporan word', 'buat presentasi ppt', 'simpan sebagai docx'.",
  parameters: {
    filename: "Output filename, e.g. 'laporan.xlsx' or 'proposal.docx'",
    format: "xlsx | docx | pdf | pptx",
    content: "xlsx: JSON array of row objects. docx/pdf: plain text. pptx: JSON array of {title, body, bullets:[]}",
    title: "Document title"
  }
}
`

### API: src/app/api/file/create/route.ts
`	ypescript
export async function POST(req: NextRequest) {
  const { format, content, filename, title } = await req.json();

  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const rows = JSON.parse(content);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title || 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return NextResponse.json({ base64: Buffer.from(buf).toString('base64'), mimeType: '...xlsx', filename });
  }

  if (format === 'docx') {
    const { Document, Paragraph, TextRun, Packer } = await import('docx');
    const paragraphs = content.split('\n').map(line => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buf = await Packer.toBuffer(doc);
    return NextResponse.json({ base64: buf.toString('base64'), mimeType: '...docx', filename });
  }

  if (format === 'pdf') {
    const PDFDocument = (await import('pdfkit')).default;
    const chunks: Buffer[] = [];
    const doc = new PDFDocument();
    doc.on('data', chunk => chunks.push(chunk));
    await new Promise(resolve => { doc.on('end', resolve); doc.text(content); doc.end(); });
    return NextResponse.json({ base64: Buffer.concat(chunks).toString('base64'), mimeType: 'application/pdf', filename });
  }

  if (format === 'pptx') {
    const pptxgen = (await import('pptxgenjs')).default;
    const prs = new pptxgen();
    JSON.parse(content).forEach(s => {
      const slide = prs.addSlide();
      slide.addText(s.title, { x:0.5, y:0.5, w:9, h:1, fontSize:28, bold:true });
      if (s.body) slide.addText(s.body, { x:0.5, y:1.8, w:9, h:4, fontSize:16 });
    });
    const buf = await prs.write({ outputType: 'nodebuffer' });
    return NextResponse.json({ base64: buf.toString('base64'), mimeType: '...pptx', filename });
  }
}
`

### Canvas Type: file-download (page.tsx)
`	sx
{activeCanvas.type === 'file-download' && (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:'1rem' }}>
    <div style={{ fontSize:'4rem' }}>{activeCanvas.format === 'pdf' ? '📄' : activeCanvas.format === 'xlsx' ? '📊' : activeCanvas.format === 'pptx' ? '📽️' : '📝'}</div>
    <h2 style={{ color:'#e2e8f0' }}>{activeCanvas.filename}</h2>
    <p style={{ color:'#888' }}>File berhasil dibuat dan siap didownload.</p>
    <button onClick={() => {
      const a = document.createElement('a');
      a.href = data:;base64,;
      a.download = activeCanvas.filename;
      a.click();
    }}>⬇ Download {activeCanvas.format?.toUpperCase()}</button>
  </div>
)}
`

---

## 🔒 Security

- Whitelist extensions: ['.xlsx','.xls','.docx','.pdf','.pptx'] only
- Max file size: 10MB
- Block path traversal: reject paths containing '..' or absolute paths outside home dir
- API routes: validate input before fs.readFileSync

---

## 🎯 Intent Detection (route.ts)

`	ypescript
const wantsReadFile = ['baca file','buka file','buka dokumen','analisa file','ringkas pdf',
  'buka excel','baca excel','baca word','buka pdf','analisa pdf','baca ppt','open file'].some(kw => lastUserText.includes(kw));

const wantsCreateFile = ['buat file excel','buat excel','export excel','buat pdf',
  'buat laporan pdf','buat word','buat dokumen','buat ppt','buat presentasi',
  'simpan sebagai','generate pdf','export ke pdf','download sebagai'].some(kw => lastUserText.includes(kw));
`

---

## 📋 Implementation Checklist

- [ ] npm install xlsx mammoth docx pptxgenjs pdf-parse pdfkit adm-zip
- [ ] src/app/api/file/read/route.ts
- [ ] src/app/api/file/create/route.ts
- [ ] Add read_file_document + create_file_document to registry.ts
- [ ] Add executeTool() cases in route.ts
- [ ] Add wantsReadFile + wantsCreateFile intent detection + activeTools filtering
- [ ] Add 'file-download' canvas type in page.tsx
- [ ] Update system prompt with new tool guidance
- [ ] Add fileDownloadCanvas CSS styles
- [ ] Test: Excel 5 rows, Word 3 paragraphs, PDF text, PPT 3 slides
