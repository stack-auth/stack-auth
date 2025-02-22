import fs from "fs";
import path from "path";
import yaml from "yaml";
import { PLATFORMS, copyFromSrcToDest, processMacros, writeFileSyncIfChanged } from "./utils";

interface DocObject {
  platform?: string;
  [key: string]: any;
}

function processDocObject(obj: any, platform: string): any {
  // If not an object, return as is
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj
      .map(item => processDocObject(item, platform))
      .filter(item => item !== null);
  }

  // Handle objects
  const docObj = obj as DocObject;
  
  // If object has platform and it doesn't match current platform, exclude it
  if (docObj.platform) {
    if (docObj.platform !== platform) {
      return null;
    }
    // Remove the platform field from the output
    const { platform: _, ...rest } = docObj;
    obj = rest;
  }

  // Recursively process all properties
  const result: { [key: string]: any } = {};
  for (const [key, value] of Object.entries(obj)) {
    const processed = processDocObject(value, platform);
    if (processed !== null) {
      if (typeof processed === 'string') {
        result[key] = processed.replace(/{base}/g, `docs/pages-${platform}`);
      } else {
        result[key] = processed;
      }
    }
  }

  return result;
}

const docsDir = path.resolve(__dirname, "..", "docs", "fern");
const templateDir = path.join(docsDir, "docs", "pages-template");
const ymlTemplatePath = path.join(docsDir, "docs-template.yml");

for (const platform of ["next", "js"]) {
  const destDir = path.join(docsDir, 'docs', `pages-${platform}`);

  // Copy the entire template directory, processing macros for each file
  copyFromSrcToDest({
    srcDir: templateDir,
    destDir,
    editFn: (relativePath, content) => {
      return processMacros(content, PLATFORMS[platform]);
    },
  });

  // Also generate the legacy single yml file for backwards compatibility
  const mainYmlContent = fs.readFileSync(ymlTemplatePath, "utf-8");
  const macroProcessed = processMacros(mainYmlContent, PLATFORMS[platform]);
  const template = yaml.parse(macroProcessed);
  const processed = processDocObject(template, platform);
  const output = yaml.stringify(processed);
  
  writeFileSyncIfChanged(path.join(docsDir, `${platform}.yml`), output);
}

