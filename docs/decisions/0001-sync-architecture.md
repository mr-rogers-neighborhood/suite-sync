# ADR-0001: A user-run server, a transport-agnostic protocol

- Status: accepted
- Date: 2026-11-06

## Context

Suite started as a hosted canvas: a web app, a multi-tenant Loro relay, a control plane with accounts
and billing, and server-side share projections. The rest of the suite is local-first: each app owns a
file, and the hub discovers and launches it. The user wants to stop running a server and let a person
run the sync service on a device they control.

Loro already gives us the hard merge property. The missing piece is identity, membership, transport and
a server that can be run anywhere.

## Decision

- The **document is a file**. The app owns its schema and its file; this repository never defines an
  app document.
- Split the **sync protocol** (`@suite/sync`, pure) from the **transport** (WebSocket, future folder).
- The **primary model is a separate, user-run `suite-sync` server**. Any device can host it; a
  workspace has one active server with a promotion path.
- **No Suite-operated server.** No Suite discovery, relay, control plane or identity provider in the
  default path.
- **Remote reachability** is the user's choice: LAN first, Tailscale/WireGuard documented, the user's
  own domain/tunnel also acceptable.
- **Folder sync is not in v1.** Export/import is the no-server fallback; folder sync is a future
  transport that reuses the same protocol.
- **The server sees ciphertext.** E2E encryption is mandatory for cross-device sync; the local file may
  stay plaintext unless the user opts in.

## Consequences

- The server is a first-class installable piece with its own release, security gate and operations.
- The hub (Start) supervises the server but never proxies document bytes.
- One active server is a single point of failure; the promotion path and export/import fallback must be
  obvious.
- The hosted control plane, auth, billing, relay and web app are retired.
- The folder transport remains a documented option, not a v1 deliverable.
