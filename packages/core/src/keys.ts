import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bytesToHex } from "./bytes.js";
import { keyHashFromPublicKey } from "./bch.js";

/** NIP-06 path for Nostr keys. */
export const NOSTR_PATH_PREFIX = "m/44'/1237'";
/** BIP44 path for Bitcoin Cash keys (coin type 145). */
export const BCH_PATH_PREFIX = "m/44'/145'";

export interface NostrKey {
  /** 32-byte secret key. */
  privateKey: Uint8Array;
  /** 32-byte x-only public key as lowercase hex. */
  publicKey: string;
  path: string;
}

export interface BchKey {
  /** 32-byte secret key. */
  privateKey: Uint8Array;
  /** 33-byte compressed public key. */
  publicKey: Uint8Array;
  /** HASH160 of the compressed public key. */
  keyHash: Uint8Array;
  path: string;
}

function assertAccount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= 0x80000000) {
    throw new RangeError(`${name} must be an integer in [0, 2^31)`);
  }
}

function seedFromMnemonic(mnemonic: string): Uint8Array {
  const normalized = mnemonic.trim().split(/\s+/).join(" ");
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("invalid BIP39 mnemonic");
  }
  return mnemonicToSeedSync(normalized);
}

function derive(seed: Uint8Array, path: string): Uint8Array {
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.privateKey) throw new Error("key derivation failed");
  return child.privateKey;
}

/** Derive a Nostr key from a BIP39 mnemonic with NIP-06: m/44'/1237'/<account>'/0/0. */
export function deriveNostrKey(mnemonic: string, account = 0): NostrKey {
  assertAccount(account, "account");
  const path = `${NOSTR_PATH_PREFIX}/${account}'/0/0`;
  const privateKey = derive(seedFromMnemonic(mnemonic), path);
  return { privateKey, publicKey: bytesToHex(schnorr.getPublicKey(privateKey)), path };
}

/** Derive a BCH key from a BIP39 mnemonic with BIP44: m/44'/145'/<account>'/0/<index>. */
export function deriveBchKey(mnemonic: string, account = 0, index = 0): BchKey {
  assertAccount(account, "account");
  assertAccount(index, "index");
  const path = `${BCH_PATH_PREFIX}/${account}'/0/${index}`;
  const privateKey = derive(seedFromMnemonic(mnemonic), path);
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return { privateKey, publicKey, keyHash: keyHashFromPublicKey(publicKey), path };
}
