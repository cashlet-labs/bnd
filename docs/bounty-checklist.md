# BLAZE 2026 Decentralized Identity bounty: requirement checklist

Where each requirement is met in release 0.3.0. "Demo" means
<https://bnd-core.septemlabs.com> or `npm run demo`; demo steps are numbered as
in [demo.md](demo.md#walk-through).

## Requirements

| Requirement                                 | Where it is met                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity creation, keys under user control  | Keys stay in the user's wallet and Nostr signer (NIP-07, NIP-46, WizardConnect); `BchSigner` and `NostrSigner` interfaces; NIP-06/BIP44 derivation (BND-1 section 3.2). Demo steps 2 to 4.                                                           |
| Cryptographic binding with proofs from both | BCH proof by message or virtual-output transaction (BND-1 section 4) plus the Nostr event signature (section 5); `createBinding`, `verifyBinding`. Vectors include proofs from real wallets (`spec/vectors/bch-tx-proof-wallets.json`). Demo step 4. |
| Decentralized discovery                     | Ordinary kind `30078` events on any relay; lookup by Nostr key, by BCH key hash and by successor (section 6); `discoverBinding`, `discoverByBchKeyHash`. Two independent relays plus public ones. Demo step 5 and `/verify`.                         |
| Verification and authentication             | Offline verification (section 7); challenge-response login at `dual` and `nostr` levels with a current-binding check on relays (section 8); `verifyLogin`, `checkCurrentBinding`; `apps/verifier`. Demo step 7.                                      |
| Working demo and documentation              | Hosted demo and `npm run demo`; [README](../README.md), [architecture](architecture.md), [integration guide](integration.md), [threat model](threat-model.md), [spec](../spec/BND-1.md), unit and browser tests.                                     |

## Stretch goals

| Goal                                | Status       | Where                                                                                                                                                                                                         |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key rotation and recovery           | Done         | Two-of-three successors, recovery key, revocation, signed history, pinning, relays that enforce succession (BND-1 section 9); `createSuccessor`, `createRevocation`. Demo steps 6 and 8.                      |
| Payments by identity                | Done         | `resolvePayee` and `paymentUri` in `@cashlet-labs/bnd-did`; BIP21 request and token-aware address for CashTokens. Demo: "Pay this identity" on `/verify`.                                                     |
| Interoperability                    | Done         | `did:bnd` method with a public resolver, `alsoKnownAs` `did:nostr`, CAIP-10 accounts ([did-bnd.md](../spec/did-bnd.md), [Rubric evaluation](did-rubric.md)); [NIP draft](../spec/nip-draft.md); test vectors. |
| Credentials, reputation and privacy | Not included | Privacy properties are documented ([did:bnd section 9](../spec/did-bnd.md#9-privacy-considerations)); credentials and selective disclosure are planned.                                                       |
| BCH-backed commitments              | Not included | Planned as on-chain anchoring to settle disputes (BND-1 section 9.6).                                                                                                                                         |

## Checking it yourself

```bash
npm install
npm test            # unit tests and every vector in spec/vectors
npm run test:e2e    # the demo in a browser: bind, verify, rotate, recover, revoke, takeover, login, pay
npm run demo        # then open http://127.0.0.1:4173
```
