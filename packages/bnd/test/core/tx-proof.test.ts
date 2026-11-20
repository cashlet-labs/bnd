import { readFileSync } from "node:fs";
import { decodeTransaction, encodeTransaction, type Transaction } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import { buildBinding, parseBinding, type BindingRecord } from "../../src/core/binding.js";
import { bytesToHex, hexToBytes } from "../../src/core/bytes.js";
import { deriveBchKey, deriveNostrKey } from "../../src/core/keys.js";
import {
  buildTxProofRequest,
  signTxProof,
  txProofCommitment,
  verifyTxProof,
  virtualOutpointHash,
} from "../../src/core/tx-proof.js";

interface Vectors {
  mnemonic: string;
  cases: {
    name: string;
    record: unknown;
    bindingId: string;
    virtualOutpointHash: string;
    commitment: string;
    unsignedTransaction: string;
    signedSchnorr: string;
    signedEcdsa: string;
  }[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../../spec/vectors/bch-tx-proof.json", import.meta.url), "utf8"),
) as Vectors;

const key = deriveBchKey(vectors.mnemonic);
const first = vectors.cases[0]!;
const record = parseBinding(first.record);

function decode(hex: string): Transaction {
  const tx = decodeTransaction(hexToBytes(hex));
  if (typeof tx === "string") throw new Error(tx);
  return tx;
}

function mutate(hex: string, change: (tx: Transaction) => void): string {
  const tx = decode(hex);
  change(tx);
  return bytesToHex(encodeTransaction(tx));
}

describe("buildTxProofRequest", () => {
  it("matches the vector", () => {
    const request = buildTxProofRequest(record);
    expect(request.transactionHex).toBe(first.unsignedTransaction);
    expect(bytesToHex(virtualOutpointHash(record))).toBe(first.virtualOutpointHash);
    expect(bytesToHex(txProofCommitment(record))).toBe(first.commitment);
  });

  it("describes a zero-value virtual input and one OP_RETURN output", () => {
    const request = buildTxProofRequest(record);
    expect(request.sourceOutput.valueSatoshis).toBe(0n);
    expect(request.transaction.inputs).toHaveLength(1);
    expect(request.transaction.outputs).toHaveLength(1);
    expect(request.transaction.outputs[0]!.valueSatoshis).toBe(0n);
    expect(request.transaction.outputs[0]!.lockingBytecode[0]).toBe(0x6a);
    expect(request.transaction.locktime).toBe(0);
  });

  it("locks the source output to the bound key hash", () => {
    const lock = buildTxProofRequest(record).sourceOutput.lockingBytecode;
    expect(bytesToHex(lock)).toBe(`76a914${record.bch.keyHash}88ac`);
  });

  it("gives a wallet prompt short enough for wallet UIs", () => {
    expect(buildTxProofRequest(record).userPrompt.length).toBeLessThanOrEqual(200);
  });

  it("differs for different bindings", () => {
    const other = buildBinding({
      nostrPublicKey: deriveNostrKey(vectors.mnemonic, 1).publicKey,
      bchKeyHash: record.bch.keyHash,
      network: "mainnet",
      createdAt: record.createdAt,
    });
    expect(buildTxProofRequest(other).transactionHex).not.toBe(first.unsignedTransaction);
  });
});

describe("verifyTxProof: vectors", () => {
  for (const vector of vectors.cases) {
    it(`accepts the Schnorr proof: ${vector.name}`, () => {
      expect(verifyTxProof(parseBinding(vector.record), vector.signedSchnorr)).toEqual({
        ok: true,
      });
    });

    it(`accepts the ECDSA proof: ${vector.name}`, () => {
      expect(verifyTxProof(parseBinding(vector.record), vector.signedEcdsa)).toEqual({ ok: true });
    });

    it(`reproduces the signed vectors: ${vector.name}`, () => {
      const parsed = parseBinding(vector.record);
      expect(signTxProof(key.privateKey, parsed, { signature: "schnorr" })).toBe(
        vector.signedSchnorr,
      );
      expect(signTxProof(key.privateKey, parsed, { signature: "ecdsa" })).toBe(vector.signedEcdsa);
    });
  }
});

describe("verifyTxProof: rejections", () => {
  const signed = first.signedSchnorr;

  it("rejects the unsigned request", () => {
    expect(verifyTxProof(record, first.unsignedTransaction)).toMatchObject({
      ok: false,
      reason: "transaction proof has a malformed unlocking script",
    });
  });

  it("rejects a proof signed by a different key", () => {
    const other = deriveBchKey(vectors.mnemonic, 0, 1);
    const result = verifyTxProof(record, signTxProof(other.privateKey, record));
    expect(result.ok).toBe(false);
  });

  it("rejects the Nostr key signing the same proof", () => {
    const nostr = deriveNostrKey(vectors.mnemonic);
    expect(verifyTxProof(record, signTxProof(nostr.privateKey, record)).ok).toBe(false);
  });

  it("rejects a proof replayed on another binding", () => {
    const other: BindingRecord = { ...record, createdAt: record.createdAt + 1 };
    expect(verifyTxProof(other, signed)).toMatchObject({
      ok: false,
      reason: "transaction proof does not spend this binding's virtual output",
    });
  });

  it("rejects a proof for the same record on another network", () => {
    const other: BindingRecord = { ...record, bch: { ...record.bch, network: "chipnet" } };
    expect(verifyTxProof(other, signed).ok).toBe(false);
  });

  it("rejects a changed commitment", () => {
    const tampered = mutate(signed, (tx) => {
      tx.outputs[0]!.lockingBytecode = Uint8Array.from(tx.outputs[0]!.lockingBytecode);
      tx.outputs[0]!.lockingBytecode[10] = tx.outputs[0]!.lockingBytecode[10]! ^ 1;
    });
    expect(verifyTxProof(record, tampered)).toMatchObject({
      reason: "transaction proof does not commit to this binding",
    });
  });

  it("rejects a non-zero output value", () => {
    const tampered = mutate(signed, (tx) => {
      tx.outputs[0]!.valueSatoshis = 1n;
    });
    expect(verifyTxProof(record, tampered).ok).toBe(false);
  });

  it("rejects an extra output", () => {
    const tampered = mutate(signed, (tx) => {
      tx.outputs.push({ ...tx.outputs[0]! });
    });
    expect(verifyTxProof(record, tampered)).toMatchObject({
      reason: "transaction proof does not have the required structure",
    });
  });

  it("rejects an extra input", () => {
    const tampered = mutate(signed, (tx) => {
      tx.inputs.push({ ...tx.inputs[0]!, outpointIndex: 1 });
    });
    expect(verifyTxProof(record, tampered).ok).toBe(false);
  });

  it("rejects a changed locktime, version, sequence and outpoint index", () => {
    expect(
      verifyTxProof(
        record,
        mutate(signed, (tx) => void (tx.locktime = 1)),
      ).ok,
    ).toBe(false);
    expect(
      verifyTxProof(
        record,
        mutate(signed, (tx) => void (tx.version = 1)),
      ).ok,
    ).toBe(false);
    expect(
      verifyTxProof(
        record,
        mutate(signed, (tx) => void (tx.inputs[0]!.sequenceNumber = 0)),
      ).ok,
    ).toBe(false);
    expect(
      verifyTxProof(
        record,
        mutate(signed, (tx) => void (tx.inputs[0]!.outpointIndex = 1)),
      ).ok,
    ).toBe(false);
  });

  it("rejects a different signature hash type", () => {
    for (const hashType of [0x00, 0x01, 0x21, 0x41, 0x43, 0x62, 0xc1, 0xe1]) {
      const tampered = mutate(first.signedEcdsa, (tx) => {
        const script = Uint8Array.from(tx.inputs[0]!.unlockingBytecode);
        script[script[0]!] = hashType;
        tx.inputs[0]!.unlockingBytecode = script;
      });
      expect(verifyTxProof(record, tampered)).toMatchObject({
        reason: "transaction proof must use SIGHASH_ALL | FORKID | UTXOS (0x61)",
      });
    }
  });

  it("rejects a corrupted signature", () => {
    const tampered = mutate(signed, (tx) => {
      const script = Uint8Array.from(tx.inputs[0]!.unlockingBytecode);
      script[10] = script[10]! ^ 1;
      tx.inputs[0]!.unlockingBytecode = script;
    });
    expect(verifyTxProof(record, tampered)).toMatchObject({ ok: false });
  });

  it("rejects an uncompressed or extra public key push", () => {
    const withExtra = mutate(signed, (tx) => {
      tx.inputs[0]!.unlockingBytecode = Uint8Array.of(...tx.inputs[0]!.unlockingBytecode, 0x00);
    });
    expect(verifyTxProof(record, withExtra)).toMatchObject({
      reason: "transaction proof has a malformed unlocking script",
    });
    const badKey = mutate(signed, (tx) => {
      const script = Uint8Array.from(tx.inputs[0]!.unlockingBytecode);
      script[script.length - 33] = 0x04;
      tx.inputs[0]!.unlockingBytecode = script;
    });
    expect(verifyTxProof(record, badKey).ok).toBe(false);
  });

  it("rejects trailing bytes and truncation", () => {
    expect(verifyTxProof(record, `${signed}00`).ok).toBe(false);
    expect(verifyTxProof(record, signed.slice(0, -2)).ok).toBe(false);
  });

  it("rejects text that is not lowercase hex", () => {
    expect(verifyTxProof(record, signed.toUpperCase())).toMatchObject({
      reason: "invalid transaction proof: not lowercase hex",
    });
    expect(verifyTxProof(record, "")).toMatchObject({ ok: false });
    expect(verifyTxProof(record, "zz")).toMatchObject({ ok: false });
    expect(verifyTxProof(record, undefined as unknown as string)).toMatchObject({ ok: false });
  });

  it("rejects an invalid binding record", () => {
    expect(
      verifyTxProof({ ...record, version: 2 } as unknown as BindingRecord, signed),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe("verifyTxProof: proofs signed by real wallets", () => {
  interface WalletVectors {
    cases: { name: string; record: unknown; transaction: string; hashType: string }[];
  }
  const wallets = JSON.parse(
    readFileSync(
      new URL("../../../../spec/vectors/bch-tx-proof-wallets.json", import.meta.url),
      "utf8",
    ),
  ) as WalletVectors;

  for (const vector of wallets.cases) {
    const walletRecord = parseBinding(vector.record);

    it(`accepts: ${vector.name}`, () => {
      expect(verifyTxProof(walletRecord, vector.transaction)).toEqual({ ok: true });
    });

    it(`rebuilds the request the wallet was sent: ${vector.name}`, () => {
      const request = buildTxProofRequest(walletRecord);
      const signed = decode(vector.transaction);
      expect(signed.inputs[0]!.outpointTransactionHash).toEqual(
        request.transaction.inputs[0]!.outpointTransactionHash,
      );
      expect(signed.outputs).toEqual(request.transaction.outputs);
    });

    it(`rejects it for another binding: ${vector.name}`, () => {
      const other = { ...walletRecord, createdAt: walletRecord.createdAt + 1 };
      expect(verifyTxProof(other, vector.transaction).ok).toBe(false);
    });

    it(`rejects it with a changed key hash: ${vector.name}`, () => {
      const other = { ...walletRecord, bch: { ...walletRecord.bch, keyHash: "00".repeat(20) } };
      expect(verifyTxProof(other, vector.transaction).ok).toBe(false);
    });

    it(`rejects a flipped signature byte: ${vector.name}`, () => {
      const tampered = mutate(vector.transaction, (tx) => {
        const script = Uint8Array.from(tx.inputs[0]!.unlockingBytecode);
        script[5] = script[5]! ^ 1;
        tx.inputs[0]!.unlockingBytecode = script;
      });
      expect(verifyTxProof(walletRecord, tampered).ok).toBe(false);
    });
  }
});
