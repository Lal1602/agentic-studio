import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { getSettings } from './settings';
import type { McpServerConfig } from './settings';

/**
 * Minimal MCP (Model Context Protocol) client, stdio transport only.
 *
 * Scope, deliberately: this connects to LOCAL MCP servers launched as a
 * child process (the overwhelmingly common case for a local-first tool like
 * this one — e.g. `npx -y @modelcontextprotocol/server-filesystem <path>`).
 * It speaks the base JSON-RPC 2.0 message shape MCP uses over stdio
 * (newline-delimited JSON on stdout/stdin) and only the handful of methods
 * needed to discover and call tools: initialize, notifications/initialized,
 * tools/list, tools/call. It does not implement resources, prompts,
 * sampling, roots, or the HTTP/SSE transport — those can be added later if
 * a server you want to use needs them.
 *
 * Every discovered MCP tool is exposed to the agent loop under the name
 * "mcp__<server>__<tool>" and is ALWAYS treated as a dangerous tool
 * requiring human approval (see dangerousTools.ts) — we have no way to know
 * in advance whether a given third-party MCP tool is safe, so we don't
 * guess.
 */

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

interface PendingCall {
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

interface McpConnection {
  config: McpServerConfig;
  proc: ChildProcessWithoutNullStreams;
  nextId: number;
  pending: Map<number, PendingCall>;
  buffer: string;
  tools: McpTool[];
  ready: Promise<void>;
  failed: string | null;
}

const PREFIX = 'mcp__';
const REQUEST_TIMEOUT_MS = 20_000;

// Keyed by server config name. Connections are lazily created on first use
// and kept alive for the life of the Node process (same pattern as
// chatStore/approvals — this app only ever runs as a single process).
const connections = new Map<string, McpConnection>();

export function isMcpToolName(name: string): boolean {
  return typeof name === 'string' && name.startsWith(PREFIX);
}

/** MCP tool/server names can contain characters some models mangle in function names — normalize to [a-zA-Z0-9_]. */
function sanitizeName(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9_]/g, '_');
}

function parseToolName(fullName: string): { server: string; tool: string } | null {
  if (!fullName.startsWith(PREFIX)) return null;
  const rest = fullName.slice(PREFIX.length);
  const sep = rest.indexOf('__');
  if (sep === -1) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

function sendRequest(conn: McpConnection, method: string, params: any): Promise<any> {
  const id = conn.nextId++;
  const line = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (conn.pending.has(id)) {
        conn.pending.delete(id);
        reject(new Error(`MCP server "${conn.config.name}" timed out responding to "${method}"`));
      }
    }, REQUEST_TIMEOUT_MS);

    conn.pending.set(id, {
      resolve: (value: any) => { clearTimeout(timeout); resolve(value); },
      reject: (error: any) => { clearTimeout(timeout); reject(error); },
    });

    conn.proc.stdin.write(line, (err) => {
      if (err) {
        clearTimeout(timeout);
        conn.pending.delete(id);
        reject(err);
      }
    });
  });
}

function sendNotification(conn: McpConnection, method: string, params: any): void {
  const line = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
  conn.proc.stdin.write(line);
}

function connect(config: McpServerConfig): McpConnection {
  const existing = connections.get(config.name);
  if (existing && !existing.failed) return existing;

  const proc = spawn(config.command, config.args || [], {
    env: { ...process.env, ...(config.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const conn: McpConnection = {
    config,
    proc,
    nextId: 1,
    pending: new Map(),
    buffer: '',
    tools: [],
    ready: Promise.resolve(),
    failed: null,
  };

  proc.on('error', (err) => {
    conn.failed = `Failed to start: ${err.message}`;
    for (const p of conn.pending.values()) p.reject(new Error(conn.failed!));
    conn.pending.clear();
  });

  proc.on('exit', (code) => {
    conn.failed = conn.failed || `Server process exited (code ${code ?? 'unknown'})`;
    for (const p of conn.pending.values()) p.reject(new Error(conn.failed!));
    conn.pending.clear();
    connections.delete(config.name);
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    // MCP servers commonly log diagnostics to stderr — surface it server-side
    // for debugging without letting it interfere with stdout JSON-RPC framing.
    console.error(`[MCP:${config.name}] ${chunk.toString('utf8').slice(0, 500)}`);
  });

  proc.stdout.on('data', (chunk: Buffer) => {
    conn.buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = conn.buffer.indexOf('\n')) !== -1) {
      const line = conn.buffer.slice(0, idx).trim();
      conn.buffer = conn.buffer.slice(idx + 1);
      if (!line) continue;

      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // not a JSON-RPC line (some servers print banners) — ignore
      }

      if (msg.id !== undefined && conn.pending.has(msg.id)) {
        const pending = conn.pending.get(msg.id)!;
        conn.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message || 'MCP server returned an error'));
        else pending.resolve(msg.result);
      }
      // Server -> client requests/notifications (e.g. logging, sampling) are
      // intentionally not handled — out of scope for this minimal client.
    }
  });

  conn.ready = (async () => {
    await sendRequest(conn, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agentic-studio', version: '0.1.0' },
    });
    sendNotification(conn, 'notifications/initialized', {});

    const toolsResult = await sendRequest(conn, 'tools/list', {});
    conn.tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
  })().catch((err) => {
    conn.failed = conn.failed || `Handshake failed: ${err.message}`;
    throw err;
  });

  connections.set(config.name, conn);
  return conn;
}

/**
 * Tool definitions (Ollama/OpenAI function-calling shape) for every tool
 * exposed by every enabled, reachable MCP server. Best-effort: a server that
 * fails to start or doesn't answer in time is skipped (logged, not thrown)
 * so one broken MCP config never takes down the whole chat.
 */
export async function getMcpTools(): Promise<Array<{ type: 'function'; function: { name: string; description: string; parameters: any } }>> {
  const settings = await getSettings();
  const enabled = (settings.mcpServers || []).filter((s) => s.enabled !== false);
  if (enabled.length === 0) return [];

  const perServer = await Promise.all(
    enabled.map(async (config) => {
      try {
        const conn = connect(config);
        await conn.ready;
        if (conn.failed) return [];
        return conn.tools.map((tool) => ({
          type: 'function' as const,
          function: {
            name: `${PREFIX}${sanitizeName(config.name)}__${sanitizeName(tool.name)}`,
            description: `[MCP: ${config.name}] ${tool.description || tool.name}`.slice(0, 1000),
            parameters: tool.inputSchema && typeof tool.inputSchema === 'object'
              ? tool.inputSchema
              : { type: 'object', properties: {} },
          },
        }));
      } catch (err: any) {
        console.error(`[MCP:${config.name}] Could not list tools: ${err.message}`);
        return [];
      }
    })
  );

  return perServer.flat();
}

export async function callMcpTool(fullName: string, args: any): Promise<string> {
  const parsed = parseToolName(fullName);
  if (!parsed) return `Error: "${fullName}" is not a valid MCP tool name.`;

  const settings = await getSettings();
  const config = (settings.mcpServers || []).find((s) => sanitizeName(s.name) === parsed.server);
  if (!config) return `Error: No MCP server named "${parsed.server}" is configured.`;
  if (config.enabled === false) return `Error: MCP server "${parsed.server}" is disabled in settings.`;

  try {
    const conn = connect(config);
    await conn.ready;
    if (conn.failed) return `Error: MCP server "${parsed.server}" is not connected (${conn.failed}).`;

    const originalTool = conn.tools.find((t) => sanitizeName(t.name) === parsed.tool);
    if (!originalTool) return `Error: MCP server "${parsed.server}" has no tool named "${parsed.tool}".`;

    const result = await sendRequest(conn, 'tools/call', { name: originalTool.name, arguments: args || {} });

    if (result?.isError) {
      const text = Array.isArray(result.content) ? result.content.map((c: any) => c.text || '').join('\n') : JSON.stringify(result);
      return `Error from MCP tool "${fullName}": ${text}`;
    }

    if (Array.isArray(result?.content)) {
      const text = result.content
        .map((c: any) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
        .join('\n');
      return text || 'Success: MCP tool completed with no output.';
    }

    return JSON.stringify(result ?? { ok: true });
  } catch (err: any) {
    return `Error calling MCP tool "${fullName}": ${err.message}`;
  }
}

/** Best-effort shutdown of every connected MCP server (not currently wired to a lifecycle hook — Next.js dev/start don't give us a clean one — but available for future use, e.g. from a settings "disconnect" action). */
export function disconnectAllMcpServers(): void {
  for (const conn of connections.values()) {
    try { conn.proc.kill(); } catch { /* ignore */ }
  }
  connections.clear();
}
