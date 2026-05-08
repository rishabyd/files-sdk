import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { mockClient } from 'aws-sdk-client-mock';

import { Files, FilesError } from '../src/index.js';
import { s3 } from '../src/s3/index.js';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

function streamBody(bytes: Uint8Array | string) {
  const buf =
    typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
  return sdkStreamMixin(Readable.from(buf));
}

describe('s3 adapter', () => {
  test('upload sends PutObjectCommand with bucket/key/contentType/metadata', async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: '"abc"' });
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    const result = await files.upload('a.txt', 'hello', {
      contentType: 'text/plain',
      metadata: { x: 'y' },
      cacheControl: 'public, max-age=60',
    });
    expect(result.key).toBe('a.txt');
    expect(result.contentType).toBe('text/plain');
    expect(result.etag).toBe('abc');

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.Bucket).toBe('test-bucket');
    expect(calls[0]!.args[0].input.Key).toBe('a.txt');
    expect(calls[0]!.args[0].input.ContentType).toBe('text/plain');
    expect(calls[0]!.args[0].input.Metadata).toEqual({ x: 'y' });
    expect(calls[0]!.args[0].input.CacheControl).toBe('public, max-age=60');
  });

  test('download returns a StoredFile with body bytes', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      Body: streamBody('hello') as unknown as undefined,
      ContentLength: 5,
      ContentType: 'text/plain',
      ETag: '"e"',
    });
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    const got = await files.download('a.txt');
    expect(got.key).toBe('a.txt');
    expect(await got.text()).toBe('hello');
    expect(got.type).toBe('text/plain');
    expect(got.etag).toBe('e');
  });

  test('head returns metadata without fetching body', async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 7,
      ContentType: 'application/json',
      ETag: '"h"',
      Metadata: { foo: 'bar' },
    });
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    const info = await files.head('a.json');
    expect(info.size).toBe(7);
    expect(info.type).toBe('application/json');
    expect(info.etag).toBe('h');
    expect(info.metadata).toEqual({ foo: 'bar' });
    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  test('delete sends DeleteObjectCommand', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    await files.delete('a.txt');
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.Bucket).toBe('test-bucket');
    expect(calls[0]!.args[0].input.Key).toBe('a.txt');
  });

  test('copy sends CopyObjectCommand with encoded source', async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    await files.copy('foo bar.txt', 'to.txt');
    const calls = s3Mock.commandCalls(CopyObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.CopySource).toBe(
      'test-bucket/foo%20bar.txt'
    );
  });

  test('list maps Contents into StoredFile items', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'a/1.txt', Size: 1, ETag: '"1"', LastModified: new Date() },
        { Key: 'a/2.txt', Size: 2, ETag: '"2"', LastModified: new Date() },
      ],
      IsTruncated: true,
      NextContinuationToken: 'next',
    });
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    const out = await files.list({ prefix: 'a/', limit: 10 });
    expect(out.items.map((i) => i.key)).toEqual(['a/1.txt', 'a/2.txt']);
    expect(out.cursor).toBe('next');
    const calls = s3Mock.commandCalls(ListObjectsV2Command);
    expect(calls[0]!.args[0].input.Prefix).toBe('a/');
    expect(calls[0]!.args[0].input.MaxKeys).toBe(10);
  });

  test('url() throws Provider for S3', async () => {
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    try {
      await files.url('a.txt');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FilesError);
      expect((err as FilesError).code).toBe('Provider');
    }
  });

  test('NoSuchKey is mapped to NotFound', async () => {
    s3Mock.on(GetObjectCommand).rejects(
      Object.assign(new Error('nope'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      })
    );
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    try {
      await files.download('missing');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FilesError);
      expect((err as FilesError).code).toBe('NotFound');
    }
  });

  test('AccessDenied is mapped to Unauthorized', async () => {
    s3Mock.on(GetObjectCommand).rejects(
      Object.assign(new Error('denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      })
    );
    const files = new Files({
      adapter: s3({ bucket: 'test-bucket', region: 'us-east-1' }),
    });
    try {
      await files.download('a.txt');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as FilesError).code).toBe('Unauthorized');
    }
  });

  test('missing region throws at construction', () => {
    const oldRegion = process.env.AWS_REGION;
    const oldDefault = process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    try {
      expect(() => s3({ bucket: 'x' })).toThrow(/region/);
    } finally {
      if (oldRegion) process.env.AWS_REGION = oldRegion;
      if (oldDefault) process.env.AWS_DEFAULT_REGION = oldDefault;
    }
  });
});
