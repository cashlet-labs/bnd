import {
  createVirtualMachineBCH,
  decodeTransaction,
  encodeLockingBytecodeP2pkh,
  encodeTransaction,
  generateTransaction,
  importWalletTemplate,
  walletTemplateP2pkhNonHd,
  walletTemplateToCompilerBCH,
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

const VIRTUAL_UTXO_DOMAIN = new TextEncoder().encode("bnd/1/virtual-utxo\n");
const COMMITMENT_TAG = new TextEncoder().encode("bnd1");
const SIGHASH_ALL_FORKID = 0x41;
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

/** The 36 bytes committed in the OP_RETURN output: `"bnd1" || bindingId`. */
export function txProofCommitment(record: BindingRecord): Uint8Array {
  const id = hexToBytes(bindingId(record));
  const data = new Uint8Array(COMMITMENT_TAG.length + id.length);
  data.set(COMMITMENT_TAG);
  data.set(id, COMMITMENT_TAG.length);
  return data;
}

/** Outpoint hash of the virtual input: SHA-256 of a domain tag and the binding ID. */
export function virtualOutpointHash(record: BindingRecord): Uint8Array {
  const id = hexToBytes(bindingId(record));
  const data = new Uint8Array(VIRTUAL_UTXO_DOMAIN.length + id.length);
  data.set(VIRTUAL_UTXO_DOMAIN);
  data.set(id, VIRTUAL_UTXO_DOMAIN.length);
  return sha256(data);
}

function commitmentScript(record: BindingRecord): Uint8Array {
  const data = txProofCommitment(record);
  return Uint8Array.of(OP_RETURN, data.length, ...data);
}

function sourceOutputFor(record: BindingRecord): Output {
  return {
    lockingBytecode: encodeLockingBytecodeP2pkh(hexToBytes(record.bch.keyHash)),
    valueSatoshis: 0n,
  };
}

/** Build the unsigned proof transaction that a wallet is asked to sign. */
export function buildTxProofRequest(record: BindingRecord): TxProofRequest {
  const parsed = parseBinding(record);
  const transaction: Transaction = {
    version: TX_VERSION,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: virtualOutpointHash(parsed),
        outpointIndex: 0,
        sequenceNumber: SEQUENCE,
        unlockingBytecode: new Uint8Array(),
      },
    ],
    outputs: [{ lockingBytecode: commitmentScript(parsed), valueSatoshis: 0n }],
  };
  return {
    transaction,
    sourceOutput: sourceOutputFor(parsed),
    transactionHex: bytesToHex(encodeTransaction(transaction)),
    userPrompt: `Prove you control this key for BND binding ${bindingId(parsed).slice(0, 16)}. Nothing is sent.`,
  };
}

export type TxProofSignature = "schnorr" | "ecdsa";

function compilerFor(signature: TxProofSignature) {
  const template = structuredClone(walletTemplateP2pkhNonHd);
  if (signature === "ecdsa") {
    template.scripts.unlock!.script = "<key.ecdsa_signature.all_outputs>\n<key.public_key>";
  }
  const imported = importWalletTemplate(template);
  if (typeof imported === "string") throw new Error(imported);
  return walletTemplateToCompilerBCH(imported);
}

/**
 * Sign the proof transaction with a local private key. Wallet protocols return
 * the same kind of signed transaction. Returns the signed transaction as hex.
 */
export function signTxProof(
  privateKey: Uint8Array,
  record: BindingRecord,
  options: { signature?: TxProofSignature } = {},
): string {
  const request = buildTxProofRequest(record);
  const input = request.transaction.inputs[0]!;
  const result = generateTransaction({
    version: request.transaction.version,
    locktime: request.transaction.locktime,
    outputs: request.transaction.outputs,
    inputs: [
      {
        outpointTransactionHash: input.outpointTransactionHash,
        outpointIndex: input.outpointIndex,
        sequenceNumber: input.sequenceNumber,
        unlockingBytecode: {
          compiler: compilerFor(options.signature ?? "schnorr"),
          data: { keys: { privateKeys: { key: privateKey } } },
          valueSatoshis: request.sourceOutput.valueSatoshis,
          script: "unlock",
          token: undefined,
        },
      },
    ],
  });
  if (!result.success)
    throw new Error(`could not build transaction proof: ${JSON.stringify(result)}`);
  return bytesToHex(encodeTransaction(result.transaction));
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

/** Check a signed proof transaction against a binding record. */
export function verifyTxProof(record: BindingRecord, transactionHex: string): VerifyResult {
  let expected: TxProofRequest;
  try {
    expected = buildTxProofRequest(record);
  } catch (error) {
    return fail(`invalid binding: ${(error as Error).message}`);
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
    !bytesEqual(input.outpointTransactionHash, virtualOutpointHash(record))
  ) {
    return fail("transaction proof does not spend this binding's virtual output");
  }
  if (
    output.valueSatoshis !== 0n ||
    output.token !== undefined ||
    !bytesEqual(output.lockingBytecode, commitmentScript(record))
  ) {
    return fail("transaction proof does not commit to this binding");
  }

  const unlock = parseP2pkhUnlock(input.unlockingBytecode);
  if (!unlock) return fail("transaction proof has a malformed unlocking script");
  if (unlock.signature[unlock.signature.length - 1] !== SIGHASH_ALL_FORKID) {
    return fail("transaction proof must use SIGHASH_ALL | FORKID");
  }

  const verified = vm.verify({
    sourceOutputs: [expected.sourceOutput],
    transaction: decoded,
  });
  if (typeof verified === "string")
    return fail(`transaction proof signature is invalid: ${verified}`);
  return OK;
}
