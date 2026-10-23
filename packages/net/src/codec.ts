// msgpack encoding of network messages (specification §9, Encoding). Typed arrays travel as msgpack extensions
// holding their raw little-endian bytes; a Float32Array that is mostly zeros travels sparse, as index and value pairs.
import { ExtensionCodec, decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";

// msgpack tries extensions in type order, so the sparse form comes first and the dense one catches the rest.
const SPARSE_FLOAT32 = 1;
const FLOAT32 = 2;
const FLOAT64 = 3;
const INT16 = 4;
const INT32 = 5;
const UINT16 = 6;

/** A Float32Array goes sparse when fewer than this share of its entries are nonzero. */
const SPARSE_SHARE = 0.25;

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
if (!littleEndian) throw new Error("the network codec assumes a little-endian platform");

/** The bytes of a typed array, copied so they are aligned and owned. */
const bytesOf = (view: ArrayBufferView) =>
  new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));

/** Copies `data` into a fresh buffer, aligned for any typed array. */
function aligned(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

const view = <T>(data: Uint8Array, Type: new (buffer: ArrayBuffer) => T): T => new Type(aligned(data));

function encodeSparse(values: Float32Array): Uint8Array | null {
  let nonzero = 0;
  for (let i = 0; i < values.length; i++) if (values[i] !== 0) nonzero++;
  if (nonzero >= SPARSE_SHARE * values.length) return null;
  // Header: length (u32), then nonzero indices (u32) and their values (f32).
  const out = new ArrayBuffer(4 + 8 * nonzero);
  const header = new Uint32Array(out, 0, 1);
  const indices = new Uint32Array(out, 4, nonzero);
  const kept = new Float32Array(out, 4 + 4 * nonzero, nonzero);
  header[0] = values.length;
  let k = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === 0) continue;
    indices[k] = i;
    kept[k] = values[i] as number;
    k++;
  }
  return new Uint8Array(out);
}

function decodeSparse(data: Uint8Array): Float32Array {
  const buffer = aligned(data);
  const length = new Uint32Array(buffer, 0, 1)[0] as number;
  const nonzero = (data.byteLength - 4) / 8;
  const indices = new Uint32Array(buffer, 4, nonzero);
  const kept = new Float32Array(buffer, 4 + 4 * nonzero, nonzero);
  const values = new Float32Array(length);
  for (let k = 0; k < nonzero; k++) values[indices[k] as number] = kept[k] as number;
  return values;
}

const extensions = new ExtensionCodec();
extensions.register({
  type: SPARSE_FLOAT32,
  encode: (value) => (value instanceof Float32Array ? encodeSparse(value) : null),
  decode: decodeSparse,
});
const dense: [number, new (buffer: ArrayBuffer) => ArrayBufferView][] = [
  [FLOAT32, Float32Array],
  [FLOAT64, Float64Array],
  [INT16, Int16Array],
  [INT32, Int32Array],
  [UINT16, Uint16Array],
];
for (const [type, Type] of dense) {
  extensions.register({
    type,
    encode: (value) => (value instanceof Type ? bytesOf(value) : null),
    decode: (data) => view(data, Type),
  });
}

/** Encodes a message: plain data, Maps excepted, with typed arrays anywhere inside. */
export function encode(message: unknown): Uint8Array {
  return msgpackEncode(message, { extensionCodec: extensions, ignoreUndefined: true });
}

export function decode<T>(bytes: Uint8Array): T {
  return msgpackDecode(bytes, { extensionCodec: extensions }) as T;
}
