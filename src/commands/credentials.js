import { load, profiles as list, save } from "../config.js";
import {
  eraseGithubCredential,
  githubAccounts,
  storeGithubCredential,
} from "../git/index.js";
import { blue, green, yellow } from "../style.js";

function parseId(args, action) {
  if (args.length !== 1 || !args[0] || args[0].startsWith("--")) {
    throw new Error(`${action} requires one persona id`);
  }

  return args[0];
}

async function readSecret(io) {
  if (!io.stdin?.isTTY || !io.stdout?.isTTY || typeof io.stdin.setRawMode !== "function") {
    throw new Error("login requires an interactive terminal for hidden token input");
  }

  const input = io.stdin;
  const output = io.stdout;

  return await new Promise((resolve, reject) => {
    let token = "";

    const finish = (error, value) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === "\u0003") {
          finish(new Error("login cancelled"));
          return;
        }

        if (char === "\r" || char === "\n") {
          finish(null, token);
          return;
        }

        if (char === "\u0008" || char === "\u007f") {
          token = token.slice(0, -1);
          continue;
        }

        token += char;
      }
    };

    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
}

function username(profile) {
  return profile.auth?.https?.username ?? profile.id;
}

export async function runLogin(args, io) {
  let id;

  try {
    id = parseId(args, "login");
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  const config = load();
  const profile = config.profiles[id];

  if (!profile) {
    io.stderr.write(`git-persona: persona '${id}' does not exist\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`Token for '${id}' (input hidden): `);

  let token;

  try {
    token = await readSecret(io);

    if (!token) {
      throw new Error("token cannot be empty");
    }

    storeGithubCredential(username(profile), token);
    profile.auth = {
      ...profile.auth,
      https: {
        ...profile.auth?.https,
        username: username(profile),
        tokenStored: true,
      },
    };
    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  } finally {
    token = null;
  }

  io.stdout.write(`${green(`Stored GitHub credential for '${id}'.`, io.stdout)}\n`);
}

export function runLogout(args, io) {
  let id;

  try {
    id = parseId(args, "logout");
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(2);
    return;
  }

  const config = load();
  const profile = config.profiles[id];

  if (!profile) {
    io.stderr.write(`git-persona: persona '${id}' does not exist\n`);
    io.exit(1);
    return;
  }

  try {
    eraseGithubCredential(username(profile));
    profile.auth = {
      ...profile.auth,
      https: {
        ...profile.auth?.https,
        username: username(profile),
        tokenStored: false,
      },
    };
    save(config);
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`${green(`Removed GitHub credential for '${id}'.`, io.stdout)}\n`);
}

export function runCredentials(args, io) {
  if (args.length > 0) {
    io.stderr.write("git-persona: credentials takes no arguments\n");
    io.exit(2);
    return;
  }

  const config = load();
  const saved = list(config);
  let accounts;

  try {
    accounts = githubAccounts();
  } catch (error) {
    io.stderr.write(`git-persona: ${error.message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`${blue("GitHub credentials", io.stdout)}\n`);

  if (saved.length === 0) {
    io.stdout.write("No personas saved yet.\n");
    return;
  }

  for (const profile of saved) {
    const found = accounts.has(username(profile));
    const status = found ? green("stored", io.stdout) : yellow("not found", io.stdout);

    io.stdout.write(`  ${profile.id}: ${status}\n`);
  }
}
