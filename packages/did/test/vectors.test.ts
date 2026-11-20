import { readFileSync } from "node:fs";
import { verifyBinding } from "@cashlet-labs/bnd-core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { didDocument, resolveDidFromEvents, type DidResolutionResult } from "../src/index.js";

interface Vectors {
  events: Record<string, unknown>;
  resolution: { name: string; did: string; events: string[]; result: DidResolutionResult }[];
}

const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../spec/${path}`, import.meta.url), "utf8"));
const vectors = read("vectors/did.json") as Vectors;
const validate = new Ajv2020({ strict: true }).compile(
  read("schemas/did-bnd-document.schema.json") as object,
);

describe("did:bnd vectors", () => {
  for (const vector of vectors.resolution) {
    it(`resolves: ${vector.name}`, () => {
      const events = vector.events.map((id) => vectors.events[id]);
      expect(resolveDidFromEvents(vector.did, events)).toEqual(vector.result);
    });
  }

  it("covers every outcome", () => {
    const outcomes = new Set(
      vectors.resolution.map(({ result }) =>
        "error" in result.didResolutionMetadata
          ? result.didResolutionMetadata.error
          : result.didDocumentMetadata.deactivated
            ? "deactivated"
            : "ok",
      ),
    );
    expect(outcomes).toEqual(new Set(["ok", "deactivated", "conflict", "notFound", "invalidDid"]));
  });
});

describe("did:bnd document schema", () => {
  const documents = vectors.resolution.flatMap(({ result }) =>
    result.didDocument === null ? [] : [result.didDocument],
  );

  it("accepts every document in the vectors", () => {
    expect(documents.length).toBeGreaterThan(3);
    for (const document of documents) {
      expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("accepts a document with relay services", () => {
    const first = vectors.resolution[0]!.result.didDocumentMetadata.bnd!.event;
    const binding = verifyBinding(first);
    if (!binding.ok) throw new Error(binding.reason);
    expect(validate(didDocument(binding, ["wss://relay.test"]))).toBe(true);
  });

  it.each([
    ["an unknown member", (d: Record<string, unknown>) => ({ ...d, extra: 1 })],
    [
      "another method's id",
      (d: Record<string, unknown>) => ({ ...d, id: "did:nostr:" + "a".repeat(64) }),
    ],
    [
      "a missing BCH account",
      (d: Record<string, unknown>) => ({
        ...d,
        verificationMethod: (d.verificationMethod as unknown[]).slice(0, 1),
      }),
    ],
    [
      "a different context",
      (d: Record<string, unknown>) => ({ ...d, "@context": ["https://www.w3.org/ns/did/v1"] }),
    ],
  ])("refuses %s", (_name, change) => {
    expect(validate(change(documents[0] as unknown as Record<string, unknown>))).toBe(false);
  });
});
