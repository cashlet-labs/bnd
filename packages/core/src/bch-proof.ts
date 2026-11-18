import { bchProofMessage, signBitcoinMessage, verifyMessageSignature } from "./bch-message.js";
import type { BindingRecord } from "./binding.js";
import { parseBinding } from "./binding.js";
import { fail, type VerifyResult } from "./result.js";
import {
  bindingTxCommitment,
  buildCommitmentTxRequest,
  signTxProofRequest,
  verifyCommitmentTx,
  type TxCommitment,
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

/**
 * Something the BCH key is asked to approve: the text a wallet signs for a
 * message proof, and the commitment a transaction proof carries. Both name the
 * same statement. Bindings and logins are two statements.
 */
export interface BchStatement {
  /** HASH160 of the key that must approve, as lowercase hex. */
  keyHash: string;
  /** The exact text signed by a message proof. */
  text: string;
  /** What a transaction proof commits to. */
  commitment: TxCommitment;
}

/** The statement the BCH key approves when a binding is created. */
export function bindingStatement(record: BindingRecord): BchStatement {
  const parsed = parseBinding(record);
  return {
    keyHash: parsed.bch.keyHash,
    text: bchProofMessage(parsed),
    commitment: bindingTxCommitment(parsed),
  };
}

/** Verify either kind of proof against any statement. */
export function verifyStatementProof(statement: BchStatement, proof: unknown): VerifyResult {
  let parsed: BchProof;
  try {
    parsed = parseBchProof(proof);
  } catch (error) {
    return fail(`invalid proof: ${(error as Error).message}`);
  }
  return parsed.type === "message"
    ? verifyMessageSignature(statement.keyHash, statement.text, parsed.signature)
    : verifyCommitmentTx(statement.commitment, parsed.transaction);
}

/** Verify either kind of proof against a binding record. */
export function verifyBchProof(record: BindingRecord, proof: unknown): VerifyResult {
  let statement: BchStatement;
  try {
    statement = bindingStatement(record);
  } catch (error) {
    return fail(`invalid binding: ${(error as Error).message}`);
  }
  return verifyStatementProof(statement, proof);
}

/**
 * Ask a signer to approve a statement. The caller chooses the proof type; there
 * is no automatic switch between them. The result is verified before it is
 * returned, so a wallet that signs the wrong thing is caught here.
 */
export async function proveStatement(
  signer: BchSigner,
  statement: BchStatement,
  type: BchProofType,
): Promise<BchProof> {
  let proof: BchProof;
  if (type === "message") {
    if (typeof signer.signMessage !== "function") {
      throw new TypeError("this signer cannot sign messages");
    }
    proof = { type: "message", signature: await signer.signMessage(statement.text) };
  } else if (type === "tx") {
    if (typeof signer.signTransaction !== "function") {
      throw new TypeError("this signer cannot sign transactions");
    }
    proof = {
      type: "tx",
      transaction: await signer.signTransaction(buildCommitmentTxRequest(statement.commitment)),
    };
  } else {
    throw new TypeError("proof type must be 'message' or 'tx'");
  }
  const result = verifyStatementProof(statement, proof);
  if (!result.ok) throw new Error(`signer returned an invalid proof: ${result.reason}`);
  return proof;
}

/** Ask a signer to prove control of the key bound by a record. */
export async function proveBchControl(
  signer: BchSigner,
  record: BindingRecord,
  type: BchProofType,
): Promise<BchProof> {
  return proveStatement(signer, bindingStatement(record), type);
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
