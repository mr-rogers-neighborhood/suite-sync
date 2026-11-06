# Suite Sync

The sync protocol and the user-run sync/collab server for the Suite family.

Suite operates no server. A person runs `suite-sync` on a device they control — a NAS, a Raspberry Pi,
an always-on computer, a laptop — and their other devices sync with it. The document stays a file the
app owns; this repository owns the wire protocol, the membership model and the headless server.

> **Status: Phase 2 + the first Canvas demo.** The protocol, the Loro adapter, the membership state
> machine, a room, a WebSocket server, a file-backed snapshot store, the workspace bootstrap CLI and
> the `SuiteSyncClient` transport are here. Two Canvas clients can sync one workspace through a local
> server; `pnpm check` covers 87 tests across 14 files.
>
> **Try it:** [Run the Canvas sync demo](docs/how-to/canvas-sync-demo.md).
>
> **Not shippable yet.** The room is plaintext and there is no TLS. `serve` binds to `127.0.0.1` by
> default and must not be exposed beyond a trusted network until the identity/encryption phase
> ([ADR-0005](docs/decisions/0005-blind-server.md)) lands.

## What exists

| Path                | What it is                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | `@suite/sync`: ids, roles, signed membership log, version vectors, wire messages. The root is pure; `./loro` is the Loro adapter. |
| `apps/server`       | `suite-sync`: room, WebSocket transport, file-backed snapshots, workspace bootstrap, CLI.                                         |
| `docs/`             | Protocol, threat model, and the decisions behind them.                                                                            |

## Commands

```sh
pnpm install
pnpm check        # biome, build, typecheck, vitest
pnpm test         # vitest only

pnpm --filter @suite/sync-server build
node apps/server/dist/cli.js --version
node apps/server/dist/cli.js serve --host 127.0.0.1 --port 8787
curl http://127.0.0.1:8787/health

# A workspace directory holds membership.json and a snapshot.loro.
node apps/server/dist/cli.js workspace init /tmp/demo
node apps/server/dist/cli.js workspace show /tmp/demo
node apps/server/dist/cli.js workspace add-member /tmp/demo \
  --member <64-hex> --role viewer --name Viewer
node apps/server/dist/cli.js serve --workspace /tmp/demo
```

## Working on the whole suite

The hub, the sync server and the three apps are developed together from
[`suite-dev`](https://github.com/mr-rogers-neighborhood/suite-dev), which assumes the repositories are
cloned side by side. It stages the real binaries, runs the hub and the sync server together, seeds a
workspace, and owns the cross-app e2e suite. `pnpm preflight` there says what is missing.

## The model in one page

- **The document is a file.** Loro owns the document; this repository never defines an app schema.
- **Ids are fingerprints.** A workspace, device or member id is 64 lower-case hex characters. Deriving
  one from an Ed25519 public key is the crypto layer's job.
- **Membership is a signed, append-only log.** `create`, `invite`, `accept`, `set-role`, `revoke`. Only
  an active owner invites or revokes. A revoke bumps the epoch; the epoch is the group-key epoch.
- **Sync is version vectors.** Two peers exchange `hello` vectors, each sends the updates the other is
  missing, then a transport forwards local updates. [`LoroSyncPeer`](packages/protocol/src/loro/loroPeer.ts)
  is the reference implementation; [`SuiteSyncClient`](packages/protocol/src/loro/suiteSyncClient.ts)
  is the WebSocket client.
- **The server sees ciphertext.** That is the target, not the current room: the Phase 2 room holds a
  plaintext Loro replica so the transport and persistence can be tested. [ADR-0005](docs/decisions/0005-blind-server.md)
  turns the shipped room into a blind store of encrypted updates; the client keeps the only replica
  that can merge.
- **One active server per workspace** in v1, with a promotion path. No server-to-server federation.
- **Snapshots survive a restart.** `FileRoomStore` writes one opaque snapshot per workspace with a
  temp-file rename. Membership state is loaded out of band in Phase 2; the invite/accept path is the
  next step.

Read [the protocol](docs/protocol.md) and [the threat model](docs/threat-model.md).

## Decisions

- [0001 — Sync architecture](docs/decisions/0001-sync-architecture.md)
- [0002 — Identity and membership](docs/decisions/0002-identity-and-membership.md)
- [0003 — Sharing](docs/decisions/0003-sharing.md)
- [0004 — Repository boundary](docs/decisions/0004-repository-boundary.md)
- [0005 — The server is a blind relay](docs/decisions/0005-blind-server.md)

## Licence

MIT, © Suite contributors.
