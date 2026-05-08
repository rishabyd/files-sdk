import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  Adapter,
  Body,
  SignedUpload,
  StoredFile,
  UploadResult,
} from '../index.js';
import { FilesError } from '../internal/errors.js';
import { createStoredFile } from '../internal/stored-file.js';

export interface S3AdapterOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export type S3Adapter = Adapter<S3Client> & {
  readonly bucket: string;
};

export function s3(opts: S3AdapterOptions): S3Adapter {
  const region =
    opts.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new FilesError(
      'Provider',
      's3 adapter: missing region. Pass `region` or set AWS_REGION.'
    );
  }

  const config: S3ClientConfig = {
    region,
    ...(opts.endpoint && { endpoint: opts.endpoint }),
    ...(opts.forcePathStyle !== undefined && {
      forcePathStyle: opts.forcePathStyle,
    }),
    ...(opts.credentials && { credentials: opts.credentials }),
  };

  const client = new S3Client(config);
  const bucket = opts.bucket;

  return {
    name: 's3',
    raw: client,
    bucket,

    async upload(key, body, options) {
      const { data, contentType, contentLength } = await normalizeBody(
        body,
        options?.contentType
      );
      try {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
            ...(options?.cacheControl && {
              CacheControl: options.cacheControl,
            }),
            ...(options?.metadata && { Metadata: options.metadata }),
            ...(contentLength !== undefined && {
              ContentLength: contentLength,
            }),
          })
        );
        return {
          key,
          size: contentLength ?? 0,
          contentType,
          etag: stripEtag(result.ETag),
          lastModified: undefined,
        } satisfies UploadResult;
      } catch (err) {
        throw mapS3Error(err);
      }
    },

    async download(key, opts) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        const meta = {
          key,
          size: Number(result.ContentLength ?? 0),
          type: result.ContentType ?? 'application/octet-stream',
          lastModified: result.LastModified?.getTime(),
          etag: stripEtag(result.ETag),
          metadata: result.Metadata,
        };
        if (opts?.as === 'stream') {
          const stream = result.Body?.transformToWebStream();
          return createStoredFile(meta, {
            kind: 'stream',
            factory: () => stream ?? emptyStream(),
          });
        }
        const bytes =
          (await result.Body?.transformToByteArray()) ?? new Uint8Array();
        return createStoredFile(meta, { kind: 'buffer', data: bytes });
      } catch (err) {
        throw mapS3Error(err);
      }
    },

    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key })
        );
        return createStoredFile(
          {
            key,
            size: Number(result.ContentLength ?? 0),
            type: result.ContentType ?? 'application/octet-stream',
            lastModified: result.LastModified?.getTime(),
            etag: stripEtag(result.ETag),
            metadata: result.Metadata,
          },
          {
            kind: 'lazy',
            factory: async () => {
              const get = await client.send(
                new GetObjectCommand({ Bucket: bucket, Key: key })
              );
              return (
                (await get.Body?.transformToByteArray()) ?? new Uint8Array()
              );
            },
          }
        );
      } catch (err) {
        throw mapS3Error(err);
      }
    },

    async delete(key) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key })
        );
      } catch (err) {
        throw mapS3Error(err);
      }
    },

    async copy(from, to) {
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: to,
            CopySource: `${bucket}/${encodeURIComponent(from)}`,
          })
        );
      } catch (err) {
        throw mapS3Error(err);
      }
    },

    async list(options) {
      try {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ...(options?.prefix && { Prefix: options.prefix }),
            ...(options?.limit !== undefined && { MaxKeys: options.limit }),
            ...(options?.cursor && { ContinuationToken: options.cursor }),
          })
        );
        const items: StoredFile[] = (result.Contents ?? []).map((obj) => {
          const objKey = obj.Key ?? '';
          return createStoredFile(
            {
              key: objKey,
              size: Number(obj.Size ?? 0),
              type: 'application/octet-stream',
              lastModified: obj.LastModified?.getTime(),
              etag: stripEtag(obj.ETag),
            },
            {
              kind: 'lazy',
              factory: async () => {
                const get = await client.send(
                  new GetObjectCommand({ Bucket: bucket, Key: objKey })
                );
                return (
                  (await get.Body?.transformToByteArray()) ?? new Uint8Array()
                );
              },
            }
          );
        });
        return {
          items,
          cursor: result.IsTruncated ? result.NextContinuationToken : undefined,
        };
      } catch (err) {
        throw mapS3Error(err);
      }
    },

    async url(_key) {
      throw new FilesError(
        'Provider',
        'S3 buckets do not expose a public URL by default. Use signedUrl() instead.'
      );
    },

    async signedUrl(key, signOpts) {
      try {
        return await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: signOpts.expiresIn }
        );
      } catch (err) {
        throw mapS3Error(err);
      }
    },

    async signedUploadUrl(key, signOpts): Promise<SignedUpload> {
      try {
        if (signOpts.maxSize !== undefined) {
          const conditions: Array<
            [string, ...unknown[]] | Record<string, string>
          > = [['content-length-range', 0, signOpts.maxSize]];
          if (signOpts.contentType) {
            conditions.push(['eq', '$Content-Type', signOpts.contentType]);
          }
          const post = await createPresignedPost(client, {
            Bucket: bucket,
            Key: key,
            Expires: signOpts.expiresIn,
            Conditions: conditions as Parameters<
              typeof createPresignedPost
            >[1]['Conditions'],
            ...(signOpts.contentType && {
              Fields: { 'Content-Type': signOpts.contentType },
            }),
          });
          return { method: 'POST', url: post.url, fields: post.fields };
        }
        const url = await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(signOpts.contentType && { ContentType: signOpts.contentType }),
          }),
          { expiresIn: signOpts.expiresIn }
        );
        return {
          method: 'PUT',
          url,
          headers: signOpts.contentType
            ? { 'Content-Type': signOpts.contentType }
            : undefined,
        };
      } catch (err) {
        throw mapS3Error(err);
      }
    },
  };
}

async function normalizeBody(
  body: Body,
  contentTypeHint?: string
): Promise<{
  data: Uint8Array | ReadableStream<Uint8Array> | string;
  contentType: string;
  contentLength?: number;
}> {
  if (typeof body === 'string') {
    const data = new TextEncoder().encode(body);
    return {
      data,
      contentType: contentTypeHint ?? 'text/plain; charset=utf-8',
      contentLength: data.byteLength,
    };
  }
  if (body instanceof Uint8Array) {
    return {
      data: body,
      contentType: contentTypeHint ?? 'application/octet-stream',
      contentLength: body.byteLength,
    };
  }
  if (body instanceof ArrayBuffer) {
    const data = new Uint8Array(body);
    return {
      data,
      contentType: contentTypeHint ?? 'application/octet-stream',
      contentLength: data.byteLength,
    };
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return {
      data,
      contentType: contentTypeHint ?? 'application/octet-stream',
      contentLength: data.byteLength,
    };
  }
  if (body instanceof Blob) {
    const buf = new Uint8Array(await body.arrayBuffer());
    return {
      data: buf,
      contentType: contentTypeHint ?? body.type ?? 'application/octet-stream',
      contentLength: buf.byteLength,
    };
  }
  // ReadableStream
  return {
    data: body,
    contentType: contentTypeHint ?? 'application/octet-stream',
  };
}

function stripEtag(etag: string | undefined): string | undefined {
  if (!etag) return undefined;
  return etag.replace(/^"+|"+$/g, '');
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

export function mapS3Error(err: unknown): FilesError {
  if (err instanceof FilesError) return err;
  const e = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
    message?: string;
  };
  const status = e?.$metadata?.httpStatusCode;
  const code = e?.name ?? e?.Code;
  if (code === 'NoSuchKey' || code === 'NotFound' || status === 404) {
    return new FilesError('NotFound', e?.message ?? 'Not found', err);
  }
  if (code === 'AccessDenied' || status === 401 || status === 403) {
    return new FilesError('Unauthorized', e?.message ?? 'Unauthorized', err);
  }
  if (code === 'PreconditionFailed' || status === 409 || status === 412) {
    return new FilesError('Conflict', e?.message ?? 'Conflict', err);
  }
  return new FilesError('Provider', e?.message ?? 'S3 error', err);
}
