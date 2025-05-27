import fs from 'fs';
import { generateFiles } from 'fumadocs-openapi';
import path from 'path';

// Use relative paths to avoid path duplication issues
const OPENAPI_DIR = './public/openapi';
const OUTPUT_DIR = './content/docs';

async function generateOpenAPIDocs() {
  console.log('Starting Fumadocs OpenAPI documentation generation...');
  
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

    console.log(`📝 Generating docs for ${apiType} API...`);

    try {
      await generateFiles({
        input: [jsonFile],
        output: path.join(OUTPUT_DIR, 'api', apiType),
        includeDescription: true,
        frontmatter: (title, description) => ({
          title,
          description,
          full: true, // Use full-width layout for API docs
        }),
      });

      console.log(`✅ Successfully generated ${apiType} API documentation`);
    } catch (error) {
      console.error(`❌ Error generating ${apiType} API documentation:`, error);
    }
  }

  // Generate meta.json for API section navigation
  const apiMetaPath = path.join(OUTPUT_DIR, 'api', 'meta.json');
  const apiMeta = {
    pages: [
      'client',
      'server',
      'webhooks'
    ]
  };

  fs.mkdirSync(path.dirname(apiMetaPath), { recursive: true });
  fs.writeFileSync(apiMetaPath, JSON.stringify(apiMeta, null, 2));
  
  console.log('🎉 Fumadocs OpenAPI documentation generation complete!');
  console.log(`📂 Documentation generated in: ${path.resolve(OUTPUT_DIR)}/api/`);
}

// Run the generator
generateOpenAPIDocs().catch((error) => {
  console.error('❌ Failed to generate OpenAPI documentation:', error);
  process.exit(1);
}); 
