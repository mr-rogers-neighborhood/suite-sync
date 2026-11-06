import {
  decodeSyncMessage,
  encodeBase64,
  encodeSyncMessage,
  SERVER_DEVICE_ID,
  type SyncMessage,
} from "@suite/sync";
import { LoroDoc } from "loro-crdt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MessageEventLike, SuiteSyncClient, type WebSocketLike } from "./suiteSyncClient.js";

const workspaceId = "a".repeat(64);
const memberId = "b".repeat(64);
const otherDevice = "c".repeat(64);

class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: MessageEventLike) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(message: SyncMessage): void {
    this.emit("message", { data: encodeSyncMessage(message) });
  }

  private emit(type: string, event: MessageEventLike): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: FakeSocket[] = [];

function fakeWebSocket(): new (url: string) => WebSocketLike {
  return function (this: unknown, _url: string) {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  } as unknown as new (
    url: string,
  ) => WebSocketLike;
}

function messages(socket: FakeSocket): SyncMessage[] {
  return socket.sent.flatMap((text) => {
    const parsed = decodeSyncMessage(text);
    return parsed.ok ? [parsed.value] : [];
  });
}

beforeEach(() => {
  sockets.length = 0;
});

describe("SuiteSyncClient", () => {
  it("sends a hello and reports connected on the ack", async () => {
    const statuses: string[] = [];
    const synced = vi.fn();
    const client = new SuiteSyncClient({
      url: "ws://test/sync",
      workspaceId,
      memberId,
      deviceId: memberId,
      epoch: 1,
      doc: new LoroDoc(),
      WebSocket: fakeWebSocket(),
      onStatus: (status) => statuses.push(status),
      onSynced: synced,
    });

    const connected = client.connect();
    sockets[0]?.open();
    await connected;

    const hello = messages(sockets[0] as FakeSocket)[0];
    expect(hello).toMatchObject({ type: "hello", workspaceId, memberId, epoch: 1 });

    sockets[0]?.receive({ type: "ack", epoch: 1, versionVector: {} });
    expect(client.status).toBe("connected");
    expect(statuses).toContain("connected");
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it("forwards a local update and flushes on an ack that covers it", async () => {
    const doc = new LoroDoc();
    const client = new SuiteSyncClient({
      url: "ws://test/sync",
      workspaceId,
      memberId,
      deviceId: memberId,
      epoch: 1,
      doc,
      WebSocket: fakeWebSocket(),
    });

    const connected = client.connect();
    sockets[0]?.open();
    await connected;
    sockets[0]?.receive({ type: "ack", epoch: 1, versionVector: {} });

    doc.getMap("root").set("card", 1);
    doc.commit();

    const update = messages(sockets[0] as FakeSocket).find((message) => message.type === "update");
    expect(update).toMatchObject({ type: "update", from: memberId, to: SERVER_DEVICE_ID });

    const flush = client.flush();
    sockets[0]?.receive({
      type: "ack",
      epoch: 1,
      versionVector: client.versionVector,
    });
    await flush;
  });

  it("applies a remote update", async () => {
    const doc = new LoroDoc();
    const client = new SuiteSyncClient({
      url: "ws://test/sync",
      workspaceId,
      memberId,
      deviceId: memberId,
      epoch: 1,
      doc,
      WebSocket: fakeWebSocket(),
    });

    const connected = client.connect();
    sockets[0]?.open();
    await connected;
    sockets[0]?.receive({ type: "ack", epoch: 1, versionVector: {} });

    const remote = new LoroDoc();
    remote.getMap("root").set("remote", "yes");
    remote.commit();

    sockets[0]?.receive({
      type: "update",
      workspaceId,
      from: otherDevice,
      to: memberId,
      epoch: 1,
      payload: encodeBase64(remote.export({ mode: "update" })),
    });

    expect(doc.getMap("root").get("remote")).toBe("yes");
  });

  it("stops on an unauthorized answer", async () => {
    const client = new SuiteSyncClient({
      url: "ws://test/sync",
      workspaceId,
      memberId,
      deviceId: memberId,
      epoch: 1,
      doc: new LoroDoc(),
      WebSocket: fakeWebSocket(),
    });

    const connected = client.connect();
    sockets[0]?.open();
    await connected;
    sockets[0]?.receive({ type: "error", code: "unauthorized", message: "not a member" });

    expect(client.status).toBe("unauthorized");
  });

  it("reconnects after the socket closes", async () => {
    vi.useFakeTimers();
    try {
      const client = new SuiteSyncClient({
        url: "ws://test/sync",
        workspaceId,
        memberId,
        deviceId: memberId,
        epoch: 1,
        doc: new LoroDoc(),
        WebSocket: fakeWebSocket(),
        reconnect: { minMs: 1, maxMs: 1 },
      });

      const connected = client.connect();
      sockets[0]?.open();
      await connected;

      sockets[0]?.close();
      expect(client.status).toBe("disconnected");

      await vi.advanceTimersByTimeAsync(5);
      expect(sockets.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
