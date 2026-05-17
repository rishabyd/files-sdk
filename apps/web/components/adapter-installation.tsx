import { Fragment } from "react";

import { CodeTabs } from "@/components/code-tabs";
import { Heading } from "@/components/heading";

interface AdapterInstallationProps {
  peerDeps: readonly string[];
}

const listFormatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

const buildPeerDepSegments = (peerDeps: readonly string[]) => {
  const segments: { prefix: string; element: string }[] = [];
  let prefix = "";
  for (const part of listFormatter.formatToParts(peerDeps)) {
    if (part.type === "literal") {
      prefix += part.value;
    } else {
      segments.push({ element: part.value, prefix });
      prefix = "";
    }
  }
  return segments;
};

const buildTabs = (peerDeps: readonly string[]) => {
  const packages = ["files-sdk", ...peerDeps].join(" ");
  return [
    { code: `npm install ${packages}`, id: "npm", label: "npm", lang: "bash" },
    { code: `pnpm add ${packages}`, id: "pnpm", label: "pnpm", lang: "bash" },
    { code: `bun add ${packages}`, id: "bun", label: "bun", lang: "bash" },
    { code: `yarn add ${packages}`, id: "yarn", label: "yarn", lang: "bash" },
  ] as const;
};

export const AdapterInstallation = ({ peerDeps }: AdapterInstallationProps) => {
  const tabs = buildTabs(peerDeps);

  return (
    <section>
      <Heading as="h2" id="installation">
        Installation
      </Heading>
      {peerDeps.length === 0 ? (
        <p>
          This adapter has no extra peer dependencies - the runtime (Node or
          Bun) provides everything it needs.
        </p>
      ) : (
        <p>
          {buildPeerDepSegments(peerDeps).map(({ prefix, element }) => (
            <Fragment key={element}>
              {prefix}
              <code>{element}</code>
            </Fragment>
          ))}{" "}
          {peerDeps.length === 1 ? "is an" : "are"} optional peer{" "}
          {peerDeps.length === 1 ? "dependency" : "dependencies"} of{" "}
          <code>files-sdk</code> - install alongside the SDK so the adapter's
          imports resolve at runtime.
        </p>
      )}
      <CodeTabs tabs={tabs} />
    </section>
  );
};
