import { describe, expect, it } from "vitest";
import { admit, MAX_MESSAGE, OPEN, type PeerSocket, route } from "./switchboard";

interface Fake extends PeerSocket {
  sent: unknown[];
  closed: boolean;
}

function socket(id: string, token = `t-${id}`): Fake {
  const fake: Fake = {
    id,
    token,
    sent: [],
    closed: false,
    send: (text) => fake.sent.push(JSON.parse(text)),
    close: () => {
      fake.closed = true;
    },
  };
  return fake;
}

const params = (query: string) => new URLSearchParams(query);

function registry(...sockets: Fake[]) {
  return (id: string) => sockets.filter((s) => s.id === id && !s.closed);
}

describe("admit", () => {
  it("opens a new id", () => {
    expect(admit(params("key=peerjs&id=host-1&token=abc"), [])).toEqual({
      ok: true,
      id: "host-1",
      token: "abc",
      replaces: [],
    });
    expect(JSON.parse(OPEN)).toEqual({ type: "OPEN" });
  });

  it("refuses missing parameters, another key and odd ids", () => {
    for (const query of ["id=a&token=b", "key=peerjs&token=b", "key=other&id=a&token=b", "key=peerjs&id=a/b&token=b"]) {
      const admission = admit(params(query), []);
      expect(admission.ok).toBe(false);
      if (!admission.ok) expect(JSON.parse(admission.reply).type).toBe("ERROR");
    }
  });

  it("tells another token the id is taken, and lets the same token take it over", () => {
    const holder = socket("host", "abc");
    const taken = admit(params("key=peerjs&id=host&token=xyz"), [holder]);
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(JSON.parse(taken.reply).type).toBe("ID-TAKEN");
    const again = admit(params("key=peerjs&id=host&token=abc"), [holder]);
    expect(again).toMatchObject({ ok: true, replaces: [holder] });
  });
});

describe("route", () => {
  it("forwards to the destination with the sender's id as src, whatever the message claims", () => {
    const host = socket("host");
    const guest = socket("guest");
    route(
      guest,
      JSON.stringify({ type: "OFFER", src: "someone-else", dst: "host", payload: { sdp: "x" } }),
      registry(host, guest),
    );
    expect(host.sent).toEqual([{ type: "OFFER", src: "guest", dst: "host", payload: { sdp: "x" } }]);
    expect(guest.sent).toEqual([]);
  });

  it("expires an offer to an absent peer at once and drops the rest", () => {
    const guest = socket("guest");
    const find = registry(guest);
    route(guest, JSON.stringify({ type: "OFFER", dst: "host", payload: {} }), find);
    route(guest, JSON.stringify({ type: "CANDIDATE", dst: "host", payload: {} }), find);
    expect(guest.sent).toEqual([{ type: "EXPIRE", src: "host", dst: "guest" }]);
  });

  it("ignores heartbeats, junk, binary and oversized messages", () => {
    const host = socket("host");
    const guest = socket("guest");
    const find = registry(host, guest);
    route(guest, JSON.stringify({ type: "HEARTBEAT" }), find);
    route(guest, "not json", find);
    route(guest, "null", find);
    route(guest, new ArrayBuffer(8), find);
    route(guest, JSON.stringify({ type: "OFFER", dst: "host", payload: "x".repeat(MAX_MESSAGE) }), find);
    expect(host.sent).toEqual([]);
    expect(guest.sent).toEqual([]);
  });

  it("closes a peer that leaves without a destination", () => {
    const guest = socket("guest");
    route(guest, JSON.stringify({ type: "LEAVE" }), registry(guest));
    expect(guest.closed).toBe(true);
  });
});
