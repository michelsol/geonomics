// Save format (specification §9, Save and load): the whole world in msgpack, exact to the bit, behind a header that
// names the format and its version.
import { decode, ExtensionCodec, encode } from "@msgpack/msgpack";
import type { World } from "./types";

const MAGIC = "geonomics-save";
// 2: leveled infrastructure with staff (specification §6, Infrastructure); 3: water cells (specification §5)
export const SAVE_FORMAT_VERSION = 3;

/** What a save says about itself, readable without decoding the world. */
export interface SaveInfo {
  gameId: string; // the game the save belongs to: each game keeps one autosave
  title: string; // shown in the list of saved games
  gameDay: number;
  savedAt: number; // wall-clock time, milliseconds since 1970
  catalog: string; // the goods catalog's name
  areas: number;
}

// Typed arrays keep their exact bytes; Maps keep their entries in insertion order, which iteration depends on.
const FLOAT64 = 1;
const INT32 = 2;
const UINT8 = 3;
const MAP = 4;

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
if (!littleEndian) throw new Error("the save format assumes a little-endian platform");

const bytesOf = (view: ArrayBufferView) =>
  new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
const aligned = (data: Uint8Array) => data.slice().buffer;

const extensions = new ExtensionCodec();
extensions.register({
  type: FLOAT64,
  encode: (value) => (value instanceof Float64Array ? bytesOf(value) : null),
  decode: (data) => new Float64Array(aligned(data)),
});
extensions.register({
  type: INT32,
  encode: (value) => (value instanceof Int32Array ? bytesOf(value) : null),
  decode: (data) => new Int32Array(aligned(data)),
});
// msgpack would decode a plain binary as a view into the whole save, keeping it alive: give each array its own bytes.
extensions.register({
  type: UINT8,
  encode: (value) => (value instanceof Uint8Array ? value.slice() : null),
  decode: (data) => data.slice(),
});
extensions.register({
  type: MAP,
  encode: (value) => (value instanceof Map ? encodeValue([...value]) : null),
  decode: (data) => new Map(decodeValue(data) as [unknown, unknown][]),
});

// Every number goes as a float64, so −0 and integers beyond 32 bits come back exactly.
const encodeValue = (value: unknown) =>
  encode(value, { extensionCodec: extensions, ignoreUndefined: true, forceIntegerToFloat: true });
const decodeValue = (data: Uint8Array) => decode(data, { extensionCodec: extensions });

/** Serializes the world with its save info. */
export function serializeWorld(world: World, info: SaveInfo): Uint8Array {
  return encodeValue([MAGIC, SAVE_FORMAT_VERSION, info, world]);
}

function unpack(bytes: Uint8Array): [SaveInfo, World] {
  let decoded: unknown;
  try {
    decoded = decodeValue(bytes);
  } catch {
    throw new Error("This file is not a Geonomics save");
  }
  if (!Array.isArray(decoded) || decoded[0] !== MAGIC) throw new Error("This file is not a Geonomics save");
  const version = decoded[1];
  if (typeof version !== "number" || version > SAVE_FORMAT_VERSION)
    throw new Error(`This save is from a newer version of the game (format ${version})`);
  if (version < SAVE_FORMAT_VERSION)
    throw new Error(`This save is from an older version of the game (format ${version}) and can no longer be loaded`);
  return [decoded[2] as SaveInfo, decoded[3] as World];
}

/** The save's info, checking its format. */
export function readSaveInfo(bytes: Uint8Array): SaveInfo {
  return unpack(bytes)[0];
}

/**
 * The saved world, ready to run. Player tokens do not outlive a session, so every realm a player held goes back to
 * the AI; players pick their realms again in the lobby.
 */
export function deserializeWorld(bytes: Uint8Array): { info: SaveInfo; world: World } {
  const [info, world] = unpack(bytes);
  for (const government of world.governments) {
    if (government.controller.kind === "human") government.controller = { kind: "ai" };
  }
  return { info, world };
}
