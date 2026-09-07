import { spawnSync } from "node:child_process";

const gitConfigKeys = [
  "user.name",
  "user.email",
  "user.signingkey",
  "gpg.format",
  "commit.gpgsign",
  "credential.helper",
  "credential.https://github.com.username",
];

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    ok: result.status === 0,
  };
}

function configScopeArgs(scope) {
  if (scope === "global") {
    return ["--global"];
  }

  if (scope === "local") {
    return ["--local"];
  }

  return [];
}

function readConfigValue(key, scope, cwd) {
  const args = ["config", ...configScopeArgs(scope), "--get", key];

  const result = runGit(args, { cwd });

  if (!result.ok) {
    return null;
  }

  return result.stdout || null;
}

export function setConfig(key, value, scope, cwd = process.cwd()) {
  const scopeArgs = configScopeArgs(scope);
  const args =
    value === null || value === undefined
      ? ["config", ...scopeArgs, "--unset", key]
      : ["config", ...scopeArgs, key, value];

  const result = runGit(args, { cwd });

  if (!result.ok && !(value === null || value === undefined)) {
    throw new Error(result.stderr || `git config failed for ${key}`);
  }
}

export function applyProfile(profile, scope, cwd = process.cwd()) {
  const configScope = scope === "repo" ? "local" : "global";
  const git = profile.git ?? {};
  const https = profile.auth?.https ?? {};
  const username = https.username ?? profile.id;

  setConfig("user.name", git.name, configScope, cwd);
  setConfig("user.email", git.email, configScope, cwd);
  setConfig("user.signingkey", git.signingKey, configScope, cwd);
  setConfig("gpg.format", git.gpgFormat, configScope, cwd);
  setConfig("commit.gpgsign", git.commitGpgSign, configScope, cwd);
  setConfig("credential.helper", git.credentialHelper, configScope, cwd);
  setConfig(
    "credential.https://github.com.username",
    username,
    configScope,
    cwd,
  );
}

export function runGitCommand(args, cwd = process.cwd()) {
  return runGit(args, { cwd });
}

export function sshAvailable() {
  const result = spawnSync("ssh", ["-V"], {
    encoding: "utf8",
    windowsHide: true,
  });

  return result.status === 0;
}

export function remoteUrls(cwd = process.cwd()) {
  const remotes = runGit(["remote"], { cwd });

  if (!remotes.ok) {
    return [];
  }

  return remotes.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((name) => {
      const result = runGit(["remote", "get-url", name], { cwd });

      return result.ok ? { name, url: result.stdout } : null;
    })
    .filter(Boolean);
}

function sshUrl(url) {
  const match = url.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/(.+)$/i);

  return match ? `git@github.com:${match[1]}` : null;
}

export function rewriteGithubRemotes(cwd = process.cwd()) {
  const remotes = runGit(["remote"], { cwd });

  if (!remotes.ok) {
    throw new Error(remotes.stderr || "could not list Git remotes");
  }

  const changed = [];

  for (const name of remotes.stdout.split(/\r?\n/).filter(Boolean)) {
    const current = runGit(["remote", "get-url", name], { cwd });

    if (!current.ok) {
      continue;
    }

    const next = sshUrl(current.stdout);

    if (!next) {
      continue;
    }

    const result = runGit(["remote", "set-url", name, next], { cwd });

    if (!result.ok) {
      throw new Error(result.stderr || `could not update remote '${name}'`);
    }

    changed.push({ name, from: current.stdout, to: next });
  }

  return changed;
}

export function clearProfile(scope, cwd = process.cwd()) {
  const configScope = scope === "repo" ? "local" : "global";

  setConfig("user.name", null, configScope, cwd);
  setConfig("user.email", null, configScope, cwd);
  setConfig("user.signingkey", null, configScope, cwd);
  setConfig("gpg.format", null, configScope, cwd);
  setConfig("commit.gpgsign", null, configScope, cwd);
  setConfig("credential.helper", null, configScope, cwd);
  setConfig("credential.https://github.com.username", null, configScope, cwd);
}

function readGithubCredential(cwd) {
  const result = spawnSync("git", ["credential-manager", "get"], {
    cwd,
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    return {
      found: false,
      username: null,
    };
  }

  const lines = result.stdout.trim().split(/\r?\n/);
  const usernameLine = lines.find((line) => line.startsWith("username="));

  return {
    found: lines.some((line) => line.startsWith("password=")),
    username: usernameLine ? usernameLine.slice("username=".length) : null,
  };
}

function runCredential(args, input, cwd) {
  const result = spawnSync("git", ["credential-manager", ...args], {
    cwd,
    input,
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    ok: result.status === 0,
  };
}

function credentialInput(username, password = null) {
  return [
    "protocol=https",
    "host=github.com",
    `username=${username}`,
    password === null ? null : `password=${password}`,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function storeGithubCredential(username, token, cwd = process.cwd()) {
  const result = runCredential(
    ["store"],
    credentialInput(username, token),
    cwd,
  );

  if (!result.ok) {
    throw new Error(result.stderr || "could not store GitHub credential");
  }
}

export function eraseGithubCredential(username, cwd = process.cwd()) {
  const result = runCredential(
    ["erase"],
    credentialInput(username),
    cwd,
  );

  if (!result.ok) {
    throw new Error(result.stderr || "could not remove GitHub credential");
  }
}

export function githubAccounts(cwd = process.cwd()) {
  const result = runCredential(["github", "list"], "", cwd);

  if (!result.ok) {
    throw new Error(result.stderr || "could not list GitHub credentials");
  }

  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function readConfigScope(scope, cwd) {
  return Object.fromEntries(
    gitConfigKeys.map((key) => [key, readConfigValue(key, scope, cwd)]),
  );
}

export function gitState(cwd = process.cwd()) {
  const repoResult = runGit(["rev-parse", "--is-inside-work-tree"], { cwd });
  const isRepository = repoResult.ok && repoResult.stdout === "true";

  return {
    cwd,
    isRepository,
    effective: readConfigScope("effective", cwd),
    global: readConfigScope("global", cwd),
    local: isRepository ? readConfigScope("local", cwd) : null,
    githubCredential: readGithubCredential(cwd),
  };
}
