import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  createRevocation,
  bytesToHex,
  deriveBchKey,
  deriveNostrKey,
} from "@cashlet-labs/bnd";
import { didOf } from "@cashlet-labs/bnd/did";
import { publishBinding } from "@cashlet-labs/bnd/nostr";
import { createMemoryWebSocket, MemoryRelay } from "@cashlet-labs/bnd/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createDriverHandler } from "../src/handler.js";

/** The JSON body of a response, for checking fields in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (response: Response): Promise<any> => response.json();

// Published BIP39 test vector. Never use it for funds.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const RELAYS = ["wss://a.test", "wss://b.test", "wss://c.test"];

let server: Server | null = null;
afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

async function setup(options: { down?: string[] } = {}) {
  const relays: Record<string, MemoryRelay | "refuse"> = {};
  for (const url of RELAYS)
    relays[url] = options.down?.includes(url) ? "refuse" : new MemoryRelay();
  const WebSocket = createMemoryWebSocket({ relays });
  const nostr = deriveNostrKey(MNEMONIC);
  const bch = deriveBchKey(MNEMONIC);
  const signers = {
    nostrSigner: createNostrKeySigner(nostr.privateKey),
    bchSigner: createKeySigner(bch.privateKey),
  };
  const binding = await createBinding({
    ...signers,
    bchKeyHash: bytesToHex(bch.keyHash),
    network: "chipnet",
    proofType: "message",
    createdAt: 1_795_200_000,
  });
  await publishBinding(binding.event, { relays: RELAYS, WebSocket });
  server = createServer(
    createDriverHandler({
      resolve: { relays: RELAYS, minComplete: 2, WebSocket },
      version: "test",
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, accept = "application/ld+json") =>
    fetch(`${base}${path}`, { headers: { accept } });
  const revoke = async () => {
    const revocation = await createRevocation({
      previous: binding.event,
      signer: signers.nostrSigner,
      approvers: { bch: { signer: signers.bchSigner, proofType: "message" } },
      createdAt: 1_795_200_100,
    });
    await publishBinding(revocation.event, { relays: RELAYS, WebSocket });
  };
  return { did: didOf(binding), get, revoke };
}

describe("did:bnd Universal Resolver driver", () => {
  it("returns a DID Resolution Result by default", async () => {
    const { did, get } = await setup();
    const response = await get(`/1.0/identifiers/${did}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      'application/ld+json;profile="https://w3id.org/did-resolution";charset=utf-8',
    );
    const body = await json(response);
    expect(body.didDocument.id).toBe(did);
    expect(body.didResolutionMetadata).toEqual({ contentType: "application/did+ld+json" });
    expect(body.didDocumentMetadata.versionId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns only the document when asked for it, with or without JSON-LD context", async () => {
    const { did, get } = await setup();
    const ld = await get(`/1.0/identifiers/${encodeURIComponent(did)}`, "application/did+ld+json");
    expect(ld.headers.get("content-type")).toBe("application/did+ld+json;charset=utf-8");
    const document = await json(ld);
    expect(document.id).toBe(did);
    expect(document["@context"]).toBeDefined();
    const plain = await json(await get(`/1.0/identifiers/${did}`, "application/did+json"));
    expect(plain.id).toBe(did);
    expect(plain["@context"]).toBeUndefined();
  });

  it("uses the DID Resolution status codes", async () => {
    const { did, get, revoke } = await setup();
    expect((await get("/1.0/identifiers/did:bnd:nonsense")).status).toBe(400);
    const unknown = `did:bnd:chipnet:${"ab".repeat(32)}:${"cd".repeat(32)}`;
    const missing = await get(`/1.0/identifiers/${unknown}`);
    expect(missing.status).toBe(404);
    expect((await json(missing)).didResolutionMetadata.error).toBe("notFound");
    await revoke();
    const revoked = await get(`/1.0/identifiers/${did}`);
    expect(revoked.status).toBe(410);
    expect((await json(revoked)).didDocumentMetadata.deactivated).toBe(true);
  });

  it("refuses to answer when too few relays respond, instead of guessing", async () => {
    const { did, get } = await setup({ down: ["wss://b.test", "wss://c.test"] });
    const response = await get(`/1.0/identifiers/${did}`);
    expect(response.status).toBe(500);
    expect((await json(response)).didResolutionMetadata.error).toBe("internalError");
  });

  it("serves /health and nothing else", async () => {
    const { get } = await setup();
    expect(await (await get("/health")).json()).toEqual({ ok: true, version: "test" });
    expect((await get("/other")).status).toBe(404);
  });
});
