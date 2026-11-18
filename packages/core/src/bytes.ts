import { bytesToHex as nobleBytesToHex } from "@noble/hashes/utils.js";

const LOWER_HEX = /^(?:[0-9a-f]{2})*$/;

/** Encode bytes as lowercase hexadecimal. */
export function bytesToHex(bytes: Uint8Array): string {
  return nobleBytesToHex(bytes);
}

/**
 * Decode strict lowercase hexadecimal. Uppercase, odd length, whitespace and
 * `0x` prefixes are rejected so one byte string has exactly one text form.
 */
export function hexToBytes(hex: string, expectedLength?: number): Uint8Array {
  if (typeof hex !== "string" || !LOWER_HEX.test(hex)) {
    throw new TypeError("expected lowercase hexadecimal with an even number of digits");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new TypeError(`expected ${expectedLength} bytes, received ${bytes.length}`);
  }
  return bytes;
}

/** True when `value` is lowercase hexadecimal of exactly `byteLength` bytes. */
export function isHex(value: unknown, byteLength: number): value is string {
  return typeof value === "string" && value.length === byteLength * 2 && LOWER_HEX.test(value);
}

/** Compare two byte strings. Not constant time; use only for public data. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
