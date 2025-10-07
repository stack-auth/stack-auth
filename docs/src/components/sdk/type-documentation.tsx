'use client';

import React from 'react';
import { ClickableTableOfContents, ParamField } from '../mdx/sdk-components';
import { AsideSection, CollapsibleTypesSection, MethodAside, MethodContent, MethodLayout } from '../ui/method-layout';

// Type definitions based on the types.json structure
type TypeMember = {
  name: string,
  optional: boolean,
  sourcePath: string,
  line: number,
  kind: 'property' | 'method',
  type?: string,
  description?: string,
  signatures?: Array<{
    signature: string,
    parameters: Array<{
      name: string,
      type: string,
      optional: boolean,
    }>,
    returnType: string,
  }>,
  platforms?: string[],
  tags?: Array<{
    name: string,
    text: string,
  }>,
};

type TypeInfo = {
  name: string,
  kind: 'type',
  sourcePath: string,
  line: number,
  category: 'types',
  definition: string,
  description?: string,
  members: TypeMember[],
  mixins?: string[],
};

type TypeDocumentationProps = {
  typeInfo: TypeInfo,
  platform?: string,
};

function formatTypeSignature(type: string): string {
  // Clean up long import paths and make types more readable
  return type
    .replace(/import\([^)]+\)\./g, '') // Remove import() paths
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

function generateTableOfContents(typeInfo: TypeInfo, platform = 'react-like'): string {
  const lines: string[] = [];

  lines.push(`type ${typeInfo.name} = {`);

  typeInfo.members.forEach(member => {
    // Skip platform-specific members if they don't match current platform
    if (member.platforms && !member.platforms.includes(platform)) {
      return;
    }

    const memberName = member.name;
    const isOptional = member.optional ? '?' : '';
    const anchorId = `#${typeInfo.name.toLowerCase()}${memberName.toLowerCase()}`;

    if (member.kind === 'property') {
      const cleanType = formatTypeSignature(member.type || 'unknown');
      lines.push(`    ${memberName}${isOptional}: ${cleanType}; //$stack-link-to:${anchorId}`);
    } else {
      // For methods, show the first signature or a simplified version
      const signature = member.signatures?.[0];
      if (signature) {
        const params = signature.parameters.map(p => {
          if (p.optional) {
            return `${p.name}?`;
          }
          return p.name;
        }).join(', ');
        const returnType = formatTypeSignature(signature.returnType);
        lines.push(`    ${memberName}(${params}): ${returnType}; //$stack-link-to:${anchorId}`);
      } else {
        lines.push(`    ${memberName}(): unknown; //$stack-link-to:${anchorId}`);
      }
    }
  });

  lines.push('};');

  return lines.join('\n');
}

function renderMemberDocumentation(typeInfo: TypeInfo, member: TypeMember, platform = 'react-like') {
  const memberName = member.name;

  // Skip platform-specific members if they don't match current platform
  if (member.platforms && !member.platforms.includes(platform)) {
    return null;
  }

  return (
    <CollapsibleTypesSection
      key={memberName}
      type={typeInfo.name}
      property={memberName}
      signature={member.kind === 'method' && member.signatures?.[0] ?
        member.signatures[0].parameters.map(p => p.name).join(', ') : undefined
      }
      defaultOpen={false}
    >
      <MethodLayout>
        <MethodContent>
          {member.description && (
            <div className="mb-4 text-fd-muted-foreground">
              {member.description}
            </div>
          )}

          {member.tags?.some(tag => tag.name === 'deprecated') && (
            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/50 rounded-lg">
              <div className="text-yellow-800 dark:text-yellow-200 text-sm font-medium mb-1">
                ⚠️ Deprecated
              </div>
              <div className="text-yellow-700 dark:text-yellow-300 text-sm">
                {member.tags.find(tag => tag.name === 'deprecated')?.text || 'This method is deprecated.'}
              </div>
            </div>
          )}

          {member.kind === 'method' && member.signatures && (
            <>
              <h4 className="text-sm font-semibold text-fd-foreground mb-3">Parameters</h4>

              {member.signatures[0].parameters.length === 0 ? (
                <p className="text-sm text-fd-muted-foreground mb-4">No parameters.</p>
              ) : (
                <div className="space-y-3 mb-6">
                  {member.signatures[0].parameters.map((param, index) => (
                    <ParamField
                      key={index}
                      path={param.name}
                      type={formatTypeSignature(param.type)}
                      required={!param.optional}
                    >
                      Parameter of type {formatTypeSignature(param.type)}.
                    </ParamField>
                  ))}
                </div>
              )}

              <h4 className="text-sm font-semibold text-fd-foreground mb-2">Returns</h4>
              <p className="text-sm text-fd-muted-foreground">
                <code className="bg-fd-muted px-1.5 py-0.5 rounded text-xs">
                  {formatTypeSignature(member.signatures[0].returnType)}
                </code>
              </p>
            </>
          )}

          {member.kind === 'property' && (
            <>
              <h4 className="text-sm font-semibold text-fd-foreground mb-2">Type</h4>
              <p className="text-sm text-fd-muted-foreground">
                <code className="bg-fd-muted px-1.5 py-0.5 rounded text-xs">
                  {formatTypeSignature(member.type || 'unknown')}
                </code>
              </p>
            </>
          )}
        </MethodContent>

        <MethodAside title="Type Definition">
          {member.kind === 'method' && member.signatures ? (
            <AsideSection title="Signature">
              <pre className="text-xs bg-fd-code p-3 rounded border overflow-x-auto">
                <code>
                  {member.signatures.map((sig, index) => (
                    <div key={index} className="mb-2 last:mb-0">
                      {sig.signature}
                    </div>
                  ))}
                </code>
              </pre>
            </AsideSection>
          ) : (
            <pre className="text-xs bg-fd-code p-3 rounded border overflow-x-auto">
              <code>
                declare const {memberName}: {formatTypeSignature(member.type || 'unknown')};
              </code>
            </pre>
          )}

          <AsideSection title="Source">
            <div className="text-xs text-fd-muted-foreground">
              <div>File: <code className="bg-fd-muted px-1 py-0.5 rounded">{member.sourcePath}</code></div>
              <div>Line: <code className="bg-fd-muted px-1 py-0.5 rounded">{member.line}</code></div>
            </div>
          </AsideSection>
        </MethodAside>
      </MethodLayout>
    </CollapsibleTypesSection>
  );
}

export function TypeDocumentation({ typeInfo, platform = 'react-like' }: TypeDocumentationProps) {
  return (
    <div className="space-y-6">
      {/* Type Header */}
      <div className="border-b border-fd-border pb-4">
        <h1 className="text-2xl font-bold text-fd-foreground mb-2">
          {typeInfo.name}
        </h1>

        {typeInfo.description && (
          <p className="text-fd-muted-foreground mb-4">
            {typeInfo.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-sm text-fd-muted-foreground">
          <div>
            <span className="font-medium">Source:</span>{' '}
            <code className="bg-fd-muted px-1.5 py-0.5 rounded">{typeInfo.sourcePath}</code>
          </div>
          <div>
            <span className="font-medium">Line:</span>{' '}
            <code className="bg-fd-muted px-1.5 py-0.5 rounded">{typeInfo.line}</code>
          </div>
        </div>
      </div>

      {/* Type Definition */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-fd-foreground">Type Definition</h2>
        <div className="bg-fd-code p-4 rounded-lg border border-fd-border overflow-x-auto">
          <pre className="text-sm">
            <code className="text-fd-foreground">
              {typeInfo.definition}
            </code>
          </pre>
        </div>
      </div>

      {/* Mixins */}
      {typeInfo.mixins && typeInfo.mixins.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-fd-foreground">Extends</h2>
          <div className="space-y-2">
            {typeInfo.mixins.map((mixin, index) => (
              <div key={index} className="bg-fd-muted/50 p-3 rounded border">
                <code className="text-sm text-fd-foreground">{mixin}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table of Contents */}
      {typeInfo.members.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-fd-foreground">Table of Contents</h2>
          <ClickableTableOfContents
            code={generateTableOfContents(typeInfo, platform)}
            platform={platform}
          />
        </div>
      )}

      {/* Members Documentation */}
      {typeInfo.members.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-fd-foreground">Members</h2>
          <div className="space-y-2">
            {typeInfo.members.map(member =>
              renderMemberDocumentation(typeInfo, member, platform)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Component to load and display a specific type from types.json
export function TypeFromJson({ typeName, platform = 'react-like' }: { typeName: string, platform?: string }) {
  const [typeInfo, setTypeInfo] = React.useState<TypeInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function loadTypeInfo() {
      try {
        setLoading(true);
        setError(null);

        // Load the types.json file
        const response = await fetch('/sdk-docs/types.json');
        if (!response.ok) {
          throw new Error(`Failed to load types.json: ${response.statusText}`);
        }

        const typesData = await response.json();
        const foundType = typesData[typeName];

        if (!foundType) {
          throw new Error(`Type "${typeName}" not found in types.json`);
        }

        setTypeInfo(foundType);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    loadTypeInfo().then(() => {
      // Type info loaded successfully
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load type info');
      setLoading(false);
    });
  }, [typeName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-fd-muted-foreground">Loading type documentation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-lg p-4">
        <div className="text-red-800 dark:text-red-200 font-medium mb-1">Error Loading Type</div>
        <div className="text-red-700 dark:text-red-300 text-sm">{error}</div>
      </div>
    );
  }

  if (!typeInfo) {
    return (
      <div className="text-fd-muted-foreground text-center py-8">
        Type not found.
      </div>
    );
  }

  return <TypeDocumentation typeInfo={typeInfo} platform={platform} />;
}
