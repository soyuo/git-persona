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

function readConfigValue(key, scope, cwd) {
  const args = ["config"];

  if (scope === "global") {
    args.push("--global");
  }

  if (scope === "local") {
    args.push("--local");
  }

  args.push("--get", key);

  const result = runGit(args, { cwd });

  if (!result.ok) {
    return null;
  }

  return result.stdout || null;
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
    global: readConfigScope("global", cwd),
    local: isRepository ? readConfigScope("local", cwd) : null,
  };
}

