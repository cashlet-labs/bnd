import { bchProofMessage, signBitcoinMessage, verifyMessageProof } from "./bch-message.js";
import type { BindingRecord } from "./binding.js";
import { parseBinding } from "./binding.js";
import { fail, type VerifyResult } from "./result.js";
import {
  buildTxProofRequest,
  signTxProofRequest,
  verifyTxProof,
  type TxProofRequest,
  type TxProofSignature,
} from "./tx-proof.js";

/** Evidence that the holder of the bound BCH key approved a binding. */
export type BchProof = { type: "message"; signature: string } | { type: "tx"; transaction: string };

export type BchProofType = BchProof["type"];

/**
 * Whatever a BCH wallet connection can do. A signer implements the methods its
 * wallet supports. Both are first-class: a verifier accepts either proof.
 */
export interface BchSigner {
  /** Sign the exact text with Bitcoin Signed Message rules. Returns Base64. */
  signMessage?(message: string): Promise<string> | string;
  /** Sign the proof transaction. Returns the signed transaction as hex. */
  signTransaction?(request: TxProofRequest): Promise<string> | string;
}

/** Validate untrusted input as a BchProof. Unknown members are an error. */
export function parseBchProof(value: unknown): BchProof {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("proof must be an object");
  }
  const proof = value as Record<string, unknown>;
  const keys = Object.keys(proof).sort().join(",");
  if (
    proof.type === "message" &&
    keys === "signature,type" &&
    typeof proof.signature === "string"
  ) {
    return { type: "message", signature: proof.signature };
  }
  if (proof.type === "tx" && keys === "transaction,type" && typeof proof.transaction === "string") {
    return { type: "tx", transaction: proof.transaction };
  }
  throw new TypeError("proof must be {type:'message',signature} or {type:'tx',transaction}");
}

/** Verify either kind of proof against a binding record. */
export function verifyBchProof(record: BindingRecord, proof: unknown): VerifyResult {
  let parsed: BchProof;
  try {
    parsed = parseBchProof(proof);
  } catch (error) {
    return fail(`invalid proof: ${(error as Error).message}`);
  }
  return parsed.type === "message"
    ? verifyMessageProof(record, parsed.signature)
    : verifyTxProof(record, parsed.transaction);
}

/**
 * Ask a signer to prove control of the bound key. The caller chooses the proof
 * type; there is no automatic switch between them. The result is verified
 * before it is returned, so a wallet that signs the wrong thing is caught here.
 */
export async function proveBchControl(
  signer: BchSigner,
  record: BindingRecord,
  type: BchProofType,
): Promise<BchProof> {
  const parsed = parseBinding(record);
  let proof: BchProof;
  if (type === "message") {
    if (typeof signer.signMessage !== "function") {
      throw new TypeError("this signer cannot sign messages");
    }
    const signature = await signer.signMessage(bchProofMessage(parsed));
    proof = { type: "message", signature };
  } else if (type === "tx") {
    if (typeof signer.signTransaction !== "function") {
      throw new TypeError("this signer cannot sign transactions");
    }
    const transaction = await signer.signTransaction(buildTxProofRequest(parsed));
    proof = { type: "tx", transaction };
  } else {
    throw new TypeError("proof type must be 'message' or 'tx'");
  }
  const result = verifyBchProof(parsed, proof);
  if (!result.ok) throw new Error(`signer returned an invalid proof: ${result.reason}`);
  return proof;
}

/** A signer that holds a raw private key. For tests, demos and local tooling. */
export function createKeySigner(
  privateKey: Uint8Array,
  options: { transactionSignature?: TxProofSignature } = {},
): Required<BchSigner> {
  return {
    signMessage: (message) => signBitcoinMessage(privateKey, message),
    signTransaction: (request) =>
      signTxProofRequest(privateKey, request, {
        signature: options.transactionSignature ?? "schnorr",
      }),
  };
}
