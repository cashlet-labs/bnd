# @cashlet-labs/bnd-nostr

Publish and discover BND bindings on Nostr relays, and check that a binding is
still current. Every event a relay returns is verified with
[`@cashlet-labs/bnd-core`](https://www.npmjs.com/package/@cashlet-labs/bnd-core);
relays are never trusted for validity.

```bash
npm install @cashlet-labs/bnd-nostr @cashlet-labs/bnd-core
```

Node.js 22 or later (it uses the built-in `WebSocket`), or a modern browser.

## Publish

```ts
import { publishBinding } from "@cashlet-labs/bnd-nostr";

const summary = await publishBinding(binding.event, {
  relays: ["wss://relay.septemlabs.com", "wss://nos.lol"],
});
```

`publishBinding` refuses to send a binding that does not verify.

## Discover

```ts
import { discoverBinding, discoverByBchKeyHash } from "@cashlet-labs/bnd-nostr";

const found = await discoverBinding("npub1…", { relays });
found.state.status; // "current", "revoked", "disputed" or "none"
found.binding?.bch.address; // only when current
found.relays; // what each relay answered

const claims = await discoverByBchKeyHash(keyHashHex, { relays });
```

Discovery follows successors (`#s`), so it finds a binding that moved to a new
Nostr key.

## Check a binding before accepting a login

```ts
import { checkCurrentBinding } from "@cashlet-labs/bnd-nostr";

const check = await checkCurrentBinding(verifiedBinding, { relays, minComplete: 2 });
if (!check.ok) refuse(check.reason);
```

It fails when fewer than `minComplete` relays answer completely, or when a
successor, a revocation or a competing binding exists. It also reads the user's
NIP-65 relay list; on a server, pass `allowUserRelay` to refuse hosts that
resolve to private addresses.

`@cashlet-labs/bnd-nostr/testing` exports an in-memory relay for tests.

## Documentation

- [Specification (BND-1), sections 6 and 8.7](https://github.com/cashlet-labs/bnd/blob/main/spec/BND-1.md)
- [Integration guide](https://github.com/cashlet-labs/bnd/blob/main/docs/integration.md)

## Licence

MIT
