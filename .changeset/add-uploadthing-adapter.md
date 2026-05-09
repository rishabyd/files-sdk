---
"files-sdk": minor
---

Add UploadThing adapter (`files-sdk/uploadthing`). Maps the user-supplied key onto UploadThing's `customId`, supports public-read and private ACLs, signs UFS presigned PUT URLs via Web Crypto HMAC-SHA256, and falls back to HEAD-on-URL for `head()` and read-then-write for `copy()` since UploadThing has no native primitives for those.
