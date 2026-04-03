/**
 * openclaw-groupchat — Dashboard HTML
 *
 * Self-contained single-page app served at GET /groupchat/
 * No external CDN dependencies — vanilla JS + inline CSS.
 */

export function getDashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenClaw Group Chat</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #22263a;
    --border: #2e3350;
    --accent: #5b8dee;
    --accent2: #7c6af5;
    --text: #e2e8f0;
    --text-muted: #7a849e;
    --user-color: #48bb78;
    --error: #fc8181;
    --radius: 10px;
    --sidebar-width: 260px;
  }

  html, body { height: 100%; font-family: -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }

  /* ── Layout ── */
  #app { display: flex; height: 100vh; overflow: hidden; }

  /* ── Sidebar ── */
  #sidebar {
    width: var(--sidebar-width); min-width: var(--sidebar-width);
    background: var(--surface); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; overflow: hidden;
  }
  #sidebar-header {
    padding: 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px;
  }
  #sidebar-header .logo { font-size: 20px; }
  #sidebar-header h1 { font-size: 15px; font-weight: 600; color: var(--text); }
  #sidebar-header small { display: block; font-size: 11px; color: var(--text-muted); }

  #rooms-list { flex: 1; overflow-y: auto; padding: 8px 0; }

  .room-item {
    padding: 10px 14px; cursor: pointer; border-radius: var(--radius);
    margin: 2px 8px; transition: background 0.15s;
    display: flex; align-items: flex-start; gap: 10px;
  }
  .room-item:hover { background: var(--surface2); }
  .room-item.active { background: rgba(91,141,238,0.15); border-left: 3px solid var(--accent); }
  .room-item .room-icon { font-size: 18px; line-height: 1.4; }
  .room-item .room-info { flex: 1; min-width: 0; }
  .room-item .room-name { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .room-item .room-members { font-size: 11px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .room-item .room-badge { background: var(--accent); color: #fff; border-radius: 10px; padding: 1px 6px; font-size: 10px; font-weight: 700; }

  #new-room-btn {
    margin: 8px; padding: 8px; background: var(--surface2);
    border: 1px dashed var(--border); border-radius: var(--radius);
    cursor: pointer; color: var(--text-muted); font-size: 13px;
    text-align: center; transition: all 0.15s;
  }
  #new-room-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* ── Main ── */
  #main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  #chat-header {
    padding: 14px 18px; background: var(--surface); border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  }
  #chat-header .room-title { font-size: 16px; font-weight: 700; }
  #chat-header .member-chips { display: flex; flex-wrap: wrap; gap: 5px; flex: 1; }
  .member-chip {
    padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600;
    color: #fff; opacity: 0.9;
  }
  #status-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #555;
    transition: background 0.3s; flex-shrink: 0;
  }
  #status-dot.live { background: var(--user-color); box-shadow: 0 0 6px var(--user-color); }
  #status-dot.thinking { background: var(--accent); box-shadow: 0 0 6px var(--accent); animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }

  /* ── Messages ── */
  #messages {
    flex: 1; overflow-y: auto; padding: 16px 18px;
    display: flex; flex-direction: column; gap: 2px;
    scroll-behavior: smooth;
  }

  .msg-group { display: flex; flex-direction: column; margin-bottom: 12px; }

  .msg-header {
    display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;
    padding: 0 4px;
  }
  .msg-author { font-weight: 700; font-size: 13px; }
  .msg-time { font-size: 11px; color: var(--text-muted); }

  .msg-bubble {
    max-width: 85%; padding: 10px 14px;
    border-radius: 4px 14px 14px 14px;
    line-height: 1.6; font-size: 13.5px;
    white-space: pre-wrap; word-break: break-word;
    background: var(--surface2); border: 1px solid var(--border);
  }
  .msg-group.is-user .msg-bubble {
    background: rgba(72,187,120,0.1); border-color: rgba(72,187,120,0.3);
    border-radius: 14px 4px 14px 14px;
    align-self: flex-end;
  }
  .msg-group.is-user { align-items: flex-end; }
  .msg-group.is-user .msg-header { flex-direction: row-reverse; }

  /* @mention styles */
  .mention-tag {
    display: inline-block; padding: 1px 7px; border-radius: 12px;
    font-size: 12px; font-weight: 700; color: #fff;
    margin-right: 3px; vertical-align: middle;
  }
  .mention-badge {
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
    font-size: 11px; color: var(--text-muted); margin-bottom: 5px; padding: 0 4px;
  }
  .mention-badge .at-icon { font-size: 13px; }
  .msg-bubble .at-highlight {
    font-weight: 700; padding: 0 2px; border-radius: 3px;
  }
  .msg-group.has-mention .msg-bubble {
    border-color: rgba(91,141,238,0.4);
    background: rgba(91,141,238,0.06);
  }

  .typing-indicator {
    display: flex; gap: 4px; align-items: center; padding: 10px 14px;
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 4px 14px 14px 14px; width: fit-content; margin-bottom: 8px;
  }
  .typing-dot {
    width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted);
    animation: bounce 1.2s infinite;
  }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,80%,100% { transform: translateY(0) } 40% { transform: translateY(-6px) } }

  .day-divider {
    text-align: center; font-size: 11px; color: var(--text-muted);
    position: relative; margin: 12px 0;
  }
  .day-divider::before, .day-divider::after {
    content: ''; position: absolute; top: 50%;
    width: 42%; height: 1px; background: var(--border);
  }
  .day-divider::before { left: 0; }
  .day-divider::after { right: 0; }

  #empty-state {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: var(--text-muted); gap: 10px;
  }
  #empty-state .big-icon { font-size: 48px; }
  #empty-state p { font-size: 15px; }
  #empty-state small { font-size: 12px; }

  /* ── Input bar ── */
  #input-bar {
    padding: 12px 16px; background: var(--surface);
    border-top: 1px solid var(--border); display: flex; gap: 10px; align-items: flex-end;
    flex-shrink: 0;
  }
  #input-bar textarea {
    flex: 1; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 14px; color: var(--text);
    font-size: 14px; font-family: inherit; resize: none; max-height: 140px;
    min-height: 42px; line-height: 1.5; outline: none; transition: border-color 0.2s;
  }
  #input-bar textarea:focus { border-color: var(--accent); }
  #input-bar textarea::placeholder { color: var(--text-muted); }

  #send-btn {
    background: var(--accent); border: none; border-radius: 10px;
    width: 42px; height: 42px; cursor: pointer; color: #fff;
    font-size: 18px; display: flex; align-items: center; justify-content: center;
    transition: opacity 0.15s, transform 0.1s; flex-shrink: 0;
  }
  #send-btn:hover:not(:disabled) { opacity: 0.85; }
  #send-btn:active:not(:disabled) { transform: scale(0.95); }
  #send-btn:disabled { opacity: 0.4; cursor: default; }

  #broadcast-status {
    font-size: 12px; color: var(--text-muted); padding: 4px 2px;
    min-height: 20px; display: flex; align-items: center; gap: 6px;
  }
  #broadcast-status.active { color: var(--accent); }
  #broadcast-status.error { color: var(--error); }

  /* ── Modal ── */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 100;
  }
  .modal-overlay.hidden { display: none; }
  .modal {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; padding: 24px; width: 380px; max-width: 95vw;
  }
  .modal h2 { font-size: 16px; margin-bottom: 16px; }
  .modal label { font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 4px; }
  .modal input, .modal textarea {
    width: 100%; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 14px;
    font-family: inherit; outline: none; margin-bottom: 14px;
  }
  .modal input:focus, .modal textarea:focus { border-color: var(--accent); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { opacity: 0.85; }
  .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
  .btn-secondary:hover { border-color: var(--accent); }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

  .no-select { display: none !important; }
</style>
</head>
<body>
<div id="app">

  <!-- Sidebar -->
  <div id="sidebar">
    <div id="sidebar-header">
      <span class="logo">💬</span>
      <div>
        <h1>Group Chat</h1>
        <small>OpenClaw Agent Monitor</small>
      </div>
    </div>
    <div id="rooms-list"></div>
    <div id="new-room-btn" onclick="openNewRoomModal()">＋ 新建房间</div>
  </div>

  <!-- Main -->
  <div id="main">
    <div id="chat-header">
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
        <div class="room-title" id="header-title">选择一个房间</div>
        <div class="member-chips" id="header-members"></div>
      </div>
      <div id="status-dot" title="SSE 连接状态"></div>
    </div>

    <div id="messages">
      <div id="empty-state">
        <span class="big-icon">🤖</span>
        <p>从左侧选择一个群聊房间</p>
        <small>实时监听 agent 群聊对话</small>
      </div>
    </div>

    <div id="broadcast-status"></div>
    <div id="input-bar">
      <textarea id="msg-input" placeholder="以 user 身份发消息到群聊..." rows="1" onkeydown="handleKey(event)" oninput="autoResize(this)" disabled></textarea>
      <button id="send-btn" onclick="sendMessage()" disabled title="发送 (Enter)">➤</button>
    </div>
  </div>
</div>

<!-- New Room Modal -->
<div id="new-room-modal" class="modal-overlay hidden" onclick="closeModalOnOverlay(event)">
  <div class="modal">
    <h2>新建群聊房间</h2>
    <label>房间名称</label>
    <input type="text" id="new-room-name" placeholder="例：团队讨论" />
    <label>成员 agentId（每行一个）</label>
    <textarea id="new-room-members" rows="4" placeholder="tanaka&#10;designer&#10;testa"></textarea>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeNewRoomModal()">取消</button>
      <button class="btn btn-primary" onclick="createRoom()">创建</button>
    </div>
  </div>
</div>

<script>
// ── State ──
let currentRoomId = null;
let currentRoom = null;
let evtSource = null;
let isBroadcasting = false;
let lastDayLabel = null;

// ── Agent colors (deterministic by name) ──
const PALETTE = [
  '#5b8dee','#7c6af5','#e88c4a','#4cb8b8','#e46d8e',
  '#56b4a4','#c97bd4','#e8b84b','#6a9fd8','#8ac78a',
];
function agentColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ── Init ──
loadRooms();
setInterval(loadRooms, 15000);

async function loadRooms() {
  try {
    const rooms = await api('GET', '/groupchat/rooms');
    renderSidebar(rooms);
  } catch(e) { console.error('loadRooms', e); }
}

function renderSidebar(rooms) {
  const el = document.getElementById('rooms-list');
  if (rooms.length === 0) {
    el.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center">暂无房间，点击下方新建</div>';
    return;
  }
  el.innerHTML = rooms.map(r => \`
    <div class="room-item \${currentRoomId === r.id ? 'active' : ''}" onclick="selectRoom('\${r.id}')">
      <span class="room-icon">💬</span>
      <div class="room-info">
        <div class="room-name">\${esc(r.name)}</div>
        <div class="room-members">\${r.members.length ? r.members.join(', ') : '(无成员)'}</div>
      </div>
      \${r.members.length ? \`<span class="room-badge">\${r.members.length}</span>\` : ''}
    </div>
  \`).join('');
}

// ── Select room ──
async function selectRoom(id) {
  if (currentRoomId === id) return;
  currentRoomId = id;

  // disconnect old SSE
  if (evtSource) { evtSource.close(); evtSource = null; }
  document.getElementById('status-dot').className = 'status-dot';

  try {
    currentRoom = await api('GET', \`/groupchat/rooms/\${id}\`);
  } catch(e) {
    showError('房间加载失败'); return;
  }

  // update header
  document.getElementById('header-title').textContent = currentRoom.name;
  document.getElementById('header-members').innerHTML =
    currentRoom.members.map(m =>
      \`<span class="member-chip" style="background:\${agentColor(m)}">\${esc(m)}</span>\`
    ).join('');

  // enable input
  document.getElementById('msg-input').disabled = false;
  document.getElementById('send-btn').disabled = false;

  // load transcript
  await loadTranscript();

  // refresh sidebar active state
  document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.room-item').forEach(el => {
    if (el.onclick.toString().includes(id)) el.classList.add('active');
  });
  // simpler: reload sidebar
  const rooms = await api('GET', '/groupchat/rooms');
  renderSidebar(rooms);

  // connect SSE
  connectSse(id);
}

async function loadTranscript() {
  const el = document.getElementById('messages');
  el.innerHTML = '';
  lastDayLabel = null;

  try {
    const entries = await api('GET', \`/groupchat/rooms/\${currentRoomId}/transcript?limit=200\`);
    if (entries.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:var(--text-muted);margin-top:40px;font-size:13px">暂无消息，发送第一条吧 👋</div>';
      return;
    }
    entries.forEach(e => appendMessage(e, false));
    scrollToBottom();
  } catch(e) {
    el.innerHTML = '<div style="color:var(--error);padding:20px">加载消息失败</div>';
  }
}

// ── Render a message ──
function appendMessage(entry, doScroll = true) {
  const container = document.getElementById('messages');

  // Remove empty state
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  // Day divider
  const day = entry.ts.slice(0, 10);
  if (day !== lastDayLabel) {
    lastDayLabel = day;
    const div = document.createElement('div');
    div.className = 'day-divider';
    div.textContent = formatDay(entry.ts);
    container.appendChild(div);
  }

  // Remove typing indicator if present
  const typing = document.getElementById(\`typing-\${entry.from}\`);
  if (typing) typing.remove();

  const isUser = entry.from === 'user';
  const mentions = Array.isArray(entry.mentions) ? entry.mentions : [];
  const hasMention = mentions.length > 0;

  // Render @mention tags above bubble
  const mentionBadge = hasMention
    ? \`<div class="mention-badge">
        <span class="at-icon">@</span>
        \${mentions.map(m => \`<span class="mention-tag" style="background:\${agentColor(m)}">\${esc(m)}</span>\`).join('')}
        <span>仅回复</span>
      </div>\`
    : '';

  // Highlight @agentId tokens in text
  const renderedText = highlightMentions(entry.text);

  const group = document.createElement('div');
  group.className = \`msg-group\${isUser ? ' is-user' : ''}\${hasMention ? ' has-mention' : ''}\`;
  group.innerHTML = \`
    \${mentionBadge}
    <div class="msg-header">
      <span class="msg-author" style="color:\${isUser ? 'var(--user-color)' : agentColor(entry.from)}">\${esc(entry.from)}</span>
      <span class="msg-time">\${formatTime(entry.ts)}</span>
    </div>
    <div class="msg-bubble">\${renderedText}</div>
  \`;
  container.appendChild(group);

  if (doScroll) scrollToBottom();
}

function highlightMentions(text) {
  // Replace @word with a colored span; esc first to avoid XSS
  const escaped = esc(text);
  return escaped.replace(/@([\w\-\.]+)/g, (_, name) => {
    const color = agentColor(name);
    return \`<span class="at-highlight" style="color:\${color};background:\${color}22">@\${esc(name)}</span>\`;
  });
}

function showTyping(agentId) {
  const container = document.getElementById('messages');
  if (document.getElementById(\`typing-\${agentId}\`)) return;
  const el = document.createElement('div');
  el.id = \`typing-\${agentId}\`;
  el.innerHTML = \`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:12px;color:\${agentColor(agentId)};font-weight:700">\${esc(agentId)}</span>
      <div class="typing-indicator">
        <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
      </div>
    </div>
  \`;
  container.appendChild(el);
  scrollToBottom();
}

// ── SSE ──
function connectSse(roomId) {
  const dot = document.getElementById('status-dot');
  dot.className = '';

  evtSource = new EventSource(\`/groupchat/rooms/\${roomId}/events\`);

  evtSource.addEventListener('connected', () => {
    dot.className = 'live';
  });

  evtSource.addEventListener('message', (e) => {
    const entry = JSON.parse(e.data);
    if (entry.roomId !== currentRoomId) return;
    appendMessage(entry, true);
  });

  evtSource.addEventListener('broadcast_complete', () => {
    setBroadcastStatus('', '');
    // clear any leftover typing indicators
    document.querySelectorAll('[id^="typing-"]').forEach(el => el.remove());
  });

  evtSource.onerror = () => {
    dot.className = '';
    // auto-reconnect handled by browser EventSource
  };
}

// ── Send ──
async function sendMessage() {
  if (isBroadcasting || !currentRoomId) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  autoResize(input);
  isBroadcasting = true;
  document.getElementById('send-btn').disabled = true;

  // Parse @mentions to decide who gets typing indicators
  const members = currentRoom?.members ?? [];
  const mentionedInText = members.filter(m => text.includes('@' + m));
  const responders = mentionedInText.length > 0 ? mentionedInText : members;
  responders.forEach(m => showTyping(m));

  const statusMsg = mentionedInText.length > 0
    ? \`@点名 → 正在等待 \${mentionedInText.join(', ')} 回复…\`
    : \`正在广播给 \${members.length} 个成员…\`;
  setBroadcastStatus('active', statusMsg);

  try {
    await api('POST', \`/groupchat/rooms/\${currentRoomId}/messages\`, { from: 'user', text });
    setBroadcastStatus('', '');
  } catch(e) {
    setBroadcastStatus('error', '广播失败: ' + e.message);
    document.querySelectorAll('[id^="typing-"]').forEach(el => el.remove());
  } finally {
    isBroadcasting = false;
    document.getElementById('send-btn').disabled = false;
    input.focus();
  }
}

// ── New room modal ──
function openNewRoomModal() {
  document.getElementById('new-room-modal').classList.remove('hidden');
  document.getElementById('new-room-name').focus();
}
function closeNewRoomModal() {
  document.getElementById('new-room-modal').classList.add('hidden');
  document.getElementById('new-room-name').value = '';
  document.getElementById('new-room-members').value = '';
}
function closeModalOnOverlay(e) {
  if (e.target === e.currentTarget) closeNewRoomModal();
}
async function createRoom() {
  const name = document.getElementById('new-room-name').value.trim();
  const rawMembers = document.getElementById('new-room-members').value;
  const members = rawMembers.split('\\n').map(s => s.trim()).filter(Boolean);
  if (!name) { alert('请输入房间名称'); return; }

  try {
    const room = await api('POST', '/groupchat/rooms', { name, members });
    closeNewRoomModal();
    await loadRooms();
    selectRoom(room.id);
  } catch(e) {
    alert('创建失败: ' + e.message);
  }
}

// ── Helpers ──
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
function scrollToBottom() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}
function setBroadcastStatus(cls, msg) {
  const el = document.getElementById('broadcast-status');
  el.className = cls;
  el.textContent = msg;
}
function showError(msg) {
  setBroadcastStatus('error', msg);
}
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}
function formatDay(ts) {
  try {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return '今天';
    const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
    if (d.toDateString() === yesterday.toDateString()) return '昨天';
    return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  } catch { return ts.slice(0,10); }
}
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}
</script>
</body>
</html>`;
}
