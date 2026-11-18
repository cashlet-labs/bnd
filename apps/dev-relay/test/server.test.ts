import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  deriveBchKey,
  deriveNostrKey,
} from "@cashlet-labs/bnd-core";
import {
  discoverBinding,
  discoverByBchKeyHash,
  publishBinding,
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

  it("keeps only the newest binding for a key", async () => {
    const { url, relay } = await start();
    await publishBinding((await bind(1_700_000_000)).event, { relays: [url] });
    const newer = await bind(1_700_000_100);
    await publishBinding(newer.event, { relays: [url] });
    expect(relay.all()).toEqual([newer.event]);
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
