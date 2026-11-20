# Integrating BND

This guide is for wallets, Nostr clients and applications that want to use BND
bindings. The rules are in [spec/BND-1.md](../spec/BND-1.md); the examples use
the TypeScript library in this repository.

Install it from npm (Node.js 22 or later, or a modern browser; ES modules only):

```bash
npm install @cashlet-labs/bnd
```

It has three entry points; import only the ones you use:

| Import                    | What it has                                   |
| ------------------------- | --------------------------------------------- |
| `@cashlet-labs/bnd`       | records, proofs, verification, login. No I/O. |
| `@cashlet-labs/bnd/nostr` | publish, discover, the current-binding check  |
| `@cashlet-labs/bnd/did`   | `did:bnd` resolution and pay by identity      |

Any other language can implement the spec and check itself against
`spec/vectors/`.

## Replace an unsigned address with a binding

The usual way to link a Nostr identity to a BCH address is to put the address in
a profile field or a note. Nothing proves the author controls it: a hijacked
profile or a dishonest relay can swap it, and payments go to the wrong place.

| Today                                   | With BND                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| Address typed into a kind `0` profile   | Kind `30078` event, `d` = `bnd1`, signed by both keys     |
| Anyone with the Nostr key can change it | Changing the BCH key needs two of three keys              |
| Clients trust the text                  | Clients verify both signatures before showing the address |
| Lost Nostr key: start over              | Recover with the BCH key and a recovery key               |
| No way to find who claims an address    | `#b` query by BCH key hash; each claim verified           |

A client that shows a "pay" button for a Nostr user should read the address
from a verified, current binding and ignore the unsigned field, or show the two
side by side and mark which one is verified.

## For BCH wallets

A wallet takes part by signing one of the two proofs (section 4). It needs no
BND code to do so if its connection protocol already supports either:

- **Message proof:** sign the exact text with Bitcoin Signed Message, as for
  WalletConnect `bch_signMessage`. The text starts with `bnd/1/bch-proof`.
- **Transaction proof:** sign one input of a transaction that spends a virtual
  output, with hash type `0x61` (`SIGHASH_ALL | FORKID | UTXOS`), as for
  WizardConnect `sign_transaction_request` or WalletConnect
  `bch_signTransaction`. The input refers to no real output, so the
  transaction can never confirm.

Wallet checklist:

- Honour `broadcast: false`. A proof transaction that is broadcast only fails.
- Sign with hash type `0x61` on P2PKH inputs. `0x41` proofs are rejected.
- Do not refuse a transaction because its input is unknown to the wallet,
  when the request supplies the spent output. Show the request's prompt, such
  as `Prove you control this key for BND binding <ID>. Nothing is sent.`
- Use a compressed key and low-S signatures.

A wallet that holds a Nostr key as well (NIP-06 path `m/44'/1237'/0'/0/0`) can
create the whole binding itself:

```ts
import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  deriveBchKey,
  deriveNostrKey,
} from "@cashlet-labs/bnd";
import { publishBinding } from "@cashlet-labs/bnd/nostr";

const nostr = deriveNostrKey(mnemonic);
const bch = deriveBchKey(mnemonic);
const binding = await createBinding({
  nostrSigner: createNostrKeySigner(nostr.privateKey),
  bchSigner: createKeySigner(bch.privateKey),
  bchKeyHash: bch.keyHash,
  network: "mainnet",
  proofType: "message",
});
await publishBinding(binding.event, { relays });
```

Wallets that do not hold the Nostr key implement `BchSigner` (`signMessage`,
`signTransaction` or both) and let the app pass a NIP-07 or NIP-46 signer as
`nostrSigner`. [wallet-connections.md](wallet-connections.md) describes how the
demo does this over WizardConnect.

## For Nostr clients

Find a user's binding and show its address only if it verifies and is current:

```ts
import { discoverBinding } from "@cashlet-labs/bnd/nostr";

const found = await discoverBinding(npub, { relays });
switch (found.state.status) {
  case "current":
    show(found.state.binding.bch.address); // verified, current
    break;
  case "revoked":
  case "disputed":
    warn(found.state.status); // never show a payable address
    break;
  case "none":
    break;
}
```

`discoverBinding` asks every relay, verifies every event, follows successors
(`#s`) and resolves the identity (section 9.6). Check `found.relays` to see how
many relays answered completely; for payments, require at least two.

Without the library, the filters are:

```json
{ "kinds": [30078], "authors": ["<hex key>"], "#d": ["bnd1"] }
{ "kinds": [30078], "#b": ["<20-byte BCH key hash, hex>"] }
{ "kinds": [30078], "#s": ["<binding ID>"] }
```

and every result must be verified as in section 7. A client that writes
bindings should prefer relays that enforce succession (section 9.8).

To go the other way, from a BCH address to Nostr identities, use
`discoverByBchKeyHash`. Its results are claims; treat a key hash claimed by
more than one identity as disputed.

## For applications: log in with BND

An application issues a challenge, the user's page answers it, and the
application verifies the answer and checks that the binding is current.
`apps/verifier` is a complete example; the essential calls are:

```ts
import { issueChallenge, MemoryChallengeStore, verifyLogin } from "@cashlet-labs/bnd";
import { checkCurrentBinding } from "@cashlet-labs/bnd/nostr";

const store = new MemoryChallengeStore();

// GET /challenge
const challenge = await issueChallenge(store, {
  audience: "https://app.example/login",
  level: "dual", // or "nostr"
});

// POST /login, with the JSON body the page sent
const result = await verifyLogin(store, body, {
  isCurrent: async (binding) => {
    const check = await checkCurrentBinding(binding, { relays, minComplete: 2 });
    return check.ok ? { ok: true } : { ok: false, reason: check.reason };
  },
});
if (result.ok) startSession(result.identity, result.level);
```

In the browser:

```ts
import { createLoginResponse } from "@cashlet-labs/bnd";

const response = await createLoginResponse({
  challenge,
  binding: bindingEvent,
  nostrSigner, // NIP-07 window.nostr, NIP-46, or a local key
  bchSigner, // dual only
  proofType: "tx", // dual only: "tx" or "message"
  expectedOrigin: location.origin,
});
await fetch("/login", { method: "POST", body: JSON.stringify(response) });
```

Server notes:

- Use a shared challenge store (for example Redis) when running more than one
  instance; implement `ChallengeStore`.
- Remember the binding each Nostr key last logged in with and refuse a later
  one that does not continue it (pinning, section 9.7). Pass the IDs you have
  pinned as `checkpoints` to skip re-checking their history.
- `checkCurrentBinding` also reads the user's NIP-65 relay list. On a server,
  pass `allowUserRelay` to refuse names that resolve to private addresses, as
  `apps/verifier/src/address-guard.ts` does.
- Record the session level and require `dual` for actions that move value.

## For applications: resolve a DID

```ts
import { resolveDid } from "@cashlet-labs/bnd/did";

const result = await resolveDid("did:bnd:chipnet:<key>:<id>", { relays, minComplete: 2 });
if ("error" in result.didResolutionMetadata) handle(result.didResolutionMetadata.error);
else use(result.didDocument);
```

Or over HTTP, from any origin:

```bash
curl https://bnd.septemlabs.com/did/did:bnd:chipnet:<key>:<id>
```

Or from the command line:

```bash
npx -p @cashlet-labs/bnd bnd-resolve did:bnd:chipnet:<key>:<id> --relay wss://relay.septemlabs.com
```

Results and HTTP status codes are listed in
[spec/did-bnd.md](../spec/did-bnd.md) sections 6 and 7. `resolveDidFromEvents`
resolves from events you already hold, with no network.

## For applications: pay an identity

```ts
import { paymentUri, resolvePayee } from "@cashlet-labs/bnd/did";

const payee = await resolvePayee("npub1…", { relays }); // or a hex key or a did:bnd
if (payee.ok) {
  const uri = paymentUri(payee.address, { amount: "0.01", label: "Invoice 42" });
  // payee.tokenAddress is the token-aware z… form, for CashTokens
}
```

`resolvePayee` refuses when fewer than two relays answer completely or the
identity is revoked or disputed, so a payment never goes to a stale or contested
address.
