import { deriveHdPath, deriveHdPrivateNodeFromBip39Mnemonic } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import { bytesToHex } from "../src/bytes.js";
import { deriveBchKey, deriveNostrKey } from "../src/keys.js";

// NIP-06 test vectors.
const NIP06 = [
  {
    mnemonic: "leader monkey parrot ring guide accident before fence cannon height naive bean",
    privateKey: "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a",
    publicKey: "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917",
  },
  {
    mnemonic:
      "what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade",
    privateKey: "c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add",
    publicKey: "d41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573",
  },
];

const MNEMONIC = NIP06[0]!.mnemonic;

describe("deriveNostrKey", () => {
  for (const [i, vector] of NIP06.entries()) {
    it(`matches NIP-06 vector ${i + 1}`, () => {
      const key = deriveNostrKey(vector.mnemonic);
      expect(bytesToHex(key.privateKey)).toBe(vector.privateKey);
      expect(key.publicKey).toBe(vector.publicKey);
      expect(key.path).toBe("m/44'/1237'/0'/0/0");
    });
  }

  it("derives independent keys for different accounts", () => {
    expect(deriveNostrKey(MNEMONIC, 1).publicKey).not.toBe(deriveNostrKey(MNEMONIC, 0).publicKey);
    expect(deriveNostrKey(MNEMONIC, 1).path).toBe("m/44'/1237'/1'/0/0");
  });

  it("normalizes whitespace in the mnemonic", () => {
    expect(deriveNostrKey(`  ${MNEMONIC.replace(/ /g, "  ")}\n`).publicKey).toBe(
      NIP06[0]!.publicKey,
    );
  });

  it("rejects an invalid mnemonic", () => {
    expect(() => deriveNostrKey("not a valid mnemonic")).toThrow(/invalid BIP39/);
    expect(() => deriveNostrKey(MNEMONIC.replace("bean", "bear"))).toThrow(/invalid BIP39/);
  });

  it.each([-1, 1.5, 0x80000000, Number.NaN])("rejects account %s", (account) => {
    expect(() => deriveNostrKey(MNEMONIC, account)).toThrow(RangeError);
  });
});

describe("deriveBchKey", () => {
  it("agrees with an independent BIP32 implementation", async () => {
    const root = await deriveHdPrivateNodeFromBip39Mnemonic(MNEMONIC);
    const node = deriveHdPath(root, "m/44'/145'/0'/0/0");
    if (typeof node === "string") throw new Error(node);
    expect(bytesToHex(deriveBchKey(MNEMONIC).privateKey)).toBe(bytesToHex(node.privateKey));
  });

  it("derives a compressed public key and its HASH160", () => {
    const key = deriveBchKey(MNEMONIC);
    expect(key.publicKey).toHaveLength(33);
    expect(key.keyHash).toHaveLength(20);
    expect(key.path).toBe("m/44'/145'/0'/0/0");
  });

  it("derives different keys for different indexes and accounts", () => {
    const base = bytesToHex(deriveBchKey(MNEMONIC, 0, 0).keyHash);
    expect(bytesToHex(deriveBchKey(MNEMONIC, 0, 1).keyHash)).not.toBe(base);
    expect(bytesToHex(deriveBchKey(MNEMONIC, 1, 0).keyHash)).not.toBe(base);
  });

  it("never reuses the Nostr secret key", () => {
    expect(bytesToHex(deriveBchKey(MNEMONIC).privateKey)).not.toBe(
      bytesToHex(deriveNostrKey(MNEMONIC).privateKey),
    );
  });

  it("rejects invalid input", () => {
    expect(() => deriveBchKey("nope")).toThrow(/invalid BIP39/);
    expect(() => deriveBchKey(MNEMONIC, -1)).toThrow(RangeError);
    expect(() => deriveBchKey(MNEMONIC, 0, 1.5)).toThrow(RangeError);
  });
});
