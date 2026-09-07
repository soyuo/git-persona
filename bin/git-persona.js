#!/usr/bin/env node

import { run } from "../src/index.js";

await run(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: process.exit,
});
