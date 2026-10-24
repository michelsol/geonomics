import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_LENGTH, inviteCode, readCode } from "./code";

describe("invite codes", () => {
  it("are six symbols that cannot be mistaken for one another", () => {
    for (let i = 0; i < 200; i++) {
      const code = inviteCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const symbol of code) expect(CODE_ALPHABET).toContain(symbol);
    }
    expect(CODE_ALPHABET).not.toMatch(/[0o1li]/);
  });

  it("skip random bytes that would favor some symbols", () => {
    let call = 0;
    const random = (bytes: Uint8Array) => bytes.fill(call++ === 0 ? 250 : 33); // 250 rejected, 33 → index 2
    expect(inviteCode(random)).toBe("cccccc");
  });

  it("are read from what a player types or pastes", () => {
    expect(readCode("  K7M3QX ")).toBe("k7m3qx");
    expect(readCode("https://michelsol.github.io/geonomics/#join=k7m3qx")).toBe("k7m3qx");
    expect(readCode("not a code!")).toBeNull();
    expect(readCode("")).toBeNull();
  });
});
