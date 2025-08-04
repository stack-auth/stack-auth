#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

class ChangelogManager {
  private masterChangelogPath = 'CHANGELOG.md';
  private rl: readline.Interface;
  private packages: string[] = [];
  private workspaceRoot = process.cwd();

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.packages = this.discoverPackages();
  }

  private discoverPackages(): string[] {
    try {
      // Read pnpm-workspace.yaml to get workspace patterns
      const workspaceFile = path.join(this.workspaceRoot, 'pnpm-workspace.yaml');
      let patterns: string[] = [];
      
      if (fs.existsSync(workspaceFile)) {
        const workspaceContent = fs.readFileSync(workspaceFile, 'utf-8');
        patterns = this.parseWorkspaceYaml(workspaceContent);
      } else {
        console.warn('No pnpm-workspace.yaml found, falling back to default patterns');
        patterns = ['packages/*', 'apps/*', 'examples/*', 'docs'];
      }
      
      return this.discoverPackagesFromDirectories(patterns);
    } catch (error) {
      console.error('Error discovering packages:', error);
      return [];
    }
  }

  private parseWorkspaceYaml(content: string): string[] {
    // Simple YAML parser for pnpm-workspace.yaml structure
    const lines = content.split('\n');
    const patterns: string[] = [];
    let inPackagesSection = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === 'packages:') {
        inPackagesSection = true;
        continue;
      }
      
      if (inPackagesSection) {
        if (trimmed.startsWith('- ')) {
          const pattern = trimmed.substring(2).trim();
          patterns.push(pattern);
        } else if (trimmed && !trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
          // End of packages section
          break;
        }
      }
    }
    
    return patterns;
  }

  private discoverPackagesFromDirectories(patterns: string[]): string[] {
    const packageNames: string[] = [];
    
    for (const pattern of patterns) {
      try {
        const packageJsonFiles = this.findPackageJsonFiles(pattern);
        
        for (const packageJsonFile of packageJsonFiles) {
          try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, 'utf-8'));
            
            // Skip the root monorepo package and packages without names
            if (packageJson.name && 
                packageJson.name !== '@stackframe/monorepo' && 
                !packageJson.name.includes('node_modules')) {
              packageNames.push(packageJson.name);
            }
          } catch (error) {
            console.warn(`Failed to read package.json at ${packageJsonFile}:`, error);
          }
        }
      } catch (error) {
        console.warn(`Failed to process pattern ${pattern}:`, error);
      }
    }
    
    // Remove duplicates and sort
    const uniquePackages = [...new Set(packageNames)];
    return this.sortPackages(uniquePackages);
  }

  private findPackageJsonFiles(pattern: string): string[] {
    const packageJsonFiles: string[] = [];
    
    if (pattern.endsWith('*')) {
      // Handle wildcard patterns like "packages/*"
      const baseDir = pattern.slice(0, -1); // Remove the '*'
      const fullBasePath = path.join(this.workspaceRoot, baseDir);
      
      if (fs.existsSync(fullBasePath)) {
        const entries = fs.readdirSync(fullBasePath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const packageJsonPath = path.join(fullBasePath, entry.name, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
              packageJsonFiles.push(packageJsonPath);
            }
          }
        }
      }
    } else {
      // Handle specific directory patterns like "docs"
      const packageJsonPath = path.join(this.workspaceRoot, pattern, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        packageJsonFiles.push(packageJsonPath);
      }
    }
    
    return packageJsonFiles;
  }

  private sortPackages(packages: string[]): string[] {
    return packages.sort((a, b) => {
      // Define sorting priority
      const getPriority = (name: string) => {
        if (name.includes('stack-shared') || name === '@stackframe/stack') return 0;
        if (name.includes('backend') || name.includes('dashboard') || name.includes('docs')) return 1;
        if (name.includes('example') || name.includes('demo')) return 3;
        return 2;
      };
      
      const priorityA = getPriority(a);
      const priorityB = getPriority(b);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // If same priority, sort alphabetically
      return a.localeCompare(b);
    });
  }

  private question(prompt: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(prompt, resolve);
    });
  }

  private async promptForVersion(): Promise<string> {
    while (true) {
      const version = await this.question('Enter the version number (e.g., 2.8.26): ');
      if (version.match(/^\d+\.\d+\.\d+$/)) {
        return version;
      }
      console.log('Please enter a valid version number in the format X.Y.Z');
    }
  }

  private async promptForChangeType(): Promise<'major' | 'minor' | 'patch'> {
    while (true) {
      const choice = await this.question('What type of change is this? (patch, minor, major): ');
      const normalized = choice.trim().toLowerCase();
      
      switch (normalized) {
        case 'patch':
        case 'p':
          return 'patch';
        case 'minor':
        case 'min':
          return 'minor';
        case 'major':
        case 'maj':
          return 'major';
        default:
          console.log('Please enter "patch", "minor", or "major"');
      }
    }
  }

  private async promptForPackageChanges(packageName: string): Promise<string[]> {
    const changesInput = await this.question(`\n${packageName}: `);
    
    if (!changesInput.trim()) {
      return [];
    }
    
    return changesInput
      .split(',')
      .map(change => change.trim())
      .filter(change => change.length > 0);
  }

  private async collectAllChanges(version: string, type: 'major' | 'minor' | 'patch'): Promise<Map<string, string[]>> {
    const allChanges = new Map<string, string[]>();
    
    console.log('\nEnter changes for each package (comma-separated, or press Enter to skip):');
    
    for (const packageName of this.packages) {
      const changes = await this.promptForPackageChanges(packageName);
      if (changes.length > 0) {
        allChanges.set(packageName, changes);
      }
    }
    
    return allChanges;
  }

  private async confirmChanges(version: string, type: string, allChanges: Map<string, string[]>): Promise<boolean> {
    console.log('\n' + '='.repeat(60));
    console.log('PREVIEW OF CHANGES');
    console.log('='.repeat(60));
    console.log(`Version: ${version}`);
    console.log(`Type: ${type.charAt(0).toUpperCase() + type.slice(1)} Changes`);
    console.log('');
    
    const hasChanges = allChanges.size > 0;
    
    if (!hasChanges) {
      console.log('No changes were entered for any package.');
      return false;
    }
    
    for (const [packageName, changes] of allChanges.entries()) {
      console.log(`${packageName}:`);
      for (const change of changes) {
        console.log(`  - ${change}`);
      }
      console.log('');
    }
    
    console.log('='.repeat(60));
    
    while (true) {
      const confirm = await this.question('Do you want to add these changes to the changelog? (y/n): ');
      if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
        return true;
      } else if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
        return false;
      }
      console.log('Please enter y or n');
    }
  }

  private addToChangelog(version: string, type: 'major' | 'minor' | 'patch', allChanges: Map<string, string[]>): void {
    const content = fs.readFileSync(this.masterChangelogPath, 'utf-8');
    const lines = content.split('\n');
    
    // Find insertion point (after header, before first version)
    let insertIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        insertIndex = i;
        break;
      }
    }
    
    const typeHeader = type === 'major' ? 'Major Changes' : 
                      type === 'minor' ? 'Minor Changes' : 'Patch Changes';
    
    const newSection = [
      `## ${version}`,
      '',
      `### ${typeHeader}`,
      ''
    ];
    
    // Add packages in order of importance
    const packageOrder = this.getPackageOrder(Array.from(allChanges.keys()));
    
    for (const packageName of packageOrder) {
      const changes = allChanges.get(packageName);
      if (changes && changes.length > 0) {
        newSection.push(`#### ${packageName}`, '');
        newSection.push(...changes.map(change => `- ${change}`));
        newSection.push('');
      }
    }
    
    lines.splice(insertIndex, 0, ...newSection);
    
    // Write back to file
    fs.writeFileSync(this.masterChangelogPath, lines.join('\n'));
    console.log(`\n✅ Changes successfully added to ${this.masterChangelogPath}`);
  }

  private getPackageOrder(packageNames: string[]): string[] {
    return packageNames.sort((a, b) => {
      const getPackageType = (name: string) => {
        if (name.includes('stack-shared') || name === '@stackframe/stack') return 0;
        if (name.includes('backend') || name.includes('dashboard')) return 1;
        if (name.includes('example')) return 3;
        return 2;
      };
      return getPackageType(a) - getPackageType(b);
    });
  }

  public async runInteractiveUpdate(): Promise<void> {
    try {
      console.log('🚀 Interactive Changelog Update\n');
      
      // Get version
      const version = await this.promptForVersion();
      
      // Get change type
      const type = await this.promptForChangeType();
      
      // Collect changes for all packages
      const allChanges = await this.collectAllChanges(version, type);
      
      // Confirm changes
      const confirmed = await this.confirmChanges(version, type, allChanges);
      
      if (confirmed) {
        this.addToChangelog(version, type, allChanges);
      } else {
        console.log('\n❌ Changes cancelled. Nothing was added to the changelog.');
      }
      
    } catch (error) {
      console.error('Error:', error);
    } finally {
      this.rl.close();
    }
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new ChangelogManager();
  manager.runInteractiveUpdate();
}

export { ChangelogManager };
