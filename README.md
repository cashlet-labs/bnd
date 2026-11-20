# bnd-core

BND (BCH–Nostr DID) cryptographically binds a Bitcoin Cash address to a Nostr
public key. The two keys stay separate and neither private key is ever shared.
Anyone can discover the binding on Nostr relays and verify it without a
central identity provider.

Status: work in progress. The protocol specification is in
[`spec/BND-1.md`](spec/BND-1.md), with test vectors in `spec/vectors/`. Bindings can be
replaced (rotating either key), recovered with an optional recovery key, and
revoked; each change needs two of the three keys (section 9).

Each identity also has a DID, `did:bnd:<network>:<nostr key>:<binding id>`,
which stays the same when keys rotate ([`spec/did-bnd.md`](spec/did-bnd.md),
library `@cashlet-labs/bnd-did`). The hosted demo resolves them at
`https://bnd-core.septemlabs.com/did/<did>`. The verify page turns an npub or a DID into a payment
request for the identity's current address, in BCH or CashTokens.

## Try it

```bash
npm install
npm run demo
```

Then open <http://127.0.0.1:4173>. For development with hot reload, run
`npm run dev` and open <http://127.0.0.1:5173>. See [docs/demo.md](docs/demo.md) for the
walk-through, and [docs/wallet-connections.md](docs/wallet-connections.md) for
how wallets connect. [docs/deploy.md](docs/deploy.md) covers hosting the demo
with Docker.

## License

MIT
