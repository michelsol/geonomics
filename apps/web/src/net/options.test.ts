import { describe, expect, it } from "vitest";
import { brokerOptions, joinLink } from "./options";

describe("brokerOptions", () => {
  it("uses the PeerJS cloud without a built-in broker or setting", () => {
    expect(brokerOptions("", "")).toEqual({});
  });

  it("uses the built-in broker and its ICE servers", () => {
    expect(brokerOptions("", "https://geonomics-broker.example.workers.dev")).toEqual({
      host: "geonomics-broker.example.workers.dev",
      port: 443,
      path: "/",
      secure: true,
      ice: "https://geonomics-broker.example.workers.dev:443/ice",
    });
  });

  it("lets ?peer= override it, local brokers on port 8787 without TLS", () => {
    expect(brokerOptions("?peer=localhost:8787", "https://broker.example")).toEqual({
      host: "localhost",
      port: 8787,
      path: "/",
      secure: false,
      ice: "http://localhost:8787/ice",
    });
    expect(brokerOptions("?peer=signal.example/game", "")).toMatchObject({
      port: 443,
      path: "/game/",
      secure: true,
      ice: "https://signal.example:443/game/ice",
    });
  });

  it("reaches a broker on the web with TLS, even from a local page", () => {
    expect(brokerOptions("?peer=geonomics-broker.example.workers.dev", "")).toEqual({
      host: "geonomics-broker.example.workers.dev",
      port: 443,
      path: "/",
      secure: true,
      ice: "https://geonomics-broker.example.workers.dev:443/ice",
    });
    expect(brokerOptions("?peer=192.168.1.20:8787", "")).toMatchObject({
      secure: false,
      ice: "http://192.168.1.20:8787/ice",
    });
  });

  it("keeps the PeerJS cloud free of ICE requests", () => {
    expect(brokerOptions("?peer=0.peerjs.com", "")).toEqual({
      host: "0.peerjs.com",
      port: 443,
      path: "/",
      secure: true,
    });
  });

  it("forces relayed connections with ?relay=1", () => {
    expect(brokerOptions("?relay=1", "")).toEqual({ relayOnly: true });
    expect(brokerOptions("?peer=localhost&relay=1", "")).toMatchObject({ port: 8787, relayOnly: true });
  });
});

describe("joinLink", () => {
  const page = "https://michelsol.github.io/geonomics/";
  it("carries only the host's peer id, and its broker setting when the page has one", () => {
    expect(joinLink("abc", "", page)).toBe(`${page}#join=abc`);
    expect(joinLink("abc", "?warmup=10&relay=1", page)).toBe(`${page}#join=abc`);
    expect(joinLink("abc", "?peer=localhost:8787&warmup=10", page)).toBe(`${page}?peer=localhost%3A8787#join=abc`);
  });
});
