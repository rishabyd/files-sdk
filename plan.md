# Files SDK — Design Plan

A unified storage SDK for object/blob backends (AWS S3, Cloudflare R2, Vercel Blob, ...), inspired by Vercel's AI SDK and Chat SDK.

## Goals

- One small, honest API across providers — swap backends without rewriting calls.
- Web-standards I/O (`Blob`, `File`, `ReadableStream`, `ArrayBuffer`, `string`) — edge/Workers compatible.
- Escape hatch to the native client when you need provider-specific power.

## Non-goals (v1)

- Image transforms / on-the-fly resizing.
- Middleware (virus scan, moderation, dedup, encryption-at-rest).
- React layer (`useUpload`, dropzone components).
- Validators (size/MIME limits as schema).
- Multipart / resumable uploads as first-class API.

These may come later; v1 stays minimal.

## Scope (v1)

Core CRUD + URLs only:

- `upload`, `download`, `delete`, `head`, `copy`, `list`
- `url`, `signedUrl`, `signedUploadUrl`

## Feature parity strategy

**Common subset + raw escape hatch.** The unified API only covers what every adapter can do cleanly. Provider-specific features (S3 versioning, lifecycle, ACLs, etc.) are reachable via `files.raw`, which returns the underlying native client typed per adapter.

If something can't be implemented by all v1 adapters, it belongs behind `.raw`, not in the core surface.

## API style

Chat-SDK-style class with adapter injection:

```ts
const files = new Files({ adapter: s3({ bucket: "uploads" }) });
await files.upload("a.png", file);
```

Adapter is fixed at construction; calls are method-style on the instance. No functional `put({ provider, ... })` form.

Method names are **friendly verbs** (`upload`, `download`, `delete`, `copy`, `list`, `head`) rather than HTTP-aligned (`put`, `get`, `del`). Leaves room to expand into operations that don't map to HTTP verbs cleanly.

## Target providers (v1)

- `@files-sdk/s3` — AWS S3
- `@files-sdk/r2` — Cloudflare R2 (Workers binding + HTTP)
- `@files-sdk/vercel-blob` — Vercel Blob

## Surface sketch

```ts
import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";

const files = new Files({
  adapter: s3({ bucket: "uploads", region: "us-east-1" }),
});

// Upload — accepts File | Blob | ReadableStream | ArrayBuffer | string
const result = await files.upload("avatars/abc.png", file, {
  contentType: "image/png",      // optional, inferred when possible
  cacheControl: "public, max-age=31536000",
  metadata: { userId: "123" },
});
// → { key, size, contentType, etag, lastModified }

// Download — Blob by default, opt into streaming
const blob   = await files.download("avatars/abc.png");
const stream = await files.download("avatars/abc.png", { as: "stream" });

// Metadata, delete, copy
const info = await files.head("avatars/abc.png");
await files.delete("avatars/abc.png");
await files.copy("avatars/abc.png", "avatars/abc.bak.png");

// List — cursor-paginated, prefix filter
const { items, cursor } = await files.list({ prefix: "avatars/", limit: 100 });

// URLs
const url       = await files.url("avatars/abc.png");                        // throws if no public URL exists for this adapter; use signedUrl instead
const tempUrl   = await files.signedUrl("avatars/abc.png", { expiresIn: 60 });
const uploadUrl = await files.signedUploadUrl("avatars/abc.png", {
  expiresIn: 60,
  contentType: "image/png",
  maxSize: 5_000_000,
});
// → { method: "PUT" | "POST", url, headers?, fields? }  ← discriminated for both PUT- and POST-style flows

// Escape hatch — typed per adapter
files.raw; // S3Client | R2Bucket | VercelBlobClient
```

## Adapter contract

```ts
interface Adapter<Raw = unknown> {
  readonly name: string;
  readonly raw: Raw;
  upload(key: string, body: Body, opts?: UploadOptions): Promise<UploadResult>;
  download(key: string, opts?: { as?: "blob" | "stream" }): Promise<Blob | ReadableStream>;
  head(key: string): Promise<FileInfo>;
  delete(key: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  list(opts?: ListOptions): Promise<ListResult>;
  url(key: string): Promise<string>;
  signedUrl(key: string, opts: SignOptions): Promise<string>;
  signedUploadUrl(key: string, opts: SignUploadOptions): Promise<SignedUpload>;
}
```

The `Files` class is a thin wrapper that adds:

- Error normalization (single `FilesError` with `code: "NotFound" | "Unauthorized" | "Conflict" | "Provider"` + `cause`)
- The `.raw` accessor

It does **not** validate or normalize keys — callers are trusted for now. Revisit if footguns appear.

## Credentials & env vars

Adapters auto-load credentials from environment variables when available — same ergonomics as AI SDK / Chat SDK. Pass options explicitly to override.

| Adapter      | Auto-loaded env vars                                                                                                                                       | Required option |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `s3`         | Standard AWS credential chain — `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, plus IAM roles / profiles via the AWS SDK | `bucket`        |
| `r2`         | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                                                                                | `bucket`        |
| `vercelBlob` | `BLOB_READ_WRITE_TOKEN` (Vercel auto-injects on its platform)                                                                                              | (none)          |

```ts
// Auto-loaded
new Files({ adapter: s3({ bucket: "uploads" }) });
new Files({ adapter: r2({ bucket: "uploads" }) });
new Files({ adapter: vercelBlob() });

// Explicit override
new Files({
  adapter: s3({
    bucket: "uploads",
    region: "us-east-1",
    credentials: { accessKeyId: "...", secretAccessKey: "..." },
  }),
});
```

If an adapter is constructed without enough info to authenticate (no env, no override), throw a clear error at construction time (fail fast) naming which env var or option is missing. No silent deferral until first call.

## Return-type unification

Native `File` covers `name`/`size`/`type`/`lastModified` and the body accessors, but storage adds three things it doesn't carry: `key` (the full storage path, not just a filename), `etag` (for cache validation / conditional requests), and `metadata` (user-defined key/value tags). It also materializes data eagerly, which doesn't fit `head`/`list` where we don't want to fetch bodies.

So we ship a custom `StoredFile` type that **mirrors `File`'s shape** (familiar primitives) and **adds the storage fields**:

```ts
interface StoredFile {
  // File-shaped:
  name: string;            // = key
  size: number;
  type: string;            // = contentType
  lastModified?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  stream(): ReadableStream;
  blob(): Promise<Blob>;

  // Storage-specific:
  key: string;
  etag?: string;
  metadata?: Record<string, string>;
}
```

`upload` accepts native `File` (and `Blob`/stream/buffer/string) as **input**. `download` returns a `StoredFile`. `head` and `list` return the same `StoredFile` shape with body accessors that lazy-fetch on call (or throw — TBD).

## Repo structure

Turborepo monorepo with Bun as the package manager. Single published package:

```
files-sdk/
├── apps/
│   └── web/                 Next.js app (docs/marketing site)
├── packages/
│   └── files-sdk/           the published SDK package
├── turbo.json
├── package.json             workspace root — declares "workspaces": ["apps/*", "packages/*"]
└── bun.lock
```

Only one package ships to npm — `files-sdk`. The monorepo structure is for dev/build/docs; it's not a multi-package SDK.

**`apps/web` scope:** scaffold a default Next.js app (`bun create next-app` with TS, App Router, Tailwind defaults) and stop there. Design and content are owner-driven and out of scope for the SDK plan.

Bun choice notes: native TypeScript execution (no `tsx`/`ts-node` for scripts), fast installs, and `bun test` is fine for the SDK's unit tests. Workspaces live in the root `package.json` `workspaces` field — no separate workspace config file.

## Tooling

- **Type-check (`bun run types`):** [`tsgo`](https://github.com/microsoft/typescript-go) — the Go port of `tsc`, much faster. Used for `--noEmit` checking.
- **Build (`bun run build`):** [`tsup`](https://tsup.egoist.dev/) — emits ESM + `.d.ts` for the package. Multiple entry points (`src/index.ts`, `src/s3/index.ts`, `src/r2/index.ts`, `src/vercel-blob/index.ts`) wired into the package's `exports` field for subpath imports.
- **Format / lint (`bun run format`, `bun run lint`):** [Ultracite](https://www.ultracite.ai/) — opinionated Biome preset. Added after the plan is finalized.
- **Tests (`bun test`):** Bun's built-in runner.
- **Pre-commit hooks:** Husky + lint-staged. Hooks run `format`, `test`, `types` before each commit. lint-staged scopes formatting to staged files; tests and type-check run project-wide (cheap enough with `bun test` + `tsgo`).
- **Releases:** Changesets. `bun run changeset` to author a version note per change, `changeset version` bumps + generates `CHANGELOG.md`, `changeset publish` ships to npm. Works fine with a single published package.

## Package layout

Single package, subpath exports — no scoped packages, no code splitting across packages in v1. Easier to grow and refactor; revisit if it becomes a problem.

```
packages/files-sdk/src/
├── index.ts                 Files class, types, FilesError, Adapter contract  → "files-sdk"
├── s3/index.ts              s3({ bucket, region, credentials? })              → "files-sdk/s3"
├── r2/index.ts              r2({ bucket, accountId, ... })                    → "files-sdk/r2"
└── vercel-blob/index.ts     vercelBlob({ token? })                            → "files-sdk/vercel-blob"
```

Wired up via `package.json` `exports` field with subpath entries.

Tradeoff: provider SDKs (e.g. `@aws-sdk/client-s3`) ship as regular dependencies, so they're installed even for users who only need one provider. Runtime bundles tree-shake fine via subpath exports + `sideEffects: false`; install size is the cost. Can move to `optionalDependencies` / `peerDependencies` later if it matters.

## Decisions

Resolved:

- **Naming** — friendly verbs (`upload`, `download`, `delete`, ...).
- **`download` default return** — `Blob`-backed, with `{ as: "stream" }` opt-in. Likely wrapped in a `StoredFile` (see "Return-type unification" above) so we don't lose `key`/`etag`/`metadata`.
- **Key normalization** — trust the caller for now; let the underlying provider error.

Deferred (revisit later):

- **`url()` when no public URL exists** — throw for v1. Options for later: silent fallback to short-lived signed URL, or require explicit `{ public: true }` / `{ expiresIn }`.
- **R2 adapter input** — Cloudflare Workers can bind an `R2Bucket` directly (no credentials); other runtimes use R2's S3-compatible HTTP API with credentials. Open question: one `r2()` that auto-detects, or split into `r2()` + `r2Workers()`. Decide when building the R2 adapter.
