import { describe, expect, test } from 'bun:test';
import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

import { Files, FilesError } from '../src/index.js';
import { r2 } from '../src/r2/index.js';

describe('r2 adapter — HTTP path', () => {
  test('uses S3-compatible endpoint with auto region and path-style', async () => {
    const adapter = r2({
      bucket: 'uploads',
      accountId: 'ACCT',
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
    });
    expect(adapter.name).toBe('r2-http');
    const client = adapter.raw as S3Client;
    expect(await client.config.region()).toBe('auto');
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe('acct.r2.cloudflarestorage.com');
  });

  test('missing accountId throws at construction', () => {
    const oldId = process.env.R2_ACCOUNT_ID;
    const oldKey = process.env.R2_ACCESS_KEY_ID;
    const oldSecret = process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    try {
      expect(() => r2({ bucket: 'uploads' })).toThrow(/accountId/);
    } finally {
      if (oldId) process.env.R2_ACCOUNT_ID = oldId;
      if (oldKey) process.env.R2_ACCESS_KEY_ID = oldKey;
      if (oldSecret) process.env.R2_SECRET_ACCESS_KEY = oldSecret;
    }
  });

  test('url() throws Provider with helpful message', async () => {
    const files = new Files({
      adapter: r2({
        bucket: 'uploads',
        accountId: 'ACCT',
        accessKeyId: 'K',
        secretAccessKey: 'S',
      }),
    });
    try {
      await files.url('a.txt');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FilesError);
      expect((err as FilesError).code).toBe('Provider');
      expect((err as FilesError).message).toMatch(/r2.dev|custom domain/);
    }
  });

  test('delegates upload to underlying S3 client', async () => {
    const s3Mock = mockClient(S3Client);
    s3Mock.reset();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"ok"' });
    const files = new Files({
      adapter: r2({
        bucket: 'uploads',
        accountId: 'ACCT',
        accessKeyId: 'K',
        secretAccessKey: 'S',
      }),
    });
    const result = await files.upload('a.txt', 'hi');
    expect(result.etag).toBe('ok');
    s3Mock.reset();
  });
});

describe('r2 adapter — Workers binding path', () => {
  function fakeBinding() {
    const map = new Map<
      string,
      {
        bytes: Uint8Array;
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
        etag: string;
        uploaded: Date;
        size: number;
      }
    >();
    let counter = 0;
    const bucket = {
      async put(
        key: string,
        body: ArrayBuffer | string,
        opts?: {
          httpMetadata?: { contentType?: string };
          customMetadata?: Record<string, string>;
        }
      ) {
        const bytes =
          typeof body === 'string'
            ? new TextEncoder().encode(body)
            : new Uint8Array(body);
        const entry = {
          bytes,
          httpMetadata: opts?.httpMetadata,
          customMetadata: opts?.customMetadata,
          etag: `etag-${++counter}`,
          uploaded: new Date(),
          size: bytes.byteLength,
        };
        map.set(key, entry);
        return {
          key,
          size: entry.size,
          etag: entry.etag,
          uploaded: entry.uploaded,
          httpMetadata: entry.httpMetadata,
          customMetadata: entry.customMetadata,
        };
      },
      async get(key: string) {
        const entry = map.get(key);
        if (!entry) return null;
        return {
          key,
          size: entry.size,
          etag: entry.etag,
          uploaded: entry.uploaded,
          httpMetadata: entry.httpMetadata,
          customMetadata: entry.customMetadata,
          body: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(entry.bytes);
              c.close();
            },
          }),
          arrayBuffer: async () =>
            entry.bytes.buffer.slice(
              entry.bytes.byteOffset,
              entry.bytes.byteOffset + entry.bytes.byteLength
            ),
          text: async () => new TextDecoder().decode(entry.bytes),
        };
      },
      async head(key: string) {
        const entry = map.get(key);
        if (!entry) return null;
        return {
          key,
          size: entry.size,
          etag: entry.etag,
          uploaded: entry.uploaded,
          httpMetadata: entry.httpMetadata,
          customMetadata: entry.customMetadata,
        };
      },
      async delete(key: string) {
        map.delete(key);
      },
      async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
        const prefix = opts?.prefix ?? '';
        const objects = [...map.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => ({
            key: k,
            size: v.size,
            etag: v.etag,
            uploaded: v.uploaded,
            httpMetadata: v.httpMetadata,
            customMetadata: v.customMetadata,
          }));
        return { objects, truncated: false, cursor: undefined };
      },
    };
    return { bucket, map };
  }

  test('upload + download via binding', async () => {
    const { bucket } = fakeBinding();
    const files = new Files({
      adapter: r2({
        binding: bucket as unknown as Parameters<typeof r2>[0] extends {
          binding: infer B;
        }
          ? B
          : never,
      }),
    });
    await files.upload('a.txt', 'hello', { contentType: 'text/plain' });
    const got = await files.download('a.txt');
    expect(await got.text()).toBe('hello');
    expect(got.type).toBe('text/plain');
  });

  test('delete + head returning NotFound', async () => {
    const { bucket } = fakeBinding();
    const files = new Files({ adapter: r2({ binding: bucket as never }) });
    await files.upload('a.txt', 'x');
    await files.delete('a.txt');
    try {
      await files.head('a.txt');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as FilesError).code).toBe('NotFound');
    }
  });

  test('copy round-trips body since binding has no native copy', async () => {
    const { bucket } = fakeBinding();
    const files = new Files({ adapter: r2({ binding: bucket as never }) });
    await files.upload('from.txt', 'payload', { contentType: 'text/plain' });
    await files.copy('from.txt', 'to.txt');
    const got = await files.download('to.txt');
    expect(await got.text()).toBe('payload');
    expect(got.type).toBe('text/plain');
  });

  test('signedUrl from binding throws Provider', async () => {
    const { bucket } = fakeBinding();
    const files = new Files({ adapter: r2({ binding: bucket as never }) });
    await files.upload('a.txt', 'x');
    try {
      await files.signedUrl('a.txt', { expiresIn: 60 });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as FilesError).code).toBe('Provider');
    }
  });
});
