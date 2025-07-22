import fs from 'fs';
import { glob } from 'glob';
import yaml from 'js-yaml';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure paths
const TEMPLATE_DIR = path.resolve(__dirname, '../templates');
const PYTHON_TEMPLATE_DIR = path.resolve(__dirname, '../templates-python');
const OUTPUT_BASE_DIR = path.resolve(__dirname, '../content/docs');
const CONFIG_FILE = path.resolve(__dirname, '../docs-platform.yml');
const PLATFORMS = ['next', 'react', 'js', 'python'];

// Platform groups mapping
const PLATFORM_GROUPS = {
  'react-like': ['next', 'react'],  // Platforms that use React components
  'js-like': ['next', 'react', 'js']  // Platforms that use JavaScript SDK (includes React-based platforms)
};

// Load platform configuration
let platformConfig = {};
try {
  const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
  platformConfig = yaml.load(configContent);
  console.log('Loaded platform configuration from docs-platform.yml');
} catch (error) {
  console.error('Failed to load platform configuration:', error.message);
  console.log('Falling back to include all files for all platforms');
}

// Platform folder naming - now using root folders
function getFolderName(platform) {
  return platform; // Use direct platform names instead of pages-{platform}
}

// Platform display names
function getPlatformDisplayName(platform) {
  const platformNames = {
    'next': 'Next.js',
    'react': 'React',
    'js': 'JavaScript',
    'python': 'Python'
  };
  return platformNames[platform] || platform;
}

// Platform-specific content markers - Updated regex to handle both syntaxes (with and without colon)
const PLATFORM_START_MARKER = /{\s*\/\*\s*IF_PLATFORM:?\s*([\w-]+)\s*\*\/\s*}/;
const PLATFORM_ELSE_MARKER = /{\s*\/\*\s*ELSE_IF_PLATFORM:?\s+([\w-]+)\s*\*\/\s*}/;
const PLATFORM_END_MARKER = /{\s*\/\*\s*END_PLATFORM\s*\*\/\s*}/;

/**
 * Check if a platform or platform group includes the target platform
 */
function isPlatformMatch(platformSpec, targetPlatform) {
  // Direct platform match
  if (platformSpec === targetPlatform) {
    return true;
  }

  // Platform group match
  if (PLATFORM_GROUPS[platformSpec]) {
    return PLATFORM_GROUPS[platformSpec].includes(targetPlatform);
  }

  return false;
}

/**
 * Check if a file should be included for a specific platform
 */
function shouldIncludeFileForPlatform(platform, filePath) {
  // If no configuration loaded, include everything
  if (!platformConfig.pages) {
    return true;
  }

  // Find the page configuration for this file
  const pageConfig = platformConfig.pages.find(page => page.path === filePath);

  // If no specific configuration found, exclude by default
  if (!pageConfig) {
    console.log(`No configuration found for ${filePath}, excluding by default`);
    return false;
  }

  // Check if the platform is in the allowed list
  return pageConfig.platforms.includes(platform);
}

/**
 * Process a template file for a specific platform
 */
function processTemplateForPlatform(content, targetPlatform) {
  const lines = content.split('\n');
  let result = [];
  let currentPlatformSpec = null;
  let isIncluding = true;
  let platformSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for platform start
    const startMatch = line.match(PLATFORM_START_MARKER);
    if (startMatch) {
      platformSection = true;
      currentPlatformSpec = startMatch[1];
      isIncluding = isPlatformMatch(currentPlatformSpec, targetPlatform);
      continue;
    }

    // Check for platform else
    const elseMatch = line.match(PLATFORM_ELSE_MARKER);
    if (elseMatch && platformSection) {
      currentPlatformSpec = elseMatch[1];
      isIncluding = isPlatformMatch(currentPlatformSpec, targetPlatform);
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
  // Process meta.json files for each platform from templates
  for (const platform of PLATFORMS) {
    const folderName = getFolderName(platform);
    const platformDisplayName = getPlatformDisplayName(platform);

    // For Python platform, prioritize Python-specific templates, but also include shared templates
    const templateDir = (platform === 'python' && fs.existsSync(PYTHON_TEMPLATE_DIR)) ? PYTHON_TEMPLATE_DIR : TEMPLATE_DIR;

    // Find all meta.json files in the appropriate template directory
    const metaFiles = glob.sync('**/meta.json', { cwd: templateDir });

    // For Python, also get meta.json files from shared templates (excluding root meta.json to avoid conflicts)
    let sharedMetaFiles = [];
    if (platform === 'python' && fs.existsSync(PYTHON_TEMPLATE_DIR)) {
      sharedMetaFiles = glob.sync('**/meta.json', { cwd: TEMPLATE_DIR }).filter(file => file !== 'meta.json');
    }

    // Process Python-specific meta files
    for (const metaFile of metaFiles) {
      const srcPath = path.join(templateDir, metaFile);
      const destPath = path.join(OUTPUT_BASE_DIR, folderName, metaFile);

      // If this is a nested meta.json (not root), check if the folder should exist for this platform
      if (metaFile !== 'meta.json') {
        const folderPath = path.dirname(metaFile);

        // Check if any pages in this folder are included for this platform
        const hasContentInFolder = platformConfig.pages && platformConfig.pages.some(configPage =>
          configPage.path.startsWith(`${folderPath}/`) &&
          configPage.platforms.includes(platform)
        );

        if (!hasContentInFolder) {
          console.log(`Skipped meta.json for ${folderPath} (no content for ${platform})`);
          continue; // Skip this meta.json file
        }
      }

      // Read and parse the template meta.json
      const templateContent = fs.readFileSync(srcPath, 'utf8');
      const metaData = JSON.parse(templateContent);

      // If this is the root meta.json, customize it for the platform
      if (metaFile === 'meta.json') {
        metaData.title = platformDisplayName;
        metaData.description = `Stack Auth for ${platformDisplayName} applications`;
        metaData.root = true;

        // Filter pages based on platform configuration
        if (platformConfig.pages && metaData.pages) {
          const cleanedPages = [];
          let currentSectionPages = [];
          let currentSectionHeader = null;

          for (let i = 0; i < metaData.pages.length; i++) {
            const page = metaData.pages[i];

            // If this is a section divider
            if (typeof page === 'string' && page.startsWith('---')) {
              // Process the previous section first (or pages before first section)
              if (currentSectionPages.length > 0) {
                if (currentSectionHeader !== null) {
                  // Add section header if we had one
                  cleanedPages.push(currentSectionHeader);
                }
                cleanedPages.push(...currentSectionPages);
              }

              // Start new section
              currentSectionHeader = page;
              currentSectionPages = [];
            }
            // If this is a folder reference (like "...customization")
            else if (typeof page === 'string' && page.startsWith('...')) {
              // Only include folder references if they have content for this platform
              const folderName = page.substring(3); // Remove "..."
              const hasContentInFolder = platformConfig.pages.some(configPage =>
                configPage.path.startsWith(`${folderName}/`) &&
                configPage.platforms.includes(platform)
              );

              if (hasContentInFolder) {
                currentSectionPages.push(page);
              }
            }
            // Regular page
            else {
              // Check if this is actually a folder reference vs a page reference
              // Check both template directories for Python
              let folderPath = path.join(templateDir, page);
              let isActualFolder = fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory();

              // For Python, also check shared templates directory
              if (!isActualFolder && platform === 'python') {
                folderPath = path.join(TEMPLATE_DIR, page);
                isActualFolder = fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory();
              }

              if (isActualFolder) {
                // This is a folder reference - check if folder has content for this platform
                const hasContentInFolder = platformConfig.pages.some(configPage =>
                  configPage.path.startsWith(`${page}/`) &&
                  configPage.platforms.includes(platform)
                );

                if (hasContentInFolder) {
                  currentSectionPages.push(page);
                }
              } else {
                // This is a regular page reference
                const pagePath = `${page}.mdx`;
                const shouldInclude = shouldIncludeFileForPlatform(platform, pagePath);
                if (shouldInclude) {
                  currentSectionPages.push(page);
                }
              }
            }
          }

          // Don't forget the last section (or remaining pages)
          if (currentSectionPages.length > 0) {
            if (currentSectionHeader !== null) {
              cleanedPages.push(currentSectionHeader);
            }
            cleanedPages.push(...currentSectionPages);
          }

          metaData.pages = cleanedPages;
        }
      }

      // Create directory if it doesn't exist
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      // Write the processed meta.json
      fs.writeFileSync(destPath, JSON.stringify(metaData, null, 2));
      console.log(`Generated platform-specific meta.json for ${platform}: ${destPath}`);
    }

    // For Python, also process shared meta.json files (but not root)
    for (const metaFile of sharedMetaFiles) {
      const folderPath = path.dirname(metaFile);

      // Check if any pages in this folder are included for Python
      const hasContentInFolder = platformConfig.pages && platformConfig.pages.some(configPage =>
        configPage.path.startsWith(`${folderPath}/`) &&
        configPage.platforms.includes(platform)
      );

      if (hasContentInFolder) {
        const srcPath = path.join(TEMPLATE_DIR, metaFile);
        const destPath = path.join(OUTPUT_BASE_DIR, folderName, metaFile);

        // Read and copy the shared meta.json
        const templateContent = fs.readFileSync(srcPath, 'utf8');

        // Create directory if it doesn't exist
        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        // Write the shared meta.json
        fs.writeFileSync(destPath, templateContent);
        console.log(`Generated shared meta.json for ${platform}: ${destPath}`);
      }
    }
  }
}

/**
 * Copy assets from template to platform-specific directories
 */
function copyAssets() {
  const assetDirs = ['imgs'];

  // Copy assets from main templates directory
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

  // Copy Python-specific assets if they exist
  if (fs.existsSync(PYTHON_TEMPLATE_DIR)) {
    for (const dir of assetDirs) {
      const srcDir = path.join(PYTHON_TEMPLATE_DIR, dir);

      if (fs.existsSync(srcDir)) {
        const destDir = path.join(OUTPUT_BASE_DIR, 'python', dir);
        fs.mkdirSync(destDir, { recursive: true });

        // Find and copy all files
        const files = glob.sync('**/*', { cwd: srcDir, nodir: true });
        for (const file of files) {
          const srcFile = path.join(srcDir, file);
          const destFile = path.join(destDir, file);
          fs.mkdirSync(path.dirname(destFile), { recursive: true });
          fs.copyFileSync(srcFile, destFile);
          console.log(`Copied Python-specific asset: ${srcFile} -> ${destFile}`);
        }
      }
    }
  }
}

/**
 * Main function to generate platform-specific docs
 */
function generateDocs() {
  // Find all MDX files in the main template directory
  const templateFiles = glob.sync('**/*.mdx', { cwd: TEMPLATE_DIR });

  if (templateFiles.length === 0) {
    console.warn(`No template files found in ${TEMPLATE_DIR}`);
    return;
  }

  console.log(`Found ${templateFiles.length} shared template files`);

  // Process shared templates for each platform
  for (const platform of PLATFORMS) {
    const folderName = getFolderName(platform);
    const outputDir = path.join(OUTPUT_BASE_DIR, folderName);

    // Create the output directory
    fs.mkdirSync(outputDir, { recursive: true });

    // Process each shared template file
    for (const file of templateFiles) {
      // Check if this file should be included for this platform
      if (!shouldIncludeFileForPlatform(platform, file)) {
        console.log(`Skipped file (not configured for platform): ${file} for ${platform}`);
        continue;
      }

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

  // Process Python-specific templates if they exist
  if (fs.existsSync(PYTHON_TEMPLATE_DIR)) {
    console.log(`Processing Python-specific templates from ${PYTHON_TEMPLATE_DIR}`);
    const pythonTemplateFiles = glob.sync('**/*.mdx', { cwd: PYTHON_TEMPLATE_DIR });

    if (pythonTemplateFiles.length > 0) {
      const pythonOutputDir = path.join(OUTPUT_BASE_DIR, 'python');

      for (const file of pythonTemplateFiles) {
        const inputFile = path.join(PYTHON_TEMPLATE_DIR, file);
        const outputFile = path.join(pythonOutputDir, file);

        // Read the Python-specific template
        const templateContent = fs.readFileSync(inputFile, 'utf8');

        // Create output directory if it doesn't exist
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });

        // Write the content (no platform processing needed for Python-specific files)
        fs.writeFileSync(outputFile, templateContent);

        console.log(`Generated Python-specific: ${outputFile}`);
      }
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
