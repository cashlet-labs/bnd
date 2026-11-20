import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  createSuccessor,
  deriveBchKey,
  deriveNostrKey,
  signEvent,
} from "@cashlet-labs/bnd-core";
import {
  discoverBinding,
  discoverByBchKeyHash,
  publishBinding,
  publishToRelay,
  queryRelay,
} from "@cashlet-labs/bnd-nostr";
import { afterEach, describe, expect, it } from "vitest";
import { startDevRelay, type DevRelay } from "../src/server.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const nostr = deriveNostrKey(MNEMONIC);
const bch = deriveBchKey(MNEMONIC);

let running: DevRelay[] = [];
afterEach(async () => {
  await Promise.all(running.map((relay) => relay.close()));
  running = [];
});

async function start() {
  const relay = await startDevRelay();
  running.push(relay);
  return relay;
}

async function bind(createdAt: number, proofType: "message" | "tx" = "message") {
  return createBinding({
    nostrSigner: createNostrKeySigner(nostr.privateKey),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType,
    createdAt,
  });
}

describe("dev relay over real WebSockets", () => {
  it("listens on loopback with a free port", async () => {
    const { url } = await start();
    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });

  it("publishes and discovers a binding", async () => {
    const { url } = await start();
    const binding = await bind(1_700_000_000);
    const summary = await publishBinding(binding.event, { relays: [url] });
    expect(summary).toEqual({ ok: true, accepted: [url], failed: [] });
    const found = await discoverBinding(nostr.publicKey, { relays: [url] });
    expect(found.binding?.bindingId).toBe(binding.bindingId);
    expect(found.relays[0]).toMatchObject({ received: 1, valid: 1, complete: true });
  });

  it("finds the Nostr identity of a BCH key", async () => {
    const { url } = await start();
    const binding = await bind(1_700_000_000, "tx");
    await publishBinding(binding.event, { relays: [url] });
    const found = await discoverByBchKeyHash(bch.keyHash, { relays: [url] });
    expect(found.bindings.map((b) => b.nostrPublicKey)).toEqual([nostr.publicKey]);
  });

  it("keeps only the newest binding for a key when enforcement is off", async () => {
    const relay = await startDevRelay({ enforceSuccession: false });
    running.push(relay);
    await publishBinding((await bind(1_700_000_000)).event, { relays: [relay.url] });
    const newer = await bind(1_700_000_100);
    await publishBinding(newer.event, { relays: [relay.url] });
    expect(relay.relay.all()).toEqual([newer.event]);
  });

  describe("BND rules, as on the Cashlet relays", () => {
    const thiefBch = deriveBchKey(MNEMONIC, 0, 20);

    it("refuses a second first binding for a key that has one", async () => {
      const { url, relay } = await start();
      const real = await bind(1_700_000_000);
      await publishBinding(real.event, { relays: [url] });
      const fake = await createBinding({
        nostrSigner: createNostrKeySigner(nostr.privateKey),
        bchSigner: createKeySigner(thiefBch.privateKey),
        bchKeyHash: thiefBch.keyHash,
        network: "chipnet",
        proofType: "message",
        createdAt: 1_700_000_100,
      });
      const result = await publishToRelay(url, fake.event);
      expect(result).toMatchObject({
        ok: false,
        message:
          "blocked: this key already has a binding here; replace it with a successor approved by two of its keys",
      });
      expect(relay.all()).toEqual([real.event]);
    });

    it("replaces a binding with its successor, and refuses going back", async () => {
      const { url, relay } = await start();
      const first = await bind(1_700_000_000);
      await publishBinding(first.event, { relays: [url] });
      const bch1 = deriveBchKey(MNEMONIC, 0, 1);
      const next = await createSuccessor({
        previous: first.event,
        nostrSigner: createNostrKeySigner(nostr.privateKey),
        bchSigner: createKeySigner(bch1.privateKey),
        bchKeyHash: bch1.keyHash,
        network: "chipnet",
        proofType: "message",
        approvers: { bch: { signer: createKeySigner(bch.privateKey), proofType: "message" } },
        createdAt: 1_700_000_100,
      });
      expect((await publishToRelay(url, next.event)).ok).toBe(true);
      expect(relay.all()).toEqual([next.event]);
      expect((await publishToRelay(url, first.event)).ok).toBe(false);
    });

    it("refuses an invalid binding and a deletion of a binding", async () => {
      const { url, relay } = await start();
      const binding = await bind(1_700_000_000);
      const forged = signEvent(nostr.privateKey, {
        kind: 30078,
        created_at: binding.event.created_at,
        tags: binding.event.tags,
        content: binding.event.content.replace("chipnet", "mainnet"),
      });
      expect((await publishToRelay(url, forged)).message).toMatch(/^invalid: /);
      await publishBinding(binding.event, { relays: [url] });
      const deletion = signEvent(nostr.privateKey, {
        kind: 5,
        created_at: 1_700_000_100,
        tags: [
          ["a", `30078:${nostr.publicKey}:bnd1`],
          ["k", "30078"],
        ],
        content: "",
      });
      expect(await publishToRelay(url, deletion)).toMatchObject({
        ok: false,
        message: "blocked: bindings cannot be deleted here; revoke the binding instead",
      });
      expect(relay.all()).toEqual([binding.event]);
    });

    it("still stores other events", async () => {
      const { url, relay } = await start();
      const note = signEvent(nostr.privateKey, {
        kind: 1,
        created_at: 1_700_000_000,
        tags: [],
        content: "hello",
      });
      expect((await publishToRelay(url, note)).ok).toBe(true);
      expect(relay.all()).toEqual([note]);
    });
  });

  it("rejects a forged event at the relay", async () => {
    const { url, relay } = await start();
    const binding = await bind(1_700_000_000);
    const { publishToRelay } = await import("@cashlet-labs/bnd-nostr");
    const result = await publishToRelay(url, { ...binding.event, sig: "00".repeat(64) });
    expect(result.ok).toBe(false);
    expect(relay.all()).toEqual([]);
  });

  it("survives a malformed client message", async () => {
    const { url } = await start();
    const socket = new WebSocket(url);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    const reply = new Promise<string>((resolve) =>
      socket.addEventListener("message", (event) => resolve(String(event.data))),
    );
    socket.send("{not json");
    expect(JSON.parse(await reply)).toEqual(["NOTICE", "error: invalid JSON"]);
    socket.close();
    const result = await queryRelay(url, [{}]);
    expect(result.complete).toBe(true);
  });

  it("drops a message that is too large without crashing", async () => {
    const { url } = await start();
    const socket = new WebSocket(url);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    const closed = new Promise<void>((resolve) =>
      socket.addEventListener("close", () => resolve()),
    );
    socket.send("x".repeat(300_000));
    await closed;
    expect((await queryRelay(url, [{}])).complete).toBe(true);
  });

  it("reports a relay that is not running", async () => {
    const { url, close } = await start();
    await close();
    running = [];
    const result = await queryRelay(url, [{}], { connectTimeoutMs: 500 });
    expect(result.complete).toBe(false);
    expect(result.error).toBeDefined();
  });
});
