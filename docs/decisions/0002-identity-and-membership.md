# ADR-0002: Keys, device-members and a signed membership log

- Status: accepted
- Date: 2026-11-06

## Context

There are no accounts. Multi-user collaboration is v1. The server must authorize a join and every
update without a Suite-operated identity provider, and a removed member must lose access.

A person may use several devices. Modelling a person as the only member would require delegated device
keys; modelling each device as a member is simpler and gives a clean revocation unit.

## Decision

- **Each device is a member** in v1. A person with two devices has two member records, each with its
  own keypair and role.
- **Device, member and workspace ids are key fingerprints** (64 lower-case hex characters). The crypto
  layer derives them; the protocol treats them as opaque.
- **Membership is an append-only signed log**: `create`, `invite`, `accept`, `set-role`, `revoke`.
- **Roles are owner, editor and viewer.** Only an active owner invites, changes roles or revokes.
  Ownership transfer is out of scope in v1.
- **An invite names the invitee's public key**, so accepting it is a signature by the intended key, not
  a bearer token.
- **A revoke bumps the epoch.** The epoch is the group-key epoch: a new key is wrapped to the remaining
  members. Old ciphertext stays readable to old key holders; that is documented, not hidden.
- **Signature payloads are canonical JSON** with sorted keys, excluding the signature field.

## Consequences

- The membership log is portable and testable without a key store.
- The server can enforce roles by reading the log and the signed entries; it never needs plaintext.
- A person who wants a second device creates a second member; the UI must present that honestly.
- Per-person members with device sub-keys are a later change behind the same log.
- Key recovery is a product surface: a recovery kit is mandatory, and losing every device without it
  loses the workspace.
