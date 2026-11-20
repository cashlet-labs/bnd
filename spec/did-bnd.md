# The did:bnd DID Method

Status: draft. Version 0.1.

Authors: Septem Labs (<hello@septemlabs.com>).

Repository: <https://github.com/cashlet-labs/bnd>.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in
capitals.

## 1. Introduction

A did:bnd DID names an identity that binds one Bitcoin Cash key and one Nostr
key, as defined by [BND-1](BND-1.md). Each key signs a statement naming the
other, and the binding is published as a Nostr event. Either key can later be
replaced, with the approval of two of the identity's three keys (the Nostr key,
the BCH key and an optional recovery key), and the identity can be revoked.

The DID names the identity by its first binding. It does not change when keys
rotate. That is the reason for a new method rather than `did:nostr`, whose
identifier is the Nostr key itself and which defines no rotation: under
`did:nostr`, a rotated or lost Nostr key means a new DID. A did:bnd document
links the current `did:nostr` identifier with `alsoKnownAs`, and reuses the
`did:nostr` encoding of Nostr keys, so did:nostr tooling still connects.

The method writes nothing on a blockchain and needs no registry. Its verifiable
data registry is the set of Nostr relays that hold the identity's bindings. Every
binding is signed by the keys it names, so relays are untrusted: they can hide
bindings but not forge them.

## 2. Method name

The method name is `bnd`. A DID that uses this method MUST begin with
`did:bnd:`, in lowercase.

## 3. Method-specific identifier

```abnf
bnd-did          = "did:bnd:" network ":" root-nostr-key ":" root-binding-id
network          = "mainnet" / "chipnet"
root-nostr-key   = 64HEXLOWER
root-binding-id  = 64HEXLOWER
HEXLOWER         = DIGIT / %x61-66   ; 0-9 a-f
```

- `network` is the BCH network of the identity's first binding (BND-1 section 3).
- `root-nostr-key` is the x-only public key, in lowercase hex, of the first
  binding's Nostr key.
- `root-binding-id` is the binding ID of the first binding (BND-1 section 3.1).

All three are fixed when the identity is created. The binding ID commits to the
whole first record, including both keys, so one DID names exactly one first
binding. The Nostr key is included because relays index bindings by author, not
by binding ID; it is how a resolver finds the identity.

Example:

```text
did:bnd:chipnet:17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917:4dfb726015da9691e49824a751e7c199f8302398fe531defbe732afb2ae396db
```

A string that does not match the grammar is an invalid DID, and resolution MUST
fail with `invalidDid`.

## 4. Operations

### 4.1 Create

Create a first binding (BND-1 sections 3 to 5): both keys sign a record naming
the other, optionally naming a recovery key, and the event is published to
relays. The DID is then formed from the binding's network, Nostr key and binding
ID. Nothing else is registered.

### 4.2 Read (resolve)

A resolver MUST:

1. Parse the DID (section 3), or fail with `invalidDid`.
2. Ask relays for binding events by the root Nostr key
   (`{"kinds":[30078],"authors":[<root-nostr-key>],"#d":["bnd1"]}`) and for
   successors of the root (`{"kinds":[30078],"#s":[<root-binding-id>]}`), then
   keep asking for successors (`#s`) of every binding found until no new ones
   appear (BND-1 section 6).
3. Verify every event under BND-1 section 7, including the full history of every
   successor and revocation, and discard events that fail.
4. Keep only bindings whose chain starts at the DID's root: their first history
   step, or the binding itself if it has no history, has the DID's root binding
   ID, root Nostr key and network.
5. Discard every kept binding that appears in another kept binding's history.
6. If none is left, fail with `notFound`. If more than one is left, fail with
   `conflict`. Otherwise the one left is the identity's current binding.

A resolver that queries relays MUST require a minimum number of complete answers
(the relay sent everything it holds) before step 6, and MUST fail with
`internalError` when fewer answer. The default minimum is 2. A resolver SHOULD
ask relays that enforce succession (BND-1 section 9.8) first.

Step 4 means a second first binding for the root Nostr key, which a thief
holding only that key could publish, never affects the DID: it starts a
different chain, and so a different DID. Within the DID's own chain, a fork
needs two of the three keys of the binding it forks from.

### 4.3 Update

Publish a successor of the current binding (BND-1 section 9). A successor can
replace the Nostr key, the BCH key or both, and add, change or remove the
recovery key. It MUST be approved by two keys of the binding it replaces. The DID
does not change.

### 4.4 Deactivate

Publish a revocation of the current binding (BND-1 section 9.5), approved by two
of its keys. Nothing can follow a revocation. Resolution then returns
`deactivated: true` in the document metadata.

## 5. DID document

For a current binding, the document is:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://www.w3.org/ns/cid/v1",
    "https://w3id.org/security/suites/secp256k1recovery-2020/v2"
  ],
  "id": "<did>",
  "alsoKnownAs": ["did:nostr:<current nostr key>"],
  "verificationMethod": [
    {
      "id": "<did>#nostr",
      "type": "Multikey",
      "controller": "<did>",
      "publicKeyMultibase": "fe70102<current nostr key>"
    },
    {
      "id": "<did>#bch",
      "type": "EcdsaSecp256k1RecoveryMethod2020",
      "controller": "<did>",
      "blockchainAccountId": "<CAIP-2 chain id>:<cashaddr without prefix>"
    },
    {
      "id": "<did>#recovery",
      "type": "Multikey",
      "controller": "<did>",
      "publicKeyMultibase": "fe70102<recovery key>"
    }
  ],
  "authentication": ["<did>#nostr", "<did>#bch"],
  "assertionMethod": ["<did>#nostr"],
  "capabilityInvocation": ["<did>#nostr", "<did>#bch", "<did>#recovery"],
  "service": [{ "id": "<did>#relay-1", "type": "Relay", "serviceEndpoint": "wss://…" }]
}
```

- `#nostr` is the current Nostr key, a BIP-340 x-only key, encoded as `did:nostr`
  encodes it: `f` (base16 multibase), `e701` (secp256k1 public key multicodec),
  `02` (even y), then the 32-byte key.
- `#bch` is the current BCH key, given as its P2PKH account in CAIP-10 form, as
  `did:pkh` does: the BIP-122 chain ID (`bip122:000000000000000000651ef99cb9fcbe`
  for mainnet, `bip122:000000000000e0b99c152c6119f94eae` for chipnet), a colon,
  and the CashAddr without its `bitcoincash:` or `bchtest:` prefix. The prefix is
  left out because CAIP-10 addresses cannot contain a colon, and the chain ID
  already names the network.
- `#recovery` is present only if the current binding names a recovery key.
- `capabilityInvocation` lists every key that can take part in an Update or
  Deactivate. None can do either alone: two are needed (section 4.3).
- `service` lists relays that held the current binding when it was resolved. It
  MAY be omitted.

Documents MUST validate against
[`schemas/did-bnd-document.schema.json`](schemas/did-bnd-document.schema.json).
Only published JSON-LD contexts are used; BND-specific data is carried in the
resolution metadata (section 6), not as new document terms.

## 6. Resolution metadata

A resolver returns a DID Resolution Result:

```json
{
  "didDocument": { … },
  "didResolutionMetadata": { "contentType": "application/did+ld+json" },
  "didDocumentMetadata": {
    "created": "<time of the first binding>",
    "updated": "<time of the current binding, if it replaced another>",
    "deactivated": true,
    "versionId": "<binding id of the current binding>",
    "bnd": {
      "bindingId": "<binding id of the current binding>",
      "history": ["<binding ids of every earlier binding, oldest first>"],
      "approvedBy": ["<keys of the previous binding that approved it>"],
      "event": { "<the current binding event>": "…" }
    }
  }
}
```

`deactivated` is present only after a revocation; the document then describes
the revoked binding's keys and MUST NOT be used to authenticate. `bnd.event` lets
anyone verify the result again without trusting the resolver.

On failure, `didDocument` is null and `didResolutionMetadata` holds `error` and
`errorMessage`:

| Error           | Meaning                                             |
| --------------- | --------------------------------------------------- |
| `invalidDid`    | The DID does not match section 3                    |
| `notFound`      | No valid binding of this DID's chain was found      |
| `conflict`      | The chain forks: more than one binding continues it |
| `internalError` | Too few relays gave a complete answer to decide     |

`conflict` is not a DID Resolution error code. It is used because neither branch
can be chosen without trusting one; a resolver MUST NOT pick one.

## 7. HTTP resolution

A resolver MAY serve `GET /did/<did>` (the DID percent-encoded or not) and return
the DID Resolution Result with content type
`application/ld+json; profile="https://w3id.org/did-resolution"` and these
statuses: 200 resolved, 410 deactivated, 400 `invalidDid`, 404 `notFound`, 409
`conflict`, 503 `internalError`. The reference resolver serves this at
<https://bnd.septemlabs.com/did/>, open to any origin and rate-limited per
client.

## 8. Security considerations

- **No single key can change the DID.** Update and Deactivate need two of the
  three keys of the current binding. A stolen Nostr key alone cannot move the
  identity, and its second first binding is a different DID (section 4.2).
- **Two stolen keys are a takeover.** Two of three is the limit the protocol can
  tell apart. A fork between two such successors resolves to `conflict`, and
  the owner settles it by publishing a successor approved by two keys.
- **Relays can hide bindings.** A resolver that only reaches relays from which
  the current binding was withheld returns an older binding of the same chain.
  The minimum number of complete answers, relays that enforce succession, and
  relying parties that remember the binding they last saw (BND-1 section 9.7)
  reduce this. Relays cannot forge bindings: every event is verified.
- **Replay.** Binding proofs, login proofs and succession approvals use distinct
  texts, tags and domains (BND-1 sections 4, 8 and 9.2), so none can be reused as
  another.
- **Time.** `createdAt` is chosen by the signer. Resolution never uses time to
  choose between branches.
- **Authentication.** A relying party that authenticates a DID's controller
  SHOULD use the challenge-response of BND-1 section 8, which checks that the
  binding is current on relays.

## 9. Privacy considerations

- **Everything in a did:bnd document is public**, and so is the whole history:
  every earlier Nostr key, BCH address and recovery key. Rotating a key does not
  hide the old one.
- **The BCH address is correlatable on chain.** Payments to it are visible with
  their amounts. Users who want to separate payments from identity SHOULD bind
  an address they use only for that purpose.
- **The DID correlates activity** across every application that sees it, by
  design. Users who need separate contexts SHOULD create separate identities.
- No personal data is required. Profile data, if any, comes from the user's own
  Nostr profile, which the method does not read.

## 10. Reference implementation and test vectors

- Library: `@cashlet-labs/bnd-did` (`parseDid`, `didOf`, `didDocument`,
  `resolveDid`, `resolveDidFromEvents`) and the `bnd-resolve` command.
- Vectors: [`vectors/did.json`](vectors/did.json): resolution results for a
  first binding, BCH and Nostr key rotations, a thief's second first binding, a
  fork, a revocation, an unknown root, the wrong network and an invalid DID.
