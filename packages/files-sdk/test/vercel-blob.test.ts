import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { Files, FilesError } from "../src/index.js";

// Mock @vercel/blob before the adapter imports it.
const putMock = mock((pathname: string, _body: unknown, _opts?: unknown) =>
  Promise.resolve({
    contentDisposition: "",
    contentType: "text/plain",
    downloadUrl: `https://blob.test/${pathname}?download=1`,
    pathname,
    url: `https://blob.test/${pathname}`,
  })
);
const headMock = mock((pathname: string) =>
  Promise.resolve({
    cacheControl: "",
    contentDisposition: "",
    contentType: "text/plain",
    downloadUrl: `https://blob.test/${pathname}?download=1`,
    etag: `"etag-${pathname}"`,
    pathname,
    size: 5,
    uploadedAt: new Date(),
    url: `https://blob.test/${pathname}`,
  })
);
const delMock = mock((_pathname: string | string[]) => Promise.resolve());
const copyMock = mock((_from: string, to: string) =>
  Promise.resolve({
    contentDisposition: "",
    contentType: "text/plain",
    downloadUrl: `https://blob.test/${to}?download=1`,
    pathname: to,
    url: `https://blob.test/${to}`,
  })
);
const listMock = mock((_opts?: unknown) =>
  Promise.resolve({
    blobs: [
      {
        downloadUrl: "https://blob.test/a/1.txt?download=1",
        etag: '"etag-a/1.txt"',
        pathname: "a/1.txt",
        size: 1,
        uploadedAt: new Date(),
        url: "https://blob.test/a/1.txt",
      },
    ],
    cursor: undefined,
    hasMore: false,
  })
);

mock.module("@vercel/blob", () => ({
  copy: copyMock,
  del: delMock,
  head: headMock,
  list: listMock,
  put: putMock,
}));

const { vercelBlob } = await import("../src/vercel-blob/index.js");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  putMock.mockClear();
  headMock.mockClear();
  delMock.mockClear();
  copyMock.mockClear();
  listMock.mockClear();
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/missing")) {
      return Promise.resolve(
        new Response(null, { status: 404, statusText: "Not Found" })
      );
    }
    return Promise.resolve(
      new Response("hello", {
        headers: { "Content-Type": "text/plain" },
        status: 200,
      })
    );
  }) as typeof fetch;
});

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  globalThis.fetch = originalFetch;
});

describe("vercel-blob adapter", () => {
  test("missing token throws at construction", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(() => vercelBlob()).toThrow(/token/iu);
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  });

  test("upload calls blob.put with the right options", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const result = await files.upload("a.txt", "hello", {
      cacheControl: "public, max-age=60",
      contentType: "text/plain",
    });
    expect(result.key).toBe("a.txt");
    expect(putMock).toHaveBeenCalledTimes(1);
    const [firstPutCall] = putMock.mock.calls;
    if (!firstPutCall) {
      throw new Error("expected put to have been called");
    }
    const [path, , opts] = firstPutCall;
    expect(path).toBe("a.txt");
    const o = opts as {
      access: string;
      addRandomSuffix: boolean;
      cacheControlMaxAge?: number;
      contentType?: string;
    };
    expect(o.access).toBe("public");
    expect(o.addRandomSuffix).toBe(false);
    expect(o.cacheControlMaxAge).toBe(60);
    expect(o.contentType).toBe("text/plain");
  });

  test("head returns metadata without polluting it with adapter URLs", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const info = await files.head("a.txt");
    expect(info.key).toBe("a.txt");
    expect(info.size).toBe(5);
    expect(info.etag).toBe('"etag-a.txt"');
    expect(info.metadata).toBeUndefined();
  });

  test("delete delegates to blob.del", async () => {
    const files = new Files({ adapter: vercelBlob() });
    await files.delete("a.txt");
    expect(delMock).toHaveBeenCalledTimes(1);
    const [firstDelCall] = delMock.mock.calls;
    if (!firstDelCall) {
      throw new Error("expected del to have been called");
    }
    const [delArg] = firstDelCall;
    expect(delArg).toBe("a.txt");
  });

  test("copy delegates to blob.copy", async () => {
    const files = new Files({ adapter: vercelBlob() });
    await files.copy("a.txt", "b.txt");
    expect(copyMock).toHaveBeenCalledTimes(1);
    const [firstCopyCall] = copyMock.mock.calls;
    if (!firstCopyCall) {
      throw new Error("expected copy to have been called");
    }
    const [fromArg, toArg] = firstCopyCall;
    expect(fromArg).toBe("a.txt");
    expect(toArg).toBe("b.txt");
  });

  test("list maps blobs into StoredFile items", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const out = await files.list({ prefix: "a/" });
    expect(out.items.map((i) => i.key)).toEqual(["a/1.txt"]);
  });

  test("url returns the blob's public URL", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const url = await files.url("a.txt");
    expect(url).toBe("https://blob.test/a.txt");
  });

  test("signedUrl throws Provider (Vercel Blob URLs don't expire)", async () => {
    const files = new Files({ adapter: vercelBlob() });
    try {
      await files.signedUrl("a.txt", { expiresIn: 60 });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).code).toBe("Provider");
      expect((error as FilesError).message).toMatch(/do not expire/u);
    }
  });

  test("signedUploadUrl throws Provider", async () => {
    const files = new Files({ adapter: vercelBlob() });
    try {
      await files.signedUploadUrl("a.txt", { expiresIn: 60 });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).code).toBe("Provider");
      expect((error as FilesError).message).toMatch(/handleUpload/u);
    }
  });

  test("download fetches the blob URL and returns its body", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const got = await files.download("a.txt");
    expect(await got.text()).toBe("hello");
    expect(got.size).toBe(5);
    expect(got.type).toBe("text/plain");
  });

  test("download as stream returns a streaming StoredFile", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const got = await files.download("a.txt", { as: "stream" });
    const reader = got.stream().getReader();
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
      }
    }
    expect(total).toBe(5);
  });

  test("download maps non-OK responses to FilesError (404 → NotFound)", async () => {
    headMock.mockImplementationOnce((pathname: string) =>
      Promise.resolve({
        cacheControl: "",
        contentDisposition: "",
        contentType: "text/plain",
        downloadUrl: `https://blob.test/missing/${pathname}?download=1`,
        etag: "",
        pathname,
        size: 0,
        uploadedAt: new Date(),
        url: `https://blob.test/missing/${pathname}`,
      })
    );
    const files = new Files({ adapter: vercelBlob() });
    try {
      await files.download("a.txt");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).code).toBe("NotFound");
    }
  });

  test("upload computes size for Uint8Array, ArrayBuffer, ArrayBufferView, Blob, string", async () => {
    const adapter = vercelBlob();
    const u8 = await adapter.upload("u8.bin", new Uint8Array([1, 2, 3]));
    expect(u8.size).toBe(3);
    const ab = await adapter.upload(
      "ab.bin",
      new Uint8Array([1, 2, 3, 4]).buffer
    );
    expect(ab.size).toBe(4);
    const view = await adapter.upload(
      "v.bin",
      new DataView(new ArrayBuffer(8))
    );
    expect(view.size).toBe(8);
    const blobUpload = await adapter.upload(
      "b.bin",
      new Blob([new Uint8Array([1, 2])], { type: "image/png" })
    );
    expect(blobUpload.size).toBe(2);
    const str = await adapter.upload("s.txt", "hello");
    expect(str.size).toBe(5);
  });

  test("upload error is wrapped as FilesError", async () => {
    const files = new Files({ adapter: vercelBlob() });
    putMock.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("oops"), { status: 500 }))
    );
    try {
      await files.upload("a.txt", "x");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).code).toBe("Provider");
      expect((error as FilesError).message).toBe("oops");
    }
  });

  test("head error: name BlobNotFoundError maps to NotFound", async () => {
    const files = new Files({ adapter: vercelBlob() });
    headMock.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error("nope"), { name: "BlobNotFoundError" })
      )
    );
    try {
      await files.head("a.txt");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as FilesError).code).toBe("NotFound");
    }
  });

  test("delete error: status 403 maps to Unauthorized", async () => {
    const files = new Files({ adapter: vercelBlob() });
    delMock.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("denied"), { status: 403 }))
    );
    try {
      await files.delete("a.txt");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as FilesError).code).toBe("Unauthorized");
    }
  });

  test("copy error is mapped to FilesError", async () => {
    const files = new Files({ adapter: vercelBlob() });
    copyMock.mockImplementationOnce(() =>
      Promise.reject(new Error("copy failed"))
    );
    try {
      await files.copy("a.txt", "b.txt");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as FilesError).code).toBe("Provider");
      expect((error as FilesError).message).toBe("copy failed");
    }
  });

  test("head exposes a lazy body that fetches the blob URL", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const info = await files.head("a.txt");
    expect(await info.text()).toBe("hello");
  });

  test("list items expose lazy bodies that fetch the blob URL", async () => {
    const files = new Files({ adapter: vercelBlob() });
    const out = await files.list();
    const [item] = out.items;
    if (!item) {
      throw new Error("expected at least one item");
    }
    expect(await item.text()).toBe("hello");
  });

  test("url throws Provider when the head response has no public URL", async () => {
    headMock.mockImplementationOnce((pathname: string) =>
      Promise.resolve({
        cacheControl: "",
        contentDisposition: "",
        contentType: "text/plain",
        downloadUrl: "",
        etag: "",
        pathname,
        size: 0,
        uploadedAt: new Date(),
        url: "",
      })
    );
    const files = new Files({ adapter: vercelBlob() });
    try {
      await files.url("a.txt");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).code).toBe("Provider");
      expect((error as FilesError).message).toMatch(/missing public URL/u);
    }
  });

  test("upload size for ReadableStream body falls back to 0", async () => {
    const adapter = vercelBlob();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    });
    const result = await adapter.upload("s.bin", stream);
    expect(result.size).toBe(0);
  });

  test("list error is mapped to FilesError", async () => {
    const files = new Files({ adapter: vercelBlob() });
    listMock.mockImplementationOnce(() =>
      Promise.reject(new Error("list failed"))
    );
    try {
      await files.list();
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as FilesError).code).toBe("Provider");
      expect((error as FilesError).message).toBe("list failed");
    }
  });
});
