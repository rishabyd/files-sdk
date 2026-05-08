import { CodeBlock } from "@/components/code-block";
import { Heading } from "@/components/heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const S3_EXAMPLE = `import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";

const files = new Files({
  adapter: s3({
    bucket: "uploads",
    region: "us-east-1",
    // credentials auto-loaded from the AWS chain
    // (env vars, IAM role, shared profile, ...)
  }),
});`;

const R2_EXAMPLE = `import { Files } from "files-sdk";
import { r2 } from "files-sdk/r2";

const files = new Files({
  adapter: r2({
    bucket: "uploads",
    accountId: process.env.R2_ACCOUNT_ID!,
    // accessKeyId / secretAccessKey auto-loaded
    // from R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
  }),
});`;

const VERCEL_BLOB_EXAMPLE = `import { Files } from "files-sdk";
import { vercelBlob } from "files-sdk/vercel-blob";

// BLOB_READ_WRITE_TOKEN is auto-injected on Vercel.
const files = new Files({ adapter: vercelBlob() });`;

export const Adapters = () => (
  <section>
    <Heading as="h2">Adapters</Heading>
    <p>
      Each adapter is a subpath import. Bring only what you use; the others
      tree-shake away. Adapters auto-load credentials from the standard
      environment variables for that provider — pass options explicitly to
      override. If an adapter is constructed without enough info to
      authenticate, it throws at construction time naming the missing variable.
    </p>

    <Tabs defaultValue="s3">
      <TabsList>
        <TabsTrigger value="s3">S3</TabsTrigger>
        <TabsTrigger value="r2">R2</TabsTrigger>
        <TabsTrigger value="vercel-blob">Vercel Blob</TabsTrigger>
      </TabsList>

      <TabsContent className="flex flex-col gap-4" value="s3">
        <p>
          AWS S3 (and any S3-compatible bucket). Uses the standard AWS
          credential chain — environment, IAM role, shared profile.
        </p>
        <CodeBlock code={S3_EXAMPLE} lang="ts" />
        <ul>
          <li>
            <code>bucket</code> — required.
          </li>
          <li>
            <code>region</code> — optional. Falls back to{" "}
            <code>AWS_REGION</code>.
          </li>
          <li>
            <code>credentials</code> — optional.{" "}
            <code>{"{ accessKeyId, secretAccessKey, sessionToken? }"}</code>.
          </li>
          <li>
            <code>endpoint</code> — optional. Override for S3-compatible
            services.
          </li>
        </ul>
      </TabsContent>

      <TabsContent className="flex flex-col gap-4" value="r2">
        <p>
          Cloudflare R2 over the S3-compatible HTTP API. Auto-loads from{" "}
          <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>,{" "}
          <code>R2_SECRET_ACCESS_KEY</code>. Inside Cloudflare Workers you can
          pass an <code>R2Bucket</code> binding directly instead.
        </p>
        <CodeBlock code={R2_EXAMPLE} lang="ts" />
      </TabsContent>

      <TabsContent className="flex flex-col gap-4" value="vercel-blob">
        <p>
          Vercel Blob. The <code>BLOB_READ_WRITE_TOKEN</code> is auto-injected
          when deployed on Vercel; pass <code>token</code> manually for local
          dev or other hosts.
        </p>
        <CodeBlock code={VERCEL_BLOB_EXAMPLE} lang="ts" />
      </TabsContent>
    </Tabs>
  </section>
);
