import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getSettings } from '../agent/tools/settings';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('file');

    if (!filename) {
      return new NextResponse('Missing file parameter', { status: 400 });
    }

    // Hanya izinkan mengunduh dari workspace/output/ demi keamanan
    const { workspaceRoot } = await getSettings();
    const outputDir = path.join(workspaceRoot, 'workspace', 'output');
    const filePath = path.join(outputDir, filename);

    // Keamanan ekstra agar tidak bisa mundur direktori (directory traversal
    // attack). Membandingkan path relatif lebih aman daripada startsWith,
    // yang bisa lolos untuk folder sibling yang kebetulan berawalan sama.
    const relative = path.relative(outputDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return new NextResponse('Invalid file path', { status: 403 });
    }

    // Periksa apakah file ada
    try {
      await fs.access(filePath);
    } catch {
      return new NextResponse('File not found', { status: 404 });
    }

    // Baca file
    const fileBuffer = await fs.readFile(filePath);

    // Tentukan Content-Type dasar berdasarkan ekstensi
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === '.pptx') contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    else if (ext === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (ext === '.pdf') contentType = 'application/pdf';
    else if (ext === '.csv') contentType = 'text/csv';

    // Kembalikan response dengan header attachment
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Download error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
