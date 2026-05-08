import { CodeBlock } from "@/components/code-block";
import { Heading } from "@/components/heading";

const UPLOAD_EXAMPLE = `await files.upload("avatars/abc.png", file, {
  contentType: "image/png",
  cacheControl: "public, max-age=31536000",
  metadata: { userId: "123" },
});
// → { key, size, contentType, etag, lastModified }`;

const DOWNLOAD_EXAMPLE = `const file = await files.download("avatars/abc.png");
// → StoredFile (Blob-backed)

const stream = await files.download("avatars/abc.png", { as: "stream" });
// → ReadableStream`;

const HEAD_EXAMPLE = `const info = await files.head("avatars/abc.png");
// → StoredFile with no body materialized`;

const DELETE_EXAMPLE = `await files.delete("avatars/abc.png");`;

const COPY_EXAMPLE = `await files.copy("avatars/abc.png", "avatars/abc.bak.png");`;

const LIST_EXAMPLE = `const { items, cursor } = await files.list({
  prefix: "avatars/",
  limit: 100,
});

if (cursor) {
  const next = await files.list({ prefix: "avatars/", cursor });
}`;

const URL_EXAMPLE = `// Public URL — throws if the bucket has no public origin.
const url = await files.url("avatars/abc.png");

// Time-limited signed URL for reads.
const tempUrl = await files.signedUrl("avatars/abc.png", {
  expiresIn: 60,
});

// Signed upload — discriminated PUT or POST shape.
const upload = await files.signedUploadUrl("avatars/abc.png", {
  expiresIn: 60,
  contentType: "image/png",
  maxSize: 5_000_000,
});
// → { method: "PUT", url, headers? }
//   | { method: "POST", url, fields }`;

export const ApiReference = () => (
  <section>
    <Heading as="h2">API reference</Heading>
    <p>
      Every method is available on the <code>Files</code> instance. The unified
      surface only covers what every adapter can do cleanly — anything
      provider-specific lives on <code>files.raw</code>.
    </p>

    <section>
      <Heading as="h3" id="files-upload">
        files.upload(key, body, options?)
      </Heading>
      <p>
        Writes a body to <code>key</code>. Accepts native <code>File</code>,{" "}
        <code>Blob</code>, <code>ReadableStream</code>, <code>ArrayBuffer</code>
        , or <code>string</code>. Content type is inferred from the input when
        possible.
      </p>
      <CodeBlock code={UPLOAD_EXAMPLE} lang="ts" />
      <div className="flex flex-col gap-2">
        <Heading as="h4" id="files-upload-options">
          Options
        </Heading>
        <ul className="!list-none !pl-0 !gap-0 rounded-md border border-dotted divide-y divide-dotted">
          <li className="px-4 py-3">
            <code>contentType</code> — string, optional. Inferred from{" "}
            <code>File</code>/<code>Blob</code> <code>type</code> when not set.
          </li>
          <li className="px-4 py-3">
            <code>cacheControl</code> — string, optional. Sent verbatim to the
            provider.
          </li>
          <li className="px-4 py-3">
            <code>metadata</code> — <code>Record&lt;string, string&gt;</code>,
            optional. Provider user-metadata, returned by <code>head</code> and{" "}
            <code>list</code>.
          </li>
        </ul>
      </div>
    </section>

    <section>
      <Heading as="h3" id="files-download">
        files.download(key, options?)
      </Heading>
      <p>
        Reads an object. Returns a <code>StoredFile</code> by default
        (Blob-backed). Pass <code>{'{ as: "stream" }'}</code> to opt into a{" "}
        <code>ReadableStream</code> for large objects.
      </p>
      <CodeBlock code={DOWNLOAD_EXAMPLE} lang="ts" />
    </section>

    <section>
      <Heading as="h3" id="files-head">
        files.head(key)
      </Heading>
      <p>
        Returns the same <code>StoredFile</code> shape as <code>download</code>,
        without materializing the body. Calling a body accessor on the result
        lazy-fetches.
      </p>
      <CodeBlock code={HEAD_EXAMPLE} lang="ts" />
    </section>

    <section>
      <Heading as="h3" id="files-delete">
        files.delete(key)
      </Heading>
      <p>
        Removes an object. No-op friendly: a missing key resolves successfully
        on providers that treat delete as idempotent, and throws{" "}
        <code>FilesError</code> with <code>code: "NotFound"</code> on ones that
        don't.
      </p>
      <CodeBlock code={DELETE_EXAMPLE} lang="ts" />
    </section>

    <section>
      <Heading as="h3" id="files-copy">
        files.copy(from, to)
      </Heading>
      <p>
        Server-side copy where the provider supports it; falls back to read +
        write otherwise.
      </p>
      <CodeBlock code={COPY_EXAMPLE} lang="ts" />
    </section>

    <section>
      <Heading as="h3" id="files-list">
        files.list(options?)
      </Heading>
      <p>
        Cursor-paginated listing with prefix filter. Each item is a{" "}
        <code>StoredFile</code> with a lazy body accessor.
      </p>
      <CodeBlock code={LIST_EXAMPLE} lang="ts" />
      <div className="flex flex-col gap-2">
        <Heading as="h4" id="files-list-options">
          Options
        </Heading>
        <ul className="!list-none !pl-0 !gap-0 rounded-md border border-dotted divide-y divide-dotted">
          <li className="px-4 py-3">
            <code>prefix</code> — string, optional.
          </li>
          <li className="px-4 py-3">
            <code>limit</code> — number, optional. Provider-specific cap;
            defaults to 1000.
          </li>
          <li className="px-4 py-3">
            <code>cursor</code> — string, optional. Pass <code>cursor</code>{" "}
            from the previous result to continue.
          </li>
        </ul>
      </div>
    </section>

    <section>
      <Heading as="h3" id="files-urls">
        files.url, files.signedUrl, files.signedUploadUrl
      </Heading>
      <p>
        Three URL helpers for three different needs. <code>url</code> returns a
        long-lived public URL — it throws if the adapter has no public origin
        (use <code>signedUrl</code> instead). <code>signedUploadUrl</code>{" "}
        returns a discriminated shape so callers can handle PUT- and POST-style
        flows uniformly.
      </p>
      <CodeBlock code={URL_EXAMPLE} lang="ts" />
      <div className="flex flex-col gap-2">
        <Heading as="h4">Sign options</Heading>
        <ul className="!list-none !pl-0 !gap-0 rounded-md border border-dotted divide-y divide-dotted">
          <li className="px-4 py-3">
            <code>expiresIn</code> — number of seconds. Required.
          </li>
          <li className="px-4 py-3">
            <code>contentType</code> — string, optional.{" "}
            <code>signedUploadUrl</code> only; bound into the signature so the
            upload must match.
          </li>
          <li className="px-4 py-3">
            <code>maxSize</code> — number of bytes, optional.{" "}
            <code>signedUploadUrl</code> only.
          </li>
        </ul>
      </div>
    </section>
  </section>
);
