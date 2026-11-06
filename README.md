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

---

Developer note:

**What is Suite?**

Suite is a collection of applications, a relay for sync and collaboration, and a toolbox for updating and managing your applications.

This architecture came from trying basically every application worth trying in its respective space and being left wanting. I can't claim to have replaced these applications, but I'm building my own that provide the feature sets I need. They're released open-source under the MIT license, local-first, and easy to install and manage from your own computer. Mobile applications are out of scope for now, but will come once there's a solid foundation. If these applications are useful to you, you're free to use them however you'd like, or fork and develop them into your own suite.

Applications I've tested in the past include knowledge management tools and outliners such as Obsidian, Notion, Capacities, Heptabase, Tana, Logseq, and AnyType. They also include planners and task management tools such as Sunsama, Akiflow, Todoist, and TickTick, as well as budgeting applications such as YNAB and Actual.

Each of these has something going for it that the others don't, and every one is missing a critical set of capabilities I'd want from that kind of application: a simple, local-first, integrated sync service, and flexible, deep collaboration features. Some are free and open-source, even local-first; others are tied entirely to the cloud and an internet connection. None contain the exact set of capabilities I want for a visual note-taking and research application.

That led to Suite Canvas, originally the only application in the collection. Suite Canvas combines the typed-object-graph model from apps like Capacities with the canvas-driven, research-oriented experience of Heptabase. It takes smaller influences from other applications on the list, and from some that aren't (such as a generalized version of Tana's Supertags). It's the most mature of the bunch, though still very much in alpha.

I've tried to build something like Canvas several times, and each attempt hit scope creep or a design wall that led me to abandon or restart it. Approaches that didn't work out:

- **Canvas as a CMS.** A tool for thinking always becomes constrained by the language and thought process of web design. People don't think in routes or views, and mashing the two languages together produced something confusing and not worth using. Adding mapping between the CMS and the canvas didn't help either (I carried over, and still maintain, many architectural ideas from WordPress plugins like Advanced Custom Fields, Metabox, and Pods). It was clunky and felt like using two separate applications that don't mix.
- **Infinite canvas.** It seems ideal, and I love the infinite-zoom drawings people make. I tried ICE, an experimental canvas engine, and PixiJS. Both looked striking and had genuinely impressive features (ICE let you arrange cards fractally, for example), but they were complexity tar pits that forced the entire application design to contort around them. That's before getting into accessibility, sync and collaboration, and also navigation: it predictably makes it very easy to get lost. Good for art, not clear that it is good for a structured thinking tool. I did end up integrating excalidraw, via the "Sketch" card type and embed, so you maintain the important bit of being able to draw and sketch on an infinite canvas, and then embed it in your non-infinite canvas. I also added the "Portal" card type, a way to link from one canvas board to another. These were more comprehensive and easily justified expansions.
- **No-code/low-code systems and computational notebook features.** These seem ideal too, but they cause both classes of problems above and worse ones. You lose the ability to arbitrarily rearrange your thoughts, because your links and cards now mean something beyond simple data. The result can be as striking as an infinite canavas (I even had links animate to show you the data-flow directly), but in my attempts it wasn't useful, just looked cool.

None of these experiments were pointless. Each revealed insights I didn't have before and taught me something about software design.

Suite Planner, Suite Budget, and the surrounding tooling (Suite Start and Suite Sync) came from realizing I can't fit all of these application types onto a canvas interface. I tried, and hit the the third design wall mentioned above. It was too complex, too deep, and too over-engineered to be functional and usable, let alone shippable.

So the applications are split into three that match their domains. A canvas is a thinking and research tool. A planner is a task, project management, and calendaring tool. A budget is a budgeting tool. I plan to experiment with integrations (embedding your calendar or budget into your canvas, or attaching your canvas to your calendar or budget, for example), but those features need to be considered deeply to actually be useful.

In the end, you should have a canvas, a planner, and a budget: all simple and easy to use, all with integrated and easy-to-run sync and update services, and none of them requiring you to connect to a centralized server or cloud service to use, at all. That's what will make Suite pretty sweet.

---

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
