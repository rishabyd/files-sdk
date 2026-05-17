---
"files-sdk": minor
---

Move provider SDKs to optional peer dependencies. Installing `files-sdk` no longer pulls in every provider SDK by default — the package fully installs at a fraction of the previous size, and unused providers can't drag in transitive CVEs. Install only what you use:

```sh
# S3 (and any S3-compatible: R2, MinIO, DigitalOcean Spaces, …)
npm install files-sdk @aws-sdk/client-s3 @aws-sdk/s3-presigned-post @aws-sdk/s3-request-presigner

# GCS
npm install files-sdk @google-cloud/storage google-auth-library

# Azure
npm install files-sdk @azure/storage-blob @azure/identity
```

**Breaking (install-time only):** if you upgrade and your project doesn't list the relevant provider SDK in its own `package.json`, the next adapter import will throw `ERR_MODULE_NOT_FOUND`. Fix is one `npm install`. The published JS for each adapter subpath (`files-sdk/s3`, `files-sdk/gcs`, …) is byte-identical to the previous release — provider SDKs were already externalized, so runtime behavior, tree-shaking, and bundle sizes don't change. The `files` CLI keeps `commander` as a regular dep, so `npx files` works out of the box. Fixes #34.
