# BND-1: BCH–Nostr Identity Binding

Status: draft. Sections marked TODO are filled in by later changes.

BND-1 binds one Bitcoin Cash P2PKH key to one Nostr key. Each key signs a
statement about the other, so a verifier can confirm that one party controls
both. The keys are independent and no private key leaves its owner.

## 1. Identifiers

| Constant            | Value                        |
| ------------------- | ---------------------------- |
| Protocol identifier | `bnd`                        |
| Protocol version    | `1`                          |
| Binding event kind  | `30078` (NIP-78)             |
| Binding `d` tag     | `bnd1`                       |
| Key hash tag        | `b`                          |
| Nostr key path      | `m/44'/1237'/<account>'/0/0` |
| Canonical encoding  | JSON Canonicalization Scheme |

Kind `30078` is NIP-78 application-specific data, an addressable kind (NIP-01,
range 30000–39999). It needs no registration, and public relays accept it
(see section 6). The fixed `d` tag keeps binding events apart from other
applications' NIP-78 data and means a Nostr key has at most one live binding:
a newer event with the same kind, key and `d` tag replaces the older one.

## 2. Canonical encoding

All signed or hashed structures are encoded as canonical JSON per RFC 8785
(JCS), restricted to the value types BND-1 uses: objects, arrays, strings,
booleans, `null` and safe integers. Floating-point numbers, `undefined`,
lone surrogates and non-plain objects are rejected.

Test vectors: `spec/vectors/canonical.json`.

## 3. Binding record

A binding record states which Nostr key and which Bitcoin Cash key belong to
one person. It is a JSON object with exactly these members:

| Member            | Type    | Rule                                                            |
| ----------------- | ------- | --------------------------------------------------------------- |
| `protocol`        | string  | `"bnd"`                                                         |
| `version`         | integer | `1`                                                             |
| `nostr.publicKey` | string  | 32-byte x-only secp256k1 key, lowercase hex, a valid point      |
| `bch.network`     | string  | `"mainnet"` or `"chipnet"`                                      |
| `bch.keyHash`     | string  | 20-byte HASH160 of the compressed BCH public key, lowercase hex |
| `createdAt`       | integer | Unix time in seconds, greater than zero                         |
| `previous`        | string  | Optional. ID of the binding this one replaces (32-byte hex)     |

Unknown members are an error, at any depth. A verifier MUST NOT ignore them.

The BCH key is identified by its HASH160 and network, not by an address string.
The plain `q…` form and the token-aware `z…` form of a P2PKH address name the
same key hash, so a verifier accepts either. Only P2PKH is supported. P2SH
addresses, including multisig, are rejected.

Version 1 supports two networks: BCH mainnet and chipnet. Every BCH test
network uses the `bchtest` address prefix, so an address alone cannot say which
chain it belongs to. The `network` member says it. Other test networks, such as
testnet3 and testnet4, are different chains with the same prefix and are not
part of version 1.

### 3.1 Binding ID

```text
bindingId = lowercase_hex( SHA-256( "bnd/1/binding-id\n" || canonical(record) ) )
```

`canonical` is the encoding in section 2, as UTF-8. The domain tag keeps this
hash from being confused with any other hash of the same bytes. Later sections
sign the binding ID, so changing any member changes what both keys signed.

Test vectors: `spec/vectors/binding.json`.

### 3.2 Key derivation

Implementations that derive keys from a BIP39 mnemonic SHOULD use:

| Key   | Path                          | Standard |
| ----- | ----------------------------- | -------- |
| Nostr | `m/44'/1237'/<account>'/0/0`  | NIP-06   |
| BCH   | `m/44'/145'/<account>'/0/<i>` | BIP44    |

The two paths give unrelated keys. A binding MUST NOT use the same private key
for both identities. Wallets that hold keys another way can bind any
compressed secp256k1 BCH key.

## 4. BCH ownership proof

A binding is only valid if the holder of the bound BCH key approved it. The
approval is one of two proof types. Both are first-class. A verifier MUST
accept either and MUST NOT prefer or convert one into the other. The signer
chooses which type to produce, based on what its wallet connection supports.

```json
{ "type": "message", "signature": "<Base64>" }
{ "type": "tx", "transaction": "<lowercase hex>" }
```

A proof object has exactly those members. Anything else is rejected.

### 4.1 Message proof

The wallet signs this exact UTF-8 text, with lines separated by `\n` and no
trailing newline. The verifier builds the text from the record, so no
free-form text is ever signed.

```text
bnd/1/bch-proof
binding: <bindingId>
nostr: <nostr public key, lowercase hex>
bch: <plain CashAddr of the bound key on the record's network>
created: <createdAt>
```

The signature uses the Bitcoin Signed Message rules:

```text
hash      = SHA-256( SHA-256( 0x18 || "Bitcoin Signed Message:\n" ||
                              CompactSize(len(message)) || message ) )
signature = Base64( (31 + recoveryId) || r || s )       65 bytes
```

The verifier requires canonical padded Base64, exactly 65 bytes, a header from
31 to 34 (compressed key), and a low S value. It recovers the public key from
the signature, computes its HASH160, and compares that to `bch.keyHash`.
Uncompressed headers (27 to 30), segwit headers (35 and above), high-S
signatures and non-canonical Base64 are rejected, so one signature has one
text form.

Test vectors: `spec/vectors/bch-message-proof.json`. The hash was checked with
an independent implementation, and the signature matches the algorithm that
wallets implement for WalletConnect `bch_signMessage`.

### 4.2 Transaction proof

Some wallet connections can sign transactions but not messages. For those, the
proof is a signed Bitcoin Cash transaction that spends a **virtual output** of
the bound key. The input refers to no real output, so the transaction cannot be
confirmed or broadcast for any purpose.

| Part           | Value                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Version        | `2`                                                                                                            |
| Locktime       | `0`                                                                                                            |
| Input count    | `1`                                                                                                            |
| Input outpoint | hash `SHA-256("bnd/1/virtual-utxo\n" \|\| bindingId bytes)`, index `0`                                         |
| Input sequence | `0xffffffff`                                                                                                   |
| Spent output   | `OP_DUP OP_HASH160 <bch.keyHash> OP_EQUALVERIFY OP_CHECKSIG`, 0 sats                                           |
| Unlocking      | two pushes: the signature followed by the hash type byte, then the 33-byte compressed public key; nothing else |
| Hash type      | `0x61` (`SIGHASH_ALL \| FORKID \| UTXOS`)                                                                      |
| Output count   | `1`                                                                                                            |
| Output         | value 0, script `OP_RETURN` pushing `"bnd1" \|\| bindingId bytes` (36 bytes)                                   |

The signature may be Schnorr or ECDSA. The verifier decodes the transaction,
requires it to re-encode to the same bytes, compares every field above, parses
the unlocking script strictly, and then runs the Bitcoin Cash script engine
over the input with the reconstructed spent output. The script engine checks
the signature and that the public key hashes to `bch.keyHash`.

Why this is safe:

- The outpoint is derived from the binding ID and does not exist, so the
  transaction has no value and no effect on any chain.
- The signature commits to the outpoint and the output, so it cannot be reused
  for a different binding, network or time.
- No chain access is needed to verify it.

A wallet protocol carries the unsigned transaction, the spent output and a
short prompt, and returns the signed transaction. WizardConnect
(`sign_transaction_request`) and WalletConnect (`bch_signTransaction`) both do
this. Wallets that sign only inputs they own, by path, need no change. A wallet
that refuses to sign a transaction with an unknown input cannot produce this
proof, and a user of that wallet can use the message proof instead if the
wallet supports it.

A client MUST ask the wallet not to broadcast a proof transaction, for example
with `broadcast: false` in a WizardConnect or WalletConnect request. The
transaction cannot confirm, so broadcasting it only fails, shows the user an
error, and sends the proof to a third party for no purpose. Some wallets
broadcast whatever they sign unless told not to.

The hash type `0x61` includes the `UTXOS` flag, which makes the signature commit
to every spent output as well as every output of the transaction. A proof with
any other hash type is rejected, including the older `0x41` and any
`ANYONECANPAY`, `SINGLE` or `NONE` variant, because those would let the signed
transaction be changed afterwards or would sign less than the full context.

Test vectors: `spec/vectors/bch-tx-proof.json` is generated by this repository's
signer. `spec/vectors/bch-tx-proof-wallets.json` holds proofs signed by real
wallets over WizardConnect and is checked by the same verifier.

### 4.3 What the proof does and does not show

A proof shows that the holder of the BCH key approved this exact binding.
Section 5 adds the Nostr key's matching approval. Neither proof says anything
about who the person is, or whether either key has been compromised since.
Section 9 covers replacement.

## 5. Nostr event

A binding is published as one Nostr event. The Nostr key's own signature on the
event is the Nostr half of the binding, and the BCH proof in the content is the
BCH half. The event has exactly this form:

```text
kind:        30078
pubkey:      the bound Nostr key
created_at:  equals record.createdAt
tags:        [["d","bnd1"], ["b","<record.bch.keyHash>"]]
content:     canonical JSON of { "bchProof": <proof>, "record": <record> }
id, sig:     NIP-01 event ID and BIP-340 signature
```

The tags are exactly those two, in that order. The `b` tag holds the 20-byte BCH
key hash as lowercase hex. Relays index single-letter tags, so a `b` filter finds
the Nostr identities that claim a BCH key. A claim without a valid BCH proof
fails verification, so a false claim has no effect except to be ignored.

The content is the canonical encoding from section 2, of an object with
exactly the two members `bchProof` and `record`. Verifiers compare the event
text to the canonical form, so one binding has one text form.

A Nostr signer receives an event template and returns the signed event. The
interface matches NIP-07, so a browser extension or any signer that can sign
a Nostr event works. The signer MUST NOT change the template. A verifier
rejects an event whose time, tags or author differ from the record.

Test vectors: `spec/vectors/binding-event.json`.

## 6. Discovery and revocation

Discovery uses an ordinary Nostr subscription:

```json
{ "kinds": [30078], "authors": ["<nostr public key>"], "#d": ["bnd1"] }
```

A Nostr key can also be found from a BCH key: `{ "kinds": [30078], "#b": ["<key hash>"] }`.
Results of the second query are claims, not facts, and each one MUST be
verified.

A client queries several relays, verifies every event, ignores the invalid ones,
and takes the newest valid binding by `created_at`. When two events have the
same time, the lower event ID wins, as on relays. Relays are untrusted: they can
withhold events or serve old ones, so asking more than one relay is the only
defence against a stale answer. A verifier never trusts what a relay says
about validity.

At the time of writing, a test event of this form was accepted and returned by
`#d` and `#b` queries on public relays, including `nos.lol`, `relay.primal.net`,
`offchain.pub`, `nostr.mom`, `relay.snort.social` and `relay.damus.io`.

TODO: revocation and succession (sections 6 and 9).

## 7. Verification

A verifier takes one event and needs no network. It accepts the binding only if
every step below passes, and reports the first failure:

1. The value is a well-formed NIP-01 event, and its kind is `30078`.
2. The content is canonical JSON with exactly `bchProof` and `record`.
3. The record is valid under section 3, including strict hex and no unknown
   members, and the proof object is one of the two forms in section 4.
4. The event's author equals `record.nostr.publicKey`, its time equals
   `record.createdAt`, and its tags are exactly the two in section 5.
5. The NIP-01 event ID matches the event and the BIP-340 signature is valid.
6. The BCH proof is valid for the record under section 4.1 or 4.2.

Both signatures are required. An event with a valid BCH proof and no valid Nostr
signature is not a binding, and neither is the reverse. A verifier reports
which proof type the BCH key gave.

Newest-wins discovery (section 6) is safe only until succession rules exist. A
holder of the Nostr key alone could publish a newer binding to a different
BCH key. Section 9 will require authorization from the keys being replaced.

## 8. Authentication

A user logs in to an application by answering a one-time challenge with the
keys their binding names. The application needs no identity provider: it checks
signatures itself and asks relays only to confirm the binding is current.

### 8.1 Levels

| Level   | Who signs the challenge             | What it proves                   |
| ------- | ----------------------------------- | -------------------------------- |
| `nostr` | the Nostr key                       | current control of the Nostr key |
| `dual`  | the Nostr key and the bound BCH key | current control of both keys     |

The application chooses the level; the response MUST meet it exactly. A `nostr`
response carries no BCH proof and a `dual` response carries exactly one. An
application that allows both levels records the level in the session and
refuses actions that need `dual` when the session is `nostr`, asking the user to
log in again with both keys.

### 8.2 Challenge

```json
{
  "nonce": "<32 random bytes, lowercase hex>",
  "audience": "<absolute http or https URL of the login endpoint>",
  "level": "nostr | dual",
  "issuedAt": 0,
  "expiresAt": 0
}
```

The challenge has exactly these members. The nonce comes from a secure random
source. The application stores the challenge, accepts one response per
challenge, discards it after five failed attempts, and lets it expire after
five minutes by default. The audience has no fragment, whitespace or line break.

### 8.3 Statement

Both keys approve one statement, written as a CAIP-122 "Sign in with X" message
so that wallets and users see a familiar layout:

```text
<domain> wants you to sign in with your Bitcoin Cash account:
<plain CashAddr of the bound key>

Sign in with BND at level <level>.

URI: <audience>
Version: 1
Nonce: <nonce>
Issued At: <issuedAt as RFC 3339, UTC, whole seconds>
Expiration Time: <expiresAt as RFC 3339, UTC, whole seconds>
Chain ID: <CAIP-2 chain ID of the binding's network>
Resources:
- nostr:<npub of the bound Nostr key>
- bnd:binding/<binding ID>
- bnd:level/<level>
```

Lines are separated by `\n` with no trailing newline. `<domain>` is the host of
the audience, with its port when it has one. The `nostr:` resource is a NIP-21
URI. The statement digest is the lowercase hex SHA-256 of the UTF-8 text.

CAIP-122 leaves the signing algorithm to each chain, and none is defined for
Bitcoin Cash. BND uses the two proof types from section 4.

Chain IDs use the CAIP-2 `bip122` namespace: `bip122:` and the first 32 hex
characters of a block hash found only on that chain.

| Network | Chain ID                                  | Block                                  |
| ------- | ----------------------------------------- | -------------------------------------- |
| mainnet | `bip122:000000000000000000651ef99cb9fcbe` | 478559, the first Bitcoin Cash block   |
| chipnet | `bip122:000000000000e0b99c152c6119f94eae` | 335882, checked on two chipnet servers |

The mainnet value is the one the `bip122` namespace lists. Chipnet shares its
first blocks with testnet4, so its ID names a recent chipnet block instead of
its genesis. A chipnet reset changes the chipnet value.

### 8.4 BCH proof of the statement

- **Message proof:** the wallet signs the statement text with the rules of
  section 4.1.
- **Transaction proof:** as section 4.2, with three differences that keep a
  login proof and a binding proof apart. The virtual outpoint hash is
  `SHA-256("bnd/1/virtual-utxo-auth\n" || digest bytes)`, the OP_RETURN data is
  `"bna1" || digest bytes`, and the wallet prompt is
  `Sign in to <domain>. No funds move.`

A proof made for a binding is never accepted for a login, and the reverse.

### 8.5 Nostr event

The Nostr key signs a NIP-98 event (kind `27235`) with empty content and exactly
these tags, in this order:

```text
["u", "<audience>"]
["method", "POST"]
["challenge", "<nonce>"]
["binding", "<binding ID>"]
["statement", "<statement digest>"]
```

`challenge` is the tag NIP-42 uses for the same purpose. NIP-98's `payload`
tag cannot be used, because the request body contains this event. The
`statement` tag ties the Nostr signature to the same statement the BCH key
approved. The event time must be within 60 seconds of the verifier's clock, as
NIP-98 suggests, and no more than 60 seconds before the challenge was issued.

A client SHOULD sign the BCH proof first and the Nostr event last, so the event
time is fresh after a slow wallet. A browser client SHOULD refuse a challenge
whose audience is not on the page's own origin, so one site cannot pass another
site's challenge to the user.

### 8.6 Login response and verification

```text
{ "binding": <binding event>, "event": <Nostr event>, "bchProof": <proof, dual only> }
```

The response has exactly these members. The verifier:

1. Finds the challenge named by the event's `challenge` tag, unexpired and unused.
2. Verifies the binding event as in section 7.
3. Verifies the Nostr event: its signature, kind `27235`, author equal to the
   bound Nostr key, time within the window, and tags and content equal to 8.5.
4. For `dual`, verifies the BCH proof against the statement. For `nostr`,
   refuses any BCH proof.
5. Checks the binding is current (8.7).
6. Consumes the challenge. If another request consumed it first, the login fails.

Any failure in steps 2 to 5 counts as a failed attempt and leaves the challenge
unused until its attempts run out. Step 6 is atomic, so one response logs in once.

### 8.7 Current binding

A login uses the user's current binding, which the verifier confirms on relays.
It asks the relays it is configured with and the user's NIP-65 write relays
(8.8), verifies every event it receives, and decides:

| Relay answers                                               | Result                         |
| ----------------------------------------------------------- | ------------------------------ |
| fewer complete answers than the configured minimum          | reject: could not check        |
| enough answers, the presented binding found on none of them | reject: not published          |
| found, and no relay holds a newer valid binding for the key | accept                         |
| a relay holds a newer valid binding for the key             | reject: a newer binding exists |

The default minimum is 2 complete answers. "Newer" uses the rule in section 6:
later `created_at`, or the lower event ID on a tie. Relays that still serve an
older binding do not matter, because the presented one was found elsewhere.
Relays cannot make this check pass with forged events, only fail.

### 8.8 User relay lists

The verifier reads the newest signed kind `10002` event (NIP-65) by the user
from its configured relays and adds up to four `write` or unmarked relays.
These URLs come from the user, so a server connecting to them could be steered
to hosts only it can reach. A relay from a user's list is used only if:

- it is `wss://`, with no credentials, query or fragment;
- its host is a DNS name, not an IP address, `localhost`, or a `.local`,
  `.internal` or `.home.arpa` name; and
- on a server, every address the name resolves to is public, which excludes
  private, loopback, link-local, shared, documentation, benchmarking, multicast
  and reserved ranges.

The name is resolved again when the connection opens, so a DNS server that
changes its answer in between can still steer that one connection. Running the
verifier without a route to internal networks removes this risk.

Test vectors: `spec/vectors/auth.json`.

## 9. Key rotation and recovery

TODO.

## 10. Security considerations

TODO.
