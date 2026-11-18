import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keyHashFromPublicKey } from "./bch.js";
import { base64ToBytes, bytesEqual, bytesToBase64, hexToBytes } from "./bytes.js";
import { bindingAddress, bindingId, parseBinding, type BindingRecord } from "./binding.js";
import { fail, OK, type VerifyResult } from "./result.js";

/** Bitcoin signed-message prefix: length byte 0x18 followed by 24 text bytes. */
const MESSAGE_PREFIX = new TextEncoder().encode("\x18Bitcoin Signed Message:\n");

/** Half the secp256k1 group order. Signatures above it are high-S and rejected. */
const HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/** Exact text a BCH wallet signs to prove control of the bound key. */
export function bchProofMessage(record: BindingRecord): string {
  const parsed = parseBinding(record);
  return [
    "bnd/1/bch-proof",
    `binding: ${bindingId(parsed)}`,
    `nostr: ${parsed.nostr.publicKey}`,
    `bch: ${bindingAddress(parsed)}`,
    `created: ${parsed.createdAt}`,
  ].join("\n");
}

/** Bitcoin CompactSize integer encoding. */
export function compactSize(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("invalid CompactSize value");
  if (value < 0xfd) return Uint8Array.of(value);
  if (value <= 0xffff) return Uint8Array.of(0xfd, value & 0xff, value >>> 8);
  if (value <= 0xffffffff) {
    return Uint8Array.of(
      0xfe,
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      value >>> 24,
    );
  }
  throw new RangeError("message too long");
}

/** SHA-256d of the prefixed message, as used by Bitcoin "Sign message". */
export function bitcoinMessageHash(message: string): Uint8Array {
  const body = new TextEncoder().encode(message);
  const length = compactSize(body.length);
  const data = new Uint8Array(MESSAGE_PREFIX.length + length.length + body.length);
  data.set(MESSAGE_PREFIX);
  data.set(length, MESSAGE_PREFIX.length);
  data.set(body, MESSAGE_PREFIX.length + length.length);
  return sha256(sha256(data));
}

/**
 * Sign a message the way Bitcoin wallets do: a 65-byte compact signature whose
 * first byte is `31 + recoveryId` (compressed key), as canonical Base64.
 */
export function signBitcoinMessage(privateKey: Uint8Array, message: string): string {
  const recovered = secp256k1.sign(bitcoinMessageHash(message), privateKey, {
    prehash: false,
    format: "recovered",
  });
  const compact = new Uint8Array(65);
  compact[0] = 31 + recovered[0]!;
  compact.set(recovered.subarray(1), 1);
  return bytesToBase64(compact);
}

/** Recover the HASH160 of the signing key. Throws on any malformed signature. */
export function recoverMessageKeyHash(message: string, signature: string): Uint8Array {
  const compact = base64ToBytes(signature);
  if (compact.length !== 65) throw new TypeError("signature must be 65 bytes");
  const header = compact[0]!;
  if (header < 31 || header > 34) {
    throw new TypeError("signature header must select a compressed key (31 to 34)");
  }
  const s = BigInt(
    `0x${Array.from(compact.subarray(33), (b) => b.toString(16).padStart(2, "0")).join("")}`,
  );
  if (s > HALF_ORDER) throw new TypeError("signature must use a low S value");
  const recovered = new Uint8Array(65);
  recovered[0] = header - 31;
  recovered.set(compact.subarray(1), 1);
  const publicKey = secp256k1.recoverPublicKey(recovered, bitcoinMessageHash(message), {
    prehash: false,
  });
  return keyHashFromPublicKey(publicKey);
}

/** Check a signed-message proof against a binding record. */
export function verifyMessageProof(record: BindingRecord, signature: string): VerifyResult {
  let expected: Uint8Array;
  let message: string;
  try {
    const parsed = parseBinding(record);
    expected = hexToBytes(parsed.bch.keyHash);
    message = bchProofMessage(parsed);
  } catch (error) {
    return fail(`invalid binding: ${(error as Error).message}`);
  }
  let actual: Uint8Array;
  try {
    actual = recoverMessageKeyHash(message, signature);
  } catch (error) {
    return fail(`invalid message proof: ${(error as Error).message}`);
  }
  return bytesEqual(actual, expected)
    ? OK
    : fail("message proof was not signed by the bound BCH key");
}
