import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  deriveBchKey,
  deriveNostrKey,
  signEvent,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import { describe, expect, it } from "vitest";
import { checkCurrentBinding } from "../src/current.js";
import { MemoryRelay } from "../src/memory-relay.js";
import { createMemoryWebSocket } from "../src/memory-socket.js";
import { discoverRelayList, writeRelaysFromList } from "../src/relay-list.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const nostr = deriveNostrKey(MNEMONIC, 0);
const stranger = deriveNostrKey(MNEMONIC, 1);
const bch0 = deriveBchKey(MNEMONIC, 0, 0);
const bch1 = deriveBchKey(MNEMONIC, 0, 1);

async function bind(createdAt: number, bch = bch0, key = nostr): Promise<VerifiedBinding> {
  return createBinding({
    nostrSigner: createNostrKeySigner(key.privateKey),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt,
  });
}

function relayList(tags: string[][], createdAt = 1_700_000_000, key = nostr) {
  return signEvent(key.privateKey, { kind: 10002, created_at: createdAt, tags, content: "" });
}

type Mode = MemoryRelay | "refuse" | "hang" | "drop";

function world(urls: Record<string, "relay" | "refuse" | "hang" | "drop">) {
  const relays: Record<string, MemoryRelay> = {};
  const map: Record<string, Mode> = {};
  for (const [url, mode] of Object.entries(urls)) {
    if (mode === "relay") {
      relays[url] = new MemoryRelay();
      map[url] = relays[url];
    } else {
      map[url] = mode;
    }
  }
  return {
    relays,
    options: {
      WebSocket: createMemoryWebSocket({ relays: map }),
      connectTimeoutMs: 30,
      timeoutMs: 100,
    },
  };
}

const A = "wss://a.test";
const B = "wss://b.test";
const C = "wss://c.test";

describe("checkCurrentBinding", () => {
  it("accepts a binding published on enough relays", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    const result = await checkCurrentBinding(binding, { ...options, relays: [A, B] });
    expect(result).toMatchObject({ ok: true, userRelays: [] });
    expect(result.relays.map((r) => r.complete)).toEqual([true, true]);
  });

  it("rejects when too few relays answer", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "refuse", [C]: "hang" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    const result = await checkCurrentBinding(binding, { ...options, relays: [A, B, C] });
    expect(result).toMatchObject({
      ok: false,
      reason: "could not check: 1 of the required 2 relays answered",
    });
  });

  it("rejects when every relay fails", async () => {
    const { options } = world({ [A]: "refuse", [B]: "drop" });
    const result = await checkCurrentBinding(await bind(1_700_000_000), {
      ...options,
      relays: [A, B],
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "could not check: 0 of the required 2 relays answered",
    });
  });

  it("accepts one relay when the minimum is one", async () => {
    const { relays, options } = world({ [A]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    const result = await checkCurrentBinding(binding, { ...options, relays: [A], minComplete: 1 });
    expect(result.ok).toBe(true);
  });

  it("rejects a binding no answering relay holds", async () => {
    const { options } = world({ [A]: "relay", [B]: "relay" });
    const result = await checkCurrentBinding(await bind(1_700_000_000), {
      ...options,
      relays: [A, B],
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "binding is not published on any relay that answered",
    });
  });

  it("rejects when some relays fail and the others hold nothing", async () => {
    const { options } = world({ [A]: "relay", [B]: "relay", [C]: "refuse" });
    const result = await checkCurrentBinding(await bind(1_700_000_000), {
      ...options,
      relays: [A, B, C],
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "binding is not published on any relay that answered",
    });
  });

  it("rejects when a relay holds a newer binding", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const old = await bind(1_700_000_000);
    const newer = await bind(1_700_000_100, bch1);
    relays[A]!.seed(old.event);
    relays[B]!.seed(newer.event);
    const result = await checkCurrentBinding(old, { ...options, relays: [A, B] });
    expect(result).toMatchObject({
      ok: false,
      reason: "a newer binding exists for this Nostr key",
    });
  });

  it("accepts when other relays still hold an older binding", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const old = await bind(1_700_000_000);
    const current = await bind(1_700_000_100, bch1);
    relays[A]!.seed(old.event);
    relays[B]!.seed(current.event);
    expect((await checkCurrentBinding(current, { ...options, relays: [A, B] })).ok).toBe(true);
  });

  it("ignores a forged newer binding", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const real = await bind(1_700_000_000);
    const newer = await bind(1_700_000_100, bch1);
    relays[A]!.seed(real.event);
    relays[B]!.seed({ ...newer.event, sig: "00".repeat(64) });
    const result = await checkCurrentBinding(real, { ...options, relays: [A, B] });
    expect(result.ok).toBe(true);
    expect(result.relays.find((r) => r.url === B)).toMatchObject({ received: 1, valid: 0 });
  });

  it("ignores another key's binding", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const mine = await bind(1_700_000_000);
    relays[A]!.seed(mine.event);
    relays[A]!.seed((await bind(1_700_000_900, bch1, stranger)).event);
    expect((await checkCurrentBinding(mine, { ...options, relays: [A, B] })).ok).toBe(true);
  });

  it("rejects a binding that loses a time tie to a lower event ID", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const x = await bind(1_700_000_000, bch0);
    const y = await bind(1_700_000_000, bch1);
    const [winner, loser] = x.event.id < y.event.id ? [x, y] : [y, x];
    relays[A]!.seed(loser.event);
    relays[B]!.seed(winner.event);
    expect(await checkCurrentBinding(loser, { ...options, relays: [A, B] })).toMatchObject({
      ok: false,
      reason: "a newer binding exists for this Nostr key",
    });
  });

  it("rejects an invalid minimum", async () => {
    await expect(
      checkCurrentBinding(await bind(1_700_000_000), { minComplete: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it("counts the same relay once", async () => {
    const { relays, options } = world({ [A]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    const result = await checkCurrentBinding(binding, { ...options, relays: [A, `${A}/`] });
    expect(result).toMatchObject({
      ok: false,
      reason: "could not check: 1 of the required 2 relays answered",
    });
  });
});

describe("checkCurrentBinding with NIP-65 relay lists", () => {
  const U = "wss://user-relay.example";

  it("also asks the user's write relays", async () => {
    const { relays, options } = world({ [A]: "relay", [U]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(relayList([["r", U]]));
    relays[U]!.seed(binding.event);
    const result = await checkCurrentBinding(binding, { ...options, relays: [A] });
    expect(result).toMatchObject({ ok: true, userRelays: [U] });
  });

  it("finds a newer binding that only the user's relay holds", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay", [U]: "relay" });
    const old = await bind(1_700_000_000);
    const newer = await bind(1_700_000_100, bch1);
    relays[A]!.seed(old.event);
    relays[A]!.seed(relayList([["r", U, "write"]]));
    relays[U]!.seed(newer.event);
    expect(await checkCurrentBinding(old, { ...options, relays: [A, B] })).toMatchObject({
      ok: false,
      reason: "a newer binding exists for this Nostr key",
    });
  });

  it("can turn the relay list off", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay", [U]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    relays[A]!.seed(relayList([["r", U]]));
    const result = await checkCurrentBinding(binding, {
      ...options,
      relays: [A, B],
      followRelayList: false,
    });
    expect(result).toMatchObject({ ok: true, userRelays: [] });
  });

  it("skips user relays the application refuses", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay", [U]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    relays[A]!.seed(relayList([["r", U]]));
    const asked: string[] = [];
    const result = await checkCurrentBinding(binding, {
      ...options,
      relays: [A, B],
      allowUserRelay: (url) => {
        asked.push(url);
        return false;
      },
    });
    expect(asked).toEqual([U]);
    expect(result.userRelays).toEqual([]);
  });

  it("never connects to unsafe URLs from a relay list", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    relays[A]!.seed(
      relayList([
        ["r", "ws://127.0.0.1:6379"],
        ["r", "wss://169.254.169.254"],
        ["r", "wss://localhost"],
        ["r", "wss://metadata.google.internal"],
      ]),
    );
    const result = await checkCurrentBinding(binding, { ...options, relays: [A, B] });
    expect(result).toMatchObject({ ok: true, userRelays: [] });
    expect(result.relays.map((r) => r.url)).toEqual([A, B]);
  });

  it("does not count user relays twice when they are already configured", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay" });
    const binding = await bind(1_700_000_000);
    relays[A]!.seed(binding.event);
    relays[A]!.seed(relayList([["r", B]]));
    const result = await checkCurrentBinding(binding, { ...options, relays: [A, B] });
    expect(result.userRelays).toEqual([]);
    expect(result.relays).toHaveLength(2);
  });
});

describe("relay lists", () => {
  it("keeps write and unmarked relays, skips read-only and unsafe ones, and caps at four", () => {
    const event = relayList([
      ["r", "wss://one.example"],
      ["r", "wss://read.example", "read"],
      ["r", "wss://two.example/", "write"],
      ["r", "ws://plain.example"],
      ["r", "wss://two.example"],
      ["r", "wss://three.example"],
      ["r", "wss://four.example"],
      ["r", "wss://five.example"],
      ["r", "wss://odd.example", "other"],
      ["p", "wss://not-a-relay.example"],
    ]);
    expect(writeRelaysFromList(event, nostr.publicKey)).toEqual([
      "wss://one.example",
      "wss://two.example",
      "wss://three.example",
      "wss://four.example",
    ]);
  });

  it("ignores a list by another author or of another kind", () => {
    expect(
      writeRelaysFromList(relayList([["r", "wss://x.example"]], 1, stranger), nostr.publicKey),
    ).toEqual([]);
    const wrongKind = signEvent(nostr.privateKey, {
      kind: 3,
      created_at: 1,
      tags: [["r", "wss://x.example"]],
      content: "",
    });
    expect(writeRelaysFromList(wrongKind, nostr.publicKey)).toEqual([]);
  });

  it("uses the newest signed list and ignores forged ones", async () => {
    const { relays, options } = world({ [A]: "relay", [B]: "relay", [C]: "relay" });
    const older = relayList([["r", "wss://old.example"]], 1_700_000_000);
    const newer = relayList([["r", "wss://new.example"]], 1_700_000_100);
    const forged = {
      ...relayList([["r", "wss://evil.example"]], 1_700_000_900),
      sig: "00".repeat(64),
    };
    relays[A]!.seed(older);
    relays[B]!.seed(newer);
    relays[C]!.seed(forged);
    const result = await discoverRelayList(nostr.publicKey, [A, B, C], options);
    expect(result.event?.id).toBe(newer.id);
    expect(result.writeRelays).toEqual(["wss://new.example"]);
  });

  it("returns nothing when the user has no list", async () => {
    const { options } = world({ [A]: "relay" });
    expect(await discoverRelayList(nostr.publicKey, [A], options)).toEqual({
      event: null,
      writeRelays: [],
    });
  });
});
