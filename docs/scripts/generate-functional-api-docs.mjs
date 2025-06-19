import fs from 'fs';
import { generateFiles } from 'fumadocs-openapi';
import path from 'path';

// Use relative paths to avoid path duplication issues
const OPENAPI_DIR = './openapi';
const OUTPUT_DIR = './content/api';
const TEMPLATES_API_DIR = './templates-api';

// Define the functional tag order based on user requirements
const FUNCTIONAL_TAGS = [
  'Anonymous',
  'API Keys', 
  'CLI Authentication',
  'Contact Channels',
  'Oauth', // Note: OpenAPI uses "Oauth" not "OAuth"
  'OTP',
  'Password',
  'Permissions',
  'Projects', 
  'Sessions',
  'Teams',
  'Users',
  'Others' // For any miscellaneous endpoints
];

/**
 * Create a filtered OpenAPI spec containing only endpoints with the specified tag
 */
function createTagFilteredSpec(originalSpec, targetTag) {
  const filteredSpec = {
    ...originalSpec,
    paths: {},
    webhooks: {}
  };

  // Filter regular API paths
  if (originalSpec.paths) {
    for (const [path, methods] of Object.entries(originalSpec.paths)) {
      const filteredMethods = {};
      
      for (const [method, endpoint] of Object.entries(methods)) {
        if (endpoint.tags && endpoint.tags.includes(targetTag)) {
          filteredMethods[method] = endpoint;
        }
      }
      
      // Only include the path if it has methods with the target tag
      if (Object.keys(filteredMethods).length > 0) {
        filteredSpec.paths[path] = filteredMethods;
      }
    }
  }

  // Filter webhooks
  if (originalSpec.webhooks) {
    for (const [webhookName, methods] of Object.entries(originalSpec.webhooks)) {
      const filteredMethods = {};
      
      for (const [method, endpoint] of Object.entries(methods)) {
        if (endpoint.tags && endpoint.tags.includes(targetTag)) {
          filteredMethods[method] = endpoint;
        }
      }
      
      // Only include the webhook if it has methods with the target tag
      if (Object.keys(filteredMethods).length > 0) {
        filteredSpec.webhooks[webhookName] = filteredMethods;
      }
    }
  }

  return filteredSpec;
}

/**
 * Get all unique tags from an OpenAPI spec
 */
function extractTags(spec) {
  const tags = new Set();
  
  // Handle regular API paths
  if (spec.paths) {
    for (const methods of Object.values(spec.paths)) {
      for (const endpoint of Object.values(methods)) {
        if (endpoint.tags) {
          endpoint.tags.forEach(tag => tags.add(tag));
        }
      }
    }
  }
  
  // Handle webhooks (different structure)
  if (spec.webhooks) {
    for (const webhookMethods of Object.values(spec.webhooks)) {
      for (const endpoint of Object.values(webhookMethods)) {
        if (endpoint.tags) {
          endpoint.tags.forEach(tag => tags.add(tag));
        }
      }
    }
  }
  
  return Array.from(tags);
}

/**
 * Convert tag name to a URL-friendly slug
 */
function tagToSlug(tag) {
  return tag.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Convert tag name to a readable folder name
 */
function tagToFolderName(tag) {
  // Special case mappings
  const specialCases = {
    'Oauth': 'oauth',
    'API Keys': 'api-keys',
    'CLI Authentication': 'cli-authentication', 
    'Contact Channels': 'contact-channels',
    'OTP': 'otp'
  };
  
  return specialCases[tag] || tag.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Recursively find all MDX files in a directory
 */
function findMdxFiles(dir) {
  const files = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }
  
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...findMdxFiles(fullPath));
    } else if (item.endsWith('.mdx')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Flatten the generated file structure
 */
function flattenGeneratedFiles(functionalCategoryPath) {
  // Skip flattening - fumadocs expects the directory structure to match routing
  // The original nested structure from fumadocs-openapi is what we want to keep
  console.log(`   📁 Keeping original directory structure for ${functionalCategoryPath}`);
}

/**
 * Update document references in MDX files to point to permanent filtered OpenAPI files
 */
function updateDocumentReferences(functionalCategoryPath, newDocumentPath) {
  const mdxFiles = findMdxFiles(functionalCategoryPath);
  
  for (const filePath of mdxFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Update the document reference in the APIPage component
    // Match both old public/openapi paths and temp files
    const updatedContent = content.replace(
      /document=\{"(public\/openapi\/|openapi\/)[^"]+"\}/g,
      `document={"${newDocumentPath}"}`
    );
    
    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
      console.log(`   🔗 Updated document reference in ${path.basename(filePath)}`);
    }
  }
}

/**
 * Replace APIPage with EnhancedAPIPage in generated MDX files
 */
function replaceAPIPageWithEnhanced(functionalCategoryPath) {
  const mdxFiles = findMdxFiles(functionalCategoryPath);
  
  for (const filePath of mdxFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Replace APIPage with EnhancedAPIPage
    const updatedContent = content.replace(
      /<APIPage\s+/g,
      '<EnhancedAPIPage '
    );
    
    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
      console.log(`   🔄 Replaced APIPage with EnhancedAPIPage in ${path.basename(filePath)}`);
    }
  }
}

/**
 * Replace APIPage with WebhooksAPIPage in generated MDX files for webhooks
 */
function replaceAPIPageWithWebhooks(functionalCategoryPath) {
  const mdxFiles = findMdxFiles(functionalCategoryPath);
  
  for (const filePath of mdxFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Replace APIPage with WebhooksAPIPage
    const updatedContent = content.replace(
      /<APIPage\s+/g,
      '<WebhooksAPIPage '
    );
    
    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
      console.log(`   🔄 Replaced APIPage with WebhooksAPIPage in ${path.basename(filePath)}`);
    }
  }
}

/**
 * Add description prop to EnhancedAPIPage components from frontmatter
 */
function addDescriptionToEnhancedAPIPage(functionalCategoryPath) {
  const mdxFiles = findMdxFiles(functionalCategoryPath);
  
  for (const filePath of mdxFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract description from frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) continue;
    
    const frontmatterContent = frontmatterMatch[1];
    let description = null;
    
    // Handle multiline YAML descriptions (">-" or ">" syntax)
    if (frontmatterContent.includes('description: >')) {
      // Extract multiline description
      const multilineMatch = frontmatterContent.match(/description:\s*>-?\s*\n((?:\s{2,}.*\n?)*)/);
      if (multilineMatch) {
        // Join the indented lines and clean up
        description = multilineMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s{2,}/, '')) // Remove leading indentation
          .filter(line => line.trim()) // Remove empty lines
          .join(' ')
          .trim();
      }
    } else {
      // Handle single-line descriptions
      const singleLineMatch = frontmatterContent.match(/description:\s*['"]?([^'"]+?)['"]?\s*$/m);
      if (singleLineMatch) {
        description = singleLineMatch[1].trim();
      }
    }
    
    if (!description) continue;
    
    // Add description prop to EnhancedAPIPage if not already present
    const updatedContent = content.replace(
      /(<EnhancedAPIPage[^>]*?)(\s+\/?>)/g,
      (match, componentStart, componentEnd) => {
        // Check if description prop already exists
        if (componentStart.includes('description=')) {
          return match;
        }
        // Add description prop
        return `${componentStart} description={"${description.replace(/"/g, '\\"')}"}${componentEnd}`;
      }
    );
    
    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
      console.log(`   📝 Added description prop to EnhancedAPIPage in ${path.basename(filePath)}`);
    }
  }
}

/**
 * Add description prop to WebhooksAPIPage components from frontmatter
 */
function addDescriptionToWebhooksAPIPage(functionalCategoryPath) {
  const mdxFiles = findMdxFiles(functionalCategoryPath);
  
  for (const filePath of mdxFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract description from frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) continue;
    
    const frontmatterContent = frontmatterMatch[1];
    let description = null;
    
    // Handle multiline YAML descriptions (">-" or ">" syntax)
    if (frontmatterContent.includes('description: >')) {
      // Extract multiline description
      const multilineMatch = frontmatterContent.match(/description:\s*>-?\s*\n((?:\s{2,}.*\n?)*)/);
      if (multilineMatch) {
        // Join the indented lines and clean up
        description = multilineMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s{2,}/, '')) // Remove leading indentation
          .filter(line => line.trim()) // Remove empty lines
          .join(' ')
          .trim();
      }
    } else {
      // Handle single-line descriptions
      const singleLineMatch = frontmatterContent.match(/description:\s*['"]?([^'"]+?)['"]?\s*$/m);
      if (singleLineMatch) {
        description = singleLineMatch[1].trim();
      }
    }
    
    if (!description) continue;
    
    // Add description prop to WebhooksAPIPage if not already present
    const updatedContent = content.replace(
      /(<WebhooksAPIPage[^>]*?)(\s+\/?>)/g,
      (match, componentStart, componentEnd) => {
        // Check if description prop already exists
        if (componentStart.includes('description=')) {
          return match;
        }
        // Add description prop
        return `${componentStart} description={"${description.replace(/"/g, '\\"')}"}${componentEnd}`;
      }
    );
    
    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
      console.log(`   📝 Added description prop to WebhooksAPIPage in ${path.basename(filePath)}`);
    }
  }
}

/**
 * Copy the API overview page from template
 */
function copyAPIOverviewFromTemplate() {
  console.log('📄 Copying API overview page from template...');
  
  const templatePath = path.join(TEMPLATES_API_DIR, 'overview.mdx');
  const outputPath = path.join(OUTPUT_DIR, 'overview.mdx');
  
  if (!fs.existsSync(templatePath)) {
    console.error(`❌ Template file not found: ${templatePath}`);
    console.log('   Please create the template file first.');
    return;
  }
  
  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  
  // Copy the template file
  fs.copyFileSync(templatePath, outputPath);
  console.log('✅ Copied API overview page from template');
}

async function generateFunctionalAPIDocs() {
  console.log('🚀 Starting functional OpenAPI documentation generation...\n');
  
  // Ensure the OpenAPI directory exists
  if (!fs.existsSync(OPENAPI_DIR)) {
    console.log('Creating OpenAPI directory...');
    fs.mkdirSync(OPENAPI_DIR, { recursive: true });
  }

  // Process each API type in complete isolation to avoid fumadocs conflicts
  const apiTypes = ['client', 'server', 'admin', 'webhooks'];

  for (const apiType of apiTypes) {
    await processApiTypeInIsolation(apiType);
  }

  // Copy API overview page from template
  copyAPIOverviewFromTemplate();

  // Generate main API meta.json
  console.log('📁 Generating main API navigation...');
  const mainApiMetaPath = path.join(OUTPUT_DIR, 'meta.json');
  const mainApiMeta = {
    pages: [
      'overview',
      'client',
      'server', 
      'admin',
      'webhooks'
    ]
  };

  fs.writeFileSync(mainApiMetaPath, JSON.stringify(mainApiMeta, null, 2));
  console.log('✅ Generated main API meta.json');

  console.log('\n🎉 Functional OpenAPI documentation generation complete!');
  console.log(`📂 Documentation generated in: ${path.resolve(OUTPUT_DIR)}/`);
  console.log('\n📋 Structure:');
  console.log('   /overview.mdx');
  console.log('   /client/{functional-categories}/');
  console.log('   /server/{functional-categories}/');
  console.log('   /admin/{functional-categories}/');
  console.log('   /webhooks/');
}

/**
 * Process a single API type in complete isolation
 */
async function processApiTypeInIsolation(apiType) {
    const jsonFile = path.join(OPENAPI_DIR, `${apiType}.json`);
    
    if (!fs.existsSync(jsonFile)) {
      console.log(`⚠️  OpenAPI file not found: ${jsonFile}`);
      console.log(`   Run 'pnpm run generate-openapi-fumadocs' from the root to generate OpenAPI schemas first.`);
    return;
    }

  console.log(`🔄 Processing ${apiType} API in isolation...`);
    
    // Read and parse the OpenAPI spec
    const originalSpec = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    
    // Extract all tags from this API
    const availableTags = extractTags(originalSpec);
  console.log(`   📋 Found tags: ${availableTags.join(', ')}`);
    
  // Process each functional tag for this API type
  const processedTags = [];
    for (const tag of FUNCTIONAL_TAGS) {
      if (!availableTags.includes(tag)) {
        continue; // Skip tags not present in this API
      }
      
      console.log(`   📄 Generating docs for ${tag}...`);
      
      // Create filtered spec for this tag
      const tagFilteredSpec = createTagFilteredSpec(originalSpec, tag);
      
      // Create temporary file for this tag's spec
      const tempSpecPath = path.join(OPENAPI_DIR, `temp-${apiType}-${tagToSlug(tag)}.json`);
      fs.writeFileSync(tempSpecPath, JSON.stringify(tagFilteredSpec, null, 2));
      
      try {
      // Generate docs for this tag in isolation
        const outputPath = path.join(OUTPUT_DIR, apiType, tagToFolderName(tag));
        
        // Create permanent filtered OpenAPI file
        const permanentSpecPath = path.join(OPENAPI_DIR, `${apiType}-${tagToSlug(tag)}.json`);
        fs.writeFileSync(permanentSpecPath, JSON.stringify(tagFilteredSpec, null, 2));
        
      // Process this tag completely in isolation - no fumadocs state shared between calls
        await generateFiles({
          input: [tempSpecPath],
          output: outputPath,
          includeDescription: false,
          frontmatter: (title, description) => ({
            title,
            description,
            full: true, // Use full-width layout for API docs
          }),
        });

        console.log(`   ✅ Generated ${tag} docs for ${apiType}`);
      processedTags.push(tag);
        
      // Keep original directory structure for proper fumadocs routing
        flattenGeneratedFiles(outputPath);
        
        // Update document references in MDX files
        console.log(`   🔗 Updating document references for ${tag}...`);
        updateDocumentReferences(outputPath, `openapi/${apiType}-${tagToSlug(tag)}.json`);
        
        // Replace APIPage with appropriate component based on API type
        if (apiType === 'webhooks') {
          console.log(`   🔄 Replacing APIPage with WebhooksAPIPage for ${tag}...`);
          replaceAPIPageWithWebhooks(outputPath);
          
          // Add description prop to WebhooksAPIPage
          console.log(`   📝 Adding description prop to WebhooksAPIPage for ${tag}...`);
          addDescriptionToWebhooksAPIPage(outputPath);
        } else {
          console.log(`   🔄 Replacing APIPage with EnhancedAPIPage for ${tag}...`);
          replaceAPIPageWithEnhanced(outputPath);
          
          // Add description prop to EnhancedAPIPage
          console.log(`   📝 Adding description prop to EnhancedAPIPage for ${tag}...`);
          addDescriptionToEnhancedAPIPage(outputPath);
        }
        
      } catch (error) {
        console.error(`   ❌ Error generating ${tag} docs for ${apiType}:`, error);
      } finally {
        // Clean up temporary file
        if (fs.existsSync(tempSpecPath)) {
          fs.unlinkSync(tempSpecPath);
        }
      }
    }

  // Generate meta.json for this API type
  if (processedTags.length > 0) {
    console.log(`   📁 Generating navigation meta for ${apiType}...`);
    
    const apiMetaPath = path.join(OUTPUT_DIR, apiType, 'meta.json');
    const apiMeta = {
      pages: processedTags.map(tag => tagToFolderName(tag))
    };

    fs.mkdirSync(path.dirname(apiMetaPath), { recursive: true });
    fs.writeFileSync(apiMetaPath, JSON.stringify(apiMeta, null, 2));
    
    console.log(`   ✅ Generated meta.json for ${apiType} API`);
  }

  console.log(`🎯 Completed ${apiType} API processing (${processedTags.length} functional categories)\n`);
}

// Run the generator
generateFunctionalAPIDocs().catch((error) => {
  console.error('❌ Failed to generate functional API documentation:', error);
  process.exit(1);
}); 
