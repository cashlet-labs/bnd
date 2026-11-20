// @vitest-environment node
import { verifyEventSignature, type UnsignedEvent } from "@cashlet-labs/bnd";
import { afterEach, describe, expect, it } from "vitest";
import { startDevRelay, type DevRelay } from "../../dev-relay/src/server.js";
import {
  connectBunker,
  connectNip07,
  createMemorySigner,
  findNip07Provider,
  startNostrConnect,
  type ConnectedNostrSigner,
} from "../src/signers/nostr";
import { startFakeBunker } from "./fake-bunker";
import { useQuietWebSockets } from "./quiet-websocket";

useQuietWebSockets();

const template: UnsignedEvent = {
  kind: 30078,
  created_at: 1_700_000_000,
  tags: [["d", "bnd1"]],
  content: "{}",
};

let cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function relay(): Promise<DevRelay> {
  const r = await startDevRelay();
  cleanup.push(() => r.close());
  return r;
}

function keep(signer: ConnectedNostrSigner): ConnectedNostrSigner {
  cleanup.push(() => signer.disconnect());
  return signer;
}

describe("findNip07Provider", () => {
  it("finds a provider with both methods", () => {
    const provider = { getPublicKey: async () => "", signEvent: async () => ({}) };
    expect(findNip07Provider({ nostr: provider })).toBe(provider);
  });

  it.each([
    ["no provider", {}],
    ["null", { nostr: null }],
    ["a provider without signEvent", { nostr: { getPublicKey: async () => "" } }],
    ["a string", { nostr: "x" }],
  ])("returns null for %s", (_name, scope) => {
    expect(findNip07Provider(scope)).toBeNull();
  });
});

describe("connectNip07", () => {
  it("uses the extension's key and signatures", async () => {
    const memory = createMemorySigner();
    const provider = {
      getPublicKey: async () => memory.publicKey,
      signEvent: async (event: unknown) => memory.signer.signEvent(event as UnsignedEvent),
    };
    const signer = await connectNip07(provider);
    expect(signer.kind).toBe("nip07");
    expect(signer.npub).toMatch(/^npub1/);
    expect(verifyEventSignature(await signer.signer.signEvent(template))).toBe(true);
  });

  it("refuses an invalid public key", async () => {
    await expect(
      connectNip07({ getPublicKey: async () => "nope", signEvent: async () => ({}) }),
    ).rejects.toThrow("invalid public key");
  });

  it("passes on a refusal from the extension", async () => {
    const signer = await connectNip07({
      getPublicKey: async () => "ab".repeat(32),
      signEvent: async () => {
        throw new Error("user rejected");
      },
    });
    await expect(signer.signer.signEvent(template)).rejects.toThrow("user rejected");
  });
});

describe("createMemorySigner", () => {
  it("makes a new key each time and signs with it", async () => {
    const a = createMemorySigner();
    const b = createMemorySigner();
    expect(a.publicKey).not.toBe(b.publicKey);
    const event = await a.signer.signEvent(template);
    expect(event.pubkey).toBe(a.publicKey);
    expect(verifyEventSignature(event)).toBe(true);
  });

  it("refuses to sign after the key is discarded", async () => {
    const signer = createMemorySigner();
    await signer.disconnect();
    expect(() => signer.signer.signEvent(template)).toThrow("discarded");
  });
});

describe("NIP-46 remote signer over a relay", () => {
  it("connects with a bunker link and signs", async () => {
    const r = await relay();
    const bunker = startFakeBunker({ relays: [r.url] });
    cleanup.push(() => bunker.close());
    const signer = keep(await connectBunker(bunker.bunkerUrl, { timeoutMs: 5000 }));
    expect(signer.kind).toBe("nip46");
    expect(signer.publicKey).toBe(bunker.userPubkey);
    const event = await signer.signer.signEvent(template);
    expect(event.pubkey).toBe(bunker.userPubkey);
    expect(verifyEventSignature(event)).toBe(true);
    expect(bunker.seen).toEqual(["connect", "get_public_key", "sign_event"]);
  });

  it("connects when a signer app answers a nostrconnect code", async () => {
    const r = await relay();
    const bunker = startFakeBunker({ relays: [r.url] });
    cleanup.push(() => bunker.close());
    const request = startNostrConnect([r.url], { timeoutMs: 5000 });
    cleanup.push(() => request.cancel());
    expect(request.uri).toMatch(/^nostrconnect:\/\/[0-9a-f]{64}\?/);
    expect(request.uri).toContain("secret=");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await bunker.acceptNostrConnect(request.uri);
    const signer = keep(await request.connected);
    expect(signer.publicKey).toBe(bunker.userPubkey);
    expect(verifyEventSignature(await signer.signer.signEvent(template))).toBe(true);
  });

  it("reports an approval link instead of opening it", async () => {
    const r = await relay();
    const bunker = startFakeBunker({ relays: [r.url], authUrl: "https://signer.example/approve" });
    cleanup.push(() => bunker.close());
    const links: string[] = [];
    const signer = keep(
      await connectBunker(bunker.bunkerUrl, {
        timeoutMs: 5000,
        onAuthUrl: (url) => links.push(url),
      }),
    );
    const event = await signer.signer.signEvent(template);
    expect(links).toEqual(["https://signer.example/approve"]);
    expect(verifyEventSignature(event)).toBe(true);
  });

  it("passes on a refusal from the remote signer", async () => {
    const r = await relay();
    const bunker = startFakeBunker({ relays: [r.url], refuseSigning: true });
    cleanup.push(() => bunker.close());
    const signer = keep(await connectBunker(bunker.bunkerUrl, { timeoutMs: 5000 }));
    await expect(signer.signer.signEvent(template)).rejects.toThrow("user refused");
  });

  it("times out when no remote signer answers", async () => {
    const r = await relay();
    const silent = `bunker://${"ab".repeat(32)}?relay=${encodeURIComponent(r.url)}`;
    await expect(connectBunker(silent, { timeoutMs: 300 })).rejects.toThrow(/timeout/);
  });

  it.each([
    ["a NIP-05 name", "alice@example.com", "starts with bunker://"],
    ["a nostrconnect link", "nostrconnect://abc", "starts with bunker://"],
    ["a malformed bunker link", "bunker://not-a-key", "not valid"],
  ])("refuses %s", async (_name, link, message) => {
    await expect(connectBunker(link)).rejects.toThrow(message);
  });

  it("refuses insecure or empty relay lists for nostrconnect", () => {
    expect(() => startNostrConnect([])).toThrow("at least one relay");
    expect(() => startNostrConnect(["ws://relay.example.com"])).toThrow("not a wss://");
    expect(() => startNostrConnect(["https://relay.example.com"])).toThrow("not a wss://");
  });
});
