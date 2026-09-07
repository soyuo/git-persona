#!/usr/bin/env node

import { run } from "../src/index.js";

run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  exit: process.exit,
});
