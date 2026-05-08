export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-8 dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-6">
        <h1 className="font-semibold text-4xl text-zinc-900 tracking-tight dark:text-zinc-50">
          files-sdk
        </h1>
        <p className="text-lg text-zinc-600 leading-7 dark:text-zinc-400">
          A unified storage SDK for object/blob backends — S3, Cloudflare R2,
          Vercel Blob.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <code>{`import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";

const files = new Files({
  adapter: s3({ bucket: "uploads" }),
});

await files.upload("a.png", file);`}</code>
        </pre>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Docs coming soon.
        </p>
      </main>
    </div>
  );
}
