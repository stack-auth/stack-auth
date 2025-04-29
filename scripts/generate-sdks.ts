import fs from "fs";
import path from "path";
import { COMMENT_BLOCK, COMMENT_LINE, PLATFORMS, copyFromSrcToDest, processMacros, withGeneratorLock, writeFileSyncIfChanged } from "./utils";

/**
 * Main function to generate from a template:
 * 1. Ensures the destination exists.
 * 2. Copies from src to dest (applying a composite editFn).
 * 3. Removes any items in dest that aren’t in src.
 * 4. Cleans up empty folders.
 *
 * The composite editFn encapsulates the hard rules:
 * - Global ignores (e.g. node_modules, dist, etc.)
 * - Skipping source package.json.
 * - Renaming package-template.json -> package.json.
 * - Inserting header comments into .tsx, .ts, or .js files.
 * - Adding a comment field in package.json files.
 *
 * Custom editFns provided in options can further modify content.
 */
function generateFromTemplate(options: {
  src: string;
  dest: string;
  editFn?: (relativePath: string, content: string) => string;
  filterFn?: (relativePath: string) => boolean;
  destFn?: (relativePath: string) => string;
}) {
  const { src, dest, editFn, filterFn, destFn } = options;

  // Composite edit function that applies the hard rules first,
  // then defers to any custom edit function.
  function compositeEditFn(
    relativePath: string,
    content: string
  ): string {
    let newContent: string = editFn ? editFn(relativePath, content) : content;

    // For .tsx, .ts, or .js files, add header comments.
    if (/\.(tsx|ts|js)$/.test(relativePath)) {
      const hasShebang =
        newContent.startsWith("#") ||
        newContent.startsWith('"') ||
        newContent.startsWith("'");
      let shebangLine = "";
      let contentWithoutShebang = newContent;
      if (hasShebang) {
        const lines = newContent.split("\n");
        shebangLine = lines[0] + "\n\n";
        contentWithoutShebang = lines.slice(1).join("\n");
      }
      newContent = shebangLine + COMMENT_BLOCK + contentWithoutShebang;
    }

    // If the resulting file is package.json, add a comment field to the JSON.
    if (path.basename(relativePath) === "package.json") {
      const jsonObj = JSON.parse(newContent);
      newContent = JSON.stringify({ "//": COMMENT_LINE, ...jsonObj }, null, 2);
    }

    return newContent;
  }

  function compositeDestFn(relativePath: string) {
    if (relativePath === "package-template.json") {
      return "package.json";
    }

    if (destFn) {
      return destFn(relativePath);
    }
    return relativePath;
  }

  function compositeFilterFn(relativePath: string) {
    const ignores = ["node_modules", "dist", ".turbo", ".gitignore", "package.json"];
    for (const ignore of ignores) {
      if (relativePath.startsWith(ignore)) {
        return false;
      }
    }

    if (filterFn) {
      return filterFn(relativePath);
    }
    return true;
  }

  // Ensure the destination directory exists.
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  copyFromSrcToDest({
    srcDir: src,
    destDir: dest,
    editFn: compositeEditFn,
    filterFn: compositeFilterFn,
    destFn: compositeDestFn,
    destRemoveSkipFn: (relativePath) => {
      return relativePath.startsWith("node_modules") || relativePath.startsWith("dist") || relativePath.startsWith(".turbo");
    },
  });
}

function processPackageJson(path: string, content: string) {
  let jsonObj: any;
  try {
    jsonObj = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse package.json at ${path}`, { cause: error });
  }
  return JSON.stringify({ "//": COMMENT_LINE, ...jsonObj }, null, 2);
}

function baseEditFn(options: {
  relativePath: string, 
  content: string,
  platforms: string[]
}) {
  if (options.relativePath.startsWith("src/generated")) {
    return options.content;
  }
  const result = processMacros(options.content, options.platforms);
  if (options.relativePath === 'package-template.json') {
    return processPackageJson(options.relativePath, result);
  }
  return result;
}


withGeneratorLock(async () => {
  const baseDir = path.resolve(__dirname, "..", "packages");
  const srcDir = path.resolve(baseDir, "template");

  // Copy package-template.json to package.json in the template,
  // applying macros and adding a comment field.
  const packageTemplateContent = fs.readFileSync(
    path.join(srcDir, "package-template.json"),
    "utf-8"
  );
  const processedPackageJson = processMacros(packageTemplateContent, PLATFORMS["template"]);
  writeFileSyncIfChanged(
    path.join(srcDir, "package.json"),
    processPackageJson(path.join(srcDir, "package-template.json"), processedPackageJson)
  );

  generateFromTemplate({
    src: srcDir,
    dest: path.resolve(baseDir, "js"),
    editFn: (relativePath, content) => {
      return baseEditFn({ relativePath, content, platforms: PLATFORMS["js"] });
    },
    filterFn: (relativePath) => {
      const ignores = [
        "postcss.config.js",
        "tailwind.config.js",
        "quetzal.config.json",
        "components.json",
        ".env",
        ".env.local",
        "scripts/",
        "quetzal-translations/",
        "src/components/",
        "src/components-page/",
        "src/generated/",
        "src/providers/",
        "src/global.css",
        "src/global.d.ts",
      ];

      if (ignores.some((ignorePath) => relativePath.startsWith(ignorePath)) || relativePath.endsWith(".tsx")) {
        return false;
      } else {
        return true;
      }
    },
  });

  generateFromTemplate({
    src: srcDir,
    dest: path.resolve(baseDir, "stack"),
    editFn: (relativePath, content) => {
      return baseEditFn({ relativePath, content, platforms: PLATFORMS["next"] });
    },
  });

  generateFromTemplate({
    src: srcDir,
    dest: path.resolve(baseDir, "react"),
    editFn: (relativePath, content) => {
      return baseEditFn({ relativePath, content, platforms: PLATFORMS["react"] });
    },
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
