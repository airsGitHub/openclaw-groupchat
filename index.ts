/**
 * openclaw-groupchat — Group chat bus plugin
 *
 * Exposes an HTTP server (default :18900) with:
 *   REST API  — room/member management + message broadcast
 *   SSE       — real-time room events
 *   Agent tools — groupchat_send, groupchat_rooms, groupchat_history
 *
 * How broadcast works:
 *   POST /groupchat/rooms/:id/messages { from, text }
 *   → appends to room transcript
 *   → dispatches message (with history context) to every member except sender, in parallel
 *   → collects responses, appends them to transcript
 *   → SSE-pushes all events to connected clients
 *   → returns { responses: [{agentId, text}] }
 */

import os from "node:os";
import path from "node:path";
import express, { type Request, type Response } from "express";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { RoomStore } from "./src/room-store.js";
import { SseManager } from "./src/sse.js";
import { dispatchToAgent } from "./src/dispatcher.js";
import { getDashboardHtml } from "./src/dashboard.js";
import type { GroupChatConfig, TranscriptEntry } from "./src/types.js";

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

function parseConfig(raw: unknown): GroupChatConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const server = (cfg.server ?? {}) as Record<string, unknown>;
  const storage = (cfg.storage ?? {}) as Record<string, unknown>;
  const broadcast = (cfg.broadcast ?? {}) as Record<string, unknown>;

  const dataDir =
    typeof storage.dataDir === "string" && storage.dataDir.trim()
      ? storage.dataDir.trim().replace(/^~/, os.homedir())
      : path.join(os.homedir(), ".openclaw", "groupchat");

  return {
    server: {
      host: typeof server.host === "string" ? server.host : "0.0.0.0",
      port: typeof server.port === "number" ? server.port : 18900,
    },
    storage: { dataDir },
    broadcast: {
      timeoutMs:
        typeof broadcast.timeoutMs === "number" ? broadcast.timeoutMs : 120_000,
      maxHistoryContext:
        typeof broadcast.maxHistoryContext === "number"
          ? broadcast.maxHistoryContext
          : 20,
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

const plugin = {
  id: "openclaw-groupchat",
  name: "Group Chat",
  description: "Parallel broadcast group chat bus for OpenClaw agents",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);
    const store = new RoomStore(config.storage.dataDir);
    const sse = new SseManager();

    // ---- Agent tools ----

    if (api.registerTool) {
      // groupchat_send
      api.registerTool({
        name: "groupchat_send",
        description:
          "Send a message to a group chat room. All other members of the room will receive and respond to your message in parallel. Returns each member's response.",
        label: "Group Chat: Send",
        parameters: {
          type: "object" as const,
          required: ["roomId", "text"],
          properties: {
            roomId: {
              type: "string" as const,
              description: "Room ID (use groupchat_rooms to list available rooms)",
            },
            text: {
              type: "string" as const,
              description: "Message text to send to the room",
            },
            from: {
              type: "string" as const,
              description:
                "Your agentId (sender name shown in transcript). Omit to use 'user'.",
            },
          },
        },
        async execute(_toolCallId, params) {
          const roomId = params.roomId as string;
          const text = params.text as string;
          const from = (params.from as string | undefined) ?? "user";

          const room = store.getRoom(roomId);
          if (!room) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Room not found: "${roomId}". Use groupchat_rooms to list available rooms.`,
                },
              ],
              details: { ok: false },
            };
          }

          const result = await broadcastMessage(
            api,
            store,
            sse,
            config,
            room.id,
            from,
            text,
          );

          const summary =
            result.responses.length === 0
              ? "No other members in room."
              : result.responses
                  .map((r) =>
                    r.error
                      ? `[${r.agentId}] Error: ${r.error}`
                      : `[${r.agentId}]: ${r.text}`,
                  )
                  .join("\n\n");

          return {
            content: [{ type: "text" as const, text: summary }],
            details: result,
          };
        },
      });

      // groupchat_rooms
      api.registerTool({
        name: "groupchat_rooms",
        description: "List all available group chat rooms and their members.",
        label: "Group Chat: List Rooms",
        parameters: {
          type: "object" as const,
          required: [],
          properties: {},
        },
        async execute() {
          const rooms = store.listRooms();
          if (rooms.length === 0) {
            return {
              content: [
                { type: "text" as const, text: "No group chat rooms exist yet." },
              ],
              details: { rooms: [] },
            };
          }
          const lines = rooms.map(
            (r) =>
              `• ${r.name} (id: ${r.id}) — members: ${r.members.join(", ") || "(none)"}`,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `Group chat rooms:\n${lines.join("\n")}`,
              },
            ],
            details: { rooms },
          };
        },
      });

      // groupchat_history
      api.registerTool({
        name: "groupchat_history",
        description:
          "Read recent message history from a group chat room.",
        label: "Group Chat: History",
        parameters: {
          type: "object" as const,
          required: ["roomId"],
          properties: {
            roomId: { type: "string" as const, description: "Room ID" },
            limit: {
              type: "number" as const,
              description: "Max messages to return (default 20)",
            },
          },
        },
        async execute(_toolCallId, params) {
          const roomId = params.roomId as string;
          const limit = (params.limit as number | undefined) ?? 20;

          const room = store.getRoom(roomId);
          if (!room) {
            return {
              content: [
                { type: "text" as const, text: `Room not found: "${roomId}"` },
              ],
              details: { ok: false },
            };
          }

          const entries = store.getTranscript(roomId, limit);
          if (entries.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No messages in room "${room.name}" yet.`,
                },
              ],
              details: { entries: [] },
            };
          }

          const lines = entries.map(
            (e) => `[${e.ts.slice(0, 19)}] ${e.from}: ${e.text}`,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `Recent messages in "${room.name}":\n${lines.join("\n")}`,
              },
            ],
            details: { entries },
          };
        },
      });
    }

    // ---- HTTP service ----

    if (!api.registerService) {
      api.logger.warn(
        "openclaw-groupchat: registerService unavailable; HTTP server not started",
      );
      return;
    }

    const app = express();
    app.use(express.json());

    // GET /groupchat/ — dashboard UI
    app.get("/groupchat", (_req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(getDashboardHtml());
    });
    app.get("/groupchat/", (_req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(getDashboardHtml());
    });

    // POST /groupchat/rooms — create room
    app.post("/groupchat/rooms", (req: Request, res: Response) => {
      const { name, members } = req.body as {
        name?: string;
        members?: string[];
      };
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const room = store.createRoom(
        name,
        Array.isArray(members) ? members : [],
      );
      api.logger.info(`openclaw-groupchat: created room "${room.name}" (${room.id})`);
      res.status(201).json(room);
    });

    // GET /groupchat/rooms — list rooms
    app.get("/groupchat/rooms", (_req: Request, res: Response) => {
      res.json(store.listRooms());
    });

    // GET /groupchat/rooms/:id — get room
    app.get("/groupchat/rooms/:id", (req: Request<{ id: string }>, res: Response) => {
      const room = store.getRoom(req.params.id);
      if (!room) {
        res.status(404).json({ error: "room not found" });
        return;
      }
      res.json(room);
    });

    // DELETE /groupchat/rooms/:id — delete room
    app.delete("/groupchat/rooms/:id", (req: Request<{ id: string }>, res: Response) => {
      const ok = store.deleteRoom(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "room not found" });
        return;
      }
      api.logger.info(`openclaw-groupchat: deleted room ${req.params.id}`);
      res.json({ ok: true });
    });

    // POST /groupchat/rooms/:id/members — add member
    app.post(
      "/groupchat/rooms/:id/members",
      (req: Request<{ id: string }>, res: Response) => {
        const { agentId } = req.body as { agentId?: string };
        if (!agentId || typeof agentId !== "string") {
          res.status(400).json({ error: "agentId is required" });
          return;
        }
        const room = store.addMember(req.params.id, agentId);
        if (!room) {
          res.status(404).json({ error: "room not found" });
          return;
        }
        res.json(room);
      },
    );

    // DELETE /groupchat/rooms/:id/members/:agentId — remove member
    app.delete(
      "/groupchat/rooms/:id/members/:agentId",
      (req: Request<{ id: string; agentId: string }>, res: Response) => {
        const room = store.removeMember(req.params.id, req.params.agentId);
        if (!room) {
          res.status(404).json({ error: "room not found" });
          return;
        }
        res.json(room);
      },
    );

    // POST /groupchat/rooms/:id/messages — send + broadcast
    app.post(
      "/groupchat/rooms/:id/messages",
      async (req: Request<{ id: string }>, res: Response) => {
        const { from, text } = req.body as { from?: string; text?: string };
        if (!text || typeof text !== "string") {
          res.status(400).json({ error: "text is required" });
          return;
        }
        const sender = from && typeof from === "string" ? from : "user";
        const room = store.getRoom(req.params.id);
        if (!room) {
          res.status(404).json({ error: "room not found" });
          return;
        }

        try {
          const result = await broadcastMessage(
            api,
            store,
            sse,
            config,
            room.id,
            sender,
            text,
          );
          res.json(result);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          api.logger.error(`openclaw-groupchat: broadcast error: ${msg}`);
          res.status(500).json({ error: msg });
        }
      },
    );

    // GET /groupchat/rooms/:id/transcript — message history
    app.get(
      "/groupchat/rooms/:id/transcript",
      (req: Request<{ id: string }>, res: Response) => {
        const room = store.getRoom(req.params.id);
        if (!room) {
          res.status(404).json({ error: "room not found" });
          return;
        }
        const rawLimit = req.query.limit;
        const limit = parseInt(
          typeof rawLimit === "string" ? rawLimit : "100",
          10,
        );
        res.json(store.getTranscript(req.params.id, isNaN(limit) ? 100 : limit));
      },
    );

    // GET /groupchat/rooms/:id/events — SSE stream
    app.get("/groupchat/rooms/:id/events", (req: Request<{ id: string }>, res: Response) => {
      const room = store.getRoom(req.params.id);
      if (!room) {
        res.status(404).json({ error: "room not found" });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      sse.add(req.params.id, res);

      // send welcome event
      res.write(
        `event: connected\ndata: ${JSON.stringify({ roomId: req.params.id, roomName: room.name })}\n\n`,
      );

      req.on("close", () => {
        sse.remove(req.params.id, res);
      });
    });

    // GET /groupchat/health
    app.get("/groupchat/health", (_req, res) => {
      res.json({ ok: true, rooms: store.listRooms().length });
    });

    let server: ReturnType<typeof app.listen> | null = null;

    api.registerService({
      id: "openclaw-groupchat",
      async start() {
        if (server) return;
        await new Promise<void>((resolve, reject) => {
          server = app.listen(
            config.server.port,
            config.server.host,
            () => {
              api.logger.info(
                `openclaw-groupchat: listening on ${config.server.host}:${config.server.port}`,
              );
              resolve();
            },
          );
          server!.once("error", reject);
        });
      },
      async stop() {
        await new Promise<void>((resolve) => {
          if (!server) {
            resolve();
            return;
          }
          server.close(() => resolve());
          server = null;
        });
      },
    });
  },
};

export default plugin;

// ---------------------------------------------------------------------------
// Core broadcast logic (shared by REST endpoint and agent tool)
// ---------------------------------------------------------------------------

async function broadcastMessage(
  api: OpenClawPluginApi,
  store: RoomStore,
  sse: SseManager,
  config: GroupChatConfig,
  roomId: string,
  from: string,
  text: string,
) {
  const room = store.getRoom(roomId);
  if (!room) throw new Error(`room not found: ${roomId}`);

  // 1. Append sender's message to transcript
  const senderEntry: TranscriptEntry = {
    ts: new Date().toISOString(),
    roomId,
    from,
    text,
  };
  store.appendTranscript(senderEntry);
  sse.emit(roomId, { event: "message", data: senderEntry });

  // 2. Build context: recent history BEFORE this message
  const history = store
    .getTranscript(roomId, config.broadcast.maxHistoryContext + 1)
    .slice(0, -1); // exclude the message we just appended

  // 3. Build message text for agents
  const agentMsg = buildAgentMessage(room.name, history, from, text);

  // 4. Dispatch to all members except sender, in parallel
  const targets = room.members.filter((m) => m !== from);

  const responses = await Promise.all(
    targets.map(async (agentId) => {
      const sessionKey = `groupchat:${roomId}:${agentId}`;
      try {
        const responseText = await dispatchToAgent(
          api,
          agentId,
          agentMsg,
          sessionKey,
          config.broadcast.timeoutMs,
        );

        // Append response to transcript
        const responseEntry: TranscriptEntry = {
          ts: new Date().toISOString(),
          roomId,
          from: agentId,
          text: responseText,
        };
        store.appendTranscript(responseEntry);
        sse.emit(roomId, { event: "message", data: responseEntry });

        api.logger.info(
          `openclaw-groupchat: [${room.name}] ${agentId} responded (${responseText.length} chars)`,
        );
        return { agentId, text: responseText };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        api.logger.warn(
          `openclaw-groupchat: [${room.name}] dispatch to ${agentId} failed: ${errMsg}`,
        );
        return { agentId, text: "", error: errMsg };
      }
    }),
  );

  // 5. SSE: broadcast completed event
  sse.emit(roomId, {
    event: "broadcast_complete",
    data: { from, responses },
  });

  return { roomId, from, text, responses };
}

function buildAgentMessage(
  roomName: string,
  history: TranscriptEntry[],
  from: string,
  text: string,
): string {
  const lines: string[] = [`[群聊: ${roomName}]`];

  if (history.length > 0) {
    lines.push("--- 最近消息 ---");
    for (const entry of history) {
      lines.push(`${entry.from}: ${entry.text}`);
    }
    lines.push("---");
  }

  lines.push(`${from}: ${text}`);
  return lines.join("\n");
}
