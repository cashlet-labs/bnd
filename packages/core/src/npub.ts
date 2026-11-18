import { bech32 } from "@scure/base";
import { bytesToHex, hexToBytes, isHex } from "./bytes.js";

const PREFIX = "npub";

/** Encode a 32-byte x-only public key (lowercase hex) as a NIP-19 `npub` string. */
export function npubEncode(publicKey: string): string {
  if (!isHex(publicKey, 32)) throw new TypeError("expected a 32-byte public key in lowercase hex");
  return bech32.encode(PREFIX, bech32.toWords(hexToBytes(publicKey)));
}

/**
 * Decode a NIP-19 `npub` string to lowercase hex. Throws on a wrong prefix,
 * a bad checksum, mixed case or a payload that is not 32 bytes.
 */
export function npubDecode(npub: string): string {
  if (typeof npub !== "string") throw new TypeError("npub must be a string");
  const decoded = bech32.decode(npub as `${string}1${string}`);
  if (decoded.prefix !== PREFIX) throw new TypeError("not an npub");
  const bytes = bech32.fromWords(decoded.words);
  if (bytes.length !== 32) throw new TypeError("npub must hold 32 bytes");
  return bytesToHex(bytes);
}
