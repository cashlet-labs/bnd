# Documentation

BND is a protocol. The specification is the product; the packages are its
reference implementation, and the demo page, verifier and relay are examples of
using it.

## Specification

| Document                          | Contents                                                           |
| --------------------------------- | ------------------------------------------------------------------ |
| [BND-1](../spec/BND-1.md)         | The protocol: records, proofs, events, discovery, login, rotation. |
| [did:bnd](../spec/did-bnd.md)     | The DID method built on BND-1.                                     |
| [NIP draft](../spec/nip-draft.md) | BND written up as a NIP for Nostr developers.                      |
| [Test vectors](../spec/vectors/)  | Inputs and expected results for every part of the spec.            |
| [JSON schema](../spec/schemas/)   | The `did:bnd` DID document.                                        |

## Guides

| Document                                   | For                                                           |
| ------------------------------------------ | ------------------------------------------------------------- |
| [Architecture](architecture.md)            | How BND works, with diagrams and a verification walk-through. |
| [Integration](integration.md)              | Adding BND to a wallet, a Nostr client or an application.     |
| [Threat model](threat-model.md)            | What BND defends against, and what it does not.               |
| [did:bnd Rubric evaluation](did-rubric.md) | `did:bnd` against the W3C DID Method Rubric.                  |

## Reference implementation and examples

| Path             | What it is                                                                     | Docs                                              |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `packages/core`  | `@cashlet-labs/bnd-core`: records, proofs, events, succession, login. No I/O.  | [README](../packages/core/README.md)              |
| `packages/nostr` | `@cashlet-labs/bnd-nostr`: publish, discover, check a binding is current.      | [README](../packages/nostr/README.md)             |
| `packages/did`   | `@cashlet-labs/bnd-did`: `did:bnd` resolution, pay by identity, `bnd-resolve`. | [README](../packages/did/README.md)               |
| `apps/web`       | Example: the demo page.                                                        | [Demo](demo.md), [wallets](wallet-connections.md) |
| `apps/verifier`  | Example: a login service and public DID resolver.                              | [Demo](demo.md#configuration)                     |
| `apps/dev-relay` | Example: an in-memory relay that enforces succession.                          | [Demo](demo.md)                                   |
| `deploy/`        | Hosting the examples with Docker.                                              | [Deploy](deploy.md)                               |

## Standards reused

Nostr NIP-01, 06, 07, 09, 19, 21, 46, 65, 78 and 98; Bitcoin Signed Message;
BIP-340, BIP39, BIP44 and BIP21; CashAddr and CashTokens token-aware addresses;
RFC 8785 (JSON canonicalization); CAIP-2, CAIP-10 and CAIP-122; W3C DID Core,
DID Resolution and Controlled Identifiers (Multikey).

## Project

[Changelog](../CHANGELOG.md) · [Contributing](../CONTRIBUTING.md) ·
[Security](../SECURITY.md) · [Specification licence](../spec/LICENSE.md)
