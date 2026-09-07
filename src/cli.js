import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCurrentGitState } from "./git.js";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
);

const helpText = `git-persona ${packageJson.version}

Switch Git identities, credentials, tokens, and SSH profiles without logging out.

Usage:
  git persona <command>
  git-persona <command>

Commands:
  migration        Register the current Git account as a persona
  current          Show the active Git persona
  list             List saved personas
  switch [id]      Switch persona, or open the terminal selector
  add <id>         Add a persona
  edit <id>        Edit a persona
  remove <id>      Remove a persona
  login <id>       Connect token credentials for a persona
  logout <id>      Remove credentials for a persona
  credentials      List credential targets without secret values
  repo             Manage repository persona bindings
  doctor           Check Git, credentials, SSH, and persona state

Options:
  -h, --help       Show this help
  -v, --version    Show the version
`;

const plannedCommands = new Set([
  "migration",
  "list",
  "switch",
  "add",
  "edit",
  "remove",
  "login",
  "logout",
  "credentials",
  "repo",
  "doctor",
]);

function formatValue(value) {
  return value ?? "(not set)";
}

function writeConfigBlock(io, title, values) {
  io.stdout.write(`${title}\n`);
  io.stdout.write(`  user.name: ${formatValue(values["user.name"])}\n`);
  io.stdout.write(`  user.email: ${formatValue(values["user.email"])}\n`);
  io.stdout.write(`  user.signingkey: ${formatValue(values["user.signingkey"])}\n`);
  io.stdout.write(`  gpg.format: ${formatValue(values["gpg.format"])}\n`);
  io.stdout.write(`  commit.gpgsign: ${formatValue(values["commit.gpgsign"])}\n`);
  io.stdout.write(
    `  credential.helper: ${formatValue(values["credential.helper"])}\n`,
  );
}

function runCurrent(io) {
  const state = getCurrentGitState();

  io.stdout.write("Current Git state\n");
  io.stdout.write(`Repository: ${state.isRepository ? "yes" : "no"}\n\n`);

  writeConfigBlock(io, "Global config:", state.global);

  if (state.local) {
    io.stdout.write("\n");
    writeConfigBlock(io, "Local config:", state.local);
  }
}

export function run(args, io) {
  const [command] = args;

  if (!command || command === "-h" || command === "--help") {
    io.stdout.write(helpText);
    return;
  }

  if (command === "-v" || command === "--version") {
    io.stdout.write(`${packageJson.version}\n`);
    return;
  }

  if (command === "current") {
    runCurrent(io);
    return;
  }

  if (plannedCommands.has(command)) {
    io.stderr.write(
      `git-persona: '${command}' is planned but not implemented yet.\n`,
    );
    io.exit(2);
    return;
  }

  io.stderr.write(`git-persona: unknown command '${command}'\n\n`);
  io.stderr.write(helpText);
  io.exit(2);
}
