import { load, save } from "../config.js";
import { currentLocale, message } from "../langs/index.js";

const fields = new Map([
  ["--name", "name"],
  ["--email", "email"],
  ["--signing-key", "signingKey"],
  ["--gpg-format", "gpgFormat"],
  ["--commit-gpg-sign", "commitGpgSign"],
  ["--credential-helper", "credentialHelper"],
]);

function parseArgs(args, action) {
  const [id, ...rest] = args;

  if (!id || id.startsWith("--")) {
    throw new Error(`${action} requires a persona id`);
  }

  const values = {};

  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    const field = fields.get(option);

    if (!field) {
      throw new Error(`unknown ${action} option '${option}'`);
    }

    const value = rest[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value`);
    }

    values[field] = value;
    index += 1;
  }

  if (action === "edit" && Object.keys(values).length === 0) {
    throw new Error("edit requires at least one profile option");
  }

  return { id, values };
}

function createProfile(id, values) {
  return {
    id,
    git: {
      name: values.name ?? null,
      email: values.email ?? null,
      signingKey: values.signingKey ?? null,
      gpgFormat: values.gpgFormat ?? null,
      commitGpgSign: values.commitGpgSign ?? null,
      credentialHelper: values.credentialHelper ?? null,
    },
    auth: {
      preferred: "https",
      https: {
        host: "github.com",
        username: id,
        credentialTarget: "git:https://github.com",
        tokenStored: false,
      },
      ssh: {
        fallback: true,
        signingKey: values.signingKey ?? null,
      },
    },
  };
}

function updateProfile(profile, values) {
  const next = createProfile(profile.id, profile.git ?? {});

  next.git = { ...profile.git, ...values };
  next.auth = {
    ...profile.auth,
    https: {
      ...profile.auth?.https,
      host: profile.auth?.https?.host ?? "github.com",
      username: profile.auth?.https?.username ?? profile.id,
      credentialTarget:
        profile.auth?.https?.credentialTarget ?? "git:https://github.com",
      tokenStored: profile.auth?.https?.tokenStored ?? false,
    },
    ssh: {
      ...profile.auth?.ssh,
      fallback: profile.auth?.ssh?.fallback ?? true,
      signingKey: values.signingKey ?? profile.auth?.ssh?.signingKey ?? null,
    },
  };

  return next;
}

export function runProfileCommand(action, args, io) {
  const locale = currentLocale();
  let options;

  try {
    options =
      action === "remove"
        ? { id: args[0], values: {} }
        : parseArgs(args, action);

    if (!options.id || options.id.startsWith("--")) {
      throw new Error(`${action} requires a persona id`);
    }

    if (action === "remove" && args.length > 1) {
      throw new Error("remove takes only a persona id");
    }
  } catch (error) {
    io.stderr.write(`git-persona: ${message(locale, "error.prefix", { error: error.message })}\n`);
    io.exit(2);
    return;
  }

  let config;

  try {
    config = load();
  } catch (error) {
    io.stderr.write(`git-persona: ${message(locale, "error.prefix", { error: error.message })}\n`);
    io.exit(1);
    return;
  }

  const current = config.profiles[options.id];

  if (action === "add") {
    if (current) {
      io.stderr.write(`git-persona: ${message(locale, "profile.exists", { id: options.id })}\n`);
      io.exit(1);
      return;
    }

    config.profiles[options.id] = createProfile(options.id, options.values);
  }

  if (action === "edit") {
    if (!current) {
      io.stderr.write(`git-persona: ${message(locale, "profile.missing", { id: options.id })}\n`);
      io.exit(1);
      return;
    }

    config.profiles[options.id] = updateProfile(current, options.values);
  }

  if (action === "remove") {
    const bound = Object.values(config.active.repositories).includes(options.id);
    const active = config.active.global === options.id || bound;

    if (!current) {
      io.stderr.write(`git-persona: ${message(locale, "profile.missing", { id: options.id })}\n`);
      io.exit(1);
      return;
    }

    if (active) {
      io.stderr.write(
        `git-persona: ${message(locale, "profile.active", { id: options.id })}\n`,
      );
      io.exit(1);
      return;
    }

    delete config.profiles[options.id];
  }

  try {
    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${message(locale, "error.prefix", { error: error.message })}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(
    action === "remove"
      ? `${message(locale, "profile.removed", { id: options.id })}\n`
      : `${message(locale, action === "add" ? "profile.added" : "profile.updated", { id: options.id })}\n`,
  );
}
