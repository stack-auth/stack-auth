import fs from "fs";
import path from "path";
import yaml from "yaml";
import { PLATFORMS, copyFromSrcToDest, processMacros, withGeneratorLock, writeFileSyncIfChanged } from "./utils";

interface DocObject {
  platform?: string;
  [key: string]: any;
}

function processDocObject(obj: any, platforms: string[]): { result: any, validPaths: string[] } {
  // If not an object, return as is
  if (typeof obj !== 'object' || obj === null) {
    return { result: obj, validPaths: [] };
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const processed = obj
      .map(item => processDocObject(item, platforms))
      .filter(item => item.result !== null);
    return {
      result: processed.map(p => p.result),
      validPaths: processed.flatMap(p => p.validPaths)
    };
  }

  // Handle objects
  const docObj = obj as DocObject;
  
  // If object has platform and it doesn't match current platform, exclude it
  if (docObj.platform) {
    if (!platforms.includes(docObj.platform)) {
      return { result: null, validPaths: [] };
    }
    // Remove the platform field from the output
    const { platform: _, ...rest } = docObj;
    obj = rest;
  }

  const validPaths: string[] = [];

  // Recursively process all properties
  const result: { [key: string]: any } = {};
  for (const [key, value] of Object.entries(obj)) {
    const { result: processed, validPaths: processedValidPaths } = processDocObject(value, platforms);
    processedValidPaths.forEach(path => validPaths.push(path));

    if (processed !== null) {
      if (typeof processed === 'string') {
        if (key === 'path') {
          validPaths.push(processed.split('/').slice(3).join('/'));
        }

        result[key] = processed.replace(/{platform}/g, platforms[0]);
      } else {
        result[key] = processed;
      }
    }
  }

  return {
    result,
    validPaths
  }
}

withGeneratorLock(async () => {
  const docsDir = path.resolve(__dirname, "..", "docs", "fern");
  const templateDir = path.join(docsDir, "docs", "pages-template");
  const ymlTemplatePath = path.join(docsDir, "docs-template.yml");

  for (const platform of ["next", "js", "react", "python"]) {
    const destDir = path.join(docsDir, 'docs', `pages-${platform}`);

    const mainYmlContent = fs.readFileSync(ymlTemplatePath, "utf-8");
    const macroProcessed = processMacros(mainYmlContent, PLATFORMS[platform]);
    const template = yaml.parse(macroProcessed);
    const { result: processed, validPaths: processedValidPaths } = processDocObject(template, PLATFORMS[platform]);
    const output = yaml.stringify(processed);
    writeFileSyncIfChanged(path.join(docsDir, `${platform}.yml`), output);

    // Copy the entire template directory, processing macros for each file
    copyFromSrcToDest({
      srcDir: templateDir,
      destDir,
      editFn: (relativePath, content) => {
        return processMacros(content, PLATFORMS[platform]);
      },
      filterFn: (relativePath) => {
        if (relativePath.endsWith('.mdx') && !relativePath.startsWith('snippets')) {
          return processedValidPaths.includes(relativePath);
        }
        return true;
      }
    });
  }
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
