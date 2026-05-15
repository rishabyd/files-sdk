import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { FilesError } from "../internal/errors.js";
import { storedFileToJson } from "./io.js";
import { loadFiles } from "./loader.js";
import type { GlobalCliOptions } from "./loader.js";

const pkg = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

export interface McpServerOpts {
  global: GlobalCliOptions;
}

const ok = (data: unknown) => ({
  content: [{ text: JSON.stringify(data, null, 2), type: "text" as const }],
});

const errorPayload = (err: unknown) => {
  const code = err instanceof FilesError ? err.code : "Provider";
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        text: JSON.stringify({ error: { code, message } }, null, 2),
        type: "text" as const,
      },
    ],
    isError: true,
  };
};

/**
 * Start an MCP server on stdio that exposes every CLI command as an MCP
 * tool. Provider + credentials are bound at server startup (from the
 * global flags / env), so each tool call only needs operation arguments —
 * the agent doesn't have to thread credentials through every request.
 */
export const startMcpServer = async (opts: McpServerOpts): Promise<void> => {
  const server = new McpServer({
    name: "files-sdk",
    version: pkg.version,
  });

  const withFiles = async <T>(
    fn: (files: Awaited<ReturnType<typeof loadFiles>>["files"]) => Promise<T>
  ) => {
    const { files } = await loadFiles(opts.global);
    return fn(files);
  };

  server.registerTool(
    "upload",
    {
      description:
        "Upload bytes to the configured provider at the given key. Body may be inline UTF-8 text or base64-encoded binary.",
      inputSchema: {
        base64: z
          .string()
          .optional()
          .describe("Base64-encoded body (mutually exclusive with text)"),
        cacheControl: z.string().optional(),
        contentType: z.string().optional(),
        key: z.string().describe("Object key (path) within the bucket/store"),
        metadata: z
          .record(z.string(), z.string())
          .optional()
          .describe("Metadata as a string-to-string object"),
        text: z
          .string()
          .optional()
          .describe("UTF-8 body (mutually exclusive with base64)"),
      },
      title: "Upload a file",
    },
    async ({ key, text, base64, contentType, cacheControl, metadata }) => {
      try {
        let body: Uint8Array | undefined;
        if (text === undefined) {
          if (base64 !== undefined) {
            body = new Uint8Array(Buffer.from(base64, "base64"));
          }
        } else {
          body = new TextEncoder().encode(text);
        }
        if (!body) {
          throw new FilesError(
            "Provider",
            "expected either `text` or `base64` body"
          );
        }
        return await withFiles(async (files) => {
          const result = await files.upload(key, body, {
            cacheControl,
            contentType,
            metadata,
          });
          return ok(result);
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "download",
    {
      description:
        "Download bytes for the given key. Returns metadata + base64 body so binary roundtrips safely through MCP.",
      inputSchema: {
        key: z.string(),
      },
      title: "Download a file",
    },
    async ({ key }) => {
      try {
        return await withFiles(async (files) => {
          const file = await files.download(key);
          const buf = Buffer.from(await file.arrayBuffer());
          return ok({
            ...storedFileToJson(file),
            base64: buf.toString("base64"),
          });
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "head",
    {
      description: "Fetch metadata for `key` without transferring its body.",
      inputSchema: { key: z.string() },
      title: "Get object metadata",
    },
    async ({ key }) => {
      try {
        return await withFiles(async (files) => {
          const file = await files.head(key);
          return ok(storedFileToJson(file));
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "exists",
    {
      description: "Returns { key, exists }.",
      inputSchema: { key: z.string() },
      title: "Check whether a key exists",
    },
    async ({ key }) => {
      try {
        return await withFiles(async (files) => {
          const exists = await files.exists(key);
          return ok({ exists, key });
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "delete",
    {
      description: "Permanently delete the object at `key`.",
      inputSchema: { key: z.string() },
      title: "Delete a key",
    },
    async ({ key }) => {
      try {
        return await withFiles(async (files) => {
          await files.delete(key);
          return ok({ deleted: true, key });
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "copy",
    {
      description: "Copy `from` to `to` within the same store.",
      inputSchema: { from: z.string(), to: z.string() },
      title: "Server-side copy",
    },
    async ({ from, to }) => {
      try {
        return await withFiles(async (files) => {
          await files.copy(from, to);
          return ok({ copied: true, from, to });
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "list",
    {
      description:
        "List up to `limit` objects under an optional `prefix`. Paginated via `cursor`.",
      inputSchema: {
        cursor: z.string().optional(),
        limit: z.number().int().positive().optional(),
        prefix: z.string().optional(),
      },
      title: "List objects",
    },
    async ({ prefix, cursor, limit }) => {
      try {
        return await withFiles(async (files) => {
          const result = await files.list({ cursor, limit, prefix });
          return ok({
            cursor: result.cursor,
            items: result.items.map(storedFileToJson),
          });
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "url",
    {
      description:
        "Return a URL for `key` — presigned on signing adapters, public on CDN-backed ones.",
      inputSchema: {
        expiresIn: z.number().int().positive().optional(),
        key: z.string(),
        responseContentDisposition: z.string().optional(),
      },
      title: "Build a URL",
    },
    async ({ key, expiresIn, responseContentDisposition }) => {
      try {
        return await withFiles(async (files) => {
          const url = await files.url(key, {
            expiresIn,
            responseContentDisposition,
          });
          return ok({ key, url });
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  server.registerTool(
    "sign-upload",
    {
      description:
        "Produce a presigned upload URL/form. `maxSize` enables a POST policy (recommended).",
      inputSchema: {
        contentType: z.string().optional(),
        expiresIn: z.number().int().positive(),
        key: z.string(),
        maxSize: z.number().int().positive().optional(),
        minSize: z.number().int().nonnegative().optional(),
      },
      title: "Sign an upload URL",
    },
    async ({ key, expiresIn, contentType, maxSize, minSize }) => {
      try {
        return await withFiles(async (files) => {
          const signed = await files.signedUploadUrl(key, {
            contentType,
            expiresIn,
            maxSize,
            minSize,
          });
          return ok({ key, ...signed });
        });
      } catch (error) {
        return errorPayload(error);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};
