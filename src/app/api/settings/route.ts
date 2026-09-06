import { NextResponse } from "next/server";
import { getSettings, updateSettings, isValidDirectory } from "../agent/tools/settings";
import type { McpServerConfig } from "../agent/tools/settings";

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json(settings);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function sanitizeMcpServers(input: any): { ok: true; servers: McpServerConfig[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: '"mcpServers" must be an array.' };

  const seenNames = new Set<string>();
  const servers: McpServerConfig[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: "Each MCP server entry must be an object." };
    const name = String(raw.name || '').trim();
    const command = String(raw.command || '').trim();
    if (!name) return { ok: false, error: "Every MCP server needs a name." };
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return { ok: false, error: `MCP server name "${name}" must only contain letters, digits, "_" or "-".` };
    if (seenNames.has(name)) return { ok: false, error: `Duplicate MCP server name "${name}".` };
    seenNames.add(name);
    if (!command) return { ok: false, error: `MCP server "${name}" needs a command (e.g. "npx").` };

    const args = Array.isArray(raw.args) ? raw.args.map((a: any) => String(a)) : [];
    const env = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [String(k), String(v)]))
      : undefined;

    servers.push({
      name,
      command,
      args,
      env,
      enabled: raw.enabled !== false,
    });
  }

  return { ok: true, servers };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = {};

    if (body.workspaceRoot !== undefined) {
      const dir = String(body.workspaceRoot).trim();
      if (!dir) return NextResponse.json({ error: '"workspaceRoot" cannot be empty.' }, { status: 400 });
      if (!isValidDirectory(dir)) {
        return NextResponse.json({ error: `"${dir}" does not exist or is not a directory on this machine.` }, { status: 400 });
      }
      patch.workspaceRoot = dir;
    }

    if (body.chatModel !== undefined) {
      const v = String(body.chatModel).trim();
      if (!v) return NextResponse.json({ error: '"chatModel" cannot be empty.' }, { status: 400 });
      patch.chatModel = v;
    }

    if (body.subAgentModel !== undefined) {
      const v = String(body.subAgentModel).trim();
      if (!v) return NextResponse.json({ error: '"subAgentModel" cannot be empty.' }, { status: 400 });
      patch.subAgentModel = v;
    }

    if (body.ollamaUrl !== undefined) {
      const v = String(body.ollamaUrl).trim().replace(/\/+$/, '');
      if (!/^https?:\/\/.+/.test(v)) {
        return NextResponse.json({ error: '"ollamaUrl" must start with http:// or https://' }, { status: 400 });
      }
      patch.ollamaUrl = v;
    }

    if (body.mcpServers !== undefined) {
      const result = sanitizeMcpServers(body.mcpServers);
      if (result.ok === false) return NextResponse.json({ error: result.error }, { status: 400 });
      patch.mcpServers = result.servers;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No recognized settings fields in request body." }, { status: 400 });
    }

    const updated = await updateSettings(patch);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
