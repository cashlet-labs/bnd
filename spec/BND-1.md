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

TODO.

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
