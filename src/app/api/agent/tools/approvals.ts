import crypto from 'crypto';

/**
 * Server-side registry of "human-in-the-loop" approvals.
 *
 * Why this exists: /api/agent/route.ts pauses before running dangerous tools
 * (currently only run_terminal_command) and returns status "requires_approval"
 * to the UI. The Studio UI shows a confirm dialog, and only when the user
 * clicks Approve does it call /api/agent/tools/execute/route.ts to actually
 * run the tool.
 *
 * That execute route used to trust whatever {name, args} it was POSTed with,
 * no questions asked — which meant ANY same-origin request (including a
 * <script> injected into a create_live_preview canvas via a prompt-injected
 * scrape_website result, or any other tab open in the same browser) could run
 * a shell command directly, without the user ever seeing or clicking the
 * approval dialog. This module closes that gap: the execute route now must
 * present a token that was actually issued for that exact chat/tool/args pair.
 */

interface PendingApproval {
  chatId: string;
  name: string;
  args: any;
  expiresAt: number;
}

const APPROVAL_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough for a human to click Approve
const pending = new Map<string, PendingApproval>();

function cleanupExpired() {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(token);
  }
}

/** Issue a single-use token for one specific pending tool call. */
export function createApprovalToken(chatId: string, name: string, args: any): string {
  cleanupExpired();
  const token = crypto.randomUUID();
  pending.set(token, { chatId, name, args, expiresAt: Date.now() + APPROVAL_TTL_MS });
  return token;
}

/**
 * Validate and consume (single-use) an approval token. Returns true only if
 * the token exists, hasn't expired, and was issued for this exact
 * chatId + tool name + args — so a valid token can't be replayed against a
 * different (e.g. more dangerous) command.
 */
export function consumeApprovalToken(token: string, chatId: string, name: string, args: any): boolean {
  cleanupExpired();
  const entry = pending.get(token);
  if (!entry) return false;
  pending.delete(token); // single-use regardless of outcome

  if (entry.chatId !== chatId) return false;
  if (entry.name !== name) return false;
  try {
    if (JSON.stringify(entry.args) !== JSON.stringify(args)) return false;
  } catch {
    return false;
  }

  return true;
}
