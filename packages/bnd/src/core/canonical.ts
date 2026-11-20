/**
 * Canonical JSON encoding for BND, following RFC 8785 (JCS) for the subset
 * of JSON values the protocol uses: objects, arrays, strings, booleans, null
 * and safe integers. Anything else is rejected rather than silently coerced,
 * because two implementations must produce identical bytes to agree on a hash.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

const MAX_DEPTH = 64;

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function encodeString(value: string, path: string): string {
  if (hasLoneSurrogate(value)) {
    throw new CanonicalizationError(`${path}: string contains a lone surrogate`);
  }
  return JSON.stringify(value);
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function encode(value: unknown, path: string, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new CanonicalizationError(`${path}: maximum nesting depth exceeded`);
  }
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return encodeString(value, path);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalizationError(`${path}: only safe integers are allowed`);
      }
      // JSON.stringify prints -0 as "0", which is the canonical form.
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        const items = (value as unknown[]).map((item, i) =>
          encode(item, `${path}[${i}]`, depth + 1),
        );
        return `[${items.join(",")}]`;
      }
      if (!isPlainObject(value)) {
        throw new CanonicalizationError(`${path}: only plain objects are allowed`);
      }
      const record = value as Record<string, unknown>;
      // The default sort compares UTF-16 code units, which is the JCS key order.
      const keys = Object.keys(record).sort();
      const members = keys.map((key) => {
        const member = record[key];
        if (member === undefined) {
          throw new CanonicalizationError(`${path}.${key}: undefined is not allowed`);
        }
        return `${encodeString(key, `${path}.${key}`)}:${encode(member, `${path}.${key}`, depth + 1)}`;
      });
      return `{${members.join(",")}}`;
    }
    default:
      throw new CanonicalizationError(`${path}: unsupported value type ${typeof value}`);
  }
}

/** Encode a value as canonical JSON text. Throws CanonicalizationError on unsupported input. */
export function canonicalize(value: unknown): string {
  return encode(value, "$", 0);
}

/** Encode a value as canonical JSON, then as UTF-8 bytes. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
