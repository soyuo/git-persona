import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "../config.js";

const dir = dirname(fileURLToPath(import.meta.url));
export const locales = ["en-US", "ko-KR"];

const messages = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(join(dir, `${locale}.json`), "utf8")),
  ]),
);

export function supported(locale) {
  return locales.includes(locale);
}

export function localeOf(config, cwd = process.cwd()) {
  return config.active.repositoryLanguages?.[cwd]
    ?? config.active.language
    ?? "en-US";
}

export function currentLocale(cwd = process.cwd()) {
  try {
    return localeOf(load(), cwd);
  } catch {
    return "en-US";
  }
}

export function message(locale, key, values = {}) {
  const text = messages[locale]?.[key] ?? messages["en-US"][key] ?? key;

  return text.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
}

export function localeName(locale) {
  return messages[locale]?.["language.name"] ?? basename(locale);
}
