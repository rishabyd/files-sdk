import * as blob from "@vercel/blob";

import type {
  Adapter,
  Body,
  ListResult,
  SignedUpload,
  StoredFile,
  UploadResult,
} from "../index.js";
import { FilesError } from "../internal/errors.js";
import type { FilesErrorCode } from "../internal/errors.js";
import { createStoredFile } from "../internal/stored-file.js";

export interface VercelBlobAdapterOptions {
  token?: string;
  /**
   * Add a random suffix to uploaded keys (Vercel default).
   *
   * When `false`, the resulting pathname matches the key 1:1, which keeps
   * the API consistent with S3/R2 where callers expect to control the key.
   * Defaults to `false`.
   */
  addRandomSuffix?: boolean;
  /**
   * Allow overwriting existing keys on upload. Defaults to `true` so that the
   * "predictable keys" behavior (`addRandomSuffix: false`) actually works —
   * Vercel rejects same-pathname uploads otherwise.
   *
   * **Trade-off:** with the defaults, an `upload(key, ...)` call silently
   * clobbers any existing object at `key`. If keys are derived from
   * untrusted input or your callers expect "create-only" semantics, set
   * `allowOverwrite: false` and handle the resulting Conflict.
   */
  allowOverwrite?: boolean;
  /**
   * Timeout in milliseconds for public-URL fetches issued by `download()`,
   * and by lazy bodies returned from `head()`/`list()`. A hung CDN response
   * would otherwise leak a fetch that never resolves.
   *
   * Defaults to 300_000 (5 minutes). Pass `0` to disable the timeout (not
   * recommended in server contexts — a stuck request will pin a connection
   * until the runtime tears it down).
   */
  downloadTimeoutMs?: number;
}

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300_000;

const fetchWithTimeout = (
  url: string,
  timeoutMs: number
): Promise<Response> => {
  if (timeoutMs <= 0) {
    return fetch(url);
  }
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
};

export type VercelBlobClient = typeof blob;

export type VercelBlobAdapter = Adapter<VercelBlobClient>;

const sizeOf = (body: Body): number | undefined => {
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  return undefined;
};

const parseCacheControlMaxAge = (header: string): number | undefined => {
  const match = /max-age=(\d+)/u.exec(header);
  return match?.[1] ? Number(match[1]) : undefined;
};

// Prefer HTTP status codes (stable contract) over error name substrings
// (e.g. "BlobNotFoundError"), which would silently break if @vercel/blob
// renames its error classes upstream. Name matching is kept as a fallback
// for environments where the underlying fetch error doesn't surface a status.
const classifyBlobError = (
  status: number | undefined,
  name: string
): FilesErrorCode => {
  if (status === 404 || name.includes("NotFound")) {
    return "NotFound";
  }
  if (
    status === 401 ||
    status === 403 ||
    name.includes("Forbidden") ||
    name.includes("Unauthorized")
  ) {
    return "Unauthorized";
  }
  if (status === 409 || status === 412 || name.includes("Precondition")) {
    return "Conflict";
  }
  return "Provider";
};

const DEFAULT_BLOB_MESSAGES: Record<FilesErrorCode, string> = {
  Conflict: "Conflict",
  NotFound: "Not found",
  Provider: "vercel-blob error",
  Unauthorized: "Unauthorized",
};

const mapBlobError = (err: unknown): FilesError => {
  if (err instanceof FilesError) {
    return err;
  }
  const e = err as { name?: string; message?: string; status?: number };
  const code = classifyBlobError(e?.status, e?.name ?? "");
  return new FilesError(code, e?.message ?? DEFAULT_BLOB_MESSAGES[code], err);
};

export const vercelBlob = (
  opts: VercelBlobAdapterOptions = {}
): VercelBlobAdapter => {
  const token = opts.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new FilesError(
      "Provider",
      "vercelBlob adapter: missing token. Pass `token` or set BLOB_READ_WRITE_TOKEN."
    );
  }

  const addRandomSuffix = opts.addRandomSuffix ?? false;
  const allowOverwrite = opts.allowOverwrite ?? true;
  const downloadTimeoutMs =
    opts.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;

  // BLOB_READ_WRITE_TOKEN format is `vercel_blob_rw_<storeId>_<random>`.
  // The 4th `_`-separated segment is the storeId, which is also the URL
  // subdomain. We use this to synthesize URLs without a round trip when the
  // pathname is predictable (i.e. `addRandomSuffix: false`). If the token
  // format ever changes, `storeId` will be `undefined` and `url()` falls
  // back to a head() call automatically.
  const tokenParts = token.split("_");
  const storeId = tokenParts.length >= 4 ? tokenParts.at(3) : undefined;

  const headRaw = async (key: string) => {
    try {
      return await blob.head(key, { token });
    } catch (error) {
      throw mapBlobError(error);
    }
  };

  return {
    async copy(from, to) {
      try {
        await blob.copy(from, to, {
          access: "public",
          addRandomSuffix,
          allowOverwrite,
          token,
        });
      } catch (error) {
        throw mapBlobError(error);
      }
    },
    async delete(key) {
      try {
        await blob.del(key, { token });
      } catch (error) {
        throw mapBlobError(error);
      }
    },
    async download(key, downloadOpts) {
      const result = await headRaw(key);
      try {
        const res = await fetchWithTimeout(result.url, downloadTimeoutMs);
        if (!res.ok) {
          throw new FilesError(
            res.status === 404 ? "NotFound" : "Provider",
            `vercel-blob download failed: ${res.status} ${res.statusText}`
          );
        }
        const meta = {
          etag: result.etag,
          key: result.pathname,
          lastModified: result.uploadedAt?.getTime(),
          type: result.contentType ?? "application/octet-stream",
        };
        if (downloadOpts?.as === "stream" && res.body) {
          const stream = res.body;
          return createStoredFile(
            { ...meta, size: result.size },
            { factory: () => stream, kind: "stream" }
          );
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return createStoredFile(
          { ...meta, size: bytes.byteLength },
          { data: bytes, kind: "buffer" }
        );
      } catch (error) {
        throw mapBlobError(error);
      }
    },
    async head(key) {
      const result = await headRaw(key);
      return createStoredFile(
        {
          etag: result.etag,
          key: result.pathname,
          lastModified: result.uploadedAt?.getTime(),
          size: result.size,
          type: result.contentType ?? "application/octet-stream",
        },
        {
          factory: async () => {
            const res = await fetchWithTimeout(result.url, downloadTimeoutMs);
            return new Uint8Array(await res.arrayBuffer());
          },
          kind: "lazy",
        }
      );
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
              etag: b.etag,
              key: b.pathname,
              lastModified: b.uploadedAt?.getTime(),
              size: b.size,
              type: "application/octet-stream",
            },
            {
              factory: async () => {
                const res = await fetchWithTimeout(b.url, downloadTimeoutMs);
                return new Uint8Array(await res.arrayBuffer());
              },
              kind: "lazy",
            }
          )
        );
        return {
          cursor: result.hasMore ? result.cursor : undefined,
          items,
        };
      } catch (error) {
        throw mapBlobError(error);
      }
    },
    name: "vercel-blob",
    raw: blob,
    signedUploadUrl(_key, _opts): Promise<SignedUpload> {
      throw new FilesError(
        "Provider",
        "vercel-blob: signed upload URLs are not available. Use Vercel's `handleUpload()` route handler with the `@vercel/blob/client` package for browser uploads."
      );
    },
    signedUrl(_key, _opts): Promise<string> {
      // Vercel Blob URLs are public and do not expire. Returning `url()` would silently violate
      // the caller's `expiresIn` contract — a 5-minute "signed" URL would actually live forever.
      // Callers who want a public URL should call `url()` explicitly.
      throw new FilesError(
        "Provider",
        "vercel-blob: signed URLs are not supported. Vercel Blob URLs are public and do not expire — call `url()` instead if a permanent public URL is acceptable."
      );
    },
    async upload(key, body, options) {
      try {
        const result = await blob.put(key, body as Blob | string, {
          access: "public",
          addRandomSuffix,
          allowOverwrite,
          token,
          ...(options?.contentType && { contentType: options.contentType }),
          ...(options?.cacheControl && {
            cacheControlMaxAge: parseCacheControlMaxAge(options.cacheControl),
          }),
        });
        // Vercel's PutBlobResult has no size; for stream bodies we can't compute
        // it locally, so fall back to a follow-up head() to get the authoritative
        // size (and lastModified). For known-size bodies, skip the extra round trip.
        const localSize = sizeOf(body);
        let size = localSize;
        let lastModified = Date.now();
        if (size === undefined) {
          const { size: headSize, uploadedAt } = await blob.head(result.url, {
            token,
          });
          size = headSize;
          lastModified = uploadedAt?.getTime() ?? lastModified;
        }
        return {
          contentType:
            result.contentType ??
            options?.contentType ??
            "application/octet-stream",
          etag: result.etag,
          key: result.pathname,
          lastModified,
          size,
        } satisfies UploadResult;
      } catch (error) {
        throw mapBlobError(error);
      }
    },
    async url(key) {
      // Fast path: with a known storeId and predictable keys, derive the
      // URL without an API call. `addRandomSuffix: true` makes the actual
      // pathname unknowable in advance, so we have to head() in that case.
      if (storeId && !addRandomSuffix) {
        return `https://${storeId}.public.blob.vercel-storage.com/${key}`;
      }
      const result = await headRaw(key);
      if (!result.url) {
        throw new FilesError("Provider", "vercel-blob: missing public URL");
      }
      return result.url;
    },
  };
};
