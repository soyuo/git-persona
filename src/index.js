import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { configPath, load, profiles as list, save } from "./config.js";
import {
  applyProfile,
  clearProfile,
  eraseGithubCredential,
  githubAccounts,
  gitState,
  remoteUrls,
  rewriteGithubRemotes,
  runGitCommand,
  sshAvailable,
  storeGithubCredential,
} from "./git.js";

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
  run <git-command> Run a Git command with SSH fallback
  doctor           Check Git, credentials, SSH, and persona state

Options:
  -h, --help       Show this help
  -v, --version    Show the version
`;

const plannedCommands = new Set([
  "login",
  "logout",
  "credentials",
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
  io.stdout.write(
    `  github credential user: ${formatValue(values["credential.https://github.com.username"])}\n`,
  );
}

function runCurrent(io) {
  const state = gitState();
  const config = load();
  const repoId = state.isRepository ? config.active.repositories[state.cwd] ?? null : null;
  const activeId = repoId ?? config.active.global;

  io.stdout.write("Current Git state\n");
  io.stdout.write(`Repository: ${state.isRepository ? "yes" : "no"}\n\n`);
  io.stdout.write(`Active persona: ${formatValue(activeId)}\n`);

  if (repoId) {
    io.stdout.write(`Repo binding: ${repoId}\n`);
  }

  io.stdout.write("\n");

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
  io.stdout.write("Apply this migration? [y/N] ");

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

  const confirmed = await confirmMigration(io);

  if (!confirmed) {
    io.stdout.write("Migration cancelled.\n");
    return;
  }

  try {
    applyMigration(profileName, profile, options, state);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`Saved persona '${profileName}'.\n`);
  io.stdout.write(`Config: ${configPath()}\n`);
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

  io.stdout.write("Git personas\n");
  io.stdout.write(`Config: ${configPath()}\n\n`);

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

const profileFields = new Map([
  ["--name", "name"],
  ["--email", "email"],
  ["--signing-key", "signingKey"],
  ["--gpg-format", "gpgFormat"],
  ["--commit-gpg-sign", "commitGpgSign"],
  ["--credential-helper", "credentialHelper"],
]);

function parseProfileArgs(args, action) {
  const [id, ...rest] = args;

  if (!id || id.startsWith("--")) {
    throw new Error(`${action} requires a persona id`);
  }

  const fields = {};

  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    const field = profileFields.get(option);

    if (!field) {
      throw new Error(`unknown ${action} option '${option}'`);
    }

    const value = rest[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value`);
    }

    fields[field] = value;
    index += 1;
  }

  if (action === "edit" && Object.keys(fields).length === 0) {
    throw new Error("edit requires at least one profile option");
  }

  return { id, fields };
}

function profileFromFields(id, fields) {
  return {
    id,
    git: {
      name: fields.name ?? null,
      email: fields.email ?? null,
      signingKey: fields.signingKey ?? null,
      gpgFormat: fields.gpgFormat ?? null,
      commitGpgSign: fields.commitGpgSign ?? null,
      credentialHelper: fields.credentialHelper ?? null,
    },
    auth: {
      preferred: "https",
      https: {
        host: "github.com",
        username: id,
        credentialTarget: "git:https://github.com",
        tokenStored: false,
      },
      ssh: {
        fallback: true,
        signingKey: fields.signingKey ?? null,
      },
    },
  };
}

function updateProfile(profile, fields) {
  const next = profileFromFields(profile.id, profile.git ?? {});

  next.git = { ...profile.git, ...fields };
  next.auth = {
    ...profile.auth,
    https: {
      ...profile.auth?.https,
      host: profile.auth?.https?.host ?? "github.com",
      username: profile.auth?.https?.username ?? profile.id,
      credentialTarget:
        profile.auth?.https?.credentialTarget ?? "git:https://github.com",
      tokenStored: profile.auth?.https?.tokenStored ?? false,
    },
    ssh: {
      ...profile.auth?.ssh,
      fallback: profile.auth?.ssh?.fallback ?? true,
      signingKey: fields.signingKey ?? profile.auth?.ssh?.signingKey ?? null,
    },
  };

  return next;
}

function runProfileCommand(action, args, io) {
  let options;

  try {
    options =
      action === "remove"
        ? { id: args[0], fields: {} }
        : parseProfileArgs(args, action);

    if (!options.id || options.id.startsWith("--")) {
      throw new Error(`${action} requires a persona id`);
    }

    if (action === "remove" && args.length > 1) {
      throw new Error("remove takes only a persona id");
    }
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
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

  const current = config.profiles[options.id];

  if (action === "add") {
    if (current) {
      io.stderr.write(`git-persona: persona '${options.id}' already exists\n`);
      io.exit(1);
      return;
    }

    config.profiles[options.id] = profileFromFields(options.id, options.fields);
  }

  if (action === "edit") {
    if (!current) {
      io.stderr.write(`git-persona: persona '${options.id}' does not exist\n`);
      io.exit(1);
      return;
    }

    config.profiles[options.id] = updateProfile(current, options.fields);
  }

  if (action === "remove") {
    const bound = Object.values(config.active.repositories).includes(options.id);
    const active = config.active.global === options.id || bound;

    if (!current) {
      io.stderr.write(`git-persona: persona '${options.id}' does not exist\n`);
      io.exit(1);
      return;
    }

    if (active) {
      io.stderr.write(
        `git-persona: persona '${options.id}' is active; switch to another persona before removing it\n`,
      );
      io.exit(1);
      return;
    }

    delete config.profiles[options.id];
  }

  try {
    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(
    action === "remove"
      ? `Removed persona '${options.id}'.\n`
      : `${action === "add" ? "Added" : "Updated"} persona '${options.id}'.\n`,
  );
}

function parseId(args, action) {
  if (args.length !== 1 || !args[0] || args[0].startsWith("--")) {
    throw new Error(`${action} requires one persona id`);
  }

  return args[0];
}

async function readSecret(io) {
  if (!io.stdin?.isTTY || !io.stdout?.isTTY || typeof io.stdin.setRawMode !== "function") {
    throw new Error("login requires an interactive terminal for hidden token input");
  }

  const input = io.stdin;
  const output = io.stdout;

  return await new Promise((resolve, reject) => {
    let token = "";

    const finish = (error, value) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === "\u0003") {
          finish(new Error("login cancelled"));
          return;
        }

        if (char === "\r" || char === "\n") {
          finish(null, token);
          return;
        }

        if (char === "\u0008" || char === "\u007f") {
          token = token.slice(0, -1);
          continue;
        }

        token += char;
      }
    };

    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
}

function profileUsername(profile) {
  return profile.auth?.https?.username ?? profile.id;
}

async function runLogin(args, io) {
  let id;

  try {
    id = parseId(args, "login");
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  const config = load();
  const profile = config.profiles[id];

  if (!profile) {
    io.stderr.write(`git-persona: persona '${id}' does not exist\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`Token for '${id}' (input hidden): `);

  let token;

  try {
    token = await readSecret(io);

    if (!token) {
      throw new Error("token cannot be empty");
    }

    storeGithubCredential(profileUsername(profile), token);
    profile.auth = {
      ...profile.auth,
      https: {
        ...profile.auth?.https,
        username: profileUsername(profile),
        tokenStored: true,
      },
    };
    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  } finally {
    token = null;
  }

  io.stdout.write(`Stored GitHub credential for '${id}'.\n`);
}

function runLogout(args, io) {
  let id;

  try {
    id = parseId(args, "logout");
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  const config = load();
  const profile = config.profiles[id];

  if (!profile) {
    io.stderr.write(`git-persona: persona '${id}' does not exist\n`);
    io.exit(1);
    return;
  }

  try {
    eraseGithubCredential(profileUsername(profile));
    profile.auth = {
      ...profile.auth,
      https: {
        ...profile.auth?.https,
        username: profileUsername(profile),
        tokenStored: false,
      },
    };
    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`Removed GitHub credential for '${id}'.\n`);
}

function runCredentials(args, io) {
  if (args.length > 0) {
    io.stderr.write("git-persona: credentials takes no arguments\n");
    io.exit(2);
    return;
  }

  const config = load();
  const saved = list(config);
  let accounts;

  try {
    accounts = githubAccounts();
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write("GitHub credentials\n");

  if (saved.length === 0) {
    io.stdout.write("No personas saved yet.\n");
    return;
  }

  for (const profile of saved) {
    const username = profileUsername(profile);
    const found = accounts.has(username);

    io.stdout.write(`  ${profile.id}: ${found ? "stored" : "not found"}\n`);
  }
}

function runDoctor(args, io) {
  if (args.length > 0) {
    io.stderr.write("git-persona: doctor takes no arguments\n");
    io.exit(2);
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

  const state = gitState();
  const repoId = state.isRepository
    ? config.active.repositories[state.cwd] ?? null
    : null;
  const activeId = repoId ?? config.active.global;
  const profile = activeId ? config.profiles[activeId] : null;
  let issues = 0;

  const report = (status, label, detail) => {
    io.stdout.write(`[${status}] ${label}: ${detail}\n`);

    if (status === "WARN" || status === "FAIL") {
      issues += 1;
    }
  };

  const git = runGitCommand(["--version"]);
  report(git.ok ? " OK " : "FAIL", "Git", git.ok ? git.stdout : "not available");

  const gcm = runGitCommand(["credential-manager", "--version"]);
  report(
    gcm.ok ? " OK " : "WARN",
    "GCM",
    gcm.ok ? gcm.stdout : "not available",
  );

  if (!activeId) {
    report("WARN", "Active persona", "none selected");
  } else if (!profile) {
    report("FAIL", "Active persona", `'${activeId}' is missing from profiles`);
  } else {
    report(
      " OK ",
      "Active persona",
      repoId ? `${activeId} (repo)` : `${activeId} (global)`,
    );

    const expected = {
      "user.name": profile.git?.name,
      "user.email": profile.git?.email,
      "user.signingkey": profile.git?.signingKey,
      "gpg.format": profile.git?.gpgFormat,
      "commit.gpgsign": profile.git?.commitGpgSign,
      "credential.helper": profile.git?.credentialHelper,
      "credential.https://github.com.username": profile.auth?.https?.username ?? profile.id,
    };
    const mismatches = Object.entries(expected)
      .filter(([key, value]) => value !== null && value !== undefined)
      .filter(([key, value]) => state.effective[key] !== value)
      .map(([key]) => key);

    report(
      mismatches.length === 0 ? " OK " : "WARN",
      "Git config",
      mismatches.length === 0 ? "matches active persona" : `mismatch: ${mismatches.join(", ")}`,
    );

    try {
      const accounts = githubAccounts();
      const username = profile.auth?.https?.username ?? profile.id;

      report(
        accounts.has(username) ? " OK " : "WARN",
        "GitHub credential",
        accounts.has(username) ? "stored" : "not found",
      );
    } catch (error) {
      report("WARN", "GitHub credential", error.message);
    }
  }

  report(
    sshAvailable() ? " OK " : "WARN",
    "SSH",
    sshAvailable() ? "available" : "not available",
  );

  const signingKey = profile?.auth?.ssh?.signingKey ?? state.effective["user.signingkey"];
  report(
    signingKey ? " OK " : "WARN",
    "Signing key",
    signingKey ? "configured" : "not configured",
  );

  if (!state.isRepository) {
    report(" OK ", "Remotes", "not checked outside a repository");
  } else {
    const remotes = remoteUrls(state.cwd);

    if (remotes.length === 0) {
      report("WARN", "Remotes", "none configured");
    } else {
      for (const remote of remotes) {
        const supported = /github\.com[/:]/i.test(remote.url);

        report(
          supported ? " OK " : "WARN",
          `Remote ${remote.name}`,
          supported ? remote.url : "not a GitHub remote",
        );
      }
    }
  }

  if (issues > 0) {
    io.stderr.write(`git-persona: doctor found ${issues} issue(s)\n`);
    io.exit(1);
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
  if (args.length === 0) {
    io.stderr.write("git-persona: run requires a Git command\n");
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
    io.stderr.write(`git-persona: SSH fallback could not update remotes: ${error.message}\n`);
    io.exit(first.status ?? 1);
    return;
  }

  if (changed.length === 0) {
    writeGitResult(io, first);
    io.stderr.write("git-persona: no GitHub HTTPS remote was available for SSH fallback\n");
    io.exit(first.status ?? 1);
    return;
  }

  io.stderr.write("git-persona: HTTPS authentication failed; switched GitHub remotes to SSH and retrying\n");

  const retry = runGitCommand(args);
  writeGitResult(io, retry);

  if (retry.ok) {
    return;
  }

  const config = load();
  const id = activeId(config, gitState());
  const login = id ? `git persona login ${id}` : "git persona login <id>";

  io.stderr.write(`git-persona: SSH authentication failed; run '${login}'\n`);
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
  let options;

  try {
    options = parseRepoArgs(args);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  if (!options.action) {
    io.stderr.write("git-persona: use `repo bind <id>` or `repo unbind`\n");
    io.exit(2);
    return;
  }

  const state = gitState();

  if (!state.isRepository) {
    io.stderr.write("git-persona: repo commands require a Git repository\n");
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
      io.stderr.write(`git-persona: persona '${options.id}' does not exist\n`);
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

    io.stdout.write(`Bound this repo to '${profile.id}'.\n`);
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

  io.stdout.write("Removed repo binding.\n");
}

function renderPicker(io, profiles, index) {
  io.stdout.write("\x1b[2J\x1b[H");
  io.stdout.write("Select persona\n\n");

  for (let i = 0; i < profiles.length; i += 1) {
    const profile = profiles[i];
    const email = profile.git?.email ? ` <${profile.git.email}>` : "";
    const cred = profile.auth?.https?.username ? ` [https:${profile.auth.https.username}]` : "";

    io.stdout.write(`${formatSelected(i === index)} ${profile.id}${email}${cred}\n`);
  }

  io.stdout.write("\nUse \u2191/\u2193, j/k, Enter, Esc\n");
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
    io.stderr.write("git-persona: no personas saved yet\n");
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
      io.stdout.write("Selection cancelled.\n");
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

  io.stdout.write(`Switched ${options.scope} persona to '${profile.id}'.\n`);
  io.stdout.write("Auth preference: HTTPS token, then SSH fallback.\n");
}

export async function run(args, io) {
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

  if (command === "doctor") {
    runDoctor(commandArgs, io);
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
