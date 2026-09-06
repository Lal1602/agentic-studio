import { NextResponse } from "next/server";
import { executeTool } from "../executor";
import { consumeApprovalToken } from "../approvals";
import { isDangerousTool } from "../dangerousTools";
import { isSameOrigin } from "../security";

/**
 * This endpoint exists for exactly one purpose: run the single tool call the
 * user just clicked "Approve" on in the human-in-the-loop dialog (see
 * handleApproveTool in src/app/studio/page.tsx and the requires_approval
 * branch in ../../route.ts).
 *
 * It used to accept ANY {name, args} with no proof an approval ever happened —
 * meaning any same-origin caller (a script injected into a create_live_preview
 * canvas via prompt injection, another tab, etc.) could run
 * run_terminal_command directly, completely bypassing the approval dialog
 * this app advertises as its safety net. Fixed with two independent checks:
 * an origin check, and a single-use token minted only when the agent loop
 * itself decided a tool needs approval.
 *
 * isDangerousTool() (dangerousTools.ts) is the same predicate agent/route.ts
 * uses to decide WHEN to pause and ask — importing it here instead of
 * keeping a separate list means the two can never drift out of sync again.
 */

export async function POST(req: Request) {
  try {
    // Reject cross-origin / sandboxed-iframe callers (see security.ts).
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (!isSameOrigin(origin, host)) {
      return NextResponse.json({ error: "Forbidden: cross-origin request rejected" }, { status: 403 });
    }

    const { chatId, token, name, args } = await req.json();

    if (!name || !args) {
      return NextResponse.json({ error: "Missing tool name or args" }, { status: 400 });
    }

    if (!isDangerousTool(name)) {
      return NextResponse.json({ error: `Tool "${name}" cannot be run through this endpoint.` }, { status: 403 });
    }

    if (!chatId || !token) {
      return NextResponse.json({ error: "Missing approval token" }, { status: 401 });
    }

    if (!consumeApprovalToken(token, chatId, name, args)) {
      return NextResponse.json({ error: "Invalid, expired, or already-used approval token" }, { status: 401 });
    }

    const result = await executeTool(name, args);
    return NextResponse.json({ result });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
