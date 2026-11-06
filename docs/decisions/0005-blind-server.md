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

- Clients encrypt each Loro update with the workspace epoch key before it leaves the device.
- The server stores and forwards opaque encrypted records. It may store a header with the workspace,
  member/device, epoch and a client-supplied ordering/version hint; it does not decrypt the body.
- **Clients exchange version vectors end-to-end.** The server does not compute Loro diffs, merge,
  index, search or project.
- Membership and role checks use the signed membership log plus a capability on the connection, not
  document content.
- Attachments are encrypted, content-addressed blobs; the server never renders them.
- Presence is an encrypted ephemeral channel and is never persisted.
- The Phase 2 plaintext `SyncRoom` is a development transport. It is not the shipped server and must
  not be exposed beyond a trusted network.

## Consequences

- The server cannot validate Loro semantics. A malicious client can send garbage; clients validate and
  ignore what does not parse.
- Clients must handle out-of-order and pending updates and request missing ranges. The server can
  enforce a maximum record size and a total workspace budget without reading content.
- The server still enforces membership, role and epoch; those are headers/capabilities, not content.
- Metadata (workspace id, member key, sizes, timing) is visible. The threat model accepts that.
- Server-side search, projection and share rendering are impossible; those move to trusted clients or
  to a generated static export.
- The version-vector exchange is a client-to-client concern; the server is a mailbox with fan-out.
