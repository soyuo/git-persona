import { runGit } from "./runner.js";
import { githubState } from "./credentials.js";

const configKeys = [
  "user.name",
  "user.email",
  "user.signingkey",
  "gpg.format",
  "commit.gpgsign",
  "credential.helper",
  "credential.https://github.com.username",
];

function scopeArgs(scope) {
  if (scope === "global") return ["--global"];
  if (scope === "local") return ["--local"];
  return [];
}

function readValue(key, scope, cwd) {
  const result = runGit(["config", ...scopeArgs(scope), "--get", key], { cwd });
  return result.ok ? result.stdout || null : null;
}

export function setConfig(key, value, scope, cwd = process.cwd()) {
  const args =
    value === null || value === undefined
      ? ["config", ...scopeArgs(scope), "--unset", key]
      : ["config", ...scopeArgs(scope), key, value];
  const result = runGit(args, { cwd });

  if (!result.ok && !(value === null || value === undefined)) {
    throw new Error(result.stderr || `git config failed for ${key}`);
  }
}

export function applyProfile(profile, scope, cwd = process.cwd()) {
  const configScope = scope === "repo" ? "local" : "global";
  const git = profile.git ?? {};
  const username = profile.auth?.https?.username ?? profile.id;

  setConfig("user.name", git.name, configScope, cwd);
  setConfig("user.email", git.email, configScope, cwd);
  setConfig("user.signingkey", git.signingKey, configScope, cwd);
  setConfig("gpg.format", git.gpgFormat, configScope, cwd);
  setConfig("commit.gpgsign", git.commitGpgSign, configScope, cwd);
  setConfig("credential.helper", git.credentialHelper, configScope, cwd);
  setConfig("credential.https://github.com.username", username, configScope, cwd);
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

function readScope(scope, cwd) {
  return Object.fromEntries(configKeys.map((key) => [key, readValue(key, scope, cwd)]));
}

export function gitState(cwd = process.cwd(), options = {}) {
  const repoResult = runGit(["rev-parse", "--is-inside-work-tree"], { cwd });
  const isRepository = repoResult.ok && repoResult.stdout === "true";

  return {
    cwd,
    isRepository,
    effective: readScope("effective", cwd),
    global: readScope("global", cwd),
    local: isRepository ? readScope("local", cwd) : null,
    githubCredential: options.credentials === false
      ? { found: false, username: null }
      : githubState(cwd),
  };
}
