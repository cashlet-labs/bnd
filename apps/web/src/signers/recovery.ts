import {
  createNostrKeySigner,
  npubDecode,
  npubEncode,
  type NostrSigner,
} from "@cashlet-labs/bnd-core";
import { decode, nsecEncode } from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

/**
 * A recovery key (BND-1 section 9.4): an extra key, meant to be kept offline,
 * that can stand in for a lost or stolen key when the binding is replaced.
 *
 * Unlike the other demo keys it is a backup, so the page shows a key it
 * creates once, for the user to save. It also accepts the secret pasted back
 * to recover, which is the one place this page takes a secret key. Either way
 * the secret stays in this tab's memory and is never sent anywhere.
 */
export interface RecoveryKey {
  publicKey: string;
  npub: string;
  /** Present when the page holds the secret: it can approve a recovery. */
  signer?: NostrSigner;
}

/** A key created by the page, with its secret as `nsec` for the user to save. */
export interface CreatedRecoveryKey extends Required<RecoveryKey> {
  nsec: string;
}

export function createRecoveryKey(): CreatedRecoveryKey {
  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  return {
    publicKey,
    npub: npubEncode(publicKey),
    signer: createNostrKeySigner(privateKey),
    nsec: nsecEncode(privateKey),
  };
}

/** A recovery key kept elsewhere: only its public key, given as `npub`. */
export function recoveryKeyFromNpub(input: string): RecoveryKey {
  const value = input.trim();
  if (!value.startsWith("npub1")) throw new Error("enter the recovery key's npub");
  const publicKey = npubDecode(value);
  return { publicKey, npub: npubEncode(publicKey) };
}

/** The recovery key's secret, pasted back as `nsec` to approve a recovery. */
export function recoveryKeyFromNsec(input: string): Required<RecoveryKey> {
  const value = input.trim();
  let decoded: ReturnType<typeof decode>;
  try {
    decoded = decode(value);
  } catch {
    throw new Error("enter the recovery key's nsec");
  }
  if (decoded.type !== "nsec") throw new Error("enter the recovery key's nsec");
  const publicKey = getPublicKey(decoded.data);
  return {
    publicKey,
    npub: npubEncode(publicKey),
    signer: createNostrKeySigner(decoded.data),
  };
}
