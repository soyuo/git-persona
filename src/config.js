import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const VERSION = 1;

export function emptyConfig() {
  return {
    version: VERSION,
    active: {
      global: null,
      repositories: {},
    },
    profiles: {},
  };
}

export function configPath(env = process.env) {
  return env.GIT_PERSONA_CONFIG ?? join(homedir(), ".git-persona", "config.json");
}

function normalize(config) {
  return {
    ...emptyConfig(),
    ...config,
    active: {
      ...emptyConfig().active,
      ...config.active,
    },
    profiles: config.profiles ?? {},
  };
}

export function load(path = configPath()) {
  if (!existsSync(path)) {
    return emptyConfig();
  }

  try {
    const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");

    return normalize(JSON.parse(content));
  } catch (error) {
    throw new Error(`Could not read git-persona config at ${path}: ${error.message}`);
  }
}

export function save(config, path = configPath()) {
  const normalized = normalize(config);
  const directory = dirname(path);
  const temporaryPath = `${path}.tmp`;

  mkdirSync(directory, { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

export function profiles(config) {
  return Object.values(config.profiles).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}
