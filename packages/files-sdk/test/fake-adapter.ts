import {
  type Adapter,
  type Body,
  type DownloadOptions,
  type ListOptions,
  type ListResult,
  type SignOptions,
  type SignUploadOptions,
  type SignedUpload,
  type StoredFile,
  type UploadOptions,
  type UploadResult,
  createStoredFile,
} from '../src/index.js';
import { FilesError } from '../src/internal/errors.js';

interface Entry {
  bytes: Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
  etag: string;
  uploadedAt: number;
}

export interface FakeAdapter extends Adapter<Map<string, Entry>> {
  has(key: string): boolean;
}

export function fakeAdapter(): FakeAdapter {
  const store = new Map<string, Entry>();
  let counter = 0;
  const nextEtag = () => `"etag-${++counter}"`;

  const bytesOf = async (body: Body): Promise<Uint8Array> => {
    if (typeof body === 'string') return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      const v = body as ArrayBufferView;
      return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    }
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    // ReadableStream
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
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
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  };

  const toStored = (key: string, entry: Entry): StoredFile =>
    createStoredFile(
      {
        key,
        size: entry.bytes.byteLength,
        type: entry.contentType,
        lastModified: entry.uploadedAt,
        etag: entry.etag,
        metadata: entry.metadata,
      },
      { kind: 'buffer', data: entry.bytes }
    );

  return {
    name: 'fake',
    raw: store,

    has(key) {
      return store.has(key);
    },

    async upload(
      key: string,
      body: Body,
      opts?: UploadOptions
    ): Promise<UploadResult> {
      const bytes = await bytesOf(body);
      const entry: Entry = {
        bytes,
        contentType: opts?.contentType ?? 'application/octet-stream',
        metadata: opts?.metadata,
        cacheControl: opts?.cacheControl,
        etag: nextEtag(),
        uploadedAt: Date.now(),
      };
      store.set(key, entry);
      return {
        key,
        size: bytes.byteLength,
        contentType: entry.contentType,
        etag: entry.etag,
        lastModified: entry.uploadedAt,
      };
    },

    async download(key: string, _opts?: DownloadOptions): Promise<StoredFile> {
      const entry = store.get(key);
      if (!entry) {
        throw new FilesError('NotFound', `not found: ${key}`);
      }
      return toStored(key, entry);
    },

    async head(key: string): Promise<StoredFile> {
      const entry = store.get(key);
      if (!entry) {
        throw new FilesError('NotFound', `not found: ${key}`);
      }
      return toStored(key, entry);
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async copy(from: string, to: string): Promise<void> {
      const entry = store.get(from);
      if (!entry) {
        throw new FilesError('NotFound', `not found: ${from}`);
      }
      store.set(to, { ...entry, etag: nextEtag(), uploadedAt: Date.now() });
    },

    async list(opts?: ListOptions): Promise<ListResult> {
      const prefix = opts?.prefix ?? '';
      const limit = opts?.limit ?? 1000;
      const sorted = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const start = opts?.cursor
        ? sorted.findIndex(([k]) => k > opts.cursor!)
        : 0;
      const slice = sorted.slice(
        start === -1 ? sorted.length : start,
        (start === -1 ? sorted.length : start) + limit
      );
      const lastKey = slice.at(-1)?.[0];
      const more = start + slice.length < sorted.length;
      return {
        items: slice.map(([k, e]) => toStored(k, e)),
        cursor: more && lastKey ? lastKey : undefined,
      };
    },

    async url(_key: string): Promise<string> {
      throw new FilesError('Provider', 'fake adapter has no public URL');
    },

    async signedUrl(key: string, opts: SignOptions): Promise<string> {
      if (!store.has(key)) {
        throw new FilesError('NotFound', `not found: ${key}`);
      }
      return `https://fake.local/${encodeURIComponent(key)}?expires=${opts.expiresIn}`;
    },

    async signedUploadUrl(
      key: string,
      _opts: SignUploadOptions
    ): Promise<SignedUpload> {
      return {
        method: 'PUT',
        url: `https://fake.local/${encodeURIComponent(key)}`,
        headers: { 'Content-Type': 'application/octet-stream' },
      };
    },
  };
}
