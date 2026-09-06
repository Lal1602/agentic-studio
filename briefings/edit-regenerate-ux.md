# Briefing: Edit Prompt & Regenerate Response (UX Chat)
> edit-regenerate-ux.md · Agentic Studio Feature Briefing

---

## 📌 Vision

Setiap aplikasi AI chat profesional (ChatGPT, Claude, Gemini) punya dua fitur UX esensial:
1. **Edit pesan user** — klik ✏️ di bubble pesan, ubah teks, kirim ulang → semua pesan setelahnya dihapus dan Qwen menjawab dari titik itu
2. **Regenerate response** — klik 🔄 di bubble Qwen → hapus respons terakhir, kirim ulang prompt yang sama

Kedua fitur ini menyelamatkan user dari harus scroll ke bawah terus menerus ketika Qwen salah memahami prompt.

---

## 🏗 Arsitektur State

### State yang perlu ada
`	ypescript
// Existing
const [messages, setMessages] = useState<Message[]>([]);

// New
const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
const [editingText, setEditingText] = useState('');
`

### Message type (tambah field)
`	ypescript
type Message = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  // existing fields...
  id?: string;  // add unique ID for stable reference
}
`

---

## 🎨 UI Mockup

### Edit button di bubble user
`
                               ╔═══════════════════╗
                               ║  buat mindmap     ║ ← bubble user
                               ║  sederhana     ✏️ ║ ← icon muncul on hover
                               ╚═══════════════════╝

Saat klik ✏️:
╔═════════════════════════════════════════════╗
║ ┌────────────────────────────────────────┐ ║
║ │ buat mindmap sederhana                 │ ║  ← textarea editable
║ └────────────────────────────────────────┘ ║
║                    [Batal]  [Kirim Ulang ↑] ║
╚═════════════════════════════════════════════╝
`

### Regenerate button di bubble Qwen
`
╔══════════════════════════════════════╗
║ QWEN                                 ║
║ Diagram mindmap tentang...           ║
║                                      ║
║  🔄 Regenerate                       ║ ← tombol di bawah bubble
╚══════════════════════════════════════╝
`

---

## 🔧 Implementation

### 1. Edit User Message

`	ypescript
// Handler: mulai edit
function handleStartEdit(msgIdx: number) {
  setEditingMsgIdx(msgIdx);
  setEditingText(messages[msgIdx].content as string);
}

// Handler: cancel edit
function handleCancelEdit() {
  setEditingMsgIdx(null);
  setEditingText('');
}

// Handler: submit edit
async function handleSubmitEdit(msgIdx: number) {
  if (!editingText.trim()) return;

  // Slice messages: keep everything BEFORE the edited message
  // Then append the edited user message
  const newMessages = messages.slice(0, msgIdx);
  newMessages.push({ role: 'user', content: editingText.trim() });

  setMessages(newMessages);
  setEditingMsgIdx(null);
  setEditingText('');
  setActiveCanvas(null); // close stale canvas

  // Re-send to API (same as handleSend logic)
  await sendToAgent(newMessages);
}
`

### 2. Regenerate Last Response

`	ypescript
// Handler: regenerate Qwen's last response
async function handleRegenerate(msgIdx: number) {
  // Find the last user message before this assistant message
  const newMessages = messages.slice(0, msgIdx); // cut off from this assistant msg

  setMessages(newMessages);
  setActiveCanvas(null);

  await sendToAgent(newMessages);
}
`

### 3. Refactor sendToAgent

Saat ini logic kirim ada di handleSend. Extract menjadi fungsi sendToAgent yang bisa dipanggil dari edit dan regenerate:

`	ypescript
async function sendToAgent(msgs: Message[]) {
  setLoading(true);
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs, chatId })
    });
    const data = await res.json();
    if (data.messages) setMessages(data.messages);
    if (data.response) { /* handle canvas */ }
  } finally {
    setLoading(false);
  }
}
`

---

## 🎨 JSX Render

### Edit mode untuk bubble user
`	sx
{msg.role === 'user' && (
  <div className={${styles.messageWrapper} }>
    {editingMsgIdx === idx ? (
      // Edit mode
      <div className={styles.editContainer}>
        <textarea
          value={editingText}
          onChange={e => setEditingText(e.target.value)}
          className={styles.editTextarea}
          rows={Math.max(3, editingText.split('\n').length)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmitEdit(idx);
            if (e.key === 'Escape') handleCancelEdit();
          }}
          autoFocus
        />
        <div className={styles.editActions}>
          <button onClick={handleCancelEdit} className={styles.cancelBtn}>Batal</button>
          <button onClick={() => handleSubmitEdit(idx)} className={styles.submitEditBtn}>
            Kirim Ulang ↑
          </button>
        </div>
      </div>
    ) : (
      // Normal mode
      <div
        className={styles.messageContent}
        onMouseEnter={() => setHoveredMsgIdx(idx)}
        onMouseLeave={() => setHoveredMsgIdx(null)}
      >
        <div className={styles.userBubble}>{msg.content}</div>
        {hoveredMsgIdx === idx && (
          <button
            className={styles.editBtn}
            onClick={() => handleStartEdit(idx)}
            title="Edit pesan"
          >✏️</button>
        )}
      </div>
    )}
  </div>
)}
`

### Regenerate button untuk bubble Qwen (terakhir saja)
`	sx
{msg.role === 'assistant' && msg.content && idx === messages.length - 1 && (
  <button
    className={styles.regenerateBtn}
    onClick={() => handleRegenerate(idx)}
    disabled={loading}
    title="Regenerate respons"
  >
    🔄 Regenerate
  </button>
)}
`

---

## 🎨 CSS Styles Baru

`css
.editContainer {
  width: 100%;
  max-width: 520px;
  margin-left: auto;
}

.editTextarea {
  width: 100%;
  background: #1e1e2e;
  border: 1px solid #7c3aed;
  border-radius: 12px;
  color: #e2e8f0;
  padding: 12px 16px;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
  outline: none;
}

.editActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.cancelBtn {
  background: transparent;
  border: 1px solid #4a4a5a;
  color: #888;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.submitEditBtn {
  background: #7c3aed;
  border: none;
  color: white;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.editBtn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  opacity: 0.6;
  transition: opacity 0.15s;
}
.editBtn:hover { opacity: 1; }

.regenerateBtn {
  background: none;
  border: 1px solid #3a3b46;
  color: #888;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  margin-top: 6px;
  transition: border-color 0.15s, color 0.15s;
}
.regenerateBtn:hover { border-color: #7c3aed; color: #c4b5fd; }
.regenerateBtn:disabled { opacity: 0.4; cursor: not-allowed; }
`

---

## ⚠️ Edge Cases

| Case | Handling |
|---|---|
| Edit pesan di tengah obrolan panjang | Semua pesan setelah edited msg dihapus |
| Edit saat loading | Disable ✏️ button saat loading === true |
| Regenerate saat bukan pesan terakhir | Hanya tampilkan 🔄 di pesan assistant **terakhir** |
| Canvas stale setelah edit | setActiveCanvas(null) sebelum sendToAgent |
| Textarea panjang | Auto-resize rows berdasarkan jumlah \n |
| Ctrl+Enter to submit | Didukung di onKeyDown handler |
| Esc to cancel | Didukung di onKeyDown handler |

---

## 📋 Implementation Checklist

- [ ] Tambah state: editingMsgIdx, editingText, hoveredMsgIdx
- [ ] Extract sendToAgent(msgs) dari handleSend
- [ ] Implementasi handleStartEdit, handleCancelEdit, handleSubmitEdit
- [ ] Implementasi handleRegenerate
- [ ] Update JSX: tambah ✏️ on hover untuk bubble user
- [ ] Update JSX: tambah 🔄 Regenerate untuk bubble Qwen terakhir
- [ ] Tambah CSS styles baru
- [ ] Disable edit/regen button saat loading === true
- [ ] Test: edit tengah obrolan → apakah messages bawahnya hilang
- [ ] Test: regenerate → apakah canvas lama ditutup
