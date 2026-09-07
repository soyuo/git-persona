import { load } from "../config.js";
import {
  githubAccounts,
  gitState,
  remoteUrls,
  runGitCommand,
  sshAvailable,
} from "../git/index.js";
import { green, red, yellow } from "../style.js";
import { currentLocale, localeOf, message } from "../langs/index.js";

function displayWidth(value) {
  return Array.from(value).reduce((width, char) => {
    return width + (/[ᄀ-ᅟ〈〉⺀-〾぀-꓏가-힣豈-﫿︐-︙︰-﹯ﹰ-﻿]/u.test(char) ? 2 : 1);
  }, 0);
}

function padDisplay(value, width) {
  return `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;
}

function centerDisplay(value, width) {
  const padding = Math.max(0, width - displayWidth(value));
  const left = Math.floor(padding / 2);
  return `${" ".repeat(left)}${value}${" ".repeat(padding - left)}`;
}

export function runCheck(args, io) {
  if (args.length > 0) {
    io.stderr.write(`git-persona: ${message(currentLocale(), "check.invalidArgs")}\n`);
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
  const locale = localeOf(config, state.cwd);
  const repoId = state.isRepository ? config.active.repositories[state.cwd] ?? null : null;
  const activeId = repoId ?? config.active.global;
  const profile = activeId ? config.profiles[activeId] : null;
  let failures = 0;
  let warnings = 0;
  const labels = [
    "check.git",
    "check.gcm",
    "check.active",
    "check.config",
    "check.credential",
    "check.ssh",
    "check.signingKey",
    "check.remotes",
  ].map((key) => message(locale, key));
  const labelWidth = Math.max(
    ...labels.map(displayWidth),
    displayWidth("Remote origin"),
  );
  const statusWidth = Math.max(
    ...["status.ok", "status.warn", "status.fail"].map((key) =>
      displayWidth(message(locale, key)),
    ),
  );

  const report = (status, label, detail) => {
    const key = status.trim().toLowerCase() === "fail" ? "status.fail" : status.trim().toLowerCase() === "warn" ? "status.warn" : "status.ok";
    const statusLabel = message(locale, key);
    const rawTag = `[${centerDisplay(statusLabel, statusWidth)}]`;
    const tag = status === "FAIL"
      ? red(rawTag, io.stdout)
      : status === "WARN"
        ? yellow(rawTag, io.stdout)
        : green(rawTag, io.stdout);
    io.stdout.write(`${tag} ${padDisplay(label, labelWidth)}: ${detail}\n`);

    if (status === "WARN") warnings += 1;
    if (status === "FAIL") failures += 1;
  };

  const git = runGitCommand(["--version"]);
  report(git.ok ? " OK " : "FAIL", message(locale, "check.git"), git.ok ? git.stdout : message(locale, "check.notAvailable"));

  const gcm = runGitCommand(["credential-manager", "--version"]);
  report(gcm.ok ? " OK " : "WARN", message(locale, "check.gcm"), gcm.ok ? gcm.stdout : message(locale, "check.notAvailable"));

  if (!activeId) {
    report("WARN", message(locale, "check.active"), message(locale, "check.none"));
  } else if (!profile) {
    report("FAIL", message(locale, "check.active"), message(locale, "check.missingProfile", { id: activeId }));
  } else {
    report(" OK ", message(locale, "check.active"), repoId ? `${activeId} (repo)` : `${activeId} (global)`);

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
      message(locale, "check.config"),
      mismatches.length === 0 ? message(locale, "check.matches") : `${message(locale, "check.mismatch")}: ${mismatches.join(", ")}`,
    );

    try {
      const accounts = githubAccounts();
      const username = profile.auth?.https?.username ?? profile.id;
      report(accounts.has(username) ? " OK " : "WARN", message(locale, "check.credential"), accounts.has(username) ? message(locale, "check.stored") : message(locale, "check.notFound"));
    } catch (error) {
      report("WARN", message(locale, "check.credential"), error.message);
    }
  }

  const ssh = sshAvailable();
  report(ssh ? " OK " : "WARN", message(locale, "check.ssh"), ssh ? message(locale, "check.available") : message(locale, "check.notAvailable"));

  const signingKey = profile?.auth?.ssh?.signingKey ?? state.effective["user.signingkey"];
  report(signingKey ? " OK " : "WARN", message(locale, "check.signingKey"), signingKey ? message(locale, "check.configured") : message(locale, "check.notConfigured"));

  if (!state.isRepository) {
    report(" OK ", message(locale, "check.remotes"), message(locale, "check.outsideRepo"));
  } else {
    const remotes = remoteUrls(state.cwd);

    if (remotes.length === 0) {
      report("WARN", message(locale, "check.remotes"), message(locale, "check.noRemotes"));
    } else {
      for (const remote of remotes) {
        const supported = /github\.com[/:]/i.test(remote.url);
        report(supported ? " OK " : "WARN", `Remote ${remote.name}`, supported ? remote.url : message(locale, "check.notGithub"));
      }
    }
  }

  if (failures > 0 || warnings > 0) {
    const summary = [];
    if (failures > 0) summary.push(`${failures} ${message(locale, "check.issues")}`);
    if (warnings > 0) summary.push(`${warnings} ${message(locale, "check.warnings")}`);
    io.stderr.write(`git-persona: ${message(locale, "check.summary", { summary: summary.join(` ${message(locale, "check.and")} `) })}\n`);
  }

  if (failures > 0) io.exit(1);
}
