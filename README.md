# bnd-core

BND (BCH–Nostr DID) cryptographically binds a Bitcoin Cash address to a Nostr
public key. The two keys stay separate and neither private key is ever shared.
Anyone can discover the binding on Nostr relays and verify it without a
central identity provider.

Status: work in progress. The protocol specification is in
[`spec/BND-1.md`](spec/BND-1.md), with test vectors in `spec/vectors/`.

## Try it

```bash
npm install
npm run demo
```

Then open <http://127.0.0.1:4173>. For development with hot reload, run
`npm run dev` and open <http://127.0.0.1:5173>. See [docs/demo.md](docs/demo.md) for the
walk-through, and [docs/wallet-connections.md](docs/wallet-connections.md) for
how wallets connect.

## License

MIT
