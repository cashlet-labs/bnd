import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BindingError,
  bindingAddress,
  bindingBytes,
  bindingId,
  bindingMatchesAddress,
  buildBinding,
  parseBinding,
} from "../src/binding.js";
import { encodeBchAddress } from "../src/bch.js";
import { bytesToHex, hexToBytes } from "../src/bytes.js";
import { deriveBchKey, deriveNostrKey } from "../src/keys.js";

interface Vectors {
  mnemonic: string;
  keys: { nostrPublicKey: string; bchKeyHash: string };
  valid: { name: string; record: unknown; canonical: string; bindingId: string; address: string }[];
  invalid: { name: string; record: unknown }[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/vectors/binding.json", import.meta.url), "utf8"),
) as Vectors;

describe("binding vectors", () => {
  it("derives the vector keys from the mnemonic", () => {
    expect(deriveNostrKey(vectors.mnemonic).publicKey).toBe(vectors.keys.nostrPublicKey);
    expect(bytesToHex(deriveBchKey(vectors.mnemonic).keyHash)).toBe(vectors.keys.bchKeyHash);
  });

  for (const vector of vectors.valid) {
    describe(vector.name, () => {
      const record = parseBinding(vector.record);

      it("encodes canonically", () => {
        expect(new TextDecoder().decode(bindingBytes(record))).toBe(vector.canonical);
      });

      it("has the expected binding ID", () => {
        expect(bindingId(record)).toBe(vector.bindingId);
      });

      it("maps to the expected address", () => {
        expect(bindingAddress(record)).toBe(vector.address);
        expect(bindingMatchesAddress(record, vector.address)).toBe(true);
      });
    });
  }

  for (const vector of vectors.invalid) {
    it(`rejects: ${vector.name}`, () => {
      expect(() => parseBinding(vector.record)).toThrow(BindingError);
    });
  }
});

describe("buildBinding", () => {
  const nostrPublicKey = vectors.keys.nostrPublicKey;
  const bchKeyHash = vectors.keys.bchKeyHash;

  it("accepts a key hash as bytes or hex", () => {
    const fromHex = buildBinding({ nostrPublicKey, bchKeyHash, network: "mainnet", createdAt: 5 });
    const fromBytes = buildBinding({
      nostrPublicKey,
      bchKeyHash: deriveBchKey(vectors.mnemonic).keyHash,
      network: "mainnet",
      createdAt: 5,
    });
    expect(fromBytes).toEqual(fromHex);
  });

  it("defaults createdAt to the current time", () => {
    const before = Math.floor(Date.now() / 1000);
    const record = buildBinding({ nostrPublicKey, bchKeyHash, network: "mainnet" });
    expect(record.createdAt).toBeGreaterThanOrEqual(before);
    expect(record.createdAt).toBeLessThanOrEqual(before + 5);
  });

  it("omits previous when not given", () => {
    const record = buildBinding({ nostrPublicKey, bchKeyHash, network: "mainnet", createdAt: 5 });
    expect("previous" in record).toBe(false);
  });

  it("validates its input", () => {
    expect(() =>
      buildBinding({ nostrPublicKey: "zz", bchKeyHash, network: "mainnet", createdAt: 5 }),
    ).toThrow(BindingError);
  });

  it("changes the ID when any field changes", () => {
    const base = buildBinding({ nostrPublicKey, bchKeyHash, network: "mainnet", createdAt: 5 });
    const ids = new Set([
      bindingId(base),
      bindingId({ ...base, createdAt: 6 }),
      bindingId({ ...base, bch: { ...base.bch, network: "testnet" } }),
      bindingId({ ...base, previous: "ab".repeat(32) }),
      bindingId({ ...base, bch: { ...base.bch, keyHash: "00".repeat(20) } }),
    ]);
    expect(ids.size).toBe(5);
  });

  it("does not depend on property order", () => {
    const record = buildBinding({ nostrPublicKey, bchKeyHash, network: "mainnet", createdAt: 5 });
    const reordered = JSON.parse(
      JSON.stringify({
        createdAt: record.createdAt,
        bch: { keyHash: record.bch.keyHash, network: record.bch.network },
        nostr: record.nostr,
        version: record.version,
        protocol: record.protocol,
      }),
    ) as unknown;
    expect(bindingId(parseBinding(reordered))).toBe(bindingId(record));
  });
});

describe("bindingMatchesAddress", () => {
  const record = parseBinding(vectors.valid[0]!.record);
  const address = vectors.valid[0]!.address;

  it("accepts the token-aware form of the same key", () => {
    const aware = encodeBchAddress(hexToBytes(record.bch.keyHash), "mainnet", { tokenAware: true });
    expect(aware).toMatch(/^bitcoincash:z/);
    expect(bindingMatchesAddress(record, aware)).toBe(true);
  });

  it("rejects an address for a different key", () => {
    const other = encodeBchAddress(new Uint8Array(20), "mainnet");
    expect(bindingMatchesAddress(record, other)).toBe(false);
  });

  it("rejects a different network", () => {
    expect(bindingMatchesAddress(record, vectors.valid[1]!.address)).toBe(false);
  });

  it("rejects garbage and P2SH", () => {
    expect(bindingMatchesAddress(record, "not an address")).toBe(false);
    expect(
      bindingMatchesAddress(record, "bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq"),
    ).toBe(false);
  });

  it("matches the plain address", () => {
    expect(bindingMatchesAddress(record, address)).toBe(true);
  });
});
