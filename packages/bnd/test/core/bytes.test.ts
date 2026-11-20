import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  isHex,
} from "../../src/core/bytes.js";

describe("hex helpers", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(bytesToHex(bytes)).toBe("00017f80ff");
    expect(hexToBytes("00017f80ff")).toEqual(bytes);
  });

  it("accepts an empty string", () => {
    expect(hexToBytes("")).toEqual(new Uint8Array());
  });

  it.each(["0", "abc", "AB", "0xab", "ab cd", "zz", " ab"])("rejects %j", (bad) => {
    expect(() => hexToBytes(bad)).toThrow(TypeError);
  });

  it("rejects non-string input", () => {
    expect(() => hexToBytes(undefined as unknown as string)).toThrow(TypeError);
  });

  it("enforces an expected length", () => {
    expect(() => hexToBytes("abcd", 3)).toThrow(/expected 3 bytes/);
    expect(hexToBytes("abcd", 2)).toHaveLength(2);
  });

  it("checks hex of a given length", () => {
    expect(isHex("ab".repeat(32), 32)).toBe(true);
    expect(isHex("AB".repeat(32), 32)).toBe(false);
    expect(isHex("ab".repeat(31), 32)).toBe(false);
    expect(isHex(5, 1)).toBe(false);
  });

  it("compares bytes", () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe("canonical Base64", () => {
  it("round-trips bytes of every padding length", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 64, 65]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it("matches known encodings", () => {
    expect(bytesToBase64(new TextEncoder().encode("Man"))).toBe("TWFu");
    expect(bytesToBase64(new TextEncoder().encode("Ma"))).toBe("TWE=");
    expect(bytesToBase64(new TextEncoder().encode("M"))).toBe("TQ==");
  });

  it.each([
    ["missing padding", "TQ"],
    ["URL-safe characters", "-_-_"],
    ["whitespace", "TWFu\n"],
    ["non-zero trailing bits", "TR=="],
    ["extra padding", "TQ==="],
    ["wrong alphabet", "TW*u"],
  ])("rejects %s", (_name, text) => {
    expect(() => base64ToBytes(text)).toThrow(TypeError);
  });

  it("rejects non-string input", () => {
    expect(() => base64ToBytes(undefined as unknown as string)).toThrow(TypeError);
  });
});
