import { spawnSync } from "node:child_process";

function readGithubCredential(cwd) {
  const result = spawnSync("git", ["credential-manager", "get"], {
    cwd,
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) return { found: false, username: null };

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
  ].filter((line) => line !== null).join("\n");
}

export function storeGithubCredential(username, token, cwd = process.cwd()) {
  const result = runCredential(["store"], credentialInput(username, token), cwd);
  if (!result.ok) throw new Error(result.stderr || "could not store GitHub credential");
}

export function eraseGithubCredential(username, cwd = process.cwd()) {
  const result = runCredential(["erase"], credentialInput(username), cwd);
  if (!result.ok) throw new Error(result.stderr || "could not remove GitHub credential");
}

export function githubAccounts(cwd = process.cwd()) {
  const result = runCredential(["github", "list"], "", cwd);
  if (!result.ok) throw new Error(result.stderr || "could not list GitHub credentials");

  return new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

export function githubState(cwd = process.cwd()) {
  return readGithubCredential(cwd);
}
