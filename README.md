# files-sdk

Unified storage SDK for object/blob backends — AWS S3, Cloudflare R2, Vercel Blob, MinIO.

```ts
import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";

const files = new Files({
  adapter: s3({ bucket: "uploads" }),
});

await files.upload("avatars/abc.png", file, { contentType: "image/png" });
const got = await files.download("avatars/abc.png");
```

Self-hosted MinIO works the same way:

```ts
import { Files } from "files-sdk";
import { minio } from "files-sdk/minio";

const files = new Files({
  adapter: minio({
    bucket: "uploads",
    endpoint: "http://localhost:9000",
    accessKeyId: process.env.MINIO_ACCESS_KEY_ID,
    secretAccessKey: process.env.MINIO_SECRET_ACCESS_KEY,
  }),
});
```

See [`plan.md`](./plan.md) for the v1 design.

## Repo

- `packages/files-sdk` — the published SDK package.
- `apps/web` — Next.js docs/marketing scaffold.

## Scripts

- `bun run build` — build the SDK (tsup).
- `bun run test` — run unit tests (`bun test`).
- `bun run types` — type-check the workspace.
- `bun run lint` — lint via Ultracite.
- `bun run format` — format via Ultracite.
- `bun run dev` — start dev tasks (Next.js dev server, watch builds).

## License

MIT
