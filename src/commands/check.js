import { load } from "../config.js";
import {
  githubAccounts,
  gitState,
  remoteUrls,
  runGitCommand,
  sshAvailable,
} from "../git/index.js";
import { green, red, yellow } from "../style.js";

export function runCheck(args, io) {
  if (args.length > 0) {
    io.stderr.write("git-persona: check takes no arguments\n");
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
  const repoId = state.isRepository ? config.active.repositories[state.cwd] ?? null : null;
  const activeId = repoId ?? config.active.global;
  const profile = activeId ? config.profiles[activeId] : null;
  let failures = 0;
  let warnings = 0;

  const report = (status, label, detail) => {
    const tag = status === "FAIL"
      ? red(`[${status}]`, io.stdout)
      : status === "WARN"
        ? yellow(`[${status}]`, io.stdout)
        : green(`[${status}]`, io.stdout);
    io.stdout.write(`${tag} ${label}: ${detail}\n`);

    if (status === "WARN") warnings += 1;
    if (status === "FAIL") failures += 1;
  };

  const git = runGitCommand(["--version"]);
  report(git.ok ? " OK " : "FAIL", "Git", git.ok ? git.stdout : "not available");

  const gcm = runGitCommand(["credential-manager", "--version"]);
  report(gcm.ok ? " OK " : "WARN", "GCM", gcm.ok ? gcm.stdout : "not available");

  if (!activeId) {
    report("WARN", "Active persona", "none selected");
  } else if (!profile) {
    report("FAIL", "Active persona", `'${activeId}' is missing from profiles`);
  } else {
    report(" OK ", "Active persona", repoId ? `${activeId} (repo)` : `${activeId} (global)`);

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
      report(accounts.has(username) ? " OK " : "WARN", "GitHub credential", accounts.has(username) ? "stored" : "not found");
    } catch (error) {
      report("WARN", "GitHub credential", error.message);
    }
  }

  const ssh = sshAvailable();
  report(ssh ? " OK " : "WARN", "SSH", ssh ? "available" : "not available");

  const signingKey = profile?.auth?.ssh?.signingKey ?? state.effective["user.signingkey"];
  report(signingKey ? " OK " : "WARN", "Signing key", signingKey ? "configured" : "not configured");

  if (!state.isRepository) {
    report(" OK ", "Remotes", "not checked outside a repository");
  } else {
    const remotes = remoteUrls(state.cwd);

    if (remotes.length === 0) {
      report("WARN", "Remotes", "none configured");
    } else {
      for (const remote of remotes) {
        const supported = /github\.com[/:]/i.test(remote.url);
        report(supported ? " OK " : "WARN", `Remote ${remote.name}`, supported ? remote.url : "not a GitHub remote");
      }
    }
  }

  if (failures > 0 || warnings > 0) {
    const summary = [];
    if (failures > 0) summary.push(`${failures} issue(s)`);
    if (warnings > 0) summary.push(`${warnings} warning(s)`);
    io.stderr.write(`git-persona: check found ${summary.join(" and ")}\n`);
  }

  if (failures > 0) io.exit(1);
}
