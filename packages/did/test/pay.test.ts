import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  createRevocation,
  createSuccessor,
  deriveBchKey,
  deriveNostrKey,
  encodeBchAddress,
  npubEncode,
} from "@cashlet-labs/bnd-core";
import { MemoryRelay } from "@cashlet-labs/bnd-nostr/testing";
import { describe, expect, it } from "vitest";
import { createMemoryWebSocket } from "../../nostr/src/memory-socket.js";
import { didOf, paymentUri, resolvePayee } from "../src/index.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const T = 1_700_000_000;
const nostr = deriveNostrKey(MNEMONIC, 0);
const other = deriveNostrKey(MNEMONIC, 1);
const B = [0, 1].map((i) => deriveBchKey(MNEMONIC, 0, i));
const ns = createNostrKeySigner(nostr.privateKey);

function root(bch = B[0]!, key = nostr, createdAt = T) {
  return createBinding({
    nostrSigner: createNostrKeySigner(key.privateKey),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt,
  });
}

function world(count = 2) {
  const urls = Array.from({ length: count }, (_, i) => `wss://r${i}.test`);
  const relays = Object.fromEntries(urls.map((url) => [url, new MemoryRelay()]));
  const seed = (event: unknown) => {
    for (const relay of Object.values(relays)) relay.seed(event as never);
  };
  return {
    seed,
    options: { relays: urls, WebSocket: createMemoryWebSocket({ relays }), timeoutMs: 500 },
  };
}

describe("resolvePayee", () => {
  it("resolves an npub, a hex key and a did:bnd to the same verified address", async () => {
    const { seed, options } = world();
    const binding = await root();
    seed(binding.event);
    const plain = encodeBchAddress(B[0]!.keyHash, "chipnet");
    const tokens = encodeBchAddress(B[0]!.keyHash, "chipnet", { tokenAware: true });
    for (const target of [npubEncode(nostr.publicKey), nostr.publicKey, didOf(binding)]) {
      const result = await resolvePayee(target, options);
      expect(result).toMatchObject({
        ok: true,
        address: plain,
        tokenAddress: tokens,
        did: didOf(binding),
      });
    }
    expect(tokens).toMatch(/^bchtest:z/);
  });

  it("pays the current address after a rotation", async () => {
    const { seed, options } = world();
    const first = await root();
    const next = await createSuccessor({
      previous: first.event,
      nostrSigner: ns,
      bchSigner: createKeySigner(B[1]!.privateKey),
      bchKeyHash: B[1]!.keyHash,
      network: "chipnet",
      proofType: "message",
      approvers: { bch: { signer: createKeySigner(B[0]!.privateKey), proofType: "message" } },
      createdAt: T + 100,
    });
    seed(first.event);
    seed(next.event);
    for (const target of [npubEncode(nostr.publicKey), didOf(first)]) {
      const result = await resolvePayee(target, options);
      expect(result.ok && result.address).toBe(encodeBchAddress(B[1]!.keyHash, "chipnet"));
    }
  });

  it("refuses a revoked identity", async () => {
    const { seed, options } = world();
    const first = await root();
    const revocation = await createRevocation({
      previous: first.event,
      signer: ns,
      approvers: { bch: { signer: createKeySigner(B[0]!.privateKey), proofType: "message" } },
      createdAt: T + 100,
    });
    seed(first.event);
    seed(revocation.event);
    for (const target of [npubEncode(nostr.publicKey), didOf(first)]) {
      expect(await resolvePayee(target, options)).toEqual({
        ok: false,
        reason: "this identity has been revoked",
      });
    }
  });

  it("refuses a disputed identity", async () => {
    // Two first bindings for one key, each on a different plain relay.
    const urls = ["wss://a.test", "wss://b.test"];
    const relays = { [urls[0]!]: new MemoryRelay(), [urls[1]!]: new MemoryRelay() };
    relays[urls[0]!]!.seed((await root(B[0]!, nostr, T)).event);
    relays[urls[1]!]!.seed((await root(B[1]!, nostr, T + 50)).event);
    const result = await resolvePayee(npubEncode(nostr.publicKey), {
      relays: urls,
      WebSocket: createMemoryWebSocket({ relays }),
      timeoutMs: 500,
    });
    expect(result).toEqual({
      ok: false,
      reason: "conflicting bindings claim this identity; do not pay until it is settled",
    });
  });

  it("refuses when too few relays answer, or nothing is found, or the input is wrong", async () => {
    const { seed, options } = world(1);
    seed((await root()).event);
    expect(await resolvePayee(npubEncode(nostr.publicKey), options)).toMatchObject({
      ok: false,
      reason: "could not check: 1 of the required 2 relays answered",
    });
    expect(
      (await resolvePayee(npubEncode(nostr.publicKey), { ...options, minComplete: 1 })).ok,
    ).toBe(true);
    expect(await resolvePayee(npubEncode(other.publicKey), { ...options, minComplete: 1 })).toEqual(
      {
        ok: false,
        reason: "no verified binding was found for this key",
      },
    );
    expect(await resolvePayee("bitcoincash:qq", options)).toEqual({
      ok: false,
      reason: "enter an npub, a Nostr public key or a did:bnd",
    });
  });
});

describe("paymentUri", () => {
  const address = "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvhanqgjxu";

  it("writes a BIP21 URI with the amount, label and message", () => {
    expect(paymentUri(address)).toBe(address);
    expect(
      paymentUri(address, { amount: "0.0015", label: "Alice & Bob", message: "for coffee" }),
    ).toBe(`${address}?amount=0.0015&label=Alice%20%26%20Bob&message=for%20coffee`);
  });

  it.each(["0", "-1", "1e3", "0.000000001", "1,5", "abc", "01"])(
    "refuses the amount %s",
    (amount) => {
      expect(() => paymentUri(address, { amount })).toThrow(RangeError);
    },
  );
});
