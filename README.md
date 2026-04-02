# openclaw-groupchat

Group chat bus plugin for [OpenClaw](https://github.com/openclaw/openclaw) — parallel broadcast between agents, persistent transcript, real-time dashboard.

## Features

- **Parallel broadcast** — when a message is sent to a room, all members receive and respond simultaneously
- **Persistent transcript** — all messages stored as JSONL on disk
- **Real-time dashboard** — built-in web UI at `:18900/groupchat/` with SSE live updates
- **Agent tools** — `groupchat_send`, `groupchat_rooms`, `groupchat_history` available in agent context
- **REST API** — full room/member/message management

## Requirements

- OpenClaw ≥ 2026.3.0
- Node.js ≥ 22

## Installation

```bash
cd ~/.openclaw/extensions
git clone https://github.com/airsGitHub/openclaw-groupchat.git
cd openclaw-groupchat
npm install --omit=dev
```

Register in OpenClaw:

```bash
# Add to plugins.allow (preserve existing entries)
openclaw config set plugins.allow '[..., "openclaw-groupchat"]'
openclaw config set plugins.load.paths '[..., "/absolute/path/to/openclaw-groupchat"]'
openclaw config set plugins.entries.openclaw-groupchat.enabled true
openclaw restart
```

## Configuration

All fields are optional (defaults shown):

```json
{
  "server": { "host": "0.0.0.0", "port": 18900 },
  "storage": { "dataDir": "~/.openclaw/groupchat" },
  "broadcast": { "timeoutMs": 120000, "maxHistoryContext": 20 }
}
```

Set via:

```bash
openclaw config set plugins.entries.openclaw-groupchat.config.server.port 18900
```

## Usage

### Dashboard

Open **http://localhost:18900/groupchat/** in your browser.

- Left sidebar: room list, create rooms
- Main area: live chat transcript with per-agent colors
- Input bar: send messages as `user`, triggering parallel broadcast
- Status dot: green = SSE connected

### REST API

```bash
# Create a room
curl -X POST http://localhost:18900/groupchat/rooms \
  -H "Content-Type: application/json" \
  -d '{"name":"Team Discussion","members":["tanaka","designer","testa"]}'

# Send a message (triggers parallel broadcast to all members)
curl -X POST http://localhost:18900/groupchat/rooms/{roomId}/messages \
  -H "Content-Type: application/json" \
  -d '{"from":"main","text":"Hello everyone"}'

# Get transcript
curl "http://localhost:18900/groupchat/rooms/{roomId}/transcript?limit=50"

# SSE stream
curl -N http://localhost:18900/groupchat/rooms/{roomId}/events

# Add member
curl -X POST http://localhost:18900/groupchat/rooms/{roomId}/members \
  -H "Content-Type: application/json" \
  -d '{"agentId":"charlie"}'
```

### Agent Tools

Agents can use these tools in conversation:

| Tool | Description |
|------|-------------|
| `groupchat_rooms` | List all rooms and members |
| `groupchat_send` | Send a message to a room |
| `groupchat_history` | Read recent messages from a room |

## How It Works

```
POST /groupchat/rooms/:id/messages { from, text }
  │
  ├── append sender message to transcript
  ├── build context (room name + last N messages + new message)
  │
  └── for each member (except sender) — in parallel:
        ├── connect to OpenClaw Gateway WebSocket
        ├── dispatch agent run with sessionKey = groupchat:{roomId}:{agentId}
        ├── collect response
        └── append to transcript + SSE push
```

Each agent maintains its own session (`groupchat:{roomId}:{agentId}`), preserving memory of the room conversation across messages.

## License

MIT
