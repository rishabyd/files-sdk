const sections = [
  { id: "why", label: "Why" },
  { id: "installation", label: "Installation" },
  { id: "quick-start", label: "Quick start" },
  { id: "adapters", label: "Adapters" },
  { id: "api-reference", label: "API reference" },
  { id: "the-storedfile-type", label: "The StoredFile type" },
  { id: "errors", label: "Errors" },
  { id: "escape-hatch", label: "Escape hatch" },
  { id: "compatibility-matrix", label: "Compatibility matrix" },
];

export const MobileTableOfContents = () => (
  <details
    className="rounded-md border border-dotted lg:hidden"
    suppressHydrationWarning
  >
    <summary className="cursor-pointer select-none px-4 py-3 text-sm text-foreground">
      On this page
    </summary>
    <ul
      role="list"
      className="!list-none !pl-0 flex flex-col gap-1 border-t border-dotted px-4 py-3"
    >
      {sections.map(({ id, label }) => (
        <li className="text-sm" key={id}>
          <a
            className="block py-1 text-muted-foreground transition-colors hover:text-foreground"
            href={`#${id}`}
          >
            {label}
          </a>
        </li>
      ))}
    </ul>
  </details>
);
