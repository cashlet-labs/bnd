# BND: Bitcoin Cash and Nostr identity binding

An open protocol that binds a Bitcoin Cash key to a Nostr key, so anyone can
verify that one person controls both.

[Specification](spec/BND-1.md) · [did:bnd](spec/did-bnd.md) ·
[Live demo](https://bnd.septemlabs.com) · [Documentation](docs/README.md) ·
[npm](https://www.npmjs.com/package/@cashlet-labs/bnd-core)

Each key signs a statement naming the other, and the result is published as an
ordinary Nostr event. Any application can find it on relays and verify it
offline: no identity provider, account, fee or on-chain transaction. On top of
the binding, BND-1 defines login with both keys, key rotation and recovery with
two of three keys, a DID that survives rotation (`did:bnd`), and paying an
identity at its current, verified address.

Status: draft protocol (BND-1, did:bnd 0.1), release 0.4.0.

## Use it

```bash
npm install @cashlet-labs/bnd-core @cashlet-labs/bnd-nostr
```

```ts
import { discoverBinding } from "@cashlet-labs/bnd-nostr";

const found = await discoverBinding("npub1…", { relays: ["wss://relay.septemlabs.com"] });
if (found.state.status === "current") pay(found.state.binding.bch.address); // verified
```

The [integration guide](docs/integration.md) covers wallets, Nostr clients,
login, DIDs and payments. Other languages can implement the spec against the
[test vectors](spec/vectors/).

## See it

The [live demo](https://bnd.septemlabs.com) is an example application:
bind a wallet to a Nostr key, verify it, log in, rotate and recover keys, watch
a takeover fail, resolve the DID and pay the identity. To run it locally:

```bash
npm install && npm run demo   # then open http://127.0.0.1:4173
```

## Learn more

- [How it works](docs/architecture.md), with diagrams
- [Threat model](docs/threat-model.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## Licence

Code under [MIT](LICENSE). Specification text under
[CC BY 4.0](spec/LICENSE.md).
