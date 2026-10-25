// Messages are compressed, then cut into frames small enough for any data channel (specification §8, Encoding).
import { decode, encode } from "./codec";

/** Frame payload limit: browsers agree on data channel messages up to 256 KiB; smaller frames interleave better. */
export const MAX_FRAME = 64 * 1024;
const HEADER = 9; // version (u8), message id (u32), frame index (u16), frame count (u16)
const FRAME_VERSION = 1;

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A message as it travels: msgpack, then raw deflate. */
export function pack(message: unknown): Promise<Uint8Array> {
  return pipe(encode(message), new CompressionStream("deflate-raw"));
}

export async function unpack<T>(bytes: Uint8Array): Promise<T> {
  return decode<T>(await pipe(bytes, new DecompressionStream("deflate-raw")));
}

/** Cuts a packed message into frames, each with a header naming the message and the frame's place in it. */
export function toFrames(packed: Uint8Array, id: number, maxFrame = MAX_FRAME): Uint8Array[] {
  const count = Math.max(1, Math.ceil(packed.byteLength / maxFrame));
  if (count > 0xffff) throw new Error("message too large to frame");
  const frames: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const body = packed.subarray(index * maxFrame, Math.min(packed.byteLength, (index + 1) * maxFrame));
    const frame = new Uint8Array(HEADER + body.byteLength);
    const header = new DataView(frame.buffer);
    header.setUint8(0, FRAME_VERSION);
    header.setUint32(1, id >>> 0);
    header.setUint16(5, index);
    header.setUint16(7, count);
    frame.set(body, HEADER);
    frames.push(frame);
  }
  return frames;
}

/** Joins frames back into packed messages. Frames arrive in order on a reliable, ordered channel. */
export class Reassembler {
  private id = -1;
  private parts: Uint8Array[] = [];

  /** Takes one frame; returns the packed message when this frame completes it. */
  push(frame: Uint8Array): Uint8Array | null {
    const header = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (header.getUint8(0) !== FRAME_VERSION) throw new Error("unknown frame version");
    const id = header.getUint32(1);
    const index = header.getUint16(5);
    const count = header.getUint16(7);
    if (index === 0) {
      this.id = id;
      this.parts = [];
    } else if (id !== this.id || index !== this.parts.length) throw new Error("frames out of order");
    this.parts.push(frame.subarray(HEADER));
    if (index + 1 < count) return null;
    const size = this.parts.reduce((sum, part) => sum + part.byteLength, 0);
    const packed = new Uint8Array(size);
    let offset = 0;
    for (const part of this.parts) {
      packed.set(part, offset);
      offset += part.byteLength;
    }
    this.parts = [];
    return packed;
  }
}
