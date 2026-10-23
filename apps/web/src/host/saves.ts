// Saved games in IndexedDB (specification §9, Save and load): one autosave per game, the most recent games kept.
// Works in the worker, which writes autosaves, and on the main thread, which lists and deletes them.
import type { SaveInfo } from "@geonomics/sim";

const DATABASE = "geonomics";
const INFO = "info"; // SaveInfo per game id: listing reads only this
const DATA = "data"; // the compressed save per game id
export const KEPT_GAMES = 5;

let database: Promise<IDBDatabase> | null = null;

/** The database, opened once; a failed opening is tried again next time. */
function open(): Promise<IDBDatabase> {
  if (database) return database;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(INFO, { keyPath: "gameId" });
      request.result.createObjectStore(DATA);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database = opening;
  opening.catch(() => {
    database = null;
  });
  return opening;
}

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const committed = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

/** Saved games, most recent first. */
export async function listSaves(): Promise<SaveInfo[]> {
  const db = await open();
  const saves = await result(db.transaction(INFO).objectStore(INFO).getAll() as IDBRequest<SaveInfo[]>);
  return saves.sort((a, b) => b.savedAt - a.savedAt);
}

/** Stores a game's save over its previous one, then forgets the games beyond the most recent few. */
export async function storeSave(info: SaveInfo, bytes: Uint8Array): Promise<void> {
  const db = await open();
  const write = db.transaction([INFO, DATA], "readwrite");
  write.objectStore(INFO).put(info);
  write.objectStore(DATA).put(bytes, info.gameId);
  await committed(write);
  for (const old of (await listSaves()).slice(KEPT_GAMES)) await deleteSave(old.gameId);
}

export async function readSave(gameId: string): Promise<Uint8Array> {
  const db = await open();
  const bytes = await result(db.transaction(DATA).objectStore(DATA).get(gameId) as IDBRequest<Uint8Array>);
  if (!bytes) throw new Error("This saved game is gone");
  return bytes;
}

export async function deleteSave(gameId: string): Promise<void> {
  const db = await open();
  const write = db.transaction([INFO, DATA], "readwrite");
  write.objectStore(INFO).delete(gameId);
  write.objectStore(DATA).delete(gameId);
  await committed(write);
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A save as stored and exported: gzip, which shrinks it about fourfold. */
export const compress = (bytes: Uint8Array) => pipe(bytes, new CompressionStream("gzip"));

/** The save inside a file: gzip as the game writes it, or the bare save. */
export const decompress = (bytes: Uint8Array) =>
  bytes[0] === 0x1f && bytes[1] === 0x8b ? pipe(bytes, new DecompressionStream("gzip")) : Promise.resolve(bytes);
