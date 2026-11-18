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
| Binding event kind  | `30910` (provisional)        |
| Binding `d` tag     | `bnd1`                       |
| Nostr key path      | `m/44'/1237'/<account>'/0/0` |
| Canonical encoding  | JSON Canonicalization Scheme |

Kind `30910` is an addressable event kind (NIP-01, range 30000–39999) that is
not listed in the NIPs kind table at the time of writing. The number is defined
in one place and may change before the spec is final.

Because the `d` tag is fixed, a Nostr key has at most one live binding.
Replacing it publishes a newer event with the same kind, key and `d` tag.

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
| `bch.network`     | string  | `"mainnet"`, `"testnet"` or `"chipnet"`                         |
| `bch.keyHash`     | string  | 20-byte HASH160 of the compressed BCH public key, lowercase hex |
| `createdAt`       | integer | Unix time in seconds, greater than zero                         |
| `previous`        | string  | Optional. ID of the binding this one replaces (32-byte hex)     |

Unknown members are an error, at any depth. A verifier MUST NOT ignore them.

The BCH key is identified by its HASH160 and network, not by an address string.
The plain `q…` form and the token-aware `z…` form of a P2PKH address name the
same key hash, so a verifier accepts either. Only P2PKH is supported. P2SH
addresses, including multisig, are rejected. Testnet and chipnet share the
`bchtest` address prefix, so the `network` member is what tells them apart.

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
| Hash type      | `0x41` (`SIGHASH_ALL \| FORKID`)                                                                               |
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

Test vectors: `spec/vectors/bch-tx-proof.json`.

### 4.3 What the proof does and does not show

A proof shows that the holder of the BCH key approved this exact binding.
Section 5 adds the Nostr key's matching approval. Neither proof says anything
about who the person is, or whether either key has been compromised since.
Section 9 covers replacement.

## 5. Nostr event

TODO.

## 6. Discovery and revocation

TODO.

## 7. Verification

TODO.

## 8. Authentication

TODO.

## 9. Key rotation and recovery

TODO.

## 10. Security considerations

TODO.
