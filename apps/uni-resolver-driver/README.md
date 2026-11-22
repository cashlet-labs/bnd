# did:bnd driver for the DIF Universal Resolver

Resolves `did:bnd` identifiers over HTTP, as the
[Universal Resolver](https://github.com/decentralized-identity/universal-resolver)
expects from a driver. It uses `resolveDid` from
[`@cashlet-labs/bnd`](../../packages/bnd): every binding is verified locally and
relays are never trusted. Too few complete relay answers is an error, never a
stale document.

## Interface

`GET /1.0/identifiers/{did}`

| `Accept` header           | Response                        |
| ------------------------- | ------------------------------- |
| anything else (default)   | DID Resolution Result           |
| `application/did+ld+json` | the DID document, with @context |
| `application/did+json`    | the DID document, plain JSON    |

Status codes: 200 resolved, 400 invalid DID, 404 not found, 409 conflicting
bindings, 410 deactivated (revoked), 500 too few relays answered.
`GET /health` returns `{ "ok": true, "version": "…" }`.

## Configuration

| Variable           | Default                                          |
| ------------------ | ------------------------------------------------ |
| `PORT`             | `8080`                                           |
| `BND_RELAYS`       | the two enforcing relays and BND's public relays |
| `BND_MIN_COMPLETE` | `2` complete relay answers                       |

## Run

```bash
npm run build -w @cashlet-labs/uni-resolver-driver
docker build -t uni-resolver-driver-did-bnd:0.1.0 apps/uni-resolver-driver
docker run --rm -p 8080:8080 uni-resolver-driver-did-bnd:0.1.0
curl http://localhost:8080/1.0/identifiers/did:bnd:mainnet:e7696051b58cc9e816df046f35f28569d8c176d6a4d7376124f5e8cd746d52ae:ba716d796bad52f32380ea4c94064d8d1df0e5aeab16befe506ac8e85f74c1f1
```

The image runs as a non-root user on `node:22-alpine`.
