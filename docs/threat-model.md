# Threat model

What BND protects, against whom, and where it stops. Key compromise is covered
in detail in [BND-1 section 10](../spec/BND-1.md#10-security-considerations)
and [did:bnd section 8](../spec/did-bnd.md#8-security-considerations); this page
puts those together with the rest of the system.

## What is protected

- **The link** between a Nostr key and a BCH key: nobody can claim it without
  both keys signing.
- **Control of the identity:** nobody can replace or revoke a binding without
  two of its three keys.
- **Logins:** nobody can log in as a user without their current keys, or replay
  a login.
- **Payments by identity:** an address shown for an identity is its current,
  verified one.

## Who is trusted for what

| Party         | Trusted for                     | Not trusted for                                   |
| ------------- | ------------------------------- | ------------------------------------------------- |
| The user      | keeping keys, approving prompts | -                                                 |
| Wallet/signer | signing only what is shown      | anything else; BND verifies everything it returns |
| Relays        | nothing beyond availability     | validity, freshness, completeness                 |
| Verifier      | its own sessions and pins       | other applications' decisions                     |
| DID resolver  | the answer it gives you         | a relying party can resolve by itself instead     |

## Attacks and defences

| Attack                                           | Defence                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Claim someone else's BCH address                 | The binding needs a proof by that BCH key (section 4).                                                    |
| Reuse a proof for another binding or a login     | Proofs name the binding ID; binding, login and approval use distinct texts, tags and domains.             |
| Broadcast a proof transaction                    | It spends a non-existent output and pays nothing; it cannot confirm.                                      |
| Forge or alter an event on a relay               | Every event's signatures are checked locally; unknown members and non-canonical JSON are refused.         |
| Relay serves an old binding                      | Successors are found by `#s` from several relays; logins need two complete answers.                       |
| Relay hides the newest binding                   | Ask several relays, including ones that enforce succession; fail when too few answer.                     |
| Stolen Nostr key: replace the binding            | A successor needs a second key (section 9.1).                                                             |
| Stolen Nostr key: publish a fake first binding   | Makes the identity disputed, not taken over; enforcing relays refuse it; pins refuse it; its DID differs. |
| Stolen Nostr key: delete the binding             | Deletions do not revoke; enforcing relays refuse them.                                                    |
| Stolen BCH key                                   | Cannot move the identity; claiming it from another Nostr key makes the BCH key disputed.                  |
| Replay a login                                   | One-time challenge, five-minute expiry, atomic consumption, audience bound to the origin.                 |
| Another site relays its challenge to the user    | The page refuses a challenge whose audience is not on its own origin (section 8.5).                       |
| Use a Nostr-only session for a value action      | Sessions record their level; `dual` actions refuse `nostr` sessions.                                      |
| Pay a stale or contested address                 | `resolvePayee` refuses revoked, disputed or under-confirmed identities.                                   |
| Server-side request forgery via user relay lists | Only public `wss://` DNS names are used; addresses are checked on the server (section 8.8).               |
| Abuse of the public resolver and login service   | Per-client rate limits; the resolver is read-only, sends no cookies and allows any origin.                |
| Script injection in the demo page                | Strict Content Security Policy and other headers ([demo.md](demo.md#page-security)).                      |

## Limitations

- **Two stolen keys are a takeover.** Two of three is as far as the protocol
  can tell owners and thieves apart.
- **Withheld bindings.** A verifier with no pin, reaching only relays from which
  a thief wiped the real binding, cannot see the fork and accepts the thief's
  chain. Pins and enforcing relays narrow this.
- **Disputes are not settled automatically.** A disputed identity is unusable
  until the owner publishes a successor approved by two keys. Planned: anchors
  in Bitcoin Cash transactions that settle a dispute when every branch is
  anchored, in favour of the earliest. Letting an anchored branch beat an
  unanchored one is deliberately ruled out, because it would let a thief holding
  only the Nostr key win against an owner who never anchored
  ([BND-1 section 9.6](../spec/BND-1.md#96-resolving-an-identity)).
- **Lost key without a recovery key.** It cannot be replaced; the user starts a
  new identity.
- **A recovery key from the same mnemonic** protects against one lost key, not
  a lost or stolen mnemonic.
- **Time is self-declared.** `createdAt` is chosen by the signer; resolution
  never uses it to choose between chains.
- **History is capped at 32 steps;** after that the owner starts again with a
  new Nostr key.
- **Everything is public,** including every earlier key and address. The bound
  address is correlatable on chain ([did:bnd section 9](../spec/did-bnd.md#9-privacy-considerations)).
- **Wallet prompts.** BND cannot make a wallet show the user what it signs; a
  wallet that hides prompts can be tricked by any application.
- **No external review yet.** The protocol and code have been reviewed only by
  their authors.
- **The demo's pins and sessions live in memory** and are lost on restart.
