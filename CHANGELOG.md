# Changelog

Releases of this repository. Package versions are listed with each release.
The protocol is a draft; each release names the draft it implements.

## 0.4.0 (2026-11-20)

Packages: `@cashlet-labs/bnd-core`, `@cashlet-labs/bnd-nostr` and
`@cashlet-labs/bnd-did`, all 0.4.0, first published to npm. Draft: BND-1 with
section 9, did:bnd 0.1. No protocol change.

- The packages are published on npm, each with a README and the licence, and
  ship their TypeScript sources so source maps work. They depend on each other
  at `^0.4.0`.
- Documentation: architecture primer, integration guide, threat model, NIP
  draft, documentation index, security policy and contribution guide.
- The specification text is licensed under CC BY 4.0; code stays MIT.

## 0.3.0 (2026-11-20)

Packages: `@cashlet-labs/bnd-did` 0.3.0 (new); `bnd-core` and `bnd-nostr` 0.2.0.

- The `did:bnd` DID method: `did:bnd:<network>:<root Nostr key>:<root binding ID>`,
  stable across key rotations, with DID documents, resolution from relays or
  from events held locally, and the `bnd-resolve` command
  ([spec/did-bnd.md](spec/did-bnd.md), vectors, JSON schema, Rubric evaluation).
- The verifier serves a public resolver at `/did/<did>`, open to any origin and
  rate-limited.
- Pay by identity: `resolvePayee` turns an npub, key or DID into the current
  verified address, and `paymentUri` builds a BIP21 request; the token-aware
  address is given for CashTokens.
- The demo shows each identity's DID and has a "Pay this identity" panel.
- The demo shows a binding's chain, rotates, recovers and revokes, and plays a
  takeover attempt that three defences refuse.
- The local relay enforces succession like the hosted relays.

## 0.2.0 (2026-11-19)

Packages: `bnd-core` 0.2.0, `bnd-nostr` 0.2.0. Draft: BND-1 with section 9.

- Key rotation, recovery and revocation: successors approved by two of three
  keys (Nostr, BCH, optional recovery key), a signed history of up to 32 steps,
  and the `s` tag for finding successors.
- Identity resolution reports current, revoked, disputed or none.
- The verifier pins the binding each Nostr key last logged in with.
- Containers and scripts for hosting the demo; configurable site relays; the
  verifier trusts a proxy's client-address header and hashes addresses.

## 0.1.0 (2026-11-19)

Packages: `bnd-core` 0.1.0, `bnd-nostr` 0.1.0. Draft: BND-1 sections 1 to 8.

- Binding records, binding IDs and RFC 8785 canonical JSON.
- BCH proofs: Bitcoin Signed Message, and a virtual-output transaction with
  hash type `0x61`, both checked against proofs from real wallets.
- Binding events (kind `30078`, `d` = `bnd1`, `b` tag), publishing and
  discovery by Nostr key or BCH key hash.
- Challenge-response login at the `nostr` and `dual` levels, with the
  current-binding check on relays and NIP-65 relay lists.
- The demo page, a demonstration verifier and a local relay.
