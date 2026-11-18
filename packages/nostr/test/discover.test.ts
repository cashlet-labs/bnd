import {
  canonicalize,
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  deriveBchKey,
  deriveNostrKey,
  npubEncode,
  signEvent,
  verifyBinding,
  type NostrEvent,
} from "@cashlet-labs/bnd-core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELAYS,
  discoverBinding,
  discoverByBchKeyHash,
  publishBinding,
} from "../src/discover.js";
import { MemoryRelay } from "../src/memory-relay.js";
import { createMemoryWebSocket } from "../src/memory-socket.js";
import { scriptedSocket } from "./helpers.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const nostr0 = deriveNostrKey(MNEMONIC, 0);
const nostr1 = deriveNostrKey(MNEMONIC, 1);
const bch0 = deriveBchKey(MNEMONIC, 0, 0);
const bch1 = deriveBchKey(MNEMONIC, 0, 1);

async function bind(
  nostr: ReturnType<typeof deriveNostrKey>,
  bch: ReturnType<typeof deriveBchKey>,
  options: { createdAt?: number; proofType?: "message" | "tx" } = {},
) {
  return createBinding({
    nostrSigner: createNostrKeySigner(nostr.privateKey),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: options.proofType ?? "message",
    createdAt: options.createdAt ?? 1_700_000_000,
  });
}

const URLS = ["wss://a.test", "wss://b.test", "wss://c.test"];

function network(modes: Record<string, MemoryRelay | "refuse" | "hang" | "drop"> = {}) {
  const relays = Object.fromEntries(URLS.map((url) => [url, new MemoryRelay()])) as Record<
    string,
    MemoryRelay
  >;
  const WebSocket = createMemoryWebSocket({ relays: { ...relays, ...modes } });
  return {
    relays,
    WebSocket,
    options: { relays: URLS, WebSocket, connectTimeoutMs: 30, timeoutMs: 100 },
  };
}

describe("publishBinding and discoverBinding", () => {
  it("publishes to every relay and finds the binding again", async () => {
    const { relays, options } = network();
    const binding = await bind(nostr0, bch0);
    const summary = await publishBinding(binding.event, options);
    expect(summary).toEqual({ ok: true, accepted: URLS, failed: [] });
    for (const url of URLS) expect(relays[url]!.all()).toEqual([binding.event]);

    const found = await discoverBinding(nostr0.publicKey, options);
    expect(found.binding?.bindingId).toBe(binding.bindingId);
    expect(found.binding?.bch.address).toBe(binding.bch.address);
    expect(found.relays).toHaveLength(3);
    expect(found.relays.every((r) => r.received === 1 && r.valid === 1 && r.complete)).toBe(true);
  });

  it("accepts an npub as well as hex", async () => {
    const { options } = network();
    await publishBinding((await bind(nostr0, bch0)).event, options);
    const found = await discoverBinding(npubEncode(nostr0.publicKey), options);
    expect(found.binding?.nostrPublicKey).toBe(nostr0.publicKey);
  });

  it("returns null when nothing is published", async () => {
    const { options } = network();
    const found = await discoverBinding(nostr0.publicKey, options);
    expect(found.binding).toBeNull();
    expect(found.relays.every((r) => r.received === 0 && r.complete)).toBe(true);
  });

  it("finds the newest binding after a replacement", async () => {
    const { relays, options } = network();
    const first = await bind(nostr0, bch0, { createdAt: 1_700_000_000 });
    const second = await bind(nostr0, bch1, { createdAt: 1_700_000_100, proofType: "tx" });
    await publishBinding(first.event, options);
    await publishBinding(second.event, options);
    expect(relays["wss://a.test"]!.all()).toEqual([second.event]);
    const found = await discoverBinding(nostr0.publicKey, options);
    expect(found.binding?.bch.address).toBe(second.bch.address);
    expect(found.binding?.proofType).toBe("tx");
  });

  it("survives relays that refuse, hang or drop", async () => {
    const good = new MemoryRelay();
    const WebSocket = createMemoryWebSocket({
      relays: {
        "wss://a.test": "refuse",
        "wss://b.test": "hang",
        "wss://c.test": "drop",
        "wss://d.test": good,
      },
    });
    const options = {
      relays: ["wss://a.test", "wss://b.test", "wss://c.test", "wss://d.test"],
      WebSocket,
      connectTimeoutMs: 30,
      timeoutMs: 100,
    };
    const binding = await bind(nostr0, bch0);
    const summary = await publishBinding(binding.event, options);
    expect(summary.ok).toBe(true);
    expect(summary.accepted).toEqual(["wss://d.test"]);
    expect(summary.failed.map((r) => r.url).sort()).toEqual([
      "wss://a.test",
      "wss://b.test",
      "wss://c.test",
    ]);

    const found = await discoverBinding(nostr0.publicKey, options);
    expect(found.binding?.bindingId).toBe(binding.bindingId);
    const byUrl = Object.fromEntries(found.relays.map((r) => [r.url, r]));
    expect(byUrl["wss://a.test"]?.error).toBe("could not connect");
    expect(byUrl["wss://b.test"]?.error).toBe("connection timed out");
    expect(byUrl["wss://c.test"]?.error).toBe("connection closed");
    expect(byUrl["wss://d.test"]).toMatchObject({ received: 1, valid: 1, complete: true });
  });

  it("reports failure when no relay accepts", async () => {
    const WebSocket = createMemoryWebSocket({ relays: {} });
    const binding = await bind(nostr0, bch0);
    const summary = await publishBinding(binding.event, { relays: URLS, WebSocket });
    expect(summary.ok).toBe(false);
    expect(summary.accepted).toEqual([]);
    expect(summary.failed).toHaveLength(3);
  });

  it("refuses to publish an invalid binding", async () => {
    const { options } = network();
    const binding = await bind(nostr0, bch0);
    await expect(
      publishBinding({ ...binding.event, sig: "00".repeat(64) }, options),
    ).rejects.toThrow(/refusing to publish an invalid binding: Nostr signature is invalid/);
    await expect(publishBinding({ id: "x" } as unknown as NostrEvent, options)).rejects.toThrow();
  });

  it("de-duplicates the relay list", async () => {
    const { options } = network();
    const binding = await bind(nostr0, bch0);
    const summary = await publishBinding(binding.event, {
      ...options,
      relays: [URLS[0]!, URLS[0]!],
    });
    expect(summary.accepted).toEqual([URLS[0]]);
  });

  it("rejects an invalid key before asking any relay", async () => {
    await expect(discoverBinding("not a key", {})).rejects.toThrow();
    await expect(discoverBinding("AB".repeat(32), {})).rejects.toThrow();
  });
});

describe("discoverBinding against untrusted relays", () => {
  it("ignores a forged newer event and uses the real binding", async () => {
    const { relays, options } = network();
    const real = await bind(nostr0, bch0, { createdAt: 1_700_000_000 });
    const newer = await bind(nostr0, bch1, { createdAt: 1_700_000_500 });
    await publishBinding(real.event, options);
    relays["wss://a.test"]!.seed({ ...newer.event, sig: "00".repeat(64) });
    const found = await discoverBinding(nostr0.publicKey, options);
    expect(found.binding?.bindingId).toBe(real.bindingId);
    const a = found.relays.find((r) => r.url === "wss://a.test")!;
    expect(a.received).toBeGreaterThanOrEqual(1);
    expect(a.valid).toBeLessThanOrEqual(a.received);
  });

  it("finds the newest binding when one relay serves a stale one", async () => {
    const { relays, options } = network();
    const old = await bind(nostr0, bch0, { createdAt: 1_700_000_000 });
    const current = await bind(nostr0, bch1, { createdAt: 1_700_000_100 });
    relays["wss://a.test"]!.seed(old.event);
    relays["wss://b.test"]!.seed(current.event);
    const found = await discoverBinding(nostr0.publicKey, options);
    expect(found.binding?.bindingId).toBe(current.bindingId);
  });

  it("returns the stale binding when no relay has the newer one", async () => {
    const { relays, options } = network();
    const old = await bind(nostr0, bch0);
    relays["wss://a.test"]!.seed(old.event);
    const found = await discoverBinding(nostr0.publicKey, options);
    expect(found.binding?.bindingId).toBe(old.bindingId);
  });

  it("ignores another author's binding served for this key", async () => {
    const other = await bind(nostr1, bch1);
    const WebSocket = scriptedSocket((message, reply) => {
      reply(JSON.stringify(["EVENT", message[1], other.event]));
      reply(JSON.stringify(["EOSE", message[1]]));
    });
    const found = await discoverBinding(nostr0.publicKey, { relays: ["wss://x.test"], WebSocket });
    expect(found.binding).toBeNull();
    expect(found.relays[0]).toMatchObject({ received: 1, valid: 0 });
  });

  it("ignores a valid binding whose BCH proof was copied from another", async () => {
    const real = await bind(nostr0, bch0);
    const attacker = await bind(nostr1, bch1);
    // Attacker's Nostr-signed event carrying the victim's BCH key and the victim's proof.
    const content = JSON.parse(real.event.content) as {
      bchProof: unknown;
      record: Record<string, unknown>;
    };
    const forgedRecord = {
      ...content.record,
      nostr: { publicKey: nostr1.publicKey },
    };
    const forged = signEvent(nostr1.privateKey, {
      kind: 30078,
      created_at: 1_700_000_000,
      tags: [
        ["d", "bnd1"],
        ["b", real.bch.keyHash],
      ],
      content: canonicalize({ bchProof: content.bchProof, record: forgedRecord }),
    });
    expect(verifyBinding(forged)).toMatchObject({ ok: false });
    expect((verifyBinding(forged) as { reason: string }).reason).toMatch(/^BCH proof is invalid/);
    const { relays, options } = network();
    relays["wss://a.test"]!.seed(forged);
    relays["wss://a.test"]!.seed(attacker.event);
    const found = await discoverBinding(nostr1.publicKey, options);
    expect(found.binding?.bindingId).toBe(attacker.bindingId);
    expect(found.binding?.bch.keyHash).toBe(bch1Hash());
  });
});

function bch1Hash(): string {
  return Array.from(bch1.keyHash, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("discoverByBchKeyHash", () => {
  it("finds the Nostr key that proved control of a BCH key", async () => {
    const { options } = network();
    const binding = await bind(nostr0, bch0);
    await publishBinding(binding.event, options);
    const found = await discoverByBchKeyHash(bch0.keyHash, options);
    expect(found.bindings.map((b) => b.nostrPublicKey)).toEqual([nostr0.publicKey]);
    expect(found.bindings[0]?.bch.address).toBe(binding.bch.address);
  });

  it("accepts the key hash as hex", async () => {
    const { options } = network();
    await publishBinding((await bind(nostr0, bch0)).event, options);
    const found = await discoverByBchKeyHash(binding0Hash(), options);
    expect(found.bindings).toHaveLength(1);
  });

  it("returns nothing for an unknown key hash", async () => {
    const { options } = network();
    await publishBinding((await bind(nostr0, bch0)).event, options);
    expect((await discoverByBchKeyHash(bch1.keyHash, options)).bindings).toEqual([]);
  });

  it("drops a claim by someone who cannot prove the BCH key", async () => {
    const { relays, options } = network();
    const honest = await bind(nostr0, bch0);
    // A second Nostr key claims bch0 with a proof signed by bch1.
    const content = JSON.parse((await bind(nostr1, bch1)).event.content) as {
      bchProof: unknown;
      record: { bch: Record<string, unknown> };
    };
    const claim = signEvent(nostr1.privateKey, {
      kind: 30078,
      created_at: 1_700_000_000,
      tags: [
        ["d", "bnd1"],
        ["b", honest.bch.keyHash],
      ],
      content: canonicalize({
        bchProof: content.bchProof,
        record: { ...content.record, bch: { ...content.record.bch, keyHash: honest.bch.keyHash } },
      }),
    });
    expect((verifyBinding(claim) as { reason: string }).reason).toMatch(/^BCH proof is invalid/);
    relays["wss://a.test"]!.seed(claim);
    await publishBinding(honest.event, options);
    const found = await discoverByBchKeyHash(bch0.keyHash, options);
    expect(found.bindings.map((b) => b.nostrPublicKey)).toEqual([nostr0.publicKey]);
  });

  it("lists several Nostr keys that each proved control, newest first", async () => {
    const { options } = network();
    const a = await bind(nostr0, bch0, { createdAt: 1_700_000_000 });
    const b = await bind(nostr1, bch0, { createdAt: 1_700_000_900, proofType: "tx" });
    await publishBinding(a.event, options);
    await publishBinding(b.event, options);
    const found = await discoverByBchKeyHash(bch0.keyHash, options);
    expect(found.bindings.map((x) => x.nostrPublicKey)).toEqual([
      nostr1.publicKey,
      nostr0.publicKey,
    ]);
  });

  it("rejects an invalid key hash", async () => {
    await expect(discoverByBchKeyHash("zz", {})).rejects.toThrow(TypeError);
    await expect(discoverByBchKeyHash(new Uint8Array(19), {})).rejects.toThrow(TypeError);
  });
});

function binding0Hash(): string {
  return Array.from(bch0.keyHash, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("DEFAULT_RELAYS", () => {
  it("lists secure WebSocket URLs only", () => {
    expect(DEFAULT_RELAYS.length).toBeGreaterThan(2);
    for (const url of DEFAULT_RELAYS) expect(url).toMatch(/^wss:\/\//);
  });
});
