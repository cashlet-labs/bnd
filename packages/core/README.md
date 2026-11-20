# @cashlet-labs/bnd-core

The core of BND (BND-1): bind a Bitcoin Cash key to a Nostr key so anyone can
check that one person controls both. This package builds and verifies binding
records, BCH proofs, binding events, successors and revocations, and the
challenge-response login. It does no network I/O.

```bash
npm install @cashlet-labs/bnd-core
```

Node.js 22 or later, or a modern browser. ES modules only.

## Create a binding

```ts
import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  deriveBchKey,
  deriveNostrKey,
} from "@cashlet-labs/bnd-core";

const nostr = deriveNostrKey(mnemonic); // NIP-06 path
const bch = deriveBchKey(mnemonic); // BIP44 path, coin 145
const binding = await createBinding({
  nostrSigner: createNostrKeySigner(nostr.privateKey),
  bchSigner: createKeySigner(bch.privateKey),
  bchKeyHash: bch.keyHash,
  network: "chipnet",
  proofType: "message", // or "tx"
});
binding.event; // a signed kind 30078 event, ready to publish
```

`nostrSigner` can be any NIP-07 or NIP-46 signer, and `bchSigner` any wallet
connection that implements `signMessage`, `signTransaction` or both.

## Verify a binding

```ts
import { verifyBinding } from "@cashlet-labs/bnd-core";

const result = verifyBinding(event);
if (result.ok) {
  result.nostrPublicKey; // hex
  result.bch.address; // CashAddr
  result.proofType; // "message" or "tx"
} else {
  result.reason;
}
```

## Also included

- `createSuccessor` and `createRevocation`: change or revoke a binding with two
  of three keys.
- `resolveIdentity`: decide whether an identity is current, revoked or disputed
  from a set of events.
- `issueChallenge`, `createLoginResponse` and `verifyLogin`: log in with BND.

To publish and discover bindings on relays, use
[`@cashlet-labs/bnd-nostr`](https://www.npmjs.com/package/@cashlet-labs/bnd-nostr).
For DIDs and payments, use
[`@cashlet-labs/bnd-did`](https://www.npmjs.com/package/@cashlet-labs/bnd-did).

## Documentation

- [Specification (BND-1)](https://github.com/cashlet-labs/bnd/blob/main/spec/BND-1.md)
- [Integration guide](https://github.com/cashlet-labs/bnd/blob/main/docs/integration.md)
- [Threat model](https://github.com/cashlet-labs/bnd/blob/main/docs/threat-model.md)
- [Demo](https://bnd-core.septemlabs.com)

The protocol is a draft and may change before version 1.

## Licence

MIT
