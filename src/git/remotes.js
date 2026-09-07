import { runGit } from "./runner.js";

export function remoteUrls(cwd = process.cwd()) {
  const remotes = runGit(["remote"], { cwd });
  if (!remotes.ok) return [];

  return remotes.stdout.split(/\r?\n/).filter(Boolean).map((name) => {
    const result = runGit(["remote", "get-url", name], { cwd });
    return result.ok ? { name, url: result.stdout } : null;
  }).filter(Boolean);
}

function sshUrl(url) {
  const match = url.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/(.+)$/i);
  return match ? `git@github.com:${match[1]}` : null;
}

export function rewriteGithubRemotes(cwd = process.cwd()) {
  const remotes = runGit(["remote"], { cwd });
  if (!remotes.ok) throw new Error(remotes.stderr || "could not list Git remotes");

  const changed = [];

  for (const name of remotes.stdout.split(/\r?\n/).filter(Boolean)) {
    const current = runGit(["remote", "get-url", name], { cwd });
    if (!current.ok) continue;

    const next = sshUrl(current.stdout);
    if (!next) continue;

    const result = runGit(["remote", "set-url", name, next], { cwd });
    if (!result.ok) throw new Error(result.stderr || `could not update remote '${name}'`);

    changed.push({ name, from: current.stdout, to: next });
  }

  return changed;
}
