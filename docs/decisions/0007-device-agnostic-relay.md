# ADR-0007: The relay's host is any device, including a phone

- Status: accepted
- Date: 2026-11-08
- Extends: [ADR-0001](0001-sync-architecture.md), [ADR-0005](0005-blind-server.md)

## Context

ADR-0001 already decided the shape this record would otherwise be inventing: the sync protocol is
pure and split from the transport, any device can host it, and remote reachability is the user's
choice with LAN first. ADR-0005 already made the shipped server blind. Neither is revisited here.

What is new is a device that was not in the room when those were written. Suite Go is a mobile
container with a `ModuleHost` seam and no transport, and the person using it may well prefer their
phone as the device that holds the newest copy. Three questions follow, and only the third is
genuinely undecided by the earlier records:

1. Can the relay run in a WebView? **ADR-0001 says the protocol is pure; it does not say the host is.**
2. May the relay be the phone? **ADR-0001 says any device.**
3. What does "the phone is my relay" honestly promise? **New, and the reason for this record.**

## The measurement

Rather than claim a refactor, this was measured. Node imports per package:

| Package             | `node:` imports   | Verdict                                               |
| ------------------- | ----------------- | ----------------------------------------------------- |
| `packages/protocol` | **0**             | Already pure, as ADR-0001 required                    |
| `packages/host`     | 9, in three files | Port-and-adapter already; the adapters are Node-bound |
| `apps/server`       | 1 (`node:url`)    | Argument parsing only                                 |

The nine are concentrated exactly where an adapter belongs:

- `store.ts` — `fs/promises` and `path`, in `FileHostStore` only. **`HostStore` is already an
  interface**, with `MemoryHostStore` beside it, so the port predates this record.
- `crypto.ts` — `node:crypto` for sha256 and ed25519 verification. The adapter for WebCrypto.
- `server.ts` — `node:http` `createServer`. The adapter for WebSocket.

So the extraction is not a rewrite. The ports exist and at least one non-Node implementation of each
already ships, which is what made testing possible in the first place.

## Decision

- **The relay core keeps no Node, `fs` or process assumption.** `HostStore`, the verifier and the
  transport stay ports. Anything Node-specific is an adapter, and no adapter is imported by
  `packages/protocol`.
- **Two host adapters are the target**: desktop (filesystem, `node:http`) and Capacitor
  (OPFS or SQLite, WebSocket). Neither is required to read the other's storage.
- **Any device may hold the relay, chosen per session.** Reachability is a property of the
  deployment, not of the code: whichever device is awake and on the network takes the role. The
  promotion path in ADR-0001 already covers handover.
- **The reach is LAN, while the host is awake.** This is the promise, and it is deliberately the
  smallest honest one. A rendezvous can be added later without touching the protocol, because the
  protocol never sees a transport (ADR-0001) and never sees a document (ADR-0005).
- **The relay stays blind.** Opaque records; the routing header ADR-0005 already permits. Nothing
  here adds metadata.

## What a phone cannot do, said plainly

- **It cannot be reached from outside its network.** Cellular carriers put many subscribers behind
  one address, so there is no door. Two devices on the same Wi-Fi can connect; two on different
  networks cannot without a rendezvous, and a rendezvous needs a host with a stable address.
- **It stops when suspended.** Android suspends a WebView's work when the app leaves the foreground.
  Hosting peers while backgrounded needs a foreground service, which is a visible commitment
  (notification, battery) and is **not** part of this decision.
- **"Always my relay" is therefore not a thing this can promise.** The honest sentence is: _the
  relay is whichever device is awake and on the same network; sync happens on reconnect._

That last line is the whole content of this record. A person who expects their phone to serve their
desktop from a train will be disappointed, and the documentation should say so before they try.

## Consequences

- `packages/host` gains no new Node import. A review of that package is now a review of whether the
  relay could run elsewhere.
- The Capacitor adapters are future work with a defined boundary: one store, one verifier, one
  transport. None of them requires changing `packages/protocol`.
- Folder sync (ADR-0001's "future transport") becomes cheaper, because it is one more adapter over
  the same ports.
- No code changes in this phase. This record exists so the mobile work has something to build
  against that is not a guess.

## Alternatives considered

- **Rendezvous now.** Rejected: it requires infrastructure the project does not run, and ADR-0001
  already put reachability in the user's hands.
- **A foreground service now.** Rejected as a decision, not as an idea. It changes what the app asks
  of a phone (a permanent notification) and belongs with the host adapters, not ahead of them.
- **Rewrite the server as a cross-platform library.** Rejected on the measurement: there is nothing
  to rewrite. The ports exist; only adapters are missing.
