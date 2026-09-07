import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { configPath, load, profiles as list, save } from "./config.js";
import {
  applyProfile,
  clearProfile,
  gitState,
  rewriteGithubRemotes,
  runGitCommand,
} from "./git/index.js";
import { aqua, blue, dim, green } from "./style.js";
import { currentLocale, localeOf, message } from "./langs/index.js";
import {
  runCredentials,
  runCheck,
  runLogin,
  runLogout,
  runProfileCommand,
  runLang,
} from "./commands/index.js";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
);

function helpText(locale) {
  return [
    message(locale, "help.title", { version: packageJson.version }),
    "",
    message(locale, "help.description"),
    "",
    message(locale, "help.usage"),
    message(locale, "help.gitCommand"),
    message(locale, "help.binaryCommand"),
    "",
    message(locale, "help.commands"),
    ...["migration", "current", "list", "switch", "add", "edit", "remove", "login", "logout", "credentials", "repo", "run", "check", "lang"]
      .map((command) => message(locale, `help.${command}`)),
    "",
    message(locale, "help.options"),
    message(locale, "help.help"),
    message(locale, "help.version"),
    "",
  ].join("\n");
}

/*
git-persona ${packageJson.version}

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
  run <git-command> Run a Git command with SSH fallback
  check            Check Git, credentials, SSH, and persona state
  lang <locale>    Set global or repository language

Options:
  -h, --help       Show this help
  -v, --version    Show the version
`;
*/

const plannedCommands = new Set([
  "login",
  "logout",
  "credentials",
]);

function formatValue(value) {
  return value ?? "(not set)";
}

function formatSelected(isSelected, stream) {
  return isSelected ? aqua("◉", stream) : dim("○", stream);
}

function writeConfigBlock(io, title, values, locale) {
  io.stdout.write(`${blue(title, io.stdout)}\n`);
  const fields = [
    ["config.userName", "user.name"],
    ["config.userEmail", "user.email"],
    ["config.signingKey", "user.signingkey"],
    ["config.gpgFormat", "gpg.format"],
    ["config.gpgSign", "commit.gpgsign"],
    ["config.credentialHelper", "credential.helper"],
    ["config.githubUser", "credential.https://github.com.username"],
  ];
  for (const [key, field] of fields) {
    io.stdout.write(`${message(locale, key, { value: formatValue(values[field]) })}\n`);
  }
}

function runCurrent(io) {
  const state = gitState();
  const config = load();
  const locale = localeOf(config, state.cwd);
  const repoId = state.isRepository ? config.active.repositories[state.cwd] ?? null : null;
  const activeId = repoId ?? config.active.global;

  io.stdout.write(`${blue(message(locale, "current.title"), io.stdout)}\n`);
  io.stdout.write(`${message(locale, "current.repository", { value: state.isRepository ? "yes" : "no" })}\n\n`);
  io.stdout.write(`${message(locale, "current.active", { value: formatValue(activeId) })}\n`);

  if (repoId) {
    io.stdout.write(`${message(locale, "current.binding", { id: repoId })}\n`);
  }

  io.stdout.write("\n");

  writeConfigBlock(io, message(locale, "config.global"), state.global, locale);

  if (state.local) {
    io.stdout.write("\n");
    writeConfigBlock(io, message(locale, "config.local"), state.local, locale);
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

function parseSwitchArgs(args) {
  const options = {
    id: null,
    scope: "global",
  };

  for (const arg of args) {
    if (arg === "--repo") {
      options.scope = "repo";
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`unknown switch option '${arg}'`);
    }

    if (options.id) {
      throw new Error(`unexpected switch argument '${arg}'`);
    }

    options.id = arg;
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

function migrationProfile(name, state, values) {
  const httpsUsername = state.githubCredential.username ?? name;

  return {
    id: name,
    git: {
      name: values["user.name"],
      email: values["user.email"],
      signingKey: values["user.signingkey"],
      gpgFormat: values["gpg.format"],
      commitGpgSign: values["commit.gpgsign"],
      credentialHelper: values["credential.helper"],
    },
    auth: {
      preferred: "https",
      https: {
        host: "github.com",
        username: httpsUsername,
        credentialTarget: "git:https://github.com",
        tokenStored: state.githubCredential.found,
      },
      ssh: {
        fallback: true,
        signingKey: values["user.signingkey"],
      },
    },
  };
}

async function confirmMigration(io) {
  io.stdout.write(`${message(currentLocale(), "migration.confirm")}`);

  if (!io.stdin?.isTTY) {
    const input = readFileSync(io.stdin?.fd ?? 0, "utf8").trim().toLowerCase();

    return input === "y" || input === "yes";
  }

  const readline = createInterface({
    input: io.stdin,
    output: io.stdout,
  });

  try {
    const answer = (await readline.question("")).trim().toLowerCase();

    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
}

function applyMigration(profileName, profile, options, state) {
  const config = load();

  config.profiles[profileName] = profile;

  if (options.scope === "repo") {
    config.active.repositories[state.cwd] = profileName;
  } else {
    config.active.global = profileName;
  }

  save(config);
}

async function runMigration(args, io) {
  let options;

  try {
    options = parseMigrationArgs(args);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  const state = gitState();
  const values = options.scope === "repo" && state.local ? state.local : state.effective;
  const profileName = options.name ?? inferProfileName(state, values);
  const profile = migrationProfile(profileName, state, values);

  const locale = localeOf(load(), state.cwd);
  io.stdout.write(`${blue(message(locale, "migration.preview"), io.stdout)}\n`);
  io.stdout.write(`${message(locale, "migration.profile", { id: profileName })}\n`);
  io.stdout.write(`${message(locale, "migration.scope", { scope: options.scope })}\n`);
  io.stdout.write(`${message(locale, "migration.repository", { value: state.isRepository ? "yes" : "no" })}\n\n`);
  writeConfigBlock(io, message(locale, "migration.detectedConfig"), values, locale);
  io.stdout.write("\n");
  io.stdout.write(`${message(locale, "migration.detectedCredential")}\n`);
  io.stdout.write(
    `${message(locale, "migration.credentialStatus", { value: state.githubCredential.found ? "found" : "not found" })}\n`,
  );
  io.stdout.write(
    `${message(locale, "migration.githubId", { value: formatValue(state.githubCredential.username) })}\n`,
  );
  io.stdout.write(`${message(locale, "migration.tokenHidden")}\n\n`);

  if (options.dryRun) {
    io.stdout.write(`${message(locale, "migration.dryRun")}\n`);
    return;
  }

  const confirmed = await confirmMigration(io);

  if (!confirmed) {
    io.stdout.write(`${message(locale, "migration.cancelled")}\n`);
    return;
  }

  try {
    applyMigration(profileName, profile, options, state);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`${message(locale, "migration.saved", { id: profileName })}\n`);
  io.stdout.write(`${message(locale, "config.path", { path: configPath() })}\n`);
}

function runList(io) {
  let config;

  try {
    config = load();
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  const profiles = list(config);
  const locale = localeOf(config);

  io.stdout.write(`${blue(message(locale, "list.title"), io.stdout)}\n`);
  io.stdout.write(`${message(locale, "config.path", { path: configPath() })}\n\n`);

  if (profiles.length === 0) {
    io.stdout.write(`${message(locale, "list.empty")}\n`);
    io.stdout.write(`${message(locale, "list.migrationHint")}\n`);
    return;
  }

  for (const profile of profiles) {
    const marker = formatSelected(profile.id === config.active.global, io.stdout);
    const email = profile.git?.email ? ` <${profile.git.email}>` : "";
    const credential = profile.auth?.https?.username
      ? ` [https:${profile.auth.https.username}]`
      : "";

    const id = profile.id === config.active.global ? aqua(profile.id, io.stdout) : profile.id;
    io.stdout.write(`${marker} ${id}${email}${credential}\n`);
  }
}

function authFailure(result) {
  const message = `${result.stdout}\n${result.stderr}`.toLowerCase();

  return [
    "authentication failed",
    "could not read username",
    "permission denied",
    "access denied",
    "repository not found",
  ].some((text) => message.includes(text));
}

function writeGitResult(io, result) {
  if (result.stdout) {
    io.stdout.write(`${result.stdout}\n`);
  }

  if (result.stderr) {
    io.stderr.write(`${result.stderr}\n`);
  }
}

function activeId(config, state) {
  return state.isRepository
    ? config.active.repositories[state.cwd] ?? config.active.global
    : config.active.global;
}

function runGitWithFallback(args, io) {
  const locale = currentLocale();
  if (args.length === 0) {
    io.stderr.write(`git-persona: ${message(locale, "run.requiresCommand")}\n`);
    io.exit(2);
    return;
  }

  const first = runGitCommand(args);

  if (first.ok || !authFailure(first)) {
    writeGitResult(io, first);

    if (!first.ok) {
      io.exit(first.status ?? 1);
    }

    return;
  }

  let changed;

  try {
    changed = rewriteGithubRemotes();
  } catch (error) {
    writeGitResult(io, first);
    io.stderr.write(`git-persona: ${message(locale, "run.rewriteFailed", { error: error.message })}\n`);
    io.exit(first.status ?? 1);
    return;
  }

  if (changed.length === 0) {
    writeGitResult(io, first);
    io.stderr.write(`git-persona: ${message(locale, "run.noRemote")}\n`);
    io.exit(first.status ?? 1);
    return;
  }

  io.stderr.write(`git-persona: ${message(locale, "run.retry")}\n`);

  const retry = runGitCommand(args);
  writeGitResult(io, retry);

  if (retry.ok) {
    return;
  }

  const config = load();
  const id = activeId(config, gitState());
  const login = id ? `git persona login ${id}` : "git persona login <id>";

  io.stderr.write(`git-persona: ${message(locale, "run.sshFailed", { login })}\n`);
  io.exit(retry.status ?? 1);
}

function parseRepoArgs(args) {
  const options = {
    action: null,
    id: null,
  };

  const [action, id] = args;

  if (!action) {
    return options;
  }

  if (action === "bind") {
    if (!id || id.startsWith("--")) {
      throw new Error("repo bind requires a persona id");
    }

    options.action = "bind";
    options.id = id;
    return options;
  }

  if (action === "unbind") {
    if (id) {
      throw new Error("repo unbind takes no extra arguments");
    }

    options.action = "unbind";
    return options;
  }

  throw new Error(`unknown repo action '${action}'`);
}

function runRepo(args, io) {
  const locale = currentLocale();
  let options;

  try {
    options = parseRepoArgs(args);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  if (!options.action) {
    io.stderr.write(`git-persona: ${message(locale, "repo.usage")}\n`);
    io.exit(2);
    return;
  }

  const state = gitState();

  if (!state.isRepository) {
    io.stderr.write(`git-persona: ${message(locale, "repo.requiresRepo")}\n`);
    io.exit(1);
    return;
  }

  let config;

  try {
    config = load();
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  if (options.action === "bind") {
    const profile = config.profiles[options.id];

    if (!profile) {
      io.stderr.write(`git-persona: ${message(locale, "profile.missing", { id: options.id })}\n`);
      io.exit(1);
      return;
    }

    try {
      applyProfile(profile, "repo", state.cwd);
      config.active.repositories[state.cwd] = profile.id;
      save(config);
    } catch (error) {
      io.stderr.write(`git-persona: ${error.message}\n`);
      io.exit(1);
      return;
    }

    io.stdout.write(`${message(locale, "repo.bound", { id: profile.id })}\n`);
    return;
  }

  try {
    clearProfile("repo", state.cwd);
    delete config.active.repositories[state.cwd];
    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`${message(locale, "repo.unbound")}\n`);
}

function renderPicker(io, profiles, index) {
  const locale = currentLocale();
  io.stdout.write("\x1b[2J\x1b[H");
  io.stdout.write(`${blue(message(locale, "picker.title"), io.stdout)}\n\n`);

  for (let i = 0; i < profiles.length; i += 1) {
    const profile = profiles[i];
    const email = profile.git?.email ? ` <${profile.git.email}>` : "";
    const cred = profile.auth?.https?.username ? ` [https:${profile.auth.https.username}]` : "";

    const selected = i === index;
    const id = selected ? aqua(profile.id, io.stdout) : profile.id;
    io.stdout.write(`${formatSelected(selected, io.stdout)} ${id}${email}${cred}\n`);
  }

  io.stdout.write(`\n${message(locale, "picker.help")}\n`);
}

async function chooseProfile(io, profiles, startIndex) {
  if (!io.stdin?.isTTY || !io.stdout?.isTTY) {
    throw new Error("terminal selector requires an interactive terminal");
  }

  const input = io.stdin;
  const output = io.stdout;
  let index = Math.max(0, Math.min(startIndex, profiles.length - 1));

  return await new Promise((resolve, reject) => {
    let closed = false;

    const finish = (value) => {
      if (closed) {
        return;
      }

      closed = true;
      input.off("keypress", onKey);

      if (typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }

      input.pause();

      output.write("\x1b[?25h");
      resolve(value);
    };

    const cancel = () => {
      finish(null);
      reject(new Error("selection cancelled"));
    };

    const draw = () => renderPicker(io, profiles, index);

    const onKey = (str, key) => {
      if (key.name === "up" || key.name === "k") {
        index = (index - 1 + profiles.length) % profiles.length;
        draw();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % profiles.length;
        draw();
        return;
      }

      if (key.name === "return") {
        finish(profiles[index]);
        return;
      }

      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cancel();
      }
    };

    emitKeypressEvents(input);

    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }

    output.write("\x1b[?25l");
    input.on("keypress", onKey);
    draw();
  });
}

async function runSwitch(args, io) {
  const locale = currentLocale();
  let options;

  try {
    options = parseSwitchArgs(args);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  const state = gitState();
  let config;

  try {
    config = load();
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  const profiles = list(config);

  if (profiles.length === 0) {
    io.stderr.write(`git-persona: ${message(locale, "switch.empty")}\n`);
    io.exit(1);
    return;
  }

  let profile = options.id ? config.profiles[options.id] : null;

  if (!profile) {
    if (options.id) {
      io.stderr.write(`git-persona: persona '${options.id}' does not exist\n`);
      io.exit(1);
      return;
    }

    const currentId =
      options.scope === "repo"
        ? config.active.repositories[state.cwd] ?? config.active.global
        : config.active.global;
    const startIndex = Math.max(
      0,
      profiles.findIndex((item) => item.id === currentId),
    );

    try {
      profile = await chooseProfile(io, profiles, startIndex);
    } catch (error) {
      io.stderr.write(`git-persona: ${error.message}\n`);
      io.exit(1);
      return;
    }

    if (!profile) {
      io.stdout.write(`${message(locale, "switch.cancelled")}\n`);
      return;
    }
  }

  try {
    applyProfile(profile, options.scope);

    if (options.scope === "repo") {
      if (!state.isRepository) {
        throw new Error("--repo requires a Git repository");
      }

      config.active.repositories[state.cwd] = profile.id;
    } else {
      config.active.global = profile.id;
    }

    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`${message(locale, "switch.saved", { scope: options.scope, id: profile.id })}\n`);
  io.stdout.write(`${message(locale, "switch.authPreference")}\n`);
}

export async function run(args, io) {
  const [command, ...commandArgs] = args;

  if (!command || command === "-h" || command === "--help") {
    io.stdout.write(helpText(currentLocale()));
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
    await runMigration(commandArgs, io);
    return;
  }

  if (command === "list") {
    runList(io);
    return;
  }

  if (command === "add" || command === "edit" || command === "remove") {
    runProfileCommand(command, commandArgs, io);
    return;
  }

  if (command === "switch") {
    await runSwitch(commandArgs, io);
    return;
  }

  if (command === "repo") {
    runRepo(commandArgs, io);
    return;
  }

  if (command === "login") {
    await runLogin(commandArgs, io);
    return;
  }

  if (command === "logout") {
    runLogout(commandArgs, io);
    return;
  }

  if (command === "credentials") {
    runCredentials(commandArgs, io);
    return;
  }

  if (command === "run") {
    runGitWithFallback(commandArgs, io);
    return;
  }

  if (command === "check") {
    runCheck(commandArgs, io);
    return;
  }

  if (command === "lang") {
    runLang(commandArgs, io);
    return;
  }

  if (plannedCommands.has(command)) {
    io.stderr.write(`git-persona: ${message(currentLocale(), "error.planned", { command })}\n`);
    io.exit(2);
    return;
  }

  const locale = currentLocale();
  io.stderr.write(`git-persona: ${message(locale, "error.unknownCommand", { command })}\n\n`);
  io.stderr.write(helpText(locale));
  io.exit(2);
}
