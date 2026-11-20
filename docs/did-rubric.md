# did:bnd: an evaluation against the W3C DID Method Rubric

Evaluator: Septem Labs (<hello@septemlabs.com>), authors of the method, so this
is a self-assessment and carries that bias.
Date: 2026-11-20.
Method version: [did:bnd 0.1](../spec/did-bnd.md), reference implementation
`@cashlet-labs/bnd-did` 0.4.0.
Rubric: [W3C DID Method Rubric](https://www.w3.org/TR/did-rubric/). The Rubric
asks evaluators to frame a use and answer only the criteria that matter for it;
criteria are named as in its section 3. Answers are in plain words rather than
the Rubric's response letters.

## Use under evaluation

A person holds a Bitcoin Cash wallet and a Nostr identity and wants one
identifier that independent applications can resolve and authenticate, that
links both keys, and that survives losing or rotating either key. Networks
evaluated: BCH mainnet and chipnet (the identifier names one; both behave the
same).

## Design

| Criterion                                | Assessment                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Permissioned operation                   | None. Anyone with keys can create, update and deactivate; no account, approval or allow-list.                                                                                                                                  |
| Interoperability                         | Builds on Nostr (NIP-01, 09, 65, 78), Bitcoin Signed Message and BCH transactions, CAIP-2/10/122, NIP-98, DID Core and Controlled Identifiers (Multikey). Links to `did:nostr` with `alsoKnownAs` and reuses its key encoding. |
| Scope of usage                           | General purpose: authentication, assertions, payments to the bound address.                                                                                                                                                    |
| Cryptocurrency                           | Not required. No fees, no tokens, no on-chain writes; BCH keys sign proofs that are never broadcast.                                                                                                                           |
| Offline creation                         | Yes. The binding is created and signed offline; the DID is known before anything is published. Publishing needs a relay.                                                                                                       |
| Update scalability                       | One Nostr event per update; relays store one event per key.                                                                                                                                                                    |
| Creation cost                            | Zero.                                                                                                                                                                                                                          |
| Update and deletion cost (out of pocket) | Zero.                                                                                                                                                                                                                          |
| Update and deletion cost (in kind)       | Two of the three keys must sign.                                                                                                                                                                                               |

## Operation

| Criterion                     | Assessment                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Limited resource resolution   | Light: a few relay queries and local signature checks; no blockchain node or indexer. Resolution from events already held needs no network.                                                              |
| Limited resource registration | Light: signing in a browser or wallet and one publish.                                                                                                                                                   |
| Update latency                | Seconds: as fast as relays accept an event.                                                                                                                                                              |
| Operational reliability       | Depends on relays answering; resolvers ask several and fail rather than answer from too few (default minimum 2).                                                                                         |
| Operational security          | Every event is verified by the resolver; relays are untrusted. Relays that enforce succession refuse a stored binding's replacement unless it is approved by two keys, and refuse deletions of bindings. |

## Enforcement

| Criterion                  | Assessment                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auditability               | Full. A binding carries its whole signed history; anyone can re-verify every step and see which keys approved it.                                              |
| Registry consensus         | None in the blockchain sense. Nostr relays do not agree with each other; resolvers verify each event and treat two branches as a conflict instead of choosing. |
| Operational diversity      | Any Nostr relay can hold bindings; the reference deployment uses its own two relays and five public ones.                                                      |
| Verification relationships | authentication (Nostr key, BCH key), assertionMethod (Nostr key), capabilityInvocation (all three keys; any two together).                                     |
| Authentication model       | Challenge-response with both keys or the Nostr key alone, CAIP-122 statement plus NIP-98 event (BND-1 section 8).                                              |

## Adoption

| Criterion               | Assessment                                                                        |
| ----------------------- | --------------------------------------------------------------------------------- |
| Release status          | Draft. Open-source reference implementation, a public resolver and a hosted demo. |
| Maturity                | New (2026). Not yet reviewed outside its authors.                                 |
| Financial entanglements | None. No token or fee.                                                            |

## Security

| Criterion                               | Assessment                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Robust crypto                           | secp256k1 only: BIP-340 Schnorr (Nostr), ECDSA and Schnorr (BCH). SHA-256 for binding IDs.      |
| Availability                            | As available as the relays chosen; data can be republished to any relay by anyone who holds it. |
| Many eyes                               | Public specification, test vectors and code; no external review yet.                            |
| Diffuse control                         | Two of three keys, each held by the user; no party can act for them.                            |
| Expert review (cryptography, consensus) | Not yet.                                                                                        |

## Privacy

| Criterion                         | Assessment                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Per-DID constraints on visibility | None: everything, including history, is public.                                                            |
| Incentives for multicontext DIDs  | Creating more identities is free, so separating contexts costs nothing; one identity correlates by design. |

## Known limits

- Relays can withhold the newest binding; a resolver that only reaches such
  relays returns an older binding of the same chain.
- Two stolen keys of three are enough to take over.
- `conflict` is not a standard DID Resolution error code.
