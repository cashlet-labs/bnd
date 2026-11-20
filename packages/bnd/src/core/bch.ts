import { decodeCashAddress, encodeCashAddress } from "@bitauth/libauth";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Networks BND version 1 supports. Other test networks may be added in a later version. */
export const BCH_NETWORKS = ["mainnet", "chipnet"] as const;
export type BchNetwork = (typeof BCH_NETWORKS)[number];

export function isBchNetwork(value: unknown): value is BchNetwork {
  return typeof value === "string" && (BCH_NETWORKS as readonly string[]).includes(value);
}

/**
 * CAIP-2 chain ID of each network, in the `bip122` namespace: `bip122:` and the
 * first 32 hex characters of a block hash that exists on that chain only.
 *
 * Mainnet uses block 478559, the first Bitcoin Cash block, as listed by the
 * CAIP-2 `bip122` namespace. Chipnet shares its first blocks with testnet4, so
 * its ID uses chipnet block 335882 (hash 000000000000e0b99c152c6119f94eae2faa0891
 * e0f54eeb055c4474e1e6e023), checked on two chipnet servers. A chipnet reset
 * changes this value.
 */
export const CHAIN_IDS: Readonly<Record<BchNetwork, string>> = {
  mainnet: "bip122:000000000000000000651ef99cb9fcbe",
  chipnet: "bip122:000000000000e0b99c152c6119f94eae",
};

/** CashAddr prefix for a network. Chipnet uses `bchtest`, like every BCH test network. */
export function addressPrefix(network: BchNetwork): "bitcoincash" | "bchtest" {
  return network === "mainnet" ? "bitcoincash" : "bchtest";
}

/** HASH160 (RIPEMD-160 of SHA-256) of a compressed secp256k1 public key. */
export function keyHashFromPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
    throw new TypeError("expected a 33-byte compressed public key");
  }
  return ripemd160(sha256(publicKey));
}

/**
 * Encode a P2PKH CashAddr. The default is the plain `q…` form. Pass
 * `tokenAware: true` for the `z…` form, which names the same key hash.
 */
export function encodeBchAddress(
  keyHash: Uint8Array,
  network: BchNetwork,
  options: { tokenAware?: boolean } = {},
): string {
  if (keyHash.length !== 20) throw new TypeError("expected a 20-byte key hash");
  const encoded = encodeCashAddress({
    prefix: addressPrefix(network),
    type: options.tokenAware ? "p2pkhWithTokens" : "p2pkh",
    payload: keyHash,
  });
  if (typeof encoded === "string") throw new Error(encoded);
  return encoded.address;
}

export interface DecodedBchAddress {
  prefix: "bitcoincash" | "bchtest";
  keyHash: Uint8Array;
  tokenAware: boolean;
}

/**
 * Decode a prefixed, lowercase P2PKH CashAddr. P2SH addresses, other
 * prefixes, prefix-less and mixed-case input are rejected. The `bchtest` prefix
 * is shared by every BCH test network, so callers must compare the network separately.
 */
export function decodeBchAddress(address: string): DecodedBchAddress {
  if (typeof address !== "string" || address !== address.toLowerCase() || !address.includes(":")) {
    throw new TypeError("expected a lowercase CashAddr with a prefix");
  }
  const decoded = decodeCashAddress(address);
  if (typeof decoded === "string") throw new TypeError(`invalid CashAddr: ${decoded}`);
  if (decoded.prefix !== "bitcoincash" && decoded.prefix !== "bchtest") {
    throw new TypeError(`unsupported CashAddr prefix: ${decoded.prefix}`);
  }
  if (decoded.type !== "p2pkh" && decoded.type !== "p2pkhWithTokens") {
    throw new TypeError(`only P2PKH addresses are supported, received ${decoded.type}`);
  }
  if (decoded.payload.length !== 20) throw new TypeError("expected a 20-byte key hash");
  return {
    prefix: decoded.prefix,
    keyHash: decoded.payload,
    tokenAware: decoded.type === "p2pkhWithTokens",
  };
}
