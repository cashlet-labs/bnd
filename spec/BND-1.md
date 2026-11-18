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

TODO.

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
