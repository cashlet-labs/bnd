import { deriveNostrKey, signEvent, type NostrEvent } from "@cashlet-labs/bnd-core";
import type { WebSocketConstructor } from "../src/socket.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";

export const alice = deriveNostrKey(MNEMONIC, 0);
export const bob = deriveNostrKey(MNEMONIC, 1);

export function makeEvent(
  key: { privateKey: Uint8Array },
  fields: { kind?: number; created_at?: number; tags?: string[][]; content?: string } = {},
): NostrEvent {
  return signEvent(key.privateKey, {
    kind: fields.kind ?? 1,
    created_at: fields.created_at ?? 1_700_000_000,
    tags: fields.tags ?? [],
    content: fields.content ?? "",
  });
}

/** Collects the messages a relay sends to one connection. */
export function capture(): { messages: unknown[][]; send: (raw: string) => void } {
  const messages: unknown[][] = [];
  return { messages, send: (raw) => messages.push(JSON.parse(raw) as unknown[]) };
}

/**
 * A WebSocket whose relay side is a function. `onClientMessage` gets each parsed
 * message the client sends and a `reply` function that sends raw text back.
 */
export function scriptedSocket(
  onClientMessage: (message: unknown[], reply: (raw: string) => void) => void,
  log: unknown[][] = [],
): WebSocketConstructor {
  return class ScriptedSocket {
    readyState = 0;
    private listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};

    constructor(_url: string) {
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open");
      });
    }

    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
      (this.listeners[type] ??= []).push(listener);
    }

    send(data: string): void {
      const message = JSON.parse(data) as unknown[];
      log.push(message);
      onClientMessage(message, (raw) => queueMicrotask(() => this.emit("message", { data: raw })));
    }

    close(): void {
      this.readyState = 3;
    }

    private emit(type: string, event: { data?: unknown } = {}): void {
      for (const listener of this.listeners[type] ?? []) listener(event);
    }
  };
}
