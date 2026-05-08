import type { StoredFile } from "../index.js";

export interface StoredFileMeta {
  key: string;
  size: number;
  type: string;
  lastModified?: number;
  etag?: string;
  metadata?: Record<string, string>;
}

export type BodySource =
  | { kind: "buffer"; data: Uint8Array }
  | { kind: "stream"; factory: () => ReadableStream<Uint8Array> }
  | { kind: "lazy"; factory: () => Promise<Uint8Array> };

const collectStream = async (
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

const streamFromBytes = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

export const createStoredFile = (
  meta: StoredFileMeta,
  body: BodySource
): StoredFile => {
  // The underlying source factory is invoked at most once. After that, all
  // body accessors share `cachePromise` (in flight) or `cached` (settled).
  // For stream-kind bodies, the first stream() consumer gets one branch of a
  // tee; the other branch fills the cache so later text()/blob()/arrayBuffer()
  // calls don't re-enter the (now-locked) source.
  let cached: Uint8Array | undefined;
  let cachePromise: Promise<Uint8Array> | undefined;

  const cacheFrom = async (
    source: () => Promise<Uint8Array>
  ): Promise<Uint8Array> => {
    const bytes = await source();
    cached = bytes;
    return bytes;
  };

  const toBytes = (): Promise<Uint8Array> => {
    if (cached) {
      return Promise.resolve(cached);
    }
    if (cachePromise) {
      return cachePromise;
    }
    if (body.kind === "buffer") {
      cached = body.data;
      return Promise.resolve(cached);
    }
    if (body.kind === "lazy") {
      cachePromise = cacheFrom(body.factory);
      return cachePromise;
    }
    const stream = body.factory();
    cachePromise = cacheFrom(() => collectStream(stream));
    return cachePromise;
  };

  return {
    async arrayBuffer() {
      const bytes = await toBytes();
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
    },
    async blob() {
      const bytes = await toBytes();
      return new Blob([bytes as BlobPart], { type: meta.type });
    },
    etag: meta.etag,
    key: meta.key,
    lastModified: meta.lastModified,
    metadata: meta.metadata,
    name: meta.key,
    size: meta.size,
    stream() {
      if (cached) {
        return streamFromBytes(cached);
      }
      if (body.kind === "stream" && !cachePromise) {
        const [user, buffered] = body.factory().tee();
        cachePromise = cacheFrom(() => collectStream(buffered));
        return user;
      }
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          const bytes = await toBytes();
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
    async text() {
      const bytes = await toBytes();
      return new TextDecoder().decode(bytes);
    },
    type: meta.type,
  };
};
