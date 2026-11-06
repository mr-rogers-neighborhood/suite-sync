# Threat model

## Assets

- Document content: cards, text, attachments, board layout.
- The workspace epoch key and every member's device key.
- The membership log: who is in, who is out, what role they hold.
- Availability: the server and the document must remain openable offline.

## Actors

| Actor                 | Trust                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| Owner                 | Trusted to invite, revoke and run the server. A compromised owner device is game over. |
| Editor                | May write. Cannot invite, change roles or revoke.                                      |
| Viewer                | May read and receive live updates. Cannot write.                                       |
| Revoked member        | Holds old keys. Cannot join; may still read old ciphertext.                            |
| Server operator       | May be the owner or a hosting provider. Must not read content.                         |
| Network attacker      | May observe, drop, replay or reorder traffic.                                          |
| Cloud-folder provider | Future transport only. Must not read content.                                          |

## Threats and mitigations

| Threat                                 | Mitigation                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Server reads documents                 | E2E encryption with a workspace epoch key; server stores ciphertext only.                                                |
| Server is operated by a third party    | Same as above; the server is replaceable and sees no plaintext.                                                          |
| Malicious member writes garbage        | Signed updates and schema validation in the app; server enforces role and membership before forwarding.                  |
| Impersonation at join                  | Invite names the invitee's public key; both sides confirm the fingerprint.                                               |
| Stolen device                          | Owner revokes the member; epoch rotates; live connection is dropped. OS disk encryption protects the local file.         |
| Replay of an old membership entry      | Strict `seq`, workspace binding, signature check, and an append-only log.                                                |
| Replay of an old document update       | Loro version vectors and CRDT idempotence; an update already applied is a no-op.                                         |
| Revoked member keeps reading           | A new epoch key is wrapped only to remaining members. Old ciphertext remains readable to old key holders; document this. |
| Server deletes or withholds ciphertext | Availability is the operator's responsibility; members keep local copies and can export.                                 |
| Server learns metadata                 | Accept that workspace ids, member keys, sizes and timing are visible. Minimize what is sent; document it.                |
| Ghost cursor after a disconnect        | Presence is ephemeral with a TTL, separate from the document.                                                            |

## Current implementation gap

The Phase 2 server keeps a plaintext Loro replica per room and writes a plaintext snapshot to disk.
That is a development transport, not the shipped server. It is bound to `127.0.0.1` by default and
must not be exposed beyond a trusted network.

[ADR-0005](../decisions/0005-blind-server.md) is the fix: the server becomes a blind relay of
encrypted updates, clients keep the only decryptable replica, and the server enforces membership and
role from signed headers. Until that lands, threats 1 and 2 in the table are **not** mitigated.

## Non-goals

- Protecting against a compromised owner device or a malicious owner.
- Hiding the existence of a workspace from its server.
- Protecting a local file at rest beyond OS disk encryption (an opt-in passphrase is future work).
- Anonymity. Member keys and endpoints are visible to the server.

## Open questions

- Whether a viewer should see the titles of cards outside the shared scope.
- How much metadata the invite and hello messages must carry.
- Whether a server operator can be a non-owner (a hosted node) in v1.
