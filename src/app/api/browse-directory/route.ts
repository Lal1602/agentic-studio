import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Server-side folder browser for the Settings modal's "Workspace Root"
 * field. This app runs as a plain `next dev`/`next start` process in the
 * browser — a bare <input type="file" webkitdirectory> can let someone
 * PICK a folder, but Chromium deliberately never hands back its real
 * absolute filesystem path (only a synthetic "C:\fakepath\..." string), so
 * that alone can't produce something the backend's fs/terminal tools could
 * actually use. Since this API route runs on Bilal's own machine (same
 * place `next dev` runs) it has real fs access, so instead we expose a
 * minimal click-to-navigate directory listing here and let the Settings UI
 * render it as a folder picker.
 *
 * GET (no ?path) → the starting points: Windows drive letters, or on
 * macOS/Linux the home directory and filesystem root.
 * GET ?path=<absolute path> → that directory's immediate subdirectories
 * (files are never listed — this is a FOLDER picker), its own resolved
 * path, and its parent (null once you're at a top-level root, so the UI
 * knows to offer "back to drives" instead of trying to go further up).
 */

const MAX_ENTRIES = 500;

async function listRoots(): Promise<{ name: string; path: string }[]> {
  if (process.platform === "win32") {
    const roots: { name: string; path: string }[] = [];
    const checks = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    await Promise.all(
      checks.map(async (letter) => {
        const drive = `${letter}:\\`;
        try {
          await fs.access(drive);
          roots.push({ name: drive, path: drive });
        } catch {
          // drive letter not in use — skip
        }
      })
    );
    roots.sort((a, b) => a.name.localeCompare(b.name));
    return roots;
  }
  const home = os.homedir();
  return [
    { name: `${home} (Home)`, path: home },
    { name: "/ (Filesystem root)", path: "/" },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("path");

  if (!requested) {
    const entries = await listRoots();
    return NextResponse.json({ path: null, parent: null, entries, truncated: false });
  }

  const target = path.resolve(requested);

  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return NextResponse.json({ error: `"${target}" does not exist or isn't accessible.` }, { status: 400 });
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: `"${target}" is not a directory.` }, { status: 400 });
  }

  let names: string[];
  try {
    names = await fs.readdir(target);
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read "${target}": ${e.message || e}` }, { status: 403 });
  }

  const entries: { name: string; path: string }[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue; // hidden entries — same convention as a normal OS folder picker
    const full = path.join(target, name);
    try {
      const s = await fs.stat(full);
      if (s.isDirectory()) entries.push({ name, path: full });
    } catch {
      // permission-denied or broken symlink entry — skip rather than fail the whole listing
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const truncated = entries.length > MAX_ENTRIES;
  const parentPath = path.dirname(target);
  // dirname() of a filesystem/drive root returns itself — that's the signal
  // to stop offering "up" and fall back to the drive/root list instead.
  const parent = parentPath === target ? null : parentPath;

  return NextResponse.json({
    path: target,
    parent,
    entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
    truncated,
  });
}
