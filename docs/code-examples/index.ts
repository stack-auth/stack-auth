import { CodeExample } from '../lib/code-examples';
import { apiKeysExamples } from './api-keys';
import { setupExamples } from './setup';
import { viteExamples } from './vite-example';

const allExamples: Record<string, Record<string, Record<string, CodeExample[]>>> = {
  'setup': setupExamples,
  'apps': apiKeysExamples,
  'getting-started': viteExamples,
  // Add more sections here as needed:
  // 'auth': authExamples,
  // 'customization': customizationExamples,
};

export function getExample(documentPath: string, exampleName: string): CodeExample[] | undefined {
  const [section, ...rest] = documentPath.split('/');
  const subsection = rest.join('/');
  return allExamples[section]?.[subsection]?.[exampleName];
}

export function getDocumentExamples(documentPath: string): Record<string, CodeExample[]> | undefined {
  const [section, ...rest] = documentPath.split('/');
  const subsection = rest.join('/');
  return allExamples[section]?.[subsection];
}

