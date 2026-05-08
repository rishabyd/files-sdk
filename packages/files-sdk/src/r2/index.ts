import type { S3Client } from '@aws-sdk/client-s3';
import type {
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from '@cloudflare/workers-types';

import type {
  Adapter,
  Body,
  DownloadOptions,
  StoredFile,
  UploadResult,
} from '../index.js';
import { FilesError } from '../internal/errors.js';
import { createStoredFile } from '../internal/stored-file.js';
import { s3 } from '../s3/index.js';

export type R2HttpOptions = {
  bucket: string;
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type R2BindingOptions = {
  binding: R2Bucket;
  bucket?: string;
};

export type R2AdapterOptions = R2BindingOptions | R2HttpOptions;

export type R2Adapter = Adapter<S3Client | R2Bucket>;

export function r2(opts: R2AdapterOptions): R2Adapter {
  if ('binding' in opts && opts.binding) {
    return r2FromBinding(opts);
  }
  return r2FromHttp(opts as R2HttpOptions);
}

function r2FromBinding(opts: R2BindingOptions): R2Adapter {
  const bucket = opts.binding;

  return {
    name: 'r2-binding',
    raw: bucket,

    async upload(key, body, options) {
      const { data, contentType, contentLength } = await normalizeForR2(
        body,
        options?.contentType
      );
      try {
        const value = data as Parameters<typeof bucket.put>[1];
        const result = await bucket.put(key, value, {
          httpMetadata: {
            contentType,
            ...(options?.cacheControl && {
              cacheControl: options.cacheControl,
            }),
          },
          ...(options?.metadata && { customMetadata: options.metadata }),
        });
        return {
          key,
          size: result?.size ?? contentLength ?? 0,
          contentType,
          etag: result?.etag,
          lastModified: result?.uploaded?.getTime(),
        } satisfies UploadResult;
      } catch (err) {
        throw mapR2Error(err);
      }
    },

    async download(key, downloadOpts) {
      const obj = await bucket.get(key);
      if (!obj) throw new FilesError('NotFound', `Object not found: ${key}`);
      return r2ObjectToStoredFile(obj, downloadOpts);
    },

    async head(key) {
      const obj = await bucket.head(key);
      if (!obj) throw new FilesError('NotFound', `Object not found: ${key}`);
      return r2ObjectToStoredFile(obj, undefined, async () => {
        const got = await bucket.get(obj.key);
        if (!got) return new Uint8Array();
        return new Uint8Array(await got.arrayBuffer());
      });
    },

    async delete(key) {
      await bucket.delete(key);
    },

    async copy(from, to) {
      const obj = await bucket.get(from);
      if (!obj) throw new FilesError('NotFound', `Object not found: ${from}`);
      const data = await obj.arrayBuffer();
      await bucket.put(to, data, {
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
      });
    },

    async list(options) {
      const result = await bucket.list({
        ...(options?.prefix && { prefix: options.prefix }),
        ...(options?.limit !== undefined && { limit: options.limit }),
        ...(options?.cursor && { cursor: options.cursor }),
      });
      const items: StoredFile[] = result.objects.map((obj) =>
        createStoredFile(
          {
            key: obj.key,
            size: obj.size,
            type: obj.httpMetadata?.contentType ?? 'application/octet-stream',
            lastModified: obj.uploaded.getTime(),
            etag: obj.etag,
            metadata: obj.customMetadata,
          },
          {
            kind: 'lazy',
            factory: async () => {
              const got = await bucket.get(obj.key);
              if (!got) return new Uint8Array();
              return new Uint8Array(await got.arrayBuffer());
            },
          }
        )
      );
      return {
        items,
        cursor: result.truncated ? result.cursor : undefined,
      };
    },

    async url(_key) {
      throw new FilesError(
        'Provider',
        'r2 binding: public URLs are not available via the Workers binding. Configure an r2.dev or custom domain on the bucket and build URLs manually.'
      );
    },

    async signedUrl(_key, _opts) {
      throw new FilesError(
        'Provider',
        'r2 binding: signed URLs are not supported via the Workers binding. Use the HTTP adapter (r2({ accountId, accessKeyId, secretAccessKey, bucket })) for presigned URLs.'
      );
    },

    async signedUploadUrl(_key, _opts) {
      throw new FilesError(
        'Provider',
        'r2 binding: signed upload URLs are not supported via the Workers binding. Use the HTTP adapter for presigned URLs.'
      );
    },
  };
}

function r2FromHttp(opts: R2HttpOptions): R2Adapter {
  const accountId = opts.accountId ?? process.env.R2_ACCOUNT_ID;
  const accessKeyId = opts.accessKeyId ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey =
    opts.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId) {
    throw new FilesError(
      'Provider',
      'r2 adapter: missing accountId. Pass `accountId` or set R2_ACCOUNT_ID.'
    );
  }
  if (!(accessKeyId && secretAccessKey)) {
    throw new FilesError(
      'Provider',
      'r2 adapter: missing credentials. Pass `accessKeyId` + `secretAccessKey` or set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY.'
    );
  }

  const inner = s3({
    bucket: opts.bucket,
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    ...inner,
    name: 'r2-http',
    async url(_key) {
      throw new FilesError(
        'Provider',
        'r2 adapter: public URLs require a configured r2.dev or custom domain. Build URLs manually for now.'
      );
    },
  };
}

async function normalizeForR2(
  body: Body,
  contentTypeHint?: string
): Promise<{
  data: ArrayBuffer | ReadableStream<Uint8Array> | string;
  contentType: string;
  contentLength?: number;
}> {
  if (typeof body === 'string') {
    return {
      data: body,
      contentType: contentTypeHint ?? 'text/plain; charset=utf-8',
      contentLength: new TextEncoder().encode(body).byteLength,
    };
  }
  if (body instanceof Uint8Array) {
    const buf = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ) as ArrayBuffer;
    return {
      data: buf,
      contentType: contentTypeHint ?? 'application/octet-stream',
      contentLength: buf.byteLength,
    };
  }
  if (body instanceof ArrayBuffer) {
    return {
      data: body,
      contentType: contentTypeHint ?? 'application/octet-stream',
      contentLength: body.byteLength,
    };
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const buf = view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength
    ) as ArrayBuffer;
    return {
      data: buf,
      contentType: contentTypeHint ?? 'application/octet-stream',
      contentLength: buf.byteLength,
    };
  }
  if (body instanceof Blob) {
    const buf = await body.arrayBuffer();
    return {
      data: buf,
      contentType: contentTypeHint ?? body.type ?? 'application/octet-stream',
      contentLength: buf.byteLength,
    };
  }
  return {
    data: body,
    contentType: contentTypeHint ?? 'application/octet-stream',
  };
}

function r2ObjectToStoredFile(
  obj: R2Object | R2ObjectBody,
  downloadOpts?: DownloadOptions,
  fallbackBody?: () => Promise<Uint8Array>
): StoredFile {
  const meta = {
    key: obj.key,
    size: obj.size,
    type: obj.httpMetadata?.contentType ?? 'application/octet-stream',
    lastModified: obj.uploaded.getTime(),
    etag: obj.etag,
    metadata: obj.customMetadata,
  };
  if ('body' in obj && obj.body) {
    if (downloadOpts?.as === 'stream') {
      const stream = obj.body as unknown as ReadableStream<Uint8Array>;
      return createStoredFile(meta, { kind: 'stream', factory: () => stream });
    }
    return createStoredFile(meta, {
      kind: 'lazy',
      factory: async () => new Uint8Array(await obj.arrayBuffer()),
    });
  }
  return createStoredFile(meta, {
    kind: 'lazy',
    factory: fallbackBody ?? (() => Promise.resolve(new Uint8Array())),
  });
}

function mapR2Error(err: unknown): FilesError {
  if (err instanceof FilesError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new FilesError('Provider', message, err);
}

// Re-export R2 type so consumers don't need to import workers-types directly.
export type { R2Bucket } from '@cloudflare/workers-types';
