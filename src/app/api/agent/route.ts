import { NextResponse } from "next/server";
import { toolRegistry } from "./tools/registry";
import { executeTool } from "./tools/executor";
import { getPreferences } from "./tools/memory";
import { updateChats } from "./tools/chatStore";
import { createApprovalToken } from "./tools/approvals";
import { getSettings } from "./tools/settings";
import { isDangerousTool } from "./tools/dangerousTools";
import { getMcpTools } from "./tools/mcpClient";

const encoder = new TextEncoder();

/** One line of the streamed NDJSON response body. See src/app/studio/page.tsx callAgent() for the matching client-side parser. */
type AgentStreamEvent =
  | { type: "delta"; content: string }
  | { type: "status"; message: string }
  | { type: "tool_call"; name: string; args: any }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "requires_approval"; toolCall: any; messages: any[] }
  | { type: "final"; status: "success"; response: any; messages: any[] }
  | { type: "error"; error: string; code?: string };

function emit(controller: ReadableStreamDefaultController<Uint8Array>, event: AgentStreamEvent) {
  try {
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
  } catch {
    // Client disconnected — nothing to do, the caller keeps running so
    // chat state still gets persisted via saveMessagesToChat.
  }
}

/**
 * Reads Ollama's newline-delimited streaming /api/chat response, forwarding
 * each text delta to onDelta as it arrives (real token-by-token streaming —
 * this is what lets the Studio UI show the reply appearing progressively
 * instead of freezing until the whole answer is done). tool_calls, when the
 * model produces any, arrive as a complete array (Ollama doesn't stream
 * partial tool-call args token by token), so we just keep the latest one we
 * see and return it once the stream ends.
 */
async function readOllamaStream(response: Response, onDelta: (text: string) => void): Promise<{ role: string; content: string; tool_calls?: any[] }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Ollama response had no readable body.");
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolCalls: any[] | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      let chunk: any;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue; // ignore any non-JSON noise on the stream
      }

      if (chunk.message?.content) {
        content += chunk.message.content;
        onDelta(chunk.message.content);
      }
      if (chunk.message?.tool_calls?.length) {
        toolCalls = chunk.message.tool_calls;
      }
    }
  }

  return { role: "assistant", content, tool_calls: toolCalls };
}

async function saveMessagesToChat(chatId: string | undefined, messages: any[]) {
  if (!chatId) return;
  try {
    await updateChats((chats) => {
      const index = chats.findIndex((c: any) => c.id === chatId);
      if (index >= 0) {
        chats[index].messages = messages;
        chats[index].updatedAt = Date.now();
      }
      return chats;
    });
  } catch (e) {
    console.error("Failed to save to DB in agent route", e);
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const chatId = body?.chatId;
  const messages = body?.messages;

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: "Messages array is required" }, { status: 400 });
  }

  // The rest of the response streams as newline-delimited JSON events (see
  // AgentStreamEvent above) instead of a single JSON blob, so the Studio UI
  // can render the reply token-by-token and offer a real Stop button (via
  // req.signal, wired into every Ollama fetch below) instead of freezing
  // until the whole multi-step tool-calling loop finishes.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
    try {
    const settings = await getSettings();
    const OLLAMA_URL = `${settings.ollamaUrl}/api/chat`;
    const OLLAMA_GENERATE_URL = `${settings.ollamaUrl}/api/generate`;
    const CHAT_MODEL = settings.chatModel;
    const SUBAGENT_MODEL = settings.subAgentModel;

    const prefs = await getPreferences();
    let memoryPrompt = "";
    if (prefs.length > 0) {
      memoryPrompt = "\n\nCRITICAL USER PREFERENCES (already known):\n" + prefs.map((p, i) => `${i+1}. ${p}`).join("\n");
    }

    const systemPrompt = {
      role: "system",
      content: `You are Ornith (Ornith 9B), an expert AI assistant running locally. You have local tools AND UI Canvas tools. Always respond in the same language the user writes in.

══════════════════════════════════════════════════════════════
VISION CAPABILITY
══════════════════════════════════════════════════════════════
You work with a Vision Sub-Agent (Qwen). When the user sends images, Qwen analyzes them and injects the results into the user's message as a [VISION_DATA: ...] block.
CRITICAL: When you see [VISION_DATA: ...] in the message, USE IT to answer. NEVER say "saya tidak bisa melihat gambar" or "I cannot see images". You have the vision data — use it!

══════════════════════════════════════════════════════════════
TOOL SELECTION — READ THIS BEFORE EVERY REPLY
══════════════════════════════════════════════════════════════

RULE: Call ALL tools that are needed. If the user asks for multiple files or outputs, call ALL tools in ONE response. NEVER say "I will create X" without immediately calling the tool.

═══ DECISION TABLE ═══════════════════════════════════════════
User request                              → Tool to use
─────────────────────────────────────────────────────────────
diagram / flowchart / ERD / mindmap /
 sequence / gantt / use case / venn /
 timeline / class / state / quadrant     → draw_diagram

bar chart / line chart / pie chart /
 grafik batang / grafik dengan ANGKA     → create_graphic_canvas

landing page / website / halaman web /
 UI / HTML / form / single page          → create_live_preview

artikel / laporan panjang / PRD /
 dokumentasi (TEKS PANJANG di UI saja)  → write_rich_document
 ⚠ BUKAN untuk file Word/Excel!

spreadsheet / tabel interaktif /
 data yang ingin ditampilkan di UI
 (TIDAK minta simpan/download file)      → render_spreadsheet

file .ts / .py / .js / kode program     → open_code_editor

baca file lokal                          → read_local_file
lihat isi folder / cari file di mana     → list_directory
cari kode/teks di seluruh proyek         → grep_codebase (lalu read_local_file untuk baca detail)

edit/ubah file yang SUDAH ADA di proyek  → edit_local_file (pakai untuk perubahan kecil/spesifik)
buat file BARU atau timpa total isi file → write_local_file
 (edit_local_file & write_local_file akan meminta izin user dulu sebelum jalan)

browsing / cari info / berita /
 fakta terkini tanpa URL                 → search_web (lalu scrape_website jika perlu baca penuh)

perintah terminal / npm / git            → run_terminal_command
 (akan meminta izin user dulu sebelum jalan)

─────────────────────────────────────────────────────────────
BUAT FILE SUNGGUHAN DI LAPTOP (generate_* tools)
─────────────────────────────────────────────────────────────
"buat file Word" / "simpan .docx" /
 "buat dokumen Word sungguhan"           → generate_word_doc
 (BUKAN write_rich_document!)

"buat file Excel" / "simpan .xlsx" /
 "buat file Excel sungguhan"             → generate_excel_file
 (BUKAN render_spreadsheet!)

"buat presentasi" / "slide" /
 "PowerPoint" / ".pptx"                 → generate_presentation

PENTING: generate_word_doc, generate_excel_file, generate_presentation
→ Menghasilkan FILE NYATA di laptop pengguna (workspace/output/).
→ Setelah selesai, WAJIB tampilkan link download di balasanmu.

MULTIPLE FILES: Jika user minta "Word DAN Excel", panggil tool satu per satu agar tidak error. Misalnya: panggil generate_word_doc dulu, lalu tunggu hasilnya, setelah itu baru panggil generate_excel_file di giliran berikutnya.

─────────────────────────────────────────────────────────────
CRITICAL RULES:
CRITICAL: "dokumen Word" / "file Word" → generate_word_doc (BUKAN write_rich_document)
CRITICAL: "file Excel" / "xlsx" → generate_excel_file (BUKAN render_spreadsheet)
CRITICAL: "landing page" → create_live_preview (BUKAN teks biasa)
CRITICAL: "diagram venn/use case/ERD" → draw_diagram
CRITICAL: "grafik batang/bar chart" → create_graphic_canvas
CRITICAL: render_spreadsheet hanya untuk tabel UI interaktif, BUKAN file sungguhan.

FORMAT DATA RENDER_SPREADSHEET (hanya jika pakai render_spreadsheet):
Wajib JSON Array flat. JANGAN object bercabang!
BENAR: [{"ID":"1", "Nama":"Laptop"}, {"ID":"2", "Nama":"HP"}]
SALAH: {"data": [{"ID":...}]} atau [["ID","Nama"], ["1","Laptop"]]

══════════════════════════════════════════════════════════════
MERMAID DIAGRAM CHEATSHEET (draw_diagram)
══════════════════════════════════════════════════════════════

OUTPUT: Raw Mermaid syntax ONLY. NO backticks. NO markdown fences.

── USE CASE DIAGRAM ──
ATURAN WAJIB use case diagram:
1. MULAI dengan "graph TD" (bukan usecaseDiagram)
2. Actor pakai (( )) contoh: User((Pengguna))
3. Use case pakai [ ] contoh: UC1[Login]
4. Edge WAJIB format: "User --> UC1" atau "User -- Menggunakan --> UC1"
5. DILARANG menulis: -->|text| atau style atau classDef
6. JANGAN beri nama setelah "graph TD" (jangan: "graph TD ID")
Contoh BENAR:
graph TD
  User((Pengguna))
  Admin((Admin))
  UC1[Login]
  UC2[Daftar]
  UC3[Reset Password]
  UC4[Kelola User]
  User --> UC1
  User --> UC2
  User --> UC3
  Admin --> UC4
  Admin --> UC1

── VENN DIAGRAM ──
(Gunakan graph LR dengan subgraph — satu subgraph per lingkaran)
ATURAN: Jangan hubungkan subgraph dengan panah. Beri judul yang jelas.
Contoh:
graph LR
  subgraph ReactOnly["React Saja"]
    A1[JSX Syntax]
    A2[Virtual DOM]
    A3[Redux]
  end
  subgraph Keduanya["Keduanya"]
    B1[Component Based]
    B2[Reactive State]
    B3[Single File]
  end
  subgraph VueOnly["Vue Saja"]
    C1[Template Syntax]
    C2[Composition API]
  end

── FLOWCHART ──
flowchart TD
  A[Mulai] --> B{Kondisi?}
  B -- Ya --> C[Proses]
  B -- Tidak --> D[Selesai]
  C --> D

\u2500\u2500 SEQUENCE DIAGRAM \u2500\u2500
sequenceDiagram
  participant User
  participant Server
  User->>Server: Request Login
  Server-->>User: Token JWT

\u2500\u2500 ERD \u2500\u2500
erDiagram
  USER {
    int id PK
    string name
    string email
  }
  ORDER {
    int id PK
    int user_id FK
    datetime created_at
  }
  USER ||--o{ ORDER : places

\u2500\u2500 CLASS DIAGRAM \u2500\u2500
classDiagram
  class Animal {
    +String name
    +makeSound() void
  }
  class Dog {
    +fetch() void
  }
  Animal <|-- Dog

\u2500\u2500 STATE DIAGRAM \u2500\u2500
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Idle : stop

\u2500\u2500 MINDMAP \u2500\u2500
mindmap
  root(Topik Utama)
    Cabang1
      SubCabang1
    Cabang2

\u2500\u2500 GANTT \u2500\u2500
gantt
  title Project Timeline
  dateFormat YYYY-MM-DD
  section Fase 1
    Task A :a1, 2024-01-01, 7d
    Task B :after a1, 5d

\u2500\u2500 TIMELINE \u2500\u2500
timeline
  title Sejarah Perusahaan
  2020 : Didirikan
  2022 : Ekspansi ke 10 kota
  2024 : IPO

\u2500\u2500 QUADRANT CHART \u2500\u2500
quadrantChart
  title Prioritas Fitur
  x-axis Low Impact --> High Impact
  y-axis Low Effort --> High Effort
  quadrant-1 Do First
  quadrant-2 Schedule
  quadrant-3 Delegate
  quadrant-4 Avoid
  Feature A: [0.8, 0.2]
  Feature B: [0.3, 0.7]

\u2500\u2500 PIE DIAGRAM \u2500\u2500
pie title Distribusi Teknologi
  "React" : 45
  "Vue" : 30
  "Angular" : 25

\u2500\u2500 C4 CONTEXT \u2500\u2500
C4Context
  title System Context
  Person(user, "User", "End user")
  System(sys, "MyApp", "Main application")
  Rel(user, sys, "Uses")

\u2500\u2500 GITGRAPH \u2500\u2500
gitgraph
  commit
  branch feature
  checkout feature
  commit
  checkout main
  merge feature

\u2500\u2500 USER JOURNEY \u2500\u2500
journey
  title User Checkout Journey
  section Browse
    Find product: 5: User
  section Buy
    Add to cart: 4: User
    Pay: 3: User

══════════════════════════════════════════════════════════════
COMMUNICATION STYLE — READ THIS, IT MATTERS
══════════════════════════════════════════════════════════════
Write like a sharp, direct collaborator — not a hype-y AI assistant. This is the single biggest thing users notice, so take it seriously:
- NEVER open with filler acknowledgments — "Siap!", "Tentu!", "Baik!", "Of course!", "Certainly!", "Sure thing!". Just answer or just call the tool.
- NEVER close with generic cheerleading — "Semangat!", "Semoga membantu!", "Good luck!", "Happy coding!". Stop talking when the answer is done.
- NO decorative emoji (🚀 💪 ✨ 🔥 🎉 etc.) unless the user used one first in that message. Default to zero.
- Don't restate the user's request back to them before answering it.
- Cut AI-typical filler words: "seamlessly", "empower", "unlock", "leverage", "dive into", "let's explore", "robust", "powerful".
- Prefer plain sentences over bullet lists or bold text for short answers. Save structure (headers, lists) for when it earns its keep — long explanations, multi-step results, real comparisons.
- Match the user's own tone and formality. Casual Indonesian in, casual Indonesian out — no forced enthusiasm in either direction.

══════════════════════════════════════════════════════════════
RULES
══════════════════════════════════════════════════════════════
1. ALWAYS call the correct tool — never just explain if a canvas is needed.
2. After calling a tool, write a SHORT 1-2 sentence summary.
3. NEVER wrap Mermaid code in backtick fences.
4. erDiagram attributes MUST start with a data type: 'int id PK', 'string name'.
5. erDiagram relationships: use '||--o{' '||--||' '}o--o{' — NEVER '--||--' or '--o--'.
6. If unsure about a term, ASK — never fabricate names or fields.
7. DO NOT run terminal commands unless user explicitly asks.
8. Before calling edit_local_file, make sure you know the file's exact current content (read_local_file first if unsure) — old_string must match character-for-character, including indentation, or the edit will be rejected.
9. write_local_file, edit_local_file, and run_terminal_command all pause for the user's explicit approval before running — call them normally, the UI handles asking permission.` + memoryPrompt
    };

    let chatMessages = [...messages];
    if (chatMessages.length === 0 || chatMessages[0].role !== "system") {
      chatMessages = [systemPrompt, ...chatMessages];
    }

    // ── Vision Sub-Agent Interception ──
    const latestUserMsg = chatMessages[chatMessages.length - 1];
    if (latestUserMsg?.role === "user" && latestUserMsg.images && latestUserMsg.images.length > 0 && !latestUserMsg._visionProcessed) {
      console.log(`[Agent] ${latestUserMsg.images.length} image(s) detected. Calling Qwen Vision Sub-Agent...`);
      const descriptions: string[] = [];

      // Unload Ornith temporarily to free VRAM for Qwen
      try {
        console.log("[Memory Manager] Unloading ornith:9b to make room for Qwen...");
        await fetch(OLLAMA_GENERATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: CHAT_MODEL, keep_alive: 0 })
        });
      } catch (e) {
        console.error("[Memory Manager] Failed to unload ornith:9b:", e);
      }

      for (let imgIdx = 0; imgIdx < latestUserMsg.images.length; imgIdx++) {
        try {
          const visionPayload = {
            model: SUBAGENT_MODEL,
            messages: [
              {
                role: "user",
                content: "Describe EVERYTHING you see in this image in detail. Include: any text, numbers, UI elements, buttons, labels, code, error messages, charts, diagrams, or visual content. Be thorough and specific.",
                images: [latestUserMsg.images[imgIdx]]
              }
            ],
            stream: false,
            keep_alive: 0
          };

          console.log(`[Vision Sub-Agent] Processing image ${imgIdx + 1}/${latestUserMsg.images.length}...`);
          const visionRes = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(visionPayload)
          });

          if (visionRes.ok) {
            const visionData = await visionRes.json();
            const desc = visionData.message?.content?.trim() || "No description provided.";
            descriptions.push(`Image ${imgIdx + 1}: ${desc}`);
            console.log(`[Vision Sub-Agent] Image ${imgIdx + 1} described: ${desc.substring(0, 100)}...`);
          } else {
            const errText = await visionRes.text();
            console.error(`[Vision Sub-Agent] Error on image ${imgIdx + 1}:`, errText);
            descriptions.push(`Image ${imgIdx + 1}: [Could not process: ${errText.substring(0, 100)}]`);
          }
        } catch (err) {
          console.error(`[Vision Sub-Agent] Failed on image ${imgIdx + 1}:`, err);
          descriptions.push(`Image ${imgIdx + 1}: [Processing failed]`);
        }
      }

      const combinedDescription = descriptions.join("\n\n");
      // Store vision data separately — do NOT modify the user's message content
      // We inject it into the Ollama payload only for this request, not saved to DB
      latestUserMsg._visionData = combinedDescription;
      latestUserMsg._visionProcessed = true;
      console.log("[Vision Sub-Agent] All images processed. Vision data stored separately.");
      
      // Unload Qwen to free VRAM back for Ornith
      try {
        console.log("[Memory Manager] Unloading qwen3.5:4b to make room for Ornith...");
        await fetch(OLLAMA_GENERATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: SUBAGENT_MODEL, keep_alive: 0 })
        });
      } catch (e) {
        console.error("[Memory Manager] Failed to unload qwen3.5:4b:", e);
      }
    }

    // Build Ollama-bound messages: inject vision context only for Ollama, keep original user content clean
    const buildOllamaMessages = (msgs: any[]) => msgs.map((m: any) => {
      if (m._visionData && m.role === "user") {
        return {
          ...m,
          content: `${m.content || ""}\n\n[VISION_CONTEXT: The user attached image(s). Here is what the vision model saw:\n${m._visionData}\nAnswer the user's question based on this. Do NOT repeat or quote this entire block verbatim — just use the information to answer concisely.]`
        };
      }
      return m;
    });

    let isDone = false;
    let finalResponse = null;

    // ── Context Compaction ──
    const activeMessages = chatMessages.filter(m => !m.compacted);
    const estimatedTokens = JSON.stringify(activeMessages).length / 4;

    if (estimatedTokens > 7000 && activeMessages.length > 8) {
      console.log(`[Agent] Context limit reached (${Math.round(estimatedTokens)} tokens). Delegating to Sub-Agent Qwen...`);
      let firstUncompacted = 1;
      for (let i = 1; i < chatMessages.length; i++) {
        if (chatMessages[i].role !== 'system' && !chatMessages[i].compacted) {
          firstUncompacted = i; break;
        }
      }
      const lastToCompact = chatMessages.length - 6;
      if (lastToCompact > firstUncompacted) {
        const msgsToSummarize = chatMessages.slice(firstUncompacted, lastToCompact);
        try {
          const sumRes = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: SUBAGENT_MODEL,
              messages: [
                { role: "system", content: "Summarize the following conversation briefly. Focus on: project state, technical details, code created, active goals. Output only the summary." },
                ...msgsToSummarize.map(m => ({ role: m.role, content: m.content }))
              ],
              stream: false,
              keep_alive: 0,
              options: { num_ctx: 8192 }
            })
          });
          const sumData = await sumRes.json();
          const summaryText = sumData.message?.content || "Context compacted.";
          for (let i = firstUncompacted; i < lastToCompact; i++) chatMessages[i].compacted = true;
          chatMessages.splice(lastToCompact, 0, {
            role: "system", type: "context_summary",
            content: "PREVIOUS CONTEXT SUMMARY:\n" + summaryText
          });
          await saveMessagesToChat(chatId, chatMessages);
          console.log("[Sub-Agent Qwen] Memory compacted.");
          
          // Unload Qwen to free VRAM for Ornith
          try {
            console.log("[Memory Manager] Unloading qwen3.5:4b to make room for Ornith...");
            await fetch(OLLAMA_GENERATE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: SUBAGENT_MODEL, keep_alive: 0 })
            });
          } catch (e) {
            console.error("[Memory Manager] Failed to unload qwen3.5:4b:", e);
          }
        } catch (err) {
          console.error("[Sub-Agent Qwen] Compaction failed:", err);
        }
      }
    }

    // Canvas tool names (used in loop and fallback)
    const canvasToolsList = ["open_code_editor","create_live_preview","write_rich_document","draw_diagram","render_spreadsheet","create_graphic_canvas"];

    // Track the last canvas tool called in THIS request (for fallback message)
    let lastCalledTool = { name: '', title: '' };
    // Track which file-generation tools succeeded in this request
    const successfulTools = new Set<string>();
    // Count how many times we've reminded the model to call a tool (to avoid infinite loops)
    let reminderCount = 0;
    // Set when the client disconnects/aborts (Stop button) — checked after the loop
    // to skip the "hit iteration limit" message, since this stop was intentional.
    let wasAborted = false;

    // Tools from configured MCP servers (see Settings), discovered once per
    // request — the set doesn't change mid-conversation, so there's no need
    // to reconnect/re-list on every loop iteration below. A server that's
    // unreachable or misconfigured is skipped rather than failing the whole
    // request (see getMcpTools()).
    const mcpTools = await getMcpTools();

    // ── Orchestration Loop (max 15 iterations) ──
    for (let i = 0; i < 15; i++) {
      if (req.signal.aborted) {
        wasAborted = true;
        break;
      }

      const ollamaMessages = buildOllamaMessages(chatMessages)
        .filter(msg => !msg.compacted)
        .map((msg) => {
          // STRIP IMAGES and internal metadata from messages going to Ornith
          const { imagePreview, imagePreviews, _visionProcessed, _visionData, images, ...rest } = msg;
          return rest;
        });

      // Intent detection (computed fresh each iteration in case of follow-up messages, but vars are accessible to self-correction)
      const recentUserMsgs = chatMessages
        .filter((m: any) => m.role === 'user')
        .slice(-6)
        .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
        .join(' ')
        .toLowerCase();

      const lastUserMsg = [...chatMessages].reverse().find((m: any) => m.role === 'user');
      const lastUserText = (typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '').toLowerCase();
      const userText = lastUserText + ' ' + recentUserMsgs;

      // Spreadsheet
      const wantsSpreadsheet = [
        'spreadsheet','excel','csv','xlsx',
        'download tabel','download spreadsheet','download data',
        'export data','ekspor data','export tabel',
        'buat spreadsheet','buat file tabel','buat tabel',
        'buat data','bikin tabel','bikin data',
        'masukkan ke','simpan ke tabel','simpan ke spreadsheet',
        'simpan ke csv','simpan ke excel','jadikan tabel',
        'jadikan spreadsheet','jadikan csv','jadikan excel',
        'ubah ke tabel','convert ke tabel',
        'tabel interaktif','tabel sederhana','tabel data',
        'format tabel','data produk','data penjualan',
        'data karyawan','data siswa','data barang','data item',
        'data inventori','data inventory','data list',
        'tampilkan tabel','tampilkan data','susun tabel'
      ].some(kw => lastUserText.includes(kw))
        || (lastUserText.includes('tabel') && (lastUserText.includes('masuk') || lastUserText.includes('simpan') || lastUserText.includes('download') || lastUserText.includes('export')))
        || (['masukkan ke','simpan ke','jadikan','export','download'].some(kw => lastUserText.includes(kw))
            && ['tabel','spreadsheet','csv','excel','data'].some(kw => userText.includes(kw)));

      // Live Preview
      const wantsPreview = [
        'landing page','halaman web','website','web page','webpage',
        'html page','buat web','buat website','buat halaman',
        'buat html','tampilkan web','render html',
        'halaman kafe','halaman toko','halaman portfolio',
        'single page','one page','preview html'
      ].some(kw => lastUserText.includes(kw))
        || (lastUserText.includes('html') && (lastUserText.includes('buat') || lastUserText.includes('create') || lastUserText.includes('bikin')));

      // Chart
      const CHART_KEYWORDS = [
        'bar chart','line chart','pie chart','pie graph',
        'grafik batang','grafik garis','grafik lingkaran','grafik pie',
        'diagram batang','diagram garis','diagram lingkaran',
        'grafik','chart','plot','visualisasi data',
        'scatter','radar','doughnut','piechart','barchart','linechart',
        'jadikan','ubah jadi','ganti jadi','convert','buat jadi'
      ];
      const lastMsgWordCount = lastUserText.trim().split(/\s+/).length;
      const isFollowUp = lastMsgWordCount <= 8;
      const wantsChart = CHART_KEYWORDS.some(kw => lastUserText.includes(kw))
        || (isFollowUp && CHART_KEYWORDS.some(kw => recentUserMsgs.includes(kw)));
      const wantsGenerateExcel = lastUserText.includes('file excel') || lastUserText.includes('.xlsx') || lastUserText.includes('file xlsx') || lastUserText.includes('generate excel') || (lastUserText.includes('excel') && lastUserText.includes('sungguhan'));
      const wantsGenerateWord  = lastUserText.includes('file word') || lastUserText.includes('.docx') || lastUserText.includes('file docx') || (lastUserText.includes('word') && (lastUserText.includes('sungguhan') || lastUserText.includes('dokumen')));
      const wantsGeneratePpt   = lastUserText.includes('ppt') || lastUserText.includes('presentasi') || lastUserText.includes('powerpoint') || lastUserText.includes('slide');

      // Diagram
      const DIAGRAM_KEYWORDS = [
        'flowchart','flow chart','erd','entity relationship','mindmap','mind map',
        'sequence diagram','gantt','class diagram','state diagram','gitgraph',
        'use case','usecase','use-case','venn','venn diagram',
        'timeline','quadrant','quadrant chart','c4','c4 diagram','c4context',
        'component diagram','activity diagram','deployment diagram',
        'pie diagram','user journey','journey map','statediagram',
        'diagram alur','diagram relasi','diagram urutan','diagram kelas',
        'diagram state','diagram komponen','diagram aktivitas',
        'diagram use case','diagram venn','diagram timeline',
        'diagram sekuens','diagram sekuen','diagram hubungan',
        'diagram sistem','peta pikiran','peta perjalanan',
        'diagram kuadran','diagram pie','diagram lingkaran konseptual',
        'diagram','bagan'
      ];
      const isNumericChart = ['grafik','angka'].some(kw => userText.includes(kw))
        && ['bar','line','batang','garis'].some(kw => userText.includes(kw));
      const wantsDiagram = DIAGRAM_KEYWORDS.some(kw => userText.includes(kw)) && !isNumericChart;

      const activeTools = [
        ...toolRegistry.filter((t: any) => {
          const name = t.function.name;
          // render_spreadsheet: hide if not asking for UI table, OR if user wants a real file
          const wantsRealFile = wantsGenerateExcel || wantsGenerateWord || wantsGeneratePpt;
          if (name === 'render_spreadsheet' && (!wantsSpreadsheet || wantsRealFile)) return false;
          if (name === 'render_spreadsheet' && wantsChart) return false;
          if (name === 'create_graphic_canvas' && !wantsChart) return false;
          if (name === 'create_live_preview' && !wantsPreview && !lastUserText.includes('html') && !lastUserText.includes('web')) return false;
          if (wantsChart && !wantsDiagram && !wantsPreview) {
            if (name === 'draw_diagram') return false;
          }
          return true;
        }),
        // MCP tools are always offered (no keyword gating — we don't know
        // what a third-party tool is for well enough to guess intent), but
        // always require approval to actually run (see isDangerousTool()).
        ...mcpTools,
      ];

      const ollamaPayload: any = {
        model: CHAT_MODEL,
        messages: ollamaMessages,
        tools: activeTools,
        stream: true,
        options: { num_ctx: 8192 }
      };

      let ollamaResponse: Response;
      try {
        ollamaResponse = await fetch(OLLAMA_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaPayload),
          signal: req.signal,
        });
      } catch (err: any) {
        if (err.name === 'AbortError' || req.signal.aborted) { wasAborted = true; break; }
        throw err;
      }

      if (!ollamaResponse.ok) {
        const errorText = await ollamaResponse.text();
        
        // Handle multimodal error gracefully
        if (ollamaResponse.status === 400 && errorText.includes("multimodal")) {
          console.warn("[Agent] Model does not support multimodal. Stripping images and retrying.");
          const fallbackMessages = ollamaMessages.map((msg: any) => {
            if (msg.images) {
              const { images, ...rest } = msg;
              rest.content += "\n\n[SYSTEM: The user attached an image here, but your current model architecture is TEXT-ONLY and cannot see images. Politely inform the user that you cannot process images, and ask them to copy-paste the text or describe it instead.]";
              return rest;
            }
            return msg;
          });
          
          ollamaPayload.messages = fallbackMessages;

          ollamaResponse = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ollamaPayload),
            signal: req.signal,
          });

          if (!ollamaResponse.ok) {
            throw new Error(`Ollama API Error after retry: ${await ollamaResponse.text()}`);
          }
        } else {
          throw new Error(`Ollama API Error: ${errorText}`);
        }
      }

      let responseMessage: { role: string; content: string; tool_calls?: any[] };
      try {
        responseMessage = await readOllamaStream(ollamaResponse, (delta) => {
          emit(controller, { type: "delta", content: delta });
        });
      } catch (err: any) {
        if (err.name === 'AbortError' || req.signal.aborted) { wasAborted = true; break; }
        throw err;
      }
      chatMessages.push(responseMessage);

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        
        let requiresApproval = false;
        let approvalData = null;

        for (const toolCall of responseMessage.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs: any = {};
          try {
            toolArgs = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
          } catch { /* use empty */ }

          console.log(`[Agent] Tool called: ${toolName}`);

          // Human-in-the-loop for dangerous tools: run_terminal_command,
          // write_local_file, edit_local_file, and every MCP tool (see
          // dangerousTools.ts — this is the single shared gate also used by
          // /api/agent/tools/execute, so the two can't drift out of sync).
          if (isDangerousTool(toolName)) {
            requiresApproval = true;
            approvalData = { name: toolName, args: toolArgs };
            break; // Stop processing other tools in this batch until approved
          }

          // ── Tool Validation Middleware (self-correction) ──
          if (toolName === "draw_diagram" && !toolArgs.code?.trim()) {
            console.log("[Agent] draw_diagram empty code → self-correcting");
            chatMessages.push({ role: "tool", name: toolName, content: 'ERROR: Parameter "code" is empty. You MUST provide complete Mermaid syntax in the "code" field. Use the cheatsheet in your system prompt. Call draw_diagram again with the actual diagram code.' });
            continue;
          }
          if (toolName === "create_graphic_canvas" && (!toolArgs.labels?.trim() || !toolArgs.datasets?.trim())) {
            console.log("[Agent] create_graphic_canvas empty data → self-correcting");
            chatMessages.push({ role: "tool", name: toolName, content: 'ERROR: "labels" or "datasets" is empty. Provide valid JSON arrays. Example: labels="[\\"A\\",\\"B\\"]", datasets="[{\\"label\\":\\"Data\\",\\"data\\":[10,20]}]". Call create_graphic_canvas again.' });
            continue;
          }
          if (toolName === "render_spreadsheet") {
            const dataStr = toolArgs.data?.trim();
            if (!dataStr) {
              console.log("[Agent] render_spreadsheet empty data → self-correcting");
              chatMessages.push({ role: "tool", name: toolName, content: 'ERROR: Parameter "data" is empty. Provide a complete JSON array of row objects. Example: "[{\\"ID\\":\\"P001\\",\\"Nama\\":\\"Laptop\\",\\"Harga\\":\\"8500000\\"}]". Call render_spreadsheet again with actual data.' });
              continue;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (!Array.isArray(parsed)) {
                console.log("[Agent] render_spreadsheet invalid format → self-correcting");
                chatMessages.push({ role: "tool", name: toolName, content: 'ERROR: data must be a JSON array of objects, not an object or nested structure. Example: [{"Col":"Val"}]. Call render_spreadsheet again.' });
                continue;
              }
            } catch {
              console.log("[Agent] render_spreadsheet invalid JSON → self-correcting");
              chatMessages.push({ role: "tool", name: toolName, content: 'ERROR: data is not valid JSON. Must be a JSON array. Call render_spreadsheet again.' });
              continue;
            }
          }

          // Canvas tools: execute then let model respond with text
          const canvasTools = ["open_code_editor","create_live_preview","write_rich_document","draw_diagram","render_spreadsheet","create_graphic_canvas"];
          if (canvasTools.includes(toolName)) {
            // Track for fallback message
            lastCalledTool = { name: toolName, title: toolArgs.title || toolArgs.filename || '' };
            emit(controller, { type: "tool_call", name: toolName, args: toolArgs });
            const toolResult = await executeTool(toolName, toolArgs);
            emit(controller, { type: "tool_result", name: toolName, ok: !toolResult.startsWith('Error') });
            chatMessages.push({ role: "tool", content: toolResult, name: toolName });
            continue;
          }

          // Safe tools: execute immediately
          emit(controller, { type: "tool_call", name: toolName, args: toolArgs });
          const toolResult = await executeTool(toolName, toolArgs);
          emit(controller, { type: "tool_result", name: toolName, ok: !toolResult.startsWith('Error') });
          chatMessages.push({ role: "tool", content: toolResult, name: toolName });
          // Track successful file generation tools
          if (['generate_word_doc','generate_excel_file','generate_presentation'].includes(toolName) && toolResult.startsWith('Success')) {
            successfulTools.add(toolName);
          }
        }

        if (requiresApproval) {
          await saveMessagesToChat(chatId, chatMessages);
          // Mint a single-use token tied to this exact chat + tool + args.
          // /api/agent/tools/execute will only run the command if it's
          // handed back this token — that's what actually enforces that a
          // human clicked "Approve", instead of trusting the client blindly.
          const approvalToken = createApprovalToken(chatId, approvalData.name, approvalData.args);
          const toolCall = { ...approvalData, chatId, token: approvalToken };
          emit(controller, { type: "requires_approval", toolCall, messages: chatMessages });
          controller.close();
          return;
        }


      } else {
        // Model returned no tool_calls — it replied with text
        const hasContent = !!(responseMessage.content?.trim());

        // Check which needed generate-tools are still pending (not yet done in this request)
        const needsWord  = wantsGenerateWord  && !successfulTools.has('generate_word_doc');
        const needsExcel = wantsGenerateExcel && !successfulTools.has('generate_excel_file');
        const needsPpt   = wantsGeneratePpt   && !successfulTools.has('generate_presentation');
        const stillHasPendingTools = needsWord || needsExcel || needsPpt;

        // Only force a reminder if the response is empty AND there are still pending file tools
        if (!hasContent && stillHasPendingTools) {
          reminderCount++;
          // After 3 failed reminders, auto-execute pending tools directly (model is struggling)
          if (reminderCount >= 3) {
            console.log("[Agent] Model stuck on pending tools after 3 reminders → auto-executing");
            const autoResults: string[] = [];
            if (needsWord) {
              const res = await executeTool('generate_word_doc', { filename: 'Document.docx', content: '# Document\n\nGenerated by Ornith AI.\n' });
              chatMessages.push({ role: "tool", content: res, name: 'generate_word_doc' });
              if (res.startsWith('Success')) { successfulTools.add('generate_word_doc'); autoResults.push(res); }
            }
            if (needsExcel) {
              const res = await executeTool('generate_excel_file', { filename: 'Data.xlsx', data: [{ "Column A": "Value 1", "Column B": "Value 2" }] });
              chatMessages.push({ role: "tool", content: res, name: 'generate_excel_file' });
              if (res.startsWith('Success')) { successfulTools.add('generate_excel_file'); autoResults.push(res); }
            }
            if (needsPpt) {
              const res = await executeTool('generate_presentation', { filename: 'Presentation.pptx', slides: [{ title: 'Slide 1', body: 'Content here.' }] });
              chatMessages.push({ role: "tool", content: res, name: 'generate_presentation' });
              if (res.startsWith('Success')) { successfulTools.add('generate_presentation'); autoResults.push(res); }
            }
            reminderCount = 0;
            continue;
          }
          console.log("[Agent] Empty response with pending file tools → reminding");
          const reminder = `You still need to call: ${needsWord ? 'generate_word_doc ' : ''}${needsExcel ? 'generate_excel_file ' : ''}${needsPpt ? 'generate_presentation ' : ''}. Call the tool NOW. Do NOT write text — call the tool immediately.`;
          chatMessages.push({ role: "tool", name: "system", content: reminder });
          emit(controller, { type: "status", message: "Menyesuaikan permintaan..." });
          continue;
        }

        // Also remind if truly empty with no tools called at all (diagram/chart/etc)
        if (!hasContent && lastCalledTool.name === '' && !successfulTools.size) {
          console.log("[Agent] Empty response with no tool called → forcing tool reminder");
          const reminder = wantsDiagram
            ? 'You forgot to call draw_diagram! Call draw_diagram NOW with complete Mermaid code in the "code" field.'
            : wantsSpreadsheet
            ? 'You forgot to call render_spreadsheet! Call render_spreadsheet NOW with complete JSON data in the "data" field.'
            : wantsChart
            ? 'You forgot to call create_graphic_canvas! Call create_graphic_canvas NOW with labels and datasets.'
            : wantsPreview
            ? 'You forgot to call create_live_preview! Call create_live_preview NOW with HTML content.'
            : 'You returned an empty response. Please respond to the user\'s request properly.';
          chatMessages.push({ role: "tool", name: "system", content: reminder });
          emit(controller, { type: "status", message: "Menyesuaikan permintaan..." });
          continue;
        }

        // Has content (or all tools done) → treat as final response
        finalResponse = responseMessage;
        isDone = true;
        break;
      }
    }

    if (wasAborted) {
      // Stop button was clicked (or the client disconnected) — persist
      // whatever partial state exists so it isn't lost, but there's no one
      // listening to emit further events to.
      await saveMessagesToChat(chatId, chatMessages);
      controller.close();
      return;
    }

    if (!isDone) {
      const stopMsg = { role: "assistant", content: "Maaf, proses terhenti karena mencapai batas iterasi. Silakan coba lagi." };
      chatMessages.push(stopMsg);
      await saveMessagesToChat(chatId, chatMessages);
      emit(controller, { type: "final", status: "success", response: stopMsg, messages: chatMessages });
      controller.close();
      return;
    }

    // If model returned empty content after executing a canvas tool, generate a meaningful fallback
    if (finalResponse && !finalResponse.content && (!finalResponse.tool_calls || finalResponse.tool_calls.length === 0)) {
      const label = lastCalledTool.title ? ` "${lastCalledTool.title}"` : '';
      const msgMap: Record<string, string> = {
        draw_diagram: `Diagram${label} telah dibuat! Klik canvas di sebelah kanan untuk melihat hasilnya.`,
        create_live_preview: `Halaman web${label} telah dibuat dan ditampilkan di canvas!`,
        render_spreadsheet: `Spreadsheet${label} telah dibuat! Kamu bisa lihat dan download datanya di canvas sebelah kanan.`,
        create_graphic_canvas: `Grafik${label} telah dibuat dan ditampilkan di canvas!`,
        write_rich_document: `Dokumen${label} telah selesai dibuat dan ditampilkan di canvas!`,
        open_code_editor: `File kode${label} telah dibuat dan dibuka di editor!`,
      };
      finalResponse.content = msgMap[lastCalledTool.name] || "Tugas selesai! Lihat hasilnya di canvas sebelah kanan.";
    }

    await saveMessagesToChat(chatId, chatMessages);
    emit(controller, { type: "final", status: "success", response: finalResponse, messages: chatMessages });
    controller.close();

    } catch (error: any) {
      console.error("Local Agent Engine Error:", error);
      let message = error.message || String(error);
      if (error.name === 'AbortError') {
        // Client stopped generation mid-flight and we didn't already handle
        // it via wasAborted (e.g. it happened during a non-fetch await) —
        // nothing useful to tell a disconnected client, just stop quietly.
        try { controller.close(); } catch { /* already closed */ }
        return;
      }
      if (error.cause?.code === 'ECONNREFUSED' || error.code === 'ECONNREFUSED') {
        message = "Could not connect to Local Ollama Engine. Is Ollama running on port 11434?";
      }
      emit(controller, { type: "error", error: message });
      try { controller.close(); } catch { /* already closed */ }
    }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
