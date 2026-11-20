import {
  CHAIN_IDS,
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  createRevocation,
  createSuccessor,
  deriveBchKey,
  deriveNostrKey,
  encodeBchAddress,
  type VerifiedBinding,
} from "@cashlet-labs/bnd";
import { MemoryRelay } from "@cashlet-labs/bnd/testing";
import { createMemoryWebSocket } from "../../src/nostr/memory-socket.js";
import { describe, expect, it } from "vitest";
import {
  didDocument,
  didOf,
  formatDid,
  InvalidDidError,
  multikeyOf,
  parseDid,
  resolveDid,
  resolveDidFromEvents,
} from "../../src/did/index.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const T = 1_700_000_000;
const N = [0, 1].map((i) => deriveNostrKey(MNEMONIC, i));
const B = [0, 1, 2].map((i) => deriveBchKey(MNEMONIC, 0, i));
const R = deriveNostrKey(MNEMONIC, 10);
const thiefB = deriveBchKey(MNEMONIC, 0, 20);

const ns = (key: (typeof N)[number]) => createNostrKeySigner(key.privateKey);
const bs = (key: (typeof B)[number]) => ({
  signer: createKeySigner(key.privateKey),
  proofType: "message" as const,
});

function root(bch = B[0]!, createdAt = T, recovery?: string) {
  return createBinding({
    nostrSigner: ns(N[0]!),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt,
    ...(recovery ? { recoveryPublicKey: recovery } : {}),
  });
}

function rotateBch(previous: VerifiedBinding, from: (typeof B)[number], to: (typeof B)[number]) {
  return createSuccessor({
    previous: previous.event,
    nostrSigner: ns(N[0]!),
    bchSigner: createKeySigner(to.privateKey),
    bchKeyHash: to.keyHash,
    network: "chipnet",
    proofType: "message",
    approvers: { bch: bs(from) },
    createdAt: previous.record.createdAt + 100,
  });
}

describe("did:bnd syntax", () => {
  it("formats and parses a DID", async () => {
    const binding = await root();
    const did = didOf(binding);
    expect(did).toBe(`did:bnd:chipnet:${N[0]!.publicKey}:${binding.bindingId}`);
    expect(formatDid(parseDid(did))).toBe(did);
  });

  it.each([
    ["another method", "did:nostr:" + "a".repeat(64)],
    ["a missing part", `did:bnd:chipnet:${"a".repeat(64)}`],
    ["an unknown network", `did:bnd:testnet:${"a".repeat(64)}:${"b".repeat(64)}`],
    ["upper-case hex", `did:bnd:chipnet:${"A".repeat(64)}:${"b".repeat(64)}`],
    ["a short binding ID", `did:bnd:chipnet:${"a".repeat(64)}:${"b".repeat(63)}`],
    ["an extra part", `did:bnd:chipnet:${"a".repeat(64)}:${"b".repeat(64)}:x`],
  ])("refuses %s", (_name, did) => {
    expect(() => parseDid(did)).toThrow(InvalidDidError);
  });

  it("keeps the same DID across rotations of either key", async () => {
    const first = await root();
    const second = await rotateBch(first, B[0]!, B[1]!);
    const third = await createSuccessor({
      previous: second.event,
      nostrSigner: ns(N[1]!),
      bchSigner: createKeySigner(B[1]!.privateKey),
      bchKeyHash: B[1]!.keyHash,
      network: "chipnet",
      proofType: "message",
      approvers: { nostr: ns(N[0]!) },
      createdAt: T + 200,
    });
    expect(didOf(second)).toBe(didOf(first));
    expect(didOf(third)).toBe(didOf(first));
  });
});

describe("DID document", () => {
  it("lists the Nostr key, the BCH account and the recovery key", async () => {
    const binding = await root(B[0]!, T, R.publicKey);
    const did = didOf(binding);
    const address = encodeBchAddress(B[0]!.keyHash, "chipnet");
    const doc = didDocument(binding, ["wss://relay.test"]);
    expect(doc).toEqual({
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://www.w3.org/ns/cid/v1",
        "https://w3id.org/security/suites/secp256k1recovery-2020/v2",
      ],
      id: did,
      alsoKnownAs: [`did:nostr:${N[0]!.publicKey}`],
      verificationMethod: [
        {
          id: `${did}#nostr`,
          type: "Multikey",
          controller: did,
          publicKeyMultibase: `fe70102${N[0]!.publicKey}`,
        },
        {
          id: `${did}#bch`,
          type: "EcdsaSecp256k1RecoveryMethod2020",
          controller: did,
          blockchainAccountId: `${CHAIN_IDS.chipnet}:${address.slice("bchtest:".length)}`,
        },
        {
          id: `${did}#recovery`,
          type: "Multikey",
          controller: did,
          publicKeyMultibase: multikeyOf(R.publicKey),
        },
      ],
      authentication: [`${did}#nostr`, `${did}#bch`],
      assertionMethod: [`${did}#nostr`],
      capabilityInvocation: [`${did}#nostr`, `${did}#bch`, `${did}#recovery`],
      service: [{ id: `${did}#relay-1`, type: "Relay", serviceEndpoint: "wss://relay.test" }],
    });
  });

  it("encodes Multikey as did:nostr does", () => {
    expect(multikeyOf("124c0fa99407182ece5a24fad9b7f6674902fc422843d3128d38a0afbee0fdd2")).toBe(
      "fe70102124c0fa99407182ece5a24fad9b7f6674902fc422843d3128d38a0afbee0fdd2",
    );
  });

  it("names no recovery key or services when there are none", async () => {
    const doc = didDocument(await root());
    expect(doc.verificationMethod.map((m) => m.id.split("#")[1])).toEqual(["nostr", "bch"]);
    expect(doc.service).toBeUndefined();
  });
});

describe("resolveDidFromEvents", () => {
  it("resolves a first binding", async () => {
    const binding = await root();
    const result = resolveDidFromEvents(didOf(binding), [binding.event]);
    expect(result.didResolutionMetadata).toEqual({ contentType: "application/did+ld+json" });
    expect(result.didDocument?.id).toBe(didOf(binding));
    expect(result.didDocumentMetadata).toMatchObject({
      created: "2023-11-14T22:13:20Z",
      versionId: binding.bindingId,
      bnd: { history: [] },
    });
    expect(result.didDocumentMetadata.updated).toBeUndefined();
  });

  it("follows rotations to the current keys, even with a stale copy of the root", async () => {
    const first = await root();
    const second = await rotateBch(first, B[0]!, B[1]!);
    const result = resolveDidFromEvents(didOf(first), [first.event, second.event]);
    expect(result.didDocumentMetadata).toMatchObject({
      versionId: second.bindingId,
      updated: "2023-11-14T22:15:00Z",
      bnd: { history: [first.bindingId], approvedBy: ["nostr", "bch"] },
    });
    expect(result.didDocument?.verificationMethod[1]?.blockchainAccountId).toContain(
      encodeBchAddress(B[1]!.keyHash, "chipnet").slice("bchtest:".length),
    );
  });

  it("deactivates a revoked DID", async () => {
    const first = await root();
    const revocation = await createRevocation({
      previous: first.event,
      signer: ns(N[0]!),
      approvers: { bch: bs(B[0]!) },
      createdAt: T + 100,
    });
    const result = resolveDidFromEvents(didOf(first), [first.event, revocation.event]);
    expect(result.didDocumentMetadata.deactivated).toBe(true);
  });

  it("ignores a thief's second first binding for the same Nostr key", async () => {
    const real = await root();
    const fake = await root(thiefB, T + 500);
    const result = resolveDidFromEvents(didOf(real), [real.event, fake.event]);
    expect(result.didDocumentMetadata.versionId).toBe(real.bindingId);
    // The thief's root is a different DID, with nothing to do with this one.
    expect(didOf(fake)).not.toBe(didOf(real));
  });

  it("reports a fork as a conflict", async () => {
    // Two successors of one binding, each approved by two keys: two keys were stolen,
    // or the owner made two. Neither is chosen.
    const first = await root();
    const a = await rotateBch(first, B[0]!, B[1]!);
    const b = await rotateBch(first, B[0]!, B[2]!);
    const result = resolveDidFromEvents(didOf(first), [a.event, b.event]);
    expect(result.didDocument).toBeNull();
    expect(result.didResolutionMetadata).toMatchObject({ error: "conflict" });
  });

  it("answers notFound and invalidDid", async () => {
    const binding = await root();
    const other = `did:bnd:chipnet:${N[0]!.publicKey}:${"0".repeat(64)}`;
    expect(resolveDidFromEvents(other, [binding.event]).didResolutionMetadata).toMatchObject({
      error: "notFound",
    });
    expect(resolveDidFromEvents("did:bnd:x", []).didResolutionMetadata).toMatchObject({
      error: "invalidDid",
    });
    const wrongNetwork = didOf(binding).replace(":chipnet:", ":mainnet:");
    expect(resolveDidFromEvents(wrongNetwork, [binding.event]).didResolutionMetadata).toMatchObject(
      { error: "notFound" },
    );
  });
});

describe("resolveDid over relays", () => {
  function world(...urls: string[]) {
    const relays = Object.fromEntries(urls.map((url) => [url, new MemoryRelay()]));
    return {
      relays,
      options: { relays: urls, WebSocket: createMemoryWebSocket({ relays }), timeoutMs: 500 },
    };
  }

  it("finds the current binding under a new Nostr key from the root's key", async () => {
    const { relays, options } = world("wss://a.test", "wss://b.test");
    const first = await root();
    const moved = await createSuccessor({
      previous: first.event,
      nostrSigner: ns(N[1]!),
      bchSigner: createKeySigner(B[0]!.privateKey),
      bchKeyHash: B[0]!.keyHash,
      network: "chipnet",
      proofType: "message",
      approvers: { nostr: ns(N[0]!) },
      createdAt: T + 100,
    });
    relays["wss://a.test"]!.seed(first.event);
    relays["wss://b.test"]!.seed(moved.event);
    const result = await resolveDid(didOf(first), options);
    expect(result.didDocument?.alsoKnownAs).toEqual([`did:nostr:${N[1]!.publicKey}`]);
    expect(result.didDocument?.service?.map((s) => s.serviceEndpoint)).toEqual([
      "wss://a.test",
      "wss://b.test",
    ]);
  });

  it("refuses to answer when too few relays respond", async () => {
    const { relays, options } = world("wss://a.test");
    const first = await root();
    relays["wss://a.test"]!.seed(first.event);
    const result = await resolveDid(didOf(first), { ...options, minComplete: 2 });
    expect(result.didResolutionMetadata).toMatchObject({ error: "internalError" });
    expect(
      (await resolveDid(didOf(first), { ...options, minComplete: 1 })).didDocument,
    ).not.toBeNull();
  });

  it("rejects an invalid DID before asking anyone", async () => {
    const result = await resolveDid("did:example:123", {});
    expect(result).toMatchObject({ didResolutionMetadata: { error: "invalidDid" }, relays: [] });
  });
});
