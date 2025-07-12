#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively remove all files and directories within a directory
 * but keep the directory itself
 */
function clearDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.log(`Directory ${dirPath} does not exist.`);
    return;
  }

  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory()) {
      // Recursively remove directory and all its contents
      fs.rmSync(itemPath, { recursive: true, force: true });
      console.log(`Removed directory: ${itemPath}`);
    } else {
      // Remove file
      fs.unlinkSync(itemPath);
      console.log(`Removed file: ${itemPath}`);
    }
  }
}

function main() {
  const docsPath = path.join(__dirname, '..', 'content', 'docs');
  const apiDocsPath = path.join(__dirname, '..', 'content', 'api');

  console.log('🧹 Clearing all files and directories in content/docs, and content/api');
  console.log(`Target directory: ${docsPath}`);
  console.log(`Target directory: ${apiDocsPath}`);

  try {
    clearDirectory(docsPath);
    clearDirectory(apiDocsPath);
    console.log('✅ Successfully cleared content/docs directory!');
  } catch (error) {
    console.error('❌ Error clearing content/docs directory:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
