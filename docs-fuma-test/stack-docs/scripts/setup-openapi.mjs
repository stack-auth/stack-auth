import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runCommand(command, description) {
  console.log(`🔄 ${description}...`);
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log(`✅ ${description} completed successfully`);
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    throw error;
  }
}

async function setupOpenAPI() {
  console.log('🚀 Setting up OpenAPI documentation for Fumadocs...\n');

  try {
    // Step 1: Install dependencies if they don't exist
    console.log('📦 Installing dependencies...');
    await runCommand('npm install', 'Dependency installation');

    // Step 2: Generate OpenAPI schemas from backend
    console.log('\n📋 Generating OpenAPI schemas from backend...');
    await runCommand(
      'cd ../../../ && pnpm run generate-openapi-fumadocs',
      'OpenAPI schema generation'
    );

    // Step 3: Generate Fumadocs OpenAPI documentation
    console.log('\n📝 Generating Fumadocs OpenAPI documentation...');
    await runCommand(
      'npm run generate-openapi-docs',
      'Fumadocs OpenAPI documentation generation'
    );

    console.log('\n🎉 OpenAPI documentation setup complete!');
    console.log('📂 API documentation is now available in the Fumadocs project');
    console.log('🔥 Run `npm run dev` to start the development server and view the docs');
    
  } catch (error) {
    console.error('\n💥 Setup failed:', error.message);
    console.log('\n🔧 Troubleshooting steps:');
    console.log('1. Make sure you are in the correct directory');
    console.log('2. Ensure the backend is built and dependencies are installed');
    console.log('3. Check that the OpenAPI generation script ran successfully');
    process.exit(1);
  }
}

setupOpenAPI(); 
