import { describe, expect, it } from "vitest";
import { RELAY_PROTOCOL_VERSION } from "./relay.js";
import { createRelayClient, type RelayWebSocket, signFrame } from "./relayClient.js";

const workspaceId = "a".repeat(64);
const deviceId = "b".repeat(64);

/** A socket that records what was written and lets the test speak as the host. */
function fakeSocket() {
  const sent: unknown[] = [];
  const handlers = new Map<string, ((event: { data: unknown }) => void) | (() => void)>();
  const socket: RelayWebSocket = {
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => handlers.get("close")?.({ data: undefined } as { data: unknown }),
    addEventListener: (type: string, listener: never) => handlers.set(type, listener),
  } as unknown as RelayWebSocket;

  return {
    socket,
    sent,
    open: () => (handlers.get("open") as (() => void) | undefined)?.(),
    host: (message: unknown) =>
      (handlers.get("message") as unknown as (e: { data: unknown }) => void)?.({
        data: JSON.stringify(message),
      }),
  };
}

function client(fake: ReturnType<typeof fakeSocket>, overrides: Partial<{ url: string }> = {}) {
  const events = {
    joined: [] as unknown[],
    frames: [] as Array<[number, string]>,
    refused: [] as string[],
    errors: [] as string[],
    closed: 0,
  };
  const ready = createRelayClient(
    {
      url: overrides.url ?? "ws://127.0.0.1:8787/sync",
      workspaceId,
      deviceId,
      publicKey: "a2V5",
      name: "a test device",
      sign: () => "signed",
      webSocket: () => fake.socket,
    },
    {
      onJoined: (info) => events.joined.push(info),
      onFrame: (index, frame) => events.frames.push([index, frame.kind]),
      onRefused: (reason) => events.refused.push(reason),
      onError: (code) => events.errors.push(code),
      onClosed: () => {
        events.closed += 1;
      },
    },
  );
  return { ready, events };
}

describe("the client announces itself", () => {
  it("joins with its device id and public key as soon as the socket opens", async () => {
    const fake = fakeSocket();
    const { ready } = client(fake);
    fake.open();
    await ready;

    expect(fake.sent[0]).toEqual({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId,
      publicKey: "a2V5",
      name: "a test device",
    });
  });

  it("does not announce before the socket is open", async () => {
    const fake = fakeSocket();
    client(fake);
    expect(fake.sent).toHaveLength(0);
  });
});

describe("what the host says", () => {
  it("passes a frame through with its position", async () => {
    const fake = fakeSocket();
    const { ready, events } = client(fake);
    fake.open();
    const relay = await ready;

    fake.host({
      type: "frame",
      index: 7,
      frame: {
        kind: "application",
        workspaceId,
        deviceId,
        epoch: 3,
        payload: "AAAA",
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });

    expect(events.frames).toEqual([[7, "application"]]);
    expect(relay).toBeDefined();
  });

  it("reports a refusal and an error separately, because they mean different things", async () => {
    const fake = fakeSocket();
    const { ready, events } = client(fake);
    fake.open();
    await ready;

    fake.host({ type: "refused", reason: "not-authorized" });
    fake.host({ type: "error", code: "protocol-version", message: "too new" });

    expect(events.refused).toEqual(["not-authorized"]);
    expect(events.errors).toEqual(["protocol-version"]);
  });

  it("ignores a message it cannot parse rather than throwing", async () => {
    const fake = fakeSocket();
    const { ready, events } = client(fake);
    fake.open();
    await ready;

    fake.host({ type: "nonsense" });
    expect(events.frames).toEqual([]);
    expect(events.errors).toEqual([]);
  });

  it("says so when the socket closes", async () => {
    const fake = fakeSocket();
    const { ready, events } = client(fake);
    fake.open();
    const relay = await ready;

    relay.close();
    expect(events.closed).toBe(1);
  });
});

describe("what the client sends", () => {
  it("asks for what it missed by index", async () => {
    const fake = fakeSocket();
    const { ready } = client(fake);
    fake.open();
    const relay = await ready;

    relay.since(4);
    expect(fake.sent.at(-1)).toEqual({ type: "since", after: 4 });
  });

  it("signs the header, not a copy of it", () => {
    const header = {
      kind: "application" as const,
      workspaceId,
      deviceId,
      epoch: 1,
      payload: "AAAA",
    };
    const signed = signFrame(() => "sig", header);
    expect(signed).toEqual({ ...header, signature: "sig" });
  });
});
