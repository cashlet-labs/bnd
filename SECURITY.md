# Security policy

## Reporting a vulnerability

Email <hello@septemlabs.com> with a description, the affected version or commit,
and steps to reproduce. Please do not open a public issue for a vulnerability.

We aim to acknowledge reports within three working days and to agree a
disclosure date with you once the problem is understood.

Never send private keys, mnemonics or `nsec` values, yours or anyone else's. A
chipnet key made for the report is enough.

## Scope

- The specification in `spec/`: any way to make a verifier accept a binding,
  successor, revocation, login or DID resolution that the rules should refuse.
- The packages in `packages/`.
- The demo page, verifier and DID resolver in `apps/`, and the hosted demo at
  <https://bnd-core.septemlabs.com>.

Out of scope: the limitations listed in [docs/threat-model.md](docs/threat-model.md),
denial of service by volume against the hosted demo, and third-party wallets,
signers and relays.

## Supported versions

The project is a draft and only the latest release receives fixes.
