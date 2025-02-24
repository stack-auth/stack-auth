// This file needs to run without any dependencies.

import fs from "fs";
import path from "path";

const COMMENT_LINE = "THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY";

const allEnvs = ["next", "react", "react-like", "js", "template"];
const ignoredFiles = ['node_modules', 'dist', '.turbo', '.gitignore'];

const baseDir = path.resolve(__dirname, "..", "packages");
const srcDir = path.resolve(baseDir, "template");

/**
 * Recursively remove empty folders in the given directory.
 */
function removeEmptyFolders(dir: string) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let isEmpty = true;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recursively remove empty subdirectories
      removeEmptyFolders(fullPath);

      // Check if the folder is now empty
      if (fs.existsSync(fullPath) && fs.readdirSync(fullPath).length === 0) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        isEmpty = false;
      }
    } else {
      // Directory contains at least one file
      isEmpty = false;
    }
  }

  // Remove the directory if it is empty
  if (isEmpty) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Copy all files/directories from srcDir to destDir (recursively).
 * - Skips copying `ignoredFiles`.
 * - Skips `package.json` in src.
 * - Renames `package-template.json` in src to `package.json` in dest.
 * - Applies `editFn` if provided.
 */
function copyFromSrcToDest(
  srcDir: string,
  destDir: string,
  editFn?: (relativePath: string, content: string) => string | null,
  currentDir = process.cwd()
) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const relativePath = path.relative(currentDir, srcPath);

    // If this entry is ignored, skip
    if (ignoredFiles.includes(entry.name) || ignoredFiles.includes(relativePath)) {
      continue;
    }

    // If this is package.json, skip copying from source
    if (!entry.isDirectory() && entry.name === "package.json") {
      continue;
    }

    // Calculate the destination path
    let destPath = path.join(destDir, entry.name);

    // Rename package-template.json -> package.json
    if (!entry.isDirectory() && entry.name === "package-template.json") {
      destPath = path.join(destDir, "package.json");
    }

    // Ensure the parent directory in dest exists
    const destParent = path.dirname(destPath);
    if (!fs.existsSync(destParent)) {
      fs.mkdirSync(destParent, { recursive: true });
    }

    if (entry.isDirectory()) {
      // Recursively copy directory
      copyFromSrcToDest(srcPath, destPath, editFn, currentDir);
    } else {
      // Copy and optionally edit file
      const content = fs.readFileSync(srcPath, "utf-8");
      const editedContent = editFn?.(relativePath, content);

      // If editFn returns null, skip writing the file
      if (editFn && editedContent === null) {
        continue;
      }

      let newContent = editedContent ?? content;
      
      // If the file is a .tsx, .ts, or .js file, add a comment line to the top of the file
      if (destPath.endsWith('.tsx') || destPath.endsWith('.ts') || destPath.endsWith('.js')) {
        const hasShebang = newContent.startsWith('#') || newContent.startsWith('"') || newContent.startsWith("'");
        const shebangLine = hasShebang ? newContent.split('\n')[0] + '\n\n' : '';
        const contentWithoutShebang = hasShebang ? newContent.split('\n').slice(1).join('\n') : newContent;
        
        newContent = shebangLine +
                    '//===========================================\n' +
                    '// ' + COMMENT_LINE + '\n' +
                    '//===========================================\n\n' +
                    contentWithoutShebang;
      }

      if (destPath.endsWith('package.json')) {
        // For package.json files, add a comment field
        const json = JSON.parse(newContent);
        const orderedJson = {
          "//": COMMENT_LINE,
          ...json
        };
        newContent = JSON.stringify(orderedJson, null, 2);
      }

      writeFileSyncIfChanged(destPath, newContent);
    }
  }
}

/**
 * Remove any files/directories in destDir that do not exist in srcDir
 * (except those in ignoredFiles).
 *
 * The logic also accounts for the `package-template.json` -> `package.json` rename:
 * If there's a `package.json` in dest but not in src, we do not immediately remove it
 * if src has `package-template.json`.
 */
function removeExtraneousDestItems(
  srcDir: string,
  destDir: string,
  currentDir = process.cwd()
) {
  if (!fs.existsSync(destDir)) return;

  const destEntries = fs.readdirSync(destDir, { withFileTypes: true });

  for (const entry of destEntries) {
    const destPath = path.join(destDir, entry.name);

    // If it's ignored, skip removing
    if (ignoredFiles.includes(entry.name)) {
      continue;
    }

    // Figure out the corresponding srcPath (for normal entries):
    let correspondingSrc = path.join(srcDir, entry.name);

    // Special case: if the dest item is `package.json`, we treat it
    // as if it corresponds to `package-template.json` in src
    // (since we renamed on copy).
    if (entry.name === "package.json") {
      const altSrc = path.join(srcDir, "package-template.json");
      if (fs.existsSync(altSrc)) {
        correspondingSrc = altSrc;
      }
    }

    // Check if corresponding src item exists
    if (!fs.existsSync(correspondingSrc)) {
      // Remove from dest if src item does not exist
      fs.rmSync(destPath, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      // Recursively check inside directories
      removeExtraneousDestItems(correspondingSrc, destPath, currentDir);
    }
  }
}

/**
 * Main function to generate from template:
 * 1. Ensures dest exists
 * 2. Copies from src to dest (with optional editFn)
 * 3. Removes any items in dest that aren't in src (except ignored)
 * 4. Cleans up empty folders
 */
function generateFromTemplate(options: {
  src: string;
  dest: string;
  editFn?: (relativePath: string, content: string) => string | null;
  topLevel?: boolean;
}) {
  const { src, dest, editFn, topLevel = true } = options;

  // Step 1: Ensure the destination directory exists
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  // Step 2: Copy everything from src to dest
  copyFromSrcToDest(src, dest, editFn);

  // Step 3: Remove anything in dest that isn't in src (except ignored)
  removeExtraneousDestItems(src, dest);

  // Step 4: Optionally clean up empty folders at the top level
  if (topLevel) {
    removeEmptyFolders(dest);
  }
}

export { generateFromTemplate };


function processMacros(content: string, envs: string[]): string {
  const lines = content.split('\n');
  const result: string[] = [];

  // Each element in skipStack can be either:
  //
  // 1) A string like "NEXT_LINE", meaning skip exactly the next line.
  //
  // 2) An object of the form:
  //       { 
  //         type: 'IF_BLOCK',
  //         parentActive: boolean,
  //         hasMatched: boolean,
  //         isActive: boolean
  //       }
  //
  //    - parentActive = whether the block's parent is active. If false, this block can never produce output.
  //    - hasMatched   = if any branch in this block has matched so far (IF_PLATFORM or ELSE_IF).
  //    - isActive     = if the *current branch* in this block is active right now.
  //
  interface IFBlockState {
    type: 'IF_BLOCK';
    parentActive: boolean;
    hasMatched: boolean;
    isActive: boolean;
  }

  const skipStack: Array<string | IFBlockState> = [];

  /**
   * Returns the top IF_BLOCK on the stack or null if none.
   */
  function getCurrentIFBlock(): IFBlockState | null {
    for (let i = skipStack.length - 1; i >= 0; i--) {
      const top = skipStack[i];
      if (typeof top !== 'string' && top.type === 'IF_BLOCK') {
        return top;
      }
    }
    return null;
  }

  /**
   * Check if we should output the current line (based on skipStack).
   */
  function shouldOutputLine(): boolean {
    // If there's a "NEXT_LINE" on top, we skip this line.
    // (We'll remove that NEXT_LINE after we handle this line.)
    for (let i = skipStack.length - 1; i >= 0; i--) {
      if (skipStack[i] === 'NEXT_LINE') {
        return false;
      }
    }

    // If any IF_BLOCK up the stack is not active, or its parent is not active, we skip.
    for (let i = skipStack.length - 1; i >= 0; i--) {
      const top = skipStack[i];
      if (typeof top !== 'string' && top.type === 'IF_BLOCK') {
        if (!top.parentActive || !top.isActive) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Consume a single-use "NEXT_LINE" skip once we've decided about output.
   */
  function consumeNextLineIfPresent() {
    const top = skipStack[skipStack.length - 1];
    if (top === 'NEXT_LINE') {
      skipStack.pop();
    }
  }

  /**
   * Parse environment tokens from a directive substring (the part after IF_PLATFORM, ELSE_IF_PLATFORM, etc.).
   * We do a basic split on whitespace, then remove punctuation except for letters/numbers/hyphens.
   */
  function parseEnvList(envString: string): string[] {
    return envString
      .split(/\s+/)
      .map((e) => e.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
      .filter(Boolean);
  }

  /**
   * We define flexible regexes that look for these directives *anywhere* in the line:
   *   - IF_PLATFORM
   *   - ELSE_IF_PLATFORM
   *   - ELSE_PLATFORM
   *   - END_PLATFORM
   *   - NEXT_LINE_PLATFORM
   *
   * And then capture everything after that keyword up to the end of the line.
   *
   * Examples:
   *   "blah blah IF_PLATFORM env1 env2 ???"  => captures "env1 env2 ???"
   *   "adsfasdf ELSE_PLATFORM blabla"         => captures "blabla"
   */
  const reBeginOnly = /\bIF_PLATFORM\s+(.+)/i;
  const reElseIf    = /\bELSE_IF_PLATFORM\s+(.+)/i;
  const reElse      = /\bELSE_PLATFORM\b/i;
  const reEndOnly   = /\bEND_PLATFORM\b/i;
  const reNextLine  = /\bNEXT_LINE_PLATFORM\s+(.+)/i;

  for (const line of lines) {
    // 1) Try detecting IF_PLATFORM ...
    const beginMatch = line.match(reBeginOnly);
    if (beginMatch) {
      const parentBlock = getCurrentIFBlock();
      // If parentActive = false or isActive = false => entire sub-block is inactive
      const parentIsFullyActive =
        !parentBlock ? true : (parentBlock.parentActive && parentBlock.isActive);

      if (!parentIsFullyActive) {
        // Just push an inactive block so we handle nested macros correctly
        skipStack.push({
          type: 'IF_BLOCK',
          parentActive: false,
          hasMatched: false,
          isActive: false
        });
      } else {
        const envList = parseEnvList(beginMatch[1]); // e.g. "env1 env2 ???"
        const matched = envList.some((e) => envs.includes(e));
        skipStack.push({
          type: 'IF_BLOCK',
          parentActive: true,
          hasMatched: matched, 
          isActive: matched
        });
      }
      // Skip output of the directive line
      continue;
    }

    // 2) Try detecting ELSE_IF_PLATFORM ...
    const elseIfMatch = line.match(reElseIf);
    if (elseIfMatch) {
      const block = getCurrentIFBlock();
      if (block) {
        if (!block.parentActive) {
          // Parent block is inactive => do nothing
        } else {
          // If block.hasMatched is true, we've already used an if/else if
          // If not, we check if the environment matches
          if (block.hasMatched) {
            block.isActive = false;
          } else {
            const envList = parseEnvList(elseIfMatch[1]);
            const matched = envList.some((e) => envs.includes(e));
            if (matched) {
              block.hasMatched = true;
              block.isActive = true;
            } else {
              block.isActive = false;
            }
          }
        }
      }
      // Skip output
      continue;
    }

    // 3) Try detecting ELSE_PLATFORM ...
    const elseMatch = line.match(reElse);
    if (elseMatch) {
      const block = getCurrentIFBlock();
      if (block) {
        if (!block.parentActive) {
          // Still nothing
        } else {
          // If we haven't matched anything yet, now we become active
          if (!block.hasMatched) {
            block.hasMatched = true;
            block.isActive = true;
          } else {
            // Already matched something, so skip
            block.isActive = false;
          }
        }
      }
      // Skip line
      continue;
    }

    // 4) Try detecting END_PLATFORM ...
    const endMatch = line.match(reEndOnly);
    if (endMatch) {
      // Pop the top IF_BLOCK
      const top = skipStack[skipStack.length - 1];
      if (typeof top !== 'string' && top.type === 'IF_BLOCK') {
        skipStack.pop();
      }
      // Skip line
      continue;
    }

    // 5) Try detecting NEXT_LINE_PLATFORM ...
    const nextLineMatch = line.match(reNextLine);
    if (nextLineMatch) {
      const envList = parseEnvList(nextLineMatch[1]);
      const matched = envList.some((e) => envs.includes(e));
      if (!matched) {
        skipStack.push('NEXT_LINE');
      }
      // Skip line
      continue;
    }

    // If it's a normal line:
    if (shouldOutputLine()) {
      result.push(line);
    }

    // If the top of the stack is NEXT_LINE, consume it once
    consumeNextLineIfPresent();
  }

  return result.join('\n');
}
 
function writeFileSyncIfChanged(path: string, content: string): void {
  if (fs.existsSync(path)) {
    const existingContent = fs.readFileSync(path, "utf-8");
    if (existingContent === content) {
      return;
    }
  }
  fs.writeFileSync(path, content);
}

// Copy package-template.json to package.json and apply macros
const packageTemplateContent = fs.readFileSync(path.join(srcDir, 'package-template.json'), 'utf-8');
const processedPackageJson = processMacros(packageTemplateContent, allEnvs);
const packageJson = JSON.parse(processedPackageJson);
const packageJsonWithComment = {
  "//": COMMENT_LINE,
  ...packageJson
};
writeFileSyncIfChanged(path.join(srcDir, 'package.json'), JSON.stringify(packageJsonWithComment, null, 2));


generateFromTemplate({
  src: srcDir,
  dest: path.resolve(baseDir, "js"),
  editFn: (path, content) => {
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

    if (ignores.some(ignorePath => path.startsWith(ignorePath)) || path.endsWith('.tsx')) {
      return null;
    }

    content = processMacros(content, ["js"]);

    return content;
  },
});

generateFromTemplate({
  src: srcDir,
  dest: path.resolve(baseDir, "stack"),
  editFn: (path, content) => {
    // ignore the generated folder as the files are big and not needed
    if (path.startsWith('src/generated')) {
      return null;
    }

    content = processMacros(content, ["next", "react-like"]);

    return content;
  },
});

generateFromTemplate({
  src: srcDir,
  dest: path.resolve(baseDir, "react"),
  editFn: (path, content) => {
    // ignore the generated folder as the files are big and not needed
    if (path.startsWith('src/generated')) {
      return null;
    }

    content = processMacros(content, ["react", "react-like"]);

    return content;
  },
});
