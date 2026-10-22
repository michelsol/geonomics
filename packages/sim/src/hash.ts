// World hash for determinism tests: two FNV-1a streams over every value, numbers hashed bit for bit.

const FNV_PRIME = 0x01000193;
const scratch = new DataView(new ArrayBuffer(8));

class Hasher {
  private a = 0x811c9dc5;
  private b = 0x050c5d1f;

  byte(value: number): void {
    this.a = Math.imul(this.a ^ value, FNV_PRIME);
    this.b = Math.imul(this.b ^ value ^ 0x5a, FNV_PRIME);
  }

  bytes(view: Uint8Array): void {
    for (let i = 0; i < view.length; i++) this.byte(view[i] as number);
  }

  number(value: number): void {
    scratch.setFloat64(0, value);
    for (let i = 0; i < 8; i++) this.byte(scratch.getUint8(i));
  }

  tag(value: string): void {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      this.byte(code & 0xff);
      this.byte(code >>> 8);
    }
    this.byte(0);
  }

  digest(): string {
    return (this.a >>> 0).toString(16).padStart(8, "0") + (this.b >>> 0).toString(16).padStart(8, "0");
  }
}

function visit(hasher: Hasher, value: unknown): void {
  if (typeof value === "number") {
    hasher.tag("n");
    hasher.number(value);
  } else if (typeof value === "string") {
    hasher.tag("s");
    hasher.tag(value);
  } else if (typeof value === "boolean") {
    hasher.tag(value ? "t" : "f");
  } else if (value === null || value === undefined) {
    hasher.tag("0");
  } else if (ArrayBuffer.isView(value)) {
    hasher.tag("v");
    hasher.number(value.byteLength);
    hasher.bytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  } else if (Array.isArray(value)) {
    hasher.tag("a");
    hasher.number(value.length);
    for (const item of value) visit(hasher, item);
  } else if (value instanceof Map) {
    hasher.tag("m");
    hasher.number(value.size);
    const keys = [...value.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    for (const key of keys) {
      visit(hasher, key);
      visit(hasher, value.get(key));
    }
  } else if (typeof value === "object") {
    hasher.tag("o");
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      hasher.tag(key);
      visit(hasher, record[key]);
    }
  } else {
    throw new Error(`Cannot hash a value of type ${typeof value}`);
  }
}

/** Hash of the whole world state: equal worlds give equal hashes, bit for bit, on the same device. */
export function hashWorld(world: object): string {
  const hasher = new Hasher();
  visit(hasher, world);
  return hasher.digest();
}
