/**
 * openclaw-groupchat — Gateway RPC dispatcher
 *
 * Connects to OpenClaw's internal WebSocket Gateway and dispatches agent runs.
 * Adapted from a2a-gateway/src/executor.ts — same proven mechanism.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { v4 as uuidv4 } from "uuid";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ---------------------------------------------------------------------------
// Device identity (shared across connections in this process lifetime)
// ---------------------------------------------------------------------------

let cachedIdentity: {
  publicKey: string;
  privateKey: crypto.KeyObject;
  deviceId: string;
} | null = null;

function getDeviceIdentity() {
  if (cachedIdentity) return cachedIdentity;

  const openclawHome =
    process.env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw");
  const deviceJsonPath = path.join(openclawHome, "identity", "device.json");

  try {
    const raw = fs.readFileSync(deviceJsonPath, "utf-8");
    const json = JSON.parse(raw) as {
      deviceId?: string;
      publicKeyPem?: string;
      privateKeyPem?: string;
    };
    if (json.deviceId && json.publicKeyPem && json.privateKeyPem) {
      const privateKey = crypto.createPrivateKey(json.privateKeyPem);
      const publicKey = crypto.createPublicKey(json.publicKeyPem);
      const raw = publicKey.export({ type: "spki", format: "der" }).subarray(12);
      cachedIdentity = {
        publicKey: raw.toString("base64url"),
        privateKey,
        deviceId: json.deviceId,
      };
      return cachedIdentity;
    }
  } catch {
    // fallthrough to ephemeral
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawKey = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(12);
  cachedIdentity = {
    publicKey: rawKey.toString("base64url"),
    privateKey,
    deviceId: crypto.createHash("sha256").update(rawKey).digest("hex"),
  };
  return cachedIdentity;
}

// ---------------------------------------------------------------------------
// Gateway runtime config (read from api.config)
// ---------------------------------------------------------------------------

interface GatewayRuntimeConfig {
  port: number;
  wsUrl: string;
  gatewayToken: string;
  gatewayPassword: string;
}

function resolveGatewayConfig(api: OpenClawPluginApi): GatewayRuntimeConfig {
  const cfg = (api.config ?? {}) as Record<string, unknown>;
  const gw = (cfg.gateway ?? {}) as Record<string, unknown>;
  const gwAuth = (gw.auth ?? {}) as Record<string, unknown>;
  const gwTls = (gw.tls ?? {}) as Record<string, unknown>;

  const port = typeof gw.port === "number" ? gw.port : 18_789;
  const tls = gwTls.enabled === true;
  return {
    port,
    wsUrl: `${tls ? "wss" : "ws"}://localhost:${port}`,
    gatewayToken:
      typeof gwAuth.token === "string" ? gwAuth.token : "",
    gatewayPassword:
      typeof gwAuth.password === "string" ? gwAuth.password : "",
  };
}

// ---------------------------------------------------------------------------
// WebSocket types (runtime-supplied by OpenClaw)
// ---------------------------------------------------------------------------

interface GatewayWs {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void;
}

// ---------------------------------------------------------------------------
// GatewayRpcConnection
// ---------------------------------------------------------------------------

class GatewayRpcConnection {
  private ws: GatewayWs | null = null;
  private readonly pending = new Map<
    string,
    {
      expectFinal: boolean;
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private msgListener: ((e: { data?: unknown }) => void) | null = null;
  private closeListener: ((e: { data?: unknown }) => void) | null = null;
  private challengeNonce = "";
  private challengeResolve: ((nonce: string) => void) | null = null;
  private challengeReject: ((e: Error) => void) | null = null;
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly cfg: GatewayRuntimeConfig) {}

  async connect(): Promise<void> {
    const WsCtor = (
      globalThis as unknown as { WebSocket?: new (url: string) => GatewayWs }
    ).WebSocket;
    if (!WsCtor) throw new Error("WebSocket runtime unavailable");

    const ws = new WsCtor(this.cfg.wsUrl);
    this.ws = ws;

    this.msgListener = (e) => this.handleMessage(e);
    this.closeListener = () => {
      const err = new Error("gateway connection closed");
      this.challengeReject?.(err);
      this.rejectAll(err);
    };

    ws.addEventListener("message", this.msgListener);
    ws.addEventListener("close", this.closeListener);

    // wait for open
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("WebSocket open timeout")),
        10_000,
      );
      ws.addEventListener("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.addEventListener("error", (e) => {
        clearTimeout(t);
        reject(new Error(`WebSocket error: ${JSON.stringify(e)}`));
      });
    });

    // wait for connect.challenge
    const nonce = await new Promise<string>((resolve, reject) => {
      this.challengeResolve = resolve;
      this.challengeReject = reject;
      this.challengeTimer = setTimeout(
        () => reject(new Error("connect.challenge timeout")),
        2_000,
      );
    });
    this.challengeNonce = nonce;

    // authenticate
    const identity = getDeviceIdentity();
    const role = "operator";
    const scopes = [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
    ];
    const signedAt = Date.now();
    const payloadParts = [
      "v3",
      identity.deviceId,
      "cli",
      "cli",
      role,
      scopes.join(","),
      String(signedAt),
      this.cfg.gatewayToken,
      nonce,
      process.platform,
      "",
    ];
    const sig = crypto
      .sign(null, Buffer.from(payloadParts.join("|")), identity.privateKey)
      .toString("base64url");

    const connectId = uuidv4();
    const connectFrame = {
      type: "req",
      id: connectId,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "cli",
          version: "groupchat-plugin",
          platform: process.platform,
          mode: "cli",
          instanceId: uuidv4(),
        },
        role,
        scopes,
        auth: {
          token: this.cfg.gatewayToken,
          ...(this.cfg.gatewayPassword
            ? { password: this.cfg.gatewayPassword }
            : {}),
        },
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signedAt,
          nonce,
          signature: sig,
        },
      },
    };

    // Wait for the server to ack the connect before sending any other frames.
    // Without this, the next request() call races the connect handshake and the
    // server rejects it with "first request must be connect".
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("connect ack timeout")),
        10_000,
      );
      this.pending.set(connectId, {
        expectFinal: false,
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        timer,
      });
      ws.send(JSON.stringify(connectFrame));
    });
  }

  async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    expectFinal: boolean,
  ): Promise<unknown> {
    const id = uuidv4();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { expectFinal, resolve, reject, timer });
      this.ws!.send(
        JSON.stringify({ type: "req", id, method, params }),
      );
    });
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      if (this.msgListener)
        ws.removeEventListener("message", this.msgListener);
      if (this.closeListener)
        ws.removeEventListener("close", this.closeListener);
      ws.close();
    }
    this.rejectAll(new Error("gateway connection closed"));
  }

  private handleMessage(e: { data?: unknown }): void {
    const raw = typeof e.data === "string" ? e.data : "";
    if (!raw) return;

    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        const payload = frame.payload as Record<string, unknown> | undefined;
        const nonce =
          typeof payload?.nonce === "string" ? payload.nonce.trim() : "";
        if (nonce && this.challengeResolve) {
          if (this.challengeTimer) clearTimeout(this.challengeTimer);
          this.challengeTimer = null;
          this.challengeResolve(nonce);
          this.challengeResolve = null;
          this.challengeReject = null;
        }
      }
      return;
    }

    if (frame.type !== "res") return;
    const id = typeof frame.id === "string" ? frame.id : "";
    if (!id) return;

    const pending = this.pending.get(id);
    if (!pending) return;

    if (pending.expectFinal) {
      const payload = frame.payload as Record<string, unknown> | undefined;
      if (payload?.status === "accepted") return; // intermediate ack, keep waiting
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    const err =
      typeof (frame.error as Record<string, unknown> | undefined)?.message ===
      "string"
        ? new Error(
            (frame.error as Record<string, unknown>).message as string,
          )
        : null;

    if (err) {
      pending.reject(err);
    } else {
      pending.resolve(frame.payload);
    }
  }

  private rejectAll(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch a single message to one agent via the OpenClaw Gateway WebSocket.
 * Returns the agent's response text, or throws on failure/timeout.
 */
export async function dispatchToAgent(
  api: OpenClawPluginApi,
  agentId: string,
  message: string,
  sessionKey: string,
  timeoutMs: number,
): Promise<string> {
  const cfg = resolveGatewayConfig(api);
  const gw = new GatewayRpcConnection(cfg);
  await gw.connect();

  try {
    const runId = uuidv4();
    const payload = await gw.request(
      "agent",
      { agentId, message, deliver: false, idempotencyKey: runId, sessionKey },
      timeoutMs,
      true,
    );

    const body = payload as Record<string, unknown> | undefined;
    const status = typeof body?.status === "string" ? body.status : "";
    if (status && status !== "ok") {
      const summary =
        typeof body?.summary === "string"
          ? body.summary
          : "agent run did not complete";
      throw new Error(summary);
    }

    // Extract text from payloads
    const result = (body?.result ?? {}) as Record<string, unknown>;
    const payloads = Array.isArray(result.payloads) ? result.payloads : [];
    const texts = payloads
      .map((p: unknown) => extractText(p))
      .filter((t): t is string => Boolean(t));

    if (texts.length > 0) return texts.join("\n\n");

    // Fallback: fetch from history
    const hist = (await gw.request(
      "chat.history",
      { sessionKey, limit: 10 },
      10_000,
      false,
    )) as Record<string, unknown> | undefined;
    const messages = Array.isArray(hist?.messages) ? hist.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as Record<string, unknown>;
      if (m.role === "assistant") {
        const t = extractText(m);
        if (t) return t;
      }
    }

    throw new Error("no response text from agent");
  } finally {
    gw.close();
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object") return undefined;

  const obj = value as Record<string, unknown>;

  if (obj.kind === "text" && typeof obj.text === "string") {
    return obj.text.trim() || undefined;
  }

  const parts = Array.isArray(obj.parts) ? obj.parts : [];
  if (parts.length > 0) {
    const texts = parts
      .map((p) => extractText(p))
      .filter((t): t is string => Boolean(t));
    return texts.join("\n") || undefined;
  }

  if (typeof obj.text === "string") return obj.text.trim() || undefined;

  const payloads = Array.isArray(obj.payloads) ? obj.payloads : [];
  if (payloads.length > 0) {
    const texts = payloads
      .map((p) => extractText(p))
      .filter((t): t is string => Boolean(t));
    return texts.join("\n") || undefined;
  }

  return undefined;
}
