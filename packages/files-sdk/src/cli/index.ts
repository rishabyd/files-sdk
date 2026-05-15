#!/usr/bin/env node
import { fail } from "./io.js";
import { buildProgram } from "./program.js";

// Downstream consumers (head, less, piping into another process) close their
// end of the pipe before we finish writing. The default Node behavior is to
// throw EPIPE and exit nonzero with a stack trace — unfriendly for what is
// normal UNIX usage. Treat closed-downstream as success.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

// Always run on import — this module is wired up as the package's `bin`
// entry, not consumed as a library. Tests/inspectors that need the program
// itself import `./program.js` directly.
try {
  await buildProgram().parseAsync(process.argv);
} catch (error) {
  fail(error, { json: true, pretty: false, verbose: false });
}
