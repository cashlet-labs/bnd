import { describe, expect, it } from "vitest";
import { MemoryRelay } from "../src/memory-relay.js";
import { alice, bob, capture, makeEvent } from "./helpers.js";

function connect(relay: MemoryRelay) {
  const out = capture();
  const session = relay.connect(out.send);
  return { session, messages: out.messages };
}

const publish = (session: ReturnType<typeof connect>["session"], event: unknown) =>
  session.receive(JSON.stringify(["EVENT", event]));
const req = (session: ReturnType<typeof connect>["session"], id: string, ...filters: unknown[]) =>
  session.receive(JSON.stringify(["REQ", id, ...filters]));

describe("MemoryRelay publishing", () => {
  it("accepts a valid event and stores it", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    const event = makeEvent(alice);
    publish(session, event);
    expect(messages).toEqual([["OK", event.id, true, ""]]);
    expect(relay.all()).toHaveLength(1);
  });

  it("rejects a bad signature", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    const event = { ...makeEvent(alice), sig: "00".repeat(64) };
    publish(session, event);
    expect(messages[0]).toEqual(["OK", event.id, false, "invalid: bad event or signature"]);
    expect(relay.all()).toHaveLength(0);
  });

  it("rejects garbage without throwing", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    publish(session, "nope");
    publish(session, { id: 5 });
    expect(messages.map((m) => m[0])).toEqual(["OK", "OK"]);
    expect(messages.every((m) => m[2] === false)).toBe(true);
  });

  it("reports a duplicate as accepted", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    const event = makeEvent(alice);
    publish(session, event);
    publish(session, event);
    expect(messages[1]).toEqual(["OK", event.id, true, "duplicate: already have this event"]);
    expect(relay.all()).toHaveLength(1);
  });

  it("answers bad JSON and unknown messages with a notice", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    session.receive("not json");
    session.receive('{"a":1}');
    session.receive('["WHAT"]');
    expect(messages.map((m) => m[0])).toEqual(["NOTICE", "NOTICE", "NOTICE"]);
  });
});

describe("MemoryRelay replacement rules", () => {
  it("keeps only the newest replaceable event", () => {
    const relay = new MemoryRelay();
    const { session } = connect(relay);
    const older = makeEvent(alice, { kind: 10002, created_at: 100, content: "old" });
    const newer = makeEvent(alice, { kind: 10002, created_at: 200, content: "new" });
    publish(session, older);
    publish(session, newer);
    expect(relay.all().map((e) => e.content)).toEqual(["new"]);
    publish(session, older);
    expect(relay.all().map((e) => e.content)).toEqual(["new"]);
  });

  it("keeps one addressable event per kind, author and d tag", () => {
    const relay = new MemoryRelay();
    const { session } = connect(relay);
    const a1 = makeEvent(alice, {
      kind: 30078,
      created_at: 100,
      tags: [["d", "x"]],
      content: "a1",
    });
    const a2 = makeEvent(alice, {
      kind: 30078,
      created_at: 200,
      tags: [["d", "x"]],
      content: "a2",
    });
    const other = makeEvent(alice, {
      kind: 30078,
      created_at: 100,
      tags: [["d", "y"]],
      content: "y",
    });
    const bobs = makeEvent(bob, { kind: 30078, created_at: 100, tags: [["d", "x"]], content: "b" });
    for (const e of [a1, a2, other, bobs]) publish(session, e);
    expect(
      relay
        .all()
        .map((e) => e.content)
        .sort(),
    ).toEqual(["a2", "b", "y"]);
  });

  it("breaks a time tie with the lower event ID", () => {
    const relay = new MemoryRelay();
    const { session } = connect(relay);
    const a = makeEvent(alice, { kind: 30078, created_at: 100, tags: [["d", "x"]], content: "a" });
    const b = makeEvent(alice, { kind: 30078, created_at: 100, tags: [["d", "x"]], content: "b" });
    const lower = a.id < b.id ? a : b;
    publish(session, a);
    publish(session, b);
    expect(relay.all().map((e) => e.id)).toEqual([lower.id]);
  });

  it("does not store ephemeral events but still delivers them", () => {
    const relay = new MemoryRelay();
    const listener = connect(relay);
    req(listener.session, "s", { kinds: [20001] });
    const { session } = connect(relay);
    const event = makeEvent(alice, { kind: 20001 });
    publish(session, event);
    expect(relay.all()).toHaveLength(0);
    expect(listener.messages.at(-1)).toEqual(["EVENT", "s", event]);
  });

  it("keeps every regular event", () => {
    const relay = new MemoryRelay();
    const { session } = connect(relay);
    publish(session, makeEvent(alice, { created_at: 1, content: "1" }));
    publish(session, makeEvent(alice, { created_at: 2, content: "2" }));
    expect(relay.all()).toHaveLength(2);
  });
});

describe("MemoryRelay subscriptions", () => {
  it("returns stored events newest first, then EOSE", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    const e1 = makeEvent(alice, { created_at: 1, content: "1" });
    const e2 = makeEvent(alice, { created_at: 2, content: "2" });
    publish(session, e1);
    publish(session, e2);
    messages.length = 0;
    req(session, "sub", { kinds: [1] });
    expect(messages).toEqual([
      ["EVENT", "sub", e2],
      ["EVENT", "sub", e1],
      ["EOSE", "sub"],
    ]);
  });

  it("applies filters and limit", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    for (let i = 1; i <= 5; i++)
      publish(session, makeEvent(alice, { created_at: i, content: `${i}` }));
    publish(session, makeEvent(bob, { created_at: 9 }));
    messages.length = 0;
    req(session, "sub", { authors: [alice.publicKey], limit: 2 });
    expect(messages.filter((m) => m[0] === "EVENT")).toHaveLength(2);
    expect(messages.at(-1)).toEqual(["EOSE", "sub"]);
  });

  it("delivers new matching events live and stops after CLOSE", () => {
    const relay = new MemoryRelay();
    const listener = connect(relay);
    req(listener.session, "live", { kinds: [1] });
    const { session } = connect(relay);
    const first = makeEvent(alice, { created_at: 1 });
    publish(session, first);
    expect(listener.messages.at(-1)).toEqual(["EVENT", "live", first]);
    listener.session.receive(JSON.stringify(["CLOSE", "live"]));
    const count = listener.messages.length;
    publish(session, makeEvent(alice, { created_at: 2 }));
    expect(listener.messages).toHaveLength(count);
  });

  it("does not deliver events that do not match", () => {
    const relay = new MemoryRelay();
    const listener = connect(relay);
    req(listener.session, "live", { kinds: [7] });
    const { session } = connect(relay);
    publish(session, makeEvent(alice));
    expect(listener.messages.filter((m) => m[0] === "EVENT")).toHaveLength(0);
  });

  it("closes a subscription with a bad filter", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    req(session, "bad", { kinds: ["x"] });
    req(session, "empty");
    expect(messages[0]).toEqual(["CLOSED", "bad", "invalid: bad filter"]);
    expect(messages[1]).toEqual(["CLOSED", "empty", "invalid: bad filter"]);
  });

  it("rejects a missing or oversized subscription id", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    req(session, "", {});
    req(session, "x".repeat(65), {});
    expect(messages.map((m) => m[0])).toEqual(["NOTICE", "NOTICE"]);
  });

  it("can hide events from queries for tests", () => {
    const relay = new MemoryRelay();
    const { session, messages } = connect(relay);
    const event = makeEvent(alice);
    publish(session, event);
    relay.hideFromQueries = (e) => e.id === event.id;
    messages.length = 0;
    req(session, "s", {});
    expect(messages).toEqual([["EOSE", "s"]]);
  });

  it("stops delivering after the session closes", () => {
    const relay = new MemoryRelay();
    const listener = connect(relay);
    req(listener.session, "live", {});
    listener.session.close();
    const count = listener.messages.length;
    publish(connect(relay).session, makeEvent(alice));
    expect(listener.messages).toHaveLength(count);
  });

  it("stores planted events without validating them", () => {
    const relay = new MemoryRelay();
    const bad = { ...makeEvent(alice), sig: "00".repeat(64) };
    relay.seed(bad);
    const { session, messages } = connect(relay);
    req(session, "s", {});
    expect(messages[0]).toEqual(["EVENT", "s", bad]);
  });
});
