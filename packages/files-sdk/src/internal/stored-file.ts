import type { StoredFile } from '../index.js';

export interface StoredFileMeta {
  key: string;
  size: number;
  type: string;
  lastModified?: number;
  etag?: string;
  metadata?: Record<string, string>;
}

export type BodySource =
  | { kind: 'buffer'; data: Uint8Array }
  | { kind: 'stream'; factory: () => ReadableStream<Uint8Array> }
  | { kind: 'lazy'; factory: () => Promise<Uint8Array> };

export function createStoredFile(
  meta: StoredFileMeta,
  body: BodySource
): StoredFile {
  let cached: Uint8Array | undefined;

  const toBytes = async (): Promise<Uint8Array> => {
    if (cached) return cached;
    if (body.kind === 'buffer') {
      cached = body.data;
      return cached;
    }
    if (body.kind === 'lazy') {
      cached = await body.factory();
      return cached;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = body.factory().getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
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
    cached = out;
    return out;
  };

  return {
    name: meta.key,
    size: meta.size,
    type: meta.type,
    lastModified: meta.lastModified,
    key: meta.key,
    etag: meta.etag,
    metadata: meta.metadata,
    async arrayBuffer() {
      const bytes = await toBytes();
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
    },
    async text() {
      const bytes = await toBytes();
      return new TextDecoder().decode(bytes);
    },
    stream() {
      if (cached) {
        const bytes = cached;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      }
      if (body.kind === 'stream') {
        return body.factory();
      }
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          const bytes = await toBytes();
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
    async blob() {
      const bytes = await toBytes();
      return new Blob([bytes as BlobPart], { type: meta.type });
    },
  };
}
