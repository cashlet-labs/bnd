import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyBinding } from "../../src/core/binding-event.js";
import { deriveNostrKey } from "../../src/core/keys.js";

interface Vectors {
  mnemonic: string;
  valid: {
    name: string;
    event: unknown;
    bindingId: string;
    nostrPublicKey: string;
    bchAddress: string;
    proofType: string;
  }[];
  invalid: { name: string; event: unknown; reason?: string; reasonStartsWith?: string }[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../../spec/vectors/binding-event.json", import.meta.url), "utf8"),
) as Vectors;

describe("binding event vectors", () => {
  it("uses the Nostr key derived from the vector mnemonic", () => {
    const expected = deriveNostrKey(vectors.mnemonic).publicKey;
    for (const vector of vectors.valid) expect(vector.nostrPublicKey).toBe(expected);
  });

  for (const vector of vectors.valid) {
    it(`verifies: ${vector.name}`, () => {
      const result = verifyBinding(vector.event);
      expect(result).toMatchObject({
        ok: true,
        bindingId: vector.bindingId,
        nostrPublicKey: vector.nostrPublicKey,
        proofType: vector.proofType,
      });
      if (result.ok) expect(result.bch.address).toBe(vector.bchAddress);
    });
  }

  for (const vector of vectors.invalid) {
    it(`rejects: ${vector.name}`, () => {
      const result = verifyBinding(vector.event);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      if (vector.reason) expect(result.reason).toBe(vector.reason);
      if (vector.reasonStartsWith)
        expect(result.reason.startsWith(vector.reasonStartsWith)).toBe(true);
    });
  }
});
