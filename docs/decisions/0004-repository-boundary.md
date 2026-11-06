# ADR-0004: A dedicated suite-sync repository

- Status: accepted
- Date: 2026-11-06

## Context

The sync server is a new shared component across Canvas, Planner and Budget. It could live in
`suite-start` (the hub and shared packages) or in `suite-canvas` (the first app that needs it), or in
its own repository.

The server is a separate trust boundary and a separate release artifact. The suite already consumes
shared packages from a git tag: `@suite/contracts` and `@suite/files` live in `suite-start` and apps pin
a tag.

## Decision

- Create a dedicated **`suite-sync`** repository, published to GitHub when ready.
- Layout: `packages/protocol` (`@suite/sync`), `packages/client` (`@suite/sync-client`),
  `apps/server` (`suite-sync`), `docs/`, `e2e/`.
- Apps and Start consume the packages at a git tag, following the existing pattern.
- The server binary is a signed GitHub Release artifact; Start supervises it where present, and Linux
  hosts get a systemd unit.
- Do not put the server in `suite-canvas`: the other apps would depend on the canvas repository, which
  inverts the suite's dependency direction.

## Consequences

- One more repository to release and one more compatibility matrix (protocol vs app contract).
- The server gets its own gate: protocol conformance, fuzzing, crypto review, threat model and soak
  tests.
- `suite-start` stays small and keeps its rule: it never holds or proxies document bytes.
- The server can be replaced without touching an app, as long as the protocol and capability are
  honoured.
