# @cashlet-labs/bnd

The reference implementation of BND: bind a Bitcoin Cash key to a Nostr key so
anyone can check that one person controls both. It builds and verifies
bindings, finds them on Nostr relays, logs users in, rotates and recovers keys,
resolves `did:bnd` DIDs and pays an identity at its current, verified address.

```bash
npm install @cashlet-labs/bnd
```

Node.js 22 or later, or a modern browser. ES modules only.

| Import                      | What it has                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| `@cashlet-labs/bnd`         | Records, proofs, binding events, rotation, revocation, login. No I/O. |
| `@cashlet-labs/bnd/nostr`   | Publish to and discover from relays; check a binding is current.      |
| `@cashlet-labs/bnd/did`     | `did:bnd` documents and resolution, pay by identity.                  |
| `@cashlet-labs/bnd/testing` | An in-memory relay for tests.                                         |

Import only what you use: the core never loads relay or DID code, so a wallet
that only verifies bundles only the core.

## Create a binding

```ts
import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  deriveBchKey,
  deriveNostrKey,
} from "@cashlet-labs/bnd";

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
import { verifyBinding } from "@cashlet-labs/bnd";

const result = verifyBinding(event); // one event, no network
if (result.ok) {
  result.nostrPublicKey; // hex
  result.bch.address; // CashAddr
  result.proofType; // "message" or "tx"
} else {
  result.reason;
}
```

`createSuccessor` and `createRevocation` change or revoke a binding with two of
three keys. `resolveIdentity` decides whether an identity is current, revoked or
disputed. `issueChallenge`, `createLoginResponse` and `verifyLogin` log a user
in.

## Publish and discover

```ts
import { discoverBinding, publishBinding } from "@cashlet-labs/bnd/nostr";

await publishBinding(binding.event, { relays }); // refuses an invalid binding

const found = await discoverBinding("npub1…", { relays });
found.state.status; // "current", "revoked", "disputed" or "none"
found.binding?.bch.address; // only when current
```

Discovery asks every relay, verifies every event and follows successors, so it
finds a binding that moved to a new Nostr key. `discoverByBchKeyHash` goes the
other way, from an address to the identities that claim it.

Before accepting a login, check the binding is still current:

```ts
import { checkCurrentBinding } from "@cashlet-labs/bnd/nostr";

const check = await checkCurrentBinding(verifiedBinding, { relays, minComplete: 2 });
if (!check.ok) refuse(check.reason);
```

On a server, pass `allowUserRelay` to refuse user relays that resolve to
private addresses.

## Resolve a DID and pay an identity

```ts
import { paymentUri, resolveDid, resolvePayee } from "@cashlet-labs/bnd/did";

const result = await resolveDid("did:bnd:chipnet:<key>:<id>", { relays, minComplete: 2 });
if (!("error" in result.didResolutionMetadata)) result.didDocument;

const payee = await resolvePayee("npub1…", { relays }); // or a hex key or a did:bnd
if (payee.ok) {
  paymentUri(payee.address, { amount: "0.01" }); // bitcoincash:q…?amount=0.01
  payee.tokenAddress; // token-aware z… address, for CashTokens
}
```

`resolvePayee` refuses revoked or disputed identities, and answers from too few
relays, so a payment never goes to a stale or contested address.

## Command line

```bash
npx -p @cashlet-labs/bnd bnd-resolve did:bnd:chipnet:<key>:<id> --relay wss://relay.septemlabs.com
```

Prints the DID Resolution Result as JSON and exits 1 when resolution fails. A
public HTTP resolver runs at `https://bnd.septemlabs.com/did/<did>`.

## Documentation

- [Specification (BND-1)](https://github.com/cashlet-labs/bnd/blob/main/spec/BND-1.md)
- [did:bnd method](https://github.com/cashlet-labs/bnd/blob/main/spec/did-bnd.md)
- [Integration guide](https://github.com/cashlet-labs/bnd/blob/main/docs/integration.md)
- [Threat model](https://github.com/cashlet-labs/bnd/blob/main/docs/threat-model.md)
- [Demo](https://bnd.septemlabs.com)

The protocol is a draft and may change before version 1.

## Licence

MIT
