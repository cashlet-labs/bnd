import type { MemoryRelay, RelaySession } from "./memory-relay.js";
import type { WebSocketConstructor, WebSocketLike } from "./socket.js";

export interface MemorySocketOptions {
  /**
   * What each URL does. A relay serves requests. `"refuse"` fails to connect.
   * `"hang"` never finishes connecting. `"drop"` connects and then closes
   * the moment the client sends anything. Unknown URLs refuse.
   */
  relays: Record<string, MemoryRelay | "refuse" | "hang" | "drop">;
}

type Listener = (event: { data?: unknown }) => void;

/**
 * Build a WebSocket constructor whose connections go to in-memory relays.
 * Pass it to the client in tests so no network is used.
 */
export function createMemoryWebSocket(options: MemorySocketOptions): WebSocketConstructor {
  return class MemoryWebSocket implements WebSocketLike {
    readyState = 0;
    private readonly listeners: Record<string, Listener[]> = {};
    private session: RelaySession | undefined;
    private readonly mode: MemoryRelay | "refuse" | "hang" | "drop";

    constructor(url: string) {
      this.mode = options.relays[url] ?? "refuse";
      queueMicrotask(() => {
        if (this.mode === "hang" || this.readyState === 3) return;
        if (this.mode === "refuse") {
          this.readyState = 3;
          this.emit("error");
          this.emit("close");
          return;
        }
        if (this.mode !== "drop") {
          this.session = this.mode.connect((message) => {
            queueMicrotask(() => {
              if (this.readyState === 1) this.emit("message", { data: message });
            });
          });
        }
        this.readyState = 1;
        this.emit("open");
      });
    }

    addEventListener(type: string, listener: Listener): void {
      (this.listeners[type] ??= []).push(listener);
    }

    send(data: string): void {
      if (this.readyState !== 1) throw new Error("socket is not open");
      if (this.mode === "drop") {
        queueMicrotask(() => this.close());
        return;
      }
      const session = this.session;
      queueMicrotask(() => session?.receive(data));
    }

    close(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.session?.close();
      queueMicrotask(() => this.emit("close"));
    }

    private emit(type: string, event: { data?: unknown } = {}): void {
      for (const listener of this.listeners[type] ?? []) listener(event);
    }
  };
}
