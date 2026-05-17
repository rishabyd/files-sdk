import Link from "next/link";

import { CodeTabs } from "@/components/code-tabs";
import { Heading } from "@/components/heading";

const TABS = [
  {
    code: "npm install files-sdk",
    id: "npm",
    label: "npm",
    lang: "bash",
  },
  {
    code: "pnpm add files-sdk",
    id: "pnpm",
    label: "pnpm",
    lang: "bash",
  },
  {
    code: "bun add files-sdk",
    id: "bun",
    label: "bun",
    lang: "bash",
  },
  {
    code: "yarn add files-sdk",
    id: "yarn",
    label: "yarn",
    lang: "bash",
  },
] as const;

export const Installation = () => (
  <section>
    <Heading as="h2">Installation</Heading>
    <CodeTabs tabs={TABS} />
    <p>
      Each provider&apos;s native SDK is an optional peer dependency - install
      only the ones you actually use, alongside <code>files-sdk</code> itself.
      See the{" "}
      <Link
        className="underline decoration-dotted underline-offset-4 hover:text-foreground"
        href="/adapters"
      >
        adapter
      </Link>{" "}
      you&apos;re using for its install command. If you import an adapter
      without its peer installed, Node throws <code>ERR_MODULE_NOT_FOUND</code>{" "}
      naming the missing package.
    </p>
  </section>
);
