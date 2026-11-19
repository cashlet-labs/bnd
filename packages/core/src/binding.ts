import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  decodeBchAddress,
  encodeBchAddress,
  isBchNetwork,
  keyHashFromPublicKey,
  type BchNetwork,
} from "./bch.js";
import { bytesEqual, bytesToHex, hexToBytes, isHex } from "./bytes.js";
import { canonicalBytes } from "./canonical.js";

export const PROTOCOL_ID = "bnd";
export const PROTOCOL_VERSION = 1;

const BINDING_ID_DOMAIN = new TextEncoder().encode("bnd/1/binding-id\n");

/** The statement both keys sign. Field order is irrelevant: encoding is canonical. */
export interface BindingRecord {
  protocol: typeof PROTOCOL_ID;
  version: typeof PROTOCOL_VERSION;
  /** The Nostr identity being bound. */
  nostr: { publicKey: string };
  /** The BCH P2PKH key being bound, by network and HASH160. */
  bch: { network: BchNetwork; keyHash: string };
  /** Unix time in seconds. */
  createdAt: number;
  /** ID of the binding this one replaces, if any. */
  previous?: string;
  /**
   * An extra key, kept offline, that can stand in for a lost or stolen key
   * when this binding is replaced or revoked (section 9).
   */
  recovery?: { publicKey: string };
  /** Present only on a revocation: the identity has no current binding after it. */
  revoked?: true;
}

export class BindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingError";
  }
}

export interface BuildBindingInput {
  nostrPublicKey: string;
  bchKeyHash: Uint8Array | string;
  network: BchNetwork;
  /** Unix seconds. Defaults to the current time. */
  createdAt?: number;
  previous?: string;
  /** x-only public key of a recovery key, as lowercase hex. */
  recoveryPublicKey?: string;
  /** Make this record a revocation. Needs `previous`. */
  revoked?: true;
}

function isValidXOnlyKey(hex: string): boolean {
  if (!isHex(hex, 32)) return false;
  try {
    secp256k1.Point.fromBytes(hexToBytes(`02${hex}`));
    return true;
  } catch {
    return false;
  }
}

/** Build a binding record from its parts and validate it. */
export function buildBinding(input: BuildBindingInput): BindingRecord {
  const keyHash =
    typeof input.bchKeyHash === "string" ? input.bchKeyHash : bytesToHex(input.bchKeyHash);
  const record: BindingRecord = {
    protocol: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    nostr: { publicKey: input.nostrPublicKey },
    bch: { network: input.network, keyHash },
    createdAt: input.createdAt ?? Math.floor(Date.now() / 1000),
    ...(input.previous === undefined ? {} : { previous: input.previous }),
    ...(input.recoveryPublicKey === undefined
      ? {}
      : { recovery: { publicKey: input.recoveryPublicKey } }),
    ...(input.revoked === undefined ? {} : { revoked: input.revoked }),
  };
  return parseBinding(record);
}

function expectObject(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BindingError(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new BindingError(`${path}.${key} is not allowed`);
  }
  return record;
}

/**
 * Validate untrusted input as a binding record. The result is a fresh object
 * containing only known fields; unknown fields are an error, so a record
 * cannot carry data the signers did not intend.
 */
export function parseBinding(value: unknown): BindingRecord {
  const top = expectObject(value, "binding", [
    "protocol",
    "version",
    "nostr",
    "bch",
    "createdAt",
    "previous",
    "recovery",
    "revoked",
  ]);
  if (top.protocol !== PROTOCOL_ID) throw new BindingError("binding.protocol must be 'bnd'");
  if (top.version !== PROTOCOL_VERSION) throw new BindingError("binding.version must be 1");

  const nostr = expectObject(top.nostr, "binding.nostr", ["publicKey"]);
  if (!isValidXOnlyKey(nostr.publicKey as string)) {
    throw new BindingError("binding.nostr.publicKey must be a valid x-only key in lowercase hex");
  }

  const bch = expectObject(top.bch, "binding.bch", ["network", "keyHash"]);
  if (!isBchNetwork(bch.network)) {
    throw new BindingError("binding.bch.network must be mainnet or chipnet");
  }
  if (!isHex(bch.keyHash, 20)) {
    throw new BindingError("binding.bch.keyHash must be 20 bytes of lowercase hex");
  }

  if (!Number.isSafeInteger(top.createdAt) || (top.createdAt as number) <= 0) {
    throw new BindingError("binding.createdAt must be a positive integer");
  }
  if (top.previous !== undefined && !isHex(top.previous, 32)) {
    throw new BindingError("binding.previous must be 32 bytes of lowercase hex");
  }

  let recovery: { publicKey: string } | undefined;
  if (top.recovery !== undefined) {
    const value = expectObject(top.recovery, "binding.recovery", ["publicKey"]);
    if (!isValidXOnlyKey(value.publicKey as string)) {
      throw new BindingError(
        "binding.recovery.publicKey must be a valid x-only key in lowercase hex",
      );
    }
    recovery = { publicKey: value.publicKey as string };
    // One key must not count as two of the three approvals (section 9).
    if (recovery.publicKey === nostr.publicKey) {
      throw new BindingError("the recovery key must differ from the Nostr key");
    }
    const keyHash = bch.keyHash as string;
    for (const prefix of ["02", "03"]) {
      if (
        bytesToHex(keyHashFromPublicKey(hexToBytes(`${prefix}${recovery.publicKey}`))) === keyHash
      ) {
        throw new BindingError("the recovery key must differ from the BCH key");
      }
    }
  }
  if (top.revoked !== undefined) {
    if (top.revoked !== true) throw new BindingError("binding.revoked must be true when present");
    if (top.previous === undefined) {
      throw new BindingError("binding.revoked needs binding.previous: it revokes that binding");
    }
    if (recovery !== undefined) {
      throw new BindingError("a revocation cannot name a recovery key");
    }
  }

  return {
    protocol: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    nostr: { publicKey: nostr.publicKey as string },
    bch: { network: bch.network, keyHash: bch.keyHash as string },
    createdAt: top.createdAt as number,
    ...(top.previous === undefined ? {} : { previous: top.previous as string }),
    ...(recovery === undefined ? {} : { recovery }),
    ...(top.revoked === undefined ? {} : { revoked: true as const }),
  };
}

/** Canonical bytes of a validated binding record. */
export function bindingBytes(record: BindingRecord): Uint8Array {
  return canonicalBytes(parseBinding(record));
}

/** Binding ID: lowercase hex SHA-256 over a domain tag and the canonical record. */
export function bindingId(record: BindingRecord): string {
  const body = bindingBytes(record);
  const input = new Uint8Array(BINDING_ID_DOMAIN.length + body.length);
  input.set(BINDING_ID_DOMAIN);
  input.set(body, BINDING_ID_DOMAIN.length);
  return bytesToHex(sha256(input));
}

/** The CashAddr for the bound key, in the plain `q…` form. */
export function bindingAddress(record: BindingRecord): string {
  const parsed = parseBinding(record);
  return encodeBchAddress(hexToBytes(parsed.bch.keyHash), parsed.bch.network);
}

/** True when `address` is a P2PKH address for exactly the bound key and network. */
export function bindingMatchesAddress(record: BindingRecord, address: string): boolean {
  const parsed = parseBinding(record);
  try {
    const decoded = decodeBchAddress(address);
    const expectedPrefix = parsed.bch.network === "mainnet" ? "bitcoincash" : "bchtest";
    return (
      decoded.prefix === expectedPrefix &&
      bytesEqual(decoded.keyHash, hexToBytes(parsed.bch.keyHash))
    );
  } catch {
    return false;
  }
}
