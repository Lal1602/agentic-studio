/**
 * Tools that must never run without an explicit human approval click.
 *
 * This is the single source of truth for that gate — both the agent
 * orchestration loop (agent/route.ts, decides WHEN to pause and ask) and the
 * execute endpoint (tools/execute/route.ts, decides WHAT it's willing to run
 * after approval) import this so the two can't drift out of sync the way the
 * old code did (see the security fixes from the earlier full-scan pass).
 *
 * Any MCP tool (name starting with "mcp__") is always dangerous too — we
 * have no way to know in advance what a third-party MCP tool actually does,
 * so every one of them requires approval regardless of name. That check
 * lives in isDangerousTool() below rather than this list, since the set of
 * MCP tool names is dynamic.
 */
export const NAMED_DANGEROUS_TOOLS = new Set([
  'run_terminal_command',
  'write_local_file',
  'edit_local_file',
]);

export function isDangerousTool(name: string): boolean {
  return NAMED_DANGEROUS_TOOLS.has(name) || name.startsWith('mcp__');
}
