"use client";

import { useState, KeyboardEvent, useEffect, useRef, useMemo } from "react";
import styles from "./page.module.css";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Chat history search helpers ──
// The sidebar search matches message content, not just the chat title (see
// historyGroups below). These are plain, pure helpers — no component state —
// so they live at module scope instead of being recreated every render.

/** Plain searchable text for one message: string content only, with the
 *  internal vision-analysis markers stripped so a search term never
 *  "matches" purely because it's buried in embedded image data. */
function getMessageSearchText(msg: any): string {
  const raw = typeof msg?.content === "string" ? msg.content : "";
  if (!raw) return "";
  return raw
    .replace(/\[VISION_DATA:[\s\S]*?\]/g, "")
    .replace(/\[VISION_CONTEXT:[\s\S]*?\]/g, "");
}

/** A short "…around the match…" preview, like Gemini/ChatGPT/Claude show
 *  under a history item when the match came from the message body rather
 *  than the title. */
function buildMatchSnippet(text: string, q: string, pad = 42): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, pad * 2).trim();
  const start = Math.max(0, idx - pad);
  const end = Math.min(text.length, idx + q.length + pad);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

/** Wraps the first case-insensitive occurrence of `q` in `text` with a
 *  <mark> so the matched term stands out in the sidebar, same as the
 *  search-result highlighting in Gemini/ChatGPT/Claude's own chat search. */
function highlightMatch(text: string, q: string) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.searchHighlight}>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ── Empty-state starter prompts ──
// The blank "What are we working on?" screen had nothing to act on besides
// a placeholder in the composer. These are shortcuts into the agent's real,
// existing tool categories (file access, terminal, database, generated
// documents) — not generic chatbot suggestions — so clicking one always
// leads somewhere useful. Clicking fills the composer rather than sending
// immediately, so the user can still edit the prompt before it goes out.
const STARTER_PROMPTS: { icon: React.ReactNode; title: string; prompt: string }[] = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>
    ),
    title: "Explore the project",
    prompt: "List the files in src/ and give me a quick summary of the project structure.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    title: "Run a command",
    prompt: "Run npm run build and tell me if it succeeds.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
    ),
    title: "Query the database",
    prompt: "Show me the tables in this project's SQLite database.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
      </svg>
    ),
    title: "Generate a document",
    prompt: "Write a short docx report summarizing what this project does.",
  },
];

// ── "/" command palette ──
// Cloud chat assistants (Claude.ai, ChatGPT, etc.) generally offer a "/"
// command menu; Bilal asked for the same here. Rather than inventing
// generic commands, every entry below maps to something this agent can
// genuinely do — either one of the 19 tools in tools/registry.ts (grouped
// by the same categories as the hub page's stats row) or a real, existing
// piece of Studio UI (new chat, the per-chat auto-approve toggle, Settings).
// A handful of tools (open_code_editor, create_live_preview,
// write_rich_document) are deliberately left out: the agent already picks
// those automatically based on what's asked for, so a dedicated command
// would just duplicate /write or /docx without adding a real shortcut.
//
// "insert" commands fill the composer with a starter prompt the user can
// still edit before sending, same as the starter cards on the empty-chat
// screen. "action" commands run immediately (new chat, toggle, open a
// modal) and never send anything to the agent.
type SlashCommand = {
  command: string;
  label: string;
  category: string;
  icon: React.ReactNode;
  kind: "insert" | "action";
  template?: string;
  action?: "new-chat" | "auto-approve" | "settings";
};

const SLASH_ICONS: Record<string, React.ReactNode> = {
  doc: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  ),
  folder: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  ),
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  edit: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
  terminal: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  link: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  database: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  ),
  grid: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  presentation: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  flow: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <path d="M10 6.5h4a2 2 0 0 1 2 2V10" />
      <path d="M14 17.5H10a2 2 0 0 1-2-2V14" />
    </svg>
  ),
  chart: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  eye: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  bookmark: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
    </svg>
  ),
  plus: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  shieldCheck: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  settings: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
};

const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/read", label: "Read a file", category: "Files & Code", icon: SLASH_ICONS.doc, kind: "insert", template: "Read the file at " },
  { command: "/list", label: "List a directory", category: "Files & Code", icon: SLASH_ICONS.folder, kind: "insert", template: "List the files in " },
  { command: "/find", label: "Search the codebase", category: "Files & Code", icon: SLASH_ICONS.search, kind: "insert", template: "Search the codebase for " },
  { command: "/write", label: "Create a file", category: "Files & Code", icon: SLASH_ICONS.edit, kind: "insert", template: "Create a new file at " },
  { command: "/edit", label: "Edit a file", category: "Files & Code", icon: SLASH_ICONS.edit, kind: "insert", template: "In the file " },
  { command: "/run", label: "Run a terminal command", category: "Terminal", icon: SLASH_ICONS.terminal, kind: "insert", template: "Run the command: " },
  { command: "/search", label: "Search the web", category: "Web", icon: SLASH_ICONS.search, kind: "insert", template: "Search the web for " },
  { command: "/scrape", label: "Read a webpage", category: "Web", icon: SLASH_ICONS.link, kind: "insert", template: "Fetch and summarize this page: " },
  { command: "/db", label: "Inspect the database", category: "Data", icon: SLASH_ICONS.database, kind: "insert", template: "Show me the schema of this project's database." },
  { command: "/docx", label: "Write a Word document", category: "Documents", icon: SLASH_ICONS.doc, kind: "insert", template: "Write a Word document about " },
  { command: "/excel", label: "Generate a spreadsheet", category: "Documents", icon: SLASH_ICONS.grid, kind: "insert", template: "Generate an Excel file with " },
  { command: "/pptx", label: "Create a presentation", category: "Documents", icon: SLASH_ICONS.presentation, kind: "insert", template: "Create a presentation about " },
  { command: "/diagram", label: "Draw a diagram", category: "Documents", icon: SLASH_ICONS.flow, kind: "insert", template: "Draw a diagram showing " },
  { command: "/chart", label: "Plot a chart", category: "Documents", icon: SLASH_ICONS.chart, kind: "insert", template: "Create a chart showing " },
  { command: "/preview", label: "Build a live preview", category: "Documents", icon: SLASH_ICONS.eye, kind: "insert", template: "Build a live preview of " },
  { command: "/remember", label: "Save a preference", category: "Memory", icon: SLASH_ICONS.bookmark, kind: "insert", template: "Remember: " },
  { command: "/new", label: "Start a new chat", category: "Chat", icon: SLASH_ICONS.plus, kind: "action", action: "new-chat" },
  { command: "/auto-approve", label: "Toggle auto-approve for this chat", category: "Chat", icon: SLASH_ICONS.shieldCheck, kind: "action", action: "auto-approve" },
  { command: "/settings", label: "Open settings", category: "Chat", icon: SLASH_ICONS.settings, kind: "action", action: "settings" },
];

export default function Studio() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  // "/" command palette — open only while the composer's ENTIRE content is
  // still a bare command being typed (no space yet), same trigger rule as
  // Slack/Discord/Notion, so a "/" typed mid-sentence (e.g. a file path)
  // never pops it open.
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<any | null>(null);
  // Chat IDs that currently have "auto-approve" turned on. Deliberately kept
  // as plain in-memory component state (not persisted to settings/localStorage,
  // not synced to the backend) so it is scoped to THIS chat, in THIS browser
  // session, and resets on reload — never a silent global setting.
  const [autoApproveChatIds, setAutoApproveChatIds] = useState<Set<string>>(new Set());
  type AttachedFile = {
    file: File;
    previewUrl: string;
    type: 'image' | 'document';
    name: string;
  };
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [previewModalImage, setPreviewModalImage] = useState<string | null>(null);
  
  // UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeCanvas, setActiveCanvas] = useState<{
    type: 'code' | 'preview' | 'document' | 'diagram' | 'spreadsheet' | 'chart' | 'notebook',
    content: string,
    title?: string,
    language?: string,
    filename?: string,
    showCode?: boolean
  } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Edit & Regenerate state
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);

  // Streaming state — the reply currently being typed out for the chat that's
  // loading, and a short live status line ("Calling tool X...") while the
  // agent is between tool calls. Cleared once the "final" event arrives and
  // the real `messages` array takes over.
  const [streamingText, setStreamingText] = useState('');
  const [streamingStatus, setStreamingStatus] = useState('');
  // One AbortController per in-flight chat request, keyed by chatId, so the
  // Stop button can cancel the request for whichever chat is currently open
  // without disturbing any other chat that might be generating in the background.
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<{
    workspaceRoot: string;
    chatModel: string;
    subAgentModel: string;
    ollamaUrl: string;
    mcpServers: Array<{ name: string; command: string; args: string[]; enabled?: boolean }>;
  } | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  // True for the brief window between clicking Cancel/the backdrop and the
  // modal actually unmounting — lets the panel play its exit animation
  // instead of just vanishing.
  const [settingsClosing, setSettingsClosing] = useState(false);

  // Workspace Root folder picker — an inline click-to-navigate directory
  // browser (server-side, via /api/browse-directory) rather than a native
  // file dialog: a plain <input type="file" webkitdirectory> can't give the
  // real absolute host path back to the browser, but this app's own API
  // routes run on the same machine as `next dev` and can just read the disk.
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [browseEntries, setBrowseEntries] = useState<{ name: string; path: string }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');

  // Ollama models available at the configured Ollama URL, for the Chat
  // Model / Sub-Agent Model dropdowns. Falls back to the old free-text
  // inputs when this comes back empty (Ollama unreachable, wrong URL, etc.)
  // so a broken connection never leaves the fields impossible to edit.
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');


  const compressImageAsync = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_SIZE = 1600; // Increased max size for better detail
          
          if (width > height) {
            if (width > MAX_SIZE) {
              height = Math.round((height * MAX_SIZE) / width);
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width = Math.round((width * MAX_SIZE) / height);
              height = MAX_SIZE;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.95)); // Higher quality
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    
    const newAttachments = files.map(file => ({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      type: file.type.startsWith('image/') ? 'image' as const : 'document' as const,
      name: file.name
    }));

    setAttachedFiles(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  };
  
  // Chat History States
  const [chatList, setChatList] = useState<any[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>("");
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  // New Async Loading States
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const currentChatIdRef = useRef(currentChatId);

  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  const handleUpdateChat = async (id: string, updates: any) => {
    try {
      await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates })
      });
      const res = await fetch('/api/chats');
      const data = await res.json();
      setChatList(data);
    } catch(e) {
      console.error(e);
    }
  };

  const handleDeleteChat = async (id: string) => {
    try {
      await fetch('/api/chats', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const res = await fetch('/api/chats');
      const data = await res.json();
      setChatList(data);
      if (currentChatId === id) {
        if (data.length > 0) {
          setCurrentChatId(data[0].id);
          setMessages(data[0].messages || []);
        } else {
          const newId = crypto.randomUUID();
          setCurrentChatId(newId);
          setMessages([]);
        }
      }
    } catch(e) {
      console.error(e);
    }
  };

  // Queries /api/ollama-models for whatever's actually pulled at the given
  // Ollama URL. Called when Settings opens (with the saved URL) and from
  // the Models section's own refresh button (with whatever URL is
  // currently typed, so editing the URL and refreshing works before saving).
  const fetchOllamaModels = async (ollamaUrl: string) => {
    if (!ollamaUrl.trim()) return;
    setModelsLoading(true);
    setModelsError('');
    try {
      const res = await fetch(`/api/ollama-models?ollamaUrl=${encodeURIComponent(ollamaUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load models');
      setOllamaModels(Array.isArray(data.models) ? data.models : []);
    } catch (e: any) {
      setOllamaModels([]);
      setModelsError(e.message || 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  };

  // ── Settings modal ──
  const openSettings = async () => {
    setSettingsError('');
    setIsSettingsOpen(true);
    setOllamaModels([]);
    setModelsError('');
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load settings');
      setSettingsForm({
        workspaceRoot: data.workspaceRoot || '',
        chatModel: data.chatModel || '',
        subAgentModel: data.subAgentModel || '',
        ollamaUrl: data.ollamaUrl || '',
        mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers : [],
      });
      if (data.ollamaUrl) fetchOllamaModels(data.ollamaUrl);
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to load settings');
    }
  };

  // ── Workspace Root folder picker ──
  const loadBrowseDir = async (targetPath: string | null) => {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const url = targetPath ? `/api/browse-directory?path=${encodeURIComponent(targetPath)}` : '/api/browse-directory';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to list that folder');
      setBrowsePath(data.path);
      setBrowseParent(data.parent);
      setBrowseEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (e: any) {
      setBrowseError(e.message || 'Failed to list that folder');
    } finally {
      setBrowseLoading(false);
    }
  };

  const openFolderPicker = () => {
    setFolderPickerOpen(true);
    // Start from wherever Workspace Root currently points — if that path
    // turns out not to exist, /api/browse-directory returns an error and
    // the "Drives" button in the picker still gets the user back to a
    // known-good starting point.
    loadBrowseDir(settingsForm?.workspaceRoot || null);
  };

  const closeFolderPicker = () => {
    setFolderPickerOpen(false);
    setBrowseError('');
  };

  const chooseBrowsedFolder = () => {
    if (!browsePath) return;
    setSettingsForm(prev => (prev ? { ...prev, workspaceRoot: browsePath } : prev));
    setFolderPickerOpen(false);
  };

  // Plays the panel's exit animation (see .settingsPanelClosing /
  // .settingsOverlayClosing in CSS) before actually unmounting — a bare
  // setIsSettingsOpen(false) would just cut the modal instantly.
  const closeSettings = () => {
    setSettingsClosing(true);
    window.setTimeout(() => {
      setIsSettingsOpen(false);
      setSettingsClosing(false);
      setSettingsError('');
    }, 160);
  };

  const saveSettings = async () => {
    if (!settingsForm) return;
    setSettingsError('');

    const cleanedServers = settingsForm.mcpServers.map(s => ({
      name: s.name.trim(),
      command: s.command.trim(),
      args: (s.args || []).map(a => a.trim()).filter(a => a !== ''),
      enabled: s.enabled !== false,
    }));
    const badServer = cleanedServers.find(s => !s.name || !s.command);
    if (badServer) {
      setSettingsError('Setiap MCP server butuh Name dan Command yang diisi (atau hapus baris yang belum lengkap).');
      return;
    }

    setSettingsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceRoot: settingsForm.workspaceRoot,
          chatModel: settingsForm.chatModel,
          subAgentModel: settingsForm.subAgentModel,
          ollamaUrl: settingsForm.ollamaUrl,
          mcpServers: cleanedServers,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setSettingsForm({
        workspaceRoot: data.workspaceRoot || '',
        chatModel: data.chatModel || '',
        subAgentModel: data.subAgentModel || '',
        ollamaUrl: data.ollamaUrl || '',
        mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers : [],
      });
      closeSettings();
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  // ── MCP server list editing (replaces the old raw-JSON textarea) ──
  const addMcpServer = () => {
    setSettingsForm(prev => prev ? {
      ...prev,
      mcpServers: [...prev.mcpServers, { name: '', command: '', args: [], enabled: true }],
    } : prev);
  };

  const removeMcpServer = (idx: number) => {
    setSettingsForm(prev => prev ? {
      ...prev,
      mcpServers: prev.mcpServers.filter((_, i) => i !== idx),
    } : prev);
  };

  const updateMcpServerField = (idx: number, field: 'name' | 'command') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSettingsForm(prev => {
        if (!prev) return prev;
        const mcpServers = [...prev.mcpServers];
        mcpServers[idx] = { ...mcpServers[idx], [field]: e.target.value };
        return { ...prev, mcpServers };
      });
    };

  const toggleMcpServerEnabled = (idx: number) => {
    setSettingsForm(prev => {
      if (!prev) return prev;
      const mcpServers = [...prev.mcpServers];
      mcpServers[idx] = { ...mcpServers[idx], enabled: mcpServers[idx].enabled === false };
      return { ...prev, mcpServers };
    });
  };

  const addMcpServerArg = (idx: number) => {
    setSettingsForm(prev => {
      if (!prev) return prev;
      const mcpServers = [...prev.mcpServers];
      mcpServers[idx] = { ...mcpServers[idx], args: [...(mcpServers[idx].args || []), ''] };
      return { ...prev, mcpServers };
    });
  };

  const updateMcpServerArg = (serverIdx: number, argIdx: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSettingsForm(prev => {
        if (!prev) return prev;
        const mcpServers = [...prev.mcpServers];
        const args = [...(mcpServers[serverIdx].args || [])];
        args[argIdx] = e.target.value;
        mcpServers[serverIdx] = { ...mcpServers[serverIdx], args };
        return { ...prev, mcpServers };
      });
    };

  const removeMcpServerArg = (serverIdx: number, argIdx: number) => {
    setSettingsForm(prev => {
      if (!prev) return prev;
      const mcpServers = [...prev.mcpServers];
      mcpServers[serverIdx] = { ...mcpServers[serverIdx], args: (mcpServers[serverIdx].args || []).filter((_, i) => i !== argIdx) };
      return { ...prev, mcpServers };
    });
  };

  // Escape closes the modal, same as clicking the backdrop or Cancel.
  useEffect(() => {
    if (!isSettingsOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettingsOpen]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isSwitchingChat = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Reveals a floating "jump to bottom" button once the user has scrolled up
  // more than ~150px from the latest message — handy once a reply gets long
  // enough to need scrolling, or after scrolling back to re-read something.
  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 150);
  };

  // Auto-resize the composer textarea to fit its content, up to the CSS
  // max-height (200px) where it switches to internal scrolling. Re-runs
  // whenever the text changes, including the reset to '' after sending.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    scrollToBottom();
    
    // Detect UI Canvas tool calls — ONLY run when Qwen just finished responding.
    // Guard 1: not switching chats (prevents re-opening on chat switch)
    // Guard 2: last message must be from assistant (prevents re-opening when user sends a new message)
    if (!isSwitchingChat.current) {
      const lastMsg = messages[messages.length - 1];
      const isAssistantTurn = lastMsg?.role === 'assistant';
      if (isAssistantTurn) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            // Scan ALL tool calls in this message, pick the highest-priority canvas tool
            // Priority order: chart > notebook > spreadsheet > diagram > document > preview > code
            // Priority order: chart > spreadsheet > diagram > document > preview > code
            const PRIORITY = ['create_graphic_canvas','render_spreadsheet','draw_diagram','write_rich_document','create_live_preview','open_code_editor'];
            let bestTc: any = null;
            let bestPriority = Infinity;

            for (const tc of msg.tool_calls) {
              const p = PRIORITY.indexOf(tc.function.name);
              if (p !== -1 && p < bestPriority) {
                bestPriority = p;
                bestTc = tc;
              }
            }

            if (bestTc) {
              let args: any = {};
              try {
                args = typeof bestTc.function.arguments === 'string'
                  ? JSON.parse(bestTc.function.arguments)
                  : bestTc.function.arguments;
              } catch (e) { /* skip */ }

              if (bestTc.function.name === 'open_code_editor') {
                setActiveCanvas({ type: 'code', filename: args.filename, language: args.language, content: args.code_content });
              } else if (bestTc.function.name === 'create_live_preview') {
                setActiveCanvas({ type: 'preview', content: args.html_content });
              } else if (bestTc.function.name === 'write_rich_document') {
                setActiveCanvas({ type: 'document', title: args.title, content: args.content });
              } else if (bestTc.function.name === 'draw_diagram') {
                const diagramCode = args.code || args.diagram_code || args.mermaid_code || args.content || '';
                setActiveCanvas({ type: 'diagram', title: args.title, content: diagramCode });
              } else if (bestTc.function.name === 'render_spreadsheet') {
                const spreadData = args.data || args.table_data || args.rows || args.json_data || args.content || '[]';
                setActiveCanvas({ type: 'spreadsheet', title: args.title, content: spreadData });
              } else if (bestTc.function.name === 'create_graphic_canvas') {
                const rawLabels = args.labels;
                const rawDatasets = args.datasets;
                const labelsStr = Array.isArray(rawLabels) ? JSON.stringify(rawLabels) : (rawLabels || '[]');
                const datasetsStr = Array.isArray(rawDatasets) ? JSON.stringify(rawDatasets) : (rawDatasets || '[]');
                const chartPayload = JSON.stringify({ chart_type: args.chart_type || 'bar', labels: labelsStr, datasets: datasetsStr });
                setActiveCanvas({ type: 'chart', title: args.title || 'Chart', content: chartPayload });
              }
            }
            break; // Only check the most recent assistant message with tool_calls
          }
        }
      }
    }
  }, [messages, pendingApproval]);

  // Load chat history on mount
  useEffect(() => {
    const fetchChats = async () => {
      try {
        const res = await fetch('/api/chats');
        const data = await res.json();
        if (data && data.length > 0) {
          setChatList(data);
          
          // Check if this is a refresh (sessionStorage has ID) or a fresh open
          const lastId = sessionStorage.getItem('lastChatId');
          if (lastId && data.find((c: any) => c.id === lastId)) {
            // It's a refresh, restore the last opened chat
            isSwitchingChat.current = true;
            setCurrentChatId(lastId);
            const chat = data.find((c: any) => c.id === lastId);
            setMessages(chat.messages || []);
            setTimeout(() => { isSwitchingChat.current = false; }, 100);
          } else {
            // Fresh tab/window or last chat was deleted -> Start new chat
            createNewChat();
          }
        } else {
          createNewChat();
        }
      } catch(e) {
        console.error("Failed to fetch chats:", e);
        createNewChat();
      }
    };
    fetchChats();
  }, []);

  const createNewChat = () => {
    const newId = crypto.randomUUID();
    setCurrentChatId(newId);
    sessionStorage.setItem('lastChatId', newId);
    setMessages([]);
    setPendingApproval(null);
    setActiveCanvas(null);
  };

  const selectChat = (id: string) => {
    const chat = chatList.find(c => c.id === id);
    if (chat) {
      isSwitchingChat.current = true; // Prevent canvas auto-open
      setCurrentChatId(id);
      sessionStorage.setItem('lastChatId', id);
      setMessages(chat.messages || []);
      setPendingApproval(null);
      setActiveCanvas(null); // Fix 3: Close canvas when switching chats
      
      // Reset switching state after React has time to render the new messages
      setTimeout(() => {
        isSwitchingChat.current = false;
      }, 100);
    }
  };

  const saveChatToBackend = async (id: string, msgs: any[]) => {
    if (!id || msgs.length === 0) return;
    try {
      await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, messages: msgs })
      });

      const res = await fetch('/api/chats');
      const data = await res.json();
      setChatList(data);
    } catch(e) {
      console.error("Failed to save chat:", e);
    }
  };

  // Human-readable status line shown while a tool is running, keyed by tool name.
  const TOOL_STATUS_LABELS: Record<string, string> = {
    run_terminal_command: 'Menjalankan perintah terminal...',
    write_local_file: 'Menulis file...',
    edit_local_file: 'Mengedit file...',
    read_local_file: 'Membaca file...',
    list_directory: 'Melihat isi folder...',
    grep_codebase: 'Mencari di kode...',
    search_web: 'Mencari di web...',
    scrape_website: 'Membaca halaman web...',
    introspect_database: 'Membaca skema database...',
    generate_word_doc: 'Membuat dokumen Word...',
    generate_excel_file: 'Membuat file Excel...',
    generate_presentation: 'Membuat presentasi...',
  };

  const callAgent = async (targetChatId: string, currentMessages: any[]) => {
    setLoadingChatId(targetChatId);
    if (currentChatIdRef.current === targetChatId) {
      setPendingApproval(null);
      setStreamingText('');
      setStreamingStatus('');
    }

    const abortController = new AbortController();
    abortControllersRef.current[targetChatId] = abortController;

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: targetChatId, messages: currentMessages }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let errMsg = "Failed to fetch response";
        try { const data = await response.json(); errMsg = data.error || errMsg; } catch { /* body wasn't JSON */ }
        throw new Error(errMsg);
      }
      if (!response.body) {
        throw new Error("Server did not return a response stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalMessages: any[] | null = null;
      let finalToolCall: any = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;

          let event: any;
          try { event = JSON.parse(line); } catch { continue; }

          const isVisibleChat = currentChatIdRef.current === targetChatId;

          if (event.type === 'delta') {
            if (isVisibleChat) setStreamingText(prev => prev + event.content);
          } else if (event.type === 'status') {
            if (isVisibleChat) setStreamingStatus(event.message);
          } else if (event.type === 'tool_call') {
            if (isVisibleChat) setStreamingStatus(TOOL_STATUS_LABELS[event.name] || `Memanggil ${event.name}...`);
          } else if (event.type === 'requires_approval') {
            finalToolCall = event.toolCall;
            finalMessages = event.messages;
          } else if (event.type === 'final') {
            finalMessages = event.messages;
          } else if (event.type === 'error') {
            streamError = event.error;
          }
          // 'tool_result' carries no UI action of its own — the next delta or
          // tool_call status line naturally replaces whatever was showing.
        }
      }

      if (streamError) throw new Error(streamError);

      if (finalMessages) {
        await saveChatToBackend(targetChatId, finalMessages);
        if (currentChatIdRef.current === targetChatId) {
          setMessages(finalMessages);
          setStreamingText('');
          setStreamingStatus('');
          if (finalToolCall) setPendingApproval(finalToolCall);
        }
      }

      delete abortControllersRef.current[targetChatId];
      setLoadingChatId(prev => prev === targetChatId ? null : prev);

    } catch (error: any) {
      delete abortControllersRef.current[targetChatId];

      if (error.name === 'AbortError') {
        // Stop button — the server already persisted whatever partial
        // assistant message it had (see wasAborted in /api/agent). Re-sync
        // from the backend so that partial reply shows up instead of vanishing.
        if (currentChatIdRef.current === targetChatId) {
          setStreamingText('');
          setStreamingStatus('');
        }
        setLoadingChatId(prev => prev === targetChatId ? null : prev);
        try {
          const res = await fetch('/api/chats');
          const data = await res.json();
          setChatList(data);
          if (currentChatIdRef.current === targetChatId) {
            const chat = data.find((c: any) => c.id === targetChatId);
            if (chat) setMessages(chat.messages || []);
          }
        } catch { /* best-effort resync */ }
        return;
      }

      const errMsgs = [
        ...currentMessages,
        { role: "assistant", content: `Error: ${error.message}` }
      ];
      await saveChatToBackend(targetChatId, errMsgs);

      if (currentChatIdRef.current === targetChatId) {
        setMessages(errMsgs);
        setStreamingText('');
        setStreamingStatus('');
      }
      setLoadingChatId(prev => prev === targetChatId ? null : prev);
    }
  };

  const handleStop = () => {
    const controller = abortControllersRef.current[currentChatId];
    if (controller) controller.abort();
  };

  const handleSend = async () => {
    // Cegah pengiriman ganda jika chat ini sedang loading
    if ((!input.trim() && attachedFiles.length === 0) || loadingChatId === currentChatId || pendingApproval) return;

    const userMessage: any = { role: "user", content: input.trim() };
    
    const images: string[] = [];
    const imagePreviews: string[] = [];
    let appendedText = "";

    for (const attachment of attachedFiles) {
      if (attachment.type === 'image') {
        const compressedBase64 = await compressImageAsync(attachment.file);
        const base64Data = compressedBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        images.push(base64Data);
        imagePreviews.push(attachment.previewUrl);
      } else {
        // Read text file
        try {
          const text = await attachment.file.text();
          appendedText += `\n\n[Attached File: ${attachment.name}]\n\`\`\`\n${text}\n\`\`\``;
        } catch(e) {
          console.error("Failed to read file", e);
        }
      }
    }

    if (appendedText) {
      userMessage.content += appendedText;
    }
    if (images.length > 0) {
      userMessage.images = images;
      userMessage.imagePreviews = imagePreviews;
    }

    setInput("");
    setAttachedFiles([]);

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    
    const targetChatId = currentChatId;
    saveChatToBackend(targetChatId, newMessages);
    callAgent(targetChatId, newMessages);
  };

  // Recomputed on every keystroke while the menu is open — SLASH_COMMANDS is
  // short enough (under 20 entries) that a plain filter is instant, no need
  // to memoize further than "only run while the input actually starts with /".
  const filteredSlashCommands = input.startsWith("/")
    ? (() => {
        const query = input.slice(1).toLowerCase();
        // An exact command match (typically right after Tab-completed it)
        // wins outright — otherwise a command whose DESCRIPTION happens to
        // also contain that word (e.g. "/find"'s label is "Search the
        // codebase") could still out-rank it by array order and Enter would
        // apply the wrong command even though the composer shows the exact
        // text of a different one.
        const exact = SLASH_COMMANDS.find((c) => c.command.slice(1).toLowerCase() === query);
        if (exact) return [exact];
        // Otherwise: commands whose name starts with the query rank above
        // ones that only match by description, same as a normal command
        // palette (Slack/Discord/Notion) — a name match is a stronger
        // signal than a word appearing in the description text.
        const nameMatches = SLASH_COMMANDS.filter((c) => c.command.slice(1).toLowerCase().startsWith(query));
        const descMatches = SLASH_COMMANDS.filter(
          (c) => !nameMatches.includes(c) && c.label.toLowerCase().includes(query)
        );
        return [...nameMatches, ...descMatches];
      })()
    : [];

  // Opens the menu only when the WHOLE composer is still a bare command
  // (e.g. "/", "/re") — closes the moment a space is typed, which is when
  // the user starts typing the command's argument instead.
  useEffect(() => {
    const isBareCommand = /^\/[a-zA-Z-]*$/.test(input);
    setSlashMenuOpen(isBareCommand);
    if (isBareCommand) setSlashActiveIndex(0);
  }, [input]);

  const applySlashCommand = (cmd: SlashCommand) => {
    if (cmd.kind === "action") {
      if (cmd.action === "new-chat") createNewChat();
      else if (cmd.action === "auto-approve") toggleAutoApprove();
      else if (cmd.action === "settings") openSettings();
      setInput("");
    } else {
      setInput(cmd.template ?? "");
    }
    setSlashMenuOpen(false);
    // Re-focus after React re-renders the (now taller) textarea so the
    // cursor lands at the end of the inserted template, ready to type.
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashActiveIndex((i) => (i + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashActiveIndex((i) => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "Tab") {
        // Tab autocompletes the command token itself (e.g. "/sear" -> "/search")
        // and nothing else — same as Claude.ai's own "/" menu. It deliberately
        // does NOT apply the command (no template insert, no action run):
        // that's still Enter or a click, same as before. Re-filtering off the
        // now-exact text is handled by the effect below that watches `input`.
        e.preventDefault();
        const cmd = filteredSlashCommands[Math.min(slashActiveIndex, filteredSlashCommands.length - 1)];
        setInput(cmd.command);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applySlashCommand(filteredSlashCommands[Math.min(slashActiveIndex, filteredSlashCommands.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Edit & Regenerate handlers ──
  const handleStartEdit = (idx: number) => {
    const msg = messages[idx];
    setEditingMsgIdx(idx);
    setEditingText(typeof msg.content === 'string' ? msg.content.replace(/(\n\n|\n)?\[VISION_DATA:[\s\S]*?\]/g, '').replace(/(\n\n|\n)?\[VISION_CONTEXT:[\s\S]*?\]/g, '').trim() : '');
  };

  const handleCancelEdit = () => {
    setEditingMsgIdx(null);
    setEditingText('');
  };

  const handleSubmitEdit = async (idx: number) => {
    if (!editingText.trim()) return;
    // Keep messages before this one, then add the edited user message
    const sliced = messages.slice(0, idx);
    const editedMsg = { role: 'user', content: editingText.trim() };
    const newMessages = [...sliced, editedMsg];
    setMessages(newMessages);
    setEditingMsgIdx(null);
    setEditingText('');
    setActiveCanvas(null); // close stale canvas
    const targetChatId = currentChatId;
    saveChatToBackend(targetChatId, newMessages);
    callAgent(targetChatId, newMessages);
  };

  const handleRegenerate = async (idx: number) => {
    // Cut messages up to (not including) this assistant message
    const newMessages = messages.slice(0, idx);
    setMessages(newMessages);
    setActiveCanvas(null);
    const targetChatId = currentChatId;
    saveChatToBackend(targetChatId, newMessages);
    callAgent(targetChatId, newMessages);
  };



  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const newAttachments: AttachedFile[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          newAttachments.push({
            file,
            previewUrl: URL.createObjectURL(file),
            type: 'image',
            name: `Pasted_Image_${Date.now()}.png`
          });
        }
      } else if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) {
           newAttachments.push({
             file,
             previewUrl: '',
             type: 'document',
             name: file.name
           });
        }
      }
    }
    if (newAttachments.length > 0) {
      setAttachedFiles(prev => [...prev, ...newAttachments]);
    }
  };

  const handleApproveTool = async () => {
    if (!pendingApproval) return;
    const targetChatId = currentChatId;
    setLoadingChatId(targetChatId);

    try {
      const execRes = await fetch("/api/agent/tools/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: pendingApproval.chatId,
          token: pendingApproval.token,
          name: pendingApproval.name,
          args: pendingApproval.args
        })
      });

      const execData = await execRes.json();
      const toolResult = execData.result || execData.error || "Done.";

      // Mark the pending approval as "executed" so UI can show the trace block
      // then clear it right before calling the agent
      const executedApproval = { ...pendingApproval, result: toolResult, executed: true };
      setPendingApproval(executedApproval);

      const updatedMessages = [
        ...messages,
        {
          role: "tool",
          content: toolResult,
          name: pendingApproval.name
        }
      ];

      // Don't call setMessages here — callAgent will set the final messages
      await saveChatToBackend(targetChatId, updatedMessages);
      setPendingApproval(null);
      callAgent(targetChatId, updatedMessages);

    } catch (e: any) {
      const errMsgs = [
        ...messages,
        { role: "tool", content: `Failed to execute: ${e.message}`, name: pendingApproval.name }
      ];
      setMessages(errMsgs);
      await saveChatToBackend(targetChatId, errMsgs);
      setLoadingChatId(prev => prev === targetChatId ? null : prev);
      setPendingApproval(null);
    }
  };

  const handleDenyTool = async () => {
    if (!pendingApproval) return;
    const targetChatId = currentChatId;

    const updatedMessages = [
      ...messages,
      {
        role: "tool",
        content: "SYSTEM: User DENIED permission to execute this tool. Acknowledge this denial. DO NOT retry using this tool. Ask the user what they want to do next.",
        name: pendingApproval.name
      }
    ];
    setPendingApproval(null);
    await saveChatToBackend(targetChatId, updatedMessages);
    callAgent(targetChatId, updatedMessages);
  };

  const isAutoApproveOn = autoApproveChatIds.has(currentChatId);

  const toggleAutoApprove = () => {
    setAutoApproveChatIds(prev => {
      const next = new Set(prev);
      if (next.has(currentChatId)) next.delete(currentChatId);
      else next.add(currentChatId);
      return next;
    });
  };

  // When auto-approve is on for the currently open chat, run the approval
  // the instant it arrives instead of waiting for a click. `pendingApproval`
  // is only ever set for the chat that's currently visible (see callAgent),
  // so gating on autoApproveChatIds.has(currentChatId) is sufficient to keep
  // this strictly scoped to "this chat" — switching or reloading clears both
  // the pending approval and (on reload) the toggle itself.
  useEffect(() => {
    if (!pendingApproval || pendingApproval.executed) return;
    if (!autoApproveChatIds.has(currentChatId)) return;
    if (loadingChatId === currentChatId) return; // already executing
    handleApproveTool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApproval, currentChatId, autoApproveChatIds, loadingChatId]);

  // Hoisted to component scope (not just inside the messages .map() below) so
  // the live-streaming bubble can reuse it too — it doesn't depend on
  // per-turn data, only the markdown string being rendered.
  // File-type presentation for the download cards below — extend this if
  // generate_* tools ever start producing other extensions.
  const DOWNLOAD_FILE_TYPES: Record<string, { icon: string; label: string }> = {
    docx: { icon: '📄', label: 'Word Document' },
    doc: { icon: '📄', label: 'Word Document' },
    xlsx: { icon: '📊', label: 'Excel Spreadsheet' },
    xls: { icon: '📊', label: 'Excel Spreadsheet' },
    csv: { icon: '📊', label: 'CSV File' },
    pptx: { icon: '📽️', label: 'PowerPoint Presentation' },
    ppt: { icon: '📽️', label: 'PowerPoint Presentation' },
    pdf: { icon: '📕', label: 'PDF Document' },
  };

  const renderMarkdown = (content: string) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      a: ({node, href, children, ...props}) => {
        // Ornith always attaches generated docx/xlsx/pptx files as a plain
        // markdown link to /api/download?file=... (see office.ts). Render
        // those as an obvious, clickable file-attachment card — like
        // ChatGPT/Claude/Gemini do — instead of a plain line of link text
        // buried in the reply.
        if (typeof href === 'string' && href.startsWith('/api/download?file=')) {
          let filename = 'file';
          try {
            filename = decodeURIComponent(href.split('file=')[1]?.split('&')[0] || 'file');
          } catch { /* keep fallback */ }
          const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
          const fileType = DOWNLOAD_FILE_TYPES[ext] || { icon: '📎', label: ext ? `${ext.toUpperCase()} File` : 'File' };

          return (
            <a href={href} download={filename} className={`${styles.fileCard} ${styles.fileCardIsDownload}`}>
              <span className={styles.fileCardIcon}>{fileType.icon}</span>
              {/* This whole card renders inside markdown's <p>/<a>, which the
                  HTML spec restricts to phrasing content only — a <div> here
                  (valid for the canvas-tool file cards below, which sit
                  outside any <p>) triggers a hydration error. <span> with
                  display:flex renders identically and stays valid. */}
              <span className={styles.fileCardInfo}>
                <span className={styles.fileCardName}>{filename}</span>
                <span className={styles.fileCardMeta}>{fileType.label} · Klik untuk download</span>
              </span>
              <span className={styles.fileCardDownload}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </span>
            </a>
          );
        }
        return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
      },
      code: ({node, className, children, ...props}: any) => {
        const isBlock = className?.includes('language-');
        return isBlock
          ? <pre className={styles.mdCodeBlock}><code className={className} {...props}>{children}</code></pre>
          : <code className={styles.mdInlineCode} {...props}>{children}</code>;
      }
    }}>{content}</ReactMarkdown>
  );

  // Sidebar: filter by the search box, then bucket into Pinned / Today /
  // Yesterday / Previous 7 Days / Older using each chat's updatedAt. Recomputes
  // only when the chat list or the search text actually changes.
  //
  // The search matches more than the chat title — like Gemini/ChatGPT/Claude's
  // history search, it also matches inside message content (both what I
  // typed and what Ornith replied). GET /api/chats already sends every
  // chat's full message array to the client (that's chatList), so this is a
  // client-side scan — no new endpoint needed. Vision markers are stripped
  // first so a search term never "matches" inside embedded base64 image data.
  const historyGroups = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    let filtered = chatList;

    if (q) {
      filtered = chatList
        .map((c) => {
          const title = c.title || "New Chat";
          if (title.toLowerCase().includes(q)) {
            return { ...c, _matchSnippet: null as string | null };
          }
          const messages = Array.isArray(c.messages) ? c.messages : [];
          for (const m of messages) {
            const text = getMessageSearchText(m);
            if (text.toLowerCase().includes(q)) {
              return { ...c, _matchSnippet: buildMatchSnippet(text, q) };
            }
          }
          return null;
        })
        .filter((c): c is any => c !== null);
    }

    const pinned = filtered.filter(c => c.isPinned);
    const rest = filtered.filter(c => !c.isPinned);

    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday - 86400000;
    const startOfWeek = startOfToday - 7 * 86400000;

    const today: any[] = [], yesterday: any[] = [], week: any[] = [], older: any[] = [];
    for (const c of rest) {
      const t = c.updatedAt || 0;
      if (t >= startOfToday) today.push(c);
      else if (t >= startOfYesterday) yesterday.push(c);
      else if (t >= startOfWeek) week.push(c);
      else older.push(c);
    }

    const groups: { label: string; items: any[] }[] = [];
    if (pinned.length) groups.push({ label: "Pinned", items: pinned });
    if (today.length) groups.push({ label: "Today", items: today });
    if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
    if (week.length) groups.push({ label: "Previous 7 Days", items: week });
    if (older.length) groups.push({ label: "Older", items: older });
    return groups;
  }, [chatList, historySearch]);

  const renderHistoryItem = (c: any) => (
    <div key={c.id} className={`${styles.historyItem} ${c.id === currentChatId ? styles.active : ''}`}>
      {editingChatId === c.id ? (
        <input
          autoFocus
          className={styles.editInput}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={() => {
            if (editTitle.trim() && editTitle !== c.title) {
              handleUpdateChat(c.id, { title: editTitle.trim() });
            }
            setEditingChatId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (editTitle.trim() && editTitle !== c.title) {
                handleUpdateChat(c.id, { title: editTitle.trim() });
              }
              setEditingChatId(null);
            } else if (e.key === 'Escape') {
              setEditingChatId(null);
            }
          }}
        />
      ) : (
        <a
          href="#"
          className={styles.historyLink}
          onClick={(e) => { e.preventDefault(); selectChat(c.id); }}
          title={c.title}
        >
          <span className={styles.historyLinkTitle}>
            {c.isPinned && <span className={styles.pinIcon}>📌</span>}
            <span className={styles.historyLinkTitleText}>
              {highlightMatch(c.title || "New Chat", historySearch.trim())}
            </span>
            {loadingChatId === c.id && <span className={styles.titleSpinner}></span>}
          </span>
          {/* Only set when the match came from inside a message rather than
              the title — a short preview so it's clear *why* this chat
              matched, same as Gemini/ChatGPT/Claude's history search. */}
          {c._matchSnippet && (
            <span className={styles.historySnippet}>
              {highlightMatch(c._matchSnippet, historySearch.trim())}
            </span>
          )}
        </a>
      )}

      {!editingChatId && (
        <div className={`${styles.menuContainer} ${activeMenuId === c.id ? styles.menuOpen : ''}`}>
          <button
            className={`${styles.menuDotsBtn} ${activeMenuId === c.id ? styles.activeDots : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (activeMenuId === c.id) {
                setActiveMenuId(null);
              } else {
                const rect = e.currentTarget.getBoundingClientRect();
                setMenuPos({ top: rect.top, left: rect.right + 8 });
                setActiveMenuId(c.id);
              }
            }}
          >
            ⋮
          </button>
          {activeMenuId === c.id && (
            <>
              <div className={styles.menuOverlay} onClick={(e) => { e.stopPropagation(); setActiveMenuId(null); }} />
              <div className={styles.dropdownMenu} style={{ top: menuPos.top, left: menuPos.left }}>
                <button onClick={(e) => { e.stopPropagation(); setEditTitle(c.title || "New Chat"); setEditingChatId(c.id); setActiveMenuId(null); }}>
                  <svg className={styles.menuIcon} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                  Ganti Nama
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleUpdateChat(c.id, { isPinned: !c.isPinned }); setActiveMenuId(null); }}>
                  <svg className={styles.menuIcon} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.6V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.6a2 2 0 0 1-1.11 1.95l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
                  {c.isPinned ? "Lepas Sematan" : "Sematkan"}
                </button>
                <button className={styles.dangerText} onClick={(e) => { e.stopPropagation(); handleDeleteChat(c.id); setActiveMenuId(null); }}>
                  <svg className={styles.menuIcon} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  Hapus
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <main className={`${styles.main} ${!isSidebarOpen ? styles.sidebarClosed : ''} ${activeCanvas ? styles.hasCanvas : ''}`}>
      <aside className={`${styles.sidebar} ${!isSidebarOpen ? styles.hidden : ''}`}>
        <div className={styles.sidebarHeader}>
          <button 
            className={styles.sidebarToggle} 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title="Tutup Sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </button>
          <h2>Agentic Studio</h2>
          <button
            className={styles.sidebarToggle}
            onClick={openSettings}
            title="Settings"
            style={{ marginLeft: 'auto' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>

        <div className={styles.newChatWrapper}>
          <button className={styles.newChatBtn} onClick={createNewChat}>
             + New Chat
          </button>
        </div>

        <nav className={styles.nav}>
          <div className={styles.historySearchWrapper}>
            <svg className={styles.historySearchIcon} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input
              className={styles.historySearchInput}
              placeholder="Search chats…"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
            {historySearch && (
              <button
                className={styles.historySearchClear}
                onClick={() => setHistorySearch("")}
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className={styles.historyList} onScroll={() => setActiveMenuId(null)}>
            {historyGroups.length === 0 ? (
              <div className={styles.historyEmptyState}>
                {historySearch ? `No chats matching "${historySearch}"` : "No chats yet"}
              </div>
            ) : (
              historyGroups.map(group => (
                <div key={group.label} className={styles.historyGroup}>
                  <div className={styles.historyGroupLabel}>{group.label}</div>
                  {group.items.map(renderHistoryItem)}
                </div>
              ))
            )}
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          <Link href="/" className={styles.backLink}>← Back to Hub</Link>
        </div>
      </aside>
      
      <section className={styles.chatArea}>
        <header className={styles.chatHeader}>
          <div className={styles.chatHeaderLeft}>
            {!isSidebarOpen && (
              <button 
                className={styles.sidebarToggle} 
                onClick={() => setIsSidebarOpen(true)}
                title="Buka Sidebar"
                style={{ position: 'relative', top: 'unset', left: 'unset' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="9" y1="3" x2="9" y2="21"></line>
                </svg>
              </button>
            )}
            <h3>Current Workspace</h3>
          </div>
          <div className={styles.chatHeaderRight}>
            {(() => {
              // Only shown while something is actually happening — thinking,
              // waiting on you, or executing. No badge at all when idle: a
              // permanent "Ready"/"Local Mode" label sitting in the header
              // doing nothing is exactly the kind of noise Bilal asked to
              // cut, and it adds nothing a returning user needs to know.
              const agentStatus: 'idle' | 'thinking' | 'waiting' | 'executing' = pendingApproval
                ? (loadingChatId === currentChatId ? 'executing' : 'waiting')
                : (loadingChatId === currentChatId ? 'thinking' : 'idle');

              if (agentStatus === 'idle') return null;

              const badgeClass =
                agentStatus === 'thinking' ? styles.agentStatusThinking :
                agentStatus === 'waiting' ? styles.agentStatusWaiting :
                styles.agentStatusExecuting;

              const label =
                agentStatus === 'thinking' ? (streamingStatus || 'Berpikir...') :
                agentStatus === 'waiting' ? 'Menunggu persetujuanmu' :
                'Menjalankan aksi...';

              const title =
                agentStatus === 'thinking' ? 'Ornith sedang berpikir / menjalankan tool — masih berjalan.' :
                agentStatus === 'waiting' ? 'Ornith berhenti sejenak menunggu kamu klik Approve/Deny di bawah.' :
                'Menjalankan aksi yang baru saja kamu setujui...';

              return (
                <span className={`${styles.agentStatusBadge} ${badgeClass}`} title={title}>
                  {label}
                </span>
              );
            })()}
            <button
              type="button"
              className={`${styles.autoApproveToggle} ${isAutoApproveOn ? styles.autoApproveToggleOn : ''}`}
              onClick={toggleAutoApprove}
              title="Saat AKTIF, semua aksi berisiko (jalankan perintah, tulis/edit file, dll) di chat ini akan langsung dijalankan tanpa menunggu kamu klik Approve. Hanya berlaku untuk chat yang sedang dibuka ini, dan otomatis mati lagi kalau kamu reload halaman."
            >
              <span className={styles.autoApproveSwitch}></span>
              Auto-Approve{isAutoApproveOn ? ' (chat ini)' : ''}
            </button>
          </div>
        </header>
        
        <div className={styles.messagesContainer} ref={messagesContainerRef} onScroll={handleMessagesScroll}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <h1>What are we working on?</h1>
              <p>Pick a starting point, or just start typing below.</p>
              <div className={styles.starterGrid}>
                {STARTER_PROMPTS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    className={styles.starterCard}
                    onClick={() => {
                      setInput(s.prompt);
                      textareaRef.current?.focus();
                    }}
                  >
                    <span className={styles.starterIcon}>{s.icon}</span>
                    <span className={styles.starterText}>
                      <span className={styles.starterTitle}>{s.title}</span>
                      <span className={styles.starterPrompt}>{s.prompt}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.messageList}>
              {(() => {
                // ── Group messages into "turns" ──
                // Each turn = { userMsg, intermediates: [], finalMsg }
                // Intermediates = all assistant + tool messages before the final assistant text reply
                type Turn = {
                  userMsg: any;
                  userIdx: number;
                  intermediates: { msg: any; idx: number }[];
                  finalMsg: any | null;
                  finalIdx: number | null;
                };

                const turns: Turn[] = [];
                let i = 0;

                // Skip leading system messages
                while (i < messages.length && messages[i].role === 'system' && messages[i].type !== 'context_summary') i++;

                while (i < messages.length) {
                  const msg = messages[i];

                  // Context summary blocks render standalone
                  if (msg.role === 'system' && msg.type === 'context_summary') {
                    turns.push({ userMsg: null, userIdx: -1, intermediates: [{ msg, idx: i }], finalMsg: null, finalIdx: null });
                    i++;
                    continue;
                  }

                  if (msg.role === 'user') {
                    const turn: Turn = { userMsg: msg, userIdx: i, intermediates: [], finalMsg: null, finalIdx: null };
                    i++;

                    // Collect everything until next user message or end
                    while (i < messages.length && messages[i].role !== 'user') {
                      const cur = messages[i];

                      // Skip system/tool with name=system
                      if (cur.role === 'system' || (cur.role === 'tool' && cur.name === 'system')) { i++; continue; }

                      // Check if this assistant message is the FINAL one
                      // (no tool or assistant-tool-call after it before next user msg)
                      if (cur.role === 'assistant' && cur.content) {
                        let isIntermediate = false;
                        for (let j = i + 1; j < messages.length; j++) {
                          const nx = messages[j];
                          if (nx.role === 'user') break;
                          if (nx.role === 'tool' || (nx.role === 'assistant' && nx.tool_calls && !nx.content)) {
                            isIntermediate = true; break;
                          }
                        }
                        if (isIntermediate) {
                          turn.intermediates.push({ msg: cur, idx: i });
                        } else {
                          turn.finalMsg = cur;
                          turn.finalIdx = i;
                          i++;
                          break;
                        }
                      } else {
                        turn.intermediates.push({ msg: cur, idx: i });
                      }
                      i++;
                    }

                    turns.push(turn);
                  } else {
                    i++;
                  }
                }

                // ── Render turns ──
                return turns.map((turn, tIdx) => {
                  // Context summary standalone
                  if (!turn.userMsg && turn.intermediates.length === 1 && turn.intermediates[0].msg.type === 'context_summary') {
                    const cm = turn.intermediates[0].msg;
                    return (
                      <div key={`cs-${tIdx}`} className={styles.summaryBlock}>
                        <span className={styles.summaryIcon}>🗜️</span>
                        <div className={styles.summaryContent}>
                          <strong>Context Compacted</strong>
                          <p>{cm.content.replace("PREVIOUS CONTEXT SUMMARY:\n", "")}</p>
                        </div>
                      </div>
                    );
                  }

                  const userMsg = turn.userMsg;
                  const intermediates = turn.intermediates;
                  const finalMsg = turn.finalMsg;

                  const toolsUsed = intermediates.filter(({ msg }) => msg.role === 'tool' && msg.name).map(({ msg }) => msg.name as string);
                  const uniqueTools = Array.from(new Set(toolsUsed));
                  const toolCount = uniqueTools.length;
                  const toolLabel = toolCount > 0 ? (toolCount === 1 ? `Used ${uniqueTools[0]}` : `Used ${toolCount} tools`) : 'Working...';

                  const canvasToolNames = ['open_code_editor','create_live_preview','write_rich_document','draw_diagram','render_spreadsheet','create_graphic_canvas'];
                  let canvasToolCalls: any[] = [];
                  for (const { msg } of intermediates) {
                    if (msg.role === 'assistant' && msg.tool_calls) {
                      canvasToolCalls = [...canvasToolCalls, ...msg.tool_calls.filter((tc: any) => canvasToolNames.includes(tc.function.name))];
                    }
                  }
                  if (finalMsg?.tool_calls) {
                    canvasToolCalls = [...canvasToolCalls, ...finalMsg.tool_calls.filter((tc: any) => canvasToolNames.includes(tc.function.name))];
                  }
                  const hasSavePreference = toolsUsed.includes('save_preference');
                  const otherTools = Array.from(new Set(toolsUsed.filter((t: string) => t !== 'save_preference' && !canvasToolNames.includes(t))));

                  return (
                    <div key={`turn-${tIdx}`} style={{display:'contents'}}>
                      {/* User bubble */}
                      {userMsg && (
                        <div className={`${styles.messageWrapper} ${styles.user}`} onMouseEnter={() => setHoveredMsgIdx(turn.userIdx)} onMouseLeave={() => setHoveredMsgIdx(null)}>
                          <div className={styles.messageContent}>
                            {editingMsgIdx === turn.userIdx ? (
                              <div style={{ width: '100%', maxWidth: '520px', marginLeft: 'auto' }}>
                                <textarea value={editingText} onChange={e => setEditingText(e.target.value)} rows={Math.max(2, editingText.split('\n').length + 1)} autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmitEdit(turn.userIdx); if (e.key === 'Escape') handleCancelEdit(); }}
                                  style={{ width:'100%', background:'hsl(var(--muted))', border:'1.5px solid hsl(var(--ring))', borderRadius:'1rem', color:'hsl(var(--foreground))', padding:'10px 14px', fontSize:'14px', resize:'vertical', fontFamily:'inherit', outline:'none', lineHeight:'1.5' }}
                                />
                                <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'8px' }}>
                                  <button onClick={handleCancelEdit} className={styles.actionLabel}>Batal</button>
                                  <button onClick={() => handleSubmitEdit(turn.userIdx)} disabled={!editingText.trim()} style={{ background:'hsl(var(--primary))', border:'none', color:'hsl(var(--primary-foreground))', padding:'5px 16px', borderRadius:'999px', cursor:'pointer', fontSize:'13px', fontWeight:600, opacity:editingText.trim()?1:0.5 }}>Kirim Ulang ↑</button>
                                </div>
                              </div>
                            ) : (
                              <div className={styles.bubble}>
                                <div className={styles.chatImageGrid}>
                                  {userMsg.imagePreviews && userMsg.imagePreviews.map((url: string, i: number) => (
                                    <img key={`ip-${i}`} src={url} alt="Uploaded" className={`${styles.chatImage} ${styles.clickableImage}`} onClick={() => setPreviewModalImage(url)} />
                                  ))}
                                  {!userMsg.imagePreviews && userMsg.imagePreview && (
                                    <img src={userMsg.imagePreview} alt="Uploaded" className={`${styles.chatImage} ${styles.clickableImage}`} onClick={() => setPreviewModalImage(userMsg.imagePreview)} />
                                  )}
                                  {!userMsg.imagePreviews && !userMsg.imagePreview && userMsg.images && userMsg.images.map((base64: string, i: number) => (
                                    <img key={`ib-${i}`} src={`data:image/jpeg;base64,${base64}`} alt="Uploaded" className={`${styles.chatImage} ${styles.clickableImage}`} onClick={() => setPreviewModalImage(`data:image/jpeg;base64,${base64}`)} />
                                  ))}
                                </div>
                                <div className={styles.markdownContent}>{renderMarkdown((userMsg.content || '').replace(/(\n\n|\n)?\[VISION_DATA:[\s\S]*?\]/g, '').replace(/(\n\n|\n)?\[VISION_CONTEXT:[\s\S]*?\]/g, '').trim())}</div>
                              </div>
                            )}
                            {!loadingChatId && editingMsgIdx !== turn.userIdx && (
                              <div className={`${styles.msgActions} ${hoveredMsgIdx === turn.userIdx ? styles.show : ''}`}>
                                <button className={styles.actionIcon} title="Salin" onClick={() => navigator.clipboard.writeText((userMsg.content || '').replace(/(\n\n|\n)?\[VISION_DATA:[\s\S]*?\]/g, '').replace(/(\n\n|\n)?\[VISION_CONTEXT:[\s\S]*?\]/g, '').trim()).catch(()=>{})}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                                <button className={styles.actionIcon} title="Edit pesan" onClick={() => { setEditingMsgIdx(turn.userIdx); setEditingText((userMsg.content || '').replace(/(\n\n|\n)?\[VISION_DATA:[\s\S]*?\]/g, '').replace(/(\n\n|\n)?\[VISION_CONTEXT:[\s\S]*?\]/g, '').trim()); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Grouped intermediates — single collapsible block */}
                      {intermediates.length > 0 && (
                        <div className={`${styles.messageWrapper} ${styles.agent}`} style={{padding: '2px 0'}}>
                          <div className={styles.messageContent}>
                            <details className={styles.turnTraceGroup}>
                              <summary className={styles.turnTraceSummary}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.turnTraceChevron}><polyline points="9 18 15 12 9 6"/></svg>
                                <span>{toolLabel}</span>
                              </summary>
                              <div className={styles.turnTraceBody}>
                                {intermediates.map(({ msg, idx: mIdx }) => {
                                  if (msg.role === 'tool') {
                                    return (
                                      <div key={mIdx} className={styles.traceItem}>
                                        <span className={styles.traceIcon}>🔧</span>
                                        <span className={styles.traceTool}>{msg.name}</span>
                                        <details className={styles.traceResultInline}>
                                          <summary className={styles.traceResultToggle}>output</summary>
                                          <pre className={styles.traceResult}>{typeof msg.content === 'string' && msg.content.length > 2000 ? msg.content.substring(0, 2000) + '\n...[dipotong]' : msg.content}</pre>
                                        </details>
                                      </div>
                                    );
                                  }
                                  if (msg.role === 'assistant' && msg.tool_calls && !msg.content) {
                                    return (msg.tool_calls as any[]).map((tc: any, tcI: number) => (
                                      <div key={`${mIdx}-${tcI}`} className={styles.traceItem}>
                                        <span className={styles.traceIcon}>⚡</span>
                                        <span className={styles.traceTool}>{tc.function?.name}</span>
                                      </div>
                                    ));
                                  }
                                  if (msg.role === 'assistant' && msg.content) {
                                    return (
                                      <div key={mIdx} className={styles.traceItem}>
                                        <span className={styles.traceIcon}>💭</span>
                                        <span className={styles.traceLabel} style={{fontStyle:'italic'}}>{(msg.content as string).substring(0, 80)}{(msg.content as string).length > 80 ? '...' : ''}</span>
                                      </div>
                                    );
                                  }
                                  return null;
                                })}
                              </div>
                            </details>
                          </div>
                        </div>
                      )}

                      {/* Final assistant response */}
                      {finalMsg && (
                        <div className={`${styles.messageWrapper} ${styles.agent} ${finalMsg.compacted ? styles.compactedMessage : ''}`} onMouseEnter={() => setHoveredMsgIdx(turn.finalIdx!)} onMouseLeave={() => setHoveredMsgIdx(null)}>
                          <div className={styles.messageContent}>
                            <div className={styles.bubble}>
                              <div className={styles.markdownContent}>{renderMarkdown(finalMsg.content || '')}</div>
                              {canvasToolCalls.map((tc: any, tcIdx: number) => {
                                let args: any = {};
                                try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch(e) { return null; }
                                const iconMap: Record<string,string> = { open_code_editor:'📄', create_live_preview:'🌐', write_rich_document:'📝', draw_diagram:'📊', render_spreadsheet:'📈', create_graphic_canvas:'📊' };
                                const labelMap: Record<string,string> = { open_code_editor:`${args.language||'code'} · Klik untuk buka`, create_live_preview:'HTML · Klik untuk buka preview', write_rich_document:'Rich Document · Klik untuk buka', draw_diagram:'Mermaid Diagram · Klik untuk buka', render_spreadsheet:'Spreadsheet Interaktif · Klik untuk buka', create_graphic_canvas:'Chart Interaktif · Klik untuk buka' };
                                const canvasDataMap: Record<string,any> = {
                                  open_code_editor: { type:'code', filename:args.filename, language:args.language, content:args.code_content },
                                  create_live_preview: { type:'preview', content:args.html_content },
                                  write_rich_document: { type:'document', title:args.title, content:args.content },
                                  draw_diagram: { type:'diagram', title:args.title, content:args.code||args.diagram_code||args.mermaid_code||args.content||'' },
                                  render_spreadsheet: { type:'spreadsheet', title:args.title, content:args.data||args.table_data||'[]' },
                                  create_graphic_canvas: { type:'chart', title:args.title||'Chart', content:JSON.stringify({chart_type:args.chart_type||'bar',labels:Array.isArray(args.labels)?JSON.stringify(args.labels):(args.labels||'[]'),datasets:Array.isArray(args.datasets)?JSON.stringify(args.datasets):(args.datasets||'[]')}) },
                                };
                                const cd = canvasDataMap[tc.function.name];
                                if (!cd) return null;
                                return (
                                  <div key={tcIdx} className={styles.fileCard} onClick={() => setActiveCanvas(cd as any)}>
                                    <span className={styles.fileCardIcon}>{iconMap[tc.function.name]}</span>
                                    <div className={styles.fileCardInfo}>
                                      <span className={styles.fileCardName}>{args.filename||args.title||tc.function.name}</span>
                                      <span className={styles.fileCardMeta}>{labelMap[tc.function.name]}</span>
                                    </div>
                                  </div>
                                );
                              })}
                              {hasSavePreference && <div className={styles.rememberBadge}>✨ Ornith akan mengingat preferensi ini</div>}
                            </div>
                            <div className={`${styles.msgActions} ${hoveredMsgIdx === turn.finalIdx ? styles.show : ''}`}>
                              <button className={styles.actionIcon} title="Suka">👍</button>
                              <button className={styles.actionIcon} title="Tidak suka">👎</button>
                              <button className={styles.actionIcon} title="Salin" onClick={() => navigator.clipboard.writeText(finalMsg.content||'').catch(()=>{})}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                              <button className={styles.actionIcon} title="Ulangi" disabled={!!loadingChatId} onClick={() => handleRegenerate(turn.finalIdx!)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {pendingApproval && (() => {
                const APPROVAL_TITLES: Record<string, string> = {
                  run_terminal_command: 'Ornith wants to run a terminal command:',
                  write_local_file: 'Ornith wants to write a file:',
                  edit_local_file: 'Ornith wants to edit a file:',
                };
                const title = APPROVAL_TITLES[pendingApproval.name]
                  || (typeof pendingApproval.name === 'string' && pendingApproval.name.startsWith('mcp__')
                    ? `Ornith wants to call MCP tool "${pendingApproval.name.replace(/^mcp__/, '').replace('__', ' → ')}":`
                    : `Ornith wants to run "${pendingApproval.name}":`);

                let preview: React.ReactNode;
                if (pendingApproval.name === 'run_terminal_command') {
                  preview = <pre><code>{pendingApproval.args?.command || JSON.stringify(pendingApproval.args)}</code></pre>;
                } else if (pendingApproval.name === 'write_local_file') {
                  const content = typeof pendingApproval.args?.content === 'string' ? pendingApproval.args.content : '';
                  const shown = content.length > 2000 ? content.slice(0, 2000) + '\n...[truncated for preview]...' : content;
                  preview = (
                    <div>
                      <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>📄 {pendingApproval.args?.filepath}</div>
                      <pre><code>{shown || '(empty file)'}</code></pre>
                    </div>
                  );
                } else if (pendingApproval.name === 'edit_local_file') {
                  preview = (
                    <div>
                      <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>📄 {pendingApproval.args?.filepath}</div>
                      <pre style={{ background: 'rgba(239,68,68,0.12)', borderLeft: '3px solid #ef4444', margin: '0 0 4px 0' }}><code>- {pendingApproval.args?.old_string}</code></pre>
                      <pre style={{ background: 'rgba(34,197,94,0.12)', borderLeft: '3px solid #22c55e', margin: 0 }}><code>+ {pendingApproval.args?.new_string}</code></pre>
                    </div>
                  );
                } else {
                  preview = <pre><code>{JSON.stringify(pendingApproval.args, null, 2)}</code></pre>;
                }

                return (
                  <div className={`${styles.messageWrapper} ${styles.agent}`}>
                    <div className={styles.messageContent}>
                      <div className={styles.hitlBox}>
                        <h4>{title}</h4>
                        {preview}
                        {loadingChatId === currentChatId ? (
                          <div className={styles.hitlActions}>
                            <button className={styles.approveBtn} disabled style={{opacity: 0.7}}>⏳ Executing...</button>
                          </div>
                        ) : (
                          <div className={styles.hitlActions}>
                            <button className={styles.approveBtn} onClick={handleApproveTool}>Approve</button>
                            <button className={styles.denyBtn} onClick={handleDenyTool}>Deny</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {loadingChatId === currentChatId && !pendingApproval && (
                <div className={`${styles.messageWrapper} ${styles.agent}`}>
                  <div className={styles.messageContent}>
                    <div className={styles.bubble}>
                      {streamingText ? (
                        <div className={styles.markdownContent}>{renderMarkdown(streamingText)}</div>
                      ) : (
                        <span className={styles.thinkingIndicator}>
                          {streamingStatus || 'Thinking'}
                          <span className={styles.thinkingDots}>
                            <span></span><span></span><span></span>
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {showScrollToBottom && (
          <button
            className={styles.scrollToBottomBtn}
            onClick={scrollToBottom}
            title="Scroll to latest message"
            aria-label="Scroll to latest message"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
          </button>
        )}

        <div className={styles.inputArea}>
          <div className={styles.inputWrapper}>
            {slashMenuOpen && filteredSlashCommands.length > 0 && (() => {
              // Group while preserving SLASH_COMMANDS' own category order,
              // rather than sorting alphabetically — Files & Code first,
              // Chat-level actions last, matching how a user reaches for them.
              const categories: string[] = [];
              const byCategory = new Map<string, SlashCommand[]>();
              for (const c of filteredSlashCommands) {
                if (!byCategory.has(c.category)) {
                  categories.push(c.category);
                  byCategory.set(c.category, []);
                }
                byCategory.get(c.category)!.push(c);
              }
              let flatIndex = -1;
              return (
                <div className={styles.slashMenu} role="listbox">
                  {categories.map((cat) => (
                    <div key={cat} className={styles.slashMenuGroup}>
                      <div className={styles.slashMenuGroupLabel}>{cat}</div>
                      {byCategory.get(cat)!.map((cmd) => {
                        flatIndex += 1;
                        const idx = flatIndex;
                        return (
                          <button
                            key={cmd.command}
                            type="button"
                            role="option"
                            aria-selected={idx === slashActiveIndex}
                            className={`${styles.slashMenuItem} ${idx === slashActiveIndex ? styles.slashMenuItemActive : ""}`}
                            onMouseEnter={() => setSlashActiveIndex(idx)}
                            onClick={() => applySlashCommand(cmd)}
                          >
                            <span className={styles.slashMenuIcon}>{cmd.icon}</span>
                            <span className={styles.slashMenuCommand}>{cmd.command}</span>
                            <span className={styles.slashMenuLabel}>{cmd.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })()}
            {attachedFiles.length > 0 && (
              <div className={styles.previewSection} style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '8px 12px' }}>
                {attachedFiles.map((att, i) => (
                  <div 
                    key={i}
                    className={styles.inputImagePreviewContainer}
                    onClick={() => att.type === 'image' ? setPreviewModalImage(att.previewUrl) : null}
                    style={{ position: 'relative', flexShrink: 0, cursor: att.type === 'image' ? 'pointer' : 'default' }}
                  >
                    {att.type === 'image' ? (
                      <img src={att.previewUrl} alt="Selected" className={styles.inputImagePreview} />
                    ) : (
                      <div style={{ width: '80px', height: '80px', background: 'hsl(var(--muted))', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', fontSize: '11px', textAlign: 'center', padding: '4px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        📄 {att.name}
                      </div>
                    )}
                    <button 
                      className={styles.removeImageBtn} 
                      onClick={(e) => { e.stopPropagation(); setAttachedFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.inputRow}>
              <input 
                type="file" 
                multiple
                accept="image/*,.txt,.csv,.json,.js,.ts,.md" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                onChange={handleImageSelect} 
              />
              <button className={styles.attachBtn} onClick={() => fileInputRef.current?.click()} disabled={loadingChatId === currentChatId || pendingApproval !== null}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              </button>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                placeholder="Ask the agent to read a file or run a command… (try /)"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={loadingChatId === currentChatId || pendingApproval !== null}
              />
              {loadingChatId === currentChatId ? (
                <button className={styles.sendBtn} onClick={handleStop} title="Stop generating">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                </button>
              ) : (
                <button className={styles.sendBtn} onClick={handleSend} disabled={(!input.trim() && attachedFiles.length === 0) || pendingApproval !== null}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Canvas Area */}
      {activeCanvas && (() => {
        // ── Step 1: Apply all auto-fixes to the raw content first ──
        let fixedDiagramContent = activeCanvas.content ?? '';

        if (activeCanvas.type === 'diagram') {
          // 1a. Strip accidental backtick fences
          fixedDiagramContent = fixedDiagramContent
            .replace(/^```[a-zA-Z]*\n?/m, '')
            .replace(/```\s*$/m, '')
            .trim();

          // Detect venn intent from EITHER the content keyword OR the canvas title
          const titleHasVenn = /venn/i.test(activeCanvas.title ?? '');
          const contentIsVenn = /^\s*(vennDiagram|venn\b)/i.test(fixedDiagramContent);

          // 1b. Use Case diagram: auto-convert usecaseDiagram keyword → graph TD
          if (/^\s*(usecaseDiagram|useCase|UseCaseDiagram|use_case)/i.test(fixedDiagramContent)) {
            fixedDiagramContent = fixedDiagramContent
              .replace(/^\s*(usecaseDiagram|useCase|UseCaseDiagram|use_case)[^\n]*/i, 'graph TD')
              .replace(/^\s*actor\s+(\w[^\n]*)/gim, '  $1(($1))')
              .replace(/^\s*usecase\s+(\w+)\s+as\s+"([^"]+)"/gim, '  $1["$2"]')
              .replace(/^\s*usecase\s+(\w+)/gim, '  $1["$1"]')
              .replace(/^\s*(\w+)\s+-->\s+(\w+)/gim, '  $1 --> $2');
          }

          // 1b-extra. graph TD/LR that is actually a use case diagram (detect from title):
          if (
            /^\s*(graph|flowchart)/i.test(fixedDiagramContent) &&
            /use.?case/i.test(activeCanvas.title ?? '')
          ) {
            fixedDiagramContent = fixedDiagramContent
              // Remove style lines entirely — they conflict with circle node layout in Mermaid v10
              .split('\n')
              .filter(line => !/^\s*style\s+\w+\s+/i.test(line))
              .join('\n')
              // Convert -->|label| to -- label --> (more stable in v10)
              .replace(/-->\|([^|]+)\|/g, '-- $1 -->')
              // Convert edge labels like -- text\n --> fix multiline label breaks
              .replace(/--\s*\|([^|]+)\|/g, '-- $1 -->');
          }

          // 1c. Venn diagram (by keyword) → mark for SVG circle renderer
          if (contentIsVenn) {
            fixedDiagramContent = '__VENN__\n' + fixedDiagramContent;
          }
          // 1c-extra. Venn diagram by TITLE
          else if (titleHasVenn && /^\s*(graph|flowchart)/i.test(fixedDiagramContent)) {
            fixedDiagramContent = '__VENN__\n' + fixedDiagramContent;
          }

          // 1d. C4 variant typos → C4Context
          else if (/^\s*(c4Diagram|C4Model)\b/i.test(fixedDiagramContent)) {
            fixedDiagramContent = fixedDiagramContent
              .replace(/^\s*(c4Diagram|C4Model)[^\n]*/i, 'C4Context');
          }

          // 1e. activityDiagram → flowchart TD
          else if (/^\s*(activityDiagram|activity_diagram)\b/i.test(fixedDiagramContent)) {
            fixedDiagramContent = fixedDiagramContent
              .replace(/^\s*(activityDiagram|activity_diagram)[^\n]*/i, 'flowchart TD');
          }

          // 1f. componentDiagram / deploymentDiagram → graph TD
          else if (/^\s*(componentDiagram|deploymentDiagram|component_diagram|deployment_diagram)\b/i.test(fixedDiagramContent)) {
            fixedDiagramContent = fixedDiagramContent
              .replace(/^\s*(componentDiagram|deploymentDiagram|component_diagram|deployment_diagram)[^\n]*/i, 'graph TD');
          }

          // 1g. stateDiagram without -v2 → add -v2
          else if (/^\s*stateDiagram\s*$/im.test(fixedDiagramContent)) {
            fixedDiagramContent = fixedDiagramContent
              .replace(/^\s*stateDiagram\s*$/im, 'stateDiagram-v2');
          }

          // 1h. graph TD/LR/RL/BT/TB with a reserved-word or stray name on same line → strip it
          fixedDiagramContent = fixedDiagramContent.replace(
            /^(\s*(?:graph|flowchart)\s+(?:TD|LR|RL|BT|TB))\s+\w[\w\s]*$/im,
            '$1'
          );

          // 1j. Subgraph label syntax fix for Mermaid v10:
          fixedDiagramContent = fixedDiagramContent.replace(
            /^(\s*subgraph\s+\S+)\s+\[([^\]]+)\]/gim,
            '$1["$2"]'
          );

          // 1k. ERD: fix invalid attribute types and SQL-isms
          if (/^\s*erDiagram/i.test(fixedDiagramContent)) {
            fixedDiagramContent = fixedDiagramContent
              .replace(/\s*<(?:!--[^>]*>|--[^>]*>|-[^>]*>)/g, '')
              .replace(/\bfloat\b/g, 'decimal')
              .replace(/\bbool\b/g, 'boolean')
              .replace(/\b(?:tinyint|smallint|mediumint)\b/g, 'int')
              .replace(/\b(?:NOT NULL|DEFAULT\s+\S+|AUTO_INCREMENT|AUTOINCREMENT|UNSIGNED)\b/gi, '')
              .replace(/\s{2,}/g, ' ');
          }
        }

        // ── Step 2: Evaluate validity against FIXED content ──
        const isEmpty = activeCanvas.type === 'diagram' && !fixedDiagramContent.trim();
        const isVennDiagram = activeCanvas.type === 'diagram' && fixedDiagramContent.startsWith('__VENN__');
        const VALID_MERMAID_STARTS = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|gitgraph|xychart-beta|quadrantChart|requirementDiagram|journey|block-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|__VENN__)/i;
        const isInvalidDiagram = activeCanvas.type === 'diagram' && !isEmpty && !isVennDiagram && !VALID_MERMAID_STARTS.test(fixedDiagramContent);

        const canvasIcon = isInvalidDiagram ? '⚠️'
          : activeCanvas.type === 'preview' ? '🌐'
          : activeCanvas.type === 'document' ? '📝'
          : activeCanvas.type === 'diagram' ? '🔷'
          : activeCanvas.type === 'spreadsheet' ? '📈'
          : activeCanvas.type === 'chart' ? '📊'
          : activeCanvas.type === 'notebook' ? '📓'
          : '</>';
        const canvasTitle = activeCanvas.title
          || activeCanvas.filename
          || (activeCanvas.type === 'preview' ? 'Live Preview'
            : activeCanvas.type === 'document' ? 'Rich Document'
            : activeCanvas.type === 'diagram' ? 'Diagram'
            : activeCanvas.type === 'spreadsheet' ? 'Spreadsheet'
            : activeCanvas.type === 'chart' ? 'Chart'
            : activeCanvas.type === 'notebook' ? 'Notebook'
            : 'Code Editor');
        const downloadName = activeCanvas.type === 'document'
          ? `${canvasTitle}.md`
          : activeCanvas.type === 'diagram'
          ? `${canvasTitle}.mmd`
          : activeCanvas.type === 'spreadsheet'
          ? `${canvasTitle}.csv`
          : activeCanvas.type === 'chart'
          ? `${canvasTitle}.png`
          : activeCanvas.type === 'notebook'
          ? `${canvasTitle}.json`
          : activeCanvas.filename || (activeCanvas.type === 'preview' ? 'index.html' : 'code.txt');


        // ── Additional type-specific fixes (mindmap, ERD) ──
        const isMindmapDiagram = /^\s*mindmap/i.test(fixedDiagramContent);
        const isERDDiagram     = /^\s*erDiagram/i.test(fixedDiagramContent);

        // 2. Mindmap: strip characters Mermaid treats as shape syntax
        //    () = rounded node, [] = square node, {} = diamond — all break plain text labels
        if (isMindmapDiagram) {
          fixedDiagramContent = fixedDiagramContent
            .split('\n')
            .map(line => {
              // Preserve the "mindmap" keyword line itself
              if (/^\s*mindmap\s*$/i.test(line)) return line;
              // Replace [slug] or [...slug] patterns (common in Next.js paths) with plain text
              let fixed = line.replace(/\[\.\.\.([^\]]+)\]/g, '.$1');  // [...slug] → .slug
              fixed = fixed.replace(/\[([^\]]+)\]/g, '$1');             // [slug] → slug
              // Remove parentheses — () is shape syntax in mindmap
              fixed = fixed.replace(/\(([^)]+)\)/g, '$1');
              fixed = fixed.replace(/[()]/g, '');
              return fixed;
            })
            .join('\n');
        }

        // 3b. ERD: fix invalid relationship cardinality syntax
        //     Qwen often writes: BOOK --||-- BORROW or USER --o-- BORROW
        //     Valid Mermaid ERD format: ENTITY1 ||--|{ ENTITY2 : label
        if (isERDDiagram) {
          fixedDiagramContent = fixedDiagramContent.split('\n').map(line => {
            // Only process lines that look like relationship lines (contain -- but are not inside blocks)
            // Relationship lines pattern: WORD <cardinality> WORD : label
            if (!/^\s*\w/.test(line) || /\{\s*$/.test(line) || /^\s*\}/.test(line)) return line;

            // Fix common invalid cardinality patterns → valid Mermaid ERD cardinality
            // "BOOK --||-- BORROW : has" → "BOOK ||--|| BORROW : has"
            // "USER --o-- BORROW : borrows" → "USER ||--o{ BORROW : borrows"
            let r = line;
            // Normalize: swap --X-- patterns to valid ones
            r = r.replace(/\s--\|\|--\s/g,  ' ||--|| ');   // one-to-one
            r = r.replace(/\s--o--\s/g,     ' ||--o{ ');   // zero-or-more
            r = r.replace(/\s--\|{--\s/g,   ' ||--|{ ');   // one-or-more
            r = r.replace(/\s--o\{--\s/g,   ' }o--o{ ');   // zero-or-more both sides
            // Also fix missing { on right side: "||--o ENTITY" → "||--o{ ENTITY"
            r = r.replace(/\|\|--o(\s)/g,   '||--o{$1');
            r = r.replace(/\|\|--\|(\s)/g,  '||--|{$1');
            return r;
          }).join('\n');
        }

        // 3. ERD: fix attribute lines ONLY inside entity blocks { }
        //    DO NOT touch relationship lines like: CUSTOMER ||--o{ ORDER : places
        if (isERDDiagram) {
          const VALID_ERD_TYPES = new Set([
            'string','int','integer','float','double','boolean','bool',
            'date','datetime','timestamp','bigint','decimal','text',
            'varchar','char','json','uuid','enum','array'
          ]);

          // Split into sections: relationship lines vs entity blocks
          // Only process lines INSIDE { ... } blocks
          const lines = fixedDiagramContent.split('\n');
          const result: string[] = [];
          let insideBlock = false;

          for (const line of lines) {
            // Entity block opener: line ends with "{" (e.g. "CUSTOMER {")
            // NOT relationship lines like "BOOK ||--o{ BORROW : has" which also contain "{"
            if (/\{\s*$/.test(line)) { insideBlock = true; result.push(line); continue; }
            if (/^\s*\}/.test(line))  { insideBlock = false; result.push(line); continue; }

            if (!insideBlock) {
              result.push(line);
              continue;
            }

            // Inside entity block — fix attribute lines
            const trimmed = line.trim();
            if (!trimmed) { result.push(line); continue; }

            let fixedLine = trimmed;
            const indent = line.match(/^(\s*)/)?.[1] ?? '';

            // Fix 1: "primary_key" / "primary key" → "PK", "foreign_key" / "foreign key" → "FK"
            fixedLine = fixedLine.replace(/\bprimary[_ ]key\b/gi, 'PK');
            fixedLine = fixedLine.replace(/\bforeign[_ ]key\b/gi, 'FK');

            // Fix 2: Remove " -> TABLENAME" references (FK target notation, not valid in Mermaid ERD)
            fixedLine = fixedLine.replace(/\s*->\s*\w+/g, '');

            // Fix 3: Remove UNIQUE keyword (not valid in Mermaid ERD syntax)
            fixedLine = fixedLine.replace(/\bUNIQUE\b/g, '').replace(/\s+/g, ' ').trim();

            // Fix 4: Unquoted inline words after valid token become syntax errors.
            //        e.g. "string rating INTEGER 1-5" → keep only first 3 valid tokens (type, name, PK/FK)
            //        Valid token structure: <type> <fieldname> [PK|FK] ["optional comment"]
            // Fix 4: Strip everything after position 3 (type, fieldname, PK/FK optional).
            //        Quoted comments like "active/returned" or "INTEGER 1-5" crash Mermaid
            //        with special chars inside. Safest: keep only type + name + optional key.
            {
              const tokens = fixedLine.split(/\s+/);
              const validTokens: string[] = [];
              for (let ti = 0; ti < tokens.length; ti++) {
                const tok = tokens[ti];
                if (ti === 0) { validTokens.push(tok); continue; }   // type
                if (ti === 1) { validTokens.push(tok); continue; }   // field name
                if (/^(PK|FK|UK)$/i.test(tok)) { validTokens.push(tok); continue; } // key constraint
                // Drop everything else — including quoted comments
                break;
              }
              fixedLine = validTokens.join(' ');
            }

            // Fix 5: Upgrade "date" type → "datetime" for *_at / *_time field names
            {
              const p = fixedLine.split(/\s+/);
              if (p[0]?.toLowerCase() === 'date' && p[1] && /(_at|_date|_time|timestamp)$/i.test(p[1])) {
                p[0] = 'datetime';
                fixedLine = p.join(' ');
              }
            }

            // Fix 6: If first word is NOT a valid type, prepend a guessed one
            {
              const VALID_ERD_TYPES = new Set([
                'string','int','integer','float','double','boolean','bool',
                'date','datetime','timestamp','bigint','decimal','text',
                'varchar','char','json','uuid','enum','array'
              ]);
              const p = fixedLine.split(/\s+/);
              const first = p[0]?.toLowerCase() ?? '';
              if (!VALID_ERD_TYPES.has(first)) {
                let t = 'string';
                if (/^(id$|.*_id$)/i.test(first))                         t = 'int';
                if (/^(price|amount|total|balance|cost|fee)/i.test(first)) t = 'decimal';
                if (/(_at$|_date$|_time$|timestamp$)/i.test(first))        t = 'datetime';
                if (/^(is_|has_|can_|flag)/i.test(first))                  t = 'boolean';
                fixedLine = t + ' ' + fixedLine;
              }
            }

            result.push(indent + fixedLine);
          }

          fixedDiagramContent = result.join('\n');
        }

        // Escape for safe injection into Mermaid HTML
        const escapedContent = fixedDiagramContent
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/`/g, '&#96;');

        // ── Venn Diagram: build SVG-in-HTML srcDoc ──
        const vennDoc = (() => {
          if (!isVennDiagram) return '';
          const rawVenn = fixedDiagramContent.replace(/^__VENN__\n?/, '');
          const vennTitle = activeCanvas.title || 'Venn Diagram';

          // ── Parser A: graph LR/TD with subgraph format (Qwen's preferred output) ──
          const isGraphFormat = /^\s*(graph|flowchart)/i.test(rawVenn);
          const groups: { label: string; items: string[] }[] = [];

          if (isGraphFormat) {
            // Extract each subgraph block: "subgraph Label" or "subgraph ID["Label"]"
            const lines = rawVenn.split('\n');
            let currentGroup: { label: string; items: string[] } | null = null;
            for (const line of lines) {
              const trimmed = line.trim();
              // subgraph start: "subgraph Name" or "subgraph ID["Label"]"
              const subMatch = trimmed.match(/^subgraph\s+(?:\S+\["([^"]+)"\]|"([^"]+)"|(\S+))/i);
              if (subMatch) {
                const lbl = subMatch[1] || subMatch[2] || subMatch[3] || 'Set';
                currentGroup = { label: lbl, items: [] };
                groups.push(currentGroup);
                continue;
              }
              if (/^end\b/i.test(trimmed) && currentGroup) { currentGroup = null; continue; }
              // Node definition inside subgraph: ID["Label"] or ID[Label]
              if (currentGroup) {
                const nodeMatch = trimmed.match(/^\w+\["([^"]+)"\]/) || trimmed.match(/^\w+\[([^\]]+)\]/);
                if (nodeMatch) { currentGroup.items.push(nodeMatch[1]); continue; }
                // plain ID as item
                if (/^\w+$/.test(trimmed) && !/^(graph|flowchart|subgraph|end|style|classDef)$/i.test(trimmed)) {
                  currentGroup.items.push(trimmed);
                }
              }
            }
          } else {
            // ── Parser B: native venn syntax (sets:/SetA: items) ──
            const vLines = rawVenn.split('\n').map((l: string) => l.trim()).filter(Boolean);
            const setsLine = vLines.find((l: string) => /^sets:/i.test(l));
            let setNames: string[] = setsLine
              ? setsLine.replace(/^sets:\s*/i, '').split(',').map((s: string) => s.trim())
              : [];
            // Parse group lines like "React: item1, item2" or "React,Vue: item1"
            for (const l of vLines) {
              if (/^(title|sets:|venn|graph|flowchart)/i.test(l)) continue;
              const m = l.match(/^([^:]+):\s*(.+)$/);
              if (m) {
                const lbl = m[1].trim();
                if (!setNames.includes(lbl)) setNames.push(lbl);
                const items = m[2].split(',').map((s: string) => s.trim()).filter(Boolean);
                groups.push({ label: lbl, items });
              }
            }
          }

          // Fallback: if no groups parsed, render 2 empty circles
          if (groups.length === 0) {
            groups.push({ label: 'Set A', items: [] }, { label: 'Set B', items: [] });
          }

          const COLORS = ['rgba(99,179,237,0.42)','rgba(252,129,74,0.42)','rgba(154,230,180,0.42)','rgba(183,148,246,0.42)'];
          const STROKE = ['#63b3ed','#fc814a','#9ae6b4','#b794f6'];
          const n = Math.min(groups.length, 4);
          const W = 800, H = 500, r = 155;
          // Circle centers — overlapping for visual Venn effect
          const centers: {x:number,y:number}[] = [];
          if (n === 1) { centers.push({x:400,y:250}); }
          else if (n === 2) { centers.push({x:300,y:250},{x:500,y:250}); }
          else if (n === 3) { centers.push({x:265,y:295},{x:535,y:295},{x:400,y:125}); }
          else { centers.push({x:265,y:195},{x:535,y:195},{x:265,y:340},{x:535,y:340}); }

          const svgCircles = centers.slice(0,n).map((c,i) =>
            `<ellipse cx="${c.x}" cy="${c.y}" rx="${r}" ry="${r}" fill="${COLORS[i]}" stroke="${STROKE[i]}" stroke-width="2.5" opacity="0.85"/>`
          ).join('');

          // Set name labels — outer edge of each circle
          const svgLabels = centers.slice(0,n).map((c,i) => {
            const lx = n === 3 && i === 2 ? c.x : (c.x < W/2 ? c.x - r + 35 : c.x + r - 35);
            const ly = n === 3 && i === 2 ? c.y - r + 22 : c.y + (c.y < H/2 ? -r + 22 : r - 18);
            return `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="14" font-weight="700" fill="#f0f0f0" font-family="system-ui,sans-serif">${groups[i].label}</text>`;
          }).join('');

          // Item labels — inside each circle
          const svgItems = centers.slice(0,n).flatMap((c,i) => {
            const items = groups[i].items;
            const total = items.length;
            return items.map((item, ii) =>
              `<text x="${c.x}" y="${c.y - ((total-1)*10) + ii*20}" text-anchor="middle" font-size="11" fill="#f0f0f0" font-family="system-ui,sans-serif" opacity="0.9">${item}</text>`
            );
          }).join('');

          return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#0d0d0d;display:flex;flex-direction:column;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="max-width:100%;max-height:90vh"><rect width="${W}" height="${H}" fill="#0d0d0d"/><text x="${W/2}" y="38" text-anchor="middle" font-size="18" font-weight="700" fill="#e2e8f0" font-family="system-ui,sans-serif">${vennTitle}</text>${svgCircles}${svgLabels}${svgItems}</svg></body></html>`;
        })();

        // Code canvas — inline regex highlighter (CDN-free, always works)
        const codeDoc = (() => {
          if (!activeCanvas || activeCanvas.type !== 'code') return '';
          const lang = (activeCanvas.language || 'plaintext').toLowerCase();
          const filename = activeCanvas.filename || 'code';
          const rawCode = activeCanvas.content || '';
          const rawForCopy = JSON.stringify(rawCode);

          // Custom palette
          const BG = '#1A2B34', TEXT = '#d4dde8', KW_C = '#EA5E5E',
                STR_C = '#56B3B4', CMT_C = '#6a9955', NUM_C = '#b5cea8',
                FN_C = '#F7B93E', TYPE_C = '#9cdcfe', LN_C = '#4a5f6e';

          const fileIcon = lang === 'typescript' || lang === 'ts' ? '🟦'
            : lang === 'javascript' || lang === 'js' ? '🟨'
            : lang === 'python' || lang === 'py' ? '🐍'
            : lang === 'css' || lang === 'scss' ? '🎨'
            : lang === 'html' ? '🌐'
            : lang === 'json' ? '{ }'
            : lang === 'bash' || lang === 'shell' || lang === 'sh' ? '⬛'
            : lang === 'sql' ? '🗄️'
            : '📄';

          function esc(s: string) {
            return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          }
          function sp(c: string, t: string) { return `<span style="color:${c}">${esc(t)}</span>`; }

          const JS_KW = new Set(['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','class','extends','new','this','super','import','export','default','from','async','await','try','catch','finally','throw','typeof','instanceof','in','of','void','delete','yield','static','get','set','public','private','protected','readonly','abstract','interface','type','enum','namespace','declare','implements','as','satisfies','true','false','null','undefined','any','never','unknown','keyof','infer','is']);
          const JS_TYPES = new Set(['string','number','boolean','object','Symbol','BigInt','Array','Promise','Map','Set','Record','Partial','Required','Readonly','Pick','Omit']);

          function jsLine(line: string): string {
            if (/^\s*\/\//.test(line)) return sp(CMT_C, line);
            let out = '', i = 0;
            while (i < line.length) {
              const rest = line.slice(i);
              if (rest.startsWith('//')) { out += sp(CMT_C, rest); break; }
              if (line[i] === '`') {
                let j = i+1; while (j < line.length && line[j] !== '`') { if (line[j] === '\\') j++; j++; }
                out += sp(STR_C, line.slice(i, j+1)); i = j+1; continue;
              }
              if (line[i] === '"' || line[i] === "'") {
                const q = line[i]; let j = i+1;
                while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++; }
                out += sp(STR_C, line.slice(i, j+1)); i = j+1; continue;
              }
              const nm = rest.match(/^-?\d+(\.\d+)?\b/);
              if (nm && (i === 0 || /[\s,(=+\-*\/[{<>!&|?:]/.test(line[i-1]))) {
                out += sp(NUM_C, nm[0]); i += nm[0].length; continue;
              }
              const wm = rest.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
              if (wm) {
                const w = wm[0], after = line[i + w.length];
                if (JS_KW.has(w)) out += sp(KW_C, w);
                else if (JS_TYPES.has(w)) out += sp(TYPE_C, w);
                else if (after === '(') out += sp(FN_C, w);
                else if (/^[A-Z]/.test(w)) out += sp(TYPE_C, w);
                else out += esc(w);
                i += w.length; continue;
              }
              out += esc(line[i]); i++;
            }
            return out;
          }

          function htmlLine(line: string): string {
            if (/^\s*<!--/.test(line)) return sp(CMT_C, line);
            let out = '', i = 0;
            while (i < line.length) {
              if (line[i] === '<') {
                const m = line.slice(i).match(/^(<\/?)([\w-]+)([^>]*?)(\/?>)/);
                if (m) {
                  out += esc(m[1]) + sp(KW_C, m[2]);
                  out += m[3].replace(/([\w-:]+)(=)(["'][^"']*["'])/g,
                    (_: string, a: string, eq: string, v: string) => sp(TYPE_C, a) + esc(eq) + sp(STR_C, v)
                  );
                  out += esc(m[4]); i += m[0].length; continue;
                }
                const dt = line.slice(i).match(/^<!DOCTYPE[^>]*>/i);
                if (dt) { out += sp(KW_C, dt[0]); i += dt[0].length; continue; }
              }
              const plain = line.slice(i).match(/^[^<]+/);
              if (plain) { out += esc(plain[0]); i += plain[0].length; continue; }
              out += esc(line[i]); i++;
            }
            return out;
          }

          function cssLine(line: string): string {
            if (/^\s*\/\*/.test(line)) return sp(CMT_C, line);
            const pv = line.match(/^(\s*)([\w-]+)(\s*:\s*)(.+?)(;?\s*)$/);
            if (pv) return esc(pv[1]) + sp(TYPE_C, pv[2]) + esc(pv[3]) + sp(STR_C, pv[4]) + esc(pv[5]);
            return esc(line).replace(/(@[\w-]+)/g, (m: string) => sp(KW_C, m))
              .replace(/([.#][\w-]+)/g, (m: string) => sp(FN_C, m));
          }

          function jsonLine(line: string): string {
            const km = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:)(.*)/);
            if (km) {
              const val = km[4];
              const vm = val.match(/^\s*("(?:[^"\\]|\\.)*")/);
              const valHtml = vm ? esc(val.slice(0, vm.index ?? 0)) + sp(STR_C, vm[1]) + esc(val.slice((vm.index ?? 0) + vm[1].length))
                : esc(val).replace(/\b(true|false|null)\b/g, (m: string) => sp(KW_C, m))
                           .replace(/\b(-?\d+\.?\d*)\b/g, (m: string) => sp(NUM_C, m));
              return esc(km[1]) + sp(TYPE_C, km[2]) + esc(km[3]) + valHtml;
            }
            return esc(line).replace(/\b(true|false|null)\b/g, (m: string) => sp(KW_C, m))
              .replace(/\b(-?\d+\.?\d*)\b/g, (m: string) => sp(NUM_C, m));
          }

          function pyLine(line: string): string {
            if (/^\s*#/.test(line)) return sp(CMT_C, line);
            const KW = /\b(def|class|import|from|as|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|try|except|finally|with|pass|break|continue|raise|lambda|yield|global|nonlocal|del|assert|async|await)\b/g;
            return esc(line)
              .replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"]*"|'[^']*')/g, (m: string) => sp(STR_C, m))
              .replace(KW, (m: string) => sp(KW_C, m))
              .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, (m: string) => sp(TYPE_C, m))
              .replace(/\b(\d+\.?\d*)\b/g, (m: string) => sp(NUM_C, m))
              .replace(/\b([a-z_]\w*)(?=\s*\()/g, (m: string) => sp(FN_C, m));
          }

          function sqlLine(line: string): string {
            if (/^\s*--/.test(line)) return sp(CMT_C, line);
            const KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|INDEX|VIEW|HAVING|LIMIT|OFFSET|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|DISTINCT|COUNT|SUM|AVG|MIN|MAX|PRIMARY|KEY|FOREIGN|REFERENCES|CASCADE|DEFAULT|CONSTRAINT|UNIQUE|IF|EXISTS|ORDER|GROUP|BY)\b/gi;
            return esc(line)
              .replace(/'([^']*)'/g, (_: string, v: string) => sp(STR_C, "'" + v + "'"))
              .replace(KW, (m: string) => sp(KW_C, m.toUpperCase()))
              .replace(/\b(\d+\.?\d*)\b/g, (m: string) => sp(NUM_C, m))
              .replace(/\b([a-zA-Z_]\w*)(?=\s*\()/g, (m: string) => sp(FN_C, m));
          }

          function tokenizeLine(line: string): string {
            if (lang === 'html' || lang === 'xml') return htmlLine(line);
            if (lang === 'css' || lang === 'scss' || lang === 'less') return cssLine(line);
            if (lang === 'json') return jsonLine(line);
            if (lang === 'python' || lang === 'py') return pyLine(line);
            if (lang === 'sql') return sqlLine(line);
            return jsLine(line);
          }

          const rows = rawCode.split('\n').map((line: string, i: number) =>
            `<tr><td class="ln">${i+1}</td><td class="lc">${tokenizeLine(line) || '\u200B'}</td></tr>`
          ).join('');

          return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;background:${BG};font-family:'Cascadia Code','JetBrains Mono','Fira Code','Consolas','Courier New',monospace;font-size:13.5px;overflow:hidden;color:${TEXT}}
    #tabbar{display:flex;align-items:center;background:#1a1e24;border-bottom:1px solid #111;height:35px;flex-shrink:0}
    .tab{display:flex;align-items:center;gap:6px;padding:0 16px;height:100%;background:${BG};border-right:1px solid #111;border-top:2px solid ${KW_C};font-size:12px;white-space:nowrap}
    .tab-name{color:#e6edf3;font-weight:600}
    .tab-lang{background:#2a3a44;color:${STR_C};font-size:9px;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.8px;margin-left:4px}
    .spacer{flex:1}
    #copy-btn{background:#2a3a44;border:1px solid #3a4d5c;color:#8ba6b8;padding:4px 14px;margin-right:12px;border-radius:5px;cursor:pointer;font-size:11px;font-family:inherit}
    #copy-btn:hover{color:${FN_C};border-color:${FN_C};background:#3a4d5c}
    #copy-btn.ok{color:${STR_C};border-color:${STR_C}}
    #code-wrapper{overflow:auto;height:calc(100vh - 35px);padding:14px 0;background:${BG}}
    table.ct{border-collapse:collapse;width:100%}
    td.ln{width:52px;min-width:52px;padding:0 14px 0 8px;text-align:right;user-select:none;border-right:1px solid #2a3a44;font-size:12px;color:${LN_C};line-height:1.7;vertical-align:top;white-space:nowrap}
    td.lc{padding-left:20px;line-height:1.7;white-space:pre;vertical-align:top;color:${TEXT}}
    tr:hover td.ln{color:#8ba6b8;background:#1e3040}
    tr:hover td.lc{background:#1e3040}
    ::-webkit-scrollbar{width:10px;height:10px}
    ::-webkit-scrollbar-track{background:${BG}}
    ::-webkit-scrollbar-thumb{background:#2e4455;border-radius:5px;border:2px solid ${BG}}
    ::-webkit-scrollbar-thumb:hover{background:#3a5568}
  </style>
</head>
<body>
  <div id="tabbar">
    <div class="tab"><span>${fileIcon}</span><span class="tab-name">${filename}</span><span class="tab-lang">${lang}</span></div>
    <div class="spacer"></div>
    <button id="copy-btn" onclick="copyCode()">Copy</button>
  </div>
  <div id="code-wrapper"><table class="ct"><tbody>${rows}</tbody></table></div>
  <script>
    function copyCode(){var raw=${rawForCopy};var btn=document.getElementById('copy-btn');function done(){btn.textContent='Copied!';btn.classList.add('ok');setTimeout(function(){btn.textContent='Copy';btn.classList.remove('ok');},2000);}try{navigator.clipboard.writeText(raw).then(done);}catch(e){var ta=document.createElement('textarea');ta.value=raw;ta.style.cssText='position:fixed;opacity:0;top:0;left:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e2){}document.body.removeChild(ta);done();}}
  <\/script>
</body>
</html>`;
        })();

        // Mermaid iframe srcDoc — logic is now minimal JS since fixing is done in TS above
        const mermaidDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #0d0d0d; font-family: sans-serif; overflow: hidden; }
    #container { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
    #container svg { width: 100% !important; height: 100% !important; max-width: 100% !important; }
    #error-panel {
      display: none; flex-direction: column; gap: 12px;
      padding: 24px; width: 90%; max-width: 700px; max-height: 85vh; overflow-y: auto;
    }
    #error-panel h3 { color: #ff5555; font-size: 14px; font-family: monospace; margin-bottom: 4px; }
    #error-panel pre {
      background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
      padding: 16px; font-size: 12px; color: #ccc; white-space: pre-wrap; overflow-x: auto;
    }
    #error-panel .err-msg { color: #ff8888; font-size: 12px; font-family: monospace; }
    #error-panel .hint { color: #888; font-size: 11px; line-height: 1.6; margin-top: 4px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
</head>
<body>
  <div id="source" style="display:none;">${escapedContent}</div>
  <div id="container">Loading...</div>
  <div id="error-panel">
    <h3>Diagram Syntax Error</h3>
    <p class="err-msg" id="err-text"></p>
    <p class="hint">Mermaid code that failed:</p>
    <pre id="raw-code"></pre>
    <p class="hint">Tip: Ask Qwen to fix the diagram syntax.</p>
  </div>
  <script>
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    async function render() {
      var src = document.getElementById('source').textContent.trim();
      var container = document.getElementById('container');
      var errPanel  = document.getElementById('error-panel');
      try {
        var result = await mermaid.render('mgraph', src);
        container.innerHTML = result.svg;
        var svg = container.querySelector('svg');
        // Skip pan-zoom for diagram types that produce non-finite SVG transforms
        var skipPanZoom = /^\\s*(gantt|timeline|xychart|pie|quadrantChart|requirementDiagram)/i.test(src);
        if (!skipPanZoom && svg) {
          try {
            svgPanZoom(svg, { zoomEnabled:true, controlIconsEnabled:true, fit:true, center:true, minZoom:0.05, maxZoom:50, zoomScaleSensitivity:0.25 });
          } catch(pzErr) {
            // pan-zoom failed (e.g. non-finite SVGMatrix) — diagram still visible without pan-zoom
            console.warn('svgPanZoom skipped:', pzErr.message);
          }
        } else if (svg) {
          // For gantt/pie/etc — make SVG fill container nicely without pan-zoom
          svg.style.width = '100%';
          svg.style.height = 'auto';
          svg.style.maxWidth = '100%';
        }
      } catch(e) {
        container.style.display = 'none';
        errPanel.style.display = 'flex';
        document.getElementById('err-text').textContent = e.message || String(e);
        document.getElementById('raw-code').textContent = src;
      }
    }
    window.addEventListener('DOMContentLoaded', render);
  </script>
</body>
</html>`;


        // Markdown document iframe srcDoc
        const markdownDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.css">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    body { margin: 0; background: #0d1117; }
    .markdown-body { max-width: 860px; margin: 0 auto; padding: 2rem 2.5rem; box-sizing: border-box; }
  </style>
</head>
<body class="markdown-body">
  <div id="content"></div>
  <script>document.getElementById('content').innerHTML = marked.parse(${JSON.stringify(activeCanvas.content)});</script>
</body>
</html>`;

        // Spreadsheet iframe srcDoc using AG Grid Community via CDN (Tier 2)
        const spreadsheetDoc = (() => {
          const safeData = JSON.stringify(activeCanvas.content ?? '[]');
          const sheetTitle = JSON.stringify(activeCanvas.title || 'Data');
          return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@31/dist/ag-grid-community.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #141414; font-family: -apple-system, sans-serif; display: flex; flex-direction: column; }
    #toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 14px; background: #1a1a1a; border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0; gap: 10px;
    }
    #toolbar .title { color: #e2e8f0; font-size: 13px; font-weight: 600; }
    #toolbar .count { color: #666; font-size: 12px; }
    #toolbar .btns { display: flex; gap: 6px; }
    #toolbar button {
      background: #2a2a2a; border: 1px solid #3a3a3a; color: #aaa;
      padding: 4px 10px; border-radius: 5px; cursor: pointer; font-size: 11px;
      transition: background 0.15s, color 0.15s;
    }
    #toolbar button:hover { background: #3a3a3a; color: #e2e8f0; }
    #grid { flex: 1; min-height: 0; }
    .ag-theme-alpine-dark {
      --ag-background-color: #141414; --ag-header-background-color: #1e1e1e;
      --ag-odd-row-background-color: #181818; --ag-border-color: #2a2a2a;
      --ag-row-hover-color: #252525; --ag-font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <div style="display:flex;align-items:center;gap:10px">
      <span class="title" id="sheet-title"></span>
      <span class="count" id="row-count"></span>
    </div>
    <div class="btns">
      <button onclick="downloadCSV()">⬇ CSV</button>
      <button onclick="downloadExcel()">⬇ Excel</button>
    </div>
  </div>
  <div id="grid" class="ag-theme-alpine-dark"></div>
  <script>
    var sheetTitle = ${sheetTitle};
    document.getElementById('sheet-title').textContent = sheetTitle;
    var raw = ${safeData};
    var rows = [];
    try { rows = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { rows = []; }
    if (!Array.isArray(rows)) rows = [];

    if (rows.length === 0) {
      document.body.innerHTML = '<div style="color:#f59e0b;padding:2rem;font-size:14px;font-family:monospace"><p>⚠ Tidak ada data untuk ditampilkan.</p><p style="color:#666;font-size:12px;margin-top:8px">Qwen mengembalikan data kosong atau format tidak valid.</p></div>';
    } else {
      document.getElementById('row-count').textContent = rows.length + ' baris';
      var headers = Object.keys(rows[0]);

      // Number formatter for numeric / currency columns
      function numFmt(params) {
        var v = params.value;
        var n = Number(v);
        if (v === '' || v === null || v === undefined || isNaN(n)) return v;
        var field = (params.colDef.field || '').toLowerCase();
        if (field.includes('harga') || field.includes('price') || field.includes('total') || field.includes('biaya') || field.includes('gaji')) {
          return new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(n);
        }
        if (n >= 1000) return new Intl.NumberFormat('id-ID').format(n);
        return v;
      }

      var colDefs = headers.map(function(h) {
        return { field: h, sortable: true, resizable: true, filter: true, flex: 1, minWidth: 100, valueFormatter: numFmt };
      });
      var gridApi = agGrid.createGrid(document.getElementById('grid'), {
        columnDefs: colDefs,
        rowData: rows,
        defaultColDef: { sortable: true, resizable: true },
        pagination: rows.length > 50,
        paginationPageSize: 50,
        animateRows: true
      });

      function downloadCSV() {
        gridApi.exportDataAsCsv({ fileName: sheetTitle + '.csv' });
      }
      function downloadExcel() {
        var ws = XLSX.utils.json_to_sheet(rows);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetTitle.substring(0,31));
        XLSX.writeFile(wb, sheetTitle + '.xlsx');
      }
    }
  <\/script>
</body>
</html>`;
        })();

        return (
          <section className={styles.canvasArea}>
            <header className={styles.canvasHeader}>
              <div className={styles.canvasInfo}>
                <span className={styles.canvasIcon}>{canvasIcon}</span>
                <h3>{canvasTitle}</h3>
              </div>
              <div className={styles.canvasActions}>
                {/* Toggle Preview ↔ Code (only for html preview) */}
                {activeCanvas.type === 'preview' && (
                  <div className={styles.canvasToggle}>
                    <button
                      className={`${styles.toggleBtn} ${!activeCanvas.showCode ? styles.toggleActive : ''}`}
                      onClick={() => setActiveCanvas({...activeCanvas, showCode: false})}
                    >🌐 Preview</button>
                    <button
                      className={`${styles.toggleBtn} ${activeCanvas.showCode ? styles.toggleActive : ''}`}
                      onClick={() => setActiveCanvas({...activeCanvas, showCode: true})}
                    >{'</>'} Kode</button>
                  </div>
                )}
                {/* Chart uses its own in-iframe Download PNG button; notebook has no header download */}
                {activeCanvas.type !== 'chart' && activeCanvas.type !== 'notebook' && (
                <button
                  className={styles.downloadBtn}
                  title="Download"
                  onClick={() => {
                    if (activeCanvas.type === 'spreadsheet') {
                      // Download as CSV
                      try {
                        const rows: Record<string, string>[] = JSON.parse(activeCanvas.content);
                        const headers = Object.keys(rows[0]);
                        const csvLines = [
                          headers.join(','),
                          ...rows.map(r => headers.map(h => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
                        ];
                        const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = downloadName; a.click();
                        URL.revokeObjectURL(url);
                      } catch {}
                    } else {
                      const blob = new Blob([activeCanvas.content], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = downloadName; a.click();
                      URL.revokeObjectURL(url);
                    }
                  }}
                >⬇ Download</button>
                )}
                <button className={styles.closeCanvasBtn} onClick={() => setActiveCanvas(null)}>
                  Tutup Canvas
                </button>
              </div>
            </header>

            <div className={styles.canvasContent}>
              {activeCanvas.type === 'code' ? (
                <iframe
                  key={`code-${activeCanvas.filename ?? ''}-${activeCanvas.content?.length ?? 0}`}
                  srcDoc={codeDoc}
                  className={styles.previewIframe}
                  sandbox="allow-scripts allow-same-origin"
                  title="Code Editor"
                />
              ) : (activeCanvas.type === 'preview' && activeCanvas.showCode) ? (
                <iframe
                  key={`preview-code-${activeCanvas.content?.length ?? 0}`}
                  srcDoc={(() => {
                    const _lang = 'html';
                    const _filename = activeCanvas.filename || 'index.html';
                    const _esc = (activeCanvas.content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                    const _raw = JSON.stringify(activeCanvas.content || '');
                    // Custom palette matching codeDoc: #1A2B34 bg, #EA5E5E keywords, #56B3B4 strings, #F7B93E functions
                    const _vs = `.hljs{color:#d4dde8;background:#1A2B34}.hljs-comment,.hljs-quote{color:#6a9955;font-style:italic}.hljs-keyword,.hljs-doctag,.hljs-formula,.hljs-selector-tag,.hljs-deletion{color:#EA5E5E;font-weight:500}.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#56B3B4}.hljs-literal,.hljs-number{color:#b5cea8}.hljs-title,.hljs-built_in,.hljs-title.class_,.hljs-class .hljs-title{color:#F7B93E}.hljs-type,.hljs-variable,.hljs-template-variable,.hljs-attr,.hljs-selector-class,.hljs-selector-attr,.hljs-selector-pseudo{color:#9cdcfe}.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id{color:#c586c0}.hljs-section,.hljs-name,.hljs-subst{color:#d4dde8}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:bold}.hljs-link{text-decoration:underline;color:#56B3B4}`;
                    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/highlight.min.js"><\/script><script src="https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js@2.9.0/dist/highlightjs-line-numbers.min.js"><\/script><style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;background:#1A2B34;font-family:'Cascadia Code','JetBrains Mono','Fira Code','Consolas','Courier New',monospace;font-size:13.5px;overflow:hidden}${_vs}#tabbar{display:flex;align-items:center;background:#1a1e24;border-bottom:1px solid #111;height:35px;overflow:hidden}.tab{display:flex;align-items:center;gap:6px;padding:0 16px;height:100%;background:#1A2B34;border-right:1px solid #111;border-top:1px solid #EA5E5E;font-size:12px;color:#c9d1d9;white-space:nowrap}.tab-name{color:#e6edf3;font-weight:500}.tab-lang{background:#2a3a44;color:#56B3B4;font-size:9px;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.8px;margin-left:4px}.tabbar-spacer{flex:1}#copy-btn{background:#2a3a44;border:1px solid #3a4d5c;color:#8ba6b8;padding:4px 14px;margin-right:10px;border-radius:5px;cursor:pointer;font-size:11px;font-family:inherit;transition:background .15s,color .15s,border-color .15s}#copy-btn:hover{background:#3a4d5c;color:#F7B93E;border-color:#F7B93E}#copy-btn.copied{color:#56B3B4;border-color:#56B3B4}#code-wrapper{overflow:auto;height:calc(100vh - 35px);background:#1A2B34}pre{margin:0;padding:16px 0;background:#1A2B34}code.hljs{padding:0!important;display:block;background:#1A2B34;font-size:13.5px;line-height:1.7;color:#d4dde8}.hljs-ln{border-collapse:collapse;width:100%}.hljs-ln td{padding:0;border:none}.hljs-ln-numbers{min-width:52px;width:52px;padding:0 16px 0 8px!important;text-align:right;color:#4a5f6e;border-right:1px solid #2a3a44;user-select:none;vertical-align:top;font-size:12px;background:#1A2B34}.hljs-ln-code{padding-left:20px!important;white-space:pre}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:#1A2B34}::-webkit-scrollbar-thumb{background:#2e4455;border-radius:5px;border:2px solid #1A2B34}::-webkit-scrollbar-thumb:hover{background:#3a5568}tr:hover .hljs-ln-numbers{color:#8ba6b8;background:#1e3040}tr:hover .hljs-ln-code{background:#1e3040}</style></head><body><div id="tabbar"><div class="tab"><span>🌐</span><span class="tab-name">${_filename}</span><span class="tab-lang">${_lang}</span></div><div class="tabbar-spacer"></div><button id="copy-btn" onclick="copyCode()">Copy</button></div><div id="code-wrapper"><pre><code class="language-${_lang} hljs">${_esc}</code></pre></div><script>if(typeof hljs!=='undefined'){hljs.highlightAll();try{hljs.initLineNumbersOnLoad();}catch(e){}}function copyCode(){var raw=${_raw};var btn=document.getElementById('copy-btn');function done(){btn.textContent='Copied!';btn.classList.add('copied');setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);}try{navigator.clipboard.writeText(raw).then(done);}catch(e){var ta=document.createElement('textarea');ta.value=raw;ta.style.cssText='position:fixed;opacity:0;top:0;left:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e2){}document.body.removeChild(ta);done();}}<\/script></body></html>`;
                  })()}
                  className={styles.previewIframe}
                  sandbox="allow-scripts allow-same-origin"
                  title="HTML Source"
                />
              ) : activeCanvas.type === 'preview' ? (
                <iframe
                  key={`preview-${activeCanvas.content?.length ?? 0}-${activeCanvas.title ?? ''}`}
                  srcDoc={activeCanvas.content}
                  className={styles.previewIframe}
                  sandbox="allow-scripts allow-forms allow-popups"
                  title="Live Preview"
                />
              ) : activeCanvas.type === 'document' ? (
                <iframe
                  key={`doc-${activeCanvas.title ?? ''}-${activeCanvas.content?.length ?? 0}`}
                  srcDoc={markdownDoc}
                  className={styles.previewIframe}
                  sandbox="allow-scripts"
                  title="Rich Document"
                />
              ) : activeCanvas.type === 'diagram' && isEmpty ? (
                <div style={{ padding: '2rem', color: '#f59e0b', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' }}>
                  <p style={{ marginBottom: '1rem', fontWeight: 600 }}>⚠ AI tidak mengirimkan konten diagram.</p>
                  <p style={{ color: '#888', marginBottom: '1rem' }}>Parameter <code style={{ background: '#2a2a2a', padding: '0 4px', borderRadius: '3px' }}>code</code> yang diterima kosong. Coba minta ulang dengan lebih eksplisit, misalnya: <em>&quot;buatkan diagram use case untuk sistem login dengan flowchart TD&quot;</em>.</p>
                </div>
              ) : activeCanvas.type === 'diagram' && isInvalidDiagram ? (
                <div style={{ padding: '2rem', color: '#ff5555', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' }}>
                  <p style={{ marginBottom: '1rem', fontWeight: 600 }}>⚠ Konten ini bukan sintaks Mermaid yang valid.</p>
                  <p style={{ color: '#888', marginBottom: '0.5rem' }}>Diagram yang diterima tidak dimulai dengan tipe diagram Mermaid yang dikenal (misalnya <code style={{ background: '#2a2a2a', padding: '0 4px', borderRadius: '3px' }}>graph</code>, <code style={{ background: '#2a2a2a', padding: '0 4px', borderRadius: '3px' }}>flowchart</code>, <code style={{ background: '#2a2a2a', padding: '0 4px', borderRadius: '3px' }}>sequenceDiagram</code>, dll).</p>
                  <p style={{ color: '#888', marginBottom: '1rem' }}>💡 Coba minta ulang dengan lebih spesifik, contoh: <em>&quot;buatkan flowchart use case sistem login&quot;</em> atau <em>&quot;buat diagram alur dengan graph TD&quot;</em>.</p>
                  <details style={{ marginBottom: '1rem' }}>
                    <summary style={{ cursor: 'pointer', color: '#aaa', marginBottom: '0.5rem' }}>Lihat konten yang diterima</summary>
                    <pre style={{ background: '#1a1a1a', padding: '1rem', borderRadius: '6px', color: '#ccc', whiteSpace: 'pre-wrap', overflowX: 'auto', marginTop: '0.5rem' }}>{fixedDiagramContent || activeCanvas.content}</pre>
                  </details>
                </div>
              ) : activeCanvas.type === 'diagram' && isVennDiagram ? (
                <iframe
                  key={`venn-${activeCanvas.title ?? ''}-${activeCanvas.content?.length ?? 0}`}
                  srcDoc={vennDoc}
                  className={styles.previewIframe}
                  sandbox="allow-scripts"
                  title="Venn Diagram"
                />
              ) : activeCanvas.type === 'diagram' ? (
                <iframe
                  key={`diagram-${activeCanvas.title ?? ''}-${activeCanvas.content?.length ?? 0}`}
                  srcDoc={mermaidDoc}
                  className={styles.previewIframe}
                  sandbox="allow-scripts"
                  title="Diagram"
                />
              ) : activeCanvas.type === 'spreadsheet' ? (
                <iframe
                  key={`sheet-${activeCanvas.title ?? ''}-${activeCanvas.content?.length ?? 0}`}
                  srcDoc={spreadsheetDoc}
                  className={styles.previewIframe}
                  sandbox="allow-scripts"
                  title="Spreadsheet"
                />
              ) : activeCanvas.type === 'chart' ? (() => {
                  let chartCfg: any = {};
                  try { chartCfg = JSON.parse(activeCanvas.content); } catch {}
                  const chartType = chartCfg.chart_type || 'bar';
                  const labelsRaw = chartCfg.labels || '[]';
                  const datasetsRaw = chartCfg.datasets || '[]';
                  const VIVID = ['#4f9cf9','#f97316','#a3e635','#e879f9','#34d399','#fbbf24','#f87171','#818cf8'];
                  // Inject default colors into datasets
                  let datasets: any[] = [];
                  try {
                    datasets = JSON.parse(datasetsRaw).map((ds: any, i: number) => ({
                      ...ds,
                      backgroundColor: ds.backgroundColor || (
                        ['pie','doughnut','polarArea'].includes(chartType)
                          ? VIVID
                          : VIVID[i % VIVID.length]
                      ),
                      borderColor: ds.borderColor || (
                        chartType === 'line' ? VIVID[i % VIVID.length] : undefined
                      ),
                      borderWidth: ds.borderWidth ?? (chartType === 'line' ? 2 : 1),
                      tension: chartType === 'line' ? 0.4 : undefined,
                      fill: chartType === 'line' ? false : undefined,
                    }));
                  } catch {}
                  const chartDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #0d0d0d; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: sans-serif; }
    h2 { color: #e5e5e5; font-size: 0.95rem; font-weight: 600; margin-bottom: 16px; letter-spacing: 0.03em; }
    .wrap { width: 90%; max-width: 820px; }
    canvas { max-height: 70vh; }
    .dl-btn { margin-top: 14px; padding: 6px 16px; font-size: 12px; background: transparent; border: 1px solid #444; color: #aaa; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
    .dl-btn:hover { background: #222; color: #fff; border-color: #666; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
</head>
<body>
  <div class="wrap">
    <h2>${activeCanvas.title || 'Chart'}</h2>
    <canvas id="myChart"></canvas>
    <button class="dl-btn" onclick="downloadChart()">⬇ Download PNG</button>
  </div>
  <script>
    Chart.defaults.color = '#aaa';
    Chart.defaults.borderColor = '#333';
    new Chart(document.getElementById('myChart'), {
      type: ${JSON.stringify(chartType)},
      data: {
        labels: ${labelsRaw},
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', labels: { color: '#ccc', font: { size: 12 } } },
          tooltip: { backgroundColor: '#1a1a1a', titleColor: '#fff', bodyColor: '#ccc', borderColor: '#444', borderWidth: 1 }
        },
        scales: ${['pie','doughnut','polarArea','radar'].includes(chartType) ? 'undefined' : JSON.stringify({
          x: { ticks: { color: '#aaa' }, grid: { color: '#222' } },
          y: { ticks: { color: '#aaa' }, grid: { color: '#222' } }
        })}
      }
    });
    function downloadChart() {
      const a = document.createElement('a');
      a.href = document.getElementById('myChart').toDataURL('image/png');
      a.download = 'chart.png';
      a.click();
    }
  </script>
</body>
</html>`;
                  return (
                    <iframe key={`chart-${activeCanvas.title ?? ''}-${activeCanvas.content?.length ?? 0}`} srcDoc={chartDoc} className={styles.previewIframe} sandbox="allow-scripts allow-downloads" title="Chart" />
                  );
                })()
              : activeCanvas.type === 'notebook' ? (() => {
                  let cells: any[] = [];
                  try { cells = JSON.parse(activeCanvas.content); } catch {}
                  const cellsJson = JSON.stringify(cells);
                  const notebookDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d0d0d; color: #e5e5e5; font-family: -apple-system, sans-serif; font-size: 14px; padding: 24px; line-height: 1.65; }
    h1.nb-title { font-size: 1.1rem; font-weight: 600; color: #fff; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #222; }
    .cell { margin-bottom: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #222; }
    .cell-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 12px; background: #151515; color: #555; border-bottom: 1px solid #222; }
    .cell-label.code  { color: #4f9cf9; }
    .cell-label.out   { color: #34d399; }
    .cell-label.md    { color: #a78bfa; }
    .cell-code  { background: #111; }
    .cell-code pre { margin: 0; padding: 14px 16px; font-size: 13px; overflow-x: auto; }
    .cell-output { background: #0a0a0a; padding: 12px 16px; font-family: monospace; font-size: 12.5px; color: #a0c4a0; white-space: pre-wrap; word-break: break-word; }
    .cell-md { padding: 14px 18px; background: #0d0d0d; }
    .cell-md h1,.cell-md h2,.cell-md h3 { margin: 0.5em 0 0.3em; color: #e5e5e5; }
    .cell-md p { margin: 0 0 0.5em; color: #ccc; }
    .cell-md code { background: #1e1e1e; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
    .cell-md ul,.cell-md ol { padding-left: 1.5em; color: #ccc; }
  </style>
</head>
<body>
  <h1 class="nb-title">${(activeCanvas.title || 'Notebook').replace(/</g,'&lt;')}</h1>
  <div id="nb"></div>
  <script>
    const cells = ${cellsJson};
    const nb = document.getElementById('nb');
    cells.forEach(cell => {
      const wrap = document.createElement('div');
      wrap.className = 'cell';
      if (cell.type === 'code') {
        const label = document.createElement('div');
        label.className = 'cell-label code';
        label.textContent = (cell.language || 'code').toUpperCase();
        const body = document.createElement('div');
        body.className = 'cell-code';
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = 'language-' + (cell.language || 'plaintext');
        code.textContent = cell.content || '';
        pre.appendChild(code);
        body.appendChild(pre);
        wrap.appendChild(label);
        wrap.appendChild(body);
        hljs.highlightElement(code);
      } else if (cell.type === 'output') {
        const label = document.createElement('div');
        label.className = 'cell-label out';
        label.textContent = 'OUTPUT';
        const body = document.createElement('div');
        body.className = 'cell-output';
        body.textContent = cell.content || '';
        wrap.appendChild(label);
        wrap.appendChild(body);
      } else {
        const label = document.createElement('div');
        label.className = 'cell-label md';
        label.textContent = 'MARKDOWN';
        const body = document.createElement('div');
        body.className = 'cell-md';
        body.innerHTML = marked.parse(cell.content || '');
        wrap.appendChild(label);
        wrap.appendChild(body);
      }
      nb.appendChild(wrap);
    });
  </script>
</body>
</html>`;
                  return (
                    <iframe srcDoc={notebookDoc} className={styles.previewIframe} sandbox="allow-scripts" title="Notebook" />
                  );
                })()
              : null}
            </div>
          </section>
        );
      })()}

      {previewModalImage && (
        <div className={styles.imageModalOverlay} onClick={() => setPreviewModalImage(null)}>
          <div className={styles.imageModalContent}>
             <img src={previewModalImage} alt="Preview" />
          </div>
        </div>
      )}

      {isSettingsOpen && settingsForm && (() => {
        const updateField = (field: 'workspaceRoot' | 'chatModel' | 'subAgentModel' | 'ollamaUrl') =>
          (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
            setSettingsForm(prev => (prev ? { ...prev, [field]: e.target.value } : prev));

        // Chat Model / Sub-Agent Model render as a dropdown of whatever
        // Ollama actually has pulled. Falls back to the old plain text input
        // when no model list is available yet (still loading, or Ollama
        // couldn't be reached) so the field is never stuck un-editable.
        const renderModelField = (field: 'chatModel' | 'subAgentModel', placeholder: string) => {
          const current = settingsForm[field];
          if (ollamaModels.length === 0) {
            return <input className={styles.settingsInput} value={current} onChange={updateField(field)} placeholder={placeholder} />;
          }
          return (
            <select className={styles.settingsInput} value={current} onChange={updateField(field)}>
              {current && !ollamaModels.includes(current) && (
                <option value={current}>{current} (not found locally)</option>
              )}
              {ollamaModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          );
        };

        return (
          <div
            className={`${styles.settingsOverlay} ${settingsClosing ? styles.settingsOverlayClosing : ''}`}
            onClick={closeSettings}
          >
            <div
              className={`${styles.settingsPanel} ${settingsClosing ? styles.settingsPanelClosing : ''}`}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
            >
              <div className={styles.settingsHeader}>
                <div>
                  <div className={styles.settingsHeaderTitle}>
                    <span aria-hidden="true">⚙️</span>
                    <h3 id="settings-title">Settings</h3>
                  </div>
                  <div className={styles.settingsHeaderHint}>Changes take effect on your next message — no restart needed.</div>
                </div>
                <button className={styles.settingsCloseBtn} onClick={closeSettings} title="Close" aria-label="Close settings">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div className={styles.settingsBody}>
                <section className={styles.settingsSection}>
                  <div className={styles.settingsSectionTitle}>Workspace</div>
                  <div className={styles.settingsField}>
                    <label className={styles.settingsLabel}>Workspace Root</label>
                    <div className={styles.workspaceRootRow}>
                      <input className={styles.settingsInput} value={settingsForm.workspaceRoot} onChange={updateField('workspaceRoot')} placeholder="/path/to/your/project" />
                      <button type="button" className={styles.browseBtn} onClick={openFolderPicker}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                        </svg>
                        Browse…
                      </button>
                    </div>
                    <div className={styles.settingsHint}>Absolute folder path on this machine. File, terminal, and database tools operate inside this folder only.</div>

                    {folderPickerOpen && (
                      <div className={styles.folderPicker}>
                        <div className={styles.folderPickerHeader}>
                          <button
                            type="button"
                            className={styles.folderPickerNavBtn}
                            onClick={() => loadBrowseDir(null)}
                            disabled={browseLoading}
                            title="Back to drives"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>
                          </button>
                          <button
                            type="button"
                            className={styles.folderPickerNavBtn}
                            onClick={() => browseParent && loadBrowseDir(browseParent)}
                            disabled={browseLoading || !browseParent}
                            title="Up one level"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                          </button>
                          <span className={styles.folderPickerPath} title={browsePath || ''}>{browsePath || 'Select a drive'}</span>
                        </div>

                        <div className={styles.folderPickerList}>
                          {browseLoading ? (
                            <div className={styles.folderPickerMessage}>Loading…</div>
                          ) : browseError ? (
                            <div className={styles.folderPickerMessage}>{browseError}</div>
                          ) : browseEntries.length === 0 ? (
                            <div className={styles.folderPickerMessage}>No subfolders here.</div>
                          ) : (
                            browseEntries.map((entry) => (
                              <button
                                type="button"
                                key={entry.path}
                                className={styles.folderPickerItem}
                                onClick={() => loadBrowseDir(entry.path)}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                                </svg>
                                {entry.name}
                              </button>
                            ))
                          )}
                        </div>

                        <div className={styles.folderPickerFooter}>
                          <button type="button" className={styles.denyBtn} onClick={closeFolderPicker}>Cancel</button>
                          <button type="button" className={styles.approveBtn} onClick={chooseBrowsedFolder} disabled={!browsePath}>
                            Use this folder
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className={styles.settingsSection}>
                  <div className={styles.settingsSectionTitleRow}>
                    <div className={styles.settingsSectionTitle}>Models</div>
                    <button
                      type="button"
                      className={styles.modelsRefreshBtn}
                      onClick={() => fetchOllamaModels(settingsForm.ollamaUrl)}
                      disabled={modelsLoading}
                      title="Refresh model list from Ollama"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      {modelsLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
                  <div className={styles.settingsRow}>
                    <div className={styles.settingsField} style={{ marginTop: 0 }}>
                      <label className={styles.settingsLabel}>Chat Model</label>
                      {renderModelField('chatModel', 'ornith:9b')}
                    </div>
                    <div className={styles.settingsField} style={{ marginTop: 0 }}>
                      <label className={styles.settingsLabel}>Sub-Agent Model</label>
                      {renderModelField('subAgentModel', 'qwen3.5:4b')}
                    </div>
                  </div>
                  <div className={styles.settingsHint} style={{ marginTop: '6px' }}>
                    {modelsError
                      ? `${modelsError} — type the model name manually below.`
                      : ollamaModels.length > 0
                        ? `${ollamaModels.length} model${ollamaModels.length === 1 ? '' : 's'} found on this Ollama instance.`
                        : 'Sub-agent model is used for image description and for summarizing long conversations.'}
                  </div>
                  <div className={styles.settingsField}>
                    <label className={styles.settingsLabel}>Ollama URL</label>
                    <input
                      className={styles.settingsInput}
                      value={settingsForm.ollamaUrl}
                      onChange={updateField('ollamaUrl')}
                      onBlur={(e) => fetchOllamaModels(e.target.value)}
                      placeholder="http://127.0.0.1:11434"
                    />
                  </div>
                </section>

                <section className={styles.settingsSection}>
                  <div className={styles.settingsSectionTitle}>MCP Servers</div>

                  {settingsForm.mcpServers.length === 0 ? (
                    <div className={styles.mcpEmptyState}>Belum ada MCP server. Tambah salah satu buat kasih tools tambahan ke Ornith.</div>
                  ) : (
                    <div className={styles.mcpServerList}>
                      {settingsForm.mcpServers.map((server, idx) => (
                        <div key={idx} className={styles.mcpServerCard}>
                          <div className={styles.mcpServerCardHeader}>
                            <input
                              className={styles.settingsInput}
                              value={server.name}
                              onChange={updateMcpServerField(idx, 'name')}
                              placeholder="Server name (e.g. fs)"
                            />
                            <button
                              type="button"
                              className={`${styles.mcpEnabledToggle} ${server.enabled !== false ? styles.mcpEnabledToggleOn : ''}`}
                              onClick={() => toggleMcpServerEnabled(idx)}
                              title={server.enabled !== false ? 'Server ini aktif — klik buat nonaktifkan' : 'Server ini nonaktif — klik buat aktifkan'}
                            >
                              <span className={styles.mcpEnabledSwitch}></span>
                              {server.enabled !== false ? 'On' : 'Off'}
                            </button>
                            <button
                              type="button"
                              className={styles.mcpServerRemoveBtn}
                              onClick={() => removeMcpServer(idx)}
                              title="Remove this server"
                              aria-label="Remove this MCP server"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
                              </svg>
                            </button>
                          </div>

                          <input
                            className={styles.settingsInput}
                            value={server.command}
                            onChange={updateMcpServerField(idx, 'command')}
                            placeholder="Command (e.g. npx)"
                          />

                          <div className={styles.mcpArgsLabel}>Arguments</div>
                          <div className={styles.mcpArgsList}>
                            {(server.args || []).map((arg, argIdx) => (
                              <div key={argIdx} className={styles.mcpArgChip}>
                                <input
                                  className={`${styles.settingsInput} ${styles.mcpArgInput}`}
                                  value={arg}
                                  onChange={updateMcpServerArg(idx, argIdx)}
                                  placeholder="arg"
                                />
                                <button type="button" className={styles.mcpArgRemove} onClick={() => removeMcpServerArg(idx, argIdx)} title="Remove argument" aria-label="Remove argument">×</button>
                              </div>
                            ))}
                            <button type="button" className={styles.mcpAddArgBtn} onClick={() => addMcpServerArg(idx)}>+ Add arg</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button type="button" className={styles.mcpAddServerBtn} onClick={addMcpServer}>+ Add MCP Server</button>
                  <div className={styles.settingsHint} style={{ marginTop: '10px' }}>
                    Tools from enabled servers appear as mcp__&lt;name&gt;__&lt;tool&gt; and always require your approval before running.
                  </div>
                </section>

                {settingsError && (
                  <div className={styles.settingsErrorBox}>{settingsError}</div>
                )}
              </div>

              <div className={styles.settingsFooter}>
                <button className={styles.denyBtn} onClick={closeSettings} disabled={settingsSaving}>Cancel</button>
                <button className={styles.approveBtn} onClick={saveSettings} disabled={settingsSaving}>
                  {settingsSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}
