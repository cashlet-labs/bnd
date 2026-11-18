import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalBytes, canonicalize, CanonicalizationError } from "../src/index.js";

interface Vectors {
  accepted: { name: string; input: unknown; expected: string }[];
  rejected: { name: string; input: unknown }[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../spec/vectors/canonical.json", import.meta.url), "utf8"),
) as Vectors;

describe("canonicalize: shared vectors", () => {
  for (const vector of vectors.accepted) {
    it(`encodes: ${vector.name}`, () => {
      expect(canonicalize(vector.input)).toBe(vector.expected);
    });
  }

  for (const vector of vectors.rejected) {
    it(`rejects: ${vector.name}`, () => {
      expect(() => canonicalize(vector.input)).toThrow(CanonicalizationError);
    });
  }
});

describe("canonicalize: values JSON files cannot express", () => {
  const rejected: [string, unknown][] = [
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["bigint", 1n],
    ["function", () => 1],
    ["symbol", Symbol("x")],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["Uint8Array", new Uint8Array(1)],
    ["class instance", new (class Foo {})()],
    ["undefined member", { a: undefined }],
    ["nested undefined", { a: [1, undefined] }],
  ];
  for (const [name, input] of rejected) {
    it(`rejects ${name}`, () => {
      expect(() => canonicalize(input)).toThrow(CanonicalizationError);
    });
  }

  it("encodes negative zero as 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  it("accepts objects without a prototype", () => {
    const obj = Object.assign(Object.create(null) as object, { b: 1, a: 2 });
    expect(canonicalize(obj)).toBe('{"a":2,"b":1}');
  });

  it("is independent of key insertion order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("rejects excessive nesting", () => {
    let value: unknown = 1;
    for (let i = 0; i < 100; i++) value = [value];
    expect(() => canonicalize(value)).toThrow(/nesting/);
  });

  it("reports the path of the offending value", () => {
    expect(() => canonicalize({ a: { b: [1, 1.5] } })).toThrow("$.a.b[1]");
  });

  it("produces UTF-8 bytes", () => {
    expect(canonicalBytes({ a: "\u00e9" })).toEqual(
      new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0xa9, 0x22, 0x7d]),
    );
  });
});
