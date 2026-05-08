import { describe, expect, test } from 'bun:test';

import { Files, FilesError } from '../src/index.js';
import { fakeAdapter } from './fake-adapter.js';

describe('Files class', () => {
  test('upload + download round-trip', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    const result = await files.upload('a.txt', 'hello', {
      contentType: 'text/plain',
      metadata: { user: '1' },
    });
    expect(result.key).toBe('a.txt');
    expect(result.size).toBe(5);
    expect(result.contentType).toBe('text/plain');
    expect(result.etag).toBeTruthy();

    const got = await files.download('a.txt');
    expect(got.key).toBe('a.txt');
    expect(got.size).toBe(5);
    expect(await got.text()).toBe('hello');
    expect(got.metadata).toEqual({ user: '1' });
  });

  test('download yields a StoredFile with body accessors', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    await files.upload('data.bin', new Uint8Array([1, 2, 3, 4]));
    const got = await files.download('data.bin');
    const buf = await got.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4]));
    const blob = await got.blob();
    expect(blob.size).toBe(4);
  });

  test('download supports streaming consumer via stream()', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    await files.upload('s.txt', 'stream-me');
    const got = await files.download('s.txt');
    const reader = got.stream().getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });

  test('head returns metadata-only StoredFile', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    await files.upload('h.txt', 'x');
    const info = await files.head('h.txt');
    expect(info.key).toBe('h.txt');
    expect(info.size).toBe(1);
  });

  test('delete removes the object', async () => {
    const adapter = fakeAdapter();
    const files = new Files({ adapter });
    await files.upload('d.txt', 'x');
    expect(adapter.has('d.txt')).toBe(true);
    await files.delete('d.txt');
    expect(adapter.has('d.txt')).toBe(false);
  });

  test('copy duplicates an object', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    await files.upload('from.txt', 'payload');
    await files.copy('from.txt', 'to.txt');
    expect(await (await files.download('to.txt')).text()).toBe('payload');
  });

  test('list returns items filtered by prefix', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    await files.upload('a/1.txt', '1');
    await files.upload('a/2.txt', '2');
    await files.upload('b/3.txt', '3');
    const { items } = await files.list({ prefix: 'a/' });
    expect(items.map((i) => i.key).sort()).toEqual(['a/1.txt', 'a/2.txt']);
  });

  test('error normalization wraps adapter errors as FilesError with code', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    try {
      await files.download('missing');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FilesError);
      expect((err as FilesError).code).toBe('NotFound');
    }
  });

  test('non-FilesError thrown by adapter is wrapped as Provider', async () => {
    const adapter = fakeAdapter();
    const broken = {
      ...adapter,
      async upload() {
        throw new TypeError('kaboom');
      },
    };
    const files = new Files({ adapter: broken });
    try {
      await files.upload('x', 'y');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FilesError);
      expect((err as FilesError).code).toBe('Provider');
      expect((err as FilesError).message).toBe('kaboom');
    }
  });

  test("raw exposes the adapter's native client", async () => {
    const adapter = fakeAdapter();
    const files = new Files({ adapter });
    expect(files.raw).toBe(adapter.raw);
  });

  test('signedUrl returns a string', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    await files.upload('k.txt', 'v');
    const url = await files.signedUrl('k.txt', { expiresIn: 60 });
    expect(url).toMatch(/^https:\/\/fake\.local/);
  });

  test('signedUploadUrl returns a discriminated SignedUpload', async () => {
    const files = new Files({ adapter: fakeAdapter() });
    const out = await files.signedUploadUrl('k.txt', { expiresIn: 60 });
    expect(out.method).toBe('PUT');
    expect(out.url).toMatch(/^https:\/\/fake\.local/);
  });
});
