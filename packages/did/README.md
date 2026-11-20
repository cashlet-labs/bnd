# @cashlet-labs/bnd-did

The `did:bnd` DID method: identifiers for BND identities that stay the same
when keys rotate, plus paying an identity at its current verified address.

```text
did:bnd:<network>:<root Nostr key>:<root binding ID>
```

```bash
npm install @cashlet-labs/bnd-did @cashlet-labs/bnd-core @cashlet-labs/bnd-nostr
```

Node.js 22 or later, or a modern browser.

## Resolve a DID

```ts
import { resolveDid } from "@cashlet-labs/bnd-did";

const result = await resolveDid("did:bnd:chipnet:<key>:<id>", { relays, minComplete: 2 });
if ("error" in result.didResolutionMetadata) {
  result.didResolutionMetadata.error; // invalidDid, notFound, conflict or internalError
} else {
  result.didDocument;
  result.didDocumentMetadata.deactivated;
}
```

`resolveDidFromEvents(did, events)` resolves from events you already hold,
with no network. `didOf(binding)` and `didDocument(binding)` build the DID and
its document from a verified binding.

## Pay an identity

```ts
import { paymentUri, resolvePayee } from "@cashlet-labs/bnd-did";

const payee = await resolvePayee("npub1…", { relays }); // or a hex key or a did:bnd
if (payee.ok) {
  paymentUri(payee.address, { amount: "0.01" }); // bitcoincash:q…?amount=0.01
  payee.tokenAddress; // token-aware z… address, for CashTokens
}
```

`resolvePayee` refuses revoked or disputed identities, and answers from too few
relays.

## Command line

```bash
npx -p @cashlet-labs/bnd-did bnd-resolve did:bnd:chipnet:<key>:<id> --relay wss://relay.septemlabs.com
```

Prints the DID Resolution Result as JSON and exits 1 when resolution fails. A
public HTTP resolver runs at `https://bnd.septemlabs.com/did/<did>`.

## Documentation

- [did:bnd method specification](https://github.com/cashlet-labs/bnd/blob/main/spec/did-bnd.md)
- [BND-1 specification](https://github.com/cashlet-labs/bnd/blob/main/spec/BND-1.md)
- [Integration guide](https://github.com/cashlet-labs/bnd/blob/main/docs/integration.md)

## Licence

MIT
