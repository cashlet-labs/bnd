import { readFileSync } from "node:fs";
import {
  bigIntToCompactUint,
  hash256,
  secp256k1 as libauthSecp256k1,
  utf8ToBin,
} from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import {
  bchProofMessage,
  bitcoinMessageHash,
  compactSize,
  recoverMessageKeyHash,
  signBitcoinMessage,
  verifyMessageProof,
} from "../../src/core/bch-message.js";
import { parseBinding, buildBinding, type BindingRecord } from "../../src/core/binding.js";
import { base64ToBytes, bytesToBase64, bytesToHex } from "../../src/core/bytes.js";
import { deriveBchKey, deriveNostrKey } from "../../src/core/keys.js";

interface Vectors {
  mnemonic: string;
  cases: {
    name: string;
    record: unknown;
    message: string;
    messageHash: string;
    signature: string;
  }[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../../spec/vectors/bch-message-proof.json", import.meta.url), "utf8"),
) as Vectors;

const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const bchKey = deriveBchKey(vectors.mnemonic);
const first = vectors.cases[0]!;
const record = parseBinding(first.record);

/** Signing the way wallets implement `bch_signMessage`, using libauth primitives. */
function walletSign(privateKey: Uint8Array, message: string): string {
  const messageBin = utf8ToBin(message);
  const preImage = new Uint8Array([
    0x18,
    ...utf8ToBin("Bitcoin Signed Message:\n"),
    ...bigIntToCompactUint(BigInt(messageBin.length)),
    ...messageBin,
  ]);
  const signed = libauthSecp256k1.signMessageHashRecoverableCompact(privateKey, hash256(preImage));
  if (typeof signed === "string") throw new Error(signed);
  return bytesToBase64(new Uint8Array([31 + signed.recoveryId, ...signed.signature]));
}

describe("bchProofMessage", () => {
  it("builds the exact text from the record", () => {
    expect(bchProofMessage(record)).toBe(first.message);
    expect(first.message).toBe(
      [
        "bnd/1/bch-proof",
        "binding: 1efede82e3da09cd2579eff9cdd888d263e9047abdc18e6c3808ff63acb7a242",
        "nostr: 17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917",
        "bch: bitcoincash:qrk96lntm80kjww9gye5cej7uh0wjyd8yskyw66u3y",
        "created: 1700000000",
      ].join("\n"),
    );
  });

  it("changes when any bound field changes", () => {
    const messages = new Set([
      first.message,
      bchProofMessage({ ...record, createdAt: record.createdAt + 1 }),
      bchProofMessage({ ...record, bch: { ...record.bch, network: "chipnet" } }),
      bchProofMessage({ ...record, previous: "ab".repeat(32) }),
    ]);
    expect(messages.size).toBe(4);
  });

  it("rejects an invalid record", () => {
    expect(() => bchProofMessage({ ...record, version: 2 } as unknown as BindingRecord)).toThrow();
  });
});

describe("bitcoinMessageHash", () => {
  it("matches the independent SHA-256d of the vector", () => {
    expect(bytesToHex(bitcoinMessageHash(first.message))).toBe(first.messageHash);
  });

  it("uses a CompactSize length for long messages", () => {
    expect(bytesToHex(bitcoinMessageHash("a".repeat(300)))).toBe(
      "3ec158a43b80359df647352dac1d37dbf26a94e5f06e5790760290c75cd11dc0",
    );
  });

  it.each([
    [0, "00"],
    [252, "fc"],
    [253, "fdfd00"],
    [65535, "fdffff"],
    [65536, "fe00000100"],
    [0xffffffff, "feffffffff"],
  ])("encodes CompactSize %i", (value, hex) => {
    expect(bytesToHex(compactSize(value))).toBe(hex);
    expect(bytesToHex(compactSize(value))).toBe(bytesToHex(bigIntToCompactUint(BigInt(value))));
  });

  it("rejects invalid CompactSize input", () => {
    expect(() => compactSize(-1)).toThrow(RangeError);
    expect(() => compactSize(1.5)).toThrow(RangeError);
    expect(() => compactSize(0x100000000)).toThrow(RangeError);
  });
});

describe("message signing", () => {
  it("reproduces the vector signatures", () => {
    for (const vector of vectors.cases) {
      expect(signBitcoinMessage(bchKey.privateKey, vector.message)).toBe(vector.signature);
    }
  });

  it("produces the same bytes as the wallet implementation", () => {
    for (const vector of vectors.cases) {
      expect(walletSign(bchKey.privateKey, vector.message)).toBe(vector.signature);
    }
  });

  it("uses a 65-byte compressed-key compact signature", () => {
    const bytes = base64ToBytes(first.signature);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBeGreaterThanOrEqual(31);
    expect(bytes[0]).toBeLessThanOrEqual(34);
  });

  it("recovers the signer key hash", () => {
    expect(bytesToHex(recoverMessageKeyHash(first.message, first.signature))).toBe(
      bytesToHex(bchKey.keyHash),
    );
  });
});

describe("verifyMessageProof", () => {
  it("accepts every vector", () => {
    for (const vector of vectors.cases) {
      expect(verifyMessageProof(parseBinding(vector.record), vector.signature)).toEqual({
        ok: true,
      });
    }
  });

  it("accepts a signature made by the wallet algorithm", () => {
    expect(verifyMessageProof(record, walletSign(bchKey.privateKey, first.message)).ok).toBe(true);
  });

  it("rejects a signature by a different BCH key", () => {
    const other = deriveBchKey(vectors.mnemonic, 0, 1);
    const result = verifyMessageProof(record, signBitcoinMessage(other.privateKey, first.message));
    expect(result).toEqual({
      ok: false,
      reason: "message proof was not signed by the bound BCH key",
    });
  });

  it("rejects the Nostr key's signature over the same text", () => {
    const nostr = deriveNostrKey(vectors.mnemonic);
    expect(verifyMessageProof(record, signBitcoinMessage(nostr.privateKey, first.message)).ok).toBe(
      false,
    );
  });

  it("rejects a signature replayed on another binding", () => {
    const other = buildBinding({
      nostrPublicKey: deriveNostrKey(vectors.mnemonic, 1).publicKey,
      bchKeyHash: bchKey.keyHash,
      network: "mainnet",
      createdAt: record.createdAt,
    });
    expect(verifyMessageProof(other, first.signature).ok).toBe(false);
  });

  it("rejects a signature over a different message", () => {
    const result = verifyMessageProof(record, signBitcoinMessage(bchKey.privateKey, "hello"));
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid record", () => {
    const result = verifyMessageProof(
      { ...record, version: 2 } as unknown as BindingRecord,
      first.signature,
    );
    expect(result).toMatchObject({ ok: false });
  });

  describe("malformed signatures", () => {
    const bytes = base64ToBytes(first.signature);
    const withHeader = (header: number) => {
      const copy = Uint8Array.from(bytes);
      copy[0] = header;
      return bytesToBase64(copy);
    };

    it.each([27, 28, 29, 30, 35, 0, 255])("rejects header %i", (header) => {
      expect(verifyMessageProof(record, withHeader(header)).ok).toBe(false);
    });

    it("rejects the wrong recovery id", () => {
      const header = bytes[0]!;
      const flipped = header === 31 || header === 32 ? header ^ 1 : 31 + ((header - 31) ^ 1);
      expect(verifyMessageProof(record, withHeader(flipped)).ok).toBe(false);
    });

    it("rejects wrong lengths", () => {
      expect(verifyMessageProof(record, bytesToBase64(bytes.slice(0, 64))).ok).toBe(false);
      expect(verifyMessageProof(record, bytesToBase64(new Uint8Array([...bytes, 0]))).ok).toBe(
        false,
      );
    });

    it("rejects non-canonical Base64", () => {
      expect(verifyMessageProof(record, first.signature.replace(/=+$/, "")).ok).toBe(false);
      expect(verifyMessageProof(record, ` ${first.signature}`).ok).toBe(false);
    });

    it("rejects hex and empty input", () => {
      expect(verifyMessageProof(record, bytesToHex(bytes)).ok).toBe(false);
      expect(verifyMessageProof(record, "").ok).toBe(false);
      expect(verifyMessageProof(record, undefined as unknown as string).ok).toBe(false);
    });

    it("rejects a high-S signature that is otherwise valid", () => {
      const s = BigInt(`0x${bytesToHex(bytes.slice(33))}`);
      const flippedS = (ORDER - s).toString(16).padStart(64, "0");
      const high = new Uint8Array(65);
      high[0] = bytes[0]! ^ 1;
      high.set(bytes.slice(1, 33), 1);
      high.set(Uint8Array.from(flippedS.match(/../g)!.map((b) => parseInt(b, 16))), 33);
      const result = verifyMessageProof(record, bytesToBase64(high));
      expect(result).toEqual({
        ok: false,
        reason: "invalid message proof: signature must use a low S value",
      });
    });

    it("rejects a signature with r or s equal to zero", () => {
      const zero = new Uint8Array(65);
      zero[0] = 31;
      expect(verifyMessageProof(record, bytesToBase64(zero)).ok).toBe(false);
    });
  });
});
