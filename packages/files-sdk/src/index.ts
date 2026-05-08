export { FilesError, type FilesErrorCode } from './internal/errors.js';
export { createStoredFile } from './internal/stored-file.js';
export type { StoredFileMeta, BodySource } from './internal/stored-file.js';

import { FilesError } from './internal/errors.js';

export type Body =
  | Blob
  | File
  | ReadableStream<Uint8Array>
  | ArrayBuffer
  | ArrayBufferView
  | Uint8Array
  | string;

export interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  key: string;
  size: number;
  contentType: string;
  etag?: string;
  lastModified?: number;
}

export interface StoredFile {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  stream(): ReadableStream<Uint8Array>;
  blob(): Promise<Blob>;
  key: string;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface DownloadOptions {
  as?: 'blob' | 'stream';
}

export interface ListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface ListResult {
  items: StoredFile[];
  cursor?: string;
}

export interface SignOptions {
  expiresIn: number;
}

export interface SignUploadOptions {
  expiresIn: number;
  contentType?: string;
  maxSize?: number;
}

export type SignedUpload =
  | {
      method: 'PUT';
      url: string;
      headers?: Record<string, string>;
    }
  | {
      method: 'POST';
      url: string;
      fields: Record<string, string>;
    };

export interface Adapter<Raw = unknown> {
  readonly name: string;
  readonly raw: Raw;
  upload(key: string, body: Body, opts?: UploadOptions): Promise<UploadResult>;
  download(key: string, opts?: DownloadOptions): Promise<StoredFile>;
  head(key: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  list(opts?: ListOptions): Promise<ListResult>;
  url(key: string): Promise<string>;
  signedUrl(key: string, opts: SignOptions): Promise<string>;
  signedUploadUrl(key: string, opts: SignUploadOptions): Promise<SignedUpload>;
}

export interface FilesOptions<A extends Adapter> {
  adapter: A;
}

export class Files<A extends Adapter = Adapter> {
  readonly #adapter: A;

  constructor(opts: FilesOptions<A>) {
    this.#adapter = opts.adapter;
  }

  get raw(): A['raw'] {
    return this.#adapter.raw;
  }

  get adapter(): A {
    return this.#adapter;
  }

  upload(key: string, body: Body, opts?: UploadOptions): Promise<UploadResult> {
    return this.#run(() => this.#adapter.upload(key, body, opts));
  }

  download(key: string, opts?: DownloadOptions): Promise<StoredFile> {
    return this.#run(() => this.#adapter.download(key, opts));
  }

  head(key: string): Promise<StoredFile> {
    return this.#run(() => this.#adapter.head(key));
  }

  delete(key: string): Promise<void> {
    return this.#run(() => this.#adapter.delete(key));
  }

  copy(from: string, to: string): Promise<void> {
    return this.#run(() => this.#adapter.copy(from, to));
  }

  list(opts?: ListOptions): Promise<ListResult> {
    return this.#run(() => this.#adapter.list(opts));
  }

  url(key: string): Promise<string> {
    return this.#run(() => this.#adapter.url(key));
  }

  signedUrl(key: string, opts: SignOptions): Promise<string> {
    return this.#run(() => this.#adapter.signedUrl(key, opts));
  }

  signedUploadUrl(key: string, opts: SignUploadOptions): Promise<SignedUpload> {
    return this.#run(() => this.#adapter.signedUploadUrl(key, opts));
  }

  async #run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw FilesError.wrap(err);
    }
  }
}
