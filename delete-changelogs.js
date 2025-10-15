#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = '/Users/madison/source/stack-auth';
const rootChangelog = path.join(rootDir, 'CHANGELOG.md');

console.log('🧹 Starting to delete CHANGELOG.md files...\n');

// Get all CHANGELOG.md files except in node_modules
const findCmd = `find "${rootDir}" -name "CHANGELOG.md" -type f ! -path "*/node_modules/*"`;
const output = execSync(findCmd, { encoding: 'utf8' });
const changelogs = output.trim().split('\n').filter(Boolean);

console.log(`Found ${changelogs.length} CHANGELOG.md files`);
console.log(`Will delete ${changelogs.length - 1} files (keeping root CHANGELOG.md)\n`);

let deletedCount = 0;

for (const changelog of changelogs) {
  // Skip the root CHANGELOG.md file
  if (changelog === rootChangelog) {
    console.log(`✅ Keeping: ${path.relative(rootDir, changelog)}`);
    continue;
  }

  try {
    fs.unlinkSync(changelog);
    deletedCount++;
    console.log(`🗑️  Deleted: ${path.relative(rootDir, changelog)}`);
  } catch (error) {
    console.error(`❌ Failed to delete ${path.relative(rootDir, changelog)}: ${error.message}`);
  }
}

console.log(`\n✅ Done! Deleted ${deletedCount} CHANGELOG.md files`);
console.log(`✅ Kept: ${path.relative(rootDir, rootChangelog)}`);
