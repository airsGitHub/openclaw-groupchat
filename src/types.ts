/**
 * openclaw-groupchat — shared types
 */

export interface Room {
  id: string;
  name: string;
  members: string[]; // agentIds
  createdAt: string;
}

export interface TranscriptEntry {
  ts: string;
  roomId: string;
  from: string;      // agentId or "user"
  text: string;
  mentions?: string[]; // agentIds explicitly @mentioned (only they reply)
}

export interface BroadcastResult {
  roomId: string;
  from: string;
  text: string;
  responses: Array<{ agentId: string; text: string; error?: string }>;
}

export interface GroupChatConfig {
  server: { host: string; port: number };
  storage: { dataDir: string };
  broadcast: { timeoutMs: number; maxHistoryContext: number };
}
