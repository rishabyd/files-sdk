---
"files-sdk": patch
---

Improve test coverage and remove dead code in the fs adapter. Adds tests for r2's HTTP-path delegation (copy/delete/download/head/list/signedUploadUrl proxies to the lazy-loaded inner s3 adapter, plus the `raw` getter's pre/post-init behavior) and for fs uploads with `ArrayBuffer` and `ArrayBufferView` bodies plus rejection of keys that resolve to the adapter root. Drops the unreachable `ReadableStream` branch in `fs/bodyToBytes` — stream uploads route through `writeStreamToTempThenRename`, so the parameter type is narrowed to `Exclude<Body, ReadableStream<Uint8Array>>` to enforce that at the type level.
