'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import React from 'react';
import { AsideSection, CollapsibleMethodSection, MethodAside, MethodContent, MethodLayout } from '../ui/method-layout';

// Type definitions based on objects.json structure
type ObjectInfo = {
  name: string,
  kind: 'variable' | 'type' | 'class',
  sourcePath: string,
  line: number,
  category: 'objects',
  type: string,
  declaration: string,
  description?: string,
  signatures?: string[],
  tags?: Array<{
    name: string,
    text: string,
  }>,
};

type ObjectDocumentationProps = {
  objectInfo: ObjectInfo,
};

function formatTypeSignature(type: string): string {
  // Clean up long import paths and make types more readable
  return type
    .replace(/import\([^)]+\)\./g, '') // Remove import() paths
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

export function ObjectDocumentation({ objectInfo }: ObjectDocumentationProps) {
  return (
    <div className="space-y-6">
      {/* Object Header */}
      <div className="border-b border-fd-border pb-4">
        <h1 className="text-2xl font-bold text-fd-foreground mb-2">
          {objectInfo.name}
        </h1>

        {objectInfo.description && (
          <p className="text-fd-muted-foreground mb-4">
            {objectInfo.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-sm text-fd-muted-foreground mb-4">
          <div>
            <span className="font-medium">Kind:</span>{' '}
            <code className="bg-fd-muted px-1.5 py-0.5 rounded">{objectInfo.kind}</code>
          </div>
          <div>
            <span className="font-medium">Source:</span>{' '}
            <code className="bg-fd-muted px-1.5 py-0.5 rounded">{objectInfo.sourcePath}</code>
          </div>
          <div>
            <span className="font-medium">Line:</span>{' '}
            <code className="bg-fd-muted px-1.5 py-0.5 rounded">{objectInfo.line}</code>
          </div>
        </div>
      </div>

      {/* Object Definition */}
      <CollapsibleMethodSection
        method={objectInfo.name}
        signature=""
        appType={objectInfo.kind === 'class' ? 'StackClientApp' : 'StackServerApp'}
        defaultOpen={true}
      >
        <MethodLayout>
          <MethodContent>
            {objectInfo.tags?.some(tag => tag.name === 'deprecated') && (
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/50 rounded-lg">
                <div className="text-yellow-800 dark:text-yellow-200 text-sm font-medium mb-1">
                  ⚠️ Deprecated
                </div>
                <div className="text-yellow-700 dark:text-yellow-300 text-sm">
                  {objectInfo.tags.find(tag => tag.name === 'deprecated')?.text || 'This object is deprecated.'}
                </div>
              </div>
            )}

            <h4 className="text-sm font-semibold text-fd-foreground mb-2">Type</h4>
            <p className="text-sm text-fd-muted-foreground mb-4">
              <code className="bg-fd-muted px-1.5 py-0.5 rounded text-xs">
                {formatTypeSignature(objectInfo.type)}
              </code>
            </p>

            {objectInfo.signatures && objectInfo.signatures.length > 0 && (
              <>
                <h4 className="text-sm font-semibold text-fd-foreground mb-2 mt-4">Call Signatures</h4>
                <div className="space-y-2">
                  {objectInfo.signatures.map((sig, index) => (
                    <div key={index} className="bg-fd-muted/50 p-3 rounded border">
                      <code className="text-xs text-fd-foreground">{formatTypeSignature(sig)}</code>
                    </div>
                  ))}
                </div>
              </>
            )}

            {objectInfo.tags && objectInfo.tags.length > 0 && (
              <>
                <h4 className="text-sm font-semibold text-fd-foreground mb-2 mt-4">Additional Information</h4>
                <div className="space-y-2">
                  {objectInfo.tags.filter(tag => tag.name !== 'deprecated').map((tag, index) => (
                    <div key={index} className="text-sm">
                      <span className="font-medium text-fd-foreground">@{tag.name}:</span>{' '}
                      <span className="text-fd-muted-foreground">{tag.text}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </MethodContent>

          <MethodAside title="Object Definition">
            <AsideSection title="Declaration">
              <pre className="text-xs bg-fd-code p-3 rounded border overflow-x-auto">
                <code>{objectInfo.declaration}</code>
              </pre>
            </AsideSection>

            {objectInfo.signatures && objectInfo.signatures.length > 0 && (
              <AsideSection title="Signatures">
                <pre className="text-xs bg-fd-code p-3 rounded border overflow-x-auto">
                  <code>
                    {objectInfo.signatures.map((sig, index) => (
                      <div key={index} className="mb-2 last:mb-0">
                        {sig}
                      </div>
                    ))}
                  </code>
                </pre>
              </AsideSection>
            )}

            <AsideSection title="Source">
              <div className="text-xs text-fd-muted-foreground">
                <div>File: <code className="bg-fd-muted px-1 py-0.5 rounded">{objectInfo.sourcePath}</code></div>
                <div>Line: <code className="bg-fd-muted px-1 py-0.5 rounded">{objectInfo.line}</code></div>
              </div>
            </AsideSection>
          </MethodAside>
        </MethodLayout>
      </CollapsibleMethodSection>
    </div>
  );
}

// Component to load and display a specific object from objects.json
export function ObjectFromJson({ objectName }: { objectName: string }) {
  const [objectInfo, setObjectInfo] = React.useState<ObjectInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function loadObjectInfo() {
      try {
        setLoading(true);
        setError(null);

        // Load the objects.json file
        const response = await fetch('/sdk-docs/objects.json');
        if (!response.ok) {
          throw new Error(`Failed to load objects.json: ${response.statusText}`);
        }

        const objectsData = await response.json();
        const foundObject = objectsData[objectName];

        if (!foundObject) {
          throw new Error(`Object "${objectName}" not found in objects.json`);
        }

        setObjectInfo(foundObject);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    runAsynchronously(loadObjectInfo());
  }, [objectName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-fd-muted-foreground">Loading object documentation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-lg p-4">
        <div className="text-red-800 dark:text-red-200 font-medium mb-1">Error Loading Object</div>
        <div className="text-red-700 dark:text-red-300 text-sm">{error}</div>
      </div>
    );
  }

  if (!objectInfo) {
    return (
      <div className="text-fd-muted-foreground text-center py-8">
        Object not found.
      </div>
    );
  }

  return <ObjectDocumentation objectInfo={objectInfo} />;
}

