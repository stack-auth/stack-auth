import { CodeExample } from '../lib/code-examples';
import { gettingStartedExamples } from './setup';

const allExamples: Record<string, Record<string, Record<string, CodeExample[]>>> = {
  'getting-started': gettingStartedExamples,
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

