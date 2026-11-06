# Run the Canvas sync demo

This is the first end-to-end demo: two Canvas clients, one user-run `suite-sync` server, account-free
members, real document updates. It is a **development transport**: plaintext, loopback-only, no TLS,
no attachments, no presence. Do not expose it beyond a trusted machine.

## 1. Create a workspace

From `suite-sync`:

```sh
pnpm --filter @suite/sync-server build
node apps/server/dist/cli.js workspace init /tmp/suite-sync-demo
```

The command prints the workspace id, the owner id and the editor id. Keep them. It writes:

```
/tmp/suite-sync-demo/membership.json
/tmp/suite-sync-demo/snapshot.loro
```

Use fixed ids if you want a copy-paste recipe:

```sh
WS=$(printf '1%.0s' {1..64})
OWNER=$(printf '2%.0s' {1..64})
EDITOR=$(printf '3%.0s' {1..64})
node apps/server/dist/cli.js workspace init /tmp/suite-sync-demo \
  --workspace "$WS" --owner "$OWNER" --editor "$EDITOR" --force
```

## 2. Serve it

```sh
node apps/server/dist/cli.js serve --workspace /tmp/suite-sync-demo --port 8787
curl http://127.0.0.1:8787/health
# {"ok":true,"rooms":1,"clients":0}
```

The server writes the room snapshot back to `snapshot.loro`; a restart keeps the document.

## 3. Web standalone: two tabs

In `suite-canvas`:

```sh
pnpm --filter @suite/canvas dev:standalone -- --port 5173
```

Open two tabs, using the ids the workspace printed:

```text
http://localhost:5173/?workspace=<WS>&fresh=1&syncUrl=ws://127.0.0.1:8787/sync&member=<OWNER>&epoch=1
http://localhost:5173/?workspace=<WS>&fresh=1&syncUrl=ws://127.0.0.1:8787/sync&member=<EDITOR>&epoch=1
```

- The first tab seeds the workspace and sends it to the server.
- The second tab catches up from the server.
- Create or edit a card in one tab; the other receives it.
- `GET /health` should report `clients: 2`.

The app rewrites its URL to the active board, so the sync parameters are cached in `sessionStorage`
for the tab. Reloading the page keeps the same member.

## 4. Desktop: two copies of one workspace

This is the same transport in the Electron shell.

1. In Canvas desktop, create a workspace and save it as `Demo.canvas`.
2. Create a sync workspace from that file:

   ```sh
   node apps/server/dist/cli.js workspace init /tmp/suite-demo-desktop \
     --from-canvas ~/Documents/Suite/Canvas/Demo.canvas
   ```

   The command prints the 64-hex sync workspace id. A non-hex app id is hashed to one.
3. Copy `Demo.canvas` to `Demo-b.canvas`. Both files carry the same workspace id, so they are two
   local copies of one sync unit.
4. Start the server with the directory it printed.
5. Launch two desktop instances, each with its own Electron data directory and member:

   ```sh
   SUITE_SYNC_URL=ws://127.0.0.1:8787/sync \
   SUITE_SYNC_MEMBER=<OWNER> \
   SUITE_SYNC_WORKSPACE=<sync-workspace-id> \
   SUITE_SYNC_EPOCH=1 \
   pnpm --filter @suite/desktop start -- --user-data-dir=/tmp/suite-desktop-a

   SUITE_SYNC_URL=ws://127.0.0.1:8787/sync \
   SUITE_SYNC_MEMBER=<EDITOR> \
   SUITE_SYNC_WORKSPACE=<sync-workspace-id> \
   SUITE_SYNC_EPOCH=1 \
   pnpm --filter @suite/desktop start -- --user-data-dir=/tmp/suite-desktop-b
   ```

   Each instance opens its own copy of the file. The one-writer lock is per path, so two copies are
   required; the server room is the one sync workspace id.

## What to look for

- `Saved` in the title bar means the local file was written.
- With sync enabled, the "Local only" label is gone.
- `/health` shows two clients.
- A card created or renamed in one window appears in the other.
- Stop the server and start it again: the next client catches up from `snapshot.loro`.

## Known limits

- Plaintext, loopback-only, no TLS. This is not the shipped security model; see
  [ADR-0005](../decisions/0005-blind-server.md).
- No presence/cursors and no attachment bytes in this phase.
- The membership file is a Phase 2 admin shape, not the signed invite/accept flow.
- The web tabs share one browser origin and IndexedDB. Use a fresh workspace id when you want a clean
  first-sync test.
