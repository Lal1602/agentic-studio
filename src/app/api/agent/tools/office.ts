import fs from 'fs/promises';
import path from 'path';
import { getSettings } from './settings';

/**
 * Pastikan direktori `workspace/output/` ada di dalam workspace yang
 * dikonfigurasi (bisa diganti dari Settings, tidak lagi selalu direktori
 * tempat server Next.js dijalankan).
 */
async function ensureOutputDir() {
  const { workspaceRoot } = await getSettings();
  const outputDir = path.join(workspaceRoot, 'workspace', 'output');
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (err) {
    // Abaikan error jika folder sudah ada
  }
  return outputDir;
}

/**
 * Generate PPTX dari array JSON slides
 */
export async function generatePresentation(filename: string, slides: Array<{title: string, body?: string, bullets?: string[], notes?: string}>): Promise<string> {
  try {
    const PptxGenJS = require('pptxgenjs');
    const pptx = new PptxGenJS();
    
    for (const slideData of slides) {
      const slide = pptx.addSlide();
      
      // Standar layout dasar
      slide.addText(slideData.title, { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32, bold: true, color: '363636' });
      
      if (slideData.body) {
        slide.addText(slideData.body, { x: 0.5, y: 1.8, w: 9, h: 1, fontSize: 18, color: '666666' });
      }
      
      if (slideData.bullets && slideData.bullets.length > 0) {
        // convert bullets to text with bullet styling
        const bulletItems = slideData.bullets.map(b => ({ text: b, options: { bullet: true } }));
        slide.addText(bulletItems, { x: 0.5, y: slideData.body ? 2.5 : 1.8, w: 9, h: 3, fontSize: 20, color: '363636' });
      }
      
      if (slideData.notes) {
        slide.addNotes(slideData.notes);
      }
    }
    
    const outputDir = await ensureOutputDir();
    const finalPath = path.join(outputDir, filename.endsWith('.pptx') ? filename : `${filename}.pptx`);
    
    // Simpan file secara async
    const buffer = await pptx.write('nodebuffer');
    await fs.writeFile(finalPath, buffer as Buffer);
    
    const actualFilename = filename.endsWith('.pptx') ? filename : `${filename}.pptx`;
    return `Success: PowerPoint presentation saved to ${finalPath}\n\nIMPORTANT: You MUST reply to the user with this exact download link so they can download it: [Download ${actualFilename}](/api/download?file=${encodeURIComponent(actualFilename)})`;
  } catch (error: any) {
    return `Error generating presentation: ${error.message}`;
  }
}

/**
 * Generate Excel dari data array JSON
 */
export async function generateExcelFile(filename: string, data: any[]): Promise<string> {
  try {
    const xlsx = require('xlsx');
    const outputDir = await ensureOutputDir();
    const finalPath = path.join(outputDir, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
    
    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    
    // Use buffer and fs.writeFile to prevent environment issues in Next.js
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    await fs.writeFile(finalPath, buffer);
    
    const actualFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    return `Success: Excel file saved to ${finalPath}\n\nIMPORTANT: You MUST reply to the user with this exact download link so they can download it: [Download ${actualFilename}](/api/download?file=${encodeURIComponent(actualFilename)})`;
  } catch (error: any) {
    return `Error generating Excel file: ${error.message}`;
  }
}

/**
 * Generate Word Docx dari markdown/teks
 * (menggunakan docx library secara sederhana)
 */
export async function generateWordDoc(filename: string, content: string): Promise<string> {
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
    
    // Pisahkan teks berdasarkan newline untuk membuat paragraf sederhana
    const lines = content.split('\n');
    const paragraphs = lines.map(line => {
      if (line.startsWith('# ')) {
        return new Paragraph({ text: line.replace('# ', ''), heading: HeadingLevel.HEADING_1 });
      } else if (line.startsWith('## ')) {
        return new Paragraph({ text: line.replace('## ', ''), heading: HeadingLevel.HEADING_2 });
      } else if (line.startsWith('### ')) {
        return new Paragraph({ text: line.replace('### ', ''), heading: HeadingLevel.HEADING_3 });
      } else if (line.trim() === '') {
        return new Paragraph({ text: '' });
      } else {
        return new Paragraph({
          children: [new TextRun(line)]
        });
      }
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs,
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    
    const outputDir = await ensureOutputDir();
    const finalPath = path.join(outputDir, filename.endsWith('.docx') ? filename : `${filename}.docx`);
    
    await fs.writeFile(finalPath, buffer);
    
    const actualFilename = filename.endsWith('.docx') ? filename : `${filename}.docx`;
    return `Success: Word document saved to ${finalPath}\n\nIMPORTANT: You MUST reply to the user with this exact download link so they can download it: [Download ${actualFilename}](/api/download?file=${encodeURIComponent(actualFilename)})`;
  } catch (error: any) {
    return `Error generating Word doc: ${error.message}`;
  }
}
