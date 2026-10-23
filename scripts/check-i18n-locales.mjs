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

const locales = Object.fromEntries(
  localeCodes.map((locale) => {
    const filePath = path.join(localeDirectory, `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return [locale, new Set(collectKeyPaths(messages))];
  })
);

let hasMismatch = false;
for (const locale of localeCodes.slice(1)) {
  const missing = [...locales.en].filter((key) => !locales[locale].has(key)).sort();
  const extra = [...locales[locale]].filter((key) => !locales.en.has(key)).sort();
  if (missing.length || extra.length) {
    hasMismatch = true;
    console.error(`${locale}.json does not match en.json`);
    if (missing.length) console.error(`  Missing: ${missing.join(", ")}`);
    if (extra.length) console.error(`  Extra: ${extra.join(", ")}`);
  }
}

if (hasMismatch) {
  process.exitCode = 1;
} else {
  console.log("Locale key paths match en.json.");
}