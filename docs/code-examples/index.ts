import { CodeExample } from '../lib/code-examples';
import { apiKeysExamples } from './api-keys';
import { customizationExamples } from './customization';
import { paymentsExamples } from './payments';
import { selfHostExamples } from './self-host';
import { setupExamples } from './setup';
import { swiftExamples } from './swift';
import { viteExamples } from './vite-example';

const allExamples: Record<string, Record<string, Record<string, CodeExample[]>>> = {
  'setup': setupExamples,
  'apps': {...apiKeysExamples, ...paymentsExamples },
  'getting-started': {...viteExamples, ...swiftExamples},
  'others': selfHostExamples,
  'customization': customizationExamples,
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

