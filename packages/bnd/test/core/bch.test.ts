import { describe, expect, it } from "vitest";
import {
  addressPrefix,
  decodeBchAddress,
  encodeBchAddress,
  isBchNetwork,
  keyHashFromPublicKey,
} from "../../src/core/bch.js";
import { bytesToHex, hexToBytes } from "../../src/core/bytes.js";

// CashAddr specification test vector (P2PKH, 20-byte hash).
const SPEC_HASH = "f5bf48b397dae70be82b3cca4793f8eb2b6cdac9";
const SPEC_ADDRESS = "bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2";

// Compressed secp256k1 generator point: the well-known HASH160 is 751e76e8…
const GENERATOR = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const GENERATOR_HASH = "751e76e8199196d454941c45d1b3a323f1433bd6";

describe("keyHashFromPublicKey", () => {
  it("computes HASH160 of a compressed key", () => {
    expect(bytesToHex(keyHashFromPublicKey(hexToBytes(GENERATOR)))).toBe(GENERATOR_HASH);
  });

  it("rejects uncompressed and malformed keys", () => {
    expect(() => keyHashFromPublicKey(new Uint8Array(65).fill(4))).toThrow(TypeError);
    expect(() => keyHashFromPublicKey(new Uint8Array(33))).toThrow(TypeError);
    expect(() => keyHashFromPublicKey(new Uint8Array(32))).toThrow(TypeError);
  });
});

describe("encodeBchAddress", () => {
  it("matches the CashAddr specification vector", () => {
    expect(encodeBchAddress(hexToBytes(SPEC_HASH), "mainnet")).toBe(SPEC_ADDRESS);
  });

  it("derives an address that decodes back to the key hash", () => {
    const keyHash = keyHashFromPublicKey(hexToBytes(GENERATOR));
    const decoded = decodeBchAddress(encodeBchAddress(keyHash, "mainnet"));
    expect(bytesToHex(decoded.keyHash)).toBe(GENERATOR_HASH);
  });

  it("uses the bchtest prefix for chipnet", () => {
    expect(encodeBchAddress(hexToBytes(SPEC_HASH), "chipnet")).toMatch(/^bchtest:q/);
  });

  it("encodes the token-aware form with a z prefix letter", () => {
    expect(encodeBchAddress(hexToBytes(SPEC_HASH), "mainnet", { tokenAware: true })).toMatch(
      /^bitcoincash:z/,
    );
  });

  it("rejects a key hash of the wrong length", () => {
    expect(() => encodeBchAddress(new Uint8Array(19), "mainnet")).toThrow(TypeError);
  });
});

describe("decodeBchAddress", () => {
  it("decodes the specification vector", () => {
    const decoded = decodeBchAddress(SPEC_ADDRESS);
    expect(decoded.prefix).toBe("bitcoincash");
    expect(bytesToHex(decoded.keyHash)).toBe(SPEC_HASH);
    expect(decoded.tokenAware).toBe(false);
  });

  it("treats plain and token-aware forms as the same key hash", () => {
    const hash = hexToBytes(SPEC_HASH);
    const plain = decodeBchAddress(encodeBchAddress(hash, "mainnet"));
    const aware = decodeBchAddress(encodeBchAddress(hash, "mainnet", { tokenAware: true }));
    expect(aware.tokenAware).toBe(true);
    expect(bytesToHex(aware.keyHash)).toBe(bytesToHex(plain.keyHash));
  });

  it("round-trips on every network", () => {
    for (const network of ["mainnet", "chipnet"] as const) {
      const decoded = decodeBchAddress(encodeBchAddress(hexToBytes(SPEC_HASH), network));
      expect(decoded.prefix).toBe(addressPrefix(network));
    }
  });

  it("rejects an address without a prefix", () => {
    expect(() => decodeBchAddress(SPEC_ADDRESS.split(":")[1]!)).toThrow(TypeError);
  });

  it("rejects mixed case and upper case", () => {
    expect(() => decodeBchAddress(SPEC_ADDRESS.toUpperCase())).toThrow(TypeError);
    expect(() => decodeBchAddress(SPEC_ADDRESS.replace("qr6m", "Qr6m"))).toThrow(TypeError);
  });

  it("rejects a bad checksum", () => {
    const bad = SPEC_ADDRESS.slice(0, -1) + (SPEC_ADDRESS.endsWith("k") ? "q" : "k");
    expect(() => decodeBchAddress(bad)).toThrow(TypeError);
  });

  it("rejects P2SH addresses", () => {
    // Specification vector for a P2SH address.
    expect(() =>
      decodeBchAddress("bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq"),
    ).toThrow(/only P2PKH/);
  });

  it("rejects other prefixes", () => {
    expect(() => decodeBchAddress("bchreg:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2")).toThrow(
      TypeError,
    );
  });

  it("rejects non-string input", () => {
    expect(() => decodeBchAddress(undefined as unknown as string)).toThrow(TypeError);
  });
});

describe("isBchNetwork", () => {
  it("accepts only known networks", () => {
    expect(isBchNetwork("mainnet")).toBe(true);
    expect(isBchNetwork("chipnet")).toBe(true);
    expect(isBchNetwork("regtest")).toBe(false);
    expect(isBchNetwork("testnet")).toBe(false);
    expect(isBchNetwork("testnet4")).toBe(false);
    expect(isBchNetwork(undefined)).toBe(false);
  });
});
