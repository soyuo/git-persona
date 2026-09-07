import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const configVersion = 1;

export function createEmptyConfig() {
  return {
    version: configVersion,
    active: {
      global: null,
      repositories: {},
    },
    profiles: {},
  };
}

export function getConfigPath(env = process.env) {
  return env.GIT_PERSONA_CONFIG ?? join(homedir(), ".git-persona", "config.json");
}

function normalizeConfig(config) {
  return {
    ...createEmptyConfig(),
    ...config,
    active: {
      ...createEmptyConfig().active,
      ...config.active,
    },
    profiles: config.profiles ?? {},
  };
}

export function loadConfig(path = getConfigPath()) {
  if (!existsSync(path)) {
    return createEmptyConfig();
  }

  try {
    const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");

    return normalizeConfig(JSON.parse(content));
  } catch (error) {
    throw new Error(`Could not read git-persona config at ${path}: ${error.message}`);
  }
}

export function saveConfig(config, path = getConfigPath()) {
  const normalized = normalizeConfig(config);
  const directory = dirname(path);
  const temporaryPath = `${path}.tmp`;

  mkdirSync(directory, { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

export function listProfiles(config) {
  return Object.values(config.profiles).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}
