---
"files-sdk": patch
---

Extract shared adapter helpers into `src/internal/core.ts` so authoring a new adapter is less boilerplate. The new module exports `DEFAULT_URL_EXPIRES_IN`, `joinPublicUrl`, `resolveUrlStrategy` (the two-state public-vs-sign decision, with `responseContentDisposition` always forcing signing), `normalizeBody` (Body → `Uint8Array | ReadableStream<Uint8Array>` + content-type/length), and `makeErrorMapper` (factory for the per-provider `mapXError` scaffold — code-set lookup, HTTP-status fallback, `FilesError` pass-through). The s3, azure, gcs, supabase, r2, fs, and uploadthing adapters now consume these helpers; supabase keeps its own `normalizeBody` because Blob pass-through is required for multipart uploads, and r2's `url()` keeps its three-state hybrid logic. `mapS3Error` retains its 2-arg legacy signature for the S3-compatible wrappers (R2 HTTP, MinIO, DigitalOcean Spaces, Storj, Hetzner, Akamai). No public-API changes.
