import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfigPath, listProfiles, loadConfig } from "./config.js";
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

function formatSelected(isSelected) {
  return isSelected ? "◉" : "○";
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

function parseMigrationArgs(args) {
  const options = {
    dryRun: false,
    name: null,
    scope: "global",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--repo") {
      options.scope = "repo";
      continue;
    }

    if (arg === "--name") {
      const value = args[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error("--name requires a value");
      }

      options.name = value;
      index += 1;
      continue;
    }

    throw new Error(`unknown migration option '${arg}'`);
  }

  return options;
}

function inferProfileName(state, values) {
  if (state.githubCredential.username) {
    return state.githubCredential.username;
  }

  if (values["user.email"]) {
    return values["user.email"].split("@")[0];
  }

  if (values["user.name"]) {
    return values["user.name"].toLowerCase().replace(/\s+/g, "-");
  }

  return "default";
}

function runMigration(args, io) {
  let options;

  try {
    options = parseMigrationArgs(args);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  const state = getCurrentGitState();
  const values = options.scope === "repo" && state.local ? state.local : state.effective;
  const profileName = options.name ?? inferProfileName(state, values);

  io.stdout.write("Migration preview\n");
  io.stdout.write(`Profile: ${profileName}\n`);
  io.stdout.write(`Scope: ${options.scope}\n`);
  io.stdout.write(`Repository: ${state.isRepository ? "yes" : "no"}\n\n`);
  writeConfigBlock(io, "Detected Git config:", values);
  io.stdout.write("\n");
  io.stdout.write("Detected GitHub credential:\n");
  io.stdout.write(
    `  status: ${state.githubCredential.found ? "found" : "not found"}\n`,
  );
  io.stdout.write(
    `  github id: ${formatValue(state.githubCredential.username)}\n`,
  );
  io.stdout.write("  token: (hidden)\n\n");

  if (options.dryRun) {
    io.stdout.write("No files were changed because --dry-run was used.\n");
    return;
  }

  io.stderr.write(
    "git-persona: migration confirmation flow is not implemented yet. Use --dry-run to preview.\n",
  );
  io.exit(2);
}

function runList(io) {
  let config;

  try {
    config = loadConfig();
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  const profiles = listProfiles(config);

  io.stdout.write("Git personas\n");
  io.stdout.write(`Config: ${getConfigPath()}\n\n`);

  if (profiles.length === 0) {
    io.stdout.write("No personas saved yet.\n");
    io.stdout.write("Run `git persona migration --dry-run` to preview the current Git account.\n");
    return;
  }

  for (const profile of profiles) {
    const marker = formatSelected(profile.id === config.active.global);
    const email = profile.git?.email ? ` <${profile.git.email}>` : "";
    const credential = profile.auth?.https?.username
      ? ` [https:${profile.auth.https.username}]`
      : "";

    io.stdout.write(`${marker} ${profile.id}${email}${credential}\n`);
  }
}

export function run(args, io) {
  const [command, ...commandArgs] = args;

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

  if (command === "migration") {
    runMigration(commandArgs, io);
    return;
  }

  if (command === "list") {
    runList(io);
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
