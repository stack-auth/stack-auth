import { CodeExample } from '../lib/code-examples';
import { apiKeysExamples } from './api-keys';
import { paymentsExamples } from './payments';
import { setupExamples } from './setup';

const allExamples: Record<string, Record<string, Record<string, CodeExample[]>>> = {
  'setup': setupExamples,
  'apps': { ...apiKeysExamples, ...paymentsExamples },
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

