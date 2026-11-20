import {
  createVirtualMachineBCH,
  decodeTransaction,
  encodeLockingBytecodeP2pkh,
  encodeTransaction,
  generateSigningSerializationBCH,
  hash256,
  secp256k1 as libauthSecp256k1,
  type Output,
  type Transaction,
} from "@bitauth/libauth";
import { sha256 } from "@noble/hashes/sha2.js";
import { bindingId, parseBinding, type BindingRecord } from "./binding.js";
import { bytesEqual, bytesToHex, hexToBytes } from "./bytes.js";
import { fail, OK, type VerifyResult } from "./result.js";

/**
 * A transaction proof is a Bitcoin Cash transaction that spends a virtual
 * output of the bound key and commits to the binding ID. The input does not
 * exist on any chain, so the signed transaction can never be broadcast or
 * confirmed. It only demonstrates that the key signed this exact commitment.
 */

const BINDING_OUTPOINT_DOMAIN = "bnd/1/virtual-utxo\n";
const BINDING_TAG = "bnd1";
/** SIGHASH_ALL | SIGHASH_FORKID | SIGHASH_UTXOS: signs every output and every spent output. */
const SIGHASH_ALL_FORKID_UTXOS = 0x61;
const OP_RETURN = 0x6a;
const TX_VERSION = 2;
const SEQUENCE = 0xffffffff;

export interface TxProofRequest {
  /** Unsigned transaction with an empty unlocking script. */
  transaction: Transaction;
  /** The virtual output the input claims to spend. */
  sourceOutput: Output;
  /** Hex of the unsigned transaction, for wallet protocols that take hex. */
  transactionHex: string;
  /** Short text a wallet can show next to the request. */
  userPrompt: string;
}

/**
 * What a transaction proof commits to. The tag and outpoint domain keep a proof
 * for one purpose from being accepted for another, such as a binding proof
 * presented as a login.
 */
export interface TxCommitment {
  /** HASH160 of the key that must sign, as lowercase hex. */
  keyHash: string;
  /** Text hashed with the digest to form the virtual outpoint. */
  outpointDomain: string;
  /** Four ASCII characters placed before the digest in the OP_RETURN data. */
  tag: string;
  /** 32 bytes naming the statement being approved. */
  digest: Uint8Array;
  /** What to call the statement in error messages. */
  subject: string;
  /** Short text a wallet can show next to the request. */
  prompt: string;
}

function assertCommitment(commitment: TxCommitment): void {
  if (!/^[0-9a-f]{40}$/.test(commitment.keyHash)) throw new TypeError("invalid key hash");
  if (commitment.digest.length !== 32) throw new TypeError("digest must be 32 bytes");
  if (!/^[\x20-\x7e]{4}$/.test(commitment.tag))
    throw new TypeError("tag must be 4 ASCII characters");
}

/** The 36 bytes committed in the OP_RETURN output: tag followed by the digest. */
export function commitmentData(commitment: TxCommitment): Uint8Array {
  assertCommitment(commitment);
  const data = new Uint8Array(4 + 32);
  data.set(new TextEncoder().encode(commitment.tag));
  data.set(commitment.digest, 4);
  return data;
}

/** Outpoint hash of the virtual input: SHA-256 of a domain tag and the digest. */
export function commitmentOutpointHash(commitment: TxCommitment): Uint8Array {
  assertCommitment(commitment);
  const domain = new TextEncoder().encode(commitment.outpointDomain);
  const data = new Uint8Array(domain.length + 32);
  data.set(domain);
  data.set(commitment.digest, domain.length);
  return sha256(data);
}

function commitmentScript(commitment: TxCommitment): Uint8Array {
  const data = commitmentData(commitment);
  return Uint8Array.of(OP_RETURN, data.length, ...data);
}

/** The commitment a binding proof makes. */
export function bindingTxCommitment(record: BindingRecord): TxCommitment {
  const parsed = parseBinding(record);
  const id = bindingId(parsed);
  return {
    keyHash: parsed.bch.keyHash,
    outpointDomain: BINDING_OUTPOINT_DOMAIN,
    tag: BINDING_TAG,
    digest: hexToBytes(id),
    subject: "binding",
    prompt: `Prove you control this key for BND binding ${id.slice(0, 16)}. Nothing is sent.`,
  };
}

/** Build the unsigned proof transaction for any commitment. */
export function buildCommitmentTxRequest(commitment: TxCommitment): TxProofRequest {
  assertCommitment(commitment);
  const transaction: Transaction = {
    version: TX_VERSION,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: commitmentOutpointHash(commitment),
        outpointIndex: 0,
        sequenceNumber: SEQUENCE,
        unlockingBytecode: new Uint8Array(),
      },
    ],
    outputs: [{ lockingBytecode: commitmentScript(commitment), valueSatoshis: 0n }],
  };
  return {
    transaction,
    sourceOutput: {
      lockingBytecode: encodeLockingBytecodeP2pkh(hexToBytes(commitment.keyHash)),
      valueSatoshis: 0n,
    },
    transactionHex: bytesToHex(encodeTransaction(transaction)),
    userPrompt: commitment.prompt,
  };
}

/** The 36 bytes committed in a binding proof's OP_RETURN output: `"bnd1" || bindingId`. */
export function txProofCommitment(record: BindingRecord): Uint8Array {
  return commitmentData(bindingTxCommitment(record));
}

/** Outpoint hash of a binding proof's virtual input. */
export function virtualOutpointHash(record: BindingRecord): Uint8Array {
  return commitmentOutpointHash(bindingTxCommitment(record));
}

/** Build the unsigned proof transaction that a wallet is asked to sign for a binding. */
export function buildTxProofRequest(record: BindingRecord): TxProofRequest {
  return buildCommitmentTxRequest(bindingTxCommitment(record));
}

export type TxProofSignature = "schnorr" | "ecdsa";

function push(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length > 75) throw new RangeError("unsupported push length");
  return Uint8Array.of(data.length, ...data);
}

/**
 * Sign a proof request with a local private key, with hash type 0x61. The
 * result is the same kind of signed transaction a wallet returns over a wallet
 * protocol. Returns the signed transaction as hex.
 */
export function signTxProofRequest(
  privateKey: Uint8Array,
  request: TxProofRequest,
  options: { signature?: TxProofSignature } = {},
): string {
  const input = request.transaction.inputs[0];
  if (request.transaction.inputs.length !== 1 || input === undefined) {
    throw new Error("a proof request has exactly one input");
  }
  const preimage = generateSigningSerializationBCH(
    { inputIndex: 0, sourceOutputs: [request.sourceOutput], transaction: request.transaction },
    {
      coveredBytecode: request.sourceOutput.lockingBytecode,
      signingSerializationType: Uint8Array.of(SIGHASH_ALL_FORKID_UTXOS),
    },
  );
  const sighash = hash256(preimage);
  const signature =
    (options.signature ?? "schnorr") === "schnorr"
      ? libauthSecp256k1.signMessageHashSchnorr(privateKey, sighash)
      : libauthSecp256k1.signMessageHashDER(privateKey, sighash);
  if (typeof signature === "string")
    throw new Error(`could not sign transaction proof: ${signature}`);
  const publicKey = libauthSecp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === "string") throw new Error(`invalid private key: ${publicKey}`);
  const signed: Transaction = {
    ...request.transaction,
    inputs: [
      {
        ...input,
        unlockingBytecode: Uint8Array.of(
          ...push(Uint8Array.of(...signature, SIGHASH_ALL_FORKID_UTXOS)),
          ...push(publicKey),
        ),
      },
    ],
  };
  return bytesToHex(encodeTransaction(signed));
}

/** Build the proof request for a record and sign it with a local private key. */
export function signTxProof(
  privateKey: Uint8Array,
  record: BindingRecord,
  options: { signature?: TxProofSignature } = {},
): string {
  return signTxProofRequest(privateKey, buildTxProofRequest(record), options);
}

interface P2pkhUnlock {
  signature: Uint8Array;
  publicKey: Uint8Array;
}

/** Parse exactly `<signature+hashtype> <33-byte compressed key>`. */
function parseP2pkhUnlock(bytecode: Uint8Array): P2pkhUnlock | null {
  const length = bytecode[0];
  if (length === undefined || length < 65 || length > 73) return null;
  if (bytecode.length !== 1 + length + 1 + 33) return null;
  if (bytecode[1 + length] !== 33) return null;
  const publicKey = bytecode.subarray(2 + length);
  if (publicKey[0] !== 0x02 && publicKey[0] !== 0x03) return null;
  return { signature: bytecode.subarray(1, 1 + length), publicKey };
}

const vm = createVirtualMachineBCH(true);

/** Check a signed proof transaction against any commitment. */
export function verifyCommitmentTx(commitment: TxCommitment, transactionHex: string): VerifyResult {
  let expected: TxProofRequest;
  try {
    expected = buildCommitmentTxRequest(commitment);
  } catch (error) {
    return fail(`invalid commitment: ${(error as Error).message}`);
  }

  let raw: Uint8Array;
  try {
    raw = hexToBytes(transactionHex);
  } catch {
    return fail("invalid transaction proof: not lowercase hex");
  }
  const decoded = decodeTransaction(raw);
  if (typeof decoded === "string") return fail(`invalid transaction proof: ${decoded}`);
  if (!bytesEqual(encodeTransaction(decoded), raw)) {
    return fail("invalid transaction proof: non-canonical encoding");
  }

  const want = expected.transaction;
  const input = decoded.inputs[0];
  const output = decoded.outputs[0];
  if (
    decoded.version !== want.version ||
    decoded.locktime !== want.locktime ||
    decoded.inputs.length !== 1 ||
    decoded.outputs.length !== 1 ||
    input === undefined ||
    output === undefined
  ) {
    return fail("transaction proof does not have the required structure");
  }
  if (
    input.outpointIndex !== 0 ||
    input.sequenceNumber !== SEQUENCE ||
    !bytesEqual(input.outpointTransactionHash, commitmentOutpointHash(commitment))
  ) {
    return fail(`transaction proof does not spend this ${commitment.subject}'s virtual output`);
  }
  if (
    output.valueSatoshis !== 0n ||
    output.token !== undefined ||
    !bytesEqual(output.lockingBytecode, commitmentScript(commitment))
  ) {
    return fail(`transaction proof does not commit to this ${commitment.subject}`);
  }

  const unlock = parseP2pkhUnlock(input.unlockingBytecode);
  if (!unlock) return fail("transaction proof has a malformed unlocking script");
  if (unlock.signature[unlock.signature.length - 1] !== SIGHASH_ALL_FORKID_UTXOS) {
    return fail("transaction proof must use SIGHASH_ALL | FORKID | UTXOS (0x61)");
  }

  const verified = vm.verify({
    sourceOutputs: [expected.sourceOutput],
    transaction: decoded,
  });
  if (typeof verified === "string")
    return fail(`transaction proof signature is invalid: ${verified}`);
  return OK;
}

/** Check a signed proof transaction against a binding record. */
export function verifyTxProof(record: BindingRecord, transactionHex: string): VerifyResult {
  let commitment: TxCommitment;
  try {
    commitment = bindingTxCommitment(record);
  } catch (error) {
    return fail(`invalid binding: ${(error as Error).message}`);
  }
  return verifyCommitmentTx(commitment, transactionHex);
}
