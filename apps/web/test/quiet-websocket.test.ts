// @vitest-environment node
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { QuietWebSocket } from "./quiet-websocket";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** A TCP server that accepts connections but never answers, so sockets stay connecting. */
async function stalledUrl(): Promise<string> {
  server = createServer(() => {}).listen(0, "127.0.0.1");
  await new Promise((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `ws://127.0.0.1:${address.port}`;
}

/** Close a connecting socket the way nostr-tools does, and collect what it emits. */
async function closeWhileConnecting(socket: WebSocket): Promise<{ errors: number }> {
  const result = { errors: 0 };
  socket.on("error", () => result.errors++);
  socket.onerror = null;
  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return result;
}

describe("QuietWebSocket", () => {
  it("emits the late error that nostr-tools leaves without a listener", async () => {
    // A plain ws socket emits it; here the test's own listener catches it.
    const plain = new WebSocket(await stalledUrl());
    expect(await closeWhileConnecting(plain)).toEqual({ errors: 1 });
  });

  it("always keeps a listener of its own, so that error is never uncaught", async () => {
    const quiet = new QuietWebSocket(await stalledUrl());
    expect(quiet.listenerCount("error")).toBe(1);
    quiet.onerror = null;
    expect(quiet.listenerCount("error")).toBe(1);
    expect(await closeWhileConnecting(quiet)).toEqual({ errors: 1 });
  });
});
