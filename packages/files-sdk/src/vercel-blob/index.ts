import * as blob from '@vercel/blob';

import type {
  Adapter,
  Body,
  ListResult,
  SignedUpload,
  StoredFile,
  UploadResult,
} from '../index.js';
import { FilesError } from '../internal/errors.js';
import { createStoredFile } from '../internal/stored-file.js';

export interface VercelBlobAdapterOptions {
  token?: string;
  /** Add a random suffix to uploaded keys (Vercel default). When `false`, the resulting pathname matches the key 1:1. Defaults to `false` so SDK users get predictable keys. */
  addRandomSuffix?: boolean;
  /** Allow overwriting existing keys on upload. Defaults to `true`, paired with `addRandomSuffix: false`. */
  allowOverwrite?: boolean;
}

export type VercelBlobClient = typeof blob;

export type VercelBlobAdapter = Adapter<VercelBlobClient>;

export function vercelBlob(
  opts: VercelBlobAdapterOptions = {}
): VercelBlobAdapter {
  const token = opts.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new FilesError(
      'Provider',
      'vercelBlob adapter: missing token. Pass `token` or set BLOB_READ_WRITE_TOKEN.'
    );
  }

  const addRandomSuffix = opts.addRandomSuffix ?? false;
  const allowOverwrite = opts.allowOverwrite ?? true;

  return {
    name: 'vercel-blob',
    raw: blob,

    async upload(key, body, options) {
      try {
        const result = await blob.put(key, body as Blob | string, {
          access: 'public',
          token,
          addRandomSuffix,
          allowOverwrite,
          ...(options?.contentType && { contentType: options.contentType }),
          ...(options?.cacheControl && {
            cacheControlMaxAge: parseCacheControlMaxAge(options.cacheControl),
          }),
        });
        const size = await sizeOf(body);
        return {
          key: result.pathname,
          size,
          contentType:
            result.contentType ??
            options?.contentType ??
            'application/octet-stream',
          lastModified: Date.now(),
        } satisfies UploadResult;
      } catch (err) {
        throw mapBlobError(err);
      }
    },

    async download(key, downloadOpts) {
      const info = await this.head(key);
      const url = info.metadata?.url ?? (info as { url?: string }).url ?? '';
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new FilesError(
            res.status === 404 ? 'NotFound' : 'Provider',
            `vercel-blob download failed: ${res.status} ${res.statusText}`
          );
        }
        if (downloadOpts?.as === 'stream' && res.body) {
          const stream = res.body;
          return createStoredFile(
            {
              key: info.key,
              size: info.size,
              type: info.type,
              lastModified: info.lastModified,
              metadata: info.metadata,
            },
            { kind: 'stream', factory: () => stream }
          );
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return createStoredFile(
          {
            key: info.key,
            size: bytes.byteLength,
            type: info.type,
            lastModified: info.lastModified,
            metadata: info.metadata,
          },
          { kind: 'buffer', data: bytes }
        );
      } catch (err) {
        throw mapBlobError(err);
      }
    },

    async head(key) {
      try {
        const result = await blob.head(key, { token });
        return createStoredFile(
          {
            key: result.pathname,
            size: result.size,
            type: result.contentType ?? 'application/octet-stream',
            lastModified: result.uploadedAt?.getTime(),
            metadata: { url: result.url, downloadUrl: result.downloadUrl },
          },
          {
            kind: 'lazy',
            factory: async () => {
              const res = await fetch(result.url);
              return new Uint8Array(await res.arrayBuffer());
            },
          }
        );
      } catch (err) {
        throw mapBlobError(err);
      }
    },

    async delete(key) {
      try {
        await blob.del(key, { token });
      } catch (err) {
        throw mapBlobError(err);
      }
    },

    async copy(from, to) {
      try {
        await blob.copy(from, to, {
          access: 'public',
          token,
          addRandomSuffix,
          allowOverwrite,
        });
      } catch (err) {
        throw mapBlobError(err);
      }
    },

    async list(options): Promise<ListResult> {
      try {
        const result = await blob.list({
          token,
          ...(options?.prefix && { prefix: options.prefix }),
          ...(options?.limit !== undefined && { limit: options.limit }),
          ...(options?.cursor && { cursor: options.cursor }),
        });
        const items: StoredFile[] = result.blobs.map((b) =>
          createStoredFile(
            {
              key: b.pathname,
              size: b.size,
              type: 'application/octet-stream',
              lastModified: b.uploadedAt?.getTime(),
              metadata: { url: b.url, downloadUrl: b.downloadUrl },
            },
            {
              kind: 'lazy',
              factory: async () => {
                const res = await fetch(b.url);
                return new Uint8Array(await res.arrayBuffer());
              },
            }
          )
        );
        return {
          items,
          cursor: result.hasMore ? result.cursor : undefined,
        };
      } catch (err) {
        throw mapBlobError(err);
      }
    },

    async url(key) {
      const info = await this.head(key);
      const url = info.metadata?.url;
      if (!url) {
        throw new FilesError('Provider', 'vercel-blob: missing public URL');
      }
      return url;
    },

    async signedUrl(key, _opts) {
      // Vercel Blob URLs are public and do not expire. `expiresIn` is accepted for API parity but ignored.
      return this.url(key);
    },

    async signedUploadUrl(_key, _opts): Promise<SignedUpload> {
      throw new FilesError(
        'Provider',
        "vercel-blob: signed upload URLs are not available. Use Vercel's `handleUpload()` route handler with the `@vercel/blob/client` package for browser uploads."
      );
    },
  };
}

async function sizeOf(body: Body): Promise<number> {
  if (typeof body === 'string')
    return new TextEncoder().encode(body).byteLength;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof Blob) return body.size;
  return 0;
}

function parseCacheControlMaxAge(header: string): number | undefined {
  const match = /max-age=(\d+)/.exec(header);
  return match?.[1] ? Number(match[1]) : undefined;
}

function mapBlobError(err: unknown): FilesError {
  if (err instanceof FilesError) return err;
  const e = err as { name?: string; message?: string; status?: number };
  const name = e?.name ?? '';
  const status = e?.status;
  if (name.includes('NotFound') || status === 404) {
    return new FilesError('NotFound', e?.message ?? 'Not found', err);
  }
  if (name.includes('Forbidden') || status === 401 || status === 403) {
    return new FilesError('Unauthorized', e?.message ?? 'Unauthorized', err);
  }
  return new FilesError('Provider', e?.message ?? 'vercel-blob error', err);
}
