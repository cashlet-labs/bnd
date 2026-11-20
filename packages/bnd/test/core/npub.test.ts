import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { npubDecode, npubEncode } from "../../src/core/npub.js";
import { deriveNostrKey } from "../../src/core/keys.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const key = deriveNostrKey(MNEMONIC);

describe("npub", () => {
  it("matches the NIP-19 test vector", () => {
    const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    const npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    expect(npubEncode(hex)).toBe(npub);
    expect(npubDecode(npub)).toBe(hex);
  });

  it("agrees with nostr-tools", () => {
    expect(npubEncode(key.publicKey)).toBe(nip19.npubEncode(key.publicKey));
    expect(npubDecode(nip19.npubEncode(key.publicKey))).toBe(key.publicKey);
  });

  it("rejects a bad checksum, prefix, case and length", () => {
    const npub = npubEncode(key.publicKey);
    expect(() => npubDecode(npub.slice(0, -1) + (npub.endsWith("q") ? "p" : "q"))).toThrow();
    expect(() => npubDecode(nip19.nsecEncode(key.privateKey))).toThrow(/not an npub/);
    expect(() => npubDecode(npub.toUpperCase())).not.toThrow();
    expect(() => npubDecode(npub.slice(0, 20).toUpperCase() + npub.slice(20))).toThrow();
    expect(() => npubDecode(nip19.noteEncode("ab".repeat(32)))).toThrow(/not an npub/);
    expect(() => npubDecode("")).toThrow();
    expect(() => npubDecode(undefined as unknown as string)).toThrow(TypeError);
  });

  it("rejects an invalid key when encoding", () => {
    expect(() => npubEncode("AB".repeat(32))).toThrow(TypeError);
    expect(() => npubEncode("ab".repeat(31))).toThrow(TypeError);
  });
});
