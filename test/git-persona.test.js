import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runGitCommand } from "../src/git.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const bin = join(root, "bin", "git-persona.js");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "git-persona-test-"));
}

function env(configPath, globalPath) {
  return {
    ...process.env,
    GIT_PERSONA_CONFIG: configPath,
    GIT_CONFIG_GLOBAL: globalPath,
    GIT_CONFIG_NOSYSTEM: "true",
  };
}

function cli(args, cwd, environment) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
  });
}

function git(args, cwd, environment) {
  return execFileSync("git", args, {
    cwd,
    env: environment,
    encoding: "utf8",
  }).trim();
}

function setup() {
  const dir = tempDir();
  const repo = join(dir, "repo");
  const config = join(dir, "config.json");
  const global = join(dir, "global.gitconfig");

  execFileSync("git", ["init", "--quiet", repo]);

  return {
    dir,
    repo,
    config,
    global,
    env: env(config, global),
  };
}

test("Git wrapper reads repository state", () => {
  const state = setup();

  try {
    const result = runGitCommand(["rev-parse", "--is-inside-work-tree"], state.repo);

    assert.equal(result.ok, true);
    assert.equal(result.stdout, "true");
  } finally {
    rmSync(state.dir, { recursive: true, force: true });
  }
});

test("migration dry-run does not create a config file", () => {
  const state = setup();

  try {
    git(["config", "user.name", "Test User"], state.repo, state.env);
    git(["config", "user.email", "test@example.com"], state.repo, state.env);

    const result = cli(["migration", "--dry-run"], state.repo, state.env);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Migration preview/);
    assert.equal(existsSync(state.config), false);
  } finally {
    rmSync(state.dir, { recursive: true, force: true });
  }
});

test("switch repo changes local config without changing global config", () => {
  const state = setup();

  try {
    assert.equal(
      cli(["add", "work", "--email", "work@example.com"], state.repo, state.env).status,
      0,
    );
    assert.equal(cli(["switch", "work", "--repo"], state.repo, state.env).status, 0);

    assert.equal(git(["config", "--local", "user.email"], state.repo, state.env), "work@example.com");
    assert.equal(
      spawnSync("git", ["config", "--global", "user.email"], {
        cwd: state.repo,
        env: state.env,
        encoding: "utf8",
      }).status,
      1,
    );
  } finally {
    rmSync(state.dir, { recursive: true, force: true });
  }
});

test("switch global writes only the isolated global config", () => {
  const state = setup();

  try {
    assert.equal(
      cli(["add", "work", "--email", "work@example.com"], state.repo, state.env).status,
      0,
    );
    assert.equal(cli(["switch", "work"], state.repo, state.env).status, 0);

    assert.equal(git(["config", "--global", "user.email"], state.repo, state.env), "work@example.com");
    assert.equal(git(["config", "--global", "credential.https://github.com.username"], state.repo, state.env), "work");
  } finally {
    rmSync(state.dir, { recursive: true, force: true });
  }
});

test("list masks token-like values", () => {
  const state = setup();

  try {
    writeFileSync(
      state.config,
      JSON.stringify({
        version: 1,
        active: { global: "work", repositories: {} },
        profiles: {
          work: {
            id: "work",
            git: { email: "work@example.com" },
            auth: {
              https: {
                username: "work",
                token: "secret-token-value",
                tokenStored: true,
              },
            },
          },
        },
      }),
    );

    const result = cli(["list"], state.repo, state.env);

    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /secret-token-value/);
    assert.match(result.stdout, /work@example.com/);
  } finally {
    rmSync(state.dir, { recursive: true, force: true });
  }
});
