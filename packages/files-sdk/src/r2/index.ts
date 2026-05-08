import type { S3Client } from "@aws-sdk/client-s3";
import type {
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from "@cloudflare/workers-types";

import type {
  Adapter,
  Body,
  DownloadOptions,
  StoredFile,
  UploadResult,
} from "../index.js";
import { FilesError } from "../internal/errors.js";
import { createStoredFile } from "../internal/stored-file.js";
import { s3 } from "../s3/index.js";

export interface R2HttpOptions {
  bucket: string;
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface R2BindingOptions {
  binding: R2Bucket;
  bucket?: string;
}

export type R2AdapterOptions = R2BindingOptions | R2HttpOptions;

export type R2Adapter = Adapter<S3Client | R2Bucket>;

const normalizeForR2 = async (
  body: Body,
  contentTypeHint?: string
): Promise<{
  data: ArrayBuffer | ReadableStream<Uint8Array> | string;
  contentType: string;
  contentLength?: number;
}> => {
  if (typeof body === "string") {
    return {
      contentLength: new TextEncoder().encode(body).byteLength,
      contentType: contentTypeHint ?? "text/plain; charset=utf-8",
      data: body,
    };
  }
  if (body instanceof Uint8Array) {
    const buf = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ) as ArrayBuffer;
    return {
      contentLength: buf.byteLength,
      contentType: contentTypeHint ?? "application/octet-stream",
      data: buf,
    };
  }
  if (body instanceof ArrayBuffer) {
    return {
      contentLength: body.byteLength,
      contentType: contentTypeHint ?? "application/octet-stream",
      data: body,
    };
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const buf = view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength
    ) as ArrayBuffer;
    return {
      contentLength: buf.byteLength,
      contentType: contentTypeHint ?? "application/octet-stream",
      data: buf,
    };
  }
  if (body instanceof Blob) {
    const buf = await body.arrayBuffer();
    return {
      contentLength: buf.byteLength,
      contentType: contentTypeHint ?? body.type ?? "application/octet-stream",
      data: buf,
    };
  }
  return {
    contentType: contentTypeHint ?? "application/octet-stream",
    data: body,
  };
};

const r2ObjectToStoredFile = (
  obj: R2Object | R2ObjectBody,
  downloadOpts?: DownloadOptions,
  fallbackBody?: () => Promise<Uint8Array>
): StoredFile => {
  const meta = {
    etag: obj.etag,
    key: obj.key,
    lastModified: obj.uploaded.getTime(),
    metadata: obj.customMetadata,
    size: obj.size,
    type: obj.httpMetadata?.contentType ?? "application/octet-stream",
  };
  if ("body" in obj && obj.body) {
    if (downloadOpts?.as === "stream") {
      const stream = obj.body as unknown as ReadableStream<Uint8Array>;
      return createStoredFile(meta, { factory: () => stream, kind: "stream" });
    }
    return createStoredFile(meta, {
      factory: async () => new Uint8Array(await obj.arrayBuffer()),
      kind: "lazy",
    });
  }
  return createStoredFile(meta, {
    factory: fallbackBody ?? (() => Promise.resolve(new Uint8Array())),
    kind: "lazy",
  });
};

// R2 binding errors throw with `name` (string) and `code` (number) fields.
// See https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
// for the published code list. We classify the common ones; unknowns fall
// through to "Provider" so callers can still distinguish failures from success.
const mapR2Error = (err: unknown): FilesError => {
  if (err instanceof FilesError) {
    return err;
  }
  const e = err as { name?: string; code?: number; message?: string };
  const name = e?.name ?? "";
  const code = e?.code;
  const message =
    e?.message ?? (err instanceof Error ? err.message : String(err));

  if (name.includes("NotFound") || name.includes("NoSuch") || code === 10_002) {
    return new FilesError("NotFound", message, err);
  }
  if (name.includes("Precondition") || code === 10_007) {
    return new FilesError("Conflict", message, err);
  }
  if (
    name.includes("Forbidden") ||
    name.includes("Unauthorized") ||
    code === 10_004 ||
    code === 10_006
  ) {
    return new FilesError("Unauthorized", message, err);
  }
  return new FilesError("Provider", message, err);
};

const r2FromBinding = (opts: R2BindingOptions): R2Adapter => {
  const bucket = opts.binding;

  return {
    async copy(from, to) {
      // R2 bindings have no server-side copy, so this is a read-then-write.
      // Stream the body straight through `put` instead of buffering the whole
      // object — multi-GB copies would otherwise blow past the Worker's
      // memory limit. Source and destination are not atomic; concurrent
      // mutations to `from` between the get and put are not detected.
      const obj = await bucket.get(from);
      if (!obj) {
        throw new FilesError("NotFound", `Object not found: ${from}`);
      }
      try {
        await bucket.put(to, obj.body, {
          customMetadata: obj.customMetadata,
          httpMetadata: obj.httpMetadata,
        });
      } catch (error) {
        throw mapR2Error(error);
      }
    },
    async delete(key) {
      try {
        await bucket.delete(key);
      } catch (error) {
        throw mapR2Error(error);
      }
    },
    async download(key, downloadOpts) {
      let obj: Awaited<ReturnType<typeof bucket.get>>;
      try {
        obj = await bucket.get(key);
      } catch (error) {
        throw mapR2Error(error);
      }
      if (!obj) {
        throw new FilesError("NotFound", `Object not found: ${key}`);
      }
      return r2ObjectToStoredFile(obj, downloadOpts);
    },
    async head(key) {
      let obj: Awaited<ReturnType<typeof bucket.head>>;
      try {
        obj = await bucket.head(key);
      } catch (error) {
        throw mapR2Error(error);
      }
      if (!obj) {
        throw new FilesError("NotFound", `Object not found: ${key}`);
      }
      return r2ObjectToStoredFile(obj, undefined, async () => {
        const got = await bucket.get(obj.key);
        if (!got) {
          return new Uint8Array();
        }
        return new Uint8Array(await got.arrayBuffer());
      });
    },
    async list(options) {
      let result: Awaited<ReturnType<typeof bucket.list>>;
      try {
        result = await bucket.list({
          ...(options?.prefix && { prefix: options.prefix }),
          ...(options?.limit !== undefined && { limit: options.limit }),
          ...(options?.cursor && { cursor: options.cursor }),
        });
      } catch (error) {
        throw mapR2Error(error);
      }
      const items: StoredFile[] = result.objects.map((obj) =>
        createStoredFile(
          {
            etag: obj.etag,
            key: obj.key,
            lastModified: obj.uploaded.getTime(),
            metadata: obj.customMetadata,
            size: obj.size,
            type: obj.httpMetadata?.contentType ?? "application/octet-stream",
          },
          {
            factory: async () => {
              const got = await bucket.get(obj.key);
              if (!got) {
                return new Uint8Array();
              }
              return new Uint8Array(await got.arrayBuffer());
            },
            kind: "lazy",
          }
        )
      );
      return {
        cursor: result.truncated ? result.cursor : undefined,
        items,
      };
    },
    name: "r2-binding",
    raw: bucket,
    signedUploadUrl(_key, _opts) {
      throw new FilesError(
        "Provider",
        "r2 binding: signed upload URLs are not supported via the Workers binding. Use the HTTP adapter for presigned URLs."
      );
    },
    signedUrl(_key, _opts) {
      throw new FilesError(
        "Provider",
        "r2 binding: signed URLs are not supported via the Workers binding. Use the HTTP adapter (r2({ accountId, accessKeyId, secretAccessKey, bucket })) for presigned URLs."
      );
    },
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
          contentType,
          etag: result?.etag,
          key,
          lastModified: result?.uploaded?.getTime(),
          size: result?.size ?? contentLength ?? 0,
        } satisfies UploadResult;
      } catch (error) {
        throw mapR2Error(error);
      }
    },
    url(_key) {
      throw new FilesError(
        "Provider",
        "r2 binding: public URLs are not available via the Workers binding. Configure an r2.dev or custom domain on the bucket and build URLs manually."
      );
    },
  };
};

const r2FromHttp = (opts: R2HttpOptions): R2Adapter => {
  const accountId = opts.accountId ?? process.env.R2_ACCOUNT_ID;
  const accessKeyId = opts.accessKeyId ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey =
    opts.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId) {
    throw new FilesError(
      "Provider",
      "r2 adapter: missing accountId. Pass `accountId` or set R2_ACCOUNT_ID."
    );
  }
  if (!(accessKeyId && secretAccessKey)) {
    throw new FilesError(
      "Provider",
      "r2 adapter: missing credentials. Pass `accessKeyId` + `secretAccessKey` or set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY."
    );
  }

  const inner = s3({
    bucket: opts.bucket,
    credentials: { accessKeyId, secretAccessKey },
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    region: "auto",
  });

  return {
    ...inner,
    name: "r2-http",
    url(_key) {
      throw new FilesError(
        "Provider",
        "r2 adapter: public URLs require a configured r2.dev or custom domain. Build URLs manually for now."
      );
    },
  };
};

export const r2 = (opts: R2AdapterOptions): R2Adapter => {
  if ("binding" in opts && opts.binding) {
    return r2FromBinding(opts);
  }
  return r2FromHttp(opts as R2HttpOptions);
};

// Re-export R2 type so consumers don't need to import workers-types directly.
export type { R2Bucket } from "@cloudflare/workers-types";
