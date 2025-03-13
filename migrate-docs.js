const fs = require('fs');
const path = require('path');

// Source directories
const sourceDirectories = [
  'docs/fern/docs/pages-next',
  'docs/fern/docs/pages-react',
  'docs/fern/docs/pages-js',
  'docs/fern/docs/pages-python',
  'docs/fern/docs/pages-template'
];

// Target directory
const targetDirectory = 'fuma/content/docs';

// Create target directory if it doesn't exist
if (!fs.existsSync(targetDirectory)) {
  fs.mkdirSync(targetDirectory, { recursive: true });
}

// Copy assets directory
if (fs.existsSync('docs/fern/docs/assets')) {
  fs.cpSync('docs/fern/docs/assets', `${targetDirectory}/assets`, { recursive: true });
}

// Process each source directory
sourceDirectories.forEach(sourceDir => {
  const frameworkName = sourceDir.split('/').pop().replace('pages-', '');
  const targetFrameworkDir = `${targetDirectory}/${frameworkName}`;
  
  // Create framework directory
  if (!fs.existsSync(targetFrameworkDir)) {
    fs.mkdirSync(targetFrameworkDir, { recursive: true });
  }
  
  // Process files recursively
  processDirectory(sourceDir, targetFrameworkDir, frameworkName);
});

function processDirectory(sourceDir, targetDir, frameworkName) {
  if (!fs.existsSync(sourceDir)) return;
  
  const items = fs.readdirSync(sourceDir, { withFileTypes: true });
  
  items.forEach(item => {
    const sourcePath = path.join(sourceDir, item.name);
    const targetPath = path.join(targetDir, item.name);
    
    if (item.isDirectory()) {
      // Create target directory
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      
      // Process subdirectory
      processDirectory(sourcePath, targetPath, frameworkName);
    } else if (item.name.endsWith('.mdx') || item.name.endsWith('.md')) {
      // Process MDX file
      processMdxFile(sourcePath, targetPath, frameworkName);
    } else {
      // Copy other files (images, etc.)
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
}

function processMdxFile(sourcePath, targetPath, frameworkName) {
  let content = fs.readFileSync(sourcePath, 'utf8');
  
  // Update frontmatter
  content = updateFrontmatter(content, frameworkName, sourcePath);
  
  // Update internal links
  content = updateInternalLinks(content, frameworkName);
  
  // Update custom components if needed
  content = updateCustomComponents(content);
  
  // Write the processed file
  fs.writeFileSync(targetPath, content);
  console.log(`Processed: ${targetPath}`);
}

function updateFrontmatter(content, frameworkName, sourcePath) {
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return content;
  
  const frontmatter = frontmatterMatch[1];
  const frontmatterLines = frontmatter.split('\n');
  
  // Process frontmatter lines
  const newFrontmatterLines = [];
  let hasTitle = false;
  let hasDescription = false;
  
  frontmatterLines.forEach(line => {
    if (line.startsWith('slug:')) {
      // Skip slug as Fumadocs uses file path
    } else if (line.startsWith('title:')) {
      hasTitle = true;
      newFrontmatterLines.push(line);
    } else if (line.startsWith('subtitle:')) {
      hasDescription = true;
      newFrontmatterLines.push(line.replace('subtitle:', 'description:'));
    } else {
      newFrontmatterLines.push(line);
    }
  });
  
  // Add title if missing
  if (!hasTitle) {
    const filename = path.basename(sourcePath, path.extname(sourcePath));
    newFrontmatterLines.push(`title: ${filename.charAt(0).toUpperCase() + filename.slice(1)}`);
  }
  
  // Add description if missing
  if (!hasDescription) {
    newFrontmatterLines.push(`description: ${frameworkName} documentation`);
  }
  
  // Replace frontmatter
  return content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFrontmatterLines.join('\n')}\n---`);
}

function updateInternalLinks(content, frameworkName) {
  // Update internal links to match new structure
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    if (url.startsWith('./') || url.startsWith('../')) {
      // Relative link within the same framework
      return `[${text}](${url})`;
    } else if (url.startsWith('/')) {
      // Absolute link to another framework
      const parts = url.split('/');
      if (parts.length > 1 && ['js', 'next', 'react', 'python'].includes(parts[1])) {
        // Link to another framework's documentation
        return `[${text}](/${parts[1]}${parts.slice(2).join('/')})`;
      }
    }
    return match;
  });
}

function updateCustomComponents(content) {
  // Replace Fern components with Fumadocs components
  return content
    .replace(/<Info>([\s\S]*?)<\/Info>/g, '<Callout>([$1])</Callout>')
    .replace(/<Warning>([\s\S]*?)<\/Warning>/g, '<Callout type="warning">([$1])</Callout>')
    .replace(/<Error>([\s\S]*?)<\/Error>/g, '<Callout type="error">([$1])</Callout>')
    .replace(/<Tabs([^>]*)>([\s\S]*?)<\/Tabs>/g, '<Tabs>$2</Tabs>')
    .replace(/<Tab title="([^"]*)">([\s\S]*?)<\/Tab>/g, '<Tab value="$1" label="$1">$2</Tab>')
    .replace(/<Steps>([\s\S]*?)<\/Steps>/g, '<Steps>$1</Steps>')
    .replace(/<Step title="([^"]*)">([\s\S]*?)<\/Step>/g, '<Step>$2</Step>');
}

console.log('Migration completed!');
