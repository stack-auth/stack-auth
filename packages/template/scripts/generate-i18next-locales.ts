import { writeFileSyncIfChanged } from "@stackframe/stack-shared/dist/utils/fs";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import * as fs from "fs";
import * as path from "path";

/**
 * This script reads the locale JSON files and generates the inlined TypeScript file.
 * 
 * The JSON files in src/locales/ are the SOURCE OF TRUTH and can be manually edited.
 * This script only regenerates the index.ts file which inlines all translations for bundling.
 * 
 * Usage:
 *   pnpm run generate-i18next-locales
 * 
 * To add a new translation:
 *   1. Edit the JSON files directly (e.g., src/locales/de-DE.json)
 *   2. Run this script to regenerate index.ts
 *   3. Run generate-sdks to propagate to other packages
 */

async function main() {
  const localesDir = path.join(__dirname, "../src/locales");

  // Ensure locales directory exists
  if (!fs.existsSync(localesDir)) {
    throw new Error(`Locales directory not found: ${localesDir}. Please create locale JSON files first.`);
  }

  // Read all JSON files from the locales directory
  const jsonFiles = fs.readdirSync(localesDir).filter(f => f.endsWith('.json')).sort();
  
  if (jsonFiles.length === 0) {
    throw new Error(`No locale JSON files found in ${localesDir}`);
  }

  const localeData: Record<string, Record<string, string>> = {};
  
  for (const file of jsonFiles) {
    const localeName = file.replace('.json', '');
    const content = fs.readFileSync(path.join(localesDir, file), 'utf-8');
    localeData[localeName] = JSON.parse(content);
    console.log(`Read ${file} (${Object.keys(localeData[localeName]).length} keys)`);
  }

  const localeNames = Object.keys(localeData).sort();

  // Generate a TypeScript file that inlines all translations
  // This avoids JSON import issues with bundlers
  const formatTranslations = (translations: Record<string, string>) => {
    const lines = JSON.stringify(translations, null, 2).split('\n');
    // Add 2 spaces of indentation to ALL lines except the first opening brace
    return lines.map((line, i) => i === 0 ? line : '  ' + line).join('\n');
  };

  const indexContent = deindent`
    // THIS FILE IS AUTO-GENERATED. DO NOT EDIT DIRECTLY.
    // Edit the individual JSON files in this directory instead, then run:
    // pnpm run generate-i18next-locales

    export const supportedLocales = [${localeNames.map(l => `"${l}"`).join(", ")}] as const;
    export type SupportedLocale = typeof supportedLocales[number];

    // Inlined translations to avoid JSON import issues with bundlers
    export const locales: Record<SupportedLocale, Record<string, string>> = {
    ${localeNames.map(name => `  "${name}": ${formatTranslations(localeData[name])},`).join("\n")}
    };

    export default locales;
  ` + "\n";

  writeFileSyncIfChanged(path.join(localesDir, "index.ts"), indexContent);
  console.log(`Generated ${path.join(localesDir, "index.ts")}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
