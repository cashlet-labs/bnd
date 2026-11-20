import { describe, expect, it } from "vitest";
import { publishToRelay, queryRelay } from "../../src/nostr/client.js";
import { MemoryRelay } from "../../src/nostr/memory-relay.js";
import { createMemoryWebSocket } from "../../src/nostr/memory-socket.js";
import { alice, bob, makeEvent, scriptedSocket } from "./helpers.js";

const URL = "wss://relay.test";

function relayWith(...events: ReturnType<typeof makeEvent>[]) {
  const relay = new MemoryRelay();
  for (const event of events) relay.seed(event);
  return { relay, WebSocket: createMemoryWebSocket({ relays: { [URL]: relay } }) };
}

describe("queryRelay", () => {
  it("returns stored events and reports completion", async () => {
    const event = makeEvent(alice);
    const { WebSocket } = relayWith(event);
    const result = await queryRelay(URL, [{ kinds: [1] }], { WebSocket });
    expect(result).toEqual({ url: URL, events: [event], complete: true, notices: [] });
  });

  it("returns nothing without error when nothing matches", async () => {
    const { WebSocket } = relayWith(makeEvent(alice));
    const result = await queryRelay(URL, [{ authors: [bob.publicKey] }], { WebSocket });
    expect(result).toMatchObject({ events: [], complete: true });
    expect(result.error).toBeUndefined();
  });

  it("reports a relay that refuses the connection", async () => {
    const WebSocket = createMemoryWebSocket({ relays: { [URL]: "refuse" } });
    const result = await queryRelay(URL, [{}], { WebSocket });
    expect(result).toMatchObject({ events: [], complete: false, error: "could not connect" });
  });

  it("reports an unknown relay", async () => {
    const WebSocket = createMemoryWebSocket({ relays: {} });
    expect((await queryRelay("wss://other.test", [{}], { WebSocket })).error).toBe(
      "could not connect",
    );
  });

  it("times out a relay that never finishes connecting", async () => {
    const WebSocket = createMemoryWebSocket({ relays: { [URL]: "hang" } });
    const result = await queryRelay(URL, [{}], { WebSocket, connectTimeoutMs: 20, timeoutMs: 500 });
    expect(result.error).toBe("connection timed out");
  });

  it("reports a relay that drops the connection", async () => {
    const WebSocket = createMemoryWebSocket({ relays: { [URL]: "drop" } });
    const result = await queryRelay(URL, [{}], { WebSocket });
    expect(result).toMatchObject({ complete: false, error: "connection closed" });
  });

  it("returns partial events when the relay never sends EOSE", async () => {
    const event = makeEvent(alice);
    const WebSocket = scriptedSocket((message, reply) => {
      reply(JSON.stringify(["EVENT", message[1], event]));
    });
    const result = await queryRelay(URL, [{}], { WebSocket, timeoutMs: 30 });
    expect(result.events).toEqual([event]);
    expect(result).toMatchObject({ complete: false, error: "timed out waiting for the relay" });
  });

  it("reports a subscription the relay closes", async () => {
    const relay = new MemoryRelay();
    const WebSocket = createMemoryWebSocket({ relays: { [URL]: relay } });
    const result = await queryRelay(URL, [{ kinds: ["x"] } as never], { WebSocket });
    expect(result.error).toBe("relay closed the subscription: invalid: bad filter");
  });

  it("ignores events for other subscriptions, bad shapes and junk", async () => {
    const good = makeEvent(alice);
    const WebSocket = scriptedSocket((message, reply) => {
      reply("not json");
      reply('{"a":1}');
      reply(JSON.stringify(["EVENT", "other-subscription", makeEvent(bob)]));
      reply(JSON.stringify(["EVENT", message[1], { id: "x" }]));
      reply(JSON.stringify(["EVENT", message[1], good]));
      reply(JSON.stringify(["EOSE", message[1]]));
    });
    const result = await queryRelay(URL, [{}], { WebSocket });
    expect(result.events).toEqual([good]);
    expect(result.complete).toBe(true);
  });

  it("ignores an EOSE for another subscription", async () => {
    const WebSocket = scriptedSocket((_message, reply) => {
      reply(JSON.stringify(["EOSE", "other-subscription"]));
    });
    const result = await queryRelay(URL, [{}], { WebSocket, timeoutMs: 30 });
    expect(result.complete).toBe(false);
  });

  it("ignores messages that are too long", async () => {
    const good = makeEvent(alice, { content: "x".repeat(500) });
    const WebSocket = scriptedSocket((message, reply) => {
      reply(JSON.stringify(["EVENT", message[1], good]));
      reply(JSON.stringify(["EOSE", message[1]]));
    });
    const result = await queryRelay(URL, [{}], { WebSocket, maxMessageChars: 200 });
    expect(result.events).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("removes duplicates and stops at the event limit", async () => {
    const events = [1, 2, 3, 4].map((n) => makeEvent(alice, { created_at: n, content: `${n}` }));
    const WebSocket = scriptedSocket((message, reply) => {
      for (const event of [...events, events[0]])
        reply(JSON.stringify(["EVENT", message[1], event]));
      reply(JSON.stringify(["EOSE", message[1]]));
    });
    const all = await queryRelay(URL, [{}], { WebSocket });
    expect(all.events).toHaveLength(4);
    const limited = await queryRelay(URL, [{}], { WebSocket, maxEvents: 2 });
    expect(limited.events).toHaveLength(2);
    expect(limited.error).toBe("stopped at the event limit");
  });

  it("collects notices and shortens long ones", async () => {
    const WebSocket = scriptedSocket((message, reply) => {
      reply(JSON.stringify(["NOTICE", "n".repeat(500)]));
      reply(JSON.stringify(["EOSE", message[1]]));
    });
    const result = await queryRelay(URL, [{}], { WebSocket });
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toHaveLength(200);
  });

  it("closes the subscription when it is done", async () => {
    const log: unknown[][] = [];
    const WebSocket = scriptedSocket(
      (message, reply) => reply(JSON.stringify(["EOSE", message[1]])),
      log,
    );
    await queryRelay(URL, [{ kinds: [1] }], { WebSocket });
    expect(log.map((m) => m[0])).toEqual(["REQ", "CLOSE"]);
    expect(log[0]![2]).toEqual({ kinds: [1] });
    expect(log[1]![1]).toBe(log[0]![1]);
  });

  it("sends several filters in one request", async () => {
    const log: unknown[][] = [];
    const WebSocket = scriptedSocket(
      (message, reply) => reply(JSON.stringify(["EOSE", message[1]])),
      log,
    );
    await queryRelay(URL, [{ kinds: [1] }, { kinds: [2] }], { WebSocket });
    expect(log[0]!.slice(2)).toEqual([{ kinds: [1] }, { kinds: [2] }]);
  });

  it("rejects a URL that is not a WebSocket URL", async () => {
    const result = await queryRelay("https://relay.test", [{}], {});
    expect(result.error).toBe("relay URL must start with ws:// or wss://");
  });

  it("reports a missing WebSocket implementation", async () => {
    const saved = globalThis.WebSocket;
    // @ts-expect-error simulate an environment without WebSocket
    delete globalThis.WebSocket;
    try {
      const result = await queryRelay(URL, [{}], {});
      expect(result.error).toBe("no WebSocket implementation available");
    } finally {
      globalThis.WebSocket = saved;
    }
  });

  it("reports a constructor that throws", async () => {
    class Broken {
      constructor() {
        throw new Error("boom");
      }
    }
    const result = await queryRelay(URL, [{}], { WebSocket: Broken as never });
    expect(result.error).toBe("could not connect: boom");
  });
});

describe("publishToRelay", () => {
  it("reports an accepted event", async () => {
    const { relay, WebSocket } = relayWith();
    const event = makeEvent(alice);
    expect(await publishToRelay(URL, event, { WebSocket })).toEqual({
      url: URL,
      ok: true,
      message: "",
    });
    expect(relay.all()).toEqual([event]);
  });

  it("reports a rejected event with the relay's reason", async () => {
    const { WebSocket } = relayWith();
    const event = { ...makeEvent(alice), sig: "00".repeat(64) };
    expect(await publishToRelay(URL, event, { WebSocket })).toEqual({
      url: URL,
      ok: false,
      message: "invalid: bad event or signature",
    });
  });

  it("treats a duplicate as accepted", async () => {
    const event = makeEvent(alice);
    const { WebSocket } = relayWith(event);
    const result = await publishToRelay(URL, event, { WebSocket });
    expect(result.ok).toBe(true);
  });

  it("reports an unreachable relay", async () => {
    const WebSocket = createMemoryWebSocket({ relays: { [URL]: "refuse" } });
    expect(await publishToRelay(URL, makeEvent(alice), { WebSocket })).toEqual({
      url: URL,
      ok: false,
      message: "could not connect",
    });
  });

  it("ignores an OK for another event and times out", async () => {
    const WebSocket = scriptedSocket((_message, reply) => {
      reply(JSON.stringify(["OK", "00".repeat(32), true, ""]));
    });
    const result = await publishToRelay(URL, makeEvent(alice), { WebSocket, timeoutMs: 30 });
    expect(result).toEqual({ url: URL, ok: false, message: "timed out waiting for the relay" });
  });

  it("reports a relay that requires authentication", async () => {
    const event = makeEvent(alice);
    const WebSocket = scriptedSocket((_message, reply) => {
      reply(JSON.stringify(["OK", event.id, false, "auth-required: sign in first"]));
    });
    expect(await publishToRelay(URL, event, { WebSocket })).toEqual({
      url: URL,
      ok: false,
      message: "auth-required: sign in first",
    });
  });

  it("does not treat a non-true OK flag as success", async () => {
    const event = makeEvent(alice);
    const WebSocket = scriptedSocket((_message, reply) => {
      reply(JSON.stringify(["OK", event.id, "true", ""]));
    });
    expect((await publishToRelay(URL, event, { WebSocket })).ok).toBe(false);
  });
});
