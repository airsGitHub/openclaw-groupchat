/**
 * openclaw-groupchat — SSE connection manager
 *
 * Tracks open SSE connections per room and broadcasts events to them.
 */

import type { Response } from "express";

export interface SseEvent {
  event: string;
  data: unknown;
}

export class SseManager {
  /** roomId → set of express Response objects */
  private readonly clients: Map<string, Set<Response>> = new Map();

  add(roomId: string, res: Response): void {
    if (!this.clients.has(roomId)) {
      this.clients.set(roomId, new Set());
    }
    this.clients.get(roomId)!.add(res);
  }

  remove(roomId: string, res: Response): void {
    this.clients.get(roomId)?.delete(res);
  }

  /** Push an SSE event to all clients listening to a room. */
  emit(roomId: string, event: SseEvent): void {
    const room = this.clients.get(roomId);
    if (!room || room.size === 0) return;

    const payload = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const res of room) {
      try {
        res.write(payload);
      } catch {
        room.delete(res);
      }
    }
  }

  clientCount(roomId: string): number {
    return this.clients.get(roomId)?.size ?? 0;
  }
}
