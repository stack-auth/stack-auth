#!/usr/bin/env node
import * as fs from 'fs';
import * as readline from 'readline';

class InteractiveChangelogManager {
  private masterChangelogPath = 'CHANGELOG.md';
  private rl: readline.Interface;
  
  // List of all packages in the monorepo
  private packages = [
    '@stackframe/stack',
    '@stackframe/stack-shared',
    '@stackframe/stack-ui',
    '@stackframe/stack-sc',
    '@stackframe/stack-emails',
    '@stackframe/stack-backend',
    '@stackframe/stack-dashboard',
    '@stackframe/stack-docs',
    '@stackframe/react',
    '@stackframe/js',
    '@stackframe/init-stack',
    '@stackframe/template',
    '@stackframe/e2e',
    '@stackframe/mcp-server',
    '@stackframe/mock-oauth-server',
    '@stackframe/dev-launchpad',
    // Examples
    '@stackframe/example-demo-app',
    '@stackframe/docs-examples',
    '@stackframe/example-middleware-demo',
    '@stackframe/cjs-test',
    '@stackframe/js-example',
    '@stackframe/react-example',
    '@stackframe/supabase-example',
    '@stackframe/e-commerce-example',
    '@stackframe/partial-prerendering-example'
  ];

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
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
if (require.main === module) {
  const manager = new InteractiveChangelogManager();
  manager.runInteractiveUpdate();
}

export { InteractiveChangelogManager };
