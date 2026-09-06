/**
 * Small, pure security predicates shared across route handlers — pulled out
 * so they can be unit-tested directly instead of only being exercised
 * end-to-end through a running Next.js server.
 */

/**
 * True if a request's Origin header (when present) matches its Host header.
 *
 * Used by /api/agent/tools/execute to reject cross-origin / sandboxed-iframe
 * callers: a same-origin fetch from the Studio UI sends an Origin header
 * matching this host; a sandboxed <iframe> (used for create_live_preview, no
 * allow-same-origin) sends Origin: null; an external site sends its own
 * origin. A request with NO Origin header at all is allowed through — some
 * legitimate same-origin requests omit it — the whole point of this check is
 * to catch a mismatched Origin, not to require one.
 */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  return !!originHost && originHost === host;
}
