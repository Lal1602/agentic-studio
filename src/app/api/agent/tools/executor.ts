import fs from 'fs/promises';
import { existsSync } from 'fs';
import type { Dirent, Stats } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { scrapeWebsite } from './scraper';
import { searchWeb } from './search';
import { introspectDatabase } from './database';
import { savePreference } from './memory';
import { generatePresentation, generateExcelFile, generateWordDoc } from './office';
import { getSettings } from './settings';
import { callMcpTool, isMcpToolName } from './mcpClient';

const execPromise = util.promisify(exec);

// Directories we never want to walk into for list_directory / grep_codebase —
// huge, irrelevant, or binary-ish trees that would blow past output limits
// and burn the model's context for no benefit.
const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'out', 'coverage', '.cache',
]);

// Extensions we skip when grepping — binary/compiled/lockfile-ish content
// that's either unreadable as text or too noisy to search.
const GREP_SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.woff', '.woff2',
  '.ttf', '.eot', '.mp4', '.mp3', '.wasm', '.db', '.sqlite', '.sqlite3', '.lock',
]);

// run_terminal_command safety limits — see the case below.
const TERMINAL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes: generous for a build/test/git command, short enough a hung command doesn't wedge the request forever
const TERMINAL_MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB of combined stdout/stderr before Node kills the process for us

/**
 * Resolves a user-supplied relative path against the configured workspace
 * root and refuses anything that escapes it. Shared by every filesystem tool
 * so the traversal guard only has to be gotten right in one place.
 *
 * A plain `resolved.startsWith(root)` check is fooled by a sibling directory
 * that merely shares the same prefix (root ".../agentic" would also match
 * ".../agentic-secrets/..."). Comparing the relative path avoids that as
 * well as "../" traversal.
 *
 * Exported (only) so it can be unit-tested directly — see executor.test.ts.
 */
export function safeResolve(root: string, relativePath: string): { ok: true; absolute: string } | { ok: false; error: string } {
  const absolute = path.join(root, relativePath || '.');
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, error: 'Error: Path is outside of the workspace directory.' };
  }
  return { ok: true, absolute };
}

async function listDirectoryRecursive(root: string, dir: string, depth: number, maxDepth: number, out: string[], limit: number) {
  if (out.length >= limit) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.isDirectory() && IGNORED_DIR_NAMES.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      out.push(`${rel}/`);
      if (depth < maxDepth) {
        await listDirectoryRecursive(root, abs, depth + 1, maxDepth, out, limit);
      }
    } else {
      out.push(rel);
    }
  }
}

async function grepWalk(root: string, dir: string, matcher: (line: string) => boolean, results: string[], maxResults: number) {
  if (results.length >= maxResults) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= maxResults) return;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      await grepWalk(root, abs, matcher, results, maxResults);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (GREP_SKIP_EXTENSIONS.has(ext)) continue;
    let stat: Stats;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue;
    }
    if (stat.size > 1_000_000) continue; // skip anything over ~1MB, likely not source
    let text: string;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch {
      continue; // likely binary / not utf8
    }
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) return;
      if (matcher(lines[i])) {
        const snippet = lines[i].trim().slice(0, 200);
        results.push(`${rel}:${i + 1}: ${snippet}`);
      }
    }
  }
}

export async function executeTool(name: string, args: any): Promise<string> {
  try {
    // MCP tools are dynamically discovered from configured servers (see
    // settings.mcpServers) and namespaced "mcp__<server>__<toolName>". They
    // never execute inline here — always routed through mcpClient, and
    // always approval-gated by the caller (agent/route.ts) before we get here.
    if (isMcpToolName(name)) {
      return await callMcpTool(name, args);
    }

    const settings = await getSettings();
    const WORKSPACE_ROOT = settings.workspaceRoot;

    switch (name) {
      case 'read_local_file': {
        const resolved = safeResolve(WORKSPACE_ROOT, args.filepath);
        if (resolved.ok === false) return resolved.error;
        const filepath = resolved.absolute;

        let content = '';
        const ext = path.extname(filepath).toLowerCase();

        if (ext === '.docx') {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: filepath });
          content = result.value;
        } else if (ext === '.pdf') {
          const pdfParse = require('pdf-parse');
          const dataBuffer = await fs.readFile(filepath);
          const result = await pdfParse(dataBuffer);
          content = result.text;
        } else if (ext === '.xlsx' || ext === '.xls') {
          const xlsx = require('xlsx');
          const workbook = xlsx.readFile(filepath);
          const sheetNames = workbook.SheetNames;
          for (const sheet of sheetNames) {
            content += `\n--- Sheet: ${sheet} ---\n`;
            content += xlsx.utils.sheet_to_csv(workbook.Sheets[sheet]);
          }
        } else {
          content = await fs.readFile(filepath, 'utf8');
        }

        if (content.length > 5000) {
          return content.substring(0, 5000) + "\n...[CONTENT TRUNCATED FOR LENGTH]...";
        }
        return content || "File is empty or could not be parsed.";
      }

      case 'list_directory': {
        const resolved = safeResolve(WORKSPACE_ROOT, args.dirpath || '.');
        if (resolved.ok === false) return resolved.error;
        try {
          const stat = await fs.stat(resolved.absolute);
          if (!stat.isDirectory()) return `Error: "${args.dirpath}" is not a directory.`;
        } catch {
          return `Error: Directory "${args.dirpath || '.'}" does not exist.`;
        }

        const maxDepth = args.recursive ? 6 : 0;
        const limit = 300;
        const out: string[] = [];
        await listDirectoryRecursive(WORKSPACE_ROOT, resolved.absolute, 0, maxDepth, out, limit);

        if (out.length === 0) return "Directory is empty.";
        const truncated = out.length >= limit ? `\n...[LIST TRUNCATED AT ${limit} ENTRIES — narrow the path or ask for a subfolder]...` : '';
        return out.join('\n') + truncated;
      }

      case 'grep_codebase': {
        if (!args.pattern || !String(args.pattern).trim()) {
          return 'Error: "pattern" is required.';
        }
        let matcher: (line: string) => boolean;
        try {
          const re = new RegExp(String(args.pattern), 'i');
          matcher = (line: string) => re.test(line);
        } catch {
          const needle = String(args.pattern).toLowerCase();
          matcher = (line: string) => line.toLowerCase().includes(needle);
        }

        const startDir = args.dirpath ? safeResolve(WORKSPACE_ROOT, args.dirpath) : { ok: true as const, absolute: WORKSPACE_ROOT };
        if (startDir.ok === false) return startDir.error;

        const maxResults = Math.min(Math.max(Number(args.max_results) || 50, 1), 200);
        const results: string[] = [];
        await grepWalk(WORKSPACE_ROOT, startDir.absolute, matcher, results, maxResults);

        if (results.length === 0) return `No matches found for "${args.pattern}".`;
        const body = results.join('\n');
        if (body.length > 8000) {
          return body.substring(0, 8000) + "\n...[RESULTS TRUNCATED FOR LENGTH — narrow the pattern or path]...";
        }
        return `Found ${results.length} match(es) for "${args.pattern}":\n\n${body}`;
      }

      case 'write_local_file': {
        const resolved = safeResolve(WORKSPACE_ROOT, args.filepath);
        if (resolved.ok === false) return resolved.error;
        if (typeof args.content !== 'string') return 'Error: "content" must be a string (can be empty).';

        const existedBefore = existsSync(resolved.absolute);
        await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
        await fs.writeFile(resolved.absolute, args.content, 'utf8');

        return `Success: ${existedBefore ? 'Overwrote' : 'Created'} "${args.filepath}" (${Buffer.byteLength(args.content, 'utf8')} bytes).`;
      }

      case 'edit_local_file': {
        const resolved = safeResolve(WORKSPACE_ROOT, args.filepath);
        if (resolved.ok === false) return resolved.error;
        if (!args.old_string || typeof args.old_string !== 'string') {
          return 'Error: "old_string" is required and must be the exact text to replace.';
        }
        if (typeof args.new_string !== 'string') {
          return 'Error: "new_string" is required (use an empty string to delete the matched text).';
        }
        if (args.old_string === args.new_string) {
          return 'Error: "old_string" and "new_string" are identical — nothing to change.';
        }

        let current: string;
        try {
          current = await fs.readFile(resolved.absolute, 'utf8');
        } catch (e: any) {
          if (e.code === 'ENOENT') return `Error: File "${args.filepath}" does not exist. Use write_local_file to create a new file.`;
          throw e;
        }

        const occurrences = current.split(args.old_string).length - 1;
        if (occurrences === 0) {
          return 'Error: "old_string" was not found in the file. It must match the file content EXACTLY, including whitespace and indentation. Re-read the file first if unsure.';
        }
        if (occurrences > 1 && !args.replace_all) {
          return `Error: "old_string" matches ${occurrences} places in the file, so the edit is ambiguous. Widen "old_string" with more surrounding context to make it unique, or pass replace_all: true to replace every occurrence.`;
        }

        const updated = args.replace_all
          ? current.split(args.old_string).join(args.new_string)
          : current.replace(args.old_string, args.new_string);

        await fs.writeFile(resolved.absolute, updated, 'utf8');
        return `Success: Edited "${args.filepath}" (${occurrences} occurrence${occurrences > 1 ? 's' : ''} replaced).`;
      }

      case 'run_terminal_command': {
        // No timeout/maxBuffer here used to mean a hanging command (e.g. a
        // dev server started by mistake, or anything waiting on stdin) or
        // one that prints megabytes of output could wedge this request —
        // and the approval flow that gates this tool — indefinitely.
        try {
          const { stdout, stderr } = await execPromise(args.command, {
            cwd: WORKSPACE_ROOT,
            timeout: TERMINAL_TIMEOUT_MS,
            maxBuffer: TERMINAL_MAX_BUFFER_BYTES,
          });
          const output = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
          if (output.length > 5000) {
            return output.substring(0, 5000) + "\n...[OUTPUT TRUNCATED]...";
          }
          return output;
        } catch (error: any) {
          // Node kills the child and sets `killed`+`signal` on the error for
          // both a timeout and a maxBuffer overflow — give a clear message
          // instead of whatever raw "command failed" text comes through.
          if (error.killed && error.signal) {
            const stdoutSoFar = typeof error.stdout === 'string' ? error.stdout.slice(0, 2000) : '';
            const stderrSoFar = typeof error.stderr === 'string' ? error.stderr.slice(0, 2000) : '';
            return `Error: Command was killed (signal ${error.signal}) — it likely exceeded the ${TERMINAL_TIMEOUT_MS / 1000}s timeout or the ${Math.round(TERMINAL_MAX_BUFFER_BYTES / 1024 / 1024)}MB output limit.\n\nSTDOUT so far:\n${stdoutSoFar}\n\nSTDERR so far:\n${stderrSoFar}`;
          }
          throw error; // let the outer catch below format it the same way as every other tool
        }
      }

      case 'scrape_website': {
        return await scrapeWebsite(args.url);
      }

      case 'search_web': {
        return await searchWeb(args.query, args.max_results);
      }

      case 'introspect_database': {
        return await introspectDatabase(args.dbType, args.connectionString);
      }

      case 'save_preference': {
        await savePreference(args.rule);
        return `Success: Remembered rule "${args.rule}"`;
      }

      case 'generate_presentation': {
        return await generatePresentation(args.filename, args.slides);
      }

      case 'generate_excel_file': {
        return await generateExcelFile(args.filename, args.data);
      }

      case 'generate_word_doc': {
        return await generateWordDoc(args.filename, args.content);
      }

      case 'open_code_editor': {
        return `Success: Opened Code Editor Canvas in the UI for ${args.filename}. Wait for the user to review it.`;
      }

      case 'create_live_preview': {
        return `Success: Opened Live Preview Canvas in the UI. Wait for the user to review the interactive preview.`;
      }

      case 'write_rich_document': {
        return `Success: Opened Rich Document Canvas in the UI with title "${args.title}". The user can now read and download the document.`;
      }

      case 'draw_diagram': {
        return `Success: Opened Diagram Canvas in the UI with title "${args.title}". The diagram is now rendered visually for the user.`;
      }

      case 'render_spreadsheet': {
        return `Success: Opened Spreadsheet Canvas in the UI with title "${args.title}". The user can now view, sort, and download the data.`;
      }

      case 'create_graphic_canvas': {
        return `Success: Opened Chart Canvas in the UI with title "${args.title}". The chart is now rendered visually for the user.`;
      }

      default:
        return `Error: Tool ${name} is not implemented.`;
    }
  } catch (error: any) {
    return `Error executing tool: ${error.message}`;
  }
}
