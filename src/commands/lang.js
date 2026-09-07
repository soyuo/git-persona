import { load, save } from "../config.js";
import { gitState } from "../git/index.js";
import { localeOf, locales, message, supported } from "../langs/index.js";

export function runLang(args, io) {
  const repo = args.includes("--repo");
  const values = args.filter((arg) => arg !== "--repo");
  const config = load();
  const current = localeOf(config, process.cwd());

  if (values.length === 0) {
    io.stdout.write(`${message(current, "lang.current", { locale: current })}\n`);
    return;
  }

  if (values.length !== 1 || !supported(values[0])) {
    io.stderr.write(
      `git-persona: ${message(current, "lang.unsupported", {
        locale: values[0] ?? "",
        supported: locales.join(", "),
      })}\n${message(current, "lang.usage")}\n`,
    );
    io.exit(2);
    return;
  }

  const locale = values[0];

  if (repo) {
    if (!gitState().isRepository) {
      io.stderr.write(`git-persona: ${message(current, "lang.requiresRepo")}\n`);
      io.exit(1);
      return;
    }

    config.active.repositoryLanguages[process.cwd()] = locale;
    save(config);
    io.stdout.write(`${message(locale, "lang.repoSet", { locale })}\n`);
    return;
  }

  config.active.language = locale;
  save(config);
  io.stdout.write(`${message(locale, "lang.globalSet", { locale })}\n`);
}
