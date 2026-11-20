# Running the demo

The demo is a web page that walks through the whole protocol: connect a Nostr
identity and a Bitcoin Cash key, bind them, publish the binding to relays,
discover and verify it as an independent application would, and log in to a
demonstration service with it.

The page has three routes:

| Route     | Page                                                                 |
| --------- | -------------------------------------------------------------------- |
| `/`       | What BND is, with links to the demo and the verifier                 |
| `/demo`   | The full walk-through below                                          |
| `/verify` | Look up and verify a binding, as any application would, without keys |

It is a single-page app, so keys held in memory stay while you move between
routes; a reload clears them. The theme follows the system setting and can be
switched in the header; only that choice is stored, under `cashlet-theme`.

## Requirements

- Node.js 22 or later and npm.
- For a real wallet: a BCH wallet that supports WizardConnect, set to chipnet.
  See [wallet-connections.md](wallet-connections.md).

## Start it

```bash
npm install
npm run demo
```

Open <http://127.0.0.1:4173>. `npm run demo` builds the page and starts three
processes on this machine only:

| Process  | Address                 | Role                                                                        |
| -------- | ----------------------- | --------------------------------------------------------------------------- |
| Relay    | `ws://127.0.0.1:7777`   | A local Nostr relay that keeps events in memory                             |
| Verifier | `http://127.0.0.1:8787` | The demonstration login service                                             |
| Web page | `http://127.0.0.1:4173` | The built page; it forwards the verifier's routes, so both share one origin |

If any of these ports is in use, the script says so and stops. It never stops
other programs. Press Ctrl+C to stop the demo; everything it kept in memory is
gone.

## Walk-through

1. **Network.** Chipnet is selected. Mainnet asks you to confirm that real funds
   and a real public identity are at stake.
2. **Nostr identity.** Use a NIP-07 browser extension, a NIP-46 remote signer
   (paste a `bunker://` link, or scan the `nostrconnect://` code with a signer
   app), or create a key that lives only in this page.
3. **Bitcoin Cash key.** Connect a wallet with WizardConnect by scanning the code
   or pasting the `wiz://` link into the wallet, or create a local test key
   (chipnet only). The wallet is asked to sign a proof transaction that spends a
   virtual output and is never broadcast.
4. **Bind and publish.** Both keys sign. Optionally add a recovery key (see
   below). Publish to the site's relays, and to public relays if you turn them
   on. Anything sent to public relays is public and cannot be reliably deleted.
5. **Discover and verify.** Look up an npub or a BCH address. The page asks the
   relays and verifies every event itself. It shows whether the identity is
   current, replaced, revoked or disputed, and its chain of bindings: what each
   step changed and which keys approved it.
6. **Change the identity.** Rotate the BCH key or the Nostr key, recover from a
   lost key with the recovery key, or revoke the identity. Each change needs two
   of the binding's keys; the page says which before asking and shows which did
   after. The new binding becomes the session's binding once a relay accepts it.
7. **Log in.** The verifier issues a one-time challenge; the page signs it with
   both keys or with the Nostr key only. "Try an action that needs both keys"
   shows step-up: a Nostr-only session is refused. After a revocation, login is
   refused.
8. **Try a takeover.** The page plays an attacker who stole the Nostr key and
   nothing else, and shows three independent defences refusing them: the
   protocol (a replacement approved by one key does not verify), the site's
   relays (a fake first binding cannot overwrite the real one) and the verifier
   (the fake binding cannot log in). The fake binding is sent only to the site's
   relays that already hold the real one, so nothing is stored.

### The recovery key

A recovery key is a backup, so unlike the other keys in this page it has to be
seen to be useful: a backup that only ever lived in the tab is gone after a
reload. The bind step offers:

- **Create one in this page.** The page shows the key once as an `nsec`, with a
  copy button and a warning, and the binding cannot be created until you confirm
  you saved it. Afterwards only its public key, and the signer for this tab,
  stay in memory. On mainnet the page suggests the next option instead.
- **Use my own.** Enter the npub of a recovery key you keep elsewhere, such as
  a paper key. The secret never touches the page.

To recover, the page uses the recovery key created in this tab, or asks for its
`nsec`. This is the one place the page accepts a secret key: it is held in
memory, used to sign one approval, and never sent anywhere. Elsewhere the page
still refuses to import keys.

The local relay follows the same rules as the Cashlet relays: a binding must
verify, a key's binding can only be replaced by a successor approved by two of
its keys, and bindings cannot be deleted. `npm run dev:relay -- --no-enforce`
starts it as a plain relay instead.

The demo verifier checks logins against the local relay only. A binding published
only to public relays cannot be used to log in to it.

The verifier also refuses a binding that has been replaced, revoked or disputed
(spec section 9), and remembers the binding each Nostr key last logged in with.
A later login must use that binding or one that continues it, so a thief who
replaces a binding on the relays cannot log in with the replacement. These pins
are kept in memory and forgotten when the verifier restarts.

## Configuration

`npm run demo` reads `.env` in the repository root if it exists (copy
`.env.example`). The demo always points its verifier at its own relay with a
minimum of one answer; `BND_RELAYS` and `BND_MIN_RELAYS` apply when the verifier
is run on its own with `npm run dev:verifier`.

The page's own relays are the local demo relay unless `VITE_RELAYS` names
others (comma-separated); `VITE_RELAYS_LABEL` sets what the page calls them. The
page publishes to and reads from them by default, and offers the secure ones
first to NIP-46 signer apps. Public relays stay opt-in.

## Development server

```bash
npm run dev
```

Open <http://127.0.0.1:5173>. This starts the same relay and verifier, and the
Vite development server instead of the built page. It reloads on changes, skips
the build and does not apply the page's security policy, so check security
changes with `npm run demo`. The ports and the port check are the same, with
5173 in place of 4173. `DEMO_RELAY_PORT` and `PORT` change the relay and verifier
ports for both commands.

To run the parts separately:

```bash
npm run dev:relay
PUBLIC_URL=http://127.0.0.1:5173 BND_RELAYS=ws://127.0.0.1:7777 BND_MIN_RELAYS=1 npm run dev:verifier
npm run dev -w @cashlet-labs/web
```

`PUBLIC_URL` must be the address of the page, because challenges name it as their
audience and the page refuses challenges for other sites.

## Page security

The built page is served with this policy (the hosted demo uses the same
headers; see [deploy.md](deploy.md)):

```text
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:7777 wss:;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

plus `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and
`Cross-Origin-Opener-Policy: same-origin`. The headers are defined once, in
`apps/web/security-headers.ts`. A plain `ws://` site relay, such as the local
demo relay above, is listed in `connect-src`; secure relays are covered by `wss:`.

- `'wasm-unsafe-eval'` lets the page compile WebAssembly. `@bitauth/libauth`
  needs it: its secp256k1 and hash functions are C code compiled to WebAssembly,
  and they load when the library is imported. The page uses libauth to read
  CashAddresses and to check transaction proofs, including running them through
  libauth's BCH script engine as a node would. The keyword allows only
  WebAssembly; JavaScript `eval`, `new Function` and string timers stay blocked.
  Using it requires running script on the page, which `script-src 'self'` already
  limits to the page's own files, and WebAssembly runs in the same sandbox as
  JavaScript with no extra access. Avoiding it would mean replacing libauth's
  script engine with our own proof check, a larger risk than the keyword.
- `font-src 'self'` allows the page's own fonts (DM Sans and Space Grotesk, under
  the SIL Open Font License; see `apps/web/src/assets/fonts/`).
- `wss:` allows secure WebSocket connections to any host, because users choose
  their own Nostr and NIP-46 relays, and WizardConnect uses its own relays.
- `data:` images are the QR codes the page draws.

## Tests

```bash
npm test                         # unit, component and integration tests
npx playwright install chromium  # once, about 130 MB
npm run test:e2e                 # browser tests against `npm run demo`
```

The browser tests run the full flow in Chromium with in-page keys: bind with each
proof type, publish, verify, log in, step-up, and a refused login for an
unpublished binding. They also check the routes, deep links, the theme switch,
the fonts and the security policy, and save a screenshot of each page in both
themes to `apps/web/test-results/screenshots/`. Real wallets were tested by hand; their proofs are kept as
vectors in `spec/vectors/bch-tx-proof-wallets.json`.
