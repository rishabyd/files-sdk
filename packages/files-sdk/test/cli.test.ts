import { describe, expect, test } from "bun:test";

import { parseJson, parseKeyValuePairs } from "../src/cli/io.js";
import { buildProgram } from "../src/cli/program.js";
import { PROVIDER_NAMES, PROVIDERS } from "../src/cli/registry.js";
import { FilesError } from "../src/internal/errors.js";

describe("cli/io", () => {
  test("parseKeyValuePairs splits k=v", () => {
    expect(parseKeyValuePairs(["a=1", "b=two"])).toEqual({ a: "1", b: "two" });
  });

  test("parseKeyValuePairs preserves '=' inside values", () => {
    expect(parseKeyValuePairs(["token=abc=def"])).toEqual({
      token: "abc=def",
    });
  });

  test("parseKeyValuePairs throws on missing =", () => {
    expect(() => parseKeyValuePairs(["bad"])).toThrow(FilesError);
  });

  test("parseKeyValuePairs returns undefined for empty input", () => {
    expect(parseKeyValuePairs()).toBeUndefined();
    expect(parseKeyValuePairs([])).toBeUndefined();
  });

  test("parseJson round-trips valid JSON", () => {
    expect(parseJson<{ region: string }>('{"region":"us-east-1"}')).toEqual({
      region: "us-east-1",
    });
  });

  test("parseJson returns undefined for empty input", () => {
    expect(parseJson()).toBeUndefined();
    expect(parseJson("")).toBeUndefined();
  });

  test("parseJson throws FilesError on malformed JSON", () => {
    expect(() => parseJson("{bad")).toThrow(FilesError);
  });
});

describe("cli/registry", () => {
  test("PROVIDER_NAMES is sorted and non-empty", () => {
    expect(PROVIDER_NAMES.length).toBeGreaterThan(0);
    const sorted = [...PROVIDER_NAMES].toSorted();
    expect(PROVIDER_NAMES).toEqual(sorted);
  });

  test("every PROVIDER entry exposes a load() function", () => {
    for (const name of PROVIDER_NAMES) {
      const entry = PROVIDERS[name];
      expect(entry).toBeDefined();
      expect(typeof entry?.load).toBe("function");
      expect(Array.isArray(entry?.required)).toBe(true);
    }
  });

  test("PROVIDER_NAMES covers s3, r2, fs, gcs, azure", () => {
    for (const required of ["s3", "r2", "fs", "gcs", "azure"]) {
      expect(PROVIDER_NAMES).toContain(required);
    }
  });
});

describe("cli/program", () => {
  test("buildProgram registers the expected commands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).toSorted();
    expect(names).toEqual([
      "copy",
      "delete",
      "download",
      "exists",
      "head",
      "list",
      "mcp",
      "sign-upload",
      "upload",
      "url",
    ]);
  });

  test("global flags include the documented set", () => {
    const program = buildProgram();
    const longs = program.options.map((o) => o.long);
    for (const flag of [
      "--provider",
      "--config-json",
      "--bucket",
      "--region",
      "--endpoint",
      "--access-key-id",
      "--secret-access-key",
      "--token",
      "--access",
      "--no-json",
      "--pretty",
      "--verbose",
      "--dry-run",
    ]) {
      expect(longs).toContain(flag);
    }
  });

  test("--no-json maps to json=false; --pretty/--verbose/--dry-run default off", () => {
    // Parsing the options requires a subcommand to satisfy commander; use one
    // that's safe under exitOverride and a missing provider — `--dry-run` on
    // `list` would still want a provider, so we just inspect parseOptions
    // (which doesn't dispatch any action).
    const program = buildProgram();
    const parsed = program.parseOptions([
      "--no-json",
      "--pretty",
      "--verbose",
      "--dry-run",
    ]);
    // parseOptions sets values on the program; check via opts()
    const opts = program.opts() as {
      json: boolean;
      pretty: boolean;
      verbose: boolean;
      dryRun: boolean;
    };
    expect(opts.json).toBe(false);
    expect(opts.pretty).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(parsed.unknown).toEqual([]);
  });

  // commander's Option public type omits the `conflictsWith` runtime field —
  // narrow via a structural cast so the test still asserts the wiring.
  interface WithConflicts {
    conflictsWith: readonly string[];
  }

  test("upload's --file declares conflict with --stdin (and vice versa)", () => {
    const program = buildProgram();
    const upload = program.commands.find((c) => c.name() === "upload");
    expect(upload).toBeDefined();
    const fileOpt = upload?.options.find((o) => o.long === "--file");
    const stdinOpt = upload?.options.find((o) => o.long === "--stdin");
    expect((fileOpt as unknown as WithConflicts).conflictsWith).toContain(
      "stdin"
    );
    expect((stdinOpt as unknown as WithConflicts).conflictsWith).toContain(
      "file"
    );
  });

  test("download's --out declares conflict with --stdout (and vice versa)", () => {
    const program = buildProgram();
    const download = program.commands.find((c) => c.name() === "download");
    expect(download).toBeDefined();
    const outOpt = download?.options.find((o) => o.long === "--out");
    const stdoutOpt = download?.options.find((o) => o.long === "--stdout");
    expect((outOpt as unknown as WithConflicts).conflictsWith).toContain(
      "stdout"
    );
    expect((stdoutOpt as unknown as WithConflicts).conflictsWith).toContain(
      "out"
    );
  });

  test("version is reported via .version() and matches semver", () => {
    const program = buildProgram();
    // commander stores the configured version on the program; we just check
    // that it's a semver-looking string (the actual value is sourced from
    // package.json at build time).
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
