import { spawnSync } from "node:child_process";

const gitConfigKeys = [
  "user.name",
  "user.email",
  "user.signingkey",
  "gpg.format",
  "commit.gpgsign",
  "credential.helper",
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

export function writeConfigValue(key, value, scope, cwd = process.cwd()) {
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

export function applyGitProfile(profile, scope, cwd = process.cwd()) {
  const configScope = scope === "repo" ? "local" : "global";
  const git = profile.git ?? {};

  writeConfigValue("user.name", git.name, configScope, cwd);
  writeConfigValue("user.email", git.email, configScope, cwd);
  writeConfigValue("user.signingkey", git.signingKey, configScope, cwd);
  writeConfigValue("gpg.format", git.gpgFormat, configScope, cwd);
  writeConfigValue("commit.gpgsign", git.commitGpgSign, configScope, cwd);
  writeConfigValue("credential.helper", git.credentialHelper, configScope, cwd);
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

function readConfigScope(scope, cwd) {
  return Object.fromEntries(
    gitConfigKeys.map((key) => [key, readConfigValue(key, scope, cwd)]),
  );
}

export function getCurrentGitState(cwd = process.cwd()) {
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
