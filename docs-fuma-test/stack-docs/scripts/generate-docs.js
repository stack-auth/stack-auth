import fs from 'fs';
import pkg from 'glob';
import path from 'path';
import { fileURLToPath } from 'url';
const { glob } = pkg;

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure paths
const TEMPLATE_DIR = path.resolve(__dirname, '../templates');
const OUTPUT_BASE_DIR = path.resolve(__dirname, '../content/docs');
const PLATFORMS = ['next', 'react', 'js', 'python'];

// Platform folder naming
function getFolderName(platform) {
  return `pages-${platform}`;
}

// Platform-specific content markers
const PLATFORM_START_MARKER = /{\s*\/\*\s*IF_PLATFORM:\s*(\w+)\s*\*\/\s*}/;
const PLATFORM_ELSE_MARKER = /{\s*\/\*\s*ELSE_IF_PLATFORM\s+(\w+)\s*\*\/\s*}/;
const PLATFORM_END_MARKER = /{\s*\/\*\s*END_PLATFORM\s*\*\/\s*}/;

/**
 * Process a template file for a specific platform
 */
function processTemplateForPlatform(content, targetPlatform) {
  const lines = content.split('\n');
  let result = [];
  let currentPlatform = null;
  let isIncluding = true;
  let platformSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for platform start
    const startMatch = line.match(PLATFORM_START_MARKER);
    if (startMatch) {
      platformSection = true;
      currentPlatform = startMatch[1];
      isIncluding = currentPlatform === targetPlatform;
      continue;
    }

    // Check for platform else
    const elseMatch = line.match(PLATFORM_ELSE_MARKER);
    if (elseMatch && platformSection) {
      currentPlatform = elseMatch[1];
      isIncluding = currentPlatform === targetPlatform;
      continue;
    }

    // Check for platform end
    const endMatch = line.match(PLATFORM_END_MARKER);
    if (endMatch && platformSection) {
      platformSection = false;
      isIncluding = true;
      continue;
    }

    // Include the line if we're supposed to
    if (isIncluding) {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Generate meta.json files for Fumadocs navigation
 */
function generateMetaFiles() {
  // Create the root meta.json file - this is the only one we generate custom
  const rootMeta = {
    title: "Stack Auth Documentation",
    root: true,
    pages: PLATFORMS.map(platform => getFolderName(platform))
  };
  
  fs.writeFileSync(
    path.join(OUTPUT_BASE_DIR, 'meta.json'),
    JSON.stringify(rootMeta, null, 2)
  );
  
  console.log('Generated root meta.json');
  
  // Copy meta.json files for each platform
  for (const platform of PLATFORMS) {
    const folderName = getFolderName(platform);
    
    // Find all meta.json files in the template directory
    const metaFiles = glob.sync('**/meta.json', { cwd: TEMPLATE_DIR });
    
    for (const metaFile of metaFiles) {
      const srcPath = path.join(TEMPLATE_DIR, metaFile);
      const destPath = path.join(OUTPUT_BASE_DIR, folderName, metaFile);
      
      // Create directory if it doesn't exist
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      
      // Copy the file
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied meta.json: ${srcPath} -> ${destPath}`);
    }
  }
}

/**
 * Copy assets from template to platform-specific directories
 */
function copyAssets() {
  const assetDirs = ['imgs'];
  
  for (const dir of assetDirs) {
    const srcDir = path.join(TEMPLATE_DIR, dir);
    
    if (fs.existsSync(srcDir)) {
      // Copy assets to each platform directory
      for (const platform of PLATFORMS) {
        const folderName = getFolderName(platform);
        const destDir = path.join(OUTPUT_BASE_DIR, folderName, dir);
        fs.mkdirSync(destDir, { recursive: true });
        
        // Find and copy all files
        const files = glob.sync('**/*', { cwd: srcDir, nodir: true });
        for (const file of files) {
          const srcFile = path.join(srcDir, file);
          const destFile = path.join(destDir, file);
          fs.mkdirSync(path.dirname(destFile), { recursive: true });
          fs.copyFileSync(srcFile, destFile);
          console.log(`Copied asset: ${srcFile} -> ${destFile}`);
        }
      }
    }
  }
}

/**
 * Main function to generate platform-specific docs
 */
function generateDocs() {
  // Find all MDX files in the template directory
  const templateFiles = glob.sync('**/*.mdx', { cwd: TEMPLATE_DIR });
  
  if (templateFiles.length === 0) {
    console.warn(`No template files found in ${TEMPLATE_DIR}`);
    return;
  }

  console.log(`Found ${templateFiles.length} template files`);
  
  // Process for each platform
  for (const platform of PLATFORMS) {
    const folderName = getFolderName(platform);
    const outputDir = path.join(OUTPUT_BASE_DIR, folderName);
    
    // Create the output directory
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Process each template file
    for (const file of templateFiles) {
      const inputFile = path.join(TEMPLATE_DIR, file);
      const outputFile = path.join(outputDir, file);
      
      // Read the template
      const templateContent = fs.readFileSync(inputFile, 'utf8');
      
      // Process for this platform
      const processedContent = processTemplateForPlatform(templateContent, platform);
      
      // Create output directory if it doesn't exist
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      
      // Write the processed content
      fs.writeFileSync(outputFile, processedContent);
      
      console.log(`Generated: ${outputFile}`);
    }
  }
  
  // Generate meta.json files for navigation
  generateMetaFiles();
  
  // Copy assets (images, etc.)
  copyAssets();
  
  console.log('Documentation generation complete!');
}

// Run the generator
generateDocs(); 
