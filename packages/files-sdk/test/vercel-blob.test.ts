import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { Files, FilesError } from '../src/index.js';

// Mock @vercel/blob before the adapter imports it.
const putMock = mock(
  async (pathname: string, _body: unknown, _opts?: unknown) => ({
    pathname,
    url: `https://blob.test/${pathname}`,
    downloadUrl: `https://blob.test/${pathname}?download=1`,
    contentType: 'text/plain',
    contentDisposition: '',
  })
);
const headMock = mock(async (pathname: string) => ({
  pathname,
  url: `https://blob.test/${pathname}`,
  downloadUrl: `https://blob.test/${pathname}?download=1`,
  size: 5,
  uploadedAt: new Date(),
  contentType: 'text/plain',
  contentDisposition: '',
  cacheControl: '',
}));
const delMock = mock(async (_pathname: string | string[]) => undefined);
const copyMock = mock(async (from: string, to: string) => ({
  pathname: to,
  url: `https://blob.test/${to}`,
  downloadUrl: `https://blob.test/${to}?download=1`,
  contentType: 'text/plain',
  contentDisposition: '',
}));
const listMock = mock(async (_opts?: unknown) => ({
  blobs: [
    {
      pathname: 'a/1.txt',
      url: 'https://blob.test/a/1.txt',
      downloadUrl: 'https://blob.test/a/1.txt?download=1',
      size: 1,
      uploadedAt: new Date(),
    },
  ],
  hasMore: false,
  cursor: undefined,
}));

mock.module('@vercel/blob', () => ({
  put: putMock,
  head: headMock,
  del: delMock,
  copy: copyMock,
  list: listMock,
}));

const { vercelBlob } = await import('../src/vercel-blob/index.js');

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  putMock.mockClear();
  headMock.mockClear();
  delMock.mockClear();
  copyMock.mockClear();
  listMock.mockClear();
});

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe('vercel-blob adapter', () => {
  test('missing token throws at construction', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(() => vercelBlob()).toThrow(/token/i);
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  });

  test('upload calls blob.put with the right options', async () => {
    const files = new Files({ adapter: vercelBlob() });
    const result = await files.upload('a.txt', 'hello', {
      contentType: 'text/plain',
      cacheControl: 'public, max-age=60',
    });
    expect(result.key).toBe('a.txt');
    expect(putMock).toHaveBeenCalledTimes(1);
    const [path, , opts] = putMock.mock.calls[0]!;
    expect(path).toBe('a.txt');
    const o = opts as {
      access: string;
      addRandomSuffix: boolean;
      cacheControlMaxAge?: number;
      contentType?: string;
    };
    expect(o.access).toBe('public');
    expect(o.addRandomSuffix).toBe(false);
    expect(o.cacheControlMaxAge).toBe(60);
    expect(o.contentType).toBe('text/plain');
  });

  test('head returns metadata with url stashed in metadata', async () => {
    const files = new Files({ adapter: vercelBlob() });
    const info = await files.head('a.txt');
    expect(info.key).toBe('a.txt');
    expect(info.size).toBe(5);
    expect(info.metadata?.url).toBe('https://blob.test/a.txt');
  });

  test('delete delegates to blob.del', async () => {
    const files = new Files({ adapter: vercelBlob() });
    await files.delete('a.txt');
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock.mock.calls[0]![0]).toBe('a.txt');
  });

  test('copy delegates to blob.copy', async () => {
    const files = new Files({ adapter: vercelBlob() });
    await files.copy('a.txt', 'b.txt');
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock.mock.calls[0]![0]).toBe('a.txt');
    expect(copyMock.mock.calls[0]![1]).toBe('b.txt');
  });

  test('list maps blobs into StoredFile items', async () => {
    const files = new Files({ adapter: vercelBlob() });
    const out = await files.list({ prefix: 'a/' });
    expect(out.items.map((i) => i.key)).toEqual(['a/1.txt']);
  });

  test("url returns the blob's public URL", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const url = await files.url('a.txt');
    expect(url).toBe('https://blob.test/a.txt');
  });

  test("signedUrl returns the same public URL (Vercel Blob URLs don't expire)", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const url = await files.signedUrl('a.txt', { expiresIn: 60 });
    expect(url).toBe('https://blob.test/a.txt');
  });

  test('signedUploadUrl throws Provider', async () => {
    const files = new Files({ adapter: vercelBlob() });
    try {
      await files.signedUploadUrl('a.txt', { expiresIn: 60 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FilesError);
      expect((err as FilesError).code).toBe('Provider');
      expect((err as FilesError).message).toMatch(/handleUpload/);
    }
  });
});
