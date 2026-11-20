import { MemoryRelay } from "@cashlet-labs/bnd-nostr/testing";
import { WebSocketServer } from "ws";
import { bndWritePolicy } from "./policy.js";

export interface DevRelay {
  /** The WebSocket URL clients connect to, for example `ws://127.0.0.1:7777`. */
  url: string;
  relay: MemoryRelay;
  close(): Promise<void>;
}

export interface DevRelayOptions {
  /** Port to listen on. 0 picks a free one. Default 0. */
  port?: number;
  /** Interface to bind. Defaults to loopback only. */
  host?: string;
  /**
   * Apply the Cashlet relays' rules for BND events: bindings must verify, a
   * stored binding can only be replaced by its successor, and bindings
   * cannot be deleted. Default true.
   */
  enforceSuccession?: boolean;
}

/**
 * Serve an in-memory relay over WebSocket. It keeps events in memory only and
 * is meant for demos and tests on one machine, not for the public internet.
 */
export async function startDevRelay(options: DevRelayOptions = {}): Promise<DevRelay> {
  const relay = new MemoryRelay(
    options.enforceSuccession === false ? {} : { writePolicy: bndWritePolicy },
  );
  const host = options.host ?? "127.0.0.1";
  const server = new WebSocketServer({ port: options.port ?? 0, host, maxPayload: 262_144 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  server.on("connection", (socket) => {
    const session = relay.connect((message) => {
      if (socket.readyState === socket.OPEN) socket.send(message);
    });
    socket.on("message", (data) => session.receive(data.toString()));
    socket.on("close", () => session.close());
    socket.on("error", () => session.close());
  });

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("relay did not start");
  return {
    url: `ws://${host}:${address.port}`,
    relay,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}
