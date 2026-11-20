import { isEventShape, type NostrEvent } from "../core/index.js";
import type { Filter } from "./filter.js";
import { WS_OPEN, type WebSocketConstructor, type WebSocketLike } from "./socket.js";

export interface RelayOptions {
  /** WebSocket implementation. Defaults to the global one (browsers, Node 22+). */
  WebSocket?: WebSocketConstructor;
  /** Give up connecting after this many milliseconds. Default 5000. */
  connectTimeoutMs?: number;
  /** Give up waiting for an answer after this many milliseconds. Default 8000. */
  timeoutMs?: number;
  /** Stop collecting after this many distinct events. Default 200. */
  maxEvents?: number;
  /** Ignore any relay message longer than this many characters. Default 262144. */
  maxMessageChars?: number;
}

export interface QueryResult {
  url: string;
  events: NostrEvent[];
  /** True when the relay said it had sent every stored match (EOSE). */
  complete: boolean;
  error?: string;
  notices: string[];
}

export interface PublishResult {
  url: string;
  ok: boolean;
  /** The relay's reason, or the failure that stopped us reaching it. */
  message: string;
}

interface Session<T> {
  onOpen(send: (message: unknown[]) => void): void;
  onMessage(message: unknown[], finish: (value: T) => void): void;
  onFailure(reason: string): T;
  /** Called before the socket closes, if it was open. */
  onFinish?(send: (message: unknown[]) => void): void;
}

const DEFAULTS = {
  connectTimeoutMs: 5000,
  timeoutMs: 8000,
  maxEvents: 200,
  maxMessageChars: 262_144,
};

function resolveWebSocket(options: RelayOptions): WebSocketConstructor | undefined {
  if (options.WebSocket) return options.WebSocket;
  return (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
}

/** Run one request on one connection. Never throws: failures become a value. */
function runSession<T>(url: string, options: RelayOptions, session: Session<T>): Promise<T> {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxChars = options.maxMessageChars ?? DEFAULTS.maxMessageChars;

  return new Promise<T>((resolve) => {
    if (!/^wss?:\/\//.test(url))
      return resolve(session.onFailure("relay URL must start with ws:// or wss://"));
    const Socket = resolveWebSocket(options);
    if (!Socket) return resolve(session.onFailure("no WebSocket implementation available"));

    let socket: WebSocketLike;
    try {
      socket = new Socket(url);
    } catch (error) {
      return resolve(session.onFailure(`could not connect: ${(error as Error).message}`));
    }

    let settled = false;
    let opened = false;
    const send = (message: unknown[]): void => {
      if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(message));
    };
    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(overallTimer);
      try {
        if (opened) session.onFinish?.(send);
        socket.close();
      } catch {
        // The socket is already gone.
      }
      resolve(value);
    };
    const fail = (reason: string): void => finish(session.onFailure(reason));

    const connectTimer = setTimeout(() => {
      if (!opened) fail("connection timed out");
    }, connectTimeoutMs);
    const overallTimer = setTimeout(() => fail("timed out waiting for the relay"), timeoutMs);

    socket.addEventListener("open", () => {
      opened = true;
      clearTimeout(connectTimer);
      try {
        session.onOpen(send);
      } catch (error) {
        fail(`could not send: ${(error as Error).message}`);
      }
    });
    socket.addEventListener("error", () => fail(opened ? "connection error" : "could not connect"));
    socket.addEventListener("close", () => fail("connection closed"));
    socket.addEventListener("message", (event) => {
      if (settled || typeof event.data !== "string" || event.data.length > maxChars) return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      session.onMessage(message, finish);
    });
  });
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Ask one relay for events. Returns whatever arrived, even on failure. Events
 * are checked only for NIP-01 shape: the relay is untrusted, so callers must
 * verify what they use.
 */
export function queryRelay(
  url: string,
  filters: Filter[],
  options: RelayOptions = {},
): Promise<QueryResult> {
  const maxEvents = options.maxEvents ?? DEFAULTS.maxEvents;
  const subscription = randomId();
  const events = new Map<string, NostrEvent>();
  const notices: string[] = [];
  const result = (complete: boolean, error?: string): QueryResult => ({
    url,
    events: [...events.values()],
    complete,
    notices,
    ...(error === undefined ? {} : { error }),
  });

  return runSession<QueryResult>(url, options, {
    onOpen: (send) => send(["REQ", subscription, ...filters]),
    onMessage: (message, finish) => {
      const [type, id, payload] = message;
      if (type === "EVENT" && id === subscription) {
        if (isEventShape(payload) && !events.has(payload.id)) events.set(payload.id, payload);
        if (events.size >= maxEvents) finish(result(false, "stopped at the event limit"));
      } else if (type === "EOSE" && id === subscription) {
        finish(result(true));
      } else if (type === "CLOSED" && id === subscription) {
        finish(result(false, `relay closed the subscription: ${String(payload ?? "")}`));
      } else if (type === "NOTICE" && typeof id === "string") {
        notices.push(id.slice(0, 200));
      }
    },
    onFailure: (reason) => result(false, reason),
    onFinish: (send) => send(["CLOSE", subscription]),
  });
}

/** Publish one event to one relay and report whether the relay accepted it. */
export function publishToRelay(
  url: string,
  event: NostrEvent,
  options: RelayOptions = {},
): Promise<PublishResult> {
  return runSession<PublishResult>(url, options, {
    onOpen: (send) => send(["EVENT", event]),
    onMessage: (message, finish) => {
      const [type, id, accepted, reason] = message;
      if (type === "OK" && id === event.id) {
        finish({ url, ok: accepted === true, message: typeof reason === "string" ? reason : "" });
      }
    },
    onFailure: (reason) => ({ url, ok: false, message: reason }),
  });
}
