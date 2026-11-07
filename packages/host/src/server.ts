import { createServer } from "node:http";
import {
  addInvite,
  applyRemovalRecord,
  applyRoleRecord,
  createInviteState,
  createRemovalState,
  createRoleState,
  encodeRelayMessage,
  ephemeralPayload,
  hasRole,
  type InviteRecord,
  type InviteState,
  isRelayCompatible,
  isRemoved,
  liveInvite,
  type MemberRole,
  parseClientMessage,
  RELAY_PROTOCOL_VERSION,
  type RelayClientMessage,
  type RelayMember,
  type RemovalRecord,
  type RemovalState,
  type RoleRecord,
  type RoleState,
  type RoleVerifier,
  reinstateDevice,
  spendInvite,
} from "@suite/sync";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { admitFrame, FrameLog, type FrameVerifier } from "./blindRoom.js";
import { FileHostStore, type HostStore, type PinnedKey } from "./store.js";

/**
 * The host: a mailbox with an opinion about who may post.
 *
 * It accepts frames, numbers them, writes them down and hands out the ones a client has
 * not seen. It answers no question about a document, because it cannot read one.
 */
export interface HostedRoom {
  readonly workspaceId: string;
  readonly log: FrameLog;
  roles: RoleState;
  /** Invitations an owner wrote. A live one lets exactly one key package through. */
  invites: InviteState;
  /** Devices an owner has taken out, and when. */
  removals: RemovalState;
  /**
   * Each device's key and the name it introduced itself with.
   *
   * The key is what makes verification possible after a restart; the name is what makes the
   * device recognisable to the person deciding whether to let it in, and the invitation it
   * spent is what answers "as what".
   */
  readonly keys: Map<
    string,
    {
      readonly publicKey: string;
      readonly name: string;
      readonly invitedWith?: { readonly inviteId: string; readonly role: MemberRole };
    }
  >;
  readonly sockets: Set<WebSocket>;
}

export class HostRegistry {
  private readonly rooms = new Map<string, HostedRoom>();

  add(room: HostedRoom): void {
    this.rooms.set(room.workspaceId, room);
  }

  get(workspaceId: string): HostedRoom | undefined {
    return this.rooms.get(workspaceId);
  }

  list(): readonly HostedRoom[] {
    return [...this.rooms.values()];
  }

  get size(): number {
    return this.rooms.size;
  }
}

export interface SyncServerOptions {
  readonly registry: HostRegistry;
  /** 0 asks the operating system for a free port; useful in tests. */
  readonly port?: number;
  readonly host?: string;
  readonly store?: HostStore;
  /** Device key check for incoming frames, against the key the device joined with. */
  readonly verifyFrame: FrameVerifier;
  /** The same check for role records. */
  readonly verifyRole: RoleVerifier;
  /** How long a frame is kept. A device away longer needs a snapshot from a peer. */
  readonly retentionDays?: number;
  readonly now?: () => Date;
}

export interface SyncServer {
  readonly host: string;
  readonly port: number;
  /** `ws://host:port/sync` */
  readonly url: string;
  close(): Promise<void>;
}

interface SocketContext {
  readonly room: HostedRoom;
  readonly deviceId: string;
}

const DEFAULT_RETENTION_DAYS = 30;

export async function createSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const store = options.store ?? new FileHostStore(".suite-sync");
  const now = options.now ?? (() => new Date());
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const registry = options.registry;

  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          workspaces: registry.size,
          clients: wss.clients.size,
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found\n");
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/sync" });
  const contexts = new WeakMap<WebSocket, SocketContext>();
  const loading = new Map<string, Promise<HostedRoom>>();

  /**
   * Load a workspace, or find the one already running.
   *
   * Roles and keys are replayed before anything else can be judged: a room that came back
   * with an empty role list would refuse every frame, which looks exactly like a broken
   * workspace rather than a forgotten file.
   */
  async function roomFor(workspaceId: string): Promise<HostedRoom> {
    const existing = registry.get(workspaceId);
    if (existing !== undefined) return existing;

    const pending = loading.get(workspaceId);
    if (pending !== undefined) return pending;

    const created = (async () => {
      const room: HostedRoom = {
        workspaceId,
        log: new FrameLog(workspaceId),
        roles: createRoleState(workspaceId),
        invites: createInviteState(workspaceId),
        removals: createRemovalState(workspaceId),
        keys: new Map(),
        sockets: new Set(),
      };

      for (const frame of await store.loadFrames(workspaceId)) room.log.append(frame);
      room.log.dropOlderThan(cutoffIso(now(), retentionDays));

      for (const key of await store.loadKeys(workspaceId)) {
        room.keys.set(key.deviceId, {
          publicKey: key.publicKey,
          name: key.name,
          ...(key.invitedWith === undefined ? {} : { invitedWith: key.invitedWith }),
        });
      }
      for (const record of await store.loadRoles(workspaceId)) {
        const applied = applyRoleRecord(room.roles, record, roleVerifierFor(room));
        if (applied.ok) room.roles = applied.state;
      }
      for (const record of await store.loadRemovals(workspaceId)) {
        const applied = applyRemovalRecord(
          room.removals,
          record,
          roleVerifierFor(room),
          (deviceId) => room.roles.roles[deviceId] === "owner",
        );
        if (applied.ok) room.removals = applied.state;
      }

      registry.add(room);
      return room;
    })();

    loading.set(workspaceId, created);
    try {
      return await created;
    } finally {
      loading.delete(workspaceId);
    }
  }

  function roleVerifierFor(room: HostedRoom): RoleVerifier {
    return (payload, signature, signerId) => {
      const key = room.keys.get(signerId);
      return key !== undefined && options.verifyRole(payload, signature, key.publicKey);
    };
  }

  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      void handleMessage(socket, data);
    });
    socket.on("close", () => {
      contexts.get(socket)?.room.sockets.delete(socket);
    });
  });

  async function handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    const message = parseClientMessage(safeJson(rawText(data)));
    if (message === null) {
      sendError(socket, "malformed", "that is not a relay message");
      return;
    }

    if (message.type === "join") {
      await handleJoin(socket, message);
      return;
    }

    const context = contexts.get(socket);
    if (context === undefined) {
      sendError(socket, "not-joined", "join before sending anything else");
      return;
    }

    switch (message.type) {
      case "invite":
        await handleInvite(socket, context, message.record);
        return;
      case "keypackage":
        await handleKeyPackage(socket, context, message);
        return;
      case "role":
        await handleRole(socket, context, message.record);
        return;
      case "ephemeral":
        handleEphemeral(socket, context, message);
        return;
      case "removal":
        await handleRemoval(socket, context, message.record);
        return;
      case "frame":
        await handleFrame(socket, context, message.frame);
        return;
      case "since":
        handleSince(socket, context, message.after);
        return;
    }
  }

  async function handleJoin(socket: WebSocket, message: RelayClientMessage): Promise<void> {
    if (message.type !== "join") return;
    if (contexts.has(socket)) {
      sendError(socket, "malformed", "this socket has already joined");
      return;
    }
    if (!isRelayCompatible(message.protocolVersion)) {
      sendError(socket, "protocol-version", `this host speaks protocol ${RELAY_PROTOCOL_VERSION}`);
      return;
    }

    const room = await roomFor(message.workspaceId);
    const pinned = room.keys.get(message.deviceId);
    if (pinned !== undefined && pinned.publicKey !== message.publicKey) {
      // The same device id with a different key is either a reinstall or an impersonation.
      // Either way the host cannot tell them apart, so it refuses rather than pick.
      sendError(socket, "unknown", "that device id is already pinned to another key");
      return;
    }
    if (pinned === undefined) {
      room.keys.set(message.deviceId, { publicKey: message.publicKey, name: message.name });
      await store.appendKey(message.workspaceId, {
        deviceId: message.deviceId,
        publicKey: message.publicKey,
        name: message.name,
      });
    }

    if (isRemoved(room.removals, message.deviceId)) {
      // It reconnected. Say which happened rather than letting it sit on "the host is not
      // answering", which would offer a retry that can never work — unless it is holding an
      // invitation, in which case somebody has asked it back and the door is the invitation.
      const held = message.inviteId;
      const live = held === undefined ? null : liveInvite(room.invites, held, now());
      if (live === null || !live.ok) {
        send(socket, { type: "removed" });
        socket.close();
        return;
      }
    }

    contexts.set(socket, { room, deviceId: message.deviceId });
    room.sockets.add(socket);

    send(socket, {
      type: "joined",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId: room.workspaceId,
      newestEpoch: room.log.newestEpoch,
      frames: room.log.length,
      members: rosterOf(room),
    });

    // Anyone who asked to be let in while nobody was listening. A key package is replayed from
    // the log on every connect, but the invitation that authorised it was announced once, to
    // whoever happened to be connected; this is what makes a join that waited resume instead
    // of stalling in silence.
    for (const [deviceId, key] of room.keys) {
      if (key.invitedWith === undefined || room.roles.roles[deviceId] !== undefined) continue;
      send(socket, {
        type: "waiting",
        deviceId,
        name: key.name,
        inviteId: key.invitedWith.inviteId,
        role: key.invitedWith.role,
      });
    }
  }

  /**
   * Who the host will accept a frame from, and what each of them may do.
   *
   * A device with a pinned key but no role is waiting to be let in rather than here, so the
   * roster is built from roles and named from pins. Nothing is read to produce it: these are
   * the two tables the host keeps in order to admit anything at all.
   */
  function rosterOf(room: HostedRoom): RelayMember[] {
    return Object.entries(room.roles.roles)
      .filter(([deviceId]) => !isRemoved(room.removals, deviceId))
      .map(([deviceId, role]) => ({
        deviceId,
        role,
        name: room.keys.get(deviceId)?.name ?? "A device",
      }))
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  }

  /**
   * Keep an invite an owner wrote.
   *
   * The host cannot tell who it is for — an invite is a bearer token — and that is the
   * point: the owner decides who gets in, the host only decides whether the token is real
   * and unspent.
   */
  async function handleInvite(
    socket: WebSocket,
    context: SocketContext,
    record: InviteRecord,
  ): Promise<void> {
    const added = addInvite(
      context.room.invites,
      record,
      roleVerifierFor(context.room),
      (deviceId) => context.room.roles.roles[deviceId] === "owner",
      now(),
    );
    if (!added.ok) {
      send(socket, { type: "refused", reason: added.reason });
      return;
    }
    context.room.invites = added.state;
    await store.appendInvite(context.room.workspaceId, record);
    send(socket, { type: "invited", inviteId: record.inviteId });
  }

  /**
   * The one exception to "a device with no role may not post".
   *
   * A key package is how a device asks to join, and it is what an owner needs in order to
   * let it in, so refusing it would make joining impossible. A live invite is what makes
   * the exception safe: one invite, one key package, and then it is spent.
   */
  async function handleKeyPackage(
    socket: WebSocket,
    context: SocketContext,
    message: Extract<RelayClientMessage, { type: "keypackage" }>,
  ): Promise<void> {
    const live = liveInvite(context.room.invites, message.inviteId, now());
    if (!live.ok) {
      send(socket, { type: "refused", reason: live.reason });
      return;
    }

    const pinned = context.room.keys.get(message.deviceId);
    if (pinned !== undefined && pinned.publicKey !== message.publicKey) {
      sendError(socket, "unknown", "that device id is already pinned to another key");
      return;
    }

    // Pinned here as well as on `join`, because this is the message that says which invitation
    // the device spent. `join` cannot know: it arrives before the invitation is presented.
    const invitedWith = { inviteId: live.record.inviteId, role: live.record.role };
    context.room.keys.set(message.deviceId, {
      publicKey: message.publicKey,
      name: message.name,
      invitedWith,
    });
    await store.appendKey(context.room.workspaceId, {
      deviceId: message.deviceId,
      publicKey: message.publicKey,
      name: message.name,
      invitedWith,
    });

    const verdict = admitFrame(
      message.frame,
      { workspaceId: context.room.workspaceId, newestEpoch: context.room.log.newestEpoch },
      context.room.roles,
      (deviceId) => context.room.keys.get(deviceId)?.publicKey ?? null,
      options.verifyFrame,
      now().toISOString(),
      // The invite is the authorisation, not a role record: this device has no role yet.
      { kindAllowedWithoutRole: "keypackage" },
    );

    if (!verdict.ok) {
      send(socket, { type: "refused", reason: verdict.reason });
      return;
    }

    context.room.invites = spendInvite(context.room.invites, message.inviteId);
    await store.appendInvite(context.room.workspaceId, live.record);
    // An owner minting a fresh invitation is the permission to come back, so spending one is
    // what clears a removal. Otherwise "remove" would be a door that only opens one way.
    context.room.removals = reinstateDevice(context.room.removals, message.deviceId);

    const index = context.room.log.length;
    context.room.log.append(verdict.frame);
    await store.appendFrame(context.room.workspaceId, verdict.frame);

    // The invitation decided who this device is and what it may do, and the person adding it
    // cannot ask: the invitation may have been written by somebody else. The host read it to
    // decide whether to honour it, so it is the only party that can answer — and the token is
    // spent by now, so there is nothing left to leak.
    //
    // This goes out before the key package itself, because a device is added with the role its
    // invitation promised: announce afterwards and the owner would have to hold the frame
    // back or guess.
    const waiting = {
      type: "waiting" as const,
      deviceId: message.deviceId,
      name: message.name,
      inviteId: live.record.inviteId,
      role: live.record.role,
    };
    for (const peer of context.room.sockets) {
      if (peer !== socket) send(peer, waiting);
    }

    const relayed = { type: "frame" as const, index, frame: verdict.frame };
    send(socket, relayed);
    for (const peer of context.room.sockets) {
      if (peer !== socket) send(peer, relayed);
    }
  }

  async function handleRole(
    socket: WebSocket,
    context: SocketContext,
    record: RoleRecord,
  ): Promise<void> {
    const applied = applyRoleRecord(context.room.roles, record, roleVerifierFor(context.room));
    if (!applied.ok) {
      // To the sender. Broadcasting one device's bad record would read as everybody's.
      send(socket, { type: "refused", reason: applied.reason });
      return;
    }
    context.room.roles = applied.state;
    await store.appendRole(context.room.workspaceId, record);
    send(socket, {
      type: "applied",
      deviceId: record.deviceId,
      role: record.role,
      seq: record.seq,
    });

    // Everybody's idea of who is here just changed, and a device's list of its neighbours is
    // the thing a person makes decisions from. This is the same three fields `joined` carries.
    const roster = { type: "roster" as const, members: rosterOf(context.room) };
    for (const peer of context.room.sockets) send(peer, roster);
  }

  async function handleFrame(
    socket: WebSocket,
    context: SocketContext,
    sealed: Parameters<typeof admitFrame>[0],
  ): Promise<void> {
    if (isRemoved(context.room.removals, sealed.deviceId)) {
      send(socket, { type: "refused", reason: "removed" });
      return;
    }

    const verdict = admitFrame(
      sealed,
      { workspaceId: context.room.workspaceId, newestEpoch: context.room.log.newestEpoch },
      context.room.roles,
      (deviceId) => context.room.keys.get(deviceId)?.publicKey ?? null,
      options.verifyFrame,
      now().toISOString(),
    );

    if (!verdict.ok) {
      send(socket, { type: "refused", reason: verdict.reason });
      return;
    }

    const index = context.room.log.length;
    context.room.log.append(verdict.frame);
    await store.appendFrame(context.room.workspaceId, verdict.frame);
    await enforceRetention(context.room);

    const relayed = { type: "frame" as const, index, frame: verdict.frame };
    send(socket, relayed);
    for (const peer of context.room.sockets) {
      if (peer !== socket) send(peer, relayed);
    }
  }

  /**
   * A device's presence, forwarded and forgotten.
   *
   * Deliberately not `admitFrame`: that path numbers a frame, appends it to the log and writes
   * it down, and all three are wrong here. A cursor in the log would be a document that grows
   * every time somebody moves, and a stale epoch is normal for presence rather than a fault —
   * two devices only need to be in the same epoch to read each other, which the sender's
   * sealing already guarantees.
   *
   * Membership is the check, not permission to write: a reader whose cursor nobody could see
   * would make collaboration mean collaboration between editors.
   */
  function handleEphemeral(
    socket: WebSocket,
    context: SocketContext,
    message: Extract<RelayClientMessage, { type: "ephemeral" }>,
  ): void {
    if (isRemoved(context.room.removals, message.deviceId)) {
      send(socket, { type: "refused", reason: "removed" });
      return;
    }
    if (!hasRole(context.room.roles.roles[message.deviceId])) {
      send(socket, { type: "refused", reason: "not-authorized" });
      return;
    }
    if (message.deviceId !== context.deviceId || message.workspaceId !== context.room.workspaceId) {
      // A socket may only speak for the device it joined as, in the room it joined.
      send(socket, { type: "refused", reason: "invalid-signature" });
      return;
    }
    const key = context.room.keys.get(message.deviceId)?.publicKey;
    if (
      key === undefined ||
      !options.verifyFrame(ephemeralPayload(message), message.signature, key)
    ) {
      send(socket, { type: "refused", reason: "invalid-signature" });
      return;
    }

    const forwarded = {
      type: "ephemeral" as const,
      workspaceId: message.workspaceId,
      deviceId: message.deviceId,
      payload: message.payload,
      signature: message.signature,
    };
    for (const peer of context.room.sockets) {
      if (peer !== socket) send(peer, forwarded);
    }
  }

  /**
   * Take a device out.
   *
   * The commitment that removes it from the group is ciphertext, so this is the host's half:
   * the record it can read, the socket it can close, and the roster it can correct. The
   * removed device is told before the socket goes, because a bare close reads as a bad
   * connection and the app would offer to retry something that can never work.
   */
  async function handleRemoval(
    socket: WebSocket,
    context: SocketContext,
    record: RemovalRecord,
  ): Promise<void> {
    const applied = applyRemovalRecord(
      context.room.removals,
      record,
      roleVerifierFor(context.room),
      (deviceId) => context.room.roles.roles[deviceId] === "owner",
    );
    if (!applied.ok) {
      send(socket, { type: "refused", reason: applied.reason });
      return;
    }
    context.room.removals = applied.state;
    await store.appendRemoval(context.room.workspaceId, record);

    for (const peer of [...context.room.sockets]) {
      const peerId = contexts.get(peer)?.deviceId;
      if (peerId === record.deviceId) {
        send(peer, { type: "removed" });
        // The next tick, so the sentence is on the wire before the socket goes. Closing
        // immediately races the message it was meant to carry, and the app would report a bad
        // connection instead of the decision somebody made.
        setTimeout(() => peer.close(), 25);
      }
    }
    for (const peer of [...context.room.sockets]) {
      if (contexts.get(peer)?.deviceId === record.deviceId) context.room.sockets.delete(peer);
    }

    const roster = { type: "roster" as const, members: rosterOf(context.room) };
    for (const peer of context.room.sockets) send(peer, roster);
  }

  /** Close a retention window on a running host, not only on the next boot. */
  async function enforceRetention(room: HostedRoom): Promise<void> {
    const cutoff = cutoffIso(now(), retentionDays);
    const oldest = room.log.all()[0];
    if (oldest === undefined || oldest.receivedAt >= cutoff) return;
    room.log.dropOlderThan(cutoff);
    await store.compact(room.workspaceId, cutoff);
  }

  function handleSince(socket: WebSocket, context: SocketContext, after: number): void {
    const frames = context.room.log.since(after);
    for (const [offset, frame] of frames.entries()) {
      send(socket, { type: "frame", index: after + offset, frame });
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    host,
    port: boundPort,
    url: `ws://${host}:${boundPort}/sync`,
    async close() {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function send(socket: WebSocket | Set<WebSocket>, message: unknown): void {
  const text = encodeRelayMessage(message as Parameters<typeof encodeRelayMessage>[0]);
  for (const target of socket instanceof Set ? socket : [socket]) {
    if (target.readyState === WebSocket.OPEN) target.send(text);
  }
}

function sendError(
  socket: WebSocket,
  code: "malformed" | "not-joined" | "protocol-version" | "unknown",
  message: string,
): void {
  send(socket, { type: "error", code, message });
}

function rawText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Keeps the pinned-key shape visible to callers that seed a room directly. */
export type { PinnedKey };
