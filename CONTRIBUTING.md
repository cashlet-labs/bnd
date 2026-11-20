# Contributing

## Setup

Node.js 22 or later (see `.nvmrc`) and npm.

```bash
npm install
npm run dev
```

## Changes

- Work on a branch named for the change: `feat/…`, `fix/…`, `docs/…`,
  `test/…`, `build/…` or `chore/…`.
- Write commit messages as `type(scope): summary`, for example
  `feat(did): resolve from events held locally`.
- Open one pull request per branch, using the template. Someone other than the
  author reviews and merges it, with a merge commit; pull requests are not
  squashed.

## Checks

Before opening a pull request, run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e   # when the page or the verifier changes
```

CI runs the same checks on Node.js 22 and 24, builds the deployment images and
runs the browser tests.

## Protocol changes

A change to what is signed, encoded, accepted or refused is a protocol change.
It updates the specification in `spec/` and the test vectors in `spec/vectors/`
in the same pull request, and the vectors must pass with the reference
implementation.

## Secrets

Never commit private keys, mnemonics, `nsec` values, `.env` files or server
addresses. Test keys in `spec/vectors/` are published on purpose and are for
tests only.

## Licence

By contributing you agree that code is licensed under MIT and text in `spec/`
under CC BY 4.0, as described in the [README](README.md#licence).
