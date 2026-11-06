# Security

Suite Sync is the protocol and the user-run sync server. The document stays a file the app owns; the
server is a role a person runs on a device they control.

## What is protected today, and what is not

- **Not protected yet.** The Phase 2 transport is plaintext and has no TLS. It binds to `127.0.0.1` by
  default and must not be exposed beyond a trusted network. E2E encryption is the next phase
  ([ADR-0005](docs/decisions/0005-blind-server.md)).
- **Membership is enforced.** A join needs an active member and the current epoch; a viewer cannot
  write; a revoked member is refused on the next join and dropped from the live room.
- **Ids are fingerprints.** Workspace, device and member ids are 64 lower-case hex characters. The
  protocol layer treats them as opaque; deriving them from an Ed25519 key is the crypto layer's job.
- **The server never holds a document it can edit.** The room applies signed member records and role
  checks; the shipped server is intended to be a blind relay of encrypted updates.

Read [the threat model](docs/threat-model.md) for the full list and the accepted risks.

## Reporting a vulnerability

Use GitHub's private security advisory for
[mr-rogers-neighborhood/suite-sync](https://github.com/mr-rogers-neighborhood/suite-sync/security/advisories/new).
Do not open a public issue for a vulnerability. Include the version, the platform, and the smallest
reproduction you can.
