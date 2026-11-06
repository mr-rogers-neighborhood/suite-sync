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

## Membership

Membership is the MLS group ([ADR-0006](decisions/0006-mls-transport.md)). There is no second member
list: a device is a leaf, and the epoch is MLS's epoch. Adding a device is a Commit, removing one is a
Remove proposal, and a device that joins receives a Welcome that carries the ratchet tree because the
host holds none to hand over.

The host orders and stores handshake frames. It is not a member, holds no group secret, and cannot
read what it stores.

## Role records

MLS says who is in the group, not who may write. A **role record** per device travels beside the group:

```ts
type RoleRecord = { workspaceId; deviceId; role: "owner" | "editor" | "viewer"; seq; signature };
```

It is signed by an owner's device key and ordered by `seq`, so the host can check `role !== "viewer"`
before it stores a frame without decrypting one. Authorship is a device-key signature on each frame,
which lets a reader attribute a change without trusting the host's ordering.

Rules:

- Only an owner's device may write a role record, and only for a device already in the group.
- A viewer's frames are refused by the host, not merely discouraged in a UI.
- Revoking a device is a Remove commit; the new epoch makes the revoked device unable to read anything
  that follows, and the host drops its connection.
- The last owner cannot be demoted or removed. Ownership transfer is out of scope until there is a
  two-owner story.

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

## The frame

The host stores one opaque record per message. It can read the header and nothing else.

```ts
type Frame = {
  kind: "commit" | "welcome" | "application"; // application = a document update
  workspaceId: string;
  deviceId: string; // who sent it, and whose signature it carries
  epoch: number; // the MLS epoch the sender was in
  payload: string; // base64 of the encoded MLS message
  signature: string; // device key over the header and payload
  receivedAt: string; // stamped by the host
};
```

**A client ignores a frame whose epoch is not the one it is in.** The library does not do this: the
spike showed a commit from an already-passed epoch is quietly absorbed as an application message
rather than refused ([ADR-0006](decisions/0006-mls-transport.md)). The receiver holds the epoch
comparison, and the host refuses to store a frame whose epoch is older than the workspace's.

Sizes, measured rather than estimated: a commit is 0.5 kB, a welcome 0.8 kB, an application message
0.3 kB, and a device's group state 1.6 kB.

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

- Retention and compaction: how many frames, snapshots and daily backups. The host cannot merge what
  it stores, so a client offline past the window needs a snapshot from a peer.
- Attachments: content-addressed blobs, and which key addresses them.
- Host promotion: who may take over when the host machine is gone, and how a client learns the new
  address.
- Recovery: MLS has no escrow, so the kit is a design decision about what to export, not a library
  call.
