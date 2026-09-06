import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';

/**
 * Where the Next.js process itself was started — the app's own install
 * directory. This is NOT necessarily where the AI's tools (read/write file,
 * terminal, etc.) operate; that's the configurable `workspaceRoot` below.
 * APP_ROOT never changes at runtime, so it's a safe, stable place to keep
 * the settings file even after the user points the agent at a different
 * project folder.
 */
const APP_ROOT = process.cwd();
const SETTINGS_FILE = path.join(APP_ROOT, '.agentic-settings.json');

export interface McpServerConfig {
  /** Unique short name, used to namespace its tools (e.g. "fs" -> mcp_fs_read_file). Letters/digits/underscore only. */
  name: string;
  /** Command to spawn (e.g. "npx"). */
  command: string;
  /** Arguments to the command (e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/path"]). */
  args: string[];
  /** Optional extra environment variables for the spawned process. */
  env?: Record<string, string>;
  /** Set false to keep a configured server without connecting to it. */
  enabled?: boolean;
}

export interface AgenticSettings {
  /** Absolute path the AI's file/terminal/database tools operate inside. */
  workspaceRoot: string;
  /** Main chat/tool-calling model (previously hardcoded "ornith:9b"). */
  chatModel: string;
  /** Smaller helper model used for both vision description and context-compaction summaries (previously hardcoded "qwen3.5:4b" in both spots). */
  subAgentModel: string;
  ollamaUrl: string;
  mcpServers: McpServerConfig[];
}

const DEFAULT_SETTINGS: AgenticSettings = {
  workspaceRoot: APP_ROOT,
  chatModel: 'ornith:9b',
  subAgentModel: 'qwen3.5:4b',
  ollamaUrl: 'http://127.0.0.1:11434',
  mcpServers: [],
};

let cache: AgenticSettings | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

async function loadFromDisk(): Promise<AgenticSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers : DEFAULT_SETTINGS.mcpServers,
    };
  } catch (e: any) {
    if (e.code === 'ENOENT') return { ...DEFAULT_SETTINGS };
    console.error('[Settings] Failed to read .agentic-settings.json, using defaults:', e);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function getSettings(): Promise<AgenticSettings> {
  if (cache) return cache;
  return enqueue(async () => {
    if (cache) return cache;
    cache = await loadFromDisk();
    return cache;
  });
}

/**
 * Best-effort synchronous accessor for the rare spot that can't await.
 * Returns defaults if settings haven't been loaded into cache yet — callers
 * that need accuracy should use getSettings() instead.
 */
export function getSettingsSync(): AgenticSettings {
  return cache ?? DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<AgenticSettings>): Promise<AgenticSettings> {
  return enqueue(async () => {
    const current = cache ?? (await loadFromDisk());
    const next: AgenticSettings = { ...current, ...patch };
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
    cache = next;
    return next;
  });
}

/** Validate that a path exists and is a directory before accepting it as the new workspace root. */
export function isValidDirectory(p: string): boolean {
  try {
    return fssync.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
