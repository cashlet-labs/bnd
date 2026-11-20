# How the demo connects to BCH wallets

The BND library does not depend on any wallet protocol. A BCH wallet takes part
through the `BchSigner` interface in `@cashlet-labs/bnd`, which has two
methods, one per proof type in the specification (section 4):

- `signMessage(text)` for the message proof (Bitcoin Signed Message);
- `signTransaction(request)` for the transaction proof (a signed transaction
  that spends a virtual output and can never be broadcast).

A verifier accepts either proof. Which one a user gives depends only on what
their wallet connection can sign.

## What the demo uses

| Connection                   | Proof type  | Notes                                |
| ---------------------------- | ----------- | ------------------------------------ |
| WizardConnect (`hdwalletv1`) | transaction | Main path for real wallets           |
| Local test key in the page   | both        | For trying the demo without a wallet |

WizardConnect carries `sign_transaction_request` over Nostr relays and needs no
account with any provider. The demo always sends `broadcast: false`: some
wallets broadcast whatever they sign unless told not to, and broadcasting a
proof only fails and shows the user an error (specification section 4.2).

The transaction proof over WizardConnect was tested with two mobile wallets and
one browser-extension wallet on chipnet. Every proof they returned passed the
same verifier, with a Schnorr signature and hash type `0x61`. The request and the
verifier are identical for every wallet.

WizardConnect cannot sign arbitrary text, so the message proof is not offered
to real wallets in the demo. The library, the specification and the test vectors
support it fully, and the demo's local test key produces it.

WizardConnect's packages (`@wizardconnect/core`, `@wizardconnect/dapp`) are
licensed under the GNU Lesser General Public License, version 3.0 or later, as
stated in their source files.

## Why WalletConnect is not in the demo

WalletConnect would add one thing the demo lacks: the message proof from a
mobile wallet, through `bch_signMessage`. It was left out for these reasons,
checked in November 2026:

1. **Licence.** From version 2.22 (August 2025), `@walletconnect/sign-client` and
   its own dependencies are published under the "WalletConnect Community License"
   from Reown, not an open-source licence. It is free only below 500 monthly
   active users and 2.5 million calls a month, modifications are assigned to
   Reown, and Reown may change the terms. Version 2.21.8 is the last release
   under Apache-2.0.
2. **A central service.** It needs a project ID from a Reown account, carries
   messages through Reown's relay, loads Reown's verification page in a hidden
   frame and sends usage data unless turned off. Verifying a BND identity needs
   none of this, but the demo's wallet connection would depend on one company.
3. **No transaction proof from at least one wallet.** One of the wallets we
   tested broadcasts every transaction it signs over WalletConnect, ignoring
   `broadcast: false`, and returns an error instead of the signature when the
   broadcast fails. A proof always fails to broadcast, so that wallet cannot
   give a transaction proof over WalletConnect. The same wallet honours
   `broadcast: false` over WizardConnect.
4. **Cost.** One more signer to build and test, and a page security policy that
   must allow Reown's relay, frame and telemetry addresses.

What this leaves out: users of wallets that support WalletConnect but not
WizardConnect, and the message proof from a mobile wallet.

## Adding another connection later

A new connection is a new `BchSigner`. Nothing in the library, the specification
or the verifier changes. A WalletConnect signer would map `signMessage` to
`bch_signMessage` and `signTransaction` to `bch_signTransaction` with
`broadcast: false`, and should report a wallet error rather than switch to the
other proof type.
