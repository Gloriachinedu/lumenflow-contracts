import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const localeDirectory = path.resolve(scriptDirectory, "../frontend/locales");
const localeCodes = ["en", "es", "pt"];

function collectKeyPaths(value, prefix = "") {
  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      return [keyPath, ...collectKeyPaths(nestedValue, keyPath)];
    }
    return [keyPath];
  });
}

function loadLocaleKeys(locale) {
  const filePath = path.join(localeDirectory, `${locale}.json`);
  const messages = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return new Set(collectKeyPaths(messages));
}

const baseLocale = "en";
const baseKeys = loadLocaleKeys(baseLocale);
const targetLocales = localeCodes.filter((locale) => locale !== baseLocale);

let hasMissingKeys = false;

for (const locale of targetLocales) {
  const localeKeys = loadLocaleKeys(locale);
  const missing = [...baseKeys].filter((key) => !localeKeys.has(key)).sort();
  const extra = [...localeKeys].filter((key) => !baseKeys.has(key)).sort();

  if (missing.length || extra.length) {
    if (missing.length) hasMissingKeys = true;
    console.error(`\n[${locale}] ${locale}.json does not match ${baseLocale}.json`);
    if (missing.length) {
      console.error(`  Missing ${missing.length} key(s) present in ${baseLocale}.json:`);
      for (const key of missing) console.error(`    - ${key}`);
    }
    if (extra.length) {
      console.error(`  Extra ${extra.length} key(s) not present in ${baseLocale}.json:`);
      for (const key of extra) console.error(`    - ${key}`);
    }
  } else {
    console.log(`[${locale}] All ${baseKeys.size} key paths present.`);
  }
}

if (hasMissingKeys) {
  console.error(
    `\nLocale coverage check failed: one or more locales are missing keys from ${baseLocale}.json.`
  );
  process.exitCode = 1;
} else {
  console.log(`\nAll locales contain every key path from ${baseLocale}.json.`);
}