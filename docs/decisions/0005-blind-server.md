# ADR-0005: The shipped server is a blind relay

- Status: accepted
- Date: 2026-11-06

## Context

The Phase 2 transport keeps a plaintext `LoroDoc` per room so it can compute version-vector diffs and
validate updates. That is useful for testing the transport and persistence, but it contradicts the
product rule: the server must not read document content.

End-to-end encryption cannot be bolted onto that room. If the server holds the key, it can read; if it
does not, it cannot merge or diff the document for the client.

## Decision

The shipped server is a **blind relay**:

- Clients encrypt each Loro update before it leaves the device. **The key comes from the MLS group's
  own key schedule**, not from an epoch key this design invents: see
  [ADR-0006](0006-mls-transport.md), which replaces the "workspace epoch key" this record originally
  described. An epoch is an MLS epoch, and it advances when membership does.
- The server stores and forwards opaque encrypted records. It may store a header with the workspace,
  member/device, epoch and a client-supplied ordering/version hint; it does not decrypt the body.
- **Clients exchange version vectors end-to-end.** The server does not compute Loro diffs, merge,
  index, search or project.
- Membership is the MLS group ([ADR-0006](0006-mls-transport.md)); the host reads epochs and handshake
  frames but not their contents. Role checks use a signed role record and a capability on the
  connection. Neither reads document content.
- Attachments are encrypted, content-addressed blobs; the server never renders them.
- Presence is an encrypted ephemeral channel and is never persisted.
- The Phase 2 plaintext `SyncRoom` is a development transport. It is not the shipped server and must
  not be exposed beyond a trusted network.

## Consequences

- The server cannot validate Loro semantics. A malicious client can send garbage; clients validate and
  ignore what does not parse.
- Clients must handle out-of-order and pending updates and request missing ranges. The server can
  enforce a maximum record size and a total workspace budget without reading content.
- The server still enforces role and epoch; those are a signed record and a header, not content. It
  cannot verify document semantics, and it cannot tell a well-formed MLS commit from a plausible one
  without being a member — so a client must treat every frame it receives as hostile input.
- Metadata (workspace id, member key, sizes, timing) is visible. The threat model accepts that.
- Server-side search, projection and share rendering are impossible; those move to trusted clients or
  to a generated static export.
- The version-vector exchange is a client-to-client concern; the server is a mailbox with fan-out.
