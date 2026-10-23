import { describe, expect, it } from "vitest";
import { brokerOptions } from "./options";

describe("brokerOptions", () => {
  it("uses the PeerJS cloud without a built-in broker or setting", () => {
    expect(brokerOptions("", undefined, "https:")).toEqual({});
  });

  it("uses the built-in broker and its ICE servers", () => {
    expect(brokerOptions("", "https://geonomics-broker.example.workers.dev", "https:")).toEqual({
      host: "geonomics-broker.example.workers.dev",
      port: 443,
      path: "/",
      secure: true,
      ice: "https://geonomics-broker.example.workers.dev:443/ice",
    });
  });

  it("lets ?peer= override it, local brokers on port 8787 without TLS", () => {
    expect(brokerOptions("?peer=localhost:8787", "https://broker.example", "https:")).toEqual({
      host: "localhost",
      port: 8787,
      path: "/",
      secure: false,
      ice: "http://localhost:8787/ice",
    });
    expect(brokerOptions("?peer=signal.example/game", undefined, "https:")).toMatchObject({
      port: 443,
      path: "/game/",
      secure: true,
      ice: "https://signal.example:443/game/ice",
    });
  });

  it("forces relayed connections with ?relay=1", () => {
    expect(brokerOptions("?relay=1", undefined, "https:")).toEqual({ relayOnly: true });
    expect(brokerOptions("?peer=localhost&relay=1", undefined, "http:")).toMatchObject({ port: 8787, relayOnly: true });
  });
});
