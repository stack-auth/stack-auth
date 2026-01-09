import { readFileSync } from 'fs';
import type { InferPageType } from 'fumadocs-core/source';
import { remarkInclude } from 'fumadocs-mdx/config';
import { join } from 'path';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import { getExample } from '../code-examples';
import type { CodeExample } from './code-examples';
import { apiSource, source } from './source';

const processor = remark()
  .use(remarkMdx)
  // needed for Fumadocs MDX
  .use(remarkInclude)
  .use(remarkGfm);

// Helper function to extract OpenAPI content
function extractOpenAPIContent(page: InferPageType<typeof source> | InferPageType<typeof apiSource>): string | null {
  const content = page.data.content;
  
  // Check if this is an API page with EnhancedAPIPage component
  const enhancedAPIMatch = content.match(/<EnhancedAPIPage\s+([^>]+)\s*\/>/);
  if (!enhancedAPIMatch) {
    return null;
  }
  
  // Extract document and operations from the component props
  const propsString = enhancedAPIMatch[1];
  const documentMatch = propsString.match(/document=\{?"([^"]+)"\}?/);
  const operationsMatch = propsString.match(/operations=\{(\[.*?\])\}/);
  
  if (!documentMatch) {
    return null;
  }
  
  const documentPath = documentMatch[1];
  
  try {
    // Load the OpenAPI spec file
    // process.cwd() is already the docs directory, so just join with documentPath
    const specPath = join(process.cwd(), documentPath);
    const specContent = readFileSync(specPath, 'utf-8');
    const spec = JSON.parse(specContent);
    
    let result = `# API Documentation: ${page.data.title}\n\n`;
    result += `${page.data.description || ''}\n\n`;
    
    // If specific operations are specified, extract those
    if (operationsMatch) {
      try {
        const operations = JSON.parse(operationsMatch[1]);
        for (const op of operations) {
          const pathItem = spec.paths?.[op.path];
          const operation = pathItem?.[op.method.toLowerCase()];
          
          if (operation) {
            result += formatOperation(op.path, op.method, operation);
          }
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          // If parsing fails due to invalid JSON, include the whole spec summary
          result += formatOpenAPISpec(spec);
        } else {
          console.error('Unexpected error parsing operations:', e);
          result += formatOpenAPISpec(spec);
        }
      }
    } else {
      // Include the whole spec
      result += formatOpenAPISpec(spec);
    }
    
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('JSON parsing error in OpenAPI spec:', documentPath, error);
    } else if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.error('OpenAPI spec file not found:', documentPath, error);
    } else {
      console.error('Unexpected error reading OpenAPI spec:', documentPath, error);
    }
    return null;
  }
}

// Helper function to format a single operation
function formatOperation(path: string, method: string, operation: any): string {
  let result = `## ${method.toUpperCase()} ${path}\n\n`;
  
  if (operation.summary) {
    result += `**Summary:** ${operation.summary}\n\n`;
  }
  
  if (operation.description) {
    result += `**Description:** ${operation.description}\n\n`;
  }
  
  // Parameters
  if (operation.parameters && operation.parameters.length > 0) {
    result += `**Parameters:**\n`;
    for (const param of operation.parameters) {
      result += `- \`${param.name}\` (${param.in}): ${param.description || 'No description'}\n`;
    }
    result += '\n';
  }
  
  // Request body
  if (operation.requestBody) {
    result += `**Request Body:** ${operation.requestBody.description || 'Request body required'}\n\n`;
  }
  
  // Responses
  if (operation.responses) {
    result += `**Responses:**\n`;
    for (const [code, response] of Object.entries(operation.responses)) {
      result += `- ${code}: ${(response as any).description || 'No description'}\n`;
    }
    result += '\n';
  }
  
  return result;
}

// Helper function to format entire OpenAPI spec
function formatOpenAPISpec(spec: any): string {
  let result = '';
  
  if (spec.info) {
    result += `**API Version:** ${spec.info.version}\n`;
    if (spec.info.description) {
      result += `**Description:** ${spec.info.description}\n`;
    }
    result += '\n';
  }
  
  if (spec.paths) {
    result += '**Available Endpoints:**\n\n';
    const pathsMap = new Map<string, any>(Object.entries(spec.paths as Record<string, any>));
    for (const [path, pathItem] of pathsMap) {
      const methodsMap = new Map<string, any>(Object.entries(pathItem as Record<string, any>));
      for (const [method, operation] of methodsMap) {
        if (operation && typeof operation === 'object' && 'summary' in operation) {
          result += `- ${method.toUpperCase()} ${path}: ${operation.summary}\n`;
        }
      }
    }
    result += '\n';
  }
  
  return result;
}

// Helper function to format a code example as markdown
function formatCodeExample(example: CodeExample): string {
  const filename = example.filename ? ` title="${example.filename}"` : '';
  return `\`\`\`${example.highlightLanguage}${filename}\n${example.code}\n\`\`\``;
}

// Helper function to replace PlatformCodeblock components with actual code
function expandPlatformCodeblocks(content: string): string {
  // Match <PlatformCodeblock document="..." examples={[...]} /> or multi-line versions
  const platformCodeblockRegex = /<PlatformCodeblock\s+([^>]*?)\/>/gs;
  
  return content.replace(platformCodeblockRegex, (match, propsString) => {
    // Extract document prop
    const documentMatch = propsString.match(/document=["']([^"']+)["']/);
    // Extract examples prop - handle both {["..."]} and {["...", "..."]} formats
    const examplesMatch = propsString.match(/examples=\{\s*\[([^\]]+)\]\s*\}/);
    
    if (!documentMatch || !examplesMatch) {
      // Can't parse, return original
      return match;
    }
    
    const documentPath = documentMatch[1];
    // Parse the examples array - handle quoted strings
    const examplesStr = examplesMatch[1];
    const exampleNames = examplesStr
      .split(',')
      .map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
    
    let result = '';
    
    for (const exampleName of exampleNames) {
      const examples = getExample(documentPath, exampleName);
      if (!examples || examples.length === 0) {
        result += `<!-- Code example "${exampleName}" not found -->\n`;
        continue;
      }
      
      // Group examples by variant if they have variants
      const hasVariants = examples.some(e => e.variant);
      
      if (hasVariants) {
        // Show all variants
        for (const example of examples) {
          if (example.filename) {
            result += `**${example.filename}:**\n\n`;
          }
          result += formatCodeExample(example) + '\n\n';
        }
      } else {
        // No variants - just show the first example (typically there's only one per framework)
        // For LLM context, show all framework variants
        for (const example of examples) {
          if (examples.length > 1 && example.framework) {
            result += `**${example.framework}:**\n\n`;
          }
          result += formatCodeExample(example) + '\n\n';
        }
      }
    }
    
    return result;
  });
}

export async function getLLMText(page: InferPageType<typeof source> | InferPageType<typeof apiSource>) {
  try {
    // Check if this is an API page and extract OpenAPI content
    const openAPIContent = extractOpenAPIContent(page);
    if (openAPIContent) {
      return `# ${page.data.title}
URL: ${page.url}
Source: ${page.data._file.absolutePath}

${openAPIContent}`;
    }
    
    // For non-API pages, process normally
    // Remove the Fumadocs generated comment before processing
    let content = page.data.content;

    // Remove the specific Fumadocs comment that appears in generated API docs
    content = content.replace(
      /\{\s*\/\*\s*This file was generated by Fumadocs\. Do not edit this file directly\. Any changes should be made by running the generation command again\.\s*\*\/\s*\}/g,
      ''
    );

    // Expand PlatformCodeblock components to inline code
    content = expandPlatformCodeblocks(content);

    const processed = await processor.process({
      path: page.data._file.absolutePath,
      value: content,
    });

    return `# ${page.data.title}
URL: ${page.url}
Source: ${page.data._file.absolutePath}

${page.data.description || ''}

${processed.value}`;
  } catch (error) {
    console.error('Error processing LLM text for page:', page.url, error);
    // Return a basic fallback content instead of throwing
    return `# ${page.data.title}
URL: ${page.url}
Source: ${page.data._file.absolutePath}

${page.data.description || ''}

Error: Could not process content for this page.`;
  }
}
