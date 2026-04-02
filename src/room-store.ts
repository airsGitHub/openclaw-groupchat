/**
 * openclaw-groupchat — room registry + transcript (file-based)
 *
 * Layout:
 *   dataDir/rooms/{roomId}.json     — Room metadata
 *   dataDir/transcripts/{roomId}.jsonl — TranscriptEntry lines
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Room, TranscriptEntry } from "./types.js";

export class RoomStore {
  private readonly roomsDir: string;
  private readonly transcriptsDir: string;

  constructor(dataDir: string) {
    this.roomsDir = path.join(dataDir, "rooms");
    this.transcriptsDir = path.join(dataDir, "transcripts");
    fs.mkdirSync(this.roomsDir, { recursive: true });
    fs.mkdirSync(this.transcriptsDir, { recursive: true });
  }

  // ---- Room CRUD ----

  createRoom(name: string, members: string[] = []): Room {
    const room: Room = {
      id: uuidv4(),
      name,
      members: [...new Set(members)],
      createdAt: new Date().toISOString(),
    };
    this.writeRoom(room);
    return room;
  }

  getRoom(id: string): Room | null {
    const file = this.roomFile(id);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as Room;
    } catch {
      return null;
    }
  }

  listRooms(): Room[] {
    const entries = fs.readdirSync(this.roomsDir);
    return entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(this.roomsDir, f), "utf-8"),
          ) as Room;
        } catch {
          return null;
        }
      })
      .filter((r): r is Room => r !== null);
  }

  deleteRoom(id: string): boolean {
    const file = this.roomFile(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  addMember(roomId: string, agentId: string): Room | null {
    const room = this.getRoom(roomId);
    if (!room) return null;
    if (!room.members.includes(agentId)) {
      room.members.push(agentId);
      this.writeRoom(room);
    }
    return room;
  }

  removeMember(roomId: string, agentId: string): Room | null {
    const room = this.getRoom(roomId);
    if (!room) return null;
    room.members = room.members.filter((m) => m !== agentId);
    this.writeRoom(room);
    return room;
  }

  // ---- Transcript ----

  appendTranscript(entry: TranscriptEntry): void {
    const file = this.transcriptFile(entry.roomId);
    fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
  }

  getTranscript(roomId: string, limit = 100): TranscriptEntry[] {
    const file = this.transcriptFile(roomId);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const entries: TranscriptEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as TranscriptEntry);
      } catch {
        // skip malformed lines
      }
    }
    return entries.slice(-limit);
  }

  // ---- helpers ----

  private roomFile(id: string): string {
    return path.join(this.roomsDir, `${id}.json`);
  }

  private transcriptFile(roomId: string): string {
    return path.join(this.transcriptsDir, `${roomId}.jsonl`);
  }

  private writeRoom(room: Room): void {
    fs.writeFileSync(this.roomFile(room.id), JSON.stringify(room, null, 2));
  }
}
