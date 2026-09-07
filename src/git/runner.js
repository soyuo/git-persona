import { spawnSync } from "node:child_process";

export function runGit(args, options = {}) {
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
