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

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Encode bytes as canonical padded Base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Decode canonical padded Base64. Whitespace, URL-safe characters, missing
 * padding and non-zero trailing bits are rejected, so each byte string has one
 * text form and a signature cannot be re-encoded into a different string.
 */
export function base64ToBytes(text: string): Uint8Array {
  if (typeof text !== "string" || !BASE64.test(text)) {
    throw new TypeError("expected canonical padded Base64");
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytesToBase64(bytes) !== text) throw new TypeError("expected canonical padded Base64");
  return bytes;
}
