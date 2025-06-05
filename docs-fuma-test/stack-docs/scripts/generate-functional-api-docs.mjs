import fs from 'fs';
import { generateFiles } from 'fumadocs-openapi';
import path from 'path';

// Use relative paths to avoid path duplication issues
const OPENAPI_DIR = './public/openapi';
const OUTPUT_DIR = './content/docs';

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
  const mdxFiles = findMdxFiles(functionalCategoryPath);
  
  for (const filePath of mdxFiles) {
    // Get the filename
    const fileName = path.basename(filePath);
    
    // Skip if it's already at the root level of the functional category
    const relativePath = path.relative(functionalCategoryPath, filePath);
    if (!relativePath.includes('/')) {
      continue; // Already flat
    }
    
    // Create a flattened name by using the directory structure
    const pathParts = relativePath.split('/');
    pathParts.pop(); // Remove the filename
    
    // Create a meaningful filename from the path structure
    let flattenedName;
    if (pathParts.length > 0) {
      const baseName = path.basename(fileName, '.mdx');
      
      // If the filename is generic (like 'get.mdx', 'post.mdx'), use more context
      if (['get', 'post', 'patch', 'delete', 'put'].includes(baseName)) {
        // Use the parent directory name + HTTP method
        const parentDir = pathParts[pathParts.length - 1].replace(/_/g, '-');
        flattenedName = `${parentDir}-${baseName}.mdx`;
      } else {
        flattenedName = fileName;
      }
    } else {
      flattenedName = fileName;
    }
    
    // Ensure unique filename
    const targetPath = path.join(functionalCategoryPath, flattenedName);
    let finalTargetPath = targetPath;
    let counter = 1;
    
    while (fs.existsSync(finalTargetPath) && finalTargetPath !== filePath) {
      const baseName = path.basename(flattenedName, '.mdx');
      finalTargetPath = path.join(functionalCategoryPath, `${baseName}-${counter}.mdx`);
      counter++;
    }
    
    // Move the file
    if (finalTargetPath !== filePath) {
      console.log(`   📁 Moving ${path.relative(functionalCategoryPath, filePath)} → ${path.basename(finalTargetPath)}`);
      fs.renameSync(filePath, finalTargetPath);
    }
  }
  
  // Clean up empty directories
  cleanupEmptyDirectories(functionalCategoryPath);
}

/**
 * Remove empty directories recursively
 */
function cleanupEmptyDirectories(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      cleanupEmptyDirectories(fullPath);
      
      // Check if directory is now empty
      if (fs.readdirSync(fullPath).length === 0) {
        fs.rmdirSync(fullPath);
        console.log(`   🗑️  Removed empty directory: ${path.relative(dir, fullPath)}`);
      }
    }
  }
}

/**
 * Update document references in MDX files to point to permanent filtered OpenAPI files
 */
function updateDocumentReferences(functionalCategoryPath, newDocumentPath) {
  const mdxFiles = findMdxFiles(functionalCategoryPath);
  
  for (const filePath of mdxFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Update the document reference in the APIPage component
    const updatedContent = content.replace(
      /document=\{"public\/openapi\/temp-[^"]+"\}/g,
      `document={"${newDocumentPath}"}`
    );
    
    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
      console.log(`   🔗 Updated document reference in ${path.basename(filePath)}`);
    }
  }
}

async function generateFunctionalAPIDocs() {
  console.log('🚀 Starting functional OpenAPI documentation generation...\n');
  
  // Ensure the OpenAPI directory exists
  if (!fs.existsSync(OPENAPI_DIR)) {
    console.log('Creating OpenAPI directory...');
    fs.mkdirSync(OPENAPI_DIR, { recursive: true });
  }

  // List of API types to generate docs for
  const apiTypes = ['client', 'server', 'admin', 'webhooks'];

  for (const apiType of apiTypes) {
    const jsonFile = path.join(OPENAPI_DIR, `${apiType}.json`);
    
    if (!fs.existsSync(jsonFile)) {
      console.log(`⚠️  OpenAPI file not found: ${jsonFile}`);
      console.log(`   Run 'pnpm run generate-openapi-fumadocs' from the root to generate OpenAPI schemas first.`);
      continue;
    }

    console.log(`📝 Processing ${apiType} API...`);
    
    // Read and parse the OpenAPI spec
    const originalSpec = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    
    // Extract all tags from this API
    const availableTags = extractTags(originalSpec);
    console.log(`   Found tags: ${availableTags.join(', ')}`);
    
    // Generate docs for each functional tag
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
        // Generate docs for this tag
        const outputPath = path.join(OUTPUT_DIR, 'api', apiType, tagToFolderName(tag));
        
        // Create permanent filtered OpenAPI file
        const permanentSpecPath = path.join(OPENAPI_DIR, `${apiType}-${tagToSlug(tag)}.json`);
        fs.writeFileSync(permanentSpecPath, JSON.stringify(tagFilteredSpec, null, 2));
        
        await generateFiles({
          input: [tempSpecPath],
          output: outputPath,
          includeDescription: true,
          frontmatter: (title, description) => ({
            title,
            description,
            full: true, // Use full-width layout for API docs
          }),
        });

        console.log(`   ✅ Generated ${tag} docs for ${apiType}`);
        
        // Flatten the generated file structure
        console.log(`   🔄 Flattening file structure for ${tag}...`);
        flattenGeneratedFiles(outputPath);
        
        // Update document references in MDX files
        console.log(`   🔗 Updating document references for ${tag}...`);
        updateDocumentReferences(outputPath, `public/openapi/${apiType}-${tagToSlug(tag)}.json`);
        
      } catch (error) {
        console.error(`   ❌ Error generating ${tag} docs for ${apiType}:`, error);
      } finally {
        // Clean up temporary file
        if (fs.existsSync(tempSpecPath)) {
          fs.unlinkSync(tempSpecPath);
        }
      }
    }
  }

  // Generate meta.json files for each API type
  console.log('\n📁 Generating navigation meta files...');
  
  for (const apiType of apiTypes) {
    const jsonFile = path.join(OPENAPI_DIR, `${apiType}.json`);
    
    if (!fs.existsSync(jsonFile)) {
      continue;
    }
    
    const originalSpec = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const availableTags = extractTags(originalSpec);
    
    // Create meta.json with functional tag organization
    const apiMetaPath = path.join(OUTPUT_DIR, 'api', apiType, 'meta.json');
    const apiMeta = {
      pages: FUNCTIONAL_TAGS
        .filter(tag => availableTags.includes(tag))
        .map(tag => tagToFolderName(tag))
    };

    fs.mkdirSync(path.dirname(apiMetaPath), { recursive: true });
    fs.writeFileSync(apiMetaPath, JSON.stringify(apiMeta, null, 2));
    
    console.log(`✅ Generated meta.json for ${apiType} API`);
  }

  // Generate main API meta.json
  const mainApiMetaPath = path.join(OUTPUT_DIR, 'api', 'meta.json');
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
  
  console.log('\n🎉 Functional OpenAPI documentation generation complete!');
  console.log(`📂 Documentation generated in: ${path.resolve(OUTPUT_DIR)}/api/`);
  console.log('\n📋 Structure:');
  console.log('   /api/overview.mdx');
  console.log('   /api/client/{functional-categories}/');
  console.log('   /api/server/{functional-categories}/');
  console.log('   /api/admin/{functional-categories}/');
  console.log('   /api/webhooks/');
}

// Run the generator
generateFunctionalAPIDocs().catch((error) => {
  console.error('❌ Failed to generate functional API documentation:', error);
  process.exit(1);
}); 
