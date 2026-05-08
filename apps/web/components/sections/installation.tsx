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
  </section>
);
