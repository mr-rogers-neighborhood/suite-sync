# The Suite sync protocol

This is the contract between a Suite app, the `suite-sync` server and another member's app. It is
deliberately small: the hard parts are identity, membership and key recovery, not the delta exchange.

## Goals

- Let two or more devices converge on one Loro document after arbitrary offline edits.
- Let a user run the server on a device they own, without a Suite-operated service.
- Enforce owner/editor/viewer roles at the server, not only in the UI.
- Keep the server unable to read document content.
- Keep presence ephemeral and separate from the document.

## Non-goals

- Defining an app's document schema. That belongs to the app.
- Being a general-purpose file sync or backup product.
- Server-to-server federation in v1.
- Public web editing. A member needs the app and an invite.

## Identity

An id is a 32-byte fingerprint encoded as 64 lower-case hex characters.

| Id            | What it names                 | How it is made (Phase 4)            |
| ------------- | ----------------------------- | ----------------------------------- |
| `workspaceId` | One Loro document / workspace | SHA-256 of the workspace public key |
| `deviceId`    | One installation              | SHA-256 of the device public key    |
| `memberId`    | One member                    | SHA-256 of the member public key    |
| `inviteId`    | One invite                    | Random 32 bytes                     |

In v1, **each device is a member**. A person with a laptop and a desktop has two member records, each
with its own key and role. This avoids delegated device keys while still giving the user a clean
revocation story. Per-person members with device sub-keys can come later behind the same log.

## Membership log

The log is append-only, ordered by `seq`, and signed by the actor. The first entry must be `create`.

| Action     | Who may sign      | Effect                                                                                          |
| ---------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `create`   | The owner's key   | Records the owner and `ownerPublicKey`. Refuses a second create.                                |
| `invite`   | An active owner   | Records a pending invite with the invitee's public key, role (`editor`/`viewer`) and expiry.    |
| `accept`   | The invitee's key | Turns a pending invite into an active member. The invite must be unexpired and unused.          |
| `set-role` | An active owner   | Changes an editor/viewer role. The owner cannot be demoted in v1.                               |
| `revoke`   | An active owner   | Marks the member revoked and increments the epoch. Pending invites for that member are revoked. |

Rules enforced by `applyMembershipEntry`:

- `seq` must be the next number.
- The workspace must match.
- The signature must verify against the key the action names (owner, actor or invitee).
- Only an active owner invites, changes roles or revokes.
- The owner cannot be demoted, revoked or self-revoked in v1.
- A revoked member is inactive and cannot act.
- `revoke` bumps `epoch`; that is the signal to rotate the group key.

The signature payload is canonical JSON of `{seq, workspaceId, actorId, createdAt, action}`, with keys
sorted. The `signature` field is excluded.

## Sync messages

All messages are JSON; the update payload is base64.

```ts
type SyncMessage =
  | { type: "hello"; protocolVersion; workspaceId; memberId; deviceId; epoch; versionVector }
  | { type: "update"; workspaceId; from; to; epoch; payload }
  | { type: "ack"; epoch; versionVector }
  | { type: "error"; code; message };
```

### First sync

1. Both sides send `hello` with their version vector.
2. Each side computes the updates the other is missing and sends one or more `update` messages.
3. Each side sends `ack` with its new version vector.
4. The transport forwards local updates as `update` messages and presence as a separate ephemeral
   channel.

### Reconnect

The same exchange, using the version vector the client already has. Loro's `export({mode: "update",
from})` sends the diff, not the whole history.

### Presence

Presence is not in the durable message set. It uses a separate ephemeral channel with a time to live;
a dropped connection must not leave a ghost cursor. A position is persisted only when the reader
releases the drag, which is a normal document write.

## Server transport (Phase 2 slice)

The current transport is a WebSocket at `/sync` with a `/health` HTTP route.

- `hello` must be the first message. It carries the protocol version, workspace, member, device, epoch
  and version vector. The server answers `ack` and, when the client is behind, one `update`.
- `update` is accepted only from the socket's joined member, only for the joined workspace, and only
  for the current epoch. The server applies it, answers `ack`, and forwards it to the other sockets in
  the same room.
- `error` codes: `protocol-version`, `unauthorized`, `forbidden`, `epoch-mismatch`, `malformed`,
  `busy`, `unknown`.
- The server binds to `127.0.0.1` by default; `--host` is explicit. There is no TLS yet.
- A room snapshot is written to a file with a temp-file rename and loaded on the next boot.
- `serve --workspace <dir>` loads a Phase 2 workspace directory: `membership.json` (the serialized
  membership state) and an optional `snapshot.loro` (a full Loro snapshot). The membership file is
  trusted admin input for now; the signed log and the invite/accept path replace it next.

**The Phase 2 room is plaintext and is a development transport.** The shipped server is a blind relay
per [ADR-0005](../decisions/0005-blind-server.md): encrypted updates, client-side version vectors, no
server-side merge.

## Security invariants (target)

1. The server never holds the workspace key in plaintext.
2. The server never decrypts a document update or an attachment.
3. A join is authorized by a signed member record and a capability; a workspace id is not a secret.
4. A viewer cannot write, even if the client is modified; the server refuses the update.
5. A revoked member's next join is refused and their live connection is dropped.
6. Presence is never written to the document.
7. A server operator can deny service or delete ciphertext; the threat model says so.

The Phase 2 plaintext room satisfies 3–6 but not 1–2. It is loopback-only until ADR-0005 lands.

## Open questions

- Retention and compaction: how many update logs, snapshots and daily backups.
- Attachment transport: content-addressed blobs vs a `.canvas` bundle.
- Invite transport: QR + short code, and how the endpoint hints travel.
- Host promotion: who may promote a new active server, and how clients discover it.
- Metadata: what the server may learn about workspace size and member activity.
