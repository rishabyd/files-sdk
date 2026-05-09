import { CodeTabs } from "./code-tabs";

const ADAPTERS = [
  {
    config: `s3({ bucket: "uploads", region: "us-east-1" })`,
    id: "s3",
    import: `import { s3 } from "files-sdk/s3";`,
    label: "S3",
  },
  {
    config: `r2({ bucket: "uploads", accountId: "..." })`,
    id: "r2",
    import: `import { r2 } from "files-sdk/r2";`,
    label: "R2",
  },
  {
    config: `vercelBlob()`,
    id: "vercel-blob",
    import: `import { vercelBlob } from "files-sdk/vercel-blob";`,
    label: "Vercel Blob",
  },
  {
    config: `netlifyBlobs({ name: "uploads" })`,
    id: "netlify-blobs",
    import: `import { netlifyBlobs } from "files-sdk/netlify-blobs";`,
    label: "Netlify Blobs",
  },
  {
    config: `minio({ bucket: "uploads", endpoint: "http://localhost:9000" })`,
    id: "minio",
    import: `import { minio } from "files-sdk/minio";`,
    label: "MinIO",
  },
  {
    config: `storj({ bucket: "uploads" })`,
    id: "storj",
    import: `import { storj } from "files-sdk/storj";`,
    label: "Storj",
  },
  {
    config: `hetzner({ bucket: "uploads", region: "fsn1" })`,
    id: "hetzner",
    import: `import { hetzner } from "files-sdk/hetzner";`,
    label: "Hetzner",
  },
  {
    config: `akamai({ bucket: "uploads", region: "us-iad-1" })`,
    id: "akamai",
    import: `import { akamai } from "files-sdk/akamai";`,
    label: "Akamai",
  },
  {
    config: `gcs({ bucket: "uploads" })`,
    id: "gcs",
    import: `import { gcs } from "files-sdk/gcs";`,
    label: "GCS",
  },
  {
    config: `googleDrive({
    credentials: {
      client_email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL!,
      private_key: process.env.GOOGLE_DRIVE_PRIVATE_KEY!,
    },
    driveId: process.env.GOOGLE_DRIVE_ID!,
    rootFolderId: process.env.GOOGLE_DRIVE_ID!,
  })`,
    id: "google-drive",
    import: `import { googleDrive } from "files-sdk/google-drive";`,
    label: "Google Drive",
  },
  {
    config: `azure({ container: "uploads" })`,
    id: "azure",
    import: `import { azure } from "files-sdk/azure";`,
    label: "Azure",
  },
  {
    config: `uploadthing()`,
    id: "uploadthing",
    import: `import { uploadthing } from "files-sdk/uploadthing";`,
    label: "UploadThing",
  },
] as const;

const buildCode = (adapter: (typeof ADAPTERS)[number]) =>
  `import { Files } from "files-sdk";
${adapter.import}

const files = new Files({
  adapter: ${adapter.config},
});

await files.upload("hello.txt", "world");
const file = await files.download("hello.txt");
const meta = await files.head("hello.txt");
const items = await files.list();
await files.delete("hello.txt");`;

const TABS = ADAPTERS.map((adapter) => ({
  code: buildCode(adapter),
  id: adapter.id,
  label: adapter.label,
  lang: "tsx" as const,
}));

export const Demo = () => <CodeTabs tabs={TABS} />;
