import { NextResponse } from "next/server";

/**
 * Lists the models Ollama currently has pulled, so the Settings modal can
 * offer Chat Model / Sub-Agent Model as dropdowns instead of free-text
 * fields the user has to get exactly right by hand. Proxied through this
 * route (rather than fetched straight from the browser) because the
 * configured Ollama URL is whatever the user just typed into the form —
 * fetching it server-side avoids relying on that origin allowing
 * cross-origin browser requests.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const base = (searchParams.get("ollamaUrl") || "").trim().replace(/\/+$/, "");

  if (!/^https?:\/\/.+/.test(base)) {
    return NextResponse.json({ error: '"ollamaUrl" must start with http:// or https://' }, { status: 400 });
  }

  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return NextResponse.json({ error: `Ollama at ${base} responded with HTTP ${res.status}.` }, { status: 502 });
    }
    const data = await res.json();
    const models: string[] = Array.isArray(data?.models)
      ? data.models.map((m: any) => String(m?.name || m?.model || "").trim()).filter(Boolean)
      : [];
    return NextResponse.json({ models });
  } catch (e: any) {
    const reason = e?.name === "TimeoutError" || e?.name === "AbortError" ? "timed out" : e?.message || "connection failed";
    return NextResponse.json({ error: `Could not reach Ollama at ${base} (${reason}). Is it running?` }, { status: 502 });
  }
}
