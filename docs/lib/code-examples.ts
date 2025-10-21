/**
 * Centralized code examples for Stack Auth documentation
 * 
 * Examples are stored as TypeScript files in: docs/code-examples/
 * 
 * Structure:
 * - language: Programming language (e.g., "JavaScript", "Python")
 * - framework: Framework (e.g., "Next.js", "React", "Django")
 * - variant: Optional "server" or "client"
 * - code: The actual code (use template literals for multi-line)
 * - highlightLanguage: Syntax highlighting language
 * - filename: Display filename
 */

export type CodeExample = {
  language: string;
  framework: string;
  variant?: 'server' | 'client';
  code: string;
  highlightLanguage: string;
  filename?: string;
};

export type CodeExamplesMap = {
  [documentPath: string]: {
    [exampleName: string]: CodeExample[];
  };
};

// Re-export functions from the code-examples index
export { getDocumentExamples, getExample } from '../code-examples';

