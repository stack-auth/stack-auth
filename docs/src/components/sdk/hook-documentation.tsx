'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import React, { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';
import { ParamField } from '../mdx/sdk-components';
import { AsideSection, CollapsibleMethodSection, MethodAside, MethodContent, MethodLayout } from '../ui/method-layout';

// Type definitions based on hooks.json structure
type HookInfo = {
  name: string,
  kind: 'function',
  sourcePath: string,
  line: number,
  category: 'hooks',
  type: string,
  declaration: string,
  description?: string,
  signatures?: string[],
  tags?: Array<{
    name: string,
    text: string,
  }>,
};

type HookDocumentationProps = {
  hookInfo: HookInfo,
};

// Syntax highlighted code block component
function SyntaxHighlightedCode({ code, language = 'typescript' }: { code: string, language?: string }) {
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    const updateHighlightedCode = async () => {
      try {
        const isDarkMode = document.documentElement.classList.contains('dark') ||
          getComputedStyle(document.documentElement).getPropertyValue('--fd-background').includes('0 0% 3.9%');
        const theme = isDarkMode ? 'github-dark' : 'github-light';

        const html = await codeToHtml(code, {
          lang: language,
          theme,
          transformers: [{
            pre(node) {
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            },
            code(node) {
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            }
          }]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        setHighlightedCode(`<pre><code>${code}</code></pre>`);
      }
    };

    runAsynchronously(updateHighlightedCode);

    // Listen for theme changes
    const observer = new MutationObserver(() => {
      runAsynchronously(updateHighlightedCode);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, [code, language, isClient]);

  if (!highlightedCode) {
    return <pre className="text-xs"><code>{code}</code></pre>;
  }

  return <div className="[&_pre]:!bg-transparent [&_code]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 text-xs" dangerouslySetInnerHTML={{ __html: highlightedCode }} />;
}

// Get a human-readable description for a parameter
function getParameterDescription(hookName: string, paramName: string, paramType: string): string {
  if (hookName === 'useUser' && paramName === 'options') {
    return 'Configuration options for the hook. Use `or: "redirect"` to redirect if not logged in, or `or: "throw"` to throw an error.';
  }
  if (hookName === 'useStackApp' && paramName === 'options') {
    return 'Configuration options. Use `projectIdMustMatch` to validate the project ID.';
  }
  return `Parameter of type ${paramType}.`;
}

// Clean return type - remove internal types from display
function cleanReturnType(hookName: string, returnType: string): string {
  const cleaned = cleanTypeString(returnType);
  
  // For useUser, simplify to just CurrentUser | null
  if (hookName === 'useUser') {
    if (cleaned.includes('Internal')) {
      return 'CurrentUser | null';
    }
  }
  
  return cleaned;
}

// Clean up type strings - remove import paths, simplify types
function cleanTypeString(type: string): string {
  return type
    // Remove import(...) paths
    .replace(/import\([^)]+\)\./g, '')
    // Simplify RequestLike to just RequestLike
    .replace(/RequestLike \| \{ accessToken: string; refreshToken: string; \}/g, 'RequestLike')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Simplify a complex options type to something more readable
function simplifyOptionsType(optionsType: string): string {
  const cleaned = cleanTypeString(optionsType);
  
  // If it's a GetUserOptions reference, use that
  if (cleaned.includes('GetUserOptions')) {
    return 'GetUserOptions';
  }
  
  // For complex intersection types, extract the key differentiating parts
  // Like { or: "redirect" | "throw"; projectIdMustMatch: "internal"; }
  const orMatch = cleaned.match(/or:\s*("[^"]+"\s*\|\s*"[^"]+"|\\"[^"]+\\")/);
  const projectMatch = cleaned.match(/projectIdMustMatch:\s*("[^"]+"|string)/);
  
  if (orMatch || projectMatch) {
    const parts: string[] = [];
    if (orMatch) {
      parts.push(`or: ${orMatch[1].replace(/\\"/g, '"')}`);
    }
    if (projectMatch) {
      parts.push(`projectIdMustMatch: ${projectMatch[1].replace(/\\"/g, '"')}`);
    }
    return `{ ${parts.join('; ')}; ... }`;
  }
  
  // If still too long, truncate
  if (cleaned.length > 60) {
    return 'GetUserOptions';
  }
  
  return cleaned;
}

// Parse a signature handling nested braces/parens
function parseSignatureComponents(signature: string): { params: string, returnType: string } | null {
  const cleaned = cleanTypeString(signature);
  
  let parenDepth = 0;
  let braceDepth = 0;
  let paramStart = -1;
  let paramEnd = -1;
  
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (char === '(') {
      if (parenDepth === 0 && braceDepth === 0) paramStart = i;
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
      if (parenDepth === 0 && braceDepth === 0) {
        paramEnd = i;
        break;
      }
    } else if (char === '{') {
      braceDepth++;
    } else if (char === '}') {
      braceDepth--;
    }
  }
  
  if (paramStart === -1 || paramEnd === -1) return null;
  
  const params = cleaned.slice(paramStart + 1, paramEnd);
  const rest = cleaned.slice(paramEnd + 1);
  const returnMatch = rest.match(/\s*=>\s*(.+)$/);
  if (!returnMatch) return null;
  
  return { params, returnType: returnMatch[1].trim() };
}

// Format multiple signatures for display
function formatHookSignatures(hookName: string, signatures: string[]): string {
  // For hooks with simple signatures (1 signature or short), show full signature
  if (signatures.length === 1) {
    return formatSingleSignature(hookName, signatures[0]);
  }
  
  // For overloaded hooks, find the most general/public signature
  // Skip internal types - we don't document those
  for (const sig of signatures) {
    const parsed = parseSignatureComponents(sig);
    if (parsed) {
      // Skip signatures with Internal types
      if (parsed.returnType.includes('Internal')) continue;
      
      // Prefer the most general signature (with union return type or null)
      if (parsed.returnType.includes('null') || parsed.returnType.includes('|')) {
        return `declare function ${hookName}(options?: GetUserOptions): ${parsed.returnType};`;
      }
    }
  }
  
  // Fallback: find any non-internal signature
  for (const sig of signatures) {
    const parsed = parseSignatureComponents(sig);
    if (parsed && !parsed.returnType.includes('Internal')) {
      return `declare function ${hookName}(options?: GetUserOptions): ${parsed.returnType};`;
    }
  }
  
  // Last resort: use first signature
  return formatSingleSignature(hookName, signatures[0]);
}

// Format a single hook signature nicely for display
function formatSingleSignature(hookName: string, signature: string): string {
  const cleaned = cleanTypeString(signature);
  
  // Try to parse function signature: <Generics>(params) => ReturnType
  const genericMatch = cleaned.match(/^(<[^>]+>)/);
  const generics = genericMatch ? genericMatch[1] : '';
  
  const restOfSig = genericMatch ? cleaned.slice(generics.length) : cleaned;
  const match = restOfSig.match(/\((.*?)\)\s*=>\s*(.+)$/s);
  
  if (!match) {
    return `declare function ${hookName}${cleaned}`;
  }

  const params = match[1];
  const returnType = match[2];

  if (!params.trim()) {
    return `declare function ${hookName}${generics}(): ${returnType};`;
  }

  // Parse parameter name and type
  const paramMatch = params.match(/^(\w+)\??:\s*(.+)$/);
  if (paramMatch) {
    const paramName = paramMatch[1];
    const paramType = paramMatch[2];
    const isOptional = params.includes('?');
    return `declare function ${hookName}${generics}(\n  ${paramName}${isOptional ? '?' : ''}: ${paramType}\n): ${returnType};`;
  }

  return `declare function ${hookName}${generics}(${params}): ${returnType};`;
}

function parseSignature(signature: string): {
  parameters: Array<{ name: string, type: string, optional: boolean, description?: string }>,
  returnType: string,
} | null {
  const cleaned = cleanTypeString(signature);
  
  // Try to parse function signature: (params) => ReturnType
  // Need to handle nested braces in the params
  let parenDepth = 0;
  let braceDepth = 0;
  let paramStart = -1;
  let paramEnd = -1;
  
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (char === '(') {
      if (parenDepth === 0 && braceDepth === 0) paramStart = i;
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
      if (parenDepth === 0 && braceDepth === 0) {
        paramEnd = i;
        break;
      }
    } else if (char === '{') {
      braceDepth++;
    } else if (char === '}') {
      braceDepth--;
    }
  }
  
  if (paramStart === -1 || paramEnd === -1) return null;
  
  const paramsStr = cleaned.slice(paramStart + 1, paramEnd);
  const rest = cleaned.slice(paramEnd + 1);
  const returnMatch = rest.match(/\s*=>\s*(.+)$/);
  if (!returnMatch) return null;
  
  const returnType = returnMatch[1].trim();
  const parameters: Array<{ name: string, type: string, optional: boolean, description?: string }> = [];
  
  if (paramsStr.trim()) {
    // Parse param: name?: type
    const paramMatch = paramsStr.match(/^(\w+)(\?)?:\s*(.+)$/);
    if (paramMatch) {
      const name = paramMatch[1];
      const optional = !!paramMatch[2];
      const type = paramMatch[3];
      parameters.push({ name, type, optional });
    }
  }

  return { parameters, returnType };
}

export function HookDocumentation({ hookInfo }: HookDocumentationProps) {
  const primarySignature = hookInfo.signatures?.[0];
  const parsedSignature = primarySignature ? parseSignature(primarySignature) : null;

  return (
    <div className="space-y-6">
      {/* Hook Header */}
      <div className="border-b border-fd-border pb-4">
        <h1 className="text-2xl font-bold text-fd-foreground mb-2">
          {hookInfo.name}
        </h1>

        {hookInfo.description && (
          <p className="text-fd-muted-foreground mb-4">
            {hookInfo.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-sm text-fd-muted-foreground">
          <div>
            <span className="font-medium">Source:</span>{' '}
            <code className="bg-fd-muted px-1.5 py-0.5 rounded">{hookInfo.sourcePath}</code>
          </div>
          <div>
            <span className="font-medium">Line:</span>{' '}
            <code className="bg-fd-muted px-1.5 py-0.5 rounded">{hookInfo.line}</code>
          </div>
        </div>
      </div>

      {/* Hook Usage */}
      <CollapsibleMethodSection
        method={hookInfo.name}
        signature={parsedSignature?.parameters.map(p => p.name).join(', ')}
        appType="StackClientApp"
        defaultOpen={true}
      >
        <MethodLayout>
          <MethodContent>
            {hookInfo.tags?.some(tag => tag.name === 'deprecated') && (
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/50 rounded-lg">
                <div className="text-yellow-800 dark:text-yellow-200 text-sm font-medium mb-1">
                  ⚠️ Deprecated
                </div>
                <div className="text-yellow-700 dark:text-yellow-300 text-sm">
                  {hookInfo.tags.find(tag => tag.name === 'deprecated')?.text || 'This hook is deprecated.'}
                </div>
              </div>
            )}

            <h4 className="text-sm font-semibold text-fd-foreground mb-3">Parameters</h4>

            {(!parsedSignature || parsedSignature.parameters.length === 0) ? (
              <p className="text-sm text-fd-muted-foreground mb-4">No parameters.</p>
            ) : (
              <div className="space-y-3 mb-6">
                {parsedSignature.parameters.map((param, index) => {
                  const simplifiedType = simplifyOptionsType(param.type);
                  return (
                    <ParamField
                      key={index}
                      path={param.name}
                      type={simplifiedType}
                      required={!param.optional}
                    >
                      {getParameterDescription(hookInfo.name, param.name, simplifiedType)}
                    </ParamField>
                  );
                })}
              </div>
            )}

            <h4 className="text-sm font-semibold text-fd-foreground mb-2">Returns</h4>
            <p className="text-sm text-fd-muted-foreground">
              <code className="bg-fd-muted px-1.5 py-0.5 rounded text-xs">
                {cleanReturnType(hookInfo.name, parsedSignature?.returnType ?? 'unknown')}
              </code>
            </p>
          </MethodContent>

          <MethodAside title="Hook Definition">
            <AsideSection title="Signature">
              <SyntaxHighlightedCode
                code={hookInfo.signatures?.length
                  ? formatHookSignatures(hookInfo.name, hookInfo.signatures)
                  : `declare function ${hookInfo.name}: ${cleanTypeString(hookInfo.type)};`
                }
                language="typescript"
              />
            </AsideSection>

            {hookInfo.sourcePath && hookInfo.line ? (
              <div className="mt-4 pt-4 border-t border-fd-border">
                <a
                  href={`https://github.com/stack-auth/stack/blob/main/packages/template/${hookInfo.sourcePath}#L${hookInfo.line}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-fd-border bg-fd-secondary/30 hover:bg-fd-secondary/50 hover:border-fd-accent-foreground/50 transition-all duration-200 no-underline"
                >
                  <svg className="w-3.5 h-3.5 text-fd-muted-foreground group-hover:text-fd-accent-foreground transition-colors flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                  <span className="flex-1 text-xs font-medium text-fd-foreground group-hover:text-fd-accent-foreground transition-colors truncate">
                    View Source · {hookInfo.sourcePath.split('/').pop()}:{hookInfo.line}
                  </span>
                  <svg className="w-3 h-3 text-fd-muted-foreground group-hover:text-fd-accent-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </div>
            ) : null}
          </MethodAside>
        </MethodLayout>
      </CollapsibleMethodSection>
    </div>
  );
}

// Component to load and display a specific hook from hooks.json
export function HookFromJson({ hookName }: { hookName: string }) {
  const [hookInfo, setHookInfo] = React.useState<HookInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function loadHookInfo() {
      try {
        setLoading(true);
        setError(null);

        // Load the hooks.json file
        const response = await fetch('/sdk-docs/hooks.json');
        if (!response.ok) {
          throw new Error(`Failed to load hooks.json: ${response.statusText}`);
        }

        const hooksData = await response.json();
        const foundHook = hooksData[hookName];

        if (!foundHook) {
          throw new Error(`Hook "${hookName}" not found in hooks.json. Available hooks: ${Object.keys(hooksData).join(', ')}`);
        }

        setHookInfo(foundHook);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    runAsynchronously(loadHookInfo());
  }, [hookName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-fd-muted-foreground">Loading hook documentation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-lg p-4 my-4">
        <div className="text-red-800 dark:text-red-200 font-medium mb-1">Error Loading Hook</div>
        <div className="text-red-700 dark:text-red-300 text-sm">{error}</div>
      </div>
    );
  }

  if (!hookInfo) {
    return (
      <div className="text-fd-muted-foreground text-center py-8">
        Hook not found.
      </div>
    );
  }

  return <HookDocumentation hookInfo={hookInfo} />;
}

