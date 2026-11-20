import { describe, expect, it } from "vitest";
import {
  createKeySigner,
  parseBchProof,
  proveBchControl,
  verifyBchProof,
  type BchSigner,
} from "../../src/core/bch-proof.js";
import { signBitcoinMessage } from "../../src/core/bch-message.js";
import { buildBinding, type BindingRecord } from "../../src/core/binding.js";
import { deriveBchKey, deriveNostrKey } from "../../src/core/keys.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const bchKey = deriveBchKey(MNEMONIC);
const otherKey = deriveBchKey(MNEMONIC, 0, 1);

function record(overrides: { createdAt?: number } = {}): BindingRecord {
  return buildBinding({
    nostrPublicKey: deriveNostrKey(MNEMONIC).publicKey,
    bchKeyHash: bchKey.keyHash,
    network: "chipnet",
    createdAt: overrides.createdAt ?? 1_700_000_000,
  });
}

describe("proveBchControl", () => {
  it("returns a verifiable message proof", async () => {
    const proof = await proveBchControl(createKeySigner(bchKey.privateKey), record(), "message");
    expect(proof.type).toBe("message");
    expect(verifyBchProof(record(), proof)).toEqual({ ok: true });
  });

  it("returns a verifiable transaction proof", async () => {
    const proof = await proveBchControl(createKeySigner(bchKey.privateKey), record(), "tx");
    expect(proof.type).toBe("tx");
    expect(verifyBchProof(record(), proof)).toEqual({ ok: true });
  });

  it("supports an ECDSA transaction signer", async () => {
    const signer = createKeySigner(bchKey.privateKey, { transactionSignature: "ecdsa" });
    const proof = await proveBchControl(signer, record(), "tx");
    expect(verifyBchProof(record(), proof).ok).toBe(true);
  });

  it("supports asynchronous wallet signers", async () => {
    const inner = createKeySigner(bchKey.privateKey);
    const signer: BchSigner = {
      signMessage: async (message) => {
        await Promise.resolve();
        return inner.signMessage(message);
      },
    };
    expect((await proveBchControl(signer, record(), "message")).type).toBe("message");
  });

  it("does not switch proof types when the requested one is unsupported", async () => {
    const messageOnly: BchSigner = { signMessage: createKeySigner(bchKey.privateKey).signMessage };
    const txOnly: BchSigner = {
      signTransaction: createKeySigner(bchKey.privateKey).signTransaction,
    };
    await expect(proveBchControl(messageOnly, record(), "tx")).rejects.toThrow(
      "this signer cannot sign transactions",
    );
    await expect(proveBchControl(txOnly, record(), "message")).rejects.toThrow(
      "this signer cannot sign messages",
    );
  });

  it("rejects an unknown proof type", async () => {
    await expect(
      proveBchControl(createKeySigner(bchKey.privateKey), record(), "other" as "tx"),
    ).rejects.toThrow(TypeError);
  });

  it("rejects a signer that signs with the wrong key", async () => {
    const wrong = createKeySigner(otherKey.privateKey);
    await expect(proveBchControl(wrong, record(), "message")).rejects.toThrow(
      /signer returned an invalid proof/,
    );
    await expect(proveBchControl(wrong, record(), "tx")).rejects.toThrow(
      /signer returned an invalid proof/,
    );
  });

  it("rejects a signer that signs different text", async () => {
    const liar: BchSigner = {
      signMessage: () => signBitcoinMessage(bchKey.privateKey, "something else"),
    };
    await expect(proveBchControl(liar, record(), "message")).rejects.toThrow(
      /signer returned an invalid proof/,
    );
  });

  it("rejects an invalid record before asking the signer", async () => {
    let asked = false;
    const signer: BchSigner = {
      signMessage: () => {
        asked = true;
        return "";
      },
    };
    await expect(
      proveBchControl(signer, { ...record(), version: 2 } as unknown as BindingRecord, "message"),
    ).rejects.toThrow();
    expect(asked).toBe(false);
  });

  it("passes the exact text and a one-input request to the signer", async () => {
    const seen: unknown[] = [];
    const inner = createKeySigner(bchKey.privateKey);
    const signer: BchSigner = {
      signMessage: (message) => {
        seen.push(message);
        return inner.signMessage(message);
      },
      signTransaction: (request) => {
        seen.push(request);
        return inner.signTransaction(request);
      },
    };
    await proveBchControl(signer, record(), "message");
    await proveBchControl(signer, record(), "tx");
    expect(String(seen[0]).startsWith("bnd/1/bch-proof\nbinding: ")).toBe(true);
    expect((seen[1] as { transaction: { inputs: unknown[] } }).transaction.inputs).toHaveLength(1);
  });
});

describe("verifyBchProof", () => {
  it("rejects a proof made for another binding", async () => {
    const proof = await proveBchControl(createKeySigner(bchKey.privateKey), record(), "message");
    expect(verifyBchProof(record({ createdAt: 1_700_000_001 }), proof).ok).toBe(false);
    const txProof = await proveBchControl(createKeySigner(bchKey.privateKey), record(), "tx");
    expect(verifyBchProof(record({ createdAt: 1_700_000_001 }), txProof).ok).toBe(false);
  });

  it("does not accept one proof type presented as the other", async () => {
    const message = await proveBchControl(createKeySigner(bchKey.privateKey), record(), "message");
    const tx = await proveBchControl(createKeySigner(bchKey.privateKey), record(), "tx");
    if (message.type !== "message" || tx.type !== "tx") throw new Error("unexpected types");
    expect(verifyBchProof(record(), { type: "tx", transaction: message.signature }).ok).toBe(false);
    expect(verifyBchProof(record(), { type: "message", signature: tx.transaction }).ok).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "proof"],
    ["an array", []],
    ["an unknown type", { type: "other", signature: "x" }],
    ["an extra member", { type: "message", signature: "x", extra: 1 }],
    ["a mixed shape", { type: "message", transaction: "00" }],
    ["a non-string signature", { type: "message", signature: 5 }],
  ])("rejects %s", (_name, proof) => {
    expect(verifyBchProof(record(), proof)).toMatchObject({ ok: false });
    expect(() => parseBchProof(proof)).toThrow(TypeError);
  });
});
