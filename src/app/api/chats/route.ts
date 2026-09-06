import { NextResponse } from "next/server";
import { readChats, updateChats } from "../agent/tools/chatStore";
import { getSettings } from "../agent/tools/settings";

/**
 * Pulls the text of the first real user message out of a chat's message
 * array (which may start with the huge system prompt once the agent has
 * replied at least once — see agent/route.ts). Strips attached-file blocks,
 * vision tags, and collapses whitespace so it's clean input for a title.
 */
function firstUserText(messages: any[]): string {
  const firstUser = (messages || []).find(
    (m: any) => m?.role === "user" && typeof m.content === "string" && m.content.trim()
  );
  if (!firstUser) return "";
  return firstUser.content
    .replace(/\n\n\[Attached File:[\s\S]*$/i, "")
    .replace(/(\n\n|\n)?\[VISION_DATA:[\s\S]*?\]/g, "")
    .replace(/(\n\n|\n)?\[VISION_CONTEXT:[\s\S]*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain truncation of the user's own words — always available, never fails, never empty as long as there's real text. */
function heuristicTitle(text: string): string {
  if (!text) return "";
  return text.length > 42 ? text.slice(0, 42).trim() + "…" : text;
}

/**
 * Best-effort short title via the configured sub-agent model. ALWAYS falls
 * back to heuristicTitle() (a plain truncation of the user's own message) if
 * the call fails, times out, or Ollama returns something empty/garbled — so
 * a chat title is never left stuck on "New Chat" just because the title
 * model was slow, busy, or unreachable.
 *
 * Previously this hardcoded "http://127.0.0.1:11434" and "qwen3.5:4b" and
 * sliced `messages.slice(0, 2)` without filtering out the system prompt —
 * meaning the "conversation" it summarized was actually [huge system
 * prompt, first user message], which is why titles were silently failing
 * and every chat sat at "New Chat" forever. Fixed to read the real
 * workspace/model settings and to only ever look at the user's own text.
 */
async function generateTitle(messages: any[]): Promise<string> {
  const text = firstUserText(messages);
  if (!text) return "";
  const fallback = heuristicTitle(text);

  try {
    const { ollamaUrl, subAgentModel } = await getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: subAgentModel,
        prompt: `Buat judul percakapan super singkat (maksimal 5 kata, tanpa tanda kutip, tanpa penjelasan) untuk pesan pengguna berikut:\n"${text.slice(0, 500)}"\nJudul:`,
        stream: false,
        keep_alive: 0,
        options: { num_predict: 24 },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) return fallback;
    const data = await response.json();
    const generated = String(data.response || "")
      .trim()
      .split("\n")[0]
      .replace(/["'.]/g, "")
      .trim();

    return generated || fallback;
  } catch {
    return fallback;
  }
}

export async function GET() {
  try {
    const chats = await readChats();

    chats.sort((a: any, b: any) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
    return NextResponse.json(chats);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { id, title, messages, isPinned } = await req.json();

    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    await updateChats(async (chats) => {
      const existingIndex = chats.findIndex((c: any) => c.id === id);

      if (existingIndex >= 0) {
        if (messages !== undefined) chats[existingIndex].messages = messages;
        if (title !== undefined) chats[existingIndex].title = title; // explicit rename always wins
        if (isPinned !== undefined) chats[existingIndex].isPinned = isPinned;

        chats[existingIndex].updatedAt = Date.now();

        // Auto-title exactly once: only while the title is still the
        // "New Chat" sentinel (or missing). The moment it's set to
        // anything else — generated or user-renamed — this never runs
        // again for this chat, so the title stays put across every later
        // message instead of flickering/changing as the conversation grows.
        const needsTitle = !chats[existingIndex].title || chats[existingIndex].title === "New Chat";
        if (needsTitle && chats[existingIndex].messages?.length) {
          const generated = await generateTitle(chats[existingIndex].messages);
          if (generated) chats[existingIndex].title = generated;
        }
      } else {
        if (!messages) throw Object.assign(new Error("Messages required for new chat"), { status: 400 });

        // Title it right away from the first user message so the sidebar
        // never shows a bare/empty "New Chat" placeholder once there's
        // actually something to name it after.
        const initialTitle = title || (await generateTitle(messages)) || "New Chat";

        chats.push({
          id,
          title: initialTitle,
          messages,
          isPinned: isPinned || false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      return chats;
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    await updateChats((chats) => chats.filter((c: any) => c.id !== id));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
