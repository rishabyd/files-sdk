import { CodeBlock } from "@/components/code-block";
import { Heading } from "@/components/heading";

const STORED_FILE_TYPE = `interface StoredFile {
  // File-shaped:
  name: string;        // = key
  size: number;
  type: string;        // = contentType
  lastModified?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  stream(): ReadableStream;
  blob(): Promise<Blob>;

  // Storage-specific:
  key: string;
  etag?: string;
  metadata?: Record<string, string>;
}`;

export const StoredFileType = () => (
  <section>
    <Heading as="h2">The StoredFile type</Heading>
    <p>
      Native <code>File</code> covers <code>name</code>, <code>size</code>,{" "}
      <code>type</code>, and <code>lastModified</code>, but storage adds three
      things it doesn't carry: a full <code>key</code>, an <code>etag</code> for
      cache validation, and user-defined <code>metadata</code>.{" "}
      <code>StoredFile</code> mirrors <code>File</code>'s shape and adds those.
    </p>
    <CodeBlock code={STORED_FILE_TYPE} lang="ts" />
    <p>
      <code>upload</code> accepts a native <code>File</code> as input.{" "}
      <code>download</code>, <code>head</code>, and <code>list</code> all return{" "}
      <code>StoredFile</code>. The body accessors on results from{" "}
      <code>head</code> and <code>list</code> lazy-fetch on call.
    </p>
  </section>
);
