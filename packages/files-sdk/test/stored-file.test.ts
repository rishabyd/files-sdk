import { describe, expect, test } from "bun:test";

import { createStoredFile } from "../src/internal/stored-file.js";

const collectStream = async (
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
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

describe("createStoredFile", () => {
  test("buffer kind exposes bytes via text/blob/arrayBuffer", async () => {
    const sf = createStoredFile(
      { key: "a", size: 5, type: "text/plain" },
      { data: new TextEncoder().encode("hello"), kind: "buffer" }
    );
    expect(await sf.text()).toBe("hello");
    const blob = await sf.blob();
    expect(blob.size).toBe(5);
    expect(blob.type).toContain("text/plain");
    const buf = await sf.arrayBuffer();
    expect(new TextDecoder().decode(new Uint8Array(buf))).toBe("hello");
  });

  test("buffer kind: stream() returns the cached bytes when no native stream", async () => {
    const sf = createStoredFile(
      { key: "a", size: 3, type: "text/plain" },
      { data: new TextEncoder().encode("abc"), kind: "buffer" }
    );
    const out = await collectStream(sf.stream());
    expect(new TextDecoder().decode(out)).toBe("abc");
  });

  test("lazy kind invokes factory once and caches across reads", async () => {
    let calls = 0;
    const sf = createStoredFile(
      { key: "k", size: 3, type: "text/plain" },
      {
        factory: () => {
          calls += 1;
          return Promise.resolve(new TextEncoder().encode("abc"));
        },
        kind: "lazy",
      }
    );
    expect(await sf.text()).toBe("abc");
    expect(await sf.text()).toBe("abc");
    const out = await collectStream(sf.stream());
    expect(new TextDecoder().decode(out)).toBe("abc");
    expect(calls).toBe(1);
  });

  test("stream kind: stream() returns the underlying stream on first read", async () => {
    const sf = createStoredFile(
      { key: "k", size: 5, type: "text/plain" },
      {
        factory: () =>
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode("hello"));
              c.close();
            },
          }),
        kind: "stream",
      }
    );
    const out = await collectStream(sf.stream());
    expect(new TextDecoder().decode(out)).toBe("hello");
  });

  test("stream kind: stream() then text() — text() reads from buffered tee branch", async () => {
    let factoryCalls = 0;
    const sf = createStoredFile(
      { key: "k", size: 5, type: "text/plain" },
      {
        factory: () => {
          factoryCalls += 1;
          return new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode("hello"));
              c.close();
            },
          });
        },
        kind: "stream",
      }
    );
    const userBranch = sf.stream();
    const out = await collectStream(userBranch);
    expect(new TextDecoder().decode(out)).toBe("hello");
    // text() must NOT re-enter the (now-consumed) source factory.
    expect(await sf.text()).toBe("hello");
    expect(factoryCalls).toBe(1);
  });

  test("stream kind: stream() called twice — second call returns cached bytes", async () => {
    let factoryCalls = 0;
    const sf = createStoredFile(
      { key: "k", size: 3, type: "text/plain" },
      {
        factory: () => {
          factoryCalls += 1;
          return new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode("abc"));
              c.close();
            },
          });
        },
        kind: "stream",
      }
    );
    const first = sf.stream();
    const firstOut = await collectStream(first);
    expect(new TextDecoder().decode(firstOut)).toBe("abc");
    const second = sf.stream();
    const secondOut = await collectStream(second);
    expect(new TextDecoder().decode(secondOut)).toBe("abc");
    expect(factoryCalls).toBe(1);
  });

  test("stream kind: text() drains and caches; subsequent stream() uses cache", async () => {
    const sf = createStoredFile(
      { key: "k", size: 5, type: "text/plain" },
      {
        factory: () =>
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode("ab"));
              c.enqueue(new TextEncoder().encode("cde"));
              c.close();
            },
          }),
        kind: "stream",
      }
    );
    expect(await sf.text()).toBe("abcde");
    const out = await collectStream(sf.stream());
    expect(new TextDecoder().decode(out)).toBe("abcde");
  });

  test("metadata fields are surfaced on the StoredFile", () => {
    const sf = createStoredFile(
      {
        etag: "e1",
        key: "name.txt",
        lastModified: 42,
        metadata: { foo: "bar" },
        size: 0,
        type: "text/plain",
      },
      { data: new Uint8Array(), kind: "buffer" }
    );
    expect(sf.key).toBe("name.txt");
    expect(sf.name).toBe("name.txt");
    expect(sf.etag).toBe("e1");
    expect(sf.lastModified).toBe(42);
    expect(sf.metadata).toEqual({ foo: "bar" });
  });
});
