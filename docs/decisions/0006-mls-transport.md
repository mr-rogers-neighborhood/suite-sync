# ADR-0006: The group is MLS, and the host is not in it

- Status: accepted
- Date: 2026-11-06
- Supersedes part of: [ADR-0005](0005-blind-server.md) — the "workspace epoch key" clause

## Context

[ADR-0005](0005-blind-server.md) says the shipped server is a blind relay and that clients encrypt
each update "with the workspace epoch key". It does not say where that key comes from, how it rotates,
or how a device that joins later gets it. Writing that by hand means designing a key schedule: an
epoch per membership change, a sender ratchet so two devices cannot reuse a nonce, a welcome path for
the new device, and a way to revoke without rekeying everything by message.

MLS is that design, standardised and attacked in public. The question was never whether MLS is the
right shape; it is whether an implementation runs here, and what its sharp edges are.

## The spike

`ts-mls@1.6.4` against Node 26, no native build step, two devices, one group. The script is throwaway;
these numbers are what the decision rests on.

| Measured | Result |
| --- | --- |
| Forms a group, adds a device, both report epoch 1 | yes |
| An application message round-trips | yes, plaintext recovered |
| Group state survives `encodeGroupState` / `decodeGroupState` | 1.6 kB, decodes with nothing trailing |
| `mlsExporter` produces a workspace key | 32 bytes |
| Commit on the wire | 0.5 kB |
| Welcome on the wire | 0.8 kB |
| Application message on the wire | 0.3 kB |
| A competing commit from the same epoch, arriving late | **not an error** — silently absorbed, epoch unchanged |

Two things the spike found that a document would not have:

- **The Welcome must carry the ratchet tree.** `createCommit` without `ratchetTreeExtension: true`
  produces a Welcome that `joinGroup` refuses, because the joiner has no tree to be given. A blind host
  holds no tree, so every commit that adds a device must set it. The cost is in the 0.8 kB above.
- **A stale commit is not rejected.** A commit whose epoch has already passed is decrypted with the
  retained receiver data and applied as an application message, not refused. Nothing in the library
  will notice that two devices committed from the same epoch. The client has to compare epochs itself
  and throw the frame away, which is why the frame carries one.

`ts-mls` needs `@noble/hashes` alongside its declared `@hpke/core`; install one without the other and
the first import fails. A pure-TypeScript implementation still has dependencies worth pinning.

## Decision

**The MLS group is the membership.** Not a second list beside it.

- One group per workspace. A device is an MLS leaf. The epoch is MLS's epoch.
- `membership.ts` keeps only what MLS does not model: a signed **role record** per member
  (`owner` / `editor` / `viewer`), which travels outside the group content so the host can refuse a
  write without reading one. Authorship is a device-key signature on each frame.
- `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`, the mandatory-to-implement ciphersuite. One choice,
  no negotiation, no downgrade surface.
- **The host is not a member** and holds no group secret. It orders frames, stores them, forwards them.
- **The key schedule lives in the main process** of whichever app owns the document, never in a
  renderer, so one implementation serves all three apps and no injected script is one bug away from a
  group secret.
- **Every frame carries its epoch**, and a client ignores a frame that is not for the epoch it is in.
  The spike is the reason this is a rule rather than a hope.
- Metadata the host may see: workspace id, device id, epoch, frame size, arrival time. Titles and file
  names travel **inside** the ciphertext.

## Consequences

- A rejected committer loses nothing. Loro converges independently of the key layer, so the loser
  re-sends its work as application messages in the epoch it is actually in. This is why the document
  format and the transport can be chosen separately.
- Compaction gets simpler and stranger: the host can drop frames it has forwarded, because it cannot
  merge them, so a client that was offline past the retention window needs a snapshot from a peer
  rather than a replay from the host.
- Group state is per device and must be durable. Losing it is losing the ability to decrypt, which
  makes the recovery kit the only safety net, and makes it a ceremony rather than a menu item.
- No server-side search, projection or share rendering. Those already moved to the client in ADR-0005.
- The ciphersuite is fixed for the life of a group. Changing it is a new group, not an upgrade.

## Deferred, not forgotten

- **Attachments.** ADR-0005 says encrypted, content-addressed blobs. The key they are addressed with is
  not decided.
- **Retention and compaction**, per the consequence above.
- **Host promotion**: who may take over when the host machine is gone, and how a client learns the new
  address.
- **Recovery**: MLS has no escrow. The kit is a decision about what to export, not a library call.
