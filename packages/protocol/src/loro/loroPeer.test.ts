import { describe, expect, it } from "vitest";
import { LoroSyncPeer } from "./loroPeer.js";

function state(peer: LoroSyncPeer): unknown {
  return peer.doc.toJSON();
}

describe("LoroSyncPeer", () => {
  it("converges after concurrent edits", () => {
    const a = new LoroSyncPeer();
    const b = new LoroSyncPeer();

    a.doc.getMap("root").set("a", 1);
    b.doc.getMap("root").set("b", 2);
    a.doc.commit();
    b.doc.commit();

    a.syncWith(b);

    expect(state(a)).toEqual(state(b));
    expect(a.doc.getMap("root").get("a")).toBe(1);
    expect(a.doc.getMap("root").get("b")).toBe(2);
  });

  it("converges when both peers write the same key", () => {
    const a = new LoroSyncPeer();
    const b = new LoroSyncPeer();

    a.doc.getMap("root").set("key", "from-a");
    b.doc.getMap("root").set("key", "from-b");
    a.doc.commit();
    b.doc.commit();

    a.syncWith(b);

    expect(state(a)).toEqual(state(b));
  });

  it("carries offline edits across a reconnect", () => {
    const a = new LoroSyncPeer();
    const b = new LoroSyncPeer();

    a.doc.getMap("root").set("first", 1);
    a.doc.commit();
    a.syncWith(b);

    b.doc.getMap("root").set("second", 2);
    b.doc.commit();
    a.doc.getMap("root").set("third", 3);
    a.doc.commit();

    a.syncWith(b);

    expect(state(a)).toEqual(state(b));
    expect(a.doc.getMap("root").get("first")).toBe(1);
    expect(a.doc.getMap("root").get("second")).toBe(2);
    expect(a.doc.getMap("root").get("third")).toBe(3);
  });

  it("applies the same update twice without changing the result", () => {
    const a = new LoroSyncPeer();
    const b = new LoroSyncPeer();

    a.doc.getMap("root").set("value", 1);
    a.doc.commit();

    const update = a.exportSince({});
    b.applyUpdate(update);
    b.applyUpdate(update);

    expect(state(b)).toEqual(state(a));
  });

  it("reports the bytes exchanged", () => {
    const a = new LoroSyncPeer();
    const b = new LoroSyncPeer();

    a.doc.getMap("root").set("value", 1);
    a.doc.commit();

    const round = a.syncWith(b);
    expect(round.sentBytes + round.receivedBytes).toBeGreaterThan(0);
    expect(state(a)).toEqual(state(b));
  });

  it("stops forwarding updates after unsubscribe", () => {
    const peer = new LoroSyncPeer();
    const updates: Uint8Array[] = [];

    const stop = peer.subscribeUpdates((update) => updates.push(update));
    peer.doc.getMap("root").set("one", 1);
    peer.doc.commit();
    expect(updates.length).toBeGreaterThan(0);

    const seen = updates.length;
    stop();
    peer.doc.getMap("root").set("two", 2);
    peer.doc.commit();
    expect(updates.length).toBe(seen);
  });
});
